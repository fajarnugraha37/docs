# learn-java-security-cryptography-integrity-part-001

# Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `001`  
> Status seri: **belum selesai** — ini adalah Part 1 dari 35, yaitu Part 0 sampai Part 34.  
> Fokus: memahami peta besar arsitektur security Java sebelum masuk ke primitive kriptografi, TLS, certificate, token, audit integrity, dan supply chain security.

---

## 0. Kenapa Part Ini Penting

Bagian ini bukan tutorial `Cipher`, bukan tutorial Spring Security, dan bukan daftar class Java Security yang harus dihafal.

Bagian ini adalah **peta mental**.

Java security stack itu luas, dan banyak engineer tersesat karena melihatnya sebagai kumpulan API acak:

- `MessageDigest`
- `Cipher`
- `Mac`
- `Signature`
- `KeyStore`
- `TrustManager`
- `SSLContext`
- `SecureRandom`
- `CertificateFactory`
- `CertPathValidator`
- `Subject`
- `LoginContext`
- `GSSContext`
- `SaslClient`
- `Policy`
- `Provider`

Padahal semua itu punya tempat dalam arsitektur besar.

Mental model yang benar:

```text
Java Security Architecture
├── Cryptographic services
│   ├── JCA/JCE
│   ├── Provider architecture
│   ├── MessageDigest / Mac / Cipher / Signature
│   ├── KeyPairGenerator / KeyGenerator / KeyAgreement
│   ├── SecureRandom
│   └── KeyStore
│
├── Communication security
│   └── JSSE: TLS/DTLS, SSLContext, SSLEngine, TrustManager, KeyManager
│
├── Certificate and PKI validation
│   └── CertPath: CertificateFactory, CertPathValidator, TrustAnchor, PKIXParameters
│
├── Authentication and authorization framework
│   ├── JAAS: Subject, Principal, LoginContext, LoginModule
│   └── historical Java policy / permission model
│
├── Enterprise / network authentication protocols
│   ├── JGSS: Kerberos/GSS-API abstraction
│   └── SASL: challenge-response authentication layer
│
├── Runtime security configuration
│   ├── java.security properties
│   ├── disabledAlgorithms
│   ├── providers list
│   └── default keystore/truststore behavior
│
└── Operational tooling
    ├── keytool
    ├── jarsigner
    ├── java.security.debug
    └── javax.net.debug
```

Jika kamu tidak punya peta ini, kamu mudah melakukan salah satu kesalahan berikut:

1. Memakai API crypto tanpa paham provider behavior.
2. Menganggap algorithm tersedia di semua runtime Java.
3. Menganggap keystore otomatis berarti truststore.
4. Menganggap TLS cukup karena URL sudah `https`.
5. Menganggap certificate valid karena bisa diparse.
6. Menganggap signature valid tanpa membuktikan chain, usage, dan identity binding.
7. Menganggap security config default selalu sesuai threat model aplikasi.
8. Menganggap library/framework menyelesaikan semua boundary security.

Tujuan Part 1 adalah membentuk **mental map** agar bagian-bagian berikutnya bisa dipahami sebagai sistem, bukan potongan API.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan perbedaan JCA, JCE, JSSE, CertPath, JAAS, JGSS, dan SASL.
2. Memahami provider architecture Java Security.
3. Menjelaskan mengapa `Cipher.getInstance("AES")` bukan desain security yang cukup.
4. Memahami hubungan antara algorithm name, provider, implementation, policy, dan runtime.
5. Membedakan `KeyStore`, `TrustStore`, private key, certificate, secret key, trust anchor, dan certificate chain.
6. Memahami bagaimana TLS Java dibangun dari `SSLContext`, `KeyManager`, `TrustManager`, dan `SecureRandom`.
7. Memahami bagaimana certificate validation berbeda dari sekadar membaca certificate.
8. Memahami posisi JAAS/JGSS/SASL di Java security landscape modern.
9. Memahami security properties seperti `jdk.tls.disabledAlgorithms`, `jdk.certpath.disabledAlgorithms`, dan provider order.
10. Mampu melakukan review desain security Java dengan pertanyaan yang tepat.

---

## 2. Sumber Primer dan Baseline Versi

Materi ini disusun dengan basis utama:

1. Oracle Java Cryptography Architecture Reference Guide.
2. Oracle Java Secure Socket Extension Reference Guide.
3. Oracle Java Security Standard Algorithm Names Specification.
4. Oracle Java Security Developer Guide.
5. Oracle documentation untuk security properties, provider, keystore, dan migration guidance.
6. OpenJDK/JDK behavior modern, terutama Java 17+ dan arah Java 21/24/26.

Catatan penting:

- Java Security API bersifat **provider-based**.
- Algorithm availability bisa berbeda berdasarkan JDK distribution, versi, security policy, provider order, dan konfigurasi runtime.
- Dokumentasi Oracle menyebut JCA sebagai arsitektur yang mencakup provider architecture dan API untuk digital signatures, message digests, certificates, certificate validation, encryption, key generation/management, dan secure random.
- JSSE menyediakan framework dan implementasi TLS/DTLS untuk encryption, server authentication, message integrity, dan optional client authentication.
- Java SE Security API memakai standard algorithm names untuk algorithm, certificate, dan keystore type.
- Java modern merekomendasikan PKCS12 sebagai default keystore type.

Referensi ada di bagian akhir file.

---

## 3. Peta Konseptual Java Security Stack

### 3.1 Layer 1 — Primitive Security Services

Ini layer paling dasar.

Contohnya:

- hash
- MAC
- encryption
- digital signature
- key generation
- key agreement
- secure random
- certificate parsing
- keystore access

Di Java, mayoritas layer ini berada di **JCA/JCE**.

```text
Security primitive requirement
        │
        ▼
Java API facade
        │
        ▼
Provider lookup
        │
        ▼
Concrete implementation
        │
        ▼
Native/JVM/library/HSM-backed operation
```

Contoh:

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
```

Kode ini terlihat sederhana, tapi di baliknya terjadi:

```text
Request service:
  type      = MessageDigest
  algorithm = SHA-256

Security runtime:
  look up providers in configured order
  find provider that advertises MessageDigest.SHA-256
  instantiate implementation
  return facade object
```

Implikasi penting:

- Kamu meminta **service + algorithm**, bukan class konkret.
- Provider menentukan implementasi aktual.
- Provider order bisa memengaruhi hasil.
- Algorithm yang tersedia bisa berbeda antar runtime.
- Security property bisa menolak algorithm tertentu.

---

### 3.2 Layer 2 — Protocol Security

Primitive tidak cukup. Sistem nyata butuh protocol.

Contoh:

- TLS
- DTLS
- Kerberos
- SASL mechanisms
- certificate path validation
- signed JAR verification
- XML signature validation

TLS bukan cuma encryption. TLS adalah protocol yang menggabungkan:

- negotiation
- key agreement
- certificate-based authentication
- session key derivation
- encryption
- message integrity
- replay/downgrade protection tertentu
- protocol version rules
- cipher suite policy

Di Java, TLS terutama dikelola oleh **JSSE**.

```text
Application protocol
  HTTP / JDBC / LDAP / SMTP / custom TCP
        │
        ▼
TLS via JSSE
        │
        ▼
JCA/JCE cryptographic primitives
        │
        ▼
Providers
```

Artinya, ketika kamu memakai HTTPS client Java, kamu tetap memakai JCA/JCE di bawahnya melalui JSSE.

---

### 3.3 Layer 3 — Identity and Trust

Security selalu bertanya:

> Saya mempercayai siapa, berdasarkan bukti apa, untuk melakukan apa, dalam konteks apa?

Di Java, identity/trust terkait dengan:

- `Principal`
- `Subject`
- X.509 certificate
- trust anchor
- certificate chain
- JAAS login module
- Kerberos principal
- TLS peer identity
- JWT subject/issuer/audience di layer aplikasi
- application-level user/role/permission

Yang penting: **identity tidak otomatis sama dengan authorization**.

Contoh:

```text
Certificate valid
≠ certificate milik service yang benar
≠ service boleh melakukan action ini
≠ request payload belum dimodifikasi
≠ user boleh melihat case ini
```

---

### 3.4 Layer 4 — Runtime Policy and Configuration

Security Java banyak dikendalikan runtime config:

- provider order
- disabled algorithms
- default keystore type
- default truststore
- TLS protocol enablement
- certificate path policy
- JAR verification constraints
- XML signature secure validation
- debugging switches

Contoh properti penting:

```properties
security.provider.1=SUN
security.provider.2=SunRsaSign
security.provider.3=SunEC
security.provider.4=SunJSSE
security.provider.5=SunJCE

jdk.tls.disabledAlgorithms=...
jdk.certpath.disabledAlgorithms=...
jdk.jar.disabledAlgorithms=...
keystore.type=pkcs12
```

Implikasi:

- Security behavior bukan hanya source code.
- Upgrade JDK bisa mengubah behavior security.
- Container image bisa mengubah truststore.
- Distribution JDK bisa punya provider berbeda.
- Production incident bisa terjadi karena certificate, disabled algorithm, atau provider config berubah.

---

## 4. JCA — Java Cryptography Architecture

### 4.1 Apa Itu JCA

JCA adalah arsitektur utama untuk cryptographic services di Java.

JCA menyediakan:

- API facade
- provider discovery
- algorithm abstraction
- implementation independence
- implementation interoperability
- algorithm extensibility

Secara praktis, JCA menjawab:

> Bagaimana aplikasi Java meminta operasi security tanpa hardcode implementasi cryptographic engine tertentu?

Contoh API JCA/JCE:

```text
MessageDigest       -> cryptographic hash
Mac                 -> message authentication code
Cipher              -> encryption/decryption
Signature           -> digital signature
SecureRandom        -> secure random number generation
KeyPairGenerator    -> asymmetric key pair generation
KeyGenerator        -> symmetric key generation
KeyAgreement        -> key agreement, e.g. Diffie-Hellman/ECDH
KeyFactory          -> convert key specs into key objects
SecretKeyFactory    -> password-based or secret key material processing
CertificateFactory  -> parse certificates
CertPathValidator   -> validate certificate path
KeyStore            -> store/retrieve keys and certificates
AlgorithmParameters -> algorithm-specific parameter encoding
AlgorithmParameterGenerator -> generate algorithm parameters
```

JCA bukan hanya crypto API. Ia juga mencakup certificates, certificate validation, key management, dan secure random.

---

### 4.2 JCA Facade Pattern

Banyak class JCA memakai pola yang sama:

```java
Type engine = Type.getInstance("Algorithm");
```

Contoh:

```java
MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
Mac hmac = Mac.getInstance("HmacSHA256");
Signature signature = Signature.getInstance("SHA256withRSA");
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
KeyStore keyStore = KeyStore.getInstance("PKCS12");
```

Pola ini terlihat sederhana, tapi menyembunyikan provider lookup.

Mental model:

```text
getInstance("X") is not merely constructor call.
It is a provider selection request.
```

Jadi pertanyaan security review-nya bukan hanya:

```text
Apakah algorithm string-nya benar?
```

Tapi:

```text
Algorithm ini disediakan provider apa?
Provider order-nya apa?
Parameter default-nya apa?
Apakah mode/padding explicit?
Apakah algorithm disabled di runtime?
Apakah behavior sama di dev, CI, UAT, prod?
```

---

### 4.3 Engine Class

Dalam JCA, class seperti `MessageDigest`, `Cipher`, `Signature`, `Mac`, dan `KeyStore` sering disebut **engine class**.

Engine class adalah API facade untuk family service tertentu.

Contoh:

```text
Engine class      Service type
------------      --------------------------
MessageDigest     Hash/digest
Mac               Message authentication code
Cipher            Encryption/decryption
Signature         Digital signature
KeyStore          Key/certificate repository
SecureRandom      Secure random source
KeyFactory        Key conversion
CertificateFactory Certificate parsing
CertPathValidator Certificate path validation
```

Engine class biasanya punya:

- `getInstance(...)`
- initialization method
- update/process method
- finalization method

Contoh `Signature`:

```java
Signature sig = Signature.getInstance("SHA256withRSA");
sig.initSign(privateKey);
sig.update(payload);
byte[] signatureBytes = sig.sign();
```

Contoh `Mac`:

```java
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(secretKey);
byte[] tag = mac.doFinal(payload);
```

Contoh `Cipher`:

```java
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, key, gcmParameterSpec);
byte[] ciphertext = cipher.doFinal(plaintext);
```

---

## 5. JCE — Java Cryptography Extension

### 5.1 Apa Itu JCE

Secara historis, JCE adalah extension untuk cryptographic operations seperti:

- encryption
- decryption
- key agreement
- MAC
- key generation
- key factory
- secret key factory

Dalam Java modern, pembagian JCA/JCE sering tidak perlu dibesar-besarkan untuk penggunaan harian, karena JCE sudah menjadi bagian dari platform Java SE.

Namun secara mental model:

```text
JCA = umbrella architecture
JCE = cryptographic extension area, terutama encryption/MAC/key agreement
```

Contoh package yang sering diasosiasikan dengan JCE:

```java
javax.crypto.Cipher
javax.crypto.Mac
javax.crypto.KeyGenerator
javax.crypto.KeyAgreement
javax.crypto.SecretKey
javax.crypto.SecretKeyFactory
javax.crypto.spec.GCMParameterSpec
javax.crypto.spec.SecretKeySpec
javax.crypto.spec.IvParameterSpec
javax.crypto.spec.PBEKeySpec
```

---

### 5.2 Unlimited Strength Policy

Dulu Java punya batasan cryptographic strength karena export control. Pada Java modern, konfigurasi unlimited strength sudah umum/default di banyak JDK modern.

Tetapi sebagai senior engineer, jangan hanya berasumsi.

Checklist:

```text
[ ] Runtime JDK version diketahui.
[ ] Distribution JDK diketahui.
[ ] Crypto policy diketahui.
[ ] Algorithm/key size diuji di environment target.
[ ] Deployment image tidak mengganti java.security secara diam-diam.
```

Untuk aplikasi enterprise yang berjalan di banyak environment, jangan hanya test di local.

---

## 6. Provider Architecture

### 6.1 Provider Itu Apa

Provider adalah komponen yang menyediakan implementasi algorithm/security service.

Contoh provider umum di JDK Oracle/OpenJDK:

```text
SUN
SunRsaSign
SunEC
SunJSSE
SunJCE
SunJGSS
SunSASL
XMLDSig
SunPCSC
JdkLDAP
JdkSASL
SunPKCS11
```

Provider bisa berasal dari:

- JDK built-in
- third-party library
- FIPS provider
- HSM vendor provider
- cloud KMS/HSM integration
- custom provider internal

Contoh melihat provider:

```java
import java.security.Provider;
import java.security.Security;

public class ListProviders {
    public static void main(String[] args) {
        for (Provider provider : Security.getProviders()) {
            System.out.println(provider.getName() + " " + provider.getVersionStr());
            provider.getServices().stream()
                    .limit(10)
                    .forEach(service -> System.out.println("  " + service.getType() + ": " + service.getAlgorithm()));
        }
    }
}
```

---

### 6.2 Provider Lookup

Ketika kamu memanggil:

```java
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
```

Java akan mencari provider yang menyediakan service:

```text
Type      = Cipher
Algorithm = AES/GCM/NoPadding
```

Provider dicari berdasarkan order yang dikonfigurasi di `java.security`.

Pseudocode mental:

```text
for provider in Security.getProviders():
    if provider supports Cipher.AES/GCM/NoPadding:
        return implementation from provider
throw NoSuchAlgorithmException / NoSuchPaddingException
```

Implikasi:

- Provider order matters.
- Runtime matters.
- Algorithm name matters.
- Unsupported algorithm muncul sebagai runtime failure.
- Security provider bisa mengubah semantics/performance/allowed key size.

---

### 6.3 Kapan Explicit Provider Boleh Dipakai

Biasanya, jangan hardcode provider tanpa alasan kuat.

Contoh yang sering dilihat:

```java
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding", "SunJCE");
```

Ini membuat kode lebih predictable, tapi juga lebih tidak portable.

Gunakan explicit provider jika:

1. Compliance mensyaratkan provider tertentu.
2. HSM/FIPS provider harus dipakai.
3. Ada behavioral requirement yang hanya provider tertentu dukung.
4. Kamu membangun test untuk memastikan provider tertentu aktif.
5. Kamu sedang melakukan migration controlled.

Hindari explicit provider jika:

1. Tujuannya hanya “agar jalan di laptop saya”.
2. Kamu tidak mengontrol runtime target.
3. Library kamu akan dipakai banyak aplikasi berbeda.
4. Kamu tidak punya fallback/migration plan.

Rule of thumb:

```text
Application code may pin provider only when runtime ownership and operational model are clear.
Reusable library should avoid forcing provider unless that is the library contract.
```

---

### 6.4 Provider Is Part of Threat Model

Provider bukan detail teknis kecil.

Provider menentukan:

- algorithm availability
- implementation correctness
- side-channel hardening
- FIPS compliance
- hardware-backed key custody
- performance
- default parameters
- bug surface
- upgrade behavior

Contoh threat:

```text
Aplikasi memakai third-party provider untuk algorithm X.
Provider jar bisa diganti di classpath/container image.
Aplikasi tetap start.
Crypto operation tetap berhasil.
Tapi guarantee compliance/security berubah.
```

Maka untuk sistem sensitif, provider list adalah artifact yang harus diaudit.

---

## 7. Standard Algorithm Names

### 7.1 Kenapa Algorithm Name Penting

Java Security API memakai string untuk algorithm.

Contoh:

```java
MessageDigest.getInstance("SHA-256")
Mac.getInstance("HmacSHA256")
Cipher.getInstance("AES/GCM/NoPadding")
Signature.getInstance("SHA256withRSA")
KeyStore.getInstance("PKCS12")
```

String ini bukan bebas.

Java SE punya standard algorithm names specification.

Masalah muncul ketika engineer:

1. Salah nama algorithm.
2. Memakai alias provider-specific.
3. Memakai transformation tidak lengkap.
4. Mengandalkan default mode/padding.
5. Mengira semua provider mendukung nama yang sama.

---

### 7.2 Algorithm vs Transformation

Untuk `Cipher`, string sering disebut **transformation**, bukan sekadar algorithm.

Format umum:

```text
algorithm/mode/padding
```

Contoh baik:

```java
Cipher.getInstance("AES/GCM/NoPadding")
```

Contoh buruk:

```java
Cipher.getInstance("AES")
```

Kenapa buruk?

Karena `AES` saja bisa membuat provider memilih default mode/padding. Dalam banyak konteks, default historis bisa berbahaya seperti ECB.

Security invariant:

```text
Cipher transformation must explicitly state mode and padding.
```

---

### 7.3 Algorithm Availability Is a Runtime Fact

Jangan menganggap algorithm tersedia hanya karena ada di dokumentasi.

Cek di runtime:

```java
import java.security.Provider;
import java.security.Security;
import java.util.Comparator;

public class ListCipherAlgorithms {
    public static void main(String[] args) {
        Security.getProviders();

        Security.getProviders();
        Security.getAlgorithms("Cipher").stream()
                .sorted(Comparator.naturalOrder())
                .forEach(System.out::println);
    }
}
```

Atau cek service detail:

```java
for (Provider provider : Security.getProviders()) {
    for (Provider.Service service : provider.getServices()) {
        if (service.getType().equalsIgnoreCase("Cipher")) {
            System.out.printf("%s -> %s%n", provider.getName(), service.getAlgorithm());
        }
    }
}
```

Namun jangan menjadikan runtime listing sebagai desain security. Ia hanya observability.

Desain security tetap harus memutuskan:

```text
Primitive apa yang dibutuhkan?
Mode apa?
Parameter apa?
Key size apa?
Provider apa?
Compatibility target apa?
Failure behavior apa?
```

---

## 8. KeyStore and TrustStore

### 8.1 Keystore Bukan Hanya File `.jks`

`KeyStore` adalah abstraction untuk repository key dan certificate.

Ia bisa berisi:

- private key + certificate chain
- secret key
- trusted certificate

Common type:

```text
PKCS12
JKS
JCEKS
PKCS11
```

Java modern default umumnya `PKCS12`.

Mental model:

```text
KeyStore is an API abstraction.
A .p12/.pfx/.jks file is only one possible backing store.
```

Dengan PKCS11 provider, key material bisa berada di HSM/token, bukan file biasa.

---

### 8.2 Keystore vs Truststore

Secara class Java, keduanya sering sama-sama `KeyStore`.

Perbedaan ada di **semantic usage**.

```text
Keystore:
  "Ini identitas saya."
  Biasanya menyimpan private key dan certificate chain.

Truststore:
  "Ini pihak/CA yang saya percaya."
  Biasanya menyimpan trusted certificates / trust anchors.
```

Contoh TLS server:

```text
Server keystore:
  private key server
  certificate server
  intermediate chain

Server truststore:
  CA yang dipercaya untuk client certificate jika mTLS dipakai
```

Contoh TLS client:

```text
Client keystore:
  private key client jika mTLS dipakai

Client truststore:
  root/intermediate CA yang dipercaya untuk memvalidasi server certificate
```

Kesalahan umum:

```text
Menaruh certificate server di keystore client lalu mengira trust sudah benar.
Menaruh private key di truststore.
Menggunakan satu file untuk semua tanpa semantic separation.
Mengimpor leaf certificate sebagai trust anchor tanpa memahami rotasi certificate.
```

---

### 8.3 Private Key, Public Key, Certificate, Chain, Trust Anchor

Terminologi wajib jelas.

```text
Private key:
  Rahasia. Dipakai untuk signing/decryption/key agreement sesuai algorithm.
  Harus dilindungi.

Public key:
  Tidak rahasia. Dipakai pihak lain untuk verification/encryption/key agreement.

Certificate:
  Binding antara identity dan public key, ditandatangani issuer.

Certificate chain:
  Leaf certificate + intermediate CA(s) menuju root/trust anchor.

Trust anchor:
  Entitas yang dipercaya langsung oleh verifier, biasanya root CA certificate.
```

Certificate valid berarti:

```text
[ ] Signature chain valid.
[ ] Chain menuju trust anchor yang dipercaya.
[ ] Certificate belum expired.
[ ] Certificate belum dicabut jika revocation dicek.
[ ] Key usage sesuai.
[ ] Extended key usage sesuai.
[ ] Identity binding sesuai konteks, misalnya hostname/SAN.
[ ] Algorithm tidak disabled.
[ ] Policy constraints terpenuhi.
```

Certificate yang bisa diparse belum tentu bisa dipercaya.

---

## 9. CertPath — Certificate Path Validation

### 9.1 Certificate Parsing vs Certificate Validation

Ini salah satu confusion paling berbahaya.

Parsing:

```java
CertificateFactory factory = CertificateFactory.getInstance("X.509");
X509Certificate cert = (X509Certificate) factory.generateCertificate(inputStream);
```

Ini hanya membaca struktur certificate.

Validation butuh:

```text
certificate path
trust anchors
PKIX parameters
policy rules
revocation config
algorithm constraints
date/time validation
identity binding outside CertPath in many cases
```

Mental model:

```text
Parsing answers: "Is this syntactically a certificate?"
Validation answers: "Should I trust this certificate for this purpose now?"
```

---

### 9.2 CertPath Core API

API penting:

```java
java.security.cert.CertificateFactory
java.security.cert.CertPath
java.security.cert.CertPathValidator
java.security.cert.PKIXParameters
java.security.cert.TrustAnchor
java.security.cert.CertStore
java.security.cert.X509Certificate
```

Simplified flow:

```text
Input certificates
      │
      ▼
Build or receive certificate path
      │
      ▼
Set trust anchors and PKIX parameters
      │
      ▼
CertPathValidator.validate(...)
      │
      ▼
Validation result or exception
```

Contoh conceptual code:

```java
CertificateFactory cf = CertificateFactory.getInstance("X.509");
CertPath certPath = cf.generateCertPath(certificatesInLeafToRootOrder);

TrustAnchor anchor = new TrustAnchor(rootCertificate, null);
PKIXParameters params = new PKIXParameters(Set.of(anchor));
params.setRevocationEnabled(false); // only as explicit example; production decision needs policy

CertPathValidator validator = CertPathValidator.getInstance("PKIX");
validator.validate(certPath, params);
```

Perhatikan:

- `setRevocationEnabled(false)` bukan rekomendasi umum.
- Revocation checking harus diputuskan berdasarkan threat model dan operational feasibility.
- Hostname verification untuk TLS biasanya ditangani JSSE/HTTPS layer, bukan hanya CertPath manual.

---

### 9.3 CertPath Failure Modes

Failure umum:

```text
Expired certificate.
Missing intermediate.
Wrong trust anchor.
Algorithm disabled.
Wrong key usage.
Wrong extended key usage.
Revoked certificate.
Clock skew.
Hostname/SAN mismatch.
Self-signed certificate trusted accidentally.
Different truststore between local and production.
```

Production checklist:

```text
[ ] Certificate expiry monitored.
[ ] Intermediate certificate chain included correctly.
[ ] Truststore source controlled.
[ ] Revocation policy explicit.
[ ] Algorithm constraints understood.
[ ] Hostname verification not disabled.
[ ] mTLS identity mapping documented.
[ ] Test includes expired/wrong-host/wrong-CA certificates.
```

---

## 10. JSSE — Java Secure Socket Extension

### 10.1 Apa Itu JSSE

JSSE adalah Java framework untuk secure socket communication, terutama TLS/DTLS.

JSSE menyediakan:

- `SSLContext`
- `SSLSocket`
- `SSLServerSocket`
- `SSLEngine`
- `SSLParameters`
- `KeyManager`
- `TrustManager`
- `HostnameVerifier` di HTTPS layer
- TLS protocol/cipher suite configuration

TLS memberikan beberapa security property:

```text
Confidentiality     -> traffic encryption
Integrity           -> tamper detection
Server authentication -> client verifies server identity
Optional client authentication -> mTLS
```

---

### 10.2 JSSE Mental Model

```text
Application wants secure channel
        │
        ▼
SSLContext
        │
        ├── KeyManager[]   -> "who am I? what cert/private key do I present?"
        ├── TrustManager[] -> "who do I trust? how do I validate peer?"
        └── SecureRandom   -> secure randomness for protocol
        │
        ▼
SSLSocket / SSLEngine / HTTPS client/server stack
        │
        ▼
TLS handshake and encrypted data transfer
```

Key distinction:

```text
KeyManager presents local identity.
TrustManager validates remote identity.
```

This distinction matters.

---

### 10.3 SSLContext

`SSLContext` adalah factory/configuration root untuk TLS.

Contoh high-level:

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(keyManagers, trustManagers, secureRandom);
```

`SSLContext.getInstance("TLS")` biasanya berarti provider akan memilih TLS implementation yang mendukung protocol versions tertentu.

Jangan menganggap string `TLS` berarti satu versi protocol spesifik.

Untuk membatasi versi protocol, gunakan `SSLParameters` / client/server configuration.

Contoh conceptual:

```java
SSLParameters params = sslContext.getDefaultSSLParameters();
params.setProtocols(new String[] { "TLSv1.3", "TLSv1.2" });
```

Namun protocol enablement juga dipengaruhi runtime security properties.

---

### 10.4 TrustManager

`TrustManager` menentukan bagaimana peer certificate dipercaya.

Untuk X.509, biasanya:

```java
X509TrustManager
```

Common anti-pattern:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Ini bukan “workaround certificate issue”. Ini menghapus authentication.

Security invariant:

```text
Production TLS must not use trust-all TrustManager.
```

Jika butuh private CA, solusinya bukan trust-all, tetapi:

```text
Create controlled truststore
Import correct CA/intermediate
Use default PKIX validation
Keep hostname verification enabled
Monitor expiry and rotation
```

---

### 10.5 Hostname Verification

Certificate chain valid belum cukup.

Untuk HTTPS, client harus memastikan certificate berlaku untuk hostname yang dihubungi.

Contoh risiko:

```text
Client connect ke https://api.payment.example
Server menyajikan certificate valid dari public CA
Tapi certificate untuk attacker.example
Jika hostname verification dimatikan, chain bisa valid tapi identity salah.
```

Anti-pattern:

```java
HostnameVerifier allowAll = (hostname, session) -> true;
```

Security invariant:

```text
Hostname verification must remain enabled unless replaced by an equivalent identity verification mechanism.
```

Dalam mTLS service-to-service, hostname verification masih penting kecuali ada desain identity binding lain yang eksplisit, terdokumentasi, dan diuji.

---

### 10.6 SSLSocket vs SSLEngine

`SSLSocket` lebih mudah dipakai untuk socket blocking.

`SSLEngine` adalah TLS engine non-blocking yang tidak melakukan I/O sendiri.

Mental model:

```text
SSLSocket:
  TLS + socket I/O bundled.

SSLEngine:
  TLS state machine only.
  Application/framework handles network I/O buffers.
```

Framework seperti Netty/Reactor/servlet container bisa memakai abstraction yang lebih kompleks di bawahnya.

Kamu tidak perlu menulis `SSLEngine` manual kecuali membangun framework/protocol layer.

Tetapi sebagai senior engineer, kamu perlu tahu bahwa TLS di high-performance Java server sering berada di abstraction non-blocking semacam ini.

---

## 11. JAAS — Java Authentication and Authorization Service

### 11.1 Posisi JAAS di Java Modern

JAAS menyediakan framework untuk authentication dan authorization berbasis:

- `Subject`
- `Principal`
- `LoginContext`
- `LoginModule`

Contoh konsep:

```text
LoginContext authenticates credentials using configured LoginModule(s)
        │
        ▼
Subject contains Principal(s) and credentials
        │
        ▼
Application/framework uses Subject identity
```

JAAS penting secara historis dan masih muncul di area seperti:

- Kerberos integration
- container/server security legacy
- custom login module
- enterprise Java environment
- internal platform security

Tetapi aplikasi modern sering memakai:

- Spring Security
- Jakarta Security
- OAuth2/OIDC provider
- container-managed identity
- custom identity service

Part ini tidak membahas Spring Security/Jakarta Security detail karena sudah masuk area framework/application security. Yang penting: pahami JAAS sebagai security framework Java platform, bukan pusat semua security aplikasi modern.

---

### 11.2 Subject and Principal

`Principal` merepresentasikan identity claim.

`Subject` merepresentasikan kumpulan identity dan credential.

Contoh mental:

```text
Subject
├── Principal: user id
├── Principal: Kerberos principal
├── Principal: group
├── Public credentials
└── Private credentials
```

Security warning:

```text
Having a Principal does not mean the user is authorized for every operation.
```

Authorization tetap butuh policy/context/resource/action.

---

## 12. JGSS — Java Generic Security Services

### 12.1 Apa Itu JGSS

JGSS adalah Java binding untuk GSS-API, abstraction untuk security mechanism seperti Kerberos.

Ia relevan di environment enterprise yang memakai:

- Kerberos
- SPNEGO
- integrated Windows authentication
- service principal
- ticket-based authentication
- delegated credentials

Core concept:

```text
GSSName
GSSCredential
GSSContext
security token exchange
mutual authentication
message integrity/confidentiality support depending mechanism
```

JGSS bukan API yang sering dipakai langsung oleh typical REST microservice, tetapi penting jika kamu bekerja dengan:

- enterprise SSO lama
- LDAP/Kerberos
- database authentication tertentu
- Hadoop/Big Data ecosystem
- internal corporate authentication

---

### 12.2 JGSS Threat Model

JGSS/Kerberos punya trust model berbeda dari OAuth/JWT.

Hal yang perlu dipahami:

```text
KDC adalah trust center.
Service principal harus benar.
Keytab adalah secret material.
Clock skew penting.
Delegation risk tinggi.
Replay protection bergantung protocol/mechanism.
```

Common incident:

```text
Keytab bocor.
Service principal salah.
Clock skew membuat authentication gagal.
SPNEGO fallback salah konfigurasi.
Delegated credential memberi privilege lebih besar dari yang dibutuhkan.
```

---

## 13. SASL — Simple Authentication and Security Layer

### 13.1 Apa Itu SASL

SASL adalah framework untuk menambahkan authentication support ke protocol berbasis connection.

Java menyediakan SASL API untuk client/server mechanism.

SASL sering muncul di:

- LDAP
- IMAP/SMTP
- Kafka mechanism tertentu
- custom enterprise protocol
- Kerberos/GSSAPI mechanism

Core API:

```java
javax.security.sasl.Sasl
javax.security.sasl.SaslClient
javax.security.sasl.SaslServer
```

Mental model:

```text
Application protocol
        │
        ▼
SASL negotiation
        │
        ▼
Authentication mechanism
        │
        ▼
Optional security layer depending mechanism
```

---

### 13.2 SASL Is Not Automatically TLS

SASL authenticates, but transport security depends on mechanism and deployment.

Common design:

```text
TLS protects channel.
SASL authenticates client/user/service over the channel.
```

Security review question:

```text
Is SASL mechanism protected against credential exposure on this transport?
Is TLS required before SASL negotiation?
Is channel binding needed?
Is mechanism downgrade possible?
```

---

## 14. Java Security Properties

### 14.1 `java.security` File

Java security behavior dikendalikan oleh security properties.

Lokasi biasanya di JDK config, misalnya:

```text
$JAVA_HOME/conf/security/java.security
```

Pada JDK lama:

```text
$JAVA_HOME/jre/lib/security/java.security
```

Properti penting:

```properties
security.provider.1=SUN
security.provider.2=SunRsaSign
security.provider.3=SunEC
security.provider.4=SunJSSE
security.provider.5=SunJCE

keystore.type=pkcs12

jdk.certpath.disabledAlgorithms=...
jdk.tls.disabledAlgorithms=...
jdk.jar.disabledAlgorithms=...
```

---

### 14.2 Disabled Algorithms

Java dapat menolak algorithm/protocol/key size tertentu melalui security properties.

Area penting:

```text
jdk.tls.disabledAlgorithms
  Membatasi algorithm/protocol/key size untuk TLS.

jdk.certpath.disabledAlgorithms
  Membatasi algorithm/key/certificate path validation.

jdk.jar.disabledAlgorithms
  Membatasi signed JAR verification.

jdk.xml.dsig.secureValidationPolicy
  Membatasi XML digital signature validation.
```

Implikasi production:

```text
Aplikasi yang kemarin berhasil connect bisa gagal setelah JDK update.
Certificate lama bisa ditolak karena algorithm/key size.
Signed artifact bisa tidak valid lagi.
TLS handshake bisa gagal karena protocol/cipher suite disabled.
```

Ini bukan bug aplikasi semata. Ini sering security posture improvement di JDK.

Senior engineer harus bisa membedakan:

```text
Apakah kita harus menurunkan policy?
Atau counterpart system harus upgrade certificate/protocol?
```

Biasanya, menurunkan policy adalah opsi terakhir dan harus risk-accepted.

---

### 14.3 Runtime Debugging

Untuk troubleshooting Java security:

```bash
-Djava.security.debug=properties,provider,certpath
-Djavax.net.debug=ssl,handshake,certpath
```

Contoh:

```bash
java \
  -Djavax.net.debug=ssl,handshake,certpath \
  -jar app.jar
```

Peringatan:

```text
Debug TLS/security bisa mencetak informasi sensitif.
Jangan aktifkan sembarangan di production logs.
Gunakan controlled environment dan redaction.
```

---

## 15. How Java Security Pieces Fit Together in Real Applications

### 15.1 REST API Client over HTTPS

Contoh aplikasi Java memanggil external API.

```text
Java HTTP Client
        │
        ▼
JSSE / TLS
        │
        ├── TrustManager validates server certificate
        ├── Hostname verification validates endpoint identity
        ├── JCA/JCE provides crypto primitives
        └── Provider implements algorithms
```

Security questions:

```text
[ ] Truststore mana yang dipakai?
[ ] Apakah private CA diperlukan?
[ ] Apakah hostname verification aktif?
[ ] Protocol TLS apa yang diizinkan?
[ ] Cipher suite apa yang diizinkan?
[ ] Apakah mTLS dibutuhkan?
[ ] Bagaimana certificate expiry dimonitor?
[ ] Bagaimana failure dibedakan antara network vs trust failure?
```

---

### 15.2 Service with mTLS

```text
Service A keystore:
  private key + certificate chain A

Service A truststore:
  CA yang dipercaya untuk Service B

Service B keystore:
  private key + certificate chain B

Service B truststore:
  CA yang dipercaya untuk Service A
```

JSSE components:

```text
KeyManager   -> presents local cert/private key
TrustManager -> validates peer cert
SSLContext   -> combines both
```

mTLS identity mapping:

```text
Peer certificate subject/SAN
        │
        ▼
Service identity
        │
        ▼
Authorization policy
```

Anti-pattern:

```text
"mTLS sukses berarti semua request boleh."
```

mTLS authenticates peer. Authorization tetap perlu.

---

### 15.3 Signed Payload

Contoh: service menerima payload + detached signature.

```text
Input payload
Input signature
Input signer certificate/public key
        │
        ▼
Canonicalize payload
        │
        ▼
Validate signer certificate/trust if certificate-based
        │
        ▼
Verify signature using Signature API
        │
        ▼
Check signer authorized for this payload/action
```

API involved:

```text
CertificateFactory
CertPathValidator
Signature
MessageDigest indirectly depending signature algorithm
Provider
```

Security invariant:

```text
Signature validity proves possession of signing private key over exact bytes/canonical form.
It does not automatically prove business authorization.
```

---

### 15.4 Encrypted Data at Rest

```text
Plaintext data
        │
        ▼
Generate/obtain data encryption key
        │
        ▼
Generate nonce/IV
        │
        ▼
Encrypt with AEAD
        │
        ▼
Store version + algorithm + key id + nonce + ciphertext + tag
        │
        ▼
Protect key via KMS/HSM/keystore/key wrapping
```

API involved:

```text
Cipher
KeyGenerator or external KMS
SecureRandom
KeyStore maybe
Mac not needed separately if AEAD used correctly
Provider
```

Security review:

```text
[ ] Is encryption authenticated?
[ ] Is nonce unique per key?
[ ] Is key id stored?
[ ] Is algorithm versioned?
[ ] Is key rotation possible?
[ ] Is associated data used for context binding?
[ ] Is decryption failure treated safely?
```

---

### 15.5 Password Verification

Password storage uses password hashing/KDF, not reversible encryption.

API involved may include:

```text
SecretKeyFactory for PBKDF2
Third-party library for Argon2id/bcrypt/scrypt
SecureRandom for salt
MessageDigest is not sufficient alone for password storage
```

Security invariant:

```text
Password verifier must not store plaintext password or reversible encrypted password.
```

---

## 16. Common Misunderstandings

### 16.1 “JCA Sama Dengan Encryption”

Salah.

JCA jauh lebih luas:

```text
hash
signature
certificate
certificate path validation
key management
secure random
provider architecture
```

Encryption hanya salah satu bagian.

---

### 16.2 “Keystore Adalah Truststore”

Secara API bisa sama, secara makna tidak.

```text
Keystore = local identity material.
Truststore = remote trust anchor material.
```

Mencampur keduanya tanpa disiplin semantic membuat rotasi dan audit sulit.

---

### 16.3 “Certificate Valid Berarti Aman”

Certificate harus valid untuk purpose dan identity tertentu.

Validasi minimal:

```text
chain
expiry
algorithm
trust anchor
key usage
extended key usage
revocation policy
identity binding
```

---

### 16.4 “TLS Berarti Tidak Perlu Message-Level Security”

TLS melindungi channel.

Jika payload melewati banyak hop, queue, storage, retry table, log, atau broker, TLS saja mungkin tidak cukup.

```text
TLS protects transport segment.
Message-level signature/MAC protects payload across boundaries.
```

---

### 16.5 “Provider Tidak Penting”

Provider menentukan implementasi.

Untuk regulated/high-assurance systems, provider adalah bagian dari compliance dan audit story.

---

### 16.6 “Algorithm Kuat Berarti Sistem Aman”

AES-GCM kuat, tetapi sistem tetap bisa rusak jika:

```text
nonce reused
key leaked
AAD tidak mengikat konteks
ciphertext version tidak ada
exception handling bocor
key rotation tidak mungkin
provider berbeda antar environment
```

---

## 17. Secure Design Heuristics for Java Security APIs

### 17.1 Always Ask the Security Property

Sebelum memilih API, jawab:

```text
Apakah saya butuh confidentiality?
Apakah saya butuh integrity?
Apakah saya butuh authenticity?
Apakah saya butuh non-repudiation?
Apakah saya butuh freshness/replay protection?
Apakah saya butuh authorization binding?
Apakah saya butuh auditability?
```

Mapping awal:

```text
Confidentiality at rest      -> AEAD encryption + key management
Integrity without secrecy    -> MAC or digital signature
Authenticity shared secret   -> MAC
Authenticity public proof    -> digital signature
Transport protection         -> TLS/JSSE
Peer identity                -> certificate validation + hostname/SAN/mTLS mapping
Password verification        -> password hashing/KDF
Artifact integrity           -> signature/hash/SBOM/provenance
```

---

### 17.2 Prefer Protocols Over Raw Primitives

Jika ada protocol matang, gunakan protocol.

Contoh:

```text
Need secure transport? Use TLS, not custom AES over socket.
Need token signing? Use standard JOSE carefully, not custom JSON+Signature without canonicalization.
Need password hashing? Use established password hashing scheme, not SHA-256(password).
Need certificate trust? Use PKIX validation, not manual issuer string comparison.
```

Raw primitives mudah disalahkomposisi.

---

### 17.3 Make Parameters Explicit

Buruk:

```java
Cipher.getInstance("AES");
```

Lebih baik:

```java
Cipher.getInstance("AES/GCM/NoPadding");
```

Buruk:

```java
SSLContext.getInstance("SSL");
```

Lebih baik:

```java
SSLContext.getInstance("TLS");
```

Lalu restrict protocol via configuration/parameters sesuai policy.

Rule:

```text
Security-sensitive defaults must be treated as unknown until verified.
```

---

### 17.4 Version Your Security Envelope

Encrypted/signed payload harus versioned.

Contoh envelope:

```json
{
  "version": 1,
  "alg": "AES-256-GCM",
  "kid": "dek-2026-06",
  "nonce": "base64...",
  "aad": "context-id",
  "ciphertext": "base64...",
  "tag": "base64..."
}
```

Kenapa?

Karena security design berubah:

- algorithm migration
- key rotation
- provider migration
- payload canonicalization fix
- metadata addition
- deprecation of weak primitive

Tanpa versioning, migration sulit.

---

### 17.5 Treat Keys as Domain Objects with Lifecycle

Key bukan byte array biasa.

Key punya:

```text
purpose
algorithm
size
owner
creation time
activation time
expiration time
rotation policy
storage location
access policy
audit trail
destruction policy
```

Jika desain hanya punya:

```java
byte[] key = ...;
```

maka desain belum matang.

---

## 18. Java Security Review Checklist

Gunakan checklist ini untuk PR/design review.

### 18.1 JCA/JCE Checklist

```text
[ ] Algorithm dipilih berdasarkan security property, bukan convenience.
[ ] Transformation lengkap: algorithm/mode/padding.
[ ] Tidak memakai ECB.
[ ] Tidak memakai MD5/SHA-1 untuk security property baru.
[ ] Tidak memakai RSA PKCS#1 v1.5 encryption untuk desain baru.
[ ] Randomness memakai SecureRandom.
[ ] IV/nonce uniqueness dijamin.
[ ] Key size sesuai policy.
[ ] Provider assumptions terdokumentasi.
[ ] Runtime algorithm availability diuji.
[ ] Decryption/verification failure aman dan tidak bocor detail sensitif.
```

### 18.2 KeyStore/Certificate Checklist

```text
[ ] Keystore dan truststore semantic dipisahkan.
[ ] Private key tidak masuk truststore.
[ ] Trust anchor tidak berupa leaf certificate kecuali memang pinning policy.
[ ] Certificate chain lengkap.
[ ] Expiry dimonitor.
[ ] Revocation policy eksplisit.
[ ] Hostname/SAN verification aktif untuk TLS.
[ ] Key usage/EKU sesuai.
[ ] Rotation procedure diuji.
[ ] Password/secret untuk keystore tidak hardcoded.
```

### 18.3 JSSE/TLS Checklist

```text
[ ] Tidak ada trust-all TrustManager.
[ ] Tidak ada allow-all HostnameVerifier.
[ ] TLS protocol version sesuai policy.
[ ] Weak cipher suite disabled.
[ ] mTLS identity mapping jelas.
[ ] Truststore source controlled.
[ ] Handshake failure observable.
[ ] Debug logging tidak aktif sembarangan.
[ ] Certificate renewal tested before expiry.
[ ] Environment parity antara dev/UAT/prod diperiksa.
```

### 18.4 Runtime Security Checklist

```text
[ ] JDK version diketahui.
[ ] JDK distribution diketahui.
[ ] java.security config tracked.
[ ] Provider list audited.
[ ] disabledAlgorithms policy diketahui.
[ ] Container image tidak membawa truststore tak dikenal.
[ ] CI menjalankan security-sensitive integration test.
[ ] JDK upgrade impact diuji.
[ ] Debug options tidak bocor ke prod.
[ ] Observability membedakan crypto/cert/TLS failure.
```

---

## 19. Failure Mode Catalog

### 19.1 Provider Failure

```text
Symptom:
  NoSuchAlgorithmException / NoSuchPaddingException

Possible causes:
  Algorithm tidak tersedia.
  Provider tidak terdaftar.
  Provider order berubah.
  JDK distribution berbeda.
  Security policy menolak algorithm.

Engineering response:
  List providers/services.
  Check java.security.
  Check JDK distribution/version.
  Check algorithm standard name.
  Avoid random fallback to weaker algorithm.
```

---

### 19.2 TLS Handshake Failure

```text
Symptom:
  SSLHandshakeException

Possible causes:
  Certificate expired.
  Hostname mismatch.
  Missing intermediate.
  Trust anchor missing.
  Algorithm disabled.
  Protocol/cipher mismatch.
  Client certificate required but absent.
  Wrong private key/certificate pair.

Engineering response:
  Enable controlled javax.net.debug.
  Inspect certificate chain.
  Verify truststore.
  Verify hostname/SAN.
  Check disabledAlgorithms.
  Check mTLS requirements.
```

---

### 19.3 Certificate Accepted Too Broadly

```text
Symptom:
  System connects successfully to wrong endpoint or fake endpoint.

Possible causes:
  Trust-all TrustManager.
  HostnameVerifier always true.
  Over-broad private CA trust.
  Leaf cert imported as broad trust anchor incorrectly.
  Identity mapping uses CN incorrectly.

Engineering response:
  Restore PKIX validation.
  Enable hostname verification.
  Constrain trust anchors.
  Map identity from SAN/policy.
  Add negative tests.
```

---

### 19.4 Crypto Works but Guarantee Is Wrong

```text
Symptom:
  Encryption/decryption/signature works in tests, but design insecure.

Possible causes:
  AES ECB.
  GCM nonce reuse.
  MAC without canonicalization.
  Signature verifies wrong bytes.
  Key reused for multiple purposes.
  No replay protection.
  No algorithm/key versioning.

Engineering response:
  Revisit security property.
  Redesign envelope.
  Add context binding.
  Separate keys by purpose.
  Add nonce/replay control.
  Add misuse tests.
```

---

## 20. Mini Case Study — Java Service Calling External Regulatory API

### 20.1 Scenario

A Java service calls an external regulatory API over HTTPS.

Requirements:

```text
- Server identity must be verified.
- Request payload must not be modified in transit.
- Payload contains sensitive applicant/case data.
- External API uses private CA certificate.
- API may later require mTLS.
- Calls must be auditable.
```

Naive implementation:

```java
// Anti-pattern: do not use in production
TrustManager[] trustAll = ...;
SSLContext context = SSLContext.getInstance("TLS");
context.init(null, trustAll, new SecureRandom());
```

Why this is broken:

```text
TLS encryption may exist, but server authentication is removed.
An attacker with network position can impersonate endpoint.
Hostname verification may also be bypassed.
Audit trail will record successful calls to possibly wrong party.
```

---

### 20.2 Better Design

```text
1. Create dedicated truststore containing external API issuing CA/intermediate.
2. Keep hostname verification enabled.
3. Use default PKIX TrustManager initialized with that truststore.
4. Restrict TLS protocol versions according to policy.
5. Monitor certificate expiry.
6. Prepare optional KeyManager path for future mTLS.
7. Add negative integration tests:
   - wrong hostname
   - expired certificate
   - untrusted CA
   - missing intermediate
8. Log correlation ID and outcome, not secrets.
9. Record certificate fingerprint/version used for troubleshooting if policy allows.
```

Conceptual code:

```java
KeyStore trustStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("external-api-truststore.p12"))) {
    trustStore.load(in, trustStorePassword);
}

TrustManagerFactory tmf = TrustManagerFactory.getInstance(
        TrustManagerFactory.getDefaultAlgorithm()
);
tmf.init(trustStore);

SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(null, tmf.getTrustManagers(), SecureRandom.getInstanceStrong());
```

Note:

- `SecureRandom.getInstanceStrong()` can block or have operational implications depending environment. In many server contexts, default `new SecureRandom()` is acceptable and provider-backed. Part randomness akan membahas ini detail.
- Code di atas hanya conceptual untuk menunjukkan relationship `KeyStore -> TrustManagerFactory -> SSLContext`.

---

### 20.3 Future mTLS Extension

Jika external API membutuhkan mTLS:

```text
Add service keystore:
  private key + client certificate chain

Initialize KeyManagerFactory:
  kmf.init(clientKeyStore, keyPassword)

Initialize SSLContext:
  sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), secureRandom)
```

Conceptual:

```java
KeyStore clientKeyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("client-identity.p12"))) {
    clientKeyStore.load(in, keyStorePassword);
}

KeyManagerFactory kmf = KeyManagerFactory.getInstance(
        KeyManagerFactory.getDefaultAlgorithm()
);
kmf.init(clientKeyStore, keyPassword);

SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), new SecureRandom());
```

Mental model:

```text
TrustManager says: "I trust the server."
KeyManager says: "This is my client identity."
```

---

## 21. Mini Case Study — Signed Case Decision Document

### 21.1 Scenario

A Java regulatory system generates a decision document. The document must be verifiable later.

Requirement:

```text
- Document content must be tamper-evident.
- Signer identity must be verifiable.
- Verification should still work after storage transfer.
- Future algorithm migration must be possible.
```

Naive design:

```text
Store PDF.
Store SHA-256 hash in database.
```

Problem:

```text
Hash detects changes only if trusted hash record remains intact.
It does not prove who approved it.
If database is modified, both PDF and hash can be replaced.
```

Better design:

```text
1. Canonicalize document bytes or sign final immutable bytes.
2. Create signature envelope:
   - version
   - algorithm
   - key id / certificate id
   - document digest
   - signature
   - signing time source
   - signer identity claim
3. Protect private signing key in HSM/KMS/controlled keystore.
4. Validate certificate/key lifecycle.
5. Store signature separately but linked immutably.
6. Optionally append audit hash chain.
```

Java pieces:

```text
MessageDigest
Signature
KeyStore / HSM provider
CertificateFactory
CertPathValidator
Provider
```

Important invariant:

```text
Signature proves a private key signed exact bytes.
Business meaning depends on binding the key/certificate to an authorized signer and approval context.
```

---

## 22. Mini Case Study — Internal Message Integrity Across Queue

### 22.1 Scenario

Service A publishes command to broker. Service B consumes it.

Requirement:

```text
- Command must not be tampered with.
- Replay should be detected.
- Broker is operationally trusted but not cryptographically trusted.
```

Possible design:

```text
Command envelope:
  commandId
  issuedAt
  issuerService
  targetService
  action
  resourceId
  payloadHash
  nonce/idempotencyKey
  signature or MAC
```

Java pieces:

```text
Mac or Signature
MessageDigest
SecureRandom
KeyStore/KMS
Provider
```

Design choice:

```text
Use HMAC if Service A and B share secret and non-repudiation is not needed.
Use digital signature if many verifiers or audit/non-repudiation matters.
```

Security review:

```text
[ ] Is the exact canonical command signed/MACed?
[ ] Is recipient/context included?
[ ] Is replay window defined?
[ ] Is command id unique?
[ ] Is key separated per purpose?
[ ] Is failed verification dead-lettered safely?
[ ] Are verification failures alertable?
```

---

## 23. How to Think Like a Top 1% Java Security Engineer

### 23.1 Do Not Start from API

Weak thinking:

```text
I need encryption. Which Java class should I use?
```

Strong thinking:

```text
What property must hold?
Against whom?
Across which boundary?
For how long?
With what key lifecycle?
With what failure behavior?
With what audit evidence?
```

Only then choose API.

---

### 23.2 Separate Mechanism from Policy

Mechanism:

```text
AES-GCM
HMAC-SHA-256
RSA-PSS
TLS 1.3
PKIX validation
```

Policy:

```text
Which services may call which endpoint?
Which CA is trusted?
How long is token valid?
Which key may sign which document?
When must key rotate?
What happens on verification failure?
```

Security systems fail when mechanism exists but policy is vague.

---

### 23.3 Design for Rotation from Day One

Anything security-related will rotate:

```text
password hashing work factor
signing key
TLS certificate
CA intermediate
KMS key
JWT key id
algorithm
provider
truststore
```

If rotation requires data migration panic or downtime, design is incomplete.

---

### 23.4 Negative Tests Are More Valuable Than Happy Path Tests

Happy path:

```text
valid cert connects
valid signature verifies
valid token accepted
```

Security tests:

```text
wrong cert rejected
expired cert rejected
wrong hostname rejected
tampered payload rejected
replayed command rejected
wrong audience token rejected
wrong key id rejected
weak algorithm rejected
missing AAD rejected
nonce reuse detected/prevented
```

Top engineer writes tests that prove rejection.

---

### 23.5 Security Error Handling Must Be Boring

Do not create clever fallback.

Bad:

```text
If signature verification fails, try legacy unsigned mode.
If TLS handshake fails, disable certificate validation.
If AES-GCM fails, try AES-CBC.
```

Better:

```text
Fail closed.
Return safe error.
Log structured security event.
Do not leak secrets.
Trigger operational alert if meaningful.
```

---

## 24. Practical Commands and Observability

### 24.1 List Security Properties

```bash
java -XshowSettings:security -version
```

Depending JDK version, output may include provider/security settings. Java 26 also enhanced TLS security diagnostics such as named groups and signature schemes in `-XshowSettings:security:tls`.

```bash
java -XshowSettings:security:tls -version
```

---

### 24.2 Inspect Keystore

```bash
keytool -list -v \
  -keystore app-keystore.p12 \
  -storetype PKCS12
```

Inspect truststore:

```bash
keytool -list -v \
  -keystore app-truststore.p12 \
  -storetype PKCS12
```

Check certificate file:

```bash
keytool -printcert -v -file server.crt
```

---

### 24.3 Debug TLS Handshake

```bash
java \
  -Djavax.net.debug=ssl,handshake,certpath \
  -jar app.jar
```

Use carefully.

Never leave verbose TLS debug in production logs without strict control.

---

### 24.4 List Providers Programmatically

```java
import java.security.Provider;
import java.security.Security;

public final class SecurityProvidersReport {
    public static void main(String[] args) {
        for (Provider provider : Security.getProviders()) {
            System.out.printf("Provider: %s %s%n", provider.getName(), provider.getVersionStr());
            provider.getServices().stream()
                    .sorted((a, b) -> (a.getType() + a.getAlgorithm())
                            .compareTo(b.getType() + b.getAlgorithm()))
                    .forEach(service -> System.out.printf(
                            "  %-24s %s%n",
                            service.getType(),
                            service.getAlgorithm()
                    ));
        }
    }
}
```

---

## 25. Review Questions

Gunakan pertanyaan ini untuk memastikan pemahaman.

1. Apa perbedaan JCA dan JSSE?
2. Apa perbedaan keystore dan truststore jika keduanya memakai class `KeyStore`?
3. Mengapa provider order bisa memengaruhi behavior aplikasi?
4. Mengapa `Cipher.getInstance("AES")` berbahaya sebagai desain?
5. Apa bedanya certificate parsing dan certificate validation?
6. Apa peran `TrustManager`?
7. Apa peran `KeyManager`?
8. Kenapa trust-all `TrustManager` menghancurkan TLS authentication?
9. Kenapa hostname verification tetap diperlukan walaupun certificate chain valid?
10. Kapan explicit provider boleh dipakai?
11. Mengapa algorithm availability harus diuji di target runtime?
12. Apa risiko JDK upgrade terhadap TLS/certificate behavior?
13. Kenapa mTLS tidak otomatis menyelesaikan authorization?
14. Apa bedanya MAC dan signature dari sisi identity/trust model?
15. Kenapa security envelope perlu versioning?

---

## 26. Summary

Java Security Architecture bukan kumpulan API acak.

Peta besarnya:

```text
JCA/JCE:
  Cryptographic primitives, provider architecture, key/cert APIs.

Provider:
  Concrete implementation behind algorithm/service requests.

KeyStore:
  Repository abstraction for private keys, secret keys, and certificates.

TrustStore:
  Semantic use of KeyStore for trusted certificates/trust anchors.

CertPath:
  PKIX certificate path validation.

JSSE:
  TLS/DTLS secure communication using KeyManager, TrustManager, SSLContext.

JAAS:
  Subject/Principal/LoginModule-based authentication framework.

JGSS:
  GSS-API/Kerberos-oriented security services.

SASL:
  Authentication framework for connection-oriented protocols.

java.security properties:
  Runtime policy controlling providers, disabled algorithms, defaults, and constraints.
```

Core mental model:

```text
Security in Java is a layered architecture:

Requirement
  -> security property
  -> protocol/primitive choice
  -> Java API facade
  -> provider implementation
  -> key/certificate/trust material
  -> runtime policy
  -> operational lifecycle
```

Jika kamu memahami peta ini, part berikutnya tentang threat modeling, crypto primitive, TLS, key management, token integrity, audit integrity, dan supply chain security akan jauh lebih mudah dan tidak terasa seperti hafalan API.

---

## 27. References

1. Oracle Java Cryptography Architecture Reference Guide, JDK 26.  
   <https://docs.oracle.com/en/java/javase/26/security/java-cryptography-architecture-jca-reference-guide.html>

2. Oracle Java Secure Socket Extension Reference Guide.  
   <https://docs.oracle.com/en/java/javase/11/security/java-secure-socket-extension-jsse-reference-guide.html>

3. Oracle Java Security Standard Algorithm Names Specification.  
   <https://docs.oracle.com/en/java/javase/11/docs/specs/security/standard-names.html>

4. Oracle JDK 26 Security Documentation Home.  
   <https://docs.oracle.com/en/java/javase/26/security/>

5. Oracle JDK 26 Migration Guide — Security Updates, PKCS12 keystore recommendation.  
   <https://docs.oracle.com/en/java/javase/26/migrate/security-updates.html>

6. Oracle Java Security Package API, `java.security`.  
   <https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/security/package-summary.html>

7. Java Platform Group / OpenJDK article: Java Cryptography Architecture.  
   <https://ops.java/security/jca/>

8. Java Platform Group article: Disabling Cryptographic Algorithms.  
   <https://ops.java/security/articles/disabling-crypto-algorithms/>

9. Oracle JRE and JDK Cryptographic Roadmap.  
   <https://www.java.com/en/jre-jdk-cryptoroadmap.html>

---

## 28. Status Seri

Part ini adalah:

```text
Part 1 dari 35
```

Seri belum selesai.

Berikutnya:

```text
Part 2 — Threat Modeling for Java Systems
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 0 — Security Mental Model for Senior Java Engineers](./learn-java-security-cryptography-integrity-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — Threat Modeling for Java Systems](./learn-java-security-cryptography-integrity-part-002.md)
