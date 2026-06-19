# learn-http-for-web-backend-perspective-part-028.md

# Part 028 — HTTP Attacks and Defensive Backend Design

> Series: **HTTP for Web/Backend Perspective**  
> Audience: **Java backend engineer / tech lead**  
> Focus: **memahami serangan HTTP/API dari sisi server, lalu mendesain boundary, invariant, dan kontrol pertahanan yang benar di proxy, gateway, framework, dan domain layer.**

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 027, kita sudah membangun mental model backend HTTP dari sisi:

- semantics,
- method,
- status code,
- headers,
- body/framing,
- URI/routing,
- content negotiation,
- validation,
- error contract,
- idempotency,
- conditional request,
- caching,
- authentication,
- authorization,
- cookies/session/CSRF,
- CORS,
- rate limiting,
- timeout/backpressure,
- file transfer,
- streaming,
- HTTP versions,
- proxy/gateway/load balancer,
- API style,
- API evolution,
- observability,
- security headers/hardening.

Part ini menggabungkan semua itu ke satu pertanyaan inti:

> **Bagaimana request HTTP yang tampak valid bisa digunakan untuk melanggar boundary backend?**

Serangan HTTP jarang terlihat seperti “request aneh” saja. Banyak serangan justru memakai request yang tampak normal:

```http
GET /cases/CASE-1001 HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJ...
```

Namun masalahnya bisa berada di:

- object ID yang bukan milik user,
- header forwarding palsu,
- parser proxy dan parser app berbeda,
- cache key salah,
- body terlalu besar,
- field yang seharusnya tidak boleh client set,
- URL internal yang dipanggil server,
- retry/replay command,
- redirect target tidak tervalidasi,
- file path keluar dari directory aman,
- response error membocorkan struktur internal.

Top 1% backend engineer tidak hanya bertanya:

> “Endpoint ini jalan?”

Tetapi:

> “Boundary apa yang request ini coba lewati, dan layer mana yang bertanggung jawab menolaknya?”

---

## 1. Mental Model: HTTP Attack = Boundary Violation

Backend HTTP punya banyak boundary:

```text
Internet Client
   |
   v
CDN / WAF
   |
   v
Load Balancer
   |
   v
Reverse Proxy / API Gateway
   |
   v
Application Server / Framework
   |
   v
Controller / Handler
   |
   v
Application Service
   |
   v
Domain Model
   |
   v
Database / Queue / Object Storage / Internal Service
```

Setiap boundary menjawab pertanyaan berbeda.

| Boundary | Pertanyaan keamanan |
|---|---|
| CDN/WAF | Apakah traffic kasar/abusive perlu diblok? |
| Load balancer | Apakah TLS, host, client IP, protocol diterima? |
| Reverse proxy | Apakah path, header, body, timeout aman diteruskan? |
| Gateway | Apakah authn/authz/rate limit global terpenuhi? |
| Framework | Apakah request bisa diparse dan dimap ke handler yang benar? |
| Controller | Apakah input sesuai contract? |
| Application service | Apakah user boleh menjalankan use case ini? |
| Domain | Apakah transisi state valid? |
| Persistence | Apakah invariant data tetap benar? |
| Downstream | Apakah trust dan propagation aman? |

Serangan sering berhasil karena tim menganggap satu boundary sudah cukup.

Contoh asumsi lemah:

> “Gateway sudah auth, jadi app tidak perlu cek tenant.”

Ini salah. Gateway mungkin memverifikasi token, tetapi app tetap harus memastikan resource yang diminta berada dalam scope user/tenant tersebut.

Contoh lain:

> “CORS sudah dibatasi, jadi endpoint aman.”

CORS hanya membatasi browser. Non-browser client tetap bisa memanggil endpoint.

Contoh lain:

> “WAF akan menangkap request jahat.”

WAF mungkin membantu, tetapi tidak memahami invariant domain seperti “investigator tidak boleh approve case yang dia investigasi sendiri.”

---

## 2. Taxonomy Serangan HTTP/API

Kita kelompokkan serangan berdasarkan boundary yang dilanggar.

| Kategori | Target utama | Contoh |
|---|---|---|
| Framing/parser attack | Proxy/app parser | request smuggling |
| Header trust attack | Metadata request | spoofed `X-Forwarded-For`, host header attack |
| Routing/path attack | Resource resolution | path traversal, route confusion |
| Authorization attack | Object/function boundary | BOLA, BFLA, IDOR |
| Input binding attack | DTO/domain boundary | mass assignment, over-posting |
| Server-side fetch attack | Internal network boundary | SSRF |
| Cache attack | Shared cache key/freshness | cache poisoning, web cache deception |
| Redirect/link attack | Navigation boundary | open redirect |
| Payload attack | Memory/parser/storage | large body, decompression bomb, zip bomb |
| Replay/concurrency attack | Operation uniqueness | duplicate command, replayed webhook |
| Observability leakage | Information boundary | stack trace, sensitive logs |
| Availability attack | Resource exhaustion | slowloris, expensive query, regex bomb |

Kuncinya: jangan hafal nama serangan saja. Pahami **invariant yang rusak**.

---

## 3. Request Smuggling

### 3.1 Apa Itu

Request smuggling terjadi ketika dua HTTP processor di jalur request tidak sepakat tentang batas akhir request.

Biasanya melibatkan ambiguity antara:

- `Content-Length`,
- `Transfer-Encoding`,
- chunked body,
- duplicate header,
- invalid whitespace,
- HTTP/1.1 to HTTP/2 translation,
- proxy parser vs backend parser.

Topology umum:

```text
Client attacker
   |
   v
Front proxy
   |
   v
Backend server
```

Jika front proxy menganggap request berakhir di titik A, tetapi backend menganggap berakhir di titik B, attacker bisa “menyelundupkan” request kedua yang akan diproses backend dalam konteks connection yang sama.

### 3.2 Mengapa Backend Engineer Harus Peduli

Banyak engineer berpikir request smuggling adalah urusan proxy. Namun backend tetap terdampak karena:

- request yang diterima app bisa bukan request yang dimaksud proxy,
- auth/routing/cache behavior bisa dilewati,
- request berikutnya di connection bisa tercemar,
- observability menjadi membingungkan,
- gateway policy bisa tidak berlaku pada smuggled request.

### 3.3 Contoh Konseptual

Jangan fokus ke payload exploit spesifik. Fokus ke konflik parsing:

```http
POST /some-path HTTP/1.1
Host: api.example.com
Content-Length: 40
Transfer-Encoding: chunked

...
```

Jika satu layer memilih `Content-Length` dan layer lain memilih `Transfer-Encoding`, batas message menjadi ambigu.

### 3.4 Defensive Design

Pertahanan utama:

1. **Normalize dan reject ambiguous framing di edge.**
2. **Jangan biarkan request dengan conflicting framing mencapai app.**
3. **Gunakan versi proxy/server yang patched.**
4. **Samakan konfigurasi HTTP parsing di semua hop.**
5. **Batasi request body size.**
6. **Disable HTTP/1.1 keep-alive ke upstream bila ada risiko tertentu, atau pastikan parser aman.**
7. **Hindari chain proxy yang terlalu kompleks tanpa observability.**
8. **Monitor anomaly: 400 spikes, connection reset, malformed requests.**

Contoh Nginx-like policy secara konseptual:

```nginx
client_max_body_size 10m;
large_client_header_buffers 4 8k;
ignore_invalid_headers on;
proxy_request_buffering on;
```

Catatan: konfigurasi aktual bergantung versi Nginx, upstream, dan traffic pattern. Jangan copy-paste tanpa memahami efek buffering terhadap streaming/upload.

### 3.5 Backend Checklist

Untuk app Java:

- jangan menerima body pada method yang tidak semestinya tanpa alasan jelas,
- enforce `Content-Type`,
- enforce body size,
- log malformed request secara aman,
- pastikan proxy menolak duplicate/ambiguous framing,
- test edge-to-app, bukan app saja.

---

## 4. Header Injection dan Header Trust Abuse

### 4.1 Header Sebagai Control Plane

Di Part 005 kita sudah melihat header sebagai control plane. Itu berarti header sangat kuat. Karena kuat, header juga berbahaya jika dipercaya sembarangan.

Contoh header sensitif:

```http
X-Forwarded-For: 10.0.0.1
X-Forwarded-Proto: https
X-Forwarded-Host: admin.example.com
Forwarded: for=1.2.3.4;proto=https;host=api.example.com
X-User-Id: admin
X-Tenant-Id: regulator-a
X-Request-Id: abc
```

Pertanyaan utama:

> Header ini berasal dari client, proxy terpercaya, atau service internal?

### 4.2 Spoofed Forwarded Headers

Jika app langsung percaya `X-Forwarded-For` dari internet, attacker bisa memalsukan IP.

Contoh salah:

```java
String clientIp = request.getHeader("X-Forwarded-For");
if (allowlistedIps.contains(clientIp)) {
    allowAdminOperation();
}
```

Masalah:

- header bisa dikirim client,
- bisa berisi list IP,
- bisa dimanipulasi,
- format tidak selalu tunggal,
- trusted proxy chain harus diketahui.

Prinsip benar:

- edge harus menghapus incoming forwarded headers dari untrusted client,
- edge menambahkan forwarded headers canonical,
- app hanya percaya forwarded headers jika request datang dari trusted proxy,
- app framework harus dikonfigurasi eksplisit.

### 4.3 Identity Header Injection

Di beberapa arsitektur, gateway menambahkan header internal:

```http
X-Authenticated-User: user-123
X-Tenant-Id: tenant-a
X-Scopes: case:read case:update
```

Ini berbahaya jika app bisa diakses langsung tanpa gateway, karena attacker dapat mengirim header itu sendiri.

Pertahanan:

1. App tidak boleh public jika bergantung pada gateway identity headers.
2. Network policy harus hanya mengizinkan gateway memanggil app.
3. Gateway harus strip incoming identity headers.
4. Gunakan signed header/token internal bila perlu.
5. App tetap validasi authorization terhadap resource.

### 4.4 Response Header Injection

Jika nilai user-controlled dimasukkan ke response header tanpa sanitasi, attacker bisa mencoba menyisipkan CRLF.

Contoh risiko:

```java
response.setHeader("Content-Disposition", "attachment; filename=" + filename);
```

Jika filename tidak dibersihkan, response bisa rusak atau header tambahan bisa diinjeksi.

Gunakan builder/encoding yang aman.

Contoh prinsip:

```java
ContentDisposition disposition = ContentDisposition.attachment()
    .filename(safeDisplayFilename, StandardCharsets.UTF_8)
    .build();

headers.setContentDisposition(disposition);
```

---

## 5. Host Header Attack

### 5.1 Mengapa `Host` Penting

`Host` bukan header biasa. Ia menentukan authority request.

Backend sering menggunakan host untuk:

- generate absolute URL,
- password reset link,
- email verification link,
- redirect target,
- tenant resolution,
- cache key,
- CORS origin validation,
- routing virtual host,
- OAuth redirect URI.

Jika attacker bisa mengontrol `Host`, ia bisa mempengaruhi output backend.

### 5.2 Contoh Risiko

Password reset:

```java
String link = "https://" + request.getHeader("Host") + "/reset?token=" + token;
emailService.send(user.email(), link);
```

Attacker mengirim:

```http
Host: attacker.example
```

Email korban bisa berisi link ke domain attacker.

### 5.3 Defensive Design

1. Validasi allowed host di edge.
2. App jangan memakai raw `Host` untuk URL kritikal.
3. Gunakan configured public base URL.
4. Untuk multi-tenant host, validasi terhadap registry tenant resmi.
5. Jangan gunakan host sebagai tenant identity tanpa authorization tambahan.

Contoh Java:

```java
URI publicBaseUri = URI.create(appProperties.publicBaseUrl());
URI resetUri = publicBaseUri.resolve("/reset?token=" + urlEncode(token));
```

Untuk multi-tenant:

```java
Tenant tenant = tenantRegistry.findByHost(requestedHost)
    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

// Still authorize user against tenant.
authorization.assertTenantAccess(user, tenant.id());
```

---

## 6. Cache Poisoning

### 6.1 Apa Itu

Cache poisoning terjadi ketika attacker membuat shared cache menyimpan response yang salah, lalu response itu disajikan ke korban.

Penyebab umum:

- cache key tidak mempertimbangkan header yang mempengaruhi response,
- `Vary` salah atau hilang,
- response personalized diberi `public`,
- host/header untrusted mempengaruhi body/link,
- query parameter tertentu diabaikan cache,
- CDN normalisasi berbeda dari app.

### 6.2 Contoh: Missing `Vary: Origin`

Jika response CORS berbeda berdasarkan `Origin`, shared cache perlu tahu bahwa response bervariasi berdasarkan `Origin`.

Jika tidak, response untuk origin attacker bisa tersaji ke origin lain.

### 6.3 Contoh: Personalized Response Cached Publicly

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=600
Content-Type: application/json

{
  "userId": "user-123",
  "email": "alice@example.com"
}
```

Ini fatal jika melewati shared cache.

Untuk sensitive/personalized data:

```http
Cache-Control: private, no-store
```

Atau setidaknya:

```http
Cache-Control: private, no-cache
```

Tergantung kebutuhan.

### 6.4 Defensive Design

1. Tentukan classification response:
   - public immutable,
   - public revalidatable,
   - tenant-specific,
   - user-specific,
   - sensitive no-store.
2. Gunakan `Vary` untuk semua request header yang mengubah representation.
3. Jangan membangun response dari untrusted headers tanpa validasi.
4. Jangan cache authenticated response di shared cache kecuali benar-benar dirancang.
5. Test cache behavior lewat edge/CDN, bukan hanya app.
6. Observability: log cache status, cache key dimension, and response cache policy.

---

## 7. Web Cache Deception

### 7.1 Apa Itu

Web cache deception terjadi ketika attacker memancing korban membuka URL yang terlihat seperti static asset, tetapi backend merespons dengan data user-sensitive, lalu cache menyimpannya karena path/extension dianggap static.

Contoh konseptual:

```text
/account/profile/avatar.css
```

Jika app routing menganggap `/account/profile/avatar.css` tetap endpoint profile user, tetapi CDN menganggap `.css` static dan cacheable, data sensitif bisa tersimpan di shared cache.

### 7.2 Defensive Design

1. Jangan cache berdasarkan extension/path pattern saja tanpa response header aman.
2. Sensitive endpoint harus eksplisit `Cache-Control: no-store`.
3. Static asset route harus terpisah jelas dari dynamic route.
4. CDN cache rules harus allowlist, bukan broad heuristic.
5. App harus return 404 untuk path suffix yang tidak valid jika endpoint tidak mendukungnya.

---

## 8. SSRF: Server-Side Request Forgery

### 8.1 Apa Itu

SSRF terjadi ketika attacker membuat server melakukan request ke target yang dipilih attacker.

Endpoint berisiko biasanya menerima URL:

```json
{
  "callbackUrl": "https://example.com/webhook"
}
```

atau:

```json
{
  "documentUrl": "https://storage.example.com/file.pdf"
}
```

atau:

```http
GET /fetch?url=https://example.com/image.png
```

Jika server fetch URL tanpa kontrol, attacker bisa mencoba mengakses:

- metadata service cloud,
- localhost admin endpoint,
- internal service,
- database admin panel,
- Kubernetes API,
- Redis/Elasticsearch internal endpoint,
- private IP range,
- file URL,
- DNS rebinding target.

### 8.2 Mengapa SSRF Berbahaya

Server sering punya network privilege lebih tinggi daripada client.

Client tidak bisa mengakses:

```text
http://169.254.169.254/
http://localhost:8080/admin
http://internal-service.default.svc.cluster.local/
```

Tetapi server mungkin bisa.

### 8.3 Dangerous URL Validation Mistakes

Salah:

```java
if (url.startsWith("https://")) {
    webClient.get().uri(url).retrieve();
}
```

Masalah:

- host bisa private IP,
- DNS bisa resolve ke private IP,
- redirect bisa ke private IP,
- punycode/unicode confusion,
- embedded credentials,
- unusual port,
- IPv6 literal,
- decimal/octal IP representation,
- DNS rebinding,
- scheme confusion.

### 8.4 Defensive Design SSRF

Prinsip terkuat: **jangan fetch arbitrary URL**.

Jika butuh callback/webhook:

1. Gunakan allowlist domain/tenant-registered endpoint.
2. Require HTTPS.
3. Reject IP literal jika tidak perlu.
4. Resolve DNS and block private/reserved ranges.
5. Re-check after redirect or disable redirect.
6. Restrict ports.
7. Use outbound proxy with egress policy.
8. Block cloud metadata IP.
9. Set strict timeout and size limit.
10. Do not include internal credentials.
11. Log destination safely.
12. Scan asynchronously if fetching user-provided document.

Contoh conceptual validator:

```java
public final class OutboundUrlPolicy {
    private static final Set<Integer> ALLOWED_PORTS = Set.of(443);

    public void assertAllowed(URI uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new InvalidRequestException("Only HTTPS URLs are allowed");
        }

        if (uri.getUserInfo() != null) {
            throw new InvalidRequestException("URL credentials are not allowed");
        }

        int port = uri.getPort() == -1 ? 443 : uri.getPort();
        if (!ALLOWED_PORTS.contains(port)) {
            throw new InvalidRequestException("Port is not allowed");
        }

        String host = normalizeHost(uri.getHost());
        if (!registeredWebhookDomainRepository.isAllowed(host)) {
            throw new InvalidRequestException("Host is not registered");
        }
    }
}
```

Catatan: ini belum cukup untuk semua SSRF. Dalam production, perlu DNS resolution policy, private range blocking, redirect policy, dan egress control di network/proxy.

### 8.5 SSRF and Java HTTP Client

Pastikan client outbound punya:

- connect timeout,
- response timeout,
- max response size,
- redirect disabled/controlled,
- DNS/private IP validation,
- no proxy bypass,
- no credential propagation otomatis.

---

## 9. Open Redirect

### 9.1 Apa Itu

Open redirect terjadi ketika endpoint redirect ke URL yang dikontrol attacker.

Contoh:

```http
GET /login?returnUrl=https://attacker.example/phish
```

Jika setelah login server melakukan:

```java
return "redirect:" + returnUrl;
```

Maka user bisa diarahkan ke domain attacker setelah interaksi dengan domain resmi.

### 9.2 Dampak

- phishing lebih meyakinkan,
- OAuth flow abuse,
- token leakage jika fragment/query salah,
- bypass allowlist di sistem lain yang percaya domain resmi.

### 9.3 Defensive Design

Prefer relative path only:

```java
String safeReturnPath = validateLocalPath(returnUrl);
return "redirect:" + safeReturnPath;
```

Rules:

- allow only relative path starting `/`,
- reject `//evil.com`,
- reject backslash confusion,
- reject encoded absolute URL,
- allowlist route names if possible,
- for external redirect, use explicit allowlist.

Contoh:

```java
public String validateLocalRedirect(String value) {
    if (value == null || value.isBlank()) {
        return "/";
    }
    if (!value.startsWith("/")) {
        throw new InvalidRequestException("Invalid redirect target");
    }
    if (value.startsWith("//")) {
        throw new InvalidRequestException("Invalid redirect target");
    }
    if (value.contains("\\")) {
        throw new InvalidRequestException("Invalid redirect target");
    }
    return value;
}
```

---

## 10. Path Traversal

### 10.1 Apa Itu

Path traversal terjadi ketika attacker memanipulasi path agar server membaca/menulis file di luar directory yang diizinkan.

Contoh input:

```text
../../../../etc/passwd
..%2f..%2fsecret
```

### 10.2 Risiko pada Backend HTTP

Endpoint berisiko:

```http
GET /files/{filename}
GET /exports/{file}
GET /download?path=...
POST /evidence/upload
```

### 10.3 Defensive Design

Jangan gunakan user input sebagai filesystem path langsung.

Buruk:

```java
Path file = Paths.get("/data/files/" + filename);
return Files.readAllBytes(file);
```

Lebih aman:

```java
Path baseDir = Paths.get("/data/files").toRealPath();
Path requested = baseDir.resolve(filename).normalize().toRealPath();

if (!requested.startsWith(baseDir)) {
    throw new ResponseStatusException(HttpStatus.NOT_FOUND);
}
```

Lebih baik lagi:

- jangan expose filename sebagai storage path,
- gunakan opaque file ID,
- lookup metadata di database,
- enforce authorization,
- map ke object storage key internal.

```text
GET /evidence-files/evf_01HX...
```

bukan:

```text
GET /download?path=/tenant-a/case-123/private/evidence.pdf
```

---

## 11. Mass Assignment / Over-Posting

### 11.1 Apa Itu

Mass assignment terjadi ketika framework otomatis bind request body ke object yang punya field sensitif, sehingga client bisa mengubah properti yang seharusnya server-controlled.

Contoh buruk:

```java
@Entity
class User {
    String name;
    String email;
    boolean admin;
    String tenantId;
}

@PostMapping("/users/{id}")
public User update(@PathVariable UUID id, @RequestBody User user) {
    return userRepository.save(user);
}
```

Attacker mengirim:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "admin": true,
  "tenantId": "other-tenant"
}
```

### 11.2 Defensive Design

Gunakan request DTO spesifik use case.

```java
record UpdateUserProfileRequest(
    @NotBlank String displayName,
    @Email String email
) {}
```

Application service menentukan field server-controlled:

```java
public UserProfile updateProfile(UserId actor, UserId target, UpdateUserProfileRequest req) {
    authorization.assertCanUpdateProfile(actor, target);

    User user = userRepository.get(target);
    user.changeDisplayName(req.displayName());
    user.changeEmail(req.email());

    return userRepository.save(user);
}
```

### 11.3 Unknown Field Policy

Untuk API security-sensitive, pertimbangkan reject unknown fields.

Jika unknown fields diabaikan, attacker bisa mengira field sensitif berhasil diset, tapi tidak. Itu kadang aman. Namun reject unknown fields lebih baik untuk mendeteksi client mismatch dan percobaan over-posting.

Spring/Jackson example:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Namun hati-hati: global reject unknown field bisa membuat additive evolution lebih sulit. Bisa dibuat per API boundary.

---

## 12. Broken Object Level Authorization / IDOR

### 12.1 Apa Itu

BOLA/IDOR terjadi ketika user bisa mengakses object dengan mengganti identifier.

Contoh:

```http
GET /cases/CASE-1001
Authorization: Bearer token-for-tenant-A
```

User mengganti:

```http
GET /cases/CASE-9009
```

Jika server hanya cek “token valid” tetapi tidak cek “user boleh melihat CASE-9009”, data bocor.

### 12.2 Mengapa Ini Sering Terjadi

Karena authorization ditempatkan terlalu coarse:

```java
@PreAuthorize("hasAuthority('case:read')")
@GetMapping("/cases/{caseId}")
public CaseResponse getCase(@PathVariable String caseId) {
    return caseService.get(caseId);
}
```

Authority `case:read` bukan berarti boleh membaca semua case.

### 12.3 Defensive Design

Authorization harus mencakup:

- subject,
- action,
- object,
- tenant,
- relationship,
- case state,
- purpose/role,
- delegation.

```java
public CaseDetails getCase(UserPrincipal principal, CaseId caseId) {
    CaseRecord record = caseRepository.findVisibleCandidate(caseId)
        .orElseThrow(NotFoundException::new);

    authorization.assertCanReadCase(principal, record);

    return mapper.toDetails(record, principal);
}
```

Lebih baik lagi: filter di query.

```java
Optional<CaseRecord> findByIdVisibleTo(CaseId caseId, UserId userId, TenantId tenantId);
```

### 12.4 403 vs 404

Jika resource ada tapi user tidak boleh akses, secara konsep `403` masuk akal. Namun untuk menghindari enumeration, API bisa mengembalikan `404` untuk hidden resource.

Rule penting:

- pilih policy konsisten,
- jangan bocorkan existence melalui timing/body/error detail,
- audit internal tetap mencatat unauthorized attempt.

---

## 13. Broken Function Level Authorization

### 13.1 Apa Itu

BFLA terjadi ketika user bisa menjalankan function/operation yang tidak sesuai role.

Contoh:

```http
POST /cases/CASE-123/approve
```

User punya akses baca case, tapi tidak boleh approve.

### 13.2 Defensive Design

Jangan hanya cek resource access. Cek operation access.

```java
authorization.assertCanApproveCase(principal, caseRecord);
caseWorkflow.approve(caseRecord, decision);
```

Untuk workflow-heavy systems, operation authorization bergantung pada state:

| State | Investigator | Supervisor | Legal reviewer |
|---|---:|---:|---:|
| DRAFT | edit | read | no |
| SUBMITTED | read | assign | no |
| UNDER_INVESTIGATION | update evidence | read | no |
| REVIEW_PENDING | read | approve/reject | review |
| FINALIZED | read | read | read |

Authorization bukan hanya role. Ia adalah function of:

```text
principal + resource + action + current state + relationship + tenant + policy
```

---

## 14. Broken Object Property Level Authorization

### 14.1 Apa Itu

User boleh melihat object, tapi tidak semua field.

Contoh:

```json
{
  "caseId": "CASE-123",
  "status": "UNDER_INVESTIGATION",
  "respondentName": "Company A",
  "whistleblowerIdentity": "Jane Doe",
  "internalRiskScore": 98,
  "legalStrategy": "..."
}
```

Investigator mungkin boleh melihat sebagian, external respondent tidak.

### 14.2 Defensive Design

Jangan expose entity langsung.

Gunakan representation per audience/use case:

```java
CasePublicResponse
CaseInvestigatorResponse
CaseSupervisorResponse
CaseLegalReviewResponse
```

Atau mapper yang aware permission:

```java
CaseResponse toResponse(CaseRecord record, Principal principal) {
    return new CaseResponse(
        record.id(),
        record.status(),
        canViewSensitive(principal, record) ? record.sensitiveFields() : null
    );
}
```

Namun jangan terlalu banyak `if` tersebar. Untuk domain kompleks, lebih baik policy-driven field projection.

---

## 15. Injection Through Query, Body, Header, and Path

### 15.1 SQL/NoSQL/LDAP/Command Injection

HTTP hanyalah carrier. Injection terjadi ketika input HTTP masuk ke interpreter lain:

- SQL,
- NoSQL query,
- LDAP,
- shell,
- template engine,
- regex,
- XPath,
- JSONPath,
- expression language.

Contoh buruk SQL:

```java
String sql = "select * from cases where id = '" + caseId + "'";
```

Gunakan parameterized query.

### 15.2 Header-Based Injection

Contoh:

- `User-Agent` masuk log tanpa escaping,
- `X-Forwarded-Host` masuk email link,
- `Referer` masuk analytics query,
- `Accept-Language` masuk template selection.

Semua header dari client adalah untrusted.

### 15.3 Query DSL Injection

Endpoint search sering berbahaya:

```http
GET /cases?filter=status:OPEN AND tenantId:other
```

Jika API menerima DSL bebas, attacker bisa mencoba bypass tenant constraint.

Prinsip:

- parse filter ke AST aman,
- allowlist fields/operators,
- always inject tenant/user constraints server-side,
- jangan biarkan client menentukan authorization predicate.

```text
client filter: status = OPEN
server filter: tenant_id = principal.tenant_id AND user_can_access(case) AND status = OPEN
```

---

## 16. Deserialization Risk

### 16.1 Apa Itu

Deserialization risk terjadi ketika backend menerima data yang membuat runtime membangun object berbahaya atau menjalankan gadget chain.

Dalam API modern JSON DTO sederhana lebih aman daripada native Java serialization, tetapi risiko masih ada jika:

- polymorphic deserialization aktif,
- type information diterima dari client,
- XML parser tidak aman,
- YAML/object mapper terlalu permisif,
- classpath punya gadget chain,
- request body langsung bind ke domain/entity kompleks.

### 16.2 Defensive Design

1. Jangan gunakan Java native serialization untuk untrusted input.
2. Hindari polymorphic type info dari client kecuali allowlist ketat.
3. Gunakan DTO eksplisit.
4. Disable dangerous XML features.
5. Limit payload depth/size.
6. Keep dependencies patched.
7. Reject unknown/unexpected structure pada boundary sensitif.

---

## 17. Denial of Service via Payload and Computation

### 17.1 Large Body

Serangan sederhana:

```text
POST /upload
Content-Length: 50GB
```

Jika app membaca body ke memory, outage.

Pertahanan:

- edge body limit,
- app body limit,
- streaming,
- temp storage quota,
- per-user quota,
- timeout,
- malware scan async.

### 17.2 Slow Body / Slowloris

Attacker membuka banyak connection dan mengirim body/header sangat lambat.

Pertahanan:

- header read timeout,
- request body timeout,
- idle timeout,
- max connection per IP,
- reverse proxy buffering,
- connection limit,
- rate limiting.

### 17.3 Decompression Bomb

Request kecil compressed bisa expand sangat besar.

Pertahanan:

- limit compressed size,
- limit decompressed size,
- restrict content encoding,
- streaming decompression with quota,
- disable request compression jika tidak perlu.

### 17.4 JSON/XML Bomb

Payload dengan depth sangat besar atau entity expansion bisa membebani parser.

Pertahanan:

- max nesting depth,
- max token count,
- disable XML external entities,
- size limit,
- parser hardened config.

### 17.5 Expensive Query

Endpoint search/reporting bisa digunakan untuk computation DoS.

Contoh:

```http
GET /cases?sort=createdAt&include=evidence,history,comments,attachments&pageSize=100000
```

Pertahanan:

- max page size,
- cursor pagination,
- query cost limit,
- async export,
- index-aware filter allowlist,
- timeout,
- rate limit by cost,
- reject unbounded query.

### 17.6 Regex Bomb

Jika user input dipakai sebagai regex:

```java
Pattern.compile(userRegex)
```

Risiko catastrophic backtracking.

Pertahanan:

- avoid user regex,
- use safe regex engine/timeouts,
- limit pattern length,
- allowlist simple operators.

---

## 18. Replay Attack

### 18.1 Apa Itu

Replay terjadi ketika request valid dikirim ulang untuk menghasilkan efek yang tidak diinginkan.

Contoh:

```http
POST /payments
POST /cases/CASE-123/submit
POST /webhooks/provider-x
```

Jika request sama bisa diproses berkali-kali, backend bisa membuat duplicate operation.

### 18.2 Defensive Design

Gunakan kombinasi:

- idempotency key,
- nonce,
- timestamp window,
- request signature,
- deduplication table,
- unique business constraint,
- state machine guard.

Webhook example:

```text
provider_event_id unique
signature valid
timestamp within tolerance
payload hash matches signature
process event idempotently
```

Command example:

```text
Idempotency-Key + actor + operation + request fingerprint
```

State machine guard:

```text
DRAFT -> SUBMITTED allowed once
SUBMITTED -> SUBMITTED rejected or replayed response
```

---

## 19. CSRF, CORS, and Auth Confusion

### 19.1 Common Mistake

> “Kami pakai CORS, jadi aman dari CSRF.”

Tidak selalu.

CORS dan CSRF menyelesaikan masalah berbeda.

- CORS: apakah browser boleh membaca response dari origin berbeda dan mengirim request tertentu.
- CSRF: apakah browser korban bisa dipakai untuk mengirim state-changing request dengan credential korban.

Jika auth memakai cookie otomatis, CSRF tetap harus dipikirkan.

### 19.2 Defensive Design

Untuk cookie-auth browser app:

- SameSite cookie,
- CSRF token,
- Origin/Referer validation,
- no unsafe GET,
- content-type enforcement,
- CORS allowlist,
- credentials policy ketat.

Untuk bearer token stored outside automatic browser credentials:

- CSRF risk lebih rendah,
- XSS risk bisa lebih tinggi tergantung storage,
- tetap butuh authorization dan token validation.

---

## 20. Information Disclosure

### 20.1 Error Leakage

Buruk:

```json
{
  "error": "org.postgresql.util.PSQLException: relation internal_case_notes does not exist",
  "stackTrace": "..."
}
```

Risiko:

- database structure bocor,
- package/class name bocor,
- internal host/service name bocor,
- token/path/file bocor.

### 20.2 Logging Leakage

Jangan log raw:

- Authorization header,
- Cookie,
- Set-Cookie,
- access token,
- refresh token,
- password,
- OTP,
- CSRF token,
- PII sensitive,
- evidence content,
- full request body default.

### 20.3 Defensive Design

- problem details generic untuk client,
- correlation ID untuk support,
- internal logs structured and redacted,
- audit log separate,
- secure log retention,
- field-level redaction policy.

Example response:

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal server error",
  "status": 500,
  "instance": "/problems/01HX...",
  "correlationId": "req_01HX..."
}
```

---

## 21. Defensive Placement: Edge vs Gateway vs App vs Domain

Tidak semua kontrol harus diletakkan di satu tempat.

| Control | Edge/CDN/WAF | Gateway | App/framework | Domain/service |
|---|---:|---:|---:|---:|
| TLS termination | yes | sometimes | sometimes | no |
| Host allowlist | yes | yes | yes | no |
| Body size limit | yes | yes | yes | no |
| Rate limiting global | yes | yes | maybe | no |
| Tenant quota | maybe | yes | yes | maybe |
| Authentication | maybe | yes | yes | no |
| Resource authorization | no | partial | yes | yes |
| State transition guard | no | no | no | yes |
| DTO validation | no | maybe | yes | maybe |
| Domain invariant | no | no | no | yes |
| SSRF egress policy | network | gateway/proxy | yes | no |
| Error redaction | no | maybe | yes | no |
| Audit event | no | maybe | yes | yes |

Rule:

> Generic controls belong near the edge. Business-specific invariants belong in the application/domain.

Do not rely on WAF to enforce domain authorization.

Do not rely on controller annotation to enforce state-machine invariant.

---

## 22. Java/Spring Defensive Architecture

### 22.1 Recommended Request Pipeline

```text
HTTP request
  -> container/proxy limits
  -> security filter chain
  -> request ID / tracing filter
  -> forwarded header processing from trusted proxy only
  -> content-type/body-size validation
  -> authentication
  -> coarse authorization
  -> controller DTO binding
  -> structural validation
  -> application service
  -> resource authorization
  -> domain invariant/state transition
  -> persistence constraint
  -> response mapper
  -> security/cache headers
  -> structured logs/metrics/traces
```

### 22.2 Spring MVC Example Shape

```java
@RestController
@RequestMapping("/cases")
class CaseDecisionController {
    private final CaseDecisionService service;

    @PostMapping(
        path = "/{caseId}/decisions",
        consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
    )
    ResponseEntity<DecisionResponse> decide(
        @AuthenticationPrincipal Principal principal,
        @PathVariable CaseId caseId,
        @Valid @RequestBody CreateDecisionRequest request,
        @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey
    ) {
        DecisionResult result = service.createDecision(
            principal,
            caseId,
            request,
            idempotencyKey
        );

        URI location = URI.create("/cases/" + caseId + "/decisions/" + result.decisionId());

        return ResponseEntity
            .created(location)
            .eTag(result.etag())
            .body(DecisionResponse.from(result));
    }
}
```

Service layer:

```java
@Service
class CaseDecisionService {
    @Transactional
    DecisionResult createDecision(
        Principal principal,
        CaseId caseId,
        CreateDecisionRequest request,
        String idempotencyKey
    ) {
        IdempotencyScope scope = IdempotencyScope.of(
            principal.subjectId(),
            "case-decision",
            idempotencyKey
        );

        return idempotency.execute(scope, request.fingerprint(), () -> {
            CaseRecord caseRecord = caseRepository.findForUpdate(caseId)
                .orElseThrow(NotFoundException::new);

            authorization.assertCanCreateDecision(principal, caseRecord);
            caseRecord.assertDecisionAllowed(request.decisionType());

            Decision decision = caseRecord.createDecision(
                request.decisionType(),
                request.reason(),
                principal.subjectId()
            );

            audit.recordDecisionCreated(principal, caseRecord, decision);
            return DecisionResult.from(caseRecord, decision);
        });
    }
}
```

Yang penting:

- controller tidak expose entity,
- request DTO terbatas,
- auth principal eksplisit,
- idempotency dipertimbangkan,
- resource authorization ada di service,
- domain invariant ada di domain,
- audit event tercatat,
- response mapper mengontrol field exposure.

---

## 23. Security Testing Strategy

### 23.1 Test per Boundary

Jangan hanya test happy path.

Test matrix:

| Area | Test |
|---|---|
| Authn | missing token, expired token, wrong audience, wrong issuer |
| Authz | other tenant resource, wrong role, wrong state, bulk mixed access |
| Validation | unknown field, null/missing/blank, type confusion, large value |
| Headers | spoofed forwarded headers, invalid host, duplicate header |
| Body | too large, wrong content-type, malformed JSON, compressed payload |
| Cache | personalized response not public, Vary correctness |
| CSRF/CORS | disallowed origin, credential behavior, preflight |
| SSRF | private IP, localhost, redirect to private IP, weird scheme |
| Redirect | absolute external URL, protocol-relative URL, encoded URL |
| Path | traversal, encoded traversal, invalid suffix |
| Rate/DoS | large page size, expensive include, repeated failures |
| Replay | duplicate idempotency key, same key different payload |
| Errors | no stack trace, no sensitive detail |

### 23.2 Negative Test Examples

BOLA:

```text
Given user A in tenant A
And case X belongs to tenant B
When user A requests GET /cases/X
Then response is 404 or 403 according to policy
And no sensitive details are returned
And audit event is recorded
```

Mass assignment:

```text
When client sends { "displayName": "A", "admin": true }
Then request is rejected or admin is ignored according to strict DTO policy
And persisted admin flag remains unchanged
```

SSRF:

```text
When client registers callbackUrl = http://169.254.169.254/latest/meta-data
Then request is rejected before outbound call
```

Cache:

```text
When authenticated user requests /me
Then response has Cache-Control: no-store or private according to policy
And shared cache must not store it
```

---

## 24. Observability for Attack Detection

Security without observability becomes guesswork.

Useful signals:

- 400 malformed request rate,
- 401/403 rate by endpoint/client/tenant,
- 404 enumeration pattern,
- 429 rate-limit hits,
- request body too large,
- invalid content-type,
- SSRF blocked destination,
- open redirect rejected target,
- idempotency replay count,
- suspicious header presence,
- duplicate/ambiguous framing rejected at proxy,
- CORS denied origin,
- CSRF validation failures,
- expensive query rejection,
- auth token validation failures by reason.

Important caution:

> Jangan masukkan raw attack payload ke log tanpa sanitasi.

Attack payload bisa mengandung control characters, PII, secrets, atau log injection strings.

Structured event example:

```json
{
  "event": "security.ssr_url_rejected",
  "requestId": "req_01HX...",
  "actorId": "usr_123",
  "tenantId": "tnt_a",
  "endpoint": "POST /webhook-subscriptions",
  "reason": "private_ip_range",
  "hostHash": "sha256:...",
  "status": 400
}
```

---

## 25. Case Study: Regulatory Enforcement Platform

Domain:

- case lifecycle,
- evidence upload,
- assignment,
- investigation,
- legal review,
- decision,
- appeal,
- external agency collaboration,
- respondent portal.

### 25.1 Threat Scenarios

#### Scenario A — IDOR on Case Detail

Request:

```http
GET /cases/CASE-7788
Authorization: Bearer investigator-from-other-region
```

Defense:

- token validation,
- tenant/region constraint,
- assignment relationship check,
- hidden resource policy,
- audit unauthorized access attempt.

#### Scenario B — Mass Assignment on Decision

Payload:

```json
{
  "decisionType": "NO_VIOLATION",
  "reason": "...",
  "approvedByLegal": true,
  "finalizedAt": "2026-06-19T10:00:00Z"
}
```

Defense:

- DTO excludes server-controlled fields,
- unknown field rejection,
- domain transition requires legal reviewer action,
- audit separate decision and approval.

#### Scenario C — SSRF via Evidence Import

Payload:

```json
{
  "sourceUrl": "http://internal-case-db:9200/_search"
}
```

Defense:

- no arbitrary URL fetch,
- only pre-registered external agency domains,
- egress proxy,
- private IP block,
- redirect disabled,
- async scan.

#### Scenario D — Cache Leak in Respondent Portal

Endpoint:

```http
GET /respondent/cases/CASE-123
```

Defense:

```http
Cache-Control: no-store
Vary: Authorization, Cookie
```

Even better: ensure shared cache bypass for authenticated portal route.

#### Scenario E — Workflow Replay

Request:

```http
POST /cases/CASE-123/submit
Idempotency-Key: abc
```

Network times out after commit. Client retries.

Defense:

- idempotency key scoped to actor and operation,
- persisted operation result,
- state machine guard,
- replay original response.

#### Scenario F — Host Header Password Reset

Request:

```http
POST /password-reset
Host: evil.example
```

Defense:

- host allowlist at edge,
- configured public URL for email links,
- tenant host registry,
- no raw host in security-critical URLs.

### 25.2 Defensive Architecture

```text
Internet
  -> CDN/WAF
       - TLS
       - host allowlist
       - coarse rate limit
       - body/header limit
  -> API Gateway
       - authn
       - CORS
       - tenant routing
       - quota
       - strip spoofed headers
  -> Case API
       - DTO validation
       - resource authorization
       - state machine invariant
       - idempotency
       - audit
       - problem details
  -> Storage/DB/Queue
       - transactional constraints
       - immutable audit trail
       - object storage policy
```

---

## 26. Production Checklist

### 26.1 Request Parsing and Framing

- [ ] Edge rejects malformed/ambiguous request framing.
- [ ] Body size limits exist at edge and app.
- [ ] Header size limits exist.
- [ ] Invalid content type rejected.
- [ ] Duplicate/conflicting sensitive headers handled safely.
- [ ] Streaming endpoints have explicit timeout/backpressure policy.

### 26.2 Header and Proxy Trust

- [ ] App only trusts forwarded headers from trusted proxy.
- [ ] Gateway strips incoming identity headers.
- [ ] Host allowlist configured.
- [ ] Public URL generation does not use raw Host unless validated.
- [ ] Correlation IDs are sanitized/normalized.

### 26.3 Authentication and Authorization

- [ ] Token issuer/audience/expiry/signature validated.
- [ ] Resource-level authorization enforced.
- [ ] Function-level authorization enforced.
- [ ] Field-level exposure controlled.
- [ ] Tenant boundary enforced in query and service.
- [ ] 403/404 policy consistent.

### 26.4 Input and DTO Boundary

- [ ] No entity binding from request body.
- [ ] DTO per use case.
- [ ] Unknown field policy defined.
- [ ] Server-controlled fields ignored/rejected.
- [ ] Structural and semantic validation separated.
- [ ] Domain invariant enforced below controller.

### 26.5 SSRF and Outbound Calls

- [ ] No arbitrary URL fetch unless justified.
- [ ] HTTPS required when applicable.
- [ ] Host/domain allowlist.
- [ ] Private/reserved IP blocked after DNS resolution.
- [ ] Redirect policy safe.
- [ ] Egress proxy/network policy in place.
- [ ] Outbound timeout and response size limit.

### 26.6 Cache Safety

- [ ] Sensitive responses use `no-store`.
- [ ] Personalized responses not cached publicly.
- [ ] `Vary` set for negotiation/auth/origin dimensions.
- [ ] CDN rules are allowlist-based.
- [ ] Dynamic routes not cached by extension confusion.

### 26.7 Availability

- [ ] Rate limit by tenant/user/API key/IP as needed.
- [ ] Concurrency limit for expensive operations.
- [ ] Max page size and query cost controls.
- [ ] Timeout budget aligned across proxy/app/db/downstream.
- [ ] Load shedding strategy defined.
- [ ] Retry policy idempotency-aware.

### 26.8 Error and Logging

- [ ] No stack trace in client response.
- [ ] Problem Details/error taxonomy used.
- [ ] Sensitive headers/body fields redacted.
- [ ] Security-relevant rejection events logged safely.
- [ ] Audit log separate from diagnostic log.

---

## 27. Anti-Patterns

### Anti-pattern 1 — “Gateway already checks security”

Gateway can help with generic policy. It cannot enforce all domain-specific object, field, and state-machine rules.

### Anti-pattern 2 — Binding request directly to entity

This invites mass assignment, accidental persistence, and contract leakage.

### Anti-pattern 3 — Trusting forwarded headers from client

Forwarded headers are only meaningful if set by trusted infrastructure and stripped from untrusted input.

### Anti-pattern 4 — Treating CORS as API security

CORS is browser permission, not authentication or authorization.

### Anti-pattern 5 — Using raw Host for security links

Use configured public base URL or validated tenant host registry.

### Anti-pattern 6 — Public caching authenticated responses

Unless intentionally designed with strict rules, this leaks data.

### Anti-pattern 7 — Arbitrary server-side fetch

Accepting arbitrary URL from client is a serious SSRF risk.

### Anti-pattern 8 — Only happy-path integration tests

Security bugs usually live in negative paths, mixed authorization, malformed input, and boundary mismatch.

### Anti-pattern 9 — Logging everything for debugging

Raw logs can become a second data breach.

### Anti-pattern 10 — WAF as substitute for secure design

WAF is a layer, not a proof of correctness.

---

## 28. Exercises

### Exercise 1 — Threat Model an Endpoint

Endpoint:

```http
POST /cases/{caseId}/evidence-imports
Content-Type: application/json

{
  "sourceUrl": "https://partner.example/files/report.pdf",
  "description": "Initial report"
}
```

Identify risks:

- SSRF,
- authorization,
- replay,
- large file,
- malware,
- timeout,
- audit,
- callback spoofing,
- tenant boundary.

Design defensive controls.

### Exercise 2 — Fix Mass Assignment

Given:

```java
@PatchMapping("/users/{id}")
public User update(@PathVariable UUID id, @RequestBody User user) {
    user.setId(id);
    return repository.save(user);
}
```

Rewrite with:

- request DTO,
- authorization,
- unknown field policy,
- server-controlled fields,
- audit event.

### Exercise 3 — Cache Safety Review

Classify cache policy for:

1. `/public/regulations/{id}`
2. `/me`
3. `/cases/{id}`
4. `/assets/app-abc123.js`
5. `/exports/{jobId}/download`
6. `/health`

For each, define:

- `Cache-Control`,
- `Vary`,
- shared cache allowed or not,
- security risk.

### Exercise 4 — BOLA Test Matrix

For `/cases/{caseId}` define test cases for:

- same tenant assigned investigator,
- same tenant unassigned investigator,
- supervisor same region,
- supervisor different region,
- legal reviewer after review state,
- respondent external portal,
- suspended user,
- service account.

### Exercise 5 — Header Trust Design

Your app receives:

```http
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Request-Id
X-Authenticated-User
X-Tenant-Id
```

Decide:

- which are accepted from client,
- which are stripped at gateway,
- which are generated by gateway,
- which are verified by app,
- which are logged,
- which affect authorization.

---

## 29. Key Takeaways

1. HTTP attacks are usually boundary violations.
2. The same request can be safe or dangerous depending on proxy, cache, auth, routing, and domain context.
3. Header trust must be explicit.
4. Object-level authorization is non-negotiable.
5. DTO boundaries prevent mass assignment and contract leakage.
6. SSRF is a network trust problem, not just URL validation.
7. Cache safety requires explicit classification of response sensitivity.
8. Availability is part of security.
9. Error and log design can leak or protect sensitive information.
10. Defense belongs at multiple layers, but domain invariants must live in the application/domain.

---

## 30. Part Summary

Di Part 028, kita membahas HTTP attacks dan defensive backend design dari sudut pandang backend production.

Kita membangun mental model bahwa serangan HTTP adalah upaya melewati boundary:

- parser/framing boundary,
- header trust boundary,
- routing boundary,
- object authorization boundary,
- field/property boundary,
- server-side network boundary,
- cache boundary,
- redirect/navigation boundary,
- payload/resource boundary,
- replay/concurrency boundary,
- observability/information boundary.

Kita juga membahas bagaimana menempatkan pertahanan di edge, gateway, app/framework, service, domain, database, dan network egress.

Setelah part ini, kita siap masuk ke implementasi Java yang lebih konkret: bagaimana Servlet, Spring MVC, filters, interceptors, argument resolver, exception resolver, dan message converter membentuk request pipeline backend.

---

# Status Seri

**Part 028 dari 032 selesai.**

Seri **belum selesai**.

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-029.md
```

Judul:

```text
Java Backend Implementation: Servlet, Spring MVC, Filters, Interceptors
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-027.md">⬅️ Part 027 — Security Headers and HTTP Hardening</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-029.md">Part 029 — Java Backend Implementation: Servlet, Spring MVC, Filters, Interceptors ➡️</a>
</div>
