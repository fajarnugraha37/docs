# Part 16 — Faces Managed Beans, CDI, Scopes, and Dependency Boundaries

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `16-faces-managed-beans-cdi-scopes-dependency-boundaries.md`  
> Fokus: backing bean, CDI, scope, lifecycle, serialization, dependency boundary, view model, persistence boundary, dan failure model enterprise Jakarta Faces.

---

## 0. Posisi Materi Ini dalam Seri

Pada bagian sebelumnya, kita membahas **Facelets dan XHTML view authoring**. Kita sudah membangun mental model bahwa file `.xhtml` bukan sekadar HTML final, tetapi **blueprint untuk component tree** Jakarta Faces.

Bagian ini menjawab pertanyaan berikut:

> Setelah view dideklarasikan di Facelets, object Java apa yang menjadi “otak” halaman tersebut?

Jawabannya adalah **backing bean**.

Namun dalam aplikasi Jakarta Faces modern, backing bean sebaiknya bukan lagi `@ManagedBean` legacy JSF, melainkan **CDI bean** yang diberi nama dengan `@Named`, diberi scope yang tepat, dan hanya bertanggung jawab sebagai **UI interaction boundary**.

Secara mental model:

```text
Facelets .xhtml
  binds to EL expressions
      -> #{caseSearchBean.keyword}
      -> #{caseSearchBean.search}
      -> #{caseSearchBean.results}

CDI named bean
  receives UI input
  coordinates UI action
  calls application service
  exposes view model back to component tree

Application service
  performs use case logic
  enforces business rules
  coordinates transaction/persistence/integration
```

Kesalahan umum di aplikasi Faces enterprise adalah memperlakukan backing bean sebagai:

```text
controller + service + repository + entity cache + workflow engine + security policy + UI state
```

Itu membuat halaman terlihat cepat selesai, tetapi nanti sulit dites, sulit dimigrasi, rentan stale state, rawan memory leak, dan sulit dianalisis ketika terjadi bug multi-tab/session/concurrent update.

Bagian ini akan membangun fondasi agar backing bean menjadi **thin, explicit, state-safe, testable, dan operationally predictable**.

---

## 1. Apa Itu Backing Bean?

Backing bean adalah object Java yang diakses oleh view Faces melalui Expression Language.

Contoh view:

```xhtml
<h:form id="searchForm">
    <h:inputText value="#{caseSearchBean.criteria.referenceNo}" />
    <h:commandButton value="Search" action="#{caseSearchBean.search}" />

    <h:dataTable value="#{caseSearchBean.results}" var="row">
        <h:column>
            <h:outputText value="#{row.referenceNo}" />
        </h:column>
        <h:column>
            <h:outputText value="#{row.statusLabel}" />
        </h:column>
    </h:dataTable>
</h:form>
```

Backing bean:

```java
import jakarta.enterprise.context.ViewScoped;
import jakarta.inject.Inject;
import jakarta.inject.Named;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

@Named
@ViewScoped
public class CaseSearchBean implements Serializable {

    private static final long serialVersionUID = 1L;

    private SearchCriteria criteria = new SearchCriteria();
    private List<CaseRowView> results = new ArrayList<>();

    @Inject
    private CaseSearchService caseSearchService;

    public void search() {
        results = caseSearchService.search(criteria);
    }

    public SearchCriteria getCriteria() {
        return criteria;
    }

    public List<CaseRowView> getResults() {
        return results;
    }
}
```

Hal penting:

1. View tidak tahu service secara langsung.
2. View tidak tahu repository secara langsung.
3. View hanya binding ke property/action di backing bean.
4. Backing bean tidak harus mengandung business rule.
5. Backing bean bertanggung jawab terhadap **interaction state** halaman.

---

## 2. Legacy `@ManagedBean` vs CDI `@Named`

Pada era JSF lama, banyak aplikasi memakai:

```java
import jakarta.faces.bean.ManagedBean;
import jakarta.faces.bean.ViewScoped;

@ManagedBean
@ViewScoped
public class CaseBean {
}
```

Pada aplikasi modern, pendekatan yang lebih disarankan adalah CDI:

```java
import jakarta.inject.Named;
import jakarta.faces.view.ViewScoped;

@Named
@ViewScoped
public class CaseBean implements Serializable {
}
```

Perbedaan mental model:

```text
Legacy JSF managed bean
  managed by JSF managed bean facility
  older programming model
  weaker integration with CDI ecosystem
  many annotations deprecated/replaced in modern Jakarta Faces

CDI named bean
  managed by CDI container
  injectable
  interceptable
  testable
  integrates with scopes, producers, events, alternatives, decorators
  primary model for modern Jakarta EE applications
```

CDI bean diberi `@Named` agar bisa diakses via EL:

```java
@Named("caseSearch")
public class CaseSearchBean {
}
```

Lalu di view:

```xhtml
<h:inputText value="#{caseSearch.criteria.referenceNo}" />
```

Jika nama tidak eksplisit:

```java
@Named
public class CaseSearchBean {
}
```

Biasanya EL name menjadi:

```text
caseSearchBean
```

Karena nama class `CaseSearchBean` didekapitalisasi.

---

## 3. Kenapa CDI Penting untuk Faces?

Faces adalah UI framework. CDI adalah dependency/context framework.

Keduanya melengkapi:

```text
Faces
  component tree
  lifecycle
  converter/validator
  navigation
  state saving
  rendering

CDI
  dependency injection
  scope/context lifecycle
  type-safe wiring
  interceptors
  producers
  events
  alternatives
  decorators
```

Dengan CDI, backing bean bisa menginjeksi service:

```java
@Named
@ViewScoped
public class ApprovalBean implements Serializable {

    @Inject
    private ApprovalService approvalService;

    public String approve() {
        approvalService.approve(command);
        return "/case/detail?faces-redirect=true&caseId=" + command.getCaseId();
    }
}
```

Namun CDI tidak berarti semua object boleh diinjeksi sembarangan ke backing bean. Dependency boundary tetap harus dijaga.

Good dependency direction:

```text
View
  -> Backing Bean
      -> Application Service
          -> Domain Service / Repository / Integration Gateway
```

Bad dependency direction:

```text
View
  -> Backing Bean
      -> EntityManager
      -> JDBC
      -> Remote API Client
      -> Workflow DB Table
      -> Audit table
      -> Security context mutation
      -> Email sender
```

Bukan berarti backing bean tidak boleh pernah memanggil sesuatu selain service. Tetapi semakin banyak dependency teknis masuk ke backing bean, semakin backing bean menjadi mini application layer yang sulit dites dan sulit dikontrol transaksinya.

---

## 4. Backing Bean Bukan Domain Model

Salah satu kesalahan terbesar:

```xhtml
<h:inputText value="#{caseBean.caseEntity.applicant.name}" />
<h:inputText value="#{caseBean.caseEntity.caseOfficer.email}" />
<h:inputText value="#{caseBean.caseEntity.workflow.currentTask.assignee.name}" />
```

Ini terlihat nyaman, tetapi berbahaya.

Masalahnya:

1. View menjadi tergantung struktur entity.
2. Lazy loading bisa terjadi saat render.
3. N+1 query bisa muncul dari getter chain.
4. Entity bisa detached saat postback.
5. Field yang tidak boleh diedit bisa ikut terikat.
6. Security boundary melemah.
7. Migration database/domain menjadi sulit karena view ikut tahu detail entity.
8. Serialization session/view scope bisa membawa graph entity besar.

Lebih aman:

```java
public class CaseDetailView {
    private Long caseId;
    private String referenceNo;
    private String applicantName;
    private String statusLabel;
    private boolean canApprove;
    private boolean canReject;
    private List<DocumentRowView> documents;
    private List<AuditRowView> auditRows;
}
```

Lalu view:

```xhtml
<h:outputText value="#{caseDetailBean.view.referenceNo}" />
<h:outputText value="#{caseDetailBean.view.applicantName}" />
<h:commandButton value="Approve"
                 action="#{caseDetailBean.approve}"
                 rendered="#{caseDetailBean.view.canApprove}" />
```

View model adalah contract khusus UI. Ia boleh redundant, tetapi predictable.

---

## 5. Backing Bean Sebagai UI Interaction Boundary

Backing bean yang baik menjawab pertanyaan:

1. Apa state halaman saat ini?
2. Data apa yang perlu dirender?
3. Input apa yang sedang dikumpulkan?
4. Action apa yang bisa dilakukan user?
5. Setelah action berhasil, user diarahkan ke mana?
6. Jika gagal, message apa yang muncul?
7. Apa yang harus terjadi saat postback?

Backing bean yang buruk mencoba menjawab:

1. Bagaimana validasi domain internal dilakukan?
2. Bagaimana transaksi database dibuka?
3. Bagaimana query SQL dibuat?
4. Bagaimana authorization global ditegakkan?
5. Bagaimana workflow engine mengubah state?
6. Bagaimana audit trail persistent ditulis?
7. Bagaimana integrasi eksternal dipanggil langsung?

Itu seharusnya milik application service/domain layer.

Perbandingan:

```text
Good backing bean responsibility
  load view model
  hold form state
  call use case service
  translate service result to FacesMessage/navigation

Bad backing bean responsibility
  execute query
  mutate entity graph directly
  decide workflow transition from DB status manually
  construct audit records directly
  call remote system directly
  encode business policy in rendered/action condition
```

---

## 6. Scope: Masalah Paling Mahal di Faces

Scope menentukan berapa lama bean hidup dan dalam konteks apa state disimpan.

Dalam Faces, scope bukan detail kecil. Scope adalah desain state.

Pilihan umum:

```text
@RequestScoped
@ViewScoped
@SessionScoped
@ApplicationScoped
@ConversationScoped
@Dependent
```

Masing-masing punya trade-off.

---

## 7. Request Scope

`@RequestScoped` berarti bean dibuat untuk satu HTTP request dan dibuang setelah response selesai.

Contoh:

```java
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Named;

@Named
@RequestScoped
public class CaseLookupBean {

    private String referenceNo;

    @Inject
    private CaseLookupService service;

    public CaseSummaryView getSummary() {
        if (referenceNo == null || referenceNo.isBlank()) {
            return null;
        }
        return service.findByReferenceNo(referenceNo);
    }

    public String getReferenceNo() {
        return referenceNo;
    }

    public void setReferenceNo(String referenceNo) {
        this.referenceNo = referenceNo;
    }
}
```

Cocok untuk:

1. Halaman stateless.
2. Read-only page sederhana.
3. Parameter-driven page.
4. Search yang hasilnya tidak perlu bertahan setelah request.
5. Action sederhana dengan redirect.

Tidak cocok untuk:

1. Multi-step form.
2. Data table dengan state halaman/filter/sort di memory.
3. Ajax interaction yang harus mempertahankan state antar request.
4. Complex edit page.

Failure mode request scope:

```text
User mengisi form
  -> postback
  -> bean baru dibuat
  -> field tertentu hilang
  -> action tidak melihat state sebelumnya
```

Request scope aman dari session bloat, tetapi mudah kehilangan state.

---

## 8. View Scope

`@ViewScoped` berarti bean hidup selama user berada pada view Faces yang sama.

Dalam Jakarta Faces modern, gunakan:

```java
import jakarta.faces.view.ViewScoped;
import jakarta.inject.Named;
import java.io.Serializable;

@Named
@ViewScoped
public class CaseEditBean implements Serializable {
    private static final long serialVersionUID = 1L;
}
```

View scope biasanya paling natural untuk halaman Faces interaktif.

Cocok untuk:

1. Edit form.
2. Search page dengan hasil yang bertahan saat Ajax update.
3. Data table dengan selection state.
4. Wizard ringan dalam satu view.
5. Halaman detail dengan command buttons dan partial updates.

Mental model:

```text
Initial GET
  creates view
  creates ViewScoped bean
  renders form + view state

Postback/Ajax to same view
  restores view
  restores ViewScoped bean
  applies submitted values
  invokes actions
  renders updated view

Navigate away / view expires
  bean eligible for destruction
```

Penting: `@ViewScoped` bean harus serializable karena state view/session bisa diserialisasi, direplikasi, atau dipassivate tergantung container/config.

```java
@Named
@ViewScoped
public class BadBean { // risky: not Serializable
}
```

Lebih benar:

```java
@Named
@ViewScoped
public class GoodBean implements Serializable {
    private static final long serialVersionUID = 1L;
}
```

Namun `implements Serializable` bukan cukup. Field di dalamnya juga harus dipikirkan.

Buruk:

```java
@Named
@ViewScoped
public class CaseBean implements Serializable {

    private EntityManager entityManager; // do not hold this in view state
    private InputStream uploadedContent; // do not hold stream in view state
    private Thread workerThread;         // never
    private Connection connection;       // never
}
```

Lebih baik:

```java
@Named
@ViewScoped
public class CaseBean implements Serializable {

    private Long caseId;
    private CaseEditForm form;
    private CaseDetailView view;

    @Inject
    private transient CaseApplicationService service;
}
```

Catatan: CDI proxy sering menangani serialization dependency, tetapi tetap pikirkan field state manual. Jangan menyimpan resource teknis non-serializable sebagai state halaman.

---

## 9. Session Scope

`@SessionScoped` berarti bean hidup selama HTTP session user.

```java
import jakarta.enterprise.context.SessionScoped;
import jakarta.inject.Named;
import java.io.Serializable;

@Named
@SessionScoped
public class UserPreferenceBean implements Serializable {
    private Locale preferredLocale;
    private String timezone;
    private boolean compactMode;
}
```

Cocok untuk:

1. User preference.
2. Locale/timezone selected by user.
3. Small navigation state.
4. Authenticated user summary.
5. UI theme preference.

Tidak cocok untuk:

1. Search result besar.
2. Entity graph.
3. Uploaded file content.
4. Current case edit form untuk semua tab.
5. Per-page temporary state.
6. Cache data domain.

Session scope adalah sumber banyak bug multi-tab.

Contoh buruk:

```java
@Named
@SessionScoped
public class CaseEditSessionBean implements Serializable {
    private CaseEditForm currentForm;
}
```

Jika user membuka dua case di dua tab:

```text
Tab A opens CASE-001
  currentForm = CASE-001

Tab B opens CASE-002
  currentForm = CASE-002

Tab A clicks Save
  submits data but bean currentForm may now represent CASE-002
```

Hasilnya bisa fatal.

Rule praktis:

```text
Session scope should represent user-level state,
not page-level state.
```

---

## 10. Application Scope

`@ApplicationScoped` berarti satu bean untuk seluruh application lifecycle.

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ReferenceDataService {
    public List<StatusOption> getCaseStatuses() {
        // cached immutable reference data
    }
}
```

Cocok untuk:

1. Stateless service.
2. Cache immutable/safely synchronized reference data.
3. Configuration reader.
4. Registry.
5. Shared helper with no per-user mutable state.

Tidak cocok untuk:

1. User-specific data.
2. Request-specific data.
3. Mutable unsynchronized collections.
4. Current logged-in user.
5. Current page/form state.

Buruk:

```java
@ApplicationScoped
public class CurrentUserStore {
    private User currentUser; // cross-user leak
}
```

Sangat berbahaya karena semua user berbagi instance yang sama.

Jika application scope menyimpan cache mutable, gunakan desain thread-safe:

```java
@ApplicationScoped
public class ReferenceDataCache {

    private volatile List<StatusOption> statuses = List.of();

    public List<StatusOption> getStatuses() {
        return statuses;
    }

    public void refresh() {
        List<StatusOption> loaded = loadFromService();
        statuses = List.copyOf(loaded);
    }
}
```

Jangan expose mutable list internal:

```java
public List<StatusOption> getStatuses() {
    return statuses; // risky if mutable
}
```

---

## 11. Conversation Scope

`@ConversationScoped` berasal dari CDI dan berguna untuk long-running interaction yang melintasi beberapa request/view, tetapi tidak sepanjang session.

Contoh konsep:

```text
Start application wizard
  step 1 personal info
  step 2 documents
  step 3 declaration
  step 4 review
  submit
End conversation
```

Conversation scope bisa cocok untuk wizard multi-page, tetapi juga menambah kompleksitas:

1. Conversation harus dimulai.
2. Conversation id harus dipertahankan.
3. Conversation harus diakhiri.
4. Timeout harus dipahami.
5. Multi-tab behavior harus diuji.

Untuk banyak aplikasi, alternatif yang lebih explicit lebih mudah:

```text
Option A: store draft in database
Option B: use view scope per page + draft id
Option C: use flow framework
Option D: use session-scoped wizard state with explicit wizard id map
```

Conversation scope bukan default. Gunakan hanya jika tim benar-benar memahami lifecycle-nya.

---

## 12. Dependent Scope

`@Dependent` berarti lifecycle object mengikuti injection target.

Contoh:

```java
import jakarta.enterprise.context.Dependent;

@Dependent
public class FormMapper {
    public CaseCommand toCommand(CaseEditForm form) {
        return new CaseCommand(...);
    }
}
```

Cocok untuk:

1. Helper kecil.
2. Mapper stateless.
3. Strategy object yang mengikuti bean pemilik.
4. Producer-created objects.

Hati-hati jika `@Dependent` object memiliki resource yang perlu dilepas. Karena lifecycle-nya melekat pada owner, destruction bisa lebih sulit dipahami.

---

## 13. Scope Decision Matrix

Gunakan matrix berikut sebagai panduan awal:

| Kebutuhan | Scope yang Umumnya Cocok | Hindari |
|---|---:|---|
| Halaman read-only dari URL parameter | `@RequestScoped` | `@SessionScoped` |
| Search page dengan Ajax/filter | `@ViewScoped` | `@SessionScoped` |
| Edit form satu halaman | `@ViewScoped` | `@RequestScoped` jika banyak Ajax/state |
| User preference | `@SessionScoped` | `@ApplicationScoped` |
| Reference data immutable | `@ApplicationScoped` service/cache | `@SessionScoped` duplikasi per user |
| Multi-step wizard lintas halaman | draft DB / conversation / explicit wizard state | implicit session global field |
| Stateless application service | `@ApplicationScoped` | `@ViewScoped` |
| Per-request command processor | `@RequestScoped` / service method | `@SessionScoped` |
| Uploaded file content sementara | temp storage/object store/id reference | storing byte[] besar di session/view |
| Current logged-in user summary | security context + small session model if needed | application static/global |

Rule inti:

```text
Choose the shortest scope that preserves the required interaction state.
```

Tetapi jangan memilih request scope hanya karena “paling aman” jika halaman butuh state antar postback. Itu akan memunculkan bug lifecycle.

---

## 14. Getter di Faces Bukan Tempat Business Logic

Di Faces, getter bisa dipanggil berkali-kali selama render.

Buruk:

```java
public List<CaseRowView> getResults() {
    return caseSearchService.search(criteria); // dangerous
}
```

Masalah:

1. Query bisa dieksekusi berkali-kali dalam satu request.
2. Render path jadi lambat.
3. Exception muncul saat rendering, bukan saat action.
4. Debugging sulit.
5. Ajax partial render bisa memicu query yang tidak disangka.
6. Getter terlihat harmless tetapi punya side effect mahal.

Lebih baik:

```java
private List<CaseRowView> results = List.of();

public void search() {
    results = caseSearchService.search(criteria);
}

public List<CaseRowView> getResults() {
    return results;
}
```

Rule:

```text
Getter should expose already prepared state.
Getter should not perform use case execution.
```

Getter boleh melakukan formatting ringan, tetapi sebaiknya tetap hati-hati jika dipanggil banyak kali.

---

## 15. Initial Load Pattern

Halaman detail biasanya perlu load data saat initial GET.

Facelets:

```xhtml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.init}" />
</f:metadata>
```

Bean:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private Long caseId;
    private CaseDetailView view;

    @Inject
    private transient CaseApplicationService service;

    public void init() {
        if (view == null) {
            view = service.getDetail(caseId);
        }
    }

    public Long getCaseId() {
        return caseId;
    }

    public void setCaseId(Long caseId) {
        this.caseId = caseId;
    }

    public CaseDetailView getView() {
        return view;
    }
}
```

Perhatikan guard:

```java
if (view == null) {
    view = service.getDetail(caseId);
}
```

Karena view action bisa dipanggil pada postback tergantung konfigurasi dan lifecycle. Anda harus paham kapan data reload perlu terjadi.

Untuk kasus data yang harus fresh setiap request:

```java
public void init() {
    view = service.getDetail(caseId);
}
```

Untuk form edit yang tidak boleh overwrite input user saat validation failure, jangan reload sembarangan.

---

## 16. Form Object Pattern

Jangan binding input langsung ke entity.

Buruk:

```xhtml
<h:inputText value="#{caseEditBean.caseEntity.applicant.name}" />
```

Lebih baik:

```java
public class CaseEditForm implements Serializable {
    private Long caseId;
    private String applicantName;
    private String contactEmail;
    private String remarks;
    private Long version;
}
```

View:

```xhtml
<h:inputText value="#{caseEditBean.form.applicantName}" />
<h:inputText value="#{caseEditBean.form.contactEmail}" />
<h:inputTextarea value="#{caseEditBean.form.remarks}" />
```

Bean:

```java
public String save() {
    SaveCaseCommand command = mapper.toCommand(form);
    SaveCaseResult result = service.save(command);
    facesMessages.info("Case saved successfully");
    return "/case/detail?faces-redirect=true&caseId=" + result.caseId();
}
```

Manfaat:

1. UI input explicit.
2. Security lebih jelas.
3. Hidden field bisa dikontrol.
4. Validation lebih fokus.
5. Domain entity tidak bocor.
6. Optimistic locking bisa ditangani via version field.
7. Serialization lebih ringan.
8. Test lebih mudah.

---

## 17. View Model vs Form Model vs Command

Jangan mencampur semua model.

```text
View model
  data prepared for display
  usually read-only from UI perspective
  e.g. CaseDetailView, CaseRowView

Form model
  input fields user can edit
  e.g. CaseEditForm

Command
  application service request
  intent-based
  e.g. ApproveCaseCommand, SaveCaseCommand
```

Contoh:

```java
public class CaseDetailView {
    private String referenceNo;
    private String statusLabel;
    private String applicantName;
    private boolean canApprove;
}

public class ApprovalForm {
    private Long caseId;
    private Long version;
    private String approvalRemarks;
}

public record ApproveCaseCommand(
    Long caseId,
    Long version,
    String remarks,
    String actorUserId
) {}
```

Backing bean:

```java
public String approve() {
    ApproveCaseCommand command = new ApproveCaseCommand(
        approvalForm.getCaseId(),
        approvalForm.getVersion(),
        approvalForm.getApprovalRemarks(),
        currentUser.userId()
    );

    service.approve(command);
    return redirectToDetail(approvalForm.getCaseId());
}
```

Keuntungan:

1. Display concerns tidak bercampur dengan input concerns.
2. Use case intent explicit.
3. Authorization/audit lebih mudah.
4. Testing service tidak butuh Faces.
5. UI bisa berubah tanpa mengguncang domain.

---

## 18. Dependency Injection di Backing Bean

Contoh dependency sehat:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    @Inject
    private transient CaseQueryService caseQueryService;

    @Inject
    private transient CaseCommandService caseCommandService;

    @Inject
    private transient CurrentUser currentUser;

    @Inject
    private transient FacesMessageService messages;
}
```

Catatan:

1. `transient` sering dipakai untuk dependency non-state agar tidak dianggap bagian serialized view state.
2. Banyak CDI proxy serializable, tetapi marking dependency sebagai `transient` tetap memberi sinyal desain.
3. Jangan menyimpan request-specific object sebagai field jangka panjang di view/session bean kecuali dipahami lifecycle-nya.

Dependency yang harus dihindari langsung di backing bean:

```java
@Inject EntityManager em;           // better in service/repository
@Inject DataSource dataSource;      // too low-level for UI
@Inject HttpServletResponse response; // sometimes needed, but isolate
@Inject SomeRemoteClient client;     // better through application service
```

Bukan berarti selalu haram. Misalnya file download mungkin butuh response handling. Namun desain lebih bersih jika operasi teknis dibungkus utility/service khusus.

---

## 19. Injecting Faces Context Objects

Faces menyediakan context seperti `FacesContext`, `ExternalContext`, `Flash`, dll. Dalam kode modern, sebaiknya akses ini dibungkus supaya testable.

Buruk jika tersebar:

```java
FacesContext.getCurrentInstance().addMessage(null,
    new FacesMessage(FacesMessage.SEVERITY_INFO, "Saved", null));
```

Lebih baik:

```java
@ApplicationScoped
public class FacesMessageService {

    public void info(String summary) {
        FacesContext.getCurrentInstance().addMessage(null,
            new FacesMessage(FacesMessage.SEVERITY_INFO, summary, null));
    }

    public void error(String summary) {
        FacesContext.getCurrentInstance().addMessage(null,
            new FacesMessage(FacesMessage.SEVERITY_ERROR, summary, null));
    }
}
```

Bean:

```java
@Inject
private transient FacesMessageService messages;

public void save() {
    service.save(form);
    messages.info("Saved successfully");
}
```

Manfaat:

1. Tests bisa mock `FacesMessageService`.
2. Message policy terpusat.
3. Severity konsisten.
4. Localization bisa ditambahkan kemudian.

---

## 20. Navigation Boundary

Backing bean sering mengembalikan outcome navigation.

```java
public String save() {
    service.save(form);
    return "/case/detail?faces-redirect=true&caseId=" + form.getCaseId();
}
```

Untuk aplikasi kecil, ini cukup. Untuk enterprise, string navigation bisa menyebar dan rawan typo.

Lebih baik buat helper:

```java
public final class CasePages {

    private CasePages() {}

    public static String detail(Long caseId) {
        return "/case/detail?faces-redirect=true&caseId=" + caseId;
    }

    public static String list() {
        return "/case/list?faces-redirect=true";
    }
}
```

Bean:

```java
public String save() {
    SaveCaseResult result = service.save(toCommand());
    return CasePages.detail(result.caseId());
}
```

Batas penting:

```text
Backing bean may decide user interaction flow.
Application service should not know JSF page names.
```

Service boleh mengembalikan result seperti:

```java
public record ApproveCaseResult(Long caseId, boolean escalated) {}
```

Lalu backing bean memutuskan page outcome.

---

## 21. Authorization: Rendered Flag Bukan Security Enforcement

View:

```xhtml
<h:commandButton value="Approve"
                 action="#{caseDetailBean.approve}"
                 rendered="#{caseDetailBean.view.canApprove}" />
```

Ini hanya menyembunyikan button.

User jahat masih bisa:

1. Mengirim POST manual.
2. Replay request lama.
3. Mengubah hidden fields.
4. Memakai browser devtools.
5. Memanggil endpoint/view action tertentu.

Karena itu service tetap harus enforce:

```java
public void approve(ApproveCaseCommand command) {
    authorization.requireCanApprove(command.caseId(), command.actorUserId());
    workflow.approve(command);
}
```

Mental model:

```text
rendered/canApprove in view model
  improves UX
  reduces clutter
  does not enforce security

service-level authorization
  enforces policy
  protects state transition
  must exist regardless of UI
```

Backing bean boleh menggunakan authorization result untuk display, tetapi tidak boleh menjadi satu-satunya layer security.

---

## 22. Persistence Boundary dan Lazy Loading

Salah satu failure mode paling umum:

```xhtml
<h:dataTable value="#{caseBean.caseEntity.documents}" var="doc">
    <h:outputText value="#{doc.owner.name}" />
</h:dataTable>
```

Jika `documents` atau `owner` lazy-loaded dan persistence context sudah tertutup, render bisa gagal:

```text
LazyInitializationException / detached entity / provider-specific error
```

Jika persistence context masih terbuka, render bisa memicu N+1 query:

```text
render 50 rows
  each row calls doc.owner.name
      -> 50 extra SQL queries
```

Solusi:

1. Query projection khusus view.
2. Fetch plan explicit di service/query layer.
3. DTO/view model sebelum render.
4. Jangan akses lazy entity graph dari view.

Contoh:

```java
public List<DocumentRowView> listDocuments(Long caseId) {
    return documentRepository.findDocumentRows(caseId);
}
```

`DocumentRowView`:

```java
public record DocumentRowView(
    Long id,
    String filename,
    String ownerName,
    String uploadedAtLabel,
    boolean canDownload
) {}
```

View:

```xhtml
<h:outputText value="#{doc.ownerName}" />
```

Semua data sudah siap sebelum render.

---

## 23. Transaction Boundary

Backing bean biasanya tidak seharusnya membuka transaksi langsung.

Buruk:

```java
public void save() {
    em.getTransaction().begin();
    em.persist(entity);
    em.getTransaction().commit();
}
```

Lebih baik:

```java
public void save() {
    service.save(toCommand());
}
```

Service:

```java
@Transactional
public SaveCaseResult save(SaveCaseCommand command) {
    // validate, load aggregate, mutate, persist, audit
}
```

Mengapa?

1. Transaction boundary mengikuti use case.
2. Business rule dan persistence rule satu tempat.
3. Audit trail konsisten.
4. Rollback policy jelas.
5. UI tidak perlu tahu persistence detail.
6. Test use case bisa dilakukan tanpa JSF lifecycle.

Backing bean mengurus:

```text
submitted input -> command -> service call -> message/navigation
```

Service mengurus:

```text
business transaction -> consistency -> persistence -> integration -> audit
```

---

## 24. Serialization dan Passivation

`@ViewScoped` dan `@SessionScoped` bean harus dianggap bisa diserialisasi.

Masalah umum:

```java
@Named
@ViewScoped
public class UploadBean implements Serializable {
    private UploadedFile file; // maybe non-serializable / large
}
```

Atau:

```java
private List<LargeEntity> results;
```

Risiko:

1. Session replication berat.
2. Failover gagal.
3. Memory bloat.
4. `NotSerializableException`.
5. Sensitive data tersimpan terlalu lama.
6. View state/client state membengkak.

Prinsip:

```text
Stateful UI bean should store small, serializable, interaction-level state.
```

Contoh aman:

```java
private Long caseId;
private CaseEditForm form;
private List<CaseRowView> results;
private Set<Long> selectedIds;
```

Contoh perlu dihindari:

```java
private EntityManager em;
private Connection connection;
private InputStream stream;
private byte[] largeFile;
private List<FullAuditTrailEntityWithClob> auditTrails;
private ExecutorService executor;
private Thread thread;
```

---

## 25. CDI Proxies dan Field Injection vs Constructor Injection

Dalam CDI/Faces, field injection umum ditemukan:

```java
@Inject
private CaseService caseService;
```

Namun constructor injection lebih testable:

```java
@Inject
public CaseEditBean(CaseService caseService) {
    this.caseService = caseService;
}
```

Tetapi Faces backing bean sering butuh no-arg constructor untuk proxy/lifecycle tertentu, tergantung runtime dan setup. Modern CDI mendukung constructor injection, tetapi untuk kompatibilitas enterprise legacy, field injection masih sering dipakai.

Strategi pragmatis:

1. Untuk backing bean Faces, field injection acceptable jika tim/container kompatibel dan tests memakai CDI integration atau setter package-private.
2. Untuk service/application/domain, prioritaskan constructor injection.
3. Jangan campur terlalu banyak dependency langsung di backing bean.
4. Jika backing bean butuh 8 dependency, kemungkinan boundary salah.

Contoh refactor:

```text
Before
  CaseEditBean injects:
    CaseRepository
    UserRepository
    AuditRepository
    WorkflowService
    EmailService
    DocumentService
    RoleService
    EntityManager

After
  CaseEditBean injects:
    CaseEditUseCase
    FacesMessageService
    CurrentUser
```

---

## 26. Bean Naming Strategy

Nama bean memengaruhi readability view.

Kurang jelas:

```java
@Named("bean")
public class Bean {
}
```

Lebih jelas:

```java
@Named("caseSearchBean")
public class CaseSearchBean {
}
```

Atau biarkan default:

```java
@Named
public class CaseSearchBean {
}
```

View:

```xhtml
#{caseSearchBean.criteria.referenceNo}
#{caseSearchBean.search}
```

Heuristik nama:

```text
<Page/UseCase><Role>Bean
  CaseSearchBean
  CaseDetailBean
  CaseEditBean
  AppealReviewBean
  DocumentUploadBean
  AssignmentBean
```

Hindari:

```text
CommonBean
UtilBean
BaseBean
ManagerBean
MainBean
Controller
```

Nama generic biasanya menandakan responsibility terlalu luas.

---

## 27. Base Bean: Berguna atau Berbahaya?

Banyak legacy Faces app punya:

```java
public abstract class BaseBean {
    protected FacesContext facesContext() { ... }
    protected void addInfo(String msg) { ... }
    protected User getCurrentUser() { ... }
    protected String redirect(String page) { ... }
}
```

Lalu semua bean extends `BaseBean`.

Manfaat:

1. Reduce boilerplate.
2. Common utility tersedia.
3. Legacy code cepat dibuat.

Risiko:

1. Hidden dependency.
2. Sulit dites.
3. Inheritance coupling.
4. God base class.
5. Sulit migrasi.
6. Utility makin banyak dan tak terkendali.

Alternatif lebih baik:

```java
@Inject FacesMessageService messages;
@Inject NavigationService navigation;
@Inject CurrentUser currentUser;
```

Gunakan composition daripada inheritance.

Base bean masih bisa dipakai untuk hal sangat minimal, tetapi jangan jadikan tempat semua helper.

---

## 28. Current User Pattern

Jangan menyebarkan parsing security context di semua backing bean.

Buruk:

```java
String username = FacesContext.getCurrentInstance()
    .getExternalContext()
    .getUserPrincipal()
    .getName();
```

Berulang di banyak tempat.

Lebih baik:

```java
@RequestScoped
public class CurrentUser {

    public String userId() {
        return FacesContext.getCurrentInstance()
            .getExternalContext()
            .getUserPrincipal()
            .getName();
    }

    public boolean hasRole(String role) {
        return FacesContext.getCurrentInstance()
            .getExternalContext()
            .isUserInRole(role);
    }
}
```

Bean:

```java
@Inject
private CurrentUser currentUser;

public void approve() {
    service.approve(new ApproveCaseCommand(caseId, currentUser.userId(), remarks));
}
```

Untuk aplikasi modern yang memakai Jakarta Security/OIDC, `CurrentUser` bisa menjadi adapter dari identity store/JWT/principal/application user profile.

---

## 29. Message Handling Pattern

Faces memiliki `FacesMessage`.

View:

```xhtml
<h:messages globalOnly="true" />
<h:message for="remarks" />
```

Backing bean:

```java
public void reject() {
    try {
        service.reject(toCommand());
        messages.info("Case rejected successfully.");
    } catch (BusinessValidationException e) {
        messages.error(e.getUserMessage());
    }
}
```

Better message architecture:

```text
Domain/service returns business error code
  -> bean/message service maps to localized UI message
  -> FacesMessage displayed by view
```

Avoid:

```java
throw new RuntimeException("Cannot approve because current status is PENDING_REVIEW");
```

Untuk user, tampilkan message yang jelas:

```text
This case can no longer be approved because it has already moved to another stage.
Please refresh the page.
```

Untuk log, simpan detail teknis.

---

## 30. Handling Business Exceptions in Backing Bean

Ada dua gaya:

### Gaya A — Service throws business exception

```java
public void approve() {
    try {
        service.approve(toCommand());
        messages.info("Approved successfully.");
        reload();
    } catch (StaleCaseException e) {
        messages.warn("The case was updated by another user. Please refresh.");
    } catch (UnauthorizedActionException e) {
        messages.error("You are not allowed to approve this case.");
    }
}
```

### Gaya B — Service returns result object

```java
public void approve() {
    ApproveResult result = service.approve(toCommand());

    if (result.success()) {
        messages.info("Approved successfully.");
        reload();
        return;
    }

    messages.error(result.message());
}
```

Keduanya valid. Pilih berdasarkan style arsitektur.

Untuk enterprise workflow, result object sering lebih eksplisit:

```java
public record UseCaseResult(
    boolean success,
    String messageCode,
    Map<String, Object> messageArgs,
    boolean stale,
    boolean forbidden
) {}
```

Namun jangan over-engineer untuk semua hal.

---

## 31. Multi-Tab Failure Model

Faces apps enterprise sering dipakai officer membuka banyak tab.

Skenario:

```text
Tab A: Case 1001 detail
Tab B: Case 1002 detail
Tab C: Search result
Tab A: user approves
Tab B: user edits
Tab A: stale view after workflow transition
```

Scope impact:

```text
RequestScoped
  low multi-tab risk but weak interaction state

ViewScoped
  generally good per-tab/page state

SessionScoped
  high multi-tab contamination risk if storing page state

ApplicationScoped
  catastrophic if storing user/page state
```

Mitigasi:

1. Gunakan view scope untuk per-page interaction.
2. Store `caseId` dan `version` di form/command.
3. Enforce optimistic locking di service/domain.
4. Reload after successful state transition.
5. Use redirect after mutating POST where appropriate.
6. Jangan simpan `currentCase` global di session.

---

## 32. Stale State dan Optimistic Locking

Contoh hidden field:

```xhtml
<h:inputHidden value="#{caseEditBean.form.version}" />
```

Form:

```java
public class CaseEditForm implements Serializable {
    private Long caseId;
    private Long version;
    private String remarks;
}
```

Service:

```java
@Transactional
public void save(SaveCaseCommand command) {
    CaseEntity entity = repository.findById(command.caseId());

    if (!entity.getVersion().equals(command.version())) {
        throw new StaleCaseException();
    }

    entity.updateRemarks(command.remarks());
}
```

Kenapa penting?

Karena view state bisa hidup cukup lama. User bisa membuka halaman, meninggalkan tab selama 30 menit, lalu submit setelah data berubah.

UI harus memperlakukan stale data sebagai kondisi normal, bukan bug tak terduga.

---

## 33. Ajax dan ViewScoped Bean

Ajax partial update sering membuat view scoped bean terasa seperti stateful UI object.

Contoh:

```xhtml
<h:selectOneMenu value="#{assignmentBean.selectedTeamId}">
    <f:selectItems value="#{assignmentBean.teamOptions}" />
    <f:ajax listener="#{assignmentBean.onTeamChanged}" render="officerPanel" />
</h:selectOneMenu>

<h:panelGroup id="officerPanel">
    <h:selectOneMenu value="#{assignmentBean.selectedOfficerId}">
        <f:selectItems value="#{assignmentBean.officerOptions}" />
    </h:selectOneMenu>
</h:panelGroup>
```

Bean:

```java
public void onTeamChanged() {
    officerOptions = assignmentService.findOfficers(selectedTeamId);
    selectedOfficerId = null;
}
```

Ini cocok untuk `@ViewScoped` karena state `selectedTeamId`, `officerOptions`, dan `selectedOfficerId` perlu bertahan dalam view yang sama.

Dengan `@RequestScoped`, data bisa hilang antara request Ajax.

---

## 34. Long-Running Operation

Jangan menjalankan operasi lama langsung di backing bean tanpa UX dan timeout strategy.

Buruk:

```java
public void generateReport() {
    reportService.generateHugeReportSynchronously(); // blocks request too long
}
```

Masalah:

1. HTTP request timeout.
2. User double click.
3. Thread container tertahan.
4. Browser menunggu lama.
5. Tidak ada progress state.
6. Retry bisa duplikasi job.

Lebih baik:

```java
public String requestReport() {
    Long jobId = reportService.submitReportJob(toCommand());
    return "/report/status?faces-redirect=true&jobId=" + jobId;
}
```

Bean hanya submit job. Application service/job worker yang memproses.

Untuk operation yang cukup pendek tapi sensitive, disable button dan gunakan idempotency key.

---

## 35. File Upload State Boundary

File upload tidak boleh sembarangan disimpan di view/session bean.

Bad:

```java
private byte[] uploadedBytes; // huge memory/session risk
```

Better:

```java
private String temporaryUploadId;
```

Flow:

```text
upload request
  -> validate type/size
  -> store temp file/object storage/db temp table
  -> bean stores tempUploadId
  -> final submit references tempUploadId
  -> service attaches document
  -> cleanup temp storage
```

Backing bean state kecil. File content berada di storage yang tepat dengan lifecycle dan cleanup policy.

---

## 36. Data Table State

Faces data table sering menjadi sumber memory dan performance issue.

Bad:

```java
private List<CaseEntity> allCases; // 50,000 rows
```

Better:

```java
private CaseSearchCriteria criteria;
private Page<CaseRowView> page;
private Set<Long> selectedCaseIds;
```

Search action:

```java
public void search() {
    page = caseSearchService.search(criteria, pageRequest());
}
```

Guideline:

1. Jangan load seluruh dataset ke view scope.
2. Gunakan pagination server-side.
3. Simpan selected IDs, bukan object penuh.
4. Query projection ke row view.
5. Jangan panggil service dari getter per row.
6. Hati-hati dengan selection state lintas page.

---

## 37. Bean Lifecycle Callbacks

CDI menyediakan callbacks:

```java
@PostConstruct
public void init() {
}

@PreDestroy
public void destroy() {
}
```

Gunakan `@PostConstruct` untuk setup internal yang tidak bergantung pada view parameter yang belum diset.

Contoh:

```java
@PostConstruct
public void init() {
    criteria = new SearchCriteria();
    results = List.of();
}
```

Jangan selalu load detail dari `@PostConstruct` jika `caseId` berasal dari `<f:viewParam>`, karena parameter mungkin belum tersedia pada saat itu tergantung lifecycle.

Lebih aman untuk parameter-driven page:

```xhtml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseDetailBean.caseId}" />
    <f:viewAction action="#{caseDetailBean.load}" />
</f:metadata>
```

Use `@PreDestroy` untuk cleanup ringan, tetapi jangan bergantung penuh untuk operasi bisnis penting. Session/view destruction timing bisa dipengaruhi timeout/container.

---

## 38. Handling `null` dan Initialization

Faces/EL akan memanggil getter chain.

Jika view:

```xhtml
<h:outputText value="#{caseDetailBean.view.referenceNo}" />
```

Dan `view == null`, maka bisa muncul error atau output kosong tergantung resolver/phase/context.

Pattern aman:

```xhtml
<h:panelGroup rendered="#{not empty caseDetailBean.view}">
    <h:outputText value="#{caseDetailBean.view.referenceNo}" />
</h:panelGroup>
```

Atau load wajib sebelum render.

Namun jangan menutupi bug dengan terlalu banyak null guard. Jika halaman detail wajib punya `caseId` dan view, failure harus jelas:

```java
public void load() {
    view = service.findDetail(caseId)
        .orElseThrow(() -> new NotFoundException("Case not found"));
}
```

---

## 39. UI State vs Domain State

UI state:

```text
active tab
expanded panel
selected row id
current page number
filter input
sort field
draft remarks in textarea
confirmation dialog open/closed
```

Domain state:

```text
case status
assigned officer
approval decision
document metadata
escalation deadline
audit trail
```

UI state boleh berada di backing bean. Domain state harus berada di domain/persistence layer dan dimutasi melalui service/use case.

Kesalahan:

```java
public void approve() {
    view.setStatusLabel("Approved"); // UI only mutation
}
```

Ini hanya mengubah display, bukan state sebenarnya.

Benar:

```java
public void approve() {
    service.approve(toCommand());
    view = service.getDetail(caseId);
}
```

---

## 40. Designing Backing Bean for Regulatory Case Management

Contoh halaman case detail enterprise.

Responsibilities:

```text
CaseDetailBean
  state:
    caseId
    CaseDetailView view
    ApprovalForm approvalForm
    RejectionForm rejectionForm

  actions:
    load()
    approve()
    reject()
    assign()
    addMinute()
    refresh()
```

Tidak melakukan:

```text
SQL query
workflow transition rules
audit insert
email sending
permission computation from scratch
file streaming internals
```

Bean:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long caseId;
    private CaseDetailView view;
    private ApprovalForm approvalForm = new ApprovalForm();
    private RejectionForm rejectionForm = new RejectionForm();

    @Inject
    private transient CaseDetailUseCase useCase;

    @Inject
    private transient CurrentUser currentUser;

    @Inject
    private transient FacesMessageService messages;

    public void load() {
        view = useCase.loadDetail(caseId, currentUser.userId());
        approvalForm.setCaseId(caseId);
        approvalForm.setVersion(view.version());
        rejectionForm.setCaseId(caseId);
        rejectionForm.setVersion(view.version());
    }

    public void approve() {
        try {
            useCase.approve(approvalForm.toCommand(currentUser.userId()));
            messages.info("Case approved successfully.");
            load();
        } catch (StaleCaseException e) {
            messages.warn("This case has changed. Please review the latest data.");
            load();
        } catch (ForbiddenActionException e) {
            messages.error("You are not allowed to approve this case.");
            load();
        }
    }

    public void reject() {
        try {
            useCase.reject(rejectionForm.toCommand(currentUser.userId()));
            messages.info("Case rejected successfully.");
            load();
        } catch (BusinessException e) {
            messages.error(e.userMessage());
        }
    }

    public Long getCaseId() {
        return caseId;
    }

    public void setCaseId(Long caseId) {
        this.caseId = caseId;
    }

    public CaseDetailView getView() {
        return view;
    }

    public ApprovalForm getApprovalForm() {
        return approvalForm;
    }

    public RejectionForm getRejectionForm() {
        return rejectionForm;
    }
}
```

View:

```xhtml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.load}" />
</f:metadata>

<h:form id="caseForm">
    <h:messages globalOnly="true" />

    <h1>#{caseDetailBean.view.referenceNo}</h1>
    <p>Status: #{caseDetailBean.view.statusLabel}</p>

    <h:panelGroup rendered="#{caseDetailBean.view.canApprove}">
        <h:inputTextarea id="approvalRemarks"
                         value="#{caseDetailBean.approvalForm.remarks}"
                         required="true" />
        <h:message for="approvalRemarks" />
        <h:commandButton value="Approve"
                         action="#{caseDetailBean.approve}" />
    </h:panelGroup>
</h:form>
```

Security note:

```text
canApprove controls display only.
approve use case still enforces authorization and workflow validity.
```

---

## 41. Scope and Dependency Smell Catalogue

### Smell 1 — Session Bean Named `CurrentCaseBean`

```java
@SessionScoped
public class CurrentCaseBean {
    private Long caseId;
    private CaseEditForm form;
}
```

Risk:

1. Multi-tab contamination.
2. Stale state.
3. Hard-to-debug overwrite.

Fix:

```text
Use @ViewScoped for page-specific case state.
Use session only for user-level preference/context.
```

### Smell 2 — Getter Calls Service

```java
public List<Option> getOfficerOptions() {
    return officerService.findAll();
}
```

Risk:

1. Repeated service call.
2. N+1-like render issue.
3. Slow page.

Fix:

```java
@PostConstruct
void init() {
    officerOptions = officerService.findAll();
}
```

Or load on event.

### Smell 3 — Entity in View Scope

```java
private CaseEntity entity;
```

Risk:

1. Lazy loading.
2. Serialization.
3. Detached entity.
4. Overposting.

Fix:

```java
private CaseEditForm form;
private CaseDetailView view;
```

### Smell 4 — ApplicationScoped Mutable User State

```java
@ApplicationScoped
class UserContext {
    private String username;
}
```

Risk: cross-user data leak.

Fix:

```text
@RequestScoped CurrentUser reads security context.
@SessionScoped UserPreference stores per-user preferences.
```

### Smell 5 — Too Many Dependencies

```java
class Bean {
    @Inject A a;
    @Inject B b;
    @Inject C c;
    @Inject D d;
    @Inject E e;
    @Inject F f;
}
```

Risk: bean is application service disguised as UI bean.

Fix: introduce use case service/facade.

---

## 42. Testing Backing Beans

Good backing bean design is testable without full JSF runtime.

Example:

```java
@Test
void approveReloadsViewAndShowsMessage() {
    CaseDetailUseCase useCase = mock(CaseDetailUseCase.class);
    FacesMessageService messages = mock(FacesMessageService.class);
    CurrentUser currentUser = () -> "u123";

    CaseDetailBean bean = new CaseDetailBean(useCase, messages, currentUser);
    bean.setCaseId(10L);
    bean.setApprovalForm(new ApprovalForm(10L, 3L, "ok"));

    when(useCase.loadDetail(10L, "u123"))
        .thenReturn(new CaseDetailView(...));

    bean.approve();

    verify(useCase).approve(any());
    verify(messages).info("Case approved successfully.");
    verify(useCase).loadDetail(10L, "u123");
}
```

Untuk ini, bean perlu constructor atau setter yang test-friendly. Jika field injection murni, test menjadi lebih sulit.

Test target:

1. Action memanggil service dengan command yang benar.
2. Stale exception menghasilkan message dan reload.
3. Forbidden exception tidak mengubah state diam-diam.
4. Save success return navigation outcome benar.
5. Init/load tidak overwrite dirty form pada validation failure.
6. Selection state dipertahankan antar Ajax update.

---

## 43. Java 8 sampai Java 25 Implications

### Java 8 Legacy

Banyak sistem Java 8 masih memakai:

```text
JSF 2.x
javax.faces.*
javax.enterprise.*
javax.inject.*
JSTL 1.2
```

Ciri umum:

1. `@ManagedBean` masih banyak.
2. XML config lebih banyak.
3. CDI integration kadang tidak konsisten.
4. Library seperti PrimeFaces versi lama masih `javax`.

### Java 11/17 Transition

Sering menjadi fase migrasi:

1. Upgrade build tool.
2. Upgrade container.
3. Hilangkan dependency lama.
4. Hadapi module/JDK internal access issue.
5. Mulai pindah ke Jakarta EE 9+ jika perlu.

### Java 17 Baseline Modern

Jakarta EE 11 memakai Java SE 17+ minimum. Ini membuat Java 17 menjadi baseline modern Jakarta EE.

Dampak:

1. Records bisa dipakai untuk DTO/view model immutable.
2. Switch expression, text block, pattern matching membantu code clarity.
3. Library modern cenderung menargetkan 17+.

Contoh record view model:

```java
public record CaseRowView(
    Long caseId,
    String referenceNo,
    String statusLabel,
    boolean canOpen
) implements Serializable {}
```

Catatan: untuk stateful view/session serialization, tetap pastikan semua field serializable.

### Java 21/25

Java 21 dan 25 memberi platform modern untuk runtime, tetapi tidak otomatis mengubah Faces lifecycle.

Virtual threads mungkin relevan di container/service layer jika runtime mendukung, tetapi backing bean tetap harus didesain dengan:

1. Scope benar.
2. State kecil.
3. No blocking long operation di request path jika tidak perlu.
4. No mutable shared state tanpa thread-safety.

Jangan berpikir:

```text
Java baru -> scope/session problem hilang
```

Scope bug adalah bug desain state, bukan bug versi Java.

---

## 44. `javax.*` ke `jakarta.*` untuk Beans dan Scopes

Legacy:

```java
import javax.inject.Named;
import javax.enterprise.context.RequestScoped;
import javax.faces.view.ViewScoped;
```

Modern Jakarta:

```java
import jakarta.inject.Named;
import jakarta.enterprise.context.RequestScoped;
import jakarta.faces.view.ViewScoped;
```

Legacy JSF managed bean:

```java
import javax.faces.bean.ManagedBean;
import javax.faces.bean.SessionScoped;
```

Modern preferred:

```java
import jakarta.inject.Named;
import jakarta.enterprise.context.SessionScoped;
```

Or for Faces view scope:

```java
import jakarta.faces.view.ViewScoped;
```

Migration checklist:

1. Replace imports.
2. Replace dependencies.
3. Replace container version.
4. Replace component library with Jakarta-compatible version.
5. Replace deprecated managed bean annotations.
6. Verify CDI bean discovery mode.
7. Verify serialization of view/session beans.
8. Verify EL names unchanged or adjusted.
9. Run integration tests for view scope behavior.
10. Test multi-tab and postback behavior.

---

## 45. Bean Discovery and Packaging

CDI discovers beans depending on archive configuration and annotations.

Things to verify:

1. Is there a `beans.xml`?
2. What is bean discovery mode?
3. Are classes annotated with bean-defining annotations?
4. Are they packaged in WAR/WEB-INF/classes or JAR?
5. Are duplicate bean names created?
6. Are alternatives/profiles enabled unexpectedly?

Common failure:

```text
Target Unreachable, identifier 'caseBean' resolved to null
```

Possible causes:

1. Missing `@Named`.
2. Wrong bean name.
3. Bean not discovered.
4. Deployment issue.
5. Class not in correct archive.
6. CDI disabled/misconfigured.
7. Namespace mismatch `javax` vs `jakarta`.

---

## 46. Production Diagnostics for Backing Bean Issues

Symptom: action method not called.

Check:

1. Is command component inside `h:form`?
2. Validation failure preventing invoke application?
3. `immediate=true` behavior?
4. Ajax `execute` too narrow?
5. Component not rendered on postback?
6. View expired?
7. Method signature mismatch?

Symptom: value not updated.

Check:

1. Setter exists?
2. Conversion failed?
3. Validation failed?
4. Model update phase skipped?
5. Bean recreated due to request scope?
6. Input not included in Ajax execute?

Symptom: state lost after Ajax.

Check:

1. Is bean request scoped?
2. Is view state missing?
3. Is form nested/invalid?
4. Is component id changed dynamically?
5. Is conditional rendering removing component from tree?

Symptom: memory increases.

Check:

1. Session count.
2. Average session size.
3. View state size.
4. ViewScoped bean fields.
5. Large lists/entities in session/view scope.
6. Uploaded files stored in memory.
7. Component tree size.
8. Custom caches in application scope.

Symptom: cross-user data appears.

Check:

1. Static fields.
2. Application scoped mutable user data.
3. Singleton service storing request data.
4. ThreadLocal not cleared.
5. Incorrect cache key.

---

## 47. Design Checklist for Each Faces Page

Before implementing a Faces page, answer:

1. What is the page purpose?
2. Is it read-only, edit, workflow action, wizard, or dashboard?
3. What URL parameters identify the page?
4. What state must survive postback?
5. What state must not survive navigation?
6. Which scope is the shortest correct scope?
7. What view model is needed?
8. What form model is needed?
9. What commands will be sent to application services?
10. What authorization flags are needed for UX?
11. Where is real authorization enforced?
12. What happens on stale data?
13. What happens on double submit?
14. What happens if validation fails?
15. What happens if user opens two tabs?
16. What data could be large?
17. What data is sensitive?
18. What messages are global vs field-specific?
19. What navigation outcome occurs after success?
20. What must be logged/audited?

---

## 48. Top 1% Mental Model

Engineer biasa melihat backing bean sebagai “class untuk tombol dan field”.

Engineer kuat melihat backing bean sebagai **stateful UI boundary**.

Perbedaannya:

```text
Beginner view
  h:inputText binds to bean property
  h:commandButton calls bean method

Advanced view
  component tree owns submitted values during lifecycle
  bean scope determines interaction state lifetime
  converter/validator phases decide whether model updates
  backing bean translates UI intent to application command
  service enforces business/security/transaction boundary
  view model prevents entity leakage
  state size affects memory/failover/performance
  multi-tab/stale state are normal operational scenarios
```

A top-tier engineer asks:

1. What exactly is stateful here?
2. Who owns this state?
3. How long does it live?
4. Can two tabs corrupt it?
5. Can user tamper with it?
6. Can it be serialized?
7. Can it be reloaded safely?
8. Does render path call database?
9. Is authorization enforced outside the view?
10. Can this be tested without JSF runtime?

---

## 49. Practical Reference Architecture

Recommended structure:

```text
web/
  case/
    CaseSearchBean.java
    CaseDetailBean.java
    CaseEditBean.java
    CaseAssignmentBean.java

ui/model/
  CaseRowView.java
  CaseDetailView.java
  CaseEditForm.java
  ApprovalForm.java
  AssignmentForm.java

application/case/
  CaseSearchService.java
  CaseDetailUseCase.java
  CaseEditUseCase.java
  CaseApprovalUseCase.java

application/security/
  CurrentUser.java
  AuthorizationService.java

web/support/
  FacesMessageService.java
  NavigationService.java
  ViewParamValidator.java
```

Dependency direction:

```text
web bean
  -> ui model
  -> application use case
  -> support services

application use case
  -> domain
  -> repository
  -> integration
  -> audit

view
  -> web bean only
```

Do not let view access:

```text
repository
entity manager
remote client
domain aggregate internals
static global state
```

---

## 50. Summary

Bagian ini membahas bagaimana Jakarta Faces menghubungkan view dengan Java code melalui managed/backing beans dan CDI.

Poin utama:

1. Backing bean adalah UI interaction boundary.
2. Modern Faces sebaiknya memakai CDI `@Named`, bukan legacy JSF `@ManagedBean`.
3. Scope adalah desain state, bukan annotation teknis.
4. `@RequestScoped` cocok untuk stateless/simple request.
5. `@ViewScoped` cocok untuk halaman interaktif/postback/Ajax.
6. `@SessionScoped` hanya untuk user-level state kecil.
7. `@ApplicationScoped` hanya untuk stateless/shared/thread-safe data.
8. Conversation scope berguna tetapi kompleks.
9. Jangan binding view langsung ke entity.
10. Gunakan view model, form model, dan command model.
11. Getter tidak boleh menjalankan service mahal.
12. Authorization visibility di view bukan enforcement.
13. Service/application layer tetap pemilik business rule, transaction, security, audit.
14. View/session bean harus serializable dan kecil.
15. Multi-tab, stale state, view expiry, and double submit harus dianggap normal.
16. Java 8–25 tidak menghapus problem state; versi modern hanya memberi alat lebih baik.

Mental model akhir:

```text
Facelets declares UI components.
Faces lifecycle processes component tree.
EL binds components to named CDI beans.
Bean scope controls UI interaction state lifetime.
Backing bean turns UI intent into application command.
Application service enforces correctness.
View model returns safe display data.
```

---

## 51. Latihan Mandiri

### Latihan 1 — Scope Diagnosis

Untuk setiap kasus, tentukan scope yang tepat dan alasannya:

1. Halaman search case dengan filter dan Ajax pagination.
2. Halaman user preference locale/theme.
3. Dropdown reference status yang sama untuk semua user.
4. Detail case read-only berdasarkan `caseId` URL.
5. Wizard submit application 5 halaman.
6. Approval dialog dalam halaman detail.
7. Dashboard yang refresh setiap 30 detik.

### Latihan 2 — Refactor Entity Binding

Ubah view berikut menjadi memakai form/view model:

```xhtml
<h:inputText value="#{caseBean.caseEntity.applicant.name}" />
<h:inputText value="#{caseBean.caseEntity.applicant.email}" />
<h:inputTextarea value="#{caseBean.caseEntity.internalRemarks}" />
```

Tentukan:

1. Form class.
2. View model jika diperlukan.
3. Command ke service.
4. Validation boundary.
5. Authorization rule.

### Latihan 3 — Multi-Tab Failure

Desain ulang bean berikut:

```java
@Named
@SessionScoped
public class EditBean implements Serializable {
    private Long currentCaseId;
    private CaseEditForm form;
}
```

Target:

1. Aman untuk dua tab.
2. Mendukung stale version detection.
3. Tidak menyimpan entity.
4. Tidak menyimpan list besar.

### Latihan 4 — Getter Smell

Cari semua getter di aplikasi legacy yang memanggil service/repository. Klasifikasikan:

1. Harus dipindah ke action/init.
2. Bisa cached per request.
3. Harus menjadi reference data service.
4. Harus diubah menjadi paginated query.

---

## 52. Referensi Resmi dan Lanjutan

1. Jakarta Faces 4.1 Specification — Jakarta EE 11.
2. Jakarta Faces API documentation.
3. Jakarta Contexts and Dependency Injection 4.1 Specification.
4. Jakarta EE Tutorial — CDI and Faces integration.
5. Jakarta Expression Language 6.0 Specification.
6. Jakarta Servlet Specification for request/session/application context semantics.
7. OWASP guidance for server-side rendered UI security.
8. Mojarra and Apache MyFaces implementation documentation.
9. OmniFaces documentation for practical Faces utilities.

---

## 53. Penutup

Part 16 selesai.

Bagian ini adalah fondasi sebelum masuk ke lifecycle detail. Setelah memahami backing bean dan scope, kita bisa membaca Jakarta Faces lifecycle dengan jauh lebih tajam, karena setiap fase lifecycle pada akhirnya memengaruhi:

1. kapan input masuk ke component tree,
2. kapan converter/validator berjalan,
3. kapan backing bean property di-update,
4. kapan action dipanggil,
5. kapan message dibuat,
6. kapan view dirender ulang,
7. kapan state disimpan.

Bagian berikutnya:

```text
17-faces-lifecycle-deep-dive-phase-by-phase-failure-modeling.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./15-facelets-xhtml-view-authoring-templates-composition-components.md">⬅️ Part 15 — Facelets and XHTML View Authoring: Templates, Composition, and Components</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./17-faces-lifecycle-deep-dive-phase-by-phase-failure-modeling.md">Part 17 — Faces Lifecycle Deep Dive: Phase-by-Phase Execution and Failure Modeling ➡️</a>
</div>
