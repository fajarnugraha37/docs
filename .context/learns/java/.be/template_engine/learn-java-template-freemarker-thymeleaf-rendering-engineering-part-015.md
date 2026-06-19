# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-015

# Part 15 — Thymeleaf Forms, Binding, Validation, and Error Rendering

## Status Seri

- Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`
- Part: `015`
- Topik: `Thymeleaf Forms, Binding, Validation, and Error Rendering`
- Scope Java: Java 8 sampai Java 25
- Status: selesai untuk Part 15, seri belum selesai
- Prasyarat konseptual:
  - Part 12 — Thymeleaf Fundamental Architecture
  - Part 13 — Thymeleaf Standard Expressions Deep Dive
  - Part 14 — Thymeleaf Attributes, DOM Transformation, and Natural HTML
  - Seri sebelumnya tentang Jakarta Validation / Hibernate Validator
  - Seri sebelumnya tentang Servlet, Spring-like MVC, HTTP, Security, dan CSRF

---

## 1. Tujuan Bagian Ini

Bagian ini membahas Thymeleaf untuk **form rendering**, **binding**, **validation feedback**, dan **error rendering** pada aplikasi Java server-side.

Kita tidak akan belajar form sebagai sekadar kumpulan `<input>` dan tombol submit. Di sistem production, form adalah **kontrak input antara manusia, browser, HTTP request, server-side binder, validator, use case, dan domain rule**.

Mental model utama bagian ini:

```text
Form Template
  + Form Backing Object
  + Binding Metadata
  + Validation Errors
  + Security Context
  + Locale/MessageSource
  + Request Lifecycle
  = Safe and Recoverable User Input Flow
```

Tujuan akhirnya adalah membuat Anda mampu mendesain form Thymeleaf yang:

1. aman terhadap XSS, CSRF, over-posting, dan parameter tampering;
2. jelas memisahkan view model, command object, entity, dan domain object;
3. dapat menampilkan field error dan global error secara konsisten;
4. mendukung enum, collection, nested object, checkbox, radio, date/time, dan dynamic rows;
5. tidak kehilangan input user ketika validasi gagal;
6. mudah dites;
7. dapat diintegrasikan dengan Java 8 sampai Java 25, Spring MVC, Jakarta Validation, dan Spring Security;
8. cocok untuk enterprise workflow seperti case management, approval form, correspondence form, escalation form, dan regulatory input screen.

---

## 2. Apa Yang Tidak Akan Diulang

Kita tidak akan mengulang:

- dasar HTML form;
- dasar HTTP method GET/POST;
- detail Jakarta Validation annotation satu per satu;
- detail Spring MVC controller secara umum;
- detail CSRF secara umum;
- dasar `th:text`, `th:each`, `th:if`, dan expression syntax.

Yang akan dibahas adalah bagaimana semua itu bertemu di boundary paling rawan error: **form rendering dan form submission**.

---

## 3. Form Adalah Kontrak, Bukan Tampilan

Banyak developer melihat form seperti ini:

```text
HTML input -> user submit -> controller save
```

Itu terlalu dangkal.

Di production, form lebih tepat dilihat seperti ini:

```text
Use Case
  -> Form Intent
  -> Form Backing Object
  -> Template Rendering
  -> Browser Interaction
  -> HTTP Request Parameters
  -> Data Binding
  -> Type Conversion
  -> Validation
  -> Error Model
  -> Re-render or Redirect
  -> Application Command
  -> Domain Operation
```

Form bukan hanya UI. Form adalah **input protocol**.

Setiap field pada form memiliki implikasi:

| Elemen | Makna Engineering |
|---|---|
| `name` | nama parameter request yang akan dibaca binder |
| `value` | representasi string dari nilai server-side |
| `checked` | state boolean/selection yang harus dipetakan balik |
| hidden field | state yang dikirim ulang dan bisa dimanipulasi user |
| select option | enumerasi pilihan yang harus divalidasi ulang server-side |
| error message | hasil binding/validation yang harus ditempel ke field yang benar |
| CSRF token | bukti request berasal dari interaction flow yang valid |
| submit button | intent aksi; satu form bisa punya lebih dari satu aksi |

Rule penting:

> Jangan pernah mendesain form hanya dari tampilan. Desainlah dari kontrak input dan failure mode-nya.

---

## 4. Thymeleaf Form Stack: Layer Yang Terlibat

Pada aplikasi Spring MVC + Thymeleaf, form biasanya melibatkan layer berikut:

```text
Controller GET
  -> prepares form backing object
  -> adds reference data
  -> returns view name

Thymeleaf Template
  -> binds th:object
  -> renders th:field
  -> renders validation errors if any
  -> renders CSRF token if enabled

Browser
  -> user modifies form
  -> submits request

Controller POST
  -> binds request parameters into form object
  -> applies type conversion
  -> applies validation
  -> receives BindingResult

If error
  -> return same view
  -> preserve user input + error state

If success
  -> execute application command
  -> redirect using PRG
```

Ada dua hal yang harus dibedakan:

1. **Binding error**: request parameter tidak bisa dikonversi ke tipe target.
   - contoh: user mengisi `abc` untuk field `Integer age`.
2. **Validation error**: value berhasil di-bind, tetapi melanggar rule.
   - contoh: `age = -1`, padahal minimal 0.

Keduanya harus masuk ke feedback UI, tetapi maknanya berbeda.

---

## 5. Form Backing Object: Command Object, Bukan Entity

Kesalahan besar dalam aplikasi enterprise adalah langsung memakai entity JPA sebagai form object.

Contoh buruk:

```java
@PostMapping("/users/{id}/edit")
public String update(@Valid UserEntity user) {
    userRepository.save(user);
    return "redirect:/users";
}
```

Masalahnya:

1. User bisa mengirim parameter yang tidak Anda tampilkan di form.
2. Field sensitif bisa ikut ter-bind.
3. Entity lifecycle tercampur dengan HTTP lifecycle.
4. Lazy association bisa terpanggil dari template.
5. Validation untuk persistence belum tentu sama dengan validation untuk use case.
6. Over-posting menjadi risiko serius.

Pola yang lebih aman:

```java
public final class UserEditForm {
    private String displayName;
    private String email;
    private String phoneNumber;
    private String version;

    // getter/setter
}
```

Kemudian:

```java
@GetMapping("/users/{id}/edit")
public String edit(@PathVariable Long id, Model model) {
    User user = userQueryService.getForEdit(id);

    UserEditForm form = new UserEditForm();
    form.setDisplayName(user.displayName());
    form.setEmail(user.email());
    form.setPhoneNumber(user.phoneNumber());
    form.setVersion(user.version().toString());

    model.addAttribute("userEditForm", form);
    return "users/edit";
}
```

POST:

```java
@PostMapping("/users/{id}/edit")
public String update(
        @PathVariable Long id,
        @Valid @ModelAttribute("userEditForm") UserEditForm form,
        BindingResult bindingResult,
        Model model) {

    if (bindingResult.hasErrors()) {
        return "users/edit";
    }

    userApplicationService.updateUser(id, form.toCommand());
    return "redirect:/users/" + id;
}
```

Dengan pola ini:

```text
HTTP Form Object != Domain Entity != Persistence Entity
```

Top 1% engineer biasanya sangat ketat di boundary ini.

---

## 6. `th:object`: Menentukan Binding Root

`th:object` mendefinisikan object yang menjadi root untuk selection expression `*{...}` dan binding field.

Contoh:

```html
<form th:action="@{/users/{id}/edit(id=${userId})}"
      th:object="${userEditForm}"
      method="post">

    <input type="text" th:field="*{displayName}" />
    <input type="email" th:field="*{email}" />

    <button type="submit">Save</button>
</form>
```

`th:object="${userEditForm}"` berarti:

```text
*{displayName} -> userEditForm.displayName
*{email}       -> userEditForm.email
```

Tapi `th:object` bukan sekadar syntactic sugar. Ia juga membantu Thymeleaf/Spring menghubungkan field dengan binding metadata dan error state.

Rule:

> Untuk form yang di-bind ke Spring MVC command object, gunakan `th:object` pada `<form>` dan `th:field` pada input fields.

---

## 7. `th:field`: Field Binding Yang Lebih Dari Sekadar `name` dan `value`

`th:field` adalah salah satu attribute paling penting dalam Thymeleaf form.

Contoh:

```html
<input type="text" th:field="*{displayName}" />
```

Saat dirender, Thymeleaf akan menghasilkan kira-kira:

```html
<input type="text" id="displayName" name="displayName" value="Fajar" />
```

Untuk checkbox, radio, select, dan collection, `th:field` melakukan lebih dari sekadar mengisi `value`. Ia juga dapat menentukan `checked`, `selected`, field marker, dan binding name yang benar.

Jangan menulis manual seperti ini kecuali benar-benar perlu:

```html
<input type="text" name="displayName" th:value="${userEditForm.displayName}" />
```

Itu kehilangan banyak kemampuan:

1. tidak otomatis terhubung ke error binding;
2. lebih mudah salah saat nested property;
3. lebih mudah tidak sinkron dengan form object;
4. lebih sulit dipakai untuk checkbox/radio/select;
5. raw value handling lebih rawan inkonsistensi.

Gunakan:

```html
<input type="text" th:field="*{displayName}" />
```

---

## 8. BindingResult: Error State Yang Menempel Pada Object

Pada Spring MVC, `BindingResult` menyimpan hasil binding dan validation.

Pola controller yang benar:

```java
@PostMapping("/users")
public String create(
        @Valid @ModelAttribute("userCreateForm") UserCreateForm form,
        BindingResult bindingResult,
        Model model) {

    if (bindingResult.hasErrors()) {
        populateReferenceData(model);
        return "users/create";
    }

    userApplicationService.create(form.toCommand());
    return "redirect:/users";
}
```

Perhatikan posisi parameter:

```java
@Valid @ModelAttribute("userCreateForm") UserCreateForm form,
BindingResult bindingResult
```

`BindingResult` harus muncul segera setelah model attribute yang divalidasi.

Jika tidak, error handling bisa tidak bekerja sesuai harapan dan framework bisa melempar exception atau binding result tidak diasosiasikan dengan object yang benar.

Mental model:

```text
Model attribute name: userCreateForm
BindingResult key : org.springframework.validation.BindingResult.userCreateForm
```

Thymeleaf membaca error state berdasarkan object dan field path yang sama.

---

## 9. Field Error Rendering Dengan `#fields`, `th:errors`, dan `th:errorclass`

Thymeleaf menyediakan helper untuk error rendering.

Contoh sederhana:

```html
<div>
    <label for="email">Email</label>
    <input type="email" th:field="*{email}" />
    <p th:if="${#fields.hasErrors('email')}"
       th:errors="*{email}">
        Invalid email
    </p>
</div>
```

`#fields.hasErrors('email')` mengecek apakah field `email` memiliki error.

`th:errors="*{email}"` menampilkan pesan error untuk field tersebut.

Untuk CSS class:

```html
<input type="email"
       th:field="*{email}"
       th:errorclass="field-error" />
```

Jika field memiliki error, Thymeleaf akan menambahkan class `field-error`.

Pola reusable:

```html
<div class="form-group" th:classappend="${#fields.hasErrors('email')} ? 'has-error'">
    <label th:for="${#ids.prev('email')}">Email</label>
    <input type="email" th:field="*{email}" />
    <div class="error" th:if="${#fields.hasErrors('email')}" th:errors="*{email}"></div>
</div>
```

Namun jangan terlalu over-engineer di awal. Mulai dengan pola yang eksplisit dan konsisten.

---

## 10. Global Error vs Field Error

Tidak semua error menempel pada satu field.

Contoh field error:

```text
email: must be a well-formed email address
startDate: must not be in the past
```

Contoh global error:

```text
End date must be after start date.
This user cannot be assigned to this case.
The selected reviewer is no longer active.
This transition is no longer allowed because the case status has changed.
```

Global error biasanya berasal dari cross-field rule atau business rule.

Template:

```html
<div class="form-errors" th:if="${#fields.hasGlobalErrors()}">
    <ul>
        <li th:each="err : ${#fields.globalErrors()}" th:text="${err}">
            Global error
        </li>
    </ul>
</div>
```

Controller dapat menambahkan global error:

```java
bindingResult.reject(
    "case.transition.invalid",
    "This case cannot be transitioned to the selected status."
);
```

Field-specific error:

```java
bindingResult.rejectValue(
    "assigneeId",
    "assignee.inactive",
    "Selected assignee is no longer active."
);
```

Rule:

> Field error menjawab “field mana yang salah”. Global error menjawab “kombinasi atau aksi ini tidak valid”.

---

## 11. Error Message Resolution dan Internationalization

Validation error sebaiknya tidak hard-coded di controller/template.

Contoh buruk:

```java
bindingResult.rejectValue("email", "invalid", "Email is invalid");
```

Lebih baik:

```java
bindingResult.rejectValue("email", "user.email.invalid");
```

Message bundle:

```properties
user.email.invalid=Email address is invalid.
user.displayName.required=Display name is required.
case.transition.invalid=This transition is no longer allowed.
```

Untuk Bahasa Indonesia:

```properties
user.email.invalid=Alamat email tidak valid.
user.displayName.required=Nama tampilan wajib diisi.
case.transition.invalid=Transisi ini sudah tidak dapat dilakukan.
```

Mental model:

```text
Validation code
  -> MessageSource
  -> Locale
  -> Rendered message
```

Dalam sistem enterprise/regulatory, i18n bukan hanya “terjemahan”. Ia adalah bagian dari **legal and user communication correctness**.

---

## 12. Re-render Setelah Error: Jangan Redirect Saat Validation Gagal

Pola umum:

```java
if (bindingResult.hasErrors()) {
    return "users/edit";
}
```

Kenapa tidak redirect?

Karena redirect akan membuat request baru dan error state hilang kecuali Anda menyimpannya di flash attributes.

Untuk validation failure biasa, kembalikan view yang sama.

```text
POST invalid
  -> return same view
  -> preserve submitted values
  -> render errors
```

Untuk success:

```text
POST valid
  -> execute command
  -> redirect
```

Ini dikenal sebagai **Post-Redirect-Get** untuk success path.

```java
@PostMapping("/users")
public String create(...) {
    if (bindingResult.hasErrors()) {
        populateReferenceData(model);
        return "users/create";
    }

    Long id = userApplicationService.create(form.toCommand());
    return "redirect:/users/" + id;
}
```

Reasoning:

1. Error path perlu mempertahankan input user.
2. Success path perlu mencegah duplicate submission saat refresh.
3. Success path harus menghasilkan URL yang bookmarkable.

---

## 13. Reference Data: Select Options Harus Diisi Ulang Saat Error

Salah satu bug paling umum:

```java
@GetMapping("/cases/{id}/assign")
public String show(Model model) {
    model.addAttribute("form", new AssignmentForm());
    model.addAttribute("assignees", userQueryService.findAssignableUsers());
    return "cases/assign";
}

@PostMapping("/cases/{id}/assign")
public String submit(@Valid @ModelAttribute("form") AssignmentForm form,
                     BindingResult bindingResult) {
    if (bindingResult.hasErrors()) {
        return "cases/assign"; // BUG: assignees missing
    }
    ...
}
```

Jika validation gagal, template membutuhkan `assignees`, tetapi model tidak punya.

Pola benar:

```java
private void populateAssignmentReferenceData(Model model) {
    model.addAttribute("assignees", userQueryService.findAssignableUsers());
    model.addAttribute("priorityOptions", Priority.values());
}

@GetMapping("/cases/{id}/assign")
public String show(Model model) {
    model.addAttribute("form", new AssignmentForm());
    populateAssignmentReferenceData(model);
    return "cases/assign";
}

@PostMapping("/cases/{id}/assign")
public String submit(@Valid @ModelAttribute("form") AssignmentForm form,
                     BindingResult bindingResult,
                     Model model) {
    if (bindingResult.hasErrors()) {
        populateAssignmentReferenceData(model);
        return "cases/assign";
    }
    ...
}
```

Atau gunakan `@ModelAttribute` method untuk reference data yang selalu diperlukan:

```java
@ModelAttribute("priorityOptions")
public Priority[] priorityOptions() {
    return Priority.values();
}
```

Namun hati-hati: reference data yang mahal sebaiknya tidak selalu dipanggil untuk semua request.

---

## 14. Select dan Enum Rendering

Form object:

```java
public class CaseUpdateForm {
    private CasePriority priority;

    public CasePriority getPriority() { return priority; }
    public void setPriority(CasePriority priority) { this.priority = priority; }
}
```

Enum:

```java
public enum CasePriority {
    LOW,
    NORMAL,
    HIGH,
    URGENT
}
```

Template:

```html
<select th:field="*{priority}">
    <option value="">-- Select priority --</option>
    <option th:each="priority : ${priorityOptions}"
            th:value="${priority}"
            th:text="#{'case.priority.' + ${priority.name()}}">
        NORMAL
    </option>
</select>

<div th:if="${#fields.hasErrors('priority')}" th:errors="*{priority}"></div>
```

Message bundle:

```properties
case.priority.LOW=Low
case.priority.NORMAL=Normal
case.priority.HIGH=High
case.priority.URGENT=Urgent
```

Untuk enterprise system, jangan selalu menampilkan enum internal mentah. Enum internal sering berubah menjadi bagian dari contract UI kalau tidak hati-hati.

Lebih kuat:

```java
public record OptionView(String value, String label, boolean disabled) {}
```

Template:

```html
<select th:field="*{priority}">
    <option value="">-- Select priority --</option>
    <option th:each="option : ${priorityOptions}"
            th:value="${option.value}"
            th:text="${option.label}"
            th:disabled="${option.disabled}">
        Normal
    </option>
</select>
```

Ini memberi fleksibilitas untuk:

1. label i18n;
2. disabled option;
3. option filtered by permission;
4. option filtered by state transition;
5. separation from enum name.

---

## 15. Checkbox Binding: Jebakan Boolean dan Multi-Select

Checkbox terlihat sederhana, tetapi secara HTTP memiliki sifat penting:

> Checkbox yang tidak dicentang biasanya tidak mengirim parameter sama sekali.

Boolean field:

```java
public class NotificationPreferenceForm {
    private boolean emailEnabled;

    public boolean isEmailEnabled() { return emailEnabled; }
    public void setEmailEnabled(boolean emailEnabled) { this.emailEnabled = emailEnabled; }
}
```

Template:

```html
<label>
    <input type="checkbox" th:field="*{emailEnabled}" />
    Enable email notification
</label>
```

Dengan `th:field`, Thymeleaf/Spring integration dapat menangani marker field agar unchecked state tetap bisa dibaca sebagai false.

Multi-checkbox:

```java
public class RoleAssignmentForm {
    private List<String> roleIds = new ArrayList<>();

    public List<String> getRoleIds() { return roleIds; }
    public void setRoleIds(List<String> roleIds) { this.roleIds = roleIds; }
}
```

Template:

```html
<div th:each="role : ${availableRoles}">
    <label>
        <input type="checkbox"
               th:field="*{roleIds}"
               th:value="${role.id}" />
        <span th:text="${role.label}">Reviewer</span>
    </label>
</div>
```

Server-side validation tetap wajib:

1. role ID harus ada;
2. role ID harus assignable oleh current user;
3. role ID harus valid untuk tenant/agency/context;
4. tidak boleh hanya percaya option yang dirender.

---

## 16. Radio Button Binding

Radio button cocok untuk satu pilihan dari beberapa opsi.

Form:

```java
public class DecisionForm {
    private String decision;
}
```

Template:

```html
<div th:each="option : ${decisionOptions}">
    <label>
        <input type="radio"
               th:field="*{decision}"
               th:value="${option.value}" />
        <span th:text="${option.label}">Approve</span>
    </label>
</div>

<div th:if="${#fields.hasErrors('decision')}" th:errors="*{decision}"></div>
```

Untuk case management:

```text
decision = APPROVE | REJECT | REQUEST_MORE_INFO
```

Tetapi jangan langsung percaya value ini di service.

Validasi ulang:

```text
Is decision known?
Is decision allowed for current case state?
Is user authorized for this decision?
Is mandatory comment present for rejection?
Has case changed since form was opened?
```

---

## 17. Date and Time Input

Date/time adalah salah satu field paling rawan bug karena melibatkan:

1. browser format;
2. locale;
3. timezone;
4. Java type;
5. conversion service;
6. validation rule;
7. display format;
8. storage semantics.

Form:

```java
public class HearingScheduleForm {
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate hearingDate;

    @DateTimeFormat(pattern = "HH:mm")
    private LocalTime hearingTime;
}
```

Template:

```html
<input type="date" th:field="*{hearingDate}" />
<input type="time" th:field="*{hearingTime}" />
```

Important distinction:

| Java Type | Use Case |
|---|---|
| `LocalDate` | date without timezone, e.g. due date, birth date, hearing date |
| `LocalTime` | time without date/timezone |
| `LocalDateTime` | local date-time; dangerous if actual instant matters |
| `ZonedDateTime` | date-time with timezone region |
| `Instant` | machine timestamp/point in time |

For form input, often:

```text
User enters LocalDate + LocalTime in user's zone
Server combines with zone -> ZonedDateTime/Instant
```

Do not casually bind browser input directly to `Instant` unless you control timezone semantics.

---

## 18. Nested Object Binding

Form object:

```java
public class ApplicantForm {
    private String name;
    private AddressForm address = new AddressForm();

    // getters/setters
}

public class AddressForm {
    private String postalCode;
    private String block;
    private String street;
}
```

Template:

```html
<form th:object="${applicantForm}" method="post">
    <input type="text" th:field="*{name}" />

    <input type="text" th:field="*{address.postalCode}" />
    <input type="text" th:field="*{address.block}" />
    <input type="text" th:field="*{address.street}" />
</form>
```

Generated names resemble:

```text
name
address.postalCode
address.block
address.street
```

Rule:

> Nested object must exist if you expect nested binding/rendering to work cleanly.

Initialize nested forms:

```java
private AddressForm address = new AddressForm();
```

For optional nested sections, design explicit enable flags:

```java
private boolean hasAlternateAddress;
private AddressForm alternateAddress = new AddressForm();
```

Then validate conditionally.

---

## 19. Collection Binding and Dynamic Rows

Collection binding is powerful but easy to break.

Form:

```java
public class OrderForm {
    private List<OrderLineForm> lines = new ArrayList<>();
}

public class OrderLineForm {
    private String itemCode;
    private Integer quantity;
}
```

Template:

```html
<tr th:each="line, stat : *{lines}">
    <td>
        <input type="text" th:field="*{lines[__${stat.index}__].itemCode}" />
        <div th:if="${#fields.hasErrors('lines[' + stat.index + '].itemCode')}"
             th:errors="*{lines[__${stat.index}__].itemCode}"></div>
    </td>
    <td>
        <input type="number" th:field="*{lines[__${stat.index}__].quantity}" />
    </td>
</tr>
```

`__${...}__` is Thymeleaf preprocessing syntax used in cases like dynamic indexed field paths.

Dynamic rows have several problems:

1. index gaps;
2. deleted rows;
3. reordered rows;
4. malicious extra rows;
5. duplicate IDs;
6. excessive row count attack;
7. validation errors mapped to wrong row after reorder.

For production, each row often needs a stable row key:

```java
public class OrderLineForm {
    private String rowId;
    private String itemCode;
    private Integer quantity;
    private boolean deleted;
}
```

This lets the server distinguish:

```text
new row
existing row modified
existing row deleted
malicious row
duplicate row
```

Limit row count server-side:

```java
if (form.getLines().size() > 100) {
    bindingResult.reject("order.lines.tooMany");
}
```

---

## 20. Hidden Fields: Useful But Dangerous

Hidden fields are visible to the user through browser devtools and can be changed.

Common hidden fields:

```html
<input type="hidden" th:field="*{version}" />
<input type="hidden" th:field="*{returnUrl}" />
<input type="hidden" th:field="*{caseId}" />
```

Risk:

| Hidden Field | Risk |
|---|---|
| `userId` | user can submit another user's ID |
| `role` | privilege escalation |
| `amount` | tampering financial value |
| `status` | illegal state transition |
| `returnUrl` | open redirect |
| `version` | concurrency conflict if ignored |

Rule:

> Hidden fields are request parameters, not trusted server state.

Safer patterns:

1. Put resource ID in path and authorize it server-side.
2. Use hidden `version` only for optimistic locking, not authority.
3. Store sensitive server state in server-side session or signed token if truly needed.
4. Validate `returnUrl` against allowlist or use internal route names.
5. Never trust hidden role/status/permission flags.

---

## 21. CSRF Token Rendering

For unsafe HTTP methods like POST, PUT, PATCH, DELETE, CSRF protection is essential when using cookie-based authentication.

With Spring Security + Thymeleaf, forms using `th:action` generally integrate well with CSRF token rendering.

Example explicit token rendering:

```html
<form th:action="@{/cases/{id}/approve(id=${caseId})}"
      th:object="${approvalForm}"
      method="post">

    <input type="hidden"
           th:name="${_csrf.parameterName}"
           th:value="${_csrf.token}" />

    <textarea th:field="*{remarks}"></textarea>
    <button type="submit">Approve</button>
</form>
```

Do not disable CSRF merely because “the form is internal”. If authentication uses cookies and browser automatically sends credentials, CSRF is relevant.

CSRF protects against unauthorized request submission from another site. It does not protect against:

1. XSS;
2. malicious authenticated user;
3. broken authorization;
4. parameter tampering;
5. replay or duplicate submit by same user.

---

## 22. Over-Posting and Mass Assignment

Over-posting occurs when the client submits fields that the server binds but the form was not supposed to expose.

Example attack:

```http
POST /users/123/edit
Content-Type: application/x-www-form-urlencoded

displayName=Fajar&email=fajar@example.com&admin=true&status=ACTIVE
```

If your binder binds directly to entity with `admin` and `status`, you have a serious problem.

Defenses:

1. Use form-specific DTOs.
2. Only map allowed fields into command.
3. Use constructor-based command creation.
4. Server-side authorization for every sensitive mutation.
5. Disallow unknown fields where appropriate.
6. Avoid exposing domain/entity object directly in form.

Example command mapping:

```java
public UpdateUserCommand toCommand(Long userId, UserId actorId) {
    return new UpdateUserCommand(
        userId,
        actorId,
        displayName,
        email,
        phoneNumber,
        version
    );
}
```

Notice what is missing:

```text
admin
role
status
createdBy
tenantId
permissions
```

Those are server-controlled.

---

## 23. Authorization-Aware Rendering Is Not Authorization

Thymeleaf can hide buttons:

```html
<button th:if="${canApprove}" type="submit">Approve</button>
```

This improves UX, but it is not security.

A user can still submit:

```http
POST /cases/100/approve
```

Backend must validate:

```java
caseAuthorizationService.requireCanApprove(actor, caseId);
caseWorkflowService.approve(caseId, command);
```

Template authorization is for guidance. Backend authorization is enforcement.

Rule:

```text
UI can hide unavailable action.
Server must reject unavailable action.
```

---

## 24. Multi-Action Forms

Sometimes a form has multiple buttons:

```html
<button type="submit" name="action" value="saveDraft">Save Draft</button>
<button type="submit" name="action" value="submit">Submit</button>
<button type="submit" name="action" value="cancel">Cancel</button>
```

Controller:

```java
@PostMapping("/applications/{id}")
public String handle(
        @PathVariable Long id,
        @RequestParam String action,
        @Valid @ModelAttribute("form") ApplicationForm form,
        BindingResult bindingResult,
        Model model) {

    return switch (action) {
        case "saveDraft" -> saveDraft(id, form, bindingResult, model);
        case "submit" -> submit(id, form, bindingResult, model);
        case "cancel" -> "redirect:/applications/" + id;
        default -> throw new IllegalArgumentException("Unknown action: " + action);
    };
}
```

But validation requirements may differ:

| Action | Validation |
|---|---|
| Save Draft | partial validation |
| Submit | full validation |
| Cancel | no form validation |

Do not force one validation group for all actions if the business lifecycle differs.

Possible design:

1. separate endpoints;
2. validation groups;
3. command-specific form handlers;
4. action dispatcher that validates per action.

For critical workflows, separate endpoints often produce clearer authorization and audit.

---

## 25. Multi-Step Forms

Multi-step forms are not just multiple pages. They are state machines.

Example:

```text
Step 1: Applicant Details
Step 2: Address
Step 3: Supporting Documents
Step 4: Review
Step 5: Submit
```

Key questions:

1. Where is partial state stored?
2. Can user go backward?
3. Can user skip steps?
4. What happens if reference data changes between steps?
5. What happens if session expires?
6. Can two tabs edit same form?
7. Is draft persisted?
8. Are validation rules per step or full-form?
9. When is the domain command executed?
10. How is audit captured?

Simple session-based flow:

```text
GET step 1 -> session draft
POST step 1 -> validate step 1 -> session draft -> redirect step 2
POST step 2 -> validate step 2 -> session draft -> redirect step 3
POST submit -> full validation -> command -> clear session -> redirect success
```

Enterprise/regulatory flow often should persist draft server-side instead of relying only on session:

```text
Draft Application Entity
  status = DRAFT
  stepCompleted = ADDRESS
  updatedBy
  updatedAt
  version
```

This provides:

1. recovery after logout;
2. audit;
3. concurrent update detection;
4. support for long-running forms;
5. better operational visibility.

---

## 26. Optimistic Locking and Stale Form Submission

Form opened at 10:00.
Another user changes the record at 10:05.
User submits at 10:10.

What should happen?

If the form changes regulated state, silently overwriting is dangerous.

Include version:

```html
<input type="hidden" th:field="*{version}" />
```

Server:

```java
try {
    caseApplicationService.update(caseId, form.toCommand());
} catch (OptimisticLockingFailureException ex) {
    bindingResult.reject("record.stale", "This record has been updated by another user. Please reload and try again.");
    populateReferenceData(model);
    return "cases/edit";
}
```

Better message:

```text
This case was updated after you opened the form. Your changes were not saved. Review the latest data before submitting again.
```

In regulatory systems, this matters because stale form submission can cause invalid transition, wrong correspondence, or outdated approval decision.

---

## 27. Validation Layers: Client, Binder, Bean Validation, Business Validation

Validation has layers:

```text
HTML/browser validation
  -> convenience only

Data binding/type conversion
  -> can string become target type?

Bean validation
  -> field and object structural rules

Business validation
  -> domain/use-case rules

Authorization validation
  -> is actor allowed to perform this operation?

Concurrency validation
  -> is command based on current state?
```

Do not confuse them.

HTML:

```html
<input type="email" th:field="*{email}" required />
```

Bean Validation:

```java
@NotBlank
@Email
private String email;
```

Business validation:

```java
if (userRepository.emailExists(form.getEmail())) {
    bindingResult.rejectValue("email", "user.email.duplicate");
}
```

Domain validation:

```java
user.changeEmail(new EmailAddress(command.email()), actor);
```

Rule:

> Browser validation improves UX. Server validation enforces correctness.

---

## 28. Conditional Validation

Some rules depend on another field.

Example:

```text
If decision = REJECT, remarks is mandatory.
If decision = APPROVE, approvalDate is mandatory.
If applicantType = COMPANY, UEN is mandatory.
If applicantType = INDIVIDUAL, NRIC/FIN validation applies.
```

Do not jam all conditional logic into template.

Bad:

```html
<textarea th:field="*{remarks}" th:required="*{decision == 'REJECT'}"></textarea>
```

This is only UX. It is not enforcement.

Better:

```java
if (form.isRejectDecision() && !StringUtils.hasText(form.getRemarks())) {
    bindingResult.rejectValue("remarks", "decision.reject.remarks.required");
}
```

Template can still reflect rule:

```html
<div th:if="*{decision == 'REJECT'}">
    <label>Rejection Remarks</label>
    <textarea th:field="*{remarks}"></textarea>
    <div th:if="${#fields.hasErrors('remarks')}" th:errors="*{remarks}"></div>
</div>
```

But server remains source of truth.

---

## 29. Preserving User Input After Error

When validation fails, the user should see what they submitted, not stale database values.

Correct flow:

```java
@PostMapping("/profile")
public String update(@Valid @ModelAttribute("form") ProfileForm form,
                     BindingResult bindingResult,
                     Model model) {
    if (bindingResult.hasErrors()) {
        populateReferenceData(model);
        return "profile/edit";
    }
    ...
}
```

Do not reload entity and overwrite form on error:

```java
if (bindingResult.hasErrors()) {
    model.addAttribute("form", loadFromDatabase()); // BAD: user input lost
    return "profile/edit";
}
```

Exception: if data must be refreshed for security/concurrency reasons, explicitly explain and handle it.

---

## 30. Escaping and Safe Error Rendering

Error messages can contain user-provided values if you are not careful.

Example risky message:

```java
bindingResult.rejectValue(
    "displayName",
    "displayName.invalid",
    "Display name <script>alert(1)</script> is invalid"
);
```

In Thymeleaf, `th:text` escapes by default, but `th:utext` does not.

Use:

```html
<div th:errors="*{displayName}"></div>
```

Avoid:

```html
<div th:utext="${someErrorHtml}"></div>
```

If you must render rich error content, use a structured model:

```java
public record ErrorMessageView(String code, List<String> safeParameters) {}
```

And compose safe HTML in template with escaped pieces.

Do not store raw HTML error messages from backend unless you have a strict sanitization and trust model.

---

## 31. Accessibility of Error Rendering

A top-tier form is not only functionally correct; it is usable.

Error rendering should consider:

1. error summary at top;
2. per-field error near the field;
3. `aria-invalid="true"`;
4. `aria-describedby` pointing to error element;
5. focus management after validation failure;
6. labels correctly linked to fields;
7. no color-only error indication.

Example:

```html
<div class="form-group">
    <label for="email">Email</label>
    <input type="email"
           th:field="*{email}"
           th:attr="aria-invalid=${#fields.hasErrors('email')},
                    aria-describedby=${#fields.hasErrors('email')} ? 'email-error' : null" />

    <div id="email-error"
         class="field-error"
         th:if="${#fields.hasErrors('email')}"
         th:errors="*{email}">
        Email error
    </div>
</div>
```

If the page has multiple errors, an error summary helps:

```html
<div class="error-summary" th:if="${#fields.hasAnyErrors()}" role="alert">
    <h2>Please correct the following errors</h2>
    <ul>
        <li th:each="err : ${#fields.allErrors()}" th:text="${err}">Error</li>
    </ul>
</div>
```

---

## 32. Form Fragment/Component Design

Once forms grow, duplication explodes.

You can define fragments for common controls.

Example fragment:

```html
<!-- fragments/forms.html -->
<div th:fragment="textField(label, fieldName)">
    <label th:for="${fieldName}" th:text="${label}">Label</label>
    <input type="text" th:field="*{__${fieldName}__}" />
    <div class="error"
         th:if="${#fields.hasErrors(fieldName)}"
         th:errors="*{__${fieldName}__}">
        Error
    </div>
</div>
```

Usage:

```html
<div th:replace="~{fragments/forms :: textField('Display Name', 'displayName')}"></div>
```

However, dynamic field names in fragments can become hard to maintain.

Alternative: accept explicit content or create separate fragments per common pattern but keep field binding visible in page template.

Enterprise rule:

> Reuse visual and accessibility structure, but do not hide business-critical field paths too deeply.

If every field is hidden behind magic fragments, debugging binding errors becomes harder.

---

## 33. Login Form and Security-Sensitive Forms

Login forms are special:

1. they often are unauthenticated;
2. they need CSRF;
3. they must not reveal whether username exists;
4. they may be attacked with brute force;
5. they must render authentication error safely;
6. they may need remembered redirect after login.

Example:

```html
<form th:action="@{/login}" method="post">
    <input type="hidden"
           th:name="${_csrf.parameterName}"
           th:value="${_csrf.token}" />

    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" />

    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" />

    <div th:if="${param.error}">
        Invalid username or password.
    </div>

    <button type="submit">Login</button>
</form>
```

Do not display raw authentication exception.

Bad:

```html
<div th:text="${session.SPRING_SECURITY_LAST_EXCEPTION.message}"></div>
```

Better:

```html
<div th:if="${param.error}">
    Invalid username or password.
</div>
```

---

## 34. File Upload Forms

File upload needs multipart encoding.

Template:

```html
<form th:action="@{/documents/upload}"
      method="post"
      enctype="multipart/form-data"
      th:object="${uploadForm}">

    <input type="file" name="file" />
    <input type="text" th:field="*{description}" />

    <button type="submit">Upload</button>
</form>
```

Validation must include:

1. max file size;
2. content type allowlist;
3. extension allowlist if needed;
4. malware scanning where required;
5. storage location;
6. filename sanitization;
7. duplicate handling;
8. authorization;
9. audit record;
10. transactional behavior between metadata and file storage.

Never trust browser-provided MIME type or filename.

---

## 35. Search Forms: GET vs POST

Search/filter forms are often better as GET:

```html
<form th:action="@{/cases}" method="get" th:object="${searchForm}">
    <input type="text" th:field="*{keyword}" />
    <select th:field="*{status}">
        <option value="">All</option>
        <option th:each="status : ${statusOptions}"
                th:value="${status.value}"
                th:text="${status.label}"></option>
    </select>
    <button type="submit">Search</button>
</form>
```

Why GET?

1. bookmarkable;
2. shareable;
3. browser back/forward friendly;
4. represents retrieval;
5. easier pagination links.

But be careful:

1. sensitive filters should not appear in URL;
2. very large filters may exceed URL length;
3. search parameters still need validation;
4. user-controlled sort field must be allowlisted.

Pagination link:

```html
<a th:href="@{/cases(keyword=${searchForm.keyword},status=${searchForm.status},page=${page.number + 1})}">Next</a>
```

---

## 36. Controller Design: Keep GET and POST Symmetric

A clean controller often has symmetry:

```java
@GetMapping("/cases/{id}/assign")
public String showAssignForm(@PathVariable Long id, Model model) {
    model.addAttribute("form", assignmentFormFactory.create(id));
    populateReferenceData(id, model);
    return "cases/assign";
}

@PostMapping("/cases/{id}/assign")
public String submitAssignForm(
        @PathVariable Long id,
        @Valid @ModelAttribute("form") AssignmentForm form,
        BindingResult bindingResult,
        Model model) {

    validateBusinessRules(id, form, bindingResult);

    if (bindingResult.hasErrors()) {
        populateReferenceData(id, model);
        return "cases/assign";
    }

    assignmentService.assign(id, form.toCommand());
    return "redirect:/cases/" + id;
}
```

Symmetry checklist:

| GET prepares | POST invalid must also prepare |
|---|---|
| form object | submitted form object already exists |
| select options | select options |
| labels/help text | labels/help text |
| permission flags | permission flags |
| page metadata | page metadata |

Many production bugs happen because invalid POST returns same view without rebuilding reference data.

---

## 37. Binding Collections Safely With Allowlisted IDs

Suppose form submits selected user IDs:

```java
private List<Long> reviewerIds;
```

Template:

```html
<option th:each="reviewer : ${reviewerOptions}"
        th:value="${reviewer.id}"
        th:text="${reviewer.name}"></option>
```

User can submit IDs not in options.

Server must check:

```java
Set<Long> allowedReviewerIds = reviewerQueryService.findAllowedReviewerIds(actor, caseId);

for (Long submittedId : form.getReviewerIds()) {
    if (!allowedReviewerIds.contains(submittedId)) {
        bindingResult.rejectValue("reviewerIds", "reviewer.invalid");
        break;
    }
}
```

This applies to:

1. user IDs;
2. role IDs;
3. case IDs;
4. agency IDs;
5. workflow transition IDs;
6. template IDs;
7. correspondence recipient IDs.

Rendered options are UX, not authorization.

---

## 38. Handling Conversion Errors

If field is `Integer quantity` and user submits `abc`, binding fails before normal Bean Validation.

Form:

```java
public class LineForm {
    private Integer quantity;
}
```

Template:

```html
<input type="number" th:field="*{quantity}" />
<div th:if="${#fields.hasErrors('quantity')}" th:errors="*{quantity}"></div>
```

Message bundle can customize type mismatch:

```properties
typeMismatch.lineForm.quantity=Quantity must be a valid number.
typeMismatch.quantity=Must be a valid number.
typeMismatch.java.lang.Integer=Must be a valid number.
typeMismatch=Invalid value.
```

Do not assume validation annotation is the only source of errors.

BindingResult can contain errors from:

1. missing required fields;
2. type mismatch;
3. disallowed fields;
4. custom editor/converter failure;
5. Bean Validation;
6. manual business validation.

---

## 39. Form Object Design Patterns

### 39.1 Create Form

```java
public class CreateCaseForm {
    private String applicantName;
    private String caseType;
    private String description;
}
```

No ID. No version. Server creates new entity.

### 39.2 Edit Form

```java
public class EditCaseForm {
    private String title;
    private String description;
    private String version;
}
```

Contains version for optimistic concurrency.

### 39.3 Transition Form

```java
public class CaseTransitionForm {
    private String transition;
    private String remarks;
    private String version;
}
```

Must be validated against current state and actor permission.

### 39.4 Search Form

```java
public class CaseSearchForm {
    private String keyword;
    private String status;
    private LocalDate fromDate;
    private LocalDate toDate;
    private Integer page;
    private String sort;
}
```

Sort must be allowlisted.

### 39.5 Bulk Action Form

```java
public class BulkAssignForm {
    private List<Long> caseIds;
    private Long assigneeId;
    private String remarks;
}
```

Must validate every selected case.

---

## 40. Regulatory/Case Management Example: Approval Form

Use case:

```text
Officer reviews application and either approves or rejects.
Rejection requires reason.
Approval may require effective date.
The record may be changed by another officer.
The decision must be auditable.
```

Form object:

```java
public class ApplicationDecisionForm {
    @NotBlank
    private String decision;

    private String remarks;

    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate effectiveDate;

    @NotBlank
    private String version;

    // getters/setters
}
```

Template:

```html
<form th:action="@{/applications/{id}/decision(id=${applicationId})}"
      th:object="${decisionForm}"
      method="post">

    <input type="hidden" th:field="*{version}" />

    <div class="error-summary" th:if="${#fields.hasAnyErrors()}" role="alert">
        <ul>
            <li th:each="err : ${#fields.allErrors()}" th:text="${err}"></li>
        </ul>
    </div>

    <div>
        <label>
            <input type="radio" th:field="*{decision}" value="APPROVE" />
            Approve
        </label>
        <label>
            <input type="radio" th:field="*{decision}" value="REJECT" />
            Reject
        </label>
        <div th:if="${#fields.hasErrors('decision')}" th:errors="*{decision}"></div>
    </div>

    <div>
        <label for="effectiveDate">Effective Date</label>
        <input type="date" th:field="*{effectiveDate}" />
        <div th:if="${#fields.hasErrors('effectiveDate')}" th:errors="*{effectiveDate}"></div>
    </div>

    <div>
        <label for="remarks">Remarks</label>
        <textarea th:field="*{remarks}"></textarea>
        <div th:if="${#fields.hasErrors('remarks')}" th:errors="*{remarks}"></div>
    </div>

    <button type="submit">Submit Decision</button>
</form>
```

Controller:

```java
@PostMapping("/applications/{id}/decision")
public String decide(
        @PathVariable Long id,
        @Valid @ModelAttribute("decisionForm") ApplicationDecisionForm form,
        BindingResult bindingResult,
        Model model,
        Principal principal) {

    validateDecisionRules(id, form, bindingResult, principal);

    if (bindingResult.hasErrors()) {
        populateDecisionReferenceData(id, model, principal);
        model.addAttribute("applicationId", id);
        return "applications/decision";
    }

    applicationDecisionService.decide(id, form.toCommand(principal.getName()));
    return "redirect:/applications/" + id;
}
```

Business validation:

```java
private void validateDecisionRules(
        Long applicationId,
        ApplicationDecisionForm form,
        BindingResult errors,
        Principal principal) {

    if (!authorization.canDecide(principal.getName(), applicationId)) {
        errors.reject("decision.notAllowed");
        return;
    }

    if ("REJECT".equals(form.getDecision()) && !hasText(form.getRemarks())) {
        errors.rejectValue("remarks", "decision.reject.remarks.required");
    }

    if ("APPROVE".equals(form.getDecision()) && form.getEffectiveDate() == null) {
        errors.rejectValue("effectiveDate", "decision.approve.effectiveDate.required");
    }

    if (!workflow.canApply(applicationId, form.getDecision())) {
        errors.reject("decision.transition.invalid");
    }
}
```

Notice the split:

```text
Template = input rendering + feedback
Controller/application = binding + validation orchestration
Domain/workflow = final invariant enforcement
```

---

## 41. Testing Thymeleaf Forms

A form needs testing at multiple levels.

### 41.1 Template Rendering Test

Validate that form renders expected fields:

```text
- form has csrf token
- form action URL is correct
- field names are correct
- selected option is selected
- error message is rendered
```

### 41.2 Controller Invalid Submission Test

```java
mockMvc.perform(post("/users")
        .param("email", "not-an-email")
        .with(csrf()))
    .andExpect(status().isOk())
    .andExpect(view().name("users/create"))
    .andExpect(model().attributeHasFieldErrors("userCreateForm", "email"));
```

### 41.3 Controller Success Submission Test

```java
mockMvc.perform(post("/users")
        .param("email", "fajar@example.com")
        .param("displayName", "Fajar")
        .with(csrf()))
    .andExpect(status().is3xxRedirection())
    .andExpect(redirectedUrlPattern("/users/*"));
```

### 41.4 Security Test

```text
- POST without CSRF rejected
- unauthorized actor cannot submit action
- over-posted admin=true ignored/rejected
- hidden caseId tampering rejected
```

### 41.5 Accessibility/HTML Test

```text
- each input has label
- error message is linked
- page has error summary
- no duplicate IDs
```

---

## 42. Common Anti-Patterns

### 42.1 Entity as Form Object

```java
@PostMapping
public String save(@Valid UserEntity entity) { ... }
```

Problem: over-posting, lazy loading, lifecycle coupling.

### 42.2 Losing Reference Data on Error

```java
if (bindingResult.hasErrors()) {
    return "form";
}
```

But template needs options not re-added.

### 42.3 Redirecting on Validation Error

```java
if (bindingResult.hasErrors()) {
    return "redirect:/form";
}
```

Error and submitted input lost.

### 42.4 Trusting Hidden Field

```java
service.approve(form.getCaseId(), form.getStatus());
```

User can tamper both.

### 42.5 UI Authorization Only

```html
<button th:if="${canApprove}">Approve</button>
```

Backend still must enforce.

### 42.6 Raw HTML Error Output

```html
<div th:utext="${errorMessage}"></div>
```

Potential XSS.

### 42.7 Business Logic in Template

```html
<div th:if="${case.status == 'PENDING' and user.role == 'SENIOR' and case.amount > 10000 and ...}">
```

Move to model:

```java
model.addAttribute("canEscalate", policy.canEscalate(actor, case));
```

### 42.8 Unbounded Dynamic Rows

Attacker submits thousands of rows. Binder allocates objects. Server suffers.

Set limits.

---

## 43. Production Checklist

Before shipping a Thymeleaf form, check:

### Contract

- [ ] Does the form use a form-specific DTO/command object?
- [ ] Are field names intentional and stable?
- [ ] Are hidden fields minimized?
- [ ] Is every submitted ID validated against server-side allowlist?

### Binding and Validation

- [ ] Is `BindingResult` immediately after the validated attribute?
- [ ] Are type conversion errors rendered?
- [ ] Are field errors rendered near fields?
- [ ] Are global errors rendered?
- [ ] Are reference data/options re-added on invalid POST?
- [ ] Are conditional business rules enforced server-side?

### Security

- [ ] CSRF token present for unsafe method forms?
- [ ] Backend authorization enforced?
- [ ] Over-posting prevented?
- [ ] Hidden field tampering handled?
- [ ] Error messages escaped?
- [ ] No raw `th:utext` for untrusted content?

### UX and Accessibility

- [ ] User input preserved after validation failure?
- [ ] Error summary exists for complex forms?
- [ ] Labels linked to inputs?
- [ ] Error state accessible, not color-only?
- [ ] Success path uses PRG?

### Operations

- [ ] Validation failure metrics available for critical forms?
- [ ] Audit captured for regulated actions?
- [ ] Optimistic locking/stale submission handled?
- [ ] Duplicate submit handled?

---

## 44. Mental Model Summary

Thymeleaf form engineering is not about memorizing `th:field`.

It is about designing a safe and recoverable input lifecycle:

```text
Render form from trusted server model
  -> user edits browser fields
  -> browser submits string parameters
  -> server binds and converts
  -> server validates structure
  -> server validates business rules
  -> server validates authorization/state/concurrency
  -> invalid: return same view with submitted input + errors
  -> valid: execute command and redirect
```

The most important invariant:

> Template rendering may guide the user, but backend binding, validation, authorization, and domain rules decide the truth.

A top 1% engineer designs forms as **stateful interaction protocols**, not as HTML snippets.

---

## 45. Hubungan Dengan Part Berikutnya

Part 15 menutup fondasi form rendering Thymeleaf.

Part berikutnya, **Part 16 — Thymeleaf Layouts, Fragments, Components, and Design System**, akan membahas bagaimana membangun UI server-side yang modular:

- layout shell;
- fragments;
- reusable components;
- form components;
- table/list/pagination components;
- design system mapping;
- accessibility-aware fragments;
- governance agar fragment library tidak berubah menjadi dependency hell.

---

## 46. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Thymeleaf 3.1 Documentation — Tutorial: Thymeleaf + Spring.
2. Thymeleaf 3.1 Documentation — Using Thymeleaf.
3. Thymeleaf Documentation — Spring Security integration basics.
4. Spring Framework Reference — Validation, Data Binding, and Type Conversion.
5. Spring Framework Reference — Spring MVC validation.
6. Spring Framework Javadoc — `BindingResult`.
7. Spring Security Reference — CSRF protection.
8. Jakarta Validation Specification / Bean Validation concepts.
9. OWASP Cheat Sheets — XSS Prevention, CSRF Prevention, Mass Assignment.
10. Java SE Documentation for Java 8–25 regarding date/time model, collections, records, and language/runtime compatibility.

---

## 47. Status Akhir Part 15

Part 15 selesai.

Seri belum selesai.

Berikutnya:

```text
Part 16 — Thymeleaf Layouts, Fragments, Components, and Design System
```
