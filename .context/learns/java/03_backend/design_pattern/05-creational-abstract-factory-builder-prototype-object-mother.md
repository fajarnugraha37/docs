# Part 5 — Creational Pattern II: Abstract Factory, Builder, Prototype, Object Mother

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `05-creational-abstract-factory-builder-prototype-object-mother.md`  
> Target: Java 8–25  
> Level: Advanced / Senior / Staff Engineering

---

## 0. Peta Besar

Part sebelumnya membahas object creation dari sisi paling dasar: constructor, static factory, dan Factory Method. Bagian ini bergerak ke level yang lebih kompleks: bagaimana menciptakan **keluarga objek**, **objek dengan banyak parameter**, **objek turunan dari template**, dan **test fixture** tanpa membuat codebase berubah menjadi kumpulan constructor panjang, setter acak, object graph rapuh, atau fixture yang tidak bisa dipahami.

Creational pattern bukan sekadar cara membuat object. Dalam codebase enterprise, object creation sering menjadi titik tempat banyak masalah berkumpul:

- validasi awal
- invariant domain
- default value
- dependency wiring
- environment-specific behavior
- object graph construction
- compatibility antar versi
- test setup
- object cloning
- configuration explosion
- lifecycle ownership

Karena itu, design yang buruk pada creation layer akan menyebarkan kerusakan ke seluruh sistem. Object yang dibuat dengan salah akan membawa state yang salah. State yang salah menghasilkan branching tambahan. Branching tambahan menghasilkan defensive code. Defensive code menghasilkan kompleksitas. Kompleksitas menghasilkan bug.

Pattern yang akan kita bahas:

1. **Abstract Factory** — membuat keluarga object yang konsisten.
2. **Builder** — membangun object kompleks secara eksplisit dan terkendali.
3. **Prototype** — membuat object baru dari object contoh/template.
4. **Test Data Builder** — membangun object test secara jelas, fleksibel, dan minim noise.
5. **Object Mother** — pola fixture yang sering membantu di awal, tetapi berubah menjadi anti-pattern ketika scale naik.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami kapan object creation perlu dinaikkan dari constructor biasa ke factory/builder/prototype.
2. Membedakan Factory Method, Abstract Factory, Builder, dan Prototype berdasarkan design force-nya.
3. Mendesain builder yang menjaga invariant, bukan sekadar fluent setter.
4. Menghindari builder yang membuat invalid object lebih mudah dibuat.
5. Memakai Abstract Factory untuk family consistency, bukan untuk membuat abstraction palsu.
6. Memahami mengapa `Cloneable` di Java bermasalah secara desain.
7. Mendesain copy constructor, copy factory, dan wither method secara aman.
8. Membangun test fixture yang readable dan maintainable.
9. Mengenali Object Mother yang sudah menjadi bottleneck.
10. Melakukan refactoring dari constructor chaos, fixture chaos, dan factory explosion ke model creation yang lebih sehat.

---

## 2. Mental Model: Object Creation Adalah Boundary Antara Intensi dan Struktur

Saat kita menulis:

```java
Application app = new Application(...);
```

kita sedang melakukan lebih dari sekadar alokasi memori. Kita sedang menyatakan:

> “Saya ingin sebuah object yang siap dipakai, valid, dan merepresentasikan konsep tertentu.”

Masalahnya, semakin kompleks domain, semakin jauh jarak antara **intensi** dan **struktur**.

Contoh sederhana:

```java
new EnforcementCase("EA", "OPEN", false, null, 0, true, null, LocalDateTime.now());
```

Secara struktur, ini valid Java. Tapi secara intensi, sulit dibaca:

- Apa arti `false`?
- Apa arti `null` pertama?
- Apa arti `0`?
- Mengapa `true`?
- Apakah `OPEN` boleh dengan field lain null?
- Apakah `LocalDateTime.now()` boleh langsung dipakai?

Creation pattern yang baik mengecilkan jarak ini:

```java
EnforcementCase enforcementCase = EnforcementCaseBuilder.newCase()
    .forLicence(licenceId)
    .openedBy(officerId)
    .withInitialAssessment(assessment)
    .build();
```

Sekarang intensinya lebih jelas. Tetapi builder juga bisa buruk jika hanya membungkus setter tanpa invariant.

Mental model utama:

```text
Constructor answers:        "What fields are required?"
Static factory answers:     "What kind of object do you mean?"
Factory Method answers:     "Which subclass/variant should own this creation?"
Abstract Factory answers:   "Which family of related objects must be consistent?"
Builder answers:            "How do I assemble a complex valid object step by step?"
Prototype answers:          "How do I create a new object from an existing template?"
Test Data Builder answers:  "How do I express only the test-relevant differences?"
```

---

## 3. Problem Space: Kapan Constructor Tidak Lagi Cukup?

Constructor masih bagus ketika:

- object kecil
- parameter sedikit
- invariant sederhana
- tidak banyak default
- tidak banyak varian
- tidak ada object graph kompleks

Constructor mulai bermasalah ketika muncul tanda berikut.

### 3.1 Banyak Parameter

```java
new UserProfile(id, name, email, phone, address, status, createdAt, updatedAt, verified, locked);
```

Masalah:

- urutan rawan tertukar
- `boolean` tidak self-documenting
- `null` menyebar
- default value tersembunyi di caller
- validasi tersebar

### 3.2 Banyak Kombinasi Valid

```java
Application application = new Application(
    type,
    individualApplicant,
    companyApplicant,
    representative,
    payment,
    documents,
    renewalReference,
    appealReference
);
```

Tidak semua kombinasi valid:

- individual application tidak perlu company applicant
- renewal harus punya renewal reference
- appeal harus punya appeal reference
- draft boleh tanpa payment
- submitted harus punya required documents

Constructor tidak cukup untuk mengekspresikan combinatorial rule secara jelas.

### 3.3 Banyak Default

```java
ReportConfig config = new ReportConfig(
    ZoneId.of("Asia/Singapore"),
    Locale.ENGLISH,
    true,
    false,
    1000,
    Duration.ofSeconds(30),
    List.of(),
    Map.of()
);
```

Sebagian besar caller mungkin ingin default. Kalau semua default harus ditulis, signal-to-noise buruk.

### 3.4 Object Graph Kompleks

```java
CaseFile file = new CaseFile(
    caseInfo,
    List.of(new CaseParty(...), new CaseParty(...)),
    List.of(new CaseDocument(...)),
    new WorkflowState(...),
    new AuditMetadata(...)
);
```

Object graph seperti ini perlu construction boundary yang lebih eksplisit.

### 3.5 Creation Bergantung Environment atau Family

Contoh:

- dev gateway vs prod gateway
- offline document renderer vs cloud renderer
- email notification family vs SMS notification family
- JSON parser family vs XML parser family

Di sini Abstract Factory mulai relevan.

---

## 4. Abstract Factory

## 4.1 Definisi

**Abstract Factory** menyediakan interface untuk membuat keluarga object yang saling berhubungan tanpa caller mengetahui concrete class-nya.

Bentuk sederhana:

```java
interface NotificationFactory {
    MessageTemplate createTemplate();
    MessageSender createSender();
    DeliveryTracker createTracker();
}
```

Concrete factory:

```java
final class EmailNotificationFactory implements NotificationFactory {
    @Override
    public MessageTemplate createTemplate() {
        return new EmailTemplate();
    }

    @Override
    public MessageSender createSender() {
        return new SmtpMessageSender();
    }

    @Override
    public DeliveryTracker createTracker() {
        return new EmailDeliveryTracker();
    }
}
```

Caller:

```java
final class NotificationService {
    private final NotificationFactory factory;

    NotificationService(NotificationFactory factory) {
        this.factory = factory;
    }

    void notifyRecipient(NotificationRequest request) {
        MessageTemplate template = factory.createTemplate();
        MessageSender sender = factory.createSender();
        DeliveryTracker tracker = factory.createTracker();

        Message message = template.render(request);
        DeliveryResult result = sender.send(message);
        tracker.record(result);
    }
}
```

Kekuatan Abstract Factory bukan pada menghindari `new`. Kekuatan utamanya adalah **family consistency**.

---

## 4.2 Design Force Abstract Factory

Gunakan Abstract Factory ketika:

1. Ada beberapa keluarga object.
2. Object dalam keluarga harus cocok satu sama lain.
3. Caller tidak boleh mencampur object dari keluarga berbeda.
4. Variasi keluarga dipilih di boundary tertentu.
5. Penambahan family baru lebih mungkin daripada penambahan product type baru.

Contoh family:

```text
Email family:
- EmailTemplate
- SmtpSender
- EmailDeliveryTracker

SMS family:
- SmsTemplate
- SmsGatewaySender
- SmsDeliveryTracker

In-app notification family:
- InAppTemplate
- InAppSender
- InAppDeliveryTracker
```

Jika caller bebas mencampur `SmsTemplate` dengan `SmtpSender`, sistem menjadi incoherent.

Abstract Factory memaksa konsistensi.

---

## 4.3 Abstract Factory vs Factory Method

Factory Method biasanya satu product atau satu extension point:

```java
interface DocumentParserFactory {
    DocumentParser create(String contentType);
}
```

Abstract Factory membuat family:

```java
interface DocumentProcessingFactory {
    DocumentParser parser();
    DocumentValidator validator();
    DocumentRenderer renderer();
    DocumentArchiver archiver();
}
```

Perbedaan mental:

```text
Factory Method:
"Buatkan saya varian object ini."

Abstract Factory:
"Buatkan saya satu set object yang harus berasal dari dunia yang sama."
```

---

## 4.4 Contoh Enterprise: Document Processing Family

Misalkan sistem mendukung dokumen:

- PDF
- HTML
- XML
- CSV

Setiap jenis punya parser, validator, renderer, dan metadata extractor.

### Interface Product

```java
interface DocumentParser {
    ParsedDocument parse(byte[] content);
}

interface DocumentValidator {
    ValidationResult validate(ParsedDocument document);
}

interface DocumentRenderer {
    RenderedDocument render(ParsedDocument document);
}

interface MetadataExtractor {
    DocumentMetadata extract(ParsedDocument document);
}
```

### Abstract Factory

```java
interface DocumentProcessingFactory {
    DocumentParser parser();
    DocumentValidator validator();
    DocumentRenderer renderer();
    MetadataExtractor metadataExtractor();
}
```

### Concrete Factory

```java
final class PdfDocumentProcessingFactory implements DocumentProcessingFactory {
    @Override
    public DocumentParser parser() {
        return new PdfDocumentParser();
    }

    @Override
    public DocumentValidator validator() {
        return new PdfDocumentValidator();
    }

    @Override
    public DocumentRenderer renderer() {
        return new PdfDocumentRenderer();
    }

    @Override
    public MetadataExtractor metadataExtractor() {
        return new PdfMetadataExtractor();
    }
}
```

### Selector

```java
final class DocumentProcessingFactories {
    private final Map<DocumentType, DocumentProcessingFactory> factories;

    DocumentProcessingFactories(Map<DocumentType, DocumentProcessingFactory> factories) {
        this.factories = Map.copyOf(factories);
    }

    DocumentProcessingFactory forType(DocumentType type) {
        DocumentProcessingFactory factory = factories.get(type);
        if (factory == null) {
            throw new UnsupportedDocumentTypeException(type);
        }
        return factory;
    }
}
```

### Usage

```java
final class DocumentProcessingService {
    private final DocumentProcessingFactories factories;

    DocumentProcessingService(DocumentProcessingFactories factories) {
        this.factories = factories;
    }

    ProcessedDocument process(DocumentType type, byte[] content) {
        DocumentProcessingFactory factory = factories.forType(type);

        ParsedDocument parsed = factory.parser().parse(content);
        ValidationResult validation = factory.validator().validate(parsed);

        if (!validation.isValid()) {
            throw new InvalidDocumentException(validation.errors());
        }

        DocumentMetadata metadata = factory.metadataExtractor().extract(parsed);
        RenderedDocument rendered = factory.renderer().render(parsed);

        return new ProcessedDocument(rendered, metadata);
    }
}
```

### Apa yang Dilindungi?

Abstract Factory mencegah desain seperti ini:

```java
DocumentParser parser = new PdfDocumentParser();
DocumentValidator validator = new XmlDocumentValidator();
DocumentRenderer renderer = new HtmlDocumentRenderer();
```

Secara compile-time mungkin bisa, tetapi secara domain kacau.

---

## 4.5 Abstract Factory dengan Sealed Interface

Java modern memungkinkan product family yang lebih eksplisit.

```java
sealed interface NotificationChannel permits EmailChannel, SmsChannel, InAppChannel {}

record EmailChannel(String fromAddress) implements NotificationChannel {}
record SmsChannel(String senderId) implements NotificationChannel {}
record InAppChannel(String applicationCode) implements NotificationChannel {}
```

Factory selector:

```java
final class NotificationFactorySelector {
    NotificationFactory select(NotificationChannel channel) {
        return switch (channel) {
            case EmailChannel email -> new EmailNotificationFactory(email.fromAddress());
            case SmsChannel sms -> new SmsNotificationFactory(sms.senderId());
            case InAppChannel inApp -> new InAppNotificationFactory(inApp.applicationCode());
        };
    }
}
```

Dengan sealed hierarchy, compiler tahu semua variant yang mungkin. Ini membuat selector lebih aman dibanding stringly typed factory.

---

## 4.6 Kapan Abstract Factory Overkill?

Abstract Factory overkill ketika:

1. Hanya ada satu product.
2. Tidak ada family consistency problem.
3. Variasi jarang berubah.
4. Caller memang perlu concrete type.
5. Interface hanya punya satu implementasi dan tidak ada alasan variasi.
6. Factory hanya membungkus constructor tanpa policy.

Contoh buruk:

```java
interface UserFactory {
    User createUser(String name);
}

final class DefaultUserFactory implements UserFactory {
    @Override
    public User createUser(String name) {
        return new User(name);
    }
}
```

Kalau tidak ada invariant, default, dependency, subtype, atau family consistency, factory ini hanya noise.

---

## 4.7 Abstract Factory Anti-Pattern

### Anti-Pattern 1: Factory Explosion

```text
UserFactory
AdminUserFactory
InternalAdminUserFactory
VerifiedInternalAdminUserFactory
PremiumVerifiedInternalAdminUserFactory
```

Masalah:

- terlalu banyak class kecil tanpa konsep domain jelas
- variasi tidak orthogonal
- factory jadi encoding kombinasi flag
- maintenance sulit

Solusi:

- identifikasi axis variasi
- gunakan configuration object atau policy object
- gunakan builder jika variasi berasal dari parameter optional
- gunakan strategy jika variasi berasal dari behavior

### Anti-Pattern 2: Abstract Factory untuk Menghindari `new` Secara Dogmatis

Tidak semua `new` buruk. `new` pada value object kecil biasanya sehat.

```java
Money fee = new Money(new BigDecimal("100.00"), Currency.SGD);
```

Membuat `MoneyFactory` hanya karena ingin “DIP” adalah overengineering.

### Anti-Pattern 3: Inconsistent Family Leakage

Jika caller masih bisa mencampur product family secara bebas, Abstract Factory gagal menjaga invariant.

```java
DocumentParser parser = factory.parser();
DocumentValidator validator = otherFactory.validator();
```

Solusi:

- return satu aggregate object/facade family
- jangan expose product terlalu granular jika caller bisa salah kombinasi

```java
interface DocumentProcessor {
    ProcessedDocument process(byte[] content);
}
```

Kadang facade lebih aman daripada Abstract Factory terbuka.

---

## 5. Builder Pattern

## 5.1 Definisi

**Builder** memisahkan proses konstruksi object kompleks dari representasi akhirnya.

Dalam Java modern, builder sering dipakai untuk:

- object immutable dengan banyak field
- object dengan default
- object dengan optional parameter
- object dengan conditional invariant
- object graph kompleks
- test fixture
- configuration object

Contoh paling sederhana:

```java
ReportRequest request = ReportRequest.builder()
    .reportType(ReportType.MONTHLY_SUMMARY)
    .period(YearMonth.of(2026, 6))
    .requestedBy(userId)
    .includeDetails(true)
    .build();
```

Tetapi builder yang baik bukan hanya fluent setter. Builder yang baik adalah **construction boundary**.

---

## 5.2 Masalah Telescoping Constructor

Tanpa builder:

```java
public final class ReportRequest {
    public ReportRequest(ReportType type, YearMonth period) { ... }
    public ReportRequest(ReportType type, YearMonth period, UserId requestedBy) { ... }
    public ReportRequest(ReportType type, YearMonth period, UserId requestedBy, boolean includeDetails) { ... }
    public ReportRequest(ReportType type, YearMonth period, UserId requestedBy, boolean includeDetails, ZoneId zoneId) { ... }
}
```

Masalah:

- constructor overload bertambah
- urutan parameter sulit dibaca
- boolean tidak jelas
- kombinasi valid tidak eksplisit
- default tersebar

Builder:

```java
ReportRequest request = ReportRequest.builder()
    .type(ReportType.MONTHLY_SUMMARY)
    .period(YearMonth.of(2026, 6))
    .requestedBy(userId)
    .includeDetails()
    .zoneId(ZoneId.of("Asia/Singapore"))
    .build();
```

Intensi lebih jelas.

---

## 5.3 Builder untuk Immutable Object

```java
public final class ReportRequest {
    private final ReportType type;
    private final YearMonth period;
    private final UserId requestedBy;
    private final boolean includeDetails;
    private final ZoneId zoneId;

    private ReportRequest(Builder builder) {
        this.type = Objects.requireNonNull(builder.type, "type");
        this.period = Objects.requireNonNull(builder.period, "period");
        this.requestedBy = Objects.requireNonNull(builder.requestedBy, "requestedBy");
        this.includeDetails = builder.includeDetails;
        this.zoneId = builder.zoneId == null ? ZoneId.of("Asia/Singapore") : builder.zoneId;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private ReportType type;
        private YearMonth period;
        private UserId requestedBy;
        private boolean includeDetails;
        private ZoneId zoneId;

        private Builder() {}

        public Builder type(ReportType type) {
            this.type = type;
            return this;
        }

        public Builder period(YearMonth period) {
            this.period = period;
            return this;
        }

        public Builder requestedBy(UserId requestedBy) {
            this.requestedBy = requestedBy;
            return this;
        }

        public Builder includeDetails() {
            this.includeDetails = true;
            return this;
        }

        public Builder zoneId(ZoneId zoneId) {
            this.zoneId = zoneId;
            return this;
        }

        public ReportRequest build() {
            return new ReportRequest(this);
        }
    }
}
```

Kelebihan:

- object final/immutable
- construction step readable
- default centralized
- required field validated in one place
- caller tidak perlu tahu internal representation

---

## 5.4 Builder Harus Menjaga Invariant

Builder buruk:

```java
Application app = Application.builder()
    .status(ApplicationStatus.SUBMITTED)
    .payment(null)
    .documents(List.of())
    .build();
```

Jika status `SUBMITTED` mensyaratkan payment dan documents, builder tidak boleh membiarkan object invalid.

Builder dengan invariant:

```java
public Application build() {
    requireNonNull(type, "type");
    requireNonNull(applicant, "applicant");

    if (status == ApplicationStatus.SUBMITTED) {
        if (payment == null) {
            throw new InvalidApplicationException("Submitted application requires payment");
        }
        if (documents == null || documents.isEmpty()) {
            throw new InvalidApplicationException("Submitted application requires documents");
        }
    }

    return new Application(this);
}
```

Namun hati-hati: terlalu banyak domain rule di builder bisa membuat builder berubah menjadi domain service tersembunyi.

Rule praktis:

```text
Builder boleh menjaga construction invariant.
Builder tidak boleh menjalankan business workflow.
```

Contoh construction invariant:

- required field harus ada
- range value valid
- kombinasi field tidak kontradiktif
- collection tidak null
- defensive copy

Contoh business workflow yang tidak cocok di builder:

- submit application
- approve case
- calculate sanction
- call external service
- persist audit trail

---

## 5.5 Builder dengan Defensive Copy

Builder sering menerima collection. Jangan simpan mutable reference dari caller.

Buruk:

```java
this.documents = builder.documents;
```

Lebih aman:

```java
this.documents = List.copyOf(builder.documents);
```

Builder method:

```java
public Builder documents(List<Document> documents) {
    this.documents = new ArrayList<>(Objects.requireNonNull(documents));
    return this;
}

public Builder addDocument(Document document) {
    this.documents.add(Objects.requireNonNull(document));
    return this;
}
```

Final object:

```java
this.documents = List.copyOf(builder.documents);
```

Mental model:

```text
Builder boleh mutable.
Object hasil build sebaiknya immutable atau minimal tidak membocorkan mutable internals.
```

---

## 5.6 Builder dengan Validation Aggregation

Kadang lebih baik mengumpulkan semua error daripada fail-fast satu per satu.

```java
public ReportRequest build() {
    List<String> errors = new ArrayList<>();

    if (type == null) {
        errors.add("type is required");
    }
    if (period == null) {
        errors.add("period is required");
    }
    if (requestedBy == null) {
        errors.add("requestedBy is required");
    }
    if (zoneId == null) {
        zoneId = ZoneId.of("Asia/Singapore");
    }

    if (!errors.isEmpty()) {
        throw new InvalidReportRequestException(errors);
    }

    return new ReportRequest(this);
}
```

Cocok untuk:

- input model
- configuration object
- request object
- user-facing validation

Kurang cocok untuk:

- low-level value object sederhana
- internal object yang bug harus fail-fast

---

## 5.7 Staged Builder

Staged builder memaksa urutan required field secara compile-time.

Contoh:

```java
public final class CaseAssignment {
    private final CaseId caseId;
    private final OfficerId officerId;
    private final AssignmentReason reason;

    private CaseAssignment(CaseId caseId, OfficerId officerId, AssignmentReason reason) {
        this.caseId = caseId;
        this.officerId = officerId;
        this.reason = reason;
    }

    public static CaseIdStage builder() {
        return new Stages();
    }

    public interface CaseIdStage {
        OfficerStage caseId(CaseId caseId);
    }

    public interface OfficerStage {
        ReasonStage officerId(OfficerId officerId);
    }

    public interface ReasonStage {
        BuildStage reason(AssignmentReason reason);
    }

    public interface BuildStage {
        CaseAssignment build();
    }

    private static final class Stages implements CaseIdStage, OfficerStage, ReasonStage, BuildStage {
        private CaseId caseId;
        private OfficerId officerId;
        private AssignmentReason reason;

        @Override
        public OfficerStage caseId(CaseId caseId) {
            this.caseId = Objects.requireNonNull(caseId);
            return this;
        }

        @Override
        public ReasonStage officerId(OfficerId officerId) {
            this.officerId = Objects.requireNonNull(officerId);
            return this;
        }

        @Override
        public BuildStage reason(AssignmentReason reason) {
            this.reason = Objects.requireNonNull(reason);
            return this;
        }

        @Override
        public CaseAssignment build() {
            return new CaseAssignment(caseId, officerId, reason);
        }
    }
}
```

Usage:

```java
CaseAssignment assignment = CaseAssignment.builder()
    .caseId(caseId)
    .officerId(officerId)
    .reason(reason)
    .build();
```

Caller tidak bisa memanggil `build()` sebelum semua stage required terpenuhi.

Trade-off:

- sangat type-safe
- verbose
- interface bertambah
- cocok untuk API/library penting
- overkill untuk object biasa

Gunakan staged builder ketika:

1. Object sangat penting.
2. Required sequence bermakna.
3. Salah construction mahal.
4. API dipakai banyak tim.
5. Compile-time safety lebih bernilai daripada simplicity.

---

## 5.8 Builder dan Record

Java record sudah menyediakan canonical constructor.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }
    }
}
```

Untuk record kecil, builder biasanya tidak perlu.

Buruk:

```java
Money money = Money.builder()
    .amount(new BigDecimal("10.00"))
    .currency(Currency.SGD)
    .build();
```

Lebih sederhana:

```java
Money money = new Money(new BigDecimal("10.00"), Currency.SGD);
```

Builder untuk record masuk akal jika:

- field banyak
- banyak optional/default
- object adalah request/configuration
- caller butuh readability
- backward compatibility API penting

Contoh:

```java
public record SearchCriteria(
    String keyword,
    List<String> statuses,
    LocalDate fromDate,
    LocalDate toDate,
    int page,
    int size,
    Sort sort
) {
    public SearchCriteria {
        statuses = statuses == null ? List.of() : List.copyOf(statuses);
        page = Math.max(page, 0);
        size = size <= 0 ? 20 : size;
        sort = sort == null ? Sort.unsorted() : sort;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String keyword;
        private List<String> statuses = List.of();
        private LocalDate fromDate;
        private LocalDate toDate;
        private int page = 0;
        private int size = 20;
        private Sort sort = Sort.unsorted();

        public Builder keyword(String keyword) {
            this.keyword = keyword;
            return this;
        }

        public Builder statuses(List<String> statuses) {
            this.statuses = List.copyOf(statuses);
            return this;
        }

        public Builder dateRange(LocalDate fromDate, LocalDate toDate) {
            this.fromDate = fromDate;
            this.toDate = toDate;
            return this;
        }

        public Builder page(int page) {
            this.page = page;
            return this;
        }

        public Builder size(int size) {
            this.size = size;
            return this;
        }

        public Builder sort(Sort sort) {
            this.sort = sort;
            return this;
        }

        public SearchCriteria build() {
            return new SearchCriteria(keyword, statuses, fromDate, toDate, page, size, sort);
        }
    }
}
```

---

## 5.9 Builder vs Setter

Setter object:

```java
ReportRequest request = new ReportRequest();
request.setType(type);
request.setPeriod(period);
request.setRequestedBy(userId);
request.setIncludeDetails(true);
```

Masalah:

- object bisa berada dalam state setengah jadi
- invariant sulit dijaga
- thread safety buruk
- mutability menyebar
- object bisa diubah setelah dipakai

Builder:

```java
ReportRequest request = ReportRequest.builder()
    .type(type)
    .period(period)
    .requestedBy(userId)
    .includeDetails()
    .build();
```

Builder membuat mutability terbatas di fase construction.

```text
Setter mutates domain object.
Builder mutates construction object.
```

Itu perbedaan besar.

---

## 5.10 Builder Anti-Pattern

### Anti-Pattern 1: Builder Sebagai Fluent Setter Tanpa Validasi

```java
User user = User.builder()
    .id(null)
    .email("not-email")
    .status(null)
    .build();
```

Kalau hasilnya tetap terbentuk, builder hanya menyamarkan invalid object.

### Anti-Pattern 2: Builder untuk Semua Class

Tidak semua class perlu builder.

```java
record UserId(UUID value) {}
```

Tidak perlu:

```java
UserId.builder().value(uuid).build();
```

Pattern yang dipakai berlebihan berubah menjadi noise.

### Anti-Pattern 3: Builder dengan Side Effect

```java
public Application build() {
    paymentGateway.charge(payment);
    repository.save(application);
    emailSender.sendConfirmation(application);
    return application;
}
```

Ini bukan builder. Ini workflow service tersembunyi.

### Anti-Pattern 4: Reusable Mutable Builder yang Dipakai Ulang Sembarangan

```java
Builder builder = Application.builder();
Application a = builder.name("A").build();
Application b = builder.name("B").build();
```

Apakah field lain ikut terbawa dari object sebelumnya? Biasanya iya. Ini sumber bug test dan production.

Guideline:

```text
Anggap builder sebagai one-shot object kecuali didesain eksplisit untuk copy/derive.
```

---

## 6. Prototype Pattern

## 6.1 Definisi

**Prototype** membuat object baru dengan menyalin object contoh/prototype.

Intensi:

> “Saya punya object template. Buat object baru berdasarkan template ini, lalu ubah bagian tertentu.”

Contoh domain:

- template surat
- template report configuration
- template workflow
- default notification preference
- recurring schedule
- test fixture baseline

---

## 6.2 Prototype Dasar

```java
public final class NotificationTemplate {
    private final String subject;
    private final String body;
    private final Locale locale;
    private final List<String> requiredVariables;

    public NotificationTemplate(String subject, String body, Locale locale, List<String> requiredVariables) {
        this.subject = Objects.requireNonNull(subject);
        this.body = Objects.requireNonNull(body);
        this.locale = Objects.requireNonNull(locale);
        this.requiredVariables = List.copyOf(requiredVariables);
    }

    public NotificationTemplate withSubject(String newSubject) {
        return new NotificationTemplate(newSubject, body, locale, requiredVariables);
    }

    public NotificationTemplate withBody(String newBody) {
        return new NotificationTemplate(subject, newBody, locale, requiredVariables);
    }

    public NotificationTemplate withLocale(Locale newLocale) {
        return new NotificationTemplate(subject, body, newLocale, requiredVariables);
    }
}
```

Usage:

```java
NotificationTemplate defaultTemplate = new NotificationTemplate(
    "Application submitted",
    "Dear {{name}}, your application {{applicationNo}} has been submitted.",
    Locale.ENGLISH,
    List.of("name", "applicationNo")
);

NotificationTemplate reminderTemplate = defaultTemplate
    .withSubject("Application reminder")
    .withBody("Dear {{name}}, please complete your application {{applicationNo}}.");
```

Ini adalah Prototype style tanpa `Cloneable`.

---

## 6.3 Masalah `Cloneable` di Java

Java menyediakan `Cloneable`, tetapi secara desain sering dihindari.

Masalah umum:

1. `Cloneable` tidak mendeklarasikan method `clone()` secara publik.
2. `Object.clone()` melakukan shallow copy.
3. Deep copy harus ditangani manual.
4. Constructor tidak dipanggil.
5. Final field dan invariant bisa membingungkan.
6. Subclassing membuat clone makin rawan.
7. Exception `CloneNotSupportedException` membuat API tidak nyaman.

Contoh rawan:

```java
class CaseFile implements Cloneable {
    private List<Document> documents;

    @Override
    protected CaseFile clone() throws CloneNotSupportedException {
        return (CaseFile) super.clone();
    }
}
```

`documents` masih referensi list yang sama. Mutasi di clone bisa memengaruhi original.

---

## 6.4 Copy Constructor

Alternatif lebih eksplisit:

```java
public final class CaseFile {
    private final CaseId caseId;
    private final List<Document> documents;
    private final CaseStatus status;

    public CaseFile(CaseId caseId, List<Document> documents, CaseStatus status) {
        this.caseId = Objects.requireNonNull(caseId);
        this.documents = List.copyOf(documents);
        this.status = Objects.requireNonNull(status);
    }

    public CaseFile(CaseFile source) {
        this(source.caseId, source.documents, source.status);
    }
}
```

Jika perlu mengganti field:

```java
public CaseFile withStatus(CaseStatus newStatus) {
    return new CaseFile(caseId, documents, newStatus);
}
```

Copy constructor jelas:

- constructor dipanggil
- invariant dijalankan ulang
- defensive copy bisa dilakukan
- tidak ada magic shallow copy

---

## 6.5 Copy Factory

```java
public static CaseFile copyOf(CaseFile source) {
    return new CaseFile(source.caseId, source.documents, source.status);
}
```

Factory lebih fleksibel jika:

- ingin mengembalikan source jika immutable
- ingin normalisasi
- ingin type conversion
- ingin hiding concrete class

Contoh:

```java
public static List<Document> immutableDocuments(Collection<Document> documents) {
    return List.copyOf(documents);
}
```

`copyOf` di Java collection adalah contoh copy factory idiom.

---

## 6.6 Prototype dengan Builder: `toBuilder()`

Untuk object kompleks, wither method bisa terlalu banyak. `toBuilder()` bisa membantu.

```java
public final class ReportConfig {
    private final Locale locale;
    private final ZoneId zoneId;
    private final int pageSize;
    private final boolean includeSummary;
    private final List<String> columns;

    private ReportConfig(Builder builder) {
        this.locale = Objects.requireNonNull(builder.locale);
        this.zoneId = Objects.requireNonNull(builder.zoneId);
        this.pageSize = builder.pageSize;
        this.includeSummary = builder.includeSummary;
        this.columns = List.copyOf(builder.columns);
    }

    public Builder toBuilder() {
        return new Builder()
            .locale(locale)
            .zoneId(zoneId)
            .pageSize(pageSize)
            .includeSummary(includeSummary)
            .columns(columns);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private Locale locale = Locale.ENGLISH;
        private ZoneId zoneId = ZoneId.of("Asia/Singapore");
        private int pageSize = 50;
        private boolean includeSummary = true;
        private List<String> columns = List.of();

        public Builder locale(Locale locale) {
            this.locale = locale;
            return this;
        }

        public Builder zoneId(ZoneId zoneId) {
            this.zoneId = zoneId;
            return this;
        }

        public Builder pageSize(int pageSize) {
            this.pageSize = pageSize;
            return this;
        }

        public Builder includeSummary(boolean includeSummary) {
            this.includeSummary = includeSummary;
            return this;
        }

        public Builder columns(List<String> columns) {
            this.columns = List.copyOf(columns);
            return this;
        }

        public ReportConfig build() {
            if (pageSize <= 0 || pageSize > 1000) {
                throw new IllegalArgumentException("pageSize must be between 1 and 1000");
            }
            return new ReportConfig(this);
        }
    }
}
```

Usage:

```java
ReportConfig defaultConfig = ReportConfig.builder()
    .columns(List.of("caseNo", "status", "createdDate"))
    .build();

ReportConfig largeExportConfig = defaultConfig.toBuilder()
    .pageSize(500)
    .includeSummary(false)
    .build();
```

`toBuilder()` cocok untuk Prototype-like modification.

---

## 6.7 Prototype Anti-Pattern

### Anti-Pattern 1: Shallow Copy Surprise

```java
CaseFile copy = original.clone();
copy.getDocuments().add(newDocument);
```

Jika list sama, original ikut berubah.

### Anti-Pattern 2: Copy Object Tanpa Menjaga Identity

Apakah copy harus punya ID yang sama atau ID baru?

Contoh:

```java
CaseFile duplicated = original.copy();
```

Pertanyaan penting:

- Apakah `caseId` ikut disalin?
- Apakah audit metadata ikut disalin?
- Apakah createdAt ikut disalin?
- Apakah status ikut disalin?
- Apakah child entity ID ikut disalin?

Untuk entity, copy semantics harus eksplisit.

Lebih jelas:

```java
CaseFile draftCopy = original.copyAsDraft(new CaseId(), officerId);
```

### Anti-Pattern 3: Prototype Menyembunyikan Business Action

```java
CaseFile appeal = original.clone();
appeal.setType(CaseType.APPEAL);
appeal.setStatus(CaseStatus.OPEN);
```

Jika membuat appeal punya rule domain, jangan disembunyikan sebagai clone biasa. Buat method/domain service eksplisit:

```java
AppealCase appeal = AppealCase.fromOriginalCase(original, appealReason, submittedBy);
```

---

## 7. Test Data Builder

## 7.1 Problem: Test Fixture Noise

Test buruk:

```java
@Test
void submittedApplicationRequiresPayment() {
    Application application = new Application(
        new ApplicationId(UUID.randomUUID()),
        ApplicationType.NEW,
        new Applicant("John", "S1234567A", "john@example.com", null, null),
        ApplicationStatus.SUBMITTED,
        null,
        List.of(new Document("NRIC", new byte[] {1, 2, 3}, "application/pdf")),
        LocalDateTime.of(2026, 6, 18, 10, 0),
        new UserId("officer-1"),
        false,
        null
    );

    assertThrows(InvalidApplicationException.class, () -> validator.validate(application));
}
```

Masalah:

- test sulit membaca intent
- banyak detail tidak relevan
- perubahan constructor merusak banyak test
- fixture copy-paste
- test data inconsistent

Test Data Builder memperbaiki ini:

```java
@Test
void submittedApplicationRequiresPayment() {
    Application application = anApplication()
        .submitted()
        .withoutPayment()
        .build();

    assertThrows(InvalidApplicationException.class, () -> validator.validate(application));
}
```

Intent langsung terlihat.

---

## 7.2 Test Data Builder Dasar

```java
public final class ApplicationTestBuilder {
    private ApplicationId id = new ApplicationId(UUID.randomUUID());
    private ApplicationType type = ApplicationType.NEW;
    private Applicant applicant = ApplicantTestBuilder.anApplicant().build();
    private ApplicationStatus status = ApplicationStatus.DRAFT;
    private Payment payment;
    private List<Document> documents = new ArrayList<>();
    private LocalDateTime createdAt = LocalDateTime.of(2026, 1, 1, 9, 0);
    private UserId createdBy = new UserId("test-user");

    private ApplicationTestBuilder() {}

    public static ApplicationTestBuilder anApplication() {
        return new ApplicationTestBuilder();
    }

    public ApplicationTestBuilder submitted() {
        this.status = ApplicationStatus.SUBMITTED;
        this.payment = PaymentTestBuilder.aPayment().successful().build();
        this.documents = new ArrayList<>(List.of(DocumentTestBuilder.aDocument().build()));
        return this;
    }

    public ApplicationTestBuilder draft() {
        this.status = ApplicationStatus.DRAFT;
        return this;
    }

    public ApplicationTestBuilder withoutPayment() {
        this.payment = null;
        return this;
    }

    public ApplicationTestBuilder withPayment(Payment payment) {
        this.payment = payment;
        return this;
    }

    public ApplicationTestBuilder withoutDocuments() {
        this.documents = new ArrayList<>();
        return this;
    }

    public ApplicationTestBuilder withDocument(Document document) {
        this.documents.add(document);
        return this;
    }

    public Application build() {
        return new Application(
            id,
            type,
            applicant,
            status,
            payment,
            List.copyOf(documents),
            createdAt,
            createdBy
        );
    }
}
```

Usage:

```java
Application application = anApplication()
    .submitted()
    .withoutDocuments()
    .build();
```

---

## 7.3 Test Data Builder Harus Punya Default Valid

Prinsip penting:

```text
Default builder harus menghasilkan object valid dan boring.
Test hanya override field yang relevan.
```

Buruk:

```java
Application application = anApplication().build(); // invalid by default
```

Kalau default invalid, setiap test harus memperbaiki banyak hal.

Lebih baik:

```java
Application application = anApplication().build(); // valid draft application
```

Lalu untuk test invalid:

```java
Application application = anApplication()
    .submitted()
    .withoutPayment()
    .build();
```

Ini membuat invalidity eksplisit.

---

## 7.4 Test Data Builder dengan Domain Language

Builder method sebaiknya memakai bahasa domain, bukan hanya setter.

Kurang baik:

```java
anApplication()
    .status(ApplicationStatus.SUBMITTED)
    .payment(null)
    .documents(List.of())
    .build();
```

Lebih baik:

```java
anApplication()
    .submitted()
    .withoutPayment()
    .withoutDocuments()
    .build();
```

Karena test harus menjelaskan skenario, bukan struktur object.

---

## 7.5 Builder Composition untuk Object Graph

```java
public final class ApplicantTestBuilder {
    private String name = "Test Applicant";
    private String identityNo = "S1234567A";
    private String email = "test@example.com";

    public static ApplicantTestBuilder anApplicant() {
        return new ApplicantTestBuilder();
    }

    public ApplicantTestBuilder withEmail(String email) {
        this.email = email;
        return this;
    }

    public Applicant build() {
        return new Applicant(name, identityNo, email);
    }
}
```

Application builder bisa memakai applicant builder:

```java
private Applicant applicant = anApplicant().build();
```

Test:

```java
Application application = anApplication()
    .withApplicant(anApplicant().withEmail("invalid-email").build())
    .build();
```

---

## 7.6 Test Data Builder Anti-Pattern

### Anti-Pattern 1: Builder Meniru Semua Setter Production Object

```java
anApplication()
    .id(id)
    .type(type)
    .status(status)
    .payment(payment)
    .documents(documents)
    .createdAt(createdAt)
    .createdBy(createdBy)
    .build();
```

Ini masih lebih baik dari constructor panjang, tetapi belum cukup domain-friendly.

Tambahkan method skenario:

```java
.submitted()
.approved()
.rejectedFor(reason)
.withExpiredPayment()
.createdYesterday()
```

### Anti-Pattern 2: Hidden Randomness

```java
private String email = UUID.randomUUID() + "@example.com";
```

Random data membuat test sulit direproduksi jika gagal.

Gunakan deterministic default kecuali memang sedang property-based/randomized testing.

### Anti-Pattern 3: Builder dengan Logic Terlalu Banyak

Test builder boleh convenience, tetapi jangan menjadi duplicate domain model.

Jika builder punya rule rumit yang berbeda dari production, test bisa false confidence.

---

## 8. Object Mother

## 8.1 Definisi

Object Mother adalah test pattern yang menyediakan factory method statis untuk object fixture.

```java
public final class ApplicationMother {
    private ApplicationMother() {}

    public static Application draftApplication() {
        return anApplication().draft().build();
    }

    public static Application submittedApplication() {
        return anApplication().submitted().build();
    }

    public static Application submittedApplicationWithoutPayment() {
        return anApplication().submitted().withoutPayment().build();
    }
}
```

Object Mother bisa berguna di awal karena test menjadi ringkas:

```java
Application application = ApplicationMother.submittedApplicationWithoutPayment();
```

Namun Object Mother sering berubah menjadi anti-pattern.

---

## 8.2 Object Mother yang Masih Sehat

Object Mother masih sehat jika:

1. Jumlah fixture sedikit.
2. Fixture benar-benar canonical.
3. Nama fixture jelas.
4. Tidak terlalu banyak variasi kombinasi.
5. Dipakai sebagai facade atas Test Data Builder.

Contoh sehat:

```java
public final class ApplicationMother {
    public static Application validDraftApplication() {
        return anApplication().draft().build();
    }

    public static Application validSubmittedApplication() {
        return anApplication().submitted().build();
    }
}
```

---

## 8.3 Object Mother Anti-Pattern

Object Mother menjadi masalah ketika tumbuh seperti ini:

```java
submittedApplication()
submittedApplicationWithoutPayment()
submittedApplicationWithoutDocuments()
submittedApplicationWithExpiredPayment()
submittedApplicationWithExpiredPaymentAndMissingDocument()
submittedApplicationForCompanyApplicant()
submittedApplicationForCompanyApplicantWithoutRepresentative()
submittedApplicationForCompanyApplicantWithoutRepresentativeButWithPayment()
```

Tanda bahaya:

- method fixture ratusan
- nama makin panjang
- variasi kombinatorial
- satu perubahan domain merusak banyak fixture
- developer sulit memilih fixture yang benar
- fixture membawa detail tersembunyi

Masalah utama Object Mother:

```text
Ia menyembunyikan perbedaan yang penting bagi test.
```

Test ini terlihat ringkas:

```java
Application application = ApplicationMother.invalidCompanyApplication();
```

Tapi pembaca harus masuk ke Object Mother untuk tahu invalid karena apa.

Lebih jelas:

```java
Application application = anApplication()
    .forCompanyApplicant()
    .withoutRepresentative()
    .submitted()
    .build();
```

---

## 8.4 Object Mother vs Test Data Builder

Object Mother:

```text
Beri saya fixture yang sudah jadi.
```

Test Data Builder:

```text
Beri saya baseline valid, lalu saya ubah aspek yang relevan.
```

Object Mother cocok untuk canonical examples.

Test Data Builder cocok untuk variasi skenario.

Praktik yang baik:

```java
public final class ApplicationMother {
    public static Application validSubmittedApplication() {
        return anApplication().submitted().build();
    }
}
```

Object Mother menjadi thin wrapper, bukan pusat kombinasi fixture.

---

## 9. Pattern Comparison Matrix

| Pattern | Problem utama | Kekuatan | Risiko | Cocok untuk |
|---|---|---|---|---|
| Abstract Factory | Family consistency | Mencegah mixing object family | Factory explosion | Product family, platform/env variants |
| Builder | Complex construction | Readability, default, invariant | Fluent setter tanpa validasi | Immutable/config/request/domain aggregate |
| Staged Builder | Compile-time construction order | Required step enforced | Verbose | Public API penting, object kritikal |
| Prototype | Create from template | Efficient semantic reuse | Shallow copy, identity confusion | Template, config, draft copy |
| Copy Constructor | Explicit copy | Invariant rerun | Verbose for many fields | Immutable/domain objects |
| `toBuilder()` | Derive from existing object | Flexible modification | Builder reuse confusion | Complex immutable object |
| Test Data Builder | Test clarity | Low-noise fixture | Duplicate domain logic | Unit/integration tests |
| Object Mother | Canonical fixture | Short tests | Fixture explosion | Few stable canonical examples |

---

## 10. Decision Heuristics

### 10.1 Pilih Constructor Jika

- field sedikit
- invariant sederhana
- semua parameter required
- caller mudah membaca intensi

Contoh:

```java
new Money(amount, currency)
new UserId(uuid)
new DateRange(start, end)
```

### 10.2 Pilih Static Factory Jika

- butuh nama intensi
- ada subtype selection
- ada normalization
- constructor terlalu umum

```java
Money.zero(Currency.SGD)
DateRange.closed(start, end)
CaseId.fromString(raw)
```

### 10.3 Pilih Abstract Factory Jika

- ada keluarga product
- product harus konsisten
- variasi family dipilih di boundary

```java
DocumentProcessingFactory
NotificationFactory
RenderingEngineFactory
```

### 10.4 Pilih Builder Jika

- banyak optional
- banyak default
- object immutable
- constructor panjang
- readability penting
- construction invariant butuh satu tempat

### 10.5 Pilih Staged Builder Jika

- required steps penting
- API dipakai luas
- salah construction mahal
- compile-time safety bernilai tinggi

### 10.6 Pilih Prototype/Copy Jika

- object baru berasal dari template
- object existing menjadi baseline
- semantic copy jelas
- variasi kecil dari default besar

### 10.7 Pilih Test Data Builder Jika

- test fixture noisy
- constructor berubah sering
- test sulit membaca intent
- banyak variasi kecil skenario

### 10.8 Hindari Object Mother Jika

- fixture mulai kombinatorial
- method fixture makin banyak
- nama fixture makin panjang
- test tidak jelas invalid karena apa

---

## 11. Deep Design Force: Required vs Optional vs Derived vs External

Salah satu cara terbaik mendesain construction adalah mengklasifikasikan field.

### 11.1 Required Field

Harus disediakan caller.

```java
caseId
applicant
applicationType
```

Cocok untuk constructor/staged builder.

### 11.2 Optional Field

Boleh ada atau tidak.

```java
remarks
secondaryContact
attachment
```

Cocok untuk builder.

### 11.3 Defaulted Field

Jika tidak disediakan, sistem punya default.

```java
pageSize = 20
zoneId = Asia/Singapore
status = DRAFT
```

Cocok untuk builder/static factory.

### 11.4 Derived Field

Tidak boleh dimasukkan caller jika bisa dihitung dari field lain.

Buruk:

```java
new Invoice(lineItems, totalAmount)
```

Jika `totalAmount` harus sama dengan jumlah line items, lebih aman:

```java
new Invoice(lineItems)
```

atau:

```java
Money totalAmount() {
    return lineItems.stream()
        .map(LineItem::amount)
        .reduce(Money.zero(currency), Money::add);
}
```

### 11.5 External Field

Field yang berasal dari external system atau infrastructure.

```java
createdAt
createdBy
correlationId
requestId
```

Pertanyaan desain:

- apakah caller boleh menentukan?
- apakah harus injected clock?
- apakah harus generated di application service?
- apakah harus masuk builder?

Contoh lebih testable:

```java
Application.open(request, currentUser, clock);
```

Daripada:

```java
Application.builder()
    .createdAt(LocalDateTime.now())
    .createdBy(userId)
    .build();
```

---

## 12. Builder dan Domain Invariant

Tidak semua invariant berada di tempat yang sama.

### 12.1 Field-Level Invariant

```java
public record EmailAddress(String value) {
    public EmailAddress {
        if (!value.contains("@")) {
            throw new IllegalArgumentException("Invalid email");
        }
    }
}
```

### 12.2 Object-Level Construction Invariant

```java
if (startDate.isAfter(endDate)) {
    throw new IllegalArgumentException("startDate must not be after endDate");
}
```

### 12.3 Domain Workflow Invariant

```java
if (!caseFile.canBeAssignedTo(officer)) {
    throw new CaseAssignmentNotAllowedException(...);
}
```

Builder cocok untuk field-level dan object-level construction invariant. Builder tidak cocok untuk workflow invariant yang butuh repository, external service, authorization, atau state transition.

---

## 13. Refactoring Path: Constructor Chaos ke Builder

### Kondisi Awal

```java
Application application = new Application(
    id,
    ApplicationType.NEW,
    applicant,
    ApplicationStatus.SUBMITTED,
    payment,
    documents,
    now,
    userId,
    true,
    null,
    "remarks"
);
```

### Step 1: Tambahkan Builder Tanpa Menghapus Constructor

```java
Application application = Application.builder()
    .id(id)
    .type(ApplicationType.NEW)
    .applicant(applicant)
    .submitted()
    .payment(payment)
    .documents(documents)
    .createdAt(now)
    .createdBy(userId)
    .remarks("remarks")
    .build();
```

Constructor lama tetap ada sementara untuk backward compatibility.

### Step 2: Pindahkan Default ke Builder

Sebelumnya:

```java
new Application(..., ApplicationStatus.DRAFT, ..., false, null, null)
```

Sesudah:

```java
Application.builder()
    .type(ApplicationType.NEW)
    .applicant(applicant)
    .build();
```

### Step 3: Pindahkan Construction Invariant ke Constructor Private

```java
private Application(Builder builder) {
    validate(builder);
    ...
}
```

### Step 4: Ganti Boolean dengan Method Bermakna

Buruk:

```java
.includeDetails(true)
```

Lebih jelas:

```java
.includeDetails()
.excludeDetails()
```

atau jika nilai berasal dari variable:

```java
.includeDetails(includeDetails)
```

### Step 5: Deprecate Constructor Panjang

```java
@Deprecated(forRemoval = true)
public Application(...) {
    ...
}
```

### Step 6: Update Test dengan Test Data Builder

```java
Application application = anApplication()
    .submitted()
    .withoutPayment()
    .build();
```

### Step 7: Hapus Constructor Lama Setelah Migration

---

## 14. Refactoring Path: Object Mother ke Test Data Builder

### Kondisi Awal

```java
Application app = ApplicationMother.submittedApplicationWithoutPaymentAndDocuments();
```

### Masalah

Nama fixture mulai panjang dan combinatorial.

### Step 1: Buat Builder dengan Default Valid

```java
Application app = anApplication().submitted().build();
```

### Step 2: Pindahkan Variasi ke Builder Method

```java
Application app = anApplication()
    .submitted()
    .withoutPayment()
    .withoutDocuments()
    .build();
```

### Step 3: Sisakan Object Mother untuk Canonical Fixture

```java
ApplicationMother.validSubmittedApplication();
```

### Step 4: Hapus Fixture Kombinatorial

Fixture yang hanya kombinasi method builder tidak perlu dipertahankan.

---

## 15. Testing Strategy

### 15.1 Test Builder Production Object

Untuk builder production yang menjaga invariant:

```java
@Test
void submittedApplicationRequiresPayment() {
    InvalidApplicationException exception = assertThrows(
        InvalidApplicationException.class,
        () -> Application.builder()
            .type(ApplicationType.NEW)
            .applicant(applicant)
            .submitted()
            .withoutPayment()
            .build()
    );

    assertThat(exception.getMessage()).contains("payment");
}
```

### 15.2 Test Default Value

```java
@Test
void reportRequestUsesDefaultZoneId() {
    ReportRequest request = ReportRequest.builder()
        .type(ReportType.MONTHLY_SUMMARY)
        .period(YearMonth.of(2026, 6))
        .requestedBy(userId)
        .build();

    assertThat(request.zoneId()).isEqualTo(ZoneId.of("Asia/Singapore"));
}
```

### 15.3 Test Defensive Copy

```java
@Test
void documentsAreDefensivelyCopied() {
    List<Document> documents = new ArrayList<>();
    documents.add(document1);

    Application application = Application.builder()
        .type(ApplicationType.NEW)
        .applicant(applicant)
        .documents(documents)
        .build();

    documents.add(document2);

    assertThat(application.documents()).containsExactly(document1);
}
```

### 15.4 Test Abstract Factory Consistency

```java
@Test
void pdfFactoryCreatesPdfFamily() {
    DocumentProcessingFactory factory = new PdfDocumentProcessingFactory();

    assertThat(factory.parser()).isInstanceOf(PdfDocumentParser.class);
    assertThat(factory.validator()).isInstanceOf(PdfDocumentValidator.class);
    assertThat(factory.renderer()).isInstanceOf(PdfDocumentRenderer.class);
}
```

Namun jangan over-test implementation detail jika factory behavior sudah tested melalui higher-level behavior.

---

## 16. Observability and Debugging Angle

Creation bug sering sulit dilacak karena object invalid dibuat jauh sebelum error muncul.

### 16.1 Logging Construction Failure

Untuk object penting, exception harus menjelaskan field yang salah.

Buruk:

```text
Invalid object
```

Baik:

```text
Invalid Application: submitted application requires payment and at least one document
```

### 16.2 Jangan Log Sensitive Field

Builder error kadang memuat value. Hati-hati PII.

Buruk:

```text
Invalid applicant NRIC S1234567A
```

Lebih aman:

```text
Invalid applicant identity number format
```

### 16.3 Creation Metrics

Untuk object creation yang mahal atau external-facing:

- factory selection count by type
- unsupported type count
- builder validation failure count
- default fallback usage count
- template clone/copy count

Jangan ukur semua object creation. Ukur creation boundary yang punya business atau operational relevance.

### 16.4 Debugging Abstract Factory

Tambahkan metadata jika family selection penting:

```java
interface DocumentProcessingFactory {
    DocumentType supportedType();
    DocumentParser parser();
    DocumentValidator validator();
    DocumentRenderer renderer();
}
```

Ini membantu tracing:

```text
documentType=PDF factory=PdfDocumentProcessingFactory
```

---

## 17. Performance Considerations

### 17.1 Builder Allocation

Builder menambah object allocation. Biasanya tidak masalah untuk business object.

Jangan gunakan builder berat di hot loop jutaan iterasi tanpa profiling.

Contoh yang mungkin terlalu berat:

```java
for (int i = 0; i < 10_000_000; i++) {
    Point p = Point.builder().x(i).y(i).build();
}
```

Lebih baik:

```java
new Point(i, i)
```

### 17.2 Defensive Copy Cost

`List.copyOf()` punya cost. Tetapi untuk boundary object, cost ini sering jauh lebih murah daripada bug akibat mutasi.

Guideline:

```text
At trust boundary, prefer defensive copy.
Inside tight internal loop, measure first.
```

### 17.3 Prototype and Deep Copy Cost

Deep copy object graph besar bisa mahal. Pertimbangkan:

- immutable shared sub-object
- copy-on-write
- persistent data structure
- explicit delta object

Jangan deep copy seluruh aggregate jika hanya satu field berubah dan object bisa immutable wither.

---

## 18. Enterprise Case Study: Case Creation and Submission

### 18.1 Problem

Sistem enforcement punya case dengan banyak variasi:

- manual case
- complaint-based case
- inspection-based case
- appeal case
- renewal-related case

Field umum:

- case id
- case type
- subject
- assigned officer
- documents
- source reference
- workflow state
- audit metadata

Naive constructor:

```java
new EnforcementCase(
    id,
    type,
    subject,
    assignedOfficer,
    documents,
    sourceReference,
    status,
    createdAt,
    createdBy,
    false,
    null,
    null
);
```

Masalah:

- source reference berbeda per type
- status harus sesuai type
- audit metadata required
- assigned officer optional tergantung state
- invalid combination mudah dibuat

### 18.2 Better Design: Static Factory + Builder

```java
public final class EnforcementCase {
    private final CaseId id;
    private final CaseType type;
    private final CaseSubject subject;
    private final Optional<OfficerId> assignedOfficer;
    private final List<Document> documents;
    private final CaseSource source;
    private final WorkflowState workflowState;
    private final AuditMetadata auditMetadata;

    private EnforcementCase(Builder builder) {
        this.id = Objects.requireNonNull(builder.id);
        this.type = Objects.requireNonNull(builder.type);
        this.subject = Objects.requireNonNull(builder.subject);
        this.assignedOfficer = Optional.ofNullable(builder.assignedOfficer);
        this.documents = List.copyOf(builder.documents);
        this.source = Objects.requireNonNull(builder.source);
        this.workflowState = Objects.requireNonNull(builder.workflowState);
        this.auditMetadata = Objects.requireNonNull(builder.auditMetadata);
        validateConstructionInvariant();
    }

    public static Builder manualCase(CaseId id, CaseSubject subject, AuditMetadata auditMetadata) {
        return new Builder(id, CaseType.MANUAL, subject, auditMetadata)
            .source(CaseSource.manual())
            .workflowState(WorkflowState.openDraft());
    }

    public static Builder complaintCase(CaseId id, CaseSubject subject, ComplaintId complaintId, AuditMetadata auditMetadata) {
        return new Builder(id, CaseType.COMPLAINT, subject, auditMetadata)
            .source(CaseSource.complaint(complaintId))
            .workflowState(WorkflowState.openDraft());
    }

    private void validateConstructionInvariant() {
        if (type == CaseType.COMPLAINT && !source.isComplaint()) {
            throw new InvalidCaseException("Complaint case requires complaint source");
        }
        if (workflowState.isAssigned() && assignedOfficer.isEmpty()) {
            throw new InvalidCaseException("Assigned workflow state requires assigned officer");
        }
    }

    public static final class Builder {
        private final CaseId id;
        private final CaseType type;
        private final CaseSubject subject;
        private final AuditMetadata auditMetadata;
        private OfficerId assignedOfficer;
        private List<Document> documents = new ArrayList<>();
        private CaseSource source;
        private WorkflowState workflowState;

        private Builder(CaseId id, CaseType type, CaseSubject subject, AuditMetadata auditMetadata) {
            this.id = Objects.requireNonNull(id);
            this.type = Objects.requireNonNull(type);
            this.subject = Objects.requireNonNull(subject);
            this.auditMetadata = Objects.requireNonNull(auditMetadata);
        }

        public Builder assignTo(OfficerId officerId) {
            this.assignedOfficer = Objects.requireNonNull(officerId);
            this.workflowState = WorkflowState.assigned();
            return this;
        }

        public Builder addDocument(Document document) {
            this.documents.add(Objects.requireNonNull(document));
            return this;
        }

        private Builder source(CaseSource source) {
            this.source = source;
            return this;
        }

        private Builder workflowState(WorkflowState workflowState) {
            this.workflowState = workflowState;
            return this;
        }

        public EnforcementCase build() {
            return new EnforcementCase(this);
        }
    }
}
```

Usage:

```java
EnforcementCase caseFile = EnforcementCase.complaintCase(
        caseId,
        subject,
        complaintId,
        auditMetadata
    )
    .assignTo(officerId)
    .addDocument(document)
    .build();
```

Keuntungan:

- case type dan source tidak bisa mudah mismatch
- required context masuk static factory
- optional construction via builder
- workflow state awal jelas
- assigned state menjaga officer
- audit metadata required

---

## 19. Common Interview / Staff-Level Discussion

### Pertanyaan 1: Apa bedanya Builder dan Abstract Factory?

Jawaban senior:

Builder menyelesaikan masalah konstruksi object kompleks, terutama optional/default/invariant. Abstract Factory menyelesaikan family consistency antar beberapa product related. Builder fokus pada satu object atau aggregate. Abstract Factory fokus pada satu keluarga object yang harus cocok satu sama lain.

### Pertanyaan 2: Apakah builder selalu lebih baik daripada constructor?

Tidak. Constructor lebih baik untuk object kecil dengan required field jelas. Builder berguna ketika constructor mulai kehilangan readability atau tidak bisa mengekspresikan optional/default secara aman. Builder berlebihan pada value object kecil akan menambah noise.

### Pertanyaan 3: Mengapa `Cloneable` jarang direkomendasikan?

Karena `Object.clone()` shallow, constructor tidak dipanggil, invariant bisa kabur, API `Cloneable` sendiri tidak mendeklarasikan public `clone()`, dan subclassing membuat semantics makin rawan. Copy constructor, copy factory, wither, atau `toBuilder()` biasanya lebih eksplisit.

### Pertanyaan 4: Bagaimana mencegah Object Mother menjadi anti-pattern?

Gunakan Object Mother hanya untuk canonical fixture. Untuk variasi, gunakan Test Data Builder. Jangan membuat method fixture untuk setiap kombinasi. Test harus menampilkan perbedaan yang penting bagi skenario.

### Pertanyaan 5: Apa tanda Builder buruk?

Builder buruk jika:

- hanya fluent setter tanpa validasi
- bisa menghasilkan invalid object
- menjalankan side effect
- dipakai untuk semua class tanpa alasan
- menyembunyikan business workflow
- mutable builder dipakai ulang dan membawa state lama

---

## 20. Design Review Checklist

Gunakan checklist ini ketika meninjau object creation design.

### 20.1 Constructor

- Apakah jumlah parameter masih readable?
- Apakah ada parameter boolean ambigu?
- Apakah ada banyak `null` di caller?
- Apakah constructor melakukan kerja berat?
- Apakah invariant dijaga?

### 20.2 Builder

- Apakah builder dibutuhkan atau overkill?
- Apakah default value centralized?
- Apakah required field divalidasi?
- Apakah invalid combination dicegah?
- Apakah collection di-copy defensively?
- Apakah builder bebas side effect?
- Apakah builder method memakai bahasa domain?
- Apakah object hasil build immutable atau safe?

### 20.3 Abstract Factory

- Apakah benar ada product family?
- Apakah product family harus konsisten?
- Apakah caller masih bisa mencampur family secara salah?
- Apakah factory hanya membungkus constructor tanpa policy?
- Apakah variasi family lebih stabil daripada product type?

### 20.4 Prototype / Copy

- Apakah copy semantics jelas?
- Apakah identity ikut disalin atau dibuat baru?
- Apakah copy shallow/deep disengaja?
- Apakah invariant dijalankan ulang?
- Apakah mutable child object aman?

### 20.5 Test Fixture

- Apakah default fixture valid?
- Apakah test hanya override hal relevan?
- Apakah Object Mother mulai combinatorial?
- Apakah test intent langsung terbaca?
- Apakah fixture random membuat test flakey?

---

## 21. Summary

Creational pattern adalah cara mengontrol object creation agar object yang masuk ke sistem sudah valid, readable, dan sesuai intensi. Di level senior, pertanyaannya bukan “pattern apa yang dipakai?”, melainkan:

```text
Creation problem apa yang sedang terjadi?
Apakah masalahnya parameter banyak?
Apakah masalahnya family consistency?
Apakah masalahnya template/copy?
Apakah masalahnya test fixture noise?
Apakah invariant dijaga di tempat yang benar?
Apakah pattern ini mengurangi risiko atau hanya menambah class?
```

Ringkasan praktis:

- Gunakan constructor untuk object kecil dan jelas.
- Gunakan static factory untuk intent, normalization, dan subtype selection.
- Gunakan Abstract Factory untuk keluarga object yang harus konsisten.
- Gunakan Builder untuk object kompleks dengan optional/default/invariant.
- Gunakan staged builder ketika construction order perlu compile-time safety.
- Hindari builder sebagai fluent setter tanpa validasi.
- Hindari `Cloneable` untuk domain object penting.
- Gunakan copy constructor, copy factory, wither, atau `toBuilder()` untuk copy semantics eksplisit.
- Gunakan Test Data Builder untuk test yang jelas dan tahan perubahan.
- Batasi Object Mother hanya untuk canonical fixture.

Creational pattern yang matang membuat codebase lebih mudah berubah karena object tidak lahir dalam keadaan ambigu. Object yang lahir valid mengurangi defensive programming. Object yang lahir dengan intensi jelas membuat design lebih mudah dipahami, diuji, dan direview.

---

## 22. Latihan Praktis

### Latihan 1 — Constructor Chaos

Ambil satu class di codebase yang punya constructor panjang atau banyak setter. Jawab:

1. Field mana yang required?
2. Field mana yang optional?
3. Field mana yang defaulted?
4. Field mana yang derived?
5. Field mana yang seharusnya tidak boleh diisi caller?
6. Apakah builder cocok?
7. Apakah static factory lebih cocok?

### Latihan 2 — Builder Invariant

Desain builder untuk `CaseAssignmentRequest` dengan rule:

- `caseId` required
- `officerId` required
- `reason` required
- `effectiveDate` default hari ini
- jika assignment backdated, harus ada `approvalReference`

Coba buat dua versi:

1. builder biasa
2. staged builder

Bandingkan readability dan complexity.

### Latihan 3 — Object Mother Refactoring

Ambil test fixture yang punya banyak static factory method. Refactor ke Test Data Builder. Pastikan test menjadi lebih jelas, bukan hanya lebih pendek.

### Latihan 4 — Prototype Semantics

Desain method copy untuk `Application`:

- copy as draft
- copy as renewal
- copy as appeal

Tentukan field mana yang ikut disalin dan mana yang harus baru.

---

## 23. Kapan Seri Ini Dilanjutkan

Part ini adalah bagian ke-5 dari total 35 part.

Bagian berikutnya:

```text
06-singleton-multiton-registry-service-locator-global-state.md
```

Topik berikutnya akan membahas Singleton, Multiton, Registry, Service Locator, dan problem global state. Ini penting karena banyak sistem Java enterprise memakai singleton secara tidak sadar melalui static utility, DI singleton scope, registry, cache, dan service locator tersembunyi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./04-creational-constructor-static-factory-factory-method.md">⬅️ Creational Pattern I: Constructor, Static Factory, Factory Method</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./06-singleton-multiton-registry-service-locator-global-state.md">Part 6 — Singleton, Multiton, Registry, Service Locator: Global State Under Control ➡️</a>
</div>
