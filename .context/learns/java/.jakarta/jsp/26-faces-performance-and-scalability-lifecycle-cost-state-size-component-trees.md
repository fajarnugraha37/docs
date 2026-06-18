# Part 26 — Faces Performance and Scalability: Lifecycle Cost, State Size, Component Trees

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `26-faces-performance-and-scalability-lifecycle-cost-state-size-component-trees.md`  
> Fokus: memahami biaya runtime Jakarta Faces dari sisi lifecycle, component tree, state saving, session memory, Ajax, data table, EL binding, rendering, dan operasi production.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kita ingin punya kemampuan untuk:

1. Membaca aplikasi Jakarta Faces dari sudut pandang **runtime cost**, bukan hanya syntax view.
2. Memahami kenapa Faces bisa terasa berat jika component tree, view state, session, data table, dan binding tidak dikendalikan.
3. Membedakan bottleneck di:
   - restore view,
   - validation,
   - update model,
   - invoke application,
   - render response,
   - serialization,
   - database/service call,
   - browser payload.
4. Mendesain view Faces yang scalable untuk enterprise system:
   - banyak user,
   - banyak form,
   - banyak role,
   - banyak data table,
   - banyak partial request,
   - session timeout,
   - clustering.
5. Menentukan state strategy:
   - server-side state,
   - client-side state,
   - view scope,
   - request scope,
   - stateless rendering,
   - PRG.
6. Membuat performance checklist yang bisa dipakai untuk review aplikasi Faces nyata.

---

## 2. Mental Model Utama: Faces Tidak Sama dengan Template Engine Biasa

JSP/Jakarta Pages pada dasarnya adalah **request template rendering**.

Faces adalah **component lifecycle framework**.

Perbedaan ini penting.

Pada JSP sederhana:

```text
HTTP request
  -> controller prepares model
  -> JSP evaluates EL/tags
  -> HTML response
```

Pada Faces:

```text
HTTP request
  -> restore/build component tree
  -> decode submitted values
  -> convert/validate
  -> update model
  -> invoke application
  -> render component tree
  -> save view state
  -> HTML response
```

Karena Faces menyimpan dan memproses component tree, cost-nya tidak hanya berasal dari HTML yang terlihat. Ada cost tambahan:

1. component tree creation/restoration,
2. request value decoding,
3. converter/validator execution,
4. model update via EL,
5. action invocation,
6. component rendering,
7. view state serialization,
8. hidden `ViewState` field generation,
9. session state retention,
10. partial rendering calculation untuk Ajax.

Jadi untuk performance, pertanyaan yang benar bukan:

> “Halaman ini HTML-nya besar atau kecil?”

Melainkan:

> “Berapa besar component tree-nya, berapa state yang disimpan, berapa binding dievaluasi, berapa service/database call terjadi saat lifecycle, dan berapa payload yang dikirim ke browser?”

---

## 3. Performance Cost Map Jakarta Faces

Secara kasar, satu request Faces bisa dilihat seperti ini:

```text
Client
  |
  | HTTP request / Ajax request
  v
FacesServlet
  |
  |-- Restore View
  |     - build/restore component tree
  |     - restore state
  |     - resolve view declaration
  |
  |-- Apply Request Values
  |     - decode submitted request parameters
  |     - apply submitted values to components
  |
  |-- Process Validations
  |     - conversion
  |     - required validation
  |     - custom validation
  |     - Bean Validation
  |
  |-- Update Model Values
  |     - EL setValue to backing bean/model
  |
  |-- Invoke Application
  |     - action method
  |     - navigation
  |     - business service call
  |
  |-- Render Response
  |     - encode components
  |     - evaluate getters/EL
  |     - render resources
  |     - save view state
  |
  v
HTTP response
```

Setiap fase punya kemungkinan bottleneck berbeda.

| Area | Cost utama | Gejala |
|---|---:|---|
| Restore View | component tree + state restore | request lambat sebelum action jalan |
| Apply Request Values | decode banyak input | form besar lambat submit |
| Process Validations | converter/validator mahal | action tidak jalan, CPU tinggi |
| Update Model Values | EL setter/model graph | update lambat, exception nested |
| Invoke Application | service/database | request lambat karena business logic |
| Render Response | component rendering + getter | halaman lambat walau service cepat |
| Save State | serialization/encryption/base64/session | response lambat, hidden field besar, session bloat |
| Ajax Partial Render | execute/render target | response kecil tapi server tetap berat |

---

## 4. Prinsip Pertama: Performance Faces Adalah Fungsi dari State dan Tree

Untuk Faces, dua variabel yang sangat menentukan adalah:

```text
Runtime cost ≈ f(component tree size, view state size, lifecycle work, backend calls, rendered payload)
```

Lebih konkret:

```text
Cost per request =
  restore_component_tree_cost
+ decode_component_cost
+ conversion_validation_cost
+ model_update_cost
+ action/service_cost
+ render_component_cost
+ save_state_cost
+ network_payload_cost
```

Jika halaman punya 2.000 komponen, walaupun hanya satu tombol diklik, framework tetap harus cukup memahami view untuk menjalankan lifecycle dengan benar.

Ajax dapat membatasi `execute` dan `render`, tetapi Ajax tidak menghilangkan seluruh biaya view state dan lifecycle.

---

## 5. Lifecycle Cost per Phase

### 5.1 Restore View

Restore View adalah fase di mana Faces membangun atau mengembalikan view.

Pada initial request:

```text
GET /case/detail.xhtml?id=123
  -> build component tree from XHTML
  -> evaluate build-time tags
  -> prepare view
```

Pada postback:

```text
POST /case/detail.xhtml
  -> read ViewState
  -> restore component tree/state
  -> continue lifecycle
```

Bottleneck umum:

1. XHTML terlalu kompleks.
2. Banyak include dinamis.
3. Banyak composite component nested.
4. Banyak conditional build-time tag.
5. View state besar.
6. Session state tidak scalable.
7. Dynamic component tree tidak stabil.

Gejala:

1. action method belum terpanggil tetapi request sudah lambat,
2. CPU tinggi di restore/build view,
3. memory allocation tinggi,
4. `ViewExpiredException`,
5. intermittent component not found pada Ajax.

### 5.2 Apply Request Values

Fase ini memproses parameter request dan menempatkannya sebagai submitted value di component.

Cost naik jika:

1. form terlalu besar,
2. banyak input hidden,
3. banyak data table row editable,
4. banyak checkbox/select many,
5. banyak nested naming container.

Anti-pattern:

```xml
<h:form>
  <!-- seluruh halaman besar berada dalam satu form -->
  <ui:include src="header.xhtml" />
  <ui:include src="case-detail.xhtml" />
  <ui:include src="audit-history.xhtml" />
  <ui:include src="document-list.xhtml" />
  <ui:include src="workflow-actions.xhtml" />
</h:form>
```

Lebih baik:

```xml
<h:form id="caseActionForm">
  <!-- hanya area yang butuh submit -->
  <h:inputTextarea value="#{caseActionBean.comment}" />
  <h:commandButton value="Approve" action="#{caseActionBean.approve}" />
</h:form>
```

Prinsip:

> Jangan bungkus seluruh page dalam satu form jika hanya sebagian kecil yang perlu submit.

### 5.3 Process Validations

Fase ini dapat mahal karena:

1. converter memanggil database,
2. validator memanggil service remote,
3. Bean Validation memvalidasi graph besar,
4. regex validation terlalu kompleks,
5. cross-field validation dilakukan berulang,
6. select item converter tidak efisien.

Contoh buruk:

```java
@FacesConverter("agencyConverter")
public class AgencyConverter implements Converter<Agency> {
    @Override
    public Agency getAsObject(FacesContext context, UIComponent component, String value) {
        // Buruk: DB hit setiap conversion dalam render/submit path
        return agencyRepository.findById(Long.valueOf(value));
    }
}
```

Lebih aman:

```java
@ApplicationScoped
@Named
public class AgencyCatalog {
    private volatile Map<Long, AgencyOption> byId = Map.of();

    public AgencyOption findOption(long id) {
        return byId.get(id);
    }
}
```

Lalu converter hanya melakukan lookup ringan terhadap option map yang memang sudah disiapkan untuk view.

Prinsip:

> Converter dan validator harus murah, deterministik, dan tidak menjadi gateway tersembunyi ke database besar.

### 5.4 Update Model Values

Fase ini menyalin local value component ke backing bean/model.

Cost bisa membesar jika:

1. setter melakukan logic berat,
2. setter memicu lazy loading,
3. model object terlalu kompleks,
4. nested property path panjang,
5. entity JPA langsung di-bind ke UI.

Contoh berisiko:

```xml
<h:inputText value="#{caseBean.caseEntity.applicant.profile.address.postalCode}" />
```

Masalah:

1. UI tahu terlalu banyak struktur domain.
2. Lazy loading bisa terjadi saat render/update.
3. Entity menjadi mutable dari UI.
4. Error sulit dilacak.

Lebih baik:

```java
public class CaseForm {
    private String postalCode;
    private String applicantName;
    private String contactEmail;
}
```

```xml
<h:inputText value="#{caseEditBean.form.postalCode}" />
```

Prinsip:

> Bind UI ke form/view model, bukan langsung ke aggregate/entity kompleks.

### 5.5 Invoke Application

Ini biasanya tempat action method jalan.

Contoh:

```java
public String approve() {
    caseService.approve(form.toCommand());
    facesMessages.info("Case approved.");
    return "/case/detail?faces-redirect=true&id=" + form.getCaseId();
}
```

Performance issue di fase ini lebih mirip backend biasa:

1. query lambat,
2. transaction terlalu panjang,
3. lock contention,
4. remote service lambat,
5. file processing blocking,
6. email sending synchronous,
7. audit trail terlalu berat.

Tapi di Faces, gejalanya sering tersamar karena user melihat “page submit lambat”.

Prinsip:

> Pisahkan metrik lifecycle/render dari metrik service/action agar bottleneck tidak salah dituduh sebagai “JSF lambat”.

### 5.6 Render Response

Render Response sering menjadi sumber bottleneck yang diremehkan.

Penyebab umum:

1. getter mahal,
2. getter memanggil repository/service,
3. data table besar,
4. conditional rendering kompleks,
5. permission check per row,
6. nested composite component,
7. banyak output component,
8. resource bundling buruk,
9. view state besar.

Contoh buruk:

```java
public List<CaseRow> getCases() {
    return caseService.search(criteria); // dipanggil berkali-kali saat render
}
```

Lebih baik:

```java
@PostConstruct
public void init() {
    this.cases = caseService.search(criteria);
}

public List<CaseRow> getCases() {
    return cases;
}
```

Atau untuk search explicit:

```java
public void search() {
    this.cases = caseService.search(criteria);
}
```

Prinsip:

> Getter dalam Faces harus dianggap bisa dipanggil berkali-kali. Jangan taruh expensive work di getter.

---

## 6. Getter Discipline: Salah Satu Rule Terpenting Faces

Dalam Faces, getter dapat dipanggil:

1. saat build view,
2. saat render,
3. saat validation message rendering,
4. saat repeated component processing,
5. saat Ajax partial render,
6. saat component library mengevaluasi atribut.

Jadi getter harus:

1. murah,
2. bebas side effect,
3. tidak memanggil DB/service remote,
4. tidak mengubah state,
5. idempotent,
6. predictable.

Buruk:

```java
public boolean isCanApprove() {
    return permissionService.canApprove(currentUser(), caseId); // mungkin dipanggil banyak kali
}
```

Lebih baik:

```java
@PostConstruct
public void init() {
    CasePermission permission = permissionService.evaluate(currentUser(), caseId);
    this.canApprove = permission.canApprove();
    this.canReject = permission.canReject();
    this.canAssign = permission.canAssign();
}

public boolean isCanApprove() {
    return canApprove;
}
```

Untuk data per row:

```java
public class CaseRow {
    private boolean canView;
    private boolean canAssign;
    private boolean canEscalate;
}
```

Jangan:

```xml
<h:commandLink rendered="#{permissionBean.canEscalate(row.id)}" />
```

Jika ada 100 row dan 5 tombol per row, permission service bisa dieksekusi ratusan kali saat render.

---

## 7. Component Tree Size

Component tree adalah struktur object server-side yang merepresentasikan view.

Contoh sederhana:

```xml
<h:form id="form">
  <h:panelGroup id="summary">
    <h:outputText value="#{caseBean.referenceNo}" />
  </h:panelGroup>
  <h:commandButton value="Save" action="#{caseBean.save}" />
</h:form>
```

Secara konseptual menjadi:

```text
UIViewRoot
  └─ HtmlForm(form)
      ├─ HtmlPanelGroup(summary)
      │   └─ HtmlOutputText
      └─ HtmlCommandButton
```

Semakin besar tree:

1. semakin besar restore cost,
2. semakin besar render traversal,
3. semakin besar state saving,
4. semakin besar memory allocation,
5. semakin tinggi risiko duplicate id/naming issue,
6. semakin mahal Ajax component lookup.

### 7.1 Sumber Tree Bloat

1. Terlalu banyak nested layout component.
2. Terlalu banyak composite component wrapper.
3. Data table besar tanpa pagination.
4. Banyak komponen input tersembunyi.
5. Rendering menu besar di setiap halaman.
6. Permission-driven buttons untuk semua row.
7. Component library yang generate banyak markup/component.
8. Dynamic component creation tidak terkontrol.

### 7.2 Rule of Thumb

Gunakan komponen Faces untuk bagian yang butuh lifecycle:

1. form input,
2. validation,
3. action,
4. Ajax update,
5. message,
6. stateful interaction.

Gunakan plain HTML untuk static markup:

```xml
<section class="case-summary">
  <h:outputText value="#{caseBean.summary.referenceNo}" />
</section>
```

Tidak semua `<div>` harus menjadi `h:panelGroup`.

---

## 8. View State Size

Faces menyimpan state view agar postback berikutnya bisa restore tree dan component state.

View state dapat disimpan:

1. server-side,
2. client-side.

### 8.1 Server-Side State Saving

Konsep:

```text
Browser hidden field contains token
Server session contains actual state
```

Kelebihan:

1. payload browser lebih kecil,
2. state tidak langsung terekspos ke client,
3. lebih cocok untuk sensitive state.

Kekurangan:

1. session memory naik,
2. clustering/replication mahal,
3. sticky session sering diperlukan,
4. user dengan banyak tab dapat menambah state,
5. session expiration menyebabkan view expired.

### 8.2 Client-Side State Saving

Konsep:

```text
Browser hidden field contains serialized encoded state
Server does not need store full view state in session
```

Kelebihan:

1. server memory lebih rendah,
2. lebih cluster-friendly,
3. tidak terlalu bergantung pada sticky session.

Kekurangan:

1. response payload lebih besar,
2. request payload saat postback lebih besar,
3. serialization/signing/encryption cost,
4. sensitive state tidak boleh sembarangan masuk state,
5. network latency meningkat.

### 8.3 State Size Budget

Untuk halaman enterprise, jangan biarkan view state menjadi tidak terlihat.

Checklist:

1. ukur panjang hidden `jakarta.faces.ViewState`,
2. ukur response HTML total,
3. ukur POST payload,
4. ukur session memory per user,
5. ukur jumlah logical views per session,
6. ukur waktu restore/save state,
7. ukur serialization allocation.

Contoh risk threshold informal:

| Item | Kondisi sehat | Kondisi mencurigakan |
|---|---:|---:|
| HTML response | < 300 KB | > 1 MB |
| ViewState hidden field | kecil/terukur | ratusan KB atau MB |
| Component count | ratusan | ribuan/puluhan ribu |
| Rows rendered | page-size kecil | ribuan row |
| Session per user | terukur | MB besar/user |
| Ajax response | kecil | mengirim ulang area besar |

Angka ini bukan standar absolut, tapi membantu review awal.

---

## 9. Session Memory Pressure

Faces sering memakai session untuk:

1. server-side view state,
2. `@SessionScoped` bean,
3. `@ViewScoped` backing state,
4. flash message,
5. user context,
6. cached option lists,
7. wizard state,
8. component library state.

Masalah terjadi ketika session menjadi tempat menyimpan semua hal.

Anti-pattern:

```java
@SessionScoped
@Named
public class CaseWorkspaceBean implements Serializable {
    private List<CaseEntity> searchResults;      // ribuan entity
    private CaseEntity selectedCase;             // graph besar
    private List<DocumentBlob> uploadedFiles;    // binary besar
    private Map<String, Object> tempData;         // tidak jelas ownership
}
```

Lebih baik:

```java
@ViewScoped
@Named
public class CaseSearchBean implements Serializable {
    private CaseSearchCriteria criteria;
    private List<CaseRow> currentPage;
    private PageInfo pageInfo;
}
```

Dan untuk file upload:

```text
upload temp file -> store metadata/id in view -> process final action -> cleanup
```

Jangan simpan binary besar dalam session.

---

## 10. Scope dan Performance

| Scope | Cocok untuk | Risiko performance |
|---|---|---|
| Request | GET/search ringan, stateless action | reload data tiap request |
| View | screen interaction, form state | view state/session growth |
| Session | user preference, auth context ringan | memory bloat, stale state |
| Application | catalog/cache immutable | cross-user mutation, stale cache |
| Conversation | wizard panjang | lifecycle cleanup sulit |

Rule:

> Pilih scope paling sempit yang masih benar secara behavior.

Jangan memakai session scope karena “mudah”.

---

## 11. Data Table Performance

Data table adalah salah satu sumber bottleneck terbesar.

Contoh sederhana:

```xml
<h:dataTable value="#{caseSearchBean.results}" var="row">
  <h:column>
    <h:outputText value="#{row.referenceNo}" />
  </h:column>
  <h:column>
    <h:outputText value="#{row.status}" />
  </h:column>
  <h:column>
    <h:commandLink value="View" action="#{caseSearchBean.view(row.id)}" />
  </h:column>
</h:dataTable>
```

Jika `results` berisi 10.000 row, maka masalahnya bukan hanya query. Masalahnya:

1. server membuat banyak component/row rendering,
2. HTML response sangat besar,
3. browser layout lambat,
4. memory allocation tinggi,
5. view state membesar,
6. action link per row bisa membawa state/action context,
7. permission check per row mahal.

### 11.1 Server-Side Pagination

Lebih baik:

```java
public void search() {
    this.page = caseService.search(criteria, pageRequest);
}
```

```xml
<h:dataTable value="#{caseSearchBean.page.items}" var="row">
  ...
</h:dataTable>
```

Rule:

> Jangan render ribuan row jika user hanya bisa membaca puluhan row per layar.

### 11.2 Projection, Bukan Entity

Buruk:

```java
List<CaseEntity> results;
```

Lebih baik:

```java
public record CaseRow(
    Long id,
    String referenceNo,
    String applicantName,
    String statusLabel,
    boolean canView,
    boolean canAssign,
    boolean overdue
) {}
```

Manfaat:

1. data minimal,
2. tidak lazy loading,
3. tidak expose domain graph,
4. permission siap render,
5. serialization lebih ringan,
6. test lebih mudah.

### 11.3 Avoid N+1 in Row Binding

Buruk:

```xml
<h:outputText value="#{caseService.latestNote(row.id)}" />
```

Jika ada 50 row, ini bisa 50 service/database calls saat render.

Lebih baik:

```java
public record CaseRow(
    Long id,
    String referenceNo,
    String latestNotePreview
) {}
```

Service menyiapkan projection dengan query yang benar.

---

## 12. Ajax Performance

Ajax membuat UX lebih responsif, tapi bukan free lunch.

### 12.1 Execute vs Render

```xml
<f:ajax execute="@this" render="summary" />
```

`execute` menentukan komponen mana yang diproses dalam lifecycle.

`render` menentukan komponen mana yang dikirim ulang ke client.

Masalah umum:

```xml
<f:ajax execute="@form" render="@form" />
```

Ini sering terlalu besar.

Lebih baik:

```xml
<f:ajax execute="status" render="actionPanel messagePanel" />
```

### 12.2 Partial Render yang Terlalu Luas

Jika setiap dropdown change merender seluruh form besar:

```xml
<f:ajax execute="@this" render="caseForm" />
```

Maka setiap perubahan kecil memicu render besar.

Lebih baik buat wrapper kecil:

```xml
<h:panelGroup id="dependentFields" layout="block">
  ...
</h:panelGroup>
```

```xml
<f:ajax execute="@this" render="dependentFields" />
```

### 12.3 Ajax Race Condition

User bisa klik cepat:

```text
Ajax A starts
Ajax B starts
Ajax B returns first
Ajax A returns later and overwrites UI with older state
```

Mitigasi:

1. disable button saat request berjalan,
2. debounce input event,
3. throttle search-as-you-type,
4. ignore stale response di client jika perlu,
5. backend action idempotent,
6. optimistic locking untuk update domain.

### 12.4 Ajax Tidak Boleh Menjadi Polling Brutal

Buruk:

```xml
<!-- polling setiap 2 detik untuk semua user -->
```

Jika 1.000 user online, polling 2 detik berarti 500 request/detik bahkan saat tidak ada perubahan.

Alternatif:

1. refresh manual,
2. polling adaptif,
3. SSE/WebSocket jika benar-benar perlu,
4. background job status endpoint ringan,
5. queue status dengan backoff.

---

## 13. Permission Rendering Performance

Enterprise UI sering punya role/action matrix kompleks.

Buruk:

```xml
<h:commandButton value="Approve"
                 rendered="#{securityBean.canApprove(caseBean.caseId)}" />
<h:commandButton value="Reject"
                 rendered="#{securityBean.canReject(caseBean.caseId)}" />
<h:commandButton value="Assign"
                 rendered="#{securityBean.canAssign(caseBean.caseId)}" />
```

Jika setiap method memanggil policy engine/database, render jadi mahal.

Lebih baik:

```java
public class CaseActionView {
    private boolean approveVisible;
    private boolean rejectVisible;
    private boolean assignVisible;
    private boolean closeVisible;
}
```

```xml
<h:commandButton value="Approve" rendered="#{caseBean.actions.approveVisible}" />
```

Prinsip:

> Hitung permission satu kali per view/action context, simpan sebagai decision object, lalu render dari decision object.

Tetap ingat:

> UI visibility bukan authorization enforcement. Backend action tetap wajib authorize ulang.

---

## 14. Resource Handling: CSS, JS, Images

Faces punya resource handling sendiri.

Contoh:

```xml
<h:outputStylesheet library="app" name="css/main.css" />
<h:outputScript library="app" name="js/case.js" target="body" />
```

Performance concern:

1. terlalu banyak resource kecil,
2. cache header tidak optimal,
3. resource versioning tidak jelas,
4. component library menarik JS/CSS berat di halaman yang tidak butuh,
5. duplicate script include dari template/composite.

Checklist:

1. cek network waterfall,
2. minify/bundle jika cocok,
3. cache static resource,
4. hindari include resource di setiap composite jika bisa dipusatkan,
5. lazy-load resource berat,
6. pastikan resource tidak disable caching tanpa alasan.

---

## 15. Browser Payload dan Rendering Cost

Server cepat tidak cukup jika browser menerima HTML/JS besar.

Masalah umum:

1. tabel ribuan row,
2. inline script besar,
3. inline style berulang,
4. ViewState hidden field besar,
5. banyak nested DOM,
6. komponen library menghasilkan markup kompleks,
7. partial response mengganti DOM besar.

Ukuran yang perlu dilihat:

1. response body size,
2. compressed size,
3. DOM node count,
4. JS execution time,
5. layout/reflow time,
6. time to interactive,
7. Ajax response size,
8. hidden input size.

Prinsip:

> Faces performance tidak berhenti di server. Browser juga bagian dari runtime.

---

## 16. Component Library Cost

Library seperti PrimeFaces atau library internal bisa mempercepat development, tetapi menambah cost.

Cost yang harus dipahami:

1. component tree lebih besar,
2. renderer lebih kompleks,
3. JavaScript lebih banyak,
4. CSS/theme lebih berat,
5. Ajax behavior custom,
6. widget initialization,
7. state tambahan,
8. upgrade compatibility.

Ini bukan alasan untuk menghindari component library. Ini alasan untuk mengukurnya.

Decision rule:

| Kebutuhan | Standard Faces cukup? | Rich component library? |
|---|---|---|
| Form sederhana | Ya | Tidak perlu |
| Data table sederhana | Ya | Mungkin tidak perlu |
| Data table kompleks filter/sort/export | Mungkin sulit | Cocok |
| Dialog, autocomplete, tree | Sulit | Cocok |
| Highly custom UX | Mungkin tidak cocok | Bisa berat |
| SPA-like interaction | Tidak ideal | Mungkin tetap kurang |

---

## 17. Serialization Cost

State saving, session replication, passivation, dan clustering sering membutuhkan serialization.

Masalah umum:

1. `@ViewScoped` bean tidak serializable,
2. field menyimpan non-serializable service/object,
3. entity graph besar disimpan di view/session,
4. transient field tidak dipulihkan dengan benar,
5. client state besar karena object graph besar.

Contoh:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {
    private CaseDetailView detail;

    @Inject
    private transient CaseService caseService;
}
```

Catatan:

1. CDI proxy sering punya mekanisme sendiri, tapi tetap desain serializable harus jelas.
2. Jangan menyimpan resource seperti stream, connection, thread, file handle di scoped bean.
3. Simpan ID dan view DTO, bukan object graph besar.

---

## 18. Lazy Loading dan Persistence Boundary

Anti-pattern umum:

```xml
<h:outputText value="#{caseBean.caseEntity.applicant.address.postalCode}" />
```

Jika `applicant` atau `address` lazy, rendering bisa:

1. memicu query saat render,
2. gagal dengan lazy initialization exception,
3. membuat N+1,
4. membuka transaction terlalu lama,
5. menyamarkan DB cost sebagai view cost.

Lebih baik:

```java
public record CaseDetailView(
    Long id,
    String referenceNo,
    String applicantName,
    String postalCode,
    String statusLabel
) {}
```

Service menyiapkan `CaseDetailView` dalam transaction yang jelas.

Rule:

> Faces view harus menerima data yang siap render. Jangan biarkan view menavigasi domain graph untuk “menemukan” data.

---

## 19. Caching Strategy

Caching di Faces perlu hati-hati karena ada user-specific dan request-specific data.

### 19.1 Safe to Cache

Biasanya aman:

1. static lookup list,
2. status labels,
3. country list,
4. localized resource bundle,
5. permission metadata umum,
6. UI configuration immutable,
7. static resource.

### 19.2 Dangerous to Cache

Berisiko:

1. user-specific authorization result tanpa key user/context,
2. case detail sensitive,
3. form input draft,
4. search result besar di session,
5. entity JPA managed,
6. uploaded file content.

### 19.3 Cache Scope

| Cache location | Cocok | Risiko |
|---|---|---|
| Request field | computation per request | no reuse |
| View field | screen state | state bloat |
| Session field | preference/user lightweight | memory bloat |
| Application cache | shared immutable/catalog | stale/cross-user leak |
| Distributed cache | reference data | invalidation complexity |

---

## 20. Measuring Faces Performance

Jangan mulai dari opini “Faces lambat”. Mulai dari measurement.

Metrik penting:

1. request duration total,
2. lifecycle phase duration,
3. action/service duration,
4. render duration,
5. view state size,
6. response size,
7. session size estimate,
8. number of components,
9. number of rendered rows,
10. DB query count,
11. remote call count,
12. garbage allocation,
13. CPU profile,
14. Ajax request frequency,
15. error rate: view expired, validation fail, timeout.

---

## 21. Phase Timing Listener

Untuk diagnosis, kita bisa menambahkan `PhaseListener`.

Contoh sederhana:

```java
package com.example.faces.diagnostics;

import jakarta.faces.event.PhaseEvent;
import jakarta.faces.event.PhaseId;
import jakarta.faces.event.PhaseListener;
import java.util.EnumMap;
import java.util.Map;

public class LifecycleTimingPhaseListener implements PhaseListener {

    private static final String START_KEY = LifecycleTimingPhaseListener.class.getName() + ".start";

    @Override
    public void beforePhase(PhaseEvent event) {
        event.getFacesContext()
             .getAttributes()
             .put(START_KEY + event.getPhaseId(), System.nanoTime());
    }

    @Override
    public void afterPhase(PhaseEvent event) {
        Object startObject = event.getFacesContext()
                                 .getAttributes()
                                 .remove(START_KEY + event.getPhaseId());

        if (startObject instanceof Long start) {
            long durationNanos = System.nanoTime() - start;
            long durationMillis = durationNanos / 1_000_000;

            // Dalam production, kirim ke metrics/log structured, bukan println.
            System.out.println("Faces phase " + event.getPhaseId() + " took " + durationMillis + " ms");
        }
    }

    @Override
    public PhaseId getPhaseId() {
        return PhaseId.ANY_PHASE;
    }
}
```

Register di `faces-config.xml`:

```xml
<faces-config
    xmlns="https://jakarta.ee/xml/ns/jakartaee"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                        https://jakarta.ee/xml/ns/jakartaee/web-facesconfig_4_1.xsd"
    version="4.1">

    <lifecycle>
        <phase-listener>com.example.faces.diagnostics.LifecycleTimingPhaseListener</phase-listener>
    </lifecycle>

</faces-config>
```

Gunakan untuk sementara atau dengan sampling. Jangan menambah overhead logging besar di setiap request production tanpa kontrol.

---

## 22. Counting Components

Kadang bottleneck berasal dari tree terlalu besar. Kita bisa menghitung component count saat render.

```java
package com.example.faces.diagnostics;

import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;

public final class ComponentTreeDiagnostics {

    private ComponentTreeDiagnostics() {
    }

    public static int countComponents(FacesContext context) {
        UIComponent root = context.getViewRoot();
        if (root == null) {
            return 0;
        }
        return count(root);
    }

    private static int count(UIComponent component) {
        int total = 1;

        for (UIComponent child : component.getChildren()) {
            total += count(child);
        }

        for (UIComponent facet : component.getFacets().values()) {
            total += count(facet);
        }

        return total;
    }
}
```

Lalu log saat Render Response selesai.

Tujuannya bukan menjadikan angka ini KPI tunggal, tetapi mengidentifikasi halaman yang tree-nya jauh lebih besar dari halaman lain.

---

## 23. Estimasi ViewState Size

Di client-side state saving, ukuran hidden field bisa dilihat langsung dari HTML.

Cari:

```html
<input type="hidden" name="jakarta.faces.ViewState" value="..." />
```

Ukuran value besar berarti:

1. response makin besar,
2. postback makin besar,
3. network latency naik,
4. browser memory naik,
5. server decode/verify/decrypt cost naik.

Di server-side state saving, hidden field mungkin kecil, tetapi state besar ada di session. Jadi jangan hanya melihat HTML. Ukur juga session.

---

## 24. Session Size Estimation

Tidak selalu mudah menghitung session size akurat di Java karena object graph, references, proxies, dan container internals.

Namun kita bisa lakukan pendekatan:

1. gunakan heap dump,
2. analisis dominator tree,
3. group by session object,
4. cek `@SessionScoped` dan `@ViewScoped` beans,
5. cek saved views,
6. cek uploaded file/content,
7. cek collections besar.

Tooling:

1. Java Flight Recorder,
2. heap dump + Eclipse MAT,
3. container session metrics,
4. custom approximate object size untuk dev/test,
5. load test dengan concurrent sessions.

---

## 25. Load Testing Faces

Load test Faces harus realistis.

Jangan hanya GET halaman.

Skenario minimal:

1. login,
2. open search page,
3. submit search,
4. paginate,
5. open detail,
6. edit field,
7. Ajax validation,
8. submit action,
9. navigate back,
10. open multiple tabs jika common,
11. session timeout scenario.

Harus menangani:

1. ViewState hidden field extraction,
2. CSRF token jika ada,
3. cookies/session,
4. dynamic client id,
5. redirect,
6. Ajax partial response.

Jika load test tidak mengirim ViewState yang benar, hasilnya tidak representatif.

---

## 26. Common Bottleneck Patterns

### 26.1 Getter Calls Database

Gejala:

1. render lambat,
2. query count tinggi,
3. service log muncul saat render,
4. refresh halaman mahal.

Fix:

1. load di action/init,
2. simpan DTO/view model,
3. cache per request/view,
4. jangan service call dari getter.

### 26.2 Data Table Too Large

Gejala:

1. response besar,
2. browser freeze,
3. view state besar,
4. memory naik.

Fix:

1. server-side pagination,
2. projection,
3. lazy loading model,
4. limit page size,
5. export via background/report endpoint, bukan render semua.

### 26.3 Session Scoped Bean Stores Search Results

Gejala:

1. memory naik per user,
2. stale results,
3. cross-tab confusion,
4. cluster replication mahal.

Fix:

1. use view/request scope,
2. store criteria only,
3. reload page result by page request,
4. cache reference data separately.

### 26.4 Permission Check per Component

Gejala:

1. render lambat untuk role-heavy UI,
2. policy service terpanggil ratusan kali,
3. DB/LDAP/cache pressure.

Fix:

1. precompute action decision,
2. row-level decision projection,
3. request-scoped permission context,
4. batch permission evaluation.

### 26.5 Excessive Ajax

Gejala:

1. banyak request kecil,
2. server thread pool sibuk,
3. user mengetik memicu request per key,
4. stale UI karena race.

Fix:

1. debounce,
2. execute/render target minimal,
3. combine events,
4. avoid polling brutal,
5. disable controls during request.

### 26.6 View State Too Large

Gejala:

1. hidden field besar,
2. POST lambat,
3. session memory besar,
4. ViewExpired sering,
5. cluster replication berat.

Fix:

1. reduce component tree,
2. avoid storing large object in view,
3. use DTO IDs,
4. paginate,
5. choose state saving mode intentionally,
6. reduce dynamic components.

---

## 27. Designing Fast Faces Pages

### 27.1 Page Design Checklist

Untuk setiap halaman, tanyakan:

1. Apakah halaman ini read-only atau interactive?
2. Apakah butuh postback atau cukup GET link?
3. Berapa banyak input dalam form?
4. Berapa banyak row yang dirender?
5. Apakah semua row harus ada di DOM?
6. Apakah ada getter yang memanggil service?
7. Apakah permission sudah diprecompute?
8. Apakah ViewState besar?
9. Apakah session menyimpan object besar?
10. Apakah Ajax merender area terlalu luas?
11. Apakah component id stabil?
12. Apakah data table memakai projection?
13. Apakah page bisa di-bookmark?
14. Apakah PRG lebih cocok setelah submit?

### 27.2 Fast Detail Page Pattern

```text
GET detail.xhtml?id=123
  -> load CaseDetailView projection
  -> load CaseActionDecision
  -> render read-only sections
  -> small forms for actions
```

Bean:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private Long caseId;
    private CaseDetailView detail;
    private CaseActionDecision actions;
    private String actionComment;

    @Inject
    private transient CaseQueryService queryService;

    @Inject
    private transient CaseCommandService commandService;

    public void load() {
        this.detail = queryService.getCaseDetail(caseId);
        this.actions = queryService.getActionDecision(caseId);
    }

    public String approve() {
        commandService.approve(caseId, actionComment);
        return "/case/detail?faces-redirect=true&id=" + caseId;
    }

    // getters murah saja
}
```

XHTML:

```xml
<f:metadata>
    <f:viewParam name="id" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.load}" />
</f:metadata>

<h:panelGroup id="caseSummary" layout="block">
    <h:outputText value="#{caseDetailBean.detail.referenceNo}" />
    <h:outputText value="#{caseDetailBean.detail.statusLabel}" />
</h:panelGroup>

<h:form id="actionForm">
    <h:inputTextarea value="#{caseDetailBean.actionComment}" />

    <h:commandButton value="Approve"
                     action="#{caseDetailBean.approve}"
                     rendered="#{caseDetailBean.actions.canApprove}" />
</h:form>
```

Key points:

1. read model terpisah dari command,
2. permission precomputed,
3. form kecil,
4. getter murah,
5. PRG setelah state-changing action,
6. detail DTO siap render.

### 27.3 Fast Search Page Pattern

```text
GET search.xhtml
  -> show empty criteria
POST/Ajax search
  -> execute criteria panel
  -> fetch one page
  -> render results panel
```

Bean:

```java
@Named
@ViewScoped
public class CaseSearchBean implements Serializable {

    private CaseSearchCriteria criteria = new CaseSearchCriteria();
    private Page<CaseRow> page = Page.empty();

    @Inject
    private transient CaseSearchService searchService;

    public void search() {
        this.page = searchService.search(criteria, PageRequest.firstPage(25));
    }

    public void goToPage(int pageNumber) {
        this.page = searchService.search(criteria, PageRequest.of(pageNumber, 25));
    }
}
```

Principles:

1. no huge result list,
2. no entity list,
3. page size enforced,
4. search explicit,
5. result row projection,
6. no service call in getter.

---

## 28. Stateless and Low-State Thinking

Tidak semua halaman butuh view state besar.

Read-only pages bisa lebih cocok dengan:

1. GET parameters,
2. request scope,
3. bookmarkable navigation,
4. minimal form,
5. no large view scoped state.

State-changing pages bisa memakai:

1. command form kecil,
2. PRG setelah submit,
3. optimistic locking token,
4. reload after action,
5. flash message.

Mental model:

```text
Store durable truth in database.
Store screen-specific temporary state in view scope.
Store user-wide lightweight preference in session.
Do not store large domain state in UI scope.
```

---

## 29. Clustering and Horizontal Scalability

Faces app di cluster perlu memperhatikan:

1. server-side state saving butuh sticky session atau replication,
2. session scoped beans harus serializable,
3. view scoped state ikut session/view state,
4. client-side state mengurangi session pressure tapi menambah payload,
5. file upload temp storage harus cluster-aware,
6. background task status harus shared,
7. resource versioning harus konsisten antar node,
8. deployment rolling update bisa mematahkan serialized state jika class berubah.

### 29.1 Rolling Deployment Risk

Jika user membuka view pada versi A, lalu submit ke node versi B:

```text
View built with old component/class structure
Postback handled by new deployment
State restore may fail
```

Mitigasi:

1. sticky session during rollout,
2. drain old nodes,
3. short session/view timeout during deployment window,
4. backward-compatible component changes,
5. avoid storing complex custom component state,
6. user-friendly expired view handling.

---

## 30. Java 8 sampai Java 25: Dampak Performance

### 30.1 Java 8 Legacy

Karakteristik:

1. masih banyak `javax.faces.*`,
2. JSF 2.x,
3. older EL/JSP/JSTL,
4. container lama,
5. limited modern GC improvements,
6. older TLS/security defaults,
7. old component library versions.

Focus performance:

1. reduce session bloat,
2. avoid huge data table,
3. use DTO projection,
4. upgrade component library carefully,
5. monitor GC and PermGen/Metaspace depending runtime.

### 30.2 Java 11/17 Migration Era

Focus:

1. stronger module/access constraints,
2. better GC choices,
3. Jakarta migration planning,
4. dependency modernization,
5. container compatibility.

### 30.3 Java 21/25 Modern Era

Potential benefit:

1. newer GC behavior,
2. better runtime observability,
3. better container awareness,
4. virtual threads for request processing if container supports relevant mode.

But important:

> Virtual threads do not remove Faces component tree cost, view state cost, render cost, database query cost, or browser payload cost.

Virtual threads can help blocking request scalability, but poor UI state design still hurts.

---

## 31. Performance Review Checklist

### 31.1 Backing Bean

- [ ] Getter bebas DB/service call.
- [ ] Setter bebas heavy logic.
- [ ] Bean scope paling sempit yang benar.
- [ ] `@ViewScoped` bean serializable.
- [ ] Tidak menyimpan entity graph besar.
- [ ] Tidak menyimpan binary/file besar.
- [ ] Permission decision diprecompute.
- [ ] Search result dipaginate.
- [ ] Action method idempotency dipikirkan.

### 31.2 XHTML/View

- [ ] Tidak seluruh halaman dibungkus satu form besar tanpa alasan.
- [ ] Data table punya page size.
- [ ] Ajax `execute` minimal.
- [ ] Ajax `render` minimal.
- [ ] Static markup tidak dipaksa jadi component.
- [ ] Composite component tidak over-nested.
- [ ] Conditional rendering tidak memicu service call.
- [ ] Component id stabil.
- [ ] Tidak banyak hidden field custom berisi data besar/sensitive.

### 31.3 State

- [ ] ViewState size diukur.
- [ ] Session size diobservasi.
- [ ] Server/client state saving dipilih sadar.
- [ ] Multi-tab behavior dipahami.
- [ ] ViewExpired ditangani ramah.
- [ ] Cluster deployment mempertimbangkan serialized state.

### 31.4 Backend Integration

- [ ] View memakai DTO/projection.
- [ ] Tidak lazy load saat render.
- [ ] Query count terukur.
- [ ] Permission check dibatch jika perlu.
- [ ] Converter/validator tidak melakukan DB call berat.
- [ ] Long-running operation tidak blocking UI tanpa strategi.

### 31.5 Browser/Network

- [ ] Response size terukur.
- [ ] HTML DOM tidak terlalu besar.
- [ ] Static resource cache benar.
- [ ] JS/CSS tidak berlebihan.
- [ ] Ajax frequency terkendali.
- [ ] Partial response tidak mengganti DOM terlalu besar.

---

## 32. Diagnostic Playbook

### Case A — “Halaman detail lambat dibuka”

Urutan cek:

1. ukur total request time,
2. ukur service/query load detail,
3. cek getter DB call,
4. cek render phase timing,
5. cek component count,
6. cek view state size,
7. cek response size,
8. cek permission rendering,
9. cek resource waterfall.

Kemungkinan fix:

1. DTO projection,
2. precompute permission,
3. reduce composite nesting,
4. split forms,
5. reduce table/history rendered upfront,
6. lazy-load secondary panels.

### Case B — “Submit form lambat”

Urutan cek:

1. cek POST payload size,
2. cek form terlalu besar,
3. cek validation/conversion timing,
4. cek action service timing,
5. cek render response setelah submit,
6. cek PRG.

Kemungkinan fix:

1. small form,
2. execute subset,
3. move expensive validation to service with clear feedback,
4. async long-running operation,
5. PRG after success,
6. reduce rerender target.

### Case C — “Memory naik seiring user online”

Urutan cek:

1. heap dump,
2. session count,
3. average session size,
4. saved views per session,
5. `@SessionScoped` beans,
6. `@ViewScoped` beans,
7. search results/entity graphs,
8. uploaded file data,
9. component library state.

Kemungkinan fix:

1. reduce session scope,
2. store criteria not results,
3. use pagination,
4. reduce number of saved views,
5. cleanup wizard state,
6. externalize temp files,
7. client-side state if suitable.

### Case D — “Ajax terasa lambat padahal response kecil”

Urutan cek:

1. cek server processing time,
2. cek `execute` target,
3. cek validation triggered unexpectedly,
4. cek render target,
5. cek getter/service call,
6. cek race/multiple requests,
7. cek client JS callback.

Kemungkinan fix:

1. `execute="@this"`,
2. render wrapper kecil,
3. debounce,
4. disable repeated request,
5. split independent forms,
6. avoid full form validation on small Ajax.

---

## 33. Regulatory Case Management Example

Bayangkan halaman case detail:

1. summary,
2. applicant details,
3. status timeline,
4. documents,
5. audit history,
6. comments,
7. workflow action buttons,
8. assignment panel,
9. related cases,
10. alerts/escalation.

Naive implementation:

```text
One huge @SessionScoped bean
One huge h:form
Loads CaseEntity graph
Renders all audit rows
Renders all documents
Permission check per button via service
Getter calls service
Ajax render @form
```

Akibat:

1. slow render,
2. huge session,
3. browser heavy,
4. stale state,
5. cluster replication pain,
6. hard debugging.

Better implementation:

```text
CaseDetailView projection
CaseActionDecision projection
Small action form
Audit tab paginated/lazy-loaded
Documents paginated/lazy-loaded
Comments loaded separately
Permission decision precomputed
PRG after workflow action
No service call in getter
ViewState measured
```

High-level structure:

```text
GET /case/detail.xhtml?id=123
  -> load summary + decisions
  -> render primary content

Ajax /case/audit panel
  -> load audit page only

Ajax /case/documents panel
  -> load document page only

POST approve
  -> execute action form only
  -> service authorize + update
  -> redirect detail
```

This is the difference between “Faces page works” and “Faces page scales”.

---

## 34. Design Heuristics for Top-Tier Faces Engineering

1. Treat XHTML as declarative component configuration, not a place to hide business logic.
2. Treat getter as pure read, cheap, and repeatable.
3. Treat view state as a budgeted resource.
4. Treat session as expensive memory, not a free map.
5. Treat data table as a scalability hazard until proven otherwise.
6. Treat Ajax as partial lifecycle, not magic.
7. Treat rendered permission as UX only, not security.
8. Treat converter/validator as hot path code.
9. Treat component library as dependency with runtime cost.
10. Treat browser payload as part of backend performance.
11. Treat migration and rolling deployment as state compatibility problems.
12. Treat observability as mandatory, because Faces bottlenecks are often phase-specific.

---

## 35. Ringkasan

Jakarta Faces bisa sangat produktif untuk enterprise server-side UI, tetapi performance-nya harus dipahami sebagai gabungan dari:

1. lifecycle phase cost,
2. component tree size,
3. view state size,
4. session memory,
5. EL/getter behavior,
6. converter/validator cost,
7. service/database integration,
8. data table rendering,
9. Ajax request frequency,
10. browser payload.

Kunci utamanya:

```text
Keep component tree intentional.
Keep state small.
Keep getters cheap.
Keep data paginated.
Keep permissions precomputed.
Keep forms narrow.
Keep Ajax targeted.
Keep view models render-ready.
Measure before blaming the framework.
```

Jika bagian sebelumnya menjelaskan bagaimana Faces bekerja, bagian ini menjelaskan bagaimana Faces **bertahan di production**.

---

## 36. Checklist Cepat Sebelum Production

- [ ] Semua halaman utama sudah diuji response size-nya.
- [ ] ViewState size sudah diketahui.
- [ ] Session memory per user sudah diestimasi.
- [ ] Data table besar sudah dipaginate.
- [ ] Getter sudah bebas service/database call.
- [ ] Ajax execute/render sudah minimal.
- [ ] Permission rendering sudah precomputed.
- [ ] Converter/validator tidak melakukan operasi berat tak terlihat.
- [ ] Load test menggunakan ViewState/token yang valid.
- [ ] Heap dump test sudah dilakukan untuk skenario banyak user.
- [ ] `ViewExpiredException` punya UX yang baik.
- [ ] Rolling deployment memperhitungkan view state compatibility.

---

## 37. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
27-library-ecosystem-mojarra-myfaces-omnifaces-primefaces.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 25 — Faces Security: XSS, CSRF, View State, Authorization, and Secure Rendering](./25-faces-security-xss-csrf-view-state-authorization-secure-rendering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — Library Ecosystem: Mojarra, MyFaces, OmniFaces, PrimeFaces, dan Konteks Component Library Jakarta Faces](./27-library-ecosystem-mojarra-myfaces-omnifaces-primefaces.md)

</div>