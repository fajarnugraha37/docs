# learn-java-security-cryptography-integrity-part-028.md

# Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `028 / 034`  
> Topik: Signed JARs, artifact integrity, Java classloading trust boundaries, plugin risk, Java agents, runtime instrumentation, module/classpath attacks, and artifact verification.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas supply chain security: Maven, Gradle, SBOM, dependency risk, provenance, repository trust, dan build integrity.

Part ini masuk satu lapisan lebih dekat ke runtime Java:

> “Setelah artifact sampai ke JVM, bagaimana JVM tahu artifact itu belum berubah, berasal dari pihak yang dipercaya, dan aman untuk di-load?”

Jawaban pendeknya: JVM bisa memverifikasi signed JAR, tetapi signed JAR **bukan silver bullet**. Signature hanya memberi sebagian guarantee:

1. File entry di dalam JAR belum berubah sejak ditandatangani.
2. Signature chain bisa diverifikasi terhadap certificate yang dipercaya.
3. Metadata signature tidak rusak.
4. Untuk sebagian use case, code signer bisa dipakai sebagai identity dari code source.

Tetapi signed JAR tidak otomatis menjamin:

1. Code tidak punya bug.
2. Code tidak malicious.
3. Dependency graph aman.
4. Certificate signer masih “secara bisnis” dapat dipercaya.
5. Classpath tidak bisa disusupi artifact lain.
6. Runtime tidak bisa diinstrumentasi oleh Java agent.
7. Artifact yang diverifikasi sama dengan artifact yang benar-benar dipakai production.
8. Build pipeline tidak compromised sebelum signing.

Karena itu part ini membahas **JAR integrity sebagai bagian dari trust chain**, bukan sebagai ritual `jarsigner` semata.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan apa yang dijamin signed JAR dan apa yang tidak.
2. Memahami struktur JAR signature: `MANIFEST.MF`, `.SF`, `.RSA`/`.DSA`/`.EC`.
3. Memahami perbedaan artifact digest, JAR signing, code signing, SBOM, dan provenance.
4. Melakukan signing dan verification JAR secara defensible.
5. Mendesain plugin architecture Java yang tidak asal `URLClassLoader`.
6. Mengenali classpath/module-path attack.
7. Memahami runtime instrumentation risk dari Java agent.
8. Menentukan kapan signed JAR cukup, kapan perlu container image signing, checksum, repository attestation, atau deployment admission control.
9. Membuat review checklist untuk artifact/runtime trust.
10. Membuat decision record untuk artifact integrity pada sistem enterprise/regulatory.

---

## 2. Mental Model Utama

### 2.1 Java Runtime Memuat Bytecode, Bukan “Project”

Saat aplikasi Java dijalankan, JVM tidak peduli struktur Git repository-mu.

JVM peduli pada:

1. Class bytes.
2. Resource bytes.
3. Classpath/module path.
4. Classloader graph.
5. Native libraries.
6. Java agents.
7. JVM flags.
8. Security properties.
9. Runtime environment.

Dengan kata lain:

```text
Source code reviewed
  ↓
Compiled bytecode
  ↓
Packaged artifact
  ↓
Published artifact
  ↓
Fetched dependency
  ↓
Loaded by JVM
  ↓
Executed as trusted code
```

Security risk bisa masuk di semua tahap itu.

Signed JAR hanya menjaga sebagian dari tahap:

```text
Packaged artifact
  ↓
Integrity/authenticity metadata attached
  ↓
Verified before/during loading
```

Kalau source code sudah malicious sebelum signing, signed JAR tetap “valid”.

---

### 2.2 Artifact Integrity Bukan Sama Dengan Runtime Trust

Ada beberapa jenis trust:

| Trust Type | Pertanyaan | Contoh Control |
|---|---|---|
| Content integrity | Apakah bytes berubah? | SHA-256 checksum, digest, signed manifest |
| Publisher authenticity | Siapa yang menandatangani? | Code signing certificate |
| Build provenance | Dari workflow mana artifact dibuat? | SLSA provenance, CI attestation |
| Dependency legitimacy | Apakah dependency ini dependency yang benar? | Dependency lockfile, repository policy |
| Runtime loading trust | Artifact mana yang benar-benar di-load? | Classpath audit, module path constraint |
| Execution trust | Apakah code punya hak melakukan aksi tertentu? | sandboxing, container policy, permission model |
| Operational trust | Apakah yang dideploy sama dengan yang disetujui? | release approval, image digest pinning |

Signed JAR paling kuat pada dua hal pertama:

1. Integrity of JAR entries.
2. Authenticity of signer.

Tetapi dia tidak sendiri cukup untuk secure software supply chain.

---

### 2.3 Code Signer Adalah Identitas, Bukan Jaminan Moral

Signature menjawab:

> “Private key pemilik certificate ini digunakan untuk menandatangani artifact ini.”

Signature tidak menjawab:

> “Artifact ini aman.”
> “Signer ini tidak pernah compromised.”
> “Signer ini masih trusted oleh organisasi.”
> “Signer ini tidak melakukan malicious update.”
> “Artifact ini dibuat dari source commit yang direview.”

Karena itu signature verification harus digabung dengan policy:

1. Signer apa yang diterima?
2. Certificate chain apa yang dipercaya?
3. Algorithm apa yang diterima?
4. Timestamp apa yang diterima?
5. Artifact coordinate apa yang boleh ditandatangani signer itu?
6. Di environment mana artifact boleh berjalan?
7. Bagaimana revocation/compromise ditangani?

---

## 3. JAR sebagai Security Container

### 3.1 Apa Itu JAR

JAR pada dasarnya adalah ZIP archive dengan convention Java:

```text
example.jar
  META-INF/
    MANIFEST.MF
  com/example/App.class
  com/example/Service.class
  application.properties
```

JAR bisa berisi:

1. `.class` bytecode.
2. Resource.
3. Service provider configuration.
4. Native library wrapper.
5. Metadata manifest.
6. Signature metadata.
7. Multi-release class variants.
8. Module descriptor (`module-info.class`).

Karena berbasis ZIP, JAR membawa risiko umum archive:

1. Duplicate entries.
2. Path confusion.
3. Metadata manipulation.
4. Repackaging.
5. Shading collision.
6. Resource override.
7. Manifest rewriting.

---

### 3.2 Manifest

`META-INF/MANIFEST.MF` adalah metadata utama.

Contoh sederhana:

```text
Manifest-Version: 1.0
Main-Class: com.example.App
Implementation-Title: payment-service
Implementation-Version: 1.2.3
```

Untuk signed JAR, manifest juga berisi digest untuk entry tertentu:

```text
Name: com/example/App.class
SHA-256-Digest: <base64-digest>

Name: com/example/Service.class
SHA-256-Digest: <base64-digest>
```

Mental model:

```text
JAR entry bytes
  ↓ digest
Manifest per-entry digest
  ↓ digest/signature
Signature file
  ↓ digital signature
Signature block
```

Jadi JAR signing bukan hanya “sign satu file JAR utuh”. Format klasik signed JAR bekerja melalui digest per entry dan signature metadata di `META-INF`.

---

### 3.3 Signed JAR Structure

Signed JAR biasanya menambahkan file:

```text
META-INF/MANIFEST.MF
META-INF/ALIAS.SF
META-INF/ALIAS.RSA
```

atau:

```text
META-INF/ALIAS.DSA
META-INF/ALIAS.EC
```

Komponen:

| File | Fungsi |
|---|---|
| `MANIFEST.MF` | Digest per signed entry |
| `.SF` | Signature file yang berisi digest atas bagian manifest |
| `.RSA` / `.DSA` / `.EC` | Signature block berisi digital signature dan certificate chain |
| `.DSA` | Legacy DSA signature block |
| `.EC` | ECDSA signature block |
| `.RSA` | RSA signature block |

Verification flow secara konseptual:

```text
1. Verify signature block validates .SF.
2. Verify .SF digest matches MANIFEST.MF sections.
3. Verify MANIFEST.MF digest matches actual JAR entries.
4. Verify certificate chain and algorithm constraints.
5. Mark code source / signer info for loaded classes.
```

Kalau satu class entry berubah, digest-nya tidak cocok.

---

## 4. Guarantee Signed JAR

### 4.1 Guarantee yang Bisa Diberikan

Signed JAR dapat memberi guarantee berikut:

#### 1. Entry Integrity

Jika class/resource yang ditandatangani berubah, verification gagal.

```text
Original signed class:
  com/example/PaymentService.class
      ↓
Digest stored in MANIFEST.MF

Modified class:
  com/example/PaymentService.class
      ↓
Digest mismatch
      ↓
Verification failure
```

#### 2. Signer Authenticity

Jika signature valid dan certificate chain trusted, verifier bisa menyimpulkan:

```text
Artifact was signed using private key corresponding to certificate X.
```

#### 3. Tamper Detection

Perubahan setelah signing dapat dideteksi.

#### 4. Partial Code Identity

Java security model dapat mengasosiasikan loaded class dengan `CodeSource` dan signer.

#### 5. Artifact Release Evidence

Dalam audit, signed JAR dapat menjadi bukti bahwa artifact tertentu disetujui dan tidak berubah sejak signing.

---

### 4.2 Guarantee yang Tidak Diberikan

Signed JAR tidak menjamin:

#### 1. Source Code Review

Signature tidak tahu apakah source commit direview.

#### 2. Dependency Safety

Dependency transitif bisa vulnerable meskipun artifact signed.

#### 3. Malicious Signer Prevention

Signer sendiri bisa malicious atau compromised.

#### 4. Runtime Classpath Correctness

JAR A signed, tetapi classpath bisa memuat JAR B lebih dulu.

#### 5. Configuration Integrity

Config external, environment variable, command-line args, mounted file, dan secret injection biasanya di luar JAR signature.

#### 6. Native Runtime Integrity

JNI/native library, Java agent, container image, dan OS package bisa mempengaruhi runtime.

#### 7. Dynamic Loading Integrity

Plugin yang diunduh setelah startup harus diverifikasi secara terpisah.

#### 8. Behavioral Safety

Valid signature tidak membuktikan absence of vulnerability.

---

## 5. JAR Signing vs Checksum vs SBOM vs Provenance

### 5.1 SHA-256 Checksum

Checksum menjawab:

> “Apakah file yang saya download sama dengan digest yang saya harapkan?”

Contoh:

```bash
sha256sum app.jar
```

Kelemahan:

1. Jika attacker bisa mengganti JAR dan checksum di website yang sama, checksum tidak berguna.
2. Checksum tidak memberikan publisher identity.
3. Checksum tidak memberi provenance.

Checksum kuat jika:

1. Digest diperoleh dari channel lain yang trusted.
2. Digest dipin di deployment manifest.
3. Digest disimpan di signed release metadata.

---

### 5.2 PGP/Detached Signature

Detached signature menjawab:

> “Apakah file ini ditandatangani oleh private key tertentu?”

Contoh konsep:

```text
app.jar
app.jar.asc
```

Kelebihan:

1. Tidak mengubah JAR.
2. Bisa dipakai untuk artifact apapun.
3. Umum di Maven Central ecosystem.

Kelemahan:

1. Verification biasanya dilakukan oleh tooling eksternal, bukan JVM.
2. Runtime Java tidak otomatis memverifikasi detached signature.
3. Trust keyring harus dikelola.

---

### 5.3 Signed JAR

Signed JAR menjawab:

> “Apakah entry dalam JAR ini masih cocok dengan manifest yang ditandatangani?”

Kelebihan:

1. Metadata signature embedded dalam JAR.
2. JVM/tooling Java bisa memahami signature.
3. Bisa mengasosiasikan signer dengan code source.

Kelemahan:

1. Tidak melindungi external config/dependency.
2. Bisa membingungkan jika sebagian entry signed dan sebagian tidak.
3. Bisa rusak oleh shading/repackaging.
4. Perlu certificate/trust policy.

---

### 5.4 SBOM

SBOM menjawab:

> “Komponen apa saja yang ada di artifact/sistem ini?”

SBOM tidak menjamin artifact tidak berubah kecuali SBOM itu sendiri juga signed/attested.

SBOM berguna untuk:

1. Vulnerability response.
2. License review.
3. Dependency inventory.
4. Supply chain risk analysis.
5. Incident blast radius.

---

### 5.5 Provenance

Provenance menjawab:

> “Artifact ini dibuat dari source, workflow, builder, dan parameters apa?”

Provenance lebih dekat ke pertanyaan:

```text
Can I trust how this artifact was built?
```

Bukan hanya:

```text
Did bytes change after signing?
```

Idealnya:

```text
Source commit reviewed
  ↓
CI workflow trusted
  ↓
Build isolated
  ↓
Tests passed
  ↓
Artifact produced
  ↓
SBOM generated
  ↓
Artifact + SBOM signed/attested
  ↓
Deployment pins artifact digest
```

Signed JAR adalah satu link di chain ini.

---

## 6. Basic `jarsigner` Workflow

### 6.1 Membuat Keypair untuk Demo

Untuk demo lokal:

```bash
keytool \
  -genkeypair \
  -alias release-signing \
  -keyalg RSA \
  -keysize 3072 \
  -sigalg SHA384withRSA \
  -keystore release-signing.p12 \
  -storetype PKCS12 \
  -validity 365 \
  -dname "CN=Example Release Signing, OU=Engineering, O=Example Corp, C=ID"
```

Catatan:

1. Demo self-signed tidak cukup untuk production trust.
2. Production perlu CA/code signing policy.
3. Private key tidak boleh tinggal sembarangan di laptop developer.
4. Signing sebaiknya terjadi di controlled CI/release system.
5. Untuk high assurance, gunakan HSM/KMS-backed signing.

---

### 6.2 Menandatangani JAR

```bash
jarsigner \
  -keystore release-signing.p12 \
  -storetype PKCS12 \
  -signedjar app-signed.jar \
  app.jar \
  release-signing
```

Untuk timestamp:

```bash
jarsigner \
  -keystore release-signing.p12 \
  -storetype PKCS12 \
  -tsa https://timestamp.example.com \
  -signedjar app-signed.jar \
  app.jar \
  release-signing
```

Timestamp penting karena:

1. Certificate signer bisa expire.
2. Signature masih bisa dianggap valid jika dibuat saat certificate masih valid.
3. Audit bisa membedakan “signed before expiry” vs “signed after expiry”.
4. Tanpa timestamp, long-term validation lebih sulit.

---

### 6.3 Verifikasi JAR

Basic:

```bash
jarsigner -verify app-signed.jar
```

Lebih informatif:

```bash
jarsigner -verify -verbose -certs app-signed.jar
```

Yang harus diperhatikan:

1. Apakah “jar verified” muncul?
2. Apakah ada warning algorithm lemah?
3. Apakah certificate chain trusted?
4. Apakah ada unsigned entries?
5. Apakah timestamp ada?
6. Apakah signer sesuai expected identity?
7. Apakah ada expired/revoked certificate warning?
8. Apakah signature menggunakan algorithm yang masih acceptable?

---

### 6.4 Verification Bukan Sekadar Exit Code

Exit code bisa memberi sinyal, tetapi production release gate harus membaca warning juga.

Contoh warning yang harus dianggap serius:

```text
The signer certificate is self-signed.
The certificate will expire within six months.
The SHA1 algorithm specified for the digest algorithm is considered a security risk.
This jar contains entries whose certificate chain is invalid.
This jar contains unsigned entries.
```

Policy yang baik:

```text
Fail if:
- verification fails
- signer is not allowlisted
- certificate chain invalid
- algorithm disabled/weak
- timestamp missing for release artifacts
- unsigned class/resource entries exist
- signer certificate near expiry
- jar contains duplicate suspicious entries
```

---

## 7. Programmatic Verification

### 7.1 Kapan Perlu Programmatic Verification

Gunakan programmatic verification saat:

1. Aplikasi memuat plugin dari direktori eksternal.
2. Aplikasi mengunduh extension setelah startup.
3. Service menjalankan job script/JAR dari tenant/admin.
4. Sistem regulatory memproses signed executable artifact.
5. Agent/plugin marketplace internal.
6. Runtime perlu enforce signer policy.

Jangan bergantung pada “developer sudah menjalankan `jarsigner -verify`” jika artifact dimuat dinamis di production.

---

### 7.2 Mental Model Verifikasi Programmatic

Important pitfall:

> Membuka `JarFile` saja tidak cukup; entries harus dibaca sampai EOF agar verification trigger.

Pseudo-flow:

```text
Open JarFile with verification enabled
  ↓
Iterate all entries
  ↓
Read every byte of every non-directory entry
  ↓
Collect certificates/signers
  ↓
Ensure every relevant entry is signed
  ↓
Ensure signer matches allowed signer
  ↓
Reject if unsigned class/resource
```

---

### 7.3 Example: Verify All Entries Are Signed

Contoh edukatif:

```java
package com.example.security.jar;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.security.CodeSigner;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.Objects;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public final class JarSignatureVerifier {

    private JarSignatureVerifier() {
    }

    public static VerificationResult verifySignedJar(Path jarPath) throws IOException {
        Objects.requireNonNull(jarPath, "jarPath");

        try (JarFile jar = new JarFile(jarPath.toFile(), true)) {
            Enumeration<JarEntry> entries = jar.entries();

            int checkedEntries = 0;
            int signedEntries = 0;

            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();

                if (entry.isDirectory()) {
                    continue;
                }

                String name = entry.getName();

                // Signature metadata itself does not need to be signed as a payload entry.
                if (name.startsWith("META-INF/")) {
                    continue;
                }

                readFully(jar, entry);
                checkedEntries++;

                CodeSigner[] signers = entry.getCodeSigners();
                if (signers == null || signers.length == 0) {
                    return VerificationResult.rejected(
                            "Unsigned entry found: " + name
                    );
                }

                signedEntries++;
            }

            if (checkedEntries == 0) {
                return VerificationResult.rejected("JAR contains no payload entries");
            }

            return VerificationResult.accepted(checkedEntries, signedEntries);
        } catch (SecurityException ex) {
            return VerificationResult.rejected("Signature verification failed: " + ex.getMessage());
        }
    }

    private static void readFully(JarFile jar, JarEntry entry) throws IOException {
        byte[] buffer = new byte[8192];

        try (InputStream in = jar.getInputStream(entry)) {
            while (in.read(buffer) != -1) {
                // Reading triggers verification.
            }
        }
    }

    public record VerificationResult(
            boolean accepted,
            String reason,
            int checkedEntries,
            int signedEntries
    ) {
        public static VerificationResult accepted(int checkedEntries, int signedEntries) {
            return new VerificationResult(true, "accepted", checkedEntries, signedEntries);
        }

        public static VerificationResult rejected(String reason) {
            return new VerificationResult(false, reason, 0, 0);
        }
    }
}
```

Ini belum cukup untuk production karena belum mengecek:

1. Signer identity.
2. Certificate chain.
3. Trust anchor.
4. Revocation.
5. Timestamp.
6. Algorithm constraints.
7. Expected artifact coordinate.
8. Allowed resource policy.
9. Duplicate entries.
10. Multi-release entries.

Namun ini menunjukkan prinsip penting: **read entries to trigger verification**.

---

### 7.4 Example: Allowlist Signer Certificate Fingerprint

Contoh edukatif fingerprint certificate:

```java
package com.example.security.jar;

import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.HexFormat;
import java.util.Objects;

public final class CertificateFingerprint {

    private CertificateFingerprint() {
    }

    public static String sha256Fingerprint(Certificate certificate) {
        Objects.requireNonNull(certificate, "certificate");

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] encoded = certificate.getEncoded();
            byte[] hash = digest.digest(encoded);
            return HexFormat.of().withUpperCase().formatHex(hash);
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to fingerprint certificate", ex);
        }
    }

    public static boolean isExpectedSigner(
            X509Certificate certificate,
            String expectedSha256Fingerprint
    ) {
        String actual = sha256Fingerprint(certificate);
        return MessageDigest.isEqual(
                actual.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                expectedSha256Fingerprint.getBytes(java.nio.charset.StandardCharsets.US_ASCII)
        );
    }
}
```

Catatan:

1. Fingerprint allowlist sederhana tapi operationally heavy.
2. Certificate rotation harus direncanakan.
3. Jangan pin certificate tanpa rotation strategy.
4. Untuk enterprise, lebih baik gunakan trust anchor + policy + expected subject/issuer + validity + revocation jika memungkinkan.
5. Untuk high assurance, combine dengan signed metadata yang mengikat artifact coordinate ke signer.

---

## 8. Partial Signing dan Unsigned Entries

### 8.1 Bahaya “Jar Verified” Tetapi Ada Unsigned Payload

Signed JAR bisa berisi:

1. Signed entries.
2. Unsigned entries.
3. Signature metadata.
4. Resource tambahan setelah signing.

Jika verifier tidak strict, attacker bisa menambahkan resource berbahaya.

Contoh risiko:

```text
Signed classes:
  com/example/SafePlugin.class

Unsigned resource added after signing:
  META-INF/services/com.example.Plugin
  plugin-config.yml
  templates/malicious.vm
```

Kalau aplikasi membaca resource unsigned untuk menentukan behavior, signature pada class tidak cukup.

Rule senior:

> Jika artifact diperlakukan sebagai trusted unit, semua payload entry yang mempengaruhi behavior harus signed atau artifact harus ditolak.

---

### 8.2 Class vs Resource Integrity

Sering engineer hanya fokus `.class`.

Padahal resource juga bisa mengubah behavior:

1. `application.properties`
2. `logback.xml`
3. `META-INF/services/...`
4. `spring.factories`
5. `AutoConfiguration.imports`
6. XML mapper
7. SQL migration
8. templates
9. policy file
10. rule file
11. workflow definition
12. feature flag default
13. YAML config
14. native library
15. script

Jika resource menentukan logic, resource itu bagian dari code.

---

### 8.3 META-INF/services Attack

Java Service Provider Interface memakai:

```text
META-INF/services/<fully-qualified-interface-name>
```

Isi file menunjuk implementation class.

Jika attacker bisa menambahkan/mengubah service file:

```text
com.attacker.MaliciousProvider
```

Maka runtime dapat memuat provider berbeda.

Risiko meningkat pada:

1. Plugin system.
2. JDBC driver discovery.
3. Security provider discovery.
4. Serialization provider.
5. XML parser provider.
6. Logging provider.
7. Cloud SDK provider.
8. Custom extension framework.

Policy:

```text
Treat META-INF/services as executable metadata.
```

---

## 9. Duplicate Entries and Ambiguous JAR Content

### 9.1 Masalah Duplicate Entry

ZIP/JAR bisa punya duplicate entry names dalam beberapa kondisi/tooling. Perilaku konsumsi bisa berbeda antar tool.

Contoh:

```text
com/example/Authz.class
com/example/Authz.class
```

Pertanyaan:

1. Entry mana yang diverifikasi?
2. Entry mana yang dipakai classloader?
3. Entry mana yang terlihat oleh scanner?
4. Entry mana yang diekstrak?
5. Entry mana yang dibaca build tool?

Untuk high assurance, duplicate entries harus ditolak.

---

### 9.2 Shading dan Repackaging

Fat JAR/shaded JAR sering:

1. Menggabungkan dependency.
2. Mengubah package.
3. Menggabungkan resources.
4. Menghapus signature metadata lama.
5. Menghasilkan manifest baru.

Risiko:

1. Signature dependency upstream hilang.
2. Resource collision.
3. Service loader collision.
4. Class shadowing.
5. Dependency scanner bingung.
6. License/SBOM mismatch.
7. Artifact terlihat signed oleh internal signer padahal membawa dependency berbahaya.

Rule:

> Setelah shading/repackaging, treat artifact sebagai artifact baru yang butuh verification, SBOM, scanning, signing, dan provenance sendiri.

---

### 9.3 Fat JAR Signature Anti-Pattern

Anti-pattern:

```text
Download dependencies
  ↓
Build fat JAR
  ↓
Remove META-INF/*.RSA/*.SF because runtime error
  ↓
Sign final fat JAR
  ↓
Assume all upstream trust preserved
```

Ini salah karena upstream signatures tidak lagi memberi evidence.

Yang benar:

```text
Resolve locked dependencies
  ↓
Verify dependency checksums/signatures where policy requires
  ↓
Generate SBOM from resolved graph
  ↓
Build fat JAR
  ↓
Scan final artifact
  ↓
Sign final artifact
  ↓
Attach provenance
  ↓
Deploy by digest
```

---

## 10. Classloading Trust Boundary

### 10.1 Classloader Mental Model

Classloader menentukan dari mana class bytes berasal.

```text
Bootstrap ClassLoader
  ↓
Platform ClassLoader
  ↓
Application ClassLoader
  ↓
Custom Plugin ClassLoader(s)
```

Class identity di Java bukan hanya class name:

```text
Class identity = fully qualified name + defining classloader
```

Artinya dua class dengan nama sama dari classloader berbeda adalah tipe berbeda.

Security implication:

1. Classloader adalah trust boundary.
2. Parent delegation mempengaruhi siapa boleh override class.
3. Plugin isolation bergantung pada desain classloader.
4. Shared API harus dikelola hati-hati.
5. Context classloader dapat membuka jalur loading yang tidak diinginkan.

---

### 10.2 Parent-First vs Child-First

Parent-first:

```text
Plugin asks for com.example.Foo
  ↓
Parent searched first
  ↓
Plugin cannot override parent class easily
```

Child-first:

```text
Plugin searched first
  ↓
Plugin can provide its own class version
  ↓
Higher flexibility, higher risk
```

Child-first umum di plugin system atau app server, tetapi risk-nya:

1. Dependency shadowing.
2. API spoofing.
3. Security class override attempt.
4. Different versions hidden.
5. Unexpected provider loaded.

Rule:

```text
Use parent-first for trusted platform API.
Use explicit allowlist for plugin-owned packages.
Reject plugins that define forbidden package prefixes.
```

Forbidden examples:

```text
java.*
javax.*
jakarta.*
sun.*
com.sun.*
org.springframework.security.*
com.company.platform.security.*
com.company.platform.spi.*
```

---

### 10.3 Package Sealing

Package sealing membuat package dalam JAR hanya boleh berasal dari code source yang sama.

Manifest:

```text
Name: com/example/security/
Sealed: true
```

Tujuannya:

1. Mencegah package split dari JAR lain.
2. Mengurangi class injection dalam package yang sama.
3. Membantu menjaga integrity package-level assumptions.

Keterbatasan:

1. Tidak menggantikan dependency control.
2. Tidak menghentikan semua classpath attack.
3. Jar/module path tetap harus dikontrol.
4. Split packages di modern Java/module system punya dinamika sendiri.

---

### 10.4 CodeSource and ProtectionDomain

Loaded class memiliki metadata:

1. `CodeSource`
2. Certificates/signers
3. `ProtectionDomain`
4. ClassLoader

Di era Security Manager aktif, ini digunakan untuk permission decision.

Walaupun Security Manager sudah deprecated for removal, konsep ini masih berguna untuk memahami:

1. Dari mana class berasal.
2. Signer apa yang melekat.
3. Boundary antara platform code dan extension code.
4. Audit runtime loading.

---

## 11. Security Manager Context

### 11.1 Jangan Mendesain Security Baru Mengandalkan Security Manager

Java Security Manager dulu bisa digunakan untuk sandboxing code untrusted dengan permission model.

Namun modern Java sudah mengarah menjauh dari Security Manager. Maka untuk sistem baru:

1. Jangan mengandalkan Security Manager sebagai boundary utama.
2. Gunakan OS/container sandbox.
3. Gunakan process isolation.
4. Gunakan network/file permission di level platform.
5. Gunakan language/runtime boundary jika menjalankan untrusted code.
6. Gunakan separate worker process untuk plugin tidak fully trusted.

Signed JAR bukan pengganti sandbox.

---

### 11.2 Apa Implikasinya untuk Plugin System

Kalau plugin tidak sepenuhnya trusted, jangan hanya:

```text
verify signature
  ↓
load plugin in same JVM
  ↓
hope it behaves
```

Karena once loaded in same JVM, plugin bisa:

1. Consume CPU/memory.
2. Start threads.
3. Read environment variables.
4. Access filesystem jika process boleh.
5. Make network calls jika process boleh.
6. Use reflection.
7. Interfere with static state.
8. Trigger classloader leaks.
9. Register shutdown hooks.
10. Use service loader tricks.

Lebih aman:

```text
Untrusted plugin
  ↓
Separate process/container
  ↓
Narrow IPC contract
  ↓
Resource limits
  ↓
Network/file restrictions
  ↓
Signed plugin verification
  ↓
Observable execution
```

---

## 12. Plugin Architecture Security

### 12.1 Plugin Threat Model

Pertanyaan wajib:

1. Siapa yang membuat plugin?
2. Apakah plugin internal atau third-party?
3. Apakah plugin tenant-supplied?
4. Apakah plugin bisa mengakses data sensitif?
5. Apakah plugin bisa melakukan network call?
6. Apakah plugin bisa menulis file?
7. Apakah plugin bisa mempengaruhi authorization?
8. Apakah plugin bisa memuat dependency sendiri?
9. Apakah plugin bisa menjalankan native code?
10. Bagaimana plugin di-disable saat incident?

---

### 12.2 Plugin Trust Levels

| Level | Description | Loading Strategy |
|---|---|---|
| Fully trusted internal | Dibuat oleh team yang sama, pipeline sama | Same JVM possible |
| Trusted partner | Pihak eksternal tapi kontrak kuat | Same JVM only with strict verification and API boundary |
| Marketplace plugin | Banyak publisher | Prefer isolated process |
| Tenant-uploaded plugin | User/customer supplied | Do not run in main JVM |
| Rule/script provided by admin | Bisa salah/malicious | Sandbox/interpreter/process isolation |
| Generated code | Output tool/LLM/compiler | Treat as untrusted until reviewed |

---

### 12.3 Secure Plugin Loading Flow

```text
Discover plugin artifact
  ↓
Verify artifact digest
  ↓
Verify signature
  ↓
Verify signer policy
  ↓
Verify artifact coordinate and version policy
  ↓
Verify SBOM / dependency policy
  ↓
Check revocation/denylist
  ↓
Scan manifest/resource policy
  ↓
Reject forbidden packages/classes/resources
  ↓
Create isolated classloader/process
  ↓
Expose narrow SPI
  ↓
Observe runtime behavior
```

---

### 12.4 SPI Boundary Design

Bad SPI:

```java
public interface Plugin {
    void execute(ApplicationContext context);
}
```

Kenapa buruk?

1. Plugin mendapat terlalu banyak capability.
2. Plugin bisa akses beans internal.
3. Plugin bisa bypass authorization.
4. Plugin bisa mutate global state.
5. Plugin bisa baca secret/config.

Better SPI:

```java
public interface CaseDecisionPlugin {
    DecisionResult evaluate(CaseDecisionRequest request);
}
```

Dengan request immutable:

```java
public record CaseDecisionRequest(
        String caseType,
        String stage,
        Map<String, String> normalizedFacts,
        Instant decisionTime
) {
}
```

Dan result terbatas:

```java
public record DecisionResult(
        DecisionOutcome outcome,
        List<String> reasons,
        Map<String, String> metadata
) {
}
```

Prinsip:

1. Beri data minimum.
2. Beri capability minimum.
3. Jangan berikan service locator.
4. Jangan expose repository.
5. Jangan expose raw entity.
6. Jangan expose security context internal.
7. Semua output divalidasi.
8. Semua decision diaudit.
9. Plugin timeout.
10. Plugin failure tidak corrupt state.

---

### 12.5 Plugin Revocation

Kamu perlu bisa menjawab:

1. Bagaimana memblokir plugin versi tertentu?
2. Bagaimana memblokir signer tertentu?
3. Bagaimana menarik plugin dari production?
4. Bagaimana memaksa reload?
5. Bagaimana audit historical decision yang dibuat plugin?
6. Bagaimana reprocess setelah plugin malicious ditemukan?
7. Bagaimana detect plugin masih dipakai?
8. Bagaimana rotation signing certificate plugin?

Plugin registry minimal:

```text
plugin_id
version
artifact_digest
signer_fingerprint
status: APPROVED | REVOKED | QUARANTINED | DEPRECATED
approved_by
approved_at
effective_from
effective_until
risk_notes
```

---

## 13. Classpath Attack

### 13.1 Apa Itu Classpath Attack

Classpath attack terjadi ketika runtime memuat class/resource dari lokasi yang tidak diharapkan.

Contoh:

```bash
java -cp malicious.jar:app.jar com.example.App
```

Jika `malicious.jar` punya class yang sama:

```text
com/example/AuthService.class
```

dan classloader menemukan malicious dulu, runtime bisa menjalankan class attacker.

---

### 13.2 Sumber Classpath Drift

Classpath berubah karena:

1. Startup script manual.
2. Wildcard classpath.
3. Directory writable.
4. Shared lib folder.
5. App server global lib.
6. Fat JAR unpacked incorrectly.
7. Sidecar/init container inject file.
8. CI artifact mix-up.
9. Docker image layer contaminated.
10. Emergency patch manual copy.
11. Old JAR not removed.
12. Vendor library override.

---

### 13.3 Wildcard Classpath Risk

Contoh:

```bash
java -cp "lib/*:app.jar" com.example.App
```

Risiko:

1. Semua JAR di `lib` ikut dimuat.
2. Urutan bisa tidak intuitif.
3. File tambahan bisa masuk.
4. Old vulnerable jar bisa tetap ada.
5. Attacker dengan write access ke folder bisa inject jar.

Lebih aman:

1. Build classpath explicit.
2. Directory runtime read-only.
3. Ownership strict.
4. Deployment by immutable image.
5. Startup logs classpath digest.
6. CI verifies no unexpected artifact.

---

### 13.4 Resource Shadowing

Bukan hanya class yang bisa shadowed. Resource juga bisa.

Contoh:

```java
ClassLoader.getResource("application.properties")
```

Jika beberapa JAR punya resource yang sama, hasil tergantung classloader order.

Resource sensitif:

1. `application.properties`
2. `META-INF/services/*`
3. `logback.xml`
4. `mapper/*.xml`
5. `schema/*.json`
6. `policy/*.yaml`
7. `templates/*`
8. `db/migration/*`

Review question:

```text
Can an earlier classpath entry override security-relevant resource?
```

---

## 14. Module Path and JPMS Trust Considerations

### 14.1 Module System Bukan Security Boundary Penuh

Java Platform Module System membantu encapsulation dan dependency clarity, tetapi bukan sandbox penuh.

JPMS membantu:

1. Explicit module dependency.
2. Strong encapsulation.
3. Reduced accidental access.
4. Service usage declaration.
5. Better packaging boundaries.

JPMS tidak otomatis:

1. Memverifikasi signer.
2. Mencegah malicious module jika module path compromised.
3. Menjamin artifact provenance.
4. Membatasi network/file access.
5. Menggantikan runtime policy.

---

### 14.2 Automatic Modules

JAR non-modular di module path bisa menjadi automatic module.

Risiko:

1. Module name derived dari artifact name.
2. Exports lebih luas.
3. Requires behavior lebih permissive.
4. Encapsulation tidak seketat explicit module.
5. Migration state bisa membingungkan.

Untuk security-sensitive system:

```text
Prefer explicit modules for platform/plugin APIs.
Avoid relying on automatic modules for strong trust boundary.
```

---

### 14.3 Split Packages

Split package:

```text
module A contains com.example.security
module B contains com.example.security
```

Risiko:

1. Ambiguous ownership.
2. Patch/injection confusion.
3. Harder review.
4. Package-level assumptions rusak.

Rule:

```text
Security-sensitive packages must have single owner artifact/module.
```

---

### 14.4 `--patch-module` and Runtime Overrides

JVM options seperti `--patch-module` bisa memasukkan class/resource ke module.

Ini berguna untuk testing/debugging, tetapi berisiko di production.

Policy:

```text
Reject production startup if:
- --patch-module is present unexpectedly
- --add-opens is broad
- --add-exports is broad
- javaagent unknown
- bootclasspath manipulation present
```

---

## 15. Java Agents and Instrumentation Risk

### 15.1 Apa Itu Java Agent

Java agent dapat dijalankan saat startup:

```bash
java -javaagent:agent.jar -jar app.jar
```

Atau attach runtime melalui Attach API dalam kondisi tertentu.

Agent bisa melakukan bytecode instrumentation:

1. Modify class behavior.
2. Intercept method calls.
3. Capture arguments.
4. Add monitoring.
5. Patch classes.
6. Hook frameworks.
7. Inspect runtime.

Legitimate use:

1. APM.
2. Observability.
3. Profiling.
4. Security monitoring.
5. Coverage tools.
6. Debugging.
7. Hot patch tools.

Security risk:

1. Agent bisa mencuri secret dari memory.
2. Agent bisa bypass authorization check.
3. Agent bisa modify crypto verification logic.
4. Agent bisa log PII.
5. Agent bisa disable security control.
6. Agent bisa exfiltrate data.

---

### 15.2 Agent Is Code Execution

Treat Java agent as highly privileged code.

Jika attacker bisa menambahkan:

```bash
-javaagent:/tmp/evil-agent.jar
```

maka signed application JAR tidak banyak membantu.

Control:

1. Immutable container command.
2. No writable agent directory.
3. Allowlist known agents.
4. Verify agent artifact digest/signature.
5. Disable attach where possible.
6. Restrict OS permissions.
7. Monitor JVM args.
8. Alert on unknown agent.
9. Pin image digest.
10. Review APM agent update process.

---

### 15.3 Attach API Risk

Runtime attach memungkinkan tool eksternal attach ke JVM untuk diagnosis/instrumentation.

Operationally useful:

1. `jcmd`
2. `jstack`
3. `jmap`
4. profiler
5. monitoring

Risk:

1. Unauthorized process on same host/container can inspect JVM.
2. Heap dump can expose secrets.
3. Agent injection possible in some configurations.
4. Diagnostics can leak PII.

Controls:

1. Run one application per container/VM user.
2. Disable attach mechanism where feasible.
3. Restrict `/tmp` and process namespace.
4. Avoid sharing PID namespace.
5. Harden container security context.
6. Protect diagnostic endpoints/tools.
7. Do not ship debug tooling in minimal runtime image unless needed.

---

## 16. Runtime Artifact Verification Strategy

### 16.1 Startup Self-Verification

A Java app can verify:

1. Own JAR digest.
2. Own signature.
3. Expected version.
4. Build metadata.
5. Runtime classpath.
6. Loaded provider list.
7. JVM args.
8. Security properties.
9. Known Java agents.

Startup check example concept:

```text
On startup:
  - log application artifact path
  - log artifact SHA-256
  - log build commit
  - verify expected signer
  - detect unexpected javaagent
  - detect unexpected classpath entries
  - detect broad --add-opens
  - expose integrity status in admin health endpoint
```

Careful: do not leak sensitive paths/secrets.

---

### 16.2 Classpath Digest Manifest

You can maintain a runtime classpath manifest:

```json
{
  "artifacts": [
    {
      "name": "app.jar",
      "sha256": "..."
    },
    {
      "name": "lib/jackson-databind-2.x.jar",
      "sha256": "..."
    }
  ]
}
```

At startup:

```text
Actual classpath digest set
  ↓ compare
Expected manifest
  ↓
Fail closed or warn depending environment
```

Production policy:

```text
Fail closed for internet-facing/regulatory/high integrity services.
Warn only for dev/local.
```

---

### 16.3 Provider Verification

Security providers are especially sensitive.

Example:

```java
Security.getProviders()
```

Risk:

1. Malicious provider registered.
2. Provider order changed.
3. Weak algorithm implementation selected.
4. Custom provider unexpectedly shadows default.
5. FIPS provider missing.

Startup check:

```text
Expected providers:
  - SUN
  - SunRsaSign
  - SunEC
  - SunJSSE
  - SunJCE
  - ...
Optional:
  - BC
  - BC-FIPS
```

Policy:

1. Allowlist providers.
2. Verify provider JAR if external.
3. Verify provider order.
4. Log provider list.
5. Test crypto algorithm mapping.
6. Fail if FIPS-required provider missing.

---

## 17. Artifact Verification in CI/CD

### 17.1 Release Gate

CI release gate should verify:

1. Artifact is produced by approved workflow.
2. Dependencies resolved from approved repositories.
3. Lockfile/checksum policy passed.
4. SBOM generated.
5. SCA scan passed within policy.
6. Tests passed.
7. JAR signature valid.
8. Signer identity correct.
9. Timestamp present.
10. Artifact digest recorded.
11. Container image signed if packaged in image.
12. Deployment manifest pins digest.

---

### 17.2 Verification Before Deploy

Before deploy:

```bash
jarsigner -verify -verbose -certs app.jar
sha256sum -c checksums.txt
```

But do not stop there.

Also verify:

1. Docker image digest.
2. Kubernetes manifest image digest pinned.
3. ConfigMap/Secret source approved.
4. Runtime JVM args approved.
5. Java agents approved.
6. SBOM matches artifact.
7. Attestation verified.
8. Deployment approval linked to artifact digest.

---

### 17.3 Immutable Deployment

Avoid deployment model:

```text
copy app.jar into shared server folder
restart service
```

Better:

```text
build immutable image
  ↓
image digest signed
  ↓
deployment references digest
  ↓
read-only filesystem
  ↓
no manual jar replacement
```

JAR signing masih berguna, tetapi runtime trust lebih kuat jika digabung dengan immutable deployment.

---

## 18. JAR Signing in Maven/Gradle Ecosystem

### 18.1 Maven Central and Signing

Banyak ecosystem Java memakai PGP signing untuk publication.

Artifact biasanya:

```text
library-1.0.0.jar
library-1.0.0.jar.asc
library-1.0.0.pom
library-1.0.0.pom.asc
```

Ini berbeda dari signed JAR internal.

Important distinction:

```text
PGP signature over artifact file
≠
JAR entry signature inside artifact
```

Keduanya bisa dipakai bersama.

---

### 18.2 Gradle/Maven Verification Metadata

Modern build sebaiknya memakai:

1. Dependency locking.
2. Checksum verification.
3. Repository restrictions.
4. Plugin version pinning.
5. Build scan/reproducibility checks.
6. SBOM generation.
7. Artifact signing.

Maven/Gradle build plugins sendiri juga supply chain risk.

Review:

```text
Build plugin is executable code.
```

Plugin build bisa:

1. Run arbitrary code.
2. Download files.
3. Modify artifact.
4. Read environment variables.
5. Exfiltrate secrets in CI.

Policy:

1. Pin plugin versions.
2. Restrict plugin repositories.
3. Verify plugin origin.
4. Avoid dynamic versions.
5. Avoid executing untrusted build scripts.

---

## 19. JAR Integrity and Containers

### 19.1 When App Runs in Container

Dalam container, app biasanya:

```text
/app/app.jar
/app/lib/*.jar
```

JAR signing tetap bisa berguna, tetapi image layer juga perlu trust.

Container controls:

1. Image signing.
2. Image digest pinning.
3. SBOM image.
4. Admission controller.
5. Read-only root filesystem.
6. Non-root user.
7. No writable app dir.
8. Minimal base image.
9. No shell/debug tools if unnecessary.
10. Runtime policy.

Jika attacker bisa modify `/app/app.jar` di writable filesystem, signed JAR self-check bisa detect. Tetapi lebih baik filesystem tidak writable.

---

### 19.2 Kubernetes Specific Risks

Risiko deployment:

1. Init container copies JAR.
2. ConfigMap mounts override files.
3. EmptyDir writable path in classpath.
4. Sidecar modifies shared volume.
5. Debug ephemeral container attaches.
6. Secret mounted as file readable by app/plugin.
7. Image tag mutable.
8. `latest` tag.
9. Java agent injected via env var.
10. Downward API leaks metadata.

Policy:

```text
Production:
- image by digest, not mutable tag
- app directory read-only
- no wildcard classpath over writable dir
- allowed env vars only
- no unknown JAVA_TOOL_OPTIONS
- no unknown JDK_JAVA_OPTIONS
- restrict ephemeral containers
```

`JAVA_TOOL_OPTIONS` and `JDK_JAVA_OPTIONS` deserve special attention because they can inject JVM args.

---

## 20. Environment Variable Injection of JVM Options

### 20.1 `JAVA_TOOL_OPTIONS`

`JAVA_TOOL_OPTIONS` can prepend options to Java command execution in many environments.

Risk:

```bash
export JAVA_TOOL_OPTIONS="-javaagent:/tmp/evil.jar"
java -jar app.jar
```

### 20.2 `JDK_JAVA_OPTIONS`

`JDK_JAVA_OPTIONS` can also influence JVM launch.

Controls:

1. Clear/allowlist env vars at entrypoint.
2. Log sanitized JVM options at startup.
3. Reject unknown `-javaagent`.
4. Reject broad `--add-opens`.
5. Reject unexpected `-Xbootclasspath`.
6. Use container entrypoint that validates env.
7. Admission policy for env vars.

Example entrypoint concept:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ "${JAVA_TOOL_OPTIONS:-}" == *"-javaagent:"* ]]; then
  echo "Unexpected javaagent in JAVA_TOOL_OPTIONS" >&2
  exit 1
fi

exec java -jar /app/app.jar
```

For real production, use explicit allowlist rather than substring-only checks.

---

## 21. Native Libraries and JNI

### 21.1 Native Code Bypasses Many Java Assumptions

JAR can load native libraries:

```java
System.loadLibrary("nativecrypto");
System.load("/path/to/libnative.so");
```

Risks:

1. Native memory corruption.
2. OS-level access.
3. Bypass Java type safety.
4. Secret extraction.
5. Supply chain risk.
6. Platform-specific behavior.
7. LD_LIBRARY_PATH injection.
8. DLL search order hijack.

Controls:

1. Avoid JNI unless necessary.
2. Verify native library digest/signature.
3. Load from read-only trusted path.
4. Avoid writable library directories.
5. Pin platform artifact.
6. Scan native dependencies.
7. Use OS sandbox/container controls.
8. Review `java.library.path`.

---

### 21.2 Native Library as Resource in JAR

Some libraries ship native libs inside JAR and extract to temp directory at runtime.

Risk:

1. Temp directory race.
2. Writable extraction path.
3. Replacement attack.
4. Unsigned resource extraction.
5. Platform-specific unsigned binary.

Controls:

1. Verify resource digest before extraction.
2. Extract to private directory with strict permissions.
3. Use random unique path.
4. Avoid shared temp paths.
5. Delete carefully.
6. Verify after extraction.
7. Prefer library with robust extraction security.

---

## 22. Multi-Release JAR Security

### 22.1 Apa Itu Multi-Release JAR

Multi-release JAR dapat berisi class berbeda untuk versi Java berbeda:

```text
com/example/Foo.class
META-INF/versions/17/com/example/Foo.class
META-INF/versions/21/com/example/Foo.class
```

Runtime Java tertentu memilih versi paling sesuai.

Security implication:

1. Scanner mungkin hanya melihat base class.
2. Review bisa melewatkan version-specific class.
3. Signature harus melindungi semua relevant entries.
4. Behavior berbeda antar Java version.
5. Vulnerability bisa hanya muncul pada versi tertentu.

Policy:

```text
Security review must include META-INF/versions/*.
```

Test matrix:

```text
Run security tests on every supported Java runtime version.
```

---

## 23. Signed JAR and Algorithm Constraints

### 23.1 Weak Algorithms

JAR signature bisa memakai algorithm lama:

1. SHA-1 digest.
2. MD5 digest.
3. DSA kecil.
4. RSA key size kecil.
5. Expired certificate.
6. Disabled algorithm per JDK policy.

Modern JDK bisa memperingatkan atau menolak signature lemah berdasarkan security properties seperti:

```text
jdk.jar.disabledAlgorithms
```

Policy:

1. Jangan override disabled algorithms untuk “biar jalan” tanpa risk acceptance.
2. Treat weak signature warning as release blocker.
3. Rotate signing key before forced deadline.
4. Test artifact verification on target JDK version.
5. Track JDK release changes.

---

### 23.2 Compatibility Trap

Artifact lama bisa tiba-tiba gagal setelah JDK upgrade karena:

1. Algorithm disabled.
2. Root CA removed.
3. Certificate expired.
4. Timestamp missing.
5. Signature format legacy.
6. Provider behavior changed.

Mitigation:

1. Pre-upgrade verification scan semua artifact.
2. Inventory signed artifact.
3. Check signer expiry.
4. Re-sign where appropriate.
5. Avoid depending on obsolete algorithms.
6. Keep release signing policy updated.

---

## 24. Artifact Identity and Coordinate Binding

### 24.1 Signature Harus Terikat ke Artifact Meaning

Signature atas bytes saja tidak selalu cukup.

Bayangkan signer internal menandatangani:

```text
com.company:payment-core:1.2.3
```

Tapi artifact itu dipublish dengan coordinate:

```text
com.company:authz-core:1.2.3
```

Jika policy hanya “signed by company key”, bisa terjadi misuse.

Lebih aman jika metadata release mengikat:

1. Group ID.
2. Artifact ID.
3. Version.
4. Git commit.
5. Build workflow.
6. Build timestamp.
7. SBOM digest.
8. Artifact digest.
9. Signer identity.
10. Environment approval.

Contoh release metadata:

```json
{
  "groupId": "com.company",
  "artifactId": "payment-core",
  "version": "1.2.3",
  "gitCommit": "abc123",
  "artifactSha256": "....",
  "sbomSha256": "....",
  "builtBy": "github-actions/release.yml",
  "signedBy": "release-signing-key-2026-q1"
}
```

Metadata ini juga perlu signed/attested.

---

### 24.2 Preventing Coordinate Confusion

Policy:

```text
Signer A may sign only artifacts under group com.company.platform.
Signer B may sign only artifacts under group com.company.plugins.partnerX.
Signer C may sign only emergency hotfix artifacts with approval ticket.
```

Ini penting untuk plugin marketplace/internal extension.

---

## 25. Runtime Audit of Loaded Classes

### 25.1 Kenapa Perlu Audit

Ketika incident terjadi, kamu ingin tahu:

1. Artifact apa yang sebenarnya running?
2. Class mana dari JAR mana?
3. Versi dependency apa?
4. Apakah ada unknown JAR?
5. Apakah Java agent aktif?
6. Apakah provider crypto berubah?
7. Apakah classpath berbeda dari approved manifest?

---

### 25.2 What to Log at Startup

Log aman:

```text
app.name
app.version
git.commit
build.time
artifact.sha256
container.image.digest
java.version
jvm.vendor
known.javaagents
classpath.entry.count
dependency.manifest.digest
security.providers
```

Jangan log:

1. Secret.
2. Full env var dump.
3. Credential path with tokens.
4. Sensitive filesystem layout if unnecessary.
5. Private key material.
6. Full certificate private config.

---

### 25.3 Class Origin Debugging

Saat debugging class conflict:

```java
Class<?> clazz = com.example.AuthService.class;
System.out.println(clazz.getProtectionDomain().getCodeSource().getLocation());
```

Gunakan hanya untuk diagnostic terkontrol.

Di production, jangan expose endpoint bebas yang mengembalikan arbitrary class location karena bisa membocorkan internal layout.

---

## 26. Secure Design Pattern: Trusted Plugin Loader

### 26.1 Problem

Aplikasi regulatory case management perlu memuat rule plugin internal untuk tiap module. Plugin bisa diupdate tanpa rebuild core platform.

Risiko:

1. Plugin malicious.
2. Plugin salah versi.
3. Plugin signer salah.
4. Plugin resource unsigned.
5. Plugin override class platform.
6. Plugin membaca secret.
7. Plugin menulis state langsung.
8. Plugin decision tidak audit-able.

---

### 26.2 Pattern

```text
Trusted Plugin Registry
  ↓
Artifact digest + signer policy
  ↓
Download/fetch plugin from controlled repository
  ↓
Verify digest/signature
  ↓
Reject forbidden packages/resources
  ↓
Create constrained loader/process
  ↓
Expose narrow SPI
  ↓
Validate output
  ↓
Record decision evidence
```

---

### 26.3 Example Registry Table

```sql
CREATE TABLE trusted_plugin_release (
    plugin_id             VARCHAR(120) NOT NULL,
    plugin_version        VARCHAR(80)  NOT NULL,
    artifact_uri          VARCHAR(1000) NOT NULL,
    artifact_sha256       CHAR(64) NOT NULL,
    signer_fingerprint    CHAR(64) NOT NULL,
    status                VARCHAR(30) NOT NULL,
    approved_by           VARCHAR(120) NOT NULL,
    approved_at           TIMESTAMP NOT NULL,
    effective_from        TIMESTAMP NOT NULL,
    effective_until       TIMESTAMP NULL,
    risk_note             VARCHAR(2000),
    PRIMARY KEY (plugin_id, plugin_version)
);
```

---

### 26.4 Plugin Load Decision Record

```json
{
  "eventType": "PLUGIN_LOAD_DECISION",
  "pluginId": "case-risk-rule",
  "pluginVersion": "2026.06.1",
  "artifactSha256": "....",
  "expectedSigner": "....",
  "actualSigner": "....",
  "signatureValid": true,
  "policyDecision": "ALLOW",
  "loadedAt": "2026-06-16T10:00:00Z",
  "loadedByNode": "case-worker-7",
  "reason": "approved release and signer matched"
}
```

Kalau ditolak:

```json
{
  "eventType": "PLUGIN_LOAD_DECISION",
  "pluginId": "case-risk-rule",
  "pluginVersion": "2026.06.2",
  "artifactSha256": "....",
  "signatureValid": true,
  "policyDecision": "DENY",
  "reason": "signer not allowed for plugin namespace"
}
```

---

## 27. Secure Design Pattern: Startup Integrity Guard

### 27.1 Problem

Service Java berjalan di Kubernetes. Kamu ingin memastikan runtime tidak drift dari approved release.

---

### 27.2 Pattern

Startup guard melakukan:

1. Verify expected app artifact digest.
2. Verify app signed by release signer.
3. Verify dependency manifest.
4. Detect unexpected JAR in classpath.
5. Detect unknown Java agent.
6. Detect forbidden JVM options.
7. Verify expected Java version.
8. Verify expected security providers.
9. Verify expected crypto policy.
10. Publish integrity status.

---

### 27.3 Fail-Closed vs Fail-Open

| Environment | Behavior |
|---|---|
| local dev | warn |
| CI | fail |
| staging/UAT | fail unless override ticket |
| production | fail closed |
| disaster recovery | fail with break-glass policy |

Break-glass must be audited.

---

## 28. Secure Design Pattern: Artifact Release Bundle

### 28.1 Bundle Components

```text
release/
  app.jar
  app.jar.sha256
  app.jar.sig or embedded JAR signature
  sbom.cdx.json
  sbom.cdx.json.sig
  provenance.intoto.jsonl
  release-metadata.json
  release-metadata.sig
```

### 28.2 Release Metadata

```json
{
  "service": "case-management",
  "version": "4.18.0",
  "gitCommit": "abc123",
  "buildWorkflow": "release.yml",
  "artifact": {
    "file": "app.jar",
    "sha256": "..."
  },
  "sbom": {
    "file": "sbom.cdx.json",
    "sha256": "..."
  },
  "signing": {
    "keyId": "release-signing-2026-q2",
    "timestamp": "2026-06-16T09:32:00Z"
  },
  "approval": {
    "changeRequest": "CR-2026-183",
    "approvedBy": ["tech-lead", "security"]
  }
}
```

This turns signature into part of a larger evidence chain.

---

## 29. Misuse Pattern Catalog

### 29.1 “It Is Signed, Therefore Safe”

Wrong.

Signature means signed, not safe.

Correct:

```text
Signature valid
  + signer trusted for this artifact
  + build provenance trusted
  + dependency policy passed
  + runtime loading controlled
  + behavior tested
  = stronger trust
```

---

### 29.2 Verifying Only Once at Build Time

Wrong if artifact can be modified after build.

Correct:

1. Verify at build.
2. Verify at publish.
3. Verify before deploy.
4. Verify at runtime for high integrity.
5. Pin deployment digest.

---

### 29.3 Allowing Any Trusted CA

For code signing, “certificate chains to public CA” may be too broad.

Correct:

1. Allowlist specific signer.
2. Or allowlist internal CA.
3. Bind signer to artifact namespace.
4. Track revocation.
5. Plan rotation.

---

### 29.4 Ignoring Unsigned Entries

Wrong.

Unsigned resources can control behavior.

Correct:

```text
Fail if security-relevant payload entry unsigned.
```

For stricter systems:

```text
Fail if any non-META-INF payload entry unsigned.
```

---

### 29.5 Removing Signature Metadata During Shading Without Replacement

Wrong.

Correct:

1. Verify dependencies before shading.
2. Build final artifact.
3. Generate SBOM.
4. Sign final artifact.
5. Store provenance.

---

### 29.6 Loading Plugin by URL Without Verification

Wrong:

```java
URLClassLoader loader = new URLClassLoader(new URL[]{pluginUrl});
```

Correct:

```text
Fetch
  ↓
digest verify
  ↓
signature verify
  ↓
policy verify
  ↓
class/resource scan
  ↓
load with constrained strategy
```

---

### 29.7 Wildcard Classpath Over Writable Directory

Wrong:

```bash
java -cp "/opt/app/lib/*" com.example.Main
```

when `/opt/app/lib` is writable by app or deployment user.

Correct:

1. Read-only directory.
2. Explicit classpath.
3. Immutable image.
4. Startup classpath audit.

---

### 29.8 Unknown Java Agent in Production

Wrong:

```bash
JAVA_TOOL_OPTIONS="-javaagent:/tmp/debug.jar"
```

Correct:

1. Allowlist agents.
2. Verify agent artifact.
3. Alert unknown agent.
4. Restrict env var injection.

---

### 29.9 Treating JPMS as Sandbox

Wrong.

Correct:

```text
JPMS improves encapsulation, not full security isolation.
```

Use process/container isolation for untrusted code.

---

### 29.10 Trusting Self-Signed Release Certificates Without Policy

Self-signed can be acceptable only if internal trust is explicitly managed.

Correct:

1. Store trust anchor securely.
2. Rotate keys.
3. Audit signing.
4. Protect private key.
5. Document signer policy.
6. Pin fingerprint or internal CA.

---

## 30. Failure Modes

### 30.1 Release Signing Key Compromised

Impact:

1. Attacker can sign malicious artifact.
2. Verification passes.
3. Artifact may be deployed as trusted.
4. Historical trust becomes questionable.

Response:

1. Revoke/disable signing key.
2. Block signer fingerprint in deployment policy.
3. Identify artifacts signed after compromise window.
4. Rotate signing key.
5. Re-sign known-good artifacts.
6. Review CI secret exposure.
7. Publish incident metadata.
8. Update allowlists.
9. Audit deployment history.
10. Add HSM/KMS if not used.

---

### 30.2 Certificate Expired Without Timestamp

Impact:

1. Old artifact verification may fail.
2. Emergency release delayed.
3. Runtime plugin loading fails.
4. Audit evidence weakened.

Prevention:

1. Timestamp all signatures.
2. Monitor certificate expiry.
3. Rotate before expiry.
4. Test verification on future JDK.
5. Maintain signer inventory.

---

### 30.3 JDK Upgrade Disables Old Signature Algorithm

Impact:

1. Valid old JAR becomes rejected/warned.
2. Build/deploy breaks.
3. Legacy dependency cannot load.
4. Emergency workaround tempts disabling security property.

Prevention:

1. Pre-upgrade artifact scan.
2. Avoid weak algorithms.
3. Re-sign internal artifacts.
4. Replace legacy dependencies.
5. Keep security properties strict.

---

### 30.4 Plugin Signed but Malicious

Impact:

1. Signature verification passes.
2. Plugin executes malicious behavior.
3. Sensitive data exfiltration possible.
4. Audit may show “approved signer”.

Prevention:

1. Signer is necessary, not sufficient.
2. Review plugin source/provenance.
3. Run plugin in isolated process if not fully trusted.
4. Narrow SPI.
5. Runtime monitoring.
6. Revocation.

---

### 30.5 Classpath Injection

Impact:

1. Malicious class loaded before legitimate.
2. Authorization/crypto logic replaced.
3. Behavior differs from scanned artifact.
4. Incident hard to reproduce.

Prevention:

1. Immutable image.
2. Explicit classpath.
3. Read-only lib directory.
4. Startup classpath audit.
5. Duplicate class detection.
6. Container admission policy.

---

### 30.6 Resource Override

Impact:

1. Signed class unchanged.
2. Behavior changes via unsigned config/template/provider file.
3. Security scanner misses.
4. Signature confidence misleading.

Prevention:

1. Sign all behavior-affecting resources.
2. Reject unsigned payload entries.
3. Validate resource origin.
4. Avoid classpath resource ambiguity.

---

### 30.7 Unknown Java Agent

Impact:

1. Runtime code modified.
2. Secrets captured.
3. Security controls bypassed.
4. Audit logs manipulated.

Prevention:

1. Agent allowlist.
2. Env var control.
3. Disable attach where feasible.
4. Runtime JVM args monitoring.
5. Read-only filesystem.
6. Minimal privileges.

---

## 31. Production Checklist

### 31.1 Signed JAR Checklist

- [ ] JAR is signed with approved signer.
- [ ] Signature verifies successfully.
- [ ] Certificate chain is valid.
- [ ] Signer is allowlisted for artifact namespace.
- [ ] Signature uses approved algorithms.
- [ ] Timestamp is present for release artifact.
- [ ] No unsigned payload entries.
- [ ] No duplicate suspicious entries.
- [ ] Multi-release entries reviewed.
- [ ] Manifest metadata matches release metadata.
- [ ] Artifact digest recorded.
- [ ] SBOM generated and linked.
- [ ] Provenance attached.
- [ ] Signing key stored in controlled system.
- [ ] Key rotation plan exists.
- [ ] Signer compromise runbook exists.

---

### 31.2 Classloading Checklist

- [ ] Classpath explicit or fully controlled.
- [ ] No wildcard over writable directory.
- [ ] App/lib directory read-only.
- [ ] No unexpected JARs.
- [ ] No duplicate classes in security-sensitive packages.
- [ ] No unexpected `META-INF/services` providers.
- [ ] Plugin classloader policy documented.
- [ ] Forbidden package prefixes enforced.
- [ ] Resource shadowing reviewed.
- [ ] Class origin audit available.

---

### 31.3 Java Agent Checklist

- [ ] Known agents allowlisted.
- [ ] Agent artifact digest/signature verified.
- [ ] `JAVA_TOOL_OPTIONS` controlled.
- [ ] `JDK_JAVA_OPTIONS` controlled.
- [ ] Unknown `-javaagent` fails startup.
- [ ] Attach mechanism restricted/disabled where feasible.
- [ ] Diagnostic tools protected.
- [ ] Heap/thread dump access controlled.
- [ ] APM agent update process reviewed.

---

### 31.4 Plugin Checklist

- [ ] Plugin threat model exists.
- [ ] Plugin registry stores digest/signer/status.
- [ ] Plugin artifact verified before loading.
- [ ] Plugin signer bound to plugin namespace.
- [ ] Plugin resources signed or verified.
- [ ] Plugin cannot define forbidden packages.
- [ ] Plugin SPI is narrow.
- [ ] Plugin output validated.
- [ ] Plugin execution timeout/resource limit exists.
- [ ] Plugin load decision audited.
- [ ] Plugin revocation supported.
- [ ] Plugin incident runbook exists.

---

### 31.5 Container/Deployment Checklist

- [ ] Image pinned by digest.
- [ ] Image signed/verified where platform supports.
- [ ] Root filesystem read-only where possible.
- [ ] App runs non-root.
- [ ] No mutable `latest` tag.
- [ ] No writable classpath directory.
- [ ] Env vars allowlisted.
- [ ] JVM args allowlisted.
- [ ] Startup integrity guard enabled for high integrity service.
- [ ] Deployment approval references artifact digest.

---

## 32. Review Questions

Use these during architecture/code review.

### Artifact Integrity

1. What exactly is signed?
2. What is not signed?
3. Who can sign?
4. How is signer identity verified?
5. Is signer trusted for this artifact namespace?
6. Are weak algorithms rejected?
7. Are signatures timestamped?
8. Are unsigned entries allowed?
9. Are resources included in integrity check?
10. Can artifact be modified after verification?

### Build/Release

1. Where is signing performed?
2. Who/what can access private signing key?
3. Is key in CI secret, KMS, or HSM?
4. Is artifact digest recorded?
5. Is SBOM tied to artifact digest?
6. Is provenance generated?
7. Is deployment pinned to digest?
8. Can someone manually replace artifact on server?
9. Are emergency releases signed the same way?
10. Is signer compromise runbook tested?

### Runtime

1. Which classpath entries are loaded?
2. Are directories writable?
3. Are wildcard paths used?
4. Are Java agents present?
5. Can env vars inject JVM options?
6. Is attach allowed?
7. Are providers expected?
8. Are native libraries loaded?
9. Is plugin loading dynamic?
10. Is startup integrity status observable?

### Plugin

1. Is plugin fully trusted?
2. What data/capability does plugin receive?
3. Can plugin access secrets?
4. Can plugin modify state directly?
5. Can plugin perform network calls?
6. Can plugin spawn threads?
7. Can plugin load native code?
8. Can plugin bring dependencies?
9. Can plugin be revoked?
10. Are plugin decisions audit-able?

---

## 33. Case Study: Regulatory Case Management Plugin

### 33.1 Scenario

Sebuah platform regulatory case management memiliki modul:

1. Case intake.
2. Screening.
3. Investigation.
4. Enforcement recommendation.
5. Appeal.
6. Audit trail.

Tim ingin menambahkan plugin rule engine untuk agency-specific screening rules.

Requirement:

1. Plugin bisa diupdate tanpa rebuild core service.
2. Plugin harus signed.
3. Plugin harus punya audit trail.
4. Plugin tidak boleh mengakses DB langsung.
5. Plugin tidak boleh membaca secret.
6. Plugin decision harus reproducible.
7. Plugin bisa direvoke.
8. Plugin hasilnya harus explainable.

---

### 33.2 Bad Design

```text
Admin uploads JAR
  ↓
Application saves to /plugins
  ↓
URLClassLoader loads it
  ↓
Plugin receives Spring ApplicationContext
  ↓
Plugin calls repositories/services
  ↓
Decision saved directly
```

Problems:

1. Upload JAR becomes code execution.
2. No signature verification.
3. No signer policy.
4. No dependency control.
5. Plugin has full application capability.
6. Plugin can bypass authorization.
7. Plugin can read secrets.
8. Plugin decision not deterministic.
9. No revocation.
10. No audit evidence.

---

### 33.3 Better Design

```text
Plugin release through CI
  ↓
Artifact signed by agency/plugin signer
  ↓
SBOM + provenance generated
  ↓
Plugin registered in trusted_plugin_release
  ↓
Runtime fetches approved digest only
  ↓
Signature + signer policy verified
  ↓
Resource/class scan
  ↓
Loaded in isolated worker process or constrained classloader
  ↓
Narrow request DTO sent
  ↓
Plugin returns decision result
  ↓
Output validated
  ↓
Decision and plugin metadata audited
```

---

### 33.4 Security Invariants

```text
Invariant 1:
Only approved plugin artifact digest may be loaded.

Invariant 2:
Plugin signer must be allowlisted for plugin namespace.

Invariant 3:
Plugin must not receive database/session/security-context capability.

Invariant 4:
Plugin decision must include plugin id, version, artifact digest, input digest, and explanation.

Invariant 5:
Revoked plugin must not be loaded for new decisions.

Invariant 6:
Historical decisions must remain traceable to exact plugin artifact.
```

---

### 33.5 Audit Record

```json
{
  "eventType": "SCREENING_PLUGIN_DECISION",
  "caseId": "CASE-2026-00091",
  "pluginId": "agency-risk-screening",
  "pluginVersion": "2026.06.1",
  "pluginArtifactSha256": "....",
  "pluginSignerFingerprint": "....",
  "inputCanonicalSha256": "....",
  "decision": "ESCALATE",
  "reasons": [
    "Applicant has unresolved compliance flag",
    "Transaction pattern matches high-risk rule R-17"
  ],
  "decisionAt": "2026-06-16T12:00:00Z"
}
```

---

### 33.6 Incident Scenario

A plugin signer is compromised.

Response:

1. Mark signer fingerprint as revoked.
2. Mark affected plugin releases as quarantined.
3. Stop loading affected plugin.
4. Identify decisions made by affected plugin versions.
5. Re-run decisions with known-good plugin if required.
6. Notify governance/security.
7. Rotate plugin signing key.
8. Update plugin registry.
9. Preserve evidence chain.
10. Conduct root cause analysis.

---

## 34. Practical Commands Appendix

### 34.1 Inspect JAR

```bash
jar tf app.jar
```

### 34.2 Extract Manifest

```bash
jar xf app.jar META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF
```

### 34.3 Verify Signature

```bash
jarsigner -verify -verbose -certs app.jar
```

### 34.4 Compute Digest

```bash
sha256sum app.jar
```

### 34.5 Show Certificate From Keystore

```bash
keytool -list -v \
  -keystore release-signing.p12 \
  -storetype PKCS12 \
  -alias release-signing
```

### 34.6 Sign JAR

```bash
jarsigner \
  -keystore release-signing.p12 \
  -storetype PKCS12 \
  -signedjar app-signed.jar \
  app.jar \
  release-signing
```

### 34.7 Sign with Timestamp

```bash
jarsigner \
  -keystore release-signing.p12 \
  -storetype PKCS12 \
  -tsa https://timestamp.example.com \
  -signedjar app-signed.jar \
  app.jar \
  release-signing
```

### 34.8 Detect Duplicate Entries

```bash
jar tf app.jar | sort | uniq -d
```

### 34.9 Print Runtime Classpath

```bash
java -XshowSettings:properties -version 2>&1 | grep "java.class.path"
```

### 34.10 Print JVM Input Arguments

```java
import java.lang.management.ManagementFactory;

public final class JvmArgsPrinter {
    public static void main(String[] args) {
        ManagementFactory.getRuntimeMXBean()
                .getInputArguments()
                .forEach(System.out::println);
    }
}
```

---

## 35. Decision Record Template

Gunakan template ini untuk sistem yang membutuhkan artifact/runtime trust.

```markdown
# ADR: Artifact and Runtime Trust Policy

## Context

The service loads Java artifacts at runtime and/or deploys signed Java application artifacts. We need to ensure artifact integrity, signer authenticity, runtime classpath control, and incident traceability.

## Decision

We will require:
- signed release artifacts
- approved signer allowlist
- timestamped signatures
- artifact digest pinning
- SBOM generation
- provenance attachment
- classpath/runtime startup verification
- Java agent allowlist
- plugin registry and revocation policy for dynamic plugins

## Accepted Signers

| Namespace | Signer | Rotation Policy |
|---|---|---|
| com.company.platform | release-signing-2026 | yearly |
| com.company.plugins.agency-a | agency-a-plugin-signing | semiannual |

## Verification Gates

| Stage | Verification |
|---|---|
| CI | dependency, SBOM, signing, tests |
| Publish | signature, digest, metadata |
| Deploy | digest pin, signer, image signature |
| Runtime | classpath, JVM args, agent, provider |

## Failure Policy

Production service fails closed if:
- application artifact signature invalid
- unexpected Java agent present
- classpath contains unknown artifact
- plugin signature invalid
- plugin signer not allowlisted

## Break Glass

Break-glass override requires:
- incident ticket
- security approval
- time-limited override
- audit record
- post-incident review

## Consequences

Positive:
- stronger artifact integrity
- better incident traceability
- reduced classpath/plugin attack risk

Negative:
- operational complexity
- certificate/key rotation overhead
- need for developer tooling and CI integration
```

---

## 36. Summary

Signed JAR adalah mekanisme penting, tetapi harus ditempatkan secara proporsional.

Core mental model:

```text
Signed JAR proves artifact entry integrity and signer authenticity.
It does not prove source safety, build trust, runtime isolation, or behavioral correctness.
```

Untuk sistem Java modern, terutama enterprise/regulatory, artifact trust harus berupa chain:

```text
Source review
  ↓
Controlled build
  ↓
Dependency verification
  ↓
SBOM
  ↓
Provenance
  ↓
Artifact signing
  ↓
Digest pinning
  ↓
Immutable deployment
  ↓
Runtime classpath/JVM guard
  ↓
Audit and incident response
```

Security-critical runtime loading seperti plugin harus lebih ketat:

```text
Verify artifact
  ↓
Verify signer policy
  ↓
Verify resource/class safety
  ↓
Load with minimal capability
  ↓
Audit every decision
  ↓
Support revocation
```

Part ini adalah jembatan antara supply chain security dan runtime hardening. Di part berikutnya, kita lanjut ke secure build, CI/CD, release integrity, dan bagaimana memastikan artifact yang direview adalah artifact yang benar-benar dirilis.

---

## 37. Referensi

Referensi utama:

1. Oracle, `jarsigner` command documentation.
2. Oracle, JAR File Specification.
3. Oracle, Verifying Signed JAR Files tutorial.
4. Oracle, Secure Coding Guidelines for Java SE.
5. Oracle, Java Security Standard Algorithm Names.
6. Oracle, Java Security Properties and disabled algorithms documentation.
7. OWASP Secure Coding and Dependency/Supply Chain guidance.
8. SLSA framework for provenance and build integrity.
9. CycloneDX SBOM specification.
10. Java Platform Module System documentation.
11. Java Instrumentation API documentation.
12. Java `JarFile`, `JarEntry`, `CodeSigner`, `CodeSource`, and `ProtectionDomain` APIs.

---

## 38. Status Seri

Seri belum selesai.

Progress:

```text
Part 0  - Security Mental Model for Senior Java Engineers
Part 1  - Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
Part 2  - Threat Modeling for Java Systems
Part 3  - Cryptography Mental Model
Part 4  - Randomness, Entropy, Nonce, Salt, IV, Token
Part 5  - Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
Part 6  - Password Storage, Password Verification, and Secret-Derived Keys
Part 7  - Symmetric Encryption in Java
Part 8  - Message Authentication Code
Part 9  - Digital Signature
Part 10 - Asymmetric Encryption and Key Agreement
Part 11 - Key Management
Part 12 - Java KeyStore, TrustStore, Certificates, and Private Key Custody
Part 13 - X.509, PKI, Certificate Path Validation, Revocation
Part 14 - TLS/JSSE Deep Dive
Part 15 - TLS Hardening, Disabled Algorithms, and Runtime Security Properties
Part 16 - Secure Serialization, Deserialization, and Object Integrity
Part 17 - Secure File, Archive, and Data Transfer Integrity
Part 18 - XML Security, XXE, XML Signature, XML Encryption
Part 19 - JSON, JWT, JWS, JWE, JOSE, and Token Integrity
Part 20 - OAuth2/OIDC Security for Java Systems
Part 21 - Authorization Integrity
Part 22 - Input Validation, Canonicalization, Injection Resistance
Part 23 - Secure Coding in Java
Part 24 - Secrets Management in Java Applications
Part 25 - Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation
Part 26 - Data Integrity in Distributed Java Systems
Part 27 - Supply Chain Security for Java
Part 28 - Signed JARs, JAR Integrity, Classloading, and Runtime Trust
```

Berikutnya:

```text
Part 29 - Secure Build, CI/CD, and Release Integrity for Java
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-027.md">⬅️ Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-029.md">Part 29 — Secure Build, CI/CD, and Release Integrity for Java ➡️</a>
</div>
