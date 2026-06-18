# Part 5 — Expression Language Fundamentals: Value Expressions, Method Expressions, Resolver Chain

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `05-expression-language-fundamentals-value-method-resolver-chain.md`  
> Area: Jakarta Expression Language / Java Expression Language / JSP EL / JSF EL  
> Target: Java 8 sampai Java 25, Java EE `javax.el` sampai Jakarta EE `jakarta.el`

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu tidak hanya bisa menulis:

```jsp
${user.name}
```

atau:

```xhtml
#{caseBean.submit}
```

Tetapi memahami **apa yang sebenarnya terjadi** ketika expression itu dievaluasi:

1. expression diparse menjadi object expression;
2. expression dievaluasi dalam sebuah `ELContext`;
3. engine mencari variable pertama;
4. engine berjalan melalui rantai `ELResolver`;
5. setiap resolver mencoba memahami `base` dan `property`;
6. jika resolver berhasil, ia menandai property sebagai resolved;
7. hasil akhir dikonversi ke tipe yang dibutuhkan;
8. expression dapat dipakai untuk membaca value, menulis value, atau memanggil method.

Bagian ini adalah fondasi sebelum masuk ke custom EL function, custom resolver, JSTL, dan Faces lifecycle.

---

## 2. Mental Model Besar: EL Adalah Binding Layer

Expression Language, atau EL, sering terlihat seperti syntax kecil di view:

```jsp
${case.status}
```

Namun secara arsitektural, EL adalah **binding layer** antara view dan application model.

Artinya, EL bukan sekadar string interpolation. EL adalah mekanisme yang memungkinkan view berkata:

> “Aku ingin mengambil/memanggil sesuatu dari model aplikasi, tapi aku tidak mau tahu apakah data itu berasal dari request attribute, session attribute, CDI bean, map, list, array, JavaBean property, atau object lain.”

EL menyembunyikan detail lookup object agar view lebih deklaratif.

### 2.1 Tanpa EL

Tanpa EL, JSP lama cenderung memakai scriptlet:

```jsp
<%
    User user = (User) request.getAttribute("user");
    out.print(user.getName());
%>
```

Masalahnya:

1. view tahu detail scope;
2. view tahu casting;
3. view tahu method Java;
4. view bisa mudah berisi business logic;
5. view menjadi sulit dites dan sulit dimigrasi.

### 2.2 Dengan EL

Dengan EL:

```jsp
${user.name}
```

View hanya menyatakan dependency:

> “Ada sesuatu bernama `user`, dan aku butuh property `name`.”

EL engine yang bertanggung jawab mencari `user` dan membaca `name`.

### 2.3 Dalam Faces

Di Jakarta Faces, EL jauh lebih kuat karena bukan hanya mengambil nilai, tapi juga melakukan two-way binding dan method invocation:

```xhtml
<h:inputText value="#{caseForm.subject}" />
<h:commandButton value="Submit" action="#{caseForm.submit}" />
```

Artinya:

1. saat render, `caseForm.subject` dibaca untuk mengisi input;
2. saat postback, submitted value dikonversi dan divalidasi;
3. jika valid, value ditulis kembali ke `caseForm.subject`;
4. saat action phase, `caseForm.submit()` dipanggil.

Ini alasan EL adalah fondasi Faces.

---

## 3. Peran EL di JSP/Jakarta Pages dan Faces

EL dipakai oleh beberapa teknologi Jakarta EE, terutama:

1. Jakarta Pages/JSP;
2. Jakarta Faces;
3. Jakarta Tags/JSTL;
4. CDI integration;
5. beberapa konfigurasi/security expression di konteks tertentu;
6. penggunaan standalone via `ELProcessor` atau `ExpressionFactory`.

Namun cara evaluasinya bisa berbeda tergantung host technology.

### 3.1 EL di JSP/Jakarta Pages

Di JSP, EL paling sering dipakai untuk output dan conditional expression:

```jsp
<p>${case.title}</p>

<c:if test="${case.overdue}">
    <span class="badge">Overdue</span>
</c:if>
```

Karakter utamanya:

1. expression biasanya dievaluasi saat request rendering;
2. mostly read-only dari sudut pandang view;
3. sering bekerja bersama JSTL;
4. lookup sering dimulai dari page/request/session/application scope;
5. method invocation mungkin ada pada EL modern, tetapi dalam JSP sebaiknya tetap dijaga agar tidak menjadi business logic in view.

### 3.2 EL di Faces

Di Faces, EL adalah binding engine untuk component model:

```xhtml
<h:inputText value="#{applicationBean.referenceNo}" />
<h:commandButton action="#{applicationBean.approve}" />
```

Karakter utamanya:

1. expression dapat dievaluasi berkali-kali dalam lifecycle;
2. value expression bisa dibaca dan ditulis;
3. method expression dipakai untuk action, listener, validator, converter, event handler;
4. resolver dapat menemukan CDI bean;
5. expression dapat deferred, artinya tidak harus dievaluasi saat halaman diparse.

### 3.3 Perbedaan Insting Arsitektural

| Konteks | EL Biasanya Berarti | Risiko Utama |
|---|---|---|
| JSP | Ambil data dari scope dan render | view logic terlalu banyak |
| JSTL | Conditional/loop/formatting | logic bercabang terlalu kompleks |
| Faces | Binding component ke bean | lifecycle surprise, state surprise |
| Standalone EL | Evaluate expression dari program | injection jika expression dari user |

---

## 4. Namespace dan Versi: `javax.el` vs `jakarta.el`

Untuk Java 8 sampai Java 25, kamu perlu membedakan dua dunia:

```java
javax.el.*
```

versus:

```java
jakarta.el.*
```

### 4.1 Dunia `javax.el`

Umumnya ditemukan pada:

1. Java EE 6/7/8;
2. JSP 2.x;
3. JSF 2.x;
4. Servlet 3.x/4.x;
5. aplikasi Java 8 legacy;
6. dependency seperti `javax.el-api`.

Contoh import:

```java
import javax.el.ELContext;
import javax.el.ELResolver;
import javax.el.ValueExpression;
import javax.el.MethodExpression;
```

### 4.2 Dunia `jakarta.el`

Umumnya ditemukan pada:

1. Jakarta EE 9+;
2. Jakarta EE 10;
3. Jakarta EE 11;
4. Jakarta Pages 3.x/4.x;
5. Jakarta Faces 3.x/4.x;
6. Servlet/Jakarta Servlet 5+;
7. Java 17+ untuk Jakarta EE 11 baseline.

Contoh import:

```java
import jakarta.el.ELContext;
import jakarta.el.ELResolver;
import jakarta.el.ValueExpression;
import jakarta.el.MethodExpression;
```

### 4.3 Prinsip Penting

Jangan mencampur `javax.el` dan `jakarta.el` dalam satu runtime modern.

Ini sering menyebabkan error yang membingungkan:

1. class cast error;
2. `NoSuchMethodError`;
3. `ClassNotFoundException`;
4. component library tidak kompatibel;
5. JSF/Faces tidak menemukan resolver;
6. CDI bean tidak muncul di EL.

Jika container kamu Jakarta EE 10/11, stack view juga harus Jakarta-compatible.

---

## 5. Dua Bentuk Ekspresi: Immediate dan Deferred

Secara historis, EL mengenal dua delimiter penting:

```text
${...}
#{...}
```

Keduanya terlihat mirip, tapi mental modelnya berbeda.

---

## 6. Immediate Expression: `${...}`

Immediate expression memakai syntax:

```jsp
${user.name}
```

Disebut immediate karena expression biasanya dievaluasi segera oleh page technology ketika halaman diproses.

Contoh JSP:

```jsp
<p>Hello, ${user.name}</p>
```

Pada saat JSP dirender:

1. engine menemukan expression `${user.name}`;
2. engine mencari variable `user`;
3. engine membaca property `name`;
4. hasil dikonversi menjadi string;
5. output ditulis ke response.

### 6.1 Cocok Untuk

`${...}` cocok untuk:

1. output value;
2. conditional JSTL;
3. loop JSTL;
4. URL parameter sederhana;
5. rendering read-only;
6. formatting dengan JSTL.

Contoh:

```jsp
<c:if test="${not empty cases}">
    <p>Total cases: ${cases.size()}</p>
</c:if>
```

### 6.2 Bahaya Arsitektural

Jika `${...}` terlalu pintar:

```jsp
${caseService.findOverdueCases(user.department).size()}
```

maka view mulai melakukan service call. Ini buruk karena:

1. view menjadi tidak predictable;
2. rendering bisa memicu database query;
3. testing sulit;
4. performance tersembunyi;
5. security boundary kabur;
6. controller tidak lagi menjadi orchestrator.

Lebih baik controller menyiapkan view model:

```java
request.setAttribute("caseSummary", caseSummary);
```

Lalu JSP hanya membaca:

```jsp
${caseSummary.overdueCount}
```

---

## 7. Deferred Expression: `#{...}`

Deferred expression memakai syntax:

```xhtml
#{caseBean.status}
```

Disebut deferred karena expression tidak harus dievaluasi saat view dibaca. Host technology, terutama Faces, dapat menyimpan expression object dan mengevaluasinya nanti pada lifecycle phase tertentu.

Contoh Faces:

```xhtml
<h:inputText value="#{caseBean.subject}" />
<h:commandButton value="Submit" action="#{caseBean.submit}" />
```

Di sini:

```xhtml
#{caseBean.subject}
```

bukan sekadar output. Itu adalah binding yang dapat:

1. dibaca saat render;
2. ditulis saat update model;
3. dikonversi;
4. divalidasi;
5. dievaluasi ulang setelah postback.

Sementara:

```xhtml
#{caseBean.submit}
```

adalah method expression yang dipanggil saat action phase.

### 7.1 Cocok Untuk

`#{...}` cocok untuk:

1. Faces component value binding;
2. action method;
3. event listener;
4. validator method;
5. converter reference;
6. deferred evaluation;
7. two-way binding.

### 7.2 Kesalahan Umum

Kesalahan paling umum adalah menganggap:

```xhtml
#{bean.value}
```

selalu dievaluasi satu kali.

Dalam Faces, expression bisa dievaluasi berkali-kali:

1. saat build view;
2. saat restore view;
3. saat decode request;
4. saat validate;
5. saat update model;
6. saat render;
7. saat ajax partial render.

Karena itu, getter di backing bean tidak boleh melakukan operasi berat.

Buruk:

```java
public List<CaseDto> getCases() {
    return caseService.findAllCases();
}
```

Lebih aman:

```java
@PostConstruct
public void init() {
    this.cases = caseService.findAllCases();
}

public List<CaseDto> getCases() {
    return cases;
}
```

---

## 8. Value Expression vs Method Expression

EL expression diparse sebagai salah satu dari dua kategori besar:

1. value expression;
2. method expression.

---

## 9. Value Expression

Value expression adalah expression yang merepresentasikan sebuah nilai.

Contoh:

```jsp
${user.name}
```

```xhtml
#{caseForm.subject}
```

```xhtml
#{caseForm.priority eq 'HIGH'}
```

Value expression dapat berupa:

1. read-only;
2. read-write;
3. literal;
4. composite;
5. expected-type aware.

### 9.1 Rvalue dan Lvalue

Dalam praktik, ada dua peran value expression:

1. **rvalue**: expression hanya dibaca;
2. **lvalue**: expression bisa menjadi target assignment.

Contoh rvalue:

```jsp
${case.title}
```

Contoh lvalue di Faces:

```xhtml
<h:inputText value="#{caseForm.title}" />
```

Agar menjadi lvalue, expression harus menunjuk ke property yang writable.

Bean:

```java
@Named
@RequestScoped
public class CaseForm {
    private String title;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }
}
```

Jika setter tidak ada, input Faces tidak bisa update model.

### 9.2 Literal Value Expression

Expression bisa literal:

```xhtml
<h:outputText value="Case Detail" />
```

atau:

```xhtml
<h:commandButton value="Submit" />
```

Literal tidak membutuhkan resolver untuk lookup property.

### 9.3 Composite Expression

Composite expression menggabungkan literal text dan expression:

```jsp
Hello, ${user.name}. Your role is ${user.role}.
```

Hasil akhirnya biasanya string.

Dalam view enterprise, composite expression berguna untuk label sederhana, tapi jangan dipakai untuk membuat grammar/locale kompleks. Untuk i18n, gunakan resource bundle dan formatting.

---

## 10. Method Expression

Method expression merepresentasikan method yang akan dipanggil.

Contoh:

```xhtml
<h:commandButton value="Approve" action="#{caseBean.approve}" />
```

Method yang dipanggil:

```java
public String approve() {
    caseService.approve(caseId);
    return "case-detail?faces-redirect=true";
}
```

### 10.1 Method Expression dengan Parameter

EL modern mendukung pemanggilan method dengan parameter pada konteks tertentu:

```xhtml
<h:commandButton value="Assign" action="#{caseBean.assign(caseItem.id)}" />
```

Namun hati-hati. Jika terlalu banyak parameter dan logic di view, view mulai menjadi flow controller.

Lebih baik untuk aksi penting:

```xhtml
<h:commandButton value="Assign" action="#{caseBean.assignSelected}" />
```

Lalu state eksplisit di bean:

```java
private Long selectedCaseId;

public String assignSelected() {
    caseService.assign(selectedCaseId, currentOfficerId);
    return null;
}
```

### 10.2 Return Type

Dalam Faces, action method sering mengembalikan:

1. `String` navigation outcome;
2. `void` untuk stay on same view;
3. `Object` yang dikonversi menjadi outcome pada implementasi tertentu;
4. `null` untuk tetap pada halaman saat ini.

Contoh:

```java
public String save() {
    service.save(form);
    return "detail?faces-redirect=true&id=" + form.getId();
}
```

### 10.3 Method Expression vs Action Listener

Action method:

```xhtml
<h:commandButton action="#{bean.save}" />
```

Biasanya untuk business action dan navigation.

Action listener:

```xhtml
<h:commandButton actionListener="#{bean.beforeSave}" />
```

Biasanya untuk component event handling.

Rule of thumb:

1. business action → `action`;
2. UI event detail → listener;
3. jangan menaruh business transaction penting hanya di listener tanpa alasan jelas.

---

## 11. EL Evaluation Pipeline

Mari gunakan expression:

```jsp
${case.assignee.name}
```

Secara mental, pipeline-nya:

```text
expression string
   ↓ parse
ValueExpression
   ↓ evaluate with ELContext
resolve variable: case
   ↓
resolve property: assignee
   ↓
resolve property: name
   ↓
coerce result if needed
   ↓
return value
```

Untuk expression:

```xhtml
#{caseBean.approve(case.id)}
```

Pipeline-nya:

```text
expression string
   ↓ parse
MethodExpression
   ↓ evaluate with ELContext
resolve variable: caseBean
   ↓
resolve method: approve
   ↓
resolve argument: case.id
   ↓
coerce argument types
   ↓
invoke method
   ↓
coerce return value if needed
```

---

## 12. `ELContext`: Evaluation Environment

`ELContext` adalah object yang membawa konteks evaluasi.

Ia biasanya berisi:

1. `ELResolver` utama;
2. `FunctionMapper`;
3. `VariableMapper`;
4. locale;
5. flag apakah property sudah resolved;
6. context object tambahan milik host technology.

Secara sederhana:

```text
ELContext = environment tempat expression dievaluasi
```

### 12.1 Mengapa `ELContext` Penting?

Karena expression yang sama bisa menghasilkan hasil berbeda tergantung context.

Expression:

```text
${user.name}
```

Di request A, `user` bisa `Alice`.

Di request B, `user` bisa `Bob`.

Di Faces view tertentu, `user` bisa CDI bean.

Di standalone EL processor, `user` bisa variable yang didaftarkan manual.

Expression tidak berdiri sendiri. Ia selalu bergantung pada `ELContext`.

---

## 13. `ExpressionFactory`: Pembuat Expression Object

`ExpressionFactory` bertugas membuat object expression dari string.

Contoh konseptual:

```java
ExpressionFactory factory = ExpressionFactory.newInstance();
ValueExpression expr = factory.createValueExpression(
        elContext,
        "${user.name}",
        String.class
);
```

Lalu:

```java
String name = (String) expr.getValue(elContext);
```

Di JSP/Faces, kamu jarang membuat ini manual. Container/framework melakukannya.

Tapi memahami ini penting untuk:

1. custom component;
2. custom tag;
3. testing;
4. dynamic expression evaluation;
5. debugging runtime EL issue.

---

## 14. Resolver Chain: Jantung EL

`ELResolver` adalah jantung EL.

Ia menjawab pertanyaan:

> “Untuk base object tertentu dan property tertentu, bagaimana cara mengambil/menulis nilai atau memanggil method?”

EL evaluation berjalan dengan konsep:

```text
base + property → value
```

Contoh:

```text
user.name
```

Akan dievaluasi bertahap:

```text
base=null, property="user"  → cari variable user
base=userObject, property="name" → baca user.name
```

Expression:

```text
case.assignee.department.name
```

Menjadi:

```text
base=null, property="case"        → caseObject
base=caseObject, property="assignee" → assigneeObject
base=assigneeObject, property="department" → departmentObject
base=departmentObject, property="name" → "Enforcement"
```

### 14.1 `propertyResolved`

Setiap resolver yang berhasil menangani property harus memberi tahu context:

```java
context.setPropertyResolved(true);
```

Jika tidak, resolver berikutnya akan terus mencoba.

Mental model:

```text
for resolver in resolverChain:
    value = resolver.getValue(context, base, property)
    if context.propertyResolved:
        return value
```

Jika tidak ada resolver yang bisa menyelesaikan, hasil bisa `null` atau exception tergantung operasi dan host technology.

---

## 15. Resolver Umum yang Perlu Dipahami

EL engine biasanya menggunakan gabungan resolver.

Resolver yang sering relevan:

1. scoped attribute resolver;
2. implicit object resolver;
3. map resolver;
4. list resolver;
5. array resolver;
6. bean resolver;
7. resource bundle resolver;
8. CDI bean resolver;
9. static field/method/import resolver pada EL modern;
10. custom resolver.

Urutan bisa bergantung container/host technology.

Yang penting bukan hafal urutan semua implementation, tapi paham konsekuensinya:

> variable pertama diselesaikan oleh resolver awal; property berikutnya diselesaikan berdasarkan tipe base object.

---

## 16. Scoped Attribute Resolution di JSP

Di JSP, variable seperti:

```jsp
${user}
```

sering dicari dari scope.

Urutan mental umum:

```text
page scope
request scope
session scope
application scope
```

Jika `user` ada di request dan session, request biasanya menang.

Contoh:

```java
request.setAttribute("user", requestUser);
session.setAttribute("user", sessionUser);
```

JSP:

```jsp
${user.name}
```

Kemungkinan besar membaca `requestUser.name`, bukan `sessionUser.name`.

### 16.1 Best Practice

Jangan memakai nama attribute generik yang bertabrakan:

Buruk:

```java
request.setAttribute("data", data);
session.setAttribute("data", sessionData);
```

Lebih baik:

```java
request.setAttribute("caseDetailView", view);
session.setAttribute("currentUserContext", userContext);
```

View:

```jsp
${caseDetailView.referenceNo}
${currentUserContext.displayName}
```

---

## 17. Implicit Object Resolution

JSP EL menyediakan implicit objects seperti:

1. `pageContext`;
2. `pageScope`;
3. `requestScope`;
4. `sessionScope`;
5. `applicationScope`;
6. `param`;
7. `paramValues`;
8. `header`;
9. `headerValues`;
10. `cookie`;
11. `initParam`.

Contoh eksplisit:

```jsp
${requestScope.caseDetail.referenceNo}
${sessionScope.currentUser.displayName}
${param.caseId}
${header['User-Agent']}
${cookie.JSESSIONID.value}
```

### 17.1 Kapan Pakai Explicit Scope?

Gunakan explicit scope ketika:

1. ada risiko nama bertabrakan;
2. source data penting secara security;
3. membaca request parameter;
4. debugging;
5. halaman legacy sulit dipahami.

Contoh lebih aman:

```jsp
${requestScope.caseDetailView.status}
```

daripada:

```jsp
${caseDetailView.status}
```

Jika kodebase besar dan banyak include, explicit scope sering lebih mudah diaudit.

---

## 18. Map Resolution

Jika base object adalah `Map`, property akan dicari sebagai key.

Contoh Java:

```java
Map<String, Object> caseMap = new HashMap<>();
caseMap.put("referenceNo", "CASE-2026-001");
request.setAttribute("caseMap", caseMap);
```

JSP:

```jsp
${caseMap.referenceNo}
```

atau:

```jsp
${caseMap['referenceNo']}
```

Keduanya bisa menghasilkan:

```text
CASE-2026-001
```

### 18.1 Dot vs Bracket

Dot syntax:

```jsp
${caseMap.referenceNo}
```

bagus untuk key sederhana.

Bracket syntax:

```jsp
${caseMap['reference-no']}
${caseMap[param.dynamicKey]}
```

berguna untuk:

1. key mengandung tanda minus;
2. key mengandung spasi;
3. key dinamis;
4. property name berasal dari variable.

### 18.2 Risiko Map di View

Map fleksibel, tapi mengurangi type safety.

Buruk jika semua view model dibuat sebagai map arbitrer:

```java
Map<String, Object> model = new HashMap<>();
model.put("a", ...);
model.put("b", ...);
model.put("flag1", ...);
```

Lebih kuat:

```java
public record CaseDetailView(
        String referenceNo,
        String status,
        String assigneeName,
        boolean canApprove
) {}
```

Lalu:

```jsp
${caseDetailView.referenceNo}
${caseDetailView.canApprove}
```

EL modern mendukung Java records pada Jakarta EE modern, tetapi compatibility dengan Java EE lama perlu dicek.

---

## 19. List and Array Resolution

Jika base adalah `List` atau array, property biasanya index.

Java:

```java
request.setAttribute("cases", List.of(case1, case2, case3));
```

JSP:

```jsp
${cases[0].referenceNo}
```

Array:

```jsp
${names[1]}
```

### 19.1 Jangan Mengandalkan Index untuk Data Penting

Expression seperti:

```jsp
${cases[0].status}
```

boleh untuk demo, tapi riskan untuk UI enterprise karena:

1. list bisa kosong;
2. urutan bisa berubah;
3. null handling bisa menyembunyikan bug;
4. view menjadi bergantung ke ordering yang tidak eksplisit.

Lebih baik controller menyiapkan field khusus:

```java
view.setPrimaryCase(cases.isEmpty() ? null : cases.get(0));
```

JSP:

```jsp
${caseDashboard.primaryCase.status}
```

---

## 20. Bean Resolution

Jika base adalah Java object biasa, EL membaca JavaBean property.

Expression:

```jsp
${user.name}
```

Biasanya setara dengan:

```java
user.getName()
```

Untuk boolean:

```jsp
${case.overdue}
```

bisa setara dengan:

```java
case.isOverdue()
```

atau:

```java
case.getOverdue()
```

tergantung property descriptor.

### 20.1 JavaBean Property Bukan Field Langsung

EL tidak sekadar membaca field:

```java
public class User {
    private String name;
}
```

Jika tidak ada getter:

```java
public String getName() {
    return name;
}
```

maka:

```jsp
${user.name}
```

bisa gagal.

### 20.2 Property Name Derivation

Getter:

```java
public String getReferenceNo()
```

Property EL:

```jsp
${case.referenceNo}
```

Boolean getter:

```java
public boolean isApproved()
```

Property EL:

```jsp
${case.approved}
```

Getter acronym kadang membingungkan:

```java
public String getURL()
```

Property bisa tidak seperti yang kamu duga tergantung JavaBeans introspection rule. Untuk maintainability, hindari property acronym aneh di view model.

Lebih baik:

```java
public String getUrl()
```

EL:

```jsp
${document.url}
```

---

## 21. CDI Bean Resolution

Dalam Jakarta EE modern, EL dapat menemukan CDI bean, terutama di Faces.

Bean:

```java
@Named
@RequestScoped
public class CasePage {
    public String getTitle() {
        return "Case Detail";
    }
}
```

Facelets:

```xhtml
<h1>#{casePage.title}</h1>
```

Nama default bean biasanya nama class dengan huruf pertama lowercase:

```text
CasePage → casePage
```

Bisa eksplisit:

```java
@Named("caseDetailPage")
@RequestScoped
public class CasePage {
}
```

View:

```xhtml
#{caseDetailPage.title}
```

### 21.1 Naming Collision

Hindari nama bean yang generik:

```java
@Named("user")
```

Karena bisa bertabrakan dengan request/session attribute `user`.

Lebih baik:

```java
@Named("currentUserPage")
@Named("caseDetailPage")
@Named("caseSearchPage")
```

Nama harus mencerminkan peran UI/application boundary.

---

## 22. Property Access: Dot vs Bracket

EL menyediakan dua bentuk akses property:

```jsp
${user.name}
```

```jsp
${user['name']}
```

Secara konseptual, keduanya mirip. Bracket lebih fleksibel.

### 22.1 Dot Syntax

Gunakan dot untuk property statis yang jelas:

```jsp
${caseDetail.referenceNo}
${caseDetail.status}
${caseDetail.assigneeName}
```

### 22.2 Bracket Syntax

Gunakan bracket untuk:

1. map key dengan karakter khusus;
2. dynamic property;
3. header name;
4. parameter name;
5. cookie lookup;
6. property yang tidak valid sebagai identifier dot.

Contoh:

```jsp
${header['User-Agent']}
${param['case-id']}
${labels[case.status]}
```

### 22.3 Dynamic Property Risk

Expression:

```jsp
${case[param.propertyName]}
```

berbahaya jika `propertyName` berasal dari user input.

Risiko:

1. data exposure;
2. unexpected method/property access;
3. confusing rendering;
4. hard-to-audit view behavior.

Untuk enterprise app, dynamic property access harus sangat dibatasi.

---

## 23. Null Handling

EL sering lebih toleran terhadap null dibanding Java biasa.

Jika:

```java
case.getAssignee() == null
```

Expression:

```jsp
${case.assignee.name}
```

bisa menghasilkan kosong/null daripada langsung `NullPointerException`, tergantung konteks dan operasi.

### 23.1 Ini Bisa Membantu

Untuk optional display:

```jsp
${case.assignee.name}
```

Jika assignee belum ada, halaman tidak selalu crash.

### 23.2 Ini Juga Bisa Menyembunyikan Bug

Jika field wajib hilang:

```jsp
${case.referenceNo}
```

lalu output kosong, user hanya melihat halaman aneh, bukan error jelas.

### 23.3 Best Practice

Untuk field wajib, siapkan view model yang eksplisit:

```java
public record CaseDetailView(
        String referenceNo,
        String status,
        String assigneeDisplayName
) {
    public CaseDetailView {
        Objects.requireNonNull(referenceNo, "referenceNo is required");
        Objects.requireNonNull(status, "status is required");
    }
}
```

Untuk optional field, tampilkan fallback:

```jsp
${empty case.assigneeName ? 'Unassigned' : case.assigneeName}
```

Namun jangan terlalu banyak fallback di view. Lebih baik view model menyediakan:

```java
public String getAssigneeLabel() {
    return assigneeName == null ? "Unassigned" : assigneeName;
}
```

View:

```jsp
${caseDetail.assigneeLabel}
```

---

## 24. Type Coercion

EL sering harus mengubah tipe.

Contoh:

```jsp
<c:if test="${caseCount > 0}">
```

Jika `caseCount` adalah `String "10"`, EL dapat mencoba mengubahnya menjadi number.

Contoh Faces:

```xhtml
<h:inputText value="#{caseForm.priorityLevel}" />
```

Jika property Java:

```java
private Integer priorityLevel;
```

submitted value dari browser adalah string, lalu harus dikonversi ke `Integer`.

### 24.1 Coercion Sering Membantu

Contoh:

```jsp
${param.page + 1}
```

Jika `param.page` adalah string `"2"`, hasil bisa `3`.

### 24.2 Coercion Bisa Mengejutkan

Contoh:

```jsp
${param.active == true}
```

Jika parameter:

```text
active=Y
```

hasilnya bisa tidak sesuai ekspektasi.

Lebih baik controller melakukan parsing eksplisit:

```java
boolean active = "Y".equals(request.getParameter("active"));
request.setAttribute("active", active);
```

View:

```jsp
${active}
```

### 24.3 Rule of Thumb

Jangan jadikan EL sebagai tempat parsing business input.

EL boleh melakukan coercion ringan untuk rendering. Untuk input/domain semantics, parsing dan validation harus dilakukan di controller/Faces converter/validator/service boundary.

---

## 25. Operator EL

EL menyediakan operator umum.

### 25.1 Arithmetic

```jsp
${total + tax}
${total - discount}
${price * quantity}
${amount / count}
${amount div count}
${amount % count}
${amount mod count}
```

Gunakan untuk display sederhana, bukan financial calculation penting.

Buruk:

```jsp
${invoice.subtotal * 0.11 + invoice.adminFee - invoice.discount}
```

Lebih baik:

```java
invoiceView.getGrandTotalDisplay()
```

View:

```jsp
${invoiceView.grandTotalDisplay}
```

### 25.2 Relational

```jsp
${score > 80}
${score ge 80}
${status == 'APPROVED'}
${status eq 'APPROVED'}
${status != 'REJECTED'}
${status ne 'REJECTED'}
```

### 25.3 Logical

```jsp
${case.overdue and case.assigned}
${case.closed or case.cancelled}
${not case.editable}
```

### 25.4 Empty

```jsp
${empty cases}
${not empty user.name}
```

`empty` biasanya true untuk:

1. null;
2. empty string;
3. empty collection;
4. empty map;
5. empty array.

### 25.5 Ternary

```jsp
${case.overdue ? 'Overdue' : 'On time'}
```

Gunakan untuk pilihan kecil. Jika logic panjang, pindahkan ke view model.

---

## 26. Reserved Words dan Naming

EL memiliki keyword/operator seperti:

```text
and, or, not, eq, ne, lt, gt, le, ge, true, false, null, empty, div, mod
```

Jangan membuat property atau map key yang membuat expression sulit dibaca.

Buruk:

```jsp
${case.empty}
${model['and']}
```

Bisa saja bekerja dengan bracket, tapi membingungkan.

Lebih baik rename view model property menjadi jelas:

```java
isEmptyResult()
hasNoItems()
```

---

## 27. FunctionMapper

`FunctionMapper` memetakan function dalam expression ke static Java method.

Contoh konsep:

```jsp
${fn:length(cases)}
```

Dalam JSTL, prefix `fn` biasanya menunjuk ke function library.

Function mapper menjawab:

```text
prefix + localName → Java Method
```

Misalnya:

```text
fn:length → public static int length(Object obj)
```

### 27.1 Kapan Function Berguna?

EL function berguna untuk operasi pure dan ringan:

1. string utility;
2. length;
3. escaping helper khusus;
4. formatting helper kecil;
5. permission label display;
6. code-to-label mapping sederhana.

### 27.2 Kapan Function Buruk?

Function buruk jika:

1. melakukan database query;
2. memanggil remote API;
3. melakukan authorization final;
4. mengubah state;
5. bergantung pada request mutable global;
6. melakukan business transaction.

Function harus dianggap seperti pure helper untuk view, bukan service layer.

---

## 28. VariableMapper

`VariableMapper` memetakan variable EL ke `ValueExpression` lain.

Secara sederhana:

```text
variable name → expression
```

Ini sering relevan pada tag files, Facelets, dan custom tag processing.

Contoh mental:

```text
item → #{caseList.currentItem}
```

Lalu expression di dalam fragment:

```xhtml
#{item.referenceNo}
```

sebenarnya dievaluasi melalui mapping tersebut.

### 28.1 Penting untuk Memahami Template Composition

Dalam layout/tag/component, variable sering “disuntikkan” ke fragment.

Jika kamu tidak memahami variable mapper, bug seperti ini terasa mistis:

1. variable tidak dikenal;
2. variable tertimpa;
3. nested include memakai variable yang salah;
4. fragment membaca object dari scope luar;
5. loop variable bocor secara mental walau tidak secara runtime.

---

## 29. Method Invocation dan Overload

EL dapat memanggil method, tetapi overload bisa membuat resolusi membingungkan.

Bean:

```java
public String label(Long id) { ... }
public String label(String code) { ... }
```

View:

```xhtml
#{caseBean.label(case.id)}
```

Jika `case.id` null atau tipe ambiguous, resolver harus memilih method.

### 29.1 Hindari Overload untuk Method yang Dipanggil dari EL

Lebih baik:

```java
public String labelById(Long id) { ... }
public String labelByCode(String code) { ... }
```

View:

```xhtml
#{caseBean.labelById(case.id)}
```

Tujuannya bukan karena overload selalu salah, tapi karena expression di view harus mudah diaudit.

---

## 30. Get, Set, Invoke: Tiga Operasi Besar ELResolver

Resolver tidak hanya membaca value.

Operasi penting:

1. `getValue`;
2. `setValue`;
3. `isReadOnly`;
4. `getType`;
5. `invoke`;
6. `convertToType` pada API modern.

### 30.1 `getValue`

Dipakai untuk expression read:

```jsp
${user.name}
```

### 30.2 `setValue`

Dipakai untuk two-way binding:

```xhtml
<h:inputText value="#{form.name}" />
```

Faces setelah conversion/validation dapat melakukan:

```text
set form.name = submittedValue
```

### 30.3 `isReadOnly`

Dipakai untuk mengecek apakah property boleh ditulis.

Jika property read-only, update model bisa gagal.

### 30.4 `getType`

Dipakai untuk mengetahui expected target type.

Contoh:

```java
private LocalDate dueDate;
```

Faces bisa tahu bahwa submitted string perlu dikonversi menjadi `LocalDate`, jika converter tersedia.

### 30.5 `invoke`

Dipakai untuk method expression:

```xhtml
#{bean.submit}
```

atau:

```xhtml
#{bean.submit(case.id)}
```

---

## 31. EL dan Java Records

Pada Java modern, view model sering enak ditulis sebagai record:

```java
public record CaseRowView(
        Long id,
        String referenceNo,
        String status,
        String assigneeName
) {}
```

EL:

```jsp
${caseRow.referenceNo}
${caseRow.status}
```

Record accessor:

```java
referenceNo()
```

bukan JavaBean getter tradisional:

```java
getReferenceNo()
```

Jakarta Expression Language 6.0/Jakarta EE 11 memasukkan dukungan modern untuk Java Records, sehingga model seperti ini makin relevan di runtime modern.

### 31.1 Compatibility Warning

Jika aplikasi masih Java EE 8 / JSP 2.x / EL lama, record accessor mungkin tidak dikenali sebagai property oleh EL lama.

Untuk kompatibilitas Java 8 legacy, gunakan JavaBean-style DTO:

```java
public class CaseRowView {
    private final String referenceNo;

    public String getReferenceNo() {
        return referenceNo;
    }
}
```

Untuk Jakarta EE 11+ dan Java 17+, record menjadi pilihan yang sangat baik untuk immutable view model.

---

## 32. EL dan `Optional`

EL modern memiliki support yang lebih baik untuk `Optional`, tetapi secara desain UI, jangan berlebihan mengekspos `Optional` ke view.

Buruk:

```java
public Optional<String> getAssigneeName() {
    return Optional.ofNullable(assigneeName);
}
```

View menjadi canggung:

```jsp
${case.assigneeName.orElse('Unassigned')}
```

Lebih baik view model menyediakan display-ready value:

```java
public String getAssigneeLabel() {
    return assigneeName == null ? "Unassigned" : assigneeName;
}
```

View:

```jsp
${case.assigneeLabel}
```

`Optional` bagus di service/domain boundary, tapi UI model sering lebih baik eksplisit dan display-oriented.

---

## 33. Expression Evaluation dan Side Effect

EL sebaiknya dianggap sebagai read/bind layer, bukan tempat side effect tersembunyi.

Buruk:

```xhtml
#{caseBean.loadCases()}
```

atau:

```jsp
${auditService.recordView(case.id)}
```

Masalah:

1. expression bisa dievaluasi lebih dari sekali;
2. refresh halaman bisa mengulang efek;
3. partial render bisa memicu side effect;
4. debugging sulit;
5. idempotency tidak jelas;
6. transaksi tidak jelas.

### 33.1 Side Effect yang Masuk Akal

Method expression untuk action memang boleh mengubah state:

```xhtml
<h:commandButton action="#{caseBean.approve}" />
```

Karena dipanggil sebagai action eksplisit user.

Yang buruk adalah side effect di getter/output expression.

Rule:

```text
Getter/value expression harus murah, deterministic, dan side-effect-free.
Action/method expression boleh melakukan mutation jika memang action user.
```

---

## 34. EL Dalam JSP: Contoh End-to-End

Controller:

```java
public class CaseDetailServlet extends HttpServlet {
    private CaseQueryService caseQueryService;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        long caseId = Long.parseLong(request.getParameter("id"));
        CaseDetailView view = caseQueryService.getCaseDetail(caseId);

        request.setAttribute("caseDetail", view);
        request.getRequestDispatcher("/WEB-INF/views/case-detail.jsp")
                .forward(request, response);
    }
}
```

View model:

```java
public class CaseDetailView {
    private final String referenceNo;
    private final String status;
    private final String assigneeLabel;
    private final boolean overdue;
    private final boolean canApprove;

    public CaseDetailView(
            String referenceNo,
            String status,
            String assigneeLabel,
            boolean overdue,
            boolean canApprove) {
        this.referenceNo = referenceNo;
        this.status = status;
        this.assigneeLabel = assigneeLabel;
        this.overdue = overdue;
        this.canApprove = canApprove;
    }

    public String getReferenceNo() {
        return referenceNo;
    }

    public String getStatus() {
        return status;
    }

    public String getAssigneeLabel() {
        return assigneeLabel;
    }

    public boolean isOverdue() {
        return overdue;
    }

    public boolean isCanApprove() {
        return canApprove;
    }
}
```

JSP:

```jsp
<h1>Case ${caseDetail.referenceNo}</h1>

<p>Status: ${caseDetail.status}</p>
<p>Assignee: ${caseDetail.assigneeLabel}</p>

<c:if test="${caseDetail.overdue}">
    <span class="badge badge-danger">Overdue</span>
</c:if>

<c:if test="${caseDetail.canApprove}">
    <form method="post" action="${pageContext.request.contextPath}/cases/approve">
        <input type="hidden" name="id" value="${param.id}" />
        <button type="submit">Approve</button>
    </form>
</c:if>
```

### 34.1 Evaluation Mental Model

Expression:

```jsp
${caseDetail.referenceNo}
```

Langkah:

```text
base=null, property=caseDetail
  → scoped attribute resolver finds request attribute caseDetail
base=CaseDetailView, property=referenceNo
  → bean resolver calls getReferenceNo()
return String
```

Expression:

```jsp
${caseDetail.overdue}
```

Langkah:

```text
base=null, property=caseDetail
  → request attribute
base=CaseDetailView, property=overdue
  → bean resolver calls isOverdue()
return boolean
```

Expression:

```jsp
${param.id}
```

Langkah:

```text
base=null, property=param
  → implicit object resolver returns request parameter map
base=paramMap, property=id
  → map resolver returns request parameter value
return String
```

### 34.2 Security Warning

Jangan menganggap hidden input aman:

```jsp
<input type="hidden" name="id" value="${param.id}" />
```

User bisa mengubahnya.

Server action tetap harus:

1. validate ID;
2. check authorization;
3. check current state;
4. check optimistic locking;
5. reject invalid transition.

EL hanya rendering, bukan trust boundary.

---

## 35. EL Dalam Faces: Contoh End-to-End

Facelets:

```xhtml
<h:form id="caseForm">
    <h:outputText value="Reference No" />
    <h:outputText value="#{casePage.referenceNo}" />

    <h:outputText value="Decision" />
    <h:selectOneMenu value="#{casePage.decision}">
        <f:selectItem itemValue="APPROVE" itemLabel="Approve" />
        <f:selectItem itemValue="REJECT" itemLabel="Reject" />
    </h:selectOneMenu>

    <h:commandButton value="Submit" action="#{casePage.submit}" />
</h:form>
```

Backing bean:

```java
@Named
@ViewScoped
public class CasePage implements Serializable {
    private String referenceNo;
    private String decision;

    @Inject
    private CaseCommandService caseCommandService;

    @PostConstruct
    public void init() {
        this.referenceNo = "CASE-2026-001";
    }

    public String getReferenceNo() {
        return referenceNo;
    }

    public String getDecision() {
        return decision;
    }

    public void setDecision(String decision) {
        this.decision = decision;
    }

    public String submit() {
        caseCommandService.submitDecision(referenceNo, decision);
        return "case-detail?faces-redirect=true";
    }
}
```

### 35.1 Evaluation Saat Render

```xhtml
#{casePage.referenceNo}
```

Langkah:

```text
resolve casePage as CDI bean
call getReferenceNo()
render value
```

```xhtml
#{casePage.decision}
```

Saat render select:

```text
resolve casePage
call getDecision()
mark selected value
```

### 35.2 Evaluation Saat Postback

Browser submit:

```text
decision=APPROVE
```

Faces lifecycle:

```text
restore view
apply request values
process validations
update model values
invoke application
render response
```

Pada update model:

```text
resolve casePage
call setDecision("APPROVE")
```

Pada invoke application:

```text
resolve casePage
invoke submit()
```

### 35.3 Bug Umum

Jika setter tidak ada:

```java
public String getDecision() {
    return decision;
}
```

Tapi tidak ada:

```java
public void setDecision(String decision)
```

Maka model tidak bisa diupdate.

Symptom:

1. action terpanggil tapi value null;
2. validation aneh;
3. UI tetap menampilkan value lama;
4. error property not writable.

---

## 36. EL dan Getter Cost

Karena getter bisa dipanggil berkali-kali, getter harus murah.

Buruk:

```java
public List<CaseRow> getCases() {
    return caseRepository.findCasesForCurrentUser();
}
```

Jika table punya banyak render pass, ini bisa memicu query berkali-kali.

Lebih baik:

```java
private List<CaseRow> cases;

@PostConstruct
public void init() {
    this.cases = caseRepository.findCasesForCurrentUser();
}

public List<CaseRow> getCases() {
    return cases;
}
```

Untuk refresh:

```java
public void refresh() {
    this.cases = caseRepository.findCasesForCurrentUser();
}
```

View action eksplisit:

```xhtml
<h:commandButton value="Refresh" action="#{caseSearchPage.refresh}" />
```

---

## 37. EL dan Authorization

EL sering dipakai untuk conditional rendering:

```jsp
<c:if test="${caseDetail.canApprove}">
    <button>Approve</button>
</c:if>
```

atau Faces:

```xhtml
<h:commandButton value="Approve"
                 action="#{casePage.approve}"
                 rendered="#{casePage.canApprove}" />
```

Ini berguna untuk UX, tetapi bukan security final.

### 37.1 Rule Penting

```text
rendered=false menyembunyikan tombol, bukan melindungi action.
```

Server action tetap harus check authorization:

```java
public String approve() {
    authorizationService.requireCanApprove(caseId, currentUser);
    caseService.approve(caseId, currentUser);
    return "detail?faces-redirect=true";
}
```

EL membantu presentasi. Authorization tetap harus ada di command boundary.

---

## 38. EL dan XSS

Expression output tidak otomatis selalu aman untuk semua context.

JSP:

```jsp
${userInput}
```

Tergantung container/settings/tag, output ini bisa tidak melakukan escaping seperti yang kamu kira.

Lebih aman menggunakan output tag yang jelas:

```jsp
<c:out value="${userInput}" />
```

Namun `c:out` melakukan XML/HTML escaping dasar. Itu tidak cukup untuk semua konteks.

### 38.1 Context-Sensitive Escaping

HTML body:

```html
<p>USER_INPUT</p>
```

HTML attribute:

```html
<input value="USER_INPUT">
```

JavaScript string:

```html
<script>
  const name = "USER_INPUT";
</script>
```

URL:

```html
<a href="/search?q=USER_INPUT">
```

CSS:

```html
<style>
  .x { background-image: url(USER_INPUT); }
</style>
```

Masing-masing butuh escaping/encoding berbeda.

### 38.2 Rule

Jangan memasukkan data user langsung ke JavaScript/CSS/context sensitif dengan EL biasa.

Siapkan encoder yang tepat atau hindari inline script.

---

## 39. EL Injection

EL injection terjadi ketika attacker bisa mengontrol expression, bukan hanya value.

Aman:

```jsp
${user.name}
```

dan `user.name` berasal dari user input sebagai data.

Berbahaya:

```java
String expression = request.getParameter("expr");
ValueExpression ve = factory.createValueExpression(elContext, expression, Object.class);
Object result = ve.getValue(elContext);
```

Jika user mengirim:

```text
${someBean.dangerousMethod()}
```

maka expression bisa memanggil hal yang tidak diinginkan, tergantung resolver dan exposure.

### 39.1 Rule

Jangan evaluate expression yang berasal dari user input.

Jika perlu dynamic template, buat DSL terbatas, bukan raw EL.

---

## 40. Debugging EL: Cara Berpikir Sistematis

Ketika expression gagal:

```jsp
${case.assignee.name}
```

jangan langsung menebak. Pecah chain-nya.

### 40.1 Langkah Debug

1. Apakah variable pertama ada?

```jsp
case = ${case}
```

2. Apakah property pertama ada?

```jsp
assignee = ${case.assignee}
```

3. Apakah property berikutnya ada?

```jsp
assignee name = ${case.assignee.name}
```

4. Apakah scope benar?

```jsp
request = ${requestScope.case}
session = ${sessionScope.case}
```

5. Apakah getter ada?

```java
getAssignee()
getName()
```

6. Apakah object null?

7. Apakah nama property typo?

8. Apakah ada naming collision?

9. Apakah bean CDI ditemukan?

10. Apakah dependency `javax`/`jakarta` tercampur?

### 40.2 Error Patterns

| Symptom | Kemungkinan Penyebab |
|---|---|
| output kosong | null, property tidak ada, scope salah |
| property not found | getter tidak ada, typo, wrong object type |
| method not found | signature mismatch, overload ambiguous, parameter type salah |
| value tidak update di Faces | setter tidak ada, validation gagal, component tidak dieksekusi |
| action tidak terpanggil | validation failure, wrong form, lifecycle short-circuit, rendered/disabled |
| CDI bean tidak ketemu | bean discovery, missing `@Named`, namespace mismatch, scope issue |
| class cast error | mixing `javax.el` and `jakarta.el` |

---

## 41. EL Design Rules untuk Engineer Senior

### 41.1 View Harus Membaca View Model, Bukan Domain Berat

Buruk:

```jsp
${case.customer.primaryAddress.country.region.taxPolicy.rate}
```

Lebih baik:

```jsp
${caseView.taxRateLabel}
```

Karena view tidak perlu tahu object graph domain.

### 41.2 Getter Tidak Boleh Query Database

Buruk:

```java
public int getOverdueCount() {
    return repository.countOverdue();
}
```

Lebih baik:

```java
private int overdueCount;
```

### 41.3 EL Tidak Boleh Menjadi Policy Engine Final

Buruk:

```jsp
<c:if test="${user.role == 'ADMIN' or case.ownerId == user.id}">
```

Lebih baik:

```jsp
<c:if test="${caseView.canEdit}">
```

Dan command tetap melakukan authorization ulang.

### 41.4 Hindari Service Call di EL

Buruk:

```jsp
${caseService.findStatusLabel(case.status)}
```

Lebih baik:

```jsp
${caseView.statusLabel}
```

### 41.5 Buat Expression Pendek

Jika expression sulit dibaca, itu sinyal view model kurang matang.

Buruk:

```jsp
${not empty case.assignee and case.status ne 'CLOSED' and user.department == case.department and user.grade ge 5}
```

Lebih baik:

```jsp
${caseView.canReassign}
```

---

## 42. Advanced Mental Model: EL Sebagai Adapter dari Banyak Object Model

EL menyatukan banyak object model:

```text
request attributes
session attributes
application attributes
maps
lists
arrays
JavaBeans
records
resource bundles
CDI beans
custom resolvers
functions
method references
```

Satu syntax:

```text
x.y[z].method(a)
```

bisa berarti hal berbeda tergantung runtime object.

Itulah kekuatan sekaligus bahayanya.

Kekuatan:

1. view sederhana;
2. binding fleksibel;
3. framework integration mudah;
4. reusable component/tag lebih deklaratif.

Bahaya:

1. hidden resolution;
2. ambiguous names;
3. runtime-only errors;
4. security exposure;
5. performance surprise;
6. weak compile-time safety.

Engineer top-tier tidak hanya tahu syntax EL. Ia tahu bagaimana menjaga agar fleksibilitas EL tidak berubah menjadi unbounded coupling.

---

## 43. Mini Case Study: Regulatory Case Detail Page

Misal halaman detail enforcement case membutuhkan:

1. reference number;
2. status label;
3. assigned officer;
4. overdue badge;
5. allowed actions;
6. next escalation date;
7. last audit activity.

### 43.1 Desain Buruk

JSP:

```jsp
<h1>${case.referenceNo}</h1>
<p>${case.status.code}</p>
<p>${case.assignee.profile.fullName}</p>
<p>${caseService.calculateOverdue(case)}</p>
<p>${auditService.findLastActivity(case.id).description}</p>

<c:if test="${user.role == 'SENIOR_OFFICER' and case.status.code != 'CLOSED'}">
    <button>Approve</button>
</c:if>
```

Masalah:

1. view menyentuh domain graph;
2. view memanggil service;
3. view melakukan policy logic;
4. view bisa memicu query;
5. sulit dites;
6. sulit diamankan;
7. sulit dimigrasi ke Faces/SPA.

### 43.2 Desain Baik

View model:

```java
public record CaseDetailView(
        Long caseId,
        String referenceNo,
        String statusLabel,
        String assigneeLabel,
        boolean overdue,
        String nextEscalationDateLabel,
        String lastActivityLabel,
        boolean canApprove,
        boolean canReassign,
        boolean canClose
) {}
```

JSP:

```jsp
<h1>${caseDetail.referenceNo}</h1>
<p>Status: ${caseDetail.statusLabel}</p>
<p>Assignee: ${caseDetail.assigneeLabel}</p>
<p>Next escalation: ${caseDetail.nextEscalationDateLabel}</p>
<p>Last activity: ${caseDetail.lastActivityLabel}</p>

<c:if test="${caseDetail.overdue}">
    <span class="badge badge-danger">Overdue</span>
</c:if>

<c:if test="${caseDetail.canApprove}">
    <button type="submit" name="action" value="APPROVE">Approve</button>
</c:if>
```

Benefits:

1. EL pendek;
2. view hanya rendering;
3. policy dihitung server-side;
4. action tetap authorize ulang;
5. mudah dites;
6. mudah migrate;
7. UI contract jelas.

---

## 44. Checklist Desain EL yang Baik

Gunakan checklist ini saat review JSP/Faces:

1. Apakah expression pendek dan jelas?
2. Apakah expression membaca view model, bukan domain graph dalam?
3. Apakah getter side-effect-free?
4. Apakah getter tidak query DB/API?
5. Apakah nama attribute/bean tidak generik?
6. Apakah scope eksplisit jika ada collision risk?
7. Apakah hidden field tidak dipercaya server?
8. Apakah rendered/conditional button bukan satu-satunya authorization?
9. Apakah output user input di-escape sesuai konteks?
10. Apakah tidak ada raw user-controlled EL evaluation?
11. Apakah method expression tidak ambiguous karena overload?
12. Apakah Faces property punya getter/setter sesuai kebutuhan?
13. Apakah expression tidak terlalu bergantung pada object graph lazy-loading?
14. Apakah dependency `javax.el` dan `jakarta.el` tidak tercampur?
15. Apakah migration Java 8 → 17/21/25 mempertimbangkan record/EL support?

---

## 45. Ringkasan

EL adalah fondasi binding antara view dan application model.

Yang perlu diingat:

1. `${...}` biasanya immediate dan sering dipakai di JSP/JSTL.
2. `#{...}` biasanya deferred dan sangat penting di Faces.
3. Value expression merepresentasikan nilai.
4. Method expression merepresentasikan method yang bisa dipanggil.
5. `ELContext` adalah environment evaluasi.
6. `ExpressionFactory` membuat expression object.
7. `ELResolver` adalah rantai resolver yang menentukan cara variable/property/method diselesaikan.
8. Dot dan bracket syntax sama-sama property access, tetapi bracket lebih fleksibel.
9. Null handling dan coercion membantu, tapi bisa menyembunyikan bug.
10. Getter harus murah dan tanpa side effect.
11. EL tidak boleh menjadi tempat business logic, query, authorization final, atau policy engine.
12. Untuk enterprise system, EL terbaik adalah EL yang membaca view model eksplisit.

Mental model paling penting:

```text
EL expression bukan magic.
Ia adalah pipeline: parse → context → resolver chain → get/set/invoke → coercion → result.
```

Jika kamu memahami pipeline ini, bug EL/JSP/Faces menjadi jauh lebih mudah dibaca.

---

## 46. Latihan Praktis

### Latihan 1 — Pecah Resolver Chain

Untuk expression:

```jsp
${case.assignee.department.name}
```

Tuliskan langkah resolver:

```text
base=null, property=?
base=?, property=?
base=?, property=?
base=?, property=?
```

Lalu identifikasi titik null yang mungkin.

### Latihan 2 — Refactor Expression Panjang

Refactor expression berikut:

```jsp
${not empty case.assignee and case.status ne 'CLOSED' and currentUser.departmentId == case.departmentId and currentUser.grade ge 5}
```

Menjadi property view model yang lebih baik.

### Latihan 3 — Cari Side Effect

Review backing bean berikut:

```java
public List<CaseRow> getRows() {
    auditService.recordView("case-search");
    return caseRepository.search(criteria);
}
```

Jelaskan semua masalahnya.

### Latihan 4 — Scope Collision

Jika request dan session sama-sama punya attribute `user`, apa risiko dari:

```jsp
${user.name}
```

Kapan harus memakai:

```jsp
${requestScope.user.name}
${sessionScope.user.name}
```

### Latihan 5 — Faces Two-Way Binding

Untuk component:

```xhtml
<h:inputText value="#{form.dueDate}" />
```

Jelaskan:

1. kapan getter dipanggil;
2. kapan setter dipanggil;
3. kapan converter dibutuhkan;
4. apa yang terjadi jika validation gagal.

---

## 47. Koneksi ke Part Berikutnya

Part ini membangun fondasi EL fundamental.

Part berikutnya akan masuk ke:

```text
06-advanced-el-custom-functions-resolvers-security-performance.md
```

Fokus berikutnya:

1. custom EL functions;
2. function registration via TLD;
3. custom `ELResolver`;
4. resolver ordering;
5. CDI integration lebih dalam;
6. EL injection;
7. performance expression evaluation;
8. debugging resolver custom;
9. desain expression surface yang aman untuk enterprise platform.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 4 — Request, Session, Application Scope: View Data Flow and State Boundaries](./04-request-session-application-scope-view-data-flow.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 6 — Advanced Expression Language: Custom Functions, Custom Resolvers, Security, and Performance](./06-advanced-el-custom-functions-resolvers-security-performance.md)
