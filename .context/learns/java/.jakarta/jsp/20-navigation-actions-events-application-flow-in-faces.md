# Part 20 — Navigation, Actions, Events, and Application Flow in Faces

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `20-navigation-actions-events-application-flow-in-faces.md`  
> Fokus: memahami bagaimana Jakarta Faces mengubah event dari UI menjadi application flow yang aman, terprediksi, testable, dan maintainable.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. membedakan **action**, **action listener**, **value change listener**, **system event**, dan **component event**;
2. memahami kapan sebuah method dieksekusi dalam lifecycle Faces;
3. mendesain navigation flow yang predictable;
4. memilih antara forward/render response, redirect, dan POST-Redirect-GET;
5. memakai flash scope, view parameter, dan bookmarkable navigation secara benar;
6. membangun multi-step flow/wizard tanpa session bloat;
7. menganalisis bug seperti action tidak terpanggil, navigasi salah, double submit, stale form, dan view expired;
8. memisahkan UI event orchestration dari business operation;
9. menerapkan security, idempotency, dan consistency pada flow enterprise.

Bagian ini bukan sekadar membahas `return "success";`. Itu level permukaan. Level yang lebih dalam adalah memahami bahwa dalam Faces, navigation adalah hasil dari **component event + lifecycle phase + validation state + action outcome + navigation handler + response strategy**.

---

## 1. Mental Model Besar: Faces Flow Bukan URL Routing Biasa

Pada framework request MVC klasik, flow sering terlihat seperti ini:

```text
HTTP request -> controller method -> service -> choose view/redirect
```

Pada Faces, flow lebih kaya karena request masuk ke **component tree**:

```text
HTTP request
  -> FacesServlet
  -> restore/build view tree
  -> decode submitted component values
  -> convert/validate input
  -> update backing model
  -> invoke action/event
  -> determine navigation outcome
  -> render/redirect response
```

Artinya, action method bukan sekadar handler request. Action method adalah **event callback** yang baru dipanggil ketika lifecycle mencapai kondisi yang tepat.

Inilah penyebab klasik:

```java
public String save() {
    // tidak terpanggil
    return "detail";
}
```

Sering kali masalahnya bukan method tersebut salah, tetapi:

1. form tidak tersubmit;
2. command component tidak berada dalam `h:form`;
3. ada validation error di input lain;
4. converter gagal sebelum action;
5. button dirender ulang dengan id berbeda;
6. Ajax `execute` tidak mencakup component yang dibutuhkan;
7. `immediate=true` mengubah phase eksekusi;
8. component tidak ada di tree karena `rendered=false`;
9. view state expired;
10. nested form HTML invalid.

Mental modelnya:

```text
Faces action = lifecycle-gated UI event callback
```

Bukan:

```text
Faces action = raw HTTP endpoint
```

---

## 2. Core Vocabulary

Sebelum masuk lebih jauh, kita perlu membedakan beberapa istilah.

| Istilah | Makna | Biasanya Dipakai Untuk |
|---|---|---|
| Action method | Method backing bean yang mewakili operasi user | save, submit, approve, search, cancel |
| Action outcome | String/object hasil action yang dipakai navigation handler | `"list"`, `"detail?faces-redirect=true"`, `null` |
| Action listener | Listener untuk event command component | logging UI event, set selected row, pre-action setup |
| Value change listener | Listener saat value input berubah dan valid | reactive field behavior, dependent dropdown |
| System event | Event lifecycle/framework-level | pre-render view, post-construct view map |
| Component event | Event pada component tree | Ajax behavior, command event, value change |
| Navigation case | Rule eksplisit/implisit untuk pindah view | page transition |
| Redirect | Browser diminta melakukan request baru | PRG, bookmarkable URL, avoid resubmit |
| Forward/render | Response dirender dalam request yang sama | internal view transition, validation failure |
| Flash scope | Data sementara melewati redirect | success message after save |

---

## 3. Action Method: Pusat User Intent

Action method adalah method yang dipanggil oleh command component seperti:

```xml
<h:commandButton value="Save" action="#{caseForm.save}" />
<h:commandLink value="Approve" action="#{caseDetail.approve}" />
```

Contoh backing bean:

```java
@Named
@ViewScoped
public class CaseFormBean implements Serializable {

    private CaseForm form;

    @Inject
    private CaseApplicationService caseService;

    public String save() {
        Long id = caseService.createCase(form);
        FacesContext.getCurrentInstance()
            .getExternalContext()
            .getFlash()
            .put("successMessage", "Case created successfully");

        return "/case/detail?faces-redirect=true&id=" + id;
    }
}
```

Action method dapat memiliki beberapa bentuk umum:

```java
public String save()
public Object save()
public void save()
public String save(CaseAction action) // tergantung method expression support dan konteks
```

Namun untuk maintainability enterprise, bentuk paling jelas biasanya:

```java
public String save()
```

Karena:

1. input berasal dari bound form model;
2. method name mencerminkan user intent;
3. return value mencerminkan navigation outcome;
4. mudah dites;
5. mudah dilacak dalam review.

---

## 4. Action Outcome: String Kecil yang Menentukan Flow Besar

Action outcome adalah hasil yang diberikan action method ke navigation handler.

Contoh:

```java
public String cancel() {
    return "/case/list?faces-redirect=true";
}
```

Atau:

```java
public String save() {
    service.save(form);
    return null; // stay on same view
}
```

Makna umum:

| Return | Efek |
|---|---|
| `null` | tetap di view saat ini |
| `""` | biasanya tetap di view saat ini, tergantung implementasi |
| `"list"` | implicit navigation ke view outcome `list` |
| `"/case/list"` | absolute logical view path |
| `"/case/list?faces-redirect=true"` | redirect ke view tersebut |
| `"/case/detail?faces-redirect=true&id=10"` | redirect dengan query parameter |

Prinsip penting:

> Outcome bukan business result. Outcome adalah UI transition decision.

Jangan campur seperti ini:

```java
public String approve() {
    return service.approve(caseId); // "APPROVED", "REJECTED", "PENDING_MANAGER"
}
```

Lebih baik:

```java
public String approve() {
    ApprovalResult result = service.approve(caseId);

    if (result.isCompleted()) {
        flashInfo("Case approved");
        return "/case/detail?faces-redirect=true&id=" + caseId;
    }

    if (result.requiresAdditionalInput()) {
        return null;
    }

    throw new IllegalStateException("Unsupported approval result: " + result);
}
```

Karena service result adalah domain concept, sedangkan navigation outcome adalah UI concept.

---

## 5. Forward/Render vs Redirect

Dalam Faces, berpindah halaman bisa terjadi tanpa redirect atau dengan redirect.

### 5.1 Tanpa Redirect

```java
return "/case/detail";
```

Atau navigation internal yang dirender dalam request yang sama.

Ciri:

1. browser URL mungkin tetap URL awal;
2. request attributes masih ada;
3. refresh browser dapat mengulang POST;
4. cocok untuk validation failure atau stay-on-page;
5. kurang cocok setelah mutasi data sukses.

### 5.2 Dengan Redirect

```java
return "/case/detail?faces-redirect=true&id=" + id;
```

Ciri:

1. browser melakukan GET baru;
2. URL berubah;
3. refresh aman karena tidak mengulang POST;
4. request attributes hilang;
5. gunakan flash scope untuk pesan sementara;
6. cocok setelah create/update/delete/approve.

Rule praktis:

```text
If action changes server state successfully -> redirect.
If action fails validation/business rule and user must correct form -> stay on same view.
```

---

## 6. POST-Redirect-GET: Pattern Wajib untuk Mutating Action

POST-Redirect-GET atau PRG:

```text
User submits POST
  -> server processes command
  -> server redirects to GET page
  -> browser loads GET page
  -> refresh repeats only GET
```

Contoh:

```java
public String submit() {
    Long id = applicationService.submit(form);
    flashInfo("Application submitted successfully");
    return "/application/detail?faces-redirect=true&id=" + id;
}
```

Tanpa PRG:

```text
POST save -> render detail
refresh browser -> browser warns/resubmits POST -> duplicate save risk
```

Dengan PRG:

```text
POST save -> redirect GET detail -> refresh GET detail only
```

Untuk enterprise/regulatory system, PRG penting karena:

1. mencegah duplicate submission;
2. membuat audit trail lebih bersih;
3. membuat URL hasil bisa di-bookmark/share sesuai authorization;
4. mengurangi accidental state mutation dari refresh;
5. memisahkan command request dari query/view request.

---

## 7. Flash Scope: Membawa Pesan Melewati Redirect

Karena redirect membuat request baru, request attribute tidak bertahan. Untuk pesan sukses setelah redirect, gunakan flash.

```java
private void flashInfo(String message) {
    FacesContext context = FacesContext.getCurrentInstance();
    context.getExternalContext().getFlash().put("info", message);
}
```

Di view:

```xml
<h:panelGroup rendered="#{not empty flash.info}">
    <div class="alert alert-success">
        <h:outputText value="#{flash.info}" />
    </div>
</h:panelGroup>
```

Gunakan flash untuk:

1. success message;
2. one-time warning;
3. redirect confirmation;
4. transient user feedback.

Jangan gunakan flash untuk:

1. large form object;
2. domain entity;
3. security decision;
4. long-running wizard state;
5. data yang harus durable.

Flash scope adalah “message handoff”, bukan “temporary database”.

---

## 8. Implicit Navigation

Faces mendukung implicit navigation: outcome dapat menunjuk ke view tanpa konfigurasi eksplisit.

```java
public String goToList() {
    return "list";
}
```

Misalnya dari `/case/edit.xhtml`, outcome `list` bisa dicocokkan dengan view yang sesuai tergantung aturan resolusi.

Namun untuk aplikasi besar, lebih baik explicit dalam path:

```java
return "/case/list?faces-redirect=true";
```

Karena:

1. lebih mudah dibaca;
2. lebih stabil saat struktur folder berubah;
3. mengurangi ambiguity;
4. memudahkan grep/search;
5. cocok untuk review arsitektur.

Implicit navigation nyaman untuk aplikasi kecil. Untuk enterprise app besar, explicit logical path lebih defensible.

---

## 9. Explicit Navigation Rules

Legacy/advanced Faces memungkinkan navigation case di `faces-config.xml`:

```xml
<navigation-rule>
    <from-view-id>/case/edit.xhtml</from-view-id>
    <navigation-case>
        <from-outcome>saved</from-outcome>
        <to-view-id>/case/detail.xhtml</to-view-id>
        <redirect />
    </navigation-case>
</navigation-rule>
```

Kelebihan:

1. flow terkonsentrasi;
2. bisa mengatur conditional navigation;
3. membantu pada aplikasi lama;
4. memisahkan outcome name dari file path.

Kekurangan:

1. indirection tinggi;
2. sulit dilacak dari action method;
3. mudah stale;
4. modern Faces sering lebih readable dengan implicit/explicit outcome langsung.

Pattern enterprise yang seimbang:

1. gunakan return path langsung untuk flow sederhana;
2. gunakan navigation rule untuk legacy atau flow yang memang dikelola terpusat;
3. jangan campur tanpa standar.

---

## 10. Bookmarkable Navigation dan GET Page

Tidak semua halaman harus dicapai lewat POST/action. Detail/list/search page sering harus bookmarkable.

Contoh detail page:

```xml
<f:metadata>
    <f:viewParam name="id" value="#{caseDetail.caseId}" required="true" />
    <f:viewAction action="#{caseDetail.load}" />
</f:metadata>
```

URL:

```text
/case/detail.xhtml?id=123
```

Backing bean:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private Long caseId;
    private CaseDetailView detail;

    @Inject
    private CaseQueryService queryService;

    public void load() {
        detail = queryService.findDetail(caseId);
    }

    public Long getCaseId() {
        return caseId;
    }

    public void setCaseId(Long caseId) {
        this.caseId = caseId;
    }
}
```

Manfaat:

1. URL jelas;
2. halaman bisa di-refresh;
3. halaman bisa dibuka di tab baru;
4. browser history lebih sehat;
5. authorization dapat dievaluasi per page load;
6. lebih cocok untuk deep-link enterprise.

Rule:

```text
Query/read screen -> GET + viewParam + viewAction.
Command/mutation -> POST action + PRG.
```

---

## 11. Command Component: Source of User Action

Command component umum:

```xml
<h:commandButton value="Save" action="#{bean.save}" />
<h:commandLink value="Delete" action="#{bean.delete}" />
```

Command component harus berada dalam `h:form`:

```xml
<h:form id="caseForm">
    <h:inputText value="#{bean.form.title}" />
    <h:commandButton value="Save" action="#{bean.save}" />
</h:form>
```

Jika tidak, submit tidak berjalan sebagaimana mestinya.

Hindari nested HTML form:

```xml
<h:form>
    <form> <!-- salah -->
    </form>
</h:form>
```

HTML tidak mendukung nested form dengan benar. Faces juga akan menjadi sulit diprediksi.

---

## 12. Action Method vs Action Listener

### 12.1 Action Method

Action method mewakili user intent utama:

```xml
<h:commandButton value="Approve" action="#{caseDetail.approve}" />
```

```java
public String approve() {
    workflowService.approve(caseId);
    flashInfo("Case approved");
    return "/case/detail?faces-redirect=true&id=" + caseId;
}
```

Gunakan action method untuk:

1. save;
2. submit;
3. approve;
4. reject;
5. assign;
6. delete;
7. search;
8. cancel flow.

### 12.2 Action Listener

Action listener menerima `ActionEvent`:

```xml
<h:commandButton value="Approve"
                 actionListener="#{caseDetail.prepareApproval}"
                 action="#{caseDetail.approve}" />
```

```java
public void prepareApproval(ActionEvent event) {
    // pre-action UI-specific behavior
}
```

Gunakan action listener untuk hal minor terkait component event, misalnya:

1. membaca attribute component;
2. memilih row sebelum action;
3. logging UI event ringan;
4. mempersiapkan state view.

Jangan jadikan action listener sebagai tempat business command utama.

Anti-pattern:

```java
public void approve(ActionEvent event) {
    workflowService.approve(caseId); // business command hidden in listener
}
```

Lebih baik business command tetap di action method.

---

## 13. Passing Parameters to Actions

Ada beberapa cara mengirim parameter.

### 13.1 Method Argument

```xml
<h:commandButton value="Approve" action="#{caseList.approve(row.id)}" />
```

```java
public String approve(Long id) {
    workflowService.approve(id);
    return "/case/list?faces-redirect=true";
}
```

Ini mudah dibaca, tetapi tetap validasi authorization di server.

### 13.2 `f:param`

```xml
<h:commandLink value="View" action="/case/detail?faces-redirect=true">
    <f:param name="id" value="#{row.id}" />
</h:commandLink>
```

### 13.3 `f:setPropertyActionListener`

```xml
<h:commandButton value="Select" action="#{caseList.openSelected}">
    <f:setPropertyActionListener target="#{caseList.selectedId}" value="#{row.id}" />
</h:commandButton>
```

```java
private Long selectedId;

public String openSelected() {
    return "/case/detail?faces-redirect=true&id=" + selectedId;
}
```

Gunakan dengan hati-hati. Terlalu banyak `setPropertyActionListener` membuat flow sulit dilacak.

### 13.4 Hidden Input

Hidden input bisa dipakai, tetapi semua hidden value dari browser harus dianggap tidak trusted.

```xml
<h:inputHidden value="#{bean.form.version}" />
```

Wajib divalidasi server-side.

---

## 14. Value Change Listener

Value change listener dipanggil ketika input value berubah dan valid.

```xml
<h:selectOneMenu value="#{form.category}"
                 valueChangeListener="#{bean.onCategoryChanged}">
    <f:selectItems value="#{bean.categories}" />
    <f:ajax render="subcategoryPanel" />
</h:selectOneMenu>
```

```java
public void onCategoryChanged(ValueChangeEvent event) {
    String newCategory = (String) event.getNewValue();
    subcategories = referenceDataService.findSubcategories(newCategory);
}
```

Cocok untuk:

1. dependent dropdown;
2. recompute UI options;
3. adjust transient view state.

Tidak cocok untuk:

1. final business mutation;
2. irreversible command;
3. audit-sensitive operation;
4. workflow transition.

Alasannya: value change listener terjadi dalam lifecycle input processing, bukan command intent final. User mengganti dropdown belum tentu berarti user ingin submit workflow.

---

## 15. Ajax Behavior Event

Faces Ajax sering menggunakan `f:ajax`:

```xml
<h:inputText value="#{bean.form.postalCode}">
    <f:ajax event="blur"
            listener="#{bean.lookupAddress}"
            execute="@this"
            render="addressPanel messages" />
</h:inputText>
```

```java
public void lookupAddress() {
    form.setAddress(addressService.findByPostalCode(form.getPostalCode()));
}
```

Konsep penting:

| Attribute | Makna |
|---|---|
| `event` | browser/component event yang memicu Ajax |
| `execute` | component mana yang diproses lifecycle-nya |
| `render` | component mana yang dirender ulang |
| `listener` | callback server-side |

Kesalahan umum:

```xml
<f:ajax execute="@this" render="panel" />
```

Lalu listener membutuhkan value dari field lain yang tidak ikut `execute`. Akibatnya backing bean masih punya value lama.

Rule:

```text
Ajax execute = input boundary.
Ajax render = output boundary.
```

Jangan samakan keduanya.

---

## 16. System Events dan PreRenderView

System event berguna untuk hook framework-level.

Contoh pre-render view:

```xml
<f:metadata>
    <f:event type="preRenderView" listener="#{caseDetail.beforeRender}" />
</f:metadata>
```

```java
public void beforeRender() {
    if (!loaded) {
        load();
        loaded = true;
    }
}
```

Namun pada Faces modern, untuk GET page initialization sering lebih jelas memakai:

```xml
<f:viewAction action="#{caseDetail.load}" />
```

Gunakan system event untuk:

1. hook khusus lifecycle;
2. initialization yang harus terjadi sebelum render;
3. framework extension;
4. compatibility legacy.

Jangan jadikan `preRenderView` sebagai controller utama untuk semua logic. Ia mudah terpanggil lebih sering dari yang diperkirakan.

---

## 17. `f:viewAction`: GET Initialization yang Lebih Terkendali

Contoh:

```xml
<f:metadata>
    <f:viewParam name="id" value="#{caseDetail.id}" required="true" />
    <f:viewAction action="#{caseDetail.init}" />
</f:metadata>
```

```java
public void init() {
    detail = queryService.getAuthorizedDetail(id, currentUser.id());
}
```

`f:viewAction` cocok untuk:

1. load data saat page dibuka;
2. authorization check;
3. redirect jika resource tidak valid;
4. canonical GET screen setup.

Contoh redirect jika unauthorized:

```java
public String init() {
    if (!permissionService.canViewCase(currentUser, id)) {
        return "/error/403?faces-redirect=true";
    }
    detail = queryService.findDetail(id);
    return null;
}
```

---

## 18. Navigation with Query Parameters

Untuk redirect dengan parameter:

```java
return "/case/detail?faces-redirect=true&id=" + encode(id);
```

Namun jika parameter lebih kompleks, hindari string concatenation yang raw.

Alternatif lebih bersih:

```java
public String detailOutcome(Long id) {
    return "/case/detail?faces-redirect=true&id=" + id;
}
```

Atau centralized navigation helper:

```java
@ApplicationScoped
public class Navigation {
    public String caseDetail(Long id) {
        return "/case/detail?faces-redirect=true&id=" + id;
    }

    public String caseList() {
        return "/case/list?faces-redirect=true";
    }
}
```

```java
return navigation.caseDetail(id);
```

Manfaat:

1. outcome konsisten;
2. path tidak tersebar;
3. refactoring lebih mudah;
4. dapat dites;
5. mengurangi typo.

---

## 19. Cancel, Back, and Abandon Flow

Cancel sering terlihat sederhana, tetapi secara stateful UI bisa rumit.

```xml
<h:commandButton value="Cancel" action="#{caseForm.cancel}" immediate="true" />
```

```java
public String cancel() {
    return "/case/list?faces-redirect=true";
}
```

Kenapa `immediate=true` sering dipakai pada cancel?

Karena cancel tidak perlu memvalidasi form. Jika user mengisi form invalid lalu klik Cancel, seharusnya bisa keluar.

Tapi hati-hati:

1. `immediate=true` mengubah phase action;
2. model value mungkin belum update;
3. jangan menjalankan business mutation yang bergantung pada input form dalam immediate action;
4. cocok untuk cancel/back/reset/navigation-only.

Pattern:

| Button | `immediate` | Alasan |
|---|---:|---|
| Save | false | butuh conversion/validation/model update |
| Submit | false | butuh valid input |
| Search sederhana | tergantung | kadang butuh validasi minimal |
| Cancel | true | bypass invalid form |
| Back to list | true | navigation only |
| Delete selected row | hati-hati | mungkin tidak perlu semua form valid, tapi butuh valid selected id |

---

## 20. Search Flow

Search adalah kasus menarik karena bisa berupa POST atau GET.

### 20.1 POST Search

```xml
<h:form>
    <h:inputText value="#{caseSearch.criteria.keyword}" />
    <h:commandButton value="Search" action="#{caseSearch.search}" />
</h:form>
```

```java
public String search() {
    results = queryService.search(criteria);
    return null;
}
```

Cocok untuk:

1. search internal;
2. criteria besar;
3. tidak perlu share URL;
4. simple admin page.

### 20.2 GET Search

```text
/case/list.xhtml?status=OPEN&keyword=fraud
```

Dengan `f:viewParam`:

```xml
<f:metadata>
    <f:viewParam name="status" value="#{caseSearch.criteria.status}" />
    <f:viewParam name="keyword" value="#{caseSearch.criteria.keyword}" />
    <f:viewAction action="#{caseSearch.search}" />
</f:metadata>
```

Cocok untuk:

1. bookmarkable search;
2. shareable filter;
3. audit/reproduce issue;
4. browser history support.

Rule enterprise:

```text
Search/list screens that support operational workflow should prefer GET criteria when practical.
```

---

## 21. Multi-Step Form / Wizard Flow

Wizard contoh:

```text
Step 1: Applicant
Step 2: Documents
Step 3: Review
Step 4: Submit
```

Pilihan state:

| Strategy | Kapan Cocok | Risiko |
|---|---|---|
| View scope per page | simple wizard, state kecil | back/forward complexity |
| Conversation scope | multi-page bounded flow | lifecycle management |
| Database draft | long-running form | cleanup/versioning |
| Session object | quick implementation | session bloat, multi-tab conflict |
| Faces flow | self-contained page set | complexity, library/container nuance |

Untuk enterprise/regulatory system, sering paling aman:

```text
Persist draft early + use GET page id + validate per step + final submit command
```

Contoh:

```java
public String saveStep1() {
    draftService.updateApplicant(draftId, applicantForm);
    return "/application/step2?faces-redirect=true&draftId=" + draftId;
}
```

Manfaat:

1. refresh aman;
2. session tidak besar;
3. draft bisa dipulihkan;
4. concurrent update bisa dikontrol;
5. audit lebih jelas;
6. user bisa lanjut nanti.

---

## 22. Faces Flow

Faces memiliki konsep flow untuk kumpulan halaman self-contained.

Mental model:

```text
Flow = bounded set of views + scoped state + entry/exit points
```

Cocok untuk:

1. checkout-like process;
2. self-contained wizard;
3. reusable page set;
4. state lebih panjang dari request tapi lebih pendek dari session.

Namun banyak aplikasi enterprise lebih memilih explicit draft state di database karena:

1. lebih durable;
2. lebih mudah diaudit;
3. lebih mudah recovery;
4. lebih jelas dalam distributed deployment;
5. lebih mudah diintegrasikan dengan workflow engine.

Jadi Faces Flow bukan salah. Tetapi jangan jadikan flow scope sebagai pengganti durable business process state.

---

## 23. Events vs Commands: Batas Semantik Penting

Top-tier engineer membedakan event UI dari command domain.

UI event:

```text
User clicked Approve button
```

Domain command:

```text
Approve case as Senior Officer with decision reason X
```

View action method harus menjadi adapter:

```java
public String approve() {
    ApproveCaseCommand command = new ApproveCaseCommand(
        caseId,
        form.getDecisionReason(),
        currentUser.id(),
        form.getVersion()
    );

    workflowService.approve(command);
    flashInfo("Case approved");
    return navigation.caseDetail(caseId);
}
```

Jangan buat service bergantung pada Faces API:

```java
// buruk
public void approve(FacesContext context) { ... }
```

Service harus menerima domain/application command, bukan UI framework object.

---

## 24. Idempotency dan Double Submit

Double submit bisa terjadi karena:

1. user double-click;
2. browser retry;
3. network timeout;
4. user refresh POST;
5. back button lalu submit ulang;
6. Ajax request paralel.

Mitigasi:

### 24.1 PRG

Setelah mutasi sukses, redirect.

### 24.2 Disable Button Client-Side

Berguna untuk UX, tetapi bukan security guarantee.

### 24.3 Server-Side Idempotency Key

Untuk command penting:

```java
public String submit() {
    SubmitApplicationCommand command = new SubmitApplicationCommand(
        draftId,
        form.getVersion(),
        form.getIdempotencyKey(),
        currentUser.id()
    );

    SubmitResult result = service.submit(command);
    return navigation.applicationDetail(result.applicationId());
}
```

### 24.4 Optimistic Locking

Gunakan version field:

```java
if (!Objects.equals(command.version(), entity.getVersion())) {
    throw new ConcurrentModificationException();
}
```

### 24.5 State Transition Guard

Workflow harus validasi current state:

```text
DRAFT -> SUBMITTED allowed
SUBMITTED -> SUBMITTED rejected/idempotent
APPROVED -> SUBMITTED invalid
```

Jangan mengandalkan tombol tidak tampil sebagai satu-satunya proteksi.

---

## 25. Authorization in Flow

View boleh menyembunyikan tombol:

```xml
<h:commandButton value="Approve"
                 rendered="#{permission.canApprove(caseDetail.case)}"
                 action="#{caseDetail.approve}" />
```

Tapi action tetap harus enforce:

```java
public String approve() {
    if (!permissionService.canApprove(currentUser, caseId)) {
        throw new ForbiddenException();
    }

    workflowService.approve(caseId, currentUser.id());
    flashInfo("Case approved");
    return navigation.caseDetail(caseId);
}
```

Dan service/workflow layer juga harus enforce state transition.

Layering yang aman:

```text
View rendered condition = usability
Backing action check = request boundary protection
Service/workflow check = business invariant protection
Database/constraint = data integrity backstop
```

---

## 26. Error Handling in Navigation Flow

Action method harus membedakan jenis failure.

### 26.1 Validation Failure

Faces validation failure biasanya tetap di halaman yang sama.

### 26.2 Business Rule Failure yang Bisa Diperbaiki User

```java
public String submit() {
    try {
        service.submit(commandFromForm());
        flashInfo("Submitted");
        return navigation.detail(caseId);
    } catch (BusinessRuleViolation e) {
        addGlobalError(e.getUserMessage());
        return null;
    }
}
```

### 26.3 Forbidden

```java
throw new ForbiddenException();
```

Map ke 403 page via exception handler/filter.

### 26.4 Not Found

```java
throw new NotFoundException();
```

Map ke 404.

### 26.5 Conflict/Stale Version

```java
catch (OptimisticLockException e) {
    addGlobalError("This case was updated by another user. Please reload and try again.");
    reloadCurrentData();
    return null;
}
```

### 26.6 Unexpected Technical Failure

Log with correlation id, show generic error.

Jangan return `"error"` untuk semua exception. Itu menyembunyikan failure semantics.

---

## 27. Messages and Navigation

Faces messages bisa dipakai untuk error/success.

```java
FacesContext.getCurrentInstance().addMessage(null,
    new FacesMessage(FacesMessage.SEVERITY_ERROR, "Invalid decision", null));
```

Di view:

```xml
<h:messages globalOnly="true" />
```

Untuk redirect, pastikan message survive. Bisa gunakan flash:

```java
FacesContext context = FacesContext.getCurrentInstance();
context.getExternalContext().getFlash().setKeepMessages(true);
context.addMessage(null, new FacesMessage("Saved successfully"));
return navigation.detail(id);
```

Namun untuk kontrol enterprise, sering lebih jelas pakai flash key sendiri untuk success message dan FacesMessage untuk validation/business error di same page.

---

## 28. Designing an Enterprise Navigation Helper

Aplikasi besar akan punya banyak string outcome. Hindari magic string tersebar.

Contoh:

```java
@ApplicationScoped
public class AppNavigation {

    public String caseList() {
        return "/case/list?faces-redirect=true";
    }

    public String caseDetail(Long caseId) {
        return "/case/detail?faces-redirect=true&id=" + caseId;
    }

    public String caseEdit(Long caseId) {
        return "/case/edit?faces-redirect=true&id=" + caseId;
    }

    public String forbidden() {
        return "/error/403?faces-redirect=true";
    }
}
```

Gunakan:

```java
@Inject
private AppNavigation nav;

public String save() {
    Long id = service.save(form);
    return nav.caseDetail(id);
}
```

Keuntungan:

1. standardisasi redirect;
2. mengurangi typo;
3. mudah dites;
4. path refactor lebih aman;
5. query parameter convention terpusat.

---

## 29. Application Flow Example: Regulatory Case Detail Page

Bayangkan halaman detail case dengan aksi:

1. assign;
2. request information;
3. approve;
4. reject;
5. escalate;
6. close;
7. back to list.

### 29.1 View

```xml
<h:form id="caseActions">
    <h:messages globalOnly="true" />

    <h:commandButton value="Approve"
                     rendered="#{caseDetail.canApprove}"
                     action="#{caseDetail.approve}" />

    <h:commandButton value="Reject"
                     rendered="#{caseDetail.canReject}"
                     action="#{caseDetail.reject}" />

    <h:commandButton value="Escalate"
                     rendered="#{caseDetail.canEscalate}"
                     action="#{caseDetail.escalate}" />

    <h:commandButton value="Back"
                     action="#{caseDetail.back}"
                     immediate="true" />
</h:form>
```

### 29.2 Bean

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private Long id;
    private CaseDetailView caseView;
    private CaseDecisionForm decisionForm = new CaseDecisionForm();

    @Inject CaseQueryService queryService;
    @Inject CaseWorkflowService workflowService;
    @Inject PermissionService permissionService;
    @Inject CurrentUser currentUser;
    @Inject AppNavigation nav;

    public void load() {
        caseView = queryService.getDetail(id, currentUser.id());
    }

    public boolean isCanApprove() {
        return permissionService.canApprove(currentUser, caseView);
    }

    public String approve() {
        ensureCanApprove();

        workflowService.approve(new ApproveCaseCommand(
            id,
            decisionForm.getReason(),
            caseView.version(),
            currentUser.id()
        ));

        flashInfo("Case approved");
        return nav.caseDetail(id);
    }

    public String back() {
        return nav.caseList();
    }

    private void ensureCanApprove() {
        if (!permissionService.canApprove(currentUser, caseView)) {
            throw new ForbiddenException();
        }
    }
}
```

### 29.3 Flow Invariants

```text
Invariant 1: button visibility is not authorization.
Invariant 2: action method validates permission again.
Invariant 3: workflow service validates state transition.
Invariant 4: version prevents stale update.
Invariant 5: successful mutation redirects.
Invariant 6: failure user can fix remains same view.
Invariant 7: success message crosses redirect via flash.
```

---

## 30. Common Failure Modes and Diagnosis

### 30.1 Action Not Called

Checklist:

1. Is button inside `h:form`?
2. Is there nested HTML form?
3. Does validation fail before Invoke Application?
4. Are messages rendered?
5. Is `immediate=true` changing phase?
6. Is component rendered during restore view?
7. Is Ajax `execute` correct?
8. Is view state valid?
9. Is there JavaScript error blocking submit?
10. Is command component disabled?

### 30.2 Navigation Outcome Ignored

Possible causes:

1. action method returns `null`;
2. exception occurs before return;
3. validation failure prevents action;
4. wrong method called;
5. outcome path invalid;
6. response already completed;
7. custom navigation handler intercepts.

### 30.3 Success Message Missing After Redirect

Possible causes:

1. message stored in request, not flash;
2. `Flash#setKeepMessages(true)` not used;
3. target page does not render messages;
4. redirect to different context/path;
5. message consumed earlier.

### 30.4 Duplicate Submit

Possible causes:

1. no PRG;
2. no idempotency key;
3. no optimistic locking;
4. slow server response;
5. user double-click;
6. browser retry.

### 30.5 Back Button Weirdness

Possible causes:

1. view state expired;
2. stateful view scope conflicts;
3. browser cache shows stale page;
4. domain object changed after page rendered;
5. no version check;
6. multi-tab modifies same entity.

---

## 31. Testing Navigation and Actions

### 31.1 Unit Test Action Method

```java
@Test
void approveReturnsDetailRedirect() {
    bean.setId(10L);
    bean.setCaseView(new CaseDetailView(10L, 7L));

    when(permissionService.canApprove(user, bean.getCaseView())).thenReturn(true);

    String outcome = bean.approve();

    verify(workflowService).approve(any(ApproveCaseCommand.class));
    assertEquals("/case/detail?faces-redirect=true&id=10", outcome);
}
```

### 31.2 Test Forbidden

```java
@Test
void approveRejectsUnauthorizedUser() {
    when(permissionService.canApprove(any(), any())).thenReturn(false);

    assertThrows(ForbiddenException.class, () -> bean.approve());
    verifyNoInteractions(workflowService);
}
```

### 31.3 Integration Test

Test with container/browser-level tool:

1. open edit page;
2. submit invalid form;
3. assert action does not mutate data;
4. assert error messages shown;
5. submit valid form;
6. assert redirect URL;
7. refresh page;
8. assert no duplicate mutation.

### 31.4 Security Flow Test

1. user without role opens page;
2. approve button hidden;
3. user crafts POST manually;
4. server returns 403;
5. workflow state unchanged.

This is critical. Testing only hidden button is insufficient.

---

## 32. Java 8 to Java 25 Considerations

Faces flow concepts are mostly stable, but runtime context changes.

### Java 8 Legacy

Common stack:

```text
Java 8 + Java EE 7/8 + JSF 2.x + javax.faces.*
```

Concerns:

1. old managed bean annotations;
2. older CDI integration;
3. legacy `faces-config.xml` navigation;
4. older libraries;
5. weaker modern test/tooling support.

### Java 11/17 Migration

Concerns:

1. dependency cleanup;
2. stronger module/reflection constraints;
3. application server compatibility;
4. namespace transition planning.

### Java 21/25 Modern Runtime

Concerns:

1. Jakarta EE 10/11 style `jakarta.*`;
2. Java 17+ baseline for Jakarta EE 11;
3. cleaner CDI alignment;
4. removed SecurityManager assumptions;
5. virtual threads may help request concurrency in some containers, but do not remove UI state/lifecycle complexity.

Important:

```text
New Java runtime does not make stateful UI flow automatically safe.
```

You still need:

1. PRG;
2. idempotency;
3. optimistic locking;
4. authorization enforcement;
5. state scope discipline;
6. lifecycle-aware debugging.

---

## 33. Migration Notes: `javax.faces` to `jakarta.faces`

Common migration areas:

| Old | New |
|---|---|
| `javax.faces.*` | `jakarta.faces.*` |
| `javax.el.*` | `jakarta.el.*` |
| `javax.enterprise.*` | `jakarta.enterprise.*` |
| `javax.validation.*` | `jakarta.validation.*` |
| old JSF libraries | Jakarta-compatible versions |

Navigation strings may still look similar, but dependencies and tag namespaces/library compatibility matter.

Checklist:

1. upgrade container first in compatibility matrix;
2. upgrade Faces implementation/library;
3. migrate imports;
4. check Facelets namespaces;
5. check `faces-config.xml` schema;
6. retest actions and navigation;
7. retest Ajax execute/render;
8. retest flash message after redirect;
9. retest multi-tab/view state behavior;
10. retest security crafted POST.

---

## 34. Design Heuristics for Top-Tier Engineering

1. **Treat action as command adapter.**  
   It converts UI state into application command.

2. **Successful mutation should redirect.**  
   Avoid duplicate POST and refresh mutation.

3. **GET pages should be bookmarkable when possible.**  
   Use `f:viewParam` and `f:viewAction`.

4. **Visibility is not authorization.**  
   Button hiding improves UX, not security.

5. **Do not put business operation in listeners.**  
   Use action methods for intent.

6. **Ajax execute/render must be explicit.**  
   Know what input is processed and what output is refreshed.

7. **Do not use session as flow dumping ground.**  
   Use draft persistence or bounded flow state.

8. **Every mutating action needs failure semantics.**  
   Validation, business rule, forbidden, not found, conflict, technical error are different.

9. **State transition belongs in service/workflow layer.**  
   Faces should not be the only guard.

10. **Navigation strings deserve structure.**  
    Centralize common outcomes in helper constants/classes.

---

## 35. Review Checklist

For each Faces page with actions:

- [ ] Are command components inside exactly one valid `h:form`?
- [ ] Are mutating actions followed by redirect?
- [ ] Are success messages preserved across redirect?
- [ ] Are validation errors rendered near the form?
- [ ] Are action methods free of raw UI framework leakage into services?
- [ ] Are action listeners only used for UI event concerns?
- [ ] Are permission checks enforced server-side?
- [ ] Is hidden input treated as untrusted?
- [ ] Is stale version/concurrent update handled?
- [ ] Is double submit mitigated?
- [ ] Are GET pages bookmarkable where useful?
- [ ] Are `f:viewParam` values validated/converted?
- [ ] Are Ajax `execute` and `render` scopes correct?
- [ ] Are cancel/back buttons using `immediate=true` only when appropriate?
- [ ] Is session state bounded?
- [ ] Are flow failures logged with correlation id?
- [ ] Are crafted POST/security tests included?

---

## 36. Key Takeaways

Jakarta Faces navigation is not just page routing. It is the result of a component lifecycle.

The most important mental model:

```text
User gesture
  -> component event
  -> lifecycle phase
  -> conversion/validation/model update
  -> action/listener
  -> outcome
  -> navigation handler
  -> render or redirect
```

For simple applications, returning strings from action methods may feel enough. For enterprise/regulatory systems, you need stronger discipline:

1. action methods represent user intent;
2. service layer enforces business invariant;
3. workflow layer validates state transition;
4. authorization is checked beyond view rendering;
5. successful mutation uses PRG;
6. GET screens are bookmarkable;
7. flow state is bounded and recoverable;
8. failures are semantically separated.

This is the difference between “a JSF page works” and “a Faces application is operationally defensible”.

---

## 37. Where This Leads Next

Part 20 focused on navigation, actions, events, and flow.

Next part:

```text
21-faces-state-management-server-client-view-expiry-memory.md
```

The next topic goes deeper into one of the hardest areas in Faces: state saving. We will analyze server-side state, client-side state, view state token, partial state saving, session memory pressure, clustering, view expiry, multi-tab behavior, serialization, and security of stateful component trees.

