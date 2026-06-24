# learn-go-security-cryptography-integrity-part-009.md

# Part 009 — Public-Key Cryptography in Go: RSA, ECDSA, Ed25519, Signing vs Encryption, Padding, Malleability, Key Formats, and Migration Strategy

> Seri: `learn-go-security-cryptography-integrity`  
> Bagian: `009 / 034`  
> Status seri: **belum selesai**  
> Target Go: **Go 1.26.x**  
> Target pembaca: Java software engineer yang ingin membangun intuisi security Go setara internal engineering handbook.

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya kita sudah membahas:

- randomness, entropy, nonce, IV, salt, dan token generation;
- hashing, digest, checksum, collision/preimage resistance;
- MAC/HMAC, canonicalization, replay protection, dan constant-time verification;
- symmetric encryption, AEAD, AES-GCM, ChaCha20-Poly1305, envelope encryption, dan nonce discipline.

Sekarang kita masuk ke area yang sering disalahpahami: **public-key cryptography**.

Public-key cryptography bukan sekadar:

```go
privateKey.Sign(...)
publicKey.Verify(...)
```

atau:

```go
rsa.EncryptOAEP(...)
rsa.DecryptOAEP(...)
```

Public-key cryptography adalah mekanisme untuk menyelesaikan masalah distribusi trust:

- bagaimana pihak A membuktikan bahwa pesan berasal dari A;
- bagaimana pihak B mengirim secret ke A tanpa sudah punya shared secret;
- bagaimana service memverifikasi artifact yang dibuat oleh issuer lain;
- bagaimana certificate chain menghubungkan public key ke identity;
- bagaimana rotasi key tidak menghancurkan backward compatibility;
- bagaimana sistem bisa tetap aman ketika ada banyak issuer, tenant, key version, dan protocol version.

Di Java, banyak engineer terbiasa memakai `java.security.Signature`, `KeyFactory`, `KeyPairGenerator`, `X509EncodedKeySpec`, `PKCS8EncodedKeySpec`, `Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")`, atau library seperti Bouncy Castle. Di Go, standard library lebih eksplisit, lebih kecil, dan lebih dekat dengan primitive. Ini bagus untuk auditability, tetapi juga membuat kesalahan desain lebih mudah terlihat — dan kadang lebih mudah dilakukan jika mental model belum matang.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu seharusnya mampu:

1. Membedakan dengan tegas:
   - signing;
   - encryption;
   - key agreement;
   - certificate identity;
   - token issuer verification;
   - artifact integrity.

2. Menjelaskan kapan memakai:
   - RSA-PSS;
   - RSA-OAEP;
   - ECDSA;
   - Ed25519;
   - X.509 public key format;
   - PKCS#8 private key format.

3. Menghindari kesalahan umum seperti:
   - memakai RSA encryption untuk payload besar;
   - memakai RSA PKCS#1 v1.5 untuk desain baru;
   - memakai ECDSA signature tanpa canonical encoding policy;
   - menerima `alg` dari token tanpa allowlist;
   - mencampur key untuk signing dan encryption;
   - menyamakan “punya public key” dengan “punya identity”;
   - menyimpan public key tanpa provenance;
   - melakukan signature verification pada format yang tidak dikanonikal.

4. Membuat wrapper Go yang:
   - explicit terhadap algorithm;
   - explicit terhadap key id;
   - explicit terhadap purpose;
   - explicit terhadap canonical message;
   - explicit terhadap verification failure;
   - siap untuk key rotation dan migration.

5. Mereview public-key design dari sisi:
   - threat model;
   - interoperability;
   - key lifecycle;
   - crypto agility;
   - compliance;
   - operational incident response.

---

## 2. Mental Model: Public-Key Cryptography Menyelesaikan Masalah Trust Distribution

Symmetric cryptography membutuhkan shared secret.

```mermaid
flowchart LR
    A[Service A] -- shared secret K --> B[Service B]
    B -- shared secret K --> A
```

Ini sederhana dan cepat, tetapi sulit diskalakan:

- bagaimana mendistribusikan secret ke banyak pihak?
- bagaimana membedakan siapa yang menandatangani pesan kalau semua pakai secret yang sama?
- bagaimana memberi verifier kemampuan memverifikasi tanpa kemampuan membuat signature?
- bagaimana membuat artifact yang bisa diverifikasi publik?
- bagaimana menghindari shared secret bocor di semua consumer?

Public-key cryptography memisahkan kemampuan:

```mermaid
flowchart LR
    Private[Private Key<br/>sign/decrypt] --> Public[Public Key<br/>verify/encrypt]
    Issuer[Issuer] -- signs artifact with private key --> Artifact[Signed Artifact]
    Verifier[Verifier] -- verifies with public key --> Artifact
```

Perbedaan terpenting:

| Kemampuan | Symmetric Key | Public/Private Key |
|---|---:|---:|
| Membuat MAC/signature | siapa pun yang punya key | hanya private key holder |
| Memverifikasi | siapa pun yang punya key | siapa pun yang punya public key |
| Key leakage blast radius | verifier juga bisa forge | verifier tidak bisa forge |
| Cocok untuk multi-verifier | kurang ideal | sangat ideal |
| Cocok untuk artifact publik | kurang ideal | ideal |
| Cocok untuk high-throughput small internal MAC | ideal | sering terlalu mahal |
| Cocok untuk confidentiality payload besar | ideal dengan AEAD | public-key hanya untuk key wrapping / hybrid |

**Invariant utama:** public-key cryptography memisahkan *authority to produce* dari *authority to verify*.

---

## 3. Taxonomy: Signing, Encryption, Key Agreement, Certificate

Public-key crypto sering rusak karena engineer mencampur empat konsep ini.

```mermaid
flowchart TD
    PKC[Public-Key Cryptography] --> Sign[Digital Signature]
    PKC --> Encrypt[Public-Key Encryption]
    PKC --> Agree[Key Agreement]
    PKC --> Cert[Certificate / PKI Identity]

    Sign --> S1[Private key signs]
    Sign --> S2[Public key verifies]
    Sign --> S3[Integrity + authenticity + non-repudiation-ish]

    Encrypt --> E1[Public key encrypts]
    Encrypt --> E2[Private key decrypts]
    Encrypt --> E3[Usually only for wrapping a data key]

    Agree --> K1[Both sides derive shared secret]
    Agree --> K2[ECDH / X25519]
    Agree --> K3[Used by TLS-like protocols]

    Cert --> C1[Public key bound to identity]
    Cert --> C2[Chain to trust anchor]
    Cert --> C3[Validity, usage, name, policy]
```

| Mechanism | Private key operation | Public key operation | Main security property |
|---|---|---|---|
| Digital signature | sign | verify | integrity + authenticity |
| Public-key encryption | decrypt | encrypt | confidentiality |
| Key agreement | derive shared secret | derive shared secret | confidential session key establishment |
| Certificate | CA signs binding | client verifies binding | identity binding |

**Jangan memakai signing untuk encryption. Jangan memakai encryption sebagai signature. Jangan menganggap certificate sama dengan signature. Jangan menganggap public key sama dengan identity.**

---

## 4. Algorithm Map di Go

Go standard library menyediakan beberapa package utama:

| Package | Fungsi utama |
|---|---|
| `crypto/rsa` | RSA encryption/signature: OAEP, PSS, PKCS#1 v1.5 legacy |
| `crypto/ecdsa` | ECDSA signature |
| `crypto/ed25519` | Ed25519 signature |
| `crypto/ecdh` | ECDH key agreement, dibahas lebih detail di part 010 |
| `crypto/x509` | parsing/marshalling key, certificate, CSR, revocation list |
| `encoding/pem` | PEM armor untuk DER bytes |
| `crypto` | common `Signer`, `Decrypter`, hash identifiers |
| `crypto/rand` | cryptographically secure randomness |

Ringkasan pilihan praktis:

| Kebutuhan | Pilihan modern yang disarankan |
|---|---|
| Signature baru untuk internal artifact/API | Ed25519 atau ECDSA P-256 tergantung interoperability/compliance |
| Signature RSA karena interoperability legacy | RSA-PSS, bukan PKCS#1 v1.5 untuk desain baru |
| Public-key encryption | RSA-OAEP untuk wrapping key; lebih sering pakai hybrid envelope |
| TLS identity | X.509 cert, TLS stack, jangan hand-roll protocol |
| Service-to-service identity modern | mTLS dengan cert lifecycle; part 015 |
| Token issuer verification | JWT/JWS dengan allowlist algorithm + issuer/audience/kid policy; part 016 |
| Key agreement | `crypto/ecdh`, X25519/P-256; part 010 |
| Compliance FIPS-heavy | cek Go FIPS mode, algorithm, module version, operating constraints; part 034 |

---

## 5. Security Properties yang Harus Dibedakan

### 5.1 Integrity

Pesan tidak berubah.

Hash bisa mendeteksi perubahan accidental jika hash trusted, tetapi hash tanpa key tidak membuktikan siapa pembuatnya.

```text
hash(message) == expectedHash
```

Masalahnya: siapa yang membuat `expectedHash`?

### 5.2 Authenticity

Pesan berasal dari pihak yang punya authority.

MAC memberi authenticity jika verifier juga punya shared secret.

Signature memberi authenticity dengan pemisahan producer/verifier.

```text
Verify(publicKey, message, signature) == true
```

Tetapi ini hanya benar jika:

- public key benar;
- public key memang milik issuer yang diharapkan;
- message canonical;
- algorithm sesuai policy;
- key belum revoked;
- signature belum expired/replayed;
- konteks signature benar.

### 5.3 Non-repudiation

Secara teknis, signature memberi bukti bahwa private key menandatangani message. Namun secara sistem, non-repudiation membutuhkan:

- private key custody;
- access control;
- audit trail;
- timestamp;
- key lifecycle;
- certificate/provenance;
- compromise handling;
- policy dan legal process.

Jangan klaim “non-repudiation” hanya karena memakai RSA/ECDSA/Ed25519.

### 5.4 Confidentiality

Public-key encryption memberi confidentiality terhadap pihak tanpa private key. Tetapi public-key encryption bukan alat yang tepat untuk mengenkripsi data besar. Biasanya:

1. generate random data encryption key;
2. encrypt data dengan AEAD;
3. wrap data key dengan public key/KMS;
4. simpan metadata key id, algorithm, version.

```mermaid
sequenceDiagram
    participant Sender
    participant RecipientPub as Recipient Public Key
    participant RecipientPriv as Recipient Private Key

    Sender->>Sender: Generate random data key
    Sender->>Sender: Encrypt payload with AEAD
    Sender->>RecipientPub: Encrypt/wrap data key
    Sender->>Storage: Store ciphertext + wrapped key + metadata
    RecipientPriv->>RecipientPriv: Decrypt/wrap data key
    RecipientPriv->>RecipientPriv: AEAD decrypt payload
```

---

## 6. RSA di Go

### 6.1 Mental Model RSA

RSA adalah primitive matematika umum yang bisa dipakai untuk encryption atau signature melalui scheme yang berbeda.

Yang penting: **RSA bukan satu algoritma siap pakai. RSA harus selalu dipasangkan dengan padding/scheme yang benar.**

| Use case | Scheme modern |
|---|---|
| RSA encryption | RSA-OAEP |
| RSA signature | RSA-PSS |
| Legacy encryption | RSA PKCS#1 v1.5 encryption, hindari untuk desain baru |
| Legacy signature | RSA PKCS#1 v1.5 signature, hindari untuk desain baru kalau bisa |

Go `crypto/rsa` sendiri menyatakan bahwa PKCS#1 v1.5 memiliki flaw dan desain baru sebaiknya memakai OAEP/PSS jika memungkinkan.

### 6.2 RSA Key Size

Untuk desain modern, gunakan minimal RSA 2048-bit jika interoperabilitas menuntut RSA, tetapi preferensi umum untuk sistem baru sering 3072-bit atau berpindah ke elliptic-curve signature jika memungkinkan.

Trade-off:

| Key | Security/performance |
|---|---|
| RSA-2048 | baseline minimum umum, interoperable, lebih cepat dari RSA-3072 |
| RSA-3072 | margin lebih baik, lebih lambat, signature lebih besar |
| RSA-4096 | signature besar, operasi lambat, sering tidak perlu untuk service high-throughput |
| Ed25519/ECDSA P-256 | signature lebih kecil, performa baik, key lebih kecil |

Keputusan bukan hanya “lebih besar lebih aman”. RSA key lebih besar meningkatkan CPU, latency, bandwidth, certificate size, dan cost.

### 6.3 RSA-PSS Signing di Go

Contoh wrapper minimal yang explicit terhadap purpose dan hash.

```go
package signing

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"errors"
)

var (
	ErrInvalidSignature = errors.New("invalid signature")
)

type RSAPSSSigner struct {
	KeyID string
	Key   *rsa.PrivateKey
}

func (s RSAPSSSigner) SignArtifact(canonical []byte) ([]byte, error) {
	if s.Key == nil {
		return nil, errors.New("missing RSA private key")
	}

	digest := sha256.Sum256(canonical)

	sig, err := rsa.SignPSS(
		rand.Reader,
		s.Key,
		crypto.SHA256,
		digest[:],
		&rsa.PSSOptions{
			SaltLength: rsa.PSSSaltLengthEqualsHash,
			Hash:       crypto.SHA256,
		},
	)
	if err != nil {
		return nil, err
	}

	return sig, nil
}

type RSAPSSVerifier struct {
	KeyID string
	Key   *rsa.PublicKey
}

func (v RSAPSSVerifier) VerifyArtifact(canonical []byte, sig []byte) error {
	if v.Key == nil {
		return errors.New("missing RSA public key")
	}

	digest := sha256.Sum256(canonical)

	err := rsa.VerifyPSS(
		v.Key,
		crypto.SHA256,
		digest[:],
		sig,
		&rsa.PSSOptions{
			SaltLength: rsa.PSSSaltLengthEqualsHash,
			Hash:       crypto.SHA256,
		},
	)
	if err != nil {
		return ErrInvalidSignature
	}

	return nil
}
```

Catatan penting:

- signed bytes harus canonical;
- hash harus sesuai signing scheme;
- `PSSOptions` harus dipolicy-kan, bukan dibiarkan berubah antar service;
- jangan expose detail error ke attacker;
- simpan `kid`, `alg`, `created_at`, `expires_at`, dan issuer metadata di envelope;
- jangan biarkan message memilih algorithm tanpa allowlist.

### 6.4 RSA-OAEP Encryption di Go

RSA-OAEP cocok untuk mengenkripsi **data kecil**, biasanya data key.

```go
package wrapping

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"errors"
)

type RSAOAEPWrapper struct {
	KeyID string
	Pub   *rsa.PublicKey
	Priv  *rsa.PrivateKey
	Label []byte
}

func (w RSAOAEPWrapper) WrapKey(dataKey []byte) ([]byte, error) {
	if w.Pub == nil {
		return nil, errors.New("missing RSA public key")
	}
	if len(dataKey) == 0 {
		return nil, errors.New("empty data key")
	}

	hash := sha256.New()
	return rsa.EncryptOAEP(hash, rand.Reader, w.Pub, dataKey, w.Label)
}

func (w RSAOAEPWrapper) UnwrapKey(wrapped []byte) ([]byte, error) {
	if w.Priv == nil {
		return nil, errors.New("missing RSA private key")
	}
	if len(wrapped) == 0 {
		return nil, errors.New("empty wrapped key")
	}

	hash := sha256.New()
	key, err := rsa.DecryptOAEP(hash, rand.Reader, w.Priv, wrapped, w.Label)
	if err != nil {
		return nil, errors.New("unwrap failed")
	}

	return key, nil
}
```

**Label** pada OAEP adalah associated context. Jika dipakai, harus sama saat encrypt/decrypt. Label bisa dipakai untuk domain separation:

```text
"acme.payments.v1.data-key"
"acme.audit.v1.data-key"
"acme.backup.v1.data-key"
```

Jangan gunakan RSA-OAEP untuk payload arbitrarily large. Gunakan envelope encryption.

### 6.5 RSA PKCS#1 v1.5

Untuk desain baru:

- hindari `rsa.EncryptPKCS1v15`;
- hindari `rsa.DecryptPKCS1v15`;
- hindari `rsa.SignPKCS1v15` jika bisa memakai PSS.

Namun realitas enterprise kadang membutuhkan compatibility dengan legacy protocol, smartcard, SAML, old partner, atau certificate infrastructure.

Policy yang sehat:

```text
PKCS#1 v1.5 hanya boleh muncul di compatibility layer,
bukan di domain code baru.
```

Checklist jika terpaksa:

- isolate dalam package `legacycrypto`;
- dokumentasikan protocol dan partner;
- gunakan constant-time/decryption-session mitigations sesuai library;
- tidak expose error detail;
- rate-limit decryption endpoint;
- punya migration plan;
- monitor usage;
- tidak reuse private key untuk scheme modern dan legacy jika bisa dihindari.

---

## 7. ECDSA di Go

### 7.1 Mental Model ECDSA

ECDSA adalah digital signature berbasis elliptic curve. Di Go, package `crypto/ecdsa` mengimplementasikan ECDSA sesuai FIPS 186-5.

ECDSA memberi signature lebih kecil dan performa lebih baik dibanding RSA besar, tetapi memiliki beberapa risiko operasional:

- randomness/signing nonce historically critical;
- encoding signature bisa ASN.1 DER atau raw `(r,s)`;
- malleability `(r, s)` vs `(r, n-s)` bisa menjadi masalah kalau protocol tidak canonical;
- curve harus berasal dari safe implementation;
- interoperability sering rumit karena format signature berbeda antar protocol.

Go 1.26 membawa perubahan penting: parameter random pada beberapa operasi ECDSA diabaikan dan Go menggunakan secure random source; ini mengurangi risiko caller memberi random source buruk.

### 7.2 ECDSA Key Generation

```go
package signing

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
)

func GenerateECDSAP256() (*ecdsa.PrivateKey, error) {
	return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
}
```

Gunakan curve dari:

- `elliptic.P256()`;
- `elliptic.P384()`;
- `elliptic.P521()`;
- `elliptic.P224()` hanya jika ada alasan compatibility; untuk desain baru biasanya P-256 atau P-384.

Jangan mengimplementasikan curve sendiri. Jangan memakai `CurveParams` methods untuk operasi custom.

### 7.3 ECDSA Sign/Verify ASN.1

```go
package signing

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"errors"
)

func SignECDSAASN1(priv *ecdsa.PrivateKey, canonical []byte) ([]byte, error) {
	if priv == nil {
		return nil, errors.New("missing ECDSA private key")
	}

	digest := sha256.Sum256(canonical)
	return ecdsa.SignASN1(nil, priv, digest[:])
}

func VerifyECDSAASN1(pub *ecdsa.PublicKey, canonical []byte, sig []byte) error {
	if pub == nil {
		return errors.New("missing ECDSA public key")
	}

	digest := sha256.Sum256(canonical)
	if !ecdsa.VerifyASN1(pub, digest[:], sig) {
		return errors.New("invalid signature")
	}
	return nil
}
```

Pada Go 1.26, random parameter pada `SignASN1` diabaikan dan secure source digunakan. Untuk Go lama, tetap gunakan `rand.Reader`.

### 7.4 ECDSA Encoding Problem

ECDSA signature secara matematis adalah pasangan angka `(r, s)`. Namun wire format bisa berbeda:

| Format | Umum dipakai di |
|---|---|
| ASN.1 DER | X.509, TLS, banyak Java/JCA usage |
| Raw concat `r || s` | JOSE/JWT ECDSA (`ES256`) |
| Custom JSON `{r,s}` | beberapa internal protocol, sebaiknya hindari |

Ini sumber bug besar untuk Java ↔ Go interoperability.

Java `Signature` biasanya menghasilkan DER untuk `SHA256withECDSA`. JOSE `ES256` memakai raw fixed-width concatenation, bukan DER.

Jadi pertanyaan review harus selalu:

```text
ECDSA signature format apa yang dipakai di wire?
```

Bukan hanya:

```text
Kita pakai ECDSA.
```

### 7.5 ECDSA Malleability

ECDSA dapat memiliki signature alternatif yang tetap valid tergantung protocol dan canonicalization policy. Banyak ecosystem menerapkan “low-S” canonicalization.

Jika signature dipakai sebagai unique identifier, cache key, dedup key, transaction id, atau audit proof, malleability menjadi serius.

Rule:

```text
Jangan gunakan signature bytes sebagai identity.
Gunakan digest canonical message sebagai identity.
```

Jika protocol membutuhkan strict canonical ECDSA, gunakan library/protocol yang mendefinisikan low-S rule dan verifikasi dengan policy tersebut. Jangan invent partial fix tanpa test vector.

---

## 8. Ed25519 di Go

### 8.1 Mental Model Ed25519

Ed25519 adalah digital signature modern berbasis EdDSA pada curve edwards25519. Di Go, `crypto/ed25519` mengimplementasikan Ed25519 dan compatible dengan RFC 8032. Private key operations diimplementasikan dengan constant-time algorithms.

Keunggulan praktis:

- key kecil;
- signature fixed 64 bytes;
- API sederhana;
- tidak perlu caller hashing manual untuk mode dasar;
- deterministic signing;
- performa bagus;
- lebih sedikit footgun dibanding ECDSA.

Trade-off:

- tidak semua compliance regime lama menerima Ed25519;
- tidak semua hardware/HSM lama mendukung Ed25519;
- FIPS usage perlu diperiksa terhadap Go FIPS module dan policy organisasi;
- beberapa protocol enterprise lama masih RSA/ECDSA-only.

### 8.2 Ed25519 Key Generation

```go
package signing

import (
	"crypto/ed25519"
	"crypto/rand"
)

func GenerateEd25519() (ed25519.PublicKey, ed25519.PrivateKey, error) {
	return ed25519.GenerateKey(rand.Reader)
}
```

Pada Go 1.26, jika random parameter ke `GenerateKey` nil, Go menggunakan secure source of cryptographically random bytes, bukan random source overrideable.

### 8.3 Ed25519 Sign/Verify

```go
package signing

import (
	"crypto/ed25519"
	"errors"
)

func SignEd25519(priv ed25519.PrivateKey, canonical []byte) ([]byte, error) {
	if len(priv) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid Ed25519 private key")
	}
	return ed25519.Sign(priv, canonical), nil
}

func VerifyEd25519(pub ed25519.PublicKey, canonical []byte, sig []byte) error {
	if len(pub) != ed25519.PublicKeySize {
		return errors.New("invalid Ed25519 public key")
	}
	if !ed25519.Verify(pub, canonical, sig) {
		return errors.New("invalid signature")
	}
	return nil
}
```

### 8.4 Ed25519 Context

Go juga mendukung `Options` untuk Ed25519 variants seperti context/prehash melalui `PrivateKey.Sign` dan `VerifyWithOptions`.

Context berguna untuk domain separation.

```go
sig, err := priv.Sign(nil, message, &ed25519.Options{
	Context: "acme.audit-log.v1",
})
if err != nil {
	return err
}

err = ed25519.VerifyWithOptions(pub, message, sig, &ed25519.Options{
	Context: "acme.audit-log.v1",
})
```

Jangan mencampur context antar domain. Jika context dipakai, jadikan bagian dari protocol version dan dokumentasi.

### 8.5 Ed25519 Seed vs Private Key

Go private key Ed25519 adalah 64 bytes dan menyertakan public key suffix untuk efisiensi. Seed RFC 8032 adalah 32 bytes.

Jangan mengira:

```text
len(privateKey) == 32
```

Di Go:

```go
len(priv) == ed25519.PrivateKeySize // 64
len(priv.Seed()) == ed25519.SeedSize // 32
```

Kesalahan ini sering muncul saat migrasi dari library lain atau saat menyimpan key di secret manager.

---

## 9. Signing vs Encryption: Kesalahan Klasik

### 9.1 “Encrypt with private key” bukan signature

Frasa lama “encrypt with private key” sering dipakai untuk menjelaskan signature secara informal. Ini misleading.

Signature bukan encryption. Signature scheme punya hashing, padding, domain rules, verification rules.

Jangan membuat desain seperti:

```text
signature = RSA_private_operation(message)
```

Gunakan RSA-PSS, ECDSA, atau Ed25519.

### 9.2 “Decrypt with public key” bukan verification

Verification bukan decryption. Untuk RSA PKCS#1 signature, memang ada operasi RSA publik di bawahnya, tetapi scheme-nya bukan “decrypt with public key”.

Mental model yang benar:

```text
Sign(private key, canonical message, algorithm policy) -> signature
Verify(public key, canonical message, signature, algorithm policy) -> valid/invalid
```

### 9.3 Public-key encryption bukan untuk data besar

RSA-OAEP memiliki limit ukuran plaintext tergantung key size dan hash. Payload aplikasi harus memakai envelope encryption.

Bad:

```text
rsa.EncryptOAEP(publicKey, fullJSONPayload)
```

Good:

```text
dataKey = random(32 bytes)
ciphertext = AES-GCM(dataKey, payload)
wrappedKey = RSA-OAEP(publicKey, dataKey)
```

---

## 10. Canonicalization Sebelum Signing

Signature memverifikasi bytes, bukan object semantic.

```mermaid
flowchart TD
    Obj[Domain Object] --> C[Canonicalization]
    C --> Bytes[Canonical Bytes]
    Bytes --> Sign[Sign]
    Sign --> Envelope[Signature Envelope]

    Obj2[Received Object] --> C2[Same Canonicalization]
    C2 --> Bytes2[Canonical Bytes]
    Bytes2 --> Verify[Verify with Public Key]
    Envelope --> Verify
```

Jika producer dan verifier melihat object yang sama tetapi menghasilkan bytes berbeda, signature gagal. Jika attacker bisa memanipulasi representasi tetapi canonicalization tidak ketat, signature bisa memverifikasi hal yang berbeda dari yang aplikasi pahami.

### 10.1 Contoh Masalah JSON

JSON object ini secara semantic mirip:

```json
{"amount":1000,"currency":"IDR"}
```

```json
{
  "currency": "IDR",
  "amount": 1000
}
```

Tetapi bytes berbeda.

Masalah lain:

- object key order;
- duplicate keys;
- whitespace;
- number representation `1`, `1.0`, `1e0`;
- Unicode normalization;
- null vs missing;
- unknown fields;
- case sensitivity;
- timestamp format;
- array ordering;
- binary encoding base64 variant.

Untuk signed JSON, jangan asal `json.Marshal` lalu berharap interoperable lintas bahasa. Buat canonicalization specification atau pakai standard seperti JCS jika sesuai kebutuhan.

### 10.2 Canonical Signing Envelope

Minimal envelope:

```json
{
  "version": 1,
  "alg": "Ed25519",
  "kid": "issuer-a-2026-01",
  "issuer": "issuer-a",
  "issued_at": "2026-06-24T00:00:00Z",
  "expires_at": "2026-06-25T00:00:00Z",
  "payload_hash_alg": "SHA-256",
  "payload_hash": "base64url...",
  "signature": "base64url..."
}
```

Tetapi envelope sendiri juga harus punya aturan:

- field mana yang signed;
- field mana yang metadata transport;
- apakah `alg` signed;
- apakah `kid` signed;
- apakah `issuer` signed;
- apakah expiration signed;
- bagaimana canonical bytes dibuat;
- bagaimana unknown fields diperlakukan;
- apakah duplicate fields rejected;
- apakah verifier boleh fallback algorithm.

### 10.3 Safe Principle

```text
Sign exactly what the business decision uses.
Verify before making the business decision.
Bind signature to context, issuer, audience, and version.
```

---

## 11. Algorithm Confusion

Algorithm confusion terjadi ketika attacker membuat verifier memakai algorithm yang tidak dimaksud.

Contoh klasik di token ecosystem:

- issuer memakai asymmetric signing;
- verifier menerima `alg` dari header token;
- attacker mengganti `alg` ke symmetric mode;
- public key dipakai sebagai HMAC secret;
- token forged.

Prinsip:

```text
Algorithm is policy, not user input.
```

Bad:

```go
alg := token.Header["alg"]
verifyWithAlg(alg, key, token)
```

Good:

```go
policy := IssuerPolicy{
	Issuer: "https://issuer.example",
	AllowedAlgorithms: []Algorithm{AlgEd25519},
	KeySet: trustedKeys,
}
verifyWithPolicy(policy, token)
```

Dalam desain internal, header `alg` boleh menjadi metadata, tetapi verifier tetap harus mencocokkan dengan allowlist policy berdasarkan issuer/key id.

---

## 12. Key Identity: `kid` Bukan Trust

`kid` hanya key identifier.

`kid` bukan bukti bahwa key trusted.

```mermaid
flowchart LR
    Token[Token header kid=abc] --> Lookup[Key Lookup]
    Lookup --> Key[Public Key]
    Key --> Policy[Issuer Policy]
    Policy --> Verify[Verify Signature]
```

Bahaya:

- attacker memilih `kid` yang menunjuk key miliknya;
- verifier auto-fetch JWKS dari URL attacker;
- verifier menerima unknown key;
- key cache poisoning;
- `kid` path traversal jika dipakai sebagai filename;
- `kid` SQL injection jika query raw;
- `kid` collision antar tenant;
- fallback ke default key.

Policy aman:

```text
issuer + kid + algorithm + purpose + validity window + provenance
```

Bukan hanya:

```text
kid -> public key
```

Contoh model:

```go
type PublicKeyRecord struct {
	Issuer       string
	KeyID        string
	Algorithm    string
	Purpose      string
	NotBefore    time.Time
	NotAfter     time.Time
	PublicKeyDER []byte
	Source       string // pinned config, cert chain, JWKS URL allowlist, KMS metadata
}
```

---

## 13. Key Formats di Go

### 13.1 DER vs PEM

DER adalah binary ASN.1 encoding. PEM adalah base64 armor dengan header/footer.

```text
-----BEGIN PRIVATE KEY-----
base64 DER
-----END PRIVATE KEY-----
```

Go biasanya parse DER dengan `crypto/x509`, dan PEM decode dengan `encoding/pem`.

### 13.2 Private Key Format

| Format | Common PEM block | Isi |
|---|---|---|
| PKCS#1 private key | `RSA PRIVATE KEY` | RSA-specific private key |
| SEC 1 EC private key | `EC PRIVATE KEY` | ECDSA/EC-specific private key |
| PKCS#8 private key | `PRIVATE KEY` | generic private key container |

Preferensi untuk sistem baru:

```text
PKCS#8 untuk private key.
PKIX SubjectPublicKeyInfo untuk public key.
```

Karena lebih generic dan memudahkan migrasi algorithm.

### 13.3 Public Key Format

| Format | Common PEM block | Isi |
|---|---|---|
| PKIX SubjectPublicKeyInfo | `PUBLIC KEY` | generic public key |
| PKCS#1 RSA public key | `RSA PUBLIC KEY` | RSA-specific public key |

Gunakan `x509.ParsePKIXPublicKey` untuk public key generic.

### 13.4 Parsing PEM Private Key

```go
package keyio

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
)

func ParsePrivateKeyPEM(pemBytes []byte) (any, error) {
	block, rest := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("missing PEM block")
	}
	if len(rest) != 0 {
		return nil, errors.New("trailing data after PEM block")
	}

	switch block.Type {
	case "PRIVATE KEY":
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		switch k := key.(type) {
		case *rsa.PrivateKey:
			if err := k.Validate(); err != nil {
				return nil, err
			}
			return k, nil
		case *ecdsa.PrivateKey:
			return k, nil
		case ed25519.PrivateKey:
			if len(k) != ed25519.PrivateKeySize {
				return nil, errors.New("invalid Ed25519 private key size")
			}
			return k, nil
		default:
			return nil, errors.New("unsupported private key type")
		}

	case "RSA PRIVATE KEY":
		key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		if err := key.Validate(); err != nil {
			return nil, err
		}
		return key, nil

	case "EC PRIVATE KEY":
		return x509.ParseECPrivateKey(block.Bytes)

	default:
		return nil, errors.New("unsupported PEM block type")
	}
}
```

Important review points:

- reject trailing PEM data;
- validate RSA private key;
- do not accept encrypted PEM silently if your parser does not support it;
- do not log key bytes;
- do not load private keys from untrusted paths;
- use strict file permissions;
- separate production/test keys;
- avoid hot-reload key replacement without policy.

### 13.5 Parsing PEM Public Key

```go
package keyio

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
)

func ParsePublicKeyPEM(pemBytes []byte) (any, error) {
	block, rest := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("missing PEM block")
	}
	if len(rest) != 0 {
		return nil, errors.New("trailing data after PEM block")
	}

	switch block.Type {
	case "PUBLIC KEY":
		key, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		switch k := key.(type) {
		case *rsa.PublicKey, *ecdsa.PublicKey, ed25519.PublicKey:
			return k, nil
		default:
			return nil, errors.New("unsupported public key type")
		}

	case "RSA PUBLIC KEY":
		return x509.ParsePKCS1PublicKey(block.Bytes)

	default:
		return nil, errors.New("unsupported PEM block type")
	}
}
```

### 13.6 Key Format Java ↔ Go Mapping

| Java concept | Go equivalent |
|---|---|
| `PKCS8EncodedKeySpec` | `x509.ParsePKCS8PrivateKey` |
| `X509EncodedKeySpec` | `x509.ParsePKIXPublicKey` |
| `KeyPairGenerator.getInstance("RSA")` | `rsa.GenerateKey` |
| `KeyPairGenerator.getInstance("EC")` | `ecdsa.GenerateKey` |
| `Signature.getInstance("SHA256withRSA/PSS")` | `rsa.SignPSS` / `rsa.VerifyPSS` |
| `Signature.getInstance("SHA256withECDSA")` | `ecdsa.SignASN1` / `ecdsa.VerifyASN1` |
| `Signature.getInstance("Ed25519")` | `ed25519.Sign` / `ed25519.Verify` |
| `Cipher RSA OAEP` | `rsa.EncryptOAEP` / `rsa.DecryptOAEP` |
| `CertificateFactory X.509` | `x509.ParseCertificate` |

---

## 14. Signature Envelope Design

A signature should rarely travel alone. It should travel with metadata required to verify it safely.

### 14.1 Minimal Binary/JSON Envelope

```go
type SignatureEnvelope struct {
	Version   int       `json:"version"`
	Issuer    string    `json:"issuer"`
	KeyID     string    `json:"kid"`
	Alg       string    `json:"alg"`
	Purpose   string    `json:"purpose"`
	IssuedAt  time.Time `json:"issued_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Sig       string    `json:"sig"`
}
```

But the actual signed bytes should include domain context:

```go
type SigningContext struct {
	Version  int
	Issuer   string
	KeyID    string
	Alg      string
	Purpose  string
	Audience string
	Method   string
	Path     string
	BodyHash []byte
}
```

### 14.2 What Should Be Signed?

Usually sign:

- protocol version;
- issuer;
- audience;
- purpose;
- key id or equivalent key binding;
- timestamp;
- expiry;
- nonce/request id if replay matters;
- HTTP method/path/query canonical form if request signing;
- body hash;
- critical headers;
- content type;
- tenant id;
- authorization scope if relevant.

Do not sign only raw body if business decision also depends on URL, method, tenant, or headers.

### 14.3 Domain Separation

Same key used in multiple contexts is risky. Even better: use separate keys per purpose. If not possible, include domain separation string.

```text
"acme.payment.request-signing.v1"
"acme.audit.event-signing.v1"
"acme.release.artifact-signing.v1"
```

---

## 15. Public Key as Identity: Dangerous Shortcut

Public key can be an identifier, but it is not automatically an identity.

Questions:

- who generated this key?
- how was it registered?
- who approved it?
- what tenant/service/user does it represent?
- what purpose is allowed?
- when is it valid?
- how is it revoked?
- where is compromise recorded?
- how are old signatures handled after revocation?
- can the same key be reused across environments?

A mature key registry includes:

```go
type KeyPurpose string

const (
	PurposeArtifactSigning KeyPurpose = "artifact-signing"
	PurposeWebhookSigning  KeyPurpose = "webhook-signing"
	PurposeTokenSigning    KeyPurpose = "token-signing"
	PurposeDataKeyWrapping KeyPurpose = "data-key-wrapping"
)

type TrustState string

const (
	TrustActive     TrustState = "active"
	TrustDeprecated TrustState = "deprecated"
	TrustRevoked    TrustState = "revoked"
)

type TrustedPublicKey struct {
	Issuer       string
	KeyID        string
	Algorithm    string
	Purpose      KeyPurpose
	State        TrustState
	NotBefore    time.Time
	NotAfter     time.Time
	RevokedAt    *time.Time
	PublicKeyDER []byte
	Fingerprint  string
	Source       string
}
```

Verification must check trust state, not just crypto validity.

---

## 16. Key Rotation Strategy

### 16.1 Rotation Phases

```mermaid
stateDiagram-v2
    [*] --> Created
    Created --> Published
    Published --> ActiveSigning
    ActiveSigning --> VerifyOnly
    VerifyOnly --> Retired
    VerifyOnly --> Revoked
    ActiveSigning --> Revoked
    Retired --> [*]
    Revoked --> [*]
```

| Phase | Signing allowed | Verification allowed |
|---|---:|---:|
| Created | no | no |
| Published | no | maybe pre-cache only |
| ActiveSigning | yes | yes |
| VerifyOnly | no | yes |
| Retired | no | no, except archived/legal process |
| Revoked | no | policy-dependent, usually deny new trust |

### 16.2 Rolling Rotation

Process:

1. generate new key;
2. publish public key to verifiers;
3. wait for propagation;
4. start signing with new key;
5. continue verifying old key;
6. expire old signed artifacts;
7. move old key to verify-only;
8. retire after retention window.

### 16.3 Emergency Rotation

Emergency rotation after suspected private key compromise:

1. disable signing with old key;
2. publish revocation;
3. rotate issuer metadata;
4. invalidate tokens/artifacts if possible;
5. shorten cache TTL;
6. audit all signatures produced in compromise window;
7. notify relying parties;
8. preserve forensic material;
9. create post-incident prevention tasks.

### 16.4 Common Rotation Failure

| Failure | Impact |
|---|---|
| Verifier cache TTL too long | new signatures fail |
| Old key removed too soon | valid old artifacts fail |
| No `kid` | cannot identify key |
| Same `kid` reused | ambiguous verification |
| `kid` not scoped by issuer | cross-issuer collision |
| Algorithm changed without version | interoperability break |
| Revoked key still accepted | compromise persists |
| Signing service and verifier use different clocks | false expiry/replay failures |

---

## 17. Migration Strategy

### 17.1 From RSA PKCS#1 v1.5 Signature to RSA-PSS

Recommended migration:

```mermaid
flowchart TD
    A[Current: RS256 / PKCS1v15] --> B[Add verifier support for PSS]
    B --> C[Publish new key with alg PS256]
    C --> D[Dual-verify old and new]
    D --> E[Start signing new artifacts with PSS]
    E --> F[Observe error rate]
    F --> G[Expire old artifacts]
    G --> H[Disable legacy signing]
    H --> I[Remove legacy verification after retention]
```

Rules:

- never silently reinterpret old signature as new scheme;
- use new `kid`;
- make `alg` explicit;
- track metrics by algorithm;
- keep rollback window;
- have artifact expiry.

### 17.2 From RSA to Ed25519/ECDSA

Migration needs ecosystem support:

- do verifiers support Ed25519?
- do certificates support needed algorithm?
- does HSM/KMS support it?
- does compliance allow it?
- does token/library ecosystem support it?
- are clients old Java versions?
- are API gateways compatible?

Strategy:

```text
new issuer key + new alg + dual verification + staged signing + old artifact expiry
```

Do not reuse the same key id.

### 17.3 From ECDSA DER to JOSE Raw

If migrating Java DER ECDSA to JWT/JWS ES256 raw signature:

- understand DER `(r,s)` parsing;
- convert to fixed-width raw `r||s`;
- enforce low-S if protocol requires;
- use established JOSE library;
- do not write custom parser unless absolutely necessary.

---

## 18. Key Storage and Custody

### 18.1 Private Key Storage Options

| Storage | Pros | Risks |
|---|---|---|
| Local file | simple | filesystem compromise, accidental commit |
| Environment variable | easy deployment | leaked via process/env dump/log/debug |
| Kubernetes Secret | standard | base64 not encryption, RBAC/etcd risk |
| Cloud Secret Manager | audit/rotation controls | app still receives key material |
| KMS/HSM signing | private key non-exportable | latency, availability, API limits |
| TPM/smartcard | strong custody | operational complexity |

For high-trust signing, prefer non-exportable keys through KMS/HSM when feasible.

### 18.2 Key Material in Go Memory

Go cannot guarantee perfect zeroization of heap data because garbage collector, copies, stack movement, and compiler optimizations can create copies.

Practical controls:

- minimize lifetime of private key bytes;
- parse once at startup if needed;
- restrict debug endpoints;
- avoid logging;
- avoid `fmt.Printf("%+v", key)`;
- avoid exposing pprof in production;
- prefer KMS/HSM for high-value signing;
- isolate signing service;
- use least privilege and separate runtime identity;
- prevent core dumps if possible.

### 18.3 Signing Service Boundary

For important systems, avoid giving every service the private key.

```mermaid
flowchart LR
    App1[App Service] --> SignAPI[Signing Service]
    App2[Batch Service] --> SignAPI
    SignAPI --> KMS[KMS/HSM/Private Key]
    SignAPI --> Audit[Signing Audit Log]
```

Benefits:

- centralized audit;
- key custody isolation;
- rate limit signing;
- policy enforcement;
- easier revocation;
- fewer places where key can leak.

Risk:

- signing service becomes high-value target;
- availability dependency;
- must strongly authenticate callers;
- must bind signing purpose and prevent generic signing oracle.

**Do not build a generic “sign any bytes” endpoint without strict policy.**

---

## 19. Signing Oracle Risk

A signing oracle is a service that signs attacker-chosen bytes. Even with strong algorithms, this can be dangerous.

Questions:

- can attacker get service to sign arbitrary canonical bytes?
- can signed bytes be replayed in another context?
- is there domain separation?
- is purpose signed?
- is audience signed?
- is method/path signed?
- are critical fields immutable?
- are there templates, not arbitrary bytes?
- is there an approval workflow for high-value signatures?

Bad signing API:

```http
POST /sign
{
  "bytes": "base64..."
}
```

Better signing API:

```http
POST /sign-payment-approval
{
  "payment_id": "...",
  "amount": "1000.00",
  "currency": "IDR",
  "beneficiary_id": "...",
  "approval_id": "..."
}
```

The service constructs canonical bytes from validated domain object.

---

## 20. Verification Failure Handling

Verification failure should be:

- non-oracular;
- observable;
- actionable for operators;
- not too verbose to attacker.

Bad:

```json
{
  "error": "RSA PSS salt length mismatch for kid issuer-a-2026-01"
}
```

Better external response:

```json
{
  "error": "invalid_signature"
}
```

Internal structured log:

```json
{
  "event": "signature_verification_failed",
  "issuer": "issuer-a",
  "kid": "issuer-a-2026-01",
  "alg": "Ed25519",
  "reason_class": "cryptographic_verification_failed",
  "request_id": "...",
  "tenant_id": "...",
  "source_ip_class": "external",
  "artifact_type": "payment_instruction"
}
```

Do not log:

- full token;
- signature;
- private key;
- full payload if sensitive;
- secret-bearing headers.

---

## 21. Replay Resistance

Signature alone does not prevent replay.

An attacker can capture:

```text
message + signature
```

and send it again.

Replay defense requires protocol fields:

- timestamp;
- expiry;
- nonce;
- unique request id;
- sequence number;
- audience;
- method/path;
- body hash;
- idempotency key;
- replay cache.

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant ReplayCache

    Client->>Server: signed request with nonce + timestamp
    Server->>Server: verify signature
    Server->>Server: check timestamp window
    Server->>ReplayCache: insert nonce if absent
    alt nonce new
        Server->>Client: accepted
    else nonce seen
        Server->>Client: replay rejected
    end
```

Replay cache design:

- key: issuer + kid + nonce/request id;
- TTL: max accepted clock skew + request lifetime;
- storage: Redis or local+distributed depending criticality;
- failure mode: fail closed for high-risk transactions, degraded policy for low-risk telemetry;
- metrics: replay attempts, cache unavailable, clock skew failures.

---

## 22. Public-Key Encryption Design

### 22.1 Hybrid Envelope Example

```go
type EncryptedEnvelope struct {
	Version        int    `json:"version"`
	WrapAlg        string `json:"wrap_alg"` // RSA-OAEP-SHA256
	ContentAlg     string `json:"content_alg"` // AES-256-GCM
	KeyID          string `json:"kid"`
	WrappedDataKey string `json:"wrapped_data_key"`
	Nonce          string `json:"nonce"`
	AAD            string `json:"aad"`
	Ciphertext     string `json:"ciphertext"`
}
```

AAD should bind metadata:

```text
version
wrap_alg
content_alg
kid
tenant
object_type
object_id
```

If AAD is not bound, attacker may move ciphertext between contexts.

### 22.2 Decryption Failure

Decryption failure must not leak:

- whether key id exists;
- whether OAEP padding failed;
- whether AEAD tag failed;
- whether tenant mismatch happened.

External:

```text
decryption failed
```

Internal:

```text
reason_class = key_not_found | unwrap_failed | aead_failed | aad_mismatch
```

---

## 23. Certificates Are Not Just Public Keys

X.509 certificate binds public key to identity and constraints.

Part 013 and 014 will go deep into X.509/TLS, but here is the public-key intersection.

A certificate contains:

- subject;
- subject alternative names;
- public key;
- issuer;
- validity window;
- key usage;
- extended key usage;
- signature by issuer;
- policies/extensions.

Do not parse cert just to extract public key and skip validation unless your protocol intentionally pins the cert/public key through another trust mechanism.

Bad:

```go
cert, _ := x509.ParseCertificate(der)
pub := cert.PublicKey
verifySignature(pub, msg, sig)
```

This ignores:

- expiry;
- issuer trust;
- name;
- usage;
- revocation policy;
- chain;
- path constraints.

---

## 24. Public-Key Cryptography in API Architecture

### 24.1 Webhook Signature

Webhook signing usually needs:

- shared secret HMAC for simple bilateral integration; or
- public-key signature for many receivers/public verification.

If using public-key signature:

```text
issuer signs: timestamp + method + path + body hash + event id + audience
receiver verifies with pinned public key/JWKS
receiver checks timestamp and event id replay
```

### 24.2 Artifact Signing

Examples:

- release artifact;
- migration script;
- policy bundle;
- configuration bundle;
- audit export;
- legal document;
- model/package file.

Artifact signing should bind:

- artifact digest;
- artifact type;
- artifact version;
- build provenance;
- signer identity;
- timestamp;
- certificate/key id;
- signature algorithm;
- environment.

### 24.3 Inter-Service Request Signing

Often inferior to mTLS for service identity, but useful when:

- async forwarding crosses proxies;
- message needs to remain verifiable after transport;
- request passes through untrusted queues;
- third-party gateway cannot do mTLS end-to-end.

But if you sign HTTP request, include:

- method;
- canonical path;
- canonical query;
- selected headers;
- body hash;
- timestamp;
- nonce;
- audience/service name.

---

## 25. Performance and Capacity

Public-key operations are more expensive than HMAC/AEAD.

General shape:

| Operation | Relative cost |
|---|---|
| HMAC verify | very low |
| Ed25519 verify/sign | low/moderate |
| ECDSA verify/sign | moderate |
| RSA verify | often cheaper than RSA sign |
| RSA sign/decrypt | expensive |
| RSA large key | increasingly expensive |

Engineering implications:

- do not verify signature repeatedly inside inner loops;
- cache verified artifact result carefully by digest;
- rate-limit unauthenticated signature verification endpoints;
- bound input size before verification;
- avoid RSA signing per high-QPS request if Ed25519/HMAC/mTLS would fit;
- use batch verification only if algorithm/library safely supports it; standard Go APIs do not expose generic batch verify.

---

## 26. Testing Strategy

### 26.1 Unit Tests

Test:

- valid signature;
- wrong message;
- wrong key;
- wrong algorithm;
- wrong purpose;
- expired signature;
- future `issued_at`;
- unknown `kid`;
- revoked key;
- malformed signature;
- truncated signature;
- duplicate JSON fields if parser handles raw JSON;
- canonicalization stability;
- cross-language test vector.

### 26.2 Golden Test Vectors

Store test vectors:

```text
canonical bytes
public key
private key for test only
signature
algorithm
expected result
```

Never use production keys.

### 26.3 Fuzzing

Fuzz:

- signature envelope parser;
- canonicalization;
- PEM parser;
- DER parser wrapper;
- `kid` lookup input;
- timestamp parser;
- base64url decoder.

Fuzz target should not require private keys for every input. It should check parser safety and no panic.

```go
func FuzzParseSignatureEnvelope(f *testing.F) {
	f.Add([]byte(`{"version":1,"alg":"Ed25519","kid":"k1","sig":"abc"}`))

	f.Fuzz(func(t *testing.T, input []byte) {
		_, _ = ParseSignatureEnvelope(input)
	})
}
```

### 26.4 Cross-Language Tests

For Java ↔ Go:

- Java signs, Go verifies;
- Go signs, Java verifies;
- RSA-PSS salt length agreement;
- ECDSA DER vs raw agreement;
- Ed25519 key format agreement;
- PEM/DER format agreement;
- canonical JSON agreement;
- timezone/timestamp agreement.

---

## 27. Observability

Metrics:

```text
signature_verify_total{issuer,alg,result}
signature_verify_latency_seconds{issuer,alg}
signature_key_lookup_total{issuer,result}
signature_unknown_kid_total{issuer}
signature_expired_total{issuer}
signature_replay_rejected_total{issuer}
signature_algorithm_rejected_total{issuer,alg}
signing_request_total{purpose,result}
signing_request_latency_seconds{purpose,alg}
```

Logs:

- `issuer`;
- `kid`;
- `alg`;
- `purpose`;
- `artifact_type`;
- `reason_class`;
- `request_id`;
- `tenant_id`;
- `source`;
- not full payload/signature/key.

Alerts:

- spike in invalid signatures;
- unknown `kid`;
- revoked key usage;
- old algorithm usage after migration deadline;
- signing volume anomaly;
- KMS/HSM signing errors;
- key lookup cache poisoning indicators;
- replay attempts.

---

## 28. Secure Design Checklist

### Algorithm

- [ ] Algorithm is selected by server-side policy, not attacker-controlled input.
- [ ] RSA designs use OAEP for encryption and PSS for new signatures.
- [ ] ECDSA protocol defines signature encoding.
- [ ] Ed25519 usage checks compliance/interoperability needs.
- [ ] Legacy algorithms are isolated and tracked.
- [ ] Hash function is explicit and modern.

### Key

- [ ] Key has id, issuer, purpose, validity, state.
- [ ] Key id is scoped by issuer/tenant.
- [ ] Private key is not copied across services unnecessarily.
- [ ] Key storage and access are audited.
- [ ] Rotation lifecycle is defined.
- [ ] Revocation behavior is defined.
- [ ] Test keys cannot be accepted in production.

### Message

- [ ] Canonicalization is specified.
- [ ] Signed bytes match business decision.
- [ ] Purpose/audience/version are bound.
- [ ] Timestamp/expiry are bound if freshness matters.
- [ ] Replay defense exists if message can be replayed.
- [ ] Unknown/duplicate fields are handled intentionally.

### Verification

- [ ] Verify before action.
- [ ] Failure is fail-closed for security-critical path.
- [ ] Error response does not leak verification details.
- [ ] Metrics/logs preserve operational diagnosability.
- [ ] Verification checks key trust state, not just crypto validity.
- [ ] Public key provenance is known.

### Operations

- [ ] Key rotation is rehearsed.
- [ ] Emergency revocation runbook exists.
- [ ] Dependency/vulnerability scanning is active.
- [ ] Fuzz tests cover parsers/canonicalization.
- [ ] Cross-language test vectors exist where relevant.
- [ ] Security review covers signing oracle risk.

---

## 29. Common Anti-Patterns

### 29.1 `alg` From Input

```text
Input says alg=none/HS256/RS256, verifier follows blindly.
```

Fix: policy allowlist per issuer.

### 29.2 `kid` Used as Filename

```go
path := "/keys/" + kid + ".pem"
```

Risk: path traversal, key confusion.

Fix: key registry lookup with strict identifier validation.

### 29.3 Signing Pretty JSON

```go
json.MarshalIndent(obj, "", "  ")
```

Risk: non-canonical, language-dependent.

Fix: defined canonicalization.

### 29.4 Signature as Database ID

Risk: ECDSA malleability, algorithm migration breakage.

Fix: digest canonical payload or domain ID.

### 29.5 One Key for Everything

```text
same key signs JWT, webhook, audit events, release artifacts
```

Risk: cross-protocol confusion and large blast radius.

Fix: separate keys/purpose/domain separation.

### 29.6 Public Key Auto-Discovery From Untrusted Token

Risk: attacker supplies `jku`, `x5u`, or similar remote key URL.

Fix: pinned issuer metadata and allowlisted JWKS URL.

### 29.7 RSA Encrypting Full Payload

Risk: size limit, misuse, lack of AEAD metadata binding.

Fix: hybrid envelope encryption.

### 29.8 Logging Verification Inputs

Risk: token/signature/payload leakage.

Fix: log metadata and reason class only.

---

## 30. Java Engineer Translation Layer

### 30.1 API Difference

Java often hides algorithm details behind strings:

```java
Signature.getInstance("SHA256withRSA/PSS")
```

Go tends to make details explicit:

```go
rsa.SignPSS(rand.Reader, priv, crypto.SHA256, digest, opts)
```

This explicitness is good for review. But you must define your own policy object rather than scattering algorithm choices across code.

### 30.2 Provider vs Standard Library

Java security behavior may depend on provider:

- SunRsaSign;
- SunEC;
- Bouncy Castle;
- PKCS#11 provider;
- cloud HSM provider.

Go standard library behavior is more uniform, but HSM/KMS integration often happens through external service APIs or interfaces like `crypto.Signer`.

### 30.3 `crypto.Signer`

`crypto.Signer` is useful for abstracting signing key source:

- local private key;
- KMS signer;
- HSM signer;
- mock signer.

```go
type SigningKey struct {
	KeyID  string
	Alg    string
	Signer crypto.Signer
}
```

But abstraction should not hide policy. The caller must still know algorithm, hash, purpose, and envelope.

---

## 31. Production Reference Architecture

```mermaid
flowchart TD
    subgraph Producer
        Domain[Domain Object]
        Validate[Validate Business Rules]
        Canon[Canonicalize]
        SignClient[Signing Client]
    end

    subgraph SigningBoundary
        Policy[Signing Policy]
        Signer[Signing Service]
        KeyStore[KMS/HSM or Private Key Store]
        SignAudit[Signing Audit Log]
    end

    subgraph Consumer
        Parse[Parse Envelope]
        KeyLookup[Trusted Key Registry]
        Verify[Verify Signature]
        Freshness[Check Freshness / Replay]
        Decide[Business Decision]
    end

    Domain --> Validate --> Canon --> SignClient
    SignClient --> Policy --> Signer --> KeyStore
    Signer --> SignAudit
    Signer --> Envelope[Signed Envelope]
    Envelope --> Parse --> KeyLookup --> Verify --> Freshness --> Decide
```

Important boundary:

- producer validates domain object;
- signing service signs only known purpose;
- verifier checks key trust and freshness;
- business decision happens only after verification;
- audit trail records signing operation and verification failures without leaking secrets.

---

## 32. Mini Case Study: Signed Regulatory Decision Event

Context:

A regulatory system emits decision events:

```json
{
  "case_id": "CASE-2026-0001",
  "decision": "SUSPEND_LICENSE",
  "effective_date": "2026-07-01",
  "issued_by": "compliance-director",
  "issued_at": "2026-06-24T10:00:00Z"
}
```

Security requirements:

- downstream systems must verify event came from authority;
- event must not be tampered with;
- replay of old decision must be detected;
- event must be auditable;
- key rotation must not break historical verification.

Design:

1. Canonicalize event using strict schema.
2. Include:
   - event id;
   - case id;
   - decision;
   - issuer;
   - issued_at;
   - expires_at or validity semantics;
   - schema version;
   - purpose `regulatory-decision-event.v1`.
3. Sign with Ed25519 or ECDSA/RSA depending compliance.
4. Store signature envelope beside event.
5. Consumer verifies:
   - issuer is trusted;
   - key is active/verify-only;
   - signature valid;
   - event id not replayed in inappropriate context;
   - schema version supported.
6. Audit verification outcome.

Bad design:

```text
sign only case_id + decision
```

because attacker may move signature to different effective date, issuer, or schema context.

Better:

```text
sign canonical full decision command, including purpose and version
```

---

## 33. What Not to Build Yourself

Do not implement:

- RSA padding;
- ECDSA arithmetic;
- Ed25519 arithmetic;
- ASN.1 DER parser;
- certificate path validation;
- JOSE/JWT parser;
- TLS;
- random number generator;
- constant-time big integer arithmetic;
- custom canonical JSON unless you can define/test it rigorously;
- generic signing oracle.

Build instead:

- policy wrapper;
- envelope schema;
- key registry;
- rotation workflow;
- canonicalization around your domain;
- safe integration with standard libraries;
- tests and observability.

---

## 34. Source Notes

Primary references used while preparing this part:

1. Go `crypto/rsa` package documentation:  
   `https://pkg.go.dev/crypto/rsa`

2. Go `crypto/ecdsa` package documentation:  
   `https://pkg.go.dev/crypto/ecdsa`

3. Go `crypto/ed25519` package documentation:  
   `https://pkg.go.dev/crypto/ed25519`

4. Go `crypto/x509` package documentation:  
   `https://pkg.go.dev/crypto/x509`

5. Go `crypto/elliptic` package documentation:  
   `https://pkg.go.dev/crypto/elliptic`

6. Go 1.26 release notes:  
   `https://go.dev/doc/go1.26`

7. RFC 8017 — PKCS #1: RSA Cryptography Specifications Version 2.2:  
   `https://datatracker.ietf.org/doc/html/rfc8017`

8. RFC 8032 — Edwards-Curve Digital Signature Algorithm:  
   `https://datatracker.ietf.org/doc/html/rfc8032`

9. NIST FIPS 186-5 — Digital Signature Standard:  
   `https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf`

10. Go security best practices:  
    `https://go.dev/doc/security/best-practices`

---

## 35. Ringkasan

Public-key cryptography di Go harus dipahami sebagai **trust architecture**, bukan sekadar package crypto.

Key points:

- Signature membuktikan private key holder menandatangani canonical bytes.
- Encryption dengan public key biasanya hanya untuk wrapping key.
- RSA harus memakai OAEP/PSS untuk desain baru.
- ECDSA membutuhkan perhatian terhadap encoding dan malleability.
- Ed25519 adalah pilihan modern yang sederhana, tetapi interoperability/compliance harus dicek.
- Public key bukan identity kecuali ada trust binding.
- `kid` bukan trust; `alg` bukan input bebas.
- Canonicalization adalah bagian dari security.
- Key rotation harus didesain sejak awal.
- Verification harus memeriksa trust state, purpose, issuer, audience, freshness, dan replay — bukan hanya signature math.

---

## 36. Transisi ke Part 010

Part berikutnya:

```text
learn-go-security-cryptography-integrity-part-010.md
```

Topik:

```text
Key agreement, ECDH, hybrid encryption, envelope encryption, KEM mental model,
forward secrecy, session key derivation, and key separation.
```

Kita akan melanjutkan dari public-key signing/encryption menuju **key agreement**: bagaimana dua pihak membentuk shared secret, kenapa ECDH bukan “encrypt/decrypt”, bagaimana TLS-like protocols mendapatkan forward secrecy, dan bagaimana mendesain key derivation yang tidak mencampur purpose.

---

```text
Progress:
[done] part-000
[done] part-001
[done] part-002
[done] part-003
[done] part-004
[done] part-005
[done] part-006
[done] part-007
[done] part-008
[done] part-009
[next] part-010
[remaining] part-011 sampai part-034
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-security-cryptography-integrity-part-008.md">⬅️ Go Security, Cryptography, Integrity — Part 008</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-security-cryptography-integrity-part-010.md">Part 010 — Key Agreement, ECDH, Hybrid Encryption, Envelope Encryption, KEM Mental Model, Forward Secrecy, Session Key Derivation, and Key Separation in Go ➡️</a>
</div>
