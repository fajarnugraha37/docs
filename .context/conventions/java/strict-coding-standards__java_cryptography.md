# Strict Coding Standards: Java Cryptography

> **Document status:** Mandatory coding standard for LLM-generated Java cryptography implementation.  
> **Scope:** Java 11, Java 17, Java 21, Java 25, and framework code that uses JCA/JCE/JSSE or cryptographic libraries from Java.  
> **Mode:** Deny-by-default, policy-driven, no custom cryptography.  
> **Audience:** LLM code agents, human implementers, code reviewers, security reviewers, platform engineers.

---

## 1. Purpose

This document defines strict coding standards for cryptographic implementation in Java.

It is not a cryptography tutorial. It is a behavioral contract for LLM code agents and reviewers.

The goal is to prevent the common failure modes of generated Java code:

- inventing custom encryption, signing, key exchange, hashing, or token formats
- choosing cryptographic primitives without a threat model
- using weak algorithms because snippets online compile
- using `Cipher.getInstance("AES")`, which usually means provider-default mode/padding
- using AES-CBC without authentication
- using RSA encryption directly for arbitrary payloads
- storing passwords with SHA-256, MD5, or reversible encryption
- generating keys, IVs, salts, or tokens with `Random`, `ThreadLocalRandom`, timestamps, counters, UUIDs, or predictable values
- reusing IVs/nonces under the same key
- comparing MACs or signatures with non-constant-time comparison
- logging secrets, keys, tokens, plaintext, or derived material
- hardcoding keys in source code, test code, config files, Docker images, or CI variables
- disabling certificate validation or hostname verification
- using provider-specific APIs without explicit justification
- creating code that is functional but not cryptographically defensible

---

## 2. Relationship to Other Standards

This document is an overlay standard.

It MUST be used together with:

- `strict-coding-standards__java11.md`
- `strict-coding-standards__java17.md`
- `strict-coding-standards__java21.md`
- `strict-coding-standards__java25.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_network.md`
- `strict-coding-standards__java_io.md`
- `strict-coding-standards__jdbc.md`
- `strict-coding-standards__jpa.md`
- `strict-coding-standards__jaxrs.md`

When there is a conflict, the stricter security or cryptography rule wins.

Example:

- Java I/O standards may allow writing a file with `Files.write()`.
- This cryptography standard requires key material to be written only through an approved secret-storage mechanism, never as plain files unless explicitly approved and protected.

---

## 3. Core Principle

Cryptographic code MUST be explicit, policy-driven, and reviewable.

Every cryptographic implementation MUST answer:

1. What security property is required?
   - confidentiality
   - integrity
   - authenticity
   - non-repudiation
   - password verification
   - key agreement
   - key wrapping
   - randomness
   - transport protection
2. What data is protected?
3. Who can read, modify, replay, or replace the data?
4. Where are keys generated, stored, rotated, and revoked?
5. Which algorithm/mode/padding is used?
6. Which parameters are used?
7. What metadata is authenticated?
8. What happens on verification/decryption failure?
9. What is logged?
10. What test proves misuse is rejected?

If an LLM agent cannot answer these questions, it MUST NOT implement cryptography.

---

## 4. Mandatory Agent Behavior

### 4.1 Required before writing cryptographic code

Before generating cryptographic code, the LLM agent MUST classify the task into exactly one or more of these categories:

- encrypting data at rest
- encrypting data in transit
- generating random tokens
- hashing non-secret data
- storing/verifying passwords
- signing data
- verifying signatures
- computing/verifying MACs
- generating symmetric keys
- generating asymmetric key pairs
- wrapping/unwrapping keys
- deriving keys
- performing key agreement
- using certificates
- using Java KeyStore
- configuring TLS/mTLS
- integrating with KMS/HSM/PKCS#11
- migrating legacy cryptography
- testing cryptography

The agent MUST NOT use a generic helper like `CryptoUtil.encrypt()` unless the helper is domain-specific and policy-bound.

Bad:

```java
CryptoUtil.encrypt(data);
```

Good:

```java
CustomerDocumentEncryptor.encryptForStorage(documentBytes, tenantKeyId, aad);
```

### 4.2 Required cryptographic impact statement

For every cryptography-related change, the agent MUST include this in the implementation note or PR description:

```text
Cryptography Impact:
- Security property required:
- Data protected:
- Algorithm/transformation:
- Key source:
- IV/nonce/salt source:
- Authenticated metadata:
- Failure behavior:
- Rotation/migration impact:
- Test coverage:
- Residual risk:
```

### 4.3 Required code property

Cryptographic code MUST be:

- deterministic in configuration
- non-deterministic only where randomness is required
- explicit about algorithm names
- explicit about key sizes
- explicit about IV/nonce/tag sizes
- explicit about charset for string-to-byte conversion
- explicit about binary encoding
- explicit about provider only when necessary
- isolated from business logic
- testable with known vectors or invariant tests

---

## 5. Java Version Compatibility

### 5.1 Java 11 baseline

Allowed Java 11 cryptographic facilities include:

- JCA/JCE APIs under `java.security` and `javax.crypto`
- `SecureRandom`
- `DrbgParameters` introduced before Java 11
- `Cipher`
- `Mac`
- `MessageDigest`
- `Signature`
- `KeyGenerator`
- `KeyPairGenerator`
- `KeyAgreement`
- `SecretKeyFactory`
- `KeyStore`
- JSSE/TLS APIs
- PKCS#12 keystore support

The code MUST compile with `--release 11` when the project baseline is Java 11.

### 5.2 Java 17 baseline

Java 17 code may use the same core APIs with updated provider behavior and platform constraints.

Do not rely on Security Manager as a sandbox or cryptographic control.

### 5.3 Java 21 baseline

Java 21 adds the standard `javax.crypto.KEM` API.

Rules:

- `KEM` MAY be used only for approved key-encapsulation workflows.
- `KEM` MUST NOT be used as a generic encryption API.
- KEM output MUST be fed into a clearly defined symmetric encryption or key-derivation workflow.
- KEM use MUST include interoperability tests.

### 5.4 Java 25 baseline

Java 25 may include additional security/provider enhancements, but this standard remains conservative.

Rules:

- Use only final/stable APIs by default.
- Preview/incubator cryptography APIs are forbidden unless the project explicitly allows preview/incubator features.
- Provider behavior MUST be tested on the deployed JDK distribution, not assumed from local development.

---

## 6. Cryptographic Primitive Decision Matrix

The LLM agent MUST choose primitives by use case, not by familiarity.

| Use case | Default choice | Restricted alternatives | Forbidden by default |
|---|---|---|---|
| Encrypt data at rest | AES-GCM | ChaCha20-Poly1305 if supported/policy-approved | AES-ECB, AES-CBC without MAC, DES, 3DES, RC4 |
| Encrypt large stream | Envelope encryption with chunk authentication | Framework/KMS envelope scheme | Single unbounded `doFinal()` for huge payload |
| Password storage | Argon2id/bcrypt/scrypt; PBKDF2 only when policy/platform requires | PBKDF2 with strong iteration policy | MD5/SHA-1/SHA-256 alone, encryption, Base64 |
| Random token | `SecureRandom` bytes + Base64url | DRBG with explicit parameters | `Random`, `ThreadLocalRandom`, timestamp, counter |
| Integrity with shared secret | HMAC-SHA-256 or stronger | HMAC-SHA-384/512 | raw hash, HmacMD5 |
| Hash non-secret data | SHA-256 or stronger | SHA-3 when policy-approved | MD5, SHA-1 |
| Digital signature | Ed25519, ECDSA with approved curve, RSASSA-PSS | RSA PKCS#1 v1.5 only for legacy compatibility | MD5withRSA, SHA1withRSA, raw RSA |
| Public-key encryption | Hybrid encryption / KEM + AEAD | RSA-OAEP for small key material | RSA/ECB/PKCS1Padding for new code |
| Key agreement | ECDH/XDH through approved provider/policy | Java 21 KEM where applicable | ad-hoc DH parameters |
| Key storage | KMS/HSM/PKCS#11 or protected PKCS#12 | app-managed keystore with strict ops | hardcoded key, plain file key |
| Certificate validation | Default JSSE validation + hostname verification | pinning with rotation plan | trust-all manager, disabled hostname verifier |

---

## 7. Forbidden Algorithms, Modes, and Practices

### 7.1 Always forbidden for new code

The following MUST NOT be introduced in new code:

- MD2
- MD4
- MD5 for security decisions
- SHA-1 for signatures, certificates, password storage, or integrity decisions
- DES
- 3DES / DESede for new encryption
- RC2
- RC4
- Blowfish for new encryption
- AES-ECB
- RSA with PKCS#1 v1.5 encryption for new code
- raw RSA encryption/signature
- DSA for new signatures unless policy explicitly requires it
- unauthenticated encryption for attacker-controlled data
- homegrown stream ciphers
- homegrown block cipher modes
- homegrown padding schemes
- homegrown MACs
- homegrown password hashing
- homegrown token generation
- checksum algorithms such as CRC32 for security

### 7.2 Forbidden Java patterns

```java
Cipher.getInstance("AES");                // forbidden: mode/padding not explicit
Cipher.getInstance("AES/ECB/PKCS5Padding"); // forbidden
Cipher.getInstance("DES");                // forbidden
MessageDigest.getInstance("MD5");         // forbidden for security
MessageDigest.getInstance("SHA-1");       // forbidden for security
new Random();                              // forbidden for crypto
ThreadLocalRandom.current();               // forbidden for crypto
Math.random();                             // forbidden for crypto
```

### 7.3 Forbidden operational behavior

- hardcoded secrets or keys
- static IV/nonce
- IV/nonce reuse with same key
- storing plaintext private keys in repository
- storing keystore password in repository
- logging plaintext, keys, tokens, IV+plaintext pairs, decrypted payloads, or password hashes
- decrypting and then ignoring authentication failure
- fallback to insecure algorithm when preferred algorithm fails
- accepting any certificate
- disabling hostname verification
- ignoring key usage or extended key usage constraints when relevant
- treating Base64 as encryption
- treating hashing as encryption

---

## 8. Approved Defaults

These defaults apply unless project security architecture says otherwise.

### 8.1 Symmetric encryption

Preferred transformation:

```text
AES/GCM/NoPadding
```

Default parameters:

- AES key: 128-bit minimum, 256-bit preferred if policy/runtime supports it
- IV/nonce: 96-bit random per encryption
- tag: 128-bit preferred
- AAD: required when metadata affects interpretation
- encoding: binary envelope, not ad-hoc string concatenation

### 8.2 HMAC

Preferred algorithms:

```text
HmacSHA256
HmacSHA384
HmacSHA512
```

Rules:

- HMAC key MUST be generated from secure random or approved KDF.
- HMAC key MUST NOT be a human password directly.
- HMAC verification MUST use constant-time comparison.
- MAC input format MUST be canonical.

### 8.3 Password storage

Preferred:

- Argon2id
- bcrypt
- scrypt

Allowed when policy/platform requires Java standard APIs only:

- PBKDF2 with HMAC-SHA-256 or stronger

Rules:

- Unique random salt per password.
- Work factor/iteration/memory cost MUST be configurable by policy.
- Password hashes MUST be versioned.
- Pepper MAY be used only if stored outside the database, preferably in KMS/HSM/secrets manager.
- Password hash verification MUST allow migration to stronger parameters on successful login.

### 8.4 Random tokens

Preferred token generation:

```java
private static final SecureRandom SECURE_RANDOM = new SecureRandom();

public static String newToken(int byteLength) {
    if (byteLength < 16) {
        throw new IllegalArgumentException("Token must be at least 128 bits");
    }
    byte[] token = new byte[byteLength];
    SECURE_RANDOM.nextBytes(token);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(token);
}
```

Rules:

- 128 bits minimum entropy for normal random tokens.
- 192 or 256 bits for high-value long-lived secrets.
- No UUIDs for secrets unless security team explicitly approves the exact UUID generation behavior and entropy requirement.
- No timestamps, sequence numbers, or database IDs as secrets.

### 8.5 Digital signatures

Preferred:

- Ed25519 where supported and policy-approved
- ECDSA with approved curves where interoperability requires it
- RSASSA-PSS for RSA signatures

Rules:

- Signature algorithm MUST include hash/mode details.
- Signature verification failure MUST be fail-closed.
- Signature input MUST be canonical.
- Public keys/certificates MUST be trusted through explicit trust policy.

### 8.6 Public-key encryption / key encapsulation

Preferred:

- envelope encryption
- KMS/HSM envelope encryption
- Java 21+ KEM when architecture explicitly uses KEM
- RSA-OAEP only for small key material, not arbitrary payloads

Rules:

- Public-key operations MUST NOT encrypt large application payloads directly.
- Public-key encryption MUST usually protect a content-encryption key.
- RSA-OAEP MUST specify digest/MGF parameters when possible.
- Legacy RSA/ECB/PKCS1Padding MUST be migration-only.

---

## 9. Symmetric Encryption Rules

### 9.1 AES-GCM required structure

AES-GCM encryption output MUST carry enough metadata to decrypt safely.

Required envelope fields:

```text
version
algorithm
keyId
iv
ciphertext
tag or ciphertextWithTag
optional aad metadata reference
```

Do not produce anonymous ciphertext that cannot be migrated or rotated.

Bad:

```java
return Base64.getEncoder().encodeToString(cipher.doFinal(plaintext));
```

Good:

```java
record EncryptedPayload(
        int version,
        String algorithm,
        String keyId,
        byte[] iv,
        byte[] ciphertext
) {}
```

### 9.2 IV/nonce rules

For AES-GCM:

- IV MUST be unique for every encryption under the same key.
- Random 96-bit IV is the default.
- IV MUST NOT be derived from plaintext.
- IV MUST NOT be derived from timestamp only.
- IV MUST NOT be a constant.
- IV MAY be stored with ciphertext.
- IV is not secret, but integrity of the envelope matters.

### 9.3 AAD rules

AAD MUST be used when metadata affects authorization or interpretation.

Examples of AAD:

- tenant ID
- user ID / subject ID
- document ID
- record type
- schema version
- purpose
- creation timestamp bucket
- key ID if not otherwise authenticated

AAD MUST be reproduced exactly during decryption.

### 9.4 AES-GCM implementation template

```java
public final class AesGcmEncryptor {
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecureRandom secureRandom;

    public AesGcmEncryptor(SecureRandom secureRandom) {
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom");
    }

    public EncryptedPayload encrypt(byte[] plaintext, SecretKey key, String keyId, byte[] aad)
            throws GeneralSecurityException {
        Objects.requireNonNull(plaintext, "plaintext");
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(keyId, "keyId");

        byte[] iv = new byte[IV_BYTES];
        secureRandom.nextBytes(iv);

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        if (aad != null && aad.length > 0) {
            cipher.updateAAD(aad);
        }

        byte[] ciphertext = cipher.doFinal(plaintext);
        return new EncryptedPayload(1, TRANSFORMATION, keyId, iv, ciphertext);
    }

    public byte[] decrypt(EncryptedPayload payload, SecretKey key, byte[] aad)
            throws GeneralSecurityException {
        Objects.requireNonNull(payload, "payload");
        Objects.requireNonNull(key, "key");

        if (!TRANSFORMATION.equals(payload.algorithm())) {
            throw new GeneralSecurityException("Unsupported encryption algorithm");
        }
        if (payload.iv().length != IV_BYTES) {
            throw new GeneralSecurityException("Invalid IV length");
        }

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, payload.iv()));
        if (aad != null && aad.length > 0) {
            cipher.updateAAD(aad);
        }
        return cipher.doFinal(payload.ciphertext());
    }
}
```

Implementation notes:

- Do not log exception details that reveal plaintext or key metadata beyond safe error code.
- `AEADBadTagException` MUST be treated as authentication failure.
- Never return partial plaintext after authentication failure.

### 9.5 CBC migration rule

AES-CBC MAY be used only for legacy compatibility.

If AES-CBC must be used:

- use random unpredictable IV
- use PKCS#5/PKCS#7-compatible padding
- authenticate with HMAC using encrypt-then-MAC
- use separate encryption and MAC keys
- verify MAC before decryption
- version the envelope
- add migration plan to AES-GCM or approved AEAD

Forbidden:

- AES-CBC without MAC
- MAC-then-encrypt unless legacy protocol requires it
- decrypting before verifying MAC
- reusing same key for encryption and MAC

---

## 10. Hashing Rules

### 10.1 Hashing is not encryption

Hashing MUST NOT be used to hide data that needs confidentiality.

Bad:

```java
String protectedSsn = sha256(ssn);
```

This is not encryption. It may be brute-forced if the input has low entropy.

### 10.2 Approved message digests

Allowed for non-secret integrity/fingerprints:

- SHA-256
- SHA-384
- SHA-512
- SHA3-256/384/512 when supported and policy-approved

Forbidden for security decisions:

- MD5
- SHA-1

### 10.3 Canonical input

When hashing structured data:

- define canonical serialization
- define charset as UTF-8
- define field ordering
- define normalization where relevant
- include version and domain separation prefix

Bad:

```java
sha256(userId + amount + currency);
```

Good:

```java
sha256("payment:v1\n" + userId + "\n" + amount.toPlainString() + "\n" + currency);
```

Better: use a canonical binary or JSON serialization with tests.

---

## 11. MAC Rules

### 11.1 When to use HMAC

Use HMAC when two parties share a secret key and need integrity/authenticity.

Use cases:

- webhook signature verification
- internal request signing
- tamper-proof tokens where symmetric verification is acceptable
- envelope integrity for legacy encryption

Do not use HMAC for non-repudiation.

### 11.2 HMAC implementation rules

- Use `Mac.getInstance("HmacSHA256")` or stronger.
- Key MUST be `SecretKeySpec` or provider-managed key.
- Key MUST be at least 256 bits for HMAC-SHA-256 unless policy says otherwise.
- Input MUST be canonical.
- Output comparison MUST use `MessageDigest.isEqual()` or approved constant-time comparison.
- Reject missing signature.
- Reject unknown key ID.
- Reject stale timestamp where replay matters.

Example:

```java
public boolean verify(byte[] expectedMac, byte[] actualMac) {
    return MessageDigest.isEqual(expectedMac, actualMac);
}
```

---

## 12. Password Storage Rules

### 12.1 Never encrypt passwords

Passwords MUST NOT be stored with reversible encryption.

Passwords MUST be stored using password hashing algorithms designed to resist offline attacks.

### 12.2 Approved password hashing

Preferred:

- Argon2id
- bcrypt
- scrypt

Allowed with Java-standard API constraint:

- `PBKDF2WithHmacSHA256`
- `PBKDF2WithHmacSHA512`

Restricted/legacy:

- `PBKDF2WithHmacSHA1` only for legacy compatibility or strict FIPS/provider constraints

Forbidden:

- MD5
- SHA-1
- SHA-256 alone
- SHA-512 alone
- salted SHA alone
- custom repeated hashing loops
- AES-encrypted passwords
- Base64 passwords

### 12.3 Password hash record

Password hash storage MUST be self-describing.

Required fields:

```text
algorithm
version
parameters
salt
hash
optional pepper id
createdAt
```

Example format:

```text
$pbkdf2-sha256$v=1$i=600000$l=32$s=<base64url>$h=<base64url>
```

Rules:

- Never store raw password.
- Never log password.
- Never return password hash in API.
- Rehash when policy changes.
- Use constant-time comparison.
- Account lockout/rate limiting is outside cryptography but required for authentication systems.

### 12.4 PBKDF2 Java baseline template

```java
public final class Pbkdf2PasswordHasher {
    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int SALT_BYTES = 16;
    private static final int HASH_BITS = 256;

    private final SecureRandom secureRandom;
    private final int iterations;

    public Pbkdf2PasswordHasher(SecureRandom secureRandom, int iterations) {
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom");
        if (iterations < 100_000) {
            throw new IllegalArgumentException("Iteration count below policy minimum");
        }
        this.iterations = iterations;
    }

    public PasswordHash hash(char[] password) throws GeneralSecurityException {
        Objects.requireNonNull(password, "password");
        byte[] salt = new byte[SALT_BYTES];
        secureRandom.nextBytes(salt);
        byte[] hash = pbkdf2(password, salt, iterations, HASH_BITS);
        return new PasswordHash(ALGORITHM, 1, iterations, salt, hash);
    }

    public boolean verify(char[] password, PasswordHash stored) throws GeneralSecurityException {
        Objects.requireNonNull(password, "password");
        Objects.requireNonNull(stored, "stored");
        if (!ALGORITHM.equals(stored.algorithm())) {
            return false;
        }
        byte[] candidate = pbkdf2(password, stored.salt(), stored.iterations(), stored.hash().length * 8);
        return MessageDigest.isEqual(candidate, stored.hash());
    }

    private static byte[] pbkdf2(char[] password, byte[] salt, int iterations, int bits)
            throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(password, salt, iterations, bits);
        try {
            SecretKeyFactory factory = SecretKeyFactory.getInstance(ALGORITHM);
            return factory.generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }
}
```

Important:

- Use project-approved password hashing library for Argon2id/bcrypt/scrypt.
- Do not silently downgrade if the provider lacks the algorithm.
- Do not use this template if organization policy mandates Argon2id/bcrypt/scrypt.

---

## 13. Randomness Rules

### 13.1 Secure random only

Cryptographic randomness MUST use `SecureRandom` or approved provider-specific secure RNG.

Forbidden:

```java
new Random()
ThreadLocalRandom.current()
Math.random()
System.currentTimeMillis()
Instant.now()
AtomicLong.incrementAndGet()
UUID.nameUUIDFromBytes(...)
```

### 13.2 Random values by use case

| Value | Minimum default | Notes |
|---|---:|---|
| AES-GCM IV | 96 bits | Unique per key; random default |
| Salt | 128 bits | Unique per password/derivation |
| Session token | 128 bits | 192/256 bits for high-value |
| API secret | 256 bits | Store hashed/MACed when possible |
| Password reset token | 128 bits | Expiry + one-time use required |
| CSRF token | 128 bits | Bound to session/user context |
| HMAC key | 256 bits | Use random/key generator/KMS |
| AES key | 128/256 bits | Per policy |

### 13.3 Seeding

- Do not manually seed `SecureRandom` with predictable seed.
- Do not seed from time, PID, hostname, username, or request ID.
- Do not share deterministic test RNG in production code.
- For tests, inject deterministic byte source only behind test-only interface.

---

## 14. Key Management Rules

### 14.1 Key source hierarchy

Preferred key sources, from strongest operational control to weaker:

1. HSM / PKCS#11 token
2. cloud KMS / enterprise KMS
3. secrets manager with envelope encryption
4. protected PKCS#12 keystore with externalized password
5. environment/config reference to key ID only

Forbidden:

- key literal in Java source
- key in test fixture reused by production
- key in Git history
- key in Docker image layer
- key in plain config file
- key generated on application startup and used for durable data
- key copied to log or exception

### 14.2 Key lifecycle requirements

Every durable cryptographic key MUST have:

- key ID
- owner/service
- purpose
- algorithm
- creation date
- activation date
- rotation period
- status: active, decrypt-only, retired, revoked
- storage location
- access control
- audit logging
- destruction/retention policy

### 14.3 Key separation

Keys MUST be separated by purpose.

Forbidden:

- same key for encryption and HMAC
- same key for tenants unless explicitly approved
- same key for test/staging/production
- same key for signing and encryption
- same key for token signing and data encryption

### 14.4 Key rotation

Durable encrypted data MUST support key rotation.

Required:

- ciphertext envelope includes `keyId`
- decrypt supports old active/decrypt-only keys
- encrypt uses current active key
- re-encryption job is idempotent
- audit logs key version changes without logging plaintext/key

### 14.5 Key derivation

Key derivation MUST use approved KDF.

Allowed:

- PBKDF2 for password-derived keys when required
- HKDF from vetted library or Java-supported KDF API where available and approved
- KMS/HSM derivation APIs

Forbidden:

```java
sha256(password)
sha256(secret + salt)
password.substring(0, 16).getBytes()
new SecretKeySpec(userInput.getBytes(UTF_8), "AES")
```

---

## 15. Java KeyStore Rules

### 15.1 Keystore type

Preferred:

- `PKCS12` for file-based keystores
- `PKCS11` for HSM/token integration

Restricted:

- `JKS` only for legacy read/migration
- `JCEKS` only for legacy systems with explicit justification

Rules:

- Keystore password MUST NOT be hardcoded.
- Keystore file MUST NOT be committed to repository unless it contains only public test certificates.
- Production private keys SHOULD be in KMS/HSM or platform secret store.
- Keystore aliases MUST be stable and documented.
- Keystore loading MUST fail closed.

### 15.2 Keystore loading

Bad:

```java
char[] password = "changeit".toCharArray();
```

Good:

```java
char[] password = secretProvider.getCharSecret("tls-keystore-password");
try (InputStream in = Files.newInputStream(keystorePath)) {
    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    keyStore.load(in, password);
    return keyStore;
} finally {
    Arrays.fill(password, '\0');
}
```

---

## 16. Digital Signature Rules

### 16.1 When to use signatures

Use digital signatures when:

- verifier must not be able to forge messages
- public verification is needed
- audit/non-repudiation is required by policy
- data must be verifiable outside the issuing service

Use HMAC instead when:

- both sides are trusted services sharing a secret
- public verification is not required
- operational simplicity is preferred

### 16.2 Signature algorithm policy

Preferred:

```text
Ed25519
RSASSA-PSS
SHA256withECDSA / SHA384withECDSA with approved curves
```

Restricted:

```text
SHA256withRSA
```

Forbidden:

```text
MD5withRSA
SHA1withRSA
NONEwithRSA
raw RSA signatures
```

### 16.3 Signature input canonicalization

Signature input MUST be canonical.

For JSON payloads, the agent MUST NOT sign raw arbitrary JSON string unless the exact serialization is controlled.

Required:

- stable field ordering or canonical JSON scheme
- stable charset
- stable number representation
- stable whitespace policy
- versioned payload format
- domain separation prefix

Example domain separation:

```text
payment-approval:v1\n<canonical-payload>
```

### 16.4 Verification behavior

Signature verification MUST:

- reject unknown key ID
- reject unsupported algorithm
- reject expired/revoked key/certificate
- reject malformed signature
- reject non-canonical payload
- fail closed
- avoid revealing whether failure was key mismatch, payload mismatch, or parse issue unless safe

---

## 17. Certificate and X.509 Rules

### 17.1 Certificate validation

When using TLS/JSSE, rely on default certificate validation unless there is a documented reason not to.

Forbidden:

```java
new X509TrustManager() {
    public void checkClientTrusted(X509Certificate[] chain, String authType) {}
    public void checkServerTrusted(X509Certificate[] chain, String authType) {}
    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
}
```

Forbidden:

```java
(hostname, session) -> true
```

### 17.2 Pinning

Certificate/public-key pinning is restricted.

It MAY be used only when:

- there is a rotation plan
- there are backup pins
- expiry is monitored
- failure mode is defined
- operational owner is known
- integration tests cover rollover

### 17.3 mTLS

For mTLS:

- client certificate identity mapping MUST be explicit
- certificate CN alone MUST NOT be trusted if SAN/identity policy applies
- revocation/expiry behavior MUST be defined
- private key must be protected via KMS/HSM/PKCS#12 with secure operational controls

---

## 18. TLS and JSSE Rules

### 18.1 TLS configuration

TLS code MUST NOT weaken defaults unless explicitly approved.

Forbidden:

- trust-all `TrustManager`
- hostname verification disabled
- SSLv3
- TLS 1.0
- TLS 1.1
- weak cipher suites
- export cipher suites
- anonymous cipher suites
- null cipher suites
- hardcoded insecure protocol fallback

Default:

- rely on current JDK TLS defaults where possible
- prefer TLS 1.3 and TLS 1.2 where compatible
- use platform trust store or approved trust store
- configure mTLS explicitly when required

### 18.2 Custom SSLContext

Custom `SSLContext` is restricted.

Allowed reasons:

- mTLS client certificate
- private enterprise CA trust store
- test-only local certificate setup
- FIPS/provider-specific environment

Required:

- no trust-all
- no disabled hostname verification
- clear secret source
- tests for valid/invalid cert
- separate test profile from production

---

## 19. Public-Key Encryption and KEM Rules

### 19.1 RSA encryption

RSA MUST NOT be used to encrypt arbitrary application data.

Allowed:

- encrypt/wrap small symmetric key material
- legacy interoperability

Preferred:

- RSA-OAEP with SHA-256/MGF1 when required
- KMS/HSM wrapping
- Java 21+ KEM where architecture requires KEM

Forbidden for new code:

```text
RSA/ECB/PKCS1Padding
```

### 19.2 Java KEM API

For Java 21+:

- `javax.crypto.KEM` is restricted to key encapsulation workflows.
- KEM MUST be paired with AEAD encryption for payload confidentiality/integrity.
- KEM algorithm/provider MUST be explicitly selected by policy.
- Encapsulated key material MUST be treated as secret.
- Interoperability and test vectors are required.

Do not use KEM as a drop-in replacement for `Cipher`.

---

## 20. Binary Encoding Rules

### 20.1 Encoding is not security

Base64, hex, URL encoding, compression, and serialization are not encryption.

The agent MUST NOT describe encoded data as encrypted unless actual encryption was applied.

### 20.2 Encoding policy

- Use Base64url without padding for URL tokens.
- Use standard Base64 for binary blobs in JSON where URL safety is not needed.
- Use hex only for human-readable fingerprints, not large payloads.
- Define charset as `StandardCharsets.UTF_8` for text-to-byte conversion.
- Never use platform default charset.

Bad:

```java
secret.getBytes()
```

Good:

```java
secret.getBytes(StandardCharsets.UTF_8)
```

---

## 21. Secret Handling Rules

### 21.1 Sensitive values

Sensitive values include:

- passwords
- API keys
- OAuth tokens
- refresh tokens
- session IDs
- private keys
- symmetric keys
- HMAC keys
- database credentials
- keystore passwords
- plaintext confidential data
- decrypted payloads
- password reset tokens
- signing secrets
- JWT signing keys

### 21.2 Logging rules

Never log:

- plaintext secret
- encrypted secret plus key/IV context that enables offline abuse
- password hash
- token
- private key
- decrypted payload
- full certificate private material
- key bytes
- random seed

Allowed to log:

- key ID
- algorithm
- envelope version
- safe error code
- operation name
- truncated non-secret fingerprint
- certificate subject/issuer only if policy allows

### 21.3 Memory handling

- Prefer `char[]` for passwords when API supports clearing.
- Clear temporary arrays containing key material when practical.
- Do not promise full memory erasure on JVM; garbage collection and copies may exist.
- Do not use `String` for long-lived secrets when avoidable.
- Do not store secrets in static mutable fields.

---

## 22. Provider Policy

### 22.1 Provider selection

Do not specify provider unless required.

Allowed reasons:

- FIPS mode
- HSM/PKCS#11 integration
- compliance-certified provider
- algorithm only available in provider
- interoperability requirement
- deterministic test environment

If a provider is specified, document:

```text
Provider:
Reason:
Runtime requirement:
Fallback behavior:
Test coverage:
```

### 22.2 No silent fallback

If the approved provider/algorithm is unavailable:

- fail startup for required service capability
- fail request closed for runtime operation
- do not silently downgrade to weaker algorithm

Bad:

```java
try {
    return Cipher.getInstance("AES/GCM/NoPadding", "ApprovedProvider");
} catch (Exception ignored) {
    return Cipher.getInstance("AES/CBC/PKCS5Padding");
}
```

---

## 23. Error Handling Rules

### 23.1 Fail closed

Cryptographic failure MUST fail closed.

Examples:

- decryption auth failure => reject data
- signature failure => reject data
- unsupported key ID => reject data
- expired certificate => reject connection/request
- unsupported algorithm => reject data
- malformed envelope => reject data

### 23.2 Exception handling

Forbidden:

```java
catch (GeneralSecurityException e) {
    return plaintextFallback;
}
```

Forbidden:

```java
catch (Exception e) {
    return true;
}
```

Allowed:

```java
catch (AEADBadTagException e) {
    throw new InvalidCiphertextException("Ciphertext authentication failed");
}
```

Do not expose cryptographic internals to end users.

---

## 24. Token and Identifier Rules

### 24.1 Random tokens

Random security tokens MUST:

- use `SecureRandom`
- have sufficient entropy
- be single-purpose
- have expiry when appropriate
- be one-time use when used for reset/activation
- be stored hashed or MACed if database compromise matters

### 24.2 Token storage

Password reset token storage preferred pattern:

```text
token shown to user: random 256-bit value
stored in DB: HMAC(serverSecret, token) or SHA-256(token) depending threat model
metadata: userId, purpose, expiry, consumedAt, createdAt
```

Rules:

- Do not store raw reset tokens if avoidable.
- Do not log raw reset tokens.
- Do not allow indefinite token validity.
- Do not reuse token across purposes.

### 24.3 JWT/JWS/JWE

JWT-related crypto is restricted.

Rules:

- Do not implement JWT signing/verification manually unless explicitly required.
- Use mature JOSE library.
- Reject `alg=none`.
- Pin expected algorithm server-side.
- Do not trust token algorithm header blindly.
- Validate issuer, audience, expiry, not-before, subject, key ID, and signature.
- Use asymmetric signing when multiple independent verifiers exist.
- Use short TTL for access tokens.
- Do not put secrets/PII in unsigned or merely encoded tokens.

---

## 25. File Encryption Rules

### 25.1 File encryption envelope

Encrypted files MUST have a versioned envelope.

Required metadata:

```text
magic/version
algorithm
keyId
iv
chunk size if chunked
aad/canonical metadata
ciphertext chunks
tag(s)
```

### 25.2 Large file encryption

Do not read large files into memory.

For large files:

- use streaming/chunked encryption design
- authenticate each chunk or entire stream through approved construction
- include chunk index in AAD
- include final marker/total size where needed
- handle partial write atomically
- do not release partially encrypted output as valid

### 25.3 Compression

Compression before encryption is restricted when attacker can influence plaintext and observe ciphertext size.

The agent MUST flag CRIME/BREACH-style risks in network/token contexts.

---

## 26. Database Encryption Rules

### 26.1 Application-layer encryption

Application-layer encryption MUST define:

- which fields are encrypted
- which fields remain searchable
- which metadata is AAD
- key per tenant/domain/table/field
- rotation strategy
- migration strategy
- index/search limitation

Do not encrypt fields blindly if queries depend on plaintext.

### 26.2 Deterministic encryption

Deterministic encryption is restricted.

Allowed only when:

- searchable equality is required
- leakage profile is documented
- frequency analysis risk is accepted
- algorithm/mode is approved
- domain size is sufficiently large or protected

Never use deterministic encryption for low-cardinality fields unless security accepts leakage.

### 26.3 Hashing for lookup

Hash-based lookup is restricted.

If used:

- prefer HMAC with server-side secret for sensitive values
- include domain separation
- consider tenant-specific key
- document leakage and collision behavior

---

## 27. Configuration Rules

### 27.1 Allowed configuration

Allowed to configure externally:

- key IDs
- provider names
- keystore path/reference
- KMS key reference
- algorithm policy version
- password hashing cost parameters
- token TTL
- rotation windows

Forbidden to configure externally without strict validation:

- arbitrary algorithm names from user/admin input
- arbitrary provider class names
- arbitrary key paths from untrusted input
- disable certificate validation flag
- allow insecure fallback flag

### 27.2 Startup validation

Services using cryptography MUST validate at startup:

- required algorithm is available
- required provider is available if pinned
- key references resolve
- active encryption key exists
- signing key exists if required
- password hashing policy valid
- insecure config flags absent

Fail startup if cryptographic capability is mandatory.

---

## 28. Testing Requirements

### 28.1 Mandatory tests

Cryptographic code MUST include tests for:

- successful operation
- invalid key
- invalid key ID
- modified ciphertext
- modified IV
- modified AAD
- modified tag/MAC/signature
- unsupported algorithm/version
- malformed envelope
- empty input where allowed/forbidden
- large input if streaming
- deterministic behavior only where expected
- random uniqueness property where practical
- legacy migration if supported

### 28.2 Negative tests are mandatory

Every decrypt/verify method MUST have tamper tests.

Example test cases:

```text
- flip one bit in ciphertext => decrypt fails
- flip one bit in IV => decrypt fails
- change tenant ID AAD => decrypt fails
- change key ID to unknown => decrypt fails
- truncate tag => decrypt fails
```

### 28.3 Known-answer tests

Use known-answer tests when implementing:

- signatures
- HMAC
- hashing
- PBKDF2
- KDF
- interop protocols
- external partner integration

### 28.4 Do not assert exact ciphertext for randomized encryption

For AES-GCM with random IV:

- ciphertext MUST differ for same plaintext/key on repeated encryption
- decryption MUST recover plaintext
- tampering MUST fail

Do not make brittle tests that expect fixed ciphertext unless IV is injected deterministically in test-only code.

---

## 29. Review Checklist

A cryptography change MUST be rejected if any answer is unclear.

### 29.1 Algorithm and mode

- [ ] Is the security purpose clear?
- [ ] Is the algorithm explicit?
- [ ] Is the mode explicit?
- [ ] Is padding explicit?
- [ ] Are weak algorithms absent?
- [ ] Is AEAD used for encryption where possible?
- [ ] If not AEAD, is authentication handled correctly?

### 29.2 Keys

- [ ] Is key source approved?
- [ ] Is key ID present for durable encryption?
- [ ] Is key rotation possible?
- [ ] Are keys separated by purpose?
- [ ] Are keys absent from source/config/logs?
- [ ] Are test keys clearly test-only?

### 29.3 Randomness

- [ ] Is `SecureRandom` used?
- [ ] Are IVs/nonces unique per key?
- [ ] Are salts unique?
- [ ] Are tokens sufficiently long?
- [ ] Are predictable sources absent?

### 29.4 Verification and failure

- [ ] Are MAC/signature/tag failures fail-closed?
- [ ] Is constant-time comparison used where needed?
- [ ] Is malformed input rejected?
- [ ] Are exceptions not swallowed?
- [ ] Are fallback paths safe?

### 29.5 Operational safety

- [ ] Are secrets not logged?
- [ ] Is startup validation present?
- [ ] Are provider assumptions documented?
- [ ] Are metrics safe?
- [ ] Is rotation/migration documented?
- [ ] Is compatibility tested?

### 29.6 Tests

- [ ] Positive tests exist.
- [ ] Tamper tests exist.
- [ ] Wrong key tests exist.
- [ ] Wrong AAD tests exist.
- [ ] Unsupported version tests exist.
- [ ] Known-answer/interoperability tests exist where required.

---

## 30. LLM-Specific Anti-Patterns

The LLM agent MUST NOT produce these patterns.

### 30.1 Generic crypto utility

Bad:

```java
public class CryptoUtil {
    public static String encrypt(String text) { ... }
    public static String decrypt(String text) { ... }
}
```

Why rejected:

- no purpose
- no key lifecycle
- no AAD
- no envelope
- no migration
- unclear failure semantics

Better:

```java
public final class TenantDocumentEncryptionService {
    public EncryptedDocument encrypt(DocumentId documentId, TenantId tenantId, byte[] plaintext) { ... }
}
```

### 30.2 Magic constants without policy

Bad:

```java
private static final String SECRET = "my-secret-key";
```

Bad:

```java
private static final byte[] IV = new byte[12];
```

### 30.3 Crypto hidden in mapper/entity

Bad:

```java
@Entity
class Customer {
    public void setSsn(String ssn) {
        this.ssn = CryptoUtil.encrypt(ssn);
    }
}
```

Why rejected:

- persistence model hides crypto boundary
- no key ID
- hard to rotate
- hard to test
- unclear error handling

### 30.4 Silent fallback

Bad:

```java
try {
    return strongEncrypt(data);
} catch (Exception e) {
    return Base64.getEncoder().encodeToString(data);
}
```

### 30.5 Misusing hash for password

Bad:

```java
String passwordHash = sha256(password + salt);
```

---

## 31. Approved Implementation Shapes

### 31.1 Encryption service shape

```java
public interface DataEncryptor {
    EncryptedPayload encrypt(byte[] plaintext, EncryptionContext context) throws EncryptionException;

    byte[] decrypt(EncryptedPayload payload, EncryptionContext context) throws EncryptionException;
}
```

`EncryptionContext` should include AAD-relevant metadata, not the key bytes.

```java
public record EncryptionContext(
        String tenantId,
        String purpose,
        String recordType,
        String recordId
) {
    public byte[] toAad() {
        String canonical = "encctx:v1\n"
                + tenantId + "\n"
                + purpose + "\n"
                + recordType + "\n"
                + recordId;
        return canonical.getBytes(StandardCharsets.UTF_8);
    }
}
```

### 31.2 Key provider shape

```java
public interface EncryptionKeyProvider {
    ActiveEncryptionKey activeKey(String purpose, String tenantId);

    SecretKey resolveKey(String keyId);
}
```

Do not expose all keys.

### 31.3 Signer/verifier shape

```java
public interface PayloadSigner {
    SignedPayload sign(byte[] canonicalPayload, SigningContext context) throws SigningException;
}

public interface PayloadVerifier {
    VerificationResult verify(SignedPayload signedPayload, VerificationContext context);
}
```

Verification should return a domain result or throw a controlled exception. It must not return raw cryptographic exceptions to application layer.

---

## 32. Migration Rules

### 32.1 Legacy algorithm migration

When legacy data uses weak crypto, do not do a risky flag-day rewrite.

Preferred migration strategy:

1. Read legacy envelope.
2. Decrypt/verify using legacy path.
3. Re-encrypt with new envelope on successful read or background job.
4. Mark migration status.
5. Keep decrypt-only legacy support until migration complete.
6. Remove legacy support after retention policy allows.

### 32.2 Migration documentation

A migration MUST document:

```text
Legacy algorithm:
Legacy key source:
Weakness:
New algorithm:
Re-encryption trigger:
Rollback plan:
Audit plan:
Removal date/condition:
```

### 32.3 Do not normalize insecure behavior

Legacy support MUST be isolated.

Bad:

```java
if (newDecryptFails) {
    return oldDecrypt(payload);
}
```

Good:

```java
switch (payload.version()) {
    case 1 -> decryptLegacyV1(payload);
    case 2 -> decryptAesGcmV2(payload);
    default -> throw new UnsupportedCiphertextVersionException(payload.version());
}
```

---

## 33. Performance Rules

Cryptography performance MUST NOT override security.

Rules:

- Do not cache `Cipher` instances globally; they are stateful and not thread-safe by contract usage pattern.
- Do not reuse `Mac`/`Signature` instances across threads unless properly isolated.
- Prefer new local cryptographic engine instances unless profiling proves issue.
- Use provider/KMS batching only with security approval.
- Streaming encryption must preserve authentication semantics.
- Never disable authentication tag verification for speed.

---

## 34. Concurrency Rules

- `SecureRandom` may be shared, but high-throughput systems should benchmark contention and consider per-thread/provider-approved strategy.
- `Cipher`, `Mac`, `MessageDigest`, and `Signature` instances MUST NOT be shared mutably across threads.
- Key caches MUST be immutable or concurrency-safe.
- Key rotation must not race with decryption of old data.
- Active key lookup must be consistent enough to prevent encrypting with retired keys.

---

## 35. Observability Rules

### 35.1 Safe metrics

Allowed metrics:

- encryption operation count
- decryption operation count
- verification failure count
- unsupported version count
- key ID usage count if key IDs are non-sensitive operational IDs
- provider name at startup
- algorithm policy version
- rotation progress

Forbidden metrics/tags:

- plaintext
- ciphertext
- token
- password hash
- private key fingerprint if policy forbids
- raw certificate content unless approved
- user secret values

### 35.2 Audit logs

Security-sensitive crypto operations MAY require audit logs.

Audit should include:

- actor/service
- purpose
- key ID
- operation type
- success/failure class
- timestamp
- request/correlation ID

Audit must not include secrets or plaintext.

---

## 36. Source Code Review Rules

The reviewer MUST search for the following strings/patterns in cryptography PRs:

```text
Cipher.getInstance("AES")
ECB
MD5
SHA1
SHA-1
DES
DESede
RC4
Random()
ThreadLocalRandom
Math.random
TrustManager
HostnameVerifier
return true
PKCS1Padding
NoPadding
SecretKeySpec(
getBytes()
Base64
CryptoUtil
password
salt
iv
nonce
```

Finding one of these does not automatically mean rejection, but it requires explicit review.

---

## 37. Prompt Contract for LLM Code Agents

When implementing Java cryptography, the agent MUST follow this contract:

```text
You are modifying Java cryptographic code.

Rules:
1. Do not invent custom cryptography.
2. Do not use weak algorithms, implicit cipher transformations, static IVs, predictable randomness, or trust-all TLS.
3. Classify the use case before choosing a primitive.
4. Use explicit algorithm/mode/padding names.
5. Use SecureRandom for IVs, salts, keys, and tokens.
6. Use AEAD encryption by default for confidentiality.
7. Use AAD for metadata that affects authorization or interpretation.
8. Include version, algorithm, keyId, IV/nonce, and ciphertext/tag in durable encrypted envelopes.
9. Use KMS/HSM/secrets manager or approved keystore for key storage.
10. Never hardcode or log keys, tokens, plaintext, passwords, or password hashes.
11. Use password hashing, not encryption or plain SHA, for passwords.
12. Use constant-time comparison for MACs, password hashes, and comparable secrets.
13. Fail closed on verification/decryption/certificate failures.
14. Add tamper tests and wrong-key/wrong-AAD tests.
15. Document cryptography impact, key lifecycle, and migration risk.
```

---

## 38. Cryptography Proposal Template

Before introducing new cryptographic behavior, fill this template:

```text
Cryptography Proposal

Use case:
Security property:
Threat model:
Data classification:
Algorithm/transformation:
Key type/size:
Key source:
Key ID/envelope design:
IV/nonce/salt design:
AAD/canonicalization:
Failure behavior:
Rotation plan:
Migration plan:
Provider/runtime requirement:
Test plan:
Operational owner:
Residual risk:
```

---

## 39. Quick Reject Rules

Reject the code immediately if it contains:

- `Cipher.getInstance("AES")`
- `AES/ECB/*`
- static IV/nonce
- `new Random()` for security
- `ThreadLocalRandom` for security
- password hashing with MD5/SHA/SHA-256 alone
- hardcoded key or secret
- trust-all TLS
- hostname verifier returning true
- encryption without authentication for attacker-controlled data
- JWT verification trusting `alg` from token without server-side expected algorithm
- decryption fallback to plaintext
- logging secret/plaintext/key material
- catch block that returns success on crypto failure

---

## 40. References

Primary references for this standard:

- Oracle Java Cryptography Architecture Reference Guide  
  `https://docs.oracle.com/en/java/javase/21/security/java-cryptography-architecture-jca-reference-guide.html`
- Java Security Standard Algorithm Names  
  `https://docs.oracle.com/en/java/javase/21/docs/specs/security/standard-names.html`
- Java `javax.crypto` package documentation  
  `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/javax/crypto/package-summary.html`
- Oracle Secure Coding Guidelines for Java SE  
  `https://www.oracle.com/java/technologies/javase/seccodeguide.html`
- OpenJDK JEP 229: Create PKCS12 Keystores by Default  
  `https://openjdk.org/jeps/229`
- OpenJDK JEP 273: DRBG-Based SecureRandom Implementations  
  `https://bugs.openjdk.org/browse/JDK-8051408`
- OpenJDK JEP 452: Key Encapsulation Mechanism API  
  `https://openjdk.org/jeps/452`
- OWASP Cryptographic Storage Cheat Sheet  
  `https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html`
- OWASP Password Storage Cheat Sheet  
  `https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html`
- OWASP Key Management Cheat Sheet  
  `https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html`
- OWASP Transport Layer Security Cheat Sheet  
  `https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html`
- NIST SP 800-38D: Recommendation for GCM and GMAC  
  `https://csrc.nist.gov/pubs/sp/800/38/d/final`
- NIST SP 800-57 Part 1 Revision 5: Recommendation for Key Management  
  `https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final`

---

## 41. Final Enforcement Rule

Cryptography is not accepted because it compiles.

Cryptography is accepted only when:

- the security purpose is explicit
- the primitive matches the purpose
- the algorithm and parameters are explicit
- keys have lifecycle management
- randomness is secure
- failure is fail-closed
- secrets are not logged
- tests prove tampering fails
- migration and rotation are possible
- reviewers can reason about the implementation without guessing

If any of these are missing, the LLM agent MUST stop and produce a proposal instead of code.
