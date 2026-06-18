# learn-java-security-cryptography-integrity-part-013

# X.509, PKI, Certificate Path Validation, Revocation

> Seri: Java Security, Cryptography, dan Integrity  
> Part: 13 dari 34  
> Status seri: belum selesai  
> Fokus: memahami bagaimana trust terhadap public key dibangun, divalidasi, dibatasi, dan dicabut dalam sistem Java.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- cryptographic primitive;
- symmetric encryption;
- MAC;
- digital signature;
- asymmetric encryption;
- key agreement;
- key management;
- Java KeyStore dan TrustStore.

Sekarang kita masuk ke lapisan yang sangat sering dipakai tetapi sering dipahami secara dangkal:

> X.509 certificate, Public Key Infrastructure, certificate chain, trust anchor, revocation, dan path validation.

Banyak engineer bisa menjalankan aplikasi dengan `https://`, memasukkan certificate ke truststore, atau membuat mTLS berjalan. Tetapi ketika terjadi error seperti:

```text
PKIX path building failed
unable to find valid certification path to requested target
Trust anchor for certification path not found
No subject alternative DNS name matching ...
Certificate expired
Certificate revoked
Algorithm constraints check failed
```

mereka sering hanya mencoba “import cert ke cacerts” tanpa memahami:

- certificate itu menyatakan apa;
- siapa yang menandatangani siapa;
- trust root-nya di mana;
- apakah chain lengkap;
- apakah certificate valid untuk purpose itu;
- apakah hostname cocok;
- apakah certificate sudah revoked;
- apakah algorithm masih boleh dipakai;
- apakah truststore terlalu luas;
- apakah trust boundary menjadi bocor.

Part ini membangun mental model agar kamu bisa membaca certificate chain seperti membaca dependency graph kepercayaan.

---

## 2. Problem yang Sering Salah Dipahami

### 2.1 Certificate Bukan “Public Key Saja”

Certificate memang membawa public key, tetapi makna utamanya adalah:

> public key ini dikaitkan dengan subject tertentu, untuk usage tertentu, dalam periode waktu tertentu, dan pernyataan itu ditandatangani oleh issuer tertentu.

Tanpa signature issuer, certificate hanyalah klaim sepihak.

Tanpa chain validation, certificate hanyalah dokumen yang belum dipercaya.

Tanpa hostname/service identity validation, certificate bisa valid secara cryptographic tetapi salah target.

Tanpa revocation checking, certificate bisa masih terlihat valid walaupun private key sudah bocor.

---

### 2.2 TrustStore Bukan Tempat Menaruh Semua Certificate

Kesalahan umum:

> “Kalau TLS error, import saja server certificate ke truststore.”

Ini sering membuat sistem tampak jalan, tetapi secara security bisa berbahaya.

Truststore sebaiknya berisi **trust anchor** atau CA yang memang kamu percayai untuk domain tertentu, bukan sembarang leaf certificate dari server yang kebetulan error.

Dalam beberapa kasus certificate pinning atau private PKI memang menggunakan leaf/intermediate tertentu, tetapi itu harus keputusan desain, bukan reflex debugging.

---

### 2.3 Certificate Chain Valid Belum Tentu Authorization Valid

Certificate menjawab:

> public key ini valid milik subject yang diidentifikasi certificate.

Ia tidak otomatis menjawab:

> subject ini boleh melakukan action X.

Dalam mTLS, certificate authentication harus dilanjutkan dengan authorization mapping:

- subject DN;
- SAN URI;
- SPIFFE ID;
- organization;
- certificate policy OID;
- issuing CA;
- certificate fingerprint;
- account mapping;
- environment mapping.

Tanpa mapping yang benar, kamu hanya tahu “dia punya certificate valid”, bukan “dia boleh memanggil API ini”.

---

### 2.4 Revocation Bukan Sekadar Expiry

Expiry menjawab:

> certificate melewati masa berlaku?

Revocation menjawab:

> certificate dicabut sebelum masa berlaku berakhir?

Certificate bisa belum expired tetapi sudah tidak boleh dipercaya karena:

- private key compromise;
- subject berubah ownership;
- employee/service decommissioned;
- CA salah issue;
- domain tidak lagi dikontrol;
- policy violation;
- intermediate CA compromise.

---

### 2.5 “PKIX Error” Bukan Satu Jenis Masalah

`PKIX path building failed` atau `CertPathValidatorException` adalah gejala. Penyebabnya bisa:

- missing intermediate certificate;
- trust anchor tidak ada;
- wrong truststore;
- chain order salah;
- expired certificate;
- not yet valid certificate;
- hostname mismatch;
- key usage mismatch;
- extended key usage mismatch;
- algorithm disabled;
- path length constraint violated;
- name constraints violated;
- revocation failure;
- corporate TLS interception CA tidak trusted;
- Java runtime memakai truststore berbeda dari yang dikira.

Senior engineer tidak berhenti di “import cert”, tetapi mencari **constraint mana yang gagal**.

---

## 3. Mental Model Utama

### 3.1 Certificate sebagai Signed Binding

X.509 certificate adalah signed statement:

```text
Issuer says:
  Subject owns this public key
  for these names/identities
  during this validity period
  for these usages
  under these policies/constraints.

Issuer proves this statement by signing it.
```

Secara konseptual:

```text
certificate = {
  subject_identity,
  subject_public_key,
  issuer_identity,
  validity_period,
  usage_constraints,
  extensions,
  signature_algorithm,
  issuer_signature
}
```

Yang divalidasi bukan hanya signature, tetapi juga constraints.

---

### 3.2 PKI sebagai Graph Kepercayaan

Public Key Infrastructure adalah mekanisme untuk membuat public key dapat dipercaya tanpa kamu harus mengenal semua public key secara langsung.

Model umum:

```text
Root CA
  signs Intermediate CA
    signs Leaf Certificate
```

Contoh chain:

```text
[Leaf: api.example.com]
    signed by
[Intermediate CA: Example TLS CA 2026]
    signed by
[Root CA: Example Root CA]
    trusted locally as trust anchor
```

Trust tidak muncul dari leaf certificate. Trust muncul karena:

1. ada chain signature yang valid;
2. chain berakhir pada trust anchor yang dipercaya lokal;
3. semua constraints terpenuhi;
4. certificate digunakan untuk purpose yang benar;
5. certificate belum expired dan belum revoked menurut policy;
6. identity target cocok dengan endpoint yang diakses.

---

### 3.3 Trust Anchor Adalah Keputusan Lokal

Root CA dipercaya bukan karena “lebih benar secara matematis”, tetapi karena runtime atau organisasi kamu menaruhnya sebagai trust anchor.

Trust anchor adalah local policy.

Implikasi:

- dua JVM berbeda bisa berbeda hasil validasinya;
- OS trust store dan Java trust store bisa berbeda;
- container image bisa punya CA bundle berbeda;
- private PKI harus diinstall eksplisit;
- truststore yang terlalu luas memperluas blast radius;
- truststore yang terlalu sempit menyebabkan integration failure.

---

### 3.4 Path Validation Adalah Constraint Solving

Certificate path validation bukan hanya “verify signature dari bawah ke atas”.

Ia adalah proses constraint solving:

```text
Apakah chain ini bisa membuktikan bahwa public key leaf valid untuk target identity dan purpose tertentu,
berdasarkan trust anchor lokal dan kebijakan validasi?
```

Yang dicek mencakup:

- signature setiap certificate;
- validity period;
- issuer-subject relationship;
- trust anchor;
- basic constraints;
- key usage;
- extended key usage;
- subject alternative name;
- name constraints;
- certificate policies;
- algorithm constraints;
- path length;
- revocation status jika enabled;
- critical extension support.

---

### 3.5 Certificate Authentication ≠ Business Authorization

Untuk mTLS internal service:

```text
TLS layer:
  certificate valid?
  chain trusted?
  client owns private key?
  SAN identity valid?

Application layer:
  service identity mapped?
  tenant allowed?
  action allowed?
  environment allowed?
  certificate policy allowed?
```

Jangan gabungkan semuanya menjadi “TLS sukses berarti boleh akses”.

TLS hanya membuktikan channel dan peer identity. Authorization tetap tanggung jawab aplikasi/platform.

---

## 4. Anatomy X.509 Certificate

X.509 certificate memiliki banyak field. Untuk engineer Java, field yang paling sering penting adalah berikut.

---

### 4.1 Version

Biasanya X.509 v3.

V3 penting karena mendukung extensions seperti:

- Subject Alternative Name;
- Key Usage;
- Extended Key Usage;
- Basic Constraints;
- Authority Key Identifier;
- Subject Key Identifier;
- CRL Distribution Points;
- Authority Information Access;
- Certificate Policies;
- Name Constraints.

---

### 4.2 Serial Number

Serial number unik per issuer.

Digunakan untuk:

- identifikasi certificate;
- revocation list;
- audit;
- troubleshooting;
- incident response.

Jangan menganggap serial number global unik di seluruh dunia. Ia unik dalam konteks issuer.

---

### 4.3 Signature Algorithm

Algorithm yang dipakai issuer untuk menandatangani certificate.

Contoh:

```text
SHA256withRSA
SHA384withECDSA
Ed25519
```

Risiko:

- SHA1withRSA legacy;
- MD5withRSA broken;
- RSA key terlalu kecil;
- algorithm disabled oleh JDK;
- mismatch dengan policy.

JDK modern memiliki algorithm constraints yang bisa menolak certificate walaupun secara historis pernah valid.

---

### 4.4 Issuer

Issuer adalah entity yang menandatangani certificate.

Contoh DN:

```text
CN=Example Intermediate CA, O=Example Trust Services, C=SG
```

Issuer harus cocok dengan subject certificate di atasnya dalam chain.

---

### 4.5 Validity Period

Berisi:

```text
notBefore
notAfter
```

Kesalahan umum:

- clock server salah;
- timezone mental model salah;
- certificate sudah expired;
- certificate belum valid;
- deployment lupa reload certificate baru;
- certificate file diganti tetapi JVM masih memegang old SSLContext.

Validity hanya satu syarat. Certificate yang belum expired tetap bisa invalid karena revoked atau constraint violation.

---

### 4.6 Subject

Subject adalah identity yang certificate klaim.

Dulu CN sering dipakai untuk hostname. Saat ini untuk TLS server identity, Subject Alternative Name adalah tempat utama validasi hostname.

Subject masih penting untuk:

- private PKI;
- mTLS identity mapping;
- legacy system;
- human/organization certificate;
- code signing;
- document signing;
- audit.

---

### 4.7 Subject Public Key Info

Berisi public key dan algorithm.

Contoh:

```text
RSA 2048/3072/4096
EC P-256/P-384
Ed25519
```

Public key ini yang akan dipakai untuk:

- TLS handshake;
- verify signature;
- encrypt key material dalam beberapa scheme lama;
- authenticate peer.

Certificate mengikat public key ini ke identity tertentu.

---

### 4.8 Subject Alternative Name

SAN adalah field utama untuk DNS/IP/URI/email identity.

Contoh:

```text
DNS: api.example.com
DNS: *.example.com
IP: 10.10.10.20
URI: spiffe://prod/ns/payment/sa/api
```

Untuk TLS server, hostname verification harus melihat SAN.

Kesalahan umum:

- certificate hanya punya CN, tidak punya SAN;
- SAN tidak cocok dengan hostname;
- IP access tetapi certificate hanya punya DNS SAN;
- wildcard terlalu luas;
- wildcard disalahpahami;
- internal service memakai certificate public domain yang tidak cocok.

---

### 4.9 Basic Constraints

Menentukan apakah certificate boleh menjadi CA.

Contoh:

```text
CA:TRUE
pathLenConstraint:0
```

Leaf certificate harus `CA:FALSE`.

Jika certificate bukan CA tetapi dipakai untuk sign certificate lain, chain harus ditolak.

---

### 4.10 Key Usage

Membatasi penggunaan key.

Contoh bit:

```text
digitalSignature
keyEncipherment
keyAgreement
keyCertSign
cRLSign
nonRepudiation/contentCommitment
```

Makna praktis:

- CA certificate butuh `keyCertSign`;
- CRL signer butuh `cRLSign`;
- TLS server biasanya butuh usage yang sesuai handshake;
- document signing butuh digital signature/content commitment sesuai policy.

Jika key usage tidak cocok, certificate harus dianggap salah purpose.

---

### 4.11 Extended Key Usage

Membatasi purpose lebih spesifik.

Contoh:

```text
serverAuth
clientAuth
codeSigning
emailProtection
timeStamping
OCSPSigning
```

Untuk TLS server certificate, EKU biasanya harus mengizinkan `serverAuth`.

Untuk mTLS client certificate, EKU biasanya harus mengizinkan `clientAuth`.

Kesalahan umum:

- memakai server certificate sebagai client certificate;
- memakai client certificate sebagai signing certificate;
- private CA mengeluarkan certificate tanpa EKU jelas;
- aplikasi tidak memeriksa EKU saat custom validation.

---

### 4.12 Subject Key Identifier dan Authority Key Identifier

SKI dan AKI membantu mencocokkan certificate dengan issuer-nya.

```text
Leaf AKI -> Intermediate SKI
Intermediate AKI -> Root SKI
```

Ini membantu path building, terutama ketika ada banyak intermediate CA dengan subject mirip.

---

### 4.13 CRL Distribution Points

Menunjukkan lokasi CRL.

Contoh:

```text
http://crl.example-ca.com/example.crl
```

Jika revocation checking memakai CRL, validator bisa mengambil daftar certificate yang dicabut dari sini, tergantung konfigurasi.

---

### 4.14 Authority Information Access

AIA bisa berisi:

- OCSP responder URL;
- issuer certificate URL.

Contoh:

```text
OCSP: http://ocsp.example-ca.com
CA Issuers: http://crt.example-ca.com/intermediate.crt
```

Beberapa client bisa menggunakan AIA untuk mengambil missing intermediate atau OCSP, tergantung implementasi dan konfigurasi.

Dalam production Java, jangan bergantung buta pada runtime fetching jika environment egress dibatasi. Lebih aman deploy chain lengkap.

---

### 4.15 Critical Extensions

X.509 extension bisa ditandai critical.

Rule penting:

> jika validator menemukan critical extension yang tidak dipahami, certificate harus ditolak.

Ini mencegah certificate dengan constraint penting dianggap valid oleh client yang tidak memahami constraint tersebut.

---

## 5. Certificate Chain

### 5.1 Leaf, Intermediate, Root

```text
Leaf certificate:
  - dipakai endpoint/service/user
  - berisi subject public key
  - bukan CA

Intermediate CA:
  - menandatangani leaf atau intermediate lain
  - CA:TRUE
  - biasanya tidak menjadi trust anchor langsung di public WebPKI

Root CA:
  - self-signed
  - dipercaya sebagai trust anchor lokal
  - private key sangat sensitif
```

---

### 5.2 Kenapa Intermediate Ada?

Intermediate CA mengurangi risiko root CA.

Root CA idealnya jarang online. Intermediate yang lebih operasional digunakan untuk issuing certificate.

Jika intermediate compromise:

- root dapat revoke intermediate;
- blast radius lebih terbatas;
- root tidak harus diganti semua client.

---

### 5.3 Chain yang Dikirim Server

Dalam TLS, server biasanya mengirim:

```text
leaf + intermediate(s)
```

Root biasanya tidak perlu dikirim karena client sudah punya root di truststore.

Kesalahan umum:

```text
server only sends leaf
```

Akibat:

```text
PKIX path building failed
unable to find valid certification path
```

Fix yang benar sering bukan import leaf ke client truststore, tetapi deploy full chain di server.

---

### 5.4 Chain Order

Beberapa server/client toleran terhadap chain order, tetapi jangan bergantung pada itu.

Urutan aman:

```text
leaf first
intermediate next
higher intermediate next
root optional, usually omitted
```

---

### 5.5 Cross-Signed Certificate

CA bisa cross-sign root/intermediate untuk compatibility.

Akibatnya path building bisa punya lebih dari satu kemungkinan path.

Contoh konseptual:

```text
Leaf
  -> Intermediate A
      -> Root Old
      -> Root New
```

Validator bisa memilih path berbeda tergantung truststore dan algorithm constraints.

Ini penting saat migrasi root CA atau saat certificate tampak “valid di browser” tetapi gagal di JVM lama.

---

## 6. Trust Model

### 6.1 Public WebPKI

Digunakan untuk public HTTPS.

Trust anchor berasal dari CA root yang dipilih oleh platform/browser/JDK.

Karakteristik:

- cocok untuk public domain;
- trust anchor banyak;
- CA mana pun dalam truststore bisa issue untuk nama domain jika validation lolos;
- subject identity biasanya DNS name;
- certificate transparency relevan;
- domain control validation penting.

---

### 6.2 Private PKI

Digunakan internal enterprise.

Contoh:

```text
Corporate Root CA
  -> Internal Service Intermediate CA
      -> service certificates
```

Karakteristik:

- trust anchor dikontrol organisasi;
- bisa memasukkan custom identity seperti URI SAN;
- cocok untuk mTLS service mesh/internal API;
- perlu lifecycle management sendiri;
- perlu revocation/rotation policy sendiri;
- root private key harus sangat dijaga.

---

### 6.3 Self-Signed Certificate

Self-signed certificate menandatangani dirinya sendiri.

Ini tidak otomatis buruk. Root CA biasanya self-signed.

Yang buruk adalah:

- memakai self-signed leaf tanpa distribusi trust yang jelas;
- disable validation;
- `TrustAllManager`;
- hanya “accept all certificates” di production.

Self-signed bisa aman jika diperlakukan sebagai trust anchor eksplisit dengan fingerprint/pinning dan lifecycle jelas. Tetapi untuk kebanyakan enterprise system, private CA lebih manageable.

---

### 6.4 Certificate Pinning

Pinning berarti client membatasi trust pada certificate/public key/CA tertentu, bukan seluruh truststore umum.

Jenis pinning:

```text
leaf certificate pin
subject public key info pin
intermediate CA pin
private root CA pin
```

Trade-off:

| Pin Type | Security | Operational Risk |
|---|---:|---:|
| Leaf certificate pin | tinggi | sangat tinggi saat rotation |
| Public key pin | tinggi | tinggi |
| Intermediate pin | sedang-tinggi | sedang |
| Private root pin | tergantung CA control | lebih manageable |

Pinning bisa melindungi dari CA yang salah issue, tetapi bisa menyebabkan outage jika rotation tidak disiapkan. Untuk mobile/client hostile network, pinning sering relevan. Untuk backend-to-backend, private PKI/mTLS policy sering lebih baik.

---

## 7. Certificate Path Validation di Java

### 7.1 API Utama

Java menyediakan package:

```java
java.security.cert
```

Class penting:

```java
X509Certificate
CertificateFactory
CertPath
CertPathValidator
CertPathBuilder
PKIXParameters
PKIXBuilderParameters
TrustAnchor
CertStore
PKIXCertPathValidatorResult
CertPathValidatorException
```

Mental model:

```text
CertificateFactory:
  parse certificate

CertPath:
  ordered chain to validate

TrustAnchor:
  root/local CA trusted by policy

PKIXParameters:
  validation policy and trust anchors

CertPathValidator:
  validate existing path

CertPathBuilder:
  try to build path from target cert to trust anchor
```

---

### 7.2 Validate Existing Chain

Konsep:

```java
CertificateFactory cf = CertificateFactory.getInstance("X.509");

List<X509Certificate> chain = List.of(
    leafCert,
    intermediateCert
);

CertPath certPath = cf.generateCertPath(chain);

Set<TrustAnchor> trustAnchors = Set.of(
    new TrustAnchor(rootCert, null)
);

PKIXParameters params = new PKIXParameters(trustAnchors);
params.setRevocationEnabled(false); // example only; decide by policy

CertPathValidator validator = CertPathValidator.getInstance("PKIX");

PKIXCertPathValidatorResult result =
    (PKIXCertPathValidatorResult) validator.validate(certPath, params);
```

Catatan:

- chain tidak memasukkan trust anchor sebagai bagian path dalam banyak use case;
- trust anchor disediakan melalui `PKIXParameters`;
- validation failure menghasilkan exception;
- `setRevocationEnabled(false)` bukan rekomendasi umum, hanya menyederhanakan contoh; production harus punya policy eksplisit.

---

### 7.3 Build Chain

Jika kamu punya leaf dan beberapa candidate intermediate/root, kamu bisa meminta Java membangun path.

Konsep:

```java
X509CertSelector target = new X509CertSelector();
target.setCertificate(leafCert);

Set<TrustAnchor> trustAnchors = Set.of(new TrustAnchor(rootCert, null));

PKIXBuilderParameters params =
    new PKIXBuilderParameters(trustAnchors, target);

Collection<X509Certificate> candidates = List.of(
    leafCert,
    intermediateCert
);

CertStore store = CertStore.getInstance(
    "Collection",
    new CollectionCertStoreParameters(candidates)
);

params.addCertStore(store);
params.setRevocationEnabled(false);

CertPathBuilder builder = CertPathBuilder.getInstance("PKIX");
PKIXCertPathBuilderResult result =
    (PKIXCertPathBuilderResult) builder.build(params);
```

`CertPathBuilder` berguna untuk tooling, diagnostics, dan custom PKI workflows.

Dalam TLS normal, JSSE melakukan path validation melalui trust manager.

---

### 7.4 PKIX Validation Inputs

Validasi PKIX memerlukan:

```text
target certificate
candidate chain/intermediates
trust anchors
validation date
revocation policy
algorithm constraints
name/policy constraints
usage requirements
```

Jika salah satu input salah, hasil bisa berbeda.

Debugging harus selalu bertanya:

1. truststore mana yang dipakai?
2. chain apa yang diterima?
3. validation date apa?
4. revocation enabled atau tidak?
5. endpoint identity yang dicek apa?
6. algorithm constraints dari JDK apa?
7. key usage/EKU cocok atau tidak?

---

### 7.5 Validation Date

Validasi bisa dilakukan terhadap waktu tertentu.

Contoh use case:

- verify historical signed document;
- audit evidence;
- timestamped signature;
- forensic validation.

Untuk TLS, biasanya waktu sekarang.

Untuk legal/evidence signing, waktu validasi sering lebih kompleks:

```text
Signature time
Timestamp authority time
Certificate validity at signing time
Revocation status at signing time
Long-term validation evidence
```

Jangan menyamakan TLS certificate validation dengan document signature validation.

---

## 8. Hostname Verification

### 8.1 Chain Valid Tidak Cukup

TLS server certificate harus cocok dengan hostname yang diminta.

Contoh:

```text
Client connects to:
  https://api.payment.internal

Certificate SAN:
  DNS: api.case.internal
```

Chain mungkin valid, tetapi identity salah. Harus ditolak.

---

### 8.2 SAN Matching

Modern hostname verification menggunakan SAN.

Contoh valid:

```text
Host: api.example.com
SAN: DNS:api.example.com
```

Wildcard:

```text
Host: api.example.com
SAN: DNS:*.example.com
```

Biasanya cocok untuk satu label saja:

```text
*.example.com matches api.example.com
*.example.com does not match x.y.example.com
```

Risiko:

- wildcard terlalu luas;
- wildcard di internal domain;
- SAN berisi domain yang tidak perlu;
- certificate reuse lintas environment.

---

### 8.3 IP Address Matching

Jika client connect ke IP:

```text
https://10.10.10.20
```

Certificate harus punya IP SAN:

```text
IP:10.10.10.20
```

DNS SAN `10.10.10.20` bukan hal yang sama secara semantik.

Lebih baik gunakan DNS service name daripada IP literal.

---

### 8.4 Jangan Disable Hostname Verification

Anti-pattern:

```java
HostnameVerifier allHostsValid = (hostname, session) -> true;
```

Ini membuat TLS kehilangan peer identity validation.

Akibat:

- MITM lebih mudah;
- certificate untuk domain lain diterima;
- corporate proxy atau attacker dengan cert valid untuk nama lain bisa lewat;
- security review harus reject kecuali untuk isolated testing.

Jika perlu custom hostname verification, implementasikan allowlist identity yang eksplisit, bukan accept all.

---

## 9. Key Usage dan Extended Key Usage di TLS/mTLS

### 9.1 TLS Server Certificate

Umumnya butuh:

```text
SAN: DNS/IP target
EKU: serverAuth
KeyUsage: digitalSignature and/or keyEncipherment/keyAgreement depending algorithm/TLS version
```

Di TLS 1.3, handshake lebih menekankan signature untuk authentication. Tetapi compatibility dan provider behavior masih perlu diperhatikan.

---

### 9.2 TLS Client Certificate

Untuk mTLS:

```text
EKU: clientAuth
SAN/Subject: service/client identity
KeyUsage: digitalSignature
```

Server harus:

1. validate chain;
2. verify client owns private key melalui TLS;
3. check certificate purpose;
4. map identity ke principal;
5. authorize action.

---

### 9.3 CA Certificate

CA certificate harus punya:

```text
BasicConstraints: CA:TRUE
KeyUsage: keyCertSign
```

Jika CA digunakan untuk sign CRL:

```text
KeyUsage: cRLSign
```

---

### 9.4 EKU Missing

EKU absence bisa interpreted berbeda tergantung library/policy. Dalam enterprise/private PKI, lebih baik eksplisit.

Policy yang baik:

```text
server certificate must include serverAuth
client certificate must include clientAuth
signing certificate must include appropriate signing EKU/policy
```

Eksplisit lebih aman daripada “kalau tidak ada berarti boleh semua”.

---

## 10. Revocation

### 10.1 Kenapa Revocation Dibutuhkan?

Certificate bisa harus dicabut sebelum expired.

Contoh:

```text
private key leak
service decommissioned
employee resigned
domain ownership changed
CA mis-issued certificate
environment compromised
certificate issued with wrong SAN
```

Jika revocation tidak dicek, client bisa tetap menerima certificate sampai `notAfter`.

---

### 10.2 CRL

Certificate Revocation List adalah daftar certificate yang dicabut oleh CA.

Kelebihan:

- bisa di-cache;
- cocok untuk offline/batch validation;
- simple model;
- useful untuk private PKI.

Kekurangan:

- CRL bisa besar;
- freshness bergantung update interval;
- perlu distribusi;
- client harus fetch/cache;
- fail-open/fail-closed decision sulit.

---

### 10.3 OCSP

Online Certificate Status Protocol memungkinkan client bertanya status certificate tertentu ke responder.

Status umum:

```text
good
revoked
unknown
```

Kelebihan:

- lebih granular daripada download CRL besar;
- bisa lebih fresh;
- umum di TLS ecosystem.

Kekurangan:

- privacy leak ke responder;
- latency;
- availability dependency;
- fail-open risk;
- responder outage bisa memengaruhi service.

---

### 10.4 OCSP Stapling

Server menyertakan OCSP response yang sudah ditandatangani CA/responder saat handshake.

Keuntungan:

- client tidak perlu langsung query OCSP responder;
- mengurangi latency;
- lebih baik dari sisi privacy;
- mengurangi dependency client egress.

Tetapi stapling harus dikonfigurasi dan dimonitor.

---

### 10.5 Revocation di Java

Java PKIX validation mendukung revocation checking melalui `PKIXParameters`.

Konsep:

```java
PKIXParameters params = new PKIXParameters(trustAnchors);
params.setRevocationEnabled(true);
```

Untuk OCSP, Java juga memiliki security properties seperti:

```text
ocsp.enable
ocsp.responderURL
```

Namun behavior detail bisa bergantung versi JDK, provider, dan konfigurasi JSSE.

Prinsip production:

- tentukan policy revocation eksplisit;
- jangan mengira default sudah sesuai kebutuhan;
- test revoked certificate;
- test responder down;
- tentukan fail-open vs fail-closed;
- monitor freshness CRL/OCSP;
- dokumentasikan environment network egress.

---

### 10.6 Fail-Open vs Fail-Closed

Jika revocation status tidak bisa dicek:

```text
fail-open:
  tetap menerima certificate

fail-closed:
  tolak certificate
```

Trade-off:

| Mode | Availability | Security |
|---|---:|---:|
| Fail-open | tinggi | lebih lemah |
| Fail-closed | lebih rentan outage | lebih kuat |

Untuk public web browsing, fail-open historis sering dipakai karena availability. Untuk high-assurance enterprise/mTLS/regulatory systems, fail-closed mungkin lebih tepat, tetapi harus ada desain availability untuk OCSP/CRL.

---

## 11. Java TrustManager dan JSSE

### 11.1 TrustManager Role

Dalam JSSE, trust manager menentukan apakah peer certificate dipercaya.

Untuk X.509, class utama:

```java
X509TrustManager
X509ExtendedTrustManager
TrustManagerFactory
```

Flow konseptual TLS client:

```text
Server sends certificate chain
JSSE invokes TrustManager
TrustManager validates chain against truststore/policy
HostnameVerifier checks endpoint identity
Handshake succeeds only if checks pass
```

Untuk server dengan mTLS:

```text
Client sends certificate chain
Server-side TrustManager validates client certificate
Application maps client identity to principal
Application authorizes action
```

---

### 11.2 TrustManagerFactory

Umumnya kamu membuat trust manager dari truststore:

```java
KeyStore trustStore = KeyStore.getInstance("PKCS12");

try (InputStream in = Files.newInputStream(Path.of("truststore.p12"))) {
    trustStore.load(in, password);
}

TrustManagerFactory tmf = TrustManagerFactory.getInstance(
    TrustManagerFactory.getDefaultAlgorithm()
);

tmf.init(trustStore);

SSLContext ctx = SSLContext.getInstance("TLS");
ctx.init(null, tmf.getTrustManagers(), null);
```

Catatan:

- gunakan `PKCS12` untuk portability modern;
- jangan hardcode password di source;
- jangan pakai default truststore tanpa sadar;
- jangan menggabungkan semua CA internal ke semua service jika trust boundary berbeda.

---

### 11.3 X509ExtendedTrustManager

`X509ExtendedTrustManager` menyediakan context tambahan:

- `Socket`;
- `SSLEngine`.

Ini berguna untuk validation yang membutuhkan connection context.

Tetapi hati-hati: custom trust manager sering menjadi sumber vulnerability.

---

### 11.4 Anti-Pattern: Trust-All Manager

Anti-pattern fatal:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Ini bukan “sementara aman”.

Ini menghapus certificate validation.

Dampak:

- MITM diterima;
- self-signed attacker diterima;
- expired certificate diterima;
- revoked certificate diterima;
- wrong issuer diterima;
- wrong purpose bisa diterima;
- trust boundary runtuh.

Testing boleh menggunakan local CA eksplisit, bukan trust-all.

---

### 11.5 Anti-Pattern: Custom TrustManager yang Tidak Delegate

Jika butuh custom logic, biasanya pattern yang lebih aman:

```text
default PKIX validation dulu
lalu custom additional checks
```

Bukan mengganti semua validasi.

Konsep:

```java
final X509TrustManager delegate = ...;

class AdditionalPolicyTrustManager extends X509ExtendedTrustManager {
    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket)
        throws CertificateException {

        delegate.checkServerTrusted(chain, authType);

        // additional checks:
        // - allowed issuing CA
        // - required SAN URI
        // - required EKU
        // - environment policy
    }
}
```

Rule:

> Custom trust manager boleh memperketat, bukan melonggarkan tanpa alasan formal.

---

## 12. Certificate Identity untuk mTLS Internal Service

### 12.1 DN-Based Identity

Contoh subject DN:

```text
CN=payment-service, OU=backend, O=ExampleCorp, C=SG
```

Masalah:

- parsing DN tricky;
- ordering/escaping bisa membingungkan;
- CN legacy;
- OU/O sering tidak cukup strict;
- rename organisasi bisa memengaruhi identity.

DN bisa dipakai, tetapi lebih baik jika policy jelas.

---

### 12.2 DNS SAN Identity

Contoh:

```text
DNS: payment-service.prod.internal
```

Cocok untuk service yang addressable by DNS.

Risiko:

- service identity bercampur dengan network name;
- DNS rename memengaruhi identity;
- wildcard risk;
- environment confusion.

---

### 12.3 URI SAN Identity

Contoh:

```text
URI: spiffe://prod/ns/payment/sa/api
```

Bagus untuk workload identity.

Keuntungan:

- tidak harus sama dengan DNS;
- bisa encode environment, namespace, service account;
- cocok untuk service mesh / workload identity.

---

### 12.4 Certificate Fingerprint Identity

Mapping berdasarkan fingerprint:

```text
SHA-256 fingerprint -> service principal
```

Keuntungan:

- sangat spesifik.

Kekurangan:

- rotation sulit;
- setiap certificate baru perlu mapping;
- outage risk jika lupa update;
- tidak scalable.

Cocok untuk high-control narrow integration, bukan general platform identity.

---

### 12.5 Issuer-Based Policy

Dalam private PKI, identity sering dikombinasikan dengan issuer policy:

```text
Accept only client certificates:
  issued by Internal Service Intermediate CA
  with EKU clientAuth
  with URI SAN prefix spiffe://prod/
  with non-expired certificate
  with revocation good
```

Ini lebih kuat daripada hanya “chain trusted”.

---

## 13. Certificate Policy OID dan Enterprise Governance

Certificate bisa memiliki policy OID.

Contoh konseptual:

```text
1.2.3.4.5.100 = production service identity
1.2.3.4.5.101 = staging service identity
1.2.3.4.5.200 = document signing
1.2.3.4.5.300 = human authentication
```

Policy OID membantu membedakan:

- certificate untuk TLS server;
- certificate untuk TLS client;
- certificate untuk document signing;
- certificate untuk code signing;
- certificate untuk non-repudiation;
- certificate untuk test environment;
- certificate untuk production.

Dalam high-assurance system, policy OID bisa menjadi bagian authorization decision.

---

## 14. Certificate Expiry Management

### 14.1 Expiry Adalah Reliability dan Security Risk

Certificate expiry sering menyebabkan outage.

Security impact:

- expired certificate harus ditolak;
- emergency fix sering menyebabkan insecure workaround;
- trust-all sering muncul saat panik;
- manual import ke truststore tanpa governance.

Reliability impact:

- TLS handshake gagal;
- mTLS antar service gagal;
- message broker client gagal;
- webhook callback gagal;
- batch file transfer gagal;
- CI/CD deployment gagal.

---

### 14.2 Expiry Inventory

Untuk enterprise Java platform, buat inventory:

```text
Certificate inventory:
  - alias
  - environment
  - owner
  - subject
  - SAN
  - issuer
  - serial
  - fingerprint
  - notBefore
  - notAfter
  - key algorithm
  - signature algorithm
  - usage
  - truststore/keystore location
  - reload mechanism
  - rotation owner
```

---

### 14.3 Monitoring

Monitor:

- days to expiry;
- chain completeness;
- revoked status;
- weak algorithm;
- wrong SAN;
- missing EKU;
- truststore drift;
- certificate deployed but not active;
- active certificate but not in inventory.

Alert thresholds:

```text
90 days: planning
60 days: owner confirmation
30 days: urgent
14 days: escalation
7 days: incident risk
```

---

### 14.4 Reload Without Restart

Java services sering memuat SSLContext saat startup.

Jika certificate file diganti, aplikasi belum tentu reload.

Design options:

1. restart service after cert update;
2. reloadable SSLContext;
3. sidecar/proxy handles TLS;
4. service mesh certificate rotation;
5. short-lived cert automation.

Jangan menganggap mengganti file `.p12` otomatis mengganti certificate di memory.

---

## 15. Common Java PKIX Errors

### 15.1 `unable to find valid certification path to requested target`

Kemungkinan:

- root CA tidak trusted;
- intermediate missing;
- wrong truststore;
- JVM memakai default cacerts berbeda;
- server tidak mengirim full chain;
- corporate proxy certificate tidak trusted;
- private CA belum diinstall.

Checklist:

```text
1. Capture server chain.
2. Check chain completeness.
3. Identify issuer of leaf.
4. Verify intermediate exists.
5. Verify root/intermediate trust anchor in truststore.
6. Check JVM truststore path.
7. Check container image CA.
8. Avoid importing leaf as blind fix.
```

---

### 15.2 `PKIX path building failed`

Mirip dengan error di atas, tetapi terjadi saat path builder gagal menemukan path ke trust anchor.

Check:

- candidate intermediates;
- trust anchor;
- AIA fetching;
- chain order;
- cross-signed path;
- disabled algorithms.

---

### 15.3 `Trust anchor for certification path not found`

Artinya path tidak berakhir pada trust anchor yang dipercaya lokal.

Fix:

- install correct root/intermediate CA sebagai trust anchor sesuai policy;
- gunakan truststore benar;
- jangan trust-all.

---

### 15.4 `No subject alternative DNS name matching`

Hostname tidak cocok dengan SAN.

Fix benar:

- issue ulang certificate dengan SAN yang benar;
- akses endpoint memakai DNS yang ada di SAN;
- jangan disable hostname verification.

---

### 15.5 `Algorithm constraints check failed`

JDK menolak algorithm/key karena policy.

Contoh penyebab:

- SHA-1;
- MD5;
- RSA key terlalu kecil;
- disabled curve;
- old TLS protocol;
- certificate signed dengan algorithm deprecated.

Fix benar:

- reissue certificate dengan algorithm modern;
- upgrade CA profile;
- jangan menurunkan security properties kecuali compatibility temporary yang disetujui formal.

---

### 15.6 `CertificateExpiredException`

Certificate expired.

Fix:

- rotate certificate;
- verify deployment;
- restart/reload SSLContext;
- update chain if needed;
- add monitoring.

Jangan set system clock mundur.

---

### 15.7 `CertificateNotYetValidException`

Certificate belum masuk `notBefore`.

Penyebab:

- clock skew;
- certificate generated untuk future;
- timezone misunderstanding;
- NTP issue.

Fix:

- correct NTP;
- issue certificate dengan valid window benar;
- jangan bypass validation.

---

## 16. Certificate Validation untuk Signed Document dan Audit Evidence

TLS validation dan evidence validation berbeda.

TLS:

```text
validate certificate now
for endpoint identity
for secure channel
```

Document/evidence signing:

```text
validate signature over document
validate certificate was valid at signing time
validate timestamp
validate revocation status at or near signing time
retain proof material
```

Untuk audit/legal defensibility, kamu perlu:

- signed payload canonicalization;
- signing certificate chain;
- timestamp token;
- revocation evidence;
- certificate policy;
- signer identity mapping;
- retention of validation material.

Jangan hanya menyimpan “signature valid saat dicek hari ini” tanpa context.

---

## 17. Certificate Transparency Awareness

Untuk public TLS, Certificate Transparency membantu mendeteksi mis-issued certificate.

Sebagai Java backend engineer, kamu biasanya tidak mengimplementasikan CT validation sendiri kecuali domain tertentu. Tetapi kamu perlu paham operational value:

- monitor certificate issued untuk domain organisasi;
- detect unexpected CA issuance;
- detect shadow IT certificate;
- support incident response.

Untuk private PKI internal, CT biasanya tidak digunakan. Kamu butuh inventory dan issuance audit sendiri.

---

## 18. Name Constraints

Name constraints membatasi CA hanya boleh issue untuk namespace tertentu.

Contoh:

```text
Permitted DNS:
  .internal.example.com
```

Jika intermediate CA punya name constraints, leaf di luar constraint harus ditolak.

Ini berguna untuk delegated CA.

Risiko:

- client tidak mendukung/berbeda interpretasi;
- critical extension issue;
- misconfiguration menyebabkan outage;
- tidak semua enterprise PKI memakai dengan benar.

---

## 19. Path Length Constraints

Path length membatasi berapa CA di bawah certificate tersebut.

Contoh:

```text
Root CA
  pathLen: 1

Intermediate A
  pathLen: 0

Leaf
```

Jika Intermediate A membuat subordinate CA lagi, path bisa invalid.

Ini mencegah uncontrolled delegated CA chain.

---

## 20. Algorithm Agility dan Certificate Migration

### 20.1 Jangan Mengikat Desain ke Satu Algorithm

Hari ini kamu mungkin memakai:

```text
RSA 2048/3072
ECDSA P-256/P-384
Ed25519
SHA-256/SHA-384
```

Besok bisa berubah karena:

- algorithm deprecated;
- compliance requirement;
- JDK disabled algorithm update;
- CA policy update;
- post-quantum transition;
- performance need.

Desain harus mendukung:

- multiple algorithms;
- certificate rotation;
- trust anchor migration;
- dual chain;
- metadata versioning;
- telemetry.

---

### 20.2 RSA ke ECDSA/EdDSA

Migration concern:

- client compatibility;
- provider support;
- FIPS mode;
- hardware support;
- certificate chain support;
- TLS cipher suite;
- monitoring.

Jangan hanya ganti certificate algorithm tanpa test compatibility.

---

### 20.3 Post-Quantum Awareness

X.509 dan PKI ecosystem akan terdampak post-quantum transition.

Sebagai Java engineer, sekarang yang perlu disiapkan:

- jangan hardcode algorithm assumptions;
- simpan metadata algorithm;
- buat validation dan signing abstraction;
- support versioned certificate policy;
- monitor JDK/provider support;
- pahami hybrid transition kemungkinan akan terjadi;
- jangan membuat custom PQC sebelum ecosystem matang.

---

## 21. Secure Private PKI Design untuk Java Platform

### 21.1 Root CA

Root CA sebaiknya:

- offline atau highly protected;
- key generated in HSM/offline secure ceremony;
- long validity tapi protected;
- hanya sign intermediate;
- punya documented key ceremony;
- punya disaster recovery;
- punya compromise response plan.

---

### 21.2 Intermediate CA

Pisahkan intermediate berdasarkan usage:

```text
Internal TLS Server CA
Internal TLS Client CA
Document Signing CA
Code Signing CA
Test Environment CA
Development CA
```

Jangan gunakan satu intermediate untuk semua.

Keuntungan:

- blast radius lebih kecil;
- policy lebih jelas;
- revocation lebih manageable;
- audit lebih mudah;
- truststore bisa lebih sempit.

---

### 21.3 Environment Separation

Jangan biarkan dev/staging certificate dipercaya production.

Contoh policy:

```text
Production service only trusts:
  Production Internal Service Client CA

Staging service trusts:
  Staging Internal Service Client CA

Dev service trusts:
  Dev Internal Service Client CA
```

Anti-pattern:

```text
one corporate root trusted everywhere
all environments accepted everywhere
```

Ini memperluas lateral movement.

---

### 21.4 Usage Separation

Jangan reuse certificate/key untuk:

- TLS server;
- TLS client;
- document signing;
- code signing;
- JWT signing;
- database connection;
- SFTP;
- admin access.

Setiap usage memiliki risk, audit, rotation, dan policy berbeda.

---

## 22. Java Implementation Patterns

### 22.1 Load X.509 Certificate

```java
static X509Certificate loadX509Certificate(Path path) throws Exception {
    CertificateFactory factory = CertificateFactory.getInstance("X.509");

    try (InputStream input = Files.newInputStream(path)) {
        return (X509Certificate) factory.generateCertificate(input);
    }
}
```

---

### 22.2 Print Useful Certificate Metadata

```java
static void printCertificateSummary(X509Certificate cert) throws Exception {
    System.out.println("Subject: " + cert.getSubjectX500Principal());
    System.out.println("Issuer: " + cert.getIssuerX500Principal());
    System.out.println("Serial: " + cert.getSerialNumber().toString(16));
    System.out.println("Not before: " + cert.getNotBefore());
    System.out.println("Not after: " + cert.getNotAfter());
    System.out.println("Sig alg: " + cert.getSigAlgName());
    System.out.println("Public key alg: " + cert.getPublicKey().getAlgorithm());
    System.out.println("Basic constraints: " + cert.getBasicConstraints());
    System.out.println("Key usage: " + Arrays.toString(cert.getKeyUsage()));
    System.out.println("Extended key usage: " + cert.getExtendedKeyUsage());
    System.out.println("SAN: " + cert.getSubjectAlternativeNames());
}
```

Catatan:

- `getSubjectAlternativeNames()` bisa throw `CertificateParsingException`;
- key usage array position harus dipetakan sesuai X.509 bit;
- jangan log certificate private key; certificate public umumnya aman, tetapi metadata bisa tetap sensitif dalam beberapa environment.

---

### 22.3 Calculate Certificate Fingerprint

```java
static String sha256Fingerprint(X509Certificate cert) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(cert.getEncoded());

    StringBuilder builder = new StringBuilder(hash.length * 3);
    for (int i = 0; i < hash.length; i++) {
        if (i > 0) {
            builder.append(':');
        }
        builder.append(String.format("%02X", hash[i]));
    }
    return builder.toString();
}
```

Use cases:

- inventory;
- audit;
- diagnostics;
- pinning;
- incident response.

Jangan menggunakan fingerprint sebagai satu-satunya identity mapping jika rotation sering.

---

### 22.4 Check Expiry Programmatically

```java
static void checkValidity(X509Certificate cert, Instant at) throws CertificateException {
    cert.checkValidity(Date.from(at));
}
```

Untuk inventory:

```java
long daysRemaining = ChronoUnit.DAYS.between(
    Instant.now(),
    cert.getNotAfter().toInstant()
);
```

---

### 22.5 Extract DNS SAN

```java
static List<String> dnsSubjectAlternativeNames(X509Certificate cert)
    throws CertificateParsingException {

    Collection<List<?>> names = cert.getSubjectAlternativeNames();
    if (names == null) {
        return List.of();
    }

    List<String> result = new ArrayList<>();

    for (List<?> entry : names) {
        Integer type = (Integer) entry.get(0);
        Object value = entry.get(1);

        // GeneralName type 2 = dNSName
        if (type == 2 && value instanceof String dns) {
            result.add(dns);
        }
    }

    return List.copyOf(result);
}
```

Catatan:

- IP SAN punya type berbeda;
- URI SAN punya type berbeda;
- jangan parse text output `openssl` untuk logic aplikasi.

---

### 22.6 Build SSLContext dengan Explicit TrustStore

```java
static SSLContext buildClientSslContext(
    Path trustStorePath,
    char[] trustStorePassword
) throws Exception {

    KeyStore trustStore = KeyStore.getInstance("PKCS12");

    try (InputStream in = Files.newInputStream(trustStorePath)) {
        trustStore.load(in, trustStorePassword);
    }

    TrustManagerFactory tmf = TrustManagerFactory.getInstance(
        TrustManagerFactory.getDefaultAlgorithm()
    );
    tmf.init(trustStore);

    SSLContext sslContext = SSLContext.getInstance("TLS");
    sslContext.init(null, tmf.getTrustManagers(), SecureRandom.getInstanceStrong());

    return sslContext;
}
```

Prinsip:

- explicit lebih auditable daripada default implicit;
- password jangan hardcode;
- per-service truststore lebih baik daripada global truststore besar;
- observability harus tahu truststore path dan version.

---

### 22.7 mTLS SSLContext dengan Keystore dan Truststore

```java
static SSLContext buildMtlsClientSslContext(
    Path keyStorePath,
    char[] keyStorePassword,
    char[] keyPassword,
    Path trustStorePath,
    char[] trustStorePassword
) throws Exception {

    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(keyStorePath)) {
        keyStore.load(in, keyStorePassword);
    }

    KeyManagerFactory kmf = KeyManagerFactory.getInstance(
        KeyManagerFactory.getDefaultAlgorithm()
    );
    kmf.init(keyStore, keyPassword);

    KeyStore trustStore = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(trustStorePath)) {
        trustStore.load(in, trustStorePassword);
    }

    TrustManagerFactory tmf = TrustManagerFactory.getInstance(
        TrustManagerFactory.getDefaultAlgorithm()
    );
    tmf.init(trustStore);

    SSLContext sslContext = SSLContext.getInstance("TLS");
    sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);

    return sslContext;
}
```

Security review questions:

- apakah keystore berisi private key yang benar?
- apakah truststore hanya berisi CA yang perlu?
- apakah client certificate punya EKU `clientAuth`?
- apakah server certificate punya SAN benar?
- apakah rotation path tersedia?
- apakah private key file permission aman?
- apakah password masuk log?
- apakah cert reload butuh restart?

---

## 23. Diagnostics Tools

### 23.1 `keytool`

Lihat keystore:

```bash
keytool -list -v \
  -keystore truststore.p12 \
  -storetype PKCS12
```

Import CA:

```bash
keytool -importcert \
  -alias internal-root-ca \
  -file internal-root-ca.crt \
  -keystore truststore.p12 \
  -storetype PKCS12
```

Export certificate:

```bash
keytool -exportcert \
  -alias service-cert \
  -keystore keystore.p12 \
  -storetype PKCS12 \
  -rfc \
  -file service-cert.pem
```

---

### 23.2 `openssl s_client`

Capture chain:

```bash
openssl s_client \
  -connect api.example.com:443 \
  -servername api.example.com \
  -showcerts
```

Important:

- `-servername` sets SNI;
- without SNI, server may return default certificate;
- compare returned chain with expected chain;
- check SAN and issuer.

---

### 23.3 Java TLS Debug

Run with:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Useful to see:

- certificate chain received;
- trust manager decisions;
- algorithm constraints;
- handshake failure;
- selected protocol/cipher;
- cert path validation diagnostics.

Warning:

- output is verbose;
- may include sensitive metadata;
- do not enable permanently in production logs.

---

### 23.4 Determine TrustStore Actually Used

Common Java properties:

```bash
-Djavax.net.ssl.trustStore=/path/to/truststore.p12
-Djavax.net.ssl.trustStorePassword=...
-Djavax.net.ssl.trustStoreType=PKCS12
```

But frameworks may override with custom HTTP client config.

Check:

- JVM args;
- container env;
- app config;
- framework SSL bundle;
- HTTP client-specific SSLContext;
- OS vs Java truststore;
- default `$JAVA_HOME/lib/security/cacerts`.

---

## 24. Failure Mode Catalog

### 24.1 Missing Intermediate

Symptom:

```text
PKIX path building failed
```

Bad fix:

```text
Import leaf certificate into every client truststore.
```

Better fix:

```text
Configure server to send full chain.
Ensure client trusts root/intermediate according to policy.
```

---

### 24.2 Wrong Hostname

Symptom:

```text
No subject alternative DNS name matching ...
```

Bad fix:

```text
Disable hostname verification.
```

Better fix:

```text
Issue certificate with correct SAN.
Use correct DNS name.
```

---

### 24.3 Certificate Reused Across Environments

Problem:

```text
staging certificate accepted in production
```

Risk:

- environment boundary broken;
- staging compromise can access prod;
- audit confusion.

Better design:

```text
separate issuing CA or policy OID per environment
production truststore rejects non-production issuer/policy
```

---

### 24.4 Overbroad TrustStore

Problem:

```text
service trusts all corporate CAs
```

Risk:

- certificate from unrelated CA accepted;
- lateral movement;
- weak governance.

Better design:

```text
per-purpose truststore
per-environment truststore
issuer constraints
additional SAN/EKU/policy validation
```

---

### 24.5 Revocation Not Checked

Problem:

```text
compromised certificate still accepted until expiry
```

Better design:

```text
short-lived certificates
revocation checking where appropriate
OCSP/CRL availability design
certificate rotation automation
incident response playbook
```

---

### 24.6 Trust-All in Test Leaks to Production

Problem:

```text
TrustManager accepts all certificates
merged from test utility
```

Prevention:

- forbid trust-all code by static scan;
- build test SSL with local CA;
- security unit test checks no insecure SSLContext bean in prod profile;
- code review blocker.

---

### 24.7 Certificate Rotation Breaks Pinning

Problem:

```text
client pins old leaf fingerprint
server rotates certificate
client outage
```

Better design:

- pin public key or intermediate if appropriate;
- support multiple active pins;
- deploy new pin before rotation;
- expiry monitoring;
- emergency rollback plan.

---

### 24.8 JDK Upgrade Breaks Legacy Cert

Problem:

```text
Algorithm constraints check failed after JDK update
```

Cause:

- JDK disables weak algorithm/key;
- old CA profile;
- old device/service certificate.

Better design:

- pre-upgrade cert scan;
- algorithm inventory;
- reissue weak certs before upgrade;
- compatibility testing.

---

### 24.9 Clock Skew

Problem:

```text
certificate not yet valid / expired unexpectedly
```

Better design:

- NTP monitoring;
- alert on clock drift;
- avoid too-tight validity windows for distributed deployment;
- log validation time.

---

### 24.10 Broken Authorization Mapping in mTLS

Problem:

```text
any cert from trusted CA can call privileged API
```

Better design:

```text
chain trust + EKU + SAN identity + issuer policy + authorization matrix
```

---

## 25. Production Checklist

### 25.1 TLS Server Certificate

- [ ] Certificate has correct DNS/IP SAN.
- [ ] Certificate has `serverAuth` EKU.
- [ ] Chain complete.
- [ ] Private key stored securely.
- [ ] No weak signature algorithm.
- [ ] No weak public key size/curve.
- [ ] Expiry monitored.
- [ ] Rotation tested.
- [ ] Server sends correct chain with SNI.
- [ ] Old certificate removed after rotation.
- [ ] No private key in image/repo/log.

---

### 25.2 TLS Client/mTLS Certificate

- [ ] Certificate has `clientAuth` EKU.
- [ ] Identity encoded in SAN/Subject according to policy.
- [ ] Issued by correct client CA.
- [ ] Private key protected.
- [ ] Rotation path exists.
- [ ] Server maps identity to principal.
- [ ] Authorization matrix exists.
- [ ] Revocation/short-lived cert policy defined.
- [ ] Environment separation enforced.
- [ ] Compromise response documented.

---

### 25.3 TrustStore

- [ ] Contains only required trust anchors.
- [ ] Environment-specific.
- [ ] Purpose-specific if needed.
- [ ] Versioned and auditable.
- [ ] No random imported leaf certs.
- [ ] Root/intermediate ownership documented.
- [ ] Expiry monitored for trusted CA certs.
- [ ] Decommissioned CA removed.
- [ ] Drift detection exists.
- [ ] App logs truststore version/path safely.

---

### 25.4 Certificate Path Validation

- [ ] Chain validation enabled.
- [ ] Hostname verification enabled.
- [ ] Algorithm constraints not weakened.
- [ ] EKU/key usage checked by TLS/framework or custom policy.
- [ ] Revocation policy explicit.
- [ ] Validation errors are not swallowed.
- [ ] Custom TrustManager delegates to default validation.
- [ ] No trust-all manager.
- [ ] Tests include invalid chain, wrong hostname, expired certificate, wrong EKU.
- [ ] Debug procedure documented.

---

### 25.5 Revocation

- [ ] Decide CRL, OCSP, OCSP stapling, short-lived cert, or combination.
- [ ] Define fail-open/fail-closed.
- [ ] Test revoked certificate.
- [ ] Test responder unavailable.
- [ ] Monitor responder/CRL freshness.
- [ ] Cache behavior understood.
- [ ] Incident playbook includes revocation.
- [ ] Revocation evidence retained for audit if needed.
- [ ] Private PKI CA supports revocation process.
- [ ] Certificate owners know how to request revocation.

---

## 26. Review Questions

Gunakan pertanyaan ini untuk design review.

### 26.1 Trust Boundary

1. Certificate ini digunakan untuk membuktikan identity apa?
2. Trust anchor-nya siapa?
3. Kenapa trust anchor itu dipercaya?
4. Apakah truststore terlalu luas?
5. Apakah environment dev/staging/prod terpisah?

---

### 26.2 Identity

1. Identity ada di SAN, Subject, fingerprint, atau policy OID?
2. Apakah hostname/service name cocok?
3. Apakah wildcard digunakan?
4. Apakah IP literal digunakan?
5. Apakah identity mapping stabil saat rotation?

---

### 26.3 Usage

1. Certificate dipakai untuk TLS server, TLS client, signing, atau encryption?
2. Apakah key usage cocok?
3. Apakah EKU cocok?
4. Apakah certificate reuse lintas purpose?
5. Apakah CA usage dibatasi?

---

### 26.4 Lifecycle

1. Siapa owner certificate?
2. Kapan expired?
3. Bagaimana rotation?
4. Apakah reload butuh restart?
5. Apakah ada monitoring?
6. Apa yang terjadi jika private key bocor?
7. Bagaimana revoke certificate?
8. Apakah truststore update otomatis atau manual?

---

### 26.5 Failure Handling

1. Jika chain invalid, apakah aplikasi fail closed?
2. Jika revocation responder down, apa policy?
3. Jika certificate expired saat weekend, siapa mendapat alert?
4. Jika JDK upgrade menolak algorithm lama, apakah terdeteksi sebelum production?
5. Jika truststore salah deploy, apakah telemetry membantu diagnosis?

---

## 27. Mini Case Study: mTLS Internal API untuk Regulatory Case Management

### 27.1 Scenario

Ada beberapa service:

```text
case-service
document-service
audit-service
notification-service
identity-bridge
```

`case-service` harus memanggil `audit-service` untuk menulis audit event.

Requirement:

1. hanya service production tertentu yang boleh menulis audit event;
2. staging/dev tidak boleh diterima oleh prod audit-service;
3. setiap client harus terbukti identitasnya;
4. certificate rotation tidak boleh menyebabkan outage besar;
5. jika private key client bocor, akses harus bisa dicabut;
6. audit event harus punya correlation id dan service identity.

---

### 27.2 Naive Design

```text
audit-service trusts corporate-root-ca
any client certificate from corporate-root-ca accepted
application checks only TLS success
```

Masalah:

- terlalu banyak certificate trusted;
- dev/staging mungkin accepted;
- service lain bisa akses;
- tidak ada authorization mapping;
- compromise satu certificate bisa berdampak luas;
- audit tidak tahu identity spesifik dengan baik.

---

### 27.3 Better Design

PKI:

```text
Corp Offline Root CA
  -> Prod Service Client CA
      -> case-service client cert
      -> document-service client cert

  -> Prod Service Server CA
      -> audit-service server cert

  -> Staging Service Client CA
  -> Dev Service Client CA
```

`audit-service` truststore:

```text
trusts only Prod Service Client CA for client certificates
```

`case-service` truststore:

```text
trusts only Prod Service Server CA for audit-service server certificate
```

Client cert:

```text
SAN URI: spiffe://prod/aceas/case-service
EKU: clientAuth
```

Server cert:

```text
SAN DNS: audit-service.prod.internal
EKU: serverAuth
```

Application authorization:

```text
Allowed caller:
  spiffe://prod/aceas/case-service -> WRITE_AUDIT_EVENT
  spiffe://prod/aceas/document-service -> WRITE_DOCUMENT_AUDIT_EVENT
```

Audit record includes:

```json
{
  "callerIdentity": "spiffe://prod/aceas/case-service",
  "certificateFingerprint": "SHA256:...",
  "issuer": "Prod Service Client CA",
  "correlationId": "...",
  "action": "WRITE_AUDIT_EVENT"
}
```

---

### 27.4 Rotation Strategy

Support overlapping certs:

```text
old cert valid until T+14 days
new cert deployed at T
server accepts both if both issued by same Prod Service Client CA
application identity based on SAN URI, not fingerprint only
```

If using fingerprint pinning:

```text
accept old fingerprint + new fingerprint during overlap
remove old after cutover
```

---

### 27.5 Revocation Strategy

Options:

1. short-lived client certificate, e.g. 24h/7d;
2. OCSP/CRL fail-closed for high-risk service;
3. emergency denylist fingerprint in audit-service;
4. rotate service account key material;
5. disable workload identity issuance.

For high-assurance regulatory action, combine:

```text
short-lived cert
issuer separation
authorization mapping
emergency denylist
certificate inventory
audit trace
```

---

## 28. Anti-Pattern Catalog

### 28.1 “Just Import the Server Cert”

Not always wrong, but usually suspicious.

Ask:

- are you importing a trust anchor or random leaf?
- what happens when server rotates cert?
- are you narrowing or widening trust?
- who owns this trust decision?

---

### 28.2 “Disable SSL Validation Temporarily”

Temporary security bypass often becomes permanent.

Better:

- create local test CA;
- generate local cert with correct SAN;
- use test truststore;
- make insecure mode impossible in prod profile.

---

### 28.3 “One Certificate for Everything”

Same cert/key for:

- server TLS;
- client mTLS;
- JWT signing;
- file signing;
- admin access.

This destroys usage separation and complicates incident response.

---

### 28.4 “Trust Corporate Root Everywhere”

Corporate root may issue many certificate types. Trusting it everywhere can be too broad.

Better:

- intermediate per environment/purpose;
- trust least required issuer;
- enforce EKU/SAN/policy.

---

### 28.5 “Hostname Verification Is Annoying”

Hostname verification is what binds certificate to the endpoint.

Without it, TLS validates “someone trusted” but not “the server I intended”.

---

### 28.6 “Revocation Is Too Hard, Ignore It”

Sometimes short-lived certs can reduce reliance on revocation, but ignoring compromise is not a policy.

A mature design explicitly says:

```text
We use short-lived certificates of X duration.
We do/do not check revocation because ...
Emergency compromise response is ...
```

---

### 28.7 “The Browser Works, Java Must Be Wrong”

Browser and Java may differ:

- truststore;
- intermediate cache;
- AIA fetching;
- revocation behavior;
- algorithm constraints;
- SNI;
- hostname verification;
- root program;
- certificate transparency requirement.

Always inspect from Java runtime context.

---

## 29. Testing Strategy

### 29.1 Unit/Integration Tests

Test certificates:

- valid chain;
- missing intermediate;
- unknown root;
- expired leaf;
- not-yet-valid leaf;
- wrong hostname;
- wrong EKU;
- revoked certificate if infra supports;
- weak algorithm;
- dev cert against prod truststore;
- staging client cert against prod server.

---

### 29.2 Local Test CA

Instead of trust-all, create test CA:

```text
test-root-ca
  -> test-server-cert with SAN localhost
  -> test-client-cert with EKU clientAuth
```

Test truststore trusts only test root/intermediate.

This keeps validation realistic.

---

### 29.3 Static Scan Rules

Block:

```text
TrustManager that does nothing
HostnameVerifier returning true
ALLOW_ALL_HOSTNAME_VERIFIER
setSSLHostnameVerifier(NoopHostnameVerifier)
curl -k style config in prod scripts
-Dcom.sun.net.ssl.checkRevocation=false without policy
```

Also scan for:

```text
javax.net.ssl.trustStore pointing to dev truststore
hardcoded keystore password
private key committed
.p12 in repo
.pem private key in image
```

---

## 30. Operational Runbook: Debugging Java Certificate Failure

### Step 1: Capture Exact Error

Do not summarize as “SSL error”.

Capture:

```text
exception type
message
root cause
JDK version
service endpoint
hostname used
environment
```

---

### Step 2: Identify Runtime Trust Config

Check:

```text
JVM args
trustStore path
trustStore type
container image
framework SSL config
HTTP client SSLContext
```

---

### Step 3: Capture Server Chain

```bash
openssl s_client -connect host:443 -servername host -showcerts
```

Verify:

- leaf SAN;
- issuer;
- intermediate present;
- expiry;
- algorithm.

---

### Step 4: Inspect TrustStore

```bash
keytool -list -v -keystore truststore.p12 -storetype PKCS12
```

Check:

- root/intermediate present;
- alias;
- expiry;
- fingerprint;
- correct environment.

---

### Step 5: Reproduce with Java Debug

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Look for:

- path building failure;
- disabled algorithm;
- hostname mismatch;
- revocation issue;
- selected chain.

---

### Step 6: Choose Correct Fix

| Cause | Correct Fix |
|---|---|
| Missing intermediate | deploy full chain |
| Unknown private CA | add intended CA to truststore |
| Wrong hostname | reissue cert/use correct DNS |
| Expired cert | rotate cert |
| Weak algorithm | reissue with stronger algorithm |
| Revoked cert | replace cert/key and investigate |
| Wrong EKU | issue cert with correct EKU |
| Wrong truststore | fix deployment config |
| Revocation responder down | apply documented fail policy |

---

## 31. Secure Design Template

Use this when documenting certificate-based trust.

```markdown
# Certificate Trust Design

## Purpose
What is this certificate used for?

## Identity
Where is identity encoded?
- SAN DNS:
- SAN URI:
- Subject:
- Policy OID:

## Trust Anchor
Which CA/trust anchor is trusted?

## Chain
Expected chain:
- Leaf:
- Intermediate:
- Root:

## Usage Constraints
- Key Usage:
- Extended Key Usage:
- Basic Constraints:
- Name Constraints:

## Validation Rules
- Chain validation:
- Hostname verification:
- Revocation:
- Algorithm constraints:
- Additional app-level checks:

## Authorization Mapping
How does certificate identity map to principal/permissions?

## Lifecycle
- Owner:
- Validity:
- Rotation:
- Reload:
- Monitoring:
- Revocation:
- Compromise response:

## Failure Mode
What happens if:
- expired?
- revoked?
- unknown issuer?
- wrong hostname?
- wrong EKU?
- responder down?
```

---

## 32. Summary

X.509/PKI adalah sistem untuk membuat public key bisa dipercaya melalui signed identity binding dan chain of trust.

Hal terpenting:

1. Certificate mengikat public key ke identity dan usage constraints.
2. Trust muncul dari trust anchor lokal, bukan dari certificate itu sendiri.
3. Certificate path validation adalah proses constraint solving.
4. Chain valid belum cukup; hostname/service identity harus cocok.
5. Key usage dan EKU menentukan certificate boleh dipakai untuk apa.
6. Revocation menangani certificate yang dicabut sebelum expiry.
7. Truststore adalah security policy, bukan tempat membuang semua certificate error.
8. Custom TrustManager harus memperketat, bukan mengganti validasi menjadi trust-all.
9. mTLS authentication harus diikuti authorization mapping.
10. Certificate lifecycle adalah operational security dan reliability issue.

Senior Java engineer harus mampu menjelaskan:

```text
Mengapa certificate ini dipercaya?
Untuk identity apa?
Oleh siapa?
Dengan usage apa?
Sampai kapan?
Bagaimana jika bocor?
Bagaimana jika dicabut?
Bagaimana jika chain berubah?
Bagaimana jika JDK upgrade menolak algorithm-nya?
```

Jika pertanyaan itu bisa dijawab, certificate management bukan lagi magic, tetapi bagian dari architecture.

---

## 33. Referensi

Referensi utama yang relevan untuk part ini:

1. Oracle Java PKI Programmer's Guide.
2. Oracle Java Security `java.security.cert` API.
3. Oracle JSSE Reference Guide.
4. RFC 5280: Internet X.509 Public Key Infrastructure Certificate and CRL Profile.
5. OWASP Transport Layer Security Cheat Sheet.
6. OWASP Pinning Cheat Sheet.
7. OWASP Cryptographic Storage Cheat Sheet.
8. NIST SP 800-57 Part 1: Recommendation for Key Management.
9. Java Security Standard Algorithm Names.
10. Java security properties related to disabled algorithms and certificate path validation.

---

## 34. Apa Berikutnya?

Part berikutnya:

```text
Part 14 — TLS/JSSE Deep Dive for Java Engineers
```

Di Part 14 kita akan masuk lebih dalam ke TLS/JSSE:

- handshake mental model;
- TLS 1.2 vs TLS 1.3;
- cipher suite;
- server authentication;
- mutual TLS;
- `SSLContext`;
- `SSLEngine`;
- `SSLSocket`;
- `HttpsURLConnection`;
- Java HTTP Client TLS configuration;
- ALPN;
- SNI;
- TLS debugging;
- practical hardening.

Status seri: **belum selesai**. Masih ada part 14 sampai part 34.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-012](./learn-java-security-cryptography-integrity-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-014](./learn-java-security-cryptography-integrity-part-014.md)
