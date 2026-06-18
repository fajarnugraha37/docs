# learn-java-testing-benchmarking-performance-jvm-part-006

# Mocking, Stubbing, Fakes, Spies, dan Contract of Collaboration

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Bagian: `006`  
> Topik: test double, Mockito, stubbing, fake, spy, interaction testing, collaboration contract  
> Target Java: 8 sampai 25  
> Level: advanced / top-tier engineering mindset

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

1. strategi test sebagai sistem bukti,
2. evolusi JUnit,
3. desain test berbasis behavior,
4. assertion engineering,
5. test data engineering.

Sekarang kita masuk ke salah satu area yang sering terlihat sederhana tetapi sangat sering merusak kualitas test: **mocking**.

Banyak engineer memahami mocking sebagai:

> “Kalau dependency sulit dipakai, mock saja.”

Itu tidak sepenuhnya salah, tetapi terlalu dangkal. Dalam sistem enterprise, mocking adalah keputusan desain. Mocking menentukan:

- apa yang dianggap boundary,
- contract apa yang diuji,
- behavior mana yang dipalsukan,
- side effect mana yang diverifikasi,
- coupling mana yang disembunyikan,
- dan bug jenis apa yang mungkin tidak akan pernah tertangkap.

Part ini bukan hanya “cara pakai Mockito”. Part ini membangun mental model agar kita bisa menjawab:

> “Apakah dependency ini harus real, fake, stub, mock, spy, atau tidak perlu diganti sama sekali?”

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kita ingin mampu:

1. membedakan dummy, stub, fake, mock, dan spy secara presisi;
2. memahami perbedaan **state verification** dan **interaction verification**;
3. memakai Mockito secara benar tanpa membuat test terlalu rapuh;
4. mengenali over-mocking sebagai design smell;
5. menentukan kapan dependency sebaiknya real, fake, stub, mock, atau Testcontainers;
6. membuat fake dependency yang lebih bernilai daripada mock untuk domain tertentu;
7. menguji collaboration contract tanpa mengunci implementation detail;
8. menguji side effect penting seperti audit, event publish, retry, idempotency, dan transaction boundary;
9. menghindari deep stub, lenient stub, order verification, dan static mock secara sembarangan;
10. menyusun mocking guideline untuk codebase Java 8–25.

---

## 2. Mental Model Utama: Test Double Bukan Sekadar “Object Palsu”

Istilah **test double** dipopulerkan untuk menyebut objek pengganti yang dipakai dalam test. Test double adalah istilah payung untuk beberapa jenis pengganti dependency.

Analogi sederhana:

```text
Production dependency
        |
        | diganti dalam test oleh
        v
Test double
        |
        +-- Dummy
        +-- Stub
        +-- Fake
        +-- Mock
        +-- Spy
```

Tetapi yang penting bukan namanya. Yang penting adalah **peran epistemik**-nya: bukti apa yang diberikan oleh pengganti itu?

### 2.1 Pertanyaan yang Harus Dijawab Sebelum Mocking

Sebelum membuat mock, tanyakan:

1. Apakah dependency ini lambat?
2. Apakah dependency ini nondeterministic?
3. Apakah dependency ini eksternal?
4. Apakah dependency ini menyebabkan side effect?
5. Apakah behavior dependency ini bagian dari contract yang ingin diuji?
6. Apakah kita menguji output akhir atau interaksi internal?
7. Jika dependency ini dimock, bug apa yang tidak akan tertangkap?
8. Jika dependency ini real, cost dan flakiness-nya seberapa besar?
9. Apakah fake sederhana lebih baik daripada mock?
10. Apakah test ini sebenarnya menunjukkan design coupling yang buruk?

Mocking yang baik dimulai dari pertanyaan-pertanyaan ini, bukan dari shortcut IDE.

---

## 3. Vocabulary: Dummy, Stub, Fake, Mock, Spy

## 3.1 Dummy

**Dummy** adalah objek yang hanya dilewatkan sebagai parameter tetapi tidak benar-benar dipakai.

Contoh:

```java
@Test
void shouldCreateDraftCase() {
    UserContext unusedUserContext = new UserContext("test-user");

    CaseDraft draft = CaseDraft.create("CASE-001", unusedUserContext);

    assertThat(draft.status()).isEqualTo(CaseStatus.DRAFT);
}
```

Jika `unusedUserContext` tidak dipakai oleh behavior yang sedang diuji, dia berperan sebagai dummy.

### Kapan dummy acceptable?

- Untuk memenuhi signature method.
- Ketika value tersebut tidak relevan pada behavior test.
- Untuk backward compatibility API lama.

### Smell

Jika test terlalu banyak dummy, mungkin method/class menerima dependency terlalu banyak.

```text
Banyak dummy dalam test = kemungkinan production API terlalu gemuk.
```

---

## 3.2 Stub

**Stub** memberikan jawaban yang sudah ditentukan untuk dependency.

Contoh:

```java
@Test
void shouldRejectSubmissionWhenApplicantIsSuspended() {
    ApplicantStatusClient applicantStatusClient = mock(ApplicantStatusClient.class);
    when(applicantStatusClient.getStatus("APP-001"))
            .thenReturn(ApplicantStatus.SUSPENDED);

    CaseSubmissionService service = new CaseSubmissionService(applicantStatusClient);

    SubmissionResult result = service.submit("APP-001");

    assertThat(result.isAccepted()).isFalse();
    assertThat(result.reason()).isEqualTo("APPLICANT_SUSPENDED");
}
```

Di sini mock object dipakai sebagai stub. Kita tidak peduli apakah method dipanggil satu kali atau dua kali. Kita hanya butuh dependency menjawab status tertentu.

### Kapan stub cocok?

- Dependency mengembalikan data yang mempengaruhi decision.
- Kita ingin mengontrol branch tertentu.
- Dependency eksternal terlalu mahal untuk dipakai real.
- Kita tidak peduli interaksi detail, hanya outcome.

### Smell

Stub terlalu banyak menandakan service mungkin terlalu banyak dependency atau test terlalu tinggi levelnya untuk unit test.

---

## 3.3 Fake

**Fake** adalah implementasi sederhana tetapi bekerja secara nyata untuk kebutuhan test.

Contoh fake repository in-memory:

```java
final class InMemoryCaseRepository implements CaseRepository {
    private final Map<CaseId, CaseRecord> records = new LinkedHashMap<>();

    @Override
    public void save(CaseRecord record) {
        records.put(record.id(), record);
    }

    @Override
    public Optional<CaseRecord> findById(CaseId id) {
        return Optional.ofNullable(records.get(id));
    }

    @Override
    public boolean existsByReferenceNo(String referenceNo) {
        return records.values().stream()
                .anyMatch(record -> record.referenceNo().equals(referenceNo));
    }
}
```

Fake berbeda dari stub karena fake punya behavior internal yang konsisten.

### Kapan fake lebih baik daripada mock?

Fake lebih baik ketika:

- dependency punya banyak method yang saling terkait;
- state dependency penting;
- test butuh beberapa operasi berurutan;
- mock akan memerlukan banyak stubbing;
- test ingin memverifikasi behavior domain, bukan call detail;
- dependency mudah dibuat versi in-memory yang valid.

Contoh cocok untuk fake:

- repository sederhana,
- clock,
- ID generator,
- permission evaluator,
- event bus in-memory,
- audit collector,
- email collector,
- feature flag provider,
- object storage fake sederhana.

### Risiko fake

Fake bisa berbeda dari production behavior.

Contoh:

```text
Fake repository pakai Map
Production DB punya:
- transaction isolation
- constraint
- locking
- index behavior
- collation
- null semantics
- pagination behavior
```

Jadi fake tidak boleh menggantikan semua integration test.

---

## 3.4 Mock

**Mock** adalah test double yang dipakai untuk memverifikasi interaksi.

Contoh:

```java
@Test
void shouldPublishAuditEventWhenCaseSubmitted() {
    AuditPublisher auditPublisher = mock(AuditPublisher.class);
    CaseRepository repository = new InMemoryCaseRepository();
    CaseSubmissionService service = new CaseSubmissionService(repository, auditPublisher);

    service.submit(new SubmitCaseCommand("CASE-001", "officer-1"));

    verify(auditPublisher).publish(argThat(event ->
            event.caseId().equals("CASE-001") &&
            event.action().equals("SUBMIT") &&
            event.actorId().equals("officer-1")
    ));
}
```

Di sini outcome penting bukan hanya state akhir. Ada side effect wajib: audit event harus dipublish.

### Kapan mock cocok?

Mock cocok untuk memverifikasi side effect yang merupakan bagian dari contract:

- audit event dipublish,
- domain event emitted,
- notification dikirim,
- command dikirim ke queue,
- retry terjadi untuk error transient,
- external client tidak dipanggil pada invalid request,
- transaction callback dipakai,
- lock dilepas,
- idempotency store dicek sebelum side effect,
- payment/external action hanya dipanggil sekali.

### Kapan mock berbahaya?

Mock berbahaya ketika memverifikasi implementation detail:

```java
verify(repository).findById(id);
verify(repository).save(any());
```

Padahal behavior yang benar adalah:

```java
assertThat(repository.findById(id)).contains(expectedUpdatedCase);
```

Jika interaksi bukan contract eksternal atau side effect penting, jangan verify call detail.

---

## 3.5 Spy

**Spy** membungkus object nyata tetapi sebagian behavior bisa diverifikasi atau dioverride.

Contoh:

```java
@Test
void shouldCalculateUsingRealPolicyButTrackCall() {
    EscalationPolicy realPolicy = new EscalationPolicy();
    EscalationPolicy spyPolicy = spy(realPolicy);

    EscalationService service = new EscalationService(spyPolicy);

    service.evaluate(caseRecord);

    verify(spyPolicy).calculateDeadline(caseRecord);
}
```

### Kapan spy berguna?

- Saat refactoring legacy code.
- Saat class sulit dipisah tetapi sebagian behavior ingin diawasi.
- Untuk transisi dari design buruk ke design lebih baik.
- Untuk partial mocking pada kode lama.

### Kenapa spy sering smell?

Spy biasanya menandakan:

- class terlalu besar,
- tanggung jawab tercampur,
- method internal terlalu penting,
- test mengintip implementation detail,
- dependency tidak diinjeksi dengan baik.

Prinsip praktis:

```text
Spy boleh sebagai alat migrasi legacy.
Spy jangan menjadi default testing style.
```

---

## 4. State Verification vs Interaction Verification

Ini fondasi paling penting.

## 4.1 State Verification

State verification mengecek hasil akhir.

```java
@Test
void shouldApproveCase() {
    InMemoryCaseRepository repository = new InMemoryCaseRepository();
    repository.save(CaseRecord.submitted("CASE-001"));

    ApprovalService service = new ApprovalService(repository);

    service.approve("CASE-001", "manager-1");

    CaseRecord updated = repository.findById(new CaseId("CASE-001")).orElseThrow();
    assertThat(updated.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(updated.approvedBy()).isEqualTo("manager-1");
}
```

Test ini tidak peduli apakah repository dipanggil `findById` lalu `save`, atau `updateStatus`, atau event-sourced append. Yang penting state akhir benar.

### Kekuatan state verification

- Lebih dekat ke behavior.
- Lebih tahan refactor.
- Lebih sedikit coupling ke implementation.
- Failure biasanya lebih bermakna.

### Kelemahan

- Tidak selalu bisa melihat side effect eksternal.
- Tidak cocok jika contract utamanya adalah interaksi.
- Bisa terlalu lambat jika memakai dependency real berat.

---

## 4.2 Interaction Verification

Interaction verification mengecek call ke collaborator.

```java
@Test
void shouldNotCallExternalGatewayWhenValidationFails() {
    PaymentGateway gateway = mock(PaymentGateway.class);
    PaymentService service = new PaymentService(gateway);

    PaymentResult result = service.pay(new PaymentCommand(null, BigDecimal.TEN));

    assertThat(result.isRejected()).isTrue();
    verifyNoInteractions(gateway);
}
```

Interaksi di sini bagian dari behavior: request invalid tidak boleh memicu external payment.

### Kekuatan interaction verification

- Bagus untuk side effect.
- Bagus untuk gateway eksternal.
- Bagus untuk retry/idempotency.
- Bagus untuk event/audit/notification.
- Bagus untuk memastikan operasi berbahaya tidak terjadi.

### Kelemahan

- Mudah overspecification.
- Rapuh terhadap refactor.
- Bisa pass walau outcome salah.
- Bisa membuat test terlalu mirip implementation.

---

## 4.3 Rule of Thumb

```text
Prefer state verification untuk domain behavior.
Use interaction verification untuk side effect yang menjadi contract.
```

Contoh:

| Scenario | Prefer |
|---|---|
| Status case berubah dari SUBMITTED ke APPROVED | State verification |
| Audit event wajib dipublish | Interaction verification atau fake collector |
| External payment tidak boleh dipanggil saat invalid | Interaction verification |
| Retry dilakukan 3 kali pada transient failure | Interaction verification |
| Sorting result benar | State verification |
| Repository dipanggil findById | Biasanya jangan verify |
| Email dikirim ke recipient benar | Mock/fake collector |
| Cache dipakai atau tidak | Hati-hati; biasanya ukur behavior/performance, bukan call detail |

---

## 5. Mockito Setup untuk Java 8–25

## 5.1 Dependency Modern

Untuk JUnit Jupiter:

```xml
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.mockito</groupId>
        <artifactId>mockito-core</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.mockito</groupId>
        <artifactId>mockito-junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Untuk static mocking atau final class pada setup tertentu, versi modern Mockito menggunakan inline mock maker secara lebih luas. Pada codebase lama, kadang perlu dependency/konfigurasi tambahan tergantung versi Mockito.

## 5.2 JUnit 5 / Jupiter Integration

```java
@ExtendWith(MockitoExtension.class)
class CaseSubmissionServiceTest {

    @Mock
    ApplicantStatusClient applicantStatusClient;

    @Mock
    AuditPublisher auditPublisher;

    @Test
    void shouldRejectSuspendedApplicant() {
        when(applicantStatusClient.getStatus("APP-001"))
                .thenReturn(ApplicantStatus.SUSPENDED);

        CaseSubmissionService service = new CaseSubmissionService(
                applicantStatusClient,
                auditPublisher
        );

        SubmissionResult result = service.submit("APP-001");

        assertThat(result.reason()).isEqualTo("APPLICANT_SUSPENDED");
        verifyNoInteractions(auditPublisher);
    }
}
```

## 5.3 JUnit 4 Integration

Untuk Java 8 legacy dengan JUnit 4:

```java
@RunWith(MockitoJUnitRunner.class)
public class CaseSubmissionServiceTest {

    @Mock
    private ApplicantStatusClient applicantStatusClient;

    @Test
    public void shouldRejectSuspendedApplicant() {
        when(applicantStatusClient.getStatus("APP-001"))
                .thenReturn(ApplicantStatus.SUSPENDED);

        CaseSubmissionService service = new CaseSubmissionService(applicantStatusClient);

        SubmissionResult result = service.submit("APP-001");

        assertEquals("APPLICANT_SUSPENDED", result.reason());
    }
}
```

## 5.4 Manual Mocking

Untuk test kecil, manual mocking kadang lebih jelas:

```java
@Test
void shouldRejectSuspendedApplicant() {
    ApplicantStatusClient applicantStatusClient = mock(ApplicantStatusClient.class);
    when(applicantStatusClient.getStatus("APP-001"))
            .thenReturn(ApplicantStatus.SUSPENDED);

    CaseSubmissionService service = new CaseSubmissionService(applicantStatusClient);

    SubmissionResult result = service.submit("APP-001");

    assertThat(result.reason()).isEqualTo("APPLICANT_SUSPENDED");
}
```

Manual mock menghindari field-level fixture tersembunyi.

---

## 6. Stubbing dengan Mockito

## 6.1 Basic Stubbing

```java
when(client.getStatus("APP-001"))
        .thenReturn(ApplicantStatus.ACTIVE);
```

## 6.2 Sequential Stubbing

Berguna untuk retry scenario:

```java
when(gateway.submit(any()))
        .thenThrow(new TimeoutException("timeout"))
        .thenReturn(GatewayResponse.accepted("TX-001"));
```

Test:

```java
@Test
void shouldRetryOnceWhenGatewayTimeouts() {
    PaymentGateway gateway = mock(PaymentGateway.class);
    when(gateway.submit(any()))
            .thenThrow(new TransientGatewayException("timeout"))
            .thenReturn(GatewayResponse.accepted("TX-001"));

    PaymentService service = new PaymentService(gateway, RetryPolicy.maxAttempts(2));

    PaymentResult result = service.pay(validPayment());

    assertThat(result.transactionId()).isEqualTo("TX-001");
    verify(gateway, times(2)).submit(any());
}
```

Verifikasi `times(2)` di sini sah karena retry adalah behavior contract.

## 6.3 Throwing Exception

```java
when(applicantStatusClient.getStatus("APP-404"))
        .thenThrow(new ApplicantNotFoundException("APP-404"));
```

Untuk void method:

```java
doThrow(new PublishFailedException("broker unavailable"))
        .when(eventPublisher)
        .publish(any());
```

## 6.4 `thenAnswer`

`thenAnswer` berguna ketika response tergantung argument.

```java
when(repository.findById(any()))
        .thenAnswer(invocation -> {
            CaseId id = invocation.getArgument(0);
            return Optional.ofNullable(records.get(id));
        });
```

Namun jika `thenAnswer` semakin kompleks, lebih baik buat fake.

```text
Complex thenAnswer = fake object wants to be born.
```

---

## 7. Argument Matching

## 7.1 Exact Argument

```java
when(client.getStatus("APP-001"))
        .thenReturn(ApplicantStatus.ACTIVE);
```

Bagus jika exact value memang bagian dari scenario.

## 7.2 Generic Matcher

```java
when(client.getStatus(anyString()))
        .thenReturn(ApplicantStatus.ACTIVE);
```

Hati-hati: terlalu generic bisa menyembunyikan bug.

Misal production code salah mengirim applicant ID kosong, test tetap pass karena `anyString()` menerima apa pun.

Lebih baik:

```java
when(client.getStatus(eq("APP-001")))
        .thenReturn(ApplicantStatus.ACTIVE);
```

## 7.3 Custom Matcher

```java
verify(auditPublisher).publish(argThat(event ->
        event.caseId().equals("CASE-001") &&
        event.action().equals("SUBMIT")
));
```

Custom matcher cocok untuk assertion ringkas, tetapi failure message bisa kurang jelas.

Untuk diagnosis lebih baik, gunakan `ArgumentCaptor` lalu AssertJ.

---

## 8. ArgumentCaptor

## 8.1 Basic Usage

```java
@Test
void shouldPublishDetailedAuditEvent() {
    AuditPublisher auditPublisher = mock(AuditPublisher.class);
    CaseSubmissionService service = new CaseSubmissionService(auditPublisher);

    service.submit(new SubmitCaseCommand("CASE-001", "officer-1"));

    ArgumentCaptor<AuditEvent> captor = ArgumentCaptor.forClass(AuditEvent.class);
    verify(auditPublisher).publish(captor.capture());

    AuditEvent event = captor.getValue();
    assertThat(event.caseId()).isEqualTo("CASE-001");
    assertThat(event.actorId()).isEqualTo("officer-1");
    assertThat(event.action()).isEqualTo("SUBMIT");
    assertThat(event.metadata()).containsEntry("source", "PORTAL");
}
```

## 8.2 Kapan Captor Cocok?

Captor cocok ketika:

- argument adalah object kompleks,
- kita ingin assertion detail,
- `argThat` menjadi terlalu panjang,
- failure message harus jelas,
- object yang dikirim adalah side effect utama.

## 8.3 Jangan Gunakan Captor untuk Stubbing

Hindari:

```java
ArgumentCaptor<Request> captor = ArgumentCaptor.forClass(Request.class);
when(client.call(captor.capture())).thenReturn(response);
```

Lebih jelas:

```java
when(client.call(any(Request.class))).thenReturn(response);
```

Lalu capture saat verify.

---

## 9. Verification Patterns

## 9.1 Verify Called Once

```java
verify(auditPublisher).publish(any(AuditEvent.class));
```

Secara default Mockito verify berarti satu kali.

## 9.2 Verify Times

```java
verify(gateway, times(3)).submit(any());
```

Gunakan hanya jika jumlah call bagian dari contract.

Contoh sah:

- retry max 3 attempt,
- no duplicate event,
- idempotency mencegah second publish,
- batch chunking expected.

Contoh kurang sah:

- service kebetulan memanggil repository sekali.

## 9.3 Verify Never

```java
verify(emailSender, never()).send(any());
```

Sangat berguna untuk mencegah side effect berbahaya.

Contoh:

```java
@Test
void shouldNotSendApprovalEmailWhenApprovalFails() {
    EmailSender emailSender = mock(EmailSender.class);
    ApprovalService service = new ApprovalService(emailSender);

    ApprovalResult result = service.approve(invalidApprovalCommand());

    assertThat(result.isRejected()).isTrue();
    verify(emailSender, never()).send(any());
}
```

## 9.4 Verify No More Interactions

```java
verify(auditPublisher).publish(any());
verifyNoMoreInteractions(auditPublisher);
```

Gunakan sangat hati-hati.

### Kapan sah?

- External side effect mahal/berbahaya.
- Security-sensitive call.
- Payment gateway.
- Notification duplicate harus dicegah.
- Regulatory audit tidak boleh double.

### Kapan buruk?

- Untuk mengunci semua implementation call.
- Untuk repository internal.
- Untuk service internal yang mudah berubah.

## 9.5 Verify Order

```java
InOrder inOrder = inOrder(idempotencyStore, paymentGateway, auditPublisher);

inOrder.verify(idempotencyStore).reserve(any());
inOrder.verify(paymentGateway).charge(any());
inOrder.verify(auditPublisher).publish(any());
```

Order verification sangat rapuh, tetapi sah jika urutan adalah contract.

Contoh sah:

```text
idempotency reserve harus terjadi sebelum external charge
```

Contoh buruk:

```text
repository.findById harus sebelum validator.validate
```

Jika order bukan invariant bisnis/teknis penting, jangan verify order.

---

## 10. Strict Stubbing

Mockito modern mendorong strictness agar test tidak memiliki stub yang tidak dipakai.

Contoh stub tidak dipakai:

```java
when(client.getStatus("APP-001")).thenReturn(ApplicantStatus.ACTIVE);

SubmissionResult result = service.submit("APP-002");
```

Strict stubbing membantu mendeteksi:

- stub salah argument,
- branch tidak berjalan,
- setup berlebihan,
- test fixture tidak jelas,
- test sudah tidak sesuai behavior.

## 10.1 Kenapa Strict Stubbing Penting?

Stub yang tidak dipakai bukan masalah kosmetik. Ia bisa berarti:

1. production code tidak memanggil dependency yang diharapkan;
2. test setup copy-paste;
3. scenario tidak sesuai nama test;
4. behavior berubah tetapi test tidak sadar;
5. test menjadi sulit dibaca.

## 10.2 Lenient Stubbing

Kadang kita melihat:

```java
lenient().when(client.getStatus(anyString()))
        .thenReturn(ApplicantStatus.ACTIVE);
```

Gunakan hanya sebagai exception.

### Kapan lenient masih masuk akal?

- Shared setup untuk parameterized tests dengan beberapa branch.
- Legacy test migration sementara.
- Fixture mahal yang sedang direstrukturisasi.

### Jangan jadikan default

```text
lenient() sering menjadi plester untuk test design yang buruk.
```

---

## 11. Annotation: `@Mock`, `@Spy`, `@Captor`, `@InjectMocks`

## 11.1 `@Mock`

```java
@Mock
AuditPublisher auditPublisher;
```

Membuat mock dependency.

## 11.2 `@Captor`

```java
@Captor
ArgumentCaptor<AuditEvent> auditEventCaptor;
```

Mengurangi boilerplate captor.

## 11.3 `@Spy`

```java
@Spy
EscalationPolicy escalationPolicy = new EscalationPolicy();
```

Gunakan terbatas.

## 11.4 `@InjectMocks`

```java
@InjectMocks
CaseSubmissionService service;
```

Mockito akan mencoba menginject mock ke class under test.

### Kenapa `@InjectMocks` perlu hati-hati?

`@InjectMocks` bisa menyembunyikan construction logic.

Lebih eksplisit:

```java
@BeforeEach
void setUp() {
    service = new CaseSubmissionService(
            applicantStatusClient,
            auditPublisher,
            clock
    );
}
```

Eksplisit constructor membuat dependency terlihat.

Rule praktis:

```text
Gunakan @InjectMocks hanya jika construction sederhana dan tidak menyembunyikan hal penting.
Untuk service penting, constructor eksplisit sering lebih jelas.
```

---

## 12. Design Impact: Mocking Mengungkap Arsitektur

Mocking bukan hanya test concern. Mocking sering mengungkap struktur desain.

## 12.1 Terlalu Banyak Mock

Contoh:

```java
@Mock CaseRepository caseRepository;
@Mock ApplicantClient applicantClient;
@Mock PermissionService permissionService;
@Mock AuditPublisher auditPublisher;
@Mock EmailSender emailSender;
@Mock EventPublisher eventPublisher;
@Mock Clock clock;
@Mock IdGenerator idGenerator;
@Mock FeatureFlagService featureFlagService;
@Mock NotificationPreferenceService preferenceService;
```

Jika satu service membutuhkan 10 dependency untuk satu behavior, ada kemungkinan:

- service terlalu besar,
- use case perlu dipecah,
- orchestration terlalu gemuk,
- domain logic tercampur side effect,
- boundary tidak jelas,
- test berada di level yang salah.

## 12.2 Terlalu Banyak `when`

```java
when(a.foo()).thenReturn(...);
when(b.bar()).thenReturn(...);
when(c.baz()).thenReturn(...);
when(d.qux()).thenReturn(...);
when(e.value()).thenReturn(...);
```

Jika banyak stubbing hanya untuk menjalankan satu branch, mungkin:

- fixture terlalu jauh dari behavior,
- dependency chain terlalu dalam,
- service terlalu procedural,
- perlu fake atau builder,
- perlu test pada lower-level domain object.

## 12.3 Terlalu Banyak `verify`

```java
verify(repository).findById(id);
verify(validator).validate(command);
verify(mapper).toEntity(command);
verify(repository).save(entity);
verify(publisher).publish(event);
```

Ini sering bukan test behavior. Ini test script internal.

Refactor production code sedikit saja, test gagal walau behavior tetap benar.

---

## 13. Jangan Mock Value Object dan Struktur Data Sederhana

Hindari:

```java
Money money = mock(Money.class);
when(money.amount()).thenReturn(new BigDecimal("100.00"));
```

Gunakan real object:

```java
Money money = Money.of("100.00", "SGD");
```

Jangan mock:

- String,
- BigDecimal,
- List/Map/Set,
- Optional,
- value object,
- command object,
- DTO sederhana,
- enum,
- record,
- domain object kecil yang deterministic.

Alasan:

- real object lebih jelas,
- mock menyembunyikan invariant,
- mock tidak menjalankan constructor/factory validation,
- test menjadi tidak realistis.

---

## 14. Jangan Mock Class yang Seharusnya Diuji

Smell:

```java
CaseSubmissionService service = mock(CaseSubmissionService.class);
when(service.submit(command)).thenReturn(success());
```

Ini bukan menguji `CaseSubmissionService`; ini hanya menguji Mockito.

Yang benar:

```java
CaseSubmissionService service = new CaseSubmissionService(dependencies...);
SubmissionResult result = service.submit(command);
assertThat(result).isEqualTo(success());
```

---

## 15. Deep Stubs: `RETURNS_DEEP_STUBS`

Contoh deep stub:

```java
Order order = mock(Order.class, RETURNS_DEEP_STUBS);
when(order.getCustomer().getAddress().getPostalCode()).thenReturn("123456");
```

Ini memudahkan test, tetapi sangat sering menunjukkan design smell.

### Kenapa buruk?

- Mengunci chain internal.
- Menyembunyikan null/absence behavior.
- Mengabaikan domain model real.
- Rapuh terhadap refactor.
- Failure sulit dibaca.

Lebih baik:

```java
Address address = Address.ofPostalCode("123456");
Customer customer = Customer.withAddress(address);
Order order = Order.forCustomer(customer);
```

Rule:

```text
Every time a mock returns a mock returning another mock, pause.
```

---

## 16. Static Mocking

Mockito modern mendukung static mocking, tetapi ini harus dianggap alat khusus.

Contoh:

```java
try (MockedStatic<UUID> mockedUuid = mockStatic(UUID.class)) {
    mockedUuid.when(UUID::randomUUID)
            .thenReturn(UUID.fromString("00000000-0000-0000-0000-000000000001"));

    CaseId id = CaseId.generate();

    assertThat(id.value()).isEqualTo("00000000-0000-0000-0000-000000000001");
}
```

### Kapan static mocking sah?

- Legacy code belum bisa diubah.
- Static dependency dari library eksternal.
- Migrasi bertahap.
- Testing branch sulit pada kode lama.

### Lebih baik untuk kode baru

Daripada:

```java
UUID.randomUUID()
```

Gunakan injectable dependency:

```java
interface IdGenerator {
    UUID next();
}
```

Production:

```java
final class UuidGenerator implements IdGenerator {
    @Override
    public UUID next() {
        return UUID.randomUUID();
    }
}
```

Test:

```java
final class FixedIdGenerator implements IdGenerator {
    @Override
    public UUID next() {
        return UUID.fromString("00000000-0000-0000-0000-000000000001");
    }
}
```

---

## 17. Mocking Time

Jangan mock `LocalDateTime.now()` secara static jika bisa dihindari.

Gunakan `Clock`:

```java
Clock fixedClock = Clock.fixed(
        Instant.parse("2026-06-16T10:00:00Z"),
        ZoneOffset.UTC
);
```

Production service:

```java
final class SlaService {
    private final Clock clock;

    SlaService(Clock clock) {
        this.clock = clock;
    }

    Deadline calculateDeadline(Duration allowedDuration) {
        Instant now = Instant.now(clock);
        return new Deadline(now.plus(allowedDuration));
    }
}
```

Test:

```java
@Test
void shouldCalculateDeadlineFromFixedTime() {
    Clock clock = Clock.fixed(
            Instant.parse("2026-06-16T02:00:00Z"),
            ZoneOffset.UTC
    );
    SlaService service = new SlaService(clock);

    Deadline deadline = service.calculateDeadline(Duration.ofHours(4));

    assertThat(deadline.instant()).isEqualTo(Instant.parse("2026-06-16T06:00:00Z"));
}
```

`Clock` adalah fake dependency yang jauh lebih baik daripada static mock.

---

## 18. Mocking External Clients

External client sering cocok dimock pada unit test.

Contoh:

```java
interface ApplicantStatusClient {
    ApplicantStatus getStatus(String applicantId);
}
```

Unit test service:

```java
when(applicantStatusClient.getStatus("APP-001"))
        .thenReturn(ApplicantStatus.ACTIVE);
```

Tetapi mock client tidak membuktikan:

- HTTP serialization benar,
- endpoint benar,
- header benar,
- auth benar,
- timeout benar,
- error mapping benar,
- retry interceptor benar,
- JSON schema kompatibel.

Maka perlu test lain:

```text
Service unit test          -> mock client
Client integration test    -> WireMock/MockWebServer
Contract test              -> OpenAPI/Pact/schema
E2E/system test            -> real service/staging if needed
```

Mock bukan pengganti contract/integration test.

---

## 19. Fake vs Mock untuk Event Publisher

Mock event publisher:

```java
EventPublisher publisher = mock(EventPublisher.class);

service.submit(command);

verify(publisher).publish(any(CaseSubmittedEvent.class));
```

Fake event publisher:

```java
final class RecordingEventPublisher implements EventPublisher {
    private final List<DomainEvent> events = new ArrayList<>();

    @Override
    public void publish(DomainEvent event) {
        events.add(event);
    }

    public List<DomainEvent> events() {
        return List.copyOf(events);
    }
}
```

Test:

```java
@Test
void shouldRecordCaseSubmittedEvent() {
    RecordingEventPublisher publisher = new RecordingEventPublisher();
    CaseSubmissionService service = new CaseSubmissionService(publisher);

    service.submit(new SubmitCaseCommand("CASE-001", "officer-1"));

    assertThat(publisher.events())
            .singleElement()
            .satisfies(event -> {
                assertThat(event).isInstanceOf(CaseSubmittedEvent.class);
                CaseSubmittedEvent submitted = (CaseSubmittedEvent) event;
                assertThat(submitted.caseId()).isEqualTo("CASE-001");
                assertThat(submitted.actorId()).isEqualTo("officer-1");
            });
}
```

### Kenapa fake sering lebih baik?

- Assertion lebih natural.
- Tidak perlu verify syntax.
- Bisa melihat semua event.
- Cocok untuk domain event testing.
- Lebih tahan refactor.

---

## 20. Fake Audit Collector untuk Regulatory Systems

Dalam sistem regulasi/case management, audit sering bukan detail teknis. Audit adalah evidence.

Fake audit collector:

```java
final class RecordingAuditSink implements AuditSink {
    private final List<AuditEntry> entries = new ArrayList<>();

    @Override
    public void record(AuditEntry entry) {
        entries.add(entry);
    }

    public List<AuditEntry> entries() {
        return List.copyOf(entries);
    }

    public Optional<AuditEntry> findByAction(String action) {
        return entries.stream()
                .filter(entry -> entry.action().equals(action))
                .findFirst();
    }
}
```

Test:

```java
@Test
void shouldRecordRegulatoryAuditWhenCaseEscalated() {
    RecordingAuditSink auditSink = new RecordingAuditSink();
    EscalationService service = new EscalationService(auditSink, fixedClock());

    service.escalate(new EscalateCaseCommand("CASE-001", "supervisor-1", "SLA_BREACH"));

    AuditEntry audit = auditSink.findByAction("CASE_ESCALATED").orElseThrow();
    assertThat(audit.entityId()).isEqualTo("CASE-001");
    assertThat(audit.actorId()).isEqualTo("supervisor-1");
    assertThat(audit.reason()).isEqualTo("SLA_BREACH");
    assertThat(audit.timestamp()).isEqualTo(Instant.parse("2026-06-16T02:00:00Z"));
}
```

Ini lebih ekspresif daripada:

```java
verify(auditSink).record(any());
```

Karena audit content adalah behavior penting.

---

## 21. Testing Retry dengan Mock

Retry adalah salah satu scenario di mana interaction verification sering sah.

```java
@Test
void shouldRetryTransientFailureAndEventuallySucceed() {
    ExternalGateway gateway = mock(ExternalGateway.class);
    when(gateway.send(any()))
            .thenThrow(new TransientException("timeout"))
            .thenThrow(new TransientException("connection reset"))
            .thenReturn(GatewayResult.success("ACK-001"));

    GatewayService service = new GatewayService(
            gateway,
            RetryPolicy.fixedDelay(3, Duration.ZERO)
    );

    GatewayResult result = service.send(command());

    assertThat(result.ackId()).isEqualTo("ACK-001");
    verify(gateway, times(3)).send(any());
}
```

### Apa yang diuji?

- error transient diretry,
- jumlah attempt sesuai policy,
- success setelah retry dikembalikan,
- tidak fail pada attempt pertama.

### Tambahkan test non-retryable

```java
@Test
void shouldNotRetryNonRetryableFailure() {
    ExternalGateway gateway = mock(ExternalGateway.class);
    when(gateway.send(any()))
            .thenThrow(new ValidationRejectedException("invalid payload"));

    GatewayService service = new GatewayService(gateway, RetryPolicy.fixedDelay(3, Duration.ZERO));

    assertThatThrownBy(() -> service.send(command()))
            .isInstanceOf(ValidationRejectedException.class);

    verify(gateway, times(1)).send(any());
}
```

Di sini `times(1)` adalah contract: non-retryable error tidak boleh diretry.

---

## 22. Testing Idempotency dengan Mock dan Fake

Idempotency sering membutuhkan gabungan fake store dan mock external side effect.

```java
@Test
void shouldNotChargeTwiceForSameIdempotencyKey() {
    InMemoryIdempotencyStore idempotencyStore = new InMemoryIdempotencyStore();
    PaymentGateway gateway = mock(PaymentGateway.class);

    when(gateway.charge(any()))
            .thenReturn(PaymentReceipt.of("TX-001"));

    PaymentService service = new PaymentService(idempotencyStore, gateway);

    PaymentCommand command = new PaymentCommand(
            "IDEMP-001",
            "CASE-001",
            new BigDecimal("100.00")
    );

    PaymentReceipt first = service.pay(command);
    PaymentReceipt second = service.pay(command);

    assertThat(first.transactionId()).isEqualTo("TX-001");
    assertThat(second.transactionId()).isEqualTo("TX-001");
    verify(gateway, times(1)).charge(any());
}
```

Test ini kuat karena:

- idempotency store punya behavior real sederhana,
- gateway external dimock,
- interaksi `times(1)` adalah contract penting.

---

## 23. Testing Transaction Boundary

Transaction boundary sering sulit diuji dengan mock biasa.

Contoh buruk:

```java
verify(transactionManager).begin();
verify(repository).save(any());
verify(transactionManager).commit();
```

Ini terlalu implementation-detail.

Lebih baik integration test dengan real transaction manager.

Namun interaction test bisa sah jika kita punya abstraction eksplisit:

```java
interface TransactionRunner {
    <T> T runInTransaction(Supplier<T> work);
}
```

Test:

```java
@Test
void shouldRunApprovalInsideTransaction() {
    TransactionRunner transactionRunner = mock(TransactionRunner.class);
    when(transactionRunner.runInTransaction(any()))
            .thenAnswer(invocation -> {
                Supplier<?> supplier = invocation.getArgument(0);
                return supplier.get();
            });

    ApprovalService service = new ApprovalService(transactionRunner, repository);

    service.approve("CASE-001");

    verify(transactionRunner).runInTransaction(any());
}
```

Tetapi test ini hanya membuktikan service memakai transaction abstraction, bukan membuktikan DB commit/rollback real. Tetap perlu integration test untuk transaction semantics.

---

## 24. Mocking Repository: Kapan Boleh, Kapan Jangan

## 24.1 Kapan Repository Boleh Dimock?

Repository boleh dimock ketika:

- service behavior hanya bergantung pada found/not found;
- DB behavior tidak relevan;
- ingin menguji branch domain cepat;
- repository interface jelas sebagai port;
- integration test repository tersedia di tempat lain.

Contoh:

```java
when(caseRepository.findById(new CaseId("CASE-001")))
        .thenReturn(Optional.empty());

assertThatThrownBy(() -> service.approve("CASE-001"))
        .isInstanceOf(CaseNotFoundException.class);
```

## 24.2 Kapan Repository Jangan Dimock?

Jangan mengandalkan mock repository untuk membuktikan:

- query benar,
- constraint benar,
- transaction rollback benar,
- locking benar,
- pagination benar,
- isolation benar,
- schema migration benar,
- null/empty DB semantics benar,
- vendor-specific SQL benar.

Gunakan integration test dengan real database/Testcontainers.

## 24.3 Fake Repository untuk Domain Test

Fake repository bisa bagus untuk service orchestration:

```java
InMemoryCaseRepository repository = new InMemoryCaseRepository();
repository.save(CaseRecord.submitted("CASE-001"));

service.approve("CASE-001");

assertThat(repository.findById(new CaseId("CASE-001")))
        .get()
        .extracting(CaseRecord::status)
        .isEqualTo(CaseStatus.APPROVED);
```

Tetapi fake repository bukan pengganti repository integration test.

---

## 25. Mocking Security Context dan User Context

Security context sering nondeterministic dan global. Jangan akses security global sembarangan dalam domain service.

Buruk:

```java
String username = SecurityContextHolder.getContext().getAuthentication().getName();
```

Lebih testable:

```java
interface CurrentUserProvider {
    CurrentUser currentUser();
}
```

Test:

```java
CurrentUserProvider currentUserProvider = () -> new CurrentUser("officer-1", Set.of("CASE_APPROVER"));
```

Atau pakai stub:

```java
CurrentUserProvider currentUserProvider = mock(CurrentUserProvider.class);
when(currentUserProvider.currentUser())
        .thenReturn(new CurrentUser("officer-1", Set.of("CASE_APPROVER")));
```

Untuk authorization matrix, fake permission evaluator sering lebih baik:

```java
final class ConfigurablePermissionEvaluator implements PermissionEvaluator {
    private final Set<Permission> allowed = new HashSet<>();

    void allow(Permission permission) {
        allowed.add(permission);
    }

    @Override
    public boolean hasPermission(CurrentUser user, Permission permission) {
        return allowed.contains(permission);
    }
}
```

---

## 26. Mocking Messaging and Outbox

Untuk outbox pattern, jangan hanya verify `publisher.publish()` jika production sebenarnya menulis ke outbox table.

Better unit/domain test:

```java
RecordingOutbox outbox = new RecordingOutbox();
CaseSubmissionService service = new CaseSubmissionService(repository, outbox);

service.submit(command);

assertThat(outbox.messages())
        .singleElement()
        .satisfies(message -> {
            assertThat(message.type()).isEqualTo("CaseSubmitted");
            assertThat(message.aggregateId()).isEqualTo("CASE-001");
        });
```

Integration test:

```text
submit case
  -> DB transaction commits case row and outbox row atomically
  -> outbox worker publishes message
  -> outbox row marked sent
```

Mocking only `publisher` would miss atomicity bugs.

---

## 27. Mocking HTTP Client vs WireMock

Mock interface:

```java
when(profileClient.getProfile("USER-001"))
        .thenReturn(Profile.active("USER-001"));
```

Good for service branch.

WireMock/MockWebServer style test:

```text
Given HTTP endpoint returns 404 JSON error
When Java client calls getProfile
Then client maps it to ProfileNotFoundException
```

This catches:

- wrong path,
- wrong method,
- missing headers,
- serialization error,
- error mapping,
- timeout config,
- retry filter behavior.

Rule:

```text
Mock the port in application service tests.
Test the adapter with HTTP-level fake server.
```

---

## 28. Contract of Collaboration

Mocking paling kuat ketika kita menguji **contract of collaboration**.

Contract of collaboration adalah perjanjian antara class under test dan dependency-nya.

Contoh contract sah:

```text
When case is submitted successfully,
service must publish exactly one CaseSubmitted event
with case id, actor id, timestamp, and source channel.
```

Bukan contract:

```text
Service must call mapper.toEntity before repository.save.
```

Kecuali urutan itu punya efek correctness.

## 28.1 Cara Menentukan Contract Sah

Sebuah interaksi layak diverifikasi jika minimal satu benar:

1. Interaksi menghasilkan side effect eksternal.
2. Interaksi menyentuh dependency mahal/berbahaya.
3. Interaksi adalah policy seperti retry, idempotency, rate limit.
4. Interaksi adalah evidence/audit/regulatory output.
5. Interaksi mencegah bahaya, misalnya payment tidak double.
6. Interaksi diperlukan untuk consistency boundary.
7. Interaksi adalah public port contract.

Jika tidak memenuhi, lebih baik state verification.

---

## 29. Case Study: Approval Service yang Over-Mocked

## 29.1 Versi Buruk

```java
@Test
void approve_shouldCallExpectedDependencies() {
    when(repository.findById(caseId)).thenReturn(Optional.of(caseRecord));
    when(permissionService.canApprove(user, caseRecord)).thenReturn(true);
    when(mapper.toAudit(caseRecord)).thenReturn(auditEntry);

    service.approve(caseId, user);

    verify(repository).findById(caseId);
    verify(permissionService).canApprove(user, caseRecord);
    verify(caseRecord).approve(user);
    verify(repository).save(caseRecord);
    verify(mapper).toAudit(caseRecord);
    verify(auditPublisher).publish(auditEntry);
}
```

Masalah:

- `caseRecord` mungkin mock juga.
- Test mengunci urutan internal.
- Test tidak memastikan status akhir.
- Test tidak memastikan audit content benar.
- Mapper diverifikasi sebagai implementation detail.
- Refactor kecil bisa membuat test gagal.

## 29.2 Versi Lebih Baik

```java
@Test
void shouldApproveSubmittedCaseAndRecordAudit() {
    InMemoryCaseRepository repository = new InMemoryCaseRepository();
    repository.save(CaseRecord.submitted("CASE-001"));

    RecordingAuditSink auditSink = new RecordingAuditSink();
    PermissionService permissionService = (user, action, target) -> true;

    ApprovalService service = new ApprovalService(
            repository,
            permissionService,
            auditSink,
            fixedClock()
    );

    service.approve(new ApproveCaseCommand("CASE-001", "manager-1"));

    CaseRecord approved = repository.findById(new CaseId("CASE-001")).orElseThrow();
    assertThat(approved.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(approved.approvedBy()).isEqualTo("manager-1");

    assertThat(auditSink.entries())
            .singleElement()
            .satisfies(entry -> {
                assertThat(entry.entityId()).isEqualTo("CASE-001");
                assertThat(entry.action()).isEqualTo("APPROVE");
                assertThat(entry.actorId()).isEqualTo("manager-1");
            });
}
```

Lebih baik karena:

- repository fake menyimpan state,
- permission stub sederhana,
- audit fake merekam evidence,
- outcome domain diuji,
- audit content diuji,
- implementation detail tidak dikunci.

---

## 30. Case Study: External Gateway dengan Retry dan Audit

Scenario:

```text
When external screening gateway times out once then succeeds,
service should retry,
store successful screening result,
and record audit event.
```

Test:

```java
@Test
void shouldRetryScreeningGatewayAndStoreSuccessfulResult() {
    ScreeningGateway gateway = mock(ScreeningGateway.class);
    when(gateway.screen(any()))
            .thenThrow(new TransientGatewayException("timeout"))
            .thenReturn(ScreeningResponse.clear("SCREEN-001"));

    InMemoryScreeningRepository repository = new InMemoryScreeningRepository();
    RecordingAuditSink auditSink = new RecordingAuditSink();

    ScreeningService service = new ScreeningService(
            gateway,
            repository,
            auditSink,
            RetryPolicy.maxAttempts(2),
            fixedClock()
    );

    ScreeningResult result = service.screen(new ScreeningCommand("CASE-001", "officer-1"));

    assertThat(result.status()).isEqualTo(ScreeningStatus.CLEAR);

    ScreeningRecord stored = repository.findByCaseId("CASE-001").orElseThrow();
    assertThat(stored.referenceNo()).isEqualTo("SCREEN-001");
    assertThat(stored.status()).isEqualTo(ScreeningStatus.CLEAR);

    verify(gateway, times(2)).screen(any());

    assertThat(auditSink.entries())
            .anySatisfy(entry -> {
                assertThat(entry.action()).isEqualTo("SCREENING_COMPLETED");
                assertThat(entry.entityId()).isEqualTo("CASE-001");
            });
}
```

Di sini kombinasi tepat:

- gateway mock untuk retry verification,
- repository fake untuk state,
- audit fake untuk evidence content.

---

## 31. Testing Negative Side Effects

Sering kali test paling penting adalah memastikan sesuatu **tidak terjadi**.

Contoh regulatory workflow:

```text
Rejected appeal must not trigger license renewal.
```

Test:

```java
@Test
void shouldNotRenewLicenseWhenAppealRejected() {
    LicenseRenewalGateway renewalGateway = mock(LicenseRenewalGateway.class);
    AppealService service = new AppealService(renewalGateway);

    service.rejectAppeal(new RejectAppealCommand("APPEAL-001", "officer-1"));

    verifyNoInteractions(renewalGateway);
}
```

Contoh idempotency:

```java
@Test
void shouldNotPublishSecondEventForDuplicateCommand() {
    EventPublisher publisher = mock(EventPublisher.class);
    InMemoryIdempotencyStore idempotencyStore = new InMemoryIdempotencyStore();
    CaseSubmissionService service = new CaseSubmissionService(idempotencyStore, publisher);

    SubmitCaseCommand command = new SubmitCaseCommand("IDEMP-001", "CASE-001");

    service.submit(command);
    service.submit(command);

    verify(publisher, times(1)).publish(any(CaseSubmittedEvent.class));
}
```

Negative side-effect tests sangat bernilai untuk:

- payment,
- notification,
- audit duplication,
- regulatory transition,
- external submission,
- irreversible operation.

---

## 32. Testing Void Methods

Void method sering dipakai untuk side effect.

## 32.1 Verify Void Method

```java
service.submit(command);

verify(auditPublisher).publish(any(AuditEvent.class));
```

## 32.2 Stub Void Method to Throw

```java
doThrow(new AuditUnavailableException("audit down"))
        .when(auditPublisher)
        .publish(any());
```

Test:

```java
@Test
void shouldFailSubmissionWhenAuditCannotBeRecorded() {
    AuditPublisher auditPublisher = mock(AuditPublisher.class);
    doThrow(new AuditUnavailableException("audit down"))
            .when(auditPublisher)
            .publish(any());

    CaseSubmissionService service = new CaseSubmissionService(auditPublisher);

    assertThatThrownBy(() -> service.submit(command()))
            .isInstanceOf(AuditUnavailableException.class);
}
```

Important question:

```text
Should failure to audit block the business operation?
```

That is not Mockito question. That is domain/reliability requirement.

---

## 33. Avoid Mocking `equals`, `hashCode`, and `toString` Behavior

Jika object perlu equality behavior, gunakan real object.

Buruk:

```java
CaseId caseId = mock(CaseId.class);
when(caseId.value()).thenReturn("CASE-001");
```

Baik:

```java
CaseId caseId = new CaseId("CASE-001");
```

Value object adalah salah satu alat utama untuk membuat test lebih jelas. Jangan hilangkan invariant-nya dengan mock.

---

## 34. Mockito dan Final Classes / Records / Sealed Classes

Java modern membawa:

- records,
- sealed classes,
- pattern matching,
- final-by-default style pada banyak codebase.

Mockito modern lebih mampu memock final class dibanding era lama. Tetapi secara desain:

```text
Kemampuan memock final class bukan berarti final class sebaiknya dimock.
```

Records biasanya value carrier. Jangan mock record.

Contoh:

```java
record SubmitCaseCommand(String caseId, String actorId) {}
```

Gunakan real:

```java
new SubmitCaseCommand("CASE-001", "officer-1")
```

Jangan:

```java
SubmitCaseCommand command = mock(SubmitCaseCommand.class);
```

---

## 35. Mocking in Java 8 vs Java 17/21/25

## 35.1 Java 8

Karakteristik umum:

- Banyak codebase masih JUnit 4.
- Mockito versi lama mungkin terbatas untuk final/static mocking.
- PowerMock sering ditemukan di legacy code.
- Static utility-heavy design umum ditemukan.

Rekomendasi:

- Jangan tambah PowerMock untuk kode baru jika bisa dihindari.
- Introduce seam via interface/wrapper.
- Migrasi perlahan ke JUnit 5 dengan Vintage jika perlu.
- Gunakan `Clock`, `IdGenerator`, dan port abstraction.

## 35.2 Java 11

- Transitional baseline.
- Banyak project mulai JUnit 5.
- JPMS bisa mempengaruhi reflective mocking jika module boundaries ketat.

Rekomendasi:

- Pastikan build test punya module access yang benar.
- Hindari test yang bergantung pada illegal reflective access.

## 35.3 Java 17

- Baseline modern untuk banyak enterprise.
- JUnit 6 membutuhkan Java 17+.
- Records/sealed classes umum.

Rekomendasi:

- Jangan mock records/value objects.
- Gunakan JUnit Jupiter/JUnit 6 sesuai compatibility.
- Mock hanya port/collaborator.

## 35.4 Java 21

- Virtual threads mulai mempengaruhi service design.
- Testing async/concurrent behavior perlu lebih hati-hati.

Mocking concern:

- Mock object biasanya thread-safe enough untuk simple test, tetapi verification dalam concurrent test bisa tricky.
- Untuk concurrent interaction, lebih baik gunakan thread-safe fake/collector.

Contoh thread-safe recording fake:

```java
final class ConcurrentRecordingPublisher implements EventPublisher {
    private final Queue<DomainEvent> events = new ConcurrentLinkedQueue<>();

    @Override
    public void publish(DomainEvent event) {
        events.add(event);
    }

    public List<DomainEvent> events() {
        return List.copyOf(events);
    }
}
```

## 35.5 Java 25

- Treat as modern baseline for forward-looking code.
- Stronger expectation around modern testing stack.
- Avoid legacy static-heavy design.
- Prefer explicit dependencies, records for immutable data, and deterministic fakes.

---

## 36. Mocking and Concurrency

Mocking in concurrent tests can be misleading.

Bad pattern:

```java
verify(publisher, times(100)).publish(any());
```

after concurrent execution without proper synchronization.

Better:

```java
ConcurrentRecordingPublisher publisher = new ConcurrentRecordingPublisher();

runConcurrently(100, () -> service.process(command()));

assertThat(publisher.events()).hasSize(100);
```

Untuk concurrency correctness, jangan mengandalkan Mockito saja. Gunakan:

- deterministic executor,
- fake clock,
- latch/barrier,
- Awaitility,
- jcstress untuk low-level concurrency,
- integration/load test untuk system concurrency.

Mockito cocok untuk collaboration test, bukan memory model proof.

---

## 37. Mocking and Performance Tests

Jangan menggunakan mock untuk menarik kesimpulan performance production.

Contoh misleading:

```java
when(repository.findById(any())).thenReturn(Optional.of(record));
```

Lalu benchmark service dan menyimpulkan service cepat.

Masalah:

- tidak ada DB latency,
- tidak ada serialization,
- tidak ada connection pool,
- tidak ada transaction,
- tidak ada network,
- tidak ada contention,
- tidak ada GC pressure dari real payload.

Mock boleh dipakai dalam microbenchmark untuk mengisolasi logic, tetapi harus jelas scope-nya:

```text
Benchmark ini hanya mengukur CPU cost dari mapping logic,
bukan end-to-end service performance.
```

---

## 38. Mocking and Observability

Dalam production-grade service, side effect observability sering perlu diuji:

- metric increment,
- tracing span attribute,
- log event,
- audit event,
- error classification.

Namun jangan terlalu banyak verify logger call.

Bad:

```java
verify(logger).info("case submitted");
```

Better:

- gunakan structured audit/event sebagai testable output,
- expose metric registry in test,
- verify error classification result,
- gunakan appender test hanya untuk critical logs.

Logging string mudah berubah. Audit/event schema lebih stabil sebagai contract.

---

## 39. Mocking Anti-Patterns

## 39.1 Over-Mocking

Gejala:

- hampir semua object di test adalah mock,
- domain object dimock,
- repository dimock untuk semua test,
- value object dimock,
- mapper dimock,
- test lebih panjang dari production code,
- banyak `verify` implementation detail.

Dampak:

- test pass tapi system rusak,
- refactor mahal,
- confidence palsu,
- integration bug tidak tertangkap,
- behavior tidak jelas.

## 39.2 Mocking Implementation Detail

```java
verify(mapper).toDto(entity);
```

Jika output DTO sudah diasersi, verify mapper biasanya tidak perlu.

## 39.3 Unused Stubbing

```java
when(client.getX()).thenReturn(x);
when(client.getY()).thenReturn(y);
when(client.getZ()).thenReturn(z);
```

Padahal scenario hanya pakai `getX`.

## 39.4 Generic Matchers Everywhere

```java
when(client.call(any(), any(), any())).thenReturn(response);
```

Bug argument salah tidak tertangkap.

## 39.5 Verifying Getters

```java
verify(command).caseId();
```

Ini hampir selalu salah.

## 39.6 Mocking Collections

```java
List<String> list = mock(List.class);
```

Gunakan real list.

## 39.7 Deep Stubs

```java
when(a.getB().getC().getD()).thenReturn(value);
```

Lebih baik real object/factory.

## 39.8 Sleeping with Mock Verification

```java
Thread.sleep(1000);
verify(publisher).publish(any());
```

Gunakan Awaitility atau deterministic executor.

## 39.9 Mocking Private Methods

Jika ingin mock private method, desainnya perlu ditinjau.

Private method adalah implementation detail. Test public behavior.

---

## 40. Practical Decision Framework

Gunakan matrix ini sebelum memilih test double.

| Dependency type | Preferred in unit test | Preferred in integration test |
|---|---|---|
| Value object | Real | Real |
| DTO/command | Real | Real |
| Domain entity | Real | Real |
| Pure domain service | Real | Real |
| Clock | Fixed Clock | Controlled real/fixed |
| ID generator | Fake/fixed | Real/fake depending scenario |
| Repository | Fake or stub | Real DB/Testcontainers |
| External HTTP client port | Mock/stub | WireMock/MockWebServer/contract |
| Email sender | Fake collector/mock | Fake SMTP/provider sandbox |
| Event publisher | Fake collector/mock | Broker/Testcontainers |
| Payment gateway | Mock | Sandbox/contract test |
| Audit sink | Fake collector/mock | Real persistence/integration |
| Permission evaluator | Fake/stub | Real policy integration |
| Cache | Fake/simple real | Real Redis/Testcontainers |
| Message broker | Fake collector | Real broker/Testcontainers |
| Transaction manager | Usually real in integration | Real |
| Logger | Usually not verified | Observability test if critical |

---

## 41. Mocking Checklist untuk Code Review

Saat review test yang memakai mock, tanyakan:

1. Apakah mock ini menggantikan dependency yang memang boundary?
2. Apakah object yang dimock seharusnya value object real?
3. Apakah test memverifikasi behavior atau implementation detail?
4. Apakah `verify(times(n))` benar-benar bagian dari contract?
5. Apakah `verifyNoMoreInteractions` terlalu ketat?
6. Apakah argument matcher terlalu longgar?
7. Apakah `ArgumentCaptor` dipakai untuk assertion yang jelas?
8. Apakah banyak stubbing menandakan service terlalu besar?
9. Apakah fake lebih cocok daripada mock?
10. Apakah integration/contract test tersedia untuk dependency yang dimock?
11. Apakah test tetap valid jika implementation direfactor?
12. Apakah stub yang tidak dipakai akan terdeteksi?
13. Apakah static mock bisa diganti dengan injected dependency?
14. Apakah spy hanya dipakai untuk legacy migration?
15. Apakah test failure akan mudah didiagnosis?

---

## 42. Mocking Guideline untuk Team

Contoh guideline yang bisa dijadikan standar:

```text
1. Do not mock value objects, records, collections, commands, DTOs, or domain entities.
2. Prefer real pure domain services.
3. Prefer fixed Clock over static time mocking.
4. Prefer fake/recording collectors for events, audit, and notifications when content matters.
5. Use mocks for external ports, dangerous side effects, retry, idempotency, and collaboration contracts.
6. Do not verify repository call details unless the interaction itself is the contract.
7. Avoid deep stubs.
8. Avoid spies except for legacy migration.
9. Avoid static mocking in new code; introduce injectable seam instead.
10. Use strict stubbing by default.
11. Avoid lenient stubbing unless documented.
12. Use ArgumentCaptor for complex emitted objects.
13. Keep mock setup local to the test when possible.
14. Every mocked adapter must be covered by separate integration/contract tests.
15. A test with many mocks should trigger a design review.
```

---

## 43. Example: Good Unit Test Shape

```java
@ExtendWith(MockitoExtension.class)
class CaseSubmissionServiceTest {

    @Mock
    ApplicantStatusClient applicantStatusClient;

    @Mock
    ScreeningGateway screeningGateway;

    private InMemoryCaseRepository caseRepository;
    private RecordingAuditSink auditSink;
    private Clock clock;
    private CaseSubmissionService service;

    @BeforeEach
    void setUp() {
        caseRepository = new InMemoryCaseRepository();
        auditSink = new RecordingAuditSink();
        clock = Clock.fixed(Instant.parse("2026-06-16T02:00:00Z"), ZoneOffset.UTC);

        service = new CaseSubmissionService(
                caseRepository,
                applicantStatusClient,
                screeningGateway,
                auditSink,
                clock
        );
    }

    @Test
    void shouldSubmitCaseWhenApplicantIsActiveAndScreeningIsClear() {
        when(applicantStatusClient.getStatus("APP-001"))
                .thenReturn(ApplicantStatus.ACTIVE);
        when(screeningGateway.screen(any()))
                .thenReturn(ScreeningResponse.clear("SCREEN-001"));

        SubmissionResult result = service.submit(new SubmitCaseCommand(
                "CASE-001",
                "APP-001",
                "officer-1"
        ));

        assertThat(result.status()).isEqualTo(SubmissionStatus.SUBMITTED);

        CaseRecord stored = caseRepository.findById(new CaseId("CASE-001")).orElseThrow();
        assertThat(stored.status()).isEqualTo(CaseStatus.SUBMITTED);
        assertThat(stored.applicantId()).isEqualTo("APP-001");

        assertThat(auditSink.entries())
                .anySatisfy(entry -> {
                    assertThat(entry.action()).isEqualTo("CASE_SUBMITTED");
                    assertThat(entry.actorId()).isEqualTo("officer-1");
                    assertThat(entry.timestamp()).isEqualTo(Instant.parse("2026-06-16T02:00:00Z"));
                });

        verify(screeningGateway).screen(argThat(request ->
                request.caseId().equals("CASE-001") &&
                request.applicantId().equals("APP-001")
        ));
    }
}
```

Kenapa bentuk ini cukup kuat?

- External client dimock.
- Repository fake untuk state.
- Audit fake untuk evidence.
- Clock deterministic.
- Assertion fokus pada behavior.
- Interaction verification hanya pada gateway request yang menjadi contract.

---

## 44. Example: Bad Unit Test Shape

```java
@ExtendWith(MockitoExtension.class)
class BadCaseSubmissionServiceTest {

    @Mock CaseRepository caseRepository;
    @Mock ApplicantStatusClient applicantStatusClient;
    @Mock ScreeningGateway screeningGateway;
    @Mock AuditSink auditSink;
    @Mock CaseMapper mapper;
    @Mock CaseRecord caseRecord;
    @Mock SubmitCaseCommand command;

    @InjectMocks CaseSubmissionService service;

    @Test
    void shouldSubmit() {
        when(command.caseId()).thenReturn("CASE-001");
        when(command.applicantId()).thenReturn("APP-001");
        when(command.actorId()).thenReturn("officer-1");
        when(applicantStatusClient.getStatus(anyString())).thenReturn(ApplicantStatus.ACTIVE);
        when(screeningGateway.screen(any())).thenReturn(ScreeningResponse.clear("SCREEN-001"));
        when(mapper.toRecord(command)).thenReturn(caseRecord);

        service.submit(command);

        verify(command).caseId();
        verify(command).applicantId();
        verify(applicantStatusClient).getStatus(anyString());
        verify(mapper).toRecord(command);
        verify(caseRepository).save(caseRecord);
        verify(auditSink).record(any());
    }
}
```

Masalah:

- command dimock padahal harus real.
- caseRecord dimock padahal domain object harus real.
- mapper diverifikasi sebagai detail.
- `anyString` terlalu longgar.
- tidak ada assertion state.
- audit content tidak dicek.
- service construction tersembunyi.

---

## 45. Mocking untuk Legacy Code

Legacy code sering tidak punya dependency injection.

Contoh:

```java
class LegacyCaseService {
    public void submit(String caseId) {
        String user = SecurityContextHolder.getContext().getAuthentication().getName();
        String id = UUID.randomUUID().toString();
        LocalDateTime now = LocalDateTime.now();
        ExternalClient.submit(caseId, user, id, now);
    }
}
```

Sulit ditest tanpa static mocking.

## 45.1 Strategy Bertahap

Langkah 1: characterization test jika perlu.

Langkah 2: introduce seam.

```java
interface CurrentUserProvider {
    String currentUserId();
}

interface IdGenerator {
    String nextId();
}

interface TimeProvider {
    LocalDateTime now();
}

interface CaseSubmissionGateway {
    void submit(String caseId, String userId, String requestId, LocalDateTime timestamp);
}
```

Langkah 3: refactor service.

```java
class CaseService {
    private final CurrentUserProvider currentUserProvider;
    private final IdGenerator idGenerator;
    private final TimeProvider timeProvider;
    private final CaseSubmissionGateway gateway;

    CaseService(
            CurrentUserProvider currentUserProvider,
            IdGenerator idGenerator,
            TimeProvider timeProvider,
            CaseSubmissionGateway gateway
    ) {
        this.currentUserProvider = currentUserProvider;
        this.idGenerator = idGenerator;
        this.timeProvider = timeProvider;
        this.gateway = gateway;
    }

    public void submit(String caseId) {
        gateway.submit(
                caseId,
                currentUserProvider.currentUserId(),
                idGenerator.nextId(),
                timeProvider.now()
        );
    }
}
```

Langkah 4: test tanpa static mock.

```java
@Test
void shouldSubmitCaseWithUserIdRequestIdAndTimestamp() {
    CurrentUserProvider userProvider = () -> "officer-1";
    IdGenerator idGenerator = () -> "REQ-001";
    TimeProvider timeProvider = () -> LocalDateTime.parse("2026-06-16T10:00:00");
    CaseSubmissionGateway gateway = mock(CaseSubmissionGateway.class);

    CaseService service = new CaseService(userProvider, idGenerator, timeProvider, gateway);

    service.submit("CASE-001");

    verify(gateway).submit(
            "CASE-001",
            "officer-1",
            "REQ-001",
            LocalDateTime.parse("2026-06-16T10:00:00")
    );
}
```

---

## 46. Test Double Placement in Hexagonal Architecture

Dalam port-adapter architecture:

```text
Domain/Application Core
        |
        | uses ports
        v
Outbound Port Interfaces
        |
        | implemented by
        v
Adapters: DB, HTTP, Broker, Email, File, Cache
```

Testing strategy:

```text
Application service unit test:
- use fake/mock outbound port
- real domain model

Adapter integration test:
- real adapter
- fake external server or Testcontainers

End-to-end/system test:
- selected real dependencies
```

Mocking adapter implementation dari dalam core test biasanya salah level. Mock port interface, bukan detail HTTP client internal.

---

## 47. Test Doubles and Regulatory Defensibility

Untuk sistem regulasi, test bukan hanya untuk developer confidence. Test juga bisa menjadi evidence bahwa:

- state transition dikontrol,
- unauthorized action ditolak,
- audit dicatat,
- decision memiliki reason,
- SLA dihitung konsisten,
- external action tidak double,
- retry tidak menyebabkan duplicate side effect.

Mocking harus mendukung evidence ini.

Contoh poor evidence:

```java
verify(auditService).audit(any());
```

Better evidence:

```java
assertThat(auditSink.entries())
        .singleElement()
        .satisfies(entry -> {
            assertThat(entry.entityType()).isEqualTo("CASE");
            assertThat(entry.entityId()).isEqualTo("CASE-001");
            assertThat(entry.action()).isEqualTo("APPROVE");
            assertThat(entry.actorId()).isEqualTo("manager-1");
            assertThat(entry.reason()).isEqualTo("ALL_REQUIREMENTS_MET");
            assertThat(entry.beforeState()).isEqualTo("UNDER_REVIEW");
            assertThat(entry.afterState()).isEqualTo("APPROVED");
        });
```

Top-tier test tidak hanya bertanya:

```text
Was audit called?
```

Tetapi:

```text
Is the audit record defensible?
```

---

## 48. Common Mockito API Cheat Sheet

```java
// create mock
MyClient client = mock(MyClient.class);

// stub return
when(client.get("A")).thenReturn(value);

// stub exception
when(client.get("A")).thenThrow(new RuntimeException("boom"));

// void exception
doThrow(new RuntimeException("boom")).when(client).send(any());

// verify once
verify(client).send(any());

// verify times
verify(client, times(2)).send(any());

// verify never
verify(client, never()).send(any());

// verify no interactions
verifyNoInteractions(client);

// verify no more interactions
verifyNoMoreInteractions(client);

// argument captor
ArgumentCaptor<Event> captor = ArgumentCaptor.forClass(Event.class);
verify(publisher).publish(captor.capture());
Event event = captor.getValue();

// custom matcher
verify(publisher).publish(argThat(event -> event.type().equals("SUBMITTED")));

// sequential stubbing
when(client.call()).thenThrow(timeout()).thenReturn(success());

// answer
when(repository.findById(any())).thenAnswer(invocation -> {
    CaseId id = invocation.getArgument(0);
    return Optional.ofNullable(records.get(id));
});

// spy
MyService spy = spy(new MyService());

// static mock
try (MockedStatic<UUID> mocked = mockStatic(UUID.class)) {
    mocked.when(UUID::randomUUID).thenReturn(fixedUuid);
}
```

---

## 49. Latihan Mandiri

## 49.1 Refactor Over-Mocked Test

Ambil test yang memiliki minimal 5 mock. Klasifikasikan setiap mock:

```text
- real object?
- fake?
- stub?
- mock?
- remove?
```

Target refactor:

- domain object real,
- repository fake jika cocok,
- external port mock,
- event/audit fake collector,
- fewer verify calls.

## 49.2 Buat Recording Fake

Buat fake untuk:

- `AuditSink`,
- `EventPublisher`,
- `EmailSender`,
- `OutboxWriter`.

Pastikan fake menyediakan assertion-friendly API.

## 49.3 Identify Contract Interactions

Untuk sebuah service, tandai interaction mana yang contract:

- retry gateway,
- save repository,
- publish event,
- map DTO,
- validate command,
- reserve idempotency key,
- update cache,
- send email.

Pisahkan mana yang perlu `verify`, mana yang cukup state assertion.

## 49.4 Replace Static Mock

Cari kode yang memakai:

- `LocalDateTime.now()`,
- `UUID.randomUUID()`,
- `SecurityContextHolder`,
- static external client.

Buat seam:

- `Clock`,
- `IdGenerator`,
- `CurrentUserProvider`,
- outbound port.

---

## 50. Summary

Mocking adalah alat kuat, tetapi mudah menjadi sumber confidence palsu.

Mental model utama:

```text
Do not ask: “Can I mock this?”
Ask: “What evidence do I lose or gain by replacing this dependency?”
```

Prinsip terpenting:

1. Test double adalah pengganti dependency dengan tujuan tertentu.
2. Dummy hanya mengisi parameter.
3. Stub memberi jawaban.
4. Fake punya behavior sederhana yang bekerja.
5. Mock memverifikasi interaksi.
6. Spy membungkus object real dan biasanya cocok untuk legacy migration.
7. Prefer state verification untuk domain behavior.
8. Use interaction verification untuk side effect yang menjadi contract.
9. Jangan mock value object, DTO, command, collection, atau domain object kecil.
10. Jangan verify implementation detail.
11. Fake sering lebih baik daripada mock untuk repository sederhana, audit collector, event collector, dan clock.
12. Mock external boundary, bukan semua dependency.
13. Strict stubbing membantu menjaga test tetap bersih.
14. Static mocking adalah escape hatch, bukan default design.
15. Setiap dependency yang dimock pada unit test tetap butuh integration/contract coverage pada level lain jika behavior eksternalnya penting.

Top-tier engineer tidak anti-mock dan tidak mock-happy. Mereka memilih test double berdasarkan risiko, evidence, dan boundary.

---

## 51. Checklist Cepat

Sebelum commit test dengan mock:

```text
[ ] Apakah object ini memang dependency, bukan value object?
[ ] Apakah mock ini berada di boundary yang tepat?
[ ] Apakah interaksi yang diverifikasi adalah contract?
[ ] Apakah state akhir juga sudah diasersi jika relevan?
[ ] Apakah argument matcher cukup spesifik?
[ ] Apakah ArgumentCaptor diperlukan untuk diagnosis lebih baik?
[ ] Apakah fake lebih cocok?
[ ] Apakah test akan tetap pass jika implementation direfactor tanpa mengubah behavior?
[ ] Apakah strict stubbing aktif?
[ ] Apakah tidak ada deep stub?
[ ] Apakah tidak ada static mock untuk kode baru?
[ ] Apakah adapter yang dimock punya integration/contract test?
```

---

## 52. Referensi

- Mockito Documentation and Javadoc: https://site.mockito.org/ and https://javadoc.io/doc/org.mockito/mockito-core
- Mockito JUnit Jupiter: https://javadoc.io/doc/org.mockito/mockito-junit-jupiter
- JUnit User Guide: https://docs.junit.org/
- Martin Fowler, “Mocks Aren't Stubs”: https://martinfowler.com/articles/mocksArentStubs.html
- Martin Fowler, “Test Double”: https://martinfowler.com/bliki/TestDouble.html
- Google Testing Blog, “Testing State vs. Testing Interactions”: https://testing.googleblog.com/2013/03/testing-on-toilet-testing-state-vs.html
- Google Software Engineering, Chapter 14, Larger Tests: https://abseil.io/resources/swe-book/html/ch14.html

---

## 53. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 berikutnya: Testing Domain Logic, State Machine, Workflow, dan Business Invariant
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-005](./learn-java-testing-benchmarking-performance-jvm-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-007](./learn-java-testing-benchmarking-performance-jvm-part-007.md)

</div>