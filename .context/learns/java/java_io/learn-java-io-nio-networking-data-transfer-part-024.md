# Part 024 — TLS, Certificates, TrustStore, KeyStore, dan Secure Data Transfer

> Seri: `learn-java-io-nio-networking-data-transfer`  
> Fokus: Java I/O, NIO, NIO.2, networking, dan data transfer production-grade  
> Level: Advanced  
> Prasyarat: Part 019 sampai Part 023, terutama socket, TCP framing, dan HTTP data transfer

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami TLS bukan sebagai “fitur HTTPS”, tetapi sebagai **security layer di atas transport**.
2. Membedakan dengan jelas:
   - encryption,
   - integrity,
   - authentication,
   - authorization,
   - confidentiality,
   - trust.
3. Memahami peran:
   - certificate,
   - certificate chain,
   - CA,
   - root CA,
   - intermediate CA,
   - trust anchor,
   - truststore,
   - keystore,
   - private key,
   - public key,
   - session,
   - handshake.
4. Mengerti bagaimana Java mengimplementasikan TLS melalui JSSE.
5. Menggunakan `SSLContext`, `TrustManager`, `KeyManager`, `SSLSocket`, `SSLServerSocket`, dan `HttpClient` secara aman.
6. Mendesain secure data transfer untuk production, termasuk:
   - server authentication,
   - mutual TLS,
   - certificate rotation,
   - truststore management,
   - timeout,
   - retry,
   - audit,
   - observability,
   - secret handling.
7. Mengenali anti-pattern yang sering berbahaya:
   - trust-all certificate,
   - disable hostname verification,
   - hardcoded keystore password,
   - import certificate sembarangan ke global `cacerts`,
   - log private key atau token,
   - menganggap TLS otomatis menyelesaikan semua security problem.

---

## 2. Referensi Resmi yang Digunakan

Materi ini disusun berdasarkan dokumentasi resmi Java dan OpenJDK, terutama:

- Java Secure Socket Extension atau JSSE Reference Guide.
- Java API `javax.net.ssl`.
- Java API `SSLContext`, `SSLSocket`, `SSLServerSocket`, `SSLParameters`, `TrustManager`, `KeyManager`.
- Java API `java.security.KeyStore`.
- Java `keytool` command documentation.
- Java HTTP Client API `java.net.http.HttpClient`.

Catatan penting: API dan default security policy bisa berubah antar versi JDK. Untuk production, selalu validasi terhadap versi JDK runtime yang benar-benar dipakai.

---

## 3. Mental Model Besar

TLS sering disederhanakan menjadi:

> “Pakai HTTPS supaya aman.”

Itu terlalu dangkal.

Mental model yang lebih benar:

```text
Application Protocol
  HTTP / custom binary / SMTP / LDAP / database protocol / etc.

TLS Layer
  handshake
  certificate validation
  key exchange
  encryption
  integrity protection
  optional client authentication

Transport Layer
  TCP connection
  socket
  timeout
  congestion control
  packet retransmission

Network Layer
  IP routing
  firewall
  NAT
  DNS
```

TLS tidak mengganti TCP. TLS berjalan **di atas TCP** dan memberikan secure channel kepada application protocol.

Artinya:

- TCP tetap bisa timeout.
- TCP tetap bisa putus.
- TLS handshake bisa gagal sebelum HTTP request terkirim.
- TLS tidak memberi message boundary untuk protocol aplikasi.
- TLS tidak membuat retry otomatis aman.
- TLS tidak membuat payload otomatis valid secara bisnis.
- TLS tidak menggantikan authorization.
- TLS tidak menggantikan audit trail.

TLS menjawab pertanyaan security berikut:

```text
1. Apakah saya berbicara dengan server yang benar?
2. Apakah data yang saya kirim tidak bisa dibaca pihak lain di tengah jalan?
3. Apakah data tidak dimodifikasi diam-diam selama transit?
4. Jika mutual TLS digunakan: apakah client juga bisa dibuktikan identitasnya?
```

Namun TLS tidak menjawab:

```text
1. Apakah user boleh mengakses resource ini?
2. Apakah request idempotent?
3. Apakah file yang dikirim formatnya benar?
4. Apakah data bebas malware?
5. Apakah receiver sudah memproses file sampai selesai?
6. Apakah retry akan membuat duplikasi?
7. Apakah sistem downstream berhasil commit?
```

Inilah kenapa secure data transfer tidak berhenti di “pakai HTTPS”.

---

## 4. TLS sebagai Boundary, Bukan Fitur Tunggal

Dalam data transfer, TLS adalah salah satu boundary.

```text
Producer
  |
  | application validation
  | serialization / encoding
  | compression? optional
  | checksum
  | chunking
  | idempotency key
  v
TLS connection boundary
  |
  | encrypted in transit
  | server certificate validation
  | optional client certificate validation
  v
Receiver
  |
  | authorization
  | payload validation
  | checksum verification
  | atomic storage
  | audit
  | acknowledgement
```

TLS melindungi data **selama transit**. Setelah data sampai di endpoint, data kembali berada di memory, disk, log, database, queue, atau object storage. Di titik itu TLS tidak lagi melindungi data.

Karena itu secure data transfer harus memikirkan:

- secure in transit,
- secure at rest,
- secure in memory,
- secure in logs,
- secure in metrics,
- secure in retry payload,
- secure in temporary file,
- secure in backup,
- secure in operator access.

---

## 5. Istilah Fundamental

### 5.1 Confidentiality

Confidentiality berarti pihak yang tidak berhak tidak bisa membaca data.

TLS menyediakan confidentiality melalui encryption.

Contoh ancaman:

```text
Client ---- attacker ---- Server
```

Tanpa TLS, attacker di jaringan bisa membaca payload.

Dengan TLS yang valid, attacker hanya melihat encrypted traffic.

Namun confidentiality bisa tetap bocor jika:

- payload dicetak ke log,
- request body masuk APM trace tanpa masking,
- file sementara permission-nya terlalu longgar,
- private key dicuri,
- TLS dimatikan di proxy internal tanpa kontrol lanjutan,
- certificate validation dinonaktifkan.

### 5.2 Integrity

Integrity berarti data tidak dapat dimodifikasi diam-diam selama transit.

TLS menyediakan integrity protection. Jika encrypted record dimodifikasi, validasi cryptographic integrity gagal.

Namun application-level integrity tetap bisa dibutuhkan, misalnya:

- checksum file,
- hash manifest,
- signature payload,
- record count,
- business reconciliation.

Kenapa?

Karena TLS hanya melindungi transit antar dua endpoint TLS. Jika data melewati banyak tahap internal setelah TLS termination, integrity end-to-end belum tentu terjamin.

### 5.3 Authentication

Authentication berarti membuktikan identitas pihak yang berkomunikasi.

Dalam HTTPS biasa:

```text
Client authenticates server.
Server biasanya tidak authenticate client dengan certificate.
```

Client memverifikasi server melalui certificate chain dan hostname.

Dalam mutual TLS:

```text
Client authenticates server.
Server authenticates client.
```

Client mengirim certificate juga.

### 5.4 Authorization

Authorization berarti menentukan apakah identity yang sudah terverifikasi boleh melakukan aksi tertentu.

TLS server authentication tidak otomatis berarti client boleh mengakses resource.

Mutual TLS juga tidak otomatis cukup. Setelah client certificate valid, server tetap perlu mapping:

```text
certificate subject / SAN / fingerprint / SPIFFE ID / internal identity
    -> client application identity
    -> role / permission / tenant / scope
    -> allowed operation
```

### 5.5 Trust

Trust bukan “certificate ada”.

Trust adalah keputusan:

```text
Saya percaya certificate ini karena chain-nya berakhir pada trust anchor yang saya percaya,
dan hostname/identity-nya cocok dengan endpoint yang saya tuju,
dan certificate belum expired/revoked,
dan policy saya mengizinkan algorithm/protocol tersebut.
```

---

## 6. Certificate Mental Model

Certificate adalah dokumen digital yang mengikat public key dengan identity.

Sederhananya:

```text
Certificate
  subject identity
  public key
  issuer
  validity period
  extensions
  signature by issuer
```

Certificate tidak menyimpan private key.

Private key harus disimpan secara terpisah dan dijaga ketat.

### 6.1 Public Key dan Private Key

```text
Private Key
  - rahasia
  - tidak boleh keluar sembarangan
  - digunakan untuk membuktikan kepemilikan identity

Public Key
  - boleh dibagikan
  - tertanam dalam certificate
  - digunakan oleh pihak lain untuk proses cryptographic verification/key agreement
```

Jika private key bocor, certificate identity tersebut harus dianggap kompromi.

### 6.2 Certificate Chain

Umumnya server certificate tidak langsung ditandatangani root CA.

Struktur umum:

```text
Root CA
  |
  v
Intermediate CA
  |
  v
Server Certificate
```

Client biasanya menyimpan root CA sebagai trust anchor. Server mengirim server certificate dan intermediate certificate. Client membangun chain sampai root CA yang dipercaya.

Jika intermediate certificate tidak dikirim dengan benar, error umum:

```text
PKIX path building failed
unable to find valid certification path to requested target
```

### 6.3 Root CA

Root CA adalah trust anchor. Ia dipercaya secara langsung oleh truststore.

Kalau truststore berisi root CA yang terlalu luas atau tidak dikontrol, sistem akan mempercayai terlalu banyak endpoint.

### 6.4 Intermediate CA

Intermediate CA menandatangani server certificate. Intermediate memungkinkan root CA tetap offline dan mengurangi risiko operasional.

### 6.5 Self-Signed Certificate

Self-signed certificate ditandatangani oleh dirinya sendiri.

Self-signed tidak otomatis buruk untuk internal development/lab, tetapi untuk production harus dikelola dengan jelas:

- siapa issuer-nya,
- bagaimana distribusi truststore,
- bagaimana rotation,
- bagaimana revoke,
- bagaimana audit.

Kesalahan umum adalah memakai self-signed certificate lalu menonaktifkan certificate validation. Itu bukan solusi; itu menghapus manfaat TLS authentication.

---

## 7. TrustStore vs KeyStore

Ini sumber kebingungan terbesar di Java TLS.

### 7.1 TrustStore

Truststore berisi certificate yang dipercaya untuk memverifikasi pihak lain.

Untuk client HTTPS:

```text
Client truststore
  berisi root/intermediate CA yang dipercaya
  digunakan untuk memverifikasi server certificate
```

Untuk server mutual TLS:

```text
Server truststore
  berisi CA yang dipercaya untuk memverifikasi client certificate
```

Pertanyaan yang dijawab truststore:

```text
Siapa yang saya percaya?
```

### 7.2 KeyStore

Keystore berisi private key dan certificate chain milik aplikasi sendiri.

Untuk server HTTPS:

```text
Server keystore
  berisi private key server
  berisi certificate chain server
  digunakan untuk membuktikan identitas server ke client
```

Untuk client mutual TLS:

```text
Client keystore
  berisi private key client
  berisi certificate chain client
  digunakan untuk membuktikan identitas client ke server
```

Pertanyaan yang dijawab keystore:

```text
Saya membuktikan diri sebagai siapa?
```

### 7.3 Perbandingan Ringkas

| Aspek | TrustStore | KeyStore |
|---|---|---|
| Fungsi | Memverifikasi pihak lain | Membuktikan identitas sendiri |
| Isi utama | Trusted CA certificate | Private key + own certificate chain |
| Digunakan oleh | `TrustManager` | `KeyManager` |
| Client HTTPS biasa perlu? | Ya | Tidak selalu |
| Server HTTPS perlu? | Tidak selalu, kecuali mTLS | Ya |
| Client mTLS perlu? | Ya | Ya |
| Server mTLS perlu? | Ya | Ya |

### 7.4 Diagram HTTPS Biasa

```text
Client JVM
  truststore
    trusted Root CA
      |
      validates
      v
Server certificate chain
  server certificate
  intermediate certificate

Server JVM
  keystore
    server private key
    server certificate chain
```

### 7.5 Diagram Mutual TLS

```text
Client JVM
  truststore: CA untuk server
  keystore: client private key + client cert

Server JVM
  truststore: CA untuk client
  keystore: server private key + server cert
```

Kedua sisi melakukan authentication.

---

## 8. JSSE di Java

Java menyediakan TLS melalui JSSE: Java Secure Socket Extension.

Komponen penting:

```text
SSLContext
  pusat konfigurasi TLS runtime

TrustManager
  memutuskan apakah certificate pihak lain dipercaya

KeyManager
  memilih private key/certificate milik sendiri

SSLSocketFactory
  membuat SSLSocket client

SSLServerSocketFactory
  membuat SSLServerSocket server

SSLSocket
  socket TLS client/server

SSLServerSocket
  server socket TLS

SSLParameters
  konfigurasi TLS tambahan
```

Mental model konfigurasi:

```text
KeyStore file
  -> KeyManagerFactory
  -> KeyManager[]

TrustStore file
  -> TrustManagerFactory
  -> TrustManager[]

KeyManager[] + TrustManager[] + SecureRandom
  -> SSLContext.init(...)
  -> SSLSocketFactory / SSLServerSocketFactory / HttpClient SSLContext
```

---

## 9. Default TLS Behavior di Java

Jika kamu membuat `HttpClient` biasa:

```java
HttpClient client = HttpClient.newHttpClient();
```

Java menggunakan default SSL context.

Default ini umumnya memakai default truststore JDK atau konfigurasi system properties.

Hal yang perlu dipahami:

- default truststore cocok untuk public internet CA umum,
- default truststore belum tentu tahu internal enterprise CA,
- container image bisa punya CA berbeda,
- JDK update bisa mengubah isi `cacerts`,
- corporate proxy TLS inspection bisa membuat certificate chain berbeda,
- runtime property bisa override default behavior.

Production system tidak boleh mengandalkan asumsi kabur seperti:

> “Di laptop saya HTTPS-nya jalan.”

Harus jelas:

```text
Runtime JDK apa?
Truststore mana?
CA apa yang dipercaya?
Hostname apa yang divalidasi?
Apakah lewat proxy?
Apakah TLS terminate di gateway?
Apakah mTLS dipakai?
```

---

## 10. TLS Handshake secara Konseptual

TLS handshake detail cryptographic-nya kompleks, tetapi mental model engineering-nya bisa dipahami sebagai beberapa tahap:

```text
1. Client membuka TCP connection.
2. Client memulai TLS handshake.
3. Client dan server negotiate protocol version/cipher suite.
4. Server mengirim certificate chain.
5. Client memvalidasi certificate chain.
6. Client memvalidasi hostname/endpoint identity.
7. Key agreement dilakukan.
8. Secure session terbentuk.
9. Application data dikirim dalam encrypted TLS records.
```

Untuk mutual TLS:

```text
Server juga meminta client certificate.
Client mengirim certificate chain miliknya.
Server memvalidasi client certificate.
Server memetakan certificate ke identity aplikasi/client.
```

Failure bisa terjadi di banyak titik:

| Tahap | Failure Umum |
|---|---|
| TCP connect | connection refused, timeout, firewall |
| TLS negotiation | protocol/cipher mismatch |
| Server certificate | expired, untrusted CA, missing intermediate |
| Hostname verification | certificate tidak cocok dengan host tujuan |
| Client certificate | missing cert, wrong cert, expired cert |
| Authorization | cert valid tapi identity tidak punya akses |
| Application data | HTTP 401/403/500, corrupted payload, retry issue |

---

## 11. Hostname Verification

Certificate chain valid saja tidak cukup.

Client juga harus memastikan certificate memang untuk hostname yang dituju.

Contoh:

```text
Client request:
  https://api.payment.internal.example.com

Server certificate harus valid untuk:
  api.payment.internal.example.com
```

Biasanya identity hostname berada di Subject Alternative Name atau SAN.

Jika certificate valid tetapi untuk hostname lain, koneksi harus gagal.

Anti-pattern berbahaya:

```java
// Jangan lakukan ini di production
hostnameVerifier = (hostname, session) -> true;
```

Ini membuka peluang man-in-the-middle karena client menerima certificate untuk hostname apa pun.

### 11.1 Kenapa Trust-All Berbahaya?

Kode seperti ini sering muncul di tutorial buruk:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Ini berarti:

```text
Certificate apa pun diterima.
Issuer apa pun diterima.
Expired certificate bisa lolos jika tidak dicek.
MITM bisa diterima.
Internal malicious proxy bisa diterima.
```

Trust-all bukan “fix SSL issue”. Trust-all adalah mematikan authentication.

---

## 12. Protocol Version dan Cipher Suite

TLS memakai protocol version dan cipher suite.

Contoh concept:

```text
TLS protocol version:
  TLS 1.2
  TLS 1.3

Cipher suite:
  mekanisme key exchange
  authentication
  encryption
  integrity
```

Pada JDK modern, default biasanya sudah mengikuti policy keamanan runtime. Namun enterprise system sering punya masalah:

- server lama hanya mendukung protocol tua,
- client baru menolak cipher lama,
- security policy men-disable algorithm tertentu,
- load balancer punya TLS profile berbeda,
- backend internal masih menggunakan certificate/cipher legacy.

Engineering rule:

```text
Jangan menurunkan security setting tanpa memahami risiko dan tanpa expiry plan.
```

Jika perlu mendukung legacy sementara, dokumentasikan:

- endpoint mana,
- alasan bisnis,
- risk acceptance,
- target decommission,
- monitoring,
- owner.

---

## 13. Format Keystore: JKS, PKCS12, PEM

Java historically mengenal JKS. Format yang sangat umum saat ini adalah PKCS#12.

### 13.1 JKS

JKS adalah Java KeyStore format historis.

Ciri:

- sering ditemukan di sistem Java lama,
- didukung oleh `keytool`,
- kurang portable dibanding PKCS#12.

### 13.2 PKCS#12

PKCS#12 biasanya berekstensi `.p12` atau `.pfx`.

Ciri:

- umum lintas ecosystem,
- dapat menyimpan private key dan certificate chain,
- sering dipakai untuk mTLS client certificate.

### 13.3 PEM

PEM biasanya berbentuk text base64 dengan header:

```text
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

Private key PEM:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

Banyak service/cloud/tooling memakai PEM. Java standard API historically lebih nyaman dengan `KeyStore`, tetapi bisa memuat PEM dengan parsing tambahan atau konversi ke PKCS#12.

### 13.4 Practical Rule

Untuk Java service modern:

```text
Prefer PKCS#12 untuk keystore aplikasi.
Gunakan custom truststore terpisah untuk internal CA.
Jangan modifikasi global cacerts jika bisa dihindari.
```

Kenapa jangan sembarangan modifikasi global `cacerts`?

- JDK update bisa mengganti file.
- Sulit audit siapa menambahkan CA apa.
- Semua aplikasi di runtime yang sama ikut percaya CA tersebut.
- Container image rebuild bisa hilang.
- Environment drift sulit dideteksi.

Lebih baik:

```text
app-specific truststore
mounted as secret/config
versioned via deployment pipeline
rotated secara terencana
```

---

## 14. `keytool` untuk Operasional Dasar

`keytool` adalah utility Java untuk mengelola key dan certificate.

### 14.1 Melihat Isi Keystore/Truststore

```bash
keytool -list \
  -keystore truststore.p12 \
  -storetype PKCS12
```

Verbose:

```bash
keytool -list -v \
  -keystore truststore.p12 \
  -storetype PKCS12
```

### 14.2 Import CA Certificate ke Truststore

```bash
keytool -importcert \
  -alias internal-root-ca \
  -file internal-root-ca.crt \
  -keystore truststore.p12 \
  -storetype PKCS12
```

### 14.3 Generate Key Pair untuk Lab

```bash
keytool -genkeypair \
  -alias server \
  -keyalg RSA \
  -keysize 3072 \
  -validity 365 \
  -keystore server-keystore.p12 \
  -storetype PKCS12 \
  -dname "CN=localhost, OU=Engineering, O=Example, L=Jakarta, C=ID" \
  -ext SAN=dns:localhost,ip:127.0.0.1
```

Catatan:

- Untuk production, certificate biasanya diterbitkan oleh CA/internal PKI, bukan generate sendiri sembarangan.
- SAN sangat penting untuk hostname verification.
- `CN` saja tidak boleh dijadikan asumsi modern.

### 14.4 Export Certificate

```bash
keytool -exportcert \
  -alias server \
  -keystore server-keystore.p12 \
  -storetype PKCS12 \
  -rfc \
  -file server.crt
```

### 14.5 Convert JKS ke PKCS12

```bash
keytool -importkeystore \
  -srckeystore legacy.jks \
  -destkeystore modern.p12 \
  -deststoretype PKCS12
```

---

## 15. Membuat `SSLContext` Custom

Kita sering butuh custom `SSLContext` untuk:

- custom truststore internal CA,
- mTLS client certificate,
- test environment,
- isolated trust per external partner,
- migration dari legacy certificate.

### 15.1 Load TrustStore

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class TlsContexts {

    private TlsContexts() {
    }

    public static SSLContext sslContextWithTrustStore(
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

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, tmf.getTrustManagers(), null);
        return context;
    }
}
```

Important points:

```text
KeyStore.load(...) membaca store dari file.
TrustManagerFactory mengubah truststore menjadi TrustManager.
SSLContext.init(null, trustManagers, null) berarti tidak memakai client key.
```

### 15.2 Load KeyStore untuk Mutual TLS

```java
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class MtlsContextFactory {

    private MtlsContextFactory() {
    }

    public static SSLContext createMtlsClientContext(
            Path keyStorePath,
            char[] keyStorePassword,
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
        kmf.init(keyStore, keyStorePassword);

        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(trustStorePath)) {
            trustStore.load(in, trustStorePassword);
        }

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        tmf.init(trustStore);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
        return context;
    }
}
```

Important points:

```text
KeyManager membuktikan identitas kita.
TrustManager memverifikasi pihak lain.
Keduanya dibutuhkan untuk mTLS.
```

### 15.3 Password Handling

Gunakan `char[]`, bukan `String`, untuk password API security klasik.

Namun jangan salah paham:

- `char[]` hanya memberi peluang untuk clear memory lebih cepat.
- JVM dan libraries tetap bisa punya copy internal.
- Secret handling utama tetap harus melalui secret manager, file permission, process isolation, dan deployment discipline.

Contoh cleanup:

```java
import java.util.Arrays;

char[] password = loadPassword();
try {
    // use password
} finally {
    Arrays.fill(password, '\0');
}
```

---

## 16. Menggunakan Custom TLS dengan Java HTTP Client

```java
import javax.net.ssl.SSLContext;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class SecureHttpDownload {

    public static void main(String[] args) throws Exception {
        SSLContext sslContext = TlsContexts.sslContextWithTrustStore(
                java.nio.file.Path.of("config/truststore.p12"),
                System.getenv("TRUSTSTORE_PASSWORD").toCharArray()
        );

        HttpClient client = HttpClient.newBuilder()
                .sslContext(sslContext)
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://partner.example.com/data/export.ndjson"))
                .timeout(Duration.ofMinutes(2))
                .GET()
                .build();

        HttpResponse<java.nio.file.Path> response = client.send(
                request,
                HttpResponse.BodyHandlers.ofFile(
                        java.nio.file.Path.of("download/export.ndjson.tmp")
                )
        );

        if (response.statusCode() != 200) {
            throw new IllegalStateException("Unexpected HTTP status: " + response.statusCode());
        }
    }
}
```

Key points:

- `connectTimeout` membatasi waktu membuka koneksi.
- `HttpRequest.timeout` membatasi request duration.
- `BodyHandlers.ofFile` menghindari load seluruh response ke memory.
- File sementara harus dipromosikan secara atomic setelah validasi checksum.

---

## 17. Menggunakan `SSLSocket`

Untuk custom protocol di atas TLS, kamu bisa memakai `SSLSocket`.

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

public class TlsSocketClient {

    public static void main(String[] args) throws Exception {
        SSLContext sslContext = TlsContexts.sslContextWithTrustStore(
                java.nio.file.Path.of("config/truststore.p12"),
                System.getenv("TRUSTSTORE_PASSWORD").toCharArray()
        );

        SSLSocketFactory factory = sslContext.getSocketFactory();

        try (SSLSocket socket = (SSLSocket) factory.createSocket("localhost", 8443)) {
            socket.setSoTimeout(10_000);
            socket.startHandshake();

            OutputStream out = socket.getOutputStream();
            InputStream in = socket.getInputStream();

            byte[] payload = "ping".getBytes(StandardCharsets.UTF_8);
            byte[] length = ByteBuffer.allocate(Integer.BYTES)
                    .putInt(payload.length)
                    .array();

            out.write(length);
            out.write(payload);
            out.flush();

            byte[] responseLengthBytes = in.readNBytes(Integer.BYTES);
            if (responseLengthBytes.length != Integer.BYTES) {
                throw new IllegalStateException("Connection closed before response length");
            }

            int responseLength = ByteBuffer.wrap(responseLengthBytes).getInt();
            if (responseLength < 0 || responseLength > 1_048_576) {
                throw new IllegalStateException("Invalid response length: " + responseLength);
            }

            byte[] response = in.readNBytes(responseLength);
            if (response.length != responseLength) {
                throw new IllegalStateException("Connection closed before full response");
            }

            System.out.println(new String(response, StandardCharsets.UTF_8));
        }
    }
}
```

Important:

- TLS tidak menggantikan framing.
- `SSLSocket` tetap stream-oriented.
- Kamu tetap perlu length-prefix atau framing protocol.
- `read()` tetap bisa partial.
- `readNBytes()` bisa return lebih pendek jika EOF.

---

## 18. Membuat TLS Server Sederhana dengan `SSLServerSocket`

Contoh ini untuk memahami konsep, bukan production server final.

```java
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocket;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public class TlsEchoServer {

    public static void main(String[] args) throws Exception {
        SSLContext context = createServerContext(
                Path.of("config/server-keystore.p12"),
                System.getenv("KEYSTORE_PASSWORD").toCharArray()
        );

        SSLServerSocketFactory factory = context.getServerSocketFactory();

        try (SSLServerSocket serverSocket = (SSLServerSocket) factory.createServerSocket(8443)) {
            while (true) {
                SSLSocket socket = (SSLSocket) serverSocket.accept();
                Thread.ofVirtual().start(() -> handle(socket));
            }
        }
    }

    private static SSLContext createServerContext(Path keyStorePath, char[] password) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(keyStorePath)) {
            keyStore.load(in, password);
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, password);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(kmf.getKeyManagers(), null, null);
        return context;
    }

    private static void handle(SSLSocket socket) {
        try (socket) {
            socket.setSoTimeout(10_000);
            socket.startHandshake();

            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            byte[] lengthBytes = in.readNBytes(Integer.BYTES);
            if (lengthBytes.length != Integer.BYTES) {
                return;
            }

            int length = ByteBuffer.wrap(lengthBytes).getInt();
            if (length < 0 || length > 1_048_576) {
                return;
            }

            byte[] payload = in.readNBytes(length);
            if (payload.length != length) {
                return;
            }

            out.write(lengthBytes);
            out.write(payload);
            out.flush();
        } catch (Exception e) {
            // In production: structured log with correlation id, no sensitive payload.
            e.printStackTrace();
        }
    }
}
```

Key points:

- Server membutuhkan keystore karena server harus membuktikan identitasnya.
- Truststore tidak wajib untuk server biasa.
- Untuk mutual TLS, server juga butuh truststore dan `setNeedClientAuth(true)`.

---

## 19. Mutual TLS Server Concept

Untuk mTLS server:

```java
serverSocket.setNeedClientAuth(true);
```

Namun itu saja belum cukup.

Server juga perlu truststore yang berisi CA untuk memverifikasi client certificate.

Conceptual setup:

```text
Server SSLContext
  KeyManager: server identity
  TrustManager: trusted client CA

SSLServerSocket
  needClientAuth = true
```

Pseudocode:

```java
SSLContext context = SSLContext.getInstance("TLS");
context.init(serverKeyManagers, clientTrustManagers, null);

SSLServerSocket serverSocket = ...;
serverSocket.setNeedClientAuth(true);
```

Setelah handshake sukses, server bisa membaca peer certificate:

```java
var session = socket.getSession();
var peerCertificates = session.getPeerCertificates();
```

Lalu mapping identity:

```text
certificate SAN / subject / fingerprint
  -> registered client id
  -> permissions
  -> allowed routes/actions
```

Jangan hanya berkata:

```text
Certificate valid berarti boleh semua.
```

Itu authentication tanpa authorization.

---

## 20. `SSLParameters`

`SSLParameters` dapat digunakan untuk mengatur parameter TLS pada socket/client.

Contoh concept:

```java
SSLParameters parameters = new SSLParameters();
parameters.setEndpointIdentificationAlgorithm("HTTPS");
```

Endpoint identification penting untuk hostname verification pada beberapa penggunaan lower-level socket.

Untuk `HttpClient` HTTPS, hostname verification biasanya ditangani sesuai semantics HTTPS. Namun saat memakai `SSLSocket` custom, kamu perlu lebih berhati-hati.

Production rule:

```text
Kalau membuat TLS di atas socket custom, pastikan endpoint identity verification tidak hilang.
```

---

## 21. System Properties TLS di Java

Java mendukung konfigurasi TLS melalui system properties, misalnya:

```bash
-Djavax.net.ssl.trustStore=/app/config/truststore.p12
-Djavax.net.ssl.trustStorePassword=changeit
-Djavax.net.ssl.trustStoreType=PKCS12
-Djavax.net.ssl.keyStore=/app/config/client-keystore.p12
-Djavax.net.ssl.keyStorePassword=changeit
-Djavax.net.ssl.keyStoreType=PKCS12
```

Kelebihan:

- mudah untuk aplikasi sederhana,
- tidak perlu custom code,
- bekerja untuk default SSL context.

Kekurangan:

- process-wide,
- semua client dalam JVM bisa terdampak,
- sulit multi-partner trust berbeda,
- password terlihat di command line/process metadata jika tidak hati-hati,
- testing bisa saling mengganggu.

Untuk sistem kompleks, lebih baik gunakan `SSLContext` eksplisit per client/partner.

---

## 22. Secure Data Transfer Design

Mari gabungkan TLS dengan data transfer.

### 22.1 Baseline HTTPS Download Aman

```text
Client
  1. Build HttpClient dengan truststore yang benar.
  2. Send GET dengan timeout.
  3. Stream response ke temp file.
  4. Batasi maximum expected size.
  5. Verifikasi status code.
  6. Verifikasi Content-Type jika relevan.
  7. Verifikasi checksum dari trusted metadata.
  8. Atomic move temp file ke final path.
  9. Audit transfer result.
```

TLS memastikan channel aman. Checksum memastikan object yang disimpan sesuai expectation end-to-end.

### 22.2 Baseline HTTPS Upload Aman

```text
Client
  1. Hitung file size dan checksum.
  2. Kirim metadata: content length, checksum, idempotency key.
  3. Stream file body, bukan read all bytes.
  4. Gunakan timeout.
  5. Retry hanya jika operation idempotent.
  6. Simpan transfer attempt id.
  7. Tunggu acknowledgement final dari server.
```

Server:

```text
1. Authenticate TLS/server/client jika mTLS.
2. Authorize client identity.
3. Enforce max content length.
4. Stream ke temp object/file.
5. Hitung checksum sambil menerima stream.
6. Reject jika checksum mismatch.
7. Atomic publish.
8. Return stable result berdasarkan idempotency key.
9. Audit.
```

### 22.3 TLS Termination

Dalam production, TLS bisa terminate di:

```text
Client -> Load Balancer -> App
```

atau:

```text
Client -> API Gateway -> Service Mesh Sidecar -> App
```

Pertanyaan penting:

- Apakah traffic dari gateway ke app tetap encrypted?
- Apakah identity client diteruskan dengan aman?
- Apakah header identity bisa dipalsukan?
- Apakah app melakukan authorization berdasarkan header dari trusted proxy?
- Apakah audit mencatat TLS client certificate identity jika mTLS terminate di gateway?

Jika TLS terminate sebelum aplikasi, aplikasi tidak otomatis tahu certificate peer kecuali informasi itu diteruskan oleh komponen terpercaya.

---

## 23. Certificate Rotation

Certificate punya masa berlaku. Rotation bukan kejadian darurat; rotation harus jadi operasi normal.

### 23.1 Rotation Problem

Jika server certificate akan expired:

```text
Client truststore harus sudah percaya CA chain baru.
Server harus deploy cert baru.
Connection lama bisa tetap hidup sampai reconnect.
Client dengan connection pool bisa tetap memakai session lama.
```

Jika mTLS client cert akan expired:

```text
Server harus percaya CA/client cert baru.
Client harus mulai memakai key/cert baru.
Old cert harus tetap diterima selama overlap window jika perlu.
```

### 23.2 Safe Rotation Pattern

```text
1. Add new CA/certificate trust first.
2. Deploy truststore yang bisa menerima old dan new chain.
3. Deploy new certificate/key ke peer yang membuktikan identity.
4. Monitor handshake success/failure.
5. Remove old trust setelah semua traffic stabil.
```

Pattern:

```text
trust new before using new
use overlap window
remove old last
```

### 23.3 Anti-Pattern Rotation

```text
1. Replace cert tiba-tiba.
2. Client belum percaya CA baru.
3. Semua request gagal PKIX.
4. Emergency fix: disable TLS validation.
```

Ini harus dihindari dengan calendar, monitoring, dan runbook.

---

## 24. Revocation: CRL dan OCSP

Certificate bisa dicabut sebelum expired jika private key bocor atau identity tidak valid lagi.

Mechanism umum:

- CRL: Certificate Revocation List.
- OCSP: Online Certificate Status Protocol.

Dalam banyak enterprise system, revocation checking sering tidak aktif by default atau bergantung pada policy/runtime/configuration.

Engineering decision:

```text
Apakah threat model membutuhkan revocation checking?
Apakah environment bisa mengakses OCSP/CRL endpoint?
Apa failure mode jika revocation server tidak reachable?
Fail-open atau fail-closed?
```

Untuk high-security data transfer, pertanyaan revocation tidak boleh diabaikan.

---

## 25. Certificate Pinning

Certificate pinning berarti client hanya menerima certificate/public key tertentu, bukan semua CA yang dipercaya truststore.

Kelebihan:

- mengurangi risiko CA yang terlalu luas,
- cocok untuk controlled partner endpoint,
- bisa membatasi trust secara ketat.

Risiko:

- rotation lebih sulit,
- salah pin bisa outage,
- perlu overlap pin,
- operational maturity harus tinggi.

Lebih fleksibel daripada pin certificate leaf adalah pin public key/SPKI atau private CA tertentu, tetapi implementasi harus hati-hati.

Rule:

```text
Pinning bukan default untuk semua aplikasi.
Gunakan jika threat model dan operational process mendukung.
```

---

## 26. Timeout dan TLS

TLS menambah fase handshake.

Timeout yang perlu dipikirkan:

```text
DNS lookup timeout
TCP connect timeout
TLS handshake timeout
HTTP request timeout
socket read timeout
upload body timeout
download body timeout
idle timeout
connection pool lifetime
```

Java high-level HTTP client menyederhanakan sebagian, tetapi custom socket harus eksplisit.

Common problem:

```text
connect timeout diset,
tetapi read timeout tidak diset,
sehingga aplikasi menggantung saat peer lambat.
```

Untuk `SSLSocket`:

```java
socket.setSoTimeout(10_000);
```

Untuk `HttpClient`:

```java
HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

HttpRequest.newBuilder()
        .timeout(Duration.ofSeconds(30))
        .build();
```

---

## 27. Retry dan TLS Failure

Tidak semua TLS failure boleh di-retry.

| Failure | Retry? | Catatan |
|---|---:|---|
| TCP connect timeout | Mungkin | transient network |
| TLS handshake timeout | Mungkin | peer overloaded/network issue |
| Certificate expired | Tidak | config/security issue |
| Untrusted CA | Tidak | truststore/config issue |
| Hostname mismatch | Tidak | endpoint/cert issue, jangan bypass |
| Protocol mismatch | Tidak otomatis | perlu config/security review |
| HTTP 503 setelah TLS sukses | Mungkin | tergantung idempotency |
| Upload putus di tengah | Hati-hati | perlu resumable/idempotent protocol |

Rule:

```text
Retry untuk transient transport failure.
Jangan retry membabi buta untuk deterministic trust failure.
```

Jika error adalah `PKIX path building failed`, retry 100 kali tidak akan memperbaiki truststore.

---

## 28. Observability TLS

TLS failure sering sulit didiagnosis jika log buruk.

Log yang berguna:

```text
remote host
remote port
operation
correlation id
TLS phase if known
exception class
sanitized error message
certificate subject? hati-hati
certificate expiry summary? boleh jika tidak sensitif
truststore version/config id
request attempt number
```

Jangan log:

```text
private key
keystore password
truststore password
full Authorization header
client secret
full certificate private material
sensitive payload
```

Metric yang berguna:

```text
tls_handshake_failure_total{reason="expired"}
tls_handshake_failure_total{reason="untrusted"}
tls_connection_attempt_total
tls_connection_success_total
http_client_request_duration_seconds
secure_transfer_bytes_total
secure_transfer_checksum_mismatch_total
certificate_days_until_expiry
```

Alert penting:

```text
certificate expiry < 30 days
certificate expiry < 7 days
spike handshake failure
PKIX failure after deployment
hostname mismatch
unexpected issuer
```

---

## 29. Debugging TLS di Java

Java mendukung debug SSL/TLS melalui system property:

```bash
-Djavax.net.debug=ssl,handshake
```

Untuk detail lebih besar:

```bash
-Djavax.net.debug=all
```

Gunakan hati-hati:

- output sangat verbose,
- bisa mengandung informasi sensitif,
- jangan aktifkan permanen di production,
- gunakan di environment terkontrol.

Debug checklist:

```text
1. Hostname yang dipanggil benar?
2. DNS resolve ke endpoint yang benar?
3. Server mengirim certificate chain lengkap?
4. Certificate expired?
5. SAN cocok dengan hostname?
6. Truststore client berisi root/intermediate CA yang benar?
7. Runtime memakai truststore yang kamu kira?
8. Apakah ada proxy TLS inspection?
9. Apakah JDK security policy menolak algorithm/cipher?
10. Untuk mTLS: apakah client mengirim cert yang benar?
11. Untuk mTLS: apakah server truststore percaya CA client?
```

---

## 30. Error TLS Umum dan Artinya

### 30.1 `PKIX path building failed`

Makna umum:

```text
Client tidak bisa membangun certificate chain dari server cert ke trusted root CA.
```

Penyebab:

- CA tidak ada di truststore,
- intermediate certificate tidak dikirim server,
- memakai truststore yang salah,
- corporate proxy mengganti certificate,
- self-signed certificate belum dipercaya.

Solusi benar:

```text
Perbaiki truststore atau server chain.
Jangan disable certificate validation.
```

### 30.2 `No name matching ... found`

Makna:

```text
Certificate valid tetapi tidak cocok dengan hostname yang dipanggil.
```

Solusi benar:

- panggil hostname yang sesuai certificate,
- issue certificate baru dengan SAN benar,
- jangan disable hostname verification.

### 30.3 `Received fatal alert: bad_certificate`

Sering terjadi di mTLS.

Kemungkinan:

- client certificate tidak diterima server,
- client cert expired,
- server tidak percaya CA client,
- client tidak mengirim certificate,
- key usage/extended key usage tidak sesuai.

### 30.4 `handshake_failure`

Penyebab luas:

- protocol mismatch,
- cipher mismatch,
- certificate issue,
- client auth required tetapi cert tidak ada,
- security policy menolak algorithm.

Butuh debug handshake.

### 30.5 `Unsupported or unrecognized SSL message`

Sering terjadi saat client TLS bicara ke port plaintext, atau sebaliknya.

Contoh:

```text
Client: https://host:8080
Server port 8080: HTTP plaintext
```

---

## 31. Secure File Transfer: End-to-End Pattern

Misalnya kita ingin mengirim file compliance report ke partner melalui HTTPS/mTLS.

### 31.1 Requirements

```text
- File bisa besar.
- Transfer harus encrypted in transit.
- Partner harus authenticate client.
- Client harus authenticate partner server.
- Upload bisa retry tanpa duplicate processing.
- Receiver harus bisa verify file integrity.
- Audit harus lengkap.
- Tidak boleh log isi file.
```

### 31.2 Design

```text
Client
  - mTLS HttpClient
  - stream upload from file
  - compute SHA-256 before upload or streaming with tee/digest
  - send checksum header
  - send idempotency key
  - retry only safe status/failure
  - record transfer attempt

Server
  - verify client cert
  - map cert to partner identity
  - authorize operation
  - enforce max file size
  - stream to temp file/object
  - compute SHA-256 while receiving
  - compare checksum
  - atomic publish
  - store transfer record by idempotency key
  - return stable result
```

### 31.3 Transfer State Machine

```text
NEW
  -> CONNECTING
  -> TLS_HANDSHAKE
  -> SENDING_METADATA
  -> STREAMING_BODY
  -> WAITING_RESPONSE
  -> VERIFYING_ACK
  -> COMPLETED

Failure paths:
  CONNECTING -> RETRYABLE_FAILED
  TLS_HANDSHAKE -> FAILED_SECURITY if trust failure
  TLS_HANDSHAKE -> RETRYABLE_FAILED if timeout
  STREAMING_BODY -> UNKNOWN_REMOTE_STATE
  WAITING_RESPONSE -> UNKNOWN_REMOTE_STATE
  VERIFYING_ACK -> FAILED_INTEGRITY
```

Important state:

```text
UNKNOWN_REMOTE_STATE
```

Jika upload putus setelah sebagian body terkirim, client tidak selalu tahu apakah server menyimpan, menolak, atau memproses sebagian. Karena itu idempotency key dan reconciliation endpoint penting.

---

## 32. Testing TLS

### 32.1 Unit Test

Unit test tidak harus melakukan TLS handshake nyata untuk semua logic. Pisahkan:

```text
TLS config factory
transfer state machine
retry policy
checksum verification
idempotency decision
error classification
```

### 32.2 Integration Test

Integration test perlu menjalankan HTTPS server lokal dengan certificate test.

Scenario:

```text
valid server certificate
expired certificate
wrong hostname
untrusted CA
missing intermediate
mTLS success
mTLS missing client cert
mTLS wrong client cert
large streaming body
connection reset during upload
```

### 32.3 Negative Security Test

Pastikan client gagal untuk:

```text
self-signed untrusted cert
hostname mismatch
expired certificate
wrong truststore
server requiring mTLS but client no cert
```

Jika test “berhasil” saat certificate salah, kemungkinan ada trust-all atau hostname verification disabled.

---

## 33. Security Checklist

### 33.1 Client Checklist

```text
[ ] Menggunakan HTTPS/TLS untuk sensitive transfer.
[ ] Truststore jelas dan versioned.
[ ] Tidak memakai trust-all TrustManager.
[ ] Tidak disable hostname verification.
[ ] Timeout diset.
[ ] Retry policy membedakan transient vs trust failure.
[ ] Payload besar di-stream, bukan load all memory.
[ ] Checksum diverifikasi jika file/data penting.
[ ] Idempotency key dipakai untuk upload/retry.
[ ] Secret tidak muncul di command line/log.
[ ] Certificate expiry dimonitor.
```

### 33.2 Server Checklist

```text
[ ] Server certificate chain lengkap.
[ ] Private key permission aman.
[ ] TLS protocol/cipher mengikuti policy.
[ ] mTLS jika perlu client authentication kuat.
[ ] Client certificate dimap ke identity.
[ ] Identity diauthorize, bukan hanya diauthenticate.
[ ] Max payload size ditegakkan.
[ ] Upload stream ke temp storage.
[ ] Checksum diverifikasi.
[ ] Atomic publish setelah validasi.
[ ] Audit mencatat identity, attempt, checksum, size, result.
[ ] Sensitive data tidak dilog.
```

### 33.3 Operations Checklist

```text
[ ] Certificate inventory tersedia.
[ ] Expiry alert aktif.
[ ] Rotation runbook ada.
[ ] Truststore update punya rollout plan.
[ ] Old/new CA overlap window dirancang.
[ ] Emergency rollback tidak berupa disable TLS validation.
[ ] Debug TLS procedure tersedia.
[ ] Keystore/truststore secret dikelola oleh secret manager atau Kubernetes Secret dengan RBAC sesuai.
```

---

## 34. Anti-Pattern

### 34.1 Trust-All untuk “Sementara”

Masalah:

```text
Sementara sering menjadi permanen.
```

Dampak:

- MITM possible,
- wrong server accepted,
- internal attacker bisa intercept,
- audit security gagal.

Solusi:

```text
Buat truststore development yang benar.
Gunakan CA test.
Jangan bypass validation.
```

### 34.2 Disable Hostname Verification

Masalah:

```text
Certificate milik host lain diterima.
```

Solusi:

```text
Issue certificate dengan SAN benar.
Panggil hostname yang benar.
```

### 34.3 Import Semua ke Global `cacerts`

Masalah:

- blast radius besar,
- sulit audit,
- hilang saat JDK update/container rebuild,
- semua app ikut percaya.

Solusi:

```text
Gunakan app-specific truststore.
```

### 34.4 mTLS Tanpa Authorization

Masalah:

```text
Client certificate valid tetapi diberi akses terlalu luas.
```

Solusi:

```text
Map certificate identity ke permission eksplisit.
```

### 34.5 Menganggap TLS Menggantikan Payload Validation

Masalah:

```text
TLS hanya melindungi channel.
Payload tetap bisa malformed, malicious, duplicate, atau corrupt setelah termination.
```

Solusi:

```text
Tetap lakukan schema validation, size limit, checksum, idempotency, dan audit.
```

---

## 35. Decision Matrix

| Situasi | Rekomendasi |
|---|---|
| Akses public HTTPS biasa | Default `HttpClient` cukup jika public CA valid |
| Akses internal service dengan internal CA | Custom truststore |
| Partner membutuhkan client certificate | mTLS dengan client keystore |
| Server perlu authenticate client aplikasi | mTLS + identity mapping + authorization |
| Banyak partner dengan CA berbeda | `SSLContext` per partner/client |
| Ingin temporary bypass SSL error | Jangan; perbaiki trust/certificate |
| File besar via HTTPS | Stream body/file, timeout, checksum |
| Upload retryable | Idempotency key + server-side dedup/result cache |
| Certificate sering rotate | Overlap trust old/new + expiry monitoring |
| High-security environment | mTLS, restricted truststore, revocation/pinning sesuai threat model |

---

## 36. Latihan

### Latihan 1 — TrustStore Internal CA

Buat custom `SSLContext` yang memuat `truststore.p12`, lalu gunakan untuk `HttpClient`.

Target:

- request ke HTTPS internal berhasil,
- request gagal jika truststore salah,
- tidak ada trust-all.

### Latihan 2 — Hostname Mismatch

Buat local HTTPS server dengan certificate SAN `localhost`, lalu coba akses lewat `127.0.0.1`.

Analisis:

- apakah gagal?
- kenapa?
- bagaimana memperbaikinya dengan SAN yang benar?

### Latihan 3 — mTLS

Buat server yang membutuhkan client certificate.

Scenario:

```text
1. Client tanpa certificate -> gagal.
2. Client dengan certificate dari CA tidak dipercaya -> gagal.
3. Client dengan certificate valid -> sukses.
```

Tambahkan identity mapping sederhana dari certificate subject ke client id.

### Latihan 4 — Secure Upload

Implementasikan upload file dengan:

- mTLS client,
- SHA-256 checksum header,
- idempotency key,
- temp file server-side,
- atomic move setelah checksum match.

### Latihan 5 — Error Classification

Buat classifier exception:

```text
PKIX path failure -> non-retryable security/config
hostname mismatch -> non-retryable security/config
connect timeout -> retryable transient
HTTP 503 -> retryable if idempotent
HTTP 409 idempotency conflict -> non-retryable semantic
```

---

## 37. Ringkasan

TLS adalah security layer penting untuk data transfer, tetapi bukan solusi tunggal untuk semua masalah security dan reliability.

Hal paling penting:

```text
TLS memberi secure channel.
Truststore menentukan siapa yang dipercaya.
Keystore menentukan identity yang dibuktikan.
Certificate validation harus tetap aktif.
Hostname verification harus tetap aktif.
mTLS melakukan authentication client, tetapi authorization tetap harus eksplisit.
Secure transfer tetap perlu checksum, idempotency, timeout, audit, dan operational runbook.
```

Mental model final:

```text
Secure Data Transfer =
  Correct endpoint identity
  + encrypted transport
  + integrity protection in transit
  + explicit authorization
  + bounded resource usage
  + checksum / verification
  + idempotency / retry safety
  + atomic persistence
  + observability
  + certificate lifecycle management
```

TLS adalah fondasi. Production-grade data transfer membutuhkan sistem yang lebih lengkap di atasnya.

---

## 38. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
Data Transfer Reliability:
Retry, Resume, Checksum, Idempotency, Chunking, dan Exactly-Once Myth
```

Part ini akan mengambil TLS sebagai secure channel, lalu naik satu level ke pertanyaan reliability:

```text
Apa yang terjadi jika koneksi putus di tengah upload?
Bagaimana tahu file yang diterima lengkap?
Bagaimana retry tanpa duplicate processing?
Bagaimana resume transfer besar?
Kenapa exactly-once sering hanya ilusi?
```

---

## Status Seri

Seri belum selesai.

Part yang sudah selesai sampai saat ini:

```text
Part 000 — Mental Model Besar Java I/O
Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
Part 003 — Buffering Deep Dive
Part 004 — Binary I/O
Part 005 — Character I/O
Part 006 — Console I/O
Part 007 — NIO Core
Part 008 — ByteBuffer Deep Dive
Part 009 — FileChannel
Part 010 — Memory-Mapped File
Part 011 — NIO.2 File API
Part 012 — File Attributes, Permissions, Ownership, Metadata
Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete
Part 014 — Temporary File, Atomic File Write, File Replacement, Crash-Safe Persistence
Part 015 — WatchService
Part 016 — Serialization I
Part 017 — Serialization II
Part 018 — Compression
Part 019 — Networking I
Part 020 — Networking II
Part 021 — NIO Networking
Part 022 — UDP, Datagram, Multicast
Part 023 — HTTP Data Transfer
Part 024 — TLS, Certificates, TrustStore, KeyStore, dan Secure Data Transfer
```

Part berikutnya:

```text
Part 025 — Data Transfer Reliability: Retry, Resume, Checksum, Idempotency, Chunking, dan Exactly-Once Myth
```
