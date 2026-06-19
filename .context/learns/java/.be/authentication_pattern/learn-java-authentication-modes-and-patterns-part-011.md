# learn-java-authentication-modes-and-patterns-part-011

# Part 11 — JWT Authentication: Claims, Validation, and Misuse

> Series: Java Authentication Modes and Patterns  
> Scope: Java 8 hingga Java 25  
> Level: Advanced / production engineering  
> Status: Part 11 dari maksimal 35 part  
> Fokus: memahami JWT sebagai signed claims assertion, cara validasi yang benar, kesalahan desain yang sering berujung compromise, dan bagaimana menerapkannya secara defensible di sistem Java enterprise.

---

## 0. Ringkasan Besar

JWT sering terlihat sederhana:

```text
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

Lalu banyak engineer berpikir:

```text
parse token -> ambil userId -> set SecurityContext -> selesai
```

Itu cara berpikir yang berbahaya.

Mental model yang benar:

```text
JWT adalah signed assertion berisi claims.
JWT bukan bukti identitas final sebelum divalidasi penuh.
JWT bukan session ajaib.
JWT bukan authorization model lengkap.
JWT bukan bukti bahwa request berasal dari user asli.
JWT hanya menyatakan: "issuer tertentu menandatangani claim tertentu untuk audience tertentu pada periode waktu tertentu menggunakan algoritma dan key tertentu".
```

JWT authentication yang benar selalu menjawab pertanyaan berikut:

1. Siapa issuer token ini?
2. Apakah issuer tersebut dipercaya oleh service ini?
3. Apakah signature valid?
4. Apakah algoritma yang dipakai memang diizinkan?
5. Apakah key yang dipakai benar untuk issuer dan algoritma ini?
6. Apakah token ini ditujukan untuk service ini?
7. Apakah token masih berlaku secara waktu?
8. Apakah subject dan claim-nya masuk akal?
9. Apakah token type-nya benar?
10. Apakah token ini digunakan dalam konteks yang benar?

Tanpa pertanyaan-pertanyaan itu, JWT mudah berubah dari mekanisme keamanan menjadi format JSON yang diberi tanda tangan tetapi dipercaya secara salah.

---

## 1. Problem yang Diselesaikan JWT

JWT menyelesaikan problem representasi claim lintas boundary.

Contoh boundary:

```text
Authorization Server -> Resource Server
Identity Provider    -> Application
Gateway              -> Internal Service
Service A            -> Service B
```

Sistem A ingin menyampaikan pernyataan ke sistem B:

```text
"Subject 12345 telah diautentikasi oleh issuer X,
 token berlaku sampai waktu Y,
 token ditujukan untuk audience Z,
 token memiliki scope read:case write:appeal."
```

JWT membuat pernyataan itu menjadi:

1. compact,
2. URL-safe,
3. JSON-based,
4. dapat diverifikasi dengan signature atau MAC,
5. dapat dipakai di HTTP header, cookie, message, atau channel lain.

Namun JWT tidak otomatis menyelesaikan:

1. revocation,
2. logout,
3. session invalidation,
4. permission evaluation,
5. account locking,
6. tenant isolation,
7. identity linking,
8. consent,
9. MFA enforcement,
10. audit completeness.

JWT hanya format token. Security muncul dari validasi, lifecycle, key management, issuer trust, dan usage discipline.

---

## 2. JWT dalam Keluarga JOSE

JWT berada dalam ekosistem JOSE: JSON Object Signing and Encryption.

Istilah penting:

| Istilah | Makna |
|---|---|
| JWT | JSON Web Token, format claims token |
| JWS | JSON Web Signature, token yang ditandatangani |
| JWE | JSON Web Encryption, token yang dienkripsi |
| JWK | JSON Web Key, representasi key dalam JSON |
| JWKS | JSON Web Key Set, kumpulan JWK |
| JWA | JSON Web Algorithms |
| `kid` | key ID di header untuk memilih key |
| `alg` | algoritma signature/encryption |
| `typ` | type hint, misalnya `JWT` atau `at+jwt` |
| `cty` | content type untuk nested token |

Dalam praktik authentication API, yang paling sering dipakai adalah signed JWT/JWS.

Struktur compact JWS:

```text
BASE64URL(header).BASE64URL(payload).BASE64URL(signature)
```

Contoh konseptual:

```json
// header
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "2026-06-key-01"
}
```

```json
// payload / claims
{
  "iss": "https://idp.example.com/realms/aceas",
  "sub": "user-12345",
  "aud": "case-management-api",
  "exp": 1781800000,
  "iat": 1781796400,
  "nbf": 1781796400,
  "scope": "case:read appeal:write",
  "tenant_id": "cea",
  "acr": "urn:mfa:level2"
}
```

Yang ditandatangani bukan hanya payload, tetapi:

```text
BASE64URL(header) + "." + BASE64URL(payload)
```

Signature melindungi integritas header dan payload terhadap modifikasi. Signature tidak menyembunyikan isi token.

---

## 3. Mental Model: JWT Bukan Identitas, JWT Adalah Assertion

Kesalahan umum:

```text
JWT valid -> user pasti valid -> boleh akses
```

Model yang lebih benar:

```text
JWT diterima sebagai input authentication.
Validasi cryptographic dan semantic dilakukan.
Jika valid, token menghasilkan Authentication object.
Authorization tetap dilakukan oleh policy/resource model.
```

Diagram:

```text
HTTP Request
    |
    v
Extract Bearer Token
    |
    v
Parse JOSE header safely
    |
    v
Select trusted issuer config
    |
    v
Select allowed algorithm and trusted key
    |
    v
Verify signature
    |
    v
Validate registered claims
    |
    v
Validate application claims
    |
    v
Build principal / authentication context
    |
    v
Authorize operation on resource
```

JWT sebaiknya dipandang seperti dokumen resmi bertanda tangan:

```text
Dokumen punya tanda tangan.
Tetapi sebelum dipercaya, kita tetap memeriksa:
- siapa yang menandatangani,
- apakah tanda tangannya sah,
- apakah penerima dokumen memang kita,
- apakah dokumen sudah expired,
- apakah dokumen dipakai untuk tujuan yang benar,
- apakah isi dokumen cukup untuk keputusan yang diminta.
```

---

## 4. Kapan JWT Dipakai dalam Authentication

JWT umum dipakai pada:

1. OAuth2 access token.
2. OIDC ID token.
3. service-to-service token.
4. gateway-issued internal token.
5. short-lived API token.
6. event assertion.
7. token exchange result.
8. one-time action token, meskipun sering lebih aman opaque token.
9. signed callback assertion.
10. machine identity assertion.

Tetapi JWT tidak selalu pilihan terbaik.

Gunakan JWT ketika:

1. resource server perlu memvalidasi token lokal tanpa roundtrip ke issuer,
2. token lifetime pendek,
3. claim set relatif stabil selama lifetime token,
4. issuer dan audience jelas,
5. key management matang,
6. revocation real-time bukan requirement utama,
7. token tidak perlu menyembunyikan payload,
8. service boundary banyak dan latency introspection mahal,
9. issuer discovery/JWKS dapat dikelola dengan aman,
10. ada disiplin validasi yang konsisten.

Hindari JWT ketika:

1. token harus bisa dicabut real-time,
2. claim sering berubah dan harus langsung efektif,
3. payload mengandung data sensitif,
4. sistem tidak punya key rotation process,
5. audience tidak jelas,
6. token dipakai sebagai session jangka panjang,
7. authorization butuh state server-side terbaru,
8. consumer token banyak dan heterogen tanpa governance,
9. aplikasi tidak bisa menjaga storage token dengan aman,
10. tim belum memahami validasi claim secara ketat.

---

## 5. JWT vs Session vs Opaque Token

| Aspek | JWT | Session ID | Opaque Token |
|---|---|---|---|
| Bentuk | Self-contained claims | Random identifier | Random/reference identifier |
| Validasi | Local signature + claims | Lookup session store | Introspection/lookup |
| Revocation | Sulit tanpa denylist/introspection | Mudah invalidasi server-side | Mudah via issuer/introspection |
| Payload visible | Ya, kecuali JWE | Tidak | Tidak |
| Ukuran | Relatif besar | Kecil | Kecil |
| Latency | Rendah jika key cached | Tergantung store | Tergantung introspection/cache |
| Claim freshness | Sesuai saat token diterbitkan | Bisa real-time dari session/store | Bisa real-time dari issuer |
| Cocok untuk | Distributed APIs | Browser app stateful | Enterprise centralized control |

Mental model:

```text
JWT mengoptimalkan local validation.
Session mengoptimalkan central control.
Opaque token mengoptimalkan issuer control.
```

Tidak ada yang selalu paling aman. Yang paling aman adalah yang cocok dengan requirement revocation, latency, deployment, audit, dan trust boundary.

---

## 6. Struktur JWT Secara Detail

### 6.1 Header

Header berisi metadata JOSE.

Contoh:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "rsa-2026-06-01"
}
```

Field penting:

| Field | Makna | Catatan |
|---|---|---|
| `alg` | algoritma | Jangan dipercaya secara buta |
| `typ` | type hint | Berguna untuk membedakan access token vs ID token |
| `kid` | key ID | Berguna untuk key selection, bukan trust proof |
| `cty` | content type | Untuk nested token |
| `x5c` | certificate chain | Harus divalidasi jika dipakai |
| `jku` | JWK Set URL | Berbahaya jika diterima dari token tanpa allowlist |
| `x5u` | certificate URL | Berbahaya jika diterima tanpa allowlist |

Rule penting:

```text
Header membantu memilih cara validasi.
Header tidak boleh menjadi sumber trust.
```

Jika token berkata:

```json
{
  "alg": "none"
}
```

atau:

```json
{
  "jku": "https://attacker.example.com/jwks.json"
}
```

validator tidak boleh otomatis mengikuti instruksi itu.

### 6.2 Payload / Claims

Payload berisi claims.

Claims adalah pernyataan, bukan fakta absolut.

Contoh:

```json
{
  "iss": "https://issuer.example.com",
  "sub": "248289761001",
  "aud": "payment-api",
  "exp": 1781800000,
  "nbf": 1781796400,
  "iat": 1781796400,
  "jti": "d4e32d9e-1c3d-4b8b-bf93-2fd9a2ef9c3a",
  "scope": "payment:read payment:create",
  "tenant_id": "agency-a"
}
```

### 6.3 Signature

Signature membuktikan integritas dan issuer/key possession, tergantung algoritma.

Untuk symmetric HMAC:

```text
issuer dan verifier berbagi secret.
```

Untuk asymmetric RSA/ECDSA/EdDSA:

```text
issuer memegang private key.
verifier memegang public key.
```

Dalam distributed systems, asymmetric signing biasanya lebih baik untuk access token karena resource server tidak perlu mengetahui private key atau shared signing secret.

---

## 7. Registered Claims yang Wajib Dipahami

RFC JWT mendefinisikan registered claim names. Tidak semua wajib ada untuk semua penggunaan, tetapi dalam authentication access token modern, sebagian besar harus dipertimbangkan.

### 7.1 `iss` — Issuer

`iss` menyatakan pihak yang menerbitkan token.

Contoh:

```json
"iss": "https://sso.example.gov/realms/aceas"
```

Validasi:

```text
Token valid hanya jika iss persis sama dengan issuer yang dipercaya.
```

Kesalahan umum:

```text
startsWith("https://sso.example.gov")
contains("example.gov")
case-insensitive compare
menerima banyak issuer tanpa mapping konfigurasi
```

Issuer harus diperlakukan sebagai trust root namespace.

### 7.2 `sub` — Subject

`sub` adalah identifier subject dalam namespace issuer.

```json
"sub": "user-123"
```

Rule penting:

```text
sub hanya unik dalam scope issuer.
Global identity sebaiknya: issuer + subject.
```

Jangan menyimpan user hanya berdasarkan `sub` jika aplikasi menerima token dari banyak issuer.

Lebih aman:

```text
external_identity_key = hash(issuer + "|" + subject)
```

### 7.3 `aud` — Audience

`aud` menyatakan penerima token yang dimaksud.

```json
"aud": "case-api"
```

atau:

```json
"aud": ["case-api", "appeal-api"]
```

Validasi:

```text
Resource server harus memastikan token memang ditujukan untuk dirinya.
```

Tanpa validasi audience, token untuk service A bisa dipakai ke service B.

Ini salah satu penyebab token substitution.

### 7.4 `exp` — Expiration Time

`exp` menyatakan kapan token tidak boleh diterima lagi.

Validasi:

```text
now < exp + allowedClockSkew
```

Design rule:

```text
Access token harus short-lived.
Refresh token, jika ada, punya lifecycle berbeda dan tidak dipakai ke resource server biasa.
```

Kesalahan:

1. menerima token tanpa `exp`,
2. access token berlaku berhari-hari,
3. clock skew terlalu besar,
4. tidak membedakan expired vs invalid dalam logging,
5. mengembalikan error terlalu detail ke attacker.

### 7.5 `nbf` — Not Before

`nbf` menyatakan token belum boleh dipakai sebelum waktu tertentu.

Validasi:

```text
now + allowedClockSkew >= nbf
```

Ini berguna untuk delayed validity, tetapi jarang menjadi field utama.

### 7.6 `iat` — Issued At

`iat` menyatakan kapan token diterbitkan.

Kegunaan:

1. mendeteksi token terlalu lama,
2. mendukung policy “tokens issued before X are invalid”,
3. forensic timeline,
4. session max age,
5. anomaly detection.

`iat` sendiri bukan expiry. Jangan mengganti `exp` dengan `iat + defaultDuration` kecuali itu policy eksplisit dan aman.

### 7.7 `jti` — JWT ID

`jti` adalah identifier unik token.

Kegunaan:

1. denylist token,
2. replay detection,
3. audit correlation,
4. refresh token reuse detection,
5. one-time token semantics.

Trade-off:

```text
JWT tanpa server-side state sulit revocation.
JWT dengan denylist memakai server-side state lagi.
```

Itu bukan buruk, tetapi harus disadari.

---

## 8. Custom Claims: Berguna, Tapi Mudah Merusak Desain

Custom claims sering berisi:

1. `scope`,
2. `roles`,
3. `groups`,
4. `permissions`,
5. `tenant_id`,
6. `agency_id`,
7. `email`,
8. `preferred_username`,
9. `acr`,
10. `amr`,
11. `session_state`,
12. `client_id`,
13. `azp`,
14. `typ`,
15. `token_use`.

Masalah umum: claim terlalu dipercaya.

Contoh buruk:

```java
String role = jwt.getClaim("role");
if (role.equals("ADMIN")) {
    approveCase();
}
```

Kenapa buruk?

Karena authorization bergantung langsung pada claim yang mungkin:

1. berasal dari issuer salah,
2. stale,
3. salah mapping,
4. tidak scoped ke tenant,
5. tidak scoped ke resource,
6. tidak membedakan global admin vs tenant admin,
7. tidak punya provenance.

Lebih baik:

```text
JWT claim -> authentication context -> authorization policy -> resource decision
```

Contoh:

```text
claim: roles = ["case_officer"]
claim: tenant_id = "cea"
operation: APPROVE_CASE
resource: case.tenant_id = "cea"
policy: case_officer can approve only if case.status = PENDING_REVIEW and assignedUnit matches
```

Jadi JWT memberi input, bukan keputusan final.

---

## 9. Access Token vs ID Token

Kesalahan besar dalam OAuth/OIDC adalah memakai ID token untuk memanggil API.

### 9.1 ID Token

ID token adalah token untuk client application.

Tujuan:

```text
memberi tahu client bahwa user telah diautentikasi oleh OpenID Provider.
```

Audience ID token biasanya client ID.

### 9.2 Access Token

Access token adalah token untuk resource server/API.

Tujuan:

```text
memberi izin akses ke protected resource.
```

Audience access token harus resource server/API.

### 9.3 Rule

```text
API/resource server tidak seharusnya menerima ID token sebagai bearer access token.
```

Jika resource server menerima ID token:

1. audience salah,
2. scope/resource semantics tidak tepat,
3. token substitution mudah terjadi,
4. client dapat menyalahgunakan token yang bukan untuk API,
5. confused-deputy risk meningkat.

Diagram:

```text
User -> Client App -> Authorization Server
                  <- ID Token     : for client
                  <- Access Token : for API

Client App -> API
          Authorization: Bearer access_token
```

Bukan:

```text
Client App -> API
          Authorization: Bearer id_token   // wrong
```

---

## 10. Signature Algorithms

### 10.1 HMAC: HS256, HS384, HS512

HMAC memakai shared secret.

```text
signer dan verifier tahu secret yang sama.
```

Kelebihan:

1. cepat,
2. sederhana,
3. cocok untuk sistem kecil dengan trust boundary sempit.

Kekurangan:

1. semua verifier bisa menjadi signer,
2. secret harus dibagikan,
3. blast radius besar jika banyak resource server,
4. rotasi secret lebih sulit secara aman,
5. raw secret sering bocor lewat config.

HS256 cocok jika:

1. issuer dan verifier adalah komponen internal yang sangat terbatas,
2. hanya sedikit service,
3. secret management matang,
4. tidak ada third-party verifier.

### 10.2 RSA: RS256, PS256

RSA asymmetric.

```text
issuer sign dengan private key.
resource server verify dengan public key.
```

Kelebihan:

1. verifier tidak bisa sign token,
2. cocok untuk banyak resource server,
3. publik key bisa didistribusikan via JWKS,
4. common di enterprise IdP.

Kekurangan:

1. signature lebih besar,
2. operasi lebih mahal dari HMAC,
3. perlu key rotation process,
4. legacy RSASSA-PKCS1-v1_5 perlu perhatian.

PS256 memakai RSA-PSS dan sering lebih disukai untuk desain baru jika didukung ekosistem.

### 10.3 ECDSA: ES256, ES384

ECDSA asymmetric dengan key/signature lebih kecil.

Kelebihan:

1. signature compact,
2. performa baik,
3. cocok untuk token size-sensitive.

Kekurangan:

1. implementasi signature encoding bisa tricky,
2. library compatibility perlu dicek,
3. random nonce/signature correctness penting.

### 10.4 EdDSA

EdDSA modern, misalnya Ed25519.

Kelebihan:

1. desain modern,
2. signature kecil,
3. performa baik,
4. deterministic signing.

Kekurangan:

1. tidak semua IdP/framework lama mendukung,
2. Java version/provider compatibility perlu dicek,
3. enterprise ecosystem mungkin lebih lambat adopsi.

### 10.5 `none`

`none` berarti unsecured JWT.

Rule praktis:

```text
Resource server production tidak boleh menerima alg none untuk authentication token.
```

---

## 11. Algorithm Confusion

Algorithm confusion terjadi ketika verifier mempercayai `alg` dari token tanpa policy ketat.

Contoh klasik:

1. server seharusnya menerima RS256,
2. attacker mengubah header menjadi HS256,
3. server memakai public key RSA sebagai HMAC secret,
4. attacker bisa membuat token yang dianggap valid oleh implementasi buruk.

Mental model:

```text
Allowed algorithm adalah konfigurasi verifier, bukan permintaan dari token.
```

Salah:

```java
String alg = jwtHeader.get("alg");
Verifier verifier = verifierFor(alg);
verifier.verify(token);
```

Lebih benar:

```text
issuer config says:
- accepted algorithms: [RS256]
- JWKS URL: fixed trusted URL
- expected issuer: exact value
- expected audience: exact service audience
```

Validasi harus menolak token jika:

1. `alg` tidak di allowlist,
2. `alg` tidak cocok dengan key type,
3. key dipakai untuk algoritma berbeda,
4. key use/key ops tidak cocok,
5. `kid` tidak ditemukan,
6. token memakai embedded key dari lokasi tidak dipercaya.

---

## 12. Key Selection dan `kid`

`kid` membantu memilih key.

JWKS contoh:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "rsa-2026-06-01",
      "alg": "RS256",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

Flow validasi:

```text
1. token diterima
2. baca header secara aman
3. ambil kid
4. cari key dengan kid dalam JWKS issuer yang dipercaya
5. pastikan key type dan alg cocok
6. verify signature
7. validate claims
```

Pitfall:

1. menerima `kid` yang mengandung path traversal,
2. memakai `kid` untuk membaca file lokal,
3. query database tanpa sanitasi,
4. auto-fetch JWKS dari `jku` token,
5. fallback ke key pertama jika `kid` tidak ditemukan,
6. fallback ke HMAC secret default,
7. tidak cache JWKS dengan benar,
8. tidak refresh JWKS saat rotation,
9. menerima duplicate `kid`,
10. tidak membedakan key antar issuer.

Rule:

```text
kid is selector, not authority.
```

---

## 13. JWKS Validation and Caching

Dalam arsitektur modern, resource server mengambil public keys dari JWKS endpoint issuer.

Contoh:

```text
https://idp.example.com/realms/aceas/protocol/openid-connect/certs
```

Design requirement:

1. JWKS URL dikonfigurasi, bukan dibaca bebas dari token.
2. JWKS di-cache.
3. Cache menghormati TTL tetapi punya refresh strategy.
4. Jika `kid` tidak ditemukan, boleh trigger one-time refresh.
5. Jika tetap tidak ditemukan, reject token.
6. Jangan fail-open saat JWKS fetch gagal.
7. Gunakan timeout pendek untuk JWKS fetch.
8. Observability harus mencatat key refresh failure.
9. Support overlap old/new keys selama rotation.
10. Jangan hapus old key sebelum token lama expired.

Key rotation timeline:

```text
T0: publish new public key in JWKS
T1: wait until resource servers cache new key
T2: start signing with new private key
T3: keep old public key until all old tokens expire
T4: remove old public key
```

Kesalahan:

```text
rotate signing key and remove old public key immediately
```

Akibat:

```text
semua token yang masih valid secara exp mendadak gagal signature verification
```

---

## 14. Validation Pipeline yang Benar

Validasi JWT tidak boleh hanya `parseClaimsJws`.

Pipeline production:

```text
1. Extract token from expected location
2. Enforce bearer token syntax
3. Reject multiple credentials ambiguity
4. Decode JOSE header with size limit
5. Identify issuer configuration
6. Enforce allowed algorithms
7. Resolve trusted verification key
8. Verify signature/MAC
9. Decode claims with strict JSON handling
10. Validate issuer
11. Validate audience
12. Validate expiration
13. Validate not-before
14. Validate issued-at policy
15. Validate token type
16. Validate subject format
17. Validate client/application claim
18. Validate tenant claim
19. Validate scope/role mapping
20. Construct authentication context
21. Continue to authorization
```

Important distinction:

```text
Parsing is not validation.
Decoding is not validation.
Signature verification is not full validation.
Claim validation is not authorization.
```

---

## 15. Token Location

### 15.1 Authorization Header

Standard API usage:

```http
Authorization: Bearer <access-token>
```

Kelebihan:

1. explicit,
2. tidak otomatis dikirim browser seperti cookie,
3. cocok untuk API,
4. mudah dipakai client non-browser.

Kekurangan:

1. rentan jika disimpan di localStorage dan ada XSS,
2. client harus mengelola token,
3. tidak otomatis terlindungi CSRF karena tidak otomatis terkirim, tetapi XSS tetap serius.

### 15.2 Cookie

JWT bisa disimpan di cookie, tetapi harus dipahami sebagai browser credential.

Jika cookie:

1. gunakan `HttpOnly`,
2. gunakan `Secure`,
3. set `SameSite`,
4. pikirkan CSRF,
5. gunakan path/domain scoping,
6. jangan simpan token panjang jika header/cookie size jadi masalah,
7. logout harus menghapus cookie dan mungkin revoke server-side state.

Cookie JWT bukan otomatis lebih aman. Ia mengubah threat model dari token exfiltration via JS menjadi CSRF/session-cookie threat.

### 15.3 Query Parameter

Hindari:

```text
https://api.example.com/case?access_token=...
```

Karena token bisa bocor ke:

1. logs,
2. browser history,
3. proxy,
4. Referer header,
5. analytics,
6. screenshots,
7. monitoring tools.

### 15.4 Message Header

Dalam messaging/event-driven system, JWT kadang diletakkan di message header.

Harus jelas:

1. apakah token masih valid saat message diproses nanti,
2. apakah consumer boleh mempercayai producer,
3. apakah identity end-user atau producer service,
4. apakah token sengaja direplay dalam async pipeline,
5. apakah audit butuh immutable actor snapshot.

---

## 16. JWT sebagai Access Token di Spring Security

Spring Security OAuth2 Resource Server menyediakan pola validasi JWT yang umum:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com/realms/aceas
```

Dengan `issuer-uri`, framework dapat discovery metadata issuer dan JWKS. Namun production biasanya juga perlu audience validator custom.

Contoh konseptual Spring Security 6/7 style:

```java
@Configuration
class SecurityConfig {

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );

        return http.build();
    }

    @Bean
    Converter<Jwt, ? extends AbstractAuthenticationToken> jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(new ScopeAuthoritiesConverter());
        converter.setPrincipalClaimName("sub");
        return converter;
    }
}
```

Audience validator concept:

```java
final class AudienceValidator implements OAuth2TokenValidator<Jwt> {
    private final String expectedAudience;

    AudienceValidator(String expectedAudience) {
        this.expectedAudience = expectedAudience;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (jwt.getAudience().contains(expectedAudience)) {
            return OAuth2TokenValidatorResult.success();
        }

        OAuth2Error error = new OAuth2Error(
            "invalid_token",
            "Token audience is not accepted by this resource server",
            null
        );
        return OAuth2TokenValidatorResult.failure(error);
    }
}
```

JwtDecoder concept:

```java
@Bean
JwtDecoder jwtDecoder() {
    NimbusJwtDecoder decoder = JwtDecoders.fromIssuerLocation(
        "https://idp.example.com/realms/aceas"
    );

    OAuth2TokenValidator<Jwt> issuer = JwtValidators.createDefaultWithIssuer(
        "https://idp.example.com/realms/aceas"
    );

    OAuth2TokenValidator<Jwt> audience = new AudienceValidator("case-api");

    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(issuer, audience));
    return decoder;
}
```

Catatan:

```text
Kode di atas adalah pattern konseptual. Versi API detail dapat berubah antar Spring Security release.
```

---

## 17. JWT di Java Tanpa Spring

Untuk Java non-Spring, jangan menulis verifier JWT manual dari nol kecuali untuk pembelajaran.

Gunakan library JOSE/JWT matang, misalnya:

1. Nimbus JOSE + JWT,
2. jose4j,
3. Auth0 java-jwt,
4. vendor SDK resmi jika memakai IdP tertentu.

Namun tetap pahami validasi yang dilakukan library.

Pseudo-code yang benar:

```java
public AuthenticationResult authenticateBearer(String rawHeader) {
    BearerToken token = extractor.extract(rawHeader);

    JwtHeader header = joseParser.peekHeader(token.value());
    IssuerConfig issuerConfig = issuerResolver.resolveExpectedIssuer(header, token.value());

    if (!issuerConfig.allowedAlgorithms().contains(header.alg())) {
        return AuthenticationResult.invalid("unsupported_algorithm");
    }

    PublicKey key = issuerConfig.keyResolver().resolve(header.kid(), header.alg());

    VerifiedJwt jwt = jwtVerifier.verify(token.value(), key, issuerConfig.allowedAlgorithms());

    claimValidator.validateIssuer(jwt, issuerConfig.issuer());
    claimValidator.validateAudience(jwt, issuerConfig.audience());
    claimValidator.validateTime(jwt, clock, issuerConfig.clockSkew());
    claimValidator.validateTokenType(jwt, "access_token");
    claimValidator.validateTenant(jwt);

    Principal principal = principalMapper.map(jwt);
    return AuthenticationResult.success(principal, jwt.claims());
}
```

Yang tidak boleh:

```java
String[] parts = token.split("\\.");
String json = new String(Base64.getUrlDecoder().decode(parts[1]));
Map<String, Object> claims = objectMapper.readValue(json, Map.class);
return new User((String) claims.get("sub"));
```

Itu hanya decoding, bukan authentication.

---

## 18. Claim Mapping ke Java Authentication Object

Dalam aplikasi Java, hasil validasi JWT biasanya dipetakan ke:

1. `Principal`,
2. Spring `Authentication`,
3. Jakarta `CallerPrincipal`,
4. custom `AuthenticatedActor`,
5. domain `UserContext`,
6. audit `ActorSnapshot`.

Pattern yang baik:

```java
public record AuthenticatedActor(
    String issuer,
    String subject,
    String principalId,
    String tenantId,
    Set<String> scopes,
    Set<String> roles,
    Instant authenticatedAt,
    Instant tokenIssuedAt,
    Instant tokenExpiresAt,
    String tokenId,
    String clientId,
    AuthenticationStrength strength
) {}
```

Pisahkan:

```text
raw JWT claims        -> data dari token
validated identity    -> identity yang sudah dipercaya
application principal -> representasi internal
authorization subject -> input policy decision
audit actor snapshot  -> data untuk forensic
```

Jangan membiarkan seluruh claim map liar menyebar ke seluruh codebase.

Lebih baik:

```text
JWT boundary adapter -> maps claims -> typed authentication context
```

---

## 19. Scope, Role, Authority, Permission

JWT sering berisi `scope` atau `roles`.

Contoh OAuth2 style:

```json
"scope": "case:read case:write appeal:submit"
```

Contoh Keycloak-style:

```json
"realm_access": {
  "roles": ["case-officer", "admin"]
}
```

Contoh resource access:

```json
"resource_access": {
  "case-api": {
    "roles": ["reviewer"]
  }
}
```

Jangan campur aduk:

| Konsep | Arti |
|---|---|
| Scope | Delegated access grant, biasanya OAuth2 |
| Role | Kelompok tanggung jawab/kapabilitas |
| Authority | Istilah framework untuk granted permission input |
| Permission | Aksi spesifik terhadap resource |
| Entitlement | Hak akses enterprise yang bisa lebih kompleks |

Mapping buruk:

```text
JWT role ADMIN -> bisa semua hal
```

Mapping lebih baik:

```text
JWT claim -> normalized authorities -> policy engine/resource checks
```

Contoh:

```text
scope case:approve
role senior_case_officer
tenant CEA
resource case.assignedAgency = CEA
resource status = PENDING_APPROVAL
policy allows APPROVE
```

---

## 20. Tenant and Audience Confusion

Dalam multi-tenant system, validasi JWT harus memasukkan tenant model.

Contoh token:

```json
{
  "iss": "https://idp.example.com/realms/platform",
  "sub": "user-123",
  "aud": "case-api",
  "tenant_id": "agency-a",
  "roles": ["admin"]
}
```

Pertanyaan:

1. Apakah `tenant_id` diterbitkan oleh issuer terpercaya?
2. Apakah user memang terdaftar di tenant itu?
3. Apakah role `admin` tenant-scoped atau global?
4. Apakah request path tenant sama dengan claim tenant?
5. Apakah resource tenant sama dengan claim tenant?

Contoh endpoint:

```http
GET /tenants/agency-b/cases/123
Authorization: Bearer token-with-tenant-agency-a
```

Validasi harus menolak jika tenant mismatch.

Rule:

```text
Tenant claim tidak boleh hanya dipakai untuk filtering UI.
Tenant claim harus menjadi invariant di resource access.
```

---

## 21. JWT dan Logout

JWT access token yang sudah diterbitkan biasanya tetap valid sampai `exp`, kecuali ada mekanisme tambahan.

Ini mengejutkan bagi banyak tim.

Jika user logout:

```text
Browser session/client session hilang.
Tetapi access token yang dicuri sebelum logout bisa tetap valid sampai expired.
```

Solusi:

1. access token sangat pendek,
2. refresh token revoke saat logout,
3. denylist by `jti` untuk high-risk events,
4. introspection untuk token yang perlu central control,
5. session-bound token,
6. proof-of-possession token,
7. back-channel logout integration,
8. continuous access evaluation.

Trade-off:

```text
Semakin real-time revocation, semakin banyak state/coordination.
```

JWT bukan pilihan buruk. Tetapi jangan menjanjikan instant logout jika arsitektur JWT stateless tidak mendukungnya.

---

## 22. JWT Lifetime Design

Access token lifetime harus dipilih berdasarkan risk.

Contoh guideline kasar:

| Context | Access Token Lifetime |
|---|---:|
| Public SPA high risk | 5–15 menit |
| BFF web app | 5–30 menit |
| Internal enterprise app | 10–30 menit |
| Machine-to-machine | 5–60 menit |
| Batch job | short token per run atau per operation |
| Highly sensitive operation | step-up token sangat pendek |

Pertimbangan:

1. token theft window,
2. issuer availability,
3. refresh token strategy,
4. user experience,
5. clock skew,
6. API call duration,
7. async processing delay,
8. gateway caching,
9. incident response,
10. regulatory expectation.

Hindari:

```text
access token berlaku 24 jam karena refresh token belum diimplementasi
```

Itu sering menjadi security debt besar.

---

## 23. Refresh Token Bukan Access Token Panjang

Kesalahan umum:

```text
Access token dibuat 7 hari supaya user tidak sering login.
```

Yang lebih benar:

```text
Access token pendek.
Refresh token dipakai untuk mendapatkan access token baru.
Refresh token punya proteksi, rotasi, revocation, dan reuse detection.
```

Access token dikirim ke resource server.
Refresh token hanya ke authorization server/token endpoint.

Resource server biasa tidak perlu menerima refresh token.

Diagram:

```text
Client -> API
  uses access token

Client -> Authorization Server
  uses refresh token to obtain new access token
```

Jika refresh token bocor, dampaknya besar. Maka refresh token perlu:

1. secure storage,
2. rotation,
3. reuse detection,
4. sender-constraining jika mungkin,
5. device/session binding,
6. revocation,
7. audit event.

---

## 24. JWT Revocation Patterns

### 24.1 Short-Lived Token Only

```text
Do nothing until exp.
```

Kelebihan:

1. sederhana,
2. scalable,
3. no central lookup.

Kekurangan:

1. token bocor tetap valid sampai expiry,
2. logout tidak instan,
3. permission change tidak langsung efektif.

### 24.2 Denylist by `jti`

```text
Jika token dicabut, simpan jti sampai exp.
```

Kelebihan:

1. targeted revocation,
2. bisa handle incident.

Kekurangan:

1. butuh lookup/cache,
2. jti wajib unik,
3. storage bisa besar,
4. race condition.

### 24.3 User Version / Session Version

Token berisi:

```json
"session_version": 12
```

Server menyimpan current version.

Jika user logout all devices:

```text
increment session_version
```

Kelebihan:

1. revoke banyak token sekaligus,
2. efisien.

Kekurangan:

1. butuh state lookup,
2. kurang granular.

### 24.4 `iat` Cutoff

Server menyimpan:

```text
user.tokens_valid_after = 2026-06-19T10:00:00Z
```

Token dengan `iat` sebelum cutoff ditolak.

Kelebihan:

1. revoke token lama,
2. berguna setelah password reset/compromise.

Kekurangan:

1. butuh lookup,
2. bergantung akurasi `iat`,
3. tidak granular per token.

### 24.5 Introspection

JWT tetap bisa diintrospect ke issuer.

Kelebihan:

1. central policy,
2. revocation real-time,
3. cocok enterprise.

Kekurangan:

1. latency,
2. issuer dependency,
3. cache complexity.

---

## 25. JWT Storage di Browser

Topik ini sering diperdebatkan.

Pilihan umum:

| Storage | Kelebihan | Risiko |
|---|---|---|
| Memory only | lebih kecil exposure persistent theft | hilang saat refresh tab |
| localStorage | mudah | accessible by JS, XSS impact besar |
| sessionStorage | per-tab-ish | tetap accessible by JS |
| HttpOnly cookie | tidak accessible by JS | CSRF, cookie semantics |
| BFF server session | token tidak ke browser | butuh backend session |

Untuk high-security web app, BFF sering lebih defensible:

```text
Browser <-> BFF: secure session cookie
BFF <-> API: access token server-side
```

Dengan begitu access token tidak berada di JavaScript runtime browser.

Namun BFF menambah:

1. server state,
2. scaling concern,
3. session management,
4. CSRF defense,
5. architecture complexity.

Tidak ada jawaban universal. Yang penting adalah threat model.

---

## 26. JWT Size and Header Bloat

JWT bisa besar.

Penyebab:

1. banyak roles/groups,
2. nested claim,
3. x5c certificate chain,
4. long issuer URL,
5. RSA signature,
6. custom metadata berlebihan.

Dampak:

1. HTTP header terlalu besar,
2. gateway menolak request,
3. reverse proxy error 431,
4. cookie size limit,
5. latency meningkat,
6. log noise,
7. mobile bandwidth waste.

Design rule:

```text
Token bukan database portable.
Masukkan claim yang dibutuhkan resource server untuk keputusan cepat, bukan seluruh profil user.
```

Jika group terlalu banyak:

1. gunakan scope yang lebih ringkas,
2. gunakan entitlement lookup server-side,
3. gunakan opaque token,
4. gunakan token exchange per API,
5. gunakan resource-specific roles.

---

## 27. Privacy and Sensitive Data

JWT payload biasanya hanya Base64URL encoded, bukan encrypted.

Artinya siapa pun yang memegang token dapat membaca payload.

Jangan masukkan:

1. NIK/passport/national ID,
2. alamat rumah,
3. informasi kesehatan,
4. data finansial,
5. credential,
6. secret,
7. internal risk score sensitif,
8. full permission matrix rahasia,
9. PII tidak perlu,
10. data yang tidak boleh muncul di log.

Jika harus menyembunyikan payload, pertimbangkan JWE. Namun JWE menambah kompleksitas besar.

Sering kali solusi lebih baik:

```text
JWT hanya memuat stable opaque subject ID.
PII diambil dari trusted userinfo/profile service jika benar-benar dibutuhkan.
```

---

## 28. Common JWT Vulnerabilities

### 28.1 Accepting `alg=none`

Mitigasi:

```text
hard reject unsecured JWT untuk authentication.
```

### 28.2 Algorithm confusion

Mitigasi:

```text
allowlist algorithm per issuer.
```

### 28.3 Missing audience validation

Mitigasi:

```text
resource server wajib validate aud.
```

### 28.4 Missing issuer validation

Mitigasi:

```text
exact issuer match.
```

### 28.5 Trusting `kid` too much

Mitigasi:

```text
kid hanya selector dalam trusted JWKS.
```

### 28.6 Auto-following `jku`

Mitigasi:

```text
ignore untrusted jku/x5u or strict allowlist.
```

### 28.7 Long-lived access tokens

Mitigasi:

```text
short lifetime + refresh token lifecycle.
```

### 28.8 Using ID token as API token

Mitigasi:

```text
validate token type and audience.
```

### 28.9 Storing sensitive PII in payload

Mitigasi:

```text
minimal claims.
```

### 28.10 Blindly mapping roles

Mitigasi:

```text
normalize and enforce policy server-side.
```

---

## 29. JWT and CSRF/XSS

JWT tidak otomatis membuat aplikasi bebas CSRF atau XSS.

### 29.1 Bearer Token in Authorization Header

Biasanya tidak otomatis dikirim browser cross-site, sehingga CSRF lebih kecil.

Namun jika XSS terjadi, attacker bisa:

1. membaca token dari localStorage/sessionStorage,
2. membuat request sebagai user,
3. exfiltrate token,
4. persist access sampai token expired.

### 29.2 JWT in Cookie

Cookie otomatis dikirim browser.

Maka CSRF relevan.

Mitigasi:

1. SameSite,
2. CSRF token,
3. origin validation,
4. custom header requirement,
5. strict CORS,
6. avoid unsafe GET.

Namun HttpOnly cookie membantu melawan token theft via XSS.

Trade-off:

```text
Authorization header token: CSRF lebih kecil, XSS exfiltration lebih besar jika token di JS storage.
HttpOnly cookie token/session: XSS exfiltration lebih kecil, CSRF perlu dikelola.
```

---

## 30. JWT in Gateway Architecture

Gateway sering melakukan validasi JWT di edge.

Pertanyaan penting:

1. Apakah downstream service juga validate token?
2. Apakah gateway mengirim raw token atau header hasil validasi?
3. Apakah header dari client bisa spoof?
4. Apakah internal network dipercaya?
5. Apakah service-to-service mTLS dipakai?
6. Apakah audience downstream berbeda?
7. Apakah token exchange dibutuhkan?
8. Apakah audit actor diteruskan dengan aman?

Pattern buruk:

```text
Gateway validates JWT.
Gateway forwards X-User-Id.
Internal service trusts X-User-Id from anyone on network.
```

Pattern lebih baik:

```text
Gateway validates external token.
Gateway strips all inbound identity headers.
Gateway injects signed internal assertion or performs token exchange.
Downstream validates internal token/audience.
Network uses mTLS/service identity.
```

Atau:

```text
Each service validates original token with correct audience.
```

Tergantung architecture.

---

## 31. JWT in Microservices

Dalam microservices, satu JWT sering dipakai terlalu jauh.

Contoh buruk:

```text
frontend gets token aud=frontend-client
same token sent to gateway, case-api, payment-api, document-api
all services accept it
```

Masalah:

1. audience tidak spesifik,
2. blast radius besar,
3. downstream service tidak tahu token untuk siapa,
4. confused deputy,
5. privilege leakage.

Pattern lebih baik:

```text
external access token -> gateway/BFF
BFF performs token exchange -> API-specific access token
service A calls service B with token audience=service-B
```

Principle:

```text
Token should be audience-bound.
```

---

## 32. JWT and Async/Event Processing

JWT dalam asynchronous message sering bermasalah karena waktu.

Contoh:

```text
User submits case at 10:00
Message consumed at 10:45
JWT expired at 10:15
```

Pertanyaan:

1. Apakah consumer harus validate JWT saat consume?
2. Apakah event mewakili authenticated action pada waktu publish?
3. Apakah actor snapshot cukup?
4. Apakah consumer menjalankan sebagai system actor?
5. Apakah user authorization harus dicek ulang saat processing?

Pattern yang sering lebih baik:

```text
At command acceptance time:
- validate JWT
- authorize command
- persist command/event with actor snapshot
- process async as system actor with audit link to original actor
```

Jangan mengandalkan JWT user yang mungkin expired untuk proses async panjang.

---

## 33. Error Handling

Bearer token error response biasanya:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token"
```

Guideline:

1. client perlu tahu re-auth atau refresh,
2. attacker tidak perlu tahu detail internal,
3. log internal harus cukup detail,
4. response eksternal harus aman.

Contoh aman:

```json
{
  "error": "unauthorized",
  "message": "Invalid or expired access token"
}
```

Log internal:

```text
reason=audience_mismatch issuer=https://idp.example.com expected_aud=case-api actual_aud=document-api kid=rsa-2026-04-01 token_jti_hash=...
```

Jangan log raw JWT.

---

## 34. Observability for JWT Authentication

Metric penting:

1. token validation success count,
2. invalid signature count,
3. expired token count,
4. issuer mismatch count,
5. audience mismatch count,
6. unsupported alg count,
7. unknown kid count,
8. JWKS fetch latency,
9. JWKS refresh failures,
10. authentication failure rate by route/client.

Log field aman:

```text
correlation_id
issuer
audience
subject_hash
client_id
kid
alg
jti_hash
failure_reason
resource_path
http_method
source_ip_hash
user_agent_hash
```

Jangan log:

1. raw JWT,
2. refresh token,
3. full PII claims,
4. private key,
5. client secret.

Audit event:

```json
{
  "eventType": "ACCESS_TOKEN_ACCEPTED",
  "issuer": "https://idp.example.com/realms/aceas",
  "subjectHash": "sha256:...",
  "audience": "case-api",
  "clientId": "aceas-web-bff",
  "tokenIdHash": "sha256:...",
  "authStrength": "MFA",
  "occurredAt": "2026-06-19T10:15:30Z",
  "correlationId": "..."
}
```

---

## 35. Testing Strategy

JWT testing harus mencakup positive dan negative cases.

### 35.1 Positive Cases

1. valid token accepted,
2. valid token with rotated new key accepted,
3. valid token with old key accepted until expiry,
4. valid scope mapped correctly,
5. multiple audiences handled correctly,
6. tenant claim accepted when matches resource.

### 35.2 Negative Cases

1. expired token rejected,
2. not-before future token rejected,
3. wrong issuer rejected,
4. wrong audience rejected,
5. invalid signature rejected,
6. unsupported alg rejected,
7. `alg=none` rejected,
8. unknown kid rejected,
9. token with missing exp rejected,
10. token with ID-token type rejected by API,
11. tenant mismatch rejected,
12. role from wrong resource ignored,
13. malformed token rejected,
14. huge token rejected,
15. duplicate claim behavior tested if library relevant.

### 35.3 Test Key Setup

Gunakan test key khusus.

Jangan memakai production JWKS dalam test.

Pattern:

```text
src/test/resources/keys/test-rsa-private.pem
src/test/resources/keys/test-rsa-public.jwk
```

Atau generate ephemeral key saat test.

### 35.4 WireMock for JWKS

Test JWKS caching:

1. JWKS endpoint returns key A,
2. token signed with key A accepted,
3. rotate to key B,
4. token signed with key B triggers refresh,
5. token signed with removed key rejected only after expected policy.

---

## 36. Performance Considerations

JWT validation cost terdiri dari:

1. token extraction,
2. base64url decode,
3. JSON parse,
4. key lookup,
5. signature verification,
6. claim validation,
7. authority mapping.

Signature verification lebih mahal dari claim validation.

General performance rules:

1. cache JWKS,
2. avoid remote call per request,
3. avoid repeated parsing in same request,
4. store validated authentication context,
5. do not introspect unless needed,
6. set header size limits,
7. benchmark algorithm choice,
8. avoid huge claims,
9. protect against token parsing DoS,
10. use connection timeout for metadata/JWKS fetch.

Jangan cache authentication by raw token tanpa memikirkan:

1. memory growth,
2. token expiry,
3. revocation,
4. tenant isolation,
5. cache poisoning,
6. key rotation.

---

## 37. Java 8 hingga 25: Relevance

### 37.1 Java 8

Java 8 masih banyak di enterprise legacy.

Pertimbangan:

1. TLS/provider support lebih tua,
2. library modern mungkin butuh versi lebih baru,
3. date/time API sudah ada (`java.time`), gunakan untuk claim time,
4. JKS/PKCS12 realities,
5. strong crypto policy historically relevant,
6. framework Spring Security versi lama punya konfigurasi berbeda.

### 37.2 Java 11/17

Java 11/17 sering menjadi baseline modern enterprise.

Pertimbangan:

1. TLS stack lebih modern,
2. long-term support ecosystem matang,
3. library JOSE modern lebih nyaman,
4. container/cloud deployment umum,
5. Spring Boot 3 butuh Java 17.

### 37.3 Java 21

Java 21 membawa virtual threads sebagai fitur production.

Dampak JWT:

1. authentication context propagation harus jelas,
2. jangan rely pada ThreadLocal secara buta di async boundary,
3. resource server dapat menangani blocking metadata fetch lebih baik, tetapi tetap jangan fetch per request,
4. structured concurrency bisa membantu request-scoped operation.

### 37.4 Java 25

Java 25 memperkuat area crypto/key material melalui fitur platform terbaru seperti API dan encoding terkait cryptographic objects.

Dampak konseptual:

1. key material handling makin penting,
2. PEM support dapat menyederhanakan integrasi key modern,
3. KDF API relevan untuk secret derivation di sistem yang butuh key derivation,
4. authentication system harus makin disiplin terhadap key lifecycle.

Tetapi JWT validation best practice tetap sama:

```text
strict issuer, audience, algorithm, key, lifetime, and claim validation.
```

---

## 38. Production Design Checklist

Sebelum menerima JWT di service Java, jawab ini:

### 38.1 Issuer and Trust

- [ ] Apakah issuer dikonfigurasi eksplisit?
- [ ] Apakah issuer dibandingkan exact match?
- [ ] Apakah multi-issuer punya config terpisah?
- [ ] Apakah issuer discovery diamankan?

### 38.2 Algorithm and Key

- [ ] Apakah algorithm di-allowlist per issuer?
- [ ] Apakah `none` ditolak?
- [ ] Apakah HS/RS confusion dicegah?
- [ ] Apakah JWKS URL trusted/configured?
- [ ] Apakah `kid` hanya selector?
- [ ] Apakah key rotation diuji?

### 38.3 Claims

- [ ] Apakah `iss` divalidasi?
- [ ] Apakah `aud` divalidasi?
- [ ] Apakah `exp` wajib?
- [ ] Apakah `nbf` divalidasi jika ada?
- [ ] Apakah clock skew masuk akal?
- [ ] Apakah token type dibedakan?
- [ ] Apakah subject format divalidasi?
- [ ] Apakah tenant claim divalidasi terhadap resource?

### 38.4 Lifecycle

- [ ] Apakah access token short-lived?
- [ ] Apakah refresh token tidak diterima resource server?
- [ ] Apakah logout expectation jelas?
- [ ] Apakah revocation strategy ada untuk incident?
- [ ] Apakah permission change latency dipahami?

### 38.5 Application Mapping

- [ ] Apakah claim mapping typed dan centralized?
- [ ] Apakah raw claims tidak menyebar liar?
- [ ] Apakah role/scope mapping resource-specific?
- [ ] Apakah authorization tetap policy/resource based?

### 38.6 Operations

- [ ] Apakah raw token tidak dilog?
- [ ] Apakah failure reason dilog aman?
- [ ] Apakah metric validasi tersedia?
- [ ] Apakah JWKS failure termonitor?
- [ ] Apakah runbook key rotation ada?

---

## 39. Reference Architecture: Java Resource Server dengan JWT

```text
                +----------------------+
                | Authorization Server |
                | /issuer metadata     |
                | /jwks                |
                +----------+-----------+
                           |
                           | publishes public keys
                           v
+--------+         +-------+---------+         +-------------------+
| Client | ------> | Java API        | ------> | Domain Service    |
|        | Bearer  | Resource Server |         | Authorization     |
+--------+ token   +-------+---------+         +-------------------+
                           |
                           v
                 +-------------------+
                 | JWT Validator     |
                 | - issuer          |
                 | - alg             |
                 | - key             |
                 | - signature       |
                 | - claims          |
                 +-------------------+
                           |
                           v
                 +-------------------+
                 | AuthenticatedActor|
                 +-------------------+
                           |
                           v
                 +-------------------+
                 | Policy Decision   |
                 +-------------------+
```

Invariant:

```text
No domain operation runs from raw decoded JWT.
Every domain operation receives a validated, typed actor context.
```

---

## 40. Reference Architecture: BFF with Server-Side Token Handling

```text
Browser
  |
  | Secure HttpOnly SameSite Cookie
  v
BFF Java App
  |
  | stores tokens server-side or encrypted server session
  v
Authorization Server
  |
  | access token
  v
Backend APIs
```

Advantages:

1. access token not exposed to browser JS,
2. refresh token safer server-side,
3. easier CSRF/session controls,
4. better audit and logout handling,
5. centralized frontend auth logic.

Trade-offs:

1. BFF state,
2. scaling session store,
3. CSRF design,
4. operational complexity,
5. tighter coupling frontend/backend.

---

## 41. Anti-Patterns

### Anti-pattern 1 — Decode Without Verify

```java
Map<String, Object> claims = decodePayload(jwt);
String user = claims.get("sub").toString();
```

Bahaya:

```text
attacker can forge payload.
```

### Anti-pattern 2 — Trust All Issuers

```text
Any valid signature from any configured IdP is accepted by all APIs.
```

Bahaya:

```text
cross-issuer confusion.
```

### Anti-pattern 3 — No Audience Validation

```text
API accepts token issued for another client/service.
```

Bahaya:

```text
token substitution.
```

### Anti-pattern 4 — JWT as Long-Lived Session

```text
JWT exp = 30 days
No revocation
Stored in localStorage
```

Bahaya:

```text
stolen token = long-lived account access.
```

### Anti-pattern 5 — Put Everything in JWT

```text
roles, groups, permissions, profile, org chart, email, phone, address
```

Bahaya:

```text
privacy leak, header bloat, stale authorization.
```

### Anti-pattern 6 — Client-Decided Roles

```text
Frontend sends JWT-like token signed by app secret embedded in frontend.
```

Bahaya:

```text
secret is public, roles forgeable.
```

### Anti-pattern 7 — Accept ID Token at API

Bahaya:

```text
wrong token type and audience.
```

### Anti-pattern 8 — Ignore Key Rotation

Bahaya:

```text
outage or inability to revoke compromised key.
```

### Anti-pattern 9 — Log Raw Token

Bahaya:

```text
logs become credential store.
```

### Anti-pattern 10 — Map JWT Role Directly to Database Admin

Bahaya:

```text
claim mapping bug becomes privilege escalation.
```

---

## 42. Deep Design Questions

Gunakan pertanyaan ini saat review arsitektur JWT:

1. Token ini diterbitkan oleh siapa?
2. Service mana yang menjadi audience token ini?
3. Apakah token ini access token atau ID token?
4. Apakah token bisa dipakai ulang ke service lain?
5. Apa yang terjadi jika token dicuri?
6. Berapa lama token curian tetap valid?
7. Bagaimana token dicabut saat user logout?
8. Bagaimana token dicabut saat account compromised?
9. Bagaimana key signing dirotasi?
10. Apa yang terjadi jika JWKS endpoint down?
11. Apa yang terjadi jika `kid` tidak ditemukan?
12. Apakah permission update langsung efektif?
13. Apakah tenant mismatch dicegah?
14. Apakah raw token pernah masuk log?
15. Apakah token memuat PII?
16. Apakah API menerima token dari banyak issuer?
17. Apakah setiap issuer punya audience dan claim mapping berbeda?
18. Apakah downstream service memvalidasi lagi?
19. Apakah gateway dapat disalahgunakan untuk spoof identity header?
20. Apakah test suite punya negative JWT cases?

---

## 43. Mini Case Study: Regulatory Case Management API

Konteks:

```text
Aplikasi case management regulatory.
User login via central IdP.
Frontend memanggil Case API, Appeal API, Document API.
Ada tenant/agency.
Ada role case officer, reviewer, approver, admin.
Audit defensibility penting.
```

### 43.1 Desain Buruk

```text
- Semua API menerima token aud=frontend-client.
- Role admin dari token langsung dianggap boleh approve semua case.
- Token berlaku 12 jam.
- JWT disimpan di localStorage.
- API tidak validate tenant claim terhadap resource.
- Raw JWT dilog saat error.
```

Failure scenario:

```text
XSS mencuri token admin.
Token berlaku 12 jam.
Attacker memanggil Document API walaupun token bukan audience Document API.
Tenant claim agency-A dipakai untuk akses case agency-B karena API lupa cek resource tenant.
Log menyimpan token dan memperpanjang blast radius.
```

### 43.2 Desain Lebih Baik

```text
- Browser memakai BFF session cookie.
- Access token disimpan server-side di BFF.
- API token audience-specific: case-api, appeal-api, document-api.
- Access token lifetime 10 menit.
- Refresh token server-side dengan rotation.
- Case API validate issuer, aud, exp, nbf, alg, kid.
- Tenant claim wajib match resource tenant.
- Role hanya input policy, bukan final decision.
- Approval butuh step-up claim acr >= level2.
- Raw JWT tidak pernah dilog.
- Audit menyimpan actor snapshot dengan subject hash, issuer, tenant, auth strength, jti hash.
```

Invariant:

```text
A user can act only within tenant/resource/policy boundaries proven at request time.
```

---

## 44. Implementation Skeleton: Plain Java Validator Boundary

Berikut skeleton arsitektur, bukan library lengkap.

```java
public interface BearerAuthenticator {
    AuthenticatedActor authenticate(String authorizationHeader) throws AuthenticationException;
}
```

```java
public final class JwtBearerAuthenticator implements BearerAuthenticator {
    private final BearerTokenExtractor extractor;
    private final JwtVerifier verifier;
    private final JwtClaimValidator claimValidator;
    private final JwtActorMapper actorMapper;

    public JwtBearerAuthenticator(
            BearerTokenExtractor extractor,
            JwtVerifier verifier,
            JwtClaimValidator claimValidator,
            JwtActorMapper actorMapper
    ) {
        this.extractor = extractor;
        this.verifier = verifier;
        this.claimValidator = claimValidator;
        this.actorMapper = actorMapper;
    }

    @Override
    public AuthenticatedActor authenticate(String authorizationHeader) {
        BearerToken token = extractor.extract(authorizationHeader);
        VerifiedJwt jwt = verifier.verify(token.value());
        claimValidator.validate(jwt);
        return actorMapper.map(jwt);
    }
}
```

```java
public record VerifiedJwt(
    String issuer,
    String subject,
    Set<String> audience,
    Instant issuedAt,
    Instant expiresAt,
    Optional<Instant> notBefore,
    Optional<String> jwtId,
    String algorithm,
    String keyId,
    Map<String, Object> claims
) {}
```

```java
public final class JwtClaimValidator {
    private final String expectedIssuer;
    private final String expectedAudience;
    private final Clock clock;
    private final Duration allowedClockSkew;

    public void validate(VerifiedJwt jwt) {
        requireEqual("issuer", expectedIssuer, jwt.issuer());
        requireAudience(jwt.audience());
        requireNotExpired(jwt.expiresAt());
        requireAlreadyValid(jwt.notBefore());
        requireReasonableIssuedAt(jwt.issuedAt());
        requireSubject(jwt.subject());
    }

    private void requireAudience(Set<String> audience) {
        if (!audience.contains(expectedAudience)) {
            throw new AuthenticationException("invalid_token");
        }
    }

    private void requireNotExpired(Instant expiresAt) {
        Instant now = clock.instant();
        if (!now.minus(allowedClockSkew).isBefore(expiresAt)) {
            throw new AuthenticationException("invalid_token");
        }
    }

    private void requireAlreadyValid(Optional<Instant> notBefore) {
        if (notBefore.isEmpty()) {
            return;
        }
        Instant now = clock.instant();
        if (now.plus(allowedClockSkew).isBefore(notBefore.get())) {
            throw new AuthenticationException("invalid_token");
        }
    }

    private void requireReasonableIssuedAt(Instant issuedAt) {
        Instant now = clock.instant();
        if (issuedAt.isAfter(now.plus(allowedClockSkew))) {
            throw new AuthenticationException("invalid_token");
        }
    }

    private void requireSubject(String subject) {
        if (subject == null || subject.isBlank()) {
            throw new AuthenticationException("invalid_token");
        }
    }

    private void requireEqual(String name, String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AuthenticationException("invalid_token");
        }
    }
}
```

Important:

```text
JwtVerifier di atas harus memakai JOSE/JWT library matang.
Jangan implement cryptographic verification manual kecuali benar-benar memahami JOSE.
```

---

## 45. Summary

JWT adalah format token yang powerful tetapi mudah disalahgunakan.

Poin utama:

1. JWT adalah signed claims assertion, bukan session ajaib.
2. Decode bukan verify.
3. Signature verification bukan full validation.
4. Validasi issuer dan audience adalah wajib untuk resource server.
5. Algorithm harus di-allowlist oleh verifier, bukan dipercaya dari header.
6. `kid` hanya key selector, bukan sumber trust.
7. ID token tidak boleh dipakai sebagai access token API.
8. JWT payload tidak terenkripsi secara default.
9. Long-lived JWT meningkatkan blast radius token theft.
10. Revocation membutuhkan state atau lifecycle tambahan.
11. Claim role/scope adalah input authorization, bukan keputusan final.
12. Multi-tenant JWT harus mencegah tenant confusion.
13. Gateway identity forwarding harus aman dari spoofing.
14. Jangan log raw token.
15. Testing JWT harus penuh negative cases.

Mental model akhir:

```text
JWT authentication yang benar adalah pipeline validasi trust:
issuer -> algorithm -> key -> signature -> claims -> context -> authorization.
```

Jika salah satu tahap dilewati, sistem mungkin masih terlihat berjalan, tetapi trust model-nya sudah rusak.

---

## 46. Latihan Pemahaman

Jawab tanpa melihat materi:

1. Mengapa JWT bukan session replacement otomatis?
2. Apa perbedaan ID token dan access token?
3. Mengapa audience validation penting?
4. Apa risiko menerima `alg` dari header tanpa allowlist?
5. Mengapa `kid` tidak boleh dipakai sebagai trust source?
6. Bagaimana strategi key rotation yang aman?
7. Apa yang terjadi ketika user logout tetapi access token JWT belum expired?
8. Mengapa custom role claim tidak boleh langsung menjadi final authorization?
9. Bagaimana cara mencegah tenant confusion?
10. Mengapa raw JWT tidak boleh masuk log?

---

## 47. Referensi Resmi dan Lanjutan

1. RFC 7519 — JSON Web Token (JWT).
2. RFC 8725 — JSON Web Token Best Current Practices.
3. RFC 7515 — JSON Web Signature (JWS).
4. RFC 7516 — JSON Web Encryption (JWE).
5. RFC 7517 — JSON Web Key (JWK).
6. RFC 7518 — JSON Web Algorithms (JWA).
7. OAuth 2.0 Bearer Token Usage.
8. OpenID Connect Core.
9. OAuth 2.0 Security Best Current Practice / RFC 9700.
10. OWASP JSON Web Token for Java Cheat Sheet.
11. OWASP REST Security Cheat Sheet.
12. Spring Security OAuth2 Resource Server JWT Reference.
13. Nimbus JOSE + JWT documentation.
14. jose4j documentation.

---

## 48. Status Series

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
```

Series belum selesai.

Part berikutnya:

```text
Part 12 — Opaque Token Authentication and Token Introspection
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-010.md">⬅️ Part 10 — HMAC Request Signing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-012.md">Part 12 — Opaque Token Authentication and Token Introspection ➡️</a>
</div>
