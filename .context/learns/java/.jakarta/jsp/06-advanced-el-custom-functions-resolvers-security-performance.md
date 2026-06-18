# Part 6 — Advanced Expression Language: Custom Functions, Custom Resolvers, Security, and Performance

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `06-advanced-el-custom-functions-resolvers-security-performance.md`  
> Target: Java 8 sampai Java 25, Java EE/Jakarta EE legacy sampai Jakarta EE modern  
> Fokus: menguasai Jakarta Expression Language pada level extension, security boundary, runtime behavior, dan performance engineering.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membangun fondasi Jakarta Expression Language: value expression, method expression, resolver chain, implicit object, coercion, dan perbedaan `${...}` vs `#{...}`.

Bagian ini naik satu level lebih dalam. Targetnya bukan hanya bisa menulis:

```jsp
${case.status}
```

atau:

```xhtml
#{caseBean.submit}
```

melainkan memahami bagaimana EL bisa diperluas, dikontrol, diamankan, dan dioptimalkan pada aplikasi enterprise.

Setelah menyelesaikan bagian ini, kita harus mampu:

1. Membuat custom EL function yang aman dan reusable.
2. Memahami bagaimana function registration bekerja melalui TLD/taglib metadata.
3. Mendesain custom `ELResolver` untuk use case enterprise tanpa merusak semantics EL.
4. Menentukan kapan perlu custom resolver dan kapan itu overengineering.
5. Memahami risiko EL injection dan kenapa user input tidak boleh dievaluasi sebagai expression.
6. Memisahkan authorization, masking, formatting, dan binding logic secara benar.
7. Mengidentifikasi performance cost dari EL resolution, reflection, method invocation, dan resolver chain.
8. Membuat debugging strategy untuk expression yang gagal resolve.
9. Mendesain “safe expression surface” untuk platform rule/configuration engine.
10. Menghindari jebakan umum ketika EL dipakai di JSP, JSTL, Facelets, dan Jakarta Faces.

---

## 1. Posisi Advanced EL dalam Arsitektur Web Java

EL adalah jembatan antara view layer dan object model.

Dalam JSP/Jakarta Pages, EL biasanya dipakai untuk membaca data:

```jsp
<c:out value="${caseView.referenceNo}" />
```

Dalam Jakarta Faces, EL jauh lebih aktif karena dipakai untuk binding component ke backing bean:

```xhtml
<h:inputText value="#{caseEditBean.caseTitle}" />
<h:commandButton value="Submit" action="#{caseEditBean.submit}" />
```

Secara mental model:

```text
View Template
    |
    | expression string
    v
ExpressionFactory
    |
    | parsed expression object
    v
ELContext
    |
    | resolver chain + function mapper + variable mapper
    v
Object Graph / CDI Beans / Scoped Attributes
```

EL terlihat sederhana karena syntax-nya pendek. Namun di belakangnya ada beberapa mekanisme besar:

1. Parsing expression string.
2. Resolving base object.
3. Resolving property atau method.
4. Coercing type.
5. Calling getter/setter/method.
6. Handling null, exception, dan conversion.
7. Integrating dengan framework seperti JSP, JSTL, CDI, dan Faces.

Advanced EL berarti kita mulai masuk ke titik-titik ekstensi:

```text
ExpressionFactory
ELContext
ELResolver
FunctionMapper
VariableMapper
TypeConverter
MethodExpression
ValueExpression
```

Dalam aplikasi biasa, kita jarang perlu menyentuh semuanya. Dalam platform besar, terutama case management, low-code workflow, regulatory rules, dynamic forms, configurable dashboard, dan authorization-driven UI, titik-titik ini sering menjadi penting.

---

## 2. Prinsip Utama: EL Itu Binding Layer, Bukan Business Logic Layer

Sebelum masuk custom function dan resolver, prinsip ini harus dikunci.

EL seharusnya menjadi layer tipis untuk:

1. Membaca properti yang sudah disiapkan.
2. Memanggil action method yang jelas.
3. Mengakses helper formatting yang kecil.
4. Menghubungkan component dengan backing bean.
5. Mengekspresikan kondisi tampilan sederhana.

EL tidak seharusnya menjadi tempat:

1. Business rule kompleks.
2. Authorization final decision.
3. Query database.
4. Mutasi state tersembunyi.
5. Loop/filter/sort besar.
6. Integrasi remote service.
7. Parsing configuration dari user input.

Contoh EL yang masih wajar:

```jsp
${caseView.overdue}
${caseView.assignedToCurrentUser}
${caseView.statusLabel}
```

Contoh EL yang mulai berbahaya:

```jsp
${caseService.findOpenCasesByOfficer(currentUser.id).stream().filter(...).toList()}
```

Masalahnya bukan hanya performance. Masalah utamanya adalah boundary arsitektur hilang.

View menjadi tahu service, query, filtering, dan domain rule. Ketika terjadi bug, kita tidak lagi punya alur sederhana:

```text
Controller prepares model -> View renders model
```

melainkan:

```text
View secretly calls service -> service hits DB -> output depends on render path
```

Ini buruk untuk testing, observability, auditability, dan security.

Rule praktis:

> Jika expression butuh lebih dari membaca/memformat/memanggil action sederhana, pindahkan logic ke controller, backing bean, view model, formatter, converter, validator, atau service layer.

---

## 3. Custom EL Function: Apa dan Kapan Dipakai

Custom EL function adalah static Java method yang diekspos ke EL dengan prefix taglib.

Contoh penggunaan:

```jsp
${sec:maskNric(person.nric)}
${text:truncate(caseView.description, 80)}
${datefmt:formatInstant(caseView.createdAt, 'dd MMM yyyy HH:mm')}
```

Custom function cocok untuk logic yang:

1. Pure function.
2. Tidak punya side effect.
3. Tidak perlu request mutation.
4. Tidak melakukan database call.
5. Tidak bergantung pada mutable global state.
6. Reusable di banyak halaman.
7. Sifatnya formatting, masking, sanitizing, lightweight decision, atau utility.

Contoh kandidat yang baik:

| Use Case | Cocok sebagai EL Function? | Alasan |
|---|---:|---|
| Masking identifier | Ya | Pure transformation |
| Format reference number | Ya | Deterministic formatting |
| Truncate text | Ya | Pure view helper |
| Check string blank | Ya | Simple utility |
| Calculate SLA label dari prepared DTO | Mungkin | Oke jika input sudah siap dan rule sederhana |
| Query case by ID | Tidak | View memanggil persistence/service |
| Check final authorization | Tidak | Authorization harus enforced di backend/action boundary |
| Submit workflow transition | Tidak | Side effect besar |
| Send email | Tidak | Side effect dan integration |

---

## 4. Membuat Custom EL Function untuk JSP/Jakarta Pages

Misalnya kita ingin membuat function masking untuk identifier sensitif.

### 4.1 Java Utility Class

Untuk era `javax.*` dan `jakarta.*`, Java utility class-nya tetap Java biasa.

```java
package com.example.web.el;

public final class MaskingFunctions {

    private MaskingFunctions() {
    }

    public static String maskIdentifier(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }

        String normalized = value.trim();
        int length = normalized.length();

        if (length <= 4) {
            return "****";
        }

        String lastFour = normalized.substring(length - 4);
        return "****" + lastFour;
    }
}
```

Catatan Java 8:

`String#isBlank()` baru ada sejak Java 11. Jika target runtime masih Java 8, gunakan:

```java
if (value == null || value.trim().isEmpty()) {
    return "";
}
```

Agar library kompatibel Java 8–25, jangan sembarang memakai API baru kecuali memang source/target sudah dinaikkan.

### 4.2 TLD File

Di JSP/Jakarta Pages, function biasanya diregistrasi lewat Tag Library Descriptor.

Contoh file:

```text
src/main/webapp/WEB-INF/tlds/app-functions.tld
```

Untuk Jakarta-era modern, contoh bentuk konseptualnya:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<taglib
    xmlns="https://jakarta.ee/xml/ns/jakartaee"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-jsptaglibrary_3_1.xsd"
    version="3.1">

    <tlib-version>1.0</tlib-version>
    <short-name>app</short-name>
    <uri>http://example.com/tags/app</uri>

    <function>
        <name>maskIdentifier</name>
        <function-class>com.example.web.el.MaskingFunctions</function-class>
        <function-signature>
            java.lang.String maskIdentifier(java.lang.String)
        </function-signature>
    </function>

</taglib>
```

Lalu di JSP:

```jsp
<%@ taglib prefix="app" uri="http://example.com/tags/app" %>

<span>${app:maskIdentifier(person.identifier)}</span>
```

Catatan penting:

1. URI taglib bukan harus URL yang bisa dibuka browser.
2. URI adalah identifier logical untuk mapping tag library.
3. File TLD biasanya diletakkan di `/WEB-INF` atau dikemas di JAR.
4. Container akan membaca TLD saat deployment/translation.

---

## 5. Function Signature: Jangan Anggap “Java Method Biasa” Saja

EL function harus punya signature yang bisa ditemukan oleh container.

Contoh valid:

```java
public static String truncate(String input, int maxLength)
```

TLD:

```xml
<function-signature>
    java.lang.String truncate(java.lang.String, int)
</function-signature>
```

Pemanggilan:

```jsp
${text:truncate(caseView.description, 120)}
```

Jebakan umum:

1. Method tidak `public`.
2. Method tidak `static`.
3. Signature di TLD tidak sama dengan method Java.
4. Package/class salah.
5. Overloaded methods membingungkan.
6. Primitive/wrapper mismatch dalam beberapa container/version.
7. Function punya side effect.
8. Function melempar exception yang tidak dipahami view.

Rekomendasi:

1. Hindari overload untuk EL function.
2. Gunakan tipe parameter sederhana.
3. Buat function deterministic.
4. Return string/boolean/number sederhana.
5. Tangani null dengan eksplisit.
6. Jangan lempar exception untuk input kosong yang biasa terjadi di view.

---

## 6. Custom Function untuk Formatting: Baik, Tapi Jangan Mengulang `fmt:*`

JSTL sudah punya `fmt:formatDate`, `fmt:formatNumber`, dan resource bundle support. Jangan membuat custom function hanya karena belum tahu tag standar.

Namun custom function berguna saat formatting punya domain rule.

Contoh regulatory case reference:

```java
public final class CaseFormatFunctions {

    private CaseFormatFunctions() {
    }

    public static String caseSeverityBadge(String severity) {
        if (severity == null || severity.isBlank()) {
            return "unknown";
        }

        return switch (severity.toUpperCase()) {
            case "HIGH", "CRITICAL" -> "danger";
            case "MEDIUM" -> "warning";
            case "LOW" -> "neutral";
            default -> "unknown";
        };
    }
}
```

Untuk Java 8 compatible, jangan pakai switch expression:

```java
public static String caseSeverityBadge(String severity) {
    if (severity == null || severity.trim().isEmpty()) {
        return "unknown";
    }

    switch (severity.toUpperCase()) {
        case "HIGH":
        case "CRITICAL":
            return "danger";
        case "MEDIUM":
            return "warning";
        case "LOW":
            return "neutral";
        default:
            return "unknown";
    }
}
```

JSP:

```jsp
<span class="badge badge-${casefmt:caseSeverityBadge(caseView.severity)}">
    <c:out value="${caseView.severityLabel}" />
</span>
```

Perhatikan boundary:

- Function hanya menentukan CSS class dari value yang sudah ada.
- Function tidak menghitung severity dari database.
- Function tidak menentukan apakah user boleh melihat case.
- Function tidak mengubah state.

---

## 7. Custom Function untuk Security Masking: Hati-Hati dengan False Sense of Security

Masking di view berguna, tetapi bukan authorization.

Contoh:

```jsp
${sec:maskIdentifier(person.nric)}
```

Ini hanya mengubah output tampilan. Jika object `person` masih membawa full identifier ke view, berarti data sensitif sudah sampai ke rendering layer.

Untuk data sangat sensitif, masking sebaiknya dilakukan lebih awal:

```text
Database Entity
    -> Service applies authorization/data minimization
    -> ViewModel contains masked or permitted field only
    -> JSP renders safe field
```

Lebih aman:

```java
public final class PersonView {
    private final String displayIdentifier;

    public PersonView(String displayIdentifier) {
        this.displayIdentifier = displayIdentifier;
    }

    public String getDisplayIdentifier() {
        return displayIdentifier;
    }
}
```

JSP:

```jsp
<c:out value="${personView.displayIdentifier}" />
```

Custom function masking masih berguna untuk convenience, tetapi jangan jadikan itu satu-satunya kontrol keamanan.

Rule:

> Masking function adalah presentation helper. Data minimization adalah service/security responsibility.

---

## 8. Function Mapper: Apa Perannya?

Di API EL, `FunctionMapper` bertugas memetakan prefix dan local function name ke Java `Method`.

Secara konseptual:

```text
Expression: ${text:truncate(case.description, 120)}

prefix = text
localName = truncate

FunctionMapper.resolveFunction("text", "truncate")
    -> java.lang.reflect.Method
```

Dalam JSP, biasanya kita tidak membuat `FunctionMapper` sendiri karena container membangunnya dari TLD.

Namun memahami `FunctionMapper` penting karena:

1. Function bukan magic.
2. Function berakhir sebagai reflective method invocation.
3. Jika mapping salah, expression gagal saat parsing/evaluation.
4. Dalam standalone EL usage, kita bisa menyediakan mapper sendiri.

Contoh standalone mental model:

```java
ExpressionFactory factory = ExpressionFactory.newInstance();
ELContext context = new StandardELContext(factory);

// Secara advanced, context dapat diberi FunctionMapper custom.
ValueExpression expression = factory.createValueExpression(
        context,
        "${text:truncate(description, 20)}",
        String.class
);
```

Dalam aplikasi web biasa, gunakan TLD/taglib. Jangan membuat manual `FunctionMapper` kecuali sedang membangun expression engine sendiri.

---

## 9. Variable Mapper: Alias Expression, Bukan Scope Attribute Biasa

`VariableMapper` memetakan nama variable ke `ValueExpression`.

Ini berbeda dari request/session attribute.

Request attribute:

```java
request.setAttribute("caseView", caseView);
```

EL:

```jsp
${caseView.title}
```

Variable mapper lebih dekat ke compile/evaluation-time alias:

```text
name -> ValueExpression
```

Dalam JSP/Facelets, variable mapper banyak dipakai oleh engine/framework untuk tag files, Facelets templating, composite components, dan internal aliasing.

Sebagai application developer, kita lebih sering memakai:

```jsp
<c:set var="displayStatus" value="${caseView.statusLabel}" />
```

atau di Facelets:

```xhtml
<ui:param name="pageTitle" value="Case Detail" />
```

Namun mental model-nya penting:

1. Tidak semua variable EL berasal dari scope map.
2. Sebagian variable bisa berasal dari template/tag context.
3. Shadowing bisa terjadi.
4. Debugging variable resolution harus melihat scope, tag, template, dan component context.

---

## 10. Custom ELResolver: Pintu Ekstensi yang Sangat Kuat

`ELResolver` adalah mekanisme yang menentukan bagaimana expression seperti ini diselesaikan:

```jsp
${caseView.status.label}
```

Secara konseptual resolver chain melakukan:

```text
Resolve base null + property 'caseView'
    -> find scoped attribute / CDI bean / implicit object
Resolve base caseView + property 'status'
    -> bean getter / map / custom resolver
Resolve base status + property 'label'
    -> bean getter / enum helper / custom resolver
```

Custom resolver memungkinkan kita menambahkan behavior baru.

Contoh use case:

1. Dynamic dictionary lookup:

```jsp
${dict['CASE_STATUS'][caseView.status]}
```

2. Feature flag lookup:

```jsp
${feature['newCaseDashboard']}
```

3. Permission expression:

```xhtml
rendered="#{perm['case.close']}"
```

4. Tenant configuration:

```jsp
${tenantConfig['ui.logoUrl']}
```

5. Localization/domain label lookup:

```jsp
${label['case.status.OPEN']}
```

Namun custom resolver bisa menjadi sumber kekacauan jika dipakai berlebihan.

---

## 11. Cara Kerja `ELResolver`: `propertyResolved` adalah Kunci

Contract penting `ELResolver`:

1. Resolver menerima `ELContext`, `base`, dan `property`.
2. Jika resolver bisa menangani property, ia mengembalikan value.
3. Resolver harus menandai `context.setPropertyResolved(true)`.
4. Jika tidak bisa menangani, jangan set resolved dan biarkan resolver berikutnya mencoba.

Pseudo-code:

```java
public Object getValue(ELContext context, Object base, Object property) {
    if (canResolve(base, property)) {
        context.setPropertyResolved(true);
        return resolvedValue;
    }

    return null;
}
```

Ini krusial. `null` bisa berarti dua hal:

1. Resolver tidak menangani property.
2. Resolver menangani property dan value-nya memang null.

Yang membedakan adalah `propertyResolved`.

Jika resolver mengembalikan null tapi tidak set `propertyResolved`, resolver berikutnya masih akan dicoba.

Jika resolver mengembalikan null dan set `propertyResolved(true)`, proses berhenti.

---

## 12. Contoh Custom Resolver: Feature Flag Resolver

Misalnya kita ingin EL:

```jsp
${feature['new-dashboard']}
```

atau:

```xhtml
<h:panelGroup rendered="#{feature['advancedSearch']}">
    ...
</h:panelGroup>
```

Kita bisa mendesain object khusus:

```java
public interface FeatureFlagService {
    boolean isEnabled(String featureName);
}
```

Lalu resolver:

```java
import jakarta.el.ELContext;
import jakarta.el.ELResolver;
import java.beans.FeatureDescriptor;
import java.util.Iterator;

public class FeatureFlagELResolver extends ELResolver {

    private final FeatureFlagService featureFlagService;

    public FeatureFlagELResolver(FeatureFlagService featureFlagService) {
        this.featureFlagService = featureFlagService;
    }

    @Override
    public Object getValue(ELContext context, Object base, Object property) {
        if (base == null && "feature".equals(property)) {
            context.setPropertyResolved(true);
            return new FeatureAccessor(featureFlagService);
        }

        if (base instanceof FeatureAccessor && property != null) {
            context.setPropertyResolved(true);
            return ((FeatureAccessor) base).isEnabled(property.toString());
        }

        return null;
    }

    @Override
    public Class<?> getType(ELContext context, Object base, Object property) {
        if (base instanceof FeatureAccessor) {
            context.setPropertyResolved(true);
            return Boolean.class;
        }
        return null;
    }

    @Override
    public void setValue(ELContext context, Object base, Object property, Object value) {
        if (base instanceof FeatureAccessor) {
            context.setPropertyResolved(true);
            throw new UnsupportedOperationException("Feature flags are read-only in EL");
        }
    }

    @Override
    public boolean isReadOnly(ELContext context, Object base, Object property) {
        if (base instanceof FeatureAccessor) {
            context.setPropertyResolved(true);
            return true;
        }
        return false;
    }

    @Override
    public Iterator<FeatureDescriptor> getFeatureDescriptors(ELContext context, Object base) {
        return null;
    }

    @Override
    public Class<?> getCommonPropertyType(ELContext context, Object base) {
        if (base instanceof FeatureAccessor) {
            return String.class;
        }
        return null;
    }

    public static final class FeatureAccessor {
        private final FeatureFlagService service;

        private FeatureAccessor(FeatureFlagService service) {
            this.service = service;
        }

        public boolean isEnabled(String featureName) {
            return service.isEnabled(featureName);
        }
    }
}
```

Important design choices:

1. Root symbol `feature` is explicit.
2. Resolver only handles its own namespace.
3. It is read-only.
4. It does not hijack all string property access.
5. It does not mutate state.

---

## 13. Registering Custom Resolver

Cara registrasi tergantung environment.

Dalam standalone EL:

```java
ExpressionFactory factory = ExpressionFactory.newInstance();
StandardELContext context = new StandardELContext(factory);
context.addELResolver(new FeatureFlagELResolver(featureFlagService));
```

Dalam Jakarta Faces, custom resolver biasanya didaftarkan melalui `faces-config.xml`:

```xml
<faces-config
    xmlns="https://jakarta.ee/xml/ns/jakartaee"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-facesconfig_4_1.xsd"
    version="4.1">

    <application>
        <el-resolver>com.example.web.el.FeatureFlagELResolver</el-resolver>
    </application>

</faces-config>
```

Namun resolver yang butuh service injection harus dirancang hati-hati. Bergantung pada container dan integrasi CDI, instantiation bisa tidak sesederhana constructor injection.

Alternatif yang sering lebih aman:

1. Gunakan CDI bean biasa:

```java
@Named("feature")
@RequestScoped
public class FeatureBean {
    @Inject
    FeatureFlagService featureFlagService;

    public boolean isEnabled(String name) {
        return featureFlagService.isEnabled(name);
    }
}
```

EL:

```xhtml
rendered="#{feature.isEnabled('advancedSearch')}"
```

2. Gunakan view model property:

```java
public boolean isAdvancedSearchEnabled() {
    return advancedSearchEnabled;
}
```

EL:

```xhtml
rendered="#{caseSearchView.advancedSearchEnabled}"
```

Kapan custom resolver layak?

Jika kita membutuhkan semantic namespace lintas aplikasi, misalnya:

```text
feature['x']
perm['y']
dict['group']['key']
tenant['config.key']
```

Kapan tidak layak?

Jika hanya ingin memanggil satu service method dari satu halaman.

---

## 14. Resolver Design Rules: Jangan Merusak Dunia

Custom `ELResolver` adalah global-ish extension point. Salah desain bisa merusak semua expression.

Rule penting:

### 14.1 Jangan Ambil Semua `base == null`

Buruk:

```java
if (base == null) {
    context.setPropertyResolved(true);
    return resolveAnything(property);
}
```

Ini akan mengganggu implicit object, scoped attributes, CDI beans, dan resolver lain.

Lebih baik:

```java
if (base == null && "feature".equals(property)) {
    context.setPropertyResolved(true);
    return featureAccessor;
}
```

### 14.2 Jangan Ambil Semua Property dari Semua Object

Buruk:

```java
if (property != null) {
    context.setPropertyResolved(true);
    return resolve(property.toString());
}
```

Ini bisa membuat:

```jsp
${caseView.status}
```

berhenti di resolver custom padahal seharusnya BeanELResolver yang menangani.

### 14.3 Resolver Harus Narrow dan Predictable

Resolver yang baik punya namespace jelas:

```jsp
${dict['case.status.OPEN']}
${feature['x']}
${perm['case.approve']}
```

Resolver yang buruk membuat expression ambigu:

```jsp
${OPEN}
${APPROVE}
${someRandomName}
```

### 14.4 Read-only by Default

View expression sebaiknya tidak menulis state melalui resolver custom.

Jika resolver hanya untuk lookup, `setValue()` sebaiknya menolak mutation.

### 14.5 Jangan Query DB Per Property

Ini sangat berbahaya:

```jsp
<c:forEach items="${cases}" var="case">
    ${dict[case.status]}
</c:forEach>
```

Jika `dict[...]` query database per call, halaman list 100 rows bisa menghasilkan 100 query.

Gunakan cache/request preloading.

---

## 15. Permission Resolver: Menarik Tapi Berbahaya

Banyak aplikasi enterprise ingin menulis:

```xhtml
<h:commandButton
    value="Approve"
    action="#{caseActionBean.approve}"
    rendered="#{perm['case.approve']}" />
```

Ini nyaman, tetapi harus dipahami:

```text
rendered=false hides button
not equal to action cannot be executed
```

UI-level permission hanya untuk user experience. Authorization final harus tetap di action/service boundary.

Arsitektur aman:

```text
Permission Resolver / ViewModel
    -> controls visibility only

Action Method
    -> checks permission again

Service Layer
    -> checks business authorization/invariant again

Database/Domain Transition
    -> enforces state transition rule
```

Contoh action method:

```java
public String approve() {
    authorizationService.requirePermission(currentUser, "case.approve", caseId);
    caseWorkflowService.approve(caseId, currentUser);
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

Permission resolver boleh membantu rendering, tapi tidak boleh menjadi satu-satunya pagar.

---

## 16. Dictionary/Label Resolver: Use Case yang Bagus

Contoh:

```jsp
${dict['case.status'][caseView.status]}
```

atau lebih sederhana:

```jsp
${dict:label('case.status', caseView.status)}
```

Mana yang lebih baik?

Untuk JSP biasa, custom function sering cukup:

```jsp
${dict:label('case.status', caseView.status)}
```

Untuk Faces atau platform yang punya semantic namespace, resolver bisa lebih expressive:

```xhtml
#{dict['case.status'][case.status]}
```

Namun perhatikan:

1. Label lookup harus cache-aware.
2. Locale harus jelas.
3. Missing key harus punya fallback.
4. Jangan throw exception untuk missing display label di production page kecuali memang policy-nya strict.
5. Jangan expose internal code mentah jika sensitive.

Design fallback:

```text
label found      -> localized label
label not found  -> [UNKNOWN: group.code] in non-prod
label not found  -> safe fallback label in prod
```

---

## 17. EL Injection: Risiko Paling Serius pada Advanced EL

EL injection terjadi ketika string dari user/config tidak dipercaya dievaluasi sebagai expression.

Contoh berbahaya:

```java
String userInput = request.getParameter("expr");
ValueExpression ve = expressionFactory.createValueExpression(context, "${" + userInput + "}", Object.class);
Object result = ve.getValue(context);
```

Jika user bisa mengontrol expression, ia bisa mencoba mengakses object, method, property, atau operasi yang tidak dimaksudkan.

Bahkan jika tidak langsung RCE, EL injection bisa menyebabkan:

1. Data exposure.
2. Authorization bypass jika expression dipakai untuk rule.
3. Method invocation tak diinginkan.
4. Denial of service lewat expression berat.
5. Logic manipulation.
6. Access ke implicit objects atau scoped objects.

Rule keras:

> Jangan pernah mengevaluasi user input sebagai EL expression kecuali kamu sedang membangun rule engine yang secara eksplisit didesain dengan sandbox, whitelist, audit, dan batasan resource.

---

## 18. Dynamic Expression dari Database: Platform Trap

Dalam aplikasi enterprise, kadang ada kebutuhan:

```text
Admin configures visibility rule:
case.status == 'OPEN' and user.role == 'SUPERVISOR'
```

Lalu developer tergoda menyimpan rule sebagai EL:

```text
#{case.status == 'OPEN' and currentUser.role == 'SUPERVISOR'}
```

Kemudian saat runtime:

```java
ExpressionFactory.createValueExpression(context, configuredRule, Boolean.class)
```

Ini bukan selalu salah, tetapi masuk kategori platform-level design, bukan JSP trick.

Jika ingin melakukan ini dengan aman, minimal perlu:

1. Whitelist variable yang boleh diakses.
2. Whitelist property yang boleh dibaca.
3. Larangan method invocation kecuali fungsi aman tertentu.
4. Larangan akses implicit object seperti request/session/application jika tidak perlu.
5. Timeout atau complexity limit.
6. Audit trail rule evaluation.
7. Versioning rule.
8. Test harness untuk rule.
9. Safe failure policy.
10. Non-prod validation tool.
11. Access control untuk siapa yang boleh mengubah rule.
12. Rule preview dan explanation.

Jika tidak punya semua itu, jangan gunakan EL sebagai dynamic rule engine.

Lebih aman:

1. Buat DSL kecil yang terbatas.
2. Gunakan decision table.
3. Gunakan enum-based rule definition.
4. Gunakan workflow engine/DMN jika memang kompleks.
5. Compile rule menjadi typed predicate di backend.

---

## 19. Safe Expression Surface: Desain untuk Platform Internal

Misalnya kita membangun configurable UI rule:

```text
Show “Escalate” button if:
- case status is OPEN
- SLA breach risk is HIGH
- user has supervisor role
```

Jangan expose seluruh object:

```text
caseEntity
userEntity
request
session
service
repository
```

Expose surface terbatas:

```java
public final class CaseRuleContext {
    private final String status;
    private final String slaRisk;
    private final Set<String> userCapabilities;

    public String getStatus() { return status; }
    public String getSlaRisk() { return slaRisk; }
    public boolean hasCapability(String capability) {
        return userCapabilities.contains(capability);
    }
}
```

Expression yang diizinkan:

```text
status == 'OPEN' and slaRisk == 'HIGH' and hasCapability('CASE_ESCALATE')
```

Lebih ketat lagi, tidak pakai EL langsung. Buat DSL:

```json
{
  "all": [
    { "field": "status", "eq": "OPEN" },
    { "field": "slaRisk", "eq": "HIGH" },
    { "capability": "CASE_ESCALATE" }
  ]
}
```

Keuntungan DSL:

1. Bisa divalidasi.
2. Bisa diaudit.
3. Bisa dijelaskan.
4. Bisa dibatasi.
5. Tidak membuka arbitrary Java method/property.

EL bagus untuk view binding. Untuk configurable decisioning, EL harus diperlakukan sebagai power tool dengan guardrail.

---

## 20. Method Invocation Security

EL modern mendukung method expressions dan method invocation dalam berbagai konteks.

Di Faces, ini normal:

```xhtml
<h:commandButton action="#{caseBean.submit}" />
```

Namun method invocation dari expression yang uncontrolled berisiko.

Masalahnya:

1. Method bisa punya side effect.
2. Method bisa mahal.
3. Method bisa melempar exception.
4. Method bisa mengakses data yang tidak boleh.
5. Method bisa dipanggil berkali-kali oleh render lifecycle.

Contoh buruk:

```xhtml
rendered="#{caseBean.recalculateAndCheckVisible()}"
```

Jika `rendered` dievaluasi beberapa kali, state bisa berubah beberapa kali.

Lebih baik:

```java
public boolean isEscalateVisible() {
    return escalateVisible;
}
```

EL:

```xhtml
rendered="#{caseBean.escalateVisible}"
```

Jika perlu menghitung:

```java
@PostConstruct
public void init() {
    this.escalateVisible = authorizationService.canEscalate(user, caseId)
            && caseService.isEscalationCandidate(caseId);
}
```

Rule:

> Method yang dipanggil oleh render-time expression harus idempotent, cheap, dan side-effect free.

---

## 21. Output Escaping: EL Tidak Otomatis Menyelesaikan XSS

EL hanya menghasilkan value. Escaping tergantung konteks output.

Contoh JSP berbahaya:

```jsp
${caseView.description}
```

Jika description berisi:

```html
<script>alert(1)</script>
```

maka output bisa menjadi HTML aktif tergantung container/tag/context.

Lebih aman:

```jsp
<c:out value="${caseView.description}" />
```

Namun `c:out` melakukan HTML/XML escaping umum, bukan JavaScript escaping, CSS escaping, atau URL component encoding.

Konteks berbeda butuh encoding berbeda:

| Output Context | Encoding yang Dibutuhkan |
|---|---|
| HTML text | HTML escape |
| HTML attribute | HTML attribute escape |
| JavaScript string | JavaScript string escape |
| URL query parameter | URL encode |
| CSS value | CSS escape / avoid dynamic CSS |
| JSON embedded in HTML | JSON encoding + script-safe escaping |

Contoh berbahaya:

```jsp
<script>
  const caseTitle = '${caseView.title}';
</script>
```

Walaupun `caseView.title` sudah HTML-escaped, itu belum tentu aman untuk JavaScript string context.

Lebih baik:

1. Hindari inline script berisi data user.
2. Render data sebagai JSON dengan encoder yang benar.
3. Gunakan `data-*` attribute dengan attribute escaping.
4. Fetch data dari API jika kompleks.

---

## 22. EL Function untuk Escaping: Jangan Sembarangan

Tergoda membuat:

```jsp
${esc:html(caseView.description)}
```

Ini bisa berguna, tetapi bisa membuat developer bingung:

1. Kapan pakai `c:out`?
2. Kapan pakai `esc:html`?
3. Apakah output double-escaped?
4. Apakah function benar untuk attribute?
5. Apakah function benar untuk JavaScript?

Lebih baik punya convention jelas:

```text
HTML text output       -> c:out
URL parameter          -> c:url / encoder
JavaScript data        -> JSON encoder, not manual string concat
Raw trusted HTML       -> explicitly named trustedHtml with review
```

Jika membuat escape functions, nama harus spesifik:

```jsp
${esc:htmlText(value)}
${esc:htmlAttribute(value)}
${esc:jsString(value)}
${esc:urlComponent(value)}
```

Jangan buat nama generik:

```jsp
${esc:safe(value)}
```

“safe” untuk konteks apa?

---

## 23. Performance Model EL

EL performance cost biasanya kecil dibanding DB/network, tetapi bisa signifikan pada halaman besar.

Cost utama:

1. Parsing expression string.
2. Building expression object.
3. Resolver chain traversal.
4. Reflection/property descriptor lookup.
5. Method invocation.
6. Type coercion.
7. Custom function call.
8. Custom resolver lookup.
9. Repeated evaluation in loops/components.
10. Side-effect service calls hidden behind getters.

JSP/Facelets engine biasanya cache compiled artifacts/expression. Namun evaluation tetap terjadi saat request/render.

Contoh mahal:

```jsp
<c:forEach items="${cases}" var="case">
    ${case.assignee.department.organization.region.name}
</c:forEach>
```

Jika `assignee`, `department`, `organization`, atau `region` lazy-loaded dari ORM, rendering bisa memicu N+1 query.

EL tidak tahu bahwa getter mahal.

Rule:

> Getter yang dipakai view harus dianggap render-time path. Jangan biarkan getter melakukan DB, remote call, heavy computation, atau mutation.

---

## 24. Getter Harus Murah dan Aman

Dalam JavaBeans, EL property access:

```jsp
${caseView.statusLabel}
```

biasanya memanggil:

```java
getStatusLabel()
```

Maka ini buruk:

```java
public String getStatusLabel() {
    return dictionaryService.findStatusLabel(status); // DB call every render
}
```

Lebih baik:

```java
public final class CaseView {
    private final String status;
    private final String statusLabel;

    public String getStatus() {
        return status;
    }

    public String getStatusLabel() {
        return statusLabel;
    }
}
```

Service menyiapkan view model:

```java
public CaseView toView(CaseEntity entity, Locale locale) {
    return new CaseView(
        entity.getStatus(),
        dictionary.label("case.status", entity.getStatus(), locale)
    );
}
```

Untuk list page, batch prefetch:

```java
Map<String, String> statusLabels = dictionary.labels("case.status", locale);
```

lalu mapping ke DTO.

---

## 25. Resolver Chain Performance

Setiap property resolution bisa melewati beberapa resolver.

Simplified chain:

```text
CompositeELResolver
  -> ImplicitObjectELResolver
  -> ScopedAttributeELResolver
  -> CDI/BeanName resolver
  -> MapELResolver
  -> ListELResolver
  -> ArrayELResolver
  -> BeanELResolver
  -> Custom resolvers depending on environment
```

Jika custom resolver terlalu luas, setiap expression akan membayar cost tambahan.

Buruk:

```java
public Object getValue(ELContext context, Object base, Object property) {
    expensiveLog.debug(...);
    expensiveLookup(...);
    return null;
}
```

Karena resolver dipanggil banyak kali bahkan untuk expression yang bukan miliknya.

Baik:

```java
if (base == null && "dict".equals(property)) {
    context.setPropertyResolved(true);
    return dictionaryAccessor;
}
return null;
```

Early exit harus sangat murah.

---

## 26. Function Performance: Pure Bukan Berarti Gratis

Function seperti ini aman tapi bisa mahal jika dipanggil ribuan kali:

```jsp
${datefmt:formatInstant(row.createdAt, userLocale)}
```

Jika function membuat `DateTimeFormatter` baru setiap call:

```java
DateTimeFormatter.ofPattern(pattern).withLocale(locale).format(value)
```

pada table besar, overhead bisa terasa.

Optimization:

1. Cache formatter jika pattern/locale finite.
2. Pre-format di view model jika list sangat besar.
3. Hindari formatting kompleks di nested loops.
4. Jangan memanggil remote/i18n service dari function.
5. Ukur sebelum over-optimize.

Contoh safe cache:

```java
private static final ConcurrentMap<String, DateTimeFormatter> FORMATTERS = new ConcurrentHashMap<>();

public static String formatDate(LocalDate date, String pattern, Locale locale) {
    if (date == null) {
        return "";
    }

    String key = pattern + "|" + locale.toLanguageTag();
    DateTimeFormatter formatter = FORMATTERS.computeIfAbsent(
        key,
        ignored -> DateTimeFormatter.ofPattern(pattern, locale)
    );

    return formatter.format(date);
}
```

Tapi hati-hati:

1. Cache key tidak boleh unbounded dari user input bebas.
2. Pattern dari user bisa menyebabkan cache growth.
3. Gunakan whitelist pattern untuk production.

---

## 27. EL di Loop: Multiplicative Cost

Contoh:

```jsp
<c:forEach items="${caseList}" var="case">
    <tr>
        <td>${case.referenceNo}</td>
        <td>${dict:label('case.status', case.status)}</td>
        <td>${datefmt:format(case.createdAt)}</td>
        <td>${perm:canView(case.id) ? 'Yes' : 'No'}</td>
    </tr>
</c:forEach>
```

Jika `caseList` berisi 500 row, setiap function dipanggil 500 kali.

Masalah paling serius:

```jsp
${perm:canView(case.id)}
```

Jika function call masuk DB/service, halaman akan menjadi lambat dan sulit diprediksi.

Lebih baik:

```java
public final class CaseRowView {
    private String referenceNo;
    private String statusLabel;
    private String createdAtLabel;
    private boolean viewAllowed;
}
```

JSP:

```jsp
<c:forEach items="${caseList}" var="case">
    <tr>
        <td><c:out value="${case.referenceNo}" /></td>
        <td><c:out value="${case.statusLabel}" /></td>
        <td><c:out value="${case.createdAtLabel}" /></td>
        <td><c:out value="${case.viewAllowed ? 'Yes' : 'No'}" /></td>
    </tr>
</c:forEach>
```

Trade-off:

- View model lebih verbose.
- Tapi performance, testing, dan auditability lebih baik.

---

## 28. Debugging EL Resolution

Ketika expression gagal:

```jsp
${caseView.officer.name}
```

Kemungkinan penyebab:

1. `caseView` tidak ada di scope.
2. `caseView` ada tapi null.
3. `getOfficer()` tidak ada.
4. `getOfficer()` return null.
5. `getName()` tidak ada.
6. Getter melempar exception.
7. Property shadowed oleh variable lain.
8. Custom resolver mengintervensi.
9. CDI bean name berbeda.
10. Case sensitivity salah.
11. Method/property overloaded ambiguity.
12. Bean tidak public atau getter tidak public.

Debugging checklist:

1. Pastikan attribute diset di controller:

```java
request.setAttribute("caseView", caseView);
```

2. Pastikan nama sama persis:

```jsp
${caseView}
```

3. Test bertahap:

```jsp
${caseView}
${caseView.officer}
${caseView.officer.name}
```

4. Cek generated servlet/log.
5. Cek getter JavaBeans naming.
6. Cek scope collision:

```jsp
${requestScope.caseView}
${sessionScope.caseView}
```

7. Temporarily log object preparation di controller.
8. Jangan debug dengan menampilkan data sensitif di production.

---

## 29. JavaBeans Naming Edge Cases

EL bean property mengikuti JavaBeans conventions.

Expression:

```jsp
${user.active}
```

bisa resolve ke:

```java
public boolean isActive()
```

atau:

```java
public Boolean getActive()
```

Jebakan:

```java
public boolean getisActive() // salah style
```

Acronym edge case:

```java
public String getURL()
```

Property name bisa menjadi `URL`, bukan `url`, tergantung introspection rule.

Lebih baik:

```java
public String getUrl()
```

Untuk DTO/view model, gunakan naming yang sederhana dan predictable.

---

## 30. Null Handling: Jangan Biarkan EL Menyembunyikan Domain Bug

EL sering terlihat toleran terhadap null. Ini bagus untuk rendering sederhana, tetapi bisa menyembunyikan bug.

Contoh:

```jsp
${caseView.assignee.name}
```

Jika `assignee` null, beberapa konteks dapat menghasilkan empty output, bukan error yang jelas.

Untuk UI, mungkin acceptable. Untuk domain invariant, ini berbahaya.

Jika case wajib punya assignee, null harus ditangkap sebelum view:

```java
if (caseEntity.getAssignee() == null) {
    throw new IllegalStateException("Assigned case has no assignee: " + caseId);
}
```

Atau view model explicitly represent optionality:

```java
private final boolean assigned;
private final String assigneeName;
```

JSP:

```jsp
<c:choose>
    <c:when test="${caseView.assigned}">
        <c:out value="${caseView.assigneeName}" />
    </c:when>
    <c:otherwise>
        <span class="muted">Unassigned</span>
    </c:otherwise>
</c:choose>
```

Rule:

> Null yang punya makna bisnis harus dimodelkan eksplisit, bukan diserahkan ke EL.

---

## 31. Custom Resolver dan CDI: Jangan Melawan Framework

Di Jakarta EE modern, CDI sudah menjadi model dependency injection utama.

Banyak hal yang dulu perlu custom resolver sekarang bisa dilakukan dengan CDI bean:

```java
@Named("labels")
@RequestScoped
public class LabelBean {
    @Inject
    LabelService labelService;

    public String status(String code) {
        return labelService.label("case.status", code);
    }
}
```

Facelets:

```xhtml
#{labels.status(case.status)}
```

Kapan ini cukup?

1. Logic sederhana.
2. Dependency injection dibutuhkan.
3. Expression tidak perlu map-like syntax.
4. Scope lifecycle penting.
5. Testing CDI bean lebih mudah.

Custom resolver lebih cocok jika:

1. Ingin root namespace khusus.
2. Ingin property access dynamic.
3. Ingin generic resolution semantics.
4. Ingin platform-level feature.
5. Ingin integrasi expression engine custom.

Jangan membuat custom resolver hanya karena ingin “terlihat advanced”. Top engineer justru menghindari extension point global jika solusi lokal cukup.

---

## 32. Jakarta Faces: EL Evaluation Timing Lebih Kompleks

Dalam JSP, banyak EL dievaluasi saat rendering request.

Dalam Faces, expression bisa dievaluasi di beberapa fase lifecycle:

1. Restore View.
2. Apply Request Values.
3. Process Validations.
4. Update Model Values.
5. Invoke Application.
6. Render Response.

Contoh:

```xhtml
<h:inputText value="#{caseEditBean.title}" />
```

Expression ini dipakai untuk:

1. Membaca value saat render.
2. Menulis submitted/converted value saat update model.
3. Menentukan type target.
4. Berinteraksi dengan converter/validator.

Maka getter/setter harus benar.

Buruk:

```java
public String getTitle() {
    return service.reload(caseId).getTitle();
}

public void setTitle(String title) {
    service.updateTitle(caseId, title);
}
```

Ini membuat render dan model update memicu service call tak terkendali.

Lebih baik:

```java
@Named
@ViewScoped
public class CaseEditBean implements Serializable {
    private String title;

    @PostConstruct
    public void init() {
        this.title = service.load(caseId).getTitle();
    }

    public String save() {
        service.updateTitle(caseId, title);
        return "case-detail?faces-redirect=true";
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }
}
```

---

## 33. JSTL vs Faces Tags: Evaluation Timing Trap

Di Facelets, penggunaan JSTL tags seperti `c:if` dan `c:forEach` bisa membingungkan karena tag handler dieksekusi pada waktu build view, bukan selalu sama dengan component render lifecycle.

Contoh yang sering bermasalah:

```xhtml
<c:if test="#{bean.showAdvanced}">
    <h:inputText value="#{bean.advancedValue}" />
</c:if>
```

Dalam Faces, sering lebih baik:

```xhtml
<h:panelGroup rendered="#{bean.showAdvanced}">
    <h:inputText value="#{bean.advancedValue}" />
</h:panelGroup>
```

Kenapa?

- `c:if` memutus apakah component dibuat dalam tree.
- `rendered` memutus apakah component dirender, tetapi component tetap bagian dari component tree.
- Ini berdampak ke postback, validation, state, dan ajax update.

Untuk iteration:

```xhtml
<c:forEach items="#{bean.rows}" var="row">
    <h:inputText value="#{row.name}" />
</c:forEach>
```

sering lebih problematik daripada component iteration seperti `ui:repeat` atau data component.

Rule:

> Dalam Faces, gunakan component-aware constructs untuk UI component lifecycle. JSTL cocok untuk build-time templating terbatas, bukan dynamic component lifecycle yang kompleks.

---

## 34. Advanced EL dan Authorization-Aware UI

Sering ada expression:

```jsp
<c:if test="${currentUser.admin}">
    <a href="/admin">Admin</a>
</c:if>
```

Ini boleh untuk visibility, tapi harus dibedakan:

```text
Visibility decision = what user sees
Authorization decision = what user can do
```

Button/link hilang bukan security control.

Serangan sederhana:

1. User menebak URL.
2. User mengirim POST manual.
3. User memodifikasi hidden field.
4. User replay request lama.
5. User memanggil endpoint langsung.

Maka setiap action tetap harus check permission.

Pattern yang baik:

```java
public final class CaseActionView {
    private final boolean approveVisible;
    private final boolean rejectVisible;
    private final boolean assignVisible;

    // getters only
}
```

View:

```jsp
<c:if test="${caseActionView.approveVisible}">
    <button type="submit" name="action" value="approve">Approve</button>
</c:if>
```

Controller:

```java
if ("approve".equals(action)) {
    authorization.require("CASE_APPROVE", caseId);
    workflow.approve(caseId, currentUser);
}
```

View visibility improves UX. Backend authorization protects system invariants.

---

## 35. Advanced EL dan Auditability

Dalam regulatory systems, UI decisions sering harus dijelaskan:

1. Kenapa tombol approve muncul?
2. Kenapa field tidak editable?
3. Kenapa user hanya melihat subset data?
4. Kenapa transition ditolak?
5. Kenapa label/status berubah?

Jika logic tersebar di EL:

```jsp
<c:if test="${case.status == 'OPEN' and user.supervisor and case.slaRisk == 'HIGH' and not case.locked}">
```

Maka explanation sulit.

Lebih baik:

```java
ActionAvailability availability = actionPolicy.evaluate(caseId, user);
```

View:

```jsp
<c:if test="${availability.approveAvailable}">
    ...
</c:if>
```

Audit/explanation:

```java
availability.reasonCodes();
```

Contoh reason codes:

```text
CASE_STATUS_OPEN
USER_HAS_SUPERVISOR_ROLE
SLA_RISK_HIGH
CASE_NOT_LOCKED
```

EL menjadi konsumen dari keputusan, bukan tempat keputusan besar dibuat.

---

## 36. Advanced EL Error Handling

EL evaluation bisa gagal karena:

1. Property not found.
2. Method not found.
3. Method invocation exception.
4. Type coercion failure.
5. Null base.
6. Function not found.
7. Resolver exception.
8. Security manager/reflective access issue pada environment lama.
9. Classloading issue.
10. Namespace mismatch `javax` vs `jakarta`.

Strategi error handling:

### 36.1 Fail Fast untuk Developer Error

Misalnya function tidak ditemukan:

```jsp
${casefmt:unknownFunction(case.status)}
```

Ini sebaiknya fail saat development/testing.

### 36.2 Safe Fallback untuk User Data Issue

Misalnya label dictionary missing:

```jsp
${dict:label('case.status', case.status)}
```

Production bisa fallback ke:

```text
Unknown status
```

Tapi tetap log structured warning:

```json
{
  "event": "DICTIONARY_LABEL_MISSING",
  "group": "case.status",
  "code": "PENDING_SUPERVISOR_REVIEW"
}
```

### 36.3 Jangan Tampilkan Stack Trace di View

Error page harus aman:

```text
Something went wrong. Reference ID: ABC-123
```

Log backend menyimpan detail.

---

## 37. Observability untuk EL-heavy Pages

Jika halaman banyak memakai EL custom function/resolver, observability penting.

Yang bisa diukur:

1. Request render duration.
2. Number of rows rendered.
3. View model preparation time.
4. Dictionary lookup count.
5. Permission check count.
6. Custom resolver hit count.
7. Missing label count.
8. View state size untuk Faces.
9. HTML payload size.
10. Error count by expression/function/resolver.

Jangan log setiap EL property access di production karena akan sangat noisy.

Lebih baik agregasi:

```text
page=/case/list
rows=100
viewModelMs=42
renderMs=88
dictLookupCount=5
permissionBatchMs=12
missingLabels=0
```

Untuk resolver, buat early-exit counter hanya jika diperlukan dan sampling.

---

## 38. Caching Strategy untuk EL Helper

Ada beberapa level caching:

### 38.1 Request-Level Cache

Cocok untuk data yang dipakai berulang dalam satu request:

```text
status code -> label
permission key -> boolean
feature flag -> boolean
```

Keuntungan:

- Tidak stale antar request.
- Mengurangi repeated lookup dalam page render.
- Aman untuk user-specific data.

### 38.2 Session-Level Cache

Harus hati-hati. Cocok untuk user preference kecil:

```text
locale
selected theme
small capability summary
```

Risiko:

- stale permission,
- memory bloat,
- replication overhead,
- logout/session invalidation complexity.

### 38.3 Application-Level Cache

Cocok untuk reference data global:

```text
status label dictionary
country code
static feature metadata
```

Risiko:

- invalidation,
- tenant-specific leakage,
- locale dimension,
- memory growth.

### 38.4 Distributed Cache

Cocok jika data shared lintas node:

```text
dictionary
feature flag snapshot
configuration
```

Namun untuk render path, distributed cache call tetap network call. Jangan lakukan per row/per property.

---

## 39. Batch, Jangan Per-Expression

Buruk:

```jsp
<c:forEach items="${cases}" var="case">
    ${perm:can('viewSensitiveData', case.id)}
</c:forEach>
```

Baik:

```java
Map<Long, Boolean> permissionByCaseId = permissionService.batchCan(
    currentUser,
    "viewSensitiveData",
    caseIds
);
```

Lalu build row view:

```java
row.setSensitiveDataVisible(permissionByCaseId.get(caseId));
```

JSP:

```jsp
<c:if test="${row.sensitiveDataVisible}">
    ...
</c:if>
```

Top engineer melihat render page sebagai batch pipeline:

```text
Collect ids -> batch load -> batch authorize -> build DTO -> render simple view
```

Bukan:

```text
Render row -> call service -> render field -> call service -> render next row
```

---

## 40. EL and Java 8–25 Compatibility Notes

EL itself is specification-level. Namun Java version mempengaruhi helper implementation.

### 40.1 Java 8

Gunakan:

```java
value == null || value.trim().isEmpty()
```

Hindari:

```java
value.isBlank()
```

Tidak ada records, switch expression, text blocks, pattern matching.

### 40.2 Java 11

Mulai bisa pakai:

```java
String#isBlank
String#strip
```

Namun Jakarta EE 9/10/11 migration tetap tergantung container.

### 40.3 Java 17

Baseline penting karena Jakarta EE 11 minimum Java SE 17.

Bisa mulai mempertimbangkan:

1. Records untuk immutable view model.
2. Sealed classes untuk rule result modeling.
3. Switch expression.

Namun perhatikan framework binding: JavaBeans-style getter masih lebih kompatibel untuk EL.

Record:

```java
public record CaseView(String referenceNo, String statusLabel) {}
```

EL access terhadap records tergantung support/introspection behavior pada implementation/version. Untuk kompatibilitas luas, DTO JavaBeans klasik masih paling aman.

### 40.4 Java 21

Virtual threads berdampak pada request handling di server/container jika didukung, tetapi tidak membuat EL expression boleh melakukan blocking call sembarangan.

Virtual thread mengurangi cost blocking thread, bukan menghapus cost DB/network.

### 40.5 Java 25

Sebagai runtime modern, Java 25 membawa platform terbaru, tetapi prinsip EL tidak berubah: getter harus murah, expression harus jelas, dan side effect harus dijaga.

---

## 41. `javax.el` vs `jakarta.el`

Legacy Java EE/Jakarta EE 8:

```java
import javax.el.ELResolver;
import javax.el.ELContext;
```

Jakarta EE 9+:

```java
import jakarta.el.ELResolver;
import jakarta.el.ELContext;
```

Migration risk:

1. Custom resolver masih import `javax.el`.
2. Library lama membawa `javax.el-api`.
3. Container modern menyediakan `jakarta.el`.
4. Mixed dependency menyebabkan class mismatch.
5. TLD/schema/taglib config masih versi lama.
6. Faces implementation dan EL implementation tidak aligned.

Rule:

> Dalam Jakarta EE 9+, semua API web-tier harus konsisten `jakarta.*`. Jangan mencampur `javax.el` artifact dengan Jakarta container modern.

---

## 42. Packaging Custom EL Functions and Tags

Untuk aplikasi besar, custom functions sebaiknya tidak tercecer.

Struktur yang baik:

```text
web-ui-common/
  src/main/java/com/example/web/el/TextFunctions.java
  src/main/java/com/example/web/el/MaskingFunctions.java
  src/main/java/com/example/web/el/DateFunctions.java
  src/main/resources/META-INF/app-functions.tld
```

Lalu module web memakai dependency:

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>web-ui-common</artifactId>
    <version>1.0.0</version>
</dependency>
```

Keuntungan:

1. Reusable.
2. Versioned.
3. Bisa dites unit.
4. Bisa direview security.
5. Tidak copy-paste function antar aplikasi.

Namun hindari membuat “god EL function library” berisi semua hal.

Pisahkan:

```text
text functions
masking functions
date/time functions
domain label functions
security display helper
```

---

## 43. Unit Testing Custom EL Functions

Function pure mudah dites.

```java
class MaskingFunctionsTest {

    @Test
    void masksIdentifierKeepingLastFourCharacters() {
        assertEquals("****1234", MaskingFunctions.maskIdentifier("S1234567A1234"));
    }

    @Test
    void returnsEmptyForNull() {
        assertEquals("", MaskingFunctions.maskIdentifier(null));
    }
}
```

Test cases penting:

1. Null.
2. Empty.
3. Blank.
4. Very short string.
5. Unicode.
6. Leading/trailing spaces.
7. Malicious string.
8. Long string.
9. Locale-specific input.
10. Boundary length.

Untuk security function, test malicious payload:

```text
<script>alert(1)</script>
" onmouseover="alert(1)
</textarea><script>alert(1)</script>
```

Jangan hanya test happy path.

---

## 44. Testing Custom ELResolver

Custom resolver perlu test contract `propertyResolved`.

Test scenario:

1. Root namespace handled.
2. Unknown root namespace not handled.
3. Known accessor property resolved.
4. Unknown property behavior.
5. Read-only behavior.
6. Null property behavior.
7. No accidental hijack of unrelated bean property.
8. Performance of early exit.

Pseudo-test:

```java
@Test
void doesNotResolveUnrelatedRootProperty() {
    ELContext context = new StandardELContext(ExpressionFactory.newInstance());
    ELResolver resolver = new FeatureFlagELResolver(featureService);

    Object value = resolver.getValue(context, null, "caseView");

    assertNull(value);
    assertFalse(context.isPropertyResolved());
}
```

Test bahwa resolver tidak merusak expression lain sama pentingnya dengan test bahwa resolver bekerja.

---

## 45. Integration Testing EL in JSP/Faces

Unit test function/resolver belum cukup. Perlu integration test yang memastikan:

1. TLD ditemukan.
2. Prefix benar.
3. Function signature benar.
4. Container bisa compile JSP.
5. Facelets bisa resolve bean/function.
6. Jakarta namespace cocok.
7. Dependency tidak konflik.

Strategi:

1. Embedded container test.
2. Smoke test page render.
3. Golden master untuk HTML critical.
4. Security regression output escaping.
5. Migration test untuk `javax` ke `jakarta`.

Minimal page smoke test:

```text
GET /case/detail?id=123
assert status 200
assert body contains escaped title
assert body does not contain raw script payload
assert body contains expected masked identifier
```

---

## 46. Anti-Pattern Catalog

### 46.1 Service Call in Getter

```java
public String getStatusLabel() {
    return dictionaryService.find(status);
}
```

Masalah:

- repeated call,
- hidden dependency,
- hard to test,
- unpredictable render cost.

Solusi:

- prepare view model.

### 46.2 Authorization in EL Only

```jsp
<c:if test="${perm:canApprove(case.id)}">
```

Masalah:

- hides button only,
- endpoint still callable.

Solusi:

- enforce in action/service.

### 46.3 Dynamic EL from User Input

```java
createValueExpression(context, userExpression, Object.class)
```

Masalah:

- EL injection.

Solusi:

- DSL/whitelist/sandbox.

### 46.4 Overbroad Resolver

```java
if (base == null) resolveEverything(property)
```

Masalah:

- breaks normal resolution.

Solusi:

- explicit namespace.

### 46.5 Complex Logic in View

```jsp
${case.status == 'OPEN' and user.supervisor and case.slaRisk == 'HIGH' and not case.locked}
```

Masalah:

- auditability poor,
- duplicated rule,
- hard to test.

Solusi:

- policy service returns view model/action availability.

### 46.6 Unbounded Cache in Function

```java
cache.computeIfAbsent(userPattern, ...)
```

Masalah:

- memory leak.

Solusi:

- whitelist/size-limited cache.

### 46.7 Raw EL Output

```jsp
${userInput}
```

Masalah:

- XSS risk.

Solusi:

- context-aware encoding.

---

## 47. Decision Matrix: Function vs Resolver vs Bean vs View Model

| Need | Best Tool | Why |
|---|---|---|
| Simple text formatting | EL function | Pure reusable helper |
| Simple masking | EL function or view model | Function okay, but sensitive data should be minimized earlier |
| Page-specific condition | View model property | Testable and explicit |
| Button visibility from policy | View model/action availability | Auditable and batchable |
| CDI service-backed helper | CDI `@Named` bean | Easy injection and lifecycle |
| Dynamic namespace lookup | Custom `ELResolver` | Natural expression syntax |
| Platform-level dictionary access | Function or resolver | Depends on syntax and caching needs |
| Configurable business rule | Prefer DSL/rule engine | EL too powerful without sandbox |
| Final authorization | Service/security layer | Must not be view-only |
| Data fetching | Controller/service | Avoid render-time DB calls |

---

## 48. Enterprise Design Pattern: Prepared View Model First

High-quality Java web UI architecture usually follows this flow:

```text
HTTP Request
    -> Controller / Faces backing bean init
    -> Service loads data
    -> Authorization/policy evaluated
    -> View model assembled
    -> JSP/Faces renders simple properties
```

View model example:

```java
public final class CaseDetailView {
    private final String referenceNo;
    private final String title;
    private final String statusLabel;
    private final String maskedApplicantId;
    private final boolean approveVisible;
    private final boolean assignVisible;
    private final List<ActionReasonView> unavailableReasons;

    // getters
}
```

JSP becomes boring:

```jsp
<h1><c:out value="${caseDetail.referenceNo}" /></h1>
<p><c:out value="${caseDetail.title}" /></p>
<span><c:out value="${caseDetail.statusLabel}" /></span>

<c:if test="${caseDetail.approveVisible}">
    <button type="submit" name="action" value="approve">Approve</button>
</c:if>
```

Boring views are good. Complexity belongs where it can be tested, logged, audited, and secured.

---

## 49. Practical Example: Case Management UI Helper Design

Misalnya halaman case detail perlu:

1. Status label.
2. SLA badge.
3. Masked applicant identifier.
4. Action button visibility.
5. Feature flag for new audit panel.
6. Localized date.

Naive JSP:

```jsp
<c:if test="${case.status == 'OPEN' and perm:canApprove(case.id)}">
    <button>Approve</button>
</c:if>

${dict:label('case.status', case.status)}
${datefmt:format(case.createdAt, user.locale)}
${sec:maskIdentifier(case.applicant.identifier)}
${feature:isEnabled('new-audit-panel')}
```

Better design:

```java
public final class CaseDetailView {
    private String statusLabel;
    private String slaBadgeClass;
    private String maskedApplicantIdentifier;
    private boolean approveVisible;
    private boolean newAuditPanelVisible;
    private String createdAtDisplay;
}
```

JSP:

```jsp
<c:if test="${caseDetail.approveVisible}">
    <button>Approve</button>
</c:if>

<span class="badge ${caseDetail.slaBadgeClass}">
    <c:out value="${caseDetail.statusLabel}" />
</span>

<c:out value="${caseDetail.maskedApplicantIdentifier}" />
<c:out value="${caseDetail.createdAtDisplay}" />

<c:if test="${caseDetail.newAuditPanelVisible}">
    <jsp:include page="_audit-panel.jsp" />
</c:if>
```

EL helper tetap boleh ada, tapi bukan pusat rule.

---

## 50. Advanced EL Review Checklist

Sebelum merge PR yang menambah EL function/resolver/expression kompleks, cek:

### Function

- [ ] Function `public static`.
- [ ] Signature TLD benar.
- [ ] Null handled.
- [ ] Tidak punya side effect.
- [ ] Tidak call DB/remote service.
- [ ] Tidak melakukan authorization final.
- [ ] Unit tested.
- [ ] Nama function jelas.
- [ ] Encoding context jelas jika terkait escaping.

### Resolver

- [ ] Namespace eksplisit.
- [ ] Early exit murah.
- [ ] `propertyResolved` diset hanya jika benar-benar resolve.
- [ ] Tidak hijack property umum.
- [ ] Read-only jika lookup helper.
- [ ] Tidak query per property tanpa cache/batch.
- [ ] Tested untuk non-target expression.
- [ ] Thread-safety jelas.
- [ ] CDI/dependency lifecycle jelas.

### Security

- [ ] Tidak evaluate user input sebagai EL.
- [ ] Tidak expose request/session/application sembarangan ke dynamic rule.
- [ ] Output encoding context benar.
- [ ] Sensitive data sudah diminimalkan sebelum view.
- [ ] Authorization tetap enforced di backend.
- [ ] Hidden field tidak dipercaya.

### Performance

- [ ] Tidak ada service call di getter.
- [ ] Tidak ada DB call di loop rendering.
- [ ] Lookup dictionary/permission dilakukan batch.
- [ ] Cache bounded dan dimension-aware.
- [ ] HTML payload wajar.
- [ ] Render path observable.

### Maintainability

- [ ] Expression tidak terlalu kompleks.
- [ ] Logic besar dipindah ke view model/policy.
- [ ] Missing label/fallback jelas.
- [ ] Migration `javax`/`jakarta` konsisten.
- [ ] Compatible dengan target Java version.

---

## 51. Mental Model Ringkas

Advanced EL bisa diringkas seperti ini:

```text
EL is a binding language.
It should connect the view to prepared state,
not become the place where the system secretly makes decisions.
```

Custom function:

```text
Good for pure, deterministic helper.
Bad for side effects and service orchestration.
```

Custom resolver:

```text
Good for narrow platform-level namespaces.
Dangerous if broad, global, or stateful.
```

Security:

```text
Never evaluate untrusted input as expression.
Never treat UI visibility as authorization.
Always encode output according to context.
```

Performance:

```text
Every expression is part of render path.
A cheap getter is okay.
A hidden DB call in getter is a production bug waiting to happen.
```

Architecture:

```text
Prepare data first.
Render simple views.
Keep decisions testable, auditable, and enforceable outside the template.
```

---

## 52. Kesimpulan

Advanced Expression Language bukan tentang membuat expression semakin pintar. Justru sebaliknya: semakin senior kita, semakin kita tahu kapan EL harus tetap sederhana.

Custom functions, custom resolvers, function mappers, variable mappers, and method expressions memberi kita power besar. Tetapi power itu harus dikunci dengan boundary:

1. View hanya membaca prepared state.
2. Helper harus pure dan murah.
3. Resolver harus sempit dan eksplisit.
4. Security tidak boleh bergantung pada rendered output.
5. Dynamic expression harus diperlakukan seperti execution surface.
6. Performance render path harus bisa diprediksi.
7. Complex rule harus bisa dites dan diaudit.

Jika prinsip ini dipegang, EL menjadi alat yang elegan untuk membangun UI enterprise yang clean. Jika prinsip ini dilanggar, EL berubah menjadi hidden scripting layer yang sulit diamankan, sulit diuji, dan sulit dimigrasikan.

---

## 53. Apa yang Berikutnya?

Bagian berikutnya akan masuk ke:

```text
07-jakarta-standard-tag-library-core-tags-view-control-abstraction.md
```

Fokus berikutnya adalah Jakarta Standard Tag Library/JSTL core tags sebagai cara mengganti scriptlet dengan view control abstraction yang lebih aman, readable, dan maintainable.

Kita akan membahas `c:out`, `c:set`, `c:if`, `c:choose`, `c:forEach`, `c:url`, `c:redirect`, `c:import`, `c:param`, escaping, URL rewriting, session id risk, nested loop, dan boundary antara view logic dengan business logic.

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 5 — Expression Language Fundamentals: Value Expressions, Method Expressions, Resolver Chain](./05-expression-language-fundamentals-value-method-resolver-chain.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 7 — Jakarta Standard Tag Library Core Tags: View Control Abstraction](./07-jakarta-standard-tag-library-core-tags-view-control-abstraction.md)
