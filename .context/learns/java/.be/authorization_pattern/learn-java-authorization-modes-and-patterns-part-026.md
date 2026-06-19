# Java Authorization Modes and Patterns — Advanced Engineering
## Part 26 — Authorization Failure Semantics and Error Handling

> Seri: `learn-java-authorization-modes-and-patterns`  
> File: `learn-java-authorization-modes-and-patterns-part-026.md`  
> Status: Part 26 dari maksimal 35 part  
> Fokus: bagaimana authorization gagal secara aman, eksplisit, terukur, dapat diaudit, dan tidak membocorkan data.

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, Anda diharapkan mampu:

1. Membedakan **deny**, **authentication failure**, **authorization failure**, **policy evaluation error**, dan **business rule rejection**.
2. Menentukan kapan memakai HTTP `401`, `403`, `404`, `409`, `422`, `429`, dan `500` dalam konteks authorization.
3. Mendesain failure behavior yang **fail-secure** dan tidak berubah menjadi allow-by-accident.
4. Menyusun denial reason yang berguna untuk user/operator tanpa membocorkan data sensitif.
5. Mendesain error contract Java/Spring/Jakarta yang konsisten.
6. Menangani bulk operation authorization secara benar.
7. Membedakan failure yang boleh di-retry, tidak boleh di-retry, harus di-escalate, atau harus di-audit.
8. Mendesain observability untuk authorization denial dan authorization system failure.
9. Mencegah common failure modes seperti policy service down lalu sistem menjadi allow, cache miss menjadi allow, missing context menjadi allow, atau exception handler mengubah access denied menjadi 500.

---

## 1. Mental Model: Authorization Failure Is a Decision Boundary

Authorization failure bukan sekadar “throw exception”. Authorization failure adalah sinyal bahwa sistem berada di salah satu kondisi berikut:

1. **Identitas belum valid**.
2. **Identitas valid tetapi tidak punya hak**.
3. **Resource tidak boleh diungkapkan keberadaannya**.
4. **Policy tidak bisa dievaluasi dengan aman**.
5. **Context tidak cukup untuk membuat keputusan**.
6. **Aksi tidak valid secara state/business rule walaupun user punya role**.
7. **Sistem authorization sedang gagal dan harus memilih fail-open atau fail-closed**.

Engineer biasa sering menyederhanakan semua ini menjadi:

```java
throw new AccessDeniedException("Access denied");
```

Engineer yang matang akan bertanya:

```text
Access denied karena apa?
- belum login?
- token invalid?
- token valid tapi scope kurang?
- role cukup tapi object bukan miliknya?
- object ada tapi tidak boleh diungkap?
- policy engine gagal?
- attribute source down?
- tenant context missing?
- state case tidak mengizinkan action?
- action perlu step-up?
- user sedang impersonating dan action ini forbidden?
```

Authorization failure adalah **domain event keamanan**, bukan hanya control-flow exception.

---

## 2. Vocabulary Failure yang Harus Dibedakan

### 2.1 Authentication Failure

Terjadi ketika sistem belum bisa mempercayai siapa subjeknya.

Contoh:

- Tidak ada token/session.
- Token expired.
- Signature JWT invalid.
- Session invalid.
- Client credential invalid.

HTTP yang umum: `401 Unauthorized`.

Catatan: nama `401 Unauthorized` historisnya membingungkan. Secara semantik modern, `401` berarti client harus melakukan authentication atau authentication yang diberikan tidak diterima.

---

### 2.2 Authorization Denial

Terjadi ketika subject sudah dikenal tetapi tidak punya hak untuk melakukan aksi tertentu.

Contoh:

- User authenticated tetapi tidak punya `case.approve`.
- User punya role reviewer tetapi bukan reviewer untuk case tersebut.
- User dari agency A mencoba melihat case agency B.
- Token punya audience service lain.

HTTP yang umum: `403 Forbidden`.

---

### 2.3 Resource Concealment

Terjadi ketika sistem sengaja tidak ingin mengungkap apakah resource ada.

Contoh:

```http
GET /cases/CASE-999
```

Jika case ada tetapi milik tenant lain, mengembalikan `403` dapat memberi sinyal bahwa case tersebut memang ada. Dalam beberapa sistem, respons yang lebih aman adalah `404 Not Found`.

Ini bukan berarti semua authorization denial harus jadi `404`. Resource concealment harus dipakai secara sadar, konsisten, dan terdokumentasi.

---

### 2.4 Policy Evaluation Error

Terjadi ketika authorization system gagal melakukan evaluasi.

Contoh:

- Policy engine down.
- Policy bundle corrupt.
- Attribute provider timeout.
- Cache corrupt.
- Tenant context tidak tersedia.
- Policy version unknown.
- PDP response malformed.

Dalam sistem aman, policy evaluation error biasanya **bukan allow**. Default-nya harus deny/fail-closed, kecuali endpoint memang dikategorikan non-sensitive dan punya fallback yang terdokumentasi.

---

### 2.5 Business Rule Rejection

Ini bukan authorization denial murni.

Contoh:

- User boleh submit application, tetapi application sudah submitted.
- User boleh approve case, tetapi case masih incomplete.
- User boleh update profile, tetapi field tertentu immutable setelah verification.

HTTP yang umum bisa `409 Conflict` atau `422 Unprocessable Content`, tergantung kontrak API.

Penting: jangan mencampur semua business rule rejection menjadi `403`, karena akan membuat user/operator tidak bisa membedakan “tidak punya hak” dari “aksi tidak valid untuk state saat ini”.

---

### 2.6 Obligation Failure

Authorization kadang menghasilkan keputusan:

```text
ALLOW, but only if obligation X is fulfilled.
```

Contoh:

- Allow export hanya jika watermark diterapkan.
- Allow view hanya jika field tertentu dimasking.
- Allow approve hanya jika reason dicatat.
- Allow emergency access hanya jika ticket number valid.

Jika obligation gagal, hasil akhirnya harus denial atau failure, bukan allow diam-diam.

---

## 3. Deny, Error, Reject: Tiga Kategori Besar

Authorization outcome minimal sebaiknya bukan boolean.

Model yang lebih sehat:

```text
PERMIT     : action boleh dilakukan.
DENY       : policy berhasil dievaluasi dan hasilnya menolak.
INDETERMINATE : policy tidak bisa dievaluasi dengan aman.
NOT_APPLICABLE: tidak ada policy yang berlaku.
```

Dalam aplikasi Java, biasanya diterjemahkan menjadi:

```java
public enum AuthorizationOutcome {
    PERMIT,
    DENY,
    INDETERMINATE,
    NOT_APPLICABLE
}
```

Namun untuk production, perlu alasan:

```java
public enum DenialCategory {
    UNAUTHENTICATED,
    INSUFFICIENT_PERMISSION,
    WRONG_TENANT,
    NOT_ASSIGNED,
    STATE_NOT_ALLOWED,
    SEGREGATION_OF_DUTY,
    STEP_UP_REQUIRED,
    RESOURCE_HIDDEN,
    POLICY_UNAVAILABLE,
    ATTRIBUTE_UNAVAILABLE,
    CONTEXT_MISSING,
    OBLIGATION_FAILED
}
```

Kunci mental model:

```text
DENY berarti policy bekerja dan menolak.
ERROR berarti sistem tidak bisa mengambil keputusan aman.
REJECT berarti action tidak valid secara business state.
```

---

## 4. HTTP Status Code Semantics untuk Authorization

### 4.1 `401 Unauthorized`

Gunakan ketika request belum authenticated atau credential tidak valid.

Contoh:

```http
GET /api/cases/123
Authorization: Bearer expired-token

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token"
```

Gunakan untuk:

- Missing token.
- Expired token.
- Invalid token signature.
- Missing session.
- Invalid authentication scheme.

Jangan gunakan `401` untuk user yang sudah authenticated tetapi role kurang. Itu `403`.

---

### 4.2 `403 Forbidden`

Gunakan ketika identity valid, tetapi action tidak diizinkan.

Contoh:

```http
POST /api/cases/123/approve
Authorization: Bearer valid-token

HTTP/1.1 403 Forbidden
```

Gunakan untuk:

- Permission kurang.
- Scope kurang.
- Role tidak cocok.
- Resource accessible tetapi action forbidden.
- Step-up dibutuhkan, jika kontraknya tidak memakai kode khusus.

---

### 4.3 `404 Not Found`

Gunakan jika sistem memilih menyembunyikan resource existence.

Contoh:

```http
GET /api/cases/tenant-b-case
Authorization: Bearer tenant-a-user

HTTP/1.1 404 Not Found
```

Cocok untuk:

- Multi-tenant resource lookup.
- Private document/file.
- User profile/private object.
- Resource ID enumeration defense.

Tapi hati-hati: jika sebagian endpoint return `403` dan sebagian `404` untuk kasus serupa, attacker tetap bisa melakukan inference.

---

### 4.4 `409 Conflict`

Gunakan jika action bertentangan dengan state resource.

Contoh:

```http
POST /api/cases/123/approve

HTTP/1.1 409 Conflict
{
  "code": "CASE_STATE_CONFLICT",
  "message": "Case cannot be approved from DRAFT state."
}
```

Ini bukan authorization denial jika user sebenarnya punya permission approve.

---

### 4.5 `422 Unprocessable Content`

Gunakan jika request semantik tidak valid walaupun format benar.

Contoh:

- Required approval reason missing.
- Delegation request end date sebelum start date.
- Break-glass reason kosong.

---

### 4.6 `429 Too Many Requests`

Kadang terkait authorization jika abuse control atau quota policy diterapkan.

Contoh:

- User hanya boleh export 3 laporan per jam.
- API client melebihi entitlement quota.

Ini lebih dekat ke entitlement/rate policy, bukan role permission biasa.

---

### 4.7 `500` dan `503`

Jangan otomatis mengubah authorization denial menjadi `500`.

Gunakan:

- `500` jika ada bug internal.
- `503` jika policy service/PDP unavailable dan endpoint tidak bisa diproses.

Tetapi untuk sensitive operation, walaupun internal reason adalah PDP down, outward response bisa dibuat generic:

```http
HTTP/1.1 403 Forbidden
{
  "code": "ACCESS_NOT_AVAILABLE",
  "message": "Access cannot be granted at this time."
}
```

Internal audit tetap mencatat `POLICY_UNAVAILABLE`.

---

## 5. Response Body: Aman untuk User, Berguna untuk Operator

### 5.1 Jangan Bocorkan Policy Internal

Bad:

```json
{
  "error": "Denied because case.agencyId=CEA and user.agencyId=MAS, role=CASE_REVIEWER, required permission=case.approve.final"
}
```

Masalah:

- Membocorkan agency/resource detail.
- Membocorkan permission internal.
- Membantu attacker memetakan policy.

Better:

```json
{
  "code": "ACCESS_DENIED",
  "message": "You are not allowed to perform this action.",
  "correlationId": "01JZ..."
}
```

Internal log:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "correlationId": "01JZ...",
  "subjectId": "usr_123",
  "action": "case.approve",
  "resourceType": "case",
  "resourceIdHash": "...",
  "tenantId": "agency-a",
  "reasonCode": "WRONG_TENANT",
  "policyVersion": "authz-policy-2026.06.19-3",
  "decisionLatencyMs": 8
}
```

---

### 5.2 Error Contract yang Direkomendasikan

Untuk API enterprise, gunakan response contract stabil:

```json
{
  "code": "ACCESS_DENIED",
  "message": "You are not allowed to perform this action.",
  "correlationId": "01HZFQJ3K9...",
  "details": []
}
```

Untuk kasus step-up:

```json
{
  "code": "STEP_UP_REQUIRED",
  "message": "Additional verification is required to continue.",
  "correlationId": "01HZFQJ3K9...",
  "details": [
    {
      "type": "required_assurance_level",
      "value": "HIGH"
    }
  ]
}
```

Untuk resource concealment:

```json
{
  "code": "NOT_FOUND",
  "message": "Resource not found.",
  "correlationId": "01HZFQJ3K9..."
}
```

---

## 6. Internal Decision Reason vs External Error Code

Pisahkan dua hal:

1. **Internal reason**: presisi untuk audit/troubleshooting.
2. **External error code**: aman untuk client/user.

Contoh mapping:

| Internal Reason | External Status | External Code | Catatan |
|---|---:|---|---|
| `UNAUTHENTICATED` | 401 | `AUTHENTICATION_REQUIRED` | Credential missing/invalid |
| `INSUFFICIENT_PERMISSION` | 403 | `ACCESS_DENIED` | Jangan sebut permission internal kecuali trusted admin API |
| `WRONG_TENANT` | 404/403 | `NOT_FOUND` / `ACCESS_DENIED` | Tergantung concealment policy |
| `NOT_ASSIGNED` | 403 | `ACCESS_DENIED` | Assignment detail jangan bocor |
| `SEGREGATION_OF_DUTY` | 403 | `ACTION_NOT_ALLOWED` | Bisa diberi pesan business-safe |
| `STATE_NOT_ALLOWED` | 409 | `STATE_CONFLICT` | Biasanya business rejection |
| `STEP_UP_REQUIRED` | 403/401 | `STEP_UP_REQUIRED` | Kontrak harus konsisten |
| `POLICY_UNAVAILABLE` | 403/503 | `ACCESS_NOT_AVAILABLE` | Sensitive action fail-closed |
| `ATTRIBUTE_UNAVAILABLE` | 403/503 | `ACCESS_NOT_AVAILABLE` | Jangan default allow |
| `CONTEXT_MISSING` | 400/403 | `INVALID_CONTEXT` / `ACCESS_DENIED` | Tergantung sumber context |
| `OBLIGATION_FAILED` | 403/500 | `ACCESS_NOT_AVAILABLE` | Jika obligation security-critical |

---

## 7. Fail-Open vs Fail-Closed

### 7.1 Prinsip Default

Authorization harus default ke **fail-closed**.

Artinya:

```text
Jika sistem tidak bisa membuktikan bahwa action boleh,
maka action tidak boleh dilakukan.
```

OWASP juga menekankan deny-by-default dan fail securely sebagai prinsip access control.

---

### 7.2 Kapan Fail-Open Mungkin Diterima?

Fail-open hanya masuk akal untuk operasi low-risk, read-only, non-sensitive, dan sudah dinilai secara eksplisit.

Contoh yang mungkin:

- Public feature flag service gagal untuk endpoint public.
- Non-sensitive personalization gagal.
- Optional UI menu visibility gagal.

Bukan untuk:

- Approve/reject/submit/delete.
- Export/download.
- View PII/confidential data.
- Cross-tenant access.
- Admin operation.
- Break-glass.

---

### 7.3 Decision Table Fail Behavior

| Operation Type | PDP Down | Attribute Down | Cache Miss | Context Missing |
|---|---|---|---|---|
| Public read | allow with degraded mode | allow with degraded mode | recompute or allow | allow if no context needed |
| Authenticated profile read | deny or limited view | deny sensitive fields | recompute | deny |
| Case view | deny/404 | deny | recompute then deny | deny |
| Case approve | deny | deny | recompute then deny | deny |
| Export | deny | deny | deny | deny |
| Admin user management | deny | deny | deny | deny |
| Break-glass | deny unless emergency fallback pre-approved | deny | deny | deny |

---

## 8. Java Exception Taxonomy untuk Authorization

Jangan hanya punya satu `RuntimeException` generik.

Contoh taxonomy:

```java
public abstract class AuthorizationException extends RuntimeException {
    private final String correlationId;
    private final DenialCategory category;

    protected AuthorizationException(
            String message,
            String correlationId,
            DenialCategory category) {
        super(message);
        this.correlationId = correlationId;
        this.category = category;
    }

    public String correlationId() {
        return correlationId;
    }

    public DenialCategory category() {
        return category;
    }
}
```

Specialized:

```java
public final class UnauthenticatedException extends AuthorizationException { ... }
public final class AccessDeniedDomainException extends AuthorizationException { ... }
public final class ResourceHiddenException extends AuthorizationException { ... }
public final class PolicyEvaluationException extends AuthorizationException { ... }
public final class StepUpRequiredException extends AuthorizationException { ... }
```

Namun jangan over-engineer jika aplikasi kecil. Yang penting adalah mapping-nya eksplisit dan tidak tercampur dengan business exception.

---

## 9. Java 8-Compatible Decision Model

Karena seri ini mencakup Java 8–25, kita mulai dari model yang kompatibel Java 8.

```java
public final class AuthorizationDecision {
    private final AuthorizationOutcome outcome;
    private final DenialCategory denialCategory;
    private final String reasonCode;
    private final String policyVersion;
    private final boolean resourceHidden;

    private AuthorizationDecision(
            AuthorizationOutcome outcome,
            DenialCategory denialCategory,
            String reasonCode,
            String policyVersion,
            boolean resourceHidden) {
        this.outcome = outcome;
        this.denialCategory = denialCategory;
        this.reasonCode = reasonCode;
        this.policyVersion = policyVersion;
        this.resourceHidden = resourceHidden;
    }

    public static AuthorizationDecision permit(String policyVersion) {
        return new AuthorizationDecision(
                AuthorizationOutcome.PERMIT,
                null,
                null,
                policyVersion,
                false
        );
    }

    public static AuthorizationDecision deny(
            DenialCategory category,
            String reasonCode,
            String policyVersion,
            boolean resourceHidden) {
        return new AuthorizationDecision(
                AuthorizationOutcome.DENY,
                category,
                reasonCode,
                policyVersion,
                resourceHidden
        );
    }

    public boolean isPermitted() {
        return outcome == AuthorizationOutcome.PERMIT;
    }

    public AuthorizationOutcome outcome() {
        return outcome;
    }

    public DenialCategory denialCategory() {
        return denialCategory;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public String policyVersion() {
        return policyVersion;
    }

    public boolean resourceHidden() {
        return resourceHidden;
    }
}
```

Java 17+ bisa memakai `record` dan sealed hierarchy, tetapi konsepnya sama.

---

## 10. Java 17+ / 21+ Model dengan Record dan Sealed Types

Jika baseline modern:

```java
public sealed interface AuthzResult permits AuthzResult.Permit, AuthzResult.Deny, AuthzResult.Indeterminate {

    record Permit(String policyVersion) implements AuthzResult {}

    record Deny(
            DenialCategory category,
            String reasonCode,
            String policyVersion,
            boolean resourceHidden
    ) implements AuthzResult {}

    record Indeterminate(
            DenialCategory category,
            String errorCode,
            String policyVersion
    ) implements AuthzResult {}
}
```

Keuntungannya:

- Exhaustive handling dengan pattern matching modern.
- Tidak ada null untuk `denialCategory` pada permit.
- Lebih jelas mana deny dan mana indeterminate.

Namun jika library harus support Java 8, gunakan class biasa.

---

## 11. Spring Security Failure Flow

Dalam Spring Security Servlet stack, exception authorization biasanya melewati:

```text
Filter Chain
  -> AuthorizationFilter / Method Security Interceptor
  -> AccessDeniedException / AuthenticationException
  -> ExceptionTranslationFilter
  -> AuthenticationEntryPoint or AccessDeniedHandler
```

Konsep penting:

1. `AuthenticationEntryPoint` menangani kasus authentication diperlukan/gagal.
2. `AccessDeniedHandler` menangani kasus authenticated user tidak punya access.
3. `ExceptionTranslationFilter` adalah bridge dari exception Java ke HTTP response.
4. Authorization enforcement sendiri bukan dilakukan oleh `ExceptionTranslationFilter`; ia hanya menerjemahkan exception ke response.

### 11.1 Custom AccessDeniedHandler

```java
@Component
public final class ApiAccessDeniedHandler implements AccessDeniedHandler {

    private final ObjectMapper objectMapper;

    public ApiAccessDeniedHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void handle(
            HttpServletRequest request,
            HttpServletResponse response,
            AccessDeniedException ex) throws IOException {

        String correlationId = correlationIdFrom(request);

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");

        ErrorResponse body = new ErrorResponse(
                "ACCESS_DENIED",
                "You are not allowed to perform this action.",
                correlationId
        );

        objectMapper.writeValue(response.getOutputStream(), body);
    }

    private String correlationIdFrom(HttpServletRequest request) {
        Object value = request.getAttribute("correlationId");
        return value == null ? "unknown" : value.toString();
    }
}
```

### 11.2 Custom AuthenticationEntryPoint

```java
@Component
public final class ApiAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    public ApiAuthenticationEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthenticationException authException) throws IOException {

        String correlationId = String.valueOf(request.getAttribute("correlationId"));

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");

        ErrorResponse body = new ErrorResponse(
                "AUTHENTICATION_REQUIRED",
                "Authentication is required to access this resource.",
                correlationId
        );

        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
```

### 11.3 Register di SecurityFilterChain

```java
@Bean
SecurityFilterChain apiSecurity(
        HttpSecurity http,
        ApiAccessDeniedHandler accessDeniedHandler,
        ApiAuthenticationEntryPoint authenticationEntryPoint) throws Exception {

    http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health").permitAll()
            .anyRequest().authenticated()
        )
        .exceptionHandling(ex -> ex
            .authenticationEntryPoint(authenticationEntryPoint)
            .accessDeniedHandler(accessDeniedHandler)
        );

    return http.build();
}
```

---

## 12. Jangan Biarkan `@ControllerAdvice` Merusak Security Semantics

Common problem:

```java
@ControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handle(Exception ex) {
        return ResponseEntity.status(500).body(...);
    }
}
```

Jika tidak hati-hati, semua authorization failure bisa berubah menjadi `500` atau error body generik.

Better:

```java
@ExceptionHandler(AccessDeniedDomainException.class)
public ResponseEntity<ErrorResponse> handleDomainAccessDenied(
        AccessDeniedDomainException ex) {

    HttpStatus status = ex.category() == DenialCategory.RESOURCE_HIDDEN
            ? HttpStatus.NOT_FOUND
            : HttpStatus.FORBIDDEN;

    return ResponseEntity.status(status).body(
            new ErrorResponse(
                    status == HttpStatus.NOT_FOUND ? "NOT_FOUND" : "ACCESS_DENIED",
                    status == HttpStatus.NOT_FOUND
                            ? "Resource not found."
                            : "You are not allowed to perform this action.",
                    ex.correlationId()
            )
    );
}
```

Rule:

```text
Security exception harus punya handler eksplisit.
Generic exception handler tidak boleh mengubah semantics authorization.
```

---

## 13. `403` vs `404`: Decision Framework

Gunakan `403` jika:

1. User secara wajar tahu resource/action ada.
2. Denial membantu UX tanpa risiko leakage.
3. Resource adalah capability/action, bukan private object.
4. Endpoint admin internal dan client trusted.

Gunakan `404` jika:

1. Resource existence sensitif.
2. Identifier bisa ditebak/enumerated.
3. Multi-tenant boundary ketat.
4. Cross-account/private object.
5. File/document/private profile.

Contoh:

| Scenario | Recommended |
|---|---|
| User membuka menu admin tanpa role | 403 |
| User tenant A fetch `/cases/{tenantBCaseId}` | 404 |
| Reviewer assigned case tapi tidak boleh approve final | 403 |
| Anonymous fetch private file by ID | 401 atau 404, tergantung auth boundary |
| Authenticated user fetch private file milik orang lain | 404 |
| User approve case yang sudah closed | 409 |

---

## 14. Bulk Operation Failure Semantics

Bulk operation sering salah karena engineer hanya melakukan satu authorization check di depan.

Bad:

```java
if (!authz.can(user, "case.bulk-close")) {
    throw denied();
}
caseRepository.closeAll(caseIds);
```

Masalah:

- User mungkin boleh close sebagian case, bukan semua.
- Ada case beda tenant.
- Ada case state berbeda.
- Ada case yang harus disembunyikan.

Better:

```java
public BulkCloseResult closeCases(User user, List<CaseId> caseIds) {
    List<BulkItemResult> results = new ArrayList<>();

    for (CaseId caseId : caseIds) {
        Optional<CaseRecord> record = caseRepository.findVisibleCandidate(caseId);

        if (!record.isPresent()) {
            results.add(BulkItemResult.notFound(caseId));
            continue;
        }

        AuthorizationDecision decision = authorizationService.decide(
                user,
                Action.CASE_CLOSE,
                record.get()
        );

        if (!decision.isPermitted()) {
            results.add(BulkItemResult.denied(caseId, externalCode(decision)));
            continue;
        }

        try {
            closeOne(record.get());
            results.add(BulkItemResult.success(caseId));
        } catch (StateConflictException ex) {
            results.add(BulkItemResult.conflict(caseId, "STATE_CONFLICT"));
        }
    }

    return new BulkCloseResult(results);
}
```

### 14.1 HTTP untuk Bulk

Pilihan:

1. `200 OK` dengan per-item result jika request diterima dan diproses sebagian.
2. `207 Multi-Status` jika API ingin eksplisit multi-result, walaupun tidak semua client nyaman.
3. `403` jika seluruh bulk action tidak boleh dilakukan sama sekali.
4. `400` jika request format invalid.

Contoh body:

```json
{
  "results": [
    { "id": "CASE-1", "status": "SUCCESS" },
    { "id": "CASE-2", "status": "DENIED", "code": "ACCESS_DENIED" },
    { "id": "CASE-3", "status": "NOT_FOUND", "code": "NOT_FOUND" },
    { "id": "CASE-4", "status": "CONFLICT", "code": "STATE_CONFLICT" }
  ],
  "correlationId": "01HZ..."
}
```

### 14.2 Bulk Concealment Problem

Jika resource concealment diterapkan, jangan membedakan secara eksternal:

```json
{ "id": "CASE-3", "status": "NOT_FOUND" }
```

walaupun internal reason-nya `WRONG_TENANT`.

---

## 15. Idempotency and Authorization Failure

Idempotency key tidak boleh menjadi authorization bypass.

Bad scenario:

1. User A melakukan request valid dengan idempotency key `K1`.
2. Response disimpan.
3. User B mengirim request dengan key `K1`.
4. Sistem mengembalikan cached success tanpa authorization ulang.

Rule:

```text
Idempotency cache key harus mengandung security subject boundary.
```

Minimal:

```text
idempotencyKey + subjectId + tenantId + action + resource boundary
```

Jika subject authorization berubah antara attempt pertama dan retry, tentukan policy:

1. Return original result jika retry oleh subject yang sama dan operation sudah committed.
2. Deny jika retry datang dari subject berbeda.
3. Audit jika permission sudah revoked tetapi request adalah retry dari committed operation.

---

## 16. Retry Semantics

Tidak semua authorization failure boleh di-retry.

| Failure | Retry? | Catatan |
|---|---|---|
| Missing token | Setelah login | Client perlu authenticate |
| Expired token | Setelah refresh | Jangan loop infinite |
| Insufficient permission | Tidak | Kecuali permission berubah lewat admin |
| Step-up required | Ya setelah step-up | Client harus memenuhi assurance |
| Policy service timeout | Bisa dengan backoff | Server-side controlled |
| Attribute provider down | Bisa | Tetapi action tetap deny sampai context valid |
| State conflict | Bisa setelah state berubah | Business-level retry |
| Rate/quota denied | Setelah window reset | Return retry info jika aman |

Jangan buat client otomatis retry `403 ACCESS_DENIED` berkali-kali. Itu hanya menambah noise dan bisa terlihat seperti abuse.

---

## 17. Logging: Apa yang Harus Dicatat

Authorization denial yang baik harus bisa menjawab:

```text
Siapa mencoba apa, terhadap resource apa, di konteks apa, policy mana yang menolak, dan kenapa?
```

Tapi log tidak boleh membocorkan data sensitif secara berlebihan.

Recommended fields:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "timestamp": "2026-06-19T10:15:30Z",
  "correlationId": "01HZ...",
  "traceId": "...",
  "subjectId": "usr_123",
  "actorType": "HUMAN_USER",
  "tenantId": "agency-a",
  "action": "case.approve",
  "resourceType": "case",
  "resourceIdHash": "sha256:...",
  "resourceTenantId": "agency-b",
  "decision": "DENY",
  "reasonCode": "WRONG_TENANT",
  "policyId": "case-access-policy",
  "policyVersion": "2026.06.19-3",
  "pdpMode": "LOCAL",
  "decisionLatencyMs": 7,
  "clientId": "aceas-web",
  "requestPathTemplate": "/api/cases/{id}/approve",
  "httpStatus": 404
}
```

Avoid:

- Full NRIC/passport/PII.
- Full JWT.
- Full request body for sensitive operation.
- Raw document content.
- Secret tokens.
- Password/session cookie.

---

## 18. Observability Metrics

Metrics yang berguna:

```text
authz_decision_total{outcome="permit|deny|indeterminate", action, resource_type}
authz_denied_total{reason_code, action, resource_type}
authz_decision_latency_ms{pdp_mode}
authz_policy_unavailable_total{policy_id}
authz_attribute_unavailable_total{provider}
authz_cache_hit_total{cache="decision|entitlement|attribute"}
authz_cache_stale_rejected_total{}
authz_bulk_partial_denial_total{action}
authz_step_up_required_total{action}
authz_concealed_not_found_total{resource_type}
```

Alerting examples:

1. Spike `WRONG_TENANT` → kemungkinan probing/IDOR attempt.
2. Spike `POLICY_UNAVAILABLE` → PDP/policy deployment incident.
3. Spike `CONTEXT_MISSING` → regression di context propagation.
4. Sudden drop of `DENY` to zero → authorization checks mungkin bypassed.
5. Increase in `indeterminate` → attribute provider/cache/policy issue.

---

## 19. Denial UX: Secure but Actionable

Untuk end-user:

Bad:

```text
You lack CASE_APPROVER_L2 permission and are not assigned to workflow step FINAL_REVIEW.
```

Better:

```text
You are not allowed to approve this case. Contact your administrator if you believe this is incorrect.
```

Untuk internal admin/support screen, bisa lebih kaya:

```text
Access denied.
Reason: User is not assigned as approver for this case stage.
Correlation ID: 01HZ...
```

Tapi pastikan admin/support screen sendiri punya authorization ketat.

---

## 20. Policy Service Unavailable

Jika memakai remote PDP/OPA/Cedar-style service, desain failure eksplisit.

Bad:

```java
try {
    return pdp.decide(input).allowed();
} catch (Exception ex) {
    return true; // keep system available
}
```

Ini catastrophic.

Better:

```java
try {
    return pdp.decide(input);
} catch (TimeoutException ex) {
    audit.indeterminate(input, "PDP_TIMEOUT");
    return AuthorizationDecision.deny(
            DenialCategory.POLICY_UNAVAILABLE,
            "ACCESS_NOT_AVAILABLE",
            "unknown",
            false
    );
}
```

Untuk endpoint low-risk, fallback boleh didesain:

```java
if (operation.isLowRiskReadOnly() && fallbackPolicy.isExplicitlyAllowed(operation)) {
    return fallbackPolicy.decide(input);
}
```

Tetapi fallback harus:

1. Explisit.
2. Teruji.
3. Diaudit.
4. Tidak berlaku untuk write/sensitive read/export/admin.

---

## 21. Attribute Source Failure

ABAC/ReBAC sering butuh attribute/relationship source.

Contoh dependency:

- Org service.
- Assignment service.
- Risk engine.
- Tenant resolver.
- Case state repository.
- Delegation registry.

Jika attribute tidak tersedia, jangan default allow.

```java
Optional<AgencyId> agency = agencyProvider.findAgency(userId);

if (!agency.isPresent()) {
    return AuthorizationDecision.deny(
            DenialCategory.ATTRIBUTE_UNAVAILABLE,
            "ACCESS_NOT_AVAILABLE",
            policyVersion,
            false
    );
}
```

Jika attribute optional, definisikan secara eksplisit:

```text
Missing optional UI preference != authorization context missing.
Missing tenant ID == deny.
Missing case assignment == deny.
Missing risk score for sensitive operation == step-up or deny.
```

---

## 22. TOCTOU: Time-of-Check to Time-of-Use

TOCTOU terjadi ketika authorization check dilakukan, lalu state berubah sebelum action dieksekusi.

Bad:

```java
if (authz.canApprove(user, caseId)) {
    Case c = caseRepository.findById(caseId);
    c.approve();
    caseRepository.save(c);
}
```

Masalah:

- Case bisa di-reassign setelah check.
- Case state bisa berubah.
- User permission bisa dicabut.
- Tenant context bisa bergeser.

Better:

```java
@Transactional
public void approve(User user, CaseId caseId) {
    Case c = caseRepository.findForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.authorize(user, Action.CASE_APPROVE, c);

    c.approve(user.id());
    caseRepository.save(c);
}
```

Lebih kuat lagi: repository update conditional.

```sql
UPDATE cases
SET status = 'APPROVED', approved_by = ?
WHERE id = ?
  AND tenant_id = ?
  AND status = 'PENDING_APPROVAL'
  AND assigned_approver_id = ?
```

Jika affected rows = 0, return `404`, `403`, atau `409` sesuai reason yang bisa ditentukan dengan aman.

---

## 23. Authorization Exception vs Domain Exception

Pisahkan:

```text
AccessDeniedException:
  user tidak boleh melakukan action.

StateConflictException:
  action tidak valid karena state resource.

ValidationException:
  input tidak valid.

PolicyEvaluationException:
  sistem authorization tidak bisa mengevaluasi.
```

Bad:

```java
if (!case.canApprove()) {
    throw new AccessDeniedException("Cannot approve");
}
```

Better:

```java
if (!authorizationService.can(user, Action.CASE_APPROVE, c)) {
    throw new AccessDeniedDomainException(...);
}

if (!c.isPendingApproval()) {
    throw new StateConflictException("CASE_NOT_PENDING_APPROVAL");
}
```

Namun ada overlap: beberapa state rules adalah authorization rules, misalnya maker-checker.

```text
User cannot approve own submission.
```

Ini bisa dianggap authorization denial karena berkaitan dengan subject-action-resource relation.

---

## 24. Masking vs Denial

Tidak semua authorization failure harus menolak seluruh response. Kadang policy mengizinkan view tetapi mewajibkan masking.

Contoh:

```text
Officer boleh melihat case summary, tetapi NRIC dimasking.
Supervisor boleh melihat NRIC penuh.
```

Decision:

```java
public final class AuthorizationObligation {
    private final boolean maskPersonalIdentifiers;
    private final boolean watermarkExport;
    private final boolean redactInternalNotes;
}
```

Failure terjadi jika obligation tidak diterapkan.

Bad:

```java
if (decision.isPermitted()) {
    return caseMapper.toDto(case); // lupa masking
}
```

Better:

```java
CaseDto dto = caseMapper.toDto(case);
obligationApplier.apply(decision.obligations(), dto);
return dto;
```

Jika obligation applier gagal untuk sensitive field, fail closed.

---

## 25. Asynchronous Jobs and Failure Semantics

Async job sering menjadi bypass.

Contoh:

1. User request export.
2. Controller check permission.
3. Job queue menerima request.
4. Worker melakukan export tanpa re-check.
5. Permission user dicabut sebelum job jalan.

Pertanyaan desain:

```text
Authorization dievaluasi saat enqueue, saat execution, atau keduanya?
```

Recommended:

1. Check saat enqueue untuk mencegah request ilegal masuk queue.
2. Check lagi saat execution untuk sensitive operation.
3. Simpan authorization context snapshot.
4. Simpan requester subject ID, tenant ID, action, resource scope, policy version.
5. Jika permission revoked sebelum execution, tentukan policy eksplisit.

Untuk export sensitif, biasanya re-check saat execution.

---

## 26. Messaging Consumer Failure Semantics

Dalam Kafka/RabbitMQ/JMS, authorization failure bisa terjadi saat consumer memproses command/event.

Contoh message:

```json
{
  "command": "APPROVE_CASE",
  "requestedBy": "usr_123",
  "caseId": "CASE-99"
}
```

Jika worker menemukan user tidak boleh approve:

Pilihan:

1. Reject message permanently dan publish domain failure event.
2. Send to DLQ jika message invalid/security suspicious.
3. Ignore jika event sudah obsolete.
4. Retry hanya jika failure transient, misalnya PDP timeout.

Jangan retry infinite untuk `ACCESS_DENIED`, karena itu permanent failure.

Classification:

| Failure | Retry? | Destination |
|---|---|---|
| `POLICY_TIMEOUT` | yes, bounded | retry topic |
| `ATTRIBUTE_TIMEOUT` | yes, bounded | retry topic |
| `ACCESS_DENIED` | no | failure event / audit |
| `WRONG_TENANT` | no | security audit + DLQ if suspicious |
| `STATE_CONFLICT` | no/depends | domain failure |
| malformed command | no | DLQ |

---

## 27. Secure Error Handling Checklist

Gunakan checklist ini setiap kali membuat endpoint/action baru.

### 27.1 Semantics

- [ ] Apakah failure authentication dan authorization dipisah?
- [ ] Apakah `401`, `403`, `404`, `409`, `422`, `503` dipakai secara konsisten?
- [ ] Apakah resource existence perlu disembunyikan?
- [ ] Apakah state conflict tidak dicampur dengan access denied?
- [ ] Apakah step-up punya response contract jelas?

### 27.2 Fail-Secure

- [ ] Jika PDP down, apakah sensitive operation deny?
- [ ] Jika attribute missing, apakah deny?
- [ ] Jika cache miss, apakah recompute atau deny, bukan allow?
- [ ] Jika policy unknown, apakah deny?
- [ ] Jika obligation gagal, apakah deny?

### 27.3 Leakage

- [ ] Apakah error body tidak membocorkan permission internal?
- [ ] Apakah tenant/resource detail tidak bocor?
- [ ] Apakah stack trace tidak keluar ke client?
- [ ] Apakah log tidak menyimpan token/PII/raw body sensitif?

### 27.4 Audit

- [ ] Apakah denial dicatat dengan correlation ID?
- [ ] Apakah policy version dicatat?
- [ ] Apakah reason code internal dicatat?
- [ ] Apakah subject/action/resource/context cukup untuk reconstruct?
- [ ] Apakah concealed 404 tetap dicatat sebagai authorization denial internal?

### 27.5 Bulk/Async

- [ ] Apakah bulk operation punya per-item decision?
- [ ] Apakah async worker re-check untuk operasi sensitif?
- [ ] Apakah retry hanya untuk transient failure?
- [ ] Apakah DLQ tidak menjadi tempat data sensitif bocor?

---

## 28. Common Anti-Patterns

### 28.1 Catch Exception then Allow

```java
try {
    return authz.can(user, action, resource);
} catch (Exception e) {
    return true;
}
```

Ini salah besar.

---

### 28.2 Semua Denial Jadi 500

```java
@ExceptionHandler(Exception.class)
ResponseEntity<?> handle(Exception ex) {
    return ResponseEntity.status(500).body("Internal error");
}
```

Membuat API sulit dipakai dan observability authorization hilang.

---

### 28.3 Semua Jadi 403

Tidak semua failure adalah authorization denial.

- Missing token: `401`.
- State conflict: `409`.
- Validation: `400/422`.
- Resource concealed: `404`.

---

### 28.4 Error Message Terlalu Jujur

```text
You cannot access because this case belongs to tenant SG-CEA and you are tenant SG-MAS.
```

Membocorkan informasi.

---

### 28.5 Hidden 404 Tanpa Audit

Jika external response `404`, internal audit tetap harus tahu ini authorization denial.

---

### 28.6 Retry Infinite untuk Access Denied

`403` biasanya permanent sampai permission berubah. Jangan retry otomatis.

---

### 28.7 Bulk All-or-Nothing Tanpa Alasan

Bulk operation perlu semantics jelas: apakah partial success boleh atau harus atomic.

---

### 28.8 Masking Failure Menjadi Full Data

Jika masking gagal, jangan return data unmasked.

---

## 29. Testing Strategy

### 29.1 Status Code Tests

Test matrix:

| Condition | Expected |
|---|---|
| No token | 401 |
| Invalid token | 401 |
| Valid user no permission | 403 |
| Wrong tenant concealed | 404 |
| State invalid | 409 |
| Step-up needed | 403 with `STEP_UP_REQUIRED` |
| PDP unavailable sensitive action | 403/503 based on contract |

### 29.2 Error Body Tests

Assert:

- No stack trace.
- No internal permission name unless trusted API.
- Correlation ID exists.
- Message stable.
- No resource/tenant sensitive leak.

### 29.3 Audit Tests

For concealed 404:

```text
External: 404 NOT_FOUND
Internal audit: AUTHORIZATION_DENIED reason=WRONG_TENANT
```

### 29.4 Failure Injection Tests

Simulate:

- PDP timeout.
- Policy bundle missing.
- Attribute provider down.
- Cache unavailable.
- Tenant context missing.
- Obligation applier failure.

Expected: fail closed for sensitive actions.

### 29.5 Bulk Tests

Test mixed cases:

```text
[allowed, denied, hidden, state conflict, nonexistent]
```

Expected per-item result consistent.

---

## 30. Example: End-to-End Authorization Failure Handler

```java
public final class AuthorizationHttpMapper {

    public HttpError map(AuthorizationDecision decision, String correlationId) {
        if (decision.isPermitted()) {
            throw new IllegalArgumentException("Cannot map permit to error");
        }

        DenialCategory category = decision.denialCategory();

        switch (category) {
            case UNAUTHENTICATED:
                return new HttpError(401, "AUTHENTICATION_REQUIRED",
                        "Authentication is required to access this resource.", correlationId);

            case RESOURCE_HIDDEN:
            case WRONG_TENANT:
                if (decision.resourceHidden()) {
                    return new HttpError(404, "NOT_FOUND",
                            "Resource not found.", correlationId);
                }
                return new HttpError(403, "ACCESS_DENIED",
                        "You are not allowed to perform this action.", correlationId);

            case STEP_UP_REQUIRED:
                return new HttpError(403, "STEP_UP_REQUIRED",
                        "Additional verification is required to continue.", correlationId);

            case POLICY_UNAVAILABLE:
            case ATTRIBUTE_UNAVAILABLE:
            case CONTEXT_MISSING:
                return new HttpError(403, "ACCESS_NOT_AVAILABLE",
                        "Access cannot be granted at this time.", correlationId);

            default:
                return new HttpError(403, "ACCESS_DENIED",
                        "You are not allowed to perform this action.", correlationId);
        }
    }
}
```

`HttpError`:

```java
public final class HttpError {
    private final int status;
    private final String code;
    private final String message;
    private final String correlationId;

    public HttpError(int status, String code, String message, String correlationId) {
        this.status = status;
        this.code = code;
        this.message = message;
        this.correlationId = correlationId;
    }

    public int status() { return status; }
    public String code() { return code; }
    public String message() { return message; }
    public String correlationId() { return correlationId; }
}
```

---

## 31. Production Readiness Checklist

Authorization failure handling siap production jika:

1. Semua endpoint punya mapping `401/403/404/409/422/503` yang konsisten.
2. `AccessDeniedException` tidak jatuh ke generic 500.
3. Missing policy/context/attribute tidak menghasilkan allow.
4. Concealed resource tetap diaudit internal.
5. Bulk operation punya per-item failure semantics.
6. Async job melakukan re-check untuk sensitive operation.
7. Denial reason internal cukup presisi untuk troubleshooting.
8. Error body eksternal tidak membocorkan policy/resource internal.
9. Metrics denial dan indeterminate dipantau.
10. Spike denial bisa dibedakan antara attack, misconfiguration, dan user behavior normal.
11. Security log punya correlation ID, policy version, action, resource type, tenant boundary, dan reason code.
12. Retry behavior terdokumentasi.
13. Fail-open hanya ada di path low-risk yang disetujui eksplisit.
14. Test failure injection masuk CI/CD.

---

## 32. Top 1% Insight

Top engineer tidak melihat authorization failure sebagai “error response”. Mereka melihatnya sebagai bagian dari **control system**.

Pertanyaan yang selalu diajukan:

```text
Jika authorization dependency gagal, apakah sistem tetap aman?
Jika user salah tenant, apakah resource existence bocor?
Jika denial terjadi, apakah auditor bisa memahami kenapa?
Jika client menerima error, apakah ia tahu tindakan yang benar?
Jika attacker melakukan probing, apakah telemetry menangkap pola itu?
Jika bulk operation campur allowed/denied, apakah hasilnya deterministik?
Jika async job berjalan telat, apakah permission lama masih boleh dipakai?
Jika policy berubah, apakah error behavior tetap konsisten?
```

Authorization failure semantics yang baik membuat sistem:

- lebih aman,
- lebih mudah dioperasikan,
- lebih mudah diaudit,
- lebih mudah ditest,
- lebih tahan terhadap bypass,
- lebih jelas bagi user dan developer.

Authorization yang matang bukan hanya soal “siapa boleh apa”. Ia juga soal **apa yang terjadi ketika jawaban tidak boleh, tidak diketahui, atau tidak bisa dipastikan**.

---

## 33. Ringkasan

Pada bagian ini kita membahas:

1. Authorization failure harus dibedakan dari authentication failure dan business rejection.
2. `401`, `403`, `404`, `409`, `422`, `429`, `500`, dan `503` punya semantics berbeda.
3. Deny-by-default dan fail-secure adalah prinsip utama.
4. Internal reason harus presisi, external error harus aman.
5. Spring Security memisahkan `AuthenticationEntryPoint` dan `AccessDeniedHandler`.
6. Generic exception handler tidak boleh merusak security semantics.
7. Bulk, async, messaging, cache, PDP, dan attribute provider butuh failure semantics eksplisit.
8. Logging dan metrics authorization denial adalah bagian dari security observability.
9. Top-level engineering menuntut failure mode yang bisa diuji, diaudit, dan dipertanggungjawabkan.

---

## 34. Referensi

1. OWASP Authorization Cheat Sheet — prinsip deny-by-default, least privilege, centralized authorization, dan fail-secure access control.
2. OWASP Logging Cheat Sheet — prinsip logging event keamanan dan kehati-hatian terhadap data sensitif.
3. OWASP Application Logging Vocabulary Cheat Sheet — vocabulary untuk event logging.
4. RFC 9110 — HTTP Semantics, termasuk status code semantics untuk `401`, `403`, `404`, dan lainnya.
5. Spring Security Reference — `ExceptionTranslationFilter`, `AuthenticationEntryPoint`, `AccessDeniedHandler`, dan exception handling security flow.
6. OWASP Top 10 / API Security — Broken Access Control dan Broken Object Level Authorization sebagai konteks failure yang harus ditangani secara aman.

---

## 35. Status Seri

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
- Part 25 — Authorization Caching, Performance, and Scalability
- Part 26 — Authorization Failure Semantics and Error Handling

Berikutnya:

- Part 27 — Auditability, Explainability, and Regulatory Defensibility

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-025.md">⬅️ Part 25 — Authorization Caching, Performance, and Scalability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-027.md">Java Authorization Modes and Patterns — Advanced Engineering ➡️</a>
</div>
