# Part 22 — Ajax and Partial Rendering in Jakarta Faces

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `22-ajax-and-partial-rendering-in-faces.md`  
> Level: Advanced  
> Target: Java 8 sampai Java 25, JSF/Jakarta Faces 2.x sampai Jakarta Faces 4.1+  
> Fokus: `f:ajax`, partial lifecycle, `execute`, `render`, partial response, naming container, validation, state, race condition, dan production debugging.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami Ajax di Jakarta Faces sebagai **partial server-side lifecycle**, bukan sekadar JavaScript request.
2. Menjelaskan perbedaan antara:
   - full submit,
   - Ajax submit,
   - partial processing,
   - partial rendering.
3. Menggunakan `f:ajax` dengan benar pada input, command, select, data table, dan composite component.
4. Menentukan `execute` dan `render` berdasarkan flow data, bukan trial-and-error.
5. Membaca bug Faces Ajax dari perspektif component tree, naming container, lifecycle phase, dan view state.
6. Menghindari bug umum:
   - action tidak terpanggil,
   - model tidak update,
   - validation unexpectedly blocking action,
   - komponen tidak ter-render,
   - duplicate id,
   - stale view state,
   - malformed partial response,
   - race condition antar request Ajax.
7. Mendesain UX enterprise dengan Ajax tanpa mengorbankan correctness, security, auditability, dan maintainability.

---

## 2. Mental Model Besar

Di aplikasi web biasa, Ajax sering dipahami sebagai:

```text
browser JavaScript -> HTTP request -> server JSON -> update DOM
```

Di Jakarta Faces, mental modelnya berbeda:

```text
browser event
  -> Faces Ajax JavaScript submits form + view state
  -> FacesServlet receives partial request
  -> component tree restored
  -> selected components are processed
  -> lifecycle runs partially
  -> selected components are re-rendered on server
  -> server returns partial response XML
  -> Faces JavaScript patches DOM
```

Jadi Faces Ajax bukan sekadar “ambil data dari server”. Faces Ajax adalah:

> mekanisme untuk menjalankan sebagian lifecycle Faces pada sebagian component tree, lalu mengganti sebagian DOM dengan markup baru yang dihasilkan server.

Konsekuensinya besar:

1. Ajax Faces tetap membawa **view state**.
2. Ajax Faces tetap melewati lifecycle:
   - restore view,
   - apply request values,
   - process validations,
   - update model values,
   - invoke application,
   - render response.
3. Namun tidak semua component perlu diproses.
4. Tidak semua component perlu dirender ulang.
5. Yang diproses ditentukan oleh `execute`.
6. Yang diganti di browser ditentukan oleh `render`.

---

## 3. Full Submit vs Faces Ajax Submit

### 3.1 Full submit

Full submit:

```xhtml
<h:form>
    <h:inputText value="#{caseBean.keyword}" />
    <h:commandButton value="Search" action="#{caseBean.search}" />
</h:form>
```

Flow:

```text
submit form penuh
  -> seluruh form dikirim
  -> lifecycle penuh
  -> response HTML halaman penuh
  -> browser reload halaman penuh
```

Cocok untuk:

1. Save final.
2. Submit workflow action.
3. Navigation besar.
4. Operation yang harus jelas boundary transaksinya.

### 3.2 Ajax submit

Ajax submit:

```xhtml
<h:form id="searchForm">
    <h:inputText id="keyword" value="#{caseBean.keyword}" />

    <h:commandButton id="search" value="Search" action="#{caseBean.search}">
        <f:ajax execute="@form" render="resultPanel messages" />
    </h:commandButton>

    <h:messages id="messages" />

    <h:panelGroup id="resultPanel">
        ...
    </h:panelGroup>
</h:form>
```

Flow:

```text
click button
  -> Ajax request dikirim
  -> component tree direstore
  -> @form diproses
  -> action dipanggil bila validation lulus
  -> resultPanel dan messages dirender ulang
  -> browser mengganti DOM resultPanel/messages
```

Cocok untuk:

1. Search/filter tanpa reload penuh.
2. Dependent dropdown.
3. Inline validation.
4. Partial update summary/detail.
5. Show/hide panel.
6. Refresh table region.
7. Modal/dialog interaction.

---

## 4. `f:ajax` sebagai Client Behavior

`f:ajax` mendaftarkan Ajax behavior pada komponen yang mendukung client behavior.

Contoh input change:

```xhtml
<h:inputText id="postalCode" value="#{addressBean.postalCode}">
    <f:ajax event="blur"
            execute="@this"
            listener="#{addressBean.lookupAddress}"
            render="addressPanel messages" />
</h:inputText>
```

Contoh button:

```xhtml
<h:commandButton id="assign" value="Assign" action="#{caseBean.assign}">
    <f:ajax execute="@form" render="caseHeader actionPanel messages" />
</h:commandButton>
```

Contoh select change:

```xhtml
<h:selectOneMenu id="agency" value="#{caseBean.selectedAgencyId}">
    <f:selectItems value="#{caseBean.agencies}"
                   var="agency"
                   itemValue="#{agency.id}"
                   itemLabel="#{agency.name}" />

    <f:ajax event="change"
            execute="@this"
            listener="#{caseBean.onAgencyChanged}"
            render="officer" />
</h:selectOneMenu>

<h:selectOneMenu id="officer" value="#{caseBean.selectedOfficerId}">
    <f:selectItems value="#{caseBean.officersForSelectedAgency}" />
</h:selectOneMenu>
```

Mental model:

```text
f:ajax = behavior attached to component event
```

Bukan:

```text
f:ajax = generic fetch API replacement
```

---

## 5. Attribute Penting `f:ajax`

Umumnya attribute yang paling penting:

| Attribute | Makna |
|---|---|
| `event` | Event client/component yang memicu Ajax. |
| `execute` | Komponen mana yang diproses dalam lifecycle. |
| `render` | Komponen mana yang dirender ulang dan dikirim ke browser. |
| `listener` | Method listener yang dipanggil saat Ajax behavior event. |
| `onevent` | JavaScript callback untuk status begin/complete/success. |
| `onerror` | JavaScript callback saat Ajax error. |
| `disabled` | Menonaktifkan Ajax behavior. |
| `immediate` | Mengubah phase tempat behavior diproses. |

Contoh lengkap:

```xhtml
<h:commandButton id="refresh" value="Refresh">
    <f:ajax event="action"
            execute="@this filterPanel"
            render="tablePanel messages"
            listener="#{caseListBean.refresh}"
            onevent="onCaseTableAjaxEvent"
            onerror="onCaseTableAjaxError" />
</h:commandButton>
```

---

## 6. Search Expressions: `@this`, `@form`, `@all`, `@none`

### 6.1 `@this`

`@this` berarti komponen yang memicu Ajax.

```xhtml
<h:inputText id="keyword" value="#{bean.keyword}">
    <f:ajax execute="@this" render="suggestions" />
</h:inputText>
```

Efek:

```text
Hanya input keyword yang diproses.
Input lain dalam form tidak ikut decode/validate/update.
```

Cocok untuk:

1. Inline validation satu field.
2. Dependent field change.
3. Lightweight field-level update.

Tidak cocok untuk:

1. Submit action yang membutuhkan semua field form.
2. Save operation.
3. Complex calculation dari banyak input.

### 6.2 `@form`

`@form` berarti form terdekat yang menaungi komponen.

```xhtml
<h:commandButton value="Calculate">
    <f:ajax execute="@form" render="summary" />
</h:commandButton>
```

Efek:

```text
Semua input dalam form diproses.
```

Cocok untuk:

1. Submit mini-form.
2. Save draft panel.
3. Recalculate summary dari banyak input.

Risiko:

1. Input required lain bisa memblokir action.
2. Validation field yang tidak relevan bisa ikut jalan.
3. Form terlalu besar membuat request dan lifecycle mahal.

### 6.3 `@all`

`@all` berarti seluruh view.

```xhtml
<f:ajax execute="@all" render="@all" />
```

Ini hampir seperti full lifecycle via Ajax.

Gunakan sangat hati-hati.

Biasanya lebih baik:

```text
Gunakan full submit jika memang seluruh halaman harus diproses.
Gunakan Ajax hanya jika ada partial update yang jelas.
```

### 6.4 `@none`

`@none` berarti tidak ada komponen diproses/dirender untuk bagian tersebut.

Contoh advanced:

```xhtml
<f:ajax execute="@none" render="clockPanel" listener="#{bean.refreshClock}" />
```

Namun secara praktis, kebanyakan Ajax operation tetap perlu minimal `@this` agar event source terlibat dengan benar.

---

## 7. `execute` vs `render`: Dua Pertanyaan yang Berbeda

Kesalahan paling umum adalah menganggap `execute` dan `render` hal yang sama.

Padahal berbeda total.

```text
execute = input/action mana yang diproses server-side?
render  = output/component mana yang dikirim ulang ke browser?
```

Contoh:

```xhtml
<h:form id="caseForm">
    <h:inputText id="amount" value="#{caseBean.amount}" />
    <h:inputText id="tax" value="#{caseBean.tax}" />

    <h:commandButton id="calculate" value="Calculate">
        <f:ajax execute="amount tax calculate"
                listener="#{caseBean.calculateTotal}"
                render="totalPanel messages" />
    </h:commandButton>

    <h:panelGroup id="totalPanel">
        Total: #{caseBean.total}
    </h:panelGroup>

    <h:messages id="messages" />
</h:form>
```

Di sini:

```text
execute="amount tax calculate"
```

berarti:

1. Decode amount.
2. Decode tax.
3. Decode command button.
4. Convert amount/tax.
5. Validate amount/tax.
6. Update model amount/tax.
7. Process command/listener.

Sedangkan:

```text
render="totalPanel messages"
```

berarti:

1. Render ulang markup `totalPanel`.
2. Render ulang markup `messages`.
3. Kirim markup baru dalam partial response.
4. Browser patch DOM.

---

## 8. Rule of Thumb untuk `execute`

Gunakan pertanyaan ini:

> Komponen mana yang datanya harus tersedia di server untuk operasi ini?

### 8.1 Field-level operation

Contoh: postal code lookup.

```xhtml
<f:ajax execute="@this" render="addressPanel messages" />
```

Karena hanya postal code yang diperlukan.

### 8.2 Panel-level calculation

Contoh: menghitung total dari beberapa field.

```xhtml
<f:ajax execute="amount tax discount" render="summary" />
```

Karena hanya tiga field itu yang diperlukan.

### 8.3 Form submit operation

Contoh: save form.

```xhtml
<f:ajax execute="@form" render="@form messages" />
```

Atau full submit jika operasi besar:

```xhtml
<h:commandButton value="Save" action="#{bean.save}" />
```

### 8.4 Cancel/back operation

Cancel tidak perlu validasi field lain.

```xhtml
<h:commandButton value="Cancel" action="#{bean.cancel}" immediate="true">
    <f:ajax execute="@this" render="@none" />
</h:commandButton>
```

Namun untuk cancel yang melakukan navigation, sering lebih sederhana memakai non-Ajax full navigation.

---

## 9. Rule of Thumb untuk `render`

Gunakan pertanyaan ini:

> Bagian DOM mana yang harus berubah setelah operasi berhasil atau gagal?

Selalu pertimbangkan:

1. Area hasil utama.
2. Message/error area.
3. Button/action area jika permission/status berubah.
4. Header/status badge jika state berubah.
5. Hidden view state/form area bila form berubah.

Contoh workflow action:

```xhtml
<h:commandButton id="approve" value="Approve" action="#{caseBean.approve}">
    <f:ajax execute="@form"
            render="caseHeader actionPanel timelinePanel messages" />
</h:commandButton>
```

Mengapa bukan hanya `timelinePanel`?

Karena approve bisa mengubah:

1. Status case di header.
2. Action yang tersedia.
3. Timeline/history.
4. Messages.

Jika hanya timeline yang dirender, UI bisa menampilkan status lama dan action yang seharusnya tidak tersedia lagi.

---

## 10. Lifecycle Ajax secara Step-by-Step

Misal:

```xhtml
<h:form id="form">
    <h:inputText id="keyword" value="#{caseSearchBean.keyword}" />

    <h:commandButton id="search" value="Search" action="#{caseSearchBean.search}">
        <f:ajax execute="keyword search" render="results messages" />
    </h:commandButton>

    <h:messages id="messages" />

    <h:panelGroup id="results">
        <h:dataTable value="#{caseSearchBean.results}" var="caseItem">
            <h:column>#{caseItem.referenceNo}</h:column>
            <h:column>#{caseItem.status}</h:column>
        </h:dataTable>
    </h:panelGroup>
</h:form>
```

### 10.1 Browser sends partial request

Faces JavaScript mengirim parameter seperti:

```text
jakarta.faces.partial.ajax=true
jakarta.faces.source=form:search
jakarta.faces.partial.execute=form:keyword form:search
jakarta.faces.partial.render=form:results form:messages
jakarta.faces.ViewState=...
form:keyword=...
```

Nama parameter bisa berbeda pada era lama `javax.faces.*`, tetapi konsepnya sama.

### 10.2 Restore View

Server restore component tree dari view state.

Jika gagal:

```text
ViewExpiredException
```

### 10.3 Apply Request Values

Komponen dalam `execute` decode submitted value.

```text
keyword.submittedValue = request parameter
search decoded as action source
```

Komponen lain tidak diproses.

### 10.4 Process Validations

`keyword` dikonversi dan divalidasi.

Jika gagal:

1. Model tidak di-update.
2. Action tidak dipanggil.
3. Render response langsung.
4. `messages` harus masuk dalam `render`, kalau tidak user tidak melihat error.

### 10.5 Update Model Values

Jika valid:

```text
caseSearchBean.keyword = converted keyword
```

### 10.6 Invoke Application

Action dipanggil:

```java
public void search() {
    results = caseService.search(keyword);
}
```

### 10.7 Render Response

Hanya komponen dalam `render` dirender ulang:

```text
results
messages
```

Server mengirim partial response XML, bukan HTML full page.

---

## 11. Partial Response XML

Faces Ajax response bukan JSON biasa. Secara konseptual:

```xml
<partial-response>
    <changes>
        <update id="form:results">
            <![CDATA[
                <span id="form:results">...</span>
            ]]>
        </update>
        <update id="form:messages">
            <![CDATA[
                <ul id="form:messages">...</ul>
            ]]>
        </update>
    </changes>
</partial-response>
```

Browser-side Faces JavaScript membaca response ini lalu mengganti DOM element berdasarkan `id`.

Implikasi:

1. Jika server menghasilkan HTML error page biasa, browser Ajax parser bisa gagal.
2. Jika response berisi stack trace bukan partial XML, UI bisa tampak “diam”.
3. Jika session expired lalu server redirect ke login HTML biasa, Ajax response bisa malformed.
4. Jika component id tidak ditemukan di DOM, update gagal.
5. Jika `render` menunjuk component yang tidak ada di component tree, server bisa error.

---

## 12. Kenapa `h:panelGroup` Sering Dipakai untuk Render Target

Faces Ajax mengganti DOM element berdasarkan client id.

Masalah:

```xhtml
<h:outputText id="message" value="Hello" rendered="#{bean.show}" />
```

Jika `bean.show == false`, komponen tidak menghasilkan DOM element.

Lalu Ajax:

```xhtml
<f:ajax render="message" />
```

Browser tidak punya DOM node `message` untuk diganti.

Solusi umum:

```xhtml
<h:panelGroup id="messageWrapper" layout="block">
    <h:outputText id="message" value="Hello" rendered="#{bean.show}" />
</h:panelGroup>
```

Render wrapper:

```xhtml
<f:ajax render="messageWrapper" />
```

Karena wrapper selalu ada di DOM.

Rule:

> Jika visibility component bisa berubah karena Ajax, render container stabil yang selalu ada.

---

## 13. Naming Container dan Client ID

Faces component tree punya konsep naming container.

Contoh:

```xhtml
<h:form id="form">
    <h:dataTable id="table" value="#{bean.rows}" var="row">
        <h:column>
            <h:commandButton id="select" value="Select">
                <f:ajax render="detailPanel" />
            </h:commandButton>
        </h:column>
    </h:dataTable>

    <h:panelGroup id="detailPanel">
        ...
    </h:panelGroup>
</h:form>
```

Client id bisa menjadi:

```text
form:table:0:select
form:detailPanel
```

`render="detailPanel"` biasanya dicari relatif dari naming container saat ini. Dalam beberapa kasus, resolusi relatif membingungkan.

Gunakan absolute expression dengan prefix `:`:

```xhtml
<f:ajax render=":form:detailPanel" />
```

Mental model:

```text
id      = local component id
clientId = id final di HTML DOM, dipengaruhi naming container
```

Dalam debugging Ajax, selalu lihat HTML final:

```html
<div id="form:detailPanel">...</div>
```

Bukan hanya source `.xhtml`.

---

## 14. Multiple Forms

Faces Ajax hampir selalu berada dalam `h:form`.

Contoh risiko:

```xhtml
<h:form id="filterForm">
    <h:inputText id="keyword" value="#{bean.keyword}" />
</h:form>

<h:form id="tableForm">
    <h:commandButton id="refresh" value="Refresh">
        <f:ajax execute="@form" render=":resultPanel" />
    </h:commandButton>
</h:form>

<h:panelGroup id="resultPanel">
    ...
</h:panelGroup>
```

Masalah:

```text
execute="@form" hanya memproses tableForm, bukan filterForm.
keyword tidak terkirim.
```

Solusi:

1. Satukan filter dan action dalam form yang sama.
2. Atau execute field eksplisit dengan absolute id jika supported/resolved benar.
3. Atau ubah UX supaya filter submit berasal dari form filter.

Praktik enterprise:

```text
Satu logical interaction region = satu h:form.
```

Jangan terlalu banyak form kecil tanpa alasan.

---

## 15. Ajax pada Input Field

### 15.1 Blur validation

```xhtml
<h:inputText id="referenceNo"
             value="#{caseBean.referenceNo}"
             required="true">
    <f:ajax event="blur" execute="@this" render="referenceNoMessage" />
</h:inputText>

<h:message id="referenceNoMessage" for="referenceNo" />
```

Ini memvalidasi field saat blur.

Kelebihan:

1. Feedback cepat.
2. Tidak memproses field lain.

Risiko:

1. Terlalu banyak request jika dipasang di banyak field.
2. User bisa bingung jika server lambat.
3. Required validation saat blur bisa terlalu agresif.

### 15.2 Keyup search suggestion

```xhtml
<h:inputText id="keyword" value="#{searchBean.keyword}">
    <f:ajax event="keyup" execute="@this" listener="#{searchBean.suggest}" render="suggestions" />
</h:inputText>
```

Hati-hati:

1. `keyup` bisa membanjiri server.
2. Faces Ajax default bukan debounced search API.
3. Ada risiko out-of-order response.
4. Untuk autocomplete berat, component library atau custom JS endpoint bisa lebih tepat.

Rule:

> Jangan jadikan Faces Ajax sebagai replacement untuk high-frequency search API tanpa throttling/debouncing.

---

## 16. Ajax pada Command Button

Command button biasanya action-oriented.

```xhtml
<h:commandButton id="saveDraft" value="Save Draft" action="#{caseBean.saveDraft}">
    <f:ajax execute="@form" render="messages auditPanel actionPanel" />
</h:commandButton>
```

Pertanyaan penting:

1. Apakah action harus menavigasi ke halaman lain?
2. Apakah action harus aman dari double click?
3. Apakah validasi semua field harus jalan?
4. Apakah action mengubah permission/action list?
5. Apakah setelah action perlu PRG?

Untuk action workflow final seperti approve/reject, Ajax boleh dipakai, tetapi harus hati-hati:

```text
Jika action mengubah state bisnis besar, pastikan UX, audit, idempotency, dan optimistic locking benar.
```

Kadang full submit + redirect lebih defensible.

---

## 17. Ajax pada Select dan Dependent Dropdown

Contoh agency -> officer:

```xhtml
<h:selectOneMenu id="agency" value="#{assignmentBean.agencyId}">
    <f:selectItem itemValue="" itemLabel="-- Select Agency --" />
    <f:selectItems value="#{assignmentBean.agencies}"
                   var="agency"
                   itemValue="#{agency.id}"
                   itemLabel="#{agency.name}" />

    <f:ajax event="change"
            execute="@this"
            listener="#{assignmentBean.loadOfficers}"
            render="officer officerMessage" />
</h:selectOneMenu>

<h:selectOneMenu id="officer" value="#{assignmentBean.officerId}">
    <f:selectItem itemValue="" itemLabel="-- Select Officer --" />
    <f:selectItems value="#{assignmentBean.officers}"
                   var="officer"
                   itemValue="#{officer.id}"
                   itemLabel="#{officer.name}" />
</h:selectOneMenu>

<h:message id="officerMessage" for="officer" />
```

Backing bean:

```java
@Named
@ViewScoped
public class AssignmentBean implements Serializable {

    private Long agencyId;
    private Long officerId;
    private List<AgencyOption> agencies;
    private List<OfficerOption> officers = List.of();

    @Inject
    private AssignmentService assignmentService;

    public void loadOfficers() {
        officerId = null;

        if (agencyId == null) {
            officers = List.of();
            return;
        }

        officers = assignmentService.findOfficersByAgency(agencyId);
    }
}
```

Critical detail:

```java
officerId = null;
```

Saat parent dropdown berubah, child selection lama harus direset agar tidak menyimpan officer dari agency sebelumnya.

---

## 18. Ajax dan Validation

Ajax tidak otomatis melewati validation.

Contoh bug:

```xhtml
<h:inputText id="requiredReason"
             value="#{caseBean.reason}"
             required="true" />

<h:commandButton id="loadPreview" value="Preview">
    <f:ajax execute="@form" listener="#{caseBean.loadPreview}" render="preview" />
</h:commandButton>
```

Jika `requiredReason` kosong, `loadPreview()` tidak dipanggil.

Solusi tergantung intent.

### 18.1 Preview butuh seluruh form valid

Biarkan:

```xhtml
<f:ajax execute="@form" render="preview messages" />
```

### 18.2 Preview hanya butuh field tertentu

Batasi execute:

```xhtml
<f:ajax execute="previewType" listener="#{caseBean.loadPreview}" render="preview messages" />
```

### 18.3 Cancel tidak boleh terhalang validation

```xhtml
<h:commandButton value="Cancel" action="#{caseBean.cancel}" immediate="true" />
```

Atau Ajax minimal:

```xhtml
<h:commandButton value="Cancel" action="#{caseBean.cancel}" immediate="true">
    <f:ajax execute="@this" />
</h:commandButton>
```

Namun untuk navigation cancel, full submit/redirect sering lebih jelas.

---

## 19. `listener` vs `action`

`listener` pada `f:ajax` cocok untuk behavior-level event.

```xhtml
<h:inputText value="#{bean.keyword}">
    <f:ajax listener="#{bean.onKeywordChanged}" render="suggestions" />
</h:inputText>
```

`action` pada command component cocok untuk application operation.

```xhtml
<h:commandButton value="Save" action="#{bean.save}">
    <f:ajax execute="@form" render="messages" />
</h:commandButton>
```

Heuristik:

| Intent | Gunakan |
|---|---|
| Field changed, update dependent UI | `f:ajax listener` |
| Button performs business operation | command `action` |
| Navigate | command `action` / outcome |
| Pure client-side behavior | JavaScript, bukan Faces listener |

Jangan memindahkan business operation besar ke Ajax listener hanya karena “bisa”.

---

## 20. `onevent` dan `onerror`

Faces Ajax menyediakan hook client-side.

```xhtml
<h:commandButton id="search" value="Search" action="#{bean.search}">
    <f:ajax execute="@form"
            render="results messages"
            onevent="caseSearchAjaxEvent"
            onerror="caseSearchAjaxError" />
</h:commandButton>
```

JavaScript:

```html
<script>
function caseSearchAjaxEvent(data) {
    if (data.status === 'begin') {
        document.body.classList.add('busy');
    }

    if (data.status === 'complete') {
        // Response received, DOM may not yet be fully updated.
    }

    if (data.status === 'success') {
        document.body.classList.remove('busy');
    }
}

function caseSearchAjaxError(data) {
    document.body.classList.remove('busy');
    console.error('Faces Ajax error', data);
}
</script>
```

Common use:

1. Disable button during request.
2. Show spinner.
3. Log client-side Ajax error.
4. Reinitialize client widgets after DOM patch.

Caution:

```text
Jangan menaruh business correctness di JavaScript callback.
Server tetap sumber kebenaran.
```

---

## 21. Loading State dan Double Click Protection

Ajax tidak otomatis membuat operation idempotent.

Jika user double click:

```text
request 1: approve case
request 2: approve case again
```

Server harus tetap aman.

Client-side disable membantu UX, bukan security.

```xhtml
<h:commandButton id="approve" value="Approve" action="#{caseBean.approve}">
    <f:ajax execute="@form"
            render="caseHeader actionPanel messages"
            onevent="disableDuringAjax" />
</h:commandButton>
```

Server-side tetap harus punya:

1. Optimistic locking.
2. State transition check.
3. Idempotency key untuk operasi tertentu.
4. Authorization re-check.
5. Audit trail tidak duplikatif.

Example service invariant:

```java
public void approve(long caseId, long version, User actor) {
    CaseAggregate c = repository.findForUpdate(caseId);

    authorization.requireCanApprove(actor, c);

    if (!c.isPendingApproval()) {
        throw new InvalidTransitionException("Case is no longer pending approval.");
    }

    c.approve(actor);
    repository.save(c);
}
```

---

## 22. Race Condition dan Out-of-Order Response

Misal user mengetik cepat:

```text
Request A: keyword = "a"
Request B: keyword = "ab"
Request C: keyword = "abc"
```

Jika response datang:

```text
C selesai dulu -> suggestions untuk "abc"
A selesai belakangan -> suggestions kembali menjadi "a"
```

Ini out-of-order response.

Faces Ajax tidak selalu menyelesaikan problem ini secara otomatis untuk semua pola high-frequency.

Mitigasi:

1. Jangan pakai Ajax per keypress untuk operation berat.
2. Gunakan debounce/throttle.
3. Gunakan component library autocomplete yang matang.
4. Gunakan request sequence number client-side.
5. Gunakan endpoint JSON khusus untuk search suggestion high-frequency.
6. Server-side limit dan cache.

Rule:

> Faces Ajax cocok untuk UI interaction yang discrete; untuk streaming/high-frequency interaction, pertimbangkan desain lain.

---

## 23. Conditional Rendering Pitfall

Contoh:

```xhtml
<h:panelGroup id="approvalPanel" rendered="#{caseBean.canApprove}">
    <h:commandButton value="Approve" action="#{caseBean.approve}">
        <f:ajax execute="@form" render="approvalPanel" />
    </h:commandButton>
</h:panelGroup>
```

Jika `canApprove` berubah dari `false` ke `true`, panel tidak ada di DOM dan mungkin tidak ada update target stabil.

Better:

```xhtml
<h:panelGroup id="approvalPanelWrapper" layout="block">
    <h:panelGroup id="approvalPanel" rendered="#{caseBean.canApprove}">
        <h:commandButton value="Approve" action="#{caseBean.approve}">
            <f:ajax execute="@form" render="approvalPanelWrapper messages" />
        </h:commandButton>
    </h:panelGroup>
</h:panelGroup>
```

Rule:

```text
Render wrapper yang selalu ada, bukan child conditional yang bisa hilang.
```

---

## 24. Ajax dalam `h:dataTable`

Contoh row select:

```xhtml
<h:form id="caseForm">
    <h:dataTable id="caseTable" value="#{caseListBean.rows}" var="row" rowIndexVar="i">
        <h:column>
            #{row.referenceNo}
        </h:column>

        <h:column>
            <h:commandLink id="select" value="Select" action="#{caseListBean.select(row.id)}">
                <f:ajax execute="@this" render=":caseForm:detailPanel :caseForm:messages" />
            </h:commandLink>
        </h:column>
    </h:dataTable>

    <h:messages id="messages" />

    <h:panelGroup id="detailPanel" layout="block">
        <ui:fragment rendered="#{not empty caseListBean.selectedCase}">
            <h2>#{caseListBean.selectedCase.referenceNo}</h2>
            <p>#{caseListBean.selectedCase.summary}</p>
        </ui:fragment>
    </h:panelGroup>
</h:form>
```

Perhatikan:

1. `execute="@this"` cukup karena row id dikirim via action expression/state component tree.
2. Render memakai absolute id untuk keluar dari table naming context.
3. Detail panel wrapper selalu ada.

Risiko data table Ajax:

1. Row index berubah antara render dan postback.
2. Sorting/filtering menyebabkan row object berbeda.
3. Lazy loading tidak stabil.
4. Entity langsung dipakai sebagai row value dan detach/stale.
5. Action expression menerima object besar bukan ID.

Untuk enterprise, lebih aman:

```java
public void select(long caseId) {
    selectedCase = caseQueryService.findDetail(caseId);
}
```

Bukan bergantung pada entity mutable di UI state.

---

## 25. Ajax dan View State

Ajax request tetap membawa view state.

Konsekuensi:

1. Session expired dapat menyebabkan `ViewExpiredException`.
2. Client-side state besar memperbesar payload Ajax.
3. Server-side state besar memperbesar session memory.
4. Partial rendering tidak berarti state kecil.
5. Dynamic component tree yang tidak stabil bisa merusak restore.

Contoh gejala:

```text
Ajax click tidak melakukan apa-apa setelah tab lama dibiarkan idle.
```

Kemungkinan:

1. Session expired.
2. View state expired.
3. Partial response berisi login page.
4. JavaScript parser gagal memproses response.

Production handling:

1. Buat exception handling khusus Ajax.
2. Jika view expired pada Ajax, kirim partial redirect ke login/page refresh.
3. Jangan membiarkan stack trace HTML kembali ke Ajax parser.

---

## 26. Session Timeout dan Ajax Redirect

Problem umum:

```text
User idle lama.
User klik Ajax button.
Server redirect ke login dengan HTML biasa.
Faces JavaScript mengharapkan partial XML.
Ajax error terjadi.
UI tidak jelas.
```

Solusi konseptual:

```text
Jika request adalah Faces partial request dan session/view expired,
response harus berupa partial response redirect atau error yang bisa dipahami client.
```

Contoh XML konseptual:

```xml
<partial-response>
    <redirect url="/login?expired=true" />
</partial-response>
```

Di aplikasi enterprise, pattern ini sering diimplementasikan lewat:

1. Custom exception handler Faces.
2. Servlet filter yang mengenali partial Ajax request.
3. Security integration yang partial-response aware.
4. Client-side `onerror` fallback.

---

## 27. Ajax dan Security

### 27.1 `rendered=false` bukan authorization

```xhtml
<h:commandButton value="Approve"
                 rendered="#{caseBean.canApprove}"
                 action="#{caseBean.approve}">
    <f:ajax execute="@form" render="actionPanel messages" />
</h:commandButton>
```

Ini hanya menyembunyikan button.

Service tetap wajib enforce:

```java
public void approve() {
    caseService.approve(caseId, currentUser);
}
```

Di service:

```java
authorization.requireCanApprove(currentUser, caseId);
```

### 27.2 Hidden field tampering tetap mungkin

Ajax tetap HTTP request. User bisa memodifikasi parameter.

Jangan percaya:

1. Hidden field ID.
2. Disabled field.
3. Rendered condition.
4. Select option value.
5. Client-side JavaScript validation.

### 27.3 CSRF

Faces form biasanya memiliki view state dan framework-level protections tergantung konfigurasi/runtime, tetapi jangan jadikan ini alasan mengabaikan CSRF model.

Untuk operasi state-changing:

1. Gunakan server-side authorization.
2. Gunakan CSRF/session protection dari stack yang dipakai.
3. Hindari GET untuk state-changing operation.
4. Perhatikan SameSite cookie.
5. Review integration dengan security framework.

### 27.4 XSS via partial rendering

Partial rendering tetap menghasilkan HTML.

Jika kamu render raw HTML:

```xhtml
<h:outputText value="#{bean.userHtml}" escape="false" />
```

Risikonya sama seperti full render, bahkan lebih licin karena update terjadi tanpa reload penuh.

Rule:

```text
Ajax tidak mengurangi kewajiban output encoding.
```

---

## 28. Ajax dan Performance

Ajax bisa membuat UI terasa lebih cepat, tetapi server-side work tetap ada.

Partial rendering hemat:

1. HTML response lebih kecil.
2. Browser tidak reload penuh.
3. User context lebih stabil.

Namun Ajax tetap bisa mahal karena:

1. Restore view tetap dilakukan.
2. Component tree tetap ada.
3. Selected components tetap decode/convert/validate/update.
4. Render target tetap menghasilkan HTML server-side.
5. View state tetap dikirim/diproses.
6. Banyak request kecil bisa lebih berat daripada satu request besar.

### 28.1 Anti-pattern: Ajax every keystroke to database

```xhtml
<h:inputText value="#{bean.keyword}">
    <f:ajax event="keyup" listener="#{bean.searchDb}" render="results" />
</h:inputText>
```

Risiko:

1. DB hammered.
2. Server thread pool penuh.
3. Out-of-order response.
4. UI flicker.
5. Expensive lifecycle per key.

Better:

1. Debounce.
2. Minimum 3 characters.
3. Limit results.
4. Cache suggestions.
5. Dedicated endpoint if needed.
6. Component library autocomplete.

### 28.2 Render target terlalu besar

```xhtml
<f:ajax execute="@this" render="@form" />
```

Kadang mudah, tapi mahal.

Lebih spesifik:

```xhtml
<f:ajax execute="@this" render="dependentPanel messages" />
```

### 28.3 Getter mahal

Render partial tetap memanggil getter pada render target.

Buruk:

```java
public List<CaseRow> getRows() {
    return caseService.search(keyword); // dipanggil saat render
}
```

Baik:

```java
public void search() {
    rows = caseService.search(criteria);
}

public List<CaseRow> getRows() {
    return rows;
}
```

---

## 29. Ajax Observability

Untuk production-grade Faces app, Ajax harus observable.

Log minimal:

1. Request URI.
2. Whether partial Ajax request.
3. Ajax source component id.
4. Execute ids.
5. Render ids.
6. View id.
7. User/session correlation id.
8. Duration.
9. Validation failed or not.
10. Exception type.

Contoh servlet filter pseudo-code:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
    HttpServletRequest request = (HttpServletRequest) req;

    boolean ajax = "true".equals(request.getParameter("jakarta.faces.partial.ajax"))
            || "true".equals(request.getParameter("javax.faces.partial.ajax"));

    String source = firstNonNull(
            request.getParameter("jakarta.faces.source"),
            request.getParameter("javax.faces.source")
    );

    long start = System.nanoTime();
    try {
        chain.doFilter(req, res);
    } finally {
        long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
        log.info("facesAjax={}, source={}, uri={}, elapsedMs={}",
                ajax, source, request.getRequestURI(), elapsedMs);
    }
}
```

Untuk Java 8 compatibility, hindari API modern jika codebase legacy belum naik.

---

## 30. Debugging Playbook

### 30.1 Action/listener tidak terpanggil

Cek:

1. Apakah command/input ada dalam `h:form`?
2. Apakah source component masuk dalam `execute`?
3. Apakah ada validation failure di component lain yang ikut `execute`?
4. Apakah `immediate` mengubah phase?
5. Apakah button disabled/rendered false?
6. Apakah JavaScript error sebelum request terkirim?
7. Apakah request Ajax benar-benar sampai server?
8. Apakah method signature benar?

### 30.2 Model tidak berubah

Cek:

1. Input masuk `execute`?
2. Converter sukses?
3. Validator sukses?
4. Bean scope benar?
5. Setter dipanggil?
6. Value expression menunjuk property yang benar?
7. Apakah kamu membaca old value sebelum Update Model Values?

### 30.3 Message tidak muncul

Cek:

1. Ada `h:messages`/`h:message`?
2. Message component masuk `render`?
3. Message `for` cocok dengan component id?
4. Message global atau field-specific?
5. Component message berada di naming container berbeda?

### 30.4 Component tidak update

Cek:

1. Render id benar?
2. Perlu absolute id `:form:panel`?
3. Target punya DOM element stabil?
4. Target conditional `rendered=false`?
5. Ada duplicate id?
6. Partial response valid?
7. JavaScript error saat DOM patch?

### 30.5 Ajax error setelah session timeout

Cek:

1. Response network tab HTML login page atau partial XML?
2. Ada `ViewExpiredException`?
3. Security filter aware terhadap partial request?
4. Exception handler mengirim partial redirect?

### 30.6 Data table row salah

Cek:

1. Row index berubah?
2. List di getter regenerate tiap render?
3. Sorting/filtering berubah sebelum postback?
4. Action memakai object row mutable?
5. Gunakan ID stabil?

---

## 31. Design Pattern: Ajax Region

Untuk halaman enterprise besar, desain interaksi sebagai region.

```text
Page
 ├── Filter Region
 │    ├── form fields
 │    ├── search button
 │    └── filter messages
 │
 ├── Result Region
 │    ├── table
 │    ├── pagination
 │    └── selection action
 │
 ├── Detail Region
 │    ├── selected case summary
 │    ├── action panel
 │    └── timeline
 │
 └── Global Message Region
```

Setiap Ajax operation harus jelas:

| Operation | Execute | Render |
|---|---|---|
| Search | filter fields + search button | result region + messages |
| Select row | selected row action | detail region + action panel |
| Change agency | agency field | officer field + message |
| Save draft | edit form | messages + header + action panel |
| Approve | workflow form | header + action panel + timeline + messages |

Ini jauh lebih maintainable daripada:

```xhtml
<f:ajax execute="@form" render="@form" />
```

pada semua tombol.

---

## 32. Enterprise Case Example: Assignment Panel

### 32.1 Requirement

Dalam regulatory case management:

1. User memilih agency.
2. Officer dropdown berubah sesuai agency.
3. User memilih officer.
4. User klik assign.
5. Case status/action panel/timeline/messages berubah.
6. Action harus aman dari stale status dan unauthorized assignment.

### 32.2 View

```xhtml
<h:form id="assignmentForm">

    <h:messages id="messages" globalOnly="false" />

    <h:panelGroup id="assignmentPanel" layout="block">

        <h:outputLabel for="agency" value="Agency" />
        <h:selectOneMenu id="agency"
                         value="#{assignmentBean.agencyId}"
                         required="true">
            <f:selectItem itemValue="" itemLabel="-- Select Agency --" />
            <f:selectItems value="#{assignmentBean.agencies}"
                           var="agency"
                           itemValue="#{agency.id}"
                           itemLabel="#{agency.name}" />

            <f:ajax event="change"
                    execute="@this"
                    listener="#{assignmentBean.onAgencyChanged}"
                    render="officer officerMessage messages" />
        </h:selectOneMenu>
        <h:message id="agencyMessage" for="agency" />

        <h:outputLabel for="officer" value="Officer" />
        <h:selectOneMenu id="officer"
                         value="#{assignmentBean.officerId}"
                         required="true">
            <f:selectItem itemValue="" itemLabel="-- Select Officer --" />
            <f:selectItems value="#{assignmentBean.officers}"
                           var="officer"
                           itemValue="#{officer.id}"
                           itemLabel="#{officer.name}" />
        </h:selectOneMenu>
        <h:message id="officerMessage" for="officer" />

        <h:commandButton id="assign" value="Assign" action="#{assignmentBean.assign}">
            <f:ajax execute="agency officer assign"
                    render="assignmentPanel messages :caseHeaderForm:caseHeader :actionForm:actionPanel :timelineForm:timeline" />
        </h:commandButton>

    </h:panelGroup>
</h:form>
```

### 32.3 Bean

```java
@Named
@ViewScoped
public class AssignmentBean implements Serializable {

    private Long caseId;
    private Long caseVersion;
    private Long agencyId;
    private Long officerId;

    private List<AgencyOption> agencies = List.of();
    private List<OfficerOption> officers = List.of();

    @Inject
    private AssignmentService assignmentService;

    @Inject
    private CurrentUser currentUser;

    public void onAgencyChanged() {
        officerId = null;

        if (agencyId == null) {
            officers = List.of();
            return;
        }

        officers = assignmentService.findAssignableOfficers(caseId, agencyId, currentUser.id());
    }

    public void assign() {
        AssignmentCommand command = new AssignmentCommand(
                caseId,
                caseVersion,
                agencyId,
                officerId,
                currentUser.id()
        );

        assignmentService.assign(command);

        FacesContext.getCurrentInstance().addMessage(null,
                new FacesMessage(FacesMessage.SEVERITY_INFO,
                        "Case assigned successfully.", null));
    }
}
```

### 32.4 Service invariant

```java
public void assign(AssignmentCommand command) {
    CaseAggregate c = caseRepository.findForUpdate(command.caseId());

    authorization.requireCanAssign(command.actorId(), c);

    if (!Objects.equals(c.version(), command.caseVersion())) {
        throw new StaleCaseException("Case was modified by another user.");
    }

    Officer officer = officerRepository.find(command.officerId());

    if (!officer.belongsToAgency(command.agencyId())) {
        throw new InvalidAssignmentException("Officer does not belong to selected agency.");
    }

    c.assignTo(officer, command.actorId());
    caseRepository.save(c);
    audit.recordAssignment(c.id(), officer.id(), command.actorId());
}
```

Key point:

```text
Ajax improves UX. Service invariants preserve correctness.
```

---

## 33. Ajax dan Accessibility

Partial update bisa membingungkan screen reader jika tidak dikelola.

Pertimbangkan:

1. Gunakan region dengan semantic markup.
2. Untuk pesan, gunakan ARIA live region.
3. Pastikan focus management setelah update.
4. Jangan hanya mengandalkan color/spinner.
5. Error messages harus terkait dengan input.
6. Button disabled harus punya feedback.

Contoh:

```xhtml
<h:panelGroup id="messagesPanel" layout="block" pt:aria-live="polite">
    <h:messages id="messages" />
</h:panelGroup>
```

Jika update mengganti area besar, pikirkan:

```text
Setelah Ajax success, focus user berada di mana?
Apakah user tahu apa yang berubah?
```

---

## 34. Ajax dan JavaScript Integration

Faces mengelola DOM patch. Jika kamu memakai custom JavaScript/widget, DOM yang di-render ulang bisa kehilangan initialization.

Contoh:

```xhtml
<h:panelGroup id="datePanel">
    <h:inputText id="date" value="#{bean.date}" styleClass="date-picker" />
</h:panelGroup>

<h:commandButton value="Refresh Date">
    <f:ajax render="datePanel" onevent="afterDatePanelUpdate" />
</h:commandButton>
```

JavaScript:

```html
<script>
function afterDatePanelUpdate(data) {
    if (data.status === 'success') {
        initDatePickers();
    }
}
</script>
```

Rule:

```text
Jika Ajax mengganti DOM yang punya JS widget, reinitialize widget setelah success.
```

Tapi jangan duplikasi event listener berulang tanpa cleanup.

---

## 35. Ajax dengan Composite Components

Composite component sering menjadi naming container.

Misal:

```xhtml
<my:caseActionPanel id="actions" value="#{caseBean.caseView}" />
```

Di dalam component:

```xhtml
<composite:implementation>
    <h:panelGroup id="root" layout="block">
        <h:commandButton id="approve" value="Approve" action="#{cc.attrs.onApprove}">
            <f:ajax execute="@this" render="root messages" />
        </h:commandButton>

        <h:messages id="messages" />
    </h:panelGroup>
</composite:implementation>
```

Masalah sering muncul saat ingin render target di luar composite component.

Gunakan desain attribute untuk render targets:

```xhtml
<composite:interface>
    <composite:attribute name="onApprove" method-signature="java.lang.String action()" />
    <composite:attribute name="renderTargets" required="false" />
</composite:interface>

<composite:implementation>
    <h:commandButton id="approve" value="Approve" action="#{cc.attrs.onApprove}">
        <f:ajax execute="@this" render="#{cc.attrs.renderTargets}" />
    </h:commandButton>
</composite:implementation>
```

Usage:

```xhtml
<my:caseActionPanel id="actions"
                    onApprove="#{caseBean.approve}"
                    renderTargets=":caseForm:header :caseForm:timeline :caseForm:messages" />
```

Namun jangan over-engineer. Jika component harus tahu terlalu banyak target eksternal, mungkin abstraction boundary salah.

---

## 36. Ajax dan Exception Handling

Faces Ajax exception berbeda dari full page exception.

Full page error:

```text
Server returns error page HTML.
```

Ajax error expected by client:

```text
Server returns partial response error/redirect/update.
```

Praktik enterprise:

1. Business validation exception -> show FacesMessage.
2. Authorization exception -> partial redirect atau message + action panel refresh.
3. View expired -> partial redirect to refresh/login.
4. Unexpected exception -> generic error message + correlation id.
5. Never return stack trace in partial response.

Pseudo-handler:

```java
try {
    operation.run();
} catch (BusinessException e) {
    facesMessages.error(e.userMessage());
} catch (AccessDeniedException e) {
    facesMessages.error("You are no longer allowed to perform this action.");
    refreshActionPanel();
} catch (Exception e) {
    String correlationId = errorLogger.log(e);
    facesMessages.error("Unexpected error. Reference: " + correlationId);
}
```

For deep framework handling, use Faces `ExceptionHandler` extension point, but keep user-facing message discipline clear.

---

## 37. Ajax and PRG

POST-Redirect-GET reduces duplicate form submission and gives bookmarkable final state.

Ajax partial update does not naturally do PRG.

For operations like:

1. Save draft.
2. Inline update.
3. Dependent dropdown.

Ajax is fine.

For operations like:

1. Create new case.
2. Submit application.
3. Approve final workflow transition.
4. Payment-like operation.

Consider full POST + redirect.

Why?

1. Browser URL reflects state.
2. Refresh behavior safer.
3. Back button clearer.
4. Duplicate submit easier to handle.
5. Audit boundary clearer.

Ajax can still be used for confirmation dialogs or pre-validation, but final commit may use full request.

---

## 38. Ajax and Long-Running Operations

Do not hold Ajax request for very long operation unless acceptable.

Bad:

```text
User clicks Generate Report.
Ajax request waits 2 minutes.
```

Problems:

1. Request timeout.
2. UI uncertainty.
3. Server thread occupied.
4. Reverse proxy timeout.
5. Retry duplicates.

Better:

1. Submit job.
2. Return job id.
3. Poll status or use push/WebSocket/SSE depending stack.
4. Allow download when ready.

Faces Ajax can update job status panel:

```text
Start job -> render job panel -> periodic poll/push update
```

But job execution should be backend workload, not view request thread.

---

## 39. Java 8 sampai Java 25 Implications

### 39.1 Java 8 legacy

Common stack:

1. JSF 2.2/2.3.
2. Java EE 7/8.
3. `javax.faces.*`.
4. Older component libraries.
5. Older Servlet API.

Risiko:

1. Library old Ajax bugs.
2. Browser compatibility assumptions.
3. Legacy `jsf.js` path.
4. Weak CSP readiness.
5. Old security defaults.

### 39.2 Java 11/17 modernization

Common transition:

1. Jakarta EE 8 masih `javax.*`.
2. Java runtime naik dulu.
3. Container/library compatibility dicek.
4. Build plugin dan bytecode level disesuaikan.

### 39.3 Java 21/25 modern Jakarta

Common target:

1. Jakarta EE 10/11+.
2. `jakarta.faces.*`.
3. CDI-first bean model.
4. Better alignment with modern platform.
5. SecurityManager assumptions removed in modern Jakarta specs.

Faces Ajax concept tetap sama, tetapi package, dependencies, container, dan library compatibility berubah.

Migration checklist:

1. `javax.faces.*` -> `jakarta.faces.*`.
2. `javax.el.*` -> `jakarta.el.*`.
3. `javax.servlet.*` -> `jakarta.servlet.*`.
4. Update component library to Jakarta-compatible version.
5. Validate Ajax behavior in all custom components.
6. Test partial response after session timeout.
7. Test `f:ajax` render targets after namespace migration.
8. Test JavaScript integration after DOM ids possibly unchanged but resources changed.

---

## 40. Review Checklist

Sebelum approve PR yang menambahkan Faces Ajax, cek:

### Correctness

- [ ] Apakah `execute` hanya mencakup input yang diperlukan?
- [ ] Apakah source component masuk `execute`?
- [ ] Apakah `render` mencakup messages?
- [ ] Apakah `render` mencakup semua area yang berubah?
- [ ] Apakah render target punya DOM wrapper stabil?
- [ ] Apakah action/listener berada di phase yang tepat?
- [ ] Apakah validation failure behavior benar?

### State

- [ ] Apakah bean scope tepat?
- [ ] Apakah data table row stabil?
- [ ] Apakah view state tidak terlalu besar?
- [ ] Apakah multi-tab behavior dipertimbangkan?
- [ ] Apakah stale version/optimistic locking dipakai untuk workflow action?

### Security

- [ ] Apakah authorization enforced di service?
- [ ] Apakah hidden/select value divalidasi server-side?
- [ ] Apakah raw HTML tidak dirender sembarangan?
- [ ] Apakah CSRF/session model aman?
- [ ] Apakah session timeout Ajax ditangani?

### UX

- [ ] Apakah loading state jelas?
- [ ] Apakah double click dikendalikan client dan server?
- [ ] Apakah focus/accessibility diperhatikan?
- [ ] Apakah user melihat message saat gagal?
- [ ] Apakah long-running operation tidak dipaksa sinkron?

### Performance

- [ ] Apakah event terlalu frequent?
- [ ] Apakah render target terlalu besar?
- [ ] Apakah getter render-path murah?
- [ ] Apakah DB/service call tidak terjadi berulang saat render?
- [ ] Apakah Ajax request observable di log/metrics?

---

## 41. Ringkasan Mental Model

Faces Ajax adalah:

```text
partial lifecycle + partial render + DOM patch
```

Bukan:

```text
simple JavaScript fetch
```

Tiga pertanyaan utama:

```text
1. Apa yang memicu request?
2. Komponen mana yang harus diproses?   -> execute
3. Komponen mana yang harus digambar ulang? -> render
```

Failure mode utama biasanya berasal dari:

1. `execute` terlalu kecil.
2. `execute` terlalu besar.
3. `render` tidak mencakup messages.
4. Render target tidak punya DOM wrapper stabil.
5. Naming container/client id salah.
6. Validation memblokir action.
7. Bean scope salah.
8. View state expired.
9. Data table row tidak stabil.
10. Service invariants tidak enforce correctness.

Engineer top-tier tidak memakai Ajax hanya untuk membuat halaman terasa modern. Engineer top-tier memakai Ajax untuk mengurangi friction UI sambil tetap menjaga:

1. lifecycle correctness,
2. state consistency,
3. authorization,
4. idempotency,
5. performance,
6. observability,
7. accessibility,
8. migration safety.

---

## 42. Kapan Tidak Menggunakan Faces Ajax

Jangan otomatis memakai Faces Ajax untuk semua hal.

Hindari atau pikir ulang jika:

1. Operation final dan harus jelas PRG.
2. Request sangat sering seperti typeahead per keypress tanpa debounce.
3. Long-running backend task.
4. UI butuh offline-first behavior.
5. Client-side state sangat kompleks.
6. Frontend sudah SPA-heavy dan endpoint JSON lebih cocok.
7. Component tree terlalu besar dan view state mahal.
8. Security/session timeout handling belum siap.

Gunakan Faces Ajax saat:

1. Partial update natural.
2. Interaction discrete.
3. Server-side view state masih manageable.
4. Component tree dan render target jelas.
5. Operation tetap bisa dijaga correctness-nya di service layer.

---

## 43. Jembatan ke Part Berikutnya

Part ini membahas Ajax dan partial rendering sebagai mekanisme interaksi dinamis.

Part berikutnya akan membahas:

```text
23-composite-components-and-reusable-ui-architecture.md
```

Kita akan masuk lebih dalam ke bagaimana membangun reusable UI architecture di Faces melalui composite components:

1. `/resources` structure,
2. `composite:interface`,
3. `composite:implementation`,
4. attributes,
5. method expressions,
6. facets,
7. naming containers,
8. reusable form controls,
9. design system internal,
10. testing dan versioning component.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Faces State Management: Server State, Client State, View Expiry, and Memory](./21-faces-state-management-server-client-view-expiry-memory.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Composite Components and Reusable UI Architecture](./23-composite-components-and-reusable-ui-architecture.md)
