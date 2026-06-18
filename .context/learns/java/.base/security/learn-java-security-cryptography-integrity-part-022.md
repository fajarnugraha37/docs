# learn-java-security-cryptography-integrity-part-022

# Part 22 — Input Validation, Canonicalization, Injection Resistance

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas authorization integrity: memastikan actor hanya dapat melakukan aksi pada object, field, tenant, workflow state, dan capability yang memang boleh. Part ini membahas lapisan yang berdekatan tetapi berbeda: **input validation, canonicalization, dan injection resistance**.

Di sistem Java enterprise, bug security sering muncul bukan karena tidak ada validasi sama sekali, tetapi karena validasi dilakukan pada representasi yang salah, di layer yang salah, dengan asumsi yang salah, atau dianggap cukup untuk melawan injection padahal injection harus dicegah dengan **separation antara data dan instruction**.

Mental model utama:

> Input bukan sekadar string yang perlu dicek panjangnya. Input adalah crossing point dari trust boundary. Setiap field harus diubah dari untrusted bytes/text menjadi typed, canonical, domain-valid, authorization-aware value sebelum boleh memengaruhi query, command, template, path, expression, workflow transition, atau decision.

Kita tidak mengulang Java basic, regex basic, JDBC basic, JAX-RS basic, atau REST validation umum. Fokusnya adalah **security semantics**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan input validation, canonicalization, normalization, sanitization, escaping, encoding, parsing, dan parameterization.
2. Mendesain validation boundary yang kuat untuk aplikasi Java enterprise.
3. Menentukan validasi mana yang ada di transport layer, DTO layer, application layer, domain layer, persistence adapter, dan integration adapter.
4. Menjelaskan kenapa allowlist lebih kuat daripada denylist untuk input security.
5. Menghindari kesalahan umum: validasi sebelum decode yang benar, regex terlalu permisif, sanitization dianggap authorization, prepared statement dipakai tetapi SQL identifier tetap disusun dari input, dan canonicalization mismatch antar service.
6. Mendesain anti-injection strategy untuk SQL, JPQL/HQL, LDAP, XPath, OS command, template, expression language, log, HTTP header, CSV, HTML, URL, file path, dan regex.
7. Melakukan security review terhadap input pipeline Java.
8. Membuat negative test, property-style test, dan abuse-case matrix untuk validasi input.

---

## 2. Mental Model Utama

### 2.1 Input adalah perubahan bentuk dari dunia luar ke model internal

Sistem tidak seharusnya memperlakukan input sebagai string mentah. Input melewati beberapa fase:

```text
External representation
  -> transport decoding
  -> parser representation
  -> canonical representation
  -> typed value
  -> domain value
  -> authorized command
  -> persisted/evented/audited fact
```

Security problem muncul ketika satu fase dilewati, digabung, atau dilakukan dalam urutan salah.

Contoh buruk:

```text
HTTP query param string
  -> langsung concat ke SQL
```

Contoh lebih baik:

```text
HTTP query param string
  -> decode exactly once
  -> trim/normalize sesuai field policy
  -> parse ke typed value
  -> validate range/format/domain
  -> map ke allowed query criteria
  -> bind sebagai parameter
```

### 2.2 Validasi bukan sekadar mencegah karakter berbahaya

Kalimat "block karakter apostrophe agar tidak SQL injection" adalah mental model yang salah. Injection terjadi karena untrusted input diberi kesempatan mengubah struktur instruksi.

Defense yang benar:

```text
Untrusted value tidak boleh menjadi instruction.
```

Untuk SQL, value harus bound sebagai parameter, bukan digabung ke query string.

Untuk OS command, hindari shell dan gunakan API/library spesifik.

Untuk template, user input tidak boleh menjadi template source/expression.

Untuk path, user input tidak boleh menentukan lokasi file final tanpa canonical path containment check.

Untuk regex, user input tidak boleh menjadi regex pattern tanpa policy ketat.

### 2.3 Canonicalize before validate

Input bisa punya banyak representasi untuk nilai yang terlihat sama:

```text
%2e%2e/
..%2f
%252e%252e%252f
full-width-example
example-with-control-character.jpg
Cafe + combining accent
precomposed Cafe accent
```

Jika sistem memvalidasi bentuk yang belum canonical, attacker bisa mengirim bentuk alternatif yang lolos validasi tetapi berubah makna setelah decode/normalization di layer berikutnya.

Invariant:

> Validasi security harus dilakukan pada representasi yang sama dengan representasi yang akan dipakai untuk membuat keputusan.

### 2.4 Input validation bukan pengganti output encoding

Validasi input membantu memastikan data sesuai domain, tetapi tidak berarti aman untuk semua output context.

String yang valid sebagai nama perusahaan belum tentu aman ketika ditaruh ke HTML, CSV, log, SQL, LDAP, shell, atau HTTP header.

Contoh:

```text
Nama perusahaan valid:
  ACME <Research> & Partners

Aman sebagai domain value?
  Bisa jadi iya.

Aman langsung dimasukkan ke HTML tanpa encoding?
  Tidak.

Aman langsung dimasukkan ke CSV cell tanpa CSV injection mitigation?
  Tidak selalu.
```

### 2.5 Security validation harus preserve business meaning

Validasi yang terlalu agresif bisa merusak data legal/business.

Contoh nilai valid di dunia nyata:

```text
O'Connor
PT. Maju-Mundur (2025) Pte Ltd
Blk 123 #04-56
Cafe International
```

Menghapus apostrophe, hash, dash, atau Unicode secara buta dapat merusak nama orang, alamat, atau dokumen legal. Security yang baik bukan "hapus semua karakter aneh", tetapi:

1. Tetapkan karakter yang memang valid untuk field tertentu.
2. Pisahkan data dari instruction.
3. Encode sesuai output context.
4. Audit transformasi yang mengubah makna.

---

## 3. Vocabulary yang Harus Jelas

### 3.1 Validation

Validation memastikan input sesuai aturan yang diharapkan.

Contoh:

```text
postalCode harus 6 digit
amount harus >= 0 dan <= allowed maximum
email harus valid secara policy organisasi
caseId harus UUID/format case number yang valid
statusTransition harus allowed dari current state
```

Validation menjawab:

```text
Apakah nilai ini boleh diterima sebagai nilai domain?
```

### 3.2 Canonicalization

Canonicalization mengubah beberapa representasi ekuivalen menjadi satu representasi standar.

Contoh:

```text
Trim leading/trailing spaces untuk code field
Normalize Unicode ke NFC/NFKC sesuai field policy
Lowercase email domain
Resolve relative path terhadap base directory
Decode URL exactly once pada boundary yang tepat
```

Canonicalization menjawab:

```text
Nilai ini dalam bentuk standar apa sebelum diputuskan valid/tidak?
```

### 3.3 Normalization

Normalization sering dipakai sebagai istilah umum untuk merapikan bentuk data. Dalam konteks Unicode, normalization punya arti teknis: NFC, NFD, NFKC, NFKD.

Untuk security, normalization harus hati-hati karena bisa mengubah identity. Tidak semua field harus di-normalize dengan policy yang sama.

### 3.4 Sanitization

Sanitization mengubah input agar aman dalam context tertentu, misalnya membersihkan HTML dengan allowlist tag.

Sanitization berbahaya jika dianggap universal:

```text
Sanitized untuk HTML != aman untuk SQL
Sanitized untuk SQL != aman untuk LDAP
Sanitized untuk log != aman untuk CSV
```

### 3.5 Escaping

Escaping mengubah karakter khusus agar tidak diperlakukan sebagai syntax pada context tertentu.

Contoh:

```text
HTML escaping
JSON escaping
LDAP escaping
CSV escaping
Shell escaping
SQL escaping
```

Escaping harus context-specific. Escaping umum/global hampir selalu salah.

### 3.6 Encoding

Encoding adalah representasi data dalam format tertentu, misalnya UTF-8, Base64, URL encoding, HTML entity encoding.

Encoding bukan security jika tidak dipakai di context yang benar. Base64 bukan encryption. URL encoding bukan validasi. HTML encoding bukan authorization.

### 3.7 Parameterization

Parameterization memisahkan instruction dari data.

Contoh SQL:

```java
PreparedStatement ps = connection.prepareStatement(
    "select * from cases where case_id = ? and agency_id = ?"
);
ps.setString(1, caseId.value());
ps.setString(2, agencyId.value());
```

Parameterization menjawab:

```text
Bagaimana memastikan data tidak bisa mengubah struktur instruction?
```

---

## 4. Security Invariant untuk Input

### 4.1 Invariant 1 — Semua input eksternal dianggap hostile

Input hostile bukan hanya dari public internet. Sumber input hostile:

1. HTTP request dari user.
2. Header dari gateway.
3. File upload.
4. Message broker.
5. Batch file dari agency lain.
6. Database lama yang sudah tercemar.
7. Admin UI.
8. Environment variable.
9. Secret/config dari external store.
10. Callback dari vendor.
11. JWT claim dari IdP yang belum diverifikasi.
12. Object dari deserialization.
13. Search query internal yang berasal dari UI.
14. Event yang diproduksi service lain.

### 4.2 Invariant 2 — Validate at boundary, enforce in domain

Boundary validation mencegah data jelas-jelas invalid masuk lebih jauh. Domain enforcement memastikan business invariant tidak tergantung pada controller.

```text
Controller/DTO:
  caseId format valid
  amount parseable
  transition enum valid

Domain/application:
  actor boleh transition case ini?
  transition allowed dari current state?
  amount boleh berubah pada state ini?
  field ini immutable setelah approval?
```

Jika business invariant hanya di controller, internal caller, batch, worker, atau test helper bisa bypass.

### 4.3 Invariant 3 — Jangan pernah membuat instruction dari raw input

Raw input tidak boleh langsung menjadi:

1. SQL fragment.
2. JPQL/HQL fragment.
3. LDAP filter.
4. XPath expression.
5. OS command string.
6. Shell argument string.
7. Template source.
8. Regex pattern.
9. File path final.
10. HTTP redirect target.
11. Class name.
12. Method name.
13. Spring expression.
14. JNDI name.
15. Log format string.

### 4.4 Invariant 4 — Output encoding tergantung sink

Satu domain value bisa mengalir ke banyak sink:

```text
companyName
  -> HTML page
  -> PDF
  -> CSV export
  -> email body
  -> audit log
  -> SQL parameter
  -> JSON response
  -> search index
```

Setiap sink punya encoding/escaping policy sendiri.

### 4.5 Invariant 5 — Validasi harus fail closed

Jika parser ambigu, encoding invalid, field missing, enum unknown, length over limit, canonicalization gagal, timezone invalid, atau numeric overflow, sistem harus menolak, bukan menebak.

Fail open sering muncul dalam bentuk:

```java
try {
    role = Role.valueOf(input);
} catch (Exception e) {
    role = Role.USER; // terlihat aman, tetapi menyembunyikan input invalid
}
```

Untuk security-sensitive flow, default harus eksplisit dan diaudit.

---

## 5. Input Taxonomy di Java Enterprise System

### 5.1 Identifier

Contoh:

```text
caseId
userId
agencyId
documentId
applicationId
tenantId
```

Policy:

1. Format ketat.
2. Length ketat.
3. Tidak boleh whitespace tersembunyi.
4. Tidak boleh ambiguous Unicode kecuali memang policy mendukung.
5. Harus dicek existence.
6. Harus dicek authorization.

Anti-pattern:

```text
caseId valid format -> dianggap actor boleh akses
```

Format validity bukan authorization.

### 5.2 Code / enum / status

Policy:

1. Gunakan enum/domain value object.
2. Unknown value harus ditolak atau ditangani sebagai explicit compatibility mode.
3. Jangan gunakan arbitrary string untuk state transition.
4. Transition harus divalidasi terhadap current state.

### 5.3 Free text

Contoh:

```text
remarks
case notes
investigation summary
comment
appeal reason
```

Policy:

1. Length limit.
2. Encoding valid UTF-8.
3. Control character policy.
4. HTML policy jika rich text.
5. Output encoding di semua sink.
6. PII/secrets detection bila perlu.
7. Audit log redaction bila perlu.

Free text tidak realistis divalidasi dengan character allowlist sangat sempit, tetapi tetap harus punya constraints.

### 5.4 Structured object

Contoh JSON request body:

```json
{
  "caseId": "CASE-123",
  "transition": "APPROVE",
  "remarks": "ok",
  "attachments": []
}
```

Policy:

1. Reject unknown fields untuk command security-sensitive jika memungkinkan.
2. Distinguish missing vs null vs empty.
3. Validate nested structure.
4. Limit object depth/array size.
5. Avoid polymorphic deserialization dari untrusted input.
6. Bind ke command DTO, bukan entity langsung.

### 5.5 Query/filter/sort input

Policy:

1. Sort field harus allowlist mapping ke known column/property.
2. Direction enum.
3. Pagination limit.
4. Filter field allowlist.
5. Range validation.
6. Query complexity limit.

Anti-pattern:

```java
String sql = "select * from cases order by " + request.getSort();
```

Prepared statement tidak bisa bind SQL identifier seperti column name. Identifier harus allowlist mapping.

### 5.6 URL / URI / redirect target

Policy:

1. Parse dengan URI parser.
2. Scheme allowlist.
3. Host allowlist jika redirect/callback.
4. No userinfo.
5. Normalize path.
6. Beware DNS rebinding untuk SSRF.
7. Beware encoded slash/backslash.

### 5.7 File name / file path

Policy:

1. Original filename hanya metadata, bukan storage path.
2. Generate server-side storage name.
3. Validate extension allowlist.
4. Validate MIME/content independently.
5. Resolve canonical path and verify containment.
6. Reject absolute path, parent traversal, separator tricks.

### 5.8 Numeric input

Policy:

1. Parse ke exact type.
2. Range validation.
3. Decimal precision/scale validation.
4. No floating point for money.
5. Overflow check.
6. Unit validation.

### 5.9 Date/time input

Policy:

1. Use explicit format.
2. Use explicit timezone/offset policy.
3. Validate range.
4. Distinguish date-only vs instant vs local date-time.
5. Avoid implicit system timezone.

### 5.10 Expression-like input

Contoh:

```text
search DSL
rule expression
template variable
filter expression
formula
```

Policy:

1. Treat as programming language.
2. Parse into AST.
3. Allowlist operators/functions.
4. Limit complexity.
5. No reflection/class access.
6. Sandbox if execution needed.
7. Prefer predefined criteria over user expression.

---

## 6. Canonicalization Deep Dive

### 6.1 The canonicalization trap

Misalkan aplikasi melakukan validasi:

```text
Reject path containing "../"
```

Attacker mengirim:

```text
..%2fsecret.txt
%2e%2e/secret.txt
%252e%252e%252fsecret.txt
```

Jika validasi dilakukan sebelum URL decoding, string tampak aman. Setelah layer lain decode, path menjadi traversal.

### 6.2 Decode exactly once at the correct layer

Double decoding adalah sumber bug klasik.

```text
Input: %252e%252e%252fsecret.txt
Decode once: %2e%2e%2fsecret.txt
Decode twice: ../secret.txt
```

Policy yang sehat:

1. Tentukan layer mana yang melakukan decode.
2. Jangan decode ulang di domain/service layer tanpa alasan kuat.
3. Reject encoded representation yang tidak valid.
4. Audit behavior framework dan proxy.

### 6.3 Unicode normalization

Java menyediakan:

```java
java.text.Normalizer
```

Contoh:

```java
String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Namun normalization harus field-specific. Untuk username/security identifier, policy bisa sangat ketat: lowercase ASCII alphanumeric plus dash/underscore. Untuk legal name, Unicode support mungkin perlu, tetapi tetap perlu length limit, control character policy, dan output encoding.

### 6.4 Whitespace normalization

Whitespace tidak hanya space biasa.

Risiko:

1. Leading/trailing invisible spaces.
2. Non-breaking space.
3. Zero-width joiner/non-joiner.
4. Line separator yang memecah log/header/CSV.

Policy:

1. Untuk code/id: reject whitespace.
2. Untuk name: normalize repeated normal spaces jika business mengizinkan.
3. Untuk remarks: allow newline tetapi kontrol output sink.
4. Untuk header/log: reject CR/LF atau encode.

### 6.5 Case normalization

Case-insensitive identifier harus hati-hati.

```java
String normalized = input.toLowerCase(Locale.ROOT);
```

Gunakan `Locale.ROOT`, bukan default locale, agar tidak terkena locale-specific behavior.

### 6.6 Path canonicalization

```java
Path base = Paths.get("/safe/storage").toRealPath();
Path candidate = base.resolve(userProvidedName).normalize();

if (!candidate.startsWith(base)) {
    throw new SecurityException("Path escapes base directory");
}
```

Ini belum cukup untuk semua kasus jika symlink bisa berubah antara check dan use. Untuk high-security file operation, desain storage sebaiknya tidak bergantung pada filename user, permission OS harus benar, create harus atomic, dan symlink behavior harus eksplisit.

---

## 7. Allowlist vs Denylist

### 7.1 Allowlist

Allowlist mendefinisikan apa yang boleh.

```text
postalCode: ^[0-9]{6}$
sortField: one of [createdDate, updatedDate, caseNo]
transition: one of allowed enum values
mimeType: one of approved content types
```

Allowlist cocok untuk field yang strukturnya jelas.

### 7.2 Denylist

Denylist mendefinisikan apa yang dilarang.

```text
Reject if contains '<script>'
Reject if contains '../'
Reject if contains 'drop table'
```

Denylist lemah karena attacker bisa memakai variasi encoding, casing, whitespace, comment, alternate syntax, atau context lain.

### 7.3 Kapan denylist masih berguna?

Denylist bisa berguna sebagai defense-in-depth atau detection:

1. WAF rule.
2. Suspicious pattern alert.
3. Malware signature.
4. Secret detection.
5. Abuse monitoring.

Tetapi denylist bukan primary control untuk input validity.

---

## 8. Validation Layering di Java Application

### 8.1 Transport layer

Contoh:

1. Max request size.
2. Content-Type allowlist.
3. JSON parse depth.
4. Header size limit.
5. Multipart size limit.
6. UTF-8 validity.

### 8.2 DTO layer

Contoh dengan Bean Validation:

```java
public record SearchCaseRequest(
    @Size(max = 100) String keyword,
    @Pattern(regexp = "^[A-Z0-9_-]{1,40}$") String agencyCode,
    @Min(0) int page,
    @Min(1) @Max(100) int size
) {}
```

DTO validation cocok untuk syntactic validation. Jangan taruh semua domain security di annotation.

### 8.3 Application service layer

Di layer ini, request DTO diubah menjadi command/query object yang typed.

```java
public record SearchCaseQuery(
    AgencyCode agencyCode,
    Optional<Keyword> keyword,
    PageRequest pageRequest,
    SortSpec sortSpec
) {}
```

Application service juga memeriksa actor, tenant, use case, dan authorization context.

### 8.4 Domain layer

Domain layer menjaga invariant yang tidak boleh dibypass.

```java
caseFile.transitionTo(targetStatus, actor, reason, clock);
```

Method domain harus menolak transition invalid walaupun caller internal salah.

### 8.5 Persistence/integration layer

Layer ini menjaga injection resistance untuk sink:

1. SQL parameterization.
2. Allowlist mapping untuk order by.
3. LDAP escaping.
4. XPath safe API.
5. HTTP client URL policy.
6. File path containment.
7. Template safe rendering.

---

## 9. SQL Injection Resistance

### 9.1 Root cause

SQL injection terjadi ketika untrusted input menjadi bagian dari SQL instruction.

Buruk:

```java
String sql = "select * from users where username = '" + username + "'";
```

Baik:

```java
String sql = "select * from users where username = ?";
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, username);
}
```

### 9.2 Prepared statement bukan obat untuk semua bagian query

Prepared statement melindungi value, bukan identifier atau SQL keyword.

Tidak bisa mengandalkan bind parameter untuk column name:

```sql
select * from cases order by ?
```

Untuk `ORDER BY`, gunakan allowlist mapping:

```java
public enum CaseSortField {
    CREATED_DATE("created_date"),
    UPDATED_DATE("updated_date"),
    CASE_NO("case_no");

    private final String column;

    CaseSortField(String column) {
        this.column = column;
    }

    public String column() {
        return column;
    }
}
```

`sortField` dan `direction` harus enum hasil parsing allowlist, bukan string mentah.

### 9.3 Dynamic filter

Buruk:

```java
String where = request.getFilter();
String sql = "select * from cases where " + where;
```

Lebih aman:

```text
User input -> predefined filter DTO -> typed criteria -> query builder with bind parameters
```

### 9.4 JPQL/HQL injection

ORM tidak otomatis menghilangkan injection jika query string tetap dibangun dengan concat.

Buruk:

```java
entityManager.createQuery(
    "select c from Case c where c.status = '" + status + "'"
);
```

Baik:

```java
entityManager.createQuery(
    "select c from Case c where c.status = :status", Case.class
).setParameter("status", status);
```

### 9.5 Stored procedure

Stored procedure bukan otomatis aman. Jika procedure membangun dynamic SQL dari input, injection tetap mungkin.

Checklist:

1. Parameterized call dari Java.
2. Procedure tidak concat dynamic SQL dari untrusted input.
3. Identifier dynamic tetap allowlist.
4. Least privilege DB user.
5. Error message tidak expose SQL internals.

---

## 10. LDAP Injection Resistance

LDAP filter punya syntax sendiri.

Buruk:

```java
String filter = "(uid=" + username + ")";
```

Jika username mengandung syntax LDAP, filter bisa berubah makna.

Defense:

1. Gunakan API yang mendukung parameterized filter jika tersedia.
2. Escape sesuai LDAP filter escaping.
3. Validate identifier format.
4. Limit search base.
5. Limit returned attributes.
6. Jangan gunakan user input untuk DN tanpa escaping/allowlist.

Mental model:

```text
LDAP input harus aman terhadap dua context:
  1. LDAP filter context
  2. LDAP DN context
```

Escaping-nya tidak sama.

---

## 11. XPath/XML Injection Resistance

XPath injection terjadi ketika user input digabung ke XPath expression.

Buruk:

```java
String expression = "//user[name='" + name + "']";
```

Defense:

1. Hindari dynamic XPath dari user input.
2. Gunakan variable binding jika library mendukung.
3. Escape literal XPath dengan benar.
4. Validate input sesuai domain.
5. Disable unsafe XML parser features seperti dibahas di Part 18.

XML security sering gabungan antara parser misconfiguration, XPath injection, XXE, dan signature wrapping.

---

## 12. OS Command Injection Resistance

### 12.1 Primary rule

Jangan panggil OS command jika ada Java API/library yang melakukan hal sama.

```text
mkdir -> Files.createDirectories
copy -> Files.copy
zip -> java.util.zip / library aman
hash -> MessageDigest
```

### 12.2 Shell adalah boundary yang berbahaya

Buruk:

```java
Runtime.getRuntime().exec("sh -c 'convert " + input + " output.png'");
```

Lebih baik:

```java
ProcessBuilder pb = new ProcessBuilder(
    "/usr/bin/convert",
    safeInputPath.toString(),
    safeOutputPath.toString()
);
```

Tetapi `ProcessBuilder` bukan magic. Argumen tetap harus validated. File path harus canonical dan contained. Binary path harus fixed. Environment harus dikontrol. Timeout harus ada. Output harus dibaca agar tidak deadlock. Permission OS harus minimal.

### 12.3 Command injection checklist

1. Hindari command.
2. Hindari shell.
3. Fixed executable path.
4. Argumen sebagai list, bukan string shell.
5. Allowlist argumen.
6. Canonicalize file path.
7. Run as low-privilege OS user/container.
8. Timeout.
9. Limit output size.
10. No secrets in command args karena bisa terlihat di process list.

---

## 13. Template Injection and Expression Injection

Java ecosystem punya banyak template/expression engine:

1. Thymeleaf.
2. FreeMarker.
3. Velocity.
4. Mustache.
5. JSP/EL.
6. SpEL.
7. MVEL.
8. JEXL.

Risk muncul ketika user input menjadi template source atau expression.

Buruk:

```java
parser.parseExpression(userInput).getValue(context);
```

Defense:

1. User input boleh menjadi data, bukan template/expression.
2. Jika business perlu user-defined template, buat template DSL terbatas.
3. Disable class/static method/reflection access.
4. Provide minimal context object.
5. Escape output sesuai context.
6. Limit template size, recursion, loop, execution time.
7. Review semua feature engine.

Mental model:

> Template engine adalah interpreter. Jika user bisa mengontrol template, treat sebagai code execution surface.

---

## 14. Regex Validation and ReDoS

### 14.1 Regex sebagai validator bisa menjadi DoS surface

Java regex engine berbasis backtracking. Pattern tertentu bisa mengalami catastrophic backtracking pada input tertentu.

Contoh pola berisiko:

```text
(a+)+$
([a-zA-Z]+)*$
(.*a){10}
```

### 14.2 Rule untuk regex security

1. Anchor pattern dengan `^` dan `$` jika validasi full string.
2. Batasi panjang input sebelum regex.
3. Hindari nested quantifier.
4. Hindari ambiguous alternation.
5. Hindari user-controlled regex pattern.
6. Compile pattern statically.
7. Test worst-case input.
8. Pertimbangkan parser khusus untuk format kompleks.

Contoh baik:

```java
private static final Pattern POSTAL_CODE = Pattern.compile("^[0-9]{6}$");

public static PostalCode parse(String raw) {
    if (raw == null || !POSTAL_CODE.matcher(raw).matches()) {
        throw new InvalidPostalCodeException();
    }
    return new PostalCode(raw);
}
```

### 14.3 User-controlled regex

Fitur search advanced sering membiarkan user memasukkan regex. Ini berbahaya.

Alternatif:

1. Gunakan plain text contains search.
2. Gunakan query DSL terbatas.
3. Gunakan search engine dengan query parser aman dan complexity limit.
4. Jika regex wajib, sandbox, timeout, pattern linting, length limit, dan resource isolation.

---

## 15. HTML, Rich Text, and XSS Boundary

Free text valid belum tentu safe for HTML.

Input:

```html
<script>alert(1)</script>
```

Bisa valid sebagai komentar literal jika sistem mengizinkan karakter bebas. Yang wajib adalah HTML output encoding saat ditampilkan.

Jika business mengizinkan rich text, gunakan HTML sanitizer berbasis allowlist tag/attribute/protocol.

Policy:

1. Allow tag terbatas.
2. Allow attribute terbatas.
3. Reject dangerous protocol seperti `javascript:`.
4. Output tetap dengan library rendering yang benar.
5. Store original vs sanitized harus diputuskan eksplisit.

HTML context berbeda:

```text
HTML body
HTML attribute
JavaScript string
CSS context
URL context
```

Encoding harus sesuai context.

---

## 16. HTTP Header, Response Splitting, and CRLF Injection

Header injection terjadi ketika input mengandung CR/LF dan dimasukkan ke header.

Buruk:

```java
response.setHeader("Content-Disposition", "attachment; filename=" + filename);
```

Defense:

1. Generate safe filename.
2. Reject CR/LF.
3. Use framework API untuk content disposition jika tersedia.
4. Quote/encode sesuai RFC relevant.
5. Jangan masukkan raw user input ke header.

---

## 17. CSV/Excel Formula Injection

CSV export sering dianggap harmless, padahal spreadsheet bisa mengeksekusi formula.

Input berbahaya:

```text
=HYPERLINK("http://attacker", "click")
+SUM(1,1)
-CMD|' /C calc'!A0
@malicious
```

Defense:

1. Prefix cell yang dimulai dengan formula metacharacter.
2. Escape CSV sesuai format.
3. Provide warning untuk exported file.
4. Treat export sebagai sink khusus.
5. Jangan mengandalkan input validation umum.

---

## 18. Log Injection and Audit Pollution

Log injection terjadi ketika input mengandung newline/control character sehingga attacker memalsukan log entry.

Contoh:

```text
username = "bob\nERROR admin login successful"
```

Defense:

1. Structured logging.
2. Encode control characters.
3. Limit field length.
4. Never log secrets.
5. Separate audit event fields dari free text.
6. Canonical actor ID dari authenticated context, bukan request param.

Untuk audit trail integrity, ini akan tersambung lagi di Part 25.

---

## 19. URL, SSRF, and External Resource Input

Jika user input menentukan URL yang akan dipanggil server, ini bisa menjadi SSRF.

Risiko:

```text
http://169.254.169.254/latest/meta-data/
http://localhost:8080/admin
http://internal-service.namespace.svc.cluster.local
file:///etc/passwd
```

Defense:

1. Scheme allowlist: biasanya `https` saja.
2. Host allowlist untuk integrasi known vendor.
3. Resolve DNS dan blok private/link-local/loopback range.
4. Re-check setelah redirect.
5. Disable redirect atau validate redirect target.
6. Timeout ketat.
7. Response size limit.
8. No credentials to arbitrary host.
9. Network egress policy.

Input validation saja tidak cukup; perlu network-layer defense.

---

## 20. Validation for Message-Driven Systems

Dalam microservices, input bukan cuma HTTP. Message broker adalah input boundary.

Message harus divalidasi:

1. Schema version.
2. Required fields.
3. Field range.
4. Producer identity/trust.
5. Signature/MAC jika boundary tidak trusted.
6. Replay/idempotency key.
7. Event timestamp sanity.
8. Tenant/agency consistency.
9. Authorization context jika command-like message.

Anti-pattern:

```text
Karena message berasal dari internal broker, langsung dipercaya.
```

Internal tidak sama dengan trusted. Service compromised, replay, misrouting, dan bug producer tetap mungkin.

---

## 21. Validation for Workflow/State Machine Inputs

Untuk regulatory/case management systems, input security sangat erat dengan workflow integrity.

Contoh command:

```json
{
  "caseId": "CASE-123",
  "action": "APPROVE",
  "remarks": "ok"
}
```

Validasi syntactic:

```text
caseId format valid
action enum valid
remarks length valid
```

Validasi domain/security:

```text
case exists
case belongs to agency actor
actor has permission for action
current state allows APPROVE
mandatory checks completed
no conflicting lock
remarks required for this transition
transition produces audit event
```

Di sistem workflow, injection bukan hanya SQL/template. Ada juga **state injection**: user memilih action/state yang secara UI tidak tersedia tetapi endpoint menerima.

Defense:

1. Server-side transition matrix.
2. Never trust UI-hidden button.
3. Domain method validates current state.
4. Authorization per transition.
5. Audit transition attempt failure.
6. Idempotency for duplicate submission.

---

## 22. Designing Strong Value Objects

Value object adalah cara kuat untuk mencegah raw string menyebar.

### 22.1 Example: AgencyCode

```java
public record AgencyCode(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[A-Z0-9_]{2,20}$");

    public AgencyCode {
        Objects.requireNonNull(value, "value");
        value = value.trim().toUpperCase(Locale.ROOT);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid agency code");
        }
    }
}
```

Catatan:

1. Constructor canonicalizes.
2. Constructor validates.
3. Setelah dibuat, `AgencyCode` valid by construction.
4. Namun authorization tetap terpisah.

### 22.2 Example: SortSpec

```java
public enum SortDirection {
    ASC("asc"), DESC("desc");

    private final String sql;

    SortDirection(String sql) {
        this.sql = sql;
    }

    public String sql() {
        return sql;
    }
}

public enum CaseSortField {
    CREATED_DATE("created_date"),
    UPDATED_DATE("updated_date"),
    CASE_NO("case_no");

    private final String sqlColumn;

    CaseSortField(String sqlColumn) {
        this.sqlColumn = sqlColumn;
    }

    public String sqlColumn() {
        return sqlColumn;
    }
}

public record CaseSortSpec(CaseSortField field, SortDirection direction) {}
```

Query builder hanya menerima `CaseSortSpec`, bukan raw string.

### 22.3 Example: SafeRedirectTarget

```java
public record SafeRedirectTarget(URI value) {
    private static final Set<String> ALLOWED_HOSTS = Set.of("app.example.gov", "login.example.gov");

    public SafeRedirectTarget {
        Objects.requireNonNull(value, "value");
        if (!"https".equalsIgnoreCase(value.getScheme())) {
            throw new IllegalArgumentException("Invalid scheme");
        }
        if (!ALLOWED_HOSTS.contains(value.getHost())) {
            throw new IllegalArgumentException("Invalid host");
        }
        if (value.getUserInfo() != null) {
            throw new IllegalArgumentException("User info not allowed");
        }
    }
}
```

---

## 23. DTO Binding Anti-Patterns

### 23.1 Binding request directly to entity

Buruk:

```java
@PostMapping("/cases/{id}")
public void update(@RequestBody CaseEntity entity) {
    repository.save(entity);
}
```

Risiko:

1. Mass assignment.
2. User mengubah field internal.
3. User mengubah owner/tenant/status.
4. User mengubah audit fields.
5. Authorization bypass.

Baik:

```java
public record UpdateCaseRequest(
    String contactNumber,
    String remarks
) {}
```

Lalu map explicit ke command.

### 23.2 Unknown field accepted silently

Jika JSON parser menerima unknown fields, attacker bisa mengirim field yang kelak menjadi berbahaya ketika DTO berubah.

Trade-off:

1. Public API versioned mungkin perlu forward compatibility.
2. Internal command API security-sensitive lebih baik reject unknown fields.

### 23.3 Null ambiguity

Bedakan:

```text
field absent
field present null
field present empty string
field present blank string
```

Untuk PATCH endpoint, ambiguity ini sangat penting.

---

## 24. Input Validation and Error Handling

Error validasi harus informatif untuk user tetapi tidak membocorkan internal.

Baik:

```json
{
  "error": "VALIDATION_FAILED",
  "fields": [
    {"field": "postalCode", "reason": "must be 6 digits"}
  ]
}
```

Buruk:

```text
ORA-01756: quoted string not properly terminated near select * from cases where...
```

Guidelines:

1. Jangan expose stack trace.
2. Jangan expose SQL query.
3. Jangan expose internal path.
4. Jangan expose regex detail yang sensitif.
5. Gunakan error code stabil.
6. Log detail internal dengan redaction.
7. Audit repeated malicious validation failures bila relevan.

---

## 25. Input Validation and Observability

Security validation butuh telemetry.

Metric yang berguna:

1. Validation failure count by endpoint.
2. Rejected content type.
3. Payload too large.
4. Unknown enum values.
5. Invalid signature/MAC.
6. Suspicious path traversal attempts.
7. SQL injection-like attempts.
8. ReDoS timeout if implemented.
9. File upload rejection reason.
10. SSRF blocked target category.

Namun jangan log raw malicious payload penuh jika mengandung secrets/PII atau bisa merusak log viewer.

---

## 26. Testing Strategy

### 26.1 Unit tests for value objects

```java
class AgencyCodeTest {
    @Test
    void acceptsValidAgencyCode() {
        assertEquals("CEA", new AgencyCode(" cea ").value());
    }

    @Test
    void rejectsPathLikeCode() {
        assertThrows(IllegalArgumentException.class, () -> new AgencyCode("../CEA"));
    }
}
```

### 26.2 Negative tests for injection

Test payload:

```text
' or '1'='1
admin'--
../../etc/passwd
%2e%2e%2f
<script>alert(1)</script>
${T(java.lang.Runtime).getRuntime().exec('id')}
=HYPERLINK("http://attacker")
```

Tujuan test bukan sekadar memastikan payload ditolak. Kadang payload valid sebagai free text, tetapi harus aman saat sink.

### 26.3 Property-style tests

Untuk parser/value object:

1. Semua output canonical harus memenuhi invariant.
2. Invalid chars tidak boleh diterima.
3. Panjang output tidak boleh melebihi limit.
4. Roundtrip tidak mengubah makna.

### 26.4 Integration tests

1. SQL injection payload tidak mengubah result set.
2. Sort field invalid ditolak.
3. Unknown JSON field ditolak untuk command endpoint.
4. File path traversal tidak keluar storage dir.
5. Header filename tidak menghasilkan CRLF.
6. CSV export mitigates formula cells.

### 26.5 Abuse-case test matrix

Untuk setiap endpoint:

```text
Who can call?
What input fields cross trust boundary?
What sink each field reaches?
What validation exists?
What encoding/parameterization exists?
What negative payload should be tested?
```

---

## 27. Secure Design Pattern: Parse, Don’t Pass Strings

Pattern:

```text
Raw input
  -> parser
  -> value object
  -> command/query object
  -> domain operation
  -> sink adapter
```

Jangan pass raw string jauh ke dalam sistem.

Buruk:

```java
caseService.search(String keyword, String sort, String direction);
```

Baik:

```java
caseService.search(SearchCaseQuery query);
```

Dengan:

```java
public record SearchCaseQuery(
    Optional<SearchKeyword> keyword,
    CaseSortSpec sort,
    PageSpec page,
    ActorContext actor
) {}
```

Keuntungan:

1. Type system membantu enforcement.
2. Review lebih mudah.
3. Sink adapter tidak menerima raw uncontrolled values.
4. Test lebih terfokus.
5. Domain invariant lebih eksplisit.

---

## 28. Secure Design Pattern: Sink-Specific Adapter

Setiap sink punya adapter yang memaksa policy.

Contoh:

```text
SqlCaseQueryBuilder
LdapUserSearchAdapter
CsvExportWriter
AuditLogWriter
HtmlRenderer
SafeFileStorage
ExternalUrlFetcher
```

Jangan biarkan semua service menulis SQL/CSV/header/path sendiri-sendiri.

Adapter harus menyediakan method semantic:

```java
caseQueryBuilder.byAgency(AgencyCode agencyCode)
caseQueryBuilder.sortBy(CaseSortSpec sort)
csvWriter.writeCell(CsvCell cell)
auditLogWriter.record(AuditEvent event)
fileStorage.store(UploadedFile file)
```

Bukan:

```java
executeRawSql(String sql)
writeRawCsv(String line)
setRawHeader(String name, String value)
```

---

## 29. Secure Design Pattern: Validation Policy Registry

Untuk sistem besar, validasi sering inconsistent antar module.

Solusi: definisikan policy reusable.

Contoh:

```text
IdentifierPolicy
NamePolicy
RemarksPolicy
PostalCodePolicy
PhoneNumberPolicy
SortPolicy
FileUploadPolicy
UrlFetchPolicy
CsvExportPolicy
```

Namun hati-hati: jangan buat satu policy global untuk semua string. Policy harus field/domain-specific.

---

## 30. Common Anti-Patterns

1. **Sudah pakai regex, berarti aman.** Regex bisa salah, terlalu permisif, vulnerable to ReDoS, atau tidak sesuai output context.
2. **Sudah sanitize input, berarti aman di semua tempat.** Sanitization context-specific.
3. **Internal endpoint tidak perlu validasi.** Internal caller bisa compromised, buggy, atau dipanggil dari path tak terduga.
4. **Enum valid berarti action allowed.** Enum validity bukan authorization dan bukan workflow validity.
5. **Prepared statement berarti semua SQL dynamic aman.** Identifier, sort, direction, table name, and dynamic fragments butuh allowlist.
6. **Escape manual cukup.** Manual escaping sering salah untuk edge case. Gunakan API/library yang tepat.
7. **Frontend sudah validasi.** Frontend validation adalah UX, bukan security boundary.
8. **Reject character berbahaya.** Tidak ada karakter universal yang selalu berbahaya. Context menentukan bahaya.
9. **Store sanitized data always better.** Menyimpan sanitized data bisa merusak business value dan masih tidak aman untuk context lain.
10. **Unknown field tidak masalah.** Untuk command security-sensitive, unknown field bisa menjadi mass-assignment risk atau future compatibility risk.

---

## 31. Review Checklist untuk Pull Request

### 31.1 Boundary questions

1. Input baru berasal dari mana?
2. Apakah input crossing trust boundary?
3. Apakah format dan length dibatasi?
4. Apakah encoding invalid ditolak?
5. Apakah canonicalization dilakukan sebelum validation?
6. Apakah validasi dilakukan di server, bukan hanya frontend?
7. Apakah DTO berbeda dari entity?
8. Apakah unknown field handling jelas?

### 31.2 Domain questions

1. Apakah input sudah menjadi value object/domain type?
2. Apakah business invariant enforced di domain/service layer?
3. Apakah authorization terpisah dari syntactic validation?
4. Apakah transition/state dicek server-side?
5. Apakah tenant/agency consistency dicek?

### 31.3 Sink questions

1. Apakah input mencapai SQL/JPQL/HQL?
2. Apakah value dibind sebagai parameter?
3. Apakah identifier/sort/table/column allowlisted?
4. Apakah input mencapai OS command?
5. Apakah input mencapai template/expression engine?
6. Apakah input mencapai file path?
7. Apakah input mencapai URL fetch/redirect?
8. Apakah output context punya encoding yang benar?
9. Apakah CSV/log/header sink aman?

### 31.4 Abuse questions

1. Apa payload malicious yang seharusnya ditolak?
2. Apa payload suspicious yang valid sebagai data tetapi harus encoded saat output?
3. Apakah ada test negative?
4. Apakah error message aman?
5. Apakah telemetry cukup tanpa logging raw sensitive payload?

---

## 32. Mini Case Study — Secure Search Endpoint

### 32.1 Requirement

```http
GET /api/cases?keyword=x&status=PENDING&sort=createdDate,desc&page=0&size=20
```

### 32.2 Bad design

```java
@GetMapping("/cases")
public List<CaseDto> search(
    @RequestParam String keyword,
    @RequestParam String status,
    @RequestParam String sort
) {
    String sql = "select * from cases where status = '" + status + "'"
        + " and title like '%" + keyword + "%'"
        + " order by " + sort;
    return jdbcTemplate.query(sql, mapper);
}
```

Masalah:

1. SQL injection via `status`.
2. SQL injection via `keyword`.
3. SQL injection via `sort`.
4. Tidak ada pagination limit.
5. Tidak ada tenant/agency authorization.
6. Tidak ada length limit keyword.
7. Tidak ada typed enum.
8. Tidak ada audit/telemetry validation failure.

### 32.3 Better design

```java
public record SearchCaseHttpRequest(
    String keyword,
    String status,
    String sort,
    Integer page,
    Integer size
) {}
```

Parse:

```java
public final class SearchCaseRequestParser {
    public SearchCaseQuery parse(SearchCaseHttpRequest raw, ActorContext actor) {
        SearchKeyword keyword = SearchKeyword.optional(raw.keyword()).orElse(null);
        CaseStatus status = CaseStatus.parse(raw.status());
        CaseSortSpec sort = CaseSortSpec.parse(raw.sort());
        PageSpec page = PageSpec.of(raw.page(), raw.size(), 100);

        return new SearchCaseQuery(
            Optional.ofNullable(keyword),
            status,
            sort,
            page,
            actor
        );
    }
}
```

Query builder:

```java
String sql = """
    select case_id, title, status, created_date
    from cases
    where agency_id = ?
      and status = ?
      and lower(title) like ?
    order by %s %s
    offset ? rows fetch next ? rows only
    """.formatted(query.sort().field().sqlColumn(), query.sort().direction().sql());
```

Bind:

```java
ps.setString(1, query.actor().agencyCode().value());
ps.setString(2, query.status().name());
ps.setString(3, "%" + query.keyword().normalizedForLike() + "%");
ps.setInt(4, query.page().offset());
ps.setInt(5, query.page().size());
```

Note: even `LIKE` needs attention. Depending on database, `%`, `_`, and escape character policy should be explicit if keyword is meant as literal contains search.

### 32.4 Security properties achieved

1. Raw input does not reach SQL.
2. Status is enum.
3. Sort is allowlist.
4. Pagination is bounded.
5. Agency boundary is derived from actor, not request param.
6. Keyword length is bounded.
7. SQL values are parameters.
8. SQL identifiers are enum-mapped.

---

## 33. Mini Case Study — Secure File Download

### 33.1 Bad design

```java
@GetMapping("/download")
public Resource download(@RequestParam String path) {
    return new FileSystemResource("/storage/" + path);
}
```

Payload:

```text
../../etc/passwd
..%2f..%2fsecret
```

### 33.2 Better design

User should pass document ID, not path.

```http
GET /documents/{documentId}/content
```

Flow:

```text
documentId format valid
-> document exists
-> actor authorized for document/case/tenant
-> storage key read from DB
-> storage key generated by server
-> file resolved under storage root
-> response header filename encoded safely
```

Key point:

> External user should not choose physical path.

---

## 34. Mini Case Study — Secure Workflow Transition

### 34.1 Bad design

```java
@PostMapping("/cases/{id}/status")
public void updateStatus(@PathVariable String id, @RequestParam String status) {
    repository.updateStatus(id, status);
}
```

Masalah:

1. User can set arbitrary status.
2. No transition matrix.
3. No authorization.
4. No audit reason.
5. No current state check.
6. Race condition possible.

### 34.2 Better design

```java
@PostMapping("/cases/{id}/transitions/approve")
public void approve(@PathVariable String id, @RequestBody ApproveCaseRequest request) {
    ApproveCaseCommand command = parser.parse(id, request, currentActor());
    approveCaseUseCase.handle(command);
}
```

Domain:

```java
caseFile.approve(actor, reason, clock);
```

Domain method checks:

1. Current state allows approve.
2. Actor capability.
3. Mandatory fields completed.
4. No lock conflict.
5. Audit event emitted.

This is input validation plus authorization plus workflow integrity.

---

## 35. Production Checklist

### 35.1 Input boundary

- [ ] All external inputs identified.
- [ ] Max request/body/header/file size configured.
- [ ] Content type allowlist exists.
- [ ] Invalid encoding rejected.
- [ ] Unknown JSON field policy decided.
- [ ] Null/missing/empty semantics defined.

### 35.2 Canonicalization

- [ ] Decode layer documented.
- [ ] No accidental double decoding.
- [ ] Unicode normalization policy field-specific.
- [ ] Whitespace policy field-specific.
- [ ] Case normalization uses `Locale.ROOT` where relevant.
- [ ] Path resolution uses normalize/real path/containment checks where needed.

### 35.3 Validation

- [ ] Allowlist used for structured fields.
- [ ] Length limits everywhere.
- [ ] Numeric range checked.
- [ ] Date/time timezone policy explicit.
- [ ] Enum unknown values fail closed.
- [ ] Value objects used for security-sensitive fields.

### 35.4 Injection resistance

- [ ] SQL/JPQL/HQL values parameterized.
- [ ] SQL identifiers allowlisted.
- [ ] LDAP filter/DN escaped correctly.
- [ ] XPath dynamic expressions avoided or safely bound.
- [ ] OS commands avoided or strictly controlled.
- [ ] Template/expression user input not executed.
- [ ] Regex patterns static and ReDoS-reviewed.
- [ ] Redirect/URL fetch policy enforced.

### 35.5 Output/sink safety

- [ ] HTML output encoded by context.
- [ ] CSV formula injection mitigated.
- [ ] Log injection mitigated with structured logging/control char encoding.
- [ ] HTTP header CR/LF rejected.
- [ ] File path traversal blocked.
- [ ] Error messages do not leak internals.

### 35.6 Testing

- [ ] Negative tests for injection payloads.
- [ ] Boundary tests for length/range.
- [ ] Canonicalization tests.
- [ ] ReDoS worst-case tests for complex regex.
- [ ] Integration tests for SQL sorting/filtering.
- [ ] File traversal tests.
- [ ] Authorization tests separate from validation tests.

---

## 36. Review Questions

1. Untuk setiap endpoint, input mana yang crossing trust boundary?
2. Apa canonical representation untuk setiap security-sensitive field?
3. Apakah validasi dilakukan sebelum atau sesudah decode/normalization?
4. Apakah ada raw string dari request yang mencapai SQL, shell, template, path, redirect, atau expression engine?
5. Field mana yang harus allowlist, bukan denylist?
6. Apakah prepared statement digunakan untuk semua value?
7. Apakah dynamic SQL identifier berasal dari enum mapping?
8. Apakah free text aman ketika ditampilkan di HTML, CSV, log, PDF, dan email?
9. Apakah unknown JSON fields diterima? Kenapa?
10. Apakah mass assignment mungkin terjadi?
11. Apakah frontend validation dipercaya sebagai security control?
12. Apakah regex punya length limit dan ReDoS review?
13. Apakah error message membocorkan SQL/path/class/internal rule?
14. Apakah validation failure memiliki telemetry yang aman?
15. Apakah domain invariant tetap enforced jika endpoint lain memanggil service yang sama?

---

## 37. Summary

Input validation bukan sekadar annotation atau regex. Dalam sistem Java yang serius, input validation adalah proses mengubah data dari dunia luar menjadi value internal yang typed, canonical, domain-valid, dan aman untuk dipakai dalam decision maupun sink tertentu.

Prinsip paling penting:

1. Semua input eksternal hostile sampai dibuktikan valid.
2. Canonicalize before validate.
3. Validate at boundary, enforce in domain.
4. Jangan pernah membuat instruction dari raw input.
5. Parameterization lebih penting daripada blacklisting karakter.
6. Output encoding harus sesuai sink.
7. Allowlist structured input.
8. Free text tetap butuh length/control/output policy.
9. Regex bisa menjadi DoS surface.
10. Authorization dan workflow integrity tidak boleh digantikan oleh syntactic validation.

Jika satu kalimat harus diingat:

> Security input pipeline yang benar bukan “membersihkan string”, tetapi “mengubah untrusted representation menjadi domain value yang valid by construction, lalu memastikan value itu hanya digunakan melalui sink adapter yang memisahkan data dari instruction.”

---

## 38. Referensi

Referensi yang relevan untuk part ini:

1. OWASP Input Validation Cheat Sheet.
2. OWASP SQL Injection Prevention Cheat Sheet.
3. OWASP Injection Prevention Cheat Sheet.
4. OWASP Java Security Cheat Sheet.
5. OWASP OS Command Injection Defense Cheat Sheet.
6. OWASP Regular Expression Denial of Service.
7. OWASP Path Traversal guidance.
8. OWASP File Upload Cheat Sheet.
9. OWASP XSS Prevention Cheat Sheet.
10. OWASP LDAP Injection Prevention Cheat Sheet.
11. OWASP Query Parameterization Cheat Sheet.
12. CWE-20: Improper Input Validation.
13. CWE-89: SQL Injection.
14. CWE-78: OS Command Injection.
15. CWE-116: Improper Encoding or Escaping of Output.
16. CWE-79: Cross-Site Scripting.
17. Java `Pattern`, `Normalizer`, `URI`, `Path`, `PreparedStatement`, and Bean Validation APIs.

---

## 39. Status Seri

Seri belum selesai.

Saat ini selesai: **Part 22 dari 35**.

Total rencana: **Part 0 sampai Part 34**.

Part berikutnya: **Part 23 — Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Authorization Integrity: Policy, Permission, and Confused Deputy](./learn-java-security-cryptography-integrity-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics](./learn-java-security-cryptography-integrity-part-023.md)
