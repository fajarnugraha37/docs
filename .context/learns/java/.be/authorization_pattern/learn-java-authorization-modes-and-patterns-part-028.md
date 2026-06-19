# learn-java-authorization-modes-and-patterns-part-028

# Part 28 — Secure Authorization Testing Strategy

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: menguji authorization sebagai invariant keamanan dan bisnis, bukan sekadar menguji annotation atau endpoint happy path.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi besar:

- mental model authorization,
- vocabulary dan invariant,
- primitive Java platform,
- PEP/PDP/PAP/PIP,
- RBAC, permission, ABAC, PBAC, ReBAC, ACL,
- tenant/data-boundary,
- BOLA/IDOR,
- layered authorization,
- Spring Security, method security, domain authorization,
- Jakarta authorization,
- REST/GraphQL/gRPC/messaging,
- data-level query scoping,
- workflow/state-machine authorization,
- delegation/impersonation/break-glass,
- hierarchical organization,
- temporal/risk/contextual access,
- distributed authorization,
- token scopes/claims,
- caching/performance,
- failure semantics,
- auditability/explainability/regulatory defensibility.

Part ini menjawab pertanyaan berikut:

> “Bagaimana kita membuktikan authorization benar, tetap benar setelah refactor, dan tidak diam-diam membuka privilege escalation?”

Testing authorization berbeda dari testing fitur biasa. Pada fitur biasa, test sering bertanya:

> “Apakah user bisa melakukan hal yang benar?”

Pada authorization, test yang lebih penting sering bertanya:

> “Apakah user **tidak bisa** melakukan hal yang salah, lewat jalur lain, pada object lain, tenant lain, state lain, query lain, export lain, job lain, dan kondisi edge case lain?”

Itulah sebabnya authorization testing harus sistematis, matrix-driven, negative-first, dan invariant-oriented.

---

## 1. Mental Model: Authorization Testing Bukan Sekadar `403`

Authorization testing bukan hanya mengecek apakah endpoint mengembalikan `403 Forbidden`.

Itu hanya gejala paling luar.

Authorization yang benar harus diuji di beberapa dimensi:

```text
Subject    : siapa yang bertindak?
Action     : operasi apa yang ingin dilakukan?
Resource   : object/data mana yang ditarget?
Context    : tenant, state, waktu, channel, delegation, risk, org scope?
Path       : lewat endpoint/query/job/event/internal API mana?
Decision   : allow/deny/error?
Evidence   : alasan, policy version, audit, deny reason?
Side effect: apakah data berubah? apakah audit tercatat? apakah cache aman?
```

Test yang hanya mengecek status HTTP sering melewatkan:

1. endpoint mengembalikan `200`, tetapi body berisi data tenant lain,
2. list endpoint aman, tetapi export endpoint bocor,
3. UI menyembunyikan tombol, tetapi API tetap menerima command,
4. service check ada, tetapi batch job bypass,
5. direct object endpoint aman, tetapi search index bocor,
6. token scope benar, tetapi stale permission masih diterima,
7. policy deny benar, tetapi denial tidak diaudit,
8. partial bulk operation mengubah sebagian object yang tidak authorized,
9. cache menyajikan hasil user A ke user B,
10. method security tidak aktif karena self-invocation/proxy mistake.

Top 1% engineer tidak bertanya:

> “Apakah test security sudah ada?”

Mereka bertanya:

> “Apakah test membuktikan invariant authorization pada semua jalur eksekusi yang realistis?”

---

## 2. Prinsip Utama Authorization Testing

### 2.1 Test Deny Sama Pentingnya Dengan Test Allow

Banyak tim menulis test seperti ini:

```text
Admin can approve case.
Officer can update assigned case.
Reviewer can view submitted case.
```

Itu perlu, tetapi belum cukup.

Authorization lebih sering gagal pada jalur deny:

```text
Officer cannot update unassigned case.
Officer cannot update case from another agency.
Reviewer cannot approve own submission.
Expired delegation cannot act.
Support user cannot silently impersonate.
User with search permission cannot export data.
```

Positive tests membuktikan fungsi bisa dipakai.

Negative tests membuktikan batas kewenangan tidak bocor.

### 2.2 Test Harus Berbasis Invariant, Bukan Implementasi

Buruk:

```text
Should call hasRole("ADMIN")
```

Lebih baik:

```text
User without case.approve cannot approve case.
```

Lebih kuat:

```text
No user may approve a case they submitted themselves, even if they have case.approve.
```

Yang pertama menguji implementasi.
Yang ketiga menguji invariant.

Jika implementation berubah dari Spring annotation ke policy engine, invariant test tetap relevan.

### 2.3 Test Harus Mencakup Semua Enforcement Path

Authorization sering bocor bukan karena rule salah, tetapi karena ada path yang tidak memanggil rule.

Contoh:

```text
/cases/{id}                  -> checked
/cases/search                -> checked partially
/cases/export                -> unchecked
/internal/cases/{id}/sync    -> unchecked
/batch/recalculate           -> unchecked
/graphql                     -> checked at query root only
```

Testing harus punya inventory jalur akses.

### 2.4 Test Harus Memisahkan Authentication dan Authorization

Authentication test bertanya:

```text
Apakah token/session/user valid?
```

Authorization test bertanya:

```text
Dengan identity valid ini, apakah action terhadap resource ini boleh?
```

Dalam banyak authorization test, identity boleh dibuat synthetic/mock, karena fokusnya bukan login flow.

### 2.5 Test Harus Memverifikasi Tidak Ada Side Effect Pada Deny

Deny test tidak cukup mengecek `403`.

Harus juga mengecek:

```text
- entity tidak berubah,
- status workflow tidak berubah,
- file tidak dibuat,
- event tidak dipublish,
- email tidak terkirim,
- audit denial tercatat,
- cache tidak terisi dengan data salah,
- partial mutation tidak terjadi kecuali memang didesain eksplisit.
```

Authorization deny yang mengembalikan `403` setelah side effect tetap bug.

---

## 3. Authorization Testing Pyramid

Testing authorization perlu beberapa layer. Tidak semua test harus end-to-end.

```text
                              +-----------------------+
                              |   Manual / Red Team   |
                              +-----------------------+
                              |     E2E Security      |
                              +-----------------------+
                              | API / Contract Tests  |
                              +-----------------------+
                              | Integration Tests     |
                              +-----------------------+
                              | Policy / Domain Tests |
                              +-----------------------+
                              | Unit Tests            |
                              +-----------------------+
```

### 3.1 Unit Tests

Cocok untuk:

- permission parser,
- role resolver,
- policy combinator,
- decision object,
- attribute normalization,
- tenant context resolver,
- state transition guard.

Tidak cocok untuk membuktikan endpoint aman secara keseluruhan.

### 3.2 Policy / Domain Tests

Cocok untuk:

- `CaseAuthorizationPolicy`,
- `canApprove`,
- `canView`,
- workflow transition guard,
- ABAC/ReBAC/ACL rules,
- decision reason.

Ini biasanya test paling bernilai karena dekat dengan invariant bisnis.

### 3.3 Integration Tests

Cocok untuk:

- Spring Security filter chain,
- method security proxy,
- repository query scoping,
- JPA/Hibernate filter,
- transaction ordering,
- cache invalidation,
- external PDP integration.

### 3.4 API / Contract Tests

Cocok untuk:

- REST endpoint,
- GraphQL resolver,
- gRPC service,
- messaging handler,
- export/download endpoint,
- bulk endpoint.

### 3.5 E2E Security Tests

Cocok untuk membuktikan:

- UI tidak memberikan false sense of security,
- API tetap menolak direct call,
- session/token context benar,
- realistic user journey aman.

E2E test mahal. Pakai untuk alur kritikal saja.

### 3.6 Manual / Red Team / Exploratory

Tetap perlu untuk:

- IDOR discovery,
- privilege escalation path,
- alternate path discovery,
- chained vulnerability,
- role confusion,
- stale cache/permission edge case.

Namun jangan menggantungkan semua authorization assurance pada manual test.

---

## 4. Test Inventory: Apa Saja Yang Harus Diuji?

Sebelum menulis test, buat inventory.

### 4.1 Inventory Subject

Contoh subject dimension:

```text
- anonymous
- authenticated without role
- normal user
- officer
- senior officer
- reviewer
- approver
- supervisor
- admin
- support operator
- delegated user
- acting user
- service account
- expired user
- suspended user
- user from tenant A
- user from tenant B
```

### 4.2 Inventory Action

Contoh action:

```text
- view
- list
- search
- create
- update
- submit
- approve
- reject
- withdraw
- assign
- reassign
- export
- download
- delete
- reopen
- override
- impersonate
- configure policy
```

### 4.3 Inventory Resource

Contoh resource:

```text
- own case
- assigned case
- unassigned case
- case from same team
- case from other team
- case from other tenant
- draft case
- submitted case
- approved case
- rejected case
- archived case
- confidential document
- public document
- generated report
- audit record
```

### 4.4 Inventory Context

Contoh context:

```text
- tenant
- agency
- department
- role scope
- delegation active/expired
- impersonation mode
- break-glass mode
- MFA satisfied/not satisfied
- risk low/high
- business hours/outside hours
- workflow state
- assignment
- channel: UI/API/batch/internal
- request origin/network zone
```

### 4.5 Inventory Path

Contoh access path:

```text
- detail endpoint
- list endpoint
- search endpoint
- export endpoint
- download endpoint
- bulk endpoint
- GraphQL query
- GraphQL mutation
- gRPC method
- JMS/Kafka/RabbitMQ consumer
- scheduled job
- internal admin endpoint
- support tool
- report generator
- data sync job
```

Tanpa inventory path, test bisa terlihat lengkap tetapi tetap melewatkan jalur bocor.

---

## 5. Permission Matrix Testing

Permission matrix adalah alat utama untuk menghindari test acak.

Contoh matrix sederhana:

| Subject | Action | Resource | Context | Expected |
|---|---|---|---|---|
| Officer | view | assigned case | same agency | ALLOW |
| Officer | view | unassigned case | same agency | DENY |
| Officer | view | assigned case | other agency | DENY |
| Reviewer | approve | submitted case | not own submission | ALLOW |
| Reviewer | approve | submitted case | own submission | DENY |
| Admin | export | report | same tenant | ALLOW |
| Admin | export | report | other tenant | DENY |
| Support | impersonate | user account | ticket approved | ALLOW_WITH_AUDIT |
| Support | impersonate | user account | no ticket | DENY |

Matrix test harus mencakup:

1. positive allow,
2. negative deny,
3. cross-tenant deny,
4. cross-state deny,
5. missing permission deny,
6. stale/expired context deny,
7. delegation/impersonation special case,
8. audit expectation.

### 5.1 Jangan Membuat Matrix Terlalu Besar Tanpa Struktur

Jika ada:

```text
10 roles × 20 actions × 15 resource types × 8 states × 5 tenants
```

Kombinasi mentahnya sangat besar.

Solusinya bukan mengetes semua secara buta, tetapi memilih equivalence classes.

Contoh class:

```text
same tenant vs other tenant
assigned vs unassigned
own submission vs not own submission
active delegation vs expired delegation
allowed state vs forbidden state
```

Testing authorization yang matang memakai kombinasi:

- representative example,
- boundary case,
- property/metamorphic test,
- mutation test,
- golden matrix.

---

## 6. Golden Decision Tests

Golden decision test menyimpan expected authorization decision sebagai data.

Contoh `authorization-decisions.csv`:

```csv
caseId,subject,role,tenant,action,state,assignedTo,submittedBy,expected,reason
C-001,u-officer,OFFICER,T1,VIEW,SUBMITTED,u-officer,u-applicant,ALLOW,ASSIGNED_CASE
C-002,u-officer,OFFICER,T1,VIEW,SUBMITTED,u-other,u-applicant,DENY,NOT_ASSIGNED
C-003,u-reviewer,REVIEWER,T1,APPROVE,SUBMITTED,u-officer,u-reviewer,DENY,MAKER_CHECKER_VIOLATION
C-004,u-reviewer,REVIEWER,T1,APPROVE,SUBMITTED,u-officer,u-applicant,ALLOW,HAS_APPROVE_AND_NOT_SUBMITTER
C-005,u-admin,ADMIN,T1,VIEW,APPROVED,u-other,u-applicant,ALLOW,TENANT_ADMIN
C-006,u-admin,ADMIN,T2,VIEW,APPROVED,u-other,u-applicant,DENY,CROSS_TENANT
```

JUnit 5 parameterized test:

```java
@ParameterizedTest
@CsvFileSource(resources = "/authorization-decisions.csv", numLinesToSkip = 1)
void shouldMatchGoldenAuthorizationDecision(
        String caseId,
        String subjectId,
        String role,
        String tenantId,
        String action,
        String state,
        String assignedTo,
        String submittedBy,
        String expected,
        String reason
) {
    UserSubject subject = new UserSubject(subjectId, tenantId, Set.of(role));
    CaseResource resource = new CaseResource(caseId, tenantId, state, assignedTo, submittedBy);

    AuthorizationDecision decision = policy.decide(
            subject,
            Action.of(action),
            resource,
            AuthorizationContext.systemTest()
    );

    assertEquals(expected, decision.outcome().name());
    assertEquals(reason, decision.reasonCode());
}
```

Untuk Java 8, ganti `Set.of` dengan `Collections.singleton(role)` atau helper.

Golden test berguna untuk:

- review policy change,
- mencegah regression,
- mendokumentasikan expected behavior,
- approval dari BA/security/domain owner,
- membandingkan old vs new policy saat migration.

---

## 7. Testing Object-Level Authorization

Object-level authorization harus menjawab:

```text
Apakah subject ini boleh melakukan action ini terhadap object spesifik ini?
```

Bukan hanya:

```text
Apakah subject ini boleh memanggil endpoint ini?
```

### 7.1 REST Detail Endpoint Test

Contoh Spring MVC test:

```java
@Test
@WithMockUser(username = "officer-a", authorities = "case.read")
void officerCannotReadCaseFromAnotherTenant() throws Exception {
    mockMvc.perform(get("/api/cases/{id}", "CASE-TENANT-B-001")
            .header("X-Tenant-Id", "tenant-a"))
        .andExpect(status().isNotFound()); // or 403 depending on masking policy
}
```

Namun test ini belum cukup.

Harus cek juga:

```java
@Test
@WithMockUser(username = "officer-a", authorities = "case.read")
void deniedReadMustNotProduceAccessAuditAsSuccessfulRead() throws Exception {
    mockMvc.perform(get("/api/cases/{id}", "CASE-TENANT-B-001"))
        .andExpect(status().isNotFound());

    assertThat(auditRepository.findSuccessfulRead("officer-a", "CASE-TENANT-B-001"))
        .isEmpty();

    assertThat(auditRepository.findDeniedAccess("officer-a", "CASE-TENANT-B-001"))
        .hasSize(1);
}
```

### 7.2 Mutation Endpoint Test

```java
@Test
@WithMockUser(username = "reviewer-a", authorities = "case.approve")
void reviewerCannotApproveOwnSubmission() throws Exception {
    String caseId = givenSubmittedCase(submittedBy("reviewer-a"));

    mockMvc.perform(post("/api/cases/{id}/approve", caseId))
        .andExpect(status().isForbidden());

    CaseEntity after = caseRepository.findById(caseId).orElseThrow();
    assertEquals("SUBMITTED", after.getStatus());
    assertFalse(eventBus.contains("CaseApproved", caseId));
}
```

Kunci test ini:

1. deny status,
2. state tidak berubah,
3. event tidak terbit,
4. audit deny tercatat,
5. reason code sesuai.

---

## 8. Tenant Isolation Testing

Tenant isolation adalah invariant tertinggi pada multi-tenant system.

Test harus membuktikan:

```text
No subject from tenant A can read, mutate, list, search, export, download, cache-hit, or infer protected data from tenant B unless explicit cross-tenant authority exists.
```

### 8.1 Detail Test

```java
@Test
void tenantAUserCannotAccessTenantBCaseById() {
    Subject subject = subject("user-a", "tenant-a", "case.read");
    CaseResource resource = caseResource("case-b", "tenant-b");

    AuthorizationDecision decision = policy.decide(subject, CASE_READ, resource, context());

    assertDenied(decision, "TENANT_MISMATCH");
}
```

### 8.2 List Query Test

```java
@Test
void listCasesMustOnlyReturnCurrentTenantRows() {
    givenCase("case-a-1", "tenant-a");
    givenCase("case-a-2", "tenant-a");
    givenCase("case-b-1", "tenant-b");

    List<CaseSummary> result = caseQueryService.listCases(authContext("user-a", "tenant-a"));

    assertThat(result)
        .extracting(CaseSummary::tenantId)
        .containsOnly("tenant-a");
}
```

### 8.3 Count/Aggregation Leakage Test

List bisa aman tetapi count bocor.

```java
@Test
void countMustBeTenantScoped() {
    givenCases("tenant-a", 2);
    givenCases("tenant-b", 100);

    long count = caseQueryService.countCases(authContext("user-a", "tenant-a"));

    assertEquals(2, count);
}
```

### 8.4 Export Leakage Test

```java
@Test
void exportMustOnlyContainAuthorizedTenantRows() {
    givenCase("case-a-1", "tenant-a");
    givenCase("case-b-1", "tenant-b");

    ExportFile file = exportService.exportCases(authContext("user-a", "tenant-a"));

    String csv = file.readAsString();
    assertTrue(csv.contains("case-a-1"));
    assertFalse(csv.contains("case-b-1"));
}
```

### 8.5 Cache Isolation Test

```java
@Test
void authorizationCacheMustIncludeTenantInKey() {
    Subject userA = subject("same-user-id", "tenant-a", "case.read");
    Subject userB = subject("same-user-id", "tenant-b", "case.read");

    CaseResource caseA = caseResource("case-1", "tenant-a");
    CaseResource caseB = caseResource("case-1", "tenant-b");

    assertAllowed(policy.decide(userA, CASE_READ, caseA, context()));
    assertDenied(policy.decide(userA, CASE_READ, caseB, context()));

    assertAllowed(policy.decide(userB, CASE_READ, caseB, context()));
    assertDenied(policy.decide(userB, CASE_READ, caseA, context()));
}
```

Bug cache key sering muncul jika key hanya:

```text
userId + action + resourceId
```

Padahal harus memasukkan boundary relevan:

```text
tenantId + userId + activeAuthorityVersion + action + resourceType + resourceId + contextHash
```

---

## 9. State Transition Authorization Testing

Dalam workflow/case management, authorization sering berupa transition guard.

Contoh invariant:

```text
Only assigned officer may submit draft case.
Only reviewer may approve submitted case.
Reviewer cannot approve own submission.
Approved case cannot be edited except through reopen transition.
Rejected case cannot be approved without resubmission.
Escalated case requires supervisor authority.
```

### 9.1 Transition Matrix

| Current State | Action | Subject | Condition | Expected |
|---|---|---|---|---|
| DRAFT | submit | assigned officer | same tenant | ALLOW |
| DRAFT | submit | unassigned officer | same tenant | DENY |
| SUBMITTED | approve | reviewer | not submitter | ALLOW |
| SUBMITTED | approve | reviewer | submitter | DENY |
| APPROVED | update | officer | assigned | DENY |
| REJECTED | approve | reviewer | not resubmitted | DENY |
| ESCALATED | resolve | supervisor | same org scope | ALLOW |

### 9.2 Parameterized Test

```java
@ParameterizedTest
@MethodSource("transitionCases")
void transitionAuthorizationMustMatchInvariant(TransitionScenario scenario) {
    WorkflowCase caze = scenario.caseResource();
    Subject subject = scenario.subject();

    AuthorizationDecision decision = workflowPolicy.decideTransition(
            subject,
            scenario.action(),
            caze,
            scenario.context()
    );

    assertEquals(scenario.expectedOutcome(), decision.outcome());
    assertEquals(scenario.expectedReason(), decision.reasonCode());
}
```

### 9.3 Deny Must Not Transition

```java
@Test
void failedApprovalMustNotChangeState() {
    String caseId = givenCase(SUBMITTED, submittedBy("reviewer-1"));

    assertThrows(AccessDeniedException.class, () ->
        workflowService.approve(caseId, auth("reviewer-1"))
    );

    assertEquals(SUBMITTED, caseRepository.getStatus(caseId));
}
```

### 9.4 TOCTOU Test

Time-of-check/time-of-use bug:

```text
1. user authorized when case is assigned to them,
2. assignment changes,
3. user still updates using stale decision.
```

Test:

```java
@Test
void authorizationMustUseCurrentAssignmentAtMutationTime() {
    String caseId = givenAssignedCase("officer-a");

    AuthorizationDecision precheck = policy.decide(
            subject("officer-a"), CASE_UPDATE, caseRepository.get(caseId), context()
    );
    assertAllowed(precheck);

    caseRepository.reassign(caseId, "officer-b");

    assertThrows(AccessDeniedException.class, () ->
            caseService.updateCase(caseId, updateCommand(), auth("officer-a"))
    );
}
```

Precheck cache tidak boleh mengalahkan current state untuk mutation sensitif.

---

## 10. Method Security Testing in Spring

Spring Security menyediakan test support untuk method security, termasuk annotation seperti `@WithMockUser` dan support untuk mengisi `SecurityContext` saat test.

### 10.1 Basic Method Security Test

```java
@SpringBootTest
@EnableMethodSecurity
class CaseServiceMethodSecurityTest {

    @Autowired
    CaseService caseService;

    @Test
    @WithMockUser(username = "officer-a", authorities = "case.update")
    void userWithPermissionCanCallUpdate() {
        assertDoesNotThrow(() -> caseService.updateCase("C-001", command()));
    }

    @Test
    @WithMockUser(username = "viewer-a", authorities = "case.read")
    void userWithoutPermissionCannotCallUpdate() {
        assertThrows(AccessDeniedException.class,
                () -> caseService.updateCase("C-001", command()));
    }
}
```

### 10.2 Jangan Hanya Test Annotation

Buruk:

```java
@PreAuthorize("hasAuthority('case.update')")
public void updateCase(...) { ... }
```

Test hanya memastikan `case.update` diperlukan.

Tetapi object-level rule bisa tetap hilang.

Lebih baik:

```java
@PreAuthorize("@casePolicy.canUpdate(authentication, #caseId)")
public void updateCase(String caseId, UpdateCaseCommand command) { ... }
```

Test:

```java
@Test
@WithMockUser(username = "officer-a", authorities = "case.update")
void userWithGeneralPermissionStillCannotUpdateUnassignedCase() {
    String caseId = givenCaseAssignedTo("officer-b");

    assertThrows(AccessDeniedException.class, () ->
            caseService.updateCase(caseId, command())
    );
}
```

### 10.3 Self-Invocation Regression Test

Spring method security biasanya berbasis proxy. Jika method security dipanggil dari method lain dalam class yang sama, proxy bisa terlewati.

Contoh bahaya:

```java
@Service
class CaseService {

    public void bulkApprove(List<String> ids) {
        for (String id : ids) {
            approve(id); // self-invocation: can bypass proxy-based method security
        }
    }

    @PreAuthorize("@casePolicy.canApprove(authentication, #id)")
    public void approve(String id) {
        // mutation
    }
}
```

Regression test:

```java
@Test
@WithMockUser(username = "reviewer-a", authorities = "case.approve")
void bulkApproveMustNotBypassPerObjectAuthorization() {
    String allowed = givenSubmittedCase(notSubmittedBy("reviewer-a"));
    String forbidden = givenSubmittedCase(submittedBy("reviewer-a"));

    assertThrows(AccessDeniedException.class, () ->
            caseService.bulkApprove(List.of(allowed, forbidden))
    );

    assertEquals(SUBMITTED, caseRepository.getStatus(forbidden));
}
```

Solusi desain biasanya:

1. panggil policy eksplisit dalam loop,
2. pindahkan secured method ke bean lain,
3. jangan bergantung pada annotation untuk per-item bulk operation.

---

## 11. Request Authorization Testing in Spring MVC

Request-level authorization perlu menguji:

1. matcher order,
2. public/private endpoint,
3. role/authority mapping,
4. path variable manipulation,
5. trailing slash/path normalization,
6. static/actuator endpoint,
7. multiple filter chain.

### 11.1 Public Endpoint Test

```java
@Test
void healthEndpointIsPublicButAdminEndpointIsNot() throws Exception {
    mockMvc.perform(get("/actuator/health"))
        .andExpect(status().isOk());

    mockMvc.perform(get("/actuator/env"))
        .andExpect(status().isUnauthorized());
}
```

### 11.2 Matcher Order Test

Misconfiguration umum:

```java
.requestMatchers("/api/**").authenticated()
.requestMatchers("/api/admin/**").hasAuthority("admin")
```

Matcher general lebih dulu, admin endpoint bisa hanya butuh authenticated.

Test:

```java
@Test
@WithMockUser(authorities = "case.read")
void adminEndpointMustRequireAdminAuthority() throws Exception {
    mockMvc.perform(get("/api/admin/users"))
        .andExpect(status().isForbidden());
}
```

### 11.3 Role Prefix Test

Spring memiliki convention `ROLE_` untuk role tertentu. Test harus membuktikan authority mapping sesuai.

```java
@Test
@WithMockUser(roles = "ADMIN")
void roleAdminCanAccessRoleProtectedEndpoint() throws Exception {
    mockMvc.perform(get("/api/admin/dashboard"))
        .andExpect(status().isOk());
}

@Test
@WithMockUser(authorities = "ADMIN")
void plainAdminAuthorityMustNotAccidentallyMatchRoleAdminIfRolePrefixExpected() throws Exception {
    mockMvc.perform(get("/api/admin/dashboard"))
        .andExpect(status().isForbidden());
}
```

Atau jika desain memakai authority plain, test sebaliknya.

Yang penting: jangan ambigu.

---

## 12. Repository and Query Scoping Tests

Banyak authorization bug muncul saat query.

### 12.1 Repository Scope Contract

Buat contract:

```text
All user-facing case queries must be scoped by tenant and visibility predicate.
```

Test:

```java
@Test
void repositoryQueryMustNotReturnRowsOutsideAuthorizationScope() {
    givenCase("C-A1", "tenant-a", assignedTo("officer-a"));
    givenCase("C-A2", "tenant-a", assignedTo("officer-b"));
    givenCase("C-B1", "tenant-b", assignedTo("officer-a"));

    AuthorizationScope scope = scopeFor(subject("officer-a", "tenant-a"));

    List<CaseEntity> result = caseRepository.findVisibleCases(scope);

    assertThat(result).extracting(CaseEntity::getId).containsExactly("C-A1");
}
```

### 12.2 Test Filter-After-Fetch Anti-Pattern

Bug:

```java
List<CaseEntity> all = repository.findAll();
return all.stream().filter(policy::canView).toList();
```

Masalah:

- performance,
- pagination salah,
- count bocor,
- data sempat masuk memory/log/cache,
- export bisa bocor.

Test pagination:

```java
@Test
void authorizationFilteringMustHappenBeforePagination() {
    givenCasesForTenant("tenant-b", 20);
    givenCasesForTenant("tenant-a", 2);

    Page<CaseSummary> page = caseQueryService.search(
            auth("user-a", "tenant-a"),
            PageRequest.of(0, 10)
    );

    assertEquals(2, page.getTotalElements());
    assertThat(page.getContent()).hasSize(2);
    assertThat(page.getContent()).extracting(CaseSummary::tenantId).containsOnly("tenant-a");
}
```

Jika filter dilakukan setelah pagination, page bisa kosong atau total salah.

---

## 13. Bulk Operation Authorization Tests

Bulk operation adalah sumber bug serius.

Contoh:

```http
POST /cases/bulk-approve
{
  "caseIds": ["C-allowed", "C-forbidden"]
}
```

Pertanyaan desain:

1. Apakah semua harus authorized agar operasi jalan?
2. Apakah partial success boleh?
3. Apakah response boleh menyebut forbidden ID?
4. Apakah forbidden item berubah?
5. Apakah audit per item dibuat?

### 13.1 All-Or-Nothing Test

```java
@Test
void bulkApproveMustBeAtomicWhenAnyItemUnauthorized() throws Exception {
    String allowed = givenApprovableCase();
    String forbidden = givenOwnSubmittedCase("reviewer-a");

    mockMvc.perform(post("/api/cases/bulk-approve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(jsonIds(allowed, forbidden))
            .with(user("reviewer-a").authorities(new SimpleGrantedAuthority("case.approve"))))
        .andExpect(status().isForbidden());

    assertEquals(SUBMITTED, caseRepository.getStatus(allowed));
    assertEquals(SUBMITTED, caseRepository.getStatus(forbidden));
}
```

### 13.2 Partial Success Test

Jika desain partial success:

```java
@Test
void bulkApprovePartialSuccessMustReportPerItemDecisionAndMutateOnlyAllowedItems() throws Exception {
    String allowed = givenApprovableCase();
    String forbidden = givenOwnSubmittedCase("reviewer-a");

    mockMvc.perform(post("/api/cases/bulk-approve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(jsonIds(allowed, forbidden))
            .with(user("reviewer-a").authorities(new SimpleGrantedAuthority("case.approve"))))
        .andExpect(status().isMultiStatus())
        .andExpect(jsonPath("$.items[?(@.id=='" + allowed + "')].status").value("APPROVED"))
        .andExpect(jsonPath("$.items[?(@.id=='" + forbidden + "')].status").value("DENIED"));

    assertEquals(APPROVED, caseRepository.getStatus(allowed));
    assertEquals(SUBMITTED, caseRepository.getStatus(forbidden));
}
```

Partial success harus eksplisit, bukan efek samping tidak sengaja.

---

## 14. Export, Report, and Download Authorization Tests

Export sering menjadi blind spot.

Test harus mencakup:

```text
- export list respects same filters as screen,
- export cannot include hidden columns,
- report count/aggregation tenant scoped,
- file download checks object ownership,
- pre-signed URL generation authorized,
- generated file cannot be reused by unauthorized user,
- report cache key includes authorization scope.
```

### 14.1 Export Same Scope As Search

```java
@Test
void exportMustUseSameAuthorizationScopeAsSearch() {
    SearchCriteria criteria = new SearchCriteria("status", "SUBMITTED");
    AuthContext auth = auth("officer-a", "tenant-a");

    List<CaseSummary> screenRows = caseSearchService.search(auth, criteria, PageRequest.of(0, 100)).getContent();
    ExportFile file = caseExportService.export(auth, criteria);

    List<String> exportedIds = parseCsvIds(file);
    List<String> screenIds = screenRows.stream().map(CaseSummary::id).collect(toList());

    assertThat(exportedIds).containsExactlyElementsOf(screenIds);
}
```

### 14.2 File Download Test

```java
@Test
void userCannotDownloadDocumentFromUnauthorizedCase() throws Exception {
    String documentId = givenDocumentAttachedToCase("tenant-b");

    mockMvc.perform(get("/api/documents/{id}/download", documentId)
            .with(user("user-a").authorities(new SimpleGrantedAuthority("document.download"))))
        .andExpect(status().isNotFound());
}
```

Download permission alone is insufficient. Must check parent resource.

---

## 15. GraphQL Authorization Tests

GraphQL punya risiko khusus:

1. satu endpoint banyak operation,
2. nested field bisa bocor,
3. query alias/fragments bisa melewati asumsi sederhana,
4. resolver field-level sering butuh authorization sendiri.

### 15.1 Query Root Test

```java
@Test
void userCannotQueryUnauthorizedCaseById() {
    graphQlTester.mutateWith(mockUser("user-a", "case.read"))
        .document("""
            query {
              caseById(id: "CASE-B") {
                id
                title
              }
            }
            """)
        .execute()
        .errors()
        .satisfy(errors -> assertThat(errors).isNotEmpty());
}
```

### 15.2 Nested Field Test

```java
@Test
void confidentialNotesFieldRequiresSpecificPermission() {
    graphQlTester.mutateWith(mockUser("reviewer-a", "case.read"))
        .document("""
            query {
              caseById(id: "CASE-A") {
                id
                confidentialNotes
              }
            }
            """)
        .execute()
        .errors()
        .satisfy(errors -> assertThat(errors)
            .anyMatch(e -> e.getMessage().contains("Access denied")));
}
```

GraphQL test harus memverifikasi field-level data, bukan hanya endpoint `/graphql`.

---

## 16. Messaging Authorization Tests

Messaging authorization sering dilewatkan karena tidak terlihat sebagai “user request”.

Pertanyaan:

```text
- Apakah message membawa actor/context?
- Apakah consumer memverifikasi service account/workload authority?
- Apakah event command bisa dipalsukan?
- Apakah message dari tenant A bisa memutasi tenant B?
- Apakah replay message masih authorized?
```

### 16.1 Consumer Test

```java
@Test
void consumerMustRejectCommandWithTenantMismatch() {
    CaseApproveCommandMessage message = new CaseApproveCommandMessage(
            "CASE-B",
            "tenant-b",
            "officer-a",
            "tenant-a"
    );

    assertThrows(AccessDeniedException.class, () ->
            consumer.handle(message)
    );

    assertEquals(SUBMITTED, caseRepository.getStatus("CASE-B"));
}
```

### 16.2 Service Account Test

```java
@Test
void onlyTrustedWorkflowServiceCanEmitApprovalCommand() {
    MessageEnvelope envelope = envelope(
            serviceAccount("untrusted-service"),
            approveCommand("CASE-001")
    );

    assertThrows(AccessDeniedException.class, () -> consumer.handle(envelope));
}
```

Messaging test harus menganggap queue/topic bukan boundary authorization final.

---

## 17. External PDP / Policy Engine Testing

Jika memakai OPA/Rego, Cedar-style engine, atau custom remote PDP, test harus mencakup:

1. policy unit test,
2. input schema test,
3. decision mapping test,
4. integration with Java client,
5. failure mode,
6. policy version audit.

### 17.1 Policy Unit Test

OPA menyediakan mekanisme test untuk policy Rego.

Contoh konsep:

```rego
package authz

default allow := false

allow if {
  input.subject.tenant == input.resource.tenant
  input.action == "case.read"
  "case.read" in input.subject.permissions
}
```

Test Rego:

```rego
package authz_test

import data.authz.allow

test_allow_same_tenant_with_permission if {
  allow with input as {
    "subject": {"tenant": "T1", "permissions": ["case.read"]},
    "resource": {"tenant": "T1"},
    "action": "case.read"
  }
}

test_deny_cross_tenant if {
  not allow with input as {
    "subject": {"tenant": "T1", "permissions": ["case.read"]},
    "resource": {"tenant": "T2"},
    "action": "case.read"
  }
}
```

### 17.2 Java Mapping Test

```java
@Test
void javaPdpClientMustMapDenyDecisionCorrectly() {
    PdpResponse response = new PdpResponse(false, "TENANT_MISMATCH", "policy-v12");

    AuthorizationDecision decision = mapper.toDecision(response);

    assertDenied(decision, "TENANT_MISMATCH");
    assertEquals("policy-v12", decision.policyVersion());
}
```

### 17.3 PDP Failure Test

```java
@Test
void sensitiveActionMustFailClosedWhenPdpUnavailable() {
    pdpServer.stop();

    assertThrows(AccessDeniedException.class, () ->
            caseService.approve("CASE-001", auth("reviewer-a"))
    );
}
```

Tidak semua action harus sama. Read-only low-risk action mungkin punya cached fallback. Mutation sensitif biasanya fail-closed.

---

## 18. Property-Based Authorization Testing

Property-based testing menguji invariant dengan banyak variasi input.

Contoh property:

```text
For any subject S and resource R, if S.tenant != R.tenant and S does not have explicit crossTenant permission, decision must be DENY.
```

Dengan jqwik:

```java
@Property
void crossTenantAccessMustAlwaysBeDeniedWithoutExplicitAuthority(
        @ForAll("tenantIds") String subjectTenant,
        @ForAll("tenantIds") String resourceTenant,
        @ForAll("actions") String action
) {
    Assume.that(!subjectTenant.equals(resourceTenant));

    Subject subject = subject("user-1", subjectTenant, permissionFor(action));
    Resource resource = resource("resource-1", resourceTenant);

    AuthorizationDecision decision = policy.decide(
            subject,
            Action.of(action),
            resource,
            context()
    );

    assertDenied(decision);
}
```

Property-based testing cocok untuk invariant besar seperti:

```text
- cross tenant deny,
- suspended user deny,
- expired delegation deny,
- deny override wins,
- maker-checker deny,
- archived resource immutable,
- no mutation when denied,
- decision stable under irrelevant attribute changes.
```

### 18.1 Metamorphic Testing

Metamorphic relation contoh:

```text
Jika user tidak boleh melihat resource R, maka mengganti ID request ke R lewat endpoint detail/search/export/download tetap tidak boleh membuka R.
```

Atau:

```text
Jika subject tenant berubah dari T1 ke T2 tanpa mengubah resource tenant T1, decision harus berubah dari ALLOW menjadi DENY kecuali ada cross-tenant authority eksplisit.
```

Metamorphic testing berguna karena authorization sering punya oracle problem: sulit menulis expected untuk semua input, tetapi mudah menulis relation antar input.

---

## 19. Mutation Testing for Authorization

Mutation testing bertanya:

> “Jika authorization check dihapus/diubah, apakah test gagal?”

Contoh mutation berbahaya:

```java
if (subject.tenantId().equals(resource.tenantId())) {
    return allow();
}
return deny();
```

Dimutasi menjadi:

```java
if (!subject.tenantId().equals(resource.tenantId())) {
    return allow();
}
return deny();
```

Atau check dihapus:

```java
return allow();
```

Jika test tetap hijau, test tidak membuktikan authorization.

Tools seperti PIT Mutation Testing bisa membantu untuk Java code. Namun untuk authorization, kita juga perlu mutation konseptual:

```text
- remove tenant predicate,
- remove assignment predicate,
- remove state predicate,
- replace AND with OR,
- remove deny override,
- ignore expired delegation,
- ignore resource ownership,
- skip per-item bulk decision,
- remove repository scope predicate.
```

### 19.1 Manual Mutation Checklist

Saat review test authorization, tanyakan:

```text
Jika saya menghapus check tenant, test mana yang gagal?
Jika saya menghapus check assignment, test mana yang gagal?
Jika saya mengganti AND menjadi OR, test mana yang gagal?
Jika saya mengizinkan expired delegation, test mana yang gagal?
Jika export memakai repository findAll, test mana yang gagal?
Jika cache key tidak punya tenantId, test mana yang gagal?
Jika method security tidak aktif, test mana yang gagal?
```

Jika tidak ada jawaban jelas, coverage authorization belum cukup.

---

## 20. Test Data Design

Authorization test sangat bergantung pada data.

Test data harus didesain untuk membedakan boundary.

### 20.1 Bad Test Data

```text
Only one user.
Only one tenant.
Only one case.
Only one role.
Only one workflow state.
```

Dengan data seperti ini, cross-tenant bug tidak mungkin terdeteksi.

### 20.2 Good Test Data Minimum

Untuk setiap authorization test suite, minimal punya:

```text
Tenant T1
  User U1 officer
  User U2 reviewer
  Case C1 assigned to U1
  Case C2 assigned to U2
  Case C3 submitted by U2

Tenant T2
  User U3 officer
  Case C4 assigned to U3

Special
  suspended user
  expired delegation
  support user
  service account
```

### 20.3 Use Builders, Not Random Fixtures

```java
CaseFixture.givenCase()
    .tenant("T1")
    .state("SUBMITTED")
    .assignedTo("officer-a")
    .submittedBy("applicant-x")
    .build();
```

Builder membuat intent test jelas.

Hindari fixture global yang tidak terbaca.

---

## 21. Testing Denial Reason and Explainability

Jika system punya `Decision` object, test reason code.

```java
@Test
void denialReasonMustExplainMakerCheckerViolation() {
    AuthorizationDecision decision = policy.decide(
            reviewer("u1"),
            CASE_APPROVE,
            submittedCaseBy("u1"),
            context()
    );

    assertEquals(DecisionOutcome.DENY, decision.outcome());
    assertEquals("MAKER_CHECKER_VIOLATION", decision.reasonCode());
}
```

Tetapi hati-hati:

- internal reason untuk audit boleh detail,
- user-facing message harus aman,
- API response tidak boleh membocorkan resource existence jika masking policy memakai `404`.

Test dua layer:

```java
assertEquals("TENANT_MISMATCH", audit.reasonCode());
assertEquals(404, httpResponse.status());
assertFalse(httpResponse.body().contains("tenant"));
```

---

## 22. Testing Audit Side Effects

Untuk regulatory/enterprise system, authorization test harus mengecek audit.

### 22.1 Allow Audit

```java
@Test
void successfulSensitiveActionMustWriteAuthorizationAudit() {
    caseService.approve("CASE-001", auth("reviewer-a"));

    AuthorizationAudit audit = auditRepository.findLatest("CASE-001", "case.approve");

    assertEquals("reviewer-a", audit.subjectId());
    assertEquals("CASE-001", audit.resourceId());
    assertEquals("ALLOW", audit.outcome());
    assertNotNull(audit.policyVersion());
    assertNotNull(audit.correlationId());
}
```

### 22.2 Deny Audit

```java
@Test
void deniedSensitiveActionMustWriteDenyAudit() {
    assertThrows(AccessDeniedException.class, () ->
            caseService.approve("CASE-OWN", auth("reviewer-a"))
    );

    AuthorizationAudit audit = auditRepository.findLatest("CASE-OWN", "case.approve");

    assertEquals("DENY", audit.outcome());
    assertEquals("MAKER_CHECKER_VIOLATION", audit.reasonCode());
}
```

Tidak semua deny harus diaudit detail, tetapi sensitive action denial biasanya perlu.

---

## 23. Testing Authorization Cache and Revocation

Authorization cache bisa membuat test happy path lulus tetapi security salah.

### 23.1 Permission Revocation Test

```java
@Test
void revokedPermissionMustTakeEffectAfterInvalidation() {
    Subject subject = subject("user-a", "tenant-a", "case.approve");
    CaseResource resource = approvableCase("tenant-a");

    assertAllowed(policy.decide(subject, CASE_APPROVE, resource, context()));

    permissionService.revoke("user-a", "case.approve");
    authorizationCache.invalidateSubject("user-a");

    Subject refreshed = subjectResolver.resolve("user-a");
    assertDenied(policy.decide(refreshed, CASE_APPROVE, resource, context()));
}
```

### 23.2 Cache Key Test

```java
@Test
void decisionCacheKeyMustIncludeResourceState() {
    CaseResource draft = caseResource("C1", "tenant-a", "DRAFT");
    CaseResource approved = caseResource("C1", "tenant-a", "APPROVED");
    Subject officer = subject("officer-a", "tenant-a", "case.update");

    assertAllowed(policy.decide(officer, CASE_UPDATE, draft, context()));
    assertDenied(policy.decide(officer, CASE_UPDATE, approved, context()));
}
```

Jika cache key hanya `subject+action+resourceId`, second decision bisa salah allow.

---

## 24. Testing Temporal and Contextual Authorization

Time-based rule harus diuji dengan injected clock, bukan `Instant.now()` langsung.

### 24.1 Expired Delegation Test

```java
@Test
void expiredDelegationMustBeDenied() {
    Clock fixedClock = Clock.fixed(Instant.parse("2026-06-19T10:00:00Z"), ZoneOffset.UTC);
    Delegation delegation = delegation("manager-a", "officer-b")
            .validUntil(Instant.parse("2026-06-18T10:00:00Z"));

    AuthorizationDecision decision = delegationPolicy.decide(
            actingSubject("officer-b", delegation),
            CASE_APPROVE,
            caseResource("C1"),
            contextWithClock(fixedClock)
    );

    assertDenied(decision, "DELEGATION_EXPIRED");
}
```

### 24.2 MFA / Step-Up Test

```java
@Test
void highRiskActionRequiresFreshMfa() {
    AuthorizationContext ctx = context()
            .withMfaSatisfied(false)
            .withRiskLevel("HIGH");

    AuthorizationDecision decision = policy.decide(
            subject("admin-a", "tenant-a", "user.delete"),
            USER_DELETE,
            userResource("target-user"),
            ctx
    );

    assertDenied(decision, "MFA_REQUIRED");
}
```

---

## 25. Testing Delegation, Impersonation, and Break-Glass

Special authority harus diuji lebih keras daripada normal authority.

### 25.1 Impersonation Must Be Visible and Audited

```java
@Test
void impersonatedActionMustRecordActorAndEffectiveSubject() {
    AuthContext ctx = impersonationContext(
            actor("support-a"),
            effectiveUser("customer-x"),
            ticket("SUP-123")
    );

    caseService.viewCase("CASE-001", ctx);

    AuthorizationAudit audit = auditRepository.findLatest("CASE-001", "case.read");
    assertEquals("support-a", audit.actorId());
    assertEquals("customer-x", audit.effectiveSubjectId());
    assertEquals("SUP-123", audit.justificationRef());
}
```

### 25.2 Break-Glass Requires Justification

```java
@Test
void breakGlassWithoutJustificationMustBeDenied() {
    AuthContext ctx = breakGlassContext("admin-a", null);

    assertThrows(AccessDeniedException.class, () ->
            patientOrCaseService.viewRestrictedRecord("R-001", ctx)
    );
}
```

### 25.3 Break-Glass Must Not Grant Everything

```java
@Test
void breakGlassMustBeScopedToDeclaredResourceAndAction() {
    AuthContext ctx = breakGlassContext("admin-a", "INC-001")
            .scope("case.read", "CASE-001");

    assertDoesNotThrow(() -> caseService.viewCase("CASE-001", ctx));
    assertThrows(AccessDeniedException.class, () -> caseService.deleteCase("CASE-001", ctx));
    assertThrows(AccessDeniedException.class, () -> caseService.viewCase("CASE-002", ctx));
}
```

---

## 26. Testing Policy Change Safely

Authorization changes are dangerous because they can silently expand access.

Use decision diffing.

### 26.1 Old vs New Policy Test

```java
@Test
void newPolicyMustNotUnexpectedlyExpandAccess() {
    List<AuthorizationScenario> scenarios = scenarioRepository.loadRegressionPack();

    for (AuthorizationScenario scenario : scenarios) {
        Decision oldDecision = oldPolicy.decide(scenario);
        Decision newDecision = newPolicy.decide(scenario);

        if (oldDecision.isDenied() && newDecision.isAllowed()) {
            assertTrue(
                scenario.isApprovedExpansion(),
                "Unexpected access expansion: " + scenario.id()
            );
        }
    }
}
```

This is powerful for migration:

```text
hardcoded role checks -> policy service
Spring annotation -> AuthorizationManager
ACL -> ReBAC
local policy -> external PDP
```

### 26.2 Shadow Mode Test

In production-like integration test:

```text
actual enforcement: old policy
shadow decision: new policy
log diff: old deny/new allow or old allow/new deny
```

Test that diff logging works and contains enough context.

---

## 27. CI Gate for Authorization

Authorization test should block merge.

Minimum CI gate:

```text
- unit policy tests pass,
- method/request security tests pass,
- object-level tests pass,
- tenant isolation tests pass,
- workflow transition matrix pass,
- export/report tests pass,
- policy engine tests pass,
- audit tests pass for sensitive actions,
- mutation threshold for authz package meets minimum,
- no new unreviewed permission strings,
- no public endpoint drift,
- no unexpected policy decision expansion.
```

### 27.1 Detect Unreviewed Permission Strings

A simple build check can scan for permission literals:

```text
case.read
case.update
case.approve
```

Then compare against permission registry.

Pseudo check:

```java
@Test
void allPermissionConstantsMustBeRegistered() {
    Set<String> literals = PermissionLiteralScanner.scan("src/main/java");
    Set<String> registered = permissionRegistry.allPermissionNames();

    assertThat(registered).containsAll(literals);
}
```

Better: avoid raw strings and use typed constants/value objects.

### 27.2 Public Endpoint Drift Test

```java
@Test
void allPublicEndpointsMustBeExplicitlyDeclared() {
    Set<String> actualPublicEndpoints = securityIntrospector.findPermitAllEndpoints();
    Set<String> approvedPublicEndpoints = approvedPublicEndpointRegistry.load();

    assertEquals(approvedPublicEndpoints, actualPublicEndpoints);
}
```

This prevents accidental `.permitAll()` expansion.

---

## 28. Static Analysis and Code Review Heuristics

Automated tests are necessary but not enough.

Review heuristics:

```text
- Does this endpoint accept resource ID? Where is object-level authorization?
- Does this query include tenant/scope predicate?
- Does this export reuse same scope as UI search?
- Does this bulk operation authorize every item?
- Does this async job have actor/context?
- Does this cache key include tenant/context/resource state?
- Does this method security rely on self-invocation?
- Does this code trust tenantId/userId/role from request body?
- Does this code trust JWT claim as final authorization?
- Does denial occur before mutation/event/email?
- Does sensitive allow/deny produce audit?
```

### 28.1 Dangerous Code Smells

```java
if (user.isAdmin()) { ... }
```

```java
repository.findById(id)
```

without scope.

```java
repository.findAll()
```

inside user-facing service.

```java
command.getTenantId()
```

trusted from client.

```java
@PreAuthorize("hasRole('ADMIN')")
```

with no object-level check for object mutation.

```java
List<Result> results = repository.search(criteria);
return results.stream().filter(policy::canView).collect(toList());
```

filter-after-fetch for paginated/exportable data.

---

## 29. Authorization Test Naming Convention

Good test names encode invariant.

Bad:

```java
@Test
void testApprove() {}
```

Better:

```java
@Test
void reviewerCanApproveSubmittedCaseWhenNotSubmitter() {}
```

Best:

```java
@Test
void reviewerCannotApproveOwnSubmittedCaseEvenWithApprovePermission() {}
```

Strong names include:

```text
subject + cannot/can + action + resource + condition
```

Examples:

```text
officerCannotViewCaseFromAnotherTenantEvenWithCaseReadPermission
supportUserCannotImpersonateWithoutApprovedTicket
expiredDelegationCannotApproveCase
bulkApproveMustDenyEntireRequestWhenAnyItemUnauthorized
exportMustUseSameScopeAsSearch
caseUpdateDeniedAfterReassignmentEvenIfPrecheckWasAllowed
```

---

## 30. Example: Complete Authorization Test Slice

Domain rule:

```text
A reviewer may approve a submitted case only if:
- reviewer has case.approve,
- case belongs to same tenant,
- case is in SUBMITTED state,
- reviewer is not the submitter,
- reviewer is not suspended,
- no high-risk context requiring fresh MFA unless MFA satisfied.
```

### 30.1 Policy Unit Test

```java
@Test
void reviewerCanApproveSubmittedCaseWhenAllConditionsSatisfied() {
    Subject reviewer = subject("reviewer-a", "T1", "case.approve");
    CaseResource caze = submittedCase("C1", "T1", submittedBy("officer-a"));
    AuthorizationContext ctx = context().mfaSatisfied(true).risk("LOW");

    AuthorizationDecision decision = policy.decide(reviewer, CASE_APPROVE, caze, ctx);

    assertAllowed(decision, "APPROVE_ALLOWED");
}
```

### 30.2 Missing Permission

```java
@Test
void reviewerWithoutApprovePermissionCannotApprove() {
    Subject reviewer = subject("reviewer-a", "T1", "case.read");
    CaseResource caze = submittedCase("C1", "T1", submittedBy("officer-a"));

    assertDenied(policy.decide(reviewer, CASE_APPROVE, caze, context()), "MISSING_PERMISSION");
}
```

### 30.3 Cross Tenant

```java
@Test
void reviewerCannotApproveCaseFromAnotherTenant() {
    Subject reviewer = subject("reviewer-a", "T1", "case.approve");
    CaseResource caze = submittedCase("C1", "T2", submittedBy("officer-b"));

    assertDenied(policy.decide(reviewer, CASE_APPROVE, caze, context()), "TENANT_MISMATCH");
}
```

### 30.4 Wrong State

```java
@Test
void reviewerCannotApproveDraftCase() {
    Subject reviewer = subject("reviewer-a", "T1", "case.approve");
    CaseResource caze = draftCase("C1", "T1", submittedBy(null));

    assertDenied(policy.decide(reviewer, CASE_APPROVE, caze, context()), "INVALID_STATE");
}
```

### 30.5 Maker-Checker Violation

```java
@Test
void reviewerCannotApproveOwnSubmission() {
    Subject reviewer = subject("reviewer-a", "T1", "case.approve");
    CaseResource caze = submittedCase("C1", "T1", submittedBy("reviewer-a"));

    assertDenied(policy.decide(reviewer, CASE_APPROVE, caze, context()), "MAKER_CHECKER_VIOLATION");
}
```

### 30.6 Suspended User

```java
@Test
void suspendedReviewerCannotApproveEvenWithPermission() {
    Subject reviewer = subject("reviewer-a", "T1", "case.approve").suspended(true);
    CaseResource caze = submittedCase("C1", "T1", submittedBy("officer-a"));

    assertDenied(policy.decide(reviewer, CASE_APPROVE, caze, context()), "SUBJECT_SUSPENDED");
}
```

### 30.7 Step-Up Required

```java
@Test
void highRiskApprovalRequiresFreshMfa() {
    Subject reviewer = subject("reviewer-a", "T1", "case.approve");
    CaseResource caze = submittedCase("C1", "T1", submittedBy("officer-a"));
    AuthorizationContext ctx = context().risk("HIGH").mfaSatisfied(false);

    assertDenied(policy.decide(reviewer, CASE_APPROVE, caze, ctx), "MFA_REQUIRED");
}
```

### 30.8 Service Integration Test

```java
@Test
void deniedApprovalMustNotMutateCaseOrPublishEvent() {
    String caseId = givenSubmittedCase("T1", submittedBy("reviewer-a"));

    assertThrows(AccessDeniedException.class, () ->
            caseService.approve(caseId, auth("reviewer-a", "T1", "case.approve"))
    );

    assertEquals(SUBMITTED, caseRepository.getStatus(caseId));
    assertFalse(eventPublisher.hasEvent("CaseApproved", caseId));
    assertDenyAudit(caseId, "reviewer-a", "MAKER_CHECKER_VIOLATION");
}
```

This is the minimum shape of a serious authorization test suite.

---

## 31. Java 8–25 Considerations

Authorization testing concepts are stable across Java 8–25, but implementation ergonomics differ.

### 31.1 Java 8

Use:

```text
- JUnit 4 or JUnit 5 if project supports it,
- explicit classes instead of records,
- Collections.unmodifiableSet,
- builders for test data,
- no sealed hierarchy,
- no pattern matching.
```

### 31.2 Java 11/17

Better baseline:

```text
- JUnit 5 common,
- var in local tests if desired,
- records in Java 16+,
- text blocks in Java 15+ for GraphQL/JSON SQL test fixtures,
- stronger HTTP client if needed.
```

### 31.3 Java 21/25

Useful for test ergonomics and performance:

```text
- records for scenarios,
- sealed interfaces for Decision types,
- pattern matching for decision assertions,
- virtual threads for high-concurrency integration tests if appropriate,
- structured concurrency concepts for test harnesses where available,
- better observability/runtime profiling.
```

But do not confuse modern Java syntax with stronger authorization assurance.

A Java 8 system with rigorous invariant tests is safer than a Java 25 system with shallow role happy-path tests.

---

## 32. Production Authorization Test Checklist

Use this checklist before releasing authorization-sensitive changes.

### 32.1 Policy Correctness

```text
[ ] Allow cases tested.
[ ] Deny cases tested.
[ ] Missing permission tested.
[ ] Deny override tested.
[ ] Conflict resolution tested.
[ ] Decision reason tested.
[ ] Policy version tested if applicable.
```

### 32.2 Object and Tenant Boundary

```text
[ ] Detail endpoint object-level authorization tested.
[ ] List/search query scope tested.
[ ] Count/aggregation leakage tested.
[ ] Export/report scope tested.
[ ] Download/file access tested.
[ ] Cross-tenant access denied.
[ ] Cache key tenant/context isolation tested.
```

### 32.3 Workflow

```text
[ ] State transition matrix tested.
[ ] Invalid state denied.
[ ] Maker-checker tested.
[ ] Assignment/reassignment tested.
[ ] Escalation tested.
[ ] Override/break-glass tested.
[ ] Denied transition has no side effect.
```

### 32.4 Spring/Jakarta Enforcement

```text
[ ] Request security matcher order tested.
[ ] Method security active tested.
[ ] Self-invocation bypass considered.
[ ] Role prefix behavior tested.
[ ] Public endpoint registry tested.
[ ] Exception mapping tested.
```

### 32.5 Distributed/Async

```text
[ ] Service-to-service authorization tested.
[ ] Message consumer authorization tested.
[ ] Scheduled/batch job context tested.
[ ] External PDP failure tested.
[ ] Revocation delay tested.
[ ] Cache invalidation tested.
```

### 32.6 Audit and Defensibility

```text
[ ] Sensitive allow audit tested.
[ ] Sensitive deny audit tested.
[ ] Actor/effective subject tested.
[ ] Delegation/impersonation justification tested.
[ ] Correlation ID tested.
[ ] No sensitive data in user-facing denial tested.
```

---

## 33. Common Anti-Patterns in Authorization Testing

### 33.1 Only Testing Admin

If all tests use admin, you are not testing authorization. You are testing bypass.

### 33.2 Only Testing Happy Path

Authorization bugs live in negative cases.

### 33.3 Only Testing Endpoint Status

`403` alone does not prove no mutation, no event, no audit error, no leakage.

### 33.4 Only Testing UI

UI authorization is not enforcement.

### 33.5 Reusing One Tenant Test Data

Single-tenant test data cannot catch tenant leakage.

### 33.6 Mocking the Policy in Integration Tests

If endpoint integration test mocks `policy.canView()` to true, it does not test authorization. It only tests wiring.

Mock policy only in tests that intentionally isolate another component.

### 33.7 Testing Implementation Instead of Invariant

Test the rule, not the annotation string.

### 33.8 No Regression Pack for Policy Changes

Authorization policy changes without golden tests are risky.

---

## 34. Top 1% Insight

A top-tier engineer treats authorization testing like testing a distributed safety system.

They know authorization is not one function. It is a mesh of:

```text
identity evidence,
role/permission resolution,
resource attributes,
tenant boundary,
workflow state,
relationship graph,
policy decision,
query scoping,
cache semantics,
failure behavior,
audit evidence,
and operational change control.
```

Therefore the test strategy must not be random.

The key shift is:

> Do not test authorization by checking whether code paths work.  
> Test it by proving that forbidden states are unreachable.

In mature systems, authorization tests become executable governance:

```text
- permission matrix is policy documentation,
- golden decision tests are regression guard,
- property tests encode invariants,
- mutation tests prove checks matter,
- audit tests prove defensibility,
- policy diff tests prevent silent privilege expansion.
```

If a system cannot answer “which test fails if this check is removed?”, its authorization posture is not yet mature.

---

## 35. Practical Assignment

Untuk memperkuat pemahaman, lakukan latihan berikut pada sistem Java apa pun.

### Assignment 1 — Build Permission Matrix

Pilih satu module, misalnya Case Management.

Buat matrix:

```text
subject, action, resource, context, expected, reason
```

Minimal 30 row.

Harus mencakup:

```text
- allow,
- missing permission deny,
- cross tenant deny,
- object ownership deny,
- wrong state deny,
- maker-checker deny,
- expired delegation deny,
- export/download path.
```

### Assignment 2 — Convert Matrix to Parameterized Test

Jadikan CSV/JSON sebagai input test.

Pastikan test memanggil policy/domain service, bukan hanya controller.

### Assignment 3 — Add One Integration Test Per Access Path

Minimal:

```text
- detail endpoint,
- search/list endpoint,
- export endpoint,
- mutation endpoint,
- async/message/job path if exists.
```

### Assignment 4 — Mutation Challenge

Secara lokal, hapus salah satu check:

```text
- tenant check,
- assignment check,
- state check,
- maker-checker check.
```

Pastikan test gagal.

Jika tidak gagal, tambahkan test sampai gagal.

### Assignment 5 — Audit Test

Untuk action sensitif, tambahkan test bahwa allow dan deny sama-sama mencatat audit yang cukup.

---

## 36. Referensi

Referensi berikut relevan untuk memperdalam materi:

1. Spring Security Reference — Testing Method Security.
2. Spring Security Reference — Testing support.
3. Spring Security Reference — Authorization architecture and `AuthorizationManager`.
4. OWASP Authorization Cheat Sheet.
5. OWASP Web Security Testing Guide — Authorization Testing.
6. OWASP API Security Top 10 2023 — Broken Object Level Authorization.
7. OWASP Logging Cheat Sheet.
8. Open Policy Agent Documentation — Policy Testing.
9. PIT Mutation Testing for Java.
10. jqwik property-based testing for Java.
11. NIST RBAC resources for role hierarchy and separation of duty concepts.
12. PostgreSQL Row Security Policies for database-level scoping tests.
13. Spring Data JPA Specifications for query predicate testing.

---

## 37. Ringkasan

Authorization testing harus menjawab lebih dari “apakah endpoint mengembalikan 403”.

Ia harus membuktikan:

```text
- subject hanya bisa melakukan action yang benar,
- terhadap resource yang benar,
- dalam tenant/scope yang benar,
- pada state/context yang benar,
- lewat semua access path yang tersedia,
- tanpa side effect saat deny,
- dengan audit/explainability yang cukup,
- dan tetap benar setelah refactor/policy change/cache/distributed failure.
```

Part ini bukan bagian terakhir.

Part berikutnya:

> **Part 29 — Authorization Anti-Patterns and Failure Modes**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-027.md">⬅️ Java Authorization Modes and Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-029.md">Part 29 — Authorization Anti-Patterns and Failure Modes ➡️</a>
</div>
