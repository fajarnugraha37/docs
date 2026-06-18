# learn-java-security-cryptography-integrity-part-031

# Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `031`  
> Status seri: belum selesai  
> Part sebelumnya: `Part 30 — Runtime Hardening: JVM, Container, OS, Network`  
> Part berikutnya: `Part 32 — Incident Response for Java Security Failures`

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas hardening runtime: JVM, container, OS, network, metadata service, JMX, diagnostic artifact, dan batas-batas operasional. Sekarang kita masuk ke lapisan yang sangat penting tetapi sering diperlakukan terlalu sempit: **security testing**.

Banyak tim mengatakan “security testing” tetapi maksudnya hanya:

- menjalankan SAST;
- menjalankan dependency scanner;
- melakukan pentest setahun sekali;
- menjalankan DAST di environment staging;
- atau menunggu temuan vulnerability dari external audit.

Itu belum cukup.

Security testing yang matang harus menjawab:

> Apakah security invariant sistem kita tetap benar ketika input hostile, dependency berubah, konfigurasi berubah, clock bergeser, credential bocor, token dimanipulasi, request diulang, payload rusak, authorization boundary diserang, dan production path berbeda dari test path?

Security testing bukan hanya mencari bug. Security testing adalah cara memastikan **claim keamanan** yang kita buat benar-benar diuji.

Contoh claim:

- “User tidak bisa membaca case milik tenant lain.”
- “File upload tidak bisa menulis file di luar staging directory.”
- “JWT dari issuer tidak dikenal ditolak.”
- “Payload yang signature-nya valid tetapi canonical object-nya berubah tidak diproses.”
- “Webhook lama tidak bisa direplay.”
- “Password verification tidak bocor lewat timing yang mudah dieksploitasi.”
- “Audit trail tidak bisa dimodifikasi tanpa terdeteksi.”
- “Dependency vulnerable tidak bisa masuk release tanpa approval.”
- “Secret tidak muncul di log, test report, heap dump, atau artifact.”

Jika claim seperti ini tidak punya test, maka security posture-nya bergantung pada asumsi, bukan bukti.

---

## 1. Mental Model Utama

### 1.1 Security Testing Menguji Invariant, Bukan Hanya Function

Unit test biasa sering berbentuk:

> Given valid input, when function dipanggil, then output sesuai harapan.

Security test harus lebih agresif:

> Given hostile input, invalid actor, broken token, replayed command, manipulated object id, malformed file, expired certificate, weak algorithm, atau dependency berisiko, sistem harus gagal dengan cara yang aman.

Dengan kata lain:

```text
Functional testing:
  membuktikan sistem bisa melakukan hal yang benar.

Security testing:
  membuktikan sistem menolak hal yang salah,
  membatasi blast radius saat terjadi kesalahan,
  dan tidak membocorkan informasi ketika gagal.
```

Security test sering lebih dekat ke **negative testing** daripada happy-path testing.

---

### 1.2 Security Testing Harus Multi-Layer

Tidak ada satu jenis test yang cukup.

```text
Code-level tests
  unit test
  property-based test
  mutation test
  crypto misuse test
  authorization matrix test

Component-level tests
  parser fuzzing
  file upload test
  JWT validation test
  deserialization filter test
  data access boundary test

Application-level tests
  integration test
  API negative test
  DAST
  auth flow test
  session test
  replay test

Pipeline-level tests
  SAST
  SCA
  secret scanning
  IaC scanning
  container scanning
  SBOM validation
  provenance validation

Runtime-level tests
  security observability
  detection rule test
  attack simulation
  canary credential detection
  incident drill
```

Jika hanya memakai SAST, banyak vulnerability berbasis runtime/configuration tidak terlihat.

Jika hanya memakai DAST, banyak bug branch internal tidak tercapai.

Jika hanya memakai pentest tahunan, regression harian tidak tertangkap.

Jika hanya memakai dependency scanner, custom authorization bug tidak terdeteksi.

Jika hanya memakai unit test, deployment dan runtime boundary tetap buta.

Security testing yang matang adalah **portfolio**, bukan single tool.

---

### 1.3 Test Tidak Harus Membuktikan Sistem “Aman Mutlak”

Security testing tidak pernah membuktikan tidak ada vulnerability.

Yang realistis:

1. Menguji invariant paling penting.
2. Mengurangi class bug yang umum.
3. Mendeteksi regression.
4. Membuat exploitation lebih sulit.
5. Mempercepat feedback ke developer.
6. Memberi evidence untuk risk acceptance.
7. Mengubah security dari opini menjadi signal.

Security testing adalah alat untuk mengelola risiko, bukan jaminan absolut.

---

## 2. Taxonomy Security Testing

### 2.1 Static Application Security Testing — SAST

SAST menganalisis source code, bytecode, atau intermediate representation tanpa menjalankan aplikasi.

Cocok untuk:

- injection pattern;
- insecure API usage;
- hardcoded secret;
- unsafe deserialization;
- path traversal;
- crypto misuse;
- tainted data flow;
- missing validation;
- dangerous sink;
- insecure configuration pattern.

Kekuatan SAST:

- bisa jalan early di PR;
- tidak butuh deployed app;
- bisa menemukan path yang sulit dicapai DAST;
- bagus untuk enforcement coding rule;
- bagus untuk review prioritization.

Kelemahan SAST:

- false positive;
- false negative;
- sulit memahami runtime config;
- sulit memahami framework magic;
- sulit memahami authorization semantics;
- bisa gagal ketika code flow terlalu dynamic;
- sering tidak tahu apakah path benar-benar reachable.

Mental model:

```text
SAST = "apakah kode ini mengandung pola yang mungkin berbahaya?"
```

Bukan:

```text
SAST = "aplikasi ini aman."
```

---

### 2.2 Dynamic Application Security Testing — DAST

DAST menguji aplikasi yang sedang berjalan dari luar, biasanya lewat HTTP/API.

Cocok untuk:

- reflected/stored XSS;
- SQL injection reachable dari endpoint;
- missing security header;
- authentication/session bug;
- exposed endpoint;
- weak TLS configuration;
- broken access control pada path sederhana;
- error disclosure;
- server misconfiguration.

Kekuatan DAST:

- menguji aplikasi nyata yang berjalan;
- menangkap configuration issue;
- mendekati perspektif attacker eksternal;
- tidak perlu source code;
- bisa memvalidasi exploitability untuk beberapa class bug.

Kelemahan DAST:

- coverage terbatas oleh crawler/test script;
- sulit menguji deep business logic;
- sulit menguji role/tenant matrix kompleks;
- sulit menguji async/batch/message flow;
- bisa destructive kalau test data tidak aman;
- sering butuh environment khusus.

Mental model:

```text
DAST = "apakah deployed application menunjukkan perilaku rentan dari luar?"
```

---

### 2.3 Interactive Application Security Testing — IAST

IAST mengamati aplikasi saat test berjalan, biasanya melalui agent/instrumentation. Ia menggabungkan sinyal runtime dengan pengetahuan internal code path.

Cocok untuk:

- menemukan vulnerability yang terjadi pada path yang benar-benar dieksekusi;
- mengurangi false positive dibanding SAST;
- melihat data flow runtime;
- menghubungkan request ke source/sink;
- integrasi dengan integration/e2e tests.

Kekuatan IAST:

- lebih context-aware;
- tahu path yang dieksekusi;
- bisa memberi lokasi kode yang relevan;
- cocok untuk pipeline dengan test suite matang.

Kelemahan IAST:

- butuh instrumentation;
- overhead runtime;
- coverage bergantung pada test suite;
- agent compatibility bisa menjadi isu;
- tidak menggantikan threat modeling/manual review.

Mental model:

```text
IAST = "ketika aplikasi dijalankan oleh test, apakah path yang benar-benar lewat menunjukkan vulnerability?"
```

---

### 2.4 Software Composition Analysis — SCA

SCA menganalisis dependency pihak ketiga.

Cocok untuk:

- known CVE;
- vulnerable transitive dependency;
- license risk;
- outdated dependency;
- vulnerable container layer;
- SBOM generation;
- upgrade prioritization.

Kekuatan SCA:

- sangat penting untuk Java karena dependency graph sering besar;
- otomatis;
- bisa enforce policy;
- membantu incident response saat CVE baru keluar.

Kelemahan SCA:

- tidak semua CVE reachable;
- tidak semua vulnerable code declared dalam metadata;
- shaded/relocated/embedded dependency bisa tersembunyi;
- version matching tidak selalu sempurna;
- dependency aman tetap bisa disalahgunakan oleh aplikasi.

Mental model:

```text
SCA = "komponen yang kita bawa punya risiko apa?"
```

Bukan:

```text
SCA = "kode kita aman."
```

---

### 2.5 Secret Scanning

Secret scanning mencari credential/token/key yang tidak sengaja masuk ke source, log, artifact, image, atau config.

Cocok untuk:

- API key;
- private key;
- password;
- cloud access key;
- JWT signing secret;
- database credential;
- webhook secret;
- OAuth client secret;
- `.env` leakage;
- PEM file leakage.

Kekuatan:

- cepat;
- bisa dijalankan pre-commit, PR, CI, registry, dan repo history;
- mengurangi incident sederhana tetapi sangat fatal.

Kelemahan:

- false positive;
- secret yang sudah bocor tetap harus dirotasi;
- tidak semua secret punya pattern mudah;
- custom internal token perlu detector custom;
- scanning tidak menggantikan secret management.

Mental model:

```text
Secret scanner menemukan kebocoran.
Secret management mencegah kebocoran menjadi normal.
Rotation mengurangi blast radius setelah kebocoran.
```

---

### 2.6 Fuzz Testing

Fuzzing memberi input acak/terstruktur/mutasi ke parser, API, atau function untuk menemukan crash, hang, exception, assertion failure, excessive resource use, atau bypass.

Cocok untuk:

- parser file;
- JSON/XML/YAML parser boundary;
- archive extraction;
- custom protocol;
- canonicalization;
- URL/path normalization;
- validation logic;
- token parser;
- cryptographic envelope parser;
- data import pipeline.

Kekuatan:

- menemukan kasus tepi yang tidak terpikir manual;
- bagus untuk parser dan boundary;
- bisa menemukan DoS condition;
- cocok untuk regression corpus.

Kelemahan:

- butuh harness;
- butuh oracle/assertion yang jelas;
- coverage perlu dipantau;
- bug business logic yang perlu state kompleks sulit ditemukan dengan fuzzing naif.

Mental model:

```text
Fuzzing = "biarkan mesin mencoba input aneh sampai invariant pecah."
```

---

### 2.7 Property-Based Testing

Property-based testing tidak menulis satu input contoh, tetapi menulis property yang harus selalu benar untuk banyak input yang digenerate.

Contoh property:

```text
Untuk semua user non-admin:
  user tidak boleh membaca case milik tenant lain.

Untuk semua path entry archive:
  resolved output path harus tetap berada di staging root.

Untuk semua encrypted payload valid:
  decrypt(encrypt(plaintext)) == plaintext.

Untuk semua payload yang diubah satu bit:
  verification harus gagal.

Untuk semua command dengan idempotency key sama:
  effect tidak boleh terjadi lebih dari sekali.
```

Kekuatan:

- cocok untuk invariant;
- menemukan edge case;
- lebih kuat daripada contoh tunggal;
- bisa shrink input untuk debugging;
- bagus untuk domain rule dan security boundary.

Kelemahan:

- butuh kemampuan merumuskan property;
- generator data harus realistis;
- sulit untuk sistem stateful besar jika tidak didesain;
- false confidence jika property terlalu lemah.

Mental model:

```text
Example-based test: "contoh ini benar."
Property-based test: "aturan ini selalu benar untuk ruang input yang luas."
```

---

### 2.8 Manual Security Review

Manual review tetap perlu karena beberapa risiko tidak bisa ditemukan tool.

Cocok untuk:

- authorization semantics;
- trust boundary;
- business logic abuse;
- key lifecycle;
- audit defensibility;
- replay model;
- tenant isolation;
- cross-service invariant;
- insecure architecture composition;
- threat model review.

Kekuatan:

- memahami intent;
- memahami domain;
- memahami attacker goal;
- bisa menilai risk trade-off;
- bisa menemukan desain yang salah meski kode “bersih”.

Kelemahan:

- mahal;
- subjektif;
- sulit scale;
- bergantung skill reviewer;
- mudah tidak konsisten tanpa checklist dan evidence.

Mental model:

```text
Tool menemukan pattern.
Reviewer menemukan broken assumption.
```

---

## 3. Security Test Pyramid untuk Java Enterprise

Testing pyramid biasa:

```text
        E2E
     Integration
        Unit
```

Security testing pyramid perlu dimodifikasi:

```text
                 Manual threat-led testing
              DAST / IAST / attack simulation
          Integration security tests / API abuse tests
       Property-based tests / fuzzing / contract tests
   Unit security tests / negative tests / static checks
Pipeline gates: SAST, SCA, secret scan, IaC, container scan
```

Yang menarik: pipeline gates ada di dasar karena harus sering dan murah. Tetapi jangan salah: berada di dasar bukan berarti cukup.

Security testing yang baik punya dua arah:

```text
Bottom-up:
  cegah bug murah sejak awal.

Top-down:
  validasi threat besar dan business abuse case.
```

---

## 4. Dari Requirement ke Security Test

Security testing harus dimulai dari requirement/invariant, bukan dari tool.

### 4.1 Contoh Transformasi Requirement

Requirement:

> User hanya boleh melihat case dalam tenant yang sama.

Security invariant:

```text
Untuk setiap request baca case:
  authenticated user tenant_id harus sama dengan case.tenant_id,
  kecuali user punya explicit cross-tenant authorization yang terverifikasi.
```

Threat:

```text
Attacker mengganti caseId pada URL/API payload untuk membaca case tenant lain.
```

Test:

```text
Given user A dari tenant T1
And case C2 milik tenant T2
When user A request GET /cases/C2
Then response must be 403 or 404
And no sensitive field is returned
And audit event contains denied access
And service does not fetch detail after authorization failure if avoidable
```

SAST rule:

```text
Controller/service method yang menerima caseId harus melalui authorization guard.
```

Integration test:

```text
Cross-tenant matrix for read/update/delete/export/attachment/download/comment/history.
```

Property test:

```text
For all userTenant != caseTenant, all protected actions are denied.
```

---

### 4.2 Security Test Mapping Template

Gunakan template seperti ini:

```text
Security Requirement:
  <apa yang harus benar>

Asset:
  <apa yang dilindungi>

Threat:
  <cara attacker mencoba melanggar>

Invariant:
  <kondisi yang tidak boleh pecah>

Test Type:
  unit / integration / property / fuzz / SAST / DAST / manual

Positive Test:
  <akses valid berhasil>

Negative Test:
  <akses invalid ditolak>

Abuse Test:
  <input/flow hostile>

Expected Safe Failure:
  <status, error, audit, no leakage>

Evidence:
  <test name, report, pipeline gate, review record>
```

---

## 5. Unit Security Testing

Unit security test cocok untuk komponen kecil yang punya invariant jelas.

### 5.1 Password Verification

Contoh invariant:

```text
- password valid diterima;
- password salah ditolak;
- hash format rusak ditolak secara aman;
- algorithm lama bisa diverifikasi lalu dimigrasi;
- comparison tidak memakai String.equals untuk secret material;
- error tidak membedakan user tidak ada vs password salah secara observable.
```

Contoh pseudo-test:

```java
@Test
void passwordVerificationRejectsWrongPassword() {
    PasswordHasher hasher = new PasswordHasher(policy);
    String stored = hasher.hash("Correct horse battery staple");

    assertFalse(hasher.verify("wrong password", stored).matched());
}

@Test
void malformedHashFailsClosed() {
    PasswordHasher hasher = new PasswordHasher(policy);

    VerificationResult result = hasher.verify("anything", "not-a-valid-hash-format");

    assertFalse(result.matched());
    assertTrue(result.failureReason().isSafeForAuditOnly());
}
```

Catatan:

Jangan membuat test timing microbenchmark sebagai unit test biasa lalu menganggap aman. Timing resistance butuh desain API, constant-time primitive, dan threat assessment. Unit test hanya membantu mencegah kesalahan jelas seperti `String.equals` pada MAC/signature digest.

---

### 5.2 JWT Validator

Security invariant:

```text
Token hanya diterima jika:
  issuer expected;
  audience expected;
  signature valid;
  algorithm allowlisted;
  key dipilih dari trusted JWKS;
  exp/nbf/iat valid dengan clock skew terbatas;
  token type benar;
  required claims ada;
  critical claims dipahami;
  subject mapping aman.
```

Negative test yang wajib:

```text
- expired token ditolak;
- wrong audience ditolak;
- wrong issuer ditolak;
- missing signature ditolak;
- algorithm tidak diizinkan ditolak;
- token dengan key id tidak dikenal ditolak;
- token dari issuer lain tapi kid sama ditolak;
- token dengan role tambahan di client-side claim ditolak jika role seharusnya dari server authority;
- token yang dimodifikasi satu byte ditolak;
- token dengan future nbf terlalu jauh ditolak.
```

Contoh pseudo-test:

```java
@Test
void rejectsJwtWithWrongAudience() {
    String token = tokenFactory.issue(builder -> builder
            .issuer("https://idp.example.gov")
            .audience("other-service")
            .subject("user-123"));

    assertThrows(InvalidTokenException.class, () -> validator.validate(token));
}
```

---

### 5.3 Path Traversal Guard

Security invariant:

```text
Resolved output path harus tetap berada di root directory yang ditentukan.
```

Test cases:

```text
normal.pdf
../secret.txt
..%2Fsecret.txt
subdir/../../secret.txt
/absolute/path
C:\Windows\win.ini
folder\..\..\secret.txt
unicode confusable separator
symlink edge case
very long path
null byte if underlying API/context relevant
```

Pseudo-test:

```java
@ParameterizedTest
@ValueSource(strings = {
        "../secret.txt",
        "subdir/../../secret.txt",
        "/etc/passwd",
        "C:\\Windows\\win.ini"
})
void rejectsTraversal(String entryName) {
    Path root = Path.of("/safe/staging").toAbsolutePath().normalize();

    assertThrows(UnsafePathException.class, () -> safeResolver.resolve(root, entryName));
}
```

---

### 5.4 MAC Verification

Security invariant:

```text
MAC verification harus gagal jika payload, timestamp, nonce, method, path, atau body berubah.
```

Test:

```text
- valid request diterima;
- body changed -> rejected;
- path changed -> rejected;
- timestamp changed -> rejected;
- nonce reused -> rejected;
- signature truncated -> rejected;
- wrong key id -> rejected;
- unknown key id -> rejected;
- old timestamp -> rejected.
```

---

## 6. Integration Security Testing

Unit test tidak cukup karena banyak security failure terjadi di composition.

### 6.1 Authorization Matrix Test

Untuk aplikasi enterprise/regulatory, authorization harus diuji sebagai matrix.

Dimensi umum:

```text
Actor:
  applicant
  officer
  supervisor
  admin
  system user
  external agency user

Object:
  own case
  same team case
  same agency case
  other agency case
  closed case
  locked case
  archived case
  sensitive case

Action:
  read
  create
  update
  assign
  approve
  reject
  export
  download attachment
  view audit
  delete
  reopen
```

Jangan hanya test role.

Test kombinasi:

```text
role + tenant + ownership + state + delegation + data sensitivity + action
```

Contoh matrix:

| Actor | Object | State | Action | Expected |
|---|---|---:|---|---|
| Officer T1 | Case T1 assigned | Open | Update | Allow |
| Officer T1 | Case T1 unassigned | Open | Update | Deny |
| Officer T1 | Case T2 assigned impossible | Open | Read | Deny |
| Supervisor T1 | Case T1 | Pending approval | Approve | Allow |
| Supervisor T1 | Case T2 | Pending approval | Approve | Deny |
| Admin | Case sensitive | Any | Export | Depends on explicit policy |

Security test harus mengunci expectation ini agar tidak berubah diam-diam saat refactor.

---

### 6.2 API Abuse Tests

API abuse test menguji cara attacker memanipulasi request.

Contoh:

```text
- object id diganti;
- tenant id di body diganti;
- role claim ditambah di JWT;
- header internal ditambahkan dari internet;
- query filter dimodifikasi;
- pagination dipaksa ukuran besar;
- sorting field berbahaya;
- batch request berisi object campuran tenant;
- bulk update sebagian valid sebagian forbidden;
- state transition dilompati;
- approval dilakukan oleh submitter yang sama;
- attachment id dari case lain dipakai.
```

Test harus memastikan:

```text
- response aman;
- partial update tidak menyebabkan inconsistent state;
- audit tercatat;
- unauthorized object tidak bocor lewat error;
- policy dievaluasi di server, bukan percaya input client.
```

---

### 6.3 Async and Message Security Tests

Banyak vulnerability tidak ada di HTTP endpoint tetapi di worker.

Test untuk message consumer:

```text
- message dari queue dengan signature invalid ditolak;
- duplicate message tidak mengulang side effect;
- old message tidak diproses jika freshness diperlukan;
- message dengan tenant mismatch ditolak;
- message dengan schema lama diproses sesuai compatibility policy;
- poison message masuk DLQ setelah batas retry;
- redelivery tidak menimbulkan double approval/payment/notification;
- internal command tidak bisa dipalsukan oleh external producer.
```

Ingat:

```text
Queue bukan trust boundary otomatis.
Internal network bukan bukti authority.
```

---

## 7. Property-Based Security Testing

### 7.1 Kapan Property-Based Testing Sangat Berguna

Property-based testing sangat cocok untuk security area berikut:

1. Authorization matrix.
2. State machine transition.
3. Path normalization.
4. Canonicalization.
5. Idempotency.
6. Replay prevention.
7. Cryptographic envelope parsing.
8. Data masking.
9. Tenant isolation.
10. Validation boundary.

---

### 7.2 Contoh Property: Authorization Isolation

Property:

```text
Untuk semua user dan case:
  jika user.tenantId != case.tenantId,
  maka protected action harus denied.
```

Pseudo-code:

```java
@Property
void crossTenantAccessIsAlwaysDenied(@ForAll User user,
                                     @ForAll CaseRecord caseRecord,
                                     @ForAll("protectedActions") Action action) {
    assumeThat(!user.tenantId().equals(caseRecord.tenantId()));

    AuthorizationDecision decision = policy.evaluate(user, action, caseRecord);

    assertEquals(DENY, decision.result());
}
```

Nilainya bukan di syntax, tetapi di cara pikir:

```text
Kita tidak menulis 10 contoh manual.
Kita memaksa policy bertahan terhadap banyak kombinasi user/object/action.
```

---

### 7.3 Contoh Property: Safe Path Resolution

Property:

```text
Untuk semua entryName:
  jika resolver menerima entryName,
  resolved path harus berada di bawah root.
```

Pseudo-code:

```java
@Property
void acceptedPathsNeverEscapeRoot(@ForAll String entryName) {
    Path root = tempRoot.toAbsolutePath().normalize();

    Optional<Path> resolved = resolver.tryResolve(root, entryName);

    resolved.ifPresent(path ->
            assertTrue(path.toAbsolutePath().normalize().startsWith(root))
    );
}
```

Ini sangat kuat untuk archive extraction/path traversal.

---

### 7.4 Contoh Property: Tamper Detection

Property:

```text
Untuk semua payload valid:
  jika satu byte ciphertext/tag/AAD diubah,
  decrypt/verify harus gagal.
```

Pseudo-code:

```java
@Property
void tamperedEnvelopeIsRejected(@ForAll byte[] plaintext,
                                @ForAll byte[] aad) {
    CryptoEnvelope envelope = crypto.encrypt(plaintext, aad);

    CryptoEnvelope tampered = envelope.withCiphertext(flipOneBit(envelope.ciphertext()));

    assertThrows(AuthenticationFailedException.class,
            () -> crypto.decrypt(tampered, aad));
}
```

---

### 7.5 Property-Based Testing Pitfall

Property yang buruk bisa memberi false confidence.

Contoh property lemah:

```text
encrypt output tidak sama dengan plaintext.
```

Itu tidak membuktikan encryption aman.

Property lebih baik:

```text
- decrypt(encrypt(p, aad), aad) == p;
- tampered ciphertext rejected;
- tampered tag rejected;
- wrong AAD rejected;
- wrong key rejected;
- nonce tidak reused untuk key yang sama;
- envelope version unsupported ditolak dengan aman.
```

---

## 8. Fuzzing untuk Java Security

### 8.1 Target Fuzzing yang Bagus

Fuzzing paling berguna ketika ada parser atau boundary.

Target Java enterprise:

```text
- upload filename parser;
- archive extractor;
- CSV importer;
- JSON canonicalizer;
- XML parser wrapper;
- JWT/JWS/JWE parser wrapper;
- webhook signature canonical string builder;
- URL redirect validator;
- email address validator;
- expression/filter parser;
- search query parser;
- template renderer wrapper;
- custom binary protocol;
- report import/export parser;
- document metadata parser.
```

---

### 8.2 Fuzzing Oracle

Fuzzing butuh oracle: kondisi apa yang dianggap bug?

Oracle umum:

```text
- tidak boleh crash dengan unexpected exception;
- tidak boleh hang;
- tidak boleh OOM;
- tidak boleh melewati time limit;
- tidak boleh menghasilkan path di luar root;
- tidak boleh menerima invalid signature;
- tidak boleh menerima invalid token;
- tidak boleh menghasilkan SQL/command string dari input mentah;
- tidak boleh menghasilkan object partially trusted;
- tidak boleh memproses payload setelah validation failure.
```

---

### 8.3 Fuzz Harness Concept

Fuzzing yang baik tidak langsung menarget seluruh aplikasi. Buat harness kecil.

Buruk:

```text
Run full Spring Boot app and fuzz all endpoints randomly.
```

Lebih baik:

```text
Extract parser/validator/canonicalizer into deterministic component.
Fuzz component with clear security assertion.
```

Contoh target:

```java
public final class RedirectUrlValidator {
    public boolean isAllowed(String rawUrl) {
        // normalize, parse, validate scheme/host/path
    }
}
```

Fuzz assertion:

```text
If validator returns true:
  normalized URL must use https;
  host must be exact allowlisted host or safe subdomain according to policy;
  URL must not contain embedded credential;
  URL must not use backslash confusion;
  URL must not normalize into another host.
```

---

### 8.4 Fuzzing and Regression Corpus

Setiap input yang menemukan bug harus disimpan.

```text
fuzz-inputs/
  path-traversal/
    regression-001.txt
    regression-002.txt
  jwt-parser/
    regression-001.jwt
  xml-parser/
    regression-001.xml
```

Setelah bug diperbaiki:

```text
- input menjadi regression test;
- test masuk CI;
- issue ditautkan ke fix;
- threat model diperbarui jika perlu.
```

---

## 9. SAST yang Efektif untuk Java

### 9.1 Jangan Perlakukan SAST sebagai “Pass/Fail Semua Findings”

SAST mentah sering menghasilkan banyak noise.

Pipeline yang baik:

```text
1. Block high-confidence/high-impact issues.
2. Triage medium-confidence findings.
3. Suppress dengan justifikasi dan expiry.
4. Tambahkan custom rule untuk policy internal.
5. Ukur trend, bukan hanya angka absolut.
6. Prioritaskan reachable/sensitive code path.
```

---

### 9.2 Area SAST Java yang Paling Bernilai

Cari pattern seperti:

```text
Injection:
  Statement.execute(rawSql)
  EntityManager.createQuery(concatenatedString)
  Runtime.exec(userInput)
  ProcessBuilder(userInput)
  LDAP query concat
  XPath expression concat

Deserialization:
  ObjectInputStream on untrusted input
  enableDefaultTyping in JSON libraries
  polymorphic deserialization without allowlist

Crypto misuse:
  Cipher.getInstance("AES")
  ECB mode
  static IV
  weak random
  MD5/SHA1 for security
  hardcoded key
  insecure password hash

Path/file:
  ZipInputStream extraction without path normalization
  File constructed from user input
  temp file predictable name

Authz:
  repository.findById(id) without ownership predicate nearby
  admin flag from request body
  tenant id from client without server-side verification

Logging:
  logging Authorization header
  logging password/token/secret
  logging full PII payload

TLS:
  TrustManager that trusts all certificates
  HostnameVerifier returns true
```

---

### 9.3 Custom SAST Rules

Generic SAST tidak tahu domain kamu.

Untuk sistem case management, custom rules bisa mencari:

```text
- endpoint dengan caseId tetapi tidak memanggil CaseAuthorization;
- repository method findById tanpa tenant predicate untuk aggregate sensitif;
- export endpoint tanpa audit event;
- state transition tanpa policy check;
- attachment download tanpa ownership check;
- admin endpoint tanpa privileged annotation;
- raw claim role mapping tanpa server-side authority validation;
- direct file write dari uploaded filename;
- use of internal header from public controller.
```

Custom rule sering lebih bernilai daripada 1000 generic warning.

---

### 9.4 Suppression Discipline

Suppression boleh, tetapi harus terkendali.

Suppression buruk:

```java
@SuppressWarnings("all")
```

Suppression yang lebih defensible:

```text
- rule id;
- alasan;
- owner;
- tanggal;
- expiry/review date;
- compensating control;
- link ke threat model/ADR/security review.
```

Contoh komentar:

```java
// security-scan-ignore: JAVA_PATH_TRAVERSAL
// reason: path is resolved by SafePathResolver which enforces startsWith(root)
// evidence: SafePathResolverTest#acceptedPathsNeverEscapeRoot
// owner: platform-security
// review-by: 2026-12-31
```

---

## 10. DAST yang Efektif

### 10.1 DAST Butuh Authenticated Context

Banyak aplikasi enterprise tidak bisa diuji hanya sebagai anonymous user.

DAST perlu:

```text
- user role rendah;
- user role normal;
- supervisor;
- admin;
- tenant A user;
- tenant B user;
- expired session scenario;
- CSRF/session behavior jika relevan;
- token refresh behavior;
- API key/webhook profile.
```

Tanpa authenticated profile, DAST hanya melihat permukaan kecil.

---

### 10.2 DAST untuk Broken Access Control

DAST generic sering tidak cukup untuk BOLA/BFLA. Perlu scripted test.

Pattern:

```text
1. Login sebagai user A.
2. Buat/ambil object A.
3. Login sebagai user B.
4. Coba akses object A.
5. Pastikan deny.
6. Ulang untuk read/update/delete/download/export/history/comment.
```

Ini harus jadi regression test, bukan hanya pentest manual.

---

### 10.3 Safe DAST Environment

DAST bisa destructive.

Environment harus:

```text
- isolated;
- menggunakan synthetic data;
- punya reset mechanism;
- tidak mengirim email/SMS nyata;
- tidak memanggil payment/external authority nyata;
- rate limited;
- punya allowlist scanner IP;
- punya monitoring agar scan tidak disalahartikan sebagai incident;
- punya test accounts dengan scope terbatas.
```

---

## 11. IAST dan Coverage Reality

IAST bagus jika test suite bagus. Jika test suite lemah, IAST juga lemah.

```text
IAST coverage <= executed test coverage
```

Artinya:

- endpoint tidak dites → IAST tidak melihat;
- role tidak dites → authz bug tidak terlihat;
- parser path tidak dieksekusi → parser bug tidak terlihat;
- async worker tidak dipicu → message vulnerability tidak terlihat.

Gunakan IAST sebagai amplifier, bukan pengganti test design.

---

## 12. Dependency and Supply Chain Security Testing

Part 27 sudah membahas supply chain. Di sini kita tekankan testing/pipeline-nya.

### 12.1 SCA Gate

Policy contoh:

```text
Block release if:
  - critical CVE with known exploit and reachable component;
  - high CVE in internet-facing path without mitigation;
  - vulnerable auth/crypto/parser library;
  - dependency has malicious package indicator;
  - dependency violates approved repository policy;
  - SBOM missing for release artifact.

Warn but allow with approval if:
  - CVE not reachable and documented;
  - dev/test-only dependency not packaged;
  - patch unavailable but compensating control exists;
  - transitive dependency pinned pending upstream fix.
```

---

### 12.2 Reachability Matters, But Jangan Jadi Alasan Lemah

Reachability analysis membantu prioritas.

Namun jangan menyalahgunakan:

```text
"Scanner bilang not reachable" != "tidak ada risiko".
```

Alasan:

- reflection;
- framework dynamic dispatch;
- deserialization gadget;
- ServiceLoader;
- shaded dependency;
- native calls;
- plugin architecture;
- test coverage gap.

Gunakan reachability sebagai input risk assessment, bukan izin otomatis.

---

### 12.3 SBOM Validation

Security test untuk SBOM:

```text
- SBOM dihasilkan dari artifact final, bukan source assumption;
- SBOM mencakup transitive dependency;
- SBOM disimpan bersama release;
- SBOM bisa dipakai saat CVE baru muncul;
- SBOM tidak hilang saat shading/relocation;
- SBOM punya metadata build/release yang cukup;
- container image SBOM dan application SBOM bisa dikorelasikan.
```

---

## 13. Secret Scanning sebagai Test

Secret scanning harus jalan di banyak titik.

```text
Developer machine:
  pre-commit optional but useful

Pull request:
  mandatory scan for changed files

Repository:
  scheduled full-history scan

CI artifact:
  scan reports, packaged files, generated config

Container image:
  scan filesystem layers

Logs:
  detect secret pattern leakage

Object storage:
  scan uploaded config/archive if relevant
```

Jika secret ditemukan:

```text
1. Anggap bocor.
2. Rotate/revoke.
3. Hapus dari source/history jika policy mengharuskan.
4. Tambahkan detector/policy agar tidak terulang.
5. Audit penggunaan secret selama exposure window.
```

Jangan hanya “hapus commit” tanpa rotation.

---

## 14. Security Regression Test Suite

Setiap vulnerability/near miss harus menjadi regression test.

Template:

```text
Incident/Issue:
  <apa yang ditemukan>

Root Cause:
  <invariant apa yang tidak diuji>

Exploit Shape:
  <input/flow yang memicu>

Fix:
  <perubahan>

Regression Test:
  <test yang gagal sebelum fix dan lulus setelah fix>

Pipeline Gate:
  <apakah test masuk CI blocking?>
```

Contoh:

```text
Issue:
  Attachment download accepted attachmentId from another case.

Root Cause:
  Authorization checked case access but not attachment ownership.

Regression:
  user with access to case A cannot download attachment from case B by id substitution.
```

---

## 15. Testing Crypto Correctness

Crypto testing punya aturan khusus.

### 15.1 Jangan Test Crypto dengan “Output Kelihatan Random”

Buruk:

```java
assertNotEquals(plaintext, ciphertext);
```

Itu hampir tidak membuktikan apa-apa.

Lebih baik:

```text
- use standard test vectors when available;
- valid round-trip;
- wrong key rejected;
- wrong AAD rejected;
- tampered ciphertext rejected;
- tampered tag rejected;
- nonce uniqueness tested at design level;
- envelope version parsing tested;
- algorithm allowlist tested;
- legacy algorithm migration tested.
```

---

### 15.2 Known Answer Tests

Untuk primitive/wrapper yang penting, gunakan known answer test dari standard/library jika tersedia.

Tujuannya:

```text
- memastikan parameter benar;
- memastikan encoding benar;
- memastikan endianness/format benar;
- memastikan interoperability;
- mencegah regression saat refactor.
```

---

### 15.3 Negative Crypto Tests

Wajib:

```text
AEAD:
  - modify ciphertext -> fail
  - modify tag -> fail
  - modify AAD -> fail
  - wrong key -> fail
  - unsupported version -> fail

Signature:
  - modified payload -> fail
  - wrong public key -> fail
  - unsupported algorithm -> fail
  - missing critical signed field -> fail
  - canonicalization mismatch -> fail

MAC:
  - modified method/path/body/timestamp/nonce -> fail
  - replayed nonce -> fail
  - old timestamp -> fail
  - unknown key id -> fail
```

---

## 16. Testing Authorization Correctness

Authorization bugs adalah salah satu area paling penting.

### 16.1 Jangan Hanya Test Role

Test role saja tidak cukup:

```text
ROLE_OFFICER can access /cases/{id}
```

Pertanyaan sebenarnya:

```text
Officer mana?
Case milik siapa?
Dalam state apa?
Assigned ke siapa?
Sensitive atau tidak?
Ada delegation?
Ada conflict of interest?
Action apa?
Channel apa?
```

---

### 16.2 Repository-Level Guard

Pattern aman:

```java
Optional<CaseRecord> findByIdAndTenantId(CaseId caseId, TenantId tenantId);
```

Lebih riskan:

```java
Optional<CaseRecord> findById(CaseId caseId);
```

Lalu authz dicek terpisah setelah data sensitif sudah terambil.

Testing harus memastikan:

```text
- data access predicate mengandung tenant/scope jika memungkinkan;
- object-level authorization tetap ada;
- error tidak membocorkan object existence lintas tenant;
- bulk operation melakukan per-object authorization;
- export/report tidak bypass object-level policy.
```

---

## 17. Testing Input Validation and Injection Resistance

### 17.1 Validation Test Matrix

Untuk setiap input penting:

```text
valid minimum
valid maximum
empty
null
whitespace
unicode
very long
control character
reserved character
encoded form
double-encoded form
mixed normalization
SQL metacharacter
HTML metacharacter
path separator
line break
large numeric value
negative numeric value
scientific notation if numeric parser relevant
```

---

### 17.2 Injection Tests

Injection test harus fokus ke sink.

```text
SQL:
  verify prepared statement / parameter binding

Command:
  avoid shell; use fixed executable and separate args

LDAP/XPath:
  escape or parameterize according to context

Template:
  disallow user-controlled template execution

Log:
  prevent log forging via newline/control chars

Header:
  prevent CRLF injection
```

---

## 18. Testing File Upload Security

Test file upload harus mencakup:

```text
- extension allowlist;
- content type spoofing;
- magic number mismatch;
- oversized file;
- zero-byte file;
- archive with traversal entry;
- archive bomb pattern;
- nested archive;
- filename with path separator;
- filename with unicode confusable;
- duplicate filename collision;
- malware scan integration failure;
- storage failure;
- partial upload;
- download authorization;
- direct object reference to uploaded file;
- public URL exposure;
- metadata stripping if required.
```

Safe failure:

```text
- reject or quarantine;
- do not process;
- do not publish;
- audit event;
- no sensitive parser stack trace;
- cleanup temporary artifact.
```

---

## 19. Testing Logging and Audit Integrity

Audit/logging test harus memastikan dua hal:

```text
1. Security-relevant event tercatat.
2. Sensitive data tidak bocor.
```

Test event presence:

```text
- login success/failure;
- access denied;
- privilege change;
- password reset;
- token refresh failure;
- case approval/rejection;
- export/download;
- admin setting change;
- key rotation;
- signature verification failure;
- replay attempt;
- tampered payload;
- suspicious upload.
```

Test event safety:

```text
- no password;
- no access token;
- no refresh token;
- no private key;
- no full secret;
- no full PII payload unless explicitly approved;
- no raw Authorization header;
- no full signed payload if sensitive;
- no cryptographic material.
```

Audit integrity test:

```text
- hash chain verifies;
- missing record detected;
- modified record detected;
- reordered record detected if sequence included;
- signing key id recorded;
- verification handles key rotation;
- timestamp source recorded.
```

---

## 20. Testing Runtime and Deployment Security

Pipeline harus menguji bukan hanya Java code tetapi deployment context.

### 20.1 Container Security Tests

```text
- image runs as non-root;
- root filesystem read-only where possible;
- no package manager in runtime image if avoidable;
- no shell if distroless policy;
- no secret in image layers;
- no unnecessary port exposed;
- base image scanned;
- SBOM generated;
- image signed;
- digest pinned in deployment;
- capabilities dropped;
- seccomp/apparmor policy applied where applicable.
```

---

### 20.2 Kubernetes Security Tests

```text
- no privileged pod;
- no hostPath unless approved;
- service account least privilege;
- automount token disabled if unnecessary;
- network policy restricts egress/ingress;
- resource limits set;
- secret usage controlled;
- readiness/liveness not leaking sensitive info;
- admin/debug endpoint not exposed;
- metadata service access restricted where possible.
```

---

### 20.3 JVM Diagnostic Safety Tests

```text
- heap dump disabled/restricted in prod;
- crash dump path protected;
- JMX requires auth/TLS or disabled;
- thread dump access restricted;
- actuator/management endpoints protected;
- debug port not exposed;
- logs do not include startup secrets;
- environment dump endpoint absent.
```

---

## 21. CI/CD Security Test Strategy

### 21.1 Example Pipeline

```text
On pull request:
  - unit security tests
  - authorization matrix tests for touched modules
  - SAST incremental scan
  - secret scan changed files
  - dependency diff scan
  - lint IaC/deployment if changed

On merge to main:
  - full unit/integration security suite
  - property-based tests with moderate sample count
  - selected fuzz regression corpus
  - SAST full scan
  - SCA full scan
  - secret scan repository snapshot
  - SBOM generation
  - container scan

On release candidate:
  - DAST authenticated scan
  - IAST with e2e suite if available
  - provenance/signing verification
  - policy gate
  - manual review for high-risk changes

Scheduled nightly/weekly:
  - deeper fuzzing
  - full dependency rescan
  - full history secret scan
  - attack simulation scripts
  - security regression suite expanded sample count
```

---

### 21.2 Blocking vs Non-Blocking

Tidak semua signal harus block PR.

Block:

```text
- secret found;
- critical vulnerable dependency in packaged artifact;
- known unsafe crypto pattern;
- TrustManager trust-all;
- HostnameVerifier always true;
- authz regression;
- failing tamper/replay tests;
- container privileged regression;
- missing signature/provenance for release.
```

Warn/triage:

```text
- medium SAST finding;
- dependency CVE with unclear reachability;
- outdated dependency without known vulnerability;
- missing optional hardening header;
- scanner false positive pending review.
```

Policy harus eksplisit agar developer tidak menebak.

---

## 22. Test Data Security

Security testing sering butuh data realistis, tapi jangan pakai production data sembarangan.

Rules:

```text
- gunakan synthetic data untuk CI;
- jika butuh production-like data, mask/tokenize;
- jangan commit real token/certificate/private key;
- gunakan test CA/test key khusus;
- pisahkan test signing key dari production;
- jangan pakai production IdP client secret;
- jangan mengirim email/SMS nyata;
- jangan memanggil external authority nyata kecuali sandbox resmi;
- hapus artifact test yang mengandung sensitive sample.
```

Test data juga bisa menjadi data breach.

---

## 23. Security Test Naming Convention

Nama test harus menjelaskan threat.

Buruk:

```java
@Test
void testCaseAccess() {}
```

Lebih baik:

```java
@Test
void officerCannotReadCaseFromAnotherTenantByChangingCaseId() {}

@Test
void jwtWithWrongAudienceIsRejectedBeforeAuthorityMapping() {}

@Test
void archiveExtractionRejectsEntryThatEscapesStagingRoot() {}

@Test
void replayedWebhookNonceDoesNotTriggerSecondSideEffect() {}

@Test
void modifiedAuditRecordBreaksHashChainVerification() {}
```

Nama test yang baik menjadi dokumentasi security requirement.

---

## 24. Review Checklist untuk Security Testing

Gunakan pertanyaan ini saat review PR/architecture.

### 24.1 Requirement and Threat

```text
- Security invariant apa yang berubah?
- Threat apa yang ditangani?
- Abuse case apa yang mungkin?
- Apakah test menguji failure path, bukan hanya happy path?
- Apakah ada actor/object/action matrix?
```

### 24.2 Test Depth

```text
- Ada unit test untuk guard/policy/validator?
- Ada integration test untuk composition?
- Ada negative test untuk invalid actor/input/token/state?
- Ada property/fuzz test untuk boundary yang kompleks?
- Ada regression test untuk bug security sebelumnya?
```

### 24.3 Tooling

```text
- SAST rule relevan?
- SCA berubah?
- Secret scan bersih?
- Container/IaC scan bersih?
- Suppression punya justifikasi?
- False positive tidak disembunyikan tanpa expiry?
```

### 24.4 Evidence

```text
- Test name jelas?
- Report tersimpan?
- Finding punya owner?
- Risk acceptance terdokumentasi?
- Manual review required untuk high-risk change?
```

---

## 25. Mini Case Study: Case Attachment Download

### 25.1 Context

Aplikasi Java regulatory case management punya endpoint:

```text
GET /cases/{caseId}/attachments/{attachmentId}/download
```

Business rule:

```text
User hanya boleh download attachment jika:
  - user boleh membaca case;
  - attachment memang milik case tersebut;
  - attachment tidak restricted di luar clearance user;
  - case state mengizinkan download;
  - event download diaudit.
```

### 25.2 Bug yang Mungkin

Developer hanya cek:

```text
user can read caseId
```

Lalu mengambil attachment:

```text
attachmentRepository.findById(attachmentId)
```

Jika attacker tahu attachment ID dari case lain, ia bisa:

```text
GET /cases/CASE_ALLOWED/attachments/ATTACHMENT_FROM_OTHER_CASE/download
```

Jika tidak ada check attachment belongs to case, terjadi data leak.

### 25.3 Security Tests

Unit policy test:

```text
attachment must belong to case.
```

Integration test:

```text
Given user can read case A
And attachment X belongs to case B
When download /cases/A/attachments/X
Then deny
And no file bytes returned
And audit denied event recorded
```

Property test:

```text
For all caseId != attachment.caseId:
  download must be denied.
```

SAST custom rule:

```text
Download endpoint must call AttachmentAuthorization or repository method findByCaseIdAndAttachmentId.
```

DAST scripted test:

```text
Create two cases and two attachments, then attempt ID substitution across cases.
```

Audit test:

```text
Denied attempt is recorded without leaking file name if user lacks access.
```

### 25.4 Better Implementation Shape

Better repository method:

```java
Optional<Attachment> findByCaseIdAndAttachmentId(CaseId caseId, AttachmentId attachmentId);
```

Better service flow:

```text
1. Authenticate actor.
2. Load case under tenant/scope constraint.
3. Authorize case read.
4. Load attachment by caseId + attachmentId.
5. Authorize attachment clearance.
6. Stream file from storage.
7. Audit success/failure.
```

Security lesson:

```text
Authorization must bind all identifiers in the request to the same authorized aggregate.
```

---

## 26. Mini Case Study: Webhook Replay

### 26.1 Context

Service menerima webhook dari external provider:

```text
POST /webhooks/provider-x
Headers:
  X-Key-Id
  X-Timestamp
  X-Nonce
  X-Signature
Body:
  {...}
```

### 26.2 Security Invariant

```text
Webhook hanya diproses jika:
  - key id dikenal;
  - signature valid;
  - timestamp dalam window;
  - nonce belum pernah dipakai untuk key/window;
  - canonical string sama antara sender dan verifier;
  - event id idempotent;
  - side effect tidak terjadi dua kali.
```

### 26.3 Tests

Unit:

```text
- valid signature accepted;
- modified body rejected;
- modified path rejected;
- old timestamp rejected;
- reused nonce rejected;
- unknown key id rejected.
```

Integration:

```text
- duplicate webhook delivery does not duplicate side effect;
- concurrent duplicate requests only process once;
- verifier failure emits audit/security event;
- provider key rotation supports old+new key during overlap.
```

Property:

```text
For all valid signed requests:
  changing any signed component invalidates signature.
```

Fuzz:

```text
Fuzz canonicalization around header casing, whitespace, JSON formatting, path encoding.
```

---

## 27. Common Anti-Patterns

### 27.1 “SAST Passed, So Secure”

SAST is useful but incomplete.

It cannot fully prove:

- business authorization;
- tenant isolation;
- key custody;
- operational security;
- manual approval integrity;
- real attack reachability;
- incident readiness.

---

### 27.2 “Pentest Once Before Go-Live”

Pentest is valuable, but if done only once:

```text
- findings arrive too late;
- fixes are rushed;
- regression is likely;
- new features after pentest are untested;
- security learning does not enter engineering loop.
```

Pentest findings should become tests and rules.

---

### 27.3 “Only Happy Path Test for Security Feature”

Example:

```text
JWT valid token accepted.
```

Missing:

```text
- expired token;
- wrong issuer;
- wrong audience;
- unsupported algorithm;
- wrong key;
- missing claim;
- manipulated role;
- replay;
- clock skew;
- key rotation.
```

Security feature without negative tests is not well-tested.

---

### 27.4 “Scanner Suppression Forever”

Permanent suppression becomes invisible risk.

Require expiry.

---

### 27.5 “Test Environment Too Different from Production”

Security failures often hide in config difference:

```text
- TLS disabled in test;
- auth mocked too broadly;
- different reverse proxy;
- different CORS;
- no WAF/rate limit;
- no network policy;
- different secret injection;
- debug endpoints enabled;
- different IdP claims;
- database permissions broader.
```

Mocking is fine, but security-critical behavior needs production-like validation.

---

## 28. Practical Security Testing Roadmap

### Phase 1 — Foundation

```text
- Add negative tests for auth/token/validation.
- Add SCA and secret scanning to CI.
- Add SAST for high-confidence rules.
- Add test naming convention for security tests.
- Add regression tests for known security bugs.
```

### Phase 2 — Domain Security

```text
- Build authorization matrix tests.
- Add object-level access tests.
- Add tenant isolation property tests.
- Add file upload security test corpus.
- Add webhook/API signing tests.
- Add audit event tests.
```

### Phase 3 — Advanced Boundary Testing

```text
- Add fuzzing for parsers/canonicalizers.
- Add property-based tests for state machines.
- Add authenticated DAST scripts.
- Add IAST if test suite is mature.
- Add custom SAST rules for domain patterns.
```

### Phase 4 — Release Integrity

```text
- Enforce SBOM generation.
- Verify artifact signing/provenance.
- Scan container/IaC.
- Add deployment hardening checks.
- Add security evidence package per release.
```

### Phase 5 — Continuous Improvement

```text
- Convert incidents into regression tests.
- Track mean time to remediate findings.
- Track recurring root causes.
- Review suppressions monthly/quarterly.
- Add attack simulation and incident drills.
```

---

## 29. Security Test Evidence Package

Untuk sistem regulated, evidence penting.

Release evidence package bisa berisi:

```text
- threat model delta;
- list of security requirements affected;
- security test report;
- SAST report summary;
- SCA report summary;
- secret scan result;
- SBOM;
- container scan summary;
- DAST/IAST report if applicable;
- manual review notes;
- risk acceptances;
- suppression list with expiry;
- artifact signature/provenance;
- deployment security checklist;
- known residual risks.
```

Ini membuat security defensible, bukan sekadar “kami sudah scan”.

---

## 30. Ringkasan

Security testing adalah cara mengubah security dari asumsi menjadi evidence.

Poin utama:

1. Security test harus menguji invariant, bukan hanya function.
2. Negative tests sama pentingnya dengan positive tests.
3. SAST, DAST, IAST, SCA, secret scanning, fuzzing, property testing, dan manual review punya fungsi berbeda.
4. Tidak ada satu tool yang cukup.
5. Authorization harus diuji sebagai matrix actor/object/action/state/scope.
6. Crypto test harus fokus pada tamper rejection, algorithm allowlist, key mismatch, format, dan interoperability.
7. Fuzzing bagus untuk parser, canonicalizer, validator, file/archive, token, dan URL/path boundary.
8. Property-based testing bagus untuk invariant yang harus selalu benar.
9. Scanner findings perlu triage, suppression discipline, dan policy gate.
10. Setiap security incident harus melahirkan regression test.
11. Regulated systems butuh evidence package, bukan hanya hasil test lokal.

Mental model akhirnya:

```text
Security testing bukan bertanya:
  "Apakah fitur berjalan?"

Security testing bertanya:
  "Apakah sistem tetap menjaga invariant ketika diserang,
   salah dikonfigurasi, diberi input hostile,
   dipakai oleh actor tidak sah,
   atau berada dalam kondisi failure?"
```

---

## 31. Checklist Cepat

```text
Security invariant defined?
Threat mapped?
Negative tests written?
Authorization matrix covered?
Tenant/object-level access tested?
Token validation negative cases covered?
Replay/idempotency tested?
Parser/canonicalizer fuzzed?
File upload hostile corpus present?
Crypto tamper tests present?
Audit/log no-secret tests present?
SAST configured?
SCA configured?
Secret scanning configured?
Container/IaC scanning configured?
DAST authenticated profile available?
IAST coverage understood?
Suppressions justified and expiring?
Findings triaged by risk?
Security regression suite exists?
Release evidence package produced?
```

---

## 32. Referensi

- OWASP Web Security Testing Guide.
- OWASP Secure Code Review Cheat Sheet.
- OWASP Software Assurance Maturity Model.
- OWASP Java Security Cheat Sheet.
- OWASP Input Validation Cheat Sheet.
- OWASP Authorization Cheat Sheet.
- OWASP JSON Web Token for Java Cheat Sheet.
- OWASP File Upload Cheat Sheet.
- OWASP Secrets Management Cheat Sheet.
- OWASP Dependency-Check.
- OWASP Dependency-Track.
- OpenSSF SLSA Specification.
- CycloneDX SBOM Standard.
- NIST Secure Software Development Framework.
- NIST SP 800-53 security assessment/control concepts.
- NIST SP 800-92 for log management evidence context.

---

## 33. Status Seri

Seri ini **belum selesai**.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
Part 28 - selesai
Part 29 - selesai
Part 30 - selesai
Part 31 - selesai
Part 32 - berikutnya
Part 33 - belum
Part 34 - belum
```

Part berikutnya:

```text
Part 32 — Incident Response for Java Security Failures
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-030](./learn-java-security-cryptography-integrity-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-032.md](./learn-java-security-cryptography-integrity-part-032.md)
