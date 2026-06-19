# learn-java-authentication-modes-and-patterns-part-012

# Part 12 — Opaque Token Authentication and Token Introspection

> Seri: **Java Authentication Modes and Patterns**  
> Range Java: **Java 8 sampai Java 25**  
> Fokus: **opaque access token, token introspection, revocation-aware resource server, cache strategy, availability trade-off, dan production design pattern**

---

## 0. Posisi Part Ini dalam Series

Pada Part 11 kita membahas **JWT Authentication**: token yang membawa klaim di dalam dirinya sendiri dan bisa divalidasi secara lokal oleh resource server melalui signature, issuer, audience, expiry, dan aturan klaim lain.

Part ini membahas sisi berlawanan yang sangat penting di sistem enterprise: **opaque token**.

Opaque token adalah token yang bagi resource server terlihat seperti string acak. Resource server tidak boleh menebak isi token, tidak boleh men-decode token, dan tidak boleh mengambil keputusan authorization hanya dari bentuk token. Untuk mengetahui apakah token valid, aktif, milik siapa, memiliki scope apa, dan kapan berakhir, resource server biasanya harus bertanya ke **authorization server** melalui mekanisme **token introspection**.

Mental model paling sederhana:

```text
JWT:
  Resource server validates the token locally.
  Token carries claims.
  Revocation is harder unless short-lived or checked centrally.

Opaque token:
  Resource server asks authorization server.
  Token is a reference/key to server-side token state.
  Revocation and central control are easier.
```

Namun pembagian ini tidak absolut. Ada sistem yang memakai JWT tetapi tetap melakukan introspection. Ada sistem yang memakai opaque token dengan cache panjang. Ada sistem yang memberi token eksternal sebagai opaque tetapi menyimpan internal representation dalam bentuk JWT setelah token exchange. Top 1% engineer tidak berhenti pada “JWT vs opaque”, tetapi membaca trade-off: **latency, revocation, blast radius, privacy, observability, coupling, dan failure mode**.

---

## 1. Problem yang Diselesaikan

Opaque token dan introspection menyelesaikan beberapa masalah nyata yang sulit jika hanya mengandalkan self-contained token seperti JWT.

### 1.1 Masalah Revocation

Dalam banyak sistem, token perlu bisa dicabut sebelum expiry:

- user logout,
- admin disable account,
- user resign,
- device hilang,
- partner API key compromised,
- refresh token reuse terdeteksi,
- suspicious login,
- role/scope dicabut,
- tenant suspended,
- client application dinonaktifkan,
- incident response setelah token leak.

Jika access token berbentuk JWT dengan expiry 15 menit dan resource server hanya validasi lokal, maka pencabutan token biasanya tidak langsung efektif sampai token kedaluwarsa, kecuali resource server memeriksa denylist/introspection/state tambahan.

Opaque token mengizinkan authorization server menjadi sumber kebenaran aktif:

```text
Request arrives with token T
Resource server asks authorization server:
  Is T active?
  Who is the subject?
  What client issued it?
  What scopes?
  What audience?
  What expiry?
  Was it revoked?
```

### 1.2 Masalah Claim Freshness

Pada JWT, klaim berada di token. Jika role user berubah setelah token diterbitkan, JWT lama tetap membawa role lama sampai expiry.

Opaque token memungkinkan resource server mengambil metadata terkini atau setidaknya metadata yang dikontrol authorization server:

- user disabled,
- account locked,
- scope changed,
- consent revoked,
- tenant blocked,
- session terminated,
- risk score changed.

Namun ini bergantung pada implementasi authorization server. Tidak semua introspection response harus selalu menghitung ulang semua klaim secara real-time. Kadang introspection hanya mengembalikan metadata token yang sudah disimpan saat issuance.

### 1.3 Masalah Privacy dan Token Exposure

JWT membawa klaim yang bisa dibaca siapa pun yang memegang token, meskipun signature tidak bisa dipalsukan. Banyak engineer salah mengira JWT terenkripsi. JWS JWT hanya **signed**, bukan encrypted.

Opaque token tidak membocorkan klaim ke client atau intermediary karena token hanyalah reference string.

Ini berguna ketika klaim sensitif:

- internal user ID,
- tenant ID,
- agency ID,
- role detail,
- compliance marker,
- entitlement,
- organization hierarchy,
- risk flag,
- authentication method,
- session reference.

### 1.4 Masalah Centralized Policy

Opaque token cocok saat resource server harus tunduk pada policy terpusat:

- all token checks must go through IdP,
- security team wants immediate revocation,
- audit requires central visibility,
- policy changes must apply fast,
- resource server count is large,
- token metadata should not be distributed to every service.

### 1.5 Masalah Partner/External API

Untuk API eksternal, opaque token bisa mengurangi coupling. Partner tidak perlu tahu format token. Authorization server bisa mengubah internal format token tanpa mengubah kontrak publik.

```text
External contract:
  Authorization: Bearer <opaque-string>

Internal authorization server implementation may change:
  v1: database token table
  v2: Redis token store
  v3: encrypted handle
  v4: short opaque handle mapped to JWT metadata
```

---

## 2. Mental Model

### 2.1 Opaque Token sebagai Handle, Bukan Dokumen

JWT adalah seperti dokumen yang ditandatangani. Opaque token adalah seperti nomor tiket.

```text
JWT:
  "Here is the signed document. Verify the signature and read the claims."

Opaque token:
  "Here is a ticket number. Ask the issuer whether this ticket is valid."
```

Konsekuensinya:

| Aspek | JWT | Opaque Token |
|---|---|---|
| Validasi | Lokal | Remote/introspection |
| Isi token | Terbaca jika JWS | Tidak bermakna bagi resource server |
| Revocation cepat | Sulit tanpa state tambahan | Lebih natural |
| Latency per request | Rendah | Lebih tinggi jika tidak cache |
| Dependency runtime ke auth server | Rendah | Tinggi |
| Privacy klaim | Lebih rendah | Lebih baik |
| Operational coupling | Key distribution | Introspection endpoint availability |
| Debugging | Bisa inspect klaim | Harus introspect/log metadata |

### 2.2 Introspection sebagai Read Model Token State

Token introspection adalah query dari protected resource/resource server ke authorization server untuk mengetahui status token.

Model konseptual:

```text
Resource Server
  receives access token
  authenticates itself to Authorization Server
  calls introspection endpoint
  receives token metadata
  builds local Authentication/Principal
  enforces authorization
```

Bukan client/browser yang melakukan introspection. Resource server-lah yang melakukan introspection karena introspection endpoint biasanya memerlukan client authentication dan dapat mengembalikan metadata sensitif.

### 2.3 Active Flag adalah Gate Pertama, Bukan Satu-Satunya Gate

RFC 7662 mendefinisikan response dengan field penting `active`. Namun top 1% engineer tidak berhenti pada `active == true`.

Setelah `active: true`, resource server tetap harus mengevaluasi:

- issuer benar,
- audience/resource cocok,
- client ID sesuai policy,
- subject ada dan valid,
- scope cukup,
- expiry belum lewat,
- token type sesuai,
- tenant cocok,
- token tidak dipakai untuk resource yang salah,
- authentication strength cukup untuk action tertentu.

Pola buruk:

```java
if (introspection.active()) {
    allow();
}
```

Pola benar:

```java
if (!introspection.active()) deny();
if (!issuerTrusted(introspection.issuer())) deny();
if (!audienceMatchesThisApi(introspection.audience())) deny();
if (!hasRequiredScope(introspection.scope(), request)) deny();
if (!tenantMatchesRoute(introspection.tenant(), request)) deny();
allowWithPrincipal(buildPrincipal(introspection));
```

### 2.4 Opaque Token Memindahkan Kompleksitas, Bukan Menghilangkannya

Opaque token membuat token lebih sederhana bagi resource server, tetapi memindahkan kompleksitas ke:

- authorization server,
- introspection endpoint,
- token store,
- cache invalidation,
- service authentication ke introspection endpoint,
- observability,
- availability strategy,
- latency budget,
- incident handling.

Jadi pertanyaan arsitektur bukan “opaque lebih aman?” tetapi:

```text
Apakah sistem ini membutuhkan central revocation/control lebih dari local validation performance?
```

---

## 3. Core Concepts

### 3.1 Access Token

Access token adalah credential yang digunakan client untuk mengakses resource server. Dalam OAuth2, access token bukan identitas user murni. Ia adalah authorization artifact yang mewakili izin tertentu dalam konteks tertentu.

Resource server harus memperlakukan access token sebagai bearer credential kecuali ada proof-of-possession tambahan.

### 3.2 Opaque Access Token

Opaque access token adalah token yang format dan isinya tidak diketahui resource server.

Contoh bentuk:

```text
2YotnFZFEjr1zCsicMWpAA
8xLOxBtZp8
atk_2s93kLS0aAQpD7M3jwd9...
```

Resource server tidak boleh melakukan:

```text
split token by dot
base64 decode
assume prefix means role
extract user ID from token string
infer expiry from token length
```

Opaque berarti kontrak validasinya bukan parsing lokal, tetapi otoritas eksternal.

### 3.3 Introspection Endpoint

Introspection endpoint adalah endpoint authorization server yang menerima token dan mengembalikan metadata status token.

Contoh konseptual request:

```http
POST /oauth2/introspect HTTP/1.1
Host: auth.example.com
Authorization: Basic <resource-server-client-auth>
Content-Type: application/x-www-form-urlencoded

token=2YotnFZFEjr1zCsicMWpAA&token_type_hint=access_token
```

Contoh response aktif:

```json
{
  "active": true,
  "scope": "case:read case:update",
  "client_id": "case-web-bff",
  "username": "fajar",
  "sub": "user-123",
  "aud": "case-api",
  "iss": "https://auth.example.com",
  "exp": 1760000000,
  "iat": 1759996400,
  "tenant_id": "agency-a"
}
```

Contoh response tidak aktif:

```json
{
  "active": false
}
```

### 3.4 Token Store

Opaque token biasanya membutuhkan token store atau state lookup.

Pilihan token store:

1. database relational,
2. Redis/distributed cache,
3. authorization server internal persistent store,
4. encrypted token handle,
5. hybrid reference token + metadata cache,
6. revocation list only,
7. session-backed token.

### 3.5 Resource Server

Resource server adalah service/API yang menerima access token. Dalam Java, resource server bisa berupa:

- Spring Boot REST API,
- Jakarta REST/JAX-RS application,
- Servlet application,
- Quarkus service,
- Micronaut service,
- gateway/filter service,
- GraphQL API,
- gRPC service dengan metadata bearer,
- internal batch endpoint.

### 3.6 Authorization Server

Authorization server menerbitkan token dan menyediakan introspection endpoint. Contoh produk/implementasi:

- Keycloak,
- Spring Authorization Server,
- Okta,
- Auth0,
- Microsoft Entra ID,
- Ping Identity,
- ForgeRock,
- custom authorization server.

### 3.7 Token Metadata

Metadata token bisa mencakup:

- `active`,
- `scope`,
- `client_id`,
- `sub`,
- `username`,
- `token_type`,
- `exp`,
- `iat`,
- `nbf`,
- `aud`,
- `iss`,
- `jti`,
- `tenant_id`,
- `session_id`,
- `amr`,
- `acr`,
- custom attributes.

Namun resource server harus memperlakukan custom attributes dengan disiplin schema. Jangan membuat setiap service menafsirkan metadata berbeda-beda.

---

## 4. OAuth2 Token Introspection According to RFC 7662

RFC 7662 mendefinisikan mekanisme bagi protected resource untuk bertanya kepada authorization server tentang active state token dan metadata token.

### 4.1 Request Format

Introspection request memakai HTTP POST dengan form parameters.

Parameter utama:

```text
token
  Required. Token yang ingin diperiksa.

token_type_hint
  Optional. Hint seperti access_token atau refresh_token.
```

`token_type_hint` hanyalah hint. Authorization server tidak boleh bergantung sepenuhnya pada hint karena caller bisa salah atau malicious.

### 4.2 Authentication ke Introspection Endpoint

Resource server biasanya harus authenticate ke introspection endpoint.

Metode client authentication bisa berupa:

- client secret basic,
- client secret post,
- private key JWT,
- mTLS client authentication,
- platform-specific workload identity,
- signed request.

Poin penting: introspection endpoint adalah endpoint sensitif. Kalau endpoint ini bisa dipanggil bebas, attacker bisa melakukan token oracle, metadata harvesting, atau validitas probing.

### 4.3 Response Format

Field wajib praktis yang paling penting adalah:

```json
{
  "active": true
}
```

Jika token tidak aktif, response biasanya hanya:

```json
{
  "active": false
}
```

Ini menghindari kebocoran informasi tentang token yang invalid, expired, unknown, atau revoked.

### 4.4 Active Does Not Mean Authorized

`active: true` berarti token dikenali dan masih aktif menurut authorization server. Itu belum otomatis berarti request boleh mengakses endpoint tertentu.

Resource server tetap harus melakukan authorization lokal:

```text
Authentication:
  Is this token valid and active?

Authorization:
  Is this active token allowed to perform this operation on this resource?
```

### 4.5 Token Type Hint

Contoh:

```http
token_type_hint=access_token
```

Gunanya membantu authorization server mencari token di store yang tepat. Namun resource server tidak boleh menganggap hint sebagai security boundary.

---

## 5. Opaque Token vs JWT: Deeper Decision Model

### 5.1 Jangan Membuat Perbandingan Dangkal

Perbandingan dangkal biasanya seperti ini:

```text
JWT cepat, opaque aman.
```

Ini terlalu simplistik.

JWT bisa sangat aman jika:

- token short-lived,
- issuer/audience divalidasi ketat,
- key rotation benar,
- no sensitive claim,
- no long-lived access token,
- revocation requirement rendah,
- resource server harus offline/local validate.

Opaque token bisa buruk jika:

- introspection endpoint lambat,
- cache terlalu panjang,
- fail-open saat auth server down,
- metadata tidak divalidasi,
- token store tidak durable,
- introspection credential bocor,
- semua service bergantung ke single auth server tanpa resilience.

### 5.2 Decision Axis

Gunakan axis berikut.

#### Axis 1 — Revocation Requirement

```text
Need immediate revocation?
  Strong opaque/introspection candidate.

Can tolerate 5-15 minute expiry window?
  Short-lived JWT may be enough.
```

#### Axis 2 — Latency Budget

```text
Every request must be <20ms end-to-end?
  Remote introspection per request may be too expensive.

API calls already cross network boundaries and can cache introspection result?
  Opaque token is feasible.
```

#### Axis 3 — Authorization Server Availability

```text
Auth server downtime should not affect existing API traffic?
  JWT local validation gives better decoupling.

Security policy requires central deny when auth server unavailable?
  Opaque with fail-closed may be required.
```

#### Axis 4 — Claim Privacy

```text
Token visible to browser/mobile/partner/intermediary?
Sensitive claims?
  Opaque token reduces exposure.
```

#### Axis 5 — Resource Server Count

```text
Many resource servers, many languages, hard to distribute keys/policies?
  Opaque token centralizes validation.

Few services, mature platform, strong JWKS handling?
  JWT is manageable.
```

#### Axis 6 — Trust Domain

```text
Inside same platform trust domain?
  JWT may be acceptable.

Across external partner boundary?
  Opaque token often gives better contract stability.
```

### 5.3 Hybrid Pattern

Banyak sistem enterprise memakai hybrid:

```text
External token to API gateway:
  opaque token
  gateway introspects

Internal token to microservices:
  short-lived JWT or token exchange result
```

Atau:

```text
User access token:
  opaque

Service-to-service token:
  JWT with mTLS-bound or private_key_jwt-issued credential
```

Atau:

```text
JWT accepted by resource server
but introspection/denylist checked for high-risk operation
```

Top 1% engineer tidak memaksakan satu format token untuk semua use case.

---

## 6. Java 8–25 Relevance

### 6.1 Java 8 Baseline

Java 8 masih banyak dipakai di enterprise legacy. Untuk opaque token introspection, Java 8 biasanya memakai:

- Apache HttpClient,
- OkHttp,
- Spring `RestTemplate`,
- JAX-RS Client,
- custom servlet filter,
- Spring Security 5.x,
- Jackson/Gson untuk JSON parsing,
- `javax.net.ssl` untuk TLS.

Keterbatasan umum:

- tidak ada built-in modern `HttpClient`,
- lebih banyak dependency external,
- TLS/cipher default bisa lebih tua,
- context propagation masih thread-pool centric,
- banyak aplikasi masih `javax.*` bukan `jakarta.*`.

### 6.2 Java 11+

Java 11 memperkenalkan `java.net.http.HttpClient` sebagai HTTP client standard. Ini berguna untuk introspection client sederhana tanpa library tambahan.

Contoh mental model:

```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(introspectionUri))
    .header("Authorization", basicAuth(clientId, clientSecret))
    .header("Content-Type", "application/x-www-form-urlencoded")
    .POST(HttpRequest.BodyPublishers.ofString("token=" + URLEncoder.encode(token, StandardCharsets.UTF_8)))
    .build();
```

Namun production code tetap perlu:

- timeout,
- retry policy yang hati-hati,
- connection pooling behavior,
- metrics,
- circuit breaker,
- TLS config,
- JSON schema validation,
- error handling.

### 6.3 Java 17/21 LTS

Java 17/21 menjadi baseline modern untuk banyak aplikasi Spring Boot 3/Jakarta EE 10/11.

Relevansi:

- stronger TLS defaults,
- modern GC,
- records untuk DTO introspection response,
- sealed classes untuk result modeling,
- pattern matching untuk cleaner control flow,
- virtual threads di Java 21 untuk blocking IO use cases,
- better observability via JFR.

### 6.4 Java 21 Virtual Threads

Introspection adalah remote IO. Virtual threads dapat membuat blocking introspection client lebih scalable dalam model synchronous servlet/service.

Tetapi virtual threads tidak menghilangkan:

- authorization server bottleneck,
- network latency,
- rate limit,
- cache need,
- failure handling,
- circuit breaker need.

Virtual threads membantu resource server menunggu IO secara murah, bukan membuat introspection endpoint lebih cepat.

### 6.5 Java 25 Context

Java 25 membawa ekosistem Java modern yang makin matang untuk concurrency, cryptographic object handling, dan key material management. Untuk opaque token, relevansi utamanya bukan format token, tetapi:

- client credential handling,
- mTLS/private key authentication ke introspection endpoint,
- context propagation,
- structured concurrency,
- observability,
- secure key loading.

---

## 7. Architecture Pattern

### 7.1 Basic Opaque Token Flow

```text
+--------+        +-----------------+        +----------------------+
| Client | -----> | Resource Server | -----> | Authorization Server |
|        | token  |                 | intros | /introspect          |
+--------+        +-----------------+        +----------------------+
                         |
                         v
                   Build Principal
                         |
                         v
                   Authorize Request
```

Step-by-step:

1. Client mendapatkan access token dari authorization server.
2. Client memanggil resource server dengan `Authorization: Bearer <token>`.
3. Resource server mengambil token dari header.
4. Resource server memanggil introspection endpoint menggunakan credential resource server.
5. Authorization server mengembalikan `active` dan metadata.
6. Resource server membangun local principal/authentication object.
7. Resource server mengecek scope/audience/tenant/policy.
8. Request dilanjutkan atau ditolak.

### 7.2 Resource Server with Introspection Cache

```text
Request 1 token T:
  cache miss
  introspect T
  active true
  cache metadata until min(exp, configuredTTL)

Request 2 token T:
  cache hit
  skip remote introspection
  enforce authorization from cached metadata
```

Cache menurunkan latency dan load, tetapi memperbesar revocation window.

```text
No cache:
  revocation fast
  latency high
  auth server dependency high

Long cache:
  latency low
  revocation delayed
  stale metadata risk

Short cache:
  balanced
  still not immediate revocation
```

### 7.3 Gateway Introspection Pattern

```text
Client -> API Gateway -> Internal Services
             |
             v
       Introspection
```

Gateway melakukan introspection sekali, lalu meneruskan identitas ke internal service.

Masalahnya: bagaimana internal service mempercayai gateway?

Pilihan:

1. Gateway inject signed internal JWT.
2. Gateway performs token exchange.
3. Gateway passes original token and internal services introspect again.
4. Gateway injects headers only over mTLS-protected internal network.

Pola buruk:

```text
Gateway introspects token
Gateway sends X-User-Id header
Internal service blindly trusts X-User-Id from any caller
```

Pola lebih baik:

```text
Gateway introspects token
Gateway creates short-lived signed internal assertion
Internal service validates issuer/audience/signature
```

### 7.4 BFF Pattern with Opaque Token

Browser tidak menyimpan access token. Browser menyimpan session cookie ke BFF. BFF menyimpan atau mengambil token server-side.

```text
Browser -> BFF session cookie -> BFF -> Resource API with opaque token
                                      -> introspection at API or gateway
```

Keuntungan:

- token tidak terekspos ke browser JS,
- cookie bisa `HttpOnly`,
- BFF bisa mengatur refresh/lifecycle,
- API tetap menerima token standard.

### 7.5 Token Exchange Pattern

External opaque token bisa ditukar menjadi internal token dengan audience spesifik.

```text
External Client
  -> API Gateway with external opaque token
  -> introspection
  -> token exchange
  -> internal JWT/opaque token with aud=target-service
  -> downstream service
```

Ini mengurangi token replay ke service lain karena token internal audience-bound.

### 7.6 High-Security Pattern: Opaque Token + mTLS

Untuk partner/API sensitif:

```text
Client authenticates with mTLS to token endpoint
Authorization server issues opaque access token bound to certificate
Resource server receives token over TLS
Resource server introspects token
Resource server checks certificate binding or gateway-provided proof
```

Ini mengubah token dari pure bearer menuju proof-of-possession pattern, tergantung detail implementasi.

---

## 8. Implementation Pattern in Java

### 8.1 Spring Security Resource Server Opaque Token

Spring Security memiliki dukungan OAuth2 Resource Server untuk opaque token.

Konfigurasi konseptual:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        opaque-token:
          introspection-uri: https://auth.example.com/oauth2/introspect
          client-id: case-api
          client-secret: ${INTROSPECTION_CLIENT_SECRET}
```

Konfigurasi Java konseptual:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health").permitAll()
            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2
            .opaqueToken(Customizer.withDefaults()))
        .build();
}
```

Mental model flow:

```text
BearerTokenAuthenticationFilter
  extracts bearer token
OpaqueTokenAuthenticationProvider
  calls OpaqueTokenIntrospector
  returns Authentication
SecurityContextHolder
  stores Authentication for request
Authorization rules
  evaluate authorities/scopes
```

### 8.2 Custom `OpaqueTokenIntrospector`

Sering kali default introspector tidak cukup karena enterprise membutuhkan:

- tenant validation,
- custom scope mapping,
- authority normalization,
- custom claim schema,
- introspection caching,
- metrics,
- error mapping,
- denylist check,
- audience validation.

Contoh konseptual:

```java
@Component
public final class PolicyAwareOpaqueTokenIntrospector implements OpaqueTokenIntrospector {

    private final OpaqueTokenIntrospector delegate;
    private final TokenPolicy tokenPolicy;

    public PolicyAwareOpaqueTokenIntrospector(
            @Value("${security.oauth2.resourceserver.opaque-token.introspection-uri}") String uri,
            @Value("${security.oauth2.resourceserver.opaque-token.client-id}") String clientId,
            @Value("${security.oauth2.resourceserver.opaque-token.client-secret}") String clientSecret,
            TokenPolicy tokenPolicy
    ) {
        this.delegate = new NimbusOpaqueTokenIntrospector(uri, clientId, clientSecret);
        this.tokenPolicy = tokenPolicy;
    }

    @Override
    public OAuth2AuthenticatedPrincipal introspect(String token) {
        OAuth2AuthenticatedPrincipal principal = delegate.introspect(token);

        tokenPolicy.requireActivePrincipal(principal);
        tokenPolicy.requireAudience(principal, "case-api");
        tokenPolicy.requireTrustedIssuer(principal);
        tokenPolicy.requireTenantConsistency(principal);

        Map<String, Object> attributes = new LinkedHashMap<>(principal.getAttributes());
        Collection<GrantedAuthority> authorities = mapAuthorities(attributes);

        return new DefaultOAuth2AuthenticatedPrincipal(
                principal.getName(),
                attributes,
                authorities
        );
    }
}
```

Poin penting: custom introspector adalah tempat bagus untuk authentication-level validation, bukan business authorization detail.

### 8.3 Authority Mapping

Spring biasanya memetakan scope ke authority seperti:

```text
SCOPE_case:read
SCOPE_case:update
```

Namun enterprise sering punya struktur lebih kompleks:

```text
scope: case:read case:update
roles: CASE_OFFICER, CASE_MANAGER
permissions: CASE_APPROVE, CASE_ASSIGN
agency: CEA
unit: ENFORCEMENT
```

Jangan campur semua menjadi string authority tanpa model.

Pattern lebih baik:

```text
Authentication Principal:
  subjectId
  clientId
  tenantId
  scopes
  roles
  authTime
  tokenId
  sessionId

Authorization layer:
  maps endpoint/action/resource to required permission
```

### 8.4 Java HTTP Client Introspection Skeleton

Untuk non-Spring atau Jakarta/JAX-RS service, kita bisa membuat introspection client sendiri.

Contoh Java 11+ konseptual:

```java
public final class IntrospectionClient {
    private final HttpClient httpClient;
    private final URI endpoint;
    private final String basicAuthorization;
    private final ObjectMapper objectMapper;

    public IntrospectionClient(URI endpoint, String clientId, String clientSecret, ObjectMapper objectMapper) {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
        this.endpoint = endpoint;
        this.basicAuthorization = basic(clientId, clientSecret);
        this.objectMapper = objectMapper;
    }

    public IntrospectionResult introspect(String token) throws IOException, InterruptedException {
        String body = "token=" + URLEncoder.encode(token, StandardCharsets.UTF_8)
                + "&token_type_hint=access_token";

        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(3))
                .header("Authorization", basicAuthorization)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 200) {
            return objectMapper.readValue(response.body(), IntrospectionResult.class);
        }

        if (response.statusCode() == 401 || response.statusCode() == 403) {
            throw new IntrospectionClientAuthenticationException("Resource server introspection credential rejected");
        }

        throw new IntrospectionUnavailableException("Introspection endpoint returned " + response.statusCode());
    }

    private static String basic(String clientId, String clientSecret) {
        String raw = clientId + ":" + clientSecret;
        return "Basic " + Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }
}
```

Production hardening:

- do not log token,
- configure TLS trust,
- use secret manager,
- set connect/read timeout,
- set max response size,
- validate JSON fields,
- map errors carefully,
- emit metrics,
- cache active result carefully,
- cache inactive result very carefully or not at all,
- avoid retry storms.

### 8.5 Jakarta Filter Pattern

Untuk Servlet/Jakarta app tanpa Spring Security:

```java
public final class OpaqueTokenAuthenticationFilter implements Filter {
    private final IntrospectionService introspectionService;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest http = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        String token = bearerToken(http.getHeader("Authorization"));
        if (token == null) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        IntrospectionResult result;
        try {
            result = introspectionService.introspect(token);
        } catch (IntrospectionUnavailableException e) {
            res.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            return;
        }

        if (!result.active()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        Principal principal = new TokenPrincipal(result.subject(), result.attributes());
        HttpServletRequest wrapped = new PrincipalAwareRequestWrapper(http, principal, result.roles());
        chain.doFilter(wrapped, response);
    }
}
```

Catatan: implementasi manual harus sangat hati-hati agar tidak bertabrakan dengan container-managed security atau framework security lain.

---

## 9. Cache Strategy

### 9.1 Mengapa Cache Diperlukan

Tanpa cache, setiap request API menjadi minimal dua request:

```text
client -> resource server
resource server -> authorization server introspection
```

Dampak:

- latency naik,
- auth server load tinggi,
- auth server menjadi bottleneck,
- risiko cascading failure,
- biaya network meningkat,
- request spike menjadi introspection spike.

### 9.2 Cache Key

Cache key biasanya token itu sendiri atau hash token.

Jangan menyimpan raw token sebagai key di cache/log yang mudah dilihat.

Lebih baik:

```text
cacheKey = SHA-256(token)
```

Namun ingat: jika token entropy rendah, hash token bisa brute-forced. Token harus high entropy.

### 9.3 Cache Value

Cache value bisa berisi:

- active status,
- subject,
- client ID,
- scopes,
- audience,
- expiry,
- tenant,
- mapped authorities,
- introspection timestamp.

Jangan cache metadata yang tidak dibutuhkan.

### 9.4 TTL Calculation

TTL cache tidak boleh melebihi expiry token.

Formula:

```text
cacheTtl = min(
  configuredMaxTtl,
  tokenExp - now - safetySkew
)
```

Contoh:

```text
configuredMaxTtl = 60 seconds
token expires in 300 seconds
cache TTL = 60 seconds

configuredMaxTtl = 60 seconds
token expires in 20 seconds
cache TTL = 15 seconds after skew
```

### 9.5 Revocation Window

Jika cache TTL 60 detik, revocation bisa terlambat sampai 60 detik di resource server yang sudah cache token tersebut.

Pertanyaan production:

```text
Apakah bisnis/security menerima revoked token masih bisa dipakai maksimal 60 detik?
```

Jika tidak, pilih:

- no cache,
- ultra-short cache,
- push revocation event,
- distributed denylist,
- token version check,
- session version check,
- short-lived access token + revocation of refresh/session,
- high-risk operation always re-introspect.

### 9.6 Caching Inactive Token

Caching inactive token bisa mengurangi brute-force/probing load, tetapi berbahaya jika token baru saja diterbitkan dan ada eventual consistency issue di auth server.

Pattern aman:

```text
active token cache:
  short TTL, bounded by exp

inactive token cache:
  very short TTL, e.g. 1-5 seconds, optional
  never cache detailed reason
```

### 9.7 Distributed vs Local Cache

Local cache:

- cepat,
- sederhana,
- tidak perlu network tambahan,
- tetapi revocation propagation per instance berbeda.

Distributed cache:

- shared across instances,
- mengurangi duplicate introspection,
- tetapi menambah dependency Redis/cache,
- token metadata menjadi sensitive data di cache.

### 9.8 Cache Stampede

Jika satu popular token dipakai banyak request dan cache expire bersamaan, semua instance bisa introspect token yang sama secara paralel.

Mitigasi:

- single-flight per token hash,
- jitter TTL,
- request coalescing,
- async refresh,
- bounded concurrency,
- rate limit introspection calls.

### 9.9 Cache Invalidation via Event

Advanced pattern:

```text
Authorization server emits token_revoked event
Resource servers/gateway consume event
Invalidate token hash/session ID/client ID cache entries
```

Tantangan:

- event delivery guarantee,
- ordering,
- missed event recovery,
- idempotency,
- backfill after downtime,
- privacy of token identifiers.

---

## 10. Availability and Failure Semantics

### 10.1 The Hard Question: Fail Open or Fail Closed?

Jika introspection endpoint down, apa yang dilakukan resource server?

```text
Fail closed:
  deny request if token cannot be introspected

Fail open:
  allow request using cached/previously trusted token metadata
```

Untuk authentication, default aman adalah **fail closed**. Tetapi sistem mission-critical kadang membutuhkan mode degradasi terbatas.

### 10.2 Fail Closed

Keuntungan:

- lebih aman,
- token revoked/unknown tidak diterima,
- mudah dijelaskan ke auditor,
- konsisten dengan zero trust.

Kerugian:

- auth server outage menjatuhkan API,
- login/token traffic dan API traffic coupled,
- cascading failure mungkin terjadi.

Cocok untuk:

- admin API,
- financial transaction,
- sensitive government workflow,
- high-risk data,
- external partner API yang harus secure-first.

### 10.3 Fail Open Terbatas

Fail open penuh sangat berbahaya. Tetapi bounded fail-open bisa didesain:

```text
If auth server down:
  accept only tokens already cached as active
  only until cached metadata expires
  no privilege elevation
  no sensitive write operation
  log degraded auth mode
  alert security/on-call
```

Ini lebih tepat disebut **fail with stale cache**, bukan fail open bebas.

### 10.4 Fail Soft by Operation Risk

Risk-based failure policy:

```text
Read public-ish data:
  allow with fresh cache < 60s

Read sensitive data:
  require introspection or cache < 10s

Write operation:
  require introspection or strong cache policy

Admin/high-risk operation:
  always introspect or require step-up
```

### 10.5 Circuit Breaker

Jika auth server mulai error, jangan biarkan semua request membuat introspection call dan memperparah outage.

Pattern:

```text
normal -> remote introspection
slow/error spike -> circuit opens
while open -> use cached active result if allowed by policy, otherwise 503/401
half-open -> limited probe
recover -> normal
```

Namun circuit breaker pada authentication harus lebih hati-hati daripada pada service biasa karena salah konfigurasi bisa membuka akses.

### 10.6 Error Mapping

Jangan semua error menjadi `401`.

| Kondisi | HTTP ke client | Makna |
|---|---:|---|
| Missing token | 401 | client belum authenticated |
| Invalid/inactive token | 401 | token tidak valid |
| Insufficient scope | 403 | authenticated tapi tidak authorized |
| Introspection endpoint unavailable | 503 atau 401 tergantung policy | dependency auth gagal |
| Resource server credential rejected | 500/503 internal alert | konfigurasi/security incident |
| Malformed authorization header | 401 | request credential invalid |

Resource server credential rejected oleh auth server bukan salah user. Itu indikasi konfigurasi salah atau credential resource server bocor/rotated.

---

## 11. Security Risks

### 11.1 Token Leakage

Opaque token tetap bearer credential. Siapa pun yang memilikinya bisa menggunakannya kecuali ada proof binding.

Mitigasi:

- TLS everywhere,
- never log token,
- avoid token in URL,
- use `Authorization` header,
- short expiry,
- revocation,
- sender-constrained token for high security,
- secure storage on client.

### 11.2 Introspection Credential Leakage

Resource server membutuhkan credential untuk introspection. Jika credential ini bocor, attacker bisa melakukan introspection terhadap token yang dicuri.

Mitigasi:

- secret manager,
- rotation,
- least privilege introspection client,
- mTLS/private key JWT,
- network restriction,
- per-resource-server credential,
- audit introspection calls,
- no shared global introspection secret.

### 11.3 Token Oracle

Jika introspection endpoint memberikan terlalu banyak informasi untuk invalid token, attacker bisa melakukan probing.

Response invalid sebaiknya minimal:

```json
{"active": false}
```

Jangan response:

```json
{
  "active": false,
  "reason": "expired_user_fajar_token_from_case_api"
}
```

### 11.4 Audience Confusion

Token untuk `service-a` dipakai ke `service-b`.

Mitigasi:

- validate `aud`,
- issue audience-specific token,
- token exchange,
- reject token with missing/wrong audience,
- do not rely only on scope.

### 11.5 Scope Inflation

Authorization server mengembalikan scopes terlalu luas atau resource server mapping terlalu longgar.

Contoh buruk:

```text
scope = "admin"
resource server treats as all permissions
```

Lebih baik:

```text
scope = "case:read case:update"
role/permission mapping controlled per API
```

### 11.6 Stale Cache After Revocation

Token sudah revoked tetapi masih aktif di cache.

Mitigasi:

- short TTL,
- revocation event,
- high-risk recheck,
- session version,
- token `jti` denylist,
- cache TTL bounded by risk.

### 11.7 Fail-Open Bug

Bug umum:

```java
try {
    return introspect(token).active();
} catch (Exception e) {
    log.warn("introspection failed", e);
    return true;
}
```

Ini catastrophic.

### 11.8 Client Authentication Downgrade

Resource server awalnya memakai mTLS/private key JWT untuk introspection, lalu karena deployment sulit diturunkan menjadi shared secret global.

Risiko:

- credential bocor berdampak luas,
- tidak ada per-service attribution,
- sulit rotasi,
- sulit revoke satu service.

### 11.9 Metadata Injection

Jika authorization server/custom introspection mengembalikan custom claim yang tidak tervalidasi, resource server bisa menerima data berbahaya.

Mitigasi:

- strict schema,
- reject unexpected type,
- length limit,
- allowlist attributes,
- avoid direct use in SQL/log/UI.

### 11.10 Cross-Tenant Token Confusion

Token valid untuk tenant A dipakai ke route tenant B.

Mitigasi:

```text
route: /tenants/{tenantId}/cases/{caseId}
token metadata: tenant_id
resource server check: route tenantId == token tenant_id
```

---

## 12. Production Design Rules

### Rule 1 — Treat Introspection as Authentication Dependency

Introspection endpoint bukan “utility endpoint”. Ia berada di authentication hot path.

Harus punya:

- SLO,
- latency metrics,
- error budget,
- scaling plan,
- rate limit,
- timeout,
- alert,
- dashboard,
- runbook.

### Rule 2 — Always Set Timeouts

Tidak ada introspection call tanpa timeout.

Minimal:

```text
connect timeout
read/request timeout
total timeout
```

Jika tidak, thread pool/virtual threads bisa menumpuk dan membuat resource server collapse.

### Rule 3 — Do Not Log Tokens

Jangan log:

```text
Authorization header
raw token
introspection request body
token cache key if raw
```

Log aman:

```text
token_hash_prefix
subject_id
client_id
tenant_id
jti if available
active status
latency
result category
```

### Rule 4 — Validate Audience

Opaque token tidak berarti “auth server sudah melakukan semuanya”. Resource server harus tetap memvalidasi audience/resource binding jika metadata tersedia.

### Rule 5 — Scope Is Not User Role

Scope adalah izin delegated/client-level. Role adalah model organizational/user-level. Permission adalah kemampuan melakukan action tertentu. Jangan mencampur semuanya tanpa desain.

### Rule 6 — Cache Deliberately

Cache bukan optimasi gratis. Cache adalah trade-off security.

Dokumentasikan:

```text
cache TTL
revocation window
high-risk bypass
inactive cache policy
cache storage sensitivity
invalidation strategy
```

### Rule 7 — Use Separate Introspection Client per Resource Server

Jangan gunakan satu `global-introspection-client` untuk semua API.

Lebih baik:

```text
case-api-introspector
payment-api-introspector
report-api-introspector
admin-api-introspector
```

Keuntungan:

- least privilege,
- audit attribution,
- revoke per service,
- rotate per service,
- detect abuse.

### Rule 8 — Separate Authentication Failure from Authorization Failure

Authentication failure: token tidak valid. Authorization failure: token valid tapi tidak punya hak.

Ini penting untuk:

- HTTP status,
- audit,
- alert,
- user experience,
- incident analysis.

### Rule 9 — Design for Auth Server Outage

Harus jelas:

```text
What happens when introspection endpoint is slow?
What happens when it returns 500?
What happens when DNS fails?
What happens when TLS cert expires?
What happens when resource server credential is rotated incorrectly?
What happens when Redis cache is down?
```

### Rule 10 — Never Build Authorization on `active` Alone

`active` adalah necessary but not sufficient.

---

## 13. Observability Model

### 13.1 Metrics

Resource server perlu metrics:

```text
introspection.requests.total
introspection.requests.success
introspection.requests.inactive
introspection.requests.error
introspection.latency.p50/p95/p99
introspection.cache.hit
introspection.cache.miss
introspection.cache.eviction
introspection.circuit.open
introspection.auth.failure
```

### 13.2 Logs

Log event authentication:

```json
{
  "event": "token_introspection_result",
  "request_id": "...",
  "token_hash_prefix": "sha256:abc123",
  "active": true,
  "subject_id": "user-123",
  "client_id": "case-web-bff",
  "tenant_id": "agency-a",
  "audience": "case-api",
  "scope_count": 3,
  "cache": "miss",
  "latency_ms": 42
}
```

Jangan log raw token.

### 13.3 Tracing

Trace span:

```text
HTTP request
  authentication.extract_bearer
  authentication.introspection_cache
  authentication.introspection_http
  authentication.map_principal
  authorization.evaluate
  handler
```

Tag yang aman:

```text
client_id
issuer
audience
cache_hit
active
error_category
```

Hati-hati dengan `sub` jika termasuk personal data. Gunakan internal immutable ID dan privacy policy yang benar.

### 13.4 Alerting

Alert jika:

- introspection error rate tinggi,
- latency p95/p99 naik,
- inactive token spike,
- invalid token spike dari IP/client tertentu,
- resource server introspection credential rejected,
- cache hit ratio drop mendadak,
- circuit breaker open,
- token metadata schema parse failure.

---

## 14. Data Model for Opaque Token Store

Jika kita membangun authorization server sendiri, token store perlu dirancang dengan benar.

Contoh relational model konseptual:

```sql
CREATE TABLE oauth_access_token (
    token_id              VARCHAR(64) PRIMARY KEY,
    token_hash            VARCHAR(128) NOT NULL UNIQUE,
    subject_id            VARCHAR(128),
    client_id             VARCHAR(128) NOT NULL,
    tenant_id             VARCHAR(128),
    audience              VARCHAR(256),
    scope                 VARCHAR(2000),
    issued_at             TIMESTAMP NOT NULL,
    expires_at            TIMESTAMP NOT NULL,
    revoked_at            TIMESTAMP NULL,
    revocation_reason     VARCHAR(128) NULL,
    session_id            VARCHAR(128) NULL,
    created_by_ip         VARCHAR(64) NULL,
    token_type            VARCHAR(32) NOT NULL
);
```

Rules:

- store token hash, not raw token,
- index `token_hash`,
- index expiry cleanup,
- store revocation time,
- bind token to client/audience,
- support session-level revocation,
- support client-level revocation,
- avoid storing unnecessary PII.

### 14.1 Token Generation

Opaque token harus high entropy.

Contoh Java:

```java
public final class OpaqueTokenGenerator {
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    public String generate() {
        byte[] bytes = new byte[32]; // 256-bit entropy
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
```

Jangan gunakan:

```java
UUID.randomUUID().toString()
System.currentTimeMillis()
userId + timestamp
Random
sequential ID
```

UUID v4 punya randomness, tetapi untuk access token high-value lebih baik gunakan 256-bit random dari `SecureRandom`.

### 14.2 Token Hashing

```java
public static String sha256Base64Url(String token) {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
    return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
}
```

Untuk opaque token high entropy, SHA-256 hash untuk lookup biasanya cukup karena token tidak dapat ditebak. Untuk password, ini tidak cukup. Jangan samakan token hashing dengan password hashing.

### 14.3 Cleanup

Token store perlu cleanup:

```text
expired access token cleanup
revoked token retention for audit
refresh token family cleanup
session termination cleanup
index maintenance
partition by expiry date if very large
```

---

## 15. Revocation Semantics

### 15.1 Token Revocation Endpoint

RFC 7009 mendefinisikan endpoint agar client bisa memberi tahu authorization server bahwa token tidak lagi diperlukan atau harus dicabut.

Contoh konseptual:

```http
POST /oauth2/revoke HTTP/1.1
Authorization: Basic <client-auth>
Content-Type: application/x-www-form-urlencoded

token=...&token_type_hint=access_token
```

### 15.2 Revoking Access Token vs Refresh Token

Access token revoked:

```text
current access stops when introspection sees inactive
```

Refresh token revoked:

```text
client cannot obtain new access token
existing access token may remain until expiry/revocation policy
```

Session revoked:

```text
all tokens under session may become inactive
```

Client revoked:

```text
tokens issued to client may be invalidated
```

User disabled:

```text
tokens for user should become inactive depending on policy
```

### 15.3 Revocation Reason

Internally useful:

```text
USER_LOGOUT
ADMIN_REVOKED
PASSWORD_CHANGED
MFA_RESET
CLIENT_DISABLED
TENANT_SUSPENDED
TOKEN_REUSE_DETECTED
SECURITY_INCIDENT
```

Do not expose detailed reason to arbitrary resource server/client unless needed and safe.

### 15.4 Revocation Propagation

Opaque token + no cache:

```text
propagation almost immediate
```

Opaque token + cache:

```text
propagation delayed by cache TTL unless invalidation event exists
```

JWT local validation:

```text
propagation delayed by exp unless denylist/introspection/session version exists
```

---

## 16. Introspection Response Validation

Resource server should validate not only status code and JSON parse.

Checklist:

```text
HTTP status == 200
Content-Type expected
JSON size bounded
active exists and boolean
if active true:
  sub/client_id present as expected
  exp present and future if used
  iss trusted if returned
  aud includes this resource
  scope parsed safely
  tenant_id format valid
  token_type acceptable
  no unexpected critical metadata missing
```

### 16.1 Schema Drift

If authorization server changes field type:

```json
{"scope": ["case:read", "case:update"]}
```

while resource server expects:

```json
{"scope": "case:read case:update"}
```

production can break.

Mitigation:

- contract tests,
- versioned metadata schema,
- tolerant parsing only where safe,
- reject ambiguous values,
- shared library or platform SDK,
- staging compatibility check.

---

## 17. Common Mistakes

### Mistake 1 — Treating Opaque Token as JWT

```java
String[] parts = token.split("\\.");
```

Do not parse opaque token.

### Mistake 2 — No Timeout

Authentication hot path waits forever.

### Mistake 3 — Caching Longer Than Token Expiry

Cached active result outlives token.

### Mistake 4 — Not Validating Audience

Any active token from issuer accepted by every API.

### Mistake 5 — Shared Introspection Secret Across All Services

One leaked secret compromises introspection for all services.

### Mistake 6 — Logging Raw Token

Logs become credential database.

### Mistake 7 — Mapping Scope Directly to Admin

```text
scope contains "admin" -> grant all
```

Too coarse and dangerous.

### Mistake 8 — Fail Open on Exception

Security catastrophic.

### Mistake 9 — Cache Without Revocation Discussion

Optimization silently changes security guarantee.

### Mistake 10 — Returning Detailed Inactive Reason

Leaks token lifecycle and account information.

---

## 18. Design Questions

Gunakan pertanyaan ini saat memilih opaque token/introspection.

### 18.1 Requirement Questions

1. Berapa cepat token harus bisa dicabut?
2. Apakah klaim token mengandung data sensitif?
3. Apakah resource server boleh bergantung runtime ke authorization server?
4. Berapa latency budget per request?
5. Berapa request per second yang perlu introspection?
6. Apakah ada external partner?
7. Apakah token harus audience-specific?
8. Apakah ada multi-tenant boundary?
9. Apakah high-risk operation perlu fresh check?
10. Apakah audit perlu melihat setiap token validation?

### 18.2 Failure Questions

1. Apa yang terjadi jika introspection endpoint down?
2. Apa yang terjadi jika introspection credential expired?
3. Apa yang terjadi jika cache down?
4. Apa yang terjadi jika authorization server lambat?
5. Apa yang terjadi jika token revoked saat request sedang berjalan?
6. Apa yang terjadi jika role user berubah?
7. Apa yang terjadi jika tenant suspended?
8. Apa yang terjadi jika introspection response schema berubah?
9. Apa yang terjadi jika DNS auth server gagal?
10. Apa yang terjadi jika TLS certificate auth server expired?

### 18.3 Security Questions

1. Apakah token pernah muncul di log?
2. Apakah token pernah masuk URL?
3. Apakah introspection endpoint rate-limited?
4. Apakah introspection endpoint accessible dari public internet?
5. Apakah resource server credential disimpan aman?
6. Apakah client ID introspection punya least privilege?
7. Apakah response invalid minimal?
8. Apakah `aud` divalidasi?
9. Apakah tenant divalidasi terhadap route/resource?
10. Apakah cache TTL terdokumentasi sebagai revocation window?

---

## 19. Reference Decision Matrix

| Use Case | Opaque Token Fit | JWT Fit | Reason |
|---|---:|---:|---|
| External partner API needing central revocation | High | Medium | Opaque hides format and supports revocation |
| High-QPS low-latency internal service | Medium | High | JWT local validation may reduce hot-path dependency |
| Admin API with immediate disable requirement | High | Medium | Central active check valuable |
| Mobile app access token | High | Medium | Opaque reduces claim exposure; still needs secure storage |
| Service mesh internal calls | Medium | High | mTLS/JWT/SPIFFE may fit better |
| Browser SPA direct token | Medium | Medium | Better with BFF; avoid exposing long-lived tokens |
| Multi-tenant regulatory app | High | Medium | Central policy + tenant validation useful |
| Offline validation requirement | Low | High | Opaque needs online introspection |
| Fine-grained revocation per session/device | High | Medium | Reference token maps naturally to server state |
| Simple internal tool | Medium | Medium | Depends on existing platform |

---

## 20. Applied Example: Regulatory Case API

Misalkan ada system case management dengan modul:

- case read,
- case update,
- appeal,
- compliance,
- correspondence,
- document,
- audit trail,
- admin maintenance.

Actor:

- officer,
- manager,
- external user,
- service account,
- scheduler,
- integration partner.

Opaque token architecture:

```text
User logs in through IdP
BFF obtains opaque access token for case-api
Case API receives token
Case API introspects token
Case API validates:
  active
  issuer
  audience == case-api
  tenant/agency
  scope
  user status
  session status
Case API maps to principal
Business authorization checks case ownership/assignment/state
Audit logs subject/client/session/token hash
```

Important distinction:

```text
Authentication says:
  This request is from subject user-123 via client case-web-bff.

Coarse authorization says:
  This subject has scope case:update.

Business authorization says:
  This subject can update this specific case because case is assigned to their unit and state allows edit.
```

Opaque token/introspection only solves the first part and helps with coarse attributes. It does not replace domain authorization.

---

## 21. Implementation Checklist

### 21.1 Resource Server Checklist

- [ ] Extract bearer token only from approved location.
- [ ] Reject multiple credentials ambiguity.
- [ ] Do not log token.
- [ ] Introspection endpoint configured via secure config.
- [ ] Introspection credential from secret manager.
- [ ] TLS enforced.
- [ ] Timeout configured.
- [ ] Error mapping defined.
- [ ] `active` checked.
- [ ] `aud` checked.
- [ ] `iss` checked if available.
- [ ] `exp` checked if available.
- [ ] Scope mapped safely.
- [ ] Tenant validated.
- [ ] Principal built from stable subject ID.
- [ ] Cache TTL bounded by expiry.
- [ ] Revocation window documented.
- [ ] Metrics emitted.
- [ ] Audit event emitted.
- [ ] Circuit breaker policy reviewed.

### 21.2 Authorization Server Checklist

- [ ] Token generated with strong entropy.
- [ ] Raw token not stored, only hash.
- [ ] Token bound to client.
- [ ] Token bound to audience/resource.
- [ ] Token expiry enforced.
- [ ] Revocation supported.
- [ ] Introspection endpoint requires client authentication.
- [ ] Introspection response for inactive token minimal.
- [ ] Rate limit introspection.
- [ ] Audit introspection calls.
- [ ] Per-resource-server introspection client.
- [ ] Token cleanup process.
- [ ] Revocation event if cache invalidation needed.
- [ ] Schema versioning strategy.

---

## 22. Mental Model Summary

Opaque token adalah **reference credential**. Ia tidak membawa kontrak validasi lokal seperti JWT. Resource server harus bertanya ke authorization server untuk mengetahui apakah token aktif dan metadata apa yang melekat pada token.

Kekuatan opaque token:

- revocation lebih natural,
- claim privacy lebih baik,
- central policy lebih mudah,
- external contract lebih stabil,
- token format bisa berubah tanpa resource server/client tahu.

Kelemahannya:

- latency tambahan,
- dependency runtime ke auth server,
- cache vs revocation trade-off,
- introspection endpoint menjadi hot path,
- failure semantics lebih kompleks.

Rule paling penting:

```text
Opaque token does not make authentication automatically safer.
It makes token state centrally controllable.
The system is safe only if introspection, caching, validation, failure handling, and audit are designed correctly.
```

---

## 23. Key Takeaways

1. Opaque token adalah token yang tidak boleh diinterpretasikan oleh resource server.
2. Token introspection adalah mekanisme resource server menanyakan active state dan metadata token ke authorization server.
3. `active: true` bukan authorization final.
4. Resource server tetap harus validasi audience, issuer, scope, tenant, expiry, dan policy lokal.
5. Opaque token unggul saat butuh revocation, privacy, dan central control.
6. JWT unggul saat butuh local validation, low latency, dan decoupling dari auth server.
7. Cache introspection adalah trade-off security, bukan sekadar performance optimization.
8. Fail-open pada authentication adalah risiko besar; kalau perlu degradasi, gunakan stale-cache policy yang bounded.
9. Jangan log raw token atau introspection credential.
10. Production-grade opaque token system membutuhkan observability, SLO, runbook, dan incident model.

---

## 24. References

- RFC 7662 — OAuth 2.0 Token Introspection: https://datatracker.ietf.org/doc/html/rfc7662
- RFC 7009 — OAuth 2.0 Token Revocation: https://datatracker.ietf.org/doc/html/rfc7009
- RFC 6750 — OAuth 2.0 Bearer Token Usage: https://datatracker.ietf.org/doc/html/rfc6750
- RFC 9700 — Best Current Practice for OAuth 2.0 Security: https://datatracker.ietf.org/doc/rfc9700/
- Spring Security Reference — OAuth2 Resource Server Opaque Token: https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html
- Spring Security Reference — Servlet Authentication Architecture: https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- Java `HttpClient`: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html
- Java `SecureRandom`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/SecureRandom.html

---

## 25. Status Series

Part ini adalah **Part 12** dari series **Java Authentication Modes and Patterns**.

Status:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
```

Series **belum selesai**.

Part berikutnya:

```text
Part 13 — OAuth 2.0 for Java Engineers: Delegated Authorization as Authentication Input
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-011.md">⬅️ Part 11 — JWT Authentication: Claims, Validation, and Misuse</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-013.md">Part 13 — OAuth 2.0 for Java Engineers: Delegated Authorization as Authentication Input ➡️</a>
</div>
