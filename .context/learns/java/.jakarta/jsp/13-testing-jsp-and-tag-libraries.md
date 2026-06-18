# Part 13 — Testing JSP and Tag Libraries

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `13-testing-jsp-and-tag-libraries.md`  
> Scope: Java 8–25, Java EE/Jakarta EE era, JSP/Jakarta Pages, EL, JSTL/Jakarta Tags, custom tags, tag files  
> Fokus: membuat layer server-side view yang historisnya sulit dites menjadi punya kontrak, observability, regression guard, dan security confidence.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami kenapa JSP/tag testing sulit secara inheren.
2. Memisahkan hal yang harus dites di controller, service, view model, tag handler, dan rendered HTML.
3. Membuat kontrak antara controller dan JSP agar view tidak menjadi black box.
4. Mengetes custom tag handler tanpa harus selalu menjalankan full browser test.
5. Mengetes tag files dan JSP rendering dengan embedded/integration container.
6. Menggunakan HTML parser untuk assertion yang stabil, bukan string comparison rapuh.
7. Membuat regression test untuk legacy JSP sebelum refactor.
8. Membuat security-oriented rendering tests untuk XSS, CSRF, authorization visibility, hidden fields, dan cache headers.
9. Menentukan kapan cukup unit test, kapan perlu integration test, dan kapan perlu end-to-end/browser test.
10. Mendesain JSP/tag library baru agar testable sejak awal.

---

## 2. Mental Model: Apa yang Sebenarnya Dites?

JSP bukan hanya file teks. Dalam runtime, JSP adalah:

```text
.jsp source
  -> translation
  -> generated servlet source
  -> compiled servlet class
  -> request-time execution
  -> output HTML/text
```

Tag library juga bukan sekadar markup. Ia bisa berupa:

```text
<tag prefix:name ...>
  -> TLD metadata
  -> tag handler class / tag file
  -> attribute evaluation
  -> body invocation
  -> JspWriter output
```

Maka testing JSP/tag perlu dipikirkan dalam beberapa level:

```text
Business/service logic test
  memastikan keputusan domain benar

Controller/request handler test
  memastikan request diproses dan view model disiapkan

View model contract test
  memastikan JSP menerima data yang tepat, sederhana, dan display-ready

Tag handler unit test
  memastikan reusable tag menghasilkan output/side effect benar

JSP rendering integration test
  memastikan JSP benar-benar bisa dikompilasi dan dirender

HTML assertion test
  memastikan output punya struktur, escaping, form token, link, pesan, dan attribute yang tepat

Browser/E2E test
  memastikan perilaku aktual di browser berjalan
```

Kesalahan umum adalah menganggap “testing JSP” berarti hanya membuka browser dan klik manual. Itu terlambat, mahal, lambat, dan tidak cukup granular.

---

## 3. Kenapa JSP Testing Sulit?

JSP sulit dites karena beberapa hal.

### 3.1 JSP Bergantung pada Container

JSP butuh komponen runtime seperti:

- `ServletContext`
- `HttpServletRequest`
- `HttpServletResponse`
- `HttpSession`
- `PageContext`
- `JspWriter`
- tag library resolver
- EL resolver
- generated servlet compiler

Di kode Java biasa, kamu bisa membuat object dan memanggil method. Di JSP, banyak hal terjadi lewat container.

### 3.2 JSP Menggabungkan Banyak Concern

JSP legacy sering mencampur:

- render HTML,
- conditional logic,
- session access,
- authorization check,
- data formatting,
- URL construction,
- error handling,
- bahkan query/database call.

Semakin banyak concern di JSP, semakin sulit testing-nya.

### 3.3 Output HTML Rawan Berubah

HTML punya banyak variasi yang secara visual sama tetapi string berbeda:

```html
<input type="text" name="caseId" value="A123">
```

vs

```html
<input value="A123" name="caseId" type="text">
```

String comparison penuh akan gagal padahal HTML-nya ekuivalen.

### 3.4 Rendering Bisa Punya Side Effect

Custom tag yang buruk bisa:

- membaca session,
- memanggil service,
- query database,
- mutate request attribute,
- membuka resource,
- mengubah response header.

Jika rendering punya side effect berat, test menjadi lambat dan tidak deterministic.

### 3.5 JSP Error Sering Muncul Saat Runtime

Beberapa error hanya muncul ketika JSP diterjemahkan/dikompilasi:

- salah taglib URI,
- missing TLD,
- invalid tag attribute,
- class not found,
- method/property tidak ditemukan,
- duplicate local variable dari scriptlet,
- invalid generated servlet.

Karena itu, minimal harus ada test yang memastikan JSP bisa dikompilasi dan dirender.

---

## 4. Prinsip Utama: Jangan Tes View yang Terlalu Pintar

View yang baik lebih mudah dites karena ia bodoh secara sengaja.

### 4.1 View Harus Menerima View Model

Controller/service menyiapkan object yang sudah cocok untuk rendering.

Contoh buruk:

```jsp
<c:forEach var="case" items="${cases}">
  <c:if test="${case.status.code == 'PENDING_REVIEW' and case.assignee.department.code == currentUser.department.code}">
    ...
  </c:if>
</c:forEach>
```

Masalah:

- JSP tahu struktur domain terlalu dalam.
- JSP tahu aturan department.
- JSP tahu kode status.
- JSP bisa trigger lazy loading.
- Sulit dites.

Lebih baik:

```java
public final class CaseRowView {
    private final String caseId;
    private final String applicantName;
    private final String statusLabel;
    private final boolean reviewActionVisible;
    private final String detailUrl;

    // constructor + getters
}
```

JSP:

```jsp
<c:forEach var="row" items="${caseList.rows}">
  <tr>
    <td><c:out value="${row.caseId}" /></td>
    <td><c:out value="${row.applicantName}" /></td>
    <td><c:out value="${row.statusLabel}" /></td>
    <td>
      <c:if test="${row.reviewActionVisible}">
        <a href="${row.detailUrl}">Review</a>
      </c:if>
    </td>
  </tr>
</c:forEach>
```

Yang dites:

```text
CaseListViewFactoryTest
  memastikan reviewActionVisible benar untuk variasi role/status/department

JSP rendering test
  memastikan jika reviewActionVisible=true link muncul
  memastikan jika false link tidak muncul
```

JSP tidak perlu mengetes ulang seluruh business rule.

---

## 5. Testing Pyramid untuk JSP/Tags

Untuk server-side UI, pyramid yang sehat kira-kira seperti ini:

```text
Few browser E2E tests
  login, navigation, major workflow, JS integration

Some JSP rendering integration tests
  compile/render page penting, form, security token, localized page

More tag handler/tag file tests
  reusable component output, escaping, attributes, body handling

Many view model/controller tests
  request -> model -> view name, state, errors, permissions

Many service/domain tests
  actual business behavior
```

Jangan membuat semua test sebagai browser E2E. Itu lambat dan rapuh.

Jangan juga hanya punya unit test service, karena JSP bisa gagal compile di production.

---

## 6. Apa yang Sebaiknya Tidak Dites di JSP?

Hindari mengetes ini di JSP:

1. Business rule kompleks.
2. SQL/query correctness.
3. Authorization enforcement.
4. Workflow transition legality.
5. Persistence behavior.
6. External service behavior.
7. Complex sorting/filtering/pagination algorithm.

Hal-hal itu harus dites di layer masing-masing.

JSP cukup dites untuk:

1. Data yang diberi controller ditampilkan benar.
2. Escaping benar.
3. Form field benar.
4. Error message muncul.
5. Conditional UI visibility benar berdasarkan view model.
6. URL/action target benar.
7. CSRF token ada.
8. HTML struktur dasar valid.
9. Tag reusable menghasilkan output sesuai kontrak.
10. JSP bisa dikompilasi dan dirender.

---

## 7. Kontrak Controller ke JSP

Kontrak controller ke JSP adalah daftar attribute yang harus tersedia agar JSP bisa render.

Contoh controller:

```java
@WebServlet("/cases")
public class CaseListServlet extends HttpServlet {

    private final CaseListUseCase useCase;
    private final CaseListViewFactory viewFactory;

    public CaseListServlet(CaseListUseCase useCase, CaseListViewFactory viewFactory) {
        this.useCase = useCase;
        this.viewFactory = viewFactory;
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        UserContext user = UserContext.from(request);
        CaseSearchResult result = useCase.search(user);
        CaseListView view = viewFactory.toView(user, result);

        request.setAttribute("caseList", view);
        request.getRequestDispatcher("/WEB-INF/views/cases/list.jsp")
               .forward(request, response);
    }
}
```

Kontrak JSP:

```text
Attribute name: caseList
Type: CaseListView
Required: yes
Fields used:
  - title
  - rows
  - empty
  - canCreateCase
  - createUrl
  - pagination
```

Test kontrak:

```java
class CaseListServletTest {

    @Test
    void doGet_setsCaseListViewAndForwardsToJsp() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/cases");
        MockHttpServletResponse response = new MockHttpServletResponse();

        RecordingRequestDispatcher dispatcher = new RecordingRequestDispatcher();
        request.setRequestDispatcher("/WEB-INF/views/cases/list.jsp", dispatcher);

        CaseListUseCase useCase = user -> CaseSearchResult.empty();
        CaseListViewFactory factory = (user, result) -> CaseListView.empty("Cases");

        CaseListServlet servlet = new CaseListServlet(useCase, factory);
        servlet.doGet(request, response);

        assertNotNull(request.getAttribute("caseList"));
        assertEquals("/WEB-INF/views/cases/list.jsp", dispatcher.forwardedPath());
    }
}
```

Di real project, `MockHttpServletRequest` bisa berasal dari framework test seperti Spring test support jika stack-mu Spring, atau custom mock minimal jika pure servlet.

---

## 8. View Model Test

View model adalah tempat paling ideal untuk logic yang memengaruhi tampilan.

Contoh domain:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    PENDING_REVIEW,
    APPROVED,
    REJECTED
}
```

View row:

```java
public final class CaseRowView {
    private final String caseId;
    private final String statusLabel;
    private final boolean reviewActionVisible;
    private final String cssClass;

    public CaseRowView(String caseId, String statusLabel, boolean reviewActionVisible, String cssClass) {
        this.caseId = caseId;
        this.statusLabel = statusLabel;
        this.reviewActionVisible = reviewActionVisible;
        this.cssClass = cssClass;
    }

    public String getCaseId() { return caseId; }
    public String getStatusLabel() { return statusLabel; }
    public boolean isReviewActionVisible() { return reviewActionVisible; }
    public String getCssClass() { return cssClass; }
}
```

Factory:

```java
public final class CaseRowViewFactory {

    public CaseRowView toRow(UserContext user, CaseSummary caseSummary) {
        boolean canReview = user.hasRole("CASE_REVIEWER")
                && caseSummary.getStatus() == CaseStatus.PENDING_REVIEW;

        String label = switch (caseSummary.getStatus()) {
            case DRAFT -> "Draft";
            case SUBMITTED -> "Submitted";
            case PENDING_REVIEW -> "Pending Review";
            case APPROVED -> "Approved";
            case REJECTED -> "Rejected";
        };

        String css = switch (caseSummary.getStatus()) {
            case APPROVED -> "status-success";
            case REJECTED -> "status-danger";
            default -> "status-neutral";
        };

        return new CaseRowView(caseSummary.getCaseId(), label, canReview, css);
    }
}
```

Test:

```java
class CaseRowViewFactoryTest {

    private final CaseRowViewFactory factory = new CaseRowViewFactory();

    @Test
    void reviewerCanSeeReviewActionForPendingReviewCase() {
        UserContext user = UserContext.withRoles("CASE_REVIEWER");
        CaseSummary c = new CaseSummary("CASE-001", CaseStatus.PENDING_REVIEW);

        CaseRowView row = factory.toRow(user, c);

        assertTrue(row.isReviewActionVisible());
        assertEquals("Pending Review", row.getStatusLabel());
    }

    @Test
    void reviewerCannotSeeReviewActionForApprovedCase() {
        UserContext user = UserContext.withRoles("CASE_REVIEWER");
        CaseSummary c = new CaseSummary("CASE-002", CaseStatus.APPROVED);

        CaseRowView row = factory.toRow(user, c);

        assertFalse(row.isReviewActionVisible());
        assertEquals("Approved", row.getStatusLabel());
    }
}
```

Kelebihannya:

- cepat,
- tidak butuh container,
- deterministic,
- mudah coverage variasi business/display rule,
- JSP menjadi lebih sederhana.

---

## 9. Testing Rendered HTML dengan Parser, Bukan String Mentah

Untuk HTML output, jangan bandingkan seluruh string kecuali untuk snapshot/golden master yang memang disengaja.

Gunakan HTML parser seperti jsoup.

Contoh output:

```html
<table id="case-table">
  <tbody>
    <tr data-case-id="CASE-001">
      <td class="case-id">CASE-001</td>
      <td class="status">Pending Review</td>
      <td class="actions"><a href="/cases/CASE-001/review">Review</a></td>
    </tr>
  </tbody>
</table>
```

Test dengan jsoup:

```java
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CaseListHtmlTest {

    @Test
    void renderedHtml_containsCaseRowAndReviewLink() {
        String html = """
            <table id="case-table">
              <tbody>
                <tr data-case-id="CASE-001">
                  <td class="case-id">CASE-001</td>
                  <td class="status">Pending Review</td>
                  <td class="actions"><a href="/cases/CASE-001/review">Review</a></td>
                </tr>
              </tbody>
            </table>
            """;

        Document doc = Jsoup.parse(html);

        Element row = doc.selectFirst("tr[data-case-id=CASE-001]");
        assertNotNull(row);
        assertEquals("CASE-001", row.selectFirst("td.case-id").text());
        assertEquals("Pending Review", row.selectFirst("td.status").text());
        assertEquals("/cases/CASE-001/review", row.selectFirst("td.actions a").attr("href"));
    }
}
```

Kenapa ini lebih baik:

- tidak peduli whitespace,
- tidak peduli urutan attribute,
- bisa assert by selector,
- lebih dekat dengan cara browser melihat DOM.

---

## 10. Testing Escaping dan XSS Regression

View rendering harus dites terhadap malicious input.

View model:

```java
CaseRowView row = new CaseRowView(
    "CASE-001",
    "<script>alert('xss')</script>",
    false,
    "status-neutral"
);
```

JSP:

```jsp
<td class="applicant-name"><c:out value="${row.applicantName}" /></td>
```

Expected rendered HTML:

```html
<td class="applicant-name">&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</td>
```

Test:

```java
@Test
void applicantName_isEscapedAndNotRenderedAsScript() {
    String html = renderCaseListWithApplicantName("<script>alert('xss')</script>");

    Document doc = Jsoup.parse(html);

    assertEquals(0, doc.select("script").size());
    assertEquals("<script>alert('xss')</script>", doc.selectFirst(".applicant-name").text());
    assertTrue(html.contains("&lt;script&gt;"));
}
```

Perhatikan dua hal:

1. `.text()` mengembalikan text decoded.
2. Raw HTML string tetap harus mengandung escaped form.

Untuk attribute context:

```jsp
<input type="text" name="applicantName" value="${row.applicantName}">
```

Ini rawan jika tidak memakai escaping yang sesuai. Lebih aman gunakan tag/form helper yang selalu encode attribute.

Test malicious attribute:

```java
@Test
void inputValue_doesNotAllowAttributeBreakout() {
    String html = renderInputValue("x\" autofocus onfocus=alert(1) data-x=\"");

    Document doc = Jsoup.parse(html);
    Element input = doc.selectFirst("input[name=applicantName]");

    assertNotNull(input);
    assertEquals("x\" autofocus onfocus=alert(1) data-x=\"", input.attr("value"));
    assertFalse(input.hasAttr("onfocus"));
    assertFalse(input.hasAttr("autofocus"));
}
```

Ini jenis test yang sering menangkap bug nyata.

---

## 11. Testing CSRF Token Rendering

JSP form yang melakukan state-changing action harus punya CSRF token.

JSP:

```jsp
<form method="post" action="${caseList.bulkAssignUrl}">
  <input type="hidden" name="_csrf" value="${csrfToken}" />
  ...
</form>
```

Test:

```java
@Test
void postForm_containsCsrfToken() {
    String html = renderCaseListPageWithCsrf("abc123");

    Document doc = Jsoup.parse(html);
    Element form = doc.selectFirst("form[method=post]");

    assertNotNull(form);
    Element token = form.selectFirst("input[type=hidden][name=_csrf]");

    assertNotNull(token);
    assertEquals("abc123", token.attr("value"));
}
```

Test negatif:

```java
@Test
void everyPostForm_containsCsrfToken() {
    Document doc = Jsoup.parse(renderPage());

    for (Element form : doc.select("form")) {
        String method = form.attr("method");
        if ("post".equalsIgnoreCase(method)) {
            assertNotNull(
                form.selectFirst("input[type=hidden][name=_csrf]"),
                "POST form missing CSRF token: " + form.attr("action")
            );
        }
    }
}
```

Ini bisa menjadi shared assertion untuk semua rendered page.

---

## 12. Testing Authorization Visibility

Misalnya UI action hanya muncul untuk reviewer.

JSP:

```jsp
<c:if test="${row.reviewActionVisible}">
  <a class="action-review" href="${row.reviewUrl}">Review</a>
</c:if>
```

Test:

```java
@Test
void reviewActionVisible_whenViewModelAllowsIt() {
    String html = renderRow(new CaseRowView("CASE-001", "Pending Review", true, "/cases/CASE-001/review"));

    Document doc = Jsoup.parse(html);

    assertEquals(1, doc.select("a.action-review").size());
}

@Test
void reviewActionHidden_whenViewModelDoesNotAllowIt() {
    String html = renderRow(new CaseRowView("CASE-001", "Pending Review", false, null));

    Document doc = Jsoup.parse(html);

    assertEquals(0, doc.select("a.action-review").size());
}
```

Tapi ini hanya visibility test.

Enforcement tetap harus dites di controller/service/action endpoint:

```java
@Test
void reviewEndpointRejectsUnauthorizedUserEvenIfUrlIsCalledDirectly() {
    UserContext user = UserContext.withRoles("VIEWER");

    assertThrows(AccessDeniedException.class, () -> {
        reviewUseCase.review(user, "CASE-001");
    });
}
```

Rule penting:

```text
JSP test membuktikan tombol/link tidak ditampilkan.
Authorization test membuktikan aksi tidak bisa dijalankan.
Keduanya berbeda.
```

---

## 13. Testing Hidden Fields

Hidden field sering disalahgunakan.

Contoh:

```jsp
<input type="hidden" name="caseId" value="${case.id}" />
<input type="hidden" name="version" value="${case.version}" />
```

Yang boleh:

- identifier non-secret,
- optimistic lock version,
- nonce/token,
- form step id.

Yang tidak boleh:

- role,
- approval decision final,
- price/amount authoritative,
- permission flag,
- sensitive PII,
- server-side truth.

Test untuk memastikan tidak ada sensitive hidden field:

```java
@Test
void hiddenFields_doNotExposeSensitiveData() {
    Document doc = Jsoup.parse(renderPage());

    for (Element input : doc.select("input[type=hidden]")) {
        String name = input.attr("name").toLowerCase(Locale.ROOT);

        assertFalse(name.contains("password"));
        assertFalse(name.contains("nric"));
        assertFalse(name.contains("ssn"));
        assertFalse(name.contains("role"));
        assertFalse(name.contains("permission"));
    }
}
```

Test ini bukan pengganti review, tetapi berguna sebagai guardrail.

---

## 14. Testing Form Binding

Form rendering test memastikan field name sesuai contract endpoint.

Contoh JSP:

```jsp
<form method="post" action="${form.submitUrl}">
  <input type="hidden" name="_csrf" value="${csrfToken}" />

  <label for="remarks">Remarks</label>
  <textarea id="remarks" name="remarks"><c:out value="${form.remarks}" /></textarea>

  <button type="submit" name="action" value="approve">Approve</button>
  <button type="submit" name="action" value="reject">Reject</button>
</form>
```

Test:

```java
@Test
void approvalForm_containsExpectedFieldsAndActions() {
    Document doc = Jsoup.parse(renderApprovalForm());

    Element form = doc.selectFirst("form[method=post]");
    assertNotNull(form);

    assertNotNull(form.selectFirst("textarea[name=remarks]");
    assertNotNull(form.selectFirst("button[name=action][value=approve]"));
    assertNotNull(form.selectFirst("button[name=action][value=reject]"));
}
```

Yang ditangkap oleh test ini:

- field rename tidak sengaja,
- action button hilang,
- wrong method,
- wrong form target,
- missing CSRF.

---

## 15. Testing Error Message Rendering

Error rendering penting untuk usability dan compliance.

View model:

```java
public final class FormErrorView {
    private final String field;
    private final String message;

    // constructor + getters
}
```

JSP:

```jsp
<c:if test="${not empty form.errors}">
  <div class="error-summary" role="alert">
    <h2>Please correct the following errors</h2>
    <ul>
      <c:forEach var="error" items="${form.errors}">
        <li><a href="#${error.field}"><c:out value="${error.message}" /></a></li>
      </c:forEach>
    </ul>
  </div>
</c:if>
```

Test:

```java
@Test
void validationErrors_areRenderedInErrorSummary() {
    String html = renderFormWithErrors(List.of(
        new FormErrorView("remarks", "Remarks is required")
    ));

    Document doc = Jsoup.parse(html);

    Element summary = doc.selectFirst(".error-summary[role=alert]");
    assertNotNull(summary);
    assertEquals("Remarks is required", summary.selectFirst("li").text());
    assertEquals("#remarks", summary.selectFirst("a").attr("href"));
}
```

Tambahkan test escaping:

```java
@Test
void validationErrorMessage_isEscaped() {
    String html = renderFormWithErrors(List.of(
        new FormErrorView("remarks", "<img src=x onerror=alert(1)>")
    ));

    Document doc = Jsoup.parse(html);

    assertEquals(0, doc.select("img").size());
    assertTrue(html.contains("&lt;img"));
}
```

---

## 16. Unit Testing Custom Tag Handler

Custom tag handler bisa dites tanpa full JSP jika dirancang baik.

Contoh tag handler sederhana:

```java
public class BadgeTag extends SimpleTagSupport {

    private String type;
    private String label;

    public void setType(String type) {
        this.type = type;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();

        String safeType = normalizeType(type);
        String escapedLabel = escapeHtml(label);

        out.write("<span class=\"badge badge-");
        out.write(safeType);
        out.write("\">");
        out.write(escapedLabel);
        out.write("</span>");
    }

    private String normalizeType(String type) {
        if (type == null) return "neutral";
        return switch (type) {
            case "success", "warning", "danger", "neutral" -> type;
            default -> "neutral";
        };
    }

    private String escapeHtml(String input) {
        if (input == null) return "";
        return input
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
```

Untuk unit test, kita butuh fake `JspContext` dan `JspWriter`.

Minimal fake writer:

```java
public final class StringJspWriter extends JspWriter {

    private final StringWriter delegate = new StringWriter();

    public StringJspWriter() {
        super(1024, true);
    }

    @Override public void write(char[] cbuf, int off, int len) { delegate.write(cbuf, off, len); }
    @Override public void flush() {}
    @Override public void close() {}
    @Override public void newLine() { delegate.write(System.lineSeparator()); }
    @Override public void print(boolean b) { delegate.write(String.valueOf(b)); }
    @Override public void print(char c) { delegate.write(String.valueOf(c)); }
    @Override public void print(int i) { delegate.write(String.valueOf(i)); }
    @Override public void print(long l) { delegate.write(String.valueOf(l)); }
    @Override public void print(float f) { delegate.write(String.valueOf(f)); }
    @Override public void print(double d) { delegate.write(String.valueOf(d)); }
    @Override public void print(char[] s) { delegate.write(s); }
    @Override public void print(String s) { delegate.write(s == null ? "null" : s); }
    @Override public void print(Object obj) { delegate.write(String.valueOf(obj)); }
    @Override public void println() { newLine(); }
    @Override public void println(boolean x) { print(x); newLine(); }
    @Override public void println(char x) { print(x); newLine(); }
    @Override public void println(int x) { print(x); newLine(); }
    @Override public void println(long x) { print(x); newLine(); }
    @Override public void println(float x) { print(x); newLine(); }
    @Override public void println(double x) { print(x); newLine(); }
    @Override public void println(char[] x) { print(x); newLine(); }
    @Override public void println(String x) { print(x); newLine(); }
    @Override public void println(Object x) { print(x); newLine(); }
    @Override public void clear() { delegate.getBuffer().setLength(0); }
    @Override public void clearBuffer() { clear(); }
    @Override public int getRemaining() { return 1024; }

    public String content() {
        return delegate.toString();
    }
}
```

Minimal fake context:

```java
public final class SimpleJspContextStub extends JspContext {

    private final StringJspWriter writer = new StringJspWriter();
    private final Map<String, Object> attributes = new HashMap<>();

    @Override public JspWriter getOut() { return writer; }

    @Override public void setAttribute(String name, Object value) { attributes.put(name, value); }
    @Override public Object getAttribute(String name) { return attributes.get(name); }
    @Override public void removeAttribute(String name) { attributes.remove(name); }

    @Override public void setAttribute(String name, Object value, int scope) { attributes.put(name, value); }
    @Override public Object getAttribute(String name, int scope) { return attributes.get(name); }
    @Override public Object findAttribute(String name) { return attributes.get(name); }
    @Override public void removeAttribute(String name, int scope) { attributes.remove(name); }
    @Override public int getAttributesScope(String name) { return attributes.containsKey(name) ? PAGE_SCOPE : 0; }
    @Override public Enumeration<String> getAttributeNamesInScope(int scope) { return Collections.enumeration(attributes.keySet()); }

    @Override public ELContext getELContext() { throw new UnsupportedOperationException(); }
    @Override public ExpressionEvaluator getExpressionEvaluator() { throw new UnsupportedOperationException(); }
    @Override public VariableResolver getVariableResolver() { throw new UnsupportedOperationException(); }

    public String output() {
        return writer.content();
    }
}
```

Test:

```java
class BadgeTagTest {

    @Test
    void rendersBadgeWithAllowedType() throws Exception {
        BadgeTag tag = new BadgeTag();
        SimpleJspContextStub context = new SimpleJspContextStub();
        tag.setJspContext(context);
        tag.setType("success");
        tag.setLabel("Approved");

        tag.doTag();

        assertEquals("<span class=\"badge badge-success\">Approved</span>", context.output());
    }

    @Test
    void escapesLabel() throws Exception {
        BadgeTag tag = new BadgeTag();
        SimpleJspContextStub context = new SimpleJspContextStub();
        tag.setJspContext(context);
        tag.setType("danger");
        tag.setLabel("<script>alert(1)</script>");

        tag.doTag();

        assertFalse(context.output().contains("<script>"));
        assertTrue(context.output().contains("&lt;script&gt;"));
    }

    @Test
    void normalizesUnknownType() throws Exception {
        BadgeTag tag = new BadgeTag();
        SimpleJspContextStub context = new SimpleJspContextStub();
        tag.setJspContext(context);
        tag.setType("evil\" onclick=\"alert(1)");
        tag.setLabel("Text");

        tag.doTag();

        assertTrue(context.output().contains("badge-neutral"));
        assertFalse(context.output().contains("onclick"));
    }
}
```

Catatan desain: semakin banyak `PageContext`, `ServletContext`, session, dan request yang disentuh tag, semakin susah unit test-nya.

---

## 17. Membuat Custom Tag Lebih Testable dengan Renderer Class

Daripada semua logic ada di `doTag()`, ekstrak renderer murni.

```java
public final class BadgeRenderer {

    public String render(String type, String label) {
        String safeType = normalizeType(type);
        return "<span class=\"badge badge-" + safeType + "\">"
                + escapeHtml(label)
                + "</span>";
    }

    private String normalizeType(String type) {
        if (type == null) return "neutral";
        return switch (type) {
            case "success", "warning", "danger", "neutral" -> type;
            default -> "neutral";
        };
    }

    private String escapeHtml(String input) {
        if (input == null) return "";
        return input
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
```

Tag handler:

```java
public class BadgeTag extends SimpleTagSupport {

    private final BadgeRenderer renderer = new BadgeRenderer();
    private String type;
    private String label;

    public void setType(String type) { this.type = type; }
    public void setLabel(String label) { this.label = label; }

    @Override
    public void doTag() throws JspException, IOException {
        getJspContext().getOut().write(renderer.render(type, label));
    }
}
```

Renderer test jauh lebih ringan:

```java
class BadgeRendererTest {

    private final BadgeRenderer renderer = new BadgeRenderer();

    @Test
    void rendersEscapedBadge() {
        String html = renderer.render("success", "<Approved>");

        assertEquals("<span class=\"badge badge-success\">&lt;Approved&gt;</span>", html);
    }
}
```

Tag handler test cukup satu atau dua test untuk memastikan wiring ke `JspWriter` benar.

Ini prinsip penting:

```text
Tag handler = adapter ke JSP runtime.
Renderer/helper = pure logic yang mudah dites.
```

---

## 18. Testing Body Content di Custom Tag

Custom tag bisa menerima body.

Contoh tag:

```jsp
<app:panel title="Case Details">
  <p>Body content</p>
</app:panel>
```

Tag handler:

```java
public class PanelTag extends SimpleTagSupport {

    private String title;

    public void setTitle(String title) {
        this.title = title;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();
        out.write("<section class=\"panel\">");
        out.write("<h2>");
        out.write(escapeHtml(title));
        out.write("</h2>");
        out.write("<div class=\"panel-body\">");

        JspFragment body = getJspBody();
        if (body != null) {
            body.invoke(out);
        }

        out.write("</div></section>");
    }
}
```

Fake body:

```java
public final class StaticJspFragment extends JspFragment {

    private final JspContext context;
    private final String body;

    public StaticJspFragment(JspContext context, String body) {
        this.context = context;
        this.body = body;
    }

    @Override
    public JspContext getJspContext() {
        return context;
    }

    @Override
    public void invoke(Writer out) throws JspException, IOException {
        out.write(body);
    }
}
```

Test:

```java
@Test
void panelRendersTitleAndBody() throws Exception {
    SimpleJspContextStub context = new SimpleJspContextStub();

    PanelTag tag = new PanelTag();
    tag.setJspContext(context);
    tag.setTitle("Case Details");
    tag.setJspBody(new StaticJspFragment(context, "<p>Body content</p>"));

    tag.doTag();

    Document doc = Jsoup.parse(context.output());
    assertEquals("Case Details", doc.selectFirst("section.panel h2").text());
    assertEquals("Body content", doc.selectFirst("section.panel .panel-body p").text());
}
```

---

## 19. Testing Dynamic Attributes

Dynamic attributes memungkinkan tag menerima attribute arbitrary.

Contoh:

```jsp
<app:button type="submit" class="primary" data-action="approve">Approve</app:button>
```

Handler:

```java
public class ButtonTag extends SimpleTagSupport implements DynamicAttributes {

    private final Map<String, Object> dynamicAttributes = new LinkedHashMap<>();
    private String type = "button";

    public void setType(String type) {
        this.type = type;
    }

    @Override
    public void setDynamicAttribute(String uri, String localName, Object value) {
        dynamicAttributes.put(localName, value);
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();
        out.write("<button type=\"");
        out.write(escapeHtmlAttribute(normalizeButtonType(type)));
        out.write("\"");

        for (Map.Entry<String, Object> entry : dynamicAttributes.entrySet()) {
            String name = entry.getKey();
            if (!isAllowedAttributeName(name)) continue;

            out.write(" ");
            out.write(name);
            out.write("=\"");
            out.write(escapeHtmlAttribute(String.valueOf(entry.getValue())));
            out.write("\"");
        }

        out.write(">");
        if (getJspBody() != null) {
            getJspBody().invoke(out);
        }
        out.write("</button>");
    }
}
```

Test security:

```java
@Test
void dynamicAttributes_doNotAllowEventHandlers() throws Exception {
    ButtonTag tag = new ButtonTag();
    SimpleJspContextStub context = new SimpleJspContextStub();
    tag.setJspContext(context);
    tag.setType("submit");
    tag.setDynamicAttribute(null, "onclick", "alert(1)");
    tag.setDynamicAttribute(null, "data-action", "approve");
    tag.setJspBody(new StaticJspFragment(context, "Approve"));

    tag.doTag();

    Document doc = Jsoup.parse(context.output());
    Element button = doc.selectFirst("button");

    assertNotNull(button);
    assertFalse(button.hasAttr("onclick"));
    assertEquals("approve", button.attr("data-action"));
}
```

Dynamic attributes harus punya allowlist. Kalau semua attribute dilewatkan mentah, custom tag bisa menjadi XSS gateway.

---

## 20. Testing Tag Files

Tag file biasanya berada di:

```text
/WEB-INF/tags/panel.tag
/WEB-INF/tags/form/inputText.tag
```

Contoh `panel.tag`:

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="title" required="true" rtexprvalue="true" %>

<section class="panel">
  <h2><c:out value="${title}" /></h2>
  <div class="panel-body">
    <jsp:doBody />
  </div>
</section>
```

Tag file lebih sulit di-unit-test langsung karena diterjemahkan oleh JSP engine.

Strategi test:

1. Integration render test lewat JSP kecil yang memakai tag file.
2. Test output dengan jsoup.
3. Pindahkan logic kompleks ke Java helper/renderer yang punya unit test.

Test fixture JSP:

```jsp
<%@ taglib prefix="app" tagdir="/WEB-INF/tags" %>
<app:panel title="Case Details">
  <p id="body-text">Hello</p>
</app:panel>
```

Integration test:

```java
@Test
void panelTagFile_rendersTitleAndBody() {
    String html = httpGet("/test-fixtures/panel-tag-test.jsp");

    Document doc = Jsoup.parse(html);

    assertEquals("Case Details", doc.selectFirst("section.panel h2").text());
    assertEquals("Hello", doc.selectFirst("#body-text").text());
}
```

Test fixture JSP harus tidak ikut exposed di production. Bisa ditempatkan di test webapp resources atau hanya aktif di test profile.

---

## 21. JSP Compilation Test

Salah satu test paling bernilai untuk JSP legacy adalah memastikan semua JSP bisa dikompilasi.

Targetnya bukan assert output detail, tetapi menangkap:

- syntax error,
- taglib missing,
- invalid directive,
- invalid attribute,
- generated servlet compile error,
- missing class/import,
- incompatible `javax`/`jakarta` class.

Ada beberapa pendekatan:

### 21.1 Build-Time Precompilation

Beberapa container/build plugin bisa melakukan JSP precompilation. Dalam pipeline, test gagal jika JSP tidak compile.

Nilainya tinggi untuk legacy app besar.

### 21.2 Smoke Render Test

Buat daftar JSP utama dan render dengan minimal request model.

```java
@ParameterizedTest
@ValueSource(strings = {
    "/WEB-INF/views/cases/list.jsp",
    "/WEB-INF/views/cases/detail.jsp",
    "/WEB-INF/views/login.jsp",
    "/WEB-INF/views/error/500.jsp"
})
void jspCompilesAndRenders(String jspPath) {
    RenderResult result = jspRenderer.render(jspPath, minimalModelFor(jspPath));

    assertEquals(200, result.status());
    assertFalse(result.body().contains("JasperException"));
}
```

Kelemahannya: butuh infrastructure renderer/container.

### 21.3 Container Integration Test

Start embedded Tomcat/Jetty/Open Liberty test instance, deploy test WAR, hit endpoint yang forward ke JSP.

```text
Test JVM
  -> start embedded container
  -> deploy webapp
  -> HTTP GET /cases
  -> controller sets model
  -> RequestDispatcher.forward JSP
  -> JSP compiles/renders
  -> assert response
```

Ini lebih realistis daripada mencoba instantiate generated servlet sendiri.

---

## 22. Golden Master Test untuk Legacy JSP

Legacy JSP sering terlalu rumit untuk langsung direfactor. Golden master membantu mengunci behavior sebelum perubahan.

Langkah:

1. Pilih JSP legacy penting.
2. Buat fixture request/session/model yang representative.
3. Render output saat baseline dianggap benar.
4. Simpan normalized HTML sebagai snapshot.
5. Saat refactor, compare output penting.

Normalisasi perlu agar tidak rapuh:

- trim whitespace,
- sort attributes jika perlu,
- remove generated id/timestamp,
- canonicalize URL session id,
- mask CSRF/random token.

Contoh normalizer:

```java
public final class HtmlSnapshotNormalizer {

    public String normalize(String html) {
        Document doc = Jsoup.parse(html);

        // remove volatile CSRF value but keep field existence
        for (Element input : doc.select("input[name=_csrf]")) {
            input.attr("value", "__TOKEN__");
        }

        // remove generated timestamp
        for (Element e : doc.select("[data-generated-at]")) {
            e.attr("data-generated-at", "__TIMESTAMP__");
        }

        doc.outputSettings().prettyPrint(true);
        return doc.body().html().trim();
    }
}
```

Golden master cocok untuk:

- refactoring scriptlet ke JSTL,
- mengganti custom tag implementation,
- migrasi `javax` ke `jakarta`,
- layout restructuring,
- security encoding hardening.

Tapi jangan jadikan golden master sebagai satu-satunya test, karena ia cenderung mengunci output buruk juga.

---

## 23. Snapshot Test: Kapan Berguna dan Kapan Berbahaya

Snapshot/golden master berguna saat:

- legacy behavior belum sepenuhnya dipahami,
- output kompleks,
- refactor besar,
- risiko regression tinggi.

Berbahaya saat:

- developer asal accept snapshot baru,
- snapshot terlalu besar,
- tidak jelas behavior mana yang penting,
- banyak volatile data,
- test menjadi noise.

Rule praktis:

```text
Snapshot test untuk menjaga baseline.
Selector-based assertion untuk menjelaskan intent.
```

Contoh kombinasi:

```java
@Test
void caseDetail_matchesApprovedSnapshot() {
    String html = renderCaseDetail(caseFixture());
    assertEquals(loadSnapshot("case-detail-approved.html"), normalizer.normalize(html));
}

@Test
void caseDetail_containsAuditTrailLink() {
    Document doc = Jsoup.parse(renderCaseDetail(caseFixture()));
    assertEquals("Audit Trail", doc.selectFirst("a.audit-link").text());
}
```

---

## 24. Integration Testing dengan RequestDispatcher

Servlet API menyediakan `RequestDispatcher` untuk forward/include resource seperti servlet, JSP, atau HTML. Dalam testing controller, kamu tidak perlu benar-benar render JSP untuk memastikan forward path benar.

Mock dispatcher:

```java
public final class RecordingRequestDispatcher implements RequestDispatcher {

    private String forwardedPath;
    private String includedPath;

    @Override
    public void forward(ServletRequest request, ServletResponse response) {
        this.forwardedPath = (String) request.getAttribute("__path");
    }

    @Override
    public void include(ServletRequest request, ServletResponse response) {
        this.includedPath = (String) request.getAttribute("__path");
    }

    public String forwardedPath() {
        return forwardedPath;
    }

    public String includedPath() {
        return includedPath;
    }
}
```

Dalam mock request, biasanya dispatcher perlu disiapkan dengan path. Implementasi detail tergantung test support yang dipakai.

Controller test cukup menjawab:

```text
Apakah controller memilih JSP yang benar?
Apakah attribute model diset?
Apakah redirect/forward benar?
Apakah status/header benar?
```

Jangan paksa controller unit test untuk memvalidasi seluruh HTML.

---

## 25. Testing Header dan Cache Control untuk JSP Protected Page

Untuk protected page:

- tidak boleh cache sensitive HTML,
- perlu security headers,
- response harus punya content type/encoding benar.

Test controller/filter:

```java
@Test
void protectedPage_hasNoStoreCacheHeaders() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/cases/CASE-001");
    MockHttpServletResponse response = new MockHttpServletResponse();

    securityHeaderFilter.doFilter(request, response, chainThatRendersPage());

    assertEquals("no-store", response.getHeader("Cache-Control"));
    assertEquals("no-cache", response.getHeader("Pragma"));
}
```

Untuk header seperti CSP/X-Frame-Options:

```java
@Test
void protectedPage_hasSecurityHeaders() {
    HttpResponse response = httpGet("/cases/CASE-001");

    assertNotNull(response.header("Content-Security-Policy"));
    assertEquals("DENY", response.header("X-Frame-Options"));
}
```

Catatan: implementasi header bisa berbeda sesuai policy. Yang penting ada test eksplisit agar tidak hilang saat refactor filter/layout.

---

## 26. Testing Localization dan Formatting

JSP dengan `fmt:*` harus dites untuk locale/timezone yang berbeda.

Contoh expected behavior:

```text
Locale en-SG -> 31 Dec 2026
Locale id-ID -> 31 Des 2026
Timezone Asia/Jakarta -> date may differ from UTC near midnight
```

View model lebih baik sudah membawa display string jika format kompleks/kritis:

```java
public final class CaseDetailView {
    private final String submittedAtDisplay;
    private final String submittedAtIso;
}
```

Jika formatting dilakukan di JSP, integration test perlu set locale/timezone.

```java
@Test
void submittedDate_isRenderedForIndonesianLocale() {
    RenderRequest request = RenderRequest.forJsp("/WEB-INF/views/cases/detail.jsp")
        .locale(new Locale("id", "ID"))
        .attribute("caseDetail", fixtureSubmittedAt("2026-12-31T17:00:00Z"));

    String html = renderer.render(request);
    Document doc = Jsoup.parse(html);

    assertTrue(doc.selectFirst(".submitted-at").text().contains("2027")
        || doc.selectFirst(".submitted-at").text().contains("2026"));
}
```

Tanggal lintas timezone harus dites dengan hati-hati. Jangan menebak tanpa mendefinisikan timezone.

Lebih baik punya assertion eksplisit berdasarkan formatter yang sama dengan production policy.

---

## 27. Testing URL Construction

JSP sering membuat URL dengan `c:url` agar context path dan URL rewriting ditangani.

Test:

```java
@Test
void detailLink_usesApplicationContextPath() {
    String html = renderWithContextPath("/aceas");

    Document doc = Jsoup.parse(html);
    Element link = doc.selectFirst("a.case-detail");

    assertEquals("/aceas/cases/CASE-001", link.attr("href"));
}
```

Test query parameter escaping:

```java
@Test
void searchLink_encodesQueryParameter() {
    String html = renderSearchLink("A&B C");

    Document doc = Jsoup.parse(html);
    String href = doc.selectFirst("a.search-link").attr("href");

    assertTrue(href.contains("q=A%26B+C") || href.contains("q=A%26B%20C"));
    assertFalse(href.contains("q=A&B C"));
}
```

URL tests penting untuk aplikasi yang berada di sub-context, reverse proxy, atau domain migration.

---

## 28. Testing Include dan Layout Contract

Layout JSP/tag biasanya punya slot:

- title,
- content,
- scripts,
- breadcrumbs,
- alert,
- sidebar.

Test layout harus memastikan slot tidak hilang.

```java
@Test
void layoutRendersPageTitleBreadcrumbAndContent() {
    String html = renderPageUsingLayout();

    Document doc = Jsoup.parse(html);

    assertEquals("Case Detail", doc.selectFirst("title").text());
    assertEquals("Cases", doc.selectFirst("nav.breadcrumb a").text());
    assertNotNull(doc.selectFirst("main#content"));
    assertNotNull(doc.selectFirst("footer"));
}
```

Untuk page-specific script:

```java
@Test
void pageSpecificScript_isIncludedAfterMainBundle() {
    Document doc = Jsoup.parse(renderPageUsingLayout());

    Elements scripts = doc.select("script[src]");
    int appIndex = indexOfScript(scripts, "/assets/app.js");
    int pageIndex = indexOfScript(scripts, "/assets/case-detail.js");

    assertTrue(appIndex >= 0);
    assertTrue(pageIndex > appIndex);
}
```

Ini mencegah bug halus saat layout direfactor.

---

## 29. Testing Accessibility Basic di Rendered HTML

JSP enterprise sering dipakai untuk aplikasi internal/regulatory. Accessibility tetap penting.

Basic assertions:

```java
@Test
void formFields_haveLabels() {
    Document doc = Jsoup.parse(renderForm());

    for (Element input : doc.select("input[type=text], textarea, select")) {
        String id = input.id();
        assertFalse(id.isBlank(), "Field missing id: " + input.outerHtml());
        assertNotNull(doc.selectFirst("label[for=" + id + "]"), "Field missing label: " + id);
    }
}
```

Error summary:

```java
@Test
void errorSummary_hasAlertRole() {
    Document doc = Jsoup.parse(renderFormWithErrors());

    assertNotNull(doc.selectFirst(".error-summary[role=alert]"));
}
```

Button/link text:

```java
@Test
void linksHaveMeaningfulText() {
    Document doc = Jsoup.parse(renderPage());

    for (Element link : doc.select("a[href]")) {
        assertFalse(link.text().isBlank(), "Link has no text: " + link.outerHtml());
        assertNotEquals("click here", link.text().trim().toLowerCase(Locale.ROOT));
    }
}
```

Ini bukan pengganti accessibility audit, tetapi mengurangi regression umum.

---

## 30. Testing Tag Pooling dan Thread Safety

Classic tag handlers bisa dipool oleh container. Jika tag menyimpan state di field dan tidak direset, bug bisa muncul lintas invocation.

Contoh buruk:

```java
public class MenuTag extends TagSupport {
    private List<MenuItem> cachedItems;

    public int doStartTag() {
        if (cachedItems == null) {
            cachedItems = loadFromRequest();
        }
        render(cachedItems);
        return SKIP_BODY;
    }
}
```

Risiko:

- data request A bocor ke request B,
- user A melihat menu user B,
- state lama tetap dipakai.

Unit test reuse same instance:

```java
@Test
void tagDoesNotLeakStateAcrossInvocations() throws Exception {
    MenuTag tag = new MenuTag();

    PageContextStub ctx1 = PageContextStub.withUser("reviewer");
    tag.setPageContext(ctx1);
    tag.doStartTag();
    String first = ctx1.output();

    PageContextStub ctx2 = PageContextStub.withUser("viewer");
    tag.setPageContext(ctx2);
    tag.doStartTag();
    String second = ctx2.output();

    assertTrue(first.contains("Review"));
    assertFalse(second.contains("Review"));
}
```

Design rule:

```text
Tag instance fields should only hold current attributes.
Do not cache request/user/body-derived data in tag instance fields.
Reset mutable state after use if required by tag API style.
```

---

## 31. Testing EL Assumptions

EL failures sering terjadi karena property/method hilang.

Contoh JSP:

```jsp
${caseList.pagination.pageNumber}
```

Jika `pagination` null, behavior bisa berbeda tergantung usage dan config. Jangan biarkan accidental null menjadi bug UI.

View model test:

```java
@Test
void caseListViewAlwaysHasPagination() {
    CaseListView view = CaseListView.empty("Cases");

    assertNotNull(view.getPagination());
}
```

JSP rendering test:

```java
@Test
void emptyCaseListStillRendersPaginationRegion() {
    String html = renderCaseList(CaseListView.empty("Cases"));

    Document doc = Jsoup.parse(html);
    assertNotNull(doc.selectFirst(".pagination"));
}
```

EL convention:

```text
JSP should not navigate unpredictable null-heavy object graph.
View model should provide safe defaults.
```

---

## 32. Testing Legacy Scriptlet JSP

Legacy JSP dengan scriptlet bisa dites, tapi strategi awalnya bukan langsung unit test scriptlet.

Langkah realistis:

### Step 1 — Characterize Behavior

Render halaman untuk beberapa fixture utama:

```text
normal user
admin user
empty list
validation error
special characters
large list
expired session
```

### Step 2 — Golden Master

Simpan output normalized.

### Step 3 — Extract Logic

Pindahkan scriptlet logic ke Java class:

```text
JSP scriptlet condition
  -> ViewFactory method
  -> unit test
  -> JSP JSTL simple condition
```

### Step 4 — Add Focused Assertions

Tambahkan jsoup assertions untuk behavior penting.

### Step 5 — Refactor Incrementally

Jangan refactor semua JSP sekaligus.

---

## 33. Example: Refactor Scriptlet ke Testable View Model

Legacy JSP:

```jsp
<%
  User user = (User) session.getAttribute("user");
  Case c = (Case) request.getAttribute("case");
  boolean canApprove = user.hasRole("APPROVER") && "PENDING".equals(c.getStatus());
%>

<% if (canApprove) { %>
  <button name="action" value="approve">Approve</button>
<% } %>
```

Masalah:

- JSP baca session langsung.
- JSP tahu role dan status.
- Sulit dites tanpa JSP runtime.
- Authorization visibility campur business rule.

Refactor:

```java
public final class CaseActionViewFactory {

    public CaseActionView toView(UserContext user, CaseSummary c) {
        boolean approveVisible = user.hasRole("APPROVER") && c.isPending();
        return new CaseActionView(approveVisible);
    }
}
```

JSP:

```jsp
<c:if test="${caseActions.approveVisible}">
  <button name="action" value="approve">Approve</button>
</c:if>
```

Unit test:

```java
@Test
void approverCanSeeApproveForPendingCase() {
    CaseActionView view = factory.toView(
        UserContext.withRoles("APPROVER"),
        CaseSummary.pending("CASE-001")
    );

    assertTrue(view.isApproveVisible());
}
```

Rendering test:

```java
@Test
void approveButtonRenderedWhenVisible() {
    String html = renderActions(new CaseActionView(true));

    assertNotNull(Jsoup.parse(html).selectFirst("button[value=approve]"));
}
```

Endpoint enforcement test:

```java
@Test
void approveEndpointRejectsNonApprover() {
    assertThrows(AccessDeniedException.class, () -> {
        approveCaseUseCase.approve(UserContext.withRoles("VIEWER"), "CASE-001");
    });
}
```

Ini tiga test untuk tiga concern berbeda.

---

## 34. Integration Test Architecture untuk JSP App

Minimal architecture:

```text
src/main/webapp
  WEB-INF/views/...
  WEB-INF/tags/...

src/test/java
  ... controller tests
  ... view model tests
  ... tag handler tests
  ... integration tests

src/test/webapp or test resources
  fixture JSPs
  test-only web.xml if needed
```

Integration runner:

```text
JUnit
  starts embedded container
  deploys test webapp
  sends HTTP request
  receives HTML
  parses with jsoup
  asserts
```

Endpoint fixture example:

```java
@WebServlet("/test/render/case-list")
public class CaseListFixtureServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        request.setAttribute("caseList", CaseListFixtures.withTwoRows());
        request.setAttribute("csrfToken", "TEST-CSRF");
        request.getRequestDispatcher("/WEB-INF/views/cases/list.jsp")
               .forward(request, response);
    }
}
```

Test:

```java
@Test
void caseListJspRendersFixtureRows() {
    HttpResponse response = httpGet("/test/render/case-list");

    assertEquals(200, response.statusCode());

    Document doc = Jsoup.parse(response.body());
    assertEquals(2, doc.select("#case-table tbody tr").size());
}
```

Fixture servlets should exist only in test artifact, not production WAR.

---

## 35. Test Data Strategy

Bad test data makes view tests unreadable.

Prefer named fixtures:

```java
public final class CaseListFixtures {

    public static CaseListView empty() {
        return new CaseListView("Cases", List.of(), PaginationView.firstPageEmpty());
    }

    public static CaseListView withPendingReviewCase() {
        return new CaseListView(
            "Cases",
            List.of(new CaseRowView("CASE-001", "Alice Tan", "Pending Review", true, "/cases/CASE-001/review")),
            PaginationView.singlePage()
        );
    }

    public static CaseListView withMaliciousApplicantName() {
        return new CaseListView(
            "Cases",
            List.of(new CaseRowView("CASE-999", "<script>alert(1)</script>", "Pending Review", false, null)),
            PaginationView.singlePage()
        );
    }
}
```

Fixture names should explain scenario, not construction detail.

Bad:

```java
createCaseListView1()
createCaseListView2()
```

Good:

```java
withPendingReviewCaseVisibleToReviewer()
withNoCases()
withMaliciousApplicantName()
withExpiredSearchFilter()
```

---

## 36. Testing Large Data Rendering

JSP can become slow when rendering large tables.

Test should not benchmark heavily in unit test, but can guard against accidental huge rendering.

```java
@Test
void caseListDoesNotRenderMoreThanPageSizeRows() {
    CaseListView view = CaseListFixtures.withRows(10_000);

    String html = renderCaseList(view);
    Document doc = Jsoup.parse(html);

    assertTrue(doc.select("#case-table tbody tr").size() <= 100);
}
```

This test catches violation where pagination was forgotten and full list was passed to JSP.

Performance smoke test:

```java
@Test
void renderingHundredRowsCompletesWithinReasonableTime() {
    CaseListView view = CaseListFixtures.withRows(100);

    assertTimeout(Duration.ofMillis(500), () -> renderCaseList(view));
}
```

Use timing tests sparingly because CI machines vary. Prefer structural tests that prevent pathological cases.

---

## 37. Testing No Database Call During Rendering

JSP/tag rendering should not trigger repository/service calls.

This is especially important if view model accidentally exposes lazy JPA entities.

Approach:

```text
Use fake object that throws if lazy property is accessed.
```

Example:

```java
public final class DangerousCaseEntity {

    public String getApplicantName() {
        throw new AssertionError("JSP must not access entity directly");
    }
}
```

Better: JSP receives `CaseRowView`, not entity.

For integration with ORM, use SQL query counter in integration tests:

```java
@Test
void renderingCaseListDoesNotExecuteAdditionalQueries() {
    QueryCounter.reset();

    String html = renderCaseListWithPreparedViewModel();

    assertEquals(0, QueryCounter.count(), "Rendering must not hit database");
}
```

This is advanced but valuable in large enterprise systems.

---

## 38. Testing Error Pages

Error pages are often forgotten until incident.

Test cases:

1. 404 page renders without stack trace.
2. 500 page renders without exception details.
3. Error page has correlation id/request id.
4. Error page uses safe layout.
5. Error page does not require complex model.

Example:

```java
@Test
void error500PageDoesNotExposeStackTrace() {
    HttpResponse response = httpGet("/test/throw-exception");

    assertEquals(500, response.statusCode());
    assertFalse(response.body().contains("java.lang.NullPointerException"));
    assertFalse(response.body().contains("at com."));
    assertTrue(response.body().contains("Reference ID"));
}
```

Error JSP should be robust with minimal attributes. It should not fail while handling failure.

---

## 39. Testing JSP Migration `javax.*` ke `jakarta.*`

Migration risks:

- old tag handler imports `javax.servlet.jsp.*`,
- new runtime expects `jakarta.servlet.jsp.*`,
- old TLD references old classes,
- old custom tags packaged in incompatible JAR,
- JSTL URI changed for Jakarta Tags 3.0,
- legacy app has mixed dependencies.

Tests that help:

1. Compile all custom tag classes.
2. Precompile/render JSPs.
3. Scan source for `javax.servlet.jsp`.
4. Scan TLD for old handler classes.
5. Render representative pages.
6. Run XSS/CSRF regression tests.

Simple source scan:

```java
@Test
void noJakartaMigratedModuleUsesJavaxJspImports() throws IOException {
    Path sourceRoot = Path.of("src/main/java");

    try (Stream<Path> files = Files.walk(sourceRoot)) {
        List<Path> offenders = files
            .filter(p -> p.toString().endsWith(".java"))
            .filter(p -> contains(p, "javax.servlet.jsp"))
            .toList();

        assertTrue(offenders.isEmpty(), "Found legacy javax JSP imports: " + offenders);
    }
}
```

For codebases that intentionally support Java EE 8 and Jakarta EE side by side, adjust rule by module.

---

## 40. Java 8–25 Testing Implications

### 40.1 Java 8

- JUnit 5 can still be used in many versions, but modern toolchains may limit support.
- No text blocks.
- No records.
- No switch expressions.
- Many old JSP apps live here.

Test code examples need Java 8 alternatives:

```java
String html = "<table>" +
              "<tr><td>CASE-001</td></tr>" +
              "</table>";
```

### 40.2 Java 11

- Better baseline for modern build tools.
- Still common transitional runtime.

### 40.3 Java 17

- Minimum runtime for Jakarta EE 11.
- Records can simplify immutable view models if project policy allows.

Example:

```java
public record CaseRowView(
    String caseId,
    String applicantName,
    String statusLabel,
    boolean reviewActionVisible,
    String reviewUrl
) {}
```

EL bean property access with records depends on framework/runtime support expectations. Be careful in old JSP/EL runtimes.

### 40.4 Java 21/25

- Better runtime performance and GC options.
- Virtual threads may help request concurrency in servlet environments that support them, but JSP rendering itself should still avoid blocking DB/service calls.
- Testing should catch render-path blocking rather than assume virtual threads solve design problems.

---

## 41. Practical Test Suite Blueprint

For a mature JSP/tag codebase, a practical suite could look like this:

```text
View model unit tests
  CaseListViewFactoryTest
  CaseDetailViewFactoryTest
  FormErrorMapperTest
  NavigationViewFactoryTest

Controller tests
  CaseListServletTest
  CaseDetailServletTest
  ApprovalServletTest

Tag handler tests
  BadgeTagTest
  ButtonTagTest
  PaginationTagTest
  SecureLinkTagTest

Renderer/helper tests
  HtmlEscaperTest
  UrlBuilderTest
  DateDisplayFormatterTest
  MenuRendererTest

JSP integration tests
  CaseListJspIT
  CaseDetailJspIT
  LoginJspIT
  ErrorPageJspIT

Security rendering tests
  XssRenderingIT
  CsrfRenderingIT
  HiddenFieldExposureIT
  SecurityHeadersIT

Migration/smoke tests
  JspCompilationIT
  TaglibResolutionIT
  JavaxJakartaScanTest
```

This gives layered confidence without making everything browser-driven.

---

## 42. Example Full Scenario: Case List Page

### 42.1 Requirement

Case list page must:

1. Show case id.
2. Show applicant name escaped.
3. Show status label.
4. Show review action only if `reviewActionVisible=true`.
5. Show empty state if no rows.
6. Include CSRF token for bulk action form.
7. Not expose sensitive hidden fields.
8. Render valid table structure.

### 42.2 View Model

```java
public final class CaseListView {
    private final String title;
    private final List<CaseRowView> rows;
    private final String bulkAssignUrl;

    public CaseListView(String title, List<CaseRowView> rows, String bulkAssignUrl) {
        this.title = title;
        this.rows = List.copyOf(rows);
        this.bulkAssignUrl = bulkAssignUrl;
    }

    public String getTitle() { return title; }
    public List<CaseRowView> getRows() { return rows; }
    public boolean isEmpty() { return rows.isEmpty(); }
    public String getBulkAssignUrl() { return bulkAssignUrl; }
}
```

### 42.3 JSP Sketch

```jsp
<h1><c:out value="${caseList.title}" /></h1>

<c:choose>
  <c:when test="${caseList.empty}">
    <div class="empty-state">No cases found.</div>
  </c:when>
  <c:otherwise>
    <form method="post" action="${caseList.bulkAssignUrl}">
      <input type="hidden" name="_csrf" value="${csrfToken}" />

      <table id="case-table">
        <thead>
          <tr>
            <th>Case ID</th>
            <th>Applicant</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <c:forEach var="row" items="${caseList.rows}">
            <tr data-case-id="${row.caseId}">
              <td class="case-id"><c:out value="${row.caseId}" /></td>
              <td class="applicant"><c:out value="${row.applicantName}" /></td>
              <td class="status"><c:out value="${row.statusLabel}" /></td>
              <td class="actions">
                <c:if test="${row.reviewActionVisible}">
                  <a class="action-review" href="${row.reviewUrl}">Review</a>
                </c:if>
              </td>
            </tr>
          </c:forEach>
        </tbody>
      </table>
    </form>
  </c:otherwise>
</c:choose>
```

### 42.4 Rendering Test

```java
@Test
void caseListRendersRowsAndEscapesApplicantName() {
    CaseListView view = new CaseListView(
        "Cases",
        List.of(new CaseRowView(
            "CASE-001",
            "<script>alert(1)</script>",
            "Pending Review",
            true,
            "/cases/CASE-001/review"
        )),
        "/cases/bulk-assign"
    );

    String html = renderCaseList(view, "CSRF-123");
    Document doc = Jsoup.parse(html);

    assertEquals("Cases", doc.selectFirst("h1").text());
    assertEquals(1, doc.select("#case-table tbody tr").size());
    assertEquals("CASE-001", doc.selectFirst("td.case-id").text());
    assertEquals("<script>alert(1)</script>", doc.selectFirst("td.applicant").text());
    assertEquals(0, doc.select("script").size());
    assertNotNull(doc.selectFirst("a.action-review[href=/cases/CASE-001/review]"));
    assertNotNull(doc.selectFirst("input[name=_csrf][value=CSRF-123]"));
}
```

### 42.5 Empty State Test

```java
@Test
void emptyCaseListRendersEmptyStateAndNoTableRows() {
    CaseListView view = new CaseListView("Cases", List.of(), "/cases/bulk-assign");

    String html = renderCaseList(view, "CSRF-123");
    Document doc = Jsoup.parse(html);

    assertEquals("No cases found.", doc.selectFirst(".empty-state").text());
    assertEquals(0, doc.select("#case-table tbody tr").size());
}
```

---

## 43. Anti-Patterns dalam JSP/Tag Testing

### 43.1 Testing Semuanya Lewat Selenium

Masalah:

- lambat,
- flaky,
- sulit pinpoint bug,
- butuh environment besar,
- feedback loop buruk.

Gunakan E2E untuk workflow utama saja.

### 43.2 Snapshot Terlalu Besar

Snapshot 5.000 baris HTML akan menjadi noise.

Lebih baik:

- snapshot per component/page fragment,
- normalize,
- combine with selector assertions.

### 43.3 Assert Berdasarkan Whitespace

Buruk:

```java
assertEquals("<td>CASE-001</td>", html);
```

Lebih baik:

```java
assertEquals("CASE-001", Jsoup.parse(html).selectFirst("td.case-id").text());
```

### 43.4 Membiarkan JSP Mengakses Entity Langsung

JSP yang membaca JPA entity bisa trigger lazy loading dan N+1.

Gunakan view model.

### 43.5 Test Mengandalkan Data Production-Like Besar

Test harus kecil dan jelas. Untuk performance/large case, buat fixture khusus.

### 43.6 Tidak Mengetes Malicious Input

View test tanpa XSS payload kurang berguna untuk server-side rendering.

---

## 44. Checklist: JSP Page Testability Review

Untuk setiap JSP penting, tanyakan:

1. Apakah semua data utama datang lewat satu view model jelas?
2. Apakah JSP tidak membaca domain object terlalu dalam?
3. Apakah JSP tidak memanggil service/repository?
4. Apakah field user-controlled di-escape sesuai context?
5. Apakah semua POST form punya CSRF token?
6. Apakah hidden field tidak membawa secret/authority?
7. Apakah action visibility berasal dari view model?
8. Apakah endpoint enforcement dites terpisah?
9. Apakah empty state dites?
10. Apakah validation errors dites?
11. Apakah layout slot dites?
12. Apakah JSP bisa dikompilasi dalam CI?
13. Apakah custom tags punya unit/integration test?
14. Apakah error page dites?
15. Apakah page penting punya rendering smoke test?

---

## 45. Checklist: Custom Tag Testability Review

Untuk setiap custom tag:

1. Apakah tag punya TLD/tag file contract jelas?
2. Apakah attribute required/optional terdokumentasi?
3. Apakah attribute value di-normalize?
4. Apakah dynamic attributes punya allowlist?
5. Apakah output escaping sesuai context?
6. Apakah body invocation dites?
7. Apakah null attribute behavior jelas?
8. Apakah tag tidak menyimpan request-specific state lintas invocation?
9. Apakah tag tidak memanggil DB/service berat?
10. Apakah renderer/helper logic bisa dites tanpa JSP runtime?
11. Apakah malicious payload dites?
12. Apakah tag bisa dipakai di layout nested?
13. Apakah migration `javax`/`jakarta` aman?
14. Apakah accessibility output diperhatikan?
15. Apakah output stabil untuk snapshot/selector assertions?

---

## 46. Testing Strategy untuk Legacy Enterprise System

Jika kamu masuk ke sistem JSP lama yang besar, jangan mulai dari “rewrite everything”.

Gunakan urutan ini:

### Phase 1 — Inventory

Buat daftar:

- JSP public/protected,
- include fragments,
- tag files,
- custom tag handlers,
- TLD,
- pages with scriptlet,
- pages with SQL/XML tags,
- pages with sensitive forms,
- pages with upload/download,
- pages with admin actions.

### Phase 2 — Risk Ranking

Prioritaskan test untuk:

1. login/session pages,
2. approval/action forms,
3. pages rendering PII,
4. admin pages,
5. high-traffic lists,
6. error pages,
7. legacy scriptlet-heavy pages,
8. custom tags used everywhere.

### Phase 3 — Compile/Smoke

Pastikan JSP utama bisa compile/render.

### Phase 4 — Security Rendering Tests

Tambahkan XSS/CSRF/hidden field/security header tests.

### Phase 5 — View Model Extraction

Pindahkan logic ke view model factory.

### Phase 6 — Refactor Tags/Layout

Baru setelah ada safety net.

---

## 47. Top 1% Engineering Lens

Testing JSP/tag libraries bukan hanya “nambah test”. Ini tentang mengendalikan risiko di layer yang sering dianggap remeh.

Engineer biasa melihat JSP sebagai file tampilan.

Engineer kuat melihat JSP sebagai:

```text
runtime-generated servlet + template + state boundary + encoding surface + authorization visibility surface + operational artifact
```

Karena itu, pertanyaan yang harus selalu muncul:

1. Apa kontrak data view ini?
2. Siapa yang menghitung decision flag?
3. Apakah output aman di HTML/JS/URL/CSS context?
4. Apakah rendering punya side effect?
5. Apakah page bisa compile di CI?
6. Apakah legacy output terkunci sebelum refactor?
7. Apakah custom tag reusable punya test sendiri?
8. Apakah authorization visibility dan authorization enforcement dipisah test-nya?
9. Apakah test membuktikan behavior, bukan incidental markup?
10. Apakah failure di view bisa didiagnosis di production?

Itulah perbedaan antara “bisa bikin JSP” dan “bisa menjaga server-side UI enterprise tetap aman, maintainable, dan migratable”.

---

## 48. Ringkasan

Di bagian ini kita membahas:

1. Kenapa JSP/tag testing sulit.
2. Testing pyramid khusus server-side UI.
3. Kontrak controller ke JSP.
4. View model sebagai pusat testability.
5. HTML assertion dengan parser.
6. XSS/CSRF/security rendering tests.
7. Form, hidden field, URL, layout, error page testing.
8. Unit testing custom tag handlers.
9. Testing body content dan dynamic attributes.
10. Testing tag files lewat integration rendering.
11. JSP compilation/smoke tests.
12. Golden master untuk legacy JSP.
13. Tag pooling/thread-safety testing.
14. Migration tests untuk `javax.*` ke `jakarta.*`.
15. Java 8–25 implications.
16. Practical test suite blueprint.
17. Enterprise refactoring strategy.

Key mental model:

```text
Do not test business logic through JSP.
Do not leave JSP untested either.

Move decisions into view models.
Test reusable tags directly.
Render important JSPs in integration tests.
Assert HTML structurally.
Add security payloads.
Use golden master for legacy refactoring.
Keep endpoint enforcement separate from UI visibility.
```

---

## 49. Referensi

- Jakarta Pages 4.0 Specification — JSP/Jakarta Pages processing, tag extension model, and page runtime concepts.
- Jakarta Servlet 6.1 Specification and API — `RequestDispatcher`, request/response handling, forwarding and including resources.
- Jakarta Expression Language 6.0 Specification — expression evaluation model used by JSP and Faces.
- Jakarta Standard Tag Library 3.0 Specification — JSTL/Jakarta Tags model.
- JUnit User Guide — modern JVM testing framework foundation.
- jsoup Documentation — HTML parsing and selector-based assertions for Java.
- OWASP XSS Prevention Cheat Sheet — context-aware output encoding principles.
- OWASP CSRF Prevention Cheat Sheet — CSRF token and request forgery prevention principles.

---

## 50. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
14-jakarta-faces-big-picture-component-based-mvc.md
```
