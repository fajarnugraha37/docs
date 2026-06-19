# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-004

# Part 4 — FreeMarker Template Language Deep Dive I: Values, Expressions, Interpolation

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: `004 / 034`  
> Topik: FreeMarker Template Language, values, expressions, interpolation, operators, built-ins dasar, JavaBean access, null/missing handling, dan batas logic template  
> Target: Java 8–25, FreeMarker 2.3.x, aplikasi Spring/Jakarta/non-web rendering

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 3 kita sudah membahas arsitektur dasar FreeMarker: `Configuration`, `TemplateLoader`, template cache, `ObjectWrapper`, `TemplateModel`, output format, dan thread-safety.

Part 4 masuk ke sisi bahasa template: **FTL — FreeMarker Template Language**.

Namun tujuan bagian ini bukan hanya membuat Anda bisa menulis:

```ftl
Hello ${user.name}
```

Target yang lebih penting adalah memahami:

1. bagaimana FreeMarker melihat nilai;
2. bagaimana expression dievaluasi;
3. bagaimana data Java berubah menjadi tipe FTL;
4. kapan missing value harus dianggap bug;
5. kapan default value boleh dipakai;
6. bagaimana built-in digunakan tanpa membuat template menjadi business logic;
7. kapan logic harus dipindahkan ke Java;
8. bagaimana menjaga template tetap aman, deterministic, readable, dan maintainable.

Dalam sistem enterprise, bug template sering terlihat sederhana tetapi dampaknya serius:

- email regulatory salah nama penerima;
- angka denda diformat salah;
- tanggal berlaku tidak sesuai timezone;
- button approval muncul ke user yang tidak berhak;
- field rahasia bocor ke HTML hidden input;
- PDF legal gagal render karena satu variable kosong;
- batch notification gagal ribuan record karena satu template terlalu optimistis terhadap data.

Karena itu, expression language bukan kosmetik. Ia adalah **contract execution layer** antara model Java dan output final.

---

## 1. Mental Model Utama: FTL Bukan Java, Bukan JavaScript, Bukan HTML

FreeMarker mendefinisikan template sebagai file berisi text biasa plus bagian dinamis yang ditulis memakai FTL. FTL adalah bahasa khusus untuk template, bukan bahasa pemrograman umum seperti Java. Aplikasi Java tetap bertanggung jawab menyiapkan data, melakukan query, menghitung aturan bisnis, dan memilih template. Template bertanggung jawab melakukan transformasi presentasi dari model yang sudah disiapkan menjadi output teks.

Mental model yang benar:

```text
Java application
  - load data
  - enforce authorization
  - run business rules
  - choose template
  - build view model
  - choose locale/timezone/output format
        |
        v
FreeMarker template
  - read values
  - branch for presentation shape
  - loop display collections
  - format simple output
  - compose reusable macro fragments
        |
        v
Rendered text output
  - HTML
  - email
  - XML
  - text
  - config
  - source code
  - pre-PDF HTML
```

FTL expression harus dilihat sebagai **presentation expression**, bukan business expression.

Contoh yang wajar:

```ftl
${applicant.fullName}
${caseReference}
${amount?string.currency}
${submittedAt?string.medium}
```

Contoh yang mencurigakan:

```ftl
${basePenalty + (lateDays * dailyPenalty) - discretionaryReduction}
```

Contoh yang seharusnya hampir pasti tidak ada di template:

```ftl
<#if case.status == "PENDING_REVIEW" && officer.grade >= 7 && applicant.riskScore > 80 && !case.hasOpenAppeal>
  Escalate
</#if>
```

Kenapa?

Karena expression itu bukan lagi presentasi. Itu policy decision. Policy decision harus berada di Java/domain/service layer, lalu template cukup menerima field seperti:

```java
boolean showEscalationWarning;
String escalationReasonLabel;
```

Lalu template:

```ftl
<#if showEscalationWarning>
  <p class="warning">${escalationReasonLabel}</p>
</#if>
```

Top 1% engineer tidak hanya bertanya “bisa atau tidak ditulis di FTL?”. Pertanyaan yang lebih baik:

> Apakah expression ini masih sekadar membentuk output, atau sudah mengambil keputusan domain?

---

## 2. Nilai dan Tipe di FreeMarker

FTL bekerja dengan **value**. Setiap value memiliki tipe. Value bisa datang dari:

1. data model Java;
2. variable yang dibuat di template;
3. literal expression;
4. hasil function/method;
5. built-in transformation.

Tipe utama yang perlu dikuasai:

| Tipe FTL | Makna | Contoh |
|---|---|---|
| string | teks | `"Fajar"` |
| number | angka | `42`, `12.5` |
| boolean | benar/salah | `true`, `false` |
| date/time/datetime | tanggal/waktu | dari Java `Date`, `LocalDate`, dll melalui wrapper/support |
| sequence | list berurutan | `users`, `items` |
| hash | map/object property | `user.name`, `case["id"]` |
| collection | iterable | hasil tertentu dari Java collection |
| method/function | callable value | Java method atau FTL function |
| markup output | output yang sudah membawa format markup | hasil escaping/output format tertentu |
| missing | value tidak ada | bukan null normal; biasanya error jika dipakai langsung |

### 2.1. Data Model Root Adalah Hash

Dalam FreeMarker, root data model umumnya dilihat sebagai hash. Hash berarti struktur key-value yang bisa diakses oleh nama.

Java:

```java
Map<String, Object> model = new HashMap<>();
model.put("user", new UserView("Fajar", "Lead Engineer"));
model.put("unreadCount", 12);
```

Template:

```ftl
Hello ${user.name}
You have ${unreadCount} unread messages.
```

Secara mental:

```text
root hash
  user -> hash-like/object-like value
    name -> "Fajar"
    title -> "Lead Engineer"
  unreadCount -> 12
```

Template tidak tahu bahwa `user` berasal dari POJO, Map, record, DTO, atau custom `TemplateModel`. Ia hanya tahu bahwa ada value bernama `user` yang bisa dibaca dengan property `name`.

### 2.2. FTL Type Tidak Sama Persis Dengan Java Type

Java punya:

- `String`
- `Integer`
- `Long`
- `BigDecimal`
- `Boolean`
- `List<T>`
- `Map<K,V>`
- POJO
- record
- enum
- `LocalDate`
- `OffsetDateTime`
- `Optional<T>`

FTL melihat itu melalui `ObjectWrapper`. Maka “apa yang bisa dilakukan template” bergantung pada wrapper.

Contoh:

```java
class UserView {
    private final String name;

    public String getName() {
        return name;
    }
}
```

Template:

```ftl
${user.name}
```

FTL tidak membaca field `name` secara langsung. Biasanya ia melihat JavaBean getter `getName()` sebagai property `name`.

Konsekuensi:

- desain DTO memengaruhi template API;
- rename getter adalah breaking change untuk template;
- expose entity langsung berarti expose banyak property/method yang mungkin tidak dimaksudkan;
- Map dan POJO bisa terlihat mirip di template, tetapi perilaku edge-case bisa berbeda.

---

## 3. Literal Values

Literal adalah value yang ditulis langsung di template.

### 3.1. String Literal

```ftl
${"Hello"}
${'Hello'}
```

Keduanya valid.

Escape umum:

```ftl
${"He said: \"Hello\""}
${'It\'s fine'}
${"Line 1\nLine 2"}
```

Untuk output text langsung, biasanya tidak perlu interpolation:

```ftl
Hello world
```

Gunakan string literal ketika sedang membangun expression:

```ftl
${"CASE-" + caseNo}
```

Tetapi untuk template yang readable, lebih baik:

```ftl
CASE-${caseNo}
```

### 3.2. Number Literal

```ftl
${10}
${10.5}
${-3}
```

Angka di template harus digunakan untuk presentasi sederhana, bukan kalkulasi domain berat.

Wajar:

```ftl
Showing ${page.number + 1} of ${page.totalPages}
```

Meragukan:

```ftl
${principal * annualRate / 365 * overdueDays}
```

Lebih baik Java menghitung:

```java
view.setAccruedInterestLabel(formatMoney(accruedInterest));
```

atau:

```java
view.setAccruedInterest(accruedInterest);
```

lalu template hanya format:

```ftl
${accruedInterest?string.currency}
```

### 3.3. Boolean Literal

```ftl
${true?string("yes", "no")}
${false?string("yes", "no")}
```

Boolean sering dipakai di `#if`:

```ftl
<#if user.active>
  Active
</#if>
```

Rule penting:

> Boolean di template idealnya adalah hasil keputusan Java, bukan hasil evaluasi policy kompleks di template.

### 3.4. Sequence Literal

FreeMarker mendukung sequence literal:

```ftl
<#list ["LOW", "MEDIUM", "HIGH"] as level>
  ${level}
</#list>
```

Berguna untuk presentasi kecil, tetapi jangan menjadi source of truth domain.

Jangan:

```ftl
<#assign allowedStatuses = ["APPROVED", "REJECTED", "PENDING_REVIEW"]>
```

Jika status adalah domain concept, Java/domain layer harus mengirim daftar yang benar.

### 3.5. Hash Literal

Hash literal:

```ftl
<#assign labels = {
  "APPROVED": "Approved",
  "REJECTED": "Rejected",
  "PENDING": "Pending"
}>

${labels[case.status]}
```

Ini bisa diterima untuk demo atau static label kecil, tetapi di sistem production lebih baik gunakan i18n/message bundle atau mapping di presenter.

Kenapa?

- sulit dilokalkan;
- duplikasi antar template;
- raw status bisa berubah;
- tidak ada compile-time safety;
- template menjadi tempat domain mapping tersembunyi.

---

## 4. Interpolation: `${expression}`

Interpolation adalah mekanisme memasukkan hasil expression ke output. Bentuk umum:

```ftl
${expression}
```

Contoh:

```ftl
Hello ${user.name}
Case reference: ${caseReference}
Total: ${amount?string.currency}
```

FreeMarker mengevaluasi expression, mengubah hasilnya menjadi text, lalu menulisnya ke output dengan aturan output format/escaping yang berlaku.

### 4.1. Interpolation Bukan Hanya Variable

```ftl
${100 + 20}
${user.firstName + " " + user.lastName}
${items?size}
${submittedAt?string.medium}
```

Namun expression yang terlalu panjang menurunkan maintainability.

Bandingkan:

```ftl
${user.firstName?trim?cap_first + " " + user.lastName?trim?upper_case}
```

Dengan:

```ftl
${user.displayName}
```

Yang kedua lebih kuat secara arsitektural karena template tidak perlu tahu aturan display name.

### 4.2. Interpolation Dalam Text Section

```ftl
<p>Hello ${user.name}, your application ${applicationNo} has been received.</p>
```

### 4.3. Interpolation Dalam String Literal

Interpolation juga bisa dipakai di string literal tertentu, misalnya path include:

```ftl
<#include "/themes/${tenantCode}/footer.ftl">
```

Hati-hati: dynamic include path adalah attack surface bila `tenantCode` tidak dikontrol.

Lebih aman:

```java
model.put("footerTemplate", templateRegistry.footerForTenant(tenantId));
```

```ftl
<#include footerTemplate>
```

Tetap harus dipastikan `footerTemplate` berasal dari allowlist, bukan input bebas user.

---

## 5. Variable Access: Dot, Bracket, dan Dynamic Key

### 5.1. Dot Access

```ftl
${user.name}
${caseInfo.referenceNo}
${applicant.address.postalCode}
```

Dot access cocok untuk property dengan nama stabil dan identifier-friendly.

### 5.2. Bracket Access

```ftl
${user["name"]}
${labels[case.status]}
${data["field-with-dash"]}
```

Bracket access cocok untuk:

- key Map yang bukan valid identifier;
- dynamic lookup;
- lookup berdasarkan variable;
- struktur data dari JSON-like map.

### 5.3. Dot vs Bracket Dalam Arsitektur

Jika model adalah view model yang dirancang baik:

```ftl
${applicant.fullName}
${applicant.primaryAddress.postalCode}
```

Jika model adalah dynamic map:

```ftl
${fields["applicant.fullName"]}
${fields["primary_address.postal_code"]}
```

Dynamic map bisa berguna untuk CMS/form-builder/template-builder, tetapi lebih sulit dites dan direfactor.

Rule praktis:

| Model | Access style | Cocok untuk |
|---|---|---|
| DTO/record/ViewModel | dot | template internal developer-owned |
| Map struktur bebas | bracket | dynamic document/template platform |
| Mixed | hati-hati | migration/legacy/interoperability |

---

## 6. Missing Value, Null, Default, dan Existence Check

Ini salah satu area paling penting.

FreeMarker secara default tidak diam-diam mengubah missing/null menjadi string kosong. Ini desain yang baik. Missing variable biasanya harus dianggap bug kontrak antara renderer dan template.

### 6.1. Missing Value

Template:

```ftl
${user.name}
```

Jika `user` tidak ada, render gagal.

Jika `user` ada tapi `name` tidak ada, render juga bisa gagal.

Ini bagus untuk production-critical document karena lebih baik gagal daripada menghasilkan dokumen salah.

### 6.2. Default Operator `!`

```ftl
${user.middleName!""}
${applicant.phone!"N/A"}
```

Default operator dipakai ketika absence memang sah secara domain/presentation.

Wajar:

```ftl
Middle name: ${applicant.middleName!"-"}
```

Tidak wajar:

```ftl
Case reference: ${caseReference!"-"}
```

Kenapa? Case reference biasanya mandatory. Jika hilang, dokumen harus gagal, bukan diam-diam menampilkan `-`.

### 6.3. Existence Check `??`

```ftl
<#if applicant.middleName??>
  ${applicant.middleName}
</#if>
```

Untuk nested property, hati-hati:

```ftl
<#if applicant.address.postalCode??>
  ${applicant.address.postalCode}
</#if>
```

Jika `applicant.address` missing, expression bisa gagal tergantung struktur. Pattern yang lebih aman:

```ftl
<#if applicant.address?? && applicant.address.postalCode??>
  ${applicant.address.postalCode}
</#if>
```

Namun jika nested optional sering terjadi, model sebaiknya disederhanakan:

```java
record ApplicantView(
    String fullName,
    boolean hasPrimaryAddress,
    String primaryAddressLabel,
    String postalCode
) {}
```

Template:

```ftl
<#if applicant.hasPrimaryAddress>
  ${applicant.primaryAddressLabel}
</#if>
```

### 6.4. Parentheses Defaulting untuk Nested Missing

FreeMarker memiliki pattern defaulting dengan parentheses untuk menghindari error pada path yang sebagian missing:

```ftl
${(applicant.address.postalCode)!"-"}
```

Maknanya: jika keseluruhan path tidak bisa dievaluasi, gunakan default.

Ini powerful tetapi harus digunakan dengan disiplin. Jika semua path dibungkus default seperti ini, template bisa menyembunyikan bug data model.

### 6.5. Default Value Policy

Untuk sistem production, buat policy seperti ini:

| Field type | Missing behavior | Contoh |
|---|---|---|
| mandatory identity | fail-fast | case reference, applicant ID |
| mandatory legal text | fail-fast | notice title, effective date |
| optional personal field | explicit default | middle name, alternate phone |
| optional display decoration | omit block | subtitle, note |
| security/authorization flag | fail-fast | `canApprove`, `showSensitiveData` |
| financial amount | fail-fast kecuali domain memang optional | penalty amount |
| audit metadata | fail-fast | template version, render timestamp |

Anti-pattern:

```ftl
${caseReference!""}
${recipientName!""}
${amount!""}
${effectiveDate!""}
```

Ini membuat dokumen “berhasil” tetapi salah.

---

## 7. Operators Dasar

### 7.1. Arithmetic Operators

```ftl
${a + b}
${a - b}
${a * b}
${a / b}
${a % b}
```

Gunakan untuk presentasi ringan.

Wajar:

```ftl
Page ${pageIndex + 1} of ${totalPages}
```

Tidak ideal:

```ftl
${invoice.subtotal + invoice.tax - invoice.discount}
```

Lebih baik:

```ftl
${invoice.total?string.currency}
```

### 7.2. String Concatenation

```ftl
${user.firstName + " " + user.lastName}
```

Bisa, tetapi sebaiknya display name dibentuk di Java jika aturan non-trivial.

Contoh aturan yang sebaiknya tidak di template:

- gelar depan/belakang;
- nama organisasi;
- nama legal;
- masking;
- locale-specific name order;
- fallback ke alias;
- salutation.

### 7.3. Comparison Operators

```ftl
<#if amount > 0>
  Positive
</#if>

<#if status == "APPROVED">
  Approved
</#if>

<#if status != "REJECTED">
  Not rejected
</#if>
```

Perbandingan status string raw sebaiknya dibatasi. Lebih baik Java mengirim boolean atau label siap pakai.

Daripada:

```ftl
<#if case.status == "PENDING_REVIEW" || case.status == "PENDING_SUPERVISOR_REVIEW">
  Waiting for review
</#if>
```

Lebih baik:

```ftl
<#if case.waitingForReview>
  Waiting for review
</#if>
```

### 7.4. Logical Operators

```ftl
<#if user.active && user.verified>
  Verified active user
</#if>

<#if user.admin || user.supervisor>
  Can access admin section
</#if>

<#if !user.disabled>
  Enabled
</#if>
```

Logical operator boleh untuk komposisi UI sederhana. Tapi jika sudah menjadi authorization rule, pindahkan ke Java/security layer.

### 7.5. Precedence

Expression panjang membuat precedence risk.

Buruk:

```ftl
<#if user.active && user.verified || user.admin && !case.closed>
```

Lebih jelas:

```ftl
<#if (user.active && user.verified) || (user.admin && !case.closed)>
```

Lebih baik lagi:

```ftl
<#if canShowActionPanel>
```

---

## 8. Built-ins: Cara Berpikir

Built-in adalah operator/function bawaan FTL yang dipanggil dengan `?`.

Contoh:

```ftl
${name?upper_case}
${items?size}
${amount?string.currency}
${description?html}
```

Mental model:

```text
value ? built_in
```

Built-in berguna untuk transformasi presentasi. Namun built-in juga bisa membuat template terlalu pintar.

Rule:

> Built-in harus memperjelas output, bukan menyembunyikan domain rule.

---

## 9. String Built-ins

### 9.1. Case Transformation

```ftl
${name?upper_case}
${name?lower_case}
${name?cap_first}
```

Gunakan untuk label sederhana. Jangan gunakan untuk legal name jika casing harus mengikuti dokumen resmi.

Buruk:

```ftl
${applicant.legalName?upper_case}
```

Jika dokumen legal memang membutuhkan uppercase name, lebih baik Java/presenter memberi:

```java
String applicantLegalNameForNotice;
```

### 9.2. Trim

```ftl
${name?trim}
```

Kalau data perlu trim, idealnya sudah dibersihkan sebelum sampai template. `?trim` boleh untuk defensive display, tapi bukan substitute data normalization.

### 9.3. Length

```ftl
${name?length}
```

Bisa untuk display debugging atau conditional ringan.

### 9.4. Contains/Starts/Ends

```ftl
<#if email?contains("@")>
```

Hindari validasi business di template.

### 9.5. Replace

```ftl
${code?replace("-", "")}
```

Boleh untuk display minor. Untuk canonicalization, lakukan di Java.

### 9.6. Split

```ftl
<#list tagsCsv?split(",") as tag>
  ${tag?trim}
</#list>
```

Jika Anda sering split CSV di template, data model salah bentuk. Kirim `List<String>`.

---

## 10. Number Built-ins dan Formatting

Angka mentah jarang boleh langsung ditampilkan.

Buruk:

```ftl
${amount}
```

Lebih baik:

```ftl
${amount?string.currency}
${amount?string[",##0.00"]}
```

Namun format final harus mengikuti kebutuhan domain:

- currency;
- percentage;
- decimal scale;
- rounding mode;
- locale;
- regulatory precision;
- display vs calculation precision.

### 10.1. Number Formatting Adalah Domain-Adjacent

Contoh:

```ftl
${penaltyAmount?string.currency}
```

Ini terlihat presentasi, tetapi bisa memiliki implikasi hukum jika locale/currency salah.

Untuk dokumen legal/finance, pertimbangkan Java memberi field siap tampil:

```java
record PenaltyView(
    BigDecimal amount,
    String amountLabel,
    String amountInWords
) {}
```

Template:

```ftl
Penalty amount: ${penalty.amountLabel}
```

### 10.2. Size

Untuk sequence:

```ftl
${items?size}
```

Wajar untuk display:

```ftl
You have ${notifications?size} notifications.
```

Tapi jika ukuran memengaruhi business rule, hitung di Java.

---

## 11. Date, Time, DateTime

Tanggal/waktu adalah sumber bug besar dalam rendering.

Pertanyaan yang harus dijawab sebelum render:

1. Apakah value adalah date-only, time-only, atau instant?
2. Timezone siapa yang dipakai?
3. Locale siapa yang dipakai?
4. Format untuk human atau machine?
5. Apakah output legal/regulatory?
6. Apakah daylight saving relevant?
7. Apakah tanggal harus sama dengan database, user timezone, agency timezone, atau system timezone?

Template umum:

```ftl
${submittedAt?string.medium}
${effectiveDate?string.short}
```

Untuk sistem legal/regulatory, lebih aman Java menyediakan label eksplisit:

```java
record NoticeView(
    String effectiveDateLabel,
    String issuedAtLabel,
    String timezoneLabel
) {}
```

Template:

```ftl
Issued at: ${issuedAtLabel} (${timezoneLabel})
Effective date: ${effectiveDateLabel}
```

### 11.1. Jangan Campur Instant dan Local Date Sembarangan

Contoh bug:

```text
submittedAt = 2026-06-19T00:30:00+08:00
user timezone = Asia/Jakarta (+07:00)
local date user = 2026-06-18
```

Jika template hanya memanggil formatting default tanpa aturan timezone, hasil bisa membingungkan.

Rule:

> Template boleh memformat tanggal hanya jika render context sudah menetapkan locale dan timezone dengan eksplisit.

---

## 12. Sequence dan Collection Access

Data list biasanya dipakai dengan `#list`, tetapi expression-level access juga ada.

```ftl
${items?size}
${items[0].name}
```

Hati-hati dengan index access:

```ftl
${items[0].name}
```

Jika list kosong, render gagal.

Lebih aman:

```ftl
<#if items?size gt 0>
  ${items[0].name}
</#if>
```

Tapi jika first item penting, Java bisa menyediakan:

```java
boolean hasPrimaryItem;
ItemView primaryItem;
```

### 12.1. Sequence Sebagai Data Display, Bukan Query Engine

Buruk:

```ftl
<#list users as user>
  <#if user.active && user.department == selectedDepartment && user.role != "TEMP">
    ${user.name}
  </#if>
</#list>
```

Lebih baik Java menyediakan:

```java
List<UserRow> visibleUsers;
```

Template:

```ftl
<#list visibleUsers as user>
  ${user.name}
</#list>
```

Template bukan tempat filtering business data.

---

## 13. Hash dan Map Access

Hash memungkinkan access dengan key:

```ftl
${labels[status]}
${fieldErrors["email"]}
```

Ini berguna untuk:

- error rendering;
- dynamic forms;
- translation fallback;
- document field registry;
- metadata display.

Namun Map-heavy model punya risiko:

- key typo baru ketahuan runtime;
- refactoring sulit;
- nested path tidak discoverable;
- IDE support lemah;
- contract test harus kuat.

Untuk enterprise template platform, Map boleh tetapi harus dipadukan dengan schema/contract:

```json
{
  "templateId": "notice.approval.v1",
  "requiredFields": [
    "case.referenceNo",
    "recipient.fullName",
    "notice.issuedDateLabel"
  ],
  "optionalFields": [
    "recipient.middleName",
    "notice.additionalRemarks"
  ]
}
```

---

## 14. JavaBean Property Access

FTL biasanya membaca JavaBean property:

```java
class UserView {
    public String getName() { return name; }
    public boolean isActive() { return active; }
}
```

Template:

```ftl
${user.name}
<#if user.active>
  Active
</#if>
```

### 14.1. Getter Adalah Template API

Begitu template memakai:

```ftl
${user.name}
```

Maka `getName()` menjadi bagian dari kontrak template.

Jika Java berubah:

```java
getFullName()
```

Template lama rusak.

Karena itu, treat ViewModel seperti public API.

### 14.2. Jangan Expose Entity Langsung

Buruk:

```java
model.put("case", caseEntity);
```

Template:

```ftl
${case.applicant.user.account.credentials.expiryDate}
```

Masalah:

- lazy loading;
- N+1 query;
- data leakage;
- method exposure;
- tight coupling ke schema/domain;
- impossible to reason about output contract;
- transaction boundary kacau;
- template bisa memicu database access.

Lebih baik:

```java
record CaseNoticeView(
    String referenceNo,
    String applicantName,
    String submittedDateLabel,
    String statusLabel
) {}
```

Template:

```ftl
${case.referenceNo}
${case.applicantName}
${case.submittedDateLabel}
${case.statusLabel}
```

---

## 15. Method Calls Dari Template

FreeMarker dapat mengekspos method tertentu dari object Java tergantung wrapper/configuration.

Contoh:

```ftl
${user.getDisplayName()}
${formatter.formatAmount(amount)}
```

Ini harus diperlakukan hati-hati.

### 15.1. Kapan Method Call Wajar?

Relatif wajar:

```ftl
${message("case.status." + case.statusCode)}
```

atau custom method yang memang presentation-only:

```ftl
${format.money(amount, currency)}
```

### 15.2. Kapan Method Call Berbahaya?

Berbahaya:

```ftl
${case.approve()}
${repository.findById(id)}
${securityContext.getAuthentication().getCredentials()}
${runtime.exec(command)}
```

Template tidak boleh memiliki kemampuan mutation, I/O, database access, security context traversal, atau runtime/system access.

### 15.3. Method Call Policy

| Method type | Template access? | Catatan |
|---|---:|---|
| pure formatting | boleh terbatas | allowlist |
| pure lookup label dari message source | boleh | presentation concern |
| domain calculation | sebaiknya tidak | hitung di Java |
| authorization decision | tidak | security layer |
| database call | tidak | N+1 dan side effect |
| mutation command | tidak pernah | dangerous |
| system/runtime access | tidak pernah | critical security risk |

---

## 16. Enum Handling

Enum sering muncul sebagai status.

Java:

```java
enum CaseStatus {
    DRAFT, PENDING_REVIEW, APPROVED, REJECTED
}
```

Template bisa saja:

```ftl
${case.status}
```

atau:

```ftl
<#if case.status == "APPROVED">
  Approved
</#if>
```

Tapi ini coupling ke enum name.

Lebih baik Java/presenter mengirim:

```java
record CaseView(
    String statusCode,
    String statusLabel,
    boolean approved,
    boolean pendingReview
) {}
```

Template:

```ftl
${case.statusLabel}
<#if case.approved>
  ...
</#if>
```

Rule:

> Template boleh tahu label dan display state; template tidak seharusnya menjadi tempat interpretasi penuh enum domain.

---

## 17. Optional dan Null Dari Java

Java `null` dan `Optional<T>` perlu kebijakan.

Jangan asal mengirim:

```java
Optional<String> middleName;
```

Karena template bisa melihat wrapper dengan cara yang tidak sesuai harapan. Lebih baik unwrap di presenter:

```java
String middleNameOrNull;
boolean hasMiddleName;
```

Template:

```ftl
<#if applicant.hasMiddleName>
  ${applicant.middleName}
</#if>
```

Untuk field optional, sering lebih baik mengirim display-ready:

```java
String middleNameLabel; // "-" jika tidak ada
```

Namun jangan lakukan ini untuk mandatory field.

---

## 18. Escaping Built-ins dan Output Context

Meskipun Part 8 akan membahas escaping secara mendalam, Part 4 perlu memberi peringatan dini.

Contoh:

```ftl
${userInput?html}
```

Ini HTML escaping manual.

Namun dalam modern FreeMarker, output format dan auto-escaping bisa mengatur escaping otomatis.

Yang harus diingat:

```ftl
${userInput}
```

bisa aman atau tidak tergantung output format dan auto-escaping.

Jangan membangun kebiasaan asal menambahkan `?html` di semua tempat tanpa memahami output context. HTML text node, HTML attribute, JavaScript string, CSS, dan URL bukan context yang sama.

Contoh risk:

```ftl
<script>
  const name = "${user.name}";
</script>
```

HTML escaping tidak cukup untuk JavaScript string context. Gunakan JS-string escaping atau hindari inline JS data injection.

Rule sementara:

> Di Part 4, pahami bahwa expression menghasilkan value. Di Part 8, kita akan memastikan value itu masuk ke output context dengan escaping yang benar.

---

## 19. Dangerous Built-ins: `?api`, `?eval`, `?interpret`

Beberapa built-in sangat powerful dan harus diperlakukan seperti hazardous material.

### 19.1. `?api`

`?api` dapat membuka akses ke API Java object tertentu tergantung konfigurasi. Ini bisa melewati abstraksi template-friendly wrapper.

Hindari dalam template production umum.

Jika Anda merasa butuh:

```ftl
${myMap?api.someJavaMethod()}
```

mungkin model atau wrapper Anda salah desain.

### 19.2. `?eval`

`?eval` mengevaluasi string sebagai FTL expression.

Contoh konsep:

```ftl
${someString?eval}
```

Ini berbahaya jika `someString` berasal dari user/admin/non-trusted source.

Risiko:

- server-side template injection;
- data exfiltration;
- bypass policy;
- resource abuse;
- unpredictable rendering.

### 19.3. `?interpret`

`?interpret` dapat memperlakukan string sebagai template. Ini bahkan lebih dekat ke dynamic template execution.

Gunakan hanya jika Anda membangun template platform dengan sandbox, allowlist, validation, versioning, audit, dan security review.

Rule:

> Untuk sistem enterprise biasa, anggap `?api`, `?eval`, dan `?interpret` sebagai forbidden unless explicitly approved.

---

## 20. Expression Complexity Budget

Salah satu skill penting adalah mengetahui kapan expression terlalu kompleks.

### 20.1. Level 1 — Aman

```ftl
${user.name}
${amount?string.currency}
${items?size}
```

### 20.2. Level 2 — Masih Wajar

```ftl
${user.firstName + " " + user.lastName}
${applicant.middleName!"-"}
<#if items?size gt 0>
```

### 20.3. Level 3 — Mulai Bau

```ftl
${user.firstName?trim?cap_first + " " + user.lastName?trim?upper_case}

<#if case.status == "PENDING" && case.priority == "HIGH" && officer.available>
```

### 20.4. Level 4 — Harus Dipindah ke Java

```ftl
<#if case.status == "PENDING" && case.priority == "HIGH" && officer.grade >= 7 && !case.hasAppeal && case.daysOpen > slaThreshold>
```

Ganti dengan:

```java
boolean showEscalationBlock;
String escalationMessage;
```

Template:

```ftl
<#if showEscalationBlock>
  ${escalationMessage}
</#if>
```

### 20.5. Heuristic Praktis

Pindahkan ke Java jika expression:

- lebih dari 1 baris;
- butuh lebih dari 2 operator logical;
- membandingkan banyak enum/status;
- menghitung uang, SLA, eligibility, penalty, risk;
- butuh data yang belum tersedia;
- melakukan filtering/sorting/grouping non-trivial;
- dipakai di lebih dari satu template;
- sulit diberi nama;
- harus diuji sebagai business rule;
- punya konsekuensi security/legal.

---

## 21. Presentation Model Pattern untuk Expression yang Bersih

Template bersih berasal dari model yang benar.

### 21.1. Buruk: Domain Model Mentah

```java
model.put("case", caseEntity);
model.put("applicant", applicantEntity);
model.put("user", currentUser);
```

Template:

```ftl
<#if case.status.name() == "PENDING_REVIEW" && user.roles?seq_contains("SUPERVISOR")>
  <button>Approve</button>
</#if>
```

### 21.2. Baik: View Model

```java
record CasePageView(
    String referenceNo,
    String applicantName,
    String statusLabel,
    boolean showApproveButton,
    boolean showRejectButton,
    List<ActionView> actions
) {}
```

Template:

```ftl
<h1>Case ${case.referenceNo}</h1>
<p>Applicant: ${case.applicantName}</p>
<p>Status: ${case.statusLabel}</p>

<#if case.showApproveButton>
  <button>Approve</button>
</#if>
```

### 21.3. Even Better: Action List

```java
record ActionView(
    String label,
    String url,
    String method,
    String style
) {}
```

Template:

```ftl
<#list case.actions as action>
  <a class="btn ${action.style}" href="${action.url}">${action.label}</a>
</#list>
```

Dengan model ini, template tidak perlu tahu role, status, permission, atau workflow rule. Template hanya render actions yang sudah diizinkan.

---

## 22. Formatting Strategy: Raw Value vs Display Label

Ada dua pendekatan:

### 22.1. Template Formatting

Java:

```java
model.put("amount", new BigDecimal("1250.50"));
```

Template:

```ftl
${amount?string.currency}
```

Kelebihan:

- fleksibel;
- locale-aware jika config benar;
- template bisa mengontrol presentation.

Kekurangan:

- raw formatting tersebar;
- legal/finance risk;
- lebih sulit memastikan konsistensi.

### 22.2. Presenter Formatting

Java:

```java
model.put("amountLabel", "SGD 1,250.50");
```

Template:

```ftl
${amountLabel}
```

Kelebihan:

- deterministic;
- mudah diuji;
- cocok untuk legal document;
- formatting policy centralized.

Kekurangan:

- kurang fleksibel;
- locale/template variation perlu dikelola di Java.

### 22.3. Hybrid Rule

| Output | Disarankan |
|---|---|
| Admin UI biasa | template formatting boleh |
| Email transaksional | hybrid |
| Legal/regulatory notice | display label dari Java |
| Financial statement | display label dari Java + audit |
| Machine XML/CSV | explicit machine format |
| Code/config generation | template-controlled, but strict escaping |

---

## 23. Output Untuk Human vs Machine

Expression yang sama bisa salah jika output target berbeda.

Human HTML:

```ftl
${amount?string.currency}
```

Machine CSV:

```ftl
${amount?string["0.00"]}
```

Machine JSON-like text:

```ftl
"amount": ${amount?string.computer}
```

Legal text:

```ftl
${amountLabel} (${amountInWords})
```

Rule:

> Sebelum menulis expression, tentukan apakah output untuk manusia, mesin, atau bukti legal.

---

## 24. Naming Convention di Template Model

Expression jadi jelas jika nama field jelas.

### 24.1. Nama Buruk

```ftl
${data.value1}
${obj.flag}
${case.x}
${result.str}
```

### 24.2. Nama Baik

```ftl
${case.referenceNo}
${applicant.fullName}
${notice.issuedDateLabel}
${permissions.canApprove}
${summary.totalPenaltyLabel}
```

### 24.3. Suffix Convention

Gunakan suffix untuk membedakan raw dan display:

| Suffix | Makna |
|---|---|
| `Code` | stable code, not label |
| `Label` | human-readable display |
| `Html` | already sanitized/approved HTML, harus hati-hati |
| `Url` | URL/path siap render |
| `At` | timestamp/datetime |
| `Date` | date-only |
| `Amount` | numeric amount |
| `AmountLabel` | formatted amount |
| `Visible` | display visibility |
| `Enabled` | UI enabled state |
| `Allowed` / `CanX` | permission result |

Contoh:

```java
record NoticeView(
    String referenceNo,
    LocalDate issuedDate,
    String issuedDateLabel,
    BigDecimal penaltyAmount,
    String penaltyAmountLabel,
    boolean showAppealSection,
    String appealDeadlineLabel
) {}
```

Template:

```ftl
Reference: ${notice.referenceNo}
Issued date: ${notice.issuedDateLabel}
Penalty: ${notice.penaltyAmountLabel}

<#if notice.showAppealSection>
Appeal deadline: ${notice.appealDeadlineLabel}
</#if>
```

---

## 25. Practical Example: Naive Template vs Production Template

### 25.1. Naive Model

```java
Map<String, Object> model = Map.of(
    "case", caseEntity,
    "applicant", applicantEntity,
    "officer", officerEntity,
    "now", Instant.now()
);
```

Naive template:

```ftl
Dear ${applicant.name!""},

Your case ${case.id!""} has status ${case.status!""}.

<#if case.status == "REJECTED" && case.rejectionReason??>
Reason: ${case.rejectionReason}
</#if>

Issued on ${now?string.medium}
```

Masalah:

1. mandatory field diberi default kosong;
2. entity diekspos langsung;
3. status raw ditampilkan;
4. date/time tergantung config;
5. rejection rule di template;
6. tidak ada template version;
7. tidak ada locale/timezone explicit;
8. tidak jelas field mana mandatory.

### 25.2. Production View Model

```java
record CaseOutcomeNoticeView(
    String templateId,
    String templateVersion,
    String caseReferenceNo,
    String recipientName,
    String statusLabel,
    boolean showRejectionReason,
    String rejectionReasonLabel,
    String issuedAtLabel,
    String renderAuditId
) {}
```

Template:

```ftl
Dear ${notice.recipientName},

Your case ${notice.caseReferenceNo} has status: ${notice.statusLabel}.

<#if notice.showRejectionReason>
Reason: ${notice.rejectionReasonLabel}
</#if>

Issued on ${notice.issuedAtLabel}

Reference: ${notice.renderAuditId}
```

Kelebihan:

- mandatory field fail-fast;
- field jelas;
- status sudah display-safe;
- rule show/hide sudah dari Java;
- audit metadata ada;
- template lebih stabil;
- mudah dites;
- lebih aman dari data leakage.

---

## 26. Contract Testing untuk Expression

Karena expression adalah kontrak, test harus memastikan template dan model cocok.

### 26.1. Minimal Render Test

```java
@Test
void rendersNotice() throws Exception {
    var model = Map.of(
        "notice", new CaseOutcomeNoticeView(
            "case-outcome-notice",
            "1.0.0",
            "CASE-2026-0001",
            "Fajar Abdi Nugraha",
            "Approved",
            false,
            "",
            "19 June 2026, 10:30",
            "RND-123"
        )
    );

    Template template = cfg.getTemplate("notice/case-outcome.ftl");
    StringWriter out = new StringWriter();
    template.process(model, out);

    assertThat(out.toString()).contains("CASE-2026-0001");
}
```

### 26.2. Missing Mandatory Field Test

```java
@Test
void failsWhenCaseReferenceMissing() {
    var model = Map.of(
        "notice", Map.of(
            "recipientName", "Fajar"
        )
    );

    assertThrows(TemplateException.class, () -> render("notice.ftl", model));
}
```

### 26.3. Optional Field Test

```java
@Test
void rendersWithoutOptionalMiddleName() {
    var model = validModelWithoutMiddleName();
    var output = render("applicant.ftl", model);
    assertThat(output).contains("Middle name: -");
}
```

Top 1% template engineering selalu punya tests untuk:

- mandatory field;
- optional field;
- empty list;
- special characters;
- locale;
- timezone;
- escaping;
- large data;
- branch visibility;
- template version compatibility.

---

## 27. Common Mistakes dan Cara Memperbaiki

### 27.1. Semua Field Pakai Default Kosong

Buruk:

```ftl
${recipientName!""}
${caseReference!""}
${amount!""}
```

Perbaikan:

```ftl
${recipientName}
${caseReference}
${amountLabel}
```

Default hanya untuk optional:

```ftl
${middleName!"-"}
```

### 27.2. Logic Status Kompleks di Template

Buruk:

```ftl
<#if status == "A" || status == "B" || status == "C">
```

Perbaikan:

```ftl
<#if showPendingReviewSection>
```

### 27.3. Formatting Tidak Konsisten

Buruk:

```ftl
${amount}
${amount?string.currency}
${amount?string["0.00"]}
```

Perbaikan:

```ftl
${amountLabel}
```

atau enforce macro:

```ftl
<@money amount=amount currency=currency />
```

### 27.4. Expose Entity Langsung

Buruk:

```java
model.put("user", userEntity);
```

Perbaikan:

```java
model.put("user", UserHeaderView.from(userEntity));
```

### 27.5. Inline JavaScript Dengan `${...}`

Buruk:

```ftl
<script>
  var name = "${user.name}";
</script>
```

Perbaikan tergantung strategi:

- gunakan JS escaping;
- gunakan JSON serialization yang aman;
- simpan data di endpoint API;
- gunakan data attribute dengan escaping benar;
- hindari inline script untuk data user.

### 27.6. Dynamic Template Path Dari Input

Buruk:

```ftl
<#include "/tenant/${request.tenant}/footer.ftl">
```

Perbaikan:

```java
model.put("footerTemplate", templateRegistry.resolveFooterTemplate(tenantId));
```

```ftl
<#include footerTemplate>
```

Dengan registry allowlist.

---

## 28. Review Checklist untuk Part 4

Gunakan checklist ini saat review template FreeMarker.

### 28.1. Expression Safety

- Apakah mandatory field dibiarkan fail-fast?
- Apakah optional field punya default eksplisit?
- Apakah default kosong tidak menyembunyikan bug?
- Apakah nested optional path aman?
- Apakah expression terlalu panjang?
- Apakah ada status/role/policy logic di template?

### 28.2. Data Model Contract

- Apakah template memakai ViewModel, bukan entity?
- Apakah nama field jelas?
- Apakah raw value dan display label dibedakan?
- Apakah enum/status tidak diinterpretasi sembarangan?
- Apakah field financial/legal diformat dengan policy yang benar?

### 28.3. Security

- Apakah ada `?api`?
- Apakah ada `?eval`?
- Apakah ada `?interpret`?
- Apakah ada method call berbahaya?
- Apakah ada raw HTML output?
- Apakah inline JS aman?
- Apakah dynamic include berasal dari allowlist?

### 28.4. Maintainability

- Apakah expression readable?
- Apakah formatting konsisten?
- Apakah logic reusable dipindah ke macro/presenter?
- Apakah field yang dipakai tercakup test?
- Apakah missing/empty/list cases dites?

---

## 29. Mental Model Ringkas

FTL expression adalah bahasa kecil untuk membaca value dan membentuk output.

Model yang benar:

```text
Expression should be simple because model should be intentional.
```

Jika expression kompleks, biasanya penyebabnya bukan FTL kurang powerful, tetapi model Java kurang siap.

Template bagus terlihat seperti ini:

```ftl
<h1>${page.title}</h1>
<p>${case.referenceNo}</p>
<p>${case.statusLabel}</p>
<p>${case.submittedAtLabel}</p>

<#if case.showWarning>
  <div class="warning">${case.warningMessage}</div>
</#if>
```

Template buruk terlihat seperti ini:

```ftl
<#if case.status == "PENDING" && user.roles?seq_contains("SUPERVISOR") && case.daysOpen gt 7 && !case.hasAppeal>
  <div>${case.applicant.name?upper_case} - ${case.penalty * 1.1}</div>
</#if>
```

Perbedaan keduanya bukan sekadar style. Itu perbedaan antara:

- rendering sebagai presentation boundary;
- rendering sebagai business rule dumping ground.

Top 1% engineer menjaga boundary itu.

---

## 30. Latihan Praktis

### Latihan 1 — Mandatory vs Optional Field

Diberikan template:

```ftl
Dear ${recipientName!""},
Your application ${applicationNo!""} has been received.
Contact: ${phone!"-"}
```

Tentukan:

1. field mana mandatory;
2. field mana optional;
3. default mana yang salah;
4. bagaimana template seharusnya ditulis.

Jawaban yang diharapkan:

```ftl
Dear ${recipientName},
Your application ${applicationNo} has been received.
Contact: ${phone!"-"}
```

`recipientName` dan `applicationNo` mandatory. `phone` optional.

### Latihan 2 — Pindahkan Business Logic ke Java

Template buruk:

```ftl
<#if case.status == "PENDING_REVIEW" && officer.grade >= 7 && case.daysOpen > 10>
  Escalation required
</#if>
```

Desain ulang ViewModel.

Jawaban contoh:

```java
record CaseReviewView(
    String referenceNo,
    String statusLabel,
    boolean showEscalationNotice,
    String escalationNoticeLabel
) {}
```

Template:

```ftl
<#if case.showEscalationNotice>
  ${case.escalationNoticeLabel}
</#if>
```

### Latihan 3 — Raw vs Display Label

Template:

```ftl
Penalty: ${amount?string.currency}
```

Untuk email biasa, ini bisa diterima jika locale/currency config benar. Untuk regulatory notice, desain ulang menjadi:

```java
record PenaltyNoticeView(
    BigDecimal amount,
    String amountLabel,
    String amountInWords
) {}
```

Template:

```ftl
Penalty: ${penalty.amountLabel} (${penalty.amountInWords})
```

### Latihan 4 — Dynamic Key

Model:

```java
Map<String, String> labels = Map.of(
    "APPROVED", "Approved",
    "REJECTED", "Rejected"
);
```

Template:

```ftl
${labels[status]}
```

Pertanyaan:

- Apa risiko jika `status` tidak ada di labels?
- Apakah sebaiknya default?
- Di sistem i18n, apakah labels sebaiknya Map di model atau message bundle?

Jawaban:

- Missing label harus fail-fast untuk status mandatory.
- Default seperti `Unknown` hanya boleh jika domain memang menerima unknown state.
- Untuk i18n, message bundle/presenter lebih baik daripada Map lokal di template.

---

## 31. Ringkasan Part 4

Dalam Part 4, kita mempelajari:

1. FTL adalah bahasa template, bukan Java dan bukan business rule engine.
2. FreeMarker bekerja dengan values dan types.
3. Data model root biasanya hash.
4. Java object dilihat melalui `ObjectWrapper`.
5. Interpolation `${...}` mengevaluasi expression dan menulis hasilnya ke output.
6. Dot access cocok untuk ViewModel stabil.
7. Bracket access cocok untuk dynamic key/Map.
8. Missing value sebaiknya fail-fast untuk mandatory field.
9. Default operator `!` hanya untuk absence yang sah.
10. Existence check `??` berguna tetapi jangan menutupi model buruk.
11. Operators boleh dipakai untuk presentasi ringan.
12. Built-ins membantu formatting, tetapi bisa menjadi sumber logic dumping.
13. Formatting angka/tanggal harus sadar locale/timezone/domain.
14. JavaBean getter adalah template API.
15. Entity tidak boleh diekspos langsung ke template production.
16. Method call harus dibatasi ketat.
17. `?api`, `?eval`, dan `?interpret` harus dianggap dangerous.
18. Expression complexity adalah indikator model/presenter perlu diperbaiki.
19. Template yang baik sederhana karena ViewModel-nya intentional.
20. Contract testing penting untuk menjaga template tetap aman dan stabil.

---

## 32. Koneksi ke Part Berikutnya

Part 4 fokus pada expression dan value.

Part 5 akan melanjutkan ke struktur kontrol FTL:

- `#if`, `#elseif`, `#else`;
- truthiness;
- `#list`;
- loop metadata;
- empty list handling;
- `#include`;
- `#import`;
- scope variable;
- `#assign`, `#local`, `#global`;
- include vs macro vs layout;
- anti-pattern nested conditionals.

Jika Part 4 adalah “cara membaca dan membentuk value”, Part 5 adalah “cara mengatur shape output secara terstruktur tanpa mengubah template menjadi mini application”.

---

## 33. Referensi

Referensi utama:

1. Apache FreeMarker Manual — Template Author's Guide.
2. Apache FreeMarker Manual — Expressions.
3. Apache FreeMarker Manual — Interpolations.
4. Apache FreeMarker Manual — Values and Types.
5. Apache FreeMarker Manual — Object Wrappers.
6. Apache FreeMarker Manual — Auto-escaping and Output Formats.
7. Apache FreeMarker Manual — Built-ins reference.
8. Apache FreeMarker Manual — Expert built-ins, termasuk `eval`, `eval_json`, dan API-related features.

---

## 34. Status Seri

```text
Part 4 selesai.
Seri belum selesai.
Berikutnya: Part 5 — FreeMarker Template Language Deep Dive II: Directives, Conditionals, Loops, Includes.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-003.md">⬅️ Part 3 — FreeMarker Fundamental Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-005.md">Part 5 — FreeMarker Template Language Deep Dive II: Directives, Conditionals, Loops, Includes ➡️</a>
</div>
