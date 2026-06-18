# learn-java-security-cryptography-integrity-part-019

# Part 19 — JSON, JWT, JWS, JWE, JOSE, and Token Integrity

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `019 / 034`  
> Status seri: **belum selesai**  
> Fokus: memahami token JSON/JOSE sebagai security envelope: apa yang dijamin, apa yang tidak dijamin, bagaimana memverifikasi dengan benar, dan bagaimana mencegah bug seperti algorithm confusion, key confusion, `kid` injection, stale JWKS, replay, dan token misuse.

---

## 0. Tujuan Part Ini

Setelah bagian sebelumnya membahas XML security, sekarang kita masuk ke format yang jauh lebih umum di REST, OAuth2, OIDC, microservices, SPA, API gateway, service mesh, dan callback integration: **JSON token security**.

Target bagian ini bukan sekadar bisa `decode JWT`. Targetnya adalah kamu bisa menjawab pertanyaan seperti:

1. Apakah token ini hanya membawa claims, atau benar-benar membuktikan authenticity?
2. Apakah token ini signed, encrypted, atau keduanya?
3. Siapa issuer yang dipercaya?
4. Untuk audience mana token ini valid?
5. Algorithm apa yang boleh dipakai?
6. Key mana yang benar untuk memverifikasi token?
7. Bagaimana jika key rotation terjadi?
8. Bagaimana mencegah replay?
9. Bagaimana membedakan access token, ID token, refresh token, session token, API token, dan internal assertion?
10. Bagaimana membuat token verification boundary yang defensible di Java enterprise system?

Core mental model:

> **JWT bukan security magic. JWT hanyalah container claim. Security-nya datang dari validasi yang benar terhadap cryptographic envelope, trust relationship, claim semantics, lifecycle, dan usage boundary.**

---

## 1. Referensi Utama

Materi ini mengacu pada referensi primer dan guidance security berikut:

1. **RFC 7519 — JSON Web Token (JWT)**  
   JWT adalah compact, URL-safe means untuk merepresentasikan claims antara dua pihak. Claims dapat berada dalam payload JWS atau plaintext JWE.

2. **RFC 7515 — JSON Web Signature (JWS)**  
   JWS merepresentasikan content yang diamankan dengan digital signature atau MAC menggunakan JSON-based data structure.

3. **RFC 7516 — JSON Web Encryption (JWE)**  
   JWE merepresentasikan encrypted content menggunakan JSON-based data structure.

4. **RFC 7517 — JSON Web Key (JWK)**  
   JWK merepresentasikan cryptographic key dalam format JSON.

5. **RFC 7518 — JSON Web Algorithms (JWA)**  
   Mendefinisikan algorithm identifiers untuk JWS, JWE, dan JWK.

6. **RFC 8725 — JSON Web Token Best Current Practices**  
   Guidance modern untuk secure implementation dan deployment JWT. Ini sangat penting karena RFC 7519 mendefinisikan format, sedangkan RFC 8725 banyak membahas praktik aman dan known pitfalls.

7. **OWASP JSON Web Token for Java Cheat Sheet**  
   Guidance spesifik Java untuk mencegah common security issues saat memakai JWT.

8. **OWASP Web Security Testing Guide — Testing JSON Web Tokens**  
   Menjelaskan vulnerability umum JWT dan cara mengujinya.

9. **OWASP REST Security Cheat Sheet**  
   Relevan untuk token usage, revocation, denylist, dan API authorization.

---

## 2. Problem Besar: Banyak Sistem Memperlakukan JWT Sebagai “Login Proof” yang Otomatis Aman

JWT sering digunakan seperti ini:

```text
Client receives token
Client sends Authorization: Bearer <jwt>
Server decodes token
Server reads userId/role
Server allows access
```

Masalahnya: banyak implementasi berhenti di “decode”. Padahal `decode` hanya parsing Base64URL. Security baru terjadi setelah **verify** dan **validate**.

Bedakan tiga operasi:

| Operasi | Makna | Security Guarantee |
|---|---|---|
| Decode | Membaca header/payload Base64URL | Tidak ada guarantee |
| Verify signature/MAC | Memastikan token dibuat oleh pihak yang punya key | Authenticity + integrity, tergantung algorithm dan key |
| Validate claims | Memastikan token valid untuk konteks request saat ini | Correct authorization context |

Kesalahan fatal:

```java
// Salah secara security: hanya decode claims tanpa verifikasi signature.
String[] parts = jwt.split("\\.");
String payloadJson = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
// lalu pakai userId/role dari payload
```

Ini sama seperti menerima surat yang terlihat resmi tanpa memeriksa tanda tangan, cap, alamat tujuan, tanggal berlaku, dan pihak penerbit.

---

## 3. Vocabulary Dasar: JOSE Family

JOSE adalah keluarga standard untuk JSON-based security object.

```text
JOSE
├── JWS  = JSON Web Signature
├── JWE  = JSON Web Encryption
├── JWK  = JSON Web Key
├── JWA  = JSON Web Algorithms
└── JWT  = JSON Web Token
```

### 3.1 JWT

JWT adalah token berbentuk claims.

Contoh compact JWT:

```text
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9
.
eyJpc3MiOiJodHRwczovL2lkcC5leGFtcGxlLmNvbSIsInN1YiI6IjEyMzQ1IiwiYXVkIjoiYXBpIiwiZXhwIjoxNzAwMDAwMDAwfQ
.
<signature>
```

JWT terdiri dari:

```text
header.payload.signature
```

Untuk signed JWT, bentuk compact-nya adalah JWS compact serialization.

### 3.2 JWS

JWS adalah signed/MACed content.

Guarantee:

1. Payload tidak berubah sejak ditandatangani.
2. Payload berasal dari pihak yang memegang signing key atau MAC key.
3. Header protected ikut masuk ke signing input.

JWS tidak memberi confidentiality. Payload bisa dibaca siapa pun yang punya token.

### 3.3 JWE

JWE adalah encrypted content.

Guarantee:

1. Payload tidak bisa dibaca tanpa decryption key.
2. Jika memakai authenticated encryption dengan benar, perubahan ciphertext/tag akan terdeteksi.
3. Recipient tertentu dapat membuka isi.

JWE lebih kompleks daripada JWS dan sering tidak dibutuhkan untuk access token internal jika channel TLS dan token minimisasi sudah benar. Namun JWE berguna saat token melewati banyak komponen yang tidak boleh melihat isi claims.

### 3.4 JWK

JWK adalah representasi key dalam JSON.

Contoh RSA public JWK simplified:

```json
{
  "kty": "RSA",
  "kid": "2026-06-key-1",
  "use": "sig",
  "alg": "RS256",
  "n": "...",
  "e": "AQAB"
}
```

### 3.5 JWKS

JWKS adalah JSON Web Key Set: kumpulan JWK.

Biasanya identity provider menyediakan endpoint seperti:

```text
https://idp.example.com/.well-known/jwks.json
```

Service verifier mengambil public key dari JWKS untuk memverifikasi token.

---

## 4. Mental Model: Token Sebagai Security Envelope

Bayangkan token sebagai amplop.

```text
+----------------------------------------------------+
| Header                                             |
| - alg                                              |
| - typ                                              |
| - kid                                              |
| - cty                                              |
+----------------------------------------------------+
| Payload / Claims                                   |
| - iss                                              |
| - sub                                              |
| - aud                                              |
| - exp                                              |
| - nbf                                              |
| - iat                                              |
| - jti                                              |
| - scope / roles / permissions                      |
+----------------------------------------------------+
| Signature / MAC / Encryption Metadata              |
+----------------------------------------------------+
```

Security token verification harus menjawab:

1. **Envelope valid?**
   - Format benar?
   - Header aman?
   - Algorithm di-allow?
   - Signature/MAC valid?

2. **Issuer trusted?**
   - Token diterbitkan oleh identity provider yang benar?
   - Realm/tenant benar?
   - Environment benar?

3. **Audience benar?**
   - Token memang ditujukan untuk service ini?
   - Bukan token untuk aplikasi lain?

4. **Waktu valid?**
   - Belum expired?
   - Sudah boleh digunakan (`nbf`)?
   - Clock skew dikontrol?

5. **Subject dan authorization semantics benar?**
   - `sub` merepresentasikan siapa?
   - Scope/role dipakai untuk resource apa?
   - Tenant boundary benar?

6. **Lifecycle masih valid?**
   - Token belum revoked?
   - Session masih aktif jika sistem butuh active-session semantics?
   - Key belum dicabut?

7. **Replay risk diterima atau dimitigasi?**
   - Bearer token dapat dipakai siapa pun yang memegang token.
   - Apakah butuh sender-constrained token, nonce, mTLS, DPoP, atau denylist?

---

## 5. JWT Bukan Session Universal

JWT sering dipilih karena “stateless”. Namun stateless bukan selalu lebih aman atau lebih sederhana.

### 5.1 Stateful Session

```text
Client holds opaque session id
Server stores session state
Request validates session id against server-side store
```

Kelebihan:

1. Mudah revoke.
2. Mudah enforce logout.
3. Mudah update role/permission secara cepat.
4. Payload kecil.
5. Lebih sedikit informasi bocor ke client.

Kekurangan:

1. Butuh storage/cache.
2. Butuh replication atau sticky/session strategy.
3. Bisa menjadi bottleneck jika desain buruk.

### 5.2 Stateless JWT

```text
Client holds signed token with claims
Server validates signature and claims
Server does not need lookup for every request
```

Kelebihan:

1. Cocok untuk distributed validation.
2. Mengurangi dependency runtime ke session store.
3. Useful untuk service-to-service assertion.
4. Bisa diverifikasi offline selama public key tersedia.

Kekurangan:

1. Revocation lebih sulit.
2. Claim bisa stale.
3. Token leakage berdampak besar sampai expired.
4. Payload terlihat jika tidak encrypted.
5. Banyak failure mode pada validation.

### 5.3 Rule of Thumb

Gunakan JWT jika:

1. Token lifetime pendek.
2. Token audience jelas.
3. Issuer/key management matang.
4. Revocation requirement tidak ketat atau ada denylist/session check.
5. Token tidak memuat sensitive data.
6. Verification rules dibuat central dan diuji.

Jangan gunakan JWT hanya karena “modern”.

---

## 6. Registered Claims dan Makna Security-nya

RFC 7519 mendefinisikan beberapa registered claims. Tidak semua wajib, tetapi untuk security token biasanya beberapa claim harus dianggap wajib.

| Claim | Nama | Makna |
|---|---|---|
| `iss` | Issuer | Penerbit token |
| `sub` | Subject | Identitas principal |
| `aud` | Audience | Penerima token yang dituju |
| `exp` | Expiration Time | Batas waktu token valid |
| `nbf` | Not Before | Token belum boleh dipakai sebelum waktu ini |
| `iat` | Issued At | Waktu token diterbitkan |
| `jti` | JWT ID | Unique identifier untuk token |

### 6.1 `iss`

`iss` menjawab: siapa yang menerbitkan token?

Kesalahan umum:

```text
Service menerima token dari issuer mana pun selama signature valid.
```

Masalah:

1. Signature valid hanya membuktikan token ditandatangani oleh key tertentu.
2. Key itu harus terkait dengan issuer yang dipercaya.
3. Multi-tenant/multi-realm systems bisa punya banyak issuer.

Invariant:

> Service hanya boleh menerima token dari issuer yang eksplisit di-allow untuk resource tersebut.

### 6.2 `aud`

`aud` menjawab: token ini ditujukan untuk siapa?

Contoh salah:

```text
Access token untuk service-a diterima oleh service-b karena keduanya percaya issuer yang sama.
```

Ini adalah confused audience problem.

Invariant:

> Token untuk audience lain harus ditolak walaupun issuer dan signature valid.

### 6.3 `sub`

`sub` bukan selalu username. `sub` adalah subject identifier dalam konteks issuer.

Kesalahan umum:

1. Menganggap `sub` global unique lintas issuer.
2. Menggunakan email sebagai primary identity padahal email bisa berubah.
3. Menggabungkan user dari dua issuer berbeda hanya karena `sub` sama.

Invariant:

> Identity key minimal harus mempertimbangkan `(issuer, subject)`, bukan `subject` saja.

### 6.4 `exp`

`exp` membatasi lifetime.

Kesalahan umum:

1. Tidak memvalidasi `exp`.
2. Menerima token terlalu lama karena clock skew terlalu besar.
3. Menggunakan access token berjam-jam atau berhari-hari.
4. Mengira logout otomatis membatalkan JWT stateless.

Invariant:

> Token tanpa expiration yang jelas harus ditolak untuk request authentication/authorization.

### 6.5 `nbf`

`nbf` mencegah token dipakai sebelum waktunya.

Gunanya:

1. Delayed validity.
2. Key transition window.
3. Controlled rollout.

### 6.6 `iat`

`iat` berguna untuk:

1. Deteksi token terlalu tua.
2. Session max age.
3. Revocation based on “valid after”.
4. Investigasi incident.

Namun `iat` bukan bukti clock benar kecuali issuer clock dipercaya.

### 6.7 `jti`

`jti` adalah token identifier.

Gunanya:

1. Denylist.
2. Replay detection.
3. Audit correlation.
4. One-time token.

Untuk one-time token, `jti` harus dicek terhadap state store.

---

## 7. Header Claims: Powerful, Dangerous, and Often Misused

JWT header sering terlihat tidak penting, padahal banyak serangan terjadi di header.

Contoh header:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "2026-06-key-1"
}
```

### 7.1 `alg`

`alg` menyatakan algorithm yang dipakai.

Security principle:

> Application tidak boleh membiarkan attacker memilih algorithm secara bebas.

Verifier harus punya allowlist:

```text
issuer A -> allowed alg: RS256 or PS256
issuer B -> allowed alg: ES256
internal token -> allowed alg: EdDSA
```

Jangan:

```text
Baca alg dari token -> pilih verifier sesuai alg -> jika valid, accept.
```

Karena token header dikontrol attacker sebelum diverifikasi.

### 7.2 `typ`

`typ` biasanya `JWT`. Tetapi RFC 8725 menekankan pentingnya explicit typing dalam beberapa konteks untuk mencegah cross-JWT confusion.

Contoh:

```json
{
  "typ": "at+jwt"
}
```

Atau issuer-specific type.

Gunanya:

1. Membedakan access token dan ID token.
2. Membedakan internal assertion dan external bearer token.
3. Mencegah token dipakai di endpoint yang salah.

### 7.3 `kid`

`kid` membantu verifier memilih key.

Risiko:

1. Path traversal jika `kid` dipakai sebagai nama file.
2. SQL injection jika `kid` dipakai dalam query string concat.
3. SSRF jika `kid`/header lain memengaruhi URL fetch key.
4. Key confusion jika `kid` tidak scoped ke issuer.
5. Cache poisoning jika JWKS handling buruk.

Invariant:

> `kid` hanya identifier untuk memilih key dari trust set yang sudah ditentukan, bukan instruksi untuk mengambil key dari tempat arbitrary.

---

## 8. JWS vs JWE: Jangan Salah Guarantee

### 8.1 JWS: Integrity + Authenticity, Tidak Confidentiality

Signed JWT umum berbentuk:

```text
header.payload.signature
```

Payload hanya Base64URL encoded, bukan encrypted.

Artinya:

```text
Siapa pun yang punya token bisa membaca payload.
```

Maka jangan taruh:

1. Password.
2. Secret API key.
3. Sensitive PII.
4. Internal risk score.
5. Authorization detail yang tidak boleh terlihat client.
6. Data investigasi/regulatory yang confidential.

### 8.2 JWE: Confidentiality + Integrity, Lebih Kompleks

JWE compact serialization punya lima bagian:

```text
protectedHeader.encryptedKey.iv.ciphertext.tag
```

JWE berguna jika:

1. Token melewati browser/client yang tidak boleh melihat claims.
2. Token melewati intermediary yang tidak dipercaya.
3. Ada confidentiality requirement pada claims.

Namun JWE tidak menghilangkan kebutuhan validasi claims. Setelah decrypt, claims tetap harus divalidasi.

### 8.3 Nested JWT

Kadang token bisa:

```text
Sign then encrypt
Encrypt then sign
```

Umumnya untuk security envelope, pola yang sering dipakai adalah:

```text
JWS inside JWE
```

Artinya payload ditandatangani, lalu dienkripsi. Penerima decrypt, lalu verify signature.

Tetapi nested JWT meningkatkan kompleksitas. Jangan pakai kecuali requirement jelas.

---

## 9. Algorithm Families dalam JOSE

### 9.1 HMAC-based: HS256, HS384, HS512

Menggunakan shared secret.

Kelebihan:

1. Cepat.
2. Sederhana.

Kekurangan:

1. Semua verifier yang bisa verify juga bisa sign.
2. Sulit untuk multi-service trust boundary.
3. Secret harus disebar ke semua verifier.
4. Jika satu service bocor, semua bisa membuat token valid.

Cocok untuk:

1. Internal system kecil.
2. Single issuer/verifier controlled environment.
3. Token tidak melewati banyak trust domain.

Tidak ideal untuk:

1. Banyak microservices.
2. Third-party verification.
3. Public identity provider scenario.

### 9.2 RSA-based: RS256, PS256

Menggunakan private key untuk sign, public key untuk verify.

Kelebihan:

1. Verifier tidak bisa sign.
2. Cocok untuk distributed verification.
3. JWKS public key bisa dipublikasikan.

Kekurangan:

1. Signature lebih besar.
2. Perlu certificate/key rotation discipline.
3. RSASSA-PKCS1-v1_5 (`RS256`) masih umum, tetapi RSA-PSS (`PS256`) lebih modern secara desain.

### 9.3 ECDSA-based: ES256, ES384, ES512

Kelebihan:

1. Signature lebih kecil daripada RSA.
2. Public key lebih kecil.

Kekurangan:

1. Implementasi harus menangani format signature JOSE dengan benar.
2. ECDSA punya failure mode jika nonce buruk di signing side.
3. Operational debugging kadang lebih sulit.

### 9.4 EdDSA

EdDSA semakin relevan di modern JOSE ecosystem.

Kelebihan:

1. Desain modern.
2. Signature kecil.
3. Tidak bergantung pada random nonce per signature seperti ECDSA tradisional.

Kekurangan:

1. Dukungan library/JDK/provider perlu dicek.
2. Compatibility dengan legacy IdP/API gateway belum universal.

### 9.5 `none`

`none` berarti unsecured JWT.

Untuk production authentication/authorization:

```text
Reject.
```

Jangan “sementara untuk dev” lalu lupa. Jika butuh dev token, buat issuer dev yang jelas, dengan signing key dev, environment isolation, dan claim policy tetap sama.

---

## 10. JWT Verification Pipeline yang Benar

Berikut pipeline konseptual yang lebih aman:

```text
Incoming request
  ↓
Extract bearer token from allowed location
  ↓
Basic structural check
  ↓
Parse protected header safely
  ↓
Resolve expected verifier policy by route/context, not by attacker input alone
  ↓
Check issuer allowlist / token type expectation
  ↓
Resolve key from trusted key set scoped by issuer + kid + alg + use
  ↓
Verify signature/MAC
  ↓
Validate registered claims: iss, aud, exp, nbf, iat, jti
  ↓
Validate application claims: scope, roles, tenant, client_id, acr, amr
  ↓
Apply revocation/session/denylist rules if required
  ↓
Build internal principal object
  ↓
Authorize request using server-side policy
```

Important:

> Jangan langsung menyebarkan raw JWT claims ke business code. Buat canonical internal principal yang sudah tervalidasi.

---

## 11. Java Implementation Mental Model

Java punya banyak library JWT/JOSE. Yang penting bukan library mana, tetapi verification invariant-nya.

### 11.1 Jangan Menulis Verifier Manual

Jangan implement manual:

1. Base64URL parser.
2. JSON canonicalization assumptions.
3. Signature verification input.
4. ECDSA raw/DER conversion.
5. JWK parsing.
6. Algorithm dispatch.

Gunakan library matang dan tetap enforce policy.

### 11.2 Pseudocode Verifier yang Defensible

```java
public final class AccessTokenVerifier {
    private final Map<String, IssuerPolicy> issuerPolicies;
    private final Clock clock;
    private final Duration allowedClockSkew;

    public VerifiedPrincipal verifyAccessToken(String rawToken, String expectedAudience) {
        ParsedHeader header = parseHeaderWithoutTrust(rawToken);

        // Header is untrusted. Use only for constrained selection.
        if (!header.type().equals("at+jwt") && !header.type().equals("JWT")) {
            throw new InvalidTokenException("Unsupported token type");
        }

        UntrustedClaims untrustedClaims = parseClaimsWithoutTrust(rawToken);
        IssuerPolicy policy = issuerPolicies.get(untrustedClaims.issuer());
        if (policy == null) {
            throw new InvalidTokenException("Untrusted issuer");
        }

        if (!policy.allowedAlgorithms().contains(header.algorithm())) {
            throw new InvalidTokenException("Disallowed algorithm");
        }

        VerificationKey key = policy.keyResolver().resolve(header.keyId(), header.algorithm());
        if (key == null) {
            throw new InvalidTokenException("Unknown key");
        }

        VerifiedClaims claims = policy.jwtLibraryVerifier()
                .withAlgorithm(header.algorithm())
                .withKey(key)
                .verify(rawToken);

        validateIssuer(claims, policy.issuer());
        validateAudience(claims, expectedAudience);
        validateTime(claims, clock.instant(), allowedClockSkew);
        validateTokenType(claims, "access_token");
        validateTenant(claims);
        validateScopes(claims);
        validateRevocationIfRequired(claims);

        return toPrincipal(claims);
    }
}
```

Kunci dari pseudocode ini:

1. Header dan claims awal hanya untuk routing ke policy, belum dipercaya.
2. Algorithm tidak diambil bebas dari token.
3. Key resolver scoped oleh issuer.
4. Claim validation eksplisit.
5. Output ke business layer adalah `VerifiedPrincipal`, bukan raw map.

---

## 12. Algorithm Confusion

Algorithm confusion terjadi ketika verifier salah memperlakukan algorithm/key.

Contoh klasik:

```text
Issuer menandatangani token dengan RS256.
Verifier seharusnya menggunakan RSA public key untuk verify.
Attacker mengubah alg menjadi HS256.
Verifier memakai RSA public key sebagai HMAC secret.
Attacker membuat HMAC dengan public key yang diketahui.
Token diterima.
```

Ini terjadi jika library/application:

1. Mengizinkan algorithm dari token tanpa allowlist.
2. Menggunakan satu generic key object untuk banyak algorithm family.
3. Tidak mengikat issuer → algorithm → key type.

Mitigasi:

1. Hardcode expected algorithm per issuer/client/token type.
2. Jangan campur symmetric dan asymmetric algorithm dalam verifier yang sama tanpa policy kuat.
3. Pastikan key type sesuai algorithm.
4. Reject token jika header `alg` tidak persis sesuai allowlist.

Invariant:

> Algorithm adalah bagian dari server-side policy, bukan keputusan attacker-controlled header.

---

## 13. Key Confusion dan `kid` Injection

### 13.1 Key Confusion

Key confusion terjadi saat key yang benar secara cryptographic tetapi salah secara trust context dipakai.

Contoh:

```text
Issuer A dan Issuer B sama-sama punya kid = key-1.
Verifier hanya mencari kid = key-1 global.
Token dari Issuer B diterima sebagai Issuer A.
```

Mitigasi:

```text
Key lookup key = (issuer, kid, algorithm, key_use)
```

Bukan:

```text
Key lookup key = kid
```

### 13.2 `kid` sebagai File Path

Anti-pattern:

```java
Path keyPath = Paths.get("/keys/" + kid + ".pem");
String pem = Files.readString(keyPath);
```

Jika `kid` attacker-controlled:

```text
../../../../etc/passwd
```

Atau:

```text
../../../app/secrets/hmac.key
```

Mitigasi:

1. Treat `kid` as opaque identifier.
2. Allowlist format: short, safe, known pattern.
3. Lookup ke map/database parameterized, bukan path concat.
4. Scope by issuer.
5. Jangan fetch remote URL dari header token.

### 13.3 `jku` / `x5u` Header Risk

Beberapa JOSE header dapat menunjuk key URL atau certificate URL.

Danger:

```text
Attacker membuat token dengan jku=https://attacker.example/jwks.json
Verifier fetch key dari URL itu
Signature valid terhadap attacker key
Token diterima
```

Mitigasi:

1. Ignore dynamic `jku`/`x5u` kecuali benar-benar didesain dan allowlist ketat.
2. JWKS endpoint harus berasal dari issuer metadata yang trusted.
3. Jangan biarkan token menentukan trust source.
4. Enforce HTTPS, hostname allowlist, timeout, cache, size limit.

---

## 14. Claim Confusion: ID Token vs Access Token

Di OIDC, **ID token** dan **access token** memiliki tujuan berbeda.

### 14.1 ID Token

ID token ditujukan untuk client aplikasi. Ia membuktikan user authentication event kepada client.

Biasanya berisi:

1. `iss`
2. `sub`
3. `aud` = client id
4. `nonce`
5. authentication claims

### 14.2 Access Token

Access token ditujukan untuk resource server/API.

Biasanya berisi:

1. `iss`
2. `sub`
3. `aud` = API/resource
4. `scope`
5. `client_id`
6. expiry pendek

### 14.3 Failure Mode

```text
API menerima ID token sebagai bearer token.
```

Kenapa bahaya?

1. ID token audience-nya client, bukan API.
2. Scope authorization API mungkin tidak ada.
3. Semantics token berbeda.
4. Bisa menyebabkan access bypass.

Invariant:

> Resource server harus menerima access token yang audience-nya resource server tersebut, bukan ID token untuk client.

---

## 15. Audience Confusion di Microservices

Contoh sistem:

```text
Auth Server issues token:
  aud = payment-api

Inventory API also trusts same issuer.
```

Jika Inventory API hanya cek signature dan issuer, token payment dapat dipakai ke inventory.

Mitigasi:

1. Set expected audience per service.
2. Reject token tanpa audience atau audience tidak cocok.
3. Untuk multi-audience token, pastikan policy eksplisit.
4. Jangan gunakan `scope` sebagai pengganti `aud`.

Audience menjawab “token untuk siapa”. Scope menjawab “boleh melakukan apa”. Keduanya berbeda.

---

## 16. Issuer Confusion di Multi-Realm/Multi-Tenant System

Jika sistem punya beberapa issuer:

```text
https://idp.example.com/realms/internal
https://idp.example.com/realms/external
https://idp.example.com/realms/partner-a
https://idp.example.com/realms/partner-b
```

Maka verifier harus tahu issuer mana yang valid untuk endpoint tertentu.

Jangan:

```text
Trust semua issuer dari domain idp.example.com untuk semua endpoint.
```

Lebih aman:

```text
Endpoint /internal/** accepts issuer internal only.
Endpoint /partner/a/** accepts issuer partner-a only.
Endpoint /public-api/** accepts issuer external plus partner allowlist.
```

---

## 17. Expiration, Clock Skew, and Time Semantics

### 17.1 `exp`

Setiap bearer token untuk API harus punya expiry pendek.

Common pattern:

```text
Access token: 5-15 minutes
Refresh token: longer, stored/rotated securely
One-time token: seconds-minutes
Email link token: minutes-hours depending risk
Machine token: short with automated refresh
```

### 17.2 Clock Skew

Distributed systems punya clock skew. Verifier biasanya memberi leeway kecil.

Contoh:

```text
allowed clock skew = 30 seconds or 60 seconds
```

Jangan memberi skew terlalu besar seperti 10 menit tanpa alasan kuat.

### 17.3 `iat` Max Age

Walaupun `exp` valid, kadang kamu butuh max age:

```text
now - iat <= 15 minutes
```

Berguna untuk:

1. Risky operation.
2. Fresh authentication requirement.
3. Internal assertion.
4. One-time callback.

---

## 18. Replay: Bearer Token Problem

Bearer token berarti:

> Siapa pun yang membawa token dianggap berhak.

Jika token bocor lewat log, browser storage, proxy, crash dump, referer, atau malware, attacker dapat replay sampai token expired atau revoked.

### 18.1 Mitigasi Dasar

1. TLS everywhere.
2. Expiry pendek.
3. Jangan log token.
4. Jangan simpan access token di tempat yang mudah dicuri.
5. Scope minimal.
6. Audience spesifik.
7. Denylist untuk explicit logout/compromise jika diperlukan.

### 18.2 `jti` + Denylist

Untuk revocation:

```text
on logout/compromise:
  store hash(jti or token) in denylist until exp

on request:
  verify token
  check jti/token digest not in denylist
```

Jangan simpan raw token di denylist kalau tidak perlu. Simpan digest.

### 18.3 Sender-Constrained Token

Untuk risiko lebih tinggi, bearer model bisa diperkuat:

1. mTLS-bound access token.
2. DPoP proof-of-possession.
3. Request signing.
4. One-time nonce challenge.

Konsepnya:

```text
Token valid hanya jika requester membuktikan possession of key/channel tertentu.
```

---

## 19. Token Storage di Client

Walau bagian ini fokus Java server, server engineer harus paham konsekuensi client storage.

### 19.1 Browser SPA

Risiko:

1. `localStorage`: mudah diakses XSS.
2. `sessionStorage`: masih diakses XSS.
3. JS-accessible memory: bisa dicuri XSS runtime.
4. Cookie: rawan CSRF jika tidak dikonfigurasi.

Cookie mitigasi:

```text
HttpOnly
Secure
SameSite=Lax/Strict sesuai flow
Path scoped
Domain scoped sempit
CSRF token untuk unsafe method jika perlu
```

### 19.2 Backend-for-Frontend Pattern

Untuk aplikasi sensitif, BFF dapat menyimpan token server-side dan browser hanya memegang secure session cookie.

```text
Browser ↔ BFF session cookie
BFF ↔ API access token
```

Kelebihan:

1. Token OAuth tidak terekspos ke JavaScript.
2. Revocation/session control lebih mudah.
3. Security boundary lebih jelas.

---

## 20. JWT Revocation: Stateless Myth

JWT sering dipromosikan sebagai stateless. Tetapi jika requirement-mu adalah:

1. Logout langsung berlaku.
2. Admin disable user langsung berlaku.
3. Permission revoke langsung berlaku.
4. Compromised token harus segera invalid.
5. Session idle timeout harus enforce server-side.

Maka kamu butuh state.

Pilihan:

### 20.1 Short-lived Access Token

```text
Access token 5 minutes
Refresh token rotation
```

Trade-off:

1. Revocation delay maksimal 5 menit.
2. Refresh token harus dijaga kuat.

### 20.2 Denylist

```text
Deny token jti until exp
```

Trade-off:

1. Per-request lookup.
2. Butuh cache/storage high availability.
3. Bisa jadi bottleneck jika semua request check DB.

### 20.3 Token Version / Valid-After Timestamp

User/session punya field:

```text
token_valid_after = 2026-06-16T10:00:00Z
```

Verifier reject jika:

```text
iat < token_valid_after
```

Trade-off:

1. Per-request lookup atau cache.
2. Useful untuk password change/admin revoke.

### 20.4 Introspection

Opaque token atau JWT divalidasi melalui authorization server introspection endpoint.

Trade-off:

1. Lebih controllable.
2. Runtime dependency ke auth server.
3. Latency/cache concern.

---

## 21. JWKS Fetching, Caching, and Rotation

JWKS membuat public key distribution lebih mudah, tetapi menambah failure modes.

### 21.1 Basic JWKS Flow

```text
Service starts
  ↓
Fetch OIDC metadata
  ↓
Read jwks_uri
  ↓
Fetch JWKS
  ↓
Cache keys by issuer+kid
  ↓
Verify tokens
```

### 21.2 Rotation Pattern

Issuer biasanya melakukan:

```text
T0: publish old key
T1: publish old + new key
T2: start signing with new key
T3: keep old key until old tokens expire
T4: remove old key
```

Verifier harus bisa:

1. Cache JWKS.
2. Refresh saat `kid` tidak dikenal.
3. Tidak fetch JWKS untuk setiap request.
4. Tidak menerima key dari issuer yang salah.
5. Survive JWKS temporary failure dengan cached valid keys.

### 21.3 JWKS Cache Failure Modes

| Failure | Dampak |
|---|---|
| Cache terlalu lama | Key revoke/rotation lambat diterapkan |
| Cache terlalu pendek | Latency dan dependency tinggi |
| Fetch on every request | DoS terhadap IdP atau service sendiri |
| Fetch unknown kid tanpa rate limit | Attacker memicu JWKS fetch storm |
| Accept key dari arbitrary URL | Token forgery |
| Tidak scope by issuer | Cross-issuer key confusion |

### 21.4 Defensive JWKS Strategy

1. Issuer metadata allowlist.
2. JWKS URL fixed/trusted.
3. Timeout pendek.
4. Response size limit.
5. Cache with TTL.
6. Refresh on unknown `kid` with rate limit.
7. Keep last-known-good keys.
8. Alert on repeated unknown `kid`.
9. Reject token jika key tidak ditemukan setelah controlled refresh.
10. Do not fail open.

---

## 22. Token Size and Transport Risk

JWT bisa membesar karena claims/roles/groups.

Risiko:

1. Header terlalu besar.
2. Reverse proxy reject request.
3. Latency meningkat.
4. Token masuk log karena header dump.
5. Sensitive claims tersebar.
6. Browser cookie limit terlampaui.

Design principle:

> Token harus membawa minimum claims yang diperlukan untuk authorization decision lokal, bukan seluruh profile user.

Jika claims banyak:

1. Gunakan reference token.
2. Gunakan userinfo/introspection lookup.
3. Gunakan scope/permission code ringkas.
4. Resolve detail server-side.

---

## 23. Authorization: Jangan Percaya Role Claim Mentah

JWT sering membawa:

```json
{
  "roles": ["ADMIN"]
}
```

Pertanyaan yang harus dijawab:

1. Role dari issuer mana?
2. Role untuk application mana?
3. Role untuk tenant mana?
4. Role berlaku untuk resource object mana?
5. Role masih current?
6. Role dipetakan ke permission server-side bagaimana?

Anti-pattern:

```java
if (claims.get("roles").contains("ADMIN")) {
    allowEverything();
}
```

Lebih baik:

```text
Token role/scope -> mapped to internal permission -> checked against resource + tenant + action
```

Token claims adalah input ke authorization, bukan authorization engine itu sendiri.

---

## 24. Multi-Tenant Token Integrity

Dalam sistem multi-tenant, claim seperti `tenant_id`, `agency_id`, `org_id`, atau `realm` sangat sensitif.

Failure mode:

```text
User punya token valid untuk tenant A.
Request path: /tenant/B/cases/123
Server hanya cek user authenticated.
Server membaca tenant dari request path, bukan enforce match dengan token/assignment.
```

Mitigasi:

1. Tenant claim wajib.
2. Tenant in path/body harus match authorized tenant set.
3. Authorization check object-level.
4. Jangan izinkan client memilih tenant tanpa server-side entitlement.
5. Audit tenant boundary violations.

Invariant:

> Valid token tidak cukup. Token harus valid untuk tenant/resource/action yang diminta.

---

## 25. Token Binding to Request Context

Untuk high-risk operation, token saja mungkin tidak cukup.

Tambahan binding:

1. `aud` ke service.
2. `azp` / authorized party ke client.
3. `nonce` ke login transaction.
4. `state` ke OAuth flow.
5. `jti` ke one-time operation.
6. mTLS certificate thumbprint.
7. DPoP public key thumbprint.
8. Request hash.
9. Step-up authentication claim.

Contoh risky operation:

```text
Approve enforcement decision
Change bank account
Export sensitive case file
Delete evidence
Grant admin role
```

Untuk operasi seperti ini, access token biasa mungkin harus dilengkapi:

1. Recent authentication.
2. MFA assurance.
3. Explicit permission.
4. Server-side workflow state.
5. Audit signature.

---

## 26. JSON Canonicalization and Signing

JWT/JWS signing input sudah ditentukan oleh compact serialization:

```text
BASE64URL(UTF8(header)) + '.' + BASE64URL(payload)
```

Namun jika kamu membuat request signing sendiri berbasis JSON, hati-hati.

JSON punya variasi:

```json
{"a":1,"b":2}
```

vs

```json
{
  "b": 2,
  "a": 1
}
```

Secara semantic mirip, byte representation berbeda.

Untuk JWT, jangan reserialize header/payload lalu verify manual. Library harus verify exact signing input.

Untuk custom JSON signing:

1. Gunakan canonicalization standard jika ada.
2. Atau sign detached canonical request string.
3. Hindari “parse JSON lalu stringify lalu verify” kecuali canonicalization formal.
4. Definisikan field order, encoding, whitespace, number format jika perlu.

---

## 27. Nested Claims and Type Confusion

JSON memungkinkan type ambiguity:

```json
{
  "admin": "false"
}
```

vs

```json
{
  "admin": false
}
```

Atau:

```json
{
  "aud": "api"
}
```

vs

```json
{
  "aud": ["api", "other"]
}
```

Verifier harus mengikuti spec dan library behavior, bukan asumsi string sederhana.

Rule:

1. Validate expected type.
2. Reject unknown critical ambiguity.
3. Jangan silently coerce claim security-sensitive.
4. Test string/array cases untuk `aud`.
5. Test duplicate claim names jika parser behavior relevan.

---

## 28. Duplicate Claim Names

JSON secara praktis dapat mengandung duplicate names:

```json
{
  "sub": "user-a",
  "sub": "admin"
}
```

Parser berbeda bisa:

1. Ambil pertama.
2. Ambil terakhir.
3. Reject.
4. Preserve duplicate.

Untuk security-sensitive token, duplicate claim names harus dianggap berbahaya.

Mitigasi:

1. Gunakan library yang menangani sesuai spec/security guidance.
2. Prefer reject duplicate claim names jika configurable.
3. Jangan parse JWT claims dengan generic JSON parser manual.

---

## 29. `crit` Header and Extension Handling

JOSE punya `crit` header untuk critical extensions.

Jika token memakai critical header yang verifier tidak pahami, verifier harus reject.

Failure mode:

```text
Token membawa extension yang mengubah semantics.
Verifier ignore extension.
Token diterima dalam context yang salah.
```

Rule:

1. Reject unsupported `crit`.
2. Jangan ignore critical extension.
3. Avoid custom critical extension kecuali semua verifier mendukung.

---

## 30. Java Library Selection Criteria

Saat memilih library JWT/JOSE di Java, cek:

1. Mendukung algorithm yang kamu butuhkan.
2. Default menolak `none` untuk verification.
3. Bisa enforce expected algorithm.
4. Bisa enforce issuer/audience/expiry/nbf.
5. Bisa integrate JWKS dengan cache dan rate limit.
6. Tidak mudah terkena algorithm confusion.
7. Mendukung key rotation.
8. Maintenance aktif.
9. CVE history dikelola.
10. Dokumentasi security jelas.

Jangan memilih library hanya karena contoh kodenya paling pendek.

---

## 31. Token Verification Boundary Pattern

Dalam Java enterprise app, buat satu boundary untuk token verification.

```text
HTTP Adapter / Filter
  ↓
Token Extractor
  ↓
Token Verifier
  ↓
Claims Validator
  ↓
Principal Mapper
  ↓
Authorization Layer
  ↓
Business Use Case
```

### 31.1 Jangan Business Code Membaca JWT Langsung

Anti-pattern:

```java
public CaseDetails getCase(String jwt, String caseId) {
    String userId = jwtUtils.decode(jwt).getSubject();
    List<String> roles = jwtUtils.decode(jwt).getRoles();
    ...
}
```

Problem:

1. Verifikasi tersebar.
2. Claim interpretation inconsistent.
3. Susah audit.
4. Susah test negative cases.
5. Mudah bypass di endpoint baru.

### 31.2 Gunakan Internal Principal

```java
public record VerifiedPrincipal(
        String issuer,
        String subject,
        String clientId,
        Set<String> audiences,
        Set<String> scopes,
        Set<String> roles,
        Set<String> tenantIds,
        Instant issuedAt,
        Instant expiresAt,
        String tokenId
) {}
```

Business code hanya menerima principal yang sudah diverifikasi.

---

## 32. Example: Access Token Verifier Policy Model

```java
public record JwtVerifierPolicy(
        String issuer,
        Set<String> acceptedAudiences,
        Set<String> acceptedAlgorithms,
        Duration maxTokenAge,
        Duration clockSkew,
        JwksKeyResolver keyResolver,
        boolean requireJwtId,
        boolean requireTokenType,
        String expectedTokenType
) {}
```

Policy bisa dibuat per route/service:

```text
Case API:
  issuer = https://idp.example.com/realms/aceas
  audience = aceas-case-api
  alg = RS256 or PS256
  max age = 15 minutes
  require jti = true

Admin API:
  issuer = https://idp.example.com/realms/aceas-admin
  audience = aceas-admin-api
  alg = PS256
  max age = 5 minutes
  require MFA claim = true
```

Ini jauh lebih aman daripada satu global verifier untuk semua endpoint.

---

## 33. Example: Defensive Extraction dari HTTP Request

Token biasanya dikirim:

```http
Authorization: Bearer <token>
```

Rules:

1. Terima dari satu lokasi utama saja.
2. Jangan menerima token dari query parameter kecuali absolutely necessary.
3. Jangan log Authorization header.
4. Reject multiple bearer tokens.
5. Reject malformed scheme.
6. Enforce max token length.

Pseudocode:

```java
public Optional<String> extractBearerToken(HttpServletRequest request) {
    String value = request.getHeader("Authorization");
    if (value == null || value.isBlank()) {
        return Optional.empty();
    }

    if (!value.regionMatches(true, 0, "Bearer ", 0, 7)) {
        throw new InvalidTokenException("Unsupported authorization scheme");
    }

    String token = value.substring(7).trim();
    if (token.isEmpty()) {
        throw new InvalidTokenException("Empty bearer token");
    }

    if (token.length() > 8192) {
        throw new InvalidTokenException("Bearer token too large");
    }

    if (token.contains(" ")) {
        throw new InvalidTokenException("Invalid bearer token format");
    }

    return Optional.of(token);
}
```

---

## 34. Example: Claim Validation Rules

```java
public final class ClaimValidator {
    public void validate(VerifiedClaims claims, JwtVerifierPolicy policy, Instant now) {
        requireEquals("iss", claims.issuer(), policy.issuer());
        requireAudience(claims.audience(), policy.acceptedAudiences());
        requireNotExpired(claims.expiresAt(), now, policy.clockSkew());
        requireNotBeforeSatisfied(claims.notBefore(), now, policy.clockSkew());
        requireIssuedAtReasonable(claims.issuedAt(), now, policy.maxTokenAge(), policy.clockSkew());

        if (policy.requireJwtId() && isBlank(claims.jwtId())) {
            throw new InvalidTokenException("Missing jti");
        }

        if (policy.requireTokenType()) {
            requireEquals("typ", claims.tokenType(), policy.expectedTokenType());
        }
    }
}
```

Important:

1. Missing claim harus ditangani sebagai error jika claim required.
2. Jangan silently default ke “allowed”.
3. Error response ke client jangan terlalu detail.
4. Internal logs boleh detail tapi tidak memuat token raw.

---

## 35. Error Handling

Security error harus:

1. Aman untuk client.
2. Berguna untuk audit/ops.
3. Tidak membocorkan token/key/secret.
4. Tidak membedakan terlalu detail ke attacker.

Client response:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token"
```

Internal structured log:

```json
{
  "event": "TOKEN_REJECTED",
  "reason": "AUDIENCE_MISMATCH",
  "issuer": "https://idp.example.com/realms/aceas",
  "kid": "2026-06-key-1",
  "tokenHash": "sha256:...",
  "requestId": "...",
  "path": "/api/cases/123"
}
```

Jangan log:

```text
raw JWT
Authorization header
private key
shared secret
refresh token
```

---

## 36. Logging and Audit for Token Systems

Log security-relevant event:

1. Token missing.
2. Token malformed.
3. Signature invalid.
4. Issuer rejected.
5. Audience rejected.
6. Expired token.
7. Not-before violation.
8. Unknown `kid`.
9. JWKS refresh failure.
10. Denylisted `jti`.
11. Scope insufficient.
12. Tenant mismatch.

Tapi hindari log raw token.

Gunakan token digest untuk correlation:

```java
String tokenDigest = sha256Base64Url(rawToken);
```

Digest membantu investigasi tanpa menyimpan credential replayable.

---

## 37. Common JWT Vulnerabilities

### 37.1 Accepting `alg=none`

Symptom:

```text
Unsigned token accepted.
```

Mitigation:

```text
Reject unsecured JWT for authn/authz.
```

### 37.2 Algorithm Confusion

Symptom:

```text
RS256 expected but HS256 accepted using public key as shared secret.
```

Mitigation:

```text
Allowed algorithm fixed by policy.
```

### 37.3 Missing Signature Verification

Symptom:

```text
Application decodes payload and trusts claims.
```

Mitigation:

```text
Always verify before trusting claims.
```

### 37.4 Missing Audience Validation

Symptom:

```text
Token issued for one API accepted by another.
```

Mitigation:

```text
Validate aud per service/route.
```

### 37.5 Missing Issuer Validation

Symptom:

```text
Any token from any issuer accepted if signature valid with some key.
```

Mitigation:

```text
Issuer allowlist and scoped keys.
```

### 37.6 Weak HMAC Secret

Symptom:

```text
HS256 secret = "secret" or short env variable.
```

Mitigation:

```text
High-entropy secret from KMS/secret manager.
Prefer asymmetric signing for distributed verification.
```

### 37.7 Token in URL

Symptom:

```text
/api?token=<jwt>
```

Risk:

1. Browser history.
2. Proxy logs.
3. Referer header.
4. Access logs.

Mitigation:

```text
Use Authorization header or secure cookie pattern.
```

### 37.8 Stale Claims

Symptom:

```text
User role revoked but old JWT still carries ADMIN.
```

Mitigation:

1. Short token lifetime.
2. Token version.
3. Denylist.
4. Server-side authorization lookup for high-risk operation.

### 37.9 Sensitive Data in Payload

Symptom:

```json
{
  "nationalId": "...",
  "salary": "...",
  "caseRiskScore": "..."
}
```

Risk:

Payload readable in JWS.

Mitigation:

1. Minimize claims.
2. Use JWE if confidentiality needed.
3. Use server-side lookup.

### 37.10 Accepting Expired Token

Symptom:

```text
Library configured to ignore exp.
```

Mitigation:

```text
Require exp and validate with small skew.
```

---

## 38. JWT in Microservices

### 38.1 Direct Propagation Pattern

```text
Client -> Gateway -> Service A -> Service B
Bearer JWT propagated to every service
```

Pros:

1. End-user context preserved.
2. Services can authorize locally.

Cons:

1. Token exposed to many services.
2. Audience may not match all services.
3. Privilege propagation risk.
4. Harder to enforce least privilege.

### 38.2 Token Exchange Pattern

```text
Client token -> Gateway/STS -> downstream token for service B
```

Pros:

1. Audience-specific downstream token.
2. Scope reduction.
3. Better delegation semantics.

Cons:

1. More infrastructure.
2. Runtime dependency.
3. More complex audit.

### 38.3 Internal Service Assertion

Service A calls Service B with service identity plus user context:

```text
Service credential proves caller service.
User context carried as constrained claim.
```

Better than blindly forwarding external user token if downstream trust boundary berbeda.

---

## 39. JWT and API Gateway

API gateway sering melakukan token validation. Tetapi jangan otomatis menganggap downstream aman.

Pertanyaan:

1. Apakah gateway memverifikasi signature?
2. Apakah gateway memvalidasi issuer/audience/expiry?
3. Apakah downstream menerima identity via trusted header?
4. Apakah client bisa spoof header tersebut?
5. Apakah gateway menghapus inbound identity headers sebelum inject header baru?
6. Apakah service tetap melakukan defense-in-depth verification?

Pattern:

```text
Gateway verifies JWT
Gateway strips all incoming X-User-* headers
Gateway injects signed/internal identity context
Downstream trusts only from gateway network/mTLS
```

Lebih kuat:

```text
Downstream also verifies token or verifies gateway-signed context.
```

---

## 40. JWT and Regulatory / Case Management System

Untuk sistem regulatory/enforcement, token integrity berdampak langsung pada:

1. Siapa boleh melihat case.
2. Siapa boleh membuat enforcement action.
3. Siapa boleh approve/reject.
4. Siapa boleh export evidence.
5. Siapa boleh update audit-sensitive record.
6. Bagaimana membuktikan action dilakukan oleh principal yang benar.

### 40.1 Example Claims

```json
{
  "iss": "https://idp.gov.example/realms/agency",
  "sub": "user-12345",
  "aud": "case-management-api",
  "exp": 1790000000,
  "iat": 1789999100,
  "jti": "token-uuid",
  "scope": "case:read case:update",
  "agency_id": "CEA",
  "roles": ["CASE_OFFICER"],
  "acr": "urn:mfa:level2"
}
```

### 40.2 Enforcement Decision Invariant

Untuk action:

```text
Approve disciplinary action
```

Jangan cukup:

```text
role contains APPROVER
```

Butuh:

1. Token valid.
2. Issuer trusted.
3. Audience benar.
4. User active.
5. Role/permission masih current.
6. Case belongs to agency/tenant.
7. Workflow state allows approval.
8. User is not approving own submitted decision if segregation of duties applies.
9. MFA/step-up satisfied if required.
10. Audit event immutable/tamper-evident.

JWT hanya satu input dalam authorization decision.

---

## 41. Secure Token Design Checklist

Saat mendesain token, jawab:

### 41.1 Purpose

1. Token ini untuk authentication, authorization, session, callback, file download, password reset, email verification, atau service assertion?
2. Apakah token bearer atau proof-of-possession?
3. Apakah token one-time atau reusable?

### 41.2 Issuer and Trust

1. Siapa issuer?
2. Siapa verifier?
3. Apakah verifier boleh sign token juga?
4. Apakah symmetric key acceptable?
5. Apakah asymmetric key lebih tepat?

### 41.3 Audience

1. Token ini untuk service mana?
2. Apakah multi-audience dibutuhkan?
3. Apakah downstream boleh menerima token yang sama?

### 41.4 Claims

1. Claim apa yang wajib?
2. Claim apa yang optional?
3. Claim apa yang terlalu sensitif untuk token?
4. Claim apa yang bisa stale?
5. Apakah role harus dipetakan server-side?

### 41.5 Lifetime

1. Berapa expiry?
2. Apakah `nbf` dibutuhkan?
3. Apakah `iat` max age dibutuhkan?
4. Apakah refresh token rotation dibutuhkan?

### 41.6 Revocation

1. Apakah logout harus immediate?
2. Apakah admin disable harus immediate?
3. Apakah compromised token bisa di-denylist?
4. Apakah butuh introspection?

### 41.7 Key Management

1. Key di mana disimpan?
2. Bagaimana rotation?
3. Bagaimana JWKS cache?
4. Bagaimana revoke compromised key?
5. Bagaimana monitoring unknown `kid`?

### 41.8 Transport and Storage

1. Token dikirim via header/cookie?
2. Apakah token pernah masuk URL?
3. Apakah token bisa muncul di log?
4. Apakah token disimpan di browser?
5. Apakah TLS enforced?

---

## 42. Security Review Questions

Gunakan pertanyaan ini saat review PR/design:

1. Apakah kode hanya decode JWT atau benar-benar verify signature?
2. Apakah expected algorithm fixed by server-side policy?
3. Apakah `none` ditolak?
4. Apakah issuer divalidasi?
5. Apakah audience divalidasi?
6. Apakah expiry wajib dan divalidasi?
7. Apakah clock skew wajar?
8. Apakah `kid` scoped by issuer?
9. Apakah JWKS URL trusted dan tidak dikontrol token?
10. Apakah unknown `kid` menyebabkan fetch storm?
11. Apakah claims sensitive dimasukkan ke payload JWS?
12. Apakah ID token dipakai sebagai access token?
13. Apakah role claim dipakai langsung tanpa resource/tenant check?
14. Apakah token bisa direplay setelah logout?
15. Apakah token raw pernah masuk log?
16. Apakah token panjang dibatasi?
17. Apakah error message terlalu detail?
18. Apakah verifier behavior dites untuk invalid signature, expired, wrong audience, wrong issuer, unknown kid?
19. Apakah key rotation dites?
20. Apakah service behavior saat JWKS unavailable aman?

---

## 43. Testing Matrix untuk JWT Verifier

Buat test cases minimal:

| Test | Expected Result |
|---|---|
| Valid token | Accepted |
| Malformed token | Rejected |
| Missing signature | Rejected |
| Invalid signature | Rejected |
| `alg=none` | Rejected |
| Wrong algorithm | Rejected |
| Wrong issuer | Rejected |
| Missing issuer | Rejected |
| Wrong audience | Rejected |
| Missing audience | Rejected jika required |
| Expired token | Rejected |
| Not-before in future | Rejected |
| Issued-at too old | Rejected jika max age enforced |
| Unknown `kid` | Controlled refresh then reject if unknown |
| `kid` traversal string | Rejected/no file access |
| Token with sensitive oversized claims | Rejected or handled by max size |
| ID token sent to API | Rejected |
| Token for other tenant | Rejected at authorization layer |
| Denylisted `jti` | Rejected |
| Duplicate security claims | Rejected or safely handled |
| JWKS endpoint down | Use cached key or fail closed |

---

## 44. Failure Mode Table

| Failure Mode | Root Cause | Impact | Mitigation |
|---|---|---|---|
| Token accepted without verification | Decode mistaken as verify | Full auth bypass | Central verifier |
| `alg=none` accepted | Unsafe library config | Token forgery | Reject unsecured JWT |
| Algorithm confusion | Header controls verifier | Token forgery | Algorithm allowlist |
| Wrong audience accepted | Missing `aud` validation | Cross-service token use | Per-service audience |
| Wrong issuer accepted | Missing `iss` validation | Cross-realm bypass | Issuer allowlist |
| Stale role accepted | Long-lived JWT | Privilege persists | Short TTL, valid-after, denylist |
| Key rotation outage | JWKS caching poor | Auth outage | Last-known-good + controlled refresh |
| JWKS fetch storm | Unknown `kid` triggers fetch | DoS | Rate limit refresh |
| Sensitive data exposed | JWS payload readable | Privacy breach | Minimize/JWE/server lookup |
| Token logged | Logging headers | Credential leakage | Redaction/token digest |
| Tenant mismatch | Token auth only | Data breach | Object-level auth |
| ID token accepted by API | Token type confusion | Authz bypass | typ/aud/scope validation |

---

## 45. Mini Case Study: App Switcher / SSO Between Two Java/Vue Apps

Bayangkan dua aplikasi:

```text
ACEAS SPA + Java APIs
CPDS SPA + Java/Node APIs
Shared or bridged identity provider
```

Flow:

```text
User logged in to ACEAS
User clicks app switcher to CPDS
CPDS receives OIDC authorization response
CPDS gets tokens
CPDS calls CPDS API
```

Security questions:

1. Apakah ACEAS token boleh dipakai langsung ke CPDS API?
2. Apakah CPDS API memvalidasi `aud=cpds-api`?
3. Apakah issuer sama atau berbeda?
4. Apakah `sub` dari ACEAS dan CPDS punya semantic sama?
5. Apakah logout satu aplikasi membatalkan session/token di aplikasi lain?
6. Apakah front-channel/back-channel logout didukung?
7. Apakah token disimpan di SPA atau BFF/server session?
8. Apakah idle timeout FE dan max session IdP konsisten?
9. Apakah role ACEAS dipetakan langsung ke CPDS? Jika ya, apakah aman?
10. Apakah token raw pernah masuk browser logs/network tools/server logs?

Safe design direction:

```text
ACEAS token is not automatically CPDS API token.
CPDS obtains/receives token intended for CPDS audience.
CPDS API validates issuer + audience + expiry + token type + signature.
Role mapping is explicit server-side.
Logout semantics are designed, not assumed.
```

---

## 46. Mini Case Study: Webhook Signature vs JWT

External service sends callback:

```http
POST /callbacks/payment
Authorization: Bearer <jwt>
X-Signature: ...
```

Question:

Should you use JWT, HMAC header, or both?

Depends:

### Option A: HMAC Request Signing

Good when:

1. Payload integrity matters.
2. Timestamp/nonce anti-replay needed.
3. Both parties share secret.
4. No need complex claims.

### Option B: JWT Assertion

Good when:

1. Caller identity/claims needed.
2. Issuer signs assertion.
3. Audience/expiry/jti meaningful.

### Option C: Both

Useful when:

1. JWT identifies caller.
2. HMAC binds exact HTTP request body/method/path/timestamp.

Caution:

JWT signature only protects JWT payload, not automatically HTTP body. If body integrity matters, sign body digest or use request signing.

---

## 47. Practical Java Design: Package Structure

Example package layout:

```text
com.example.security.token
├── BearerTokenExtractor.java
├── JwtVerifier.java
├── JwtVerifierPolicy.java
├── IssuerPolicyRegistry.java
├── JwksKeyResolver.java
├── VerifiedPrincipal.java
├── ClaimValidator.java
├── TokenRevocationChecker.java
├── TokenVerificationException.java
└── TokenSecurityEvents.java
```

Avoid:

```text
com.example.util.JwtUtil
```

Why?

Because `JwtUtil` tends to become a dumping ground:

1. Decode without verify.
2. Ad-hoc claim access.
3. Hardcoded secrets.
4. Weak tests.
5. Mixed token types.

Security boundary deserves explicit design.

---

## 48. Practical Java Design: Immutable Principal

```java
public record VerifiedPrincipal(
        PrincipalId principalId,
        String issuer,
        String subject,
        String clientId,
        Set<String> audiences,
        Set<String> scopes,
        Set<String> roles,
        Set<String> tenantIds,
        Instant issuedAt,
        Instant expiresAt,
        Optional<String> tokenId,
        Map<String, Object> assurance
) {
    public VerifiedPrincipal {
        audiences = Set.copyOf(audiences);
        scopes = Set.copyOf(scopes);
        roles = Set.copyOf(roles);
        tenantIds = Set.copyOf(tenantIds);
        assurance = Map.copyOf(assurance);
    }
}
```

Design notes:

1. Immutable.
2. Contains issuer + subject.
3. Does not expose raw token.
4. Scopes/roles copied defensively.
5. Can be audited.

---

## 49. Practical Java Design: Authorization Should Consume Principal, Not JWT

```java
public final class CaseAuthorizationService {
    public void requireCanReadCase(VerifiedPrincipal principal, CaseRecord record) {
        if (!principal.tenantIds().contains(record.tenantId())) {
            throw new AccessDeniedException("Tenant mismatch");
        }

        if (!principal.scopes().contains("case:read")) {
            throw new AccessDeniedException("Missing scope");
        }

        if (record.isRestricted() && !principal.roles().contains("SENIOR_CASE_OFFICER")) {
            throw new AccessDeniedException("Restricted case");
        }
    }
}
```

Ini menjaga separation:

```text
Token verification = who/what is represented by this token?
Authorization = can this principal do this action on this resource now?
```

---

## 50. Practical Java Design: Denylist with Token Digest

```java
public interface TokenDenylist {
    boolean isDenied(String tokenDigest);
    void denyUntil(String tokenDigest, Instant expiresAt, String reason);
}
```

Digest:

```java
public static String tokenDigest(String rawToken) {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
    return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
}
```

Notes:

1. Use digest to avoid storing raw bearer credential.
2. Store until token expiration.
3. For `jti`, deny by `(issuer, jti)` if `jti` globally unique per issuer.
4. For high security, include issuer/audience in denylist key.

---

## 51. Anti-Patterns Catalog

### Anti-Pattern 1 — `JwtUtil.decode()` Everywhere

Problem:

```text
No central policy, inconsistent validation.
```

Fix:

```text
Central verifier + internal principal.
```

### Anti-Pattern 2 — One Global Secret for All Services

Problem:

```text
Any service can mint token for any other service.
```

Fix:

```text
Asymmetric signing or per-audience secrets with key separation.
```

### Anti-Pattern 3 — Long-Lived Access Token

Problem:

```text
Leak impact huge, stale claims persist.
```

Fix:

```text
Short-lived access token + refresh/rotation/session controls.
```

### Anti-Pattern 4 — Roles as Source of Truth

Problem:

```text
Role claims stale and context-free.
```

Fix:

```text
Map to permissions and check resource/tenant/workflow state.
```

### Anti-Pattern 5 — Token Payload Contains Sensitive Data

Problem:

```text
JWS payload readable.
```

Fix:

```text
Minimize claims, use server lookup or JWE.
```

### Anti-Pattern 6 — `kid` Controls File/URL

Problem:

```text
Path traversal/SSRF/key injection.
```

Fix:

```text
Opaque kid, trusted JWKS, scoped lookup.
```

### Anti-Pattern 7 — API Accepts ID Token

Problem:

```text
Wrong audience and semantics.
```

Fix:

```text
Require access token with API audience.
```

### Anti-Pattern 8 — Gateway Validates, Service Blindly Trusts Spoofable Header

Problem:

```text
Client can inject X-User-Id if gateway does not strip.
```

Fix:

```text
Strip inbound headers, mTLS gateway-service, signed internal context, or service verifies token.
```

---

## 52. Operational Checklist

### Build-Time

1. Use maintained JWT/JOSE library.
2. Pin dependency versions.
3. Monitor CVEs.
4. Add tests for invalid tokens.
5. Add static scan/secret scan.

### Deployment-Time

1. Configure issuer allowlist.
2. Configure audience per service.
3. Configure algorithm allowlist.
4. Configure JWKS endpoint allowlist.
5. Configure cache TTL and refresh rate limit.
6. Configure token max size.
7. Configure log redaction.

### Runtime

1. Monitor invalid signature rate.
2. Monitor unknown `kid` spikes.
3. Monitor expired token volume.
4. Monitor audience mismatch.
5. Monitor JWKS fetch failures.
6. Monitor denylist hit rate.
7. Alert on `alg=none` attempts.
8. Alert on issuer anomalies.

### Incident

1. Identify compromised token/key.
2. Denylist token `jti`/digest.
3. Rotate signing key if needed.
4. Shorten TTL temporarily if needed.
5. Invalidate sessions/refresh tokens.
6. Review logs by token digest.
7. Check data access blast radius.
8. Add regression test for exploited weakness.

---

## 53. Token Integrity Invariants

Gunakan invariant ini sebagai design contract:

1. **No unverified claims**  
   No claim from JWT may influence authorization until signature/MAC and required claims are validated.

2. **Issuer-bound identity**  
   Principal identity is `(issuer, subject)`, not `subject` alone.

3. **Audience-bound token**  
   A token is valid only for its intended audience.

4. **Algorithm-bound policy**  
   Accepted algorithm is defined by server-side policy, not attacker-controlled header.

5. **Key-bound issuer**  
   Verification keys are scoped to issuer and use.

6. **Time-bound trust**  
   Tokens must expire and time claims must be validated with bounded skew.

7. **Purpose-bound token**  
   ID token, access token, refresh token, reset token, and internal assertion are not interchangeable.

8. **Context-bound authorization**  
   Token validity does not imply permission on every resource.

9. **Least-disclosure claims**  
   Token payload must not contain data that does not need to be exposed to the holder.

10. **Fail closed**  
   If verification, key lookup, issuer policy, or claim validation is uncertain, reject.

---

## 54. Summary

JWT/JOSE security is not about memorizing `header.payload.signature`. It is about preserving precise trust semantics.

Key points:

1. JWT is a claims container; security comes from verification and validation.
2. JWS gives integrity/authenticity, not confidentiality.
3. JWE gives confidentiality but still requires claim validation.
4. `decode` is not `verify`.
5. `alg`, `kid`, `jku`, and other header values are attacker-controlled until verified and must be constrained by server-side policy.
6. Always validate issuer, audience, expiration, not-before, and token purpose.
7. ID token and access token are not interchangeable.
8. JWKS rotation requires cache, refresh, rate limit, and fail-closed behavior.
9. Bearer tokens are replayable if stolen; use short TTL, denylist, or sender-constrained designs when needed.
10. Business code should consume a verified internal principal, not raw JWT claims.

The top 1% engineer mindset:

> Jangan bertanya “apakah JWT ini valid?” saja. Tanyakan: “valid menurut issuer siapa, untuk audience mana, dengan algorithm apa, memakai key mana, sampai kapan, untuk purpose apa, pada resource apa, dan dengan revocation semantics apa?”

---

## 55. Latihan Mandiri

1. Ambil satu service Java yang memakai JWT. Cari apakah ada kode yang melakukan decode tanpa verify.
2. Buat daftar issuer yang dipercaya service tersebut.
3. Buat mapping endpoint → expected audience.
4. Cari apakah ID token bisa dipakai ke API.
5. Cek apakah verifier mengizinkan lebih dari satu algorithm.
6. Cek apakah `kid` scoped by issuer.
7. Simulasikan key rotation: old key + new key, unknown `kid`, JWKS unavailable.
8. Buat test untuk expired token, wrong audience, wrong issuer, invalid signature.
9. Cek apakah token raw pernah masuk log.
10. Desain `VerifiedPrincipal` internal dan larang business code membaca JWT langsung.

---

## 56. Koneksi ke Part Berikutnya

Part ini membahas token integrity dan JOSE/JWT. Part berikutnya akan masuk ke:

```text
Part 20 — OAuth2/OIDC Security for Java Systems Without Repeating Jakarta/JAX-RS
```

Di Part 20 kita akan membahas flow identity lebih besar: Authorization Code + PKCE, redirect URI, state, nonce, token exchange, ID token validation, access token validation, refresh token rotation, logout, dan enterprise SSO failure modes.

Token/JWT dari Part 19 adalah building block. OAuth2/OIDC di Part 20 adalah protocol/security flow yang memakai building block tersebut.

---

## Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Completed: Part 0 sampai Part 19
Remaining: Part 20 sampai Part 34
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-018.md">⬅️ Part 18 — XML Security, XXE, XML Signature, XML Encryption</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-020.md">OAuth2/OIDC Security for Java Systems Without Repeating Jakarta/JAX-RS ➡️</a>
</div>
