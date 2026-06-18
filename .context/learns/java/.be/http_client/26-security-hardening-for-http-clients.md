# Part 26 — Security Hardening for HTTP Clients

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `26-security-hardening-for-http-clients.md`  
> Scope: Java 8 sampai Java 25, JDK HttpClient, OkHttp, Retrofit, Apache HttpClient, Spring RestClient/WebClient, generated clients, dan production-grade outbound HTTP integration.

---

## 1. Premis Utama

Banyak engineer memperlakukan HTTP client sebagai kode sederhana:

```java
client.get(url);
```

Padahal dari sudut pandang security, outbound HTTP client adalah **jalan keluar dari trust boundary aplikasi**.

Ia bisa:

- mengirim secret ke pihak yang salah,
- mengakses internal metadata service akibat URL user-controlled,
- mengikuti redirect ke host tidak aman,
- membocorkan token di log,
- menerima certificate yang salah,
- mengirim PII ke vendor yang tidak seharusnya,
- menjadi pivot SSRF,
- memperbesar blast radius supply-chain vulnerability,
- membuat audit trail tidak valid,
- dan membuat data exfiltration terlihat seperti traffic normal.

Jadi mental model yang benar bukan:

```text
HTTP client = alat untuk call API
```

Melainkan:

```text
HTTP client = controlled egress boundary + credential handler + policy enforcement point + telemetry source
```

Part ini membahas bagaimana membuat HTTP client **secure by construction**, bukan sekadar “tambahkan header auth dan HTTPS”.

---

## 2. Apa yang Membuat HTTP Client Berbahaya?

HTTP client terlihat aman karena ia berjalan dari server kita ke luar. Tetapi justru karena ia berada di server-side, ia punya akses yang biasanya tidak dimiliki attacker langsung:

```text
application server
├── internal network access
├── service account credential
├── cloud metadata route
├── database-adjacent subnet
├── private DNS visibility
├── mTLS identity
├── firewall egress path
├── proxy trust
└── production logging pipeline
```

Jika attacker bisa memengaruhi URL, host, header, request body, redirect, atau deserialization boundary, maka HTTP client bisa menjadi alat untuk:

```text
SSRF
→ internal port scanning
→ metadata credential theft
→ internal admin endpoint access
→ data exfiltration
→ token leakage
→ lateral movement
```

Inilah alasan HTTP client harus punya security hardening sebagai desain awal.

---

## 3. Security Threat Model untuk HTTP Client

Sebelum membuat client, tanyakan:

```text
Siapa yang menentukan destination?
Apa destination-nya tetap atau dinamis?
Apakah ada input user yang masuk ke URL/header/body?
Credential apa yang dipakai?
Apakah client boleh follow redirect?
Apakah response dipercaya?
Apakah body bisa besar?
Apakah data boleh dilog?
Apakah request punya side effect?
Apakah jaringan melewati proxy/TLS inspection?
Apakah client berjalan di cloud/Kubernetes?
```

Threat model minimal:

| Area | Pertanyaan | Risiko |
|---|---|---|
| Destination | Siapa menentukan host? | SSRF, exfiltration |
| Path/query | Apakah dari user input? | injection, signature bypass, data leakage |
| Header | Apakah header user dipropagate? | header injection, auth leakage |
| Redirect | Apakah automatic redirect aktif? | credential leak ke host lain |
| DNS | Apakah hostname resolve ke IP internal? | DNS rebinding, internal pivot |
| TLS | Apakah certificate diverifikasi benar? | MITM |
| Auth | Apakah token dikirim hanya ke host benar? | bearer leakage |
| Body | Apakah payload dibatasi? | memory DoS, parser attack |
| Logging | Apa yang masuk log? | secret/PII leakage |
| Dependency | Library versi apa? | CVE/supply chain |
| Observability | Apakah redaction benar? | diagnostic data leak |

---

## 4. Prinsip Utama: Destination Must Be a Policy, Not a String

Kode yang buruk:

```java
String url = request.getParameter("url");
String body = http.get(url);
```

Masalahnya bukan hanya `url` dari user. Masalahnya adalah **destination tidak dimodelkan sebagai policy**.

Kode production-grade harus punya konsep:

```text
ExternalServiceId
→ allowed scheme
→ allowed host
→ allowed port
→ allowed path prefix
→ allowed redirect behavior
→ allowed auth credential
→ allowed timeout/retry/rate limit
→ allowed payload size
→ allowed logging policy
```

Contoh model:

```java
public enum ExternalServiceId {
    ONEMAP,
    PAYMENT_GATEWAY,
    IDENTITY_PROVIDER,
    DOCUMENT_SIGNING_VENDOR
}

public record HttpDestinationPolicy(
        ExternalServiceId serviceId,
        URI baseUri,
        Set<String> allowedHosts,
        Set<Integer> allowedPorts,
        boolean allowRedirects,
        boolean allowPrivateIp,
        Duration connectTimeout,
        Duration responseTimeout,
        int maxResponseBytes,
        RedactionPolicy redactionPolicy
) {}
```

Dengan model seperti ini, security tidak tersebar sebagai `if` random di kode. Ia menjadi boundary eksplisit.

---

## 5. SSRF: Risiko Paling Kritis untuk HTTP Client Dinamis

SSRF terjadi ketika server-side aplikasi dapat dipaksa membuat request ke destination yang dipilih attacker.

Contoh fitur yang rawan:

```text
fetch image by URL
import document from URL
webhook tester
URL preview
PDF generator from URL
external callback configuration
federated identity metadata URL
OpenID discovery URL
file upload by remote URL
```

Serangan umum:

```text
https://attacker.com/redirect-to/internal
http://localhost:8080/admin
http://127.0.0.1:8080/admin
http://169.254.169.254/latest/meta-data/
http://[::1]/admin
http://10.0.0.5:8080/internal
http://service.namespace.svc.cluster.local
http://metadata.google.internal
http://0.0.0.0:8080
http://2130706433/
http://0177.0.0.1/
http://example.com@127.0.0.1/
```

Top 1% rule:

> Jangan mencoba “membersihkan URL jahat”. Desain agar hanya URL yang sudah dikenal dan diizinkan yang bisa dipakai.

---

## 6. SSRF Defense Layer

### 6.1 Positive Allowlist

Gunakan allowlist, bukan denylist.

```text
Allowed:
- https://api.partner.example.com
- https://auth.partner.example.com

Not allowed:
- arbitrary host dari request user
- arbitrary scheme
- arbitrary port
- internal IP
- redirect ke host lain
```

Contoh:

```java
public final class DestinationValidator {
    private final Set<String> allowedHosts;

    public DestinationValidator(Set<String> allowedHosts) {
        this.allowedHosts = Set.copyOf(allowedHosts);
    }

    public URI validate(URI uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new SecurityException("Only HTTPS is allowed");
        }

        String host = uri.getHost();
        if (host == null || !allowedHosts.contains(host.toLowerCase(Locale.ROOT))) {
            throw new SecurityException("Host is not allowed");
        }

        int port = uri.getPort();
        if (port != -1 && port != 443) {
            throw new SecurityException("Port is not allowed");
        }

        if (uri.getUserInfo() != null) {
            throw new SecurityException("User info in URL is not allowed");
        }

        if (uri.getFragment() != null) {
            throw new SecurityException("Fragment is not allowed in server-side HTTP request");
        }

        return uri.normalize();
    }
}
```

Catatan penting: validasi host string saja tidak selalu cukup. DNS bisa berubah.

---

### 6.2 Scheme Restriction

Allowed scheme biasanya:

```text
https
```

Hindari:

```text
http
file
ftp
gopher
jar
ldap
dict
```

Walaupun Java HTTP client hanya mendukung HTTP(S), abstraction lain atau library lain bisa membuat asumsi berbeda. Rule tetap harus eksplisit.

---

### 6.3 Port Restriction

Default aman:

```text
443 only
```

Jika ada kebutuhan lain:

```text
8443 untuk private gateway
9443 untuk mTLS endpoint
```

Jangan izinkan arbitrary port karena attacker bisa memakai server sebagai scanner internal.

---

### 6.4 Private IP Blocking

Jika destination user-controlled, blok IP range internal/private/link-local/loopback.

Kategori yang harus dicurigai:

```text
127.0.0.0/8        loopback IPv4
::1/128            loopback IPv6
10.0.0.0/8         private
172.16.0.0/12      private
192.168.0.0/16     private
169.254.0.0/16     link-local / cloud metadata risk
fc00::/7           unique local IPv6
fe80::/10          link-local IPv6
0.0.0.0/8          invalid/current network
224.0.0.0/4        multicast
```

Contoh utility sederhana:

```java
public final class IpClassifier {
    public static boolean isUnsafeForOutbound(InetAddress address) {
        return address.isAnyLocalAddress()
            || address.isLoopbackAddress()
            || address.isLinkLocalAddress()
            || address.isSiteLocalAddress()
            || address.isMulticastAddress();
    }
}
```

Untuk production, gunakan library IP/CIDR yang benar dan test case luas. Jangan hanya pakai regex.

---

### 6.5 DNS Resolution Validation

Host yang terlihat aman bisa resolve ke IP internal.

```text
trusted.example.com → 10.0.0.5
```

Atau attacker bisa memakai DNS rebinding:

```text
validation time: attacker.example.com → 203.0.113.10
request time:    attacker.example.com → 127.0.0.1
```

Hardening:

```text
resolve host during validation
→ validate all returned IPs
→ connect only to validated address or revalidate close to request time
→ avoid separate TOCTOU gap
→ disable automatic redirect or revalidate redirect target
```

Contoh konseptual:

```java
public final class ResolvingDestinationGuard {
    public void validateResolvedAddresses(String host) throws UnknownHostException {
        InetAddress[] addresses = InetAddress.getAllByName(host);
        for (InetAddress address : addresses) {
            if (IpClassifier.isUnsafeForOutbound(address)) {
                throw new SecurityException("Host resolves to unsafe address: " + address.getHostAddress());
            }
        }
    }
}
```

Tetapi ada batasnya: Java high-level clients biasanya tetap melakukan DNS resolution internal saat connect. Untuk threat model serius, gunakan network egress control juga.

---

## 7. Network-Level Egress Control

Application validation saja tidak cukup. Defense-in-depth harus mencakup:

```text
application allowlist
+ DNS policy
+ egress firewall/security group/network policy
+ service mesh egress policy
+ proxy allowlist
+ cloud metadata protection
+ IAM least privilege
```

Di Kubernetes/cloud:

```text
Pod NetworkPolicy
→ egress hanya ke proxy/gateway
→ proxy enforce host allowlist
→ metadata endpoint diblokir dari workload biasa
→ service account minimal
→ mTLS identity scoped
```

Top-tier design:

```text
application tidak bebas ke internet
application hanya boleh ke controlled egress proxy
egress proxy melakukan allowlist, logging, TLS policy, dan rate policy
```

---

## 8. Redirect Hardening

Automatic redirect terlihat nyaman, tetapi berisiko.

Masalah:

```text
request ke https://api.partner.com/resource
→ 302 Location: https://evil.example/collect
→ client follow redirect
→ Authorization header / body / metadata bisa bocor
```

Rule aman:

```text
default: disable automatic redirect untuk request authenticated
manual redirect handling
validate scheme + host + port + path target
never forward Authorization to different origin
limit redirect count
block downgrade https → http
```

### 8.1 JDK HttpClient

```java
HttpClient client = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
```

### 8.2 OkHttp

```java
OkHttpClient client = new OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build();
```

### 8.3 Manual Redirect Policy

```java
public URI validateRedirect(URI original, URI location) {
    if (!"https".equalsIgnoreCase(location.getScheme())) {
        throw new SecurityException("Redirect downgrade is forbidden");
    }
    if (!Objects.equals(original.getHost(), location.getHost())) {
        throw new SecurityException("Cross-host redirect is forbidden");
    }
    return location;
}
```

Important nuance:

```text
same host ≠ always safe
same registrable domain ≠ safe
subdomain takeover bisa terjadi
path-level policy tetap penting
```

---

## 9. URL Construction Hardening

Jangan gabungkan URL dengan string concat.

Buruk:

```java
String url = baseUrl + "/users/" + userInput;
```

Risiko:

```text
path traversal
encoding mismatch
double encoding
query injection
signature mismatch
unexpected host/path confusion
```

Lebih baik:

```java
URI uri = URI.create("https://api.partner.example.com")
        .resolve("/v1/users/" + URLEncoder.encode(userId, StandardCharsets.UTF_8));
```

Tetapi `URLEncoder` sebenarnya untuk form encoding, bukan universal path segment encoding. Di OkHttp, lebih aman memakai `HttpUrl`:

```java
HttpUrl url = new HttpUrl.Builder()
        .scheme("https")
        .host("api.partner.example.com")
        .addPathSegment("v1")
        .addPathSegment("users")
        .addPathSegment(userId)
        .addQueryParameter("include", "profile")
        .build();
```

Prinsip:

```text
encode per component
never encode whole URL as one string
never accept already-encoded input unless explicitly modelled
never let user control scheme/host/port unless use-case truly requires it
```

---

## 10. Header Injection dan Header Propagation

Header adalah trust boundary.

Buruk:

```java
request.header("X-User", userInput);
```

Risiko:

```text
CRLF injection
spoofed identity
trace pollution
downstream authorization confusion
log injection
cache poisoning
```

Rule:

```text
never propagate all inbound headers blindly
use explicit allowlist
strip hop-by-hop headers
strip credentials unless destination exactly intended
validate header values
redact sensitive headers in logs
```

Hop-by-hop headers yang tidak boleh asal dipropagate:

```text
Connection
Keep-Alive
Proxy-Authenticate
Proxy-Authorization
TE
Trailer
Transfer-Encoding
Upgrade
```

Sensitive headers:

```text
Authorization
Cookie
Set-Cookie
X-Api-Key
Proxy-Authorization
X-Auth-Token
X-Forwarded-For
X-Real-IP
```

Propagation policy contoh:

```java
public final class HeaderPropagationPolicy {
    private static final Set<String> ALLOWED = Set.of(
            "x-correlation-id",
            "traceparent",
            "tracestate",
            "x-request-id"
    );

    public Map<String, String> filter(Map<String, String> inbound) {
        Map<String, String> out = new HashMap<>();
        inbound.forEach((name, value) -> {
            String normalized = name.toLowerCase(Locale.ROOT);
            if (ALLOWED.contains(normalized) && isSafeHeaderValue(value)) {
                out.put(name, value);
            }
        });
        return out;
    }

    private boolean isSafeHeaderValue(String value) {
        return value != null && !value.contains("\r") && !value.contains("\n");
    }
}
```

---

## 11. Credential Leakage Prevention

Bearer token, API key, session cookie, HMAC secret, mTLS key — semua adalah high-value assets.

Leak path umum:

```text
URL query parameter
logs
exception message
metrics tag
trace attributes
redirect to another host
proxy logs
browser/client-visible error
debug dump
test fixture committed to git
HTTP logging interceptor BODY mode
```

Rule:

```text
credentials never in query string
credentials never in raw logs
credentials scoped by destination
credentials injected late
credentials redacted centrally
credentials rotated
credentials stored outside code
```

### 11.1 Jangan Token di Query Parameter

Buruk:

```text
GET /data?access_token=abc123
```

Lebih aman:

```text
Authorization: Bearer <token>
```

Query string sering masuk:

```text
access log
reverse proxy log
APM URL tag
browser history jika frontend
error report
analytics
```

---

### 11.2 Destination-Scoped Credential Injection

Jangan inject token secara global ke semua outbound request.

Buruk:

```java
client.addInterceptor(chain -> chain.proceed(
    chain.request().newBuilder()
        .header("Authorization", "Bearer " + token)
        .build()
));
```

Jika client dipakai untuk beberapa host, token bisa bocor.

Lebih baik:

```java
public final class ScopedAuthInterceptor implements Interceptor {
    private final String allowedHost;
    private final TokenProvider tokenProvider;

    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        if (!request.url().host().equalsIgnoreCase(allowedHost)) {
            return chain.proceed(request);
        }

        Request authenticated = request.newBuilder()
                .header("Authorization", "Bearer " + tokenProvider.currentToken())
                .build();

        return chain.proceed(authenticated);
    }
}
```

Untuk top-tier system, biasanya lebih baik satu client instance per external service.

---

## 12. Logging Hardening

HTTP logging sangat berguna saat incident. Tetapi logging juga sumber kebocoran data paling sering.

Jangan log secara default:

```text
Authorization
Cookie
Set-Cookie
API key
request body berisi PII
response body berisi PII
full URL dengan query sensitif
certificate private key path/password
HMAC canonical string jika berisi secret
```

Log yang aman:

```text
service_id
method
scheme
host
normalized_path_template
status_code
latency_ms
error_class
retry_attempt
timeout_phase
correlation_id
trace_id
redacted_request_id
payload_size
```

Hindari tag cardinality tinggi:

```text
full_url
raw_user_id
raw_account_number
raw_email
full_error_body
raw_query
```

### 12.1 Redaction Utility

```java
public final class HttpLogRedactor {
    private static final Set<String> SENSITIVE_HEADERS = Set.of(
            "authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "proxy-authorization"
    );

    public static String headerValue(String name, String value) {
        if (name == null) return "<unknown>";
        if (SENSITIVE_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
            return "<redacted>";
        }
        return sanitize(value);
    }

    public static String sanitize(String value) {
        if (value == null) return null;
        return value.replace("\r", "\\r").replace("\n", "\\n");
    }
}
```

### 12.2 OkHttp Logging Interceptor Warning

OkHttp logging interceptor sangat berguna, tetapi `BODY` level bisa mencetak body request/response. Dalam production, default aman adalah:

```text
NONE atau BASIC
```

Jika harus debug:

```text
aktifkan sementara
scope environment terbatas
redact headers
jangan log body sensitif
```

---

## 13. TLS Hardening

HTTPS bukan otomatis aman jika implementasi TLS salah.

Kesalahan fatal:

```java
TrustManager trustAll = ... // accept all certificates
HostnameVerifier allowAll = (hostname, session) -> true;
```

Ini mengubah TLS menjadi enkripsi tanpa identitas. Attacker dengan posisi MITM bisa menyamar.

Rule:

```text
never disable certificate validation
never disable hostname verification
use default truststore unless clear reason
for private CA, install CA properly
for mTLS, protect private key
plan certificate rotation
monitor expiration
```

---

### 13.1 JDK HttpClient dengan SSLContext

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(keyManagers, trustManagers, secureRandom);

HttpClient client = HttpClient.newBuilder()
        .sslContext(sslContext)
        .build();
```

Gunakan ini untuk custom truststore/mTLS, bukan untuk trust-all.

---

### 13.2 OkHttp Certificate Pinning

Certificate pinning bisa mengurangi risiko CA compromise/MITM, tetapi menambah risiko operasional saat certificate rotation.

```java
CertificatePinner certificatePinner = new CertificatePinner.Builder()
        .add("api.partner.example.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        .build();

OkHttpClient client = new OkHttpClient.Builder()
        .certificatePinner(certificatePinner)
        .build();
```

Rule:

```text
pin hanya jika threat model mendukung
pin public key/SPKI, bukan leaf certificate lifecycle tanpa backup
sediakan backup pin
punya runbook rotation
jangan pin domain yang certificate-nya dikontrol pihak ketiga tanpa koordinasi
```

---

## 14. mTLS Hardening

mTLS memberikan client identity di TLS layer. Tetapi private key menjadi credential sangat sensitif.

Risiko:

```text
private key leak
keystore password leak
wrong cert used for wrong service
expired client cert
certificate CN/SAN mismatch dengan policy downstream
rotation outage
```

Hardening:

```text
separate keystore per external service
least privilege certificate
short-lived cert jika infra mendukung
secure secret storage
rotation automation
expiry alert
no private key in container image
no private key in git
```

Contoh struktur config:

```yaml
externalClients:
  paymentGateway:
    baseUrl: https://api.payment.example.com
    mtls:
      keyStoreSecretName: payment-client-keystore
      trustStoreSecretName: payment-truststore
      certificateAlias: aceas-payment-client
```

---

## 15. Proxy dan TLS Inspection

Corporate proxy sering menjadi bagian dari network path.

Risiko:

```text
Proxy-Authorization leak
proxy logs contain full URL
TLS inspection sees payload
CONNECT tunnel policy mismatch
certificate pinning breaks under inspection
proxy bypass unexpected
```

Rule:

```text
know whether traffic goes through proxy
never send Proxy-Authorization to origin server
redact proxy credential
align certificate pinning with proxy policy
log proxy route as diagnostic dimension
use explicit proxy config for controlled clients
```

JDK:

```java
HttpClient client = HttpClient.newBuilder()
        .proxy(ProxySelector.of(new InetSocketAddress("proxy.example.com", 8080)))
        .build();
```

OkHttp:

```java
OkHttpClient client = new OkHttpClient.Builder()
        .proxy(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("proxy.example.com", 8080)))
        .build();
```

---

## 16. Request Body Security

HTTP client mengirim data keluar. Jadi body harus diperlakukan sebagai data export.

Pertanyaan wajib:

```text
Apakah data ini boleh dikirim ke destination ini?
Apakah field PII perlu masking/tokenization?
Apakah payload mengandung internal ID sensitif?
Apakah ada attachment/file?
Apakah file sudah di-scan?
Apakah content-type benar?
Apakah body size dibatasi?
Apakah retry dapat mengirim body dua kali?
```

Hardening:

```text
explicit DTO for outbound payload
field-level review
no domain object direct serialization
no entire entity dump
max request body size
content-type strict
sensitive field annotation/redaction
idempotency key untuk command
```

Buruk:

```java
http.post("/vendor", customerEntity);
```

Lebih baik:

```java
VendorCustomerRegistrationRequest request = mapper.toVendorRequest(customer);
validator.validate(request);
client.registerCustomer(request);
```

---

## 17. Response Body Security

Response dari external API tidak trusted.

Risiko:

```text
malformed JSON/XML
huge body memory DoS
zip bomb
XML external entity
script/html returned unexpectedly
error body with sensitive echo
schema poisoning
polymorphic deserialization risk
```

Hardening:

```text
validate Content-Type
limit response size
stream large payload
disable dangerous XML features
avoid unsafe polymorphic deserialization
fail closed on unexpected schema
sanitize error body before logging
map to external DTO then domain object
```

Contoh size limit:

```java
public byte[] readLimited(InputStream in, int maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int total = 0;
    int read;
    while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > maxBytes) {
            throw new SecurityException("Response body too large");
        }
        out.write(buffer, 0, read);
    }
    return out.toByteArray();
}
```

---

## 18. XML Hardening

Jika client memproses XML/SOAP, aktifkan secure parser config.

Risiko:

```text
XXE
Billion Laughs
external DTD fetch
SSRF via XML parser
entity expansion DoS
```

Contoh DocumentBuilderFactory hardening:

```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
```

Jangan berasumsi “ini hanya response dari partner”. Partner bisa compromised, proxy bisa salah, atau environment test bisa berbeda.

---

## 19. Deserialization Hardening

Untuk JSON:

```text
avoid default typing / unsafe polymorphic deserialization
ignore unknown fields only if compatibility policy jelas
fail on missing required fields via validation
map external enum safely
limit numeric precision conversion
validate semantic constraints after deserialize
```

Contoh enum aman:

```java
public enum ExternalStatus {
    APPROVED,
    REJECTED,
    PENDING,
    UNKNOWN;

    public static ExternalStatus fromExternal(String value) {
        if (value == null) return UNKNOWN;
        try {
            return ExternalStatus.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return UNKNOWN;
        }
    }
}
```

External payload evolution tidak boleh membuat domain logic langsung crash tanpa classification.

---

## 20. Cache Security

Client-side cache bisa meningkatkan performa, tetapi salah desain bisa bocor data.

Risiko:

```text
cache response user A untuk user B
cache authorization-specific data tanpa key benar
cache error response terlalu lama
cache PII di disk
cache token response tanpa encryption
cache ignores Vary semantics
```

Rule:

```text
cache key harus mencakup tenant/user/scope jika response scoped
sensitive response default no cache
disk cache perlu encryption atau avoid
respect Cache-Control jika relevan
explicit TTL lebih baik daripada implicit forever
```

OkHttp punya cache support, tetapi untuk backend enterprise, jangan aktifkan response cache tanpa policy data classification.

---

## 21. Cookie Security pada Server-Side HTTP Client

Server-side HTTP client sebaiknya jarang memakai cookie jar stateful kecuali memang memodelkan session ke external system.

Risiko:

```text
cookie dari host A dikirim ke host B
session fixation
cross-tenant leakage
unexpected sticky session
hard-to-debug auth state
```

Rule:

```text
prefer stateless bearer/mTLS/API key untuk service-to-service
if cookie needed, isolate cookie jar per service/tenant/session
never use global mutable cookie jar for multiple destinations
clear cookies on auth boundary
```

---

## 22. Compression Security

Compression tampak harmless, tetapi ada risiko:

```text
zip bomb
huge decompressed response
compression side-channel dalam konteks tertentu
unexpected memory amplification
```

Rule:

```text
limit decompressed bytes
stream large response
be careful logging compressed/decompressed body
avoid compressing highly sensitive data with attacker-controlled data in same context
```

HTTP client yang melakukan transparent decompression tetap harus punya body size guard di layer aplikasi.

---

## 23. Method Semantics dan Side Effect Security

Security bukan hanya confidentiality. Integrity penting.

Pertanyaan:

```text
Apakah retry bisa membuat double charge?
Apakah timeout setelah send bisa berarti downstream sudah memproses?
Apakah command punya idempotency key?
Apakah request signing mencakup body hash?
Apakah replay attack dicegah?
```

Hardening command request:

```text
idempotency key
request timestamp
nonce
body hash
signature
short validity window
replay detection downstream
```

HMAC canonical request harus mencakup bagian yang benar:

```text
method
path
canonical query
selected headers
content hash
timestamp
nonce
```

---

## 24. HMAC Signing Pitfalls

Kesalahan umum:

```text
sign raw URL string setelah encoding tidak konsisten
query order berbeda antara signer dan sender
header case mismatch tidak dinormalisasi
body hash dibuat dari object sebelum serialization
timestamp terlalu longgar
secret masuk log saat debug
```

Rule:

```text
serialize body first
hash exact bytes sent
canonicalize path/query/header deterministically
use constant-time comparison di server side
short timestamp skew
nonce/idempotency key
redact canonical string jika mengandung sensitive value
```

---

## 25. Supply Chain dan Dependency Hardening

HTTP client library adalah dependency kritis.

Risiko:

```text
CVE di TLS/HTTP parser
transitive dependency vulnerable
old OkHttp/Apache version
logging interceptor accidentally enabled
generated client brings old vulnerable stack
shadowed dependencies
```

Hardening:

```text
SBOM
SCA scanning
dependency lock
regular upgrade cadence
centralized HTTP client library version
avoid random client library per team
monitor CVE advisories
integration tests before upgrade
```

Untuk organisasi besar, buat “approved client stack”:

```text
JDK 21/25 + JDK HttpClient for simple controlled clients
OkHttp for Retrofit/generated SDK or detailed lifecycle hooks
Apache HttpClient 5 for enterprise routing/proxy/pool control
Spring RestClient/WebClient when aligned with Spring stack
```

---

## 26. Safe Client Factory Pattern

Jangan biarkan setiap engineer membuat `new OkHttpClient()` atau `HttpClient.newHttpClient()` sendiri tanpa policy.

Buat factory:

```java
public final class SecureHttpClientFactory {
    public OkHttpClient create(ExternalClientConfig config) {
        return new OkHttpClient.Builder()
                .connectTimeout(config.connectTimeout())
                .readTimeout(config.readTimeout())
                .writeTimeout(config.writeTimeout())
                .callTimeout(config.callTimeout())
                .followRedirects(false)
                .followSslRedirects(false)
                .addInterceptor(new DestinationGuardInterceptor(config.destinationPolicy()))
                .addInterceptor(new CorrelationIdInterceptor())
                .addInterceptor(new ScopedAuthInterceptor(config.allowedHost(), config.tokenProvider()))
                .eventListenerFactory(new SecureEventListenerFactory(config.serviceId()))
                .build();
    }
}
```

Policy yang harus masuk factory:

```text
timeout default
redirect policy
TLS config
proxy config
destination guard
auth scope
redaction
observability
body size limit
retry/circuit integration point
```

---

## 27. Destination Guard Interceptor untuk OkHttp

```java
public final class DestinationGuardInterceptor implements Interceptor {
    private final DestinationPolicy policy;

    public DestinationGuardInterceptor(DestinationPolicy policy) {
        this.policy = policy;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        HttpUrl url = request.url();

        if (!"https".equalsIgnoreCase(url.scheme())) {
            throw new SecurityException("Only HTTPS is allowed");
        }

        if (!policy.allowedHosts().contains(url.host().toLowerCase(Locale.ROOT))) {
            throw new SecurityException("Host is not allowed: " + url.host());
        }

        int port = url.port();
        if (!policy.allowedPorts().contains(port)) {
            throw new SecurityException("Port is not allowed: " + port);
        }

        return chain.proceed(request);
    }
}
```

Catatan:

```text
interceptor ini bukan pengganti network egress control
redirect harus disabled atau redirect target divalidasi juga
auth interceptor sebaiknya setelah destination validation
```

---

## 28. JDK HttpClient Secure Wrapper

Karena JDK HttpClient tidak punya interceptor chain built-in seperti OkHttp, gunakan wrapper.

```java
public final class SecureJdkHttpClient {
    private final HttpClient client;
    private final DestinationValidator destinationValidator;
    private final HeaderPolicy headerPolicy;

    public SecureJdkHttpClient(
            HttpClient client,
            DestinationValidator destinationValidator,
            HeaderPolicy headerPolicy
    ) {
        this.client = client;
        this.destinationValidator = destinationValidator;
        this.headerPolicy = headerPolicy;
    }

    public <T> HttpResponse<T> send(
            HttpRequest request,
            HttpResponse.BodyHandler<T> bodyHandler
    ) throws IOException, InterruptedException {
        destinationValidator.validate(request.uri());
        headerPolicy.validate(request.headers());
        return client.send(request, bodyHandler);
    }
}
```

Factory:

```java
HttpClient raw = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(2))
        .sslContext(sslContext)
        .build();
```

---

## 29. Retrofit Security Boundary

Retrofit membuat API terlihat seperti method call:

```java
partnerClient.createCase(request);
```

Risikonya: developer lupa bahwa itu outbound HTTP dengan credential, timeout, redirect, TLS, body, dan error boundary.

Hardening Retrofit:

```text
satu Retrofit instance per service
baseUrl fixed dari config terpercaya
gunakan OkHttpClient secure factory
auth interceptor scoped ke host
converter configured safely
error body parser safe
no raw dynamic @Url unless heavily validated
no direct domain object as @Body
```

Hindari:

```java
@GET
Call<ResponseBody> fetch(@Url String dynamicUrl);
```

Jika dynamic URL wajib, bungkus dengan destination policy.

---

## 30. Spring RestClient/WebClient Security Boundary

Spring abstraction tetap membutuhkan transport-level security policy.

Hardening:

```text
centralized builder bean
baseUrl fixed per service
request interceptor/filter untuk correlation + redaction
no automatic unsafe redirect
underlying client timeout configured
TLS/proxy explicitly configured
OAuth2 client manager scoped
error handler maps safely
```

Contoh RestClient:

```java
@Bean
RestClient partnerRestClient(RestClient.Builder builder) {
    return builder
            .baseUrl("https://api.partner.example.com")
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .requestInterceptor((request, body, execution) -> {
                validateDestination(request.getURI());
                return execution.execute(request, body);
            })
            .build();
}
```

WebClient:

```java
WebClient client = WebClient.builder()
        .baseUrl("https://api.partner.example.com")
        .filter((request, next) -> {
            validateDestination(request.url());
            return next.exchange(request);
        })
        .build();
```

---

## 31. Generated Client Security

OpenAPI-generated client sering membawa default yang tidak production-grade.

Audit generated client untuk:

```text
timeout default
redirect behavior
TLS config
base URL mutability
dynamic server URL
auth injection
logging
error handling
retry behavior
serialization config
large response handling
```

Pattern yang aman:

```text
generated client = low-level protocol adapter
wrapper = security policy + domain interface
```

Jangan expose generated client langsung ke business service.

---

## 32. Multi-Tenant Security

Jika client melayani beberapa tenant:

```text
tenant A token tidak boleh dipakai untuk tenant B
tenant A cache tidak boleh dibaca tenant B
tenant A endpoint override tidak boleh memengaruhi tenant B
tenant A rate limit tidak boleh menghabiskan quota tenant B
```

Hardening:

```text
tenant-scoped credential provider
tenant included in cache key
tenant-scoped metrics but cardinality controlled
tenant-safe logs
tenant policy validation
separate client/pool jika perlu isolation kuat
```

---

## 33. Webhook Callback Client Hardening

Webhook adalah area rawan SSRF karena user/admin bisa mendaftarkan URL callback.

Hardening:

```text
validate callback URL on registration
validate again before delivery
only https
block private/link-local/loopback IP
disable redirect or revalidate redirect
sign webhook payload
include timestamp and event id
retry with idempotency/event id
do not include internal secret in callback
rate limit per subscriber
quarantine failing endpoint
```

Lebih aman lagi:

```text
outbound webhook delivery melalui egress proxy dengan allow/deny controls
```

---

## 34. OAuth/OIDC Discovery URL Risk

OIDC discovery sering mengambil metadata dari URL:

```text
https://issuer/.well-known/openid-configuration
```

Jika issuer user-controlled, risiko SSRF.

Hardening:

```text
issuer allowlist
https only
no private IP
no redirect to different host
metadata size limit
JWKS URL validation
cache TTL controlled
key rotation support
algorithm allowlist
```

Jangan membiarkan tenant arbitrary memasukkan issuer tanpa review/policy.

---

## 35. Cloud Metadata Service Protection

Cloud metadata endpoint sering berada di link-local IP, misalnya kategori:

```text
169.254.169.254
```

HTTP client SSRF yang bisa mengakses metadata endpoint dapat menjadi credential theft path.

Hardening:

```text
block link-local IP in app validator
block metadata route via network policy jika mungkin
use cloud metadata v2/session token feature jika tersedia
least privilege instance/node role
avoid running app with broad cloud role
```

Application-level block saja tidak cukup jika ada bypass. Gunakan defense-in-depth.

---

## 36. Security Observability

Security hardening harus terlihat di telemetry.

Metrics:

```text
outbound.destination_blocked.count
outbound.redirect_blocked.count
outbound.private_ip_blocked.count
outbound.header_rejected.count
outbound.tls_handshake_failed.count
outbound.auth_redaction_applied.count
outbound.response_size_rejected.count
outbound.xml_parser_rejected.count
```

Logs harus mengandung:

```text
service_id
policy_id
reason_code
normalized_host
normalized_path_template
correlation_id
trace_id
```

Jangan log:

```text
full rejected URL jika mengandung query sensitive
raw token
raw request body
raw response body
private key path/password
```

---

## 37. Secure Failure Modes

Saat policy gagal, default harus fail-closed.

```text
unknown host? block
unexpected scheme? block
redirect cross-host? block
TLS validation failure? block
content-type unexpected? block
body too large? block
auth token refresh ambiguous? block or controlled retry, not blind replay
```

Tetapi failure harus actionable.

Buruk:

```text
HTTP client error
```

Baik:

```text
OUTBOUND_DESTINATION_REJECTED: host not allowlisted for service PAYMENT_GATEWAY
```

Internal diagnostic boleh detail, user-facing message harus aman.

---

## 38. Policy Ordering

Urutan yang aman:

```text
build request intent
→ validate destination
→ validate method/path/query
→ validate headers
→ inject correlation
→ inject auth scoped by destination
→ sign exact bytes if needed
→ send with timeout/bulkhead
→ classify response
→ validate content-type/size
→ parse safely
→ map to domain-safe result
→ log metrics with redaction
```

Jangan inject auth sebelum destination divalidasi.

Jangan sign sebelum body final.

Jangan parse sebelum content-type/size guard.

Jangan log sebelum redaction.

---

## 39. Secure-by-Construction External Client Template

```java
public final class PartnerCaseClient {
    private final SecureHttpTransport transport;
    private final PartnerCaseMapper mapper;

    public CreateCaseResult createCase(CreateCaseCommand command) {
        PartnerCreateCaseRequest externalRequest = mapper.toExternal(command);
        validateExternalRequest(externalRequest);

        HttpRequestSpec request = HttpRequestSpec.post("/v1/cases")
                .json(externalRequest)
                .idempotencyKey(command.idempotencyKey())
                .expectedContentType("application/json")
                .maxResponseBytes(256 * 1024)
                .build();

        SecureHttpResponse response = transport.execute("partner-case-api", request);

        return switch (response.statusFamily()) {
            case SUCCESS -> mapper.toDomain(response.parseJson(PartnerCreateCaseResponse.class));
            case CLIENT_ERROR -> mapper.toClientError(response.safeErrorBody());
            case SERVER_ERROR -> CreateCaseResult.retryableFailure(response.diagnosticId());
        };
    }
}
```

Yang penting:

```text
business service tidak tahu URL penuh
business service tidak tahu token
business service tidak parse raw error body
business service menerima typed result
security policy ada di transport/client boundary
```

---

## 40. Design Review Checklist

### Destination

```text
[ ] Apakah base URL berasal dari config terpercaya?
[ ] Apakah scheme dibatasi ke HTTPS?
[ ] Apakah host allowlist?
[ ] Apakah port dibatasi?
[ ] Apakah private/link-local/loopback IP diblokir jika dynamic URL?
[ ] Apakah DNS rebinding dipertimbangkan?
[ ] Apakah redirect disabled atau divalidasi ulang?
```

### Credential

```text
[ ] Apakah token/API key tidak pernah masuk URL?
[ ] Apakah credential scoped per destination?
[ ] Apakah credential injection dilakukan setelah destination validation?
[ ] Apakah token redacted dari logs/traces/metrics?
[ ] Apakah secret berasal dari secret manager, bukan code/config repo?
[ ] Apakah rotation didukung?
```

### TLS/mTLS

```text
[ ] Apakah certificate validation aktif?
[ ] Apakah hostname verification aktif?
[ ] Apakah custom truststore valid dan minimal?
[ ] Apakah mTLS private key aman?
[ ] Apakah certificate expiry dimonitor?
[ ] Apakah pinning punya backup pin dan runbook?
```

### Request

```text
[ ] Apakah URL dibangun dengan builder, bukan string concat?
[ ] Apakah path/query di-encode per component?
[ ] Apakah header propagation allowlist?
[ ] Apakah body DTO explicit dan minimal?
[ ] Apakah idempotency key dipakai untuk command?
[ ] Apakah HMAC/signature memakai exact bytes?
```

### Response

```text
[ ] Apakah Content-Type divalidasi?
[ ] Apakah response size dibatasi?
[ ] Apakah XML parser hardened?
[ ] Apakah deserialization aman?
[ ] Apakah external DTO dipisah dari domain object?
[ ] Apakah error body disanitasi sebelum log?
```

### Logging/Observability

```text
[ ] Apakah sensitive headers redacted?
[ ] Apakah body logging disabled by default?
[ ] Apakah query sensitive disembunyikan?
[ ] Apakah metrics tidak memakai high-cardinality sensitive tags?
[ ] Apakah blocked security event observable?
```

### Dependency

```text
[ ] Apakah library versi supported?
[ ] Apakah SCA scanning aktif?
[ ] Apakah generated client diaudit?
[ ] Apakah dependency lock/SBOM tersedia?
```

---

## 41. Red Flags

Waspadai kode seperti:

```java
new URL(userInput).openStream();
```

```java
HttpClient.newHttpClient().send(request, BodyHandlers.ofString());
```

```java
.followRedirects(ALWAYS)
```

```java
.hostnameVerifier((h, s) -> true)
```

```java
trustAllCertificates()
```

```java
log.info("response={}", responseBody);
```

```java
@GET
Call<ResponseBody> fetch(@Url String url);
```

```java
headers.putAll(inboundHeaders);
```

```java
String url = baseUrl + "/" + userInput;
```

```java
?api_key=" + apiKey
```

```java
ObjectMapper.enableDefaultTyping(...)
```

```java
RestTemplate restTemplate = new RestTemplate();
```

Red flag bukan berarti selalu salah, tetapi wajib review mendalam.

---

## 42. Library-Specific Hardening Summary

### JDK HttpClient

```text
Use wrapper for policy enforcement
Disable redirect by default
Set connect timeout
Use SSLContext correctly
Validate URI before send
Limit BodyHandler/body size
Add explicit auth/redaction layer outside client
```

### OkHttp

```text
Reuse client per service
Disable unsafe redirects for authenticated clients
Use interceptors carefully
Destination validation before auth injection
Use EventListener for observability
Redact logging interceptor
Configure certificate pinning only with runbook
Use ConnectionPool deliberately
```

### Retrofit

```text
Fixed baseUrl
Avoid raw @Url unless validated
Use secure OkHttpClient
Use safe converters
Wrap Response<T> into domain-safe result
Never expose generated/Retrofit interface directly to domain if policy needed
```

### Apache HttpClient 5

```text
Use pooling manager with limits
Configure TLS strategy safely
Configure proxy/route planner intentionally
Disable unsafe redirect or custom redirect strategy
Entity consumption/limits
Centralize credentials provider
```

### Spring RestClient/WebClient

```text
Central builder
Fixed baseUrl
Underlying client configured
OAuth2 scoped
Filters/interceptors for validation/redaction
Do not assume abstraction sets timeout/security defaults
```

---

## 43. Mental Model Final

HTTP client security bukan satu fitur. Ia adalah gabungan dari beberapa boundary:

```text
destination boundary
+ credential boundary
+ transport trust boundary
+ data export boundary
+ parser boundary
+ logging boundary
+ dependency boundary
+ operational boundary
```

Client yang aman bukan yang “pakai HTTPS”. Client yang aman adalah client yang:

```text
hanya bisa pergi ke tempat yang diizinkan
hanya membawa credential yang sesuai destination
menolak redirect berbahaya
memverifikasi TLS dengan benar
membatasi payload masuk/keluar
mem-parse response secara defensif
melog secara berguna tanpa membocorkan rahasia
punya telemetry saat policy memblokir request
mudah diaudit
mudah dites
mudah dioperasikan saat incident
```

---

## 44. Ringkasan Top 1% Heuristics

Top 1% engineer tidak hanya bertanya:

```text
Bagaimana cara call API ini?
```

Mereka bertanya:

```text
Apa boundary-nya?
Siapa yang boleh menentukan destination?
Credential apa yang ikut keluar?
Apa yang terjadi jika redirect?
Apa yang terjadi jika DNS berubah?
Apa yang terjadi jika response 100 MB?
Apa yang masuk log?
Apa yang terlihat di trace?
Apa yang terjadi saat token bocor?
Apa yang terjadi saat certificate rotate?
Apa blast radius jika dependency vulnerable?
Bagaimana cara membuktikan client ini aman?
```

Itulah perbedaan antara HTTP client biasa dan production-grade secure HTTP client.

---

## 45. Latihan Praktis

### Latihan 1 — Audit Existing Client

Ambil satu HTTP client di project nyata dan jawab:

```text
[ ] base URL dari mana?
[ ] redirect aktif?
[ ] timeout ada?
[ ] auth header di-inject di mana?
[ ] token bisa bocor ke redirect host?
[ ] request/response body dilog?
[ ] response size dibatasi?
[ ] error body diparse aman?
[ ] TLS custom?
[ ] dependency version aman?
```

### Latihan 2 — Buat DestinationPolicy

Buat class policy untuk external API dengan:

```text
service_id
allowed scheme
allowed host
allowed port
allow_redirect
max_response_size
timeout
redaction profile
```

### Latihan 3 — Simulasi SSRF

Dengan mock server, test:

```text
http://localhost
http://127.0.0.1
http://169.254.169.254
https://allowed-host dengan redirect ke localhost
URL dengan userinfo
URL dengan unexpected port
```

Pastikan client menolak sebelum mengirim credential.

### Latihan 4 — Redaction Test

Buat test yang memastikan:

```text
Authorization tidak muncul di log
Cookie tidak muncul di log
query token tidak muncul di log
body PII tidak muncul di log
```

### Latihan 5 — TLS Failure Drill

Test client terhadap endpoint dengan:

```text
expired certificate
wrong hostname
self-signed certificate
missing client cert
wrong client cert
```

Pastikan failure diklasifikasikan dan tidak “diakali” dengan trust-all.

---

## 46. Penutup

Part ini adalah titik perubahan penting dalam series. Setelah memahami timeout, pooling, retry, observability, dan architecture, security hardening menyatukan semuanya menjadi satu pertanyaan besar:

```text
Bagaimana memastikan outbound HTTP client tidak menjadi jalur kebocoran, pivot, atau escalation path?
```

Jawabannya bukan satu library atau satu annotation. Jawabannya adalah desain client yang punya policy eksplisit, enforcement konsisten, observability aman, dan failure mode yang fail-closed.

---

## 47. Referensi Lanjutan

- OWASP Server-Side Request Forgery Prevention Cheat Sheet
- OWASP REST Security Cheat Sheet
- OWASP Logging Cheat Sheet
- OWASP HTTP Security Response Headers Cheat Sheet
- Oracle Java Secure Socket Extension Reference Guide
- Oracle JDK `java.net.http` documentation
- OkHttp official documentation: interceptors, certificate pinning, logging interceptor, connection features
- Apache HttpClient 5 documentation
- Spring Framework REST Clients documentation


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency](./25-virtual-threads-completablefuture-reactive-structured-concurrency.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — Generated Clients: OpenAPI, Codegen, SDK Governance](./27-generated-clients-openapi-codegen-sdk-governance.md)
