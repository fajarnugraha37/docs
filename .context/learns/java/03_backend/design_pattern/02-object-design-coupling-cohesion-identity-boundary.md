# 02 — Object Design Fundamentals: Coupling, Cohesion, Identity, and Boundaries

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: `02-object-design-coupling-cohesion-identity-boundary.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Staff-level engineering foundation

---

## 0. Posisi Materi Ini dalam Seri

Sebelum membahas pattern seperti Factory, Strategy, Adapter, Visitor, State, Repository, atau Saga, kita harus punya fondasi yang lebih dasar: **bagaimana object didesain**.

Banyak engineer mengetahui nama pattern, tetapi tetap menghasilkan desain yang rapuh karena tidak memahami hal-hal berikut:

- kapan sebuah object harus punya identity;
- kapan sebuah object seharusnya hanya value;
- kapan logic harus berada di domain object, service, policy, specification, atau workflow;
- kapan dependency masih sehat dan kapan sudah menjadi coupling berbahaya;
- kapan class kecil meningkatkan clarity dan kapan hanya menciptakan fragmentation;
- kapan abstraction melindungi perubahan dan kapan hanya menyembunyikan kebingungan;
- kapan data model, API model, persistence model, dan domain model harus dipisah;
- kapan mutability aman dan kapan menjadi sumber bug concurrency, auditability, dan lifecycle.

Design pattern bukan dimulai dari “saya butuh Strategy” atau “saya butuh Factory”. Pattern muncul ketika kita memahami struktur masalah:

```text
Ada sesuatu yang berubah.
Ada sesuatu yang harus tetap stabil.
Ada boundary yang perlu dijaga.
Ada konsekuensi jika dependency salah arah.
Ada invariant yang tidak boleh bocor.
Ada lifecycle yang harus eksplisit.
```

Bagian ini membangun bahasa mental untuk membaca dan mendesain object di Java secara serius.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan object sebagai pemilik behavior vs object sebagai data carrier.
2. Membedakan entity, value object, DTO, command, event, dan persistence object.
3. Mendesain class berdasarkan responsibility, bukan hanya berdasarkan tabel database atau JSON payload.
4. Mengenali coupling yang eksplisit maupun tersembunyi.
5. Mengenali cohesion yang tinggi, rendah, palsu, dan accidental.
6. Memahami identity, equality, lifecycle, mutability, dan boundary sebagai keputusan desain.
7. Menilai apakah abstraction membantu atau merusak codebase.
8. Menganalisis collaboration graph antar object.
9. Mendeteksi design smell seperti god object, anemic model, primitive obsession, feature envy, temporal coupling, dan semantic coupling.
10. Membuat keputusan desain yang lebih defensible di Java 8–25.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sebuah module enterprise Java untuk case management:

```java
public class CaseService {
    public void approve(Long caseId, String officerId, String remarks) {
        CaseEntity c = caseRepository.findById(caseId);

        if (!c.getStatus().equals("PENDING_REVIEW")) {
            throw new RuntimeException("Invalid status");
        }

        Officer officer = officerRepository.findById(officerId);

        if (!officer.getRoles().contains("APPROVER")) {
            throw new RuntimeException("No permission");
        }

        c.setStatus("APPROVED");
        c.setApprovedBy(officerId);
        c.setApprovedAt(LocalDateTime.now());
        c.setRemarks(remarks);

        caseRepository.save(c);

        auditService.log("Case approved " + caseId);
        notificationService.notifyApplicant(c.getApplicantEmail(), "Approved");
    }
}
```

Sekilas ini terlihat normal. Banyak aplikasi enterprise memiliki service seperti ini.

Namun secara object design, ada banyak pertanyaan:

- Siapa pemilik aturan transisi status?
- Apakah `CaseEntity` hanya data bag?
- Apakah status string aman?
- Apakah permission check bagian dari service, policy, atau domain?
- Apakah audit harus dilakukan setelah save, sebelum save, atau sebagai domain event?
- Apakah notification boleh berada dalam transaksi yang sama?
- Apakah `remarks` punya invariant?
- Apakah `officerId` cukup sebagai string, atau harus `OfficerId`?
- Apakah `LocalDateTime.now()` membuat test sulit?
- Apakah `CaseService` mulai menjadi god service?

Design pattern yang tepat tidak bisa dipilih sebelum pertanyaan seperti ini dijawab.

---

## 3. Mental Model Utama

### 3.1 Object Design adalah Desain Responsibility

Object-oriented design bukan tentang membuat banyak class. OO design adalah tentang **menempatkan responsibility pada tempat yang membuat perubahan lokal, invariant terjaga, dan dependency masuk akal**.

Pertanyaan utama bukan:

```text
Berapa banyak class yang saya butuhkan?
```

Pertanyaan yang lebih benar:

```text
Siapa yang paling pantas mengetahui aturan ini?
Siapa yang paling pantas mengambil keputusan ini?
Siapa yang paling pantas berubah ketika requirement ini berubah?
```

Jika sebuah aturan berubah, idealnya hanya satu area kecil yang perlu disentuh.

---

### 3.2 Object Design adalah Desain Boundary

Boundary adalah garis pemisah antara bagian sistem yang memiliki alasan perubahan berbeda.

Contoh boundary:

- domain boundary;
- transaction boundary;
- API boundary;
- persistence boundary;
- external system boundary;
- module boundary;
- package boundary;
- thread boundary;
- security boundary;
- lifecycle boundary;
- consistency boundary.

Pattern biasanya muncul untuk menjaga boundary.

Contoh:

| Boundary | Pattern yang Sering Muncul |
|---|---|
| External API vs internal model | Adapter, Gateway, Anti-Corruption Layer |
| Object construction kompleks | Builder, Factory |
| Behavior bervariasi | Strategy, Policy, Specification |
| Lifecycle state kompleks | State, State Machine |
| Cross-cutting concern | Decorator, Proxy, Interceptor |
| Persistence boundary | Repository, DAO, Data Mapper |
| Transactional messaging | Outbox, Inbox |
| API compatibility | DTO, Versioned Contract |

Tanpa boundary, pattern berubah menjadi dekorasi kosong.

---

### 3.3 Object Design adalah Desain Change Surface

Setiap desain menciptakan permukaan perubahan.

Misalnya requirement berubah:

```text
Approval case sekarang harus mempertimbangkan officer grade, case risk level,
previous violation, dan delegation period.
```

Jika semua logic ada di `CaseService`, maka service membesar.

Jika logic tersebar di controller, repository, entity, mapper, dan scheduler, maka perubahan menjadi berisiko.

Jika logic ditempatkan dalam `ApprovalPolicy`, `CaseStateMachine`, dan `OfficerAuthority`, maka perubahan lebih terisolasi.

Object design yang baik bukan menghilangkan perubahan, tetapi membuat perubahan punya lokasi yang masuk akal.

---

## 4. Object sebagai Behavior Owner, Bukan Sekadar Data Bag

### 4.1 Data Bag

Data bag adalah object yang hanya menyimpan field, getter, dan setter.

```java
public class CaseRecord {
    private String status;
    private String assignedOfficer;
    private LocalDateTime approvedAt;

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getAssignedOfficer() { return assignedOfficer; }
    public void setAssignedOfficer(String assignedOfficer) { this.assignedOfficer = assignedOfficer; }

    public LocalDateTime getApprovedAt() { return approvedAt; }
    public void setApprovedAt(LocalDateTime approvedAt) { this.approvedAt = approvedAt; }
}
```

Data bag tidak selalu salah. DTO sering memang data bag. Masalah muncul ketika object yang seharusnya menjaga invariant justru hanya menjadi wadah data.

---

### 4.2 Behavior Owner

Behavior owner adalah object yang menjaga aturan terkait state-nya sendiri.

```java
public final class EnforcementCase {
    private final CaseId id;
    private CaseStatus status;
    private OfficerId assignedOfficer;
    private ApprovalInfo approvalInfo;

    public void approve(Officer officer, ApprovalRemarks remarks, Clock clock) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new IllegalStateException("Only pending review case can be approved");
        }

        if (!officer.canApprove(this)) {
            throw new IllegalArgumentException("Officer is not allowed to approve this case");
        }

        this.status = CaseStatus.APPROVED;
        this.approvalInfo = new ApprovalInfo(
            officer.id(),
            remarks,
            Instant.now(clock)
        );
    }
}
```

Perbedaannya bukan hanya gaya coding. Perbedaannya adalah lokasi invariant.

Pada data bag, siapa pun bisa melakukan ini:

```java
caseRecord.setStatus("APPROVED");
caseRecord.setApprovedAt(null);
```

Pada behavior owner, perubahan status melewati method yang menjaga aturan.

---

### 4.3 Kapan Data Bag Tepat?

Data bag tepat untuk:

- DTO request/response;
- serialization boundary;
- database projection;
- read model;
- log/event payload yang immutable;
- command object yang hanya membawa intent;
- test fixture sederhana.

Data bag berbahaya untuk:

- aggregate/domain object;
- security-sensitive state;
- workflow state;
- financial state;
- audit-sensitive object;
- object dengan lifecycle kompleks;
- object yang harus menjaga invariant.

---

## 5. Identity Object vs Value Object

Salah satu kesalahan object design paling umum adalah mencampur **identity** dan **value**.

---

### 5.1 Entity / Identity Object

Entity adalah object yang dianggap sama karena identity-nya, meskipun atributnya berubah.

Contoh:

```java
public final class EnforcementCase {
    private final CaseId id;
    private CaseStatus status;
    private CaseRiskLevel riskLevel;

    public CaseId id() {
        return id;
    }
}
```

Case yang sama tetap case yang sama walaupun status berubah dari `OPEN` ke `APPROVED`.

Karakteristik entity:

- punya identity stabil;
- punya lifecycle;
- bisa berubah state;
- equality biasanya berbasis id;
- sering dipersist;
- sering punya audit trail;
- sering punya ownership dan authorization.

---

### 5.2 Value Object

Value object adalah object yang dianggap sama karena seluruh nilainya sama.

Contoh:

```java
public record Money(String currency, BigDecimal amount) {
    public Money {
        Objects.requireNonNull(currency, "currency");
        Objects.requireNonNull(amount, "amount");

        if (currency.isBlank()) {
            throw new IllegalArgumentException("currency must not be blank");
        }

        if (amount.scale() > 2) {
            throw new IllegalArgumentException("amount must use at most 2 decimal places");
        }
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Cannot add different currencies");
        }
        return new Money(currency, amount.add(other.amount));
    }
}
```

Karakteristik value object:

- tidak punya identity sendiri;
- immutable idealnya;
- equality berbasis value;
- aman dibagikan;
- menjaga invariant lokal;
- membuat domain lebih eksplisit;
- mengurangi primitive obsession.

---

### 5.3 Contoh Primitive Obsession

Desain lemah:

```java
public void imposePenalty(String caseId, String amount, String currency, String reason) {
    // logic
}
```

Masalah:

- `caseId` bisa kosong;
- `amount` bisa bukan angka;
- `currency` bisa invalid;
- `reason` bisa terlalu panjang;
- parameter tertukar sulit dideteksi;
- invariant tersebar.

Desain lebih kuat:

```java
public void imposePenalty(
    CaseId caseId,
    Money amount,
    PenaltyReason reason
) {
    // logic
}
```

Value object bukan sekadar wrapper. Value object adalah tempat invariant tinggal.

---

### 5.4 Type-Safe Identifier

Java enterprise code sering memakai `Long`, `String`, atau `UUID` langsung untuk semua id.

```java
public void assign(Long caseId, Long officerId) {
    // easy to swap accidentally
}
```

Lebih aman:

```java
public record CaseId(UUID value) {
    public CaseId {
        Objects.requireNonNull(value, "value");
    }
}

public record OfficerId(UUID value) {
    public OfficerId {
        Objects.requireNonNull(value, "value");
    }
}

public void assign(CaseId caseId, OfficerId officerId) {
    // cannot swap accidentally
}
```

Di Java 16+ records membuat pattern ini jauh lebih murah.

Untuk Java 8, gunakan final class:

```java
public final class CaseId {
    private final UUID value;

    public CaseId(UUID value) {
        this.value = Objects.requireNonNull(value, "value");
    }

    public UUID value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CaseId)) return false;
        CaseId caseId = (CaseId) o;
        return value.equals(caseId.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }
}
```

---

## 6. Mutability Boundary

Mutability bukan hanya style. Mutability adalah sumber coupling waktu.

Jika object bisa berubah, maka semua code yang memegang referensi ke object tersebut ikut terpengaruh oleh perubahan waktu.

---

### 6.1 Mutable Object Problem

```java
public class CaseFilter {
    private List<String> statuses;

    public List<String> getStatuses() {
        return statuses;
    }

    public void setStatuses(List<String> statuses) {
        this.statuses = statuses;
    }
}
```

Masalah:

```java
List<String> statuses = new ArrayList<>();
statuses.add("OPEN");

CaseFilter filter = new CaseFilter();
filter.setStatuses(statuses);

statuses.clear(); // filter berubah dari luar
```

Ini adalah boundary leak.

---

### 6.2 Defensive Copy

```java
public final class CaseFilter {
    private final List<CaseStatus> statuses;

    public CaseFilter(List<CaseStatus> statuses) {
        this.statuses = List.copyOf(statuses);
    }

    public List<CaseStatus> statuses() {
        return statuses;
    }
}
```

Untuk Java 8:

```java
public final class CaseFilter {
    private final List<CaseStatus> statuses;

    public CaseFilter(List<CaseStatus> statuses) {
        this.statuses = Collections.unmodifiableList(new ArrayList<>(statuses));
    }

    public List<CaseStatus> statuses() {
        return statuses;
    }
}
```

---

### 6.3 Mutability Tidak Selalu Salah

Mutable object bisa tepat jika:

- object adalah aggregate dengan lifecycle;
- mutation dikontrol lewat method bermakna;
- mutation berada dalam transaction boundary;
- object tidak dishare antar thread;
- mutation perlu untuk performance;
- mutation dipantau audit/versioning;
- invariant tetap dijaga.

Yang berbahaya bukan mutability itu sendiri, tetapi **uncontrolled mutability**.

---

### 6.4 Encapsulated Mutation

Buruk:

```java
caseEntity.setStatus(CaseStatus.APPROVED);
caseEntity.setApprovedBy(officerId);
caseEntity.setApprovedAt(now);
```

Lebih baik:

```java
caseEntity.approve(officer, remarks, clock);
```

Perbedaannya:

| Setter Mutation | Encapsulated Mutation |
|---|---|
| Field-level operation | Domain-level operation |
| Invariant tersebar | Invariant terpusat |
| Sulit diaudit | Mudah diaudit |
| Mudah inconsistent | Lebih defensible |
| Service membesar | Object punya behavior |

---

## 7. Coupling: Dependency yang Membuat Perubahan Mahal

Coupling adalah tingkat ketergantungan antar bagian sistem.

Coupling tidak selalu buruk. Sistem tanpa coupling tidak melakukan apa-apa. Yang penting adalah **jenis coupling dan arahnya**.

---

### 7.1 Afferent dan Efferent Coupling

```text
Afferent coupling  = berapa banyak komponen bergantung pada saya.
Efferent coupling  = berapa banyak komponen yang saya bergantung padanya.
```

Object/package yang banyak dipakai oleh orang lain harus stabil.

Object/package yang bergantung pada banyak hal harus tidak menjadi domain core.

Contoh:

```text
case-domain
  sedikit dependency keluar
  banyak dipakai oleh use case
  harus stabil

case-adapter-onemap
  bergantung pada external API
  boleh berubah mengikuti external contract
  tidak boleh menginfeksi domain
```

---

### 7.2 Static Coupling

Static coupling terlihat dari import, field, constructor, inheritance, atau method call.

```java
public final class ApprovalService {
    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final AuditService auditService;
    private final EmailService emailService;
    private final PdfService pdfService;
    private final NotificationService notificationService;
}
```

Banyak dependency tidak otomatis salah, tetapi ini sinyal bahwa service mungkin memegang terlalu banyak responsibility.

---

### 7.3 Semantic Coupling

Semantic coupling lebih berbahaya karena tidak selalu terlihat dari import.

Contoh:

```java
if (status.equals("PENDING_REVIEW")) {
    // only this status can be approved
}
```

Jika aturan status berubah, semua lokasi yang tahu string itu harus berubah.

Semantic coupling sering muncul sebagai:

- magic string;
- magic number;
- duplicated business rule;
- convention tanpa type;
- implicit ordering;
- naming contract;
- hidden assumption.

---

### 7.4 Temporal Coupling

Temporal coupling terjadi ketika method harus dipanggil dalam urutan tertentu agar object valid.

```java
ReportGenerator generator = new ReportGenerator();
generator.setTemplate(template);
generator.setData(data);
generator.setOutputFormat(OutputFormat.PDF);
generator.generate();
```

Jika lupa set template, error muncul runtime.

Lebih baik:

```java
ReportGenerator generator = ReportGenerator.builder()
    .template(template)
    .data(data)
    .outputFormat(OutputFormat.PDF)
    .build();

generator.generate();
```

Atau:

```java
reportService.generate(new GenerateReportCommand(template, data, OutputFormat.PDF));
```

Temporal coupling adalah alasan Builder, Command, dan immutable configuration sering muncul.

---

### 7.5 Control Coupling

Control coupling terjadi ketika caller mengirim flag untuk mengontrol internal behavior callee.

```java
notificationService.send(user, message, true, false, true);
```

Apa arti `true, false, true`?

Lebih baik:

```java
notificationService.send(
    NotificationRequest.email(user, message)
        .withAudit()
        .highPriority()
);
```

Atau pisahkan behavior:

```java
emailNotificationService.send(user, message);
smsNotificationService.send(user, message);
```

Boolean parameter sering menjadi smell karena memampatkan beberapa behavior menjadi satu method.

---

### 7.6 Data Coupling

Data coupling terjadi ketika object menerima data yang terlalu banyak atau terlalu mentah.

```java
approvalService.approve(
    caseId,
    officerId,
    officerRole,
    officerGrade,
    departmentCode,
    remarks,
    ipAddress,
    userAgent
);
```

Lebih baik:

```java
approvalService.approve(new ApproveCaseCommand(
    caseId,
    OfficerContext.of(officerId, officerRole, officerGrade, departmentCode),
    remarks,
    RequestContext.of(ipAddress, userAgent)
));
```

Parameter object bukan hanya merapikan signature. Ia memberi nama pada konsep.

---

### 7.7 Inheritance Coupling

Inheritance membuat subclass bergantung pada detail superclass.

```java
public abstract class BaseService {
    protected User currentUser() { ... }
    protected void audit(String message) { ... }
    protected void validate(Object input) { ... }
}

public class CaseService extends BaseService {
    public void approve(...) {
        validate(...);
        audit(...);
    }
}
```

Masalah:

- dependency tersembunyi;
- lifecycle tidak jelas;
- protected method menjadi API palsu;
- sulit test;
- subclass mudah rusak jika superclass berubah;
- semua service mewarisi behavior yang belum tentu relevan.

Composition lebih eksplisit:

```java
public final class CaseService {
    private final CurrentUserProvider currentUserProvider;
    private final AuditPublisher auditPublisher;
    private final Validator validator;
}
```

---

## 8. Cohesion: Kekuatan Alasan untuk Bersama

Cohesion adalah seberapa kuat alasan elemen dalam sebuah module/class berada bersama.

High cohesion berarti bagian-bagian class bekerja untuk satu responsibility yang jelas.

Low cohesion berarti class menjadi tempat penampungan hal-hal tidak terkait.

---

### 8.1 Low Cohesion Example

```java
public class CaseUtility {
    public String formatCaseNumber(Long id) { ... }
    public boolean canApprove(User user, CaseEntity c) { ... }
    public void sendEmail(String to, String body) { ... }
    public byte[] generatePdf(CaseEntity c) { ... }
    public LocalDateTime parseDate(String input) { ... }
}
```

Ini bukan utility, ini dumping ground.

---

### 8.2 High Cohesion Example

```java
public final class CaseNumberFormatter {
    public String format(CaseId id) { ... }
}

public final class ApprovalPolicy {
    public boolean canApprove(Officer officer, EnforcementCase enforcementCase) { ... }
}

public final class CaseDecisionPdfRenderer {
    public byte[] render(CaseDecision decision) { ... }
}
```

Setiap class punya alasan perubahan yang berbeda.

---

### 8.3 Cohesion Berdasarkan Lifecycle

Object yang berubah bersama sering layak berada bersama.

Contoh:

```java
public final class ApprovalInfo {
    private final OfficerId approvedBy;
    private final Instant approvedAt;
    private final ApprovalRemarks remarks;
}
```

`approvedBy`, `approvedAt`, dan `remarks` memiliki lifecycle yang sama. Mereka muncul bersama saat approval terjadi. Maka mereka cocok menjadi satu value object.

---

### 8.4 Cohesion Berdasarkan Invariant

Jika beberapa field harus selalu konsisten bersama, mereka sebaiknya berada dalam object yang sama.

Buruk:

```java
private BigDecimal penaltyAmount;
private String penaltyCurrency;
```

Lebih baik:

```java
private Money penalty;
```

Karena amount dan currency memiliki invariant bersama.

---

### 8.5 Cohesion Berdasarkan Policy

Jika beberapa rule berubah karena alasan policy yang sama, mereka bisa dikumpulkan.

```java
public final class ApprovalPolicy {
    public ApprovalDecision evaluate(Officer officer, EnforcementCase enforcementCase) {
        // grade rule
        // delegation rule
        // conflict of interest rule
        // risk-level rule
    }
}
```

Namun hati-hati. Jika policy terus membesar dengan banyak variasi, mungkin perlu Specification, Strategy, atau Rule Object.

---

## 9. Responsibility Assignment

Object design adalah seni menempatkan responsibility.

Pertanyaan penting:

```text
Informasi apa yang dibutuhkan untuk mengambil keputusan ini?
Object mana yang sudah memiliki informasi tersebut?
Object mana yang seharusnya tidak tahu hal tersebut?
Jika rule berubah, bagian mana yang pantas berubah?
```

---

### 9.1 Information Expert

Responsibility sebaiknya diberikan kepada object yang memiliki informasi paling relevan.

Contoh:

```java
public final class Officer {
    private final OfficerGrade grade;
    private final Set<Permission> permissions;
    private final DelegationPeriod delegationPeriod;

    public boolean canApprove(EnforcementCase enforcementCase, Clock clock) {
        return permissions.contains(Permission.APPROVE_CASE)
            && grade.canHandle(enforcementCase.riskLevel())
            && delegationPeriod.includes(Instant.now(clock));
    }
}
```

Namun ini juga bisa diperdebatkan. Jika approval rule kompleks dan sering berubah, `ApprovalPolicy` mungkin lebih baik.

---

### 9.2 Pure Fabrication

Kadang tidak ada domain object alami yang cocok. Maka kita menciptakan object buatan untuk menjaga cohesion.

Contoh:

```java
public final class ApprovalPolicy {
    public ApprovalDecision evaluate(Officer officer, EnforcementCase enforcementCase, Instant now) {
        // policy logic
    }
}
```

`ApprovalPolicy` bukan entity dunia nyata, tetapi berguna sebagai tempat responsibility.

Banyak pattern adalah pure fabrication yang sehat.

---

### 9.3 Controller / Application Service

Application service bertugas mengorkestrasi use case, bukan menjadi tempat semua business rule.

```java
public final class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final ApprovalPolicy approvalPolicy;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    public void handle(ApproveCaseCommand command) {
        EnforcementCase enforcementCase = caseRepository.get(command.caseId());
        Officer officer = officerRepository.get(command.officerId());

        ApprovalDecision decision = approvalPolicy.evaluate(
            officer,
            enforcementCase,
            Instant.now(clock)
        );

        enforcementCase.approve(decision, command.remarks());

        caseRepository.save(enforcementCase);
        eventPublisher.publish(CaseApproved.from(enforcementCase));
    }
}
```

Application service menghubungkan object, tetapi tidak harus mengambil semua keputusan sendiri.

---

## 10. Law of Demeter secara Praktis

Law of Demeter sering diringkas sebagai:

```text
Do not talk to strangers.
```

Artinya sebuah object sebaiknya tidak terlalu dalam mengakses struktur internal object lain.

---

### 10.1 Violation Example

```java
String email = caseFile
    .getApplicant()
    .getProfile()
    .getContactInfo()
    .getEmail()
    .getValue();
```

Masalah:

- caller tahu struktur internal terlalu dalam;
- perubahan struktur applicant merusak banyak caller;
- null handling tersebar;
- domain intent tidak jelas.

---

### 10.2 Better Design

```java
EmailAddress email = caseFile.applicantEmail();
```

Atau:

```java
notificationService.notifyApplicant(caseFile, message);
```

Object luar tidak perlu tahu jalur internal untuk mendapatkan email.

---

### 10.3 Law of Demeter Bukan Larangan Semua Chaining

Fluent API bisa chaining dan tetap baik:

```java
query.where(statusIs(APPROVED))
     .orderBy(createdAt().descending())
     .limit(50);
```

Ini bukan masalah jika setiap call mengembalikan object dalam DSL yang memang dirancang untuk chaining.

Yang bermasalah adalah chaining yang membocorkan struktur internal.

---

## 11. Feature Envy dan Misplaced Responsibility

Feature envy terjadi ketika sebuah method lebih tertarik pada data object lain daripada data dirinya sendiri.

---

### 11.1 Example

```java
public final class CaseService {
    public boolean isHighRisk(CaseEntity c) {
        return c.getViolationCount() > 3
            || c.getPenaltyAmount().compareTo(new BigDecimal("10000")) > 0
            || c.getApplicantType().equals("CORPORATE");
    }
}
```

Method ini iri pada data `CaseEntity`. Mungkin logic sebaiknya pindah:

```java
public final class EnforcementCase {
    public boolean isHighRisk() {
        return violationCount.value() > 3
            || penalty.exceeds(Money.sgd("10000"))
            || applicantType == ApplicantType.CORPORATE;
    }
}
```

Atau jika risk calculation berubah sering:

```java
public final class RiskAssessmentPolicy {
    public RiskLevel assess(EnforcementCase enforcementCase) { ... }
}
```

---

### 11.2 Cara Memutuskan Lokasi Logic

Gunakan pertanyaan ini:

| Pertanyaan | Lokasi yang Mungkin |
|---|---|
| Logic hanya menjaga invariant object? | Domain object |
| Logic butuh banyak external dependency? | Application service / domain service |
| Logic adalah policy yang sering berubah? | Policy / Specification / Rule Object |
| Logic adalah translasi model? | Mapper / Adapter |
| Logic adalah orchestration use case? | Application service |
| Logic adalah persistence query? | Repository / Query Object |
| Logic adalah formatting output? | Presenter / Renderer |

---

## 12. Collaboration Graph

Object tidak hidup sendirian. Mereka berkolaborasi.

Collaboration graph adalah peta siapa memanggil siapa dan mengapa.

---

### 12.1 Buruk: Semua Melalui God Service

```text
Controller
    |
    v
CaseService
    |-- CaseRepository
    |-- OfficerRepository
    |-- UserRepository
    |-- AuditService
    |-- EmailService
    |-- PdfService
    |-- TemplateService
    |-- NotificationService
    |-- PermissionService
    |-- WorkflowService
    |-- ExternalApiClient
```

Gejala:

- service sulit dipahami;
- test setup berat;
- perubahan kecil berdampak luas;
- transaction boundary kabur;
- side effect bercampur;
- dependency graph tidak menunjukkan intent.

---

### 12.2 Lebih Baik: Collaboration Berdasarkan Role

```text
ApproveCaseUseCase
    |-- CaseRepository
    |-- OfficerRepository
    |-- ApprovalPolicy
    |-- CaseStateMachine
    |-- AuditPublisher
    |-- DomainEventPublisher

ApprovalPolicy
    |-- AuthorityMatrix
    |-- ConflictOfInterestPolicy

CaseStateMachine
    |-- transition rules

NotificationHandler
    |-- NotificationGateway
    |-- TemplateRenderer
```

Desain ini memperjelas:

- use case orchestration;
- policy decision;
- lifecycle transition;
- side effect handling;
- integration boundary.

---

### 12.3 Collaboration Smell

Tanda collaboration graph buruk:

1. Satu class punya terlalu banyak dependency.
2. Dependency banyak tetapi sebagian besar hanya dipakai oleh satu method.
3. Service A memanggil Service B, B memanggil C, C memanggil A.
4. Domain object memanggil repository.
5. Mapper memanggil service.
6. Repository memanggil external API.
7. Controller tahu detail workflow.
8. Utility class dipakai semua layer.
9. Semua object menerima `Map<String, Object>`.
10. Banyak method memakai boolean flag untuk memilih behavior.

---

## 13. Boundary dalam Java Codebase

Boundary tidak cukup hanya digambar di diagram. Boundary harus terlihat di package, dependency, API, dan test.

---

### 13.1 Package Boundary

Buruk:

```text
com.example.caseapp
  controller
  service
  repository
  entity
  dto
  util
```

Struktur ini package-by-layer. Tidak selalu salah, tetapi pada sistem besar sering membuat module boundary kabur.

Lebih domain-oriented:

```text
com.example.caseapp.caseapproval
  application
  domain
  persistence
  api
  integration

com.example.caseapp.investigation
  application
  domain
  persistence
  api
  integration
```

Dengan begini, boundary fitur lebih jelas.

---

### 13.2 Dependency Direction

Core domain sebaiknya tidak bergantung pada adapter.

```text
Baik:

api/controller -> application -> domain
persistence adapter -> domain
integration adapter -> application/domain ports
```

```text
Buruk:

domain -> spring framework
     -> jpa entity manager
     -> http client
     -> redis client
     -> kafka producer
```

Dependency direction menentukan apakah domain bisa bertahan saat framework berubah.

---

### 13.3 Public API vs Internal Model

Jangan semua class dibuat public.

```java
public class CaseApprovalValidator { ... }
public class CaseApprovalHelper { ... }
public class CaseApprovalInternalState { ... }
```

Jika semua public, semua menjadi API. Jika semua menjadi API, semua sulit diubah.

Gunakan package-private untuk detail internal:

```java
final class CaseApprovalRules {
    boolean canApprove(...) { ... }
}
```

Java module system dapat memperkuat boundary, tetapi bahkan tanpa module system, package-private discipline sangat berguna.

---

## 14. Interface Design

Interface adalah contract. Jangan membuat interface hanya karena “best practice”.

---

### 14.1 Interface yang Baik

Interface baik jika:

- ada lebih dari satu implementation nyata;
- implementation kemungkinan berubah;
- interface menjadi port ke external system;
- interface membantu test karena boundary mahal;
- interface memisahkan policy dari mechanism;
- interface dipakai sebagai extension point.

Contoh:

```java
public interface CaseRepository {
    Optional<EnforcementCase> findById(CaseId id);
    void save(EnforcementCase enforcementCase);
}
```

Repository sebagai port masuk akal karena domain/application tidak perlu tahu database.

---

### 14.2 Interface yang Lemah

```java
public interface CaseServiceInterface {
    void approve(Long id);
}

public class CaseServiceImpl implements CaseServiceInterface {
    public void approve(Long id) { ... }
}
```

Jika hanya ada satu implementation dan interface tidak memberi boundary bermakna, ini mungkin ceremony kosong.

Nama `Impl` juga sering menandakan abstraction belum punya nama konsep.

Lebih baik:

```java
public final class ApproveCaseUseCase {
    public void handle(ApproveCaseCommand command) { ... }
}
```

Atau jika perlu port:

```java
public interface ApproveCase {
    void handle(ApproveCaseCommand command);
}
```

Implementation bisa punya nama bermakna:

```java
public final class TransactionalApproveCase implements ApproveCase { ... }
```

---

### 14.3 Interface Segregation

Buruk:

```java
public interface CaseRepository {
    Case findById(CaseId id);
    List<Case> findAll();
    void save(Case c);
    void delete(CaseId id);
    List<Case> search(CaseSearchCriteria criteria);
    long countByStatus(CaseStatus status);
    List<CaseStatistics> statistics(...);
}
```

Semua use case bergantung pada semua method.

Lebih baik pisahkan berdasarkan kebutuhan:

```java
public interface CaseLookup {
    Optional<EnforcementCase> findById(CaseId id);
}

public interface CaseSaver {
    void save(EnforcementCase enforcementCase);
}

public interface CaseSearchQuery {
    Page<CaseSummary> search(CaseSearchCriteria criteria);
}
```

Namun jangan terlalu ekstrem sampai setiap method punya interface sendiri tanpa alasan.

---

## 15. Abstraction: Perlindungan atau Kabut?

Abstraction yang baik menyembunyikan detail yang volatile dan mengekspose contract yang stabil.

Abstraction yang buruk menyembunyikan realitas yang perlu diketahui caller.

---

### 15.1 Good Abstraction

```java
public interface PostalCodeLookup {
    Optional<Address> findByPostalCode(PostalCode postalCode);
}
```

Caller tidak perlu tahu apakah data berasal dari cache, database, atau external API.

---

### 15.2 Bad Abstraction

```java
public interface DataProcessor {
    Object process(Object input);
}
```

Ini terlalu abstrak. Tidak ada semantic contract.

Masalah:

- tidak jelas input valid;
- tidak jelas output;
- tidak jelas error;
- tidak jelas side effect;
- sulit test;
- mudah menjadi dumping ground.

---

### 15.3 Abstraction Test

Sebelum membuat abstraction, tanyakan:

```text
Apa yang disembunyikan?
Apa yang tetap diekspos?
Apa invariant contract-nya?
Apa variasi implementation yang realistis?
Apa biaya cognitive load-nya?
Apa yang menjadi lebih mudah setelah abstraction ini ada?
Apa yang menjadi lebih sulit?
```

Jika tidak bisa menjawab, abstraction mungkin premature.

---

## 16. Class Kecil: Clarity atau Fragmentation?

Nasihat “buat class kecil” sering benar, tetapi bisa disalahgunakan.

---

### 16.1 Class Kecil yang Baik

Class kecil baik jika punya konsep jelas:

```java
public record ApprovalRemarks(String value) {
    public ApprovalRemarks {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("remarks must not be blank");
        }
        if (value.length() > 1000) {
            throw new IllegalArgumentException("remarks too long");
        }
    }
}
```

Ini kecil, tetapi bermakna.

---

### 16.2 Class Kecil yang Buruk

```java
public class CaseApprovalValidatorHelperUtil {
    public boolean check(Case c) { ... }
}
```

Jika class kecil hanya hasil extract tanpa konsep, ia menambah navigasi tanpa menambah pemahaman.

---

### 16.3 Fragmentation Smell

Tanda terlalu terfragmentasi:

- untuk memahami satu use case harus membuka 20 file kecil;
- class hanya punya satu method trivial dan nama tidak bermakna;
- abstraction tidak punya variasi;
- dependency graph makin panjang tanpa benefit;
- test menjadi banyak mock tanpa behavior nyata;
- nama class penuh suffix `Helper`, `Util`, `Manager`, `Processor`.

---

## 17. Naming sebagai Design Tool

Nama bukan kosmetik. Nama menentukan cara tim memahami sistem.

---

### 17.1 Nama Lemah

```java
CaseUtil
CaseManager
CaseProcessor
CaseHandler
CommonService
DataHelper
RequestObject
ResponseObject
```

Nama seperti ini tidak menjelaskan responsibility.

---

### 17.2 Nama Lebih Kuat

```java
ApproveCaseUseCase
ApprovalPolicy
CaseStateMachine
CaseTransition
OfficerAuthority
CaseAuditEvent
CaseDecisionRenderer
PostalCodeLookupGateway
```

Nama yang baik menjawab:

```text
Object ini mewakili konsep apa?
Keputusan apa yang ia buat?
Boundary apa yang ia jaga?
Alasan apa yang membuatnya berubah?
```

---

## 18. Java-Specific Object Design Considerations

Java punya karakteristik yang memengaruhi desain object.

---

### 18.1 Java 8

Java 8 memperkenalkan lambda dan functional interface yang membuat beberapa pattern lebih ringan.

Contoh Strategy:

```java
@FunctionalInterface
public interface ApprovalRule {
    boolean allows(Officer officer, EnforcementCase enforcementCase);
}
```

```java
ApprovalRule highGradeRule = (officer, c) -> officer.grade().canHandle(c.riskLevel());
```

Namun jangan mengubah semua domain rule menjadi lambda anonim. Jika rule penting secara domain, beri nama class atau method.

---

### 18.2 Java 16+ Records

Record cocok untuk immutable data carrier dan value object sederhana.

```java
public record CaseSummary(CaseId id, CaseStatus status, Instant createdAt) { }
```

Namun record bukan pengganti semua class. Jika object punya lifecycle mutable dan behavior kompleks, class biasa lebih tepat.

---

### 18.3 Java 17+ Sealed Classes

Sealed classes cocok untuk closed set of alternatives.

```java
public sealed interface ApprovalResult
    permits ApprovalResult.Approved, ApprovalResult.Rejected, ApprovalResult.RequiresEscalation {

    record Approved(OfficerId approvedBy) implements ApprovalResult { }
    record Rejected(String reason) implements ApprovalResult { }
    record RequiresEscalation(EscalationLevel level) implements ApprovalResult { }
}
```

Ini membantu menghindari string status liar dan membuat branching lebih type-safe.

---

### 18.4 Pattern Matching

Modern Java pattern matching dapat mengganti beberapa bentuk Visitor ringan.

```java
static String describe(ApprovalResult result) {
    return switch (result) {
        case ApprovalResult.Approved approved -> "Approved by " + approved.approvedBy();
        case ApprovalResult.Rejected rejected -> "Rejected: " + rejected.reason();
        case ApprovalResult.RequiresEscalation escalation -> "Escalate to " + escalation.level();
    };
}
```

Namun jika operation tersebar banyak dan hierarchy stabil, Visitor masih bisa relevan.

---

### 18.5 Virtual Threads dan Object Design

Virtual threads mengurangi kebutuhan callback-heavy design untuk IO-bound workflow.

Namun virtual threads tidak menghapus kebutuhan:

- immutable data;
- explicit transaction boundary;
- timeout;
- cancellation;
- context propagation;
- resource ownership;
- bounded concurrency;
- safe shared state.

Object design tetap penting karena concurrency bug sering berasal dari ownership dan mutability yang buruk.

---

## 19. Design Smell Catalog

### 19.1 God Object / God Service

Gejala:

- class sangat besar;
- dependency banyak;
- method banyak dan tidak saling terkait;
- semua use case lewat class yang sama;
- test butuh banyak mock;
- setiap perubahan menyentuh file yang sama.

Refactoring:

- kelompokkan method berdasarkan use case;
- extract application service;
- extract policy;
- extract state machine;
- extract gateway;
- extract renderer;
- extract domain object behavior.

---

### 19.2 Anemic Domain Model

Gejala:

- entity hanya getter/setter;
- semua business rule ada di service;
- invariant tidak dijaga entity;
- service melakukan banyak `setX`.

Tidak semua anemic model salah. Untuk CRUD sederhana, transaction script bisa cukup. Tetapi untuk domain dengan lifecycle, approval, audit, dan policy kompleks, anemic model mudah memburuk.

---

### 19.3 Primitive Obsession

Gejala:

- banyak `String`, `Long`, `BigDecimal` untuk domain concept;
- validation tersebar;
- parameter mudah tertukar;
- magic string status;
- currency/amount terpisah.

Refactoring:

- introduce value object;
- introduce enum/sealed hierarchy;
- introduce type-safe id;
- move validation into constructor/factory.

---

### 19.4 Inappropriate Intimacy

Gejala:

- satu class tahu terlalu banyak detail internal class lain;
- banyak getter chain;
- package private dilanggar dengan public getter;
- object luar mengatur internal state object lain.

Refactoring:

- move method;
- hide delegate;
- expose intention method;
- introduce domain operation.

---

### 19.5 Message Chain

Gejala:

```java
caseFile.getApplicant().getProfile().getContact().getEmail().getValue()
```

Refactoring:

```java
caseFile.applicantEmail()
```

Atau ubah responsibility agar caller tidak perlu tahu email sama sekali.

---

### 19.6 Shotgun Surgery

Gejala:

Satu perubahan requirement menyentuh banyak file.

Penyebab umum:

- duplicated rule;
- stringly typed status;
- boundary bocor;
- abstraction salah;
- logic tersebar di controller/service/repository/mapper.

Refactoring:

- centralize rule;
- introduce policy/specification;
- introduce value object;
- define lifecycle model;
- enforce boundary.

---

### 19.7 Divergent Change

Gejala:

Satu class berubah karena banyak alasan berbeda.

Contoh `CaseService` berubah ketika:

- approval rule berubah;
- email template berubah;
- audit format berubah;
- database query berubah;
- PDF layout berubah;
- authorization berubah.

Refactoring:

- split by reason to change;
- separate orchestration from policy;
- move integration concern to gateway;
- move rendering concern to renderer.

---

## 20. Step-by-Step Object Design Process

Berikut proses praktis saat mendesain use case baru.

---

### Step 1 — Tulis Use Case dalam Bahasa Domain

Contoh:

```text
Officer approves a pending enforcement case.
System validates authority, ensures the case is in a reviewable state,
records approval information, persists the decision, emits audit event,
and notifies interested parties.
```

---

### Step 2 — Identifikasi Noun dan Verb

Noun:

- Officer
- EnforcementCase
- CaseStatus
- ApprovalInfo
- ApprovalRemarks
- Authority
- AuditEvent
- Notification

Verb:

- approve
- validate authority
- transition state
- record approval
- persist
- emit
- notify

---

### Step 3 — Bedakan Domain Decision dan Technical Action

Domain decision:

- apakah officer boleh approve;
- apakah case bisa diapprove;
- transisi status valid;
- approval information valid.

Technical action:

- load dari database;
- save ke database;
- publish event;
- send notification;
- write audit;
- open transaction.

Domain decision jangan tenggelam di technical action.

---

### Step 4 — Tentukan Object Owner

| Responsibility | Owner Candidate |
|---|---|
| Validasi status transition | `EnforcementCase` atau `CaseStateMachine` |
| Validasi authority | `ApprovalPolicy` / `OfficerAuthority` |
| Approval mutation | `EnforcementCase` |
| Persist case | `CaseRepository` |
| Publish audit | `AuditPublisher` |
| Notify applicant | Event handler / notification service |
| Orchestrate use case | `ApproveCaseUseCase` |

---

### Step 5 — Tentukan Boundary

```text
API boundary       : ApproveCaseRequest
Application boundary: ApproveCaseCommand
Domain boundary    : EnforcementCase, ApprovalPolicy
Persistence boundary: CaseRepository
Integration boundary: NotificationGateway, AuditPublisher
```

---

### Step 6 — Tulis Contract Dulu

```java
public record ApproveCaseCommand(
    CaseId caseId,
    OfficerId officerId,
    ApprovalRemarks remarks
) { }
```

```java
public interface ApprovalPolicy {
    ApprovalDecision evaluate(Officer officer, EnforcementCase enforcementCase, Instant now);
}
```

```java
public interface CaseRepository {
    Optional<EnforcementCase> findById(CaseId id);
    void save(EnforcementCase enforcementCase);
}
```

---

### Step 7 — Implementasi Use Case

```java
public final class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final ApprovalPolicy approvalPolicy;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    public ApproveCaseUseCase(
        CaseRepository caseRepository,
        OfficerRepository officerRepository,
        ApprovalPolicy approvalPolicy,
        DomainEventPublisher eventPublisher,
        Clock clock
    ) {
        this.caseRepository = Objects.requireNonNull(caseRepository);
        this.officerRepository = Objects.requireNonNull(officerRepository);
        this.approvalPolicy = Objects.requireNonNull(approvalPolicy);
        this.eventPublisher = Objects.requireNonNull(eventPublisher);
        this.clock = Objects.requireNonNull(clock);
    }

    public void handle(ApproveCaseCommand command) {
        EnforcementCase enforcementCase = caseRepository.findById(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        Officer officer = officerRepository.findById(command.officerId())
            .orElseThrow(() -> new OfficerNotFoundException(command.officerId()));

        ApprovalDecision decision = approvalPolicy.evaluate(
            officer,
            enforcementCase,
            Instant.now(clock)
        );

        enforcementCase.approve(decision, command.remarks());

        caseRepository.save(enforcementCase);
        eventPublisher.publish(CaseApproved.from(enforcementCase));
    }
}
```

---

### Step 8 — Review Design Force

Tanyakan:

```text
Jika approval policy berubah, file apa yang berubah?
Jika persistence berubah, file apa yang berubah?
Jika notification berubah, apakah use case berubah?
Jika status lifecycle bertambah, apakah logic tersebar?
Jika audit requirement berubah, apakah domain rusak?
Jika test dibuat, apakah perlu mock terlalu banyak?
```

---

## 21. Anti-Pattern: Pattern Thinking Tanpa Object Thinking

Banyak codebase memakai pattern tetapi tetap buruk.

---

### 21.1 Strategy yang Tidak Menyelesaikan Coupling

```java
public interface ApprovalStrategy {
    void approve(CaseEntity c);
}

public class NormalApprovalStrategy implements ApprovalStrategy {
    public void approve(CaseEntity c) {
        c.setStatus("APPROVED");
    }
}
```

Masalah:

- status masih string;
- invariant tidak jelas;
- strategy hanya memindahkan setter;
- tidak ada policy nyata;
- coupling ke entity tetap bocor.

Pattern tidak otomatis memperbaiki desain.

---

### 21.2 Factory yang Menyembunyikan Dependency Buruk

```java
public class ServiceFactory {
    public static CaseService create() {
        return new CaseService(
            new CaseRepositoryImpl(),
            new EmailService(),
            new AuditService()
        );
    }
}
```

Ini bukan desain baik jika hanya menyembunyikan construction chaos.

---

### 21.3 Repository yang Bocor

```java
public interface CaseRepository {
    EntityManager entityManager();
}
```

Jika caller bisa mengambil `EntityManager`, abstraction repository runtuh.

---

### 21.4 DTO sebagai Universal Model

```java
public class CaseDto {
    public Long id;
    public String status;
    public String applicantEmail;
    public String officerName;
    public String internalRiskScore;
    public String databaseVersion;
}
```

Satu DTO dipakai untuk request, response, persistence, export, event, dan internal service.

Akibat:

- field sensitif mudah bocor;
- API contract sulit berubah;
- persistence concern masuk API;
- validation ambigu;
- backward compatibility kacau.

---

## 22. Testing Object Design

Desain object yang baik biasanya lebih mudah dites.

---

### 22.1 Test Domain Object Tanpa Framework

```java
@Test
void pendingReviewCaseCanBeApproved() {
    EnforcementCase enforcementCase = EnforcementCase.pendingReview(new CaseId(UUID.randomUUID()));
    ApprovalDecision decision = ApprovalDecision.approvedBy(new OfficerId(UUID.randomUUID()));

    enforcementCase.approve(decision, new ApprovalRemarks("Valid"));

    assertEquals(CaseStatus.APPROVED, enforcementCase.status());
}
```

Jika domain object hanya bisa dites dengan Spring context dan database, kemungkinan boundary terlalu bocor.

---

### 22.2 Test Policy Secara Terisolasi

```java
@Test
void officerCannotApproveCaseAboveGradeLimit() {
    ApprovalPolicy policy = new GradeBasedApprovalPolicy();

    Officer officer = Officer.withGrade(OfficerGrade.JUNIOR);
    EnforcementCase highRiskCase = EnforcementCase.withRiskLevel(RiskLevel.HIGH);

    ApprovalDecision decision = policy.evaluate(
        officer,
        highRiskCase,
        Instant.parse("2026-01-01T00:00:00Z")
    );

    assertTrue(decision.isRejected());
}
```

---

### 22.3 Test Application Service dengan Boundary Mock

Application service boleh dites dengan mock/fake repository, karena tugasnya orchestration.

```java
@Test
void approveCasePublishesEventAfterSaving() {
    FakeCaseRepository cases = new FakeCaseRepository();
    FakeOfficerRepository officers = new FakeOfficerRepository();
    CapturingEventPublisher events = new CapturingEventPublisher();

    ApproveCaseUseCase useCase = new ApproveCaseUseCase(
        cases,
        officers,
        new AllowAllApprovalPolicy(),
        events,
        Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)
    );

    useCase.handle(new ApproveCaseCommand(caseId, officerId, new ApprovalRemarks("OK")));

    assertTrue(events.contains(CaseApproved.class));
}
```

Test yang terlalu banyak mock sering menunjukkan collaboration graph terlalu rumit.

---

## 23. Observability dan Debuggability Angle

Object design juga memengaruhi kemampuan debugging.

---

### 23.1 Domain Event Lebih Mudah Diaudit daripada Setter

Buruk:

```java
case.setStatus(APPROVED);
```

Lebih informatif:

```java
case.approve(decision, remarks);
```

Lebih kuat lagi:

```java
case.pullDomainEvents(); // contains CaseApproved
```

Event memberi semantic trace.

---

### 23.2 Structured Decision Logging

Untuk policy penting:

```java
public record ApprovalEvaluationTrace(
    CaseId caseId,
    OfficerId officerId,
    boolean gradeAllowed,
    boolean delegationValid,
    boolean conflictOfInterestAbsent,
    ApprovalOutcome outcome
) { }
```

Jangan hanya log:

```text
Approval failed
```

Log harus menjawab:

```text
Decision apa yang dibuat?
Input domain apa yang relevan?
Rule mana yang gagal?
Apakah aman untuk audit?
Apakah mengandung PII?
```

---

## 24. Design Review Checklist

Gunakan checklist ini saat review class/module.

### 24.1 Responsibility

```text
[ ] Apakah class punya satu alasan perubahan utama?
[ ] Apakah nama class menjelaskan responsibility?
[ ] Apakah method berada di object yang paling tepat?
[ ] Apakah ada feature envy?
[ ] Apakah ada god service/object?
```

### 24.2 Identity dan Value

```text
[ ] Apakah entity dan value object dibedakan jelas?
[ ] Apakah id memakai type-safe identifier jika domain penting?
[ ] Apakah equality semantics benar?
[ ] Apakah value object immutable?
[ ] Apakah primitive obsession dikurangi?
```

### 24.3 Mutability

```text
[ ] Apakah mutable state dikontrol?
[ ] Apakah setter publik benar-benar diperlukan?
[ ] Apakah collection defensively copied?
[ ] Apakah mutation melewati domain operation?
[ ] Apakah object aman jika dishare antar thread?
```

### 24.4 Coupling

```text
[ ] Apakah dependency direction benar?
[ ] Apakah domain bergantung pada framework?
[ ] Apakah ada semantic coupling via magic string/number?
[ ] Apakah ada temporal coupling?
[ ] Apakah ada boolean flag yang mengontrol behavior?
```

### 24.5 Boundary

```text
[ ] Apakah API model, domain model, persistence model dipisah jika perlu?
[ ] Apakah external model tidak bocor ke domain?
[ ] Apakah package boundary jelas?
[ ] Apakah internal class tidak semuanya public?
[ ] Apakah interface punya alasan nyata?
```

### 24.6 Testability

```text
[ ] Apakah domain logic bisa dites tanpa framework?
[ ] Apakah application service bisa dites dengan fake boundary?
[ ] Apakah test butuh terlalu banyak mock?
[ ] Apakah waktu/randomness/infrastructure bisa dikontrol?
[ ] Apakah invariant punya test eksplisit?
```

---

## 25. Staff-Level Discussion Questions

Gunakan pertanyaan ini untuk melatih judgment:

1. Apakah anemic domain model selalu buruk?
2. Kapan transaction script lebih baik daripada rich domain model?
3. Apakah setiap repository perlu interface?
4. Kapan value object terlalu banyak dan mengganggu readability?
5. Kapan package-by-layer masih masuk akal?
6. Bagaimana membedakan domain service dan application service?
7. Apa tanda abstraction dibuat terlalu cepat?
8. Bagaimana mendesain object agar auditability kuat?
9. Bagaimana menghindari domain object bergantung pada framework?
10. Bagaimana menentukan apakah rule masuk entity, policy, specification, atau state machine?

---

## 26. Ringkasan Mental Model

Object design yang kuat selalu menanyakan:

```text
Apa identity-nya?
Apa value-nya?
Apa invariant-nya?
Apa lifecycle-nya?
Apa boundary-nya?
Apa alasan berubahnya?
Apa dependency yang boleh masuk?
Apa dependency yang harus dijauhkan?
Apa yang harus eksplisit?
Apa yang harus disembunyikan?
```

Design pattern hanya berguna jika menjawab pertanyaan tersebut.

Sebelum memilih pattern, pahami dulu:

```text
1. Object mana yang punya responsibility?
2. Rule mana yang harus dilindungi?
3. Perubahan mana yang perlu diisolasi?
4. Boundary mana yang sedang bocor?
5. Coupling mana yang membuat sistem mahal berubah?
6. Mutability mana yang membuat state tidak dapat dipercaya?
```

Top engineer tidak hanya tahu nama pattern. Mereka bisa membaca force di balik code.

---

## 27. Koneksi ke Part Berikutnya

Part ini menyiapkan fondasi untuk memahami SOLID secara lebih matang.

SOLID sering diajarkan sebagai lima aturan terpisah, tetapi pada level senior SOLID sebenarnya adalah cara mengendalikan:

- alasan perubahan;
- substitutability;
- dependency direction;
- interface pressure;
- extension surface;
- failure containment.

Bagian berikutnya:

```text
03-solid-revisited-failure-control-design-judgment.md
```

---

## Status Seri

```text
Part 2 dari 35 selesai.
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./01-java-8-to-25-pattern-evolution-modern-language-impact.md">⬅️ Java 8 to 25 Pattern Evolution: Modern Language Impact</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./03-solid-revisited-failure-control-design-judgment.md">SOLID Revisited: Failure Control and Design Judgment ➡️</a>
</div>
