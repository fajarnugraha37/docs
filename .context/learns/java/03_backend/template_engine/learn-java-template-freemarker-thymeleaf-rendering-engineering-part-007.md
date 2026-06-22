# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-007

# Part 7 — FreeMarker Object Wrapping, Type Exposure, and Security Boundary

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Fokus: Java 8–25, FreeMarker, Thymeleaf, template rendering, enterprise rendering architecture  
> Posisi: Part 7 dari 35  
> Prasyarat: Part 0–6, terutama FreeMarker architecture, FTL expression model, directive, macro, function, dan reusable template API

---

## 0. Tujuan Pembelajaran

Bagian ini membahas salah satu lapisan paling penting dalam FreeMarker production engineering: **bagaimana object Java terlihat dari template**.

Di FreeMarker, template tidak langsung melihat object Java apa adanya. Java object diubah menjadi model FreeMarker melalui **object wrapper**. Wrapper inilah yang menentukan:

- apakah `user.name` berarti `Map.get("name")`, `getName()`, atau property lain;
- apakah template boleh memanggil method Java;
- apakah template boleh melihat API asli object;
- apakah method seperti `getClass()`, `wait()`, `notify()`, `toString()`, atau method domain lain terlihat;
- apakah Map diperlakukan sebagai hash biasa atau juga sebagai object Java;
- apakah template author bisa mengakses class Java tertentu;
- apakah data model menjadi presentation contract yang aman atau pintu masuk menuju internal runtime.

Target setelah bagian ini:

1. Mampu menjelaskan mental model `ObjectWrapper`, `TemplateModel`, `BeansWrapper`, dan `DefaultObjectWrapper`.
2. Mampu membedakan **template data access** dari **Java object access**.
3. Mampu mendesain data model FreeMarker yang aman, stabil, dan eksplisit.
4. Mampu memahami kenapa exposing entity/service/repository langsung ke template adalah desain berbahaya.
5. Mampu membangun policy untuk trusted dan untrusted template authors.
6. Mampu menghindari Server-Side Template Injection, data leakage, method abuse, dan accidental privilege expansion.
7. Mampu menyusun konfigurasi FreeMarker production-grade yang membatasi type exposure.

---

## 1. Kenapa Object Wrapping Sangat Penting?

Pada level syntax, FreeMarker tampak sederhana:

```ftl
Hello ${user.name}
```

Namun pertanyaan sebenarnya adalah:

> Apa itu `user`?  
> Apa itu `name`?  
> Dari mana template tahu cara membaca `user.name`?  
> Apakah `user.name` hanya membaca field presentation biasa?  
> Atau memanggil method Java?  
> Apakah method lain juga bisa dipanggil?  
> Apakah template bisa menjelajah object graph lebih jauh?

Di Java, data bisa berbentuk:

```java
Map<String, Object> model;
UserView userView;
UserEntity userEntity;
RecordDto recordDto;
List<OrderView> orders;
Optional<String> nickname;
LocalDate birthDate;
BigDecimal amount;
Enum<?> status;
```

FTL tidak bekerja langsung dengan semua tipe Java tersebut. FreeMarker perlu menerjemahkannya ke dalam type system template:

- scalar/string;
- number;
- boolean;
- date/time;
- sequence;
- hash;
- method;
- directive;
- markup output;
- adapter/wrapped object.

Lapisan penerjemahan ini disebut **object wrapping**.

Secara mental model:

```text
Java object graph
      |
      v
ObjectWrapper
      |
      v
TemplateModel graph
      |
      v
FTL expression evaluation
      |
      v
Rendered output
```

Jadi object wrapper adalah **security boundary + semantic boundary + compatibility boundary**.

Jika wrapper terlalu permissive, template bisa melihat terlalu banyak. Jika wrapper terlalu restrictive, template menjadi sulit dipakai. Top 1% engineer tidak memilih salah satunya secara ekstrem; mereka mendesain exposure secara sadar berdasarkan trust model.

---

## 2. FreeMarker Tidak Melihat Java Object Secara Mentah

FreeMarker memakai interface `TemplateModel` untuk merepresentasikan nilai yang bisa dipakai oleh template.

Contoh konseptual:

```java
Map<String, Object> root = new HashMap<>();
root.put("user", new UserView("Fajar", "Admin"));

template.process(root, writer);
```

Ketika template menulis:

```ftl
${user.name}
```

FreeMarker tidak membaca field Java secara literal. Yang terjadi kira-kira:

```text
1. root model diterima oleh engine.
2. ObjectWrapper membungkus Map menjadi TemplateHashModel.
3. Key "user" dicari.
4. Object Java UserView dibungkus menjadi TemplateModel.
5. Ekspresi `.name` dievaluasi melalui aturan object wrapper.
6. Jika property `name` visible, nilainya dikembalikan sebagai TemplateScalarModel.
7. Output writer menerima string hasil rendering.
```

Dengan kata lain:

> Template tidak punya akses natural ke Java. Template punya akses ke **representasi Java yang diputuskan oleh wrapper**.

Inilah sebabnya konfigurasi wrapper menjadi keputusan arsitektur, bukan sekadar detail framework.

---

## 3. Istilah Penting

### 3.1 `ObjectWrapper`

`ObjectWrapper` adalah komponen yang mengubah Java object menjadi `TemplateModel`.

Contoh kategori mapping:

| Java Object | FTL View |
|---|---|
| `String` | scalar |
| `Number` | number |
| `Boolean` | boolean |
| `Date` / temporal type tertentu | date/time |
| `List` / array | sequence |
| `Map` | hash |
| JavaBean object | hash-like object dengan property/method |
| custom directive | directive |
| custom method | method |

Object wrapper menjawab pertanyaan:

> “Kalau template melihat object ini, operasi apa yang boleh dilakukan?”

---

### 3.2 `TemplateModel`

`TemplateModel` adalah interface marker/contract FreeMarker untuk nilai yang dapat dipakai FTL.

Beberapa model penting:

```text
TemplateScalarModel      -> string-like value
TemplateNumberModel      -> number-like value
TemplateBooleanModel     -> boolean-like value
TemplateDateModel        -> date/time-like value
TemplateSequenceModel    -> list/array-like value
TemplateHashModel        -> map/object-like value
TemplateMethodModelEx    -> callable method-like value
TemplateDirectiveModel   -> directive-like value
```

Kalau Java object sudah berupa `TemplateModel`, wrapper biasanya tidak perlu mengubahnya lagi.

---

### 3.3 `BeansWrapper`

`BeansWrapper` adalah wrapper yang bisa mengekspos JavaBean property dan method. Ia membuat object Java terlihat seperti hash bagi template.

Misalnya:

```java
public class UserView {
    public String getName() { return "Fajar"; }
    public String getRole() { return "Admin"; }
}
```

Di template:

```ftl
${user.name}
${user.role}
```

`user.name` dapat dipetakan ke `getName()`.

Masalahnya: begitu JavaBean/method exposure dibuka, kita harus memahami method apa saja yang terlihat, mana yang sensitif, dan apakah template author dipercaya.

---

### 3.4 `DefaultObjectWrapper`

`DefaultObjectWrapper` adalah wrapper yang umum dipakai untuk aplikasi modern. Ia merupakan extension dari BeansWrapper, tetapi memiliki perilaku yang lebih cocok untuk container Java umum seperti `Map`, `List`, array, iterator, dan sebagainya.

Secara praktis, untuk aplikasi modern:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

DefaultObjectWrapperBuilder wrapperBuilder =
        new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34);

cfg.setObjectWrapper(wrapperBuilder.build());
```

Namun dalam organisasi enterprise, jangan berhenti di “pakai default”. Tanyakan:

1. Apakah template author semua trusted developer?
2. Apakah template bisa diedit admin/business user?
3. Apakah template disimpan di database?
4. Apakah user eksternal bisa memengaruhi isi template?
5. Apakah object yang diberikan ke template berupa DTO aman atau entity/service internal?

Jawaban pertanyaan itu menentukan konfigurasi dan desain model.

---

## 4. Data Model Access vs Java Object Access

Ini distinction yang sangat penting.

### 4.1 Data Model Access

Data model access berarti template hanya membaca data yang memang disiapkan untuk rendering.

Contoh aman:

```java
public record UserProfileView(
        String displayName,
        String roleLabel,
        String maskedEmail
) {}
```

Template:

```ftl
<p>Name: ${user.displayName}</p>
<p>Role: ${user.roleLabel}</p>
<p>Email: ${user.maskedEmail}</p>
```

Di sini template hanya melihat field presentation yang sudah aman.

---

### 4.2 Java Object Access

Java object access berarti template bisa berinteraksi dengan object runtime yang punya method, behavior, lazy loading, internal state, atau relasi domain.

Contoh berbahaya:

```java
model.put("user", userEntity);
model.put("case", enforcementCaseEntity);
model.put("repository", caseRepository);
model.put("securityContext", securityContext);
```

Template mungkin bisa menulis:

```ftl
${case.applicant.nric}
${case.internalRemarks}
${user.passwordHash}
${securityContext.authentication.name}
```

Bahkan jika method tertentu tidak sengaja dibuat public, template bisa menjadi jalur leakage.

Ingat prinsip ini:

> Public method di Java object bukan berarti aman untuk template.

Aplikasi Java sering membuat method public untuk alasan persistence, serialization, testing, proxying, atau framework binding. Template exposure punya konteks berbeda.

---

## 5. Template Data Model sebagai API

Data model untuk template harus dianggap sebagai API.

Bukan API HTTP, tetapi API internal antara application layer dan rendering layer.

```text
Application service
      |
      v
Rendering ViewModel Contract
      |
      v
Template Engine
      |
      v
Output Artifact
```

Jika template memakai `${case.officer.name}`, berarti `case.officer.name` adalah contract. Jika field itu hilang, berubah tipe, atau berubah semantic, template bisa rusak.

Karena itu, data model yang baik memiliki sifat:

1. **Explicit** — field yang tersedia jelas.
2. **Minimal** — hanya field yang diperlukan output.
3. **Stable** — tidak berubah tanpa versioning.
4. **Safe** — tidak mengandung data sensitif yang tidak perlu.
5. **Precomputed** — tidak membuat template melakukan query/business logic.
6. **Presentation-oriented** — label, formatted value, visibility flag disiapkan sadar.
7. **Testable** — bisa divalidasi terhadap template.

Contoh buruk:

```java
model.put("case", caseEntity);
```

Contoh baik:

```java
model.put("case", new CaseNoticeView(
        caseId,
        applicantDisplayName,
        maskedIdentifier,
        formattedSubmissionDate,
        officerDisplayName,
        decisionLabel,
        reasonParagraphs,
        showAppealInstructions
));
```

---

## 6. Threat Model: Siapa yang Menulis Template?

Security boundary tidak bisa dibahas tanpa trust model.

### 6.1 Trusted Developer Templates

Template ditulis developer internal, direview, masuk Git, dites di CI, dan deploy bersama aplikasi.

Risiko utama:

- accidental data leakage;
- XSS karena escaping salah;
- template runtime error;
- over-complex template;
- entity lazy loading;
- fragile model contract;
- template performance issue.

Untuk model ini, kita masih harus disiplin, tetapi tidak perlu sandbox ekstrem jika template tidak bisa diubah runtime oleh pihak tak dipercaya.

---

### 6.2 Semi-Trusted Admin Templates

Template bisa diedit admin, operator, atau business user internal melalui UI.

Risiko naik drastis:

- template injection;
- accidental access ke data sensitif;
- denial-of-service melalui loop besar/rekursi;
- abuse method/object yang tidak dimaksudkan;
- rendering output yang melanggar compliance;
- broken correspondence ke citizen/customer.

Untuk model ini, jangan expose Java object kaya behavior. Gunakan data model minimal, disable fitur berbahaya, validasi template sebelum publish, dan audit semua perubahan.

---

### 6.3 Untrusted User Templates

Template bisa dikirim/dikontrol user eksternal, tenant tidak dipercaya, plugin pihak ketiga, atau input bebas.

Risiko sangat tinggi:

- SSTI;
- remote code execution jika konfigurasi salah;
- data exfiltration;
- filesystem/classpath exploration;
- resource exhaustion;
- bypass authorization;
- rendering arbitrary content.

Untuk model ini:

> Jangan izinkan FreeMarker sebagai general-purpose user template engine tanpa sandbox ketat, allowlist, resource limit, dan threat review.

Bahkan dengan sandbox, treat sebagai high-risk feature.

---

## 7. Kenapa Entity Tidak Boleh Diekspos Langsung?

Misalnya ada entity:

```java
@Entity
public class EnforcementCase {
    private String caseNo;
    private String internalMemo;
    private Applicant applicant;
    private List<InvestigationNote> notes;
    private CaseStatus status;

    public String getCaseNo() { return caseNo; }
    public String getInternalMemo() { return internalMemo; }
    public Applicant getApplicant() { return applicant; }
    public List<InvestigationNote> getNotes() { return notes; }
    public CaseStatus getStatus() { return status; }
}
```

Template hanya butuh:

```ftl
Case Number: ${case.caseNo}
Applicant: ${case.applicantName}
Status: ${case.statusLabel}
```

Tapi jika entity langsung diekspos, template mungkin bisa menjangkau:

```ftl
${case.internalMemo}
${case.notes[0].createdBy.email}
${case.applicant.nationalIdentifier}
```

Masalahnya bukan hanya keamanan. Ada juga risiko engineering:

1. **Lazy loading**  
   Template bisa memicu query saat rendering.

2. **N+1 query**  
   Loop template atas relasi entity bisa memicu banyak query.

3. **Transaction coupling**  
   Rendering jadi bergantung pada persistence context masih terbuka.

4. **Data leakage**  
   Field internal terlihat karena getter public.

5. **Fragility**  
   Rename getter entity bisa merusak template.

6. **Domain pollution**  
   Entity berubah demi kebutuhan tampilan.

7. **Authorization bypass**  
   Field yang harusnya disaring per role tetap tersedia.

Rule production:

> Template tidak menerima entity. Template menerima ViewModel.

---

## 8. Kenapa Service/Repository Tidak Boleh Diekspos?

Contoh sangat buruk:

```java
model.put("caseService", caseService);
model.put("userRepository", userRepository);
```

Template lalu bisa melakukan:

```ftl
${caseService.findById(caseId).internalMemo}
```

Ini mengubah template menjadi execution layer.

Konsekuensi:

- template melakukan business query;
- authorization layer bisa terlewati;
- performance tak bisa diprediksi;
- template menjadi sulit dites;
- method public service menjadi attack surface;
- rendering tidak lagi deterministic transformation;
- side-effect method bisa terpanggil jika exposure tidak dibatasi.

Template harus menerima hasil business computation, bukan alat untuk melakukan business computation.

```text
Wrong:
Template -> Service -> Repository -> Database

Right:
Application Service -> Query/Domain -> ViewModel -> Template
```

---

## 9. Method Exposure: Tidak Semua Getter Aman

JavaBean getter sering dianggap harmless. Padahal getter bisa:

- melakukan lazy loading;
- menghitung mahal;
- membaca file/cache;
- memanggil remote service;
- membuka internal state;
- melempar exception;
- mengakses security context;
- membuat object graph makin luas.

Contoh:

```java
public class CaseViewDangerous {
    public List<AuditEntry> getAuditTrail() {
        return auditService.loadAuditTrail(caseId);
    }
}
```

Dari sisi template terlihat seperti property biasa:

```ftl
<#list case.auditTrail as entry>
  ${entry.message}
</#list>
```

Padahal ini mungkin query mahal atau service call.

Rule:

> Getter dalam ViewModel template harus cheap, deterministic, side-effect-free, dan safe.

Lebih aman:

```java
public record CaseNoticeView(
        String caseNo,
        String applicantName,
        List<String> reasonParagraphs
) {}
```

---

## 10. Map vs JavaBean: Dua Semantik yang Sering Tertukar

Dalam FreeMarker, `foo.bar` bisa berarti beberapa hal tergantung wrapper dan object:

- `Map.get("bar")`;
- `getBar()`;
- `isBar()`;
- method `bar()`;
- adapter behavior tertentu.

Contoh:

```java
Map<String, Object> user = new HashMap<>();
user.put("name", "Fajar");
user.put("class", "gold");
```

Template:

```ftl
${user.name}
${user.class}
```

Pada Map, kita ingin `class` berarti key `"class"`, bukan Java `getClass()`.

Karena itu, konfigurasi Map wrapping penting. Pada beberapa mode wrapper lama, method Map bisa tercampur dengan entry Map ketika menggunakan operasi tertentu.

Prinsip desain:

1. Untuk root model, `Map<String, Object>` wajar.
2. Untuk nested model kompleks, prefer immutable DTO/record/view object atau Map yang dibangun eksplisit.
3. Jangan campur data entries dan method-rich object tanpa alasan kuat.
4. Hindari key yang berpotensi ambigu seperti `class`, `hashCode`, `empty`, `size`, `values`, `keys`, kecuali sudah memahami wrapper behavior.

---

## 11. The `?api` Problem

FreeMarker memiliki fitur expert yang dapat memberi akses lebih dekat ke API object asli, tergantung konfigurasi. Fitur seperti ini berguna untuk kasus tertentu, tetapi berbahaya jika template tidak sepenuhnya trusted.

Masalahnya:

```ftl
${someObject?api.someJavaMethod()}
```

Jika API exposure dibuka, template author bisa keluar dari presentation contract dan mulai bergantung pada detail Java object.

Risiko:

- contract bocor;
- method internal terpanggil;
- compatibility rusak saat refactor;
- lebih sulit sandbox;
- data leakage;
- debugging sulit karena template bisa melakukan hal yang tidak terlihat dari ViewModel contract.

Rule production:

> Untuk kebanyakan sistem enterprise, `?api` tidak boleh menjadi bagian dari template authoring style.

Jika ada kebutuhan yang tampak membutuhkan `?api`, biasanya solusinya adalah:

- tambahkan field eksplisit di ViewModel;
- tambahkan helper method yang aman dan narrow;
- tambahkan custom method/directive dengan kontrak jelas;
- pindahkan logic ke Java presenter.

---

## 12. The `?new` and Class Resolution Problem

FreeMarker memiliki fitur yang dapat membuat instance class tertentu dari template melalui class resolver, tergantung konfigurasi. Ini adalah area security-sensitive.

Contoh konseptual yang **tidak boleh** diaktifkan untuk template tidak dipercaya:

```ftl
<#assign x = "some.ClassName"?new()>
```

Jika class resolution terlalu permissive, template bisa mengakses class yang tidak seharusnya. Dalam kasus konfigurasi buruk, risiko bisa menjadi serius, termasuk akses utility class berbahaya.

Pendekatan aman:

1. Jangan izinkan class resolution bebas untuk template non-trusted.
2. Gunakan resolver yang menolak semua atau allowlist sangat sempit.
3. Jangan expose utility object yang bisa menjalankan command, membaca file, membuka network, atau merefleksi runtime.
4. Validasi template saat publish.
5. Treat dynamic template editing sebagai fitur privileged.

Mental model:

```text
Template should render data.
Template should not instantiate arbitrary Java classes.
```

---

## 13. Static Method Exposure dan Utility Object

Kadang tim ingin membuat helper:

```java
model.put("dateUtils", DateUtils.class);
model.put("moneyUtils", MoneyUtils.class);
```

Atau expose object utility:

```java
model.put("formatter", formatterService);
```

Risikonya bergantung isi utility tersebut.

Utility yang aman biasanya:

- pure;
- stateless;
- deterministic;
- tidak baca database;
- tidak baca file;
- tidak akses network;
- tidak akses security context;
- tidak expose generic reflection;
- tidak expose arbitrary method invocation.

Contoh helper yang lebih aman:

```java
public final class TemplateFormatMethods {
    public TemplateMethodModelEx currency() { ... }
    public TemplateMethodModelEx date() { ... }
    public TemplateMethodModelEx maskIdentifier() { ... }
}
```

Namun lebih baik lagi, banyak formatting disiapkan di ViewModel jika format itu adalah bagian dari business/legal meaning.

Perbedaan penting:

```text
Formatting technical/simple:
  Can be template/helper-level.

Formatting with legal/business meaning:
  Prefer application/presenter-level.
```

Contoh:

- `1,234.50` sebagai number formatting boleh helper.
- “Outstanding Penalty Amount as of Notice Date” sebaiknya dihitung dan diformat oleh application layer karena punya makna legal.

---

## 14. Whitelist ViewModel Pattern

Pola paling aman untuk FreeMarker enterprise:

```text
Domain Entity / Query Result
      |
      v
Presenter / Mapper
      |
      v
Immutable ViewModel
      |
      v
Map root model
      |
      v
FreeMarker Template
```

Contoh:

```java
public record NoticeRecipientView(
        String displayName,
        String maskedIdentifier,
        String addressBlock
) {}

public record CaseDecisionNoticeView(
        String noticeNo,
        String caseNo,
        NoticeRecipientView recipient,
        String decisionLabel,
        List<String> reasons,
        String issuedDateLabel,
        boolean showAppealSection,
        String appealDeadlineLabel
) {}
```

Root model:

```java
Map<String, Object> model = Map.of(
        "notice", noticeView,
        "tenant", tenantBrandingView,
        "render", renderMetadataView
);
```

Template:

```ftl
<h1>${notice.decisionLabel}</h1>
<p>Case No: ${notice.caseNo}</p>
<p>Recipient: ${notice.recipient.displayName}</p>

<#list notice.reasons as reason>
  <p>${reason}</p>
</#list>

<#if notice.showAppealSection>
  <p>You may appeal by ${notice.appealDeadlineLabel}.</p>
</#if>
```

Kelebihan:

- template tidak tahu entity;
- template tidak tahu repository;
- template tidak tahu security context;
- field yang tersedia eksplisit;
- testing mudah;
- auditing mudah;
- versioning model bisa dilakukan;
- sensitive fields bisa disaring sebelum rendering.

---

## 15. Immutable ViewModel dan Java Version Considerations

Karena seri ini menarget Java 8–25, pilihan bentuk ViewModel berbeda menurut versi Java.

### 15.1 Java 8 Style

```java
public final class CaseNoticeView {
    private final String caseNo;
    private final String applicantName;
    private final List<String> reasons;

    public CaseNoticeView(String caseNo, String applicantName, List<String> reasons) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.applicantName = Objects.requireNonNull(applicantName);
        this.reasons = Collections.unmodifiableList(new ArrayList<>(reasons));
    }

    public String getCaseNo() {
        return caseNo;
    }

    public String getApplicantName() {
        return applicantName;
    }

    public List<String> getReasons() {
        return reasons;
    }
}
```

### 15.2 Java 16+ Record Style

```java
public record CaseNoticeView(
        String caseNo,
        String applicantName,
        List<String> reasons
) {
    public CaseNoticeView {
        Objects.requireNonNull(caseNo);
        Objects.requireNonNull(applicantName);
        reasons = List.copyOf(reasons);
    }
}
```

### 15.3 Practical Rule

- Java 8: final class + final fields + defensive copy.
- Java 11/17 LTS: same if records unavailable in target runtime.
- Java 16+: records are excellent for template ViewModel if wrapper supports property access as expected in your FreeMarker version/configuration.
- Java 21/25: records, sealed hierarchies, pattern matching in application layer can improve presenter design, but template should remain simple.

---

## 16. Null and Missing Exposure Policy

Object wrapping interacts with null behavior.

If Java method returns `null`, template may see missing/null-like behavior depending context.

Bad model:

```java
public String getApplicantName() {
    return applicantName; // maybe null
}
```

Template becomes defensive everywhere:

```ftl
${case.applicantName!"-"}
```

Better:

```java
public record CaseNoticeView(
        String applicantNameLabel
) {}
```

Where Java guarantees:

```java
String applicantNameLabel = applicantName == null ? "-" : applicantName;
```

Policy options:

| Policy | Meaning | Use Case |
|---|---|---|
| Fail-fast missing | Missing required field breaks render | Legal document, critical correspondence |
| Default in template | Template decides fallback | Simple optional display |
| Pre-normalized ViewModel | Java presenter supplies label/default | Enterprise/regulatory output |
| Optional section flag | Java supplies `showX` boolean | Conditional blocks with business meaning |

Top 1% rule:

> Missing required business data should fail before rendering, not silently become blank output.

---

## 17. Authorization Must Happen Before Rendering

Template can hide/show based on flags:

```ftl
<#if permission.showInternalComment>
  <p>${case.internalComment}</p>
</#if>
```

But the real security boundary should be earlier.

Better:

```java
public record CasePageView(
        String caseNo,
        Optional<String> internalComment,
        boolean showInternalComment
) {}
```

Even better for high-sensitivity data:

```java
public record CasePageView(
        String caseNo,
        InternalCommentSection internalCommentSection
) {}

public sealed interface InternalCommentSection permits Hidden, Visible {}
public record Hidden() implements InternalCommentSection {}
public record Visible(String text) implements InternalCommentSection {}
```

Or simply do not include the field when unauthorized.

Important principle:

> UI conditional rendering is not authorization. It is presentation of an authorization result.

The template should not decide whether the user is authorized. The application should decide and pass safe output state.

---

## 18. Field-Level Redaction Before Wrapping

Sensitive data should be redacted before template engine sees it.

Bad:

```java
model.put("nric", rawNric);
```

Template:

```ftl
${nric?substring(0, 1)}****${nric?substring(5)}
```

Better:

```java
model.put("maskedIdentifier", identifierMasker.mask(rawNric));
```

Template:

```ftl
${maskedIdentifier}
```

Why?

1. Raw sensitive data is not present in template runtime.
2. Template error logs cannot accidentally include raw value.
3. Future template editor cannot print raw value.
4. Redaction logic is centrally tested.
5. Audit/compliance is easier.

Rule:

> Never pass raw PII/secrets to template unless the output explicitly and lawfully requires the raw value.

If raw value is required, isolate template, log redaction, approval, and audit carefully.

---

## 19. Wrapper Configuration: Baseline Production Setup

A basic modern FreeMarker setup:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setDefaultEncoding("UTF-8");
cfg.setLocalizedLookup(false);

DefaultObjectWrapperBuilder owb =
        new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34);

cfg.setObjectWrapper(owb.build());
```

But for enterprise-grade setup, also consider:

```java
cfg.setAPIBuiltinEnabled(false);
cfg.setNewBuiltinClassResolver(TemplateClassResolver.ALLOWS_NOTHING_RESOLVER);
```

Depending on your FreeMarker version/configuration APIs, exact method availability and names must be checked against your dependency version.

The intent is:

```text
- Disable direct API escape hatch unless explicitly needed.
- Disable arbitrary class construction from templates.
- Use explicit ViewModel/helper/directive instead of broad Java access.
```

A safer architecture does not rely only on FreeMarker switches. It also uses:

1. controlled template source;
2. immutable ViewModel;
3. minimal root model;
4. no entity/service exposure;
5. static validation;
6. template review workflow;
7. render-time monitoring;
8. safe error handling.

---

## 20. Trusted Template Configuration vs Dynamic Template Configuration

### 20.1 Trusted Developer Template Setup

For templates in source control:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setClassLoaderForTemplateLoading(classLoader, "/templates");
cfg.setDefaultEncoding("UTF-8");
cfg.setObjectWrapper(new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34).build());
cfg.setAPIBuiltinEnabled(false);
cfg.setNewBuiltinClassResolver(TemplateClassResolver.ALLOWS_NOTHING_RESOLVER);
```

Policy:

- templates reviewed through code review;
- model contract tested;
- no `?api` usage;
- no `?new` usage;
- no entities/services in model;
- macros versioned in repository.

---

### 20.2 Semi-Trusted Business Template Setup

For database/CMS-backed templates:

```text
Additional controls:

- strict allowlist of directives/built-ins if possible;
- no arbitrary class resolver;
- no API builtin;
- no raw Java object graph;
- only Map/DTO with scalar/list/hash values;
- template length limit;
- render timeout at orchestration layer;
- preview before publish;
- approval workflow;
- template linting;
- immutable published version;
- audit trail for author/editor/approver;
- sample data contract validation;
- limited macro library.
```

Do not treat internal business users as equivalent to application developers. They may not intend harm, but mistakes in template language can still create serious incidents.

---

### 20.3 Untrusted Template Setup

If template author is untrusted:

```text
Default recommendation: avoid.
```

If unavoidable:

- isolate rendering service;
- run with constrained permissions/container;
- deny class resolution;
- deny API built-in;
- allowlist data only;
- no JavaBean rich object exposure;
- enforce CPU/time/output size limit externally;
- pre-parse and lint;
- no access to secrets/env/system properties;
- monitor abuse;
- security review before launch.

Important: FreeMarker is powerful. Power is useful for trusted application rendering, but risky as user-facing scripting.

---

## 21. Custom Object Wrapper: When and Why?

Most teams should not start with custom object wrapper. But it becomes relevant when you need strict exposure control.

Use cases:

1. Hide specific methods/properties globally.
2. Expose only annotated properties.
3. Treat records/DTOs in a custom way.
4. Prevent method invocation while allowing property access.
5. Normalize Map behavior.
6. Wrap domain types into safe template models.
7. Enforce organization-wide template policy.

Conceptual pattern:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface TemplateVisible {}
```

```java
public final class UserView {
    private final String displayName;
    private final String internalEmail;

    @TemplateVisible
    public String getDisplayName() {
        return displayName;
    }

    public String getInternalEmail() {
        return internalEmail;
    }
}
```

Then wrapper exposes only `@TemplateVisible` methods.

However, writing a correct wrapper is non-trivial. You must understand FreeMarker internals, caching, method resolution, overloaded methods, collections, null behavior, and performance.

Safer alternative:

> Build explicit Map/record ViewModel and do not expose unsafe object types in the first place.

---

## 22. Annotation-Based Exposure: Benefits and Risks

Annotation-based exposure can be attractive:

```java
@TemplateModel
public record NoticeView(
    @TemplateField String caseNo,
    @TemplateField String recipientName
) {}
```

Benefits:

- contract is visible in code;
- unsafe fields can be omitted;
- tooling can generate documentation;
- template model can be linted.

Risks:

- custom reflection complexity;
- framework upgrades may break assumptions;
- nested object exposure still tricky;
- developers may over-annotate;
- annotation becomes security-critical;
- testing burden increases.

Prefer annotation exposure when you have many templates and strong platform governance. For smaller systems, explicit ViewModel classes and tests are enough.

---

## 23. Template Helpers: Safe Alternative to Broad Object Exposure

Instead of exposing many methods on domain objects, expose narrow helpers.

Example helper method:

```java
public final class MaskIdentifierMethod implements TemplateMethodModelEx {
    @Override
    public Object exec(List arguments) throws TemplateModelException {
        if (arguments.size() != 1) {
            throw new TemplateModelException("maskIdentifier expects one argument");
        }
        String value = arguments.get(0).toString();
        return mask(value);
    }
}
```

Registered as:

```java
cfg.setSharedVariable("maskIdentifier", new MaskIdentifierMethod());
```

Template:

```ftl
${maskIdentifier(applicant.identifier)}
```

But be careful: if `applicant.identifier` is raw PII, raw PII still reached template. Often better:

```ftl
${applicant.maskedIdentifier}
```

Use helper for generic presentation utility, not sensitive business policy.

Safe helper properties:

- narrow input/output;
- no side effects;
- no service locator;
- no reflection;
- no file/network access;
- deterministic;
- throws clear errors;
- tested independently.

---

## 24. Object Graph Explosion

Even if each object seems safe, nested graph can become unsafe.

Example:

```java
model.put("case", caseView);
```

Where:

```java
caseView.getApplicant().getCompany().getDirectors().get(0).getAddress().getCountry().get...
```

Template may grow into:

```ftl
${case.applicant.company.directors[0].address.country.name}
```

Problems:

1. Template knows too much about structure.
2. Output breaks if graph shape changes.
3. Null handling becomes painful.
4. Authorization becomes hard.
5. Testing matrix grows.
6. Accidental data leakage increases.

Prefer flattened or purpose-specific models:

```java
public record NoticeRecipientView(
        String name,
        String companyName,
        String addressBlock
) {}
```

Then template:

```ftl
${recipient.name}
${recipient.companyName}
${recipient.addressBlock}
```

Rule:

> Template graph depth should be shallow unless there is a strong component model reason.

Practical guideline:

```text
Depth 1–2: ideal
Depth 3: acceptable with clear ViewModel
Depth 4+: suspicious
```

---

## 25. Template as Boundary, Not Object Browser

A common anti-pattern is treating template as an object browser:

```ftl
${case.application.customer.account.profile.address...}
```

This says the template is discovering data, not rendering a prepared contract.

Correct architecture:

```text
Template should not discover what to render.
Java presenter should decide what to render.
Template should only arrange and escape it.
```

This is especially important in regulatory/case-management systems:

- letters must be reproducible;
- fields must have legal meaning;
- missing data must be caught early;
- data exposure must be auditable;
- template version and data snapshot must be recorded.

---

## 26. Designing a Safe Root Model

A good root model is small and structured.

Example:

```java
Map<String, Object> root = Map.of(
        "document", document,
        "recipient", recipient,
        "case", caseSummary,
        "issuer", issuer,
        "branding", branding,
        "render", renderMetadata
);
```

Avoid dumping dozens of unrelated root variables:

```java
model.put("caseNo", ...);
model.put("applicantName", ...);
model.put("officerName", ...);
model.put("address1", ...);
model.put("address2", ...);
model.put("address3", ...);
model.put("tenantLogo", ...);
model.put("showAppeal", ...);
model.put("appealDeadline", ...);
// 80 more keys...
```

Why structured root is better:

1. Template is readable.
2. Namespace collision is reduced.
3. Contract documentation is clearer.
4. Versioning is easier.
5. Validation is easier.
6. Different template families can share components.

Example template:

```ftl
<h1>${document.title}</h1>
<p>Case No: ${case.caseNo}</p>
<p>Recipient: ${recipient.displayName}</p>
<p>Issued by: ${issuer.displayName}</p>
```

---

## 27. Model Versioning and Type Exposure

Once templates are stored or versioned, model compatibility becomes critical.

Suppose template v1 uses:

```ftl
${case.caseNo}
${case.statusLabel}
```

Template v2 uses:

```ftl
${case.referenceNo}
${case.status.displayLabel}
```

If Java model changes without versioning, old templates break.

A robust system defines:

```text
Template ID: CASE_DECISION_NOTICE
Template Version: 3
Model Schema Version: 2
Renderer Adapter: freemarker-html-v1
```

Then Java can choose the correct ViewModel shape:

```java
switch (template.modelSchemaVersion()) {
    case 1 -> buildCaseNoticeModelV1(caseId);
    case 2 -> buildCaseNoticeModelV2(caseId);
    default -> throw unsupportedSchema(...);
}
```

This is not overengineering for regulated systems. It is what makes old generated documents explainable later.

---

## 28. Runtime Introspection Risk

When object exposure is too broad, template authors may discover capabilities by trying expressions.

Examples of dangerous curiosity:

```ftl
${user?keys}
${case?api}
${object.class.name}
${object.getClass().getName()}
```

Even if these exact expressions are blocked by configuration, the design principle stands:

> Do not let templates inspect runtime internals.

Data model should be documented externally, not discovered through introspection.

Useful governance:

- publish template model docs;
- provide sample JSON-like model;
- provide preview tool;
- validate template fields;
- reject forbidden built-ins/directives;
- keep object graph shallow.

---

## 29. Template Injection: Boundary Between Data and Template

A classic bug:

```java
String templateText = "Hello " + userInput;
Template template = new Template("dynamic", templateText, cfg);
```

If `userInput` contains:

```ftl
${secret}
```

It becomes executable template syntax.

Correct approach:

```ftl
Hello ${userInput}
```

And Java:

```java
model.put("userInput", userInput);
```

Then user input is data, not template code.

Rule:

```text
Never concatenate untrusted input into template source.
Pass untrusted input as data model value.
```

If business users can edit template body, that is no longer “input”; it is executable template code and must be governed accordingly.

---

## 30. Data Leakage Through Error Messages

Template errors can leak data if not handled carefully.

Example:

```ftl
${applicant.rawIdentifier?substring(0, 4)}
```

If substring fails, logs might include expression context. If model object `toString()` includes sensitive fields, error logs can leak.

Controls:

1. Do not pass raw sensitive values unnecessarily.
2. Avoid `toString()` on sensitive model classes.
3. Use safe exception handler in production.
4. Log template name/version/line, not full data model.
5. Redact render context in structured logs.
6. Use correlation IDs for debugging.
7. Provide safe preview error messages.

Bad:

```java
log.error("Template failed with model {}", model, ex);
```

Better:

```java
log.error("Template render failed templateId={} version={} correlationId={} errorType={}",
        templateId,
        version,
        correlationId,
        classify(ex),
        ex);
```

---

## 31. Resource Exhaustion and Object Exposure

Even without RCE, a template can be harmful if it causes excessive work.

Examples:

```ftl
<#list hugeList as item>
  ${item.deep.expensive.property}
</#list>
```

Or recursive macros:

```ftl
<#macro recurse n>
  <@recurse n=n+1 />
</#macro>
<@recurse n=0 />
```

Object exposure can amplify this if properties call expensive Java code.

Controls:

- do not expose huge collections unless paginated/chunked;
- pre-limit data in application layer;
- do not expose lazy query objects;
- set output size limits at service level;
- use job timeout at orchestration layer;
- validate templates for recursion/forbidden constructs if business-editable;
- measure render latency and output size;
- isolate batch rendering from request threads if heavy.

---

## 32. Safe Model Construction Pipeline

A production renderer should not directly accept arbitrary Map from random caller.

Better pipeline:

```text
Domain Input
  -> Authorization
  -> Query/Load Data
  -> Presenter Mapping
  -> Model Validation
  -> Template Selection
  -> Render Policy Check
  -> FreeMarker Render
  -> Output Validation/Audit
```

Example Java structure:

```java
public interface TemplateModelBuilder<I, M> {
    M build(I input, RenderPrincipal principal, Locale locale, ZoneId zoneId);
}

public interface TemplateModelValidator<M> {
    void validate(M model) throws InvalidRenderModelException;
}

public interface TemplateRenderer<M> {
    RenderedOutput render(TemplateRef template, M model, RenderContext context);
}
```

This makes wrapping/exposure a controlled step, not an accidental by-product of `Map.put`.

---

## 33. FreeMarker Data Model Documentation

For each template family, document model contract.

Example:

```markdown
# Template Model: CASE_DECISION_NOTICE v2

## Root

- `document`: DocumentView
- `recipient`: RecipientView
- `case`: CaseSummaryView
- `decision`: DecisionView
- `branding`: BrandingView
- `render`: RenderMetadataView

## `case`

| Field | Type | Required | Description |
|---|---|---:|---|
| `caseNo` | string | yes | Public case reference number |
| `submissionDateLabel` | string | yes | Date formatted for recipient locale |
| `subjectLabel` | string | yes | Public subject line |

## Forbidden

- No raw NRIC/passport number.
- No internal memo.
- No officer internal email unless explicitly approved.
- No entity/repository/service objects.
```

This is a governance artifact. It helps developers, QA, business reviewers, and security reviewers.

---

## 34. Secure Rendering Checklist

Before approving a FreeMarker template system, ask:

### Data Model

- Are entities excluded?
- Are services/repositories excluded?
- Is the root model small and documented?
- Are sensitive fields redacted before rendering?
- Are optional fields explicit?
- Are required fields validated before render?
- Are collections bounded?
- Is graph depth reasonable?

### Wrapper/Configuration

- Is modern `DefaultObjectWrapper` used?
- Is `incompatibleImprovements` set intentionally?
- Is `?api` disabled unless explicitly justified?
- Is `?new`/class resolver locked down?
- Are unsafe shared variables absent?
- Are custom helpers narrow and pure?

### Template Source

- Are templates source-controlled or governed?
- If editable at runtime, is there approval workflow?
- Is template author trust level defined?
- Is template version immutable after publish?
- Are forbidden constructs linted?

### Security

- Is escaping configured correctly?
- Are raw HTML outputs reviewed?
- Is user input passed as data, not template source?
- Are logs redacted?
- Are render errors safe?
- Is output audited if legally relevant?

### Operations

- Are render failures classified?
- Are render latency and output size measured?
- Are template/version/correlation IDs logged?
- Is rollback possible?
- Is preview available?
- Are old templates reproducible?

---

## 35. Common Anti-Patterns

### Anti-Pattern 1 — Expose Entity Directly

```java
model.put("case", caseEntity);
```

Why bad:

- data leakage;
- lazy loading;
- template fragility;
- authorization risk;
- business logic leakage.

Fix:

```java
model.put("case", caseNoticeView);
```

---

### Anti-Pattern 2 — Expose Service to Template

```java
model.put("caseService", caseService);
```

Why bad:

- template becomes execution layer;
- query/business logic hidden in view;
- side effects possible;
- performance unpredictable.

Fix:

```java
model.put("case", presenter.buildCaseView(caseId));
```

---

### Anti-Pattern 3 — Use `?api` as Convenience

```ftl
${user?api.getInternalProfile().getSecret()}
```

Why bad:

- bypasses presentation contract;
- security risk;
- refactor fragile.

Fix:

```ftl
${user.publicProfileLabel}
```

---

### Anti-Pattern 4 — Build Template from User Input

```java
String source = "Dear " + request.getParameter("name");
```

Why bad:

- turns user input into executable template code.

Fix:

```ftl
Dear ${name}
```

```java
model.put("name", request.getParameter("name"));
```

---

### Anti-Pattern 5 — Raw Sensitive Values in Model

```java
model.put("nric", applicant.getNric());
```

Why bad:

- template can accidentally print it;
- logs/error can leak it;
- future template changes risky.

Fix:

```java
model.put("maskedIdentifier", identifierMasker.mask(applicant.getNric()));
```

---

## 36. Practical Example: Unsafe to Safe Refactor

### 36.1 Initial Unsafe Code

```java
public String renderNotice(Long caseId) {
    EnforcementCase caze = caseRepository.findById(caseId).orElseThrow();

    Map<String, Object> model = new HashMap<>();
    model.put("case", caze);
    model.put("userService", userService);
    model.put("security", SecurityContextHolder.getContext());

    return freemarker.render("notice.ftl", model);
}
```

Template:

```ftl
<h1>Notice for ${case.caseNo}</h1>
<p>${case.applicant.name}</p>
<p>${case.internalMemo}</p>
<p>${userService.findOfficer(case.officerId).email}</p>
```

Problems:

- entity exposed;
- internal memo exposed;
- service exposed;
- security context exposed;
- template performs lookup;
- authorization unclear;
- likely transaction/lazy loading issue.

---

### 36.2 Safer Presenter

```java
public final class CaseNoticePresenter {
    private final CaseQueryService caseQueryService;
    private final IdentifierMasker identifierMasker;
    private final DateTimeFormatterFactory dateTimeFormatterFactory;

    public CaseDecisionNoticeView build(Long caseId, RenderPrincipal principal, Locale locale, ZoneId zoneId) {
        CaseNoticeProjection projection = caseQueryService.loadNoticeProjection(caseId, principal);

        DateTimeFormatter dateFormatter = dateTimeFormatterFactory.dateFormatter(locale, zoneId);

        return new CaseDecisionNoticeView(
                projection.noticeNo(),
                projection.caseNo(),
                new NoticeRecipientView(
                        projection.applicantName(),
                        identifierMasker.mask(projection.applicantIdentifier()),
                        projection.addressBlock()
                ),
                projection.decisionLabel(),
                List.copyOf(projection.reasonParagraphs()),
                dateFormatter.format(projection.issuedAt()),
                projection.appealAllowed(),
                projection.appealDeadline() == null
                        ? null
                        : dateFormatter.format(projection.appealDeadline())
        );
    }
}
```

ViewModel:

```java
public record NoticeRecipientView(
        String displayName,
        String maskedIdentifier,
        String addressBlock
) {}

public record CaseDecisionNoticeView(
        String noticeNo,
        String caseNo,
        NoticeRecipientView recipient,
        String decisionLabel,
        List<String> reasons,
        String issuedDateLabel,
        boolean showAppealSection,
        String appealDeadlineLabel
) {
    public CaseDecisionNoticeView {
        Objects.requireNonNull(noticeNo);
        Objects.requireNonNull(caseNo);
        Objects.requireNonNull(recipient);
        Objects.requireNonNull(decisionLabel);
        reasons = List.copyOf(reasons);
        Objects.requireNonNull(issuedDateLabel);
        if (showAppealSection && appealDeadlineLabel == null) {
            throw new IllegalArgumentException("appealDeadlineLabel required when appeal section is shown");
        }
    }
}
```

Renderer:

```java
public String renderNotice(Long caseId, RenderPrincipal principal, Locale locale, ZoneId zoneId) {
    CaseDecisionNoticeView notice = presenter.build(caseId, principal, locale, zoneId);

    Map<String, Object> model = Map.of(
            "notice", notice,
            "render", new RenderMetadataView(
                    UUID.randomUUID().toString(),
                    Instant.now().toString(),
                    "CASE_DECISION_NOTICE",
                    "v3"
            )
    );

    return freemarker.render("case-decision-notice-v3.ftl", model);
}
```

Template:

```ftl
<h1>${notice.decisionLabel}</h1>

<p>Notice No: ${notice.noticeNo}</p>
<p>Case No: ${notice.caseNo}</p>
<p>Issued Date: ${notice.issuedDateLabel}</p>

<h2>Recipient</h2>
<p>${notice.recipient.displayName}</p>
<p>${notice.recipient.maskedIdentifier}</p>
<p>${notice.recipient.addressBlock}</p>

<h2>Reasons</h2>
<#list notice.reasons as reason>
  <p>${reason}</p>
</#list>

<#if notice.showAppealSection>
  <h2>Appeal</h2>
  <p>You may appeal by ${notice.appealDeadlineLabel}.</p>
</#if>
```

Now:

- no entity in template;
- no service in template;
- sensitive ID masked before render;
- required fields validated;
- model is stable;
- template is simple;
- output is reproducible.

---

## 37. Enterprise Rendering Boundary Diagram

```text
                       ┌──────────────────────────┐
                       │      Template Author      │
                       │ Dev / Admin / Business    │
                       └─────────────┬────────────┘
                                     │
                                     v
                       ┌──────────────────────────┐
                       │   Template Repository     │
                       │ id, version, status, hash │
                       └─────────────┬────────────┘
                                     │
                                     v
┌──────────────┐     ┌──────────────────────────┐     ┌────────────────────┐
│ Domain / DB  │ --> │ Presenter / Model Builder │ --> │ Safe ViewModel      │
└──────────────┘     └──────────────────────────┘     └─────────┬──────────┘
                                                               │
                                                               v
                                                    ┌──────────────────────┐
                                                    │ FreeMarker Wrapper    │
                                                    │ controlled exposure   │
                                                    └─────────┬────────────┘
                                                              │
                                                              v
                                                    ┌──────────────────────┐
                                                    │ Template Evaluation   │
                                                    │ FTL expressions       │
                                                    └─────────┬────────────┘
                                                              │
                                                              v
                                                    ┌──────────────────────┐
                                                    │ Rendered Output       │
                                                    │ HTML/Text/XML/etc.    │
                                                    └─────────┬────────────┘
                                                              │
                                                              v
                                                    ┌──────────────────────┐
                                                    │ Audit / Delivery      │
                                                    └──────────────────────┘
```

---

## 38. Decision Framework

### 38.1 If Templates Are Source-Controlled

Use:

- `DefaultObjectWrapper` modern version;
- immutable ViewModel;
- no service/entity exposure;
- `?api` disabled;
- class resolver locked down;
- code review;
- template contract tests.

This is enough for many systems.

---

### 38.2 If Templates Are Editable by Internal Admins

Add:

- template approval workflow;
- model schema docs;
- preview with sample data;
- forbidden construct linting;
- output size limit;
- safe error messages;
- template version immutability;
- strict helper allowlist;
- stronger runtime isolation for high-risk outputs.

---

### 38.3 If Templates Are User-Supplied

Question the requirement first.

If unavoidable:

- isolate rendering process/service;
- deny arbitrary class access;
- deny API escape;
- minimal scalar/hash/list data only;
- no JavaBean rich object exposure;
- resource limits;
- strict allowlist;
- security testing;
- audit;
- assume malicious template author.

---

## 39. Review Questions

Use these questions to test understanding:

1. What is the difference between Java object and `TemplateModel`?
2. Why is object wrapper a security boundary?
3. Why should template data model be treated as API?
4. What can go wrong if a JPA entity is exposed to FreeMarker?
5. Why is exposing service/repository worse than exposing DTO?
6. What is the risk of `?api`?
7. What is the risk of class resolution/`?new`?
8. Why should raw PII be redacted before rendering?
9. How would you support business-editable templates safely?
10. How would you design ViewModel versioning for long-lived document templates?

---

## 40. Practical Exercises

### Exercise 1 — Refactor Entity-Based Template Model

Given:

```java
model.put("order", orderEntity);
```

Template:

```ftl
${order.customer.name}
${order.customer.email}
${order.payment.cardNumber}
${order.internalRiskScore}
```

Task:

1. Identify every leakage risk.
2. Design `OrderReceiptView`.
3. Decide which fields are masked.
4. Rewrite template using safe ViewModel.
5. Define validation rules.

---

### Exercise 2 — Classify Template Author Trust

For each case, classify trust level and controls:

1. Email template committed in Git by backend developer.
2. Letter template edited by agency admin in web UI.
3. Tenant-specific marketing email edited by tenant user.
4. User-generated “profile template” rendered by application.
5. Internal report template maintained by operation team.

---

### Exercise 3 — Build Model Contract Documentation

Pick one template from your system and document:

- template ID;
- template version;
- root fields;
- nested fields;
- required/optional status;
- sensitive data classification;
- forbidden fields;
- model schema version;
- sample model.

---

### Exercise 4 — Create a Safe Helper Policy

Design policy for template helper methods:

- allowed helper categories;
- forbidden helper categories;
- review process;
- testing requirements;
- naming convention;
- versioning.

---

## 41. Key Takeaways

1. FreeMarker templates do not see Java object directly; they see wrapped `TemplateModel` representations.
2. `ObjectWrapper` is not a minor configuration detail. It is a security, semantic, and compatibility boundary.
3. `BeansWrapper`/`DefaultObjectWrapper` can expose JavaBean properties and methods, so model design matters.
4. Exposing entity, service, repository, security context, or arbitrary utility object to template is dangerous.
5. Template data model should be treated as an explicit API contract.
6. Sensitive data should be redacted before rendering, not inside template.
7. `?api`, `?new`, class resolution, static method exposure, and broad utility objects require strict governance.
8. Template author trust level determines required controls.
9. Production systems should prefer immutable, shallow, purpose-specific ViewModel objects.
10. A robust rendering system validates model, locks down wrapper behavior, logs safely, and audits template versions.

---

## 42. Part 7 Summary

Bagian ini membahas fondasi keamanan dan desain data exposure di FreeMarker. Kita melihat bahwa rendering bukan hanya proses mengganti placeholder dengan nilai, tetapi proses mengevaluasi template terhadap representasi object Java yang dibentuk oleh wrapper.

Kesalahan paling umum adalah memberi template terlalu banyak: entity, service, repository, security context, raw PII, atau object graph besar. Kesalahan ini membuat template berubah dari presentation layer menjadi object browser atau execution layer.

Desain yang lebih kuat adalah memperlakukan template model sebagai API: eksplisit, minimal, aman, stabil, tervalidasi, dan sesuai versi. Dengan model seperti ini, FreeMarker bisa menjadi engine rendering enterprise yang kuat tanpa membuka runtime Java terlalu luas.

---

## 43. Status Seri

```text
Part 7 selesai.
Seri belum selesai.
Berikutnya: Part 8 — FreeMarker Output Formats, Auto-Escaping, XSS Defense, and HTML Safety.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-006.md">⬅️ Part 6 — FreeMarker Macros, Functions, Custom Directives, and Reusable Template APIs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-008.md">Part 8 — FreeMarker Output Formats, Auto-Escaping, XSS Defense, and HTML Safety ➡️</a>
</div>
