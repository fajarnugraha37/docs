# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-022

# Part 22 — Template Data Model Design: DTO, ViewModel, Presenter, and Contract Stability

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `022`  
> Topik: Template data model design, DTO, ViewModel, Presenter, contract stability  
> Target: Java 8 hingga Java 25  
> Fokus: bagaimana mendesain data yang dikirim ke FreeMarker/Thymeleaf agar aman, stabil, mudah diuji, mudah diubah, dan cocok untuk sistem enterprise.

---

## 0. Mengapa Bagian Ini Sangat Penting

Pada banyak sistem Java, kegagalan template jarang terjadi karena developer tidak tahu syntax `${name}` atau `th:text`. Kegagalan yang lebih mahal biasanya muncul dari desain data model yang buruk.

Contoh gejalanya:

- template mengakses entity JPA langsung;
- lazy loading terjadi saat view rendering;
- field sensitif ikut terkirim ke template;
- template tahu terlalu banyak tentang struktur domain;
- perubahan nama field di Java memecahkan banyak template;
- template lama tidak bisa dirender ulang karena model sudah berubah;
- email/dokumen historis tidak reproducible;
- UI menyembunyikan button berdasarkan role, tetapi data sensitif tetap ada dalam model;
- rendering error baru muncul di production karena field optional tidak tersedia;
- business rule tersebar antara service, controller, presenter, dan template.

Top 1% engineer melihat template bukan sebagai file `.ftl` atau `.html`, melainkan sebagai **consumer dari contract**.

Formula pentingnya:

```text
Domain State + Rendering Use Case + Security Context + Locale/Timezone
        ↓
Presentation Contract / Template Data Model
        ↓
Template Rendering
        ↓
Output Artifact
```

Template data model adalah API internal antara application layer dan template layer. Kalau API ini tidak stabil, template akan rapuh. Kalau API ini terlalu luas, template menjadi celah keamanan. Kalau API ini terlalu dekat dengan domain model, UI/email/dokumen ikut terseret oleh perubahan domain.

---

## 1. Mental Model: Template Data Model adalah Contract, Bukan Dump Object

### 1.1 Kesalahan umum

Banyak kode rendering dimulai seperti ini:

```java
model.put("case", caseEntity);
model.put("user", currentUser);
model.put("application", applicationEntity);
model.put("roles", roles);
```

Lalu template menjadi seperti ini:

```ftl
${case.application.owner.profile.identityDocument.number}
${case.workflow.currentStage.assignedOfficer.department.name}
```

Atau Thymeleaf:

```html
<span th:text="${case.application.owner.profile.identityDocument.number}"></span>
```

Ini terlihat cepat, tetapi sebenarnya template sekarang bergantung pada:

- struktur entity;
- naming internal domain;
- lazy association;
- ORM behavior;
- security filtering;
- lifecycle aggregate;
- nullability setiap relasi;
- perubahan schema masa depan.

Template menjadi coupling point terhadap seluruh domain graph.

### 1.2 Cara berpikir yang lebih benar

Template seharusnya menerima model yang sudah dipersiapkan untuk output tertentu.

Contoh:

```java
public final class CaseNoticeViewModel {
    private final String referenceNo;
    private final String applicantName;
    private final String maskedIdentityNo;
    private final String noticeTitle;
    private final String noticeDateText;
    private final List<DocumentLineViewModel> requiredDocuments;
    private final boolean showAppealInstruction;

    // constructor + getters
}
```

Template cukup melihat contract presentasi:

```ftl
Reference: ${notice.referenceNo}
Applicant: ${notice.applicantName}
Identity: ${notice.maskedIdentityNo}
```

Thymeleaf:

```html
<p>Reference: <span th:text="${notice.referenceNo}"></span></p>
<p>Applicant: <span th:text="${notice.applicantName}"></span></p>
<p>Identity: <span th:text="${notice.maskedIdentityNo}"></span></p>
```

Template tidak perlu tahu apakah data berasal dari:

- JPA entity;
- REST API;
- aggregate read model;
- event snapshot;
- joined database view;
- external service;
- static sample fixture;
- archived historical payload.

Itulah inti contract stability.

---

## 2. Vocabulary: DTO, ViewModel, Presenter, Form Model, Render Model

Istilah sering tumpang tindih. Untuk template engineering, kita butuh definisi yang tajam.

### 2.1 DTO

DTO adalah object pembawa data antar boundary.

Contoh boundary:

- API request/response;
- service-to-service call;
- controller-to-view;
- application layer ke renderer;
- event payload;
- persistence projection.

DTO tidak otomatis berarti aman untuk template. DTO API eksternal mungkin punya field yang tidak relevan untuk UI. DTO database projection mungkin punya naming teknis. DTO form input mungkin punya field editable oleh user.

### 2.2 ViewModel

ViewModel adalah model yang dirancang untuk kebutuhan tampilan/output.

Ciri ViewModel yang baik:

- field sesuai bahasa output;
- sudah diformat atau siap diformat secara eksplisit;
- minim nested graph;
- null policy jelas;
- tidak mengekspos service/domain behavior;
- tidak membawa field yang tidak akan dipakai;
- aman untuk template author;
- mudah dibuat fixture test-nya.

ViewModel untuk web page, email, PDF, dan CSV bisa berbeda walaupun berasal dari domain yang sama.

### 2.3 Presenter

Presenter adalah komponen yang mengubah domain/application data menjadi ViewModel.

```text
Domain/Application Data → Presenter → ViewModel → Template
```

Presenter bukan template. Presenter bukan repository. Presenter adalah boundary adapter.

Tugas presenter:

- memilih field yang boleh tampil;
- melakukan masking;
- memilih label/status text;
- membuat derived field;
- mengurutkan list untuk output;
- memformat data jika format harus frozen;
- resolve locale/timezone;
- menghasilkan model yang stabil untuk template.

### 2.4 Form Model

Form model adalah object untuk binding input dari user.

Contoh:

```java
public class UserRegistrationForm {
    private String fullName;
    private String email;
    private String password;
}
```

Form model berbeda dari entity dan berbeda dari ViewModel output.

Mengapa penting? Karena binding request langsung ke domain object membuka risiko mass assignment, over-posting, dan update field yang seharusnya tidak editable.

### 2.5 Render Model

Render model adalah envelope yang berisi semua input rendering.

Contoh:

```java
public final class RenderRequest<T> {
    private final String templateId;
    private final String templateVersion;
    private final Locale locale;
    private final ZoneId zoneId;
    private final T model;
    private final OutputFormat outputFormat;
}
```

Render model bukan hanya data bisnis. Ia mencakup konteks rendering.

---

## 3. Layering yang Sehat

### 3.1 Layer minimum

```text
Controller / Message Consumer / Batch Job
        ↓
Application Service
        ↓
Domain / Query / External Data
        ↓
Presenter / Model Assembler
        ↓
Template Data Model
        ↓
Template Engine
        ↓
Output
```

### 3.2 Batas tanggung jawab

| Layer | Tanggung jawab | Tidak boleh |
|---|---|---|
| Domain | business invariant, state transition, rule | formatting HTML/email |
| Application Service | orchestrate use case | menyusun HTML string |
| Presenter | ubah data menjadi model output | query database langsung tanpa kontrol |
| Template | susun output dari model | memanggil business service |
| Renderer | menjalankan engine, escaping, error handling | mengambil keputusan domain |

### 3.3 Kenapa presenter perlu eksplisit

Tanpa presenter, mapping sering tersebar:

- sedikit di controller;
- sedikit di template;
- sedikit di utility;
- sedikit di entity getter;
- sedikit di service.

Akhirnya tidak ada satu tempat untuk menjawab:

> Untuk template `notice-rejection-v3`, field apa saja yang dibutuhkan, dari mana asalnya, apakah aman, dan bagaimana fallback-nya?

Presenter memberikan satu titik kontrol.

---

## 4. Entity Exposure Anti-Pattern

### 4.1 Bentuk anti-pattern

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable Long id, Model model) {
    CaseEntity entity = caseRepository.findById(id).orElseThrow();
    model.addAttribute("case", entity);
    return "case/detail";
}
```

Masalah:

1. Template bisa mengakses lebih banyak field dari yang diperlukan.
2. Lazy association bisa trigger query saat rendering.
3. Entity lifecycle bocor ke layer UI.
4. Security filtering menjadi tidak jelas.
5. Perubahan entity memecahkan template.
6. Field sensitif mudah tidak sengaja tampil.
7. Snapshot historis sulit dibuat.
8. Template test harus membuat graph entity lengkap.

### 4.2 Lebih baik

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable Long id, Model model, Locale locale) {
    CaseDetailData data = caseQueryService.getDetail(id);
    CaseDetailViewModel vm = caseDetailPresenter.present(data, locale);
    model.addAttribute("caseDetail", vm);
    return "case/detail";
}
```

Template sekarang bergantung pada `CaseDetailViewModel`, bukan entity.

### 4.3 Rule praktis

```text
Jangan expose entity ke template kecuali untuk prototype kecil yang tidak melewati production boundary.
```

Untuk sistem serius:

- entity untuk domain;
- DTO/query projection untuk data retrieval;
- ViewModel untuk output;
- form model untuk input.

---

## 5. Data Model sebagai API Internal

### 5.1 Template contract harus bisa dijelaskan

Untuk setiap template, seharusnya ada definisi seperti ini:

```text
Template ID: case-rejection-notice
Version: 3
Output: HTML email + PDF notice
Root variable: notice
Required fields:
- notice.referenceNo: string, non-empty
- notice.applicantName: string, escaped text
- notice.rejectionReasons: list<ReasonLine>, non-empty
- notice.issueDateText: string, already localized
Optional fields:
- notice.appealDeadlineText: string, nullable
- notice.officerSignatureBlock: SignatureBlock, nullable
Security:
- identityNo must be masked
- internalOfficerNote must never be exposed
```

Ini adalah contract.

### 5.2 Contract bisa implisit atau eksplisit

Implisit:

- hanya Java class;
- hanya template usage;
- tidak ada dokumentasi.

Eksplisit:

- Java ViewModel;
- validation rules;
- sample JSON/fixture;
- template model registry;
- tests;
- compatibility notes.

Sistem enterprise butuh eksplisit.

### 5.3 Contract stability

Contract stabil bukan berarti tidak pernah berubah. Artinya perubahan dikendalikan.

Jenis perubahan:

| Perubahan | Risiko | Strategi |
|---|---:|---|
| menambah optional field | rendah | backward compatible |
| menambah required field | sedang/tinggi | version bump atau default |
| rename field | tinggi | breaking change |
| ubah tipe field | tinggi | version bump |
| ubah semantic field | sangat tinggi | version bump + migration |
| hapus field | tinggi | deprecate dulu |

---

## 6. Root Model Design

### 6.1 Jangan terlalu banyak root variables

Buruk:

```java
model.put("case", caseVm);
model.put("user", userVm);
model.put("applicant", applicantVm);
model.put("documents", documents);
model.put("status", status);
model.put("deadline", deadline);
model.put("showAppeal", showAppeal);
```

Lebih stabil:

```java
model.put("notice", noticeVm);
```

Dengan root object:

```java
public final class NoticeViewModel {
    private final CaseSummaryViewModel caseSummary;
    private final ApplicantViewModel applicant;
    private final List<DocumentViewModel> documents;
    private final StatusViewModel status;
    private final DeadlineViewModel deadline;
    private final boolean showAppeal;
}
```

Keuntungan:

- namespace jelas;
- template tidak penuh variable global;
- tabrakan nama lebih kecil;
- versioning lebih mudah;
- fixture lebih rapi.

### 6.2 Root naming

Gunakan nama sesuai use case output, bukan nama teknis.

Baik:

```text
notice
email
page
report
receipt
letter
invoice
```

Kurang baik:

```text
data
model
entity
object
result
map
```

Template adalah consumer manusia juga. Nama harus menjelaskan intensi.

---

## 7. Field Design: Raw, Formatted, Derived, and Safe

### 7.1 Raw field

Raw field adalah data asli.

```java
private final BigDecimal amount;
private final LocalDate issueDate;
```

Bagus jika template bertanggung jawab formatting berbasis locale.

### 7.2 Formatted field

Formatted field adalah string yang sudah siap tampil.

```java
private final String amountText;
private final String issueDateText;
```

Bagus jika output harus frozen, audit-ready, atau engine berbeda harus menghasilkan teks sama.

### 7.3 Derived field

Derived field dibuat dari data lain.

```java
private final boolean showAppealInstruction;
private final String statusLabel;
private final String riskLevelBadgeClass;
```

Derived field sebaiknya dibuat di presenter, bukan dihitung di template, jika logic-nya punya konsekuensi business/security.

### 7.4 Safe field

Safe field adalah field yang sudah melalui transformasi keamanan.

Contoh:

```java
private final String maskedIdentityNo;
private final String redactedAddress;
private final String sanitizedPublicHtmlDescription;
```

Nama field harus eksplisit. Jangan beri nama `identityNo` kalau isinya sudah masked. Jangan beri nama `descriptionHtml` kalau belum disanitasi.

---

## 8. Null Policy dan Missing Field Policy

### 8.1 Null adalah keputusan desain

Template model harus menjawab:

- field ini required atau optional?
- optional berarti null, empty string, empty list, atau absent?
- fallback text di mana didefinisikan?
- apakah missing field harus fail-fast?

### 8.2 Required field

Untuk required field, validasi sebelum render.

```java
public final class NoticeViewModel {
    public NoticeViewModel(String referenceNo, String applicantName) {
        this.referenceNo = requireNonBlank(referenceNo, "referenceNo");
        this.applicantName = requireNonBlank(applicantName, "applicantName");
    }
}
```

### 8.3 Optional field

Untuk optional field, pilih semantic yang jelas.

```java
private final Optional<String> appealDeadlineText;
```

Namun hati-hati: tidak semua template engine nyaman dengan `Optional`. Untuk FreeMarker/Thymeleaf, sering lebih baik expose:

```java
private final boolean hasAppealDeadline;
private final String appealDeadlineText;
```

Atau wrapper:

```java
public final class OptionalTextViewModel {
    private final boolean present;
    private final String value;
}
```

### 8.4 Empty collection

Lebih baik expose empty list daripada null.

```java
this.requiredDocuments = List.copyOf(requiredDocuments);
```

Untuk Java 8:

```java
this.requiredDocuments = Collections.unmodifiableList(new ArrayList<>(requiredDocuments));
```

Template bisa langsung:

```ftl
<#list notice.requiredDocuments as doc>
  ${doc.name}
<#else>
  No document required.
</#list>
```

### 8.5 Fail-fast vs lenient

Untuk email legal, notice, regulatory document:

```text
Fail-fast lebih baik daripada mengirim dokumen salah.
```

Untuk dashboard ops non-critical:

```text
Graceful fallback bisa diterima.
```

Policy harus per output type, bukan global asal-asalan.

---

## 9. Nested Graph Depth

### 9.1 Masalah graph terlalu dalam

Template seperti ini rapuh:

```ftl
${case.application.applicant.profile.address.primary.postalCode}
```

Jika salah satu node null, rendering gagal atau fallback menjadi rumit.

### 9.2 Flatten jika field penting untuk output

Lebih baik:

```java
public final class ApplicantBlockViewModel {
    private final String name;
    private final String identityNoText;
    private final String primaryAddressText;
    private final String postalCode;
}
```

Template:

```ftl
${notice.applicant.name}
${notice.applicant.primaryAddressText}
```

### 9.3 Aturan depth

Praktis:

```text
0–2 level: sehat
3 level: masih bisa jika semantik jelas
4+ level: biasanya tanda template terlalu tahu domain graph
```

Contoh baik:

```text
notice.applicant.name
notice.caseSummary.referenceNo
notice.deadline.appealDateText
```

Contoh rawan:

```text
notice.case.application.owner.profile.identityDocument.primaryNumber
```

---

## 10. Preformatted vs Template-Formatted Values

Ini keputusan penting.

### 10.1 Format di template

Contoh:

```html
<span th:text="${#temporals.format(notice.issueDate, 'dd MMM yyyy')}"></span>
```

Keuntungan:

- fleksibel untuk UI;
- template bisa berbeda per locale;
- raw date tetap tersedia.

Kekurangan:

- formatting tersebar di template;
- sulit menjamin semua output sama;
- snapshot historis bergantung pada engine/config sekarang.

### 10.2 Format di presenter

```java
private final String issueDateText;
```

Keuntungan:

- output frozen;
- audit-friendly;
- engine-independent;
- test mudah.

Kekurangan:

- template kurang fleksibel;
- presenter harus tahu locale/timezone;
- beberapa output berbeda butuh presenter berbeda.

### 10.3 Rule of thumb

Gunakan preformatted string untuk:

- legal notice;
- regulatory correspondence;
- email yang harus archived;
- PDF final;
- CSV/fixed-width file;
- output yang perlu reproducibility.

Gunakan raw type untuk:

- interactive UI;
- internal admin dashboard;
- output yang formatting-nya natural di template;
- data yang perlu sorting/filtering client-side.

### 10.4 Hybrid

Expose keduanya jika perlu, dengan nama jelas:

```java
private final LocalDate issueDate;
private final String issueDateText;
```

Tetapi jangan biarkan template memilih bebas tanpa guideline. Kalau `issueDateText` adalah canonical display, template harus memakai itu.

---

## 11. Security Redaction dan Field-Level Authorization

### 11.1 Jangan mengandalkan template untuk menyembunyikan data

Buruk:

```html
<div th:if="${user.canViewIdentityNo}" th:text="${applicant.identityNo}"></div>
```

Masalah: `identityNo` tetap ada di model.

Lebih baik:

```java
ApplicantViewModel applicant = presenter.presentApplicant(applicantData, permissions);
```

Jika user tidak boleh melihat identity number:

```java
private final String identityNoText = "••••1234";
private final boolean identityNoRedacted = true;
```

Atau field tidak ada sama sekali di model untuk template tertentu.

### 11.2 UI authorization bukan data authorization

Template boleh menyembunyikan button:

```html
<button th:if="${page.actions.canApprove}">Approve</button>
```

Tetapi backend tetap wajib enforce permission saat endpoint approve dipanggil.

### 11.3 Field-level authorization di presenter

```java
public ApplicantViewModel present(Applicant applicant, ViewerPermission permission) {
    String identityText = permission.canViewFullIdentityNo()
        ? applicant.identityNo().value()
        : mask(applicant.identityNo().value());

    return new ApplicantViewModel(
        applicant.name().displayName(),
        identityText,
        !permission.canViewFullIdentityNo()
    );
}
```

### 11.4 Sensitive data rule

Untuk model template:

```text
Kalau field tidak diperlukan oleh output, jangan masukkan.
Kalau field tidak boleh dilihat template author, jangan expose.
Kalau field hanya boleh dilihat sebagian user, transform di presenter.
Kalau field bisa masuk ke log rendering, redact sebelum masuk model.
```

---

## 12. Mass Assignment, Form Model, dan Input Boundary

Walaupun part ini fokus output model, desain output sering berdekatan dengan form input.

### 12.1 Masalah binding langsung ke domain/entity

```java
@PostMapping("/users")
public String save(@ModelAttribute UserEntity user) {
    userRepository.save(user);
    return "redirect:/users";
}
```

Jika request mengirim parameter tambahan seperti:

```text
isAdmin=true
status=ACTIVE
role=SUPERUSER
```

maka field yang tidak semestinya bisa ikut ter-bind jika tersedia setter-nya.

### 12.2 Gunakan form DTO

```java
public final class UserCreateForm {
    private String fullName;
    private String email;

    // no isAdmin, no status, no role
}
```

Controller:

```java
@PostMapping("/users")
public String save(@Valid @ModelAttribute("form") UserCreateForm form,
                   BindingResult bindingResult) {
    if (bindingResult.hasErrors()) {
        return "users/create";
    }

    userApplicationService.createUser(form.fullName(), form.email());
    return "redirect:/users";
}
```

### 12.3 Output ViewModel setelah validation error

Untuk form page, model biasanya berisi:

- form object;
- BindingResult;
- select options;
- page metadata;
- action permissions;
- CSRF handled by framework/security integration.

Jangan campur form input object dengan domain entity.

---

## 13. Versioned ViewModel

### 13.1 Kenapa versioning perlu

Template berubah. Model berubah. Business terminology berubah. Tetapi dokumen lama mungkin harus tetap bisa dirender.

Kasus:

- template `approval-letter-v1` memakai `applicantName`;
- template `approval-letter-v2` memakai `recipient.displayName`;
- template `approval-letter-v3` menambah `licenseConditions` wajib.

Jika semua memakai satu model mutable, perubahan akan memecahkan template lama.

### 13.2 Strategi versioning

#### Strategi A — Class per major version

```java
public final class ApprovalLetterV1Model { ... }
public final class ApprovalLetterV2Model { ... }
public final class ApprovalLetterV3Model { ... }
```

Kelebihan:

- jelas;
- aman;
- cocok untuk legal documents.

Kekurangan:

- class bertambah banyak.

#### Strategi B — Compatible additive model

```java
public final class ApprovalLetterModel {
    private final String applicantName; // deprecated but kept
    private final RecipientViewModel recipient;
    private final List<String> licenseConditions;
}
```

Kelebihan:

- hemat class;
- cocok jika perubahan ringan.

Kekurangan:

- model bisa membengkak;
- semantic lama dan baru campur.

#### Strategi C — Map schema per template

```java
Map<String, Object> model = templateModelRegistry.build(templateId, version, sourceData);
```

Kelebihan:

- fleksibel untuk CMS-like template;
- bisa divalidasi terhadap schema.

Kekurangan:

- type safety Java berkurang;
- butuh tooling kuat.

### 13.3 Rule praktis

Untuk output penting:

```text
Version template dan model bersama-sama.
```

Minimal simpan metadata:

```text
templateId
templateVersion
modelVersion
presenterVersion
locale
zoneId
renderedAt
dataSnapshotId
```

---

## 14. Schema-Like Validation untuk Template Model

### 14.1 Mengapa validasi perlu

Template error di production sering berupa:

- missing variable;
- wrong type;
- empty required list;
- null nested object;
- invalid HTML-safe value;
- date belum diformat;
- locale tidak tersedia.

Lebih baik validasi sebelum render.

### 14.2 Bean Validation untuk ViewModel

```java
public final class NoticeViewModel {
    @NotBlank
    private final String referenceNo;

    @NotBlank
    private final String applicantName;

    @NotEmpty
    private final List<ReasonLineViewModel> reasons;
}
```

Renderer pipeline:

```java
validator.validate(viewModel);
renderer.render(templateId, viewModel);
```

### 14.3 Custom validation

Untuk constraint yang lebih domain-specific:

```java
public final class NoticeModelValidator {
    public void validate(NoticeViewModel model) {
        requireNonBlank(model.referenceNo(), "referenceNo");
        requireNonBlank(model.applicantName(), "applicantName");
        requireNonEmpty(model.reasons(), "reasons");

        if (model.showAppealInstruction() && isBlank(model.appealDeadlineText())) {
            throw new InvalidTemplateModelException(
                "appealDeadlineText is required when showAppealInstruction=true"
            );
        }
    }
}
```

### 14.4 Template contract test

Test harus membuktikan:

- presenter menyediakan semua field required;
- template bisa dirender dengan minimum valid model;
- template gagal dengan pesan jelas jika required field hilang;
- optional field tidak menyebabkan error;
- escaping tetap aman.

---

## 15. Contract Testing antara Template dan Model

### 15.1 Golden render test

```java
@Test
void rendersRejectionNotice() {
    NoticeViewModel model = NoticeFixtures.validRejectionNotice();

    String html = renderer.render("case-rejection-notice", "v3", model, Locale.ENGLISH);

    assertThat(html).contains("Application Rejected");
    assertThat(html).contains("REF-2026-0001");
}
```

### 15.2 Missing required field test

```java
@Test
void failsWhenReferenceNoMissing() {
    NoticeViewModel model = NoticeFixtures.validRejectionNoticeWithoutReferenceNo();

    assertThrows(InvalidTemplateModelException.class, () ->
        renderer.render("case-rejection-notice", "v3", model, Locale.ENGLISH)
    );
}
```

### 15.3 Security test

```java
@Test
void escapesApplicantName() {
    NoticeViewModel model = NoticeFixtures.withApplicantName("<script>alert(1)</script>");

    String html = renderer.render("case-notice", "v1", model, Locale.ENGLISH);

    assertThat(html).doesNotContain("<script>");
    assertThat(html).contains("&lt;script&gt;");
}
```

### 15.4 Snapshot testing hati-hati

Snapshot test berguna, tetapi bisa menjadi noise jika terlalu brittle.

Gunakan untuk:

- email layout;
- PDF pre-render HTML;
- legal notice;
- generated config/source;
- critical correspondence.

Hindari snapshot terlalu besar untuk UI yang sering berubah.

---

## 16. ViewModel Immutability

### 16.1 Mengapa immutable

Rendering idealnya deterministic. Immutable model membantu:

- thread-safety;
- test repeatability;
- tidak ada mutation saat render;
- tidak ada accidental lazy change;
- aman untuk cache;
- mudah reasoning.

### 16.2 Java 8 style

```java
public final class ApplicantViewModel {
    private final String name;
    private final String identityNoText;

    public ApplicantViewModel(String name, String identityNoText) {
        this.name = requireNonBlank(name, "name");
        this.identityNoText = requireNonBlank(identityNoText, "identityNoText");
    }

    public String getName() {
        return name;
    }

    public String getIdentityNoText() {
        return identityNoText;
    }
}
```

### 16.3 Java 16+ record style

```java
public record ApplicantViewModel(
    String name,
    String identityNoText
) {
    public ApplicantViewModel {
        name = requireNonBlank(name, "name");
        identityNoText = requireNonBlank(identityNoText, "identityNoText");
    }
}
```

### 16.4 Java 8–25 compatibility note

Untuk seri Java 8–25:

- Java 8: gunakan final class + final fields + getters;
- Java 10+: `var` di local variable tidak mengubah desain model;
- Java 16+: record cocok untuk simple immutable ViewModel;
- Java 21/25: sealed hierarchy bisa membantu polymorphic view model;
- hindari fitur preview agar portable.

---

## 17. Polymorphic ViewModel

Kadang satu template menampilkan item berbeda.

Contoh timeline case:

- submitted event;
- assigned event;
- approved event;
- rejected event;
- document requested event.

### 17.1 Java 8 approach

```java
public interface TimelineItemViewModel {
    String getType();
    String getTitle();
    String getTimestampText();
}

public final class ApprovalTimelineItem implements TimelineItemViewModel { ... }
public final class RejectionTimelineItem implements TimelineItemViewModel { ... }
```

Template:

```ftl
<#list page.timeline as item>
  <div class="timeline-item timeline-${item.type}">
    <strong>${item.title}</strong>
    <span>${item.timestampText}</span>
  </div>
</#list>
```

### 17.2 Java 17+ sealed approach

```java
public sealed interface TimelineItemViewModel
    permits SubmittedItem, ApprovedItem, RejectedItem {
    String type();
    String title();
    String timestampText();
}
```

### 17.3 Jangan expose class name ke template

Buruk:

```html
<div th:if="${item.class.simpleName == 'ApprovedItem'}">
```

Lebih baik:

```java
private final String type; // "approved", "rejected", "submitted"
```

Template memakai semantic type, bukan Java class.

---

## 18. List, Table, Pagination, dan Large Data

### 18.1 Jangan kirim data besar ke template

Buruk:

```java
model.addAttribute("cases", caseRepository.findAll());
```

Masalah:

- memory besar;
- render lambat;
- HTML besar;
- browser lambat;
- query mahal;
- security filtering rawan.

### 18.2 Page model

```java
public final class CaseListPageViewModel {
    private final List<CaseRowViewModel> rows;
    private final PaginationViewModel pagination;
    private final FilterViewModel filters;
    private final List<ActionViewModel> actions;
}
```

### 18.3 Row model

```java
public final class CaseRowViewModel {
    private final String referenceNo;
    private final String applicantName;
    private final String statusLabel;
    private final String submittedDateText;
    private final String detailUrl;
}
```

Template tidak perlu tahu query, entity, atau pagination internals.

### 18.4 Table design invariant

```text
Template table menerima rows siap tampil.
Template tidak melakukan filtering besar.
Template tidak melakukan sorting business-critical.
Template tidak memicu lazy query.
```

---

## 19. URL, Link, dan Action Model

### 19.1 Jangan hardcode authorization action di template

Buruk:

```html
<a th:if="${user.role == 'ADMIN'}" th:href="@{/cases/{id}/approve(id=${case.id})}">Approve</a>
```

Lebih baik:

```java
public final class CaseDetailActionsViewModel {
    private final boolean canApprove;
    private final String approveUrl;
    private final boolean canReject;
    private final String rejectUrl;
}
```

Template:

```html
<a th:if="${page.actions.canApprove}"
   th:href="${page.actions.approveUrl}">Approve</a>
```

### 19.2 URL building policy

Pilihan:

- build URL di controller/presenter;
- build URL di template menggunakan routing helper;
- hybrid.

Untuk Thymeleaf MVC, `@{...}` bagus untuk path yang sederhana. Namun untuk action yang permission-dependent atau tenant-dependent, presenter bisa memberi action model.

### 19.3 Action model

```java
public final class ActionViewModel {
    private final String code;
    private final String label;
    private final String url;
    private final String method;
    private final boolean enabled;
    private final String disabledReason;
}
```

Ini berguna untuk:

- button rendering;
- menu item;
- workflow action;
- bulk action;
- audit explanation.

---

## 20. Message, Label, dan Localization Model

### 20.1 Jangan campur terlalu banyak pilihan

Ada tiga cara umum:

1. template memanggil message bundle;
2. presenter mengirim localized string;
3. presenter mengirim message code + args.

### 20.2 Template-localized

```html
<h1 th:text="#{case.detail.title}"></h1>
```

Baik untuk UI static labels.

### 20.3 Presenter-localized

```java
private final String statusLabel;
private final String issueDateText;
```

Baik untuk dokumen final dan email.

### 20.4 Message code model

```java
public final class LabelViewModel {
    private final String code;
    private final List<String> args;
}
```

Baik jika butuh separation kuat antara business semantic dan locale rendering, tetapi lebih kompleks.

### 20.5 Rule praktis

```text
Static UI label: message bundle di template.
Business status label: presenter atau centralized formatter.
Legal/document text: template + versioned message bundle atau fully localized template.
Audit-critical formatted text: freeze di presenter atau archive rendered output.
```

---

## 21. Template Model Registry

Untuk sistem besar, simpan metadata model.

### 21.1 Registry sederhana

```java
public interface TemplateModelDefinition<T> {
    String templateId();
    String templateVersion();
    Class<T> modelType();
    void validate(T model);
    T sample(Locale locale);
}
```

### 21.2 Use case

Registry membantu:

- preview template;
- validate sebelum publish;
- generate documentation;
- run compatibility test;
- create sample data;
- enforce model type;
- detect stale template.

### 21.3 Example

```java
public final class RejectionNoticeV3Definition
        implements TemplateModelDefinition<RejectionNoticeV3Model> {

    @Override
    public String templateId() {
        return "case-rejection-notice";
    }

    @Override
    public String templateVersion() {
        return "3";
    }

    @Override
    public Class<RejectionNoticeV3Model> modelType() {
        return RejectionNoticeV3Model.class;
    }

    @Override
    public void validate(RejectionNoticeV3Model model) {
        RejectionNoticeV3Validator.validate(model);
    }

    @Override
    public RejectionNoticeV3Model sample(Locale locale) {
        return RejectionNoticeFixtures.valid(locale);
    }
}
```

---

## 22. Mapping Strategy: Manual vs Mapper Library

### 22.1 Manual mapping

```java
public CaseDetailViewModel present(CaseDetailData data, Locale locale) {
    return new CaseDetailViewModel(
        data.referenceNo(),
        data.applicantName(),
        statusFormatter.format(data.status(), locale),
        dateFormatter.format(data.submittedAt(), locale)
    );
}
```

Keuntungan:

- eksplisit;
- mudah review;
- security transform terlihat;
- cocok untuk output kritikal.

Kekurangan:

- verbose.

### 22.2 Mapper library

MapStruct atau mapper lain bisa membantu untuk field sederhana, tetapi hati-hati.

Gunakan mapper untuk:

- field copy sederhana;
- nested-to-flat mapping yang jelas;
- generated boilerplate.

Jangan sembunyikan:

- masking;
- permission logic;
- locale formatting;
- fallback legal text;
- template version selection.

### 22.3 Rule

```text
Mapping yang punya konsekuensi security, legal, audit, atau workflow harus eksplisit dan mudah direview.
```

---

## 23. FreeMarker-Specific Model Design

### 23.1 FreeMarker melihat model melalui ObjectWrapper

FreeMarker tidak langsung melihat Java object sebagaimana Java code melihatnya. ObjectWrapper memetakan Java object ke type system FTL.

Implikasi:

- getter JavaBean terlihat sebagai property;
- Map terlihat seperti hash;
- List terlihat seperti sequence;
- method bisa terekspos tergantung wrapper/config;
- object kompleks bisa membuka surface area besar.

### 23.2 Prefer simple POJO/record/Map yang terkendali

Untuk FreeMarker:

- root Map kecil;
- value berupa immutable ViewModel;
- getter tanpa side effect;
- no service object;
- no repository;
- no entity manager;
- no request/session object mentah.

### 23.3 Getter harus murah

Buruk:

```java
public List<Document> getDocuments() {
    return documentRepository.findByCaseId(id);
}
```

Template memanggil getter berkali-kali, dan setiap pemanggilan bisa memicu query.

Getter ViewModel harus:

- pure;
- cheap;
- deterministic;
- no I/O;
- no DB;
- no remote call;
- no mutation.

### 23.4 Map vs typed model

Map fleksibel:

```java
Map<String, Object> model = new HashMap<>();
model.put("notice", noticeVm);
```

Typed model lebih stabil:

```java
public final class TemplateRoot<T> {
    private final T data;
    private final RenderMetadata metadata;
}
```

Praktisnya, FreeMarker root biasanya Map, tetapi values-nya sebaiknya typed immutable ViewModel.

---

## 24. Thymeleaf-Specific Model Design

### 24.1 Thymeleaf model attributes sebagai context variables

Dalam Spring MVC, attributes yang ditambahkan ke `Model` menjadi context variables yang bisa diakses dengan `${attributeName}`.

```java
model.addAttribute("page", pageVm);
```

Template:

```html
<h1 th:text="${page.title}"></h1>
```

### 24.2 Form object naming

Untuk form, nama object harus stabil.

```java
model.addAttribute("form", form);
```

Template:

```html
<form th:object="${form}" method="post">
    <input th:field="*{email}">
</form>
```

Jangan ubah nama `form` tanpa migration template.

### 24.3 Page model pattern

Untuk Thymeleaf UI, pola umum:

```java
public final class PageViewModel<T> {
    private final String title;
    private final BreadcrumbViewModel breadcrumb;
    private final T content;
    private final PageActionsViewModel actions;
    private final FlashMessageViewModel flash;
}
```

Atau per page:

```java
public final class CaseDetailPageViewModel {
    private final String title;
    private final CaseHeaderViewModel header;
    private final CaseTimelineViewModel timeline;
    private final CaseActionsViewModel actions;
}
```

### 24.4 Avoid domain graph in SpEL

Thymeleaf dengan SpringEL cukup powerful untuk traversing object graph. Justru karena powerful, model harus dibatasi.

Template sebaiknya tidak melakukan:

```html
<span th:text="${case.owner.department.parent.organization.region.country.name}"></span>
```

Presenter harus menyederhanakan:

```html
<span th:text="${page.ownerOrganizationText}"></span>
```

---

## 25. Multi-Output Model: HTML, Email, PDF, CSV

### 25.1 Jangan pakai satu model universal besar

Buruk:

```java
public final class CaseEverythingModel {
    // 120 fields for UI, email, PDF, CSV, audit, workflow
}
```

Masalah:

- sulit dipahami;
- field sensitif tersebar;
- semua template terlihat bisa memakai semua data;
- versioning kacau;
- testing berat.

### 25.2 Gunakan model per output

```text
CaseDetailPageViewModel
CaseReminderEmailModel
CaseApprovalLetterPdfModel
CaseExportCsvRowModel
```

Masing-masing punya contract dan validation sendiri.

### 25.3 Shared submodel boleh

```java
public final class ApplicantDisplayBlock { ... }
public final class OfficerSignatureBlock { ... }
public final class AgencyBrandingBlock { ... }
```

Tetapi shared submodel harus stabil dan benar-benar reusable.

---

## 26. Snapshot dan Reproducibility

### 26.1 Problem

Jika dokumen dirender ulang 2 tahun kemudian, apakah hasilnya sama?

Faktor yang bisa berubah:

- template version;
- message bundle;
- formatter;
- timezone config;
- domain data;
- officer name;
- agency branding;
- legal clause;
- dependency version;
- CSS/font;
- external asset.

### 26.2 Snapshot strategy

Untuk output penting:

Simpan:

- rendered output final; atau
- input model snapshot + template version + renderer version + assets version.

### 26.3 Model snapshot

```json
{
  "templateId": "case-rejection-notice",
  "templateVersion": "3",
  "modelVersion": "3",
  "locale": "en-SG",
  "zoneId": "Asia/Singapore",
  "renderedAt": "2026-06-19T10:15:30+08:00",
  "model": {
    "referenceNo": "CASE-2026-0001",
    "applicantName": "Jane Tan",
    "reasons": [
      { "code": "REQ_MISSING", "text": "Required document was not submitted." }
    ]
  }
}
```

### 26.4 Defensible rendering

Untuk regulatory/case-management system, output bukan sekadar tampilan. Ia bisa menjadi evidence.

Maka model design harus mendukung:

- siapa menerima;
- apa data saat render;
- template apa;
- versi apa;
- aturan apa;
- locale/timezone apa;
- kapan dirender;
- siapa yang trigger;
- apakah output dikirim/diunduh/disimpan.

---

## 27. Template Model Documentation

### 27.1 Dokumentasi minimal

Untuk setiap template:

```markdown
# Template: case-rejection-notice v3

## Purpose
Generate rejection notice email and PDF for case rejection workflow.

## Root Variable
`notice`

## Required Fields
- `notice.referenceNo`: string, non-empty
- `notice.applicantName`: string, escaped text
- `notice.issueDateText`: string, localized
- `notice.rejectionReasons`: list, non-empty

## Optional Fields
- `notice.appealDeadlineText`: string, optional
- `notice.additionalInstructionHtml`: sanitized markup, optional

## Security Rules
- Identity number must be masked.
- Internal notes must not appear.
- Raw HTML is forbidden except `additionalInstructionHtml` after sanitization.

## Compatibility
- v3 adds `appealDeadlineText`.
- v2 field `deadlineText` is deprecated.
```

### 27.2 Generate documentation from registry

Jika model registry ada, sebagian dokumentasi bisa digenerate:

- class name;
- field names;
- required annotation;
- sample model;
- template IDs;
- versions.

Manual docs tetap perlu untuk semantics dan security.

---

## 28. Anti-Pattern Catalog

### 28.1 God model

Satu model untuk semua output.

Dampak:

- sulit versioning;
- field sensitif mudah bocor;
- template coupling tinggi.

### 28.2 Entity graph exposure

Template menerima JPA entity.

Dampak:

- lazy loading;
- N+1 query;
- security leak;
- fragile templates.

### 28.3 Logic-heavy template

Template menentukan rule bisnis.

Dampak:

- rule tidak teruji;
- behavior beda antar template;
- sulit audit.

### 28.4 Stringly typed everything

Semua field jadi `String` tanpa semantic.

Dampak:

- sorting/date logic salah;
- sulit validasi;
- formatting double.

### 28.5 Over-abstracted component model

Semua hal dibuat generic component.

Dampak:

- sulit dibaca;
- sulit debug;
- template menjadi framework internal rumit.

### 28.6 Hidden I/O getter

Getter melakukan query/remote call.

Dampak:

- render lambat;
- error unpredictable;
- observability sulit.

### 28.7 Template depends on Java class name

Template melakukan branching berdasarkan `class.simpleName`.

Dampak:

- refactor Java memecahkan template;
- semantic tidak eksplisit.

### 28.8 Security by template condition

Data sensitif dikirim ke template lalu disembunyikan dengan `if`.

Dampak:

- model leak;
- log leak;
- hidden field leak;
- future template misuse.

---

## 29. Production Checklist

Sebelum template model dianggap production-ready, cek:

### Contract

- [ ] Root variable jelas.
- [ ] Required/optional field terdokumentasi.
- [ ] Model type jelas.
- [ ] Template version dan model version selaras.
- [ ] Breaking change punya migration plan.

### Security

- [ ] Tidak expose entity/domain aggregate langsung.
- [ ] Tidak expose service/repository/request/session mentah.
- [ ] Field sensitif di-redact/masked sebelum masuk model.
- [ ] Field-level authorization dilakukan di presenter/application layer.
- [ ] Raw HTML punya type/nama yang eksplisit dan sudah disanitasi.

### Performance

- [ ] Getter model tidak melakukan I/O.
- [ ] List sudah dipagination jika besar.
- [ ] Tidak ada lazy loading saat render.
- [ ] Model tidak membawa data tidak dipakai.

### Testability

- [ ] Ada fixture valid.
- [ ] Ada fixture edge case.
- [ ] Ada render test.
- [ ] Ada escaping/security test.
- [ ] Ada locale/timezone test jika relevan.

### Reproducibility

- [ ] Template ID/version disimpan.
- [ ] Locale/timezone eksplisit.
- [ ] Formatter deterministic.
- [ ] Output final atau model snapshot diarsipkan jika perlu.

---

## 30. Mini Blueprint: Case Rejection Notice Model

### 30.1 Domain data

```java
public final class CaseRejectionData {
    private final String caseReferenceNo;
    private final String applicantName;
    private final String applicantIdentityNo;
    private final LocalDate rejectionDate;
    private final List<RejectionReason> reasons;
    private final LocalDate appealDeadline;
    private final Officer officer;
}
```

### 30.2 View model

```java
public final class CaseRejectionNoticeModel {
    private final String referenceNo;
    private final String applicantName;
    private final String maskedIdentityNo;
    private final String rejectionDateText;
    private final List<ReasonLineModel> reasons;
    private final boolean showAppealInstruction;
    private final String appealDeadlineText;
    private final SignatureBlockModel signature;

    // constructor validates required fields
    // getters only, no side effects
}
```

### 30.3 Presenter

```java
public final class CaseRejectionNoticePresenter {
    private final DateTextFormatter dateTextFormatter;
    private final IdentityMasker identityMasker;
    private final ReasonTextFormatter reasonTextFormatter;

    public CaseRejectionNoticeModel present(CaseRejectionData data,
                                            Locale locale,
                                            ZoneId zoneId,
                                            ViewerPermission permission) {
        String maskedIdentity = identityMasker.mask(data.getApplicantIdentityNo());

        List<ReasonLineModel> reasons = data.getReasons().stream()
            .map(reason -> new ReasonLineModel(
                reason.getCode(),
                reasonTextFormatter.format(reason, locale)
            ))
            .collect(Collectors.toList());

        return new CaseRejectionNoticeModel(
            data.getCaseReferenceNo(),
            data.getApplicantName(),
            maskedIdentity,
            dateTextFormatter.format(data.getRejectionDate(), locale, zoneId),
            reasons,
            data.getAppealDeadline() != null,
            data.getAppealDeadline() == null
                ? null
                : dateTextFormatter.format(data.getAppealDeadline(), locale, zoneId),
            SignatureBlockModel.from(data.getOfficer())
        );
    }
}
```

### 30.4 FreeMarker usage

```ftl
<h1>Rejection Notice</h1>
<p>Reference: ${notice.referenceNo}</p>
<p>Applicant: ${notice.applicantName}</p>
<p>Identity: ${notice.maskedIdentityNo}</p>
<p>Date: ${notice.rejectionDateText}</p>

<ul>
<#list notice.reasons as reason>
  <li>${reason.text}</li>
</#list>
</ul>

<#if notice.showAppealInstruction>
  <p>You may appeal by ${notice.appealDeadlineText}.</p>
</#if>
```

### 30.5 Thymeleaf usage

```html
<h1>Rejection Notice</h1>
<p>Reference: <span th:text="${notice.referenceNo}"></span></p>
<p>Applicant: <span th:text="${notice.applicantName}"></span></p>
<p>Identity: <span th:text="${notice.maskedIdentityNo}"></span></p>
<p>Date: <span th:text="${notice.rejectionDateText}"></span></p>

<ul>
  <li th:each="reason : ${notice.reasons}" th:text="${reason.text}"></li>
</ul>

<p th:if="${notice.showAppealInstruction}">
  You may appeal by <span th:text="${notice.appealDeadlineText}"></span>.
</p>
```

### 30.6 Important observation

FreeMarker dan Thymeleaf berbeda syntax, tetapi model yang sehat tetap sama:

```text
stable, small, explicit, immutable, validated, safe, output-oriented.
```

---

## 31. Advanced Design: Template Model as Read Model

Dalam sistem besar, ViewModel sering mirip read model CQRS.

### 31.1 Kapan presenter cukup

Presenter cukup jika:

- data berasal dari satu use case;
- query tidak mahal;
- model tidak dipakai ulang banyak tempat;
- template tidak perlu historical replay kompleks.

### 31.2 Kapan perlu read model khusus

Butuh read model jika:

- template mengambil data dari banyak bounded context;
- rendering batch besar;
- dokumen harus reproducible;
- data perlu denormalized;
- output sering dibuka ulang;
- ada multi-tenant template;
- query real-time terlalu mahal.

### 31.3 Example

```text
Case Aggregate
Applicant Profile
License Registry
Payment Status
Officer Directory
Agency Branding
        ↓
Correspondence Read Model
        ↓
Template Presenter
        ↓
Notice ViewModel
```

Read model mengurangi coupling rendering terhadap banyak sumber data.

---

## 32. Failure Modeling

### 32.1 Failure classes

| Failure | Contoh | Pencegahan |
|---|---|---|
| Missing required field | `referenceNo` null | constructor validation |
| Wrong semantic | full identity exposed | presenter masking test |
| Wrong locale | date in server default | explicit locale/zone |
| Wrong version | template v3 with model v2 | registry compatibility |
| Lazy load failure | session closed | no entity exposure |
| Large model | 100k rows | pagination/export pipeline |
| Unsafe HTML | user HTML rendered raw | sanitize + typed safe html |
| Authorization leak | hidden field contains secret | field-level model filtering |

### 32.2 Fail before render

Production renderer sebaiknya punya pipeline:

```text
build source data
→ present view model
→ validate model
→ classify output context
→ render
→ validate output if needed
→ persist/send/return
```

Jangan biarkan template menjadi tempat pertama yang menemukan model invalid.

---

## 33. Design Heuristics untuk Top 1% Engineer

1. Template model adalah public API untuk template.
2. Jangan expose object yang lebih powerful daripada kebutuhan template.
3. Template tidak boleh menjadi query engine.
4. Template tidak boleh menjadi authorization engine.
5. Presenter adalah tempat shaping, redaction, formatting policy, dan derived display state.
6. Required field harus fail sebelum render.
7. Optional field harus punya semantic yang jelas.
8. Field sensitif harus dihilangkan atau ditransform sebelum masuk model.
9. Model untuk email/PDF/legal document harus lebih ketat daripada model dashboard.
10. Version template dan model jika output harus bertahan lama.
11. Simpan snapshot atau rendered output untuk audit-critical artifact.
12. Getter model harus pure dan murah.
13. Jangan pakai entity graph sebagai template contract.
14. Jangan membangun god model.
15. Test template seperti software, bukan asset statis.

---

## 34. Ringkasan

Pada part ini kita membahas bahwa kekuatan template engineering bukan hanya pada syntax FreeMarker atau Thymeleaf, melainkan pada desain model yang diberikan ke template.

Poin paling penting:

- Template data model adalah contract.
- Entity exposure adalah anti-pattern untuk sistem production serius.
- ViewModel harus output-oriented, aman, immutable, validated, dan stabil.
- Presenter mengubah domain/application data menjadi model presentasi.
- Form model berbeda dari output ViewModel.
- Required/optional/null policy harus eksplisit.
- Field sensitif harus disaring sebelum masuk model.
- Versioning penting untuk email/dokumen/regulatory output.
- Contract testing mencegah template pecah di production.
- FreeMarker dan Thymeleaf berbeda engine, tetapi prinsip model sehat tetap sama.

Jika Part 0–21 membangun mental model, engine, rendering, security, performance, email, document, dan localization, maka Part 22 ini menjawab pertanyaan inti:

> “Data seperti apa yang seharusnya diberikan ke template agar rendering subsystem bisa aman, stabil, performan, testable, dan defensible?”

Jawaban singkatnya:

```text
Berikan template model yang kecil, eksplisit, immutable, versioned bila perlu,
validated sebelum render, sudah melalui security filtering, dan didesain khusus
untuk output artifact yang sedang dibuat.
```

---

## 35. Referensi

- Apache FreeMarker Manual — Template + data-model = output: https://freemarker.apache.org/docs/dgui_quickstart_basics.html
- Apache FreeMarker Manual — Create a data-model: https://freemarker.apache.org/docs/pgui_quickstart_createdatamodel.html
- Apache FreeMarker Manual — Object wrappers: https://freemarker.apache.org/docs/pgui_datamodel_objectWrapper.html
- Apache FreeMarker — Java Template Engine overview: https://freemarker.apache.org/index.html
- Thymeleaf Documentation — Using Thymeleaf: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- Thymeleaf Article — Spring MVC and Thymeleaf access model data: https://www.thymeleaf.org/doc/articles/springmvcaccessdata.html
- Spring Framework Reference — Thymeleaf integration: https://docs.spring.io/spring-framework/reference/web/webmvc-view/mvc-thymeleaf.html
- Spring Framework Reference — `@ModelAttribute`: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/modelattrib-method-args.html
- Spring Framework Javadoc — `BindingResult`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/validation/BindingResult.html
- Spring Framework Reference — Validation, Data Binding, and Type Conversion: https://docs.spring.io/spring-framework/reference/core/validation.html
- OWASP Cheat Sheet Series — Mass Assignment Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- OWASP WSTG — Testing for Mass Assignment: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/20-Testing_for_Mass_Assignment

---

## Status Seri

```text
Part 22 selesai.
Seri belum selesai.
Berikutnya: Part 23 — Template Versioning, Governance, CMS-like Editing, and Multi-Tenant Templates.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-021.md">⬅️ Part 21 — Internationalization, Localization, Locale, Timezone, and Formatting</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-023.md">Part 23 — Template Versioning, Governance, CMS-like Editing, and Multi-Tenant Templates ➡️</a>
</div>
