# learn-java-security-cryptography-integrity-part-020

# OAuth2/OIDC Security for Java Systems Without Repeating Jakarta/JAX-RS

> Seri: `learn-java-security-cryptography-integrity`  
> Part: 20 dari 34  
> Status seri: belum selesai  
> Fokus: security invariants pada OAuth2/OIDC, bukan tutorial endpoint/controller/framework

---

## 0. Tujuan Part Ini

Bagian ini membahas **OAuth2/OpenID Connect security** dari sudut pandang Java engineer yang harus membangun, mengintegrasikan, mengaudit, atau men-debug sistem login/SSO/token validation di production.

Kita tidak akan mengulang pembahasan Jakarta/JAX-RS, REST controller, filter, atau Spring Security basic. Fokusnya adalah:

1. memahami **security properties** dari OAuth2/OIDC;
2. membedakan **authentication**, **authorization**, **delegation**, dan **session**;
3. memahami flow modern yang aman: **Authorization Code + PKCE**;
4. memvalidasi **ID token** dan **access token** dengan benar;
5. menghindari bug klasik: redirect URI lemah, missing state, missing nonce, token confusion, key confusion, JWKS cache salah, logout tidak konsisten;
6. mendesain Java service agar punya boundary validasi token yang jelas;
7. memahami apa yang boleh/tidak boleh dipercaya dari browser, frontend SPA, gateway, IdP, dan downstream service.

Setelah bagian ini, kamu harus bisa menjawab:

> “Ketika aplikasi Java menerima token atau authorization code, invariant apa yang harus terbukti benar sebelum user dianggap authenticated atau request dianggap authorized?”

---

## 1. Referensi Utama

Bagian ini disusun berdasarkan referensi primer dan industry guidance berikut:

1. **RFC 9700 — Best Current Practice for OAuth 2.0 Security**  
   https://datatracker.ietf.org/doc/html/rfc9700

2. **RFC 6749 — The OAuth 2.0 Authorization Framework**  
   https://datatracker.ietf.org/doc/html/rfc6749

3. **RFC 6750 — OAuth 2.0 Bearer Token Usage**  
   https://datatracker.ietf.org/doc/html/rfc6750

4. **RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients**  
   https://datatracker.ietf.org/doc/html/rfc7636

5. **OpenID Connect Core 1.0**  
   https://openid.net/specs/openid-connect-core-1_0.html

6. **RFC 7519 — JSON Web Token**  
   https://datatracker.ietf.org/doc/html/rfc7519

7. **RFC 8725 — JSON Web Token Best Current Practices**  
   https://datatracker.ietf.org/doc/html/rfc8725

8. **OWASP OAuth2 Cheat Sheet**  
   https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html

9. **OWASP JSON Web Token for Java Cheat Sheet**  
   https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html

10. **OWASP Authentication Cheat Sheet**  
    https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

11. **OWASP Session Management Cheat Sheet**  
    https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

---

## 2. Mental Model Utama

OAuth2 dan OIDC sering dipahami secara salah karena banyak engineer melihatnya dari sisi “login flow”. Padahal secara model:

- **OAuth2** adalah authorization/delegation framework.
- **OIDC** adalah authentication layer di atas OAuth2.
- **Access token** membuktikan authorization untuk resource server.
- **ID token** membawa hasil authentication user dari OpenID Provider kepada client.
- **Refresh token** adalah credential jangka panjang untuk mendapatkan token baru.
- **Authorization code** adalah intermediate credential yang harus ditukar server-side dan dilindungi dengan PKCE.
- **Session cookie aplikasi** adalah state lokal aplikasi, bukan token OAuth itu sendiri.

Kalau mental model ini kacau, sistem bisa melakukan kesalahan serius, misalnya:

- menganggap access token sebagai bukti login user tanpa validasi issuer/audience;
- memakai ID token untuk memanggil API;
- menerima JWT dari issuer yang salah;
- menerima token dengan audience untuk service lain;
- mempercayai claim dari frontend;
- menyimpan token jangka panjang di browser tanpa threat model;
- logout dari aplikasi tetapi token/SSO session masih aktif;
- refresh token leak tetapi tidak punya rotation/revocation strategy.

---

## 3. Vocabulary: Actor dan Artifact

### 3.1 Resource Owner

Biasanya user manusia yang memberi izin. Dalam enterprise, resource owner dapat direpresentasikan sebagai pegawai, admin, agency user, service account, atau legal entity.

### 3.2 Client

Aplikasi yang meminta token. Client bisa berupa:

1. backend web application;
2. SPA;
3. mobile app;
4. CLI;
5. service-to-service client;
6. batch job;
7. integration adapter.

Client security posture berbeda-beda. Backend confidential client bisa menyimpan secret lebih aman dibanding SPA/public client.

### 3.3 Authorization Server / OpenID Provider

Komponen yang mengautentikasi user dan menerbitkan authorization code/token.

Dalam OIDC, Authorization Server disebut juga **OpenID Provider (OP)**.

### 3.4 Resource Server

API yang menerima access token dan memutuskan apakah request boleh diproses.

Dalam Java enterprise, resource server biasanya adalah microservice/API backend.

### 3.5 Relying Party

Dalam OIDC, client yang menerima ID token disebut **Relying Party (RP)**.

### 3.6 Authorization Code

Credential sementara yang dikirim dari authorization server ke client melalui browser redirect. Code harus ditukar dengan token di token endpoint.

### 3.7 PKCE Code Verifier dan Code Challenge

PKCE menambahkan proof bahwa pihak yang menukar authorization code adalah pihak yang memulai request. Ini mencegah authorization code injection/interception class of attacks.

### 3.8 State

Nilai random yang mengikat authorization response dengan authorization request. Umumnya dipakai untuk CSRF protection dan flow correlation.

### 3.9 Nonce

Nilai random OIDC untuk mengikat ID token dengan authentication request dan mencegah replay/mix-up tertentu pada ID token.

### 3.10 ID Token

JWT yang berisi authentication result. ID token ditujukan untuk client/RP, bukan resource server umum.

### 3.11 Access Token

Credential untuk mengakses resource server. Bisa JWT atau opaque token.

### 3.12 Refresh Token

Credential untuk mendapatkan access token baru. Refresh token harus diperlakukan seperti credential sensitif jangka panjang.

---

## 4. OAuth2 vs OIDC: Jangan Campur Security Semantics

### 4.1 OAuth2 Menjawab: “Apakah client diberi akses?”

OAuth2 tidak secara native menjawab:

> “Siapa user ini secara authenticated?”

OAuth2 menjawab:

> “Client ini punya token yang mewakili izin tertentu untuk resource tertentu.”

### 4.2 OIDC Menjawab: “Siapa user yang authenticated?”

OIDC menambahkan:

- ID token;
- user identity claims;
- nonce;
- discovery metadata;
- userinfo endpoint;
- standard authentication semantics.

### 4.3 Bug Mental Model

Anti-pattern:

```text
Received access_token -> decode JWT -> take sub -> login user
```

Masalah:

1. access token mungkin bukan untuk client ini;
2. audience mungkin resource server lain;
3. issuer mungkin salah;
4. token mungkin opaque, bukan JWT;
5. `sub` access token tidak selalu cukup untuk authentication session;
6. token bisa mewakili delegated access, bukan direct login.

Correct mental model:

```text
For login:
  validate OIDC authorization response
  exchange code securely
  validate ID token for this client
  establish local application session

For API authorization:
  validate access token for this resource server
  enforce scopes/roles/claims/policies
```

---

## 5. Recommended Modern Flow: Authorization Code + PKCE

### 5.1 Kenapa Flow Ini Dominan

Authorization Code Flow dengan PKCE adalah baseline modern karena:

1. token tidak dikirim melalui front-channel URL fragment seperti implicit flow lama;
2. authorization code hanya credential sementara;
3. PKCE mengikat code exchange ke client instance yang memulai flow;
4. refresh token dapat dikelola lebih aman di backend;
5. flow ini cocok untuk confidential client dan public client dengan konfigurasi yang benar.

RFC 9700 sebagai OAuth2 Security Best Current Practice memperbarui threat model OAuth2 dan mendepresiasi beberapa mode lama yang lebih lemah.

### 5.2 Flow High-Level

```text
User Browser
   |
   | 1. /login
   v
Java Client App
   |
   | generate state, nonce, code_verifier
   | derive code_challenge
   |
   | 2. redirect to Authorization Server
   v
Authorization Server / OP
   |
   | authenticate user
   | ask consent if applicable
   |
   | 3. redirect back with code + state
   v
Java Client App Callback
   |
   | validate state
   | exchange code + code_verifier at token endpoint
   | validate ID token
   | create local session
   v
User logged in to application
```

### 5.3 Security Invariants

Sebelum membuat session lokal:

1. `state` harus match dengan request yang dimulai aplikasi.
2. Authorization code harus ditukar hanya satu kali.
3. Token endpoint harus dipanggil melalui TLS valid.
4. PKCE `code_verifier` harus sesuai dengan `code_challenge` awal.
5. ID token signature harus valid.
6. ID token `iss` harus expected issuer.
7. ID token `aud` harus client id aplikasi.
8. ID token `exp` belum expired.
9. ID token `iat` masuk akal dengan clock skew policy.
10. Jika `nonce` dikirim, claim `nonce` pada ID token harus match.
11. Jika multiple issuers/realms digunakan, metadata dan JWKS harus berasal dari issuer yang benar.

---

## 6. Front-Channel vs Back-Channel

### 6.1 Front-Channel

Front-channel adalah komunikasi melalui browser redirect.

Contoh:

```text
Authorization Server -> Browser -> Client callback
```

Risiko:

1. URL bisa masuk browser history;
2. parameter bisa bocor via referrer kalau salah konfigurasi;
3. browser/user-agent tidak sepenuhnya trusted;
4. malicious extension bisa mengamati;
5. redirect URI salah bisa mengirim code ke attacker;
6. state/nonce/correlation bisa hilang kalau aplikasi multi-tab tidak benar.

### 6.2 Back-Channel

Back-channel adalah komunikasi server-to-server.

Contoh:

```text
Java Backend -> Token Endpoint
Java Backend -> JWKS Endpoint
Java Backend -> Introspection Endpoint
Java Backend -> Revocation Endpoint
```

Keuntungan:

1. credential client bisa disimpan lebih aman;
2. token tidak terekspos di browser;
3. response bisa divalidasi di trusted environment;
4. telemetry dan error handling lebih terkendali.

### 6.3 Rule of Thumb

```text
Front-channel should carry only short-lived, flow-bound artifacts.
Back-channel should perform sensitive token exchange and validation.
```

---

## 7. State: CSRF and Flow Correlation

### 7.1 Fungsi State

`state` bukan sekadar parameter random. Ia mengikat:

```text
login request yang dimulai aplikasi
    dengan
callback response yang diterima aplikasi
```

Tanpa state, attacker dapat mencoba login CSRF atau authorization response injection.

### 7.2 State Harus

1. random kuat;
2. single-use;
3. punya TTL pendek;
4. disimpan server-side atau dalam cookie yang dilindungi;
5. terikat dengan user-agent/session awal;
6. diverifikasi sebelum code exchange;
7. dihapus setelah dipakai.

### 7.3 State Tidak Boleh

1. predictable;
2. hanya timestamp;
3. reused lintas login attempt;
4. memuat data sensitif dalam plaintext;
5. dianggap sebagai authorization proof;
6. dipakai menggantikan nonce OIDC;
7. dipakai tanpa binding ke flow context.

### 7.4 Java Design Pattern

```java
public final class OAuthLoginAttempt {
    private final String state;
    private final String nonce;
    private final String codeVerifier;
    private final Instant createdAt;
    private final String redirectAfterLogin;
    private final String userAgentHash;
    private final String clientIpPrefix;

    // Immutable, stored server-side or encrypted/authenticated cookie.
}
```

Security invariant:

```text
Callback state must map to exactly one unexpired login attempt.
```

---

## 8. Nonce: ID Token Replay and Authentication Binding

### 8.1 Fungsi Nonce

`nonce` dipakai dalam OIDC authentication request dan harus muncul kembali dalam ID token.

Ia membantu membuktikan:

```text
ID token ini diterbitkan sebagai hasil dari authentication request yang saya mulai.
```

### 8.2 Nonce Bukan State

`state` mengikat authorization response.  
`nonce` mengikat ID token.

Keduanya bisa berbeda dan sebaiknya diperlakukan berbeda.

### 8.3 Nonce Validation

Saat validasi ID token:

```text
id_token.nonce == loginAttempt.nonce
```

Jika tidak match:

```text
reject authentication
clear login attempt
log security event
```

### 8.4 Failure Mode

Bug:

```text
validate signature only -> accept ID token
```

Masalah:

Signature valid hanya membuktikan token ditandatangani issuer. Itu belum membuktikan token tersebut milik flow login saat ini.

---

## 9. PKCE: Proof Key for Code Exchange

### 9.1 Masalah yang Diselesaikan

Tanpa PKCE, jika authorization code bocor atau di-inject, attacker bisa mencoba menukarnya dengan token.

PKCE membuat token endpoint meminta proof tambahan: `code_verifier`.

### 9.2 Cara Kerja

Client membuat:

```text
code_verifier = random high entropy string
code_challenge = BASE64URL(SHA256(code_verifier))
```

Authorization request mengirim `code_challenge` dan `code_challenge_method=S256`.

Token request mengirim `code_verifier`.

Authorization server memverifikasi:

```text
BASE64URL(SHA256(code_verifier)) == original code_challenge
```

### 9.3 Security Rules

1. Gunakan `S256`, bukan `plain`, kecuali benar-benar tidak ada opsi.
2. `code_verifier` harus random kuat.
3. `code_verifier` harus per-flow, single-use.
4. Jangan log `code_verifier`.
5. Jangan simpan lebih lama dari TTL authorization flow.

### 9.4 PKCE Tidak Menyelesaikan Semua Hal

PKCE melindungi authorization code. Ia tidak otomatis melindungi:

1. access token theft;
2. refresh token theft;
3. bad redirect URI;
4. wrong audience;
5. missing ID token validation;
6. XSS yang mencuri token di browser;
7. overbroad scopes.

---

## 10. Redirect URI Validation

### 10.1 Kenapa Sangat Berbahaya

Authorization code dikirim ke redirect URI. Kalau redirect URI bisa dimanipulasi, code bisa dikirim ke attacker.

### 10.2 Rule

Redirect URI harus exact match atau mengikuti aturan matching yang sangat ketat dari authorization server.

Buruk:

```text
https://app.example.com/*
https://*.example.com/callback
https://app.example.com/callback?next=anything
```

Lebih baik:

```text
https://app.example.com/oauth/callback
```

### 10.3 Open Redirect

Jika callback menerima parameter redirect lanjutan seperti:

```text
/oauth/callback?next=https://evil.example
```

maka sesudah login aplikasi bisa menjadi open redirector.

Rule:

```text
post-login redirect must use allowlisted relative paths, not arbitrary absolute URLs.
```

### 10.4 Java Pattern

```java
public final class RedirectTargetValidator {
    private static final Set<String> ALLOWED_PREFIXES = Set.of(
        "/dashboard",
        "/cases",
        "/profile"
    );

    public String validate(String requested) {
        if (requested == null || requested.isBlank()) {
            return "/dashboard";
        }
        if (requested.startsWith("http://") || requested.startsWith("https://") || requested.startsWith("//")) {
            return "/dashboard";
        }
        return ALLOWED_PREFIXES.stream().anyMatch(requested::startsWith)
            ? requested
            : "/dashboard";
    }
}
```

---

## 11. ID Token Validation

### 11.1 Apa yang Harus Divalidasi

Minimal:

1. token structure valid;
2. signature valid;
3. algorithm expected;
4. key berasal dari JWKS issuer yang benar;
5. `iss` expected;
6. `aud` berisi client id;
7. `azp` dicek jika diperlukan;
8. `exp` belum expired;
9. `iat` masuk akal;
10. `nbf` jika ada;
11. `nonce` match jika dikirim;
12. subject claim `sub` stabil dan dipakai sebagai identifier utama;
13. claim mapping tidak membuat privilege escalation.

### 11.2 Signature Valid Tidak Cukup

Token bertanda tangan valid masih bisa salah konteks:

```text
valid signature + wrong issuer = reject
valid signature + wrong audience = reject
valid signature + expired = reject
valid signature + wrong nonce = reject
valid signature + weak/disallowed alg = reject
```

### 11.3 Issuer Binding

Issuer adalah root identity context.

Dalam multi-tenant/multi-realm:

```text
issuer -> metadata -> jwks_uri -> allowed algorithms -> validation policy
```

Jangan memilih JWKS berdasarkan `kid` saja tanpa issuer binding.

### 11.4 Audience Validation

ID token audience harus client id aplikasi penerima.

Jika aplikasi A menerima ID token untuk aplikasi B, itu token confusion.

### 11.5 Subject Mapping

`sub` adalah subject identifier dari issuer. Jangan mengandalkan email sebagai primary identity key kecuali ada policy yang jelas.

Problem email sebagai identity key:

1. email bisa berubah;
2. email bisa recycled di beberapa sistem;
3. email verification status harus diperhatikan;
4. case sensitivity/normalization bisa bermasalah;
5. tenant isolation bisa rusak kalau `sub` tidak digabung dengan `iss`.

Recommended internal key:

```text
external_identity_key = issuer + subject
```

---

## 12. Access Token Validation

### 12.1 Access Token Untuk Resource Server

Resource server Java harus memvalidasi access token berdasarkan:

1. issuer;
2. audience/resource indicator;
3. expiry;
4. signature atau introspection result;
5. scope/permission;
6. token type;
7. tenant/context;
8. sender constraint jika digunakan;
9. revocation/introspection policy jika opaque token;
10. local authorization policy.

### 12.2 JWT Access Token vs Opaque Token

#### JWT Access Token

Kelebihan:

1. local validation cepat;
2. tidak perlu call introspection setiap request;
3. cocok untuk high-throughput API.

Risiko:

1. revocation sulit sebelum expiry;
2. claim bisa stale;
3. JWKS rotation/caching harus benar;
4. token bisa terlalu besar;
5. token leakage berdampak sampai expired.

#### Opaque Token

Kelebihan:

1. bisa introspection ke authorization server;
2. revocation lebih mudah;
3. claim tidak terekspos ke client;
4. token format tidak jadi kontrak publik.

Risiko:

1. latency introspection;
2. dependency availability ke authorization server;
3. caching introspection harus hati-hati;
4. failure mode harus jelas.

### 12.3 Jangan Pakai Access Token Untuk Login Session Tanpa OIDC

Access token bukan ID token. Jika login user diperlukan, gunakan OIDC dan validasi ID token.

---

## 13. Token Confusion

### 13.1 Definisi

Token confusion terjadi ketika sistem menerima token yang valid secara kriptografis tetapi bukan untuk konteks penggunaan itu.

Contoh:

```text
ID token dipakai sebagai access token
Access token untuk API A diterima oleh API B
Token dari issuer X diterima sebagai issuer Y
Token untuk mobile client diterima oleh web client
```

### 13.2 Prevention

1. Pisahkan validator ID token dan access token.
2. Require expected issuer.
3. Require expected audience.
4. Require expected token use/type jika ada.
5. Jangan satu method generic `validateJwt()` untuk semua konteks.
6. Buat object hasil validasi yang typed.

### 13.3 Java Pattern

```java
public sealed interface ValidatedToken permits ValidatedIdToken, ValidatedAccessToken {
    String issuer();
    String subject();
    Instant expiresAt();
}

public record ValidatedIdToken(
    String issuer,
    String subject,
    String audience,
    String nonce,
    Instant expiresAt
) implements ValidatedToken {}

public record ValidatedAccessToken(
    String issuer,
    String subject,
    Set<String> audiences,
    Set<String> scopes,
    Instant expiresAt
) implements ValidatedToken {}
```

Tujuannya: secara type-level, caller tidak mudah memakai ID token sebagai access token.

---

## 14. JWKS Validation, Caching, and Rotation

### 14.1 JWKS Mental Model

JWKS adalah endpoint yang menerbitkan public keys untuk memverifikasi JWT signature.

Namun JWKS harus dipercaya hanya dalam konteks issuer tertentu.

```text
issuer metadata -> jwks_uri -> keys -> kid -> public key
```

### 14.2 Common Bugs

1. menerima `jku` header dari token dan fetch URL arbitrary;
2. memilih key hanya berdasarkan `kid` global;
3. tidak bind JWKS ke issuer;
4. cache key terlalu lama sehingga rotation gagal;
5. cache key terlalu pendek sehingga DoS ke IdP;
6. menerima unknown algorithm;
7. menerima duplicate `kid` tanpa policy;
8. tidak handle key rollover overlap;
9. tidak punya fallback refresh saat unknown `kid`;
10. log full token ketika verification gagal.

### 14.3 Rotation-Aware Strategy

```text
On startup:
  fetch discovery metadata for configured issuer
  fetch JWKS
  cache with TTL and max stale policy

On token validation:
  select key by kid within issuer-bound JWKS
  validate alg against allowed algorithms
  verify signature

If kid not found:
  refresh JWKS once
  retry validation
  if still not found -> reject
```

### 14.4 Do Not Trust Token Header URLs

Header seperti `jku`, `x5u`, atau custom key URL dapat menjadi SSRF/key substitution vector jika library/config mengizinkan auto-fetch.

Rule:

```text
Key source must come from trusted issuer metadata/config, not from untrusted token header.
```

---

## 15. Scope, Role, Claim, Permission: Jangan Campur

### 15.1 Scope

Scope biasanya menyatakan delegated permission yang diberikan ke client.

Contoh:

```text
case.read case.write appeal.submit
```

### 15.2 Role

Role biasanya menyatakan user/application role dalam domain.

Contoh:

```text
CASE_OFFICER
SUPERVISOR
ADMIN
```

### 15.3 Claim

Claim adalah pernyataan tentang subject/token/context.

Contoh:

```text
agency = CEA
department = Enforcement
acr = mfa
amr = pwd,otp
```

### 15.4 Permission

Permission adalah keputusan aplikasi:

```text
Can user X perform action Y on resource Z under condition C?
```

### 15.5 Failure Mode

Bug:

```text
has scope case.write -> allow update any case
```

Masalah:

Scope `case.write` belum tentu memberi hak terhadap semua case. Masih perlu object-level authorization.

Correct:

```text
Token valid
  + scope permits operation category
  + role permits function
  + subject/agency owns or is assigned to object
  + state machine allows transition
  + policy conditions satisfied
```

---

## 16. Refresh Token Security

### 16.1 Kenapa Refresh Token Sangat Sensitif

Access token biasanya pendek umur. Refresh token bisa memperpanjang akses berkali-kali. Jika bocor, attacker bisa mempertahankan akses.

### 16.2 Best Practices

1. Gunakan refresh token rotation jika tersedia.
2. Deteksi reuse refresh token lama.
3. Simpan server-side untuk web backend confidential client.
4. Jangan simpan refresh token di localStorage browser.
5. Batasi lifetime absolut.
6. Bind ke client/session/device jika memungkinkan.
7. Revocation saat logout/security event.
8. Audit token refresh anomaly.

### 16.3 Rotation Failure Model

```text
Client uses refresh_token_A
Authorization server returns access_token_B + refresh_token_B
refresh_token_A invalidated

If refresh_token_A appears again:
  possible theft/replay
  revoke token family
  require reauthentication
```

---

## 17. Browser Storage and SPA Risk

### 17.1 localStorage

Risiko:

1. accessible to JavaScript;
2. XSS can steal token;
3. no automatic expiry enforcement;
4. persistence after tab close;
5. hard to bind to secure context.

### 17.2 sessionStorage

Lebih pendek lifetime, tetapi tetap accessible to JavaScript.

### 17.3 HttpOnly Secure SameSite Cookie

Kelebihan:

1. tidak accessible to JavaScript jika HttpOnly;
2. bisa Secure;
3. bisa SameSite;
4. cocok untuk backend-for-frontend pattern.

Risiko:

1. CSRF harus dikelola;
2. domain/path harus benar;
3. session fixation harus dicegah.

### 17.4 Backend-for-Frontend Pattern

Untuk enterprise Java:

```text
SPA -> BFF session cookie -> Java backend stores tokens server-side -> APIs
```

Keuntungan:

1. token tidak terekspos di browser;
2. refresh token lebih aman;
3. authorization logic terkonsentrasi;
4. logout lebih terkendali;
5. CSRF/session hardening bisa dikelola.

Trade-off:

1. backend state bertambah;
2. scaling session perlu desain;
3. cookie domain/SameSite harus benar;
4. API direct call dari SPA ke banyak service menjadi perlu proxy/BFF.

---

## 18. Logout: Local Session, OP Session, Token Revocation

### 18.1 Logout Bukan Satu Hal

Logout bisa berarti:

1. hapus local application session;
2. revoke refresh token;
3. end session di IdP/OP;
4. notify relying parties;
5. clear browser cookies;
6. invalidate server-side session cache;
7. stop background refresh.

### 18.2 Local Logout

```text
Application clears local session only.
```

User bisa masih punya SSO session di IdP. Login berikutnya bisa otomatis.

### 18.3 RP-Initiated Logout

Client meminta OP mengakhiri session.

Perlu memperhatikan:

1. `id_token_hint`;
2. post logout redirect URI allowlist;
3. state;
4. UX multi-app;
5. single logout expectation.

### 18.4 Back-Channel Logout

OP mengirim logout token/event ke relying party secara server-to-server.

Kelebihan:

1. tidak bergantung pada browser;
2. lebih cocok multi-app;
3. bisa membersihkan server-side session.

Risiko:

1. endpoint harus validasi logout token;
2. replay harus dicegah;
3. reliability harus dipikirkan;
4. idempotency wajib.

### 18.5 Logout Security Invariant

```text
After logout completes, no local session or refresh capability for that relying-party session remains usable.
```

Kalau hanya clear frontend state, invariant ini tidak terpenuhi.

---

## 19. Client Authentication

### 19.1 Confidential Client

Backend Java application bisa memakai client authentication ke token endpoint.

Metode:

1. client secret basic;
2. client secret post;
3. private_key_jwt;
4. mTLS client authentication;
5. platform-specific workload identity.

### 19.2 Client Secret Bukan Password User

Client secret adalah credential aplikasi. Jika bocor:

1. attacker bisa impersonate client;
2. authorization code exchange dapat disalahgunakan;
3. refresh/token endpoint abuse meningkat.

### 19.3 private_key_jwt

Client menandatangani JWT untuk autentikasi ke token endpoint.

Kelebihan:

1. tidak mengirim shared secret statis;
2. private key bisa di-HSM/KMS;
3. rotation lebih terstruktur;
4. audit signing lebih jelas.

Risiko:

1. key custody harus benar;
2. JWT assertion validation harus ketat;
3. clock skew harus dikelola;
4. `jti` replay protection perlu dipertimbangkan.

---

## 20. Service-to-Service Authorization

### 20.1 Client Credentials Grant

Untuk machine-to-machine, user tidak terlibat.

```text
service A authenticates as client
gets access token
calls service B
```

### 20.2 Security Invariants

1. token audience adalah service B;
2. subject/client identity adalah service A;
3. scope cukup spesifik;
4. service B tidak menerima token untuk service lain;
5. token lifetime pendek;
6. client secret/private key tersimpan aman;
7. network identity dan token identity tidak saling menggantikan tanpa policy.

### 20.3 Common Mistake

```text
Internal network -> no token validation needed
```

Salah. Internal network bukan trust boundary absolut. Lateral movement, compromised pod, SSRF, dan misconfigured gateway tetap mungkin.

---

## 21. Token Exchange and Delegation Chains

### 21.1 Problem

Service A menerima request dari user, lalu perlu memanggil Service B.

Pertanyaan:

```text
Apakah Service A memanggil B sebagai dirinya sendiri?
Atau sebagai user?
Atau sebagai delegated actor dengan batasan tertentu?
```

### 21.2 Anti-Pattern

Forward access token user ke semua downstream service tanpa audience dan delegation boundary.

Masalah:

1. token replay lintas service;
2. audience mismatch diabaikan;
3. privilege terlalu luas;
4. audit actor tidak jelas;
5. confused deputy.

### 21.3 Better Model

```text
Incoming user token -> validate at edge/service
Service A obtains downstream token for Service B
Downstream token has audience=B
Delegation claims preserve original actor if needed
Service B authorizes based on service identity + delegated user context
```

---

## 22. Identity Bridging and Enterprise SSO

### 22.1 Problem Enterprise

Aplikasi sering berhubungan dengan:

1. corporate IdP;
2. government identity provider;
3. citizen identity provider;
4. legacy SSO;
5. API gateway identity;
6. internal realm;
7. partner federation.

### 22.2 Security Risk

Identity bridge bisa salah mapping:

```text
external subject -> internal user
```

Risiko:

1. account takeover karena email match lemah;
2. duplicate identity;
3. tenant/agency boundary rusak;
4. stale role mapping;
5. privilege escalation saat claim berubah;
6. federated identity replacement tanpa verification.

### 22.3 Safe Mapping Invariant

```text
An external identity may be linked to an internal account only if issuer, subject, tenant, and verified binding policy match exactly.
```

### 22.4 Attribute Update Policy

Pertanyaan penting:

1. Apakah attribute dari IdP selalu overwrite local profile?
2. Attribute mana authoritative?
3. Bagaimana jika email berubah?
4. Bagaimana jika legal name berubah?
5. Bagaimana jika agency/role claim hilang?
6. Bagaimana audit perubahan identity mapping?

---

## 23. Error Handling and Security Telemetry

### 23.1 Error yang Tidak Boleh Terlalu Detail ke User

Jangan tampilkan:

1. `kid not found` detail;
2. expected issuer;
3. token parsing stack trace;
4. JWKS URL internal;
5. client secret/config;
6. full token;
7. claim dump.

### 23.2 Error Internal Harus Cukup Diagnostik

Log internal harus punya:

1. correlation id;
2. auth flow id;
3. issuer id;
4. client id;
5. failure category;
6. token hash/fingerprint, bukan token penuh;
7. remote IP/user agent jika relevan;
8. timestamp;
9. environment;
10. decision result.

### 23.3 Failure Categories

```text
AUTH_FLOW_STATE_MISMATCH
AUTH_FLOW_NONCE_MISMATCH
TOKEN_EXPIRED
TOKEN_ISSUER_INVALID
TOKEN_AUDIENCE_INVALID
TOKEN_SIGNATURE_INVALID
TOKEN_KID_UNKNOWN
JWKS_FETCH_FAILED
TOKEN_ALGORITHM_REJECTED
TOKEN_SCOPE_INSUFFICIENT
```

---

## 24. Java Implementation Architecture

### 24.1 Boundary yang Disarankan

```text
controller/filter
  -> authentication entrypoint
  -> OAuth/OIDC flow service
  -> token client
  -> token validator
  -> identity mapper
  -> session manager
  -> authorization policy engine
```

Jangan taruh semua di controller callback.

### 24.2 Package Example

```text
com.example.security.oauth
  OAuthLoginController.java
  OAuthCallbackController.java
  OAuthAuthorizationRequestFactory.java
  OAuthLoginAttemptStore.java
  OAuthTokenClient.java
  OidcIdTokenValidator.java
  OAuthAccessTokenValidator.java
  JwksKeySource.java
  OidcIdentityMapper.java
  SessionIssuer.java
  LogoutService.java
  SecurityEventPublisher.java
```

### 24.3 Strong Types

Hindari `Map<String, Object>` bocor ke seluruh aplikasi.

Gunakan typed object:

```java
public record ExternalIdentity(
    String issuer,
    String subject,
    Optional<String> email,
    boolean emailVerified,
    Map<String, String> attributes
) {}

public record AuthenticatedPrincipal(
    String internalUserId,
    String externalIssuer,
    String externalSubject,
    Set<String> roles,
    Set<String> permissions,
    Instant authenticatedAt
) {}
```

### 24.4 Token Validator Interface

```java
public interface TokenValidator<T extends ValidatedToken> {
    T validate(String token) throws TokenValidationException;
}
```

Pisahkan:

```java
public final class OidcIdTokenValidator implements TokenValidator<ValidatedIdToken> {}
public final class JwtAccessTokenValidator implements TokenValidator<ValidatedAccessToken> {}
```

Ini mengurangi token confusion.

---

## 25. Example: OIDC Login Callback Flow

```java
public final class OidcCallbackService {
    private final LoginAttemptStore attempts;
    private final TokenEndpointClient tokenClient;
    private final IdTokenValidator idTokenValidator;
    private final IdentityMapper identityMapper;
    private final ApplicationSessionService sessions;
    private final SecurityEventPublisher events;

    public LoginResult handleCallback(String code, String state, RequestContext request) {
        LoginAttempt attempt = attempts.consume(state)
            .orElseThrow(() -> new AuthenticationFlowException("Invalid login state"));

        if (attempt.isExpired()) {
            events.publish("AUTH_FLOW_EXPIRED", request.safeAuditData());
            throw new AuthenticationFlowException("Login attempt expired");
        }

        TokenResponse tokenResponse = tokenClient.exchangeAuthorizationCode(
            code,
            attempt.codeVerifier(),
            attempt.redirectUri()
        );

        ValidatedIdToken idToken = idTokenValidator.validate(
            tokenResponse.idToken(),
            attempt.nonce()
        );

        ExternalIdentity identity = ExternalIdentity.from(idToken);
        AuthenticatedPrincipal principal = identityMapper.map(identity);

        ApplicationSession session = sessions.create(principal, request);

        events.publish("LOGIN_SUCCESS", Map.of(
            "issuer", idToken.issuer(),
            "subjectHash", AuditHash.sha256(idToken.subject()),
            "sessionId", session.id()
        ));

        return new LoginResult(session, attempt.redirectAfterLogin());
    }
}
```

Catatan:

1. state dikonsumsi single-use;
2. code verifier dipakai saat token exchange;
3. ID token divalidasi dengan nonce;
4. identity mapping terpisah;
5. session lokal dibuat setelah semua invariant lolos;
6. log memakai hash subject, bukan dump token.

---

## 26. Example: API Access Token Validation

```java
public final class BearerTokenAuthenticationFilter {
    private final AccessTokenValidator validator;
    private final AuthorizationContextFactory contextFactory;

    public void doFilter(Request request, Response response, FilterChain chain) {
        String token = extractBearerToken(request)
            .orElseThrow(() -> new UnauthorizedException("Missing bearer token"));

        ValidatedAccessToken accessToken = validator.validate(token);

        AuthorizationContext context = contextFactory.from(accessToken, request);

        SecurityContextHolder.set(context);

        chain.doFilter(request, response);
    }
}
```

Validator harus menolak:

1. wrong issuer;
2. wrong audience;
3. expired token;
4. unsupported algorithm;
5. invalid signature;
6. insufficient token type;
7. malformed token;
8. token dari issuer tak dikenal.

Authorization object-level tetap dilakukan di service/domain layer.

---

## 27. Example: Authorization Code + PKCE Generator

```java
public final class PkceGenerator {
    private final SecureRandom secureRandom = new SecureRandom();

    public PkcePair generate() {
        byte[] verifierBytes = new byte[32];
        secureRandom.nextBytes(verifierBytes);

        String codeVerifier = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(verifierBytes);

        byte[] challengeBytes = sha256(codeVerifier.getBytes(StandardCharsets.US_ASCII));

        String codeChallenge = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(challengeBytes);

        return new PkcePair(codeVerifier, codeChallenge, "S256");
    }

    private static byte[] sha256(byte[] input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return digest.digest(input);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}

public record PkcePair(String verifier, String challenge, String method) {}
```

Production note:

1. jangan log `verifier`;
2. simpan hanya selama login attempt aktif;
3. gunakan state/nonce terpisah;
4. TTL pendek;
5. consume single-use.

---

## 28. Common Enterprise Failure Modes

### 28.1 Login Sukses Dengan Token dari Realm Salah

Penyebab:

1. multiple issuer;
2. JWKS global;
3. validator hanya cek signature;
4. issuer tidak dicek.

Mitigasi:

```text
issuer-bound metadata and validation policy
```

### 28.2 User dari Agency A Bisa Masuk sebagai Agency B

Penyebab:

1. mapping by email;
2. tenant claim tidak dicek;
3. stale local role;
4. no authoritative source policy.

Mitigasi:

```text
issuer + subject + tenant binding
```

### 28.3 Logout Tidak Benar-Benar Logout

Penyebab:

1. hanya clear SPA state;
2. refresh token masih valid;
3. IdP session masih aktif;
4. back-channel logout tidak diproses.

Mitigasi:

```text
local session invalidation + refresh token revocation + optional OP logout/back-channel logout
```

### 28.4 Service Menerima Token untuk Service Lain

Penyebab:

1. audience validation tidak ada;
2. shared validator;
3. internal trust terlalu luas.

Mitigasi:

```text
each resource server validates own audience
```

### 28.5 JWKS Rotation Menyebabkan Outage

Penyebab:

1. cache terlalu lama;
2. no unknown-kid refresh;
3. no overlap key policy;
4. authorization server rotates abruptly.

Mitigasi:

```text
cache TTL + refresh on unknown kid + alerting + operational runbook
```

### 28.6 Token Valid Tapi User Sudah Dinonaktifkan

Penyebab:

1. JWT stateless;
2. long access token lifetime;
3. no introspection/revocation;
4. local account status not checked.

Mitigasi:

```text
short-lived token + local account status check + risk-based introspection/cache invalidation
```

---

## 29. Security Review Checklist

### 29.1 Authorization Request

- [ ] Uses Authorization Code Flow.
- [ ] Uses PKCE with `S256`.
- [ ] Generates cryptographically strong `state`.
- [ ] Generates OIDC `nonce`.
- [ ] Uses exact registered redirect URI.
- [ ] Does not put sensitive data in URL.
- [ ] Stores login attempt with TTL.
- [ ] Binds login attempt to browser/session context.

### 29.2 Callback

- [ ] Validates `state` before code exchange.
- [ ] Consumes state single-use.
- [ ] Rejects expired login attempt.
- [ ] Exchanges code only through back-channel.
- [ ] Sends `code_verifier`.
- [ ] Does not log code/verifier/token.
- [ ] Validates token endpoint TLS.

### 29.3 ID Token

- [ ] Verifies signature.
- [ ] Restricts algorithms.
- [ ] Checks issuer.
- [ ] Checks audience/client id.
- [ ] Checks expiry.
- [ ] Checks nonce.
- [ ] Handles clock skew intentionally.
- [ ] Uses issuer+subject as external identity key.

### 29.4 Access Token

- [ ] Validates issuer.
- [ ] Validates audience/resource server.
- [ ] Validates expiry.
- [ ] Validates signature or introspection result.
- [ ] Enforces scope/permission.
- [ ] Does not use ID token as access token.
- [ ] Does not use access token as login proof without OIDC semantics.

### 29.5 JWKS

- [ ] JWKS URI comes from trusted discovery/config.
- [ ] Does not fetch key URL from token header.
- [ ] Caches keys with bounded TTL.
- [ ] Refreshes once on unknown `kid`.
- [ ] Handles key rollover.
- [ ] Restricts allowed algorithms.
- [ ] Binds keys to issuer.

### 29.6 Sessions and Logout

- [ ] Session cookie is HttpOnly, Secure, SameSite.
- [ ] Session id rotates after login.
- [ ] Logout invalidates local session.
- [ ] Refresh token revoked if applicable.
- [ ] OP/logout semantics documented.
- [ ] Back-channel logout endpoint validates logout token.
- [ ] Session lifetime aligned with risk.

### 29.7 Enterprise Identity Mapping

- [ ] Mapping does not rely solely on email.
- [ ] Issuer and subject are preserved.
- [ ] Tenant/agency boundary validated.
- [ ] Attribute authority is documented.
- [ ] Role mapping changes are audited.
- [ ] Disabled local user cannot login even with valid token.

---

## 30. Threat Model Table

| Threat | Example | Broken Invariant | Mitigation |
|---|---|---|---|
| Authorization code interception | Attacker obtains code from redirect | Only initiating client may exchange code | PKCE S256, TLS, exact redirect URI |
| Login CSRF | Victim browser receives attacker auth response | Callback must match initiated login attempt | State, single-use attempt store |
| ID token replay | Old ID token reused | ID token belongs to current auth request | Nonce validation, expiry |
| Token confusion | ID token used as API access token | Token type/context must match use | Separate validators, audience/token-use checks |
| Audience bypass | API accepts token for another API | Token audience must be this resource | Strict audience validation |
| Issuer mix-up | Token from wrong realm accepted | Issuer must match configured trust root | Issuer-bound metadata/JWKS |
| Key substitution | Token header points to attacker JWKS | Key source must be trusted config | Ignore untrusted `jku`/`x5u` |
| Refresh token theft | Attacker persists access | Refresh capability must remain controlled | Rotation, revocation, server-side storage |
| Open redirect | Code/session redirected to attacker | Redirect target must be allowlisted | Exact redirect URI, safe post-login redirect |
| Logout bypass | Local UI clears but token valid | Logout must revoke local/refresh capability | Server session invalidation, revocation |

---

## 31. Design Principles

### Principle 1 — Token Validity Is Contextual

Tidak ada “valid JWT” secara universal. Yang ada:

```text
valid for issuer X, audience Y, purpose Z, time T, algorithm A, policy P
```

### Principle 2 — Authentication Result and Authorization Decision Are Different

Login sukses tidak berarti semua aksi boleh.

```text
Authenticated user
  != authorized for object/action/state transition
```

### Principle 3 — Browser Is Not a Secret Store

Frontend boleh membantu flow, tapi jangan jadikan browser tempat penyimpanan secret jangka panjang kecuali threat model dan mitigasi jelas.

### Principle 4 — Issuer Is a Trust Root

Semua metadata, JWKS, claim interpretation, dan subject mapping harus dibatasi oleh issuer.

### Principle 5 — Logout Must Be Modeled Explicitly

Logout tidak boleh dianggap “clear localStorage”. Harus jelas session mana, token mana, IdP session mana, dan downstream session mana yang dihentikan.

### Principle 6 — JWT Claim Is Not Domain Policy

Claim adalah input untuk policy, bukan policy itu sendiri.

---

## 32. Mini Case Study: Java Case Management Platform with SSO

### 32.1 Context

Sistem regulatory case management memiliki:

1. SPA frontend;
2. Java backend API;
3. identity provider corporate/agency;
4. multiple user roles;
5. sensitive case records;
6. audit trail;
7. cross-application app switcher;
8. idle timeout dan max session;
9. service-to-service API.

### 32.2 Naive Design

```text
SPA redirects to IdP
SPA receives tokens
SPA stores access token and refresh token in localStorage
SPA calls all APIs directly
Each API decodes JWT and checks role claim
Logout clears localStorage
```

Problems:

1. XSS steals refresh token;
2. each API may validate token differently;
3. role claim used as complete authorization;
4. token audience may not be checked;
5. logout does not revoke refresh token;
6. token storage exposed to browser;
7. cross-app SSO can create session confusion.

### 32.3 Better Design

```text
SPA -> Java BFF session cookie
Java BFF handles Authorization Code + PKCE
Tokens stored server-side
BFF calls backend APIs with audience-specific access tokens
Backend APIs validate issuer/audience/scope
Domain services enforce object-level authorization
Logout invalidates local session and refresh capability
Back-channel logout supported for SSO session propagation
```

### 32.4 Security Invariants

1. Browser never sees refresh token.
2. Each API receives token whose audience is that API.
3. Login session maps to issuer+subject, not email only.
4. Role claim never bypasses domain authorization.
5. Logout disables local session and refresh capability.
6. Token validation is centralized and typed.
7. Audit logs include auth decision metadata without leaking tokens.

---

## 33. Practical Java Library Considerations

### 33.1 What a Library Should Provide

When choosing OAuth/OIDC/JWT library, check whether it supports:

1. strict issuer validation;
2. strict audience validation;
3. algorithm allowlist;
4. JWKS issuer binding;
5. JWKS caching and rotation;
6. nonce validation;
7. clock skew configuration;
8. introspection support;
9. opaque token support if needed;
10. safe error handling;
11. no auto-fetch from token header URLs by default;
12. support for back-channel logout if required;
13. testability.

### 33.2 Avoid DIY

Do not implement JWT parsing/signature verification manually unless you are building a security library and have cryptographic review.

Application code should express policy, not reimplement JOSE.

### 33.3 Still Review Library Defaults

Even good libraries can be misconfigured:

1. accepting any issuer;
2. skipping audience;
3. defaulting to broad clock skew;
4. auto-discovering untrusted metadata;
5. using generic validators for both ID/access token;
6. trusting claims without mapping policy.

---

## 34. Testing Strategy

### 34.1 Unit Tests

Test token validator rejects:

1. wrong issuer;
2. wrong audience;
3. expired token;
4. future `nbf`;
5. unsupported algorithm;
6. wrong nonce;
7. missing required claim;
8. unknown `kid` after refresh;
9. token signed by wrong key;
10. ID token passed to access validator.

### 34.2 Integration Tests

Test full flow:

1. login success;
2. state mismatch;
3. expired state;
4. code exchange failure;
5. JWKS rotation;
6. logout;
7. refresh token rotation;
8. disabled user after token issued;
9. multi-realm login;
10. redirect target allowlist.

### 34.3 Security Regression Tests

Keep regression tests for past vulnerabilities:

```text
SEC-001 state mismatch must fail
SEC-002 nonce mismatch must fail
SEC-003 access token for API-A rejected by API-B
SEC-004 email-only account linking rejected
SEC-005 post-login absolute redirect rejected
SEC-006 token header jku ignored
SEC-007 unknown issuer rejected
SEC-008 local disabled user rejected despite valid token
```

---

## 35. Operational Runbook

### 35.1 JWKS Rotation Incident

Symptoms:

1. sudden login/API failures;
2. unknown `kid`;
3. signature validation failures;
4. IdP key rollover.

Actions:

1. verify issuer metadata;
2. refresh JWKS cache;
3. check cache TTL;
4. check system clock;
5. check algorithm policy;
6. check whether old and new keys overlap;
7. monitor failure rate;
8. do not disable signature validation.

### 35.2 Certificate/TLS Failure to IdP

Actions:

1. verify TLS truststore;
2. verify certificate chain;
3. verify hostname;
4. verify proxy inspection behavior;
5. verify JDK disabled algorithm policy;
6. do not set trust-all manager.

### 35.3 Token Leak

Actions:

1. identify token type;
2. hash/fingerprint leaked token for search;
3. revoke refresh token/token family;
4. reduce session risk;
5. rotate client secret/private key if leaked;
6. inspect logs for full token leakage;
7. invalidate affected sessions;
8. write post-incident controls.

---

## 36. Anti-Pattern Catalog

### Anti-Pattern 1 — `decodeJwtWithoutValidation()`

Reading claims before validation and making decisions from them.

### Anti-Pattern 2 — Trusting `alg` From Token

Letting token choose algorithm instead of server policy.

### Anti-Pattern 3 — JWKS From Token Header

Fetching key material based on untrusted token header.

### Anti-Pattern 4 — Email as Primary Identity

Mapping external login to local account by email only.

### Anti-Pattern 5 — localStorage Refresh Token

Putting long-lived credential in JavaScript-accessible storage.

### Anti-Pattern 6 — Access Token as Session

Treating access token as application session without session lifecycle.

### Anti-Pattern 7 — Role Claim as Full Authorization

Letting token role directly bypass object-level policy.

### Anti-Pattern 8 — Logout Equals Clear Browser State

Not revoking server-side session/refresh capability.

### Anti-Pattern 9 — One Generic JWT Validator

Using one method for ID token, access token, logout token, webhook token.

### Anti-Pattern 10 — Disabling TLS Verification for IdP

Using trust-all or hostname-verification-disabled to “fix” integration.

---

## 37. Review Questions

1. In your system, which components are OAuth clients, resource servers, and relying parties?
2. Which token types exist, and where are they accepted?
3. Is ID token validation separated from access token validation?
4. Is issuer checked in every validator?
5. Is audience checked based on receiving component?
6. Is `state` generated, stored, validated, and consumed single-use?
7. Is `nonce` used and checked for OIDC login?
8. Is PKCE using `S256`?
9. Are refresh tokens stored outside browser JavaScript access?
10. Is logout local-only or also IdP/token revocation aware?
11. How does the app behave during JWKS rotation?
12. Does authorization check object ownership/state, or only token role?
13. Can a token from another realm be accepted accidentally?
14. Can a disabled local user still log in with a valid IdP token?
15. Are full tokens ever logged?

---

## 38. Summary

OAuth2/OIDC security is not mainly about memorizing flow diagrams. The hard part is preserving the right security invariants across browser redirects, token exchange, session creation, token validation, authorization, logout, and service-to-service calls.

Key takeaways:

1. OAuth2 is authorization/delegation; OIDC adds authentication semantics.
2. Authorization Code + PKCE is the modern baseline for interactive login.
3. `state` protects flow correlation/CSRF; `nonce` binds ID token to authentication request.
4. ID token and access token have different purposes and must have different validators.
5. Signature validation alone is not enough; issuer, audience, expiry, algorithm, nonce, and context matter.
6. JWKS must be issuer-bound and rotation-aware.
7. Browser should not be treated as a long-term secret store.
8. Logout must explicitly model local session, refresh capability, and IdP session.
9. Token claims are inputs to authorization, not the complete authorization policy.
10. Enterprise identity mapping must use issuer+subject+tenant binding, not email-only matching.

Security invariant paling penting:

```text
A token or authorization response may be accepted only when it is valid for this issuer, this client/resource, this flow, this time, this purpose, and this policy context.
```

---

## 39. Transisi ke Part Berikutnya

Part berikutnya adalah:

```text
Part 21 — Authorization Integrity: Policy, Permission, and Confused Deputy
```

Setelah memahami OAuth2/OIDC sebagai identity/token boundary, kita akan masuk ke masalah yang lebih sulit: **authorization correctness**.

Login valid tidak cukup. Token valid tidak cukup. Role valid tidak cukup.

Pertanyaan berikutnya:

> “Bagaimana memastikan user/service yang sudah authenticated hanya bisa melakukan aksi yang benar terhadap object yang benar pada state yang benar, tanpa confused deputy dan privilege escalation?”

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-019](./learn-java-security-cryptography-integrity-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-021](./learn-java-security-cryptography-integrity-part-021.md)

</div>