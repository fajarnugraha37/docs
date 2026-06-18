# learn-java-security-cryptography-integrity-part-015

# Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties

## 0. Posisi Part Ini Dalam Seri

Pada Part 14 kita membahas TLS/JSSE dari sisi runtime Java: `SSLContext`, `SSLSocket`, `SSLEngine`, `KeyManager`, `TrustManager`, hostname verification, mTLS, ALPN, dan debugging.

Part 15 naik satu layer: **policy enforcement di JVM/JDK**.

Di production, TLS tidak hanya ditentukan oleh kode aplikasi. TLS juga dipengaruhi oleh:

1. versi JDK,
2. provider cryptography,
3. file `java.security`,
4. security properties,
5. disabled algorithm policy,
6. truststore contents,
7. protocol/cipher defaults,
8. library/client/server configuration,
9. OS/container image,
10. organizational compliance baseline.

Satu aplikasi Java yang sama bisa punya TLS behavior berbeda ketika:

- pindah dari JDK 8 ke JDK 11/17/21/25/26,
- pindah vendor JDK,
- pindah base image container,
- `cacerts` berubah,
- `jdk.tls.disabledAlgorithms` berubah,
- `jdk.certpath.disabledAlgorithms` berubah,
- reverse proxy mengubah cipher suite,
- internal legacy service hanya mendukung TLS 1.0/1.1,
- certificate chain memakai SHA-1/MD5/weak RSA,
- mTLS client certificate memakai key size yang sudah tidak diterima.

Security engineer Java yang kuat harus paham bahwa **TLS hardening bukan sekadar menambahkan `https`**, tetapi memastikan runtime Java menolak konfigurasi yang tidak sesuai dengan security invariant organisasi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. memahami peran `java.security` dalam mengatur behavior security runtime Java;
2. membedakan TLS application configuration vs JVM-level security policy;
3. memahami `jdk.tls.disabledAlgorithms`, `jdk.certpath.disabledAlgorithms`, dan `jdk.jar.disabledAlgorithms`;
4. menjelaskan kenapa certificate yang valid secara struktur bisa tetap ditolak oleh Java;
5. menjelaskan kenapa service yang dulu bisa connect tiba-tiba gagal setelah upgrade JDK;
6. membuat TLS hardening baseline untuk Java service;
7. men-debug error seperti `SSLHandshakeException`, `Algorithm constraints check failed`, `No appropriate protocol`, dan `PKIX path validation failed`;
8. membuat exception strategy untuk legacy dependency tanpa menurunkan global security;
9. mendesain environment-specific policy untuk DEV/UAT/PROD tanpa menciptakan security drift berbahaya;
10. membuat review checklist untuk TLS hardening di Java enterprise system.

---

## 2. Mental Model Utama

### 2.1 TLS Security Bukan Hanya Milik Aplikasi

Banyak engineer mengira TLS security hanya dikontrol oleh kode seperti:

```java
SSLContext context = SSLContext.getInstance("TLS");
```

atau konfigurasi seperti:

```properties
server.ssl.enabled-protocols=TLSv1.2,TLSv1.3
server.ssl.ciphers=...
```

Padahal di Java, ada lapisan tambahan:

```text
Application code
  ↓
Framework/library TLS configuration
  ↓
JSSE API
  ↓
Security provider
  ↓
JDK security properties
  ↓
Algorithm constraints
  ↓
Certificate/path validation
  ↓
OS/container/JDK distribution
```

Artinya, walaupun aplikasi meminta TLS 1.0, runtime Java modern bisa menolaknya karena policy JDK sudah melarangnya.

Sebaliknya, walaupun kode aplikasi tidak eksplisit melarang RC4/SHA-1/weak RSA, runtime JDK bisa menolak algorithm tersebut karena disabled algorithm policy.

**Security invariant:** aplikasi tidak boleh berhasil membangun koneksi TLS jika peer hanya bisa menawarkan protocol, certificate, key, atau signature algorithm yang berada di bawah baseline security organisasi.

---

### 2.2 Security Properties Adalah Policy Gate

Security properties adalah konfigurasi level JDK yang memengaruhi banyak API security.

Contoh property penting:

```properties
jdk.tls.disabledAlgorithms=...
jdk.certpath.disabledAlgorithms=...
jdk.jar.disabledAlgorithms=...
crypto.policy=...
securerandom.source=...
ssl.KeyManagerFactory.algorithm=...
ssl.TrustManagerFactory.algorithm=...
```

Properti ini biasanya berada di:

```text
$JAVA_HOME/conf/security/java.security      # JDK 9+
$JAVA_HOME/jre/lib/security/java.security  # JDK 8 style
```

Namun nilainya juga bisa dipengaruhi oleh:

- vendor JDK,
- Java update version,
- command-line override,
- container image,
- application server,
- security manager/legacy policy,
- programmatic override via `Security.setProperty(...)`.

**Mental model:** security properties adalah “operating policy” untuk security subsystem Java.

---

### 2.3 Disabled Algorithm Policy Adalah Denylist Dengan Semantik Khusus

Disabled algorithm policy bukan sekadar list string. Ia mengandung constraint seperti:

```properties
SSLv3
TLSv1
TLSv1.1
RC4
DES
3DES_EDE_CBC
MD5withRSA
DH keySize < 1024
EC keySize < 224
RSA keySize < 2048
SHA1 jdkCA & usage TLSServer
```

Contoh constraint tersebut bisa berarti:

- protocol tertentu tidak boleh dinegosiasikan,
- cipher suite tertentu tidak boleh dipakai,
- certificate dengan signature algorithm tertentu ditolak,
- certificate dengan key size tertentu ditolak,
- constraint hanya berlaku untuk certificate chain yang berakar pada JDK CA,
- constraint hanya berlaku untuk usage tertentu seperti TLS server,
- constraint berlaku setelah tanggal tertentu.

Jadi dua certificate sama-sama memakai SHA-1 bisa punya hasil berbeda tergantung:

- trust anchor,
- usage,
- tanggal,
- chain,
- key size,
- JDK version,
- provider.

---

## 3. Problem Yang Sering Salah Dipahami

### 3.1 “TLS Enabled” Tidak Berarti TLS Aman

Kalimat “sudah pakai HTTPS” terlalu lemah.

Yang perlu ditanya:

1. Protocol version apa yang diterima?
2. Cipher suite apa yang diterima?
3. Apakah forward secrecy tersedia?
4. Apakah certificate chain valid?
5. Apakah hostname verification aktif?
6. Apakah weak signature algorithm ditolak?
7. Apakah weak key size ditolak?
8. Apakah renegotiation/resumption behavior aman?
9. Apakah client truststore bersih?
10. Apakah policy sama di semua environment?

---

### 3.2 “Handshake Failed” Bisa Berarti Security Bekerja

Banyak incident response keliru karena langsung menganggap handshake failure sebagai masalah yang harus “dibuka”.

Contoh:

```text
javax.net.ssl.SSLHandshakeException: No appropriate protocol
```

atau:

```text
Algorithm constraints check failed
```

atau:

```text
PKIX path validation failed
```

Ini bisa berarti:

- peer terlalu lemah,
- certificate chain tidak dipercaya,
- certificate expired,
- signature algorithm dilarang,
- key size terlalu kecil,
- hostname mismatch,
- JDK policy lebih ketat setelah patch.

Dalam security, failure tidak selalu bug. Kadang failure adalah **control berhasil mencegah downgrade**.

---

### 3.3 Mengubah `java.security` Global Bisa Berbahaya

Kesalahan umum:

```properties
jdk.tls.disabledAlgorithms=
```

atau menghapus `TLSv1`, `TLSv1.1`, `RC4`, `MD5`, `3DES`, `RSA keySize < ...` demi membuat legacy integration berhasil.

Masalahnya:

- perubahan global memengaruhi semua koneksi TLS dalam JVM,
- service lain yang sebelumnya aman bisa diam-diam menerima koneksi lemah,
- audit trail sulit menjelaskan exception,
- vulnerability menjadi sistemik,
- behavior beda antar environment.

**Rule:** jangan melemahkan global policy hanya untuk satu dependency legacy. Isolasi exception.

---

### 3.4 Library Configuration Bisa Dibatasi Oleh JDK Policy

Misalnya aplikasi mencoba mengaktifkan TLS 1.0:

```java
sslParameters.setProtocols(new String[] {"TLSv1"});
```

Tetapi JDK menolaknya karena `TLSv1` berada di `jdk.tls.disabledAlgorithms`.

Atau aplikasi mencoba connect ke server dengan certificate RSA 1024-bit. Truststore memiliki root CA yang benar, tetapi path validation gagal karena RSA key terlalu kecil.

**Kesimpulan:** application config adalah request; JDK security policy bisa menjadi final gatekeeper.

---

## 4. Core Concepts

## 4.1 TLS Protocol Version Policy

TLS protocol version menentukan handshake, supported cryptographic primitives, dan security properties.

Secara modern:

```text
TLS 1.3  → preferred
TLS 1.2  → masih umum dan acceptable dengan cipher kuat
TLS 1.1  → legacy, umumnya disable
TLS 1.0  → legacy, umumnya disable
SSLv3    → broken, disable
SSLv2    → broken, disable
```

### 4.1.1 Kenapa TLS 1.3 Lebih Baik

TLS 1.3 menyederhanakan handshake dan menghapus banyak legacy cryptographic options.

Dibanding TLS 1.2, TLS 1.3 menghilangkan banyak pilihan yang historically berbahaya, seperti:

- static RSA key exchange,
- CBC-mode cipher suites di TLS,
- obsolete hash/signature combinations,
- renegotiation complexity,
- banyak downgrade-prone options.

Namun TLS 1.3 bukan berarti semua masalah selesai. Masih perlu:

- certificate validation,
- hostname verification,
- correct truststore,
- key management,
- revocation strategy,
- secure application-layer semantics.

---

## 4.2 Cipher Suite Policy

Cipher suite mendefinisikan komponen cryptographic handshake.

Pada TLS 1.2, cipher suite biasanya mencakup:

```text
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
│   │     │        │       │   │
│   │     │        │       │   └─ PRF/hash
│   │     │        │       └──── mode/integrity
│   │     │        └──────────── symmetric cipher
│   │     └───────────────────── authentication/signature key type
│   └─────────────────────────── key exchange
└─────────────────────────────── TLS suite namespace
```

Yang umumnya diinginkan:

- ECDHE/DHE untuk forward secrecy,
- AEAD mode seperti AES-GCM atau ChaCha20-Poly1305,
- SHA-256 atau lebih kuat,
- RSA key cukup kuat atau ECDSA/EdDSA sesuai support,
- tidak memakai RC4/DES/3DES/CBC lama.

Pada TLS 1.3, cipher suite lebih sederhana karena key exchange dan authentication dinegosiasikan terpisah.

Contoh TLS 1.3 suite:

```text
TLS_AES_128_GCM_SHA256
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
```

---

## 4.3 Algorithm Constraints

Algorithm constraints adalah aturan yang menentukan algorithm/key/protocol mana yang boleh atau tidak boleh dipakai.

Di Java, constraint ini bisa berlaku pada:

1. TLS protocol negotiation,
2. cipher suite selection,
3. certificate path validation,
4. JAR signature validation,
5. signed XML/JAR/library verification,
6. provider-specific cryptographic operations.

Contoh:

```text
RSA keySize < 2048
```

Artinya RSA key di bawah 2048 bit bisa ditolak dalam konteks tertentu.

Contoh:

```text
SHA1 jdkCA & usage TLSServer
```

Artinya SHA-1 certificate bisa ditolak jika chain berakar pada JDK CA dan digunakan untuk TLS server.

---

## 4.4 Certificate Path Constraints

Certificate bisa gagal bukan hanya karena tidak dipercaya.

Ia bisa gagal karena:

1. expired,
2. not yet valid,
3. issuer tidak trusted,
4. chain incomplete,
5. hostname mismatch,
6. `KeyUsage` tidak sesuai,
7. `ExtendedKeyUsage` tidak sesuai,
8. Basic Constraints salah,
9. path length exceeded,
10. signature algorithm disabled,
11. public key size terlalu kecil,
12. revoked,
13. policy constraint gagal,
14. name constraints gagal.

Java CertPath validation memeriksa banyak aspek chain, bukan hanya “root ada di truststore”.

---

## 4.5 Runtime Defaults vs Explicit Configuration

Di Java, kamu bisa mengandalkan default atau mengatur eksplisit.

Contoh default:

```java
SSLContext context = SSLContext.getInstance("TLS");
context.init(null, null, null);
```

Ini memakai default provider, default key manager/trust manager, default protocols/ciphers sesuai JDK.

Contoh explicit:

```java
SSLParameters params = sslSocket.getSSLParameters();
params.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
sslSocket.setSSLParameters(params);
```

Explicit config berguna untuk clarity dan compliance, tetapi harus dijaga agar tidak mengunci aplikasi ke konfigurasi usang.

**Trade-off:**

```text
Default JDK policy
  + otomatis ikut security update
  - behavior bisa berubah setelah patch

Explicit app policy
  + predictable dan audit-friendly
  - bisa stale kalau tidak dirawat
```

Strategi mature biasanya hybrid:

- gunakan modern JDK defaults sebagai baseline,
- tambahkan minimum policy eksplisit di boundary penting,
- dokumentasikan exception,
- test compatibility secara berkala.

---

# 5. Java Security Properties Yang Penting

## 5.1 `jdk.tls.disabledAlgorithms`

Properti ini mengontrol algorithm/protocol/feature yang tidak boleh dipakai oleh JSSE untuk TLS/DTLS.

Contoh konsep:

```properties
jdk.tls.disabledAlgorithms=SSLv3, TLSv1, TLSv1.1, RC4, DES, MD5withRSA, \
    DH keySize < 1024, EC keySize < 224, 3DES_EDE_CBC, anon, NULL
```

Catatan: nilai aktual bergantung JDK version/vendor. Jangan copy mentah dari dokumen ini tanpa mengecek runtime target.

### Apa Yang Bisa Diblokir?

1. Protocol version:

```text
SSLv3
TLSv1
TLSv1.1
```

2. Cipher algorithm:

```text
RC4
DES
3DES_EDE_CBC
```

3. Signature algorithm:

```text
MD5withRSA
SHA1withRSA
```

4. Key size:

```text
RSA keySize < 2048
DH keySize < 1024
EC keySize < 224
```

5. Anonymous/NULL suites:

```text
anon
NULL
```

### Efeknya Di Runtime

Jika server hanya mendukung TLS 1.0 dan TLS 1.0 disabled:

```text
javax.net.ssl.SSLHandshakeException: No appropriate protocol
```

Jika certificate memakai weak signature/key:

```text
java.security.cert.CertPathValidatorException: Algorithm constraints check failed
```

Jika cipher suite tidak overlap:

```text
javax.net.ssl.SSLHandshakeException: no cipher suites in common
```

---

## 5.2 `jdk.certpath.disabledAlgorithms`

Properti ini mengatur algorithm/key constraint untuk certificate path validation.

Contoh konsep:

```properties
jdk.certpath.disabledAlgorithms=MD2, MD5, SHA1 jdkCA & usage TLSServer, \
    RSA keySize < 2048, DSA keySize < 2048, EC keySize < 224
```

Properti ini bisa membuat certificate chain ditolak walaupun:

- root CA ada di truststore,
- certificate belum expired,
- hostname benar,
- chain lengkap.

Karena certificate masih bisa dianggap tidak layak secara cryptographic.

---

## 5.3 `jdk.jar.disabledAlgorithms`

Properti ini mengontrol algorithm yang tidak boleh dipakai untuk memvalidasi signed JAR.

Contoh kasus:

- JAR ditandatangani dengan MD5withRSA,
- JAR ditandatangani dengan SHA1 lama,
- key size terlalu kecil,
- timestamp tidak memenuhi policy.

Part 28 akan membahas signed JAR lebih dalam. Di part ini cukup pahami bahwa Java punya algorithm constraint bukan hanya untuk TLS, tetapi juga artifact integrity.

---

## 5.4 `crypto.policy`

Properti ini historisnya penting untuk membatasi key size.

Pada JDK modern, unlimited cryptographic policy biasanya sudah default. Namun di environment legacy, kamu masih bisa menemukan masalah seperti AES-256 tidak didukung karena policy lama.

Symptoms:

```text
java.security.InvalidKeyException: Illegal key size
```

Jika menemukan ini di sistem lama, jangan langsung downgrade algorithm. Cek JDK version dan crypto policy.

---

## 5.5 `securerandom.source`

Properti ini memengaruhi sumber entropy `SecureRandom`.

Walaupun tidak spesifik TLS, TLS handshake, key generation, nonce, dan ephemeral key material bergantung pada randomness yang kuat.

Kesalahan entropy bisa menyebabkan:

- predictable key,
- nonce reuse,
- weak session key,
- startup delay jika entropy source blocking,
- production incident saat container kekurangan entropy.

Sudah dibahas di Part 4, tetapi relevan di TLS karena handshake juga butuh randomness.

---

## 5.6 `ssl.KeyManagerFactory.algorithm` dan `ssl.TrustManagerFactory.algorithm`

Properti ini menentukan default algorithm untuk factory:

```java
KeyManagerFactory.getDefaultAlgorithm();
TrustManagerFactory.getDefaultAlgorithm();
```

Biasanya default cukup aman. Namun pada application server atau environment khusus, nilai ini bisa berubah.

**Review point:** jangan mengasumsikan default selalu sama di semua runtime tanpa observability.

---

# 6. TLS Hardening Baseline Untuk Java Service

## 6.1 Baseline Prinsip

Baseline yang mature harus memenuhi:

1. minimum protocol version jelas,
2. cipher suite modern,
3. weak algorithm disabled,
4. certificate validation strict,
5. hostname verification aktif,
6. truststore terkontrol,
7. key/trust rotation aman,
8. observability TLS tersedia,
9. exception terdokumentasi,
10. regression test untuk handshake.

---

## 6.2 Recommended Baseline Praktis

Untuk aplikasi Java modern:

```text
Preferred protocol : TLS 1.3
Allowed fallback   : TLS 1.2 jika masih dibutuhkan
Disabled           : SSLv2, SSLv3, TLS 1.0, TLS 1.1
Cipher preference  : AEAD suites
Avoid              : RC4, DES, 3DES, NULL, anon, export, CBC legacy
Certificate        : RSA >= 2048 atau ECDSA kuat
Signature          : SHA-256 atau lebih kuat
Hostname verify    : wajib untuk client outbound HTTPS
mTLS               : gunakan EKU dan mapping identity yang eksplisit
```

---

## 6.3 Server-Side Java TLS Hardening

Untuk Spring Boot embedded server, konfigurasi bisa seperti:

```yaml
server:
  ssl:
    enabled: true
    enabled-protocols: TLSv1.3,TLSv1.2
```

Cipher suite configuration tergantung container dan JDK. Untuk TLS 1.3, banyak cipher suite sudah modern by design. Untuk TLS 1.2, pastikan hanya suite kuat.

Namun jangan lupa: jika aplikasi berada di belakang ALB/nginx/ingress, TLS termination mungkin tidak terjadi di Java process.

Maka hardening harus jelas:

```text
Client → Edge/ALB/Ingress → Java Service
```

Pertanyaan penting:

1. TLS terminate di mana?
2. Apakah connection edge → service juga TLS?
3. Apakah mTLS dilakukan di edge atau service?
4. Apakah service percaya header identity dari proxy?
5. Apakah proxy dapat dipalsukan dari network lain?
6. Apakah internal plaintext diperbolehkan oleh policy?

---

## 6.4 Client-Side Java TLS Hardening

Outbound Java client sering lebih berbahaya dari server karena banyak library membuat koneksi ke third-party/internal service.

Untuk Java HTTP Client:

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(null, null, null);

SSLParameters sslParameters = new SSLParameters();
sslParameters.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
sslParameters.setEndpointIdentificationAlgorithm("HTTPS");

java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
        .sslContext(sslContext)
        .sslParameters(sslParameters)
        .build();
```

Important point:

```java
sslParameters.setEndpointIdentificationAlgorithm("HTTPS");
```

Ini memastikan hostname verification semantics untuk HTTPS-style endpoint identification.

Namun banyak high-level HTTP client sudah mengaktifkan hostname verification secara default. Jangan membuat custom trust manager/hostname verifier yang melemahkan default.

---

## 6.5 Jangan Buat Trust-All Manager

Anti-pattern klasik:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Atau:

```java
HostnameVerifier allHostsValid = (hostname, session) -> true;
```

Ini menghancurkan TLS server authentication.

Akibatnya TLS masih mengenkripsi traffic, tetapi aplikasi tidak tahu sedang berbicara dengan siapa. MITM menjadi mungkin.

**Security invariant:** TLS client wajib membuktikan identity server melalui certificate path validation dan hostname verification, kecuali ada trust model lain yang eksplisit dan kuat.

---

# 7. Disabled Algorithms Failure Mode

## 7.1 Legacy Server Hanya Mendukung TLS 1.0

### Symptom

```text
javax.net.ssl.SSLHandshakeException: No appropriate protocol
```

### Root Cause

Client Java modern menolak TLS 1.0 karena disabled.

### Salah Solusi

Menghapus `TLSv1` dari `jdk.tls.disabledAlgorithms` secara global.

### Solusi Yang Lebih Baik

1. Upgrade server ke TLS 1.2/1.3.
2. Jika tidak bisa, isolasi legacy integration:
   - dedicated connector service,
   - dedicated JVM/container,
   - dedicated egress path,
   - compensating controls,
   - short expiry exception.
3. Dokumentasikan risk acceptance.
4. Monitor traffic.
5. Set deadline remediation.

---

## 7.2 Certificate Dengan RSA 1024-bit

### Symptom

```text
java.security.cert.CertPathValidatorException: Algorithm constraints check failed on keysize limits
```

### Root Cause

Certificate/public key terlalu lemah menurut policy.

### Solusi

- reissue certificate dengan RSA >= 2048 atau ECDSA kuat,
- jangan melemahkan global `jdk.certpath.disabledAlgorithms`,
- cek intermediate CA juga, bukan hanya leaf.

---

## 7.3 SHA-1 Certificate Chain

### Symptom

```text
CertPathValidatorException: Algorithm constraints check failed: SHA1withRSA
```

### Root Cause

Certificate chain memakai SHA-1 pada konteks yang dilarang.

### Solusi

- reissue certificate chain dengan SHA-256 atau lebih kuat,
- cek apakah intermediate lama masih dipakai,
- update truststore bila chain salah,
- hindari exception global.

---

## 7.4 Cipher Suite Tidak Overlap

### Symptom

```text
javax.net.ssl.SSLHandshakeException: no cipher suites in common
```

### Root Cause

Client dan server tidak punya cipher suite yang sama karena:

- server hanya mendukung cipher lama,
- client men-disable cipher lama,
- explicit cipher config terlalu sempit,
- provider tidak mendukung cipher tertentu,
- TLS version mismatch.

### Solusi

1. Ambil handshake debug.
2. Lihat offered cipher suites client.
3. Lihat accepted cipher suites server.
4. Cocokkan protocol version.
5. Upgrade sisi yang lemah.
6. Jangan enable cipher lemah hanya untuk convenience.

---

## 7.5 JDK Upgrade Membuat Integrasi Gagal

### Symptom

Service yang kemarin sukses hari ini gagal setelah base image/JDK patch.

### Root Cause Kandidat

1. Disabled algorithms berubah.
2. Root CA di `cacerts` berubah.
3. TLS default protocol berubah.
4. Cipher suite default berubah.
5. Certificate chain lawas ditolak.
6. Provider behavior berubah.

### Mature Handling

- Pin dan inventory JDK version.
- Test outbound TLS endpoints sebelum rollout.
- Simpan TLS compatibility report.
- Jangan rollback security patch tanpa risk assessment.
- Jika harus rollback, dokumentasikan exposure window.

---

# 8. Debugging TLS Hardening Di Java

## 8.1 Enable JSSE Debug

Gunakan:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Untuk lebih verbose:

```bash
-Djavax.net.debug=all
```

Namun hati-hati: debug TLS dapat mencetak informasi sensitif dan sangat verbose. Jangan aktifkan permanen di production.

---

## 8.2 Apa Yang Dicari Dalam Log

Cari bagian:

```text
ClientHello
ServerHello
supported_versions
cipher_suites
Certificate
CertificateVerify
Finished
```

Cari juga:

```text
Ignoring disabled cipher suite
Algorithm constraints check failed
PKIX path validation failed
No trusted certificate found
No available authentication scheme
No appropriate protocol
```

---

## 8.3 Checklist Debug Handshake

1. Protocol apa yang ditawarkan client?
2. Protocol apa yang dipilih server?
3. Cipher apa yang ditawarkan client?
4. Cipher apa yang dipilih server?
5. Certificate chain apa yang dikirim server?
6. Apakah chain lengkap?
7. Apakah trust anchor ada?
8. Apakah hostname cocok SAN?
9. Apakah key usage/EKU sesuai?
10. Apakah algorithm/key size diblokir?
11. Apakah mTLS client certificate dikirim?
12. Apakah server menerima client cert?
13. Apakah ALPN cocok?
14. Apakah proxy/ingress mengubah koneksi?

---

## 8.4 Inspect Runtime Security Properties

Contoh utility kecil:

```java
import java.security.Security;

public class SecurityPropertiesDump {
    public static void main(String[] args) {
        String[] keys = {
                "jdk.tls.disabledAlgorithms",
                "jdk.certpath.disabledAlgorithms",
                "jdk.jar.disabledAlgorithms",
                "crypto.policy",
                "ssl.KeyManagerFactory.algorithm",
                "ssl.TrustManagerFactory.algorithm",
                "securerandom.source"
        };

        for (String key : keys) {
            System.out.println("--- " + key + " ---");
            System.out.println(Security.getProperty(key));
        }
    }
}
```

Gunakan di runtime/container image yang sama dengan production untuk menghindari asumsi salah.

---

## 8.5 Inspect Enabled Protocols And Cipher Suites

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import java.util.Arrays;

public class TlsCapabilitiesDump {
    public static void main(String[] args) throws Exception {
        SSLContext context = SSLContext.getDefault();
        SSLEngine engine = context.createSSLEngine();

        System.out.println("Supported protocols:");
        Arrays.stream(engine.getSupportedProtocols()).sorted().forEach(System.out::println);

        System.out.println("\nEnabled protocols:");
        Arrays.stream(engine.getEnabledProtocols()).sorted().forEach(System.out::println);

        System.out.println("\nSupported cipher suites:");
        Arrays.stream(engine.getSupportedCipherSuites()).sorted().forEach(System.out::println);

        System.out.println("\nEnabled cipher suites:");
        Arrays.stream(engine.getEnabledCipherSuites()).sorted().forEach(System.out::println);
    }
}
```

Perhatikan bedanya:

```text
supported  = provider/JDK mampu
enabled    = aktif secara default setelah policy/filter
```

---

# 9. Environment-Specific Hardening

## 9.1 DEV, UAT, PROD Tidak Boleh Drift Tanpa Disadari

Masalah umum:

```text
DEV  : trust-all, self-signed, TLS 1.0 allowed
UAT  : custom truststore, TLS 1.2
PROD : managed certificate, TLS 1.3
```

Jika terlalu berbeda, testing di DEV/UAT tidak membuktikan keamanan PROD.

**Better pattern:**

```text
DEV  : boleh self-signed/internal CA, tetapi tetap validate chain & hostname
UAT  : mirror PROD trust model sejauh mungkin
PROD : strict baseline
```

Yang boleh berbeda:

- certificate issuer,
- domain name,
- trust anchor internal,
- endpoint URL,
- key material.

Yang sebaiknya tidak berbeda:

- hostname verification behavior,
- minimum TLS version,
- disabled algorithm policy,
- trust validation logic,
- mTLS requirement semantics,
- client certificate mapping logic.

---

## 9.2 Jangan Jadikan Trust-All Sebagai DEV Convenience

Trust-all di DEV menciptakan blind spot:

1. hostname mismatch tidak ketahuan,
2. incomplete chain tidak ketahuan,
3. wrong certificate tidak ketahuan,
4. expired certificate tidak ketahuan,
5. mTLS misconfiguration tidak ketahuan,
6. production bug baru muncul saat release.

Lebih baik gunakan internal CA dan proper truststore.

---

## 9.3 Exception Management Untuk Legacy Endpoint

Template exception:

```text
Legacy TLS Exception

Endpoint              : https://legacy.example.internal
Owner                 : Team/Agency/Vendor
Current weakness      : TLS 1.0 only / SHA-1 cert / RSA 1024 / weak cipher
Affected flow         : batch export / payment callback / identity bridge
Data classification   : confidential / restricted / public
Business criticality  : high/medium/low
Compensating controls : IP allowlist, VPN, connector isolation, monitoring
Exception scope       : dedicated connector JVM only
Global policy change  : forbidden
Expiry date           : yyyy-mm-dd
Remediation plan      : upgrade server certificate/TLS stack
Risk owner approval   : name/role/date
```

**Invariant:** exception harus scoped, visible, expiring, owned, dan monitored.

---

# 10. Java Code Patterns

## 10.1 Good Pattern: Use Default Trust Manager, Restrict Protocols

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class HardenedHttpClientExample {
    public static void main(String[] args) throws Exception {
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, null, null); // default key/trust manager

        SSLParameters sslParameters = new SSLParameters();
        sslParameters.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
        sslParameters.setEndpointIdentificationAlgorithm("HTTPS");

        HttpClient client = HttpClient.newBuilder()
                .sslContext(sslContext)
                .sslParameters(sslParameters)
                .build();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://example.com"))
                .GET()
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.statusCode());
    }
}
```

Why this is reasonable:

1. memakai default trust manager,
2. tetap membatasi protocol,
3. hostname verification explicit,
4. tidak bypass certificate validation,
5. masih tunduk pada JDK disabled algorithm policy.

---

## 10.2 Bad Pattern: Trust-All For Temporary Fix

```java
// Do not use this in real systems.
sslContext.init(null, trustAllManagers, new java.security.SecureRandom());
```

Masalah:

- temporary fix sering menjadi permanen,
- security review sulit mendeteksi semua callsite,
- semua peer menjadi trusted,
- TLS authentication hilang.

---

## 10.3 Good Pattern: Dedicated TrustStore For Internal CA

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.security.KeyStore;

public final class InternalCaSslContextFactory {
    public static SSLContext create(InputStream trustStoreStream, char[] password) throws Exception {
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        trustStore.load(trustStoreStream, password);

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, tmf.getTrustManagers(), null);
        return context;
    }
}
```

Catatan:

- Ini mengganti trust anchor, bukan menonaktifkan trust validation.
- Masih perlu hostname verification.
- Truststore harus punya lifecycle: versioning, rotation, audit.

---

## 10.4 Good Pattern: Fail Fast On Weak Runtime Policy

Untuk service high-assurance, startup bisa memvalidasi policy minimum:

```java
import java.security.Security;

public final class SecurityPolicyStartupCheck {
    public static void verify() {
        String tlsDisabled = Security.getProperty("jdk.tls.disabledAlgorithms");
        requireContains(tlsDisabled, "TLSv1");
        requireContains(tlsDisabled, "TLSv1.1");
        requireContains(tlsDisabled, "SSLv3");
        requireContains(tlsDisabled, "RC4");
        requireContains(tlsDisabled, "MD5");

        String certpathDisabled = Security.getProperty("jdk.certpath.disabledAlgorithms");
        requireContains(certpathDisabled, "MD5");
        requireContains(certpathDisabled, "RSA keySize");
    }

    private static void requireContains(String value, String token) {
        if (value == null || !value.contains(token)) {
            throw new IllegalStateException("Missing required security policy token: " + token);
        }
    }
}
```

Jangan terlalu naif di production karena nilai property bisa berbeda format antar JDK. Tapi pattern ini berguna sebagai guardrail.

Versi matang sebaiknya:

- parse policy lebih robust,
- punya allowed baseline per JDK version,
- emit metrics/log compliance,
- fail hanya untuk violation kritis.

---

# 11. Hardening Di Container/Kubernetes

## 11.1 JDK Image Adalah Security Dependency

Dalam container, TLS behavior dipengaruhi oleh base image:

```text
eclipse-temurin:21-jre
amazoncorretto:21
oraclelinux + JDK
distroless java
custom enterprise image
```

Yang bisa berbeda:

- JDK vendor defaults,
- CA bundle,
- crypto provider,
- `java.security`,
- OS trust store integration,
- patch cadence.

**Checklist:**

1. inventory JDK vendor/version,
2. scan base image,
3. dump security properties at startup,
4. dump TLS capabilities in non-prod,
5. test outbound TLS endpoints,
6. avoid mutable latest tags,
7. patch regularly.

---

## 11.2 Kubernetes Secret Tidak Sama Dengan Key Management

TLS hardening sering gagal karena certificate/key disimpan asal di Kubernetes Secret.

Kubernetes Secret default hanya base64 encoded; protection bergantung pada cluster configuration, encryption at rest, RBAC, audit, dan secret distribution.

Untuk TLS private key:

1. batasi RBAC,
2. gunakan namespace isolation,
3. enable encryption at rest,
4. gunakan secret rotation,
5. hindari mounting secret ke pod yang tidak membutuhkan,
6. monitor access,
7. pertimbangkan KMS/secret manager integration.

Part 24 akan membahas secrets management lebih detail.

---

## 11.3 TLS Termination Di Ingress

Jika TLS terminate di ingress:

```text
Client --TLS--> Ingress --HTTP/TLS--> Service
```

Maka Java service mungkin tidak melihat TLS peer certificate client.

Jika butuh mTLS identity:

- lakukan mTLS di ingress dan forward verified identity secara aman,
- atau pass-through TLS ke service,
- atau gunakan service mesh mTLS,
- pastikan header identity tidak bisa dipalsukan dari network lain.

**Anti-pattern:** service mempercayai `X-Client-Cert` dari semua source.

---

# 12. Policy Design: Strict, Compatible, Legacy-Isolated

## 12.1 Tiga Mode Policy

### Strict Mode

Untuk external-facing/high-risk service.

```text
TLS 1.3 preferred
TLS 1.2 fallback only if necessary
No legacy cipher
Strict certpath
No trust-all
No global exception
```

### Compatible Mode

Untuk enterprise internal yang masih butuh TLS 1.2 luas.

```text
TLS 1.2 + 1.3
AEAD only where possible
RSA >= 2048
SHA-256+
Managed truststore
```

### Legacy-Isolated Mode

Untuk endpoint yang belum bisa upgrade.

```text
Dedicated connector
Dedicated JVM/pod
Explicit risk exception
Network isolation
Short expiry
Monitoring
No global weakening
```

---

## 12.2 Decision Matrix

| Situation | Recommended Action | Avoid |
|---|---|---|
| Server supports TLS 1.3/1.2 | Use strict baseline | Overconfiguring stale cipher list |
| Server only supports TLS 1.0 | Upgrade server or isolate connector | Removing TLSv1 from global disabled list |
| SHA-1 certificate | Reissue certificate | Disabling SHA-1 restriction globally |
| RSA 1024 cert | Reissue with stronger key | Lowering RSA key constraint globally |
| DEV self-signed cert | Use internal CA/truststore | Trust-all manager |
| mTLS behind ingress | Define verified identity forwarding | Trusting arbitrary headers |
| JDK upgrade breaks TLS | Analyze algorithm constraints | Blind rollback or global weaken |

---

# 13. Testing Strategy

## 13.1 Unit Test For SSLContext Construction

```java
import org.junit.jupiter.api.Test;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertTrue;

class TlsPolicyTest {

    @Test
    void defaultEnabledProtocolsShouldNotIncludeLegacyTls() throws Exception {
        SSLContext context = SSLContext.getDefault();
        SSLEngine engine = context.createSSLEngine();

        var enabled = Arrays.asList(engine.getEnabledProtocols());

        assertTrue(enabled.contains("TLSv1.2") || enabled.contains("TLSv1.3"));
        assertTrue(!enabled.contains("SSLv3"));
        assertTrue(!enabled.contains("TLSv1"));
        assertTrue(!enabled.contains("TLSv1.1"));
    }
}
```

Ini bukan pengganti integration test, tetapi guardrail.

---

## 13.2 Integration Test Dengan Test TLS Server

Untuk benar-benar menguji hardening, buat test server dengan konfigurasi lemah:

1. TLS 1.0 only,
2. self-signed untrusted cert,
3. hostname mismatch,
4. weak RSA cert,
5. expired cert,
6. incomplete chain,
7. mTLS required without client cert.

Lalu pastikan Java client gagal dengan alasan yang diharapkan.

Security test yang baik bukan hanya membuktikan success path, tetapi juga membuktikan **unsafe path ditolak**.

---

## 13.3 Contract Test Untuk External Endpoint

Untuk dependency eksternal:

- catat supported protocol,
- catat selected cipher,
- catat certificate chain,
- catat expiry,
- catat key type/size,
- catat SAN,
- catat OCSP/CRL status jika relevan.

Simpan sebagai compatibility evidence sebelum JDK upgrade.

---

# 14. Observability

## 14.1 Metrics Yang Berguna

1. TLS handshake failure count.
2. Failure by exception class.
3. Certificate expiry days.
4. mTLS auth failure count.
5. Outbound endpoint TLS version selected.
6. Outbound endpoint certificate issuer.
7. Weak/legacy endpoint exception usage.
8. JDK version per service.
9. Security property baseline hash.
10. Truststore version.

---

## 14.2 Logging Yang Aman

Log boleh mencatat:

```text
endpoint host
port
protocol selected
cipher selected
certificate subject/issuer fingerprint
expiry date
failure class
correlation id
```

Jangan log:

```text
private key
session secrets
full certificate if contains sensitive subject data
keystore password
truststore password
full request payload dengan credential
```

---

# 15. Production Checklist

## 15.1 JVM/JDK Checklist

- [ ] JDK vendor/version terinventarisasi.
- [ ] `java.security` source jelas.
- [ ] `jdk.tls.disabledAlgorithms` baseline diketahui.
- [ ] `jdk.certpath.disabledAlgorithms` baseline diketahui.
- [ ] `jdk.jar.disabledAlgorithms` baseline diketahui.
- [ ] JDK update impact diuji.
- [ ] Security properties tidak dimodifikasi liar oleh aplikasi.
- [ ] Runtime dump tersedia di non-prod.
- [ ] Base image tidak memakai JDK obsolete.
- [ ] Patch cadence jelas.

## 15.2 TLS Server Checklist

- [ ] TLS 1.3 preferred.
- [ ] TLS 1.2 allowed hanya jika perlu.
- [ ] TLS 1.0/1.1 disabled.
- [ ] SSLv2/SSLv3 disabled.
- [ ] Weak cipher disabled.
- [ ] Certificate chain lengkap.
- [ ] Key size cukup.
- [ ] Signature algorithm modern.
- [ ] Private key protected.
- [ ] Expiry monitoring aktif.

## 15.3 TLS Client Checklist

- [ ] Trust manager tidak trust-all.
- [ ] Hostname verification aktif.
- [ ] Custom truststore punya lifecycle.
- [ ] Protocol minimum jelas.
- [ ] Outbound endpoint inventoried.
- [ ] Legacy exception scoped.
- [ ] Handshake failure observable.
- [ ] Certificate rotation tested.
- [ ] mTLS client key protected.
- [ ] No global weakening for one endpoint.

## 15.4 mTLS Checklist

- [ ] Client certificate EKU sesuai.
- [ ] Server certificate EKU sesuai.
- [ ] Identity mapping eksplisit.
- [ ] Revocation/rotation strategy jelas.
- [ ] CA trust boundary jelas.
- [ ] Header forwarding aman jika terminate di proxy.
- [ ] Client key tidak tersebar luas.
- [ ] Expiry alert tersedia.
- [ ] Certificate subject/SAN convention jelas.
- [ ] Deprovisioning flow ada.

---

# 16. Review Questions

Gunakan pertanyaan ini saat review desain/kode/config:

1. Di mana TLS terminate?
2. Siapa yang memvalidasi server identity?
3. Apakah hostname verification aktif?
4. Apakah ada custom trust manager?
5. Jika ada custom trust manager, apa threat model-nya?
6. Apakah `jdk.tls.disabledAlgorithms` dimodifikasi?
7. Apakah modifikasi itu global atau scoped?
8. Apakah TLS 1.0/1.1 benar-benar disabled?
9. Apakah masih ada dependency ke endpoint legacy?
10. Bagaimana exception legacy diisolasi?
11. Apakah certificate chain memakai SHA-1/weak RSA?
12. Apakah truststore dikontrol dan versioned?
13. Bagaimana certificate expiry dimonitor?
14. Apakah JDK update diuji terhadap outbound endpoint?
15. Apakah failure mode handshake terlihat di log/metrics?
16. Apakah DEV/UAT/PROD punya trust semantics yang sama?
17. Apakah ingress/proxy forwarding identity bisa dipalsukan?
18. Apakah mTLS client cert mapping kuat?
19. Apakah private key lifecycle jelas?
20. Apakah ada evidence untuk audit?

---

# 17. Mini Case Study: Legacy Government Integration

## 17.1 Situation

Java service modern harus connect ke legacy agency endpoint:

```text
https://legacy-agency.internal/export
```

Saat upgrade JDK 11 ke JDK 21, koneksi gagal:

```text
javax.net.ssl.SSLHandshakeException: No appropriate protocol
```

Vendor meminta tim aplikasi “enable TLSv1 lagi”.

---

## 17.2 Weak Response

Tim mengubah global Java property:

```properties
jdk.tls.disabledAlgorithms=SSLv3, RC4, DES, MD5withRSA
```

Mereka menghapus `TLSv1` dan `TLSv1.1` dari disabled list.

Akibat:

- semua outbound TLS di JVM bisa memakai TLS 1.0,
- risiko downgrade meningkat,
- audit finding muncul,
- tidak ada owner exception,
- sulit tahu endpoint mana yang memakai legacy protocol.

---

## 17.3 Better Response

Tim melakukan:

1. konfirmasi endpoint hanya mendukung TLS 1.0;
2. minta remediation plan vendor;
3. buat dedicated connector service untuk legacy integration;
4. connector berjalan di isolated namespace/network;
5. egress hanya ke endpoint legacy;
6. data payload diminimalkan;
7. traffic dimonitor;
8. exception risk accepted oleh owner;
9. exception punya expiry date;
10. main application tetap strict policy.

Architecture:

```text
Main Java Service
  strict TLS policy
  │
  │ internal authenticated call
  ▼
Legacy Connector Service
  scoped compatibility exception
  network-isolated
  monitored
  │
  ▼
Legacy Agency Endpoint
  TLS 1.0 until remediation deadline
```

---

## 17.4 Security Reasoning

Tujuannya bukan pura-pura legacy endpoint aman. Tujuannya adalah membatasi blast radius.

Invariant:

```text
Weak TLS compatibility must not become a platform-wide policy.
```

Risk accepted:

```text
Only this specific connector may communicate with this specific legacy endpoint under documented compensating controls.
```

---

# 18. Common Anti-Patterns

## 18.1 Trust-All To Fix Certificate Error

```text
Problem: PKIX path building failed
Bad fix: trust all certificates
Good fix: fix truststore/chain/hostname
```

## 18.2 Disable Hostname Verification

```text
Problem: hostname mismatch
Bad fix: return true HostnameVerifier
Good fix: issue certificate with correct SAN
```

## 18.3 Global Weakening For One Endpoint

```text
Problem: legacy TLS endpoint
Bad fix: edit java.security globally
Good fix: isolate endpoint or upgrade it
```

## 18.4 Pin Exact Cipher List Forever

```text
Problem: compliance wants strong ciphers
Bad fix: hardcode old cipher list for years
Good fix: baseline policy + regular review
```

## 18.5 Assume PROD Is Same As Local

```text
Problem: works on my machine
Bad fix: ignore JDK/container differences
Good fix: dump security properties and TLS capabilities per environment
```

## 18.6 Ignore Certificate Expiry

```text
Problem: sudden outage
Bad fix: emergency trust hack
Good fix: expiry monitoring and rotation runbook
```

---

# 19. Practical Runbook: TLS Failure Triage

## Step 1 — Identify Direction

```text
Inbound to Java service?
Outbound from Java service?
Between proxy and service?
Between service and third-party?
mTLS or server-auth only?
```

## Step 2 — Capture Error

Record:

- exception class,
- exception message,
- endpoint,
- JDK version,
- container image,
- timestamp,
- recent changes,
- certificate details.

## Step 3 — Enable Debug In Non-Prod/Repro

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

## Step 4 — Check Protocol/Cipher Overlap

Look for:

- offered protocols,
- selected protocol,
- offered cipher suites,
- selected cipher suite,
- disabled cipher messages.

## Step 5 — Check Certificate Path

Validate:

- chain complete,
- root trusted,
- intermediate correct,
- expiry,
- SAN hostname,
- key usage,
- EKU,
- signature algorithm,
- key size,
- revocation if enabled.

## Step 6 — Check JDK Policy

Dump:

```text
jdk.tls.disabledAlgorithms
jdk.certpath.disabledAlgorithms
jdk.jar.disabledAlgorithms
```

## Step 7 — Decide

Possible outcomes:

1. peer must upgrade,
2. certificate must be reissued,
3. truststore must be fixed,
4. hostname must be corrected,
5. mTLS mapping must be fixed,
6. scoped exception required,
7. JDK regression/bug/vendor issue suspected.

## Step 8 — Document Evidence

For audit:

- what failed,
- why it failed,
- what security policy blocked it,
- whether exception was granted,
- who approved,
- expiry/remediation date.

---

# 20. Advanced Notes

## 20.1 Disabled Algorithms Are Not A Full Compliance Program

`jdk.tls.disabledAlgorithms` helps enforce minimum constraints, but it does not handle everything.

It does not replace:

- certificate inventory,
- key lifecycle management,
- endpoint monitoring,
- threat modeling,
- dependency review,
- secure coding,
- incident response,
- audit evidence.

It is a gate, not a governance program.

---

## 20.2 TLS 1.2 Can Be Secure Or Insecure Depending Configuration

TLS 1.2 supports both strong and weak configurations.

Strong TLS 1.2:

```text
ECDHE + AES-GCM/ChaCha20-Poly1305 + SHA-256+ + valid cert
```

Weak TLS 1.2 possibilities:

```text
static RSA key exchange
CBC legacy suites
weak signature chain
weak DH parameters
bad hostname verification
trust-all manager
```

So “TLS 1.2” alone is not enough as a security claim.

---

## 20.3 TLS 1.3 Still Needs Operational Discipline

TLS 1.3 removes many insecure options but cannot fix:

- wrong truststore,
- stolen private key,
- expired certificate,
- bad hostname,
- compromised CA,
- weak application auth,
- broken authorization,
- replay at application layer,
- logging secrets.

---

## 20.4 Outbound TLS Governance Is Often Forgotten

Organizations often harden public inbound TLS but ignore outbound clients.

Outbound risk examples:

- service connects to fake endpoint due to DNS/proxy issue,
- trust-all client accepts MITM,
- old vendor endpoint forces weak TLS,
- JDK patch breaks integration unexpectedly,
- client certificate leaks from pod,
- service calls internet endpoint outside allowlist.

For high-assurance systems, outbound TLS should have policy, inventory, and monitoring.

---

# 21. Summary

Part 15 membangun mental model bahwa TLS security di Java tidak hanya berada di kode aplikasi, tetapi juga di runtime policy JDK.

Hal paling penting:

1. `java.security` memengaruhi behavior security runtime Java.
2. `jdk.tls.disabledAlgorithms` membatasi TLS protocol/cipher/key/signature yang boleh dipakai.
3. `jdk.certpath.disabledAlgorithms` bisa membuat certificate chain ditolak walaupun trust anchor ada.
4. `jdk.jar.disabledAlgorithms` relevan untuk artifact integrity.
5. Handshake failure kadang berarti security control bekerja.
6. Jangan melemahkan global policy untuk satu legacy endpoint.
7. Legacy compatibility harus isolated, documented, monitored, dan expiring.
8. Trust-all manager dan disabled hostname verification adalah critical anti-pattern.
9. JDK upgrade harus diperlakukan sebagai security-sensitive change.
10. Mature TLS hardening mencakup policy, testing, observability, exception management, dan runbook.

Security invariant utama:

```text
A Java service must not silently accept cryptographic protocols, certificates, keys, or signatures below the organization security baseline.
```

---

# 22. Production Review Checklist Ringkas

```text
[ ] TLS 1.0/1.1 disabled
[ ] SSLv2/SSLv3 disabled
[ ] TLS 1.3 preferred
[ ] TLS 1.2 only with strong suites
[ ] Weak ciphers disabled
[ ] Weak key sizes rejected
[ ] SHA-1/MD5 cert chains rejected where applicable
[ ] Hostname verification active
[ ] No trust-all manager
[ ] Custom truststore controlled/versioned
[ ] Certificate expiry monitored
[ ] JDK version inventoried
[ ] Security properties dumped/known
[ ] Legacy exceptions scoped and expiring
[ ] Handshake failures observable
[ ] JDK upgrade compatibility tested
```

---

# 23. Referensi

1. Oracle Java Security Properties File — https://docs.oracle.com/en/java/javase/21/security/security-properties-file.html
2. Oracle JDK Providers Documentation — https://docs.oracle.com/en/java/javase/23/security/oracle-providers.html
3. Oracle JSSE Reference Guide — https://docs.oracle.com/en/java/javase/24/security/java-secure-socket-extension-jsse-reference-guide.html
4. OWASP Transport Layer Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
5. OWASP Web Security Testing Guide: Testing for Weak Transport Layer Security — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/09-Testing_for_Weak_Cryptography/01-Testing_for_Weak_Transport_Layer_Security
6. OpenJDK JEP 332: Transport Layer Security TLS 1.3 — https://openjdk.org/jeps/332
7. OpenJDK JEP 288: Disable SHA-1 Certificates — https://openjdk.org/jeps/288
8. RFC 8446: The Transport Layer Security TLS Protocol Version 1.3 — https://www.rfc-editor.org/rfc/rfc8446
9. NIST SP 800-52 Rev. 2: Guidelines for TLS Implementations — https://csrc.nist.gov/publications/detail/sp/800-52/rev-2/final

---

# 24. Apa Yang Berikutnya

Part berikutnya adalah:

```text
Part 16 — Secure Serialization, Deserialization, and Object Integrity
```

Kita akan membahas kenapa deserialization adalah trust-boundary problem, bagaimana gadget chain bekerja secara mental model, bagaimana `ObjectInputFilter` membantu, kenapa signed serialized payload tidak otomatis aman, dan bagaimana mendesain boundary DTO yang lebih defensible.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — TLS/JSSE Deep Dive for Java Engineers](./learn-java-security-cryptography-integrity-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — Secure Serialization, Deserialization, and Object Integrity](./learn-java-security-cryptography-integrity-part-016.md)
