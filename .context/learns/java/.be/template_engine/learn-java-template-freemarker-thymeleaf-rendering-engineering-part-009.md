# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-009

# Part 9 — FreeMarker Error Handling, Diagnostics, and Template Observability

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Scope Java: Java 8 sampai Java 25  
> Fokus engine: Apache FreeMarker 2.3.x family  
> Level: Advanced / production engineering  
> Prasyarat langsung: Part 3–8, terutama `Configuration`, `TemplateLoader`, object wrapping, output format, auto-escaping, dan secure data model boundary.

---

## 0. Tujuan Part Ini

Di bagian sebelumnya kita sudah mempelajari FreeMarker dari sisi:

1. arsitektur runtime,
2. FTL value/expression/directive,
3. macro/function/custom directive,
4. object wrapping dan security boundary,
5. output format, auto-escaping, dan XSS defense.

Sekarang kita masuk ke area yang sering membedakan engineer biasa dan engineer yang benar-benar siap production:

> Bagaimana sistem template gagal, bagaimana kegagalan itu didiagnosis, bagaimana failure tidak membocorkan data, bagaimana error dapat diklasifikasikan, dan bagaimana rendering bisa diobservasi seperti subsystem production lain.

Template error sering terlihat “sepele”, misalnya:

```text
Expression user.name is undefined
```

Tetapi di sistem nyata, error seperti itu bisa berarti banyak hal:

- controller tidak mengisi model dengan benar,
- field di DTO berubah tanpa contract test,
- template versi baru dipublish tanpa sample validation,
- locale tertentu tidak punya translation key,
- tenant-specific template tertinggal dari base template,
- object wrapper menyembunyikan method tertentu,
- data snapshot dari workflow tidak lengkap,
- template dynamic dari database corrupt,
- template cache masih memegang versi lama,
- template author memakai expression terlalu kompleks,
- custom directive gagal karena input invalid,
- render gagal setelah transaksi domain commit,
- email/document gagal dibuat sehingga business workflow tersangkut.

Karena itu, tujuan part ini bukan hanya “cara set `TemplateExceptionHandler`”, melainkan membangun mental model lengkap:

```text
Template failure = contract failure + runtime context failure + output boundary failure + operational observability problem.
```

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. membedakan parse error, load error, runtime error, output error, dan contract error,
2. mendesain error strategy untuk DEV, TEST, UAT, dan PROD,
3. memilih kapan fail-fast dan kapan graceful degradation,
4. membuat render service yang menghasilkan error object yang aman dan actionable,
5. menambahkan observability: logs, metrics, tracing, correlation ID, template version,
6. membuat preflight validation untuk template sebelum dipakai production,
7. membuat golden-output test dan contract test,
8. menghindari debug output yang membocorkan PII/security data,
9. memahami kenapa `#attempt/#recover` bukan pengganti error handling di Java,
10. merancang failure model untuk email/document/correspondence rendering enterprise.

---

## 1. Core Mental Model: Rendering Bisa Gagal di Banyak Layer

Rendering FreeMarker bukan satu operasi monolitik. Ia adalah pipeline:

```text
request/job/event
   |
   v
select template id/version/locale/output format
   |
   v
load template source
   |
   v
parse template
   |
   v
retrieve compiled/cached Template
   |
   v
prepare data model
   |
   v
wrap Java objects into FTL model
   |
   v
execute template instructions
   |
   v
resolve expressions/directives/macros/includes
   |
   v
escape/format output
   |
   v
write to output sink
   |
   v
HTML/email/text/XML/PDF-preHTML/config/source/etc.
```

Masing-masing tahap bisa gagal dengan karakter berbeda.

| Layer | Contoh kegagalan | Nature | Biasanya diperbaiki di |
|---|---|---:|---|
| Template selection | template id tidak ada | integration/config | renderer/template registry |
| Template loading | file tidak ditemukan, permission error | infra/config | packaging/deployment |
| Parsing | syntax FTL invalid | template authoring | template file |
| Include/import | dependency template hilang | composition/versioning | template library |
| Data model | field tidak ada | contract/integration | Java presenter/model builder |
| Object wrapping | property tidak terekspos | runtime config/security | wrapper/model design |
| Expression eval | null/missing, invalid type | model/template mismatch | both |
| Custom directive | argument invalid, service fail | extension/runtime | Java extension |
| Escaping/output format | wrong output context | security/design | template + renderer config |
| Writer/output | IOException, storage full | infra/I/O | platform/runtime |
| Post-render | email send/PDF conversion fail | downstream | integration boundary |

Engineer top-tier melihat error template bukan hanya sebagai “template broken”. Ia bertanya:

1. Di layer mana failure terjadi?
2. Apakah failure deterministik?
3. Apakah failure karena bug template atau bug host Java code?
4. Apakah template dapat dipublish tanpa field yang diperlukan?
5. Apakah error harus menghentikan seluruh output atau hanya fragment optional?
6. Apakah error mengandung PII?
7. Apakah log cukup untuk memperbaiki tanpa membuka production data?
8. Apakah metric akan menunjukkan spike sebelum user melapor?
9. Apakah output yang gagal punya audit record?
10. Apakah retry akan aman atau justru menggandakan email/document?

---

## 2. Taxonomy Error FreeMarker

Secara praktis, kita bisa klasifikasikan error FreeMarker ke beberapa kategori.

### 2.1 Template Load Error

Terjadi saat template tidak bisa ditemukan atau dibaca.

Contoh:

```java
Template template = configuration.getTemplate("emails/welcome.ftl");
```

Kemungkinan gagal karena:

- path salah,
- template tidak ikut masuk JAR/container image,
- classpath salah,
- file permission bermasalah,
- filesystem template loader menunjuk directory yang salah,
- database-backed template loader tidak menemukan version,
- cache invalidation gagal,
- tenant override template tidak ada tetapi fallback tidak dikonfigurasi.

Biasanya muncul sebagai `IOException` atau subclass terkait loading.

Mental model:

```text
Load error = renderer tidak bisa mendapatkan source template yang valid.
```

Ini berbeda dari template syntax error. File mungkin belum ditemukan sama sekali.

### 2.2 Template Parse Error

Terjadi saat source template ditemukan tetapi syntax FTL invalid.

Contoh:

```ftl
<#if user.active>
  Active user
<!-- lupa </#if> -->
```

Atau:

```ftl
${user.name
```

Ciri:

- template belum sampai dieksekusi,
- data model belum relevan,
- masalah ada di grammar/template syntax,
- bisa dideteksi saat preflight compile.

Biasanya muncul sebagai `freemarker.core.ParseException`.

Mental model:

```text
Parse error = template source tidak bisa diubah menjadi executable template representation.
```

### 2.3 Template Runtime Error

Terjadi saat template berhasil diparse, tetapi gagal saat dieksekusi dengan model tertentu.

Contoh:

```ftl
Hello ${user.name}
```

Jika `user` tidak ada di model, atau `user.name` missing, rendering gagal.

Contoh lain:

```ftl
${amount?number}
```

Jika `amount` berisi string non-numeric, conversion gagal.

Runtime error biasanya berupa `TemplateException`.

Mental model:

```text
Runtime error = template valid secara syntax, tetapi tidak valid terhadap data/context saat ini.
```

### 2.4 Output Writer Error

Terjadi saat hasil rendering tidak bisa ditulis ke sink.

Contoh:

- client HTTP disconnect,
- file output gagal,
- disk penuh,
- stream closed,
- network storage fail,
- writer encoding issue.

Pada FreeMarker, `template.process(model, writer)` bisa melempar `IOException` selain `TemplateException`.

Mental model:

```text
Writer error = template berhasil dievaluasi sebagian/sepenuhnya, tetapi output sink gagal menerima data.
```

### 2.5 Semantic Output Error

Ini lebih sulit: rendering sukses secara teknis, tetapi output salah.

Contoh:

- jumlah uang salah format,
- tanggal salah timezone,
- label bahasa fallback ke English padahal user locale Indonesia,
- tombol “Approve” tampil padahal user tidak punya permission,
- HTML valid tetapi layout email rusak di Outlook,
- PDF generated tetapi page break merusak table legal,
- optional clause muncul di dokumen karena flag salah,
- output kosong karena list kosong tidak ditangani.

Mental model:

```text
Semantic output error = engine tidak throw exception, tetapi output melanggar ekspektasi business/user/legal/security.
```

Ini sebabnya observability saja tidak cukup. Kita perlu testing, contract, preview, and review workflow.

---

## 3. Parse Error vs Runtime Error: Jangan Disamakan

Perbedaan ini sangat penting.

### 3.1 Parse Error

Parse error muncul karena template source invalid.

Contoh:

```ftl
<#list users as user>
  ${user.name}
```

Masalah: `</#list>` hilang.

Tidak peduli model apa yang diberikan, template ini tidak bisa dipakai.

Strategi:

- tangkap saat build/test/preflight,
- jangan tunggu production traffic,
- block publish jika template dynamic,
- tampilkan line/column ke template editor internal,
- jangan expose stack trace ke end-user.

### 3.2 Runtime Error

Runtime error bergantung pada model.

Template:

```ftl
Hello ${user.displayName}
```

Model A:

```java
Map.of("user", Map.of("displayName", "Fajar"))
```

Sukses.

Model B:

```java
Map.of("account", Map.of("displayName", "Fajar"))
```

Gagal karena `user` missing.

Strategi:

- contract test antara model builder dan template,
- sample render untuk setiap template/version/locale,
- explicit required fields,
- fail-fast untuk required output,
- graceful fallback hanya untuk non-critical fragment.

### 3.3 Kenapa Ini Penting?

Karena cara memperbaikinya berbeda.

| Jenis error | Siapa biasanya salah? | Solusi utama |
|---|---|---|
| Parse error | template author | lint/preflight syntax |
| Runtime missing field | Java presenter atau template contract | contract test/model schema |
| Runtime type mismatch | mapping/model design | stronger ViewModel |
| Writer error | platform/output sink | retry/I/O handling |
| Semantic error | requirement/test gap | golden output/review |

Jika semua error hanya dicatat sebagai `TEMPLATE_ERROR`, kamu kehilangan root cause.

---

## 4. FreeMarker Exception Handling Configuration

FreeMarker menyediakan `TemplateExceptionHandler` untuk mengontrol apa yang terjadi ketika `TemplateException` terjadi selama template processing.

Dokumentasi FreeMarker menyebut `RETHROW_HANDLER` sebagai handler yang cukup melempar ulang exception dan disarankan untuk kebanyakan aplikasi modern karena tidak mencetak detail error ke output, sementara developer tetap bisa melihat detail dari log aplikasi. Referensi resmi juga menunjukkan konfigurasi production yang memakai `RETHROW_HANDLER`, `setLogTemplateExceptions(false)`, dan `setWrapUncheckedExceptions(true)`.

### 4.1 Baseline Production Configuration

Contoh baseline:

```java
import freemarker.template.Configuration;
import freemarker.template.TemplateExceptionHandler;

import java.nio.charset.StandardCharsets;
import java.util.TimeZone;

public final class FreeMarkerFactory {

    public static Configuration createConfiguration() {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);

        // Hindari double logging: FreeMarker log lalu aplikasi log lagi.
        cfg.setLogTemplateExceptions(false);

        // Ubah unchecked exception saat processing menjadi TemplateException,
        // sehingga error path lebih konsisten.
        cfg.setWrapUncheckedExceptions(true);

        // Behavior lebih strict untuk null loop variable.
        cfg.setFallbackOnNullLoopVariable(false);

        // Penting jika memakai java.sql.Date/Time/Timestamp legacy.
        cfg.setSQLDateAndTimeTimeZone(TimeZone.getDefault());

        return cfg;
    }
}
```

Poin penting:

1. `RETHROW_HANDLER` cocok untuk production.
2. Jangan print stack trace ke HTML/email/output user.
3. Jangan biarkan FreeMarker dan aplikasi sama-sama log exception yang sama tanpa korelasi.
4. `wrapUncheckedExceptions` membantu mengklasifikasikan error runtime template.
5. `defaultEncoding` harus eksplisit.
6. Strict behavior lebih baik untuk sistem enterprise karena missing field harus cepat terdeteksi.

### 4.2 Handler yang Umum Ada

FreeMarker menyediakan beberapa handler built-in.

| Handler | Behavior | Cocok untuk |
|---|---|---|
| `RETHROW_HANDLER` | rethrow exception | production |
| `DEBUG_HANDLER` | output debug info ke output lalu rethrow | local dev teks/non-HTML |
| `HTML_DEBUG_HANDLER` | output debug HTML lalu rethrow | local dev HTML |
| `IGNORE_HANDLER` | abaikan error | hampir tidak pernah cocok untuk production |

Prinsip production:

```text
Production output must not contain template stack trace.
```

Kenapa?

Karena stack trace/template error bisa membocorkan:

- nama template,
- path internal,
- nama field domain,
- struktur data model,
- business terminology internal,
- package/class name,
- partial sensitive value,
- line template yang mengandung expression sensitif.

### 4.3 Kenapa `IGNORE_HANDLER` Berbahaya

`IGNORE_HANDLER` terlihat menggoda karena page/email tetap “sukses”. Tetapi efeknya berbahaya.

Contoh template:

```ftl
Dear ${customer.fullName},

Your outstanding amount is ${outstandingAmount}.
```

Jika `outstandingAmount` missing dan error di-ignore, output bisa menjadi:

```text
Dear Fajar,

Your outstanding amount is .
```

Untuk email marketing mungkin ini memalukan. Untuk dokumen enforcement/regulatory, ini fatal.

Masalah `IGNORE_HANDLER`:

1. error menjadi silent,
2. output bisa semantik salah,
3. audit trail mencatat dokumen yang “berhasil” padahal invalid,
4. user menerima komunikasi tidak lengkap,
5. downstream process tidak tahu ada masalah,
6. debugging menjadi sulit,
7. compliance risk meningkat.

Rule:

```text
Never use global IGNORE_HANDLER for production rendering.
```

Jika perlu fallback, lakukan secara eksplisit dan lokal, bukan global.

---

## 5. Error Strategy per Environment

Error handling tidak harus sama di semua environment.

### 5.1 Local Development

Tujuan:

- feedback cepat,
- line/column jelas,
- developer tahu expression mana gagal,
- boleh verbose,
- tidak perlu user-safe output.

Konfigurasi lokal bisa memakai:

```java
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.HTML_DEBUG_HANDLER);
cfg.setLogTemplateExceptions(true);
```

Tetapi hati-hati: jangan sampai konfigurasi ini masuk production.

### 5.2 Automated Test / CI

Tujuan:

- fail-fast,
- deterministic,
- no debug output,
- error mudah diparse CI,
- semua template penting bisa dirender dengan sample data.

Konfigurasi:

```java
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
cfg.setLogTemplateExceptions(false);
cfg.setWrapUncheckedExceptions(true);
```

Tambahkan:

- template discovery,
- compile all templates,
- render sample scenarios,
- compare golden output,
- validate escaping/security expectations.

### 5.3 UAT/Staging

Tujuan:

- mendekati production,
- error tidak bocor ke user,
- diagnostic log cukup lengkap,
- bisa trace template version dan model contract.

Gunakan production-like config.

Tambahkan:

- higher log detail dengan redaction,
- preview mode untuk reviewer,
- render diagnostics endpoint internal,
- sample data matrix.

### 5.4 Production

Tujuan:

- output aman,
- failure terklasifikasi,
- user mendapat generic error/fallback yang sesuai,
- log tidak mengandung PII,
- metric dan alert aktif,
- audit event terekam,
- retry/idempotency jelas.

Konfigurasi:

```java
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
cfg.setLogTemplateExceptions(false);
cfg.setWrapUncheckedExceptions(true);
```

Production rule:

```text
FreeMarker throws. Application owns classification, logging, metrics, user response, retry, and audit.
```

---

## 6. Designing a Render Error Model

Jangan biarkan semua exception keluar mentah sebagai `Exception`. Buat error model khusus.

### 6.1 Render Error Classification

Contoh enum:

```java
public enum RenderErrorType {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_PARSE_ERROR,
    TEMPLATE_RUNTIME_ERROR,
    TEMPLATE_CONTRACT_ERROR,
    TEMPLATE_SECURITY_ERROR,
    TEMPLATE_IO_ERROR,
    TEMPLATE_OUTPUT_FORMAT_ERROR,
    TEMPLATE_VERSION_ERROR,
    TEMPLATE_DEPENDENCY_ERROR,
    UNKNOWN_RENDER_ERROR
}
```

Untuk sistem besar, bisa lebih detail:

```java
public enum RenderFailureCategory {
    SELECTION,
    LOADING,
    PARSING,
    MODEL_VALIDATION,
    WRAPPING,
    EXECUTION,
    ESCAPING,
    WRITING,
    POST_PROCESSING,
    SECURITY_POLICY,
    GOVERNANCE
}
```

### 6.2 Render Exception Wrapper

Contoh:

```java
public final class TemplateRenderException extends RuntimeException {

    private final RenderErrorType type;
    private final String templateId;
    private final String templateVersion;
    private final String locale;
    private final String outputFormat;
    private final Integer line;
    private final Integer column;

    public TemplateRenderException(
            RenderErrorType type,
            String message,
            String templateId,
            String templateVersion,
            String locale,
            String outputFormat,
            Integer line,
            Integer column,
            Throwable cause
    ) {
        super(message, cause);
        this.type = type;
        this.templateId = templateId;
        this.templateVersion = templateVersion;
        this.locale = locale;
        this.outputFormat = outputFormat;
        this.line = line;
        this.column = column;
    }

    public RenderErrorType type() {
        return type;
    }

    public String templateId() {
        return templateId;
    }

    public String templateVersion() {
        return templateVersion;
    }

    public String locale() {
        return locale;
    }

    public String outputFormat() {
        return outputFormat;
    }

    public Integer line() {
        return line;
    }

    public Integer column() {
        return column;
    }
}
```

Catatan Java 8–25:

- Untuk Java 8, gunakan class final biasa seperti di atas.
- Untuk Java 16+, bisa memakai `record` untuk value object, tetapi exception tetap biasanya class.
- Untuk Java 17+, sealed hierarchy bisa dipakai untuk error taxonomy jika project mengizinkan.
- Untuk Java 21/25, virtual threads bisa dipakai untuk workload rendering I/O-bound, tetapi error classification tetap sama.

### 6.3 Jangan Masukkan Data Model ke Exception

Anti-pattern:

```java
throw new TemplateRenderException("Failed model=" + model, cause);
```

Ini berbahaya karena model bisa berisi:

- nama user,
- email,
- alamat,
- NRIC/ID,
- token,
- internal remarks,
- enforcement details,
- draft legal content,
- confidential correspondence.

Rule:

```text
Error metadata boleh memuat template id/version/locale/line/column/correlation id, tetapi tidak boleh memuat raw model values.
```

Jika perlu debugging model, gunakan redacted diagnostic snapshot yang controlled dan hanya di environment aman.

---

## 7. Extracting Diagnostic Detail from FreeMarker Exceptions

`TemplateException` menyediakan informasi lokasi seperti line/column jika tersedia. Dokumentasi API FreeMarker menyebut `getColumnNumber()` sebagai column number 1-based dari section yang gagal, dan juga menyediakan line/end-line/end-column detail pada versi modern.

Contoh:

```java
import freemarker.template.TemplateException;

private static Integer lineOf(Throwable error) {
    if (error instanceof TemplateException) {
        return ((TemplateException) error).getLineNumber();
    }
    return null;
}

private static Integer columnOf(Throwable error) {
    if (error instanceof TemplateException) {
        return ((TemplateException) error).getColumnNumber();
    }
    return null;
}
```

Untuk Java 16+:

```java
private static Integer lineOf(Throwable error) {
    if (error instanceof TemplateException te) {
        return te.getLineNumber();
    }
    return null;
}
```

Informasi berguna:

- template name,
- line number,
- column number,
- failing instruction/expression,
- blamed expression string,
- FTL stack trace,
- root cause Java exception.

Namun prinsipnya:

```text
Diagnostic detail internal boleh kaya; user-facing output harus minimal dan aman.
```

### 7.1 Safe Diagnostic Object

Contoh:

```java
public final class RenderDiagnostic {
    private final String correlationId;
    private final String templateId;
    private final String templateVersion;
    private final String templateName;
    private final String locale;
    private final String outputFormat;
    private final Integer line;
    private final Integer column;
    private final String errorType;
    private final String safeMessage;

    // constructor/getters omitted
}
```

`safeMessage` contoh:

```text
Required template variable is missing.
```

Bukan:

```text
Expression customer.nric is undefined at line 83 in enforcement-notice-final.ftl
```

Yang kedua mungkin boleh di log internal, tetapi tidak ke browser/email recipient.

---

## 8. Missing Variable Strategy

FreeMarker terkenal strict terhadap missing/null dibanding beberapa template engine lain. Ini sebenarnya baik untuk production karena error lebih cepat terdeteksi.

### 8.1 Required Field Harus Fail Fast

Template:

```ftl
Dear ${recipientName},
```

Jika `recipientName` required, jangan pakai default kosong:

```ftl
Dear ${recipientName!},
```

Itu membuat output bisa cacat.

Lebih baik gagal saat render dan tertangkap oleh test/preflight.

Rule:

```text
Required legal/business fields must fail fast when missing.
```

### 8.2 Optional Field Harus Eksplisit

Jika field memang optional:

```ftl
<#if secondaryAddress??>
  <p>${secondaryAddress}</p>
</#if>
```

Atau default yang aman:

```ftl
${middleName!""}
```

Tetapi default harus punya makna business.

Bad default:

```ftl
${outstandingAmount!"0"}
```

Kenapa buruk?

Karena missing amount bukan sama dengan amount zero.

Lebih baik:

```ftl
<#if outstandingAmount??>
  ${outstandingAmount}
<#else>
  <#stop "Missing required outstandingAmount">
</#if>
```

Namun lebih baik lagi: validasi di Java sebelum render.

### 8.3 Missing Variable Policy Matrix

| Field type | Contoh | Missing strategy |
|---|---|---|
| Required identity | recipient name, case number | fail render |
| Required money/date/legal | due date, penalty amount | fail render |
| Optional cosmetic | middle name, secondary line | explicit default/conditional |
| Optional section | extra remarks, attachments block | conditional section |
| Security-sensitive | role/permission flags | fail closed |
| Localization key | page title/message | fail preflight or fallback controlled |

### 8.4 Avoid Silent Empty Defaults

Anti-pattern:

```ftl
${user.name!}
${case.referenceNo!}
${amount!}
${deadline!}
```

Ini sering dipakai untuk “menghilangkan error”. Tetapi di sistem enterprise, ini mengubah error menjadi output corrupt.

Gunakan default kosong hanya jika benar-benar cosmetic.

---

## 9. `#attempt/#recover`: Local Fallback, Bukan Global Error Policy

FreeMarker menyediakan `#attempt` dan `#recover` untuk menangani error pada bagian template tertentu. Dokumentasi FreeMarker menjelaskan bahwa jika error terjadi dalam attempt block, output dari attempt block di-rollback dan recover block dieksekusi, lalu template bisa lanjut.

Contoh:

```ftl
<#attempt>
  <aside>
    ${recommendationWidgetHtml?no_esc}
  </aside>
<#recover>
  <aside class="widget-unavailable">
    Recommendations are currently unavailable.
  </aside>
</#attempt>
```

Ini cocok untuk bagian non-critical seperti:

- sidebar recommendation,
- optional marketing banner,
- optional dashboard widget,
- non-critical external snippet,
- optional computed display.

Tidak cocok untuk:

- case number,
- recipient identity,
- legal decision,
- payment amount,
- due date,
- official notice content,
- security decision,
- permission rendering critical.

### 9.1 Good Use

```ftl
<#attempt>
  <#include "fragments/optional-help-panel.ftl">
<#recover>
  <!-- optional help panel unavailable -->
</#attempt>
```

### 9.2 Bad Use

```ftl
<#attempt>
  Your penalty amount is ${penaltyAmount}.
<#recover>
  Your penalty amount is not available.
</#attempt>
```

Kenapa buruk?

Karena official notice dengan amount missing harus gagal, bukan mengirim dokumen ambigu.

### 9.3 Rule

```text
Use #attempt/#recover only for optional display fragments whose absence does not corrupt the meaning, legality, or safety of the output.
```

---

## 10. Fail-Fast vs Graceful Degradation

Tidak semua rendering failure harus ditangani sama.

### 10.1 Fail-Fast

Fail-fast berarti rendering berhenti dan output tidak dikirim/digunakan.

Cocok untuk:

- email resmi,
- legal notice,
- invoice,
- enforcement document,
- approval/rejection letter,
- generated contract,
- machine-consumed XML/config,
- security-sensitive page.

Alasan:

- output tidak lengkap lebih buruk daripada gagal,
- audit harus jelas,
- retry bisa dilakukan setelah perbaikan,
- corruption tidak boleh tersebar.

### 10.2 Graceful Degradation

Graceful degradation berarti sebagian output tetap bisa tampil dengan fallback.

Cocok untuk:

- dashboard widget,
- sidebar,
- optional marketing panel,
- personalization block,
- recommendation block,
- help text,
- non-critical decoration.

### 10.3 Decision Matrix

| Pertanyaan | Jika ya | Strategy |
|---|---|---|
| Output punya dampak legal/financial? | ya | fail-fast |
| Output dikirim ke external recipient? | ya | fail-fast kecuali optional fragment |
| Output machine-consumed? | ya | fail-fast + schema validation |
| Fragment hanya dekoratif? | ya | graceful possible |
| Missing data bisa mengubah makna? | ya | fail-fast |
| User bisa refresh/manual retry? | ya | graceful page-level possible |
| Workflow akan lanjut otomatis? | ya | fail-fast + queue retry/audit |

Prinsip:

```text
Graceful degradation is a business decision, not a developer convenience.
```

---

## 11. Safe Logging for Template Errors

Logging template error harus cukup kaya untuk debugging, tetapi tidak membocorkan data.

### 11.1 Apa yang Harus Dicatat

Minimal log fields:

- `correlationId`,
- `requestId` atau `jobId`,
- `templateId`,
- `templateVersion`,
- `templateName/path`,
- `locale`,
- `timezone`,
- `outputFormat`,
- `renderUseCase` misalnya `EMAIL`, `PDF_HTML`, `MVC_PAGE`,
- `tenantId`/`agencyId` jika aman,
- `errorType`,
- `exceptionClass`,
- `line`,
- `column`,
- `durationMs`,
- `modelSchemaVersion`,
- `templateRepositoryVersion`,
- `deploymentVersion`,
- `rootCauseClass`.

Contoh structured log:

```json
{
  "event": "template_render_failed",
  "correlationId": "c-20260619-abc123",
  "templateId": "enforcement.notice.warning",
  "templateVersion": "2026.06.19-1",
  "templateName": "letters/enforcement/warning.ftl",
  "locale": "en-SG",
  "timezone": "Asia/Singapore",
  "outputFormat": "HTML",
  "useCase": "PDF_PRE_RENDER",
  "tenantId": "cea",
  "errorType": "TEMPLATE_RUNTIME_ERROR",
  "exceptionClass": "freemarker.template.TemplateException",
  "line": 84,
  "column": 17,
  "durationMs": 12,
  "modelSchemaVersion": "notice-warning-v3",
  "deploymentVersion": "aceas-renderer-2.7.4"
}
```

### 11.2 Apa yang Tidak Boleh Dicatat

Jangan log:

- full model,
- raw HTML output jika mengandung PII,
- full email body production,
- token/session/cookie,
- password/secret,
- full address/ID number,
- internal notes yang confidential,
- attachment content,
- user-entered rich text tanpa redaction,
- stack trace ke user response.

### 11.3 Stack Trace: Boleh, Tapi Controlled

Stack trace internal boleh dicatat dengan:

- log level error/warn sesuai severity,
- correlation ID,
- redaction policy,
- secure log sink,
- retention policy,
- access control,
- no raw model dump.

### 11.4 Jangan Double Logging

Jika FreeMarker sudah log exception dan aplikasi juga log, kamu akan mendapat duplikasi noise. FreeMarker menyediakan setting `log_template_exceptions`; dokumentasi quickstart production menunjukkan `setLogTemplateExceptions(false)` agar exception yang dilempar ke aplikasi tidak dilog dua kali oleh FreeMarker.

Preferred:

```text
FreeMarker throws → application catches → application logs structured event once.
```

---

## 12. User-Facing Error Response

Untuk web page rendering, jangan tampilkan detail template error ke user.

Bad:

```html
TemplateException: The following has evaluated to null or missing:
==> customer.nric [in template "notice.ftl" at line 43, column 19]
```

Good:

```html
We could not generate this page right now. Please try again later or contact support with reference ID C-ABC123.
```

Untuk internal admin preview, boleh tampilkan detail lebih banyak jika user berwenang:

```text
Template validation failed.
Template: notice.warning
Version: draft-17
Locale: en-SG
Line: 43
Column: 19
Reason: Required field `customer.nricMasked` is missing from sample model.
```

Tetapi tetap jangan tampilkan raw sensitive values.

---

## 13. Observability: Metrics yang Harus Ada

Template rendering adalah subsystem. Ia harus punya metrics.

### 13.1 Core Metrics

Minimal:

```text
render_requests_total
render_success_total
render_failure_total
render_duration_seconds
render_output_bytes
render_template_cache_hit_total
render_template_cache_miss_total
render_model_validation_failure_total
render_preflight_failure_total
```

Labels/tags yang berguna:

- `template_id`,
- `template_version`,
- `output_format`,
- `locale`,
- `use_case`,
- `tenant`,
- `error_type`,
- `environment`.

Hati-hati cardinality:

- jangan masukkan `caseId` sebagai metric label,
- jangan masukkan `userId`,
- jangan masukkan `email`,
- jangan masukkan raw template path dynamic tanpa kontrol.

### 13.2 Latency Metrics

Pisahkan:

1. template load duration,
2. model build duration,
3. render execution duration,
4. post-render conversion duration,
5. total pipeline duration.

Contoh:

```text
template_model_build_duration_seconds
freemarker_template_process_duration_seconds
pdf_conversion_duration_seconds
email_send_duration_seconds
```

Kenapa dipisah?

Karena user sering bilang “template lambat”, padahal yang lambat bisa:

- query data model,
- remote service call saat build model,
- PDF conversion,
- SMTP send,
- template loader database,
- cache miss,
- huge output string allocation.

### 13.3 Failure Metrics

Klasifikasikan failure:

```text
render_failure_total{error_type="TEMPLATE_NOT_FOUND"}
render_failure_total{error_type="TEMPLATE_PARSE_ERROR"}
render_failure_total{error_type="TEMPLATE_RUNTIME_ERROR"}
render_failure_total{error_type="MODEL_CONTRACT_ERROR"}
render_failure_total{error_type="OUTPUT_IO_ERROR"}
```

Dengan ini alert bisa lebih actionable.

### 13.4 Alert Examples

Contoh alert:

```text
Template render failure rate > 1% for 10 minutes
```

```text
Template parse error detected in active template version
```

```text
Email template rendering p95 latency > 500ms for 15 minutes
```

```text
Model contract failures increased after deployment version X
```

---

## 14. Tracing: Rendering dalam Distributed System

Dalam microservice/workflow system, rendering sering bukan endpoint tunggal.

Contoh:

```text
Case state changed
   -> outbox event
   -> notification service
   -> template rendering service
   -> email service
   -> audit service
```

Jika render gagal, kita harus tahu event mana, template mana, dan downstream apa yang terdampak.

Trace span yang berguna:

```text
case.transition
notification.prepare
render.model.build
render.template.load
render.template.process
email.send
notification.audit
```

Span attributes:

- `template.id`,
- `template.version`,
- `template.locale`,
- `render.output_format`,
- `render.use_case`,
- `render.success`,
- `render.error_type`,
- `render.output_bytes`.

Jangan masukkan PII ke tracing attributes.

---

## 15. Preflight Validation: Jangan Tunggu Production Traffic

Preflight validation adalah proses memvalidasi template sebelum dipakai.

### 15.1 Level 1: Template Load + Parse

Cek semua template bisa dimuat dan diparse.

Pseudo-code:

```java
public void compileAllTemplates(Configuration cfg, List<String> templateNames) {
    for (String name : templateNames) {
        try {
            cfg.getTemplate(name);
        } catch (Exception e) {
            throw new IllegalStateException("Template failed to load/parse: " + name, e);
        }
    }
}
```

Ini menangkap:

- file missing,
- syntax error,
- include/import missing saat parse/load tertentu.

Tetapi tidak menangkap semua runtime missing variable.

### 15.2 Level 2: Render dengan Sample Model

Setiap template harus punya sample model.

```text
template: enforcement.warning.notice
model schema: warning-notice-v3
sample scenarios:
  - normal
  - with attachments
  - without optional remarks
  - multiple recipients
  - long address
  - localized en-SG
  - localized id-ID
```

Render semua sample.

```java
public void renderSamples(Renderer renderer, List<TemplateSample> samples) {
    for (TemplateSample sample : samples) {
        RenderResult result = renderer.render(sample.request());
        if (!result.success()) {
            throw new IllegalStateException("Sample render failed: " + sample.name());
        }
    }
}
```

### 15.3 Level 3: Contract Validation

Daripada hanya mengandalkan render sample, definisikan required fields.

Contoh contract:

```yaml
templateId: enforcement.warning.notice
modelSchemaVersion: warning-notice-v3
required:
  - recipient.displayName
  - case.referenceNo
  - notice.issueDate
  - notice.dueDate
  - officer.displayName
optional:
  - notice.remarks
  - attachments
```

Validasi sebelum render.

Mental model:

```text
Template should not discover missing critical data halfway through rendering.
```

### 15.4 Level 4: Output Semantic Validation

Untuk HTML:

- valid HTML structure,
- no forbidden raw placeholder,
- no unresolved `${...}` text,
- required headings exist,
- security-sensitive links valid.

Untuk XML:

- schema validation,
- well-formedness,
- namespace correctness.

Untuk email:

- subject not empty,
- plain text alternative exists,
- no test recipient in prod,
- no placeholder remains,
- unsubscribe/legal footer if required.

Untuk PDF pre-render HTML:

- required sections,
- page break markers,
- image references resolved,
- font availability.

---

## 16. Golden Output Testing

Golden output test membandingkan output render dengan expected fixture.

### 16.1 Basic Golden Test

```java
@Test
void rendersWarningNotice() throws Exception {
    Map<String, Object> model = sampleWarningNoticeModel();

    String actual = renderer.renderToString(
            "letters/enforcement/warning.ftl",
            model,
            Locale.forLanguageTag("en-SG")
    );

    String expected = Files.readString(Path.of("src/test/resources/golden/warning-notice.html"));
    assertEquals(normalizeHtml(expected), normalizeHtml(actual));
}
```

Untuk Java 8, `Files.readString` belum ada; gunakan:

```java
String expected = new String(
        Files.readAllBytes(Paths.get("src/test/resources/golden/warning-notice.html")),
        StandardCharsets.UTF_8
);
```

### 16.2 Normalization

HTML sering punya whitespace differences.

Normalisasi bisa meliputi:

- line endings,
- trailing spaces,
- repeated whitespace,
- dynamic timestamp placeholder,
- generated ID placeholder.

Tetapi jangan terlalu agresif sampai menyembunyikan bug.

### 16.3 Golden Test Anti-Pattern

Anti-pattern:

```java
assertTrue(actual.contains("Approved"));
```

Ini terlalu lemah.

Lebih baik kombinasikan:

1. full golden snapshot untuk stable document,
2. semantic assertions untuk dynamic sections,
3. security assertions untuk escaping,
4. negative assertions untuk forbidden values.

### 16.4 Golden Output untuk Legal/Regulatory Document

Untuk dokumen legal/regulatory, golden output harus mewakili:

- normal case,
- edge case address panjang,
- missing optional remarks,
- multiple offences/items,
- zero/empty optional attachment,
- unicode names,
- locale/timezone,
- long officer designation,
- boundary date/time.

---

## 17. Contract Test: Template vs Model Builder

Masalah umum:

Template berubah:

```ftl
${officer.designation}
```

Tetapi Java model builder belum menyediakan `officer.designation`.

Atau Java berubah:

```java
model.put("officerTitle", officer.getDesignation());
```

Tetapi template masih memakai `officer.designation`.

Golden test bisa menangkap jika scenario mencakup field tersebut. Tetapi contract test lebih eksplisit.

### 17.1 Required Field Declaration

Simpan contract:

```java
public final class TemplateContract {
    private final String templateId;
    private final String schemaVersion;
    private final Set<String> requiredPaths;
    private final Set<String> optionalPaths;
}
```

### 17.2 Validate Model Paths

Pseudo-code:

```java
public final class ModelContractValidator {

    public void validate(TemplateContract contract, Map<String, Object> model) {
        for (String path : contract.requiredPaths()) {
            if (!exists(model, path)) {
                throw new ModelContractException(
                        "Missing required render model path: " + path
                );
            }
        }
    }

    private boolean exists(Map<String, Object> model, String path) {
        String[] parts = path.split("\\.");
        Object current = model;

        for (String part : parts) {
            if (!(current instanceof Map)) {
                return false;
            }
            Map<?, ?> map = (Map<?, ?>) current;
            if (!map.containsKey(part) || map.get(part) == null) {
                return false;
            }
            current = map.get(part);
        }
        return true;
    }
}
```

Ini sederhana dan hanya mendukung Map. Untuk ViewModel object, validator perlu introspection controlled atau model diekspor ke canonical map.

### 17.3 Contract Test Value

Contract test memberi keuntungan:

- error lebih cepat,
- pesan lebih jelas,
- tidak menunggu expression dieksekusi,
- required/optional explicit,
- template version bisa dikaitkan ke schema version,
- business reviewer bisa melihat field requirement.

---

## 18. Template Linting dan Static Analysis

FreeMarker tidak selalu tahu semua masalah sebelum runtime, tetapi kita bisa membuat lint rules.

### 18.1 Lint Rules yang Berguna

Contoh forbidden patterns:

- `?no_esc` tanpa approval,
- `?api`,
- `?eval`,
- `#global`,
- `#setting` di template biasa,
- include path dynamic,
- raw service-like object access,
- terlalu banyak nested `#if`,
- macro terlalu panjang,
- template tanpa `output_format`,
- template email tanpa plain text alternative,
- `!""` pada field required.

### 18.2 Simple Regex Linter

Contoh basic:

```java
public final class FreemarkerTemplateLinter {

    private static final List<Rule> RULES = List.of(
            new Rule("NO_ESC", "\\?no_esc", "Avoid ?no_esc unless explicitly approved"),
            new Rule("API", "\\?api", "?api is forbidden in production templates"),
            new Rule("EVAL", "\\?eval", "?eval is forbidden in production templates"),
            new Rule("GLOBAL", "<#global\\b", "#global is forbidden in app templates")
    );

    public List<LintFinding> lint(String templateName, String source) {
        List<LintFinding> findings = new ArrayList<>();
        for (Rule rule : RULES) {
            Pattern pattern = Pattern.compile(rule.regex());
            Matcher matcher = pattern.matcher(source);
            while (matcher.find()) {
                findings.add(new LintFinding(templateName, rule.id(), rule.message(), matcher.start()));
            }
        }
        return findings;
    }
}
```

Java 8 compatibility note:

- `List.of` tidak ada di Java 8; gunakan `Arrays.asList`.
- `record` tidak ada; gunakan final class.

### 18.3 Linter Bukan Security Boundary Final

Regex linter bisa membantu, tetapi bukan sandbox.

Security tetap butuh:

- object wrapper allowlist,
- forbidden resolver,
- controlled template authoring,
- safe output format,
- review workflow,
- runtime policy.

---

## 19. Render Service Pattern dengan Error Handling Lengkap

Sekarang kita gabungkan.

### 19.1 Render Request

```java
public final class RenderRequest {
    private final String templateId;
    private final String templateVersion;
    private final Locale locale;
    private final ZoneId timezone;
    private final String outputFormat;
    private final Map<String, Object> model;
    private final String correlationId;

    // constructor/getters omitted
}
```

Untuk Java 8, `ZoneId` tersedia karena `java.time` ada sejak Java 8.

### 19.2 Render Result

```java
public final class RenderResult {
    private final String output;
    private final String contentType;
    private final int outputBytes;
    private final long durationMillis;

    // constructor/getters omitted
}
```

### 19.3 Renderer Implementation

```java
import freemarker.core.ParseException;
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

import java.io.IOException;
import java.io.StringWriter;
import java.util.HashMap;
import java.util.Map;

public final class FreeMarkerRenderingService {

    private final Configuration configuration;
    private final TemplateRegistry templateRegistry;
    private final ModelContractValidator contractValidator;
    private final RenderMetrics metrics;
    private final RenderLogger logger;

    public FreeMarkerRenderingService(
            Configuration configuration,
            TemplateRegistry templateRegistry,
            ModelContractValidator contractValidator,
            RenderMetrics metrics,
            RenderLogger logger
    ) {
        this.configuration = configuration;
        this.templateRegistry = templateRegistry;
        this.contractValidator = contractValidator;
        this.metrics = metrics;
        this.logger = logger;
    }

    public RenderResult render(RenderRequest request) {
        long startNanos = System.nanoTime();

        TemplateDescriptor descriptor = templateRegistry.resolve(
                request.templateId(),
                request.templateVersion(),
                request.locale()
        );

        try {
            contractValidator.validate(descriptor.contract(), request.model());

            Template template = configuration.getTemplate(
                    descriptor.templateName(),
                    request.locale()
            );

            Map<String, Object> root = new HashMap<>(request.model());
            root.put("_render", safeRenderMetadata(request, descriptor));

            StringWriter writer = new StringWriter(4096);
            template.process(root, writer);

            String output = writer.toString();
            long durationMillis = millisSince(startNanos);

            metrics.renderSuccess(request, descriptor, durationMillis, output.length());
            logger.renderSucceeded(request, descriptor, durationMillis, output.length());

            return new RenderResult(
                    output,
                    descriptor.contentType(),
                    output.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                    durationMillis
            );

        } catch (ModelContractException e) {
            throw fail(request, descriptor, RenderErrorType.TEMPLATE_CONTRACT_ERROR, startNanos, null, null, e);
        } catch (ParseException e) {
            throw fail(request, descriptor, RenderErrorType.TEMPLATE_PARSE_ERROR, startNanos, e.getLineNumber(), e.getColumnNumber(), e);
        } catch (TemplateException e) {
            throw fail(request, descriptor, RenderErrorType.TEMPLATE_RUNTIME_ERROR, startNanos, e.getLineNumber(), e.getColumnNumber(), e);
        } catch (IOException e) {
            throw fail(request, descriptor, RenderErrorType.TEMPLATE_IO_ERROR, startNanos, null, null, e);
        } catch (RuntimeException e) {
            throw fail(request, descriptor, RenderErrorType.UNKNOWN_RENDER_ERROR, startNanos, null, null, e);
        }
    }

    private TemplateRenderException fail(
            RenderRequest request,
            TemplateDescriptor descriptor,
            RenderErrorType type,
            long startNanos,
            Integer line,
            Integer column,
            Throwable cause
    ) {
        long durationMillis = millisSince(startNanos);

        metrics.renderFailed(request, descriptor, type, durationMillis);
        logger.renderFailed(request, descriptor, type, line, column, durationMillis, cause);

        return new TemplateRenderException(
                type,
                "Template rendering failed. correlationId=" + request.correlationId(),
                request.templateId(),
                request.templateVersion(),
                request.locale().toLanguageTag(),
                request.outputFormat(),
                line,
                column,
                cause
        );
    }

    private Map<String, Object> safeRenderMetadata(RenderRequest request, TemplateDescriptor descriptor) {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("templateId", request.templateId());
        metadata.put("templateVersion", descriptor.version());
        metadata.put("locale", request.locale().toLanguageTag());
        metadata.put("correlationId", request.correlationId());
        return metadata;
    }

    private long millisSince(long startNanos) {
        return java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
    }
}
```

Catatan:

- `StringWriter` cocok untuk output kecil/menengah.
- Untuk output sangat besar, gunakan streaming writer ke sink yang controlled.
- Jangan inject full internal diagnostic object ke template.
- `_render` harus safe, bukan channel untuk expose config/service.

---

## 20. Handling Error in MVC Web Page

Dalam Spring MVC/Jakarta web app, render bisa gagal saat view rendering.

Masalah umum:

- controller sukses,
- model dikirim ke view,
- FreeMarker gagal render,
- user melihat 500.

### 20.1 Recommended Behavior

Untuk user-facing page:

- log structured error,
- return generic error page,
- include reference/correlation ID,
- no template stack trace.

### 20.2 Error Controller Pattern

Pseudo:

```java
@ControllerAdvice
public final class RenderingExceptionAdvice {

    @ExceptionHandler(TemplateRenderException.class)
    public ModelAndView handleTemplateRenderException(TemplateRenderException ex) {
        ModelAndView mv = new ModelAndView("error/generic");
        mv.addObject("referenceId", currentCorrelationId());
        return mv;
    }
}
```

Caution:

Jika error page juga memakai FreeMarker dan error page template rusak, bisa terjadi recursive failure. Error page harus sangat sederhana dan sangat stabil.

Rule:

```text
Error templates must have minimal dependencies and must not depend on complex domain model.
```

Untuk critical fallback, pertimbangkan static HTML error response.

---

## 21. Handling Error in Email Rendering

Email rendering lebih kompleks karena ada dua tahap:

```text
render email content -> send email
```

Failure matrix:

| Render | Send | Meaning |
|---|---|---|
| fail | not attempted | template/model problem |
| success | fail | SMTP/provider problem |
| success | success | ok |
| partial? | should not happen | design issue |

Rule:

```text
Do not send partially rendered email.
```

### 21.1 Email Render Transaction Boundary

Jika domain transaction commit lalu email render gagal, apa yang terjadi?

Lebih aman:

```text
domain transaction commits event/outbox
   -> async notification worker picks event
   -> build model snapshot
   -> render
   -> send
   -> record outcome
```

Jika render gagal:

- mark notification as `RENDER_FAILED`,
- store error type and template version,
- do not retry infinitely if deterministic contract error,
- alert if active template broken,
- allow replay after template/model fix,
- keep idempotency key.

### 21.2 Retry Policy

Tidak semua render error layak retry.

| Error | Retry? |
|---|---:|
| template not found due deployment race | limited retry possible |
| parse error active template | no until fixed |
| missing required field | no until data/model fixed |
| IO transient loader error | yes limited |
| SMTP send fail | yes with idempotency |
| PDF converter timeout | yes maybe |

Rule:

```text
Retry transient infrastructure failures, not deterministic template contract failures.
```

---

## 22. Handling Error in Document/PDF Rendering

PDF/document pipelines sering punya tahap:

```text
FreeMarker HTML render -> HTML validation -> PDF conversion -> storage -> audit
```

Error harus diklasifikasi per stage.

| Stage | Error example | Action |
|---|---|---|
| HTML render | missing field | render failed |
| HTML validate | invalid markup | template failed |
| PDF convert | font missing | platform/config failed |
| PDF storage | S3/RDS/file fail | retry storage |
| audit record | DB fail | transactional/outbox decision |

Untuk regulatory document:

- jangan simpan dokumen partial,
- jangan mark as generated sebelum semua stage selesai,
- simpan template version dan model snapshot hash,
- simpan render timestamp,
- simpan generator version,
- simpan failure audit.

---

## 23. Correlation ID and Audit Trail

Rendering yang penting harus bisa diaudit.

### 23.1 Correlation ID

Correlation ID harus masuk ke:

- log,
- metric exemplar/tracing,
- render audit record,
- notification job,
- output metadata jika aman,
- user support reference.

### 23.2 Render Audit Record

Contoh fields:

```text
render_id
correlation_id
template_id
template_version
template_name
model_schema_version
output_format
locale
timezone
status
error_type
line
column
request_source
initiated_by
business_entity_type
business_entity_id
created_at
completed_at
duration_ms
output_hash
output_storage_ref
renderer_version
```

Sensitive design:

- `business_entity_id` mungkin confidential; kontrol akses.
- `output_storage_ref` harus protected.
- `output_hash` bisa membantu integrity verification tanpa membuka content.
- error detail harus redacted.

### 23.3 Immutable Record

Untuk dokumen resmi:

```text
If output was sent/stored, never silently regenerate and replace without audit.
```

Jika template diperbaiki, output lama tetap bagian dari history.

---

## 24. Debugging Playbook

Ketika template error muncul di production/UAT, jangan langsung patch template sembarangan. Ikuti playbook.

### 24.1 Step 1: Identify Failure Category

Tanya:

- template not found?
- parse error?
- runtime missing field?
- type mismatch?
- output IO?
- post-render conversion?

### 24.2 Step 2: Identify Blast Radius

- template id apa?
- version apa?
- locale apa?
- tenant/agency apa?
- sejak kapan?
- deployment apa yang berubah?
- hanya satu workflow state atau semua?
- hanya satu user/case atau semua?

### 24.3 Step 3: Reproduce with Safe Sample

Jangan copy raw production model jika mengandung PII. Gunakan:

- sanitized sample,
- synthetic reproduction,
- same schema version,
- same locale/timezone,
- same template version.

### 24.4 Step 4: Determine Fix Location

| Root cause | Fix location |
|---|---|
| template syntax | template file |
| missing model field | Java model builder/presenter |
| optional field wrongly required | template condition/contract |
| field renamed | contract + model/template migration |
| object wrapper blocked method | wrapper/model design |
| locale missing | message bundle/template locale |
| unsafe raw HTML | data sanitizer/template escaping |
| huge output | pagination/chunking/model design |

### 24.5 Step 5: Add Regression Test

Setiap production template bug harus menghasilkan minimal satu test:

- sample render test,
- contract test,
- golden output update,
- lint rule,
- migration check.

---

## 25. Common FreeMarker Error Patterns and Root Causes

### 25.1 `... evaluated to null or missing`

Likely root causes:

- model missing,
- wrong key name,
- null Java getter,
- object wrapper exposure issue,
- branch condition wrong,
- include expects variable not passed.

Fix:

- add required field validation,
- rename consistently,
- use optional check if truly optional,
- shape ViewModel explicitly.

### 25.2 `Expected a sequence or collection`

Template:

```ftl
<#list items as item>
```

But `items` is object/string/null.

Fix:

- ensure model field type stable,
- use empty list for no data,
- contract declares `items: list`,
- do not overload field with multiple types.

### 25.3 `Expected a hash, but this has evaluated to a string`

Template expects:

```ftl
${customer.name}
```

But model has:

```java
model.put("customer", "Fajar");
```

Fix:

- stable model schema,
- avoid polymorphic fields.

### 25.4 Include/Import Failure

Template:

```ftl
<#import "/components/forms.ftl" as forms>
```

Failure because file path changed.

Fix:

- template dependency validation,
- component library versioning,
- avoid dynamic import path.

### 25.5 Date/Number Formatting Surprise

Output:

```text
1,000,000
```

Instead of:

```text
1000000
```

Root cause:

- locale/number format config.

Fix:

- specify formatting policy,
- use explicit machine format for machine output,
- test locale matrix.

### 25.6 Silent Wrong Output

No exception, but output wrong.

Root causes:

- default operator hides missing field,
- too much logic in template,
- wrong branch condition,
- outdated template version,
- golden tests absent.

Fix:

- fail-fast required fields,
- reduce logic,
- add semantic tests.

---

## 26. Designing Error Pages and Fallback Templates

Error page/fallback template harus sangat simple.

### 26.1 Error Template Design

Good:

```ftl
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Something went wrong</title>
</head>
<body>
  <h1>Something went wrong</h1>
  <p>Please contact support with reference ID: ${referenceId}</p>
</body>
</html>
```

Model:

```java
Map.of("referenceId", correlationId)
```

### 26.2 Avoid Error Page Dependencies

Bad:

```ftl
<#import "/layouts/main.ftl" as layout>
<@layout.page title=msg("error.title") user=currentUser>
  ...
</@layout.page>
```

Kenapa buruk?

Karena error page bisa gagal karena:

- layout import broken,
- message key missing,
- user object missing,
- security dialect/model missing,
- navigation fragment throws.

Rule:

```text
Fallback/error templates should depend on almost nothing.
```

---

## 27. Java 8–25 Considerations

### 27.1 Java 8 Baseline

Yang tersedia:

- `java.time`,
- lambda/stream,
- `CompletableFuture`,
- no records,
- no var,
- no pattern matching,
- no virtual threads.

Untuk renderer library yang harus support Java 8:

- gunakan final class DTO,
- hindari records,
- hindari `List.of`,
- hindari pattern matching,
- logging/metrics API tetap compatible.

### 27.2 Java 11/17

Java 11+ memberi:

- better runtime baseline,
- `String` APIs tambahan,
- `Files.readString` Java 11,
- improved GC options.

Java 17 memberi:

- records stable,
- sealed classes,
- pattern matching instanceof,
- stronger long-term baseline.

Untuk internal error DTO, records berguna:

```java
public record RenderDiagnostic(
        String correlationId,
        String templateId,
        String templateVersion,
        String locale,
        String outputFormat,
        Integer line,
        Integer column,
        String errorType
) {}
```

### 27.3 Java 21/25

Java 21 membawa virtual threads sebagai feature final. Untuk rendering workload:

- template execution sendiri CPU + memory + writer bound,
- virtual threads tidak membuat CPU rendering lebih cepat,
- virtual threads bisa membantu jika pipeline banyak blocking I/O seperti loading template dari remote store, writing to storage, SMTP, PDF service call,
- tetap batasi concurrency agar tidak menghasilkan memory pressure.

Contoh desain:

```text
Virtual threads can improve thread scalability, not rendering algorithmic cost.
```

Java 25 sebagai target modern berarti:

- dokumentasi API terbaru,
- runtime improvement,
- tetap jaga library compatibility jika artifact harus jalan di Java 8.

---

## 28. Production Checklist

Gunakan checklist ini sebelum template rendering subsystem dianggap production-ready.

### 28.1 Configuration

- [ ] `TemplateExceptionHandler.RETHROW_HANDLER` di PROD.
- [ ] `setLogTemplateExceptions(false)` agar tidak double log.
- [ ] `setWrapUncheckedExceptions(true)`.
- [ ] default encoding UTF-8.
- [ ] output format/auto-escaping configured.
- [ ] template loader path deterministic.
- [ ] cache strategy jelas.
- [ ] DEV/PROD config tidak tertukar.

### 28.2 Error Handling

- [ ] Parse/load/runtime/IO errors diklasifikasikan.
- [ ] User-facing error aman.
- [ ] Internal diagnostic punya template id/version/line/column.
- [ ] Raw data model tidak masuk log.
- [ ] Error page sederhana dan stabil.
- [ ] `#attempt/#recover` hanya untuk optional fragment.

### 28.3 Observability

- [ ] Structured logs.
- [ ] Correlation ID.
- [ ] Render success/failure metrics.
- [ ] Latency histogram.
- [ ] Error type labels.
- [ ] Template version labels dengan cardinality terkendali.
- [ ] Tracing span untuk render pipeline.
- [ ] Alert untuk failure spike.

### 28.4 Validation and Testing

- [ ] Compile/preflight all active templates.
- [ ] Render sample scenarios.
- [ ] Contract validation required fields.
- [ ] Golden output tests.
- [ ] Locale/timezone tests.
- [ ] Escaping/security tests.
- [ ] Lint forbidden constructs.
- [ ] Regression tests for every production bug.

### 28.5 Governance

- [ ] Template version recorded.
- [ ] Approval workflow for business-owned templates.
- [ ] Rollback plan.
- [ ] Template dependency graph known.
- [ ] Audit record for generated official output.
- [ ] Immutable record for sent/stored document.

---

## 29. Mini Case Study: Enforcement Notice Rendering Failure

Bayangkan sistem case management punya event:

```text
CASE_ESCALATED_TO_WARNING_NOTICE
```

Notification worker memilih template:

```text
templateId = enforcement.warning.notice
templateVersion = 2026.06.19-1
locale = en-SG
outputFormat = HTML_FOR_PDF
```

Template memakai:

```ftl
Case Reference: ${case.referenceNo}
Respond by: ${notice.responseDueDate}
Officer: ${officer.displayName}, ${officer.designation}
```

Deployment baru mengubah model builder:

```java
officer.title
```

Sebelumnya:

```java
officer.designation
```

Rendering gagal:

```text
officer.designation missing
```

### 29.1 Bad System Behavior

- exception ignored,
- PDF tetap dibuat dengan blank designation,
- email dikirim,
- audit mark as success,
- user menerima notice cacat,
- issue ditemukan manual.

### 29.2 Good System Behavior

- contract validator mendeteksi missing `officer.designation`,
- render tidak dijalankan atau gagal fail-fast,
- notification status `RENDER_FAILED`,
- structured log berisi template id/version/line/column,
- alert muncul karena failure spike,
- no email sent,
- audit failure recorded,
- regression test ditambahkan,
- fix dilakukan di model builder atau template contract migration.

### 29.3 Better Preventive Design

- schema version `warning-notice-v3`,
- template contract declares `officer.designation`,
- PR changing model builder fails contract test,
- publish pipeline blocks template/model mismatch before deployment.

---

## 30. Key Takeaways

1. Template rendering failure harus diklasifikasikan, bukan hanya ditangkap sebagai generic exception.
2. Parse error, runtime error, model contract error, dan writer error punya root cause serta remediation berbeda.
3. Production FreeMarker sebaiknya memakai `RETHROW_HANDLER`, bukan debug handler atau ignore handler.
4. Jangan biarkan template stack trace bocor ke output user.
5. Jangan log raw data model.
6. Missing required fields harus fail-fast.
7. Default kosong hanya boleh untuk field cosmetic/optional yang benar-benar aman.
8. `#attempt/#recover` berguna untuk optional fragment, bukan official/legal/critical content.
9. Observability harus mencakup logs, metrics, tracing, correlation ID, template id/version, locale, output format, dan error type.
10. Preflight validation, contract test, golden output test, dan linting adalah bagian dari template engineering, bukan nice-to-have.
11. Rendering service harus punya error taxonomy dan audit model yang jelas.
12. Untuk email/document/workflow, render failure harus memengaruhi status job dan retry policy secara eksplisit.
13. Sistem top-tier tidak hanya “bisa render”; ia bisa membuktikan apa yang dirender, versi apa, dengan data contract apa, kapan gagal, kenapa gagal, dan apakah output aman digunakan.

---

## 31. Referensi

1. Apache FreeMarker Manual — Error handling: `TemplateExceptionHandler`, `RETHROW_HANDLER`, debug handlers, and production guidance.  
   `https://freemarker.apache.org/docs/pgui_config_errorhandling.html`
2. Apache FreeMarker Manual — Create a configuration instance: `setTemplateExceptionHandler`, `setLogTemplateExceptions(false)`, `setWrapUncheckedExceptions(true)`, UTF-8 encoding.  
   `https://freemarker.apache.org/docs/pgui_quickstart_createconfiguration.html`
3. Apache FreeMarker API — `TemplateExceptionHandler`.  
   `https://freemarker.apache.org/docs/api/freemarker/template/TemplateExceptionHandler.html`
4. Apache FreeMarker API — `TemplateException`, line/column diagnostic methods.  
   `https://freemarker.apache.org/docs/api/freemarker/template/TemplateException.html`
5. Apache FreeMarker Manual — `#attempt` / `#recover` directive.  
   `https://freemarker.apache.org/docs/ref_directive_attempt.html`
6. Apache FreeMarker Manual — FAQ on missing/null variable strictness and recoverable page fragments.  
   `https://freemarker.apache.org/docs/app_faq.html`
7. Apache FreeMarker Manual — Directive reference.  
   `https://freemarker.apache.org/docs/ref_directives.html`
8. Spring Framework Reference — FreeMarker view technology integration.  
   `https://docs.spring.io/spring-framework/reference/web/webmvc-view/mvc-freemarker.html`
9. OpenJDK / Oracle Java SE 25 Documentation — Java runtime/API baseline for current Java version references.  
   `https://docs.oracle.com/en/java/javase/25/`

---

## 32. Status Seri

```text
Part 9 selesai.
Seri belum selesai.
Berikutnya: Part 10 — FreeMarker Performance Engineering.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-008.md">⬅️ Part 8 — FreeMarker Output Formats, Auto-Escaping, XSS Defense, and HTML Safety</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-010.md">Part 10 — FreeMarker Performance Engineering ➡️</a>
</div>
