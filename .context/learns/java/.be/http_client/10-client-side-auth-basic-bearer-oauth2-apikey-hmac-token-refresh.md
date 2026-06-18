# Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
Target: Java 8 sampai Java 25  
Fokus: Java HTTP Client, OkHttp, Retrofit, Apache HttpClient, dan desain production-grade API client

---

## 1. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun fondasi bahwa HTTP client bukan sekadar utility untuk `GET`/`POST`, tetapi sebuah subsystem yang hidup di antara aplikasi kita dan sistem eksternal.

Sampai Part 9, kita sudah memahami:

1. HTTP client sebagai production subsystem.
2. Landscape HTTP client Java 8–25.
3. Request lifecycle dari application intent sampai response body.
4. URI, URL, encoding, query, dan canonical request.
5. Header, content negotiation, compression, dan metadata contract.
6. Body handling: JSON, form, multipart, streaming, upload/download.
7. Timeout engineering.
8. Connection pooling, keep-alive, HTTP/2 multiplexing.
9. DNS, proxy, load balancer, NAT, topology.
10. TLS, mTLS, truststore, keystore, ALPN, certificate pinning.

Part ini masuk ke layer berikutnya: **authentication di sisi client**.

Secara praktis, banyak engineer menganggap authentication HTTP client hanya berarti:

```java
request.header("Authorization", "Bearer " + token)
```

Itu benar secara sintaks, tetapi sangat tidak cukup untuk production.

Authentication client-side sebenarnya menjawab pertanyaan:

> Bagaimana caller membuktikan identitasnya, memperoleh credential, menyimpannya sementara, mengirimkannya secara aman, memperbaruinya saat expired, menghindari leak, menangani race condition, dan mengklasifikasi kegagalan auth tanpa merusak sistem?

---

## 2. Mental Model Utama

HTTP client authentication adalah **credential lifecycle + request decoration + failure recovery + audit boundary**.

Bukan hanya header.

Modelnya:

```text
application operation
        |
        v
choose downstream client
        |
        v
resolve auth policy
        |
        v
obtain credential
        |
        v
cache / reuse credential safely
        |
        v
attach credential to request
        |
        v
send request over secure transport
        |
        v
handle 401 / 403 / signature mismatch / expiry
        |
        v
refresh / retry / fail deterministically
        |
        v
redact logs + emit metrics + preserve audit trail
```

Top-tier engineer tidak hanya bertanya:

> Header auth-nya apa?

Tetapi bertanya:

1. Credential ini berasal dari mana?
2. Siapa pemilik credential?
3. Scope credential apa?
4. Expiry credential kapan?
5. Apakah credential reusable?
6. Apakah refresh credential thread-safe?
7. Apakah 401 boleh otomatis retry?
8. Apakah request ini idempotent?
9. Apakah auth header bisa bocor ke log, redirect, proxy, atau metric?
10. Bagaimana membedakan credential invalid vs permission denied vs downstream auth server down?

---

## 3. Authentication vs Authorization vs Identity

Sebelum masuk implementasi, bedakan tiga konsep ini.

### 3.1 Authentication

Authentication menjawab:

> Siapa caller ini?

Contoh:

- service A membuktikan dirinya sebagai `payment-service`.
- backend membuktikan dirinya ke third-party API dengan API key.
- client membuktikan dirinya dengan OAuth2 access token.
- caller membuktikan kepemilikan private key lewat HMAC signature.

### 3.2 Authorization

Authorization menjawab:

> Apakah caller ini boleh melakukan operasi ini?

Contoh:

- token valid, tetapi scope tidak mencakup `payment.write`.
- API key valid, tetapi tidak boleh akses endpoint `/admin/reports`.
- client certificate valid, tetapi tidak terdaftar untuk tenant tertentu.

### 3.3 Identity

Identity menjawab:

> Entitas apa yang direpresentasikan oleh credential ini?

Contoh:

- user identity.
- service identity.
- tenant identity.
- organization identity.
- application identity.
- workload identity.

### 3.4 Konsekuensi Desain

Jangan mencampur semua error auth menjadi satu exception.

```text
401 Unauthorized
    biasanya authentication gagal / credential absent / credential expired

403 Forbidden
    biasanya authenticated tetapi tidak authorized

400 invalid_request / invalid_grant
    biasanya request token salah, credential salah, atau grant tidak valid

429 dari auth server
    auth dependency overloaded / rate limited

5xx dari auth server
    auth server unavailable / degraded
```

Kesalahan umum:

```java
catch (Exception e) {
    throw new RuntimeException("Failed to call API");
}
```

Lebih baik punya taxonomy:

```text
CredentialUnavailableException
CredentialExpiredException
CredentialRefreshFailedException
AuthenticationRejectedException
AuthorizationDeniedException
SignatureMismatchException
AuthServerUnavailableException
```

---

## 4. Auth Scheme Yang Umum di HTTP Client

Secara umum, Java HTTP client akan berhadapan dengan beberapa scheme berikut.

```text
Basic Auth
Bearer Token
OAuth2 Client Credentials
OAuth2 Authorization Code token relay
API Key
HMAC Signed Request
mTLS
Cookie / Session
Custom Header Credential
```

Kita bahas satu per satu.

---

# 5. Basic Authentication

## 5.1 Apa Itu Basic Auth

Basic Auth mengirim credential berupa `username:password` yang di-Base64 encode, lalu ditempatkan pada header:

```http
Authorization: Basic base64(username:password)
```

Penting:

- Base64 bukan encryption.
- Basic Auth hanya layak melalui HTTPS.
- Credential biasanya long-lived.
- Jika bocor, attacker bisa langsung reuse.

## 5.2 Kapan Basic Auth Masih Dipakai

Basic Auth masih sering muncul pada:

- legacy enterprise API.
- internal admin API.
- proxy authentication.
- integration lama.
- webhook callback sederhana.
- staging/testing endpoint.

Untuk sistem baru, Basic Auth jarang menjadi pilihan terbaik kecuali scope sangat terbatas dan transport/security boundary jelas.

## 5.3 Java JDK HttpClient Basic Auth

Ada dua pendekatan:

1. Manual header.
2. `Authenticator` untuk challenge-based auth.

Manual header:

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class BasicAuthExample {
    public static void main(String[] args) throws Exception {
        String username = "client-a";
        String password = "secret";

        String raw = username + ":" + password;
        String encoded = Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));

        HttpClient client = HttpClient.newHttpClient();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.example.com/v1/accounts"))
                .header("Authorization", "Basic " + encoded)
                .GET()
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        System.out.println(response.statusCode());
    }
}
```

Kelemahan manual:

- credential construction tersebar.
- raw secret mudah masuk log/debug.
- sulit dirotasi.
- tidak ada abstraction boundary.

Lebih baik bungkus dalam credential provider.

```java
public interface CredentialProvider {
    String authorizationHeader();
}

public final class BasicCredentialProvider implements CredentialProvider {
    private final String username;
    private final char[] password;

    public BasicCredentialProvider(String username, char[] password) {
        this.username = username;
        this.password = password.clone();
    }

    @Override
    public String authorizationHeader() {
        String raw = username + ":" + new String(password);
        String encoded = Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        return "Basic " + encoded;
    }
}
```

Catatan: memakai `char[]` lebih baik daripada `String` untuk password dari perspektif mutability, tetapi di Java modern tetap tidak sepenuhnya menghilangkan risiko karena banyak API akhirnya butuh `String`/byte array. Jangan berlebihan merasa aman hanya karena memakai `char[]`.

## 5.4 OkHttp Basic Auth

OkHttp menyediakan helper `Credentials.basic`.

```java
import okhttp3.Credentials;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class OkHttpBasicAuthExample {
    public static void main(String[] args) throws Exception {
        OkHttpClient client = new OkHttpClient();

        String credential = Credentials.basic("client-a", "secret");

        Request request = new Request.Builder()
                .url("https://api.example.com/v1/accounts")
                .header("Authorization", credential)
                .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println(response.code());
        }
    }
}
```

Untuk production, jangan create header di setiap call. Gunakan interceptor.

```java
OkHttpClient client = new OkHttpClient.Builder()
        .addInterceptor(chain -> {
            Request original = chain.request();
            Request authenticated = original.newBuilder()
                    .header("Authorization", Credentials.basic("client-a", "secret"))
                    .build();
            return chain.proceed(authenticated);
        })
        .build();
```

Masalahnya: contoh di atas masih hardcoded. Production harus mengambil secret dari secret manager/config provider.

## 5.5 Retrofit Basic Auth

Karena Retrofit biasanya memakai OkHttp di bawahnya, auth lebih baik dilakukan di OkHttp interceptor.

```java
public interface AccountApi {
    @GET("v1/accounts")
    Call<List<AccountDto>> listAccounts();
}
```

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
        .addInterceptor(chain -> {
            Request request = chain.request().newBuilder()
                    .header("Authorization", Credentials.basic("client-a", "secret"))
                    .build();
            return chain.proceed(request);
        })
        .build();

Retrofit retrofit = new Retrofit.Builder()
        .baseUrl("https://api.example.com/")
        .client(okHttp)
        .addConverterFactory(JacksonConverterFactory.create())
        .build();
```

Jangan menaruh `@Header("Authorization")` di setiap method kecuali memang token berbeda per call.

---

# 6. Bearer Token

## 6.1 Apa Itu Bearer Token

Bearer token adalah token yang memberi akses kepada siapa pun yang memegangnya.

Header umum:

```http
Authorization: Bearer eyJhbGciOi...
```

Karakteristik:

- Token adalah credential.
- Siapa pun yang punya token bisa menggunakannya selama valid.
- Harus dikirim melalui TLS.
- Harus disimpan dan dilog dengan sangat hati-hati.
- Biasanya punya expiry.
- Bisa berupa opaque token atau JWT.

## 6.2 Bearer Token Bukan Selalu JWT

Kesalahan umum:

> Bearer token pasti JWT.

Tidak selalu.

Bearer token bisa:

1. JWT self-contained.
2. Opaque random string yang harus diintrospect oleh server.
3. Reference token ke authorization server.
4. Custom token format.

Client sebaiknya tidak parse JWT kecuali memang punya alasan kuat dan contract jelas. Untuk kebanyakan service-to-service client, client cukup memperlakukan token sebagai opaque credential.

## 6.3 JDK HttpClient Bearer Token

```java
public final class BearerTokenProvider {
    public String getToken() {
        // Ambil dari cache, auth server, atau secret provider.
        return "token-value";
    }
}
```

```java
BearerTokenProvider tokenProvider = new BearerTokenProvider();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/v1/orders"))
        .header("Authorization", "Bearer " + tokenProvider.getToken())
        .GET()
        .build();
```

Ini masih sederhana. Production butuh:

- caching.
- expiry awareness.
- refresh lock.
- error handling.
- redaction.

## 6.4 OkHttp Bearer Token Interceptor

```java
public interface AccessTokenProvider {
    String currentToken();
}

public final class BearerTokenInterceptor implements Interceptor {
    private final AccessTokenProvider tokenProvider;

    public BearerTokenInterceptor(AccessTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request().newBuilder()
                .header("Authorization", "Bearer " + tokenProvider.currentToken())
                .build();

        return chain.proceed(request);
    }
}
```

```java
OkHttpClient client = new OkHttpClient.Builder()
        .addInterceptor(new BearerTokenInterceptor(tokenProvider))
        .build();
```

Interceptor cocok untuk **menambahkan credential sebelum request dikirim**.

Namun interceptor bukan tempat terbaik untuk refresh token setelah 401. Untuk OkHttp, gunakan `Authenticator` untuk challenge/retry authentication.

---

# 7. OAuth2 Client Credentials

## 7.1 Kapan Dipakai

OAuth2 client credentials biasanya dipakai untuk service-to-service access.

Contoh:

```text
order-service
    -> authorization server: request access token using client_id/client_secret
    -> inventory API: Authorization: Bearer <access_token>
```

Grant ini cocok jika caller adalah aplikasi/service, bukan user.

## 7.2 Flow Mental Model

```text
service starts
    |
    v
needs to call downstream
    |
    v
check cached token
    |
    +-- token valid -> attach bearer token
    |
    +-- absent/near expiry -> acquire token
                            |
                            v
                    POST /oauth/token
                    grant_type=client_credentials
                    client_id=...
                    client_secret=...
                            |
                            v
                    receive access_token + expires_in
                            |
                            v
                    cache token until safe expiry
                            |
                            v
                    call downstream API
```

## 7.3 Safe Expiry

Token response biasanya punya `expires_in`, misalnya 3600 detik.

Jangan menunggu sampai detik terakhir.

Gunakan skew:

```text
actual expiry:       now + 3600s
safe expiry:         now + 3600s - 60s
refresh threshold:   before safe expiry
```

Alasan:

- clock skew.
- network latency.
- queueing delay.
- request bisa dikirim tepat sebelum expiry tetapi diproses setelah expiry.

## 7.4 Token Model

```java
import java.time.Instant;

public final class AccessToken {
    private final String value;
    private final Instant expiresAt;

    public AccessToken(String value, Instant expiresAt) {
        this.value = value;
        this.expiresAt = expiresAt;
    }

    public String value() {
        return value;
    }

    public boolean isUsableAt(Instant now) {
        return now.isBefore(expiresAt);
    }
}
```

## 7.5 Token Endpoint Client

Contoh sederhana dengan JDK HttpClient.

```java
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;

public final class OAuth2TokenEndpointClient {
    private final HttpClient httpClient;
    private final URI tokenEndpoint;
    private final String clientId;
    private final String clientSecret;

    public OAuth2TokenEndpointClient(
            HttpClient httpClient,
            URI tokenEndpoint,
            String clientId,
            String clientSecret
    ) {
        this.httpClient = httpClient;
        this.tokenEndpoint = tokenEndpoint;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    public AccessToken fetchToken() throws Exception {
        String form = "grant_type=client_credentials"
                + "&client_id=" + encode(clientId)
                + "&client_secret=" + encode(clientSecret);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(tokenEndpoint)
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            throw new IllegalStateException("Token endpoint failed with status " + response.statusCode());
        }

        // Dalam production parse JSON dengan Jackson/Gson.
        // Contoh ini sengaja disederhanakan.
        String tokenValue = parseAccessToken(response.body());
        long expiresInSeconds = parseExpiresIn(response.body());

        Instant safeExpiry = Instant.now()
                .plusSeconds(expiresInSeconds)
                .minusSeconds(60);

        return new AccessToken(tokenValue, safeExpiry);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String parseAccessToken(String body) {
        throw new UnsupportedOperationException("Implement JSON parsing");
    }

    private static long parseExpiresIn(String body) {
        throw new UnsupportedOperationException("Implement JSON parsing");
    }
}
```

## 7.6 Token Cache Dengan Single-Flight Refresh

Masalah besar di production: banyak thread melihat token expired bersamaan, lalu semuanya memanggil token endpoint.

Ini disebut **token refresh stampede**.

Buruknya:

```text
100 concurrent request
    -> token expired
    -> 100 refresh token call
    -> auth server overloaded
    -> many request fail
```

Solusi: single-flight refresh.

Satu thread refresh, thread lain menunggu/memakai hasil refresh.

```java
import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.locks.ReentrantLock;

public final class SingleFlightAccessTokenProvider implements AccessTokenProvider {
    private final OAuth2TokenEndpointClient tokenClient;
    private final Clock clock;
    private final ReentrantLock refreshLock = new ReentrantLock();

    private volatile AccessToken cached;

    public SingleFlightAccessTokenProvider(OAuth2TokenEndpointClient tokenClient, Clock clock) {
        this.tokenClient = tokenClient;
        this.clock = clock;
    }

    @Override
    public String currentToken() {
        AccessToken token = cached;
        Instant now = clock.instant();

        if (token != null && token.isUsableAt(now)) {
            return token.value();
        }

        refreshLock.lock();
        try {
            // Double-check setelah lock, karena thread lain mungkin sudah refresh.
            token = cached;
            now = clock.instant();

            if (token != null && token.isUsableAt(now)) {
                return token.value();
            }

            AccessToken fresh = tokenClient.fetchToken();
            cached = fresh;
            return fresh.value();
        } catch (Exception e) {
            throw new CredentialUnavailableException("Unable to obtain access token", e);
        } finally {
            refreshLock.unlock();
        }
    }
}
```

```java
public final class CredentialUnavailableException extends RuntimeException {
    public CredentialUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

## 7.7 Should Token Fetch Use Same HTTP Client?

Bisa, tetapi hati-hati.

Jika memakai same client/pool untuk token endpoint dan downstream endpoint, kemungkinan:

- pool downstream penuh.
- token refresh butuh pool.
- token refresh ikut stuck.
- semua request gagal.

Untuk sistem kritikal, pertimbangkan client terpisah:

```text
apiHttpClient
    pool/timeout untuk downstream API

authHttpClient
    pool/timeout kecil khusus token endpoint
```

Dengan begitu, token refresh tidak ikut tercekik oleh pool call utama.

---

# 8. Refresh Setelah 401

## 8.1 Kenapa 401 Tidak Selalu Berarti Token Expired

401 bisa berarti:

1. Token expired.
2. Token invalid.
3. Token malformed.
4. Token audience salah.
5. Token issuer salah.
6. Server clock berbeda.
7. Authorization server key rotation belum sync.
8. Credential dicabut.
9. Header tidak terkirim karena redirect/proxy/filter.
10. Client salah environment.

Jangan otomatis refresh berkali-kali untuk semua 401.

## 8.2 Safe Policy

Policy yang sehat:

```text
On 401:
    if request had bearer token
    and token provider can invalidate current token
    and request is retryable/idempotent or body repeatable
    and retry count for auth == 0
        refresh token once
        retry once
    else
        fail as AuthenticationRejectedException
```

Kenapa hanya sekali?

Karena kalau token baru juga ditolak, kemungkinan masalahnya bukan expiry sederhana.

## 8.3 OkHttp Authenticator

OkHttp punya `Authenticator` untuk merespons authentication challenge.

Sketch:

```java
public interface RefreshableTokenProvider extends AccessTokenProvider {
    void invalidate(String tokenValue);
    String refreshToken();
}
```

```java
import okhttp3.Authenticator;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.Route;

public final class BearerTokenAuthenticator implements Authenticator {
    private final RefreshableTokenProvider tokenProvider;

    public BearerTokenAuthenticator(RefreshableTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public Request authenticate(Route route, Response response) {
        if (responseCount(response) >= 2) {
            return null; // Stop retry loop.
        }

        String oldHeader = response.request().header("Authorization");
        if (oldHeader == null || !oldHeader.startsWith("Bearer ")) {
            return null;
        }

        String oldToken = oldHeader.substring("Bearer ".length());
        tokenProvider.invalidate(oldToken);

        String newToken = tokenProvider.refreshToken();

        return response.request().newBuilder()
                .header("Authorization", "Bearer " + newToken)
                .build();
    }

    private static int responseCount(Response response) {
        int count = 1;
        while ((response = response.priorResponse()) != null) {
            count++;
        }
        return count;
    }
}
```

Client:

```java
OkHttpClient client = new OkHttpClient.Builder()
        .addInterceptor(new BearerTokenInterceptor(tokenProvider))
        .authenticator(new BearerTokenAuthenticator(tokenProvider))
        .build();
```

Interceptor menambahkan token. Authenticator menangani 401.

## 8.4 JDK HttpClient Refresh Pattern

JDK `HttpClient` tidak menyediakan interceptor built-in seperti OkHttp. Biasanya kita buat wrapper.

```java
public final class AuthenticatedHttpClient {
    private final HttpClient client;
    private final RefreshableTokenProvider tokenProvider;

    public AuthenticatedHttpClient(HttpClient client, RefreshableTokenProvider tokenProvider) {
        this.client = client;
        this.tokenProvider = tokenProvider;
    }

    public HttpResponse<String> send(HttpRequest original) throws Exception {
        String token = tokenProvider.currentToken();
        HttpRequest first = withBearer(original, token);

        HttpResponse<String> response = client.send(first, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 401) {
            return response;
        }

        tokenProvider.invalidate(token);
        String refreshed = tokenProvider.refreshToken();

        HttpRequest retry = withBearer(original, refreshed);
        return client.send(retry, HttpResponse.BodyHandlers.ofString());
    }

    private static HttpRequest withBearer(HttpRequest original, String token) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(original.uri())
                .timeout(original.timeout().orElse(null));

        original.headers().map().forEach((name, values) -> {
            if (!name.equalsIgnoreCase("Authorization")) {
                for (String value : values) {
                    builder.header(name, value);
                }
            }
        });

        builder.header("Authorization", "Bearer " + token);

        // Real implementation perlu preserve method dan body publisher.
        // Tidak semua body repeatable, jadi wrapper harus didesain hati-hati.
        return builder.method(original.method(), HttpRequest.BodyPublishers.noBody()).build();
    }
}
```

Catatan penting: contoh di atas tidak lengkap untuk preserve body. Di production, lebih baik punya abstraction `RequestSpec` sendiri agar body repeatability dan retry policy jelas.

---

# 9. API Key

## 9.1 Apa Itu API Key

API key adalah credential sederhana yang biasanya diberikan oleh provider.

Bentuk umum:

```http
X-API-Key: abc123
```

Atau:

```http
Authorization: ApiKey abc123
```

Atau, lebih buruk:

```text
https://api.example.com/v1/data?api_key=abc123
```

## 9.2 Header vs Query Parameter

Lebih baik pakai header daripada query parameter.

Kenapa query parameter berbahaya?

- mudah muncul di access log.
- mudah masuk browser history.
- mudah masuk reverse proxy logs.
- mudah bocor lewat referrer.
- mudah masuk monitoring URL label.

Jika provider hanya mendukung query param, redaction menjadi wajib.

## 9.3 API Key Interceptor

```java
public final class ApiKeyInterceptor implements Interceptor {
    private final String headerName;
    private final ApiKeyProvider apiKeyProvider;

    public ApiKeyInterceptor(String headerName, ApiKeyProvider apiKeyProvider) {
        this.headerName = headerName;
        this.apiKeyProvider = apiKeyProvider;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request().newBuilder()
                .header(headerName, apiKeyProvider.currentApiKey())
                .build();

        return chain.proceed(request);
    }
}
```

## 9.4 API Key Rotation

API key sering long-lived. Karena itu harus ada strategi rotation.

Desain yang baik:

```text
current key
next key
activation window
rollback window
metrics per credential version
```

Pattern:

1. Provider menerbitkan key baru.
2. Client deploy config baru dengan key baru.
3. Provider menerima dua key sementara.
4. Pastikan traffic memakai key baru.
5. Cabut key lama.

Jika memungkinkan, dukung key id:

```http
X-API-Key-Id: key-2026-06
X-API-Key: secret-value
```

Log hanya key id, bukan secret.

---

# 10. HMAC Signed Request

## 10.1 Apa Itu HMAC Signing

HMAC signing tidak hanya mengirim secret. Client membuat signature dari sebagian request menggunakan shared secret.

Contoh header:

```http
X-Client-Id: client-a
X-Timestamp: 2026-06-18T10:15:30Z
X-Nonce: 8f71d0...
X-Signature: base64(hmacSha256(secret, canonicalRequest))
```

Server melakukan hal yang sama dan membandingkan signature.

## 10.2 Kenapa HMAC Dipakai

HMAC membantu:

- membuktikan caller memiliki secret.
- mengurangi risiko secret dikirim langsung.
- mendeteksi request tampering.
- mendukung replay protection lewat timestamp/nonce.

Namun HMAC tidak menggantikan TLS. Tetap perlu HTTPS.

## 10.3 Canonical Request

Kunci HMAC adalah canonical request.

Contoh:

```text
METHOD\n
PATH\n
CANONICAL_QUERY\n
CANONICAL_HEADERS\n
SHA256_BODY_HASH\n
TIMESTAMP\n
NONCE
```

Masalah paling umum:

1. Client dan server beda encoding.
2. Query parameter order berbeda.
3. Header case berbeda.
4. Whitespace tidak dinormalisasi.
5. Path trailing slash berbeda.
6. Body JSON spacing berbeda jika sign raw JSON string.
7. Timestamp format berbeda.

Karena itu canonicalization harus eksplisit.

## 10.4 HMAC Utility

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class HmacSigner {
    public String sign(String secret, String canonicalRequest) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec key = new SecretKeySpec(
                    secret.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256"
            );
            mac.init(key);
            byte[] raw = mac.doFinal(canonicalRequest.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(raw);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to sign request", e);
        }
    }
}
```

## 10.5 Body Hash

```java
import java.security.MessageDigest;

public final class Sha256 {
    public static String hex(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(bytes);
            StringBuilder sb = new StringBuilder();
            for (byte b : hashed) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Unable to hash body", e);
        }
    }
}
```

## 10.6 HMAC Interceptor Sketch

```java
public final class HmacSigningInterceptor implements Interceptor {
    private final String clientId;
    private final String secret;
    private final HmacSigner signer;
    private final Clock clock;

    public HmacSigningInterceptor(String clientId, String secret, HmacSigner signer, Clock clock) {
        this.clientId = clientId;
        this.secret = secret;
        this.signer = signer;
        this.clock = clock;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();

        String timestamp = clock.instant().toString();
        String nonce = java.util.UUID.randomUUID().toString();

        String canonical = canonicalize(original, timestamp, nonce);
        String signature = signer.sign(secret, canonical);

        Request signed = original.newBuilder()
                .header("X-Client-Id", clientId)
                .header("X-Timestamp", timestamp)
                .header("X-Nonce", nonce)
                .header("X-Signature", signature)
                .build();

        return chain.proceed(signed);
    }

    private String canonicalize(Request request, String timestamp, String nonce) {
        // Production implementation harus deterministic dan disepakati dengan server.
        return request.method() + "\n"
                + request.url().encodedPath() + "\n"
                + request.url().encodedQuery() + "\n"
                + timestamp + "\n"
                + nonce;
    }
}
```

Catatan: Jika body ikut disign, interceptor perlu membaca body. Ini tidak trivial karena `RequestBody` adalah stream yang bisa jadi tidak repeatable. Untuk body signing production, desain body buffer/repeatability harus jelas sejak awal.

## 10.7 Replay Protection

HMAC tanpa replay protection masih rentan jika request ditangkap.

Tambahkan:

```text
timestamp window: contoh ±5 menit
nonce: unik per request
server-side nonce cache: TTL sesuai window
```

Server menolak request jika:

- timestamp terlalu lama/terlalu jauh di masa depan.
- nonce sudah pernah dipakai.
- signature tidak cocok.

## 10.8 HMAC Failure Classification

```text
401 signature missing
401 signature invalid
401 timestamp outside allowed window
401 nonce replayed
403 client id disabled
429 signing quota exceeded
```

Client sebaiknya tidak retry signature invalid secara membabi buta. Signature invalid biasanya deterministic bug, bukan transient failure.

---

# 11. mTLS sebagai Authentication

Part TLS sudah dibahas pada Part 9, tetapi di sini kita tegaskan posisinya.

mTLS bisa berfungsi sebagai authentication karena client membuktikan identitas menggunakan client certificate.

```text
client has private key + certificate
server trusts issuing CA
TLS handshake validates client certificate
server maps certificate subject/SAN to client identity
```

Kelebihan:

- credential tidak dikirim sebagai header.
- identitas ada di transport layer.
- kuat untuk service-to-service.
- cocok dengan service mesh atau internal platform.

Kekurangan:

- certificate lifecycle kompleks.
- rotation harus disiplin.
- mapping identity harus jelas.
- debugging lebih sulit.
- sering tetap butuh app-level authorization.

mTLS sering dikombinasikan dengan token:

```text
mTLS proves workload identity
Bearer token proves delegated permission/scope
```

---

# 12. Cookie / Session Authentication

Untuk backend-to-backend API modern, cookie session tidak ideal tetapi masih ada pada legacy system.

Risiko:

- session stickiness.
- CSRF concern jika browser context terlibat.
- cookie jar statefulness.
- cross-domain confusion.
- logout/invalidation semantics.

JDK `HttpClient` bisa dikonfigurasi dengan `CookieHandler`. OkHttp punya `CookieJar`. Apache HttpClient punya cookie store.

Prinsip production:

1. Jangan share cookie jar antar downstream yang tidak terkait.
2. Jangan pakai global mutable cookie jar tanpa boundary.
3. Log cookie harus diredact.
4. Pahami session expiry.
5. Hindari redirect yang membawa cookie ke host tidak sah.

---

# 13. Auth Placement: Header Per Call, Interceptor, Wrapper, atau SDK?

Ada beberapa tempat untuk menerapkan auth.

## 13.1 Per Call

```java
request.header("Authorization", "Bearer " + token)
```

Kelebihan:

- eksplisit.
- mudah untuk demo.

Kekurangan:

- duplikasi.
- raw secret tersebar.
- raw token mudah bocor.
- refresh sulit.
- inconsistent behavior.

Cocok untuk:

- prototype.
- satu request khusus.
- token memang berbeda per operation.

## 13.2 Interceptor / Filter

Kelebihan:

- central decoration.
- konsisten.
- cocok untuk OkHttp/Retrofit/Spring WebClient.

Kekurangan:

- bisa terlalu tersembunyi.
- order interceptor penting.
- body signing bisa sulit.
- retry/refresh butuh hati-hati.

Cocok untuk:

- API key.
- bearer token.
- correlation/auth header.

## 13.3 Client Wrapper

Kelebihan:

- eksplisit di boundary.
- bisa punya error taxonomy.
- bisa enforce retryability.
- cocok untuk JDK HttpClient.

Kekurangan:

- perlu desain lebih banyak.
- harus preserve request body/method dengan benar.

Cocok untuk:

- production-grade internal SDK.
- auth + retry + error mapping.

## 13.4 Generated SDK Layer

Kelebihan:

- contract-driven.
- type-safe.
- auth injection bisa distandarkan.

Kekurangan:

- generated code sering buruk untuk resilience.
- perlu wrapper/governance.

Cocok untuk:

- banyak API endpoint.
- OpenAPI ecosystem.
- organization-scale API platform.

---

# 14. Redirect dan Credential Leakage

Ini salah satu trap penting.

Jika request ke:

```text
https://api.example.com/data
```

lalu server redirect ke:

```text
https://evil.example.net/collect
```

Apakah client akan membawa `Authorization` header?

Library biasanya punya proteksi tertentu, tetapi jangan mengandalkan asumsi tanpa testing.

Policy yang aman:

1. Jangan follow redirect otomatis untuk authenticated API kecuali perlu.
2. Jika follow redirect, validasi host allowlist.
3. Jangan propagate Authorization ke host berbeda.
4. Log redirect target dengan redaction.
5. Treat cross-host redirect sebagai security event.

---

# 15. Proxy dan Authentication

Proxy bisa punya authentication sendiri.

Ada dua auth context:

```text
Proxy-Authorization: credential untuk proxy
Authorization: credential untuk target server
```

Jangan tertukar.

Untuk HTTPS melalui proxy, client biasanya membuat tunnel dengan `CONNECT`. Request `CONNECT` berbeda dari request target. Header target tidak semestinya bocor ke proxy CONNECT request.

Prinsip:

- pisahkan proxy credential dan API credential.
- redact keduanya.
- audit proxy usage.
- hati-hati dengan TLS inspection.

---

# 16. Secret Management

## 16.1 Jangan Hardcode Secret

Anti-pattern:

```java
private static final String API_KEY = "abc123";
```

Masalah:

- masuk git history.
- sulit rotate.
- bisa muncul di artifact.
- bisa terbaca lewat decompiler.
- sulit beda environment.

## 16.2 Source Secret Yang Umum

```text
local development: environment variable / local secret file
container: mounted secret / env var / secret manager agent
cloud: AWS Secrets Manager / SSM Parameter Store / GCP Secret Manager / Azure Key Vault
enterprise: Vault / CyberArk / internal secret platform
```

## 16.3 Secret Provider Abstraction

```java
public interface SecretProvider {
    String getSecret(String name);
}
```

```java
public final class EnvironmentSecretProvider implements SecretProvider {
    @Override
    public String getSecret(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing secret: " + name);
        }
        return value;
    }
}
```

Production client tidak perlu tahu apakah secret berasal dari env var, Vault, atau cloud parameter store.

## 16.4 Secret Rotation Design

Pertanyaan design review:

1. Bagaimana secret dirotasi tanpa downtime?
2. Apakah client membaca secret hanya saat startup atau bisa reload?
3. Apakah provider menerima old/new credential overlap?
4. Apakah kita punya metric credential version?
5. Apakah rollback possible?
6. Apakah secret lama dicabut setelah migrasi?

---

# 17. Logging dan Redaction

Auth data tidak boleh muncul mentah di log.

## 17.1 Data Yang Harus Diredact

```text
Authorization
Proxy-Authorization
Cookie
Set-Cookie
X-API-Key
X-Auth-Token
client_secret
access_token
refresh_token
signature
private key
password
```

## 17.2 Redaction Function

```java
import java.util.Set;

public final class HeaderRedactor {
    private static final Set<String> SENSITIVE = Set.of(
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "x-auth-token"
    );

    public static String redact(String headerName, String value) {
        if (headerName == null) {
            return value;
        }
        if (SENSITIVE.contains(headerName.toLowerCase())) {
            return "<redacted>";
        }
        return value;
    }
}
```

Java 8 tidak punya `Set.of`, gunakan:

```java
private static final Set<String> SENSITIVE = new HashSet<>(Arrays.asList(
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-auth-token"
));
```

## 17.3 Jangan Log Full URL Jika Ada Credential di Query

Jika API key terpaksa di query:

```text
/api/data?api_key=secret&page=1
```

Log harus menjadi:

```text
/api/data?api_key=<redacted>&page=1
```

---

# 18. Metrics dan Observability Auth

Auth harus punya metric khusus.

Metric yang berguna:

```text
http_client_auth_token_fetch_total{client, outcome}
http_client_auth_token_fetch_duration_seconds{client}
http_client_auth_token_cache_hit_total{client}
http_client_auth_token_cache_miss_total{client}
http_client_auth_token_refresh_total{client, outcome}
http_client_auth_401_total{client, endpoint_class}
http_client_auth_403_total{client, endpoint_class}
http_client_auth_retry_total{client, outcome}
http_client_auth_secret_reload_total{client, outcome}
http_client_auth_signature_failure_total{client}
```

Jangan masukkan token, API key, client secret, atau raw user id sebagai label. Itu cardinality dan security problem.

Good labels:

```text
client="payment-provider"
outcome="success|failure"
error_class="auth_server_unavailable|invalid_client|timeout"
environment="prod"
```

Bad labels:

```text
token="eyJhbGciOi..."
api_key="abc123"
user_email="person@example.com"
```

---

# 19. Error Handling dan Failure Taxonomy

## 19.1 Jangan Treat Semua 401 Sama

Buat classification:

```java
public enum AuthFailureKind {
    MISSING_CREDENTIAL,
    EXPIRED_CREDENTIAL,
    INVALID_CREDENTIAL,
    INSUFFICIENT_SCOPE,
    SIGNATURE_MISMATCH,
    CLOCK_SKEW,
    AUTH_SERVER_UNAVAILABLE,
    AUTH_SERVER_RATE_LIMITED,
    UNKNOWN
}
```

## 19.2 Exception Model

```java
public abstract class DownstreamAuthException extends RuntimeException {
    private final String clientName;
    private final AuthFailureKind kind;

    protected DownstreamAuthException(String clientName, AuthFailureKind kind, String message, Throwable cause) {
        super(message, cause);
        this.clientName = clientName;
        this.kind = kind;
    }

    public String clientName() {
        return clientName;
    }

    public AuthFailureKind kind() {
        return kind;
    }
}
```

```java
public final class DownstreamAuthenticationException extends DownstreamAuthException {
    public DownstreamAuthenticationException(String clientName, AuthFailureKind kind, String message, Throwable cause) {
        super(clientName, kind, message, cause);
    }
}
```

```java
public final class DownstreamAuthorizationException extends DownstreamAuthException {
    public DownstreamAuthorizationException(String clientName, AuthFailureKind kind, String message, Throwable cause) {
        super(clientName, kind, message, cause);
    }
}
```

## 19.3 Retryability

```text
credential expired -> maybe refresh once and retry
invalid client_secret -> do not retry repeatedly
403 insufficient scope -> do not retry
clock skew -> do not retry blindly; fix system clock/config
429 token endpoint -> retry with backoff if deadline allows
5xx token endpoint -> retry carefully with backoff/circuit breaker
network timeout to token endpoint -> retry if deadline allows
signature mismatch -> do not retry; deterministic bug likely
```

---

# 20. Concurrency Problem Dalam Auth

## 20.1 Token Stampede

Sudah dibahas: banyak thread refresh token bersamaan.

Solusi:

- lock.
- future memoization.
- single-flight.
- proactive refresh.

## 20.2 Deadlock Karena Auth Refresh Memakai Client Yang Sama

Contoh:

```text
client pool max = 10
10 calls sedang menunggu token refresh
refresh call butuh connection dari pool yang sama
pool penuh
refresh tidak jalan
semua stuck
```

Solusi:

- separate auth client.
- separate pool.
- small timeout.
- bounded wait.

## 20.3 Recursive Auth Interceptor

Jika token endpoint dipanggil menggunakan OkHttp client yang sama dengan auth interceptor, bisa terjadi:

```text
call token endpoint
    -> interceptor tries to attach token
        -> token missing
            -> calls token endpoint
                -> interceptor tries to attach token
                    -> infinite recursion
```

Solusi:

- token endpoint client tanpa auth interceptor.
- tag request auth-free.
- separate client instance.

## 20.4 Refresh Storm Karena 401 Serentak

Walau token belum expired menurut client, server bisa menolak token karena revoked/key rotation.

Jika 100 request mendapat 401 bersamaan, jangan 100 refresh.

Gunakan invalidate + single-flight refresh.

---

# 21. Timeouts Khusus Auth

Token endpoint adalah dependency yang berbeda dari downstream API.

Jangan memakai timeout terlalu panjang.

Contoh policy:

```text
Token endpoint:
    connect timeout: 1s
    response timeout: 3s
    total call timeout: 5s
    retry: 1-2 kali dengan jitter jika transient

Downstream API:
    tergantung SLA endpoint
```

Kenapa token endpoint timeout harus ketat?

Karena setiap request downstream bisa bergantung padanya saat token missing/expired. Jika token call hang, seluruh subsystem bisa hang.

---

# 22. Auth dan Idempotency

Refresh token + retry bisa mengulang request.

Untuk request seperti:

```http
POST /payments
```

Jika request pertama sebenarnya sudah diproses tetapi response 401/connection failure terjadi karena race, retry bisa menyebabkan duplicate operation.

Policy:

- GET safe untuk retry, tetapi tetap lihat side effects provider.
- PUT biasanya idempotent jika resource id sama.
- POST tidak otomatis aman.
- POST butuh idempotency key jika akan diretry.
- streaming body mungkin tidak repeatable.

Untuk authenticated POST critical:

```http
Idempotency-Key: generated-command-id
Authorization: Bearer <token>
```

---

# 23. Retrofit Auth Patterns

## 23.1 Static Header

```java
public interface ReportApi {
    @Headers("X-Client-Version: 2026-06")
    @GET("reports")
    Call<List<ReportDto>> listReports();
}
```

Tidak cocok untuk secret.

## 23.2 Dynamic Header Per Method

```java
public interface ReportApi {
    @GET("reports")
    Call<List<ReportDto>> listReports(@Header("Authorization") String authorization);
}
```

Cocok jika token benar-benar per request/per user.

Kurang cocok untuk service-to-service fixed auth karena caller harus ingat mengisi header.

## 23.3 OkHttp Interceptor Untuk Global Auth

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
        .addInterceptor(new BearerTokenInterceptor(tokenProvider))
        .authenticator(new BearerTokenAuthenticator(tokenProvider))
        .build();
```

Ini pattern umum untuk Retrofit.

## 23.4 Multiple Auth Policy Dalam Satu Retrofit

Jika satu API punya endpoint public dan private, jangan asal attach token ke semua request jika tidak perlu.

Pilihan:

1. Separate Retrofit service/client untuk public/private.
2. Annotation marker + interceptor membaca metadata.
3. Explicit method header.
4. Separate base client wrapper.

Untuk backend enterprise, pilihan paling jelas biasanya **separate client** jika auth policy berbeda signifikan.

---

# 24. JDK HttpClient Auth Patterns

Karena JDK `HttpClient` tidak punya interceptor built-in, ada beberapa pendekatan.

## 24.1 Request Factory

```java
public final class AuthenticatedRequestFactory {
    private final AccessTokenProvider tokenProvider;

    public AuthenticatedRequestFactory(AccessTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    public HttpRequest.Builder newRequest(URI uri) {
        return HttpRequest.newBuilder(uri)
                .header("Authorization", "Bearer " + tokenProvider.currentToken());
    }
}
```

Simple, tetapi refresh setelah 401 harus di layer lain.

## 24.2 Client Wrapper

Lebih baik untuk production:

```text
DomainClient
    -> AuthPolicy
    -> JDK HttpClient
    -> ResponseClassifier
    -> ErrorMapper
```

Jangan expose raw `HttpClient` ke semua service class.

## 24.3 Authenticator

JDK `HttpClient.Builder` mendukung `Authenticator` untuk authentication mechanism tertentu. Namun untuk modern bearer token/OAuth2, wrapper/factory biasanya lebih fleksibel.

---

# 25. Apache HttpClient 5 Auth Patterns

Apache HttpClient punya model lebih lengkap untuk classic enterprise use case:

- credentials provider.
- auth cache.
- route/proxy auth.
- request interceptors.
- connection manager.

Cocok jika:

- banyak proxy/auth legacy.
- perlu NTLM/Kerberos/SPNEGO style integration.
- perlu kontrol enterprise HTTP stack detail.
- migrasi dari Apache 4.x.

Namun untuk bearer token/OAuth2, pattern tetap mirip:

```text
TokenProvider
    -> request interceptor adds Authorization
    -> response handling classifies 401/403
    -> refresh/retry policy outside low-level request if needed
```

---

# 26. Auth Policy Object Pattern

Untuk top-tier design, jangan biarkan auth tersebar sebagai if-else.

Gunakan policy object.

```java
public interface AuthPolicy {
    void apply(AuthRequestBuilder request);
    AuthDecision onUnauthorized(AuthFailureContext context);
}
```

```java
public interface AuthRequestBuilder {
    void header(String name, String value);
}
```

```java
public enum AuthDecisionType {
    RETRY_WITH_UPDATED_CREDENTIAL,
    FAIL_AUTHENTICATION,
    FAIL_AUTHORIZATION,
    FAIL_NON_RETRYABLE
}
```

```java
public final class AuthDecision {
    private final AuthDecisionType type;
    private final String authorizationHeader;

    private AuthDecision(AuthDecisionType type, String authorizationHeader) {
        this.type = type;
        this.authorizationHeader = authorizationHeader;
    }

    public static AuthDecision retryWith(String authorizationHeader) {
        return new AuthDecision(AuthDecisionType.RETRY_WITH_UPDATED_CREDENTIAL, authorizationHeader);
    }

    public static AuthDecision fail(AuthDecisionType type) {
        return new AuthDecision(type, null);
    }
}
```

Keuntungan:

- auth mechanism pluggable.
- testable.
- failure classification eksplisit.
- retry behavior tidak tersembunyi.
- cocok untuk generated client wrapper.

---

# 27. Auth Boundary Dalam Architecture

Jangan sebar auth concern di business service.

Buruk:

```java
public class OrderService {
    public void submit(Order order) {
        String token = tokenService.getToken();
        http.post("/orders", token, order);
    }
}
```

Lebih baik:

```text
OrderService
    -> PaymentGateway port
        -> PaymentHttpClient adapter
            -> AuthPolicy
            -> HttpTransport
```

Business service hanya tahu operasi domain:

```java
public interface PaymentGateway {
    PaymentResult charge(ChargeCommand command);
}
```

Adapter yang mengurus auth:

```java
public final class PaymentHttpClient implements PaymentGateway {
    private final HttpTransport transport;
    private final AuthPolicy authPolicy;
    private final PaymentDtoMapper mapper;

    @Override
    public PaymentResult charge(ChargeCommand command) {
        // Build request, apply auth, classify response, map to domain result.
        throw new UnsupportedOperationException();
    }
}
```

---

# 28. Security Anti-Patterns

## 28.1 Disabling TLS Validation Karena Auth Error

Buruk:

```java
trustAllCertificates();
disableHostnameVerification();
```

Ini sering dilakukan saat `SSLHandshakeException`, lalu disebut “fix”. Itu bukan fix; itu menghapus security boundary.

## 28.2 Token Dalam URL

Buruk:

```text
https://api.example.com/data?access_token=...
```

## 28.3 Log Full Request

Buruk:

```java
log.info("Request headers: {}", headers);
```

## 28.4 Retry Infinite 401

Buruk:

```text
401 -> refresh -> retry -> 401 -> refresh -> retry forever
```

## 28.5 Shared Mutable Global Credential

Buruk:

```java
public static String token;
```

## 28.6 Same Credential Across Environment

Buruk:

```text
DEV, UAT, PROD memakai API key yang sama
```

## 28.7 Over-Scoped Token

Buruk:

```text
token scope = admin:*
client hanya perlu report:read
```

## 28.8 Not Testing Expiry

Banyak sistem terlihat aman sampai token pertama kali expired di production.

---

# 29. Testing Client-Side Auth

## 29.1 Test Case Minimum

```text
valid credential -> success
missing credential -> fail before send or 401 mapped correctly
expired token -> refresh once -> retry success
expired token -> refresh fails -> CredentialUnavailableException
invalid token -> retry once max -> AuthenticationRejectedException
403 -> AuthorizationDeniedException, no retry
API key redacted in logs
Authorization header not sent to wrong host after redirect
single-flight refresh under concurrency
HMAC signature deterministic
HMAC timestamp outside window handled
```

## 29.2 MockWebServer Example Concept

Dengan OkHttp MockWebServer:

```text
server response 1: 401
server response 2: 200
assert:
    tokenProvider.refresh called once
    request 1 has old token
    request 2 has new token
```

## 29.3 Concurrency Test

```text
Given cached token expired
When 100 threads call currentToken()
Then token endpoint called once or small bounded number
And all callers receive same fresh token
```

## 29.4 Redaction Test

```text
Given request has Authorization: Bearer secret
When logging request
Then log contains Authorization=<redacted>
And does not contain secret
```

---

# 30. Production Readiness Checklist

## 30.1 Auth Design Checklist

```text
[ ] Auth scheme clearly documented.
[ ] Credential owner is clear: service/user/tenant/app.
[ ] Credential scope is minimal.
[ ] Credential source is externalized.
[ ] Secret is not hardcoded.
[ ] Rotation path exists.
[ ] Expiry handling exists if token-based.
[ ] Refresh is concurrency-safe.
[ ] Refresh has timeout.
[ ] Refresh has retry budget.
[ ] Refresh does not recurse through same interceptor unexpectedly.
[ ] Token endpoint has separate client/pool if needed.
[ ] 401 retry is bounded.
[ ] 403 is not retried blindly.
[ ] Redirect does not leak credential.
[ ] Proxy auth and target auth are separated.
[ ] Logs redact auth data.
[ ] Metrics do not expose secrets.
[ ] Tests cover expiry/refresh/failure.
```

## 30.2 Code Review Checklist

```text
[ ] Is Authorization header added centrally?
[ ] Is auth policy visible and testable?
[ ] Is token provider thread-safe?
[ ] Is there token refresh stampede protection?
[ ] Is body repeatability considered before retry?
[ ] Are POST retries protected by idempotency key?
[ ] Are secret values absent from exception messages?
[ ] Are config values validated at startup?
[ ] Are auth errors classified separately from transport errors?
[ ] Are auth dependency failures observable?
```

## 30.3 Incident Checklist

Saat terjadi spike 401/403:

```text
1. Apakah credential expired?
2. Apakah secret dirotasi?
3. Apakah token endpoint gagal?
4. Apakah clock skew?
5. Apakah audience/scope berubah?
6. Apakah base URL salah environment?
7. Apakah Authorization header hilang karena redirect/proxy/filter?
8. Apakah WAF/API gateway policy berubah?
9. Apakah cert/mTLS identity berubah?
10. Apakah provider melakukan key rotation?
```

Saat terjadi spike token refresh:

```text
1. Apakah token TTL terlalu pendek?
2. Apakah cache tidak bekerja?
3. Apakah semua pod restart bersamaan?
4. Apakah refresh single-flight rusak?
5. Apakah token endpoint rate limited?
6. Apakah auth client pool exhausted?
```

---

# 31. Java 8 sampai Java 25 Notes

## 31.1 Java 8

Pada Java 8, pilihan umum:

- `HttpURLConnection` untuk simple legacy.
- Apache HttpClient 4.x/5.x.
- OkHttp.
- Retrofit.
- Spring `RestTemplate`.

Untuk auth modern, OkHttp/Apache/Retrofit biasanya lebih ergonomis daripada `HttpURLConnection`.

## 31.2 Java 11+

JDK `HttpClient` menjadi opsi standar modern:

- immutable client.
- builder-based.
- sync/async.
- HTTP/1.1 dan HTTP/2.
- authenticator/proxy/cookie/SSLContext support.

Namun tidak punya interceptor abstraction bawaan seperti OkHttp. Untuk production auth, buat wrapper/factory.

## 31.3 Java 21+

Virtual threads membuat blocking client lebih scalable untuk banyak use case.

Namun virtual threads tidak menghapus kebutuhan:

- timeout.
- connection pool.
- auth refresh lock.
- retry budget.
- rate limit.
- error taxonomy.

Virtual threads membuat waiting lebih murah, bukan dependency lebih reliable.

## 31.4 Java 25

Java 25 mempertahankan JDK `HttpClient` sebagai API utama di modul `java.net.http`. Desain production tetap sama: reusable immutable client, explicit request construction, timeout, SSL/auth/proxy/cookie configuration, dan wrapper untuk cross-cutting concern seperti auth.

---

# 32. Decision Matrix

| Scenario | Recommended Pattern |
|---|---|
| Simple internal API key | Interceptor/header decorator + redaction |
| OAuth2 client credentials | Token provider + cache + single-flight refresh + bearer interceptor |
| User token relay | Explicit per-request auth context; avoid global token |
| HMAC signing | Canonical request builder + deterministic signer + replay protection |
| mTLS service-to-service | SSLContext/keystore + identity mapping + cert rotation |
| Legacy Basic Auth | Central credential provider; HTTPS only; rotation plan |
| Retrofit client | OkHttp interceptor/authenticator for most auth cases |
| JDK HttpClient | Request factory or client wrapper |
| Multi-tenant API | Auth context per tenant; isolated credential cache |
| High compliance system | Strong redaction, audit, secret rotation, scoped tokens, auth metrics |

---

# 33. Top 1% Heuristics

Engineer biasa menulis:

```java
.header("Authorization", "Bearer " + token)
```

Engineer kuat bertanya:

```text
Token ini milik siapa?
Scope-nya apa?
Dari mana diperoleh?
Kapan expired?
Siapa yang refresh?
Apakah refresh single-flight?
Apakah token endpoint punya timeout sendiri?
Apakah 401 retry bounded?
Apakah POST retry aman?
Apakah credential bisa bocor via log/redirect/proxy?
Apakah failure auth dibedakan dari failure transport?
Apakah metric bisa menunjukkan auth server sedang bermasalah?
Apakah rotation bisa dilakukan tanpa downtime?
```

Top-tier HTTP client authentication bukan soal menghafal library API. Intinya adalah menjaga invariant berikut:

```text
A request must carry the right credential,
for the right identity,
with the right scope,
to the right destination,
through a secure channel,
without leaking secret,
with bounded retry/refresh behavior,
and with observable failure semantics.
```

---

# 34. Ringkasan Part 10

Pada part ini kita membahas:

1. Authentication vs authorization vs identity.
2. Basic Auth.
3. Bearer token.
4. OAuth2 client credentials.
5. Token cache dan safe expiry.
6. Single-flight token refresh.
7. Refresh setelah 401.
8. API key.
9. HMAC signed request.
10. mTLS sebagai authentication.
11. Cookie/session auth.
12. Auth placement: per-call, interceptor, wrapper, SDK.
13. Redirect/proxy credential leakage.
14. Secret management.
15. Logging dan redaction.
16. Metrics dan observability.
17. Error taxonomy.
18. Concurrency hazards.
19. Timeout khusus auth.
20. Idempotency interaction.
21. Retrofit/JDK/Apache patterns.
22. Testing strategy.
23. Production readiness checklist.
24. Java 8–25 notes.
25. Top 1% heuristics.

---

# 35. Referensi

- Oracle Java SE 25 Documentation — `java.net.http.HttpClient`.
- Oracle Java SE Documentation — `HttpRequest.Builder`.
- OkHttp Documentation — Interceptors.
- OkHttp Documentation — Authenticator.
- Retrofit Documentation — Introduction and service interface model.
- RFC 6749 — The OAuth 2.0 Authorization Framework.
- RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage.

---

# 36. Status Series

Part ini adalah:

```text
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
```

Status:

```text
Belum selesai.
```

Part berikutnya:

```text
Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
File: 11-retry-engineering-idempotency-backoff-jitter-budget-hedging.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 9 — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning](./09-tls-mtls-truststore-keystore-alpn-certificate-pinning.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging](./11-retry-engineering-idempotency-backoff-jitter-budget-hedging.md)
