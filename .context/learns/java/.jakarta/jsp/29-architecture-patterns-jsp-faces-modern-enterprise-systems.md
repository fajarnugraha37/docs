# Part 29 — Architecture Patterns: JSP/Faces in Modern Enterprise Systems

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `29-architecture-patterns-jsp-faces-modern-enterprise-systems.md`  
> Fokus: pola arsitektur untuk memakai JSP/Jakarta Pages dan Jakarta Faces secara waras di sistem enterprise modern  
> Target Java: Java 8 sampai Java 25  
> Target stack historis-modern: Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 1. Tujuan Bagian Ini

Bagian-bagian sebelumnya sudah membahas banyak detail teknis:

- JSP/Jakarta Pages lifecycle.
- EL resolver.
- JSTL/core tags.
- custom tags.
- layouting.
- security JSP.
- performance JSP.
- testing JSP.
- Jakarta Faces lifecycle.
- Facelets.
- CDI scope.
- conversion/validation.
- navigation.
- state management.
- Ajax.
- composite/custom components.
- Faces security.
- Faces performance.
- ecosystem library.
- migration.

Bagian ini mengikat semuanya ke pertanyaan arsitektur:

> Kalau saya membangun atau memodernisasi sistem enterprise nyata, di mana JSP/Faces ditempatkan? Bagaimana boundary-nya? Apa pattern yang membuatnya maintainable, secure, testable, dan scalable?

Materi ini bukan lagi tentang “tag apa yang dipakai”. Materi ini tentang **bagaimana memodelkan server-side UI sebagai bagian dari sistem enterprise**.

---

## 2. Premis Dasar: JSP dan Faces Bukan Layer Domain

Kesalahan terbesar dalam sistem JSP/Faces lama adalah memperlakukan halaman sebagai tempat semua hal terjadi:

```text
Browser
  -> JSP/Faces page
       -> query database
       -> cek role
       -> hitung workflow
       -> mutate entity
       -> render HTML
```

Ini mudah dibuat, tetapi sulit dipertahankan.

Arsitektur yang lebih sehat:

```text
Browser
  -> Web UI Layer
       -> Controller / Backing Bean
            -> Application Service
                 -> Domain / Workflow / Policy
                      -> Repository / External Gateway
       -> View Model
       -> Rendered HTML
```

JSP dan Faces sebaiknya dipahami sebagai **rendering and interaction layer**, bukan sebagai pusat business logic.

---

## 3. Mental Model Enterprise Server-Side UI

Server-side UI enterprise biasanya harus mengelola beberapa hal sekaligus:

1. Identity user.
2. Role dan permission.
3. Data display.
4. Form input.
5. Validation.
6. Workflow action.
7. Navigation.
8. Error message.
9. Auditability.
10. State antar request.
11. Multi-tab behavior.
12. Session timeout.
13. Concurrent update.
14. Security rendering.
15. Accessibility.
16. Localization.
17. Performance.
18. Observability.

Di SPA, sebagian besar UI state hidup di browser.

Di JSP/Faces, sebagian besar UI decision masih terjadi di server.

Maka boundary utamanya:

```text
Server decides:
  - what page is allowed
  - what data is visible
  - what actions are possible
  - what validation applies
  - what workflow transition is legal
  - what error/message is shown

Browser receives:
  - rendered HTML
  - JS/CSS assets
  - form fields
  - view state / CSRF token
  - links/buttons/actions
```

Konsekuensinya: desain server-side UI harus sangat jelas tentang **authority**.

---

## 4. JSP vs Faces dari Sudut Arsitektur

### 4.1 JSP/Jakarta Pages

Jakarta Pages/JSP adalah template engine yang mencampur textual content, custom tags, expression language, dan embedded Java code, lalu dikompilasi menjadi Jakarta Servlet.

Secara arsitektur, JSP cocok jika model interaksinya:

- request-response sederhana,
- controller eksplisit,
- HTML cukup langsung,
- state antar request minimal,
- custom tag cukup untuk reuse,
- form handling tidak terlalu kompleks,
- ingin kontrol besar atas markup.

Pattern umum:

```text
HTTP Request
  -> Servlet / MVC Controller
       -> Application Service
       -> View Model
       -> forward to JSP
  -> JSP + EL + JSTL + custom tags
  -> HTML Response
```

### 4.2 Jakarta Faces

Jakarta Faces adalah server-side component framework untuk membangun UI web berbasis Java dengan component tree, state management, event handling, validation, navigation, internationalization, dan accessibility.

Faces cocok jika model interaksinya:

- form-heavy,
- component-heavy,
- banyak validation/conversion,
- Ajax partial rendering,
- reusable UI component library,
- workflow screen yang stateful,
- tim nyaman dengan lifecycle component.

Pattern umum:

```text
HTTP Request / Postback
  -> FacesServlet
       -> restore component tree
       -> decode input
       -> convert/validate
       -> update model
       -> invoke action
       -> render component tree
  -> HTML + View State Response
```

### 4.3 Perbandingan Ringkas

| Aspek | JSP/Jakarta Pages | Jakarta Faces |
|---|---|---|
| Model utama | Template request-response | Component-based MVC |
| State view | Minimal/manual | Built-in view state |
| Controller | Eksplisit | Faces lifecycle + backing bean |
| Reuse UI | tag files/custom tags | composite/custom components |
| Validation | manual/controller/Jakarta Validation | lifecycle-integrated |
| Ajax | manual JavaScript/fetch | partial lifecycle built-in |
| Debuggability | relatif linear | perlu pahami phase lifecycle |
| Risiko utama | scriptlet/view logic leak | state bloat/lifecycle confusion |
| Cocok untuk | CRUD sederhana, server-rendered pages | form-heavy enterprise screens |

---

## 5. Pattern 1 — Classic MVC dengan Servlet + JSP

Ini pattern paling mudah dijelaskan dan paling cocok untuk banyak sistem legacy.

```text
[Browser]
    |
    v
[Servlet / Front Controller]
    |
    +--> parse request
    +--> authorize
    +--> call service
    +--> build view model
    +--> set request attributes
    v
[JSP]
    |
    +--> EL/JSTL/custom tags
    v
[HTML]
```

### 5.1 Struktur Folder Contoh

```text
src/main/java/com/example/caseui/
  web/
    CaseListServlet.java
    CaseDetailServlet.java
    CaseActionServlet.java
  service/
    CaseQueryService.java
    CaseCommandService.java
  viewmodel/
    CaseListPage.java
    CaseDetailPage.java
    CaseActionForm.java
  security/
    PermissionService.java

src/main/webapp/WEB-INF/views/
  layout/
    main.jsp
  case/
    list.jsp
    detail.jsp
    action-confirm.jsp
  tags/
    statusBadge.tag
    permissionedAction.tag
```

### 5.2 Controller Harus Menghasilkan View Model

Buruk:

```java
request.setAttribute("case", entityManager.find(CaseEntity.class, id));
```

Lebih baik:

```java
CaseDetailPage page = caseQueryService.getCaseDetailPage(caseId, currentUser);
request.setAttribute("page", page);
request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp").forward(request, response);
```

Kenapa?

Karena JSP tidak perlu tahu:

- entity relationship,
- lazy loading,
- permission rules,
- workflow transition rules,
- audit classification,
- internal persistence structure.

JSP hanya tahu `page`.

---

## 6. Pattern 2 — Front Controller + Command Handler + JSP

Untuk sistem enterprise dengan banyak action, controller per halaman bisa cepat membengkak.

Gunakan command/action handler.

```text
POST /case/action
  -> CaseActionServlet
       -> resolve action = APPROVE / REJECT / ESCALATE
       -> command handler
       -> service
       -> redirect / render error
```

Contoh:

```java
public interface CaseCommandHandler {
    String actionCode();
    CommandResult handle(CaseCommand command, CurrentUser user);
}
```

```java
public final class ApproveCaseHandler implements CaseCommandHandler {
    private final CaseWorkflowService workflowService;

    @Override
    public String actionCode() {
        return "APPROVE";
    }

    @Override
    public CommandResult handle(CaseCommand command, CurrentUser user) {
        return workflowService.approve(command.caseId(), command.reason(), user);
    }
}
```

JSP hanya render tombol:

```jsp
<c:forEach items="${page.availableActions}" var="action">
  <button name="action" value="${action.code}">
    <c:out value="${action.label}" />
  </button>
</c:forEach>
```

Tetapi server tetap enforce action saat POST.

---

## 7. Pattern 3 — Faces + CDI Backing Bean + Application Service

Dalam Faces, backing bean sering tergoda menjadi “god object”. Hindari itu.

```text
Facelets View
   -> Backing Bean
        -> Application Service
             -> Domain / Repository
   -> View Model / Form Model
```

Contoh struktur:

```text
src/main/java/com/example/caseui/
  faces/
    CaseDetailBean.java
    CaseSearchBean.java
    CaseActionDialogBean.java
  service/
    CaseQueryService.java
    CaseWorkflowService.java
  viewmodel/
    CaseDetailVm.java
    CaseActionVm.java
    CaseSearchCriteria.java
```

Backing bean yang sehat:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {
    private Long caseId;
    private CaseDetailVm page;
    private CaseActionVm actionForm = new CaseActionVm();

    @Inject
    private CaseQueryService queryService;

    @Inject
    private CaseWorkflowService workflowService;

    @Inject
    private CurrentUser currentUser;

    public void load() {
        page = queryService.getDetail(caseId, currentUser);
    }

    public String submitAction(String actionCode) {
        CommandResult result = workflowService.execute(caseId, actionCode, actionForm, currentUser);

        if (!result.success()) {
            FacesMessages.error(result.message());
            return null;
        }

        FacesMessages.info("Action submitted successfully.");
        return "/case/detail.xhtml?faces-redirect=true&amp;caseId=" + caseId;
    }

    // getters/setters
}
```

Yang harus dihindari:

```java
@Named
@ViewScoped
public class CaseDetailBean {
    @PersistenceContext
    EntityManager em;

    public void approve() {
        CaseEntity c = em.find(CaseEntity.class, caseId);
        c.setStatus("APPROVED");
        c.setApprovedBy(userNameFromSession());
        c.setApprovedAt(LocalDateTime.now());
    }
}
```

Masalahnya:

- business rule tersebar di UI bean,
- sulit dites,
- audit logic rawan terlewat,
- permission enforcement tidak reusable,
- transaction boundary kabur,
- optimistic locking sering kacau.

---

## 8. Pattern 4 — View Model Pattern

View model adalah object yang sengaja dibuat untuk kebutuhan rendering.

Domain model menjawab:

> Apa kebenaran bisnis sistem?

View model menjawab:

> Apa yang perlu ditampilkan user di layar ini?

Contoh domain:

```java
public class CaseFile {
    private CaseId id;
    private CaseStatus status;
    private Officer assignedOfficer;
    private List<WorkflowTransition> allowedTransitions;
    private List<Document> documents;
}
```

Contoh view model:

```java
public record CaseDetailPage(
    String caseNo,
    String statusLabel,
    String statusCssClass,
    String applicantName,
    String assignedOfficerName,
    List<ActionButtonVm> availableActions,
    List<DocumentRowVm> documents,
    boolean canUploadDocument,
    boolean showSensitiveSection,
    String lastUpdatedDisplay
) {}
```

View model boleh punya field seperti:

- `displayName`,
- `statusLabel`,
- `cssClass`,
- `canEdit`,
- `canApprove`,
- `formattedDate`,
- `maskedIdentifier`,
- `downloadUrl`,
- `breadcrumb`,
- `flashMessage`,
- `tableRows`.

Ini bukan domain pollution. Ini justru separation of concerns.

---

## 9. Pattern 5 — Form Model / Command Model

Jangan bind form langsung ke entity.

Buruk:

```xhtml
<h:inputText value="#{caseBean.caseEntity.applicant.email}" />
```

Lebih baik:

```java
public class ApplicantUpdateForm implements Serializable {
    @NotBlank
    private String email;

    @NotBlank
    private String phone;

    private long version;

    // getters/setters
}
```

```xhtml
<h:inputText value="#{caseBean.updateForm.email}" />
<h:inputText value="#{caseBean.updateForm.phone}" />
<h:inputHidden value="#{caseBean.updateForm.version}" />
```

Lalu service memproses command:

```java
public UpdateResult updateApplicant(CaseId caseId, ApplicantUpdateForm form, CurrentUser user) {
    permissionService.require(user, Permission.UPDATE_APPLICANT, caseId);
    CaseFile caseFile = repository.getForUpdate(caseId);
    caseFile.updateApplicantContact(form.email(), form.phone(), form.version(), user);
    audit.recordApplicantUpdated(caseId, user);
    return UpdateResult.success();
}
```

Keuntungan:

- input boundary jelas,
- validation lebih mudah,
- hidden field tampering bisa dicek,
- optimistic locking eksplisit,
- entity tidak bocor ke view,
- audit bisa konsisten.

---

## 10. Pattern 6 — Authorization-Aware UI, Enforcement Tetap di Service

Server-side UI sering perlu menyembunyikan tombol yang tidak relevan.

Tetapi:

> Menyembunyikan tombol bukan authorization.

Arsitektur yang benar:

```text
PermissionService
   -> dipakai query side untuk membuat availableActions
   -> dipakai command side untuk enforce action
```

### 10.1 Query Side

```java
List<ActionButtonVm> actions = workflowPolicy.availableActions(caseFile, currentUser)
    .stream()
    .map(ActionButtonVm::from)
    .toList();
```

### 10.2 View Side

```jsp
<c:forEach items="${page.availableActions}" var="action">
  <button type="submit" name="action" value="${action.code}">
    <c:out value="${action.label}" />
  </button>
</c:forEach>
```

### 10.3 Command Side

```java
workflowPolicy.requireAllowed(caseFile, actionCode, currentUser);
```

Dengan pola ini:

- UI tetap user-friendly,
- backend tetap secure,
- permission tidak duplikatif,
- audit bisa menjelaskan kenapa action boleh/tidak.

---

## 11. Pattern 7 — Workflow-Aware UI

Enterprise systems sering bukan CRUD sederhana. Mereka punya lifecycle:

```text
DRAFT
  -> SUBMITTED
  -> SCREENING
  -> REVIEW
  -> APPROVED
  -> REJECTED
  -> APPEALED
  -> CLOSED
```

UI harus merepresentasikan workflow, bukan hard-code status.

Buruk:

```jsp
<c:if test="${case.status == 'REVIEW'}">
  <button>Approve</button>
</c:if>
```

Lebih baik:

```java
public record WorkflowActionVm(
    String code,
    String label,
    String confirmationMessage,
    boolean requiresComment,
    boolean destructive,
    String targetStatusLabel
) {}
```

View:

```jsp
<c:forEach items="${page.workflowActions}" var="action">
  <button name="action" value="${action.code}">
    <c:out value="${action.label}" />
  </button>
</c:forEach>
```

Keuntungan:

- perubahan workflow tidak memaksa banyak JSP berubah,
- role/status/action rules terkonsolidasi,
- audit lebih mudah,
- testing bisa fokus ke workflow policy.

---

## 12. Pattern 8 — Error Handling Architecture

UI enterprise perlu membedakan jenis error.

| Jenis Error | Contoh | Respons UI |
|---|---|---|
| Validation error | field kosong, format salah | tetap di halaman, tampilkan pesan per field |
| Business rule error | case sudah closed | tampilkan message, tidak mutate state |
| Authorization error | user tidak boleh approve | 403 atau halaman error secure |
| Concurrency error | version conflict | tampilkan halaman refresh/compare |
| System error | DB down | error page generic + correlation id |
| Integration error | external API timeout | pesan retry/temporary unavailable |

Jangan render stack trace ke JSP/Faces page.

Pattern:

```text
Exception
  -> mapped to ErrorDescriptor
       -> user message
       -> severity
       -> correlation id
       -> audit/security classification
       -> target view
```

Contoh view model:

```java
public record ErrorPageVm(
    String title,
    String userMessage,
    String correlationId,
    boolean retryable,
    String supportInstruction
) {}
```

Error page:

```jsp
<h1><c:out value="${error.title}" /></h1>
<p><c:out value="${error.userMessage}" /></p>
<p>Reference ID: <c:out value="${error.correlationId}" /></p>
```

---

## 13. Pattern 9 — Audit-Aware UI

Untuk domain regulatory, audit bukan fitur tambahan. Audit adalah bagian dari defensibility.

UI perlu menjawab:

1. Siapa melakukan apa?
2. Kapan?
3. Dari layar/action mana?
4. Terhadap entity apa?
5. Sebelum/sesudah state apa?
6. Apakah action berhasil atau gagal?
7. Kalau gagal, kenapa?
8. Apakah user melihat data sensitif?
9. Apakah user mencoba action tidak authorized?

### 13.1 Correlation ID di UI

Setiap request penting harus membawa correlation id.

```text
HTTP Request
  -> correlation id filter
  -> service
  -> audit event
  -> log
  -> error page
```

Di error page:

```text
Reference ID: ABC-2026-000123
```

Ini membantu support tanpa membocorkan stack trace.

### 13.2 Audit di Command Boundary

Jangan audit dari JSP.

Jangan audit hanya dari backing bean.

Audit di application service/command handler.

```java
public CommandResult approve(CaseId caseId, CurrentUser user, String reason) {
    CaseFile caseFile = repository.getForUpdate(caseId);
    permission.requireApprove(user, caseFile);

    CaseStatus before = caseFile.status();
    caseFile.approve(user, reason);
    repository.save(caseFile);

    audit.record(new CaseApprovedEvent(caseId, before, caseFile.status(), user, reason));
    return CommandResult.success();
}
```

UI hanya menampilkan hasil.

---

## 14. Pattern 10 — Localization and Accessibility as Architecture

Localization bukan sekadar `fmt:message` atau resource bundle.

Accessibility bukan sekadar menambahkan `alt`.

Untuk enterprise/government UI, keduanya harus menjadi standar rendering.

### 14.1 Localization Boundary

View model dapat memilih apakah field sudah formatted atau masih raw.

Dua pola:

```text
Pola A: Controller/service membuat display string.
Pola B: View menerima raw value lalu tag/component memformat sesuai locale.
```

Pola A cocok untuk:

- status label,
- business message,
- masked data,
- label yang berasal dari dictionary/domain.

Pola B cocok untuk:

- date/time,
- number,
- currency,
- simple formatting.

### 14.2 Accessibility Boundary

Reusable tags/components harus membawa accessibility defaults:

- label association,
- error message association,
- focus management,
- ARIA attributes jika benar-benar perlu,
- keyboard navigation,
- semantic HTML,
- table headers,
- visible error summary.

Contoh custom field wrapper:

```text
<app:field name="email" labelKey="applicant.email" error="${errors.email}">
  <input id="email" name="email" value="..." />
</app:field>
```

Atau composite component Faces:

```xhtml
<app:inputTextField
    id="email"
    label="#{msg['applicant.email']}"
    value="#{bean.form.email}"
    required="true" />
```

Tujuannya: aksesibilitas tidak bergantung pada kedisiplinan manual tiap halaman.

---

## 15. Pattern 11 — Search/List Page Architecture

Search/list page sering menjadi bottleneck.

Anti-pattern:

```text
- load all records
- filter in JSP/Faces
- sort in memory
- render 10,000 rows
- each row calls permission service
- each row calls lazy entity getter
```

Pattern sehat:

```text
SearchCriteria
  -> QueryService
       -> database-level filtering
       -> database-level sorting
       -> pagination
       -> projection DTO
       -> row-level action summary
  -> SearchPageVm
  -> render table
```

View model:

```java
public record CaseSearchPage(
    CaseSearchCriteria criteria,
    List<CaseRowVm> rows,
    PaginationVm pagination,
    List<SortOptionVm> sortOptions,
    boolean exportAllowed
) {}
```

Row VM:

```java
public record CaseRowVm(
    String caseNo,
    String statusLabel,
    String applicantName,
    String receivedDateDisplay,
    String assignedOfficer,
    boolean canOpen,
    boolean overdue,
    String detailUrl
) {}
```

Key rule:

> Render path tidak boleh menjadi query engine.

---

## 16. Pattern 12 — Detail Page Architecture

Detail page sering lebih kompleks daripada list page karena banyak section.

Struktur sehat:

```text
CaseDetailPage
  - header
  - summary
  - applicant section
  - workflow section
  - documents section
  - audit summary
  - available actions
  - permissions
  - messages
```

Contoh:

```java
public record CaseDetailPage(
    CaseHeaderVm header,
    CaseSummaryVm summary,
    ApplicantVm applicant,
    List<DocumentRowVm> documents,
    List<MinuteRowVm> minutes,
    List<WorkflowActionVm> actions,
    AuditSummaryVm audit,
    PageSecurityVm security
) {}
```

JSP/Faces tidak perlu tahu cara membangun section. Ia hanya render section yang sudah disiapkan.

---

## 17. Pattern 13 — Multi-Step Wizard Architecture

Wizard adalah tempat banyak sistem server-side UI rusak.

Risiko:

- data disimpan terlalu awal,
- session membengkak,
- user buka multi-tab,
- back button merusak state,
- validation lintas step kacau,
- timeout menghilangkan input,
- partial save tidak jelas,
- audit tidak jelas.

### 17.1 Opsi State Wizard

| Opsi | Kapan cocok | Risiko |
|---|---|---|
| Request-only + hidden fields | wizard pendek, data kecil | tampering, payload besar |
| Session state | wizard sedang | session bloat, multi-tab conflict |
| Draft persisted di DB | enterprise workflow | butuh cleanup dan lifecycle draft |
| Faces view scope | satu view stateful | view expiry, multi-tab issue |
| Conversation scope | flow lebih panjang | perlu disiplin start/end conversation |

### 17.2 Enterprise Recommendation

Untuk regulatory/case management:

> Simpan draft eksplisit di database jika wizard penting, panjang, atau punya konsekuensi audit.

```text
Step 1 submit
  -> validate step 1
  -> save draft section
  -> audit draft updated
  -> redirect step 2

Step final submit
  -> validate full draft
  -> create/transition domain entity
  -> mark draft submitted
  -> audit submitted
```

Jangan mengandalkan session sebagai database sementara untuk proses penting.

---

## 18. Pattern 14 — File Upload/Download Architecture

File flow harus dipisah dari view.

### 18.1 Upload Flow

```text
Browser multipart request
  -> controller/backing bean
       -> validate metadata
       -> validate file size/type/content
       -> store file via DocumentService
       -> scan if required
       -> persist document metadata
       -> audit upload
  -> redirect/detail page
```

Jangan:

- menyimpan file bytes di session,
- expose path filesystem,
- percaya content-type browser,
- menaruh authorization hanya di tombol upload.

### 18.2 Download Flow

```text
GET /document/{id}/download
  -> authorize access
  -> load metadata
  -> stream from storage
  -> set safe headers
  -> audit download if sensitive
```

Download link di JSP/Faces hanya link.

Authorization tetap di endpoint download.

---

## 19. Pattern 15 — Hybrid Architecture: JSP/Faces + REST + SPA

Banyak sistem modern tidak murni server-side atau SPA.

Contoh hybrid:

```text
Admin console       -> JSP/Faces
Public portal       -> SPA
Internal workflow   -> Faces
API integration     -> REST/JAX-RS
Reports             -> server-rendered/download
```

Ini valid jika boundary jelas.

### 19.1 Boundary yang Harus Ditetapkan

1. Siapa owner route?
2. Siapa owner session?
3. Apakah auth cookie sama?
4. Apakah CSRF strategy sama?
5. Apakah REST API dipakai browser langsung atau server-side only?
6. Apakah authorization di service shared?
7. Apakah audit event shared?
8. Apakah error semantics konsisten?
9. Apakah DTO untuk API sama dengan view model?
10. Apakah frontend boleh memutuskan action availability?

### 19.2 Jangan Samakan DTO API dan View Model

API DTO:

```java
public record CaseDto(
    String id,
    String status,
    String applicantName,
    Instant receivedAt
) {}
```

View model:

```java
public record CaseRowVm(
    String detailUrl,
    String statusLabel,
    String statusCssClass,
    String applicantDisplayName,
    String receivedDateDisplay,
    boolean overdue,
    boolean canOpen
) {}
```

Keduanya punya tujuan berbeda.

---

## 20. Pattern 16 — Backend-for-Frontend Thinking for Server-Side UI

Walaupun JSP/Faces bukan SPA, konsep BFF tetap berguna.

BFF untuk server-side UI berarti:

```text
Page query service returns exactly what one page needs.
```

Contoh:

```java
public interface CasePageQueryService {
    CaseSearchPage search(CaseSearchCriteria criteria, CurrentUser user);
    CaseDetailPage detail(CaseId id, CurrentUser user);
    CaseActionPage actionPage(CaseId id, String actionCode, CurrentUser user);
}
```

Jangan biarkan JSP/Faces menyusun page dari banyak service kecil secara acak.

Buruk:

```xhtml
#{caseBean.case.applicant.name}
#{caseBean.permissionService.canApprove(caseBean.case)}
#{caseBean.dictionaryService.label(caseBean.case.status)}
#{caseBean.auditService.lastAction(caseBean.case.id)}
```

Lebih baik:

```xhtml
#{caseBean.page.applicantName}
#{caseBean.page.canApprove}
#{caseBean.page.statusLabel}
#{caseBean.page.lastActionDisplay}
```

---

## 21. Pattern 17 — Observability-Aware UI Architecture

Server-side UI harus dapat dijelaskan saat production incident.

Minimal signals:

1. Request path.
2. User id / subject id, dengan aturan privacy.
3. Session id hash, bukan raw session id.
4. Correlation id.
5. View name.
6. Controller/backing bean action.
7. Workflow action code.
8. Entity id.
9. Validation failure count.
10. Authorization decision.
11. Render time.
12. Query time.
13. External call time.
14. Response size.
15. Error classification.

Contoh log event:

```json
{
  "event": "case_action_submitted",
  "correlationId": "REQ-2026-000123",
  "view": "case/detail",
  "caseId": "CASE-001",
  "action": "APPROVE",
  "user": "user-123",
  "decision": "ALLOWED",
  "durationMs": 184,
  "result": "SUCCESS"
}
```

Jangan log:

- password,
- token,
- full NRIC/NIK/passport,
- raw session id,
- CSRF token,
- full document content,
- hidden field sensitive value.

---

## 22. Pattern 18 — Security Architecture for Server-Side UI

Security harus berlapis.

```text
HTTP layer
  - TLS
  - secure cookies
  - SameSite
  - security headers
  - CSRF filter/framework token

Authentication layer
  - login/session/OIDC
  - identity propagation

Authorization layer
  - page access
  - entity access
  - action access
  - field/section access

View layer
  - output encoding
  - safe links
  - no secret in hidden fields
  - safe error rendering

Service layer
  - enforcement
  - audit
  - transaction boundary
```

Key invariant:

> View boleh membantu user melihat apa yang mungkin, tetapi service menentukan apa yang boleh.

---

## 23. Pattern 19 — Module Boundary untuk Aplikasi Besar

Dalam sistem besar, pisahkan UI berdasarkan bounded context/module.

```text
case-ui/
  CaseSearchBean
  CaseDetailBean
  case-list.xhtml
  case-detail.xhtml

appeal-ui/
  AppealSearchBean
  AppealDetailBean

compliance-ui/
  ComplianceInspectionBean

shared-ui/
  layout
  tags/components
  converters
  validators
  messages
```

Jangan semua halaman memakai satu `CommonBean` raksasa.

Shared UI hanya boleh berisi:

- layout,
- field wrapper,
- status badge,
- message rendering,
- pagination,
- permissioned action renderer,
- formatters,
- common validators/converters,
- error page structure.

Shared UI tidak boleh berisi business workflow spesifik banyak modul.

---

## 24. Pattern 20 — Decision Framework: JSP, Faces, SPA, atau Campuran?

### 24.1 Pakai JSP/Jakarta Pages Jika

- Halaman cukup linear.
- Interaksi mayoritas request-response.
- Tim ingin kontrol markup tinggi.
- Tidak butuh component lifecycle kompleks.
- Legacy JSP sudah besar dan ingin dimodernisasi bertahap.
- Banyak halaman admin/report sederhana.

### 24.2 Pakai Faces Jika

- Banyak form kompleks.
- Banyak conversion/validation.
- Butuh reusable server-side components.
- Ajax partial rendering cukup tanpa SPA penuh.
- Tim memahami lifecycle dan state management.
- Aplikasi internal enterprise lebih penting daripada public highly-interactive UX.

### 24.3 Pakai SPA Jika

- UX sangat interaktif.
- Offline/client-heavy state penting.
- Tim frontend kuat.
- API sudah mature.
- Banyak real-time interaction.
- UI harus sangat custom.

### 24.4 Pakai Hybrid Jika

- Ada legacy server-side UI yang masih bernilai.
- Admin/internal cukup server-side.
- Public/customer UI lebih cocok SPA.
- Migration harus bertahap.
- Domain service dan authorization bisa dishare.

---

## 25. Anti-Pattern Besar yang Harus Dihindari

### 25.1 JSP sebagai Business Layer

Gejala:

- scriptlet banyak,
- query DB dari JSP,
- permission logic di JSP,
- workflow branching di JSP,
- session mutation dari JSP.

Solusi:

- pindahkan ke controller/service,
- gunakan view model,
- gunakan custom tags hanya untuk rendering.

### 25.2 Backing Bean sebagai God Object

Gejala:

- bean ribuan baris,
- entity manager langsung di bean,
- banyak business rule,
- banyak unrelated form,
- session/view scoped terlalu besar.

Solusi:

- pecah query service,
- pecah command service,
- form model,
- view model,
- event/action handler.

### 25.3 Entity Exposure ke View

Gejala:

- lazy loading saat render,
- N+1 query dari getter,
- field sensitif muncul karena object lengkap tersedia,
- validation domain kacau.

Solusi:

- projection DTO,
- view model,
- explicit data classification.

### 25.4 Authorization by Rendering

Gejala:

- tombol disembunyikan,
- endpoint tetap menerima action,
- user bisa submit manual.

Solusi:

- enforce di service,
- use permission policy shared,
- audit denial.

### 25.5 Session sebagai Database

Gejala:

- banyak object domain di session,
- wizard panjang full session,
- memory naik,
- multi-tab conflict,
- failover berat.

Solusi:

- minimal session,
- persistent draft,
- view scope terkontrol,
- server-side cache dengan TTL jika perlu.

### 25.6 View Getter Melakukan Work Berat

Gejala:

```java
public String getStatusLabel() {
    return dictionaryService.lookup(statusCode);
}
```

Dipanggil puluhan/ratusan kali saat render.

Solusi:

- prepare label sebelum render,
- cache per request,
- view model immutable.

---

## 26. Reference Architecture: Regulatory Case Management UI

### 26.1 Context

Sistem memiliki modul:

- Application.
- Case.
- Appeal.
- Compliance.
- Correspondence.
- Document.
- Audit Trail.
- User/Profile.
- Report.

### 26.2 Layering

```text
web-ui
  - JSP views / Facelets views
  - tags / composite components
  - controllers / backing beans
  - view models / form models

application-service
  - case query service
  - case command service
  - workflow service
  - permission service
  - notification service
  - audit service

domain
  - case aggregate
  - workflow policy
  - assignment policy
  - escalation policy
  - document policy

infrastructure
  - repository
  - external gateways
  - email adapter
  - document storage
  - audit persistence
```

### 26.3 Request Example: Open Case Detail

```text
GET /case/CASE-001
  -> authenticate
  -> authorize page/entity access
  -> query CaseDetailPage
       -> case summary
       -> permissions
       -> workflow actions
       -> documents
       -> audit summary
       -> display labels
  -> render JSP/Faces
```

### 26.4 Request Example: Approve Case

```text
POST /case/CASE-001/action APPROVE
  -> CSRF validation
  -> authenticate
  -> parse command
  -> validate input
  -> load case for update
  -> authorize action
  -> check version
  -> transition workflow
  -> persist
  -> audit
  -> notify if needed
  -> redirect detail page
```

### 26.5 Failure Example: User Approves Stale Case

```text
User opens case at 10:00
Another officer rejects at 10:05
User clicks approve at 10:06

System:
  -> detects version conflict
  -> does not approve
  -> renders/redirects with conflict message
  -> tells user to refresh
  -> audits failed/stale attempt if required
```

UI message:

```text
This case was updated by another officer. Please review the latest case status before taking action.
Reference ID: REQ-2026-000456
```

---

## 27. Architecture Checklist

### 27.1 Page Design Checklist

- Apakah page punya single clear purpose?
- Apakah data page berasal dari view model?
- Apakah JSP/Faces tidak mengakses entity langsung?
- Apakah semua label/status/display sudah jelas ownership-nya?
- Apakah action availability dihitung server-side?
- Apakah action tetap enforced di service?
- Apakah page punya error/empty/loading semantics?
- Apakah pagination/filter/sort dilakukan sebelum render?
- Apakah field sensitif dimasking?
- Apakah localization/accessibility dipikirkan?

### 27.2 State Checklist

- Apa yang disimpan di request?
- Apa yang disimpan di view scope?
- Apa yang disimpan di session?
- Apakah session object serializable?
- Apakah multi-tab aman?
- Apakah timeout behavior jelas?
- Apakah wizard state persistent atau volatile?
- Apakah hidden field bisa ditamper?
- Apakah view state terlalu besar?

### 27.3 Security Checklist

- Apakah semua output di-escape sesuai context?
- Apakah raw HTML disanitasi?
- Apakah CSRF aktif?
- Apakah authorization enforced di service?
- Apakah tombol/link hanya visibility helper?
- Apakah download endpoint authorize sendiri?
- Apakah error page tidak leak stack trace?
- Apakah sensitive data tidak masuk hidden field/log?
- Apakah cache header benar untuk protected page?

### 27.4 Performance Checklist

- Apakah render path bebas DB call tersembunyi?
- Apakah getter murah?
- Apakah list page paginated?
- Apakah permission per row batch/cached?
- Apakah view state size terukur?
- Apakah session memory terukur?
- Apakah response size masuk akal?
- Apakah Ajax execute/render minimal?
- Apakah component tree tidak membengkak?

### 27.5 Testability Checklist

- Apakah view model bisa dites tanpa container?
- Apakah command service bisa dites tanpa UI?
- Apakah permission policy punya unit test?
- Apakah rendered HTML punya regression test untuk XSS/security?
- Apakah JSP/Facelets compile smoke test ada?
- Apakah migration punya golden master untuk halaman penting?
- Apakah concurrency/version conflict dites?

---

## 28. Java 8 sampai Java 25: Architectural Implications

### 28.1 Java 8 Legacy

Ciri:

- Java EE 7/8 umum.
- `javax.*`.
- JSP 2.x.
- JSF 2.x.
- JSTL 1.2.
- older app servers.

Strategi:

- bersihkan scriptlet,
- perkenalkan view model,
- pisahkan service boundary,
- test rendered HTML,
- inventarisasi tag/component custom,
- jangan langsung lompat framework tanpa kontrak.

### 28.2 Java 11/17 Transition

Ciri:

- banyak organisasi mulai upgrade runtime.
- module encapsulation lebih terasa.
- Jakarta EE 9/10 mulai relevan.
- namespace migration perlu direncanakan.

Strategi:

- pindahkan build ke dependency eksplisit,
- hilangkan reliance ke internal JDK API,
- mulai `javax`/`jakarta` inventory,
- upgrade library ecosystem.

### 28.3 Java 21/25 Modern Runtime

Ciri:

- records cocok untuk immutable view model.
- modern GC dan runtime observability lebih baik.
- virtual threads dapat membantu blocking server workload tertentu, tetapi tidak otomatis memperbaiki render logic buruk.
- Jakarta EE 11 baseline Java SE 17+.

Strategi:

- gunakan record untuk read-only view model jika stack mendukung,
- tetap jaga session serialization,
- jangan simpan object non-serializable di view/session scope,
- optimalkan architecture sebelum berharap runtime menyelesaikan masalah.

---

## 29. Practical Refactoring Roadmap untuk Legacy JSP/Faces

### Step 1 — Inventory

Cari:

- JSP dengan scriptlet,
- JSP yang query DB,
- JSP dengan permission logic,
- JSP dengan large session usage,
- Faces bean terlalu besar,
- direct entity binding,
- custom tag/component lama,
- duplicated layout.

### Step 2 — Stabilize Behavior

- Tambah smoke test.
- Tambah golden master untuk halaman penting.
- Tambah security regression test.
- Tambah correlation id.
- Tambah error page aman.

### Step 3 — Introduce View Model

Mulai dari halaman paling sering berubah.

```text
Entity/Map attributes
  -> PageViewModel
```

### Step 4 — Move Business Logic Out of View

```text
JSP/Faces condition
  -> permission/workflow policy
```

### Step 5 — Normalize Layout and Components

```text
copy-paste HTML
  -> tag file/composite component
```

### Step 6 — Harden Security

- context-aware encoding,
- CSRF,
- authorization enforcement,
- hidden field review,
- secure error page,
- cache-control.

### Step 7 — Measure Performance

- render time,
- query count,
- response size,
- session size,
- view state size.

### Step 8 — Plan Migration

Baru setelah architecture lebih bersih, lakukan:

- Java upgrade,
- app server upgrade,
- `javax.*` → `jakarta.*`,
- component library upgrade,
- namespace/taglib update.

---

## 30. Heuristics Top-Tier Engineer

Top-tier engineer tidak hanya bertanya:

> Tag apa yang harus dipakai?

Tetapi:

1. Apa boundary state halaman ini?
2. Apa invariant domain yang tidak boleh dilanggar?
3. Di mana authorization benar-benar enforced?
4. Apa yang terjadi jika user membuka dua tab?
5. Apa yang terjadi jika session expired?
6. Apa yang terjadi jika data berubah sebelum submit?
7. Apa yang terjadi jika external service lambat?
8. Apa yang terjadi jika validation gagal sebagian?
9. Apa yang terjadi jika action dikirim manual tanpa tombol?
10. Apakah render path punya hidden query?
11. Apakah error bisa dijelaskan dengan correlation id?
12. Apakah audit membuktikan keputusan sistem?
13. Apakah migration bisa rollback?
14. Apakah page bisa dites tanpa browser manual?
15. Apakah UI component library memperjelas atau menyembunyikan complexity?

---

## 31. Ringkasan Mental Model

JSP/Jakarta Pages adalah pilihan baik untuk server-rendered UI yang linear dan eksplisit.

Jakarta Faces adalah pilihan baik untuk UI enterprise yang component-heavy, form-heavy, dan lifecycle-aware.

Keduanya bisa menjadi sangat maintainable jika arsitekturnya benar:

```text
View
  renders only

Controller / Backing Bean
  coordinates interaction

View Model / Form Model
  defines page/input contract

Application Service
  enforces use case

Domain / Policy
  owns business invariant

Infrastructure
  handles persistence/external systems
```

Keduanya juga bisa menjadi sangat buruk jika:

- view menjadi business layer,
- session menjadi database,
- entity bocor ke UI,
- authorization hanya rendering,
- lifecycle tidak dipahami,
- state tidak diukur,
- migration dilakukan tanpa inventory.

Arsitektur server-side UI yang kuat bukan tentang nostalgia atau modernitas. Ia tentang **clarity of boundaries**.

---

## 32. Latihan Praktis

### Latihan 1 — Refactor JSP Entity Binding ke View Model

Ambil halaman JSP lama yang menerima entity langsung.

Tugas:

1. Buat `PageVm`.
2. Pindahkan formatting dari JSP ke view model atau custom tag.
3. Pindahkan permission decision ke service.
4. Pastikan JSP hanya render.

### Latihan 2 — Audit Action Flow

Pilih satu action penting, misalnya approve/reject/escalate.

Gambar alurnya:

```text
button visibility
  -> POST
  -> CSRF
  -> authorization
  -> validation
  -> workflow transition
  -> persistence
  -> audit
  -> redirect/message
```

Cari titik yang belum enforced.

### Latihan 3 — Diagnose List Page Lambat

Cek:

1. Apakah rows terlalu banyak?
2. Apakah getter memanggil service?
3. Apakah permission per row memanggil DB?
4. Apakah JSP/Faces melakukan filtering?
5. Apakah response HTML terlalu besar?
6. Apakah view state besar?

### Latihan 4 — Design Hybrid Boundary

Untuk satu aplikasi:

- halaman mana tetap server-side,
- halaman mana cocok SPA,
- service apa yang shared,
- auth/session/CSRF strategy,
- audit strategy,
- DTO vs view model boundary.

---

## 33. Checklist Sebelum Lanjut ke Capstone

Sebelum masuk Part 30, pastikan sudah memahami:

1. Perbedaan template rendering dan component lifecycle.
2. Kenapa view model penting.
3. Kenapa form model berbeda dari entity.
4. Kenapa visibility bukan authorization.
5. Kenapa workflow action harus dipusatkan.
6. Kenapa audit ada di service boundary.
7. Kenapa session tidak boleh menjadi database.
8. Kenapa Faces state harus diukur.
9. Kenapa JSP custom tags dan Faces composite components adalah primitive arsitektur UI.
10. Kenapa migration sebaiknya didahului inventory dan behavior stabilization.

---

## 34. Penutup

Bagian ini adalah jembatan dari detail teknis menuju desain sistem.

Part berikutnya akan menjadi capstone: kita akan membangun dan mereview **enterprise case management UI** dengan dua pendekatan:

1. JSP/Jakarta Pages + JSTL + custom tags + controller.
2. Jakarta Faces + Facelets + CDI backing bean + component model.

Kita akan melihat bagaimana requirement nyata seperti listing, detail, workflow action, assignment, minutes/comments, document upload, audit view, role-based action visibility, validation, escalation indicator, concurrent update, double submit, stale state, dan session expiry dimodelkan secara end-to-end.

---

## Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
30-capstone-enterprise-case-management-ui.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — Migration Playbook: Java EE/JSP/JSF Legacy to Jakarta Pages/Faces](./28-migration-playbook-java-ee-jsp-jsf-legacy-to-jakarta-pages-faces.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 30 — Capstone: Build and Review an Enterprise Case Management UI](./30-capstone-enterprise-case-management-ui.md)
