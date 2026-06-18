# Part 8 — Formatting, I18N, XML, and SQL Tags: What to Use and What to Avoid

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `08-formatting-i18n-xml-sql-tags-what-to-use-and-avoid.md`  
> Area: Jakarta Pages / JSP, Jakarta Standard Tag Library, Formatting, I18N, XML Tags, SQL Tags  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Tujuan Pembelajaran

Di part sebelumnya kita sudah membahas **core tags**: `c:out`, `c:if`, `c:choose`, `c:forEach`, `c:url`, `c:redirect`, dan tag-tag dasar lain yang menggantikan scriptlet untuk view control.

Bagian ini naik satu level ke area yang sering terlihat “sekadar utilitas”, tetapi di sistem enterprise bisa menjadi sumber bug besar:

1. **formatting**: tanggal, angka, mata uang, persentase, locale, timezone.
2. **internationalization / i18n**: resource bundle, pesan multi-bahasa, parameterized message.
3. **XML tags**: parsing XML dan XPath langsung di JSP.
4. **SQL tags**: query database langsung dari JSP.
5. **batas aman penggunaan**: mana yang masih layak dipakai, mana yang sebaiknya dihindari.
6. **arsitektur view yang defensible**: view boleh memformat, tetapi tidak boleh menjadi business layer, integration layer, atau persistence layer.

Setelah bagian ini, target pemahamanmu bukan hanya tahu tag seperti `fmt:formatDate`, tetapi bisa menjawab pertanyaan arsitektural seperti:

- Kenapa tanggal yang sama bisa tampil berbeda antara server, user, dan database?
- Kenapa formatting di JSP bisa membuat bug audit/regulatory?
- Kapan `fmt:message` cukup, dan kapan harus punya message service sendiri?
- Kenapa XML tag dan SQL tag JSTL biasanya red flag dalam sistem modern?
- Bagaimana memigrasikan JSP lama yang penuh SQL tag tanpa big-bang rewrite?

---

## 1. Mental Model: Formatting dan I18N Adalah Bagian dari Contract, Bukan Dekorasi

Banyak developer menganggap formatting hanya kosmetik:

```jsp
<fmt:formatDate value="${case.createdAt}" pattern="dd/MM/yyyy" />
```

Padahal di sistem enterprise, output seperti ini bisa menjadi **contract**:

- contract dengan user,
- contract dengan regulator,
- contract dengan audit trail,
- contract dengan dokumen resmi,
- contract dengan report,
- contract dengan external agency,
- contract dengan SLA.

Contoh sederhana:

```text
Created Date: 01/02/2026
```

Ini ambigu:

- 1 Februari 2026?
- 2 Januari 2026?

Kalau ini muncul di case management, appeal deadline, enforcement notice, atau legal correspondence, formatting bukan lagi kosmetik. Ia menjadi bagian dari **semantic correctness**.

### 1.1 View formatting harus menjawab 4 hal

Setiap kali menampilkan date/number/message di UI, tanya:

1. **Nilainya apa?**  
   Misalnya `Instant`, `LocalDate`, `BigDecimal`, `String`, `Integer`.

2. **Maknanya apa?**  
   Misalnya event timestamp, effective date, due date, business day, amount, percentage.

3. **Dilihat oleh siapa?**  
   Misalnya public user, officer, admin, auditor, external agency.

4. **Mengikuti aturan apa?**  
   Misalnya locale user, locale agency, timezone agency, timezone event, report standard, legal format.

Tanpa 4 pertanyaan ini, tag formatting bisa menghasilkan tampilan yang benar secara teknis tetapi salah secara bisnis.

---

## 2. Jakarta Tags Formatting Library: Posisi dan Namespace

Jakarta Standard Tag Library menyediakan beberapa kelompok tag:

| Kelompok | Prefix umum | URI Jakarta Tags 3.x | Fungsi |
|---|---:|---|---|
| Core | `c` | `jakarta.tags.core` | condition, loop, output, URL |
| Formatting | `fmt` | `jakarta.tags.fmt` | locale, timezone, bundle, message, date/number formatting |
| XML | `x` | `jakarta.tags.xml` | XML parse, XPath-like selection/control |
| SQL | `sql` | `jakarta.tags.sql` | query/update/transaction langsung dari page |
| Functions | `fn` | `jakarta.tags.functions` | fungsi EL untuk string/collection sederhana |

Untuk part ini, fokusnya adalah:

```jsp
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<%@ taglib prefix="x" uri="jakarta.tags.xml" %>
<%@ taglib prefix="sql" uri="jakarta.tags.sql" %>
```

Pada aplikasi lama berbasis Java EE/JSTL 1.2, URI biasanya seperti:

```jsp
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
<%@ taglib prefix="x" uri="http://java.sun.com/jsp/jstl/xml" %>
<%@ taglib prefix="sql" uri="http://java.sun.com/jsp/jstl/sql" %>
```

Pada Jakarta Tags 3.x, gunakan URI `jakarta.tags.*`.

### 2.1 Catatan kompatibilitas penting

Jangan campur secara sembarangan:

- JSP/Jakarta Pages versi `javax.*` dengan taglib Jakarta `jakarta.*`.
- Servlet container Jakarta seperti Tomcat 10+ dengan library JSTL lama `javax.servlet.jsp.jstl`.
- `jakarta.servlet.jsp.jstl-api` tanpa implementation library pada bare servlet container.
- Jakarta EE full/profile server dengan dependency JSTL duplicate di aplikasi.

Rule praktis:

| Runtime | Namespace | JSTL/Tags |
|---|---|---|
| Java EE 8 / Jakarta EE 8 style | `javax.*` | JSTL 1.2 style URI lama |
| Jakarta EE 9+ | `jakarta.*` | Jakarta Tags 2.x/3.x URI baru |
| Tomcat 9 | `javax.*` | JSTL 1.2 compatible |
| Tomcat 10+ | `jakarta.*` | Jakarta Tags compatible |
| Full Jakarta EE server | biasanya already included | hati-hati duplicate dependency |

---

## 3. Formatting Tags Overview

Formatting tag library biasanya dipakai untuk:

1. request encoding,
2. locale selection,
3. timezone selection,
4. resource bundle,
5. message lookup,
6. date formatting,
7. date parsing,
8. number formatting,
9. number parsing.

Tag utama:

| Tag | Fungsi |
|---|---|
| `fmt:requestEncoding` | set request character encoding |
| `fmt:setLocale` | set locale untuk scope tertentu |
| `fmt:setTimeZone` | set timezone untuk scope tertentu |
| `fmt:timeZone` | apply timezone untuk body tag |
| `fmt:setBundle` | load bundle dan simpan sebagai variable |
| `fmt:bundle` | load bundle untuk body nested |
| `fmt:message` | lookup localized message |
| `fmt:param` | parameter untuk message |
| `fmt:formatDate` | format date/time |
| `fmt:parseDate` | parse string menjadi date |
| `fmt:formatNumber` | format angka/currency/percentage |
| `fmt:parseNumber` | parse string menjadi number |

### 3.1 Prinsip besar

`fmt:*` cocok untuk **presentational transformation**.

Ia tidak cocok untuk:

- business rule calculation,
- legal deadline computation,
- timezone policy decision,
- persistence conversion,
- cross-field validation,
- report canonicalization,
- data cleansing.

Contoh batas sehat:

```jsp
<fmt:formatNumber value="${invoice.totalAmount}" type="currency" />
```

Contoh batas berbahaya:

```jsp
<fmt:parseNumber value="${param.amount}" var="amount" />
<c:if test="${amount > 10000}">
  Require approval
</c:if>
```

Masalahnya bukan parsing-nya saja. Masalahnya adalah JSP mulai mengambil keputusan bisnis berdasarkan input mentah.

---

## 4. `fmt:requestEncoding`: Character Encoding dan Input Correctness

Tag:

```jsp
<fmt:requestEncoding value="UTF-8" />
```

Fungsinya menetapkan encoding request body. Ini relevan terutama untuk form POST dengan karakter non-ASCII.

Namun dalam aplikasi modern, encoding sebaiknya ditentukan lebih awal di filter atau container configuration, bukan diserahkan ke JSP.

### 4.1 Kenapa encoding harus terlalu awal?

Request parameter decoding biasanya terjadi saat pertama kali `getParameter()` dipanggil. Kalau parameter sudah dibaca sebelum `fmt:requestEncoding`, encoding sudah terlambat.

Contoh failure:

1. Filter membaca `request.getParameter("name")`.
2. Container decode request memakai default encoding.
3. JSP menjalankan `<fmt:requestEncoding value="UTF-8" />`.
4. Data sudah terlanjur rusak.

Karena itu, untuk sistem modern:

```java
public class Utf8EncodingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request,
                         ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        request.setCharacterEncoding("UTF-8");
        response.setCharacterEncoding("UTF-8");
        chain.doFilter(request, response);
    }
}
```

Atau gunakan framework/container mechanism yang setara.

### 4.2 Rekomendasi

| Situasi | Rekomendasi |
|---|---|
| JSP legacy kecil | `fmt:requestEncoding` masih bisa membantu |
| Enterprise app | gunakan filter/global config |
| Banyak form multibahasa | enforce UTF-8 sejak request entrypoint |
| Security-sensitive input | jangan rely pada JSP untuk encoding |

---

## 5. Locale: Bahasa, Format, dan Ekspektasi User

Locale bukan hanya bahasa. Locale memengaruhi:

- message language,
- date format,
- number format,
- decimal separator,
- grouping separator,
- currency symbol,
- pluralization strategy di layer yang lebih advanced.

Contoh:

| Locale | Number | Date style |
|---|---:|---|
| `en_US` | `1,234.56` | `6/18/26` |
| `en_GB` | `1,234.56` | `18/06/2026` |
| `de_DE` | `1.234,56` | `18.06.26` |
| `id_ID` | `1.234,56` | `18/06/26` |

### 5.1 `fmt:setLocale`

Contoh:

```jsp
<fmt:setLocale value="en_SG" />
```

Atau simpan dalam scope:

```jsp
<fmt:setLocale value="${userPreferences.locale}" scope="session" />
```

Tetapi hati-hati: menyimpan locale di session berarti semua tab dan semua page user memakai locale itu sampai berubah.

### 5.2 Locale source hierarchy

Dalam enterprise app, tentukan urutan sumber locale secara eksplisit:

1. explicit user preference,
2. selected language in URL/query/cookie,
3. tenant/agency default,
4. `Accept-Language` browser header,
5. application default.

Jangan biarkan setiap JSP menentukan sendiri.

### 5.3 Bad pattern

```jsp
<fmt:setLocale value="${param.lang}" scope="session" />
```

Masalah:

- user-controlled langsung masuk session,
- tidak ada whitelist,
- bisa menghasilkan locale tidak dikenal,
- semua tab berubah,
- sulit audit.

Lebih aman:

```java
Locale selected = localeService.resolveAllowedLocale(request, user);
request.setAttribute("viewLocale", selected);
```

Lalu JSP:

```jsp
<fmt:setLocale value="${viewLocale}" />
```

### 5.4 Locale bukan authorization

Jangan gunakan locale untuk menentukan hak akses.

Salah:

```jsp
<c:if test="${viewLocale.language == 'en'}">
  <a href="/admin/export">Export</a>
</c:if>
```

Locale hanya presentasi. Authorization harus berasal dari security context/policy engine.

---

## 6. Timezone: Salah Satu Sumber Bug Paling Mahal

Timezone jauh lebih berbahaya daripada locale.

Locale menjawab: “bagaimana format ditampilkan?”  
Timezone menjawab: “waktu absolut ini jatuh pada jam/tanggal berapa bagi konteks tertentu?”

Contoh:

```text
2026-06-18T17:30:00Z
```

Di Asia/Jakarta:

```text
2026-06-19 00:30
```

Di UTC:

```text
2026-06-18 17:30
```

Tanggalnya bisa berubah. Untuk deadline, SLA, hearing date, appeal period, enforcement effective date, ini sangat kritikal.

### 6.1 `fmt:setTimeZone`

```jsp
<fmt:setTimeZone value="Asia/Jakarta" />
```

Atau:

```jsp
<fmt:setTimeZone value="${userPreferences.timeZone}" scope="session" />
```

### 6.2 `fmt:timeZone`

```jsp
<fmt:timeZone value="UTC">
  <fmt:formatDate value="${audit.createdAt}" pattern="yyyy-MM-dd HH:mm:ss z" />
</fmt:timeZone>
```

`fmt:timeZone` bagus untuk section tertentu, misalnya audit timestamp selalu UTC.

### 6.3 Timezone policy harus domain-aware

Jangan asal pakai timezone user untuk semua hal.

| Data | Timezone yang mungkin benar |
|---|---|
| Audit log technical timestamp | UTC atau system timezone resmi |
| User activity feed | user timezone |
| Legal effective date | jurisdiction timezone |
| SLA countdown | agency/business timezone |
| Report period | report-defined timezone |
| Database created timestamp | canonical UTC, ditampilkan sesuai rule |
| Appointment/hearing | event location timezone |

### 6.4 Bug klasik: LocalDate vs Instant

Misalnya ada due date:

```text
2026-06-18
```

Jika ini adalah **business date**, jangan simpan sebagai midnight UTC lalu format ke user timezone. Itu bisa bergeser menjadi tanggal lain.

Mental model:

| Tipe konsep | Java type modern | Contoh |
|---|---|---|
| Waktu absolut | `Instant` | audit event happened at X |
| Tanggal bisnis tanpa jam | `LocalDate` | deadline date |
| Tanggal + jam tanpa zone | `LocalDateTime` | draft appointment before zone assigned |
| Tanggal + jam + zone | `ZonedDateTime` | hearing in Singapore time |
| Offset-aware timestamp | `OffsetDateTime` | API contract timestamp |

JSP/JSTL legacy banyak bekerja dengan `java.util.Date`, sehingga mapping dari Java Time API perlu hati-hati. Jangan jadikan JSP tempat konversi konsep temporal.

---

## 7. `fmt:formatDate`: Date and Time Formatting

Contoh dasar:

```jsp
<fmt:formatDate value="${case.createdAt}" pattern="yyyy-MM-dd HH:mm:ss" />
```

Dengan type/style:

```jsp
<fmt:formatDate value="${case.createdAt}" type="date" dateStyle="long" />
<fmt:formatDate value="${case.createdAt}" type="time" timeStyle="short" />
<fmt:formatDate value="${case.createdAt}" type="both" dateStyle="medium" timeStyle="short" />
```

Dengan timezone:

```jsp
<fmt:formatDate value="${case.createdAt}"
                pattern="yyyy-MM-dd HH:mm:ss z"
                timeZone="${viewTimeZone}" />
```

### 7.1 Pattern vs style

Ada dua pendekatan:

1. **style-based**: mengikuti locale.
2. **pattern-based**: format eksplisit.

Style-based:

```jsp
<fmt:formatDate value="${createdAt}" type="date" dateStyle="long" />
```

Pattern-based:

```jsp
<fmt:formatDate value="${createdAt}" pattern="dd MMM yyyy" />
```

| Pendekatan | Kelebihan | Kekurangan |
|---|---|---|
| style-based | locale-aware | output bisa berubah antar locale/JDK/provider |
| pattern-based | predictable | bisa kurang natural untuk locale tertentu |

Untuk UI biasa, style-based sering cukup. Untuk dokumen legal/report resmi, pattern-based biasanya lebih defensible.

### 7.2 Jangan pakai `YYYY` untuk year biasa

Kesalahan umum:

```jsp
<fmt:formatDate value="${date}" pattern="YYYY-MM-dd" />
```

`YYYY` adalah week-based-year di pattern Java date formatting tertentu. Untuk tahun kalender, gunakan:

```jsp
<fmt:formatDate value="${date}" pattern="yyyy-MM-dd" />
```

Bug ini sering muncul di akhir/desember-awal/januari.

### 7.3 Jangan format timestamp tanpa timezone eksplisit pada sistem multi-region

Kurang aman:

```jsp
<fmt:formatDate value="${audit.createdAt}" pattern="yyyy-MM-dd HH:mm:ss" />
```

Lebih jelas:

```jsp
<fmt:formatDate value="${audit.createdAt}"
                pattern="yyyy-MM-dd HH:mm:ss z"
                timeZone="UTC" />
```

Atau:

```jsp
<fmt:formatDate value="${audit.createdAt}"
                pattern="dd MMM yyyy HH:mm z"
                timeZone="${viewTimeZone}" />
```

### 7.4 View model approach

Untuk sistem high-stakes, pertimbangkan menyiapkan display field di server:

```java
public record CaseListItemView(
    String caseNo,
    String createdAtDisplay,
    String dueDateDisplay,
    String statusLabel
) {}
```

JSP:

```jsp
<td>${item.createdAtDisplay}</td>
<td>${item.dueDateDisplay}</td>
```

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| JSP formatting | fleksibel, cepat | logic tersebar di banyak view |
| View model display string | konsisten, testable | perlu mapping layer |
| Custom tag/function | reusable | perlu desain dan testing |

Untuk top-tier engineering, yang penting bukan selalu memilih satu. Yang penting adalah tahu kapan format adalah presentasi bebas dan kapan format adalah domain contract.

---

## 8. `fmt:parseDate`: Parsing di View Hampir Selalu Perlu Dicurdigai

Contoh:

```jsp
<fmt:parseDate value="${param.submittedDate}"
               pattern="dd/MM/yyyy"
               var="submittedDate" />
```

Tag ini ada, tetapi penggunaannya di JSP modern harus sangat terbatas.

### 8.1 Kenapa parsing input di JSP berbahaya?

Karena parsing input biasanya bagian dari:

- validation,
- error reporting,
- form binding,
- domain rule,
- security boundary,
- auditability.

Kalau JSP melakukan parsing, maka controller/service kehilangan visibility terhadap:

- input mentah,
- parsing error,
- field-level error,
- invalid format,
- locale mismatch,
- tampering.

### 8.2 Better approach

Controller/backing layer:

```java
public final class SearchCriteria {
    private LocalDate fromDate;
    private LocalDate toDate;
    private List<FieldError> errors;
}
```

JSP hanya render:

```jsp
<input name="fromDate" value="${searchForm.fromDateInput}" />
<c:if test="${not empty searchForm.errors['fromDate']}">
  <span class="error">${searchForm.errors['fromDate']}</span>
</c:if>
```

### 8.3 Kapan `fmt:parseDate` masih masuk akal?

Sangat terbatas:

- prototyping,
- demo page,
- read-only transformation dari value internal yang sudah trusted,
- legacy page yang belum bisa direfactor.

Untuk enterprise production, parsing user input sebaiknya di controller/form binding layer.

---

## 9. `fmt:formatNumber`: Number, Currency, Percentage

Contoh:

```jsp
<fmt:formatNumber value="${amount}" />
<fmt:formatNumber value="${amount}" type="currency" />
<fmt:formatNumber value="${ratio}" type="percent" />
```

Dengan digit control:

```jsp
<fmt:formatNumber value="${score}"
                  minFractionDigits="2"
                  maxFractionDigits="2" />
```

Dengan pattern:

```jsp
<fmt:formatNumber value="${amount}" pattern="#,#00.00" />
```

### 9.1 Currency formatting tidak sama dengan monetary correctness

```jsp
<fmt:formatNumber value="${payment.amount}" type="currency" />
```

Ini hanya formatting. Ia tidak menjamin:

- currency code benar,
- rounding rule benar,
- precision benar,
- tax rule benar,
- exchange rate benar,
- accounting standard benar.

Untuk monetary domain, simpan amount dan currency secara eksplisit:

```java
public record MoneyView(
    BigDecimal amount,
    String currencyCode,
    String display
) {}
```

Jangan bergantung pada default locale untuk menentukan currency kalau domain membutuhkan currency tertentu.

Buruk:

```jsp
<fmt:formatNumber value="${fee.amount}" type="currency" />
```

Lebih eksplisit:

```jsp
${fee.displayAmount}
```

atau custom formatter:

```jsp
${money:format(fee.amount, fee.currencyCode, viewLocale)}
```

### 9.2 Percentage formatting

```jsp
<fmt:formatNumber value="${completionRate}" type="percent" />
```

Perhatikan semantic input:

| Value | Output percent umum |
|---:|---:|
| `0.75` | `75%` |
| `75` | `7,500%` |

Jadi pastikan apakah model menyimpan fraction atau percentage points.

### 9.3 Rounding

Formatting bisa membulatkan tampilan. Ini berbeda dengan membulatkan value bisnis.

Contoh:

```jsp
<fmt:formatNumber value="${amount}" maxFractionDigits="2" />
```

Ini bukan pengganti:

```java
amount.setScale(2, RoundingMode.HALF_UP)
```

Kalau rounding berdampak pada invoice, payment, tax, penalty, refund, atau enforcement amount, lakukan di domain/application layer, bukan JSP.

---

## 10. `fmt:parseNumber`: Parsing Number di View

Contoh:

```jsp
<fmt:parseNumber value="${param.amount}" var="amount" />
```

Sama seperti `parseDate`, ini biasanya red flag jika input berasal dari user.

### 10.1 Locale-specific parsing surprise

Input:

```text
1.234
```

Makna bisa berbeda:

| Locale | Interpretasi mungkin |
|---|---:|
| `en_US` | 1.234 |
| `de_DE` / `id_ID` | 1234 |

Jika JSP melakukan parsing berdasarkan locale yang tidak jelas, hasilnya bisa salah.

### 10.2 Better approach

- Parse di controller/form binder.
- Simpan raw input untuk redisplay.
- Simpan parsed value jika valid.
- Simpan field-level error jika invalid.
- Gunakan locale policy eksplisit.

---

## 11. Resource Bundle dan Message Lookup

Internationalization di JSP biasanya memakai resource bundle.

Contoh properties:

```properties
case.list.title=Case List
case.status.open=Open
case.status.closed=Closed
case.createdAt=Created At
```

Indonesia:

```properties
case.list.title=Daftar Kasus
case.status.open=Terbuka
case.status.closed=Ditutup
case.createdAt=Dibuat Pada
```

### 11.1 `fmt:setBundle`

```jsp
<fmt:setBundle basename="messages" var="msg" />
```

Lalu:

```jsp
<fmt:message key="case.list.title" bundle="${msg}" />
```

### 11.2 `fmt:bundle`

```jsp
<fmt:bundle basename="messages">
  <h1><fmt:message key="case.list.title" /></h1>
</fmt:bundle>
```

### 11.3 `fmt:message`

```jsp
<fmt:message key="case.createdAt" />
```

Dengan parameter:

```jsp
<fmt:message key="case.assignment.message">
  <fmt:param value="${case.officerName}" />
  <fmt:param value="${case.assignedDateDisplay}" />
</fmt:message>
```

Properties:

```properties
case.assignment.message=Assigned to {0} on {1}
```

### 11.4 Key naming strategy

Buruk:

```properties
title=Title
submit=Submit
name=Name
```

Lebih baik:

```properties
case.list.title=Case List
case.detail.submitReview=Submit for Review
common.action.cancel=Cancel
common.field.name=Name
```

Rule:

1. Prefix berdasarkan bounded context atau screen.
2. Pisahkan common label dari domain-specific label.
3. Jangan reuse key hanya karena teks kebetulan sama.
4. Jangan gunakan value sebagai key untuk domain state tanpa mapping jelas.

### 11.5 Jangan render enum mentah

Buruk:

```jsp
${case.status}
```

Output:

```text
PENDING_SUPERVISOR_REVIEW
```

Lebih baik:

```jsp
<fmt:message key="case.status.${case.status}" />
```

Atau lebih defensible:

```java
public record CaseView(
    String caseNo,
    String statusCode,
    String statusLabel
) {}
```

JSP:

```jsp
${case.statusLabel}
```

Kenapa view model bisa lebih baik?

- fallback bisa dikontrol,
- unknown status bisa ditangani,
- label bisa tenant-specific,
- audit/report label bisa berbeda dari UI label,
- testing lebih mudah.

---

## 12. I18N Beyond `fmt:message`

`fmt:message` bagus untuk simple i18n, tetapi enterprise i18n sering butuh lebih dari itu.

### 12.1 Tantangan yang tidak selesai hanya dengan properties

1. Pluralization:

```text
1 case
2 cases
```

2. Gender/language-specific grammar.
3. Tenant-specific terminology.
4. Agency-specific label.
5. Legal wording versioning.
6. Effective date untuk wording.
7. Translation workflow.
8. Missing translation detection.
9. Rich text translation.
10. Accessibility text.

### 12.2 Message ownership

Tidak semua text sama.

| Text type | Ownership | Storage ideal |
|---|---|---|
| Static UI label | engineering/product | resource bundle |
| Domain status label | domain/product | enum mapping/message catalog |
| Legal notice wording | legal/business | versioned template system |
| Email/SMS template | business/comms | template management |
| Validation message | application/domain | bundle + validation layer |
| Error code explanation | support/product | message catalog |

### 12.3 Jangan masukkan HTML kompleks ke properties tanpa policy

Properties:

```properties
notice.info=Please <strong>review</strong> the details.
```

JSP:

```jsp
<fmt:message key="notice.info" />
```

Risiko:

- escaping tidak jelas,
- translator bisa memasukkan HTML broken,
- XSS jika source tidak trusted,
- accessibility rusak.

Better:

```jsp
<fmt:message key="notice.info.prefix" />
<strong><fmt:message key="notice.info.emphasis" /></strong>
<fmt:message key="notice.info.suffix" />
```

Atau gunakan rich text rendering pipeline yang sanitize dan versioned.

### 12.4 Missing key handling

Jangan biarkan missing translation lolos diam-diam sampai production.

Checklist:

- build-time scan JSP keys,
- test locale coverage,
- fail fast in non-prod,
- log missing key with page/context,
- dashboard missing translation,
- fallback language policy.

---

## 13. Encoding, Escaping, dan I18N

I18N tidak bisa dipisahkan dari encoding dan escaping.

### 13.1 Properties file encoding

Di era lama, `.properties` historically sering diasumsikan ISO-8859-1 dengan unicode escape tergantung toolchain. Di modern Java/tooling, behavior bisa lebih fleksibel, tetapi tetap jangan ambigu.

Rule praktis:

- standardize encoding repository ke UTF-8,
- configure build/tools explicitly,
- test non-ASCII text,
- avoid manual unicode escape jika tidak perlu,
- verify container/runtime loading.

### 13.2 Escaping localized message

Jika message value berasal dari trusted properties:

```jsp
<fmt:message key="case.list.title" />
```

Biasanya aman sebagai static text, tetapi tetap perhatikan konteks output.

Jika parameter berasal dari user:

```jsp
<fmt:message key="welcome.message">
  <fmt:param value="${user.displayName}" />
</fmt:message>
```

Properties:

```properties
welcome.message=Welcome, {0}
```

Parameter perlu aman untuk konteks HTML. Karena tag output tidak selalu melakukan escaping seperti `c:out`, lebih aman siapkan escaped rendering atau gunakan component/tag yang jelas escaping-nya.

Safer pattern:

```jsp
<fmt:message key="welcome.prefix" />
<c:out value="${user.displayName}" />
```

Atau buat custom tag `app:message` yang jelas escaping policy-nya.

### 13.3 Context-specific escaping

Output encoding berbeda untuk:

```html
<div>TEXT</div>
```

```html
<input value="ATTRIBUTE" />
```

```html
<script>var name = "JS_STRING";</script>
```

```html
<a href="URL">link</a>
```

Jangan berpikir “localized = safe”. Localized message tetap harus cocok dengan output context.

---

## 14. XML Tags: Apa Fungsinya?

Jakarta Tags XML library menyediakan tag seperti:

| Tag | Fungsi |
|---|---|
| `x:parse` | parse XML document |
| `x:out` | output XPath result |
| `x:set` | set variable dari XPath result |
| `x:if` | condition berdasarkan XPath |
| `x:choose` / `x:when` / `x:otherwise` | branching berdasarkan XPath |
| `x:forEach` | iterate node set |
| `x:transform` | XSLT transform |
| `x:param` | parameter untuk transform |

Contoh konseptual:

```jsp
<%@ taglib prefix="x" uri="jakarta.tags.xml" %>

<x:parse xml="${xmlPayload}" var="doc" />
<x:out select="$doc/order/id" />
```

### 14.1 Kenapa XML tags dulu berguna?

Pada era JSP awal:

- banyak integration payload XML,
- REST/JSON belum dominan,
- SOAP/XML umum,
- JSP sering dipakai untuk quick integration display,
- MVC layering belum disiplin.

XML tags memberi cara cepat menampilkan data dari XML tanpa menulis Java class.

### 14.2 Kenapa XML tags sekarang sering red flag?

Karena XML parsing di view berarti JSP melakukan:

- integration interpretation,
- data extraction,
- transformation,
- error handling,
- security-sensitive XML processing.

Ini melanggar boundary view.

JSP seharusnya menerima view model yang sudah siap render, bukan raw XML payload.

---

## 15. XML Security: XXE, Entity Expansion, dan Data Exposure

XML bukan format netral. XML parsing bisa berbahaya.

Risiko umum:

1. XXE / external entity expansion.
2. Billion laughs/entity expansion denial-of-service.
3. Large XML memory pressure.
4. XPath injection-like behavior jika expression dipengaruhi user.
5. Sensitive data exposure dari raw XML.
6. Transform/XSLT security issue.

### 15.1 Jangan parse XML eksternal di JSP

Buruk:

```jsp
<x:parse xml="${param.xml}" var="doc" />
```

Sangat buruk karena:

- user mengontrol XML,
- parsing terjadi di view,
- security hardening parser tidak jelas,
- error handling buruk,
- bisa DoS.

Better:

```java
ExternalDataView view = externalPayloadService.toSafeView(xmlPayload);
request.setAttribute("externalData", view);
```

JSP:

```jsp
<c:out value="${externalData.orderId}" />
```

### 15.2 XML parsing harus di service layer

Service layer bisa mengontrol:

- parser hardening,
- schema validation,
- size limit,
- timeout,
- external entity disabled,
- safe transformation,
- error mapping,
- observability,
- audit logging.

View layer tidak ideal untuk semua itu.

---

## 16. XSLT Transform di JSP

`x:transform` memungkinkan transform XML dengan XSLT.

Contoh konseptual:

```jsp
<x:transform xml="${xmlDoc}" xslt="${stylesheet}" />
```

Ini terlihat powerful, tetapi dalam enterprise app modern biasanya harus dihindari di JSP.

### 16.1 Masalah utama

1. XSLT bisa kompleks dan menjadi second programming language.
2. Transformation cost bisa tinggi.
3. Error handling sulit.
4. Security configuration parser/transformer harus ketat.
5. XSLT template menjadi business/presentation logic tersembunyi.
6. Testing UI menjadi sulit.

### 16.2 Kapan masih masuk akal?

- legacy reporting page,
- internal admin tool kecil,
- trusted XML + trusted XSLT,
- isolated migration path,
- output bukan security-sensitive.

Tetap lebih baik transform di service layer dan kirim hasil aman ke view.

---

## 17. SQL Tags: Apa Fungsinya?

SQL tags biasanya meliputi:

| Tag | Fungsi |
|---|---|
| `sql:setDataSource` | define data source |
| `sql:query` | execute SELECT |
| `sql:update` | execute INSERT/UPDATE/DELETE |
| `sql:param` | parameter SQL |
| `sql:dateParam` | date parameter |
| `sql:transaction` | transaction block |

Contoh:

```jsp
<%@ taglib prefix="sql" uri="jakarta.tags.sql" %>

<sql:query var="cases" dataSource="${dataSource}">
  SELECT case_no, status FROM cases
</sql:query>

<c:forEach var="row" items="${cases.rows}">
  <tr>
    <td><c:out value="${row.case_no}" /></td>
    <td><c:out value="${row.status}" /></td>
  </tr>
</c:forEach>
```

Ini mungkin terlihat praktis. Tetapi untuk sistem modern, ini hampir selalu architectural smell.

---

## 18. Kenapa SQL Tags Sebaiknya Dihindari di Production Enterprise

### 18.1 Melanggar layering

JSP menjadi sekaligus:

- view,
- controller,
- repository,
- transaction coordinator,
- security decision maker,
- data mapper.

Ini membuat sistem sulit:

- dites,
- diaudit,
- diamankan,
- dipantau,
- dioptimasi,
- dimigrasikan.

### 18.2 Query tersebar di view

Kalau SQL ada di banyak JSP, maka:

- impact analysis sulit,
- index tuning sulit,
- query ownership tidak jelas,
- duplicate query meningkat,
- perubahan schema menyentuh UI files,
- code review DB logic terlewat.

### 18.3 Transaction boundary tidak jelas

```jsp
<sql:transaction>
  <sql:update>...</sql:update>
  <sql:update>...</sql:update>
</sql:transaction>
```

Masalah:

- tidak ada application service boundary,
- tidak ada domain invariant enforcement,
- tidak ada centralized error handling,
- tidak ada retry/idempotency strategy,
- audit trail bisa tidak konsisten,
- authorization bisa hanya visual.

### 18.4 Security risk

Walaupun `sql:param` membantu parameterization, SQL tags tetap rawan:

- query dibangun dari param,
- authorization bypass,
- excessive data exposure,
- update dari GET request,
- error leakage,
- credential/dataSource exposure,
- missing audit trail.

Buruk:

```jsp
<sql:query var="result" dataSource="${ds}">
  SELECT * FROM cases WHERE status = '${param.status}'
</sql:query>
```

Lebih aman dari injection tetapi masih buruk secara layering:

```jsp
<sql:query var="result" dataSource="${ds}">
  SELECT * FROM cases WHERE status = ?
  <sql:param value="${param.status}" />
</sql:query>
```

Karena validasi status, authorization, paging, projection, dan audit query tetap tidak proper.

---

## 19. Apa Alternatif SQL Tags?

### 19.1 Controller + service + repository

Controller:

```java
List<CaseListItemView> cases = caseQueryService.search(criteria, currentUser);
request.setAttribute("cases", cases);
request.getRequestDispatcher("/WEB-INF/views/case/list.jsp").forward(request, response);
```

JSP:

```jsp
<c:forEach var="case" items="${cases}">
  <tr>
    <td><c:out value="${case.caseNo}" /></td>
    <td><c:out value="${case.statusLabel}" /></td>
    <td><c:out value="${case.createdAtDisplay}" /></td>
  </tr>
</c:forEach>
```

### 19.2 Query service untuk read model

Untuk listing/reporting, tidak semua harus JPA entity. Gunakan projection/read model:

```java
public record CaseListItemView(
    String caseNo,
    String statusLabel,
    String assignedOfficer,
    String createdAtDisplay,
    boolean canView,
    boolean canAssign
) {}
```

Keuntungan:

- query terpusat,
- projection minimal,
- authorization bisa dihitung,
- formatting bisa konsisten,
- testable,
- JSP sederhana.

### 19.3 Stored procedure? Tetap jangan dari JSP

Bahkan jika database logic di stored procedure, JSP tetap tidak boleh menjadi caller langsung.

Gunakan service layer agar:

- parameter divalidasi,
- authorization dicek,
- transaction dikontrol,
- error dimapping,
- audit dicatat,
- observability tersedia.

---

## 20. SQL Tags dalam Legacy Migration

Dalam sistem lama, kamu mungkin menemukan ratusan JSP seperti:

```jsp
<sql:query var="users" dataSource="${applicationScope.ds}">
  SELECT id, name, role FROM users WHERE active = 1
</sql:query>
```

Jangan langsung rewrite semua tanpa strategi. Gunakan staged migration.

### 20.1 Inventory

Buat inventory:

| Item | Contoh |
|---|---|
| JSP file | `/WEB-INF/jsp/user/list.jsp` |
| Query type | SELECT / INSERT / UPDATE / DELETE |
| Table touched | `users`, `roles` |
| User input used | `param.status`, `param.id` |
| Auth check | ada/tidak |
| Transaction | ada/tidak |
| Output page | list/detail/action |
| Risk | low/medium/high |

### 20.2 Prioritize high-risk first

Urutan prioritas:

1. SQL update/delete/insert dari JSP.
2. Query dengan user input string interpolation.
3. Query yang menampilkan PII/sensitive data.
4. Query tanpa pagination.
5. Query di halaman public/internet-facing.
6. Query yang dipakai flow enforcement/payment/legal.
7. Query besar yang menyebabkan performance issue.

### 20.3 Strangler pattern

Langkah:

1. Extract SQL ke repository/query service.
2. Buat view model yang sama output-nya.
3. JSP tetap sama sebanyak mungkin, hanya `items` source berubah.
4. Tambahkan tests/golden HTML untuk memastikan output tidak berubah.
5. Baru refactor markup/tag usage.

Sebelum:

```jsp
<sql:query var="cases" dataSource="${ds}">
  SELECT case_no, status FROM cases
</sql:query>
```

Sesudah tahap 1:

```jsp
<c:forEach var="case" items="${cases}">
  ...
</c:forEach>
```

Controller menyediakan `cases`.

---

## 21. Formatting/I18N di JSP vs Faces

Seri ini membahas JSP dan Faces. Formatting/I18N muncul di keduanya, tetapi mekanismenya berbeda.

### 21.1 JSP/JSTL style

```jsp
<fmt:formatDate value="${case.createdAt}" pattern="dd MMM yyyy" />
<fmt:message key="case.status.open" />
```

### 21.2 Faces style

Faces biasanya memakai:

- resource bundle configured in `faces-config.xml` atau annotation/config,
- `h:outputText`,
- converter seperti `f:convertDateTime`,
- validator/converter lifecycle,
- component message handling.

Contoh Facelets:

```xml
<h:outputText value="#{caseBean.selected.createdAt}">
    <f:convertDateTime pattern="dd MMM yyyy" timeZone="UTC" />
</h:outputText>
```

Resource bundle:

```xml
<h:outputText value="#{msg['case.list.title']}" />
```

### 21.3 Jangan campur mental model sembarangan

JSTL tags di Facelets punya timing yang bisa berbeda dari component lifecycle. Ini akan dibahas lebih dalam di bagian Facelets/Faces lifecycle.

Untuk sekarang, ingat:

- JSP/JSTL adalah template/request rendering model.
- Faces adalah component tree/lifecycle model.
- Formatting di Faces sering terikat ke conversion/rendering lifecycle.
- JSTL di Facelets bisa dieksekusi pada build-time view, bukan seperti component render-time yang kamu bayangkan.

---

## 22. Practical Patterns untuk Enterprise JSP

### 22.1 Pattern: Centralized view context

Siapkan object view context:

```java
public record ViewContext(
    Locale locale,
    ZoneId zoneId,
    String datePattern,
    String dateTimePattern,
    String currencyCode
) {}
```

Controller/filter:

```java
request.setAttribute("viewContext", viewContext);
```

JSP:

```jsp
<fmt:setLocale value="${viewContext.locale}" />
<fmt:setTimeZone value="${viewContext.zoneId}" />
```

Keuntungan:

- locale/timezone policy tidak tersebar,
- testable,
- mudah audit,
- bisa tenant/user-aware.

### 22.2 Pattern: Display-ready view model for high-stakes fields

Untuk date/amount/status yang sensitif:

```java
public record EnforcementNoticeView(
    String noticeNo,
    String issuedAtDisplay,
    String effectiveDateDisplay,
    String penaltyAmountDisplay,
    String statusLabel
) {}
```

JSP:

```jsp
<td>${notice.issuedAtDisplay}</td>
<td>${notice.penaltyAmountDisplay}</td>
```

Gunakan ini untuk:

- legal documents,
- official notices,
- payment,
- audit export,
- regulatory deadline,
- external-facing correspondence.

### 22.3 Pattern: Formatting tag for consistency

Custom tag:

```jsp
<app:dateTime value="${case.createdAt}" kind="audit" />
<app:money value="${fee.amount}" currency="${fee.currencyCode}" />
<app:status code="${case.status}" domain="case" />
```

Tag internal bisa memakai `fmt:*`, tetapi caller tidak perlu tahu detail.

Keuntungan:

- format standard di seluruh aplikasi,
- timezone policy centralized,
- escaping policy centralized,
- fallback behavior centralized.

### 22.4 Pattern: Message facade

Daripada seluruh JSP bebas memanggil key apapun:

```jsp
<fmt:message key="${param.key}" />
```

Jangan lakukan itu.

Lebih aman:

```jsp
<app:message key="case.list.title" />
```

Custom tag bisa:

- validate allowed key prefix,
- escape output,
- log missing key,
- apply fallback,
- support tenant override.

---

## 23. Anti-Patterns Penting

### 23.1 Date formatting scattered everywhere

```jsp
<fmt:formatDate value="${createdAt}" pattern="dd/MM/yyyy" />
<fmt:formatDate value="${updatedAt}" pattern="MM/dd/yyyy" />
<fmt:formatDate value="${approvedAt}" pattern="yyyy-MM-dd" />
```

Masalah:

- inconsistent UX,
- inconsistent report,
- sulit change policy,
- regression tinggi.

### 23.2 Business decision from formatted string

```jsp
<c:if test="${case.dueDateDisplay < todayDisplay}">
  Overdue
</c:if>
```

Salah. Compare domain value di service layer, bukan display string di JSP.

### 23.3 User-controlled bundle/key

```jsp
<fmt:message key="${param.messageKey}" />
```

Risiko:

- information disclosure,
- broken UI,
- abuse internal key naming,
- unpredictable output.

### 23.4 Raw XML in page

```jsp
<x:parse xml="${externalResponse}" var="doc" />
```

Masalah:

- view melakukan integration parsing,
- XML security tidak jelas,
- error handling buruk.

### 23.5 SQL in JSP

```jsp
<sql:update>
  DELETE FROM users WHERE id = ?
  <sql:param value="${param.id}" />
</sql:update>
```

Ini bukan “kurang ideal”. Ini harus dianggap critical design flaw kecuali berada di throwaway internal prototype.

---

## 24. Security Checklist

Untuk formatting/i18n/XML/SQL tags, cek:

### 24.1 Formatting/I18N

- Apakah user-controlled value di-output dengan escaping yang sesuai?
- Apakah localized message mengandung HTML?
- Apakah parameter message dari user di-escape?
- Apakah missing key terdeteksi?
- Apakah locale input di-whitelist?
- Apakah timezone input di-whitelist?
- Apakah date/amount legal menggunakan format resmi?
- Apakah displayed timestamp menyebut timezone jika perlu?

### 24.2 XML

- Apakah JSP mem-parse XML dari user/external source?
- Apakah XML parser hardening jelas?
- Apakah payload size dibatasi?
- Apakah entity expansion dicegah?
- Apakah XPath expression dipengaruhi user input?
- Apakah raw XML bisa mengekspos data sensitif?

### 24.3 SQL

- Apakah ada SQL tag di production JSP?
- Apakah ada dynamic SQL dari `param`?
- Apakah update/delete/insert dilakukan dari JSP?
- Apakah pagination/filtering aman?
- Apakah authorization dilakukan sebelum query?
- Apakah audit trail dicatat?
- Apakah query menampilkan PII tanpa masking?

---

## 25. Performance Checklist

### 25.1 Formatting

- Hindari formatting berat dalam nested loop besar.
- Jangan repeatedly resolve bundle untuk setiap cell jika bisa centralized.
- Jangan memformat ribuan row di JSP tanpa pagination.
- Jangan melakukan expensive getter di EL yang memicu DB/API call.
- Pertimbangkan precomputed display fields untuk large table.

### 25.2 XML

- Jangan parse XML besar di JSP.
- Jangan transform XSLT per request tanpa caching/limit.
- Jangan parse payload yang sama berulang di include/tag.

### 25.3 SQL

- SQL di JSP membuat query performance sulit diobservasi.
- Query tanpa pagination bisa menghancurkan page rendering.
- N+1 bisa terjadi di JSP jika EL getter memicu lazy load.
- Query tuning harus dipindah ke repository/query service.

---

## 26. Testing Strategy

### 26.1 Test resource bundle completeness

Buat test yang memastikan key penting tersedia di semua locale:

```java
Set<String> baseKeys = keysOf("messages.properties");
Set<String> idKeys = keysOf("messages_id.properties");
assertTrue(idKeys.containsAll(baseKeys));
```

### 26.2 Test date/number rendering

Jangan hanya test satu locale.

Test matrix:

| Field | Locale | Timezone | Expected |
|---|---|---|---|
| audit timestamp | `en_US` | UTC | includes UTC |
| user event | `id_ID` | Asia/Jakarta | localized display |
| legal date | agency locale | agency timezone | official pattern |
| amount | `en_SG` | n/a | currency standard |

### 26.3 Golden HTML testing

Untuk JSP legacy, golden output bisa berguna:

1. render JSP dengan fixture data,
2. parse HTML,
3. assert important text/attributes,
4. avoid brittle whitespace comparison.

### 26.4 Migration tests for SQL tag removal

Sebelum menghapus SQL tag:

- capture old output,
- build service query output,
- compare visible rows/columns,
- compare authorization behavior,
- add pagination/limit if missing,
- verify no sensitive fields leaked.

---

## 27. Java 8 sampai Java 25: Dampak Praktis

### 27.1 Java 8 legacy

Banyak aplikasi Java 8 masih memakai:

- JSP/JSTL 1.2,
- `javax.servlet.*`,
- `javax.servlet.jsp.*`,
- JSF 2.x,
- `java.util.Date`,
- `SimpleDateFormat` di utility lama.

Risiko:

- mutable date/time types,
- timezone ambiguity,
- outdated libraries,
- old taglib URI,
- scriptlet/SQL tag legacy.

### 27.2 Java 11/17 transition

Biasanya mulai ada:

- stronger dependency hygiene,
- module-related awareness,
- container upgrade,
- beginning of Jakarta migration,
- more use of `java.time`.

### 27.3 Java 21/25 modern baseline

Modern stack cenderung:

- Jakarta EE 10/11+,
- `jakarta.*`,
- Java records for view model,
- `java.time` domain types,
- virtual threads at server/runtime layer where supported,
- stricter observability and security baseline.

Tetapi JSP/JSTL tetap legacy-oriented. Jadi modern Java bukan berarti JSP otomatis modern. Yang membuatnya modern adalah **architecture boundary**, bukan JDK version saja.

### 27.4 Migration rule

Saat migrasi:

1. Jangan hanya ubah URI/import.
2. Audit penggunaan `fmt:parse*`, `x:*`, dan `sql:*`.
3. Pindahkan parsing, XML processing, dan SQL ke service layer.
4. Standardize locale/timezone policy.
5. Tambahkan tests untuk high-stakes rendering.
6. Jadikan JSP lebih dumb, bukan lebih pintar.

---

## 28. Decision Matrix: Use or Avoid?

| Feature | Use? | Reason |
|---|---|---|
| `fmt:message` untuk label static | Ya | Cocok untuk i18n sederhana |
| `fmt:formatDate` untuk display biasa | Ya, dengan timezone policy | View formatting valid |
| `fmt:formatNumber` untuk display biasa | Ya, dengan currency/rounding clarity | View formatting valid |
| `fmt:parseDate` untuk user input | Hindari | Parsing/validation harus di controller |
| `fmt:parseNumber` untuk user input | Hindari | Locale/security/error handling |
| `fmt:setLocale` dari validated view context | Ya | Centralized locale policy |
| `fmt:setLocale` langsung dari `param` | Hindari | User-controlled state |
| `x:parse` XML trusted kecil | Terbatas | Legacy/prototype only |
| `x:parse` external/user XML | Hindari keras | XML security + layering |
| `x:transform` di JSP | Umumnya hindari | Complexity/security/performance |
| `sql:query` untuk prototype | Boleh sementara | Quick demo only |
| `sql:update` di production JSP | Jangan | Critical layering/security smell |
| SQL tags untuk enterprise app | Jangan | Repository/service layer lebih benar |

---

## 29. Practical Refactoring Examples

### 29.1 Refactor scattered date formatting

Sebelum:

```jsp
<fmt:formatDate value="${case.createdAt}" pattern="dd/MM/yyyy" />
<fmt:formatDate value="${case.updatedAt}" pattern="MM-dd-yyyy" />
```

Sesudah dengan custom tag:

```jsp
<app:date value="${case.createdAt}" kind="standard" />
<app:date value="${case.updatedAt}" kind="standard" />
```

Atau view model:

```jsp
${case.createdAtDisplay}
${case.updatedAtDisplay}
```

### 29.2 Refactor message key mapping

Sebelum:

```jsp
<fmt:message key="case.status.${case.status}" />
```

Sesudah:

```java
caseView.statusLabel = messageResolver.caseStatus(case.status(), locale);
```

JSP:

```jsp
<c:out value="${case.statusLabel}" />
```

### 29.3 Refactor XML parsing

Sebelum:

```jsp
<x:parse xml="${externalResponse}" var="doc" />
<x:out select="$doc/response/name" />
```

Sesudah:

```java
ExternalPartyView party = externalPartyMapper.toView(externalResponse);
request.setAttribute("party", party);
```

JSP:

```jsp
<c:out value="${party.name}" />
```

### 29.4 Refactor SQL query

Sebelum:

```jsp
<sql:query var="rows" dataSource="${ds}">
  SELECT case_no, status, created_at FROM cases WHERE status = ?
  <sql:param value="${param.status}" />
</sql:query>
```

Sesudah:

```java
CaseSearchCriteria criteria = criteriaBinder.bind(request);
List<CaseListItemView> rows = caseQueryService.search(criteria, currentUser);
request.setAttribute("rows", rows);
```

JSP:

```jsp
<c:forEach var="row" items="${rows}">
  <tr>
    <td><c:out value="${row.caseNo}" /></td>
    <td><c:out value="${row.statusLabel}" /></td>
    <td><c:out value="${row.createdAtDisplay}" /></td>
  </tr>
</c:forEach>
```

---

## 30. Top 1% Engineering Perspective

Developer biasa bertanya:

> Tag apa yang dipakai untuk format date?

Engineer kuat bertanya:

> Date ini konsepnya apa? Instant, business date, atau local event time? Siapa yang melihat? Timezone mana yang authoritative? Format ini sekadar UI atau legal/report contract? Kalau locale berubah, apakah makna berubah? Bagaimana test-nya?

Developer biasa bertanya:

> Bisa query DB dari JSP pakai JSTL SQL?

Engineer kuat bertanya:

> Kenapa view layer diberi akses persistence? Siapa enforce authorization? Di mana transaction boundary? Bagaimana audit trail? Bagaimana query diobservasi? Bagaimana migration kalau schema berubah?

Developer biasa bertanya:

> Bisa parse XML di JSP?

Engineer kuat bertanya:

> XML itu trusted atau external? Parser hardening di mana? Size limit? Schema validation? Apakah view harus memahami integration payload?

Inilah perbedaan level:

- bukan hanya tahu fitur,
- tetapi tahu **konsekuensi arsitektural fitur**.

---

## 31. Ringkasan

Dalam part ini kita belajar:

1. Formatting dan i18n bukan dekorasi; pada sistem enterprise bisa menjadi contract.
2. `fmt:*` berguna untuk presentational formatting, tetapi tidak boleh menjadi business rule layer.
3. Locale harus dipilih dari policy yang jelas, bukan langsung dari input user.
4. Timezone adalah sumber bug besar; bedakan timestamp absolut, business date, dan event-local time.
5. `fmt:formatDate` dan `fmt:formatNumber` boleh dipakai, tetapi harus eksplisit untuk field penting.
6. `fmt:parseDate` dan `fmt:parseNumber` untuk user input sebaiknya dihindari di production enterprise.
7. `fmt:message` cocok untuk label sederhana, tetapi enterprise i18n butuh ownership, fallback, testing, dan sometimes message service.
8. XML tags ada untuk XML manipulation, tetapi parsing XML di JSP biasanya melanggar boundary dan membuka risiko security.
9. SQL tags ada secara historis, tetapi hampir selalu harus dihindari di sistem modern production.
10. Refactoring terbaik adalah membuat JSP semakin dumb: menerima view model siap render, bukan raw input/raw XML/raw database access.

---

## 32. Checklist Praktis

Sebelum approve JSP yang memakai formatting/i18n/XML/SQL tags, cek:

```text
[ ] Locale berasal dari policy yang jelas, bukan param mentah.
[ ] Timezone eksplisit untuk timestamp yang penting.
[ ] Format date/number konsisten dengan domain dan audience.
[ ] Tidak ada parsing user input di JSP.
[ ] Message key tidak dikontrol user.
[ ] Localized message dengan parameter user aman dari XSS.
[ ] Tidak ada raw XML external/user diparse di JSP.
[ ] Tidak ada SQL query/update di JSP production.
[ ] View model sudah menyimpan field high-stakes dalam bentuk display-safe jika perlu.
[ ] Missing translation bisa dideteksi di non-prod/test.
[ ] Large table tidak melakukan formatting/parsing berat tanpa pagination.
[ ] Security reviewer bisa memahami data flow tanpa membaca SQL/XML di JSP.
```

---

## 33. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
09-custom-tags-and-tag-files-reusable-view-components.md
```

Kita akan membahas bagaimana membuat reusable view component di JSP melalui:

- classic tag handler,
- simple tag handler,
- tag files,
- attributes,
- fragments,
- dynamic attributes,
- TLD,
- packaging tag library,
- tag pooling,
- thread-safety,
- enterprise UI component design.

Bagian berikutnya penting karena setelah memahami `fmt:*`, `x:*`, dan `sql:*`, kita akan belajar cara membuat **abstraksi view internal** seperti:

```jsp
<app:dateTime value="${case.createdAt}" kind="audit" />
<app:status value="${case.status}" domain="case" />
<app:pagination page="${page}" />
<app:authorizedAction action="assign-case" subject="${case.id}" />
```

Dengan kata lain: bukan hanya memakai tag bawaan, tetapi mulai mendesain tag library sendiri yang aman, reusable, testable, dan sesuai arsitektur enterprise.

---

## 34. Referensi

- Jakarta Standard Tag Library 3.0 Specification — https://jakarta.ee/specifications/tags/3.0/
- Jakarta Tags 3.0 Tagdocs: Formatting — https://jakarta.ee/specifications/tags/3.0/tagdocs/fmt/tld-summary
- Jakarta Tags 3.0 Tagdocs: Core — https://jakarta.ee/specifications/tags/3.0/tagdocs/c/tld-summary
- Jakarta Standard Tag Library overview — https://jakarta.ee/specifications/tags/
- Jakarta Expression Language 6.0 — https://jakarta.ee/specifications/expression-language/6.0/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 7 — Jakarta Standard Tag Library Core Tags: View Control Abstraction](./07-jakarta-standard-tag-library-core-tags-view-control-abstraction.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — Custom Tags and Tag Files: Reusable View Components Before Component Frameworks](./09-custom-tags-and-tag-files-reusable-view-components.md)

</div>