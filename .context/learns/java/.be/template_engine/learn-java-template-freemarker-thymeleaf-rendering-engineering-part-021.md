# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-021

# Part 21 — Internationalization, Localization, Locale, Timezone, and Formatting

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Fokus: Java 8 hingga Java 25  
> Engine utama: FreeMarker, Thymeleaf  
> Level: Advanced / production engineering

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- FreeMarker architecture, syntax, macro, security, error handling, performance, dan integration.
- Thymeleaf architecture, expressions, DOM transformation, forms, fragments, security, performance.
- Email template engineering.
- Document generation untuk HTML-to-PDF, DOCX, XML, CSV, fixed-width text, dan output tekstual lain.

Part ini masuk ke salah satu sumber bug paling halus di sistem template enterprise:

> output yang secara teknis berhasil dirender, tetapi secara bahasa, format angka, mata uang, tanggal, zona waktu, atau legal meaning-nya salah.

Dalam sistem sederhana, i18n sering dianggap sebagai `messages.properties` dan `#{label.name}`. Dalam sistem production yang serius, i18n/l10n adalah kombinasi dari:

- bahasa,
- negara/wilayah,
- zona waktu,
- calendar system,
- number system,
- currency,
- legal wording,
- fallback,
- template version,
- auditability,
- deterministic rendering,
- user preference,
- organization policy,
- output channel.

Part ini tidak membahas i18n sebagai kosmetik. Kita membahasnya sebagai **rendering correctness boundary**.

---

## 1. Core Mental Model

### 1.1 Internationalization vs Localization

Istilah ini sering dicampur, padahal berbeda.

**Internationalization / i18n** adalah kemampuan sistem untuk mendukung banyak bahasa/wilayah tanpa mengubah core code.

Contoh i18n:

- message bundle per bahasa,
- formatter berbasis locale,
- template yang tidak hardcode format tanggal,
- template yang tidak hardcode currency symbol,
- template yang tidak menggabungkan kalimat dengan string concatenation yang sulit diterjemahkan.

**Localization / l10n** adalah hasil adaptasi konkret untuk bahasa/wilayah tertentu.

Contoh l10n:

- `en-SG` menggunakan English Singapore,
- `id-ID` menggunakan Bahasa Indonesia,
- `ja-JP` menggunakan Japanese date/number convention,
- format mata uang mengikuti region,
- legal wording berbeda untuk jurisdiction tertentu,
- template surat berbeda untuk agency tertentu.

Mental model:

```text
Internationalization = sistem siap dilokalisasi
Localization         = varian nyata untuk locale/jurisdiction tertentu
```

Kesalahan umum:

```text
"Kita sudah punya i18n karena label UI pakai properties file."
```

Itu hanya satu bagian kecil. Sistem masih bisa salah bila:

- tanggal dirender dengan timezone server,
- currency memakai default JVM locale,
- email subject tidak dilokalisasi,
- PDF memakai template English tetapi body campur Bahasa Indonesia,
- workflow notification memakai locale user saat harus memakai locale organization,
- audit trail tidak menyimpan locale/timezone saat rendering.

---

## 2. Locale Sebagai Rendering Input Eksplisit

### 2.1 Jangan Anggap Locale Sebagai Global State

Dalam Java, banyak API formatting bisa memakai default locale JVM. Ini berbahaya untuk aplikasi server.

Contoh buruk:

```java
NumberFormat formatter = NumberFormat.getCurrencyInstance();
String value = formatter.format(amount);
```

Kode ini memakai default locale process/JVM. Di server, default locale bisa dipengaruhi oleh:

- OS image,
- container base image,
- JVM startup option,
- cloud runtime,
- environment variable,
- deploy region,
- perubahan image patching.

Output menjadi tidak deterministic.

Contoh lebih benar:

```java
Locale locale = Locale.forLanguageTag("en-SG");
NumberFormat formatter = NumberFormat.getCurrencyInstance(locale);
String value = formatter.format(amount);
```

Untuk template rendering, locale harus dianggap sebagai bagian dari `RenderContext`.

```java
public record RenderContext(
    Locale locale,
    ZoneId zoneId,
    Clock clock,
    String templateId,
    String templateVersion,
    OutputFormat outputFormat
) {}
```

Invariant:

```text
Same template + same model + same locale + same zoneId + same template version
= same output
```

Bila locale/timezone tidak eksplisit, invariant ini rusak.

---

### 2.2 Locale Bukan Hanya Language

`Locale` sering dianggap hanya bahasa. Padahal locale bisa membawa:

- language,
- script,
- country/region,
- variant,
- Unicode locale extensions.

Contoh:

```java
Locale id = Locale.forLanguageTag("id-ID");
Locale enSg = Locale.forLanguageTag("en-SG");
Locale zhHansCn = Locale.forLanguageTag("zh-Hans-CN");
Locale zhHantTw = Locale.forLanguageTag("zh-Hant-TW");
```

Perbedaan `zh-Hans-CN` dan `zh-Hant-TW` bukan kosmetik. Script dan region dapat mengubah:

- tulisan,
- format,
- wording,
- expectation user,
- legal phrase.

Untuk sistem enterprise, gunakan language tag BCP 47 style, bukan hanya `new Locale("en")`.

```java
Locale locale = Locale.forLanguageTag(userPreferredLanguageTag);
```

---

## 3. Timezone Sebagai Rendering Input Eksplisit

### 3.1 Timezone Bukan Locale

Locale menjawab:

```text
Bagaimana sesuatu ditampilkan?
```

Timezone menjawab:

```text
Waktu absolut ini ditampilkan sebagai jam berapa di wilayah mana?
```

Contoh:

```text
Instant: 2026-06-19T03:00:00Z
Asia/Jakarta: 2026-06-19 10:00
Asia/Singapore: 2026-06-19 11:00
Europe/London: tergantung DST
```

Locale `en-SG` tidak otomatis berarti timezone `Asia/Singapore`. User bisa memakai English Singapore tetapi sedang bekerja untuk office di Jakarta. Organization bisa memiliki official timezone berbeda dari user timezone.

Jangan gabungkan locale dan timezone ke satu konsep.

```java
public record RenderLocaleContext(
    Locale languageLocale,
    ZoneId displayZone,
    Currency currency,
    String jurisdiction
) {}
```

---

### 3.2 Server Timezone Adalah Sumber Bug

Contoh buruk:

```java
LocalDateTime now = LocalDateTime.now();
```

Bug:

- memakai timezone default server,
- tidak jelas apakah ini user time atau system time,
- sulit dites,
- hasil berubah antar environment.

Contoh lebih benar:

```java
Instant now = clock.instant();
ZonedDateTime userTime = now.atZone(renderContext.zoneId());
```

Untuk output dokumen/email, jangan hanya menyimpan string tanggal. Simpan:

```text
- source instant
- display zone
- locale
- format policy/template version
- rendered text if output must be immutable
```

---

## 4. Data Time Model untuk Rendering

### 4.1 Gunakan `java.time` Sebagai Model Utama

Sejak Java 8, model waktu yang paling sehat adalah `java.time`:

- `Instant` untuk waktu absolut.
- `LocalDate` untuk tanggal tanpa waktu.
- `LocalTime` untuk jam tanpa tanggal.
- `LocalDateTime` untuk tanggal+waktu tanpa zona.
- `OffsetDateTime` untuk tanggal+waktu dengan offset.
- `ZonedDateTime` untuk tanggal+waktu dengan zona penuh.
- `Duration` untuk durasi berbasis detik/nano.
- `Period` untuk periode kalender.

Prinsip:

```text
Persist absolute event time as Instant.
Render with explicit ZoneId.
Use LocalDate only when business concept truly has no time zone.
```

Contoh benar:

```java
public record AppointmentView(
    Instant scheduledAt,
    ZoneId displayZone
) {
    public ZonedDateTime scheduledAtDisplay() {
        return scheduledAt.atZone(displayZone);
    }
}
```

Contoh yang riskan:

```java
public record AppointmentView(LocalDateTime scheduledAt) {}
```

`LocalDateTime` tidak menyimpan offset atau timezone. Untuk event nyata, ia ambigu.

---

### 4.2 Kapan `LocalDate` Benar?

`LocalDate` benar untuk konsep seperti:

- tanggal lahir,
- tanggal dokumen,
- due date berbasis kalender lokal,
- effective date legal,
- expiry date yang didefinisikan oleh business calendar.

Contoh:

```java
public record LicenseView(
    LocalDate effectiveDate,
    LocalDate expiryDate
) {}
```

Tetapi bahkan `LocalDate` bisa punya konteks:

```text
License expires on 2026-06-19 in which jurisdiction's calendar/time boundary?
```

Untuk regulatory system, due date sering mengikuti timezone agency/jurisdiction, bukan timezone user.

---

## 5. Formatting: Render di Java atau Template?

Ada dua pendekatan.

### 5.1 Template Formatting

Model memberikan raw value:

```java
model.put("amount", new BigDecimal("1234.50"));
model.put("issuedAt", Instant.parse("2026-06-19T03:00:00Z"));
```

Template melakukan formatting:

```ftl
${amount}
${issuedAt?datetime}
```

atau di Thymeleaf:

```html
<span th:text="${#numbers.formatDecimal(amount, 1, 2)}"></span>
```

Kelebihan:

- template lebih fleksibel,
- formatting dekat dengan presentation,
- bisa berbeda per output.

Kekurangan:

- logic tersebar,
- testing lebih sulit,
- formatter bisa tidak konsisten antar template,
- template author perlu paham formatting API,
- raw value mungkin tidak cocok untuk engine tertentu.

---

### 5.2 Java-side Formatting / Preformatted View Model

Model memberikan string final:

```java
public record InvoiceView(
    String totalAmountText,
    String issuedDateText,
    String dueDateText
) {}
```

Template hanya menampilkan:

```ftl
${invoice.totalAmountText}
${invoice.issuedDateText}
```

Kelebihan:

- deterministic,
- mudah dites,
- template sederhana,
- security lebih mudah dikontrol,
- cocok untuk legal document.

Kekurangan:

- model lebih verbose,
- perubahan format butuh Java change,
- reuse antar channel bisa lebih sulit.

---

### 5.3 Rule of Thumb

Gunakan **template formatting** untuk:

- UI sederhana,
- label umum,
- non-legal formatting,
- format yang memang presentation-specific.

Gunakan **Java-side formatting** untuk:

- email legal,
- PDF regulatory,
- correspondence resmi,
- audit-sensitive output,
- multi-channel consistency,
- output yang harus reproducible.

Top 1% heuristic:

```text
If wrong formatting can create business/legal/regulatory ambiguity,
format in Java/presenter layer and test it explicitly.
```

---

## 6. Message Bundle dan Parameterized Messages

### 6.1 Jangan Compose Kalimat Dengan Concatenation

Contoh buruk:

```html
<span th:text="'Hello ' + ${user.name} + ', your application is approved'"></span>
```

Masalah:

- urutan kata berbeda antar bahasa,
- punctuation berbeda,
- gender/plural bisa berbeda,
- translator tidak melihat kalimat utuh,
- sulit audit.

Contoh lebih benar:

```properties
application.approved=Hello {0}, your application is approved.
```

Template:

```html
<p th:text="#{application.approved(${user.name})}"></p>
```

Atau FreeMarker dengan message resolver custom:

```ftl
${msg("application.approved", user.name)}
```

Pesan harus menjadi unit semantik, bukan potongan kata.

---

### 6.2 Message Key Naming

Buruk:

```properties
label1=Submit
label2=Cancel
msg.error=Invalid
```

Lebih baik:

```properties
case.search.button.submit=Search
case.search.button.reset=Reset
case.validation.referenceNumber.required=Reference number is required.
correspondence.approval.subject=Your application has been approved
correspondence.approval.greeting=Dear {0},
```

Key harus stabil, semantic, dan tidak terlalu tergantung pada wording sekarang.

Jangan jadikan text English sebagai key:

```properties
Your application has been approved=Permohonan Anda telah disetujui
```

Ini rapuh. Jika English berubah, key berubah.

---

### 6.3 Parameter Message: Named vs Positional

Java `MessageFormat` secara umum memakai positional parameter:

```properties
case.escalated=Case {0} was escalated by {1} on {2}.
```

Kelemahan:

- urutan angka sulit dibaca,
- translator bisa salah urutan,
- refactoring rawan.

Alternatif dalam sistem internal adalah membuat abstraction sendiri:

```java
messageResolver.resolve(
    "case.escalated",
    locale,
    Map.of(
        "caseNo", caseNo,
        "actorName", actorName,
        "date", dateText
    )
);
```

Lalu bisa dipetakan ke ICU MessageFormat atau engine lain bila diperlukan.

Untuk sistem enterprise besar, pertimbangkan named parameter abstraction meskipun underlying implementation tetap ResourceBundle/MessageSource.

---

## 7. Pluralization Problem

### 7.1 Plural Bukan Sekadar `s`

Contoh buruk:

```text
You have ${count} item(s).
```

Masalah:

- tidak natural,
- tidak berlaku di semua bahasa,
- plural rule berbeda antar bahasa.

English:

```text
0 items
1 item
2 items
```

Bahasa lain bisa memiliki kategori plural berbeda. Beberapa bahasa memiliki bentuk untuk one/few/many/other.

### 7.2 Strategy Realistis

Untuk aplikasi sederhana:

```properties
notification.count.zero=You have no notifications.
notification.count.one=You have 1 notification.
notification.count.many=You have {0} notifications.
```

Java memilih key:

```java
String key = switch (count) {
    case 0 -> "notification.count.zero";
    case 1 -> "notification.count.one";
    default -> "notification.count.many";
};
```

Untuk sistem multi-language besar, gunakan library/plural message system yang mendukung CLDR/ICU-style plural rules.

Namun prinsipnya tetap:

```text
Plural selection should be a localization concern,
not ad-hoc string concatenation inside template.
```

---

## 8. Currency Formatting

### 8.1 Currency Tidak Sama Dengan Locale

Contoh:

```java
Locale locale = Locale.forLanguageTag("en-SG");
Currency currency = Currency.getInstance("SGD");
```

Locale memberi format. Currency memberi mata uang.

User bisa memakai locale `en-US`, tetapi invoice dalam `SGD` atau `IDR`.

Jangan ambil currency hanya dari locale kecuali business rule memang begitu.

```java
public record MoneyView(
    BigDecimal amount,
    Currency currency,
    Locale locale
) {}
```

### 8.2 Monetary Amount Perlu Domain Type

Buruk:

```java
BigDecimal amount;
String currency;
```

Lebih baik:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
    }
}
```

Untuk rendering:

```java
public final class MoneyFormatter {
    public String format(Money money, Locale locale) {
        NumberFormat nf = NumberFormat.getCurrencyInstance(locale);
        nf.setCurrency(money.currency());
        return nf.format(money.amount());
    }
}
```

Hati-hati:

- fraction digits berbeda per currency,
- rounding policy bukan formatting policy semata,
- accounting negative format bisa berbeda,
- regulatory document mungkin butuh `SGD 1,234.50`, bukan `$1,234.50`.

---

## 9. Number Formatting

### 9.1 Decimal Separator dan Grouping Separator

Contoh:

```text
1,234.56  // common en-US/en-SG style
1.234,56  // common in several European/Indonesian contexts depending locale data
```

Jangan parse number dari rendered string untuk business logic.

```text
Raw numeric value -> business computation
Formatted string  -> human output only
```

### 9.2 BigDecimal untuk Money dan Precision-sensitive Output

Jangan gunakan `double` untuk money:

```java
// buruk
Double total = 0.1 + 0.2;
```

Gunakan `BigDecimal` dan rounding eksplisit:

```java
BigDecimal tax = subtotal.multiply(rate).setScale(2, RoundingMode.HALF_UP);
```

Rendering bukan tempat untuk memperbaiki presisi yang salah di domain layer.

---

## 10. Date/Time Formatting

### 10.1 Format ISO vs Human Format

Untuk machine-readable output:

```text
2026-06-19T03:00:00Z
```

Untuk human-readable output:

```text
19 Jun 2026, 11:00 AM SGT
```

Untuk audit/regulatory output:

```text
19 June 2026, 11:00:00 Singapore Time (UTC+08:00)
```

Jangan gunakan satu format untuk semua kebutuhan.

### 10.2 Display Timezone Name

Output:

```text
2026-06-19 11:00
```

sering tidak cukup. Untuk dokumen resmi, sertakan timezone:

```text
19 June 2026, 11:00 Singapore Time (UTC+08:00)
```

Karena bila penerima berada di wilayah lain, jam tanpa timezone bisa ambigu.

### 10.3 DST dan Future Time

Zona seperti `Europe/London` memiliki daylight saving. Offset bisa berubah tergantung tanggal.

Jangan simpan hanya offset `+01:00` bila konsep bisnis memerlukan timezone rules masa depan. Gunakan `ZoneId`:

```java
ZoneId zone = ZoneId.of("Europe/London");
ZonedDateTime event = instant.atZone(zone);
```

Offset adalah hasil untuk waktu tertentu. ZoneId adalah rule set.

---

## 11. FreeMarker i18n, Locale, Timezone, and Formatting

### 11.1 Configuration-level Settings

FreeMarker memiliki settings seperti:

- `locale`,
- `time_zone`,
- `number_format`,
- `date_format`,
- `time_format`,
- `datetime_format`,
- `boolean_format`,
- `output_format`,
- `default_encoding`.

Contoh setup:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setDefaultEncoding("UTF-8");
cfg.setLocale(Locale.forLanguageTag("en-SG"));
cfg.setTimeZone(TimeZone.getTimeZone("Asia/Singapore"));
cfg.setNumberFormat("computer");
cfg.setDateFormat("iso");
cfg.setTimeFormat("iso");
cfg.setDateTimeFormat("iso");
```

Namun hati-hati: `Configuration` biasanya singleton dan shared. Bila satu render request punya locale/timezone berbeda, jangan mengubah global configuration per request secara mutating.

Gunakan environment/render-level setting atau siapkan context secara benar.

---

### 11.2 Jangan Mutate Shared Configuration Per Request

Buruk:

```java
public String render(Locale locale) {
    cfg.setLocale(locale); // dangerous in multi-threaded app
    Template t = cfg.getTemplate("mail.ftlh");
    ...
}
```

Masalah:

- race condition,
- request A bisa mempengaruhi request B,
- output nondeterministic.

Lebih aman:

- pilih template dengan locale eksplisit,
- gunakan localized lookup bila sesuai,
- pass locale/timezone sebagai bagian model/context,
- gunakan `Environment` setting secara scoped bila perlu,
- atau buat renderer abstraction yang tidak mengubah shared global state saat render concurrent.

---

### 11.3 Message Resolver untuk FreeMarker

FreeMarker tidak memaksa satu cara i18n. Dalam Spring app, gunakan `MessageSource` dan expose function aman.

Contoh:

```java
public final class MessageMethod implements TemplateMethodModelEx {
    private final MessageSource messageSource;
    private final Locale locale;

    public MessageMethod(MessageSource messageSource, Locale locale) {
        this.messageSource = messageSource;
        this.locale = locale;
    }

    @Override
    public Object exec(List arguments) throws TemplateModelException {
        if (arguments.isEmpty()) {
            throw new TemplateModelException("Message key is required");
        }

        String key = String.valueOf(arguments.get(0));
        Object[] args = arguments.subList(1, arguments.size()).toArray();
        return messageSource.getMessage(key, args, locale);
    }
}
```

Model:

```java
Map<String, Object> model = new HashMap<>();
model.put("msg", new MessageMethod(messageSource, locale));
```

Template:

```ftl
<h1>${msg("invoice.title")}</h1>
<p>${msg("invoice.greeting", customer.displayName)}</p>
```

Keamanan:

- function ini hanya resolve message,
- tidak expose `ApplicationContext`,
- tidak expose service arbitrary,
- locale fixed per render.

---

### 11.4 Formatting Helper untuk FreeMarker

Untuk high-stakes output, buat helper yang sempit.

```java
public final class RenderFormatters {
    private final Locale locale;
    private final ZoneId zoneId;

    public RenderFormatters(Locale locale, ZoneId zoneId) {
        this.locale = locale;
        this.zoneId = zoneId;
    }

    public String date(LocalDate date) {
        return DateTimeFormatter
            .ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .format(date);
    }

    public String instant(Instant instant) {
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM)
            .withLocale(locale)
            .withZone(zoneId)
            .format(instant);
    }

    public String money(BigDecimal amount, Currency currency) {
        NumberFormat nf = NumberFormat.getCurrencyInstance(locale);
        nf.setCurrency(currency);
        return nf.format(amount);
    }
}
```

Template:

```ftl
${fmt.date(invoice.issueDate)}
${fmt.money(invoice.total.amount, invoice.total.currency)}
```

Catatan: expose hanya method formatting yang aman, bukan seluruh utility service besar.

---

## 12. Thymeleaf i18n, Locale, Timezone, and Formatting

### 12.1 Message Expressions

Thymeleaf memakai `#{...}` untuk message expression.

```html
<h1 th:text="#{invoice.title}">Invoice</h1>
<p th:text="#{invoice.greeting(${customer.displayName})}">Dear customer</p>
```

Dengan Spring integration, message biasanya resolved via Spring `MessageSource`.

### 12.2 Utility Objects

Thymeleaf menyediakan utility objects untuk formatting, seperti:

```html
<span th:text="${#numbers.formatDecimal(invoice.total, 1, 2)}"></span>
<span th:text="${#temporals.format(invoice.issueDate, 'dd MMM yyyy')}"></span>
```

Namun untuk output yang sangat penting, jangan terlalu banyak menyebar pattern format di banyak template. Lebih baik:

```html
<span th:text="${invoice.totalText}"></span>
<span th:text="${invoice.issueDateText}"></span>
```

atau custom formatter bean/expression object dengan policy terpusat.

---

### 12.3 Locale Resolver di Spring MVC

Pada aplikasi web Spring, locale bisa berasal dari:

- `Accept-Language` header,
- session,
- cookie,
- user profile,
- request parameter,
- tenant/organization policy.

Jangan otomatis percaya `Accept-Language` untuk semua output.

Contoh policy:

```text
UI language             -> user preference, fallback Accept-Language
Email language          -> user communication preference
Official notice language -> agency/jurisdiction policy
Audit export language   -> system/agency default
```

Satu user bisa melihat UI dalam Bahasa Indonesia tetapi menerima official document dalam English bila jurisdiction mewajibkan English.

---

## 13. Multi-language Template Strategy

Ada tiga strategi utama.

### 13.1 One Template, Message Bundle Only

Template sama, semua teks dari bundle.

```html
<h1 th:text="#{approval.title}"></h1>
<p th:text="#{approval.body(${caseNo}, ${dateText})}"></p>
```

Kelebihan:

- struktur sama,
- maintenance mudah,
- cocok untuk UI labels.

Kekurangan:

- tidak cocok jika layout/paragraph berbeda drastis,
- sulit untuk legal documents dengan wording kompleks,
- translator bekerja dengan potongan key, bukan dokumen penuh.

Cocok untuk:

- UI,
- simple email,
- short notification,
- form labels.

---

### 13.2 One Template Per Locale

Contoh:

```text
templates/notice/approval/en-SG.ftlh
templates/notice/approval/id-ID.ftlh
templates/notice/approval/zh-Hans-CN.ftlh
```

Kelebihan:

- translator melihat dokumen utuh,
- struktur bisa berbeda,
- cocok untuk legal/correspondence.

Kekurangan:

- duplikasi structure,
- perlu compatibility validation,
- macro/layout library harus dikelola.

Cocok untuk:

- email panjang,
- official letter,
- PDF notice,
- regulatory correspondence.

---

### 13.3 Hybrid

Shell sama, content block berbeda per locale.

```text
templates/layout/correspondence.ftlh
templates/correspondence/approval/content_en-SG.ftlh
templates/correspondence/approval/content_id-ID.ftlh
```

Kelebihan:

- branding/layout konsisten,
- body localized penuh,
- reusable.

Kekurangan:

- dependency antar template,
- perlu version compatibility.

Ini sering paling sehat untuk enterprise correspondence platform.

---

## 14. Fallback Strategy

### 14.1 Fallback Harus Eksplisit

Contoh fallback:

```text
id-ID -> id -> en-SG -> en -> default
```

Tapi fallback untuk official document tidak selalu boleh.

Untuk UI, fallback ke English mungkin acceptable.

Untuk legal notice, fallback diam-diam bisa berbahaya.

Rule:

```text
UI missing translation       -> fallback + log warning
Email missing translation    -> fallback only if business accepts
Legal PDF missing template   -> fail render and require remediation
```

### 14.2 Missing Message Key Policy

Buruk:

```text
??approval.title_id_ID??
```

di production output.

Lebih baik:

- fail-fast untuk official document,
- show safe fallback untuk UI,
- log metric `i18n.missing.key`,
- include template id, locale, key,
- alert bila critical.

---

## 15. Locale, Timezone, and Auditability

### 15.1 Render Record

Untuk email/dokumen resmi, simpan render metadata:

```json
{
  "templateId": "notice.approval",
  "templateVersion": "3.2.0",
  "locale": "en-SG",
  "zoneId": "Asia/Singapore",
  "renderedAt": "2026-06-19T03:00:00Z",
  "dataSnapshotId": "case-snapshot-88421",
  "outputHash": "sha256:..."
}
```

Kenapa penting?

Jika ada dispute:

```text
Kenapa user menerima tanggal 20 Juni, padahal sistem record 19 Juni?
```

Jawabannya bisa ada pada:

- source instant,
- timezone render,
- locale format,
- template version,
- DST rule,
- data snapshot.

Tanpa metadata, sulit membuktikan correctness.

---

### 15.2 Store Rendered Output or Re-render?

Untuk UI biasa:

```text
re-render acceptable
```

Untuk email/dokumen resmi:

```text
store rendered output or immutable generated artifact
```

Karena jika message bundle/template berubah, re-render akan menghasilkan wording berbeda dari yang sebenarnya dikirim.

Rule:

```text
If output has communication/legal/audit significance,
store the exact rendered artifact or a verifiable immutable snapshot.
```

---

## 16. User Locale vs Organization Locale vs Jurisdiction Locale

### 16.1 Tiga Sumber Locale

Dalam enterprise, locale bukan satu nilai.

```text
User locale         -> preferensi user untuk UI
Organization locale -> default bahasa/format organisasi
Jurisdiction locale -> bahasa/format resmi berdasarkan aturan hukum
```

Contoh:

```text
User: Indonesian speaker
Organization: Singapore agency
Jurisdiction: English official correspondence
```

UI bisa Bahasa Indonesia, tetapi official notice tetap English Singapore.

### 16.2 Locale Resolution Policy

Buat policy eksplisit:

```java
public enum RenderPurpose {
    UI_PAGE,
    EMAIL_NOTIFICATION,
    OFFICIAL_NOTICE,
    AUDIT_EXPORT,
    SYSTEM_REPORT
}
```

Resolver:

```java
public interface RenderLocaleResolver {
    RenderLocaleContext resolve(RenderPurpose purpose, User user, Organization org, CaseRecord caseRecord);
}
```

Implementasi:

```java
public RenderLocaleContext resolve(RenderPurpose purpose, User user, Organization org, CaseRecord caseRecord) {
    return switch (purpose) {
        case UI_PAGE -> fromUserPreference(user);
        case EMAIL_NOTIFICATION -> fromCommunicationPreference(user, org);
        case OFFICIAL_NOTICE -> fromJurisdiction(caseRecord.jurisdiction());
        case AUDIT_EXPORT -> fromOrganizationDefault(org);
        case SYSTEM_REPORT -> systemDefault(org);
    };
}
```

Ini jauh lebih aman daripada menyebarkan `LocaleContextHolder.getLocale()` ke semua renderer.

---

## 17. Encoding and Unicode

### 17.1 Always UTF-8

Untuk template modern:

```text
Use UTF-8 everywhere.
```

Pastikan:

- source files UTF-8,
- JVM reads template as UTF-8,
- HTTP response charset benar,
- email MIME charset benar,
- PDF font mendukung glyph,
- database column mendukung Unicode,
- CI tidak merusak encoding.

FreeMarker:

```java
cfg.setDefaultEncoding("UTF-8");
```

Spring/HTTP:

```text
Content-Type: text/html; charset=UTF-8
```

Email:

```java
helper.setText(htmlBody, true);
// ensure MimeMessageHelper constructed/configured with UTF-8 where applicable
```

### 17.2 Unicode Font Problem in PDF

HTML bisa benar, tetapi PDF rusak bila font tidak mendukung karakter.

Contoh masalah:

- Chinese/Japanese/Korean glyph hilang,
- emoji tidak muncul,
- Arabic shaping salah,
- combining mark rusak,
- currency symbol tidak tersedia.

Untuk PDF:

- embed font,
- pilih font dengan coverage bahasa target,
- test per locale,
- jangan hanya test English.

---

## 18. Right-to-Left Language Consideration

Walau seri ini mungkin tidak fokus ke Arabic/Hebrew, engineer top 1% harus tahu konsekuensinya.

RTL mempengaruhi:

- layout direction,
- punctuation,
- table alignment,
- number display,
- mixed LTR/RTL text,
- PDF rendering,
- CSS logical properties.

HTML:

```html
<html lang="ar" dir="rtl">
```

Jangan hardcode `left`/`right` untuk komponen yang harus multi-directional. Gunakan logical CSS bila memungkinkan:

```css
.card {
  margin-inline-start: 1rem;
  padding-inline-end: 1rem;
}
```

Template layout harus bisa menerima direction:

```html
<html th:lang="${page.lang}" th:dir="${page.direction}">
```

---

## 19. Formatting Layer Design

### 19.1 Centralized Rendering Formatter

Buat formatter sebagai bagian dari rendering subsystem.

```java
public interface RenderFormatter {
    String date(LocalDate value);
    String dateTime(Instant value);
    String money(Money value);
    String number(BigDecimal value, int minFraction, int maxFraction);
    String percent(BigDecimal value);
}
```

Factory:

```java
public interface RenderFormatterFactory {
    RenderFormatter create(Locale locale, ZoneId zoneId);
}
```

Keuntungan:

- template tidak menyebar pattern,
- formatting bisa dites,
- policy bisa dikontrol,
- output konsisten antar FreeMarker dan Thymeleaf,
- audit lebih mudah.

---

### 19.2 Jangan Expose Formatter Terlalu Kuat

Hindari:

```java
model.put("dateTimeFormatter", DateTimeFormatter.class);
model.put("formatService", applicationFormatService);
```

Lebih aman:

```java
model.put("fmt", SafeRenderFormatterView.of(locale, zoneId));
```

Template hanya bisa memanggil method yang memang diperbolehkan.

---

## 20. Testing Locale Matrix

### 20.1 Test Bukan Hanya English

Minimal test matrix:

```text
en-SG + Asia/Singapore
id-ID + Asia/Jakarta
en-US + America/New_York
ja-JP + Asia/Tokyo
```

Tambahkan bila relevan:

```text
zh-Hans-CN
zh-Hant-TW
ar-SA
fr-FR
```

Test cases:

- date format,
- time zone conversion,
- DST boundary,
- currency,
- decimal separator,
- missing key,
- email subject,
- PDF glyph rendering,
- fallback behavior,
- template version.

---

### 20.2 DST Boundary Test

Contoh test penting:

```java
@Test
void rendersInstantAcrossDstBoundary() {
    Locale locale = Locale.forLanguageTag("en-GB");
    ZoneId zone = ZoneId.of("Europe/London");
    Instant instant = Instant.parse("2026-03-29T00:30:00Z");

    String text = formatter(locale, zone).dateTime(instant);

    assertThat(text).contains("2026");
}
```

Test harus memverifikasi policy, bukan snapshot rapuh bila CLDR/JDK locale data berubah.

---

### 20.3 Golden Output per Locale

Untuk email/dokumen:

```text
approval-email.en-SG.golden.html
approval-email.id-ID.golden.html
approval-letter.en-SG.golden.pdf.txt-extract
```

Golden test membantu mendeteksi perubahan wording/format tidak sengaja.

Namun jangan pakai golden test secara buta. Pisahkan:

- semantic assertion,
- structural assertion,
- full snapshot assertion.

---

## 21. Common Failure Modes

### 21.1 Server Default Locale Leak

Gejala:

```text
Output di DEV beda dengan PROD.
```

Root cause:

- default locale server berbeda,
- formatter tanpa locale eksplisit,
- template memakai setting default.

Mitigasi:

- locale eksplisit per render,
- CI test dengan default locale berbeda,
- jangan rely pada JVM default.

---

### 21.2 Server Default Timezone Leak

Gejala:

```text
Tanggal email mundur/maju satu hari.
```

Root cause:

- `LocalDateTime.now()`,
- `new Date()` diformat tanpa timezone eksplisit,
- DB timestamp tanpa timezone salah interpretasi.

Mitigasi:

- persist `Instant`,
- render dengan `ZoneId`,
- test zona target.

---

### 21.3 Message Key Missing in Production

Gejala:

```text
??case.approved.title_en_SG??
```

Mitigasi:

- preflight template per locale,
- CI checks for bundle completeness,
- runtime metrics,
- fail-fast untuk critical output.

---

### 21.4 Mixed-language Output

Gejala:

```text
Subject English, body Indonesian, footer English lama.
```

Root cause:

- subject resolved dari different bundle,
- footer template default,
- included fragment tidak localized,
- fallback silent.

Mitigasi:

- render all artifacts from one `RenderLocaleContext`,
- template dependency localization check,
- preview per locale.

---

### 21.5 Currency Symbol Ambiguity

Gejala:

```text
$1,000
```

Tidak jelas apakah USD, SGD, AUD, CAD.

Mitigasi:

- official document gunakan currency code bila perlu:

```text
SGD 1,000.00
```

- jangan bergantung pada symbol saja untuk dokumen penting.

---

## 22. Production Checklist

### 22.1 Locale and Timezone Checklist

Sebelum rendering:

```text
[ ] Render purpose jelas: UI/email/document/audit/report.
[ ] Locale dipilih oleh policy eksplisit.
[ ] ZoneId dipilih oleh policy eksplisit.
[ ] Currency tidak diasumsikan dari locale kecuali memang rule-nya begitu.
[ ] Clock eksplisit untuk testability.
[ ] Template version diketahui.
[ ] Message bundle tersedia untuk locale target.
[ ] Fallback policy jelas.
[ ] Missing key policy jelas.
```

### 22.2 Formatting Checklist

```text
[ ] Date/time tidak memakai server timezone implicit.
[ ] Number/currency tidak memakai JVM default locale implicit.
[ ] Money memakai BigDecimal + Currency.
[ ] Rounding policy bukan disembunyikan di template.
[ ] Legal output memakai preformatted atau centralized formatter.
[ ] Timezone ditampilkan bila output bisa dibaca lintas wilayah.
[ ] PDF font mendukung bahasa target.
```

### 22.3 Template Checklist

```text
[ ] Tidak compose kalimat dengan concatenation.
[ ] Message key semantic dan stabil.
[ ] Parameterized messages digunakan untuk kalimat lengkap.
[ ] Template per locale memiliki compatibility check.
[ ] Included fragments ikut locale yang sama.
[ ] Subject/body/plain-text/HTML konsisten locale-nya.
[ ] Fallback tidak silent untuk dokumen resmi.
```

### 22.4 Audit Checklist

```text
[ ] RenderedAt sebagai Instant disimpan.
[ ] Locale disimpan.
[ ] ZoneId disimpan.
[ ] Template id/version disimpan.
[ ] Data snapshot id/hash disimpan.
[ ] Output artifact/hash disimpan untuk high-stakes documents.
```

---

## 23. Reference Architecture: Localized Rendering Context

### 23.1 Core Types

```java
public enum RenderPurpose {
    UI_PAGE,
    EMAIL_NOTIFICATION,
    OFFICIAL_NOTICE,
    PDF_DOCUMENT,
    AUDIT_EXPORT,
    SYSTEM_REPORT
}
```

```java
public record RenderContext(
    RenderPurpose purpose,
    Locale locale,
    ZoneId zoneId,
    Clock clock,
    String templateId,
    String templateVersion,
    Currency defaultCurrency,
    boolean failOnMissingMessage
) {}
```

```java
public interface LocalizedRenderer {
    RenderedOutput render(RenderRequest request);
}
```

```java
public record RenderRequest(
    String templateId,
    String templateVersion,
    RenderPurpose purpose,
    Object model,
    Locale locale,
    ZoneId zoneId
) {}
```

```java
public record RenderedOutput(
    String content,
    String contentType,
    RenderMetadata metadata
) {}
```

```java
public record RenderMetadata(
    String templateId,
    String templateVersion,
    String localeTag,
    String zoneId,
    Instant renderedAt,
    String outputHash
) {}
```

---

### 23.2 Rendering Flow

```text
Request
  ↓
Resolve render purpose
  ↓
Resolve locale/timezone/currency policy
  ↓
Resolve template version
  ↓
Build view model
  ↓
Build localized formatter/message resolver
  ↓
Render template
  ↓
Validate output
  ↓
Store metadata/artifact if needed
```

---

## 24. Top 1% Engineering Principles

### Principle 1: Locale is not decoration

Locale changes meaning, not only labels.

### Principle 2: Timezone is not environment

Timezone must be an explicit input.

### Principle 3: Formatting is part of contract

If output matters, formatting must be designed, tested, and versioned.

### Principle 4: Messages are semantic units

Never build translated sentences from fragments casually.

### Principle 5: Official output must be reproducible

Store enough metadata to explain why the output looked that way.

### Principle 6: Fallback is a business rule

Fallback can be user-friendly in UI and dangerous in legal documents.

### Principle 7: Template and model must agree per locale

A localized template is still a contract. It must be validated against the model.

---

## 25. Practical Exercise

Build a localized approval notice renderer.

Requirements:

```text
- Supports en-SG and id-ID.
- Renders HTML email and PDF pre-render HTML.
- Uses explicit Locale and ZoneId.
- Uses Money type with Currency.
- Stores render metadata.
- Fails fast if official PDF translation is missing.
- Allows fallback for UI preview only.
```

Suggested structure:

```text
src/main/resources/templates/
  approval/
    email/
      en-SG.ftlh
      id-ID.ftlh
    pdf/
      en-SG.ftlh
      id-ID.ftlh

src/main/resources/messages/
  messages_en_SG.properties
  messages_id_ID.properties
```

Core model:

```java
public record ApprovalNoticeView(
    String recipientName,
    String caseReference,
    LocalDate approvalDate,
    Money fee,
    String approvalDateText,
    String feeText
) {}
```

Render metadata:

```java
public record ApprovalNoticeRenderRecord(
    String caseReference,
    String templateId,
    String templateVersion,
    String locale,
    String zoneId,
    Instant renderedAt,
    String outputHash
) {}
```

Acceptance criteria:

```text
[ ] en-SG and id-ID render correctly.
[ ] No server default locale usage.
[ ] No server default timezone usage.
[ ] Missing id-ID PDF template fails official render.
[ ] UI preview may fallback with visible warning.
[ ] Email subject/body/plain-text use same locale.
[ ] PDF HTML includes lang attribute.
[ ] Render record contains locale and zoneId.
```

---

## 26. Summary

Dalam template engineering, i18n/l10n bukan lapisan kosmetik. Ia adalah bagian dari correctness.

Hal yang harus melekat sebagai mental model:

```text
Template rendering is not complete until language, locale, timezone,
formatting, fallback, and audit metadata are resolved explicitly.
```

Untuk sistem kecil, cukup memakai message bundle dan default formatter. Untuk sistem enterprise, khususnya email/dokumen/correspondence/legal/regulatory workflow, pendekatan itu tidak cukup.

Engineer yang kuat akan mendesain:

- locale resolver by purpose,
- timezone resolver by business context,
- centralized formatter,
- message policy,
- fallback policy,
- render metadata,
- locale matrix tests,
- immutable artifact strategy.

Itulah yang membedakan template rendering biasa dari production-grade rendering subsystem.

---

## 27. Referensi

- Apache FreeMarker Manual — Configuration Settings: https://freemarker.apache.org/docs/pgui_config_settings.html
- Apache FreeMarker Manual — Date/Time Built-ins: https://freemarker.apache.org/docs/ref_builtins_date.html
- Apache FreeMarker Manual — `#setting` Directive: https://freemarker.apache.org/docs/ref_directive_setting.html
- Thymeleaf 3.1 Tutorial — Using Thymeleaf: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- Thymeleaf 3.1 Tutorial — Thymeleaf + Spring: https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html
- Spring Framework `MessageSource` API: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/MessageSource.html
- Java SE 25 `DateTimeFormatter`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html
- Java SE 25 `NumberFormat`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/NumberFormat.html

---

## 28. Status Seri

```text
Part 21 selesai.
Seri belum selesai.
Berikutnya: Part 22 — Template Data Model Design: DTO, ViewModel, Presenter, and Contract Stability.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-020.md">⬅️ Part 20 — Document Generation: HTML-to-PDF, DOCX, XML, CSV, and Text Outputs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-022.md">Part 22 — Template Data Model Design: DTO, ViewModel, Presenter, and Contract Stability ➡️</a>
</div>
