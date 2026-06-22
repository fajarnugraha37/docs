# learn-java-authorization-modes-and-patterns-part-011

# Part 11 — IDOR, BOLA, and Object-Level Authorization

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8–25, enterprise/backend systems, Spring/Jakarta/API/microservice environments  
> Fokus: memahami dan mendesain pertahanan terhadap **Insecure Direct Object Reference**, **Broken Object Level Authorization**, dan bug object-level authorization lain secara sistematis.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 10, kita sudah membangun fondasi:

1. authorization sebagai sistem keputusan;
2. vocabulary dan invariant;
3. primitive Java platform;
4. PEP/PDP/PAP/PIP;
5. RBAC;
6. permission/capability modeling;
7. ABAC;
8. PBAC/policy-as-code;
9. ReBAC;
10. ACL;
11. ownership, tenancy, dan data boundary.

Part 11 masuk ke salah satu failure mode paling berbahaya dalam aplikasi API modern: **object-level authorization yang rusak**.

Ini adalah area tempat banyak sistem terlihat “sudah secure” karena sudah punya login, role, token, Spring Security, API gateway, dan validasi endpoint, tetapi tetap bocor karena aplikasi tidak membuktikan bahwa user yang sedang melakukan request memang boleh mengakses **object tertentu**.

Contoh sederhananya:

```http
GET /api/cases/1001
Authorization: Bearer token-of-user-A
```

Jika user A mengganti ID menjadi:

```http
GET /api/cases/1002
```

lalu sistem mengembalikan data case milik user B, maka sistem punya IDOR/BOLA.

Yang penting: masalahnya bukan angka `1002` mudah ditebak. Masalah intinya adalah **server menerima object identifier dari client lalu mengambil object tanpa object-level authorization check yang benar**.

---

## 1. Mental Model Utama

### 1.1 Endpoint authorization bukan object authorization

Endpoint authorization menjawab:

> “Apakah user ini boleh memanggil endpoint ini?”

Object-level authorization menjawab:

> “Apakah user ini boleh melakukan aksi ini terhadap object spesifik ini, dalam konteks sekarang?”

Contoh:

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases/{caseId}")
public CaseDetailResponse getCase(@PathVariable Long caseId) {
    return caseService.getCase(caseId);
}
```

Kode ini hanya membuktikan bahwa user punya permission umum `case.read`. Ia belum membuktikan bahwa user boleh membaca **case dengan ID tersebut**.

Pertanyaan yang belum dijawab:

1. apakah case itu milik tenant/agency/organization user?
2. apakah user assigned ke case tersebut?
3. apakah status case mengizinkan dibaca oleh user ini?
4. apakah user punya role yang scope-nya mencakup resource ini?
5. apakah data sedang dalam keadaan sealed/confidential/restricted?
6. apakah user sedang bertindak sebagai delegated officer yang valid?
7. apakah ada conflict of interest seperti maker-checker?

### 1.2 ID adalah pointer, bukan authorization proof

Object ID, UUID, slug, document number, external reference number, hashid, encrypted-looking ID, GraphQL global ID, S3 key, filename, dan message ID hanyalah **pointer**.

Pointer tidak membuktikan hak akses.

Kesalahan umum:

```java
Case c = caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);
return mapper.toDetail(c);
```

Kode ini punya implicit assumption:

> “Jika user tahu ID, maka user boleh melihat object.”

Itu asumsi yang salah.

### 1.3 Object-level authorization adalah predicate pada subject-action-resource-context

Formulanya:

```text
allowed = policy(subject, action, resource, context)
```

Untuk BOLA/IDOR, `resource` adalah object instance aktual, bukan hanya resource type.

Bukan:

```text
can user read CASE?
```

Tetapi:

```text
can user read CASE#1002 in tenant=T1, agency=A1, state=UNDER_REVIEW, confidentiality=HIGH, assignment=TEAM_X?
```

### 1.4 Object-level authorization harus terjadi sebelum data sensitif keluar dari trust boundary

Trust boundary di sini bukan hanya network boundary. Dalam aplikasi Java, boundary bisa berupa:

1. controller response;
2. DTO mapping;
3. export writer;
4. file stream;
5. search response;
6. Kafka event emission;
7. audit detail view;
8. report query;
9. cache insertion;
10. batch job output.

Jika data sensitif sudah dimuat, dimap, dicache, atau dipublish sebelum authorization yang benar, risiko leakage meningkat.

---

## 2. Definisi Presisi

### 2.1 IDOR — Insecure Direct Object Reference

IDOR terjadi ketika aplikasi mengekspos referensi langsung ke object internal dan tidak melakukan access control yang cukup terhadap object tersebut.

Contoh:

```http
GET /invoices/73821
```

Jika user mengganti `73821` menjadi invoice milik orang lain dan tetap mendapatkan data, itu IDOR.

IDOR biasanya diasosiasikan dengan manipulasi identifier:

1. path variable;
2. query parameter;
3. request body;
4. header;
5. cookie;
6. filename;
7. object key;
8. encoded/global ID.

Namun IDOR bukan hanya soal “ID sequential”. UUID pun tetap rentan jika object-level check tidak ada.

### 2.2 BOLA — Broken Object Level Authorization

BOLA adalah kategori API security yang lebih luas. Ia terjadi ketika API gagal memverifikasi apakah caller boleh mengakses atau memodifikasi object tertentu.

IDOR bisa dianggap salah satu bentuk BOLA. Tetapi BOLA juga mencakup kasus ketika identifier tidak tampak jelas sebagai ID, atau ketika authorization rusak pada action/state/resource relation.

Contoh BOLA:

```http
POST /cases/1002/approve
```

User punya permission `case.approve`, tetapi case `1002` bukan dalam scope user, atau user adalah pembuat case tersebut sehingga melanggar maker-checker.

### 2.3 Broken Function Level Authorization berbeda dari BOLA

Function-level authorization menjawab apakah user boleh memanggil fungsi tertentu.

Contoh broken function-level authorization:

```http
POST /admin/users/123/disable
```

Endpoint admin bisa dipanggil oleh non-admin.

BOLA menjawab apakah user boleh melakukan fungsi itu pada object tertentu.

Contoh:

```http
POST /cases/1002/approve
```

User memang reviewer, tetapi tidak boleh approve case `1002` karena di luar assignment/agency/tenant/state.

### 2.4 Broken Object Property Level Authorization berbeda lagi

Object property-level issue terjadi ketika user boleh melihat object, tetapi tidak boleh melihat semua field/property di dalamnya.

Contoh:

```json
{
  "caseId": "C-1002",
  "status": "OPEN",
  "applicantName": "Alice",
  "internalRiskScore": 92,
  "investigatorNotes": "...",
  "identityNumber": "..."
}
```

User mungkin boleh melihat case summary, tetapi tidak boleh melihat `internalRiskScore`, `investigatorNotes`, atau `identityNumber`.

Part ini fokus utama pada object-level authorization, tetapi field/property leakage akan disentuh karena sering muncul bersamaan.

---

## 3. Kenapa BOLA Sangat Sering Terjadi

### 3.1 Developer berpikir endpoint, attacker berpikir object graph

Developer biasanya melihat API sebagai daftar endpoint:

```text
GET /cases/{id}
POST /cases/{id}/assign
POST /cases/{id}/approve
GET /documents/{id}/download
GET /reports/{id}/export
```

Attacker melihatnya sebagai object graph:

```text
case -> documents -> correspondence -> comments -> audit trail -> parties -> payments -> exports
```

Jika satu node graph bisa diakses tanpa authorization, attacker bisa melakukan traversal.

### 3.2 Role check memberi rasa aman palsu

Kode seperti ini terlihat aman:

```java
@PreAuthorize("hasAuthority('document.download')")
@GetMapping("/documents/{id}/download")
public ResponseEntity<Resource> download(@PathVariable Long id) {
    return documentService.download(id);
}
```

Namun check ini hanya menjawab:

> “Apakah user secara umum boleh download document?”

Belum menjawab:

> “Apakah user boleh download document ini?”

### 3.3 Data access layer terlalu umum

Repository seperti ini rentan dipakai salah:

```java
Optional<CaseEntity> findById(Long id);
Optional<DocumentEntity> findById(Long id);
Optional<CommentEntity> findById(Long id);
```

Jika semua service bebas memanggil `findById`, object retrieval sering terjadi tanpa scoping.

Lebih aman:

```java
Optional<CaseEntity> findAccessibleById(
        Long caseId,
        TenantId tenantId,
        UserId userId,
        Set<AssignmentId> assignments);
```

atau minimal service-level policy guard setelah retrieval.

### 3.4 Search/list endpoint diberi filter, detail endpoint lupa filter

Sering terjadi:

```java
GET /cases
```

sudah scoped berdasarkan user.

Tetapi:

```java
GET /cases/{id}
```

tidak scoped.

Akibatnya user tidak melihat case di list, tetapi bisa akses langsung jika tahu ID.

### 3.5 Export/report/download sering bypass service authorization

Banyak aplikasi punya jalur khusus:

1. report engine;
2. export service;
3. document streaming service;
4. background job;
5. object storage pre-signed URL;
6. email attachment generator;
7. batch reconciliation.

Jalur ini sering tidak melewati authorization service yang sama dengan UI/API biasa.

### 3.6 Identifier dianggap cukup sulit ditebak

Mengganti sequential ID ke UUID memang mengurangi enumeration, tetapi tidak memperbaiki authorization.

Ini hanya mengubah risiko dari:

```text
mudah ditebak + tidak ada authorization
```

menjadi:

```text
tidak mudah ditebak + tetap tidak ada authorization
```

Jika ID bocor melalui log, link, email, referrer, browser history, search result, export, event, atau support ticket, sistem tetap rentan.

---

## 4. Taxonomy Object-Level Authorization Failure

### 4.1 Direct read BOLA

User membaca object milik pihak lain.

```http
GET /api/cases/2002
GET /api/invoices/992
GET /api/profiles/abc
```

Failure:

```java
return repository.findById(id).map(mapper::toDto);
```

Perbaikan:

```java
CaseEntity c = caseRepository.findById(id)
        .orElseThrow(NotFoundException::new);

authorizationService.verify(user, CaseActions.READ, c, context);

return mapper.toDto(c);
```

Atau query-scoped:

```java
CaseEntity c = caseRepository.findReadableCaseById(id, user.scope())
        .orElseThrow(NotFoundException::new);
```

### 4.2 Action-level object BOLA

User boleh melihat object, tetapi tidak boleh melakukan action tertentu pada object itu.

Contoh:

```http
POST /cases/1002/approve
POST /cases/1002/reopen
POST /cases/1002/assign
DELETE /documents/3009
```

Failure:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approve(Long caseId) {
    CaseEntity c = caseRepository.findById(caseId).orElseThrow();
    c.approve();
}
```

Masalah:

1. case mungkin bukan assigned ke reviewer;
2. reviewer mungkin maker;
3. case state mungkin tidak approvable;
4. case tenant mungkin berbeda;
5. action mungkin butuh second approval;
6. case mungkin locked/sealed.

Perbaikan:

```java
public void approve(Long caseId, CurrentUser user) {
    CaseEntity c = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.verify(user, CaseActions.APPROVE, c, AuthorizationContext.current());

    c.approveBy(user.userId());
}
```

### 4.3 Horizontal privilege BOLA

User dengan level privilege sama mengakses object user lain.

```text
Officer A reads Officer B's assigned case.
Customer A reads Customer B's invoice.
Agency A reads Agency B's application.
```

Biasanya ini bukan role problem. Keduanya punya role sama. Yang membedakan adalah relationship/scope/resource ownership.

### 4.4 Vertical privilege object failure

User dengan privilege lebih rendah melakukan action terhadap object yang seharusnya butuh privilege lebih tinggi.

Contoh:

```http
POST /cases/1002/escalate-to-legal
```

User punya akses ke case, tetapi tidak punya authority untuk escalation.

Di sini butuh kombinasi:

```text
function-level permission + object-level scope + state/context rule
```

### 4.5 Cross-tenant BOLA

User dari tenant/agency/org A mengakses object tenant/agency/org B.

Ini sering paling parah karena mengganggu boundary data utama.

Contoh:

```java
DocumentEntity doc = documentRepository.findById(documentId).orElseThrow();
```

Harusnya minimal:

```java
DocumentEntity doc = documentRepository.findByIdAndTenantId(documentId, currentTenantId)
        .orElseThrow(NotFoundException::new);
```

Tetapi tenant check saja kadang belum cukup jika ada assignment/role scope internal.

### 4.6 Parent-child mismatch BOLA

Endpoint membawa parent ID dan child ID, tetapi sistem hanya memvalidasi salah satunya.

Contoh:

```http
GET /cases/1001/documents/9009
```

Bug:

```java
DocumentEntity doc = documentRepository.findById(documentId).orElseThrow();
```

Server mengabaikan bahwa document harus milik case `1001`.

Perbaikan:

```java
DocumentEntity doc = documentRepository
        .findByIdAndCaseId(documentId, caseId)
        .orElseThrow(NotFoundException::new);
```

Lalu tetap authorize terhadap parent/resource context.

### 4.7 Indirect object BOLA

Object ID tidak langsung tampak sebagai primary key, tetapi tetap referensi object.

Contoh:

```http
GET /download?file=/exports/agency-a/report-2026.pdf
GET /callback?referenceNo=APP-2026-00091
GET /attachments?messageId=abc123
```

Sistem tetap harus resolve object dan check authorization.

### 4.8 Mass assignment combined with BOLA

User mengirim request body yang memuat object relation yang tidak boleh dia kontrol.

Contoh:

```json
{
  "caseId": 1002,
  "assigneeUserId": "officer-b",
  "agencyId": "agency-other"
}
```

Jika service menerima field ini mentah-mentah, user bisa memindahkan object ke scope yang menguntungkan.

### 4.9 Bulk operation BOLA

Endpoint menerima banyak ID.

```http
POST /cases/bulk-close
```

```json
{
  "caseIds": [1001, 1002, 1003]
}
```

Bug umum:

```java
List<CaseEntity> cases = caseRepository.findAllById(caseIds);
for (CaseEntity c : cases) {
    c.close();
}
```

Harus ada per-object decision atau query scoped yang memastikan semua ID authorized.

### 4.10 Export/report BOLA

User boleh melihat halaman list terfilter, tetapi export mengambil data dari query lebih luas.

Contoh:

```java
public InputStream exportCases(ExportRequest request) {
    List<CaseEntity> cases = reportRepository.query(request.filters());
    return csvWriter.write(cases);
}
```

Jika `request.filters()` tidak digabung dengan authorization predicate, export bisa bocor.

### 4.11 Search/index BOLA

Search engine sering menyimpan denormalized documents. Jika query search tidak menambahkan authorization filters, user bisa menemukan object yang tidak boleh dia lihat.

Bahaya tambahan:

1. autocomplete leakage;
2. count/facet leakage;
3. highlight snippet leakage;
4. aggregation leakage;
5. stale index leakage after permission revocation.

### 4.12 Cache BOLA

Cache key tidak memasukkan subject/scope/tenant.

Bug:

```java
cache.get("case:" + caseId)
```

Jika response berbeda tergantung user, key ini salah.

Lebih aman:

```java
cache.get("case-detail:v3:tenant:" + tenantId + ":userScopeHash:" + scopeHash + ":case:" + caseId)
```

Atau cache entity mentah internal, bukan authorized response, lalu tetap lakukan authorization sebelum return.

---

## 5. Attack Surface dalam Java Backend

### 5.1 Path variable

```java
@GetMapping("/cases/{caseId}")
public CaseDto get(@PathVariable long caseId) { ... }
```

Risiko: direct ID manipulation.

### 5.2 Query parameter

```java
@GetMapping("/documents")
public DocumentDto get(@RequestParam long documentId) { ... }
```

Risiko: query param dianggap filter biasa, padahal object reference.

### 5.3 Request body

```json
{
  "caseId": 123,
  "documentIds": [1, 2, 3]
}
```

Risiko: object IDs tersembunyi dalam nested DTO.

### 5.4 Header

```http
X-Tenant-Id: agency-a
X-Case-Id: 1002
```

Risiko: server percaya header dari client.

### 5.5 Cookie/session attribute

Jika cookie menyimpan selected organization/case/workspace, tetap harus divalidasi terhadap server-side entitlement.

### 5.6 File/object storage key

```http
GET /files?key=case/1002/document/3009.pdf
```

Risiko: storage key digunakan langsung tanpa authorization.

### 5.7 Pre-signed URL

Pre-signed URL adalah capability sementara. Jika dibuat tanpa authorization yang benar, ia menjadi data leak.

Hal yang harus dipikirkan:

1. siapa boleh generate URL;
2. object apa yang boleh diakses;
3. berapa lama URL valid;
4. apakah URL dapat dishare;
5. apakah download diaudit;
6. apakah revocation diperlukan;
7. apakah URL mengandung tenant/object path yang sensitif.

### 5.8 GraphQL global ID

GraphQL sering memakai encoded ID seperti Base64 `TypeName:id`.

Itu bukan security. Resolver tetap harus check authorization per object/field/action.

### 5.9 Event/message ID

Consumer internal bisa menerima event yang menunjuk object tertentu.

Jika event berasal dari user-triggered request, worker tidak boleh menganggap semua ID di event authorized tanpa evidence.

### 5.10 Background job

Batch job sering berjalan dengan service account. Pertanyaannya:

1. apakah job menjalankan action atas nama sistem atau user?
2. jika atas nama user, apakah authority user masih valid saat job berjalan?
3. jika atas nama sistem, apa policy dan audit reason-nya?
4. apakah job scope dibatasi tenant/resource?

---

## 6. Java/Spring Example: Naive vs Correct

### 6.1 Naive controller-level role check

```java
@RestController
@RequestMapping("/api/cases")
public class CaseController {

    private final CaseService caseService;

    public CaseController(CaseService caseService) {
        this.caseService = caseService;
    }

    @PreAuthorize("hasAuthority('case.read')")
    @GetMapping("/{caseId}")
    public CaseDetailResponse getCase(@PathVariable long caseId) {
        return caseService.getCase(caseId);
    }
}
```

Service:

```java
@Service
public class CaseService {

    private final CaseRepository caseRepository;
    private final CaseMapper mapper;

    public CaseService(CaseRepository caseRepository, CaseMapper mapper) {
        this.caseRepository = caseRepository;
        this.mapper = mapper;
    }

    public CaseDetailResponse getCase(long caseId) {
        CaseEntity entity = caseRepository.findById(caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));

        return mapper.toDetail(entity);
    }
}
```

Masalah:

1. `case.read` hanya permission umum;
2. service tidak tahu siapa caller;
3. repository tidak scoped;
4. mapper bisa mengekspos field sensitif;
5. tidak ada audit decision;
6. tidak ada invariant tenant/assignment/state.

### 6.2 Better: explicit authorization service

```java
@Service
public class CaseApplicationService {

    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final CaseMapper mapper;

    public CaseApplicationService(
            CaseRepository caseRepository,
            AuthorizationService authorizationService,
            CaseMapper mapper) {
        this.caseRepository = caseRepository;
        this.authorizationService = authorizationService;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public CaseDetailResponse getCase(CurrentUser user, long caseId) {
        CaseEntity entity = caseRepository.findById(caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));

        AuthorizationDecision decision = authorizationService.decide(
                user,
                CaseAction.READ_DETAIL,
                CaseResource.from(entity),
                AuthorizationContext.requestContext()
        );

        if (!decision.allowed()) {
            throw new AccessDeniedException(decision.safeMessage());
        }

        return mapper.toDetail(entity, FieldVisibility.fromDecision(decision));
    }
}
```

Keuntungan:

1. action spesifik;
2. resource instance spesifik;
3. context eksplisit;
4. decision bisa membawa reason/evidence;
5. mapper bisa field-aware;
6. audit bisa mencatat decision.

### 6.3 Better for read: query-scoped retrieval

Untuk read-heavy endpoint, sering lebih aman dan efisien melakukan scoping di query.

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {

    @Query("""
        select c
        from CaseEntity c
        where c.id = :caseId
          and c.tenantId = :tenantId
          and (
                c.assignedUserId = :userId
                or c.assignedTeamId in :teamIds
                or :canReadAllTenantCases = true
          )
        """)
    Optional<CaseEntity> findReadableById(
            @Param("caseId") long caseId,
            @Param("tenantId") String tenantId,
            @Param("userId") String userId,
            @Param("teamIds") Collection<String> teamIds,
            @Param("canReadAllTenantCases") boolean canReadAllTenantCases
    );
}
```

Service:

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCase(CurrentUser user, long caseId) {
    AccessScope scope = accessScopeResolver.resolveCaseReadScope(user);

    CaseEntity entity = caseRepository.findReadableById(
            caseId,
            user.tenantId(),
            user.userId(),
            scope.teamIds(),
            scope.canReadAllTenantCases()
    ).orElseThrow(() -> new NotFoundException("Case not found"));

    return mapper.toDetail(entity, scope.fieldVisibility());
}
```

Trade-off:

1. lebih efisien untuk read;
2. menghindari fetch object yang tidak authorized;
3. tetapi policy bisa tersebar di query jika tidak dikelola;
4. perlu shared predicate/specification agar konsisten.

### 6.4 Best practice: combine coarse route check + object scoping

Route check:

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/{caseId}")
public CaseDetailResponse getCase(@AuthenticationPrincipal CurrentUser user,
                                  @PathVariable long caseId) {
    return caseApplicationService.getCase(user, caseId);
}
```

Service/query object-level check:

```java
CaseEntity entity = caseRepository.findReadableById(caseId, scope)
        .orElseThrow(NotFoundException::new);
```

Why both?

1. route check blocks users with no generic capability;
2. object-level check enforces resource-specific access;
3. query scoping prevents accidental data load;
4. service remains responsible for business invariant.

---

## 7. The “Find By ID” Problem

### 7.1 `findById` is not evil, but unrestricted use is dangerous

`findById` is acceptable in internal code if authorization already happened or the object is not user-controlled. But in request-driven code, it is a frequent source of BOLA.

Danger signal:

```java
@PathVariable Long id
@RequestParam Long id
request.getSomethingId()
repository.findById(id)
```

Especially if there is no nearby authorization call.

### 7.2 Safer repository naming

Instead of generic repository usage everywhere:

```java
findById(id)
```

Prefer domain-specific intent:

```java
findCaseReadableBy(userScope, caseId)
findCaseAssignableBy(userScope, caseId)
findDocumentDownloadableBy(userScope, documentId)
findCommentEditableBy(userScope, commentId)
findAppealSubmittableBy(userScope, appealId)
```

This makes authorization visible in the method name.

### 7.3 Use separate internal and user-facing repositories carefully

Example:

```java
interface CaseInternalRepository {
    Optional<CaseEntity> findById(long id);
}

interface CaseAccessRepository {
    Optional<CaseEntity> findReadableById(AccessScope scope, long id);
    Optional<CaseEntity> findApprovableById(AccessScope scope, long id);
}
```

But do not over-engineer too early. The goal is not more classes; the goal is fewer unsafe code paths.

### 7.4 Static code review heuristic

Search for:

```text
findById(
getReferenceById(
getOne(
EntityManager.find(
select ... where id = :id
@PathVariable
@RequestParam
@RequestBody.*Id
```

Then ask:

1. is ID user-controlled?
2. is object sensitive?
3. is there an object-level check?
4. is tenant boundary enforced?
5. is parent-child relation enforced?
6. is action-specific policy enforced?
7. is field visibility controlled?

---

## 8. `403` vs `404` for BOLA

### 8.1 The dilemma

If user accesses unauthorized object:

```http
GET /cases/9999
```

Should server return:

```http
403 Forbidden
```

or:

```http
404 Not Found
```

### 8.2 Returning `403`

Pros:

1. accurate: object exists but access denied;
2. easier troubleshooting;
3. useful for internal apps;
4. easier audit and support.

Cons:

1. confirms object existence;
2. can aid enumeration;
3. may leak information about resource IDs.

### 8.3 Returning `404`

Pros:

1. hides existence;
2. reduces enumeration signal;
3. useful for external/public APIs.

Cons:

1. less clear to legitimate users;
2. can complicate support;
3. needs careful audit internally to distinguish true not found vs denied.

### 8.4 Practical rule

Use external response semantics based on resource sensitivity, but record internal audit accurately.

Example:

```java
if (!decision.allowed()) {
    audit.logDenied(user, action, resourceRef, decision.reasonCode());
    throw new NotFoundException("Case not found"); // external masking
}
```

But avoid lying in logs:

```text
external_response = 404
internal_decision = DENIED_OBJECT_SCOPE
```

### 8.5 Do not use `404` as replacement for authorization

Masking response is not defense. Authorization still must happen.

---

## 9. Parent-Child Authorization

Many enterprise resources are nested:

```text
Case
 ├── Document
 ├── Comment
 ├── Task
 ├── Correspondence
 ├── Payment
 ├── AuditTrail
 └── Decision
```

### 9.1 Common bug

```java
@GetMapping("/cases/{caseId}/documents/{documentId}")
public DocumentDto getDocument(@PathVariable long caseId,
                               @PathVariable long documentId) {
    DocumentEntity doc = documentRepository.findById(documentId)
            .orElseThrow(NotFoundException::new);
    return mapper.toDto(doc);
}
```

Bug: `caseId` is ignored.

### 9.2 Better

```java
DocumentEntity doc = documentRepository
        .findByIdAndCaseId(documentId, caseId)
        .orElseThrow(NotFoundException::new);
```

Then:

```java
authorizationService.verify(user, DocumentAction.READ, DocumentResource.from(doc), context);
```

### 9.3 Stronger invariant

The child object must satisfy all relevant boundaries:

```text
document.id = requested documentId
AND document.case_id = requested caseId
AND document.tenant_id = current tenant
AND document.case is readable by subject
AND document itself is not restricted beyond subject's clearance
```

### 9.4 Avoid trusting parent access blindly

Even if user can read the case, not all child documents may be visible.

Example:

1. public case summary document;
2. internal investigation note;
3. legal advice attachment;
4. sealed evidence document;
5. personal data attachment.

Parent access is often necessary but not sufficient.

---

## 10. Batch and Bulk Authorization

### 10.1 Bulk reads

Request:

```json
{
  "caseIds": [1001, 1002, 1003]
}
```

Wrong:

```java
List<CaseEntity> cases = caseRepository.findAllById(caseIds);
return cases.stream().map(mapper::toSummary).toList();
```

Better:

```java
List<CaseEntity> cases = caseRepository.findAllReadableByIds(scope, caseIds);

if (cases.size() != distinct(caseIds).size()) {
    audit.partialDenied(user, CaseAction.BULK_READ, caseIds);
}

return cases.stream().map(mapper::toSummary).toList();
```

Need decide semantics:

1. fail whole request if any unauthorized;
2. return only authorized objects;
3. return per-item status;
4. return masked entries.

### 10.2 Bulk writes

For mutation, default should be stricter.

Example:

```http
POST /cases/bulk-assign
```

Safer semantics:

1. validate all target objects;
2. authorize all target objects;
3. authorize target assignee/team;
4. check state transition validity;
5. apply transactionally or return per-item status with explicit semantics.

### 10.3 Per-object decision result

```java
public final class BulkAuthorizationResult<ID> {
    private final Set<ID> allowedIds;
    private final Map<ID, DenialReason> deniedIds;

    public boolean allAllowed(Collection<ID> requestedIds) {
        return deniedIds.isEmpty() && allowedIds.containsAll(requestedIds);
    }
}
```

### 10.4 Avoid partial silent success

Silent partial success can hide security issues and confuse users.

Bad response:

```json
{
  "updated": 7
}
```

Better:

```json
{
  "updated": 7,
  "denied": 2,
  "notFound": 1,
  "requestId": "..."
}
```

But for sensitive APIs, avoid exposing which IDs exist.

---

## 11. Search, List, Pagination, and Count Leakage

### 11.1 List endpoint must be scoped before pagination

Wrong:

```java
Page<CaseEntity> page = caseRepository.findAll(pageable);
List<CaseEntity> visible = page.getContent().stream()
        .filter(c -> authorizationService.canRead(user, c))
        .toList();
```

Problems:

1. page size becomes inconsistent;
2. total count leaks unauthorized data;
3. attacker can infer data distribution;
4. performance terrible;
5. pagination skips authorized rows.

Correct direction:

```java
Page<CaseEntity> page = caseRepository.searchReadableCases(scope, filters, pageable);
```

Authorization predicate must be part of the query.

### 11.2 Count leakage

If total count includes unauthorized rows, it leaks information.

Wrong:

```json
{
  "totalElements": 10000,
  "items": []
}
```

This may reveal that many cases exist even if user cannot see them.

### 11.3 Sorting leakage

Sorting by hidden fields can leak hidden values indirectly.

Example:

```http
GET /cases?sort=internalRiskScore,desc
```

Even if field not returned, order may leak relative risk.

### 11.4 Facet/aggregation leakage

Search facets can leak unauthorized data:

```json
{
  "facets": {
    "status": {
      "UNDER_INVESTIGATION": 12,
      "LEGAL_REVIEW": 3
    }
  }
}
```

Facet query must use same authorization predicate as search result query.

### 11.5 Autocomplete leakage

Autocomplete may expose names, case numbers, or organizations outside user scope.

```http
GET /autocomplete/applicants?q=ali
```

Must be scoped.

---

## 12. File Download and Document Authorization

File download endpoints are frequent BOLA sources.

### 12.1 Unsafe pattern

```java
@GetMapping("/files/{fileId}")
public ResponseEntity<Resource> download(@PathVariable long fileId) {
    FileRecord file = fileRepository.findById(fileId).orElseThrow();
    Resource resource = storage.load(file.storageKey());
    return ResponseEntity.ok(resource);
}
```

### 12.2 Safer pattern

```java
@GetMapping("/files/{fileId}")
public ResponseEntity<Resource> download(@AuthenticationPrincipal CurrentUser user,
                                         @PathVariable long fileId) {
    FileRecord file = fileRepository.findById(fileId)
            .orElseThrow(NotFoundException::new);

    authorizationService.verify(
            user,
            DocumentAction.DOWNLOAD,
            DocumentResource.from(file),
            AuthorizationContext.requestContext()
    );

    Resource resource = storage.load(file.storageKey());

    audit.logFileDownloadAllowed(user, file.id(), file.caseId());

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, contentDisposition(file.safeFilename()))
            .body(resource);
}
```

### 12.3 Storage key is not authorization

Do not let clients choose raw storage keys:

```http
GET /download?key=tenant-a/case-1002/internal.pdf
```

Prefer opaque server-side file ID that maps to metadata, then authorize metadata.

### 12.4 Pre-signed URL caution

If using object storage pre-signed URLs:

1. authorize before generating URL;
2. use short TTL;
3. avoid broad bucket/key permissions;
4. bind to exact object;
5. record audit at generation time;
6. consider whether actual download event is visible to application;
7. consider proxy download for highly sensitive files.

---

## 13. Object-Level Authorization in State Machines

For case/workflow systems, object authorization is strongly tied to state.

Example actions:

```text
view
edit
submit
withdraw
assign
review
approve
reject
return_for_clarification
escalate
reopen
close
archive
```

Each action depends on:

1. current state;
2. actor role;
3. assignment;
4. ownership;
5. tenant/agency;
6. maker-checker constraint;
7. lock/version;
8. deadline/SLA;
9. delegation;
10. confidentiality.

### 13.1 Wrong model

```java
if (user.hasAuthority("case.approve")) {
    caseEntity.approve();
}
```

### 13.2 Better model

```java
AuthorizationDecision decision = authorizationService.decide(
        user,
        CaseAction.APPROVE,
        CaseResource.from(caseEntity),
        AuthorizationContext.builder()
                .requestTime(clock.instant())
                .channel(Channel.INTRANET)
                .build()
);

if (!decision.allowed()) {
    throw new AccessDeniedException(decision.safeMessage());
}

caseEntity.approve(user.userId(), clock.instant());
```

### 13.3 State transition guard

```java
public final class CaseApprovePolicy implements AuthorizationPolicy<CaseResource> {

    @Override
    public AuthorizationDecision decide(CurrentUser user,
                                        CaseAction action,
                                        CaseResource resource,
                                        AuthorizationContext context) {
        if (action != CaseAction.APPROVE) {
            return AuthorizationDecision.notApplicable();
        }

        if (!user.hasPermission("case.approve")) {
            return AuthorizationDecision.deny("MISSING_PERMISSION");
        }

        if (!user.tenantId().equals(resource.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH");
        }

        if (!resource.status().equals(CaseStatus.PENDING_APPROVAL)) {
            return AuthorizationDecision.deny("INVALID_STATE");
        }

        if (resource.createdBy().equals(user.userId())) {
            return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION");
        }

        if (!resource.assignedReviewerIds().contains(user.userId())) {
            return AuthorizationDecision.deny("NOT_ASSIGNED_REVIEWER");
        }

        return AuthorizationDecision.allow("APPROVER_ASSIGNED_AND_STATE_VALID");
    }
}
```

This is not just security. This is business correctness.

---

## 14. DTO and Field-Level Leakage

Object-level authorization can be correct while DTO mapping still leaks fields.

### 14.1 Unsafe mapper

```java
public CaseDetailResponse toDetail(CaseEntity c) {
    return new CaseDetailResponse(
            c.getId(),
            c.getApplicantName(),
            c.getIdentityNumber(),
            c.getInternalRiskScore(),
            c.getInvestigationNotes(),
            c.getStatus()
    );
}
```

### 14.2 Field-aware mapper

```java
public CaseDetailResponse toDetail(CaseEntity c, FieldVisibility visibility) {
    return new CaseDetailResponse(
            c.getId(),
            c.getApplicantName(),
            visibility.canViewIdentityNumber() ? c.getIdentityNumber() : null,
            visibility.canViewRiskScore() ? c.getInternalRiskScore() : null,
            visibility.canViewInvestigationNotes() ? c.getInvestigationNotes() : null,
            c.getStatus()
    );
}
```

### 14.3 Avoid `@JsonIgnore` as policy

`@JsonIgnore` is static serialization behavior, not dynamic authorization policy.

It is useful for always-hidden fields, but insufficient for fields visible to some users and hidden from others.

### 14.4 Avoid entity serialization

Never return JPA entities directly from controllers.

Reasons:

1. lazy loading surprises;
2. accidental field exposure;
3. bidirectional relationship leakage;
4. hidden internal fields;
5. no field-level authorization;
6. unstable API contract.

---

## 15. Object-Level Authorization and Caching

### 15.1 Cache entity, not decision-sensitive DTO, when possible

Safer:

```java
CaseEntity entity = caseCache.get(caseId);
authorizationService.verify(user, CaseAction.READ, CaseResource.from(entity), context);
return mapper.toDetail(entity, visibility);
```

Risky:

```java
CaseDetailResponse response = cache.get("case-detail:" + caseId);
return response;
```

If `CaseDetailResponse` differs by user permission, the cache key must reflect authorization scope.

### 15.2 Decision cache key must include all relevant inputs

Decision key:

```text
subject-id
subject-role-version
permission-version
resource-id
resource-version
resource-tenant
resource-state
resource-confidentiality
context-channel
policy-version
```

If one relevant input is missing, cache may allow stale/incorrect access.

### 15.3 Revocation latency

If permission is revoked, how long can stale access persist?

Need define:

1. token TTL;
2. entitlement cache TTL;
3. decision cache TTL;
4. resource attribute cache TTL;
5. search index refresh latency;
6. object storage URL TTL.

Top-level engineers treat revocation latency as a security parameter, not just performance detail.

---

## 16. Testing IDOR/BOLA Systematically

### 16.1 Basic two-user test

For each sensitive endpoint:

1. create object owned/assigned to user A;
2. authenticate as user B with same role;
3. call endpoint using object A's ID;
4. expect deny/masked not found.

Example JUnit style:

```java
@Test
void officerCannotReadCaseAssignedToAnotherOfficer() throws Exception {
    UserFixture officerA = users.officer("agency-a");
    UserFixture officerB = users.officer("agency-a");

    CaseFixture caseA = cases.createAssignedTo(officerA);

    mockMvc.perform(get("/api/cases/{id}", caseA.id())
                    .with(jwtFor(officerB)))
            .andExpect(status().isNotFound());
}
```

### 16.2 Cross-tenant test

```java
@Test
void userCannotReadCaseFromAnotherTenant() throws Exception {
    UserFixture userA = users.officer("tenant-a");
    UserFixture userB = users.officer("tenant-b");

    CaseFixture tenantACase = cases.createInTenant("tenant-a");

    mockMvc.perform(get("/api/cases/{id}", tenantACase.id())
                    .with(jwtFor(userB)))
            .andExpect(status().isNotFound());
}
```

### 16.3 Same object, different action test

```java
@Test
void viewerCannotApproveReadableCase() throws Exception {
    UserFixture viewer = users.viewer("tenant-a");
    CaseFixture caseFixture = cases.pendingApproval("tenant-a");

    mockMvc.perform(post("/api/cases/{id}/approve", caseFixture.id())
                    .with(jwtFor(viewer)))
            .andExpect(status().isForbidden());
}
```

### 16.4 Maker-checker test

```java
@Test
void creatorCannotApproveOwnCase() throws Exception {
    UserFixture maker = users.officerWithPermission("case.approve");
    CaseFixture caseFixture = cases.createdBy(maker).pendingApproval();

    mockMvc.perform(post("/api/cases/{id}/approve", caseFixture.id())
                    .with(jwtFor(maker)))
            .andExpect(status().isForbidden());
}
```

### 16.5 Parent-child mismatch test

```java
@Test
void documentMustBelongToRequestedCase() throws Exception {
    UserFixture user = users.caseOfficer();
    CaseFixture caseA = cases.assignedTo(user);
    CaseFixture caseB = cases.assignedTo(user);
    DocumentFixture docB = documents.attachedTo(caseB);

    mockMvc.perform(get("/api/cases/{caseId}/documents/{documentId}",
                    caseA.id(), docB.id())
                    .with(jwtFor(user)))
            .andExpect(status().isNotFound());
}
```

### 16.6 Bulk test

```java
@Test
void bulkCloseFailsIfAnyCaseUnauthorized() throws Exception {
    UserFixture user = users.officerWithPermission("case.close");
    CaseFixture ownCase = cases.assignedTo(user);
    CaseFixture otherCase = cases.assignedTo(users.otherOfficer());

    mockMvc.perform(post("/api/cases/bulk-close")
                    .with(jwtFor(user))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        { "caseIds": [%d, %d] }
                        """.formatted(ownCase.id(), otherCase.id())))
            .andExpect(status().isForbidden());
}
```

### 16.7 Search/list test

Verify unauthorized object does not appear in:

1. list;
2. search result;
3. count;
4. facet;
5. export;
6. autocomplete.

### 16.8 Generated test matrix

Create matrix:

```text
subject role/scope x action x resource state x resource owner/tenant x expected decision
```

Then generate tests from matrix.

---

## 17. Code Review Checklist for IDOR/BOLA

For every endpoint that accepts any object reference:

1. Does the endpoint accept path/query/body/header object IDs?
2. Are IDs user-controlled?
3. Is endpoint-level permission checked?
4. Is object-level permission checked?
5. Is tenant/org/agency boundary enforced?
6. Is parent-child relationship enforced?
7. Is action-specific state rule enforced?
8. Is maker-checker/separation-of-duty enforced?
9. Are bulk IDs checked per object?
10. Is search scoped before pagination?
11. Are counts/facets scoped?
12. Is export using the same authorization predicate?
13. Is file download authorized before streaming?
14. Is cache key authorization-safe?
15. Is DTO field visibility controlled?
16. Does denial response leak object existence?
17. Is denial audited with reason code?
18. Is there test coverage for user A vs user B?
19. Is there cross-tenant test coverage?
20. Is there a negative test for each sensitive action?

---

## 18. Architectural Patterns to Prevent BOLA

### 18.1 Authorized repository/query pattern

Use scoped query methods for read/list/export.

```java
Page<CaseEntity> searchReadable(AccessScope scope, CaseSearchCriteria criteria, Pageable pageable);
```

Best for:

1. list/search;
2. pagination;
3. export;
4. reports;
5. count/facet.

### 18.2 Explicit authorization service pattern

Use decision service for command/action checks.

```java
authorizationService.verify(user, CaseAction.APPROVE, caseResource, context);
```

Best for:

1. state transitions;
2. writes;
3. complex action rules;
4. explainable denial;
5. audit-heavy systems.

### 18.3 Policy specification pattern

Represent access rule as reusable predicate/specification.

```java
Specification<CaseEntity> readableBy(AccessScope scope)
```

Use it in:

1. detail query;
2. list query;
3. export query;
4. count query.

### 18.4 Domain guard pattern

Put invariant close to domain transition.

```java
caseEntity.approve(ApprovedBy.of(user), approvalPolicy);
```

Useful when authorization is deeply tied to state machine.

### 18.5 Decision object pattern

Avoid boolean-only authorization.

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final Map<String, Object> evidence;
    private final List<Obligation> obligations;
}
```

Why:

1. audit;
2. troubleshooting;
3. field visibility;
4. obligation handling;
5. policy explainability.

### 18.6 Central access scope resolver

```java
public final class AccessScope {
    private final String tenantId;
    private final Set<String> agencyIds;
    private final Set<String> teamIds;
    private final Set<String> permissions;
    private final boolean canReadAllTenantCases;
}
```

Centralizes effective scope so query predicates are consistent.

---

## 19. Anti-Patterns

### 19.1 `hasRole('ADMIN')` as universal escape hatch

Admins still need scoped rules in many systems.

Questions:

1. admin of what tenant?
2. admin of what module?
3. can admin see confidential records?
4. can admin approve own submission?
5. is break-glass needed?

### 19.2 Client-provided ownership

Bad:

```json
{
  "tenantId": "tenant-a",
  "ownerUserId": "user-123"
}
```

Server must derive tenant/owner from trusted context and existing records.

### 19.3 UUID as authorization

UUID reduces guessing, not unauthorized use.

### 19.4 Filter after fetch

Bad for pagination, counts, performance, and leakage.

### 19.5 Sharing service account blindly

Service-to-service call using powerful service account can bypass user authorization.

Need preserve user context or enforce workload-specific policy.

### 19.6 Authorization only in frontend

Frontend can hide buttons, but backend must enforce.

### 19.7 Ignoring non-GET actions

BOLA is not only read leakage. State-changing actions are often worse.

### 19.8 Unscoped export

Export must be treated as high-risk read.

### 19.9 Unscoped audit trail

Audit trail often contains sensitive metadata. It needs its own object-level rules.

### 19.10 Debug/internal endpoints

“Internal” does not mean authorized. Internal endpoints can be called by other compromised services or misconfigured routes.

---

## 20. Production Readiness Checklist

A Java system is not production-ready for object-level authorization unless:

1. every endpoint with object reference has object-level authorization;
2. every mutation checks action-specific authorization;
3. every search/list applies authorization predicate before pagination;
4. every export uses same authorization predicate as screen/list;
5. every file download authorizes metadata before streaming;
6. every pre-signed URL is generated only after authorization;
7. tenant/org/agency boundary is enforced server-side;
8. parent-child relation is validated server-side;
9. cache keys are tenant/scope safe;
10. decision logs include action/resource/subject/context/reason;
11. denial responses are intentionally designed;
12. bulk operation semantics are explicit;
13. DTO field visibility is controlled;
14. negative tests exist for horizontal and vertical privilege;
15. cross-tenant tests exist;
16. maker-checker/state tests exist;
17. code review has BOLA checklist;
18. monitoring detects unusual denied object access;
19. access policy has owner/reviewer;
20. permission revocation latency is known.

---

## 21. Top 1% Engineering Insights

### Insight 1 — BOLA is usually a design smell, not a missing annotation

If fixing BOLA means sprinkling `@PreAuthorize` everywhere, the design is probably still weak. You need an access model that shapes repositories, service methods, DTOs, exports, caches, and tests.

### Insight 2 — Object-level authorization is part of domain modeling

In enterprise systems, “who can do what to which object in which state” is business logic. Treating it as a security afterthought creates inconsistency.

### Insight 3 — Search/list/export must share authorization predicate

If screen query and export query are implemented separately, they will eventually diverge. Shared predicate/specification is not optional in sensitive systems.

### Insight 4 — Same role does not mean same access

Most BOLA bugs happen between users with the same general role. RBAC alone cannot solve assignment, ownership, tenant, relationship, state, and context rules.

### Insight 5 — `findById` should make you pause

In request-driven code, `findById(userProvidedId)` should trigger an automatic review question:

> “Where is the object-level authorization?”

### Insight 6 — Object existence can be sensitive

In some systems, revealing that a case/report/investigation exists is itself a leak. Response semantics must be deliberate.

### Insight 7 — Authorization must be tested negatively

Positive tests prove legitimate users can work. Negative tests prove attackers cannot cross boundaries.

### Insight 8 — BOLA prevention is a cross-layer discipline

You need:

1. endpoint permission;
2. object scope;
3. query predicate;
4. domain state guard;
5. DTO field control;
6. cache correctness;
7. auditability;
8. negative testing.

One layer is not enough.

---

## 22. Mini Capstone: Case Detail Endpoint Design

Requirement:

> Officer can view case detail only if the case belongs to the same tenant, is assigned to the officer or their team, is not sealed beyond their clearance, and the officer has `case.read.detail` permission. Legal notes are visible only to legal officers or users with `case.legal_notes.read`.

### 22.1 Types

```java
public enum CaseAction {
    READ_DETAIL,
    READ_LEGAL_NOTES,
    APPROVE,
    ASSIGN,
    EXPORT
}
```

```java
public final class CaseResource {
    private final long caseId;
    private final String tenantId;
    private final String assignedUserId;
    private final String assignedTeamId;
    private final CaseStatus status;
    private final ConfidentialityLevel confidentiality;
    private final boolean sealed;

    // constructor/getters omitted
}
```

```java
public final class FieldVisibility {
    private final boolean legalNotesVisible;
    private final boolean identityNumberVisible;
    private final boolean riskScoreVisible;

    // constructor/getters omitted
}
```

### 22.2 Authorization policy

```java
public final class CaseReadDetailPolicy {

    public AuthorizationDecision decide(CurrentUser user, CaseResource resource) {
        if (!user.hasPermission("case.read.detail")) {
            return AuthorizationDecision.deny("MISSING_CASE_READ_DETAIL");
        }

        if (!user.tenantId().equals(resource.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH");
        }

        boolean directlyAssigned = user.userId().equals(resource.assignedUserId());
        boolean teamAssigned = user.teamIds().contains(resource.assignedTeamId());
        boolean tenantWideReader = user.hasPermission("case.read.all_in_tenant");

        if (!directlyAssigned && !teamAssigned && !tenantWideReader) {
            return AuthorizationDecision.deny("NOT_IN_CASE_SCOPE");
        }

        if (resource.sealed() && !user.hasPermission("case.sealed.read")) {
            return AuthorizationDecision.deny("SEALED_CASE_REQUIRES_PERMISSION");
        }

        FieldVisibility visibility = new FieldVisibility(
                user.hasPermission("case.legal_notes.read"),
                user.hasPermission("case.identity_number.read"),
                user.hasPermission("case.risk_score.read")
        );

        return AuthorizationDecision.allow("CASE_IN_SCOPE", visibility);
    }
}
```

### 22.3 Service

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCaseDetail(CurrentUser user, long caseId) {
    CaseEntity entity = caseRepository.findById(caseId)
            .orElseThrow(NotFoundException::new);

    CaseResource resource = CaseResource.from(entity);

    AuthorizationDecision decision = caseReadDetailPolicy.decide(user, resource);

    if (!decision.allowed()) {
        audit.denied(user, CaseAction.READ_DETAIL, resource.ref(), decision.reasonCode());
        throw new NotFoundException("Case not found");
    }

    audit.allowed(user, CaseAction.READ_DETAIL, resource.ref(), decision.reasonCode());

    return caseMapper.toDetail(entity, decision.fieldVisibility());
}
```

### 22.4 Stronger version: scoped query first

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCaseDetail(CurrentUser user, long caseId) {
    AccessScope scope = accessScopeResolver.resolveCaseDetailScope(user);

    CaseEntity entity = caseRepository.findCaseDetailReadableBy(scope, caseId)
            .orElseThrow(NotFoundException::new);

    FieldVisibility visibility = fieldVisibilityResolver.resolveForCaseDetail(user, entity);

    audit.allowed(user, CaseAction.READ_DETAIL, CaseRef.of(caseId), "QUERY_SCOPE_MATCHED");

    return caseMapper.toDetail(entity, visibility);
}
```

This version avoids loading unauthorized cases at all, but requires carefully maintained shared query predicate.

---

## 23. Summary

IDOR/BOLA is not a beginner mistake. It appears even in mature systems because authorization is often implemented at the wrong abstraction level.

The core lesson:

```text
A user being authenticated does not mean they may access an object.
A user having a role does not mean they may access every object of that type.
A user seeing an object ID does not mean they may dereference it.
A list endpoint being scoped does not mean detail/export/download endpoints are scoped.
```

A strong Java authorization design must ensure:

1. endpoint-level capability check;
2. object-level resource check;
3. tenant/org/agency invariant;
4. action-specific state guard;
5. parent-child consistency;
6. search/export/query scoping;
7. file/download protection;
8. safe cache keys;
9. field-level visibility;
10. negative test coverage;
11. auditable decisions.

When you can reason through all of those consistently, you are no longer merely “using security framework features”. You are engineering authorization as a domain-critical correctness system.

---

## 24. References

1. OWASP API Security Top 10 2023 — API1: Broken Object Level Authorization.  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

2. OWASP API Security Project.  
   https://owasp.org/www-project-api-security/

3. OWASP Authorization Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

4. OWASP Insecure Direct Object Reference Prevention Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html

5. Spring Security Reference — Authorization Architecture.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

6. Spring Security Reference — Authorize HTTP Servlet Requests.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html

---

## 25. Status Seri

Selesai:

- Part 0 — Authorization Mental Model: From “Role Check” to Decision System
- Part 1 — Authorization Vocabulary, Semantics, and Invariants
- Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
- Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- Part 4 — RBAC Done Properly: Role-Based Access Control Beyond `ADMIN`
- Part 5 — Permission and Capability Modeling
- Part 6 — ABAC: Attribute-Based Authorization
- Part 7 — PBAC and Policy-as-Code
- Part 8 — ReBAC: Relationship-Based Authorization
- Part 9 — ACL and Domain Object Security
- Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- Part 11 — IDOR, BOLA, and Object-Level Authorization

Berikutnya:

- Part 12 — Authorization in Layered Java Applications

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-010.md">⬅️ Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-012.md">Part 12 — Authorization in Layered Java Applications ➡️</a>
</div>
