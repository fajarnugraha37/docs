# learn-java-authentication-modes-and-patterns-part-019

# Part 19 — Mutual TLS Authentication

> Series: **Java Authentication Modes and Patterns**  
> Scope Java: **Java 8 sampai Java 25**  
> Fokus: **mTLS sebagai authentication mode berbasis possession proof, X.509 identity, TLS handshake, Java keystore/truststore, principal mapping, certificate lifecycle, gateway/service-mesh termination, dan production failure model**

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas beberapa mode authentication:

- password authentication,
- session authentication,
- servlet container authentication,
- Jakarta Security,
- Spring Security,
- API key,
- HMAC request signing,
- JWT,
- opaque token introspection,
- OAuth2,
- OIDC,
- authorization code + PKCE,
- client credentials,
- SAML,
- LDAP / AD / Kerberos.

Sekarang kita masuk ke salah satu mode authentication yang sering dipakai di sistem enterprise, banking, government, internal platform, service mesh, partner API, dan OAuth2 high-security profile:

> **Mutual TLS authentication**, atau **mTLS**.

Secara sederhana:

```text
TLS biasa:
    Client memverifikasi server.

mTLS:
    Client memverifikasi server,
    dan server juga memverifikasi client.
```

Namun untuk engineer senior, definisi itu belum cukup.

mTLS bukan hanya “pakai sertifikat client”. mTLS adalah model authentication berbasis:

1. **possession of private key**,
2. **X.509 certificate identity**,
3. **trust anchor**,
4. **certificate chain validation**,
5. **transport-level proof**,
6. **principal mapping**,
7. **certificate lifecycle governance**.

Kalau salah desain, mTLS bisa terlihat aman tetapi tetap gagal secara sistemik:

- sertifikat valid tapi bukan milik service yang benar,
- gateway sudah melakukan mTLS tetapi aplikasi tidak tahu siapa client sebenarnya,
- certificate subject dipakai sebagai user identity tanpa normalisasi,
- truststore terlalu luas sehingga semua sertifikat dari CA tertentu diterima,
- revocation tidak diperiksa,
- certificate rotation membuat outage,
- service mesh men-terminate TLS lalu meneruskan header yang bisa dipalsukan,
- OAuth token tidak di-bind ke certificate sehingga token curian tetap bisa dipakai.

Part ini akan membangun mental model agar kita bisa mendesain mTLS secara benar di Java systems.

---

## 1. Problem yang Diselesaikan mTLS

### 1.1 Masalah Pada Bearer Credential

Banyak mode authentication menggunakan bearer credential:

```text
Authorization: Bearer <token>
X-API-Key: <api-key>
Cookie: SESSION=<session-id>
```

Masalah bearer credential:

> Siapa pun yang memiliki credential tersebut bisa menggunakannya.

Jika token bocor melalui:

- log,
- browser storage,
- proxy,
- memory dump,
- misconfigured telemetry,
- packet capture di jaringan tidak aman,
- compromised client,
- leaked API key,

maka attacker dapat memakainya selama token masih valid.

mTLS mengurangi risiko ini dengan mengubah model dari:

```text
Access allowed if caller presents token.
```

menjadi:

```text
Access allowed if caller proves possession of private key
bound to a trusted certificate.
```

Dalam OAuth2, pola ini menjadi lebih kuat ketika token juga di-bind ke certificate, sehingga token tidak cukup untuk dipakai tanpa private key yang sesuai.

---

### 1.2 Masalah Trust Antar Service

Dalam microservices, sering ada asumsi buruk:

```text
Request datang dari internal network, berarti trusted.
```

Ini lemah karena:

- internal network bisa ditembus,
- pod/container bisa compromise,
- service bisa melakukan lateral movement,
- DNS bisa salah resolve,
- load balancer/gateway bisa salah konfigurasi,
- environment dev/staging/prod bisa tercampur,
- shared secret bisa bocor.

mTLS membantu membuat network internal menjadi lebih explicit:

```text
Service A hanya boleh berbicara dengan Service B jika:
- koneksi TLS valid,
- server certificate Service B valid,
- client certificate Service A valid,
- identity certificate sesuai policy,
- certificate chain dipercaya,
- certificate belum expired/revoked.
```

mTLS mengubah trust dari “lokasi jaringan” menjadi “cryptographic identity”.

---

### 1.3 Masalah Partner API

Untuk API eksternal antar organisasi, API key saja sering tidak cukup.

Contoh:

```text
Partner -> API Gateway -> Java Backend
```

Dengan API key:

- credential bisa dicopy,
- sulit membedakan machine asli dan attacker,
- secret sering disimpan di file/config,
- rotation operationally sulit.

Dengan mTLS:

- partner harus punya private key,
- server hanya menerima certificate dari CA/trust anchor yang disetujui,
- certificate dapat dibatasi per partner,
- certificate expiry/rotation dapat diatur,
- principal mapping dapat mengikat certificate ke partner account.

Namun ini hanya aman jika certificate mapping dan lifecycle governance benar.

---

## 2. Mental Model Utama: mTLS Bukan Sekadar Encryption

TLS biasa sering dipahami sebagai encryption channel.

Padahal TLS menyediakan beberapa properti:

1. **confidentiality** — isi komunikasi tidak mudah dibaca pihak ketiga,
2. **integrity** — isi komunikasi tidak bisa diubah diam-diam,
3. **server authentication** — client yakin berbicara dengan server yang benar,
4. **optional client authentication** — server yakin berbicara dengan client yang memiliki private key sesuai certificate.

mTLS memakai properti keempat.

---

## 3. TLS Biasa vs mTLS

### 3.1 TLS Biasa

```text
Client                                    Server
  | -------- ClientHello ----------------> |
  | <------- ServerHello ----------------- |
  | <------- Server Certificate ---------- |
  |         validate server cert           |
  | -------- key exchange / finished ----> |
  | <------- finished -------------------- |
  |         encrypted application data      |
```

Client memverifikasi server certificate.

Server biasanya tidak tahu cryptographic identity client. Client identity bisa datang dari layer lain:

- cookie,
- bearer token,
- API key,
- Basic auth,
- form login,
- JWT.

---

### 3.2 mTLS

```text
Client                                    Server
  | -------- ClientHello ----------------> |
  | <------- ServerHello ----------------- |
  | <------- Server Certificate ---------- |
  | <------- CertificateRequest ---------- |
  |         validate server cert           |
  | -------- Client Certificate ---------> |
  | -------- CertificateVerify ----------> |
  | -------- key exchange / finished ----> |
  | <------- finished -------------------- |
  |         encrypted application data      |
```

Server meminta client certificate.

Client membuktikan bahwa ia memiliki private key yang cocok dengan public key dalam certificate.

Poin penting:

> Server tidak hanya menerima certificate. Server harus membuktikan certificate itu valid dan client memang memegang private key-nya.

Certificate tanpa private key tidak cukup.

---

## 4. X.509 Certificate Sebagai Identity Carrier

mTLS memakai X.509 certificate.

Certificate bukan private key.

Certificate adalah dokumen terstruktur yang berisi:

- subject,
- issuer,
- serial number,
- validity period,
- public key,
- key usage,
- extended key usage,
- subject alternative names,
- signature dari issuer,
- extension lain.

Simplified:

```text
Certificate
├── Subject: CN=payment-service, O=Example Corp
├── Issuer: CN=Example Internal CA
├── Serial Number: 123456
├── Valid From / Valid Until
├── Public Key
├── Subject Alternative Name:
│   ├── DNS: payment-service.prod.svc.cluster.local
│   ├── URI: spiffe://prod/ns/payment/sa/payment-service
│   └── email / IP / other name variants
├── Key Usage
├── Extended Key Usage
└── Signature by CA
```

Certificate menjawab:

```text
Public key ini dikaitkan dengan subject/SAN tertentu,
dan pernyataan ini ditandatangani oleh issuer yang dipercaya.
```

Private key menjawab:

```text
Caller benar-benar memiliki secret cryptographic material
untuk certificate tersebut.
```

---

## 5. Root of Trust: CA, Truststore, dan Certificate Chain

### 5.1 Certificate Chain

Sertifikat client biasanya tidak berdiri sendiri.

```text
Client Certificate
  signed by Intermediate CA
    signed by Root CA
```

Server memverifikasi chain hingga trust anchor.

```text
Client cert -> Intermediate CA -> Root CA in truststore
```

Jika root/intermediate dipercaya, chain valid, expiry valid, usage valid, dan policy sesuai, maka client certificate dianggap cryptographically trusted.

---

### 5.2 Truststore

Dalam Java, truststore adalah tempat menyimpan certificate/CA yang dipercaya untuk validasi peer.

Untuk server yang menerima client certificate:

```text
Server truststore berisi CA yang dipercaya untuk menandatangani client cert.
```

Untuk client yang memverifikasi server:

```text
Client truststore berisi CA yang dipercaya untuk menandatangani server cert.
```

Mental model:

```text
Keystore  = identitas saya + private key saya.
Truststore = identitas pihak lain/CA yang saya percaya.
```

Oracle JSSE Reference Guide menjelaskan truststore sebagai keystore yang digunakan untuk membuat keputusan tentang apa yang dipercaya. Dalam konteks mTLS, konsep ini menjadi pusat verifikasi peer identity.

---

### 5.3 Keystore

Keystore menyimpan private key dan certificate chain milik pihak tersebut.

Server:

```text
server-keystore.p12
├── server private key
└── server certificate chain
```

Client:

```text
client-keystore.p12
├── client private key
└── client certificate chain
```

Truststore:

```text
server-truststore.p12
└── CA certificates allowed for clients

client-truststore.p12
└── CA certificates allowed for servers
```

---

## 6. mTLS Authentication Boundary

mTLS terjadi di transport layer.

Artinya authentication terjadi sebelum HTTP request diproses aplikasi.

```text
TCP connection
  -> TLS handshake
      -> client certificate validation
          -> HTTP request
              -> application authentication/authorization
```

Konsekuensinya:

1. request bisa ditolak sebelum mencapai controller,
2. authentication bisa terjadi di load balancer/gateway,
3. aplikasi mungkin tidak melihat certificate asli,
4. identity harus diteruskan dengan aman jika TLS termination terjadi sebelum aplikasi,
5. policy mapping harus jelas: TLS identity bukan otomatis app user.

---

## 7. Three Layers of mTLS Identity

mTLS punya tiga layer identity yang sering dicampuradukkan.

### 7.1 Cryptographic Identity

```text
Private key matches certificate public key.
Certificate chain validates to trusted CA.
```

Ini dijawab oleh TLS stack.

---

### 7.2 Certificate Identity

```text
What does the certificate say?
```

Contoh:

```text
Subject CN=partner-a
SAN DNS=partner-a.api.example.com
SAN URI=spiffe://prod/ns/payment/sa/payment-service
```

---

### 7.3 Application Principal

```text
Who is this caller inside our application domain?
```

Contoh:

```text
Certificate SAN URI spiffe://prod/ns/payment/sa/payment-service
maps to principal SERVICE:payment-service
maps to tenant tenant-001
maps to permissions [PAYMENT_READ, PAYMENT_SUBMIT]
```

Poin penting:

> mTLS hanya membuktikan cryptographic possession dan certificate validity. Aplikasi tetap harus menentukan bagaimana certificate identity dipetakan ke principal dan policy.

---

## 8. mTLS Authentication Flow End-to-End

Contoh service-to-service:

```text
payment-service -> compliance-service
```

Flow:

```text
1. payment-service membuka TLS connection ke compliance-service.
2. compliance-service mengirim server certificate.
3. payment-service memvalidasi server certificate terhadap truststore.
4. compliance-service meminta client certificate.
5. payment-service mengirim client certificate chain.
6. compliance-service memvalidasi chain client certificate.
7. payment-service membuktikan possession private key melalui TLS handshake.
8. TLS connection terbentuk.
9. compliance-service membaca peer certificate.
10. compliance-service memetakan certificate identity ke application principal.
11. Authorization layer memutuskan apakah principal boleh mengakses endpoint/action.
12. Audit layer mencatat certificate fingerprint, subject/SAN, mapped principal, request id, dan decision.
```

---

## 9. Java mTLS Building Blocks

### 9.1 JSSE

Java Secure Socket Extension adalah fondasi TLS di Java.

Komponen penting:

- `SSLContext`,
- `SSLSocketFactory`,
- `SSLServerSocketFactory`,
- `SSLEngine`,
- `KeyManager`,
- `TrustManager`,
- `X509KeyManager`,
- `X509TrustManager`,
- `KeyStore`,
- `TrustStore` secara konseptual,
- `HttpsURLConnection`,
- Java 11+ `HttpClient`,
- server runtime seperti Tomcat/Jetty/Undertow/Netty.

---

### 9.2 KeyStore API

Java memakai `KeyStore` API untuk membaca material seperti JKS/PKCS12.

Modern recommendation:

```text
Prefer PKCS12 for interoperability.
```

Java 8 historis banyak memakai JKS. Java modern lebih umum memakai PKCS12.

Contoh conceptual loading:

```java
KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("client-keystore.p12"))) {
    keyStore.load(in, keyStorePassword.toCharArray());
}
```

---

### 9.3 KeyManager

`KeyManager` memilih certificate/private key yang dikirim oleh local side.

Client-side mTLS:

```text
Client KeyManager memilih client certificate.
```

Server-side TLS:

```text
Server KeyManager memilih server certificate.
```

Jika ada banyak certificate dalam satu keystore, pemilihan alias menjadi penting.

Failure mode:

```text
Client punya beberapa cert,
tetapi Java memilih cert yang salah,
server menolak handshake.
```

Solusi:

- pisahkan keystore per identity,
- gunakan alias eksplisit jika framework mendukung,
- custom `X509ExtendedKeyManager` untuk pemilihan alias,
- hindari satu keystore berisi terlalu banyak identity unrelated.

---

### 9.4 TrustManager

`TrustManager` memvalidasi certificate peer.

Server-side mTLS:

```text
Server TrustManager memvalidasi client certificate.
```

Client-side TLS:

```text
Client TrustManager memvalidasi server certificate.
```

Anti-pattern paling berbahaya:

```java
new X509TrustManager() {
    public void checkClientTrusted(...) {}
    public void checkServerTrusted(...) {}
    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
}
```

Ini mematikan trust validation.

Untuk production, jangan gunakan trust-all manager.

---

## 10. Java Client mTLS Example: Java 11+ HttpClient

Contoh konseptual:

```java
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;

public final class MtlsHttpClientExample {

    public static HttpClient createClient(
            Path clientKeyStorePath,
            char[] clientKeyStorePassword,
            Path trustStorePath,
            char[] trustStorePassword
    ) throws Exception {

        KeyStore clientKeyStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(clientKeyStorePath)) {
            clientKeyStore.load(in, clientKeyStorePassword);
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(clientKeyStore, clientKeyStorePassword);

        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(trustStorePath)) {
            trustStore.load(in, trustStorePassword);
        }

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);

        return HttpClient.newBuilder()
                .sslContext(sslContext)
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public static void main(String[] args) throws Exception {
        HttpClient client = createClient(
                Path.of("client-keystore.p12"),
                System.getenv("CLIENT_KEYSTORE_PASSWORD").toCharArray(),
                Path.of("client-truststore.p12"),
                System.getenv("CLIENT_TRUSTSTORE_PASSWORD").toCharArray()
        );

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.partner.example.com/v1/status"))
                .GET()
                .timeout(Duration.ofSeconds(10))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.statusCode());
        System.out.println(response.body());
    }
}
```

Important notes:

1. Password char array masih berada di memory; jangan hardcode.
2. Keystore path jangan dipaketkan sembarangan ke image publik.
3. Untuk Kubernetes, mount secret sebagai volume atau gunakan secret manager integration.
4. Jangan log certificate/private key material.
5. Jangan disable hostname verification.

---

## 11. Java 8 Client mTLS Pattern

Java 8 belum punya `java.net.http.HttpClient` standard.

Pilihan umum:

- `HttpsURLConnection`,
- Apache HttpClient,
- OkHttp,
- Jersey Client,
- Spring `RestTemplate`,
- Netty.

Pattern sama:

```text
Load client keystore
Load truststore
Create KeyManagerFactory
Create TrustManagerFactory
Create SSLContext
Inject SSLContext into HTTP client
```

Contoh konseptual `HttpsURLConnection`:

```java
HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
connection.setSSLSocketFactory(sslContext.getSocketFactory());
connection.setRequestMethod("GET");
int status = connection.getResponseCode();
```

Risiko di Java 8:

- TLS protocol default bisa lebih tua tergantung update level,
- cipher suite policy tergantung JDK distribution,
- legacy JKS masih sering dipakai,
- hostname verification kadang dimatikan saat debugging lalu lupa dikembalikan,
- TLS 1.3 tidak selalu tersedia tergantung JDK 8 vendor/update.

---

## 12. Server-Side mTLS in Java Web Containers

Pada server Java, mTLS biasanya dikonfigurasi di layer container:

- Tomcat,
- Jetty,
- Undertow,
- Netty,
- Spring Boot embedded Tomcat/Jetty/Undertow,
- application server seperti GlassFish, Payara, WildFly, WebLogic, Open Liberty.

### 12.1 Tomcat/Spring Boot Concept

Spring Boot dengan embedded Tomcat dapat dikonfigurasi agar meminta client certificate.

Konsep property:

```properties
server.ssl.enabled=true
server.ssl.key-store=classpath:server-keystore.p12
server.ssl.key-store-password=${SERVER_KEYSTORE_PASSWORD}
server.ssl.key-store-type=PKCS12
server.ssl.trust-store=classpath:server-truststore.p12
server.ssl.trust-store-password=${SERVER_TRUSTSTORE_PASSWORD}
server.ssl.trust-store-type=PKCS12
server.ssl.client-auth=need
```

`client-auth=need` berarti client certificate wajib.

`client-auth=want` berarti server meminta certificate tetapi tidak wajib.

Untuk authentication yang serius, `need` biasanya lebih tepat di endpoint khusus mTLS.

---

### 12.2 Why `want` Is Dangerous If Misunderstood

`want` dapat berguna untuk endpoint campuran.

Namun berbahaya jika developer mengira:

```text
client-auth=want berarti semua request authenticated dengan cert.
```

Padahal client bisa tidak mengirim certificate.

Jika endpoint membutuhkan cert, aplikasi harus memeriksa keberadaan peer certificate.

Better design:

```text
Use separate port/virtual host/path/gateway route for mTLS-required endpoints.
```

---

## 13. Accessing Client Certificate in Servlet

Dalam Servlet environment, client certificate biasanya tersedia sebagai request attribute:

```java
X509Certificate[] certs = (X509Certificate[]) request.getAttribute(
        "javax.servlet.request.X509Certificate"
);
```

Pada Jakarta namespace modern, container masih banyak mempertahankan attribute name historis tersebut, tetapi detailnya perlu dicek sesuai container.

Conceptual logic:

```java
X509Certificate[] certs = (X509Certificate[]) request.getAttribute(
        "javax.servlet.request.X509Certificate"
);

if (certs == null || certs.length == 0) {
    throw new UnauthenticatedException("Client certificate is required");
}

X509Certificate leaf = certs[0];
String subject = leaf.getSubjectX500Principal().getName();
Collection<List<?>> sans = leaf.getSubjectAlternativeNames();
```

Namun jangan langsung jadikan subject sebagai principal tanpa mapping policy.

---

## 14. Spring Security X.509 Authentication

Spring Security menyediakan X.509 authentication support.

Konsepnya:

```text
TLS layer validates certificate.
Spring Security extracts principal from certificate.
UserDetailsService loads application identity.
Authentication object is placed into SecurityContext.
```

Simplified configuration:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    http
        .x509(x509 -> x509
            .subjectPrincipalRegex("CN=(.*?)(?:,|$)")
            .userDetailsService(userDetailsService())
        )
        .authorizeHttpRequests(auth -> auth
            .anyRequest().authenticated()
        );

    return http.build();
}
```

This is useful, but be careful.

Subject regex is convenient but can be too weak.

Problems:

1. CN is not always stable.
2. SAN is often preferred over CN for identity.
3. Regex extraction can accidentally accept malformed subject.
4. Same CN may appear under different CA unless issuer constrained.
5. Mapping should include issuer, fingerprint, SAN URI/DNS, tenant, environment, and certificate policy.

Better mental model:

```text
certificate -> normalized certificate identity -> application principal -> authorization policy
```

Not:

```text
CN -> username -> done
```

---

## 15. Principal Mapping Strategies

### 15.1 Subject CN Mapping

Example:

```text
CN=partner-a,O=Partner Corp,C=SG
```

Mapping:

```text
CN partner-a -> PARTNER:partner-a
```

Simple but fragile.

Problems:

- CN may not be unique,
- naming conventions change,
- CA may issue duplicate names,
- subject formatting can vary,
- CN is not the preferred identity field for many TLS server-name scenarios.

Use only if governance is strict and issuer is constrained.

---

### 15.2 SAN DNS Mapping

Example:

```text
SAN DNS=payment-service.prod.svc.cluster.local
```

Mapping:

```text
DNS SAN -> SERVICE:payment-service
```

Good for service identity, but environment/namespace must be modeled.

Potential issue:

```text
payment-service.dev.svc.cluster.local
```

must not map to prod service principal.

---

### 15.3 SAN URI Mapping

Example SPIFFE-style identity:

```text
spiffe://prod.example.com/ns/payment/sa/payment-service
```

Mapping:

```text
trust domain = prod.example.com
namespace = payment
service account = payment-service
principal = SERVICE:payment-service@payment/prod
```

This is usually cleaner for workload identity.

---

### 15.4 Certificate Fingerprint Pinning

Mapping:

```text
SHA-256 fingerprint -> registered client record
```

Pros:

- very precise,
- useful for partner certificates,
- avoids ambiguous subject parsing.

Cons:

- rotation requires registering new fingerprint,
- operational overhead,
- emergency replacement can break traffic,
- not scalable for short-lived certs.

---

### 15.5 Issuer + Serial Mapping

Mapping:

```text
issuer DN + serial number -> credential record
```

Good for PKI-managed credential inventory.

Need care because serial uniqueness is scoped to issuer.

---

### 15.6 Recommended Mapping Model

For serious systems, use composite mapping:

```text
leaf certificate
├── issuer / trust anchor
├── SAN URI or SAN DNS
├── certificate policy / EKU
├── fingerprint
├── validity window
└── environment / tenant binding

maps to

application principal
├── principal type: SERVICE / PARTNER / DEVICE / USER
├── principal id
├── tenant id
├── environment
├── allowed audiences
└── allowed scopes/actions
```

This allows safe rotation and auditability.

---

## 16. mTLS and OAuth2

mTLS can be used in OAuth2 in two major ways.

### 16.1 mTLS Client Authentication to Authorization Server

Client authenticates to token endpoint using certificate.

```text
Client -> Authorization Server /token
        using mutual TLS client authentication
```

Instead of:

```text
client_id + client_secret
```

use:

```text
client certificate + private key proof
```

This is stronger because private key is not sent over the wire.

---

### 16.2 Certificate-Bound Access Tokens

OAuth2 mTLS can bind token to client certificate.

Mental model:

```text
Access token says:
    this token may only be used over a TLS connection
    authenticated with certificate X.
```

Then resource server verifies:

1. token is valid,
2. TLS client cert is present,
3. token certificate binding matches presented certificate.

Without this binding:

```text
Token stolen from mTLS client may still be used elsewhere.
```

With binding:

```text
Token stolen without private key is not enough.
```

RFC 8705 standardizes OAuth2 mutual TLS client authentication and certificate-bound tokens.

---

## 17. mTLS vs HMAC vs API Key vs JWT

| Mode | Proof Type | Secret Exposure | Replay Resistance | Best For | Main Weakness |
|---|---:|---:|---:|---|---|
| API Key | bearer secret | secret sent per request | weak unless combined | simple client/app auth | stolen key usable |
| HMAC | shared secret signing | secret not sent | strong if timestamp/nonce correct | partner/internal APIs | canonicalization complexity |
| JWT Bearer | signed assertion/bearer | token sent | depends on expiry/jti | distributed resource server | stolen token usable |
| mTLS | private key possession | private key not sent | strong at transport level | service/partner/workload auth | PKI lifecycle complexity |
| mTLS-bound token | token + private key possession | token sent, key not sent | stronger | high-security OAuth APIs | operational complexity |

mTLS is not universally better.

It is best when:

- client is machine/workload,
- private key can be protected,
- certificate lifecycle can be governed,
- channel-level identity is acceptable,
- infrastructure can support TLS termination correctly.

It is less ideal when:

- client is browser-based user,
- certificate provisioning to end-user devices is hard,
- mobile device key management is weak,
- many external developers need self-service onboarding,
- infrastructure cannot safely propagate client certificate info.

---

## 18. mTLS at Different Deployment Layers

### 18.1 App-Level mTLS

```text
Client -> Java app directly with mTLS
```

Pros:

- application can inspect certificate directly,
- less trust in intermediate header forwarding,
- strong end-to-end semantics.

Cons:

- each app must manage TLS config,
- certificate rotation in each app,
- more operational complexity,
- less centralized policy.

---

### 18.2 Gateway-Level mTLS

```text
Client -> API Gateway with mTLS -> Java backend over internal network
```

Pros:

- centralized certificate validation,
- easier partner onboarding,
- rate limit and policy at edge,
- apps simpler.

Cons:

- backend must trust gateway,
- client certificate identity must be safely propagated,
- headers can be spoofed if backend reachable directly,
- gateway mapping policy becomes critical.

Required controls:

```text
1. Backend only accepts traffic from gateway/private network.
2. Gateway strips incoming identity headers before adding trusted ones.
3. Backend validates gateway identity.
4. Propagated identity is signed or protected if needed.
5. Audit records both gateway decision and backend decision.
```

---

### 18.3 Service Mesh mTLS

```text
Service A -> sidecar/proxy -> mTLS -> sidecar/proxy -> Service B
```

Pros:

- automatic workload identity,
- automatic cert rotation,
- consistent service-to-service mTLS,
- policy layer outside application.

Cons:

- app may not know original mTLS identity,
- trust shifts to mesh control plane,
- debugging becomes harder,
- authorization must decide whether mesh identity is sufficient,
- bypass path must be blocked.

Important distinction:

```text
Mesh mTLS authenticates workloads at network layer.
Application auth may still need end-user identity or business principal.
```

---

## 19. Certificate Lifecycle Engineering

mTLS security depends heavily on lifecycle.

### 19.1 Issuance

Questions:

- Who can request a certificate?
- How is requester identity verified?
- What subject/SAN is allowed?
- Which CA signs it?
- What environment is encoded?
- Is certificate for client auth, server auth, or both?

---

### 19.2 Distribution

Questions:

- How is private key generated?
- Is private key generated client-side or by CA/secret manager?
- Is private key ever transmitted?
- Where is keystore stored?
- Who can read it?
- How is it mounted into container?
- How is password stored?

Best practice direction:

```text
Private key should be generated and stored as close as possible to its runtime owner.
```

For Kubernetes:

- mount as secret volume,
- limit RBAC access,
- avoid env var for large secret material if possible,
- monitor secret access,
- rotate certificates automatically where possible.

---

### 19.3 Rotation

Rotation must avoid outage.

Safe pattern:

```text
1. Add new CA/cert to truststore while old still valid.
2. Deploy truststore update.
3. Issue new client certificate.
4. Deploy client keystore update.
5. Verify traffic uses new cert.
6. Revoke/retire old cert.
7. Remove old trust after grace period.
```

For certificate pinning:

```text
register old + new fingerprint during overlap window.
```

---

### 19.4 Expiry

Certificate expiry can cause sudden outage.

Operational rule:

```text
Certificate expiry is not a calendar reminder.
It is a production reliability risk.
```

Required telemetry:

- certificate expiry days remaining,
- truststore expiry days remaining,
- handshake failures by reason,
- certificate serial/fingerprint in use,
- number of requests per client certificate,
- old certificate still used after rotation.

---

### 19.5 Revocation

Revocation options:

- CRL,
- OCSP,
- short-lived certificates,
- gateway denylist,
- application credential registry,
- CA trust removal.

Trade-off:

```text
CRL/OCSP improve revocation semantics but add latency/availability complexity.
Short-lived certificates reduce revocation need but require reliable automation.
```

For internal service mesh, short-lived certificates are common.

For partner API, explicit certificate registry and denylist are often practical.

---

## 20. Certificate Validation Checklist

A robust mTLS design should validate:

```text
[ ] Certificate chain validates to trusted CA.
[ ] Certificate not expired.
[ ] Certificate not before date valid.
[ ] Key usage allows digital signature/key agreement as needed.
[ ] Extended key usage allows client authentication for client cert.
[ ] Issuer/trust anchor allowed for this endpoint/tenant.
[ ] Subject/SAN matches expected identity pattern.
[ ] Revocation or short-lived cert strategy exists.
[ ] Certificate maps to active application principal.
[ ] Principal maps to allowed tenant/environment.
[ ] Authorization is checked after authentication.
[ ] Audit logs include stable certificate identifiers.
```

---

## 21. Extended Key Usage and Key Usage

Not every certificate should be accepted for client auth.

Certificates can contain Extended Key Usage values such as:

```text
serverAuth
clientAuth
codeSigning
emailProtection
```

For mTLS client authentication, certificate should be appropriate for `clientAuth`.

Failure mode:

```text
A server certificate or unrelated certificate is accepted as client credential.
```

This is a policy failure.

Ensure your TLS stack / gateway / CA policy enforces EKU.

---

## 22. Hostname Verification vs Client Certificate Verification

Do not confuse:

```text
Server certificate hostname verification
```

with:

```text
Client certificate principal mapping
```

Client-side verification:

```text
Does server certificate match api.example.com?
```

Server-side mapping:

```text
Does client certificate represent partner-a/service-a?
```

Disabling hostname verification is a severe anti-pattern.

```java
hostnameVerifier = (hostname, session) -> true;
```

This allows man-in-the-middle attacks against the client.

---

## 23. mTLS Does Not Replace Authorization

mTLS answers:

```text
Which certificate/private key authenticated this connection?
```

It does not answer:

```text
Is this client allowed to submit this payment?
Is this service allowed to read this tenant's case?
Is this partner allowed to call this endpoint?
Is this request on behalf of a user or system actor?
```

After mTLS authentication, still run authorization.

Recommended separation:

```text
Authentication:
    certificate -> principal

Authorization:
    principal + action + resource + tenant + context -> decision
```

---

## 24. Combining mTLS with Application Tokens

### 24.1 mTLS + JWT

```text
mTLS authenticates client transport.
JWT carries user/system claims.
```

Useful for:

- service-to-service call with end-user delegation,
- internal APIs requiring both workload identity and user identity,
- high-risk partner APIs.

Validation:

```text
1. mTLS client principal = partner-a
2. JWT issuer = trusted authorization server
3. JWT audience = target API
4. JWT subject/user/actor valid
5. JWT client_id or cnf claim matches mTLS principal if bound
6. Authorization policy checks combined identity
```

---

### 24.2 mTLS + API Key

Sometimes used for partner APIs:

```text
mTLS proves machine possession.
API key identifies application subscription/account.
```

Be careful: this can become redundant or confusing.

Use only if each factor has distinct purpose.

---

### 24.3 mTLS + HMAC

Rare but possible in high-integrity APIs:

```text
mTLS protects channel and authenticates client cert.
HMAC signs request payload/canonical request.
```

Useful when you need message-level integrity beyond transport layer or asynchronous verification.

But operational complexity is high.

---

## 25. Gateway Header Propagation Problem

When gateway terminates mTLS, backend may receive identity via header:

```http
X-Client-Cert: ...
X-Client-Subject: CN=partner-a,O=Partner Corp
X-Client-Fingerprint: sha256:...
```

This is dangerous if backend can be called directly by attacker.

Attack:

```text
Attacker -> backend directly
Header: X-Client-Subject: CN=trusted-partner
```

Mitigations:

```text
1. Backend not publicly reachable.
2. Backend requires gateway mTLS too.
3. Gateway strips all inbound identity headers.
4. Gateway injects trusted identity headers only after successful mTLS.
5. Backend trusts identity headers only from authenticated gateway.
6. Prefer signed internal assertion if multi-hop trust is complex.
```

For high-assurance systems, propagate a signed internal token/assertion instead of raw headers.

---

## 26. Audit Model for mTLS

Audit should capture both cryptographic and application identity.

Minimum fields:

```text
event_type: MTLS_AUTHENTICATION_SUCCESS / FAILURE
request_id
connection_id if available
client_ip / proxy chain
certificate_subject
certificate_issuer
certificate_serial_number
certificate_sha256_fingerprint
san_dns
san_uri
mapped_principal_type
mapped_principal_id
tenant_id
environment
authentication_decision
authorization_decision
failure_reason
server_name / endpoint
timestamp
```

Do not log:

- private key,
- full PEM if unnecessary,
- sensitive certificate extension if it leaks internal topology,
- raw headers without sanitization.

---

## 27. Observability and Troubleshooting

mTLS failures often appear as generic TLS handshake failure.

Useful diagnostics:

```text
javax.net.debug=ssl,handshake
```

But be careful in production because debug logs can be verbose and sensitive.

Common error categories:

| Symptom | Likely Cause |
|---|---|
| `bad_certificate` | client cert rejected |
| `unknown_ca` | CA not in truststore |
| `certificate_expired` | expired cert |
| `handshake_failure` | protocol/cipher/client-auth mismatch |
| `PKIX path building failed` | Java cannot build chain to trust anchor |
| `No available authentication scheme` | no suitable client cert/private key |
| hostname verification failure | server cert SAN mismatch |

Troubleshooting sequence:

```text
1. Confirm server requires/requests client cert.
2. Confirm client sends cert.
3. Confirm client cert chain complete.
4. Confirm server truststore has correct CA.
5. Confirm cert validity dates.
6. Confirm EKU/key usage.
7. Confirm SNI/hostname.
8. Confirm TLS version/cipher compatibility.
9. Confirm principal mapping.
10. Confirm authorization decision.
```

---

## 28. Performance Considerations

mTLS cost appears mainly during handshake, not every byte of application data.

Cost areas:

- asymmetric crypto during handshake,
- certificate chain validation,
- CRL/OCSP lookup,
- session resumption behavior,
- connection churn,
- load balancer TLS termination,
- JVM TLS implementation and provider,
- CPU spikes during connection storms.

Mitigations:

```text
1. Reuse connections.
2. Use HTTP keep-alive / connection pooling.
3. Avoid creating new SSLContext per request.
4. Cache trust material safely.
5. Monitor handshake rate separately from request rate.
6. Use short-lived certs carefully; do not rotate too aggressively without capacity planning.
7. Benchmark with realistic concurrency and connection churn.
```

In Java clients, creating `SSLContext` per request is a common performance bug.

---

## 29. Security Anti-Patterns

### 29.1 Trust-All TrustManager

```text
Accept all certificates.
```

This destroys authentication.

---

### 29.2 Disable Hostname Verification

```text
Accept any server certificate for any hostname.
```

This enables MITM.

---

### 29.3 Trusting Too Broad CA

```text
Any certificate signed by corporate CA is accepted as any service.
```

This causes identity confusion.

Need endpoint-specific or tenant-specific mapping.

---

### 29.4 Direct CN-to-Admin Mapping

```text
CN=admin -> ROLE_ADMIN
```

This is dangerous if certificate issuance policy is not extremely strict.

---

### 29.5 Gateway Header Spoofing

Backend trusts `X-Client-Cert` from any source.

---

### 29.6 No Rotation Plan

Certificate expires and production goes down.

---

### 29.7 No Revocation Strategy

Compromised certificate remains accepted until expiry.

---

### 29.8 Mixing Environments

Dev CA trusted in prod.

Or prod cert accepted in staging causing data leakage.

---

### 29.9 Certificate Identity Used As User Identity

mTLS certificate usually represents machine/workload/partner, not necessarily human user.

If a request acts on behalf of a user, carry user identity separately.

---

## 30. Design Patterns

### 30.1 Partner API mTLS Pattern

```text
Partner system
  -> API Gateway requiring mTLS
      -> certificate registry
      -> rate limit per partner
      -> Java backend
```

Registry:

```text
partner_id
allowed_fingerprints
allowed_issuers
allowed_san
status ACTIVE/SUSPENDED/REVOKED
valid_from / valid_to
allowed_api_products
rate_limit_policy
```

Backend receives:

```text
partner principal, not raw certificate subject only.
```

---

### 30.2 Internal Service mTLS Pattern

```text
Service A -> Service B
```

Certificate identity:

```text
SAN URI=spiffe://prod/ns/payment/sa/payment-service
```

Policy:

```text
payment-service may call compliance-service /risk-check
but not /admin/reconfigure
```

---

### 30.3 OAuth2 mTLS Bound Token Pattern

```text
Client obtains token over mTLS.
Authorization Server binds token to cert thumbprint.
Client calls Resource Server over mTLS with token.
Resource Server validates token and cert binding.
```

This mitigates stolen bearer token reuse.

---

### 30.4 Admin/Operator mTLS Pattern

For highly sensitive internal admin endpoints:

```text
Operator device cert + SSO + MFA + authorization
```

mTLS is device/workstation possession proof, not complete user authentication.

---

## 31. mTLS in Regulatory / Case Management Systems

In regulatory systems, mTLS is useful for:

- agency-to-agency integration,
- internal privileged APIs,
- batch transfer channels,
- service-to-service identity,
- document exchange,
- audit-sensitive API calls,
- high-impact admin operations.

But design must preserve defensibility.

A defensible mTLS event says:

```text
At time T,
request R was received through endpoint E,
over a TLS session where the peer presented certificate C,
C chained to trusted CA A,
C had fingerprint F and serial S,
C was mapped by policy version P to principal X,
principal X was authorized by rule Y to perform action Z on resource Q,
and the request was accepted/rejected.
```

This is much stronger than:

```text
Request came from internal IP.
```

---

## 32. Java 8–25 Considerations

### 32.1 Java 8

Common realities:

- legacy JKS,
- older TLS defaults depending on update,
- `HttpsURLConnection`, Apache HttpClient, OkHttp commonly used,
- TLS 1.3 not guaranteed across all Java 8 runtimes,
- application servers often configure TLS outside app code.

Production concern:

```text
Know exact JDK vendor and update level.
```

---

### 32.2 Java 11+

Java 11 introduced standard `java.net.http.HttpClient`, making custom SSLContext injection straightforward.

Useful for service-to-service clients.

---

### 32.3 Java 17 / 21 LTS

Common modern enterprise baseline.

Focus:

- stronger TLS defaults,
- better container runtime support,
- Spring Boot 3.x on Java 17+,
- better observability integration,
- virtual thread readiness in Java 21 but context propagation must be deliberate.

---

### 32.4 Java 25

Java 25 continues modern platform evolution.

For authentication engineering, relevant areas include:

- TLS/JSSE runtime behavior,
- keystore/truststore management,
- PEM-related improvements in platform direction,
- virtual threads and structured concurrency affecting request/client execution patterns,
- security provider behavior and algorithm availability.

Do not assume Java version alone makes mTLS safe. Most mTLS failures are configuration, lifecycle, and mapping failures.

---

## 33. Implementation Checklist

### 33.1 Client Checklist

```text
[ ] Has private key and client certificate chain.
[ ] Keystore is protected.
[ ] Truststore validates server certificate.
[ ] Hostname verification enabled.
[ ] SSLContext reused.
[ ] Connection pooling enabled.
[ ] Certificate rotation process exists.
[ ] Expiry monitored.
[ ] No trust-all code.
[ ] No private key logging.
```

---

### 33.2 Server Checklist

```text
[ ] Requires client certificate where needed.
[ ] Truststore contains only intended client CAs.
[ ] Certificate chain validation enabled.
[ ] EKU/clientAuth enforced where possible.
[ ] Peer certificate extracted safely.
[ ] Certificate identity mapped to application principal.
[ ] Authorization performed after mapping.
[ ] Gateway header spoofing prevented.
[ ] Revocation/short-lived certificate strategy exists.
[ ] Certificate expiry monitored.
[ ] Audit records stable cert identifiers.
```

---

### 33.3 Gateway Checklist

```text
[ ] mTLS required at correct listener/route.
[ ] Client CA bundle scoped correctly.
[ ] Incoming identity headers stripped.
[ ] Trusted identity headers injected only after validation.
[ ] Backend not reachable directly.
[ ] Gateway-to-backend channel authenticated.
[ ] Certificate registry integrated.
[ ] Partner status checked.
[ ] Logs contain fingerprint/serial/partner id.
[ ] Rotation supports old+new cert overlap.
```

---

## 34. Decision Framework

Use mTLS when:

```text
[ ] Caller is machine/workload/partner/device.
[ ] Private key can be protected.
[ ] Certificate lifecycle can be automated or governed.
[ ] Need stronger proof than bearer secret.
[ ] Need cryptographic client authentication at transport layer.
[ ] Infrastructure supports proper TLS termination and identity propagation.
```

Avoid or be careful with mTLS when:

```text
[ ] Caller is general browser user.
[ ] Certificate provisioning is not feasible.
[ ] You cannot control client private key storage.
[ ] Gateway/header propagation is insecure.
[ ] You have no rotation or expiry monitoring.
[ ] Truststore would need to trust too broad a CA.
[ ] Application cannot map certificate to stable principal.
```

---

## 35. Mental Model Summary

mTLS is best understood as:

```text
mTLS = transport-level proof of possession of a private key
       associated with a trusted X.509 certificate.
```

But production authentication requires more:

```text
private key possession
+ certificate chain validation
+ trust anchor governance
+ certificate policy validation
+ identity extraction
+ principal mapping
+ authorization
+ audit
+ lifecycle management
+ failure handling
```

Do not stop at:

```text
TLS handshake succeeded.
```

Ask:

```text
Which principal did this certificate become?
Why is that mapping valid?
What can this principal do?
How do we rotate/revoke it?
Can we prove it later during audit?
What happens when the CA, cert, gateway, truststore, or clock fails?
```

That is the difference between “mTLS enabled” and “mTLS engineered”.

---

## 36. Common Design Questions

### Q1. Is mTLS enough for service-to-service authentication?

It is enough for workload authentication if certificate identity maps cleanly to service principal and policy is enforced.

It is not enough for end-user delegation unless user identity is also propagated through token/assertion.

---

### Q2. Should mTLS be terminated at gateway or application?

It depends.

Gateway termination is operationally simpler and common for partner APIs.

Application-level mTLS gives stronger end-to-end visibility but increases per-service complexity.

If gateway terminates mTLS, identity propagation must be protected.

---

### Q3. Should we map CN to username?

Usually avoid direct CN-to-user mapping unless legacy constraints force it and CA policy is strict.

Prefer SAN URI/DNS, fingerprint registry, issuer+serial, or explicit certificate registry.

---

### Q4. Does mTLS prevent token theft?

mTLS alone protects the channel and authenticates the client. It does not automatically make bearer token theft harmless.

To mitigate stolen token reuse, use certificate-bound tokens or verify token/client binding.

---

### Q5. Can mTLS replace API keys?

Sometimes, yes, for machine/partner authentication.

But API keys may still be used for application subscription, product plan, or rate-limit account. Keep responsibilities separate.

---

### Q6. What is the biggest operational risk?

Certificate expiry and rotation failure.

The second biggest is trusting the wrong identity because mapping is too broad.

---

## 37. Practical Review Template

When reviewing an mTLS design, ask:

```text
1. What entity does the certificate represent?
2. Who issued the certificate?
3. Why do we trust that issuer?
4. What SAN/subject format is allowed?
5. How is certificate identity mapped to app principal?
6. Is issuer/environment/tenant checked?
7. Is the private key protected?
8. How is rotation performed without downtime?
9. How is revocation handled?
10. Where is TLS terminated?
11. If terminated before app, how is identity propagated safely?
12. Can backend be reached without gateway?
13. Is authorization separate from authentication?
14. Are audit logs sufficient for forensic reconstruction?
15. What happens when certificate expires tonight?
```

---

## 38. Key Takeaways

1. mTLS is a **possession-based authentication mode**.
2. It proves the caller owns a private key corresponding to a trusted certificate.
3. Certificate validity is not the same as application authorization.
4. Java mTLS is built around JSSE, `SSLContext`, `KeyManager`, `TrustManager`, `KeyStore`, and container TLS configuration.
5. Keystore stores local identity/private key; truststore stores what we trust.
6. Principal mapping is where many serious security bugs happen.
7. Gateway/service mesh mTLS shifts the trust boundary; identity propagation must be secured.
8. Certificate lifecycle is a reliability concern, not just security administration.
9. mTLS can be combined with OAuth2 certificate-bound tokens for stronger token theft resistance.
10. Production-grade mTLS requires audit, monitoring, rotation, revocation, and failure modeling.

---

## 39. References

- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.
- Oracle Java Secure Socket Extension Reference Guide.
- OWASP Transport Layer Security Cheat Sheet.
- Spring Security Reference — X.509 Authentication.
- Java `KeyStore`, `SSLContext`, `KeyManagerFactory`, `TrustManagerFactory`, `X509Certificate` APIs.
- NIST guidance on TLS and service-to-service security patterns where applicable.

---

## 40. Series Progress

Completed:

- Part 0 — Orientation: Mental Model of Authentication in Java Systems
- Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
- Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
- Part 3 — Password Authentication Done Properly
- Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
- Part 5 — Servlet Container Authentication
- Part 6 — Jakarta Security and Jakarta Authentication Deep Dive
- Part 7 — Spring Security Authentication Architecture
- Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads
- Part 9 — API Key Authentication
- Part 10 — HMAC Request Signing
- Part 11 — JWT Authentication: Claims, Validation, and Misuse
- Part 12 — Opaque Token Authentication and Token Introspection
- Part 13 — OAuth 2.0 for Java Engineers: Delegated Authorization as Authentication Input
- Part 14 — OpenID Connect: Authentication on Top of OAuth2
- Part 15 — Authorization Code + PKCE for Java Web and SPA Backends
- Part 16 — Client Credentials and Machine-to-Machine Authentication
- Part 17 — SAML 2.0 Authentication in Java Enterprise Systems
- Part 18 — LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication
- Part 19 — Mutual TLS Authentication

Next:

- Part 20 — Passkeys, WebAuthn, FIDO2, and Passwordless Patterns

Status:

```text
Series belum selesai.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-018.md">⬅️ LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-020.md">Part 20 — Passkeys, WebAuthn, FIDO2, and Passwordless Patterns ➡️</a>
</div>
