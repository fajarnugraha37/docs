# learn-java-authorization-modes-and-patterns-part-029

# Part 29 — Authorization Anti-Patterns and Failure Modes

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **29 dari 34/35**  
> Topik: **Authorization anti-patterns, failure modes, detection, and remediation**  
> Target: Java 8 sampai Java 25, Spring, Jakarta EE, microservices, enterprise/regulatory systems.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya sudah membangun fondasi besar:

- mental model authorization,
- RBAC,
- ABAC,
- PBAC,
- ReBAC,
- ACL,
- ownership/tenancy,
- IDOR/BOLA,
- layered enforcement,
- Spring/Jakarta authorization,
- REST/GraphQL/gRPC/messaging,
- data-level authorization,
- workflow authorization,
- delegation/break-glass,
- hierarchical role resolution,
- contextual authorization,
- distributed authorization,
- token boundary,
- caching/performance,
- failure semantics,
- auditability,
- testing strategy.

Bagian ini menjawab pertanyaan yang lebih keras:

> “Kalau semua konsep itu sudah benar, kenapa authorization masih sering bocor di production?”

Jawabannya: karena authorization jarang gagal sebagai satu bug besar. Ia lebih sering gagal sebagai **serangkaian keputusan kecil yang tampak masuk akal secara lokal tetapi salah secara sistemik**.

Contoh:

```java
if (user.isAdmin()) {
    return repository.findById(id);
}
```

Terlihat sederhana. Tetapi pertanyaan sebenarnya:

- Admin untuk tenant mana?
- Admin sistem atau admin agency?
- Boleh lihat semua resource atau hanya resource aktif?
- Boleh lihat detail sensitif atau hanya metadata?
- Boleh lihat resource yang sedang dalam status legal hold?
- Apakah ini support admin, business admin, security admin, atau data admin?
- Apakah decision ini diaudit?
- Apakah query list memakai aturan yang sama?
- Apakah export/report/file-download memakai aturan yang sama?

Anti-pattern authorization adalah pola desain yang membuat jawaban terhadap pertanyaan-pertanyaan itu menjadi kabur.

---

## 1. Mental Model: Authorization Fails at the Gaps

Authorization tidak hanya gagal karena tidak ada check.

Authorization gagal karena ada **gap** antara:

1. endpoint dan service,
2. service dan repository,
3. route permission dan object permission,
4. token claim dan state server saat ini,
5. role global dan scope organisasi,
6. list query dan detail endpoint,
7. UI visibility dan backend enforcement,
8. synchronous request dan asynchronous job,
9. policy design dan audit evidence,
10. test matrix dan production variant.

Top 1% engineer biasanya tidak bertanya:

> “Apakah endpoint ini sudah diberi `@PreAuthorize`?”

Mereka bertanya:

> “Apakah semua path yang dapat menghasilkan, membaca, mengubah, mengekspor, menghapus, mengirim, atau merepresentasikan resource ini melewati decision boundary yang sama?”

Itulah inti bagian ini.

---

## 2. Anti-Pattern 1 — `isAdmin()` Everywhere

### 2.1 Bentuk umum

```java
if (currentUser.isAdmin()) {
    approve(caseId);
}
```

atau:

```java
@PreAuthorize("hasRole('ADMIN')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable UUID id) {
    caseService.approve(id);
}
```

### 2.2 Kenapa terlihat masuk akal

Karena sistem awalnya kecil:

- hanya ada user biasa dan admin,
- admin memang bisa melakukan banyak hal,
- permission belum granular,
- product owner sering bilang “admin bisa semua”.

### 2.3 Kenapa berbahaya

`ADMIN` biasanya bukan satu konsep. Ia bisa berarti:

| Label | Makna yang mungkin |
|---|---|
| System admin | Mengelola konfigurasi platform |
| Tenant admin | Mengelola user dalam tenant sendiri |
| Business admin | Mengelola proses bisnis tertentu |
| Data admin | Bisa memperbaiki data tertentu |
| Support admin | Bisa melihat user/customer untuk troubleshooting |
| Security admin | Bisa mengelola role/policy |
| Super admin | Bisa lintas tenant, biasanya sangat berbahaya |

Jika semua disatukan menjadi `ADMIN`, maka sistem kehilangan struktur.

### 2.4 Failure mode

Misal user adalah `AGENCY_ADMIN` untuk Agency A. Endpoint:

```java
@PreAuthorize("hasRole('ADMIN')")
@GetMapping("/agencies/{agencyId}/cases")
public List<CaseDto> list(@PathVariable String agencyId) {
    return caseRepository.findByAgencyId(agencyId);
}
```

Jika `AGENCY_ADMIN` dipetakan menjadi `ROLE_ADMIN`, user Agency A bisa mengganti `agencyId` menjadi Agency B.

Ini bukan bug authentication. Ini bug semantic authorization.

### 2.5 Perbaikan

Ganti dari role global ke permission + scope.

```java
AuthorizationDecision decision = authz.authorize(
    subject,
    Action.of("case.list"),
    ResourceRef.agency(agencyId),
    AuthorizationContext.current()
);

decision.requireAllowed();
```

Policy-nya:

```text
ALLOW case.list ON agency:{agencyId}
WHEN subject has role AGENCY_ADMIN scoped_to agency:{agencyId}
```

### 2.6 Heuristic

Jika codebase punya banyak:

```java
isAdmin()
hasRole("ADMIN")
hasAuthority("ROLE_ADMIN")
```

maka kemungkinan besar authorization model sedang collapse menjadi satu privilege bucket.

---

## 3. Anti-Pattern 2 — UI-Only Authorization

### 3.1 Bentuk umum

Frontend menyembunyikan tombol:

```vue
<button v-if="user.permissions.includes('case.approve')">
  Approve
</button>
```

Backend menerima request tanpa check:

```java
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable UUID id) {
    caseService.approve(id);
}
```

### 3.2 Kenapa terlihat masuk akal

Karena user biasa “tidak melihat tombol”.

### 3.3 Kenapa salah

UI adalah presentation. UI bukan enforcement boundary.

User bisa:

- memanggil API langsung,
- menggunakan browser devtools,
- replay request,
- mengubah payload,
- memakai Postman/curl,
- memakai endpoint lama yang tidak lagi dipakai UI,
- memanggil mobile/API client lain.

### 3.4 Perbaikan

Frontend boleh melakukan authorization untuk UX, tetapi backend tetap harus enforce.

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<Void> approve(@PathVariable UUID id) {
    CaseEntity caze = caseRepository.getRequired(id);

    authorizationService.requireAllowed(
        Action.CASE_APPROVE,
        ResourceRef.caseRef(caze.getId()),
        AuthorizationContext.from(caze)
    );

    caseService.approve(caze);
    return ResponseEntity.noContent().build();
}
```

### 3.5 Rule

> UI may hide. Backend must decide.

---

## 4. Anti-Pattern 3 — Controller-Only Authorization

### 4.1 Bentuk umum

```java
@PreAuthorize("hasAuthority('case.approve')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable UUID id) {
    caseService.approve(id);
}
```

Lalu service dipakai juga oleh:

```java
@Component
class CaseAutoApprovalJob {
    void run() {
        caseService.approve(caseId);
    }
}
```

atau:

```java
@KafkaListener(topics = "case-approval")
void consume(ApprovalMessage message) {
    caseService.approve(message.caseId());
}
```

### 4.2 Masalah

Authorization ada di HTTP route, bukan di business operation.

Begitu operation dipanggil dari path lain, check hilang.

### 4.3 Perbaikan

Pindahkan invariant authorization ke service/application layer.

```java
public void approve(ApproveCaseCommand command) {
    CaseEntity caze = caseRepository.getRequired(command.caseId());

    authorizationService.requireAllowed(
        command.actor(),
        Action.CASE_APPROVE,
        ResourceRef.caseRef(caze.getId()),
        AuthorizationContext.builder()
            .tenantId(caze.getTenantId())
            .caseState(caze.getState())
            .assignedOfficerId(caze.getAssignedOfficerId())
            .build()
    );

    caze.approve(command.actor().id());
}
```

Controller, job, consumer, and internal API must provide an actor/context.

### 4.4 Nuance

Ada operation system-internal yang tidak punya human actor. Jangan bypass diam-diam.

Gunakan explicit workload subject:

```java
Subject systemSubject = Subject.workload("case-auto-close-job");
```

Policy-nya tetap eksplisit:

```text
ALLOW case.autoClose
WHEN subject.type == WORKLOAD
AND subject.name == "case-auto-close-job"
AND resource.state == "EXPIRED"
```

---

## 5. Anti-Pattern 4 — Trusting Request Body Role, Tenant, or Owner

### 5.1 Bentuk umum

```json
{
  "caseId": "C-1001",
  "tenantId": "tenant-a",
  "role": "approver"
}
```

Backend:

```java
if (request.role().equals("approver")) {
    approve(request.caseId());
}
```

atau:

```java
List<CaseEntity> cases = repository.findByTenantId(request.tenantId());
```

### 5.2 Kenapa fatal

Request body adalah input attacker-controlled.

Tenant, role, owner, agency, department, clearance, acting capacity, and permission should be resolved from trusted server-side sources.

### 5.3 Perbaikan

Request boleh menyebut target resource, tetapi bukan authority source.

```java
Subject subject = subjectResolver.fromSecurityContext();
TenantId tenantId = tenantResolver.resolveTrustedTenant(subject, request.tenantId());
```

Jika user boleh memilih tenant aktif, validasi pilihan itu terhadap membership server-side:

```java
TenantId activeTenant = tenantMembershipService.requireMemberOf(
    subject.id(),
    request.requestedTenantId()
);
```

### 5.4 Warning sign

Cari field ini di request DTO:

```text
role
roles
permission
permissions
tenantId
agencyId
ownerId
createdBy
isAdmin
isApprover
clearance
actingAs
```

Field tersebut tidak selalu salah, tetapi jika dipakai sebagai authority source, itu anti-pattern.

---

## 6. Anti-Pattern 5 — Trusting JWT Claims Blindly

### 6.1 Bentuk umum

```java
String tenantId = jwt.getClaimAsString("tenant_id");
List<String> roles = jwt.getClaimAsStringList("roles");
```

Kemudian langsung:

```java
if (roles.contains("APPROVER")) {
    approve(caseId);
}
```

### 6.2 Kenapa tidak cukup

JWT adalah evidence. JWT bukan source of truth penuh.

JWT bisa stale terhadap:

- role revocation,
- user disabled,
- tenant membership removed,
- delegation expired,
- emergency access revoked,
- policy changed,
- resource state changed,
- risk state changed.

### 6.3 Batas aman

JWT boleh dipakai untuk:

- subject identity,
- issuer/audience validation,
- coarse-grained scope,
- session/authentication evidence,
- workload identity,
- token-bound audience.

JWT sebaiknya tidak menjadi satu-satunya sumber untuk:

- object ownership,
- tenant access,
- current assignment,
- case state,
- dynamic risk,
- separation of duty,
- fine-grained domain action.

### 6.4 Perbaikan

```java
Subject subject = subjectFromJwt(jwt);
CaseEntity caze = caseRepository.getRequired(caseId);

AuthorizationContext context = AuthorizationContext.builder()
    .tokenScopes(jwtScopes(jwt))
    .currentTenantMembership(tenantService.getMembership(subject.id(), caze.getTenantId()))
    .caseState(caze.getState())
    .assignedOfficer(caze.getAssignedOfficerId())
    .build();

authz.requireAllowed(subject, Action.CASE_APPROVE, ResourceRef.caseRef(caseId), context);
```

### 6.5 Design rule

> Token claim can narrow authority. It should rarely expand authority without server-side validation.

---

## 7. Anti-Pattern 6 — Missing Object Ownership Check

### 7.1 Bentuk umum

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases/{id}")
public CaseDto get(@PathVariable UUID id) {
    return mapper.toDto(repository.findById(id).orElseThrow());
}
```

Route permission exists. Object-level permission does not.

### 7.2 Failure mode

User A can read Case B by changing ID.

This is classic IDOR/BOLA.

### 7.3 Perbaikan minimal

```java
CaseEntity caze = repository.findByIdAndTenantId(id, subject.tenantId())
    .orElseThrow(NotFoundException::new);
```

### 7.4 Perbaikan advanced

```java
authz.requireAllowed(
    subject,
    Action.CASE_READ,
    ResourceRef.caseRef(id),
    AuthorizationContext.from(caze)
);
```

### 7.5 Rule

Every endpoint that takes object ID must answer:

```text
Can this subject perform this action on this exact object right now?
```

Not:

```text
Does this subject generally have permission for this action type?
```

---

## 8. Anti-Pattern 7 — Query Filter Bypass

### 8.1 Bentuk umum

Detail endpoint is protected:

```java
GET /cases/{id}
```

But list endpoint is not:

```java
GET /cases?status=OPEN
```

Implementation:

```java
return caseRepository.findByStatus(status);
```

### 8.2 Kenapa berbahaya

Banyak data leak terjadi bukan dari detail endpoint, tetapi dari:

- search result,
- list page,
- autocomplete,
- dashboard,
- report,
- count,
- export,
- aggregation,
- notification feed.

### 8.3 Perbaikan

Authorization harus masuk ke predicate query.

```java
Specification<CaseEntity> visibleTo(Subject subject) {
    return (root, query, cb) -> cb.and(
        cb.equal(root.get("tenantId"), subject.tenantId()),
        root.get("caseType").in(subject.allowedCaseTypes())
    );
}
```

```java
Specification<CaseEntity> spec = visibleTo(subject)
    .and(hasStatus(status))
    .and(matchesSearchKeyword(keyword));

return caseRepository.findAll(spec, pageable);
```

### 8.4 Advanced issue: count leakage

Even if rows are filtered, count can leak:

```text
Agency B has 17 investigations matching “fraud”.
```

For sensitive domains, count/aggregation also needs authorization design.

---

## 9. Anti-Pattern 8 — Report and Export Bypass

### 9.1 Bentuk umum

Screen API is protected:

```java
GET /cases
```

Export API uses raw SQL:

```java
@GetMapping("/cases/export")
public void export(...) {
    jdbcTemplate.query("select * from cases where status = ?", status);
}
```

### 9.2 Why it happens

Export/report sering dibuat belakangan:

- performance reason,
- native SQL,
- batch stream,
- BI/reporting team,
- different service,
- direct DB view,
- asynchronous job.

Authorization predicate tidak ikut terbawa.

### 9.3 Perbaikan

Buat reusable authorization predicate builder.

```java
public interface CaseVisibilityPredicateFactory {
    CasePredicate forSubject(Subject subject);
}
```

Untuk JPA:

```java
Specification<CaseEntity> visible = visibilitySpecFactory.forSubject(subject);
```

Untuk SQL export:

```java
SqlPredicate visible = visibilitySqlFactory.forSubject(subject);
```

Jangan copy-paste manual.

### 9.4 Export-specific questions

Export harus menjawab:

- Apakah user boleh melihat semua row yang diekspor?
- Apakah user boleh mengekspor, bukan hanya melihat?
- Apakah field sensitif harus dimasking?
- Apakah export limit perlu?
- Apakah export harus diaudit?
- Apakah file hasil export punya TTL?
- Apakah download file export re-check authorization?

---

## 10. Anti-Pattern 9 — File Download Bypass

### 10.1 Bentuk umum

Metadata protected:

```java
GET /documents/{id}
```

File download not protected:

```java
GET /files/{storageKey}
```

or presigned URL generated without object-level decision.

### 10.2 Failure mode

User cannot view document page but can download file if they know URL/storage key.

### 10.3 Perbaikan

File authorization must bind to business resource.

```java
Document doc = documentRepository.getRequired(documentId);
CaseEntity caze = caseRepository.getRequired(doc.caseId());

authz.requireAllowed(
    subject,
    Action.DOCUMENT_DOWNLOAD,
    ResourceRef.document(doc.id()),
    AuthorizationContext.builder()
        .tenantId(caze.getTenantId())
        .caseId(caze.getId())
        .documentClassification(doc.classification())
        .build()
);
```

Presigned URL generation must happen after decision and should be short-lived.

### 10.4 Additional rule

Do not expose raw storage key if avoidable.

Bad:

```text
/files/tenant-a/private/case-1001/evidence.pdf
```

Better:

```text
/documents/{documentId}/download
```

Let backend resolve storage key after authorization.

---

## 11. Anti-Pattern 10 — Cache Leakage

### 11.1 Bentuk umum

```java
@Cacheable("caseDetails")
public CaseDto getCase(UUID caseId) {
    return mapper.toDto(repository.findById(caseId).orElseThrow());
}
```

### 11.2 Masalah

Cache key only uses `caseId`, but result may depend on:

- subject,
- tenant,
- permission,
- masking rule,
- locale/jurisdiction,
- classification,
- acting capacity,
- policy version.

User A loads full detail. User B gets cached full detail.

### 11.3 Perbaikan

Prefer caching raw resource, not authorized presentation, unless key includes auth dimensions.

```java
@Cacheable(value = "caseEntity", key = "#caseId")
public CaseEntity getRawCase(UUID caseId) { ... }
```

Then apply authorization/masking per request:

```java
CaseView view = caseViewProjector.projectFor(subject, rawCase);
```

If caching authorized result:

```java
key = subject.id() + ":" + activeTenant + ":" + permissionHash + ":" + policyVersion + ":" + caseId
```

### 11.4 Rule

> If output differs by subject, cache key must differ by subject-relevant authorization context.

---

## 12. Anti-Pattern 11 — Permission String Typo and Drift

### 12.1 Bentuk umum

```java
@PreAuthorize("hasAuthority('case.aprove')")
```

Typo: `aprove`.

Depending on configuration, this may cause accidental deny or accidental bypass if fallback logic exists.

### 12.2 More subtle drift

```java
case.approve
cases.approve
caseApproval.approve
CASE_APPROVE
case:approve
```

Different teams invent different names.

### 12.3 Perbaikan

Centralize permission constants or type-safe permissions.

Java 8-compatible:

```java
public final class Permissions {
    private Permissions() {}

    public static final String CASE_READ = "case.read";
    public static final String CASE_APPROVE = "case.approve";
    public static final String CASE_ASSIGN = "case.assign";
}
```

Java 17+:

```java
public record Permission(String value) {
    public static final Permission CASE_READ = new Permission("case.read");
    public static final Permission CASE_APPROVE = new Permission("case.approve");
}
```

Better: permission registry test.

```java
@Test
void allReferencedPermissionsMustExistInRegistry() {
    Set<String> referenced = permissionScanner.scanCodebase();
    Set<String> registered = permissionRegistry.allPermissionNames();

    assertThat(registered).containsAll(referenced);
}
```

---

## 13. Anti-Pattern 12 — Inconsistent Deny Semantics

### 13.1 Bentuk umum

Endpoint A returns 403:

```text
403 Forbidden
```

Endpoint B returns 404:

```text
404 Not Found
```

Endpoint C returns empty list:

```json
[]
```

Endpoint D returns business error:

```json
{"error":"case belongs to another agency"}
```

### 13.2 Problem

Inconsistent denial behavior leaks information and confuses clients.

### 13.3 Perbaikan

Define denial semantics by resource sensitivity.

| Scenario | Recommended behavior |
|---|---|
| User authenticated but lacks general function permission | 403 |
| User asks object that must be hidden if not visible | 404 or generic not found |
| List query contains unauthorized rows | filter rows |
| Bulk operation partially unauthorized | per-item result with generic denial |
| Sensitive workflow transition denied | 403 with safe reason code |
| Internal policy service unavailable | 503 or fail-closed mapped error |

### 13.4 Decision object

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final DenialMode denialMode;
    private final ReasonCode reasonCode;
    private final boolean safeToShowUser;
}
```

---

## 14. Anti-Pattern 13 — Allow-by-Default Fallback

### 14.1 Bentuk umum

```java
public boolean can(User user, String action, Object resource) {
    Policy policy = policies.get(action);
    if (policy == null) {
        return true;
    }
    return policy.evaluate(user, resource);
}
```

### 14.2 Why it happens

Developer wants to avoid breaking new feature.

### 14.3 Why catastrophic

New action without policy becomes allowed.

### 14.4 Correct design

```java
if (policy == null) {
    return AuthorizationDecision.deny(
        ReasonCode.NO_POLICY_REGISTERED,
        "No policy registered for action " + action
    );
}
```

### 14.5 CI guard

Every endpoint/command must map to a known action.

```text
Build fails if action is unregistered.
```

---

## 15. Anti-Pattern 14 — “Temporary Admin” Forgotten

### 15.1 Bentuk umum

A production issue occurs. Someone grants admin access temporarily.

No expiry. No reason. No approval. No audit review.

### 15.2 Failure mode

Temporary access becomes permanent shadow privilege.

### 15.3 Perbaikan

Temporary privilege must be modeled explicitly:

```java
class TemporaryGrant {
    SubjectId subjectId;
    Permission permission;
    Scope scope;
    Instant validFrom;
    Instant validUntil;
    String reason;
    String approvedBy;
    String ticketId;
}
```

Policy:

```text
ALLOW action
WHEN temporary_grant exists
AND now between validFrom and validUntil
AND grant.scope matches resource.scope
AND grant.approvedBy is not subject
```

### 15.4 Operational control

Daily report:

```text
temporary grants expiring today
active grants older than expected
grants without ticket
grants without approval
grants used outside business hours
```

---

## 16. Anti-Pattern 15 — Silent Break-Glass

### 16.1 Bentuk umum

```java
if (user.hasRole("SUPER_ADMIN")) {
    return true;
}
```

No reason. No alert. No expiry. No review.

### 16.2 Why dangerous

Break-glass is meant for emergency. If silent, it becomes universal bypass.

### 16.3 Correct model

Break-glass requires:

- explicit activation,
- reason,
- ticket/incident ID,
- time limit,
- strong authentication/step-up,
- visible audit,
- alert to security/admin,
- post-use review,
- scope limit,
- denial for unsupported action.

### 16.4 Java sketch

```java
public AuthorizationDecision evaluateBreakGlass(
    Subject subject,
    Action action,
    ResourceRef resource,
    AuthorizationContext context
) {
    BreakGlassSession session = breakGlassRepository.findActive(subject.id())
        .orElse(null);

    if (session == null) {
        return AuthorizationDecision.notApplicable();
    }

    if (session.isExpired(context.now())) {
        return AuthorizationDecision.deny(ReasonCode.BREAK_GLASS_EXPIRED);
    }

    if (!session.scope().covers(resource)) {
        return AuthorizationDecision.deny(ReasonCode.BREAK_GLASS_SCOPE_MISMATCH);
    }

    return AuthorizationDecision.allowWithObligation(
        ReasonCode.BREAK_GLASS_ACTIVE,
        Obligation.auditHighSeverity(session.incidentId())
    );
}
```

---

## 17. Anti-Pattern 16 — Internal Endpoint Bypass

### 17.1 Bentuk umum

```java
@PostMapping("/internal/cases/{id}/approve")
public void internalApprove(@PathVariable UUID id) {
    caseService.approveWithoutAuth(id);
}
```

### 17.2 Why it happens

Internal endpoint dibuat untuk:

- scheduler,
- integration,
- admin tool,
- batch migration,
- support tool,
- data repair.

Developer assumes internal network is trusted.

### 17.3 Why wrong

Internal does not mean authorized.

Risks:

- SSRF,
- compromised service,
- misconfigured ingress,
- leaked service credential,
- wrong network policy,
- developer tunnel,
- API gateway routing mistake.

### 17.4 Correct design

Internal endpoint must authorize workload identity.

```java
Subject workload = workloadIdentityResolver.resolve(request);

authz.requireAllowed(
    workload,
    Action.CASE_INTERNAL_APPROVE,
    ResourceRef.caseRef(id),
    context
);
```

Also enforce:

- mTLS/service identity,
- network policy,
- audience-bound token,
- action-specific permission,
- audit.

---

## 18. Anti-Pattern 17 — Async Job Bypass

### 18.1 Bentuk umum

User starts export:

```java
POST /reports/cases/export
```

Authorization checked at request time.

Job later runs as system and queries everything:

```java
select * from cases
```

### 18.2 Problem

The async boundary loses authorization context.

### 18.3 Correct design

Persist authorization snapshot or re-evaluate safely.

```java
class ExportJobRequest {
    UUID requestedBy;
    TenantId tenantId;
    Set<String> permissionSnapshot;
    String policyVersion;
    ExportFilter filter;
    Instant requestedAt;
}
```

At job execution:

- verify job was authorized to be created,
- apply query scoping for original subject or approved system scope,
- include policy version strategy,
- audit final row count and fields,
- protect generated file download.

### 18.4 Snapshot vs re-evaluate

| Strategy | Pros | Cons |
|---|---|---|
| Snapshot at request time | Reproducible | May allow after revocation |
| Re-evaluate at execution time | Honors revocation | Result may differ from user expectation |
| Hybrid | Best for sensitive systems | More complex |

For regulatory systems, hybrid is often best:

- snapshot for audit,
- re-evaluate critical grants at execution,
- deny if privilege revoked before job runs unless business rule says otherwise.

---

## 19. Anti-Pattern 18 — Messaging Consumer Trusts Producer

### 19.1 Bentuk umum

```java
@KafkaListener(topics = "case.commands")
void on(CommandMessage msg) {
    caseService.approve(msg.caseId());
}
```

Consumer assumes producer already checked authorization.

### 19.2 Problem

In event-driven architecture, producer and consumer often have different trust boundaries.

Messages can be:

- replayed,
- produced by another service,
- malformed,
- sent by compromised component,
- consumed after policy changes,
- missing actor context.

### 19.3 Correct design

Command messages should carry:

- actor subject reference,
- action,
- resource reference,
- reason/correlation ID,
- tenant/scope,
- issued-at,
- producer identity,
- signature/integrity if needed.

Consumer should authorize or verify authorized command envelope.

```java
CommandEnvelope envelope = parse(message);
Subject actor = subjectResolver.resolve(envelope.actorRef());

authz.requireAllowed(
    actor,
    envelope.action(),
    envelope.resourceRef(),
    AuthorizationContext.from(envelope)
);
```

For system events, use workload authorization, not user authorization.

---

## 20. Anti-Pattern 19 — Data Masking Treated as Authorization

### 20.1 Bentuk umum

```java
if (!user.canViewNric()) {
    dto.setNric("****");
}
```

But the same value appears in:

- logs,
- export,
- audit response,
- search index,
- GraphQL field,
- debug endpoint,
- cache,
- browser payload hidden by UI.

### 20.2 Problem

Masking is presentation control. Authorization is access control.

Masking can be an obligation after authorization decision, but not a replacement.

### 20.3 Correct model

Decision can include field obligations:

```java
AuthorizationDecision decision = authz.authorize(
    subject,
    Action.CASE_READ,
    ResourceRef.caseRef(caseId),
    context
);

CaseDto dto = projector.project(caze, decision.obligations());
```

Obligation:

```text
MASK field:nric
MASK field:phone
HIDE field:internalNotes
```

### 20.4 Rule

> Field visibility is authorization too.

---

## 21. Anti-Pattern 20 — GraphQL Field Resolver Leak

### 21.1 Bentuk umum

Query root protected:

```graphql
case(id: "C-1001") { id title }
```

But nested resolver leaks:

```graphql
case(id: "C-1001") {
  id
  complainant { name email phone }
  internalNotes { text createdBy }
}
```

### 21.2 Problem

GraphQL lets clients choose shape. Route-level authorization is insufficient.

### 21.3 Correct model

Authorization at:

- operation level,
- object level,
- field level,
- resolver level,
- batch loader level.

DataLoader must not batch across unauthorized context incorrectly.

Bad cache key:

```java
caseId
```

Better:

```java
subjectId + permissionHash + caseId
```

or avoid caching authorized projections across subjects.

---

## 22. Anti-Pattern 21 — OpenAPI Security Declared but Object Authorization Missing

### 22.1 Bentuk umum

OpenAPI says:

```yaml
security:
  - bearerAuth: []
```

or:

```yaml
security:
  - oauth2:
      - case.read
```

Developer assumes endpoint is secure.

### 22.2 Problem

OpenAPI security declaration usually describes authentication scheme and coarse scope. It does not prove object-level authorization.

`case.read` does not answer:

```text
Can this subject read this exact case?
```

### 22.3 Perbaikan

API contract should document authorization semantics:

```yaml
x-authorization:
  action: case.read
  resource: case
  resourceIdPath: $.path.id
  objectLevel: required
  tenantScoped: true
  hiddenWhenDenied: true
```

Even if custom extension is not enforced automatically, it improves review and testing.

---

## 23. Anti-Pattern 22 — Repository Method Without Scope

### 23.1 Bentuk umum

```java
Optional<CaseEntity> findById(UUID id);
```

Used everywhere.

### 23.2 Problem

`findById` makes unsafe access easy.

### 23.3 Safer repository API

```java
Optional<CaseEntity> findVisibleById(Subject subject, UUID id);

Page<CaseEntity> findVisible(Subject subject, CaseSearchCriteria criteria, Pageable pageable);
```

or:

```java
Optional<CaseEntity> findByIdAndTenantId(UUID id, TenantId tenantId);
```

### 23.4 Nuance

Do not put all policy into repository. But repository should make unsafe query harder.

A good compromise:

- repository supports scoped query,
- policy service decides scopes,
- application service composes both.

---

## 24. Anti-Pattern 23 — Over-Broad Service Account

### 24.1 Bentuk umum

All microservices use one credential:

```text
service-account: backend-admin
permissions: *
```

### 24.2 Failure mode

Compromise of one service becomes compromise of all resources.

### 24.3 Correct model

Use workload-specific identity:

```text
case-service
report-service
notification-service
data-export-worker
billing-sync-worker
```

Grant only needed actions.

```text
case-service: case.read, case.update
report-service: case.report.read scoped to reportable fields
data-export-worker: export.generate scoped to approved jobs
```

### 24.4 Confused deputy defense

Downstream should check:

- who is calling,
- on whose behalf,
- for what action,
- with what resource scope,
- whether delegation is allowed.

---

## 25. Anti-Pattern 24 — Fallback to Legacy Endpoint

### 25.1 Bentuk umum

New endpoint protected:

```text
/api/v2/cases/{id}
```

Old endpoint still active:

```text
/api/v1/caseDetails?id=...
```

### 25.2 Problem

Authorization hardening happens only on new endpoint.

### 25.3 Detection

Search for:

- deprecated controllers,
- old servlet mappings,
- admin JSP pages,
- direct file handlers,
- old SOAP endpoint,
- batch upload endpoint,
- test/debug endpoints,
- actuator exposure,
- internal API gateway routes.

### 25.4 Perbaikan

Every resource/action should have route inventory.

```text
Resource: Case
Action: Read
Routes:
- GET /api/v2/cases/{id}
- GET /api/v1/caseDetails
- POST /api/report/case-detail
- SOAP getCaseDetail
- GraphQL case(id)
- Export generated file download
```

Then verify all routes share authorization semantics.

---

## 26. Anti-Pattern 25 — Authorization Hidden in Random Business Logic

### 26.1 Bentuk umum

```java
if (caseEntity.getStatus() == CLOSED && !user.isSupervisor()) {
    throw new BusinessException("Cannot edit closed case");
}
```

Another service:

```java
if (!user.getDepartment().equals(caseEntity.getDepartment())) {
    throw new ForbiddenException();
}
```

Another service:

```java
if (caseEntity.isSensitive()) {
    return null;
}
```

### 26.2 Problem

Policy is scattered. No one can answer:

```text
What exactly can a supervisor do?
```

### 26.3 Perbaikan

Extract policy to named rules.

```java
public final class CaseEditPolicy implements AuthorizationPolicy {
    public AuthorizationDecision evaluate(Subject subject, CaseEntity caze, AuthorizationContext ctx) {
        if (caze.isClosed()) {
            return deny(ReasonCode.CASE_CLOSED);
        }
        if (!subject.departmentId().equals(caze.departmentId())) {
            return deny(ReasonCode.DEPARTMENT_SCOPE_MISMATCH);
        }
        return allow();
    }
}
```

Business method calls named policy.

```java
authz.requireAllowed(subject, Action.CASE_EDIT, ResourceRef.caseRef(id), context);
```

---

## 27. Anti-Pattern 26 — Overusing SpEL Until Policy Becomes Unreadable

### 27.1 Bentuk umum

```java
@PreAuthorize("hasAuthority('case.approve') and " +
              "@caseAuth.isAssigned(authentication, #id) and " +
              "@caseAuth.isInSameAgency(authentication, #id) and " +
              "!@caseAuth.isSelfApproval(authentication, #id) and " +
              "@riskAuth.isLowRisk(authentication, #id)")
```

### 27.2 Problem

Annotation becomes policy language without governance.

Problems:

- hard to test,
- hard to audit,
- hard to reuse,
- no structured decision reason,
- repeated DB calls,
- self-invocation/proxy pitfalls,
- unreadable diff.

### 27.3 Perbaikan

Use annotation for coarse routing, policy service for domain decision.

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approve(UUID id) {
    caseApprovalPolicy.requireAllowed(currentSubject(), id);
    ...
}
```

or custom method security if needed:

```java
@RequiresAuthorization(action = "case.approve", resourceId = "#id")
public void approve(UUID id) { ... }
```

---

## 28. Anti-Pattern 27 — Bypassing Authorization in Tests and Fixtures

### 28.1 Bentuk umum

Tests use admin everywhere:

```java
@WithMockUser(roles = "ADMIN")
```

or services expose bypass methods:

```java
caseService.createWithoutAuthorization(...)
```

### 28.2 Problem

Tests prove happy path, not authorization correctness.

### 28.3 Perbaikan

Use test personas:

```text
agencyAOfficer
agencyAReviewer
agencyBOfficer
systemAdmin
supportUser
externalApplicant
suspendedUser
delegatedOfficer
breakGlassUser
```

For every sensitive action, test:

- allowed persona,
- wrong tenant,
- wrong role,
- wrong state,
- wrong assignment,
- self-approval,
- expired delegation,
- revoked permission.

### 28.4 Mutation idea

If deleting authorization check does not break tests, tests are insufficient.

---

## 29. Anti-Pattern 28 — “403 Means Secure”

### 29.1 Problem

A 403 response only proves one path denied one request.

It does not prove:

- all object variants denied,
- list endpoint filtered,
- export blocked,
- field hidden,
- async job safe,
- cache safe,
- old endpoint safe,
- internal endpoint safe.

### 29.2 Better assertion

Authorization testing should verify invariants:

```text
Agency A subject can never observe Agency B case through any supported read path.
```

Paths include:

- detail,
- search,
- report,
- export,
- notification,
- file download,
- audit view,
- GraphQL nested field,
- async job result,
- websocket event.

---

## 30. Anti-Pattern 29 — No Permission Lifecycle

### 30.1 Bentuk umum

Permission added:

```text
case.override
```

No documentation:

- who can get it,
- who approves it,
- what scope it has,
- when it expires,
- what audit is required,
- what happens during migration.

### 30.2 Problem

Permission becomes permanent capability with unknown blast radius.

### 30.3 Correct lifecycle

Every permission should have:

```text
Name
Description
Owner
Resource type
Allowed actions
Scope model
Risk classification
Grant process
Revocation process
Default assignment
Audit requirement
Test cases
Deprecation plan
```

---

## 31. Anti-Pattern 30 — Authorization Without Ownership of the Authorization Model

### 31.1 Problem

No one owns authorization model. Each feature team invents its own.

Result:

- inconsistent role names,
- duplicate permissions,
- impossible audit,
- contradictory behavior,
- role explosion,
- scattered checks,
- fragile tests.

### 31.2 Correct governance

A serious system needs authorization ownership:

- architecture owner,
- security owner,
- domain owner,
- policy review process,
- permission registry,
- threat model review,
- audit review,
- migration path.

This does not mean one team bottlenecks all changes. It means the model has invariants and governance.

---

## 32. Anti-Pattern 31 — Missing Negative Requirements

### 32.1 Problem

Requirements say:

```text
Reviewer can approve cases.
```

But omit:

```text
Reviewer cannot approve own case.
Reviewer cannot approve case from another agency.
Reviewer cannot approve case in CLOSED state.
Reviewer cannot approve when delegation expired.
Reviewer cannot approve if conflict of interest exists.
```

Authorization is often more about negative requirements than positive ones.

### 32.2 Correct requirement style

For every action, define:

```text
Who can do it?
On what resource?
In what state?
Under what scope?
What must be false?
What must be audited?
What is the denial behavior?
```

---

## 33. Failure Mode Taxonomy

A top-level engineer should classify authorization bugs, not merely patch them.

### 33.1 By missing dimension

| Missing dimension | Example |
|---|---|
| Subject | system does not know who is acting |
| Action | generic `access` instead of specific action |
| Resource | checks function but not object |
| Context | ignores tenant/state/time/risk |
| Policy | no explicit rule exists |
| Scope | role not constrained to org/resource |
| Evidence | no audit reason or policy version |

### 33.2 By location

| Location | Failure |
|---|---|
| UI | hidden button only |
| Controller | route-only authorization |
| Service | business operation bypass |
| Repository | unscoped query |
| DB | direct access bypass |
| Cache | wrong cache key |
| Messaging | producer-trust bypass |
| Batch | async context loss |
| Export | report bypass |
| Search index | unauthorized indexing/querying |
| File storage | direct storage key leak |

### 33.3 By direction

| Type | Meaning |
|---|---|
| Horizontal privilege escalation | user accesses peer user's resource |
| Vertical privilege escalation | user gains admin/higher capability |
| Cross-tenant leakage | user accesses another tenant/org |
| Cross-state violation | user acts on resource in invalid lifecycle state |
| Cross-channel bypass | mobile/internal/export path bypasses web rules |
| Cross-time violation | expired/revoked access still works |
| Cross-field leakage | object access allowed but sensitive field leaked |

---

## 34. Detection Strategy

### 34.1 Static search patterns

Search for:

```text
isAdmin(
hasRole("ADMIN")
hasAuthority("ROLE_ADMIN")
findById(
findAll(
createQuery(
@Query(
SELECT *
WithoutAuth
bypass
internal
export
download
presigned
@PermitAll
permitAll
anonymous
```

### 34.2 Endpoint inventory

Build a table:

| Route | Action | Resource | Object-level check | Tenant check | Field mask | Audit | Test |
|---|---|---|---|---|---|---|---|
| GET /cases/{id} | case.read | case | yes | yes | yes | yes | yes |
| GET /cases | case.list | case | query-scope | yes | yes | yes | yes |
| POST /cases/{id}/approve | case.approve | case | yes | yes | n/a | yes | yes |
| GET /cases/export | case.export | case collection | query-scope | yes | yes | yes | yes |
| GET /documents/{id}/download | document.download | document | yes | yes | n/a | yes | yes |

### 34.3 Data flow review

For each resource ID:

```text
Where is it produced?
Where is it consumed?
Which consumers perform object-level authorization?
Can attacker substitute another ID?
```

### 34.4 Runtime telemetry

Capture:

- denied action,
- allowed sensitive action,
- subject,
- tenant,
- resource type,
- reason code,
- policy version,
- request route,
- source service,
- correlation ID,
- break-glass/delegation flag.

---

## 35. Remediation Strategy Without Chaos

### 35.1 Do not start by rewriting everything

Start with high-risk paths:

1. cross-tenant reads,
2. object detail endpoints,
3. state-changing endpoints,
4. exports/reports,
5. file downloads,
6. internal/admin endpoints,
7. async jobs,
8. service-to-service commands.

### 35.2 Introduce central decision API

```java
public interface AuthorizationService {
    AuthorizationDecision authorize(
        Subject subject,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
    );

    default void requireAllowed(
        Subject subject,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
    ) {
        AuthorizationDecision decision = authorize(subject, action, resource, context);
        if (!decision.isAllowed()) {
            throw new AccessDeniedException(decision.safeMessage());
        }
    }
}
```

### 35.3 Add decision reasons

```java
public enum ReasonCode {
    ALLOWED_BY_DIRECT_PERMISSION,
    ALLOWED_BY_SCOPED_ROLE,
    ALLOWED_BY_DELEGATION,
    DENIED_NO_PERMISSION,
    DENIED_TENANT_MISMATCH,
    DENIED_RESOURCE_STATE,
    DENIED_SELF_APPROVAL,
    DENIED_DELEGATION_EXPIRED,
    DENIED_POLICY_MISSING,
    DENIED_CONTEXT_INSUFFICIENT
}
```

### 35.4 Create compatibility mode

For legacy systems:

- log-only decisions,
- shadow evaluation,
- compare old vs new result,
- alert on mismatch,
- enforce gradually,
- keep rollback switch.

### 35.5 Build golden tests

For each anti-pattern fixed, add regression tests.

Example:

```java
@Test
void agencyAdminCannotReadOtherAgencyCaseEvenIfHasCaseReadPermission() {
    Subject agencyAAdmin = personas.agencyAAdmin();
    UUID agencyBCase = fixtures.caseInAgencyB();

    assertThatThrownBy(() -> caseService.getCase(agencyAAdmin, agencyBCase))
        .isInstanceOf(AccessDeniedException.class);
}
```

---

## 36. Java-Specific Notes: Java 8 to Java 25

### 36.1 Java 8 baseline

Use:

- final classes/value objects,
- enums for action/resource type,
- immutable builders,
- explicit interfaces,
- `Optional` carefully,
- no records/sealed types.

### 36.2 Java 17+

Use records for simple immutable value objects:

```java
public record ResourceRef(ResourceType type, String id) {}
public record Action(String name) {}
```

Use sealed types for decision variants:

```java
public sealed interface Decision permits Allow, Deny, NotApplicable {}
```

### 36.3 Java 21/25 era

Virtual threads can make remote PDP calls easier to scale, but they do not remove:

- latency budget,
- circuit breaker,
- fail-closed semantics,
- timeout design,
- audit requirement.

Do not confuse concurrency scalability with authorization correctness.

---

## 37. Production Checklist

Use this checklist when reviewing any authorization implementation.

### 37.1 Model checklist

- [ ] Is every sensitive operation represented as a named action?
- [ ] Is resource type explicit?
- [ ] Is resource instance considered?
- [ ] Is tenant/org/agency scope explicit?
- [ ] Are negative requirements documented?
- [ ] Are deny reasons represented structurally?
- [ ] Is default deny?

### 37.2 Code checklist

- [ ] No unscoped `findById` on protected resource paths.
- [ ] No trust in client-provided role/tenant/permission.
- [ ] No route-only check for domain operation.
- [ ] No UI-only authorization.
- [ ] No over-broad `isAdmin` bypass.
- [ ] No export/report bypass.
- [ ] No file download bypass.
- [ ] No async job context loss.
- [ ] No cache key missing authorization dimensions.
- [ ] No silent break-glass.

### 37.3 Test checklist

- [ ] Allowed path tested.
- [ ] Wrong role tested.
- [ ] Wrong tenant tested.
- [ ] Wrong object owner tested.
- [ ] Wrong resource state tested.
- [ ] Self-approval tested.
- [ ] Expired delegation tested.
- [ ] Revoked permission tested.
- [ ] Export path tested.
- [ ] File download path tested.
- [ ] Search/list path tested.
- [ ] Internal/job/message path tested.

### 37.4 Audit checklist

- [ ] Sensitive allow events logged.
- [ ] Deny events logged safely.
- [ ] Policy version logged.
- [ ] Subject/resource/context snapshot sufficient.
- [ ] Break-glass usage escalated.
- [ ] Temporary privilege reviewed.
- [ ] Correlation ID propagated.

---

## 38. Top 1% Insights

1. **Authorization bugs are usually semantic bugs, not syntax bugs.**  
   The code compiles and the endpoint has `@PreAuthorize`, but the semantics are incomplete.

2. **The most dangerous permission is the one whose scope is implicit.**  
   `ADMIN` without scope is often a latent incident.

3. **Object-level authorization is not optional for resource APIs.**  
   Any endpoint accepting object ID must check the exact object.

4. **List/search/export/report are authorization surfaces.**  
   Many teams protect detail and forget collection outputs.

5. **Async boundaries destroy authorization context unless explicitly carried or re-evaluated.**

6. **Cache can become an authorization bypass.**  
   Cache key correctness is security-critical.

7. **Break-glass without audit is not emergency access; it is a hidden backdoor.**

8. **A policy missing case must deny.**  
   If unknown action allows, every new feature is a potential privilege escalation.

9. **Authorization should be explained, not merely returned as boolean.**  
   Without reason/evidence, you cannot debug, audit, or govern.

10. **Top engineers design against bypass paths, not just happy-path checks.**

---

## 39. Summary

Authorization anti-patterns are recurring shapes of failure:

- global admin checks,
- UI-only enforcement,
- controller-only enforcement,
- trusting client-provided authority,
- trusting stale token claims,
- missing object-level checks,
- query/export/file bypass,
- cache leakage,
- internal endpoint bypass,
- async/job/message bypass,
- silent break-glass,
- scattered policy,
- missing negative requirements,
- allow-by-default fallback.

The repair is not simply “add more checks”.

The repair is to build a consistent decision system:

```text
subject + action + resource + context + policy + evidence -> decision + obligations + audit
```

And then ensure every path that touches protected resources goes through the right decision boundary.

---

## 40. References

- OWASP Authorization Cheat Sheet — guidance on validating permissions on every request, deny-by-default, least privilege, and centralized authorization.
- OWASP API Security Top 10 2023 — API1 Broken Object Level Authorization.
- OWASP Web Security Testing Guide — Authorization Testing and IDOR testing.
- OWASP REST Security Cheat Sheet — token/session state and server-side validation considerations.
- Spring Security Reference — `authorizeHttpRequests`, `AuthorizationManager`, `AccessDeniedException`, and request authorization flow.
- NIST RBAC resources — role hierarchy, constraints, and separation of duty foundations.
- RFC 9110 — HTTP semantics for status code behavior.

---

## 41. Status Seri

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
- Part 27 — Auditability, Explainability, and Regulatory Defensibility
- Part 28 — Secure Authorization Testing Strategy
- Part 29 — Authorization Anti-Patterns and Failure Modes

Berikutnya:

- Part 30 — Designing an Authorization Domain Model in Java

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-028.md">⬅️ Part 28 — Secure Authorization Testing Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-030.md">Java Authorization Modes and Patterns — Advanced Engineering ➡️</a>
</div>
