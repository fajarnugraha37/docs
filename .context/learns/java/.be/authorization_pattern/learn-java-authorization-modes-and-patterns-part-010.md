# learn-java-authorization-modes-and-patterns-part-010

# Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Fokus: **Java 8–25**, enterprise backend, Spring/Jakarta/service-layer architecture, multi-tenant/cross-organization systems, regulatory/case-management style systems.  
> Posisi seri: Part 10 dari maksimal 35 part.  
> Status seri: **belum selesai**.

---

## 0. Tujuan Part Ini

Part sebelumnya membahas ACL dan domain object security: bagaimana permission bisa melekat pada instance object tertentu. Part ini bergerak ke masalah yang lebih fundamental pada sistem enterprise: **data boundary**.

Pertanyaan utamanya bukan hanya:

> “Apakah user ini boleh melihat object ini?”

Melainkan:

> “Object ini berada dalam boundary siapa, pada scope organisasi/tenant mana, dengan relasi apa, dan apakah seluruh jalur akses — API, service, repository, query, cache, export, search, async job — konsisten menegakkan boundary tersebut?”

Dalam sistem nyata, kebocoran authorization sering bukan terjadi karena endpoint benar-benar tidak punya check. Kebocoran sering terjadi karena check-nya **terlalu dangkal**:

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable Long id) {
    return caseService.getCase(id);
}
```

Kode di atas hanya menjawab:

> “Apakah user punya permission membaca case?”

Tetapi belum menjawab:

> “Apakah case dengan ID ini berada di tenant/agency/team/scope yang boleh dibaca user ini?”

Inilah inti Part 10: **authorization harus menjaga boundary data, bukan hanya fungsi.**

---

## 1. Core Mental Model

### 1.1 Ownership Bukan Authorization

Kesalahan awal yang sangat umum:

> “Kalau user adalah owner, berarti boleh akses.”

Kalimat ini terlalu pendek.

Ownership adalah **fakta domain**. Authorization adalah **keputusan policy**.

Contoh:

| Situasi | Owner? | Boleh akses? | Kenapa |
|---|---:|---:|---|
| Applicant melihat draft application miliknya | Ya | Ya | Policy mengizinkan owner melihat draft sendiri |
| Applicant melihat application miliknya yang sedang under investigation | Ya | Mungkin tidak | Policy dapat membatasi akses saat investigation |
| Officer bukan owner tapi assigned officer | Tidak | Ya | Assignment memberi authority operasional |
| Supervisor bukan owner tapi dalam agency yang sama | Tidak | Ya/Mungkin | Tergantung scope supervisi |
| System admin bukan owner | Tidak | Mungkin | Admin teknis belum tentu boleh lihat data bisnis |
| Support engineer impersonate user | Tidak | Mungkin | Harus lewat delegated/break-glass policy |

Jadi mental model yang lebih tepat:

```text
ownership = relationship/fact
authorization = decision based on relationship + action + resource + context + policy
```

Ownership bisa menjadi input authorization, tetapi tidak boleh disamakan dengan authorization.

---

### 1.2 Tenant Boundary Adalah Invariant

Dalam sistem multi-tenant, boundary tenant bukan sekadar filter UI. Boundary tenant adalah invariant keamanan.

Invariant berarti:

> Kondisi yang harus selalu benar di seluruh jalur eksekusi sistem.

Contoh invariant:

```text
User dari tenant A tidak boleh membaca, mencari, mengubah, mengekspor,
menghapus, mengunduh file, melihat audit trail, atau menerima event milik tenant B,
kecuali ada policy eksplisit cross-tenant yang tercatat dan diaudit.
```

Perhatikan kata **seluruh jalur**.

Bukan hanya:

```text
GET /cases/{id}
```

Tetapi juga:

```text
GET /cases?keyword=...
POST /cases/export
GET /reports/case-aging
GET /documents/{id}/download
GET /audit-trails?caseId=...
POST /bulk-actions/close-cases
Kafka consumer reprocess event
Batch archival job
Search index query
Admin console
Support tool
```

Engineer top-level melihat boundary sebagai **sifat sistem**, bukan check lokal di satu endpoint.

---

### 1.3 Boundary Harus Dinyatakan, Bukan Diharapkan

Sistem yang lemah biasanya mengandalkan asumsi implisit:

```text
caseId yang masuk pasti milik tenant user karena UI hanya menampilkan case user tersebut.
```

Asumsi ini salah.

Client tidak bisa dipercaya. URL bisa diubah. Request body bisa dimodifikasi. ID bisa ditebak. UUID pun bukan authorization. OWASP menempatkan Broken Object Level Authorization sebagai risiko utama API karena endpoint yang menerima object identifier membuka permukaan serangan luas; authorization harus diperiksa pada setiap fungsi yang mengakses data source menggunakan ID dari user.

Prinsipnya:

```text
Never trust that a resource identifier belongs to the caller's boundary.
Always prove it server-side.
```

---

## 2. Apa Itu Data Boundary?

Data boundary adalah garis logis yang menentukan **siapa boleh melihat/mengubah data mana**.

Boundary bisa berbentuk:

1. Tenant.
2. Organization.
3. Agency.
4. Department.
5. Team.
6. Region/jurisdiction.
7. Case assignment.
8. Case type.
9. Confidentiality level.
10. Data classification.
11. Ownership.
12. Role scope.
13. Workflow state.
14. Delegation scope.
15. Time window.
16. Support/break-glass session.

Dalam sistem sederhana, boundary mungkin hanya:

```text
owner_user_id = current_user_id
```

Dalam sistem enterprise, boundary bisa menjadi:

```text
case.tenant_id = current_tenant_id
AND case.agency_id IN current_user.agency_scope
AND case.case_type IN current_user.case_type_scope
AND case.confidentiality_level <= current_user.clearance_level
AND (
    case.assigned_officer_id = current_user.id
    OR current_user has permission 'case.read.all.within-agency'
    OR current_user has active delegated authority for case.team_id
)
AND case.status not in hidden_status_for_current_channel
```

Itu sebabnya boundary enforcement tidak bisa dianggap sebagai “tambahkan tenantId di query” saja.

---

## 3. Ownership Model

### 3.1 Jenis Ownership

Tidak semua ownership sama.

| Jenis Ownership | Arti | Contoh | Authorization Implication |
|---|---|---|---|
| Creator ownership | User membuat record | applicant membuat draft | Bisa edit sebelum submit |
| Business ownership | User/agency bertanggung jawab atas record | agency pemilik case | Bisa manage lifecycle |
| Custodial ownership | Pihak menyimpan data, bukan pemilik bisnis | platform/admin | Belum tentu boleh baca isi |
| Assigned ownership | Officer/team ditugaskan | case officer | Bisa action sesuai assignment |
| Legal ownership | Hak formal atas data | applicant data pribadi | Membutuhkan consent/legal basis |
| Operational ownership | Tim yang memproses | enforcement unit | Bisa proses dalam scope kerja |
| Technical ownership | Tim mengelola sistem | SRE/support | Biasanya tidak otomatis boleh akses business data |

Kesalahan desain sering muncul saat semua jenis ownership dipadatkan menjadi satu kolom:

```sql
owner_id
```

Kolom tersebut ambigu:

```text
Owner sebagai pembuat?
Owner sebagai pemilik bisnis?
Owner sebagai assigned officer?
Owner sebagai tenant?
```

Untuk sistem serius, lebih baik eksplisit:

```sql
created_by_user_id
applicant_user_id
owning_agency_id
assigned_officer_id
assigned_team_id
tenant_id
```

---

### 3.2 Ownership Tidak Selalu Memberi Hak Mutasi

Contoh state-based ownership:

```text
Applicant owns application.
Applicant can edit application while status = DRAFT.
Applicant cannot edit after status = SUBMITTED.
Applicant may withdraw only before status = APPROVED/REJECTED.
```

Jika policy dibuat hanya dengan ownership:

```java
boolean canEdit = application.ownerUserId().equals(currentUser.id());
```

Maka user bisa mengubah application setelah submitted.

Model yang benar:

```java
boolean canEdit = application.ownerUserId().equals(currentUser.id())
        && application.status() == ApplicationStatus.DRAFT;
```

Namun untuk sistem besar, jangan biarkan boolean tersebar. Bungkus sebagai policy eksplisit:

```java
public final class ApplicationPolicy {

    public AuthorizationDecision canEditDraft(UserContext user, Application app) {
        if (!app.isOwnedBy(user.userId())) {
            return AuthorizationDecision.deny("APPLICATION_NOT_OWNED_BY_USER");
        }
        if (!app.isDraft()) {
            return AuthorizationDecision.deny("APPLICATION_NOT_DRAFT");
        }
        return AuthorizationDecision.allow("OWNER_CAN_EDIT_DRAFT_APPLICATION");
    }
}
```

---

### 3.3 Ownership Bisa Berubah

Ownership tidak selalu statis.

Contoh:

1. Case reassignment dari officer A ke officer B.
2. Agency merger/restructure.
3. User pindah department.
4. Applicant representative berubah.
5. Delegation expired.
6. Team dissolved.
7. Data migrated ke new tenant.

Design implication:

```text
Authorization cannot assume ownership facts are immutable unless domain explicitly says so.
```

Jika cache menyimpan decision:

```text
user A can update case 123 = true
```

Lalu case 123 reassigned ke user B, cache decision user A harus invalidated atau TTL sangat pendek.

---

## 4. Tenancy Model

### 4.1 Apa Itu Tenant?

Tenant adalah boundary isolasi logical di mana data, configuration, users, roles, dan policies dapat dipisahkan.

Tenant bisa berarti:

1. Customer organisasi pada SaaS.
2. Agency pada sistem pemerintahan.
3. Business unit.
4. Jurisdiction.
5. Environment logical.
6. Partner/merchant.
7. Institution.

Yang penting bukan namanya, tetapi invariant-nya.

```text
Tenant is the highest default data isolation boundary.
```

Default-nya:

```text
No cross-tenant access unless explicitly modeled, authorized, and audited.
```

---

### 4.2 Model Tenancy Umum

| Model | Penjelasan | Kelebihan | Risiko |
|---|---|---|---|
| Database per tenant | Tiap tenant punya DB sendiri | Isolasi kuat | Operasional kompleks |
| Schema per tenant | Tiap tenant punya schema | Isolasi lumayan | Migration lebih rumit |
| Shared schema + tenant_id | Semua data satu schema dengan tenant_id | Sederhana dan scalable | Raw query mudah bocor |
| Hybrid | Tenant besar dedicated, kecil shared | Fleksibel | Kompleksitas tinggi |

Dalam Java enterprise, model paling umum adalah:

```text
shared schema + tenant_id
```

Karena mudah untuk query/reporting, tetapi paling rawan jika query tidak konsisten.

---

### 4.3 Tenant ID Bukan Dari Request Body

Anti-pattern:

```json
{
  "tenantId": "tenant-b",
  "caseId": "CASE-123"
}
```

Lalu server melakukan:

```java
caseRepository.findByTenantIdAndId(request.tenantId(), request.caseId())
```

Ini salah karena tenant boundary dikendalikan client.

Tenant context harus berasal dari trusted context:

1. Authenticated session server-side.
2. Token claim yang sudah diverifikasi dan dimapping ke internal tenant.
3. Server-side user profile/entitlement lookup.
4. mTLS/workload identity untuk service-to-service.
5. Explicit admin/support session yang diaudit.

Pattern yang lebih baik:

```java
TenantId tenantId = tenantContext.currentTenantId();
CaseEntity entity = caseRepository.findVisibleById(tenantId, caseId)
        .orElseThrow(ResourceNotFoundException::new);
```

Request boleh membawa tenant selector hanya jika user memang punya multi-tenant scope, dan tetap harus divalidasi:

```java
TenantId selectedTenant = TenantId.of(request.tenantId());
if (!userContext.allowedTenantIds().contains(selectedTenant)) {
    throw new AccessDeniedException("TENANT_NOT_IN_USER_SCOPE");
}
```

---

## 5. Organization, Agency, Department, Team Boundary

Tenant bukan satu-satunya boundary.

Dalam regulatory/case-management system, struktur bisa seperti:

```text
Tenant
 └── Agency
      └── Division
           └── Department
                └── Team
                     └── Officer
```

Tetapi authorization jarang murni tree. Sering ada matrix:

```text
Officer belongs to Department A
Officer temporarily assigned to Taskforce B
Officer can view Case Type X only
Officer can approve up to Risk Level 2
Officer cannot approve cases they created
Officer can view cross-agency case only when joint investigation flag is active
```

Jadi boundary bukan hanya hierarchy. Boundary adalah kombinasi:

```text
structural scope + functional scope + relationship scope + state/context constraints
```

---

### 5.1 Scope-Bound Role

Role tanpa scope berbahaya.

```text
CASE_MANAGER
```

Pertanyaan yang hilang:

```text
CASE_MANAGER untuk tenant mana?
Agency mana?
Case type apa?
Jurisdiction mana?
Confidentiality level apa?
```

Lebih aman:

```text
role = CASE_MANAGER
scope = tenant:T1 / agency:CEA / caseType:LICENSE_APPLICATION
```

Model data sederhana:

```sql
CREATE TABLE user_role_assignment (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    role_code VARCHAR(100) NOT NULL,
    tenant_id VARCHAR(100) NOT NULL,
    agency_id VARCHAR(100),
    department_id VARCHAR(100),
    case_type VARCHAR(100),
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP,
    status VARCHAR(30) NOT NULL
);
```

Java representation:

```java
public final class ScopedRole {
    private final String roleCode;
    private final TenantId tenantId;
    private final Optional<AgencyId> agencyId;
    private final Optional<DepartmentId> departmentId;
    private final Optional<String> caseType;
    private final Instant validFrom;
    private final Optional<Instant> validUntil;

    public boolean appliesTo(ResourceBoundary boundary, Instant now) {
        return isActiveAt(now)
                && tenantId.equals(boundary.tenantId())
                && agencyId.map(id -> id.equals(boundary.agencyId())).orElse(true)
                && departmentId.map(id -> id.equals(boundary.departmentId())).orElse(true)
                && caseType.map(type -> type.equals(boundary.caseType())).orElse(true);
    }

    private boolean isActiveAt(Instant now) {
        return !now.isBefore(validFrom)
                && validUntil.map(until -> now.isBefore(until)).orElse(true);
    }
}
```

---

## 6. Boundary as First-Class Domain Object

Jangan biarkan boundary tersebar sebagai primitive string di seluruh codebase.

Anti-pattern:

```java
String tenantId = auth.getClaim("tenant");
String agencyId = request.getParameter("agencyId");
String departmentId = user.getDepartmentId();
```

Pattern yang lebih kuat:

```java
public final class ResourceBoundary {
    private final TenantId tenantId;
    private final Optional<AgencyId> agencyId;
    private final Optional<DepartmentId> departmentId;
    private final Optional<TeamId> teamId;
    private final Optional<String> jurisdiction;
    private final Optional<String> caseType;
    private final Optional<String> confidentialityLevel;

    private ResourceBoundary(
            TenantId tenantId,
            Optional<AgencyId> agencyId,
            Optional<DepartmentId> departmentId,
            Optional<TeamId> teamId,
            Optional<String> jurisdiction,
            Optional<String> caseType,
            Optional<String> confidentialityLevel
    ) {
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId");
        this.agencyId = Objects.requireNonNull(agencyId, "agencyId");
        this.departmentId = Objects.requireNonNull(departmentId, "departmentId");
        this.teamId = Objects.requireNonNull(teamId, "teamId");
        this.jurisdiction = Objects.requireNonNull(jurisdiction, "jurisdiction");
        this.caseType = Objects.requireNonNull(caseType, "caseType");
        this.confidentialityLevel = Objects.requireNonNull(confidentialityLevel, "confidentialityLevel");
    }

    public TenantId tenantId() {
        return tenantId;
    }

    public Optional<AgencyId> agencyId() {
        return agencyId;
    }

    public Optional<DepartmentId> departmentId() {
        return departmentId;
    }

    public Optional<TeamId> teamId() {
        return teamId;
    }

    public Optional<String> jurisdiction() {
        return jurisdiction;
    }

    public Optional<String> caseType() {
        return caseType;
    }

    public Optional<String> confidentialityLevel() {
        return confidentialityLevel;
    }
}
```

Java 16+ bisa memakai `record`:

```java
public record ResourceBoundary(
        TenantId tenantId,
        Optional<AgencyId> agencyId,
        Optional<DepartmentId> departmentId,
        Optional<TeamId> teamId,
        Optional<String> jurisdiction,
        Optional<String> caseType,
        Optional<String> confidentialityLevel
) {
    public ResourceBoundary {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(agencyId, "agencyId");
        Objects.requireNonNull(departmentId, "departmentId");
        Objects.requireNonNull(teamId, "teamId");
        Objects.requireNonNull(jurisdiction, "jurisdiction");
        Objects.requireNonNull(caseType, "caseType");
        Objects.requireNonNull(confidentialityLevel, "confidentialityLevel");
    }
}
```

Top 1% insight:

> Kalau boundary menjadi object eksplisit, semua layer bisa berbicara dengan bahasa yang sama: policy, repository, audit, event, cache, dan test.

---

## 7. Tenant Context Propagation in Java

### 7.1 Problem

Java backend sering memakai thread-local security context:

```java
SecurityContextHolder.getContext().getAuthentication()
```

Lalu tenant context ikut dimasukkan ke `ThreadLocal`.

```java
TenantContextHolder.set(tenantId);
```

Ini bisa bekerja di servlet synchronous flow, tetapi rawan pada:

1. Async execution.
2. Thread pool reuse.
3. Scheduled job.
4. CompletableFuture.
5. Reactor/WebFlux.
6. Virtual thread / structured concurrency jika context tidak jelas.
7. Message consumer.
8. Batch processing.

Kesalahan fatal:

```text
Tenant context bocor dari request sebelumnya ke request berikutnya karena ThreadLocal tidak dibersihkan.
```

---

### 7.2 Safe Pattern for Servlet Request

```java
public final class TenantContextFilter extends OncePerRequestFilter {

    private final TenantResolver tenantResolver;

    public TenantContextFilter(TenantResolver tenantResolver) {
        this.tenantResolver = tenantResolver;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        TenantContext context = tenantResolver.resolve(request);
        try {
            TenantContextHolder.set(context);
            filterChain.doFilter(request, response);
        } finally {
            TenantContextHolder.clear();
        }
    }
}
```

Key rule:

```text
Every set must have finally-clear.
```

---

### 7.3 Explicit Context Is Better Than Ambient Context

Untuk domain/service/repository, lebih baik explicit context:

```java
caseService.getCase(userContext, tenantContext, caseId);
```

Daripada semua mengambil global static holder:

```java
caseService.getCase(caseId); // hidden context
```

Ambient context boleh dipakai di edge layer, tetapi internal domain logic sebaiknya menerima context eksplisit agar:

1. Lebih testable.
2. Lebih aman untuk async.
3. Lebih jelas dependency-nya.
4. Lebih mudah diaudit.
5. Lebih mudah dipindahkan ke batch/message consumer.

---

### 7.4 Context Snapshot

Authorization sebaiknya memakai snapshot context, bukan membaca context berkali-kali dari sumber berubah.

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final TenantContext tenantContext;
    private final Instant decisionTime;
    private final Map<String, Object> attributes;
}
```

Keuntungan:

1. Decision deterministic untuk satu request.
2. Bisa diaudit.
3. Bisa dites.
4. Mengurangi TOCTOU akibat context berubah di tengah operasi.

---

## 8. Repository-Level Boundary Enforcement

### 8.1 Mengapa Service Check Tidak Cukup?

Misalnya service melakukan:

```java
Case caseEntity = caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);

authorizationService.authorize(user, Action.READ_CASE, caseEntity);
```

Masalah:

1. Data tenant lain sudah terambil dari DB sebelum authorization.
2. Developer lain bisa memanggil repository langsung tanpa service guard.
3. Search/export/report sering punya jalur query berbeda.
4. Lazy loading child entities bisa mengambil data di luar boundary.
5. Audit/access log bisa mencatat data sensitif sebelum denial.

Pattern lebih aman:

```java
Optional<CaseEntity> findVisibleById(TenantId tenantId, UserScope scope, CaseId caseId);
```

Contoh SQL:

```sql
SELECT c.*
FROM cases c
WHERE c.id = :case_id
  AND c.tenant_id = :tenant_id
  AND c.agency_id IN (:allowed_agency_ids)
```

Java repository:

```java
public interface CaseRepository {
    Optional<CaseEntity> findReadableById(
            TenantId tenantId,
            Set<AgencyId> allowedAgencies,
            CaseId caseId
    );
}
```

---

### 8.2 Secure Repository Method Naming

Anti-pattern:

```java
findById(id)
findAll()
findByStatus(status)
findByApplicantName(name)
```

Untuk bounded resource, prefer method eksplisit:

```java
findReadableCaseById(userScope, caseId)
findWritableCaseById(userScope, caseId)
searchReadableCases(userScope, criteria, page)
countReadableCases(userScope, criteria)
findDownloadableDocumentById(userScope, documentId)
```

Nama method harus membawa semantic authorization.

Jika method generic tetap dibutuhkan, batasi package visibility atau pakai internal repository:

```java
interface InternalCaseJpaRepository extends JpaRepository<CaseEntity, Long> {
    // Not exposed outside infrastructure package
}
```

Kemudian expose safe repository:

```java
@Component
public class CaseQueryRepository {

    private final InternalCaseJpaRepository jpa;

    public Optional<CaseEntity> findReadableById(UserScope scope, CaseId id) {
        return jpa.findByIdAndTenantIdAndAgencyIdIn(
                id.value(),
                scope.tenantId().value(),
                AgencyId.values(scope.agencyIds())
        );
    }
}
```

---

## 9. Query Scoping Pattern

### 9.1 Scope Predicate

Untuk menghindari copy-paste filter, buat object predicate authorization.

```java
public final class CaseVisibilityScope {
    private final TenantId tenantId;
    private final Set<AgencyId> agencyIds;
    private final Set<String> caseTypes;
    private final boolean includeConfidential;

    public boolean canPossiblySee(CaseSummary row) {
        if (!tenantId.equals(row.tenantId())) {
            return false;
        }
        if (!agencyIds.contains(row.agencyId())) {
            return false;
        }
        if (!caseTypes.isEmpty() && !caseTypes.contains(row.caseType())) {
            return false;
        }
        if (row.confidential() && !includeConfidential) {
            return false;
        }
        return true;
    }
}
```

Namun jangan gunakan predicate Java untuk filter setelah fetch pada dataset besar:

```java
// Anti-pattern for real authorization
return repository.findAll().stream()
        .filter(scope::canPossiblySee)
        .collect(toList());
```

Predicate harus diterjemahkan ke query.

---

### 9.2 Spring Data Specification Example

```java
public final class CaseSpecifications {

    public static Specification<CaseEntity> visibleTo(UserScope scope) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            predicates.add(cb.equal(root.get("tenantId"), scope.tenantId().value()));

            if (!scope.agencyIds().isEmpty()) {
                CriteriaBuilder.In<String> agencyIn = cb.in(root.get("agencyId"));
                for (AgencyId agencyId : scope.agencyIds()) {
                    agencyIn.value(agencyId.value());
                }
                predicates.add(agencyIn);
            } else {
                predicates.add(cb.disjunction()); // no agency = see nothing
            }

            if (!scope.caseTypes().isEmpty()) {
                CriteriaBuilder.In<String> typeIn = cb.in(root.get("caseType"));
                for (String type : scope.caseTypes()) {
                    typeIn.value(type);
                }
                predicates.add(typeIn);
            }

            if (!scope.canViewConfidential()) {
                predicates.add(cb.isFalse(root.get("confidential")));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
```

Usage:

```java
public Page<CaseSummaryDto> search(UserContext user, CaseSearchCriteria criteria, Pageable pageable) {
    UserScope scope = scopeResolver.resolveCaseVisibilityScope(user);

    Specification<CaseEntity> spec = Specification
            .where(CaseSpecifications.visibleTo(scope))
            .and(CaseSpecifications.matches(criteria));

    return caseRepository.findAll(spec, pageable)
            .map(caseMapper::toSummaryDto);
}
```

Important:

```text
Authorization predicate must be composed before pagination.
```

Jika filter dilakukan setelah pagination, user bisa melihat halaman kosong, count salah, atau infer data tenant lain.

---

## 10. `403` vs `404` for Boundary Violation

Saat user meminta resource tenant lain:

```http
GET /cases/123
```

Apa response yang benar?

```text
403 Forbidden?
404 Not Found?
```

Tidak ada satu jawaban universal. Gunakan decision table.

| Kondisi | Response | Alasan |
|---|---|---|
| Resource tidak ada | 404 | Benar-benar tidak ada |
| Resource ada tapi di tenant lain dan existence tidak boleh diketahui | 404 | Hide existence |
| Resource ada di tenant sama tapi user kurang permission | 403 | User boleh tahu resource ada, tapi tidak boleh action |
| User belum login | 401 | Authentication required |
| Admin/support mencoba cross-boundary tanpa session valid | 403 + audit | Attempt validly identified but denied |
| API internal dengan caller terpercaya | 403/structured denial | Troubleshooting lebih penting |

Pattern repository aman:

```java
Optional<CaseEntity> caseOpt = caseRepository.findReadableById(scope, caseId);
if (caseOpt.isEmpty()) {
    throw new ResourceNotFoundException("CASE_NOT_FOUND");
}
```

Ini menyatukan:

```text
not exist + not visible
```

Untuk menghindari resource existence leakage.

Namun audit internal bisa tetap mencatat:

```text
case_id requested, visible=false, reason=OUTSIDE_TENANT_SCOPE
```

Jangan tampilkan reason detail ke user jika bisa membocorkan existence.

---

## 11. Multi-Tenant Cache Key Design

### 11.1 Cache Leakage

Cache bisa membocorkan data jika key tidak menyertakan boundary.

Anti-pattern:

```java
@Cacheable(cacheNames = "caseSummary", key = "#caseId")
public CaseSummaryDto getCaseSummary(String caseId) { ... }
```

Jika tenant A dan B punya case ID sama, atau case ID global tapi data view berbeda berdasarkan role, cache bisa salah.

Pattern:

```java
@Cacheable(
    cacheNames = "caseSummary",
    key = "#scope.tenantId.value() + ':' + #scope.cacheScopeHash() + ':' + #caseId.value()"
)
public CaseSummaryDto getCaseSummary(UserScope scope, CaseId caseId) { ... }
```

Tetapi hati-hati: authorized view bisa berbeda berdasarkan:

1. Tenant.
2. Agency scope.
3. Confidential clearance.
4. Field-level permission.
5. Locale/jurisdiction.
6. Redaction rule.
7. Delegation/break-glass session.

Cache key harus mencerminkan semua dimensi yang memengaruhi output.

---

### 11.2 Safer Cache Layers

| Cache Type | Aman? | Catatan |
|---|---:|---|
| Public reference data | Relatif aman | Jika tidak tenant-specific |
| Tenant-level config | Aman jika key tenant-aware | `tenantId` wajib masuk key |
| Raw entity cache | Berisiko | Jangan expose langsung ke user view |
| Authorized DTO cache | Berisiko tinggi | Key harus include scope/permission version |
| Decision cache | Berisiko | Harus include subject/resource/action/context/policy version |
| Search result cache | Sangat berisiko | Include criteria + scope + permission version |

Top 1% rule:

```text
If authorization affects the output, authorization scope must affect the cache key.
```

---

### 11.3 Permission Version in Cache

Jika user permission berubah, cache harus invalid.

Satu pattern:

```java
public final class UserScope {
    private final UserId userId;
    private final TenantId tenantId;
    private final Set<AgencyId> agencyIds;
    private final long entitlementVersion;

    public String cacheScopeHash() {
        return Hashing.sha256(
                tenantId.value() + "|" + agencyIds + "|" + entitlementVersion
        );
    }
}
```

Jika role assignment berubah:

```text
entitlement_version++
```

Cache lama otomatis tidak match.

---

## 12. Search, Reporting, and Export Boundary

### 12.1 Search Is Authorization

Search sering lebih berbahaya daripada detail endpoint.

Contoh:

```http
GET /cases?keyword=John
```

Jika search tidak scoped:

```sql
SELECT * FROM cases WHERE applicant_name LIKE '%John%'
```

Maka user bisa menemukan existence data tenant lain.

Correct:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND agency_id IN (:agency_scope)
  AND applicant_name LIKE :keyword
```

Search index seperti Elasticsearch/OpenSearch juga harus diberi filter boundary.

Query ke index harus include:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenantId": "T1" } },
      { "terms": { "agencyId": ["A1", "A2"] } }
    ],
    "must": [
      { "match": { "applicantName": "John" } }
    ]
  }
}
```

---

### 12.2 Count Leakage

Bahkan count bisa bocor.

```text
Search result: 0 records
```

vs

```text
Search result: 1 record but you cannot view it
```

Jika UI/API membedakan ini, user bisa infer existence.

Untuk unauthorized resource, jangan berikan:

```text
There is a case with this ID, but you cannot access it.
```

Kecuali domain memang mengizinkan existence disclosure.

---

### 12.3 Export Is Not Just Larger Search

Export sering melewati path berbeda:

```text
UI search: scoped
CSV export: raw SQL
PDF report: stored procedure
Scheduled report: service account
```

Ini pola kebocoran klasik.

Rule:

```text
Every export must use the same or stricter authorization scope as interactive search.
```

Better design:

```java
public ExportJob createCaseExport(UserContext user, CaseSearchCriteria criteria) {
    UserScope scope = scopeResolver.resolveCaseVisibilityScope(user);
    CaseExportRequest request = new CaseExportRequest(user.userId(), scope.snapshot(), criteria);
    return exportJobRepository.create(request);
}
```

Saat worker menjalankan export, jangan resolve ulang hanya berdasarkan service account.

```java
public void runExportJob(ExportJob job) {
    UserScope originalScope = job.requestedScopeSnapshot();
    CaseSearchCriteria criteria = job.criteria();
    Stream<CaseEntity> rows = caseRepository.streamVisibleCases(originalScope, criteria);
    exportWriter.write(rows);
}
```

Jika policy menuntut permission terbaru, lakukan revalidation dengan explicit rule:

```text
export uses original scope snapshot + checks user still active + entitlement version still valid
```

---

## 13. File/Document Boundary

File download sering menjadi bypass.

Entity `Case` mungkin scoped, tetapi document endpoint menggunakan document ID saja:

```http
GET /documents/{documentId}/download
```

Anti-pattern:

```java
Document doc = documentRepository.findById(documentId).orElseThrow();
return storage.download(doc.storageKey());
```

Correct:

```java
Document doc = documentRepository.findDownloadableById(userScope, documentId)
        .orElseThrow(ResourceNotFoundException::new);
return storage.download(doc.storageKey());
```

SQL:

```sql
SELECT d.*
FROM documents d
JOIN cases c ON c.id = d.case_id
WHERE d.id = :document_id
  AND c.tenant_id = :tenant_id
  AND c.agency_id IN (:agency_scope)
```

Jika file disimpan di object storage, storage key jangan mudah ditebak:

```text
s3://bucket/tenant-a/cases/123/report.pdf
```

Lebih aman:

```text
s3://bucket/documents/7f/9d/7f9d...encrypted-or-random-key
```

Tetapi random key juga bukan authorization. Server tetap harus authorize sebelum membuat signed URL.

Signed URL harus:

1. Short-lived.
2. Terkait object yang sudah diauthorize.
3. Tidak reusable lama.
4. Diaudit.
5. Tidak dibuat dari client-supplied storage key.

---

## 14. Batch, Async Job, and Event Boundary

### 14.1 Async Job Bisa Menghilangkan User Context

Contoh:

```java
@PostMapping("/cases/export")
public ExportJobDto exportCases(@RequestBody CaseSearchCriteria criteria) {
    return exportService.submit(criteria);
}
```

Worker kemudian:

```java
public void run(Job job) {
    List<CaseEntity> cases = caseRepository.search(job.criteria());
    writeCsv(cases);
}
```

Masalah:

```text
Original user's authorization context hilang.
```

Correct:

```java
public ExportJob submit(UserContext user, CaseSearchCriteria criteria) {
    UserScope scope = scopeResolver.resolveCaseVisibilityScope(user);
    return jobRepository.create(new ExportJob(
            user.userId(),
            scope.snapshot(),
            criteria,
            Instant.now()
    ));
}
```

Worker:

```java
public void run(ExportJob job) {
    authorizationService.verifyJobStillAllowed(job);
    Stream<CaseEntity> rows = caseRepository.streamVisibleCases(job.scopeSnapshot(), job.criteria());
    exportWriter.write(rows);
}
```

---

### 14.2 Event Consumer Boundary

Message-driven systems sering memakai service account.

```text
case-service publishes CaseSubmitted event
notification-service consumes event
reporting-service consumes event
```

Pertanyaannya:

1. Event ini boleh dikonsumsi service mana?
2. Payload berisi data tenant mana?
3. Apakah tenant ID ada dalam event envelope?
4. Apakah consumer memfilter tenant?
5. Apakah DLQ mencampur data tenant?
6. Apakah logs mencetak payload cross-tenant?

Event envelope minimal:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseSubmitted",
  "tenantId": "T1",
  "agencyId": "A1",
  "resourceType": "CASE",
  "resourceId": "CASE-123",
  "occurredAt": "2026-06-19T10:15:30Z",
  "dataClassification": "CONFIDENTIAL"
}
```

Consumer harus memvalidasi boundary:

```java
public void handle(CaseSubmittedEvent event) {
    if (!consumerPolicy.canConsume(event.tenantId(), event.dataClassification())) {
        audit.denyConsumerAccess(event);
        return;
    }
    process(event);
}
```

---

## 15. Admin, Support, and Operator Access

### 15.1 Admin Bukan Tuhan

Anti-pattern:

```java
if (user.hasRole("ADMIN")) {
    return true;
}
```

Pertanyaan yang harus dijawab:

1. Admin jenis apa?
2. Admin untuk tenant mana?
3. Admin teknis atau bisnis?
4. Boleh lihat isi data atau hanya metadata?
5. Boleh mutate data atau hanya configure system?
6. Ada approval/break-glass session?
7. Diaudit dengan reason?

Model lebih baik:

```text
SYSTEM_CONFIG_ADMIN
TENANT_ADMIN
AGENCY_ADMIN
SECURITY_ADMIN
SUPPORT_OPERATOR
DATA_STEWARD
BREAK_GLASS_OPERATOR
```

Masing-masing punya scope dan obligation.

---

### 15.2 Support Access Pattern

Support access sebaiknya explicit:

```text
support_session_id
requested_by
approved_by
tenant_scope
resource_scope
reason
valid_from
valid_until
allowed_actions
```

Java model:

```java
public final class SupportAccessSession {
    private final String sessionId;
    private final UserId supportUserId;
    private final TenantId tenantId;
    private final Set<Action> allowedActions;
    private final String reason;
    private final Instant validFrom;
    private final Instant validUntil;

    public boolean isActiveAt(Instant now) {
        return !now.isBefore(validFrom) && now.isBefore(validUntil);
    }

    public boolean allows(Action action, TenantId tenant) {
        return tenantId.equals(tenant) && allowedActions.contains(action);
    }
}
```

Policy:

```java
if (user.isSupportOperator()) {
    Optional<SupportAccessSession> session = supportAccess.findActiveSession(user.userId(), tenantId);
    if (session.isEmpty()) {
        return deny("SUPPORT_ACCESS_REQUIRES_ACTIVE_SESSION");
    }
    if (!session.get().allows(action, tenantId)) {
        return deny("SUPPORT_SESSION_DOES_NOT_ALLOW_ACTION");
    }
    return allowWithObligation("SUPPORT_ACCESS_ALLOWED", Obligation.auditReason(session.get().reason()));
}
```

---

## 16. Database-Level Defense

### 16.1 Application-Level Scoping Is Necessary But Not Always Sufficient

Most Java applications enforce authorization in application layer. Itu tetap penting, karena domain policy sering terlalu kaya untuk sepenuhnya dipindahkan ke DB.

Namun untuk boundary seperti tenant, database-level guard bisa menjadi defense-in-depth.

PostgreSQL Row Level Security memungkinkan policy row-level untuk command tertentu seperti `SELECT`, `INSERT`, `UPDATE`, dan `DELETE`, dan policy bisa dikaitkan dengan role database. Dalam PostgreSQL, row security policy harus diaktifkan pada table dan policy mendefinisikan rule akses row.

Contoh konsep RLS:

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON cases
USING (tenant_id = current_setting('app.current_tenant_id'));
```

Saat koneksi dipakai:

```sql
SET app.current_tenant_id = 'T1';
```

Lalu query:

```sql
SELECT * FROM cases;
```

Secara logis hanya mengembalikan row tenant T1.

---

### 16.2 Caveat Database-Level Security

RLS/DB policy bukan silver bullet.

Risiko:

1. Connection pool harus set/reset context dengan benar.
2. Superuser/table owner bisa bypass dalam kondisi tertentu tergantung DB/config.
3. Policy kompleks bisa sulit debug.
4. Cross-tenant admin/reporting butuh policy khusus.
5. Application masih harus enforce action-level permission.
6. JPA/Hibernate behavior perlu diuji.
7. Bulk job/migration harus punya mode eksplisit dan diaudit.
8. Multi-DB portability menurun.

Pattern jika memakai connection pool:

```java
try (Connection connection = dataSource.getConnection()) {
    setTenant(connection, tenantId);
    // execute scoped queries
} finally {
    // ensure connection state reset before returning to pool
}
```

Dalam framework, lebih baik gunakan transaction interceptor atau connection customizer yang reliable.

---

## 17. Boundary in JPA/Hibernate

### 17.1 Hibernate Filter Pattern

Hibernate punya filter mechanism, tetapi harus hati-hati.

Conceptual example:

```java
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = String.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@Entity
@Table(name = "cases")
public class CaseEntity {
    // ...
}
```

Enable filter per session:

```java
Session session = entityManager.unwrap(Session.class);
session.enableFilter("tenantFilter")
       .setParameter("tenantId", tenantContext.tenantId().value());
```

Caveats:

1. Filter harus selalu enabled.
2. Native query bisa bypass.
3. Some association loading perlu diuji.
4. Admin cross-tenant query perlu explicit mode.
5. Test harus membuktikan filter aktif.

Top-level approach:

```text
Hibernate filter may help, but repository method scoping and policy tests remain mandatory.
```

---

### 17.2 `@Where` Is Not Dynamic Authorization

Anti-pattern:

```java
@Where(clause = "deleted = false")
```

`@Where` cocok untuk static filter seperti soft delete, bukan dynamic tenant authorization yang bergantung pada current user.

Tenant boundary membutuhkan dynamic parameter.

---

## 18. Boundary in MyBatis / SQL Mapper

MyBatis raw SQL kuat, tetapi rawan jika developer lupa predicate.

Anti-pattern:

```xml
<select id="findCaseById" resultType="CaseEntity">
    SELECT * FROM cases WHERE id = #{id}
</select>
```

Better:

```xml
<select id="findReadableCaseById" resultType="CaseEntity">
    SELECT *
    FROM cases
    WHERE id = #{caseId}
      AND tenant_id = #{scope.tenantId}
      AND agency_id IN
      <foreach item="agencyId" collection="scope.agencyIds" open="(" separator="," close=")">
          #{agencyId}
      </foreach>
</select>
```

Untuk mengurangi lupa predicate:

1. Standardize SQL fragments.
2. Code review checklist.
3. Static analysis grep for unsafe mapper methods.
4. Integration tests cross-tenant.
5. Restrict raw mapper visibility.

SQL fragment:

```xml
<sql id="CaseVisibilityPredicate">
    tenant_id = #{scope.tenantId}
    AND agency_id IN
    <foreach item="agencyId" collection="scope.agencyIds" open="(" separator="," close=")">
        #{agencyId}
    </foreach>
</sql>
```

Usage:

```xml
<select id="searchReadableCases" resultType="CaseEntity">
    SELECT *
    FROM cases
    WHERE <include refid="CaseVisibilityPredicate" />
      <if test="criteria.status != null">
        AND status = #{criteria.status}
      </if>
</select>
```

---

## 19. Boundary and DTO / Field-Level Exposure

Resource-level authorization menjawab:

```text
Boleh lihat case ini?
```

Tetapi field-level authorization menjawab:

```text
Boleh lihat field tertentu dari case ini?
```

Contoh:

```json
{
  "caseId": "CASE-123",
  "applicantName": "John Doe",
  "riskScore": 87,
  "internalNotes": "Potential violation...",
  "investigationStrategy": "...",
  "assignedOfficerMobile": "..."
}
```

User mungkin boleh lihat case summary, tetapi tidak boleh lihat:

1. Risk score.
2. Internal notes.
3. Investigation strategy.
4. Personal sensitive data.
5. Other officer contact.
6. Legal privileged content.

OWASP API Security 2023 juga membedakan Broken Object Level Authorization dari Broken Object Property Level Authorization: property tertentu dalam object bisa sensitif meskipun object-nya bisa diakses.

Pattern:

```java
public CaseDetailDto toAuthorizedDetail(UserContext user, CaseEntity entity) {
    CaseDetailDto dto = new CaseDetailDto();
    dto.setCaseId(entity.getCaseId());
    dto.setStatus(entity.getStatus());
    dto.setApplicantName(redactionPolicy.applicantName(user, entity));

    if (authorization.can(user, Action.VIEW_INTERNAL_NOTES, entity).isAllowed()) {
        dto.setInternalNotes(entity.getInternalNotes());
    }

    if (authorization.can(user, Action.VIEW_RISK_SCORE, entity).isAllowed()) {
        dto.setRiskScore(entity.getRiskScore());
    }

    return dto;
}
```

Better for large systems:

```text
separate DTO per authorized view
```

Example:

```text
CasePublicSummaryDto
CaseOfficerSummaryDto
CaseSupervisorDetailDto
CaseInvestigationDetailDto
```

Avoid one giant DTO with many conditional fields unless there is strong discipline.

---

## 20. Boundary and Logs/Audit

### 20.1 Logs Can Leak Boundary

Even if API response is safe, logs may leak:

```text
User X denied access to case CASE-123 applicant John Doe from tenant B
```

This leaks that case exists and applicant name.

Safer external response:

```text
CASE_NOT_FOUND
```

Internal audit:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "subjectId": "user-1",
  "action": "case.read",
  "resourceType": "CASE",
  "resourceIdHash": "...",
  "tenantId": "T1",
  "decision": "DENY",
  "reasonCode": "OUTSIDE_TENANT_SCOPE",
  "policyVersion": "case-policy-v12",
  "correlationId": "..."
}
```

Avoid logging sensitive resource details on denial unless protected audit store permits it.

---

### 20.2 Audit Boundary Decision

Untuk regulatory defensibility, audit harus bisa menjawab:

1. Siapa mencoba akses?
2. Aksi apa?
3. Resource apa?
4. Boundary resource apa?
5. Boundary subject apa?
6. Decision apa?
7. Policy version apa?
8. Attribute source apa?
9. Reason code apa?
10. Apakah ada delegation/support session?
11. Apakah ada override?

Authorization audit event:

```java
public final class AuthorizationAuditEvent {
    private final String eventId;
    private final UserId subjectId;
    private final Action action;
    private final String resourceType;
    private final String resourceIdHash;
    private final TenantId subjectTenant;
    private final Optional<TenantId> resourceTenant;
    private final String decision;
    private final String reasonCode;
    private final String policyVersion;
    private final Instant decisionTime;
    private final String correlationId;
}
```

---

## 21. Boundary Decision Matrix

Contoh sederhana untuk case management:

| Subject | Resource Boundary | Action | Condition | Decision |
|---|---|---|---|---|
| Applicant | Own application | Read | Status not hidden | Allow |
| Applicant | Other applicant application | Read | Any | Deny/404 |
| Officer | Same agency case | Read | Has `case.read.agency` | Allow |
| Officer | Other agency case | Read | No joint assignment | Deny/404 |
| Officer | Assigned case | Update | Status in editable states | Allow |
| Officer | Assigned case | Approve | Created by same officer | Deny |
| Supervisor | Department case | Reassign | Has supervisor role scoped to dept | Allow |
| Support | Tenant case | Read | Active approved support session | Allow + audit obligation |
| System job | Tenant case | Export | Job has captured user scope | Allow within captured scope |

This table should be connected to tests.

---

## 22. Java Implementation Blueprint

### 22.1 Core Types

Java 8-compatible:

```java
public final class TenantId {
    private final String value;

    private TenantId(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("tenantId must not be blank");
        }
        this.value = value;
    }

    public static TenantId of(String value) {
        return new TenantId(value);
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TenantId)) return false;
        TenantId tenantId = (TenantId) o;
        return value.equals(tenantId.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return value;
    }
}
```

User scope:

```java
public final class UserScope {
    private final UserId userId;
    private final TenantId tenantId;
    private final Set<AgencyId> agencyIds;
    private final Set<String> caseTypes;
    private final boolean canViewConfidential;
    private final long entitlementVersion;

    public UserScope(
            UserId userId,
            TenantId tenantId,
            Set<AgencyId> agencyIds,
            Set<String> caseTypes,
            boolean canViewConfidential,
            long entitlementVersion
    ) {
        this.userId = Objects.requireNonNull(userId, "userId");
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId");
        this.agencyIds = Collections.unmodifiableSet(new LinkedHashSet<>(agencyIds));
        this.caseTypes = Collections.unmodifiableSet(new LinkedHashSet<>(caseTypes));
        this.canViewConfidential = canViewConfidential;
        this.entitlementVersion = entitlementVersion;
    }

    public UserId userId() { return userId; }
    public TenantId tenantId() { return tenantId; }
    public Set<AgencyId> agencyIds() { return agencyIds; }
    public Set<String> caseTypes() { return caseTypes; }
    public boolean canViewConfidential() { return canViewConfidential; }
    public long entitlementVersion() { return entitlementVersion; }
}
```

---

### 22.2 Boundary Resolver

```java
public interface UserScopeResolver {
    UserScope resolveCaseVisibilityScope(UserContext user);
}
```

Implementation:

```java
public final class DefaultUserScopeResolver implements UserScopeResolver {

    private final RoleAssignmentRepository roleAssignments;
    private final OrganizationRepository organizationRepository;

    public DefaultUserScopeResolver(
            RoleAssignmentRepository roleAssignments,
            OrganizationRepository organizationRepository
    ) {
        this.roleAssignments = roleAssignments;
        this.organizationRepository = organizationRepository;
    }

    @Override
    public UserScope resolveCaseVisibilityScope(UserContext user) {
        TenantId tenantId = user.tenantId();

        List<RoleAssignment> assignments = roleAssignments.findActiveAssignments(user.userId(), tenantId);

        Set<AgencyId> agencyScope = new LinkedHashSet<>();
        Set<String> caseTypeScope = new LinkedHashSet<>();
        boolean confidential = false;
        long version = 0;

        for (RoleAssignment assignment : assignments) {
            version = Math.max(version, assignment.version());

            if (assignment.grants("case.read.agency")) {
                agencyScope.addAll(resolveAgencies(assignment));
            }
            if (assignment.grants("case.read.case-type")) {
                caseTypeScope.addAll(assignment.caseTypes());
            }
            if (assignment.grants("case.read.confidential")) {
                confidential = true;
            }
        }

        return new UserScope(user.userId(), tenantId, agencyScope, caseTypeScope, confidential, version);
    }

    private Set<AgencyId> resolveAgencies(RoleAssignment assignment) {
        if (assignment.appliesToAllAgencies()) {
            return organizationRepository.findAgenciesUnderTenant(assignment.tenantId());
        }
        return assignment.agencyIds();
    }
}
```

---

### 22.3 Policy Service

```java
public final class BoundaryPolicy {

    public AuthorizationDecision canReadCase(UserScope scope, CaseEntity entity) {
        if (!scope.tenantId().value().equals(entity.getTenantId())) {
            return AuthorizationDecision.deny("OUTSIDE_TENANT_SCOPE");
        }

        if (!containsAgency(scope, entity.getAgencyId())) {
            return AuthorizationDecision.deny("OUTSIDE_AGENCY_SCOPE");
        }

        if (!scope.caseTypes().isEmpty() && !scope.caseTypes().contains(entity.getCaseType())) {
            return AuthorizationDecision.deny("OUTSIDE_CASE_TYPE_SCOPE");
        }

        if (entity.isConfidential() && !scope.canViewConfidential()) {
            return AuthorizationDecision.deny("CONFIDENTIAL_CASE_REQUIRES_CLEARANCE");
        }

        return AuthorizationDecision.allow("CASE_WITHIN_USER_BOUNDARY");
    }

    private boolean containsAgency(UserScope scope, String agencyId) {
        for (AgencyId id : scope.agencyIds()) {
            if (id.value().equals(agencyId)) {
                return true;
            }
        }
        return false;
    }
}
```

---

### 22.4 Repository First, Policy Second

For detail endpoint:

```java
public CaseDetailDto getCase(UserContext user, CaseId caseId) {
    UserScope scope = scopeResolver.resolveCaseVisibilityScope(user);

    CaseEntity entity = caseRepository.findCandidateByIdWithinTenant(scope.tenantId(), caseId)
            .orElseThrow(ResourceNotFoundException::new);

    AuthorizationDecision decision = boundaryPolicy.canReadCase(scope, entity);
    if (!decision.isAllowed()) {
        auditDenied(user, Action.READ_CASE, caseId, decision);
        throw new ResourceNotFoundException("CASE_NOT_FOUND");
    }

    auditAllowed(user, Action.READ_CASE, caseId, decision);
    return caseMapper.toAuthorizedDetail(user, entity);
}
```

Even better for many systems:

```java
public CaseDetailDto getCase(UserContext user, CaseId caseId) {
    UserScope scope = scopeResolver.resolveCaseVisibilityScope(user);

    CaseEntity entity = caseRepository.findReadableById(scope, caseId)
            .orElseThrow(ResourceNotFoundException::new);

    return caseMapper.toAuthorizedDetail(user, entity);
}
```

The first version gives richer denial reason. The second version reduces leakage and DB fetch risk. Mature systems often use both patterns depending on resource sensitivity.

---

## 23. Spring Security Integration

Spring Security's `AuthorizationManager` is responsible for final access control decisions in request, method, and message authorization. That model is useful, but boundary enforcement often needs resource data that is only available after parsing path/body and sometimes after repository lookup.

### 23.1 Request-Level Check

```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("case.read")
    .requestMatchers(HttpMethod.POST, "/api/cases/*/approve").hasAuthority("case.approve")
    .anyRequest().authenticated()
);
```

This is necessary but insufficient.

It checks function-level permission.

Still need object/boundary check:

```java
CaseEntity entity = caseRepository.findReadableById(scope, caseId)
        .orElseThrow(ResourceNotFoundException::new);
```

---

### 23.2 Method Security

```java
@PreAuthorize("hasAuthority('case.read')")
public CaseDetailDto getCase(CaseId caseId) {
    // still need boundary check inside
}
```

Better:

```java
@PreAuthorize("hasAuthority('case.read')")
public CaseDetailDto getCase(UserContext user, CaseId caseId) {
    return caseApplicationService.getCase(user, caseId);
}
```

Avoid too much SpEL for boundary-heavy logic:

```java
@PreAuthorize("@caseAuth.canRead(authentication, #caseId)")
```

This can work, but if it hides DB calls and complex policy in annotations, it becomes hard to test, profile, and audit. Prefer explicit policy service for complex boundary decisions.

---

## 24. Boundary Testing Strategy

### 24.1 Cross-Tenant Test Matrix

Minimal tests:

```text
User T1 reads case T1 -> allowed
User T1 reads case T2 -> not found/denied
User T1 searches cases -> only T1 cases
User T1 exports cases -> only T1 cases
User T1 downloads doc from T1 -> allowed
User T1 downloads doc from T2 -> not found/denied
User T1 sees count -> count excludes T2
User T1 async export -> excludes T2
User T1 cache then User T2 same ID -> no leakage
```

---

### 24.2 Example JUnit Test

```java
@Test
void userCannotReadCaseFromAnotherTenant() {
    UserContext user = fixtures.user("user-1", "tenant-a");
    CaseEntity caseB = fixtures.caseEntity("case-123", "tenant-b", "agency-b");
    caseRepository.save(caseB);

    assertThrows(ResourceNotFoundException.class, () -> {
        caseService.getCase(user, CaseId.of("case-123"));
    });
}
```

Search test:

```java
@Test
void searchReturnsOnlyCasesWithinUserBoundary() {
    UserContext user = fixtures.userWithAgencyScope("user-1", "tenant-a", "agency-a");

    fixtures.caseEntity("case-a", "tenant-a", "agency-a", "John");
    fixtures.caseEntity("case-b", "tenant-a", "agency-b", "John");
    fixtures.caseEntity("case-c", "tenant-b", "agency-x", "John");

    Page<CaseSummaryDto> result = caseService.search(user, new CaseSearchCriteria("John"), PageRequest.of(0, 20));

    assertThat(result.getContent())
            .extracting(CaseSummaryDto::caseId)
            .containsExactly("case-a");
}
```

Cache test:

```java
@Test
void cacheKeyIncludesTenantBoundary() {
    UserContext tenantAUser = fixtures.user("user-a", "tenant-a");
    UserContext tenantBUser = fixtures.user("user-b", "tenant-b");

    fixtures.caseEntity("case-123", "tenant-a", "agency-a", "A data");
    fixtures.caseEntity("case-123", "tenant-b", "agency-b", "B data");

    CaseDetailDto a = caseService.getCase(tenantAUser, CaseId.of("case-123"));
    CaseDetailDto b = caseService.getCase(tenantBUser, CaseId.of("case-123"));

    assertThat(a.description()).isEqualTo("A data");
    assertThat(b.description()).isEqualTo("B data");
}
```

---

## 25. Common Anti-Patterns

### Anti-Pattern 1 — Tenant ID from Client

```java
repository.findByTenantIdAndId(request.tenantId(), request.id());
```

Fix:

```java
repository.findByTenantIdAndId(userContext.tenantId(), request.id());
```

---

### Anti-Pattern 2 — Function Permission Without Object Boundary

```java
hasAuthority("case.read")
```

But no check that case belongs to user's boundary.

Fix:

```text
function-level permission + object-level boundary predicate
```

---

### Anti-Pattern 3 — Filtering After Fetch

```java
repository.findAll().stream().filter(scope::canSee)
```

Fix:

```text
Push boundary predicate into SQL/search query before pagination/count/export.
```

---

### Anti-Pattern 4 — Cache Key Missing Tenant

```java
key = caseId
```

Fix:

```java
key = tenantId + ':' + scopeHash + ':' + caseId
```

---

### Anti-Pattern 5 — Admin Bypass

```java
if (isAdmin) return true;
```

Fix:

```text
Admin access must still be scoped, purposeful, auditable, and often time-bound.
```

---

### Anti-Pattern 6 — Export Uses Different Query

UI search scoped, export raw.

Fix:

```text
Export must reuse same authorization scope and query predicate.
```

---

### Anti-Pattern 7 — Async Job Loses User Scope

Job created by user but executed as system account without captured scope.

Fix:

```text
Capture authorization scope snapshot at submission and revalidate at execution.
```

---

### Anti-Pattern 8 — Logs Leak Denied Resource

```text
Denied access to applicant John Doe case 123 from tenant B
```

Fix:

```text
Use safe external messages and protected structured audit.
```

---

## 26. Design Checklist

Use this checklist during architecture/design review.

### 26.1 Boundary Definition

- [ ] What is the top-level tenant boundary?
- [ ] Are there secondary boundaries: agency, department, team, jurisdiction, case type?
- [ ] Are boundaries modeled explicitly in resource tables?
- [ ] Are boundaries modeled explicitly in user scope/role assignment?
- [ ] Is ownership differentiated from assignment and tenant?
- [ ] Are cross-boundary exceptions explicitly modeled?

### 26.2 Enforcement

- [ ] Is boundary enforced at API/service level?
- [ ] Is boundary enforced in repository/query?
- [ ] Is boundary applied before pagination?
- [ ] Is boundary applied before count?
- [ ] Is boundary applied before export?
- [ ] Is boundary applied to file download?
- [ ] Is boundary applied to audit trail queries?
- [ ] Is boundary applied to search index queries?
- [ ] Is boundary applied to async jobs?
- [ ] Is boundary applied to message consumers?

### 26.3 Cache

- [ ] Do cache keys include tenant?
- [ ] Do cache keys include scope hash if output depends on scope?
- [ ] Is entitlement version included?
- [ ] Are decision caches invalidated on reassignment/role change?
- [ ] Are search result caches scope-aware?

### 26.4 Error Semantics

- [ ] Do we use 404 to hide resource existence when needed?
- [ ] Do we avoid detailed denial reason to untrusted client?
- [ ] Do internal audit logs retain enough troubleshooting detail?
- [ ] Are denial reason codes standardized?

### 26.5 Testing

- [ ] Cross-tenant detail endpoint tested?
- [ ] Cross-tenant search tested?
- [ ] Cross-tenant export tested?
- [ ] Cross-tenant file download tested?
- [ ] Count leakage tested?
- [ ] Cache leakage tested?
- [ ] Async job scope tested?
- [ ] Admin/support access tested?

---

## 27. Production Readiness Checklist

Before releasing a boundary-sensitive module:

1. No repository method exposes unrestricted `findById` to application service for tenant-bound resources.
2. All queries include tenant predicate or stronger boundary predicate.
3. Search and export share predicate builder.
4. File download authorizes via parent resource boundary.
5. DTO mapping performs field-level redaction where needed.
6. Cache keys include tenant/scope dimensions.
7. Async jobs capture user scope snapshot.
8. Support/admin access is scoped and audited.
9. Cross-boundary attempts are audited.
10. 403/404 behavior is intentionally designed.
11. Cross-tenant tests exist and fail when predicate is removed.
12. Authorization decisions include reason codes internally.
13. Logs do not leak sensitive denied-resource details.
14. Tenant context is cleared after request/thread execution.
15. Native SQL/report/stored procedure paths are reviewed.
16. Search index has tenant/scope filter.
17. Data migration/backfill jobs have explicit privileged mode.
18. Documentation states boundary invariant in plain language.

---

## 28. Top 1% Engineering Insights

### 28.1 Boundary Is a System Property

Junior implementation:

```text
Add hasRole check on controller.
```

Senior implementation:

```text
Add permission check in service.
```

Top 1% implementation:

```text
Define boundary invariant, enforce it across API/service/query/cache/export/search/async/audit,
and prove it with tests and observability.
```

---

### 28.2 “Can Access ID” Is Not Enough

The question is not:

```text
Can user access ID 123?
```

The question is:

```text
Can this subject perform this action on this resource instance,
inside this tenant/org/workflow/data-classification boundary,
through this channel, at this time, with this delegation/support context,
under this policy version?
```

---

### 28.3 Avoid Boolean Blindness

Bad:

```java
boolean allowed = auth.canRead(user, caseEntity);
```

Better:

```java
AuthorizationDecision decision = auth.canRead(user, caseEntity);
```

With:

```text
allowed/denied
reason code
policy version
obligations
evidence
```

This matters for audit, support, and incident investigation.

---

### 28.4 Authorization Must Precede Materialization When Possible

If you fetch everything and filter later, you have already moved unauthorized data through memory, logs, metrics, debugger, serialization risk, and cache risk.

Better:

```text
Push boundary predicate as close to data source as possible.
```

But do not move all business policy to DB blindly. Use layered enforcement:

```text
DB/query scoping for coarse boundary
service/domain policy for business decision
DTO redaction for property-level exposure
audit for evidence
```

---

### 28.5 Every Bypass Path Becomes the Real System

If UI search is secure but export is raw, your real authorization model is raw export.

If API is secure but support console bypasses tenant, your real authorization model includes support console bypass.

If synchronous path is secure but async job loses user scope, your real authorization model loses user scope.

Top-level design principle:

```text
Authorization strength is determined by the weakest path that can access the data.
```

---

## 29. Summary

Part 10 membangun mental model bahwa **resource ownership, tenancy, dan data boundary** adalah inti dari authorization enterprise.

Key takeaways:

1. Ownership adalah fakta domain, bukan otomatis authorization.
2. Tenant boundary harus menjadi invariant sistem.
3. Boundary harus ditegakkan di query, bukan hanya di controller.
4. Search, export, report, file download, async job, message consumer, dan cache adalah jalur authorization yang sering dilupakan.
5. Cache key harus mencerminkan tenant/scope/permission version jika output dipengaruhi authorization.
6. Admin/support access tetap harus scoped, purposeful, time-bound, dan audited.
7. `403` vs `404` harus dirancang untuk menghindari resource existence leakage.
8. Boundary harus diuji dengan cross-tenant/cross-agency test yang eksplisit.
9. Database-level guard seperti row-level security bisa menjadi defense-in-depth, tetapi bukan pengganti domain authorization.
10. Top 1% engineer melihat authorization sebagai property sistem end-to-end.

---

## 30. Referensi Resmi dan Otoritatif

1. OWASP API Security Top 10 2023 — API1: Broken Object Level Authorization.  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

2. OWASP API Security Top 10 2023 — API3: Broken Object Property Level Authorization.  
   https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/

3. OWASP Authorization Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

4. OWASP Access Control.  
   https://owasp.org/www-community/Access_Control

5. Spring Security Reference — Authorization Architecture.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

6. PostgreSQL Documentation — Row Security Policies.  
   https://www.postgresql.org/docs/current/ddl-rowsecurity.html

7. PostgreSQL Documentation — CREATE POLICY.  
   https://www.postgresql.org/docs/current/sql-createpolicy.html

---

## 31. Posisi Seri

Selesai:

```text
[x] Part 0  — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC: Attribute-Based Authorization
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC: Relationship-Based Authorization
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
```

Berikutnya:

```text
[ ] Part 11 — IDOR, BOLA, and Object-Level Authorization
```

Status: **seri belum selesai**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-009.md">⬅️ Part 9 — ACL and Domain Object Security</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-011.md">Part 11 — IDOR, BOLA, and Object-Level Authorization ➡️</a>
</div>
