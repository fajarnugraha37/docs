# Part 18 — Faces Components: Input, Output, Command, Data, Message, and Metadata

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `18-faces-components-input-output-command-data-message-metadata.md`  
> Fokus: memahami komponen standar Jakarta Faces sebagai building blocks runtime, bukan hanya tag XHTML.

---

## 0. Posisi Materi Ini Dalam Seri

Sampai Part 17, kita sudah membangun mental model bahwa Jakarta Faces bukan template engine sederhana. Faces adalah framework UI berbasis **component tree** dengan lifecycle request/postback yang jelas:

1. Restore View.
2. Apply Request Values.
3. Process Validations.
4. Update Model Values.
5. Invoke Application.
6. Render Response.

Part ini masuk ke level konkret: komponen apa saja yang biasanya membentuk halaman Faces, bagaimana tag XHTML berubah menjadi object component, dan bagaimana component itu ikut lifecycle.

Hal yang perlu diluruskan sejak awal:

```text
<h:inputText> bukan sekadar <input type="text">.
<h:commandButton> bukan sekadar <button>.
<h:dataTable> bukan sekadar <table>.
<f:viewParam> bukan sekadar request.getParameter(...).
```

Di Faces, tag view adalah deklarasi component. Component menyimpan state, membaca request parameter, melakukan conversion/validation, mengirim event, memperbarui model, lalu merender HTML.

Kalau kita hanya melihat hasil HTML, kita kehilangan 70% perilaku runtime.

---

## 1. Core Mental Model: Tag, Component, Renderer, State

Satu baris Facelets seperti ini:

```xml
<h:inputText id="email" value="#{userForm.email}" required="true" />
```

secara konseptual melibatkan beberapa layer:

```text
Facelets tag
   ↓ build view
UIInput component instance
   ↓ postback lifecycle
submittedValue / localValue / valid flag / messages
   ↓ converter + validator
model update to #{userForm.email}
   ↓ renderer
HTML <input ...>
```

Jadi ada empat konsep yang harus dipisah:

| Konsep | Peran |
|---|---|
| Tag | Deklarasi dalam `.xhtml` |
| Component | Object server-side dalam component tree |
| Renderer | Mengubah component menjadi markup/HTML dan decode request |
| State | Nilai dan metadata component yang disimpan antar request |

Kesalahan umum developer adalah menganggap tag sama dengan HTML. Padahal tag adalah instruksi untuk membangun object component. Object component itu hidup dalam lifecycle.

---

## 2. Namespace Komponen Yang Paling Sering Dipakai

Dalam Facelets, namespace biasanya seperti ini:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets">
```

Namespace penting:

| Prefix | Fungsi |
|---|---|
| `h` | HTML render kit components: form, input, output, command, table, messages |
| `f` | Core Faces tags: metadata, converter, validator, ajax, attribute, facet, viewParam, viewAction |
| `ui` | Facelets templating: composition, define, insert, include, repeat, fragment |
| `c` | JSTL core; hati-hati karena build-time/tag-time, bukan component lifecycle |
| `pt` | Pass-through attributes ke HTML5 |
| `cc` | Composite components |

Part ini fokus ke `h:*` dan `f:*` yang membentuk page behavior.

---

## 3. Standard Component Families: Bukan Hafalan, Tapi Kategori Perilaku

Komponen standar Faces bisa dipahami sebagai kategori perilaku:

```text
Output components
  → menampilkan data

Input components
  → menerima submitted value, convert, validate, update model

Command components
  → memicu action/event/navigation

Data components
  → melakukan repeated rendering terhadap row model

Message components
  → menampilkan FacesMessage dari lifecycle

Metadata components
  → membaca/validasi parameter view sebelum view normal diproses

Core helper tags
  → facet, ajax, converter, validator, select item, attribute, param
```

Dengan mental model ini, kita bisa menebak lifecycle behavior tanpa menghafal semua atribut.

---

## 4. Component Identity: `id`, Client ID, Naming Container

### 4.1 `id` Bukan Sekadar HTML ID

Dalam Faces, `id` adalah server-side component id relatif terhadap parent naming container.

Contoh:

```xml
<h:form id="caseForm">
    <h:inputText id="referenceNo" value="#{caseForm.referenceNo}" />
</h:form>
```

HTML yang dirender bisa menjadi:

```html
<input id="caseForm:referenceNo" name="caseForm:referenceNo" ...>
```

`caseForm:referenceNo` disebut **client id**.

### 4.2 Kenapa Client ID Penting?

Client ID dipakai untuk:

1. Nama request parameter saat form submit.
2. Target Ajax render/update.
3. Label `for` association.
4. Message binding.
5. JavaScript selector.
6. Browser DOM id.

Kalau client id salah, gejalanya bisa aneh:

```text
- Ajax tidak update area yang diharapkan.
- Message tidak muncul di field yang benar.
- Action tidak menerima value.
- JavaScript selector gagal.
- Duplicate ID exception.
```

### 4.3 Naming Container

Naming container adalah komponen yang membuat namespace id baru. Contoh umum:

1. `h:form`.
2. `h:dataTable`.
3. composite component.
4. beberapa component library container.

Di dalam data table, client id bisa seperti:

```text
caseForm:caseTable:0:actionButton
caseForm:caseTable:1:actionButton
caseForm:caseTable:2:actionButton
```

Index row menjadi bagian dari client id.

### 4.4 Rule Praktis

Selalu beri `id` eksplisit pada component penting:

```xml
<h:form id="searchForm">
    <h:inputText id="keyword" value="#{searchBean.keyword}" />
    <h:commandButton id="searchButton" value="Search" action="#{searchBean.search}" />
</h:form>
```

Jangan mengandalkan generated id seperti `j_idt42` karena sulit dites, sulit di-debug, dan rapuh untuk Ajax/JavaScript.

---

## 5. `h:form`: Boundary Submit Faces

### 5.1 `h:form` Wajib Untuk Input dan Command

Faces command/input biasanya perlu berada di dalam `h:form`.

```xml
<h:form id="profileForm">
    <h:inputText id="name" value="#{profileBean.name}" />
    <h:commandButton id="save" value="Save" action="#{profileBean.save}" />
</h:form>
```

`h:form` merender HTML `<form>` plus hidden fields Faces seperti view state.

Secara konseptual:

```text
h:form
  ├─ rendered HTML <form>
  ├─ submitted request boundary
  ├─ view state hidden field
  ├─ command source identification
  └─ namespace for child component ids
```

### 5.2 Satu Form Besar vs Banyak Form Kecil

| Strategi | Kelebihan | Risiko |
|---|---|---|
| Satu form besar | semua field tersedia saat submit | lifecycle memproses terlalu banyak component |
| Banyak form kecil | submit lebih fokus | value di form lain tidak ikut terkirim |
| Form per row | mudah row action | markup besar dan id kompleks |
| Form per panel | cocok untuk Ajax | perlu discipline target update |

Rule praktis:

```text
Form boundary sebaiknya mengikuti use case submit, bukan layout visual.
```

Jangan membuat satu form raksasa hanya karena halaman terlihat satu layar.

### 5.3 Nested Form Tidak Valid

HTML tidak mendukung nested form. Hindari:

```xml
<h:form id="outer">
    ...
    <h:form id="inner">
        ...
    </h:form>
</h:form>
```

Efeknya bisa unpredictable di browser dan lifecycle Faces.

---

## 6. Output Components

Output component menampilkan data. Mereka tidak membaca submitted value dan tidak mengupdate model.

### 6.1 `h:outputText`

Contoh:

```xml
<h:outputText id="caseTitle" value="#{caseDetail.title}" />
```

Default penting: output text biasanya melakukan escaping.

Jika value:

```text
<script>alert(1)</script>
```

maka harus dirender sebagai teks aman, bukan script aktif.

### 6.2 `escape="false"`: High-Risk Switch

```xml
<h:outputText value="#{caseDetail.descriptionHtml}" escape="false" />
```

Ini berbahaya kecuali konten sudah disanitasi dengan policy ketat.

Gunakan `escape=false` hanya untuk:

1. trusted static HTML,
2. sanitized rich text,
3. content dari whitelist sanitizer,
4. bukan input mentah user.

### 6.3 `h:outputFormat`

Untuk message dengan parameter:

```xml
<h:outputFormat value="Case {0} assigned to {1}">
    <f:param value="#{caseDetail.referenceNo}" />
    <f:param value="#{caseDetail.assigneeName}" />
</h:outputFormat>
```

Lebih baik untuk template message sederhana daripada string concatenation di view.

### 6.4 `h:outputLabel`

```xml
<h:outputLabel for="email" value="Email" />
<h:inputText id="email" value="#{userForm.email}" />
```

`for` harus mengarah ke component id, bukan selalu client id literal.

Manfaat:

1. Accessibility.
2. Click label focus input.
3. Screen reader association.
4. Better form semantics.

### 6.5 Output Component Design Rule

Output component harus menerima data yang sudah cocok untuk display.

Buruk:

```xml
<h:outputText value="#{caseBean.case.entity.customer.profile.legalName.toUpperCase()}" />
```

Lebih baik:

```xml
<h:outputText value="#{caseView.customerLegalNameDisplay}" />
```

View tidak perlu tahu graph domain dalam.

---

## 7. Input Components: Submitted Value, Local Value, Model Value

Input component adalah komponen paling penting dalam Faces lifecycle.

Contoh:

```xml
<h:inputText id="email"
             value="#{userForm.email}"
             required="true" />
```

Pada postback, input component melewati state internal:

```text
HTTP request parameter
   ↓ decode
submittedValue: String/raw request value
   ↓ conversion
localValue: typed converted value
   ↓ validation
valid flag + FacesMessage if invalid
   ↓ update model
#{userForm.email} = localValue
```

### 7.1 Tiga Nilai Yang Harus Dibedakan

| Nilai | Arti |
|---|---|
| submitted value | raw value dari request parameter |
| local value | nilai yang sudah dikonversi di component |
| model value | property di backing bean |

Banyak bug Faces terjadi karena developer mengira model langsung berubah saat request masuk. Tidak. Model baru berubah pada phase **Update Model Values**, setelah conversion dan validation berhasil.

---

## 8. `h:inputText`

### 8.1 Basic Usage

```xml
<h:inputText id="referenceNo"
             value="#{caseSearchForm.referenceNo}"
             maxlength="30" />
```

Untuk HTML5 attribute, bisa memakai pass-through:

```xml
<h:inputText id="email"
             value="#{userForm.email}"
             pt:type="email"
             pt:placeholder="name@example.com"
             required="true" />
```

### 8.2 Required Semantics

```xml
<h:inputText id="title"
             value="#{caseForm.title}"
             required="true"
             requiredMessage="Title is required" />
```

`required=true` adalah UI-level validation.

Jangan menganggap ini menggantikan domain invariant.

```text
UI required validation:
  - memberi feedback cepat ke user
  - mencegah model update kalau kosong

Domain validation:
  - menjaga invariant walau request tidak datang dari halaman itu
  - tetap wajib di service/domain boundary
```

### 8.3 Converter Binding

Untuk tipe non-string:

```xml
<h:inputText id="amount" value="#{paymentForm.amount}">
    <f:convertNumber minFractionDigits="2" maxFractionDigits="2" />
</h:inputText>
```

Kalau conversion gagal, validation/action tidak berjalan seperti yang mungkin diharapkan.

---

## 9. `h:inputTextarea`

```xml
<h:inputTextarea id="remarks"
                 value="#{caseActionForm.remarks}"
                 rows="6"
                 cols="80"
                 maxlength="4000" />
```

Use case:

1. Remarks.
2. Internal notes.
3. Rejection reason.
4. Case minutes.
5. Free text explanation.

Security concern:

```text
Textarea input hampir selalu untrusted.
Render ulang dengan escaping.
Jangan render sebagai HTML kecuali disanitasi.
```

Operational concern:

```text
Long text fields dapat memperbesar request payload, database write, audit trail, dan page rendering.
```

Untuk sistem regulatory/case management, free text biasanya juga perlu:

1. max length yang jelas,
2. audit trail,
3. profanity/sensitive data consideration bila applicable,
4. line break rendering strategy,
5. export/report behavior.

---

## 10. Secret Input and Hidden Input

### 10.1 `h:inputSecret`

```xml
<h:inputSecret id="password"
               value="#{loginForm.password}"
               redisplay="false" />
```

Rule:

1. Jangan redisplay password.
2. Jangan simpan password di session bean lebih lama dari perlu.
3. Jangan log submitted value.
4. Jangan audit raw secret.

### 10.2 `h:inputHidden`

```xml
<h:inputHidden id="caseId" value="#{caseActionForm.caseId}" />
```

Hidden input bukan trusted state.

```text
Hidden field dapat diubah user.
```

Gunakan hidden input hanya sebagai submitted identifier, lalu validasi ulang di server:

1. case exists,
2. user authorized,
3. version matches,
4. state transition allowed,
5. action idempotent.

Untuk data sensitif, jangan taruh di hidden field.

---

## 11. Select Components

Faces memiliki select components untuk single/multiple choice.

### 11.1 `h:selectOneMenu`

```xml
<h:selectOneMenu id="status" value="#{caseSearchForm.status}">
    <f:selectItem itemLabel="-- All --" itemValue="" />
    <f:selectItems value="#{caseSearchBean.statusOptions}"
                   var="status"
                   itemValue="#{status.code}"
                   itemLabel="#{status.label}" />
</h:selectOneMenu>
```

Important points:

1. Submitted value biasanya string dari HTML.
2. Kalau model property enum/object, perlu converter atau item value yang cocok.
3. Option list harus stabil saat postback.
4. Jangan load option list mahal berkali-kali dari getter.

### 11.2 Select Item Object Strategy

Lebih baik backing bean menyediakan option model:

```java
public record SelectOption(String value, String label) {}
```

View:

```xml
<f:selectItems value="#{caseSearchBean.statusOptions}"
               var="option"
               itemValue="#{option.value}"
               itemLabel="#{option.label}" />
```

Keuntungan:

1. View tidak tahu enum/domain detail.
2. Label bisa localized.
3. Value bisa stable code.
4. Mudah dites.

### 11.3 `h:selectOneRadio`

```xml
<h:selectOneRadio id="decision" value="#{approvalForm.decision}">
    <f:selectItem itemLabel="Approve" itemValue="APPROVE" />
    <f:selectItem itemLabel="Reject" itemValue="REJECT" />
</h:selectOneRadio>
```

Cocok untuk pilihan kecil yang harus terlihat langsung.

### 11.4 `h:selectBooleanCheckbox`

```xml
<h:selectBooleanCheckbox id="confirm" value="#{actionForm.confirmed}" />
<h:outputLabel for="confirm" value="I confirm this action" />
```

Untuk checkbox yang merupakan agreement/confirmation, tetap validasi server-side.

### 11.5 `h:selectManyCheckbox` / `h:selectManyListbox`

```xml
<h:selectManyCheckbox id="roles" value="#{userForm.selectedRoleCodes}">
    <f:selectItems value="#{userForm.availableRoles}"
                   var="role"
                   itemValue="#{role.code}"
                   itemLabel="#{role.label}" />
</h:selectManyCheckbox>
```

Pastikan model type sesuai:

1. `String[]`,
2. `List<String>`,
3. Set/list dengan converter,
4. bukan entity langsung kecuali converter benar.

---

## 12. Command Components: Action, Event, Navigation

Command component memicu aksi aplikasi.

### 12.1 `h:commandButton`

```xml
<h:commandButton id="save"
                 value="Save"
                 action="#{caseEditBean.save}" />
```

Saat diklik:

```text
Browser submits h:form
   ↓
Faces detects command source
   ↓
Lifecycle processes inputs
   ↓
If valid, action method invoked
   ↓
Navigation outcome processed
```

Action method dapat:

```java
public String save() {
    caseService.save(form);
    return "detail?faces-redirect=true&caseId=" + form.id();
}
```

### 12.2 `h:commandLink`

```xml
<h:commandLink id="approve"
               value="Approve"
               action="#{caseActionBean.approve}" />
```

Walaupun terlihat seperti link, command link biasanya melakukan form submit. Jangan pakai command link untuk navigasi GET biasa.

Untuk navigasi GET, lebih baik:

```xml
<h:link outcome="case-detail" value="View">
    <f:param name="caseId" value="#{row.id}" />
</h:link>
```

### 12.3 Action vs ActionListener

| Mekanisme | Cocok Untuk |
|---|---|
| `action` | business action/navigation outcome |
| `actionListener` | UI event handling tambahan |

Biasanya pilih `action` untuk use case utama.

Buruk:

```xml
<h:commandButton value="Save" actionListener="#{bean.save}" />
```

Lebih baik:

```xml
<h:commandButton value="Save" action="#{bean.save}" />
```

### 12.4 `immediate=true` Pada Command

```xml
<h:commandButton id="cancel"
                 value="Cancel"
                 immediate="true"
                 action="#{caseEditBean.cancel}" />
```

`immediate=true` pada command sering dipakai untuk cancel/back karena tidak perlu validasi form.

Tetapi hati-hati:

```text
immediate=true mengubah fase event/action.
Pakai hanya jika memang ingin melewati validation/update model normal.
```

---

## 13. Navigation Components: `h:link`, `h:button`, `h:outputLink`

### 13.1 `h:link` Untuk GET Navigation

```xml
<h:link outcome="case-detail" value="Open">
    <f:param name="caseId" value="#{row.id}" />
</h:link>
```

`h:link` cocok untuk bookmarkable navigation.

### 13.2 `h:button`

```xml
<h:button outcome="case-create" value="Create New Case" />
```

Biasanya merender button/link-style navigation tanpa form action lifecycle.

### 13.3 `h:outputLink`

```xml
<h:outputLink value="#{externalSystemUrl}">
    <h:outputText value="Open External System" />
</h:outputLink>
```

Cocok untuk raw URL. Pastikan URL aman dan tidak user-controlled tanpa validasi.

### 13.4 Rule: GET vs POST

```text
GET link/button:
  - view detail
  - search result bookmark
  - pagination link
  - open printable page

POST command:
  - save
  - approve
  - reject
  - assign
  - delete
  - mutate state
```

Jangan memakai POST command untuk navigasi biasa, dan jangan memakai GET link untuk aksi mutasi.

---

## 14. Message Components

FacesMessage adalah mekanisme standar feedback lifecycle.

### 14.1 `h:message`

Menampilkan pesan untuk satu component.

```xml
<h:outputLabel for="email" value="Email" />
<h:inputText id="email" value="#{userForm.email}" required="true" />
<h:message for="email" />
```

Jika email invalid, pesan muncul di dekat field.

### 14.2 `h:messages`

Menampilkan semua/global messages.

```xml
<h:messages id="messages" globalOnly="false" />
```

Untuk global message dari action:

```java
facesContext.addMessage(null,
    new FacesMessage(FacesMessage.SEVERITY_INFO, "Saved", "Case was saved successfully"));
```

### 14.3 Field Message vs Global Message

| Message type | Contoh |
|---|---|
| Field-specific | `Email is required` |
| Global | `Case has been submitted` |
| Cross-field | `Start date must be before end date` |
| Authorization/business | `You are not allowed to approve this case` |

### 14.4 Message Design Rule

Pesan harus:

1. human-readable,
2. tidak membocorkan stack trace,
3. tidak membocorkan data sensitif,
4. bisa dilokalisasi,
5. cukup spesifik untuk recovery,
6. konsisten antara validation dan business failure.

Buruk:

```text
ORA-00001: unique constraint SYS.CASE_UK violated
```

Baik:

```text
A case with this reference number already exists.
```

---

## 15. Data Components: `h:dataTable`

### 15.1 Basic Usage

```xml
<h:dataTable id="caseTable"
             value="#{caseSearchBean.results}"
             var="caseRow">

    <h:column>
        <f:facet name="header">Reference No</f:facet>
        <h:outputText value="#{caseRow.referenceNo}" />
    </h:column>

    <h:column>
        <f:facet name="header">Status</f:facet>
        <h:outputText value="#{caseRow.statusLabel}" />
    </h:column>

    <h:column>
        <f:facet name="header">Action</f:facet>
        <h:link outcome="case-detail" value="Open">
            <f:param name="caseId" value="#{caseRow.id}" />
        </h:link>
    </h:column>

</h:dataTable>
```

`h:dataTable` adalah `UIData`. Ia melakukan repeated processing terhadap children untuk setiap row.

### 15.2 Row Variable Scope

`var="caseRow"` hanya tersedia saat rendering/processing row.

Jangan mengandalkan row object di luar table.

### 15.3 Why Data Table Can Be Expensive

Untuk 500 rows × 10 columns:

```text
500 × 10 = 5,000 cell render operations
plus EL evaluation
plus converter/formatter
plus permission checks
plus nested components
```

Kalau getter melakukan DB call, ini bisa menjadi disaster.

Buruk:

```xml
<h:outputText value="#{caseService.findAssigneeName(caseRow.id)}" />
```

Baik:

```xml
<h:outputText value="#{caseRow.assigneeName}" />
```

Siapkan data table row sebagai projection/view model.

### 15.4 Row Action Pattern

Untuk GET detail:

```xml
<h:link outcome="case-detail" value="Open">
    <f:param name="caseId" value="#{caseRow.id}" />
</h:link>
```

Untuk POST action mutasi:

```xml
<h:commandButton value="Assign"
                 action="#{caseSearchBean.assign(caseRow.id)}"
                 rendered="#{caseRow.assignable}" />
```

Tetap validasi server-side di action:

```java
public String assign(Long caseId) {
    caseCommandService.assign(caseId, currentUser.id());
    return null;
}
```

`rendered=#{caseRow.assignable}` hanya visibility, bukan authorization.

### 15.5 Pagination Strategy

`h:dataTable` standar tidak otomatis menyelesaikan problem pagination enterprise.

Untuk data besar:

1. Query server-side dengan limit/offset atau keyset pagination.
2. Jangan load semua rows ke memory.
3. Jangan simpan seluruh result list besar di view/session scope.
4. Gunakan row DTO ringan.
5. Pertimbangkan component library untuk advanced table, tetapi tetap pahami cost.

---

## 16. `f:facet`: Named Child Region

Facet adalah named child content.

Contoh header column:

```xml
<h:column>
    <f:facet name="header">
        <h:outputText value="Status" />
    </f:facet>
    <h:outputText value="#{row.statusLabel}" />
</h:column>
```

Facet dipakai untuk:

1. table header,
2. table footer,
3. composite component slots,
4. custom component extension,
5. layout regions.

Mental model:

```text
Normal children: repeated/ordered children
Facet: named child attached to parent component
```

---

## 17. Metadata Components: `f:metadata`, `f:viewParam`, `f:viewAction`

Metadata adalah bagian view yang diproses untuk parameter dan action awal, terutama pada GET/bookmarkable page.

### 17.1 `f:metadata`

Biasanya berada di top-level view:

```xml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.load}" />
</f:metadata>
```

### 17.2 `f:viewParam`

`f:viewParam` mengikat query parameter ke bean property dengan support conversion/validation.

URL:

```text
/case-detail.xhtml?caseId=123
```

View:

```xml
<f:viewParam name="caseId"
             value="#{caseDetailBean.caseId}"
             required="true"
             requiredMessage="Case id is required" />
```

Keuntungan dibanding manual request parameter:

1. ikut Faces lifecycle,
2. bisa conversion,
3. bisa validation,
4. bisa message rendering,
5. lebih deklaratif,
6. mendukung bookmarkable view.

### 17.3 Converter Untuk View Param

```xml
<f:viewParam name="caseId" value="#{caseDetailBean.caseId}" required="true">
    <f:convertNumber integerOnly="true" />
</f:viewParam>
```

Jika user membuka:

```text
/case-detail.xhtml?caseId=abc
```

conversion gagal dan message bisa ditampilkan.

### 17.4 `f:viewAction`

`f:viewAction` menjalankan action saat view diproses, sering pada initial GET.

```xml
<f:viewAction action="#{caseDetailBean.load}" />
```

Bean:

```java
public void load() {
    detail = caseQueryService.getDetail(caseId, currentUser.id());
}
```

### 17.5 View Action vs Constructor/PostConstruct

Jangan load berdasarkan view parameter di constructor.

Kenapa?

```text
Constructor terlalu awal.
View parameter belum tentu dikonversi/diupdate.
```

`@PostConstruct` juga sering terlalu awal untuk parameter yang diproses sebagai `f:viewParam`.

Gunakan `f:viewAction` untuk load berbasis view parameter.

### 17.6 Metadata Failure Handling

Use case:

1. missing parameter,
2. invalid format,
3. unauthorized access,
4. entity not found,
5. stale version.

Pattern:

```java
public String load() {
    try {
        detail = caseQueryService.getAuthorizedDetail(caseId, currentUser.id());
        return null;
    } catch (NotFoundException e) {
        return "/error/not-found?faces-redirect=true";
    } catch (AccessDeniedException e) {
        return "/error/forbidden?faces-redirect=true";
    }
}
```

---

## 18. Core Helper Tags Frequently Attached To Components

### 18.1 `f:param`

```xml
<h:link outcome="case-detail" value="Open">
    <f:param name="caseId" value="#{row.id}" />
</h:link>
```

### 18.2 `f:attribute`

Attach attribute ke component.

```xml
<h:commandButton value="Approve" action="#{bean.approve}">
    <f:attribute name="caseId" value="#{row.id}" />
</h:commandButton>
```

Dalam action listener, bisa membaca component attribute, tetapi untuk action method modern biasanya lebih jelas memakai method parameter bila didukung stack EL.

### 18.3 `f:ajax`

```xml
<h:inputText id="keyword" value="#{searchBean.keyword}">
    <f:ajax event="keyup" execute="@this" render="resultPanel" />
</h:inputText>
```

`f:ajax` akan dibahas lebih dalam di Part 22, tapi penting dipahami bahwa Ajax target memakai component client id/naming container rules.

### 18.4 `f:converter` / `f:convertNumber` / `f:convertDateTime`

```xml
<h:inputText id="date" value="#{form.dueDate}">
    <f:convertDateTime pattern="yyyy-MM-dd" />
</h:inputText>
```

### 18.5 `f:validator` / `f:validateLength` / `f:validateLongRange`

```xml
<h:inputText id="remarks" value="#{form.remarks}">
    <f:validateLength maximum="4000" />
</h:inputText>
```

---

## 19. `rendered`, `disabled`, `readonly`: Similar-Looking But Different

### 19.1 `rendered`

```xml
<h:commandButton value="Approve"
                 action="#{bean.approve}"
                 rendered="#{caseDetail.canApprove}" />
```

Jika `rendered=false`, component tidak dirender dan biasanya tidak ikut tree output.

Use case:

1. hide unavailable action,
2. conditional section,
3. role-based UI visibility,
4. workflow-state-driven view.

Security warning:

```text
rendered=false bukan authorization enforcement.
```

### 19.2 `disabled`

```xml
<h:inputText value="#{form.referenceNo}" disabled="true" />
```

HTML disabled input biasanya tidak submit value.

Jika value harus tetap dikirim, jangan mengandalkan disabled field. Gunakan readonly atau hidden identifier dengan server validation.

### 19.3 `readonly`

```xml
<h:inputText value="#{form.referenceNo}" readonly="true" />
```

Readonly field terlihat dan bisa terkirim, tetapi tetap dapat dimanipulasi dengan devtools. Server tetap harus validasi.

### 19.4 Decision Table

| Need | Use |
|---|---|
| Jangan tampilkan sama sekali | `rendered=false` |
| Tampilkan tapi tidak bisa diedit dan tidak perlu submit | `disabled=true` |
| Tampilkan sebagai field dan mungkin submit | `readonly=true` |
| Tampilkan data saja | `h:outputText` |
| Simpan identifier untuk action | hidden + server validation |

---

## 20. Pass-Through Attributes and HTML5

Faces component tidak selalu punya semua atribut HTML5 modern sebagai property first-class. Pass-through attribute memungkinkan atribut diteruskan ke markup.

Namespace:

```xml
xmlns:pt="jakarta.faces.passthrough"
```

Contoh:

```xml
<h:inputText id="email"
             value="#{userForm.email}"
             pt:type="email"
             pt:autocomplete="email"
             pt:placeholder="name@example.com" />
```

Use case:

1. `placeholder`,
2. `autocomplete`,
3. `aria-*`,
4. `data-*`,
5. `type=email/date/number`,
6. frontend hooks.

Rule:

```text
HTML5 client validation boleh membantu UX, tapi server-side Faces/domain validation tetap wajib.
```

---

## 21. Binding Attribute: Powerful But Usually Avoid

Faces component dapat di-bind ke bean property:

```xml
<h:inputText binding="#{bean.emailComponent}" value="#{bean.email}" />
```

Ini memberi akses langsung ke object component.

Risiko:

1. bean jadi tergantung UI component class,
2. state serialization lebih berat,
3. mudah memory leak,
4. coupling tinggi,
5. sulit dites,
6. multi-view/multi-tab risk.

Gunakan hanya untuk kasus advanced yang tidak bisa diselesaikan dengan value/action/ajax/rendered/validator.

---

## 22. Component Getter Discipline

Di Faces, getter bisa dipanggil berkali-kali saat render.

Buruk:

```java
public List<CaseRow> getResults() {
    return caseRepository.search(criteria); // DB call setiap getter dipanggil
}
```

Lebih baik:

```java
public void search() {
    this.results = caseQueryService.search(criteria);
}

public List<CaseRow> getResults() {
    return results;
}
```

Rule:

```text
Getter untuk view harus murah, deterministic, dan side-effect free.
```

Kalau getter melakukan:

1. DB call,
2. remote API call,
3. permission evaluation berat,
4. mutation,
5. logging berlebihan,
6. lazy initialization tidak terkendali,

maka render path bisa lambat dan sulit diprediksi.

---

## 23. Enterprise Form Pattern

Untuk form edit case:

```java
@Named
@ViewScoped
public class CaseEditBean implements Serializable {

    private Long caseId;
    private CaseEditForm form;

    @Inject CaseQueryService caseQueryService;
    @Inject CaseCommandService caseCommandService;

    public void load() {
        form = caseQueryService.getEditForm(caseId);
    }

    public String save() {
        caseCommandService.update(form);
        return "case-detail?faces-redirect=true&caseId=" + caseId;
    }

    // getters/setters
}
```

View:

```xml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseEditBean.caseId}" required="true" />
    <f:viewAction action="#{caseEditBean.load}" />
</f:metadata>

<h:form id="caseEditForm">
    <h:messages id="messages" />

    <h:outputLabel for="title" value="Title" />
    <h:inputText id="title" value="#{caseEditBean.form.title}" required="true" />
    <h:message for="title" />

    <h:outputLabel for="priority" value="Priority" />
    <h:selectOneMenu id="priority" value="#{caseEditBean.form.priorityCode}" required="true">
        <f:selectItems value="#{caseEditBean.form.priorityOptions}"
                       var="option"
                       itemValue="#{option.value}"
                       itemLabel="#{option.label}" />
    </h:selectOneMenu>
    <h:message for="priority" />

    <h:commandButton id="save" value="Save" action="#{caseEditBean.save}" />
    <h:button id="cancel" value="Cancel" outcome="case-detail">
        <f:param name="caseId" value="#{caseEditBean.caseId}" />
    </h:button>
</h:form>
```

Architecture principle:

```text
View binds to form model.
Bean orchestrates UI flow.
Service enforces business invariant.
Domain/persistence is not directly exposed to XHTML.
```

---

## 24. Component-Level Security Review

Review setiap component dengan pertanyaan ini:

### 24.1 Output

```text
Apakah value berasal dari user input?
Apakah output context HTML body, attribute, JS, URL, CSS?
Apakah escaping default cukup?
Apakah ada escape=false?
```

### 24.2 Input

```text
Apakah submitted value divalidasi server-side?
Apakah hidden/readonly/disabled dianggap trusted?
Apakah length limit ada di server?
Apakah conversion error ditangani?
```

### 24.3 Command

```text
Apakah action mutasi memakai POST?
Apakah authorization dicek di service?
Apakah CSRF/view state protection aktif?
Apakah double submit/idempotency dipikirkan?
```

### 24.4 Data Table

```text
Apakah row action validate ulang row id?
Apakah rendered flag hanya visibility?
Apakah query pagination server-side?
Apakah row data mengandung field sensitif?
```

### 24.5 Metadata

```text
Apakah view parameter divalidasi?
Apakah unauthorized/not found redirect aman?
Apakah load action idempotent?
```

---

## 25. Component-Level Performance Review

Checklist:

1. Getter tidak melakukan DB/remote call.
2. Data table tidak load ribuan row tanpa pagination.
3. Option list tidak dihitung ulang mahal.
4. Rendered expression tidak memanggil service berat per row.
5. Converter tidak melakukan query berulang tanpa cache/strategy.
6. Ajax render target tidak terlalu besar.
7. Form tidak terlalu luas untuk action kecil.
8. View state tidak membesar karena component tree dinamis besar.
9. Tidak menyimpan entity graph besar di view/session scope.
10. Tidak ada raw HTML besar yang dirender berulang.

---

## 26. Common Failure Modes and Diagnosis

### 26.1 Action Tidak Terpanggil

Kemungkinan:

1. command di luar `h:form`,
2. validation gagal sebelum invoke application,
3. component tidak dirender saat postback,
4. wrong form submitted,
5. nested form invalid,
6. Ajax execute tidak mencakup command/input yang diperlukan,
7. exception tertelan di lifecycle/log.

Diagnosis:

```text
Cek h:messages.
Cek apakah form ada.
Cek network request parameter.
Cek lifecycle log.
Cek rendered condition.
Cek validation/conversion error.
```

### 26.2 Value Tidak Update Ke Bean

Kemungkinan:

1. conversion gagal,
2. validation gagal,
3. setter tidak ada/salah,
4. value expression salah,
5. input disabled,
6. bean scope recreated,
7. Ajax execute tidak mencakup input,
8. form lain yang submit.

### 26.3 Message Tidak Muncul

Kemungkinan:

1. `h:message for` salah id,
2. message component tidak ikut render Ajax,
3. globalOnly mismatch,
4. component ada di naming container berbeda,
5. redirect tanpa flash message.

### 26.4 Ajax Target Tidak Update

Kemungkinan:

1. target id salah,
2. naming container tidak dipahami,
3. component target tidak rendered pada request itu,
4. render target di luar form/naming container dengan referensi relatif salah,
5. exception menghasilkan partial response error.

### 26.5 Duplicate Component ID

Kemungkinan:

1. include berulang dengan id sama dalam naming container sama,
2. dynamic component dibuat manual tanpa unique id,
3. composite component misuse,
4. JSTL conditional/loop membangun tree yang tidak stabil.

---

## 27. Component Choice Decision Matrix

| Kebutuhan | Komponen yang umum dipilih |
|---|---|
| Tampilkan teks aman | `h:outputText` |
| Label form accessible | `h:outputLabel` |
| Input text pendek | `h:inputText` |
| Input text panjang | `h:inputTextarea` |
| Password/secret | `h:inputSecret` |
| Hidden identifier | `h:inputHidden` + server validation |
| Dropdown single choice | `h:selectOneMenu` |
| Radio small option set | `h:selectOneRadio` |
| Checkbox boolean | `h:selectBooleanCheckbox` |
| Multi choice | `h:selectManyCheckbox` / listbox |
| Mutating action | `h:commandButton` |
| Bookmarkable navigation | `h:link` |
| Navigate as button | `h:button` |
| External/raw link | `h:outputLink` |
| Table sederhana | `h:dataTable` |
| Field-level error | `h:message` |
| Page/global errors | `h:messages` |
| Query parameter binding | `f:viewParam` |
| Initial GET load | `f:viewAction` |
| Header/footer/slot | `f:facet` |

---

## 28. Java 8 Sampai Java 25: Apa Dampaknya Untuk Components?

Komponen Faces sendiri adalah API framework, tetapi runtime Java memengaruhi design:

### 28.1 Java 8 Legacy

Ciri umum:

1. Banyak aplikasi masih `javax.faces.*`.
2. JSF 2.x.
3. ManagedBean legacy masih sering ditemukan.
4. CDI integration kadang belum konsisten.
5. Record belum ada, sehingga DTO/form model biasanya class biasa.

### 28.2 Java 11/17 Migration

Dampak:

1. dependency harus eksplisit,
2. illegal reflective access library lama bisa bermasalah,
3. container versi lama mungkin tidak cocok,
4. testing stack perlu diperbarui.

### 28.3 Java 21/25 Modern Runtime

Peluang:

1. record untuk immutable row/view projection,
2. pattern matching di service/query layer,
3. virtual thread di backend service path bila container mendukung dengan benar,
4. runtime observability lebih matang,
5. GC dan memory profiling lebih baik.

Tetapi:

```text
Virtual thread tidak mengubah component lifecycle Faces.
Ia bisa membantu blocking backend work, tetapi tidak membuat view state/session bloat hilang.
```

---

## 29. `javax.*` ke `jakarta.*` Impact Untuk Components

Legacy:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="http://xmlns.jcp.org/jsf/html"
      xmlns:f="http://xmlns.jcp.org/jsf/core">
```

Modern Jakarta Faces:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets">
```

Java imports juga berubah:

```java
// legacy
import javax.faces.application.FacesMessage;
import javax.faces.context.FacesContext;

// modern
import jakarta.faces.application.FacesMessage;
import jakarta.faces.context.FacesContext;
```

Migration checklist:

1. Update dependency Faces API/implementation.
2. Update server/container.
3. Update Facelets namespace.
4. Update Java imports.
5. Update custom converters/validators/components.
6. Update third-party component libraries.
7. Run view build/compile smoke test.
8. Run lifecycle/form regression tests.

---

## 30. Mini Case: Regulatory Case Detail Page

Requirements:

1. URL `/case-detail.xhtml?caseId=123`.
2. Load authorized detail.
3. Show case info.
4. Show action buttons based on workflow state.
5. Allow officer remarks.
6. Approve/reject action.
7. Show messages.
8. Avoid trusting hidden fields.

View skeleton:

```xml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.load}" />
</f:metadata>

<h:form id="caseDetailForm">
    <h:messages id="messages" />

    <h2>
        <h:outputText value="#{caseDetailBean.detail.referenceNo}" />
    </h2>

    <p>
        <strong>Status:</strong>
        <h:outputText value="#{caseDetailBean.detail.statusLabel}" />
    </p>

    <h:dataTable id="documentTable" value="#{caseDetailBean.detail.documents}" var="doc">
        <h:column>
            <f:facet name="header">Document</f:facet>
            <h:outputText value="#{doc.fileName}" />
        </h:column>
        <h:column>
            <f:facet name="header">Action</f:facet>
            <h:link outcome="document-download" value="Download">
                <f:param name="documentId" value="#{doc.id}" />
            </h:link>
        </h:column>
    </h:dataTable>

    <h:panelGroup id="actionPanel" rendered="#{caseDetailBean.detail.actionable}">
        <h:outputLabel for="remarks" value="Remarks" />
        <h:inputTextarea id="remarks"
                         value="#{caseDetailBean.actionForm.remarks}"
                         required="true"
                         rows="5"
                         cols="80" />
        <h:message for="remarks" />

        <h:commandButton id="approve"
                         value="Approve"
                         action="#{caseDetailBean.approve}"
                         rendered="#{caseDetailBean.detail.canApprove}" />

        <h:commandButton id="reject"
                         value="Reject"
                         action="#{caseDetailBean.reject}"
                         rendered="#{caseDetailBean.detail.canReject}" />
    </h:panelGroup>
</h:form>
```

Critical review:

```text
caseId from URL is not trusted.
documentId from link is not trusted.
canApprove/canReject only controls visibility.
approve/reject service must re-check authorization and workflow transition.
remarks must be length-validated and escaped on output.
detail.documents should be DTO/projection, not entity graph.
```

---

## 31. Top 1% Engineering Heuristics For Faces Components

1. Treat components as lifecycle participants, not HTML aliases.
2. Always know whether a component is input, output, command, data, message, or metadata.
3. Keep getters cheap and side-effect free.
4. Prefer explicit `id` for anything interacted with, tested, or Ajax-updated.
5. Let form boundary follow submit use case.
6. Use GET links for navigation and POST commands for mutation.
7. Use `f:viewParam` + `f:viewAction` for bookmarkable detail pages.
8. Never trust hidden/readonly/disabled values.
9. Never confuse `rendered` with authorization.
10. Use view model/projection objects for tables.
11. Avoid entity graphs in view scope/session scope.
12. Treat data table rendering as a loop with cost.
13. Keep option lists stable and cheap during postback.
14. Put field messages close to fields and global messages near page top.
15. Avoid component binding unless you truly need it.
16. Know naming containers before debugging Ajax.
17. Use pass-through attributes for HTML5/ARIA, but keep server validation.
18. Review every `escape=false` as a security exception.
19. Build regression tests around generated HTML and lifecycle outcomes.
20. Design for migration: modern namespaces, CDI beans, explicit dependencies.

---

## 32. Summary

Faces components are not merely tags that render HTML. They are server-side objects with identity, state, lifecycle behavior, validation/conversion semantics, event behavior, and renderer output.

The practical mental model:

```text
Output component
  → display safely

Input component
  → decode request, convert, validate, update model

Command component
  → submit form, trigger action, navigate

Data component
  → repeat component processing per row

Message component
  → expose lifecycle feedback

Metadata component
  → bind URL/query parameter and initial view action
```

If you understand component category, id/naming container, form boundary, state, and lifecycle phase, most Faces bugs become diagnosable instead of mysterious.

---

## 33. References

- Jakarta Faces 4.1 Specification, Final Release.
- Jakarta Faces VDL Documentation.
- Jakarta EE Tutorial: Using Jakarta Faces Technology in Web Pages.
- Jakarta Faces project description: MVC framework for web UI components, state management, event handling, validation, navigation, internationalization, and accessibility.

---

## 34. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
19-conversion-and-validation-in-faces-ui-level-integrity.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Faces Lifecycle Deep Dive: Phase-by-Phase Execution and Failure Modeling](./17-faces-lifecycle-deep-dive-phase-by-phase-failure-modeling.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — Conversion and Validation in Faces: UI-Level Integrity](./19-conversion-and-validation-in-faces-ui-level-integrity.md)
