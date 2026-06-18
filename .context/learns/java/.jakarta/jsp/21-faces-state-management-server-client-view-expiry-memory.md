# Part 21 — Faces State Management: Server State, Client State, View Expiry, and Memory

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `21-faces-state-management-server-client-view-expiry-memory.md`  
> Fokus: memahami Jakarta Faces state saving sebagai mekanisme pemulihan component tree antar request, serta dampaknya terhadap memory, security, clustering, multi-tab, dan operasional production.

---

## 1. Kenapa State Management di Faces Sangat Penting

Di banyak framework web request-based tradisional, server menerima request, membuat response HTML, lalu selesai. Pada request berikutnya, server memproses ulang berdasarkan parameter request, session, dan database.

Jakarta Faces berbeda. Faces membangun UI sebagai **component tree**. Halaman bukan hanya string HTML, tetapi graph object server-side yang berisi komponen seperti form, input, table, message, validator, converter, listener, metadata, dan binding.

Karena browser hanya menerima HTML, maka setelah render selesai component tree di server tidak bisa dianggap selalu hidup untuk request berikutnya. Namun saat user melakukan postback, Faces perlu tahu:

1. halaman mana yang dipostback,
2. struktur component tree seperti apa yang menerima input,
3. komponen mana yang punya submitted value,
4. converter dan validator apa yang harus dijalankan,
5. action mana yang harus dipanggil,
6. message/component state apa yang harus dipulihkan,
7. apakah request ini valid terhadap view yang pernah dirender.

Itulah fungsi **state management**.

Mental model sederhana:

```text
Initial GET
  -> build component tree from Facelets
  -> bind component attributes to EL/backing bean
  -> render HTML + hidden view state token
  -> save enough state to restore/rebuild view later

POSTBACK
  -> receive form parameters + view state token
  -> restore/rebuild component tree
  -> apply submitted values
  -> convert/validate
  -> update model
  -> invoke action
  -> render new HTML + new view state
```

Tanpa state saving, postback Faces tidak punya konteks yang cukup untuk memetakan request browser kembali ke component tree server-side.

---

## 2. Apa yang Dimaksud “State” di Faces?

State dalam Faces bukan hanya session attribute. Ada beberapa lapisan state yang sering tercampur dalam diskusi:

| Jenis state | Contoh | Disimpan di mana | Tujuan |
|---|---|---|---|
| Component tree structure | `UIViewRoot`, `UIForm`, `UIInput`, `UIData` | direbuild dari Facelets + restored state | mengetahui struktur UI |
| Component local state | submitted value, local value, valid flag, expanded/collapsed state | Faces view state | memulihkan kondisi komponen |
| Backing bean state | field dalam `@ViewScoped` bean | CDI/Faces scope, biasanya session-backed | menyimpan state layar |
| Session state | current user, permissions, wizard context | HTTP session | state lintas halaman/request |
| Domain state | case status, assigned officer, version | database | source of truth bisnis |
| Client/browser state | form fields, hidden inputs, URL params | browser/request | input user dan request context |

Kesalahan umum adalah menyebut semuanya “session”. Padahal problem state Faces bisa berasal dari:

- view state terlalu besar,
- `@ViewScoped` bean terlalu gemuk,
- session terlalu banyak menyimpan view,
- dynamic component tree tidak deterministik,
- client-side state tidak terenkripsi/ditandatangani dengan benar,
- stale browser tab mengirim view state lama,
- postback terjadi setelah session expired,
- cluster node tidak memiliki state yang sama.

Untuk engineer senior, pertanyaan yang lebih tepat bukan “kenapa JSF pakai session?”, tetapi:

> State apa yang perlu bertahan, sampai kapan, atas dasar identitas apa, dan siapa source of truth-nya?

---

## 3. Component Tree dan View State

Setiap Faces view punya root bernama `UIViewRoot`. Di bawahnya ada children seperti form, input, command button, table, panel, message, composite component, dan sebagainya.

Contoh Facelets:

```xml
<h:form id="caseForm">
    <h:inputText id="title" value="#{caseEditBean.form.title}" required="true" />
    <h:message for="title" />

    <h:commandButton value="Save" action="#{caseEditBean.save}" />
</h:form>
```

Secara mental, Faces melihatnya seperti:

```text
UIViewRoot /case-edit.xhtml
└── HtmlForm id=caseForm
    ├── HtmlInputText id=title
    │   ├── valueExpression -> caseEditBean.form.title
    │   ├── required=true
    │   └── local/submitted/valid state
    ├── HtmlMessage for=title
    └── HtmlCommandButton
        └── actionExpression -> caseEditBean.save()
```

Saat halaman dirender, browser menerima kira-kira:

```html
<form id="caseForm" method="post" action="/case-edit.xhtml">
  <input id="caseForm:title" name="caseForm:title" type="text" value="...">
  <input type="hidden" name="jakarta.faces.ViewState" value="...">
  <input type="submit" name="caseForm:j_id..." value="Save">
</form>
```

Field `jakarta.faces.ViewState` adalah penghubung antara browser dan state Faces.

Pada postback, Faces memakai token ini untuk restore view.

---

## 4. Initial Request vs Postback dari Perspektif State

### 4.1 Initial request

Initial request biasanya GET pertama ke halaman.

```text
Browser GET /case-edit.xhtml?id=CASE-1001
  -> Faces builds view from Facelets
  -> f:viewParam loads id
  -> f:viewAction loads form data
  -> render response
  -> save view state
```

Pada tahap ini belum ada submitted value dari user. State yang penting adalah struktur view dan initial component state.

### 4.2 Postback

Postback biasanya terjadi ketika form Faces disubmit.

```text
Browser POST /case-edit.xhtml
  params:
    caseForm:title = "Updated title"
    jakarta.faces.ViewState = "abc123..."

Faces:
  -> restore/rebuild view
  -> match submitted values to component client ids
  -> convert/validate
  -> update backing bean
  -> invoke action
  -> render response
  -> save new view state
```

Jika view state hilang atau tidak valid, Faces tidak bisa memulihkan konteks postback dengan aman.

---

## 5. `StateManager`: Peran dan Tanggung Jawab

Dalam Jakarta Faces, `StateManager` adalah abstraction yang mengarahkan proses menyimpan dan memulihkan view antar request. Secara API, ia bertanggung jawab pada proses save/restore view state, dan implementasinya harus thread-safe.

Secara praktis, engineer jarang membuat `StateManager` sendiri. Yang penting adalah memahami konsekuensinya:

1. state perlu disimpan pada akhir render,
2. state perlu dipulihkan sebelum lifecycle postback,
3. strategi penyimpanan dapat berbeda antara server-side dan client-side,
4. konfigurasi container/implementation dapat mengubah behavior,
5. state yang terlalu besar memukul memory, network, CPU, dan clustering.

---

## 6. Server-Side State Saving

Pada server-side state saving, browser biasanya hanya menyimpan token kecil. State sesungguhnya disimpan di server, sering kali terkait dengan HTTP session.

Mental model:

```text
Browser hidden field:
  jakarta.faces.ViewState = "server-token-123"

Server session:
  token-123 -> serialized/restorable view state
```

### 6.1 Keuntungan

1. HTML response lebih kecil dibanding client-side state besar.
2. Sensitive component state tidak langsung dikirim ke browser.
3. Bisa lebih mudah mengontrol integrity karena state berada di server.
4. Cocok untuk halaman kompleks dengan banyak komponen.

### 6.2 Kerugian

1. Memakai memory server/session.
2. Membutuhkan strategi clustering jika multi-node.
3. Berisiko session bloat.
4. Browser multi-tab dapat membuat banyak view tersimpan.
5. Session timeout menyebabkan view state hilang.
6. Rolling restart dapat membuat state hilang jika tidak direplikasi/persisted.

### 6.3 Kapan cocok

Server-side state saving cocok jika:

- aplikasi intranet/enterprise dengan session-based login,
- halaman kompleks dengan banyak komponen,
- payload browser harus kecil,
- security lebih mudah dikontrol di server,
- deployment memakai sticky session atau session replication yang dipahami.

### 6.4 Risiko utama

Risiko paling besar adalah **memory pressure**.

```text
users aktif
  x tabs per user
  x views per session
  x size per view
  = total memory pressure
```

Contoh kasar:

```text
2.000 active users
x 4 tabs/views per user
x 250 KB state per view
= 2.000.000 KB
= ~1.9 GB raw view state
```

Ini belum termasuk object overhead, session metadata, CDI view scoped beans, cache, thread stacks, dan heap fragmentation.

---

## 7. Client-Side State Saving

Pada client-side state saving, state lebih banyak disimpan dalam hidden field yang dikirim ke browser dan kembali pada postback.

Mental model:

```text
Browser hidden field:
  jakarta.faces.ViewState = "large-encoded-state-payload..."

Server:
  decodes/verifies/restores state from submitted payload
```

### 7.1 Keuntungan

1. Mengurangi memory server untuk view state.
2. Lebih mudah untuk stateless-ish horizontal scaling.
3. Tidak terlalu bergantung pada session replication untuk view state.
4. Bisa cocok untuk deployment multi-node dengan session minimal.

### 7.2 Kerugian

1. HTML payload membesar.
2. Setiap postback mengirim state bolak-balik.
3. CPU cost untuk encode/decode/sign/encrypt bisa naik.
4. Security sangat bergantung pada signing/encryption implementation dan key management.
5. Sensitive data bisa berisiko jika masuk ke view state dan proteksi lemah.
6. View state dapat invalid setelah restart jika key berubah.

### 7.3 Kapan cocok

Client-side state saving cocok jika:

- view state relatif kecil,
- deployment multi-node ingin mengurangi session replication,
- network payload masih acceptable,
- state protection kuat,
- key management stabil antar node/restart,
- sensitive data tidak disimpan di component state.

### 7.4 Risiko utama

Risiko paling besar adalah **menganggap client-side state berarti aman/stateless otomatis**.

Client-side state tetap bisa membawa:

- informasi internal,
- struktur component tree,
- nilai lokal komponen,
- metadata UI,
- data yang tidak sengaja ikut tersimpan.

Karena dikirim ke browser, perlakukan sebagai **exposed transport surface**, walaupun sudah encoded/encrypted/signed.

---

## 8. Konfigurasi State Saving Method

Secara tradisional, state saving method dikonfigurasi melalui context parameter:

```xml
<context-param>
    <param-name>jakarta.faces.STATE_SAVING_METHOD</param-name>
    <param-value>server</param-value>
</context-param>
```

atau:

```xml
<context-param>
    <param-name>jakarta.faces.STATE_SAVING_METHOD</param-name>
    <param-value>client</param-value>
</context-param>
```

Pada aplikasi lama sebelum namespace Jakarta, nama param historis yang sering terlihat adalah:

```xml
<context-param>
    <param-name>javax.faces.STATE_SAVING_METHOD</param-name>
    <param-value>server</param-value>
</context-param>
```

Dalam migrasi `javax.*` ke `jakarta.*`, cek dokumentasi implementation/container yang dipakai karena beberapa vendor mungkin masih mendukung alias legacy untuk compatibility, tetapi jangan mengandalkannya sebagai strategi jangka panjang.

---

## 9. Full State Saving vs Partial State Saving

### 9.1 Full state saving

Full state saving menyimpan state view secara lebih menyeluruh. Ini historis dan lebih mahal.

Problem:

- state lebih besar,
- memory lebih tinggi,
- serialization cost lebih tinggi,
- restore lebih berat,
- kurang cocok untuk halaman kompleks modern.

### 9.2 Partial state saving

Partial state saving menyimpan perubahan/delta yang diperlukan terhadap initial component tree. Ini menjadi mode modern yang lebih efisien.

Mental model:

```text
Facelets template defines baseline tree
Runtime stores only differences/state needed to restore behavior
```

Keuntungannya:

- state lebih kecil,
- restore lebih efisien,
- memory/network lebih rendah.

Namun ada trade-off:

- dynamic component tree harus deterministic,
- komponen yang dibuat programmatically harus dibuat ulang pada waktu yang benar,
- id komponen harus stabil,
- conditional rendering harus tidak membuat tree berubah secara tidak terduga pada postback.

### 9.3 Kesimpulan praktis

Untuk aplikasi modern, desainlah halaman agar compatible dengan partial state saving:

1. hindari dynamic component tree liar,
2. gunakan stable component id,
3. jangan membuat komponen berdasarkan data yang berubah antara render dan postback tanpa guard,
4. jangan menyimpan object besar dalam component attribute,
5. pisahkan view model dari domain entity.

---

## 10. `ViewExpiredException`

`ViewExpiredException` terjadi ketika Faces gagal restore view pada postback. Ini bukan sekadar “session timeout”, walaupun session timeout adalah penyebab umum.

Penyebab umum:

1. session expired,
2. server restart,
3. rolling deployment tanpa session/state continuity,
4. user submit tab lama,
5. server-side view state sudah evicted,
6. client-side state key berubah,
7. load balancer mengirim postback ke node yang tidak punya state,
8. state token rusak/terpotong,
9. form HTML di-cache lalu dipostback setelah state tidak ada,
10. dynamic view id atau navigation tidak konsisten.

### 10.1 Mental model kejadian

```text
User membuka /case-edit.xhtml
  -> server menyimpan view state token A

User idle 40 menit
  -> session expired / view evicted

User klik Save
  -> browser mengirim token A
  -> server mencari state A
  -> tidak ditemukan
  -> ViewExpiredException
```

### 10.2 Salah kaprah

Salah kaprah umum:

> “Naikkan session timeout saja.”

Itu hanya menunda masalah. Solusi yang lebih matang adalah:

1. user-friendly session expired page,
2. redirect ke halaman GET yang bisa rebuild state,
3. autosave/draft untuk form panjang,
4. warning sebelum session expired,
5. PRG untuk action sukses,
6. stable state saving strategy,
7. load balancer/session config benar,
8. avoid long-lived edit screens without refresh strategy.

### 10.3 Handling yang baik

Untuk halaman enterprise, perlakukan `ViewExpiredException` sebagai UX state failure:

```text
Postback failed because view context is gone.
System should not blindly retry mutation.
System should guide user to reload/reopen with safe GET.
```

Untuk operasi mutasi penting, jangan otomatis mengulang action dari submitted stale state.

---

## 11. Multi-Tab Problem

Faces state management sering bertemu problem multi-tab.

Skenario:

```text
Tab A: user membuka case CASE-1001 edit page
Tab B: user membuka case CASE-1002 edit page

Bean/session/state salah didesain:
  currentCaseId disimpan di @SessionScoped bean

Tab A submit Save
  session currentCaseId sudah CASE-1002
  action update case yang salah
```

Ini bukan bug Faces semata. Ini bug **state identity**.

### 11.1 Prinsip desain multi-tab aman

1. Jangan simpan “current entity being edited” di session global jika halaman bisa dibuka multi-tab.
2. Gunakan `@ViewScoped` untuk state layar spesifik view.
3. Sertakan id resource di URL/view parameter.
4. Pada submit, validasi bahwa action ditujukan ke resource yang sama.
5. Gunakan optimistic locking/version field.
6. Jangan mengandalkan session field sebagai source of truth action target.

### 11.2 Form model yang lebih aman

```java
@Named
@ViewScoped
public class CaseEditBean implements Serializable {

    private Long caseId;
    private Long version;
    private CaseEditForm form;

    public void load() {
        CaseDto dto = caseService.getEditableCase(caseId);
        this.version = dto.version();
        this.form = CaseEditForm.from(dto);
    }

    public String save() {
        caseService.updateCase(caseId, version, form.toCommand());
        return "case-detail?faces-redirect=true&caseId=" + caseId;
    }
}
```

Action target berasal dari view-specific state, bukan session global mutable field.

---

## 12. `@ViewScoped` dan Hubungannya dengan View State

`@ViewScoped` sering dipakai untuk state halaman yang harus bertahan antar Ajax/postback selama user berada di view yang sama.

Contoh state yang cocok:

- filter table pada halaman listing,
- form edit sementara,
- selected rows,
- wizard step ringan,
- expanded panel state,
- transient UI command context.

Contoh state yang tidak cocok:

- cache besar seluruh domain graph,
- file besar,
- data ribuan row,
- service dependency non-serializable yang disimpan manual,
- entity JPA managed yang melewati transaction boundary,
- security principal sebagai copy mutable.

### 12.1 View scope bukan database

`@ViewScoped` bukan tempat menyimpan source of truth. Ia hanya state interaksi UI.

```text
Database: truth
Service: rule enforcement
ViewScoped bean: temporary screen state
Component state: UI lifecycle state
Browser: submitted input
```

### 12.2 Serialization discipline

Karena view scoped bean dapat disimpan dalam session/state mechanism, biasakan:

1. implement `Serializable`,
2. field service/CDI injection tidak perlu diserialisasi manual oleh Anda jika container mengelolanya, tetapi hindari menyimpan object runtime berat,
3. simpan id, DTO kecil, form model, enum, primitive,
4. jangan simpan `EntityManager`, `Connection`, `InputStream`, `Thread`, `Executor`, atau object request/container.

---

## 13. Session Memory Pressure

State Faces sering memperbesar session.

Sumber session growth:

1. server-side view state,
2. `@ViewScoped` beans,
3. `@SessionScoped` beans,
4. component library state seperti table filters/sorting/selection,
5. uploaded file temporary metadata,
6. flash messages yang tidak dibersihkan,
7. wizard state,
8. cached dropdown/reference data per user,
9. permission/menu tree per session,
10. multiple browser tabs.

### 13.1 Estimasi kasar

Gunakan model estimasi:

```text
session_size_per_user =
  authentication_context
+ permissions/menu_state
+ active_view_count * avg_view_state_size
+ active_view_count * avg_view_scoped_bean_size
+ misc_session_features
```

Lalu:

```text
total_heap_pressure = active_sessions * session_size_per_user * overhead_factor
```

Overhead factor bisa signifikan karena object graph Java tidak sama dengan serialized byte size.

### 13.2 Red flags

1. Session serialized size > beberapa ratus KB tanpa alasan jelas.
2. Session menyimpan list ribuan DTO.
3. `@ViewScoped` bean menyimpan entity graph lengkap.
4. User membuka banyak tab lalu heap naik tajam.
5. Full GC meningkat saat traffic form tinggi.
6. Cluster replication traffic besar.
7. Logout tidak menurunkan memory cepat karena leak/reference.

---

## 14. Clustering, Sticky Session, dan Replication

Dalam deployment multi-node, state strategy harus cocok dengan load balancing.

### 14.1 Sticky session

Sticky session mengarahkan request user yang sama ke node yang sama.

Keuntungan:

- server-side state lebih sederhana,
- tidak selalu perlu replicate setiap view state,
- latency lebih rendah.

Kerugian:

- failover buruk jika node mati,
- rolling deployment bisa mengganggu active views,
- load imbalance jika sticky distribution buruk.

### 14.2 Session replication

Session replication menyalin session/state antar node.

Keuntungan:

- failover lebih baik,
- postback bisa diproses di node lain.

Kerugian:

- network overhead,
- serialization overhead,
- memory overhead di banyak node,
- object harus serializable,
- mutable large graph mahal,
- replication storm pada Ajax-heavy page.

### 14.3 Client-side state dalam cluster

Client-side state mengurangi kebutuhan replicate view state, tetapi:

1. session auth tetap perlu strategi,
2. signing/encryption key harus konsisten antar node,
3. payload lebih besar,
4. sensitive data discipline makin penting,
5. server restart/key rotation dapat invalidate views.

---

## 15. View State Security

Hidden field bukan secret.

Walaupun view state terlihat sebagai string encoded yang tidak mudah dibaca, jangan jadikan itu tempat aman untuk data sensitif.

### 15.1 Risiko

1. Tampering jika state tidak ditandatangani.
2. Disclosure jika state tidak dienkripsi dan mengandung data sensitif.
3. Replay stale state.
4. Large payload abuse.
5. Deserialization risk jika implementation rentan atau konfigurasi buruk.
6. Key mismatch antar node.
7. Debug leakage dari exception page.

### 15.2 Prinsip aman

1. Jangan simpan password/token/API secret di component state atau view scoped bean.
2. Jangan percaya hidden field sebagai authority.
3. Semua action mutasi harus enforce authorization di service layer.
4. Validasi id dan version di server.
5. Gunakan CSRF protection bawaan/standar Faces form dan pastikan session cookie aman.
6. Untuk client-side state, pastikan integrity/confidentiality mengikuti rekomendasi implementation.
7. Batasi request size untuk mencegah payload abuse.
8. Jangan menampilkan raw view state/debug detail di error page.

---

## 16. Dynamic Component Tree dan State Restore

Dynamic component tree adalah sumber bug state yang sulit.

Contoh buruk:

```java
@PostConstruct
public void init() {
    if (new Random().nextBoolean()) {
        addExtraInputComponent();
    }
}
```

Pada render pertama, component tree punya extra input. Pada postback, tree mungkin tidak punya extra input. Akibatnya submitted value tidak cocok, validation/action kacau, atau restore gagal.

### 16.1 Aturan dynamic component aman

1. Dynamic structure harus deterministik untuk view yang sama.
2. Component id harus stabil.
3. Buat dynamic component pada phase/waktu yang benar.
4. Jangan bergantung pada data volatile tanpa menyimpannya sebagai view-specific state.
5. Prefer `ui:repeat`, composite component, atau normal Facelets daripada programmatic component creation jika memungkinkan.
6. Jika memakai `rendered`, pahami bahwa komponen yang tidak rendered masih bisa ada di tree tergantung konteks, tetapi tidak menghasilkan output.
7. Jangan memakai JSTL `c:if` sembarangan untuk component yang harus ikut lifecycle postback.

### 16.2 `rendered` vs build-time conditional

```xml
<h:panelGroup rendered="#{bean.showAdvanced}">
    <h:inputText value="#{bean.form.advancedNote}" />
</h:panelGroup>
```

Ini Faces component attribute, dievaluasi dalam lifecycle render.

```xml
<c:if test="#{bean.showAdvanced}">
    <h:inputText value="#{bean.form.advancedNote}" />
</c:if>
```

Ini JSTL build-time tag, memengaruhi apakah component dibuat dalam tree.

Untuk stateful component yang perlu survive postback, gunakan pendekatan Faces component dengan hati-hati, bukan JSTL conditional yang mengubah tree secara tidak konsisten.

---

## 17. Data Table State

Data table adalah hotspot state management.

State yang mungkin terlibat:

- current page,
- sorting,
- filtering,
- selected row,
- expanded row,
- row edit state,
- per-row validation state,
- lazy loading model,
- scroll position,
- component library metadata.

### 17.1 Anti-pattern

```java
@ViewScoped
public class CaseListBean implements Serializable {
    private List<CaseDto> allCases; // 50.000 rows
}
```

Ini membuat view/session berat.

### 17.2 Pattern lebih baik

```java
@ViewScoped
public class CaseListBean implements Serializable {
    private CaseSearchCriteria criteria = new CaseSearchCriteria();
    private Page<CaseSummaryDto> currentPage;

    public void search() {
        currentPage = caseQueryService.search(criteria, pageRequest());
    }
}
```

Untuk table besar:

1. simpan criteria, bukan seluruh dataset,
2. gunakan pagination server-side,
3. simpan selected id, bukan selected entity graph,
4. reload detail dari service ketika action dilakukan,
5. enforce authorization pada action, bukan hanya row button visibility.

---

## 18. Stateless Views

Faces mendukung gagasan stateless views pada skenario tertentu, biasanya untuk view yang tidak membutuhkan component state antar request.

Cocok untuk:

- halaman read-only sederhana,
- public landing page,
- static-ish page dengan sedikit binding,
- GET-based page tanpa complex form lifecycle.

Tidak cocok untuk:

- form kompleks,
- validation-heavy input,
- Ajax partial rendering,
- multi-step wizard,
- stateful component library table,
- halaman dengan view scoped bean kompleks.

Prinsipnya:

```text
Gunakan stateful Faces saat lifecycle component memberi nilai.
Gunakan stateless/GET/simple MVC saat lifecycle state tidak dibutuhkan.
```

---

## 19. PRG dan State Reduction

POST-Redirect-GET adalah pattern penting untuk mengurangi masalah state setelah mutation.

Tanpa PRG:

```text
POST Save
  -> render same page
  -> browser refresh repeats POST risk
  -> stale view state remains central
```

Dengan PRG:

```text
POST Save
  -> service updates case
  -> redirect to GET detail page
  -> browser displays fresh URL
  -> refresh is safe GET
```

Contoh:

```java
public String save() {
    caseService.updateCase(caseId, version, form.toCommand());
    return "/case/detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

PRG membantu:

1. menghindari double submit,
2. membuat URL bookmarkable,
3. mengurangi stale component state,
4. memisahkan command result dari edit form state,
5. memperjelas source of truth setelah mutation.

---

## 20. Optimistic Locking dan Stale View

State view bisa stale meskipun view state valid.

Skenario:

```text
10:00 User A membuka case version 7
10:01 User B membuka case version 7
10:05 User A save -> version jadi 8
10:10 User B save dari stale form version 7
```

Faces bisa memproses postback dengan benar, tetapi secara bisnis input B stale.

Solusi:

1. include version di form/view model,
2. service layer cek optimistic lock,
3. tampilkan conflict message,
4. jangan overwrite silent,
5. beri opsi reload/merge jika domain membutuhkan.

Contoh command:

```java
public record UpdateCaseCommand(
    Long caseId,
    Long expectedVersion,
    String title,
    String remarks
) {}
```

State management UI tidak menggantikan consistency control domain.

---

## 21. View State dan Authorization

Jangan pernah menganggap view state sebagai bukti authorization.

Contoh:

```xml
<h:commandButton value="Approve"
                 action="#{caseActionBean.approve}"
                 rendered="#{permission.canApprove(caseBean.caseId)}" />
```

Ini hanya menyembunyikan tombol. User masih bisa:

- memakai stale page,
- memanipulasi request,
- submit dari tab lama,
- mengakses endpoint/action via crafted request.

Service tetap harus enforce:

```java
public void approve(Long caseId) {
    authorizationService.requireCanApprove(currentUser, caseId);
    workflowService.approve(caseId, currentUser);
}
```

Faces state membantu UI lifecycle; authorization tetap domain/service concern.

---

## 22. View State dan CSRF

Faces forms biasanya membawa hidden state yang membantu framework memvalidasi postback context, tetapi security design tetap harus mempertimbangkan CSRF.

Prinsip:

1. semua mutation harus melalui POST,
2. form harus memiliki token/proteksi yang valid,
3. session cookie pakai `HttpOnly`, `Secure`, dan `SameSite` sesuai deployment,
4. endpoint action tidak boleh menerima state-changing GET,
5. service layer tetap validasi permission dan resource version.

View state bukan pengganti desain CSRF lengkap di seluruh aplikasi, terutama jika aplikasi juga punya endpoint non-Faces seperti REST, servlet upload, atau legacy JSP action.

---

## 23. View State Size Budget

Engineer top-tier tidak menunggu production OOM untuk peduli state size.

Tetapkan budget.

Contoh budget awal:

| Item | Budget awal |
|---|---:|
| Hidden view state client-side | < 20–50 KB per page jika memungkinkan |
| Server-side serialized view | < 100–300 KB per active view untuk app umum |
| View scoped bean | kecil, DTO/form only |
| Session total normal | < 500 KB–1 MB per active user, tergantung app |
| Table loaded rows | page size saja, bukan semua rows |

Angka ini bukan standar universal. Tetapi tanpa budget, state akan tumbuh liar.

### 23.1 Cara menurunkan view state

1. Hindari component tree besar.
2. Pecah halaman terlalu besar.
3. Gunakan pagination server-side.
4. Jangan simpan list besar di view scoped bean.
5. Jangan simpan domain entity graph.
6. Gunakan transient untuk field yang tidak perlu disimpan.
7. Pakai request scope untuk data yang bisa direbuild murah.
8. Hindari dynamic component excessive.
9. Kurangi nested component library yang menghasilkan banyak state.
10. Setelah mutation, redirect ke GET.

---

## 24. Observability untuk State Management

Yang perlu dimonitor:

1. active sessions,
2. session creation rate,
3. average/max session size jika bisa diukur,
4. view state hidden field size pada client-side state,
5. count `ViewExpiredException`,
6. session timeout incidents,
7. heap usage vs active users,
8. GC pause saat traffic form tinggi,
9. cluster replication traffic,
10. failed deserialization/restore errors,
11. postback latency,
12. Ajax request count per page,
13. largest pages by HTML payload,
14. error rate after deployment/restart.

### 24.1 Logging yang berguna

Saat restore/view expired error, log minimal:

- correlation id,
- user id hash/internal id,
- view id,
- request method,
- session age jika tersedia,
- whether ajax request,
- node id,
- deployment version,
- user agent summary,
- referer/path sanitized,
- exception type.

Jangan log full view state token atau sensitive form values.

---

## 25. Debugging Playbook: `ViewExpiredException`

Checklist:

1. Apakah session timeout terlalu pendek untuk flow?
2. Apakah user melakukan submit setelah idle lama?
3. Apakah load balancer sticky session aktif jika server-side state?
4. Apakah session replication berfungsi?
5. Apakah deployment restart terjadi?
6. Apakah client-side state key berubah antar node/restart?
7. Apakah form berasal dari cached HTML lama?
8. Apakah view state hidden field terpotong oleh proxy/request size limit?
9. Apakah ada nested form invalid HTML?
10. Apakah custom exception handler menutupi root cause?
11. Apakah banyak Ajax request paralel menyebabkan race/stale state?
12. Apakah component tree dynamic berubah antara render dan postback?

---

## 26. Debugging Playbook: Session Bloat

Langkah diagnosis:

1. ukur active session count,
2. sample serialized session size,
3. identifikasi top attributes,
4. cari `@SessionScoped` beans besar,
5. cari `@ViewScoped` beans besar,
6. inspect table/list fields,
7. ukur number of active views per session,
8. cek component library state,
9. cek upload temporary state,
10. cek flash scope leak,
11. cek custom cache per user,
12. lakukan heap dump saat traffic representatif.

Pertanyaan kunci:

```text
Apakah data ini harus berada di session/view, atau bisa direbuild dari database/cache/service berdasarkan id kecil?
```

---

## 27. Debugging Playbook: Ajax State Bugs

Gejala:

- button tidak update area yang benar,
- message tidak muncul,
- input berubah balik,
- stale selected row,
- duplicate component id,
- validation terjadi untuk field yang tidak terlihat,
- partial response error.

Checklist:

1. Apakah `execute` mencakup input yang perlu diproses?
2. Apakah `render` menunjuk client id yang benar?
3. Apakah target berada dalam naming container berbeda?
4. Apakah component yang dirender ada di tree saat render?
5. Apakah conditional `c:if` menghapus target component?
6. Apakah multiple form membuat request tidak membawa field yang dibutuhkan?
7. Apakah Ajax request paralel mengubah same view scoped bean?
8. Apakah command memakai `immediate=true` sehingga phase berubah?
9. Apakah validation failure menghentikan update model/action?

---

## 28. Design Pattern: Small View State, Strong Domain Command

Pattern yang disarankan:

```text
View state:
  - caseId
  - expectedVersion
  - form fields
  - UI selection/filter/page

Service command:
  - explicit action
  - explicit target id
  - expected version
  - current user resolved server-side
  - validated business invariants

Database:
  - source of truth
```

Contoh:

```java
@Named
@ViewScoped
public class CaseDecisionBean implements Serializable {

    private Long caseId;
    private Long expectedVersion;
    private DecisionForm form = new DecisionForm();

    @Inject
    private CaseDecisionService decisionService;

    public void load() {
        var summary = decisionService.getDecisionContext(caseId);
        this.expectedVersion = summary.version();
        this.form.setRecommendedAction(summary.defaultAction());
    }

    public String submitDecision() {
        decisionService.submitDecision(new SubmitDecisionCommand(
            caseId,
            expectedVersion,
            form.getDecision(),
            form.getRemarks()
        ));

        return "/case/detail?faces-redirect=true&amp;caseId=" + caseId;
    }
}
```

Yang tidak disimpan:

- full case entity graph,
- current user mutable object,
- permission decision cache besar,
- uploaded file bytes,
- audit log list besar,
- open database session.

---

## 29. Case Study: Regulatory Case Management Edit Screen

### 29.1 Requirement

Halaman edit case:

- user membuka `/case/edit.xhtml?caseId=1001`,
- system load title, description, category, status, version,
- user edit fields,
- user save,
- system validate field,
- system check authorization,
- system check optimistic lock,
- system write audit trail,
- system redirect to detail page.

### 29.2 State allocation

| Data | Tempat | Alasan |
|---|---|---|
| `caseId` | URL/view param + view scoped field | identity halaman |
| `expectedVersion` | view scoped field/hidden command model | conflict detection |
| editable fields | view scoped form object | temporary UI state |
| current user | security context/session principal | identity user |
| permission | service check + optional view display helper | enforcement di service |
| audit trail | database | source of truth |
| dropdown options | request/application cache depending volatility | avoid per-view duplication |
| attachments | temporary storage/object store | jangan simpan bytes di view/session |

### 29.3 Flow

```text
GET /case/edit.xhtml?caseId=1001
  -> f:viewParam assigns caseId
  -> f:viewAction calls load()
  -> service verifies canView/canEdit
  -> form populated
  -> render with view state

POST Save
  -> restore view
  -> apply request values
  -> convert/validate
  -> update form model
  -> submit action
  -> service verifies canEdit again
  -> service checks expectedVersion
  -> persist update + audit
  -> redirect to detail
```

### 29.4 Failure handling

| Failure | Handling |
|---|---|
| View expired | show session/view expired page with safe reload link |
| Validation fail | stay on page, render messages, preserve submitted values |
| Optimistic lock fail | show conflict page/message, offer reload |
| Authorization revoked | deny action, do not rely on hidden UI |
| Duplicate submit | idempotency key or version/action guard |
| Server restart | graceful expired view UX |
| Attachment temp expired | ask re-upload, do not silently save partial |

---

## 30. Java 8 sampai Java 25: Implikasi Praktis

### 30.1 Java 8 legacy

Umumnya terkait:

- JSF 2.x,
- `javax.faces.*`,
- Java EE 7/8,
- older Mojarra/MyFaces,
- older PrimeFaces/OmniFaces,
- server-side state/session-heavy apps.

Risiko:

- full/old state behavior,
- library compatibility terbatas,
- serialization legacy,
- SecurityManager-era assumptions,
- old containers.

### 30.2 Java 11/17 transition

Perhatikan:

- module/classpath changes,
- JAXB/JAX-WS removal dari JDK lama,
- dependency explicit,
- app server compatibility,
- serialization warnings,
- reflection access.

### 30.3 Java 21/25 modern runtime

Perhatikan:

- Jakarta EE 11 baseline minimum Java SE 17,
- Faces 4.1 alignment dengan EE 11,
- removal of SecurityManager references,
- virtual thread awareness di platform tidak berarti Faces request state jadi bebas masalah,
- state/session memory tetap perlu desain eksplisit.

Virtual threads dapat membantu concurrency request tertentu, tetapi tidak menghapus biaya:

- component tree restore,
- serialization,
- validation,
- database calls,
- session locking,
- cluster replication,
- memory footprint.

---

## 31. Migration Notes: `javax.faces` ke `jakarta.faces`

Checklist state-related migration:

1. Update package imports:
   - `javax.faces.*` -> `jakarta.faces.*`.
2. Update context params jika diperlukan:
   - `javax.faces.STATE_SAVING_METHOD` -> `jakarta.faces.STATE_SAVING_METHOD`.
3. Verify implementation docs for compatibility aliases.
4. Upgrade Mojarra/MyFaces sesuai Jakarta EE target.
5. Upgrade component libraries.
6. Test client/server state saving explicitly.
7. Test `ViewExpiredException` handling.
8. Test multi-tab flows.
9. Test cluster failover/sticky session.
10. Measure state size before/after migration.
11. Validate serialization of view/session scoped beans.
12. Review custom components/renderers for state helper usage.
13. Review dynamic component tree assumptions.

---

## 32. Common Anti-Patterns

### 32.1 Session as current screen

```java
@SessionScoped
public class CaseSessionBean {
    private Long currentCaseId;
}
```

Problem: multi-tab collision.

Better: view-specific state + URL identity.

### 32.2 Storing entity graph in view scope

```java
private CaseEntity caseEntity;
```

Problem: detached/lazy loading/serialization/stale state/security.

Better: form DTO + id/version.

### 32.3 Large list in view scope

```java
private List<AuditTrailDto> allAuditRows;
```

Problem: memory bloat.

Better: paginated query by criteria.

### 32.4 Hidden fields as trusted data

```xml
<h:inputHidden value="#{bean.approverRole}" />
```

Problem: user can tamper.

Better: resolve permission server-side.

### 32.5 Dynamic component IDs changing per request

```java
component.setId("field_" + System.nanoTime());
```

Problem: postback mapping broken.

Better: stable deterministic ids.

### 32.6 Long form without expiry strategy

Problem: user loses work after session/view expiry.

Better: draft/autosave/warning/PRG/recoverable GET.

---

## 33. Review Checklist

Gunakan checklist ini saat review halaman Faces stateful.

### 33.1 Identity

- Apakah resource id ada di URL/view param?
- Apakah action target explicit?
- Apakah multi-tab aman?
- Apakah version/optimistic lock disertakan?

### 33.2 Scope

- Apakah `@ViewScoped` dipakai untuk screen state?
- Apakah `@SessionScoped` hanya menyimpan state lintas halaman yang benar-benar perlu?
- Apakah object besar tidak disimpan di view/session?
- Apakah uploaded file bytes tidak masuk session/view?

### 33.3 State size

- Apakah table memakai pagination?
- Apakah view state hidden field masuk akal?
- Apakah session size diukur?
- Apakah component tree terlalu besar?

### 33.4 Security

- Apakah hidden field tidak dipercaya?
- Apakah authorization enforce di service?
- Apakah client-side state protected?
- Apakah sensitive data tidak masuk view state?
- Apakah CSRF/session cookie aman?

### 33.5 Operations

- Apakah `ViewExpiredException` ditangani user-friendly?
- Apakah sticky/session replication strategy jelas?
- Apakah rolling deployment behavior dipahami?
- Apakah metrics tersedia?
- Apakah error log tidak membocorkan view state/token?

### 33.6 Lifecycle

- Apakah dynamic component deterministic?
- Apakah component id stabil?
- Apakah JSTL conditional tidak merusak component tree?
- Apakah Ajax execute/render benar?

---

## 34. Mental Model Final

Faces state management bukan “framework magic”. Ia adalah kontrak antara:

1. Facelets template,
2. component tree,
3. hidden view state,
4. server/session/client state store,
5. backing bean scope,
6. browser postback,
7. lifecycle phase,
8. service/domain source of truth.

Ringkasnya:

```text
Faces view = component tree + bindings + lifecycle + saved state.

State saving exists because postback needs to reconstruct enough context
from a previous render to process input safely and correctly.
```

Desain yang baik:

- menyimpan state sekecil mungkin,
- menjaga identity explicit,
- menggunakan scope sesuai lifetime,
- tidak mempercayai client/hidden fields,
- tidak menyimpan domain graph berat,
- mengandalkan service/database sebagai source of truth,
- menangani expiry sebagai kondisi normal,
- mengukur memory dan payload sejak awal.

Desain buruk:

- semua masuk session,
- entity graph disimpan di view,
- dynamic tree tidak stabil,
- hidden field dianggap aman,
- session timeout dijadikan satu-satunya solusi,
- state size tidak pernah diukur,
- authorization hanya berdasarkan tombol yang disembunyikan.

---

## 35. Referensi

- Jakarta Faces 4.1 Specification — Jakarta EE 11 release: `https://jakarta.ee/specifications/faces/4.1/`
- Jakarta Faces 4.1 Specification Document: `https://jakarta.ee/specifications/faces/4.1/jakarta-faces-4.1`
- Jakarta EE Tutorial — Jakarta Faces Technology: `https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/faces-intro/faces-intro.html`
- Jakarta Faces API — `StateManager`: `https://jakarta.ee/specifications/faces/4.0/apidocs/jakarta/faces/application/statemanager`
- Jakarta Faces API — `ViewExpiredException`: `https://jakarta.ee/specifications/faces/3.0/apidocs/jakarta/faces/application/viewexpiredexception`

---

## 36. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
22-ajax-and-partial-rendering-in-faces.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 20 — Navigation, Actions, Events, and Application Flow in Faces](./20-navigation-actions-events-application-flow-in-faces.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Ajax and Partial Rendering in Jakarta Faces](./22-ajax-and-partial-rendering-in-faces.md)

</div>