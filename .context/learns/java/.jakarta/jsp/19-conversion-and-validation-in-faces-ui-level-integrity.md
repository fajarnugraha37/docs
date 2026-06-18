# Part 19 — Conversion and Validation in Faces: UI-Level Integrity

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `19-conversion-and-validation-in-faces-ui-level-integrity.md`  
> Scope: Java 8–25, Java EE/JSF `javax.*`, Jakarta EE/Jakarta Faces `jakarta.*`  
> Fokus: converter, validator, Bean/Jakarta Validation integration, message rendering, lifecycle failure model, security, dan enterprise design.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami conversion dan validation sebagai bagian dari **Jakarta Faces lifecycle**, bukan sekadar annotation atau helper class.
2. Menjelaskan kenapa conversion terjadi sebelum validation, dan kenapa model belum tentu berubah walaupun user sudah submit form.
3. Mendesain converter yang benar untuk tipe domain, enum, tanggal, angka, ID reference, dan lookup object.
4. Mendesain validator yang benar untuk aturan UI-level, cross-field validation, class-level validation, dan business rule boundary.
5. Mengintegrasikan Jakarta Validation/Bean Validation dengan Faces tanpa mencampur domain invariant, workflow authorization, dan UI constraint secara sembarangan.
6. Mendiagnosis bug umum seperti action tidak terpanggil, value tidak update, message tidak muncul, converter gagal, validator tidak jalan, required field membingungkan, dan locale parsing salah.
7. Menilai aspek security seperti hidden field tampering, ID spoofing, mass assignment, XSS dari error message, dan validation bypass.
8. Membuat pola validation enterprise yang defensible, testable, dan mudah dimigrasikan dari `javax.faces.*` ke `jakarta.faces.*`.

---

## 1. Mental Model: Conversion dan Validation Adalah Gerbang Integritas UI

Di Jakarta Faces, user input tidak langsung masuk ke model.

Input melewati beberapa lapisan:

```text
Browser string input
        |
        v
HTTP request parameter
        |
        v
UIComponent submitted value
        |
        v
Converter: String -> typed object/value
        |
        v
Validator: typed value is acceptable?
        |
        v
Local component value
        |
        v
Model update via EL binding
        |
        v
Action method / application logic
```

Konsekuensinya sangat penting:

1. Browser selalu mengirim string atau multipart data.
2. Faces component menerima submitted value.
3. Converter mengubah submitted value menjadi tipe Java.
4. Validator mengecek typed value.
5. Jika conversion atau validation gagal, lifecycle biasanya tidak lanjut ke model update dan action invocation normal.
6. Model lama tetap tidak berubah.
7. Pesan error dimasukkan ke `FacesContext`.
8. View dirender ulang dengan submitted/local value dan messages.

Ini berbeda dari REST/controller style yang sering langsung menerima DTO lalu framework melakukan binding + validation di satu tahap.

Dalam Faces, conversion dan validation melekat pada **component tree** dan **request lifecycle**.

---

## 2. Kenapa Conversion Sebelum Validation?

Validator yang baik seharusnya memvalidasi **makna**, bukan hanya string mentah.

Contoh input tanggal:

```text
"31/02/2026"
```

Sebelum validator mengecek apakah tanggal boleh di masa depan, sistem harus tahu apakah string itu valid sebagai tanggal.

Urutan yang benar:

```text
submitted string -> LocalDate converter -> LocalDate validator
```

Bukan:

```text
submitted string -> validator tanggal masa depan -> converter
```

Karena validator “tanggal masa depan” butuh object tanggal, bukan string arbitrer.

Contoh input amount:

```text
"1.000,50"
```

Di locale Indonesia, ini bisa berarti 1000.50. Di locale lain, bisa berarti format salah atau makna berbeda.

Maka conversion harus menjawab lebih dulu:

1. Apakah string ini bisa dipahami sebagai angka?
2. Dengan locale apa?
3. Dengan precision apa?
4. Tipe targetnya apa: `Integer`, `Long`, `BigDecimal`, `Double`?

Baru validator mengecek:

1. Apakah nilainya positif?
2. Apakah dalam range?
3. Apakah sesuai currency scale?
4. Apakah melebihi limit role user?

---

## 3. Posisi Conversion dan Validation dalam Lifecycle Faces

Lifecycle Faces yang sudah dibahas di Part 17:

```text
1. Restore View
2. Apply Request Values
3. Process Validations
4. Update Model Values
5. Invoke Application
6. Render Response
```

Conversion dan validation terutama terjadi di:

```text
Process Validations
```

Namun ada nuance penting:

1. Decode submitted value biasanya terjadi pada **Apply Request Values**.
2. Conversion/validation normal terjadi pada **Process Validations**.
3. Jika component memakai `immediate="true"`, conversion/validation component tertentu bisa diproses lebih awal pada **Apply Request Values**.
4. Jika conversion/validation gagal, Faces menandai request sebagai validation failed dan melompat ke render response.
5. Model tidak di-update.
6. Action method normal tidak dipanggil.

Simplified flow:

```text
POST request
  -> Restore existing view
  -> Decode request parameters into components
  -> Convert submitted values
  -> Validate converted values
  -> If any invalid:
       render same view with messages
     Else:
       update model
       invoke action
       navigate/render
```

---

## 4. Tiga Nilai Penting pada Editable Component

Untuk memahami bug Faces, kamu harus membedakan tiga konsep nilai:

```text
submitted value
local value
model value
```

### 4.1 Submitted Value

Nilai mentah dari HTTP request.

Contoh:

```text
"123"
"2026-06-18"
"APPROVED"
""
```

Biasanya string.

### 4.2 Local Value

Nilai hasil conversion yang disimpan sementara di component.

Contoh:

```java
Long.valueOf(123)
LocalDate.of(2026, 6, 18)
Decision.APPROVED
```

### 4.3 Model Value

Nilai pada backing bean/model yang di-bind via EL.

Contoh:

```xhtml
<h:inputText value="#{caseEditBean.form.dueDate}" />
```

Model value adalah:

```java
caseEditBean.getForm().setDueDate(...)
```

### 4.4 Kenapa Ini Penting?

Pada validation failure:

1. submitted/local value bisa masih ada di component,
2. model value tidak berubah,
3. halaman dirender ulang,
4. user melihat input terakhir,
5. backing bean mungkin masih berisi nilai lama.

Ini menjelaskan bug klasik:

> “Saya submit form, di layar value sudah berubah, tapi di bean masih value lama.”

Kemungkinan besar karena lifecycle berhenti sebelum Update Model Values.

---

## 5. Basic Conversion: Converter Standar

Faces menyediakan converter standar untuk tipe umum.

Contoh umum:

```xhtml
<h:inputText value="#{bean.quantity}">
    <f:convertNumber integerOnly="true" />
</h:inputText>
```

```xhtml
<h:inputText value="#{bean.amount}">
    <f:convertNumber type="currency" currencyCode="IDR" />
</h:inputText>
```

```xhtml
<h:inputText value="#{bean.submittedAt}">
    <f:convertDateTime pattern="yyyy-MM-dd" />
</h:inputText>
```

### 5.1 Prinsip Converter Standar

Converter standar cocok jika:

1. tipe target umum,
2. format deterministik,
3. tidak butuh lookup database,
4. tidak butuh authorization-aware mapping,
5. tidak butuh domain-specific parsing.

### 5.2 Kapan Converter Standar Tidak Cukup?

Converter standar tidak cukup jika input merepresentasikan:

1. domain object by ID,
2. enum dengan label localized,
3. composite key,
4. value object khusus,
5. reference data yang harus dicek aktif/tidak aktif,
6. tipe yang conversion-nya bergantung user/tenant/role.

---

## 6. Converter untuk Enum

Misal domain:

```java
public enum CasePriority {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

View:

```xhtml
<h:selectOneMenu value="#{caseEditBean.form.priority}">
    <f:selectItems value="#{caseEditBean.priorityOptions}"
                   var="p"
                   itemValue="#{p}"
                   itemLabel="#{caseEditBean.labelOf(p)}" />
</h:selectOneMenu>
```

Jika `itemValue` adalah enum langsung, Faces biasanya bisa menangani dengan converter enum jika tipe target jelas.

Namun untuk enterprise, sering lebih aman membuat option model eksplisit:

```java
public final class SelectOption<T> {
    private final T value;
    private final String label;
    private final boolean disabled;

    public SelectOption(T value, String label, boolean disabled) {
        this.value = value;
        this.label = label;
        this.disabled = disabled;
    }

    public T getValue() { return value; }
    public String getLabel() { return label; }
    public boolean isDisabled() { return disabled; }
}
```

View:

```xhtml
<h:selectOneMenu value="#{caseEditBean.form.priority}">
    <f:selectItems value="#{caseEditBean.priorityOptions}"
                   var="opt"
                   itemValue="#{opt.value}"
                   itemLabel="#{opt.label}"
                   itemDisabled="#{opt.disabled}" />
</h:selectOneMenu>
```

Keuntungan:

1. label tidak dicampur dengan enum,
2. disabled option bisa dikendalikan,
3. localization bisa dari service/message bundle,
4. authorization-aware option rendering lebih jelas,
5. testing lebih mudah.

---

## 7. Converter untuk Domain Object: Jangan Naif

Misal user memilih officer assignee:

```xhtml
<h:selectOneMenu value="#{caseAssignBean.form.assignee}">
    <f:selectItems value="#{caseAssignBean.assignableOfficers}"
                   var="officer"
                   itemValue="#{officer}"
                   itemLabel="#{officer.displayName}" />
</h:selectOneMenu>
```

Agar `itemValue` object bisa direkonstruksi dari submitted string, Faces butuh converter.

Naive converter:

```java
@FacesConverter(forClass = Officer.class)
public class OfficerConverter implements Converter<Officer> {
    @Override
    public Officer getAsObject(FacesContext context, UIComponent component, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return officerRepository.findById(Long.valueOf(value));
    }

    @Override
    public String getAsString(FacesContext context, UIComponent component, Officer officer) {
        if (officer == null) {
            return "";
        }
        return String.valueOf(officer.getId());
    }
}
```

Masalah:

1. Converter mungkin tidak CDI-managed tergantung versi/config.
2. Repository access di converter bisa membuat hidden database access di render/validation path.
3. ID dari browser bisa dimanipulasi.
4. Converter bisa mengembalikan officer yang tidak assignable untuk case tersebut.
5. Converter bisa melanggar tenant/security boundary.
6. Entity hasil lookup bisa detached/lazy-loaded.

### 7.1 Pattern yang Lebih Aman: Convert ID, Validate Eligibility

Pisahkan:

1. conversion: string → ID/value object,
2. validation: apakah ID valid dan eligible,
3. service action: re-load dan enforce authorization dalam transaction.

Form:

```java
public class AssignCaseForm implements Serializable {
    @NotNull
    private Long assigneeId;

    public Long getAssigneeId() { return assigneeId; }
    public void setAssigneeId(Long assigneeId) { this.assigneeId = assigneeId; }
}
```

View:

```xhtml
<h:selectOneMenu id="assignee"
                 value="#{caseAssignBean.form.assigneeId}"
                 required="true">
    <f:selectItem itemValue="" itemLabel="-- Select officer --" noSelectionOption="true" />
    <f:selectItems value="#{caseAssignBean.assigneeOptions}"
                   var="opt"
                   itemValue="#{opt.id}"
                   itemLabel="#{opt.label}" />
    <f:validator binding="#{caseAssignBean.assigneeEligibilityValidator}" />
</h:selectOneMenu>
<h:message for="assignee" />
```

Action:

```java
public String assign() {
    caseAssignmentService.assign(caseId, form.getAssigneeId(), currentUser.id());
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

Service tetap enforce:

```java
@Transactional
public void assign(Long caseId, Long assigneeId, Long actorId) {
    CaseRecord caseRecord = caseRepository.getForUpdate(caseId);
    User actor = userRepository.get(actorId);
    User assignee = userRepository.get(assigneeId);

    permissionService.requireCanAssign(actor, caseRecord);
    assignmentPolicy.requireAssignable(assignee, caseRecord);

    caseRecord.assignTo(assignee, actor);
}
```

Ini lebih defensible karena UI validator membantu UX, tetapi service tetap menjadi authority.

---

## 8. Converter Bukan Tempat Business Rule

Converter seharusnya menjawab:

```text
Apakah submitted representation bisa diubah menjadi tipe target?
```

Validator menjawab:

```text
Apakah nilai bertipe ini acceptable untuk field/component ini?
```

Service/domain menjawab:

```text
Apakah aksi ini sah menurut aturan bisnis, authorization, workflow, dan state saat ini?
```

Contoh boundary:

| Concern | Tempat yang Tepat | Contoh |
|---|---|---|
| String tanggal bisa diparse? | Converter | `"2026-06-18" -> LocalDate` |
| Tanggal wajib di masa depan? | Validator/UI constraint | due date >= today |
| User boleh set due date untuk case ini? | Service/domain | only supervisor can extend SLA |
| Case masih editable? | Service/domain | cannot edit closed case |
| Officer ID valid format? | Converter | string -> long |
| Officer eligible untuk assignment? | UI validator + service enforcement | officer belongs to unit |
| Actor boleh assign officer? | Service authorization | role + unit + workflow state |

---

## 9. Custom Converter Modern

Dalam Jakarta Faces modern, gunakan package `jakarta.faces.*`.

Contoh value object:

```java
public final class PostalCode implements Serializable {
    private final String value;

    private PostalCode(String value) {
        this.value = value;
    }

    public static PostalCode of(String raw) {
        if (raw == null) {
            return null;
        }
        String normalized = raw.trim();
        if (!normalized.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be 6 digits");
        }
        return new PostalCode(normalized);
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Converter:

```java
import jakarta.faces.application.FacesMessage;
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.convert.Converter;
import jakarta.faces.convert.ConverterException;
import jakarta.faces.convert.FacesConverter;

@FacesConverter(forClass = PostalCode.class)
public class PostalCodeConverter implements Converter<PostalCode> {

    @Override
    public PostalCode getAsObject(
            FacesContext context,
            UIComponent component,
            String value) {

        if (value == null || value.isBlank()) {
            return null;
        }

        try {
            return PostalCode.of(value);
        } catch (IllegalArgumentException ex) {
            FacesMessage message = new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Invalid postal code",
                    "Postal code must contain exactly 6 digits."
            );
            throw new ConverterException(message, ex);
        }
    }

    @Override
    public String getAsString(
            FacesContext context,
            UIComponent component,
            PostalCode value) {

        if (value == null) {
            return "";
        }
        return value.value();
    }
}
```

View:

```xhtml
<h:inputText id="postalCode"
             value="#{addressBean.form.postalCode}"
             maxlength="6">
    <f:converter converterId="postalCodeConverter" />
</h:inputText>
<h:message for="postalCode" />
```

Catatan: converter ID bergantung deklarasi converter. Jika memakai `forClass`, explicit converter tag sering tidak diperlukan jika tipe target jelas.

---

## 10. Converter Exception dan Message

Jika conversion gagal, converter harus melempar `ConverterException`.

Jangan:

```java
return null; // saat input invalid
```

Karena `null` bisa berarti:

1. input kosong,
2. valid empty value,
3. invalid conversion,
4. no selection.

Lebih baik jelas:

```java
throw new ConverterException(message);
```

Message ideal:

1. ringkas,
2. tidak mengekspos internal detail,
3. user-actionable,
4. localized jika aplikasi multi-language,
5. aman dari XSS.

Contoh buruk:

```text
java.time.format.DateTimeParseException at index 2: value <script>alert(1)</script>
```

Contoh baik:

```text
Tanggal tidak valid. Gunakan format dd/MM/yyyy.
```

---

## 11. Built-in Validation pada Faces

Faces menyediakan validator umum melalui tag `f:validate*`.

Contoh panjang string:

```xhtml
<h:inputText id="title" value="#{caseEditBean.form.title}" required="true">
    <f:validateLength minimum="5" maximum="120" />
</h:inputText>
<h:message for="title" />
```

Contoh angka:

```xhtml
<h:inputText id="amount" value="#{paymentBean.form.amount}">
    <f:convertNumber />
    <f:validateDoubleRange minimum="0.01" maximum="1000000" />
</h:inputText>
<h:message for="amount" />
```

Contoh regex:

```xhtml
<h:inputText id="referenceNo" value="#{caseEditBean.form.referenceNo}">
    <f:validateRegex pattern="[A-Z]{3}-[0-9]{6}" />
</h:inputText>
<h:message for="referenceNo" />
```

### 11.1 Kapan Built-in Validator Cukup?

Gunakan built-in validator untuk:

1. length,
2. numeric range,
3. regex sederhana,
4. required field,
5. simple format constraints.

Jangan gunakan built-in validator untuk:

1. cross-field rule,
2. database lookup,
3. workflow state,
4. authorization,
5. tenant-aware validation,
6. stateful validation yang butuh transaction.

---

## 12. `required="true"`: Sederhana tapi Sering Menjebak

Contoh:

```xhtml
<h:inputText id="title"
             value="#{caseEditBean.form.title}"
             required="true"
             requiredMessage="Title is required." />
<h:message for="title" />
```

`required="true"` mengecek empty submitted value.

Masalah umum:

1. empty string handling berbeda antar versi/config.
2. whitespace-only input bisa dianggap tidak empty jika tidak dinormalisasi.
3. select item placeholder harus memakai `noSelectionOption="true"` dengan benar.
4. required pada hidden/disabled field bisa membingungkan.
5. required pada conditionally rendered field harus sinkron dengan server-side rule.

### 12.1 Placeholder Select yang Benar

```xhtml
<h:selectOneMenu id="decision"
                 value="#{decisionBean.form.decision}"
                 required="true"
                 requiredMessage="Select a decision.">
    <f:selectItem itemValue="#{null}"
                  itemLabel="-- Select --"
                  noSelectionOption="true" />
    <f:selectItems value="#{decisionBean.decisionOptions}" />
</h:selectOneMenu>
<h:message for="decision" />
```

### 12.2 Required yang Conditional

Misal rejection reason wajib jika decision = REJECT.

Jangan hanya rely pada JavaScript.

View boleh membantu:

```xhtml
<h:inputTextarea id="reason"
                 value="#{decisionBean.form.reason}"
                 required="#{decisionBean.form.decision eq 'REJECT'}"
                 requiredMessage="Reason is required when rejecting." />
<h:message for="reason" />
```

Tapi service/domain tetap harus enforce:

```java
if (decision == Decision.REJECT && isBlank(reason)) {
    throw new BusinessRuleException("Reason is required when rejecting.");
}
```

---

## 13. Custom Validator Method pada Backing Bean

Untuk validation yang dekat dengan screen, method validator bisa cukup.

View:

```xhtml
<h:inputText id="slaDays" value="#{caseEditBean.form.slaDays}">
    <f:convertNumber integerOnly="true" />
    <f:validator validatorId="slaDaysValidator" />
</h:inputText>
<h:message for="slaDays" />
```

Atau method expression:

```xhtml
<h:inputText id="slaDays" value="#{caseEditBean.form.slaDays}">
    <f:convertNumber integerOnly="true" />
    <f:validator binding="#{caseEditBean.slaDaysValidator}" />
</h:inputText>
```

Namun pattern method validator yang sering dipakai:

```xhtml
<h:inputText id="slaDays" value="#{caseEditBean.form.slaDays}"
             validator="#{caseEditBean.validateSlaDays}">
    <f:convertNumber integerOnly="true" />
</h:inputText>
<h:message for="slaDays" />
```

Bean:

```java
public void validateSlaDays(
        FacesContext context,
        UIComponent component,
        Object value) {

    Integer days = (Integer) value;
    if (days == null) {
        return;
    }

    if (days < 1 || days > 90) {
        throw new ValidatorException(new FacesMessage(
                FacesMessage.SEVERITY_ERROR,
                "Invalid SLA days",
                "SLA days must be between 1 and 90."
        ));
    }
}
```

### 13.1 Kapan Method Validator Cocok?

Cocok jika:

1. rule spesifik untuk satu screen,
2. tidak reuse luas,
3. tidak butuh dependency kompleks,
4. mudah dites via bean test,
5. tidak menjadi business rule authority.

Tidak cocok jika:

1. rule dipakai banyak screen,
2. butuh dependency service,
3. butuh localization kompleks,
4. butuh metadata rule,
5. perlu konsisten lintas API/UI/batch.

---

## 14. Custom Validator Class

Validator class cocok untuk reusable UI constraint.

```java
import jakarta.faces.application.FacesMessage;
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.validator.FacesValidator;
import jakarta.faces.validator.Validator;
import jakarta.faces.validator.ValidatorException;

@FacesValidator("referenceNumberValidator")
public class ReferenceNumberValidator implements Validator<String> {

    @Override
    public void validate(
            FacesContext context,
            UIComponent component,
            String value) {

        if (value == null || value.isBlank()) {
            return;
        }

        if (!value.matches("[A-Z]{3}-[0-9]{6}")) {
            throw new ValidatorException(new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Invalid reference number",
                    "Use format ABC-123456."
            ));
        }
    }
}
```

View:

```xhtml
<h:inputText id="referenceNo" value="#{caseSearchBean.form.referenceNo}">
    <f:validator validatorId="referenceNumberValidator" />
</h:inputText>
<h:message for="referenceNo" />
```

### 14.1 Validator Class Design Rules

1. Stateless by default.
2. No mutable request-specific fields.
3. No hidden DB access unless explicitly designed and measured.
4. Throw `ValidatorException` for invalid value.
5. Return silently for valid value.
6. Treat `null` separately from invalid value; let `required` or Bean Validation handle mandatory constraint.
7. Keep messages safe and localizable.

---

## 15. Jakarta Validation Integration

Jakarta Validation, sebelumnya known as Bean Validation, menyediakan annotation-based validation pada Java object.

Contoh form model:

```java
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.FutureOrPresent;

public class CaseUpdateForm implements Serializable {

    @NotBlank(message = "Title is required.")
    @Size(max = 120, message = "Title must not exceed 120 characters.")
    private String title;

    @NotNull(message = "Due date is required.")
    @FutureOrPresent(message = "Due date must be today or in the future.")
    private LocalDate dueDate;

    // getters/setters
}
```

Faces can integrate with Bean/Jakarta Validation through component value binding.

View:

```xhtml
<h:inputText id="title" value="#{caseEditBean.form.title}" />
<h:message for="title" />

<h:inputText id="dueDate" value="#{caseEditBean.form.dueDate}">
    <f:convertDateTime type="localDate" pattern="yyyy-MM-dd" />
</h:inputText>
<h:message for="dueDate" />
```

Jika environment mendukung integration, constraints pada property bisa dijalankan dalam validation phase.

### 15.1 Manfaat Jakarta Validation

1. Constraint reusable lintas UI/API/service.
2. Deklaratif.
3. Bisa dites tanpa container Faces.
4. Mendukung validation groups.
5. Mendukung custom constraint annotation.
6. Mendukung class-level/cross-field constraint.
7. Cocok untuk form model dan command model.

### 15.2 Batas Jakarta Validation

Jakarta Validation bukan pengganti:

1. authorization,
2. workflow transition guard,
3. transaction-level consistency,
4. optimistic locking,
5. database constraint,
6. external system validation,
7. anti-tampering enforcement.

---

## 16. Form Model vs Domain Entity untuk Validation

Jangan langsung bind Faces form ke JPA entity untuk layar kompleks.

Anti-pattern:

```xhtml
<h:inputText value="#{caseEditBean.caseRecord.title}" />
<h:inputText value="#{caseEditBean.caseRecord.status}" />
<h:inputText value="#{caseEditBean.caseRecord.assignee.id}" />
```

Masalah:

1. accidental entity mutation,
2. lazy loading saat render,
3. dirty checking terlalu dini,
4. field yang tidak boleh diedit ikut terbuka,
5. mass assignment style risk,
6. validation group sulit,
7. optimistic locking boundary kabur,
8. UI constraint tercampur domain invariant.

Pattern lebih baik:

```java
public class CaseEditForm implements Serializable {
    @NotBlank
    @Size(max = 120)
    private String title;

    @Size(max = 4000)
    private String summary;

    @NotNull
    private Long version;

    // editable fields only
}
```

Backing bean:

```java
public void load() {
    CaseDetail detail = caseQueryService.getDetail(caseId);
    this.form = CaseEditForm.from(detail);
}

public String save() {
    caseCommandService.updateCase(caseId, form, currentUser.id());
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

Service:

```java
@Transactional
public void updateCase(Long caseId, CaseEditForm form, Long actorId) {
    CaseRecord record = caseRepository.getForUpdate(caseId);
    permissionService.requireCanEdit(actorId, record);
    record.requireVersion(form.getVersion());
    record.updateTitleAndSummary(form.getTitle(), form.getSummary());
}
```

---

## 17. Cross-Field Validation

Field-level validators tidak cukup untuk rule seperti:

```text
Jika decision = REJECT, reason wajib.
Jika startDate ada, endDate harus >= startDate.
Jika escalation = true, escalationReason wajib.
Jika action = TRANSFER, targetUnit wajib dan tidak boleh sama dengan currentUnit.
```

### 17.1 Option A: Bean Method Before Service Call

Di action:

```java
public String submit() {
    validateCrossFields();

    if (FacesContext.getCurrentInstance().isValidationFailed()) {
        return null;
    }

    decisionService.submit(caseId, form, currentUser.id());
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}

private void validateCrossFields() {
    if (form.getDecision() == Decision.REJECT && isBlank(form.getReason())) {
        FacesContext context = FacesContext.getCurrentInstance();
        context.addMessage("decisionForm:reason", new FacesMessage(
                FacesMessage.SEVERITY_ERROR,
                "Reason is required",
                "Reason is required when rejecting."
        ));
        context.validationFailed();
    }
}
```

Kelebihan:

1. mudah memahami screen-specific rule,
2. bisa attach message ke component tertentu,
3. tidak perlu custom annotation.

Kekurangan:

1. rule bisa tersebar,
2. reuse terbatas,
3. action method harus hati-hati memanggil validation.

### 17.2 Option B: Class-Level Jakarta Validation Constraint

Annotation:

```java
@Target(TYPE)
@Retention(RUNTIME)
@Constraint(validatedBy = RejectionReasonValidator.class)
public @interface ValidRejectionReason {
    String message() default "Reason is required when rejecting.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Form:

```java
@ValidRejectionReason
public class DecisionForm implements Serializable {
    private Decision decision;
    private String reason;
    // getters/setters
}
```

Validator:

```java
public class RejectionReasonValidator
        implements ConstraintValidator<ValidRejectionReason, DecisionForm> {

    @Override
    public boolean isValid(DecisionForm form, ConstraintValidatorContext context) {
        if (form == null) {
            return true;
        }
        if (form.getDecision() != Decision.REJECT) {
            return true;
        }
        boolean valid = form.getReason() != null && !form.getReason().isBlank();
        if (!valid) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate("Reason is required when rejecting.")
                   .addPropertyNode("reason")
                   .addConstraintViolation();
        }
        return valid;
    }
}
```

Kelebihan:

1. reusable,
2. testable tanpa Faces,
3. rule dekat dengan form model,
4. property-node bisa diarahkan ke field.

Kekurangan:

1. lebih banyak boilerplate,
2. message mapping ke Faces component bisa tidak selalu semulus field-level,
3. jangan masukkan authorization/workflow state yang butuh transaction.

---

## 18. Validation Groups

Validation groups membantu ketika satu form model dipakai untuk beberapa action.

Contoh:

```java
public interface DraftChecks {}
public interface SubmitChecks {}
```

Form:

```java
public class ApplicationForm implements Serializable {

    @NotBlank(groups = SubmitChecks.class)
    private String applicantName;

    @NotBlank(groups = SubmitChecks.class)
    private String declarationAccepted;

    @Size(max = 4000, groups = {DraftChecks.class, SubmitChecks.class})
    private String remarks;
}
```

Use case:

1. Save draft: hanya minimal constraints.
2. Submit: full constraints.
3. Approve: decision constraints.
4. Reject: reason constraints.

### 18.1 Design Warning

Validation groups bisa menjadi rumit jika terlalu banyak.

Jika group sudah seperti ini:

```text
DraftChecks
SubmitChecks
OfficerSubmitChecks
ManagerApproveChecks
ManagerRejectChecks
AdminOverrideChecks
ExternalReviewChecks
ResubmissionChecks
```

Mungkin model form/action perlu dipisah.

Lebih baik:

```text
SubmitApplicationForm
ApproveApplicationForm
RejectApplicationForm
TransferCaseForm
```

Daripada satu form raksasa dengan group matrix yang sulit dipahami.

---

## 19. Message Rendering: `h:message`, `h:messages`, dan FacesMessage

Faces message adalah bagian penting UX.

Single field message:

```xhtml
<h:inputText id="title" value="#{caseEditBean.form.title}" required="true" />
<h:message for="title" styleClass="field-error" />
```

Global messages:

```xhtml
<h:messages globalOnly="true" layout="list" styleClass="global-messages" />
```

Programmatic message:

```java
FacesContext.getCurrentInstance().addMessage(null, new FacesMessage(
        FacesMessage.SEVERITY_ERROR,
        "Save failed",
        "The case was updated by another user. Reload and try again."
));
```

Message attached to component:

```java
FacesContext.getCurrentInstance().addMessage("caseForm:title", new FacesMessage(
        FacesMessage.SEVERITY_ERROR,
        "Invalid title",
        "Title contains unsupported characters."
));
```

### 19.1 Component Client ID Problem

Dalam naming container, component id bisa menjadi:

```text
caseForm:section:field
```

Jika message tidak muncul, cek client ID.

Debug helper:

```java
public static void addComponentMessage(UIComponent component, FacesMessage message) {
    FacesContext context = FacesContext.getCurrentInstance();
    context.addMessage(component.getClientId(context), message);
}
```

### 19.2 Message Severity

Common severities:

1. `INFO`
2. `WARN`
3. `ERROR`
4. `FATAL`

Design rule:

1. validation failures → `ERROR`,
2. successful save → `INFO`,
3. recoverable warning → `WARN`,
4. system-level unrecoverable UI error → usually global `ERROR`, not necessarily `FATAL`.

---

## 20. Localized Validation Messages

Enterprise UI biasanya butuh i18n.

Message bundle:

```properties
case.title.required=Title is required.
case.title.max=Title must not exceed {0} characters.
case.dueDate.future=Due date must be today or in the future.
case.reject.reasonRequired=Reason is required when rejecting.
```

Bean helper:

```java
public String msg(String key, Object... args) {
    FacesContext context = FacesContext.getCurrentInstance();
    ResourceBundle bundle = context.getApplication()
            .getResourceBundle(context, "msg");
    String pattern = bundle.getString(key);
    return MessageFormat.format(pattern, args);
}
```

Validator:

```java
throw new ValidatorException(new FacesMessage(
        FacesMessage.SEVERITY_ERROR,
        msg("case.reject.reasonRequired"),
        msg("case.reject.reasonRequired")
));
```

### 20.1 Localization Pitfalls

1. Jangan concatenate grammar-sensitive message.
2. Jangan taruh raw user input dalam message tanpa escaping/rendering aman.
3. Jangan expose internal enum name sebagai label.
4. Jangan membuat converter date/number tidak sinkron dengan locale tampilan.
5. Jangan membuat message berbeda antara client-side dan server-side validation tanpa alasan.

---

## 21. Date/Time Conversion: Area yang Sangat Rawan

Tanggal dan waktu adalah sumber bug besar.

Pertanyaan yang harus dijawab:

1. Apakah field adalah date-only atau timestamp?
2. Apakah butuh timezone?
3. Apakah input mengikuti locale user?
4. Apakah disimpan sebagai `LocalDate`, `LocalDateTime`, `OffsetDateTime`, `Instant`, atau legacy `Date`?
5. Apakah due date punya cut-off time?
6. Apakah perbandingan “today” memakai timezone user atau server?

### 21.1 Date-only untuk UI

Untuk tanggal seperti due date, gunakan `LocalDate` jika memungkinkan.

```java
private LocalDate dueDate;
```

View:

```xhtml
<h:inputText id="dueDate" value="#{caseEditBean.form.dueDate}">
    <f:convertDateTime type="localDate" pattern="yyyy-MM-dd" />
</h:inputText>
<h:message for="dueDate" />
```

### 21.2 Timestamp untuk Audit

Untuk audit event, jangan minta user input bebas jika tidak perlu. Tampilkan saja:

```xhtml
<h:outputText value="#{auditRow.createdAt}">
    <f:convertDateTime type="localDateTime" pattern="yyyy-MM-dd HH:mm:ss" />
</h:outputText>
```

### 21.3 Rule Penting

1. Date-only jangan dipaksa menjadi midnight timestamp tanpa desain timezone.
2. Audit timestamp lebih aman sebagai `Instant`/database timestamp with timezone semantics.
3. Input user yang timezone-sensitive harus eksplisit timezone-nya.
4. Jangan membandingkan `LocalDate.now()` tanpa mempertimbangkan user zone untuk aplikasi multi-region.

---

## 22. Number and Currency Conversion

Money/amount harus sangat hati-hati.

Gunakan `BigDecimal`, bukan `double`.

```java
@NotNull
@DecimalMin("0.01")
@Digits(integer = 12, fraction = 2)
private BigDecimal feeAmount;
```

View:

```xhtml
<h:inputText id="feeAmount" value="#{feeBean.form.feeAmount}">
    <f:convertNumber minFractionDigits="2" maxFractionDigits="2" />
</h:inputText>
<h:message for="feeAmount" />
```

### 22.1 Pitfalls

1. `Double` introduces precision issues.
2. Locale changes decimal separator.
3. Currency formatting may include symbol, grouping, and negative formats.
4. `BigDecimal` scale matters.
5. Rounding belongs in domain/service policy, not arbitrary converter.

---

## 23. Null, Empty String, dan Whitespace

User input kosong bisa menjadi:

```text
null
""
"   "
```

Pertanyaan desain:

1. Apakah whitespace-only dianggap empty?
2. Apakah optional string disimpan sebagai `null` atau empty string?
3. Apakah converter normalize input?
4. Apakah validation dilakukan sebelum atau sesudah trim?

### 23.1 Normalization Pattern

Untuk form model, sering lebih baik normalisasi sebelum command:

```java
public void normalize() {
    title = trimToNull(title);
    summary = trimToNull(summary);
    referenceNo = upperTrimToNull(referenceNo);
}
```

Action:

```java
public String save() {
    form.normalize();
    // optionally validate cross-field after normalization
    caseService.save(caseId, form, currentUser.id());
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

Namun hati-hati: jika Jakarta Validation otomatis berjalan sebelum action, normalization di action terlalu terlambat untuk beberapa constraints. Alternatif:

1. custom converter for normalized value,
2. setter normalizes,
3. custom validation constraint trims internally,
4. pre-validation listener/filter pattern.

---

## 24. UI Validation vs Domain Validation vs Database Constraint

Top-tier engineer tidak memandang validation sebagai satu lapisan.

Ia melihatnya sebagai defense-in-depth.

```text
Browser/client hint
  -> Faces component validation
  -> form model validation
  -> service/application rule
  -> domain invariant
  -> database constraint
  -> external system validation
```

### 24.1 Layer Responsibility

| Layer | Role | Jangan Dijadikan Satu-satunya Authority |
|---|---|---|
| HTML attributes | UX hint | Bisa dibypass |
| JavaScript validation | Fast feedback | Bisa dimatikan/dimanipulasi |
| Faces validation | UI integrity | Tidak cukup untuk authorization/workflow |
| Jakarta Validation | Object constraint | Tidak cukup untuk transaction/state race |
| Service validation | Use-case invariant | Harus tetap dibantu DB/domain |
| Domain model | Core invariant | Tidak tahu semua UI context |
| DB constraint | Last line of consistency | Error UX buruk jika hanya rely DB |

### 24.2 Case Management Example

Rule:

```text
Officer may approve an application only if:
- decision is APPROVE,
- remarks length <= 4000,
- all required checklist items are completed,
- case is currently in PENDING_REVIEW,
- actor has APPROVER role for the unit,
- record version matches,
- no active legal hold prevents approval.
```

Mapping:

| Rule | Layer |
|---|---|
| decision required | Faces/Jakarta Validation |
| remarks length | Faces/Jakarta Validation + DB column |
| checklist completed | service/application |
| case state PENDING_REVIEW | domain/service |
| actor role/unit | authorization service |
| version matches | optimistic locking/domain/service |
| legal hold | domain/service |

---

## 25. Hidden Field Tampering

Hidden fields are not secure.

View:

```xhtml
<h:inputHidden value="#{caseEditBean.form.caseId}" />
<h:inputHidden value="#{caseEditBean.form.version}" />
```

User can modify them.

Therefore:

1. `caseId` from hidden field must be checked against URL/session/server state.
2. `version` can be used for optimistic lock, but must be verified.
3. `role`, `status`, `price`, `permission`, `ownerId` should not be trusted from hidden input.
4. Select options submitted from browser must be validated server-side.

### 25.1 Safer Pattern

Use URL/view param or server-side loaded context for identity:

```xhtml
<f:metadata>
    <f:viewParam name="caseId" value="#{caseEditBean.caseId}" required="true" />
    <f:viewAction action="#{caseEditBean.load}" />
</f:metadata>
```

Use hidden field only for concurrency token/version:

```xhtml
<h:inputHidden value="#{caseEditBean.form.version}" />
```

Service checks:

```java
record.requireVersion(form.getVersion());
permissionService.requireCanEdit(actor, record);
```

---

## 26. Select Item Tampering

Even if UI renders only allowed options:

```xhtml
<h:selectOneMenu value="#{bean.form.decision}">
    <f:selectItems value="#{bean.allowedDecisions}" />
</h:selectOneMenu>
```

User can submit a value not present in the UI.

Validation must ensure submitted decision is allowed.

```java
public void validateDecision(FacesContext context, UIComponent component, Object value) {
    Decision decision = (Decision) value;
    if (!allowedDecisions.contains(decision)) {
        throw new ValidatorException(new FacesMessage(
                FacesMessage.SEVERITY_ERROR,
                "Invalid decision",
                "The selected decision is not allowed for the current case."
        ));
    }
}
```

But service must still enforce:

```java
workflowService.requireTransitionAllowed(caseRecord, actor, decision);
```

---

## 27. `immediate="true"` and Validation Skipping

`immediate="true"` changes lifecycle timing.

Common use:

```xhtml
<h:commandButton value="Cancel"
                 action="#{bean.cancel}"
                 immediate="true" />
```

Goal: cancel button should not trigger validation of the whole form.

### 27.1 Danger

If used on input components or submit buttons without understanding, it can cause:

1. validation firing earlier,
2. model not updated as expected,
3. action sees old values,
4. required fields skipped unintentionally,
5. inconsistent UX.

### 27.2 Rule of Thumb

Use `immediate="true"` mainly for:

1. cancel/back buttons,
2. navigation actions that intentionally ignore form input,
3. special components where early processing is understood.

Avoid using it as a random fix for:

```text
action not called
validation blocks submit
value not updated
```

Those bugs should be diagnosed via lifecycle.

---

## 28. Ajax Validation

Faces Ajax can execute only part of the component tree.

Example:

```xhtml
<h:inputText id="referenceNo" value="#{caseBean.form.referenceNo}">
    <f:ajax event="blur" execute="@this" render="referenceNoMessage" />
    <f:validator validatorId="referenceNumberValidator" />
</h:inputText>
<h:message id="referenceNoMessage" for="referenceNo" />
```

Here only `referenceNo` participates in ajax lifecycle.

### 28.1 Ajax Pitfalls

1. Cross-field validator may not have other field's latest submitted value.
2. Rendering a message without executing component does nothing.
3. Executing `@this` only updates that component, not the whole form model.
4. Conditional rendering can remove target from tree.
5. Component IDs inside naming containers can be wrong.
6. Ajax validation cannot replace final full submit validation.

### 28.2 Cross-Field Ajax Example

If end date depends on start date:

```xhtml
<h:inputText id="startDate" value="#{bean.form.startDate}">
    <f:convertDateTime type="localDate" pattern="yyyy-MM-dd" />
</h:inputText>

<h:inputText id="endDate" value="#{bean.form.endDate}">
    <f:convertDateTime type="localDate" pattern="yyyy-MM-dd" />
    <f:ajax event="blur" execute="startDate endDate" render="dateMessages" />
</h:inputText>

<h:panelGroup id="dateMessages">
    <h:message for="startDate" />
    <h:message for="endDate" />
</h:panelGroup>
```

But depending on naming containers, IDs may need full/relative client IDs.

---

## 29. Validation and Data Tables

Validation inside `h:dataTable` has extra complexity:

1. repeated row components,
2. row index in client ID,
3. per-row messages,
4. model update per row,
5. pagination/sorting can change rows,
6. lazy loading can break submitted row identity.

Example:

```xhtml
<h:dataTable value="#{bulkEditBean.rows}" var="row" rowIndexVar="idx">
    <h:column>
        <h:inputText id="amount" value="#{row.amount}">
            <f:convertNumber />
            <f:validateDoubleRange minimum="0" />
        </h:inputText>
        <h:message for="amount" />
    </h:column>
</h:dataTable>
```

### 29.1 Bulk Edit Warning

For complex bulk edit:

1. use stable row IDs,
2. avoid binding directly to JPA entities,
3. use row form models,
4. include version per row if updating persisted records,
5. validate server-side per row in service,
6. show row-level and global summary messages.

---

## 30. File Upload Validation

File upload validation has special risks.

Validation concerns:

1. file required/not required,
2. max size,
3. content type,
4. extension,
5. actual magic bytes,
6. malware scan,
7. filename sanitization,
8. storage path safety,
9. duplicate detection,
10. authorization to upload,
11. retention policy.

UI-level validation is not enough.

Pattern:

```text
Faces upload component
  -> basic UI validation
  -> upload service
  -> content inspection
  -> virus scan / DLP if required
  -> store outside webroot
  -> metadata persisted transactionally
```

Never trust:

1. browser MIME type,
2. original filename,
3. extension alone,
4. hidden document type,
5. client-side max-size only.

---

## 31. Client-Side Validation: Useful but Not Authoritative

HTML5 attributes can improve UX:

```xhtml
<h:inputText id="postalCode"
             value="#{bean.form.postalCode}"
             maxlength="6"
             pt:pattern="\d{6}"
             pt:inputmode="numeric" />
```

But:

1. browser support varies,
2. user can disable JS,
3. HTTP request can be crafted,
4. validation must remain server-side.

Client validation is a hint, not a gate.

---

## 32. Bean Validation and Records / Java 17+

Jakarta Validation 3.1 clarifies support for Java Records and targets Jakarta EE 11.

For form models in Java 17+, records can be useful for immutable command objects:

```java
public record ApproveCaseCommand(
        @NotNull Long caseId,
        @NotNull Long version,
        @Size(max = 4000) String remarks
) {}
```

However Faces form binding usually expects mutable properties because UI components update model values through setters.

Therefore:

1. mutable form bean is still common for Faces views,
2. convert mutable form to immutable command record at action boundary,
3. validate command at service boundary if needed.

Pattern:

```java
public String approve() {
    ApproveCaseCommand command = new ApproveCaseCommand(
            caseId,
            form.getVersion(),
            form.getRemarks()
    );
    caseService.approve(command, currentUser.id());
    return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
}
```

---

## 33. Java 8–25 Compatibility Notes

### 33.1 Java 8 / Java EE / JSF 2.x

Typical packages:

```java
javax.faces.*
javax.validation.*
```

Common environment:

1. JSF 2.2/2.3,
2. Bean Validation 1.1/2.0,
3. CDI 1.x/2.x,
4. Java EE 7/8 servers.

### 33.2 Jakarta EE 8

Still `javax.*`, but under Eclipse/Jakarta governance.

### 33.3 Jakarta EE 9+

Namespace break:

```java
javax.faces.*      -> jakarta.faces.*
javax.validation.* -> jakarta.validation.*
javax.el.*         -> jakarta.el.*
javax.servlet.*    -> jakarta.servlet.*
```

### 33.4 Jakarta EE 10/11

Modern packages are `jakarta.*`.

Jakarta Faces 4.x removes/deprecates some legacy JSF-era assumptions and aligns with modern Jakarta EE.

### 33.5 Java 21/25 Runtime Considerations

1. Avoid reflection hacks against internal JDK APIs.
2. Prefer standard `java.time` types over legacy `Date` where Faces/converters support it.
3. Use records at command/service boundary, not necessarily as mutable Faces form models.
4. Be aware of container compatibility with your target JDK.
5. Virtual threads do not remove need for correct validation/service boundaries.

---

## 34. Migration: `javax.faces.validator` to `jakarta.faces.validator`

Typical migration:

```java
import javax.faces.validator.Validator;
import javax.faces.validator.ValidatorException;
```

becomes:

```java
import jakarta.faces.validator.Validator;
import jakarta.faces.validator.ValidatorException;
```

Similarly:

```java
javax.faces.convert.Converter
javax.faces.convert.ConverterException
javax.faces.application.FacesMessage
javax.faces.context.FacesContext
javax.validation.constraints.NotNull
```

becomes:

```java
jakarta.faces.convert.Converter
jakarta.faces.convert.ConverterException
jakarta.faces.application.FacesMessage
jakarta.faces.context.FacesContext
jakarta.validation.constraints.NotNull
```

### 34.1 Migration Checklist

1. Update imports.
2. Update dependencies.
3. Update server/container version.
4. Update third-party component libraries.
5. Update custom validators/converters.
6. Update custom annotations using validation packages.
7. Re-run JSP/Facelets compilation smoke test.
8. Re-run form validation regression tests.
9. Check message bundle keys if implementation changed defaults.
10. Validate date/time converter behavior.
11. Validate `empty string -> null` behavior.
12. Validate CDI injection in validators/converters.

---

## 35. Debugging Playbook: Action Tidak Dipanggil

Symptom:

```text
Button clicked, but action method not executed.
```

Likely causes:

1. conversion failed,
2. validation failed,
3. required field failed,
4. component not inside `h:form`,
5. nested form invalid HTML,
6. ajax execute excludes button/form,
7. wrong lifecycle due to `immediate`,
8. view expired,
9. JavaScript error before submit,
10. command component not rendered/disabled.

Steps:

1. Add global messages:

```xhtml
<h:messages globalOnly="false" layout="list" />
```

2. Check each field message.
3. Check browser network request payload.
4. Check server logs for converter/validator exception.
5. Add `PhaseListener` temporarily.
6. Simplify ajax: use full submit.
7. Remove `immediate` temporarily.
8. Verify `h:form` wraps input and command.

---

## 36. Debugging Playbook: Value Tidak Update di Bean

Symptom:

```text
User typed new value, page submitted, but bean property still old.
```

Likely causes:

1. validation failed before Update Model Values,
2. converter failed,
3. input disabled,
4. input not executed in ajax,
5. value bound to wrong bean/scope,
6. getter returns new object every time,
7. setter not called or has logic bug,
8. bean recreated due to wrong scope,
9. duplicate component IDs,
10. field outside submitted form.

Diagnostic:

```java
public void setTitle(String title) {
    System.out.println("setTitle called: " + title);
    this.title = title;
}
```

Better production-safe diagnostic:

1. lifecycle trace in lower env,
2. request correlation id,
3. validation failure logging,
4. component id in messages.

---

## 37. Debugging Playbook: Message Tidak Muncul

Likely causes:

1. no `h:message`/`h:messages`,
2. wrong `for` target,
3. message added to wrong client ID,
4. ajax render excludes message component,
5. message component conditionally not rendered,
6. CSS hides message,
7. redirect loses request messages unless flash used,
8. global message but only field message rendered.

Fix examples:

```xhtml
<h:messages id="allMessages" globalOnly="false" />
```

Ajax:

```xhtml
<f:ajax execute="@form" render="allMessages formPanel" />
```

For redirect success message:

```java
FacesContext context = FacesContext.getCurrentInstance();
context.getExternalContext().getFlash().setKeepMessages(true);
context.addMessage(null, new FacesMessage("Saved successfully."));
return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
```

---

## 38. Debugging Playbook: Converter Called Too Often

Converters can be called during:

1. validation/conversion,
2. rendering selected values,
3. rendering select items,
4. state restoration scenarios.

If converter hits database every time, performance can collapse.

Better strategies:

1. use ID form field instead of object converter,
2. cache request-level lookup map,
3. pre-load options in backing bean,
4. avoid entity converter for large tables,
5. keep converter pure where possible,
6. move eligibility check to validator/service.

---

## 39. Enterprise Pattern: Validation Pipeline for Case Workflow Action

Use case:

```text
Officer submits decision: APPROVE / REJECT / REQUEST_INFO
```

### 39.1 View

```xhtml
<h:form id="decisionForm">
    <h:selectOneMenu id="decision"
                     value="#{decisionBean.form.decision}"
                     required="true"
                     requiredMessage="Select a decision."
                     validator="#{decisionBean.validateDecisionAllowed}">
        <f:selectItem itemValue="#{null}"
                      itemLabel="-- Select --"
                      noSelectionOption="true" />
        <f:selectItems value="#{decisionBean.decisionOptions}"
                       var="opt"
                       itemValue="#{opt.value}"
                       itemLabel="#{opt.label}"
                       itemDisabled="#{opt.disabled}" />
    </h:selectOneMenu>
    <h:message for="decision" />

    <h:inputTextarea id="remarks"
                     value="#{decisionBean.form.remarks}">
        <f:validateLength maximum="4000" />
    </h:inputTextarea>
    <h:message for="remarks" />

    <h:commandButton value="Submit"
                     action="#{decisionBean.submit}" />

    <h:messages globalOnly="true" />
</h:form>
```

### 39.2 Form

```java
public class DecisionForm implements Serializable {
    @NotNull
    private Decision decision;

    @Size(max = 4000)
    private String remarks;

    @NotNull
    private Long version;

    public void normalize() {
        remarks = trimToNull(remarks);
    }

    // getters/setters
}
```

### 39.3 Bean

```java
@Named
@ViewScoped
public class DecisionBean implements Serializable {

    private Long caseId;
    private DecisionForm form;
    private List<DecisionOption> decisionOptions;

    @Inject
    private CaseDecisionService decisionService;

    public void validateDecisionAllowed(
            FacesContext context,
            UIComponent component,
            Object value) {

        Decision decision = (Decision) value;
        if (decision == null) {
            return;
        }

        boolean allowed = decisionOptions.stream()
                .anyMatch(opt -> opt.value() == decision && !opt.disabled());

        if (!allowed) {
            throw new ValidatorException(new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Decision not allowed",
                    "The selected decision is not allowed for this case."
            ));
        }
    }

    public String submit() {
        form.normalize();
        validateCrossFields();

        FacesContext context = FacesContext.getCurrentInstance();
        if (context.isValidationFailed()) {
            return null;
        }

        try {
            decisionService.submitDecision(caseId, form, currentUserId());
            context.getExternalContext().getFlash().setKeepMessages(true);
            context.addMessage(null, new FacesMessage("Decision submitted."));
            return "case-detail?faces-redirect=true&amp;caseId=" + caseId;
        } catch (OptimisticLockException ex) {
            context.addMessage(null, new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Case was updated by another user.",
                    "Reload the page and review the latest case details."
            ));
            context.validationFailed();
            return null;
        } catch (BusinessRuleException ex) {
            context.addMessage(null, new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Decision cannot be submitted.",
                    ex.getUserSafeMessage()
            ));
            context.validationFailed();
            return null;
        }
    }

    private void validateCrossFields() {
        FacesContext context = FacesContext.getCurrentInstance();
        if (form.getDecision() == Decision.REJECT && isBlank(form.getRemarks())) {
            context.addMessage("decisionForm:remarks", new FacesMessage(
                    FacesMessage.SEVERITY_ERROR,
                    "Remarks required",
                    "Remarks are required when rejecting."
            ));
            context.validationFailed();
        }
    }
}
```

### 39.4 Service

```java
@Transactional
public void submitDecision(Long caseId, DecisionForm form, Long actorId) {
    CaseRecord record = caseRepository.getForUpdate(caseId);
    User actor = userRepository.get(actorId);

    permissionService.requireCanDecide(actor, record);
    record.requireVersion(form.getVersion());
    workflowPolicy.requireDecisionAllowed(record, actor, form.getDecision());
    record.submitDecision(form.getDecision(), form.getRemarks(), actor);
}
```

Important pattern:

```text
UI validation improves UX.
Service validation enforces truth.
Domain transition protects invariants.
DB constraints protect persistence consistency.
```

---

## 40. Anti-Patterns

### 40.1 Business Rule in Converter

```java
return caseService.approveIfValid(value);
```

Salah karena converter tidak boleh menjalankan use-case.

### 40.2 Repository Lookup in Every `getAsString`

```java
public String getAsString(...) {
    return repository.findLabel(entity.getId());
}
```

Render path menjadi query generator.

### 40.3 Binding Directly to Entity Graph

```xhtml
<h:inputText value="#{bean.caseRecord.applicant.address.postalCode}" />
```

Rawan lazy loading, mutation, dan mass assignment.

### 40.4 Rely on `rendered=false` for Security

```xhtml
<h:commandButton rendered="#{bean.canApprove}" action="#{bean.approve}" />
```

Ini hanya menyembunyikan tombol. Service tetap harus enforce.

### 40.5 Required Everything Without Workflow Context

Form multi-action sering butuh validation berbeda untuk draft vs submit.

Jika semua field `required=true`, save draft menjadi tidak bisa.

### 40.6 Catching ValidatorException and Continuing

```java
try {
   validator.validate(...);
} catch (ValidatorException ex) {
   log.warn(...);
}
```

Ini membypass validation.

### 40.7 Showing Raw Exception Message to User

```java
new FacesMessage(ex.toString())
```

Rawan leakage dan UX buruk.

---

## 41. Testing Strategy

### 41.1 Unit Test Converter

```java
@Test
void postalCodeConverterRejectsNonDigits() {
    PostalCodeConverter converter = new PostalCodeConverter();

    assertThrows(ConverterException.class, () ->
            converter.getAsObject(mockFacesContext(), mockComponent(), "ABC123")
    );
}
```

### 41.2 Unit Test Validator

```java
@Test
void referenceNumberValidatorRejectsInvalidFormat() {
    ReferenceNumberValidator validator = new ReferenceNumberValidator();

    assertThrows(ValidatorException.class, () ->
            validator.validate(mockFacesContext(), mockComponent(), "bad")
    );
}
```

### 41.3 Jakarta Validation Test

```java
Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
Set<ConstraintViolation<CaseUpdateForm>> violations = validator.validate(form);
assertThat(violations).extracting(ConstraintViolation::getPropertyPath)
        .map(Object::toString)
        .contains("title");
```

### 41.4 Integration Test

Test dengan container untuk memastikan:

1. converter registered,
2. validator registered,
3. message rendered,
4. lifecycle stops on validation failure,
5. model not updated on invalid value,
6. action not invoked on invalid value,
7. ajax render target works.

### 41.5 Security Tests

1. Submit hidden field tampered.
2. Submit disabled option manually.
3. Submit unauthorized decision.
4. Submit overlength remarks.
5. Submit XSS payload in text field.
6. Submit invalid enum value.
7. Submit stale version.
8. Submit cross-field invalid form.

---

## 42. Review Checklist

### 42.1 Converter Checklist

- [ ] Does converter only convert representation to type?
- [ ] Does it throw `ConverterException` on invalid input?
- [ ] Is message user-safe?
- [ ] Does it avoid unnecessary database lookup?
- [ ] Is it stateless/thread-safe?
- [ ] Is locale handled correctly?
- [ ] Does `getAsString` avoid expensive work?
- [ ] Is object identity stable for select components?

### 42.2 Validator Checklist

- [ ] Is the rule UI-level or business-level?
- [ ] Is mandatory field handled by `required`/`@NotNull`/`@NotBlank`?
- [ ] Is null handled intentionally?
- [ ] Is cross-field rule placed appropriately?
- [ ] Is message attached to correct component/global context?
- [ ] Is validation also enforced in service when security/business critical?
- [ ] Does Ajax execute all needed fields?
- [ ] Are messages rendered in Ajax response?

### 42.3 Form Design Checklist

- [ ] Is form model separate from JPA entity?
- [ ] Are only editable fields exposed?
- [ ] Is normalization explicit?
- [ ] Are validation groups understandable?
- [ ] Is optimistic version included when needed?
- [ ] Are hidden fields treated as untrusted?
- [ ] Are select options revalidated server-side?

### 42.4 Security Checklist

- [ ] No authorization only in UI rendering.
- [ ] Hidden fields validated server-side.
- [ ] Select values checked against allowed set.
- [ ] Error messages do not leak internals.
- [ ] User input in messages is escaped/sanitized.
- [ ] File upload validation is layered.
- [ ] Service enforces workflow/permission/state.
- [ ] DB/domain constraints protect final consistency.

---

## 43. Key Takeaways

1. Faces conversion and validation are lifecycle-driven.
2. Conversion turns browser strings into typed values.
3. Validation checks whether typed values are acceptable.
4. If conversion/validation fails, model update and action invocation usually do not happen.
5. `submitted value`, `local value`, and `model value` are different concepts.
6. Converter is not a business rule engine.
7. Validator is not an authorization layer.
8. Jakarta Validation is powerful, but not a replacement for service/domain enforcement.
9. Form model is safer than binding directly to entity.
10. Hidden fields and select options are untrusted input.
11. Ajax validation only processes executed components.
12. `immediate="true"` is a lifecycle tool, not a random bug fix.
13. Messages must be attached, rendered, localized, and safe.
14. Top-tier Faces engineering means designing validation as a layered integrity system, not as scattered UI checks.

---

## 44. Hubungan dengan Part Berikutnya

Bagian ini menjelaskan integrity gate pada input.

Part berikutnya akan membahas:

```text
20-navigation-actions-events-application-flow-in-faces.md
```

Fokus berikutnya:

1. action methods,
2. action listeners,
3. value change listeners,
4. system/component events,
5. implicit dan explicit navigation,
6. redirect vs forward,
7. POST-Redirect-GET,
8. flash scope,
9. multi-step wizard,
10. idempotency dan double-submit protection.

Dengan kata lain, setelah input valid, kita akan membahas bagaimana aplikasi memutuskan **aksi apa yang dijalankan dan halaman mana yang dituju**.

---

## 45. Referensi Utama

- Jakarta Faces 4.1 Specification — Jakarta EE 11.
- Jakarta EE Tutorial: Jakarta Faces lifecycle, converters, validators, listeners.
- Jakarta Validation 3.1 Specification — Jakarta EE 11.
- Jakarta Expression Language 6.0 Specification.
- OWASP guidance for input validation and output encoding.
- Implementation references: Eclipse Mojarra, Apache MyFaces, Hibernate Validator.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 18 — Faces Components: Input, Output, Command, Data, Message, and Metadata](./18-faces-components-input-output-command-data-message-metadata.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 20 — Navigation, Actions, Events, and Application Flow in Faces](./20-navigation-actions-events-application-flow-in-faces.md)

</div>