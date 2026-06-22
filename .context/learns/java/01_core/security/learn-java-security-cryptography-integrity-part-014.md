# learn-java-security-cryptography-integrity-part-014

# Part 14 — TLS/JSSE Deep Dive for Java Engineers

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `014 / 034`  
> Status seri: **belum selesai**  
> Fokus: TLS sebagai channel-security protocol, JSSE sebagai runtime abstraction di Java, dan bagaimana engineer Java memastikan confidentiality, authenticity, integrity, freshness, dan operational diagnosability tanpa merusak trust model.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- cryptography mental model,
- randomness,
- hash/integrity,
- password hashing,
- symmetric encryption,
- MAC,
- digital signature,
- asymmetric encryption/key agreement,
- key management,
- keystore/truststore,
- X.509/PKI/certificate path validation.

Part ini menyatukan semuanya ke salah satu security boundary paling sering dipakai di sistem Java: **TLS**.

TLS bukan hanya “pakai HTTPS”. TLS adalah protocol yang mencoba menjawab pertanyaan:

> “Bagaimana dua pihak yang berkomunikasi lewat network tidak tepercaya bisa membangun channel yang confidential, authenticated, integrity-protected, dan resistant terhadap sebagian replay/downgrade attack?”

Dalam Java, TLS sebagian besar diekspos melalui **JSSE — Java Secure Socket Extension**.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. memahami TLS sebagai security protocol, bukan sekadar socket terenkripsi;
2. menjelaskan apa yang terjadi dalam TLS handshake;
3. membedakan server authentication, client authentication, dan mutual TLS;
4. memahami peran `SSLContext`, `SSLSocket`, `SSLEngine`, `KeyManager`, `TrustManager`, `HostnameVerifier`, dan truststore;
5. membaca error TLS Java dengan benar;
6. mendesain outbound dan inbound TLS policy yang defensible;
7. menghindari anti-pattern seperti trust-all certificate, hostname verification disabled, weak protocol fallback, dan certificate pinning yang tidak punya rotation path;
8. membuat mental model troubleshooting TLS incident di production.

---

## 1. Posisi TLS dalam Security Architecture

TLS berada di layer transport/application boundary. Dalam praktik modern, TLS biasanya melindungi HTTP, gRPC, database connection, LDAP, SMTP, Kafka, Redis, RabbitMQ, internal service call, atau custom TCP protocol.

TLS memberi beberapa security property utama:

| Property | Maksud | Contoh Failure |
|---|---|---|
| Confidentiality | Pihak ketiga tidak bisa membaca isi komunikasi | Token/session/case data bocor di network |
| Integrity | Data tidak bisa diubah diam-diam tanpa terdeteksi | Response API dimodifikasi oleh MITM |
| Server authenticity | Client yakin sedang bicara dengan server yang benar | Client connect ke fake endpoint |
| Optional client authenticity | Server yakin client punya private key tertentu | Service palsu memanggil internal API |
| Key establishment | Kedua pihak sepakat session key sementara | Session key predictable/compromised |
| Downgrade resistance | Protocol menolak dipaksa ke versi/algorithm lebih lemah | TLS 1.3 dipaksa turun ke TLS 1.0 |

Namun TLS **tidak** otomatis memberi:

| Bukan Guarantee TLS | Kenapa |
|---|---|
| Authorization correctness | TLS hanya membuktikan endpoint/key, bukan hak akses business object |
| Application-level non-repudiation | TLS session key simetris; tidak sama dengan signed business document |
| End-to-end integrity antar microservice chain | TLS hanya hop-to-hop jika ada proxy/gateway/mesh |
| Protection setelah data sampai memory aplikasi | Setelah decrypted, data plaintext ada di process memory |
| Immunity dari SSRF | Aplikasi tetap bisa disuruh memanggil host berbahaya |
| Immunity dari token leak | TLS melindungi in transit, bukan dari logging/header exposure |
| Trust terhadap payload semantics | Payload tetap harus divalidasi dan diautorisasi |

Mental model penting:

```text
TLS protects a channel.
It does not automatically make the application protocol correct.
```

Untuk sistem enterprise, jangan pernah menganggap:

```text
mTLS succeeded → request pasti authorized
```

Yang lebih benar:

```text
mTLS succeeded → peer memiliki private key yang cocok dengan certificate yang trusted
               → identity bisa diekstrak dari certificate
               → identity harus dipetakan ke subject/service/client
               → subject/service/client tetap harus melewati authorization policy
```

---

## 2. TLS sebagai Protocol: Mental Model Sederhana

Bayangkan client ingin bicara ke server melalui network yang bisa:

- membaca packet,
- mengubah packet,
- menghapus packet,
- mengulang packet,
- menyamar sebagai server,
- mencoba downgrade protocol,
- redirect DNS,
- melakukan proxy transparan.

TLS mencoba membangun channel aman melalui tahapan:

```text
1. Client dan server negotiate protocol version dan cryptographic parameters.
2. Server membuktikan identitasnya menggunakan certificate/private key.
3. Client memvalidasi certificate chain dan hostname.
4. Kedua pihak menjalankan key establishment.
5. Dari shared secret dihasilkan traffic keys.
6. Setelah handshake selesai, application data dikirim dengan encryption + integrity protection.
```

Dalam TLS modern, terutama TLS 1.3, key establishment biasanya berbasis ephemeral Diffie-Hellman sehingga session memiliki **forward secrecy**.

Forward secrecy berarti:

```text
Jika private key server bocor di masa depan,
attacker tetap tidak otomatis bisa decrypt traffic lama
yang pernah direkam sebelumnya,
selama session key lama berasal dari ephemeral key exchange
dan tidak ikut bocor.
```

Ini berbeda dengan model lama RSA key transport, di mana compromise private key server dapat berdampak lebih besar terhadap traffic historis yang direkam.

---

## 3. TLS 1.2 vs TLS 1.3: Perbedaan Engineering yang Penting

Kamu tidak harus menghafal semua byte-level handshake, tetapi harus tahu implikasi desainnya.

| Area | TLS 1.2 | TLS 1.3 |
|---|---|---|
| Handshake | Lebih fleksibel, lebih kompleks | Lebih sederhana dan aman secara default |
| Cipher suite | Mencampur key exchange, auth, symmetric cipher, MAC | Lebih fokus pada AEAD/hash; key exchange dipisahkan |
| Forward secrecy | Bergantung cipher suite | Default design modern |
| Legacy algorithms | Lebih banyak kemungkinan | Banyak legacy dihapus |
| Round trip | Biasanya lebih banyak | Lebih cepat |
| 0-RTT | Tidak | Ada, tetapi punya replay trade-off |

Contoh cipher suite TLS 1.2:

```text
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
```

Dibaca sebagai:

```text
TLS version family
+ ECDHE key exchange
+ RSA authentication/signature
+ AES-128-GCM bulk encryption
+ SHA-256 hash/HKDF-related usage
```

Contoh cipher suite TLS 1.3:

```text
TLS_AES_128_GCM_SHA256
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
```

TLS 1.3 tidak menaruh key exchange dan signature algorithm di cipher suite name dengan cara yang sama seperti TLS 1.2.

Engineering consequence:

```text
TLS 1.2 hardening sering berarti memilih cipher suite dengan teliti.
TLS 1.3 hardening lebih banyak berarti memastikan protocol version, named groups,
signature algorithms, certificate policy, dan implementation defaults benar.
```

---

## 4. JSSE: Java Abstraction untuk TLS

JSSE menyediakan API dan provider implementation untuk TLS/DTLS. Package utamanya:

```java
javax.net
javax.net.ssl
```

Komponen utama:

| Komponen | Fungsi |
|---|---|
| `SSLContext` | Factory/config root untuk TLS runtime |
| `SSLSocketFactory` | Membuat client TLS socket blocking |
| `SSLServerSocketFactory` | Membuat server TLS socket blocking |
| `SSLSocket` | TLS socket berbasis stream/blocking |
| `SSLServerSocket` | Server socket TLS |
| `SSLEngine` | TLS engine non-blocking, cocok untuk NIO/reactive/netty/container |
| `SSLParameters` | Konfigurasi protocol, cipher suite, endpoint identification, client auth |
| `KeyManagerFactory` | Membuat `KeyManager` dari key material lokal |
| `TrustManagerFactory` | Membuat `TrustManager` dari trust anchors |
| `X509KeyManager` | Memilih certificate/private key lokal |
| `X509TrustManager` | Memvalidasi certificate peer |
| `HostnameVerifier` | Verifikasi hostname untuk HTTPS layer |

Secara mental:

```text
SSLContext = TLS runtime configuration root
KeyManager = siapa saya? key/cert apa yang saya presentasikan?
TrustManager = siapa yang saya percaya?
SSLParameters = versi/protocol/cipher/client-auth/endpoint-identification policy
SSLSocket/SSLEngine = tempat TLS record benar-benar diproses
```

---

## 5. `SSLContext`: Root dari TLS Runtime Java

`SSLContext` adalah object yang menggabungkan:

1. key manager,
2. trust manager,
3. secure random,
4. provider implementation,
5. protocol family.

Contoh dasar:

```java
SSLContext context = SSLContext.getInstance("TLS");
context.init(keyManagers, trustManagers, secureRandom);
```

Namun ada nuance penting.

### 5.1 `TLS` vs `TLSv1.3` vs default context

Biasanya gunakan:

```java
SSLContext.getInstance("TLS")
```

lalu constrain versi melalui `SSLParameters` atau system/security property.

Hindari hardcode protocol terlalu sempit tanpa alasan:

```java
SSLContext.getInstance("TLSv1.2")
```

Karena ini bisa membuat aplikasi tidak memakai TLS 1.3 walaupun runtime mendukung.

Tapi jangan juga membiarkan legacy protocol aktif jika policy mengharuskan disable.

Model yang lebih baik:

```text
Use generic TLS context
+ set enabled protocols according to policy
+ rely on JDK disabledAlgorithms for legacy rejection
+ test compatibility explicitly
```

Contoh:

```java
SSLContext context = SSLContext.getInstance("TLS");
context.init(keyManagers, trustManagers, null);

SSLSocketFactory factory = context.getSocketFactory();
try (SSLSocket socket = (SSLSocket) factory.createSocket("api.example.com", 443)) {
    SSLParameters parameters = socket.getSSLParameters();
    parameters.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
    parameters.setEndpointIdentificationAlgorithm("HTTPS");
    socket.setSSLParameters(parameters);

    socket.startHandshake();
}
```

`setEndpointIdentificationAlgorithm("HTTPS")` penting untuk memastikan hostname verification dilakukan pada koneksi TLS non-`HttpsURLConnection`.

---

## 6. KeyManager: “Siapa Saya?”

`KeyManager` digunakan untuk menyediakan local credentials.

Dalam TLS server biasa:

```text
Server memakai KeyManager untuk memilih certificate + private key
untuk membuktikan identitas server ke client.
```

Dalam mTLS client:

```text
Client memakai KeyManager untuk memilih client certificate + private key
untuk membuktikan identitas client ke server.
```

Contoh load keystore menjadi key manager:

```java
KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("server-identity.p12"))) {
    keyStore.load(in, keyStorePassword);
}

KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
kmf.init(keyStore, keyPassword);
KeyManager[] keyManagers = kmf.getKeyManagers();
```

Ada dua password yang sering membingungkan:

| Password | Melindungi |
|---|---|
| Keystore password | Container keystore |
| Key password | Private key entry |

Dalam PKCS#12 modern sering sama, tapi mental modelnya tetap perlu dipisah.

### 6.1 Alias Selection

Jika satu keystore punya banyak certificate/private key, JSSE perlu memilih alias.

Default `X509KeyManager` akan memilih berdasarkan:

- key type,
- issuer acceptable list,
- server/client mode,
- algorithm constraint,
- certificate validity.

Tapi di enterprise, sering lebih aman membuat wrapper `X509ExtendedKeyManager` untuk memilih alias secara eksplisit.

Contoh use case:

```text
Satu JVM menghubungi banyak partner eksternal.
Partner A butuh client cert A.
Partner B butuh client cert B.
Default key manager bisa memilih cert yang tidak diharapkan.
```

Pattern:

```text
One outbound client config per partner
→ dedicated SSLContext
→ dedicated key alias
→ dedicated trust policy
→ dedicated timeout/retry/circuit breaker
```

---

## 7. TrustManager: “Siapa yang Saya Percaya?”

`TrustManager` memvalidasi certificate peer.

Untuk client TLS:

```text
TrustManager memvalidasi certificate server.
```

Untuk server mTLS:

```text
TrustManager memvalidasi certificate client.
```

Load truststore:

```java
KeyStore trustStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("partner-truststore.p12"))) {
    trustStore.load(in, trustStorePassword);
}

TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
tmf.init(trustStore);
TrustManager[] trustManagers = tmf.getTrustManagers();
```

Truststore berisi **trust anchors**, biasanya root/intermediate CA atau certificate tertentu.

Perbedaan penting:

```text
Truststore bukan tempat menyimpan certificate kita.
Truststore adalah daftar pihak/CA yang kita percaya untuk memvalidasi peer.
```

### 7.1 Jangan Membuat Trust-All TrustManager

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

Ini merusak server authenticity.

Efeknya:

```text
TLS tetap terenkripsi,
tetapi client tidak tahu sedang berbicara dengan siapa.
MITM bisa membuat certificate palsu dan tetap diterima.
```

Kalau ada masalah certificate di DEV/UAT, solusi benar bukan trust-all, tetapi:

1. buat internal CA yang benar,
2. masukkan CA ke truststore DEV/UAT,
3. pastikan SAN hostname cocok,
4. set expiry monitoring,
5. dokumentasikan environment trust policy.

---

## 8. Hostname Verification: Bagian yang Sering Hilang

Certificate path validation menjawab:

```text
Apakah certificate ini ditandatangani oleh CA yang saya percaya?
```

Hostname verification menjawab:

```text
Apakah certificate ini memang untuk host yang saya hubungi?
```

Keduanya wajib.

Contoh:

```text
Client connect ke https://payment.example.com
Server memberikan certificate valid dari trusted CA,
tapi SAN hanya berisi api.example.net.
```

Certificate chain valid, tetapi hostname tidak cocok. Koneksi harus ditolak.

### 8.1 HTTPS vs raw TLS

Pada `HttpsURLConnection` atau HTTP client modern, hostname verification biasanya sudah terintegrasi.

Tetapi pada raw `SSLSocket`, custom `SSLContext`, atau beberapa library, kamu harus memastikan endpoint identification aktif.

Contoh:

```java
SSLParameters parameters = socket.getSSLParameters();
parameters.setEndpointIdentificationAlgorithm("HTTPS");
socket.setSSLParameters(parameters);
```

Untuk `SSLEngine`:

```java
SSLEngine engine = sslContext.createSSLEngine("api.example.com", 443);
engine.setUseClientMode(true);

SSLParameters parameters = engine.getSSLParameters();
parameters.setEndpointIdentificationAlgorithm("HTTPS");
engine.setSSLParameters(parameters);
```

Tanpa host/port saat create engine, beberapa stack tidak punya context cukup untuk endpoint identification.

---

## 9. Server TLS: Minimal Secure Mental Model

Server TLS membutuhkan:

1. private key,
2. certificate chain,
3. protocol/cipher policy,
4. trust policy jika mTLS,
5. certificate renewal process,
6. logging/metrics untuk handshake failure.

Server identity material:

```text
server.p12
  alias: api-server
  private key: server private key
  certificate chain:
    leaf certificate for api.example.com
    intermediate CA(s)
```

Server-side Java setup secara konseptual:

```java
SSLContext serverContext = SSLContext.getInstance("TLS");
serverContext.init(serverKeyManagers, serverTrustManagersOrNull, null);

SSLServerSocketFactory factory = serverContext.getServerSocketFactory();
SSLServerSocket serverSocket = (SSLServerSocket) factory.createServerSocket(8443);

SSLParameters parameters = serverSocket.getSSLParameters();
parameters.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
serverSocket.setSSLParameters(parameters);
```

Jika server butuh client certificate:

```java
SSLParameters parameters = serverSocket.getSSLParameters();
parameters.setNeedClientAuth(true);
serverSocket.setSSLParameters(parameters);
```

Perbedaan:

| Method | Makna |
|---|---|
| `setNeedClientAuth(true)` | Client cert wajib |
| `setWantClientAuth(true)` | Client cert diminta tapi tidak wajib |

Untuk security boundary yang serius, gunakan `need`, bukan `want`, kecuali ada migration mode yang jelas.

---

## 10. Client TLS: Minimal Secure Mental Model

Client TLS membutuhkan:

1. truststore untuk memvalidasi server;
2. hostname verification;
3. optional client keystore untuk mTLS;
4. timeout;
5. protocol/cipher policy;
6. retry policy yang tidak menyembunyikan security failure;
7. observability handshake failure.

Outbound client pattern:

```text
Partner-specific client
  ├─ base URL
  ├─ truststore
  ├─ optional client certificate
  ├─ protocol policy
  ├─ hostname verification
  ├─ timeout
  ├─ retry/circuit breaker
  └─ audit/log correlation
```

Jangan membuat satu global `SSLContext` yang dipakai semua outbound partner kalau trust boundary berbeda.

Bad pattern:

```text
one-big-truststore.p12 contains every partner CA
all clients share same SSLContext
all clients can trust endpoints intended for another integration
```

Better pattern:

```text
paymentClientSslContext trusts payment CA only
identityClientSslContext trusts identity CA only
fileTransferSslContext trusts file-transfer CA only
```

---

## 11. Mutual TLS: Authentication, Not Authorization

mTLS berarti dua arah:

```text
Client validates server certificate.
Server validates client certificate.
```

Diagram:

```text
Client                                      Server
  |                                           |
  | ---- ClientHello ----------------------> |
  | <--- ServerHello + Certificate --------- |
  |                                           | Server proves identity
  | validates server chain + hostname         |
  |                                           |
  | <--- CertificateRequest ---------------- |
  | ---- Client Certificate ----------------> |
  | ---- CertificateVerify -----------------> |
  |                                           | Server validates client cert
  | ---- Finished --------------------------> |
  | <--- Finished -------------------------- |
  |                                           |
  | ===== encrypted application data ======= |
```

mTLS gives server evidence like:

```text
The peer controls the private key corresponding to this client certificate,
and that certificate chains to a trusted CA / configured trust anchor.
```

mTLS tidak otomatis menjawab:

```text
Apakah client boleh mengakses case ID 123?
Apakah client boleh submit enforcement decision?
Apakah client certificate ini masih mapped ke service yang aktif?
Apakah role client sudah dicabut di authorization system?
```

Karena itu mTLS harus diikuti identity mapping:

```text
certificate SAN / subject / SPIFFE ID / URI SAN / custom extension
→ service identity
→ client record
→ policy
→ allowed operations
```

### 11.1 Certificate Identity Field

Hindari menggunakan `CN` sebagai satu-satunya identity source. Modern TLS identity biasanya memakai SAN.

Possible SAN types:

| SAN Type | Use Case |
|---|---|
| DNS SAN | Server hostname |
| URI SAN | Workload identity, SPIFFE-style identity |
| IP SAN | Direct IP endpoint, jarang ideal |
| email SAN | S/MIME-ish, jarang untuk service identity |

Untuk service-to-service identity, URI SAN atau DNS SAN sering lebih eksplisit daripada Subject DN parsing.

---

## 12. `SSLEngine`: TLS untuk NIO, Netty, Reactive, dan Container

`SSLSocket` cocok untuk blocking socket.

`SSLEngine` adalah state machine TLS yang tidak melakukan I/O sendiri. Ia hanya:

- menerima encrypted network bytes,
- menghasilkan decrypted application bytes,
- menerima plaintext application bytes,
- menghasilkan encrypted network bytes.

Mental model:

```text
Network ByteBuffer → unwrap() → Application ByteBuffer
Application ByteBuffer → wrap() → Network ByteBuffer
```

Kenapa `SSLEngine` penting?

Karena banyak Java server modern tidak memakai blocking `SSLSocket` langsung:

- Netty,
- Undertow,
- Tomcat NIO/NIO2,
- Jetty,
- async gateway,
- reactive stack,
- Kafka clients internally,
- gRPC Java.

Dengan `SSLEngine`, TLS menjadi state machine yang harus menangani:

- handshake status,
- buffer underflow,
- buffer overflow,
- delegated tasks,
- wrap/unwrap loops,
- close_notify.

Kamu tidak perlu implement sendiri kecuali membuat framework/networking layer, tetapi kamu harus memahami error-nya saat membaca log.

Contoh status:

| Status | Arti |
|---|---|
| `NEED_WRAP` | Engine perlu mengirim TLS data |
| `NEED_UNWRAP` | Engine butuh menerima TLS data |
| `NEED_TASK` | Ada delegated task, biasanya crypto/cert path task |
| `FINISHED` | Handshake selesai |
| `NOT_HANDSHAKING` | Sedang application data mode |

Failure sering terjadi ketika buffer handling salah, bukan certificate salah.

---

## 13. ALPN: Application-Layer Protocol Negotiation

ALPN memungkinkan client/server menyepakati application protocol di atas TLS, misalnya:

```text
h2
http/1.1
```

Ini penting untuk:

- HTTP/2,
- gRPC,
- service mesh,
- modern API gateway.

Tanpa ALPN, client/server bisa sama-sama TLS success tapi gagal bicara application protocol yang sama.

Contoh konseptual:

```java
SSLParameters parameters = sslContext.getDefaultSSLParameters();
parameters.setApplicationProtocols(new String[] {"h2", "http/1.1"});
```

Setelah handshake:

```java
String protocol = socket.getApplicationProtocol();
```

Operational failure:

```text
TLS handshake success
HTTP/2 client sends preface
server only supports HTTP/1.1
application failure appears after TLS success
```

Jadi diagnosis TLS harus memisahkan:

```text
Handshake failure?
Certificate failure?
Hostname failure?
ALPN negotiation failure?
Application protocol failure after handshake?
```

---

## 14. SNI: Server Name Indication

SNI memungkinkan client memberi tahu hostname tujuan dalam handshake. Ini penting jika satu IP melayani banyak certificate/virtual host.

Tanpa SNI:

```text
Client connect to shared IP
Server tidak tahu certificate mana yang harus diberikan
Server memberi default certificate
Hostname verification gagal
```

Pada Java modern, SNI biasanya otomatis untuk HTTPS client jika hostname tersedia.

Tetapi pada custom `SSLEngine`/raw socket, pastikan host disediakan:

```java
SSLEngine engine = sslContext.createSSLEngine("api.partner.example", 443);
engine.setUseClientMode(true);
```

Jangan membuat engine seperti ini untuk outbound HTTPS jika butuh SNI/hostname verification:

```java
SSLEngine engine = sslContext.createSSLEngine();
```

Karena engine tidak tahu peer host.

---

## 15. TLS Session Resumption dan 0-RTT

TLS bisa memakai session resumption untuk mengurangi overhead handshake.

TLS 1.3 juga mengenal 0-RTT early data.

Security implication:

```text
0-RTT can be replayed.
```

Karena itu, jangan gunakan 0-RTT untuk operasi non-idempotent atau security-sensitive, misalnya:

- create payment,
- submit enforcement decision,
- approve case,
- mutate profile,
- issue token,
- upload legal evidence.

Jika framework/gateway mendukung 0-RTT, policy harus eksplisit:

```text
Allow 0-RTT only for safe/idempotent requests
or disable it entirely for enterprise systems unless there is a strong reason.
```

---

## 16. Certificate Revocation di Java TLS

Certificate bisa:

- expired,
- belum valid,
- chain invalid,
- revoked,
- memakai algorithm lemah,
- tidak cocok hostname,
- tidak punya EKU sesuai.

Revocation dapat dicek melalui:

- CRL,
- OCSP,
- OCSP stapling dalam konteks tertentu.

Dalam banyak Java deployment, revocation checking tidak selalu aktif secara default dalam semua context sesuai harapan engineer. Karena itu, kamu harus memperlakukan revocation sebagai explicit policy, bukan asumsi.

Pertanyaan yang harus dijawab:

```text
Untuk public internet outbound:
  apakah mengikuti default JVM/OS/browser-like behavior cukup?

Untuk private PKI/mTLS:
  apakah ada CRL/OCSP endpoint?
  apakah endpoint accessible dari cluster?
  apakah revocation failure harus fail-closed atau fail-open?
  bagaimana emergency revoke client cert?
```

Fail-open vs fail-closed:

| Mode | Arti | Risiko |
|---|---|---|
| Fail-open | Jika revocation check gagal, koneksi tetap jalan | Compromised cert mungkin diterima |
| Fail-closed | Jika revocation check gagal, koneksi ditolak | Availability incident jika OCSP/CRL unreachable |

Untuk regulatory/security-sensitive internal mTLS, sering lebih defensible punya:

```text
short-lived certificates
+ automated renewal
+ explicit certificate inventory
+ emergency blocklist/mapping disable
+ monitored revocation infrastructure
```

---

## 17. Algorithm Constraints dan Disabled Algorithms

JDK punya security properties untuk membatasi algorithm/protocol lemah, misalnya:

```text
jdk.tls.disabledAlgorithms
jdk.certpath.disabledAlgorithms
```

Contoh hal yang biasanya dibatasi:

- SSLv3,
- TLSv1/TLSv1.1,
- RC4,
- DES/3DES,
- MD5,
- SHA1 dalam context tertentu,
- RSA key terlalu kecil,
- weak EC curves.

Ini penting karena code bisa saja meminta algorithm tertentu, tetapi JDK menolak karena policy.

Operational symptom:

```text
javax.net.ssl.SSLHandshakeException: no cipher suites in common
javax.net.ssl.SSLHandshakeException: Certificates do not conform to algorithm constraints
java.security.cert.CertPathValidatorException: Algorithm constraints check failed
```

Mental model:

```text
TLS compatibility is not just client code vs server config.
It is client code + JDK provider + security properties + cert chain + server config + policy.
```

---

## 18. Cipher Suite Selection: Jangan Overfit

Dulu engineer sering membuat daftar cipher suite panjang secara manual. Pada JDK modern, default sering sudah lebih aman daripada daftar manual lama yang tidak pernah diperbarui.

Prinsip:

```text
Prefer modern JDK defaults unless you have a clear policy reason.
Constrain protocols and trust; avoid stale hand-curated cipher lists.
```

Kapan perlu custom cipher suite?

1. Compliance requirement.
2. Interoperability dengan partner legacy.
3. Hardening profile organisasi.
4. Testing known insecure suite rejection.
5. Migration plan dari legacy TLS.

Jika harus custom, dokumentasikan:

```text
- why this list exists
- who owns it
- when reviewed
- what server/client matrix it supports
- what is intentionally excluded
- how JDK upgrade affects it
```

---

## 19. HTTPS Client di Java Modern

Java punya `java.net.http.HttpClient` sejak Java 11 sebagai HTTP client modern.

Contoh dengan SSLContext custom:

```java
HttpClient client = HttpClient.newBuilder()
    .sslContext(sslContext)
    .connectTimeout(Duration.ofSeconds(5))
    .version(HttpClient.Version.HTTP_2)
    .build();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.partner.example/v1/status"))
    .timeout(Duration.ofSeconds(10))
    .GET()
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

Security checklist:

```text
[ ] Uses HTTPS URL only
[ ] Does not disable hostname verification
[ ] Uses partner-specific truststore if required
[ ] Uses client certificate only when required
[ ] Has timeout
[ ] Does not retry non-idempotent request blindly
[ ] Does not log Authorization header or mTLS cert private info
[ ] Separates TLS failure from HTTP failure
```

---

## 20. Common TLS Exceptions in Java

### 20.1 `PKIX path building failed`

Example:

```text
sun.security.provider.certpath.SunCertPathBuilderException:
unable to find valid certification path to requested target
```

Meaning:

```text
Client cannot build a trusted path from server cert to a trust anchor.
```

Possible causes:

- missing CA in truststore,
- server missing intermediate certificate,
- wrong truststore loaded,
- corporate proxy replacing certificate,
- certificate chain order issue,
- using private CA not known by JVM.

Wrong fix:

```text
Disable certificate validation.
```

Correct fixes:

```text
- import correct CA/intermediate into truststore
- fix server certificate chain
- use correct truststore path/password
- configure corporate proxy CA explicitly if policy allows
```

### 20.2 `No subject alternative DNS name matching ... found`

Meaning:

```text
Certificate chain is trusted, but hostname does not match SAN.
```

Correct fix:

```text
Issue certificate with correct SAN.
Use the hostname present in the certificate.
Do not disable hostname verification.
```

### 20.3 `Received fatal alert: handshake_failure`

Generic. Could mean:

- no shared TLS protocol,
- no shared cipher suite,
- server requires client cert,
- client cert rejected,
- unsupported signature algorithm,
- algorithm constraints,
- SNI missing,
- ALPN/application policy issue.

Need debug logs.

### 20.4 `bad_certificate` / `certificate_unknown`

Usually peer rejected certificate.

For mTLS client:

```text
Server rejected client certificate.
```

Causes:

- client cert not signed by trusted CA,
- missing client certificate,
- wrong alias selected,
- EKU missing clientAuth,
- expired certificate,
- revoked certificate,
- server mapping does not recognize subject/SAN.

### 20.5 `Algorithm constraints check failed`

Meaning:

```text
Certificate/key/signature/protocol violates JDK security policy.
```

Common causes:

- SHA1 certificate in rejected context,
- RSA key too small,
- disabled TLS version,
- disabled curve,
- old partner endpoint.

---

## 21. `javax.net.debug`: Cara Membaca TLS Handshake

Enable debug:

```bash
-Djavax.net.debug=ssl,handshake
```

Lebih detail:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Untuk security property debug:

```bash
-Djava.security.debug=certpath
```

Hal yang dicari:

```text
ClientHello
  - protocol versions
  - cipher suites
  - SNI
  - ALPN

ServerHello
  - selected protocol
  - selected cipher suite

Certificate
  - subject
  - issuer
  - SAN
  - validity
  - chain

CertificateRequest
  - server meminta client cert?

CertificateVerify
  - signature verification

Finished
  - handshake complete

Alerts
  - handshake_failure
  - bad_certificate
  - unknown_ca
  - protocol_version
```

Debug reading discipline:

```text
Do not start with exception message only.
Find the first TLS alert or certpath failure.
Then classify: protocol, cipher, chain, hostname, client-auth, algorithm constraint, or application protocol.
```

Security caution:

```text
TLS debug logs can expose certificate details, hostnames, and sometimes sensitive operational metadata.
Do not enable permanently in production.
Do not upload raw debug logs to external tools without sanitization.
```

---

## 22. TLS Through Proxy, Load Balancer, Gateway, and Service Mesh

Enterprise Java apps rarely terminate TLS only inside the application.

Possible TLS topologies:

```text
A. Client → Java app terminates TLS

B. Client → ALB/API Gateway terminates TLS → Java app HTTP

C. Client → ALB terminates TLS → re-encrypts TLS → Java app

D. Client → Service Mesh sidecar mTLS → Java app plaintext localhost

E. Client → Gateway mTLS → Java app receives identity header

F. Java app → outbound proxy → external server TLS
```

Each topology changes the trust boundary.

### 22.1 TLS Termination at Load Balancer

If ALB terminates TLS:

```text
External confidentiality ends at ALB.
Between ALB and app may be plaintext or re-encrypted.
```

Security questions:

```text
Is backend traffic within trusted private network?
Is there re-encryption to backend?
Can backend verify original client identity?
Are forwarded headers trusted only from gateway?
Can attacker spoof X-Forwarded-Proto or X-Forwarded-Client-Cert?
```

Never trust identity headers unless:

```text
- header is stripped/recreated by trusted gateway
- backend only accepts traffic from gateway
- network policy enforces path
- application has explicit trust-boundary logic
```

### 22.2 mTLS at Service Mesh

Service mesh can provide workload-to-workload mTLS.

But app still must know:

```text
Does authorization happen at mesh, app, or both?
Can app access peer identity?
Are policies versioned and audited?
What happens in permissive mode?
```

mTLS in mesh protects transport between workloads. It does not automatically implement business authorization.

---

## 23. Outbound TLS Policy in Microservices

Outbound TLS is often neglected.

Common bad pattern:

```text
Any service can call any HTTPS host.
Trust default JVM CA bundle.
No certificate inventory.
No endpoint allowlist.
No expiry monitoring.
No mTLS identity.
No per-partner trust boundary.
```

Better model:

```text
Outbound connection is a security decision.
```

Per outbound integration define:

| Decision | Example |
|---|---|
| Target identity | `api.partner.example` |
| Expected certificate trust | Public CA / private CA / pinned CA |
| Hostname verification | Required |
| Client auth | None / mTLS cert alias |
| Protocol | TLS 1.3/TLS 1.2 only |
| Data sensitivity | public/internal/confidential/restricted |
| Retry policy | idempotent only |
| Logging | no secrets |
| Owner | team/integration owner |
| Expiry monitoring | yes |

---

## 24. Certificate Pinning: Use Carefully

Certificate pinning means restricting trust beyond normal CA validation.

Forms:

| Pin Type | Description | Risk |
|---|---|---|
| Leaf certificate pin | Trust exact cert | Breaks every renewal |
| Public key pin | Trust key/SPKI | Breaks on key rotation |
| CA pin | Trust specific CA/intermediate | Less brittle but still operational risk |
| Truststore pinning | Use dedicated truststore | Practical enterprise pattern |

For backend Java integration, often better:

```text
Partner-specific truststore containing partner CA/intermediate
```

than hardcoded certificate hash in code.

Pinning requires:

```text
- rotation path
- backup pin
- expiry monitoring
- incident procedure
- documented owner
- test environment equivalent
```

Without those, pinning creates availability risk.

---

## 25. TLS and HTTP Security Headers

TLS protects transport. Browser-facing web applications also need HTTP-layer policies.

Important examples:

- HSTS,
- secure cookies,
- `HttpOnly`,
- SameSite,
- no mixed content,
- redirect HTTP to HTTPS,
- no sensitive data in URL.

HSTS tells browser to use HTTPS for future requests. But HSTS is browser behavior, not general Java service-to-service TLS.

For API/non-browser clients, HSTS does not protect you. The client must enforce HTTPS and TLS validation itself.

---

## 26. Data Classification and TLS

Not all TLS usage has same strength requirement.

Example classification:

| Data | TLS Requirement |
|---|---|
| Public static content | HTTPS standard public CA |
| Internal API | TLS + internal network policy |
| Confidential citizen/business data | TLS + strict certificate validation + monitoring |
| Legal/evidence files | TLS + payload integrity/signature + audit |
| Service admin API | mTLS + authorization + network allowlist |
| Key-management API | mTLS + hardware-backed key custody + audit |

Critical mental model:

```text
TLS may be necessary but not sufficient.
Highly sensitive payloads may also need application-level signing/encryption.
```

Example:

```text
TLS protects file upload in transit.
Detached signature protects evidence file integrity after storage/transfer.
Audit hash chain protects event sequence integrity after ingestion.
```

---

## 27. Secure TLS Configuration Checklist for Java Client

```text
[ ] Uses HTTPS/TLS, not plaintext protocol
[ ] Uses modern JDK runtime
[ ] Enables TLS 1.3 and TLS 1.2 only unless exception documented
[ ] Does not use trust-all TrustManager
[ ] Does not disable hostname verification
[ ] Supplies peer host to SSLEngine/SSLSocket where needed
[ ] Uses dedicated truststore for private PKI/partner integration
[ ] Uses mTLS client cert only for intended partner
[ ] Has deterministic key alias selection if multiple certs exist
[ ] Has connect/read/request timeouts
[ ] Handles TLS errors distinctly from HTTP errors
[ ] Does not retry unsafe requests blindly
[ ] Has certificate expiry monitoring
[ ] Has integration test against real certificate chain
[ ] Has documented exception path for legacy partner TLS
```

---

## 28. Secure TLS Configuration Checklist for Java Server

```text
[ ] Presents certificate with correct SAN
[ ] Sends full chain except root
[ ] Private key stored securely
[ ] Certificate renewed before expiry
[ ] TLS 1.3/TLS 1.2 only unless exception documented
[ ] Weak algorithms disabled by JDK/security policy
[ ] mTLS required for admin/internal sensitive APIs where appropriate
[ ] Client certificate mapped to service identity safely
[ ] mTLS identity is followed by authorization policy
[ ] Gateway/proxy headers are trusted only from trusted network path
[ ] TLS handshake failures are observable
[ ] Debug logging is not permanently enabled
[ ] Certificate/key rotation tested
[ ] Disaster recovery includes certificate/key material restoration plan
```

---

## 29. Secure Java Patterns

### Pattern 1 — Partner-Specific TLS Context

```text
Problem:
  One application calls multiple external/internal partners.

Risk:
  Shared truststore and shared client certificate widen blast radius.

Pattern:
  Create one SSLContext per integration boundary.

Invariant:
  Compromise/misconfiguration of Partner A trust config must not change Partner B trust.
```

Implementation shape:

```text
PartnerTlsConfig
  - partnerName
  - baseUri
  - trustStorePath
  - keyStorePath optional
  - keyAlias optional
  - protocols
  - timeout
  - owner
```

### Pattern 2 — mTLS Identity Mapping Layer

```text
Problem:
  Server validates client certificate but application needs service identity.

Pattern:
  Extract identity from SAN/URI SAN after TLS validation.
  Map to internal service principal.
  Apply authorization policy.

Invariant:
  A trusted certificate alone cannot bypass authorization.
```

### Pattern 3 — TLS Failure Classification

```text
Problem:
  Production has intermittent SSLHandshakeException.

Pattern:
  Classify failures into:
    - protocol/cipher mismatch
    - certificate chain/truststore
    - hostname verification
    - client certificate/mTLS
    - algorithm constraints
    - SNI/ALPN
    - network/proxy

Invariant:
  No trust validation is disabled as a troubleshooting shortcut.
```

### Pattern 4 — Rotation-Safe Certificate Deployment

```text
Problem:
  Certificate renewal breaks clients.

Pattern:
  Use CA/intermediate trust rather than leaf pinning where possible.
  Deploy new certificate chain before expiry.
  Monitor expiry.
  Test trust path in staging.
  Keep rollback material.

Invariant:
  Certificate rotation must not require code change.
```

---

## 30. Anti-Patterns

### Anti-Pattern 1 — Trust-All in DEV That Leaks to PROD

```text
Reason it happens:
  DEV self-signed cert causes PKIX error.

Why dangerous:
  Code/config copied to PROD disables server authentication.

Correct approach:
  Establish DEV CA and truststore.
```

### Anti-Pattern 2 — Disable Hostname Verification

```text
Reason it happens:
  Certificate SAN mismatch.

Why dangerous:
  Any cert from trusted CA for any hostname can be accepted.

Correct approach:
  Issue certificate with correct SAN or call correct hostname.
```

### Anti-Pattern 3 — One Huge Truststore

```text
Reason it happens:
  Easier operationally.

Why dangerous:
  Trust boundary becomes unclear; wrong endpoint may be accepted.

Correct approach:
  Use integration-specific truststores or clear CA policy.
```

### Anti-Pattern 4 — Leaf Certificate Pinning Without Rotation

```text
Reason it happens:
  Desire to be extra secure.

Why dangerous:
  Renewal outage.

Correct approach:
  Pin CA/public key with backup, or use dedicated truststore and monitoring.
```

### Anti-Pattern 5 — mTLS as Authorization

```text
Reason it happens:
  “Only trusted clients can connect.”

Why dangerous:
  All trusted clients may access all resources.

Correct approach:
  mTLS authenticates client identity; authorization remains separate.
```

### Anti-Pattern 6 — TLS Termination Without Trust Boundary Documentation

```text
Reason it happens:
  Infra owns ALB/gateway; app team assumes end-to-end TLS.

Why dangerous:
  Sensitive data may traverse plaintext internally or identity headers may be spoofable.

Correct approach:
  Document termination point, backend encryption, forwarded header trust, and network controls.
```

---

## 31. Mini Case Study: Java Service Calling Government Partner API with mTLS

### Scenario

A Java service calls partner API:

```text
https://partner-gateway.example.gov.sg/case-status
```

Requirements:

```text
- TLS server certificate must be validated.
- Hostname must match.
- Client must authenticate using mTLS certificate.
- Only this service may use the client certificate.
- Request contains sensitive case reference.
- Operation is read-only but still confidential.
```

### Bad Design

```text
- Global JVM truststore modified manually.
- One shared keystore for all partners.
- No explicit alias selection.
- Hostname verification disabled due to UAT mismatch.
- Retry all failures 3 times.
- TLS debug enabled in production logs.
```

Failure modes:

```text
- Wrong client cert selected.
- UAT workaround copied to PROD.
- MITM possible due to hostname verification disabled.
- Global truststore change affects unrelated integrations.
- Logs expose sensitive host/cert metadata.
```

### Better Design

```text
partner-api-client:
  baseUrl: https://partner-gateway.example.gov.sg
  truststore: partner-api-truststore.p12
  keystore: partner-api-client-identity.p12
  keyAlias: aceas-partner-api-client
  protocols: TLSv1.3,TLSv1.2
  hostnameVerification: HTTPS
  connectTimeout: 5s
  requestTimeout: 15s
  retry: only network timeout, max 1, no retry on TLS/cert failure
  owner: Case Integration Team
  expiryMonitoring: enabled
```

Invariant:

```text
This client must only trust the partner API identity boundary
and must only present its client certificate to the intended partner endpoint.
```

---

## 32. Mini Case Study: Internal Admin API with mTLS Behind Gateway

### Scenario

Internal admin API:

```text
Admin UI → Internal Gateway → Java Admin API
```

Gateway does mTLS with admin automation clients and forwards identity header:

```text
X-Client-Cert-Subject
X-Client-Service-Id
```

### Security Question

Can Java app trust those headers?

### Correct Answer

Only if:

```text
[ ] Java app only accepts traffic from gateway network/security group
[ ] Gateway strips incoming identity headers from external requests
[ ] Gateway recreates headers after successful mTLS validation
[ ] Header format is canonical and signed or protected by network boundary
[ ] App has explicit allowlist of gateway identity/source
[ ] App still performs authorization
```

Otherwise attacker may call backend directly and spoof headers.

### Better Pattern

```text
Gateway-authenticated identity
→ trusted internal identity assertion
→ backend validates source/gateway
→ backend maps service/user identity
→ backend applies authorization policy
→ audit logs identity source and confidence level
```

---

## 33. TLS Review Questions for Architecture/PR

Use these questions during design review:

```text
1. Where does TLS start and terminate?
2. Is traffic re-encrypted after gateway/load balancer?
3. Who owns server certificate renewal?
4. Where is private key stored?
5. What truststore is used by each client?
6. Is hostname verification enabled?
7. Is SNI needed and correctly supplied?
8. Is ALPN needed for HTTP/2/gRPC?
9. Are TLS 1.0/1.1 disabled?
10. Is mTLS required? If yes, how is client identity mapped?
11. Is mTLS followed by authorization?
12. Is revocation required? How is failure handled?
13. Is certificate expiry monitored?
14. Is there a certificate rotation runbook?
15. Are TLS debug logs disabled by default?
16. Are secrets/certs excluded from logs and heap dumps?
17. Are legacy exceptions documented with expiry date?
18. Does integration test validate real chain and hostname?
19. Does outbound retry policy distinguish TLS failure from transient network failure?
20. Can a truststore change for one partner affect another partner?
```

---

## 34. Production Troubleshooting Playbook

### Step 1 — Identify Direction

```text
Is Java acting as client or server?
```

Client-side failure:

```text
Java rejects server
or server rejects Java client certificate.
```

Server-side failure:

```text
Client rejects Java server cert
or Java server rejects client certificate.
```

### Step 2 — Classify Failure

```text
- DNS/routing/connect timeout?
- TLS protocol version?
- Cipher suite?
- Certificate chain?
- Hostname verification?
- Client certificate?
- Algorithm constraints?
- SNI?
- ALPN?
- Revocation?
```

### Step 3 — Gather Minimal Evidence

```text
- exact hostname and port
- Java version/vendor
- exception stack trace
- truststore/keystore config path, not password
- certificate chain from server
- enabled protocols/cipher suites
- whether proxy/load balancer exists
- whether mTLS is expected
- last certificate rotation/change date
```

### Step 4 — Avoid Unsafe Fixes

Never do these as “temporary fix” without containment:

```text
- trust-all TrustManager
- disable hostname verification
- enable TLS 1.0 globally
- import unknown leaf cert into global cacerts without review
- log full secrets/keystore passwords
- share raw production TLS debug logs externally
```

### Step 5 — Apply Targeted Fix

Examples:

| Symptom | Targeted Fix |
|---|---|
| PKIX path building failed | Fix truststore or server chain |
| Hostname mismatch | Reissue cert with correct SAN/use correct host |
| bad_certificate in mTLS | Fix client cert/trust/mapping/EKU |
| no cipher suites in common | Align protocol/cipher policy, upgrade legacy endpoint |
| algorithm constraints failed | Replace weak cert/key/algorithm |
| SNI missing | Ensure client supplies hostname |
| ALPN mismatch | Configure HTTP/2 or fallback correctly |

---

## 35. Java Code Skeleton: Dedicated TLS Context Builder

This is not production-complete, but illustrates structure.

```java
package example.security.tls;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Objects;

public final class TlsContextBuilder {

    private TlsContextBuilder() {
    }

    public static SSLContext build(
            Path trustStorePath,
            char[] trustStorePassword,
            Path keyStorePath,
            char[] keyStorePassword,
            char[] privateKeyPassword
    ) throws Exception {
        Objects.requireNonNull(trustStorePath, "trustStorePath must not be null");
        Objects.requireNonNull(trustStorePassword, "trustStorePassword must not be null");

        TrustManager[] trustManagers = loadTrustManagers(trustStorePath, trustStorePassword);
        KeyManager[] keyManagers = null;

        if (keyStorePath != null) {
            Objects.requireNonNull(keyStorePassword, "keyStorePassword must not be null when keyStorePath is provided");
            Objects.requireNonNull(privateKeyPassword, "privateKeyPassword must not be null when keyStorePath is provided");
            keyManagers = loadKeyManagers(keyStorePath, keyStorePassword, privateKeyPassword);
        }

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(keyManagers, trustManagers, SecureRandom.getInstanceStrong());
        return sslContext;
    }

    private static TrustManager[] loadTrustManagers(Path path, char[] password) throws Exception {
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(path)) {
            trustStore.load(input, password);
        }

        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(trustStore);
        return factory.getTrustManagers();
    }

    private static KeyManager[] loadKeyManagers(Path path, char[] storePassword, char[] keyPassword) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(path)) {
            keyStore.load(input, storePassword);
        }

        KeyManagerFactory factory = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        factory.init(keyStore, keyPassword);
        return factory.getKeyManagers();
    }
}
```

Production improvements:

```text
[ ] avoid logging password/secret
[ ] clear password char[] after use if lifecycle allows
[ ] support explicit key alias
[ ] support reload/rotation
[ ] support metrics for reload failure
[ ] validate keystore contains expected alias
[ ] validate certificate expiry at startup
[ ] validate EKU/key usage expectations
[ ] expose safe diagnostic metadata
```

---

## 36. Java Code Skeleton: Enforcing Endpoint Identification on `SSLEngine`

```java
SSLContext sslContext = /* build dedicated context */;

String host = "api.partner.example";
int port = 443;

SSLEngine engine = sslContext.createSSLEngine(host, port);
engine.setUseClientMode(true);

SSLParameters parameters = engine.getSSLParameters();
parameters.setEndpointIdentificationAlgorithm("HTTPS");
parameters.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
parameters.setApplicationProtocols(new String[] {"h2", "http/1.1"});

engine.setSSLParameters(parameters);
```

Important:

```text
The engine must know the peer host if you expect SNI and endpoint identification.
```

---

## 37. Java Code Skeleton: Safe-ish Certificate Expiry Inspection

```java
package example.security.tls;

import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Enumeration;

public final class CertificateExpiryInspector {

    private CertificateExpiryInspector() {
    }

    public static void inspect(KeyStore keyStore, int warningDays) throws Exception {
        Instant warningThreshold = Instant.now().plus(warningDays, ChronoUnit.DAYS);

        Enumeration<String> aliases = keyStore.aliases();
        while (aliases.hasMoreElements()) {
            String alias = aliases.nextElement();

            if (!keyStore.isCertificateEntry(alias) && !keyStore.isKeyEntry(alias)) {
                continue;
            }

            if (keyStore.getCertificate(alias) instanceof X509Certificate certificate) {
                Instant notAfter = certificate.getNotAfter().toInstant();

                if (notAfter.isBefore(Instant.now())) {
                    throw new IllegalStateException("Certificate alias " + alias + " is expired");
                }

                if (notAfter.isBefore(warningThreshold)) {
                    // In production, emit metric/structured warning instead of println.
                    System.out.println("Certificate alias " + alias + " expires soon at " + notAfter);
                }
            }
        }
    }
}
```

Do not expose full certificate subject or internal hostnames in public logs unless log classification allows it.

---

## 38. What Top Engineers Internalize About TLS

A strong Java security engineer does not think:

```text
We use HTTPS, so it is secure.
```

They think:

```text
What exact identity is authenticated?
Where is the channel terminated?
Who owns the trust anchor?
Is hostname verification active?
What happens during rotation?
What is the blast radius of this truststore?
Is mTLS identity authorized or merely authenticated?
Can debug/ops practices leak sensitive metadata?
Does the design survive proxy/gateway/service-mesh topology?
```

TLS is a security protocol, but in production it becomes a **socio-technical system**:

```text
certificate issuance
+ private key custody
+ runtime config
+ Java provider behavior
+ proxy topology
+ truststore lifecycle
+ renewal automation
+ monitoring
+ incident response
+ developer discipline
```

The weakest link is often not AES-GCM or ECDHE. It is usually:

```text
- wrong certificate chain
- missing hostname verification
- trust-all workaround
- expired cert
- unclear TLS termination boundary
- over-broad truststore
- mTLS without authorization
- no rotation runbook
```

---

## 39. Summary

TLS in Java is not just `https://` or `SSLContext` boilerplate.

The essential model:

```text
TLS establishes a secure channel over an untrusted network.
JSSE is Java's abstraction for configuring and running that channel.
Keystore answers: who am I?
Truststore answers: who do I trust?
Hostname verification answers: is this certificate for the host I called?
mTLS answers: can both sides prove possession of their private keys?
Authorization still answers: is this authenticated peer allowed to do this action?
```

Part ini memberi foundation untuk:

- TLS hardening,
- disabled algorithms,
- runtime security properties,
- secure token transport,
- mTLS service identity,
- API gateway trust boundary,
- production TLS incident diagnosis.

---

## 40. Review Checklist

Sebelum menyatakan desain TLS aman, jawab ini:

```text
[ ] Saya tahu TLS terminate di mana.
[ ] Saya tahu certificate siapa yang dipresentasikan.
[ ] Saya tahu private key disimpan di mana.
[ ] Saya tahu truststore mana yang dipakai.
[ ] Saya tahu hostname verification aktif.
[ ] Saya tahu apakah mTLS dipakai.
[ ] Saya tahu mTLS identity dipetakan ke authorization policy.
[ ] Saya tahu certificate expiry dimonitor.
[ ] Saya tahu cara rotate certificate tanpa code change.
[ ] Saya tahu debug TLS tidak membocorkan data sensitif.
[ ] Saya tahu policy legacy TLS exception, jika ada.
[ ] Saya tahu outbound trust boundary per partner/integration.
```

---

## 41. Status Seri

Seri **belum selesai**.

Kita sudah menyelesaikan:

```text
Part 0  — Security Mental Model for Senior Java Engineers
Part 1  — Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
Part 2  — Threat Modeling for Java Systems
Part 3  — Cryptography Mental Model: What Crypto Can and Cannot Guarantee
Part 4  — Randomness, Entropy, Nonce, Salt, IV, Token
Part 5  — Hashing, Digest, Fingerprint, Checksum, and Integrity Boundaries
Part 6  — Password Storage, Password Verification, and Secret-Derived Keys
Part 7  — Symmetric Encryption in Java: AES, Modes, Padding, AEAD
Part 8  — Message Authentication Code: HMAC, CMAC, and Integrity Tokens
Part 9  — Digital Signature: RSA, ECDSA, EdDSA, Signing Semantics
Part 10 — Asymmetric Encryption and Key Agreement
Part 11 — Key Management: Lifecycle, Rotation, Wrapping, KMS, HSM
Part 12 — Java KeyStore, TrustStore, Certificates, and Private Key Custody
Part 13 — X.509, PKI, Certificate Path Validation, Revocation
Part 14 — TLS/JSSE Deep Dive for Java Engineers
```

Berikutnya:

```text
Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-013.md">⬅️ X.509, PKI, Certificate Path Validation, Revocation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-015.md">Part 15 — TLS Hardening, Disabled Algorithms, and Runtime Security Properties ➡️</a>
</div>
