# Learn Java Authorization Modes and Patterns — Part 24

## Token Scopes, Claims, and Authorization Boundaries

> Seri: `learn-java-authorization-modes-and-patterns`  
> Part: `024`  
> Topik: Token scopes, claims, JWT access token, audience, resource indicators, token exchange, on-behalf-of, claim-to-authority mapping, stale claim risk, authorization boundary design  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Principal Engineer  

---

## 0. Tujuan Bagian Ini

Bagian ini membahas salah satu sumber kebingungan terbesar dalam sistem authorization modern:

> **Apakah scope/claim di token sudah cukup untuk menentukan authorization?**

Jawaban top-level-nya:

> **Token adalah evidence. Token bukan policy lengkap.**

Token bisa memberi informasi bahwa:

- subject berhasil diautentikasi,
- token diterbitkan oleh issuer tertentu,
- token belum expired,
- token ditujukan untuk audience tertentu,
- client diberi scope tertentu,
- subject membawa claim tertentu,
- token merepresentasikan user, client, atau delegasi,
- authorization server menyatakan beberapa fakta pada waktu token diterbitkan.

Tetapi token tidak otomatis menjawab seluruh pertanyaan authorization seperti:

- apakah user boleh membaca case tertentu?
- apakah user masih assigned ke case itu sekarang?
- apakah case sudah berpindah state?
- apakah role user baru saja dicabut?
- apakah user sedang acting on behalf of orang lain?
- apakah tenant/resource cocok dengan organisasi user?
- apakah aksi ini membutuhkan step-up authentication?
- apakah resource sedang locked?
- apakah user boleh export data, bukan hanya view data?
- apakah permission berlaku untuk channel internet, intranet, batch, atau support?

Maka mental model yang benar:

```text
Token validation answers:
  "Is this token structurally valid, trusted, not expired, and intended for me?"

Authorization answers:
  "Given the trusted evidence, current policy, current resource state,
   current subject entitlement, and current context, is this action allowed?"
```

Bagian ini tidak akan mengulang detail authentication flow seperti authorization code flow, PKCE, login, session, atau Keycloak identity brokering. Fokusnya adalah **bagaimana token dipakai sebagai input authorization tanpa membuat boundary authorization bocor**.

---

## 1. Problem Besar: Token Terlihat Seperti Authorization, Padahal Sering Hanya Evidence

Dalam banyak Java microservice, authorization dimulai dengan pola seperti ini:

```java
@PreAuthorize("hasAuthority('SCOPE_case.read')")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable String id) {
    return caseService.getCase(id);
}
```

Secara surface terlihat benar:

- endpoint butuh scope `case.read`,
- Spring Security membaca JWT,
- scope dipetakan menjadi authority,
- request tanpa scope ditolak.

Tetapi ini hanya **function-level authorization**. Ia belum menjawab object-level dan context-level authorization.

Pertanyaan yang belum dijawab:

```text
Token says: user has case.read.
But:
- case mana?
- tenant mana?
- agency mana?
- state case apa?
- user assigned atau tidak?
- apakah case confidential?
- apakah user sedang dalam delegated capacity?
- apakah user boleh melihat attachment case juga?
- apakah search/export juga memakai rule yang sama?
```

Jika jawaban hanya berdasarkan scope, maka sistem rentan terhadap:

- IDOR/BOLA,
- cross-tenant data leakage,
- stale entitlement,
- over-privileged JWT,
- confused deputy,
- token bloat,
- hidden privilege escalation,
- audit gap.

---

## 2. Mental Model: Token Sebagai Envelope of Claims

Token adalah envelope yang membawa claim. Claim adalah pernyataan, bukan kebenaran absolut universal.

Contoh claim JWT:

```json
{
  "iss": "https://idp.example.gov/realms/aceas",
  "sub": "user-123",
  "aud": "case-api",
  "exp": 1770000000,
  "iat": 1769996400,
  "scope": "case.read case.update report.export",
  "azp": "aceas-web",
  "tenant": "CEA",
  "agency": "CEA",
  "roles": ["CASE_OFFICER"],
  "amr": ["pwd", "otp"]
}
```

Engineer yang kurang matang sering membaca ini sebagai:

```text
User is allowed to read cases, update cases, export reports.
```

Engineer yang matang membaca sebagai:

```text
An issuer I trust claims that, at token issuance time:
- the subject is user-123,
- the token is intended for case-api,
- the token expires at a specific time,
- the client/application was aceas-web,
- the token contains coarse scopes,
- the token includes some subject/context claims.

Now my resource server must validate the token and run local/domain authorization.
```

Perbedaannya besar.

Token claim harus selalu ditafsirkan dengan pertanyaan:

1. **Who issued this claim?**
2. **For whom is this token intended?**
3. **When was this claim produced?**
4. **How fresh must this claim be?**
5. **Is this claim authoritative for this decision?**
6. **Is this claim enough, or do I need current data?**
7. **Can this claim be safely cached or embedded?**
8. **Does this claim describe subject, client, delegation, or resource?**

---

## 3. Scope vs Permission vs Role vs Claim

Istilah ini sering tercampur. Untuk sistem besar, kita perlu pisahkan.

### 3.1 Scope

Scope adalah string yang biasanya diberikan kepada client/token untuk membatasi akses terhadap protected resource.

Contoh:

```text
case.read
case.write
report.export
profile.read
openid
email
```

Dalam OAuth, scope sering digunakan untuk menyatakan ruang akses yang diminta/diberikan kepada client. Scope biasanya coarse-grained dan cocok untuk boundary API atau capability level.

Scope menjawab:

```text
Token ini boleh mencoba akses capability umum apa?
```

Scope tidak cukup untuk menjawab:

```text
User ini boleh membaca object instance X atau tidak?
```

### 3.2 Permission

Permission adalah hak internal yang lebih dekat dengan domain authorization.

Contoh:

```text
CASE_VIEW_ASSIGNED
CASE_VIEW_AGENCY
CASE_UPDATE_DRAFT
CASE_APPROVE_PENDING_REVIEW
CASE_EXPORT_CONFIDENTIAL
APPEAL_REOPEN_AFTER_DEADLINE
```

Permission menjawab:

```text
Subject punya hak domain apa dalam sistem ini?
```

Permission bisa berasal dari:

- role,
- delegation,
- relationship,
- assignment,
- organization hierarchy,
- workflow state,
- policy engine,
- manual grant,
- temporary grant.

### 3.3 Role

Role adalah grouping hak atau responsibility.

Contoh:

```text
CASE_OFFICER
CASE_REVIEWER
SUPERVISOR
AGENCY_ADMIN
SYSTEM_OPERATOR
```

Role menjawab:

```text
Subject menjalankan fungsi organisasi apa?
```

Role bukan izin final. Role harus diterjemahkan menjadi permission dalam scope tertentu.

Bad:

```java
if (user.hasRole("SUPERVISOR")) {
    approve(caseId);
}
```

Better:

```java
AuthorizationDecision decision = authorizationService.authorize(
    subject,
    Action.CASE_APPROVE,
    ResourceRef.caseId(caseId),
    context
);
```

### 3.4 Claim

Claim adalah pernyataan dalam token atau identity document.

Contoh:

```text
sub=user-123
email=fajar@example.com
agency=CEA
amr=[pwd,otp]
scope=case.read
azp=aceas-web
```

Claim menjawab:

```text
Issuer menyatakan fakta ini tentang subject/client/token/context.
```

Claim bukan selalu permission. Claim juga bukan selalu trusted untuk semua use case.

### 3.5 Authority di Spring Security

Dalam Spring Security, `GrantedAuthority` adalah representasi internal authority pada `Authentication`.

Contoh dari JWT resource server:

```text
scope case.read  -> authority SCOPE_case.read
scope report.export -> authority SCOPE_report.export
```

Authority adalah format internal enforcement framework. Jangan salah menganggap `GrantedAuthority` selalu sama dengan permission domain.

```text
OAuth scope -> Spring GrantedAuthority -> may be input to policy
```

Bukan:

```text
OAuth scope == domain permission == final authorization
```

---

## 4. Decision Boundary: Apa yang Boleh Diputuskan oleh Token?

Token bisa cukup untuk beberapa jenis decision yang coarse-grained.

Contoh decision yang relatif aman berbasis token saja:

```text
- Apakah request membawa token valid?
- Apakah token intended untuk API ini?
- Apakah token punya scope untuk memanggil endpoint group ini?
- Apakah token berasal dari issuer yang dipercaya?
- Apakah client aplikasi yang memanggil termasuk allowed client?
```

Tetapi token biasanya tidak cukup untuk decision seperti:

```text
- Apakah user boleh membaca case id 123?
- Apakah user boleh approve case yang dia buat sendiri?
- Apakah user boleh melihat document confidential?
- Apakah user boleh export data dari tenant lain?
- Apakah permission user sudah dicabut 2 menit lalu?
- Apakah case sedang locked oleh officer lain?
- Apakah user boleh menjalankan transition dari DRAFT ke SUBMITTED?
```

Rule praktis:

```text
Token-level authorization:
  coarse-grained, request/API boundary, low object sensitivity.

Domain authorization:
  object-level, stateful, tenant-aware, workflow-aware, audit-sensitive.
```

---

## 5. Token Validation Bukan Authorization Domain

Sebelum token dipakai sebagai evidence, resource server harus melakukan validation.

Minimal validation:

1. signature valid,
2. issuer trusted,
3. audience cocok,
4. token belum expired,
5. `nbf` belum melanggar,
6. algorithm sesuai policy,
7. key id valid,
8. token type sesuai,
9. token bukan dari environment/realm yang salah,
10. client/application allowed untuk API ini jika relevan.

Dalam Spring Security resource server, JWT biasanya divalidasi terhadap JWK set, expiration/not-before, dan issuer, lalu scope dipetakan menjadi authority dengan prefix `SCOPE_` secara default.

Tetapi setelah validasi selesai, authorization domain masih harus berjalan.

```text
Validated token = trusted input.
Trusted input != final permission.
```

---

## 6. JWT Access Token: Useful, Dangerous, and Often Overloaded

JWT access token populer karena self-contained.

Kelebihan:

- resource server bisa validate tanpa introspection call,
- latency rendah,
- cocok untuk microservice,
- mudah membawa issuer/audience/scope/subject,
- key rotation bisa via JWK set,
- interoperable jika mengikuti profile.

Bahaya:

- stale claim,
- token bloat,
- claim overloading,
- sulit revoke sebelum expiry,
- terlalu banyak domain permission di token,
- token bocor berarti banyak informasi bocor,
- service terlalu percaya token tanpa local policy,
- permission berubah tapi token lama masih valid.

JWT access token harus diperlakukan sebagai:

```text
portable authorization evidence with bounded lifetime
```

Bukan:

```text
portable database of all user permissions
```

### 6.1 Kapan JWT Cocok?

JWT cocok jika:

- keputusan coarse-grained,
- claim relatif stabil selama token lifetime,
- token lifetime pendek,
- audience jelas,
- scope tidak terlalu banyak,
- resource server punya local policy untuk fine-grained decision.

### 6.2 Kapan JWT Berbahaya?

JWT berbahaya jika:

- berisi semua permission per object,
- berisi tenant/resource list besar,
- token lifetime panjang,
- revoke harus immediate,
- authorization bergantung pada state resource yang sering berubah,
- claim mengandung data sensitif berlebihan,
- banyak service menerima token dengan audience terlalu luas.

---

## 7. Scope Design: Jangan Jadikan Scope Sebagai Dumping Ground

Scope yang buruk:

```text
admin
user
read
write
case
all
```

Masalah:

- ambigu,
- tidak menyebut resource,
- terlalu luas,
- tidak bisa diaudit,
- rawan disalahgunakan antar service.

Scope yang lebih baik:

```text
case.read
case.update
case.submit
case.approve
case.assign
report.view
report.export
profile.read
notification.send
```

Tetapi scope tetap sebaiknya tidak terlalu domain-instance-specific.

Hindari:

```text
case.123.read
case.124.read
case.125.read
```

Karena:

- token membengkak,
- revocation sulit,
- resource assignment berubah,
- token harus diterbitkan ulang terlalu sering,
- authorization berpindah ke token issuance time.

### 7.1 Scope Grammar

Gunakan grammar eksplisit:

```text
<resource-family>.<capability>
```

Contoh:

```text
case.read
case.search
case.create
case.update
case.transition
case.approve
case.assign
case.export
case.document.download
report.generate
report.export
admin.user.manage
```

Untuk service-to-service:

```text
case-api.case.read
case-api.case.update
notification-api.email.send
report-api.report.generate
```

Namun hati-hati: scope terlalu service-specific bisa mempersulit reuse. Scope terlalu generic bisa memperlebar blast radius.

### 7.2 Scope Harus Menggambarkan Capability, Bukan UI Menu

Bad:

```text
menu.case-management
button.approve.visible
page.admin.visible
```

Better:

```text
case.read
case.approve
user.manage
```

UI boleh memakai permission untuk visibility, tetapi enforcement harus tetap backend/domain.

### 7.3 Scope Tidak Sama Dengan CRUD

CRUD sering terlalu miskin.

Bad:

```text
case.create
case.read
case.update
case.delete
```

Dalam sistem enterprise, operasi domain lebih kaya:

```text
case.submit
case.withdraw
case.assign
case.reassign
case.approve
case.reject
case.return-for-clarification
case.reopen
case.escalate
case.close
case.archive
```

Authorization harus mengikuti command domain, bukan sekadar method HTTP.

---

## 8. Claim Design: Claim Harus Punya Source of Truth dan Trust Boundary

Claim tidak boleh asal dimasukkan.

Untuk setiap claim, tanyakan:

```text
- Siapa source of truth claim ini?
- Apakah issuer token authoritative untuk claim ini?
- Seberapa sering claim berubah?
- Apakah claim boleh stale selama token lifetime?
- Apakah claim sensitif?
- Apakah claim dipakai untuk allow decision atau hanya logging/UI?
- Apakah claim bisa dipalsukan oleh client?
- Apakah claim berasal dari user profile, directory, entitlement system, atau runtime context?
```

Contoh claim dan risikonya:

| Claim | Kegunaan | Risiko |
|---|---|---|
| `sub` | subject identity | stable identifier harus benar, jangan pakai email sebagai primary key |
| `email` | display/contact | bisa berubah, tidak cocok sebagai authorization key |
| `agency` | tenant/org hint | stale jika user pindah agency |
| `roles` | coarse role evidence | stale jika role dicabut |
| `scope` | API capability | sering terlalu coarse |
| `amr` | authentication method | perlu dipakai untuk step-up, tapi jangan jadi role |
| `azp` | authorized party/client | penting untuk client boundary |
| `aud` | intended resource | wajib untuk mencegah token reuse ke API lain |
| `exp` | expiry | bukan revocation guarantee |
| `jti` | token id | bisa untuk denylist/introspection/audit |

---

## 9. Audience Boundary: Token Harus Ditujukan Untuk Resource yang Benar

`aud` adalah salah satu boundary paling penting.

Jika token untuk `profile-api` diterima oleh `case-api`, maka attacker atau client buggy bisa memakai token di resource yang salah.

Bad:

```json
{
  "aud": "all-services"
}
```

Better:

```json
{
  "aud": "case-api"
}
```

Atau multiple audience yang dikontrol ketat:

```json
{
  "aud": ["case-api", "document-api"]
}
```

Tetapi multiple audience memperbesar risiko. Jika token diterima oleh banyak service, setiap service harus memahami claim dengan cara yang sama. Ini jarang benar.

### 9.1 Audience Confusion

Audience confusion terjadi ketika service menerima token yang tidak ditujukan untuknya.

Contoh:

```text
User obtains token for low-risk API.
Same token accepted by high-risk API.
High-risk API only checks signature and scope, not audience.
Access granted incorrectly.
```

Defense:

- resource server wajib validate `aud`,
- setiap API punya expected audience,
- jangan pakai audience terlalu generic,
- jangan hanya validate issuer/signature,
- test negative case token audience salah.

---

## 10. Resource Indicators: Meminta Token Untuk Resource Tertentu

OAuth Resource Indicators memungkinkan client memberi sinyal resource yang ingin diakses saat meminta token. Ini membantu authorization server menerbitkan token yang audience/resource-nya lebih tepat.

Mental model:

```text
Without resource indicator:
  client asks for scope, token may be too broad.

With resource indicator:
  client asks for scope for a specific protected resource.
```

Contoh konseptual:

```http
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=...&
resource=https://api.example.gov/case-api&
scope=case.read
```

Authorization server bisa menerbitkan token dengan audience/resource yang lebih sempit.

Manfaat:

- mengurangi token reuse antar API,
- memperjelas intended resource,
- mendukung least privilege,
- membantu microservice boundary.

Caveat:

- tidak semua IdP mendukung penuh,
- resource server tetap harus validate audience,
- resource indicator bukan pengganti object-level authorization.

---

## 11. Token Exchange: Delegation, Impersonation, and Downstream Narrowing

Dalam microservices, service A sering perlu memanggil service B atas nama user.

Bad pattern:

```text
Frontend sends user token to Service A.
Service A forwards the same user token to Service B, C, D, E.
All services accept same token.
```

Risiko:

- audience terlalu luas,
- downstream tidak tahu chain delegation,
- scope tidak dinarrow,
- confused deputy,
- token leakage blast radius besar,
- sulit audit siapa bertindak untuk siapa.

Better pattern:

```text
Service A exchanges incoming token for a downstream token:
- intended for Service B,
- narrower scope,
- includes actor/delegation context,
- shorter lifetime.
```

Token exchange memungkinkan issuance token baru berdasarkan token yang ada. Spesifikasi OAuth Token Exchange mendukung skenario impersonation dan delegation.

### 11.1 Delegation vs Impersonation

Delegation:

```text
Service A acts with authority delegated from user.
Audit should show both user and service.
```

Impersonation:

```text
Actor acts as another subject.
Audit must be extremely explicit.
```

Dalam sistem enterprise/regulatory, delegation lebih aman dan lebih defensible daripada impersonation silent.

### 11.2 Downstream Narrowing

Jika Service A butuh call Document API hanya untuk download metadata, jangan kirim token dengan semua scope user.

Better:

```text
Incoming token:
  aud=case-api
  scope=case.read case.update case.approve report.export

Exchanged downstream token:
  aud=document-api
  scope=document.metadata.read
  act=case-api
  sub=user-123
  exp=short
```

Authorization downstream menjadi lebih sempit.

---

## 12. User Token vs Client Token vs Workload Identity

Token bisa merepresentasikan beberapa jenis authority.

### 12.1 User Token

User token merepresentasikan user/caller manusia.

```text
sub=user-123
client=aceas-web
scope=case.read
```

Cocok untuk:

- user-driven operation,
- audit by user,
- domain authorization berbasis assignment/role.

### 12.2 Client Token / Client Credentials

Client token merepresentasikan aplikasi/service, bukan user.

```text
sub=service-report-generator
client_id=report-worker
scope=report.generate
```

Cocok untuk:

- scheduled job,
- system integration,
- backend-to-backend call,
- daemon process.

Bahaya:

- service token sering terlalu powerful,
- tidak ada user context,
- audit harus membedakan system action vs user action,
- jangan pakai service token untuk bypass domain rule tanpa explicit system policy.

### 12.3 Workload Identity

Di platform cloud/Kubernetes, workload identity mengikat identity ke workload/service account.

Authorization domain tetap perlu menjawab:

```text
Service ini boleh melakukan action apa?
Apakah action ini system action atau on-behalf-of user?
Apakah service account ini hanya boleh akses tenant tertentu?
```

---

## 13. On-Behalf-Of Pattern

On-behalf-of berarti downstream call tetap membawa hubungan dengan original user, tetapi tidak memakai token asli secara sembarangan.

Flow konseptual:

```text
1. User calls Case API with user token.
2. Case API validates token.
3. Case API authorizes user for high-level action.
4. Case API requests downstream token for Document API.
5. Token includes:
   - subject user,
   - actor service,
   - intended audience document-api,
   - narrowed scope,
   - short lifetime.
6. Document API validates token and enforces its own policy.
```

Audit harus bisa mencatat:

```text
Original user: user-123
Calling service: case-api
Downstream service: document-api
Action: document.metadata.read
Resource: document-789
Reason: case-api retrieving metadata for case view
```

---

## 14. The Confused Deputy Problem

Confused deputy terjadi ketika service yang punya authority lebih besar disalahgunakan oleh caller untuk melakukan sesuatu yang caller sendiri tidak boleh lakukan.

Contoh:

```text
User cannot read Document D.
User can call Case API endpoint.
Case API has broad document-api token.
Case API uses its own broad token to fetch Document D without checking user's right.
User indirectly gets Document D.
```

Service menjadi deputy yang tertipu.

Defense:

1. authorize user at service boundary,
2. propagate user/delegation context downstream,
3. narrow downstream token,
4. downstream service also enforces object authorization,
5. avoid god service token,
6. audit actor + subject + resource.

Rule:

```text
A service's technical ability to call another service is not equal to user's business permission.
```

---

## 15. Stale Claims and Revocation Delay

JWT adalah snapshot. Claim di dalamnya bisa stale.

Contoh:

```text
09:00 token issued with role=SUPERVISOR
09:05 supervisor role revoked
09:10 user calls approve endpoint with old token
09:10 token still valid until 09:30
```

Jika API hanya percaya token role, user masih bisa approve.

Mitigasi:

| Strategy | Kelebihan | Kekurangan |
|---|---|---|
| Short token lifetime | sederhana | user/client perlu refresh sering |
| Token introspection | revocation lebih cepat | network call, availability dependency |
| Entitlement lookup | current permission | latency, cache complexity |
| Revocation list by `jti` | targeted revoke | storage/cache, propagation |
| Policy version claim | detect stale policy | perlu compare server-side |
| Session version/user version | revoke semua token lama | perlu store current version |
| Step-up/current check for sensitive action | aman untuk high-risk | UX dan complexity |

Top-level rule:

```text
The more sensitive the action, the less you should rely only on stale token claims.
```

Untuk action seperti `case.approve`, `report.export`, `break-glass`, `user.manage`, gunakan current entitlement/resource check.

---

## 16. Token Lifetime Design

Token lifetime adalah trade-off antara security, performance, UX, dan availability.

### 16.1 Long-lived Access Token

Kelebihan:

- sedikit refresh,
- sederhana,
- cocok untuk low-risk environment.

Kekurangan:

- stale permission lama,
- revocation lambat,
- leakage impact besar.

### 16.2 Short-lived Access Token

Kelebihan:

- stale window kecil,
- leakage impact lebih rendah,
- lebih cocok untuk high-risk system.

Kekurangan:

- refresh lebih sering,
- lebih banyak load ke IdP,
- refresh failure berdampak UX.

### 16.3 Sensitive Action Recheck

Untuk aksi sensitif, jangan hanya bergantung pada token lifetime.

Contoh:

```java
public void approveCase(Subject subject, CaseId caseId) {
    authorizationService.require(
        subject,
        Action.CASE_APPROVE,
        ResourceRef.caseId(caseId),
        AuthorizationContext.sensitiveAction()
    );

    caseWorkflow.approve(caseId, subject.id());
}
```

Authorization service bisa melakukan:

- current role lookup,
- current assignment lookup,
- SoD check,
- state check,
- step-up freshness check,
- tenant boundary check.

---

## 17. Claim-to-Authority Mapping in Spring Security

Spring Security resource server secara default memetakan scope JWT menjadi authority dengan prefix `SCOPE_`.

Contoh:

```json
{
  "scope": "case.read report.export"
}
```

Menjadi:

```text
SCOPE_case.read
SCOPE_report.export
```

Lalu bisa dipakai:

```java
.requestMatchers(HttpMethod.GET, "/api/cases/**")
.hasAuthority("SCOPE_case.read")
```

Ini berguna untuk coarse route-level authorization.

Tetapi domain check tetap harus eksplisit.

```java
@GetMapping("/api/cases/{caseId}")
public CaseDto getCase(@AuthenticationPrincipal Jwt jwt,
                       @PathVariable String caseId) {
    Subject subject = subjectFactory.from(jwt);
    return caseApplicationService.getCase(subject, CaseId.of(caseId));
}
```

```java
public CaseDto getCase(Subject subject, CaseId caseId) {
    CaseRecord record = caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);

    authorizationService.require(
        subject,
        Action.CASE_READ,
        Resource.caseRecord(record),
        AuthorizationContext.current()
    );

    return mapper.toDto(record);
}
```

### 17.1 Custom Converter

Sering kali claim tidak standar:

```json
{
  "realm_access": {
    "roles": ["case-officer", "supervisor"]
  },
  "resource_access": {
    "aceas-api": {
      "roles": ["case-read", "case-approve"]
    }
  }
}
```

Spring bisa memakai custom `JwtAuthenticationConverter`.

```java
@Bean
JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
    scopes.setAuthorityPrefix("SCOPE_");
    scopes.setAuthoritiesClaimName("scope");

    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(jwt -> {
        Collection<GrantedAuthority> result = new ArrayList<>(scopes.convert(jwt));

        Map<String, Object> realmAccess = jwt.getClaim("realm_access");
        if (realmAccess != null) {
            Object roles = realmAccess.get("roles");
            if (roles instanceof Collection<?>) {
                for (Object role : (Collection<?>) roles) {
                    result.add(new SimpleGrantedAuthority("ROLE_" + role.toString().toUpperCase(Locale.ROOT)));
                }
            }
        }

        return result;
    });
    return converter;
}
```

But beware:

```text
Mapping claim to authority is not the same as proving domain authorization.
```

Gunakan authority untuk:

- route gate,
- feature group,
- coarse API access,
- early rejection.

Gunakan domain authorization untuk:

- object ownership,
- tenant boundary,
- workflow transition,
- SoD,
- delegation,
- resource state,
- export/report/download.

---

## 18. Token Claim Mapping Anti-Patterns

### 18.1 Treating Email as Stable Subject

Bad:

```java
String userId = jwt.getClaimAsString("email");
```

Email bisa berubah, bisa reused, dan bukan stable identifier.

Better:

```java
String subjectId = jwt.getSubject();
```

Lalu map ke internal user record.

### 18.2 Trusting Client-Provided Tenant

Bad:

```java
String tenant = request.getHeader("X-Tenant-Id");
```

Better:

```java
TenantId tenant = tenantResolver.resolveFromTrustedContext(jwt, authenticatedSession, serverSideMembership);
```

Jika header tenant dipakai untuk memilih active tenant, tetap validasi membership server-side.

### 18.3 Putting All Roles in JWT

Bad:

```json
{
  "roles": [
    "ROLE_1", "ROLE_2", "ROLE_3", "ROLE_4", "ROLE_5",
    "ROLE_... many more"
  ]
}
```

Risiko:

- token bloat,
- stale role,
- IdP menjadi entitlement DB,
- sulit revoke,
- token leaking reveals org structure.

Better:

```text
Token contains stable subject + coarse scope.
Resource server resolves current entitlements for sensitive decisions.
```

### 18.4 Putting Object IDs in JWT

Bad:

```json
{
  "allowed_cases": ["C1", "C2", "C3", "..."]
}
```

Biasanya buruk karena object assignment berubah cepat dan list bisa besar.

Better:

```text
Use query scoping / relationship lookup / assignment table / policy engine.
```

### 18.5 Accepting Any Issuer from Config Accidentally

Bad:

```text
All non-prod and prod issuers accepted by same service.
```

Better:

```text
Each environment validates exactly expected issuer and audience.
```

---

## 19. Scope Narrowing and Least Privilege

Scope harus mengikuti least privilege.

Bad:

```text
All users get api.full_access.
All services accept api.full_access.
```

Better:

```text
Frontend token:
  aud=case-api
  scope=case.read case.submit

Case API downstream token to Document API:
  aud=document-api
  scope=document.metadata.read

Batch worker token:
  aud=report-api
  scope=report.generate
```

### 19.1 Scope Per Channel

Kadang aksi sama harus dibedakan per channel.

Contoh:

```text
case.read.internet
case.read.intranet
case.read.support
case.read.batch
```

Namun jangan terlalu cepat memecah scope berdasarkan channel jika context-based policy sudah cukup.

Alternative:

```text
scope=case.read
context.channel=internet
policy denies confidential fields on internet channel
```

Decision:

- jika channel adalah API boundary besar: scope bisa dipisah,
- jika channel adalah condition domain: policy context lebih baik.

---

## 20. Consent-Based Authorization vs Enterprise Authorization

Dalam consumer OAuth, scope sering berhubungan dengan consent:

```text
This app wants to read your profile and email.
```

Dalam enterprise internal system, scope lebih sering berarti capability granted by admin/policy.

Perbedaan:

| Aspect | Consent-style OAuth | Enterprise Authorization |
|---|---|---|
| Grant basis | user consent | role/policy/org/workflow |
| Scope meaning | client access to user data | capability boundary |
| Decision time | token issuance + resource server | resource server/domain policy |
| Revocation | user revoke app consent | admin revoke role/assignment/delegation |
| Object check | often resource-specific API | strong domain object enforcement |

Jangan membawa mental model consumer OAuth mentah-mentah ke regulatory enterprise system.

---

## 21. Token as Coarse Gate, Policy as Final Decision

Pola yang disarankan:

```text
1. Validate token.
2. Coarse API gate by audience/scope/client.
3. Build internal Subject from trusted claims.
4. Resolve current subject entitlements if needed.
5. Load resource or scoped projection.
6. Run domain authorization.
7. Enforce obligations.
8. Audit decision.
```

Contoh request:

```text
GET /api/cases/C-123
Authorization: Bearer <jwt>
```

Flow:

```text
JWT validation:
  issuer OK
  signature OK
  exp OK
  aud=case-api OK

Route gate:
  scope contains case.read OK

Domain authorization:
  subject user-123
  resource case C-123
  tenant CEA
  case agency CEA
  case state UNDER_REVIEW
  user assigned true
  confidentiality NORMAL
  decision ALLOW
```

Jika user punya scope `case.read` tapi tidak assigned ke case:

```text
JWT valid: yes
Route gate: yes
Domain authorization: deny
HTTP: 404 or 403 depending leakage policy
Audit: DENY_CASE_NOT_ASSIGNED
```

---

## 22. Mapping External Token to Internal Subject

Jangan biarkan seluruh aplikasi membaca `Jwt` mentah di mana-mana.

Bad:

```java
public boolean canRead(Jwt jwt, CaseRecord record) {
    String agency = jwt.getClaimAsString("agency");
    return agency.equals(record.agency());
}
```

Masalah:

- claim parsing tersebar,
- sulit mengganti IdP,
- sulit audit source/trust,
- sulit test,
- raw JWT menjadi dependency domain.

Better:

```java
public final class Subject {
    private final SubjectId id;
    private final ClientId clientId;
    private final Set<Scope> scopes;
    private final Optional<TenantId> activeTenant;
    private final AuthenticationAssurance assurance;
    private final TokenMetadata tokenMetadata;

    // constructor/getters omitted
}
```

```java
public interface SubjectFactory {
    Subject fromJwt(Jwt jwt);
}
```

Domain layer menerima `Subject`, bukan `Jwt`.

```java
authorizationService.authorize(subject, Action.CASE_READ, resource, context);
```

Manfaat:

- boundary jelas,
- testing mudah,
- IdP-specific mapping isolated,
- internal model stabil,
- authorization tidak bergantung pada claim names eksternal.

---

## 23. Internal Permission Resolution from Token Evidence

Token evidence bisa menjadi input untuk resolving permission.

Contoh:

```text
Token:
  sub=user-123
  scope=case.read case.update
  client=aceas-web

Internal lookup:
  user-123 has role CASE_OFFICER in agency CEA
  user-123 assigned to case C-123
  case C-123 state=DRAFT

Policy result:
  allow CASE_UPDATE_DRAFT
```

Dalam Java:

```java
public AuthorizationDecision authorize(
    Subject subject,
    Action action,
    ResourceRef resourceRef,
    AuthorizationContext context
) {
    if (!subject.hasScope(action.requiredScope())) {
        return AuthorizationDecision.deny("MISSING_SCOPE");
    }

    ResourceSnapshot resource = resourceLoader.load(resourceRef);
    EntitlementSnapshot entitlements = entitlementResolver.resolve(subject.id(), context);

    return policy.evaluate(subject, entitlements, action, resource, context);
}
```

Penting:

```text
Scope can be necessary but not sufficient.
```

---

## 24. Token Bloat and Authorization Data Placement

Pertanyaan design:

> Data authorization apa yang masuk token, apa yang tetap server-side?

### 24.1 Cocok Masuk Token

Biasanya cocok:

- `sub`,
- `iss`,
- `aud`,
- `exp`,
- `iat`,
- coarse `scope`,
- client id / authorized party,
- authentication method reference,
- tenant hint jika stabil dan tidak sensitif,
- session id / token id untuk audit/revocation.

### 24.2 Tidak Cocok Masuk Token

Biasanya tidak cocok:

- ribuan permission,
- object IDs,
- dynamic assignment list,
- confidential resource metadata,
- frequently changing role,
- temporary emergency privilege tanpa short expiry,
- large org hierarchy,
- policy decision final untuk banyak resource.

### 24.3 Decision Matrix

| Data | Put in token? | Reason |
|---|---:|---|
| Subject ID | Yes | stable identity reference |
| Email | Maybe | display only, not auth key |
| Coarse scope | Yes | API gate |
| All effective permissions | Usually no | bloat + stale |
| Tenant hint | Maybe | must validate server-side |
| Object assignment | Usually no | dynamic + large |
| Current case state | No | resource-side data |
| Step-up method | Yes | useful context, still check freshness |
| Delegation actor | Yes if delegated token | audit-critical |
| Break-glass flag | Only very carefully | should be short-lived and auditable |

---

## 25. Service-to-Service Authorization Boundary

Service-to-service authorization sering disalahpahami.

Ada dua authorization berbeda:

```text
1. Is Service A allowed to call Service B?
2. Is this user/action/resource allowed through Service B?
```

Keduanya perlu dipisahkan.

Contoh:

```text
Case API is allowed to call Document API.
But that does not mean every user through Case API can read every document.
```

### 25.1 Workload Permission

```text
case-api -> document-api: document.metadata.read
report-worker -> case-api: case.read-for-report
notification-worker -> user-api: user.contact.read
```

### 25.2 User Delegated Permission

```text
user-123 on behalf of web-client through case-api wants document D
```

Downstream service should know enough to enforce:

- workload is trusted,
- token audience matches,
- scope narrowed,
- user/delegation context present if needed,
- resource belongs to allowed case/tenant,
- action is allowed.

---

## 26. Token Introspection vs JWT Local Validation

Two common strategies:

### 26.1 Local JWT Validation

Resource server validates JWT locally.

Pros:

- fast,
- resilient to IdP outage after key cached,
- scalable,
- simple for microservices.

Cons:

- stale until expiry,
- revocation not immediate,
- claim changes not immediate,
- requires key rotation correctness.

### 26.2 Token Introspection

Resource server calls authorization server/introspection endpoint to ask token status/metadata.

Pros:

- can reflect revocation,
- central control,
- opaque token support,
- less data in token.

Cons:

- network latency,
- IdP dependency,
- availability/circuit breaker needed,
- scaling and caching complexity.

### 26.3 Hybrid

Common high-grade approach:

```text
- local JWT validation for most requests,
- short token lifetime,
- current entitlement lookup for sensitive actions,
- revocation/session version for high-risk cases,
- introspection for special clients or opaque tokens.
```

---

## 27. Java 8–25 Implementation Considerations

Authorization token handling can be version-neutral, but Java version affects implementation style.

### 27.1 Java 8

Use:

- final classes,
- immutable objects manually,
- `Optional` carefully,
- explicit builders,
- servlet filters/interceptors,
- thread-local security context with caution.

Example:

```java
public final class TokenMetadata {
    private final String issuer;
    private final Set<String> audience;
    private final Instant issuedAt;
    private final Instant expiresAt;
    private final String tokenId;

    public TokenMetadata(String issuer,
                         Set<String> audience,
                         Instant issuedAt,
                         Instant expiresAt,
                         String tokenId) {
        this.issuer = Objects.requireNonNull(issuer);
        this.audience = Collections.unmodifiableSet(new LinkedHashSet<>(audience));
        this.issuedAt = Objects.requireNonNull(issuedAt);
        this.expiresAt = Objects.requireNonNull(expiresAt);
        this.tokenId = tokenId;
    }

    public String issuer() { return issuer; }
    public Set<String> audience() { return audience; }
    public Instant issuedAt() { return issuedAt; }
    public Instant expiresAt() { return expiresAt; }
    public String tokenId() { return tokenId; }
}
```

### 27.2 Java 17+

Use records for immutable carrier types.

```java
public record TokenMetadata(
    String issuer,
    Set<String> audience,
    Instant issuedAt,
    Instant expiresAt,
    Optional<String> tokenId
) {
    public TokenMetadata {
        Objects.requireNonNull(issuer);
        audience = Set.copyOf(audience);
        Objects.requireNonNull(issuedAt);
        Objects.requireNonNull(expiresAt);
        Objects.requireNonNull(tokenId);
    }
}
```

### 27.3 Java 21/25

Modern Java can improve:

- virtual-thread-friendly remote PDP/introspection calls,
- structured concurrency for parallel attribute loading,
- records/sealed interfaces for decision model,
- pattern matching for decision handling,
- better observability integration.

But do not let language features hide authorization semantics.

Bad:

```text
Modern syntax but unclear decision boundary.
```

Good:

```text
Clear boundary first, modern syntax second.
```

---

## 28. Design: Subject, TokenEvidence, and AuthorizationContext

A clean internal model separates token data from domain decision.

```java
public final class Subject {
    private final SubjectId id;
    private final ClientId clientId;
    private final Set<Scope> scopes;
    private final TokenEvidence tokenEvidence;
    private final Optional<DelegationContext> delegation;
    private final AuthenticationAssurance assurance;

    // constructors/getters
}
```

```java
public final class TokenEvidence {
    private final Issuer issuer;
    private final Set<Audience> audiences;
    private final Instant issuedAt;
    private final Instant expiresAt;
    private final Optional<TokenId> tokenId;
    private final Map<String, Object> rawTrustedClaims;

    // constructors/getters
}
```

```java
public final class AuthorizationContext {
    private final RequestChannel channel;
    private final Instant decisionTime;
    private final Optional<String> correlationId;
    private final RiskLevel riskLevel;
    private final Map<String, Object> attributes;

    // constructors/getters
}
```

Policy consumes:

```text
Subject + Action + Resource + Context
```

Not raw JWT everywhere.

---

## 29. Example: Good Spring Resource Server Boundary

### 29.1 Security Configuration

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
        http
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt
                .jwtAuthenticationConverter(jwtAuthenticationConverter())
            ))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/cases/**")
                    .hasAuthority("SCOPE_case.read")
                .requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
                    .hasAuthority("SCOPE_case.approve")
                .requestMatchers("/actuator/health")
                    .permitAll()
                .anyRequest()
                    .denyAll()
            );

        return http.build();
    }

    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
        scopes.setAuthorityPrefix("SCOPE_");
        scopes.setAuthoritiesClaimName("scope");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(scopes);
        return converter;
    }
}
```

This config:

- validates token,
- maps scope to authority,
- gates API routes,
- denies unmatched requests.

But it does not replace service-level object authorization.

### 29.2 Controller

```java
@RestController
@RequestMapping("/api/cases")
public class CaseController {
    private final SubjectFactory subjectFactory;
    private final CaseApplicationService caseApplicationService;

    public CaseController(SubjectFactory subjectFactory,
                          CaseApplicationService caseApplicationService) {
        this.subjectFactory = subjectFactory;
        this.caseApplicationService = caseApplicationService;
    }

    @GetMapping("/{caseId}")
    public CaseDto getCase(@AuthenticationPrincipal Jwt jwt,
                           @PathVariable String caseId) {
        Subject subject = subjectFactory.fromJwt(jwt);
        return caseApplicationService.getCase(subject, CaseId.of(caseId));
    }
}
```

### 29.3 Service

```java
@Service
public class CaseApplicationService {
    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final CaseMapper caseMapper;

    public CaseDto getCase(Subject subject, CaseId caseId) {
        CaseRecord record = caseRepository.findById(caseId)
            .orElseThrow(NotFoundException::new);

        AuthorizationDecision decision = authorizationService.authorize(
            subject,
            Action.CASE_READ,
            Resource.caseRecord(record),
            AuthorizationContext.current()
        );

        if (!decision.allowed()) {
            throw AccessDeniedException.fromDecision(decision);
        }

        return caseMapper.toDto(record);
    }
}
```

### 29.4 Authorization Service

```java
public final class DefaultAuthorizationService implements AuthorizationService {
    private final EntitlementResolver entitlementResolver;
    private final CasePolicy casePolicy;

    @Override
    public AuthorizationDecision authorize(Subject subject,
                                           Action action,
                                           Resource resource,
                                           AuthorizationContext context) {
        if (!subject.hasScope(action.requiredScope())) {
            return AuthorizationDecision.deny("MISSING_REQUIRED_SCOPE");
        }

        Entitlements entitlements = entitlementResolver.resolve(subject.id(), context);

        return casePolicy.evaluate(subject, entitlements, action, resource, context);
    }
}
```

---

## 30. Example: Incorrect vs Correct Authorization

### 30.1 Incorrect

```java
@GetMapping("/cases/{id}")
@PreAuthorize("hasAuthority('SCOPE_case.read')")
public CaseDto get(@PathVariable String id) {
    return caseRepository.findDtoById(id);
}
```

Problem:

- no tenant check,
- no object-level check,
- no assignment check,
- no resource state check,
- no audit decision,
- query can leak cross-tenant object.

### 30.2 Correct Direction

```java
@GetMapping("/cases/{id}")
public CaseDto get(@AuthenticationPrincipal Jwt jwt,
                   @PathVariable String id) {
    Subject subject = subjectFactory.fromJwt(jwt);
    return caseService.getCase(subject, CaseId.of(id));
}
```

```java
public CaseDto getCase(Subject subject, CaseId caseId) {
    CaseRecord record = caseRepository.findByIdWithinVisibleTenant(
        caseId,
        subject.activeTenant().orElseThrow()
    ).orElseThrow(NotFoundException::new);

    authorizationService.require(subject, Action.CASE_READ, Resource.caseRecord(record), context());

    return mapper.toDto(record);
}
```

This combines:

- route-level scope gate,
- tenant-scoped query,
- domain object authorization,
- proper denial handling.

---

## 31. Testing Strategy

### 31.1 Token Validation Tests

Test:

- invalid signature denied,
- expired token denied,
- wrong issuer denied,
- wrong audience denied,
- missing scope denied,
- malformed scope denied,
- non-prod issuer denied in prod config,
- token with unexpected algorithm denied.

### 31.2 Scope Mapping Tests

Test:

```text
scope="case.read report.export"
-> authorities include SCOPE_case.read and SCOPE_report.export
```

Test custom claim mapping:

```text
realm_access.roles=[case-officer]
-> ROLE_CASE-OFFICER or ROLE_CASE_OFFICER depending convention
```

Be consistent.

### 31.3 Domain Authorization Tests

For every sensitive endpoint:

| Scenario | Token valid | Scope | Object relation | Expected |
|---|---:|---:|---:|---|
| assigned officer reads case | yes | yes | assigned | allow |
| officer reads unassigned case | yes | yes | not assigned | deny |
| wrong tenant | yes | yes | tenant mismatch | deny/masked 404 |
| revoked role | yes | yes | current entitlement revoked | deny |
| maker approves own case | yes | yes | SoD violation | deny |
| stale token role | yes | yes | server role revoked | deny |

### 31.4 Token Exchange Tests

Test:

- downstream token audience is specific,
- downstream token scope is narrowed,
- original user preserved if required,
- actor/service preserved,
- downstream rejects original token with wrong audience,
- downstream rejects broad token where narrow token required.

### 31.5 Confused Deputy Tests

Simulate:

```text
User can call Service A but cannot access Resource R.
Service A has technical access to Service B.
Attempt to get Resource R through Service A must fail.
```

---

## 32. Observability and Audit

For authorization involving token evidence, audit should capture:

```text
- decision id
- correlation id
- subject id
- client id
- issuer
- audience
- token id/jti if available
- token issued-at and expiry
- scopes used
- action
- resource type/id
- tenant/org
- decision allow/deny
- reason code
- policy version
- entitlement version if available
- delegation/actor if present
```

Do not log full token.

Do not log sensitive claim values unnecessarily.

Good audit example:

```json
{
  "event": "AUTHORIZATION_DECISION",
  "decisionId": "dec-2026-000001",
  "subject": "user-123",
  "client": "aceas-web",
  "issuer": "https://idp.example.gov/realms/aceas",
  "audience": "case-api",
  "tokenId": "jti-abc",
  "action": "CASE_READ",
  "resourceType": "CASE",
  "resourceId": "C-123",
  "tenant": "CEA",
  "decision": "DENY",
  "reason": "CASE_NOT_ASSIGNED",
  "policyVersion": "case-policy-2026.06.19",
  "correlationId": "corr-789"
}
```

---

## 33. Production Checklist

Use this checklist for token-scope-claim authorization boundary.

### 33.1 Token Validation

- [ ] Validate issuer.
- [ ] Validate audience.
- [ ] Validate expiry.
- [ ] Validate not-before.
- [ ] Validate signature.
- [ ] Validate key source.
- [ ] Validate expected algorithm.
- [ ] Validate environment/realm.
- [ ] Validate token type if applicable.

### 33.2 Scope and Authority

- [ ] Scope names are resource/capability oriented.
- [ ] No vague `admin`, `read`, `write`, `all` scope without boundary.
- [ ] Route-level gates use coarse scope only.
- [ ] Domain object checks exist for sensitive resource access.
- [ ] Scope mapping is tested.
- [ ] Missing scope returns safe denial.

### 33.3 Claims

- [ ] `sub` is stable internal/external subject reference.
- [ ] Email is not used as authorization key.
- [ ] Tenant claim is validated server-side if used.
- [ ] Role claim is treated as evidence, not final truth for sensitive actions.
- [ ] Sensitive claims minimized.
- [ ] Claim source of truth is documented.

### 33.4 Microservices

- [ ] Downstream tokens have specific audience.
- [ ] Downstream scopes are narrowed.
- [ ] Service account permissions are least privilege.
- [ ] On-behalf-of context is auditable.
- [ ] Original user token is not blindly forwarded everywhere.
- [ ] Confused deputy scenarios are tested.

### 33.5 Revocation and Freshness

- [ ] Access token lifetime matches risk.
- [ ] Sensitive actions use current entitlement check.
- [ ] Role revocation behavior is documented.
- [ ] Stale claim risk is accepted or mitigated.
- [ ] Break-glass/delegation tokens are short-lived and audited.

### 33.6 Audit

- [ ] Log decision, not full token.
- [ ] Log issuer/audience/client/subject.
- [ ] Log reason code.
- [ ] Log policy version.
- [ ] Log delegation actor if present.
- [ ] Avoid leaking sensitive token claims.

---

## 34. Common Design Decisions

### 34.1 Should Roles Be in JWT?

Answer:

```text
Maybe, but only if they are coarse, stable enough, and not final for sensitive decisions.
```

For enterprise apps:

- role claim can help UI/coarse routing,
- current entitlement lookup should protect high-risk action,
- role revocation semantics must be clear.

### 34.2 Should Permissions Be in JWT?

Answer:

```text
Coarse permissions/scopes: yes.
Fine-grained dynamic permissions: usually no.
```

### 34.3 Should Tenant Be in JWT?

Answer:

```text
Tenant hint may be in JWT, but tenant authorization must be server-side validated.
```

### 34.4 Should Object IDs Be in JWT?

Answer:

```text
Almost never for normal enterprise CRUD/workflow systems.
```

Exception:

- very short-lived capability token,
- single resource pre-signed access,
- carefully scoped download link,
- strong expiry and audit.

### 34.5 Should Service Forward User Token Downstream?

Answer:

```text
Only if audience, scope, and downstream semantics are correct.
Prefer token exchange/narrowed downstream token for serious systems.
```

---

## 35. Top 1% Mental Models

### 35.1 Token Is an Assertion, Not a Decision

A token says:

```text
Here are claims issued by a trusted issuer at a point in time.
```

It does not automatically say:

```text
Allow every action that seems related to these claims.
```

### 35.2 Scope Is a Gate, Not the Whole Castle

Scope is excellent for:

- API boundary,
- coarse capability,
- client consent,
- early rejection.

Scope is weak for:

- object authorization,
- workflow rule,
- tenancy,
- SoD,
- current assignment,
- dynamic resource state.

### 35.3 Audience Is a Security Boundary

If `aud` is wrong or ignored, service boundaries collapse.

### 35.4 Stale Claims Are Inevitable

Every self-contained token is a snapshot. Mature systems design around staleness.

### 35.5 Downstream Authorization Must Narrow, Not Amplify

A service call should not turn limited user authority into broad service authority.

### 35.6 Do Not Let IdP Become Your Domain Authorization Engine Accidentally

Identity provider can issue claims/scopes. Domain authorization often belongs closer to resource, workflow, tenant, and policy.

### 35.7 Audit the Decision, Not Just the Token

Regulatory systems need to reconstruct why an action was allowed or denied, not merely prove that a JWT existed.

---

## 36. Summary

Token scopes and claims are powerful but dangerous when misunderstood.

Correct model:

```text
Token validation -> trusted evidence
Scope check -> coarse API gate
Claim mapping -> internal subject context
Domain policy -> final authorization decision
Audit -> defensibility
```

Avoid:

```text
JWT has role/scope -> therefore allow everything matching endpoint
```

Use:

```text
JWT has scope -> request may proceed to domain authorization
Domain policy checks subject/action/resource/context -> allow/deny
```

The more sensitive, stateful, tenant-bound, workflow-bound, or regulated the action, the less you should rely only on token claims.

---

## 37. References

1. RFC 9068 — JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens  
   https://datatracker.ietf.org/doc/html/rfc9068

2. RFC 8707 — Resource Indicators for OAuth 2.0  
   https://datatracker.ietf.org/doc/html/rfc8707

3. RFC 8693 — OAuth 2.0 Token Exchange  
   https://www.rfc-editor.org/info/rfc8693

4. Spring Security Reference — OAuth2 Resource Server JWT  
   https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html

5. Spring Security Reference — Authorize HTTP Requests  
   https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html

6. OWASP Authorization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

7. OWASP API Security 2023 — Broken Object Level Authorization  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

---

## 38. Status Seri

Selesai:

- Part 0 — Authorization Mental Model
- Part 1 — Authorization Vocabulary, Semantics, and Invariants
- Part 2 — Java Platform Authorization Primitives
- Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- Part 4 — RBAC Done Properly
- Part 5 — Permission and Capability Modeling
- Part 6 — ABAC
- Part 7 — PBAC and Policy-as-Code
- Part 8 — ReBAC
- Part 9 — ACL and Domain Object Security
- Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- Part 11 — IDOR, BOLA, and Object-Level Authorization
- Part 12 — Authorization in Layered Java Applications
- Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- Part 14 — Spring Method Security: Service-Level Authorization
- Part 15 — Spring Domain Authorization Patterns
- Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
- Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
- Part 18 — Data-Level Authorization and Query Scoping
- Part 19 — Workflow, State Machine, and Case Management Authorization
- Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
- Part 21 — Hierarchical Organizations and Complex Role Resolution
- Part 22 — Temporal, Risk-Based, and Contextual Authorization
- Part 23 — Authorization for Microservices and Distributed Systems
- Part 24 — Token Scopes, Claims, and Authorization Boundaries

Belum selesai. Part berikutnya:

- Part 25 — Authorization Caching, Performance, and Scalability

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-023.md">⬅️ Part 23 — Authorization for Microservices and Distributed Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-025.md">Part 25 — Authorization Caching, Performance, and Scalability ➡️</a>
</div>
