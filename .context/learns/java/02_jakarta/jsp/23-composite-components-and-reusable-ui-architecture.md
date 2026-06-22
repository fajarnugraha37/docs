# Part 23 — Composite Components and Reusable UI Architecture

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `23-composite-components-and-reusable-ui-architecture.md`  
> Area: Jakarta Faces / JSF, Facelets, Composite Components, reusable UI primitives  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya bisa membuat composite component sederhana, tetapi mampu mendesain **UI component library internal** yang:

1. punya kontrak yang jelas,
2. aman terhadap XSS dan authorization leakage,
3. tidak memperbesar state secara tidak perlu,
4. bisa digunakan ulang lintas halaman,
5. bisa dites,
6. bisa dimigrasikan dari Java EE/JSF lama ke Jakarta Faces modern,
7. tidak berubah menjadi abstraction trap yang lebih sulit dirawat daripada markup biasa.

Composite component adalah salah satu fitur Faces yang sering diremehkan. Banyak engineer hanya melihatnya sebagai “cara membuat tag sendiri dengan XHTML”. Itu benar, tapi terlalu dangkal.

Mental model yang lebih tepat:

> Composite component adalah cara mengubah kumpulan markup + Faces components + kontrak atribut menjadi **komponen deklaratif** yang ikut masuk ke component tree Faces, ikut lifecycle, ikut state management, ikut validation, ikut Ajax partial rendering, dan ikut resource handling.

Dengan kata lain, composite component bukan sekadar include. Ia lebih dekat ke “server-side reusable component primitive”.

---

## 1. Posisi Composite Component dalam Faces

Sebelum masuk detail, bedakan beberapa mekanisme reuse di Faces:

| Mekanisme | Level | Cocok untuk | Tidak cocok untuk |
|---|---:|---|---|
| `ui:include` | template include | potongan halaman sederhana | reusable component dengan kontrak kuat |
| `ui:composition` + template | page layout | layout global seperti header/sidebar/content | field component kecil |
| Tag file/Facelets tag | tag-level composition | reusable markup ringan | komponen yang butuh contract component behavior |
| Composite component | component-level abstraction | field, panel, search box, action bar, reusable form controls | logic bisnis kompleks |
| Custom Java component + renderer | low-level component framework | komponen sangat custom/performance-critical | kebutuhan reuse biasa |

Composite component berada di tengah: lebih kuat daripada include/tag biasa, tetapi lebih murah daripada menulis custom `UIComponent` + renderer Java.

---

## 2. Mental Model: Composite Component sebagai Contracted Component

Composite component biasanya terdiri dari dua bagian utama:

```xml
<composite:interface>
    <!-- kontrak publik komponen -->
</composite:interface>

<composite:implementation>
    <!-- implementasi internal komponen -->
</composite:implementation>
```

Secara konseptual:

```text
Using page
  |
  | uses <app:field label="Name" value="#{bean.name}" />
  v
Composite component contract
  |
  | validates attributes, exposes facets/actions/value holder behavior
  v
Composite implementation
  |
  | builds child Faces components
  v
Faces component tree
  |
  | participates in lifecycle, conversion, validation, model update, rendering
  v
HTML response
```

Perbedaan besar dengan include:

```text
ui:include:
  “masukkan file ini ke view”

composite component:
  “buat reusable component dengan public contract”
```

Ini penting. Kalau kamu memakai composite component hanya sebagai include, kamu akan mendapatkan kompleksitas component lifecycle tanpa manfaat kontrak yang jelas.

---

## 3. Struktur Folder Resource Library

Composite component harus berada di dalam **resource library** Faces.

Struktur umum:

```text
src/main/webapp/
  resources/
    app/
      inputText.xhtml
      actionButton.xhtml
      searchPanel.xhtml
      caseStatusBadge.xhtml
```

Lalu dipakai di halaman:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets"
      xmlns:app="jakarta.faces.composite/app">

<h:body>
    <app:inputText label="Applicant Name"
                   value="#{caseForm.applicantName}"
                   required="true" />
</h:body>
</html>
```

Namespace-nya mengikuti nama folder library:

```text
/resources/app/inputText.xhtml
             ^^^
             library name

xmlns:app="jakarta.faces.composite/app"
```

Pada era lama JSF/Java EE, namespace yang sering ditemui adalah:

```xml
xmlns:h="http://java.sun.com/jsf/html"
xmlns:f="http://java.sun.com/jsf/core"
xmlns:ui="http://java.sun.com/jsf/facelets"
xmlns:composite="http://java.sun.com/jsf/composite"
xmlns:app="http://java.sun.com/jsf/composite/app"
```

Pada Jakarta Faces modern, style namespace yang umum adalah:

```xml
xmlns:h="jakarta.faces.html"
xmlns:f="jakarta.faces.core"
xmlns:ui="jakarta.faces.facelets"
xmlns:cc="jakarta.faces.composite"
xmlns:app="jakarta.faces.composite/app"
```

Dalam migration, jangan hanya mengganti import Java. Namespace XHTML juga harus diaudit.

---

## 4. Composite Component Minimal

File:

```text
src/main/webapp/resources/app/statusBadge.xhtml
```

Isi:

```xml
<ui:component
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:h="jakarta.faces.html"
    xmlns:ui="jakarta.faces.facelets"
    xmlns:cc="jakarta.faces.composite">

    <cc:interface>
        <cc:attribute name="value" required="true" />
    </cc:interface>

    <cc:implementation>
        <span class="status-badge">
            <h:outputText value="#{cc.attrs.value}" />
        </span>
    </cc:implementation>

</ui:component>
```

Pemakaian:

```xml
<app:statusBadge value="#{caseView.statusLabel}" />
```

Hal penting:

```xml
#{cc.attrs.value}
```

`cc` adalah implicit object yang menunjuk ke current composite component. `cc.attrs` adalah map atribut yang diberikan oleh using page.

Mental model:

```text
using page attribute
  value="#{caseView.statusLabel}"
       |
       v
cc.attrs.value
       |
       v
internal implementation renders outputText
```

---

## 5. `cc:interface`: Public Contract

`cc:interface` mendefinisikan kontrak publik composite component.

Contoh:

```xml
<cc:interface>
    <cc:attribute name="label" required="true" type="java.lang.String" />
    <cc:attribute name="value" required="true" />
    <cc:attribute name="required" type="java.lang.Boolean" default="false" />
    <cc:attribute name="disabled" type="java.lang.Boolean" default="false" />
    <cc:attribute name="maxLength" type="java.lang.Integer" />
</cc:interface>
```

Kontrak ini menjawab:

1. atribut apa yang boleh diberikan,
2. mana yang wajib,
3. tipe apa yang diharapkan,
4. default behavior-nya apa,
5. mana yang bagian API publik dan mana yang detail internal.

Rule penting:

> Composite component yang baik harus terasa seperti public API, bukan seperti snippet markup yang kebetulan reusable.

Kalau atributnya terlalu banyak, kemungkinan ada dua masalah:

1. component terlalu generik,
2. atau component sedang mencoba menggantikan design system lengkap dengan satu file XHTML.

---

## 6. Attribute Design: Jangan Membuat “God Component”

Misalnya kamu ingin membuat reusable field:

```xml
<app:inputText label="Email"
               value="#{userForm.email}"
               required="true"
               maxlength="255"
               helpText="Use your official email" />
```

Ini masih wajar.

Tapi jika menjadi:

```xml
<app:inputText label="Email"
               value="#{userForm.email}"
               required="true"
               maxlength="255"
               mode="advanced"
               showAudit="true"
               queryPermission="true"
               useLegacySpacing="false"
               adminOnly="true"
               renderAsPanel="true"
               useSpecialCaseForAppeal="true"
               useDifferentErrorPosition="true" />
```

Ini mulai menjadi red flag.

Composite component harus punya **semantic center**.

Contoh semantic center yang baik:

| Component | Semantic center |
|---|---|
| `app:formField` | layout konsisten untuk label/input/message/help text |
| `app:statusBadge` | menampilkan status domain dalam style konsisten |
| `app:actionBar` | kumpulan tombol aksi halaman |
| `app:caseLink` | link ke case detail dengan format aman |
| `app:moneyOutput` | output angka uang dengan format/locale konsisten |
| `app:dateOutput` | output tanggal dengan timezone/locale konsisten |

Semantic center yang buruk:

| Component | Masalah |
|---|---|
| `app:everythingPanel` | terlalu luas |
| `app:smartField` | biasanya terlalu banyak magic |
| `app:casePage` | terlalu besar, sulit reuse |
| `app:conditionalThing` | tidak jelas domain-nya |

---

## 7. Input Component Composite: Pola Field Wrapper

Salah satu use case paling umum adalah membuat form field standar.

File:

```text
/resources/app/inputText.xhtml
```

```xml
<ui:component
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:h="jakarta.faces.html"
    xmlns:f="jakarta.faces.core"
    xmlns:ui="jakarta.faces.facelets"
    xmlns:cc="jakarta.faces.composite">

    <cc:interface>
        <cc:attribute name="label" required="true" type="java.lang.String" />
        <cc:attribute name="value" required="true" />
        <cc:attribute name="required" type="java.lang.Boolean" default="false" />
        <cc:attribute name="disabled" type="java.lang.Boolean" default="false" />
        <cc:attribute name="maxlength" type="java.lang.Integer" />
        <cc:attribute name="helpText" type="java.lang.String" />
    </cc:interface>

    <cc:implementation>
        <div class="form-field">
            <h:outputLabel for="input" value="#{cc.attrs.label}" styleClass="form-label" />

            <h:inputText id="input"
                         value="#{cc.attrs.value}"
                         required="#{cc.attrs.required}"
                         disabled="#{cc.attrs.disabled}"
                         maxlength="#{cc.attrs.maxlength}"
                         styleClass="form-control" />

            <h:panelGroup rendered="#{not empty cc.attrs.helpText}" styleClass="form-help">
                <h:outputText value="#{cc.attrs.helpText}" />
            </h:panelGroup>

            <h:message for="input" styleClass="form-error" />
        </div>
    </cc:implementation>
</ui:component>
```

Pemakaian:

```xml
<app:inputText label="Officer Name"
               value="#{assignmentForm.officerName}"
               required="true"
               maxlength="100"
               helpText="Use the officer's full name." />
```

Manfaat:

1. label konsisten,
2. error message konsisten,
3. help text konsisten,
4. input id internal stabil,
5. halaman tidak penuh boilerplate.

Tapi ada konsekuensi:

1. id client menjadi nested,
2. Ajax render target harus memperhatikan naming container,
3. validation message ada di dalam component,
4. styling harus stabil,
5. component ikut lifecycle.

---

## 8. Composite Component sebagai Naming Container

Composite component adalah naming container. Artinya component id di dalamnya akan masuk ke client id yang lebih panjang.

Misalnya:

```xml
<h:form id="caseForm">
    <app:inputText id="subjectField"
                   label="Subject"
                   value="#{caseForm.subject}" />
</h:form>
```

Di dalam composite:

```xml
<h:inputText id="input" value="#{cc.attrs.value}" />
```

Client id bisa menjadi:

```text
caseForm:subjectField:input
```

Ini penting untuk:

1. `h:message for="..."`,
2. `f:ajax render="..."`,
3. JavaScript selector,
4. CSS targeting,
5. Selenium/Playwright test selector.

Rule praktis:

> Jangan desain composite component yang mengharuskan caller mengetahui terlalu banyak id internal.

Jika caller harus render bagian dalam component, pertimbangkan expose target wrapper:

```xml
<cc:implementation>
    <h:panelGroup id="root" layout="block" styleClass="form-field">
        ...
    </h:panelGroup>
</cc:implementation>
```

Lalu caller cukup render component root, bukan internal input.

---

## 9. `cc:editableValueHolder`: Membuat Composite Terlihat seperti Input

Jika composite membungkus `h:inputText`, kadang kamu ingin validator/converter dari caller bisa ditempelkan ke composite.

Contoh penggunaan yang diinginkan:

```xml
<app:inputText label="Amount" value="#{paymentForm.amount}">
    <f:convertNumber minFractionDigits="2" />
    <f:validateDoubleRange minimum="0" />
</app:inputText>
```

Agar bisa begitu, composite harus expose inner input sebagai editable value holder.

Contoh:

```xml
<cc:interface>
    <cc:attribute name="label" required="true" />
    <cc:attribute name="value" required="true" />
    <cc:editableValueHolder name="input" targets="input" />
</cc:interface>

<cc:implementation>
    <h:outputLabel for="input" value="#{cc.attrs.label}" />
    <h:inputText id="input" value="#{cc.attrs.value}" />
    <h:message for="input" />
</cc:implementation>
```

Mental model:

```text
Caller attaches converter/validator
       |
       v
Composite contract maps it to inner input target
       |
       v
Inner h:inputText participates in conversion/validation
```

Tanpa ini, composite terlihat reusable secara markup, tetapi tidak cukup transparan sebagai input component.

---

## 10. `cc:valueHolder`, `cc:actionSource`, dan `cc:clientBehavior`

Selain editable value holder, composite component dapat mengekspos behavior component internal lain.

### 10.1 Value holder

Untuk output/value component yang bukan editable:

```xml
<cc:valueHolder name="value" targets="output" />
```

### 10.2 Action source

Jika composite membungkus command button/link:

```xml
<cc:actionSource name="button" targets="submit" />
```

### 10.3 Client behavior

Jika composite harus menerima Ajax behavior:

```xml
<cc:clientBehavior name="change" event="change" targets="input" default="true" />
```

Lalu pemakaian:

```xml
<app:inputText label="Postal Code" value="#{addressForm.postalCode}">
    <f:ajax event="change"
            listener="#{addressForm.lookupAddress}"
            execute="@this"
            render="addressPanel" />
</app:inputText>
```

Design insight:

> Semakin component ingin terasa seperti native Faces component, semakin penting interface contract seperti `editableValueHolder`, `actionSource`, dan `clientBehavior`.

---

## 11. Method Expressions sebagai Attribute

Composite component bisa menerima method expression.

Contoh action button:

```xml
<cc:interface>
    <cc:attribute name="label" required="true" type="java.lang.String" />
    <cc:attribute name="action" method-signature="java.lang.String action()" />
    <cc:attribute name="disabled" type="java.lang.Boolean" default="false" />
</cc:interface>

<cc:implementation>
    <h:commandButton value="#{cc.attrs.label}"
                     action="#{cc.attrs.action}"
                     disabled="#{cc.attrs.disabled}"
                     styleClass="btn btn-primary" />
</cc:implementation>
```

Pemakaian:

```xml
<app:primaryButton label="Submit"
                   action="#{caseActionBean.submit}" />
```

Method expression perlu diperlakukan seperti API:

1. signature harus jelas,
2. return type harus dipahami,
3. parameter jangan dibuat terlalu fleksibel,
4. side effect tetap milik backing bean/service, bukan composite component.

Contoh method dengan parameter:

```xml
<cc:attribute name="listener"
              method-signature="void listener(java.lang.String)" />
```

Pemakaian:

```xml
<app:caseAction actionCode="APPROVE"
                listener="#{caseBean.performAction}" />
```

Implementation:

```xml
<h:commandButton value="Approve"
                 action="#{cc.attrs.listener(cc.attrs.actionCode)}" />
```

Hati-hati: terlalu banyak dynamic method invocation membuat view sulit dianalisis.

---

## 12. Facets: Slot Bernama

Facet adalah slot bernama yang bisa diisi caller.

Contoh component panel:

```xml
<cc:interface>
    <cc:attribute name="title" required="true" />
    <cc:facet name="actions" />
</cc:interface>

<cc:implementation>
    <section class="panel">
        <header class="panel-header">
            <h2><h:outputText value="#{cc.attrs.title}" /></h2>

            <div class="panel-actions">
                <cc:renderFacet name="actions" />
            </div>
        </header>

        <div class="panel-body">
            <cc:insertChildren />
        </div>
    </section>
</cc:implementation>
```

Pemakaian:

```xml
<app:panel title="Case Details">
    <f:facet name="actions">
        <h:commandButton value="Edit" action="#{caseBean.edit}" />
    </f:facet>

    <h:outputText value="#{caseView.summary}" />
</app:panel>
```

Mental model:

```text
attribute = scalar/property contract
facet     = named child region
children  = default unnamed body region
```

---

## 13. `cc:insertChildren`: Default Body Slot

`cc:insertChildren` memasukkan child components/template text dari using page ke lokasi tertentu di implementation.

Composite:

```xml
<cc:implementation>
    <div class="card">
        <div class="card-body">
            <cc:insertChildren />
        </div>
    </div>
</cc:implementation>
```

Pemakaian:

```xml
<app:card>
    <h:outputText value="Hello" />
</app:card>
```

Ini berguna untuk layout component kecil seperti:

1. card,
2. panel,
3. modal shell,
4. grid section,
5. alert box.

Tapi untuk form field, terlalu bebas sering buruk. Form field biasanya butuh kontrak lebih ketat daripada arbitrary children.

---

## 14. Composite Component vs Facelets Template

Perbandingan:

```xml
<ui:composition template="/WEB-INF/templates/main.xhtml">
    <ui:define name="content">
        ...
    </ui:define>
</ui:composition>
```

vs

```xml
<app:panel title="Case Details">
    ...
</app:panel>
```

Template cocok untuk page skeleton:

```text
html
  head
  body
    header
    nav
    content
    footer
```

Composite cocok untuk reusable component unit:

```text
field
button
badge
panel
search form
wizard step
case action item
```

Rule:

> Template mengatur halaman. Composite component mengatur komponen di dalam halaman.

---

## 15. Composite Component vs Custom Java Component

Composite component bagus ketika implementation bisa disusun dari komponen Faces/HTML yang sudah ada.

Custom Java component lebih tepat ketika:

1. rendering sangat custom,
2. perlu encode/decode request parameter sendiri,
3. perlu optimize performance ekstrem,
4. perlu library component publik yang stabil lintas aplikasi,
5. perlu client behavior kompleks,
6. composite menjadi terlalu lambat atau terlalu rumit.

Composite component:

```text
lebih cepat dibuat
lebih mudah dibaca oleh developer web
lebih cocok untuk internal design system
```

Custom component:

```text
lebih powerful
lebih verbose
lebih sulit dites
lebih mahal dipelihara
```

Jangan lompat ke custom Java component kalau composite component cukup.

---

## 16. Contoh Enterprise: `caseStatusBadge`

Domain: regulatory case management.

Kebutuhan:

1. status case harus ditampilkan konsisten,
2. label user-friendly,
3. CSS class harus terkontrol,
4. raw status code tidak boleh bocor sembarangan,
5. optional tooltip,
6. tidak boleh ada business logic berat di view.

Buruk:

```xml
<span class="#{case.status == 'APPROVED' ? 'green' : 'red'}">
    #{case.status}
</span>
```

Lebih baik: controller/backing bean menyiapkan view model.

```java
public record CaseStatusView(
    String code,
    String label,
    String severity,
    String tooltip
) {}
```

Composite:

```xml
<ui:component
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:h="jakarta.faces.html"
    xmlns:ui="jakarta.faces.facelets"
    xmlns:cc="jakarta.faces.composite">

    <cc:interface>
        <cc:attribute name="status" required="true" />
    </cc:interface>

    <cc:implementation>
        <span class="status-badge status-badge--#{cc.attrs.status.severity}"
              title="#{cc.attrs.status.tooltip}">
            <h:outputText value="#{cc.attrs.status.label}" />
        </span>
    </cc:implementation>
</ui:component>
```

Pemakaian:

```xml
<app:caseStatusBadge status="#{caseDetail.statusView}" />
```

Catatan security:

1. `label` dirender via `h:outputText`, escaped.
2. `severity` masuk attribute/class; harus berasal dari whitelist server-side, bukan user input bebas.
3. `tooltip` masuk HTML attribute; idealnya juga sanitized/whitelisted atau di-render dengan component yang aman.

---

## 17. Contoh Enterprise: `permissionedActionButton`

Kebutuhan:

1. tombol action hanya terlihat jika user punya permission,
2. label/action/style konsisten,
3. ada confirm message optional,
4. tetapi authorization tetap harus enforced di service layer.

Composite:

```xml
<cc:interface>
    <cc:attribute name="label" required="true" />
    <cc:attribute name="allowed" required="true" type="java.lang.Boolean" />
    <cc:attribute name="action" method-signature="java.lang.String action()" />
    <cc:attribute name="styleClass" default="btn btn-primary" />
</cc:interface>

<cc:implementation>
    <h:commandButton value="#{cc.attrs.label}"
                     action="#{cc.attrs.action}"
                     rendered="#{cc.attrs.allowed}"
                     styleClass="#{cc.attrs.styleClass}" />
</cc:implementation>
```

Pemakaian:

```xml
<app:permissionedActionButton label="Approve"
                              allowed="#{casePermission.canApprove}"
                              action="#{caseAction.approve}" />
```

Service tetap wajib enforce:

```java
public String approve() {
    caseCommandService.approve(caseId, currentUser);
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

Di service:

```java
if (!policy.canApprove(currentUser, caseEntity)) {
    throw new ForbiddenOperationException("User cannot approve this case");
}
```

Rule:

> `rendered="false"` menyembunyikan tombol. Itu bukan authorization.

---

## 18. Contoh Enterprise: Reusable Search Panel

Search panel umum punya:

1. keyword,
2. status,
3. date range,
4. search action,
5. reset action,
6. optional advanced slot.

Composite:

```xml
<cc:interface>
    <cc:attribute name="criteria" required="true" />
    <cc:attribute name="searchAction" method-signature="java.lang.String action()" required="true" />
    <cc:attribute name="resetAction" method-signature="java.lang.String action()" />
    <cc:facet name="advanced" />
</cc:interface>

<cc:implementation>
    <h:panelGroup id="searchPanel" layout="block" styleClass="search-panel">
        <div class="search-row">
            <h:outputLabel for="keyword" value="Keyword" />
            <h:inputText id="keyword" value="#{cc.attrs.criteria.keyword}" />
        </div>

        <div class="search-row">
            <h:outputLabel for="status" value="Status" />
            <h:selectOneMenu id="status" value="#{cc.attrs.criteria.status}">
                <f:selectItem itemLabel="All" itemValue="" />
                <f:selectItems value="#{cc.attrs.criteria.statusOptions}" />
            </h:selectOneMenu>
        </div>

        <div class="search-advanced">
            <cc:renderFacet name="advanced" />
        </div>

        <div class="search-actions">
            <h:commandButton value="Search" action="#{cc.attrs.searchAction}" />
            <h:commandButton value="Reset" action="#{cc.attrs.resetAction}" immediate="true" />
        </div>
    </h:panelGroup>
</cc:implementation>
```

Pemakaian:

```xml
<app:caseSearchPanel criteria="#{caseSearch.criteria}"
                     searchAction="#{caseSearch.search}"
                     resetAction="#{caseSearch.reset}">
    <f:facet name="advanced">
        <h:outputLabel for="agency" value="Agency" />
        <h:selectOneMenu id="agency" value="#{caseSearch.criteria.agencyId}">
            <f:selectItems value="#{caseSearch.agencyOptions}" />
        </h:selectOneMenu>
    </f:facet>
</app:caseSearchPanel>
```

Review:

1. Reusable, tapi tidak terlalu generic.
2. Criteria tetap milik backing bean.
3. Search/reset method tetap milik backing bean.
4. Advanced slot memberi extension point.
5. Tidak ada query logic di component.

---

## 19. Resource Handling: CSS, JS, Images

Composite component sering butuh CSS/JS.

Faces resource structure:

```text
resources/
  app/
    inputText.xhtml
  css/
    app-components.css
  js/
    app-components.js
```

Di page template:

```xml
<h:outputStylesheet library="css" name="app-components.css" />
<h:outputScript library="js" name="app-components.js" target="body" />
```

Atau di composite:

```xml
<cc:implementation>
    <h:outputStylesheet library="css" name="app-components.css" />
    ...
</cc:implementation>
```

Namun hati-hati: jika component muncul banyak kali, resource declaration bisa berulang secara markup walaupun Faces resource handling biasanya mencegah duplicate resource rendering.

Design rule:

> Untuk design system besar, lebih baik resource utama dideklarasikan di template global. Composite component sebaiknya tidak diam-diam memasukkan dependency berat kecuali benar-benar component-specific.

---

## 20. Versioning Internal Component Library

Jika component library dipakai banyak modul, treat seperti API.

Contoh struktur:

```text
resources/
  app/
    inputText.xhtml
    panel.xhtml
    statusBadge.xhtml
```

Masalah: mengubah `inputText.xhtml` bisa memengaruhi ratusan halaman.

Strategi versioning:

### 20.1 Backward-compatible change

Aman:

1. menambah optional attribute dengan default,
2. memperbaiki escaping,
3. menambah CSS class non-breaking,
4. memperbaiki markup tanpa mengubah id publik.

### 20.2 Breaking change

Berbahaya:

1. mengganti nama attribute,
2. mengubah default `required`,
3. mengganti internal id yang dipakai Ajax/test,
4. mengubah behavior `immediate`,
5. mengubah location message,
6. menghapus facet.

### 20.3 Versioned component

Kadang perlu:

```text
resources/
  app/
    inputText.xhtml
  appv2/
    inputText.xhtml
```

Namespace:

```xml
xmlns:app="jakarta.faces.composite/app"
xmlns:appv2="jakarta.faces.composite/appv2"
```

Tapi jangan terlalu cepat versioning. Banyak versioned UI component akan memperbanyak cognitive load.

---

## 21. Naming Conventions

Gunakan nama yang menyatakan semantic role, bukan implementation.

Lebih baik:

```text
app:formField
app:caseStatusBadge
app:actionBar
app:moneyOutput
app:dateOutput
app:errorSummary
app:documentUpload
app:caseLink
```

Kurang baik:

```text
app:bluePanel
app:divBox
app:inputText2
app:newField
app:commonComponent
```

Atribut juga harus semantic:

Lebih baik:

```xml
label="..."
value="..."
required="..."
helpText="..."
allowed="..."
status="..."
```

Kurang baik:

```xml
text1="..."
flag="..."
mode="..."
data="..."
type="special"
```

---

## 22. Security Design in Composite Components

Composite component sering menjadi pusat rendering reusable. Ini membuatnya sangat powerful untuk security hardening.

### 22.1 Default escape output

Gunakan:

```xml
<h:outputText value="#{cc.attrs.label}" />
```

Hindari default raw HTML:

```xml
<h:outputText value="#{cc.attrs.html}" escape="false" />
```

Jika butuh raw HTML, buat component sangat eksplisit:

```xml
<app:trustedHtml value="#{cms.safeHtml}" />
```

Dan pastikan sumbernya sudah sanitized.

### 22.2 Attribute context berbeda

Ini raw HTML attribute:

```xml
<span title="#{cc.attrs.tooltip}">
```

Walaupun Faces/Facelets akan membantu escape XML/HTML, tetap jangan memasukkan data user bebas ke class/style/event handler.

Buruk:

```xml
<span class="#{cc.attrs.userControlledClass}">
```

Lebih aman:

```java
public String severityClass() {
    return switch (severity) {
        case LOW -> "low";
        case MEDIUM -> "medium";
        case HIGH -> "high";
    };
}
```

### 22.3 Authorization rendering

Composite boleh menyembunyikan action:

```xml
rendered="#{cc.attrs.allowed}"
```

Tapi action method/service tetap harus enforce permission.

### 22.4 Hidden data

Composite jangan diam-diam render sensitive hidden fields.

Buruk:

```xml
<h:inputHidden value="#{cc.attrs.case.secretInternalNote}" />
```

Hidden field tetap client-visible dan client-editable.

---

## 23. Performance Design

Composite component membuat component tree lebih dalam.

Contoh sederhana:

```xml
<app:inputText ... />
```

Bisa menghasilkan tree:

```text
Composite component root
  outputLabel
  inputText
  panelGroup help
  message
```

Jika ada 200 rows x 8 fields, component count bisa besar.

Checklist performance:

1. Jangan pakai composite besar dalam large `h:dataTable` tanpa analisis.
2. Hindari getter mahal di `cc.attrs.*`.
3. Jangan render permission dengan service call per component.
4. Jangan load dropdown options di getter tiap render.
5. Gunakan pagination/lazy loading untuk table besar.
6. Stabilkan component id untuk partial rendering.
7. Hindari nested composite terlalu dalam.
8. Jangan masukkan script/style berat per instance.
9. Audit view state size.
10. Profiling render response phase.

Rule:

> Composite component meningkatkan maintainability, tetapi tidak gratis secara lifecycle dan state.

---

## 24. State Management Concerns

Composite component dapat menyimpan state melalui child components dan attributes.

Bahaya umum:

1. memasukkan object besar sebagai attribute,
2. menyimpan entity graph di view scoped bean,
3. membuat dynamic children tidak stabil antar request,
4. component `rendered` berubah sehingga restore tree mismatch,
5. menambah banyak fields dalam table.

Lebih baik:

```xml
<app:caseStatusBadge status="#{row.statusView}" />
```

Daripada:

```xml
<app:caseStatusBadge caseEntity="#{row}" />
```

Kenapa?

1. `statusView` lebih kecil,
2. contract lebih jelas,
3. tidak expose entity ke UI,
4. lebih mudah dites,
5. lebih kecil risiko lazy loading.

---

## 25. Composite Component dalam Data Table

Contoh:

```xml
<h:dataTable value="#{caseSearch.results}" var="row">
    <h:column>
        <f:facet name="header">Status</f:facet>
        <app:caseStatusBadge status="#{row.statusView}" />
    </h:column>

    <h:column>
        <f:facet name="header">Action</f:facet>
        <app:caseLink caseId="#{row.caseId}" label="#{row.caseNo}" />
    </h:column>
</h:dataTable>
```

Ini wajar jika component kecil.

Yang berbahaya:

```xml
<h:dataTable value="#{caseSearch.results}" var="row">
    <h:column>
        <app:fullCaseActionPanel case="#{row}" />
    </h:column>
</h:dataTable>
```

Jika `fullCaseActionPanel`:

1. menghitung permission banyak,
2. melakukan lookup dropdown,
3. memanggil service dari getter,
4. membuat banyak nested forms,
5. menyimpan state besar,

maka table bisa lambat dan view state membengkak.

Pattern yang lebih baik:

1. prepare row view model di backing bean/service,
2. render component kecil,
3. action detail dilakukan di halaman detail, bukan inline berlebihan,
4. gunakan lazy pagination.

---

## 26. Ajax Integration with Composite Components

Composite component harus dirancang agar Ajax mudah.

Contoh dependent dropdown wrapper:

```xml
<cc:interface>
    <cc:attribute name="value" required="true" />
    <cc:attribute name="items" required="true" />
    <cc:attribute name="listener" method-signature="void listener()" />
    <cc:clientBehavior name="change" event="change" targets="select" default="true" />
</cc:interface>

<cc:implementation>
    <h:selectOneMenu id="select" value="#{cc.attrs.value}">
        <f:selectItems value="#{cc.attrs.items}" />
        <f:ajax event="change" listener="#{cc.attrs.listener}" />
    </h:selectOneMenu>
</cc:implementation>
```

Namun ada design choice:

1. Apakah component internal selalu punya Ajax?
2. Atau caller boleh attach Ajax?
3. Apakah render target internal atau external?

Untuk reusable library, sering lebih baik caller mengontrol Ajax:

```xml
<app:selectOne label="Agency" value="#{form.agencyId}" items="#{form.agencies}">
    <f:ajax event="change"
            listener="#{form.onAgencyChange}"
            execute="@this"
            render="districtPanel" />
</app:selectOne>
```

Composite hanya expose target melalui `cc:clientBehavior`.

---

## 27. Error Handling and Message Placement

Reusable field component harus memutuskan:

1. apakah message selalu di dalam component,
2. atau page memiliki global error summary,
3. atau keduanya.

Pattern umum:

```xml
<h:message for="input" styleClass="field-error" />
```

Lalu di page template:

```xml
<h:messages globalOnly="true" styleClass="global-errors" />
```

Untuk accessibility, error message sebaiknya terkait dengan input.

Pertimbangan:

1. label harus `for` input,
2. error text harus dekat input,
3. invalid field harus punya CSS class,
4. screen reader support perlu diperhatikan,
5. global summary berguna untuk form panjang.

---

## 28. Accessibility Concerns

Composite component adalah tempat ideal untuk enforce accessibility.

Contoh field:

```xml
<h:outputLabel for="input" value="#{cc.attrs.label}" />
<h:inputText id="input" value="#{cc.attrs.value}" />
<h:message id="message" for="input" />
```

Pertanyaan review:

1. Apakah label benar-benar terkait ke input?
2. Apakah error message dapat dibaca screen reader?
3. Apakah button punya text jelas?
4. Apakah status badge tidak hanya mengandalkan warna?
5. Apakah modal/focus trap ditangani jika ada JS?
6. Apakah table header/facet benar?
7. Apakah required field terlihat secara teks, bukan warna saja?

Composite component yang baik membuat accessibility konsisten lintas aplikasi.

---

## 29. Testing Composite Components

Testing composite component bisa dilakukan di beberapa level.

### 29.1 Contract review test

Cek:

1. required attributes,
2. default values,
3. naming convention,
4. security behavior,
5. rendered output minimal.

### 29.2 Rendered HTML integration test

Gunakan embedded container atau integration test:

1. render halaman fixture,
2. parse HTML dengan jsoup,
3. assert label/input/message muncul,
4. assert escaping benar,
5. assert class/status sesuai whitelist.

Pseudo-test:

```java
Document doc = Jsoup.parse(html);
assertThat(doc.select("label").text()).contains("Applicant Name");
assertThat(doc.select("input[name$='applicantName']")).hasSize(1);
assertThat(doc.select("script")).isEmpty();
```

### 29.3 Security regression test

Input:

```text
<script>alert(1)</script>
```

Assert output escaped:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

### 29.4 Ajax behavior test

Cek:

1. event attached,
2. render target valid,
3. update area stable,
4. no duplicate id.

### 29.5 Visual regression

Untuk design system besar, screenshot/visual regression bisa membantu. Tapi jangan menjadikan visual snapshot sebagai satu-satunya test; contract dan security tetap harus diuji secara semantik.

---

## 30. Documentation for Internal UI Components

Setiap component yang dipakai lintas modul perlu dokumentasi kecil.

Template dokumentasi:

```md
# app:inputText

## Purpose
Reusable single-line text field with label, help text, and local validation message.

## Usage
```xml
<app:inputText label="Applicant Name"
               value="#{form.applicantName}"
               required="true" />
```

## Attributes
| Name | Required | Type | Default | Description |
|---|---:|---|---|---|
| label | yes | String | - | Field label |
| value | yes | ValueExpression | - | Bound field value |
| required | no | Boolean | false | Faces required validation |
| disabled | no | Boolean | false | Disable input |
| helpText | no | String | - | Help text below input |

## Facets
None.

## Ajax
Supports attaching `f:ajax` to inner input via default client behavior.

## Security
All textual output is escaped by default.

## Notes
Do not use inside large data tables unless component count is reviewed.
```

Documentation seperti ini mengubah composite component menjadi real internal API.

---

## 31. Anti-Patterns

### 31.1 Business logic inside component

Buruk:

```xml
rendered="#{case.status eq 'OPEN' and user.role eq 'MANAGER' and case.amount gt 10000}"
```

Lebih baik:

```xml
rendered="#{casePermission.canEscalate}"
```

### 31.2 Passing entity directly

Buruk:

```xml
<app:caseCard case="#{caseEntity}" />
```

Lebih baik:

```xml
<app:caseCard case="#{caseCardView}" />
```

### 31.3 Too many attributes

Jika component punya 30 attributes, kemungkinan ia tidak punya boundary yang jelas.

### 31.4 Hidden service call through getter

Buruk:

```xml
<app:statusBadge status="#{caseBean.loadStatus(caseId)}" />
```

Lebih baik prepare status di backing bean sebelum render.

### 31.5 Raw HTML default

Buruk:

```xml
<h:outputText value="#{cc.attrs.content}" escape="false" />
```

### 31.6 Dynamic CSS class from user input

Buruk:

```xml
class="badge #{cc.attrs.userClass}"
```

### 31.7 Component abstraction for one-off page

Tidak semua markup perlu dijadikan component. Jika hanya dipakai sekali dan tidak punya semantic contract, composite bisa menjadi overhead.

---

## 32. Migration: `javax` to `jakarta`

Migration composite components menyentuh beberapa layer.

### 32.1 Namespace XHTML

Legacy:

```xml
xmlns:h="http://java.sun.com/jsf/html"
xmlns:f="http://java.sun.com/jsf/core"
xmlns:ui="http://java.sun.com/jsf/facelets"
xmlns:cc="http://java.sun.com/jsf/composite"
xmlns:app="http://java.sun.com/jsf/composite/app"
```

Modern Jakarta style:

```xml
xmlns:h="jakarta.faces.html"
xmlns:f="jakarta.faces.core"
xmlns:ui="jakarta.faces.facelets"
xmlns:cc="jakarta.faces.composite"
xmlns:app="jakarta.faces.composite/app"
```

### 32.2 Java imports

Legacy:

```java
import javax.faces.component.UIComponent;
import javax.faces.context.FacesContext;
```

Jakarta:

```java
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
```

### 32.3 Libraries

Pastikan component library seperti PrimeFaces/OmniFaces cocok dengan Jakarta Faces version yang dipakai.

### 32.4 Managed bean removal

Jakarta Faces 4 removed old managed bean facility. Gunakan CDI:

```java
@Named
@ViewScoped
public class CaseBean implements Serializable {
}
```

Bukan:

```java
@ManagedBean
@ViewScoped
public class CaseBean {
}
```

### 32.5 Test after migration

Test yang wajib:

1. composite component discovery,
2. namespace resolution,
3. validator/converter attachment,
4. Ajax event,
5. view state restore,
6. error message rendering,
7. static resource loading,
8. third-party component integration.

---

## 33. Java 8 sampai Java 25 Implications

Composite component sendiri mostly Faces-level. Namun runtime Java memengaruhi ekosistem.

### Java 8

1. Banyak JSF 2.x legacy.
2. Namespace `javax.*`.
3. Older app server constraints.
4. Records belum tersedia.
5. Testing/library versi modern terbatas.

### Java 11

1. Transisi umum dari Java 8.
2. Modul JDK berubah, beberapa dependency lama bermasalah.
3. Masih banyak Jakarta EE 8/9 migration bridge.

### Java 17

1. Baseline penting untuk Jakarta EE 11.
2. Records bisa dipakai untuk view model jika container/tooling mendukung.
3. Lebih cocok untuk modern build/test stack.

### Java 21

1. LTS modern.
2. Virtual threads ada, tapi Faces rendering tetap harus disiplin terhadap blocking/resource access.
3. Jangan menganggap virtual threads memperbaiki component tree bloat.

### Java 25

1. LTS terbaru setelah 21.
2. Cocok untuk platform modern jika container mendukung.
3. Perhatikan support matrix app server/Faces implementation.

Rule:

> Upgrade Java version tidak otomatis memperbaiki desain composite component yang buruk. Lifecycle cost, state bloat, dan rendering security tetap harus didesain.

---

## 34. Design Heuristics: Kapan Membuat Composite Component?

Buat composite jika minimal dua atau tiga kondisi berikut benar:

1. markup dipakai berulang,
2. punya semantic meaning jelas,
3. butuh consistency lintas halaman,
4. ada accessibility/security rule yang ingin dipusatkan,
5. ada label/message/help pattern yang selalu sama,
6. ada view contract yang stabil,
7. ada tim lain yang akan memakai component tersebut.

Jangan buat composite jika:

1. hanya dipakai sekali,
2. logic-nya domain-specific terlalu sempit,
3. membutuhkan 20+ attribute untuk fleksibel,
4. membuat debugging lifecycle lebih sulit daripada markup langsung,
5. menyembunyikan business logic,
6. membuat Ajax target tidak jelas,
7. menghasilkan component tree besar tanpa manfaat.

---

## 35. Enterprise Component Library Blueprint

Contoh komponen yang layak untuk internal enterprise app:

```text
resources/app/
  pageTitle.xhtml
  panel.xhtml
  alert.xhtml
  formField.xhtml
  inputText.xhtml
  inputTextarea.xhtml
  selectOne.xhtml
  dateInput.xhtml
  moneyOutput.xhtml
  dateOutput.xhtml
  statusBadge.xhtml
  actionBar.xhtml
  permissionedButton.xhtml
  errorSummary.xhtml
  breadcrumb.xhtml
  pagination.xhtml
  emptyState.xhtml
  confirmationButton.xhtml
  documentLink.xhtml
  caseLink.xhtml
```

Layering:

```text
Low-level primitives:
  app:formField
  app:panel
  app:alert

Domain-neutral controls:
  app:inputText
  app:selectOne
  app:dateInput
  app:moneyOutput

Domain-specific components:
  app:caseStatusBadge
  app:caseLink
  app:documentLink
  app:permissionedCaseAction
```

Rule:

> Pisahkan domain-neutral UI primitives dari domain-specific components. Jangan mencampur semua dalam satu library tanpa struktur.

---

## 36. Failure Modeling

### 36.1 Component not found

Kemungkinan:

1. file tidak berada di `/resources/<library>/<name>.xhtml`,
2. namespace salah,
3. packaging WAR/JAR salah,
4. migration namespace belum selesai,
5. typo component name.

### 36.2 Attribute not found

Kemungkinan:

1. attribute tidak dideklarasikan,
2. typo di `cc.attrs.*`,
3. using page tidak mengirim required attribute,
4. wrong namespace menyebabkan file lain terbaca.

### 36.3 Validator tidak bekerja

Kemungkinan:

1. composite tidak expose `editableValueHolder`,
2. validator ditempel ke outer component tapi tidak ditargetkan ke inner input,
3. `immediate=true` mengubah lifecycle,
4. Ajax `execute` tidak mencakup input.

### 36.4 Ajax render gagal

Kemungkinan:

1. target id salah karena naming container,
2. component target tidak rendered saat response,
3. wrapper tidak stabil,
4. multiple forms,
5. duplicate id.

### 36.5 Value tidak update

Kemungkinan:

1. validation failure,
2. conversion failure,
3. input tidak masuk execute set,
4. value expression read-only,
5. bean scope salah,
6. component rendered/disabled.

### 36.6 Page lambat

Kemungkinan:

1. component terlalu banyak,
2. getter berat,
3. permission lookup per row,
4. nested composite terlalu dalam,
5. view state besar,
6. data table besar.

---

## 37. Review Checklist

Gunakan checklist ini saat membuat atau mereview composite component.

### Contract

- [ ] Nama component semantic dan jelas.
- [ ] Attribute wajib/minor/default jelas.
- [ ] Tidak terlalu banyak attribute.
- [ ] Facet/children dipakai hanya jika memang perlu extensibility.
- [ ] Method expression punya signature jelas.

### Lifecycle

- [ ] Input component expose editable value holder jika perlu.
- [ ] Ajax behavior bisa dipasang dengan jelas.
- [ ] Id internal stabil.
- [ ] Tidak ada duplicate id.
- [ ] `rendered`, `disabled`, `readonly`, `immediate` dipahami.

### State

- [ ] Tidak passing entity graph besar.
- [ ] Tidak membuat dynamic tree tidak stabil.
- [ ] Aman untuk multi-tab jika digunakan di view scoped page.
- [ ] Tidak memperbesar view state secara tidak perlu.

### Security

- [ ] Output text escaped by default.
- [ ] Raw HTML hanya jika explicit dan trusted.
- [ ] CSS class/style tidak berasal dari user input bebas.
- [ ] Authorization rendering tidak dianggap enforcement.
- [ ] Tidak render sensitive hidden data.

### Performance

- [ ] Tidak ada service/database call dari getter/render path.
- [ ] Aman jika dipakai dalam data table.
- [ ] Resource CSS/JS tidak berat per instance.
- [ ] Component count wajar.

### Operability

- [ ] Error mudah didiagnosis.
- [ ] Component terdokumentasi.
- [ ] Ada sample usage.
- [ ] Ada test untuk rendering/security minimal.

---

## 38. Mini Capstone: Case Action Bar

Kebutuhan:

1. tampilkan tombol aksi case,
2. aksi tergantung permission,
3. ada primary/secondary style,
4. action tetap di backing bean,
5. rendering konsisten.

View model:

```java
public record CaseActionView(
    String code,
    String label,
    boolean allowed,
    boolean primary
) {}
```

Backing bean:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private List<CaseActionView> actions;

    public List<CaseActionView> getActions() {
        return actions;
    }

    public String perform(String actionCode) {
        caseCommandService.perform(caseId, actionCode, currentUser);
        return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
    }
}
```

Composite:

```xml
<ui:component
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:h="jakarta.faces.html"
    xmlns:ui="jakarta.faces.facelets"
    xmlns:cc="jakarta.faces.composite">

    <cc:interface>
        <cc:attribute name="actions" required="true" />
        <cc:attribute name="listener"
                      method-signature="java.lang.String listener(java.lang.String)"
                      required="true" />
    </cc:interface>

    <cc:implementation>
        <div class="case-action-bar">
            <ui:repeat value="#{cc.attrs.actions}" var="action">
                <h:commandButton value="#{action.label}"
                                 action="#{cc.attrs.listener(action.code)}"
                                 rendered="#{action.allowed}"
                                 styleClass="#{action.primary ? 'btn btn-primary' : 'btn btn-secondary'}" />
            </ui:repeat>
        </div>
    </cc:implementation>
</ui:component>
```

Pemakaian:

```xml
<app:caseActionBar actions="#{caseDetail.actions}"
                   listener="#{caseDetail.perform}" />
```

Review:

1. Permission dihitung sebelum render.
2. Button hanya visible jika allowed.
3. Service tetap enforce authorization.
4. Component reusable untuk halaman detail lain.
5. Tidak passing full case entity.
6. Tidak ada DB call dari component.

Catatan: untuk action list besar atau component dalam table, `ui:repeat` perlu direview. Untuk action bar kecil, ini wajar.

---

## 39. Ringkasan Mental Model

Composite component adalah:

```text
Facelets file + public interface + implementation + resource library
```

Ia bukan:

```text
sekadar include
sekadar macro HTML
tempat business logic
pengganti authorization service
pengganti custom component untuk semua kasus
```

Peta keputusan:

```text
Butuh page layout?
  -> template / ui:composition

Butuh potongan markup sederhana?
  -> ui:include atau tag ringan

Butuh reusable field/panel/action dengan kontrak?
  -> composite component

Butuh rendering/decode/state behavior sangat custom?
  -> custom UIComponent + Renderer
```

Prinsip utama:

1. Composite component adalah API.
2. API harus kecil, jelas, dan stabil.
3. State harus kecil.
4. Output harus aman by default.
5. Authorization tetap di server-side business boundary.
6. Ajax harus dirancang, bukan kebetulan bekerja.
7. Component library harus terdokumentasi dan dites.
8. Jangan membuat abstraction tanpa semantic center.

---

## 40. Latihan

### Latihan 1 — Field Component

Buat `app:inputText` dengan:

1. label,
2. value,
3. required,
4. help text,
5. local message,
6. support converter/validator dari caller.

Evaluasi:

- Apakah label `for` benar?
- Apakah message muncul?
- Apakah validator caller bekerja?
- Apakah Ajax bisa ditempel?

### Latihan 2 — Status Badge

Buat `app:caseStatusBadge` yang menerima view model, bukan entity.

Evaluasi:

- Apakah label escaped?
- Apakah CSS class whitelisted?
- Apakah tidak bergantung pada string status mentah di view?

### Latihan 3 — Permission Button

Buat `app:permissionedButton`.

Evaluasi:

- Apakah tombol hidden saat tidak allowed?
- Apakah service tetap enforce permission?
- Apakah action method signature jelas?

### Latihan 4 — Ajax Select

Buat `app:selectOne` yang bisa menerima `f:ajax` dari caller.

Evaluasi:

- Apakah `cc:clientBehavior` benar?
- Apakah target internal valid?
- Apakah naming container tidak membingungkan caller?

### Latihan 5 — Review Legacy Component

Ambil satu composite component lama, lalu audit:

1. attribute count,
2. raw HTML,
3. entity exposure,
4. service call in getter,
5. Ajax target,
6. view state impact,
7. migration namespace.

---

## 41. Penutup

Composite component adalah jembatan antara markup Facelets biasa dan full custom component framework. Jika didesain dengan benar, ia menjadi fondasi design system internal yang kuat: konsisten, aman, accessible, dan mudah dipakai lintas modul.

Tetapi jika didesain asal-asalan, composite component berubah menjadi layer abstraksi gelap: behavior tersembunyi, lifecycle sulit ditebak, state membengkak, Ajax rapuh, dan debugging melelahkan.

Pada level senior/top-tier, kemampuan pentingnya bukan hanya “bisa membuat composite component”, tetapi bisa menjawab:

1. Apakah ini perlu menjadi component?
2. Apa kontrak publiknya?
3. Apa yang harus tetap di backing bean/service?
4. Bagaimana lifecycle-nya?
5. Bagaimana state dan Ajax-nya?
6. Bagaimana security dan accessibility-nya?
7. Bagaimana component ini akan berubah enam bulan lagi?

Jika jawaban itu jelas, composite component akan menjadi aset arsitektur. Jika tidak, ia akan menjadi technical debt yang terlihat rapi di permukaan.

---

## Referensi

1. Jakarta Faces 4.1 Specification and VDL Documentation — composite component concepts, Facelets, UI component model, and resource handling.
2. Jakarta EE Tutorial — Composite Components and Advanced Composite Component Topics.
3. Jakarta Faces VDL documentation for `cc:interface`, `cc:implementation`, `cc:attribute`, `cc:facet`, `cc:insertChildren`, `cc:renderFacet`, `cc:editableValueHolder`, `cc:actionSource`, and `cc:clientBehavior`.
4. Jakarta Expression Language documentation — value expressions and method expressions used by composite component attributes.
5. Jakarta Faces migration materials and Jakarta EE namespace transition guidance for `javax.*` to `jakarta.*`.

---

## Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
24-custom-faces-components-renderers-converters-validators-extensions.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./22-ajax-and-partial-rendering-in-faces.md">⬅️ Part 22 — Ajax and Partial Rendering in Jakarta Faces</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./24-custom-faces-components-renderers-converters-validators-extensions.md">Part 24 — Custom Faces Components, Renderers, Converters, Validators, and Extensions ➡️</a>
</div>
