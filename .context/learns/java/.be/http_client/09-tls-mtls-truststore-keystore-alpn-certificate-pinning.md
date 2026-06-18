# Part 9 — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `09-tls-mtls-truststore-keystore-alpn-certificate-pinning.md`  
Target: Java 8 hingga Java 25  
Level: Advanced / production engineering

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya bisa “membuat HTTPS request berhasil”, tetapi mampu memahami, mendesain, mengaudit, dan men-debug komunikasi HTTPS/mTLS pada HTTP client Java di sistem production.

Target pemahaman:

1. Memahami TLS sebagai security layer di bawah HTTP.
2. Memahami perbedaan TLS, HTTPS, mTLS, truststore, keystore, certificate chain, private key, public key, CA, dan hostname verification.
3. Memahami apa yang benar-benar terjadi saat TLS handshake.
4. Memahami bagaimana Java JSSE menjadi fondasi TLS untuk JDK HttpClient, Apache HttpClient, OkHttp, Retrofit, Spring client, dan banyak library JVM lain.
5. Mampu membedakan server authentication dan client authentication.
6. Mampu membuat custom `SSLContext` secara aman.
7. Mampu memakai truststore/keystore tanpa mematikan certificate validation.
8. Mampu memahami ALPN dan kaitannya dengan HTTP/2.
9. Mampu mengevaluasi kapan certificate pinning berguna dan kapan justru berbahaya secara operasional.
10. Mampu membuat runbook diagnosis untuk error seperti `SSLHandshakeException`, `PKIX path building failed`, `bad_certificate`, `handshake_failure`, dan hostname mismatch.

---

## 2. Big Picture: HTTP Client Tidak Langsung Bicara HTTP

Saat kode Java melakukan:

```java
client.send(request, BodyHandlers.ofString());
```

atau:

```java
okHttpClient.newCall(request).execute();
```

jika URL memakai `https://`, yang terjadi bukan hanya:

```text
send HTTP request
receive HTTP response
```

Lebih akuratnya:

```text
resolve hostname
→ acquire/create TCP connection
→ negotiate TLS
→ verify server certificate
→ optionally send client certificate
→ negotiate application protocol via ALPN
→ only then send HTTP/1.1 or HTTP/2 bytes
→ read encrypted response
→ decrypt response
→ expose response to application
```

Artinya, HTTP client production harus dipahami sebagai gabungan dari:

```text
application intent
+ HTTP semantics
+ network path
+ TLS identity validation
+ credential management
+ connection reuse
+ protocol negotiation
+ observability
+ rotation lifecycle
```

Jika salah satu layer ini salah, error yang muncul sering terlihat seperti “API down”, padahal root cause bisa jadi:

- truststore belum punya CA baru,
- certificate chain server tidak lengkap,
- hostname certificate tidak match,
- client certificate expired,
- private key salah,
- mTLS certificate tidak trusted oleh server,
- TLS version/cipher tidak kompatibel,
- proxy melakukan TLS interception,
- ALPN gagal sehingga HTTP/2 fallback,
- pooled TLS connection stale setelah certificate/server rotation,
- container image memakai CA bundle berbeda dari laptop developer.

---

## 3. TLS vs HTTPS vs mTLS

### 3.1 TLS

TLS atau Transport Layer Security adalah protokol keamanan untuk membuat channel terenkripsi di atas TCP. TLS menyediakan beberapa properti utama:

1. Confidentiality — data tidak mudah dibaca pihak ketiga.
2. Integrity — data tidak mudah dimodifikasi tanpa terdeteksi.
3. Server authentication — client dapat memverifikasi identitas server.
4. Optional client authentication — server dapat memverifikasi identitas client.

Di Java, dukungan TLS umumnya disediakan oleh JSSE, yaitu Java Secure Socket Extension.

### 3.2 HTTPS

HTTPS adalah HTTP yang berjalan di atas TLS.

```text
HTTP over TLS over TCP
```

Jadi `https://api.example.com/users` bukan “HTTP biasa dengan port 443”, tetapi HTTP message yang dikirim setelah TLS handshake berhasil.

### 3.3 mTLS

mTLS adalah mutual TLS, yaitu TLS dengan authentication dua arah:

```text
client verifies server certificate
server verifies client certificate
```

Pada HTTPS biasa:

```text
client → verifies server identity
server → tidak selalu verifies client identity via certificate
```

Pada mTLS:

```text
client → verifies server identity
server → verifies client identity via client certificate
```

mTLS sering dipakai untuk:

- service-to-service communication,
- B2B integration,
- government/regulatory integration,
- payment/institutional API,
- internal platform API,
- service mesh identity,
- high-trust machine-to-machine authentication.

Namun mTLS bukan pengganti authorization. mTLS menjawab:

```text
“client ini siapa secara cryptographic identity?”
```

Bukan otomatis menjawab:

```text
“client ini boleh melakukan action apa?”
```

Authorization tetap perlu diputuskan di layer aplikasi atau policy layer.

---

## 4. Vocabulary Fundamental

### 4.1 Certificate

Certificate adalah dokumen digital yang mengikat public key dengan identity.

Sertifikat server biasanya berisi:

- Subject,
- Subject Alternative Name/SAN,
- public key,
- issuer,
- validity period,
- signature dari issuer,
- key usage,
- extended key usage.

Untuk HTTPS modern, hostname biasanya diverifikasi terhadap SAN, bukan hanya Common Name.

### 4.2 Public Key dan Private Key

Public key boleh dibagikan. Private key harus dirahasiakan.

Pada server certificate:

```text
certificate contains public key
server owns private key
client verifies server controls private key during handshake
```

Pada client certificate untuk mTLS:

```text
client sends certificate with public key
client proves possession of private key
server verifies certificate chain and client identity
```

### 4.3 CA / Certificate Authority

CA adalah pihak yang menandatangani certificate. Client mempercayai server certificate jika chain-nya dapat dibangun sampai ke root CA yang dipercaya.

```text
server certificate
→ intermediate CA
→ root CA trusted by client
```

### 4.4 Certificate Chain

Certificate chain adalah urutan certificate dari leaf certificate sampai root.

Contoh:

```text
api.example.com certificate
→ Example Intermediate CA
→ Example Root CA
```

Masalah umum:

- server tidak mengirim intermediate certificate,
- root CA tidak ada di truststore client,
- intermediate expired,
- chain salah urutan,
- certificate memakai algorithm/cipher tidak diterima policy JVM,
- certificate belum valid atau sudah expired.

### 4.5 Trust Store

Truststore berisi certificate/CA yang dipercaya oleh client untuk memverifikasi server.

Untuk HTTPS client:

```text
truststore = daftar CA/server cert yang dipercaya untuk server authentication
```

Di Java, default truststore biasanya berasal dari JDK distribution, tetapi bisa berbeda tergantung vendor, container image, OS integration, dan runtime configuration.

### 4.6 Key Store

Keystore berisi identity milik client atau server, biasanya certificate + private key.

Untuk HTTP client yang memakai mTLS:

```text
keystore = client certificate + client private key
```

Truststore menjawab:

```text
“siapa yang saya percaya?”
```

Keystore menjawab:

```text
“siapa saya?”
```

### 4.7 Hostname Verification

Certificate chain valid saja tidak cukup. Client juga harus memastikan certificate tersebut memang untuk hostname yang dituju.

Jika client call:

```text
https://api.partner.com
```

maka certificate harus valid untuk:

```text
api.partner.com
```

atau wildcard yang sesuai seperti:

```text
*.partner.com
```

Tapi wildcard tidak selalu match semua level. Misalnya `*.partner.com` cocok untuk `api.partner.com`, tetapi tidak untuk `a.b.partner.com`.

### 4.8 ALPN

ALPN atau Application-Layer Protocol Negotiation adalah mekanisme di TLS handshake untuk memilih application protocol, misalnya:

```text
h2        = HTTP/2
http/1.1  = HTTP/1.1
```

Tanpa ALPN, HTTP/2 di atas TLS tidak bisa dinegosiasikan dengan cara modern.

### 4.9 Cipher Suite

Cipher suite adalah kumpulan algoritma kriptografi yang digunakan dalam TLS connection. TLS 1.3 menyederhanakan cipher suite dibanding TLS 1.2.

Sebagai application engineer, biasanya kamu tidak perlu memilih cipher suite manual kecuali berada di environment regulated/high-security atau harus comply dengan policy tertentu. Namun kamu perlu tahu bahwa handshake bisa gagal karena client dan server tidak punya cipher/protocol overlap.

---

## 5. TLS Handshake Mental Model

TLS handshake bisa dipahami sebagai proses menjawab empat pertanyaan:

```text
1. Server ini siapa?
2. Apakah certificate server dapat dipercaya?
3. Algoritma/protokol keamanan apa yang akan dipakai?
4. Apakah kedua pihak berhasil membentuk shared secret untuk encrypt/decrypt data?
```

Untuk mTLS, ada pertanyaan tambahan:

```text
5. Client ini siapa?
6. Apakah certificate client dapat dipercaya server?
```

### 5.1 Simplified TLS Handshake untuk HTTPS Biasa

```text
ClientHello
  - supported TLS versions
  - supported cipher suites
  - SNI hostname
  - ALPN protocols: h2, http/1.1

ServerHello
  - selected TLS version
  - selected cipher suite
  - selected ALPN protocol

Server Certificate
  - leaf certificate
  - intermediate chain

Client verifies:
  - certificate chain trusted?
  - certificate valid time?
  - hostname match?
  - key usage valid?
  - algorithm allowed?

Key exchange completes

Encrypted HTTP begins
```

### 5.2 Simplified mTLS Handshake

```text
ClientHello
ServerHello
Server Certificate
Server requests client certificate
Client verifies server
Client sends client certificate
Client proves possession of private key
Server verifies client certificate
Key exchange completes
Encrypted HTTP begins
```

### 5.3 SNI

SNI atau Server Name Indication memungkinkan client mengirim hostname yang ingin diakses saat TLS handshake. Ini penting karena satu IP bisa melayani banyak domain dengan certificate berbeda.

Tanpa SNI, server bisa mengirim certificate default yang tidak match hostname.

Masalah SNI bisa muncul pada:

- old JVM,
- custom socket factory yang salah,
- proxy/tunnel tertentu,
- IP literal URL seperti `https://10.0.0.5` padahal certificate untuk hostname,
- load balancer multi-domain.

---

## 6. Trust Model: Yang Dipercaya Client Bukan “Server”, tetapi Chain

Misalnya client call:

```text
https://api.payment.example
```

Server mengirim certificate chain:

```text
api.payment.example
→ Payment Intermediate CA
→ Global Trusted Root CA
```

Client memverifikasi:

```text
Apakah Global Trusted Root CA ada di truststore saya?
Apakah Intermediate CA benar menandatangani leaf certificate?
Apakah certificate masih valid?
Apakah certificate berlaku untuk api.payment.example?
Apakah algoritmanya diizinkan JVM security policy?
```

Jika semua benar, TLS handshake lanjut.

Jika root/intermediate tidak dipercaya:

```text
javax.net.ssl.SSLHandshakeException:
PKIX path building failed
```

Ini bukan berarti “server down”. Ini berarti client tidak bisa membangun trust path yang valid.

---

## 7. Truststore vs Keystore: Jangan Tertukar

Ini salah satu sumber kebingungan paling sering.

| Konsep | Dipakai untuk | Berisi | Digunakan oleh |
|---|---|---|---|
| Truststore | Memverifikasi pihak lain | CA/certificate yang dipercaya | TrustManager |
| Keystore | Membuktikan identitas sendiri | certificate + private key | KeyManager |

Pada HTTPS biasa:

```text
client truststore → verify server certificate
client keystore   → biasanya tidak diperlukan
```

Pada mTLS:

```text
client truststore → verify server certificate
client keystore   → present client certificate to server
```

Di sisi server mTLS:

```text
server keystore   → server identity
server truststore → verify client certificate
```

---

## 8. File Format: JKS, PKCS12, PEM

### 8.1 JKS

JKS adalah Java KeyStore format lama. Banyak legacy Java 8 system masih memakai JKS.

### 8.2 PKCS12 / P12 / PFX

PKCS12 adalah format portable yang umum untuk menyimpan private key + certificate chain.

Modern Java mendukung PKCS12 dengan baik. Banyak enterprise integration memakai `.p12` atau `.pfx` untuk mTLS client certificate.

### 8.3 PEM

PEM biasanya berupa text Base64 dengan header seperti:

```text
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

atau:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

Java native APIs tradisional lebih nyaman dengan `KeyStore`, tetapi banyak library/cloud tooling memakai PEM. Kadang perlu convert PEM ke PKCS12.

### 8.4 Conversion Mental Model

Common conversion:

```text
PEM certificate + PEM private key
→ PKCS12 keystore
→ Java SSLContext
```

Atau:

```text
CA PEM bundle
→ Java truststore
→ TrustManagerFactory
→ Java SSLContext
```

---

## 9. Java JSSE sebagai Fondasi TLS

Sebagian besar HTTP client Java pada akhirnya memakai Java TLS stack atau kompatibel dengannya.

Layer penting:

```text
SSLContext
→ KeyManager[]
→ TrustManager[]
→ SSLSocket / SSLEngine
→ HTTP client library
```

### 9.1 SSLContext

`SSLContext` adalah factory untuk membuat TLS socket/engine dengan trust/key material tertentu.

Mental model:

```text
SSLContext = TLS configuration root
```

Ia menentukan:

- trust manager,
- key manager,
- secure random,
- provider,
- protocol family.

### 9.2 TrustManagerFactory

`TrustManagerFactory` membaca truststore dan menghasilkan `TrustManager`.

```text
truststore file
→ KeyStore
→ TrustManagerFactory
→ TrustManager[]
```

### 9.3 KeyManagerFactory

`KeyManagerFactory` membaca keystore dan menghasilkan `KeyManager`.

```text
keystore file
→ KeyStore
→ KeyManagerFactory
→ KeyManager[]
```

### 9.4 SSLParameters

`SSLParameters` dapat mengatur detail seperti:

- protocols,
- cipher suites,
- endpoint identification algorithm,
- application protocols untuk ALPN,
- SNI names.

Namun hati-hati: terlalu banyak override manual dapat merusak default security JVM yang sebenarnya sudah aman.

---

## 10. Jangan Mematikan Validasi Certificate

Anti-pattern paling berbahaya:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

atau hostname verifier:

```java
(hostname, session) -> true
```

Ini membuat HTTPS kehilangan properti authentication. Channel mungkin tetap terenkripsi, tetapi client tidak lagi tahu ia berbicara dengan server yang benar.

Dampak:

- MITM menjadi mungkin,
- proxy jahat bisa diterima,
- DNS hijack menjadi lebih berbahaya,
- compliance/security audit gagal,
- bug test bisa terbawa ke production.

Rule production:

```text
Never disable certificate validation or hostname verification in production.
```

Jika development memakai self-signed certificate, solusi yang benar:

```text
buat dev CA
→ tambahkan dev CA ke dev truststore
→ gunakan truststore itu hanya untuk dev/test
```

Bukan trust-all.

---

## 11. Membuat SSLContext untuk Custom Truststore

Contoh aman untuk membaca truststore custom:

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class TlsContexts {

    public static SSLContext sslContextWithTrustStore(
            Path trustStorePath,
            char[] trustStorePassword,
            String trustStoreType
    ) throws Exception {
        KeyStore trustStore = KeyStore.getInstance(trustStoreType); // e.g. "PKCS12" or "JKS"

        try (InputStream input = Files.newInputStream(trustStorePath)) {
            trustStore.load(input, trustStorePassword);
        }

        TrustManagerFactory trustManagerFactory = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        trustManagerFactory.init(trustStore);

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(
                null,
                trustManagerFactory.getTrustManagers(),
                null
        );

        return sslContext;
    }
}
```

Catatan:

- `TLS` membiarkan provider memilih versi TLS yang sesuai dengan policy runtime.
- Jangan hardcode `TLSv1.2` kecuali policy benar-benar membutuhkan.
- Jangan simpan password sebagai `String` jika bisa dihindari.
- Jangan log path/password/subject certificate secara sembarangan.

---

## 12. Membuat SSLContext untuk mTLS

Untuk mTLS, client membutuhkan:

1. Truststore untuk memverifikasi server.
2. Keystore untuk mengirim client certificate.

```java
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class MtlsContextFactory {

    public static SSLContext createMtlsSslContext(
            Path trustStorePath,
            char[] trustStorePassword,
            String trustStoreType,
            Path keyStorePath,
            char[] keyStorePassword,
            String keyStoreType
    ) throws Exception {
        KeyStore trustStore = KeyStore.getInstance(trustStoreType);
        try (InputStream input = Files.newInputStream(trustStorePath)) {
            trustStore.load(input, trustStorePassword);
        }

        TrustManagerFactory trustManagerFactory = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        trustManagerFactory.init(trustStore);

        KeyStore keyStore = KeyStore.getInstance(keyStoreType);
        try (InputStream input = Files.newInputStream(keyStorePath)) {
            keyStore.load(input, keyStorePassword);
        }

        KeyManagerFactory keyManagerFactory = KeyManagerFactory.getInstance(
                KeyManagerFactory.getDefaultAlgorithm()
        );
        keyManagerFactory.init(keyStore, keyStorePassword);

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(
                keyManagerFactory.getKeyManagers(),
                trustManagerFactory.getTrustManagers(),
                null
        );

        return sslContext;
    }
}
```

Mental model:

```text
TrustManager → who I trust
KeyManager   → who I am
SSLContext   → TLS runtime using both
```

---

## 13. JDK HttpClient dengan Custom SSLContext

`java.net.http.HttpClient` dapat diberi `SSLContext` saat build.

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import javax.net.ssl.SSLContext;

public class JdkHttpClientTlsExample {

    public static void main(String[] args) throws Exception {
        SSLContext sslContext = MtlsContextFactory.createMtlsSslContext(
                Path.of("/etc/certs/truststore.p12"),
                System.getenv("TRUSTSTORE_PASSWORD").toCharArray(),
                "PKCS12",
                Path.of("/etc/certs/client.p12"),
                System.getenv("KEYSTORE_PASSWORD").toCharArray(),
                "PKCS12"
        );

        HttpClient client = HttpClient.newBuilder()
                .sslContext(sslContext)
                .version(HttpClient.Version.HTTP_2)
                .build();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.partner.example/v1/status"))
                .GET()
                .build();

        HttpResponse<String> response = client.send(
                request,
                HttpResponse.BodyHandlers.ofString()
        );

        System.out.println(response.statusCode());
    }
}
```

Catatan:

- `version(HTTP_2)` adalah preferensi. Jika server/protocol negotiation tidak mendukung, client bisa fallback tergantung implementasi dan kondisi.
- Untuk HTTP/2 over TLS, ALPN negotiation diperlukan.
- `HttpClient` sebaiknya reusable, bukan dibuat per request.

---

## 14. OkHttp dengan TLS dan mTLS

OkHttp menggunakan `SSLSocketFactory` dan `X509TrustManager`.

OkHttp membutuhkan trust manager secara eksplisit saat custom SSL socket factory dipasang.

Contoh factory helper:

```java
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class OkHttpTlsMaterial {

    public record Material(SSLContext sslContext, X509TrustManager trustManager) {}

    public static Material mtlsMaterial(
            Path trustStorePath,
            char[] trustStorePassword,
            String trustStoreType,
            Path keyStorePath,
            char[] keyStorePassword,
            String keyStoreType
    ) throws Exception {
        KeyStore trustStore = KeyStore.getInstance(trustStoreType);
        try (InputStream input = Files.newInputStream(trustStorePath)) {
            trustStore.load(input, trustStorePassword);
        }

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        tmf.init(trustStore);

        X509TrustManager x509TrustManager = extractX509TrustManager(tmf.getTrustManagers());

        KeyStore keyStore = KeyStore.getInstance(keyStoreType);
        try (InputStream input = Files.newInputStream(keyStorePath)) {
            keyStore.load(input, keyStorePassword);
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(
                KeyManagerFactory.getDefaultAlgorithm()
        );
        kmf.init(keyStore, keyStorePassword);

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(kmf.getKeyManagers(), new TrustManager[]{x509TrustManager}, null);

        return new Material(sslContext, x509TrustManager);
    }

    private static X509TrustManager extractX509TrustManager(TrustManager[] trustManagers) {
        for (TrustManager trustManager : trustManagers) {
            if (trustManager instanceof X509TrustManager x509TrustManager) {
                return x509TrustManager;
            }
        }
        throw new IllegalStateException("No X509TrustManager found");
    }
}
```

OkHttp usage:

```java
import okhttp3.OkHttpClient;

OkHttpTlsMaterial.Material material = OkHttpTlsMaterial.mtlsMaterial(
        Path.of("/etc/certs/truststore.p12"),
        System.getenv("TRUSTSTORE_PASSWORD").toCharArray(),
        "PKCS12",
        Path.of("/etc/certs/client.p12"),
        System.getenv("KEYSTORE_PASSWORD").toCharArray(),
        "PKCS12"
);

OkHttpClient client = new OkHttpClient.Builder()
        .sslSocketFactory(
                material.sslContext().getSocketFactory(),
                material.trustManager()
        )
        .build();
```

Dengan Retrofit, TLS tetap dikonfigurasi di OkHttp:

```java
Retrofit retrofit = new Retrofit.Builder()
        .baseUrl("https://api.partner.example/")
        .client(client)
        .addConverterFactory(JacksonConverterFactory.create(objectMapper))
        .build();
```

Retrofit tidak mengelola TLS secara langsung. Retrofit adalah typed API layer. Transport detail tetap berada di OkHttp.

---

## 15. Apache HttpClient 5 dengan TLS dan mTLS

Apache HttpClient 5 memberi kontrol yang sangat kuat untuk TLS, route, pool, dan protocol.

Contoh konseptual dengan `SSLContextBuilder` dan TLS strategy:

```java
import org.apache.hc.client5.http.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManager;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.client5.http.ssl.DefaultClientTlsStrategy;
import org.apache.hc.client5.http.ssl.ClientTlsStrategyBuilder;
import org.apache.hc.core5.ssl.SSLContextBuilder;

import javax.net.ssl.SSLContext;
import java.nio.file.Path;

public final class ApacheHttpClientMtlsExample {

    public static CloseableHttpClient createClient() throws Exception {
        SSLContext sslContext = SSLContextBuilder.create()
                .loadTrustMaterial(
                        Path.of("/etc/certs/truststore.p12").toFile(),
                        System.getenv("TRUSTSTORE_PASSWORD").toCharArray()
                )
                .loadKeyMaterial(
                        Path.of("/etc/certs/client.p12").toFile(),
                        System.getenv("KEYSTORE_PASSWORD").toCharArray(),
                        System.getenv("KEYSTORE_PASSWORD").toCharArray()
                )
                .build();

        DefaultClientTlsStrategy tlsStrategy = ClientTlsStrategyBuilder.create()
                .setSslContext(sslContext)
                .buildClassic();

        PoolingHttpClientConnectionManager connectionManager =
                PoolingHttpClientConnectionManagerBuilder.create()
                        .setTlsSocketStrategy(tlsStrategy)
                        .build();

        return HttpClients.custom()
                .setConnectionManager(connectionManager)
                .build();
    }
}
```

Catatan:

- API detail Apache HttpClient 5 dapat berubah antarmicro-version, jadi pastikan mengikuti versi library yang dipakai.
- Apache cocok jika kamu perlu kontrol sangat rinci untuk pooling, proxy, route, TLS strategy, dan connection manager.

---

## 16. Certificate Pinning

Certificate pinning adalah praktik membatasi certificate/public key mana yang diterima oleh client untuk host tertentu.

Tanpa pinning:

```text
client trusts any certificate chain leading to trusted root CA
```

Dengan pinning:

```text
client trusts certificate chain only if it also matches configured pin
```

### 16.1 Pinning Biasanya Pin Public Key, Bukan Leaf Certificate

Pinning leaf certificate terlalu rapuh karena certificate server bisa rotate. Lebih umum pin Subject Public Key Info/SPKI hash.

### 16.2 OkHttp CertificatePinner

Contoh:

```java
import okhttp3.CertificatePinner;
import okhttp3.OkHttpClient;

CertificatePinner certificatePinner = new CertificatePinner.Builder()
        .add("api.partner.example", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        .add("api.partner.example", "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=")
        .build();

OkHttpClient client = new OkHttpClient.Builder()
        .certificatePinner(certificatePinner)
        .build();
```

Minimal selalu punya backup pin:

```text
current key pin
+ backup key pin
```

Jika tidak, certificate/key rotation bisa memutus seluruh client yang sudah deploy.

### 16.3 Kapan Pinning Masuk Akal

Pinning bisa masuk akal untuk:

- mobile app yang call backend sendiri,
- closed ecosystem,
- high-risk MITM environment,
- API dengan very strong identity requirement,
- client yang bisa dikontrol update lifecycle-nya.

### 16.4 Kapan Pinning Berbahaya

Pinning sering berbahaya untuk server-side enterprise integration jika:

- partner sering rotate certificate,
- CA migration mungkin terjadi,
- kamu tidak punya operational process untuk update pin,
- deployment client lambat,
- banyak environment berbeda,
- ada corporate TLS inspection,
- third-party provider tidak memberi advance notice.

Rule:

```text
Certificate pinning adalah security hardening + operational liability.
```

Jangan menambahkan pinning hanya agar terlihat “lebih secure”. Tanpa rotation process, pinning bisa menjadi production outage generator.

---

## 17. ALPN dan HTTP/2

HTTP/2 over TLS biasanya dinegosiasikan via ALPN.

Client mengirim:

```text
I support: h2, http/1.1
```

Server memilih:

```text
h2
```

atau:

```text
http/1.1
```

Jika ALPN gagal, client bisa fallback ke HTTP/1.1 atau request gagal tergantung library/config.

### 17.1 Kenapa ALPN Penting untuk HTTP Client Engineer

Karena behavior connection berbeda drastis:

| Protocol | Connection behavior |
|---|---|
| HTTP/1.1 | satu in-flight request per connection kecuali pipelining yang jarang dipakai |
| HTTP/2 | banyak stream multiplexed dalam satu connection |

Dampaknya:

- pool sizing berbeda,
- timeout interpretation berbeda,
- head-of-line blocking berbeda,
- failure blast radius berbeda,
- connection-level reset bisa mempengaruhi banyak stream.

### 17.2 Debugging ALPN

Gejala ALPN/protocol negotiation issue:

- client berharap HTTP/2 tetapi selalu HTTP/1.1,
- latency lebih tinggi dari ekspektasi,
- pool connection lebih banyak dari rencana,
- server log menunjukkan protocol berbeda,
- handshake gagal setelah TLS upgrade.

Yang dicek:

```text
JDK version
TLS provider
server supports h2?
ALPN extension enabled?
proxy/load balancer supports h2?
TLS termination point di mana?
client library protocol config?
```

---

## 18. TLS Version dan Cipher Compatibility

Java modern default-nya biasanya cukup aman. Namun di integration environment, kamu bisa bertemu server lama yang hanya mendukung TLS/cipher lama.

Common failure:

```text
javax.net.ssl.SSLHandshakeException: no appropriate protocol
javax.net.ssl.SSLHandshakeException: handshake_failure
javax.net.ssl.SSLHandshakeException: Received fatal alert: handshake_failure
```

Penyebab mungkin:

- server hanya mendukung TLS 1.0/1.1 yang sudah disabled,
- client hanya mengizinkan TLS 1.2/1.3,
- cipher suite tidak overlap,
- certificate algorithm disabled,
- server butuh SNI tetapi client tidak mengirim,
- server butuh client cert tetapi client tidak mengirim.

### 18.1 Jangan Cepat Menurunkan Security

Jika handshake gagal dengan legacy server, jangan langsung mengaktifkan protocol lama di production. Lakukan decision path:

```text
1. Confirm server TLS capability.
2. Confirm business necessity.
3. Confirm compliance/security acceptance.
4. Isolate client config only for that endpoint.
5. Add monitoring and migration plan.
```

Jangan mengubah global JVM security hanya untuk satu partner API kecuali benar-benar disetujui.

---

## 19. Hostname Verification

Trust chain valid belum cukup.

Contoh:

```text
certificate valid untuk api.partner.com
client request ke payment.partner.com
```

Maka certificate bisa trusted tetapi hostname mismatch.

Common exception:

```text
No subject alternative DNS name matching payment.partner.com found
```

Atau pada library tertentu:

```text
Hostname verification failed
```

### 19.1 IP Address Problem

Jika request memakai IP:

```text
https://10.1.2.3/api
```

maka certificate harus punya IP SAN `10.1.2.3`. Certificate untuk `api.partner.com` tidak cukup.

Solusi yang benar:

```text
gunakan hostname yang match certificate
atur DNS/internal DNS/private hosted zone
```

Bukan disable hostname verification.

---

## 20. Client Certificate Selection pada mTLS

Keystore bisa berisi lebih dari satu private key/certificate alias.

Problem:

```text
client punya banyak certificate
server request client cert
client salah memilih alias
server reject
```

Gejala:

- server log: unknown client certificate,
- handshake alert: bad_certificate,
- HTTP request tidak pernah sampai application layer,
- client melihat `SSLHandshakeException`.

Advanced solution:

- gunakan keystore khusus per external API,
- atau implement custom `X509KeyManager` untuk memilih alias berdasarkan host/issuer,
- atau gunakan HttpClient instance berbeda per identity.

Rule yang sederhana dan kuat:

```text
One external identity → one explicit client config → one keystore/alias policy.
```

Jangan membuat satu global mTLS client berisi semua certificate untuk semua partner.

---

## 21. Certificate Rotation

TLS/mTLS bukan konfigurasi sekali jadi. Certificate punya masa berlaku.

Production system harus punya lifecycle:

```text
inventory
→ expiry monitoring
→ renewal
→ staging validation
→ trust distribution
→ rollout
→ rollback
→ post-rotation verification
```

### 21.1 Rotation Failure Pattern

Server certificate rotation:

```text
partner rotates certificate
→ new chain uses new intermediate/root
→ our truststore does not contain CA
→ PKIX path building failed
```

Client certificate rotation:

```text
our client certificate expires
→ partner server rejects mTLS
→ handshake fails before HTTP layer
```

Pinning rotation:

```text
server rotates key
→ client pin mismatch
→ all calls fail until client config/deploy updated
```

### 21.2 Expiry Monitoring

Monitor at minimum:

- server certificate expiry for important endpoints,
- client certificate expiry,
- intermediate CA expiry,
- truststore version deployed,
- pin set version if using pinning.

Do not rely on calendar reminder only.

---

## 22. TLS Through Proxy and TLS Inspection

Corporate/proxy environment bisa mengubah TLS behavior.

### 22.1 HTTPS via HTTP Proxy

Untuk HTTPS melalui HTTP proxy, client biasanya melakukan:

```text
CONNECT api.partner.com:443 HTTP/1.1
```

Setelah tunnel dibuat, TLS handshake terjadi melalui tunnel.

### 22.2 TLS Inspection

Dalam TLS inspection, proxy memutus TLS dari client dan membuat TLS baru ke server.

```text
client ↔ corporate proxy ↔ server
```

Client melihat certificate yang diterbitkan corporate proxy CA, bukan certificate asli server.

Jika corporate CA tidak ada di truststore client:

```text
PKIX path building failed
```

Jika certificate pinning aktif:

```text
pinning failure
```

Karena pinning memang mendeteksi TLS interception.

### 22.3 Design Decision

Untuk regulated/high-security API, TLS inspection mungkin tidak boleh. Untuk corporate environment, mungkin wajib.

HTTP client engineer harus tahu policy network, bukan hanya library code.

---

## 23. Error Diagnosis: SSLHandshakeException Bukan Satu Penyakit

`SSLHandshakeException` adalah gejala umum. Root cause harus dilihat dari nested cause, debug log, server log, dan certificate details.

### 23.1 Common Error Mapping

| Symptom | Kemungkinan root cause |
|---|---|
| `PKIX path building failed` | CA/intermediate tidak trusted, chain incomplete |
| `No subject alternative DNS name matching ...` | hostname mismatch |
| `unable to find valid certification path` | trust path gagal |
| `bad_certificate` | client cert invalid/rejected oleh server |
| `handshake_failure` | cipher/protocol mismatch, missing client cert, SNI issue |
| `certificate_unknown` | salah satu pihak tidak trust certificate |
| `no appropriate protocol` | TLS version tidak kompatibel/disabled |
| `Received fatal alert: protocol_version` | TLS version mismatch |
| `Connection reset during handshake` | proxy/LB/server menutup koneksi, policy mismatch |
| `Certificate pinning failure` | pin tidak match certificate/public key |

### 23.2 Debug Flag

Untuk diagnosis lokal/non-production, Java menyediakan debug flag:

```bash
-Djavax.net.debug=ssl,handshake
```

Lebih verbose:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Hati-hati: output bisa mengandung detail sensitif dan sangat besar. Jangan aktifkan sembarangan di production.

### 23.3 Diagnosis Checklist

Saat TLS gagal, jawab urutan ini:

```text
1. URL host apa yang dipakai client?
2. Apakah host match SAN certificate?
3. Certificate chain server apa yang dikirim?
4. Root/intermediate CA ada di truststore client?
5. Apakah certificate expired/not yet valid?
6. Apakah server meminta client certificate?
7. Apakah client mengirim certificate yang benar?
8. Apakah server trust client certificate CA?
9. TLS version/cipher overlap?
10. Apakah proxy/LB/service mesh melakukan TLS termination/inspection?
11. Apakah ALPN/protocol negotiation relevan?
12. Apakah error terjadi hanya setelah rotation/deployment?
```

---

## 24. Observability untuk TLS HTTP Client

TLS problem sering terjadi sebelum HTTP request mencapai server application. Karena itu observability HTTP status code saja tidak cukup.

### 24.1 Metrics yang Berguna

Per external host/client:

```text
http.client.tls.handshake.duration
http.client.tls.handshake.failure.count
http.client.tls.cert.expiry.days
http.client.connection.protocol
http.client.connection.tls.version
http.client.connection.reused
http.client.error.type
http.client.error.phase
```

Label dengan hati-hati:

```text
client_name
remote_service
environment
exception_class
failure_phase
```

Jangan label dengan full URL, user ID, token, dynamic query, certificate serial terlalu granular.

### 24.2 Log yang Berguna

Untuk failure:

```text
client_name=partner-payment
host=api.partner.example
port=443
scheme=https
failure_phase=tls_handshake
exception_class=SSLHandshakeException
root_cause=PKIX path building failed
request_id=...
```

Untuk mTLS jangan log:

- private key,
- keystore password,
- full certificate PEM jika tidak perlu,
- Authorization header,
- client secret.

Boleh log secara terbatas:

- certificate subject,
- issuer,
- expiry date,
- fingerprint truncated/approved,
- keystore alias jika tidak sensitif secara internal.

---

## 25. Security Boundary: TLS Tidak Menyelesaikan Semua Masalah

TLS memberi secure transport, tetapi tidak menyelesaikan:

- authorization,
- business-level replay protection,
- request idempotency,
- payload-level integrity jika message diteruskan antarhop,
- audit semantics,
- secret lifecycle,
- compromised endpoint,
- SSRF,
- malicious redirect,
- sensitive data logging.

Misalnya mTLS berhasil, bearer token valid, tetapi request bisa tetap tidak authorized untuk action tertentu.

Production-grade client tetap butuh:

```text
TLS/mTLS
+ auth token/signature
+ authorization-aware error handling
+ idempotency key
+ request signing if needed
+ audit log
+ redaction
+ timeout/retry policy
```

---

## 26. Design Patterns untuk TLS Material Management

### 26.1 Dedicated Client per Security Identity

Baik:

```text
PaymentApiClient uses payment mTLS identity
RegulatorApiClient uses regulator mTLS identity
InternalCaseClient uses internal mesh identity
```

Buruk:

```text
GlobalHttpClient contains all certs and all auth rules
```

Dedicated client membuat:

- failure isolation lebih baik,
- audit lebih jelas,
- rotation lebih aman,
- config lebih mudah divalidasi,
- blast radius lebih kecil.

### 26.2 TLS Material as Configuration, Not Code

Jangan embed certificate/private key di source code.

Lebih baik:

```text
secret manager / vault / mounted secret / secure parameter store
→ application loads keystore/truststore
→ validates at startup
→ exposes safe health/readiness info
```

### 26.3 Startup Validation

Saat aplikasi start, validasi:

- file ada,
- password benar,
- keystore bisa dibuka,
- truststore bisa dibuka,
- expected alias ada,
- certificate belum expired,
- certificate usage sesuai,
- expiry threshold warning,
- target endpoint optionally handshake-check di readiness/dependency check.

Startup failure lebih baik daripada silent runtime outage.

### 26.4 Hot Reload vs Restart

Certificate rotation bisa dilakukan dengan:

1. Restart deployment setelah secret berubah.
2. Hot reload SSLContext.
3. Sidecar/service mesh managed identity.

Hot reload sulit karena:

- connection pool lama masih memakai connection lama,
- SSLContext immutable secara praktis untuk client instance,
- perlu swap client instance safely,
- perlu drain old connections.

Untuk banyak enterprise app, restart rolling deployment lebih sederhana dan aman.

---

## 27. Production Client Factory Example

Contoh struktur factory:

```java
public final class PartnerHttpClientFactory {

    public PartnerHttpClient create(PartnerClientProperties properties) {
        TlsConfig tls = validateAndBuildTlsConfig(properties.tls());
        TimeoutConfig timeout = validateTimeouts(properties.timeouts());
        PoolConfig pool = validatePool(properties.pool());

        SSLContext sslContext = buildSslContext(tls);

        return new PartnerHttpClient(
                createTransport(sslContext, timeout, pool),
                properties.baseUrl(),
                properties.clientName()
        );
    }
}
```

Yang divalidasi sebelum client digunakan:

```text
baseUrl scheme must be https
hostname allowlisted
truststore exists and readable
keystore exists if mtls enabled
certificate expiry > minimum threshold
timeouts are bounded
pool size is bounded
pinning has backup pin if enabled
redirect policy is explicit
```

---

## 28. Anti-Patterns

### 28.1 Trust-All SSLContext

Alasan umum:

```text
“supaya development gampang”
```

Risiko:

```text
terbawa ke production
```

Solusi:

```text
separate dev truststore
```

### 28.2 Disable Hostname Verification

Alasan umum:

```text
“certificate internal pakai hostname lain”
```

Solusi:

```text
benahi DNS/certificate SAN
```

### 28.3 Global JVM Truststore Override Tanpa Scope

Misalnya:

```bash
-Djavax.net.ssl.trustStore=/app/truststore.p12
```

Ini mempengaruhi semua TLS usage dalam JVM.

Kadang diperlukan, tetapi untuk banyak app lebih aman custom `SSLContext` per client agar trust scope tidak melebar.

### 28.4 Satu Keystore Berisi Semua Client Certificates

Risiko:

- salah alias,
- sulit audit,
- sulit rotation,
- terlalu luas privilege.

### 28.5 Certificate Pinning Tanpa Backup Pin

Risiko:

- outage saat rotation.

### 28.6 Menyelesaikan PKIX Error dengan Trust-All

PKIX error berarti trust path perlu diperbaiki, bukan validasi dimatikan.

### 28.7 Menganggap TLS Error sebagai HTTP 5xx

TLS error terjadi sebelum HTTP response. Jangan dipetakan sebagai downstream returned 500.

Lebih tepat:

```text
transport_security_failure
```

atau:

```text
downstream_unreachable_tls_handshake_failed
```

---

## 29. Java 8 sampai 25: Apa yang Perlu Diperhatikan

### 29.1 Java 8

Di Java 8, banyak sistem masih memakai:

- `HttpsURLConnection`,
- Apache HttpClient 4.x,
- OkHttp,
- Retrofit + OkHttp,
- Spring `RestTemplate`.

Perhatikan:

- TLS defaults tergantung update level JDK,
- ALPN support historis lebih rumit,
- HTTP/2 support tidak native di JDK `HttpClient`,
- library seperti OkHttp bisa membantu, tetapi tetap tergantung platform/provider.

### 29.2 Java 11+

Java 11 memperkenalkan `java.net.http.HttpClient` sebagai standardized modern HTTP client.

Relevan untuk:

- HTTP/1.1,
- HTTP/2,
- sync/async,
- custom `SSLContext`,
- builder-based configuration.

### 29.3 Java 17/21/25

Di Java modern:

- TLS defaults lebih aman,
- virtual threads membuat blocking client lebih feasible untuk banyak workload,
- JDK HttpClient semakin layak sebagai default untuk banyak kebutuhan,
- tetapi OkHttp/Apache/Retrofit tetap relevan karena ecosystem dan abstraction.

Rule:

```text
Jangan memilih library TLS berdasarkan “mana yang bisa connect”.
Pilih berdasarkan identity model, observability, timeout, pooling, testing, dan operational lifecycle.
```

---

## 30. Decision Framework

### 30.1 HTTPS Biasa ke Public API

Gunakan default truststore jika API memakai CA publik dan tidak ada requirement khusus.

```text
JDK HttpClient / OkHttp / Apache default TLS config
+ explicit timeout
+ explicit retry policy
+ safe logging
```

### 30.2 HTTPS ke Internal API dengan Private CA

Gunakan custom truststore berisi private CA.

```text
custom truststore
+ hostname verification tetap aktif
+ certificate expiry monitoring
```

### 30.3 mTLS ke Partner/Government API

Gunakan truststore + keystore dedicated per partner.

```text
custom truststore
+ client keystore
+ explicit alias policy if needed
+ expiry monitoring
+ staging handshake test
+ rotation runbook
```

### 30.4 Mobile/Closed Client dengan Backend Sendiri

Certificate pinning bisa dipertimbangkan, terutama dengan backup pin dan update lifecycle jelas.

### 30.5 Server-Side Third-Party API

Pinning harus sangat hati-hati. Biasanya lebih baik:

```text
CA trust + mTLS/request signing + monitoring
```

daripada pinning tanpa operational agreement.

---

## 31. Production Readiness Checklist

Sebelum HTTP client dengan HTTPS/mTLS dianggap production-ready:

### Identity and Trust

- [ ] Base URL memakai `https://`.
- [ ] Hostname certificate match target hostname.
- [ ] Truststore berisi CA yang benar.
- [ ] Truststore scope tidak terlalu luas.
- [ ] Keystore tersedia jika mTLS diperlukan.
- [ ] Client certificate chain lengkap.
- [ ] Private key terlindungi.
- [ ] Alias selection jelas jika lebih dari satu key.

### Security

- [ ] Tidak ada trust-all trust manager.
- [ ] Tidak ada hostname verifier yang selalu return true.
- [ ] TLS version/cipher tidak diturunkan tanpa approval.
- [ ] Redirect policy aman.
- [ ] Sensitive header/body tidak dilog.
- [ ] Secret tidak ada di source code.

### Operation

- [ ] Certificate expiry dimonitor.
- [ ] Rotation runbook tersedia.
- [ ] Staging handshake test tersedia.
- [ ] Failure metric membedakan TLS vs HTTP status.
- [ ] Debug procedure tersedia.
- [ ] Rollback strategy tersedia.

### Client Engineering

- [ ] HTTP client reused.
- [ ] Timeout eksplisit.
- [ ] Retry tidak mengulang non-idempotent request sembarangan.
- [ ] Connection pool bounded.
- [ ] TLS config per external identity jika diperlukan.
- [ ] Test mencakup invalid cert, expired cert, hostname mismatch, missing client cert.

---

## 32. Testing TLS/mTLS HTTP Client

### 32.1 Test Cases

Minimal test:

```text
valid certificate → success
unknown CA → fail
expired certificate → fail
hostname mismatch → fail
missing client certificate for mTLS → fail
wrong client certificate → fail
valid mTLS certificate → success
pin mismatch if pinning enabled → fail
```

### 32.2 Tools

Bisa memakai:

- local TLS server,
- WireMock with HTTPS,
- MockWebServer with TLS,
- Testcontainers dengan nginx/openssl,
- custom Java embedded HTTPS server,
- integration environment dengan real certificate chain.

### 32.3 Jangan Test Hanya Happy Path

TLS bugs sering muncul pada rotation dan mismatch. Jika test hanya “valid certificate works”, kamu belum menguji trust boundary.

---

## 33. Runbook: PKIX Path Building Failed

Gejala:

```text
javax.net.ssl.SSLHandshakeException: PKIX path building failed
```

Langkah:

```text
1. Ambil hostname dan port target.
2. Inspect certificate chain yang dikirim server.
3. Pastikan intermediate certificate dikirim lengkap.
4. Pastikan root/intermediate CA ada di truststore client.
5. Pastikan runtime benar-benar memakai truststore yang diharapkan.
6. Cek container/JVM image yang berjalan di production.
7. Cek apakah proxy TLS inspection mengganti certificate.
8. Jangan disable validation.
9. Tambahkan CA yang benar ke truststore scoped untuk client tersebut.
10. Deploy dan verify handshake.
```

---

## 34. Runbook: Hostname Verification Failed

Gejala:

```text
No subject alternative DNS name matching ... found
```

Langkah:

```text
1. Cek URL aktual yang dipakai client.
2. Cek SAN certificate server.
3. Cek apakah client memakai IP, alias, internal DNS, atau wrong domain.
4. Cek apakah proxy/LB mengirim certificate berbeda.
5. Benahi DNS atau issue certificate dengan SAN yang benar.
6. Jangan disable hostname verifier.
```

---

## 35. Runbook: mTLS bad_certificate

Gejala:

```text
Received fatal alert: bad_certificate
```

Langkah:

```text
1. Pastikan server memang meminta client certificate.
2. Pastikan client mengirim certificate.
3. Pastikan keystore client benar.
4. Pastikan alias yang dipilih benar.
5. Pastikan certificate belum expired.
6. Pastikan server trust CA dari client certificate.
7. Pastikan key usage / extended key usage sesuai client auth.
8. Cek server-side TLS logs jika tersedia.
9. Cek apakah intermediate chain client certificate lengkap.
```

---

## 36. Mental Model Akhir

HTTP client production dengan TLS harus dipikirkan sebagai:

```text
A secure transport participant with explicit identity, trust, lifecycle, rotation, and failure semantics.
```

Bukan:

```text
A utility that sends JSON over HTTPS.
```

Top-tier engineer tidak hanya bertanya:

```text
“Bagaimana cara bypass SSL error ini?”
```

Tetapi bertanya:

```text
Identity apa yang sedang diverifikasi?
Trust anchor mana yang hilang?
Hostname mana yang sebenarnya diminta?
Apakah failure terjadi sebelum HTTP layer?
Apakah certificate rotation punya runbook?
Apakah kita mencampur trust untuk banyak partner?
Apakah pinning meningkatkan security atau membuat outage waiting to happen?
```

---

## 37. Ringkasan Praktis

1. TLS adalah fondasi HTTPS; mTLS menambahkan client authentication.
2. Truststore digunakan untuk mempercayai pihak lain; keystore digunakan untuk membuktikan identitas sendiri.
3. `SSLContext` adalah pusat konfigurasi TLS di Java.
4. Jangan disable certificate validation atau hostname verification.
5. `PKIX path building failed` berarti trust path gagal, bukan alasan untuk trust-all.
6. Certificate valid tetapi hostname mismatch tetap harus gagal.
7. mTLS membutuhkan client certificate + private key dan server harus trust client certificate CA.
8. ALPN penting untuk HTTP/2 negotiation.
9. Certificate pinning berguna dalam kondisi tertentu, tetapi punya risiko operasional tinggi.
10. Certificate rotation adalah lifecycle production, bukan pekerjaan manual dadakan.
11. TLS failure harus dimodelkan sebagai transport/security failure, bukan HTTP status failure.
12. Production-grade HTTP client harus punya TLS observability, expiry monitoring, dan runbook.

---

## 38. Apa yang Tidak Kita Bahas Mendalam di Part Ini

Agar tidak mengulang seri security/cryptography sebelumnya, bagian ini tidak membahas detail matematis:

- asymmetric cryptography,
- symmetric encryption,
- certificate signing algorithm secara matematis,
- full PKI governance,
- OCSP/CRL secara mendalam,
- FIPS provider configuration secara detail.

Fokus part ini adalah bagaimana TLS/mTLS mempengaruhi HTTP client engineering di Java.

---

## 39. Hubungan ke Part Berikutnya

Part ini membahas identity dan secure transport.

Part berikutnya akan membahas authentication di atas HTTP/TLS:

```text
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
```

Hubungannya:

```text
TLS/mTLS answers:
“Can I securely talk to this server, and can the server cryptographically identify this client?”

Application authentication answers:
“Which application/user/integration principal is making this request?”

Authorization answers:
“What is this principal allowed to do?”
```

Jangan mencampur ketiganya, tetapi desain client harus mengintegrasikan semuanya.

---

## 40. Status Series

Selesai:

```text
Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1 — Java HTTP Client Landscape di Java 8–25
Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3 — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4 — Headers, Content Negotiation, Compression, dan Metadata Contract
Part 5 — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
Part 6 — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
Part 7 — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
Part 8 — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
Part 9 — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
```

Belum selesai. Masih lanjut ke Part 10.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-dns-proxy-loadbalancer-nat-network-topology-awareness.md">⬅️ Part 8 — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-client-side-auth-basic-bearer-oauth2-apikey-hmac-token-refresh.md">Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh ➡️</a>
</div>
