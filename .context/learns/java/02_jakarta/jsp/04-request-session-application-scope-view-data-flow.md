# Part 4 — Request, Session, Application Scope: View Data Flow and State Boundaries

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `04-request-session-application-scope-view-data-flow.md`  
> Fokus: scope sebagai boundary state, bukan sekadar tempat menyimpan object  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan konseptual antara **page scope**, **request scope**, **session scope**, dan **application scope**.
2. Menentukan scope yang tepat untuk data UI, form state, flash message, user context, cache ringan, dan konfigurasi aplikasi.
3. Membaca aliran data dari controller/servlet ke JSP/Jakarta Pages tanpa membuat coupling tersembunyi.
4. Menghindari anti-pattern klasik seperti:
   - menyimpan entity JPA langsung di session,
   - menjadikan session sebagai cache umum,
   - menyimpan mutable shared object di application scope,
   - membuat JSP mengambil keputusan bisnis tersembunyi.
5. Memahami bagaimana scope berpengaruh ke:
   - memory usage,
   - concurrency,
   - clustering,
   - failover,
   - security,
   - testability,
   - maintainability.
6. Mampu melakukan diagnosis production issue terkait scope:
   - session bloat,
   - stale data,
   - lost flash message,
   - memory leak,
   - sticky session issue,
   - data race di shared attributes.

---

## 1. Mental Model Utama: Scope Adalah Boundary Lifetime + Visibility + Ownership

Banyak developer memandang scope sebagai “tempat taruh variable”. Itu terlalu dangkal.

Dalam sistem enterprise, scope harus dilihat sebagai gabungan dari empat hal:

```text
Scope = lifetime + visibility + ownership + concurrency model
```

Artinya, saat kamu memilih menyimpan sesuatu di request/session/application, kamu sedang menjawab pertanyaan:

1. **Lifetime**  
   Berapa lama data itu hidup?

2. **Visibility**  
   Siapa yang bisa melihat data itu?

3. **Ownership**  
   Siapa pemilik data itu?

4. **Concurrency model**  
   Apakah data itu bisa disentuh banyak request/thread secara bersamaan?

Kalau salah menjawab salah satu saja, bug yang muncul biasanya bukan compile error, tetapi bug runtime yang sulit didiagnosis:

- user A melihat data user B,
- form menampilkan data lama,
- approval action memakai object stale,
- page random gagal setelah failover,
- server memory naik terus,
- cluster node tidak konsisten,
- session replication terlalu besar,
- audit trail salah karena action memakai state lama.

---

## 2. Empat Scope Penting di JSP/Jakarta Pages

Dalam JSP/Jakarta Pages, kamu akan sering bertemu empat scope ini:

```text
+-------------------+-------------------------+-------------------------------+
| Scope             | Lifetime                | Typical Owner                 |
+-------------------+-------------------------+-------------------------------+
| page              | selama eksekusi page     | satu JSP invocation            |
| request           | satu HTTP request        | request handler/controller     |
| session           | satu user session        | user/browser interaction       |
| application       | selama webapp hidup      | seluruh aplikasi               |
+-------------------+-------------------------+-------------------------------+
```

Lebih detail:

```text
HTTP request masuk
   |
   v
Controller / Servlet / Filter
   |
   | set request attributes
   v
Forward ke JSP
   |
   | JSP membaca page/request/session/application attributes
   v
HTML response dikirim
```

Scope bukan hanya soal “bisa diakses atau tidak”. Scope menentukan apakah data tersebut aman, stabil, dan benar untuk konteks eksekusi tertentu.

---

## 3. Page Scope

### 3.1 Apa itu Page Scope?

**Page scope** adalah scope paling pendek dalam JSP. Data di page scope hanya hidup selama satu eksekusi halaman JSP tersebut.

Ia biasanya diakses melalui `pageContext`.

Contoh:

```jsp
<%
    pageContext.setAttribute("localTitle", "Case Detail");
%>

${localTitle}
```

Atau dalam JSTL:

```jsp
<c:set var="localTitle" value="Case Detail" scope="page" />
```

### 3.2 Kapan Page Scope Cocok?

Page scope cocok untuk data yang:

1. hanya relevan untuk rendering page saat ini,
2. tidak perlu dibagikan ke included JSP lain secara luas,
3. tidak perlu bertahan setelah response selesai,
4. hanya membantu presentasi lokal.

Contoh:

```jsp
<c:set var="sectionTitle" value="Enforcement History" scope="page" />
<c:set var="showAdvancedPanel" value="${userRole eq 'SUPERVISOR'}" scope="page" />
```

### 3.3 Page Scope sebagai Local Variable View

Cara berpikir yang baik:

```text
page scope ≈ local variable untuk rendering JSP
```

Kalau di Java method kamu menulis:

```java
String sectionTitle = "Case Detail";
```

Maka di JSP, page scope sering berperan mirip seperti itu.

### 3.4 Risiko Page Scope

Page scope jarang menyebabkan memory leak besar karena umurnya pendek. Namun tetap ada risiko:

1. membuat view logic terlalu banyak,
2. menyembunyikan dependency antar include,
3. membuat nama variable bentrok dengan request/session attribute,
4. sulit dilacak jika JSP besar dan nested include kompleks.

Contoh buruk:

```jsp
<c:set var="caseStatus" value="${someComplexExpression}" scope="page" />
<c:if test="${caseStatus eq 'ESCALATED' and userRole eq 'MANAGER' and not case.locked}">
    ...
</c:if>
```

Masalahnya bukan karena memakai page scope, tetapi karena JSP mulai mengambil keputusan domain/policy.

Lebih baik controller/service menyiapkan view model:

```java
request.setAttribute("casePage", new CasePageViewModel(
    caseId,
    caseStatus,
    allowedActions,
    visibleSections
));
```

Lalu JSP hanya membaca:

```jsp
<c:if test="${casePage.showEscalationPanel}">
    ...
</c:if>
```

---

## 4. Request Scope

### 4.1 Apa itu Request Scope?

**Request scope** hidup selama satu HTTP request.

Di Servlet/Jakarta Servlet, data request scope biasanya disimpan sebagai request attribute:

```java
request.setAttribute("caseDetail", caseDetailViewModel);
request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
       .forward(request, response);
```

Di JSP:

```jsp
<h1>${caseDetail.title}</h1>
<p>Status: ${caseDetail.status}</p>
```

Request scope adalah scope paling umum dan paling sehat untuk data halaman.

### 4.2 Mental Model Request Scope

```text
request scope = payload internal dari controller ke view untuk satu response
```

Ia mirip seperti parameter function:

```java
renderCaseDetail(caseDetailViewModel, allowedActions, messages);
```

Bedanya, di JSP data tersebut dibawa lewat `request.setAttribute()`.

### 4.3 Kapan Request Scope Cocok?

Request scope cocok untuk:

1. data page detail,
2. list/table hasil query,
3. form object hasil binding,
4. validation error untuk render ulang form,
5. menu/action visibility hasil evaluasi authorization,
6. breadcrumb,
7. page metadata,
8. search result,
9. alert message yang hanya perlu muncul untuk response saat ini,
10. prepared view model.

Contoh:

```java
CaseDetailPageVm vm = caseQueryService.getCaseDetailPage(caseId, currentUser);
request.setAttribute("page", vm);
request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
       .forward(request, response);
```

JSP:

```jsp
<h1>${page.caseNumber}</h1>
<p>${page.statusLabel}</p>

<c:forEach var="action" items="${page.allowedActions}">
    <button type="submit" name="action" value="${action.code}">
        ${action.label}
    </button>
</c:forEach>
```

### 4.4 Request Scope dan Forward vs Redirect

Request scope bertahan saat `forward`, tetapi hilang saat `redirect`.

```text
Forward:
Browser -> /case/detail -> Servlet -> JSP
              same request attributes survive

Redirect:
Browser -> /case/save -> Servlet -> 302 Location: /case/detail
Browser -> /case/detail -> new request
              old request attributes gone
```

Contoh:

```java
request.setAttribute("message", "Saved successfully");
response.sendRedirect("/case/detail?id=123");
```

`message` tidak akan tersedia setelah redirect karena redirect membuat request baru.

Untuk pesan setelah redirect, gunakan flash-message pattern, bukan request attribute biasa.

### 4.5 Request Attribute vs Request Parameter

Penting membedakan:

```text
request parameter  = input dari client/browser
request attribute  = data internal server-side selama request
```

Parameter:

```java
String caseId = request.getParameter("caseId");
```

Attribute:

```java
request.setAttribute("caseDetail", vm);
```

Parameter berasal dari user dan harus dianggap tidak terpercaya. Attribute biasanya dibuat oleh server dan lebih terpercaya, meskipun isinya tetap bisa berasal dari input yang sudah diproses.

### 4.6 Request Scope Anti-Pattern

#### Anti-pattern 1 — JSP Mengambil Data Sendiri

Buruk:

```jsp
<%
    CaseService service = new CaseService();
    CaseDetail detail = service.findById(request.getParameter("id"));
%>
```

Masalah:

1. JSP menjadi controller.
2. Dependency tersembunyi.
3. Sulit dites.
4. Security boundary kabur.
5. Transaction/persistence boundary tidak jelas.

Lebih baik:

```java
CaseDetailPageVm vm = caseQueryService.getDetail(caseId, currentUser);
request.setAttribute("page", vm);
forward("/WEB-INF/views/case/detail.jsp");
```

#### Anti-pattern 2 — Terlalu Banyak Attribute Lepas

Buruk:

```java
request.setAttribute("caseId", caseId);
request.setAttribute("caseNumber", caseNumber);
request.setAttribute("status", status);
request.setAttribute("officer", officer);
request.setAttribute("actions", actions);
request.setAttribute("canApprove", canApprove);
request.setAttribute("canReject", canReject);
request.setAttribute("canEscalate", canEscalate);
request.setAttribute("documents", documents);
request.setAttribute("auditRows", auditRows);
```

Masalah:

1. JSP punya terlalu banyak dependency implicit.
2. Nama bisa bentrok.
3. Refactoring sulit.
4. Test setup verbose.

Lebih baik:

```java
request.setAttribute("page", new CaseDetailPageVm(
    header,
    summary,
    allowedActions,
    documents,
    auditRows
));
```

JSP:

```jsp
${page.header.caseNumber}
${page.summary.statusLabel}
${page.allowedActions}
```

### 4.7 Request Scope Design Rule

Gunakan request scope sebagai default untuk data rendering.

```text
Kalau data hanya dibutuhkan untuk menghasilkan HTML response saat ini,
letakkan di request scope.
```

---

## 5. Session Scope

### 5.1 Apa itu Session Scope?

**Session scope** hidup selama user session. Di Java web, biasanya direpresentasikan oleh `HttpSession`.

Contoh:

```java
HttpSession session = request.getSession();
session.setAttribute("currentUser", currentUserSummary);
```

Di JSP:

```jsp
Welcome, ${sessionScope.currentUser.displayName}
```

### 5.2 Mental Model Session Scope

```text
session scope = state percakapan antara satu browser/user dan aplikasi
```

Session bukan database. Session bukan cache umum. Session bukan tempat menyimpan semua object yang malas di-query ulang.

Session adalah tempat untuk state yang memang melekat pada interaksi user selama periode login/browsing.

### 5.3 Kapan Session Scope Cocok?

Session scope cocok untuk:

1. current authenticated user summary,
2. selected tenant/agency/context,
3. user locale/timezone preference,
4. CSRF token storage,
5. small wizard state yang memang multi-request,
6. flash message queue sementara,
7. navigation context tertentu,
8. per-user UI preference ringan,
9. login/session metadata.

Contoh current user summary yang aman:

```java
public record CurrentUserSession(
    String userId,
    String displayName,
    Set<String> roles,
    String agencyCode,
    Locale locale
) implements Serializable {}
```

Simpan ringkasan, bukan seluruh domain object.

```java
session.setAttribute("currentUser", currentUserSession);
```

### 5.4 Kapan Session Scope Tidak Cocok?

Session scope tidak cocok untuk:

1. entity JPA attached/detached besar,
2. list ribuan row,
3. file upload content besar,
4. object graph penuh relasi lazy-loading,
5. cache data referensi global,
6. mutable service object,
7. connection/transaction/resource handle,
8. data authorization-sensitive yang bisa berubah cepat,
9. hasil query yang harus selalu fresh,
10. data yang perlu dibagikan lintas user.

Buruk:

```java
session.setAttribute("caseEntity", caseEntity);
session.setAttribute("allSearchResults", hugeList);
session.setAttribute("entityManager", entityManager);
session.setAttribute("jdbcConnection", connection);
```

### 5.5 Session Scope dan Concurrency

Satu user bisa punya beberapa request bersamaan:

1. membuka dua tab,
2. double click submit,
3. browser mengirim parallel resource/API request,
4. Ajax request bersamaan,
5. user refresh saat request lama belum selesai.

Jadi asumsi ini salah:

```text
Satu session = satu request pada satu waktu
```

Yang lebih benar:

```text
Satu session bisa disentuh banyak request/thread secara bersamaan.
```

Contoh bug:

```java
WizardState wizard = (WizardState) session.getAttribute("wizard");
wizard.setCurrentStep(3);
wizard.setSelectedCaseId(caseId);
```

Jika user membuka dua wizard di dua tab, state bisa saling menimpa.

### 5.6 Multi-Tab Problem

Misal user membuka:

```text
Tab A: /case/100/edit
Tab B: /case/200/edit
```

Jika session menyimpan:

```java
session.setAttribute("currentEditingCaseId", caseId);
```

Maka Tab A dan Tab B akan berebut satu slot state yang sama.

Bug yang mungkin terjadi:

1. Tab A submit tapi memproses Case 200.
2. Tab B melihat validation error dari Tab A.
3. Audit trail mencatat action pada case yang salah.
4. User merasa aplikasi “random”.

Desain lebih baik:

1. simpan `caseId` di URL/path/form hidden field,
2. validasi authorization ulang di server,
3. simpan state per-flow dengan flow id,
4. gunakan request scope untuk data halaman,
5. gunakan optimistic locking/version field untuk concurrency domain.

Contoh:

```html
<input type="hidden" name="caseId" value="${page.caseId}">
<input type="hidden" name="version" value="${page.version}">
```

Server:

```java
caseCommandService.updateCase(command, currentUser);
```

Service tetap re-load dan validasi ulang:

```java
CaseAggregate aggregate = repository.findById(command.caseId());
policy.assertCanUpdate(currentUser, aggregate);
aggregate.assertVersion(command.version());
aggregate.update(command);
```

### 5.7 Session Scope dan Clustering

Dalam deployment modern, aplikasi sering berjalan di beberapa node:

```text
Load Balancer
   |
   +--> App Node 1
   +--> App Node 2
   +--> App Node 3
```

Kalau session disimpan in-memory di node, muncul pertanyaan:

1. Apakah request user selalu ke node yang sama?
2. Apakah session direplikasi antar node?
3. Apa yang terjadi jika node mati?
4. Berapa besar biaya replication?
5. Apakah object session serializable?

### 5.8 Sticky Session

Sticky session berarti load balancer mengarahkan user yang sama ke node yang sama.

Kelebihan:

1. sederhana,
2. mengurangi session replication,
3. cocok untuk stateful legacy apps.

Kekurangan:

1. failover lebih sulit,
2. node imbalance,
3. autoscaling kurang fleksibel,
4. deployment rolling bisa mengganggu session,
5. session bloat terkonsentrasi di node tertentu.

### 5.9 Session Replication

Session replication berarti data session disalin ke node lain atau external session store.

Masalah umum:

1. object tidak serializable,
2. object graph terlalu besar,
3. replication terlalu sering,
4. latency naik,
5. class version mismatch saat rolling deployment,
6. stale replicated state.

Karena itu, design rule-nya:

```text
Session harus kecil, serializable, stable, dan berisi state yang benar-benar per-user.
```

### 5.10 Session Bloat

Session bloat terjadi ketika session menyimpan terlalu banyak data.

Gejalanya:

1. heap usage naik mengikuti jumlah user login,
2. GC semakin berat,
3. response lambat saat session replication,
4. node tertentu OOM,
5. deployment rolling menyebabkan banyak session invalid,
6. user mendapat error setelah failover.

Contoh penyebab:

```java
session.setAttribute("searchResults", listOf10000Rows);
session.setAttribute("caseDetail", fullCaseAggregate);
session.setAttribute("documents", uploadedFilesAsBytes);
```

Solusi:

1. simpan query criteria, bukan result besar,
2. simpan id/reference, bukan full object graph,
3. simpan file sementara di object storage/temp storage,
4. paginate result,
5. re-query data per request,
6. gunakan cache eksternal untuk data shared,
7. buat session size budget.

### 5.11 Session Size Budget

Untuk aplikasi enterprise, buat budget eksplisit:

```text
Target session size:
- ideal: < 10 KB per user
- masih wajar: 10–50 KB
- mulai bahaya: > 100 KB
- red flag: > 1 MB
```

Angka ini bukan standar universal, tetapi heuristic yang berguna.

Jika 5.000 user login dan session rata-rata 500 KB:

```text
5.000 * 500 KB = 2.500.000 KB ≈ 2.5 GB raw session data
```

Itu belum termasuk object overhead, replication, serialization, dan GC pressure.

---

## 6. Application Scope

### 6.1 Apa itu Application Scope?

**Application scope** hidup selama web application hidup. Biasanya disimpan di `ServletContext`.

Contoh:

```java
ServletContext app = request.getServletContext();
app.setAttribute("appVersion", "2026.06.18");
```

JSP:

```jsp
${applicationScope.appVersion}
```

### 6.2 Mental Model Application Scope

```text
application scope = shared state untuk seluruh web application instance
```

Ini berarti semua user dan semua request dalam satu application instance bisa melihat data tersebut.

### 6.3 Kapan Application Scope Cocok?

Application scope cocok untuk:

1. metadata aplikasi,
2. read-only configuration snapshot,
3. version/build info,
4. static lookup kecil yang immutable,
5. application-wide feature flag snapshot,
6. expensive-to-create object yang thread-safe dan memang dimiliki container/app.

Contoh:

```java
Map<String, String> countryLabels = Map.copyOf(loadCountryLabels());
servletContext.setAttribute("countryLabels", countryLabels);
```

### 6.4 Kapan Application Scope Berbahaya?

Application scope berbahaya untuk:

1. mutable object tanpa synchronization,
2. per-user data,
3. request-specific data,
4. security context,
5. entity manager/connection,
6. in-memory global cache tanpa eviction,
7. data yang harus konsisten lintas cluster node,
8. data rahasia yang tidak perlu terekspos ke view layer.

Buruk:

```java
application.setAttribute("currentUser", user);
application.setAttribute("lastSearchResult", result);
application.setAttribute("mutableGlobalMap", new HashMap<>());
```

Ini bisa menyebabkan user A melihat data user B.

### 6.5 Application Scope dan Distributed Deployment

Dalam distributed deployment, application scope biasanya hanya berlaku per JVM/node.

```text
Node 1 ServletContext != Node 2 ServletContext
```

Jika kamu menyimpan:

```java
application.setAttribute("featureFlags", flags);
```

Maka update di Node 1 belum tentu terlihat di Node 2.

Untuk state global yang benar-benar perlu konsisten lintas node, gunakan external source:

1. database,
2. Redis,
3. config service,
4. feature flag service,
5. distributed cache dengan invalidation strategy.

### 6.6 Application Scope dan Thread-Safety

Karena application scope bisa disentuh banyak request secara paralel, semua mutable object di dalamnya harus thread-safe.

Buruk:

```java
Map<String, Integer> counters = new HashMap<>();
application.setAttribute("counters", counters);
```

Kemudian:

```java
Map<String, Integer> counters = (Map<String, Integer>) application.getAttribute("counters");
counters.put("caseView", counters.getOrDefault("caseView", 0) + 1);
```

Masalah:

1. `HashMap` tidak thread-safe,
2. increment tidak atomic,
3. race condition,
4. corrupt internal structure dalam kasus ekstrem.

Lebih baik:

```java
ConcurrentMap<String, LongAdder> counters = new ConcurrentHashMap<>();
counters.computeIfAbsent("caseView", key -> new LongAdder()).increment();
```

Namun untuk production metrics, lebih baik gunakan metrics system seperti Micrometer/Prometheus daripada application scope manual.

---

## 7. Attribute Lookup Order di JSP/EL

### 7.1 Kenapa Lookup Order Penting?

Saat JSP menulis:

```jsp
${user}
```

EL perlu menentukan `user` ini datang dari mana.

Secara mental, lookup scoped attribute berjalan seperti:

```text
page scope -> request scope -> session scope -> application scope
```

Jadi jika nama `user` ada di lebih dari satu scope, yang paling dekat akan menang.

Contoh:

```java
request.setAttribute("user", "Request User");
session.setAttribute("user", "Session User");
```

JSP:

```jsp
${user}
```

Hasil yang terbaca adalah request attribute, bukan session attribute.

### 7.2 Explicit Scope Access

Untuk menghindari ambiguity, gunakan explicit scope jika perlu:

```jsp
${requestScope.user}
${sessionScope.currentUser}
${applicationScope.appVersion}
```

Untuk view model utama, biasanya cukup:

```jsp
${page.caseNumber}
```

Dengan asumsi nama `page` dikontrol dan hanya dipakai sebagai request attribute.

### 7.3 Naming Convention

Gunakan nama attribute yang eksplisit dan konsisten:

```text
request attribute:
- page
- form
- errors
- breadcrumbs

session attribute:
- currentUser
- userPreferences
- csrfToken
- flashMessages

application attribute:
- appInfo
- staticLookups
- featureFlagsSnapshot
```

Hindari nama generik:

```text
user
list
data
result
item
object
bean
```

Nama generik membuat konflik scope lebih mungkin.

---

## 8. Data Handoff dari Controller ke JSP

### 8.1 Pola Ideal

Pola sehat dalam Servlet/JSP:

```text
HTTP Request
   -> Filter/security context
   -> Controller/Servlet
   -> Service/query layer
   -> View model
   -> request.setAttribute("page", vm)
   -> forward to JSP
   -> JSP renders only
```

Contoh:

```java
public class CaseDetailServlet extends HttpServlet {

    private final CasePageQueryService queryService;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        CurrentUser currentUser = CurrentUserResolver.from(request);
        String caseId = request.getParameter("caseId");

        CaseDetailPageVm page = queryService.getDetailPage(caseId, currentUser);

        request.setAttribute("page", page);
        request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
               .forward(request, response);
    }
}
```

JSP:

```jsp
<h1>Case ${page.caseNumber}</h1>
<p>Status: ${page.statusLabel}</p>

<c:if test="${page.showEscalationBanner}">
    <div class="alert alert-warning">
        This case is approaching escalation SLA.
    </div>
</c:if>
```

### 8.2 View Model sebagai Contract

View model adalah kontrak antara controller dan JSP.

Tanpa view model, JSP sering membaca object domain langsung:

```jsp
${case.assignedOfficer.department.parentAgency.name}
${case.workflow.currentStage.assignee.role.permissions}
```

Ini buruk karena:

1. JSP tahu terlalu banyak struktur domain,
2. lazy loading bisa terjadi saat render,
3. N+1 bisa tersembunyi di view,
4. perubahan domain memecahkan JSP,
5. authorization logic bisa bocor.

Lebih baik view model datar/terkendali:

```java
public record CaseDetailPageVm(
    String caseId,
    String caseNumber,
    String statusLabel,
    String assignedOfficerName,
    String agencyLabel,
    boolean showEscalationBanner,
    List<ActionVm> allowedActions,
    List<DocumentRowVm> documents
) {}
```

JSP:

```jsp
${page.assignedOfficerName}
${page.agencyLabel}
```

### 8.3 View Model Bukan Domain Model

Domain model menjawab:

```text
Apa aturan bisnis dan state valid sistem?
```

View model menjawab:

```text
Apa yang perlu ditampilkan page ini?
```

Perbedaan ini penting.

Contoh domain:

```java
class EnforcementCase {
    private CaseStatus status;
    private Officer assignedOfficer;
    private List<CaseEvent> events;

    boolean canEscalate(User user) { ... }
    void escalate(User user, Reason reason) { ... }
}
```

Contoh view model:

```java
record CaseDetailPageVm(
    String caseNumber,
    String statusLabel,
    String assignedOfficerLabel,
    boolean canEscalate,
    String escalationTooltip
) {}
```

View model boleh berisi hasil policy evaluation, tetapi bukan policy engine itu sendiri.

---

## 9. Flash Message Pattern

### 9.1 Problem: Redirect Menghapus Request Attribute

Setelah POST berhasil, best practice biasanya redirect:

```text
POST /case/approve
  -> process command
  -> redirect to GET /case/detail?id=123
```

Ini disebut POST-Redirect-GET.

Masalahnya: request attribute hilang setelah redirect.

### 9.2 Solusi: Flash Message

Flash message adalah pesan yang:

1. disimpan sementara sebelum redirect,
2. dibaca di request berikutnya,
3. langsung dihapus setelah dibaca.

### 9.3 Implementasi Sederhana dengan Session

Command servlet:

```java
session.setAttribute("flash.success", "Case approved successfully.");
response.sendRedirect(request.getContextPath() + "/case/detail?caseId=" + caseId);
```

Filter atau helper di GET:

```java
String success = (String) session.getAttribute("flash.success");
if (success != null) {
    request.setAttribute("successMessage", success);
    session.removeAttribute("flash.success");
}
```

JSP:

```jsp
<c:if test="${not empty successMessage}">
    <div class="alert alert-success">
        <c:out value="${successMessage}" />
    </div>
</c:if>
```

### 9.4 Flash Message dengan Queue

Jika aplikasi punya beberapa message:

```java
public record FlashMessage(String severity, String text) implements Serializable {}
```

Session:

```java
@SuppressWarnings("unchecked")
List<FlashMessage> messages = (List<FlashMessage>) session.getAttribute("flashMessages");
if (messages == null) {
    messages = new ArrayList<>();
    session.setAttribute("flashMessages", messages);
}
messages.add(new FlashMessage("success", "Case approved successfully."));
```

Pada next request:

```java
List<FlashMessage> messages = (List<FlashMessage>) session.getAttribute("flashMessages");
if (messages != null) {
    request.setAttribute("flashMessages", List.copyOf(messages));
    session.removeAttribute("flashMessages");
}
```

### 9.5 Flash Message Failure Modes

1. Pesan muncul dua kali jika tidak dihapus.
2. Pesan hilang jika redirect chain terlalu panjang dan handler salah.
3. Pesan dari tab A muncul di tab B.
4. Pesan terlalu besar jika menyimpan detail exception.
5. Pesan tidak di-escape, menyebabkan XSS.

Untuk aplikasi multi-tab intensif, flash message bisa dibuat lebih robust dengan `flashId`:

```text
/case/detail?caseId=123&flashId=abc123
```

Session menyimpan map:

```text
flash[abc123] = messages
```

Ini mengurangi tab collision.

---

## 10. Scope Selection Decision Table

Gunakan tabel ini sebagai heuristic awal.

| Data | Scope yang Disarankan | Alasan |
|---|---:|---|
| Case detail page data | Request | hanya untuk render response saat ini |
| Search results page | Request | bisa di-query ulang/paginate |
| Search criteria sederhana | Request atau query param | bookmarkable dan stateless |
| Current user summary | Session | melekat pada login/session |
| User locale | Session | preferensi user selama browsing |
| CSRF token | Session atau security framework | perlu validasi lintas request |
| Flash success message after redirect | Session sementara lalu request | perlu survive redirect sekali |
| Large uploaded file | External temp storage | jangan simpan bytes besar di session |
| Static country lookup | Application immutable atau cache external | shared read-only |
| Feature flags | Application snapshot atau external config | tergantung consistency need |
| Entity JPA | Jangan simpan di scope view/session | rawan stale/lazy/security |
| DB connection | Tidak boleh | resource lifecycle bukan milik view/session |
| Service object | DI/container, bukan attribute | lifecycle dikelola container |
| Wizard state | Session kecil dengan flow id atau external store | multi-request, hati-hati multi-tab |
| Authorization decision for current page | Request | hasil evaluasi untuk render saat ini |
| Actual authorization enforcement | Service/controller/security layer | jangan bergantung pada view |

---

## 11. Hidden Coupling antar Scope

### 11.1 Masalah Hidden Coupling

JSP sering terlihat sederhana:

```jsp
${page.title}
${currentUser.displayName}
${featureFlags.newDashboard}
```

Namun sebenarnya ia bergantung pada beberapa scope:

```text
page          -> mungkin request attribute
currentUser   -> mungkin session attribute
featureFlags  -> mungkin application attribute
```

Jika tidak dikontrol, JSP menjadi sulit dipahami karena dependency-nya tersebar.

### 11.2 Buat Dependency Eksplisit

Salah satu cara: jadikan request view model sebagai pusat data halaman.

```java
record LayoutVm(
    String pageTitle,
    CurrentUserHeaderVm currentUser,
    List<MenuItemVm> menuItems,
    List<FlashMessageVm> flashMessages
) {}

record CaseDetailPageVm(
    LayoutVm layout,
    CaseHeaderVm caseHeader,
    List<ActionVm> allowedActions
) {}
```

JSP:

```jsp
<title>${page.layout.pageTitle}</title>
<span>${page.layout.currentUser.displayName}</span>
```

Dengan cara ini, JSP tidak perlu tahu apakah data asalnya dari session, request, database, atau security context.

### 11.3 Trade-Off

Terlalu eksplisit juga bisa verbose.

Jadi gunakan prinsip:

```text
Untuk data umum layout: boleh dari shared layout helper/filter.
Untuk data page-specific: jadikan request view model eksplisit.
Untuk authorization: render boleh baca allowedActions, enforcement tetap di server/service.
```

---

## 12. Scope dan Authorization

### 12.1 View Visibility Bukan Authorization

JSP sering melakukan:

```jsp
<c:if test="${page.canApprove}">
    <button type="submit" name="action" value="APPROVE">Approve</button>
</c:if>
```

Ini hanya **visibility control**.

User tetap bisa mengirim request manual:

```http
POST /case/action
caseId=123&action=APPROVE
```

Maka server tetap wajib melakukan authorization ulang.

### 12.2 Pola yang Benar

Render:

```java
page.allowedActions = policy.visibleActions(currentUser, caseAggregate);
```

Command:

```java
policy.assertCanApprove(currentUser, caseAggregate);
caseAggregate.approve(currentUser, reason);
```

View membantu UX. Service/controller menjaga invariant.

### 12.3 Jangan Simpan Authorization Final di Session

Buruk:

```java
session.setAttribute("canApproveCase123", true);
```

Kenapa buruk?

1. Role user bisa berubah.
2. Case status bisa berubah.
3. Assignment bisa berubah.
4. Session state stale.
5. Multi-tab/multi-node bisa tidak konsisten.

Lebih baik simpan user identity/roles secukupnya di session/security context, lalu evaluasi authorization terhadap state terbaru pada saat action.

---

## 13. Scope dan Form Handling

### 13.1 GET Form Render

GET render:

```java
FormVm form = service.prepareCreateForm(currentUser);
request.setAttribute("form", form);
forward("/WEB-INF/views/case/create.jsp");
```

JSP:

```jsp
<input name="subject" value="${form.subject}">
<select name="category">
    <c:forEach var="option" items="${form.categoryOptions}">
        <option value="${option.value}">${option.label}</option>
    </c:forEach>
</select>
```

### 13.2 POST Validation Failure

Jika validasi gagal, forward kembali dengan request attribute:

```java
request.setAttribute("form", formWithSubmittedValues);
request.setAttribute("errors", errors);
forward("/WEB-INF/views/case/create.jsp");
```

Mengapa forward, bukan redirect?

Karena kita ingin mempertahankan submitted values dan error dalam request saat ini.

### 13.3 POST Success

Jika sukses:

```java
service.create(command, currentUser);
flash.success(session, "Case created successfully.");
response.sendRedirect("/case/detail?caseId=" + createdCaseId);
```

Jadi pattern-nya:

```text
GET form          -> request scope
POST invalid      -> request scope + forward
POST valid        -> session flash + redirect
Next GET          -> flash moved to request then removed
```

### 13.4 Jangan Simpan Form Object Besar di Session

Buruk:

```java
session.setAttribute("caseCreateForm", form);
```

Kecuali memang multi-step wizard, form biasa harus request-scoped.

---

## 14. Scope dan Wizard/Multi-Step Flow

### 14.1 Wizard Lebih Sulit daripada Form Biasa

Wizard punya beberapa step:

```text
Step 1: Applicant Info
Step 2: Case Details
Step 3: Documents
Step 4: Review
Step 5: Submit
```

Karena state hidup lintas request, session sering dipakai.

Tapi session naive bisa menyebabkan multi-tab bug.

### 14.2 Naive Wizard State

Buruk:

```java
session.setAttribute("caseWizard", wizardState);
```

Masalah:

1. hanya bisa satu wizard aktif per user,
2. tab collision,
3. stale wizard tertinggal,
4. memory leak jika tidak dibersihkan,
5. sulit resume/expire.

### 14.3 Flow ID Pattern

Lebih baik:

```text
/session
  caseWizardFlows:
    flow-abc123 -> state for Case A
    flow-def456 -> state for Case B
```

URL:

```text
/case/create/step-2?flowId=flow-abc123
```

Server:

```java
WizardState state = wizardStore.get(session, flowId);
```

### 14.4 Wizard State Rules

1. Harus kecil.
2. Harus serializable jika session bisa direplikasi.
3. Harus punya expiry.
4. Harus dibersihkan setelah submit/cancel.
5. Jangan simpan uploaded file bytes besar.
6. Jangan simpan entity JPA.
7. Simpan draft id atau temporary resource id jika state besar.

### 14.5 Alternative: Persisted Draft

Untuk wizard besar, lebih baik simpan draft di database:

```text
case_draft
- draft_id
- user_id
- current_step
- payload_json
- created_at
- updated_at
- expires_at
```

Session hanya menyimpan `draftId` atau flow id.

Kelebihan:

1. survive restart,
2. bisa resume,
3. bisa audit,
4. lebih aman untuk large flow,
5. lebih mudah expire secara batch.

Kekurangan:

1. butuh schema,
2. butuh cleanup,
3. butuh concurrency control,
4. butuh security check draft owner.

---

## 15. Scope dan Persistence Boundary

### 15.1 Jangan Bawa Entity ke View Sembarangan

Dalam aplikasi JPA/Hibernate, sering muncul:

```java
CaseEntity entity = em.find(CaseEntity.class, id);
request.setAttribute("case", entity);
```

JSP:

```jsp
${case.assignedOfficer.department.name}
${case.documents[0].fileName}
```

Risiko:

1. lazy loading saat render,
2. `LazyInitializationException` jika persistence context sudah tutup,
3. N+1 query tersembunyi,
4. view bergantung struktur entity,
5. field sensitif bisa terekspos,
6. entity detached bisa disimpan lagi tanpa sengaja.

### 15.2 View Model Boundary

Lebih baik query menghasilkan DTO/view model:

```java
CaseDetailPageVm vm = caseReadRepository.findCaseDetailPage(caseId, currentUser);
request.setAttribute("page", vm);
```

Keuntungan:

1. query eksplisit,
2. field yang tampil terkontrol,
3. tidak ada lazy loading di view,
4. testable,
5. aman untuk serialization,
6. mudah dioptimasi.

### 15.3 Open Session in View

Open Session in View mempertahankan persistence context sampai rendering selesai.

Kelebihan:

1. menghindari lazy loading error,
2. cepat untuk prototype.

Kekurangan:

1. query bisa terjadi di view,
2. performance sulit diprediksi,
3. transaction boundary kabur,
4. rendering bisa memicu database access,
5. sulit melakukan security review.

Untuk sistem enterprise/regulatory, view model explicit biasanya lebih defensible.

---

## 16. Scope dan Security Data

### 16.1 Prinsip Minimum Exposure

Jangan taruh data sensitif di scope yang tidak perlu.

Buruk:

```java
request.setAttribute("user", fullUserEntityWithPasswordHashAndSecrets);
session.setAttribute("idToken", rawIdToken);
session.setAttribute("accessToken", rawAccessToken);
```

Lebih baik:

```java
session.setAttribute("currentUser", new CurrentUserSession(
    userId,
    displayName,
    roles,
    agencyCode,
    locale
));
```

### 16.2 Hidden Field Bukan Storage Aman

Jika JSP render:

```html
<input type="hidden" name="approvalLimit" value="1000000">
```

User bisa ubah value tersebut.

Hidden field boleh membawa identifier/version/token, tetapi server harus validasi ulang.

Contoh aman relatif:

```html
<input type="hidden" name="caseId" value="${page.caseId}">
<input type="hidden" name="version" value="${page.version}">
<input type="hidden" name="csrfToken" value="${csrfToken}">
```

Server tetap:

1. cek CSRF,
2. cek user session,
3. load case terbaru,
4. cek authorization,
5. cek optimistic version,
6. execute command.

---

## 17. Scope dan Error Handling

### 17.1 Request Error

Untuk error validasi form, request scope cocok:

```java
request.setAttribute("errors", errors);
forward("/WEB-INF/views/case/edit.jsp");
```

JSP:

```jsp
<c:if test="${not empty errors.subject}">
    <span class="error"><c:out value="${errors.subject}" /></span>
</c:if>
```

### 17.2 Session Error

Session error hanya cocok untuk pesan setelah redirect.

Jangan menyimpan exception object di session:

```java
session.setAttribute("lastException", exception); // buruk
```

Masalah:

1. object besar,
2. stack trace sensitif,
3. serialization issue,
4. bisa bocor ke user,
5. memory leak.

Lebih baik:

1. log exception dengan correlation id,
2. tampilkan error reference di request,
3. simpan flash message generik.

```java
String errorRef = correlationIdProvider.currentId();
log.error("Failed to approve case. ref={}", errorRef, ex);
request.setAttribute("errorRef", errorRef);
```

JSP:

```jsp
<p>Unable to process request. Reference: <c:out value="${errorRef}" /></p>
```

---

## 18. Scope dan Included JSP/Layout

### 18.1 Include Bisa Membaca Scope yang Sama

Jika JSP utama melakukan include:

```jsp
<jsp:include page="/WEB-INF/views/layout/header.jsp" />
```

Included JSP dapat membaca request/session/application attributes yang sama.

Ini berguna, tetapi juga bisa menciptakan hidden dependency.

### 18.2 Layout Contract

Buat layout contract eksplisit:

```java
request.setAttribute("layout", layoutVm);
request.setAttribute("page", pageVm);
```

Header JSP:

```jsp
<span>${layout.currentUser.displayName}</span>
```

Content JSP:

```jsp
<h1>${page.title}</h1>
```

### 18.3 Hindari Include yang Mengubah State Global

Buruk:

```jsp
<% session.setAttribute("lastVisitedPage", request.getRequestURI()); %>
```

Atau:

```jsp
<c:set var="currentMenu" value="case" scope="session" />
```

Layout sebaiknya render, bukan mengubah session/application state tanpa alasan kuat.

---

## 19. Scope dan Caching

### 19.1 Session Bukan Cache Umum

Kadang developer menyimpan reference data di session:

```java
session.setAttribute("allCountries", countryService.findAll());
```

Jika ada 10.000 user, list yang sama disalin 10.000 kali.

Lebih baik:

1. cache di service layer,
2. application immutable lookup,
3. Redis/cache provider,
4. HTTP caching untuk static resources.

### 19.2 Application Scope Bukan Distributed Cache

Application scope hanya per webapp instance. Dalam cluster, setiap node punya copy sendiri.

Untuk cache sederhana read-only yang jarang berubah, ini bisa diterima.

Untuk data yang perlu invalidation konsisten, gunakan cache eksternal.

### 19.3 Cache Key Harus Memperhatikan User/Authorization

Buruk:

```java
applicationCache.put("caseDetail:" + caseId, pageVm);
```

Jika pageVm berisi action visibility berdasarkan user, user lain bisa mendapat visibility salah.

Lebih baik pisahkan:

1. data publik/shared,
2. data user-specific,
3. authorization result per request.

---

## 20. Production Diagnostics: Session Bloat

### 20.1 Gejala

1. Heap naik seiring user aktif.
2. Full GC makin sering.
3. Node restart/OOM saat jam sibuk.
4. Failover lambat.
5. Response lambat setelah login lama.
6. Replication traffic tinggi.

### 20.2 Apa yang Dicek

1. Jumlah active sessions.
2. Average session size.
3. Top session attributes by size.
4. Object graph terbesar.
5. Attribute yang tidak serializable.
6. Session timeout.
7. Upload/temp data di session.
8. Search result/list besar di session.
9. Wizard state yang tidak dibersihkan.

### 20.3 Instrumentasi Sederhana

Buat listener:

```java
public class SessionAttributeAuditListener implements HttpSessionAttributeListener {

    @Override
    public void attributeAdded(HttpSessionBindingEvent event) {
        log.debug("Session attribute added: name={}, type={}",
            event.getName(),
            event.getValue() == null ? "null" : event.getValue().getClass().getName());
    }

    @Override
    public void attributeReplaced(HttpSessionBindingEvent event) {
        log.debug("Session attribute replaced: name={}, oldType={}",
            event.getName(),
            event.getValue() == null ? "null" : event.getValue().getClass().getName());
    }

    @Override
    public void attributeRemoved(HttpSessionBindingEvent event) {
        log.debug("Session attribute removed: name={}", event.getName());
    }
}
```

Untuk production, jangan log value sensitif. Log nama attribute, tipe, ukuran estimasi jika aman, dan correlation context.

### 20.4 Heap Dump Analysis

Jika ada heap dump, cari:

```text
HttpSession
StandardSession
SessionData
ConcurrentHashMap inside session manager
```

Lalu lihat retained size attribute.

Pertanyaan diagnosis:

1. Attribute apa paling besar?
2. Dari servlet/controller mana attribute itu dibuat?
3. Apakah attribute perlu session?
4. Apakah bisa diganti id/query criteria?
5. Apakah perlu cleanup?

---

## 21. Production Diagnostics: Stale Data

### 21.1 Gejala

1. User melihat status lama.
2. Action button masih muncul setelah status berubah.
3. Submit gagal karena state sudah berubah.
4. Dua tab punya behavior berbeda.
5. Setelah role berubah, menu tidak update sampai logout.

### 21.2 Penyebab Umum

1. Authorization result disimpan di session.
2. Case detail disimpan di session.
3. Lookup cache tidak invalid.
4. Browser cache tidak dikontrol.
5. User membuka tab lama.
6. Optimistic locking tidak diterapkan.

### 21.3 Solusi

1. Re-query state penting per request.
2. Simpan identifier, bukan snapshot besar.
3. Gunakan version field.
4. Render action berdasarkan state terbaru.
5. Command service selalu validate invariant.
6. Untuk menu role-sensitive, refresh session user context saat role berubah atau paksa re-login/session invalidation.

---

## 22. Production Diagnostics: Cross-User Data Leak

### 22.1 Gejala

1. User melihat nama/data user lain.
2. Search result berubah random.
3. Last selected case salah.
4. Header menampilkan identity salah.

### 22.2 Penyebab Umum

1. Data user disimpan di application scope.
2. Servlet field mutable menyimpan request data.
3. Static variable menyimpan per-request/per-user data.
4. Custom tag handler tidak thread-safe.
5. Shared mutable object tidak dikloning.

### 22.3 Contoh Buruk: Servlet Field

```java
public class CaseServlet extends HttpServlet {
    private String currentCaseId;

    protected void doGet(HttpServletRequest request, HttpServletResponse response) {
        currentCaseId = request.getParameter("caseId");
        request.setAttribute("caseId", currentCaseId);
    }
}
```

Servlet instance bisa melayani banyak request. Field instance bukan tempat request data.

Lebih baik:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response) {
    String currentCaseId = request.getParameter("caseId");
    request.setAttribute("caseId", currentCaseId);
}
```

---

## 23. Scope dan Modern Java 8–25

### 23.1 Java 8 Era

Banyak aplikasi Java 8 masih memakai:

1. Java EE 7/8,
2. `javax.servlet.*`,
3. JSP 2.x,
4. JSTL 1.2,
5. JSF 2.x,
6. WAR deployment tradisional.

Scope behavior secara konsep tetap sama, tetapi package dan container berbeda.

### 23.2 Java 11/17 Era

Java 11/17 sering menjadi titik migrasi:

1. upgrade container,
2. modular runtime awareness,
3. stronger encapsulation,
4. dependency modernization,
5. move to Jakarta EE 9/10/11.

Yang perlu dijaga:

1. session objects tetap serializable jika cluster,
2. jangan menyimpan object yang bergantung classloader lama,
3. rolling deployment bisa gagal jika session class berubah drastis.

### 23.3 Java 21/25 Era

Dengan Java 21/25, kamu mungkin memakai runtime modern, container modern, dan virtual-thread-aware components.

Namun scope rule tidak berubah:

```text
Virtual threads tidak membuat mutable session/application state otomatis aman.
```

Concurrency bug tetap concurrency bug.

Jika lebih banyak request bisa diproses secara efisien, pressure terhadap shared state bisa makin terlihat.

---

## 24. Scope dan Jakarta Faces Preview

Walaupun bagian ini fokus JSP/Jakarta Pages, konsep scope juga sangat penting di Jakarta Faces.

Faces punya scope tambahan/varian seperti:

1. request scope,
2. view scope,
3. session scope,
4. application scope,
5. conversation scope/CDI context.

Perbedaan penting:

```text
JSP request rendering:
  request -> render HTML -> selesai

Faces component lifecycle:
  restore view -> apply values -> validate -> update model -> invoke action -> render
```

Faces view scope akan dibahas detail nanti, tetapi fondasinya sama:

```text
Pilih scope berdasarkan lifetime, visibility, ownership, dan concurrency.
```

---

## 25. Practical Design Patterns

### 25.1 Page View Model Pattern

Controller:

```java
CaseDetailPageVm page = queryService.getPage(caseId, currentUser);
request.setAttribute("page", page);
forward("/WEB-INF/views/case/detail.jsp");
```

JSP:

```jsp
<h1>${page.title}</h1>
```

Kelebihan:

1. dependency jelas,
2. mudah dites,
3. security lebih mudah diaudit,
4. persistence boundary bersih,
5. rendering lebih predictable.

### 25.2 Layout View Model Pattern

Filter/controller base:

```java
LayoutVm layout = layoutService.build(currentUser, request);
request.setAttribute("layout", layout);
```

JSP layout:

```jsp
<title>${layout.pageTitle}</title>
<nav>
    <c:forEach var="item" items="${layout.menuItems}">
        <a href="${item.href}">${item.label}</a>
    </c:forEach>
</nav>
```

### 25.3 Flash Scope Emulation Pattern

Session sementara:

```java
flash.add(session, FlashMessage.success("Saved."));
redirect("/case/detail?id=" + id);
```

Next request:

```java
request.setAttribute("flashMessages", flash.consume(session));
```

### 25.4 Flow ID Pattern

Untuk wizard:

```text
flowId in URL/form
state in session map or persisted draft
cleanup on submit/cancel/expiry
```

### 25.5 Stateless Search Pattern

Search criteria di URL:

```text
/cases?status=OPEN&assignedTo=me&page=2
```

Kelebihan:

1. bookmarkable,
2. shareable,
3. back button friendly,
4. tidak membebani session,
5. mudah scale.

---

## 26. Scope Selection Algorithm

Saat ingin menyimpan data, jalankan pertanyaan ini:

```text
1. Apakah data hanya perlu untuk render response saat ini?
   -> request scope.

2. Apakah data hanya variable lokal selama rendering JSP?
   -> page scope.

3. Apakah data harus bertahan setelah redirect satu kali?
   -> flash message via session sementara.

4. Apakah data melekat pada user selama login/session?
   -> session scope, kecil dan serializable.

5. Apakah data shared semua user dan immutable/read-only?
   -> application scope atau service-level cache.

6. Apakah data shared semua node dan perlu konsisten?
   -> external store/cache/config, bukan application scope.

7. Apakah data besar, binary, atau long-lived?
   -> external storage/database, bukan session.

8. Apakah data resource seperti connection/entity manager/thread?
   -> jangan simpan di JSP scope.
```

---

## 27. Enterprise Checklist

### 27.1 Request Scope Checklist

Gunakan request scope jika:

- [ ] data hanya untuk response saat ini,
- [ ] data berasal dari controller/service,
- [ ] data tidak perlu survive redirect,
- [ ] data berupa view model/DTO,
- [ ] data aman untuk dirender setelah escaping,
- [ ] JSP tidak perlu query database sendiri.

### 27.2 Session Scope Checklist

Gunakan session scope hanya jika:

- [ ] data benar-benar per-user,
- [ ] data perlu lintas request,
- [ ] data kecil,
- [ ] data serializable jika cluster,
- [ ] data tidak mengandung resource handle,
- [ ] data tidak berisi object graph besar,
- [ ] ada cleanup/expiry jika flow state,
- [ ] aman terhadap multi-tab.

### 27.3 Application Scope Checklist

Gunakan application scope hanya jika:

- [ ] data shared seluruh app instance,
- [ ] data immutable atau thread-safe,
- [ ] data bukan per-user,
- [ ] data tidak butuh konsistensi lintas node atau ada strategy refresh,
- [ ] data tidak besar tanpa eviction,
- [ ] data tidak menyimpan secret yang tidak perlu.

### 27.4 JSP Rendering Checklist

- [ ] JSP tidak melakukan query DB.
- [ ] JSP tidak membuat service sendiri.
- [ ] JSP tidak menulis session/application state tanpa alasan kuat.
- [ ] Data page-specific dibungkus view model.
- [ ] Authorization action divalidasi ulang di server.
- [ ] Hidden field tidak dipercaya.
- [ ] Output di-escape sesuai context.
- [ ] Session tidak menyimpan result besar.
- [ ] Flow multi-step punya flow id dan cleanup.

---

## 28. Case Study: Regulatory Case Detail Page

### 28.1 Requirement

Halaman detail case perlu menampilkan:

1. case number,
2. status,
3. assigned officer,
4. SLA warning,
5. allowed actions,
6. documents,
7. audit timeline,
8. flash message setelah action,
9. current user header,
10. role-aware menu.

### 28.2 Scope Design

```text
Request scope:
- page: CaseDetailPageVm
- layout: LayoutVm
- flashMessages: consumed flash messages

Session scope:
- currentUser: CurrentUserSession
- csrfToken
- temporary flash queue

Application scope:
- appInfo
- static lookup snapshot if immutable

External/database:
- case aggregate
- documents
- audit trail
- workflow state
```

### 28.3 Controller

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {

    CurrentUserSession currentUser = (CurrentUserSession)
            request.getSession(false).getAttribute("currentUser");

    String caseId = request.getParameter("caseId");

    LayoutVm layout = layoutService.build(currentUser);
    CaseDetailPageVm page = casePageQueryService.getCaseDetailPage(caseId, currentUser);
    List<FlashMessageVm> flashMessages = flash.consume(request.getSession());

    request.setAttribute("layout", layout);
    request.setAttribute("page", page);
    request.setAttribute("flashMessages", flashMessages);

    request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
           .forward(request, response);
}
```

### 28.4 JSP

```jsp
<h1>Case <c:out value="${page.caseNumber}" /></h1>

<c:if test="${not empty flashMessages}">
    <c:forEach var="message" items="${flashMessages}">
        <div class="alert alert-${message.severity}">
            <c:out value="${message.text}" />
        </div>
    </c:forEach>
</c:if>

<p>Status: <c:out value="${page.statusLabel}" /></p>
<p>Assigned officer: <c:out value="${page.assignedOfficerName}" /></p>

<c:if test="${page.showSlaWarning}">
    <div class="alert alert-warning">
        This case is approaching SLA breach.
    </div>
</c:if>

<form method="post" action="${page.actionEndpoint}">
    <input type="hidden" name="caseId" value="${page.caseId}">
    <input type="hidden" name="version" value="${page.version}">
    <input type="hidden" name="csrfToken" value="${layout.csrfToken}">

    <c:forEach var="action" items="${page.allowedActions}">
        <button type="submit" name="action" value="${action.code}">
            <c:out value="${action.label}" />
        </button>
    </c:forEach>
</form>
```

### 28.5 Command Handler

```java
protected void doPost(HttpServletRequest request, HttpServletResponse response)
        throws IOException, ServletException {

    CurrentUserSession currentUser = requireCurrentUser(request);

    CaseActionCommand command = new CaseActionCommand(
        request.getParameter("caseId"),
        request.getParameter("version"),
        request.getParameter("action"),
        request.getParameter("reason")
    );

    try {
        csrfService.assertValid(request);
        caseCommandService.execute(command, currentUser);
        flash.success(request.getSession(), "Action completed successfully.");
        response.sendRedirect(request.getContextPath() + "/case/detail?caseId=" + command.caseId());
    } catch (ValidationException ex) {
        CaseDetailPageVm page = casePageQueryService.rebuildWithErrors(command, currentUser, ex.errors());
        request.setAttribute("page", page);
        request.setAttribute("errors", ex.errors());
        request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
               .forward(request, response);
    }
}
```

### 28.6 Invariant

Yang paling penting:

```text
Button visibility di JSP bukan security boundary.
Session currentUser bukan authorization final.
Hidden caseId/version bukan trusted state.
Command service tetap menjaga invariant domain.
```

---

## 29. Common Mistakes dan Refactoring

### 29.1 Mistake: Semua Disimpan di Session

Buruk:

```java
session.setAttribute("page", pageVm);
```

Refactor:

```java
request.setAttribute("page", pageVm);
```

Jika perlu redirect, simpan id/flash saja.

### 29.2 Mistake: JSP Membaca Banyak Scope Acak

Buruk:

```jsp
${user.name}
${case.status}
${config.theme}
${result.items}
${roleMap[user.role]}
```

Refactor:

```jsp
${layout.currentUser.name}
${page.statusLabel}
${layout.theme}
${page.items}
${page.allowedActions}
```

### 29.3 Mistake: Application Scope untuk User Data

Buruk:

```java
servletContext.setAttribute("currentUser", user);
```

Refactor:

```java
request.getSession().setAttribute("currentUser", currentUserSession);
```

### 29.4 Mistake: Session untuk Search Result Besar

Buruk:

```java
session.setAttribute("searchResults", results);
```

Refactor:

```text
Search criteria in query parameter
Paginated query per request
Result in request scope
```

### 29.5 Mistake: Store Mutable HashMap in Application Scope

Buruk:

```java
application.setAttribute("lookup", new HashMap<>());
```

Refactor untuk read-only:

```java
application.setAttribute("lookup", Map.copyOf(lookup));
```

Refactor untuk dynamic distributed data:

```text
Use service/cache/database with concurrency and invalidation strategy
```

---

## 30. Final Mental Model

Jangan mulai dari pertanyaan:

```text
Scope mana yang mudah diakses dari JSP?
```

Mulailah dari pertanyaan:

```text
Berapa lama data ini seharusnya hidup?
Siapa yang boleh melihatnya?
Siapa pemiliknya?
Apakah bisa disentuh paralel?
Apakah harus konsisten lintas node?
Apakah aman jika stale?
Apakah aman jika user memanipulasi request?
```

Ringkasnya:

```text
page scope:
  local rendering variable

request scope:
  default untuk page data dan form errors

session scope:
  small per-user conversational state

application scope:
  shared immutable/thread-safe app-level state

external store:
  large, distributed, durable, cross-node, or shared mutable state
```

Scope yang benar membuat JSP/Jakarta Pages menjadi predictable. Scope yang salah membuat aplikasi terlihat normal saat development, tetapi rapuh saat production: multi-user, multi-tab, multi-node, high traffic, failover, dan long-lived sessions.

---

## 31. Ringkasan Part 4

Di bagian ini kita sudah membahas:

1. Scope sebagai lifetime + visibility + ownership + concurrency model.
2. Page scope sebagai local rendering state.
3. Request scope sebagai default handoff controller ke JSP.
4. Session scope sebagai per-user conversational state yang harus kecil dan hati-hati.
5. Application scope sebagai shared app-level state yang harus immutable/thread-safe.
6. Attribute lookup order dan risiko name collision.
7. View model sebagai kontrak controller-view.
8. Flash message pattern untuk redirect.
9. Multi-tab, clustering, sticky session, dan session replication.
10. Scope dalam form handling, wizard, persistence boundary, authorization, security, error handling, layout, dan caching.
11. Production diagnosis untuk session bloat, stale data, dan cross-user data leak.
12. Case study regulatory case detail page.

---

## 32. Status Seri

Seri **belum selesai**.

Bagian yang sudah selesai:

1. `00-orientation-server-side-ui-mental-model.md`
2. `01-history-compatibility-java8-to-java25.md`
3. `02-jakarta-pages-jsp-internal-architecture.md`
4. `03-jsp-syntax-directives-scriptlets-actions.md`
5. `04-request-session-application-scope-view-data-flow.md`

Bagian berikutnya:

```text
05-expression-language-fundamentals-value-method-resolver-chain.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./03-jsp-syntax-directives-scriptlets-actions.md">⬅️ Part 3 — JSP Syntax Deep Dive: Directives, Declarations, Scriptlets, Expressions, Actions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./05-expression-language-fundamentals-value-method-resolver-chain.md">Part 5 — Expression Language Fundamentals: Value Expressions, Method Expressions, Resolver Chain ➡️</a>
</div>
