# Part 20 — mTLS, Client Certificates, and Strong Caller Authentication

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-20-mtls-client-certificates.md`  
> Scope: Java 8 sampai Java 25, Java EE/Jakarta EE, Servlet/JAX-RS/Jakarta Security/Jakarta Authentication, enterprise SSO, service-to-service authentication, gateway/container boundary.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas SAML, enterprise SSO, dan federation legacy. Bagian ini berpindah ke bentuk autentikasi yang lebih dekat ke layer transport: **client certificate authentication** dan **mutual TLS (mTLS)**.

Tujuan bagian ini bukan mengulang teori TLS/PKI dasar secara dangkal, tetapi membangun mental model yang cukup kuat untuk menjawab pertanyaan arsitektural seperti:

- Kapan mTLS cocok dipakai dibanding bearer token?
- Apa bedanya TLS biasa dengan mTLS?
- Bagaimana certificate chain divalidasi?
- Apa hubungan certificate, truststore, keystore, principal, dan role?
- Bagaimana aplikasi Jakarta/Servlet membaca client certificate?
- Kapan validasi certificate harus dilakukan oleh reverse proxy, container, atau application code?
- Bagaimana mTLS bekerja untuk service-to-service authentication?
- Bagaimana mTLS digabung dengan OAuth2/OIDC access token?
- Bagaimana mencegah header spoofing ketika certificate diterminasi di gateway?
- Bagaimana certificate rotation, revocation, expiry, dan audit didesain secara production-grade?

Mental model utama:

```text
TLS biasa:
client memverifikasi server.

mTLS:
client memverifikasi server,
dan server juga memverifikasi client.
```

Dalam security enterprise, mTLS sering dipakai untuk **strong caller authentication**, terutama untuk:

- service-to-service communication,
- partner API integration,
- machine identity,
- gateway-to-backend trust,
- high assurance API,
- regulatory integration,
- OAuth2 client authentication,
- certificate-bound token.

---

## 1. TLS vs mTLS

### 1.1 TLS Biasa

Pada HTTPS umum, server memiliki certificate. Client/browser memverifikasi bahwa server yang dihubungi benar-benar pemilik domain tersebut.

Alurnya secara konseptual:

```text
client -> server: ClientHello
server -> client: ServerHello + server certificate
client: validate server certificate
client/server: derive session keys
client/server: encrypted HTTP traffic
```

Yang diautentikasi secara kuat adalah **server**.

Client biasanya tidak diautentikasi oleh TLS. Client baru diautentikasi lewat layer aplikasi seperti:

- session cookie,
- username/password,
- OAuth2 access token,
- OIDC login,
- API key,
- SAML assertion,
- custom header.

### 1.2 mTLS

Pada mTLS, server juga meminta client mengirim certificate.

Alurnya secara konseptual:

```text
client -> server: ClientHello
server -> client: ServerHello + server certificate + CertificateRequest
client: validate server certificate
client -> server: client certificate + proof of private key possession
server: validate client certificate chain
client/server: derive session keys
client/server: encrypted HTTP traffic
```

Yang diautentikasi:

```text
server authenticated to client
client authenticated to server
```

### 1.3 Hal Penting: Certificate Bukan Hanya File

Certificate publik sendiri tidak cukup. Yang penting adalah pasangan:

```text
private key + public certificate
```

Client membuktikan bahwa ia memiliki private key yang sesuai dengan certificate. Tanpa private key, certificate publik tidak cukup untuk menjadi identity.

### 1.4 Kenapa mTLS Disebut Strong Caller Authentication

mTLS lebih kuat dari bearer token murni dalam konteks tertentu karena caller harus membuktikan **possession of private key**.

Bearer token biasa punya sifat:

```text
whoever possesses token can use token
```

mTLS punya sifat:

```text
caller must possess private key corresponding to trusted certificate
```

Karena itu mTLS dapat mengurangi risiko token replay apabila token juga diikat ke certificate.

---

## 2. Kapan mTLS Cocok Dipakai

mTLS cocok untuk komunikasi yang caller-nya adalah sistem, bukan manusia langsung.

Contoh:

```text
Payment gateway -> merchant backend
Government agency A -> agency B API
API gateway -> internal service
Batch system -> regulatory reporting API
Partner system -> enterprise integration API
Microservice A -> microservice B
```

mTLS kurang cocok sebagai login utama untuk user umum karena:

- certificate provisioning ke user sulit,
- browser UX kompleks,
- certificate rotation sulit,
- lost/stolen device recovery rumit,
- mobile support tidak selalu nyaman,
- user identity biasanya butuh federation/SSO/MFA/claims.

Namun mTLS bisa cocok untuk:

- admin workstation high assurance,
- internal operator system,
- smart card / national identity integration,
- device-bound enterprise authentication,
- machine-to-machine API.

---

## 3. Mental Model PKI: Certificate Chain, CA, Trust Anchor

### 3.1 Certificate Chain

Certificate biasanya tidak dipercaya sendirian. Ia dipercaya karena ditandatangani oleh CA yang dipercaya.

```text
Root CA
  -> Intermediate CA
      -> Client Certificate
```

Server memvalidasi:

1. certificate client belum expired,
2. certificate belum terlalu early (`notBefore`),
3. chain valid sampai trust anchor,
4. signature tiap level valid,
5. certificate usage sesuai,
6. hostname/SAN atau subject mapping sesuai kebutuhan,
7. certificate tidak dicabut jika revocation checking diaktifkan,
8. private key possession terbukti selama TLS handshake.

### 3.2 Root CA

Root CA adalah trust anchor.

Jika server trust root CA tertentu, maka certificate client yang chain-nya mengarah ke root tersebut dapat diterima, tergantung policy.

Masalah besar:

```text
trusting a CA != trusting every certificate for every purpose
```

Anda tetap harus menentukan:

- certificate mana yang mewakili client mana,
- allowed organization,
- allowed environment,
- allowed key usage,
- allowed extended key usage,
- allowed subject/SAN pattern,
- allowed issuer,
- revocation status,
- mapping ke principal aplikasi.

### 3.3 Intermediate CA

Intermediate CA sering dipakai agar root CA tidak dipakai langsung.

Keuntungan:

- rotation lebih mudah,
- revoke intermediate untuk segment tertentu,
- environment separation,
- partner-specific CA,
- policy separation.

### 3.4 Self-Signed Certificate

Self-signed certificate bisa dipakai untuk closed integration, tetapi harus dikelola hati-hati.

Risiko:

- manual trust distribution,
- rotation manual,
- audit sulit,
- scale buruk,
- revocation tidak natural,
- onboarding/offboarding partner rawan error.

Self-signed tidak otomatis buruk, tetapi harus diperlakukan sebagai explicit trust object.

---

## 4. Keystore dan Truststore di Java

### 4.1 Keystore

Keystore menyimpan private key dan certificate milik local party.

Untuk server:

```text
server keystore:
- server private key
- server certificate
- optional certificate chain
```

Untuk client Java yang memanggil service mTLS:

```text
client keystore:
- client private key
- client certificate
- optional certificate chain
```

### 4.2 Truststore

Truststore menyimpan certificate/CA yang dipercaya.

Untuk server yang menerima mTLS:

```text
server truststore:
- CA yang menerbitkan client certificate
```

Untuk client yang memanggil HTTPS:

```text
client truststore:
- CA yang menerbitkan server certificate
```

### 4.3 Salah Kaprah Umum

Salah kaprah 1:

```text
Saya sudah punya certificate, berarti sudah mTLS.
```

Tidak cukup. Anda perlu private key, konfigurasi handshake client-auth, truststore, dan policy mapping.

Salah kaprah 2:

```text
Certificate ada di request attribute, berarti sudah valid.
```

Belum tentu. Jika certificate berasal dari header proxy, aplikasi harus memastikan header itu hanya datang dari trusted proxy dan tidak bisa dipalsukan oleh client.

Salah kaprah 3:

```text
Truststore berisi server certificate.
```

Untuk server yang menerima client certificate, truststore harus berisi CA/trust anchor untuk client certificate, bukan certificate server sendiri.

Salah kaprah 4:

```text
mTLS menggantikan authorization.
```

Tidak. mTLS hanya membuktikan caller identity pada transport. Aplikasi tetap perlu menentukan caller boleh melakukan action apa.

---

## 5. Client Certificate Authentication di Servlet/Jakarta

Servlet security sejak lama mengenal authentication method `CLIENT-CERT`.

Konsepnya:

```xml
<login-config>
    <auth-method>CLIENT-CERT</auth-method>
</login-config>
```

Dalam model ini:

1. container/server dikonfigurasi untuk meminta client certificate,
2. TLS handshake memvalidasi certificate,
3. container membangun caller principal dari certificate,
4. aplikasi bisa memakai Servlet security API seperti `getUserPrincipal()` dan `isUserInRole()`.

### 5.1 Akses Certificate dari Servlet Request

Dalam Servlet API, untuk request HTTPS, certificate client dapat tersedia lewat request attribute:

```java
X509Certificate[] certs = (X509Certificate[])
    request.getAttribute("jakarta.servlet.request.X509Certificate");
```

Untuk legacy Java EE/Servlet `javax`, attribute historisnya:

```java
X509Certificate[] certs = (X509Certificate[])
    request.getAttribute("javax.servlet.request.X509Certificate");
```

Pada Jakarta namespace, gunakan `jakarta.servlet.request.X509Certificate`.

### 5.2 Attribute Certificate Bukan Authorization Final

Membaca certificate dari request hanya memberi bahan identitas.

Aplikasi masih harus memutuskan:

```text
certificate subject/SAN/fingerprint -> caller identity -> role/group -> permission
```

Contoh mapping yang lebih aman:

```text
certificate fingerprint/SKI/serial+issuer
    -> registered_client_id
    -> service account
    -> allowed audience/API
    -> allowed actions
```

Jangan langsung:

```text
CN=Admin -> ROLE_ADMIN
```

Itu rapuh dan berbahaya.

---

## 6. CLIENT-CERT dengan `web.xml`

Contoh konseptual:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.0">

    <security-constraint>
        <web-resource-collection>
            <web-resource-name>Partner API</web-resource-name>
            <url-pattern>/partner/*</url-pattern>
            <http-method>GET</http-method>
            <http-method>POST</http-method>
        </web-resource-collection>
        <auth-constraint>
            <role-name>PARTNER_SYSTEM</role-name>
        </auth-constraint>
        <user-data-constraint>
            <transport-guarantee>CONFIDENTIAL</transport-guarantee>
        </user-data-constraint>
    </security-constraint>

    <login-config>
        <auth-method>CLIENT-CERT</auth-method>
    </login-config>

    <security-role>
        <role-name>PARTNER_SYSTEM</role-name>
    </security-role>

</web-app>
```

Tetapi perlu diingat:

- `web.xml` hanya mendeklarasikan requirement aplikasi,
- TLS connector/container tetap harus dikonfigurasi agar meminta client certificate,
- truststore harus benar,
- role mapping certificate ke `PARTNER_SYSTEM` biasanya vendor/container-specific.

---

## 7. CLIENT-CERT dengan `@ServletSecurity`

`@ServletSecurity` dapat melindungi servlet tertentu, tetapi authentication method seperti `CLIENT-CERT` umumnya tetap dideklarasikan di deployment descriptor atau container configuration.

Contoh:

```java
@ServletSecurity(
    value = @HttpConstraint(
        rolesAllowed = {"PARTNER_SYSTEM"},
        transportGuarantee = ServletSecurity.TransportGuarantee.CONFIDENTIAL
    )
)
public class PartnerCallbackServlet extends HttpServlet {
    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        Principal principal = request.getUserPrincipal();
        response.setStatus(HttpServletResponse.SC_NO_CONTENT);
    }
}
```

Annotation ini membantu enforcement URL/servlet access, tetapi bukan pengganti connector/container mTLS configuration.

---

## 8. Principal Mapping dari Certificate

### 8.1 Sumber Identitas di Certificate

Certificate berisi banyak field, antara lain:

- Subject Distinguished Name,
- Issuer Distinguished Name,
- Serial Number,
- Subject Alternative Name,
- Key Usage,
- Extended Key Usage,
- Validity period,
- Public key,
- Signature algorithm,
- extensions.

Field yang sering dipakai untuk mapping:

```text
Subject DN:
CN=partner-a, OU=Integration, O=Example Corp, C=ID

SAN:
DNS:partner-a.example.com
URI:spiffe://example/prod/payment-service
email:service@example.com

Issuer + Serial:
issuer=Example Partner CA, serial=12345

Fingerprint:
SHA-256 fingerprint of certificate
```

### 8.2 Subject DN Mapping

Contoh:

```text
CN=payment-service-prod, OU=Backend, O=Company, C=ID
```

Kelebihan:

- readable,
- mudah dilihat oleh manusia,
- sering tersedia.

Kelemahan:

- format bisa berubah,
- CN tidak selalu unik,
- parsing DN raw string rawan error,
- subject dapat sama pada certificate baru,
- tidak selalu cocok untuk machine identity modern.

### 8.3 SAN Mapping

Subject Alternative Name sering lebih cocok.

Contoh:

```text
URI:spiffe://company.local/ns/payment/sa/payment-api
DNS:payment-api.prod.internal
```

Kelebihan:

- lebih eksplisit,
- bisa mengikuti naming system identity,
- cocok untuk service mesh/SPIFFE-like identity,
- lebih baik daripada bergantung ke CN.

### 8.4 Fingerprint Mapping

Fingerprint adalah hash dari certificate.

Kelebihan:

- sangat spesifik ke certificate tertentu,
- baik untuk pinning partner.

Kelemahan:

- rotation berarti fingerprint berubah,
- operational overhead tinggi,
- emergency replacement perlu update registry.

### 8.5 Issuer + Serial Mapping

Kombinasi issuer dan serial sering dipakai karena certificate serial unik dalam cakupan issuer.

Kelebihan:

- lebih stable secara PKI,
- dapat mendukung audit.

Kelemahan:

- tetap berubah saat certificate diganti,
- perlu registry.

### 8.6 Recommended Mapping Strategy

Untuk enterprise app, gunakan registry internal:

```text
certificate_identity_key
    issuer_dn
    serial_number
    sha256_fingerprint
    subject_dn
    san_uri
    status
    owner_organization_id
    service_account_id
    environment
    valid_from
    valid_to
    allowed_api_clients
    created_at
    revoked_at
```

Lalu mapping ke application actor:

```text
mTLS certificate -> registered machine identity -> service account -> permissions
```

Bukan langsung:

```text
mTLS certificate -> admin role
```

---

## 9. mTLS Tidak Sama dengan Authorization

mTLS menjawab:

```text
Who is calling at transport layer?
```

Authorization menjawab:

```text
What is this caller allowed to do on this resource under this context?
```

Contoh:

```text
Certificate: partner-a-prod
Endpoint: POST /cases/{id}/documents
Resource: case 123
Tenant: agency-7
Action: upload document
State: under-review
```

Authorization decision bisa tetap deny meskipun certificate valid:

```text
valid certificate? yes
registered partner? yes
allowed endpoint? yes
allowed tenant? no
=> deny 403
```

---

## 10. Layering mTLS dengan OAuth2

mTLS sering digabung dengan OAuth2.

Ada dua pola besar:

### 10.1 mTLS untuk Client Authentication ke Authorization Server

Client menggunakan certificate untuk membuktikan identity saat meminta token.

```text
client --mTLS--> authorization server
client obtains access token
client --Bearer token--> resource server
```

Ini memperkuat token issuance.

### 10.2 Certificate-Bound Access Token

Access token diikat ke certificate.

```text
client --mTLS--> authorization server
AS issues token with certificate confirmation
client --mTLS + token--> resource server
resource server validates:
  - token valid
  - certificate used in TLS matches token binding
```

Ini mengurangi risiko token replay karena token tidak bisa dipakai tanpa private key certificate yang sama.

### 10.3 Why This Matters

Bearer token biasa:

```text
stolen token -> usable elsewhere until expiry/revocation
```

Certificate-bound token:

```text
stolen token without private key -> not usable
```

Namun operational complexity meningkat:

- resource server perlu akses ke client certificate,
- gateway harus meneruskan binding secara aman,
- token claim harus dicek,
- TLS termination architecture harus jelas,
- certificate rotation harus disinkronkan dengan token lifetime.

---

## 11. mTLS di Reverse Proxy / API Gateway

Banyak arsitektur production tidak membuat Java container menerima TLS langsung.

Contoh:

```text
client
  -> ALB / Nginx / Envoy / API Gateway / Traefik
      -> Jakarta application over HTTP or internal TLS
```

Jika mTLS diterminasi di gateway, aplikasi tidak melihat TLS handshake langsung.

Gateway mungkin meneruskan identity lewat header:

```http
X-Client-Cert: ...
X-Client-Cert-Subject: ...
X-Client-Cert-Issuer: ...
X-Client-Cert-Fingerprint: ...
X-Authenticated-Client: partner-a
```

Ini bisa valid hanya jika:

1. aplikasi hanya menerima traffic dari gateway trusted,
2. semua direct path ke aplikasi ditutup,
3. gateway menghapus incoming spoofed identity headers dari client,
4. gateway membuat header identity baru setelah validasi mTLS,
5. aplikasi memverifikasi source/gateway trust,
6. internal hop dilindungi network policy/mTLS/private link,
7. header format canonical dan signed jika perlu.

### 11.1 Header Spoofing Risk

Masalah umum:

```text
client sends X-Authenticated-Client: admin
proxy forwards header unchanged
application trusts header
=> authentication bypass
```

Solusi:

```text
At gateway:
- strip all incoming identity headers
- validate client certificate
- create new identity headers
- optionally sign identity headers

At application:
- accept identity headers only from trusted gateway path
- reject if direct external access
- do not trust arbitrary X-* headers
```

### 11.2 Better Pattern: Internal Signed Assertion

Daripada hanya header plain text, gateway dapat menerbitkan internal assertion:

```text
gateway validates mTLS
  -> creates signed JWT/internal assertion
  -> application validates signature, issuer, audience, expiry
```

Ini mengurangi risiko header tampering di internal network.

Tetapi tetap perlu mencegah direct external access ke backend.

---

## 12. Where Should mTLS Be Enforced?

### 12.1 At Java Container

```text
client -> app server TLS connector -> Jakarta app
```

Kelebihan:

- aplikasi/container melihat certificate langsung,
- Servlet `CLIENT-CERT` bisa dipakai,
- request attribute tersedia langsung,
- trust boundary sederhana.

Kekurangan:

- app server harus expose TLS,
- scaling/operations certificate lebih kompleks,
- TLS config tersebar di banyak service,
- integration dengan cloud LB lebih sulit.

### 12.2 At Gateway / Reverse Proxy

```text
client -> gateway mTLS -> app
```

Kelebihan:

- centralized TLS policy,
- easier certificate enforcement,
- observability terpusat,
- app lebih sederhana,
- cocok untuk Kubernetes ingress/service mesh.

Kekurangan:

- aplikasi tidak melihat handshake langsung,
- identity propagation harus aman,
- header spoofing risk,
- gateway-to-app trust harus kuat,
- authorization context bisa terpotong jika gateway terlalu dominan.

### 12.3 At Service Mesh

```text
service A sidecar <-> service B sidecar with mTLS
```

Kelebihan:

- transparent service-to-service mTLS,
- rotation otomatis,
- identity berbasis workload,
- policy antar service.

Kekurangan:

- aplikasi mungkin tidak tahu caller user-level,
- debugging lebih sulit,
- mesh policy dan app policy bisa drift,
- mTLS mesh bukan pengganti domain authorization.

### 12.4 Decision Matrix

| Enforcement Location | Cocok Untuk | Risiko Utama |
|---|---|---|
| Java container | Monolith/container-managed auth, simple direct deployment | TLS ops tersebar |
| API gateway | Partner API, centralized ingress policy | header spoofing/trust boundary |
| Service mesh | internal service-to-service | app tidak sadar caller context |
| Authorization server | OAuth2 client authentication | resource server tetap perlu token validation |
| Combination | high assurance system | complexity/operational drift |

---

## 13. Java Client untuk mTLS

Dalam Java, client mTLS membutuhkan SSL context yang punya:

- key material: client private key + certificate,
- trust material: CA untuk server certificate.

### 13.1 Java 11+ HttpClient Conceptual Example

```java
KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("client.p12"))) {
    keyStore.load(in, keyStorePassword.toCharArray());
}

KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
kmf.init(keyStore, keyPassword.toCharArray());

KeyStore trustStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("truststore.p12"))) {
    trustStore.load(in, trustStorePassword.toCharArray());
}

TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
tmf.init(trustStore);

SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);

HttpClient client = HttpClient.newBuilder()
        .sslContext(sslContext)
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://partner-api.example.com/secure"))
        .GET()
        .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

Important production notes:

- jangan hardcode password,
- gunakan secret manager,
- rotasi keystore,
- pertimbangkan reload tanpa restart,
- observability untuk handshake failure,
- jangan disable certificate validation.

### 13.2 Anti-Pattern: Trust All Certificates

Kode seperti ini sangat berbahaya:

```java
TrustManager[] trustAll = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

Ini mematikan inti TLS verification.

Jika pernah dipakai untuk debugging lokal, pastikan tidak pernah masuk production branch, image, atau shared library.

---

## 14. Server-Side Certificate Inspection di Jakarta Servlet

Contoh filter untuk membaca certificate:

```java
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.security.cert.X509Certificate;

public class ClientCertificateInspectionFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        X509Certificate[] certs = (X509Certificate[])
                request.getAttribute("jakarta.servlet.request.X509Certificate");

        if (certs == null || certs.length == 0) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Client certificate required");
            return;
        }

        X509Certificate leaf = certs[0];

        // Do not implement full trust validation manually here if the container already did it.
        // This is for application-level mapping/enrichment.
        String subject = leaf.getSubjectX500Principal().getName();
        String issuer = leaf.getIssuerX500Principal().getName();

        request.setAttribute("app.clientCertificate.subject", subject);
        request.setAttribute("app.clientCertificate.issuer", issuer);

        chain.doFilter(request, response);
    }
}
```

Important:

```text
Certificate inspection is not the same as certificate validation.
```

Ideally TLS/container/gateway performs cryptographic validation. Application performs mapping, audit, and authorization.

---

## 15. Custom Principal from Client Certificate

Jika aplikasi ingin membangun actor model:

```java
public final class CertificateCaller {
    private final String clientId;
    private final String subjectDn;
    private final String issuerDn;
    private final String fingerprintSha256;
    private final String organizationId;
    private final String environment;

    public CertificateCaller(
            String clientId,
            String subjectDn,
            String issuerDn,
            String fingerprintSha256,
            String organizationId,
            String environment) {
        this.clientId = clientId;
        this.subjectDn = subjectDn;
        this.issuerDn = issuerDn;
        this.fingerprintSha256 = fingerprintSha256;
        this.organizationId = organizationId;
        this.environment = environment;
    }

    public String clientId() { return clientId; }
    public String subjectDn() { return subjectDn; }
    public String issuerDn() { return issuerDn; }
    public String fingerprintSha256() { return fingerprintSha256; }
    public String organizationId() { return organizationId; }
    public String environment() { return environment; }
}
```

Lalu mapping ke service account:

```java
public interface CertificateIdentityRegistry {
    Optional<ServiceAccountIdentity> findActiveIdentity(CertificateFingerprint fingerprint);
}
```

Authorization tidak memakai raw certificate, tetapi service account identity:

```java
public final class ServiceAccountIdentity {
    private final String serviceAccountId;
    private final String tenantId;
    private final Set<String> permissions;
    private final boolean active;

    // constructor/getters omitted
}
```

---

## 16. mTLS dan Jakarta Authentication / JASPIC

Jika Anda perlu membuat authentication module low-level untuk certificate atau gateway identity, Jakarta Authentication dapat dipakai.

Konseptual:

```text
ServerAuthModule.validateRequest()
  -> inspect TLS certificate or trusted gateway assertion
  -> validate/match registry
  -> create Principal
  -> set groups via callback
  -> return SUCCESS
```

Callback yang relevan:

```text
CallerPrincipalCallback
GroupPrincipalCallback
```

Kapan perlu JASPIC/custom module?

- container `CLIENT-CERT` mapping tidak cukup,
- ingin mapping custom certificate ke group aplikasi,
- ingin trust gateway assertion sebagai caller identity,
- ingin authentication result masuk ke container sehingga `@RolesAllowed` bekerja,
- ingin portable-ish hook di container security pipeline.

Kapan tidak perlu?

- cukup membaca certificate di application filter,
- authorization semua dilakukan programmatic,
- gateway sudah menerbitkan JWT internal,
- framework lain seperti Spring Security mengambil alih security pipeline.

---

## 17. mTLS dan JAX-RS

Pada JAX-RS, Anda bisa membuat `ContainerRequestFilter` untuk enrichment atau application-level rejection.

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.Response;

import java.io.IOException;
import java.security.cert.X509Certificate;

@Provider
@Priority(Priorities.AUTHENTICATION)
public class ClientCertificateJaxRsFilter implements ContainerRequestFilter {

    @Context
    HttpServletRequest servletRequest;

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        X509Certificate[] certs = (X509Certificate[])
                servletRequest.getAttribute("jakarta.servlet.request.X509Certificate");

        if (certs == null || certs.length == 0) {
            requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
            return;
        }

        // Map certificate to app identity, then attach to request context if needed.
    }
}
```

Caution:

- JAX-RS filter is not necessarily integrated into container-managed role checks.
- `@RolesAllowed` may not see your custom identity unless you integrate with container security.
- For true container identity establishment, use Servlet container auth/Jakarta Security/Jakarta Authentication, depending on container support.

---

## 18. Certificate Revocation

A certificate can be valid by date and chain, but revoked by issuer.

Revocation mechanisms:

```text
CRL  = Certificate Revocation List
OCSP = Online Certificate Status Protocol
```

### 18.1 CRL

CRL is a list of revoked certificates.

Pros:

- simple concept,
- can be cached,
- does not require per-request online call.

Cons:

- freshness issue,
- large list,
- distribution problem,
- outage if CRL unavailable depending on fail-open/fail-closed.

### 18.2 OCSP

OCSP queries status of a certificate.

Pros:

- more targeted,
- fresher status.

Cons:

- availability dependency,
- latency,
- privacy concern,
- fail-open/fail-closed trade-off.

### 18.3 Revocation Decision

You must define policy:

```text
If revocation status cannot be checked, do we fail open or fail closed?
```

For high assurance APIs, fail closed may be required. For availability-sensitive internal traffic, fail closed can cause outage.

Better strategy:

- cache revocation status,
- monitor freshness,
- alert before expiry,
- allow emergency override with audit,
- use short-lived certificates where possible.

---

## 19. Certificate Rotation

Certificate rotation is one of the most common mTLS operational failure sources.

### 19.1 Bad Rotation Model

```text
old cert expires at midnight
new cert installed at client only
server trust registry still expects old fingerprint
production outage
```

### 19.2 Safer Rotation Model

Use overlap window:

```text
T-30d: issue new certificate
T-21d: register new certificate as pending
T-14d: allow old and new certificate
T-7d : client switches to new certificate
T+0  : old certificate expires
T+7  : remove old certificate from registry
```

### 19.3 Registry State Machine

```text
PENDING -> ACTIVE -> RETIRING -> RETIRED
             |           |
             v           v
          REVOKED     REVOKED
```

Example fields:

```text
certificate_id
client_id
fingerprint_sha256
issuer_dn
serial_number
status
valid_from
valid_to
accepted_from
accepted_until
created_by
approved_by
revoked_by
revocation_reason
```

### 19.4 Zero-Downtime Rotation Invariant

```text
At any time during rotation, at least one valid, trusted, registered certificate must work for the client.
```

---

## 20. Environment Separation

Never reuse the same client certificate across environments unless you have a very strong reason.

Bad:

```text
same certificate for DEV, UAT, PROD
```

Better:

```text
partner-a-dev
partner-a-uat
partner-a-prod
```

Why:

- accidental PROD access from lower environment,
- leaked DEV cert usable in PROD,
- audit ambiguity,
- weak incident containment.

Certificate identity should encode or be mapped to environment:

```text
SAN URI: spiffe://company/prod/payment-service
Registry: environment=PROD
Issuer: Production Partner CA
```

---

## 21. Service-to-Service mTLS

In microservice systems, mTLS can authenticate workloads.

Example:

```text
case-service -> document-service
```

mTLS identity might be:

```text
spiffe://platform/prod/ns/aceas/sa/case-service
```

Authorization rule:

```text
case-service may call document-service POST /documents
case-service may not call user-admin-service DELETE /users
```

### 21.1 Workload Identity vs User Identity

Service-to-service call often has two identities:

```text
workload identity: case-service
user identity: fajar@example.com
```

mTLS authenticates workload identity. It does not automatically authenticate the end user.

For user-initiated downstream calls, propagate user context separately:

```text
incoming user token/session
  -> service authenticates user
  -> service calls downstream using mTLS as workload
  -> optionally passes user assertion / token exchange result
```

### 21.2 Avoid Confused Deputy

Bad:

```text
case-service has broad mTLS access to document-service
user asks case-service to fetch document from another tenant
document-service trusts only case-service and skips tenant check
=> confused deputy
```

Better:

```text
document-service checks:
- caller workload allowed? yes
- user/on-behalf-of allowed? yes
- tenant/resource allowed? yes
```

---

## 22. mTLS in Kubernetes / Cloud Environments

Common topologies:

### 22.1 Ingress mTLS

```text
external partner -> ingress/gateway mTLS -> service
```

Use for partner APIs.

Important controls:

- strip spoofable headers,
- restrict backend exposure,
- configure CA bundle,
- log certificate identity,
- define rotation procedure.

### 22.2 Service Mesh mTLS

```text
service A sidecar -> service B sidecar
```

Use for internal workload authentication and encryption.

Important controls:

- verify peer identity policy,
- do not assume mesh mTLS equals application authorization,
- map workload identity to service permission,
- monitor cert rotation and sidecar health.

### 22.3 Cloud Load Balancer mTLS

Some cloud load balancers support client certificate verification.

Watch out:

- whether full chain is forwarded,
- header format,
- URL encoding of PEM,
- maximum header size,
- truststore/CA bundle limits,
- revocation support,
- backend direct access.

---

## 23. Logging and Audit

Authentication events for mTLS should include:

```text
event_type=MTLS_AUTH_SUCCESS/FAILURE
request_id
correlation_id
client_ip
tls_protocol
tls_cipher
certificate_subject
certificate_issuer
certificate_serial
certificate_fingerprint_sha256
mapped_client_id
mapped_service_account_id
tenant_id
authentication_result
failure_reason
```

Do not log private keys. Do not log full PEM unless explicitly required and protected.

For authorization event:

```text
actor_type=SERVICE_ACCOUNT
actor_id=partner-a-prod
authn_method=MTLS
action=SUBMIT_CASE_UPDATE
resource_type=CASE
resource_id=CASE-123
tenant_id=agency-7
decision=DENY
reason=TENANT_MISMATCH
```

Audit invariant:

```text
For every privileged machine-to-machine action, we can reconstruct which certificate-backed identity performed it and why it was allowed or denied.
```

---

## 24. Failure Model

### 24.1 Expired Certificate

Symptoms:

- TLS handshake failure,
- HTTP request never reaches app,
- gateway 400/495/496-like error depending platform,
- client sees SSLHandshakeException.

Mitigation:

- expiry monitoring,
- certificate inventory,
- alerts at 30/14/7/1 days,
- overlap rotation,
- runbook.

### 24.2 Wrong Truststore

Symptoms:

- client cert rejected,
- unable to build certification path,
- unknown CA,
- only some clients fail.

Mitigation:

- environment-specific CA bundle,
- truststore deployment verification,
- canary handshake test.

### 24.3 Missing Intermediate Certificate

Symptoms:

- works on some machines but fails on others,
- chain building inconsistent,
- handshake failure.

Mitigation:

- include full chain,
- test with clean truststore,
- document chain requirements.

### 24.4 Header Spoofing

Symptoms:

- attacker accesses as another client,
- application logs show valid identity header but no TLS proof,
- direct backend path exposed.

Mitigation:

- strip identity headers at edge,
- only gateway can call backend,
- signed internal assertion,
- network policy,
- reject identity headers on untrusted path.

### 24.5 Role Mapping Drift

Symptoms:

- certificate valid but app denies,
- or certificate maps to old role after org change.

Mitigation:

- registry-driven mapping,
- approval workflow for mapping changes,
- automated tests for permission matrix,
- audit mapping version.

### 24.6 Revocation Check Outage

Symptoms:

- random auth failures,
- high latency,
- gateway cannot contact OCSP/CRL endpoint.

Mitigation:

- cache,
- clear fail-open/fail-closed policy,
- short-lived certs,
- monitoring.

### 24.7 Certificate Reused Across Tenants

Symptoms:

- one certificate can access multiple tenant contexts unintentionally.

Mitigation:

- tenant-bound certificate identity,
- tenant claim/registry mapping,
- per-tenant authorization check.

---

## 25. Testing Strategy

### 25.1 Unit Tests

Test parsing/mapping:

- subject DN parser,
- SAN parser,
- fingerprint generation,
- registry lookup,
- status state machine,
- permission mapping.

### 25.2 Integration Tests

Test actual TLS handshake:

- valid client certificate accepted,
- missing client certificate rejected,
- expired certificate rejected,
- wrong CA rejected,
- revoked certificate rejected if supported,
- certificate from DEV cannot access PROD,
- old and new certificate work during rotation overlap.

### 25.3 Authorization Tests

Even with valid certificate:

- wrong tenant => 403,
- wrong action => 403,
- inactive service account => 403/401 depending model,
- retired certificate => 401,
- unknown fingerprint => 401.

### 25.4 Gateway Tests

- incoming spoofed identity header is stripped,
- backend rejects direct call,
- gateway forwards canonical identity,
- malformed certificate header rejected,
- signed assertion expiry enforced.

### 25.5 Operational Tests

- certificate expiry alert fires,
- truststore reload works,
- rotation runbook tested,
- emergency revoke tested,
- CRL/OCSP outage behavior known.

---

## 26. Java 8 sampai Java 25 Considerations

### 26.1 Java 8

- Banyak legacy enterprise app masih memakai Java 8.
- TLS defaults dan supported algorithms bisa berbeda dari modern JDK.
- Beberapa cipher/protocol lama masih mungkin aktif jika tidak dikunci.
- HTTP client native modern belum ada seperti Java 11 `HttpClient`.

### 26.2 Java 11+

- `java.net.http.HttpClient` tersedia.
- TLS stack lebih modern.
- Better baseline untuk modern HTTPS client.

### 26.3 Java 17 dan 21 LTS

- Umum untuk Jakarta EE modern.
- Java 21 memperkenalkan virtual threads, tetapi TLS handshake tetap berada di I/O/security layer.
- Hati-hati dengan context propagation jika mTLS identity dipetakan ke request context lalu dipakai async.

### 26.4 Java 25

- Perlakukan sebagai runtime modern dengan defaults yang terus berkembang.
- Jangan mengandalkan default TLS/cipher tanpa explicit security baseline.
- Pastikan container/app server mendukung runtime Java 25 sebelum production.

### 26.5 Cross-Version Rule

Security invariant harus eksplisit:

```text
Allowed TLS versions
Allowed cipher suites
Allowed CA bundle
Client auth mode
Certificate mapping rules
Revocation policy
Rotation policy
```

Jangan menyerahkan semuanya ke default runtime.

---

## 27. Design Checklist

Sebelum menggunakan mTLS, jawab pertanyaan berikut.

### 27.1 Identity

- Siapa caller-nya?
- Human user, service, partner, device, gateway, atau workload?
- Certificate mewakili apa?
- Apakah satu certificate boleh mewakili banyak service?
- Apakah identity environment-specific?

### 27.2 Trust

- CA mana yang dipercaya?
- Apakah trust anchor sama untuk semua partner?
- Bagaimana onboarding partner baru?
- Bagaimana offboarding partner?
- Bagaimana certificate dicabut?

### 27.3 Mapping

- Field certificate apa yang dipakai untuk mapping?
- Apakah mapping memakai registry?
- Apakah fingerprint, issuer+serial, SAN URI, atau subject DN?
- Bagaimana rotation tanpa outage?
- Bagaimana mapping version diaudit?

### 27.4 Enforcement

- mTLS terminates di mana?
- Gateway, container, service mesh, atau authorization server?
- Apakah backend bisa diakses bypass gateway?
- Apakah identity header bisa dipalsukan?
- Apakah app memvalidasi internal assertion?

### 27.5 Authorization

- Setelah caller authenticated, apa permission-nya?
- Apakah permission tenant-scoped?
- Apakah endpoint-level saja cukup?
- Apakah perlu object/resource-level authorization?
- Bagaimana deny reason dan audit?

### 27.6 Operations

- Siapa pemilik certificate?
- Kapan expiry?
- Bagaimana alert?
- Bagaimana rotation?
- Bagaimana emergency revoke?
- Apakah runbook sudah diuji?

---

## 28. Reference Architecture: Partner API dengan mTLS + Jakarta Backend

```text
Partner System
  owns client certificate + private key
        |
        | HTTPS with mTLS
        v
API Gateway / Ingress
  - validates client certificate chain
  - checks trusted CA
  - optionally checks revocation
  - strips inbound identity headers
  - maps cert fingerprint to partner client id or forwards canonical cert info
        |
        | internal TLS / private network
        v
Jakarta Application
  - accepts only gateway traffic
  - validates gateway assertion/header contract
  - maps partner client id to service account
  - checks tenant/resource/action permission
  - writes audit event
        |
        v
Domain Service / Database
```

Security invariants:

```text
1. No direct external traffic reaches Jakarta backend.
2. Gateway strips spoofable identity headers.
3. Certificate identity maps through registry, not raw CN checks.
4. Valid certificate does not imply all permissions.
5. Authorization checks include tenant/resource/action/state.
6. Certificate rotation has overlap window.
7. Every machine action is auditable by certificate fingerprint and mapped service account.
```

---

## 29. Reference Architecture: Service-to-Service mTLS + User Context

```text
Browser User
  -> Web/API Service
       authenticates user via OIDC/session
       authorizes user action
       calls downstream with:
          - mTLS workload identity
          - user context/token/assertion
          - correlation id
            |
            v
     Downstream Service
       validates caller workload identity
       validates user/on-behalf-of context
       authorizes resource access
       audits both identities
```

Actor model:

```text
transport_actor = service-a
business_actor  = user-123
on_behalf_of    = user-123
resource        = case-456
tenant          = agency-7
```

This avoids collapsing service identity and user identity into one ambiguous principal.

---

## 30. Common Anti-Patterns

### Anti-Pattern 1 — CN-Based Admin

```text
if certificate CN == "admin" then allow all
```

Better:

```text
certificate -> registry -> service account -> permission matrix
```

### Anti-Pattern 2 — Gateway Header Trusted Everywhere

```text
X-Client-Id is trusted from any request
```

Better:

```text
trust identity header only from gateway-controlled network/path
strip incoming identity headers
use signed internal assertion if needed
```

### Anti-Pattern 3 — mTLS as Sole Authorization

```text
valid certificate => all API access
```

Better:

```text
valid certificate => authenticated client
permission check still required
```

### Anti-Pattern 4 — No Rotation Plan

```text
certificate expires next week, nobody owns it
```

Better:

```text
inventory + owner + alerts + overlap + tested runbook
```

### Anti-Pattern 5 — Reusing Certificate Across Environments

```text
same cert for DEV/UAT/PROD
```

Better:

```text
separate cert per environment and purpose
```

### Anti-Pattern 6 — Disabling TLS Validation in Java Client

```text
trust all certificates
hostname verifier always true
```

Better:

```text
explicit truststore, proper hostname verification, environment-specific CA
```

---

## 31. Minimal Mental Model to Keep

mTLS is not just “HTTPS with certificate”. It is a caller authentication model based on proof of private key possession.

The complete chain is:

```text
TLS handshake
  -> client proves possession of private key
  -> server validates certificate chain
  -> server maps certificate to machine identity
  -> application maps machine identity to actor/service account
  -> authorization checks action/resource/tenant/state
  -> audit records certificate-backed actor
```

The strongest systems do not stop at certificate validation. They design the full lifecycle:

```text
issue -> register -> activate -> use -> audit -> rotate -> retire/revoke
```

---

## 32. Part 20 Summary

Pada bagian ini, kita membahas:

- TLS vs mTLS,
- certificate chain,
- CA/trust anchor,
- keystore vs truststore,
- Servlet `CLIENT-CERT`,
- request attribute `jakarta.servlet.request.X509Certificate`,
- principal mapping dari certificate,
- registry-based machine identity,
- mTLS + OAuth2,
- certificate-bound token,
- gateway/reverse proxy termination,
- header spoofing,
- Java client mTLS,
- JAX-RS/Servlet integration,
- revocation,
- rotation,
- environment separation,
- service-to-service authentication,
- Kubernetes/cloud topology,
- audit,
- failure modelling,
- testing,
- Java 8–25 considerations,
- production design checklist.

Kunci utamanya:

```text
mTLS authenticates the caller at the transport layer.
It does not replace application authorization.
```

Dan dalam sistem enterprise:

```text
certificate identity must be mapped, governed, rotated, revoked, authorized, and audited.
```

---

## 33. Apa Berikutnya

Part berikutnya:

```text
Part 21 — Method Security with CDI, EJB, Interceptors, and Proxies
```

Bagian berikutnya akan membahas bagaimana authorization ditegakkan di method/service layer menggunakan CDI/EJB/interceptor/proxy, termasuk problem self-invocation, annotation resolution, transaction-security ordering, custom domain annotation, dan hidden bypass patterns.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 19 — SAML, Enterprise SSO, and Legacy Federation Integration](./learn-java-jakarta-security-authentication-authorization-identity-part-19-saml-enterprise-sso-legacy-federation.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Jakarta Security Authentication Authorization Identity — Part 21](./learn-java-jakarta-security-authentication-authorization-identity-part-21-method-security-cdi-ejb-interceptors-proxies.md)

</div>