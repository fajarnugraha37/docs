# Part 17 — Faces Lifecycle Deep Dive: Phase-by-Phase Execution and Failure Modeling

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `17-faces-lifecycle-deep-dive-phase-by-phase-failure-modeling.md`  
> Fokus: Jakarta Faces lifecycle, phase execution, short-circuiting, validation/conversion flow, Ajax subset, `immediate`, debugging, dan failure modeling.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak lagi melihat Jakarta Faces/JSF sebagai framework “aneh yang kadang action tidak terpanggil”. Kamu akan mampu membaca perilaku Faces sebagai konsekuensi dari lifecycle.

Target akhirnya:

1. Memahami request Faces sebagai proses bertahap, bukan pemanggilan method langsung.
2. Bisa menjelaskan kapan component membaca request parameter.
3. Bisa menjelaskan kapan converter berjalan.
4. Bisa menjelaskan kapan validator berjalan.
5. Bisa menjelaskan kapan model/backing bean di-update.
6. Bisa menjelaskan kapan action method dipanggil.
7. Bisa menjelaskan kenapa halaman yang sama dirender ulang saat validation error.
8. Bisa mendiagnosis bug umum:
   - action tidak terpanggil,
   - setter tidak terpanggil,
   - nilai bean tidak berubah,
   - validation gagal diam-diam,
   - converter error,
   - duplicate component id,
   - `ViewExpiredException`,
   - Ajax render target tidak ditemukan,
   - `immediate=true` membingungkan alur.
9. Bisa membuat mental model failure untuk enterprise screen yang kompleks.

Bagian ini sengaja sangat konseptual dan operasional. API detail component, converter, validator, Ajax, dan state saving akan diperdalam lagi pada part berikutnya.

---

## 1. Mental Model Utama: Request Faces Bukan “Call Method dari Button”

Di banyak framework web sederhana, alur request terlihat seperti ini:

```text
HTTP Request
  -> Controller method
  -> Service
  -> Model
  -> Render view
```

Di Jakarta Faces, alurnya berbeda:

```text
HTTP Request
  -> FacesServlet
  -> Restore/build component tree
  -> Apply request values to UI components
  -> Convert and validate component local values
  -> Push valid values into model/backing bean
  -> Invoke application action/listener
  -> Render component tree back to HTML
```

Perbedaan pentingnya:

- Request parameter tidak langsung masuk ke bean.
- Request parameter masuk dulu ke component tree.
- Component punya local submitted value.
- Converter mengubah submitted string menjadi object Java.
- Validator mengecek nilai component.
- Baru setelah valid, nilai masuk ke model/backing bean.
- Action method biasanya dipanggil setelah model update.
- Render response bisa terjadi lebih awal jika ada error atau shortcut.

Jadi button di Faces bukan sekadar:

```java
bean.save();
```

Lebih tepat:

```text
Button submitted
  -> identify submitted component
  -> decode request values
  -> validate inputs
  -> update model
  -> invoke action
  -> navigate/render
```

Jika satu fase gagal, fase berikutnya bisa tidak terjadi.

---

## 2. Lifecycle Besar Jakarta Faces

Lifecycle Faces biasanya dibagi menjadi 6 phase utama:

```text
1. Restore View
2. Apply Request Values
3. Process Validations
4. Update Model Values
5. Invoke Application
6. Render Response
```

Secara visual:

```text
Client Browser
     |
     | HTTP request
     v
FacesServlet
     |
     v
+-----------------------+
| 1. Restore View       |
+-----------------------+
     |
     v
+-----------------------+
| 2. Apply Request      |
|    Values             |
+-----------------------+
     |
     v
+-----------------------+
| 3. Process            |
|    Validations        |
+-----------------------+
     |
     v
+-----------------------+
| 4. Update Model       |
|    Values             |
+-----------------------+
     |
     v
+-----------------------+
| 5. Invoke             |
|    Application        |
+-----------------------+
     |
     v
+-----------------------+
| 6. Render Response    |
+-----------------------+
     |
     | HTML/partial response
     v
Client Browser
```

Namun lifecycle nyata punya shortcut:

```text
Any phase may call:
  FacesContext.renderResponse()
    -> skip to Render Response

Any phase may call:
  FacesContext.responseComplete()
    -> stop Faces rendering entirely
```

Ini penting untuk:

- validation failure,
- conversion failure,
- redirect,
- file download,
- custom response,
- authentication flow,
- exception handling.

---

## 3. Initial Request vs Postback

Faces membedakan dua jenis request besar.

### 3.1 Initial Request

Initial request adalah request pertama ke halaman Faces.

Contoh:

```text
GET /cases/edit.xhtml?id=123
```

Pada initial request:

- view belum ada sebelumnya,
- component tree dibangun dari Facelets XHTML,
- view parameters bisa diproses,
- halaman dirender ke browser,
- state view disimpan untuk postback berikutnya.

Simplifikasi alurnya:

```text
Initial GET
  -> Restore View: build new view
  -> Render Response
```

Dalam beberapa kasus, metadata seperti `f:viewParam` dan `f:viewAction` dapat menjalankan conversion, validation, atau action pada request awal.

### 3.2 Postback

Postback adalah submit dari halaman Faces yang sebelumnya sudah dirender.

Contoh:

```text
POST /cases/edit.xhtml
  javax.faces.ViewState=...
  form:caseTitle=...
  form:saveButton=...
```

Pada postback:

- Faces membaca view state,
- component tree direstore,
- request parameter didecode ke component,
- conversion/validation berjalan,
- model di-update,
- action dieksekusi,
- response dirender.

Simplifikasi alurnya:

```text
Postback
  -> Restore View
  -> Apply Request Values
  -> Process Validations
  -> Update Model Values
  -> Invoke Application
  -> Render Response
```

---

## 4. Istilah Kunci: Submitted Value, Local Value, Model Value

Untuk memahami lifecycle, kamu harus membedakan tiga jenis value.

Misal ada input:

```xml
<h:inputText id="amount" value="#{paymentBean.amount}" />
```

User mengetik:

```text
1000
```

### 4.1 Submitted Value

Submitted value adalah raw request parameter dari browser.

Biasanya string.

```text
"1000"
```

Ia hidup di component, belum tentu valid, belum masuk ke bean.

### 4.2 Local Value

Local value adalah nilai component setelah conversion.

Misalnya:

```java
BigDecimal.valueOf(1000)
```

Local value masih berada di component, belum tentu masuk ke model.

### 4.3 Model Value

Model value adalah property di backing bean:

```java
paymentBean.setAmount(new BigDecimal("1000"));
```

Model value hanya di-update jika conversion dan validation sukses.

### 4.4 Flow Value

```text
Browser request parameter
  -> submitted value on UIInput
  -> converted local value
  -> validated local value
  -> model/backing bean property
```

Failure di tengah akan menghentikan flow.

---

## 5. Phase 1 — Restore View

Restore View adalah fase Faces membangun atau mengembalikan component tree.

### 5.1 Apa Itu Component Tree?

Facelets XHTML seperti ini:

```xml
<h:form id="caseForm">
    <h:inputText id="title" value="#{caseEditBean.form.title}" />
    <h:commandButton id="save" value="Save" action="#{caseEditBean.save}" />
</h:form>
```

Bukan langsung dianggap HTML. Faces membangun tree kira-kira seperti:

```text
UIViewRoot
└── HtmlForm(id=caseForm)
    ├── HtmlInputText(id=title)
    └── HtmlCommandButton(id=save)
```

Component tree adalah representasi server-side dari UI.

### 5.2 Initial Request

Untuk initial request:

```text
Restore View
  -> create UIViewRoot
  -> parse/build Facelets
  -> instantiate components
  -> attach converters/validators/listeners
  -> prepare tree for rendering
```

### 5.3 Postback

Untuk postback:

```text
Restore View
  -> read view state token
  -> restore previous component tree/state
  -> rebuild transient parts if needed
  -> prepare tree for decoding request
```

### 5.4 View State Dependency

Postback membutuhkan view state.

Biasanya ada hidden field:

```html
<input type="hidden" name="jakarta.faces.ViewState" value="..." />
```

Pada legacy JSF bisa terlihat sebagai:

```html
<input type="hidden" name="javax.faces.ViewState" value="..." />
```

Jika view state hilang/expired/tidak valid:

```text
Restore View fails
  -> ViewExpiredException or invalid state error
```

### 5.5 Failure Modes di Restore View

#### Failure 1 — View Expired

Gejala:

```text
jakarta.faces.application.ViewExpiredException
```

Penyebab umum:

- session expired,
- server-side state hilang,
- user membuka halaman lama lalu submit,
- deployment/restart menghapus state,
- load balancer tidak sticky padahal server-side state tidak replicated,
- client-side state token rusak.

Model diagnosis:

```text
Can Faces reconstruct previous component tree?
  no -> restore view fails
```

#### Failure 2 — Duplicate Component ID

Gejala:

```text
Component ID ... has already been found in the view
```

Penyebab umum:

- manual `id` sama dalam naming container yang sama,
- conditional include menghasilkan duplicate,
- dynamic component dibuat berulang tanpa id unik,
- JSTL build-time loop menghasilkan component dengan id bentrok.

#### Failure 3 — Template Build Error

Gejala:

- namespace salah,
- tag tidak dikenal,
- XML tidak well-formed,
- attribute salah.

Karena Facelets XHTML lebih strict dibanding HTML biasa.

### 5.6 Design Rule

Jangan anggap Facelets sebagai HTML biasa.

Anggap Facelets sebagai:

```text
blueprint untuk membangun component tree
```

---

## 6. Phase 2 — Apply Request Values

Apply Request Values adalah fase component membaca request parameter.

Fase ini sering disebut decode phase.

### 6.1 Apa yang Terjadi?

Untuk setiap component relevant:

```text
component.decode(request)
```

Misal request POST:

```text
caseForm:title=New Case Title
caseForm:save=Save
jakarta.faces.ViewState=...
```

Faces mencari component dengan client id:

```text
caseForm:title
caseForm:save
```

Lalu:

- input component menyimpan submitted value,
- command component tahu apakah dirinya yang disubmit,
- behavior/Ajax event bisa di-queue.

### 6.2 Belum Ada Model Update

Pada fase ini:

```text
#{caseEditBean.form.title}
```

belum tentu berubah.

Yang berubah adalah state internal component:

```text
HtmlInputText(title).submittedValue = "New Case Title"
```

### 6.3 Command Component

Jika user klik:

```xml
<h:commandButton id="save" action="#{caseEditBean.save}" />
```

Pada apply request values, button tersebut mendeteksi dirinya submitted.

Action event biasanya di-queue untuk Invoke Application, kecuali `immediate=true`.

### 6.4 Failure Modes di Apply Request Values

#### Failure 1 — Button Action Tidak Terpanggil Karena Component Tidak Ada di Tree

Gejala:

- user klik button,
- request sampai,
- action tidak dipanggil,
- tidak ada error jelas.

Penyebab umum:

```xml
<h:commandButton rendered="#{bean.canSave}" ... />
```

Pada render sebelumnya `canSave=true`, tapi saat postback `canSave=false`, sehingga component tidak ada saat restore/build tree.

Jika button tidak ada di tree, Faces tidak bisa decode event.

Mental model:

```text
No component in tree
  -> no decode
  -> no action event
  -> action not invoked
```

Rule:

- `rendered` condition untuk component yang melakukan submit harus stabil selama request/postback.
- Untuk authorization, enforcement tetap harus di action/service, bukan hanya `rendered`.

#### Failure 2 — Component di Luar Form

Gejala:

- input tidak terkirim,
- button tidak berfungsi,
- Ajax tidak jalan.

Faces command/input harus berada dalam `h:form`.

```xml
<h:commandButton action="#{bean.save}" /> <!-- buruk jika di luar h:form -->
```

Rule:

```text
No h:form -> no submitted component parameters -> lifecycle cannot decode properly
```

#### Failure 3 — Multiple Forms Salah Target

Jika halaman punya banyak form:

```xml
<h:form id="searchForm">...</h:form>
<h:form id="editForm">...</h:form>
```

Submit `searchForm` tidak otomatis mengirim input di `editForm`.

Ini bukan bug Faces; ini aturan HTML form.

#### Failure 4 — Dynamic ID Tidak Stabil

Jika component id berubah antara render dan postback:

```text
Rendered id: row_100
Postback id expected: row_101
```

Request parameter tidak match component.

Rule:

- id component harus deterministic,
- jangan bergantung pada index list yang bisa berubah sebelum postback.

---

## 7. Phase 3 — Process Validations

Process Validations adalah fase conversion dan validation.

Untuk input component, urutannya kira-kira:

```text
submitted string
  -> check required
  -> convert to target type
  -> validate converted value
  -> if valid, store local value
  -> if invalid, queue FacesMessage and mark validation failed
```

### 7.1 Conversion

Input browser selalu string.

Misal:

```xml
<h:inputText value="#{caseBean.form.dueDate}">
    <f:convertDateTime pattern="yyyy-MM-dd" />
</h:inputText>
```

Submitted:

```text
2026-06-18
```

Converted:

```java
LocalDate / Date / LocalDateTime depending converter/model
```

Jika user mengetik:

```text
abc
```

Conversion gagal.

Efek:

```text
conversion error
  -> FacesMessage queued
  -> component invalid
  -> renderResponse requested
  -> Update Model Values skipped
  -> Invoke Application skipped
```

### 7.2 Validation

Setelah conversion sukses, validator berjalan.

Contoh:

```xml
<h:inputText value="#{bean.form.amount}">
    <f:validateLongRange minimum="1" maximum="100" />
</h:inputText>
```

Jika value di luar range:

```text
validation error
  -> message queued
  -> component invalid
  -> model not updated
  -> action not invoked
```

### 7.3 Required

`required=true` adalah validation di component level.

```xml
<h:inputText value="#{bean.form.title}" required="true" />
```

Jika kosong:

```text
required validation fails
```

### 7.4 Bean Validation Integration

Jika model/form field punya annotation:

```java
@NotBlank
@Size(max = 200)
private String title;
```

Faces dapat mengintegrasikan Bean Validation saat process validations.

Namun boundary penting:

- UI validation memvalidasi input halaman.
- Domain validation tetap harus ada di service/domain boundary.
- Jangan mengandalkan UI validation sebagai satu-satunya integrity guard.

### 7.5 Failure Modes di Process Validations

#### Failure 1 — Action Tidak Terpanggil Karena Validation Error

Gejala:

- klik Save,
- halaman reload,
- action method tidak masuk breakpoint,
- ada error message atau kadang tidak terlihat.

Penyebab:

```text
Process Validations failed
  -> skip Update Model Values
  -> skip Invoke Application
  -> render same view
```

Diagnosis:

- cek `h:messages`,
- cek converter error,
- cek required field tersembunyi,
- cek input di tab lain/form lain yang ikut submit,
- cek validation group.

#### Failure 2 — Required Field Tersembunyi Tetap Memblokir Submit

Contoh:

```xml
<h:panelGroup rendered="#{bean.showExtra}">
    <h:inputText value="#{bean.extra}" required="true" />
</h:panelGroup>
```

Jika component tidak rendered, biasanya tidak ikut lifecycle.

Namun jika disembunyikan hanya dengan CSS/JS:

```html
<div style="display:none">
```

component masih ada di tree dan tetap divalidasi.

Rule:

```text
CSS hidden != lifecycle disabled
```

Gunakan conditional rendering atau conditional required dengan hati-hati.

#### Failure 3 — Converter Gagal Karena Select Item Tidak Stabil

Pada dropdown:

```xml
<h:selectOneMenu value="#{bean.selectedUser}">
    <f:selectItems value="#{bean.availableUsers}" var="u" itemValue="#{u}" itemLabel="#{u.name}" />
</h:selectOneMenu>
```

Jika list `availableUsers` berubah saat postback, converter bisa gagal atau value tidak valid.

Rule:

- select items harus stabil sepanjang lifecycle,
- gunakan id sebagai value jika object converter tidak robust,
- jangan bergantung pada entity detached tanpa equals/hashCode jelas.

#### Failure 4 — Pesan Error Tidak Muncul

Validation gagal, tapi user tidak melihat pesan.

Penyebab:

- tidak ada `h:message` / `h:messages`,
- message target salah,
- Ajax render tidak menyertakan message component,
- CSS menyembunyikan message,
- globalOnly salah.

Diagnosis:

```xml
<h:messages globalOnly="false" />
```

---

## 8. Phase 4 — Update Model Values

Update Model Values adalah fase Faces memanggil setter model/backing bean dengan local value yang valid.

### 8.1 Apa yang Terjadi?

Untuk input:

```xml
<h:inputText value="#{caseEditBean.form.title}" />
```

Jika conversion dan validation sukses:

```java
caseEditBean.getForm().setTitle(component.getLocalValue());
```

Simplifikasi:

```text
valid component local value
  -> write through value expression
  -> backing bean setter called
```

### 8.2 Ini Bukan Service Transaction

Update Model Values hanya mengubah property bean/form object.

Belum tentu save ke database.

```text
UI component -> backing bean form
```

Bukan:

```text
UI component -> database
```

Save database biasanya dilakukan di Invoke Application saat action dipanggil.

### 8.3 Failure Modes di Update Model Values

#### Failure 1 — Setter Tidak Ada / Property Read-only

Contoh:

```java
public String getTitle() { return title; }
// no setTitle
```

Input binding butuh writable property.

Gejala:

- property not writable,
- model update error,
- action tidak lanjut.

#### Failure 2 — Nested Object Null

Binding:

```xml
<h:inputText value="#{bean.form.title}" />
```

Jika:

```java
bean.getForm() == null
```

Faces tidak bisa set `title`.

Rule:

- initialize form model sebelum render/postback,
- jangan lazy initialize dengan state yang berubah tidak stabil.

#### Failure 3 — Model Update Side Effect

Setter buruk:

```java
public void setStatus(String status) {
    this.status = status;
    workflowService.transition(caseId, status); // buruk
}
```

Setter dipanggil di phase Update Model Values, bukan fase business action.

Akibat:

- side effect terjadi sebelum action,
- validation/action flow jadi sulit diprediksi,
- partial submit bisa memicu efek tidak terduga.

Rule:

```text
Setter should set state, not execute business transition.
```

#### Failure 4 — Setter Tidak Terpanggil Karena Validation Gagal

Ini salah satu bug paling umum.

Jika validation gagal pada input manapun dalam form yang disubmit:

```text
Update Model Values skipped globally for invalid request
```

Jadi jangan diagnosis setter dulu. Cek validation dulu.

---

## 9. Phase 5 — Invoke Application

Invoke Application adalah fase action, action listener, navigation, dan application-level event biasanya dieksekusi.

### 9.1 Action Method

Contoh:

```xml
<h:commandButton value="Save" action="#{caseEditBean.save}" />
```

```java
public String save() {
    caseService.save(form);
    return "case-detail?faces-redirect=true&id=" + form.getId();
}
```

Pada phase ini:

- form sudah valid,
- model biasanya sudah ter-update,
- business service bisa dipanggil,
- navigation outcome diproses.

### 9.2 Action vs ActionListener

`action` biasanya untuk application action dan navigation.

```xml
<h:commandButton action="#{bean.save}" />
```

`actionListener` biasanya untuk event-level handling.

```xml
<h:commandButton actionListener="#{bean.onSaveClicked}" action="#{bean.save}" />
```

Rule praktis:

- gunakan `action` untuk use case utama,
- gunakan listener untuk component event tambahan,
- jangan menaruh business flow tersebar di banyak listener.

### 9.3 Navigation

Return string bisa menentukan halaman berikutnya:

```java
return "list";
return "detail?faces-redirect=true";
return null; // stay on same view
```

Untuk enterprise app, PRG sering lebih aman setelah successful POST:

```text
POST save
  -> service save
  -> redirect GET detail/list
```

Keuntungan:

- menghindari double submit via refresh,
- URL bookmarkable,
- browser back lebih predictable,
- flash message lebih natural.

### 9.4 Failure Modes di Invoke Application

#### Failure 1 — Action Tidak Dipanggil

Kemungkinan penyebab sebelum phase ini:

```text
- component not decoded
- validation failed
- conversion failed
- update model failed
- button outside form
- rendered condition unstable
- wrong form submitted
- immediate behavior changed flow
```

Jangan langsung menyalahkan method signature.

#### Failure 2 — Business Exception Tanpa Message Baik

Jika service throw exception:

```java
caseService.approve(caseId);
```

View bisa menghasilkan stacktrace/error page buruk.

Better:

```java
try {
    caseService.approve(caseId);
    facesMessages.info("Case approved.");
    return "detail?faces-redirect=true&id=" + caseId;
} catch (BusinessRuleException e) {
    facesMessages.error(e.getUserMessage());
    return null;
}
```

Rule:

- domain exception harus diterjemahkan menjadi user-facing message yang aman,
- technical exception masuk observability/log,
- jangan render stacktrace ke user.

#### Failure 3 — Double Submit

User double-click Save.

Alur:

```text
POST #1 save
POST #2 save
```

Jika action tidak idempotent:

- duplicate record,
- duplicate workflow transition,
- duplicate email,
- stale optimistic lock,
- double audit trail.

Mitigasi:

- PRG,
- idempotency token,
- optimistic locking,
- disable button client-side hanya sebagai UX aid,
- server-side command deduplication.

#### Failure 4 — Authorization Hanya di View

Jika button disembunyikan:

```xml
<h:commandButton rendered="#{security.canApprove}" action="#{bean.approve}" />
```

Itu bukan enforcement.

Action/service tetap harus cek:

```java
authorizationService.assertCanApprove(currentUser, caseId);
```

Rule:

```text
rendered=false improves UX, not security.
```

---

## 10. Phase 6 — Render Response

Render Response menghasilkan HTML atau partial response Ajax.

### 10.1 Apa yang Terjadi?

Faces traverse component tree:

```text
UIViewRoot.encodeAll()
  -> encodeBegin
  -> encodeChildren
  -> encodeEnd
```

Renderers menghasilkan markup:

```html
<form id="caseForm" method="post">
  <input id="caseForm:title" name="caseForm:title" value="..." />
  <input type="hidden" name="jakarta.faces.ViewState" value="..." />
</form>
```

### 10.2 Rendering Bisa Terjadi Setelah Success atau Failure

Render Response bukan berarti request sukses.

Bisa karena:

- normal GET,
- normal POST success stay on page,
- validation failure,
- conversion failure,
- model update failure,
- action returned null,
- exception handler decided render error view.

### 10.3 State Saving

Di akhir render, Faces menyimpan view state.

State bisa:

- server-side,
- client-side,
- partial state saving.

Detailnya akan dibahas di Part 21.

### 10.4 Failure Modes di Render Response

#### Failure 1 — Getter Lambat Dipanggil Berkali-kali

View:

```xml
<h:dataTable value="#{bean.cases}" var="c">
```

Jika getter melakukan DB query:

```java
public List<CaseRow> getCases() {
    return caseRepository.findAll(); // buruk jika dipanggil berkali-kali
}
```

Render bisa lambat atau N+1.

Rule:

```text
Getter used by view should be cheap, deterministic, and side-effect free.
```

#### Failure 2 — Rendered Condition Mahal

```xml
<h:commandButton rendered="#{permissionBean.canApprove(row)}" />
```

Dalam data table 500 row, method bisa dipanggil ratusan kali.

Better:

- precompute permission flag di row view model,
- bulk load permissions,
- cache per request.

#### Failure 3 — Component ID Target Ajax Tidak Ada

Ajax render:

```xml
<f:ajax render="detailsPanel" />
```

Jika target tidak ada karena `rendered=false`, update gagal.

Better:

- render wrapper yang selalu ada,
- conditional content di dalam wrapper.

```xml
<h:panelGroup id="detailsWrapper" layout="block">
    <h:panelGroup rendered="#{bean.showDetails}">
        ...
    </h:panelGroup>
</h:panelGroup>
```

---

## 11. `immediate=true`: Shortcut yang Sering Disalahpahami

`immediate=true` mengubah fase di mana component memproses event/value.

Ini bukan “skip validation semua” secara universal.

Perilakunya bergantung pada component type.

### 11.1 Immediate pada Command Component

Contoh Cancel button:

```xml
<h:commandButton value="Cancel" action="#{bean.cancel}" immediate="true" />
```

Efek praktis:

- action event diproses lebih awal, di Apply Request Values,
- bisa melewati validation input lain,
- cocok untuk Cancel/Back yang tidak perlu memproses form.

Flow:

```text
Apply Request Values
  -> decode cancel button
  -> invoke immediate action/listener
  -> navigate/render response
```

Use case valid:

- Cancel,
- Back,
- Reset navigation,
- Close dialog.

Use case berbahaya:

- Save,
- Approve,
- Submit business action.

### 11.2 Immediate pada Input Component

Contoh:

```xml
<h:inputText value="#{bean.query}" immediate="true" />
```

Efek:

- conversion/validation input tersebut bisa terjadi lebih awal, di Apply Request Values.

Ini jarang dibutuhkan kecuali untuk advanced event/value-change flow.

### 11.3 Common Misuse

Developer memasang `immediate=true` pada Save karena action tidak terpanggil.

```xml
<h:commandButton value="Save" action="#{bean.save}" immediate="true" />
```

Ini sering hanya menutupi masalah validation.

Akibat:

- form tidak tervalidasi sesuai harapan,
- model belum di-update,
- action melihat old values,
- data corrupt.

Rule:

```text
If Save needs immediate=true, you probably have a lifecycle design bug.
```

### 11.4 Safer Debug Question

Sebelum pakai `immediate=true`, tanyakan:

```text
Apakah action ini memang harus berjalan walaupun form invalid?
```

Jika jawabannya “tidak”, jangan pakai `immediate=true`.

---

## 12. `renderResponse()` dan `responseComplete()`

Faces menyediakan dua sinyal lifecycle penting.

### 12.1 `renderResponse()`

Maknanya:

```text
Skip remaining execute phases and jump to Render Response.
```

Dipakai ketika:

- validation gagal,
- conversion gagal,
- custom listener ingin render view sekarang,
- flow ingin tetap pada halaman yang sama.

### 12.2 `responseComplete()`

Maknanya:

```text
Faces should not render response. Response already handled.
```

Dipakai ketika:

- redirect manual,
- file download,
- streaming response,
- custom binary output,
- external authentication handshake.

Contoh konseptual:

```java
public void download() throws IOException {
    FacesContext context = FacesContext.getCurrentInstance();
    ExternalContext external = context.getExternalContext();

    external.setResponseContentType("application/pdf");
    external.setResponseHeader("Content-Disposition", "attachment; filename=case.pdf");

    try (OutputStream out = external.getResponseOutputStream()) {
        documentService.writePdf(caseId, out);
    }

    context.responseComplete();
}
```

Jika lupa `responseComplete()`, Faces bisa mencoba render view setelah output binary ditulis.

---

## 13. Ajax Lifecycle Subset

Faces Ajax tidak berarti bypass lifecycle.

Ia menjalankan subset lifecycle berdasarkan `execute` dan `render`.

Contoh:

```xml
<h:inputText id="postalCode" value="#{bean.postalCode}">
    <f:ajax event="blur" execute="@this" render="addressPanel messages" listener="#{bean.lookupAddress}" />
</h:inputText>
```

### 13.1 `execute`

Menentukan component mana yang diproses dalam lifecycle.

Contoh:

```text
execute="@this"
```

Artinya hanya component pemicu diproses.

Pilihan umum:

```text
@this
@form
@all
@none
specificComponentId
```

### 13.2 `render`

Menentukan component mana yang dirender ulang dalam partial response.

```text
render="addressPanel messages"
```

### 13.3 Ajax Flow

```text
Ajax request
  -> Restore View
  -> Apply Request Values for execute components
  -> Process Validations for execute components
  -> Update Model Values for execute components
  -> Invoke listener/action if applicable
  -> Render partial response for render targets
```

### 13.4 Failure Modes Ajax

#### Failure 1 — Listener Tidak Dipanggil Karena Validation Error di Execute Scope

Jika `execute="@form"`, semua input dalam form bisa divalidasi.

Jika ada field required kosong, listener tidak jalan.

Better untuk field-specific lookup:

```xml
<f:ajax execute="@this" render="addressPanel messages" />
```

#### Failure 2 — Model Tidak Update Karena Execute Salah

Jika input yang ingin dipakai listener tidak ada dalam execute scope, bean masih melihat old value.

Rule:

```text
If listener needs value, include component in execute.
```

#### Failure 3 — Render Target Tidak Ditemukan

Target harus ada dalam component tree.

Jika target conditional rendered false, update bisa gagal.

Gunakan stable wrapper.

#### Failure 4 — Partial Response Rusak

Jika server mengirim HTML error page ke Ajax request, browser/Faces JS bisa gagal parse partial response.

Penyebab:

- exception,
- session timeout redirect ke login HTML,
- security filter mengembalikan full page,
- binary/log/debug output tercampur.

Rule:

- Ajax request butuh error handling yang aware terhadap partial response.

---

## 14. PhaseListener untuk Debugging dan Instrumentasi

`PhaseListener` memungkinkan kita mengamati lifecycle.

Contoh sederhana:

```java
import jakarta.faces.event.PhaseEvent;
import jakarta.faces.event.PhaseId;
import jakarta.faces.event.PhaseListener;

public class LifecycleLoggingPhaseListener implements PhaseListener {

    @Override
    public void beforePhase(PhaseEvent event) {
        System.out.println("BEFORE " + event.getPhaseId());
    }

    @Override
    public void afterPhase(PhaseEvent event) {
        System.out.println("AFTER " + event.getPhaseId());
    }

    @Override
    public PhaseId getPhaseId() {
        return PhaseId.ANY_PHASE;
    }
}
```

Registrasi di `faces-config.xml`:

```xml
<faces-config version="4.1"
              xmlns="https://jakarta.ee/xml/ns/jakartaee"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                                  https://jakarta.ee/xml/ns/jakartaee/web-facesconfig_4_1.xsd">
    <lifecycle>
        <phase-listener>com.example.LifecycleLoggingPhaseListener</phase-listener>
    </lifecycle>
</faces-config>
```

### 14.1 Jangan Logging Berlebihan di Production

Phase listener bisa sangat noisy.

Gunakan untuk:

- diagnosis environment tertentu,
- correlation id,
- timing per phase,
- sampling,
- debug mode.

Jangan log semua request detail dengan PII.

### 14.2 Metrics yang Berguna

Untuk enterprise app, metrik lifecycle berguna:

```text
- total Faces request duration
- duration per phase
- validation failure count
- conversion failure count
- ViewExpiredException count
- Ajax error count
- view id
- user role class, bukan user PII
- component tree size approximation
- view state size
```

---

## 15. Debugging Checklist: “Action Tidak Terpanggil”

Ini salah satu masalah paling umum. Jangan debug secara acak.

Gunakan decision tree ini:

```text
1. Apakah request benar-benar terkirim?
   - cek browser network
   - cek method POST/Ajax
   - cek server access log

2. Apakah button berada di dalam h:form?
   - jika tidak, perbaiki struktur form

3. Apakah component button ada dalam tree saat postback?
   - cek rendered condition
   - cek include condition
   - cek dynamic component

4. Apakah form yang benar disubmit?
   - multiple forms?
   - nested forms invalid HTML?

5. Apakah validation/conversion gagal?
   - tambahkan h:messages
   - cek required hidden field
   - cek converter

6. Apakah immediate mengubah flow?
   - command immediate?
   - input immediate?

7. Apakah Ajax execute terlalu luas/sempit?
   - execute @form memicu validation lain?
   - execute @this membuat bean value belum update?

8. Apakah ada exception sebelum Invoke Application?
   - server log
   - exception handler

9. Apakah navigation/action signature valid?
   - method exists?
   - return type supported?
   - bean name benar?

10. Apakah ada security/filter redirect?
   - session timeout?
   - CSRF filter?
```

---

## 16. Debugging Checklist: “Value Tidak Berubah di Bean”

Decision tree:

```text
1. Apakah input dikirim dalam request?
   - cek Network tab payload

2. Apakah input berada dalam submitted h:form?
   - HTML form boundary

3. Apakah input ada dalam execute scope Ajax?
   - execute @this/@form/specific id

4. Apakah converter sukses?
   - cek message

5. Apakah validator sukses?
   - cek message

6. Apakah Update Model Values berjalan?
   - validation failure akan skip

7. Apakah property writable?
   - setter ada?

8. Apakah nested object null?
   - bean.form null?

9. Apakah bean scope membuat instance baru?
   - request/view/session scope salah?

10. Apakah getter mengembalikan object baru setiap kali?
   - getForm() new Form() setiap call?
```

Anti-pattern serius:

```java
public CaseForm getForm() {
    return new CaseForm(); // buruk
}
```

Ini membuat update/read tidak stabil.

Better:

```java
@PostConstruct
public void init() {
    this.form = new CaseForm();
}

public CaseForm getForm() {
    return form;
}
```

---

## 17. Debugging Checklist: “Validation Gagal Tapi Tidak Jelas”

```text
1. Tambahkan h:messages global dan component-level.
2. Cek converter message.
3. Cek required fields yang tersembunyi CSS.
4. Cek field yang ikut submit dari form sama.
5. Cek nested forms HTML invalid.
6. Cek select item list stabil saat postback.
7. Cek custom validator throw ValidatorException dengan message jelas.
8. Cek Bean Validation annotation.
9. Cek locale/date/number format.
10. Cek Ajax render messages.
```

Minimal debug view:

```xml
<h:messages id="messages" globalOnly="false" styleClass="messages" />
```

Untuk Ajax:

```xml
<f:ajax execute="@form" render="messages formPanel" />
```

---

## 18. Debugging Checklist: `ViewExpiredException`

Decision tree:

```text
1. Apakah session timeout?
2. Apakah user membuka halaman lama lalu submit?
3. Apakah deployment/restart terjadi?
4. Apakah load balancer sticky?
5. Apakah server-side state replicated?
6. Apakah jumlah logical views terlalu kecil?
7. Apakah client-side state token dipotong oleh proxy/WAF?
8. Apakah page di-cache browser/proxy secara salah?
9. Apakah multiple tabs menggunakan stale view?
10. Apakah state saving config berubah antar node?
```

Mitigasi tergantung akar masalah:

- user-friendly expired page,
- PRG untuk flow sukses,
- shorter forms,
- state size reduction,
- sticky session/replication,
- robust exception handler,
- avoid caching protected Faces pages.

---

## 19. Lifecycle dan Security

Lifecycle punya implikasi security besar.

### 19.1 UI Rendering Bukan Authorization

Jika action tidak terlihat, attacker masih bisa mencoba request.

Security harus ada di:

```text
- route/filter/security layer
- backing action
- service/domain method
```

View hanya UX.

### 19.2 Validation Bukan Domain Integrity Final

UI validation bisa dilewati melalui crafted request.

Domain/service tetap harus enforce:

- allowed transition,
- ownership,
- role,
- status precondition,
- optimistic version,
- required fields,
- business constraints.

### 19.3 Hidden Field Tidak Trusted

Hidden field juga request parameter.

```xml
<h:inputHidden value="#{bean.caseId}" />
```

User bisa ubah.

Better:

- id dari URL/path/view state divalidasi,
- server-side authorization check,
- signed token jika perlu,
- do not store sensitive decision solely in hidden input.

### 19.4 View State Bukan Tempat Rahasia Sembarangan

Client-side state bisa encoded/encrypted/signed tergantung config/implementation, tetapi jangan desain seolah semua object sensitif aman untuk dilempar ke client.

Rule:

```text
Store minimal UI state. Keep secrets server-side.
```

---

## 20. Lifecycle dan Performance

Setiap phase punya potensi cost.

### 20.1 Restore View Cost

Dipengaruhi:

- component tree size,
- view state size,
- dynamic component complexity,
- server/client state saving,
- template complexity.

### 20.2 Apply Request Values Cost

Dipengaruhi:

- jumlah component input,
- data table dengan banyak row,
- complex naming containers,
- multipart request.

### 20.3 Process Validations Cost

Dipengaruhi:

- converter mahal,
- validator memanggil database,
- Bean Validation graph besar,
- repeated validation dalam table.

Rule:

```text
Validator boleh cek format/range/reference ringan.
Business rule berat lebih cocok di service action.
```

### 20.4 Update Model Values Cost

Dipengaruhi:

- setter side effect,
- nested object graph besar,
- reflection/EL binding.

Setter harus ringan.

### 20.5 Invoke Application Cost

Dipengaruhi:

- service/database call,
- external integration,
- transaction,
- file processing,
- email/event publishing.

Ini fase yang wajar untuk business cost.

### 20.6 Render Response Cost

Dipengaruhi:

- getter mahal,
- permission check per row,
- large table,
- conditional rendering kompleks,
- resource inclusion,
- partial render target terlalu luas,
- serialization state.

---

## 21. Enterprise Example: Case Approval Page

Kita gunakan contoh regulatory case approval.

### 21.1 View

```xml
<h:form id="approvalForm">
    <h:messages id="messages" />

    <h:outputText value="Case Number" />
    <h:outputText value="#{approvalBean.caseView.caseNumber}" />

    <h:outputText value="Decision" />
    <h:selectOneMenu id="decision" value="#{approvalBean.form.decision}" required="true">
        <f:selectItem itemLabel="-- Select --" itemValue="" />
        <f:selectItem itemLabel="Approve" itemValue="APPROVE" />
        <f:selectItem itemLabel="Reject" itemValue="REJECT" />
    </h:selectOneMenu>
    <h:message for="decision" />

    <h:outputText value="Remarks" />
    <h:inputTextarea id="remarks" value="#{approvalBean.form.remarks}" required="true" />
    <h:message for="remarks" />

    <h:commandButton id="submit" value="Submit" action="#{approvalBean.submit}" />
    <h:commandButton id="cancel" value="Cancel" action="#{approvalBean.cancel}" immediate="true" />
</h:form>
```

### 21.2 Backing Bean

```java
@Named
@ViewScoped
public class ApprovalBean implements Serializable {

    private CaseApprovalForm form;
    private CaseView caseView;

    @Inject
    private CaseApprovalService approvalService;

    @PostConstruct
    public void init() {
        this.form = new CaseApprovalForm();
        this.caseView = loadCaseView();
    }

    public String submit() {
        approvalService.submitDecision(caseView.getCaseId(), form);
        return "/case/detail?faces-redirect=true&id=" + caseView.getCaseId();
    }

    public String cancel() {
        return "/case/detail?faces-redirect=true&id=" + caseView.getCaseId();
    }

    public CaseApprovalForm getForm() {
        return form;
    }

    public CaseView getCaseView() {
        return caseView;
    }
}
```

### 21.3 Lifecycle Submit Success

```text
POST approvalForm
  Restore View
    -> restore approval page component tree
  Apply Request Values
    -> decision submitted value captured
    -> remarks submitted value captured
    -> submit button event queued
  Process Validations
    -> decision required passes
    -> remarks required passes
  Update Model Values
    -> form.decision updated
    -> form.remarks updated
  Invoke Application
    -> approvalBean.submit()
    -> approvalService.submitDecision(...)
    -> redirect detail
  Render Response
    -> redirect response / next GET
```

### 21.4 Lifecycle Submit Failure

User leaves remarks empty.

```text
POST approvalForm
  Restore View
  Apply Request Values
  Process Validations
    -> remarks required fails
    -> FacesMessage queued
    -> renderResponse
  Update Model Values skipped
  Invoke Application skipped
  Render Response
    -> same page with messages
```

`approvalBean.submit()` tidak dipanggil. Ini benar.

### 21.5 Cancel Flow

User clicks Cancel with empty remarks.

```text
POST approvalForm
  Restore View
  Apply Request Values
    -> cancel button immediate event processed
    -> approvalBean.cancel()
    -> redirect detail
  Process Validations skipped/irrelevant
  Update Model Values skipped
  Invoke Application skipped/irrelevant
```

Ini use case valid untuk `immediate=true`.

---

## 22. Enterprise Failure Modeling Table

| Symptom | Likely Failed Phase | Common Cause | Better Diagnosis |
|---|---:|---|---|
| Action not called | Before/at Invoke Application | validation failed, button not decoded, outside form | Add messages, inspect request payload, lifecycle log |
| Bean value old in action | Update Model Values skipped or Ajax execute too narrow | validation failure, `execute=@this` only button | Check execute scope and validation messages |
| Setter not called | Update Model Values | invalid input, read-only property, nested null | Check validation and writable binding |
| Converter error | Process Validations | bad format, unstable select items | Show messages, inspect converter |
| Required hidden field blocks submit | Process Validations | CSS hidden component still in tree | Use `rendered`/conditional required correctly |
| Ajax listener not called | Process Validations | execute scope includes invalid fields | Narrow execute or fix validation |
| Ajax update no effect | Render Response | render target not in tree/wrong id | Use stable wrapper, inspect client id |
| ViewExpiredException | Restore View | expired/missing state/session | Check session, LB, state saving |
| Duplicate ID | Restore/build view | repeated manual id/dynamic include | Inspect template/tree structure |
| Slow page | Restore/Render mostly | large tree, expensive getters, big table | Profile phase timing/getters |
| Double save | Invoke Application | repeated POST | PRG/idempotency/optimistic lock |

---

## 23. Practical Rules for Top-Tier Faces Engineering

### Rule 1 — Treat Lifecycle as Contract

Do not fight the lifecycle. Design with it.

Bad:

```text
Why is save not called? Put immediate=true.
```

Good:

```text
Which phase stopped the lifecycle, and why?
```

### Rule 2 — Keep Getters Cheap

Getters can be called multiple times during render.

Bad:

```java
public List<Row> getRows() {
    return repository.search(criteria);
}
```

Good:

```java
@PostConstruct
public void init() {
    rows = repository.search(criteria);
}

public List<Row> getRows() {
    return rows;
}
```

Or load explicitly in action/listener.

### Rule 3 — Setter Must Not Execute Business Logic

Setter is lifecycle plumbing.

Business transitions belong in action/service.

### Rule 4 — Use `immediate=true` Only for Real Escape Actions

Good:

- Cancel,
- Back,
- Close,
- Reset navigation.

Bad:

- Save,
- Approve,
- Submit,
- Confirm payment.

### Rule 5 — Always Render Messages During Development

At least while building/debugging:

```xml
<h:messages globalOnly="false" />
```

Many “silent” bugs are actually visible queued messages.

### Rule 6 — Stabilize Component Tree Across Postback

Avoid unstable `rendered`, unstable includes, dynamic ids, and changing select items before decode/validation.

### Rule 7 — Think in Form Boundary

HTML form boundary matters.

One submit sends one form.

Faces cannot process inputs not submitted.

### Rule 8 — For Ajax, Always Ask Execute/Render

For every Ajax bug:

```text
What components are executed?
What components are rendered?
```

### Rule 9 — Validate at UI, Enforce at Domain

UI validation improves UX.

Domain/service enforcement protects correctness.

### Rule 10 — Instrument Lifecycle in Complex Systems

For large enterprise screens, phase timing and validation failure metrics can save days of debugging.

---

## 24. Java 8 sampai Java 25: Lifecycle Impact

Faces lifecycle concept relatif stabil dari Java 8 sampai Java 25, tetapi runtime environment berubah.

### 24.1 Java 8 Legacy

Umumnya:

- Java EE 7/8,
- `javax.faces.*`,
- older JSF 2.x,
- older EL,
- older CDI integration,
- app server lama.

Risiko:

- custom managed bean legacy,
- XML config lama,
- library component lama,
- old state saving bugs,
- limited modern language features.

### 24.2 Java 11/17 Migration

Perhatian:

- dependency update,
- module accessibility,
- JAXB/JAX-WS removal from JDK era Java 11,
- old app server incompatibility,
- reflection warnings/errors.

### 24.3 Java 17+ Jakarta EE 11 Baseline

Jakarta EE 11 minimum Java SE 17.

Dampak:

- namespace `jakarta.*`,
- modern CDI/Faces APIs,
- record support di platform tertentu,
- SecurityManager assumption removed,
- library compatibility harus dicek.

### 24.4 Java 21/25

Lifecycle Faces tetap sama secara konseptual.

Namun engineering concern bertambah:

- virtual threads dapat memengaruhi request concurrency model jika container mendukung,
- lebih banyak concurrent requests bisa memperbesar pressure pada session/state,
- blocking service calls di action tetap harus dipahami,
- component tree/session memory tetap constraint.

Rule:

```text
Virtual threads do not make component state free.
```

---

## 25. Mini Lab: Trace Lifecycle Manual

Gunakan halaman sederhana:

```xml
<h:form id="form">
    <h:messages id="messages" />

    <h:inputText id="name" value="#{demoBean.name}" required="true" />

    <h:commandButton id="save" value="Save" action="#{demoBean.save}" />
    <h:commandButton id="cancel" value="Cancel" action="#{demoBean.cancel}" immediate="true" />
</h:form>
```

Bean:

```java
@Named
@ViewScoped
public class DemoBean implements Serializable {
    private String name;

    public String save() {
        System.out.println("SAVE name=" + name);
        return null;
    }

    public String cancel() {
        System.out.println("CANCEL name=" + name);
        return null;
    }

    public String getName() {
        System.out.println("getName=" + name);
        return name;
    }

    public void setName(String name) {
        System.out.println("setName=" + name);
        this.name = name;
    }
}
```

Eksperimen:

1. Klik Save dengan name kosong.
2. Klik Save dengan name terisi.
3. Klik Cancel dengan name kosong.
4. Tambahkan Ajax `execute="@this"`, amati value di bean.
5. Tambahkan converter/validator, amati phase failure.
6. Tambahkan PhaseListener, cocokkan log dengan ekspektasi.

Pertanyaan diagnosis:

```text
- Pada eksperimen mana setter dipanggil?
- Pada eksperimen mana action dipanggil?
- Pada eksperimen mana validation menghentikan lifecycle?
- Apa efek immediate pada cancel?
- Kenapa getter bisa dipanggil saat render?
```

---

## 26. Checklist Review Lifecycle untuk Pull Request

Gunakan checklist ini saat review screen Faces:

```text
[ ] Semua command/input berada dalam h:form yang benar.
[ ] Tidak ada nested HTML form.
[ ] Component action penting tidak bergantung pada rendered condition yang unstable.
[ ] Semua validation message bisa terlihat user.
[ ] Ajax execute/render disetel eksplisit dan minimal.
[ ] Render target Ajax selalu ada di tree atau punya stable wrapper.
[ ] Getter tidak melakukan DB/service call mahal.
[ ] Setter tidak punya side effect bisnis.
[ ] Save/Approve/Submit tidak memakai immediate=true tanpa alasan kuat.
[ ] Cancel/Back boleh immediate=true jika memang bypass validation.
[ ] Select items stabil saat postback.
[ ] Required field tidak disembunyikan hanya dengan CSS jika masih ikut validasi.
[ ] Authorization tetap dicek di service/action, bukan hanya rendered.
[ ] Double submit dimitigasi.
[ ] ViewExpiredException punya user-friendly handling.
[ ] Long-running action punya UX/timeout strategy.
[ ] Phase-specific failures dapat diobservasi lewat log/metrics.
```

---

## 27. Ringkasan Mental Model

Jakarta Faces lifecycle adalah pipeline stateful yang mengubah request browser menjadi perubahan model dan action aplikasi melalui component tree.

Flow dasarnya:

```text
Restore View
  -> build/restore component tree

Apply Request Values
  -> request parameters decoded into components

Process Validations
  -> submitted strings converted and validated

Update Model Values
  -> valid component values written into backing bean

Invoke Application
  -> action/listener/service/navigation

Render Response
  -> component tree encoded into HTML/partial response and state saved
```

Failure model dasarnya:

```text
If conversion/validation fails:
  model is not updated
  action is not invoked
  same view is rendered with messages

If component is not in tree:
  it cannot decode request
  its action/listener will not run

If Ajax execute excludes input:
  bean may see old value

If Ajax render excludes message/target:
  user may not see change/error

If view state is missing/expired:
  restore view fails
```

Cara berpikir top-tier:

```text
Jangan bertanya “kenapa JSF aneh?”
Tanyakan “phase mana yang berjalan, phase mana yang berhenti, dan state apa yang tersedia di titik itu?”
```

---

## 28. Koneksi ke Part Berikutnya

Bagian ini membangun fondasi lifecycle.

Part berikutnya akan masuk ke component standar Faces:

```text
18-faces-components-input-output-command-data-message-metadata.md
```

Di sana kita akan membedah component seperti:

- `h:form`,
- `h:inputText`,
- `h:inputTextarea`,
- `h:selectOneMenu`,
- `h:commandButton`,
- `h:commandLink`,
- `h:messages`,
- `h:dataTable`,
- `f:facet`,
- `f:metadata`,
- `f:viewParam`,
- `f:viewAction`,
- naming container,
- client id,
- rendering behavior.

Lifecycle yang dibahas di sini akan menjadi peta untuk memahami semua component tersebut.

---

## 29. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[selesai] 00 - Orientation
[selesai] 01 - History and Compatibility
[selesai] 02 - Jakarta Pages/JSP Internal Architecture
[selesai] 03 - JSP Syntax
[selesai] 04 - Request/Session/Application Scope
[selesai] 05 - EL Fundamentals
[selesai] 06 - Advanced EL
[selesai] 07 - JSTL Core Tags
[selesai] 08 - Formatting/I18N/XML/SQL Tags
[selesai] 09 - Custom Tags and Tag Files
[selesai] 10 - JSP Layouting
[selesai] 11 - JSP Security
[selesai] 12 - JSP Performance and Operations
[selesai] 13 - Testing JSP and Tag Libraries
[selesai] 14 - Jakarta Faces Big Picture
[selesai] 15 - Facelets and XHTML View Authoring
[selesai] 16 - Faces Managed Beans, CDI Scopes, Dependency Boundaries
[selesai] 17 - Faces Lifecycle Deep Dive
[berikutnya] 18 - Faces Components
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 16 — Faces Managed Beans, CDI, Scopes, and Dependency Boundaries](./16-faces-managed-beans-cdi-scopes-dependency-boundaries.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 18 — Faces Components: Input, Output, Command, Data, Message, and Metadata](./18-faces-components-input-output-command-data-message-metadata.md)
