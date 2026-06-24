# learn-go-authentication-authorization-identity-permission-part-002.md

# Part 002 — Threat Model untuk Auth System di Go

> Series: `learn-go-authentication-authorization-identity-permission`  
> Target: Go 1.26.x  
> Level: advanced / internal engineering handbook  
> Fokus: authentication, authorization, identity, permission, session, token, federation, service identity, dan failure modelling  
> Status seri: **belum selesai**

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Kenapa Threat Model Auth Berbeda dari Security Checklist Biasa](#2-kenapa-threat-model-auth-berbeda-dari-security-checklist-biasa)
3. [Mental Model: Auth System sebagai Security Control Plane](#3-mental-model-auth-system-sebagai-security-control-plane)
4. [Aset yang Harus Dilindungi](#4-aset-yang-harus-dilindungi)
5. [Actor dan Attacker Model](#5-actor-dan-attacker-model)
6. [Data Flow dan Trust Boundary](#6-data-flow-dan-trust-boundary)
7. [STRIDE untuk Auth System](#7-stride-untuk-auth-system)
8. [Threat Taxonomy untuk Authentication](#8-threat-taxonomy-untuk-authentication)
9. [Threat Taxonomy untuk Session dan Token](#9-threat-taxonomy-untuk-session-dan-token)
10. [Threat Taxonomy untuk OAuth2 dan OIDC](#10-threat-taxonomy-untuk-oauth2-dan-oidc)
11. [Threat Taxonomy untuk Authorization dan Permission](#11-threat-taxonomy-untuk-authorization-dan-permission)
12. [Threat Taxonomy untuk Federation dan External Identity](#12-threat-taxonomy-untuk-federation-dan-external-identity)
13. [Threat Taxonomy untuk Service-to-Service Identity](#13-threat-taxonomy-untuk-service-to-service-identity)
14. [Threat Taxonomy untuk Admin, Delegation, dan Break-Glass](#14-threat-taxonomy-untuk-admin-delegation-dan-break-glass)
15. [Threat Taxonomy untuk Operational Auth](#15-threat-taxonomy-untuk-operational-auth)
16. [Attack Tree: Dari Internet Request ke Privilege Escalation](#16-attack-tree-dari-internet-request-ke-privilege-escalation)
17. [Risk Rating yang Berguna untuk Engineer](#17-risk-rating-yang-berguna-untuk-engineer)
18. [Mapping Threat ke Go Design](#18-mapping-threat-ke-go-design)
19. [Go Implementation Skeleton: Threat-Aware Auth Boundary](#19-go-implementation-skeleton-threat-aware-auth-boundary)
20. [Checklist Design Review](#20-checklist-design-review)
21. [Failure Modes yang Sering Diremehkan](#21-failure-modes-yang-sering-diremehkan)
22. [Case Study: Multi-Tenant Regulatory Case Management](#22-case-study-multi-tenant-regulatory-case-management)
23. [Latihan](#23-latihan)
24. [Ringkasan](#24-ringkasan)
25. [Referensi Primer](#25-referensi-primer)

---

## 1. Tujuan Part Ini

Part ini membahas **threat model khusus untuk auth system**.

Yang dimaksud auth system di seri ini bukan hanya halaman login. Auth system adalah gabungan dari:

- identity store,
- credential lifecycle,
- login flow,
- MFA/passkey flow,
- session lifecycle,
- OAuth2/OIDC integration,
- token issuance dan validation,
- permission model,
- policy decision,
- federation,
- service identity,
- admin delegation,
- audit trail,
- recovery dan incident response.

Tujuan part ini adalah membuat kamu mampu menjawab pertanyaan desain seperti:

1. **Apa aset paling berharga dalam auth system?**
2. **Siapa attacker-nya?**
3. **Flow mana yang melewati trust boundary?**
4. **Apa attack path menuju account takeover, tenant breakout, privilege escalation, atau unauthorized case access?**
5. **Apa invariant desain yang harus dijaga oleh kode Go?**
6. **Apa yang harus ditolak saat design review meskipun implementasinya terlihat “jalan”?**

Part ini bukan checklist kosmetik. Ini adalah cara berpikir sebelum menulis middleware, policy engine, token validator, atau permission schema.

---

## 2. Kenapa Threat Model Auth Berbeda dari Security Checklist Biasa

Security checklist menjawab:

> “Apakah cookie sudah `Secure`? Apakah token sudah expired? Apakah password sudah di-hash?”

Threat model menjawab:

> “Bagaimana attacker bergerak dari titik masuk ke aset kritikal, dan kontrol mana yang benar-benar memutus attack path itu?”

Checklist penting, tetapi tidak cukup. Banyak sistem yang “lulus checklist” tetap gagal karena model otoritasnya salah.

Contoh:

```text
GET /cases/{caseID}
Authorization: Bearer valid-token-for-user-A
```

Checklist mungkin melihat:

- HTTPS ada.
- JWT signature valid.
- `exp` valid.
- user authenticated.

Tetapi threat model bertanya:

- Apakah `caseID` milik tenant user A?
- Apakah user A punya permission membaca case itu?
- Apakah case sedang berada dalam workflow state yang boleh dibaca role user A?
- Apakah user A sedang bertindak sebagai dirinya sendiri, sebagai delegate, atau sebagai admin impersonator?
- Apakah policy version yang dipakai masih berlaku?
- Apakah permission cache stale setelah role dicabut?
- Apakah audit log menyimpan actor, subject, resource, action, decision, reason, dan policy version?

Authentication yang benar tidak otomatis membuat authorization benar.

---

## 3. Mental Model: Auth System sebagai Security Control Plane

Dalam distributed system, auth adalah **control plane** yang mengatur siapa boleh melakukan apa di data plane.

```mermaid
flowchart LR
    User[Human User / Workload] -->|credential / token / mTLS| AuthN[Authentication Boundary]
    AuthN -->|principal| Session[Session / Token Context]
    Session -->|claims + context| PEP[Policy Enforcement Point]
    PEP -->|decision request| PDP[Policy Decision Point]
    PDP -->|attributes| PIP[Policy Information Point]
    PDP -->|allow / deny + reason| PEP
    PEP -->|authorized operation| DataPlane[Business Service / Data Plane]
    PEP --> Audit[Audit Decision Log]
    DataPlane --> Audit
```

Di sistem kecil, semua ini mungkin satu process Go. Di sistem enterprise, boundary-nya bisa tersebar:

- API gateway melakukan authentication coarse-grained.
- Backend service melakukan object-level authorization.
- Policy service mengevaluasi permission.
- Tenant service menyediakan tenant hierarchy.
- Audit service menyimpan evidence.
- IdP eksternal melakukan primary authentication.

Mental model penting:

> Auth system bukan “library yang dipasang di middleware”. Auth system adalah mekanisme distribusi authority, identity, dan policy decision di seluruh sistem.

### 3.1 Control Plane vs Data Plane

| Layer | Pertanyaan | Contoh |
|---|---|---|
| Authentication control plane | “Siapa/apa caller ini?” | password, passkey, OIDC, mTLS, client credentials |
| Authorization control plane | “Authority apa yang caller miliki?” | role, permission, policy, relationship |
| Session/token control plane | “Bagaimana authority dibawa antar request?” | cookie, opaque token, JWT, refresh token |
| Data plane | “Operasi bisnis apa yang dilakukan?” | approve application, view case, export report |

Threat model harus mengikuti **perpindahan authority**. Setiap kali authority berpindah dari satu representation ke representation lain, ada risiko:

- credential menjadi session,
- authorization code menjadi token,
- external claim menjadi local account,
- role assignment menjadi permission cache,
- admin session menjadi impersonated subject,
- service identity menjadi downstream request.

---

## 4. Aset yang Harus Dilindungi

Threat model dimulai dari aset, bukan dari endpoint.

### 4.1 Aset Identity

| Aset | Kenapa kritikal | Contoh threat |
|---|---|---|
| User identity | dasar semua authority | account takeover, fake account |
| Account binding | menghubungkan identity ke account lokal | malicious account linking |
| External identity link | link ke IdP eksternal | subject swap, email reuse, IdP misbinding |
| Credential | bukti authentication | password theft, passkey enrollment abuse |
| MFA factor | meningkatkan assurance | MFA fatigue, factor reset abuse |
| Recovery channel | jalan masuk terakhir | email takeover, helpdesk social engineering |

### 4.2 Aset Session dan Token

| Aset | Kenapa kritikal | Contoh threat |
|---|---|---|
| Session ID | bearer access ke user session | hijacking, fixation |
| Refresh token | dapat menerbitkan access token baru | persistent compromise |
| Access token | akses API | replay, token substitution |
| ID token | bukti authentication OIDC | token confusion |
| Authorization code | transient grant | code injection, interception |
| JWKS / signing key | validasi token | key confusion, stale key, compromise |

### 4.3 Aset Authorization

| Aset | Kenapa kritikal | Contoh threat |
|---|---|---|
| Role assignment | sumber authority | privilege escalation |
| Permission grant | hak aktual | stale grant, excessive grant |
| Policy rule | logika allow/deny | policy bypass, wrong precedence |
| Resource ownership | dasar object access | BOLA/IDOR |
| Tenant boundary | isolasi data | tenant breakout |
| Delegation record | authority sementara | confused deputy |
| Audit decision log | evidence defensibility | repudiation, tampering |

### 4.4 Aset Operasional

| Aset | Kenapa kritikal | Contoh threat |
|---|---|---|
| IdP configuration | menentukan trust | rogue redirect URI, weak client |
| Client secret/private key | machine authentication | service impersonation |
| Rate-limit state | abuse control | distributed bypass |
| Revocation list | mencabut authority | stale access |
| Policy cache | performa decision | stale authorization |
| Admin console | high privilege | break-glass abuse |

---

## 5. Actor dan Attacker Model

Threat model yang lemah biasanya hanya punya satu attacker: “hacker dari internet”. Untuk auth system, attacker model harus lebih kaya.

### 5.1 Legitimate Actors

- anonymous visitor,
- registered user,
- staff user,
- admin,
- tenant admin,
- support operator,
- delegated actor,
- external IdP,
- service account,
- batch job,
- API client,
- gateway,
- downstream service.

### 5.2 Attacker Classes

| Attacker | Kemampuan | Contoh serangan |
|---|---|---|
| Anonymous internet attacker | kirim request tanpa login | enumeration, brute force, redirect abuse |
| Authenticated low-privilege user | punya token valid | BOLA, BFLA, horizontal escalation |
| User dari tenant lain | punya account valid di tenant berbeda | tenant breakout |
| Malicious admin | punya privilege tinggi | unauthorized impersonation, audit tamper |
| Compromised user | credential dicuri | account takeover |
| Compromised service | token/secret service bocor | lateral movement |
| Malicious OAuth client | registered client abuse | consent phishing, redirect manipulation |
| Network-level attacker | intercept/modify traffic tertentu | token replay bila TLS/binding gagal |
| Supply-chain attacker | dependency/config compromise | token validation bypass |
| Insider/helpdesk attacker | akses proses recovery | factor reset abuse |

### 5.3 Capability-Based View

Jangan hanya mengklasifikasi attacker berdasarkan identitas. Klasifikasikan berdasarkan capability.

| Capability | Dampak terhadap threat model |
|---|---|
| Bisa membaca browser storage | access token di localStorage berisiko tinggi |
| Bisa membuat link phishing | state/nonce/PKCE dan origin binding penting |
| Bisa menebak object ID | object-level authorization wajib |
| Bisa membuat account tenant sendiri | cross-tenant boundary harus eksplisit |
| Bisa mencuri service token | token TTL dan audience harus ketat |
| Bisa mengontrol redirect URI | OAuth client validation kritikal |
| Bisa mengubah role assignment | audit dan dual control penting |
| Bisa membuat request paralel masif | rate limit harus distributed dan per-dimension |

---

## 6. Data Flow dan Trust Boundary

OWASP threat modeling menekankan application decomposition, threat identification/ranking, mitigations, dan review/validation. Data-flow diagram membantu melihat proses, data store, data flow, dan trust boundary. Trust boundary menunjukkan perubahan tingkat trust saat data mengalir antar komponen.

Untuk auth system, trust boundary paling penting adalah:

1. browser ↔ internet-facing endpoint,
2. application ↔ IdP eksternal,
3. gateway ↔ internal service,
4. service ↔ database,
5. service ↔ policy engine,
6. service ↔ cache,
7. admin console ↔ privileged operations,
8. workload ↔ metadata/secret source,
9. token issuer ↔ token validator.

### 6.1 DFD Login + Session + Authorization

```mermaid
flowchart TD
    Browser[Browser / User Agent]
    LoginUI[Login UI]
    App[Go Web App / BFF]
    IdP[External IdP / Authorization Server]
    SessionStore[(Session Store)]
    UserDB[(User / Account DB)]
    PolicySvc[Policy Service / PDP]
    BusinessAPI[Business API / PEP]
    CaseDB[(Case DB)]
    Audit[(Audit Log)]

    Browser -->|1. request protected page| App
    App -->|2. redirect auth request| IdP
    IdP -->|3. auth code callback| App
    App -->|4. token exchange| IdP
    App -->|5. bind external sub to local account| UserDB
    App -->|6. create session| SessionStore
    Browser -->|7. session cookie| App
    App -->|8. API call with principal context| BusinessAPI
    BusinessAPI -->|9. decision request| PolicySvc
    PolicySvc -->|10. attributes| UserDB
    PolicySvc -->|11. allow/deny| BusinessAPI
    BusinessAPI -->|12. read/write resource| CaseDB
    BusinessAPI -->|13. authn/authz/business event| Audit

    subgraph Public_Trust_Zone[Public / User-controlled]
        Browser
    end

    subgraph App_Trust_Zone[Application Trust Zone]
        LoginUI
        App
        BusinessAPI
        SessionStore
    end

    subgraph External_Trust_Zone[External Identity Provider Trust Zone]
        IdP
    end

    subgraph Data_Trust_Zone[Data / Policy Trust Zone]
        UserDB
        PolicySvc
        CaseDB
        Audit
    end
```

### 6.2 Threat Boundary Interpretation

| Boundary | Pertanyaan threat model |
|---|---|
| Browser → App | Apakah request membawa session/token palsu, CSRF, forged headers? |
| App → IdP | Apakah state, nonce, PKCE, issuer, redirect URI benar? |
| IdP → App callback | Apakah auth code berasal dari flow yang kita mulai? |
| App → UserDB | Apakah external identity binding aman? |
| Browser → App session | Apakah session bisa dicuri/fixed/replayed? |
| App → BusinessAPI | Apakah principal context bisa dipalsukan? |
| BusinessAPI → PolicySvc | Apakah decision request lengkap dan tidak manipulable? |
| PolicySvc → UserDB | Apakah attributes fresh dan authoritative? |
| BusinessAPI → CaseDB | Apakah query sudah tenant/resource scoped? |
| Semua → Audit | Apakah audit event immutable dan tidak mengandung secret? |

---

## 7. STRIDE untuk Auth System

STRIDE adalah kerangka sederhana:

- **S**poofing
- **T**ampering
- **R**epudiation
- **I**nformation Disclosure
- **D**enial of Service
- **E**levation of Privilege

Untuk auth system, mapping-nya sangat natural.

| STRIDE | Dalam auth system | Contoh |
|---|---|---|
| Spoofing | berpura-pura sebagai principal lain | stolen token, forged service identity |
| Tampering | mengubah token, role, policy, redirect URI | JWT claim manipulation, policy config edit |
| Repudiation | menyangkal aksi | audit tidak mencatat actor/subject/reason |
| Information Disclosure | bocor identity/session/permission data | token leak, user enumeration |
| DoS | membuat auth/policy unavailable | login flood, JWKS endpoint overload |
| Elevation of Privilege | mendapat authority lebih tinggi | BOLA, admin route bypass, stale role |

### 7.1 STRIDE per Komponen

| Komponen | Spoofing | Tampering | Repudiation | Info Disclosure | DoS | Elevation |
|---|---|---|---|---|---|---|
| Login endpoint | credential replay | request parameter manipulation | missing login audit | username enumeration | brute force | bypass MFA |
| Session store | session hijack | session mutation | no session events | session metadata leak | store exhaustion | fixed session |
| JWT validator | forged issuer | alg/kid abuse | missing token validation logs | claim leak | JWKS fetch storm | audience confusion |
| Policy engine | fake subject | policy tamper | no decision reason | policy introspection leak | PDP outage | wrong deny/allow precedence |
| Admin console | admin spoofing | role edit tamper | admin action not auditable | user data leak | lockout users | privilege escalation |
| Federation | IdP spoofing | claim mapping tamper | no assertion trace | excessive claims | IdP outage | wrong account linking |

---

## 8. Threat Taxonomy untuk Authentication

Authentication threat adalah semua cara attacker membuat sistem percaya bahwa attacker adalah subject yang sah, atau membuat subject sah melakukan authentication dengan authority yang salah.

### 8.1 Credential Stuffing

Credential stuffing terjadi saat attacker memakai pasangan username/password dari breach lain.

Karakteristik:

- request login terlihat seperti login normal,
- password bisa benar,
- serangan tersebar dari banyak IP,
- target biasanya email/username yang valid,
- rate limit per-IP saja sering gagal.

Mitigasi desain:

- rate limit per account, per IP, per device, per ASN, per credential pattern,
- breached-password detection saat set/reset password,
- MFA untuk account berisiko,
- login anomaly detection,
- notification untuk login baru,
- session/device management,
- jangan leak apakah username valid.

Go design implication:

- login service harus menerima `RiskContext`, bukan hanya `username/password`,
- limiter harus abstract interface agar bisa Redis/distributed,
- audit event harus mencatat failure reason internal tanpa membocorkan detail ke user.

```go
type LoginAttempt struct {
    Identifier string
    Password   string
    IP         netip.Addr
    UserAgent  string
    DeviceID   string
    RequestID  string
}

type RiskContext struct {
    IP              netip.Addr
    UserAgentHash   string
    DeviceID        string
    ASN             string
    Country         string
    RecentFailures  int
    KnownDevice     bool
    SuspiciousProxy bool
}
```

### 8.2 Password Spraying

Password spraying memakai sedikit password umum terhadap banyak account.

Perbedaan dengan brute force:

- brute force: banyak password untuk satu account,
- spraying: satu/dua password untuk banyak account.

Mitigasi:

- deteksi password popular across accounts,
- rate limit per password fingerprint,
- tenant-level anomaly,
- delay progresif,
- password denylist.

Desain yang salah:

```text
limit key = ip
```

Desain lebih baik:

```text
limit keys:
- login:ip:{ip}
- login:account:{accountHash}
- login:tenant:{tenantID}
- login:password-pattern:{hashPrefix}
- login:ip-account:{ip}:{accountHash}
```

### 8.3 Brute Force

Brute force adalah percobaan password masif terhadap satu account atau endpoint.

Threat model penting:

- lockout bisa menjadi DoS terhadap user sah,
- captcha bisa bypass atau merusak UX,
- delay harus tidak membuat goroutine/thread exhaustion,
- error message harus konsisten.

Mitigasi:

- exponential backoff,
- soft lock dengan recovery aman,
- adaptive challenge,
- account notification,
- login attempt audit,
- credential compromise response.

### 8.4 Username / Account Enumeration

Enumeration terjadi jika attacker bisa membedakan:

```text
email tidak terdaftar
password salah
account locked
MFA belum aktif
```

Response yang bocor:

```json
{"error":"email_not_found"}
```

Response lebih aman:

```json
{"error":"invalid_credentials"}
```

Namun internal audit tetap harus detail:

```json
{
  "event":"auth.login.failed",
  "reason":"unknown_identifier",
  "identifier_hash":"...",
  "ip":"...",
  "request_id":"..."
}
```

Trade-off:

- User experience lebih buruk bila semua error sama.
- Security lebih baik karena attacker sulit memilah valid account.
- Untuk enterprise/internal app, bisa ada UX khusus setelah channel terverifikasi.

### 8.5 Weak Password Reset

Password reset sering lebih berbahaya daripada login, karena melewati password lama.

Threats:

- reset token terlalu panjang masa berlaku,
- reset token reusable,
- token disimpan plaintext,
- token muncul di logs/referrer,
- reset flow mengungkap account existence,
- email channel compromise,
- reset tidak mencabut session lama,
- reset tidak membutuhkan MFA/step-up untuk high-risk account.

Invariant:

> Recovery flow tidak boleh lebih lemah daripada login flow untuk aset yang sama.

Praktik Go:

- simpan hash token, bukan token,
- one-time use,
- TTL pendek,
- bind token ke purpose dan account,
- rotate session setelah reset,
- revoke refresh tokens lama,
- audit event.

```go
type RecoveryToken struct {
    ID          string
    AccountID   string
    Purpose     string // password_reset, factor_reset, account_recovery
    TokenHash   []byte
    ExpiresAt   time.Time
    UsedAt      *time.Time
    CreatedIP   netip.Addr
    CreatedUA   string
}
```

### 8.6 MFA Fatigue / Push Bombing

Jika MFA memakai push approval, attacker yang punya password bisa mengirim banyak prompt sampai user menekan approve.

Mitigasi:

- number matching,
- rate limit MFA challenge,
- require user-initiated login context,
- show location/device/app,
- prefer phishing-resistant factor untuk high risk,
- detect repeated denied/ignored pushes.

### 8.7 Factor Reset Abuse

MFA reset adalah target utama attacker.

Threats:

- helpdesk social engineering,
- weak email recovery,
- admin reset tanpa dual control,
- recovery code tidak hashed,
- reset tidak audit.

Invariant:

> Faktor yang menaikkan assurance tidak boleh bisa dihapus lewat proses assurance rendah tanpa kompensasi kontrol.

### 8.8 Passkey Enrollment Abuse

Passkey lebih tahan phishing, tetapi enrollment tetap attack surface.

Threats:

- attacker login dengan password curian lalu enroll passkey sendiri,
- user diarahkan ke origin palsu,
- relying party ID salah,
- account recovery melemahkan seluruh sistem,
- tidak ada notification untuk credential baru.

Mitigasi:

- step-up sebelum menambah authenticator,
- notify user untuk credential enrollment,
- allow user melihat/mencabut authenticator,
- bind RP ID/origin secara benar,
- audit attestation/assertion event.

---

## 9. Threat Taxonomy untuk Session dan Token

Session/token adalah representasi authority setelah authentication. Banyak breach terjadi bukan karena password berhasil ditebak, tetapi karena session/token dicuri atau disalahgunakan.

### 9.1 Session Hijacking

Attacker mendapat session ID dan menggunakannya.

Sumber leak:

- XSS,
- insecure cookie,
- logs,
- browser extension,
- proxy,
- malware,
- referer leak,
- misconfigured domain cookie,
- session ID di URL.

Mitigasi:

- cookie `HttpOnly`, `Secure`, `SameSite`,
- jangan simpan session ID di URL,
- session rotation setelah login/privilege change,
- device/session binding ringan,
- anomaly detection,
- short idle timeout untuk high-risk apps,
- revoke session UI.

### 9.2 Session Fixation

Attacker memaksa victim memakai session ID yang sudah diketahui attacker, lalu victim login.

Mitigasi:

- rotate session ID saat login,
- rotate saat step-up,
- rotate saat role/tenant switch,
- tidak menerima session ID dari URL,
- invalidasi anonymous session lama.

Invariant:

> Session identity harus berubah saat privilege level berubah.

### 9.3 CSRF

CSRF membuat browser user mengirim request authenticated tanpa intention user.

Threat model penting:

- cookie otomatis dikirim browser,
- bearer token di Authorization header tidak otomatis dikirim oleh browser biasa,
- tetapi SPA/BFF pattern bisa menciptakan variasi risiko,
- `SameSite` membantu, tetapi bukan satu-satunya kontrol.

Mitigasi:

- SameSite cookie,
- CSRF token untuk state-changing request,
- origin/referer validation,
- require custom header untuk API,
- step-up untuk destructive action.

### 9.4 Token Replay

Bearer token berlaku untuk siapa saja yang memegangnya.

Threats:

- access token bocor di log,
- token dikirim ke wrong audience,
- token dipakai di service lain,
- token TTL terlalu panjang,
- refresh token bocor,
- tidak ada sender constraint.

Mitigasi:

- TTL pendek,
- audience ketat,
- scope minimal,
- token redaction,
- refresh token rotation,
- mTLS/DPoP/sender-constrained token untuk use case tertentu,
- token introspection untuk revocation-sensitive system.

### 9.5 JWT Claim Tampering

JWT signed tidak boleh bisa diubah tanpa invalid signature. Namun banyak bug terjadi karena validator salah.

Bug umum:

- tidak validasi signature,
- menerima `alg=none`,
- algorithm confusion,
- tidak validasi issuer,
- tidak validasi audience,
- tidak validasi expiry,
- memakai ID token sebagai access token,
- percaya claim `role` dari token eksternal tanpa mapping lokal,
- percaya `email_verified` tanpa memahami semantics provider.

Invariant:

> Token yang valid secara kriptografis belum tentu valid secara semantik.

### 9.6 JWKS Cache Poisoning / Key Confusion

Threats:

- `kid` dipakai untuk path traversal/SSRF,
- JWKS URL diambil dari token untrusted,
- cache tidak pin issuer,
- stale key membuat revocation lama gagal,
- key rotation tidak ter-handle,
- fallback key terlalu longgar.

Mitigasi:

- JWKS URI dari trusted config/discovery, bukan token,
- cache per issuer,
- reject unknown issuer,
- allow-list algorithms,
- refresh-on-unknown-kid dengan rate limit,
- fail closed untuk unknown key pada protected API,
- operational runbook untuk emergency rotation.

---

## 10. Threat Taxonomy untuk OAuth2 dan OIDC

OAuth2/OIDC sering terlihat kompleks karena ada banyak redirect dan token. Threat model harus mengikuti flow, bukan menghafal istilah.

RFC 9700 adalah Best Current Practice untuk OAuth 2.0 security dan memperbarui threat model lama, termasuk rekomendasi untuk mode operasi yang lebih aman dan deprecation untuk mode yang dianggap tidak aman.

### 10.1 Authorization Code Interception

Attack path:

1. client memulai auth request,
2. user authenticate di authorization server,
3. authorization server redirect dengan `code`,
4. attacker mencuri code,
5. attacker menukar code menjadi token.

Mitigasi utama:

- PKCE,
- short-lived authorization code,
- one-time code,
- exact redirect URI validation,
- client authentication bila confidential client,
- TLS.

### 10.2 Authorization Code Injection

Attacker menyisipkan authorization code miliknya ke callback victim.

Dampak:

- victim session terikat ke account attacker,
- account linking salah,
- login CSRF,
- data victim tersimpan ke account attacker atau sebaliknya.

Mitigasi:

- `state` kuat dan bound ke browser session,
- `nonce` untuk OIDC,
- PKCE,
- issuer validation,
- bind callback dengan transaction yang dimulai client,
- jangan menerima callback tanpa pending auth transaction.

### 10.3 Redirect URI Manipulation

Threats:

- wildcard redirect,
- open redirect di client,
- path confusion,
- query manipulation,
- subdomain takeover,
- custom scheme hijack di native app.

Mitigasi:

- exact redirect URI matching,
- no wildcard untuk sensitive clients,
- pre-registered redirect URIs,
- validate scheme/host/path,
- no user-controlled redirect target in callback.

### 10.4 Mix-Up Attack

Terjadi saat client mendukung beberapa authorization server dan attacker membuat client menukar code/token ke AS yang salah.

Mitigasi:

- issuer binding,
- store selected provider in auth transaction,
- validate `iss` where applicable,
- separate redirect URI per provider jika perlu,
- discovery metadata trusted per provider.

### 10.5 Implicit Flow dan ROPC

Threat model modern menghindari implicit flow untuk browser-based app karena token terekspos di front-channel. Resource Owner Password Credentials juga bermasalah karena client menerima password user langsung dan melemahkan federation/MFA.

Untuk sistem enterprise Go modern:

- gunakan Authorization Code + PKCE,
- hindari ROPC kecuali legacy constrained dan disetujui security review,
- gunakan BFF untuk menyembunyikan token dari browser bila memungkinkan,
- gunakan device authorization grant untuk constrained devices.

### 10.6 Token Substitution / Confusion

Contoh bug:

```text
API menerima ID token dari OIDC login sebagai access token API.
```

Masalah:

- ID token audience-nya client, bukan API,
- ID token membuktikan authentication event, bukan authorization ke resource server,
- claim di ID token tidak selalu cukup untuk API authorization.

Mitigasi:

- bedakan token type,
- validate `aud` sesuai API,
- validate `azp`/client jika relevan,
- gunakan access token untuk API,
- jangan derive permission hanya dari ID token eksternal.

### 10.7 Scope Overtrust

Scope sering disalahartikan sebagai permission lengkap.

Scope menjawab:

> Client diberi izin untuk meminta kategori akses tertentu.

Scope belum tentu menjawab:

> User ini boleh mengakses object tertentu dalam workflow state tertentu.

Contoh:

```text
scope = case:read
```

Masih perlu cek:

- case milik tenant mana,
- user role apa,
- assignment ke case ada atau tidak,
- state case memungkinkan read atau tidak,
- ada conflict of interest atau tidak,
- user sedang acting as siapa.

---

## 11. Threat Taxonomy untuk Authorization dan Permission

Authorization threat adalah kelas bug paling sering fatal di sistem enterprise karena attacker sering memakai token valid.

### 11.1 Broken Object Level Authorization / IDOR

OWASP API Security Top 10 2023 menempatkan Broken Object Level Authorization sebagai API1. Intinya: endpoint menerima object identifier dari request dan tidak memverifikasi apakah caller punya akses terhadap object tersebut.

Contoh:

```http
GET /api/cases/CASE-1001
Authorization: Bearer token-user-A
```

Attacker mengganti:

```http
GET /api/cases/CASE-1002
```

Jika API hanya cek `isAuthenticated`, maka data bocor.

Mitigasi:

- object-level check di setiap function yang mengambil resource berdasarkan user-supplied ID,
- tenant-scoped query,
- repository function menerima `AuthzContext`,
- policy check dekat dengan resource access,
- test matrix untuk horizontal access,
- jangan mengandalkan UUID sebagai kontrol security.

Go anti-pattern:

```go
func GetCase(ctx context.Context, id string) (*Case, error) {
    return repo.FindCaseByID(ctx, id)
}
```

Lebih baik:

```go
func GetCase(ctx context.Context, principal Principal, id CaseID) (*Case, error) {
    c, err := repo.FindCaseByID(ctx, id)
    if err != nil { return nil, err }

    decision, err := authz.Can(ctx, principal, ActionReadCase, ResourceCase(c))
    if err != nil { return nil, err }
    if !decision.Allow { return nil, ErrForbidden }

    return c, nil
}
```

Untuk high-risk system, lebih baik lagi query-nya sudah scoped:

```go
func FindReadableCase(ctx context.Context, principal Principal, id CaseID) (*Case, error)
```

### 11.2 Broken Function Level Authorization

User bisa memanggil endpoint/function yang seharusnya hanya admin/staff.

Contoh:

```http
POST /api/admin/users/{id}/roles
```

Bug umum:

- route admin tersembunyi tetapi tidak diproteksi,
- FE menyembunyikan tombol tetapi BE tidak cek,
- gateway cek coarse permission, service lupa cek fine permission,
- method gRPC baru tidak masuk interceptor mapping,
- background job endpoint tidak authenticated.

Mitigasi:

- default deny,
- explicit route policy,
- centralized route registration with required permission,
- CI test untuk semua route punya auth metadata,
- service-level authorization, bukan hanya gateway.

### 11.3 Object Property Level Authorization

User boleh melihat object, tetapi tidak semua field.

Contoh:

- officer boleh melihat case summary,
- hanya supervisor boleh melihat confidential notes,
- applicant boleh melihat status, tetapi tidak internal risk score,
- tenant admin boleh melihat user list, tetapi tidak MFA recovery secret.

Threats:

- JSON serializer mengembalikan semua field,
- GraphQL resolver leak field,
- export/report melewati field-level policy,
- audit/detail endpoint lebih longgar dari list endpoint.

Mitigasi:

- DTO per view/use case,
- field-level policy untuk sensitive fields,
- explicit projection,
- deny-by-default serializer,
- test snapshot untuk response fields.

### 11.4 Privilege Escalation via Role Assignment

Threats:

- user bisa assign role lebih tinggi dari dirinya,
- tenant admin bisa assign global admin,
- role hierarchy salah,
- role edit tidak butuh step-up,
- no dual control untuk sensitive role,
- stale token tetap membawa role lama.

Invariant:

> Authority to grant permission must itself be explicitly authorized and usually narrower than the permission being granted.

### 11.5 Role Explosion dan Overbroad Roles

Role explosion bukan hanya maintainability problem; ia security problem.

Gejala:

- role `Admin` dipakai untuk semua exception,
- permission tidak bisa dijelaskan,
- temporary access tidak punya expiry,
- role business bercampur role technical,
- user mendapat role karena “biar jalan”.

Mitigasi:

- role sebagai bundle permission, bukan decision logic,
- permission atomik,
- contextual constraints,
- time-bound grants,
- approval workflow,
- periodic access review.

### 11.6 Stale Authorization

Authorization stale terjadi saat decision masih allow setelah authority berubah.

Sumber:

- JWT TTL terlalu panjang,
- permission cache tidak invalidated,
- role claim embedded di token,
- service cache berbeda-beda,
- revocation event hilang,
- eventual consistency tidak dipahami.

Pertanyaan desain:

- Berapa maksimum waktu user yang dicabut role masih bisa akses?
- Apakah angka itu diterima risk owner?
- Apakah high-risk permission harus introspection/online decision?
- Apakah access token harus versioned dengan `authz_version`?

### 11.7 Tenant Breakout

Tenant breakout adalah user dari tenant A mengakses data tenant B.

Attack path umum:

- manipulasi path/query `tenant_id`,
- object ID global tanpa tenant scoping,
- report/export lupa tenant filter,
- search index tidak tenant-aware,
- cache key tidak menyertakan tenant,
- background job memakai service role terlalu luas,
- admin endpoint tidak membedakan global admin vs tenant admin.

Invariant:

> Tenant boundary harus enforced di layer authorization dan data access, bukan hanya di UI atau JWT claim.

### 11.8 Confused Deputy

Confused deputy terjadi saat service yang punya privilege lebih tinggi dipakai untuk melakukan aksi atas nama attacker.

Contoh:

- user upload URL, service internal mengambil URL dengan privileged network access,
- user meminta export, worker memakai service account yang bisa membaca semua tenant,
- API gateway meneruskan trusted header `X-User-ID` yang bisa dipalsukan jika bypass gateway.

Mitigasi:

- explicit actor/subject model,
- downstream token exchange dengan audience dan delegated scope,
- service tidak memakai broad authority kecuali benar-benar perlu,
- signed internal principal context,
- reject caller-supplied trusted headers at edge.

### 11.9 TOCTOU Authorization

Time-of-check to time-of-use:

1. cek user boleh approve case,
2. case berubah state/owner,
3. approval tetap dieksekusi.

Mitigasi:

- authorization condition dimasukkan ke update query,
- optimistic locking,
- re-check before commit,
- transaction boundary jelas,
- policy decision mencakup resource version/state.

---

## 12. Threat Taxonomy untuk Federation dan External Identity

Federation menambah trust boundary. Kita tidak lagi mengontrol primary authentication, tetapi kita tetap bertanggung jawab terhadap local authorization.

### 12.1 Wrong Account Linking

Bug paling berbahaya:

```text
Jika email sama, link external identity ke local account.
```

Masalah:

- email bisa berubah,
- email bisa belum verified,
- provider berbeda punya semantics berbeda,
- attacker bisa membuat account di IdP yang mengontrol email tertentu dalam kondisi tertentu,
- subject identifier (`sub`) adalah identifier utama di OIDC, bukan email.

Mitigasi:

- link berdasarkan issuer + subject,
- email hanya attribute, bukan primary key trust,
- require verified email jika email dipakai untuk UX,
- explicit account linking flow dengan step-up,
- audit link/unlink external identity.

### 12.2 Claim Mapping Abuse

External IdP mengirim claim:

```json
{
  "role": "admin",
  "department": "enforcement"
}
```

Bahaya:

- aplikasi langsung percaya `role`,
- claim mapping terlalu luas,
- tenant mapping ambigu,
- IdP claim berubah format,
- no allow-list claim source.

Mitigasi:

- external claims dipetakan ke local entitlements lewat aturan eksplisit,
- role high privilege tidak auto-provision tanpa approval,
- simpan raw claim snapshot untuk audit,
- version claim mapping,
- fail closed jika claim required hilang.

### 12.3 JIT Provisioning Abuse

Just-in-time provisioning membuat account lokal saat user login dari IdP.

Threats:

- domain email trust terlalu luas,
- IdP misconfiguration membuat unauthorized users masuk,
- tenant auto-join salah,
- default role terlalu privileged,
- deprovisioning tidak sinkron.

Mitigasi:

- default minimal role,
- explicit tenant allow-list,
- SCIM/deprovisioning integration bila perlu,
- periodic reconciliation,
- first-login approval untuk sensitive tenant.

### 12.4 IdP Outage dan Fail-Open Risk

Jika IdP down, apa sistem boleh menerima session lama?

Opsi:

| Mode | Risiko | Cocok untuk |
|---|---|---|
| fail closed | user tidak bisa login | high security |
| allow existing session | stale user tetap bisa akses | productivity-sensitive |
| offline emergency access | break-glass abuse | critical operation |

Threat model harus menentukan mode eksplisit. Jangan sampai outage membuat engineer menambahkan bypass login ad-hoc.

---

## 13. Threat Taxonomy untuk Service-to-Service Identity

Dalam microservices, “user identity” bukan satu-satunya identity. Workload juga principal.

### 13.1 Stolen Client Secret

Client credentials flow sering memakai client secret.

Threats:

- secret bocor di repo,
- secret bocor di logs,
- secret ada di image/container,
- secret shared antar env,
- secret tidak rotated,
- satu secret terlalu banyak privilege.

Mitigasi:

- secret manager,
- rotation,
- per-environment secret,
- audience/scope minimal,
- mTLS/private_key_jwt untuk higher assurance,
- workload identity bila tersedia.

### 13.2 Internal Network Overtrust

Anti-pattern:

```text
Kalau request dari VPC/internal cluster, berarti trusted.
```

Masalah:

- compromised pod bisa lateral movement,
- SSRF bisa mencapai internal endpoint,
- gateway bypass,
- debug endpoint terbuka internal,
- service account terlalu luas.

Mitigasi:

- authenticate every service call,
- authorize per operation,
- mTLS/workload identity,
- network policy sebagai defense-in-depth, bukan auth replacement,
- reject unsigned principal headers.

### 13.3 Trusted Header Spoofing

Gateway menambahkan:

```http
X-User-ID: 123
X-Tenant-ID: A
X-Roles: admin
```

Jika internal service bisa diakses langsung, attacker mengirim header palsu.

Mitigasi:

- strip incoming trusted headers at edge,
- only accept trusted headers from authenticated gateway identity,
- sign/encrypt propagated context,
- prefer token exchange or internal JWT with audience,
- service-level network restrictions.

### 13.4 Downstream Over-Delegation

Service A menerima request user lalu memanggil Service B memakai service account superuser.

Threat:

- user low privilege memicu Service A untuk membaca data yang seharusnya tidak bisa dia akses,
- audit downstream hanya melihat Service A, bukan user asli,
- B tidak bisa enforce object-level authorization.

Mitigasi:

- propagate actor/subject,
- token exchange with delegated authority,
- downstream authorization menggunakan both service identity and user subject,
- audit actor chain.

---

## 14. Threat Taxonomy untuk Admin, Delegation, dan Break-Glass

High-privilege workflows adalah attack surface khusus.

### 14.1 Admin Overtrust

Admin bukan berarti boleh semua.

Harus dibedakan:

- global admin,
- tenant admin,
- security admin,
- support admin,
- billing admin,
- policy admin,
- read-only auditor,
- break-glass operator.

Threats:

- admin bisa mengubah role dirinya sendiri,
- support bisa melihat data sensitif tanpa reason,
- tenant admin bisa keluar tenant boundary,
- admin action tidak tercatat.

Mitigasi:

- least privilege admin roles,
- step-up untuk sensitive operation,
- reason code,
- dual control,
- immutable audit,
- separation of duties.

### 14.2 Impersonation Abuse

Impersonation berguna untuk support, tetapi sangat berbahaya.

Pertanyaan desain:

- Apakah impersonator boleh melakukan write action?
- Apakah user diberi tahu?
- Apakah session impersonation time-bound?
- Apakah audit membedakan actor dan subject?
- Apakah permission yang digunakan milik user, admin, atau intersection?

Invariant:

> Setiap aksi impersonation harus mencatat actor asli dan subject yang diimpersonate.

Contoh audit:

```json
{
  "event":"case.update",
  "actor":"admin:42",
  "subject":"user:1001",
  "acting_mode":"impersonation",
  "resource":"case:ABC",
  "action":"case.update",
  "decision":"allow",
  "reason":"support-ticket:ST-123",
  "policy_version":"2026-06-24.1"
}
```

### 14.3 Break-Glass Abuse

Break-glass adalah emergency access saat sistem normal tidak cukup.

Risiko:

- dipakai untuk bypass process,
- tidak expired,
- tidak reviewed,
- tidak alert,
- shared account.

Mitigasi:

- named user, no shared account,
- strong MFA,
- time-bound,
- mandatory reason,
- automatic alert,
- post-use review,
- minimal emergency permissions.

---

## 15. Threat Taxonomy untuk Operational Auth

Auth system yang secara desain aman bisa gagal secara operasional.

### 15.1 Key Rotation Failure

Threats:

- old key tidak dicabut,
- new key belum tersebar,
- validators stale,
- token issuer memakai key yang tidak ada di JWKS,
- emergency rotation menyebabkan outage,
- unknown `kid` memicu fetch storm.

Mitigasi:

- planned rotation timeline,
- overlapping keys,
- cache TTL jelas,
- refresh-on-unknown-kid dengan rate limit,
- metrics for key validation failures,
- runbook emergency revoke.

### 15.2 Clock Skew

Token validation bergantung pada waktu:

- `exp`,
- `nbf`,
- `iat`,
- auth code TTL,
- session idle timeout,
- TOTP window.

Threats:

- valid token ditolak,
- expired token diterima terlalu lama,
- TOTP accept window terlalu besar,
- nodes berbeda perilaku.

Mitigasi:

- NTP reliability,
- bounded skew tolerance,
- monitor validation failures by reason,
- centralize time abstraction untuk tests.

### 15.3 Log dan Telemetry Leak

Auth data sangat mudah bocor di logs.

Jangan log:

- password,
- OTP,
- authorization code,
- access token,
- refresh token,
- session ID,
- raw recovery token,
- full ID token,
- private key,
- client secret.

Boleh log secara hati-hati:

- token hash/fingerprint,
- subject ID,
- issuer,
- audience,
- decision ID,
- request ID,
- policy version,
- failure reason internal.

### 15.4 Policy Deployment Failure

Threats:

- policy baru allow terlalu luas,
- policy rollback tidak sinkron,
- service A memakai policy version baru, service B lama,
- no test for deny cases,
- no decision log.

Mitigasi:

- policy as code,
- unit tests for policy,
- canary rollout,
- decision diff,
- versioned policy,
- audit include policy version.

### 15.5 Revocation Failure

Revocation sering gagal karena sistem ingin performa tinggi.

Pertanyaan:

- Bagaimana revoke refresh token?
- Bagaimana revoke access token JWT yang masih valid?
- Bagaimana revoke role yang sudah embedded di token?
- Bagaimana revoke service credential?
- Bagaimana revoke external IdP session?

Tidak ada jawaban tunggal. Trade-off utama:

| Strategi | Kelebihan | Kekurangan |
|---|---|---|
| short access token TTL | sederhana | revocation latency sampai TTL habis |
| introspection | revocation cepat | dependency runtime ke auth server |
| token version | scalable | perlu cek store/cache |
| denylist | targeted | storage dan lookup cost |
| opaque token | mudah revoke | butuh lookup setiap request |

---

## 16. Attack Tree: Dari Internet Request ke Privilege Escalation

Attack tree membantu melihat beberapa jalur menuju tujuan attacker.

### 16.1 Goal: Access Case from Another Tenant

```mermaid
flowchart TD
    Goal[Goal: Access case from another tenant]

    Goal --> A[Use valid low-privilege account]
    Goal --> B[Steal privileged session]
    Goal --> C[Exploit service-to-service trust]
    Goal --> D[Abuse admin/delegation]

    A --> A1[Manipulate caseID]
    A --> A2[Manipulate tenantID]
    A --> A3[Use report/export endpoint]
    A --> A4[Use search endpoint]
    A1 --> A1a[API checks authn only]
    A2 --> A2a[DB query trusts request tenant]
    A3 --> A3a[Export worker uses global service role]
    A4 --> A4a[Search index cache missing tenant key]

    B --> B1[Steal cookie via XSS]
    B --> B2[Replay bearer token from logs]
    B --> B3[Session fixation]

    C --> C1[Call internal API directly]
    C --> C2[Spoof X-User-ID header]
    C --> C3[Use stolen client secret]

    D --> D1[Impersonation without reason/limit]
    D --> D2[Role assignment escalation]
    D --> D3[Break-glass not reviewed]
```

### 16.2 Control Mapping

| Attack path | Control yang memutus path |
|---|---|
| Manipulate caseID | object-level authorization, tenant-scoped repository |
| Manipulate tenantID | tenant context from trusted session, not request param |
| Report/export leak | export job carries delegated subject, output authz check |
| Search index leak | tenant-aware index and cache key |
| Cookie theft | HttpOnly/Secure/SameSite, XSS control, session revoke |
| Token from logs | token redaction, short TTL, audience limit |
| Internal direct call | mTLS/workload identity, network policy, service authz |
| Header spoofing | strip trusted headers, authenticated gateway |
| Role escalation | grant permission model, dual control, step-up |
| Break-glass abuse | time-bound, alert, post-review, immutable audit |

---

## 17. Risk Rating yang Berguna untuk Engineer

Risk rating yang terlalu abstrak tidak membantu engineer. Gunakan model yang menghubungkan threat dengan design decision.

### 17.1 Format Threat Record

```text
Threat ID: AUTHZ-BOLA-001
Asset: Case record
Attacker: Authenticated user from same or different tenant
Entry point: GET /api/cases/{caseID}
Precondition: Attacker has valid account
Attack: Replace caseID with another user's caseID
Impact: Confidential case data disclosure, regulatory breach
Existing controls: JWT authn at gateway
Missing controls: Object-level authorization in service/repository
Likelihood: High
Impact: High
Risk: Critical
Mitigation: tenant-scoped query + authz.Can(read, case) + tests
Residual risk: Low if every path uses same repository guard
Owner: Case service team
Evidence: test cases + audit decision logs
```

### 17.2 Risk Dimensions

| Dimension | Pertanyaan |
|---|---|
| Impact | Apa data/action yang terkena? |
| Likelihood | Seberapa mudah attacker menjalankan? |
| Preconditions | Perlu login? Perlu admin? Perlu network internal? |
| Detectability | Apakah akan terlihat di audit/monitoring? |
| Blast radius | Satu object, satu tenant, semua tenant? |
| Revocability | Bisa cepat dicabut? |
| Exploit complexity | Butuh timing/crypto/insider atau hanya ganti ID? |
| Regulatory consequence | Apakah menyentuh PII, enforcement, legal, audit? |

### 17.3 Prioritas untuk Auth System

Umumnya, prioritaskan:

1. account takeover,
2. privilege escalation,
3. tenant breakout,
4. unauthorized write/destructive action,
5. recovery/admin abuse,
6. persistent token/session compromise,
7. audit tampering/repudiation,
8. high-volume login abuse,
9. information disclosure via enumeration/logging.

---

## 18. Mapping Threat ke Go Design

Threat model harus berakhir menjadi shape kode.

### 18.1 Principle: Parse, Authenticate, Authorize, Then Execute

```text
request
  -> parse input
  -> authenticate caller
  -> construct typed principal
  -> load minimal resource/context
  -> authorize action against resource/context
  -> execute business operation
  -> audit decision and outcome
```

Anti-pattern:

```text
request
  -> execute DB query
  -> maybe check permission later
```

### 18.2 Jangan Percaya `context.Context` Tanpa Boundary

`context.Context` berguna untuk membawa principal, tetapi harus typed dan hanya dibuat oleh trusted auth middleware.

Buruk:

```go
userID := ctx.Value("user_id").(string)
```

Lebih baik:

```go
type principalKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
    return context.WithValue(ctx, principalKey{}, p)
}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
    p, ok := ctx.Value(principalKey{}).(Principal)
    return p, ok
}
```

Tetapi top engineer juga sadar:

- context bukan authorization engine,
- context bisa hilang di goroutine/background job,
- context value tidak boleh jadi hidden global authority,
- boundary harus jelas siapa boleh membuat principal.

### 18.3 Typed Principal dan Actor

```go
type PrincipalType string

const (
    PrincipalHuman   PrincipalType = "human"
    PrincipalService PrincipalType = "service"
    PrincipalAdmin   PrincipalType = "admin"
)

type Principal struct {
    ID           string
    Type         PrincipalType
    TenantID     string
    AuthnMethod  string
    Assurance    AssuranceLevel
    SessionID    string
    TokenID      string
    Actor        *ActorChain
}

type ActorChain struct {
    OriginalActorID string
    ActingSubjectID string
    Mode            string // self, delegation, impersonation, break_glass
    Reason          string
}
```

### 18.4 Decision Object, Bukan Boolean

Buruk:

```go
if !Can(user, "read_case") { return forbidden }
```

Lebih baik:

```go
type Decision struct {
    Allow         bool
    Reason        string
    PolicyID      string
    PolicyVersion string
    Obligations   []Obligation
}
```

Kenapa?

- audit butuh reason,
- deny harus bisa dijelaskan internal,
- policy version penting untuk forensic,
- obligation bisa memaksa redaction, step-up, masking, approval.

### 18.5 Authorization Harus Dekat dengan Resource

Cek route-level saja tidak cukup.

```go
// Route-level: coarse
RequireAuthenticated(next)
RequirePermission(ActionReadCase)(next)

// Service/repository-level: fine-grained
FindReadableCase(ctx, principal, caseID)
```

Top engineer biasanya membuat invariant:

> Tidak ada function yang mengambil resource sensitif berdasarkan external ID tanpa menerima principal/authz context atau sudah berada di boundary internal yang terbukti aman.

### 18.6 Error Semantics

Bedakan internal reason dan external response.

| Kondisi | External status | Internal reason |
|---|---:|---|
| No token/session | 401 | missing_credentials |
| Token invalid | 401 | invalid_signature / expired / bad_audience |
| Authenticated but no permission | 403 | policy_deny |
| Resource not visible | 404 atau 403 | not_in_tenant / no_object_access |
| Step-up required | 403/401 with challenge | insufficient_assurance |
| Rate limited | 429 | limiter_dimension |

Untuk object access, kadang 404 dipakai agar resource existence tidak bocor. Tetapi audit internal tetap harus tahu alasan sebenarnya.

---

## 19. Go Implementation Skeleton: Threat-Aware Auth Boundary

Skeleton ini bukan framework final, tetapi bentuk arsitektur.

```go
package auth

import (
    "context"
    "errors"
    "net/http"
    "time"
)

type Action string

type Resource struct {
    Type     string
    ID       string
    TenantID string
    OwnerID  string
    State    string
    Version  string
}

type Principal struct {
    ID          string
    Type        string
    TenantID    string
    SessionID   string
    TokenID     string
    Assurance   string
    AuthTime    time.Time
    ActorChain  []Actor
}

type Actor struct {
    ID     string
    Mode   string
    Reason string
}

type Decision struct {
    Allow         bool
    Reason        string
    PolicyID      string
    PolicyVersion string
}

type Authenticator interface {
    AuthenticateHTTP(r *http.Request) (Principal, error)
}

type Authorizer interface {
    Decide(ctx context.Context, p Principal, action Action, resource Resource) (Decision, error)
}

type Auditor interface {
    RecordAuthn(ctx context.Context, event AuthnEvent) error
    RecordAuthz(ctx context.Context, event AuthzEvent) error
}

type AuthnEvent struct {
    RequestID string
    SubjectID string
    Outcome   string
    Reason    string
    IPHash    string
    At        time.Time
}

type AuthzEvent struct {
    RequestID     string
    SubjectID     string
    ActorMode     string
    Action        Action
    Resource      Resource
    Decision      Decision
    At            time.Time
}

var (
    ErrUnauthenticated = errors.New("unauthenticated")
    ErrForbidden       = errors.New("forbidden")
)
```

Middleware shape:

```go
func AuthnMiddleware(authn Authenticator, audit Auditor) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            p, err := authn.AuthenticateHTTP(r)
            if err != nil {
                _ = audit.RecordAuthn(r.Context(), AuthnEvent{
                    RequestID: requestID(r),
                    Outcome:   "deny",
                    Reason:    internalReason(err),
                    At:        time.Now(),
                })
                http.Error(w, "unauthenticated", http.StatusUnauthorized)
                return
            }

            ctx := WithPrincipal(r.Context(), p)
            _ = audit.RecordAuthn(ctx, AuthnEvent{
                RequestID: requestID(r),
                SubjectID: p.ID,
                Outcome:   "allow",
                Reason:    "authenticated",
                At:        time.Now(),
            })

            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

Handler shape:

```go
func GetCaseHandler(repo CaseRepository, authz Authorizer, audit Auditor) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        p, ok := PrincipalFromContext(ctx)
        if !ok {
            http.Error(w, "unauthenticated", http.StatusUnauthorized)
            return
        }

        caseID := parseCaseID(r)

        // Load minimal metadata first. Do not return data yet.
        meta, err := repo.FindCaseMetadata(ctx, caseID)
        if err != nil {
            writeNotFoundOrInternal(w, err)
            return
        }

        res := Resource{
            Type:     "case",
            ID:       meta.ID,
            TenantID: meta.TenantID,
            OwnerID:  meta.OwnerID,
            State:    meta.State,
            Version:  meta.Version,
        }

        dec, err := authz.Decide(ctx, p, Action("case.read"), res)
        if err != nil {
            http.Error(w, "authorization unavailable", http.StatusServiceUnavailable)
            return
        }

        _ = audit.RecordAuthz(ctx, AuthzEvent{
            RequestID: requestID(r),
            SubjectID: p.ID,
            Action:    Action("case.read"),
            Resource:  res,
            Decision:  dec,
            At:        time.Now(),
        })

        if !dec.Allow {
            // Could be 404 if hiding existence is required.
            http.Error(w, "forbidden", http.StatusForbidden)
            return
        }

        c, err := repo.FindCaseByID(ctx, caseID)
        if err != nil {
            writeNotFoundOrInternal(w, err)
            return
        }

        writeJSON(w, c)
    }
}
```

Important nuance:

- Untuk TOCTOU-sensitive write operation, metadata check saja belum cukup.
- Authorization condition harus masuk ke transaction/update predicate.

Contoh:

```sql
UPDATE cases
SET status = 'APPROVED'
WHERE id = :case_id
  AND tenant_id = :tenant_id
  AND status = 'PENDING_REVIEW'
  AND assigned_officer_id = :subject_id
```

---

## 20. Checklist Design Review

Gunakan checklist ini saat review design auth service atau feature baru.

### 20.1 Authentication

- [ ] Apakah semua critical endpoint punya authentication requirement eksplisit?
- [ ] Apakah login response tidak membocorkan account existence?
- [ ] Apakah password reset token one-time, hashed at rest, dan punya TTL?
- [ ] Apakah factor enrollment/removal butuh step-up?
- [ ] Apakah MFA recovery tidak lebih lemah dari MFA?
- [ ] Apakah session rotated setelah login dan privilege change?
- [ ] Apakah login abuse dikontrol per account/IP/tenant/device, bukan IP saja?

### 20.2 Session / Token

- [ ] Apakah token type dibedakan: ID token, access token, refresh token, session ID?
- [ ] Apakah issuer/audience/expiry/nbf/signature divalidasi?
- [ ] Apakah algorithm allow-list eksplisit?
- [ ] Apakah JWKS URI berasal dari trusted config?
- [ ] Apakah token tidak pernah masuk log?
- [ ] Apakah refresh token rotation/reuse detection ada?
- [ ] Apakah revocation latency diketahui dan diterima?

### 20.3 OAuth/OIDC

- [ ] Authorization Code + PKCE digunakan?
- [ ] `state` bound ke auth transaction?
- [ ] `nonce` digunakan untuk OIDC login?
- [ ] Redirect URI exact match?
- [ ] Issuer/provider binding aman?
- [ ] Callback tanpa pending transaction ditolak?
- [ ] Account linking memakai issuer + subject, bukan email saja?

### 20.4 Authorization

- [ ] Apakah setiap object access melakukan object-level authorization?
- [ ] Apakah tenant boundary enforced di query/data layer?
- [ ] Apakah field-level sensitive data punya projection/redaction?
- [ ] Apakah function-level admin action dilindungi?
- [ ] Apakah permission grant/revoke diaudit?
- [ ] Apakah stale permission window diketahui?
- [ ] Apakah policy decision mencatat reason dan policy version?

### 20.5 Service-to-Service

- [ ] Apakah internal service call authenticated?
- [ ] Apakah service identity punya audience/scope minimal?
- [ ] Apakah trusted headers tidak bisa dipalsukan?
- [ ] Apakah downstream call membawa actor/subject chain?
- [ ] Apakah client secret rotated dan tidak shared antar env?

### 20.6 Admin / Break-Glass

- [ ] Apakah admin role dipisah per capability?
- [ ] Apakah sensitive admin action butuh step-up?
- [ ] Apakah impersonation mencatat actor dan subject?
- [ ] Apakah break-glass time-bound dan alerting?
- [ ] Apakah ada post-use review?

### 20.7 Audit

- [ ] Apakah authn event tercatat?
- [ ] Apakah authz decision tercatat?
- [ ] Apakah deny event penting tercatat?
- [ ] Apakah audit immutable/tamper-resistant?
- [ ] Apakah audit tidak menyimpan secret/token?
- [ ] Apakah audit bisa menjawab: who did what, to which resource, as whom, under which authority, by which policy version?

---

## 21. Failure Modes yang Sering Diremehkan

### 21.1 “Gateway sudah cek auth, service tidak perlu cek lagi”

Ini asumsi lemah.

Masalah:

- gateway bisa bypass,
- internal caller bisa langsung ke service,
- gateway tidak punya resource context,
- service method baru lupa route policy,
- permission object-level tidak bisa hanya di gateway.

Kesimpulan:

> Gateway cocok untuk coarse gate. Fine-grained authorization harus tetap di service yang memahami resource.

### 21.2 “UUID aman karena tidak bisa ditebak”

UUID mengurangi enumerability, tetapi bukan authorization.

Masalah:

- ID bisa bocor lewat logs, URL, email, referrer, browser history,
- insider bisa tahu ID,
- object ID bisa diproduksi endpoint lain,
- shared link bisa diteruskan.

Kesimpulan:

> Non-guessable ID bukan pengganti object-level access control.

### 21.3 “Role ada di JWT, jadi cepat”

Embedding role di JWT mempercepat read, tetapi menciptakan stale authorization.

Masalah:

- role revoke tidak langsung efektif,
- tenant switch rumit,
- role mapping berubah tetapi token lama masih dipakai,
- high-risk permission terlalu lama berlaku.

Solusi:

- token TTL pendek,
- permission version,
- online check untuk sensitive action,
- avoid embedding fine-grained permissions di token.

### 21.4 “Internal admin bisa dipercaya”

Admin adalah target attacker dan juga potential insider risk.

Solusi:

- least privilege,
- step-up,
- dual control,
- immutable audit,
- anomaly detection,
- no shared admin account.

### 21.5 “Policy engine down, allow saja biar sistem jalan”

Fail-open mungkin acceptable untuk low-risk read-only feature. Untuk enforcement/regulatory system, fail-open bisa menjadi breach.

Harus eksplisit:

| Action type | Outage mode |
|---|---|
| Public read | allow cached |
| Low-risk user self-read | allow recent cached decision |
| Cross-tenant access | deny |
| Admin role change | deny |
| Case approval/enforcement action | deny or require break-glass |
| Emergency operation | break-glass audited path |

---

## 22. Case Study: Multi-Tenant Regulatory Case Management

Bayangkan sistem Go untuk regulatory case management:

- agency/tenant,
- officer,
- supervisor,
- applicant,
- case,
- appeal,
- enforcement action,
- audit trail,
- external identity provider,
- admin console,
- reports/export,
- internal batch jobs.

### 22.1 Critical Assets

| Asset | Sensitivity |
|---|---|
| Case details | high |
| Enforcement notes | very high |
| Applicant identity | high |
| Internal recommendation | very high |
| Appeal document | high |
| Supervisor decision | high |
| Audit trail | very high |
| Role assignment | very high |
| Break-glass event | very high |

### 22.2 Example Threats

| Threat | Example |
|---|---|
| BOLA | officer tenant A reads case tenant B |
| BFLA | applicant calls supervisor approve endpoint |
| Field leak | public applicant sees internal notes |
| Workflow bypass | officer approves case not assigned to them |
| TOCTOU | case reassigned after authz check but before approval |
| Delegation abuse | support impersonates applicant and submits action |
| Report leak | export endpoint misses tenant filter |
| Search leak | search index cache key missing tenant |
| Audit tamper | admin deletes action history |
| Stale role | removed officer still approves using old token |

### 22.3 Authorization Invariant untuk Case Approval

Case approval should require:

```text
principal.type == human
principal.tenant_id == case.tenant_id
principal has permission case.approve
principal is assigned reviewer OR principal has supervisor override
case.status == pending_review
principal.assurance >= AAL2-equivalent for approval
no conflict-of-interest flag
policy_version is current enough for write operation
```

### 22.4 Mermaid Decision Flow

```mermaid
flowchart TD
    Start[Approve Case Request]
    Authn{Authenticated?}
    Tenant{Same tenant?}
    Permission{Has case.approve?}
    Assignment{Assigned reviewer or supervisor override?}
    State{Case pending review?}
    Assurance{Sufficient assurance?}
    Conflict{Conflict of interest?}
    Txn[Execute conditional update in transaction]
    Audit[Write authz + business audit]
    Deny[Deny]
    Allow[Approved]

    Start --> Authn
    Authn -- no --> Deny
    Authn -- yes --> Tenant
    Tenant -- no --> Deny
    Tenant -- yes --> Permission
    Permission -- no --> Deny
    Permission -- yes --> Assignment
    Assignment -- no --> Deny
    Assignment -- yes --> State
    State -- no --> Deny
    State -- yes --> Assurance
    Assurance -- no --> Deny
    Assurance -- yes --> Conflict
    Conflict -- yes --> Deny
    Conflict -- no --> Txn
    Txn --> Audit
    Audit --> Allow
```

### 22.5 Write-Side Control

For approval, do not rely only on pre-check.

```go
type ApproveCaseCommand struct {
    CaseID  string
    Comment string
}

func (s *CaseService) Approve(ctx context.Context, p auth.Principal, cmd ApproveCaseCommand) error {
    meta, err := s.repo.FindCaseMetadata(ctx, cmd.CaseID)
    if err != nil { return err }

    decision, err := s.authz.Decide(ctx, p, "case.approve", auth.Resource{
        Type:     "case",
        ID:       meta.ID,
        TenantID: meta.TenantID,
        State:    meta.State,
        Version:  meta.Version,
    })
    if err != nil { return err }

    _ = s.audit.RecordAuthz(ctx, toAuditEvent(p, cmd, meta, decision))

    if !decision.Allow {
        return auth.ErrForbidden
    }

    // Still protect against TOCTOU with conditional update.
    updated, err := s.repo.ApproveIfAllowedState(ctx, ApprovePredicate{
        CaseID:            cmd.CaseID,
        TenantID:          p.TenantID,
        ExpectedState:     "PENDING_REVIEW",
        ExpectedVersion:   meta.Version,
        ActorID:           p.ID,
        SupervisorOverride: decisionHasObligation(decision, "supervisor_override"),
    })
    if err != nil { return err }
    if !updated { return ErrConflictOrForbidden }

    return nil
}
```

---

## 23. Latihan

### Latihan 1 — Threat Record

Ambil endpoint:

```http
GET /api/applications/{applicationID}/documents/{documentID}
```

Buat threat record untuk:

1. applicant melihat document applicant lain,
2. officer melihat document tenant lain,
3. support impersonation membaca document tanpa reason,
4. export endpoint membocorkan semua document.

Untuk tiap threat, tulis:

- asset,
- attacker,
- precondition,
- attack path,
- missing control,
- mitigation,
- audit evidence.

### Latihan 2 — Authorization Boundary

Desain interface Go untuk repository:

```go
FindDocumentByID(ctx, documentID)
```

Ubah supaya tidak mudah dipakai secara insecure.

Pertimbangkan:

- tenant,
- owner,
- actor mode,
- field-level redaction,
- audit decision.

### Latihan 3 — OAuth Callback Threat

Untuk callback:

```http
GET /oauth/callback?code=...&state=...
```

Tuliskan semua validasi yang harus dilakukan sebelum membuat local session.

Minimal mencakup:

- pending auth transaction,
- state,
- provider binding,
- PKCE,
- token exchange,
- ID token validation,
- nonce,
- issuer,
- audience,
- account linking.

### Latihan 4 — Stale Permission Budget

Untuk permission `case.approve`, tentukan:

- apakah boleh embedded di JWT?
- berapa maksimum stale window?
- apakah perlu online PDP check?
- bagaimana revoke role supervisor?
- bagaimana memastikan approval lama tidak lolos saat role baru saja dicabut?

---

## 24. Ringkasan

Threat model auth system harus dimulai dari aset dan authority flow, bukan dari endpoint checklist.

Poin utama:

1. Auth system adalah security control plane.
2. Authentication valid tidak berarti authorization valid.
3. Token valid secara signature belum tentu valid secara semantik.
4. Scope bukan object-level permission.
5. UUID bukan authorization.
6. Gateway auth bukan pengganti service-level authorization.
7. Tenant boundary harus enforced di authorization dan data access.
8. Recovery/admin/break-glass sering lebih berbahaya daripada login normal.
9. Audit harus merekam actor, subject, action, resource, decision, reason, dan policy version.
10. Threat model harus berubah menjadi shape kode: typed principal, explicit decision, scoped repository, deny-by-default, audit-first design.

Mental model akhir:

```text
Every auth bug is an authority confusion bug until proven otherwise.
```

Jika kamu bisa menjelaskan:

- authority berasal dari mana,
- dibawa oleh apa,
- ditafsirkan oleh siapa,
- berlaku untuk resource apa,
- dalam konteks apa,
- kapan expire/revoke,
- bagaimana diaudit,

maka kamu sudah berpikir di level desain auth yang jauh lebih matang daripada sekadar memasang middleware login.

---

## 25. Referensi Primer

Referensi ini digunakan sebagai baseline faktual untuk part ini dan part berikutnya:

1. Go 1.26 Release Notes — https://go.dev/doc/go1.26
2. RFC 9700 — Best Current Practice for OAuth 2.0 Security — https://datatracker.ietf.org/doc/rfc9700/
3. OpenID Connect Core 1.0 — https://openid.net/specs/openid-connect-core-1_0.html
4. NIST SP 800-63-4 Digital Identity Guidelines — https://pages.nist.gov/800-63-4/
5. NIST SP 800-63C-4 Federation and Assertions — https://csrc.nist.gov/pubs/sp/800/63/c/4/final
6. OWASP ASVS — https://owasp.org/www-project-application-security-verification-standard/
7. OWASP API Security Top 10 2023 — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
8. OWASP API1:2023 Broken Object Level Authorization — https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
9. OWASP API2:2023 Broken Authentication — https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/
10. OWASP Threat Modeling Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
11. OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
12. CWE-284 Improper Access Control — https://cwe.mitre.org/data/definitions/284.html
13. CWE-306 Missing Authentication for Critical Function — https://cwe.mitre.org/data/definitions/306.html
14. CWE-862 Missing Authorization — https://cwe.mitre.org/data/definitions/862.html
15. Microsoft Secure by Design / Threat Modeling — https://www.microsoft.com/en-us/securityengineering/sdl/practices/secure-by-design

---

## Status Seri

Part ini adalah **Part 002** dari maksimal 35 part.

Seri **belum selesai**.

Lanjut berikutnya:

```text
learn-go-authentication-authorization-identity-permission-part-003.md
```

Topik berikutnya:

```text
Identity Domain Model: User, Principal, Subject, Actor, Account, Tenant
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-authentication-authorization-identity-permission-part-001.md">⬅️ Part 001 — Mental Model: Identity, Authentication, Authorization, Permission</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-authentication-authorization-identity-permission-part-003.md">Part 003 — Identity Domain Model: User, Principal, Subject, Actor, Account, Tenant ➡️</a>
</div>
