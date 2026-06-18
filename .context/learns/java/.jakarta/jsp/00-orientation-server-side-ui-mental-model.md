# Part 0 — Orientation: Mental Model Server-Side UI di Java

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `00-orientation-server-side-ui-mental-model.md`  
> Scope: Java 8 sampai Java 25, Java EE/Jakarta EE, JSP/Jakarta Pages, Expression Language, Tag Library/JSTL, Jakarta Faces/JSF  
> Status seri: **belum selesai**. Ini adalah bagian 0 dari roadmap 30+ bagian.

---

## 0. Tujuan Bagian Ini

Bagian ini bukan dimaksudkan untuk langsung menghafal semua tag JSP, semua atribut JSF/Faces, atau semua konfigurasi `web.xml`. Bagian ini adalah fondasi mental model.

Setelah menyelesaikan bagian ini, kamu seharusnya bisa menjawab pertanyaan-pertanyaan berikut dengan tajam:

1. Apa perbedaan Servlet, JSP/Jakarta Pages, EL, JSTL/custom tags, dan Jakarta Faces?
2. Kenapa JSP sebenarnya bukan “HTML yang bisa disisipkan Java”, tetapi **template yang diterjemahkan menjadi Servlet**?
3. Kenapa Expression Language bukan sekadar `${foo}`, tetapi **binding/evaluation layer** yang punya resolver chain, coercion, dan security implication?
4. Kenapa JSTL/tag library bukan sekadar shortcut looping, tetapi **mekanisme memindahkan view logic dari Java scriptlet ke reusable tag abstraction**?
5. Kenapa Jakarta Faces/JSF bukan “template engine”, tetapi **component-based MVC framework** dengan lifecycle, component tree, event model, validation, navigation, state saving, dan rendering?
6. Apa trade-off server-side UI dibanding SPA/API-first frontend?
7. Bagaimana memutuskan kapan JSP/Pages cukup, kapan Faces masuk akal, dan kapan keduanya sebaiknya dihindari?
8. Bagaimana memikirkan risiko production: XSS, CSRF, session bloat, view state, stale page, duplicate submit, memory pressure, dan migration trap?

Target dari part ini adalah membentuk **peta mental**. API detail akan dibedah pada part berikutnya.

---

## 1. Peta Teknologi: Apa yang Sedang Kita Pelajari?

Di dalam ekosistem Java web tradisional dan Jakarta EE modern, ada beberapa lapisan yang sering tercampur dalam pembahasan sehari-hari:

```text
Browser
  |
  | HTTP request / response
  v
Servlet Container / Jakarta Servlet Runtime
  |
  +-- Servlet / Filter / Listener
  |
  +-- Jakarta Pages / JSP
  |     +-- Expression Language
  |     +-- Standard Tag Library / JSTL / Jakarta Tags
  |     +-- Custom Tags / Tag Files
  |
  +-- Jakarta Faces / JSF
        +-- Facelets View Declaration Language
        +-- Component Tree
        +-- Lifecycle
        +-- Converters / Validators
        +-- Navigation
        +-- State Saving
        +-- Renderers
```

Secara sederhana:

| Teknologi | Mental model utama | Output utama | Cocok untuk |
|---|---|---|---|
| Servlet | Request handler imperatif | Response HTTP | Controller low-level, filter, endpoint custom |
| JSP / Jakarta Pages | Template yang dikompilasi menjadi Servlet | HTML/XML/text dinamis | Server-rendered page sederhana sampai menengah |
| Expression Language | Expression evaluator dan binding resolver | Nilai dari scope/bean/model | Mengakses data dari view secara ringkas |
| JSTL / Jakarta Tags | Tag library untuk view logic umum | Markup hasil eksekusi tag | Conditional, loop, format, URL, i18n |
| Custom Tags | Reusable view abstraction | Markup reusable | Komponen view ringan di JSP |
| Jakarta Faces / JSF | Component-based server-side MVC UI framework | HTML dari component tree | Form-heavy enterprise UI, admin console, workflow UI |
| Facelets | View declaration language Faces | Component tree declaration | View modern di Faces |

Yang sering membuat bingung: **JSP dan Faces sama-sama bisa menghasilkan HTML**, tetapi cara berpikirnya sangat berbeda.

JSP berpikir seperti ini:

```text
Request datang
  -> Controller menyiapkan data
  -> JSP membaca data dari scope
  -> JSP + EL + tags menghasilkan HTML
  -> Response selesai
```

Faces berpikir seperti ini:

```text
Request/postback datang
  -> Restore/build component tree
  -> Decode request values ke component
  -> Convert dan validate input
  -> Update model
  -> Invoke action/event
  -> Render component tree menjadi HTML
  -> Simpan state view untuk request berikutnya
```

JSP adalah template rendering. Faces adalah UI framework berbasis component lifecycle.

---

## 2. Naming Evolution: Javax ke Jakarta

Sebelum masuk teknis, penting membenahi nama, karena banyak dokumentasi lama memakai istilah berbeda.

### 2.1 Nama Lama dan Nama Baru

| Era | Nama umum lama | Nama Jakarta modern | Package umum |
|---|---|---|---|
| Java EE | JavaServer Pages / JSP | Jakarta Pages / Jakarta Server Pages | `javax.servlet.jsp.*` lalu `jakarta.servlet.jsp.*` |
| Java EE | JavaServer Faces / JSF | Jakarta Faces / Jakarta Server Faces | `javax.faces.*` lalu `jakarta.faces.*` |
| Java EE | Expression Language / EL | Jakarta Expression Language | `javax.el.*` lalu `jakarta.el.*` |
| Java EE | JSTL | Jakarta Standard Tag Library / Jakarta Tags | `javax.servlet.jsp.jstl.*` lalu `jakarta.servlet.jsp.jstl.*` |

Dalam proyek nyata, kamu akan menemukan campuran istilah:

- “JSP” masih sering dipakai bahkan ketika spesifikasi resminya Jakarta Pages.
- “JSF” masih sering dipakai bahkan ketika spesifikasi resminya Jakarta Faces.
- “JSTL” masih dipakai untuk Jakarta Standard Tag Library.
- Banyak library lama masih memakai `javax.*`.
- Banyak container modern sudah memakai `jakarta.*`.

### 2.2 Break Besar: `javax.*` ke `jakarta.*`

Perubahan namespace dari `javax.*` ke `jakarta.*` bukan cosmetic rename kecil. Dampaknya bisa besar:

1. Source code import berubah.
2. Binary compatibility putus antara library `javax` dan runtime `jakarta`.
3. Deployment descriptor berubah namespace XML-nya.
4. Tag library URI bisa berubah.
5. Dependency Maven/Gradle berubah group/artifact/version.
6. Container yang dipakai harus kompatibel dengan platform target.
7. Library UI seperti PrimeFaces/OmniFaces harus sesuai generasi JSF/Faces-nya.

Contoh perbedaan high-level:

```java
// Era Java EE / Jakarta EE 8 style
import javax.faces.view.ViewScoped;
import javax.inject.Named;

// Era Jakarta EE 9+ style
import jakarta.faces.view.ViewScoped;
import jakarta.inject.Named;
```

Kalau satu aplikasi memakai runtime Jakarta EE 10/11 tetapi dependency pihak ketiga masih `javax.faces.*`, biasanya error-nya bukan error konsep, tetapi error binary namespace mismatch.

---

## 3. Baseline Versi Java 8 sampai Java 25

Seri ini membahas rentang Java 8 sampai Java 25. Itu berarti kita harus sadar bahwa “Java version” dan “Jakarta EE version” bukan hal yang sama.

### 3.1 Java Version vs Jakarta EE Version

Java version mengatur bahasa, runtime JVM, standard library, GC, module system, records, virtual threads, pattern matching, dan lain-lain.

Jakarta EE version mengatur spesifikasi enterprise seperti Servlet, Pages, Faces, EL, CDI, Validation, Persistence, Security, Mail, Batch, dan sebagainya.

Aplikasi bisa saja:

- ditulis dengan Java 8,
- memakai Java EE 8,
- deploy ke Tomcat 9,
- menggunakan JSP 2.3 dan JSF 2.3.

Atau:

- ditulis dengan Java 21/25,
- memakai Jakarta EE 11 APIs,
- deploy ke container EE 11 compatible,
- menggunakan Jakarta Pages 4.0, Jakarta Faces 4.1, EL 6.0.

### 3.2 Peta Kasar Generasi

| Target | Namespace | Java minimum umum | Karakter |
|---|---|---:|---|
| Java EE 7/8 | `javax.*` | Java 8 | legacy enterprise baseline yang masih banyak di production |
| Jakarta EE 8 | `javax.*` | Java 8 | bridge dari Java EE ke Eclipse/Jakarta, masih namespace lama |
| Jakarta EE 9/9.1 | `jakarta.*` | Java 8/11 tergantung profile/container | namespace break besar |
| Jakarta EE 10 | `jakarta.*` | Java 11 | modernisasi API, Faces 4.0, Pages 3.1 |
| Jakarta EE 11 | `jakarta.*` | Java 17+ | baseline modern, Pages 4.0, Faces 4.1, EL 6.0 |
| Java 25 era | `jakarta.*` untuk platform modern | Java 25 bisa menjalankan app modern bila container support | JDK LTS terbaru, perlu cek support container/library |

Jakarta EE 11 secara resmi menetapkan **Java SE 17 atau lebih tinggi** sebagai minimum platform. Jakarta Pages 4.0 adalah release untuk Jakarta EE 11. Jakarta Faces 4.1 juga release untuk Jakarta EE 11. Jakarta Expression Language 6.0 adalah release untuk Jakarta EE 11. Jakarta Standard Tag Library 3.0 adalah release stabil untuk Jakarta EE 10, dengan 3.1 masih under development untuk Jakarta EE 12 pada saat penulisan.

### 3.3 Implikasi Java 8–25 untuk Materi Ini

Untuk UI server-side, fitur Java terbaru tidak selalu langsung muncul di file `.jsp` atau `.xhtml`, tetapi memengaruhi layer sekitarnya:

1. **Java 8**
   - Banyak legacy JSP/JSF production masih berada di sini.
   - Lambda/Stream bisa dipakai di service/view model, tetapi sebaiknya tidak dieksekusi berat di view.
   - JSF 2.x, JSP 2.x, JSTL 1.2 umum ditemukan.

2. **Java 11**
   - Baseline umum untuk Jakarta EE 10.
   - Module system sudah ada, walaupun banyak aplikasi web tetap memakai classpath.
   - Beberapa API Java SE lama sudah dihapus dari JDK, sehingga dependency harus eksplisit.

3. **Java 17**
   - Minimum Jakarta EE 11.
   - Records bisa menjadi DTO/view model yang immutable-ish, tetapi perlu hati-hati dengan framework binding.
   - Sealed classes bisa membantu modeling state/action di backend.

4. **Java 21**
   - Virtual threads relevan untuk request handling di container yang mendukung.
   - Untuk JSP/Faces, virtual threads tidak menghapus kebutuhan mengelola session state dan lifecycle dengan benar.
   - Structured concurrency/scoped values masih perlu dilihat status preview/final dan support runtime.

5. **Java 25**
   - JDK 25 adalah LTS terbaru di era modern.
   - App UI Jakarta bisa berjalan di Java 25 jika container, library, dan dependency sudah certified/tested.
   - Risiko bukan hanya language compatibility, tetapi container instrumentation, bytecode enhancement, reflection, serialization, dan library UI compatibility.

Prinsipnya: **Java version memberi kemampuan runtime; Jakarta EE version memberi kontrak API; container memberi perilaku aktual production**.

---

## 4. Mental Model Besar: Request, View, State, Lifecycle

Server-side UI Java bisa dipahami dengan empat poros utama:

```text
1. Request
   Apa yang datang dari browser?

2. View
   Bagaimana server mendeklarasikan atau menghasilkan HTML?

3. State
   Di mana data hidup antar request?

4. Lifecycle
   Dalam urutan apa framework memproses input, validasi, action, dan rendering?
```

Setiap bug besar di JSP/Faces biasanya bisa dikembalikan ke salah satu dari empat poros ini.

### 4.1 Request

Request adalah unit kerja HTTP:

```text
GET /cases/123
POST /cases/123/action
GET /cases?page=2&status=OPEN
POST /login
```

Pada server-side UI, request tidak hanya meminta data mentah seperti REST API. Request sering meminta **halaman final**:

```text
Browser -> Server: GET /cases/123
Server -> Browser: HTML lengkap halaman detail case
```

Atau mengirim form:

```text
Browser -> Server: POST /cases/123/approve
Server -> Browser: redirect/render result page
```

Pada JSP, request biasanya diproses oleh Servlet/controller lalu forward ke JSP.

Pada Faces, request masuk ke FacesServlet, lalu Faces lifecycle memproses view/component tree.

### 4.2 View

View adalah representasi UI di server.

Di JSP:

```jsp
<h1>${caseDetail.title}</h1>
<c:if test="${caseDetail.escalated}">
  <span class="badge">Escalated</span>
</c:if>
```

Di Faces:

```xml
<h:form>
  <h:outputText value="#{caseBean.caseDetail.title}" />
  <h:commandButton value="Approve" action="#{caseBean.approve}" />
</h:form>
```

Keduanya tampak mirip karena sama-sama bisa menghasilkan HTML, tetapi runtime mental model-nya berbeda.

JSP mengeksekusi template.
Faces membangun dan memproses component tree.

### 4.3 State

HTTP stateless. UI enterprise tidak stateless.

Ada banyak state yang sering muncul:

1. Current user.
2. Selected filters.
3. Pagination position.
4. Form draft.
5. Validation errors.
6. Multi-step wizard progress.
7. CSRF token.
8. Flash message.
9. View state.
10. Authorization context.
11. Dirty form state.
12. Optimistic locking version.

Pertanyaan penting bukan “bisa disimpan di mana?”, tetapi:

> State ini siapa pemiliknya, valid sampai kapan, boleh berubah oleh siapa, perlu direplikasi atau tidak, dan apa yang terjadi kalau stale?

Scope umum:

| Scope | Umur | Risiko utama | Cocok untuk |
|---|---|---|---|
| Request | satu request | hilang setelah response | view model hasil query, error render sekali |
| Flash | satu redirect berikutnya | implementasi berbeda | success/error message setelah PRG |
| View | selama view tertentu hidup | view expired, memory | Faces form state |
| Session | selama login/session | bloat, concurrency, stale | user context, small preferences |
| Application | selama app hidup | shared mutable state | config/cache read-mostly |

### 4.4 Lifecycle

Lifecycle adalah jawaban untuk pertanyaan:

> “Kode ini dieksekusi kapan?”

Di JSP lifecycle-nya relatif sederhana:

```text
JSP file
  -> translated to servlet source
  -> compiled to servlet class
  -> servlet initialized
  -> request processed by generated _jspService()
  -> response rendered
```

Di Faces lifecycle-nya lebih kompleks:

```text
Restore View
  -> Apply Request Values
  -> Process Validations
  -> Update Model Values
  -> Invoke Application
  -> Render Response
```

Banyak bug Faces lahir karena developer mengira prosesnya seperti MVC biasa:

```text
POST -> call action -> validate -> render
```

Padahal Faces melakukan decode, conversion, validation, model update, action, dan render dalam fase-fase yang spesifik. Kalau action tidak terpanggil, value tidak berubah, atau validation “aneh”, biasanya jawabannya ada di lifecycle.

---

## 5. JSP/Jakarta Pages: Mental Model Utama

JSP/Jakarta Pages adalah template engine standar di ekosistem Jakarta Servlet.

Definisi praktis:

> JSP/Jakarta Pages adalah file template text/HTML/XML yang dapat memakai EL, tags, dan embedded Java code, lalu diterjemahkan dan dikompilasi menjadi Servlet yang menghasilkan response.

### 5.1 JSP Bukan File yang “Diinterpretasi” Sederhana

Saat request pertama kali mengenai JSP, container biasanya melakukan:

```text
case-list.jsp
  -> translate menjadi Java source servlet
  -> compile menjadi class
  -> load class
  -> panggil _jspService(request, response)
```

Model ini penting karena menjelaskan banyak hal:

1. Error JSP sering muncul sebagai compilation error generated servlet.
2. Deklarasi field di JSP bisa menjadi field servlet, sehingga berbahaya untuk thread safety.
3. Scriptlet dieksekusi di method request processing.
4. Template text menjadi `out.write(...)`.
5. EL dan tags menjadi panggilan runtime helper/tag handler.
6. JSP dapat punya cold-start cost saat belum precompiled.

### 5.2 JSP Ideal Flow

Dalam arsitektur yang sehat, JSP tidak mengambil data langsung dari database dan tidak menjalankan business logic berat.

Flow yang lebih sehat:

```text
Browser
  -> Servlet/Controller
      -> validate request parameter
      -> call service/application layer
      -> build view model
      -> set request attributes
      -> forward to JSP
  -> JSP
      -> render HTML using EL/tags
  -> Browser
```

Contoh controller sederhana:

```java
@WebServlet("/cases")
public class CaseListServlet extends HttpServlet {
    private CaseQueryService caseQueryService;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        String status = request.getParameter("status");
        CaseListViewModel viewModel = caseQueryService.search(status);

        request.setAttribute("model", viewModel);
        request.getRequestDispatcher("/WEB-INF/views/cases/list.jsp")
               .forward(request, response);
    }
}
```

JSP-nya:

```jsp
<h1>Case List</h1>

<c:forEach items="${model.cases}" var="caseItem">
  <div class="case-row">
    <span>${caseItem.referenceNo}</span>
    <span>${caseItem.status}</span>
  </div>
</c:forEach>
```

Mental model-nya:

```text
Controller owns decision.
Service owns business logic.
View model owns display data.
JSP owns markup rendering.
```

### 5.3 JSP yang Tidak Sehat

Contoh anti-pattern:

```jsp
<%
  Connection con = DriverManager.getConnection(...);
  PreparedStatement ps = con.prepareStatement("select * from cases");
  ResultSet rs = ps.executeQuery();
  while (rs.next()) {
%>
    <div><%= rs.getString("TITLE") %></div>
<%
  }
%>
```

Masalah:

1. View mengakses database langsung.
2. Resource management rawan bocor.
3. Testability buruk.
4. Security review sulit.
5. Error handling kacau.
6. HTML escaping sering dilupakan.
7. Tidak ada separation of concerns.
8. Performance tuning menjadi tersebar di template.

Scriptlet-heavy JSP biasanya tanda bahwa aplikasi belum punya boundary MVC yang sehat.

---

## 6. Expression Language: Mental Model Utama

Expression Language atau EL sering terlihat sederhana:

```jsp
${user.name}
${caseItem.status}
${not empty errors}
```

Tapi secara konseptual, EL adalah engine yang menjawab:

> Dari expression string ini, object mana yang dimaksud, property/method mana yang dipanggil, bagaimana null/coercion ditangani, dan bagaimana hasilnya dikembalikan ke view?

### 6.1 EL sebagai Resolver Chain

Ketika menulis:

```jsp
${model.caseDetail.title}
```

EL tidak “magically” tahu `model`. Ia akan mencari melalui resolver chain.

Simplified:

```text
Expression: model.caseDetail.title

1. Cari variable "model"
   - page scope?
   - request scope?
   - session scope?
   - application scope?
   - CDI bean?
   - implicit object?

2. Setelah object model ditemukan:
   - akses property caseDetail
   - bisa lewat getter getCaseDetail()
   - bisa map key "caseDetail"
   - bisa field/property tergantung resolver

3. Setelah caseDetail ditemukan:
   - akses property title

4. Coerce hasil ke target type/string bila perlu
```

EL punya resolver chain. Resolver chain inilah yang membuat EL fleksibel, tetapi juga bisa menyebabkan bug:

1. Nama attribute bertabrakan antar scope.
2. Getter punya side effect.
3. Property null diam-diam menghasilkan empty output.
4. Coercion membuat nilai terlihat “benar” padahal kehilangan detail.
5. Method overload ambigu.
6. CDI bean dan scoped attribute punya nama sama.

### 6.2 `${...}` vs `#{...}`

Secara historis:

- `${...}` sering diasosiasikan dengan immediate evaluation di JSP.
- `#{...}` sering diasosiasikan dengan deferred expression di JSF/Faces.

Di JSP/JSTL, `${...}` umum dipakai untuk render value.

Di Faces, `#{...}` penting karena value/method expression bisa dievaluasi pada fase lifecycle berbeda:

```xml
<h:inputText value="#{caseBean.form.title}" />
<h:commandButton value="Submit" action="#{caseBean.submit}" />
```

`value` bukan hanya dibaca saat render. Pada postback, Faces juga bisa:

1. decode submitted value,
2. convert,
3. validate,
4. update `caseBean.form.title`,
5. render ulang value/error.

Jadi dalam Faces, expression bukan sekadar output. Expression adalah binding antara component dan model/backing bean.

### 6.3 Getter Tidak Boleh Mahal

Karena EL memanggil getter, banyak developer memasukkan logic mahal ke getter:

```java
public List<CaseDto> getCases() {
    return caseRepository.findAllOpenCases();
}
```

Ini berbahaya, terutama di Faces, karena getter bisa dipanggil berkali-kali selama lifecycle/rendering.

Lebih sehat:

```java
@PostConstruct
public void init() {
    this.cases = caseQueryService.findOpenCases();
}

public List<CaseDto> getCases() {
    return cases;
}
```

Rule of thumb:

> Getter yang dipakai view harus cheap, deterministic, dan side-effect-free.

---

## 7. Tags/JSTL: Mental Model Utama

JSTL/Jakarta Standard Tag Library menyediakan tag standar untuk kebutuhan umum JSP:

- conditional,
- loop,
- output escaping,
- URL generation,
- formatting,
- i18n,
- XML processing,
- SQL tags legacy.

Contoh:

```jsp
<c:if test="${model.escalated}">
  <span class="badge badge-danger">Escalated</span>
</c:if>

<c:forEach items="${model.cases}" var="caseItem" varStatus="status">
  <tr>
    <td>${status.index + 1}</td>
    <td><c:out value="${caseItem.referenceNo}" /></td>
  </tr>
</c:forEach>
```

### 7.1 JSTL Mengurangi Scriptlet, Bukan Menghapus Kebutuhan Desain

JSTL lebih baik daripada scriptlet untuk view logic sederhana, tetapi tidak berarti semua logic boleh masuk view.

Bandingkan:

```jsp
<c:choose>
  <c:when test="${caseItem.status == 'OPEN' && user.canApprove && not caseItem.locked}">
    <button>Approve</button>
  </c:when>
  <c:otherwise>
    <span>Not available</span>
  </c:otherwise>
</c:choose>
```

Ini masih wajar jika hanya presentation branching.

Tapi kalau view mulai berisi aturan kompleks:

```jsp
<c:if test="${caseItem.status == 'OPEN' 
          && caseItem.daysSinceSubmitted > 14
          && user.role == 'SENIOR_OFFICER'
          && caseItem.riskScore > 80
          && caseItem.hasAllMandatoryDocs
          && not caseItem.pendingExternalCheck}">
```

Itu tanda rule seharusnya dipindahkan ke view model/service:

```java
public final class CaseActionViewModel {
    private final boolean approvable;
    private final String approveDisabledReason;
}
```

Lalu JSP hanya:

```jsp
<c:if test="${caseItem.approvable}">
  <button>Approve</button>
</c:if>
```

### 7.2 Custom Tags sebagai Mini Component System

Sebelum masuk Faces, custom tags bisa dipakai sebagai reusable UI abstraction:

```jsp
<app:caseStatusBadge status="${caseItem.status}" />
<app:pagination page="${model.page}" />
<app:fieldError field="title" errors="${model.errors}" />
```

Custom tag berguna ketika:

1. Markup sering berulang.
2. Ada pattern render konsisten.
3. Kamu ingin enforce escaping/format/security rule.
4. Kamu belum perlu full component lifecycle seperti Faces.

Namun custom tags bukan silver bullet. Kalau tag mulai menyimpan banyak state, memproses action, dan punya event behavior rumit, mungkin kamu sedang membangun ulang component framework secara manual.

---

## 8. Jakarta Faces/JSF: Mental Model Utama

Jakarta Faces berbeda dari JSP. Faces adalah framework MVC berbasis component.

Definisi praktis:

> Jakarta Faces adalah framework untuk membangun UI web menggunakan server-side component tree, lifecycle request, event handling, conversion, validation, model update, navigation, state saving, dan renderer.

### 8.1 Faces Bukan JSP Modern

Ini kesalahan umum.

JSP:

```text
Template -> generated servlet -> HTML
```

Faces:

```text
View declaration -> component tree -> lifecycle phases -> renderers -> HTML
```

Pada Faces modern, view biasanya ditulis dengan Facelets `.xhtml`, bukan JSP.

Contoh Facelets:

```xml
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets">
<h:head>
    <title>Case Detail</title>
</h:head>
<h:body>
    <h:form id="caseForm">
        <h:outputText value="#{caseBean.caseDetail.referenceNo}" />

        <h:inputText value="#{caseBean.form.title}" required="true" />
        <h:message for="title" />

        <h:commandButton value="Save" action="#{caseBean.save}" />
    </h:form>
</h:body>
</html>
```

Output final tetap HTML, tetapi server menyimpan dan memahami component tree.

### 8.2 Component Tree

Faces membangun tree seperti ini:

```text
UIViewRoot
  └── HtmlBody
      └── HtmlForm(id=caseForm)
          ├── HtmlOutputText(value=#{caseBean.caseDetail.referenceNo})
          ├── HtmlInputText(value=#{caseBean.form.title}, required=true)
          ├── HtmlMessage(for=title)
          └── HtmlCommandButton(action=#{caseBean.save})
```

Component tree bukan DOM browser. Ini struktur server-side yang merepresentasikan UI.

Manfaatnya:

1. Framework tahu input mana yang dikirim.
2. Framework bisa melakukan conversion/validation otomatis.
3. Framework bisa mengikat component ke model.
4. Framework bisa melakukan partial rendering/Ajax.
5. Framework bisa menyimpan state view.
6. Framework bisa punya component library kaya.

Biayanya:

1. Lifecycle lebih kompleks.
2. State management lebih berat.
3. Debugging butuh pemahaman fase.
4. HTML output kadang terasa tidak langsung.
5. Component ID/naming container bisa membingungkan.
6. Memory session bisa membesar.

### 8.3 Faces Lifecycle sebagai Mesin State

Simplified postback lifecycle:

```text
1. Restore View
   Rebuild/restore component tree dari view sebelumnya.

2. Apply Request Values
   Ambil submitted value dari HTTP request dan taruh ke component.

3. Process Validations
   Convert string input ke target type dan jalankan validator.

4. Update Model Values
   Jika valid, copy value dari component ke backing bean/model.

5. Invoke Application
   Panggil action/action listener/navigation logic.

6. Render Response
   Render component tree menjadi HTML dan simpan state view.
```

Ini alasan mengapa bug Faces harus dianalisis berdasarkan fase.

Contoh pertanyaan debugging:

| Gejala | Kemungkinan fase bermasalah |
|---|---|
| Action method tidak terpanggil | validation gagal sebelum Invoke Application, form tidak tersubmit, component tidak dirender saat restore, wrong form |
| Bean value tidak berubah | Update Model Values tidak terjadi, validation gagal, binding salah, scope salah |
| Error validation tidak muncul | message component salah `for`, naming container, render target Ajax salah |
| Value lama muncul lagi | state saving, bean scope, getter reload, model tidak diupdate |
| `ViewExpiredException` | view state hilang/expired, session timeout, client/server state mismatch |

### 8.4 Faces Cocok untuk Apa?

Faces bisa kuat untuk:

1. Enterprise internal app.
2. Admin console.
3. Form-heavy workflows.
4. Data table dengan validation/action per row.
5. Multi-step form/wizard.
6. UI yang banyak bergantung ke server-side domain model.
7. Tim Java-heavy yang tidak ingin full SPA complexity.
8. Aplikasi yang butuh component library matang.

Faces kurang cocok untuk:

1. Highly interactive consumer app dengan client-side state besar.
2. Offline-first app.
3. UI yang harus sangat dekat dengan frontend ecosystem modern.
4. Tim frontend-heavy yang sudah mapan dengan React/Vue/Svelte.
5. Public website yang butuh hydration/islands/static rendering modern.
6. Aplikasi yang butuh granular client-side caching dan optimistic UI.

---

## 9. Server-Side UI vs SPA: Trade-Off yang Sering Disederhanakan

Banyak diskusi terlalu dangkal:

- “JSP/JSF kuno.”
- “SPA modern.”
- “Server-side lebih gampang.”
- “Frontend framework lebih scalable.”

Kenyataannya lebih struktural.

### 9.1 Server-Side UI

Server-side UI berarti server menghasilkan HTML final atau hampir final.

```text
Browser -> GET /cases
Server -> HTML page
Browser -> POST form
Server -> redirect/render HTML
```

Keunggulan:

1. Authorization dan rendering dekat di server.
2. Initial page load bisa sederhana.
3. Tidak perlu API layer khusus untuk semua UI interaction.
4. Form validation bisa lebih terpusat.
5. Session/user context mudah diakses.
6. Cocok untuk CRUD/workflow internal.
7. Deployment lebih monolitik/sederhana.
8. Tidak perlu duplicate model besar antara frontend dan backend.

Kelemahan:

1. Interaksi kompleks bisa terasa berat.
2. Coupling UI-server tinggi.
3. Scaling session/state perlu perhatian.
4. Frontend UX modern lebih sulit.
5. HTML/CSS/JS sering tersebar di template.
6. Sulit memisahkan tim FE/BE besar.
7. Partial update bisa kompleks di Faces.
8. API reuse untuk mobile/external client tidak otomatis tersedia.

### 9.2 SPA/API-first UI

SPA berarti browser menjalankan aplikasi JavaScript besar yang berkomunikasi dengan backend API.

```text
Browser -> load JS/CSS shell
Browser -> API GET /api/cases
Browser renders UI
Browser -> API POST /api/cases/123/approve
```

Keunggulan:

1. Rich interaction.
2. Client-side routing/state.
3. API bisa reuse untuk mobile/external clients.
4. FE/BE separation lebih jelas.
5. Modern design system dan frontend tooling kuat.
6. Offline/optimistic UI lebih mungkin.

Kelemahan:

1. API contract overhead.
2. Duplicate validation/model di client dan server.
3. Auth/session/token complexity.
4. More moving parts.
5. More build/deployment surfaces.
6. Security risk berpindah ke API + browser state.
7. Initial architecture cost lebih tinggi.
8. Observability end-to-end lebih kompleks.

### 9.3 Keputusan yang Lebih Dewasa

Pertanyaan yang benar bukan:

> “JSP/JSF atau SPA mana yang lebih modern?”

Pertanyaan yang lebih baik:

> “Di mana state utama aplikasi harus hidup, siapa yang butuh mengontrol UI behavior, seberapa interaktif UX-nya, seberapa besar tim frontend, dan apa boundary deployment/API yang dibutuhkan?”

Decision table sederhana:

| Situasi | JSP/Pages | Faces | SPA |
|---|---:|---:|---:|
| CRUD internal sederhana | kuat | cukup | mungkin overkill |
| Form-heavy enterprise workflow | cukup | kuat | kuat tapi butuh API/detail FE |
| Admin console Java-heavy | kuat | kuat | tergantung tim |
| Public interactive consumer UI | lemah | lemah/sedang | kuat |
| Offline-first | lemah | lemah | kuat |
| Banyak mobile/external clients | perlu API tambahan | perlu API tambahan | kuat |
| Legacy Java EE app | kuat untuk maintain/migrate | kuat jika sudah JSF | tergantung migration budget |
| Team mostly backend Java | kuat | kuat | butuh skill ramp-up |
| Team frontend dedicated | sedang | sedang | kuat |

---

## 10. MVC, MVVM, dan Component Model: Jangan Campur Mental Model

### 10.1 Servlet + JSP sebagai MVC Request-Based

Pattern umum:

```text
Model       = domain/service/view model data
View        = JSP
Controller  = Servlet/Spring MVC/JAX-RS-like controller forwarding to JSP
```

Flow:

```text
GET /cases
  -> CaseListController
  -> CaseService
  -> CaseListViewModel
  -> request.setAttribute("model", model)
  -> forward /WEB-INF/views/cases/list.jsp
```

JSP hanya render.

Ini mirip request-based MVC klasik.

### 10.2 Faces sebagai Component-Based MVC

Faces punya MVC sendiri:

```text
View declaration = Facelets XHTML
Component tree   = server-side UI structure
Backing bean     = view/controller-ish object
Model/service    = application/domain services
FacesServlet     = front controller/lifecycle engine
```

Flow:

```text
POST /case.xhtml
  -> FacesServlet
  -> Restore component tree
  -> Decode inputs into components
  -> Validate/convert
  -> Update backing bean model
  -> Invoke action
  -> Render response
```

Backing bean sering menjadi tempat campur aduk antara controller, view state, dan form model. Developer top-tier harus disiplin memisahkan:

```text
Backing bean
  - owns view state and actions
  - delegates business logic to service
  - maps service result to UI messages/navigation

Service
  - owns transaction/business rules
  - independent from JSF/Faces classes

View model/form model
  - owns display/input shape
  - not necessarily same as entity
```

### 10.3 Kenapa Ini Penting?

Kalau kamu memakai mental model JSP untuk Faces, kamu akan bingung kenapa action tidak terpanggil atau kenapa getter dipanggil berkali-kali.

Kalau kamu memakai mental model SPA untuk JSP, kamu akan menaruh terlalu banyak state di browser dan membuat server rendering tidak konsisten.

Kalau kamu memakai mental model component framework client-side untuk Faces, kamu akan lupa bahwa component tree utamanya ada di server, bukan DOM browser.

---

## 11. View Model: Konsep yang Akan Sering Dipakai

Agar JSP/Faces tetap maintainable, kita akan sering memakai istilah **view model**.

View model adalah object yang sengaja dibentuk untuk kebutuhan rendering/input UI, bukan domain entity mentah.

Contoh domain entity:

```java
public class CaseRecord {
    private Long id;
    private String referenceNo;
    private CaseStatus status;
    private Officer assignedOfficer;
    private LocalDateTime submittedAt;
    private List<Document> documents;
    private List<CaseAction> actions;
    private RiskAssessment riskAssessment;
}
```

View model untuk listing:

```java
public record CaseListItemView(
    Long id,
    String referenceNo,
    String statusLabel,
    String statusCssClass,
    String assignedOfficerName,
    String submittedDateText,
    boolean escalated,
    boolean canOpen,
    boolean canApprove,
    String approveDisabledReason
) {}
```

Kenapa tidak langsung render entity?

1. Entity punya graph besar.
2. Lazy loading bisa meledak di view.
3. Authorization decision tidak eksplisit.
4. Formatting tersebar di JSP/XHTML.
5. UI butuh label/css/action state, bukan hanya data domain.
6. Entity mutation dari UI bisa tidak sengaja.
7. Testing lebih sulit.
8. Serialization/session risk lebih besar.

Rule of thumb:

> View harus menerima data yang sudah “siap render”, bukan data mentah yang masih butuh business decision kompleks.

---

## 12. Boundary View Logic vs Business Logic

Tidak semua logic di view itu buruk. Yang buruk adalah business decision tersembunyi di view.

### 12.1 Logic yang Wajar di View

Contoh logic yang masih wajar:

1. Render badge jika `escalated == true`.
2. Loop list yang sudah disiapkan controller.
3. Pilih CSS class dari field view model.
4. Tampilkan fallback text jika value kosong.
5. Tampilkan form error dekat field.
6. Include partial layout.
7. Render pagination berdasarkan page metadata.

### 12.2 Logic yang Sebaiknya Tidak di View

Contoh logic yang buruk di view:

1. Query database.
2. Memutuskan workflow transition valid atau tidak.
3. Menghitung SLA escalation dari banyak rule.
4. Memeriksa permission detail dari role matrix kompleks.
5. Memutasi domain object.
6. Mengirim email.
7. Memanggil external API.
8. Menentukan transaction boundary.
9. Menghapus/mengupdate data.
10. Mengimplementasikan validation domain final.

### 12.3 Decision Rule

Tanyakan:

> Kalau logic ini salah, apakah akibatnya hanya tampilan jelek, atau bisa menyebabkan business/security/regulatory decision salah?

Kalau hanya tampilan, view logic mungkin wajar.

Kalau business/security/regulatory, pindahkan ke service/domain/application layer lalu expose hasilnya ke view model.

---

## 13. Security Mental Model untuk Server-Side UI

Server-side rendering sering dianggap lebih aman karena HTML dibuat di server. Itu asumsi berbahaya.

Risiko tetap ada:

1. XSS.
2. CSRF.
3. Session fixation.
4. Hidden field tampering.
5. Authorization bypass.
6. Sensitive data leakage in rendered HTML.
7. Cache leakage.
8. Error page leakage.
9. View state tampering.
10. Insecure file download URL.

### 13.1 XSS: Context Matters

Output encoding harus sesuai konteks.

HTML body:

```html
<div>ENCODE_HTML(userInput)</div>
```

HTML attribute:

```html
<input value="ENCODE_HTML_ATTRIBUTE(userInput)">
```

JavaScript string:

```html
<script>
  const name = "ENCODE_JS_STRING(userInput)";
</script>
```

URL parameter:

```html
<a href="/search?q=ENCODE_URL_PARAMETER(userInput)">
```

CSS context:

```html
<style>
  .x { background: ENCODE_CSS(userInput); }
</style>
```

`c:out` membantu untuk HTML escaping, tetapi bukan jawaban untuk semua konteks.

### 13.2 Authorization Rendering vs Authorization Enforcement

View sering menampilkan tombol berdasarkan permission:

```jsp
<c:if test="${caseItem.canApprove}">
  <button>Approve</button>
</c:if>
```

Atau Faces:

```xml
<h:commandButton value="Approve"
                 action="#{caseBean.approve}"
                 rendered="#{caseBean.canApprove}" />
```

Ini hanya **rendering decision**.

Enforcement tetap harus ada di server action/service:

```java
public void approve(CaseId id, UserContext user) {
    authorizationService.requireCanApprove(user, id);
    workflowService.approve(id, user);
}
```

Rule:

> Tidak merender tombol bukan authorization. Itu hanya UX.

### 13.3 Hidden Field Tidak Trusted

Server-side UI sering memakai hidden input:

```html
<input type="hidden" name="caseId" value="123">
<input type="hidden" name="version" value="7">
```

Hidden bukan secure. User bisa mengubahnya.

Semua value dari request harus dianggap untrusted:

1. id,
2. version,
3. role,
4. amount,
5. workflow action,
6. status,
7. redirect URL,
8. file name.

### 13.4 Faces View State

Faces menyimpan view state agar component tree bisa dipulihkan pada postback. Ini bisa server-side atau client-side tergantung konfigurasi/runtime.

Risiko:

1. View state size besar.
2. Session memory bloat.
3. View expired.
4. Client-side state harus dilindungi dari tampering.
5. Stale state bisa menampilkan action yang sudah tidak valid.

Developer top-tier tidak menganggap view state sebagai detail framework kecil. View state adalah bagian dari threat model dan capacity model.

---

## 14. State and Concurrency: Bug yang Sering Tidak Kelihatan Saat Development

Server-side UI sering terlihat baik di local development, lalu bermasalah di production karena state dan concurrency.

### 14.1 Session Bloat

Session bloat terjadi ketika terlalu banyak data disimpan di session:

```java
session.setAttribute("allCases", hugeList);
session.setAttribute("caseEntity", entityWithLargeGraph);
session.setAttribute("uploadedFileBytes", fileBytes);
```

Akibat:

1. Heap meningkat.
2. GC pressure.
3. Replication cluster mahal.
4. Serialization error.
5. Failover lambat.
6. User session sulit di-scale.

Lebih sehat:

1. Simpan ID atau small state.
2. Query ulang data read model sesuai kebutuhan.
3. Gunakan request scope untuk page render.
4. Gunakan cache eksplisit untuk data shared/read-mostly.
5. Jangan simpan binary/file besar di session.

### 14.2 Multi-Tab Problem

User membuka halaman yang sama di dua tab:

```text
Tab A: Case 123, version 7
Tab B: Case 123, version 7
Tab A: approve -> version menjadi 8
Tab B: reject -> request stale
```

Solusi bukan di JSP/Faces saja. Perlu:

1. Optimistic locking.
2. Version field.
3. Server-side revalidation.
4. Clear error message.
5. Idempotency key untuk action tertentu.
6. PRG pattern.

### 14.3 Double Submit

User double click submit:

```text
POST /approve
POST /approve
```

Risiko:

1. Action dieksekusi dua kali.
2. Email terkirim dua kali.
3. Audit trail duplikat.
4. Workflow transition invalid.

Mitigasi:

1. Disable button client-side hanya tambahan UX, bukan security.
2. Idempotency key.
3. Server-side transition guard.
4. Unique constraint/business event key.
5. Optimistic locking.
6. PRG setelah successful POST.

### 14.4 Session Concurrent Access

Satu user session bisa punya beberapa request paralel:

1. Multiple tabs.
2. Ajax request.
3. Browser retry.
4. Resource loading.
5. User double click.

Kalau session bean mutable tidak didesain baik, bisa race condition.

Rule:

> Jangan menganggap “satu user” berarti “satu thread”.

---

## 15. Error Handling Mental Model

Server-side UI harus memikirkan error dari beberapa layer:

```text
Browser input error
  -> conversion error
  -> validation error
  -> authorization error
  -> business rule error
  -> concurrency/stale state error
  -> system/infrastructure error
  -> rendering error
```

### 15.1 Error yang Bisa Dikoreksi User

Contoh:

1. Required field kosong.
2. Date format salah.
3. Attachment terlalu besar.
4. Invalid input range.
5. Missing comment for rejection.

UI harus:

1. Menampilkan error dekat field.
2. Mempertahankan input user.
3. Tidak mengulang action berbahaya.
4. Memberi pesan jelas.

### 15.2 Error Business Rule

Contoh:

1. Case sudah approved oleh officer lain.
2. User tidak lagi punya permission.
3. SLA state berubah.
4. Workflow transition tidak valid.
5. Record version stale.

UI harus:

1. Re-fetch state terkini.
2. Jelaskan bahwa data berubah.
3. Tawarkan reload/back to list.
4. Jangan hanya stack trace.

### 15.3 System Error

Contoh:

1. Database timeout.
2. External API gagal.
3. Template compilation error.
4. View expired.
5. Serialization failure.

UI harus:

1. Tampilkan generic user-safe message.
2. Log correlation ID.
3. Jangan bocorkan stack trace/SQL/path internal.
4. Bedakan retryable vs non-retryable bila mungkin.

---

## 16. Performance Mental Model

Performance server-side UI tidak hanya soal query DB. Rendering juga bisa mahal.

### 16.1 JSP Performance Cost

Sumber cost:

1. First request compilation.
2. Tag execution.
3. EL evaluation.
4. Large loops.
5. Expensive getter.
6. Large HTML payload.
7. Include chain terlalu dalam.
8. Session creation tidak sengaja.
9. Formatting per row tanpa cache.
10. N+1 lazy loading dari view.

### 16.2 Faces Performance Cost

Sumber cost:

1. Restore/build component tree.
2. Decode submitted values.
3. Conversion/validation.
4. Update model.
5. Render component tree.
6. Save view state.
7. Large data table component tree.
8. Ajax partial render yang terlalu luas.
9. Session state replication.
10. Component library overhead.

### 16.3 Golden Rule

> Jangan melakukan query, remote call, atau computation mahal dari getter/view expression.

Buruk:

```xml
<h:dataTable value="#{caseBean.findCases()}" var="c">
```

Lebih baik:

```java
@PostConstruct
public void init() {
    this.cases = caseQueryService.findCases(criteria);
}

public List<CaseRowView> getCases() {
    return cases;
}
```

### 16.4 Capacity Questions

Untuk production readiness, tanyakan:

1. Berapa ukuran rata-rata HTML response?
2. Berapa banyak component per page?
3. Berapa ukuran view state?
4. Berapa besar session per user?
5. Apakah session direplikasi?
6. Apakah user membuka banyak tab?
7. Apakah data table memakai pagination server-side?
8. Apakah lazy loading terjadi saat rendering?
9. Apakah error page bisa menyebabkan render loop?
10. Apakah JSP precompiled?

---

## 17. Migration Mental Model

Banyak organisasi tidak memulai dari greenfield. Mereka punya aplikasi lama:

1. JSP scriptlet-heavy.
2. JSF 2.x `javax.faces`.
3. JSTL 1.2.
4. Custom tag JAR lama.
5. `web.xml` lama.
6. Container Tomcat 8/9, WebLogic lama, WildFly lama, GlassFish/Payara lama.
7. Java 8 runtime.

Migration bukan hanya search-replace.

### 17.1 Migration Layers

```text
Source syntax
  -> imports/package namespace
  -> dependencies
  -> deployment descriptors
  -> taglib URIs
  -> container version
  -> third-party libraries
  -> build plugin
  -> runtime behavior
  -> tests
  -> operations
```

### 17.2 Migration Strategy

Tahapan yang masuk akal:

1. Inventory pages/components/tags.
2. Identify high-risk custom tags/components.
3. Add regression tests/golden output for critical flows.
4. Separate view model from entity where possible.
5. Remove scriptlet/business logic from JSP gradually.
6. Upgrade Java version if needed.
7. Upgrade container/runtime.
8. Migrate namespace `javax` to `jakarta`.
9. Align third-party libraries.
10. Test rendering, validation, navigation, session, security.
11. Load test state/session behavior.
12. Roll out with rollback plan.

### 17.3 The Migration Trap

Migration trap terjadi ketika tim hanya fokus aplikasi bisa start.

Padahal risiko sebenarnya:

1. Error hanya muncul di page tertentu.
2. Tag library lama tidak kompatibel.
3. EL behavior berubah di edge case.
4. JSF component library belum kompatibel.
5. Serialization/view state gagal setelah deploy.
6. Session failover rusak.
7. Validation message berubah.
8. Security header/filter chain berubah.
9. Encoding/locale output berubah.

Top-tier engineer tidak hanya bertanya:

> “Apakah build sukses?”

Tapi:

> “Apakah semua user journey, state transition, validation path, error path, dan rollback path tetap benar?”

---

## 18. Kapan Memakai JSP/Pages?

JSP/Jakarta Pages masuk akal jika:

1. Halaman mostly server-rendered.
2. Interaksi sederhana sampai menengah.
3. Controller sudah jelas.
4. View model bisa disiapkan per request.
5. Tidak butuh component lifecycle kompleks.
6. Tidak butuh rich component library server-side.
7. Tim ingin teknologi ringan di atas Servlet.
8. Aplikasi legacy sudah JSP dan masih viable.

Contoh cocok:

1. Admin list/detail sederhana.
2. Report page.
3. Search/filter table server-side.
4. Settings page.
5. Internal backoffice sederhana.
6. Email preview template.
7. Error pages.
8. Server-rendered read-only screens.

JSP kurang cocok jika:

1. Form flow sangat kompleks.
2. Banyak reusable interactive components.
3. Banyak partial updates dan validation component-level.
4. UI state rumit antar interaction.
5. Kamu butuh framework lifecycle component.
6. Kamu butuh modern rich frontend behavior.

---

## 19. Kapan Memakai Faces?

Faces masuk akal jika:

1. Aplikasi form-heavy.
2. UI workflow banyak validation.
3. Banyak server-side component reuse.
4. Tim Java-heavy.
5. Enterprise internal app.
6. Component library seperti PrimeFaces membantu produktivitas.
7. Kamu siap memahami lifecycle/state.
8. Kamu butuh integration kuat dengan CDI/Bean Validation/Jakarta EE.

Contoh cocok:

1. Case management internal.
2. Regulatory workflow UI.
3. Admin console besar.
4. Multi-step approval wizard.
5. Data management form dengan validation kompleks.
6. Backoffice enterprise.

Faces kurang cocok jika:

1. Tim tidak mau belajar lifecycle.
2. UI butuh interaksi client-side sangat intensif.
3. Aplikasi public-facing high-scale stateless.
4. Session state harus sangat minim.
5. Frontend team sudah punya React/Vue architecture matang.
6. Kamu hanya butuh template sederhana.

---

## 20. Kapan Tidak Memakai Keduanya?

Kadang jawaban terbaik adalah tidak memakai JSP/Faces.

Gunakan SPA/API-first jika:

1. UI sangat interaktif.
2. Banyak state di client.
3. Perlu mobile/external API reuse.
4. Tim frontend kuat.
5. Design system frontend sudah matang.
6. Perlu offline/optimistic updates.
7. Deployment frontend/backend memang sengaja dipisah.

Gunakan server-side framework lain jika:

1. Organisasi memakai Spring MVC + Thymeleaf.
2. Butuh template engine modern non-JSP.
3. Ingin SSR tetapi tidak ingin JSP legacy.
4. Tidak butuh standard Jakarta Pages/Faces.

Gunakan plain REST/API jika:

1. Tidak ada HTML server-rendered.
2. Client banyak dan heterogen.
3. UI bukan tanggung jawab service ini.

---

## 21. Diagram Mental: JSP vs Faces vs SPA

### 21.1 JSP Request Rendering

```text
GET /cases?status=OPEN
  |
  v
CaseListServlet / Controller
  |
  +-- parse request
  +-- authorize
  +-- call service
  +-- build CaseListViewModel
  +-- request.setAttribute("model", model)
  |
  v
Forward to /WEB-INF/views/cases/list.jsp
  |
  +-- EL reads model
  +-- JSTL loops cases
  +-- custom tags render badges/pagination
  |
  v
HTML response
```

### 21.2 Faces Postback Lifecycle

```text
POST /case.xhtml
  |
  v
FacesServlet
  |
  +-- Restore View
  +-- Apply Request Values
  +-- Process Validations
  +-- Update Model Values
  +-- Invoke Application
  +-- Render Response
  |
  v
HTML response + view state
```

### 21.3 SPA/API Flow

```text
GET /app
  |
  v
Static HTML + JS bundle
  |
  v
Browser app starts
  |
  +-- GET /api/cases
  +-- render client-side
  +-- POST /api/cases/123/approve
  +-- update client-side state
```

Each model has different failure modes.

---

## 22. Enterprise Case Management Example: Same Requirement, Different Implementations

Requirement:

> Tampilkan detail case, status, assigned officer, documents, audit entries, dan tombol action sesuai permission. User bisa approve/reject dengan comment. Harus validasi comment, mencegah double submit, dan menangani stale version.

### 22.1 JSP Approach

```text
GET /cases/123
  -> CaseDetailServlet
  -> CaseQueryService.getDetail(123, currentUser)
  -> CaseDetailViewModel
  -> forward detail.jsp
```

`detail.jsp`:

```jsp
<h1><c:out value="${model.referenceNo}" /></h1>

<app:statusBadge status="${model.status}" />

<c:if test="${model.canApprove}">
  <form method="post" action="${pageContext.request.contextPath}/cases/${model.id}/approve">
    <input type="hidden" name="version" value="${model.version}" />
    <input type="hidden" name="csrf" value="${model.csrfToken}" />
    <textarea name="comment"></textarea>
    <button type="submit">Approve</button>
  </form>
</c:if>
```

POST:

```text
POST /cases/123/approve
  -> ApproveCaseServlet
  -> validate CSRF
  -> parse version/comment
  -> authorizationService.requireCanApprove
  -> workflowService.approve(caseId, version, comment)
  -> redirect /cases/123?message=approved
```

JSP approach eksplisit. Controller/action jelas.

### 22.2 Faces Approach

`case.xhtml`:

```xml
<h:form id="caseForm">
    <h:outputText value="#{caseDetailBean.caseDetail.referenceNo}" />

    <h:panelGroup rendered="#{caseDetailBean.canApprove}">
        <h:inputTextarea id="comment"
                         value="#{caseDetailBean.form.comment}"
                         required="true" />
        <h:message for="comment" />

        <h:commandButton value="Approve"
                         action="#{caseDetailBean.approve}" />
    </h:panelGroup>
</h:form>
```

Backing bean:

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {
    private CaseDetailView caseDetail;
    private ApprovalForm form;

    public void init() {
        this.caseDetail = caseQueryService.getDetail(caseId, currentUser);
        this.form = new ApprovalForm(caseDetail.version());
    }

    public String approve() {
        workflowService.approve(caseId, form.version(), form.comment(), currentUser);
        return "/cases/detail?faces-redirect=true&id=" + caseId;
    }
}
```

Faces approach membuat form binding/validation lebih integrated, tetapi lifecycle dan state harus dipahami.

### 22.3 Architectural Insight

Untuk case management:

- JSP memberi explicit request/action control.
- Faces memberi component/form lifecycle yang kaya.
- SPA memberi client-side UX dan API reuse.

Tidak ada yang otomatis “top-tier”. Top-tier terletak pada kemampuan memilih model yang sesuai constraint dan mengendalikan failure modes.

---

## 23. Anti-Pattern yang Akan Sering Kita Lawan

### 23.1 Scriptlet Business Logic

```jsp
<% if (user.getRole().equals("ADMIN") && caseObj.getStatus().equals("OPEN")) { %>
```

Masalah:

1. Business/security rule di view.
2. Sulit dites.
3. Sulit diaudit.
4. Sulit dimigrasi.

### 23.2 Entity Directly in View

```jsp
${caseEntity.assignedOfficer.department.organization.parent.name}
```

Masalah:

1. Lazy loading.
2. N+1.
3. Null chain.
4. Tight coupling ke entity graph.
5. Security filtering sulit.

### 23.3 Getter with Side Effects

```java
public List<Item> getItems() {
    auditService.logView();
    return repository.findItems();
}
```

Masalah:

1. Getter bisa dipanggil berkali-kali.
2. Side effect tidak predictable.
3. Performance buruk.
4. Audit duplikat.

### 23.4 Session as Dumping Ground

```java
session.setAttribute("currentCase", caseEntity);
session.setAttribute("allSearchResults", results);
session.setAttribute("wizardEverything", hugeObject);
```

Masalah:

1. Memory bloat.
2. Stale data.
3. Cluster replication cost.
4. Serialization failure.

### 23.5 Rendered Equals Security

```xml
<h:commandButton rendered="#{user.admin}" action="#{bean.delete}" />
```

Masalah:

1. Tombol tersembunyi tidak mencegah forged request.
2. Action/service tetap harus authorize.

### 23.6 Complex JSTL as Business Engine

```jsp
<c:forEach items="${cases}" var="c">
  <c:if test="${...complex business rule...}">
```

Masalah:

1. Rule tersebar.
2. Sulit reuse.
3. Sulit test.
4. Salah layer.

---

## 24. Invariants untuk Engineer Senior/Top-Tier

Dalam seri ini, kita akan berkali-kali kembali ke invariants berikut.

### 24.1 View Is Not Trusted

Walaupun view dibuat server, semua request dari browser tetap untrusted.

- Hidden input untrusted.
- Query parameter untrusted.
- View state perlu diproteksi.
- Rendered button bukan security.
- Client-side validation bukan enforcement.

### 24.2 View Should Be Cheap

Rendering tidak boleh melakukan pekerjaan mahal yang tidak terlihat.

- Getter cheap.
- No DB call from view.
- No remote call from view.
- No expensive per-row formatting if avoidable.
- Precompute view model.

### 24.3 State Must Have an Owner

Setiap state harus jelas:

- owner,
- lifetime,
- mutation rule,
- concurrency rule,
- stale handling,
- replication impact,
- security sensitivity.

### 24.4 Business Rule Lives Outside Template

Template boleh memilih markup. Template tidak boleh menjadi sumber kebenaran business rule.

### 24.5 Lifecycle Explains Bugs

Untuk Faces terutama:

- action not called,
- validation weird,
- value stale,
- model not updated,
- view expired,
- Ajax render failed,

semua harus ditelusuri melalui lifecycle.

### 24.6 Migration Requires Behavioral Proof

Migration berhasil bukan karena compile sukses. Migration berhasil jika behavior kritikal tetap benar.

---

## 25. Skill Map yang Akan Dibangun di Seri Ini

Seri ini akan membangun skill dalam lapisan berikut:

```text
Foundation
  -> versioning, namespace, runtime, Servlet relation

JSP/Pages
  -> lifecycle, syntax, scopes, directives, actions

EL
  -> resolver, coercion, methods, functions, custom resolver, security

Tags
  -> JSTL, custom tags, tag files, TLD, reusable view architecture

Security
  -> XSS, CSRF, state tampering, authorization rendering, secure headers

Performance
  -> rendering cost, session bloat, compilation, tag/EL overhead

Testing
  -> view model tests, tag tests, integration tests, golden HTML tests

Faces
  -> Facelets, component tree, CDI beans, lifecycle, validation, navigation

Faces Advanced
  -> state saving, Ajax, composite components, custom components, renderers

Operations
  -> diagnostics, migration, compatibility, production readiness

Capstone
  -> enterprise case management UI design/review
```

---

## 26. Cara Membaca Seri Ini

Agar efisien, jangan membaca materi ini seperti katalog API. Baca dengan pola:

1. Pahami mental model.
2. Lihat flow runtime.
3. Identifikasi boundary.
4. Cari failure modes.
5. Baru hafalkan API/tag/annotation.
6. Latih dengan contoh case management/admin UI.

Urutan prioritas belajar:

```text
Mental model > lifecycle > state boundary > security > failure modes > API syntax
```

Kenapa?

Karena API bisa dicari. Tetapi saat production issue terjadi, yang menyelamatkan adalah model mental:

- kenapa session membesar,
- kenapa action tidak terpanggil,
- kenapa output XSS,
- kenapa hidden field bisa diubah,
- kenapa migration `javax` ke `jakarta` gagal,
- kenapa view expired,
- kenapa query dipanggil 1000 kali saat render.

---

## 27. Mini Checklist: Memilih Teknologi UI untuk Java Enterprise

Gunakan checklist ini sebelum memilih JSP/Pages, Faces, atau SPA.

### 27.1 Pertanyaan Product/UX

1. Apakah UI mostly CRUD/form/report?
2. Apakah perlu rich client interaction?
3. Apakah perlu offline support?
4. Apakah mobile/external API penting?
5. Apakah SEO/public performance penting?
6. Apakah UX butuh component library kaya?

### 27.2 Pertanyaan Team

1. Apakah tim lebih kuat Java atau frontend?
2. Apakah ada dedicated frontend engineers?
3. Apakah tim memahami JSF/Faces lifecycle?
4. Apakah tim siap maintain custom tags/components?
5. Apakah testing UI server-side sudah ada?

### 27.3 Pertanyaan Architecture

1. Di mana state utama harus hidup?
2. Apakah session clustering diperlukan?
3. Apakah API reuse diperlukan?
4. Apakah deployment frontend/backend harus dipisah?
5. Apakah authorization decision dekat dengan domain service?
6. Apakah audit/regulatory traceability penting?

### 27.4 Pertanyaan Operations

1. Berapa jumlah concurrent user?
2. Berapa ukuran session rata-rata?
3. Berapa ukuran view state?
4. Apakah sticky session tersedia?
5. Apakah failover dibutuhkan?
6. Apakah cold-start JSP compilation acceptable?
7. Apakah library compatible dengan Java/Jakarta target?

---

## 28. Ringkasan Inti

JSP/Jakarta Pages, EL, Tags, dan Faces adalah teknologi yang berada di sekitar server-side UI Java, tetapi masing-masing punya model berbeda.

JSP/Jakarta Pages:

- template yang dikompilasi menjadi Servlet,
- cocok untuk request-based server rendering,
- idealnya hanya render view model,
- bisa memakai EL dan tags,
- scriptlet-heavy JSP adalah legacy smell.

Expression Language:

- expression/binding evaluator,
- bekerja melalui resolver chain,
- punya coercion/null/method/property behavior,
- di Faces menjadi binding penting ke component/model,
- getter harus cheap dan side-effect-free.

JSTL/Jakarta Tags:

- tag library untuk common view tasks,
- mengurangi scriptlet,
- cocok untuk conditional/loop/format/i18n sederhana,
- bukan tempat business engine,
- custom tags bisa menjadi reusable view abstraction.

Jakarta Faces:

- component-based server-side MVC UI framework,
- memakai component tree dan lifecycle,
- kuat untuk form-heavy enterprise UI,
- punya state saving, validation, navigation, Ajax, component library,
- butuh pemahaman mendalam agar tidak menjadi sulit di-debug.

Server-side UI bukan otomatis kuno, dan SPA bukan otomatis lebih baik. Keputusan yang benar bergantung pada state, UX, team, architecture, operations, dan migration constraints.

Top-tier engineer tidak hanya tahu “cara menulis tag”. Ia memahami:

1. runtime translation/execution,
2. lifecycle,
3. state ownership,
4. security boundary,
5. performance cost,
6. migration compatibility,
7. failure modes,
8. architectural trade-off.

---

## 29. Latihan Pemahaman

Jawab pertanyaan berikut sebelum lanjut ke Part 1.

### 29.1 Conceptual

1. Jelaskan perbedaan JSP dan Faces dalam satu kalimat teknis.
2. Kenapa JSP declaration field bisa berbahaya untuk thread safety?
3. Kenapa getter yang dipakai EL tidak boleh melakukan query database?
4. Apa perbedaan rendering authorization dan enforcement authorization?
5. Kenapa hidden input tidak boleh dipercaya?
6. Kenapa `rendered=false` di Faces bukan security control?
7. Kenapa session scope bisa menjadi bottleneck scalability?
8. Apa arti component tree di Faces?
9. Kenapa Faces action method bisa tidak terpanggil meskipun tombol diklik?
10. Kenapa migration `javax` ke `jakarta` bukan sekadar rename import?

### 29.2 Design Exercise

Bayangkan halaman “Case Detail” dengan action Approve/Reject.

Tentukan:

1. Data apa yang masuk request scope?
2. Data apa yang boleh masuk session scope?
3. Data apa yang tidak boleh masuk hidden field?
4. Business rule apa yang tidak boleh berada di JSP/XHTML?
5. Bagaimana menangani stale version?
6. Bagaimana mencegah double submit?
7. Apa yang perlu di-log untuk audit?
8. Bagaimana menampilkan tombol hanya jika user punya permission, tetapi tetap aman?

### 29.3 Failure Modeling

Untuk setiap failure berikut, jelaskan kemungkinan penyebab dan mitigasi:

1. User melihat tombol Approve, tetapi saat klik muncul unauthorized.
2. User submit form dua kali dan audit trail dobel.
3. Halaman Faces menghasilkan `ViewExpiredException`.
4. JSP lambat hanya pada halaman listing 1000 row.
5. Setelah migration ke Jakarta, custom tag tidak ditemukan.
6. EL `${model.user.name}` kosong padahal controller sudah set attribute.
7. Data table memicu ratusan query saat rendering.
8. Error page menampilkan stack trace production.

---

## 30. Referensi Resmi dan Bacaan Lanjutan

Referensi ini dipakai sebagai baseline versi dan spesifikasi untuk seri ini:

1. Jakarta EE Platform 11 — minimum Java SE 17+, specification documents, release record:  
   <https://jakarta.ee/specifications/platform/11/>

2. Jakarta EE 11 Release Page:  
   <https://jakarta.ee/release/11/>

3. Jakarta Pages overview and versions:  
   <https://jakarta.ee/specifications/pages/>

4. Jakarta Pages 4.0 specification page:  
   <https://jakarta.ee/specifications/pages/4.0/>

5. Jakarta Expression Language overview and versions:  
   <https://jakarta.ee/specifications/expression-language/>

6. Jakarta Expression Language 6.0 specification page:  
   <https://jakarta.ee/specifications/expression-language/6.0/>

7. Jakarta Standard Tag Library overview and versions:  
   <https://jakarta.ee/specifications/tags/>

8. Jakarta Standard Tag Library 3.0 specification page:  
   <https://jakarta.ee/specifications/tags/3.0/>

9. Jakarta Faces overview and versions:  
   <https://jakarta.ee/specifications/faces/>

10. Jakarta Faces 4.1 specification page:  
    <https://jakarta.ee/specifications/faces/4.1/>

11. OpenJDK JDK 25 project page:  
    <https://openjdk.org/projects/jdk/25/>

---

## 31. Penutup Part 0

Bagian 0 selesai.

Seri **belum selesai** dan belum mencapai bagian terakhir. Bagian berikutnya adalah:

```text
01-history-compatibility-java8-to-java25.md
```

Fokus Part 1 nanti:

1. timeline Java EE/Jakarta EE,
2. peta versi JSP/Jakarta Pages, EL, JSTL/Jakarta Tags, JSF/Jakarta Faces,
3. compatibility matrix Java 8–25,
4. container compatibility,
5. namespace migration `javax` → `jakarta`,
6. risiko dependency/library di aplikasi enterprise nyata.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-055.md](../jax.rs/learn-jaxrs-advanced-part-055.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 1 — Historical Evolution dan Compatibility Matrix: JSP, JSTL, EL, JSF, Jakarta Faces](./01-history-compatibility-java8-to-java25.md)

</div>