# learn-java-authentication-modes-and-patterns-part-014

# Part 14 — OpenID Connect: Authentication on Top of OAuth 2.0

> Seri: **Java Authentication Modes and Patterns**  
> Range Java: **Java 8 sampai Java 25**  
> Fokus: **OpenID Connect sebagai identity layer di atas OAuth2; bagaimana aplikasi Java membuktikan login user, memvalidasi ID Token, mengambil claims, mengelola session, melakukan logout, dan menghindari failure mode federated authentication**

---

## 0. Posisi Part Ini dalam Series

Pada Part 13 kita membahas **OAuth 2.0** sebagai framework untuk delegated authorization. OAuth2 menjawab pertanyaan seperti:

```text
Apakah client ini boleh mengakses protected resource tertentu dengan scope tertentu?
```

Namun OAuth2 sendiri tidak secara lengkap menjawab:

```text
Siapa user ini?
Kapan user diautentikasi?
Dengan metode apa user diautentikasi?
Apakah token ini memang diterbitkan untuk login ke aplikasi ini?
Apakah client boleh membuat session user berdasarkan token ini?
```

Di sinilah **OpenID Connect**, atau **OIDC**, masuk.

OIDC adalah identity layer di atas OAuth2. Ia menggunakan mekanisme OAuth2, terutama authorization code flow, tetapi menambahkan kontrak authentication yang eksplisit:

- `openid` scope,
- ID Token,
- standardized claims,
- issuer discovery,
- JWKS,
- nonce,
- UserInfo endpoint,
- authentication context,
- session/logout specifications.

Mental model awal:

```text
OAuth2 access token = bukti akses ke resource.
OIDC ID Token       = assertion bahwa user telah diautentikasi oleh issuer untuk client tertentu.
Session aplikasi    = state lokal yang dibuat aplikasi setelah memercayai assertion tersebut.
```

Kalimat penting:

> OIDC bukan sekadar “OAuth2 yang ada email user-nya”. OIDC adalah kontrak authentication yang membuat relying party dapat memverifikasi identity event yang dilakukan oleh OpenID Provider.

Dalam Java enterprise, OIDC biasanya muncul melalui:

1. Spring Security `oauth2Login()`.
2. Spring Security resource server yang memvalidasi JWT access token.
3. Jakarta Security `@OpenIdAuthenticationMechanismDefinition`.
4. Keycloak, Okta, Microsoft Entra ID, Auth0, Ping, ForgeRock, Cognito, atau custom authorization server.
5. BFF pattern untuk SPA.
6. SSO antar aplikasi.
7. Integration dengan legacy session app.
8. Government/enterprise identity provider seperti Singpass/Corppass-style external IdP.

Part ini tidak akan mengulang OAuth2 dasar dari Part 13. Kita akan fokus pada aspek yang membuat OIDC menjadi **authentication protocol**.

---

## 1. Problem yang Diselesaikan OIDC

OAuth2 memungkinkan client mendapatkan access token. Namun access token bukan bukti login yang cukup untuk aplikasi client.

Misalnya:

```text
User login ke Authorization Server.
Client menerima access token.
Client memanggil API /userinfo atau API profile.
Client membuat session lokal.
```

Tanpa OIDC, beberapa pertanyaan tetap tidak terjawab dengan standar kuat:

1. Apakah user benar-benar diautentikasi?
2. Siapa issuer identity-nya?
3. Apakah token/response ini untuk client saya?
4. Apakah response ini hasil flow saya atau replay dari flow lain?
5. Apakah user yang sama bisa diidentifikasi stabil lintas login?
6. Apakah claim email sudah diverifikasi?
7. Bagaimana client tahu public key untuk validasi signature?
8. Bagaimana client tahu endpoint authorization/token/userinfo/logout issuer?
9. Bagaimana logout antara aplikasi dan IdP diselaraskan?
10. Bagaimana aplikasi membedakan OAuth access authorization dan OIDC authentication?

OIDC memberi struktur:

```text
OpenID Provider authenticates the End-User.
Relying Party receives an ID Token.
Relying Party validates ID Token.
Relying Party maps claims to local principal/session.
Relying Party optionally calls UserInfo for more claims.
```

Komponen penting:

| Komponen | Makna |
|---|---|
| OpenID Provider / OP | Authorization server yang mendukung OIDC dan mengautentikasi user |
| Relying Party / RP | Aplikasi client yang bergantung pada OP untuk authentication |
| End-User | Human user yang diautentikasi |
| ID Token | JWT yang berisi claims tentang authentication event |
| UserInfo endpoint | Protected resource untuk mengambil claims user tambahan |
| Discovery document | Metadata OP agar RP tahu endpoint dan capability |
| JWKS | Public keys untuk validasi signature token |

---

## 2. OIDC Bukan Pengganti Semua Authentication

OIDC sangat penting, tetapi bukan jawaban untuk semua skenario.

OIDC cocok untuk:

1. Web SSO.
2. Enterprise login.
3. Federated identity.
4. SPA + BFF login.
5. Native/mobile login dengan PKCE.
6. Multi-application session entry point.
7. External identity provider integration.
8. Centralized identity governance.

OIDC kurang tepat jika kebutuhan utamanya:

1. API partner simple dengan shared secret.
2. Service-to-service non-human identity tanpa user.
3. Low-level device authentication tanpa browser.
4. Offline embedded system.
5. Extremely low-latency internal RPC yang sudah memakai mTLS identity.
6. Message-level authentication di Kafka/RabbitMQ tanpa interactive login.

Untuk machine-to-machine, biasanya yang lebih tepat adalah:

```text
OAuth2 client credentials
private_key_jwt
mTLS client authentication
workload identity
SPIFFE/SPIRE
cloud IAM role
```

OIDC tetap bisa hadir sebagai bagian dari platform identity, tetapi jangan memaksakan human login protocol untuk semua caller.

---

## 3. Core Mental Model: Three Tokens, Three Meanings

Dalam flow OIDC umum, aplikasi bisa menerima beberapa token:

```text
Authorization Code -> Token Endpoint -> ID Token + Access Token + optional Refresh Token
```

Masing-masing punya makna berbeda.

| Token | Target utama | Dipakai untuk | Jangan dipakai untuk |
|---|---|---|---|
| ID Token | Relying Party / client | Membuktikan authentication event user | Memanggil resource API |
| Access Token | Resource Server | Mengakses protected API | Membuat session user tanpa konteks OIDC |
| Refresh Token | Client/token endpoint | Mendapat access token baru | Dikirim ke API/resource server |

Kesalahan umum:

```text
Aplikasi menerima access token lalu menganggap itu login user.
```

Lebih benar:

```text
Aplikasi melakukan OIDC flow.
Aplikasi menerima ID Token.
Aplikasi memvalidasi ID Token secara ketat.
Aplikasi membuat session lokal berdasarkan subject dan claims yang valid.
Access token disimpan/ditukar/dipakai hanya untuk resource access sesuai desain.
```

Top 1% engineer selalu bertanya:

1. Token ini diterbitkan oleh siapa?
2. Token ini ditujukan untuk siapa?
3. Token ini membuktikan apa?
4. Token ini boleh dipakai di boundary mana?
5. Token ini lifetime-nya berapa?
6. Token ini bisa dicabut atau tidak?
7. Apa yang terjadi jika token bocor?

---

## 4. OIDC Actor Model

OIDC memperkenalkan istilah yang sedikit berbeda dari OAuth2, walaupun berdiri di atas OAuth2.

```text
+------------+        +-------------------+        +------------------+
| End-User   |        | Relying Party     |        | OpenID Provider  |
| Human      |        | Java Application  |        | IdP/Auth Server  |
+------------+        +-------------------+        +------------------+
      |                         |                           |
      | Open app                |                           |
      |------------------------>|                           |
      |                         | Redirect to OP             |
      |                         |-------------------------->|
      |                         |                           | Authenticate user
      |                         |<--------------------------|
      | Browser redirected back |                           |
      |------------------------>|                           |
      |                         | Token request              |
      |                         |-------------------------->|
      |                         | ID Token + tokens          |
      |                         |<--------------------------|
      | Session created         |                           |
```

Dalam Java web app:

- RP bisa berupa Spring Boot application.
- RP bisa berupa Jakarta EE application.
- OP bisa berupa Keycloak.
- OP bisa berupa Entra ID, Okta, Auth0, Cognito, Ping, ForgeRock.
- Browser adalah front-channel transport.
- Token endpoint biasanya dipanggil back-channel oleh server.

Pemisahan front-channel/back-channel penting:

| Channel | Contoh | Risiko |
|---|---|---|
| Front-channel | redirect browser, authorization response | code interception, open redirect, state mismatch |
| Back-channel | token request dari backend ke OP | secret/key handling, TLS, timeout, retry |

---

## 5. ID Token sebagai Authentication Assertion

ID Token adalah JWT yang berisi claims tentang authentication event.

Contoh konseptual payload ID Token:

```json
{
  "iss": "https://idp.example.com/realms/main",
  "sub": "248289761001",
  "aud": "my-java-web-app",
  "exp": 1730000300,
  "iat": 1730000000,
  "auth_time": 1729999900,
  "nonce": "n-0S6_WzA2Mj",
  "acr": "urn:mfa:loa2",
  "amr": ["pwd", "otp"],
  "email": "user@example.com",
  "email_verified": true,
  "name": "Example User"
}
```

Yang harus ditekankan:

```text
ID Token bukan data profile biasa.
ID Token adalah security assertion.
```

Karena itu harus divalidasi seperti security artifact:

1. Signature valid.
2. Issuer benar.
3. Audience benar.
4. Expiry belum lewat.
5. Not-before jika ada valid.
6. Issued-at masuk akal.
7. Nonce cocok untuk flow tertentu.
8. Authorized party (`azp`) dicek jika perlu.
9. Algorithm sesuai whitelist.
10. Key ID (`kid`) dipilih dari issuer yang benar.

---

## 6. ID Token Claims yang Wajib Dipahami

### 6.1 `iss` — Issuer

`iss` adalah identity authority yang menerbitkan token.

Contoh:

```text
https://idp.company.com/realms/employee
https://login.microsoftonline.com/{tenantId}/v2.0
https://accounts.google.com
```

Validasi penting:

```text
Token harus berasal dari issuer yang dikonfigurasi.
```

Jangan hanya percaya signature jika issuer tidak dicek. Dalam multi-tenant system, salah issuer bisa menjadi cross-tenant authentication bug.

Failure mode:

```text
Aplikasi menerima ID Token dari issuer tenant A untuk login ke tenant B.
```

### 6.2 `sub` — Subject

`sub` adalah identifier stabil untuk end-user dalam konteks issuer.

Aturan penting:

```text
Unique user key = issuer + subject
```

Jangan memakai email sebagai primary identity key.

Masalah email sebagai identity key:

1. Email bisa berubah.
2. Email bisa tidak terverifikasi.
3. Email bisa didaur ulang oleh provider tertentu.
4. Email bisa sama secara case/normalization tricky.
5. Satu orang bisa punya beberapa email.
6. Beberapa enterprise IdP mengubah email ketika user pindah organisasi.

Lebih aman:

```text
local_identity.external_issuer = iss
local_identity.external_subject = sub
```

### 6.3 `aud` — Audience

`aud` menunjukkan token ditujukan untuk siapa.

Untuk ID Token:

```text
aud harus berisi client_id relying party.
```

Jika app menerima ID Token dengan `aud` milik app lain, itu token substitution vulnerability.

### 6.4 `azp` — Authorized Party

`azp` dipakai ketika audience memiliki lebih dari satu nilai atau ada pihak authorized tertentu.

Rule praktis:

```text
Jika aud multiple atau provider mewajibkan azp, pastikan azp sesuai client_id.
```

### 6.5 `exp`, `iat`, `nbf`

Claims waktu:

| Claim | Makna |
|---|---|
| `exp` | expiration time |
| `iat` | issued at |
| `nbf` | not before |

Validasi harus mempertimbangkan clock skew kecil, bukan menerima token kadaluarsa terlalu lama.

### 6.6 `nonce`

Nonce mengikat authorization request dengan ID Token response.

Flow:

```text
RP generate nonce.
RP simpan nonce sementara di session/authorization request repository.
RP kirim nonce ke OP.
OP memasukkan nonce ke ID Token.
RP validasi nonce dari ID Token sama dengan nonce yang dikirim.
```

Nonce membantu melawan replay/substitution dalam flow OIDC tertentu.

### 6.7 `auth_time`

`auth_time` menunjukkan kapan user diautentikasi oleh OP.

Ini penting untuk step-up:

```text
User ingin melakukan transaksi high-risk.
Aplikasi meminta max_age=300.
OP harus memastikan user baru saja authenticate dalam 5 menit terakhir.
RP memvalidasi auth_time.
```

### 6.8 `acr` — Authentication Context Class Reference

`acr` menunjukkan kelas/kekuatan konteks authentication.

Contoh konseptual:

```text
urn:loa:1
urn:loa:2
urn:mfa
urn:banking:strong
```

Jangan asumsikan format universal. Ia sering provider-specific atau profile-specific.

### 6.9 `amr` — Authentication Methods References

`amr` menunjukkan metode yang digunakan.

Contoh:

```json
["pwd"]
["pwd", "otp"]
["mfa"]
["fido"]
["hwk"]
```

Gunakan hati-hati karena interpretasi bisa beda antar provider.

### 6.10 `email` dan `email_verified`

`email` bukan bukti kepemilikan email kecuali `email_verified=true` dan provider semantics jelas.

Rule:

```text
Email boleh untuk komunikasi/display.
Issuer+sub untuk identity binding.
```

---

## 7. Discovery Document

OIDC Discovery menyediakan metadata provider.

Umumnya tersedia di:

```text
{issuer}/.well-known/openid-configuration
```

Contoh metadata penting:

```json
{
  "issuer": "https://idp.example.com/realms/main",
  "authorization_endpoint": "https://idp.example.com/realms/main/protocol/openid-connect/auth",
  "token_endpoint": "https://idp.example.com/realms/main/protocol/openid-connect/token",
  "userinfo_endpoint": "https://idp.example.com/realms/main/protocol/openid-connect/userinfo",
  "jwks_uri": "https://idp.example.com/realms/main/protocol/openid-connect/certs",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public", "pairwise"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```

Manfaat discovery:

1. Endpoint tidak hardcoded secara manual.
2. Algorithm support bisa diketahui.
3. JWKS URI diketahui.
4. Logout/session endpoint bisa diketahui jika provider mendukung.
5. Configuration lebih portable.

Namun discovery juga membawa risiko jika digunakan dinamis sembarangan.

Failure mode:

```text
User memasukkan issuer URL arbitrary.
Aplikasi fetch discovery.
Discovery menunjuk jwks_uri/token_endpoint ke host attacker/internal host.
Terjadi SSRF atau malicious endpoint attack.
```

Rule production:

```text
Issuer harus allowlisted.
Discovery boleh otomatis, tetapi source issuer tidak boleh bebas dari input user tanpa validasi ketat.
```

---

## 8. JWKS dan Key Selection

JWKS adalah JSON Web Key Set, biasanya diambil dari `jwks_uri`.

Contoh konseptual:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "key-2026-01",
      "use": "sig",
      "alg": "RS256",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

Validasi ID Token:

```text
1. Baca header JWT.
2. Ambil alg dan kid.
3. Pastikan alg di whitelist.
4. Cari key dengan kid di JWKS issuer yang benar.
5. Verifikasi signature.
6. Validasi claims.
```

Kesalahan umum:

1. Mengambil key dari `jku` header token attacker.
2. Tidak membatasi algorithm.
3. Menerima `none` algorithm.
4. Menerima HS256 padahal seharusnya RS256.
5. Tidak mengecek issuer sebelum memilih JWKS.
6. Cache JWKS selamanya sehingga key rotation gagal.
7. Fetch JWKS setiap request sehingga IdP menjadi bottleneck.

Production design:

```text
JWKS cache harus punya TTL.
Jika kid tidak ditemukan, refresh sekali.
Jika tetap tidak ada, reject token.
Jangan fail-open.
```

---

## 9. Standard OIDC Authorization Code Flow

Untuk Java web app server-side, flow paling umum:

```text
1. User membuka /login.
2. RP membuat state, nonce, code_verifier jika PKCE dipakai.
3. RP redirect browser ke authorization endpoint.
4. User authenticate di OP.
5. OP redirect ke redirect_uri dengan code dan state.
6. RP validasi state.
7. RP menukar code ke token endpoint.
8. OP mengembalikan ID Token, Access Token, optional Refresh Token.
9. RP validasi ID Token.
10. RP membuat local session.
```

Diagram:

```text
Browser             Java RP                         OpenID Provider
   |                  |                                  |
   | GET /login       |                                  |
   |----------------->|                                  |
   |                  | create state, nonce, PKCE        |
   | 302 auth endpoint|                                  |
   |<-----------------|                                  |
   |---------------------------------------------------->|
   |                  |                                  | authenticate user
   |<----------------------------------------------------|
   | GET /callback?code&state                             |
   |----------------->|                                  |
   |                  | validate state                   |
   |                  | POST /token code + verifier      |
   |                  |--------------------------------->|
   |                  | ID Token + Access Token          |
   |                  |<---------------------------------|
   |                  | validate ID Token                |
   |                  | create app session               |
   | response         |                                  |
   |<-----------------|                                  |
```

Important split:

```text
state protects the authorization response.
nonce binds ID Token to the authentication request.
PKCE protects code exchange.
```

---

## 10. `state`, `nonce`, and PKCE: Different Jobs

Sering ada kebingungan antara `state`, `nonce`, dan PKCE.

| Mechanism | Melindungi dari | Disimpan di | Dicek saat |
|---|---|---|---|
| `state` | CSRF/callback mix-up | RP session/temp store | callback authorization response |
| `nonce` | ID Token replay/substitution | RP session/temp store | ID Token validation |
| PKCE | authorization code interception | RP temp store | token request |

### 10.1 `state`

`state` harus unpredictable dan terikat pada flow login.

Failure mode:

```text
Attacker memulai login dengan akun attacker.
Attacker membuat victim browser menyelesaikan callback.
Victim app session menjadi attacker account.
```

Ini login CSRF / session swapping style issue.

### 10.2 `nonce`

`nonce` harus masuk ke authorization request dan kembali di ID Token.

Failure mode:

```text
ID Token dari flow lama atau client lain dipakai ulang.
Aplikasi tidak mengecek nonce.
```

### 10.3 PKCE

PKCE harus dipakai untuk public clients dan sekarang juga direkomendasikan luas untuk confidential clients.

Flow:

```text
code_verifier  = random high entropy string
code_challenge = BASE64URL(SHA256(code_verifier))
```

Authorization request membawa `code_challenge`, token request membawa `code_verifier`.

Jika authorization code dicuri, attacker tidak bisa menukarnya tanpa `code_verifier`.

---

## 11. UserInfo Endpoint

UserInfo endpoint adalah protected resource yang mengembalikan claims tentang user.

Contoh response:

```json
{
  "sub": "248289761001",
  "name": "Example User",
  "email": "user@example.com",
  "email_verified": true,
  "department": "Compliance"
}
```

Rules:

1. UserInfo dipanggil dengan access token.
2. `sub` dari UserInfo harus cocok dengan `sub` di ID Token.
3. UserInfo bukan pengganti validasi ID Token.
4. UserInfo claims bisa lebih baru/dinamis daripada ID Token claims.
5. Jangan memercayai UserInfo dari issuer berbeda.

Kapan pakai UserInfo:

```text
- butuh claims profile tambahan,
- ID Token sengaja minimal,
- provider tidak menaruh group/role/profile lengkap di ID Token,
- app ingin fetch attributes saat login.
```

Kapan jangan terlalu bergantung:

```text
- setiap request memanggil UserInfo,
- UserInfo menjadi bottleneck login,
- app tidak punya fallback jika UserInfo lambat,
- claims UserInfo dipakai sebagai authorization high-risk tanpa lifecycle jelas.
```

---

## 12. Subject Types: Public vs Pairwise

OIDC mengenal subject type:

```text
public
pairwise
```

### 12.1 Public Subject

`sub` yang sama terlihat oleh banyak relying party dalam issuer yang sama.

Pro:

1. Mudah link user antar app.
2. Cocok untuk enterprise internal suite.
3. Audit lintas aplikasi lebih mudah.

Kontra:

1. Privacy lebih rendah.
2. Cross-client correlation lebih mudah.

### 12.2 Pairwise Subject

`sub` berbeda per client atau sektor identifier.

Pro:

1. Privacy lebih baik.
2. RP tidak mudah mengkorelasikan user antar client.

Kontra:

1. Account linking antar aplikasi perlu strategi.
2. Migration client_id bisa mengubah subject.
3. Support provider bisa bervariasi.

Design rule:

```text
Jangan asumsi sub selalu sama antar client.
Untuk SSO suite internal, pahami apakah provider memakai public atau pairwise subject.
```

---

## 13. Local Account Linking

OIDC memberi external identity. Aplikasi tetap perlu memutuskan bagaimana identity itu dipetakan ke local account.

Tabel konseptual:

```sql
local_user (
    id                 bigint primary key,
    username           varchar,
    display_name       varchar,
    status             varchar,
    created_at         timestamp
)

external_identity (
    id                 bigint primary key,
    local_user_id       bigint not null,
    issuer             varchar not null,
    subject            varchar not null,
    provider_name      varchar not null,
    email_at_link_time varchar,
    linked_at          timestamp,
    last_login_at      timestamp,
    unique (issuer, subject)
)
```

Jangan:

```text
SELECT user WHERE email = id_token.email
lalu login otomatis
```

Lebih aman:

```text
1. Cari external_identity by issuer+subject.
2. Jika ada, login local user terkait.
3. Jika tidak ada, lakukan controlled provisioning/linking.
4. Jika email cocok existing user, butuh policy eksplisit.
```

Policy auto-link by verified email harus hati-hati:

1. Provider harus trusted.
2. `email_verified` harus true.
3. Domain harus sesuai organisasi jika enterprise.
4. Tidak boleh ada duplicate local account.
5. Audit event harus jelas.
6. User mungkin perlu konfirmasi.

Failure mode serius:

```text
Attacker membuat akun di IdP dengan email korban yang belum diverifikasi.
Aplikasi auto-link by email.
Attacker masuk sebagai korban.
```

---

## 14. Claim Mapping: Dari Claims ke Principal Aplikasi

OIDC claims bukan otomatis domain user model.

Claim mapping perlu design:

```text
ID Token/UserInfo claims -> ExternalIdentity -> LocalUser -> AppPrincipal -> Authorization model
```

Contoh AppPrincipal:

```java
public final class AppPrincipal {
    private final String localUserId;
    private final String issuer;
    private final String subject;
    private final String displayName;
    private final Set<String> roles;
    private final Set<String> groups;
    private final Instant authenticatedAt;
    private final String authenticationStrength;
}
```

Perhatikan perbedaan:

| Data | Source | Stability | Use |
|---|---|---|---|
| `iss` + `sub` | ID Token | tinggi | identity binding |
| email | ID Token/UserInfo | sedang/rendah | notification/display |
| name | ID Token/UserInfo | rendah | display |
| groups | IdP claim/UserInfo | bisa besar/dinamis | authorization input |
| roles | app DB atau IdP | tergantung governance | authorization |
| acr/amr | ID Token | per login | step-up/risk decision |

Rule:

```text
Authentication claim != authorization decision final.
```

Claims bisa menjadi input authorization, tetapi domain authorization sebaiknya tetap punya model yang jelas.

---

## 15. Groups and Roles in OIDC

OIDC Core mendefinisikan banyak standard claims, tetapi groups/roles sering provider-specific.

Contoh variasi:

```json
{
  "groups": ["/ACEAS/Admin", "/ACEAS/Officer"]
}
```

```json
{
  "realm_access": {
    "roles": ["admin", "officer"]
  },
  "resource_access": {
    "aceas-web": {
      "roles": ["case:create", "case:view"]
    }
  }
}
```

```json
{
  "roles": ["Application.Admin"]
}
```

Design pilihan:

1. **IdP-owned roles**: roles dikelola di IdP.
2. **App-owned roles**: IdP hanya identity, app DB menentukan roles.
3. **Hybrid**: IdP groups -> app role mapping.
4. **Externalized authorization**: OIDC hanya authn, authorization di PDP/OPA/Keycloak authz/custom policy service.

Risiko IdP-owned roles:

1. Token terlalu besar.
2. Role change tidak langsung efektif sampai token/session refresh.
3. Role semantics tersebar di IdP dan app.
4. Multi-app role collision.

Risiko app-owned roles:

1. Provisioning user perlu sinkronisasi.
2. User disabled di IdP harus tetap diproses.
3. Admin perlu mengelola roles di app.

Production pattern umum:

```text
Use OIDC for authentication.
Use issuer+sub for identity binding.
Use app-owned authorization for domain-critical permissions.
Optionally map trusted IdP groups to app roles at login.
```

---

## 16. Session Creation After OIDC Login

OIDC tidak menghilangkan kebutuhan session lokal untuk web app.

Setelah ID Token valid, aplikasi biasanya membuat session:

```text
ID Token validated -> local principal constructed -> HTTP session / server session created
```

Session lokal menyimpan:

1. Local user ID.
2. External identity reference.
3. Authentication time.
4. Authentication method/strength.
5. Session creation time.
6. Last activity time.
7. Optional access token reference.
8. Optional refresh token reference.

Jangan menyimpan terlalu banyak claims mentah tanpa alasan.

Better:

```text
Session stores local principal summary.
Full tokens stored encrypted/server-side if needed.
Sensitive tokens never exposed to browser JavaScript.
```

Dalam Spring Security:

```text
OidcUser -> Authentication -> SecurityContext -> HttpSession/security context repository
```

Dalam Jakarta Security:

```text
OpenID auth mechanism -> CallerPrincipal/Groups -> SecurityContext/container session
```

---

## 17. ID Token Lifetime vs App Session Lifetime

ID Token punya expiry. App session juga punya expiry. Keduanya tidak harus sama.

Contoh:

```text
ID Token lifetime: 5 minutes
Access Token lifetime: 5 minutes
Refresh Token lifetime: 8 hours
App session idle timeout: 15 minutes
App session absolute timeout: 8 hours
OP SSO session: 10 hours
```

Pertanyaan desain:

1. Apakah app session boleh tetap hidup setelah ID Token expired?
2. Apakah app perlu refresh token?
3. Apakah app butuh re-check ke OP secara periodik?
4. Apakah logout dari OP harus menghentikan app session?
5. Apakah user disabled di OP harus langsung logout dari app?

Jawaban umum:

```text
ID Token membuktikan authentication event saat login.
App session adalah state lokal setelah app menerima event itu.
Expiry ID Token tidak otomatis berarti app session invalid.
Namun high-risk system bisa melakukan revalidation/refresh/session management tambahan.
```

Dalam regulated system, desain harus eksplisit:

```text
Local session timeout policy != token expiry policy != IdP SSO session policy.
```

---

## 18. Refresh Token dalam OIDC Login

Refresh token memungkinkan client mendapatkan token baru tanpa user interactive login.

Untuk web server-side Java app:

- refresh token bisa disimpan server-side,
- harus dilindungi sebagai credential berisiko tinggi,
- sebaiknya pakai refresh token rotation jika provider mendukung,
- jangan dikirim ke browser.

Untuk SPA:

- refresh token di browser sangat sensitif,
- modern BFF pattern sering lebih aman,
- jika refresh token dipakai, harus mengikuti provider/browser security best practices.

Untuk mobile:

- simpan di secure storage/platform keystore,
- pakai PKCE,
- rotation/reuse detection sangat penting.

Failure mode:

```text
Access token short-lived tetapi refresh token bocor.
Attacker bisa terus mint access token baru.
```

Incident response harus punya:

1. Refresh token revocation.
2. Session revocation.
3. Device/session listing.
4. Re-login requirement.
5. Audit token reuse detection.

---

## 19. Logout Is Not One Thing

Logout di OIDC sulit karena ada beberapa session:

```text
Browser session at RP
Server-side session at RP
SSO session at OP
Sessions at other RPs
Access/refresh tokens
```

Jenis logout:

1. **Local logout**: hanya aplikasi lokal.
2. **RP-initiated logout**: aplikasi meminta OP logout user.
3. **Front-channel logout**: OP memberi sinyal logout via browser iframe/front-channel.
4. **Back-channel logout**: OP memberi sinyal logout server-to-server.
5. **Session management polling**: client mengecek status OP session.
6. **Token revocation**: refresh/access token dicabut.

### 19.1 Local Logout

```text
User klik logout.
Aplikasi invalidate local session.
```

Namun OP SSO session bisa masih hidup. Jika user klik login lagi, OP mungkin langsung redirect balik tanpa prompt.

### 19.2 RP-Initiated Logout

RP redirect user ke OP logout endpoint.

Parameter umum:

```text
id_token_hint
post_logout_redirect_uri
state
client_id
```

Tujuan:

```text
RP meminta OP mengakhiri OP session user.
```

### 19.3 Back-Channel Logout

OP mengirim logout token ke RP server.

Kelebihan:

1. Tidak bergantung browser iframe.
2. Lebih cocok untuk server-side apps.
3. Bisa bekerja walau user tidak sedang membuka app.

Tantangan:

1. RP harus expose endpoint logout.
2. RP harus memetakan sid/sub ke session lokal.
3. Harus aman dari spoofed logout.
4. Idempotency diperlukan.

### 19.4 Logout Design Rule

Top 1% engineer tidak mengatakan “logout OIDC sudah beres” tanpa mendefinisikan:

```text
Logout dari mana?
Session mana yang invalid?
Token mana yang dicabut?
Apakah logout semua aplikasi?
Apakah logout semua device?
Apa yang terjadi jika OP logout endpoint gagal?
Apa yang ditulis ke audit log?
```

---

## 20. OIDC in Spring Security

Spring Security menyediakan dukungan OIDC melalui OAuth2 Login.

Konseptual:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/public/**").permitAll()
            .anyRequest().authenticated()
        )
        .oauth2Login(oauth2 -> oauth2
            .userInfoEndpoint(userInfo -> {
                // custom OIDC user service if needed
            })
        )
        .logout(logout -> logout
            .logoutSuccessUrl("/")
        )
        .build();
}
```

Spring mapping simplification:

```text
authorization response -> OAuth2LoginAuthenticationFilter
code exchange -> token endpoint
ID Token validation -> OIDC decoder/validator
UserInfo fetch -> OidcUserService if needed
principal -> OidcUser
Authentication -> OAuth2AuthenticationToken
SecurityContext -> session/repository
```

Yang perlu engineer pahami:

1. `OAuth2User` berbeda dari `OidcUser`.
2. OIDC login butuh `openid` scope.
3. ID Token validation dilakukan framework, tetapi customization harus hati-hati.
4. Authorities mapping perlu eksplisit.
5. ClientRegistration harus benar.
6. Redirect URI harus fix/terkendali.
7. Authorized client storage memengaruhi token access.

Contoh mapping authorities:

```java
@Bean
GrantedAuthoritiesMapper userAuthoritiesMapper() {
    return authorities -> {
        Set<GrantedAuthority> mapped = new HashSet<>();

        for (GrantedAuthority authority : authorities) {
            if (authority instanceof OidcUserAuthority oidc) {
                OidcIdToken idToken = oidc.getIdToken();
                Map<String, Object> claims = idToken.getClaims();

                Object groups = claims.get("groups");
                if (groups instanceof Collection<?> values) {
                    for (Object value : values) {
                        mapped.add(new SimpleGrantedAuthority("GROUP_" + value));
                    }
                }
            }
        }

        return mapped;
    };
}
```

Catatan:

```text
Contoh ini hanya mapping mekanis.
Untuk domain-critical authorization, mapping harus lewat policy yang jelas, bukan langsung percaya semua claim group.
```

---

## 21. OIDC in Jakarta Security

Jakarta Security 4.0 menyediakan built-in OpenID Connect authentication mechanism.

Konseptual:

```java
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "https://idp.example.com/realms/main",
    clientId = "java-enterprise-app",
    clientSecret = "${oidc.client.secret}",
    redirectURI = "${baseURL}/callback",
    scope = {"openid", "profile", "email"}
)
@ApplicationScoped
public class SecurityConfig {
}
```

Mental model:

```text
Jakarta Security mechanism authenticates request.
IdentityStore/OP validates identity.
Container exposes SecurityContext.
Application uses caller principal and groups.
```

Pertanyaan desain di Jakarta EE:

1. Apakah container mendukung OIDC mechanism sesuai versi?
2. Bagaimana secret externalization dilakukan?
3. Bagaimana role/group mapping vendor-specific?
4. Bagaimana session timeout di container?
5. Bagaimana logout endpoint container/app diatur?
6. Bagaimana behavior di GlassFish/Payara/Open Liberty/WildFly berbeda?

Jakarta standard memberi portability, tetapi production behavior tetap harus dites pada runtime target.

---

## 22. BFF Pattern for OIDC

Untuk SPA modern, pattern yang sering lebih aman adalah Backend-for-Frontend.

```text
Browser SPA <-> BFF Java backend <-> OpenID Provider
                     |
                     +-> API/resource servers
```

Dalam BFF:

1. Browser tidak menyimpan access token sensitif di JavaScript.
2. Java backend melakukan OIDC code flow.
3. Java backend membuat HttpOnly Secure SameSite cookie session.
4. Java backend menyimpan token server-side jika perlu.
5. SPA memanggil BFF dengan cookie session.
6. BFF melakukan token relay/token exchange ke downstream API.

Keuntungan:

1. Mengurangi token exposure di browser.
2. Session bisa dikontrol server-side.
3. CSRF bisa dikelola dengan cookie strategy.
4. Downstream token bisa disembunyikan.
5. Refresh token lebih aman di server.

Trade-off:

1. BFF menjadi stateful.
2. Perlu session scaling.
3. Perlu CSRF protection.
4. Perlu CORS/cookie domain design.
5. Perlu logout lebih kompleks.

---

## 23. Multi-Application SSO

OIDC sering dipakai untuk SSO antar aplikasi.

Flow:

```text
User login ke App A via OP.
OP membuat SSO session.
User buka App B.
App B redirect ke OP.
OP melihat SSO session aktif.
OP mengembalikan code tanpa user memasukkan password lagi.
App B membuat session lokal.
```

Penting:

```text
SSO session OP tidak sama dengan session App A atau App B.
```

Akibat:

1. Logout App A belum tentu logout App B.
2. Logout App A belum tentu logout OP.
3. Session timeout App A dan App B bisa berbeda.
4. User disabled di OP belum tentu langsung mematikan session semua RP kecuali ada back-channel/logout/revalidation.
5. Audit login App B tetap terjadi walau user tidak mengetik password lagi.

Authentication event di App B mungkin:

```text
OP SSO session reused.
ID Token auth_time menunjukkan waktu user authenticate awal.
```

Jika App B membutuhkan fresh authentication, gunakan:

```text
prompt=login
max_age=...
acr_values=...
```

---

## 24. Fresh Login, Step-Up, and Reauthentication

High-risk operation membutuhkan authentication lebih kuat atau lebih baru.

Contoh:

```text
- approve enforcement action,
- submit legal decision,
- change payout account,
- export sensitive data,
- add privileged user,
- rotate API key,
- view restricted case file.
```

OIDC tools:

| Tool | Fungsi |
|---|---|
| `max_age` | minta authentication tidak lebih tua dari durasi tertentu |
| `prompt=login` | paksa user login ulang |
| `acr_values` | minta authentication context tertentu |
| `auth_time` | RP memvalidasi kapan auth terjadi |
| `acr`/`amr` | RP mengevaluasi strength/method |

Pattern:

```text
1. User sudah login normal.
2. User masuk high-risk action.
3. App cek auth_time/acr/amr di session.
4. Jika tidak cukup, redirect ke OP dengan max_age/acr_values.
5. OP melakukan reauthentication/MFA.
6. App menerima ID Token baru.
7. App update session authentication strength.
8. High-risk action dilanjutkan.
```

Jangan hanya mengandalkan role admin untuk high-risk operation. Admin juga bisa terkena session theft.

---

## 25. Multi-Tenant OIDC

Multi-tenant OIDC lebih sulit daripada single issuer.

Model umum:

### 25.1 Issuer per Tenant

```text
tenant-a -> https://idp.example.com/realms/tenant-a
tenant-b -> https://idp.example.com/realms/tenant-b
```

Pro:

1. Boundary jelas.
2. Tenant config terpisah.
3. JWKS/claims/roles bisa tenant-specific.

Kontra:

1. Client config banyak.
2. Routing login lebih kompleks.
3. Callback handling perlu tenant context.

### 25.2 Shared Issuer, Tenant Claim

```text
iss = https://idp.example.com/realms/main
tenant_id = agency-a
```

Pro:

1. Config lebih sederhana.
2. SSO antar tenant lebih mudah jika memang diinginkan.

Kontra:

1. Tenant isolation bergantung claim/policy.
2. Token confusion lebih berbahaya.
3. Authorization harus tenant-aware.

### 25.3 Bring Your Own IdP

Setiap tenant membawa IdP sendiri.

```text
tenant-a -> Entra ID
tenant-b -> Okta
tenant-c -> Keycloak
```

Tantangan:

1. Dynamic issuer onboarding.
2. Discovery allowlist.
3. Claim normalization.
4. User provisioning.
5. Logout differences.
6. Support/debug complexity.
7. Security review per tenant.

Rule kritis:

```text
Tenant resolution must happen before token trust.
Token trust must be bound to tenant configuration.
Never validate token against arbitrary issuer chosen by token itself.
```

---

## 26. Token Substitution and Mix-Up Attacks

OIDC systems bisa gagal karena token/response dari konteks lain diterima.

### 26.1 Token Substitution

```text
Attacker obtains valid ID Token for Client A.
Attacker sends it to Client B.
Client B does not validate aud.
Client B logs attacker/victim incorrectly.
```

Defense:

```text
Validate audience.
Validate issuer.
Validate nonce.
Validate authorized party if needed.
```

### 26.2 Issuer Mix-Up

```text
RP supports multiple OPs.
Attacker manipulates flow so RP sends code to wrong token endpoint
or validates response under wrong issuer context.
```

Defense:

```text
Bind authorization request state to selected issuer/provider.
Callback must recover provider from trusted state, not from attacker input.
Validate iss where supported.
Separate redirect URIs per provider if useful.
```

### 26.3 Malicious Discovery Endpoint

```text
RP accepts arbitrary issuer URL.
Discovery points endpoints to attacker/internal network.
RP fetches or sends secrets to malicious endpoint.
```

Defense:

```text
Allowlist issuer.
Validate scheme/host.
No internal IP ranges.
No user-controlled discovery in normal login.
Manual admin approval for BYOIDC.
```

---

## 27. OIDC and Resource Server: Do Not Confuse Login with API Protection

A Java application can be:

1. OIDC Client / Relying Party.
2. OAuth2 Resource Server.
3. Authorization Server.
4. Combination of the above.

Different responsibilities:

```text
OIDC Client validates ID Token to login user.
Resource Server validates access token to protect API.
Authorization Server issues tokens.
```

Spring example:

```java
http
  .oauth2Login(withDefaults())      // app login as OIDC RP
  .oauth2ResourceServer(oauth2 ->   // API token validation
      oauth2.jwt(withDefaults())
  );
```

This is valid, but the mental model must stay clear.

Common bug:

```text
API endpoint accepts ID Token as bearer token.
```

Why bad:

1. ID Token audience is client, not API.
2. ID Token may include identity claims but not API scopes.
3. Resource server authorization becomes confused.
4. Token leak blast radius changes.

Better:

```text
Browser login uses ID Token.
API call uses access token or app session to BFF.
Resource server validates access token audience/scope.
```

---

## 28. Token Relay and Token Exchange

In microservices, after OIDC login, downstream services may need identity.

Bad simple pattern:

```text
Frontend sends user access token to Service A.
Service A forwards same token to Service B, C, D.
All services accept same audience token.
```

Risks:

1. Audience too broad.
2. Downstream service impersonation.
3. Excessive privilege.
4. Audit ambiguity.
5. Token theft in any service compromises all.

Better options:

### 28.1 BFF Performs Calls

```text
Browser -> BFF session
BFF -> API with server-side token
```

### 28.2 Token Exchange

```text
Service A exchanges incoming token for token targeted to Service B.
```

### 28.3 On-Behalf-Of Pattern

```text
Service acts on behalf of user with explicit delegated token.
```

### 28.4 Internal Service Identity + User Context

```text
mTLS/service identity authenticates service.
Signed/user context header or token carries end-user context.
```

Rule:

```text
Do not blindly relay tokens across boundaries without audience and delegation model.
```

---

## 29. Java Version Considerations: Java 8 to Java 25

OIDC is protocol-level, so Java version matters mainly for libraries, TLS, crypto, runtime behavior, and framework compatibility.

### 29.1 Java 8

Reality:

1. Banyak legacy enterprise app masih Java 8.
2. Spring Security versi lama masih umum.
3. TLS/JCA provider constraints mungkin muncul.
4. Keystore sering JKS legacy.
5. Jakarta namespace belum dominan; Java EE `javax` masih banyak.

Risiko:

```text
Old dependency stack may have outdated JWT/OAuth validation behavior.
```

### 29.2 Java 11/17

1. LTS modern baseline.
2. Better TLS defaults dibanding Java 8 lama.
3. Spring Boot 2.x/3.x transition.
4. Jakarta namespace transition for Boot 3/Jakarta EE 10+.

### 29.3 Java 21

1. Common modern production LTS.
2. Virtual threads available.
3. Context propagation needs attention.
4. Spring Boot 3.x widely used.

### 29.4 Java 25

1. Latest platform referenced in this series.
2. Modern APIs around cryptographic material continue improving.
3. Virtual threads/structured concurrency/scoped values increasingly relevant for context design.
4. Library compatibility must be verified.

Rule:

```text
OIDC correctness depends more on protocol validation and library behavior than on Java language syntax.
But runtime version affects TLS, crypto, threading, and framework choices.
```

---

## 30. Production Configuration Checklist

OIDC client configuration should be reviewed like production security config.

Minimum checklist:

```text
[ ] issuer-uri configured exactly and allowlisted
[ ] client_id correct per environment
[ ] client_secret/private key stored outside source code
[ ] redirect_uri exact, no wildcard unless strictly controlled
[ ] authorization code flow used
[ ] PKCE enabled where supported/required
[ ] response_type code only for server-side web app
[ ] openid scope included
[ ] additional scopes minimal
[ ] ID Token signature validation enabled
[ ] issuer validation enabled
[ ] audience validation enabled
[ ] nonce validation enabled
[ ] clock skew small and explicit
[ ] JWKS cache configured
[ ] unknown kid refresh behavior understood
[ ] UserInfo sub matching enforced
[ ] roles/groups mapping explicit
[ ] local identity key uses issuer+sub
[ ] session timeout policy defined
[ ] logout behavior defined
[ ] refresh token storage protected
[ ] token logs redacted
[ ] audit events emitted
[ ] multi-tenant issuer binding tested
[ ] failure behavior fail-closed
```

---

## 31. Common Misconfigurations

### 31.1 Accepting Any Issuer

```text
Problem: app trusts token based only on signature or dynamic discovery.
Impact: malicious/foreign issuer login.
Fix: issuer allowlist and per-tenant binding.
```

### 31.2 Skipping Audience Validation

```text
Problem: ID Token for another client accepted.
Impact: token substitution.
Fix: aud must include this client_id.
```

### 31.3 Using Email as User ID

```text
Problem: local account keyed by email.
Impact: account takeover or broken account continuity.
Fix: issuer+sub as external identity key.
```

### 31.4 Trusting Unverified Email

```text
Problem: auto-provision/link by email without email_verified.
Impact: account takeover.
Fix: require verified email and trusted provider policy.
```

### 31.5 Confusing ID Token and Access Token

```text
Problem: API accepts ID Token as bearer credential.
Impact: incorrect authorization and audience confusion.
Fix: resource servers accept access tokens with correct aud/scope.
```

### 31.6 Overloading Token Claims

```text
Problem: huge roles/groups in token.
Impact: large headers, stale authorization, performance issues.
Fix: app-owned authorization or scoped claims.
```

### 31.7 Logging Tokens

```text
Problem: ID/access/refresh tokens appear in logs.
Impact: credential leakage.
Fix: redaction at ingress, app logs, error logs, tracing.
```

### 31.8 Wildcard Redirect URI

```text
Problem: broad redirect URI patterns.
Impact: authorization code theft/open redirect chain.
Fix: exact redirect URIs per environment/client.
```

### 31.9 Broken Logout Expectations

```text
Problem: user thinks logout from one app logs out all apps.
Impact: lingering sessions.
Fix: explicit local/OP/back-channel/token logout design.
```

### 31.10 Not Handling Key Rotation

```text
Problem: JWKS cached forever or not refreshed on unknown kid.
Impact: login outage during key rotation.
Fix: TTL cache and controlled refresh.
```

---

## 32. Failure Mode Modeling

### 32.1 IdP Down During Login

Symptoms:

```text
/login redirect fails
metadata endpoint unavailable
token endpoint timeout
JWKS endpoint timeout
```

Design options:

1. Fail login closed.
2. Existing local sessions continue until timeout.
3. Cached JWKS continues validating already issued tokens.
4. Admin break-glass path if required.
5. Clear status page/error message.

Do not:

```text
Bypass authentication because IdP is down.
```

### 32.2 IdP Down During Existing Session

If app uses local session:

```text
Existing session can continue based on local session policy.
```

If app introspects/revalidates every request:

```text
IdP outage may break all traffic.
```

Decision must be explicit.

### 32.3 JWKS Rotation Mismatch

Scenario:

```text
OP starts signing with new kid.
RP cache does not have new key.
All logins fail.
```

Mitigation:

1. Refresh JWKS on unknown kid once.
2. Respect cache headers reasonably.
3. Alert on repeated unknown kid.
4. Monitor validation failures by issuer/kid.

### 32.4 Clock Skew

Scenario:

```text
Token issued at OP appears not yet valid or expired at RP.
```

Mitigation:

1. NTP/clock sync.
2. Small allowed skew.
3. Metrics for time validation failures.

### 32.5 User Disabled at IdP

Question:

```text
Should existing local app sessions terminate immediately?
```

Options:

1. Wait until local session expires.
2. Use back-channel logout/eventing.
3. Poll/revalidate for high-risk actions.
4. Short session lifetime.
5. Central session management.

Regulated systems usually need a stronger answer than “eventually”.

### 32.6 Group/Role Changed at IdP

Question:

```text
When does role change take effect?
```

Options:

1. Next login.
2. Next token refresh.
3. Next request via app DB lookup.
4. Event-driven sync.
5. Manual session revocation.

---

## 33. Observability and Audit

Authentication needs auditability.

Login audit event should include:

```json
{
  "event_type": "OIDC_LOGIN_SUCCESS",
  "timestamp": "2026-06-19T12:00:00Z",
  "correlation_id": "...",
  "session_id_hash": "...",
  "issuer": "https://idp.example.com/realms/main",
  "subject_hash": "...",
  "local_user_id": "12345",
  "client_id": "aceas-web",
  "acr": "urn:mfa:loa2",
  "amr": ["pwd", "otp"],
  "auth_time": "2026-06-19T11:58:00Z",
  "ip_hash_or_prefix": "...",
  "user_agent_hash": "...",
  "result": "SUCCESS"
}
```

Failed login callback event:

```json
{
  "event_type": "OIDC_CALLBACK_FAILURE",
  "reason": "STATE_MISMATCH",
  "issuer_context": "expected-provider-key",
  "correlation_id": "..."
}
```

Do not log:

1. Raw ID Token.
2. Raw access token.
3. Raw refresh token.
4. Authorization code.
5. Client secret.
6. Full PII unless justified.

Useful metrics:

```text
login_success_total by issuer/client
token_exchange_failure_total by reason
id_token_validation_failure_total by reason
jwks_refresh_total by issuer
unknown_kid_total by issuer/kid
userinfo_failure_total by issuer
logout_success_total
logout_failure_total
state_mismatch_total
nonce_mismatch_total
```

---

## 34. Security Review Questions

Gunakan pertanyaan ini saat review desain OIDC:

1. Apakah app ini RP, resource server, authorization server, atau kombinasi?
2. Apakah login memakai OIDC, bukan OAuth2 access token biasa?
3. Apakah `openid` scope digunakan?
4. Apakah flow authorization code dipakai?
5. Apakah PKCE aktif?
6. Apakah issuer allowlisted?
7. Apakah client_id environment-specific?
8. Apakah redirect URI exact?
9. Apakah state disimpan dan divalidasi?
10. Apakah nonce disimpan dan divalidasi?
11. Apakah ID Token signature divalidasi?
12. Apakah algorithm di-whitelist?
13. Apakah audience divalidasi?
14. Apakah issuer divalidasi?
15. Apakah `azp` dicek jika relevan?
16. Apakah `iss+sub` menjadi identity key?
17. Apakah email hanya dipakai jika verified dan sesuai policy?
18. Apakah UserInfo `sub` dicocokkan dengan ID Token `sub`?
19. Apakah role/group mapping eksplisit?
20. Apakah token tidak masuk log?
21. Apakah session timeout didefinisikan?
22. Apakah OP logout/local logout/back-channel logout didefinisikan?
23. Apakah refresh token disimpan aman?
24. Apakah JWKS rotation diuji?
25. Apakah multi-tenant issuer binding diuji?
26. Apakah behavior saat IdP down didefinisikan?
27. Apakah user disabled/role changed punya propagation policy?
28. Apakah high-risk action membutuhkan fresh auth/step-up?
29. Apakah audit cukup untuk forensic reconstruction?
30. Apakah incident response untuk token leak ada?

---

## 35. Implementation Sketch: Manual ID Token Validation Pipeline

Biasanya gunakan library/framework, tetapi memahami pipeline manual penting.

Pseudocode:

```java
public AuthenticatedIdentity validateOidcLogin(
        String idTokenValue,
        ExpectedOidcContext expected
) {
    JwtHeader header = parseHeaderWithoutTrust(idTokenValue);

    if (!allowedAlgorithms.contains(header.alg())) {
        throw new AuthenticationException("Unsupported alg");
    }

    Jwk key = jwksCache.findKey(expected.issuer(), header.kid())
            .orElseGet(() -> jwksCache.refreshAndFind(expected.issuer(), header.kid())
                    .orElseThrow(() -> new AuthenticationException("Unknown kid")));

    JwtClaims claims = verifySignatureAndParseClaims(idTokenValue, key, header.alg());

    requireEquals(expected.issuer(), claims.issuer(), "iss");
    requireAudienceContains(claims.audience(), expected.clientId());
    requireNotExpired(claims.expiresAt(), clock, allowedSkew);
    requireNotBeforeValid(claims.notBefore(), clock, allowedSkew);
    requireIssuedAtReasonable(claims.issuedAt(), clock, allowedSkew);

    if (expected.nonceRequired()) {
        requireEquals(expected.nonce(), claims.nonce(), "nonce");
    }

    if (claims.authorizedParty() != null) {
        requireEquals(expected.clientId(), claims.authorizedParty(), "azp");
    }

    ExternalIdentityKey key = new ExternalIdentityKey(
            claims.issuer(),
            claims.subject()
    );

    return new AuthenticatedIdentity(
            key,
            claims.authenticationTime(),
            claims.authenticationContextClassReference(),
            claims.authenticationMethodsReferences(),
            claims.claims()
    );
}
```

Mental model:

```text
Parsing is not validation.
Decoding is not validation.
Signature verification is not full validation.
Full validation requires signature + issuer + audience + time + nonce + context checks.
```

---

## 36. Implementation Sketch: Local Account Resolution

Pseudocode:

```java
public LocalUser resolveLocalUser(AuthenticatedIdentity identity) {
    ExternalIdentityKey externalKey = identity.externalIdentityKey();

    Optional<ExternalIdentity> linked = externalIdentityRepository.findByIssuerAndSubject(
            externalKey.issuer(),
            externalKey.subject()
    );

    if (linked.isPresent()) {
        LocalUser user = userRepository.getById(linked.get().localUserId());

        if (!user.isActive()) {
            throw new AuthenticationException("Local user inactive");
        }

        externalIdentityRepository.updateLastLogin(linked.get().id(), Instant.now());
        return user;
    }

    ProvisioningDecision decision = provisioningPolicy.evaluate(identity);

    return switch (decision.type()) {
        case AUTO_CREATE -> createUserAndLink(identity, decision);
        case REQUIRE_INVITATION -> throw new AuthenticationException("No invitation");
        case REQUIRE_ADMIN_APPROVAL -> throw new AuthenticationException("Approval required");
        case DENY -> throw new AuthenticationException("Provisioning denied");
    };
}
```

Important:

```text
Provisioning policy is part of authentication architecture.
It is not merely user creation boilerplate.
```

---

## 37. Implementation Sketch: Step-Up Authentication

```java
public void requireFreshStrongAuthentication(AppSession session, RiskAction action) {
    Instant now = clock.instant();

    boolean freshEnough = session.authenticatedAt()
            .isAfter(now.minus(action.maxAuthenticationAge()));

    boolean strongEnough = action.acceptedAcrValues()
            .contains(session.acr());

    boolean methodEnough = session.amr().containsAll(action.requiredAmrValues());

    if (freshEnough && strongEnough && methodEnough) {
        return;
    }

    throw new StepUpRequiredException(
            OidcAuthorizationRequest.stepUp()
                    .maxAge(action.maxAuthenticationAge())
                    .acrValues(action.acceptedAcrValues())
                    .returnTo(action.resumeUrl())
    );
}
```

Design:

```text
Do not encode high-risk authentication requirements inside random controller methods.
Make them explicit policy objects.
```

---

## 38. Environment Separation

OIDC config must be separated per environment.

Bad:

```text
DEV/UAT/PROD share same client_id and redirect URI patterns.
```

Better:

```text
DEV issuer/client separate from UAT/PROD.
PROD client secret/key never available in lower environments.
Redirect URIs exact per environment.
JWKS/issuer config pinned per environment.
```

Checklist:

```text
[ ] different client_id per environment
[ ] different client_secret/private key per environment
[ ] exact redirect URI per environment
[ ] no localhost redirect in production client
[ ] no wildcard domain in production client unless provider-controlled and justified
[ ] lower env tokens not accepted by prod
[ ] prod tokens not accepted by lower env unless explicit secure testing design
```

---

## 39. OIDC for Regulatory/Case Management Systems

Untuk regulatory enforcement/case management system, OIDC design harus mendukung audit dan defensibility.

Kebutuhan khas:

1. User identity harus stabil dan traceable.
2. Role/authority harus bisa dibuktikan pada waktu aksi.
3. High-risk action perlu fresh/strong authentication.
4. Login/logout/session event perlu audit.
5. External IdP dependency perlu failure plan.
6. Account linking harus defensible.
7. User disabled/transfer/resignation harus cepat tercermin.
8. Session hijacking harus dibatasi.
9. Admin impersonation harus sangat dikontrol.
10. Cross-agency/tenant identity harus tidak bocor.

Recommended baseline:

```text
OIDC Authorization Code + PKCE
Server-side session / BFF for browser apps
issuer+sub as immutable external identity key
app-owned domain authorization
explicit group-to-role mapping if needed
fresh auth for high-risk actions
central audit event model
back-channel logout or session revocation for critical user disable events
strict token redaction
JWKS rotation monitoring
```

---

## 40. Anti-Patterns

### Anti-Pattern 1 — “OAuth Login” Without ID Token

```text
App uses access token to call /me and creates session.
```

Problem:

```text
This is not necessarily OIDC authentication.
```

Fix:

```text
Use OIDC with openid scope and validate ID Token.
```

### Anti-Pattern 2 — “JWT Decoded Means Authenticated”

```text
Base64 decode JWT and read email.
```

Fix:

```text
Verify signature and validate claims.
```

### Anti-Pattern 3 — “All Claims Become Authorities”

```text
Every group claim becomes ROLE_*.
```

Fix:

```text
Map trusted groups through explicit authorization policy.
```

### Anti-Pattern 4 — “Logout Redirect Only”

```text
App redirects to OP logout but does not invalidate local session.
```

Fix:

```text
Invalidate local session first, then RP-initiated OP logout if desired.
```

### Anti-Pattern 5 — “Dynamic Issuer from Request Parameter”

```text
/login?issuer=https://anything
```

Fix:

```text
Issuer chosen from trusted tenant/provider registry.
```

### Anti-Pattern 6 — “Refresh Token in Browser LocalStorage”

Fix:

```text
Prefer BFF/server-side token storage for browser apps.
```

### Anti-Pattern 7 — “One Access Token for All Services”

Fix:

```text
Use audience-specific token, token exchange, or service identity model.
```

---

## 41. Practical Design Matrix

| Scenario | Recommended OIDC Pattern | Notes |
|---|---|---|
| Server-rendered Java web app | Authorization Code + server session | Straightforward RP model |
| Spring Boot SPA backend/BFF | Authorization Code + PKCE + HttpOnly cookie session | Avoid browser token exposure |
| Pure SPA | Authorization Code + PKCE | Needs strong browser token strategy; BFF often better |
| Mobile app | Authorization Code + PKCE using system browser | Secure storage for refresh token |
| Internal enterprise app | OIDC SSO + app-owned roles | Integrate with directory/IdP groups carefully |
| Multi-tenant SaaS | Per-tenant issuer config or trusted BYOIDC registry | Strict issuer binding |
| High-risk admin app | OIDC + MFA + step-up + short session | Use `auth_time`, `acr`, `amr` |
| API backend | OAuth2 resource server, not OIDC login | Validate access token audience/scope |
| Microservices | Token exchange/service identity | Avoid blind token relay |
| Legacy Java 8 app | OIDC gateway or Spring Security integration | Migration may require adapter/BFF |

---

## 42. Deep Mental Models

### 42.1 Authentication Is an Event; Session Is a Consequence

OIDC tells the application:

```text
An authentication event happened at the OP.
Here is a signed assertion about it.
```

The app then decides:

```text
Do I create a local session?
Which local user?
With what privileges?
For how long?
Under what risk constraints?
```

### 42.2 Tokens Are Not Identity; Claims Are Statements

A token is a carrier. Claims are statements. The issuer is the authority. Validation establishes whether the statements can be trusted in this context.

```text
Token -> Claims -> Validated Claims -> External Identity -> Local Principal -> Domain Authorization
```

### 42.3 Federation Moves Risk, It Does Not Remove Risk

Using OIDC means delegating authentication to OP.

You reduce:

1. Password handling burden.
2. MFA implementation burden.
3. Central identity lifecycle burden.

You add:

1. Dependency on OP availability.
2. Protocol validation risk.
3. Account linking risk.
4. Claim mapping risk.
5. Logout/session complexity.
6. Multi-tenant trust complexity.

### 42.4 Correctness Is Mostly in Boundaries

Most OIDC bugs happen at boundaries:

1. Browser callback boundary.
2. Issuer trust boundary.
3. Token audience boundary.
4. Local account linking boundary.
5. Session creation boundary.
6. Role mapping boundary.
7. Logout boundary.
8. Downstream API boundary.

---

## 43. Java Engineer's OIDC Review Heuristics

When reading a Java codebase, inspect:

1. Security filter chain.
2. Client registration config.
3. Redirect URI config.
4. Issuer URI config.
5. OIDC scopes.
6. Custom `OAuth2UserService` / `OidcUserService`.
7. Authorities mapper.
8. Session management config.
9. Logout handlers.
10. Authorized client service/repository.
11. Token persistence.
12. Logging filters.
13. Exception handling.
14. Multi-tenant resolver.
15. User provisioning code.
16. Role mapping code.
17. Audit event code.
18. Tests for invalid issuer/audience/nonce/state.

Bad smell examples:

```text
claims.get("email") used as primary key
JwtDecoder created with arbitrary jwkSetUri from request
OAuth2User used but no openid scope
ID Token manually parsed with Base64 decoder
redirectUriTemplate contains broad wildcard behavior
refresh_token printed in debug log
SecurityContext manually copied to async executor without cleanup
```

---

## 44. Testing Strategy for OIDC

Test cases:

### 44.1 Happy Path

```text
valid state
valid nonce
valid code exchange
valid ID Token
user provisioned/linked
session created
```

### 44.2 Callback Attacks

```text
missing state
wrong state
reused state
code for wrong provider
redirect URI mismatch
```

### 44.3 ID Token Validation

```text
invalid signature
wrong issuer
wrong audience
expired token
future nbf
too-old iat
nonce mismatch
unknown kid
unsupported alg
```

### 44.4 Claims/UserInfo

```text
UserInfo sub mismatch
email not verified
groups missing
groups too large
claim type unexpected
```

### 44.5 Account Linking

```text
existing external identity
new external identity allowed
new external identity denied
email collision
inactive local user
user disabled
```

### 44.6 Logout

```text
local logout invalidates session
RP-initiated logout redirects correctly
back-channel logout invalidates session
logout token replay idempotent
OP logout failure handled
```

### 44.7 Operational

```text
JWKS key rotation
IdP token endpoint timeout
discovery endpoint unavailable
UserInfo endpoint slow
clock skew
```

Testing tools/patterns:

1. WireMock for discovery/JWKS/token/UserInfo endpoints.
2. Testcontainers Keycloak for integration tests.
3. Spring Security test support for mock OIDC login.
4. Contract tests for provider-specific claims.
5. Negative tests for all validation failures.

---

## 45. Minimal Glossary

| Term | Meaning |
|---|---|
| OP | OpenID Provider; IdP/authorization server supporting OIDC |
| RP | Relying Party; application trusting OP authentication |
| ID Token | JWT authentication assertion for RP |
| Access Token | Token for resource server access |
| UserInfo | Endpoint returning user claims |
| Discovery | Metadata endpoint for OP configuration |
| JWKS | JSON Web Key Set for signature validation |
| `iss` | Issuer |
| `sub` | Subject identifier |
| `aud` | Audience |
| `azp` | Authorized party |
| `nonce` | Replay/substitution binding value |
| `auth_time` | Time of user authentication |
| `acr` | Authentication context class reference |
| `amr` | Authentication methods references |
| RP-initiated logout | RP asks OP to logout end-user |
| Back-channel logout | OP notifies RP server-to-server |

---

## 46. Summary

OIDC adalah authentication layer di atas OAuth2. OAuth2 memberi delegated access; OIDC memberi standardized way untuk relying party memverifikasi authentication event end-user.

Core understanding:

```text
ID Token is for the client/RP.
Access Token is for the resource server.
Refresh Token is for the client to obtain new tokens.
Session is local application state created after trust is established.
```

Validation minimum:

```text
signature
issuer
audience
expiry/time
nonce
algorithm
key source
```

Identity binding:

```text
Use issuer + subject.
Do not use email as primary identity key.
```

Production OIDC architecture must define:

1. Login flow.
2. Session lifecycle.
3. Token storage.
4. Claim mapping.
5. Account linking.
6. Role/group mapping.
7. Logout semantics.
8. Multi-tenant issuer binding.
9. Failure behavior.
10. Audit/forensics.

A top-tier Java engineer does not treat OIDC as magic SSO. They model it as a distributed trust protocol with explicit boundaries, assertions, validation rules, local state transitions, and operational failure modes.

---

## 47. Sumber Resmi dan Rujukan Lanjutan

- OpenID Connect Core 1.0, OpenID Foundation.
- OpenID Connect Discovery 1.0, OpenID Foundation.
- OpenID Connect RP-Initiated Logout 1.0, OpenID Foundation.
- OpenID Connect Back-Channel Logout 1.0, OpenID Foundation.
- OAuth 2.0 Authorization Framework, RFC 6749.
- OAuth 2.0 Security Best Current Practice, RFC 9700.
- JSON Web Token, RFC 7519.
- JSON Web Token Best Current Practices, RFC 8725.
- Spring Security Reference: OAuth2 Login and OpenID Connect.
- Spring Security Reference: OAuth2 Resource Server.
- Jakarta Security 4.0 Specification: OpenID Connect Authentication Mechanism.
- OWASP Authentication Cheat Sheet.
- OWASP Session Management Cheat Sheet.
- OWASP JSON Web Token for Java Cheat Sheet.

---

## 48. Latihan Desain

### Latihan 1 — Enterprise Web App

Desain OIDC login untuk aplikasi Java internal dengan 5.000 user, role admin/officer/viewer, session idle 15 menit, absolute 8 jam, dan requirement MFA untuk admin.

Jawab:

1. Flow apa yang dipakai?
2. Di mana token disimpan?
3. Bagaimana mapping groups ke roles?
4. Bagaimana high-risk admin action meminta step-up?
5. Bagaimana user disabled dipropagasi?
6. Apa audit event yang dibuat?

### Latihan 2 — SPA + API

Aplikasi Vue SPA memanggil Java API. Pilih antara pure SPA OIDC dan BFF.

Bandingkan:

1. Token exposure.
2. Refresh token handling.
3. CSRF/CORS.
4. Session scaling.
5. Logout.
6. Complexity.

### Latihan 3 — Multi-Tenant BYOIDC

Setiap tenant boleh membawa IdP sendiri.

Desain:

1. Tenant discovery.
2. Issuer allowlist.
3. Claim normalization.
4. Account linking.
5. JWKS caching.
6. Failure handling.
7. Security review onboarding.

### Latihan 4 — Token Confusion Bug Hunt

Cari bug dalam desain berikut:

```text
API menerima Bearer token.
Jika JWT valid signature dan ada email, API menganggap user authenticated.
API tidak cek aud.
API menerima token dari semua issuer yang JWKS-nya bisa di-fetch.
Role diambil dari claim groups langsung.
```

Jelaskan minimal 8 masalah dan perbaikannya.

---

## 49. Kapan Materi Ini Dipakai di Dunia Nyata

Anda akan memakai mental model Part 14 ketika:

1. Mengintegrasikan Spring Boot dengan Keycloak/Okta/Entra/Auth0.
2. Membangun SSO antar aplikasi enterprise.
3. Mendesain login SPA + backend.
4. Memindahkan legacy form login ke IdP modern.
5. Menganalisis bug “user login sebagai orang lain”.
6. Menentukan apakah token boleh diteruskan ke downstream service.
7. Membuat session/logout policy.
8. Menangani IdP outage.
9. Melakukan audit atas privileged user action.
10. Mendesain multi-tenant identity federation.

---

## 50. Penutup Part 14

Part ini menyelesaikan fondasi OIDC sebagai authentication protocol modern untuk Java systems. Kita sudah membedakan OAuth2 dan OIDC, memahami ID Token, claims, discovery, JWKS, UserInfo, account linking, session, logout, multi-tenant trust, token substitution, dan production failure modes.

Setelah ini, kita akan masuk ke Part 15:

```text
Part 15 — Authorization Code + PKCE for Java Web and SPA Backends
```

Part 15 akan memperdalam satu flow paling penting dalam praktik modern: bagaimana authorization code + PKCE bekerja, bagaimana backend Java/BFF mengamankannya, bagaimana redirect/callback/state/code_verifier disimpan, dan bagaimana flow ini gagal jika desain browser/backend boundary salah.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-013.md">⬅️ Part 13 — OAuth 2.0 for Java Engineers: Delegated Authorization as Authentication Input</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-015.md">Part 15 — Authorization Code + PKCE for Java Web and SPA Backends ➡️</a>
</div>
