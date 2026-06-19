# learn-java-authentication-modes-and-patterns-part-009

# Part 9 — API Key Authentication

> Seri: Java Authentication Modes and Patterns  
> Target: Java 8–25, advanced engineering, production-grade authentication design  
> Posisi: setelah taxonomy, password/session/container/Jakarta/Spring/context propagation; sebelum HMAC request signing, JWT, OAuth2/OIDC, mTLS, dan workload identity.

---

## 0. Ringkasan Eksekutif

API key authentication adalah salah satu bentuk authentication paling sederhana sekaligus paling sering disalahdesain.

Secara mental model, **API key adalah bearer credential**: siapa pun yang membawa key dianggap sebagai client yang sah. Tidak ada proof-of-possession bawaan, tidak ada cryptographic challenge-response bawaan, dan tidak ada binding bawaan ke request tertentu. Karena itu API key harus diperlakukan seperti **password untuk aplikasi/client**, bukan seperti identifier publik.

Namun API key juga bukan password user. API key sebaiknya digunakan untuk **client/application authentication**, bukan sebagai primary authentication untuk human user. OWASP API Security Top 10 2023 secara eksplisit menempatkan broken authentication sebagai risiko besar API, dan catatan OWASP menyatakan API key tidak seharusnya digunakan untuk user authentication, melainkan untuk API client authentication.

Part ini membahas API key dari sudut pandang engineer Java yang harus mendesain sistem nyata:

- bagaimana API key dibuat,
- bagaimana key disimpan tanpa menyimpan plaintext,
- mengapa perlu prefix dan key id,
- bagaimana validasi dilakukan dengan aman dan efisien,
- bagaimana key dibatasi scope/tenant/environment,
- bagaimana rotasi dan revoke tanpa downtime,
- bagaimana API key masuk ke Spring Security/Jakarta/Servlet,
- bagaimana API key berinteraksi dengan rate limit, audit, observability, dan incident response,
- kapan API key cukup,
- kapan harus naik ke HMAC, mTLS, OAuth2 client credentials, private key JWT, atau workload identity.

---

## 1. Problem yang Diselesaikan API Key

API key biasanya muncul ketika sistem membutuhkan jawaban atas pertanyaan:

> “Apakah caller ini adalah client aplikasi yang kita kenal?”

Bukan:

> “Apakah manusia ini adalah Fajar?”

Bukan juga:

> “Apakah service ini benar-benar memegang private key tertentu?”

API key menyelesaikan masalah **client recognition** dan **basic access gating**.

Contoh:

1. Partner A mengakses API `/v1/orders`.
2. Internal scheduler memanggil API housekeeping.
3. Backend service lama memanggil API reporting.
4. Third-party developer memakai sandbox API.
5. Aplikasi mobile versi tertentu memanggil endpoint publik.
6. Monitoring agent mengirim metric ke collector.
7. Webhook sender menandai dirinya sebagai integrasi yang terdaftar.

Namun API key **tidak otomatis menyelesaikan**:

1. end-user authentication,
2. strong non-repudiation,
3. replay prevention,
4. message integrity,
5. request-level proof,
6. delegated authorization,
7. per-user consent,
8. phishing resistance,
9. secure browser login,
10. trust antar-service yang sangat sensitif.

Maka API key adalah alat yang valid, tetapi hanya untuk problem yang tepat.

---

## 2. Mental Model Utama

### 2.1 API Key adalah Bearer Secret

API key bekerja seperti ini:

```text
Client sends secret
Server checks secret
If secret matches active record, caller is accepted
```

Jika key bocor, attacker dapat menggunakannya tanpa perlu bukti tambahan.

Itu berarti:

```text
Possession of key == authentication success
```

Konsekuensi desain:

1. API key harus dikirim hanya lewat TLS.
2. API key tidak boleh muncul di URL query string.
3. API key tidak boleh ditulis mentah di log.
4. API key harus bisa dicabut.
5. API key harus bisa dirotasi.
6. API key harus punya scope.
7. API key harus punya owner.
8. API key harus punya audit trail.
9. API key harus punya rate limit.
10. API key harus punya blast radius terbatas.

OWASP REST Security Cheat Sheet menegaskan bahwa endpoint REST harus memakai HTTPS untuk melindungi credential seperti password, API key, dan JWT saat transit.

---

### 2.2 API Key Bukan Identity Lengkap

API key biasanya membuktikan identitas **client**, bukan identitas **human user**.

```text
API key identity:
  client_id = partner-alpha
  environment = production
  tenant = agency-a
  scopes = read:orders, write:orders
```

Ini berbeda dari user identity:

```text
User identity:
  user_id = 12345
  username = fajar
  auth_time = 2026-06-19T10:00:00Z
  mfa = true
  roles = case_officer, reviewer
```

Kesalahan desain umum:

```text
X-API-Key: key-of-admin-user
```

Lalu aplikasi menganggap semua request dari key itu sebagai admin user.

Ini berbahaya karena:

1. tidak ada user session,
2. tidak ada user consent,
3. tidak ada MFA,
4. tidak ada individual accountability,
5. sulit revoke per user,
6. sulit audit siapa manusia sebenarnya,
7. satu key bisa menjadi superuser permanen.

Rule awal:

> API key mengautentikasi aplikasi/client. User authentication harus memakai mekanisme user-oriented seperti session, OIDC, SAML, passwordless, atau delegated token.

---

### 2.3 API Key Adalah Credential Lifecycle, Bukan Header Saja

Implementasi buruk biasanya hanya seperti ini:

```java
if (request.getHeader("X-API-Key").equals(configuredKey)) {
    allow();
}
```

Implementasi production harus berpikir seperti lifecycle:

```text
request
  -> extract key
  -> reject malformed key
  -> parse prefix/key id
  -> lookup candidate key record
  -> hash supplied secret
  -> constant-time compare
  -> check status
  -> check expiration
  -> check tenant/environment/client binding
  -> check scope
  -> check route/method permission
  -> check rate limit/quota
  -> establish principal
  -> audit decision
  -> continue request
```

API key bukan cuma “nilai string”. API key adalah objek domain.

---

## 3. Istilah Penting

### 3.1 API Key

Secret yang dikirim client untuk membuktikan bahwa client tersebut dikenal server.

Contoh bentuk:

```text
ak_live_01JZ7R6MXZ3F4R8VQW4H9P2A7K_uZ8y...secret...
```

### 3.2 Key ID

Identifier non-secret untuk menemukan record key.

Contoh:

```text
key_id = 01JZ7R6MXZ3F4R8VQW4H9P2A7K
```

### 3.3 Prefix

Bagian awal yang membantu klasifikasi, UX, support, dan log aman.

Contoh:

```text
ak_live_01JZ7R6M...
ak_test_01JZ7R6M...
partner_live_...
svc_prod_...
```

Prefix tidak boleh dianggap sebagai secret.

### 3.4 Secret Portion

Bagian random yang benar-benar rahasia.

### 3.5 Key Hash

Hash server-side dari secret/API key yang disimpan di database. Server sebaiknya tidak menyimpan API key plaintext.

### 3.6 Scope

Batas kemampuan key.

Contoh:

```text
read:case
write:case-note
submit:application
read:report
```

### 3.7 Owner

Entitas yang bertanggung jawab atas key.

Bisa berupa:

1. partner organization,
2. tenant,
3. internal service,
4. developer account,
5. integration,
6. system job,
7. environment.

### 3.8 Rotation

Proses mengganti key lama dengan key baru tanpa downtime.

### 3.9 Revocation

Proses mencabut key sehingga tidak bisa dipakai lagi.

### 3.10 Last Used Metadata

Informasi kapan key terakhir dipakai, dari IP mana, user agent apa, route apa, dan hasilnya apa.

---

## 4. Bentuk API Key yang Baik

### 4.1 Bentuk Minimal yang Tidak Ideal

```text
f848d9c4-f73a-4f31-a496-1e2b3a93f27a
```

Masalah:

1. tidak ada environment marker,
2. tidak ada key id jelas,
3. sulit dibedakan di log,
4. raw UUID v4 hanya sekitar 122 bit entropy — bisa cukup untuk banyak kasus, tapi formatnya kurang kaya untuk operasi,
5. tidak ada checksum/version,
6. sulit user support.

### 4.2 Bentuk Lebih Production-Friendly

```text
ak_live_v1_01JZ7R6MXZ3F4R8VQW4H9P2A7K_zm4czFv9R8x7mB3KpQn2T6yW...
```

Struktur:

```text
ak       = product/type prefix
live     = environment
v1       = key format version
01JZ...  = key id, non-secret
zm4...   = secret random portion
```

Keuntungan:

1. routing lookup lebih cepat,
2. support bisa mengidentifikasi key tanpa melihat secret penuh,
3. log dapat menyimpan prefix/key id saja,
4. format bisa divalidasi sebelum akses database,
5. bisa mendukung migrasi format v1 -> v2,
6. environment mismatch dapat dideteksi cepat.

### 4.3 Apa yang Boleh Ditampilkan Lagi ke User

Saat key dibuat, plaintext secret biasanya hanya ditampilkan sekali.

Setelah itu sistem hanya menampilkan:

```text
Name: Partner Alpha Production Key
Prefix: ak_live_v1_01JZ7R6M...
Created: 2026-06-19 10:15:00
Last used: 2026-06-19 11:01:33
Scopes: read:orders, write:orders
Status: active
```

Jangan pernah menampilkan lagi full API key jika server tidak menyimpan plaintext. Ini desain yang benar.

---

## 5. Entropy dan Generasi Key di Java

### 5.1 Key Harus Random, Bukan Dihasilkan dari Data Bermakna

Jangan membuat API key dari:

```text
base64(username + timestamp)
md5(clientName)
sha256(email)
UUID.nameUUIDFromBytes(...)
```

Ini predictable atau linkable.

Gunakan CSPRNG:

```java
SecureRandom secureRandom = new SecureRandom();
byte[] secret = new byte[32]; // 256-bit random
secureRandom.nextBytes(secret);
String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
```

Untuk Java 8–25, `SecureRandom` tersedia dan menjadi pilihan dasar untuk key generation.

### 5.2 Panjang Secret

Rekomendasi praktis:

```text
Minimum serious API key secret: 128-bit random
Better default: 192-bit atau 256-bit random
Common production default: 32 bytes = 256-bit
```

Kenapa bukan 16 karakter biasa?

Karena entropy tergantung charset dan cara generate.

Contoh:

```text
16 hex chars = 64-bit entropy
32 random bytes base64url = 256-bit entropy
```

Untuk API key production, gunakan secret random besar agar brute force secara praktis tidak masuk akal.

### 5.3 Base64URL Tanpa Padding

Base64URL cocok untuk header karena tidak mengandung karakter `+` dan `/`.

```java
String secret = Base64.getUrlEncoder()
    .withoutPadding()
    .encodeToString(randomBytes);
```

Hindari karakter yang sering rusak saat copy-paste atau masuk config.

---

## 6. Storage Pattern: Jangan Simpan Plaintext API Key

### 6.1 Pattern Buruk

```sql
CREATE TABLE api_key (
  id VARCHAR2(64) PRIMARY KEY,
  key_value VARCHAR2(512) NOT NULL,
  client_id VARCHAR2(128) NOT NULL
);
```

Masalah:

1. database leak langsung menjadi credential leak,
2. admin DB bisa melihat semua key,
3. log query bisa bocor,
4. backup berisi secret plaintext,
5. sulit memenuhi defensibility.

### 6.2 Pattern Lebih Baik

```sql
CREATE TABLE api_key (
  id                  VARCHAR2(64) PRIMARY KEY,
  key_prefix          VARCHAR2(64) NOT NULL,
  key_hash            VARCHAR2(256) NOT NULL,
  hash_algorithm      VARCHAR2(32) NOT NULL,
  client_id           VARCHAR2(128) NOT NULL,
  tenant_id           VARCHAR2(128),
  environment         VARCHAR2(32) NOT NULL,
  status              VARCHAR2(32) NOT NULL,
  scopes              CLOB,
  created_at          TIMESTAMP NOT NULL,
  expires_at          TIMESTAMP,
  revoked_at          TIMESTAMP,
  last_used_at        TIMESTAMP,
  last_used_ip_hash   VARCHAR2(256),
  created_by          VARCHAR2(128),
  rotated_from_key_id VARCHAR2(64)
);
```

Server menyimpan hash, bukan plaintext.

### 6.3 Hash API Key: Fast Hash atau Password Hash?

API key berbeda dari password manusia.

Password manusia biasanya low entropy, maka perlu password hashing lambat seperti bcrypt/Argon2/PBKDF2.

API key seharusnya high entropy, maka hash cepat seperti HMAC-SHA-256 atau SHA-256 dengan pepper server-side bisa cukup, asalkan key benar-benar random dan panjang.

Pattern umum:

```text
stored_hash = HMAC-SHA-256(server_pepper, full_api_key_or_secret_part)
```

Kenapa HMAC dengan pepper?

1. jika database bocor, attacker belum bisa melakukan offline verification tanpa pepper,
2. lookup/verify cepat,
3. cocok untuk high-entropy random token,
4. pepper dapat disimpan di KMS/secret manager.

Namun jika API key Anda pendek, user-chosen, atau human-generated, perlakukan seperti password dan gunakan password hashing lambat. Tapi lebih baik jangan izinkan user memilih API key sendiri.

### 6.4 Lookup dengan Key ID

Agar tidak scan semua key, format key harus menyertakan non-secret key id.

Flow:

```text
1. Parse key id dari API key.
2. Lookup record by key id.
3. Hitung HMAC/hash dari supplied key.
4. Constant-time compare dengan stored hash.
5. Validasi status/scope/tenant/etc.
```

Tanpa key id:

```text
Server harus hash supplied key dan cari hash di index.
```

Itu bisa tetap jalan, tetapi key id memberi lebih banyak fleksibilitas operasional.

---

## 7. Constant-Time Comparison

Jangan membandingkan secret/hash dengan `String.equals` untuk material sensitif.

Gunakan constant-time comparison untuk byte array:

```java
import java.security.MessageDigest;

boolean matches = MessageDigest.isEqual(expectedHashBytes, actualHashBytes);
```

Mental model:

```text
Bad compare:
  stops at first mismatch
  timing may reveal partial information

Constant-time compare:
  compares in a way intended to reduce timing leakage
```

Catatan realistis:

1. timing attack di network API tidak selalu mudah,
2. tetapi menggunakan constant-time compare adalah hygiene murah,
3. hindari membocorkan “key id valid tapi secret salah” lewat error message.

---

## 8. Transport dan Placement

### 8.1 Jangan Kirim API Key di URL

Buruk:

```http
GET /v1/orders?api_key=ak_live_...
```

Risiko:

1. URL masuk access log,
2. URL masuk browser history,
3. URL masuk reverse proxy log,
4. URL masuk referrer header,
5. URL masuk monitoring,
6. URL masuk screenshot/ticket.

### 8.2 Header Lebih Baik

Common pattern:

```http
Authorization: ApiKey ak_live_v1_...
```

Atau:

```http
X-API-Key: ak_live_v1_...
```

`Authorization` lebih semantically tepat, tetapi `X-API-Key` sering dipakai di partner integration karena sederhana.

Yang penting:

1. jangan log full header,
2. hanya lewat HTTPS,
3. jangan kirim ke domain yang tidak perlu,
4. jangan expose ke browser JavaScript jika tidak perlu.

### 8.3 Body Tidak Ideal

```json
{
  "apiKey": "ak_live_..."
}
```

Masalah:

1. body sering masuk debug log,
2. body parsing terjadi lebih lambat,
3. authentication sebaiknya dilakukan sebelum business body diproses,
4. risk meningkat pada error reporting.

### 8.4 Cookies untuk API Key?

Biasanya tidak disarankan.

Jika API key disimpan di cookie, maka ia mulai menyerupai session credential dan terkena masalah browser:

1. CSRF,
2. cookie scope,
3. SameSite,
4. cross-origin behavior,
5. session fixation.

Untuk browser user, gunakan session/OIDC/BFF, bukan API key di cookie.

---

## 9. Domain Model API Key

API key record idealnya tidak hanya berisi secret hash.

Contoh domain:

```java
public final class ApiKeyRecord {
    private final String keyId;
    private final String keyPrefix;
    private final byte[] keyHash;
    private final String hashAlgorithm;
    private final String clientId;
    private final String tenantId;
    private final Environment environment;
    private final KeyStatus status;
    private final Set<String> scopes;
    private final Instant createdAt;
    private final Instant expiresAt;
    private final Instant revokedAt;
    private final Instant lastUsedAt;
    private final String createdBy;
}
```

Important fields:

| Field | Purpose |
|---|---|
| `keyId` | lookup non-secret |
| `keyPrefix` | display/log/support |
| `keyHash` | verification |
| `hashAlgorithm` | migration |
| `clientId` | principal identity |
| `tenantId` | tenant binding |
| `environment` | live/test/prod separation |
| `status` | active/revoked/expired/suspended |
| `scopes` | least privilege |
| `expiresAt` | lifecycle limit |
| `lastUsedAt` | operational visibility |
| `createdBy` | audit accountability |

---

## 10. Authentication Flow

### 10.1 High-Level Flow

```text
HTTP request
  |
  v
Extract API key from header
  |
  v
Validate format
  |
  v
Parse key id / prefix / environment / version
  |
  v
Lookup key record
  |
  v
Hash supplied key using configured algorithm/pepper
  |
  v
Constant-time compare
  |
  v
Check active status and expiry
  |
  v
Check tenant/environment binding
  |
  v
Build authenticated principal
  |
  v
Attach authentication context
  |
  v
Authorize scope/resource/method
  |
  v
Business handler
```

### 10.2 Pseudocode

```java
public ApiKeyAuthenticationResult authenticate(String rawHeader) {
    ApiKeyToken token = parser.parse(rawHeader)
        .orElseThrow(() -> invalid("Malformed API key"));

    ApiKeyRecord record = repository.findById(token.keyId())
        .orElseThrow(() -> invalid("Invalid API key"));

    byte[] actualHash = hasher.hash(token.fullPresentedKey(), record.hashAlgorithm());

    if (!MessageDigest.isEqual(record.keyHash(), actualHash)) {
        throw invalid("Invalid API key");
    }

    if (!record.isActive(clock.instant())) {
        throw invalid("Invalid API key");
    }

    return ApiKeyAuthenticationResult.authenticated(
        new ApiClientPrincipal(record.clientId(), record.tenantId(), record.scopes())
    );
}
```

Notice:

```text
External error: Invalid API key
Internal reason: malformed / not found / hash mismatch / revoked / expired
```

Jangan bocorkan detail ke caller.

---

## 11. Java Implementation Building Blocks

### 11.1 SecureRandom Key Generation

```java
import java.security.SecureRandom;
import java.util.Base64;

public final class ApiKeyGenerator {
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    public GeneratedApiKey generate(String environment, String keyId) {
        byte[] secretBytes = new byte[32];
        SECURE_RANDOM.nextBytes(secretBytes);

        String secret = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(secretBytes);

        String fullKey = "ak_" + environment + "_v1_" + keyId + "_" + secret;
        String displayPrefix = "ak_" + environment + "_v1_" + keyId;

        return new GeneratedApiKey(keyId, displayPrefix, fullKey);
    }
}
```

### 11.2 HMAC-SHA-256 Hashing

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

public final class ApiKeyHasher {
    private final byte[] pepper;

    public ApiKeyHasher(byte[] pepper) {
        this.pepper = pepper.clone();
    }

    public byte[] hmacSha256(String presentedKey) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(pepper, "HmacSHA256"));
            return mac.doFinal(presentedKey.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to hash API key", e);
        }
    }
}
```

Works from Java 8 onward.

### 11.3 Constant-Time Compare

```java
import java.security.MessageDigest;

public boolean matches(byte[] expected, byte[] actual) {
    return MessageDigest.isEqual(expected, actual);
}
```

### 11.4 Avoid `String` for Secrets?

In Java, HTTP headers arrive as `String`, and many APIs operate with `String`. You cannot perfectly avoid `String` for API key handling in web apps.

But you can reduce exposure:

1. keep raw key local to authentication component,
2. never store raw key in domain object after validation,
3. never put raw key into exception message,
4. never log raw key,
5. never attach raw key to MDC,
6. never return raw key from repository,
7. never keep plaintext in database.

---

## 12. Spring Security Integration Pattern

### 12.1 Where API Key Fits

In Spring Security, API key authentication is usually a custom authentication mechanism:

```text
SecurityFilterChain
  -> ApiKeyAuthenticationFilter
      -> ApiKeyAuthenticationManager/Provider
          -> ApiKeyService/Repository
      -> SecurityContext populated
  -> AuthorizationFilter
  -> Controller
```

### 12.2 Custom Authentication Token

```java
public final class ApiKeyAuthenticationToken extends AbstractAuthenticationToken {
    private final Object principal;
    private final String presentedKey;

    public static ApiKeyAuthenticationToken unauthenticated(String presentedKey) {
        return new ApiKeyAuthenticationToken(null, presentedKey, false, List.of());
    }

    public static ApiKeyAuthenticationToken authenticated(
            ApiClientPrincipal principal,
            Collection<? extends GrantedAuthority> authorities) {
        return new ApiKeyAuthenticationToken(principal, null, true, authorities);
    }

    private ApiKeyAuthenticationToken(
            Object principal,
            String presentedKey,
            boolean authenticated,
            Collection<? extends GrantedAuthority> authorities) {
        super(authorities);
        this.principal = principal;
        this.presentedKey = presentedKey;
        super.setAuthenticated(authenticated);
    }

    @Override
    public Object getCredentials() {
        return presentedKey;
    }

    @Override
    public Object getPrincipal() {
        return principal;
    }
}
```

### 12.3 Authentication Provider

```java
public final class ApiKeyAuthenticationProvider implements AuthenticationProvider {
    private final ApiKeyAuthenticator authenticator;

    public ApiKeyAuthenticationProvider(ApiKeyAuthenticator authenticator) {
        this.authenticator = authenticator;
    }

    @Override
    public Authentication authenticate(Authentication authentication) {
        String presentedKey = (String) authentication.getCredentials();
        ApiClientPrincipal principal = authenticator.authenticate(presentedKey);

        Collection<GrantedAuthority> authorities = principal.scopes().stream()
            .map(scope -> new SimpleGrantedAuthority("SCOPE_" + scope))
            .toList();

        return ApiKeyAuthenticationToken.authenticated(principal, authorities);
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return ApiKeyAuthenticationToken.class.isAssignableFrom(authentication);
    }
}
```

For Java 8 compatibility, replace `.toList()` with `Collectors.toList()`.

### 12.4 Filter

```java
public final class ApiKeyAuthenticationFilter extends OncePerRequestFilter {
    private final AuthenticationManager authenticationManager;

    public ApiKeyAuthenticationFilter(AuthenticationManager authenticationManager) {
        this.authenticationManager = authenticationManager;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String header = request.getHeader("X-API-Key");

        if (header == null || header.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            Authentication result = authenticationManager.authenticate(
                ApiKeyAuthenticationToken.unauthenticated(header)
            );

            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(result);
            SecurityContextHolder.setContext(context);

            filterChain.doFilter(request, response);
        } catch (AuthenticationException ex) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"invalid_api_key\"}");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}
```

### 12.5 Important Spring Security Design Notes

1. Put API key filter before authorization.
2. Do not combine API key principal with user session principal unless explicitly designed.
3. Use different `SecurityFilterChain` for API endpoints if possible.
4. Keep API key endpoints stateless unless there is a specific reason.
5. Do not create HTTP session for API key authentication.
6. Convert scopes to authorities consistently.
7. Avoid putting raw API key into `Authentication#getPrincipal`.
8. Clear context after request.
9. Use proper `AuthenticationEntryPoint` for consistent error response.
10. Test filter ordering.

---

## 13. Jakarta/Servlet Integration Pattern

If not using Spring Security, API key authentication can be implemented as a Servlet `Filter` or Jakarta Security `HttpAuthenticationMechanism`.

### 13.1 Servlet Filter Pattern

```java
public final class ApiKeyServletFilter implements Filter {
    private final ApiKeyAuthenticator authenticator;

    public ApiKeyServletFilter(ApiKeyAuthenticator authenticator) {
        this.authenticator = authenticator;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        String apiKey = httpRequest.getHeader("X-API-Key");

        if (apiKey == null || apiKey.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }

        try {
            ApiClientPrincipal principal = authenticator.authenticate(apiKey);
            HttpServletRequest wrapped = new ApiKeyPrincipalRequestWrapper(httpRequest, principal);
            chain.doFilter(wrapped, response);
        } catch (InvalidApiKeyException e) {
            httpResponse.setStatus(401);
            httpResponse.setContentType("application/json");
            httpResponse.getWriter().write("{\"error\":\"invalid_api_key\"}");
        }
    }
}
```

### 13.2 Request Wrapper

```java
public final class ApiKeyPrincipalRequestWrapper extends HttpServletRequestWrapper {
    private final Principal principal;

    public ApiKeyPrincipalRequestWrapper(HttpServletRequest request, Principal principal) {
        super(request);
        this.principal = principal;
    }

    @Override
    public Principal getUserPrincipal() {
        return principal;
    }
}
```

### 13.3 Limitations

Servlet filter approach is simple but has limitations:

1. role integration may be inconsistent,
2. container-managed security may not know the principal,
3. propagation into Jakarta Security may be incomplete,
4. async processing must be handled carefully,
5. you must define your own authentication/authorization semantics.

For Jakarta EE systems, prefer Jakarta Security integration when portability and container identity matter.

---

## 14. Scope Design

### 14.1 Bad Scope Design

```text
admin
full_access
partner
system
```

Terlalu luas dan ambigu.

### 14.2 Better Scope Design

```text
case:read
case:create
case:update-status
case-note:create
document:upload
report:read
webhook:send
```

Scope sebaiknya:

1. action-oriented,
2. resource-aware,
3. stable,
4. readable,
5. easy to audit,
6. not tied too tightly to endpoint path,
7. not too granular sampai tidak bisa dikelola.

### 14.3 Scope vs Role

Role:

```text
partner_operator
internal_scheduler
reporting_client
```

Scope:

```text
report:read
report:export
```

Role menjelaskan “jenis caller”. Scope menjelaskan “apa yang boleh dilakukan”.

API key sering lebih cocok memakai scope daripada role user tradisional.

### 14.4 Route Mapping

```text
GET /v1/cases/{id}       -> case:read
POST /v1/cases           -> case:create
PATCH /v1/cases/{id}     -> case:update
POST /v1/cases/{id}/note -> case-note:create
```

Authorization layer harus memeriksa:

```text
principal.scopes contains requiredScope
```

Dan tetap perlu object-level authorization:

```text
key tenant == case tenant
```

Scope bukan pengganti tenant/resource boundary.

---

## 15. Tenant Binding

API key tanpa tenant binding rawan cross-tenant access.

### 15.1 Bad Pattern

```text
API key valid -> allow any tenantId in path
```

```http
GET /tenants/agency-a/cases/123
X-API-Key: key-owned-by-agency-b
```

Jika sistem hanya cek key valid dan scope `case:read`, caller agency-b bisa mencoba akses agency-a.

### 15.2 Better Pattern

```text
API key record has tenant_id = agency-b
Request path has tenant_id = agency-a
Decision: reject
```

### 15.3 Tenant Binding Invariant

```text
For tenant-scoped APIs:
  authenticated_api_key.tenant_id must match requested_resource.tenant_id
```

Atau untuk multi-tenant integrator:

```text
key.allowed_tenants contains requested_resource.tenant_id
```

Tapi multi-tenant key harus dianggap high risk.

---

## 16. Environment Binding

API key harus dipisah per environment.

```text
ak_test_... only works in test/sandbox
ak_live_... only works in production
```

Jangan izinkan test key mengakses production.

Jangan izinkan production key dipakai di local/dev.

Environment binding membantu mencegah:

1. accidental production access,
2. secret copied from prod to staging,
3. test automation hitting live API,
4. partner confusion,
5. incident blast radius melebar.

---

## 17. Rate Limiting dan Quota

API key authentication hampir selalu harus digabung dengan rate limiting.

### 17.1 Kenapa Rate Limit Per API Key

Karena API key adalah identity client.

Rate limit per IP saja tidak cukup:

1. partner bisa berada di NAT,
2. attacker bisa memakai banyak IP,
3. internal service bisa share IP,
4. API gateway bisa menyembunyikan source IP.

### 17.2 Rate Limit Dimensions

```text
by key_id
by client_id
by tenant_id
by route group
by HTTP method
by environment
by source IP range
```

### 17.3 Example Policy

```text
partner-alpha production:
  read endpoints: 1000/min
  write endpoints: 100/min
  export endpoints: 10/hour
  burst: 2x for 30 seconds
```

### 17.4 Authentication Before Rate Limit or Rate Limit Before Authentication?

Both may be needed.

```text
Edge unauthenticated rate limit:
  protects from brute force / random key attempts

Authenticated per-key rate limit:
  protects resource usage and abuse by valid clients
```

Flow:

```text
1. coarse IP/global rate limit
2. parse key id if available
3. per-key failed attempt throttling
4. authenticate
5. per-client quota/rate limit
6. authorize
```

---

## 18. Rotation Strategy

### 18.1 Bad Rotation Model

```text
One active key only
Replace key immediately
Old clients break instantly
```

This causes downtime.

### 18.2 Better Rotation Model

Allow overlapping keys:

```text
old key: active until 2026-07-01
new key: active from 2026-06-19
client deploys new key
observe last_used_at of old key
revoke old key after safe period
```

### 18.3 Rotation States

```text
ACTIVE
PENDING_REVOKE
REVOKED
EXPIRED
SUSPENDED
```

### 18.4 Rotation Flow

```text
1. User creates replacement key.
2. System shows new plaintext key once.
3. Both old and new key are active.
4. Client deploys new key.
5. System shows old key last-used timestamp.
6. Once old key unused for safe window, revoke old key.
```

### 18.5 Emergency Rotation

If key leaked:

```text
1. Suspend/revoke leaked key immediately.
2. Generate replacement key.
3. Notify owner.
4. Review logs for usage since suspected leak time.
5. Check abnormal IP/user-agent/routes.
6. Rotate downstream secrets if chained.
7. Document incident.
```

---

## 19. Revocation and Expiration

### 19.1 Expiration

API keys can be:

```text
non-expiring
fixed expiry
renewable
short-lived
```

Production recommendation:

1. avoid permanent keys for sensitive APIs,
2. use expiry for partner keys,
3. require periodic rotation,
4. use short-lived tokens for high-risk service-to-service cases,
5. keep permanent keys only for low-risk, tightly scoped, strongly monitored integrations.

### 19.2 Revocation

Revocation must be immediate or near-immediate.

If API key validation is cached, revocation can be delayed.

Design options:

```text
No cache:
  strongest revocation, more DB/cache load

Short cache TTL:
  e.g. 30s-5m, balanced

Push invalidation:
  more complex, better immediate revoke

Central introspection:
  similar to opaque token validation
```

### 19.3 Revocation Invariant

```text
A revoked API key must not authenticate after revocation time beyond the documented cache delay.
```

Document the delay.

---

## 20. Caching API Key Validation

### 20.1 Why Cache

API key auth can be on every request. Database lookup per request may be expensive.

Cache candidate:

```text
key_id -> key metadata + hash + status + scopes
```

### 20.2 What Not to Cache

Do not cache raw API key.

### 20.3 TTL

Example:

```text
valid key metadata cache: 60 seconds
invalid key id cache: 5-30 seconds
revoked key cache: 5-30 seconds or push invalidation
```

### 20.4 Cache Risk

Cache introduces stale authorization:

```text
Key revoked at T0
Cache valid until T0 + 60s
Key still works for up to 60s
```

This may be acceptable if documented. For high-risk APIs, use shorter TTL or active invalidation.

### 20.5 Negative Cache

Negative cache helps protect DB from brute force random key ids.

But be careful:

```text
Attacker guesses key id before key is created
Negative cache stores not found
New key created with same id impossible if ids random and unique
```

Safe enough with random key ids.

---

## 21. Logging and Observability

### 21.1 Never Log Full API Key

Bad:

```text
Invalid API key: ak_live_v1_01JZ...full-secret...
```

Good:

```text
Invalid API key prefix=ak_live_v1_01JZ7R6M reason=hash_mismatch
```

### 21.2 Recommended Audit Event

```json
{
  "event_type": "api_key.authentication",
  "outcome": "success",
  "key_id": "01JZ7R6MXZ3F4R8VQW4H9P2A7K",
  "key_prefix": "ak_live_v1_01JZ7R6M",
  "client_id": "partner-alpha",
  "tenant_id": "agency-a",
  "scopes": ["case:read"],
  "source_ip_hash": "...",
  "user_agent_family": "partner-sdk-java",
  "route": "GET /v1/cases/{id}",
  "request_id": "req-...",
  "timestamp": "2026-06-19T10:00:00Z"
}
```

### 21.3 Failed Authentication Event

```json
{
  "event_type": "api_key.authentication",
  "outcome": "failure",
  "reason": "invalid_key",
  "parsed_key_id": "01JZ7R6MXZ3F4R8VQW4H9P2A7K",
  "source_ip_hash": "...",
  "route": "GET /v1/cases/{id}",
  "request_id": "req-...",
  "timestamp": "2026-06-19T10:00:00Z"
}
```

External response remains generic:

```json
{
  "error": "invalid_api_key"
}
```

### 21.4 Metrics

Useful metrics:

```text
api_key_auth_success_total{client_id, environment}
api_key_auth_failure_total{reason, environment}
api_key_auth_latency_ms
api_key_cache_hit_total
api_key_cache_miss_total
api_key_revoked_usage_total
api_key_scope_denied_total{scope}
api_key_rate_limited_total{client_id}
api_key_last_used_lag_seconds
```

Do not put full key in labels. Labels can explode cardinality and leak secrets.

---

## 22. Error Response Design

### 22.1 Authentication Failure

Use `401 Unauthorized` when key is missing or invalid.

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "invalid_api_key"
}
```

### 22.2 Authorization Failure

Use `403 Forbidden` when key is valid but lacks permission.

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "insufficient_scope"
}
```

### 22.3 Rate Limit

Use `429 Too Many Requests`.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "error": "rate_limited"
}
```

### 22.4 Do Not Leak Internal Reason

Avoid:

```json
{
  "error": "api key exists but has wrong secret"
}
```

Avoid:

```json
{
  "error": "key revoked at 2026-06-19T10:00Z"
}
```

Return generic to caller, log precise internally.

---

## 23. API Key vs Other Authentication Modes

### 23.1 API Key vs Password

| Aspect | API Key | Password |
|---|---|---|
| Owner | application/client | human user |
| Generated by | server | usually user or password manager |
| Entropy | should be high | often low/medium |
| Storage | HMAC/hash | password hash |
| Rotation | operational | user-driven or policy-driven |
| MFA | not native | can be combined |
| Good for | client authentication | user login |

### 23.2 API Key vs Session

| Aspect | API Key | Session |
|---|---|---|
| State | long-lived credential | server-side continuity |
| Browser safe | usually no | yes if cookie hardened |
| Revocation | key-level | session-level |
| User identity | not ideal | yes |
| Typical client | machine/partner | browser user |

### 23.3 API Key vs HMAC Signing

| Aspect | API Key | HMAC Signing |
|---|---|---|
| Proof | bearer secret | request signature |
| Replay defense | not built-in | timestamp/nonce possible |
| Integrity | relies on TLS | signs request components |
| Complexity | low | medium/high |
| Best for | simple API access | partner/high-integrity API |

### 23.4 API Key vs OAuth2 Client Credentials

| Aspect | API Key | OAuth2 Client Credentials |
|---|---|---|
| Token issuer | application itself | authorization server |
| Credential sent every request | often yes | no, access token sent |
| Scope model | custom | standardized-ish |
| Revocation | custom | AS/token lifecycle |
| Federation | weak | stronger |
| Best for | simple platform/partner API | enterprise service auth |

### 23.5 API Key vs mTLS

| Aspect | API Key | mTLS |
|---|---|---|
| Credential | string secret | private key + certificate |
| Proof | bearer | possession of private key |
| Replay | key can be copied | private key not sent |
| Operational burden | low/medium | medium/high |
| Best for | simple external/internal API | high-trust service/partner auth |

---

## 24. When API Key Is Appropriate

API key is reasonable when:

1. caller is an application/client, not human user,
2. data sensitivity is low to moderate,
3. TLS is mandatory,
4. key has limited scope,
5. key has owner and tenant binding,
6. key can be revoked quickly,
7. key usage is rate-limited,
8. key exposure blast radius is acceptable,
9. integration simplicity matters,
10. audit and monitoring are implemented.

Examples:

```text
Public developer API sandbox
Partner read-only reporting API
Internal low-risk automation endpoint
Webhook receiver identification with additional validation
Metrics ingestion with strict rate limits
```

---

## 25. When API Key Is Not Enough

Do not rely only on API key when:

1. request integrity must be proven,
2. replay must be prevented,
3. user delegation/consent is required,
4. end-user identity is required,
5. high-value financial/regulatory transaction is performed,
6. credential theft impact is severe,
7. partner has many sub-users requiring accountability,
8. zero trust workload identity is required,
9. private network is not enough assurance,
10. non-repudiation matters.

Use stronger alternatives:

| Need | Better Mode |
|---|---|
| request integrity | HMAC signing |
| user login | session/OIDC/SAML/passkey |
| service identity | OAuth2 client credentials / mTLS / workload identity |
| high assurance partner | mTLS + signed requests |
| delegated access | OAuth2/OIDC |
| short-lived access | token issuance model |
| key not sent every request | HMAC/mTLS/OAuth2 |

---

## 26. Webhook Authentication with API Keys

Webhook authentication is often mis-modeled.

### 26.1 Bad Webhook Pattern

```http
POST /webhooks/payment
X-API-Key: shared-key
```

This only proves the sender knows the key. It does not prove body integrity if TLS terminates somewhere unexpected, and it does not prevent replay.

### 26.2 Better Webhook Pattern

Use signed payload:

```http
X-Webhook-Timestamp: 1781844000
X-Webhook-Signature: hmac-sha256=...
```

API key may identify integration, but HMAC signs the body.

```text
API key -> identify sender
HMAC signature -> prove message integrity and freshness
```

Part 10 will cover this deeply.

---

## 27. Gateway and Reverse Proxy Integration

API key validation is often done at API gateway.

### 27.1 Gateway Validation Pattern

```text
Client
  -> API Gateway validates API key
  -> Gateway injects identity headers
  -> Backend trusts gateway
```

Example injected headers:

```http
X-Authenticated-Client-Id: partner-alpha
X-Authenticated-Tenant-Id: agency-a
X-Authenticated-Scopes: case:read,case:create
```

### 27.2 Risk: Header Spoofing

If backend is reachable directly, attacker can send:

```http
X-Authenticated-Client-Id: partner-alpha
```

Mitigations:

1. backend only reachable from gateway network,
2. strip inbound identity headers at gateway before injecting,
3. use mTLS between gateway and backend,
4. backend verifies gateway identity,
5. use signed internal headers or token exchange for high-risk systems.

### 27.3 Gateway Is Not a Magic Boundary

If gateway authenticates and backend authorizes, both must agree on:

1. principal format,
2. scope semantics,
3. tenant semantics,
4. route mapping,
5. failure behavior,
6. logging correlation.

---

## 28. Multi-Key and Multi-Client Design

### 28.1 One Key Per Integration Purpose

Bad:

```text
partner-alpha uses one key for everything
```

Better:

```text
partner-alpha-reporting-prod
partner-alpha-case-submission-prod
partner-alpha-sandbox
partner-alpha-webhook-signing
```

Why:

1. least privilege,
2. easier rotation,
3. clearer audit,
4. smaller blast radius,
5. better rate limit isolation.

### 28.2 Naming Matters

Store key name/description:

```text
name = "Partner Alpha production case submission"
description = "Used by Partner Alpha middleware cluster prod-east"
owner_email = "partner-alpha-api-ops@example.com"
```

Operations becomes easier when incident happens.

---

## 29. Database Schema Example

### 29.1 PostgreSQL Example

```sql
CREATE TABLE api_keys (
    key_id              varchar(64) PRIMARY KEY,
    key_prefix          varchar(128) NOT NULL UNIQUE,
    key_hash            bytea NOT NULL,
    hash_algorithm      varchar(64) NOT NULL,
    client_id           varchar(128) NOT NULL,
    tenant_id           varchar(128),
    environment         varchar(32) NOT NULL,
    status              varchar(32) NOT NULL,
    scopes_json         jsonb NOT NULL,
    created_at          timestamptz NOT NULL,
    expires_at          timestamptz,
    revoked_at          timestamptz,
    last_used_at        timestamptz,
    created_by          varchar(128),
    rotated_from_key_id varchar(64),
    version             bigint NOT NULL DEFAULT 0
);

CREATE INDEX idx_api_keys_client_id ON api_keys(client_id);
CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at);
```

### 29.2 Oracle Example

```sql
CREATE TABLE API_KEYS (
    KEY_ID              VARCHAR2(64) PRIMARY KEY,
    KEY_PREFIX          VARCHAR2(128) NOT NULL UNIQUE,
    KEY_HASH            RAW(32) NOT NULL,
    HASH_ALGORITHM      VARCHAR2(64) NOT NULL,
    CLIENT_ID           VARCHAR2(128) NOT NULL,
    TENANT_ID           VARCHAR2(128),
    ENVIRONMENT         VARCHAR2(32) NOT NULL,
    STATUS              VARCHAR2(32) NOT NULL,
    SCOPES_JSON         CLOB NOT NULL,
    CREATED_AT          TIMESTAMP NOT NULL,
    EXPIRES_AT          TIMESTAMP,
    REVOKED_AT          TIMESTAMP,
    LAST_USED_AT        TIMESTAMP,
    CREATED_BY          VARCHAR2(128),
    ROTATED_FROM_KEY_ID VARCHAR2(64),
    VERSION             NUMBER DEFAULT 0 NOT NULL
);

CREATE INDEX IDX_API_KEYS_CLIENT_ID ON API_KEYS(CLIENT_ID);
CREATE INDEX IDX_API_KEYS_TENANT_ID ON API_KEYS(TENANT_ID);
CREATE INDEX IDX_API_KEYS_STATUS ON API_KEYS(STATUS);
CREATE INDEX IDX_API_KEYS_EXPIRES_AT ON API_KEYS(EXPIRES_AT);
```

### 29.3 Avoid Updating `last_used_at` Every Request Synchronously

Updating `last_used_at` on every request can create write amplification.

Better:

1. update at most every N minutes,
2. batch asynchronously,
3. write usage event to queue/stream,
4. maintain approximate last-used cache,
5. separate hot auth path from audit ingestion.

Example policy:

```text
Only update last_used_at if previous value older than 5 minutes.
```

---

## 30. Performance Considerations

### 30.1 Hot Path Costs

API key authentication cost includes:

1. header extraction,
2. parsing,
3. key record lookup,
4. HMAC/hash,
5. constant-time compare,
6. status/scope validation,
7. rate limit check,
8. audit/metrics.

### 30.2 Avoid Expensive Work Before Authentication

Do not parse huge request body before key validation.

Flow should be:

```text
coarse edge limit -> authenticate -> authorize -> body parse -> business logic
```

### 30.3 Hash Cost

HMAC-SHA-256 on a small string is cheap.

DB/network/cache lookup is usually more expensive.

### 30.4 Cache Carefully

Cache gives speed, but affects revocation. Tune TTL based on security need.

---

## 31. Failure Modes

### 31.1 Key Leakage

Cause:

1. logged header,
2. committed to Git,
3. pasted in ticket,
4. exposed in frontend JavaScript,
5. stored in mobile app binary,
6. sent in URL,
7. leaked via monitoring/APM,
8. shared across teams.

Mitigation:

1. secret scanning,
2. log redaction,
3. one-time display,
4. rotation,
5. scope restriction,
6. rate limits,
7. anomaly detection.

### 31.2 Key Reuse Across Environments

Cause:

```text
same key used for dev, staging, prod
```

Impact:

1. lower environment leak compromises prod,
2. testing can mutate production,
3. audit confusion.

Mitigation:

```text
environment prefix + environment binding + separate secret stores
```

### 31.3 Overprivileged Key

Cause:

```text
scope = *
```

Mitigation:

1. least privilege,
2. approval workflow for privileged scopes,
3. separate key per purpose,
4. periodic access review.

### 31.4 No Revocation Path

Cause:

```text
key hardcoded in config only
```

Mitigation:

1. database-backed key registry,
2. status field,
3. cache invalidation,
4. operational UI/API.

### 31.5 Missing Object-Level Authorization

Cause:

```text
valid key + scope = allow all objects
```

Mitigation:

```text
resource.tenant_id must match principal.tenant_id
```

### 31.6 Raw Key in Metrics Label

Cause:

```text
api_key_auth_success_total{api_key="ak_live_..."}
```

Impact:

1. secret leakage,
2. cardinality explosion,
3. monitoring cost spike.

Mitigation:

```text
Use key_id/client_id, never raw key.
```

### 31.7 Header Spoofing Behind Gateway

Cause:

Backend trusts identity headers from any caller.

Mitigation:

1. strip inbound headers,
2. restrict network path,
3. mTLS gateway-backend,
4. signed internal headers.

---

## 32. Threat Model

### 32.1 Assets

1. API key secret.
2. Key hash and pepper.
3. Key registry.
4. Scope mapping.
5. Tenant mapping.
6. Audit logs.
7. Rate limit state.

### 32.2 Attackers

1. external internet attacker,
2. malicious partner developer,
3. compromised partner system,
4. internal operator with log access,
5. developer with database read access,
6. CI/CD leak path,
7. attacker with old backup.

### 32.3 Attack Paths

| Attack | Example | Defense |
|---|---|---|
| brute force | random key attempts | high entropy, rate limit |
| key leak | log/ticket/Git | redaction, scanning, rotation |
| replay | reuse captured key | TLS, HMAC for high-risk |
| cross-tenant | valid key accesses other tenant | tenant binding |
| privilege abuse | overbroad scope | least privilege |
| stale key | forgotten old integration | expiry, last-used review |
| DB leak | key hashes stolen | HMAC pepper, no plaintext |
| gateway bypass | direct backend call | network/mTLS/header stripping |

---

## 33. Operational Workflows

### 33.1 Create Key

```text
Input:
  client_id
  tenant_id
  environment
  scopes
  expiry
  name

Process:
  generate random key
  hash key
  store metadata
  show plaintext once
  audit creation
```

### 33.2 Rotate Key

```text
Input:
  existing key id
  desired overlap window

Process:
  create replacement key
  link rotated_from_key_id
  keep both active
  monitor old last_used_at
  revoke old after cutover
```

### 33.3 Revoke Key

```text
Input:
  key id
  reason

Process:
  set status revoked
  set revoked_at
  invalidate cache
  audit revocation
  alert owner if needed
```

### 33.4 Review Key

```text
Check:
  owner still valid?
  scopes still needed?
  last used recently?
  expiry acceptable?
  source IP expected?
  abnormal usage?
```

### 33.5 Incident Response

```text
1. Identify leaked key id/prefix.
2. Revoke or suspend immediately.
3. Generate replacement if required.
4. Search audit logs since suspected exposure.
5. Identify routes/resources accessed.
6. Notify stakeholders.
7. Rotate related credentials.
8. Add detection/prevention control.
9. Document root cause.
```

---

## 34. Governance and Access Review

API key systems degrade over time unless reviewed.

Review dimensions:

1. keys older than policy,
2. keys unused for 90/180 days,
3. keys without owner,
4. keys with wildcard scope,
5. keys without expiry,
6. keys used from new geography/IP range,
7. keys used outside expected time window,
8. keys with privileged write/export scopes,
9. keys created by departed employees,
10. keys shared by multiple systems.

Example policy:

```text
Production API keys:
  must have owner
  must have scopes
  must have environment binding
  must be reviewed every 90 days
  must rotate at least every 180 days for privileged access
  must not be shared across integrations
```

---

## 35. API Key in Java 8–25 Context

### 35.1 Java 8

Available:

1. `SecureRandom`,
2. `Base64`,
3. `Mac`,
4. `MessageDigest.isEqual`,
5. Servlet 3.x/4.x depending runtime,
6. Spring Security 4/5 depending app.

Java 8 can build solid API key auth if design is correct.

### 35.2 Java 11–17

Better platform baseline:

1. improved TLS defaults over time,
2. HTTP Client from Java 11 for client-side integration,
3. better container/runtime ecosystem,
4. modern Spring Boot/Security compatibility depending version.

### 35.3 Java 21

Useful for modern services:

1. virtual threads for request handling in some stacks,
2. stronger modern runtime ecosystem,
3. easier concurrency model but still must handle security context carefully.

### 35.4 Java 25

Relevant direction:

1. modern Java platform includes virtual threads and structured concurrency direction,
2. newer crypto/key handling features in JDK evolution may help broader authentication systems,
3. API key core still uses stable primitives: CSPRNG, HMAC, constant-time compare.

API key auth does not require newest Java, but Java 21/25 affects surrounding architecture: concurrency, context propagation, observability, deployment, and library compatibility.

---

## 36. Production-Grade Reference Architecture

```text
                 +----------------+
Client           | Partner System |
                 +-------+--------+
                         |
                         | HTTPS
                         v
              +----------+-----------+
              | API Gateway / Edge   |
              | - TLS termination    |
              | - coarse rate limit  |
              | - header redaction   |
              +----------+-----------+
                         |
                         v
              +----------+-----------+
              | Java API Service     |
              | ApiKeyAuthFilter     |
              | ApiKeyAuthenticator  |
              | Scope Authorizer     |
              +----+-----------+-----+
                   |           |
                   |           v
                   |    +------+------+
                   |    | Redis Cache |
                   |    | key metadata|
                   |    +------+------+
                   |           |
                   v           v
          +--------+-----------+--------+
          | API Key Registry DB         |
          | key_id, hash, scopes, owner |
          +--------+-----------+--------+
                   |
                   v
          +--------+-----------+
          | Audit/Event Stream |
          +--------------------+
```

Key points:

1. TLS required at edge.
2. Full key redacted at edge and app logs.
3. Auth service validates key by hash.
4. Cache accelerates metadata lookup.
5. DB is source of truth.
6. Audit event emitted.
7. Authorization checks scope and tenant.
8. Rate limit uses key/client/tenant identity.
9. Revocation invalidates cache.
10. Operations can create/rotate/revoke keys.

---

## 37. Design Checklist

### 37.1 Credential Design

- [ ] Is key generated by server using CSPRNG?
- [ ] Is secret at least 128-bit entropy, preferably 256-bit?
- [ ] Is key format versioned?
- [ ] Does key include non-secret key id?
- [ ] Does key include environment marker?
- [ ] Is full plaintext shown only once?
- [ ] Is full key never logged?

### 37.2 Storage

- [ ] Is plaintext key absent from DB?
- [ ] Is hash/HMAC stored instead?
- [ ] Is pepper stored outside DB?
- [ ] Is hash algorithm versioned?
- [ ] Are backups protected?

### 37.3 Validation

- [ ] Is key parsed before lookup?
- [ ] Is malformed key rejected early?
- [ ] Is constant-time comparison used?
- [ ] Are errors generic externally?
- [ ] Are detailed failure reasons logged internally?

### 37.4 Scope and Tenant

- [ ] Does key have explicit scopes?
- [ ] Are wildcard scopes avoided?
- [ ] Is tenant binding enforced?
- [ ] Is environment binding enforced?
- [ ] Is object-level authorization separate from authentication?

### 37.5 Operations

- [ ] Can key be revoked immediately?
- [ ] Can key be rotated with overlap?
- [ ] Is last-used tracked?
- [ ] Are unused keys reviewed?
- [ ] Are owners tracked?

### 37.6 Security Controls

- [ ] Is HTTPS mandatory?
- [ ] Are URL query keys rejected?
- [ ] Are logs redacted?
- [ ] Is rate limiting per key/client?
- [ ] Is brute force throttled?
- [ ] Is secret scanning enabled?

### 37.7 Observability

- [ ] Are success/failure events emitted?
- [ ] Are metrics low-cardinality?
- [ ] Is request correlation available?
- [ ] Can incident response reconstruct key usage?

---

## 38. Common Mistakes

### Mistake 1 — Treating API Key as User Login

Wrong:

```text
API key == admin user
```

Better:

```text
API key == client application identity
User identity must come from user auth mechanism if needed
```

### Mistake 2 — Storing Plaintext Keys

Wrong:

```sql
api_key_value = 'ak_live_full_secret'
```

Better:

```sql
key_hash = HMAC_SHA256(pepper, full_key)
```

### Mistake 3 — No Scope

Wrong:

```text
valid key can call anything
```

Better:

```text
valid key only grants scoped capabilities
```

### Mistake 4 — No Tenant Check

Wrong:

```text
scope case:read allows all cases
```

Better:

```text
scope case:read + tenant match + object policy
```

### Mistake 5 — Key in Query Param

Wrong:

```http
GET /api?key=...
```

Better:

```http
Authorization: ApiKey ...
```

### Mistake 6 — One Shared Key for All Partners

Wrong:

```text
all partners use same key
```

Better:

```text
one key per partner/environment/purpose
```

### Mistake 7 — No Rotation Design

Wrong:

```text
replace key instantly and hope clients update
```

Better:

```text
overlapping active keys + last-used monitoring
```

### Mistake 8 — Raw Key in MDC

Wrong:

```java
MDC.put("apiKey", rawKey);
```

Better:

```java
MDC.put("apiKeyId", keyId);
MDC.put("clientId", clientId);
```

### Mistake 9 — Trusting Gateway Headers from Public Network

Wrong:

```text
backend trusts X-Client-Id from anyone
```

Better:

```text
backend reachable only from gateway + strip/re-inject headers + mTLS
```

### Mistake 10 — API Key for High-Risk Request Integrity

Wrong:

```text
API key alone protects payment webhook
```

Better:

```text
API key identifies integration; HMAC/mTLS proves request integrity/possession
```

---

## 39. Design Questions

Use these questions before choosing API key authentication:

1. Is the caller a human user, application, service, device, or partner?
2. Does the system need end-user accountability?
3. Is bearer credential acceptable?
4. What happens if the key leaks?
5. What is the blast radius?
6. Can the key be revoked immediately?
7. Can the key be rotated without downtime?
8. Does the key have tenant binding?
9. Does the key have environment binding?
10. Does the key have explicit scopes?
11. Is object-level authorization enforced separately?
12. Are failed attempts throttled?
13. Is the key ever logged?
14. Is the key ever sent in URL?
15. Is HTTPS mandatory?
16. Is gateway validation enough, or must backend validate too?
17. Is request replay a problem?
18. Is request body integrity a problem?
19. Should this be HMAC, mTLS, or OAuth2 client credentials instead?
20. Can audit reconstruct who used which key, when, from where, and for what?

---

## 40. Mini Case Study: Partner Case Submission API

### 40.1 Requirements

```text
Partner submits case applications to regulatory platform.
Each partner belongs to one agency tenant.
Partner can create applications and read submission status.
Partner cannot read other tenants' cases.
API is server-to-server.
No human end-user login needed in this API.
```

### 40.2 Candidate Authentication

API key is acceptable if:

1. only partner system identity is needed,
2. request integrity beyond TLS is not required,
3. each partner has separate key,
4. key is scoped,
5. tenant binding is enforced,
6. rate limit is present,
7. audit is strong.

If submissions are high-value and replay/integrity matters, add HMAC signing or mTLS.

### 40.3 Key Record

```text
key_id: 01JZ7R6MXZ3F4R8VQW4H9P2A7K
client_id: partner-alpha
Tenant: agency-a
Environment: production
Scopes:
  application:create
  application-status:read
Expiry: 2026-12-31
Status: active
```

### 40.4 Request

```http
POST /v1/tenants/agency-a/applications
Authorization: ApiKey ak_live_v1_01JZ7R6MXZ3F4R8VQW4H9P2A7K_...
Content-Type: application/json
```

### 40.5 Decision Flow

```text
1. Key valid? yes
2. Key active? yes
3. Key environment == prod? yes
4. Key tenant == agency-a? yes
5. Scope includes application:create? yes
6. Rate limit available? yes
7. Create application
8. Audit event with key_id/client_id/tenant/request_id
```

### 40.6 Cross-Tenant Attack

```http
POST /v1/tenants/agency-b/applications
Authorization: ApiKey key-owned-by-agency-a
```

Decision:

```text
Reject 403 tenant_mismatch
```

External response may still be generic depending policy:

```json
{
  "error": "forbidden"
}
```

Internal audit:

```text
scope ok, tenant mismatch, client partner-alpha attempted agency-b
```

---

## 41. Summary

API key authentication is simple only at the surface. In production, it is a full credential lifecycle system.

The strongest mental model:

```text
API key = bearer secret for client/application authentication
```

Therefore:

1. generate with CSPRNG,
2. use high entropy,
3. never store plaintext,
4. hash/HMAC with server-side pepper,
5. include non-secret key id/prefix,
6. validate with constant-time compare,
7. bind to client/tenant/environment,
8. enforce scope and object-level authorization,
9. protect with TLS,
10. avoid URL/query placement,
11. redact logs,
12. support rotation and revocation,
13. rate-limit per key/client,
14. audit usage,
15. choose stronger mechanisms when bearer secret is insufficient.

API key is appropriate for simple application/client authentication. It is not a replacement for user login, OAuth/OIDC, mTLS, HMAC signing, or workload identity when those are the actual requirement.

---

## 42. Referensi Resmi dan Relevan

1. OWASP API Security Top 10 2023 — terutama API2:2023 Broken Authentication dan guidance bahwa API keys sebaiknya untuk API client authentication, bukan user authentication.
2. OWASP REST Security Cheat Sheet — HTTPS untuk melindungi credential seperti passwords, API keys, dan JWT in transit.
3. OWASP Secrets Management Cheat Sheet — lifecycle secret: storage, provisioning, auditing, rotation, management.
4. OWASP Authentication Cheat Sheet — general authentication control, error handling, and protection guidance.
5. NIST SP 800-63B — authenticator lifecycle, revocation, and assurance framing.
6. Spring Security Reference — authentication architecture, `SecurityContextHolder`, `Authentication`, `AuthenticationManager`, `AuthenticationProvider`, and filter-chain model.
7. Java Cryptography Architecture APIs — `SecureRandom`, `Mac`, `MessageDigest`, `Base64`.

---

## 43. Status Series

Part ini adalah **Part 9** dari maksimal 35 part.

Yang sudah selesai:

1. Part 0 — Orientation: Mental Model of Authentication in Java Systems
2. Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
3. Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
4. Part 3 — Password Authentication Done Properly
5. Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
6. Part 5 — Servlet Container Authentication
7. Part 6 — Jakarta Security and Jakarta Authentication Deep Dive
8. Part 7 — Spring Security Authentication Architecture
9. Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads
10. Part 9 — API Key Authentication

Series **belum selesai**.

Berikutnya:

**Part 10 — HMAC Request Signing**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-008.md">⬅️ Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-010.md">Part 10 — HMAC Request Signing ➡️</a>
</div>
