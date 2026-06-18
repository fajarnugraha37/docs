# Part 29 — Testing Security: Unit, Integration, Container, Attack Simulation

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-29-testing-security-unit-integration-container-attack-simulation.md`  
> Status: Part 29 dari 35  
> Target: Java 8 sampai Java 25, Java EE/Jakarta EE, Servlet, JAX-RS/Jakarta REST, Jakarta Security, Jakarta Authentication/JASPIC, Jakarta Authorization/JACC, OAuth2/OIDC, SAML-style federation, mTLS, multi-tenant workflow/case-management systems.

---

## 0. Tujuan Part Ini

Part sebelumnya membangun model security dari banyak sudut:

- identity,
- principal,
- role,
- group,
- permission,
- authentication mechanism,
- identity store,
- servlet security,
- OIDC,
- token,
- mTLS,
- domain authorization,
- multi-tenancy,
- browser security,
- error handling,
- audit.

Part ini menjawab pertanyaan berikut:

> Bagaimana kita membuktikan bahwa semua security logic itu benar-benar bekerja, tidak hanya terlihat benar di kode?

Security testing bukan sekadar:

```java
assertTrue(user.hasRole("ADMIN"));
```

Security testing adalah proses membuktikan invariant seperti:

```text
Unauthenticated caller must not access protected resource.
Authenticated caller without permission must not access protected resource.
Caller from tenant A must not read/update tenant B resource.
Maker must not approve own submission.
Expired/revoked/invalid token must not establish identity.
Security context must not leak across async threads.
UI hiding must never be the only enforcement.
Audit must exist for sensitive allowed and denied actions.
```

Dengan kata lain, security testing bukan hanya test API. Security testing adalah test terhadap **trust boundary**, **policy decision**, **policy enforcement**, **identity propagation**, **negative path**, dan **failure semantics**.

---

## 1. Mental Model: Security Testing Menguji Invariant, Bukan Implementasi

Testing biasa sering bertanya:

```text
Apakah method mengembalikan value yang benar?
```

Security testing bertanya:

```text
Apakah sistem tetap aman ketika caller, state, token, tenant, role, request path, header, cookie, timing, dan dependency berada dalam kondisi tidak ideal?
```

Perbedaan penting:

| Testing umum | Security testing |
|---|---|
| Banyak fokus happy path | Banyak fokus negative path |
| Input valid sering dominan | Input hostile harus dominan |
| Bug = output salah | Bug = privilege escalation, data leak, impersonation, bypass |
| Mock cukup sering memadai | Mock sering menutupi bug integrasi security |
| Test behavior lokal | Test boundary end-to-end |
| Failure kadang boleh eksplisit | Failure harus fail-closed |

Security bug sering tidak muncul saat:

- user memang admin,
- token valid,
- tenant benar,
- path normal,
- session fresh,
- request berasal dari UI resmi,
- semua dependency tersedia.

Security bug muncul saat:

- role berubah tetapi session masih lama,
- JWT valid tetapi audience salah,
- token ID dipakai sebagai access token,
- UI menyembunyikan tombol tetapi API tetap terbuka,
- endpoint baru lupa diberi annotation,
- JAX-RS filter berjalan post-match padahal path tertentu harus pre-match,
- `X-User` header dipercaya tanpa gateway boundary,
- async job kehilangan actor dan berjalan sebagai system admin,
- tenant id dari URL tidak cocok dengan tenant id di token,
- object id bisa ditebak dan repository tidak tenant-scoped.

Maka security test harus selalu dibangun dari invariant.

---

## 2. Layer Testing Security

Gunakan beberapa layer. Jangan berharap satu jenis test menutup semua risiko.

```text
┌─────────────────────────────────────────────────────────────┐
│  Attack simulation / abuse-case testing                      │
│  - bypass, replay, tenant swap, role mutation, CSRF, IDOR     │
├─────────────────────────────────────────────────────────────┤
│  End-to-end / system tests                                   │
│  - browser/API/gateway/container/IdP/database                 │
├─────────────────────────────────────────────────────────────┤
│  Container integration tests                                 │
│  - Servlet/JAX-RS/Jakarta Security container behavior         │
├─────────────────────────────────────────────────────────────┤
│  API integration tests                                       │
│  - HTTP status, headers, token validation, error semantics    │
├─────────────────────────────────────────────────────────────┤
│  Authorization policy tests                                  │
│  - subject/action/resource/tenant/state/relationship matrix   │
├─────────────────────────────────────────────────────────────┤
│  Unit tests                                                  │
│  - pure policy rules, mapping functions, validators           │
└─────────────────────────────────────────────────────────────┘
```

Setiap layer punya fungsi:

| Layer | Yang diuji | Risiko kalau tidak ada |
|---|---|---|
| Unit | policy rule lokal, mapper, parser | bug logic kecil tidak terlihat |
| Policy matrix | kombinasi role/state/tenant/action | privilege escalation karena kombinasi langka |
| API integration | HTTP behavior nyata | salah status, challenge, filter order |
| Container integration | Jakarta/Servlet/JAX-RS behavior | annotation/filter/security context tidak jalan |
| IdP integration | OIDC/JWT/SAML-like flow | mock token menipu, issuer/audience/JWKS bug lolos |
| E2E | user journey penuh | UI/API mismatch, session/logout bug |
| Attack simulation | bypass path | asumsi trust boundary salah |

Prinsip penting:

> Mock boleh dipakai untuk mempercepat unit test, tetapi security boundary utama harus diuji dengan runtime yang mendekati production.

---

## 3. Apa yang Wajib Diuji dalam Security System

Minimal ada 12 kategori.

### 3.1 Authentication Tests

Pertanyaan inti:

```text
Apakah caller benar-benar terbukti identitasnya sebelum diberi identity di aplikasi?
```

Test case:

1. Anonymous request ke protected endpoint → 401 atau redirect login.
2. Invalid credential → gagal tanpa account enumeration.
3. Disabled account → gagal.
4. Locked account → gagal.
5. Expired password/session/token → gagal.
6. Wrong issuer token → gagal.
7. Wrong audience token → gagal.
8. Expired JWT → gagal.
9. JWT signed with unknown key → gagal.
10. JWT dengan `alg=none` atau algorithm confusion → gagal.
11. Token ID dipakai sebagai access token → gagal.
12. Missing nonce/state pada OIDC callback → gagal.
13. Client certificate tidak trusted → gagal.
14. Header identity tanpa trusted proxy → gagal.

### 3.2 Authorization Tests

Pertanyaan inti:

```text
Apakah caller hanya dapat melakukan action yang memang diizinkan?
```

Test case:

1. User tanpa role → 403.
2. User role salah → 403.
3. User role benar tapi tenant salah → 403 atau 404 concealment.
4. User role benar tapi state salah → 409/403 sesuai kontrak.
5. User pemilik data tetapi permission action tidak ada → 403.
6. User bukan assignee mencoba approve → 403.
7. Maker mencoba approve sendiri → 403.
8. Delegation expired → 403.
9. Break-glass tanpa reason → 403.
10. Admin global mencoba endpoint tenant-scoped tanpa explicit scope → 403.

### 3.3 Identity Mapping Tests

Pertanyaan inti:

```text
Apakah claim/group/scope eksternal dipetakan menjadi role aplikasi secara benar dan aman?
```

Test case:

1. Unknown group tidak otomatis jadi role.
2. Group dari issuer lain tidak diterima.
3. Role client A tidak berlaku untuk client B.
4. Scope API tidak diperlakukan sebagai domain permission tanpa mapping.
5. `sub` sama tapi issuer berbeda tidak dianggap user yang sama.
6. Email berubah tidak membuat account baru sembarangan.
7. Role rename di IdP tidak langsung merusak business code.
8. Claim tenant tidak cocok dengan active tenant → gagal.

### 3.4 Session Tests

Pertanyaan inti:

```text
Apakah post-login state aman selama lifecycle session?
```

Test case:

1. Session id berubah setelah login.
2. Logout invalidates session.
3. Setelah logout, protected resource tidak dapat diakses via old cookie.
4. Idle timeout bekerja.
5. Absolute timeout bekerja.
6. Session role stale ditangani sesuai policy.
7. Concurrent login policy sesuai requirement.
8. Cookie memiliki `Secure`, `HttpOnly`, `SameSite`, path/domain benar.
9. Back button setelah logout tidak membocorkan protected data.
10. Cluster node berbeda tetap konsisten.

### 3.5 Token Tests

Pertanyaan inti:

```text
Apakah token dianggap valid hanya jika semua invariant terpenuhi?
```

Test case:

1. Expired token ditolak.
2. `nbf` future ditolak.
3. Wrong issuer ditolak.
4. Wrong audience ditolak.
5. Wrong `azp` ditolak jika relevan.
6. Unknown `kid` ditolak atau JWKS refresh aman.
7. Revoked opaque token ditolak.
8. Introspection unavailable fail-closed untuk endpoint sensitif.
9. Token untuk API A tidak bisa dipakai API B.
10. Refresh token tidak diterima sebagai access token.

### 3.6 Multi-Tenant Tests

Pertanyaan inti:

```text
Apakah tenant adalah security boundary nyata, bukan sekadar filter UI?
```

Test case:

1. Tenant A user membaca tenant B record by id → denied.
2. Tenant A user update tenant B record → denied.
3. Search/list endpoint tidak mengembalikan data tenant lain.
4. Count endpoint tidak membocorkan jumlah data tenant lain.
5. Export/report endpoint tenant-scoped.
6. Cache key mengandung tenant id.
7. Message/event membawa tenant context.
8. Active tenant switch memvalidasi membership.
9. Admin cross-tenant tetap explicit dan audited.

### 3.7 Workflow/Case-Management Authorization Tests

Pertanyaan inti:

```text
Apakah permission mengikuti state, assignment, role, dan segregation-of-duties?
```

Test case:

1. Draft hanya bisa diedit creator/assignee.
2. Submitted tidak bisa diedit kecuali allowed transition.
3. Approved case tidak bisa diapprove lagi.
4. Maker tidak bisa approve.
5. Reviewer hanya bisa approve jika assigned.
6. Escalated case hanya bisa diambil role tertentu.
7. Reopen butuh permission khusus.
8. Delegated approval mencatat original actor dan delegate actor.
9. Transition authorization dan transition execution atomic.
10. Concurrent approve oleh dua officer tidak menghasilkan double decision.

### 3.8 Browser Security Tests

Pertanyaan inti:

```text
Apakah browser behavior tidak bisa dimanfaatkan untuk memaksa request atau mencuri data?
```

Test case:

1. CSRF token wajib untuk state-changing request cookie-based.
2. Missing CSRF token → denied.
3. Wrong CSRF token → denied.
4. Cross-origin credentialed CORS hanya origin whitelist.
5. `Access-Control-Allow-Origin: *` tidak dipakai dengan credentials.
6. Clickjacking header/CSP ada.
7. Open redirect dicegah.
8. Login callback `state` tervalidasi.
9. Logout CSRF dipertimbangkan sesuai risk.
10. Token tidak disimpan di tempat yang tidak sesuai threat model.

### 3.9 Gateway/Proxy Boundary Tests

Pertanyaan inti:

```text
Apakah aplikasi hanya mempercayai header/proxy identity dari boundary yang memang trusted?
```

Test case:

1. Direct request dengan `X-User: admin` ditolak.
2. Trusted header hanya diterima dari network/source tertentu.
3. `X-Forwarded-Proto` spoof tidak membuat app menganggap HTTP sebagai HTTPS.
4. Host header poisoning dicegah.
5. Path rewrite tidak membuka endpoint internal.
6. Gateway-denied request tidak bisa bypass via internal route.
7. Internal admin endpoint tidak exposed public.

### 3.10 Audit Tests

Pertanyaan inti:

```text
Apakah allowed/denied sensitive action meninggalkan bukti yang cukup?
```

Test case:

1. Login success/failure audited.
2. Logout audited.
3. Authorization denial audited untuk action penting.
4. Approval/rejection audited dengan actor, resource, tenant, decision.
5. Break-glass audited dengan reason.
6. Delegated action audited dengan initiator dan delegate.
7. Audit event tidak menyimpan password/token raw.
8. Audit event committed atomically atau via outbox.
9. Correlation id konsisten.
10. Audit read access restricted.

### 3.11 Error Handling Tests

Pertanyaan inti:

```text
Apakah error aman, tidak bocor, tetapi cukup berguna untuk troubleshooting?
```

Test case:

1. Anonymous API → 401.
2. Authenticated but unauthorized → 403.
3. Concealed resource → 404 jika policy begitu.
4. Workflow conflict → 409.
5. Account enumeration dicegah.
6. Token error memakai `WWW-Authenticate` sesuai kontrak API.
7. Correlation id muncul.
8. Detail internal tidak bocor ke client.
9. Log internal cukup untuk debugging.

### 3.12 Context Propagation Tests

Pertanyaan inti:

```text
Apakah actor/tenant/security context tidak hilang atau bocor saat execution berpindah thread/unit kerja?
```

Test case:

1. Async task tidak berjalan sebagai previous user.
2. CompletableFuture tidak kehilangan tenant context tanpa explicit propagation.
3. Managed executor membawa atau membersihkan context sesuai desain.
4. Scheduled job memakai system actor yang explicit.
5. Message consumer memakai actor dari event metadata, bukan request thread lama.
6. MDC/correlation id dibersihkan setelah request.
7. Virtual thread tidak dianggap otomatis menyelesaikan context propagation.

---

## 4. Testing Strategy Berdasarkan Security Architecture

Sebelum menulis test, klasifikasikan security decision.

```text
Decision type:
1. Authentication decision
2. Role/group mapping decision
3. Web resource authorization decision
4. Method authorization decision
5. Domain authorization decision
6. Data access scoping decision
7. Session/token lifecycle decision
8. Browser boundary decision
9. Proxy/gateway trust decision
10. Audit decision
```

Setiap decision harus punya test owner.

Contoh:

| Decision | Enforcement point | Test style |
|---|---|---|
| `/admin/*` requires admin | Servlet container | container integration test |
| `approveCase()` requires approver | method interceptor | integration + unit policy test |
| maker cannot approve own case | domain authorization service | unit + concurrency integration test |
| tenant A cannot access tenant B | repository/service boundary | integration + property-like test |
| JWT audience must match API | auth filter/mechanism | API integration test |
| CSRF required for POST | servlet filter | HTTP integration test |
| logout invalidates session | Servlet/session | E2E/API test |
| audit created for denial | audit service/outbox | integration test |

Rule of thumb:

```text
If it protects a boundary, test it at the boundary.
If it encodes business policy, test it as pure policy and through API.
If it depends on container behavior, test it in a container.
If it depends on IdP behavior, test it with a real or realistic IdP.
```

---

## 5. Unit Testing Authorization Policy

Domain authorization sebaiknya dipisah dari framework agar bisa diuji deterministik.

### 5.1 Bad Design: Policy Terkubur dalam Controller

```java
@Path("/cases/{caseId}/approve")
public class CaseApprovalResource {

    @POST
    public Response approve(@PathParam("caseId") Long caseId) {
        Case c = caseRepository.findById(caseId);

        if (!securityContext.isCallerInRole("APPROVER")) {
            return Response.status(403).build();
        }

        if (c.getCreatedBy().equals(securityContext.getCallerPrincipal().getName())) {
            return Response.status(403).build();
        }

        c.approve();
        return Response.ok().build();
    }
}
```

Masalah:

- susah diuji semua kombinasi,
- authorization tercampur transport,
- denial reason tidak konsisten,
- risk duplicate policy di endpoint lain,
- sulit audit.

### 5.2 Better Design: Policy Service Pure

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String code;
    private final String reason;

    private AuthorizationDecision(boolean allowed, String code, String reason) {
        this.allowed = allowed;
        this.code = code;
        this.reason = reason;
    }

    public static AuthorizationDecision allow() {
        return new AuthorizationDecision(true, "ALLOW", "Allowed");
    }

    public static AuthorizationDecision deny(String code, String reason) {
        return new AuthorizationDecision(false, code, reason);
    }

    public boolean isAllowed() {
        return allowed;
    }

    public String getCode() {
        return code;
    }

    public String getReason() {
        return reason;
    }
}
```

```java
public final class Actor {
    private final String subjectId;
    private final String tenantId;
    private final Set<String> roles;

    public Actor(String subjectId, String tenantId, Set<String> roles) {
        this.subjectId = subjectId;
        this.tenantId = tenantId;
        this.roles = roles == null ? Collections.emptySet() : Collections.unmodifiableSet(new HashSet<>(roles));
    }

    public String subjectId() {
        return subjectId;
    }

    public String tenantId() {
        return tenantId;
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }
}
```

```java
public final class CaseSnapshot {
    private final String id;
    private final String tenantId;
    private final String createdBy;
    private final String assignedTo;
    private final String state;

    public CaseSnapshot(String id, String tenantId, String createdBy, String assignedTo, String state) {
        this.id = id;
        this.tenantId = tenantId;
        this.createdBy = createdBy;
        this.assignedTo = assignedTo;
        this.state = state;
    }

    public String id() { return id; }
    public String tenantId() { return tenantId; }
    public String createdBy() { return createdBy; }
    public String assignedTo() { return assignedTo; }
    public String state() { return state; }
}
```

```java
public final class CaseAuthorizationPolicy {

    public AuthorizationDecision canApprove(Actor actor, CaseSnapshot c) {
        if (actor == null) {
            return AuthorizationDecision.deny("AUTHN_REQUIRED", "Caller is not authenticated");
        }

        if (!actor.tenantId().equals(c.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH", "Caller cannot access this tenant");
        }

        if (!actor.hasRole("CASE_APPROVER")) {
            return AuthorizationDecision.deny("MISSING_ROLE", "Caller is not a case approver");
        }

        if (!"SUBMITTED".equals(c.state())) {
            return AuthorizationDecision.deny("INVALID_STATE", "Case is not in approvable state");
        }

        if (actor.subjectId().equals(c.createdBy())) {
            return AuthorizationDecision.deny("SOD_VIOLATION", "Maker cannot approve own case");
        }

        if (!actor.subjectId().equals(c.assignedTo())) {
            return AuthorizationDecision.deny("NOT_ASSIGNED", "Case is not assigned to caller");
        }

        return AuthorizationDecision.allow();
    }
}
```

### 5.3 Unit Test Matrix

```java
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class CaseAuthorizationPolicyTest {

    private final CaseAuthorizationPolicy policy = new CaseAuthorizationPolicy();

    @Test
    void approverAssignedDifferentFromMakerSameTenantSubmitted_canApprove() {
        Actor actor = new Actor("u-approver", "tenant-a", Set.of("CASE_APPROVER"));
        CaseSnapshot c = new CaseSnapshot("case-1", "tenant-a", "u-maker", "u-approver", "SUBMITTED");

        AuthorizationDecision decision = policy.canApprove(actor, c);

        assertTrue(decision.isAllowed());
    }

    @Test
    void anonymous_cannotApprove() {
        CaseSnapshot c = new CaseSnapshot("case-1", "tenant-a", "u-maker", "u-approver", "SUBMITTED");

        AuthorizationDecision decision = policy.canApprove(null, c);

        assertFalse(decision.isAllowed());
        assertEquals("AUTHN_REQUIRED", decision.getCode());
    }

    @Test
    void differentTenant_cannotApprove() {
        Actor actor = new Actor("u-approver", "tenant-b", Set.of("CASE_APPROVER"));
        CaseSnapshot c = new CaseSnapshot("case-1", "tenant-a", "u-maker", "u-approver", "SUBMITTED");

        AuthorizationDecision decision = policy.canApprove(actor, c);

        assertFalse(decision.isAllowed());
        assertEquals("TENANT_MISMATCH", decision.getCode());
    }

    @Test
    void makerCannotApproveOwnCase() {
        Actor actor = new Actor("u-maker", "tenant-a", Set.of("CASE_APPROVER"));
        CaseSnapshot c = new CaseSnapshot("case-1", "tenant-a", "u-maker", "u-maker", "SUBMITTED");

        AuthorizationDecision decision = policy.canApprove(actor, c);

        assertFalse(decision.isAllowed());
        assertEquals("SOD_VIOLATION", decision.getCode());
    }
}
```

Unit test policy harus cepat, banyak, dan eksplisit.

Namun jangan berhenti di sini. Test ini membuktikan policy function benar, tetapi belum membuktikan endpoint benar-benar memanggil policy.

---

## 6. Permission Matrix Testing

Untuk sistem enterprise, kombinasi authorization cepat meledak.

Contoh dimensi:

```text
role: maker, reviewer, supervisor, admin
state: draft, submitted, under_review, approved, rejected, escalated
relationship: creator, assignee, team_member, unrelated
tenant: same, different
action: view, edit, submit, approve, reject, reassign, reopen, export
```

Total kombinasi:

```text
4 × 6 × 4 × 2 × 8 = 1536 cases
```

Tidak semua harus ditulis manual. Tapi matrix harus eksplisit.

### 6.1 Permission Matrix as Data

```java
public final class PermissionTestCase {
    final String name;
    final Actor actor;
    final CaseSnapshot resource;
    final boolean expectedAllowed;
    final String expectedCode;

    public PermissionTestCase(
            String name,
            Actor actor,
            CaseSnapshot resource,
            boolean expectedAllowed,
            String expectedCode
    ) {
        this.name = name;
        this.actor = actor;
        this.resource = resource;
        this.expectedAllowed = expectedAllowed;
        this.expectedCode = expectedCode;
    }
}
```

```java
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class CaseApprovalMatrixTest {

    private final CaseAuthorizationPolicy policy = new CaseAuthorizationPolicy();

    static Stream<PermissionTestCase> approvalCases() {
        return Stream.of(
                new PermissionTestCase(
                        "assigned approver, same tenant, submitted",
                        new Actor("approver-1", "tenant-a", Set.of("CASE_APPROVER")),
                        new CaseSnapshot("case-1", "tenant-a", "maker-1", "approver-1", "SUBMITTED"),
                        true,
                        "ALLOW"
                ),
                new PermissionTestCase(
                        "approver but draft state",
                        new Actor("approver-1", "tenant-a", Set.of("CASE_APPROVER")),
                        new CaseSnapshot("case-1", "tenant-a", "maker-1", "approver-1", "DRAFT"),
                        false,
                        "INVALID_STATE"
                ),
                new PermissionTestCase(
                        "approver but not assigned",
                        new Actor("approver-2", "tenant-a", Set.of("CASE_APPROVER")),
                        new CaseSnapshot("case-1", "tenant-a", "maker-1", "approver-1", "SUBMITTED"),
                        false,
                        "NOT_ASSIGNED"
                )
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("approvalCases")
    void approvalMatrix(PermissionTestCase tc) {
        AuthorizationDecision decision = policy.canApprove(tc.actor, tc.resource);

        assertEquals(tc.expectedAllowed, decision.isAllowed());
        assertEquals(tc.expectedCode, decision.getCode());
    }
}
```

### 6.2 Matrix Lebih Baik Disimpan Dekat dengan Requirement

Untuk sistem regulated, permission matrix sering lebih baik menjadi artifact eksplisit:

```text
| Action  | State     | Role          | Relationship | Tenant | Expected |
|---------|-----------|---------------|--------------|--------|----------|
| approve | submitted | CASE_APPROVER | assignee     | same   | allow    |
| approve | submitted | CASE_APPROVER | creator      | same   | deny     |
| approve | draft     | CASE_APPROVER | assignee     | same   | deny     |
| view    | approved  | CASE_VIEWER   | unrelated    | same   | allow    |
| view    | approved  | CASE_VIEWER   | unrelated    | other  | deny     |
```

Kemudian test generator membaca matrix tersebut.

Keuntungan:

- business/BA/QA bisa review,
- regression lebih jelas,
- auditability meningkat,
- perubahan policy lebih terkontrol.

---

## 7. Testing `SecurityContext`

Jakarta Security `SecurityContext` adalah API aplikasi untuk melihat caller principal, role, dan melakukan check tertentu. Jakarta Security specification menyatakan `SecurityContext` tersedia di Servlet container dan enterprise beans container; container lain boleh menyediakan tetapi tidak wajib.

### 7.1 Jangan Mock Semua Hal Tanpa Kontrak

Bad test:

```java
when(securityContext.isCallerInRole("ADMIN")).thenReturn(true);
```

Test ini hanya membuktikan mock mengembalikan true.

Better:

- test mapping `SecurityContext` → `Actor`,
- test domain policy pure,
- test endpoint dalam container/runtime untuk memastikan role benar sampai ke `SecurityContext`.

### 7.2 Mapping SecurityContext to Actor

```java
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

@RequestScoped
public class CurrentActorProvider {

    @Inject
    SecurityContext securityContext;

    public Actor currentActor(String activeTenantId) {
        if (securityContext.getCallerPrincipal() == null) {
            return null;
        }

        Set<String> roles = new HashSet<>();
        if (securityContext.isCallerInRole("CASE_APPROVER")) {
            roles.add("CASE_APPROVER");
        }
        if (securityContext.isCallerInRole("CASE_VIEWER")) {
            roles.add("CASE_VIEWER");
        }

        return new Actor(
                securityContext.getCallerPrincipal().getName(),
                activeTenantId,
                roles
        );
    }
}
```

Unit test untuk provider boleh memakai fake adapter, tapi endpoint integration test harus membuktikan role container benar.

### 7.3 Test Contract untuk Actor Provider

```java
interface CallerSecurityView {
    String principalName();
    boolean hasRole(String role);
}
```

```java
final class SecurityContextCallerSecurityView implements CallerSecurityView {
    private final SecurityContext securityContext;

    SecurityContextCallerSecurityView(SecurityContext securityContext) {
        this.securityContext = securityContext;
    }

    @Override
    public String principalName() {
        return securityContext.getCallerPrincipal() == null
                ? null
                : securityContext.getCallerPrincipal().getName();
    }

    @Override
    public boolean hasRole(String role) {
        return securityContext.isCallerInRole(role);
    }
}
```

Dengan adapter seperti ini, policy/mapping bisa diuji tanpa membawa seluruh container ke unit test.

---

## 8. Testing Declarative Authorization

Declarative authorization memakai metadata seperti:

- `web.xml` security constraints,
- `@ServletSecurity`,
- `@RolesAllowed`,
- `@PermitAll`,
- `@DenyAll`,
- EJB/CDI/JAX-RS integration.

Unit test biasa tidak cukup. Harus ada integration test yang mengakses endpoint nyata.

### 8.1 Test Matrix untuk Endpoint

```text
Endpoint                  Anonymous   USER   ADMIN   Expected
GET /public/health        200         200    200     public
GET /api/profile          401         200    200     authenticated
GET /api/admin/users      401         403    200     admin only
POST /api/cases           401         201    201     authenticated
POST /api/cases/{id}/approve 401      403/200 based policy  based policy
```

### 8.2 Example HTTP Test Style

Pseudo-code dengan client HTTP:

```java
@Test
void anonymousCannotAccessAdminUsers() {
    HttpResponse response = http.get("/api/admin/users");

    assertEquals(401, response.statusCode());
}

@Test
void normalUserCannotAccessAdminUsers() {
    String token = tokenFactory.accessToken("user-1", Set.of("USER"));

    HttpResponse response = http.get("/api/admin/users", bearer(token));

    assertEquals(403, response.statusCode());
}

@Test
void adminCanAccessAdminUsers() {
    String token = tokenFactory.accessToken("admin-1", Set.of("ADMIN"));

    HttpResponse response = http.get("/api/admin/users", bearer(token));

    assertEquals(200, response.statusCode());
}
```

### 8.3 Test Missing Annotation

Salah satu bug umum:

```java
@Path("/admin/reindex")
public class AdminReindexResource {

    @POST
    public Response reindex() {
        // forgot @RolesAllowed("ADMIN")
        return Response.accepted().build();
    }
}
```

Test harus punya scanner/checklist:

```text
All non-public JAX-RS resources must have one of:
- @RolesAllowed
- @PermitAll
- @DenyAll
- custom @Secured annotation
- protected by class-level annotation
```

Bisa dibuat reflection test:

```java
@Test
void everyResourceMethodHasAuthorizationAnnotationOrInheritedPolicy() {
    List<Method> violations = ResourceScanner.findAllResourceMethods().stream()
            .filter(method -> !AuthorizationAnnotationInspector.hasEffectiveSecurityAnnotation(method))
            .collect(Collectors.toList());

    assertTrue(violations.isEmpty(), "Missing authorization annotation: " + violations);
}
```

Ini bukan pengganti runtime test, tetapi sangat efektif menangkap endpoint baru yang lupa diamankan.

---

## 9. Testing JAX-RS Filters and Servlet Filters

Jakarta REST `ContainerRequestFilter` dapat berjalan global atau dengan name binding. Default-nya filter global post-match jika tidak `@PreMatching`; name-bound filter berjalan pada matched resource/method yang sesuai. Ini penting karena security filter yang salah fase bisa membuat endpoint tertentu tidak terproteksi.

### 9.1 JAX-RS Filter Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerTokenAuthenticationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String authorization = requestContext.getHeaderString("Authorization");

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
            return;
        }

        // validate token, establish security context, etc.
    }
}
```

Test:

```text
- missing Authorization header -> 401
- malformed Authorization header -> 401
- invalid token -> 401
- valid token but no role -> 403 at authorization layer
- valid token with role -> 200
```

### 9.2 Servlet Filter Ordering Test

If filter order is wrong:

```text
CSRF filter before authentication? sometimes yes.
Audit filter before auth? should capture anonymous and authenticated.
Exception mapper after security? should not convert 401/403 incorrectly.
CORS preflight before auth? often must allow OPTIONS correctly.
```

Test OPTIONS:

```java
@Test
void corsPreflightDoesNotRequireBearerTokenButOnlyForAllowedOriginAndMethod() {
    HttpResponse response = http.options("/api/cases")
            .header("Origin", "https://app.example.com")
            .header("Access-Control-Request-Method", "POST")
            .send();

    assertEquals(204, response.statusCode());
    assertEquals("https://app.example.com", response.header("Access-Control-Allow-Origin"));
}
```

Anti-test:

```java
@Test
void corsPreflightFromEvilOriginRejected() {
    HttpResponse response = http.options("/api/cases")
            .header("Origin", "https://evil.example")
            .header("Access-Control-Request-Method", "POST")
            .send();

    assertTrue(response.statusCode() == 403 || response.header("Access-Control-Allow-Origin") == null);
}
```

---

## 10. Testing OIDC Login Flow

OIDC testing punya dua level:

1. test token/resource server behavior,
2. test browser login redirect/callback/session behavior.

### 10.1 Jangan Hanya Generate JWT Sendiri

JWT buatan test berguna untuk unit/integration ringan, tetapi tidak cukup untuk menguji:

- discovery document,
- JWKS retrieval,
- key rotation,
- issuer metadata,
- redirect URI,
- state,
- nonce,
- callback handler,
- session creation,
- logout.

Gunakan real IdP test container atau embedded IdP realistis untuk test end-to-end.

Testcontainers Keycloak module memungkinkan testing aplikasi dengan server Keycloak nyata daripada mock, sehingga setup lebih mirip production.

### 10.2 Token Validation Test Matrix

```text
Case                                Expected
valid issuer + audience + signature 200
expired token                       401
wrong issuer                        401
wrong audience                      401
unknown kid                         401 or JWKS refresh then 200 if key available
wrong alg                           401
missing scope                       403
missing group                       403
ID token used as access token       401
```

### 10.3 OIDC Login Callback Tests

```text
- callback missing code -> fail
- callback missing state -> fail
- callback state mismatch -> fail
- callback nonce mismatch -> fail
- authorization code replay -> fail
- redirect URI mismatch -> fail
- account linking issuer+sub correct -> success
- same email different issuer -> no automatic merge unless policy explicit
```

### 10.4 Logout Tests

```text
- local logout invalidates app session
- RP-initiated logout redirects to IdP logout endpoint if configured
- back-channel logout invalidates matching session
- logout from app A affects app B only if SSO/global logout is intended
- old session cookie after logout rejected
```

---

## 11. Testing mTLS and Client Certificate Authentication

mTLS testing sering diabaikan karena setup lebih berat. Tetapi kalau mTLS dipakai sebagai strong caller authentication, test wajib ada.

### 11.1 What to Test

```text
- valid client certificate accepted
- expired certificate rejected
- certificate signed by unknown CA rejected
- missing client certificate rejected for CLIENT-CERT endpoint
- wrong certificate mapped to no principal
- revoked certificate rejected if revocation policy active
- proxy forwarded client cert header rejected unless proxy trusted
- direct spoofed certificate header rejected
```

### 11.2 Java Client mTLS Test Shape

Pseudo-code:

```java
SSLContext sslContext = MtlsTestSslContextFactory.clientContext(
        "client-keystore.p12",
        "client-password",
        "server-truststore.p12",
        "trust-password"
);

HttpClient client = HttpClient.newBuilder()
        .sslContext(sslContext)
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(baseUrl + "/api/mtls/profile"))
        .GET()
        .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

assertEquals(200, response.statusCode());
```

Negative test with no cert:

```java
HttpClient noCertClient = HttpClient.newHttpClient();

HttpResponse<String> response = noCertClient.send(request, HttpResponse.BodyHandlers.ofString());

assertTrue(response.statusCode() == 400 || response.statusCode() == 401 || response.statusCode() == 403);
```

Status code bisa berbeda tergantung termination layer, tetapi invariant-nya sama: no identity established.

---

## 12. Testing Multi-Tenancy and BOLA/IDOR

BOLA/IDOR adalah salah satu kategori bug authorization paling umum: caller mengganti id resource di URL/body dan mendapat data milik orang/tenant lain.

### 12.1 Bad Endpoint Pattern

```java
@GET
@Path("/cases/{id}")
public CaseDto getCase(@PathParam("id") String id) {
    return caseRepository.findById(id).toDto();
}
```

Masalah: tidak ada tenant/authorization check.

### 12.2 Tenant-Safe Endpoint Test

```java
@Test
void tenantACannotReadTenantBCaseByGuessingId() {
    String tenantAToken = tokenFactory.accessToken("user-a", "tenant-a", Set.of("CASE_VIEWER"));
    String tenantBCaseId = fixtures.caseInTenant("tenant-b").id();

    HttpResponse response = http.get("/api/cases/" + tenantBCaseId, bearer(tenantAToken));

    assertTrue(response.statusCode() == 403 || response.statusCode() == 404);
}
```

### 12.3 List Endpoint Test

```java
@Test
void tenantAListDoesNotContainTenantBRecords() {
    String token = tokenFactory.accessToken("user-a", "tenant-a", Set.of("CASE_VIEWER"));

    fixtures.caseInTenant("tenant-a");
    CaseFixture b = fixtures.caseInTenant("tenant-b");

    HttpResponse response = http.get("/api/cases", bearer(token));

    assertEquals(200, response.statusCode());
    assertFalse(response.body().contains(b.id()));
}
```

### 12.4 Mutation Testing Idea for Tenant

Untuk setiap endpoint yang menerima id:

```text
Given resource belongs to tenant X
When caller from tenant Y requests it
Then deny/conceal
```

Buat generator yang otomatis:

- membuat resource tenant A dan B,
- mengambil id tenant B,
- mencoba akses dengan token tenant A,
- memastikan tidak bocor.

Ini lebih kuat daripada hanya test satu endpoint manual.

---

## 13. Testing Workflow Race Conditions

Authorization yang benar pada awal request bisa menjadi salah sebelum commit.

Contoh:

```text
T1: user A checks canApprove(case state=SUBMITTED)
T2: user B approves same case, state becomes APPROVED
T1: user A continues and approves again
```

### 13.1 Test Concurrent Approval

```java
@Test
void twoApproversCannotApproveSameCaseTwice() throws Exception {
    CaseFixture c = fixtures.submittedCaseAssignedToTeam("tenant-a");
    String tokenA = tokenFactory.accessToken("approver-a", "tenant-a", Set.of("CASE_APPROVER"));
    String tokenB = tokenFactory.accessToken("approver-b", "tenant-a", Set.of("CASE_APPROVER"));

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);

    Callable<Integer> approveA = () -> {
        ready.countDown();
        start.await();
        return http.post("/api/cases/" + c.id() + "/approve", bearer(tokenA)).statusCode();
    };

    Callable<Integer> approveB = () -> {
        ready.countDown();
        start.await();
        return http.post("/api/cases/" + c.id() + "/approve", bearer(tokenB)).statusCode();
    };

    Future<Integer> f1 = executor.submit(approveA);
    Future<Integer> f2 = executor.submit(approveB);

    ready.await();
    start.countDown();

    Set<Integer> statuses = Set.of(f1.get(), f2.get());

    assertTrue(statuses.contains(200));
    assertTrue(statuses.contains(409) || statuses.contains(403));

    assertEquals(1, auditRepository.countApprovalEvents(c.id()));
}
```

### 13.2 Database Constraint Still Needed

Testing harus membuktikan bukan hanya policy service yang benar, tapi persistence boundary juga aman.

Pattern:

```sql
UPDATE case_table
SET state = 'APPROVED', version = version + 1
WHERE id = ?
  AND tenant_id = ?
  AND state = 'SUBMITTED'
  AND version = ?
```

Jika affected rows = 0, return 409.

Authorization dan state transition harus dekat dengan transaction.

---

## 14. Testing CSRF and CORS

### 14.1 CSRF Test

Cookie-authenticated state-changing endpoint wajib diuji tanpa CSRF token.

```java
@Test
void postWithoutCsrfTokenIsRejectedForCookieSession() {
    Session session = browser.login("user", "password");

    HttpResponse response = http.post("/api/cases")
            .cookie(session.cookie())
            .json("{\"title\":\"x\"}")
            .send();

    assertEquals(403, response.statusCode());
}
```

With token:

```java
@Test
void postWithValidCsrfTokenSucceeds() {
    Session session = browser.login("user", "password");
    String csrf = browser.fetchCsrfToken(session);

    HttpResponse response = http.post("/api/cases")
            .cookie(session.cookie())
            .header("X-CSRF-Token", csrf)
            .json("{\"title\":\"x\"}")
            .send();

    assertEquals(201, response.statusCode());
}
```

### 14.2 CORS Test

```java
@Test
void credentialedCorsOnlyAllowsWhitelistedOrigin() {
    HttpResponse response = http.options("/api/cases")
            .header("Origin", "https://app.example.com")
            .header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "content-type,x-csrf-token")
            .send();

    assertEquals("https://app.example.com", response.header("Access-Control-Allow-Origin"));
    assertEquals("true", response.header("Access-Control-Allow-Credentials"));
}

@Test
void evilOriginDoesNotGetCorsCredentials() {
    HttpResponse response = http.options("/api/cases")
            .header("Origin", "https://evil.example")
            .header("Access-Control-Request-Method", "POST")
            .send();

    assertNotEquals("true", response.header("Access-Control-Allow-Credentials"));
}
```

---

## 15. Testing Secure Error Handling

Security error test harus memastikan status code benar dan body tidak bocor.

```java
@Test
void invalidLoginDoesNotRevealWhetherUsernameExists() {
    HttpResponse r1 = http.post("/login")
            .form("username", "existing-user")
            .form("password", "wrong")
            .send();

    HttpResponse r2 = http.post("/login")
            .form("username", "non-existing-user")
            .form("password", "wrong")
            .send();

    assertEquals(r1.statusCode(), r2.statusCode());
    assertEquals(normalize(r1.body()), normalize(r2.body()));
}
```

Token error:

```java
@Test
void missingBearerTokenReturnsAuthenticateChallenge() {
    HttpResponse response = http.get("/api/profile");

    assertEquals(401, response.statusCode());
    assertTrue(response.header("WWW-Authenticate").contains("Bearer"));
}
```

403 should not challenge as if login needed:

```java
@Test
void authenticatedUserWithoutRoleGetsForbiddenNotLoginRedirect() {
    String token = tokenFactory.accessToken("user-1", Set.of("USER"));

    HttpResponse response = http.get("/api/admin/users", bearer(token));

    assertEquals(403, response.statusCode());
    assertFalse(response.isRedirectToLogin());
}
```

---

## 16. Testing Audit Behavior

Audit test harus menguji bukan hanya response, tapi event yang ditulis.

```java
@Test
void deniedApprovalCreatesAuditEvent() {
    CaseFixture c = fixtures.submittedCase("tenant-a", "maker-1", "approver-1");
    String token = tokenFactory.accessToken("maker-1", "tenant-a", Set.of("CASE_APPROVER"));

    HttpResponse response = http.post("/api/cases/" + c.id() + "/approve", bearer(token));

    assertEquals(403, response.statusCode());

    AuditEvent event = auditRepository.findLastByResourceId(c.id());
    assertEquals("AUTHORIZATION_DENIED", event.type());
    assertEquals("maker-1", event.actorId());
    assertEquals("tenant-a", event.tenantId());
    assertEquals("SOD_VIOLATION", event.decisionCode());
    assertFalse(event.containsRawToken());
}
```

### 16.1 Audit Transaction Test

Jika business action success tetapi audit gagal, apa policy-nya?

Ada dua model:

1. strict audit: action gagal jika audit gagal,
2. outbox audit: action commit dengan outbox event durable.

Test harus sesuai desain.

```java
@Test
void approvalAndAuditOutboxAreCommittedAtomically() {
    CaseFixture c = fixtures.submittedCaseAssignedTo("tenant-a", "maker-1", "approver-1");
    String token = tokenFactory.accessToken("approver-1", "tenant-a", Set.of("CASE_APPROVER"));

    HttpResponse response = http.post("/api/cases/" + c.id() + "/approve", bearer(token));

    assertEquals(200, response.statusCode());
    assertEquals("APPROVED", caseRepository.find(c.id()).state());
    assertTrue(outboxRepository.exists("CASE_APPROVED", c.id()));
}
```

---

## 17. Testing Security Context Propagation

### 17.1 Thread Leak Test

Bug umum pada thread pool:

```text
Request user A sets ThreadLocal actor=A.
Thread returns to pool but ThreadLocal not cleared.
Request user B reuses same thread and sees actor=A.
```

Test idea:

```java
@Test
void securityContextDoesNotLeakAcrossRequests() {
    String tokenA = tokenFactory.accessToken("user-a", "tenant-a", Set.of("USER"));
    String tokenB = tokenFactory.accessToken("user-b", "tenant-b", Set.of("USER"));

    HttpResponse r1 = http.get("/api/debug/current-actor", bearer(tokenA));
    HttpResponse r2 = http.get("/api/debug/current-actor", bearer(tokenB));

    assertTrue(r1.body().contains("user-a"));
    assertFalse(r2.body().contains("user-a"));
    assertTrue(r2.body().contains("user-b"));
}
```

Debug endpoint only in test profile.

### 17.2 Async Task Identity Test

```java
@Test
void asyncTaskUsesExplicitActorSnapshotNotAmbientThreadLocal() {
    String token = tokenFactory.accessToken("officer-1", "tenant-a", Set.of("CASE_OFFICER"));

    HttpResponse response = http.post("/api/cases/case-1/generate-report", bearer(token));

    assertEquals(202, response.statusCode());

    eventually(() -> {
        AuditEvent event = auditRepository.findLastByResourceId("case-1");
        assertEquals("officer-1", event.initiatorId());
        assertEquals("SYSTEM_REPORT_WORKER", event.executorId());
    });
}
```

---

## 18. Attack Simulation Mindset

Security test harus memasukkan abuse case, bukan hanya requirement positif.

### 18.1 Abuse Case Template

```text
As an attacker with [capability],
I try to [abuse action],
by manipulating [input/boundary/state],
so that I can [impact].
Expected: system denies, logs/audits safely, and does not leak sensitive data.
```

Examples:

```text
As a normal user,
I try to approve my own case,
by directly calling POST /cases/{id}/approve,
so that I can bypass maker-checker.
Expected: 403, audit SOD_VIOLATION.
```

```text
As tenant A user,
I try to read tenant B case,
by changing the path id,
so that I can access cross-tenant data.
Expected: 404/403, no data, audit optional depending policy.
```

```text
As external client,
I try to impersonate admin,
by sending X-User: admin header,
so that app trusts gateway identity.
Expected: rejected unless request comes through trusted boundary with signed header/token.
```

### 18.2 Attack Simulation Categories

| Category | Examples |
|---|---|
| Authentication bypass | missing token, malformed token, ID token as access token |
| Authorization bypass | role swap, endpoint without annotation, object id guessing |
| Tenant bypass | tenant id in URL/body/header modified |
| Workflow bypass | direct transition API call, approve own case |
| Browser abuse | CSRF, open redirect, clickjacking |
| Header spoofing | `X-Forwarded-*`, `X-User`, `X-Roles` |
| Replay | old token, old CSRF token, reused auth code |
| Race | double approve, stale state, concurrent reassignment |
| Cache abuse | stale role, cross-tenant cache key |
| Error leakage | username enumeration, stack trace, token validation detail |

---

## 19. Security Regression Test Suite Design

Security tests should be organized by invariant, not only by class.

Recommended structure:

```text
src/test/java
  security/
    authentication/
      LoginFlowIT.java
      TokenValidationIT.java
      OidcCallbackIT.java
    authorization/
      AdminEndpointAuthorizationIT.java
      CaseApprovalAuthorizationTest.java
      PermissionMatrixTest.java
    tenancy/
      TenantIsolationIT.java
      TenantCacheIsolationIT.java
    browser/
      CsrfIT.java
      CorsIT.java
      ClickjackingHeadersIT.java
    session/
      SessionLifecycleIT.java
      LogoutIT.java
    gateway/
      TrustedHeaderBoundaryIT.java
      ForwardedHeaderIT.java
    audit/
      SecurityAuditIT.java
    concurrency/
      ApprovalRaceIT.java
      SecurityContextPropagationIT.java
```

### 19.1 Tagging Tests

```java
@Tag("security")
@Tag("integration")
class TenantIsolationIT {
}
```

Maven/Gradle pipeline:

```text
fast unit tests        -> every commit
security unit/matrix   -> every commit
container integration  -> PR
IdP integration        -> PR/nightly
attack simulation      -> nightly/release
DAST/ZAP scan          -> nightly/release
```

---

## 20. Testing with Realistic Infrastructure

For Jakarta security apps, realistic integration may include:

- servlet container/application server,
- database,
- IdP,
- JWKS endpoint,
- reverse proxy/gateway,
- Redis/session store,
- message broker,
- audit sink.

### 20.1 Testcontainers Pattern

For Java integration tests:

```text
- PostgreSQL/Oracle-compatible test database if possible
- Keycloak or OIDC-compatible test IdP
- Redis for session/cache
- WireMock for introspection/JWKS/userinfo if not using real IdP
- app container or embedded runtime
```

Do not mock everything.

Mocking everything hides:

- wrong issuer URL,
- wrong callback URL,
- JWKS cache bug,
- HTTP redirect issue,
- TLS/truststore issue,
- cookie SameSite behavior,
- container role propagation issue,
- filter ordering issue.

### 20.2 When Mock Is Acceptable

Mock is acceptable for:

- pure policy unit test,
- claim mapping function,
- password validation interface contract,
- audit event builder,
- denial reason mapper,
- token parsing negative cases if validator is separately integration-tested.

Mock is risky for:

- OIDC login,
- `SecurityContext` role propagation,
- servlet security constraints,
- JAX-RS filter order,
- session/logout,
- mTLS,
- gateway trusted header.

---

## 21. Static and Reflection-Based Security Tests

Runtime tests are essential, but static/reflection tests catch omission early.

### 21.1 Endpoint Annotation Coverage

```java
@Test
void allJaxRsMethodsHaveExplicitSecurityPolicy() {
    List<String> violations = JaxRsScanner.allResourceMethods().stream()
            .filter(m -> !SecurityAnnotationInspector.hasEffectivePolicy(m))
            .map(Method::toGenericString)
            .collect(Collectors.toList());

    assertTrue(violations.isEmpty(), "Missing security policy: " + violations);
}
```

### 21.2 Repository Tenant Filter Coverage

If you enforce tenant at repository method naming level:

```java
@Test
void tenantScopedRepositoriesMustNotExposeFindByIdWithoutTenant() {
    List<String> violations = RepositoryScanner.tenantScopedRepositories().stream()
            .flatMap(repo -> Arrays.stream(repo.getMethods()))
            .filter(m -> m.getName().equals("findById"))
            .filter(m -> !hasParameterNamedOrTyped(m, "tenantId"))
            .map(Method::toGenericString)
            .collect(Collectors.toList());

    assertTrue(violations.isEmpty(), "Unsafe repository methods: " + violations);
}
```

### 21.3 Forbidden Logging Patterns

Static test/checkstyle/semgrep-like rules:

```text
Forbidden:
- log.info("token={}", token)
- log.debug("password={}", password)
- response body includes stack trace
- audit stores Authorization header
- exception mapper returns exception.getMessage() for auth failures
```

---

## 22. Property-Based and Metamorphic Testing Ideas

Traditional example-based test may miss combinations. Security benefits from property-like thinking.

### 22.1 Tenant Isolation Property

Property:

```text
For any user U in tenant T1 and resource R in tenant T2 where T1 != T2,
U must not read/update/delete R.
```

Pseudo:

```java
@Property
void crossTenantAccessIsNeverAllowed(UserFixture user, CaseFixture resource) {
    assumeFalse(user.tenantId().equals(resource.tenantId()));

    AuthorizationDecision d = policy.canView(user.toActor(), resource.toSnapshot());

    assertFalse(d.isAllowed());
}
```

### 22.2 Permission Monotonicity Is Not Always True

Be careful: more roles do not always mean more permission.

Example:

```text
CASE_MAKER + CASE_APPROVER may trigger segregation-of-duties conflict.
```

So avoid simplistic property:

```text
Adding role can never reduce permissions.
```

That property is false in regulated workflows.

Better property:

```text
Adding unrelated viewer role must not grant approval permission.
```

### 22.3 Metamorphic Relation Examples

```text
Changing tenant from same to different must not increase access.
Changing state from SUBMITTED to APPROVED must not allow approve.
Changing actor from assignee to unrelated must not allow assignee-only action.
Removing required role must not allow same action.
Changing issuer while keeping same sub must not preserve identity unless linked.
```

---

## 23. Mutation Testing for Authorization

Mutation testing idea: intentionally break policy and ensure tests fail.

Potential mutations:

```text
- remove tenant check
- replace AND with OR
- remove maker-checker check
- ignore state
- treat null actor as system
- allow unknown role
- skip audience validation
- accept expired token
- remove CSRF check
- remove audit event
```

If tests still pass after mutation, your suite is weak.

You do not always need a mutation testing tool to get value. You can manually review:

```text
If I delete this security check, which test fails?
```

If answer is “none”, create a test.

---

## 24. Test Data Design for Security

Good security tests need carefully designed fixtures.

Minimum fixture set:

```text
Tenants:
- tenant-a
- tenant-b

Users:
- anonymous
- tenant-a viewer
- tenant-a maker
- tenant-a approver
- tenant-a supervisor
- tenant-a admin
- tenant-b viewer
- global admin
- disabled user
- locked user

Cases:
- tenant-a draft by maker-a
- tenant-a submitted assigned to approver-a
- tenant-a submitted assigned to approver-b
- tenant-a approved
- tenant-b submitted

Tokens:
- valid access token
- expired access token
- wrong issuer token
- wrong audience token
- id token
- token without groups
- token with wrong tenant claim
```

Security fixture should make wrong access easy to test.

Bad fixture design:

```text
Only one tenant, one user, one role, one case.
```

This makes authorization bugs invisible.

---

## 25. Java 8–25 Testing Considerations

### 25.1 Java 8

Common stack:

- JUnit 4/5 depending build,
- older Java EE APIs,
- `javax.*`,
- older app server,
- limited modern HTTP client unless using Apache/OkHttp,
- no records/sealed classes/pattern matching.

Testing guidance:

- keep policy classes simple,
- use explicit fixture builders,
- avoid relying on modern language features,
- watch legacy JAAS/JASPIC behavior.

### 25.2 Java 11

Benefits:

- standard `java.net.http.HttpClient`,
- easier API integration testing,
- still common for enterprise.

### 25.3 Java 17

Benefits:

- common LTS for Jakarta EE 10/11 deployments,
- records can simplify immutable test fixtures if allowed,
- better language ergonomics.

### 25.4 Java 21

Benefits/concerns:

- virtual threads,
- structured concurrency preview/history depending version,
- thread-local assumptions must be tested carefully,
- performance tests can include high-concurrency auth checks.

### 25.5 Java 25

Considerations:

- long-range compatibility,
- keep tests validating security behavior, not internal JVM scheduling,
- avoid assuming thread identity equals request identity,
- continue explicit context propagation testing.

### 25.6 `javax.*` vs `jakarta.*`

Migration requires testing both compile/runtime behavior:

```text
javax.servlet.*         -> jakarta.servlet.*
javax.annotation.security.* -> jakarta.annotation.security.*
javax.security.enterprise.* -> jakarta.security.enterprise.*
javax.security.auth.message.* -> jakarta.security.auth.message.*
```

Migration regression tests:

- role annotations still work,
- servlet constraints still apply,
- filters still registered,
- authentication mechanism still discovered,
- identity store still used,
- `SecurityContext` injection still works,
- JAX-RS resources still protected.

---

## 26. CI/CD Security Testing Pipeline

A pragmatic pipeline:

```text
On every commit:
- unit tests
- policy matrix tests
- static security annotation coverage tests
- mapper/parser tests

On pull request:
- API integration tests
- container security tests
- tenant isolation tests
- audit integration tests
- token validation tests

Nightly:
- real IdP integration tests
- browser/E2E tests
- DAST scan
- dependency vulnerability scan
- broader abuse-case suite
- concurrency/race tests

Before release:
- full regression
- migration smoke test
- rollback test
- gateway/proxy route review
- security checklist sign-off
```

### 26.1 Security Gates

Fail PR if:

```text
- protected endpoint lacks explicit policy
- authorization negative test fails
- tenant isolation test fails
- token invalid case accepted
- audit event missing for sensitive action
- CSRF disabled for cookie-auth state-changing endpoint
- forbidden log pattern detected
- dependency critical vuln untriaged
```

### 26.2 Avoid False Confidence Metrics

Code coverage is not security coverage.

Bad metric:

```text
90% line coverage
```

Better metrics:

```text
- 100% sensitive endpoints covered by authz matrix
- 100% tenant-scoped repositories tested for cross-tenant denial
- all workflow transitions have allowed and denied tests
- every token validation rule has positive and negative test
- every privileged action has audit test
```

---

## 27. Common Anti-Patterns in Security Testing

### 27.1 Only Testing Admin Success

```java
@Test
void adminCanApprove() { ... }
```

Not enough. Need:

```text
- anonymous cannot approve
- maker cannot approve own case
- viewer cannot approve
- approver from another tenant cannot approve
- approver not assigned cannot approve
- approver cannot approve wrong state
```

### 27.2 Mocking Authorization to Test Authorization

If you mock `authorizationService.canApprove()` to return true, you are not testing authorization.

### 27.3 UI-Only Security Tests

Selenium sees button hidden. But direct API may still work.

Always test API directly.

### 27.4 No Negative Tests

Security without negative tests is mostly untested.

### 27.5 One User, One Tenant Fixtures

This hides cross-tenant bugs.

### 27.6 Accepting Any 4xx

Sometimes acceptable in broad smoke tests, but security contract should distinguish:

```text
401 = not authenticated
403 = authenticated but not allowed
404 = concealed/not found
409 = state conflict
```

### 27.7 Testing with Impossible Tokens

If test token generator creates claims production IdP never emits, tests may be misleading.

### 27.8 Ignoring Audit

A security decision without audit may be operationally indefensible.

### 27.9 Not Testing After Migration

`javax` → `jakarta`, server upgrade, proxy change, IdP config change can silently alter security behavior.

### 27.10 Testing Only Local Runtime

Security often fails at boundary:

- gateway,
- TLS,
- cookie domain,
- SameSite,
- redirect URI,
- proxy path rewrite,
- cluster session.

---

## 28. Reference Blueprint: Security Test Checklist

Use this as review checklist.

### Authentication

```text
[ ] Anonymous protected access denied
[ ] Invalid credential denied
[ ] Disabled/locked account denied
[ ] Expired token denied
[ ] Wrong issuer denied
[ ] Wrong audience denied
[ ] Wrong signature denied
[ ] ID token as access token denied
[ ] OIDC state/nonce validated
[ ] mTLS missing/wrong cert denied if required
```

### Authorization

```text
[ ] Role missing denied
[ ] Wrong role denied
[ ] Tenant mismatch denied
[ ] Wrong state denied
[ ] Wrong relationship denied
[ ] Maker-checker enforced
[ ] Delegation expiry enforced
[ ] Break-glass controlled and audited
[ ] Object-level authorization enforced
[ ] Repository/data access scoped
```

### Session/Token

```text
[ ] Session id rotates after login
[ ] Logout invalidates session
[ ] Cookie flags correct
[ ] Idle timeout works
[ ] Absolute timeout works
[ ] JWKS cache handles rotation
[ ] Opaque token introspection failure handled
[ ] Revoked token denied where required
```

### Browser

```text
[ ] CSRF token required for cookie-auth mutation
[ ] CORS whitelist strict
[ ] Credentialed CORS not wildcard
[ ] Clickjacking protection present
[ ] Open redirect prevented
```

### Gateway

```text
[ ] Trusted headers rejected from untrusted source
[ ] Forwarded headers validated
[ ] Internal endpoints not exposed
[ ] Path rewrite does not bypass security
[ ] Host header abuse tested
```

### Audit

```text
[ ] Login success/failure audited
[ ] Privileged actions audited
[ ] Denials audited where required
[ ] Tenant/resource/action/decision captured
[ ] Raw token/password not logged
[ ] Correlation id present
[ ] Audit durability tested
```

### Concurrency

```text
[ ] Double approval prevented
[ ] State transition atomic
[ ] Context does not leak across threads
[ ] Async actor explicit
[ ] Cache invalidation tested
```

---

## 29. Practical Design: Security Test Naming Convention

Bad test name:

```text
shouldReturn403
```

Good test name:

```text
tenantAViewerCannotReadTenantBCaseByGuessingId
makerCannotApproveOwnSubmittedCaseEvenWithApproverRole
expiredAccessTokenDoesNotEstablishSecurityContext
logoutInvalidatesSessionCookieForProtectedEndpoint
trustedIdentityHeaderIsRejectedWhenRequestDoesNotComeFromGateway
```

Security test names should reveal the abuse case.

---

## 30. Minimal Example: End-to-End Authorization Test Flow

```java
@Test
void makerCheckerInvariantIsEnforcedThroughHttpApiAndAudited() {
    // Arrange
    UserFixture maker = fixtures.user("maker-1", "tenant-a", Set.of("CASE_MAKER", "CASE_APPROVER"));
    CaseFixture c = fixtures.submittedCase("tenant-a", maker.id(), maker.id());
    String token = tokenFactory.accessToken(maker.id(), "tenant-a", maker.roles());

    // Act
    HttpResponse response = http.post("/api/cases/" + c.id() + "/approve", bearer(token));

    // Assert API contract
    assertEquals(403, response.statusCode());
    assertProblemCode(response, "SOD_VIOLATION");

    // Assert domain state unchanged
    assertEquals("SUBMITTED", caseRepository.find(c.id()).state());

    // Assert audit
    AuditEvent audit = auditRepository.findLastByResourceId(c.id());
    assertEquals("AUTHORIZATION_DENIED", audit.type());
    assertEquals("maker-1", audit.actorId());
    assertEquals("tenant-a", audit.tenantId());
    assertEquals("APPROVE_CASE", audit.action());
    assertEquals("SOD_VIOLATION", audit.decisionCode());
}
```

Test ini bagus karena memverifikasi:

- HTTP endpoint,
- authorization policy,
- domain state tidak berubah,
- denial reason,
- audit event.

---

## 31. What “Top 1%” Looks Like in Security Testing

Engineer biasa bertanya:

```text
Apakah endpoint ini bisa diakses user yang benar?
```

Engineer sangat kuat bertanya:

```text
Siapa yang tidak boleh mengakses endpoint ini?
Bagaimana membuktikannya?
Apakah denial terjadi di boundary yang benar?
Apakah data tetap tidak berubah?
Apakah audit mencatat decision?
Apakah tenant boundary tetap aman?
Apakah token/session/context bisa dipalsukan, replayed, stale, atau leaked?
Apakah test akan gagal jika check penting dihapus?
```

Top-level engineer tidak hanya menulis security logic. Mereka membuat security logic **terbukti**, **regression-safe**, dan **operationally defensible**.

---

## 32. Ringkasan Mental Model

Security testing harus menguji:

```text
identity establishment
role/group/claim mapping
authorization decision
enforcement boundary
data scoping
session/token lifecycle
browser boundary
gateway trust boundary
context propagation
auditability
failure semantics
```

Gunakan kombinasi:

```text
unit policy tests
permission matrix tests
reflection/static coverage tests
HTTP integration tests
container tests
realistic IdP tests
tenant isolation tests
race/concurrency tests
audit verification tests
attack simulation tests
```

Jangan puas dengan:

```text
admin happy path works
button hidden in UI
mock role returns true
line coverage high
```

Security yang baik bukan hanya “ada”. Security yang baik harus bisa dibuktikan tetap benar ketika caller, state, tenant, token, session, browser, gateway, dan timing mencoba bergerak keluar dari happy path.

---

## 33. Checklist Lanjutan Sebelum Masuk Part Berikutnya

Sebelum lanjut, pastikan paham:

```text
[ ] Bisa membedakan unit policy test vs container integration test.
[ ] Bisa membuat permission matrix untuk workflow action.
[ ] Bisa menulis negative test untuk 401, 403, 404, 409.
[ ] Bisa menguji tenant isolation di object dan list endpoint.
[ ] Bisa menguji JWT validation secara positif dan negatif.
[ ] Bisa menguji session logout dan cookie flags.
[ ] Bisa menguji CSRF/CORS untuk browser-based auth.
[ ] Bisa menguji audit event untuk allowed dan denied sensitive action.
[ ] Bisa merancang abuse-case test.
[ ] Bisa menjelaskan kenapa mock saja tidak cukup untuk security boundary.
```

---

## 34. Transisi ke Part 30

Part ini membahas bagaimana membuktikan sistem security bekerja.

Part berikutnya akan membahas:

```text
Part 30 — Migration Guide: Java EE javax Security to Jakarta jakarta Security
```

Fokusnya:

- migration `javax.*` ke `jakarta.*`,
- dependency dan container compatibility,
- Servlet/JAX-RS/Security annotation migration,
- JASPIC/JACC naming migration,
- legacy JAAS integration,
- app server differences,
- Spring Boot coexistence,
- security regression checklist setelah migration.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 28 — Auditing, Accountability, Non-Repudiation, and Forensic Readiness](./learn-java-jakarta-security-authentication-authorization-identity-part-28-auditing-accountability-non-repudiation-forensics.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Migration Guide: Java EE `javax` Security to Jakarta `jakarta` Security](./learn-java-jakarta-security-authentication-authorization-identity-part-30-migration-javax-to-jakarta-security.md)

</div>