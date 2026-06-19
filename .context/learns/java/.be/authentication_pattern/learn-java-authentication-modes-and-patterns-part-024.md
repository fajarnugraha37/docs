# learn-java-authentication-modes-and-patterns-part-024

# Part 24 — Key Management for Authentication Systems in Java 8–25

> **Series:** Java Authentication Modes and Patterns  
> **Part:** 24 of 35  
> **Focus:** key material as root of trust for password pepper, HMAC signing, JWT/JWS, JWE, mTLS, SAML, OIDC, session signing, token encryption, and machine-to-machine authentication  
> **Target runtime:** Java 8 through Java 25  
> **Prerequisites:** Part 0–23, especially password auth, session auth, HMAC, JWT, opaque token, OIDC, client credentials, SAML, mTLS, and token lifecycle engineering

---

## 0. Why This Part Exists

Authentication systems often look like they are built from login forms, filters, sessions, tokens, certificates, identity providers, and user tables.

But underneath all of them there is a smaller and more dangerous truth:

> **Authentication security ultimately collapses to the correctness of key management.**

If the key is weak, leaked, reused, expired incorrectly, stored in the wrong place, rotated badly, or trusted beyond its intended boundary, then the authentication scheme becomes theater.

A system may use OAuth2, OIDC, JWT, SAML, mTLS, WebAuthn, HMAC request signing, encrypted sessions, or password peppering. All of them still depend on key material.

Examples:

| Authentication feature | Hidden key-management dependency |
|---|---|
| Password pepper | symmetric secret storage and rotation |
| HMAC API signing | shared secret lifecycle |
| JWT with HS256 | symmetric signing key governance |
| JWT with RS256/ES256/EdDSA | private signing key and public verification key lifecycle |
| OIDC JWKS | key publication, `kid`, overlap, cache behavior |
| SAML | XML signing key and certificate metadata lifecycle |
| mTLS | private key, certificate chain, CA trust, revocation |
| Session cookie signing | MAC key rotation and backward verification window |
| Encrypted remember-me token | encryption key, MAC key, nonce discipline |
| Machine-to-machine auth | client secret, private key JWT, certificate-bound token |
| Token exchange | issuer trust, audience-bound derived token, signing key trust |

This part is not a generic cryptography lesson. You already covered Java cryptography and security foundations in previous series. This part focuses on **authentication key management as an engineering system**.

The goal is to make you comfortable answering questions like:

- Where should this authentication key live?
- Who can read it?
- Who can use it without reading it?
- How is it generated?
- How is it versioned?
- How is it rotated?
- What happens during partial rollout?
- What happens if one service uses old keys and another uses new keys?
- What logs prove which key signed which token?
- What happens if the key leaks?
- Can we revoke trust without taking the system down?
- Does this key authenticate users, services, tenants, issuers, or environments?

Top-tier authentication engineers do not merely ask, “Which algorithm should I use?”

They ask:

> **What is the lifecycle, authority, scope, blast radius, audit trail, and rollback behavior of this key?**

---

## 1. Problem Statement

Authentication key management solves this core problem:

> **How can a Java system safely create, store, use, rotate, publish, revoke, and audit cryptographic keys that establish identity and trust?**

This matters because authentication protocols are not self-protecting. They rely on assumptions about keys.

A JWT verifier assumes the public key belongs to the real issuer.

A resource server assumes its JWKS cache is fresh enough.

An HMAC API server assumes the shared secret is unique, strong, and bound to the right client.

A SAML service provider assumes the IdP signing certificate in metadata is legitimate and current.

An mTLS server assumes its truststore contains only acceptable trust anchors.

A password verifier using pepper assumes the pepper is protected more strongly than the database.

If those assumptions are wrong, the authentication mode fails even if the code compiles and the framework configuration looks correct.

---

## 2. Official Grounding and Version Awareness

This part is grounded in several official or primary references:

- Java `KeyStore` represents storage for cryptographic keys and certificates. Java 8 already exposes this abstraction, including private key entries, secret key entries, and trusted certificate entries.
- Modern Java platforms are required to support the standard `PKCS12` keystore type.
- JDK 25 includes JEP 510, which finalizes a Key Derivation Function API.
- JDK 25 includes JEP 470 as a preview API for PEM encodings of cryptographic objects.
- NIST SP 800-57 provides general key-management guidance and best practices for cryptographic keying material.

For this series, the practical implication is:

> Java 8–17 systems usually rely on `KeyStore`, `KeyFactory`, `KeyPairGenerator`, `KeyGenerator`, `SecretKeyFactory`, `CertificateFactory`, `Signature`, `Mac`, and provider-specific tooling. Java 21 keeps that model largely familiar. Java 25 adds more direct platform support for KDFs and PEM handling, reducing the need for ad-hoc parsing and provider-specific workarounds in some areas.

Do not confuse this with “Java 25 magically solves key management.” It does not. It gives better APIs. The architecture discipline is still yours.

---

## 3. Core Mental Model

A key is not just bytes.

A key is an operational object with identity, purpose, ownership, lifecycle, and risk.

Think of every key as this tuple:

```text
Key = {
  id,
  material,
  algorithm,
  purpose,
  owner,
  scope,
  environment,
  tenant,
  state,
  createdAt,
  activatedAt,
  expiresAt,
  retiredAt,
  destroyedAt,
  allowedOperations,
  storageLocation,
  exportability,
  auditPolicy,
  rotationPolicy,
  compromiseProcedure
}
```

The key material is only one field. The surrounding metadata determines whether the system is secure in production.

A top-tier system treats key usage as a controlled state machine:

```text
GENERATED
  -> PRE_ACTIVE
  -> ACTIVE_SIGN_OR_DECRYPT_OR_AUTHENTICATE
  -> ACTIVE_VERIFY_ONLY_OR_DECRYPT_OLD
  -> RETIRED
  -> REVOKED_OR_DESTROYED
```

The exact states differ per use case, but the lifecycle idea is universal.

---

## 4. Key Types in Authentication Systems

Authentication systems usually use these key categories.

### 4.1 Symmetric secret

A symmetric secret is the same secret used by both sides.

Examples:

- HMAC API key secret.
- JWT HS256 signing key.
- session MAC key.
- password pepper.
- token encryption key.
- shared secret for OAuth confidential client.

Properties:

- Fast.
- Simple.
- Hard to distribute safely.
- Any verifier can also forge.
- Poor fit when many services need to verify but only one service should issue.

Critical invariant:

> **If a symmetric signing key is shared with a service for verification, that service can also sign.**

This is why HS256 is often dangerous in distributed authentication systems. It can be fine in small systems, but it has a poor trust boundary when many consumers verify tokens.

### 4.2 Asymmetric key pair

An asymmetric key pair has a private key and public key.

Examples:

- JWT RS256/ES256/EdDSA signing.
- OIDC ID token signing.
- SAML assertion signing.
- private key JWT client authentication.
- TLS server certificate.
- mTLS client certificate.
- WebAuthn credential key pair.

Properties:

- Private key signs/decrypts/authenticates.
- Public key verifies/encrypts/trusts.
- Verifiers do not need signing authority.
- Better separation of issuer and resource server.
- More lifecycle complexity.

Critical invariant:

> **Only the authority that is allowed to issue identity assertions should hold the private signing key.**

### 4.3 Certificate

A certificate binds a public key to identity metadata under a certificate authority or trust model.

Examples:

- TLS server certificate.
- mTLS client certificate.
- SAML signing certificate in metadata.
- OIDC signing certificate represented in JWK x5c.

A certificate is not merely a public key. It is a signed statement about the public key.

Critical invariant:

> **Trusting a certificate means trusting its issuer chain, its validity period, its identity binding, and its intended usage.**

### 4.4 Derived key

A derived key is produced from another secret and context information.

Examples:

- HKDF-derived per-service signing key.
- KDF-derived encryption and MAC keys from a master secret.
- protocol-specific derived traffic keys.

Derived keys are useful when a root secret should not be reused directly for many purposes.

Critical invariant:

> **A derived key must be bound to purpose, context, and algorithm. Never derive one generic key and reuse it everywhere.**

### 4.5 Trust anchor

A trust anchor is the root from which other trust decisions are made.

Examples:

- root CA certificate in truststore.
- pinned public key.
- OIDC issuer metadata URL trusted by configuration.
- SAML IdP metadata signing certificate.
- KMS key policy root.

Critical invariant:

> **Trust anchors should change rarely, be reviewed heavily, and be more protected than operational keys.**

---

## 5. Key Purpose: Never Mix Uses

The most important key-management rule after “do not leak keys” is:

> **One key, one purpose, one trust boundary.**

Bad design:

```text
AUTH_MASTER_SECRET used for:
- session signing
- password reset token signing
- email verification token signing
- remember-me encryption
- internal API HMAC
- webhook signing
```

This creates catastrophic coupling. If the key leaks, every authentication-adjacent mechanism fails at once.

Better design:

```text
session-cookie-mac:v3
password-reset-token-signing:v2
email-verification-token-signing:v5
remember-me-token-aead:v1
partner-api-hmac:partner-123:v4
webhook-signing:tenant-77:v8
```

Even better, encode purpose into the metadata and possibly into key derivation context:

```text
root/auth-prod-2026-01
  -> hkdf(info="session-cookie-mac:prod:v3")
  -> hkdf(info="password-reset-token-signing:prod:v2")
  -> hkdf(info="webhook-signing:tenant-77:prod:v8")
```

Do not over-engineer every small service with hierarchical derivation if your KMS already manages separate data keys. But the principle remains: **cryptographic separation should match trust-boundary separation**.

---

## 6. Java Key Material Vocabulary

Java has several key-related abstractions.

### 6.1 `Key`

Base interface for keys.

Subtypes:

- `SecretKey`
- `PublicKey`
- `PrivateKey`

### 6.2 `SecretKey`

Used for symmetric algorithms:

- HMAC
- AES
- KDF input/output depending on API

### 6.3 `PrivateKey`

Used for asymmetric private operations:

- signing
- client authentication
- key agreement depending on algorithm
- TLS private key usage

### 6.4 `PublicKey`

Used for asymmetric public operations:

- signature verification
- identity binding through certificate

### 6.5 `Certificate`

Represents public key plus signed metadata.

Java typically uses `java.security.cert.X509Certificate` for TLS/mTLS/SAML/OIDC certificate handling.

### 6.6 `KeyStore`

A storage abstraction for keys and certificates.

Typical entries:

| Entry | Meaning |
|---|---|
| `PrivateKeyEntry` | private key plus certificate chain |
| `SecretKeyEntry` | symmetric secret key |
| `TrustedCertificateEntry` | trusted certificate without private key |

Mental model:

```text
KeyStore = protected local container for key/certificate entries
TrustStore = KeyStore used as trust anchor container
```

A truststore is not a different Java class. It is a keystore used for a different purpose.

---

## 7. Java 8–25 Evolution Relevant to Authentication Key Management

### 7.1 Java 8 baseline

Java 8 already gives you the main primitives:

- `KeyStore`
- `KeyPairGenerator`
- `KeyGenerator`
- `SecureRandom`
- `Signature`
- `Mac`
- `Cipher`
- `KeyFactory`
- `SecretKeyFactory`
- `CertificateFactory`
- JSSE TLS APIs
- JAAS/GSS/Kerberos APIs

But practical issues are common:

- PEM handling is awkward without libraries.
- PKCS#8 vs PKCS#1 confusion is common.
- JKS legacy usage is still widespread.
- Secrets are often loaded into `String` accidentally.
- Frameworks hide key handling until rotation fails.

### 7.2 Java 9–17 era

Important practical changes:

- module system affects provider visibility and internal API access;
- default keystore behavior moved toward PKCS12 in modern Java distributions;
- TLS defaults became stronger over time;
- older algorithms became disabled or discouraged through security properties.

### 7.3 Java 21 era

Java 21 is a common production LTS target. Most authentication systems on Java 21 still use familiar APIs, but concurrency and deployment models have shifted:

- virtual threads may change request execution behavior;
- cloud-native secret injection is more common;
- containerized workloads rely more on environment, mounted files, sidecars, IAM roles, and KMS/HSM integrations;
- service-to-service authentication tends to use OAuth2, mTLS, or workload identity.

### 7.4 Java 25 era

Java 25 matters for this part because:

- JEP 510 finalizes a standard KDF API.
- JEP 470 introduces preview APIs for PEM encoding/decoding of cryptographic objects.

This matters operationally because many authentication systems consume keys as PEM files, JWKs, X.509 certificates, PKCS#8 private keys, and derived keys. Cleaner platform support reduces the chance of ad-hoc parsing bugs, but it does not replace lifecycle design.

---

## 8. Keystore, Truststore, PEM, JWK, and KMS: Choosing the Right Container

Authentication engineers must distinguish between key **format**, key **container**, and key **authority**.

### 8.1 Format

Format describes how key material is encoded.

Examples:

- DER
- PEM
- PKCS#8
- PKCS#1
- X.509 certificate
- JWK
- PKCS12

### 8.2 Container

Container describes where one or many keys are stored.

Examples:

- Java KeyStore file
- PKCS12 file
- Kubernetes Secret
- AWS Secrets Manager
- AWS SSM Parameter Store
- Azure Key Vault
- GCP Secret Manager
- HSM
- KMS
- database table with encrypted values

### 8.3 Authority

Authority describes who is trusted to issue, sign, decrypt, or authenticate.

Examples:

- OIDC issuer
- SAML IdP
- internal CA
- external public CA
- authorization server
- KMS key policy
- security operations team

A common mistake is treating a key format decision as a security architecture decision.

For example:

```text
“We store it as PEM, so it is secure.”
```

Wrong. PEM is an encoding format. It says little about who can read the file, how it is rotated, whether it is encrypted, whether access is audited, or whether a verifier can misuse it.

---

## 9. KeyStore vs TrustStore Mental Model

### 9.1 KeyStore

A keystore usually answers:

> “What private or secret keys does this application possess?”

Examples:

- TLS server private key.
- mTLS client private key.
- SAML SP signing key.
- JWT issuer private key.
- HMAC secret.

### 9.2 TrustStore

A truststore usually answers:

> “Which public authorities or certificates does this application trust?”

Examples:

- trusted CA for outbound HTTPS.
- private CA for mTLS clients.
- partner CA for partner API.
- pinned IdP signing certificate.

### 9.3 Failure mode: mixing possession and trust

Bad:

```text
One file contains:
- application private key
- trusted root CA
- partner client certs
- old test CA
- staging issuer certificate
```

This makes trust review difficult and may accidentally trust non-production issuers.

Better:

```text
app-tls-keystore.p12
outbound-public-ca-truststore.p12
partner-mtls-client-truststore.p12
saml-idp-truststore.p12
oidc-jwks-cache managed separately
```

Separation makes blast radius and audit easier.

---

## 10. Key Identity: `kid`, Alias, Fingerprint, Serial Number

A key without identity cannot be safely rotated.

Different ecosystems identify keys differently:

| Context | Common key identifier |
|---|---|
| Java KeyStore | alias |
| JWT/JWK | `kid` |
| X.509 | serial number, subject, SKI/AKI, fingerprint |
| SAML metadata | certificate, key descriptor, entity ID |
| HMAC partner API | key ID / client ID / access key ID |
| KMS | key ID / key ARN / version |
| database secrets | key version column |

Top-tier rule:

> **Every authentication token, assertion, signature, or encrypted payload should be traceable to the key version that created it.**

For JWT, this usually means `kid` in header.

For HMAC request signing, this usually means an access key ID header.

For session cookies, the key version may be embedded in the token envelope:

```text
v3.base64url(payload).base64url(mac)
```

For SAML, metadata and certificate fingerprint must be traceable.

For password pepper, the user credential row may include pepper version or hash scheme version.

---

## 11. Key States and Rotation Windows

A realistic key lifecycle has overlapping states.

### 11.1 Signing key lifecycle

For signing keys:

```text
PREPARED
  key generated, published for verification, not yet used for signing

ACTIVE_SIGNING
  issuer signs new tokens/assertions with this key

VERIFY_ONLY
  issuer no longer signs new tokens, but verifiers still accept old tokens

RETIRED
  key no longer needed for valid tokens/assertions

REVOKED
  key considered compromised or invalid before normal expiry

DESTROYED
  private material removed or KMS version disabled/deleted
```

The most common JWT rotation failure is skipping `PREPARED` and `VERIFY_ONLY`.

Bad rollout:

```text
T0: issuer starts signing with new key
T0: resource servers have not fetched new JWKS yet
T0: valid users receive tokens that resource servers reject
```

Better rollout:

```text
T0: generate key K2
T1: publish K2 public key in JWKS, still sign with K1
T2: wait for JWKS cache propagation
T3: sign new tokens with K2
T4: keep K1 in JWKS until all K1 tokens expire
T5: remove K1 from JWKS
```

### 11.2 Encryption key lifecycle

Encryption keys differ from signing keys.

For encryption:

```text
ACTIVE_ENCRYPT_AND_DECRYPT
  used for new encryption and old decryption

DECRYPT_ONLY
  no new encryption, but old ciphertext still readable

RETIRED
  no ciphertext remains that requires this key

DESTROYED
  key unavailable; old ciphertext unrecoverable
```

Mistake:

> Rotating encryption keys as if they were signing keys.

If old data remains encrypted with old keys, you still need old keys for decryption unless you re-encrypt the data.

### 11.3 HMAC key lifecycle

HMAC keys for request signing often need two-sided coordination.

```text
client and server both know K1
server creates K2 as pending
client receives K2
client starts signing with K2 and sends keyId=K2
server accepts K1 and K2
server disables K1 after grace period
```

Never assume both sides rotate at the same instant.

---

## 12. Rotation Patterns

### 12.1 Scheduled rotation

Keys rotate on a planned cadence.

Good for:

- JWT signing keys.
- session signing keys.
- API HMAC secrets.
- webhook secrets.
- mTLS client certificates.

Risks:

- creates operational burden;
- if too frequent, causes incidents;
- if too rare, increases compromise impact.

### 12.2 Event-driven rotation

Keys rotate because something happened:

- employee access incident;
- suspected leak;
- vendor compromise;
- key observed in logs;
- certificate expiry near miss;
- algorithm deprecation;
- environment migration.

This requires an emergency procedure.

### 12.3 Lazy rotation

Key is rotated when entity next authenticates or updates credentials.

Examples:

- password hash algorithm migration;
- pepper version migration on next successful login;
- API key migration when client calls management endpoint.

Useful, but incomplete for inactive accounts.

### 12.4 Dual-read single-write

For key-based verification:

```text
write/sign with new key
read/verify with old + new keys
```

Examples:

- session MAC key rotation;
- JWT verification across old and new keys;
- password hash migration accepting old scheme.

### 12.5 Dual-publish delayed-use

For distributed verifiers:

```text
publish new verification key first
wait
start signing with new key
```

This is critical for JWKS-based systems.

### 12.6 Re-encryption migration

For encrypted data:

```text
read with old key
write back with new key
```

This can be:

- online lazy re-encryption;
- batch re-encryption;
- envelope key re-wrapping;
- full data rewrite.

---

## 13. Envelope Encryption Mental Model

Envelope encryption is a common production pattern.

```text
KMS master key / key encryption key (KEK)
        |
        | wraps / unwraps
        v
Data encryption key (DEK)
        |
        | encrypts application data/token/secret
        v
Ciphertext
```

Why this helps:

- master key stays in KMS/HSM;
- application can store encrypted DEK with ciphertext;
- DEK rotation and KEK rotation can be separated;
- KMS access can be audited;
- compromise of database alone may not reveal plaintext.

For authentication systems, this is useful for:

- storing OAuth client secrets;
- storing partner API secrets;
- storing refresh tokens if they must be recoverable;
- storing private keys encrypted at rest;
- encrypting sensitive IdP metadata or tenant secrets.

But be careful:

> Envelope encryption protects storage. It does not protect keys while actively used in application memory.

If the application can decrypt, a compromised application process can often access plaintext during runtime.

---

## 14. KMS, HSM, Secret Manager, and Local Keystore

### 14.1 Local keystore

Good for:

- simple deployment;
- legacy Java app servers;
- offline apps;
- mTLS private key file;
- internal services with mounted secrets.

Weaknesses:

- file distribution problem;
- file permission mistakes;
- harder centralized audit;
- rotation requires deployment coordination;
- secrets may be copied too widely.

### 14.2 Secret manager

Examples:

- AWS Secrets Manager.
- AWS SSM Parameter Store.
- Azure Key Vault Secrets.
- GCP Secret Manager.
- HashiCorp Vault KV.

Good for:

- storing API keys;
- storing OAuth client secrets;
- injecting HMAC secrets;
- application-level secret retrieval.

Weaknesses:

- app receives plaintext;
- IAM policy errors expose secrets;
- startup dependency;
- caching and refresh design needed.

### 14.3 KMS

KMS often allows cryptographic operations or envelope wrapping without exposing master keys.

Good for:

- envelope encryption;
- central audit;
- policy-controlled key use;
- disable/revoke key quickly;
- tenant/environment separation.

Weaknesses:

- latency;
- quota;
- availability dependency;
- not all authentication protocols can call KMS per request;
- signing with KMS may be too slow for high-QPS JWT issuance unless carefully designed.

### 14.4 HSM

HSM offers stronger physical/logical protection.

Good for:

- high-assurance signing keys;
- government/regulatory contexts;
- CA private keys;
- root keys;
- non-exportable private key requirements.

Weaknesses:

- operational complexity;
- cost;
- integration complexity;
- throughput planning;
- disaster recovery complexity.

### 14.5 Decision heuristic

| Use case | Suitable storage/use model |
|---|---|
| TLS private key for app server | keystore, secret mount, cert manager, or HSM depending assurance |
| JWT issuer private key | KMS/HSM for high assurance; keystore/secret manager for moderate assurance |
| JWT verifier public keys | JWKS cache, config, truststore depending ecosystem |
| HMAC partner secrets | secret manager or encrypted DB with KMS envelope |
| Password pepper | KMS/secret manager/HSM, not same DB as password hashes |
| Session MAC key | secret manager/KMS-derived local cache |
| SAML signing key | keystore/HSM, strong metadata and rotation process |
| mTLS CA trust | truststore/cert manager/service mesh trust bundle |

---

## 15. Key Generation

Key generation is not a place for creativity.

### 15.1 Use strong randomness

In Java:

```java
SecureRandom random = SecureRandom.getInstanceStrong();
```

But be careful: `getInstanceStrong()` may block or be slower depending platform. For many production systems, default `new SecureRandom()` is backed by a strong provider and is suitable, but you should understand your runtime environment.

For symmetric HMAC keys:

```java
KeyGenerator keyGenerator = KeyGenerator.getInstance("HmacSHA256");
keyGenerator.init(256);
SecretKey key = keyGenerator.generateKey();
```

For RSA:

```java
KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
generator.initialize(3072);
KeyPair pair = generator.generateKeyPair();
```

For EC:

```java
KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
generator.initialize(new ECGenParameterSpec("secp256r1"));
KeyPair pair = generator.generateKeyPair();
```

Provider support varies by Java version and provider.

### 15.2 Never use human-generated secrets for cryptographic keys

Bad:

```text
AUTH_SECRET=company-name-prod-secret-2026
```

Better:

```text
32+ bytes from cryptographic random source, encoded with base64url
```

For HMAC-SHA-256, use at least 256 bits of random secret.

### 15.3 Separate identifier from secret

Bad API key:

```text
apiKey = randomSecretOnly
```

Better:

```text
accessKeyId = ak_prod_7N2...
secretKey = 256-bit random secret shown once
server stores hash(secretKey), not plaintext if verification model allows
```

The ID lets the server locate metadata without scanning all secrets.

---

## 16. Key Storage in Java Applications

### 16.1 Avoid storing secrets as `String`

`String` is immutable and may remain in memory until GC. You cannot reliably wipe it.

Prefer:

- `char[]` for passwords where APIs allow;
- `byte[]` for raw secret material where APIs allow;
- provider-backed `Key` objects;
- non-exportable keys in KMS/HSM when possible.

Reality check:

Many Java APIs and frameworks still expose strings. Be pragmatic, but do not add unnecessary `String` copies.

### 16.2 Do not log key material

Obvious, but common in failure debugging.

Never log:

- private keys;
- secret keys;
- bearer tokens;
- authorization headers;
- refresh tokens;
- password reset tokens;
- raw API keys;
- HMAC canonical secret;
- decrypted keystore password.

Safe logs:

```text
keyId=jwt-signing-prod-2026-01
fingerprint=SHA256:abc123...
issuer=https://idp.example.com
algorithm=RS256
state=ACTIVE_SIGNING
```

### 16.3 Mount vs environment variable

Environment variables are convenient but risky:

- visible in process environment;
- sometimes exposed in crash dumps;
- may leak through debugging endpoints;
- hard to rotate without process restart.

Mounted secret files can be better:

- can support file watcher reload;
- easier to set file permissions;
- less likely to appear in process listings;
- still readable by the process.

Neither is magic. The real control is least privilege, audit, rotation, and blast-radius design.

---

## 17. Public Key Distribution: JWKS, Metadata, Truststores

### 17.1 JWKS for JWT/OIDC

JWKS exposes public verification keys.

Important fields:

- `kid`
- `kty`
- `alg` if used carefully
- `use`
- `n`/`e` for RSA
- `crv`/`x`/`y` for EC
- `x5c` if certificate chain included

Critical rules:

1. Do not trust arbitrary `jku` or `x5u` headers from tokens unless explicitly pinned and validated.
2. Fetch JWKS only from trusted issuer metadata/configuration.
3. Cache JWKS, but respect rotation windows.
4. On unknown `kid`, refresh JWKS carefully with rate limiting to avoid DoS.
5. Do not accept keys from a different issuer.

### 17.2 SAML metadata

SAML trust often comes from metadata:

- entity ID;
- SSO endpoint;
- signing certificate;
- encryption certificate;
- binding information.

Key management concern:

> SAML certificate rollover must be coordinated before assertion signing changes.

### 17.3 Truststore for TLS/mTLS

Truststores define accepted CAs/certificates.

For mTLS, truststore design is critical:

- public internet CAs usually should not be accepted for internal client identity;
- partner CAs should be separated from internal workload CAs;
- staging and production CAs must not be mixed;
- certificate subject/SAN mapping must be strict.

---

## 18. Algorithm Selection and Agility

Key management includes algorithm agility.

Algorithm agility means:

> The system can migrate from one algorithm/key type to another without a total rewrite or forced outage.

Examples:

- HS256 to RS256.
- RS256 to ES256.
- RSA 2048 to RSA 3072.
- old SAML signing cert to new signing cert.
- SHA-1 fingerprint assumptions to SHA-256.
- legacy JKS to PKCS12.
- ad-hoc PEM parsing to Java 25 PEM API or vetted libraries.

### 18.1 Store algorithm with key metadata

Do not assume globally.

```json
{
  "kid": "jwt-prod-2026-01",
  "alg": "RS256",
  "purpose": "oidc-id-token-signing",
  "state": "ACTIVE_SIGNING",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### 18.2 Never let untrusted token header choose algorithm alone

A JWT header says what algorithm was used. Your verifier must still enforce what algorithms are allowed for that issuer/client/use case.

Bad:

```text
read alg from token
verify using whatever alg says
```

Better:

```text
issuer config allows only RS256 and ES256
kid resolves to key metadata
key metadata says alg=RS256
verification requires token alg == configured alg == key alg
```

---

## 19. Java Implementation Patterns

### 19.1 Loading a PKCS12 keystore

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class KeyStoreLoader {
    public static KeyStore loadPkcs12(Path path, char[] password) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(path)) {
            keyStore.load(in, password);
        }
        return keyStore;
    }
}
```

Production notes:

- Do not hardcode password.
- Do not store keystore password beside keystore with same permissions.
- Prefer secret manager/KMS/HSM for higher assurance.
- Clear password arrays after use where practical.

### 19.2 Getting a private key entry

```java
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;

public final class PrivateKeyResolver {
    public static PrivateKey privateKey(
            KeyStore keyStore,
            String alias,
            char[] keyPassword
    ) throws Exception {
        KeyStore.ProtectionParameter protection =
                new KeyStore.PasswordProtection(keyPassword);

        KeyStore.Entry entry = keyStore.getEntry(alias, protection);
        if (!(entry instanceof KeyStore.PrivateKeyEntry privateKeyEntry)) {
            throw new IllegalStateException("Alias is not a private key entry: " + alias);
        }
        return privateKeyEntry.getPrivateKey();
    }

    public static Certificate certificate(KeyStore keyStore, String alias) throws Exception {
        Certificate certificate = keyStore.getCertificate(alias);
        if (certificate == null) {
            throw new IllegalStateException("Missing certificate for alias: " + alias);
        }
        return certificate;
    }
}
```

For Java 8 compatibility, avoid pattern matching:

```java
if (!(entry instanceof KeyStore.PrivateKeyEntry)) {
    throw new IllegalStateException("Alias is not a private key entry: " + alias);
}
KeyStore.PrivateKeyEntry privateKeyEntry = (KeyStore.PrivateKeyEntry) entry;
```

### 19.3 Signing with explicit algorithm

```java
import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;

public final class Signer {
    public static String signBase64Url(PrivateKey privateKey, byte[] payload) throws Exception {
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(privateKey);
        signature.update(payload);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign());
    }
}
```

Do not let external input decide `Signature.getInstance(...)`.

### 19.4 HMAC with versioned key

```java
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import java.util.Base64;

public final class HmacSigner {
    private final String keyId;
    private final SecretKey key;

    public HmacSigner(String keyId, SecretKey key) {
        this.keyId = keyId;
        this.key = key;
    }

    public SignedValue sign(byte[] canonicalPayload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(key);
        byte[] signature = mac.doFinal(canonicalPayload);
        return new SignedValue(
                keyId,
                Base64.getUrlEncoder().withoutPadding().encodeToString(signature)
        );
    }

    public record SignedValue(String keyId, String signature) {}
}
```

For Java 8, use a normal class instead of `record`.

### 19.5 Constant-time comparison

For MAC/signature byte comparison where you compare raw computed MAC bytes:

```java
import java.security.MessageDigest;

public final class ConstantTime {
    public static boolean equal(byte[] expected, byte[] actual) {
        return MessageDigest.isEqual(expected, actual);
    }
}
```

Avoid string equality for secrets/signatures when byte-level constant-time comparison is appropriate.

---

## 20. Key Rotation Implementation Pattern: In-Memory Key Ring

Many authentication components need a key ring.

```text
KeyRing
  activeSigningKeyId
  keysById
    K1: VERIFY_ONLY
    K2: ACTIVE_SIGNING
    K3: PRE_ACTIVE
```

### 20.1 Conceptual Java model

```java
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

public final class KeyRing<K> {
    private final String activeKeyId;
    private final Map<String, VersionedKey<K>> keys;

    public KeyRing(String activeKeyId, Map<String, VersionedKey<K>> keys) {
        this.activeKeyId = activeKeyId;
        this.keys = Map.copyOf(keys);
    }

    public VersionedKey<K> activeSigningKey() {
        VersionedKey<K> key = keys.get(activeKeyId);
        if (key == null || key.state() != KeyState.ACTIVE_SIGNING) {
            throw new IllegalStateException("Active signing key is missing or not active: " + activeKeyId);
        }
        return key;
    }

    public Optional<VersionedKey<K>> verificationKey(String keyId) {
        VersionedKey<K> key = keys.get(keyId);
        if (key == null) {
            return Optional.empty();
        }
        if (!key.state().canVerify()) {
            return Optional.empty();
        }
        return Optional.of(key);
    }

    public enum KeyState {
        PRE_ACTIVE,
        ACTIVE_SIGNING,
        VERIFY_ONLY,
        RETIRED,
        REVOKED;

        public boolean canVerify() {
            return this == ACTIVE_SIGNING || this == VERIFY_ONLY;
        }
    }

    public record VersionedKey<K>(
            String keyId,
            String algorithm,
            String purpose,
            KeyState state,
            Instant notBefore,
            Instant notAfter,
            K material
    ) {}
}
```

Java 8 version: replace `record`, `Map.copyOf`, and switch features with ordinary classes and defensive copies.

### 20.2 Important behavior

When signing:

```text
always use activeSigningKey()
```

When verifying:

```text
use keyId from token/signature envelope
resolve exact key
verify only if state allows verification
verify algorithm, purpose, issuer, audience, time
```

Never simply try every key unless the format has no key ID. Trying every key creates ambiguity, performance risk, and weaker auditability.

---

## 21. JWT Signing Key Rotation

### 21.1 Correct mental model

JWT signing has two sides:

```text
Issuer signs with private key.
Resource servers verify with public key.
```

Key rotation must coordinate:

- issuer active signing key;
- JWKS publication;
- resource server JWKS cache;
- token maximum lifetime;
- clock skew;
- emergency revocation.

### 21.2 Timeline

```text
T0  Generate K2
T1  Publish K2 in JWKS as verification key
T2  Wait > max JWKS cache TTL
T3  Start signing with K2
T4  Keep K1 in JWKS for max token lifetime + clock skew
T5  Remove K1 from JWKS
T6  Retire/destroy K1 private material if no longer needed
```

### 21.3 Failure modes

| Failure | Impact |
|---|---|
| new signing key not published | valid tokens rejected |
| old key removed too early | active users logged out / API failures |
| reused `kid` with new material | cache confusion, verification failure |
| same key across environments | staging token accepted in prod if issuer/audience checks weak |
| symmetric key shared with resource servers | resource servers can forge tokens |
| accepting unknown issuer JWKS | token substitution |

### 21.4 Rule

> **JWT rotation is not just key replacement. It is distributed cache choreography.**

---

## 22. Session Signing Key Rotation

Many Java applications sign session-like tokens, remember-me cookies, CSRF tokens, or stateless authentication cookies.

A robust envelope:

```text
version.keyId.issuedAt.expiry.payload.signature
```

Verification:

1. parse envelope;
2. reject unsupported version;
3. resolve key by key ID;
4. check key state allows verification;
5. recompute MAC/signature over canonical bytes;
6. constant-time compare;
7. validate expiry and context binding;
8. optionally reissue using active key.

Rotation pattern:

```text
K1 active
K2 prepared
K2 active for new tokens
K1 verify-only until old cookies expire
K1 retired
```

Do not invalidate all sessions during routine key rotation unless explicitly intended.

---

## 23. Password Pepper Key Management

A pepper is a secret added to password hashing design, usually stored outside the password database.

Important distinction:

```text
salt: public, per-password, stored with hash
pepper: secret, global or scoped, stored outside DB
```

### 23.1 Pepper benefits

If the password database leaks but pepper remains secret, offline cracking becomes harder.

### 23.2 Pepper risks

If pepper leaks, all password hashes protected by it lose that extra protection.

### 23.3 Pepper rotation problem

Unlike normal keys, password pepper rotation is hard because you usually cannot recompute password hash without the user password.

Patterns:

1. **Lazy migration on login**
   - verify with old pepper;
   - when user logs in successfully, rehash with new pepper;
   - update pepper version.

2. **Layered HMAC pepper**
   - password hash stored as `HMAC(pepper, passwordHash)`;
   - may allow wrapping migration if original password hash retained;
   - design carefully to avoid weakening storage.

3. **Force password reset after compromise**
   - if pepper is compromised, large-scale reset may be required.

Schema example:

```text
user_credentials
- user_id
- password_hash
- password_algorithm
- password_parameters
- salt
- pepper_version
- created_at
- upgraded_at
```

Critical invariant:

> **Pepper must not live in the same database backup as the password hashes it protects.**

---

## 24. API Key and HMAC Secret Management

For partner/client API keys, separate identity from secret.

```text
client_id: partner-abc
access_key_id: ak_prod_2026_001
secret_hash: hash(secret) or encrypted secret if raw needed
status: active / suspended / rotated / revoked
scopes: [...]
tenant_id: ...
created_at
last_used_at
expires_at
rotation_due_at
```

### 24.1 Store hash when possible

For API bearer keys:

- generate random key;
- show once;
- store keyed hash or password-style hash depending use case;
- compare presented key to stored verifier.

For HMAC request signing, server usually needs raw secret or a decryptable secret to recompute signature.

Options:

1. Store encrypted secret with KMS envelope.
2. Store secret in dedicated secret manager and reference by key ID.
3. Use asymmetric request signing instead of HMAC when feasible.

### 24.2 Rotation

Support overlapping keys:

```text
client partner-abc:
  ak_old: VERIFY_ONLY until 2026-02-01
  ak_new: ACTIVE
```

Clients must send key ID so server can choose the right secret.

---

## 25. mTLS Certificate Key Management

mTLS key management has two sides:

1. private key and certificate possession;
2. truststore and identity mapping.

### 25.1 Private key lifecycle

For a client certificate:

```text
key pair generated
CSR submitted
certificate issued
certificate installed
client authenticates
certificate renewed
old certificate overlap
old certificate revoked/expired
private key destroyed
```

### 25.2 Trust bundle lifecycle

For a server verifying mTLS clients:

```text
trust CA bundle v1
publish CA bundle v2 with old+new CA
issue new client certs from new CA
wait for migration
remove old CA
```

### 25.3 Identity mapping

Never map blindly from full DN string unless controlled.

Prefer stable, explicit identifiers:

- SAN URI;
- SAN DNS for workloads;
- SPIFFE ID in service mesh contexts;
- certificate policy OID;
- pinned issuer + SAN pattern;
- explicit certificate fingerprint for small partner integrations.

Bad:

```text
CN=payment-service means service is payment-service
```

Better:

```text
issuer == internal-workload-ca-prod
SAN URI == spiffe://prod/ns/payment/sa/payment-service
certificate not expired
EKU allows client auth
mapped principal == service:payment-service
```

---

## 26. SAML Signing Key Management

SAML key management often fails because metadata rollover is treated as paperwork instead of runtime dependency.

### 26.1 SP trusts IdP signing key

The service provider verifies SAML assertions using the IdP certificate from metadata or pinned configuration.

If IdP rotates signing cert without SP update:

```text
all logins fail
```

### 26.2 Correct rollover

```text
IdP publishes metadata with old + new signing certificates
SP imports metadata and trusts both during overlap
IdP begins signing with new key
SP continues accepting old during grace window if needed
old cert removed after all old assertions expire
```

### 26.3 Failure modes

- accepting unsigned assertions;
- trusting metadata from untrusted URL;
- no certificate pinning or metadata signature verification;
- accepting assertions signed by old compromised certificate;
- no clock-skew handling;
- IdP-initiated SSO accepting wrong audience.

---

## 27. OIDC/JWKS Key Management

OIDC usually relies on issuer discovery and JWKS.

### 27.1 Trust chain

```text
configured issuer URL
  -> discovery document
  -> jwks_uri
  -> JWK set
  -> token kid
  -> public key
  -> signature verification
```

Every arrow is a trust decision.

### 27.2 Hard rules

1. Configure expected issuer explicitly.
2. Validate `iss` exactly.
3. Validate `aud` and/or `azp` as required.
4. Resolve keys only from the trusted issuer JWKS.
5. Enforce allowed algorithms.
6. Cache JWKS but refresh safely on unknown `kid`.
7. Keep old keys until token expiry.
8. Monitor unknown `kid` spikes.

### 27.3 Multi-tenant OIDC warning

Do not use token issuer dynamically without tenant binding.

Bad:

```text
read iss from token
fetch that issuer metadata
trust whatever it returns
```

Better:

```text
tenant resolved from request host/path/client config
allowed issuer for tenant loaded from config/database
only that issuer accepted
JWKS resolved from that configured issuer
```

---

## 28. Key Management for Multi-Tenant Systems

Multi-tenant authentication raises a core question:

> Are keys shared globally, per environment, per tenant, per client, per issuer, or per service?

### 28.1 Shared global key

Pros:

- simple;
- fewer keys;
- easier startup.

Cons:

- huge blast radius;
- difficult tenant isolation;
- audit weak;
- rotation affects everyone.

### 28.2 Per-tenant key

Pros:

- strong isolation;
- tenant-specific revocation;
- audit clarity;
- easier compliance story.

Cons:

- more operational complexity;
- more JWKS/metadata complexity;
- more cache pressure;
- more rotation orchestration.

### 28.3 Per-client key

Common for:

- API keys;
- HMAC secrets;
- webhook signing;
- OAuth confidential clients;
- private key JWT.

### 28.4 Decision rule

Use separate keys where compromise blast radius must be separate.

For regulatory systems, tenant/environment separation is usually non-negotiable:

```text
prod keys != uat keys != dev keys
agency A keys != agency B keys if cross-agency trust isolation matters
external partner keys are never reused internally
```

---

## 29. Key Access Control

Key management is access management.

Ask for every key:

1. Who can create it?
2. Who can read/export it?
3. Who can use it without reading it?
4. Who can rotate it?
5. Who can disable it?
6. Who can delete it?
7. Who can change its policy?
8. Which workload identity can access it?
9. Which environment can access it?
10. Which audit logs prove access?

### 29.1 Read vs use

KMS/HSM can enforce:

```text
service can sign with key
but cannot export private key
```

This is stronger than storing a private key in a secret manager.

### 29.2 Least privilege examples

Bad:

```text
all services can read all prod secrets
```

Better:

```text
auth-service can use jwt-signing-prod key
resource-service can read JWKS public keys only
api-gateway can read session-cookie-mac key
worker-service cannot access web session keys
```

---

## 30. Audit and Forensics

A production authentication key system should answer:

- Which key signed this token?
- Which key verified this request?
- When was the key activated?
- Who rotated it?
- Which workload used it?
- Was key usage normal?
- Were there unknown `kid` attempts?
- Did any environment use a production key unexpectedly?
- Did any logs expose token/key material?

### 30.1 Log key metadata, not key material

Good event:

```json
{
  "event": "jwt_token_issued",
  "issuer": "https://auth.prod.example.com",
  "subject": "user:12345",
  "audience": "case-api",
  "kid": "jwt-prod-2026-01",
  "alg": "RS256",
  "token_ttl_seconds": 900,
  "correlation_id": "...",
  "issued_at": "2026-01-15T10:00:00Z"
}
```

Bad event:

```json
{
  "access_token": "eyJ...",
  "private_key": "-----BEGIN PRIVATE KEY-----..."
}
```

### 30.2 Monitor key anomalies

Useful metrics:

- token verification failures by `kid`;
- unknown `kid` count;
- JWKS refresh count;
- KMS decrypt/sign latency;
- KMS access denied count;
- soon-to-expire certificates;
- expired certificate usage;
- old key still used after migration;
- API requests using deprecated key ID;
- secret access outside normal deployment windows.

---

## 31. Failure Modeling

### 31.1 Key leak

Questions:

- Which systems used the key?
- Could the key sign or only verify?
- Could attackers decrypt data or only forge tokens?
- What is maximum token lifetime?
- Can we revoke immediately?
- Are old tokens distinguishable by `kid`?
- Are logs sufficient to detect abuse?

Response:

```text
1. mark key compromised
2. stop signing/using it immediately
3. publish new key if needed
4. revoke/disable old key
5. reduce acceptance window
6. invalidate tokens/sessions signed by compromised key if feasible
7. inspect logs by kid/fingerprint
8. rotate derived/dependent keys if needed
9. notify impacted parties if required
10. improve controls that allowed leak
```

### 31.2 Key expiry

If certificate expires:

- TLS may fail.
- mTLS clients may fail authentication.
- SAML login may fail.
- JWT x5c trust may fail depending verifier.

Prevention:

- expiration dashboard;
- alerts at 90/60/30/14/7/1 days;
- automated renewal where safe;
- manual approval for high-risk trust anchors;
- overlap deployment.

### 31.3 JWKS outage

Resource servers should cache JWKS.

But behavior must be deliberate:

- existing cached keys can continue verifying tokens;
- unknown `kid` may fail closed;
- excessive refresh attempts should be rate-limited;
- stale cache policy should be documented.

### 31.4 KMS outage

If KMS is required per request:

- login/token issuance may fail;
- decryption may fail;
- HMAC secret retrieval may fail;
- service startup may fail.

Design choices:

- cache decrypted data keys in memory for limited time;
- pre-warm key material;
- use circuit breakers;
- fail closed for authentication;
- provide controlled degraded mode only if risk accepted.

---

## 32. Common Anti-Patterns

### 32.1 One global auth secret

```text
AUTH_SECRET used everywhere
```

This destroys blast-radius control.

### 32.2 Hardcoded keys in code

Keys in Git history are compromised, even after deletion.

### 32.3 Same keys across environments

Dev/UAT/prod must not share signing keys, HMAC secrets, peppers, or mTLS trust roots.

### 32.4 Reusing `kid`

`kid` should identify a key version, not a logical purpose only.

Bad:

```text
kid=main
```

Better:

```text
kid=oidc-prod-rs256-2026-01
```

### 32.5 Removing old verification keys too early

Breaks active sessions/tokens.

### 32.6 Keeping old signing keys forever

Increases blast radius and confuses audit.

### 32.7 Trusting token-provided key URLs

Headers like `jku`/`x5u` are dangerous unless pinned and validated.

### 32.8 Treating public key as secret

Public keys can be public. Integrity and authenticity matter more than confidentiality.

### 32.9 Treating private key as configuration

Private keys are credentials, not ordinary config.

### 32.10 No emergency rotation path

A key rotation process tested only during normal quarterly maintenance is not enough.

---

## 33. Design Framework

When designing authentication key management, fill this table.

| Question | Answer |
|---|---|
| What does the key prove? | user auth, service auth, issuer authority, token integrity, token confidentiality, request integrity |
| Who owns the key? | auth service, tenant, partner, platform, CA, IdP |
| Who can use the key? | workload identity / human operator / CI/CD |
| Who can read/export it? | ideally nobody for private root keys; limited for secrets |
| Is it symmetric or asymmetric? | affects verifier authority |
| What is the key ID? | alias / `kid` / fingerprint / version |
| What is the algorithm? | explicit and enforced |
| What is the scope? | env, tenant, client, service, purpose |
| Where is it stored? | keystore, secret manager, KMS, HSM, JWKS, truststore |
| How is it rotated? | scheduled, event-driven, lazy, dual-publish |
| What is overlap window? | based on token/session/cert lifetime |
| How is compromise handled? | revoke, disable, publish replacement, invalidate tokens |
| How is it audited? | key usage logs, access logs, signing events |
| What breaks if unavailable? | login, verification, issuance, decryption |
| What is fallback? | cache, retry, fail-closed, emergency procedure |

---

## 34. Reference Architecture: Java OIDC Authorization Server

Scenario:

- Java authorization server issues JWT access tokens and OIDC ID tokens.
- Resource servers verify tokens using JWKS.
- Tokens live 15 minutes.
- Refresh tokens are opaque and stored hashed.
- Signing keys are RSA or EC asymmetric keys.

### 34.1 Components

```text
Auth Server
  - private signing key in KMS/HSM/secure keystore
  - active key metadata table
  - JWKS endpoint publishes public keys
  - audit logs include kid

Resource Server
  - configured issuer
  - configured audience
  - JWKS cache
  - allowed alg list
  - unknown kid refresh with rate limit

Ops
  - rotation job
  - key expiry dashboard
  - compromise playbook
```

### 34.2 Rotation timeline

```text
Day 0: Generate K2
Day 0: Publish K2 to JWKS, state PRE_ACTIVE
Day 1: Make K2 ACTIVE_SIGNING
Day 1-2: K1 VERIFY_ONLY
After max token TTL + cache TTL: remove K1 from JWKS
After audit retention decision: destroy/disable K1 private key
```

### 34.3 Invariants

- Private signing key never exists in resource server.
- Resource server does not trust token issuer dynamically.
- `kid` is unique per key version.
- Old public keys remain until all old tokens expire.
- Compromised key can be revoked faster than normal schedule.
- Audit can answer which key signed which token.

---

## 35. Reference Architecture: Java Partner API with HMAC Signing

Scenario:

- External partner calls Java API.
- Each partner has access key ID and HMAC secret.
- Requests include timestamp, nonce, body hash, key ID, signature.

### 35.1 Key model

```text
partner_api_keys
- partner_id
- access_key_id
- encrypted_secret_reference
- algorithm = HmacSHA256
- state = ACTIVE / VERIFY_ONLY / REVOKED
- scopes
- allowed_ips optional
- created_at
- expires_at
- last_used_at
```

### 35.2 Verification flow

```text
1. parse access key ID
2. load key metadata
3. reject disabled/revoked key
4. validate timestamp window
5. validate nonce not reused
6. reconstruct canonical request
7. compute HMAC
8. constant-time compare
9. check scope and partner binding
10. audit success/failure by key ID
```

### 35.3 Rotation

```text
partner creates new key
server returns new secret once
partner deploys new key
server accepts old and new temporarily
server marks old key VERIFY_ONLY or REVOKED
server alerts if old key still used after deadline
```

---

## 36. Reference Architecture: Java mTLS Internal Workload Authentication

Scenario:

- Internal services communicate using mTLS.
- Certificates are issued by internal CA or service mesh CA.
- Java services map certificate SAN to service principal.

### 36.1 Components

```text
Internal CA
  - root/intermediate keys in HSM/KMS/cert-manager/service mesh control plane

Service A
  - private key + cert
  - trust bundle for internal CA

Service B
  - private key + cert
  - trust bundle for internal CA
  - certificate-to-principal mapper
```

### 36.2 Invariants

- Production trust bundle excludes dev/staging CA.
- Client cert must have client-auth usage.
- SAN must match expected workload identity format.
- Certificate rotation has overlap.
- Expiring certificates are alerted before outage.
- Application-level authorization still checks service principal and scopes.

---

## 37. Testing Strategy

### 37.1 Unit tests

Test:

- key ID resolution;
- active signing key selection;
- verify-only key accepts old tokens;
- retired key rejects;
- algorithm mismatch rejects;
- wrong purpose rejects;
- expired key rejects;
- future `notBefore` rejects;
- constant-time comparison wrapper behavior;
- unknown key ID behavior.

### 37.2 Integration tests

Test:

- JWT rotation with JWKS cache;
- SAML cert rollover;
- mTLS truststore update;
- API HMAC key overlap;
- password pepper migration;
- KMS unavailable at startup;
- KMS unavailable during request;
- cert expiry simulation;
- wrong environment key rejection.

### 37.3 Chaos/security tests

Test:

- unknown `kid` flood;
- stale JWKS;
- revoked key still used;
- old key removed early;
- token signed by staging key presented to prod;
- SAML assertion signed by untrusted cert;
- mTLS cert from public CA when private CA expected;
- API key from tenant A used against tenant B.

---

## 38. Production Checklist

Use this checklist before approving an authentication key-management design.

### 38.1 Key metadata

- [ ] Every key has unique ID/version.
- [ ] Every key has explicit purpose.
- [ ] Every key has explicit algorithm.
- [ ] Every key has environment scope.
- [ ] Every key has tenant/client/service scope where needed.
- [ ] Every key has lifecycle state.
- [ ] Every key has creation, activation, expiry, retirement metadata.

### 38.2 Storage and access

- [ ] Private/secret keys are not in source code.
- [ ] Private/secret keys are not in ordinary config files.
- [ ] Access is least privilege.
- [ ] Production keys are separated from non-production keys.
- [ ] Read/export access is restricted.
- [ ] KMS/HSM/secret access is audited.
- [ ] Secret injection path is documented.

### 38.3 Rotation

- [ ] Rotation procedure exists.
- [ ] Emergency rotation procedure exists.
- [ ] Rotation has overlap window.
- [ ] Old verification/decryption keys are retained only as long as needed.
- [ ] Old signing/encryption use is disabled after cutover.
- [ ] Rotation is tested in lower environment.
- [ ] Alerts detect deprecated key usage.

### 38.4 Verification

- [ ] Verifier enforces issuer.
- [ ] Verifier enforces audience.
- [ ] Verifier enforces algorithm allowlist.
- [ ] Verifier resolves exact key by ID.
- [ ] Verifier rejects unknown keys safely.
- [ ] Verifier does not trust token-provided key URLs dynamically.
- [ ] Verifier handles cache refresh with rate limiting.

### 38.5 Audit

- [ ] Key ID appears in token/signature events.
- [ ] No key material appears in logs.
- [ ] Unknown key attempts are monitored.
- [ ] KMS/HSM usage is monitored.
- [ ] Certificate expiry is monitored.
- [ ] Rotation events are logged.
- [ ] Key compromise playbook is documented.

---

## 39. Design Questions for Practice

Use these questions to evaluate your own systems.

1. If the JWT signing private key leaks today, how many minutes of forged-token risk exist?
2. Can resource servers distinguish tokens signed by old vs new keys?
3. Can you revoke a single partner API key without affecting other partners?
4. Does any service that only needs verification have access to a signing secret?
5. Are dev/UAT/prod keys fully separated?
6. What happens if JWKS endpoint is down for 30 minutes?
7. What happens if KMS is slow for 10 seconds?
8. How do you know which key signed a suspicious token?
9. Can you rotate password pepper without forcing every user to reset password?
10. Can a token signed by staging IdP be accepted by production resource server?
11. Does mTLS identity mapping rely on CN only?
12. Are old SAML signing certificates still trusted after migration?
13. Who can export private keys from production?
14. Are secret access logs reviewed?
15. Is key rotation tested as part of release engineering?

---

## 40. Top 1% Mental Model

A beginner sees authentication keys as configuration.

An intermediate engineer sees them as secrets.

A senior engineer sees them as operational risk.

A top 1% engineer sees them as **distributed trust state**.

That means:

- keys have lifecycle;
- keys have state;
- keys have authority;
- keys have blast radius;
- keys have propagation delay;
- keys have audit requirements;
- keys have emergency behavior;
- keys define what a verifier is allowed to believe.

The strongest authentication protocol can fail because of weak key lifecycle. The simplest authentication protocol can become robust if key scope, rotation, and audit are handled well.

The key question is not:

```text
Where do we store the secret?
```

The real question is:

```text
What exact trust decision does this key authorize, and how do we control that trust over time?
```

---

## 41. Summary

In this part, we covered:

- why key management is the root of authentication trust;
- symmetric, asymmetric, certificate, derived, and trust-anchor keys;
- Java key abstractions from Java 8 to Java 25;
- keystore vs truststore vs PEM vs JWK vs KMS/HSM;
- key identity using alias, `kid`, fingerprint, and version;
- signing, encryption, HMAC, JWT, SAML, OIDC, mTLS, session, API key, and pepper lifecycle;
- rotation patterns such as dual-publish, dual-read single-write, verify-only, decrypt-only, and re-encryption;
- audit and forensic requirements;
- failure modeling for leaks, expiry, JWKS outage, and KMS outage;
- production checklist and reference architectures.

The central invariant:

> **Authentication trust is only as strong as the lifecycle of the keys that create, verify, protect, or revoke that trust.**

---

## 42. Where This Fits in the Series

You now have the foundation for the next topics:

- Part 25 will discuss identity provider integration patterns.
- Part 26 will expand key and issuer trust into multi-tenant authentication architecture.
- Part 27 will apply these ideas to distributed microservices.
- Part 28 will carry authentication identity into messaging, jobs, and event-driven systems.

Key management is the bridge between protocol knowledge and production authentication architecture.

---

# End of Part 24


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-023.md">⬅️ Part 23 — Token Lifecycle Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-025.md">Part 25 — Identity Provider Integration Patterns ➡️</a>
</div>
