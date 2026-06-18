# Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-014.md`  
> Target pembaca: engineer Java/Jakarta yang ingin memahami CDI event bukan hanya sebagai `event.fire(...)`, tetapi sebagai mekanisme runtime decoupling lokal yang punya konsekuensi lifecycle, transaction, ordering, observability, dan failure behavior.  
> Rentang versi: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`.

---

## 0. Posisi Part Ini Dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

1. container/runtime ownership model,
2. dependency graph,
3. bean discovery,
4. scopes dan context,
5. client proxy,
6. qualifier/alternative/priority,
7. producer/disposer.

Sekarang kita masuk ke salah satu fitur CDI yang sering terlihat sederhana tetapi mudah disalahgunakan: **CDI Events**.

CDI event adalah mekanisme untuk membuat satu komponen memberi tahu komponen lain bahwa sesuatu terjadi, tanpa komponen pengirim mengetahui siapa penerimanya.

Namun, kalimat itu bisa menyesatkan kalau tidak diberi batas.

CDI event **bukan message broker**.  
CDI event **bukan distributed event bus**.  
CDI event **bukan pengganti Kafka/RabbitMQ/JMS**.  
CDI event **bukan domain event architecture secara penuh**.  
CDI event adalah **local in-process event dispatch mechanism** di dalam CDI container.

Artinya:

```text
same JVM
same application/runtime boundary
same deployment context
same CDI container
same process memory
```

Ia sangat berguna untuk decoupling internal, lifecycle hook, local extension point, audit hook, cache invalidation, local notification, dan clean separation antar komponen dalam satu runtime. Tetapi kalau dipakai untuk workflow kritikal lintas service, delivery guarantee, replay, outbox, atau integration event antar sistem, ia tidak cukup.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan mental model CDI event sebagai **typed local event dispatch**.
2. Membedakan event payload, qualifier, observer, producer, synchronous fire, asynchronous fire, dan transactional observer.
3. Mendesain event internal yang tidak berubah menjadi invisible spaghetti.
4. Menentukan kapan CDI event cocok dan kapan harus memakai direct call, decorator, interceptor, message broker, outbox, atau workflow engine.
5. Membaca failure behavior event:
   - exception propagation,
   - observer ordering,
   - transaction phase,
   - async completion,
   - missing observer,
   - scope/context issue.
6. Menggunakan CDI event untuk use case enterprise seperti audit local, cache invalidation, notification hook, internal extension point, dan feature-dependent reaction.
7. Menghindari anti-pattern event-driven architecture palsu di dalam satu monolith/container.

---

## 2. Masalah Yang Diselesaikan CDI Event

Bayangkan sebuah service:

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject AuditTrailService auditTrailService;
    @Inject NotificationService notificationService;
    @Inject CaseSearchIndexService searchIndexService;
    @Inject MetricsService metricsService;

    public void approve(CaseId caseId, OfficerId officerId) {
        // 1. validate
        // 2. update case state
        // 3. insert audit
        // 4. send notification
        // 5. update search index
        // 6. record metric
    }
}
```

Secara fungsional, ini bekerja. Tetapi ada beberapa masalah desain.

Pertama, `CaseApprovalService` menjadi tahu terlalu banyak efek samping. Ia tidak hanya mengurus approval, tetapi juga audit, notification, indexing, metrics, dan mungkin nanti rule lain.

Kedua, setiap tambahan efek samping akan memodifikasi service utama.

Ketiga, dependency graph membesar.

Keempat, urutan dan failure behavior menjadi tercampur dengan domain operation.

Kelima, testing approval menjadi berat karena semua side-effect dependency harus disediakan.

CDI event menawarkan alternatif:

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject Event<CaseApproved> caseApprovedEvent;

    public void approve(CaseId caseId, OfficerId officerId) {
        // 1. validate
        // 2. update case state

        caseApprovedEvent.fire(new CaseApproved(caseId, officerId, Instant.now()));
    }
}
```

Lalu observer terpisah:

```java
@ApplicationScoped
public class AuditOnCaseApproved {

    @Inject AuditTrailService auditTrailService;

    public void onCaseApproved(@Observes CaseApproved event) {
        auditTrailService.recordCaseApproved(event.caseId(), event.officerId(), event.occurredAt());
    }
}
```

```java
@ApplicationScoped
public class NotificationOnCaseApproved {

    @Inject NotificationService notificationService;

    public void onCaseApproved(@Observes CaseApproved event) {
        notificationService.notifyApplicant(event.caseId());
    }
}
```

Sekarang service utama tidak tahu siapa saja yang bereaksi.

Tetapi trade-off muncul: alur program menjadi kurang eksplisit. Engineer yang membaca `approve()` hanya melihat event fired, bukan semua efek samping yang terjadi.

Jadi CDI event menyelesaikan coupling langsung, tetapi dapat menciptakan coupling implisit. Top engineer tidak hanya bertanya “bisa pakai event?”, tetapi:

```text
Apakah decoupling tambahan ini sepadan dengan visibility yang hilang?
```

---

## 3. Mental Model Besar

CDI event terdiri dari empat elemen utama:

```text
┌───────────────┐
│ Event Payload │  object yang merepresentasikan kejadian
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Event.fire()  │  pengirim event melalui CDI Event<T>
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Resolution    │  container mencari observer berdasarkan type + qualifier
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Observer(s)   │  method yang menerima event dengan @Observes / @ObservesAsync
└───────────────┘
```

Versi lebih akurat:

```text
Event identity = payload type + event qualifiers

Observer eligibility = observer parameter type assignable from payload type
                    + observer qualifiers match event qualifiers
                    + bean/archive discoverable
                    + observer method valid
```

CDI event bukan string topic seperti:

```text
"case.approved"
```

CDI event adalah type-safe:

```java
record CaseApproved(CaseId caseId, OfficerId officerId, Instant occurredAt) {}
```

Lalu qualifier bisa menambah dimensi routing:

```java
@Regulatory
Event<CaseApproved> event;
```

Observer:

```java
public void observe(@Observes @Regulatory CaseApproved event) {
    ...
}
```

Jadi mental modelnya bukan “publish string topic”, tetapi:

```text
publish typed object with qualifier metadata
```

---

## 4. CDI Event Bukan Dependency Injection Biasa

Pada DI biasa, satu injection point meminta satu atau banyak bean:

```java
@Inject PaymentGateway gateway;
```

Container menjawab:

```text
Injection point ini butuh bean type PaymentGateway + qualifier @Default.
Cari satu bean yang cocok.
```

Pada CDI event:

```java
@Inject Event<PaymentCaptured> event;
```

`Event<PaymentCaptured>` bukan dependency bisnis biasa. Ia adalah **handle** dari container untuk melakukan event dispatch.

Ketika kamu memanggil:

```java
event.fire(new PaymentCaptured(...));
```

container menjawab:

```text
Ada event payload PaymentCaptured dengan qualifier tertentu.
Cari semua observer yang cocok.
Panggil mereka sesuai aturan event dispatch.
```

Perbedaannya:

| Aspek | DI Biasa | CDI Event |
|---|---|---|
| Tujuan | memperoleh dependency | memberi tahu kejadian |
| Arah | caller -> callee spesifik | publisher -> unknown observers |
| Jumlah target | biasanya satu | nol, satu, atau banyak |
| Coupling | explicit dependency | implicit event contract |
| Failure visibility | langsung terlihat | bisa tersebar di observer |
| Cocok untuk | capability yang dibutuhkan | reaction terhadap sesuatu yang sudah terjadi |

Rule penting:

```text
Kalau caller membutuhkan hasil dari dependency untuk menyelesaikan operasi utama, gunakan direct dependency.
Kalau caller hanya mengumumkan kejadian yang sudah terjadi, event bisa cocok.
```

Contoh salah:

```java
@Inject Event<ValidateCaseRequest> validationEvent;

public void submit(CaseDraft draft) {
    validationEvent.fire(new ValidateCaseRequest(draft));
    // berharap observer mengubah state agar valid
}
```

Ini buruk karena operasi utama bergantung pada efek samping tersembunyi.

Lebih baik:

```java
@Inject CaseSubmissionValidator validator;

public void submit(CaseDraft draft) {
    validator.validate(draft);
    ...
}
```

Event boleh dipakai setelah submit berhasil:

```java
submittedEvent.fire(new CaseSubmitted(caseId, submittedBy, occurredAt));
```

---

## 5. Vocabulary CDI Event

### 5.1 Event Payload

Payload adalah object yang dikirim.

Contoh modern Java:

```java
public record CaseApproved(
        CaseId caseId,
        OfficerId approvedBy,
        Instant occurredAt
) {}
```

Untuk Java 8:

```java
public final class CaseApproved {
    private final CaseId caseId;
    private final OfficerId approvedBy;
    private final Instant occurredAt;

    public CaseApproved(CaseId caseId, OfficerId approvedBy, Instant occurredAt) {
        this.caseId = Objects.requireNonNull(caseId);
        this.approvedBy = Objects.requireNonNull(approvedBy);
        this.occurredAt = Objects.requireNonNull(occurredAt);
    }

    public CaseId getCaseId() {
        return caseId;
    }

    public OfficerId getApprovedBy() {
        return approvedBy;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
```

Payload sebaiknya:

1. immutable,
2. memiliki nama past-tense untuk kejadian yang sudah terjadi,
3. tidak membawa entity managed JPA secara sembarangan,
4. tidak membawa object request/session scoped yang berbahaya,
5. tidak membawa service dependency,
6. tidak menjadi god event.

Nama yang baik:

```text
CaseApproved
AppealSubmitted
DocumentUploaded
ApplicationWithdrawn
UserSessionTerminated
RiskScoreCalculated
```

Nama yang buruk:

```text
ProcessCaseEvent
DoNotificationEvent
CaseEvent
ActionEvent
ServiceEvent
UpdateEverythingEvent
```

Past-tense penting karena event seharusnya mewakili fakta yang sudah terjadi, bukan command.

```text
Command: ApproveCase
Event  : CaseApproved
```

Kalau event bernama `ApproveCaseEvent`, itu sering menandakan kamu memakai event sebagai command bus tersembunyi.

---

### 5.2 Event Producer

Producer di sini bukan CDI producer method. Producer event berarti class yang memanggil `fire()`.

```java
@Inject
Event<CaseApproved> caseApproved;

public void approve(CaseId id) {
    ...
    caseApproved.fire(new CaseApproved(id, officerId, clock.instant()));
}
```

CDI menyediakan built-in bean `Event<T>` yang dapat di-inject.

---

### 5.3 Observer Method

Observer method adalah method yang memiliki parameter event dengan annotation `@Observes`.

```java
public void onCaseApproved(@Observes CaseApproved event) {
    ...
}
```

Observer method harus berada pada bean yang discoverable oleh container.

Artinya, class ini harus menjadi bean CDI/EJB yang valid menurut discovery rules.

```java
@ApplicationScoped
public class AuditObserver {
    public void onCaseApproved(@Observes CaseApproved event) {
        ...
    }
}
```

Kalau class tidak discoverable, observer tidak akan dipanggil.

---

### 5.4 Event Qualifier

Qualifier membedakan event dengan payload type yang sama.

Misalnya ada event `DocumentUploaded`, tetapi berbeda konteks:

```text
internal document upload
external citizen upload
migration upload
```

Qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({FIELD, PARAMETER, METHOD, TYPE})
public @interface ExternalUpload {}
```

Event:

```java
@Inject
@ExternalUpload
Event<DocumentUploaded> uploaded;

uploaded.fire(new DocumentUploaded(documentId, uploadedBy, occurredAt));
```

Observer:

```java
public void audit(@Observes @ExternalUpload DocumentUploaded event) {
    ...
}
```

Event qualifier adalah routing metadata.

---

### 5.5 Synchronous Event

Synchronous event dipanggil dengan:

```java
event.fire(payload);
```

Secara mental:

```text
caller thread
    -> fire event
        -> invoke observer A
        -> invoke observer B
        -> invoke observer C
    -> return to caller
```

Synchronous event bukan fire-and-forget. Caller menunggu observer selesai.

---

### 5.6 Asynchronous Event

Asynchronous event dipanggil dengan:

```java
CompletionStage<CaseApproved> stage = event.fireAsync(payload);
```

Observer menggunakan `@ObservesAsync`:

```java
public void onCaseApproved(@ObservesAsync CaseApproved event) {
    ...
}
```

Mental model:

```text
caller thread
    -> fireAsync event
    -> returns CompletionStage

container-managed async execution
    -> invoke async observers
```

Asynchronous event bukan replacement untuk message broker. Ia tetap local process mechanism.

---

### 5.7 Transactional Observer

Transactional observer adalah observer yang dipanggil pada fase transaction tertentu.

```java
public void afterSuccess(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    ...
}
```

Fase utama:

```text
IN_PROGRESS       -> observer biasa ketika event fired
BEFORE_COMPLETION -> sebelum transaction completion
AFTER_COMPLETION  -> setelah transaction selesai, sukses atau gagal
AFTER_SUCCESS     -> setelah transaction sukses commit
AFTER_FAILURE     -> setelah transaction gagal/rollback
```

Transactional observer penting untuk menghindari efek samping eksternal sebelum commit.

Contoh:

```java
public void notifyApplicant(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    notificationService.notifyApplicant(event.caseId());
}
```

Kalau approval rollback, notification tidak terkirim.

---

## 6. Synchronous Event: Detail Semantics

Contoh:

```java
@ApplicationScoped
public class CaseService {

    @Inject Event<CaseApproved> caseApproved;

    @Transactional
    public void approve(CaseId caseId) {
        updateCaseStatus(caseId, APPROVED);
        caseApproved.fire(new CaseApproved(caseId, currentOfficer(), Instant.now()));
        writeCompletionLog(caseId);
    }
}
```

Observer:

```java
@ApplicationScoped
public class CaseAuditObserver {

    public void audit(@Observes CaseApproved event) {
        auditRepository.insert(...);
    }
}
```

Pada synchronous observer biasa, observer dipanggil saat `fire()` berjalan.

Urutan mental:

```text
approve()
  updateCaseStatus()
  fire(CaseApproved)
    observer audit()
    observer metrics()
    observer searchIndex()
  writeCompletionLog()
return
```

Konsekuensi:

1. Observer berjalan di thread yang sama.
2. Observer dapat ikut transaction context yang sama, tergantung integrasi Jakarta EE/runtime.
3. Exception dari observer dapat memengaruhi caller.
4. Caller latency bertambah oleh observer.
5. Observer lambat membuat operation lambat.

Synchronous CDI event cocok ketika:

1. reaction harus terjadi segera,
2. caller boleh gagal jika observer gagal,
3. efek samping masih bagian dari local consistency,
4. jumlah observer terkendali,
5. durasi observer pendek.

Tidak cocok ketika:

1. observer melakukan HTTP call lambat,
2. observer melakukan email eksternal,
3. observer melakukan long-running task,
4. caller tidak boleh terganggu observer,
5. butuh retry durable,
6. butuh replay.

---

## 7. Exception Behavior

Dalam synchronous event, exception dari observer pada umumnya akan keluar ke caller.

Contoh:

```java
public void audit(@Observes CaseApproved event) {
    throw new IllegalStateException("audit failed");
}
```

Caller:

```java
caseApproved.fire(new CaseApproved(...));
```

Secara praktis, `fire()` bisa gagal.

Ini punya implikasi besar:

```text
Event bukan mekanisme aman otomatis.
Observer bisa membuat publisher gagal.
```

Untuk operasi transactional:

```java
@Transactional
public void approve(CaseId caseId) {
    updateCase(caseId);
    caseApproved.fire(new CaseApproved(caseId));
}
```

Kalau observer melempar unchecked exception, transaction bisa rollback tergantung transaction/interceptor rules.

Jadi desain harus eksplisit:

```text
Apakah observer failure harus menggagalkan operation utama?
```

Jika iya, synchronous observer biasa mungkin tepat.

Jika tidak, pertimbangkan:

1. `AFTER_SUCCESS` transactional observer,
2. async event dengan error handling,
3. outbox pattern,
4. queue/message broker,
5. explicit try/catch di observer dengan observability.

Contoh observer yang tidak boleh menggagalkan operasi utama:

```java
@ApplicationScoped
public class MetricsObserver {

    private static final Logger log = Logger.getLogger(MetricsObserver.class.getName());

    @Inject MetricsService metrics;

    public void record(@Observes CaseApproved event) {
        try {
            metrics.increment("case.approved");
        } catch (RuntimeException ex) {
            log.log(Level.WARNING, "Failed to record metric for case " + event.caseId(), ex);
        }
    }
}
```

Tapi hati-hati: menelan exception tanpa alarm menciptakan silent failure.

---

## 8. Observer Ordering

Salah satu jebakan CDI event adalah menganggap observer punya urutan bisnis yang stabil.

Contoh buruk:

```java
public void first(@Observes CaseApproved event) {
    // create audit row
}

public void second(@Observes CaseApproved event) {
    // read audit row created by first
}
```

Ini buruk karena observer saling bergantung lewat urutan implisit.

Rule desain:

```text
Observer CDI harus sebisa mungkin independen.
Jangan desain workflow bisnis yang bergantung pada urutan observer.
```

Jika perlu urutan jelas:

Gunakan direct orchestration:

```java
public void approve(CaseId caseId) {
    approvalPolicy.check(caseId);
    approvalRepository.approve(caseId);
    auditWriter.writeApproval(caseId);
    notificationScheduler.schedule(caseId);
}
```

Atau workflow/state machine.

CDI event adalah untuk reaction, bukan orchestration sequence.

---

## 9. Observer Resolution: Type + Qualifier

Event payload:

```java
public record CaseApproved(CaseId caseId) {}
```

Observer:

```java
public void observeExact(@Observes CaseApproved event) {}
```

Kalau fire:

```java
event.fire(new CaseApproved(caseId));
```

Observer cocok.

Tetapi observer bisa juga memakai supertype:

```java
public interface DomainEvent {}

public record CaseApproved(CaseId caseId) implements DomainEvent {}
```

Observer:

```java
public void observeAnyDomainEvent(@Observes DomainEvent event) {}
```

Ini bisa menerima berbagai event domain.

Namun hati-hati.

Observer supertype mudah menjadi god observer:

```java
public void observeEverything(@Observes Object event) {
    ...
}
```

Ini hampir selalu buruk karena terlalu luas dan membuat behavior sulit dilacak.

Gunakan supertype observer hanya untuk cross-cutting yang benar-benar umum, misalnya telemetry/audit envelope, dan tetap batasi dengan qualifier.

---

## 10. Qualifier Pada Event

Qualifier CDI untuk event bekerja seperti qualifier pada injection: ia mempersempit matching.

Definisi qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface Internal {}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface External {}
```

Producer:

```java
@Inject @Internal
Event<DocumentUploaded> internalUpload;

@Inject @External
Event<DocumentUploaded> externalUpload;
```

Fire:

```java
internalUpload.fire(new DocumentUploaded(documentId));
externalUpload.fire(new DocumentUploaded(documentId));
```

Observer:

```java
public void onInternal(@Observes @Internal DocumentUploaded event) {
    ...
}

public void onExternal(@Observes @External DocumentUploaded event) {
    ...
}
```

Qualifier membuat type event tetap domain-relevant, tetapi routing tetap spesifik.

---

## 11. Dynamic Qualifier Selection

CDI `Event<T>` memiliki kemampuan memilih qualifier secara programmatic.

Misalnya:

```java
@Inject
@Any
Event<DocumentUploaded> uploadedEvent;
```

Lalu:

```java
uploadedEvent.select(new ExternalLiteral()).fire(payload);
```

Untuk qualifier literal, CDI menyediakan pattern `AnnotationLiteral`.

Contoh:

```java
public class ExternalLiteral extends AnnotationLiteral<External> implements External {
    public static final External INSTANCE = new ExternalLiteral();
}
```

Pemakaian:

```java
uploadedEvent.select(ExternalLiteral.INSTANCE).fire(payload);
```

Dynamic selection berguna ketika routing ditentukan oleh runtime condition.

Namun, jangan terlalu sering memakai dynamic qualifier untuk menyembunyikan logic kompleks. Kalau routing event menjadi bisnis utama, buat model eksplisit.

---

## 12. Qualifier Dengan Member

Qualifier dapat memiliki member:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD })
public @interface Channel {
    String value();
}
```

Observer:

```java
public void onEmail(@Observes @Channel("email") NotificationRequested event) {
    ...
}

public void onSms(@Observes @Channel("sms") NotificationRequested event) {
    ...
}
```

Dynamic literal:

```java
public final class ChannelLiteral extends AnnotationLiteral<Channel> implements Channel {
    private final String value;

    public ChannelLiteral(String value) {
        this.value = value;
    }

    @Override
    public String value() {
        return value;
    }
}
```

Fire:

```java
notificationEvent
    .select(new ChannelLiteral("email"))
    .fire(new NotificationRequested(...));
```

Hati-hati: qualifier member menjadi bagian dari routing identity kecuali ditandai `@Nonbinding`.

Gunakan member qualifier ketika variasinya terbatas dan benar-benar bagian dari metadata event. Jangan gunakan untuk data bisnis bebas seperti `caseId`, `userId`, atau `tenantId`.

Salah:

```java
@Qualifier
public @interface CaseRoute {
    String caseId(); // buruk sebagai qualifier
}
```

Benar:

```java
record CaseApproved(CaseId caseId, AgencyId agencyId) {}
```

Data bisnis masuk payload, bukan qualifier.

---

## 13. Event Payload Design

Event payload adalah kontrak antar komponen. Desainnya harus stabil.

### 13.1 Event Harus Immutable

Java 17+:

```java
public record ApplicationSubmitted(
        ApplicationId applicationId,
        ApplicantId applicantId,
        OfficerId submittedBy,
        Instant submittedAt
) {}
```

Java 8:

```java
public final class ApplicationSubmitted {
    private final ApplicationId applicationId;
    private final ApplicantId applicantId;
    private final OfficerId submittedBy;
    private final Instant submittedAt;

    public ApplicationSubmitted(
            ApplicationId applicationId,
            ApplicantId applicantId,
            OfficerId submittedBy,
            Instant submittedAt
    ) {
        this.applicationId = Objects.requireNonNull(applicationId);
        this.applicantId = Objects.requireNonNull(applicantId);
        this.submittedBy = Objects.requireNonNull(submittedBy);
        this.submittedAt = Objects.requireNonNull(submittedAt);
    }

    public ApplicationId applicationId() { return applicationId; }
    public ApplicantId applicantId() { return applicantId; }
    public OfficerId submittedBy() { return submittedBy; }
    public Instant submittedAt() { return submittedAt; }
}
```

Mutable event payload buruk karena observer A bisa mengubah payload dan observer B menerima state berbeda.

```java
public class BadEvent {
    public String status;
}
```

Jangan.

---

### 13.2 Jangan Bawa Entity Managed Sembarangan

Buruk:

```java
record CaseApproved(CaseEntity caseEntity) {}
```

Masalah:

1. Observer mungkin berjalan di fase transaction berbeda.
2. Entity bisa lazy-loaded di context yang tidak aktif.
3. Observer bisa memutasi entity tanpa jelas.
4. Event menjadi coupling ke persistence model.
5. Serialization/debugging lebih sulit.

Lebih baik:

```java
record CaseApproved(
        CaseId caseId,
        String caseReferenceNo,
        OfficerId approvedBy,
        Instant approvedAt
) {}
```

Jika observer butuh detail tambahan, ia bisa load sendiri dengan dependency yang jelas.

---

### 13.3 Jangan Bawa Service Dalam Payload

Buruk:

```java
record CaseApproved(CaseId caseId, CaseRepository repository) {}
```

Event payload bukan dependency carrier.

---

### 13.4 Hindari God Event

Buruk:

```java
record CaseChanged(
        CaseId caseId,
        String oldStatus,
        String newStatus,
        String action,
        Map<String, Object> data
) {}
```

Kadang berguna untuk audit generic, tetapi buruk untuk domain reaction yang spesifik.

Lebih baik:

```java
record CaseApproved(...) {}
record CaseRejected(...) {}
record CaseReopened(...) {}
record CaseWithdrawn(...) {}
```

Event spesifik membuat observer lebih jelas.

---

## 14. Events vs Direct Method Call

Gunakan direct call ketika:

1. Caller membutuhkan hasil.
2. Caller harus tahu failure callee.
3. Urutan penting.
4. Operasi adalah bagian dari use case utama.
5. Contract hanya satu target.

Contoh:

```java
EligibilityResult result = eligibilityService.evaluate(applicationId);
```

Jangan jadikan event:

```java
eligibilityEvent.fire(new EvaluateEligibility(applicationId));
```

Itu command disguised as event.

Gunakan event ketika:

1. Sesuatu sudah terjadi.
2. Ada nol/satu/banyak reaction.
3. Publisher tidak perlu tahu observer.
4. Observer bisa ditambah/dihapus tanpa mengubah publisher.
5. Reaction bukan inti orchestration utama.

Contoh:

```java
applicationSubmitted.fire(new ApplicationSubmitted(applicationId, applicantId, now));
```

---

## 15. Events vs Interceptor

Interceptor cocok untuk cross-cutting behavior di sekitar method invocation.

Contoh:

```java
@Audited
public void approve(CaseId caseId) {
    ...
}
```

Interceptor:

```text
before method
method invocation
 after method / exception
```

CDI event cocok untuk reaction terhadap kejadian domain.

```java
caseApproved.fire(new CaseApproved(caseId));
```

Perbandingan:

| Aspek | Event | Interceptor |
|---|---|---|
| Trigger | explicit `fire()` | method annotation/proxy invocation |
| Semantik | sesuatu terjadi | bungkus eksekusi method |
| Target | observer banyak | satu chain interceptor |
| Cocok untuk | domain reaction | logging, transaction, metrics, auth, retry |
| Visibility | event type | annotation pada method/class |
| Ordering | tidak untuk workflow | chain bisa diatur via priority |

Jika ingin audit semua method dengan pola seragam, interceptor lebih cocok.

Jika ingin bereaksi terhadap `CaseApproved`, event lebih cocok.

---

## 16. Events vs Decorator

Decorator membungkus business interface tertentu.

```java
public interface CaseApprovalUseCase {
    void approve(CaseId caseId);
}
```

Decorator:

```java
@Decorator
public class ComplianceCaseApprovalDecorator implements CaseApprovalUseCase {

    @Inject
    @Delegate
    CaseApprovalUseCase delegate;

    @Override
    public void approve(CaseId caseId) {
        compliancePolicy.check(caseId);
        delegate.approve(caseId);
    }
}
```

Decorator cocok ketika behavior masih melekat pada contract interface.

Event cocok ketika behavior adalah reaction setelah kejadian.

Rule:

```text
Jika behavior harus selalu terjadi sebagai bagian dari contract, gunakan decorator/interceptor/direct call.
Jika behavior adalah subscriber/reaction opsional terhadap fakta, gunakan event.
```

---

## 17. Events vs Message Broker

CDI event local:

```text
same JVM
same process
same memory
not durable
not replayable
not cross-service
not cross-language
```

Message broker:

```text
cross process
cross service
durable option
retry option
consumer group
backpressure
replay depending platform
operational infrastructure
```

Perbandingan:

| Aspek | CDI Event | Broker/JMS/Kafka/RabbitMQ |
|---|---|---|
| Boundary | in-process | distributed/inter-process |
| Durability | no | possible |
| Retry | manual/limited | platform/application pattern |
| Replay | no | possible depending broker |
| Latency | low | higher |
| Operational cost | low | higher |
| Failure isolation | low | higher |
| Observability | must build | broker tooling available |
| Use case | local decoupling | integration event/work queue |

Jangan kirim email penting, integrasi pembayaran, atau workflow lintas sistem hanya mengandalkan CDI event synchronous/async.

Untuk critical external side effect, pertimbangkan outbox:

```text
transaction update business data
transaction insert outbox row
commit
background publisher reads outbox
send to broker/external system
mark published
```

CDI event bisa dipakai untuk men-trigger local outbox writer, tetapi bukan pengganti outbox.

---

## 18. Events vs Domain Events

Domain event adalah konsep desain domain:

```text
A domain-significant fact that happened in the business model.
```

CDI event adalah mekanisme delivery lokal.

Keduanya bisa dipakai bersama, tapi tidak sama.

Contoh:

```java
record CaseApproved(CaseId caseId, OfficerId approvedBy, Instant approvedAt) {}
```

Ini bisa disebut domain event.

Dikirim via CDI:

```java
caseApprovedEvent.fire(new CaseApproved(...));
```

Namun domain event juga bisa disimpan di outbox, dikirim ke Kafka, atau diproses oleh workflow engine.

Jangan mengikat domain model terlalu kuat ke CDI API.

Buruk:

```java
public class CaseAggregate {
    @Inject Event<CaseApproved> events; // domain object tergantung CDI
}
```

Lebih baik:

```java
public class CaseAggregate {
    private final List<Object> domainEvents = new ArrayList<>();

    public void approve(OfficerId officerId, Instant now) {
        ...
        domainEvents.add(new CaseApproved(id, officerId, now));
    }

    public List<Object> pullDomainEvents() {
        var copy = List.copyOf(domainEvents);
        domainEvents.clear();
        return copy;
    }
}
```

Application service mem-publish:

```java
for (Object domainEvent : aggregate.pullDomainEvents()) {
    domainEventPublisher.publish(domainEvent);
}
```

`domainEventPublisher` dapat diimplementasikan dengan CDI event, outbox, atau broker.

---

## 19. Transactional Observers Deep Dive

Masalah umum:

```java
@Transactional
public void approve(CaseId caseId) {
    caseRepository.approve(caseId);
    caseApproved.fire(new CaseApproved(caseId));
}
```

Observer:

```java
public void sendEmail(@Observes CaseApproved event) {
    emailService.sendApprovalEmail(event.caseId());
}
```

Apa yang terjadi jika transaction rollback setelah email dikirim?

```text
Database: case tidak approved
Email   : applicant menerima approval email
```

Ini inconsistency.

Transactional observer membantu:

```java
public void sendEmail(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    emailService.sendApprovalEmail(event.caseId());
}
```

Sekarang observer dipanggil hanya setelah transaction sukses.

Tetapi ada nuance penting:

1. `AFTER_SUCCESS` bukan durable delivery.
2. Jika JVM mati setelah commit sebelum email terkirim, event hilang.
3. Jika email gagal, database sudah commit.
4. Tidak ada replay otomatis.
5. Untuk critical side effect, gunakan outbox.

Transactional observer cocok untuk local/low-criticality reaction setelah commit, misalnya:

1. clear local cache,
2. enqueue in-memory refresh,
3. metrics,
4. best-effort notification,
5. local audit extension jika audit bukan legal source of truth.

Untuk legally critical audit trail, lebih baik audit ditulis di transaction utama atau outbox/append-only log yang reliable.

---

## 20. TransactionPhase Semantics

### 20.1 IN_PROGRESS

Default observer.

```java
public void observe(@Observes CaseApproved event) {
    ...
}
```

Dipanggil saat event fired.

Cocok untuk:

1. local invariant enforcement yang memang harus menggagalkan operation,
2. local state update dalam transaction yang sama,
3. reaction cepat dan deterministic.

---

### 20.2 BEFORE_COMPLETION

```java
public void beforeCommit(
        @Observes(during = TransactionPhase.BEFORE_COMPLETION) CaseApproved event
) {
    ...
}
```

Dipanggil sebelum transaction completion.

Cocok untuk case tertentu yang harus terjadi sebelum commit, tetapi setelah operasi utama selesai.

Hati-hati: failure di fase ini bisa memengaruhi commit.

---

### 20.3 AFTER_COMPLETION

```java
public void afterCompletion(
        @Observes(during = TransactionPhase.AFTER_COMPLETION) CaseApproved event
) {
    ...
}
```

Dipanggil setelah transaction selesai, baik commit maupun rollback.

Cocok untuk cleanup local yang tidak peduli sukses/gagal, misalnya:

1. release marker,
2. logging completion,
3. diagnostic hook.

---

### 20.4 AFTER_SUCCESS

```java
public void afterCommit(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    ...
}
```

Dipanggil setelah transaction sukses.

Cocok untuk:

1. cache invalidation setelah commit,
2. index refresh setelah commit,
3. notification best effort,
4. local read model update.

---

### 20.5 AFTER_FAILURE

```java
public void afterRollback(
        @Observes(during = TransactionPhase.AFTER_FAILURE) CaseApproved event
) {
    ...
}
```

Dipanggil setelah transaction gagal/rollback.

Cocok untuk:

1. diagnostic,
2. compensating local cleanup,
3. metric rollback/failure.

---

## 21. Asynchronous Events Deep Dive

CDI async event:

```java
CompletionStage<CaseApproved> stage = event.fireAsync(new CaseApproved(...));
```

Observer:

```java
public void observe(@ObservesAsync CaseApproved event) {
    ...
}
```

Asynchronous event membuat publisher tidak perlu menunggu observer dalam thread yang sama, tetapi bukan berarti failure hilang.

Publisher menerima `CompletionStage`.

```java
event.fireAsync(payload)
     .whenComplete((result, throwable) -> {
         if (throwable != null) {
             log.log(Level.WARNING, "Async observer failed", throwable);
         }
     });
```

Jika kamu mengabaikan `CompletionStage`, kamu bisa kehilangan error.

Buruk:

```java
event.fireAsync(payload); // no observation of completion
```

Lebih baik:

```java
event.fireAsync(payload)
     .exceptionally(ex -> {
         log.log(Level.WARNING, "Failed to handle async event " + payload, ex);
         return payload;
     });
```

Namun untuk operasi penting, ini masih tidak durable.

---

## 22. Async Event dan Context

Async observer berjalan dalam eksekusi asynchronous yang dikelola container. Pertanyaan penting:

```text
Context apa yang aktif di observer async?
```

Jangan asumsikan request/session context dari caller selalu tersedia.

Buruk:

```java
@RequestScoped
public class CurrentRequestData {
    ...
}

@ApplicationScoped
public class AsyncObserver {
    @Inject CurrentRequestData requestData;

    public void observe(@ObservesAsync CaseApproved event) {
        // bisa gagal jika request context tidak aktif
        requestData.getCorrelationId();
    }
}
```

Lebih aman: bawa data penting dalam payload.

```java
record CaseApproved(
        CaseId caseId,
        OfficerId approvedBy,
        String correlationId,
        Instant approvedAt
) {}
```

Atau gunakan context propagation mechanism yang memang didesain untuk itu, misalnya MicroProfile Context Propagation pada runtime yang mendukung.

Rule:

```text
Async event payload harus cukup mandiri.
Jangan bergantung pada request-scoped state tersembunyi.
```

---

## 23. Observer Conditional Activation

Kadang observer hanya ingin aktif pada kondisi tertentu.

Contoh feature flag:

```java
@ApplicationScoped
public class NewSearchIndexObserver {

    @Inject FeatureFlagService flags;
    @Inject SearchIndexService index;

    public void onCaseApproved(@Observes CaseApproved event) {
        if (!flags.enabled("new-search-index")) {
            return;
        }

        index.updateCase(event.caseId());
    }
}
```

Ini sederhana, tetapi ada trade-off:

1. Observer tetap terdaftar.
2. Logic flag tersebar.
3. Sulit melihat dari luar observer aktif atau tidak.

Alternatif:

1. conditional bean registration vendor-specific,
2. alternative/profile selection,
3. producer selected strategy,
4. decorator/interceptor feature gate.

Untuk feature flag runtime dynamic, observer dengan guard sering acceptable.

Untuk environment/profile static, lebih baik pilih bean saat startup.

---

## 24. CDI Event Untuk Audit

Audit adalah contoh tricky.

### 24.1 Audit Best-Effort

Untuk audit operasional ringan:

```java
public void audit(@Observes CaseViewed event) {
    auditLog.info("case viewed: " + event.caseId());
}
```

Ini acceptable jika audit bukan legal source of truth.

### 24.2 Audit Legal / Regulatory

Untuk audit yang harus defensible:

```text
business update and audit record should be part of same consistency boundary
```

Lebih aman:

```java
@Transactional
public void approve(CaseId caseId) {
    caseRepository.approve(caseId);
    auditRepository.insertApprovalAudit(caseId, currentOfficer(), now);
}
```

Atau pakai outbox jika audit dikirim ke external append-only system.

CDI event bisa digunakan untuk memisahkan code, tetapi jangan mengaburkan guarantee.

Jika observer audit synchronous dan failure harus rollback operation, dokumentasikan dengan jelas.

```java
public void audit(@Observes CaseApproved event) {
    auditRepository.insert(...); // failure intentionally aborts transaction
}
```

Komentar arsitektural:

```java
// This observer is part of the transactional consistency boundary.
// Failure must abort the approval operation.
```

---

## 25. CDI Event Untuk Cache Invalidation

Case:

```java
@Transactional
public void updateCaseStatus(CaseId caseId, CaseStatus status) {
    caseRepository.updateStatus(caseId, status);
    caseChanged.fire(new CaseStatusChanged(caseId, status));
}
```

Observer:

```java
public void invalidate(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseStatusChanged event
) {
    cache.invalidate(event.caseId());
}
```

Mengapa `AFTER_SUCCESS`?

Karena cache sebaiknya invalidated setelah DB commit. Kalau transaction rollback tetapi cache sudah invalidated, biasanya masih aman tapi noisy. Kalau cache repopulate sebelum commit, bisa membaca state lama/inkonsisten.

Untuk distributed cache, CDI event lokal tidak cukup jika ada banyak node.

```text
Node A updates DB and fires CDI event.
Node A local cache invalidated.
Node B local cache tidak tahu.
```

Untuk cluster, butuh:

1. distributed cache invalidation,
2. broker,
3. database notification,
4. cache provider cluster feature,
5. polling/version strategy.

CDI event bisa menjadi local hook saja.

---

## 26. CDI Event Untuk Search Index Refresh

Search index update sering tidak harus blocking transaction utama.

Sederhana:

```java
public void updateIndex(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    searchIndex.update(event.caseId());
}
```

Risiko:

1. Jika update index gagal, DB sudah commit.
2. Tidak ada retry durable.
3. Index bisa stale.

Untuk index yang boleh eventually consistent dan bisa diperbaiki oleh scheduled reconciliation, ini acceptable.

Untuk index yang critical, pakai outbox/retry queue.

Pattern:

```text
CaseApproved AFTER_SUCCESS observer
    -> insert/release indexing job
    -> worker retries until success
    -> reconciliation job validates missing index
```

Jika insert indexing job harus durable, insert job dalam transaction utama atau outbox.

---

## 27. CDI Event Untuk Local Extension Point

CDI event sangat bagus untuk extension point lokal.

Contoh framework internal:

```java
record CaseLifecycleTransitioned(
        CaseId caseId,
        CaseState from,
        CaseState to,
        OfficerId actor,
        Instant occurredAt
) {}
```

Core engine:

```java
transitioned.fire(new CaseLifecycleTransitioned(id, oldState, newState, actor, now));
```

Module lain bisa observe:

```java
public void onTransition(@Observes CaseLifecycleTransitioned event) {
    if (event.to() == CaseState.REFERRED_TO_LEGAL) {
        legalQueue.createTask(event.caseId());
    }
}
```

Ini membuat modul tambahan bisa bereaksi tanpa core engine tahu semua modul.

Tetapi harus ada governance:

1. daftar event resmi,
2. dokumentasi semantic event,
3. ownership payload,
4. compatibility rule,
5. observability,
6. testing untuk observer penting.

---

## 28. Jangan Membuat Invisible Workflow

Anti-pattern:

```text
CaseSubmitted event
  observer A changes status to SCREENING
    fires ScreeningStarted event
      observer B calls external system
        fires ScreeningCompleted event
          observer C updates case
            fires CaseUpdated event
```

Ini tampak decoupled, tetapi workflow menjadi tersebar dan sulit diaudit.

Problem:

1. siapa pemilik alur?
2. bagaimana retry?
3. bagaimana rollback?
4. bagaimana melihat state saat gagal?
5. bagaimana test end-to-end?
6. bagaimana menjamin ordering?
7. bagaimana support production incident?

Untuk workflow bisnis kompleks, lebih baik:

1. explicit application service orchestration,
2. state machine,
3. BPMN/workflow engine,
4. saga/process manager,
5. durable job model.

CDI event boleh digunakan sebagai notification hook di sekitar workflow, bukan sebagai tulang punggung workflow kritikal.

---

## 29. Event Chaining

Event chaining berarti observer mem-fire event baru.

```java
public void onCaseApproved(@Observes CaseApproved event) {
    screeningRequested.fire(new ScreeningRequested(event.caseId()));
}
```

Ini tidak selalu salah, tetapi berbahaya jika tidak dikendalikan.

Gunakan event chaining hanya ketika:

1. chain pendek,
2. semantic jelas,
3. tidak ada cycle,
4. failure behavior terdokumentasi,
5. test integration ada,
6. observability cukup.

Hindari cycle:

```text
A observes EventX -> fires EventY
B observes EventY -> fires EventX
```

Ini bisa menjadi loop runtime.

Tambahkan guard jika perlu:

```java
record CaseReindexed(CaseId caseId, ReindexReason reason) {}
```

Dan hindari observer yang mem-fire event yang sama tanpa idempotency.

---

## 30. Idempotency Pada Observer

Observer event bisa terpanggil lebih dari sekali dalam beberapa desain, terutama jika event dipicu ulang oleh retry manual, scheduled reconciliation, atau event bridging.

Observer harus sering dibuat idempotent.

Contoh buruk:

```java
public void createTask(@Observes CaseApproved event) {
    taskRepository.insert(new Task(event.caseId(), "Notify applicant"));
}
```

Jika event fired dua kali, task dobel.

Lebih baik:

```java
public void createTask(@Observes CaseApproved event) {
    taskRepository.insertIfAbsent(
        TaskKey.of(event.caseId(), "NotifyApplicant"),
        () -> new Task(event.caseId(), "Notify applicant")
    );
}
```

Rule:

```text
Observer yang membuat side effect harus punya idempotency story.
```

Idempotency key bisa berupa:

```text
event type + aggregate id + transition id
case id + state version
business event id
outbox event id
```

Untuk sistem regulatory/case management, event id sering penting.

```java
record CaseApproved(
        UUID eventId,
        CaseId caseId,
        long caseVersion,
        OfficerId approvedBy,
        Instant approvedAt
) {}
```

---

## 31. Event Identity dan Correlation

Payload event sebaiknya membawa metadata minimal untuk tracing.

Contoh:

```java
record CaseApproved(
        UUID eventId,
        String correlationId,
        CaseId caseId,
        OfficerId approvedBy,
        Instant approvedAt
) {}
```

Metadata berguna untuk:

1. log correlation,
2. audit investigation,
3. duplicate detection,
4. debugging observer failure,
5. connecting request to side effects.

Namun jangan berlebihan membawa semua context.

Pisahkan:

```text
business facts -> payload utama
technical tracing -> metadata field
security/session object -> jangan dibawa mentah
```

---

## 32. Observability Event

CDI event tersembunyi jika tidak diobservasi dengan baik.

Minimal observability:

1. log event fired untuk event penting,
2. log observer start/end untuk observer penting,
3. correlation id,
4. duration observer,
5. failure count,
6. warning untuk async completion failure,
7. dashboard untuk side effects penting.

Contoh wrapper publisher:

```java
@ApplicationScoped
public class DomainEventPublisher {

    @Inject @Any Event<Object> events;
    @Inject Logger logger;

    public void publish(Object event) {
        logger.info(() -> "Publishing domain event: " + event.getClass().getName());
        events.fire(event);
    }
}
```

Tetapi `Event<Object>` terlalu luas untuk injection resolution jika dipakai sembarangan. Lebih baik wrapper punya method typed atau generic dengan disiplin.

```java
@ApplicationScoped
public class CaseEventPublisher {

    @Inject Event<CaseApproved> caseApproved;
    @Inject Event<CaseRejected> caseRejected;

    public void caseApproved(CaseApproved event) {
        log(event);
        caseApproved.fire(event);
    }

    public void caseRejected(CaseRejected event) {
        log(event);
        caseRejected.fire(event);
    }
}
```

Ini mengorbankan generic purity demi observability dan explicitness.

---

## 33. Testing CDI Events

### 33.1 Unit Test Publisher Tanpa Container

Untuk service utama, sebaiknya tidak selalu tergantung langsung ke `Event<T>` jika ingin pure unit test.

Buat port:

```java
public interface CaseDomainEvents {
    void caseApproved(CaseApproved event);
}
```

Service:

```java
@ApplicationScoped
public class CaseApprovalService {

    private final CaseDomainEvents events;

    @Inject
    public CaseApprovalService(CaseDomainEvents events) {
        this.events = events;
    }

    public void approve(CaseId caseId) {
        ...
        events.caseApproved(new CaseApproved(caseId, ...));
    }
}
```

CDI adapter:

```java
@ApplicationScoped
public class CdiCaseDomainEvents implements CaseDomainEvents {

    @Inject Event<CaseApproved> caseApproved;

    @Override
    public void caseApproved(CaseApproved event) {
        caseApproved.fire(event);
    }
}
```

Unit test bisa pakai fake:

```java
final class RecordingCaseDomainEvents implements CaseDomainEvents {
    final List<CaseApproved> approved = new ArrayList<>();

    @Override
    public void caseApproved(CaseApproved event) {
        approved.add(event);
    }
}
```

Ini menjaga domain/application logic tidak terlalu bergantung pada CDI API.

---

### 33.2 Container Test Observer

Untuk memastikan observer wiring berjalan, gunakan container test dengan Weld/Jakarta runtime sesuai stack.

Yang dites:

1. observer dipanggil,
2. qualifier matching benar,
3. transactional phase benar,
4. async completion failure ditangani,
5. alternative/test bean bekerja,
6. scope context aktif.

Testing observer tidak cukup dengan unit test method biasa jika masalahnya adalah discovery/resolution.

---

## 34. Event Contract Documentation

Untuk event penting, dokumentasikan:

```markdown
## Event: CaseApproved

Meaning:
- Fired after a case approval decision is persisted by CaseApprovalService.

Timing:
- Fired inside the approval transaction.

Recommended observer phase:
- Use AFTER_SUCCESS for external side effects.
- Use IN_PROGRESS only for side effects that must rollback approval on failure.

Payload:
- eventId
- correlationId
- caseId
- approvedBy
- approvedAt
- caseVersion

Guarantee:
- Local in-process CDI event only.
- No durable delivery.
- No cross-node delivery.
- Observer ordering must not be relied upon.

Known observers:
- AuditApprovalObserver
- CaseCacheInvalidationObserver
- SearchIndexRefreshObserver
```

Ini terdengar formal, tapi untuk enterprise/regulatory system, dokumentasi seperti ini mengurangi ambiguity ketika incident terjadi.

---

## 35. Common Failure Modes

### 35.1 Observer Tidak Dipanggil

Kemungkinan:

1. observer class bukan CDI bean,
2. bean archive tidak discoverable,
3. `beans.xml` salah mode,
4. qualifier tidak match,
5. payload type tidak assignable,
6. observer method invalid,
7. mixed `javax`/`jakarta`,
8. deployment module/classloader issue.

Checklist:

```text
Is observer class in bean archive?
Does it have bean-defining annotation?
Is beans.xml mode correct?
Are package namespaces consistent?
Are event qualifiers exactly matching?
Is observer parameter type correct?
Is observer method non-abstract and valid?
Are logs showing bean discovery?
```

---

### 35.2 Event Membuat Use Case Gagal

Penyebab:

1. synchronous observer throw exception,
2. observer lambat timeout,
3. observer melakukan external call,
4. observer ikut transaction dan menyebabkan rollback.

Solusi:

1. evaluasi apakah observer failure harus menggagalkan use case,
2. gunakan transactional observer `AFTER_SUCCESS`,
3. pindah ke outbox/broker,
4. tambahkan error handling dan observability,
5. pisahkan critical vs best-effort observers.

---

### 35.3 Observer Berjalan Terlalu Cepat Sebelum Commit

Contoh:

```java
public void index(@Observes CaseApproved event) {
    searchIndex.update(event.caseId());
}
```

Jika observer membaca DB sebelum commit, ia mungkin membaca state lama.

Solusi:

```java
public void index(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    searchIndex.update(event.caseId());
}
```

---

### 35.4 Async Observer Kehilangan Context

Penyebab:

1. request context tidak aktif,
2. security context tidak propagated,
3. ThreadLocal tidak ada di thread async,
4. transaction context tidak sesuai.

Solusi:

1. bawa data penting di payload,
2. gunakan managed context propagation bila tersedia,
3. jangan bergantung pada request-scoped bean di async observer,
4. buat async observer stateless/idempotent.

---

### 35.5 Event Menjadi Hidden Workflow

Gejala:

1. sulit menjawab “apa yang terjadi setelah approval?”,
2. observer saling mem-fire event,
3. urutan implicit,
4. test rapuh,
5. production debugging lambat.

Solusi:

1. pindahkan workflow ke orchestrator/state machine,
2. gunakan event hanya untuk notification hook,
3. dokumentasikan event contract,
4. log event chain,
5. batasi event chaining.

---

## 36. Design Decision Matrix

| Kebutuhan | Pilihan Lebih Cocok |
|---|---|
| Caller butuh hasil langsung | direct method call |
| Behavior membungkus method | interceptor |
| Behavior memperkaya interface tertentu | decorator |
| Banyak komponen bereaksi terhadap fakta lokal | CDI event |
| Efek samping setelah commit, non-critical | transactional observer AFTER_SUCCESS |
| Efek samping eksternal critical | outbox + broker/job |
| Workflow panjang multi-step | orchestrator/state machine/BPMN |
| Cross-service integration | message broker/API integration |
| Dynamic runtime enable/disable | feature flag + explicit strategy/observer guard |
| Local cache invalidation single-node | CDI event OK |
| Cluster-wide cache invalidation | distributed cache/broker/provider feature |

---

## 37. Pattern: Clean Local Domain Event Publisher

Daripada menyebar `Event<T>` di banyak service, gunakan publisher kecil per bounded context.

```java
public interface CaseEvents {
    void approved(CaseApproved event);
    void rejected(CaseRejected event);
    void reopened(CaseReopened event);
}
```

Implementasi CDI:

```java
@ApplicationScoped
public class CdiCaseEvents implements CaseEvents {

    @Inject Event<CaseApproved> approved;
    @Inject Event<CaseRejected> rejected;
    @Inject Event<CaseReopened> reopened;

    @Override
    public void approved(CaseApproved event) {
        approved.fire(event);
    }

    @Override
    public void rejected(CaseRejected event) {
        rejected.fire(event);
    }

    @Override
    public void reopened(CaseReopened event) {
        reopened.fire(event);
    }
}
```

Service:

```java
@ApplicationScoped
public class CaseApprovalService {

    private final CaseEvents events;

    @Inject
    public CaseApprovalService(CaseEvents events) {
        this.events = events;
    }

    @Transactional
    public void approve(CaseId caseId) {
        ...
        events.approved(new CaseApproved(...));
    }
}
```

Manfaat:

1. service tidak tergantung CDI API langsung,
2. event publication bisa dilog,
3. unit test lebih mudah,
4. daftar event context lebih eksplisit,
5. bisa diganti outbox kelak.

---

## 38. Pattern: After-Commit Side Effect

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject CaseEvents events;

    @Transactional
    public void approve(CaseId caseId) {
        caseRepository.approve(caseId);
        events.approved(new CaseApproved(eventId(), correlationId(), caseId, currentOfficer(), clock.instant()));
    }
}
```

Observer:

```java
@ApplicationScoped
public class CaseApprovalNotificationObserver {

    @Inject NotificationService notificationService;

    public void notifyApplicant(
            @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
    ) {
        notificationService.caseApproved(event.caseId(), event.correlationId());
    }
}
```

Gunakan untuk side effect yang boleh terjadi setelah commit dan tidak harus menggagalkan transaction utama.

Jika notification wajib dan harus durable, jangan cukup dengan ini. Pakai outbox.

---

## 39. Pattern: Local Outbox Bridge

CDI event bisa menjembatani domain event ke outbox writer.

```java
@ApplicationScoped
public class OutboxCaseEventObserver {

    @Inject OutboxRepository outbox;

    public void write(@Observes CaseApproved event) {
        outbox.insert(
            OutboxMessage.of(
                event.eventId(),
                "CaseApproved",
                serialize(event),
                event.occurredAt()
            )
        );
    }
}
```

Jika observer ini synchronous dan ikut transaction utama, outbox row commit bersama business data.

Lalu worker terpisah:

```text
poll outbox
publish to broker/external API
mark sent
retry on failure
```

Ini jauh lebih reliable daripada `AFTER_SUCCESS` observer yang langsung call external API.

Namun, jika outbox wajib untuk consistency, jangan biarkan observer tersembunyi tanpa dokumentasi. Jadikan ini bagian dari architecture contract.

---

## 40. Pattern: Observer Registry Documentation Test

Untuk event penting, buat test yang memastikan observer penting terdaftar.

Pseudo idea:

```text
Boot CDI test container
Fire CaseApproved test event
Assert audit observer called
Assert outbox observer called
Assert cache invalidation observer called
```

Ini bukan sekadar unit test; ini test wiring runtime.

Tujuannya:

1. mendeteksi observer hilang karena discovery issue,
2. mendeteksi qualifier salah,
3. mendeteksi namespace migration error,
4. mendeteksi alternative/profile test salah.

---

## 41. Naming Convention

Gunakan nama event past-tense:

```text
ApplicationSubmitted
CaseApproved
CaseRejected
DocumentUploaded
PaymentCaptured
ScreeningCompleted
OfficerAssigned
AppealFiled
```

Gunakan observer dengan nama jelas:

```text
AuditOnCaseApproved
InvalidateCacheOnCaseApproved
RefreshIndexOnCaseApproved
NotifyApplicantOnCaseApproved
WriteOutboxOnCaseApproved
```

Method observer:

```java
public void onCaseApproved(@Observes CaseApproved event) { ... }
```

Atau lebih semantic:

```java
public void writeAudit(@Observes CaseApproved event) { ... }
public void invalidateCache(@Observes CaseApproved event) { ... }
```

Hindari:

```java
public void handle(@Observes Object event) { ... }
public void process(@Observes CaseEvent event) { ... }
public void doStuff(@Observes ActionEvent event) { ... }
```

---

## 42. Package Organization

Contoh struktur:

```text
case/
  application/
    CaseApprovalService.java
    CaseEvents.java
    CdiCaseEvents.java

  events/
    CaseApproved.java
    CaseRejected.java
    CaseReopened.java

  observers/
    AuditOnCaseApproved.java
    InvalidateCacheOnCaseApproved.java
    RefreshIndexOnCaseApproved.java
    NotifyApplicantOnCaseApproved.java

  domain/
    Case.java
    CaseState.java
```

Untuk event yang menjadi public contract antar module internal:

```text
case/api/events/CaseApproved.java
```

Untuk event private module:

```text
case/internal/events/CaseStatePersisted.java
```

Jangan semua event langsung menjadi public API.

---

## 43. Versioning Event Payload

Untuk CDI local event, versioning tidak seberat distributed event. Tetapi tetap penting jika modul berbeda dikembangkan oleh tim berbeda.

Rule:

1. Tambah field optional lebih aman daripada ubah meaning field.
2. Jangan rename event sembarangan.
3. Jangan ubah semantic timing tanpa dokumentasi.
4. Jangan ubah transaction phase expectation diam-diam.
5. Jangan ubah dari sync critical menjadi async best-effort tanpa ADR.

Distributed event butuh versioning formal. CDI local event butuh minimal semantic discipline.

---

## 44. Security Considerations

Jangan menganggap observer otomatis punya security context yang sama, terutama async.

Payload event sebaiknya membawa actor id eksplisit:

```java
record CaseApproved(
        CaseId caseId,
        OfficerId approvedBy,
        Instant approvedAt
) {}
```

Bukan observer mengambil dari ambient context:

```java
securityContext.getCallerPrincipal()
```

Untuk synchronous observer dalam request yang sama, caller principal mungkin tersedia. Tetapi untuk audit defensible, actor harus bagian dari event fact, bukan ambient lookup yang bisa berubah/hilang.

---

## 45. Performance Considerations

CDI event dispatch punya overhead:

1. observer resolution,
2. proxy invocation,
3. interceptor/decorator pada observer jika ada,
4. transaction synchronization untuk transactional observer,
5. async scheduling untuk async event.

Biasanya overhead ini kecil dibanding I/O, tetapi jangan fire event sangat granular di hot loop.

Buruk:

```java
for (LineItem item : items) {
    itemProcessed.fire(new ItemProcessed(item.id()));
}
```

Jika jumlah item ribuan dan observer berat, ini bisa mahal.

Lebih baik batch event:

```java
itemsProcessed.fire(new ItemsProcessed(batchId, itemIds));
```

Atau direct batch service.

---

## 46. Checklist Sebelum Memakai CDI Event

Tanyakan:

1. Apakah ini fakta yang sudah terjadi, bukan command?
2. Apakah publisher tidak butuh hasil observer?
3. Apakah observer boleh nol/banyak?
4. Apakah urutan observer tidak penting?
5. Apakah failure observer sudah didefinisikan?
6. Apakah transaction phase sudah benar?
7. Apakah side effect butuh durability?
8. Apakah event payload immutable dan cukup mandiri?
9. Apakah payload tidak membawa entity managed/service/request object?
10. Apakah observability cukup?
11. Apakah test wiring diperlukan?
12. Apakah event ini tidak akan menjadi hidden workflow?
13. Apakah cluster/distributed behavior tidak diperlukan?
14. Apakah ada dokumentasi untuk event penting?

Jika banyak jawaban tidak jelas, jangan langsung pakai event.

---

## 47. Mini Case Study: Regulatory Case Approval

### 47.1 Requirement

Saat officer approve case:

1. status case berubah menjadi `APPROVED`,
2. audit trail harus tercatat,
3. local cache harus invalidated,
4. search index harus refresh,
5. applicant notification dikirim,
6. metrics dicatat.

### 47.2 Naive Design

```java
@Transactional
public void approve(CaseId caseId) {
    caseRepository.approve(caseId);
    auditService.write(...);
    cache.invalidate(...);
    searchIndex.update(...);
    notification.send(...);
    metrics.increment(...);
}
```

Masalah:

1. service terlalu tahu banyak side effect,
2. notification external call dalam transaction,
3. index failure bisa rollback approval tanpa sengaja,
4. sulit evolve.

### 47.3 Better Design

Core approval:

```java
@Transactional
public void approve(CaseId caseId) {
    Case caseData = caseRepository.getForUpdate(caseId);
    caseData.approve(currentOfficer(), clock.instant());
    caseRepository.save(caseData);

    events.approved(new CaseApproved(
        UUID.randomUUID(),
        correlation.currentId(),
        caseId,
        caseData.version(),
        currentOfficer(),
        clock.instant()
    ));
}
```

Audit observer if legally required in same transaction:

```java
public void audit(@Observes CaseApproved event) {
    auditRepository.insertApprovalAudit(...);
}
```

Cache invalidation after commit:

```java
public void invalidate(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    caseCache.invalidate(event.caseId());
}
```

Search index as durable outbox:

```java
public void outbox(@Observes CaseApproved event) {
    outboxRepository.insert("CaseApproved", serialize(event));
}
```

Notification not direct in transaction:

```java
public void scheduleNotification(
        @Observes(during = TransactionPhase.AFTER_SUCCESS) CaseApproved event
) {
    notificationJobRepository.createIfAbsent(...);
}
```

Metrics best-effort:

```java
public void metrics(@Observes CaseApproved event) {
    try {
        metrics.increment("case.approved");
    } catch (RuntimeException ex) {
        log.warning("Metric failed: " + ex.getMessage());
    }
}
```

### 47.4 Architecture Decision

Audit is part of transaction.  
Cache is after-commit local side effect.  
Search indexing is durable via outbox.  
Notification is scheduled after commit.  
Metrics is best-effort.  

Semua observer tidak sama criticality-nya. Itulah inti desain event yang matang.

---

## 48. Top 1% Mental Model

Engineer biasa melihat CDI event sebagai:

```java
event.fire(x);
```

Engineer kuat melihatnya sebagai:

```text
A typed local dispatch mechanism whose correctness depends on:
- event contract,
- qualifier routing,
- observer discovery,
- transaction phase,
- failure propagation,
- context availability,
- side-effect criticality,
- observability,
- ordering independence,
- durability requirements.
```

Pertanyaan top engineer:

1. Apakah event ini fakta atau command?
2. Apakah publisher boleh tidak tahu observer?
3. Apakah observer failure harus rollback publisher?
4. Apakah event harus setelah commit?
5. Apakah side effect eksternal butuh retry durable?
6. Apakah observer bergantung pada urutan?
7. Apakah event akan terlihat di log/trace?
8. Apakah event payload cukup untuk async execution?
9. Apakah cluster behavior diperlukan?
10. Apakah ini local extension point atau hidden workflow?

---

## 49. Ringkasan

CDI event adalah fitur kuat untuk decoupling lokal di dalam CDI container.

Ia cocok untuk:

1. local notification,
2. internal extension point,
3. audit hook tertentu,
4. cache invalidation lokal,
5. metrics/logging hook,
6. after-commit local reaction,
7. modular monolith side effects.

Ia tidak cocok sebagai pengganti:

1. direct call untuk dependency utama,
2. workflow orchestrator,
3. distributed event broker,
4. durable job queue,
5. outbox pattern,
6. state machine.

Rule paling penting:

```text
Gunakan CDI event untuk mengumumkan fakta lokal yang sudah terjadi.
Jangan gunakan CDI event untuk menyembunyikan command, workflow, atau critical distributed side effect.
```

---

## 50. Latihan Mandiri

1. Ambil satu use case di sistemmu, misalnya submit application, approve case, assign officer, upload document, atau close enforcement case.
2. Daftar semua side effect setelah use case utama.
3. Klasifikasikan setiap side effect:
   - same transaction required,
   - after commit best-effort,
   - after commit durable,
   - external integration,
   - local cache/index/metric.
4. Tentukan mana yang direct call, CDI event, transactional observer, outbox, atau broker.
5. Buat event payload immutable.
6. Tulis event contract singkat.
7. Tentukan failure behavior observer.
8. Tulis minimal satu test yang memastikan observer penting terpanggil.

---

## 51. Apa Yang Akan Dibahas Berikutnya

Part berikutnya:

```text
Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
```

Kita akan membahas bagaimana CDI/Jakarta interceptor membungkus method invocation untuk cross-cutting concern seperti audit, metric, tracing, authorization, idempotency, retry, dan feature gate.

Perbedaan kunci dengan event:

```text
Event       -> reaction terhadap kejadian
Interceptor -> boundary di sekitar method execution
```

Memahami perbedaan ini penting agar kita tidak memakai event untuk semua hal dan tidak memakai interceptor untuk domain reaction yang seharusnya eksplisit sebagai event.

---

## Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
[x] Part 013 — Producers and Disposers: Programmatic Object Supply
[x] Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
```

Belum selesai. Berikutnya:

```text
[ ] Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 013 — Producers and Disposers: Programmatic Object Supply](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-015.md)

</div>