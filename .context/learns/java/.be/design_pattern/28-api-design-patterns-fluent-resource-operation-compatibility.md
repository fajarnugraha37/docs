# 28 — API Design Patterns: Fluent, Builder, Resource, Operation, Compatibility

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 28 dari 35  
> Topik: Java API design patterns, contract design, fluent API, builder API, resource API, operation API, command/query API, compatibility, versioning, deprecation, anti-pattern

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Mendesain API Java yang jelas, stabil, evolvable, dan sulit disalahgunakan.
2. Membedakan API internal, public library API, service API, HTTP API, framework extension API, dan domain-facing API.
3. Memilih antara fluent API, builder API, resource-oriented API, operation-oriented API, command API, dan query API.
4. Memahami API sebagai **contract**, bukan sekadar method signature.
5. Mendeteksi anti-pattern API seperti boolean parameter, ambiguous overload, leaking internal enum, universal request object, dan semantic breaking change.
6. Mendesain backward compatibility, deprecation path, versioning, dan migration strategy.
7. Memanfaatkan fitur Java 8–25 seperti functional interface, default method, records, sealed interface, pattern matching, dan virtual-thread-friendly API design.
8. Menghasilkan API yang enak dipakai oleh manusia, stabil untuk sistem, mudah dites, mudah diobservasi, dan aman secara evolusi jangka panjang.

---

## 1. API Design Bukan Sekadar “Nama Method Bagus”

API adalah permukaan kontrak antara dua pihak.

Di Java, API bisa berbentuk:

- public class/method dalam library,
- interface service,
- repository contract,
- command handler contract,
- HTTP endpoint,
- event payload,
- SPI untuk plugin,
- SDK client,
- internal module boundary,
- DTO input/output,
- annotation/configuration contract,
- fluent DSL,
- builder object.

Kesalahan umum engineer menengah adalah menganggap API hanya sebagai:

```java
public Something doSomething(Input input)
```

Padahal API membawa kontrak lebih luas:

```text
Apa yang dijanjikan?
Apa yang tidak dijanjikan?
Siapa pemilik lifecycle?
Apakah input boleh null?
Apakah method idempotent?
Apakah method blocking?
Apakah thread-safe?
Apa error semantics-nya?
Apakah hasil stable?
Apakah caller boleh retry?
Apakah kontrak ini bisa berubah tanpa breaking consumer?
```

Top engineer melihat API sebagai **sistem janji**.

Signature hanya bagian kecil dari kontrak.

---

## 2. Mental Model: API adalah Boundary of Expectations

Sebuah API menciptakan ekspektasi.

Begitu API dipakai consumer, consumer akan mulai bergantung pada:

1. nama method,
2. tipe input,
3. tipe output,
4. exception,
5. status code,
6. field response,
7. enum values,
8. ordering,
9. default value,
10. timing,
11. retry behavior,
12. side effect,
13. nullability,
14. concurrency behavior,
15. performance characteristics,
16. security semantics,
17. audit semantics.

Bahkan hal yang tidak kamu dokumentasikan bisa menjadi kontrak de facto.

Contoh:

```java
List<Application> findApplications();
```

Pertanyaan kontrak:

```text
Apakah urutannya stable?
Apakah return empty list atau null?
Apakah list mutable?
Apakah semua application dikembalikan?
Apakah ada limit?
Apakah ini snapshot?
Apakah caller boleh modify list?
Apakah method ini query-only?
Apakah method ini bisa lambat?
Apakah method ini membuka DB connection?
```

Kalau tidak dijelaskan, consumer akan menebak. Tebakan consumer bisa berubah menjadi dependency.

API design yang baik mengurangi ruang tebakan.

---

## 3. API sebagai Pattern Decision

API design adalah pattern decision karena kamu memilih bentuk komunikasi.

Contoh pilihan bentuk:

| Intent | Pattern API yang Cocok |
|---|---|
| Membuat object kompleks | Builder API |
| Menyusun query/filter | Fluent API / Query Object |
| Mengakses resource domain | Resource-oriented API |
| Menjalankan business operation | Operation API / Command API |
| Membaca data tanpa side effect | Query API |
| Mengubah state | Command API |
| Menyediakan extension | SPI / callback API |
| Menyembunyikan integrasi eksternal | Gateway API |
| Membuat pipeline behavior | Fluent pipeline API |
| Mengembalikan alternatif hasil | Sealed Result API |

Pattern API yang salah akan membuat codebase terasa aneh.

Contoh:

```java
caseApi.updateStatus(caseId, "APPROVED", true, false, null);
```

Ini bukan API yang buruk karena syntax-nya jelek saja.

Ini buruk karena intent-nya kabur:

```text
true itu apa?
false itu apa?
null itu berarti default, unknown, atau disabled?
Apakah operation ini validate?
Apakah mengirim notification?
Apakah audit dibuat?
Apakah idempotent?
```

API yang lebih baik:

```java
caseWorkflow.approve(new ApproveCaseCommand(
    caseId,
    officerId,
    DecisionReason.of("All statutory conditions satisfied"),
    NotificationMode.SEND,
    AuditMode.REQUIRED
));
```

Atau:

```java
caseWorkflow.approve(
    ApproveCaseCommand.builder()
        .caseId(caseId)
        .officerId(officerId)
        .reason("All statutory conditions satisfied")
        .sendNotification()
        .requireAudit()
        .build()
);
```

API yang baik membuat intent menjadi eksplisit.

---

## 4. Taxonomy API dalam Java Enterprise

### 4.1 Library API

Dipakai langsung oleh developer.

Contoh:

```java
Money total = Money.of("SGD", new BigDecimal("100.00"));
```

Karakteristik:

- harus ergonomic,
- harus predictable,
- breaking change mahal,
- dokumentasi penting,
- overload harus hati-hati,
- binary/source compatibility penting.

### 4.2 Application Service API

Dipakai layer lain dalam aplikasi.

Contoh:

```java
SubmitApplicationResult submit(SubmitApplicationCommand command);
```

Karakteristik:

- use case oriented,
- transaction boundary jelas,
- authorization/audit jelas,
- error semantics jelas,
- biasanya tidak terlalu generic.

### 4.3 Domain API

Dipakai untuk menjaga invariant domain.

Contoh:

```java
application.submit(byOfficer, submittedAt);
application.approve(decision);
```

Karakteristik:

- behavior-rich,
- tidak bergantung framework,
- invariant dijaga kuat,
- tidak expose setter sembarangan.

### 4.4 Persistence API

Dipakai untuk akses data.

Contoh:

```java
Optional<Application> findById(ApplicationId id);
void save(Application application);
```

Karakteristik:

- query semantics jelas,
- transaction expectation jelas,
- eager/lazy risk harus dipahami,
- tidak boleh mengaburkan cost query.

### 4.5 HTTP API

Dipakai antar sistem atau frontend.

Contoh:

```http
POST /applications/{id}/approval
```

Karakteristik:

- resource/operation semantics jelas,
- status code benar,
- error format konsisten,
- versioning penting,
- idempotency penting,
- compatibility sangat penting.

### 4.6 Event API

Dipakai consumer asynchronous.

Contoh:

```json
{
  "eventType": "ApplicationApproved",
  "eventVersion": 2,
  "applicationId": "APP-123",
  "approvedAt": "2026-06-18T09:30:00Z"
}
```

Karakteristik:

- schema evolution,
- idempotency,
- ordering,
- backward compatibility,
- replay safety.

### 4.7 SPI / Extension API

Dipakai plugin/extension.

Contoh:

```java
public interface EligibilityRuleProvider {
    List<EligibilityRule> rulesFor(ModuleCode module);
}
```

Karakteristik:

- lifecycle jelas,
- thread-safety jelas,
- compatibility sangat penting,
- error containment penting,
- default method bisa membantu evolusi.

---

## 5. API Contract: Explicit vs Implicit

API contract punya beberapa lapisan.

### 5.1 Syntactic Contract

Apa yang compiler lihat.

```java
Application get(ApplicationId id);
```

Syntactic contract:

- method name,
- parameter type,
- return type,
- checked exception,
- visibility.

### 5.2 Semantic Contract

Apa yang method berarti.

```text
get() apakah throw kalau tidak ada?
get() apakah query DB?
get() apakah include deleted item?
get() apakah include unauthorized item?
```

### 5.3 Temporal Contract

Urutan pemakaian yang benar.

Contoh buruk:

```java
ReportBuilder builder = new ReportBuilder();
builder.setTemplate(template);
builder.setData(data);
builder.compile();
builder.render();
```

Apa yang terjadi kalau `render()` dipanggil sebelum `compile()`?

API dengan temporal coupling memaksa caller mengingat urutan.

API yang lebih aman:

```java
CompiledReport report = ReportCompiler
    .using(template)
    .withData(data)
    .compile();

RenderedReport rendered = report.render();
```

### 5.4 Behavioral Contract

Termasuk:

- idempotency,
- side effect,
- transaction,
- retryability,
- concurrency,
- ordering,
- consistency,
- caching.

### 5.5 Operational Contract

Termasuk:

- latency expectation,
- blocking/non-blocking,
- resource ownership,
- cancellation,
- timeout,
- logging,
- audit,
- metric.

API yang baik membuat kontrak penting eksplisit.

---

## 6. Naming: API Design Pertama adalah Bahasa

Nama API harus mengandung intent.

Bandingkan:

```java
process(application);
handle(application);
doAction(application);
update(application);
```

Dengan:

```java
submit(applicationId, submittedBy);
approve(applicationId, decision);
reject(applicationId, reason);
escalate(applicationId, escalationReason);
withdraw(applicationId, withdrawalRequest);
```

Nama generic seperti `process`, `handle`, `execute`, `manage`, `do`, `perform` sering menjadi tempat bersembunyi logic tidak jelas.

Bukan berarti kata itu selalu salah. `execute(Command)` bisa benar pada abstraction tertentu. Tetapi kalau domain punya vocabulary spesifik, gunakan vocabulary domain.

### 6.1 Nama harus mengungkap side effect

Buruk:

```java
Application check(Application application);
```

Apakah `check` hanya validasi? Apakah menyimpan? Apakah publish event?

Lebih jelas:

```java
ValidationResult validate(Application application);
SubmittedApplication submit(SubmitApplicationCommand command);
```

### 6.2 Nama query tidak boleh menyembunyikan mutation

Buruk:

```java
Application getOrCreate(ApplicationId id);
```

`getOrCreate` punya side effect. Caller bisa mengira hanya query.

Lebih eksplisit:

```java
Optional<Application> find(ApplicationId id);
Application createIfAbsent(ApplicationId id);
```

Atau:

```java
Application ensureExists(ApplicationId id);
```

`ensure` memberi sinyal ada mutation/creation.

### 6.3 Nama harus membedakan command dan query

Query:

```java
ApplicationView getDetails(ApplicationId id);
List<ApplicationSummary> search(ApplicationSearchCriteria criteria);
```

Command:

```java
SubmitApplicationResult submit(SubmitApplicationCommand command);
ApproveApplicationResult approve(ApproveApplicationCommand command);
```

---

## 7. Fluent API Pattern

Fluent API adalah API yang dirancang agar pemanggilan method membentuk bahasa kecil yang readable.

Contoh:

```java
SearchQuery query = SearchQuery
    .where("status").is("PENDING")
    .and("submittedAt").between(start, end)
    .orderBy("submittedAt").descending()
    .limit(50);
```

Tujuannya bukan sekadar chaining.

Tujuannya adalah membentuk **domain-specific language** yang membantu caller menulis intent dengan natural.

Martin Fowler mempopulerkan istilah Fluent Interface untuk gaya API yang menekankan readability melalui method chaining dan DSL-like expression.

### 7.1 Fluent API yang Baik

Ciri-ciri:

1. chain terasa seperti kalimat,
2. urutan valid dipandu tipe,
3. method tidak ambigu,
4. failure point jelas,
5. finalization eksplisit,
6. immutable atau controlled mutable,
7. tidak menyembunyikan side effect berat,
8. tidak membuat stack trace sulit dipahami.

### 7.2 Fluent API Buruk

```java
client.withA(a).withB(b).withC(c).run().ok().done();
```

Masalah:

- kata terlalu generic,
- urutan tidak jelas,
- return type tidak memberi petunjuk,
- error semantics tidak jelas,
- chaining hanya demi style.

### 7.3 Fluent API untuk Query

```java
ApplicationSearch search = ApplicationSearch
    .forOfficer(officerId)
    .withStatus(ApplicationStatus.PENDING_REVIEW)
    .submittedBetween(start, end)
    .sortedBySubmittedAtDescending()
    .page(PageRequest.first(50));
```

Lebih baik daripada:

```java
search(officerId, "PENDING_REVIEW", start, end, "submittedAt", "DESC", 0, 50);
```

### 7.4 Fluent API dengan Staged Type

Staged fluent API dapat mencegah urutan salah.

```java
public final class ApprovalRequestBuilder {

    public static CaseStep approveCase(CaseId caseId) {
        return new Steps(caseId);
    }

    public interface CaseStep {
        OfficerStep by(OfficerId officerId);
    }

    public interface OfficerStep {
        ReasonStep because(String reason);
    }

    public interface ReasonStep {
        FinalStep notifyApplicant();
        FinalStep silently();
    }

    public interface FinalStep {
        ApproveCaseCommand build();
    }

    private static final class Steps implements CaseStep, OfficerStep, ReasonStep, FinalStep {
        private final CaseId caseId;
        private OfficerId officerId;
        private String reason;
        private boolean notify;

        private Steps(CaseId caseId) {
            this.caseId = Objects.requireNonNull(caseId);
        }

        @Override
        public OfficerStep by(OfficerId officerId) {
            this.officerId = Objects.requireNonNull(officerId);
            return this;
        }

        @Override
        public ReasonStep because(String reason) {
            if (reason == null || reason.isBlank()) {
                throw new IllegalArgumentException("reason must not be blank");
            }
            this.reason = reason;
            return this;
        }

        @Override
        public FinalStep notifyApplicant() {
            this.notify = true;
            return this;
        }

        @Override
        public FinalStep silently() {
            this.notify = false;
            return this;
        }

        @Override
        public ApproveCaseCommand build() {
            return new ApproveCaseCommand(caseId, officerId, reason, notify);
        }
    }
}
```

Pemakaian:

```java
ApproveCaseCommand command = ApprovalRequestBuilder
    .approveCase(caseId)
    .by(officerId)
    .because("All requirements satisfied")
    .notifyApplicant()
    .build();
```

Keuntungan:

- required step dipaksa compiler,
- boolean flag tidak tersembunyi,
- intent readable,
- invalid order sulit terjadi.

Biaya:

- boilerplate tinggi,
- tipe lebih banyak,
- tidak cocok untuk API sederhana.

### 7.5 Kapan Fluent API Cocok?

Cocok ketika:

- ada grammar/domain language,
- operasi sering dikombinasikan,
- banyak opsi optional,
- readability lebih penting daripada minimalisme,
- caller sering menulis query/config/pipeline,
- urutan dapat dipandu tipe.

Tidak cocok ketika:

- operasi sederhana,
- side effect besar,
- chain menyembunyikan transaksi/network call,
- error handling kompleks,
- debugging menjadi susah.

---

## 8. Builder API Pattern

Builder API cocok untuk membuat object kompleks.

Contoh buruk:

```java
new NotificationRequest(
    recipient,
    subject,
    body,
    true,
    false,
    null,
    3,
    Duration.ofSeconds(10)
);
```

Lebih baik:

```java
NotificationRequest request = NotificationRequest.builder()
    .recipient(recipient)
    .subject(subject)
    .body(body)
    .email()
    .retry(3)
    .timeout(Duration.ofSeconds(10))
    .build();
```

### 8.1 Builder untuk Immutable Object

```java
public record NotificationRequest(
    Recipient recipient,
    String subject,
    String body,
    Channel channel,
    RetryPolicy retryPolicy,
    Duration timeout
) {
    public NotificationRequest {
        Objects.requireNonNull(recipient);
        Objects.requireNonNull(subject);
        Objects.requireNonNull(body);
        Objects.requireNonNull(channel);
        Objects.requireNonNull(retryPolicy);
        Objects.requireNonNull(timeout);

        if (subject.isBlank()) {
            throw new IllegalArgumentException("subject must not be blank");
        }
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private Recipient recipient;
        private String subject;
        private String body;
        private Channel channel = Channel.EMAIL;
        private RetryPolicy retryPolicy = RetryPolicy.none();
        private Duration timeout = Duration.ofSeconds(5);

        public Builder recipient(Recipient recipient) {
            this.recipient = recipient;
            return this;
        }

        public Builder subject(String subject) {
            this.subject = subject;
            return this;
        }

        public Builder body(String body) {
            this.body = body;
            return this;
        }

        public Builder email() {
            this.channel = Channel.EMAIL;
            return this;
        }

        public Builder sms() {
            this.channel = Channel.SMS;
            return this;
        }

        public Builder retry(int maxAttempts) {
            this.retryPolicy = RetryPolicy.maxAttempts(maxAttempts);
            return this;
        }

        public Builder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        public NotificationRequest build() {
            return new NotificationRequest(
                recipient,
                subject,
                body,
                channel,
                retryPolicy,
                timeout
            );
        }
    }
}
```

### 8.2 Builder Bukan Tempat Business Logic Berat

Builder boleh melakukan:

- null check,
- required field check,
- format validation ringan,
- defaulting,
- normalization sederhana.

Builder sebaiknya tidak melakukan:

- query database,
- panggil external API,
- authorization,
- publish event,
- membuka file/socket,
- generate audit trail.

Kalau builder melakukan side effect berat, API terlihat seperti object creation tetapi sebenarnya use case execution.

Itu menyesatkan.

### 8.3 Builder vs Fluent API

Builder fokus pada construction.

Fluent API fokus pada expression/grammar.

Kadang keduanya mirip, tetapi intent-nya beda.

```java
ApplicationSearch.builder()
    .status(PENDING)
    .page(0, 50)
    .build();
```

Ini builder.

```java
ApplicationSearch
    .whereStatus(PENDING)
    .andSubmittedBetween(start, end)
    .orderBySubmittedAtDescending();
```

Ini fluent query API.

---

## 9. Resource-Oriented API

Resource-oriented API memodelkan sistem sebagai resource dengan lifecycle.

HTTP API sering cocok memakai pendekatan ini.

Contoh:

```http
GET    /applications/{id}
POST   /applications
PATCH  /applications/{id}
DELETE /applications/{id}
```

Resource-oriented API cocok untuk CRUD-like domain dan query resource.

Tetapi tidak semua operasi domain cocok dipaksa menjadi CRUD.

### 9.1 Resource yang Baik

Resource sebaiknya:

- punya identity,
- punya lifecycle,
- bisa direpresentasikan,
- punya ownership/security boundary,
- punya clear state.

Contoh:

```text
/application/{id}
/cases/{id}
/documents/{id}
/officers/{id}
/payments/{id}
```

### 9.2 Sub-resource

```http
GET /cases/{caseId}/documents
POST /cases/{caseId}/documents
GET /cases/{caseId}/activities
GET /cases/{caseId}/available-actions
```

Sub-resource bagus ketika relationship penting.

Tetapi hindari nested URL terlalu dalam:

```http
/agencies/{agencyId}/departments/{departmentId}/teams/{teamId}/officers/{officerId}/cases/{caseId}/documents/{documentId}
```

Terlalu dalam membuat API rapuh terhadap perubahan struktur organisasi.

### 9.3 Resource API dan HTTP Semantics

HTTP punya semantics untuk method dan status code. RFC 9110 mendefinisikan HTTP semantics, termasuk method semantics, status codes, safe method, dan idempotent method.

Prinsip umum:

| Method | Semantics umum |
|---|---|
| GET | baca resource, safe |
| POST | create atau execute operation non-idempotent |
| PUT | replace resource, idempotent |
| PATCH | partial update |
| DELETE | delete resource, idempotent secara intent |

Catatan penting:

- `GET` tidak boleh melakukan mutation bermakna.
- `POST` tidak selalu create; bisa operation.
- `PUT` berarti replace, bukan partial update.
- `PATCH` butuh semantics patch yang jelas.
- idempotency bukan berarti response selalu sama, tetapi efek berulang tidak menambah perubahan baru.

### 9.4 Resource-Oriented Anti-Pattern

Buruk:

```http
GET /applications/{id}/approve
```

Masalah:

- `GET` melakukan mutation,
- cache/proxy/crawler bisa memicu efek,
- semantics HTTP dilanggar.

Lebih baik:

```http
POST /applications/{id}/approval
```

Atau:

```http
POST /application-approvals
```

Dengan body:

```json
{
  "applicationId": "APP-123",
  "reason": "Requirements satisfied"
}
```

---

## 10. Operation-Oriented API

Tidak semua aksi domain natural sebagai CRUD resource.

Contoh:

- approve application,
- reject case,
- escalate complaint,
- assign officer,
- generate report,
- resend notification,
- synchronize external status,
- validate eligibility,
- calculate fee,
- reopen case.

Untuk operasi seperti ini, operation-oriented API sering lebih jelas.

### 10.1 Operation sebagai Verb

```java
approvalService.approve(command);
caseService.escalate(command);
reportService.generate(command);
```

HTTP:

```http
POST /applications/{id}/approval
POST /cases/{id}/escalation
POST /reports/generation-jobs
```

### 10.2 Operation Harus Punya Object Input

Buruk:

```java
approve(caseId, officerId, reason, true, false);
```

Baik:

```java
approve(new ApproveCaseCommand(
    caseId,
    officerId,
    DecisionReason.of(reason),
    NotificationMode.SEND,
    AuditMode.REQUIRED
));
```

### 10.3 Operation Harus Mengungkap Result

Buruk:

```java
void approve(ApproveCaseCommand command);
```

Kadang `void` cukup, tetapi sering menyembunyikan hasil penting.

Lebih baik:

```java
ApproveCaseResult approve(ApproveCaseCommand command);
```

Dengan result:

```java
public sealed interface ApproveCaseResult {
    record Approved(CaseId caseId, CaseStatus newStatus) implements ApproveCaseResult {}
    record AlreadyApproved(CaseId caseId) implements ApproveCaseResult {}
    record RejectedByPolicy(CaseId caseId, List<Reason> reasons) implements ApproveCaseResult {}
}
```

Ini membuat outcome eksplisit.

### 10.4 Operation-Oriented Anti-Pattern

```http
POST /doAction
POST /process
POST /execute
```

Masalah:

- tidak domain-specific,
- sulit audit,
- sulit authorize,
- sulit versioning,
- sulit observability,
- sering menjadi endpoint serbaguna.

Lebih baik pakai nama domain operation.

---

## 11. Command API Pattern

Command API memodelkan perubahan state sebagai intent.

```java
public record SubmitApplicationCommand(
    ApplicationId applicationId,
    ApplicantId applicantId,
    SubmissionChannel channel,
    Instant submittedAt,
    IdempotencyKey idempotencyKey
) {}
```

Command API cocok ketika:

- operasi mengubah state,
- audit penting,
- authorization penting,
- idempotency penting,
- validation kompleks,
- workflow transition eksplisit,
- retry mungkin terjadi.

### 11.1 Command Naming

Gunakan verb domain:

```text
SubmitApplicationCommand
ApproveCaseCommand
RejectAppealCommand
AssignOfficerCommand
EscalateComplaintCommand
GenerateReportCommand
```

Hindari:

```text
UpdateCommand
ProcessCommand
ActionCommand
GenericCommand
RequestCommand
```

### 11.2 Command Harus Membedakan Actor dan Subject

Buruk:

```java
record ApproveCommand(String caseId, String userId) {}
```

Lebih baik:

```java
record ApproveCaseCommand(
    CaseId caseId,
    OfficerId approvedBy,
    DecisionReason reason,
    Instant requestedAt,
    IdempotencyKey idempotencyKey
) {}
```

`approvedBy` lebih jelas daripada `userId`.

### 11.3 Command Bukan Persistence Entity

Command adalah input use case, bukan entity.

Buruk:

```java
approve(ApplicationEntity entity);
```

Masalah:

- caller bisa membawa entity stale,
- authorization sulit,
- transaction boundary kabur,
- persistence detail bocor.

Lebih baik:

```java
approve(ApproveApplicationCommand command);
```

Handler yang load aggregate sendiri di transaction boundary.

---

## 12. Query API Pattern

Query API memodelkan pembacaan data.

```java
ApplicationDetails getDetails(ApplicationId id, Viewer viewer);
Page<ApplicationSummary> search(ApplicationSearchQuery query);
```

Query API harus jelas tentang:

- filter,
- sorting,
- pagination,
- authorization scope,
- visibility,
- consistency,
- projection,
- cost.

### 12.1 Query Object

Buruk:

```java
search(status, from, to, officer, module, page, size, sort, direction);
```

Baik:

```java
record ApplicationSearchQuery(
    Optional<ApplicationStatus> status,
    Optional<DateRange> submittedRange,
    Optional<OfficerId> assignedOfficer,
    ModuleCode module,
    PageRequest page,
    Sort sort
) {}
```

### 12.2 Query Result Harus Projection-Specific

Buruk:

```java
List<Application> search(...);
```

Kalau dipakai untuk listing, jangan return full domain entity.

Baik:

```java
Page<ApplicationSummary> search(ApplicationSearchQuery query);
```

Untuk detail:

```java
ApplicationDetails getDetails(ApplicationId id);
```

Untuk export:

```java
ExportJobId requestExport(ApplicationExportQuery query);
```

### 12.3 Query API Tidak Boleh Menyembunyikan Heavy Operation

```java
List<AuditTrail> findAll();
```

Ini berbahaya untuk data besar.

Lebih baik:

```java
Page<AuditTrailSummary> search(AuditTrailSearchQuery query);
Stream<AuditTrailExportRow> streamForExport(AuditTrailExportQuery query);
```

Kalau return `Stream`, jelaskan resource lifecycle.

---

## 13. Versioning Pattern

API berubah karena requirement berubah.

Pertanyaannya bukan “apakah API berubah”, tetapi “bagaimana API berubah tanpa menghancurkan consumer”.

### 13.1 Jenis Perubahan

| Perubahan | Biasanya Breaking? |
|---|---:|
| Tambah optional field response | Tidak, kalau consumer tolerant |
| Hapus field response | Ya |
| Rename field | Ya |
| Ubah type field | Ya |
| Tambah enum value | Bisa breaking |
| Ubah semantics field | Ya, bahkan jika schema sama |
| Tambah required request field | Ya |
| Tambah optional request field | Tidak |
| Ubah default behavior | Bisa breaking |
| Ubah ordering | Bisa breaking jika consumer bergantung |
| Ubah error code | Bisa breaking |
| Ubah idempotency | Ya |

Breaking change bukan hanya compile failure.

Semantic change bisa lebih berbahaya karena tidak langsung terlihat.

### 13.2 Java Library Versioning

Untuk Java library, compatibility mencakup:

- source compatibility,
- binary compatibility,
- behavioral compatibility,
- serialization compatibility,
- dependency compatibility.

Contoh perubahan berisiko:

```java
public interface Rule {
    EvaluationResult evaluate(Context context);
}
```

Menambah abstract method:

```java
public interface Rule {
    EvaluationResult evaluate(Context context);
    RuleMetadata metadata();
}
```

Ini breaking untuk implementor.

Alternatif:

```java
public interface Rule {
    EvaluationResult evaluate(Context context);

    default RuleMetadata metadata() {
        return RuleMetadata.unspecified();
    }
}
```

Default method dapat membantu evolusi interface, tetapi jangan dipakai sembarangan untuk menambal desain buruk.

### 13.3 HTTP API Versioning

Beberapa pendekatan:

```text
/v1/applications
/v2/applications
```

```http
Accept: application/vnd.company.application-v2+json
```

```http
X-API-Version: 2
```

Tidak ada satu pendekatan yang selalu benar.

Yang penting:

- versioning policy jelas,
- deprecation policy jelas,
- compatibility matrix jelas,
- migration guide tersedia,
- observability untuk consumer usage ada.

### 13.4 Event Versioning

Event harus lebih hati-hati daripada HTTP response biasa karena consumer asynchronous bisa lambat upgrade.

Prinsip:

- event immutable secara meaning,
- jangan rename event type sembarangan,
- tambah field harus backward compatible,
- consumer harus ignore unknown fields,
- producer harus bisa publish versi lama sementara,
- event version harus eksplisit.

Contoh:

```java
public record ApplicationApprovedV2(
    EventId eventId,
    ApplicationId applicationId,
    OfficerId approvedBy,
    Instant approvedAt,
    DecisionReason reason,
    int schemaVersion
) {}
```

---

## 14. Backward Compatibility Pattern

Backward compatibility adalah kemampuan versi baru untuk tetap melayani consumer lama.

### 14.1 Additive Change

Tambahkan field optional.

```json
{
  "applicationId": "APP-123",
  "status": "APPROVED",
  "approvedAt": "2026-06-18T09:30:00Z"
}
```

Menjadi:

```json
{
  "applicationId": "APP-123",
  "status": "APPROVED",
  "approvedAt": "2026-06-18T09:30:00Z",
  "approvedBy": "OFFICER-9"
}
```

Aman jika consumer ignore unknown field.

### 14.2 Parallel Contract

Sediakan versi baru berdampingan.

```java
ApplicationDetails getDetails(ApplicationId id);
ApplicationDetailsV2 getDetailsV2(ApplicationId id);
```

Atau HTTP:

```http
GET /v1/applications/{id}
GET /v2/applications/{id}
```

### 14.3 Adapter for Old Contract

Internal model baru, contract lama tetap dilayani via adapter.

```java
public LegacyApplicationResponse toLegacy(ApplicationDetails details) {
    return new LegacyApplicationResponse(
        details.id().value(),
        details.status().legacyCode(),
        details.submittedAt().toString()
    );
}
```

### 14.4 Deprecation with Observability

Deprecation tanpa observability hanya harapan.

Untuk API lama, catat:

- consumer id,
- endpoint/method,
- version,
- frequency,
- last used time,
- migration status.

Header contoh:

```http
Deprecation: true
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: </docs/migration/v2>; rel="deprecation"
```

---

## 15. Deprecation Pattern

Deprecation yang baik punya path.

Buruk:

```java
@Deprecated
public void process(Application application) { ... }
```

Tanpa penjelasan, caller tidak tahu pengganti.

Lebih baik:

```java
/**
 * @deprecated Use {@link #submit(SubmitApplicationCommand)} for explicit
 * submission semantics, idempotency, audit, and validation result.
 * This method will be removed after 2026-12-31.
 */
@Deprecated(since = "3.4", forRemoval = true)
public void process(Application application) { ... }
```

### 15.1 Deprecation Checklist

Sebelum deprecate:

```text
Apa penggantinya?
Apakah feature parity tersedia?
Apakah migration guide ada?
Apakah telemetry usage ada?
Apakah consumer utama sudah diketahui?
Apakah timeline realistis?
Apakah fallback diperlukan?
```

---

## 16. Error Compatibility

Error adalah bagian dari API.

Kalau consumer bergantung pada error code, perubahan error code bisa breaking.

Buruk:

```json
{
  "error": "Invalid status"
}
```

Lebih baik:

```json
{
  "type": "https://example.gov/problems/invalid-transition",
  "title": "Invalid case transition",
  "status": 409,
  "code": "CASE_INVALID_TRANSITION",
  "detail": "Case APP-123 cannot move from APPROVED to DRAFT.",
  "instance": "/cases/APP-123/transitions/REQ-789"
}
```

RFC 9457 mendefinisikan Problem Details untuk membawa error detail machine-readable pada HTTP API dan menggantikan RFC 7807.

### 16.1 Error Contract Stabil

Stabilkan:

- error code,
- retryable flag,
- field path,
- status mapping,
- reason category,
- correlation id.

Jangan stabilkan:

- full human message sebagai parsing target,
- stack trace,
- vendor exception message.

---

## 17. Java 8–25 Perspective

### 17.1 Java 8: Functional Interface untuk Callback API

```java
@FunctionalInterface
public interface RetryListener {
    void onRetry(RetryAttempt attempt);
}
```

Pemakaian:

```java
client.withRetryListener(attempt -> log.info("retry {}", attempt.number()));
```

Functional interface membuat extension API ringan.

Tapi hati-hati:

- callback jangan dipanggil sambil lock dipegang,
- callback error harus ditangani,
- callback execution thread harus jelas,
- callback tidak boleh menyembunyikan blocking behavior.

### 17.2 Default Method untuk Evolusi Interface

```java
public interface AuditSink {
    void record(AuditEvent event);

    default boolean supportsBatch() {
        return false;
    }

    default void recordBatch(List<AuditEvent> events) {
        for (AuditEvent event : events) {
            record(event);
        }
    }
}
```

Default method membantu compatibility, tetapi default behavior harus aman.

### 17.3 Optional sebagai Return Boundary

```java
Optional<Application> findById(ApplicationId id);
```

Cocok untuk result yang memang bisa absent.

Tidak cocok untuk:

- field DTO,
- parameter wajib,
- collection optional,
- serialization contract sembarangan.

### 17.4 Records untuk DTO dan Value API

```java
public record ApplicationSummary(
    ApplicationId id,
    ApplicationStatus status,
    Instant submittedAt
) {}
```

Records cocok untuk immutable data carrier.

Tetapi record bukan alasan untuk membuat model miskin behavior.

### 17.5 Sealed Interface untuk Result API

```java
public sealed interface SubmitResult {
    record Submitted(ApplicationId id) implements SubmitResult {}
    record ValidationFailed(List<Violation> violations) implements SubmitResult {}
    record DuplicateSubmission(ApplicationId id) implements SubmitResult {}
}
```

Caller bisa exhaustive switch.

```java
return switch (result) {
    case SubmitResult.Submitted submitted -> ok(submitted);
    case SubmitResult.ValidationFailed failed -> badRequest(failed);
    case SubmitResult.DuplicateSubmission duplicate -> conflict(duplicate);
};
```

Java 25 mendukung pattern matching switch sebagai bagian penting untuk mengekspresikan branching berdasarkan type/result secara lebih aman daripada `instanceof` chain.

### 17.6 Virtual Threads dan Blocking API

Dengan virtual threads, blocking API kembali masuk akal untuk banyak use case I/O-bound.

Tetapi API tetap harus menjelaskan:

- apakah method blocking,
- apakah mendukung interrupt/cancellation,
- timeout bagaimana diterapkan,
- apakah resource ditutup otomatis,
- apakah aman dipanggil paralel.

Buruk:

```java
Report generate(ReportRequest request);
```

Lebih jelas:

```java
Report generate(ReportRequest request, Deadline deadline);
```

Atau:

```java
ReportJob submitGeneration(ReportGenerationCommand command);
```

Jika proses panjang, jangan sembunyikan long-running work di API sinkron sederhana.

---

## 18. Boolean Parameter Anti-Pattern

Boolean parameter sering membuat API tidak readable.

Buruk:

```java
sendEmail(user, true);
```

Apa arti `true`?

Lebih buruk:

```java
updateCase(caseId, true, false, true);
```

### 18.1 Alternatif: Named Method

```java
sendEmailImmediately(user);
scheduleEmail(user);
```

### 18.2 Alternatif: Enum

```java
sendEmail(user, DeliveryMode.IMMEDIATE);
```

### 18.3 Alternatif: Options Object

```java
sendEmail(user, EmailOptions.builder()
    .deliveryMode(DeliveryMode.IMMEDIATE)
    .tracking(Tracking.ENABLED)
    .priority(Priority.HIGH)
    .build());
```

### 18.4 Kapan Boolean Masih Boleh?

Boolean boleh jika:

- nama parameter terlihat jelas di caller melalui named argument? Java tidak punya named argument.
- method private/lokal kecil,
- boolean benar-benar domain boolean,
- context sangat obvious.

Contoh masih cukup masuk akal:

```java
new FeatureFlag("new-checkout", true);
```

Tetapi untuk public API, hindari boolean flag yang mengubah behavior besar.

---

## 19. Ambiguous Overload Anti-Pattern

Overload bisa ergonomic, tetapi mudah ambigu.

Buruk:

```java
find(String id);
find(String name);
```

Tidak bisa overload dengan signature sama, tapi sering muncul variasi seperti:

```java
find(String value, boolean byName);
```

Atau:

```java
search(String query);
search(ApplicationStatus status);
search(String query, ApplicationStatus status);
```

Masalah:

- caller bingung,
- `null` ambiguity,
- overload resolution bisa mengejutkan,
- behavior tersembunyi.

Lebih baik:

```java
findById(ApplicationId id);
findByName(ApplicationName name);
search(ApplicationSearchQuery query);
```

Gunakan type domain untuk menghindari primitive/string ambiguity.

```java
record ApplicationId(String value) {}
record ApplicationName(String value) {}
```

---

## 20. Leaking Internal Enum Anti-Pattern

Enum sering terasa aman, tetapi bisa menjadi kontrak eksternal yang sulit diubah.

Buruk:

```java
public enum InternalWorkflowStatus {
    DRAFT,
    PENDING_L1,
    PENDING_L2,
    AUTO_ROUTED,
    LEGACY_REVIEW,
    APPROVED
}
```

Kalau enum internal ini diekspos ke API eksternal, consumer akan bergantung pada detail workflow internal.

Lebih baik:

```java
public enum ApplicationDisplayStatus {
    DRAFT,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Mapping internal:

```java
ApplicationDisplayStatus toDisplayStatus(InternalWorkflowStatus status) {
    return switch (status) {
        case DRAFT -> ApplicationDisplayStatus.DRAFT;
        case PENDING_L1, PENDING_L2, AUTO_ROUTED, LEGACY_REVIEW -> ApplicationDisplayStatus.UNDER_REVIEW;
        case APPROVED -> ApplicationDisplayStatus.APPROVED;
    };
}
```

API harus expose vocabulary yang stabil untuk consumer, bukan internal state machine detail.

---

## 21. Universal DTO Anti-Pattern

Universal DTO muncul ketika satu object dipakai untuk semua boundary.

```java
public class ApplicationDto {
    public String id;
    public String status;
    public String applicantName;
    public String internalRemarks;
    public String officerComment;
    public String rejectionReason;
    public String approvalReason;
    public Boolean editable;
    public Boolean deletable;
    public Boolean canApprove;
    public List<DocumentDto> documents;
    public List<AuditDto> audits;
}
```

Dipakai untuk:

- create request,
- update request,
- list response,
- detail response,
- export,
- event,
- internal mapping.

Masalah:

- field authorization kacau,
- null semantics kacau,
- overfetching,
- accidental exposure,
- versioning sulit,
- validation context tidak jelas,
- API consumer bingung.

Lebih baik pisahkan:

```java
CreateApplicationRequest
UpdateApplicationRequest
ApplicationSummaryResponse
ApplicationDetailsResponse
ApplicationExportRow
ApplicationSubmittedEvent
ApplicationEntity
ApplicationDomainModel
```

Boundary-specific model bukan duplikasi buruk. Itu perlindungan kontrak.

---

## 22. Options Object Pattern

Options object menggantikan parameter panjang.

Buruk:

```java
generateReport(type, from, to, true, false, 1000, "PDF", locale);
```

Baik:

```java
GenerateReportOptions options = GenerateReportOptions.builder()
    .type(ReportType.ACTIVITY)
    .period(DateRange.closed(from, to))
    .includeSummary()
    .format(ReportFormat.PDF)
    .locale(locale)
    .maxRows(1000)
    .build();

reportService.generate(options);
```

### 22.1 Options Object harus Immutable

```java
public record GenerateReportOptions(
    ReportType type,
    DateRange period,
    boolean includeSummary,
    ReportFormat format,
    Locale locale,
    int maxRows
) {
    public GenerateReportOptions {
        Objects.requireNonNull(type);
        Objects.requireNonNull(period);
        Objects.requireNonNull(format);
        Objects.requireNonNull(locale);
        if (maxRows <= 0 || maxRows > 100_000) {
            throw new IllegalArgumentException("maxRows out of range");
        }
    }
}
```

### 22.2 Options Object Bukan Dumping Ground

Kalau options object punya 80 field, kemungkinan API terlalu luas.

Solusi:

- pecah use case,
- pecah mode,
- buat sealed options,
- buat strategy/policy object.

Contoh:

```java
public sealed interface ReportGenerationRequest {
    record ActivityReport(DateRange period, OfficerScope scope) implements ReportGenerationRequest {}
    record RevenueReport(DateRange period, Currency currency) implements ReportGenerationRequest {}
    record ComplianceReport(DateRange period, RiskLevel minimumRisk) implements ReportGenerationRequest {}
}
```

---

## 23. API Idempotency Pattern

Idempotency adalah bagian penting API command.

```java
public record SubmitPaymentCommand(
    PaymentId paymentId,
    Amount amount,
    IdempotencyKey idempotencyKey
) {}
```

HTTP:

```http
POST /payments
Idempotency-Key: 5f8a1e28-6f9e-4db0-88f1-0f122b2c9c11
```

### 23.1 Kapan Butuh Idempotency Key?

Butuh ketika:

- client bisa retry,
- operation non-idempotent,
- external system unreliable,
- user bisa double click,
- network timeout bisa terjadi setelah server berhasil memproses,
- payment/submission/approval tidak boleh double.

### 23.2 Idempotency Response Contract

Untuk request sama:

- jika payload sama, return result sama atau equivalent,
- jika payload beda dengan key sama, return conflict,
- simpan hash request,
- simpan outcome,
- tentukan TTL.

```java
public sealed interface IdempotencyDecision {
    record FirstExecution() implements IdempotencyDecision {}
    record ReplayPrevious(Result previousResult) implements IdempotencyDecision {}
    record Conflict(String reason) implements IdempotencyDecision {}
}
```

---

## 24. API Pagination Pattern

Pagination bukan detail kecil.

API tanpa pagination bisa menjadi outage.

Buruk:

```java
List<ApplicationSummary> listAll();
```

Baik:

```java
Page<ApplicationSummary> search(ApplicationSearchQuery query);
```

### 24.1 Offset Pagination

```http
GET /applications?page=0&size=50
```

Mudah, tetapi untuk data besar bisa lambat dan tidak stabil saat data berubah.

### 24.2 Cursor Pagination

```http
GET /applications?limit=50&cursor=eyJzdWJtaXR0ZWRBdCI6...
```

Lebih cocok untuk data besar dan feed.

### 24.3 Contract Pagination

Jelaskan:

- default size,
- max size,
- sort order default,
- stable ordering,
- cursor expiry,
- snapshot atau live view,
- total count tersedia atau tidak.

Total count bisa mahal. Jangan selalu expose kalau tidak diperlukan.

---

## 25. API Security Design

API design harus memperhitungkan security sejak awal.

### 25.1 Jangan Percaya Client Field

Buruk:

```json
{
  "applicationId": "APP-123",
  "applicantId": "USER-9",
  "role": "ADMIN",
  "status": "APPROVED"
}
```

Server tidak boleh menerima role/status dari client sebagai otoritas.

### 25.2 Authority dari Context, Bukan Request Body

```java
approve(new ApproveApplicationCommand(
    applicationId,
    authenticatedOfficer.id(),
    reason,
    idempotencyKey
));
```

Actor harus berasal dari trusted security context.

### 25.3 Field-Level Exposure

Response harus disesuaikan dengan viewer.

```java
ApplicationDetails details = presenter.present(application, viewerAccess);
```

Jangan return entity lalu berharap frontend menyembunyikan field.

---

## 26. API Observability Design

API yang baik mudah di-debug.

Setiap API operation penting sebaiknya punya:

- operation name,
- correlation id,
- actor id,
- resource id,
- idempotency key,
- result category,
- latency,
- failure code,
- downstream dependency summary.

Contoh log event:

```json
{
  "event": "api.operation.completed",
  "operation": "ApproveApplication",
  "applicationId": "APP-123",
  "actorId": "OFFICER-9",
  "result": "APPROVED",
  "durationMs": 184,
  "correlationId": "corr-abc"
}
```

Jangan log sensitive payload penuh.

---

## 27. API Testing Strategy

### 27.1 Contract Test

Pastikan contract tidak berubah tanpa sadar.

Untuk Java API:

- compile compatibility test,
- public API snapshot,
- binary compatibility checker,
- golden tests untuk serialization.

Untuk HTTP API:

- OpenAPI contract test,
- consumer-driven contract,
- response schema validation,
- backward compatibility check.

### 27.2 Semantic Test

Test behavior, bukan hanya schema.

```text
GET tidak mengubah state.
POST dengan idempotency key sama tidak double submit.
PATCH null berarti clear atau ignore sesuai contract.
Unauthorized user tidak melihat restricted field.
Deprecated endpoint tetap menghasilkan response legacy.
```

### 27.3 Error Contract Test

```text
Invalid transition menghasilkan 409.
Validation error menghasilkan field violations.
Unauthorized menghasilkan 403/404 sesuai policy.
Retryable downstream failure punya retryable=true.
```

### 27.4 Compatibility Test

Simpan sample request/response versi lama.

Pastikan versi baru masih bisa:

- membaca request lama,
- menghasilkan response compatible,
- ignore unknown field,
- maintain enum semantics.

---

## 28. Refactoring Path: Dari API Buruk ke API Baik

### 28.1 Starting Point

```java
public void process(String id, String action, boolean notify, boolean force, String comment) {
    // huge logic
}
```

Masalah:

- stringly typed action,
- boolean flags,
- comment nullable,
- tidak ada result,
- authorization tidak jelas,
- operation terlalu generic,
- sulit audit,
- sulit test.

### 28.2 Introduce Command Types

```java
public sealed interface CaseActionCommand permits ApproveCaseCommand, RejectCaseCommand, EscalateCaseCommand {
    CaseId caseId();
    OfficerId actorId();
}

public record ApproveCaseCommand(
    CaseId caseId,
    OfficerId actorId,
    DecisionReason reason,
    NotificationMode notificationMode,
    IdempotencyKey idempotencyKey
) implements CaseActionCommand {}

public record RejectCaseCommand(
    CaseId caseId,
    OfficerId actorId,
    RejectionReason reason,
    NotificationMode notificationMode,
    IdempotencyKey idempotencyKey
) implements CaseActionCommand {}

public record EscalateCaseCommand(
    CaseId caseId,
    OfficerId actorId,
    EscalationReason reason,
    OfficerGroup targetGroup,
    IdempotencyKey idempotencyKey
) implements CaseActionCommand {}
```

### 28.3 Introduce Explicit API

```java
public interface CaseWorkflowApi {
    ApproveCaseResult approve(ApproveCaseCommand command);
    RejectCaseResult reject(RejectCaseCommand command);
    EscalateCaseResult escalate(EscalateCaseCommand command);
}
```

### 28.4 Keep Legacy Adapter Temporarily

```java
/**
 * @deprecated Use explicit workflow methods instead.
 */
@Deprecated(since = "4.2", forRemoval = true)
public void process(String id, String action, boolean notify, boolean force, String comment) {
    switch (action) {
        case "APPROVE" -> workflow.approve(toApproveCommand(id, notify, comment));
        case "REJECT" -> workflow.reject(toRejectCommand(id, notify, comment));
        case "ESCALATE" -> workflow.escalate(toEscalateCommand(id, comment));
        default -> throw new IllegalArgumentException("Unknown action: " + action);
    }
}
```

### 28.5 Add Observability

Log usage of old API.

```java
legacyApiUsage.record("process", action, callerId);
```

### 28.6 Remove After Migration

Only remove after:

- usage metric near zero,
- consumer migrated,
- tests updated,
- release note published.

---

## 29. Case Study: Regulatory Case API

### 29.1 Bad API

```java
caseService.update(
    caseId,
    "APPROVE",
    userId,
    true,
    false,
    "ok",
    null
);
```

Problems:

```text
APPROVE stringly typed.
true/false unclear.
userId could be forged if from request body.
comment semantics unclear.
null semantics unclear.
No idempotency.
No result.
No transition invariant visible.
No audit mode visible.
No notification policy visible.
```

### 29.2 Better Java API

```java
ApproveCaseCommand command = ApproveCaseCommand.builder()
    .caseId(caseId)
    .approvedBy(currentOfficer.id())
    .reason(DecisionReason.of("All statutory requirements satisfied"))
    .notificationMode(NotificationMode.SEND_TO_APPLICANT)
    .idempotencyKey(idempotencyKey)
    .build();

ApproveCaseResult result = caseWorkflow.approve(command);
```

### 29.3 Result Model

```java
public sealed interface ApproveCaseResult {
    record Approved(CaseId caseId, CaseStatus newStatus, AuditId auditId) implements ApproveCaseResult {}
    record AlreadyApproved(CaseId caseId, AuditId originalAuditId) implements ApproveCaseResult {}
    record InvalidTransition(CaseId caseId, CaseStatus currentStatus, List<TransitionViolation> violations) implements ApproveCaseResult {}
    record NotAuthorized(CaseId caseId) implements ApproveCaseResult {}
}
```

### 29.4 HTTP API

```http
POST /cases/{caseId}/approval
Idempotency-Key: 3d5e9b36-3256-4b8f-8a68-615ad2912a80
Content-Type: application/json
```

Request:

```json
{
  "reason": "All statutory requirements satisfied",
  "notificationMode": "SEND_TO_APPLICANT"
}
```

Response success:

```json
{
  "caseId": "CASE-123",
  "status": "APPROVED",
  "auditId": "AUD-991"
}
```

Invalid transition:

```json
{
  "type": "https://example.gov/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "code": "CASE_INVALID_TRANSITION",
  "detail": "Case CASE-123 cannot be approved from CLOSED status.",
  "caseId": "CASE-123",
  "currentStatus": "CLOSED"
}
```

### 29.5 Why This API is Better

Karena:

- command explicit,
- actor trusted dari security context,
- reason domain-specific,
- notification mode named,
- idempotency explicit,
- result explicit,
- invalid transition contract stable,
- audit ID returned,
- HTTP method semantics benar,
- future extension lebih aman.

---

## 30. API Anti-Pattern Catalog

### 30.1 Boolean Parameter API

```java
updateStatus(id, true);
```

Ganti dengan enum, named method, atau options object.

### 30.2 Stringly Typed API

```java
execute("APPROVE", id);
```

Ganti dengan command type atau enum internal yang tepat.

### 30.3 Ambiguous Overload

```java
find(String value);
```

Ganti dengan domain type:

```java
findById(ApplicationId id);
findByName(ApplicationName name);
```

### 30.4 Universal DTO

Satu DTO untuk semua boundary.

Ganti dengan boundary-specific model.

### 30.5 Leaking Internal Enum

Expose workflow status internal ke consumer eksternal.

Ganti dengan stable external status.

### 30.6 Magic Map API

```java
Map<String, Object> request
```

Masalah:

- tidak type-safe,
- validation sulit,
- contract tidak jelas,
- refactoring sulit.

Gunakan typed request.

### 30.7 `void` for Important Operation

```java
void submit(command)
```

Kalau outcome penting, return result.

### 30.8 Exception-Only Business Outcome

```java
try {
    approve(command);
} catch (InvalidTransitionException e) {
    ...
}
```

Untuk expected business outcome, sealed result sering lebih jelas.

### 30.9 Getter with Side Effect

```java
getReport()
```

Ternyata generate report berat.

Gunakan:

```java
generateReport()
requestReportGeneration()
```

### 30.10 API tanpa Timeout/Cancellation

Long-running API tanpa timeout membuat caller terjebak.

Tambahkan deadline/options/job model.

### 30.11 Breaking Semantic Contract

Schema sama, meaning berubah.

Contoh:

```text
status=APPROVED dulu berarti final approval.
status=APPROVED sekarang berarti preliminary approval.
```

Ini breaking walaupun JSON tetap valid.

### 30.12 Internal Exception Leak

```json
{
  "error": "org.hibernate.LazyInitializationException"
}
```

Ganti dengan error contract domain/technical yang stabil.

---

## 31. Design Review Checklist

Gunakan checklist ini saat review API Java/HTTP/event.

### 31.1 Intent

```text
Apakah nama API menyatakan intent domain?
Apakah command dan query dibedakan?
Apakah side effect jelas?
Apakah operation terlalu generic?
```

### 31.2 Input

```text
Apakah input typed?
Apakah primitive/string obsession dihindari?
Apakah boolean flag dihindari?
Apakah required/optional jelas?
Apakah null semantics jelas?
Apakah actor berasal dari trusted context?
```

### 31.3 Output

```text
Apakah output sesuai consumer need?
Apakah entity internal bocor?
Apakah result penting dieksplisitkan?
Apakah error contract stabil?
Apakah response overexpose sensitive field?
```

### 31.4 Compatibility

```text
Apakah perubahan backward compatible?
Apakah enum value baru akan merusak consumer?
Apakah field baru optional?
Apakah semantic change didokumentasikan?
Apakah deprecation path ada?
```

### 31.5 Operational

```text
Apakah blocking behavior jelas?
Apakah timeout/cancellation jelas?
Apakah idempotency diperlukan?
Apakah retry behavior jelas?
Apakah pagination jelas?
Apakah observability tersedia?
```

### 31.6 Security

```text
Apakah authorization dilakukan sebelum mutation?
Apakah object-level authorization ada?
Apakah field-level exposure dikontrol?
Apakah client bisa mengirim role/status berbahaya?
Apakah error response membocorkan internal detail?
```

---

## 32. Pattern Selection Matrix

| Problem | Pattern API |
|---|---|
| Banyak optional parameter | Builder / Options Object |
| Grammar query kompleks | Fluent API |
| Required step harus urut | Staged Builder / Staged Fluent API |
| State mutation domain | Command API |
| Data retrieval | Query API |
| CRUD resource | Resource API |
| Domain action non-CRUD | Operation API |
| Multiple outcomes expected | Sealed Result API |
| Backward compatibility interface | Default Method carefully |
| External API contract | DTO boundary + versioning |
| Plugin extension | SPI + lifecycle contract |
| Long-running task | Job API |
| Retry-prone mutation | Idempotency Key |
| Large list | Pagination/Cursor API |

---

## 33. Staff-Level Discussion Points

Pertanyaan yang biasa muncul di level senior/staff:

```text
Apakah API ini mengekspresikan domain atau implementation detail?
Apa yang akan rusak jika requirement berubah?
Apa breaking change yang paling mungkin terjadi?
Apakah consumer bisa menggunakan API ini secara salah?
Apakah compiler membantu mencegah misuse?
Apakah error contract cukup stabil untuk automation?
Apakah API ini mudah dimonitor?
Apakah API ini aman untuk retry?
Apakah API ini menyembunyikan cost besar?
Apakah kita mendesain API untuk manusia, mesin, atau keduanya?
```

Top engineer tidak hanya bertanya “apakah API ini bekerja”.

Mereka bertanya:

```text
Apakah API ini akan tetap masuk akal saat sistem tumbuh?
```

---

## 34. Ringkasan Mental Model

API design adalah seni membuat kontrak yang:

1. jelas untuk caller,
2. sulit disalahgunakan,
3. stabil terhadap perubahan,
4. eksplisit tentang side effect,
5. eksplisit tentang error,
6. eksplisit tentang lifecycle,
7. aman secara security,
8. dapat diobservasi,
9. dapat dites,
10. tidak membocorkan implementation detail.

Pattern penting:

```text
Fluent API       -> untuk DSL/query/config/pipeline yang readable.
Builder API      -> untuk object construction kompleks.
Resource API     -> untuk resource dengan identity/lifecycle.
Operation API    -> untuk domain action non-CRUD.
Command API      -> untuk mutation intent.
Query API        -> untuk read model/projection.
Options Object   -> untuk parameter kompleks.
Sealed Result    -> untuk outcome eksplisit.
Versioning       -> untuk evolusi kontrak.
Deprecation      -> untuk migrasi aman.
```

Anti-pattern utama:

```text
Boolean parameter API.
Stringly typed action.
Ambiguous overload.
Universal DTO.
Leaking internal enum.
Magic Map API.
Void for important operation.
Getter with side effect.
Internal exception leak.
Breaking semantic contract.
```

API yang bagus tidak selalu paling pendek.

API yang bagus adalah API yang membuat penggunaan benar menjadi mudah dan penggunaan salah menjadi sulit.

---

## 35. Referensi Lanjut

- RFC 9110 — HTTP Semantics.
- RFC 9457 — Problem Details for HTTP APIs.
- Martin Fowler — Fluent Interface.
- Java SE 25 Documentation — Pattern Matching for switch.
- Java SE Documentation — Records, Sealed Classes, Functional Interfaces.
- Effective Java — API design, static factory, builder, method signature, exception design.
- Enterprise Integration Patterns — Message and contract thinking.
- Microsoft REST API Guidelines.
- Google API Design Guide.
- Zalando RESTful API Guidelines.

---

## 36. Status Seri

```text
Part 28 dari 35 selesai.
Seri belum selesai.
```

Part berikutnya:

```text
29-framework-patterns-di-aop-annotation-reflection-spi.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-observability-diagnostics-patterns-correlation-audit-telemetry.md">⬅️ Part 27 — Observability and Diagnostics Patterns: Correlation, Audit, Telemetry, and Debuggability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./29-framework-patterns-di-aop-annotation-reflection-spi.md">Framework Patterns: Dependency Injection, AOP, Annotation, Reflection, SPI ➡️</a>
</div>
