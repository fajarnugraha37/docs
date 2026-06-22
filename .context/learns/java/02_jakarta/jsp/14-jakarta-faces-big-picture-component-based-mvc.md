# Part 14 — Jakarta Faces Big Picture: Component-Based MVC, Not Just Templates

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `14-jakarta-faces-big-picture-component-based-mvc.md`  
> Topik: Jakarta Faces / JSF mental model, component-based MVC, lifecycle, state, postback, Facelets, dan kapan teknologi ini tepat dipakai  
> Target pembaca: engineer Java yang sudah memahami Servlet/JSP/EL/JSTL/CDI/Validation/Jakarta Security dan ingin memahami Faces sebagai framework UI enterprise secara struktural, bukan sekadar hafalan tag.

---

## 1. Tujuan Bagian Ini

Bagian sebelumnya membahas dunia **JSP/Jakarta Pages**: template server-side yang akhirnya diterjemahkan menjadi servlet. Mulai bagian ini kita berpindah ke **Jakarta Faces**.

Perpindahannya penting karena Faces bukan sekadar “JSP yang lebih rapi”. Faces adalah framework UI yang memiliki:

1. **component tree**,
2. **request processing lifecycle**,
3. **state management**,
4. **event model**,
5. **conversion and validation pipeline**,
6. **navigation model**,
7. **rendering abstraction**,
8. **Ajax partial lifecycle**,
9. **integration dengan CDI, Bean Validation, EL, dan Servlet**.

Jika JSP berpikir dalam bentuk:

```text
request -> controller -> request attributes -> JSP template -> HTML response
```

maka Faces berpikir dalam bentuk:

```text
request/postback
  -> restore/build component tree
  -> decode submitted values
  -> convert and validate
  -> update model
  -> invoke application action
  -> render component tree back to markup
  -> save view state
```

Perbedaan mental model ini sangat besar. Banyak engineer gagal memakai Faces bukan karena Faces “sulit”, tetapi karena mereka memperlakukannya seperti JSP biasa atau seperti SPA client-side biasa.

Tujuan bagian ini adalah membentuk fondasi mental model sebelum masuk ke Facelets, managed beans, lifecycle detail, component, validation, navigation, state, Ajax, custom component, security, performance, dan capstone.

---

## 2. Definisi Singkat Jakarta Faces

**Jakarta Faces** adalah framework MVC untuk membangun user interface web berbasis komponen di Java/Jakarta EE.

Secara konseptual, Faces menyediakan:

| Area | Fungsi |
|---|---|
| Component model | Representasi UI sebagai tree object server-side |
| Lifecycle | Pipeline request/postback dari decode sampai render |
| State management | Menyimpan/memulihkan kondisi view antar request |
| Event handling | Action, value change, system event, behavior event |
| Conversion | Mengubah string HTTP parameter menjadi tipe Java |
| Validation | Validasi input sebelum model di-update |
| Navigation | Menentukan halaman berikutnya/action outcome |
| Rendering | Mengubah component tree menjadi HTML/markup |
| I18N & accessibility | Dukungan pesan, locale, dan atribut UI |
| Ajax | Partial processing dan partial rendering |

Jakarta Faces adalah penerus dari JavaServer Faces/JSF. Di era Jakarta EE modern, package dan API bergerak dari `javax.faces.*` menuju `jakarta.faces.*`.

---

## 3. Kenapa Faces Tidak Boleh Dipahami sebagai Template Engine

JSP adalah template engine server-side. Facelets, yang dipakai Faces modern, memang terlihat seperti template XHTML. Tetapi Faces sendiri bukan hanya template engine.

Contoh Facelets sederhana:

```xml
<h:form>
    <h:inputText value="#{caseSearchBean.keyword}" />
    <h:commandButton value="Search" action="#{caseSearchBean.search}" />
</h:form>
```

Sekilas ini tampak seperti template yang langsung menghasilkan HTML. Namun secara internal, yang terjadi lebih kaya:

1. `<h:form>` menjadi komponen `UIForm`.
2. `<h:inputText>` menjadi komponen input server-side.
3. `value="#{caseSearchBean.keyword}"` menjadi value expression.
4. `<h:commandButton>` menjadi action source.
5. Saat request pertama, tree dibangun lalu dirender.
6. Saat form disubmit, tree dipulihkan.
7. Parameter HTTP di-decode ke komponen.
8. Nilai string dikonversi.
9. Nilai divalidasi.
10. Jika valid, backing bean di-update.
11. Action method dipanggil.
12. Response dirender lagi.
13. State tree disimpan untuk request berikutnya.

Dengan kata lain, Facelets adalah **view declaration language**, sedangkan Faces adalah **component lifecycle framework**.

Mental model yang salah:

```text
Facelets = HTML + tag helper
```

Mental model yang benar:

```text
Facelets = deklarasi component tree
Faces = runtime yang memproses component tree melalui lifecycle
```

---

## 4. JSP/Jakarta Pages vs Jakarta Faces

### 4.1 JSP/Jakarta Pages: Template-Centric

JSP/Jakarta Pages cocok dipahami sebagai:

```text
Controller prepares data -> JSP reads data -> JSP emits text/HTML
```

Karakteristik utama:

1. Rendering mostly one-way.
2. State biasanya di request/session/application scope.
3. Form submit diproses manual oleh servlet/controller.
4. Conversion/validation biasanya dilakukan di controller/service/validator.
5. View hanya membaca data dan menulis response.
6. Tag library membantu view logic, tapi tidak menjadikan view stateful component tree.

Contoh alur:

```text
GET /cases
  -> CaseServlet finds cases
  -> request.setAttribute("cases", cases)
  -> forward to /WEB-INF/views/cases/list.jsp
  -> JSP renders table
```

Untuk POST:

```text
POST /cases/search
  -> Servlet reads request parameter
  -> validate parameter
  -> service.search(...)
  -> set request attributes
  -> forward/redirect
```

### 4.2 Faces: Component-Centric

Faces cocok dipahami sebagai:

```text
View declares components -> Faces builds/restores component tree -> lifecycle processes submitted values -> components update model -> renderer emits response
```

Karakteristik utama:

1. UI direpresentasikan sebagai server-side component tree.
2. Input, output, form, command, table, message, metadata adalah komponen.
3. Setiap request melewati lifecycle.
4. Form binding terjadi melalui EL.
5. Conversion/validation terintegrasi dengan lifecycle.
6. State view disimpan dan dipulihkan.
7. Ajax memproses sebagian tree dan merender sebagian tree.

Contoh alur:

```text
GET /cases.xhtml
  -> Faces builds component tree
  -> render response
  -> save view state

POST /cases.xhtml
  -> Faces restores component tree
  -> decode submitted values
  -> convert + validate
  -> update backing bean
  -> invoke action
  -> render response
  -> save updated state
```

---

## 5. Faces Bukan SPA, Tapi Punya Kemiripan Konseptual

Faces sering disalahpahami karena sekarang banyak engineer terbiasa dengan SPA seperti Vue/React/Angular.

SPA berpikir:

```text
client component tree
  -> client state
  -> client event
  -> API call
  -> client re-render
```

Faces berpikir:

```text
server component tree
  -> server-side view state
  -> HTTP postback/Ajax
  -> server lifecycle
  -> server render/partial render
```

Kemiripannya:

| SPA | Faces |
|---|---|
| Component tree di browser | Component tree di server |
| Client state | View state/session state di server atau hidden field client-side |
| Event handler JS | Action/action listener/value change listener di server |
| Virtual DOM/rendering | Renderer menghasilkan HTML response/partial response |
| Client validation | Converter/validator server-side, bisa ditambah client-side library |
| API call | Postback/Ajax lifecycle |

Perbedaannya:

| Aspek | SPA | Faces |
|---|---|---|
| State utama | Browser | Server/view state |
| Rendering utama | Browser | Server |
| Transport | JSON/REST/GraphQL/WebSocket | Form postback/Ajax partial response |
| Debugging | DevTools + JS stack | Server logs + lifecycle + component id |
| Scaling pressure | API/backend load | UI lifecycle + session/view state load |
| Security boundary | API authorization wajib | Server action authorization wajib, view rendering bukan enforcement |

Kesalahan umum adalah mengharapkan Faces berperilaku seperti SPA penuh. Faces bisa memakai Ajax dan partial rendering, tetapi tetap server-side lifecycle.

---

## 6. Komponen sebagai Unit UI

Dalam JSP, unit rendering utama adalah potongan text/template.

Dalam Faces, unit rendering utama adalah **UIComponent**.

Contoh tag:

```xml
<h:inputText id="keyword" value="#{caseSearchBean.keyword}" required="true" />
```

Secara konseptual menjadi object server-side:

```text
UIInput
  id = keyword
  valueExpression = #{caseSearchBean.keyword}
  required = true
  submittedValue = ...
  localValue = ...
  valid = true/false
  converter = ...
  validators = ...
  rendererType = ...
```

Satu komponen tidak hanya “mencetak HTML”. Ia bisa memiliki:

1. id,
2. parent,
3. children,
4. facets,
5. attributes,
6. value expression,
7. submitted value,
8. converted local value,
9. validation status,
10. messages,
11. renderer,
12. event listeners,
13. state.

Inilah alasan Faces bisa melakukan form processing terstruktur. Namun ini juga alasan Faces punya biaya runtime lebih besar dibanding JSP template sederhana.

---

## 7. Component Tree Mental Model

Bayangkan halaman Facelets ini:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core">
<h:body>
    <h:form id="searchForm">
        <h:panelGroup id="criteria">
            <h:outputLabel for="keyword" value="Keyword" />
            <h:inputText id="keyword" value="#{caseSearchBean.keyword}" />
            <h:message for="keyword" />
        </h:panelGroup>

        <h:commandButton id="search" value="Search" action="#{caseSearchBean.search}" />
    </h:form>
</h:body>
</html>
```

Faces tidak hanya membaca file ini sebagai text. Faces membangun tree kira-kira seperti ini:

```text
UIViewRoot
└── HtmlBody
    └── UIForm(searchForm)
        ├── UIPanel(criteria)
        │   ├── HtmlOutputLabel
        │   ├── HtmlInputText(keyword)
        │   └── HtmlMessage
        └── HtmlCommandButton(search)
```

Tree inilah yang diproses pada lifecycle.

Konsekuensi penting:

1. ID komponen penting.
2. Parent-child relationship penting.
3. Naming container penting.
4. Komponen yang tidak ada dalam tree tidak bisa diproses.
5. Komponen dengan `rendered="false"` dapat memengaruhi decode/update/render behavior.
6. Dynamic component tree harus stabil agar postback berhasil.
7. Ajax `execute` dan `render` bekerja berdasarkan component tree, bukan selector DOM biasa.

---

## 8. Faces MVC: Model, View, Controller, dan Lifecycle

Faces sering disebut MVC framework. Namun jangan membayangkan MVC-nya sama persis dengan Spring MVC atau classic Servlet MVC.

### 8.1 View

View biasanya ditulis sebagai Facelets `.xhtml`.

Contoh:

```xml
<h:form>
    <h:inputText value="#{caseBean.caseNumber}" />
    <h:commandButton value="Open" action="#{caseBean.open}" />
</h:form>
```

View mendeklarasikan component tree dan binding.

### 8.2 Model

Model bisa berarti beberapa layer:

1. data yang ditampilkan,
2. form object,
3. DTO/view model,
4. domain object,
5. entity persistence.

Untuk enterprise app, jangan langsung menyamakan model UI dengan entity persistence. Lebih aman memakai view model/form model.

Contoh:

```java
public class CaseSearchForm implements Serializable {
    private String keyword;
    private String status;
    private LocalDate submittedFrom;
    private LocalDate submittedTo;

    // getters/setters
}
```

### 8.3 Controller

Dalam Faces, sebagian controller behavior berada di:

1. FacesServlet,
2. lifecycle implementation,
3. backing bean action methods,
4. navigation handler,
5. event listeners.

Backing bean sering terlihat seperti controller:

```java
@Named
@ViewScoped
public class CaseSearchBean implements Serializable {
    private CaseSearchForm form = new CaseSearchForm();
    private List<CaseRow> results;

    @Inject
    private CaseSearchService caseSearchService;

    public void search() {
        results = caseSearchService.search(form);
    }

    // getters/setters
}
```

Namun backing bean sebaiknya bukan business service. Ia adalah **UI orchestration layer**.

### 8.4 Controller Realistis dalam Faces

Lebih akurat melihat Faces seperti ini:

```text
Facelets view
  declares component tree and bindings

Faces lifecycle
  coordinates request processing

Backing bean
  exposes UI state and handles user intent

Service layer
  executes business use case

Domain/persistence layer
  owns business data and invariants
```

---

## 9. Backing Bean: UI State + User Intent Boundary

Backing bean adalah object Java yang diekspos ke EL.

Contoh:

```java
@Named
@RequestScoped
public class LoginBean {
    private String username;
    private String password;

    @Inject
    private AuthenticationService authenticationService;

    public String login() {
        authenticationService.authenticate(username, password);
        return "/secure/home?faces-redirect=true";
    }

    // getters/setters
}
```

View:

```xml
<h:form>
    <h:inputText value="#{loginBean.username}" />
    <h:inputSecret value="#{loginBean.password}" />
    <h:commandButton value="Login" action="#{loginBean.login}" />
</h:form>
```

Perhatikan struktur tanggung jawab:

| Bagian | Tanggung jawab |
|---|---|
| Facelets | Mendeklarasikan input dan action |
| Faces lifecycle | Decode, validate, update model, invoke action |
| Backing bean | Menyimpan form state dan mengorkestrasi use case |
| Service | Melakukan autentikasi sebenarnya |
| Security layer | Menegakkan authorization/session policy |

Kesalahan umum:

```java
@Named
@SessionScoped
public class CaseBean {
    // BAD: terlalu banyak state, service, entity, query, authorization, workflow, cache
}
```

Backing bean seperti ini cepat menjadi “god controller” stateful.

---

## 10. Facelets vs JSP dalam Faces

Secara historis JSF pernah bisa memakai JSP sebagai view technology. Namun Faces modern menggunakan **Facelets** sebagai View Declaration Language utama.

Facelets memiliki keunggulan:

1. Dirancang untuk component tree.
2. Lebih natural untuk templating.
3. Mendukung composite components.
4. Lebih cocok dengan lifecycle Faces.
5. Menghindari konflik antara JSP lifecycle dan Faces lifecycle.
6. Menggunakan XHTML-style markup.
7. Lebih baik untuk composition dan reusable UI.

Mental model:

```text
JSP = template servlet technology
Facelets = component tree declaration technology
```

Karena itu, seri Faces ini akan memakai Facelets `.xhtml`, bukan JSP sebagai view Faces.

---

## 11. FacesServlet sebagai Entry Point

Aplikasi Faces berjalan melalui `FacesServlet`.

Secara sederhana:

```text
Browser request
  -> Servlet container
  -> FacesServlet
  -> Faces lifecycle
  -> render response
```

Mapping bisa berupa:

```xml
<servlet>
    <servlet-name>Faces Servlet</servlet-name>
    <servlet-class>jakarta.faces.webapp.FacesServlet</servlet-class>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>Faces Servlet</servlet-name>
    <url-pattern>*.xhtml</url-pattern>
</servlet-mapping>
```

Atau dengan konfigurasi lain tergantung container dan versi Jakarta Faces.

FacesServlet bukan controller per halaman seperti servlet manual. Ia adalah front controller untuk Faces lifecycle.

---

## 12. Request Awal vs Postback

Faces membedakan dua jenis request penting:

1. **initial request**,
2. **postback**.

### 12.1 Initial Request

Initial request biasanya terjadi saat user membuka halaman pertama kali:

```text
GET /cases.xhtml
```

Pada initial request:

1. view dibangun,
2. metadata bisa diproses,
3. page action/view parameter bisa berjalan,
4. response dirender,
5. state view disimpan.

Secara mental:

```text
GET -> build view -> render HTML + view state
```

### 12.2 Postback

Postback terjadi saat user submit form Faces:

```text
POST /cases.xhtml
```

Postback membawa:

1. form parameters,
2. component input values,
3. action source indicator,
4. view state token.

Secara mental:

```text
POST -> restore previous view -> process submitted values -> update model/action -> render next view
```

Postback adalah pusat dari Faces. Jika engineer tidak memahami postback, banyak bug akan tampak misterius.

---

## 13. View State: Kenapa Faces Memerlukan State

Dalam HTML biasa, server bisa stateless: request masuk, response keluar, selesai.

Dalam Faces, server perlu tahu component tree sebelumnya agar bisa memproses submit berikutnya.

Contoh:

```xml
<h:inputText id="keyword" value="#{bean.keyword}" required="true" />
<h:commandButton id="search" action="#{bean.search}" />
```

Saat browser mengirim POST, HTTP hanya mengirim parameter string seperti:

```text
searchForm:keyword=abc
searchForm:search=Search
jakarta.faces.ViewState=...
```

Faces harus tahu:

1. parameter `searchForm:keyword` milik komponen input mana,
2. komponen tersebut punya converter apa,
3. komponen tersebut required atau tidak,
4. validasi apa yang harus dipanggil,
5. value expression mana yang harus di-update,
6. action mana yang harus dipanggil,
7. message harus ditempelkan ke komponen mana.

Informasi ini berasal dari component tree yang dipulihkan dari view state atau dibangun kembali dengan state yang tersimpan.

---

## 14. Lifecycle Enam Fase: Gambaran Awal

Faces lifecycle standar biasanya dijelaskan dalam enam fase:

```text
1. Restore View
2. Apply Request Values
3. Process Validations
4. Update Model Values
5. Invoke Application
6. Render Response
```

Kita akan membahas detailnya di Part 17. Untuk Part 14, cukup pahami peran besarnya.

### 14.1 Restore View

Faces membangun atau memulihkan component tree.

Initial request:

```text
create/build view
```

Postback:

```text
restore previous view from state
```

### 14.2 Apply Request Values

Komponen mengambil submitted value dari request parameter.

```text
HTTP parameter -> component submittedValue
```

Pada tahap ini nilai belum tentu sudah dikonversi ke tipe model.

### 14.3 Process Validations

Faces melakukan:

1. conversion,
2. required check,
3. validators,
4. Bean Validation integration.

Jika gagal, lifecycle biasanya loncat ke render response, dan model tidak di-update.

### 14.4 Update Model Values

Jika valid, nilai komponen ditulis ke backing bean/model melalui value expression.

```text
component localValue -> #{bean.property}
```

### 14.5 Invoke Application

Action method dipanggil.

```java
public String save() {
    service.save(form);
    return "detail?faces-redirect=true";
}
```

### 14.6 Render Response

Faces merender component tree menjadi HTML dan menyimpan view state baru.

---

## 15. Lifecycle sebagai Failure Model

Lifecycle bukan hanya teori. Ia adalah alat debugging.

Contoh bug:

> “Kenapa action method tidak terpanggil?”

Kemungkinan:

1. Komponen button tidak ada di dalam `h:form`.
2. Validasi input lain gagal sebelum invoke application.
3. Component id berubah sehingga postback tidak cocok.
4. `rendered` condition membuat komponen tidak ada saat postback.
5. View state expired.
6. Ajax `execute` tidak menyertakan button/form/input yang diperlukan.
7. Converter error terjadi sebelum action.
8. Bean scope salah sehingga state hilang.

Tanpa lifecycle, engineer biasanya menebak-nebak. Dengan lifecycle, kita bertanya:

```text
Apakah request masuk ke FacesServlet?
Apakah view berhasil direstore?
Apakah komponen didecode?
Apakah validation gagal?
Apakah model update terjadi?
Apakah action masuk invoke application?
Apakah navigation/render berjalan?
```

Itulah cara berpikir top-tier saat menangani Faces.

---

## 16. EL Binding dalam Faces

Faces sangat bergantung pada Jakarta Expression Language.

Contoh value binding:

```xml
<h:inputText value="#{caseBean.caseNumber}" />
```

Pada render awal:

```text
#{caseBean.caseNumber} dibaca -> value ditampilkan
```

Pada postback yang valid:

```text
submitted string -> converted value -> ditulis ke caseBean.caseNumber
```

Contoh method binding:

```xml
<h:commandButton value="Save" action="#{caseBean.save}" />
```

Pada invoke application:

```text
caseBean.save() dipanggil
```

Jadi EL dalam Faces bukan hanya read expression. Ia bisa menjadi **read-write binding** dan **method dispatch**.

Konsekuensi:

1. Getter bisa dipanggil berkali-kali saat render.
2. Setter dipanggil hanya jika lifecycle mencapai update model.
3. Action dipanggil hanya jika lifecycle mencapai invoke application.
4. Method expression tidak boleh dipakai untuk menyembunyikan business logic berat di getter.
5. Binding ke object graph yang malas/lazy dapat memicu query saat render.

---

## 17. State Scope dalam Faces

Faces memakai scope Java/Jakarta yang sudah dikenal, tetapi dengan nuansa UI lifecycle.

Scope umum:

| Scope | Cocok untuk | Risiko |
|---|---|---|
| Request | request sederhana, stateless action | state hilang antar postback jika tidak dirancang benar |
| View | state satu halaman selama user berada di view itu | memory/view state, serialization, view expired |
| Session | user-level state lintas halaman | session bloat, stale data, multi-tab conflict |
| Application | global shared state | thread-safety, cross-user leak |
| Conversation | flow multi-step eksplisit | lifecycle complexity |

Dalam Faces modern, `@ViewScoped` sangat penting untuk halaman interaktif seperti search/list/detail/edit yang butuh state selama user berinteraksi dengan halaman itu.

Namun `@ViewScoped` bukan solusi semua masalah. Jika datanya besar, view state/session bisa membengkak.

Rule awal:

```text
Gunakan request scope untuk halaman sederhana.
Gunakan view scope untuk halaman interaktif satu view.
Gunakan session scope hanya untuk user context yang benar-benar lintas halaman.
Jangan simpan entity besar/lazy graph di UI scope.
```

---

## 18. Navigation: Outcome, Redirect, dan Post-Redirect-Get

Faces action dapat mengembalikan outcome:

```java
public String save() {
    service.save(form);
    return "/cases/detail?faces-redirect=true&id=" + form.getId();
}
```

Secara konseptual:

| Return value | Makna |
|---|---|
| `null` atau `void` | tetap di view yang sama |
| `"list"` | navigasi implicit/explicit ke view tertentu |
| `"/cases/list?faces-redirect=true"` | redirect browser |

Untuk action yang mengubah state, sering lebih aman memakai redirect agar menghindari double-submit saat refresh.

```text
POST submit
  -> save
  -> redirect GET detail
```

Ini adalah pola **POST-Redirect-GET**.

Faces menyediakan flash scope untuk membawa pesan antar redirect.

---

## 19. Messages sebagai Bagian dari UI Contract

Faces memiliki `FacesMessage`.

Contoh:

```java
FacesContext.getCurrentInstance().addMessage(null,
    new FacesMessage(FacesMessage.SEVERITY_INFO, "Saved", "Case saved successfully"));
```

View:

```xml
<h:messages globalOnly="true" />
<h:message for="caseNumber" />
```

Messages tidak boleh dianggap kosmetik. Dalam UI enterprise, message adalah bagian dari kontrak:

1. user tahu apa yang gagal,
2. field error jelas,
3. global error jelas,
4. validation message tidak bocor detail internal,
5. localization konsisten,
6. audit/security error tidak membuka informasi sensitif.

---

## 20. Conversion dan Validation sebagai First-Class Pipeline

Di JSP manual, engineer biasanya melakukan:

```java
String amountText = request.getParameter("amount");
BigDecimal amount = new BigDecimal(amountText);
if (amount.compareTo(BigDecimal.ZERO) <= 0) { ... }
```

Di Faces, input pipeline lebih formal:

```text
submitted string
  -> converter
  -> required validation
  -> validators
  -> Bean Validation
  -> model update
```

Contoh:

```xml
<h:inputText value="#{paymentBean.amount}" required="true">
    <f:convertNumber />
    <f:validateDoubleRange minimum="1" />
</h:inputText>
```

Keuntungan:

1. conversion failure otomatis menjadi message,
2. validation failure mencegah model update,
3. field-level message bisa dirender dekat input,
4. binding type lebih aman,
5. Bean Validation bisa digunakan.

Risiko:

1. lifecycle surprise jika action tidak terpanggil karena validation gagal,
2. converter mahal jika salah desain,
3. conversion locale salah,
4. entity lookup converter memicu DB query berulang,
5. cross-field validation perlu desain khusus.

---

## 21. Event Model

Faces punya beberapa jenis event:

1. action event,
2. value change event,
3. system event,
4. component event,
5. Ajax behavior event.

Contoh action:

```xml
<h:commandButton value="Approve" action="#{caseActionBean.approve}" />
```

Contoh value change:

```xml
<h:selectOneMenu value="#{caseBean.status}" valueChangeListener="#{caseBean.onStatusChange}">
    <f:selectItems value="#{caseBean.statusOptions}" />
</h:selectOneMenu>
```

Namun jangan terlalu cepat memakai listener. Untuk banyak kasus enterprise, action method biasa lebih mudah dibaca dan dites.

Heuristic:

```text
Gunakan action untuk user intent besar.
Gunakan listener untuk event UI lokal.
Gunakan system/phase listener hanya untuk cross-cutting lifecycle concern.
```

---

## 22. Ajax dalam Faces: Partial Server Lifecycle

Faces Ajax bukan sekadar `fetch()` ke API.

Contoh:

```xml
<h:selectOneMenu value="#{caseBean.category}">
    <f:ajax listener="#{caseBean.onCategoryChange}" render="subCategoryPanel" />
</h:selectOneMenu>

<h:panelGroup id="subCategoryPanel">
    <h:selectOneMenu value="#{caseBean.subCategory}">
        <f:selectItems value="#{caseBean.subCategoryOptions}" />
    </h:selectOneMenu>
</h:panelGroup>
```

Secara mental:

```text
Ajax request
  -> restore view
  -> execute selected components
  -> decode/validate/update selected components
  -> invoke listener/action if applicable
  -> render selected components
  -> return partial response
```

Poin penting:

1. `execute` menentukan bagian tree yang diproses.
2. `render` menentukan bagian tree yang dirender ulang.
3. ID mengacu pada component tree/naming container.
4. Validation masih bisa menggagalkan action/listener.
5. Dynamic rendering bisa membuat target render hilang.
6. Race condition masih mungkin jika user klik cepat.

---

## 23. Server-Side Rendering dan Progressive Enhancement

Faces menghasilkan HTML dari server. Ini bukan kelemahan mutlak. Untuk aplikasi enterprise internal, admin console, regulatory workflow, dan form-heavy apps, server-side rendering memiliki keunggulan:

1. security boundary lebih dekat ke server,
2. validasi server-first,
3. tidak perlu duplikasi banyak form validation di client,
4. integrasi Jakarta EE natural,
5. workflow dan data entry kompleks bisa cepat dibangun,
6. SEO bukan fokus untuk internal app,
7. permission rendering bisa dekat dengan server-side identity context.

Namun server-side rendering juga membawa trade-off:

1. interaksi kompleks bisa terasa lebih berat,
2. session/view state perlu dikelola,
3. scaling harus memperhitungkan state,
4. UI modern sangat dinamis bisa lebih cocok SPA,
5. debugging lifecycle butuh skill khusus,
6. coupling view-bean bisa menjadi tinggi.

Top-tier engineer tidak fanatik. Ia memilih berdasarkan constraint.

---

## 24. Kapan Jakarta Faces Cocok Dipakai

Faces cocok untuk:

1. aplikasi enterprise internal,
2. form-heavy workflow,
3. CRUD administratif kompleks,
4. back-office case management,
5. sistem regulatory/enforcement,
6. aplikasi dengan banyak validation dan message,
7. tim yang kuat di Java/Jakarta EE,
8. deployment ke full Jakarta EE server,
9. kebutuhan server-side component library,
10. aplikasi yang lebih mementingkan correctness daripada ultra-rich client interaction.

Contoh cocok:

```text
Regulatory case management:
- case listing
- filters
- case detail
- assignment
- approval/rejection
- document upload
- notes/minutes
- audit trail
- workflow action buttons
- role-based visibility
- validation-heavy forms
```

Faces dapat sangat produktif untuk pola seperti ini jika state dan lifecycle dikelola benar.

---

## 25. Kapan Jakarta Faces Kurang Cocok

Faces kurang cocok untuk:

1. public consumer app dengan UX sangat interaktif,
2. aplikasi real-time complex client state,
3. offline-first app,
4. mobile-like web app,
5. tim frontend-heavy yang sudah matang di SPA,
6. arsitektur API-first multi-client,
7. halaman dengan client-side visualization berat,
8. aplikasi yang harus sangat stateless horizontal scaling tanpa sticky/session strategy,
9. sistem yang perlu sharing UI logic dengan mobile apps,
10. produk yang sangat bergantung pada modern frontend ecosystem.

Untuk kasus seperti itu, kombinasi REST/JAX-RS + SPA mungkin lebih cocok.

Namun ini bukan berarti Faces buruk. Artinya constraint-nya berbeda.

---

## 26. Faces di Arsitektur Modern: Monolith, Modular Monolith, atau Hybrid

Jakarta Faces sering dipakai dalam aplikasi server-rendered monolith atau modular monolith.

### 26.1 Modular Monolith

```text
Web UI module
  -> Faces views/backing beans

Application module
  -> use cases/services

Domain module
  -> business rules/entities/value objects

Infrastructure module
  -> persistence/external integrations
```

Faces berada di web adapter layer.

### 26.2 Hybrid Architecture

Faces juga bisa berdampingan dengan REST API dan SPA:

```text
/admin/*       -> Jakarta Faces admin console
/api/*         -> JAX-RS REST API
/app/*         -> SPA frontend
/batch/*       -> batch/workload endpoints
```

Ini realistis untuk enterprise:

1. admin console cepat dibuat dengan Faces,
2. public/self-service UI memakai SPA,
3. mobile memakai API,
4. reporting/admin internal memakai server-rendered UI.

### 26.3 Anti-Pattern

Anti-pattern umum:

```text
Faces backing bean
  -> direct EntityManager query
  -> entity lazy graph exposed to view
  -> business rules in action method
  -> authorization hidden in rendered attribute
  -> huge session bean
```

Lebih baik:

```text
Faces view
  -> backing bean / view controller
  -> application service
  -> domain/persistence
  -> DTO/view model returned
```

---

## 27. Relationship dengan CDI

Faces modern sangat erat dengan CDI.

Backing bean modern biasanya:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {
    @Inject
    private CaseService caseService;
}
```

`@Named` membuat bean tersedia di EL:

```xml
<h:outputText value="#{caseDetailBean.caseNumber}" />
```

CDI memberi:

1. dependency injection,
2. lifecycle management,
3. interceptors,
4. decorators,
5. events,
6. scopes,
7. qualifiers,
8. producers.

Namun harus hati-hati:

1. scope CDI harus cocok dengan Faces lifecycle,
2. view-scoped bean perlu serialization consideration,
3. jangan inject request-only object ke long-lived bean tanpa proxy semantics yang benar,
4. jangan simpan non-serializable heavy resource di view/session state.

---

## 28. Relationship dengan Bean Validation

Faces dapat memakai Bean Validation untuk memvalidasi model property.

Contoh form model:

```java
public class CaseDecisionForm {
    @NotBlank
    private String decision;

    @Size(max = 4000)
    private String remarks;
}
```

Facelets:

```xml
<h:inputTextarea value="#{decisionBean.form.remarks}" />
<h:message for="remarks" />
```

Bean Validation bagus untuk field-level constraints. Namun tidak semua business rule cocok diletakkan di Bean Validation.

Pisahkan:

| Jenis Rule | Lokasi yang cocok |
|---|---|
| Required field | Faces required / Bean Validation |
| Format sederhana | Converter/validator |
| Length/range | Bean Validation |
| Cross-field UI validation | Custom validator / bean method |
| Business invariant | Domain/application service |
| Authorization rule | Security/application service |
| Workflow transition rule | Domain/application service/workflow engine |

---

## 29. Relationship dengan Jakarta Security

Faces dapat menampilkan/menyembunyikan komponen berdasarkan role atau permission.

Contoh:

```xml
<h:commandButton value="Approve"
                 action="#{caseActionBean.approve}"
                 rendered="#{permissionBean.canApprove(caseDetailBean.case)}" />
```

Ini hanya **visibility**.

Authorization sebenarnya harus tetap ditegakkan di action/service:

```java
public void approve() {
    authorizationService.requireCanApprove(currentUser, caseId);
    caseWorkflowService.approve(caseId, decision);
}
```

Rule penting:

```text
rendered=false is not security enforcement.
Disabled button is not security enforcement.
Hidden menu is not security enforcement.
Server-side action must enforce authorization.
```

---

## 30. Relationship dengan Persistence

Faces view sering menampilkan data dari database. Namun jangan binding langsung ke managed JPA entity besar dengan lazy association terbuka tanpa batas.

Masalah umum:

1. LazyInitializationException saat render.
2. N+1 query dari getter di view.
3. Entity graph besar masuk session/view state.
4. Stale entity antar postback.
5. Concurrent update conflict tidak terlihat.
6. Security leak karena view bisa traverse object graph.

Lebih aman:

```java
public class CaseDetailView {
    private Long id;
    private String caseNumber;
    private String status;
    private String assignedOfficerName;
    private List<AvailableActionView> availableActions;
}
```

Backing bean menyimpan DTO/view model, bukan persistence context.

---

## 31. Naming Container dan Component ID: Kenapa ID Faces Terlihat Aneh

Faces component id sering dirender menjadi HTML id seperti:

```text
searchForm:criteria:keyword
```

Ini terjadi karena Faces memakai naming container untuk memastikan id unik dalam tree.

Implikasi:

1. JavaScript selector perlu escape colon.
2. Ajax render target perlu memahami relative/absolute component id.
3. Duplicate id menyebabkan error.
4. Dynamic table row memiliki id client yang lebih kompleks.
5. Debugging harus membedakan component id dan client id.

Ini akan dibahas lebih dalam di part component dan Ajax.

Untuk sekarang, pahami:

```text
DOM id dalam browser adalah hasil dari component tree + naming container.
```

---

## 32. Dynamic UI: rendered, disabled, readonly, dan Security

Faces sering memakai attribute seperti:

```xml
<h:panelGroup rendered="#{caseBean.showApprovalPanel}">
    ...
</h:panelGroup>
```

Perbedaan penting:

| Attribute | Makna |
|---|---|
| `rendered=false` | komponen tidak dirender dan dapat tidak ada dalam output/tree processing tertentu |
| `disabled=true` | input/control terlihat tapi tidak aktif |
| `readonly=true` | input terlihat tetapi tidak bisa diubah langsung |
| hidden field | data tetap dikirim dari client, tidak boleh dipercaya |

Untuk security:

```text
rendered/disabled/readonly/hidden = UX behavior
server authorization/service validation = enforcement
```

Untuk lifecycle:

1. Komponen yang tidak dirender mungkin tidak ikut decode.
2. Conditional rendering yang berubah antara render dan postback bisa membuat submit bermasalah.
3. Ajax render target yang tidak ada di tree bisa gagal.

---

## 33. Table Rendering dan Data-Heavy Screens

Faces punya komponen data seperti `h:dataTable` dan library seperti PrimeFaces memiliki data table yang jauh lebih kaya.

Namun table adalah sumber masalah performance umum.

Risiko:

1. render ribuan row sekaligus,
2. getter dipanggil berkali-kali per cell,
3. lazy association query saat render,
4. row action binding membingungkan,
5. selection state besar,
6. pagination palsu di memory,
7. Ajax partial render terlalu besar,
8. session/view state membengkak.

Rule enterprise:

```text
Table besar harus server-side paginated, filtered, sorted secara eksplisit di service/query layer.
Jangan jadikan view sebagai query engine.
```

---

## 34. Error Handling dalam Faces

Faces error bisa terjadi pada banyak titik:

1. build view,
2. restore view,
3. decode,
4. conversion,
5. validation,
6. model update,
7. action method,
8. render response,
9. state save,
10. Ajax partial response.

Jenis error:

| Error | Contoh |
|---|---|
| View error | broken XHTML, duplicate id |
| Binding error | property not found, method not found |
| Conversion error | invalid date/number |
| Validation error | required field missing |
| Action error | service exception |
| State error | ViewExpiredException |
| Render error | lazy loading, null pointer in getter |
| Ajax error | malformed partial response |

Top-tier debugging bertanya:

```text
Di fase mana error terjadi?
Apakah error recoverable menjadi FacesMessage?
Apakah error harus menjadi navigation/error page?
Apakah response sudah committed?
Apakah ini full request atau partial Ajax request?
```

---

## 35. Security Mental Model untuk Faces

Faces membantu beberapa hal, tetapi tidak menghilangkan security responsibility.

Faces membantu:

1. output escaping default pada beberapa komponen output,
2. form state token,
3. server-side validation,
4. component-based input processing,
5. integration dengan security context.

Namun developer tetap harus menjaga:

1. authorization di service/action,
2. XSS context khusus,
3. raw HTML rendering,
4. file upload security,
5. hidden field tampering,
6. CSRF/session behavior,
7. client-side state protection,
8. sensitive data dalam view state,
9. error message leakage,
10. IDOR/action tampering.

Security rule:

```text
Treat the browser as hostile, even when using Faces components.
```

---

## 36. Performance Mental Model untuk Faces

Faces performance dipengaruhi oleh:

1. component tree size,
2. view state size,
3. number of inputs/components,
4. number of rows in table,
5. EL getter cost,
6. converter/validator cost,
7. service calls in render path,
8. session size,
9. Ajax execute/render size,
10. resource loading,
11. serialization,
12. clustering/session replication.

Jangan hanya mengukur database query. Pada Faces app besar, bottleneck bisa berada di:

```text
restore view -> validate -> update model -> render tree -> save state
```

Performance heuristic:

```text
Minimize tree size.
Minimize view state size.
Keep getters cheap.
Keep UI state DTO-based.
Paginate large data.
Avoid service calls from getters.
Use Ajax execute/render narrowly.
Measure lifecycle timing.
```

---

## 37. Top 1% Mental Model: Faces sebagai State Machine UI

Cara paling kuat memahami Faces adalah melihatnya sebagai **state machine untuk UI server-side**.

State-nya:

1. component tree,
2. component submitted values,
3. component local values,
4. validation status,
5. backing bean state,
6. messages,
7. navigation outcome,
8. view state,
9. session/user context.

Transitions-nya:

1. initial GET,
2. postback submit,
3. Ajax request,
4. validation failure,
5. action success,
6. action failure,
7. navigation redirect,
8. view expired,
9. session expired.

Invariants-nya:

1. Model hanya di-update jika conversion/validation sukses.
2. Action hanya reliable jika lifecycle mencapai invoke application.
3. Component id harus stabil untuk postback.
4. UI visibility bukan authorization.
5. Browser data tidak dipercaya.
6. Long-lived UI state harus kecil, serializable, dan tidak menyimpan resource berat.
7. Getter di render path harus murah dan bebas side effect.
8. Dynamic component tree harus deterministik.
9. Large data harus dipaginasi di service/query layer.
10. View state adalah production concern, bukan detail internal.

Jika Anda memegang invariant ini, Faces menjadi jauh lebih bisa diprediksi.

---

## 38. Contoh End-to-End Mental Model: Search Page

### 38.1 Requirement

Halaman search case:

1. user mengisi keyword dan status,
2. klik Search,
3. hasil tampil di table,
4. validation menolak range tanggal invalid,
5. user bisa klik Open detail,
6. hanya action sesuai permission yang muncul.

### 38.2 Backing Bean

```java
@Named
@ViewScoped
public class CaseSearchBean implements Serializable {
    private CaseSearchForm form = new CaseSearchForm();
    private List<CaseRowView> results = List.of();

    @Inject
    private CaseSearchService caseSearchService;

    @Inject
    private PermissionService permissionService;

    public void search() {
        results = caseSearchService.search(form);
    }

    public boolean canOpen(CaseRowView row) {
        return permissionService.canOpen(row.id());
    }

    public String open(CaseRowView row) {
        return "/cases/detail?faces-redirect=true&id=" + row.id();
    }

    public CaseSearchForm getForm() {
        return form;
    }

    public List<CaseRowView> getResults() {
        return results;
    }
}
```

### 38.3 View

```xml
<h:form id="searchForm">
    <h:panelGrid columns="2">
        <h:outputLabel for="keyword" value="Keyword" />
        <h:inputText id="keyword" value="#{caseSearchBean.form.keyword}" />

        <h:outputLabel for="status" value="Status" />
        <h:selectOneMenu id="status" value="#{caseSearchBean.form.status}">
            <f:selectItem itemLabel="All" itemValue="" />
            <f:selectItems value="#{referenceDataBean.caseStatuses}" />
        </h:selectOneMenu>
    </h:panelGrid>

    <h:commandButton value="Search" action="#{caseSearchBean.search}" />

    <h:messages globalOnly="true" />

    <h:dataTable value="#{caseSearchBean.results}" var="row" rendered="#{not empty caseSearchBean.results}">
        <h:column>
            <f:facet name="header">Case No</f:facet>
            <h:outputText value="#{row.caseNumber}" />
        </h:column>

        <h:column>
            <f:facet name="header">Status</f:facet>
            <h:outputText value="#{row.statusLabel}" />
        </h:column>

        <h:column>
            <f:facet name="header">Action</f:facet>
            <h:commandLink value="Open"
                           action="#{caseSearchBean.open(row)}"
                           rendered="#{caseSearchBean.canOpen(row)}" />
        </h:column>
    </h:dataTable>
</h:form>
```

### 38.4 Lifecycle

Initial GET:

```text
restore/build view
render empty form
save view state
```

Search POST:

```text
restore view
apply request values: keyword/status submitted
process validations: convert/validate
update model: form.keyword/form.status set
invoke application: search()
render response: table shown
save updated view state
```

Open row POST:

```text
restore view
decode clicked command link
validation may still run for form inputs
update model if valid
invoke application: open(row)
navigation redirect to detail
```

Important caveat: if unrelated form inputs are invalid, clicking Open may fail before action. This is why large screens often need careful form segmentation, `immediate`, Ajax execute, or separate forms.

---

## 39. Common Misconceptions

### Misconception 1: Faces is just JSP with XML tags

Wrong. Faces has component tree, lifecycle, state, events, validation, and rendering.

### Misconception 2: `rendered=false` is authorization

Wrong. It only affects UI rendering. Server action must still enforce authorization.

### Misconception 3: Getter can perform service calls

Dangerous. Getters can be called many times during render. Heavy getter logic causes performance and side effect bugs.

### Misconception 4: Session scope is easiest

Temporarily easy, eventually painful. It causes stale state, memory pressure, multi-tab conflicts, and replication cost.

### Misconception 5: Ajax makes Faces stateless

Wrong. Faces Ajax still uses server lifecycle and view state.

### Misconception 6: Component library solves architecture

Wrong. PrimeFaces/OmniFaces can help, but poor state boundary and lifecycle misunderstanding still break the system.

### Misconception 7: Validation failure is an error

Not always. In Faces, validation failure is normal control flow: model is not updated and response is rendered with messages.

### Misconception 8: View state is just an implementation detail

Wrong. View state affects memory, security, clustering, payload size, and user experience.

---

## 40. Faces Design Heuristics for Enterprise Engineers

Use these rules early:

1. Treat Facelets as component declaration, not text template.
2. Treat backing bean as UI orchestration, not business service.
3. Use DTO/view model for UI state.
4. Keep entity/persistence context away from view state.
5. Prefer view scope for interactive one-page state.
6. Avoid large session beans.
7. Keep getters cheap and side-effect free.
8. Use service methods for business use cases.
9. Enforce authorization in service/action, not only `rendered`.
10. Segment large forms carefully.
11. Understand validation failure before debugging missing actions.
12. Keep component ids stable.
13. Avoid dynamic tree instability across postback.
14. Paginate large tables server-side.
15. Measure view state size.
16. Keep Ajax `execute` and `render` narrow.
17. Use PRG after state-changing actions.
18. Localize messages deliberately.
19. Treat client-submitted data as hostile.
20. Test rendered HTML and lifecycle-sensitive flows.

---

## 41. Comparison Matrix: JSP MVC vs Faces MVC vs SPA

| Dimension | JSP MVC | Jakarta Faces | SPA + API |
|---|---|---|---|
| Primary abstraction | Template | Component tree | Client components |
| Request model | Controller prepares data | Lifecycle processes components | API calls/state updates |
| State | Request/session/application | View/session/component state | Browser/app store |
| Validation | Manual/controller/service | Integrated lifecycle | Client + server API |
| Rendering | Server text output | Server component renderer | Browser rendering |
| Ajax | Manual JS/API | Partial lifecycle/render | Native model |
| Best fit | Simple server-rendered pages | Form-heavy enterprise UI | Rich interactive products |
| Main risk | View logic leakage | State/lifecycle complexity | Client complexity/API duplication |
| Scaling concern | server rendering/session | view state/session/lifecycle | API/backend + client payload |
| Debugging model | request attributes + HTML | lifecycle + tree + state | JS state + network + backend |

---

## 42. What Will Be Covered Next

Bagian ini adalah overview. Detail berikutnya akan dibahas bertahap:

1. Facelets syntax dan templating.
2. CDI managed beans dan scope.
3. Lifecycle phase-by-phase.
4. Standard components.
5. Conversion and validation.
6. Navigation and actions.
7. State management.
8. Ajax partial rendering.
9. Composite components.
10. Custom components/renderers.
11. Security.
12. Performance.
13. Ecosystem.
14. Migration.
15. Enterprise architecture patterns.
16. Capstone case management UI.

---

## 43. Practical Checklist: Sebelum Menulis Faces Page

Sebelum membuat halaman Faces, jawab pertanyaan ini:

1. Apakah halaman ini initial GET only, postback-heavy, atau Ajax-heavy?
2. State apa yang harus bertahan antar postback?
3. Scope backing bean apa yang paling tepat?
4. Apakah data UI berupa DTO/view model, bukan entity besar?
5. Komponen mana yang melakukan input?
6. Conversion/validation apa yang diperlukan?
7. Action user apa saja?
8. Apakah action tersebut state-changing?
9. Apakah perlu redirect setelah action?
10. Apa authorization rule untuk setiap action?
11. Apakah visibility sudah dipisah dari enforcement?
12. Apakah table perlu pagination server-side?
13. Apakah getter bebas service call berat?
14. Apakah Ajax execute/render sudah minimal?
15. Apakah component id stabil?
16. Apakah pesan error/success localized dan aman?
17. Apakah view state berpotensi besar?
18. Apakah multi-tab behavior aman?
19. Apakah session expiration/view expiration ditangani?
20. Bagaimana test akan membuktikan flow ini benar?

---

## 44. Mini Case: Kenapa Action Tidak Terpanggil?

Misal ada halaman:

```xml
<h:form>
    <h:inputText id="remarks" value="#{decisionBean.remarks}" required="true" />
    <h:commandButton value="Cancel" action="#{decisionBean.cancel}" />
</h:form>
```

User mengosongkan `remarks`, lalu klik Cancel. Action `cancel()` tidak terpanggil.

Engineer yang belum paham Faces mungkin berkata:

```text
Button rusak.
Bean tidak ditemukan.
Method salah.
```

Engineer yang paham lifecycle akan berkata:

```text
Cancel button berada dalam form yang memiliki required input.
Saat postback, Process Validations gagal sebelum Invoke Application.
Karena itu action cancel tidak dipanggil.
```

Solusi tergantung intent:

1. Pisahkan cancel ke form lain.
2. Gunakan navigation link GET jika cancel tidak butuh submit.
3. Gunakan `immediate="true"` dengan pemahaman lifecycle.
4. Gunakan Ajax/execute terbatas.
5. Rancang form segmentation.

Ini contoh bagaimana lifecycle mengubah cara debugging.

---

## 45. Mini Case: Data Table Lambat

Misal:

```xml
<h:dataTable value="#{caseBean.cases}" var="case">
    <h:column>
        <h:outputText value="#{case.assignedOfficer.name}" />
    </h:column>
    <h:column>
        <h:outputText value="#{case.latestAction.description}" />
    </h:column>
</h:dataTable>
```

Gejala:

1. halaman lambat,
2. database query banyak,
3. kadang LazyInitializationException,
4. memory naik.

Root cause mungkin:

1. `cases` adalah entity list, bukan DTO.
2. Getter relation memicu lazy query saat render.
3. Tidak ada pagination.
4. View menyimpan object graph besar.
5. Render memanggil getter berkali-kali.

Solusi:

```text
Service layer membuat CaseRowView projection.
Query mengambil field yang diperlukan.
Pagination/filtering/sorting dilakukan di DB/service.
View hanya menampilkan DTO datar.
```

---

## 46. Mini Case: Multi-Tab Conflict

Jika user membuka dua tab halaman edit case yang memakai `@SessionScoped` bean yang sama:

```text
Tab A -> caseId=100
Tab B -> caseId=200
Tab A submit -> bean sudah berisi caseId=200
```

Akibat:

1. update salah case,
2. validation membingungkan,
3. data tampak meloncat,
4. security risk.

Solusi:

1. Hindari session scope untuk per-page edit state.
2. Gunakan view scope.
3. Sertakan id eksplisit.
4. Re-load authoritative data saat action.
5. Enforce optimistic locking/authorization di service.

---

## 47. Faces dan Regulatory/Case Management Mindset

Untuk sistem regulatory/case management, Faces bisa cocok karena banyak kebutuhan berupa:

1. role-based action visibility,
2. form validation,
3. message rendering,
4. case detail workflow,
5. document upload,
6. audit trail display,
7. review/approve/reject action,
8. internal back-office productivity,
9. server-side consistency,
10. data-heavy tables.

Namun desainnya harus defensible:

1. action visibility bukan authorization,
2. workflow transition harus divalidasi server-side,
3. stale case state harus dicegah,
4. concurrent action harus ditangani,
5. audit event harus dicatat di service/domain layer,
6. view state tidak boleh menyimpan sensitive object graph,
7. every state-changing command must be idempotency/concurrency aware.

Faces bisa menjadi UI adapter yang baik, selama business invariants tetap berada di application/domain layer.

---

## 48. Mental Diagram Keseluruhan

```text
Browser
  |
  | GET/POST/Ajax
  v
Servlet Container
  |
  v
FacesServlet
  |
  v
Faces Lifecycle
  |
  +-- Restore View
  |     component tree built/restored
  |
  +-- Apply Request Values
  |     request params decoded into components
  |
  +-- Process Validations
  |     convert + validate + messages
  |
  +-- Update Model Values
  |     component local values written to backing bean
  |
  +-- Invoke Application
  |     action/listener/navigation
  |
  +-- Render Response
  |     component tree rendered to HTML/partial response
  |     view state saved
  |
  v
Facelets / Components / Renderers
  |
  v
HTML response

Backing Beans
  |
  v
Application Services
  |
  v
Domain / Persistence / External Systems
```

---

## 49. Summary

Jakarta Faces harus dipahami sebagai **server-side component-based MVC framework**, bukan sekadar template engine.

Inti pemahamannya:

1. Facelets mendeklarasikan component tree.
2. FacesServlet menjalankan lifecycle.
3. Component tree dipulihkan/dibangun pada request.
4. Postback memproses submitted value melalui komponen.
5. Conversion dan validation terjadi sebelum model update.
6. Model update hanya terjadi jika input valid.
7. Action dipanggil pada invoke application.
8. Response dirender dari component tree.
9. View state menyimpan informasi agar postback berikutnya bisa diproses.
10. Backing bean adalah UI orchestration boundary, bukan business layer.
11. Service/domain tetap menjaga business invariant, authorization, audit, dan workflow correctness.
12. Faces cocok untuk form-heavy enterprise/back-office apps, tetapi perlu disiplin state, lifecycle, security, dan performance.

Jika JSP adalah:

```text
request -> template -> response
```

Faces adalah:

```text
request -> component tree lifecycle -> stateful UI processing -> response
```

Perbedaan ini adalah fondasi semua part berikutnya.

---

## 50. Referensi Resmi dan Bacaan Lanjutan

1. Jakarta Faces 4.1 Specification — `https://jakarta.ee/specifications/faces/4.1/`
2. Jakarta Faces specifications index — `https://jakarta.ee/specifications/faces/`
3. Jakarta Faces 4.0 specification document — `https://jakarta.ee/specifications/faces/4.0/jakarta-faces-4.0`
4. Jakarta EE specifications index — `https://jakarta.ee/specifications/`
5. Jakarta Expression Language specifications — `https://jakarta.ee/specifications/expression-language/`
6. Jakarta Servlet specifications — `https://jakarta.ee/specifications/servlet/`
7. Jakarta Contexts and Dependency Injection specifications — `https://jakarta.ee/specifications/cdi/`
8. Jakarta Bean Validation specifications — `https://jakarta.ee/specifications/bean-validation/`
9. Jakarta Security specifications — `https://jakarta.ee/specifications/security/`
10. Oracle/Java EE historical JSF lifecycle tutorial — useful for historical terminology and lifecycle explanation.

---

## 51. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
15-facelets-xhtml-view-authoring-templates-composition-components.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./13-testing-jsp-and-tag-libraries.md">⬅️ Part 13 — Testing JSP and Tag Libraries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./15-facelets-xhtml-view-authoring-templates-composition-components.md">Part 15 — Facelets and XHTML View Authoring: Templates, Composition, and Components ➡️</a>
</div>
