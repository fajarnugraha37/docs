# Part 24 — Custom Faces Components, Renderers, Converters, Validators, and Extensions

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `24-custom-faces-components-renderers-converters-validators-extensions.md`  
> Area: Jakarta Faces advanced extension model  
> Target: Java 8 sampai Java 25, Java EE `javax.faces.*` sampai Jakarta EE `jakarta.faces.*`

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas **composite components** sebagai cara paling praktis membangun reusable UI component di Jakarta Faces. Composite component cocok ketika reusable UI masih bisa disusun dari Facelets markup dan standard components.

Namun ada kelas kebutuhan yang tidak cukup diselesaikan dengan composite component:

- component perlu punya **decode/encode behavior** khusus;
- component perlu membaca request parameter sendiri;
- component perlu render HTML kompleks secara programmatic;
- component perlu menyimpan state internal dengan efisien;
- component perlu punya renderer berbeda untuk output berbeda;
- component perlu menyediakan converter/validator reusable level framework;
- component perlu hook ke lifecycle Faces;
- component perlu override resource handling, view handling, exception handling, atau phase behavior.

Di titik itu kita masuk ke area **custom Faces extension**.

Setelah menyelesaikan part ini, kamu harus bisa:

1. membedakan kapan memakai **composite component**, **custom tag**, **custom component**, atau **component library**;
2. memahami struktur `UIComponent`, `Renderer`, `StateHelper`, `Converter`, `Validator`, `Behavior`, dan lifecycle extension;
3. membuat custom component sederhana dengan renderer terpisah;
4. memahami bagaimana Faces menyimpan dan memulihkan state custom component;
5. mendesain converter dan validator yang aman, reusable, testable, dan tidak bocor business logic;
6. memahami extension point seperti `PhaseListener`, `SystemEventListener`, `ExceptionHandler`, `ResourceHandler`, dan `ViewHandler`;
7. menghindari kesalahan umum yang membuat custom Faces extension rapuh, tidak portable, dan sulit dimigrasikan dari `javax` ke `jakarta`.

---

## 1. Mental Model: Faces Extension Bukan Sekadar “Custom UI”

Jakarta Faces adalah framework component-based. Artinya halaman bukan langsung dieksekusi sebagai template string, tetapi dibangun menjadi **component tree**. Component tree itu lalu diproses melalui lifecycle:

```text
HTTP request
  -> Restore View
  -> Apply Request Values
  -> Process Validations
  -> Update Model Values
  -> Invoke Application
  -> Render Response
  -> HTML response
```

Custom extension bisa masuk di beberapa titik:

```text
View declaration
  -> custom tag / composite component / custom component

Request decoding
  -> UIComponent.decode()
  -> Renderer.decode()

Conversion
  -> Converter.getAsObject()
  -> Converter.getAsString()

Validation
  -> Validator.validate()

Application event
  -> ActionListener / ValueChangeListener / SystemEventListener

Rendering
  -> UIComponent.encodeBegin/encodeChildren/encodeEnd()
  -> Renderer.encodeBegin/encodeChildren/encodeEnd()

State saving
  -> StateHelper
  -> PartialStateHolder

Exception flow
  -> ExceptionHandler

Resource serving
  -> ResourceHandler

View creation/restoration
  -> ViewHandler
```

Jadi extension model Faces lebih mirip **framework runtime extension**, bukan sekadar helper HTML.

---

## 2. Referensi Konseptual Resmi

Jakarta Faces 4.1 adalah rilis untuk Jakarta EE 11 dan mendefinisikan MVC framework untuk UI web yang mencakup UI components, state management, event handling, input validation, page navigation, internationalization, dan accessibility. Dokumentasi Jakarta EE juga menyebutkan aplikasi dapat membuat custom objects seperti custom components, validators, converters, listeners, dan custom tags. Jakarta Faces tutorial memiliki bab khusus untuk membuat custom UI components dan custom objects.

> Catatan versi:
>
> - Era Java EE / JSF lama memakai namespace `javax.faces.*`.
> - Era Jakarta EE modern memakai namespace `jakarta.faces.*`.
> - Migrasi besar dari `javax` ke `jakarta` bukan hanya import Java class, tetapi juga dependency, TLD, namespace, container, component library, dan integration behavior.

---

## 3. Kapan Membuat Custom Component?

Jangan terlalu cepat membuat custom component. Di Faces ada beberapa level abstraksi.

### 3.1 Decision Ladder

```text
Butuh reusable markup sederhana?
  -> Gunakan Facelets template atau ui:include.

Butuh reusable field/control dari existing Faces components?
  -> Gunakan composite component.

Butuh reusable JSP-style server template di JSP?
  -> Gunakan tag file/custom tag JSP.

Butuh behavior decode/render/state custom di Faces lifecycle?
  -> Gunakan custom Faces component + renderer.

Butuh set komponen kaya dan maintainable?
  -> Pertimbangkan library seperti PrimeFaces/OmniFaces sebelum membangun sendiri.
```

### 3.2 Custom Component Cocok Jika

Custom component masuk akal ketika:

1. component punya **request decoding behavior** khusus;
2. component harus render markup yang sangat terstruktur;
3. component perlu **state internal**;
4. component perlu reusable di banyak halaman dan proyek;
5. component perlu API atribut yang stabil;
6. component harus bekerja dengan lifecycle Faces: converter, validator, Ajax, messages;
7. component perlu integrasi dengan resource handler;
8. component perlu renderer pluggable.

Contoh yang masuk akal:

- custom date range picker;
- masked input dengan server-side decode;
- secure download link component;
- permission-aware command component;
- audit-aware form field wrapper;
- dynamic status timeline;
- enterprise file upload component;
- regulatory workflow action panel.

### 3.3 Custom Component Tidak Cocok Jika

Jangan membuat custom component jika:

1. hanya ingin menghindari duplikasi HTML kecil;
2. hanya butuh CSS wrapper;
3. hanya butuh label + input + message;
4. belum memahami lifecycle Faces;
5. belum punya test strategy;
6. behavior masih berubah-ubah;
7. UI lebih cocok menjadi composite component;
8. use case bisa diselesaikan oleh library matang.

Custom component adalah API. Begitu dipakai banyak halaman, ia menjadi kontrak jangka panjang.

---

## 4. Arsitektur Custom Component

Custom component biasanya terdiri dari:

```text
Facelets tag
  -> creates component instance

UIComponent subclass
  -> holds component state and behavior contract

Renderer
  -> decodes request and encodes markup

faces-config / annotation registration
  -> maps component type and renderer type

resources
  -> JS/CSS/images if needed
```

Secara sederhana:

```text
XHTML page
  <app:statusBadge value="#{case.status}" />

        |
        v

Component instance
  StatusBadgeComponent

        |
        v

Renderer
  StatusBadgeRenderer

        |
        v

HTML output
  <span class="status status-open">Open</span>
```

---

## 5. `UIComponent`: Building Block Utama

`UIComponent` adalah abstraction dasar component tree Faces.

Component bertanggung jawab untuk:

1. menyimpan atribut/state;
2. punya id dan client id;
3. punya children dan facets;
4. ikut lifecycle process;
5. expose contract ke renderer;
6. ikut state saving/restoring.

Class umum:

```java
import jakarta.faces.component.FacesComponent;
import jakarta.faces.component.UIComponentBase;

@FacesComponent(StatusBadge.COMPONENT_TYPE)
public class StatusBadge extends UIComponentBase {

    public static final String COMPONENT_TYPE = "com.acme.faces.StatusBadge";
    public static final String COMPONENT_FAMILY = "com.acme.faces.components";

    @Override
    public String getFamily() {
        return COMPONENT_FAMILY;
    }
}
```

Komponen minimal harus punya:

- component type;
- component family;
- state/attribute accessors;
- optional renderer type.

---

## 6. Component Type, Family, Renderer Type

Ada tiga identifier penting.

### 6.1 Component Type

Component type adalah nama unik untuk membuat component.

```java
public static final String COMPONENT_TYPE = "com.acme.faces.StatusBadge";
```

Ini seperti “class identifier” di registry Faces.

### 6.2 Component Family

Family mengelompokkan component untuk renderer lookup.

```java
public static final String COMPONENT_FAMILY = "com.acme.faces.components";
```

Renderer biasanya diregistrasikan berdasarkan:

```text
component family + renderer type
```

### 6.3 Renderer Type

Renderer type menunjukkan renderer mana yang dipakai.

```java
public static final String RENDERER_TYPE = "com.acme.faces.StatusBadgeRenderer";
```

Component bisa mengatur renderer type di constructor:

```java
public StatusBadge() {
    setRendererType(RENDERER_TYPE);
}
```

Mental model:

```text
component type
  -> cara membuat component

component family
  -> kategori renderable component

renderer type
  -> strategi render/decode
```

---

## 7. StateHelper: Cara Aman Menyimpan State Component

Jangan menyimpan attribute component sebagai field biasa tanpa memahami state saving.

Salah:

```java
private String severity;
```

Masalah:

- field bisa hilang saat state restore;
- partial state saving bisa tidak melacak perubahan;
- serialisasi bisa rusak;
- behavior berbeda antar implementation.

Lebih aman:

```java
public String getSeverity() {
    return (String) getStateHelper().eval(PropertyKeys.severity, "info");
}

public void setSeverity(String severity) {
    getStateHelper().put(PropertyKeys.severity, severity);
}

protected enum PropertyKeys {
    severity,
    value,
    styleClass
}
```

`StateHelper` membantu Faces menyimpan state component dengan benar.

---

## 8. ValueExpression vs Stored Value

Component attribute bisa berasal dari literal atau EL.

```xml
<app:statusBadge value="#{caseBean.case.status}" severity="warning" />
```

`severity="warning"` adalah literal.

`value="#{caseBean.case.status}"` adalah value expression.

Di custom component, jangan selalu menganggap value sudah menjadi field biasa. Faces dapat menyimpan expression binding.

Pola accessor dengan `StateHelper` biasanya cukup karena Facelets akan mengatur attribute ke component. Tetapi untuk kasus advanced, kamu bisa membaca `ValueExpression` langsung:

```java
ValueExpression ve = getValueExpression("value");
Object value = ve != null
        ? ve.getValue(FacesContext.getCurrentInstance().getELContext())
        : getStateHelper().eval(PropertyKeys.value);
```

Namun jangan overuse. Untuk kebanyakan component, accessor biasa cukup.

---

## 9. Renderer: Pemisahan Behavior dan Markup

Renderer bertugas untuk:

1. decode request parameter;
2. encode HTML;
3. encode children jika perlu;
4. menggunakan `ResponseWriter`;
5. menghormati escaping dan attribute rendering.

Contoh renderer sederhana:

```java
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.context.ResponseWriter;
import jakarta.faces.render.FacesRenderer;
import jakarta.faces.render.Renderer;
import java.io.IOException;

@FacesRenderer(
    componentFamily = StatusBadge.COMPONENT_FAMILY,
    rendererType = StatusBadge.RENDERER_TYPE
)
public class StatusBadgeRenderer extends Renderer {

    @Override
    public void encodeEnd(FacesContext context, UIComponent component) throws IOException {
        StatusBadge badge = (StatusBadge) component;
        ResponseWriter writer = context.getResponseWriter();

        String severity = badge.getSeverity();
        Object value = badge.getValue();

        writer.startElement("span", component);
        writer.writeAttribute("id", component.getClientId(context), "id");
        writer.writeAttribute("class", "status-badge status-badge-" + cssSafe(severity), "styleClass");
        writer.writeText(value == null ? "" : value.toString(), "value");
        writer.endElement("span");
    }

    private String cssSafe(String input) {
        if (input == null) {
            return "info";
        }
        return input.replaceAll("[^a-zA-Z0-9_-]", "");
    }
}
```

Kunci penting:

- gunakan `writeText()` untuk text agar escaping dilakukan dengan benar;
- jangan concat raw HTML dari user input;
- gunakan `writeAttribute()` untuk attribute;
- sanitasi nilai yang masuk ke class/style/id;
- jangan memanggil service/database di renderer.

---

## 10. Full Example: `StatusBadge` Component

### 10.1 Component Class

```java
package com.acme.faces.component;

import jakarta.faces.component.FacesComponent;
import jakarta.faces.component.UIComponentBase;

@FacesComponent(StatusBadge.COMPONENT_TYPE)
public class StatusBadge extends UIComponentBase {

    public static final String COMPONENT_TYPE = "com.acme.faces.StatusBadge";
    public static final String COMPONENT_FAMILY = "com.acme.faces.components";
    public static final String RENDERER_TYPE = "com.acme.faces.StatusBadgeRenderer";

    public StatusBadge() {
        setRendererType(RENDERER_TYPE);
    }

    @Override
    public String getFamily() {
        return COMPONENT_FAMILY;
    }

    public Object getValue() {
        return getStateHelper().eval(PropertyKeys.value);
    }

    public void setValue(Object value) {
        getStateHelper().put(PropertyKeys.value, value);
    }

    public String getSeverity() {
        return (String) getStateHelper().eval(PropertyKeys.severity, "info");
    }

    public void setSeverity(String severity) {
        getStateHelper().put(PropertyKeys.severity, severity);
    }

    public String getStyleClass() {
        return (String) getStateHelper().eval(PropertyKeys.styleClass, "");
    }

    public void setStyleClass(String styleClass) {
        getStateHelper().put(PropertyKeys.styleClass, styleClass);
    }

    protected enum PropertyKeys {
        value,
        severity,
        styleClass
    }
}
```

### 10.2 Renderer Class

```java
package com.acme.faces.render;

import com.acme.faces.component.StatusBadge;
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.context.ResponseWriter;
import jakarta.faces.render.FacesRenderer;
import jakarta.faces.render.Renderer;
import java.io.IOException;

@FacesRenderer(
    componentFamily = StatusBadge.COMPONENT_FAMILY,
    rendererType = StatusBadge.RENDERER_TYPE
)
public class StatusBadgeRenderer extends Renderer {

    @Override
    public void encodeEnd(FacesContext context, UIComponent component) throws IOException {
        StatusBadge badge = (StatusBadge) component;
        ResponseWriter writer = context.getResponseWriter();

        String severity = safeCssToken(badge.getSeverity());
        String customClass = badge.getStyleClass();
        Object value = badge.getValue();

        writer.startElement("span", component);
        writer.writeAttribute("id", component.getClientId(context), "id");
        writer.writeAttribute("class", buildClass(severity, customClass), "styleClass");
        writer.writeText(value == null ? "" : value.toString(), "value");
        writer.endElement("span");
    }

    private String buildClass(String severity, String customClass) {
        String base = "status-badge status-badge-" + severity;
        if (customClass == null || customClass.isBlank()) {
            return base;
        }
        return base + " " + customClass;
    }

    private String safeCssToken(String input) {
        if (input == null || input.isBlank()) {
            return "info";
        }
        return input.replaceAll("[^a-zA-Z0-9_-]", "");
    }
}
```

### 10.3 Tag Declaration

Ada beberapa cara exposing custom component ke Facelets. Salah satunya melalui taglib XML.

Contoh `META-INF/acme.taglib.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<facelet-taglib
    xmlns="https://jakarta.ee/xml/ns/jakartaee"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-facelettaglibrary_4_1.xsd"
    version="4.1">

    <namespace>http://acme.example.com/faces</namespace>

    <tag>
        <tag-name>statusBadge</tag-name>
        <component>
            <component-type>com.acme.faces.StatusBadge</component-type>
            <renderer-type>com.acme.faces.StatusBadgeRenderer</renderer-type>
        </component>
    </tag>
</facelet-taglib>
```

Lalu di `web.xml` atau config yang sesuai, pastikan taglib ditemukan oleh runtime. Pada container modern, file di `META-INF` JAR sering dapat ditemukan otomatis tergantung packaging dan discovery.

Pemakaian:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:app="http://acme.example.com/faces">

<h:body>
    <app:statusBadge value="#{caseDetail.statusLabel}"
                     severity="#{caseDetail.statusSeverity}" />
</h:body>
</html>
```

---

## 11. Decode vs Encode

Custom component bisa hanya render output, atau juga menerima input.

### 11.1 Output-only Component

Contoh:

- status badge;
- audit timeline;
- permission hint;
- formatted label.

Biasanya hanya butuh `encodeEnd()`.

### 11.2 Input Component

Input component butuh decode.

Decode berarti membaca HTTP request parameter dan menyimpan submitted value.

Faces standard input component biasanya extend `UIInput`.

```java
import jakarta.faces.component.FacesComponent;
import jakarta.faces.component.UIInput;

@FacesComponent(MaskedInput.COMPONENT_TYPE)
public class MaskedInput extends UIInput {

    public static final String COMPONENT_TYPE = "com.acme.faces.MaskedInput";
    public static final String COMPONENT_FAMILY = "jakarta.faces.Input";
    public static final String RENDERER_TYPE = "com.acme.faces.MaskedInputRenderer";

    public MaskedInput() {
        setRendererType(RENDERER_TYPE);
    }
}
```

Renderer decode:

```java
@Override
public void decode(FacesContext context, UIComponent component) {
    if (component == null) {
        return;
    }

    String clientId = component.getClientId(context);
    String submittedValue = context.getExternalContext()
            .getRequestParameterMap()
            .get(clientId);

    if (component instanceof UIInput input) {
        input.setSubmittedValue(submittedValue);
    }
}
```

Rendering input:

```java
@Override
public void encodeEnd(FacesContext context, UIComponent component) throws IOException {
    ResponseWriter writer = context.getResponseWriter();
    UIInput input = (UIInput) component;

    String clientId = component.getClientId(context);
    Object value = input.getValue();

    writer.startElement("input", component);
    writer.writeAttribute("type", "text", null);
    writer.writeAttribute("id", clientId, "id");
    writer.writeAttribute("name", clientId, null);
    writer.writeAttribute("value", value == null ? "" : value.toString(), "value");
    writer.endElement("input");
}
```

Hal penting:

- `name` harus cocok dengan `clientId` agar request parameter bisa dibaca;
- `decode()` biasanya terjadi pada Apply Request Values;
- conversion dan validation ditangani oleh `UIInput` lifecycle;
- jangan update model langsung di `decode()`.

---

## 12. Renderer Responsibility Boundary

Renderer boleh:

- membaca component attributes;
- membaca request parameter saat decode;
- menulis markup;
- encode JS/CSS resource dependency jika perlu;
- melakukan transformasi display ringan.

Renderer tidak boleh:

- query database;
- memanggil remote API;
- menjalankan business rule;
- melakukan authorization final;
- mutate domain object;
- menyimpan global mutable state;
- menaruh raw user input ke HTML tanpa context-aware encoding.

Renderer berada di render path. Render path harus cepat, deterministic, dan minim side effect.

---

## 13. `encodeBegin`, `encodeChildren`, `encodeEnd`

Renderer punya beberapa hook:

```java
@Override
public void encodeBegin(FacesContext context, UIComponent component) throws IOException {
    // opening markup
}

@Override
public void encodeChildren(FacesContext context, UIComponent component) throws IOException {
    // custom child rendering
}

@Override
public void encodeEnd(FacesContext context, UIComponent component) throws IOException {
    // closing markup
}

@Override
public boolean getRendersChildren() {
    return true;
}
```

Gunakan `getRendersChildren() = true` jika renderer mengambil alih rendering children.

Jika tidak, Faces akan render children secara default.

Mental model:

```text
encodeBegin
  -> render opening container

children rendering
  -> default atau custom

encodeEnd
  -> render closing container
```

---

## 14. Custom Converter

Converter mengubah:

```text
String request value <-> domain/UI object
```

Dua method utama:

```java
Object getAsObject(FacesContext context, UIComponent component, String value)
String getAsString(FacesContext context, UIComponent component, Object value)
```

### 14.1 Example: Case Status Converter

```java
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.convert.Converter;
import jakarta.faces.convert.ConverterException;
import jakarta.faces.convert.FacesConverter;

@FacesConverter("caseStatusConverter")
public class CaseStatusConverter implements Converter<CaseStatus> {

    @Override
    public CaseStatus getAsObject(FacesContext context, UIComponent component, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }

        try {
            return CaseStatus.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new ConverterException("Invalid case status: " + value);
        }
    }

    @Override
    public String getAsString(FacesContext context, UIComponent component, CaseStatus value) {
        if (value == null) {
            return "";
        }
        return value.name();
    }
}
```

Pemakaian:

```xml
<h:selectOneMenu value="#{caseSearch.status}" converter="caseStatusConverter">
    <f:selectItem itemLabel="All" itemValue="" />
    <f:selectItems value="#{caseSearch.availableStatuses}" />
</h:selectOneMenu>
```

### 14.2 Converter Design Rules

Converter harus:

1. deterministic;
2. cepat;
3. null-safe;
4. locale-aware jika parsing display value;
5. menghasilkan error yang aman;
6. tidak membuat business side effect.

Converter sebaiknya tidak:

1. memanggil remote API;
2. membuat database query per row dalam table;
3. expose internal id sensitif tanpa proteksi;
4. menganggap display label sebagai stable identifier.

---

## 15. Entity Converter Trap

Salah satu anti-pattern klasik Faces:

```java
@FacesConverter("userConverter")
public class UserConverter implements Converter<User> {
    @Inject UserRepository repository;

    public User getAsObject(..., String id) {
        return repository.findById(Long.valueOf(id));
    }
}
```

Masalah:

- converter menjadi persistence gateway;
- bisa terjadi N+1 query;
- lifecycle conversion menjadi tergantung database;
- error handling sulit;
- security risk jika id bisa ditebak;
- entity bisa attached/detached ambiguously;
- injection pada converter lama tidak selalu portable tergantung versi/config.

Lebih aman:

```text
UI value: stable id atau code
Backing bean: validate id against allowed options
Service layer: load authorized entity saat action
```

Pola aman:

```java
public String assign() {
    Long assigneeId = form.getAssigneeId();
    assignmentService.assign(caseId, assigneeId, currentUser);
    return null;
}
```

Converter hanya mengubah string ke `Long`, bukan load entity.

---

## 16. Custom Validator

Validator memeriksa nilai setelah conversion.

```java
import jakarta.faces.application.FacesMessage;
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.validator.FacesValidator;
import jakarta.faces.validator.Validator;
import jakarta.faces.validator.ValidatorException;

@FacesValidator("postalCodeValidator")
public class PostalCodeValidator implements Validator<String> {

    @Override
    public void validate(FacesContext context, UIComponent component, String value) {
        if (value == null || value.isBlank()) {
            return;
        }

        if (!value.matches("\\d{6}")) {
            throw new ValidatorException(new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Postal code must contain exactly 6 digits.",
                    null
            ));
        }
    }
}
```

Pemakaian:

```xml
<h:inputText id="postalCode" value="#{addressForm.postalCode}">
    <f:validator validatorId="postalCodeValidator" />
</h:inputText>
<h:message for="postalCode" />
```

Validator cocok untuk:

- format rule;
- UI-level consistency;
- allowed option checking;
- cross-field check jika desainnya hati-hati;
- rule yang harus terjadi sebelum model update.

Validator tidak cocok untuk:

- final authorization;
- irreversible business action;
- workflow transition;
- external side effect;
- heavy duplicate service call per field.

---

## 17. Cross-Field Validation

Faces validator default bekerja per component. Cross-field validation perlu desain lebih hati-hati.

Contoh date range:

```text
startDate <= endDate
```

Pilihan implementasi:

1. validate di action method setelah semua model updated;
2. gunakan class-level Jakarta Validation pada form object;
3. custom component/composite component khusus date range;
4. validator pada salah satu field yang membaca sibling component.

### 17.1 Validator Membaca Sibling Component

```java
public void validateEndDate(FacesContext context, UIComponent component, LocalDate endDate) {
    UIInput startInput = (UIInput) component.findComponent("startDate");
    LocalDate startDate = (LocalDate) startInput.getLocalValue();

    if (startDate != null && endDate != null && endDate.isBefore(startDate)) {
        throw new ValidatorException(new FacesMessage("End date must be after start date."));
    }
}
```

Ini bisa bekerja, tapi rapuh terhadap naming container dan urutan processing.

Untuk enterprise, lebih maintainable:

```text
Form object + class-level validation + action boundary validation
```

---

## 18. Converter vs Validator vs Business Rule

| Concern | Tempat Ideal | Contoh |
|---|---|---|
| String ke type | Converter | `"2026-06-18" -> LocalDate` |
| Field format | Validator | postal code 6 digit |
| Cross-field form consistency | Form validator / action validation | start date <= end date |
| Domain invariant | Domain/service | transition only from OPEN to REVIEW |
| Authorization | Security/service layer | user can approve this case |
| Side effect | Application/service action | assign officer, send email |

Rule of thumb:

> Faces converter/validator melindungi UI input integrity. Service/domain layer tetap pemilik kebenaran bisnis.

---

## 19. Component Behavior dan ClientBehavior

Faces mendukung behavior seperti Ajax.

Custom component yang ingin support Ajax perlu berperilaku sebagai client behavior holder.

Standard components seperti `h:commandButton` dan `h:inputText` sudah mendukung `f:ajax`. Untuk custom component, kamu perlu memahami apakah component:

- hanya output static;
- input component;
- command/action component;
- client behavior source;
- naming container.

Jika component butuh client behavior advanced, desainnya makin kompleks. Pertimbangkan apakah composite component wrapping standard Faces component sudah cukup.

---

## 20. PhaseListener

`PhaseListener` memungkinkan kamu hook ke lifecycle phase.

Contoh use case:

- lifecycle logging;
- correlation id;
- diagnostics;
- performance timing;
- audit metadata for UI request;
- debugging partial Ajax;
- security guard tambahan.

Contoh:

```java
import jakarta.faces.event.PhaseEvent;
import jakarta.faces.event.PhaseId;
import jakarta.faces.event.PhaseListener;

public class LifecycleLoggingPhaseListener implements PhaseListener {

    @Override
    public void beforePhase(PhaseEvent event) {
        System.out.println("Before " + event.getPhaseId());
    }

    @Override
    public void afterPhase(PhaseEvent event) {
        System.out.println("After " + event.getPhaseId());
    }

    @Override
    public PhaseId getPhaseId() {
        return PhaseId.ANY_PHASE;
    }
}
```

Registrasi `faces-config.xml`:

```xml
<lifecycle>
    <phase-listener>com.acme.faces.LifecycleLoggingPhaseListener</phase-listener>
</lifecycle>
```

### 20.1 Jangan Overuse PhaseListener

PhaseListener bisa menjadi hidden global behavior.

Hindari:

- business logic global;
- modifying model silently;
- complex navigation override;
- catching all exceptions and swallowing them;
- making database calls every phase;
- per-request heavy logging di production tanpa sampling.

PhaseListener paling sehat untuk cross-cutting concern yang observability-oriented atau framework-level.

---

## 21. SystemEventListener

Faces punya system events, misalnya:

- component tree event;
- pre render view;
- post add to view;
- application lifecycle event.

Use case:

- initialize component after added to tree;
- validate view metadata;
- enforce component conventions;
- inject default attributes;
- collect diagnostics.

Namun seperti PhaseListener, system event listener bisa menyembunyikan behavior. Pakai hanya jika ada alasan framework-level.

---

## 22. ExceptionHandler

Faces exception handling bisa dikustomisasi dengan `ExceptionHandler`.

Use case:

- handle `ViewExpiredException` dengan redirect user-friendly;
- map business exception ke message;
- log correlation id;
- normalize Ajax exception response;
- route security exception ke error page;
- prevent stack trace leakage.

Mental model:

```text
Exception thrown during lifecycle
  -> queued/wrapped by Faces
  -> ExceptionHandler processes it
  -> response rendered/redirected/completed
```

Desain enterprise:

1. bedakan validation error, business error, security error, system error;
2. jangan tampilkan internal exception message mentah;
3. selalu log server-side dengan correlation id;
4. untuk Ajax, kirim partial response yang valid;
5. jangan swallow exception tanpa observability;
6. jangan membuat redirect loop.

---

## 23. ResourceHandler

Faces resource system mengelola resource seperti:

- JavaScript;
- CSS;
- image;
- component library resources;
- versioned resources;
- library resources under `/resources`.

ResourceHandler custom bisa dipakai untuk:

- cache busting;
- CDN routing;
- multi-tenant theme resolution;
- access-controlled resources;
- resource fingerprinting;
- fallback resource lookup.

Namun ResourceHandler adalah extension level framework. Salah desain bisa merusak semua asset.

Alternatif yang sering cukup:

- standard Faces resource library;
- build pipeline versioning;
- reverse proxy/CDN static asset strategy;
- component library resource conventions.

---

## 24. ViewHandler

`ViewHandler` mengatur view creation, restore, render, dan view id resolution.

Use case advanced:

- custom view resolution;
- multi-tenant template selection;
- extensionless URL;
- theme-dependent view mapping;
- custom locale handling;
- instrumentation view render.

Hati-hati: ViewHandler terlalu fundamental. Kesalahan kecil bisa membuat seluruh aplikasi gagal render.

Biasanya lebih aman memakai:

- servlet mapping;
- navigation rules;
- template composition;
- resource libraries;
- framework/library yang sudah matang.

---

## 25. ResourceDependency

Custom component bisa mendeklarasikan dependency resource.

```java
import jakarta.faces.application.ResourceDependency;

@ResourceDependency(library = "acme", name = "status-badge.css")
public class StatusBadge extends UIComponentBase {
    // ...
}
```

Faces akan memasukkan resource ke halaman jika diperlukan.

Resource structure:

```text
src/main/webapp/resources/acme/status-badge.css
src/main/webapp/resources/acme/status-badge.js
```

Atau dalam JAR:

```text
META-INF/resources/acme/status-badge.css
META-INF/resources/acme/status-badge.js
```

Design rule:

- component resource harus kecil dan scoped;
- jangan inject global CSS yang merusak halaman lain;
- resource harus version-aware;
- hindari dependency order yang implicit;
- dokumentasikan JS events/API.

---

## 26. Custom Component Security

Custom component sering menjadi sumber vulnerability karena developer merasa “ini framework internal”.

### 26.1 Output Escaping

Aman:

```java
writer.writeText(userValue, "value");
```

Berbahaya:

```java
writer.write(userValue.toString());
```

`write()` bisa menulis raw markup. Gunakan hanya untuk markup yang kamu kontrol penuh.

### 26.2 Attribute Context

Jangan menaruh user input langsung ke attribute sensitif:

```java
writer.writeAttribute("onclick", userInput, null); // dangerous
writer.writeAttribute("style", userInput, null);   // dangerous
writer.writeAttribute("href", userUrl, null);      // risky
```

Context berbeda butuh encoding/validation berbeda.

### 26.3 Authorization

Component boleh menyembunyikan tombol:

```xml
<app:secureCommandButton permission="CASE_APPROVE" ... />
```

Tapi backend tetap harus enforce:

```java
caseService.approve(caseId, currentUser);
```

UI visibility bukan authorization final.

### 26.4 Hidden Field Tampering

Input component custom yang menyimpan hidden value harus menganggap semua hidden value bisa dimodifikasi user.

Jangan percaya:

- role;
- permission;
- amount;
- workflow state;
- assignee id;
- case owner;
- version number tanpa optimistic locking.

---

## 27. Custom Component Performance

Custom component berjalan di render path. Kesalahan kecil bisa dikalikan ribuan kali di data table.

Anti-pattern:

```java
public void encodeEnd(...) {
    Permission permission = permissionService.check(...); // bad in renderer
    String label = localizationService.fetch(...);        // risky if heavy
    Object data = repository.find(...);                   // very bad
}
```

Lebih baik:

```text
Controller/backing bean prepares view model
  -> component only renders the prepared value
```

### 27.1 Performance Checklist

1. Tidak ada DB call di renderer.
2. Tidak ada remote API call di renderer.
3. Tidak ada heavy reflection per component render.
4. Tidak ada regex kompleks per row tanpa cache.
5. Tidak ada global lock.
6. Tidak ada large object allocation berulang.
7. Tidak ada hidden session growth.
8. Component state minimal.
9. Resource dependency tidak duplikatif.
10. Logging tidak noisy per component instance.

---

## 28. Custom Component State Budget

Setiap attribute yang disimpan di component bisa masuk view state.

Pertanyaan desain:

1. Apakah attribute ini perlu disimpan di view state?
2. Apakah bisa dihitung ulang dari model?
3. Apakah value besar?
4. Apakah value serializable?
5. Apakah value aman jika client-side state saving aktif?
6. Apakah value berubah per request?
7. Apakah value bisa menyebabkan session bloat?

Jangan menyimpan:

- list besar;
- entity graph;
- file content;
- service object;
- security-sensitive raw data;
- non-serializable runtime object;
- cached computation besar.

Simpan:

- primitive/simple config;
- string code kecil;
- boolean flags;
- display options ringan.

---

## 29. Custom Renderer vs Custom Component Without Renderer

Faces memungkinkan component encode sendiri tanpa renderer, tetapi pemisahan renderer sering lebih bersih.

### 29.1 Encode di Component

Kelebihan:

- lebih sederhana untuk component kecil;
- file lebih sedikit.

Kekurangan:

- component class campur state dan rendering;
- sulit support multiple renderer;
- sulit test terpisah;
- tidak idiomatik untuk component kompleks.

### 29.2 Renderer Terpisah

Kelebihan:

- separation of concerns;
- renderer bisa diganti;
- component state lebih bersih;
- lebih dekat model framework Faces.

Kekurangan:

- konfigurasi lebih banyak;
- perlu paham component family/renderer type.

Rule:

> Untuk component serius/enterprise, pisahkan component dan renderer.

---

## 30. Packaging Custom Faces Library

Struktur Maven module:

```text
acme-faces-components/
  pom.xml
  src/main/java/
    com/acme/faces/component/StatusBadge.java
    com/acme/faces/render/StatusBadgeRenderer.java
    com/acme/faces/convert/CaseStatusConverter.java
    com/acme/faces/validate/PostalCodeValidator.java
  src/main/resources/
    META-INF/acme.taglib.xml
    META-INF/faces-config.xml
    META-INF/resources/acme/status-badge.css
    META-INF/resources/acme/status-badge.js
```

Dependency:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
    <scope>provided</scope>
</dependency>
```

Untuk library yang hanya butuh Faces API, dependency bisa lebih spesifik ke Faces API sesuai stack. Namun dalam aplikasi Jakarta EE penuh, `jakarta.jakartaee-api` provided sering cukup untuk compile.

---

## 31. faces-config.xml untuk Registrasi Manual

Selain annotation, kamu bisa registrasi via `faces-config.xml`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<faces-config
    xmlns="https://jakarta.ee/xml/ns/jakartaee"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-facesconfig_4_1.xsd"
    version="4.1">

    <component>
        <component-type>com.acme.faces.StatusBadge</component-type>
        <component-class>com.acme.faces.component.StatusBadge</component-class>
    </component>

    <render-kit>
        <renderer>
            <component-family>com.acme.faces.components</component-family>
            <renderer-type>com.acme.faces.StatusBadgeRenderer</renderer-type>
            <renderer-class>com.acme.faces.render.StatusBadgeRenderer</renderer-class>
        </renderer>
    </render-kit>

    <converter>
        <converter-id>caseStatusConverter</converter-id>
        <converter-class>com.acme.faces.convert.CaseStatusConverter</converter-class>
    </converter>

    <validator>
        <validator-id>postalCodeValidator</validator-id>
        <validator-class>com.acme.faces.validate.PostalCodeValidator</validator-class>
    </validator>
</faces-config>
```

Annotation lebih ringkas, XML lebih explicit dan kadang lebih mudah untuk library governance.

---

## 32. Extension Compatibility: Mojarra vs MyFaces

Jakarta Faces punya spesifikasi, tetapi implementasi umum adalah:

- Eclipse Mojarra;
- Apache MyFaces.

Custom extension yang portable harus:

1. hanya bergantung pada public API;
2. menghindari internal package implementation;
3. tidak mengandalkan undocumented behavior;
4. diuji pada minimal satu implementation target;
5. tidak membaca generated client id dengan asumsi terlalu spesifik;
6. tidak mengandalkan order yang tidak dijamin spec;
7. tidak menggunakan reflection ke implementation internal.

Anti-pattern:

```java
import com.sun.faces.*;       // Mojarra internal
import org.apache.myfaces.*;  // MyFaces internal
```

Kecuali kamu memang membuat extension khusus implementation tertentu, hindari internal API.

---

## 33. Java 8 sampai Java 25 Implications

### 33.1 Java 8 Legacy

- Umumnya masih di Java EE/JSF `javax.faces.*`.
- Banyak app memakai JSF 2.2/2.3.
- CDI integration bisa lebih terbatas.
- Converter/validator injection perlu dicek versi.
- Library lama belum `jakarta`.

### 33.2 Java 11/17 Migration

- Banyak organisasi mulai pindah dari Java EE ke Jakarta EE.
- Stronger encapsulation module era bisa mengganggu reflection internal.
- Container version harus sesuai.
- Build harus membersihkan dependency campur `javax`/`jakarta`.

### 33.3 Java 21/25 Modern Runtime

- Jakarta EE 11 baseline modern berjalan di Java SE 17+.
- Virtual threads relevan di server runtime, tetapi renderer/component tidak boleh bergantung pada thread-local behavior sembarangan.
- Jangan membuat custom component yang menyimpan request-specific data di static/thread-local tanpa cleanup.
- SecurityManager sudah bukan asumsi desain modern.
- Serialization warning tetap penting untuk view/session state.

---

## 34. Migration `javax.faces.*` ke `jakarta.faces.*`

Mapping dasar:

```text
javax.faces.component.UIComponent
  -> jakarta.faces.component.UIComponent

javax.faces.render.Renderer
  -> jakarta.faces.render.Renderer

javax.faces.convert.Converter
  -> jakarta.faces.convert.Converter

javax.faces.validator.Validator
  -> jakarta.faces.validator.Validator

javax.faces.event.PhaseListener
  -> jakarta.faces.event.PhaseListener

javax.el.ValueExpression
  -> jakarta.el.ValueExpression
```

Namun migrasi bukan search-replace saja.

Checklist:

1. update imports;
2. update dependencies;
3. update container;
4. update taglib XML schema;
5. update Facelets namespace jika perlu;
6. update component library;
7. update OmniFaces/PrimeFaces versi;
8. update generated sources jika ada;
9. cek custom converters/validators annotation;
10. cek `faces-config.xml` schema version;
11. cek custom renderer registration;
12. cek `META-INF/resources` packaging;
13. cek binary compatibility JAR;
14. jalankan integration tests.

---

## 35. Testing Custom Components

Testing custom component perlu beberapa lapis.

### 35.1 Unit Test Pure Logic

Test helper:

- CSS token sanitizer;
- label mapper;
- severity mapper;
- converter parse logic;
- validator rule.

### 35.2 Renderer Test

Renderer test lebih sulit karena butuh `FacesContext` dan `ResponseWriter`.

Strategi:

1. gunakan integration test container;
2. render halaman kecil yang memakai component;
3. parse HTML output dengan jsoup;
4. assert element, attribute, text, escaping.

Contoh assertion target:

```text
Given value = "<script>alert(1)</script>"
When component renders
Then output text is escaped, not executable markup
```

### 35.3 Lifecycle Test

Untuk input component:

1. submit form;
2. pastikan `decode()` membaca parameter;
3. pastikan conversion terjadi;
4. pastikan validation error muncul;
5. pastikan model update hanya saat valid;
6. pastikan action dipanggil hanya jika lifecycle berhasil.

### 35.4 Cross-Implementation Test

Untuk library serius, test minimal pada target implementation:

- Mojarra;
- MyFaces jika perlu portability.

---

## 36. Observability untuk Custom Extension

Custom extension harus mudah didiagnosis.

Hal yang perlu bisa dilihat:

1. component id/client id;
2. view id;
3. renderer type;
4. decode parameter missing;
5. conversion failure;
6. validation failure;
7. resource loading failure;
8. Ajax partial render target failure;
9. view state size;
10. exception correlation id.

Logging jangan dilakukan per component tanpa kontrol. Lebih baik:

- debug logging gated;
- phase timing sampled;
- request correlation id;
- error-level log hanya untuk failure nyata.

---

## 37. Enterprise Example: Secure Workflow Action Component

Kita desain component untuk menampilkan workflow action button.

Requirement:

- label action;
- severity visual;
- disabled jika tidak eligible;
- tooltip alasan disabled;
- action method expression;
- Ajax render target;
- tidak menjadi authorization final;
- accessible.

### 37.1 Facelets Usage

```xml
<app:workflowActionButton
    value="Approve"
    severity="success"
    disabled="#{!caseDetail.canApprove}"
    disabledReason="#{caseDetail.approveDisabledReason}"
    action="#{caseDetail.approve}"
    render="casePanel messages" />
```

### 37.2 Boundary Design

Component boleh:

- render button;
- display disabled reason;
- attach Ajax behavior;
- show severity class.

Backing bean/service tetap harus:

- verify user permission;
- verify case state;
- apply optimistic locking;
- audit transition;
- persist state;
- return user message.

### 37.3 Failure Model

| Failure | Mitigation |
|---|---|
| User manipulates disabled button request | Service enforces permission/state |
| Case state changed by another user | Optimistic locking/domain validation |
| Ajax render id wrong | Stable wrapper/naming container test |
| Tooltip contains unsafe text | `writeText`, not raw HTML |
| Action double clicked | server idempotency/action token |
| Component used outside form | fail-fast validation or docs |

---

## 38. Anti-Patterns

### 38.1 Business Logic in Renderer

```java
if (caseService.canApprove(caseId, user)) {
    renderApproveButton();
}
```

Better:

```java
render(caseView.getApproveAction());
```

### 38.2 Component Stores Entity Graph

```java
getStateHelper().put("case", caseEntity);
```

Better:

```java
getStateHelper().put("caseId", caseId);
```

Or better: let backing bean own data.

### 38.3 Raw HTML Attribute

```java
writer.writeAttribute("onclick", component.getAttributes().get("onclick"), null);
```

Dangerous unless tightly controlled.

### 38.4 Global Static Mutable Cache

```java
private static Map<String, Object> cache = new HashMap<>();
```

Risks:

- race condition;
- memory leak;
- classloader leak;
- tenant/user data leak.

### 38.5 Custom Component for Everything

If every small UI wrapper becomes Java component, UI iteration slows down. Use composite components first.

---

## 39. Design Checklist for Custom Faces Components

Before creating a custom component, answer:

1. Can this be a composite component?
2. Can this be a template include?
3. Can this be solved with existing standard component?
4. Does it need custom decode?
5. Does it need custom encode?
6. Does it need state saving?
7. Is state minimal and serializable?
8. Is output context-encoded?
9. Does it avoid service/database call in renderer?
10. Does it support naming containers?
11. Does it behave in data tables?
12. Does it behave in Ajax partial rendering?
13. Does it behave in multi-tab scenario?
14. Does it degrade accessibly?
15. Does it work with server/client state saving?
16. Does it work after `javax` to `jakarta` migration?
17. Is it tested through rendered HTML?
18. Is it documented as API?

---

## 40. Mini Blueprint: Internal Faces Extension Library

Untuk organisasi enterprise, library internal bisa dibagi:

```text
acme-faces-core
  - converters
  - validators
  - exception handler
  - phase diagnostics
  - resource utilities

acme-faces-components
  - status badge
  - field wrapper
  - secure command button
  - audit timeline
  - document link
  - workflow action panel

acme-faces-theme
  - CSS variables
  - resource libraries
  - accessibility defaults
  - icons

acme-faces-test
  - test harness
  - HTML assertions
  - lifecycle test utilities
```

Governance rules:

1. component API versioned;
2. breaking changes documented;
3. security review required for raw HTML/JS;
4. state budget measured;
5. migration compatibility tracked;
6. visual regression optional for complex components;
7. accessibility test included;
8. no dependency on app-specific service layer.

---

## 41. Practical Debugging Playbook

### 41.1 Component Not Rendering

Check:

1. namespace correct?
2. taglib loaded?
3. component type registered?
4. renderer type registered?
5. `rendered=false`?
6. parent not rendered?
7. exception swallowed?
8. resource missing?

### 41.2 Attribute Always Null

Check:

1. setter name correct?
2. property key correct?
3. taglib attribute maps to property?
4. EL resolves?
5. bean scope valid?
6. wrong namespace imports old tag?

### 41.3 Decode Not Called

Check:

1. component inside `h:form`?
2. request is postback?
3. component rendered in previous view?
4. name/clientId matches request parameter?
5. Ajax `execute` includes component?
6. disabled component?
7. lifecycle short-circuited?

### 41.4 Converter Not Called

Check:

1. component is `UIInput`?
2. value submitted?
3. converter attached?
4. required failed first?
5. `immediate` changes phase?
6. component not in execute list?
7. empty string converted to null?

### 41.5 Ajax Update Fails

Check:

1. render target client id/naming container;
2. target exists in tree;
3. conditional render wrapper exists;
4. partial response valid XML;
5. JS error in browser console;
6. exception during render;
7. view expired.

---

## 42. Top 1% Engineering Perspective

Engineer biasa bisa membuat custom component yang “jalan”. Engineer top-tier memastikan component itu:

1. punya lifecycle semantics yang benar;
2. tidak bocor business logic;
3. state-efficient;
4. secure by default;
5. portable antar implementation;
6. testable;
7. observable;
8. accessible;
9. migration-aware;
10. punya API stabil;
11. tidak membuat render path mahal;
12. tidak menciptakan hidden coupling.

Faces extension adalah area di mana pemahaman framework internal sangat berpengaruh. Kesalahan di level ini jarang langsung terlihat saat happy path, tetapi meledak pada:

- Ajax partial rendering;
- multi-tab usage;
- clustering;
- session timeout;
- high-volume data table;
- migration Jakarta;
- security review;
- accessibility audit;
- library upgrade.

---

## 43. Ringkasan

Custom Faces extension adalah alat kuat, tetapi harus dipakai hemat.

Urutan preferensi biasanya:

```text
standard component
  -> composite component
  -> existing library component
  -> custom converter/validator
  -> custom component + renderer
  -> lifecycle/resource/view/exception handler extension
```

Prinsip utama:

1. Composite component dulu jika cukup.
2. Renderer tidak boleh menjadi service layer.
3. Converter/validator bukan domain authority final.
4. Component state harus minimal dan serializable.
5. Output harus context-aware encoded.
6. UI authorization hanya visibility, bukan enforcement.
7. Custom extension harus diuji melalui lifecycle nyata.
8. Hindari internal implementation API.
9. Dokumentasikan component sebagai public contract.
10. Rancang untuk migration `javax` ke `jakarta`.

---

## 44. Latihan

### Latihan 1 — Output Component

Buat custom `RiskBadge` component dengan attribute:

- `value`;
- `level`;
- `styleClass`;
- `title`.

Pastikan:

- text di-escape;
- CSS class aman;
- `id` ditulis;
- tidak ada raw HTML dari user input.

### Latihan 2 — Input Component

Buat custom `UppercaseInput` yang:

- extend `UIInput`;
- render `<input type="text">`;
- decode request parameter;
- normalisasi submitted value ke uppercase;
- tetap membiarkan converter/validator berjalan.

Diskusikan apakah uppercase sebaiknya terjadi di decode, converter, atau service layer.

### Latihan 3 — Converter Boundary

Refactor converter yang melakukan `repository.findById()` menjadi pola lebih aman:

```text
submitted id
  -> Long converter
  -> backing bean validates allowed option
  -> service loads authorized entity
```

### Latihan 4 — Exception Handler

Desain exception handling untuk:

- `ViewExpiredException`;
- validation error;
- business rule violation;
- access denied;
- unexpected system error;
- Ajax request failure.

### Latihan 5 — Component Review

Ambil satu component custom dari sistem legacy. Review:

1. state size;
2. output encoding;
3. renderer service call;
4. Ajax support;
5. naming container compatibility;
6. migration readiness;
7. test coverage.

---

## 45. Preview Part Berikutnya

Part berikutnya akan membahas:

```text
25-faces-security-xss-csrf-view-state-authorization-secure-rendering.md
```

Fokusnya adalah security khusus Jakarta Faces:

- output escaping;
- raw HTML rendering;
- CSRF;
- view state tampering;
- hidden input exposure;
- client-side state protection;
- authorization-aware rendering;
- secure navigation;
- exception handling;
- CSP;
- SameSite;
- secure Faces checklist.

