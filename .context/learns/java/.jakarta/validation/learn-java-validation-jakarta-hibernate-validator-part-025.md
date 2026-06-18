# learn-java-validation-jakarta-hibernate-validator-part-025

# Security and Abuse Resistance: Validation Is Not Sanitization

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: 025  
> Topik: Security boundary, input validation, sanitization, output encoding, abuse resistance, ReDoS, PII-safe validation, dan threat modeling  
> Target Java: 8 sampai 25  
> Fokus API: `javax.validation.*`, `jakarta.validation.*`, Hibernate Validator

---

## 1. Tujuan Part Ini

Part ini membahas satu kesalahan mental model yang sangat sering terjadi pada sistem production:

> "Sudah divalidasi, berarti aman."

Kalimat itu berbahaya.

Validation memang penting, tetapi validation **bukan** pengganti:

- authentication,
- authorization,
- sanitization,
- output encoding,
- escaping,
- parameterized query,
- CSRF protection,
- rate limiting,
- payload size limit,
- database constraint,
- transaction isolation,
- schema validation,
- malware scanning,
- policy enforcement,
- audit control.

Jakarta Validation dan Hibernate Validator membantu mendeklarasikan constraint pada object model, object graph, method parameter, constructor parameter, dan return value. Tetapi mereka tidak secara otomatis membuat sistem aman dari injection, data exfiltration, authorization bypass, denial-of-service, race condition, atau leakage data sensitif.

Setelah part ini, mental model yang diharapkan adalah:

1. Bisa membedakan **validation**, **sanitization**, **normalization**, **canonicalization**, dan **output encoding**.
2. Bisa menentukan rule mana yang cocok menjadi Jakarta Validation constraint dan mana yang harus berada di security/domain/persistence layer.
3. Bisa mendesain validation yang aman terhadap abuse: payload besar, nested graph, regex berat, expensive lookup, dan PII leakage.
4. Bisa membuat API error response yang membantu user tanpa memberi informasi berlebihan kepada attacker.
5. Bisa menempatkan validation sebagai bagian dari defense-in-depth, bukan sebagai satu-satunya defense.

---

## 2. Core Mental Model: Validation Is a Gate, Not a Shield

Validation adalah proses menjawab pertanyaan:

> "Apakah nilai ini memenuhi kontrak tertentu pada boundary tertentu?"

Contoh:

```java
public record RegisterApplicantRequest(
    @NotBlank
    @Size(max = 100)
    String fullName,

    @NotBlank
    @Email
    String email,

    @NotBlank
    @Pattern(regexp = "^[0-9]{6}$")
    String postalCode
) {}
```

Constraint di atas menjawab:

- `fullName` harus ada dan tidak kosong.
- `fullName` tidak boleh lebih dari 100 karakter.
- `email` harus berbentuk email secara umum.
- `postalCode` harus enam digit.

Tetapi constraint di atas **tidak** menjawab:

- Apakah user boleh mendaftarkan applicant ini?
- Apakah email milik user tersebut?
- Apakah email aman dari phishing?
- Apakah postal code benar-benar ada?
- Apakah nilai ini boleh ditampilkan langsung di HTML?
- Apakah `fullName` mengandung XSS payload?
- Apakah request ini bagian dari automation attack?
- Apakah user sedang mencoba enumeration?
- Apakah input ini akan aman jika masuk ke SQL dynamic query?

Validation hanya satu layer.

Security yang benar biasanya membutuhkan beberapa layer:

```text
[Network / Gateway]
  - TLS
  - WAF/rate limit
  - body size limit
  - header size limit

[Authentication]
  - identify actor
  - token/session validation

[Authorization]
  - can actor perform this action?
  - can actor access this resource?

[Parsing / Deserialization]
  - JSON/XML/form parsing
  - schema/type binding
  - unknown field handling

[Validation]
  - shape
  - size
  - requiredness
  - format
  - local semantic rule

[Canonicalization / Normalization]
  - trim policy
  - Unicode normalization
  - case folding if domain-safe

[Domain Policy]
  - business eligibility
  - workflow guard
  - state transition rule

[Persistence]
  - DB constraints
  - transaction isolation
  - optimistic lock

[Output]
  - context-specific encoding
  - redaction
  - safe logging
```

Validation adalah gate. Ia mengurangi input buruk. Tetapi attacker tetap dapat menyerang layer lain.

---

## 3. Istilah yang Sering Tertukar

### 3.1 Validation

Validation mengecek apakah data sesuai rule.

Contoh:

```java
@NotBlank
@Size(max = 200)
String title;
```

Artinya:

- title wajib ada,
- title tidak boleh blank,
- title maksimal 200 karakter.

Validation tidak mengubah data. Idealnya validation bersifat:

- deterministic,
- side-effect-free,
- explainable,
- cheap enough,
- safe to execute repeatedly.

### 3.2 Normalization

Normalization mengubah input menjadi bentuk yang konsisten.

Contoh:

```java
String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
```

Atau:

```java
String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Normalization menjawab:

> "Bentuk canonical apa yang akan disimpan/dibandingkan?"

Normalization harus hati-hati karena bisa mengubah makna data.

Contoh bahaya:

- Mengubah semua nama orang menjadi uppercase dapat merusak display name.
- Trim semua field dapat mengubah nilai password.
- Lowercase semua identifier bisa salah jika domain case-sensitive.
- Unicode normalization bisa berdampak pada matching, search, dan audit.

### 3.3 Canonicalization

Canonicalization adalah proses mengubah banyak representasi ke satu bentuk canonical sebelum security decision.

Contoh path traversal:

```text
/uploads/../secret.txt
```

Sebelum mengecek apakah path berada di folder allowed, path harus di-resolve/canonicalized dulu.

Validation regex saja tidak cukup untuk path/security-sensitive value.

### 3.4 Sanitization

Sanitization mencoba membersihkan input agar aman untuk konteks tertentu.

Contoh HTML sanitization:

- menerima subset HTML,
- menghapus `<script>`,
- menghapus event handler seperti `onclick`,
- mengizinkan tag tertentu saja.

Sanitization sulit. Jangan membuat sanitizer sendiri untuk HTML kompleks.

Validation berbeda dari sanitization:

```text
Validation   : "Apakah input ini diterima?"
Sanitization : "Bagaimana input ini dibersihkan agar aman dalam konteks tertentu?"
```

### 3.5 Escaping / Output Encoding

Output encoding mengubah data saat ditampilkan ke konteks output agar tidak dieksekusi sebagai kode.

Contoh HTML encoding:

```text
<        -> &lt;
>        -> &gt;
"        -> &quot;
'        -> &#x27;
&        -> &amp;
```

Untuk XSS, output encoding harus sesuai konteks:

- HTML body,
- HTML attribute,
- JavaScript string,
- CSS,
- URL,
- JSON,
- XML.

Validating input dengan `@Pattern` tidak menghilangkan kebutuhan output encoding.

---

## 4. Apa yang Jakarta Validation Bisa dan Tidak Bisa Lakukan

Jakarta Validation cocok untuk:

- requiredness,
- nullability,
- length/size,
- simple format,
- local object consistency,
- simple semantic constraints,
- container element validation,
- method precondition/postcondition,
- structured violation reporting.

Jakarta Validation tidak cukup untuk:

- preventing SQL injection,
- preventing XSS,
- enforcing authorization,
- checking ownership,
- preventing CSRF,
- enforcing DB uniqueness safely,
- handling malware upload,
- detecting account takeover,
- preventing brute-force attacks,
- making external API calls safely,
- controlling business workflow alone,
- proving regulatory eligibility without context.

Contoh:

```java
public record SearchRequest(
    @NotBlank
    @Size(max = 100)
    String keyword
) {}
```

Validation di atas membatasi ukuran dan keberadaan keyword. Tetapi SQL injection tetap harus dicegah dengan parameterized query:

```java
// Benar: parameterized query
jdbcTemplate.query(
    "select * from case_file where title like ?",
    ps -> ps.setString(1, "%" + keyword + "%"),
    rowMapper
);
```

Bukan dengan string concatenation:

```java
// Salah: validation bukan pembenar dynamic SQL concatenation
String sql = "select * from case_file where title like '%" + keyword + "%'";
```

Walaupun `keyword` divalidasi, dynamic concatenation tetap dangerous habit.

---

## 5. Security-Oriented Validation Taxonomy

Dalam sistem besar, validation dapat diklasifikasikan sebagai berikut.

### 5.1 Shape Validation

Menjawab:

> "Apakah struktur input sesuai kontrak?"

Contoh:

- field wajib ada,
- string tidak kosong,
- list maksimal 100 item,
- tanggal tidak null,
- enum dikenal.

Cocok untuk Jakarta Validation.

```java
public record SubmitCaseRequest(
    @NotBlank
    @Size(max = 50)
    String caseReferenceNo,

    @NotEmpty
    @Size(max = 20)
    List<@NotBlank @Size(max = 100) String> attachmentIds
) {}
```

### 5.2 Format Validation

Menjawab:

> "Apakah nilai mengikuti format yang diterima?"

Contoh:

- postal code enam digit,
- case reference pattern,
- phone number format,
- UUID format,
- ISO date.

Cocok untuk Jakarta Validation, tetapi regex harus aman dan bounded.

```java
@Pattern(regexp = "^[A-Z]{2}-[0-9]{6}-[0-9]{4}$")
String caseReferenceNo;
```

### 5.3 Semantic Validation

Menjawab:

> "Apakah nilai masuk akal secara domain lokal?"

Contoh:

- `startDate <= endDate`,
- `minAmount <= maxAmount`,
- jika `entityType = COMPANY`, maka `uen` required.

Cocok untuk class-level constraint atau command validator.

### 5.4 Contextual Validation

Menjawab:

> "Apakah nilai ini valid dalam konteks actor, resource, time, state, dan dependency saat ini?"

Contoh:

- user hanya boleh submit case miliknya,
- officer hanya boleh approve case dalam assigned division,
- case hanya boleh escalate jika sudah melewati SLA,
- attachment id harus milik application yang sama.

Biasanya **bukan** Jakarta Validation annotation murni. Lebih tepat di domain policy/application service.

### 5.5 Persistence Validation

Menjawab:

> "Apakah data final konsisten terhadap constraint storage?"

Contoh:

- unique key,
- foreign key,
- not null,
- check constraint,
- optimistic lock.

Harus ditegakkan oleh database juga.

### 5.6 Abuse-Resistance Validation

Menjawab:

> "Apakah input ini berpotensi membuat sistem mahal, lambat, bocor, atau mudah dieksploitasi?"

Contoh:

- payload terlalu besar,
- list terlalu panjang,
- nested object terlalu dalam,
- regex matching terlalu berat,
- string mengandung control characters,
- file upload terlalu besar,
- batch import terlalu banyak row,
- validation melakukan DB lookup per item.

Ini sering dilupakan oleh developer yang hanya fokus pada business correctness.

---

## 6. Validation vs SQL Injection

SQL injection tidak dicegah dengan annotation validation.

Contoh buruk:

```java
public List<CaseFile> search(SearchRequest request) {
    validator.validate(request);

    String sql = "select * from case_file where title like '%" + request.keyword() + "%'";
    return jdbcTemplate.query(sql, rowMapper);
}
```

Walaupun `keyword` punya:

```java
@NotBlank
@Size(max = 100)
String keyword
```

attacker masih bisa memasukkan karakter yang mengubah SQL jika query disusun dengan concatenation.

Solusi:

1. Validasi shape dan size.
2. Pakai parameterized query.
3. Hindari dynamic SQL yang menyisipkan value mentah.
4. Untuk dynamic column/order by, gunakan allow-list enum, bukan user string langsung.

Contoh aman untuk sort:

```java
public enum CaseSortField {
    CREATED_AT("created_at"),
    UPDATED_AT("updated_at"),
    REFERENCE_NO("reference_no");

    private final String column;

    CaseSortField(String column) {
        this.column = column;
    }

    public String column() {
        return column;
    }
}
```

Request:

```java
public record SearchCaseRequest(
    @Size(max = 100)
    String keyword,

    @NotNull
    CaseSortField sortBy
) {}
```

SQL:

```java
String sql = "select * from case_file where lower(title) like ? order by "
    + request.sortBy().column();
```

Di sini `sortBy` bukan raw string, melainkan enum allow-list.

---

## 7. Validation vs XSS

XSS terjadi ketika untrusted data ditampilkan dalam konteks browser dan diinterpretasikan sebagai code.

Misal user mengirim:

```text
<script>alert(1)</script>
```

Constraint berikut mungkin menerima input itu:

```java
@NotBlank
@Size(max = 200)
String displayName;
```

Apakah itu salah? Belum tentu.

Nama orang bisa mengandung banyak karakter. Tidak semua aplikasi harus melarang `<` atau `>` di semua field. Yang wajib adalah output encoding saat data ditampilkan.

Contoh aman secara konsep:

```html
<span>${htmlEncodedDisplayName}</span>
```

Bukan:

```html
<span>${rawDisplayName}</span>
```

Untuk field yang memang hanya boleh subset karakter tertentu, allow-list validation masuk akal:

```java
@Pattern(regexp = "^[A-Za-z0-9 .,'-]{1,100}$")
String shortDisplayLabel;
```

Tetapi jangan menjadikan allow-list terlalu agresif untuk semua field karena dapat merusak usability, internationalization, dan legal names.

Prinsip:

```text
Input validation reduces unacceptable values.
Output encoding prevents data from becoming executable code in a target context.
```

Keduanya berbeda dan sama-sama diperlukan.

---

## 8. Validation vs Command Injection

Command injection terjadi ketika input user masuk ke shell command.

Contoh buruk:

```java
String cmd = "convert " + inputFile + " " + outputFile;
Runtime.getRuntime().exec(cmd);
```

Constraint seperti ini tidak cukup:

```java
@NotBlank
@Size(max = 255)
String inputFile;
```

Solusi:

- Hindari shell jika bisa.
- Gunakan API/library langsung.
- Jika harus menjalankan proses, gunakan argument array, bukan shell string.
- Canonicalize path.
- Restrict base directory.
- Allow-list extension.
- Generate server-side filename.
- Jangan percaya filename dari user.

Contoh lebih aman:

```java
Path baseDir = Path.of("/app/uploads").toRealPath();
Path requested = baseDir.resolve(userProvidedFileName).normalize();

if (!requested.startsWith(baseDir)) {
    throw new SecurityException("Invalid file path");
}

ProcessBuilder pb = new ProcessBuilder(
    "convert",
    requested.toString(),
    outputPath.toString()
);
```

Validation annotation hanya satu bagian:

```java
@Pattern(regexp = "^[A-Za-z0-9._-]{1,100}$")
String fileName;
```

Tetapi path safety tetap butuh canonicalization dan base directory check.

---

## 9. Validation vs Path Traversal

Path traversal payload:

```text
../../etc/passwd
..%2F..%2Fsecret
```

Jangan hanya melakukan:

```java
@Size(max = 255)
String fileName;
```

Lebih aman:

1. Jangan gunakan user filename sebagai storage path utama.
2. Generate object key server-side.
3. Jika user boleh memberi nama file display, simpan sebagai metadata display name.
4. Jika harus membaca path dari input, canonicalize/normalize lalu pastikan berada di base directory.

Contoh:

```java
public Path resolveSafePath(Path baseDir, String fileName) throws IOException {
    Path realBase = baseDir.toRealPath();
    Path resolved = realBase.resolve(fileName).normalize();

    if (!resolved.startsWith(realBase)) {
        throw new SecurityException("Path escapes base directory");
    }

    return resolved;
}
```

Annotation bisa membantu mempersempit input:

```java
@Pattern(regexp = "^[A-Za-z0-9._-]{1,100}$")
String fileName;
```

Tetapi jangan mengandalkan regex sebagai satu-satunya perlindungan path.

---

## 10. Validation vs Authorization

Ini salah satu kesalahan paling berbahaya.

Contoh:

```java
public record ApproveCaseRequest(
    @NotNull Long caseId,
    @NotBlank String decision
) {}
```

Validation memastikan `caseId` dan `decision` ada. Tetapi authorization menjawab:

- Apakah actor authenticated?
- Apakah actor punya role approver?
- Apakah actor assigned ke case ini?
- Apakah actor bukan maker yang sama?
- Apakah division actor sesuai jurisdiction?
- Apakah case sedang berada di state approvable?

Jangan membuat annotation seperti ini untuk menggantikan authorization:

```java
@CanApproveCase
Long caseId;
```

Itu biasanya buruk karena:

- validator butuh actor context,
- validator perlu akses DB,
- validator mencampur authorization dengan shape validation,
- error semantics menjadi kacau antara 400/403/409,
- sulit diaudit,
- sulit dites,
- rentan caching/context leakage.

Lebih baik:

```java
public ApprovalResult approve(Actor actor, ApproveCaseCommand command) {
    validateShape(command);

    CaseFile caseFile = caseRepository.getForUpdate(command.caseId());

    authorizationPolicy.assertCanApprove(actor, caseFile);
    workflowPolicy.assertCanApprove(caseFile, command.decision());

    caseFile.approve(actor, command.decision());
    repository.save(caseFile);

    return ApprovalResult.success(caseFile.id());
}
```

Layer jelas:

```text
Shape validation     -> 400/422
Authorization        -> 403
Workflow conflict    -> 409
Persistence conflict -> 409/500 depending classification
```

---

## 11. Validation vs Uniqueness and Race Conditions

Contoh umum:

```java
@UniqueEmail
String email;
```

Validator:

```java
public boolean isValid(String email, ConstraintValidatorContext context) {
    return !userRepository.existsByEmail(email);
}
```

Masalah:

```text
T1: validate email available -> true
T2: validate email available -> true
T1: insert email -> success
T2: insert email -> duplicate
```

Validation tidak bisa menjamin uniqueness dalam kondisi concurrency.

Solusi benar:

1. Optional pre-check untuk UX.
2. Unique constraint di database tetap wajib.
3. Tangkap DB constraint violation.
4. Map ke stable error code.

Contoh:

```sql
alter table app_user add constraint uk_app_user_email unique (email);
```

Application:

```java
try {
    userRepository.save(user);
} catch (DuplicateKeyException ex) {
    throw new ConflictException("USER_EMAIL_ALREADY_EXISTS");
}
```

Pre-check boleh ada, tetapi jangan dianggap correctness guarantee.

---

## 12. Validation and Regex: Useful but Dangerous

Regex sangat berguna untuk format validation:

```java
@Pattern(regexp = "^[0-9]{6}$")
String postalCode;
```

Regex sederhana seperti itu aman.

Masalah muncul saat regex:

- terlalu kompleks,
- punya nested quantifier,
- punya alternation ambiguous,
- memakai backtracking berat,
- menerima input panjang,
- dipanggil pada hot path,
- dipublikasikan ke API spec sehingga attacker tahu pola server.

Contoh pola berisiko:

```text
^(a+)+$
```

Input buruk:

```text
aaaaaaaaaaaaaaaaaaaaa!
```

Backtracking bisa sangat mahal.

Prinsip regex aman:

1. Batasi panjang input sebelum regex.
2. Hindari nested quantifier ambiguous.
3. Prefer allow-list sederhana.
4. Hindari regex raksasa untuk business logic.
5. Test regex dengan adversarial input.
6. Gunakan parser khusus untuk format kompleks.
7. Jangan gunakan regex untuk HTML/XML/JSON parsing kompleks.

Contoh baik:

```java
@NotBlank
@Size(max = 20)
@Pattern(regexp = "^[A-Z0-9_-]+$")
String referenceNo;
```

Urutan konseptual:

```text
size bound first -> regex second
```

Dalam Jakarta Validation, urutan constraint dalam group yang sama tidak boleh menjadi dependency correctness. Jika perlu gating eksplisit, pakai group sequence atau manual staged validation.

---

## 13. Size Limits Are Security Controls

Banyak sistem hanya menambahkan:

```java
@NotBlank
String comment;
```

Itu tidak cukup.

Tanpa size limit, attacker dapat mengirim:

- string sangat panjang,
- list sangat besar,
- map sangat besar,
- nested object sangat dalam,
- base64 payload raksasa,
- banyak attachment id,
- banyak filter criteria,
- banyak batch row.

Size limit adalah security control.

Contoh:

```java
public record SubmitCommentRequest(
    @NotBlank
    @Size(max = 4000)
    String comment
) {}
```

Untuk list:

```java
public record BulkAssignRequest(
    @NotEmpty
    @Size(max = 500)
    List<@NotNull Long> caseIds,

    @NotNull
    Long officerId
) {}
```

Untuk nested object:

```java
public record SearchRequest(
    @Size(max = 20)
    List<@Valid FilterCriterion> filters
) {}
```

Security mindset:

```text
Every unbounded collection is a possible DoS input.
Every unbounded string is a possible memory/log/indexing problem.
Every unbounded regex input is a possible CPU problem.
Every unbounded cascade is a possible traversal problem.
```

---

## 14. Cascaded Validation as DoS Surface

`@Valid` dapat membuat validator menelusuri object graph.

Contoh:

```java
public record ImportRequest(
    @Valid
    List<RowDto> rows
) {}
```

Ini kurang aman karena list tidak dibatasi.

Lebih baik:

```java
public record ImportRequest(
    @NotEmpty
    @Size(max = 1000)
    List<@Valid RowDto> rows
) {}
```

Tetapi bahkan 1000 row bisa mahal jika tiap row punya nested object dan regex kompleks.

Untuk import besar, pattern yang lebih baik:

```text
1. Validate envelope: file size, format, row count upper bound.
2. Parse streaming if possible.
3. Validate per row with bounded error accumulation.
4. Stop after max errors.
5. Return summarized error report.
6. Store detailed report safely if needed.
```

Jangan selalu validasi seluruh object graph dalam satu call jika graph besar.

---

## 15. File Upload Validation

File upload tidak cukup dengan:

```java
@NotBlank
String fileName;
```

Hal yang perlu divalidasi/dikontrol:

- max file size,
- allowed content type,
- actual file signature/magic bytes,
- extension allow-list,
- filename display safety,
- malware scanning,
- storage path safety,
- object key generation,
- decompression bomb protection,
- image processing limits,
- PDF/script active content policy,
- attachment count limit,
- per-user quota,
- retention policy,
- audit classification.

Contoh DTO metadata:

```java
public record UploadMetadataRequest(
    @NotBlank
    @Size(max = 255)
    String originalFileName,

    @NotBlank
    @Size(max = 100)
    String declaredContentType,

    @NotNull
    @Positive
    @Max(10 * 1024 * 1024)
    Long declaredSizeBytes
) {}
```

Tetapi actual file validation harus dilakukan terhadap stream/content, bukan hanya metadata request.

Untuk filename:

- simpan original filename sebagai display metadata setelah sanitization/escaping policy,
- generate server-side storage key,
- jangan gunakan original filename sebagai filesystem path.

---

## 16. Error Response as Security Boundary

Validation error bisa bocor informasi.

Contoh buruk:

```json
{
  "field": "password",
  "message": "Password 'MySecret123!' is too weak"
}
```

Atau:

```json
{
  "field": "email",
  "rejectedValue": "victim@example.com",
  "message": "Email already exists in tenant ACME"
}
```

Masalah:

- membocorkan PII,
- membantu enumeration,
- membocorkan business rule internal,
- membocorkan tenant/resource existence,
- membocorkan internal regex/policy,
- membocorkan rejected secret.

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "traceId": "01JXYZ...",
  "violations": [
    {
      "path": "password",
      "code": "PASSWORD_POLICY_NOT_MET",
      "message": "Password does not meet the required policy."
    }
  ]
}
```

Untuk rejected value:

```text
Default: do not return rejectedValue.
Exception: safe enum/simple public fields if there is clear need.
Never return secrets, tokens, password, NRIC/NIK/passport, full email, phone, address, attachment content.
```

---

## 17. PII-Safe Logging of Validation Failures

Log validation failures berguna untuk observability, tetapi bisa menjadi data breach.

Jangan log:

```java
log.warn("Validation failed: {}", violations);
```

Karena `ConstraintViolation` dapat mengandung invalid value tergantung cara toString/provider/logging.

Lebih aman:

```java
for (ConstraintViolation<?> violation : violations) {
    log.warn(
        "Validation failed path={} constraint={} code={} traceId={}",
        violation.getPropertyPath(),
        violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName(),
        resolveErrorCode(violation),
        traceId
    );
}
```

Untuk metrics:

```text
validation.failure.count{endpoint="/cases", code="CASE_REF_INVALID"}
```

Jangan jadikan raw field value sebagai label metrics. Itu bisa menyebabkan:

- PII leakage,
- cardinality explosion,
- storage blowup,
- expensive query.

---

## 18. Enumerability and Account Discovery

Validation response dapat membantu attacker melakukan enumeration.

Contoh register:

```json
{
  "field": "email",
  "code": "EMAIL_ALREADY_REGISTERED"
}
```

Untuk beberapa domain, itu acceptable untuk UX. Untuk domain sensitif, lebih aman:

```json
{
  "message": "If the email can be used, you will receive further instructions."
}
```

Decision tergantung domain:

- consumer SaaS: mungkin acceptable dengan rate limit.
- banking/gov/health: hati-hati.
- login/reset password: jangan membocorkan account existence.

Validation bukan hanya correctness. Ia juga bagian dari attacker feedback channel.

---

## 19. Allow-List vs Deny-List

Security validation biasanya lebih baik dengan allow-list.

Deny-list buruk:

```java
@Pattern(regexp = "^(?!.*script).*$")
String comment;
```

Masalah:

- mudah dibypass,
- case variation,
- encoding variation,
- Unicode trick,
- konteks berbeda,
- false positive.

Allow-list baik untuk field dengan format ketat:

```java
@Pattern(regexp = "^[A-Z0-9_-]{1,30}$")
String publicReference;
```

Tetapi allow-list tidak selalu cocok untuk free text. Untuk free text:

- batasi panjang,
- batasi control characters jika perlu,
- simpan raw/canonical sesuai policy,
- output encode saat display,
- sanitize jika rich text allowed,
- moderate jika user-generated content publik.

---

## 20. Unicode, Homoglyph, and Control Characters

Modern Java string adalah Unicode. Security validation yang hanya berpikir ASCII bisa salah.

Risiko:

- homoglyph spoofing,
- invisible character,
- zero-width joiner,
- right-to-left override,
- mixed script identifier,
- visually confusing reference number,
- log forging,
- newline injection,
- CSV formula injection.

Contoh field bebas:

```java
@NotBlank
@Size(max = 200)
String displayName;
```

Mungkin valid secara business, tetapi untuk identifier publik sebaiknya lebih ketat:

```java
@Pattern(regexp = "^[A-Z0-9-]{8,30}$")
String publicCaseReference;
```

Untuk log forging, hati-hati dengan newline:

```text
hello
WARN fake log line
```

Solusi:

- structured logging,
- escape control characters dalam log,
- jangan log raw user input,
- allow-list identifier,
- normalize hanya jika domain membutuhkan.

---

## 21. CSV/Excel Formula Injection

Jika validation output atau exported data dibuka di spreadsheet, nilai yang diawali dengan karakter tertentu bisa dieksekusi sebagai formula.

Contoh input:

```text
=HYPERLINK("http://evil", "click")
+cmd|' /C calc'!A0
@SUM(1+1)
```

Bean Validation tidak otomatis melindungi CSV export.

Mitigasi:

- escape untuk CSV dengan benar,
- prefix dangerous spreadsheet formula values sesuai policy,
- treat exported user content as untrusted,
- jangan membuka file export internal tanpa kontrol,
- buat export encoder khusus.

Validation dapat membatasi beberapa field identifier, tetapi free text export tetap butuh output-context handling.

---

## 22. JSON/XML Deserialization and Validation

Validation terjadi setelah parsing/binding. Banyak serangan terjadi sebelum validation berjalan.

Risiko parsing:

- payload terlalu besar,
- deeply nested JSON,
- duplicate keys,
- unknown fields,
- polymorphic deserialization,
- XML external entity,
- entity expansion,
- type confusion,
- date parsing ambiguity.

Jakarta Validation tidak menyelesaikan semua itu.

Kontrol yang dibutuhkan:

- request body size limit,
- parser nesting depth limit jika tersedia,
- disable unsafe polymorphic deserialization,
- reject unknown fields jika API contract strict,
- schema validation bila relevan,
- safe XML parser config,
- streaming parse untuk payload besar.

Contoh Jackson strictness:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Tetapi compatibility harus dipikirkan. Public API kadang memilih tolerant reader untuk forward compatibility.

---

## 23. Validation for Search and Filter APIs

Search endpoint sering menjadi abuse vector.

Contoh request:

```java
public record CaseSearchRequest(
    String keyword,
    List<Filter> filters,
    List<Sort> sorts,
    Integer page,
    Integer size
) {}
```

Security-focused validation:

```java
public record CaseSearchRequest(
    @Size(max = 100)
    String keyword,

    @Size(max = 20)
    List<@Valid Filter> filters,

    @Size(max = 5)
    List<@Valid Sort> sorts,

    @Min(0)
    @Max(10_000)
    int page,

    @Min(1)
    @Max(100)
    int size
) {}
```

Tambahan yang tidak cukup dengan annotation:

- allow-list searchable fields,
- allow-list operators,
- query cost guard,
- timeout,
- index-aware search design,
- rate limit,
- pagination limit,
- no unbounded export,
- async export for large result.

Jangan biarkan user membangun query arbitrary terhadap database internal.

---

## 24. Validation for Batch APIs

Batch endpoint rentan terhadap asymmetric cost:

```text
Attacker sends one request with 10,000 IDs.
Server performs 10,000 DB lookups.
```

Basic DTO:

```java
public record BulkActionRequest(
    @NotEmpty
    @Size(max = 500)
    List<@NotNull Long> ids
) {}
```

Tambahan:

- deduplicate IDs,
- max unique IDs,
- batch DB query instead of per-id query,
- limit error details,
- stop after max errors,
- async processing for large jobs,
- actor quota,
- idempotency key,
- audit summary.

Custom validator yang melakukan repository call per ID adalah anti-pattern performance/security.

Buruk:

```java
for (Long id : ids) {
    repository.existsById(id); // N calls during validation
}
```

Lebih baik:

```java
Set<Long> uniqueIds = new HashSet<>(ids);
Map<Long, CaseFile> cases = repository.findAllByIdIn(uniqueIds);
policy.evaluateBulk(actor, cases);
```

---

## 25. Password Validation: Do Not Overfit Annotation Rules

Password policy sering dibuat seperti ini:

```java
@NotBlank
@Size(min = 8, max = 64)
@Pattern(regexp = "^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).+$")
String password;
```

Itu umum, tetapi belum tentu ideal.

Pertimbangan security:

- panjang maksimum jangan terlalu kecil,
- jangan trim password diam-diam,
- jangan log rejected password,
- jangan return rejected value,
- cek breached password list jika domain membutuhkan,
- rate limit login/reset,
- hashing menggunakan algorithm modern,
- password validation bukan authentication security lengkap.

Untuk password, custom validator boleh dipakai untuk local policy, tetapi dependency eksternal seperti breached password API harus hati-hati:

- latency,
- privacy,
- availability,
- failure mode,
- timeout,
- caching,
- do not leak password.

---

## 26. Validation for Identifiers

Identifier yang terlihat publik harus lebih ketat daripada free text.

Contoh:

```java
@Pattern(regexp = "^[A-Z]{2}[0-9]{8}$")
String publicCaseNo;
```

Kenapa?

- mengurangi spoofing,
- memudahkan support,
- aman untuk URL/log/display,
- mudah di-index,
- mengurangi ambiguity.

Tetapi jangan mengekspos sequential ID jika bisa memicu enumeration.

Buruk:

```text
/cases/1001
/cases/1002
/cases/1003
```

Lebih baik untuk public reference:

```text
/cases/CS-7F3K-9Q2M
```

Validation memastikan format, tetapi authorization tetap wajib memastikan actor boleh akses resource.

---

## 27. Validation and Rate Limiting

Validation tidak mencegah brute force.

Contoh OTP request:

```java
public record VerifyOtpRequest(
    @NotBlank
    @Pattern(regexp = "^[0-9]{6}$")
    String otp
) {}
```

Constraint memastikan OTP enam digit. Tetapi attacker masih bisa mencoba 000000 sampai 999999.

Diperlukan:

- rate limit per user/IP/device/session,
- attempt counter,
- lockout/backoff,
- expiry,
- replay prevention,
- audit event,
- anomaly detection.

Validation hanya memastikan format OTP.

---

## 28. Validation and CSRF

CSRF bukan masalah format field.

Request bisa valid secara DTO tetapi tidak legitimate secara user intent.

Diperlukan:

- CSRF token untuk cookie-based browser session,
- SameSite cookie policy,
- origin/referrer validation sebagai tambahan,
- double submit/session-bound token jika sesuai.

Jakarta Validation tidak menyelesaikan CSRF.

---

## 29. Validation and SSRF

Constraint seperti `@URL` tidak membuat URL aman untuk di-fetch server.

Contoh:

```java
@URL
String callbackUrl;
```

Masalah:

- URL bisa menuju internal metadata service,
- localhost,
- private IP,
- DNS rebinding,
- redirect chain,
- alternate scheme,
- IPv6 literal,
- encoded host trick.

Untuk server-side fetch, butuh SSRF defense:

- allow-list domain,
- restrict schemes,
- resolve DNS safely,
- block private/link-local IP,
- no automatic redirects or validate each redirect,
- network egress control,
- timeout,
- response size limit,
- no credential forwarding.

Validation format URL hanya langkah awal.

---

## 30. Validation and Business Rule Leakage

Terlalu detail dalam error message bisa membocorkan rule internal.

Contoh:

```json
{
  "code": "ESCALATION_DENIED",
  "message": "Case cannot be escalated because fraudScore=72, threshold=80, watchlist=false, officerLevel=2"
}
```

Itu mungkin berguna untuk internal officer, tetapi berbahaya untuk external user.

Strategi:

- internal vs external error detail berbeda,
- rule id stabil,
- trace id untuk support,
- detailed evidence hanya di audit/internal system,
- user-facing message dibuat aman.

Contoh external:

```json
{
  "code": "CASE_NOT_ELIGIBLE_FOR_ESCALATION",
  "message": "The case is not eligible for escalation at this stage."
}
```

Internal audit:

```json
{
  "ruleId": "WF_ESCALATION_004",
  "ruleVersion": "2026-04-01",
  "evidence": {
    "caseStatus": "OPEN",
    "slaBreached": false,
    "actorRole": "OFFICER"
  }
}
```

---

## 31. Secure Constraint Design Principles

Custom constraint harus memenuhi prinsip berikut.

### 31.1 Side-Effect-Free

Validator tidak boleh mengubah state.

Buruk:

```java
public boolean isValid(String token, ConstraintValidatorContext context) {
    tokenRepository.markUsed(token); // side effect
    return true;
}
```

### 31.2 Deterministic

Input sama dan context sama menghasilkan output sama.

Jika validator tergantung waktu, gunakan `ClockProvider`/`Clock` agar testable.

### 31.3 Bounded Cost

Validator tidak boleh punya cost tak terbatas.

Hindari:

- unbounded regex,
- recursive traversal custom,
- per-element DB call,
- remote API call tanpa timeout,
- loading large entity graph.

### 31.4 PII-Safe

Validator tidak boleh memasukkan raw sensitive value ke message.

Buruk:

```java
context.buildConstraintViolationWithTemplate(
    "Invalid NRIC: " + value
);
```

Baik:

```java
context.buildConstraintViolationWithTemplate(
    "{identityNumber.invalid}"
);
```

### 31.5 Context-Appropriate

Jangan memasukkan authorization ke Bean Validation.

### 31.6 Stable Error Contract

Expose code, bukan hanya natural language message.

---

## 32. Bad Example: Security Smell in Custom Validator

```java
public class ValidAttachmentValidator
    implements ConstraintValidator<ValidAttachment, String> {

    @Autowired
    private AttachmentRepository attachmentRepository;

    @Autowired
    private SecurityContext securityContext;

    @Override
    public boolean isValid(String attachmentId, ConstraintValidatorContext context) {
        if (attachmentId == null) {
            return true;
        }

        Attachment attachment = attachmentRepository.findById(attachmentId).orElse(null);
        if (attachment == null) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(
                "Attachment " + attachmentId + " does not exist"
            ).addConstraintViolation();
            return false;
        }

        return attachment.ownerId().equals(securityContext.currentUserId());
    }
}
```

Masalah:

- DB lookup dalam validator.
- Authorization disembunyikan sebagai validation.
- Error message membocorkan existence.
- `attachmentId` raw masuk message.
- Security context di validator berisiko implicit dependency.
- Sulit membedakan 400, 403, 404, 409.
- Race condition: attachment bisa berubah setelah validation.

Lebih baik:

```java
public record SubmitEvidenceRequest(
    @NotEmpty
    @Size(max = 20)
    List<@NotBlank @Size(max = 64) String> attachmentIds
) {}
```

Service:

```java
public void submitEvidence(Actor actor, SubmitEvidenceCommand command) {
    validateShape(command.request());

    Set<String> ids = Set.copyOf(command.request().attachmentIds());
    Map<String, Attachment> attachments = attachmentRepository.findAccessibleCandidates(ids);

    AttachmentPolicyDecision decision = attachmentPolicy.canAttachAll(
        actor,
        command.caseFile(),
        ids,
        attachments
    );

    if (!decision.allowed()) {
        throw decision.toException();
    }

    caseFile.attachEvidence(attachments.values());
}
```

Layering lebih jelas.

---

## 33. Good Example: Security-Conscious DTO Validation

```java
public record SubmitCaseRequest(
    @NotBlank(message = "{case.title.required}")
    @Size(max = 200, message = "{case.title.tooLong}")
    String title,

    @NotBlank(message = "{case.description.required}")
    @Size(max = 4000, message = "{case.description.tooLong}")
    String description,

    @NotEmpty(message = "{case.categories.required}")
    @Size(max = 5, message = "{case.categories.tooMany}")
    List<@NotBlank @Size(max = 50) String> categories,

    @Size(max = 20, message = "{case.attachments.tooMany}")
    List<@NotBlank @Size(max = 64) String> attachmentIds
) {}
```

Yang baik:

- semua free text bounded,
- collection bounded,
- nested element bounded,
- tidak ada DB call dalam annotation,
- tidak ada ownership check di annotation,
- message memakai bundle key,
- tidak memasukkan raw value ke message.

Layer berikutnya:

```java
public CaseId submit(Actor actor, SubmitCaseRequest request) {
    validate(request);

    CaseSubmissionPolicy.Decision decision = policy.evaluate(actor, request);
    if (!decision.allowed()) {
        throw decision.toException();
    }

    CaseFile caseFile = CaseFile.create(...);
    repository.save(caseFile);
    return caseFile.id();
}
```

---

## 34. Secure API Error Model

Model error yang lebih aman:

```java
public record ApiValidationError(
    String path,
    String code,
    String message,
    String severity
) {}

public record ApiProblem(
    String type,
    String title,
    int status,
    String traceId,
    List<ApiValidationError> violations
) {}
```

Hindari default expose:

```java
Object rejectedValue;
```

Jika perlu expose rejected value, lakukan allow-list per field.

Contoh mapper:

```java
private ApiValidationError toApiError(ConstraintViolation<?> violation) {
    String code = resolveStableCode(violation);
    String path = normalizePath(violation.getPropertyPath());
    String safeMessage = violation.getMessage();

    return new ApiValidationError(
        path,
        code,
        safeMessage,
        resolveSeverity(violation)
    );
}
```

---

## 35. Validation and Logging Correlation

Security-grade validation observability perlu correlation id.

Request:

```text
X-Correlation-ID: 01J...
```

Log:

```text
validation_failed traceId=01J... endpoint=/cases code=CASE_TITLE_TOO_LONG path=title actorType=EXTERNAL
```

Tidak perlu:

```text
title=<raw title>
```

Untuk support/audit, simpan evidence aman:

- length,
- classification,
- count,
- rule id,
- rule version,
- actor type,
- channel,
- endpoint,
- timestamp.

Contoh:

```json
{
  "eventType": "VALIDATION_REJECTED",
  "traceId": "01J...",
  "ruleId": "CASE_TITLE_MAX_LENGTH",
  "ruleVersion": "2026-01-01",
  "path": "title",
  "actualLength": 512,
  "maxLength": 200,
  "actorType": "EXTERNAL_USER"
}
```

Ini lebih aman daripada menyimpan full rejected title.

---

## 36. Security Threat Modeling for Validation

Saat review validation, tanyakan:

### 36.1 Input Size

- Apakah semua string punya batas?
- Apakah semua collection punya batas?
- Apakah nested graph punya batas?
- Apakah file upload punya batas?
- Apakah batch request punya batas?

### 36.2 Input Cost

- Apakah ada regex kompleks?
- Apakah ada DB call di validator?
- Apakah ada external API call di validator?
- Apakah ada per-item lookup?
- Apakah ada cascade ke graph besar?

### 36.3 Feedback Leakage

- Apakah error membocorkan account/resource existence?
- Apakah rejected value dikembalikan?
- Apakah message membocorkan policy internal?
- Apakah log menyimpan PII?

### 36.4 Context Boundary

- Apakah authorization disembunyikan sebagai validation?
- Apakah workflow guard disembunyikan di annotation group?
- Apakah DB uniqueness dianggap selesai oleh pre-check?
- Apakah validation dipakai sebagai pengganti transaction?

### 36.5 Output Context

- Di mana nilai akan ditampilkan?
- Apakah output encoding dilakukan?
- Apakah CSV/PDF/email/export punya encoding policy?
- Apakah rich text disanitasi dengan library yang benar?

---

## 37. Java 8 sampai Java 25 Notes

### Java 8

- Bean Validation 2.0 relevan untuk Java 8-era stack.
- Type-use constraints dan container element constraints mulai penting.
- Legacy apps sering memakai `javax.validation`.
- Banyak sistem Java 8 belum punya strict input size discipline.

### Java 11

- Banyak enterprise stack masih di Java 11 dengan Spring Boot 2.x atau Jakarta EE 8.
- Waspadai migration partial ke `jakarta` yang belum selesai.

### Java 17

- Jakarta EE 10/11 era lebih umum memakai `jakarta.validation`.
- Records mulai praktis untuk immutable DTO.
- Hibernate Validator 9.x/Jakarta Validation 3.1 menargetkan Java 17+.

### Java 21

- Virtual threads meningkatkan concurrency; validation hot path harus bounded agar tidak memindahkan bottleneck ke CPU/DB.
- Jangan membuat validator blocking DB/external service sembarangan.

### Java 25

- Treat validation as explicit, observable, bounded-cost contract.
- Modern Java modeling seperti records/sealed types membantu membuat invalid state lebih sulit, tetapi tidak mengganti boundary validation.

---

## 38. `javax.validation` vs `jakarta.validation` Security Consideration

Security principle sama. Yang berubah adalah namespace dan ecosystem version.

Legacy:

```java
import javax.validation.constraints.NotBlank;
```

Modern Jakarta:

```java
import jakarta.validation.constraints.NotBlank;
```

Migration risk:

- mixed namespace menyebabkan constraint tidak terbaca di runtime tertentu,
- transitive dependency membawa provider lama,
- Spring Boot 2 vs 3 behavior berbeda,
- generated code masih memakai `javax`,
- error handler masih menangkap exception package lama.

Security implication:

> Constraint yang tidak aktif sama dengan tidak ada validation.

Migration test harus memastikan invalid payload benar-benar ditolak.

---

## 39. Security Review Checklist for Validation PR

Gunakan checklist ini saat review code.

### DTO / Request Model

- [ ] Semua string external punya `@Size(max = ...)` atau alasan eksplisit kenapa tidak.
- [ ] Semua collection external punya `@Size(max = ...)`.
- [ ] Semua nested collection punya batas.
- [ ] Free text tidak memakai regex denial-list palsu.
- [ ] Identifier publik memakai allow-list ketat.
- [ ] Password/token/secret tidak dinormalisasi/trim sembarangan.
- [ ] `Optional` tidak dipakai sebagai field request tanpa alasan kuat.

### Custom Constraint

- [ ] Tidak ada side effect.
- [ ] Tidak ada authorization tersembunyi.
- [ ] Tidak ada DB lookup mahal tanpa alasan kuat.
- [ ] Tidak ada external API call tanpa timeout/failure semantics.
- [ ] Regex aman dan input bounded.
- [ ] Null handling konsisten.
- [ ] Message tidak mengandung raw sensitive value.

### Error Response

- [ ] Error code stabil.
- [ ] Message aman untuk audience.
- [ ] `rejectedValue` tidak dikembalikan by default.
- [ ] Account/resource existence tidak bocor tanpa keputusan sadar.
- [ ] Trace id ada.

### Logging / Metrics

- [ ] Tidak log raw violation object sembarangan.
- [ ] Tidak log PII/secrets.
- [ ] Metrics label tidak memakai raw input.
- [ ] Top violation code bisa dipantau.

### Architecture

- [ ] Authorization terpisah dari validation.
- [ ] Workflow guard terpisah dari DTO annotation.
- [ ] DB constraint tetap ada untuk uniqueness/integrity.
- [ ] Output encoding tetap dilakukan di presentation/export layer.
- [ ] Rate limit tersedia untuk endpoint sensitif.

---

## 40. Common Anti-Patterns

### 40.1 "Regex Solves Security"

Regex membantu format validation. Regex tidak mengganti parser, sanitizer, encoder, atau parameterized query.

### 40.2 "DTO Valid Means User Authorized"

DTO valid hanya berarti shape valid. Authorization adalah decision berbeda.

### 40.3 "Unique Validator Means Unique Data"

Tidak. Database unique constraint tetap wajib.

### 40.4 "Return All Details for Better UX"

Detail berlebihan bisa membocorkan PII, account existence, dan rule internal.

### 40.5 "No Size Limit Because Gateway Has Limit"

Gateway body limit tidak cukup. Field-level/list-level/domain-level limit tetap perlu.

### 40.6 "Validation Messages Are Logs"

Message untuk user bukan log internal. Log internal pun harus PII-safe.

### 40.7 "Sanitize on Input Once, Then Safe Forever"

Safety tergantung output context. Data yang aman untuk HTML body belum tentu aman untuk JavaScript, CSV, SQL, URL, atau log.

---

## 41. Production Design Pattern: Defense-in-Depth Validation Pipeline

Contoh pipeline untuk endpoint submit case:

```text
1. Gateway
   - TLS
   - auth required
   - body size limit
   - rate limit

2. Controller
   - deserialize JSON
   - reject malformed JSON
   - validate DTO shape with Jakarta Validation

3. Normalization
   - safe trim for selected fields
   - canonicalize identifiers

4. Application Service
   - load actor context
   - load case aggregate if needed
   - authorization policy
   - workflow guard
   - domain rule evaluation

5. Persistence
   - transaction
   - DB constraints
   - optimistic locking

6. Output
   - stable problem response
   - no rejected sensitive values
   - context-specific output encoding by client/UI/export

7. Observability
   - trace id
   - safe validation metrics
   - audit rule decision where required
```

Tidak semua rule harus annotation. Annotation hanya salah satu mekanisme.

---

## 42. Mini Case Study: Public Search Endpoint

### Problem

Endpoint:

```text
GET /api/cases/search?keyword=...&sort=...&page=...&size=...
```

Risiko:

- SQL injection,
- expensive wildcard search,
- huge page size,
- arbitrary sorting,
- enumeration,
- response scraping,
- PII exposure,
- log injection,
- high cardinality metrics.

### DTO

```java
public record CaseSearchQuery(
    @Size(max = 100)
    String keyword,

    @NotNull
    CaseSort sort,

    @Min(0)
    @Max(10_000)
    int page,

    @Min(1)
    @Max(100)
    int size
) {}
```

### Enum Allow-List

```java
public enum CaseSort {
    CREATED_AT("created_at"),
    UPDATED_AT("updated_at"),
    REFERENCE_NO("reference_no");

    private final String column;

    CaseSort(String column) {
        this.column = column;
    }

    public String column() {
        return column;
    }
}
```

### Service Controls

```text
- Parameterized query for keyword.
- Sort column from enum only.
- Timeout query.
- Index-aware search.
- Rate limit per actor/IP.
- Redact sensitive fields in result.
- Safe logging: keyword length, not keyword value.
```

Validation alone is not the security design. Validation is part of it.

---

## 43. Mini Case Study: Case Attachment Submission

### DTO

```java
public record AttachEvidenceRequest(
    @NotEmpty
    @Size(max = 20)
    List<@NotBlank @Size(max = 64) String> attachmentIds,

    @Size(max = 500)
    String remarks
) {}
```

### Validation Responsibility

- attachmentIds exists syntactically,
- max 20 attachments,
- each id bounded,
- remarks bounded.

### Not Validation Responsibility

- whether attachment exists,
- whether attachment belongs to actor,
- whether attachment belongs to case,
- whether case state allows attachment,
- whether file passed malware scan,
- whether retention policy allows use.

### Policy Layer

```java
AttachmentDecision decision = attachmentPolicy.evaluate(
    actor,
    caseFile,
    requestedAttachmentIds,
    loadedAttachments
);
```

### Persistence Layer

- FK constraints,
- unique case-attachment relation if needed,
- transaction,
- audit event.

---

## 44. Summary Mental Model

Validation is necessary, but not sufficient.

Pahami perbedaannya:

```text
Validation:
  Is this input acceptable for this contract?

Sanitization:
  Can this input be cleaned for a specific safe subset?

Normalization:
  What canonical form do we store/compare?

Output encoding:
  How do we safely render this data in a target context?

Authorization:
  Is this actor allowed to perform this action on this resource?

Persistence constraint:
  Can the database guarantee final integrity under concurrency?

Rate limiting:
  Can this actor call this operation this often?
```

Untuk menjadi engineer top-tier, jangan hanya bertanya:

> "Constraint apa yang harus saya pasang?"

Tanyakan juga:

> "Threat apa yang masih tersisa setelah constraint ini lolos?"

---

## 45. References

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation official site: https://beanvalidation.org/
- Hibernate Validator Reference Guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP Cross Site Scripting Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Regular Expression Denial of Service: https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
- OWASP Top Ten Project: https://owasp.org/www-project-top-ten/

---

## 46. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-026.md
```

Topik berikutnya:

```text
Testing Validation: Unit, Integration, Contract, Mutation, and Property-Based Tests
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Performance Engineering: Cost Model, Fail Fast, Caching, Reflection, Hot Paths](./learn-java-validation-jakarta-hibernate-validator-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Testing Validation: Unit, Integration, Contract, Mutation, and Property-Based Tests](./learn-java-validation-jakarta-hibernate-validator-part-026.md)
