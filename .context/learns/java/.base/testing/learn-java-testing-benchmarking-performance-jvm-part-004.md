# learn-java-testing-benchmarking-performance-jvm-part-004

# Assertion Engineering: AssertJ, Hamcrest, Custom Assertion, dan Failure Diagnostics

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `004`  
> Topik: Assertion engineering, diagnostic quality, AssertJ, Hamcrest, JUnit assertions, custom domain assertions  
> Target Java: Java 8 hingga Java 25  
> Status: Materi lanjutan; tidak mengulang unit testing dasar

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas desain test: bagaimana test harus menyatakan behavior, bukan sekadar mengeksekusi method. Part ini masuk ke titik yang lebih spesifik tetapi sangat menentukan kualitas test suite: **assertion**.

Assertion adalah bagian test yang menjawab pertanyaan:

> Setelah sistem diberi stimulus tertentu, bukti apa yang cukup untuk mengatakan behavior-nya benar?

Banyak engineer menganggap assertion hanya sebagai `assertEquals(expected, actual)`. Itu terlalu sempit. Dalam sistem enterprise, terutama sistem yang punya workflow, audit, authorization, persistence, async processing, dan regulatory defensibility, assertion adalah **alat diagnosis dan alat pembuktian**.

Test yang baik bukan hanya gagal ketika bug terjadi. Test yang baik harus gagal dengan informasi yang cukup sehingga engineer bisa memahami:

1. behavior apa yang rusak,
2. nilai aktual apa yang tidak sesuai,
3. invariant apa yang dilanggar,
4. konteks domain apa yang relevan,
5. apakah kegagalan itu bug, test fixture error, data issue, race, atau mismatch ekspektasi.

Google Testing Blog menekankan bahwa ketika test gagal, developer seharusnya dapat mulai investigasi hanya dari nama test dan failure message, tanpa harus menambah logging lalu menjalankan ulang test. Ini adalah prinsip utama assertion engineering.

Part ini akan membahas:

- mental model assertion sebagai evidence boundary,
- perbedaan JUnit assertion, AssertJ, dan Hamcrest,
- kapan memakai assertion biasa, fluent assertion, matcher, custom assertion, atau domain assertion,
- bagaimana membuat failure message yang actionable,
- assertion untuk object graph, collection, exception, JSON, time, monetary value, state machine, authorization, audit trail, idempotency, dan eventual consistency,
- anti-pattern assertion yang membuat test rapuh atau sulit didiagnosis,
- strategi assertion untuk Java 8 hingga Java 25.

---

## 1. Mental Model: Assertion Adalah Boundary antara Stimulus dan Evidence

Sebuah test secara sederhana punya struktur:

```java
// Arrange
// Act
// Assert
```

Namun dalam engineering yang lebih serius, struktur itu bisa dibaca seperti ini:

```text
Context
  -> Stimulus
  -> Observation
  -> Evidence Evaluation
```

Assertion berada pada dua tahap terakhir:

```text
Observation
  = data/side-effect/event/state yang diamati setelah action

Evidence Evaluation
  = aturan untuk memutuskan apakah observation membuktikan behavior yang benar
```

Contoh sederhana:

```java
assertEquals(APPROVED, application.getStatus());
```

Ini hanya memeriksa satu field. Dalam sistem workflow regulatory, behavior “approval berhasil” mungkin tidak cukup dibuktikan oleh status saja. Evidence yang lebih lengkap mungkin:

```text
- status berubah menjadi APPROVED
- approvedAt terisi
- approvedBy sesuai user yang melakukan action
- previous status tercatat
- audit trail dibuat
- decision reason tersimpan
- notification event dikirim
- tidak ada duplicate event
- permission dievaluasi benar
- SLA clock berhenti
```

Maka assertion yang kuat bukan sekadar:

```java
assertEquals(APPROVED, application.getStatus());
```

melainkan:

```java
assertThat(application)
    .hasStatus(APPROVED)
    .hasApprovedBy(officerId)
    .hasDecisionReason("All requirements fulfilled")
    .hasStoppedSlaClock();

assertThat(auditTrail)
    .recordsTransition(applicationId, SUBMITTED, APPROVED)
    .performedBy(officerId)
    .withReason("All requirements fulfilled");

assertThat(events)
    .containsExactlyOneApprovalNotificationFor(applicationId);
```

Ini bukan soal gaya API. Ini soal **apa yang dianggap cukup sebagai bukti**.

---

## 2. Assertion Quality Menentukan Debugging Cost

Test yang gagal bisa memberi dua pengalaman yang sangat berbeda.

### 2.1 Assertion Buruk

```java
assertTrue(result.isValid());
```

Ketika gagal:

```text
expected: <true> but was: <false>
```

Masalah:

- Tidak tahu input mana yang gagal.
- Tidak tahu rule mana yang dilanggar.
- Tidak tahu actual error-nya apa.
- Tidak tahu apakah validator gagal karena missing field, invalid transition, permission, date, atau dependency.
- Developer harus membuka debugger atau menambah logging.

### 2.2 Assertion Lebih Baik

```java
assertThat(result.errors())
    .extracting(ValidationError::code)
    .containsExactly("APPLICATION_TYPE_REQUIRED", "APPLICANT_ID_REQUIRED");
```

Failure message akan lebih jelas:

```text
Expecting actual:
  ["APPLICATION_TYPE_REQUIRED"]
to contain exactly:
  ["APPLICATION_TYPE_REQUIRED", "APPLICANT_ID_REQUIRED"]
but could not find:
  ["APPLICANT_ID_REQUIRED"]
```

Ini langsung memberi arah investigasi.

### 2.3 Assertion Domain-Specific

```java
assertThat(validationResult)
    .isInvalid()
    .hasError("APPLICATION_TYPE_REQUIRED")
    .hasError("APPLICANT_ID_REQUIRED")
    .hasNoUnexpectedErrors();
```

Kelebihan:

- Test membaca seperti business rule.
- Failure bisa dibuat sangat domain-aware.
- Reusable di banyak test.
- Mengurangi noise assertion teknis.

---

## 3. Assertion sebagai Contract, Bukan Sekadar Perbandingan Nilai

Assertion harus menjawab contract yang sedang diuji.

| Contract yang diuji | Assertion yang tepat | Assertion yang biasanya lemah |
|---|---|---|
| Return value | Compare value/object relevant fields | `assertNotNull(result)` |
| Domain invariant | Domain-specific assertion | `assertTrue(object.isValid())` |
| Exception | Type + message/code + state unchanged | hanya `assertThrows(Exception.class)` |
| State transition | from-state, to-state, actor, timestamp, side-effect | hanya status akhir |
| Authorization | allowed/denied + reason + no side-effect | hanya HTTP 403 |
| Persistence | row state + transaction effect + constraints | hanya repository tidak throw |
| Event publishing | payload + key + metadata + exactly-once expectation | hanya mock `publish()` dipanggil |
| Retry | attempt count + retryable error + final effect | hanya result sukses |
| Idempotency | repeated call yields same durable effect | hanya response kedua sukses |
| Performance regression | distribution + allocation + threshold | hanya duration lokal sekali run |

Salah satu tanda assertion buruk adalah ketika assertion tidak menjawab risiko utama dari behavior.

Misalnya risiko utama workflow approval bukan “method return non-null”, tetapi:

```text
- unauthorized user tidak bisa approve
- status tidak lompat melewati review
- audit trail tidak hilang
- decision reason wajib ada
- approval tidak double-publish notification
- failure tidak meninggalkan partial state
```

Maka assertion harus diarahkan ke risiko itu.

---

## 4. Toolkit Assertion di Java

Di ekosistem Java modern, assertion biasanya berasal dari beberapa layer:

1. JUnit built-in assertions.
2. AssertJ fluent assertions.
3. Hamcrest matchers.
4. Framework-specific assertions, seperti Spring MockMvc, JSONAssert, Awaitility, Reactor StepVerifier.
5. Custom assertion.
6. Domain-specific assertion DSL.

Tidak ada satu tool yang selalu paling benar. Pilihan tergantung jenis evidence yang ingin dievaluasi.

---

## 5. JUnit Assertions

JUnit Jupiter menyediakan assertion statis melalui `org.junit.jupiter.api.Assertions`. JUnit 6 tetap mempertahankan gaya dasar ini, dan menambahkan fondasi modern untuk testing JVM dengan requirement Java 17+.

Contoh umum:

```java
import static org.junit.jupiter.api.Assertions.*;

@Test
void shouldCalculateTotalAmount() {
    BigDecimal total = invoice.totalAmount();

    assertEquals(new BigDecimal("125.00"), total);
}
```

### 5.1 Assertion Dasar

```java
assertEquals(expected, actual);
assertNotEquals(unexpected, actual);
assertTrue(condition);
assertFalse(condition);
assertNull(value);
assertNotNull(value);
assertSame(expectedReference, actualReference);
assertNotSame(unexpectedReference, actualReference);
```

### 5.2 Assertion Exception

```java
InvalidTransitionException ex = assertThrows(
    InvalidTransitionException.class,
    () -> workflow.approve(applicationId, officer)
);

assertEquals("INVALID_TRANSITION", ex.code());
```

`assertThrows` lebih baik daripada pola lama:

```java
try {
    workflow.approve(applicationId, officer);
    fail("Expected exception");
} catch (InvalidTransitionException ex) {
    assertEquals("INVALID_TRANSITION", ex.code());
}
```

Namun dalam kasus kompleks, AssertJ sering lebih ekspresif untuk exception.

### 5.3 Assertion Timeout

```java
assertTimeout(Duration.ofMillis(500), () -> {
    service.calculateReport(request);
});
```

Perlu hati-hati: timeout assertion sering flaky jika dipakai sebagai performance test kecil. Gunakan untuk guard terhadap blocking yang jelas, bukan sebagai benchmark.

### 5.4 `assertAll`

JUnit punya `assertAll` untuk menjalankan beberapa assertion dan melaporkan beberapa failure sekaligus.

```java
assertAll(
    () -> assertEquals(APPROVED, application.status()),
    () -> assertEquals(officerId, application.approvedBy()),
    () -> assertNotNull(application.approvedAt())
);
```

Ini berguna ketika semua assertion berada dalam satu behavior yang sama. Jangan gunakan `assertAll` untuk menggabungkan behavior berbeda dalam satu test.

### 5.5 Lazy Message Supplier

JUnit assertion message bisa memakai `Supplier<String>` agar message mahal hanya dibuat ketika gagal.

```java
assertEquals(
    APPROVED,
    application.status(),
    () -> "Expected application " + application.id() + " to be approved, actual=" + application
);
```

Prinsip:

- Message harus menjelaskan **kenapa expectation itu penting**, bukan mengulang expected/actual yang sudah dicetak.
- Jangan membuat message generik seperti `"failed"`, `"wrong"`, `"not equal"`.

### 5.6 Kapan JUnit Assertions Cukup?

JUnit assertions cukup untuk:

- nilai primitif sederhana,
- equality sederhana,
- nullability sederhana,
- exception type sederhana,
- grouped assertion ringan,
- test kecil yang failure-nya sudah jelas dari nama test.

Namun untuk object graph, collection, nested DTO, JSON, domain result, exception detail, atau failure diagnostic yang kaya, AssertJ biasanya lebih baik.

---

## 6. AssertJ: Fluent Assertion untuk Diagnosis yang Lebih Kaya

AssertJ adalah assertion library fluent untuk Java/JVM. Kekuatannya ada pada:

- API yang readable,
- error message yang kaya,
- assertion untuk collection, optional, exception, date/time, file, path, map, throwable,
- recursive comparison,
- soft assertions,
- extensibility untuk custom assertions.

Import umum:

```java
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
```

### 6.1 Basic AssertJ

```java
assertThat(application.status()).isEqualTo(APPROVED);
assertThat(application.approvedAt()).isNotNull();
assertThat(application.tags()).contains("HIGH_RISK", "MANUAL_REVIEW");
assertThat(application.errors()).isEmpty();
```

Dibanding JUnit:

```java
assertEquals(APPROVED, application.status());
assertNotNull(application.approvedAt());
assertTrue(application.tags().contains("HIGH_RISK"));
assertTrue(application.errors().isEmpty());
```

AssertJ lebih ekspresif dan failure message-nya biasanya lebih informatif.

---

## 7. AssertJ untuk Collection

Collection assertion adalah salah satu area tempat AssertJ sangat kuat.

### 7.1 Contains vs ContainsExactly

```java
assertThat(errors)
    .contains("APPLICATION_TYPE_REQUIRED", "APPLICANT_ID_REQUIRED");
```

Artinya: minimal mengandung dua error itu, urutan tidak penting, error tambahan masih boleh ada.

```java
assertThat(errors)
    .containsExactly("APPLICATION_TYPE_REQUIRED", "APPLICANT_ID_REQUIRED");
```

Artinya: harus persis dua error itu, urutan sama.

```java
assertThat(errors)
    .containsExactlyInAnyOrder("APPLICATION_TYPE_REQUIRED", "APPLICANT_ID_REQUIRED");
```

Artinya: harus persis dua error itu, urutan tidak penting.

### 7.2 Pilih Semantik yang Tepat

Kesalahan umum adalah memakai `contains` padahal contract-nya tidak boleh ada error tambahan.

Buruk:

```java
assertThat(errors).contains("APPLICATION_TYPE_REQUIRED");
```

Jika actual error:

```text
APPLICATION_TYPE_REQUIRED
UNEXPECTED_DATABASE_ERROR
```

Test tetap pass. Ini berbahaya.

Lebih baik:

```java
assertThat(errors)
    .containsExactly("APPLICATION_TYPE_REQUIRED");
```

atau domain assertion:

```java
assertThat(validationResult)
    .hasOnlyErrors("APPLICATION_TYPE_REQUIRED");
```

### 7.3 Extracting Field

```java
assertThat(validationResult.errors())
    .extracting(ValidationError::code)
    .containsExactlyInAnyOrder(
        "APPLICATION_TYPE_REQUIRED",
        "APPLICANT_ID_REQUIRED"
    );
```

### 7.4 Extracting Multiple Fields

```java
assertThat(auditTrails)
    .extracting(AuditTrail::activity, AuditTrail::module, AuditTrail::actorId)
    .containsExactly(
        tuple("APPROVE", "APPLICATION", officerId),
        tuple("NOTIFY", "APPLICATION", officerId)
    );
```

Import:

```java
import static org.assertj.core.api.Assertions.tuple;
```

Ini sangat berguna untuk audit trail, event list, validation result, state history, dan DTO collection.

### 7.5 Filtering

```java
assertThat(auditTrails)
    .filteredOn(audit -> audit.activity().equals("APPROVE"))
    .singleElement()
    .satisfies(audit -> {
        assertThat(audit.actorId()).isEqualTo(officerId);
        assertThat(audit.entityId()).isEqualTo(applicationId);
    });
```

Gunakan filtering ketika collection mengandung beberapa jenis event dan test hanya ingin membuktikan event tertentu.

### 7.6 Anti-Pattern: Loop Manual dengan `assertTrue`

Buruk:

```java
boolean found = false;
for (AuditTrail audit : auditTrails) {
    if (audit.activity().equals("APPROVE")) {
        found = true;
    }
}
assertTrue(found);
```

Masalah:

- Failure message miskin.
- Tidak menunjukkan isi collection.
- Tidak mengecek uniqueness.
- Banyak boilerplate.

Lebih baik:

```java
assertThat(auditTrails)
    .extracting(AuditTrail::activity)
    .contains("APPROVE");
```

atau:

```java
assertThat(auditTrails)
    .filteredOn(audit -> audit.activity().equals("APPROVE"))
    .hasSize(1);
```

---

## 8. AssertJ Recursive Comparison

Dalam enterprise Java, banyak test perlu membandingkan DTO besar, nested object, response API, atau event payload. Menulis assertion field-by-field bisa verbose, tetapi memakai `equals` juga sering tidak ideal.

AssertJ menyediakan recursive comparison:

```java
assertThat(actualResponse)
    .usingRecursiveComparison()
    .isEqualTo(expectedResponse);
```

### 8.1 Kapan Recursive Comparison Cocok?

Cocok untuk:

- DTO response,
- command/result object,
- event payload,
- projection object,
- read model,
- immutable nested data,
- object yang tidak punya `equals` domain-specific.

Tidak selalu cocok untuk:

- entity dengan identity/lifecycle,
- object yang punya lazy association,
- object dengan field volatile seperti timestamp/generated ID,
- object dengan reference cycle,
- object yang equality-nya memang business-specific.

### 8.2 Ignore Field Dinamis

```java
assertThat(actualEvent)
    .usingRecursiveComparison()
    .ignoringFields("eventId", "occurredAt", "metadata.traceId")
    .isEqualTo(expectedEvent);
```

### 8.3 Comparator Khusus untuk Type

```java
assertThat(actualPayment)
    .usingRecursiveComparison()
    .withComparatorForType(BigDecimal::compareTo, BigDecimal.class)
    .isEqualTo(expectedPayment);
```

Ini penting karena `BigDecimal.equals` mempertimbangkan scale:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00")) // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) // 0
```

Dalam domain monetary, biasanya compareTo lebih tepat, tetapi tidak selalu. Jika scale penting, misalnya financial statement formatting, `equals` bisa valid.

### 8.4 Comparator untuk Field Tertentu

```java
assertThat(actualApplication)
    .usingRecursiveComparison()
    .withComparatorForFields(
        Comparator.comparing(Instant::toEpochMilli),
        "submittedAt",
        "approvedAt"
    )
    .isEqualTo(expectedApplication);
```

### 8.5 Ignore Expected Null Fields

```java
assertThat(actualResponse)
    .usingRecursiveComparison()
    .ignoringExpectedNullFields()
    .isEqualTo(expectedPartialResponse);
```

Gunakan hati-hati. Ini bisa membuat test terlalu longgar jika expected object tidak lengkap.

### 8.6 Anti-Pattern Recursive Comparison

Buruk:

```java
assertThat(actualEntity)
    .usingRecursiveComparison()
    .ignoringFields("id", "createdAt", "updatedAt", "version", "status", "auditTrails")
    .isEqualTo(expectedEntity);
```

Jika terlalu banyak field di-ignore, assertion kehilangan makna. Ini tanda bahwa:

- expected object tidak didesain baik,
- assertion terlalu luas,
- test mencoba membandingkan entity internal alih-alih behavior,
- perlu custom assertion domain-specific.

---

## 9. AssertJ Soft Assertions

Soft assertions memungkinkan beberapa assertion dieksekusi dulu, lalu semua failure dilaporkan bersama.

```java
SoftAssertions.assertSoftly(softly -> {
    softly.assertThat(application.status()).isEqualTo(APPROVED);
    softly.assertThat(application.approvedBy()).isEqualTo(officerId);
    softly.assertThat(application.approvedAt()).isNotNull();
});
```

### 9.1 Kapan Soft Assertions Berguna?

Berguna ketika:

- memvalidasi banyak field DTO,
- semua assertion adalah bagian dari satu behavior,
- ingin satu failure report yang lengkap,
- debugging akan lebih cepat jika semua mismatch terlihat.

### 9.2 Kapan Jangan Pakai Soft Assertions?

Jangan pakai untuk:

- menggabungkan behavior berbeda dalam satu test,
- menghindari pemecahan test yang terlalu besar,
- assertion yang tahap lanjut tergantung assertion sebelumnya.

Buruk:

```java
SoftAssertions.assertSoftly(softly -> {
    softly.assertThat(loginResult.success()).isTrue();
    softly.assertThat(orderResult.status()).isEqualTo(CONFIRMED);
    softly.assertThat(reportResult.total()).isEqualTo(10);
});
```

Ini tiga behavior berbeda. Pecah menjadi test berbeda.

---

## 10. Assertion untuk Exception

Exception assertion harus lebih dari sekadar “exception dilempar”.

### 10.1 JUnit Style

```java
InvalidTransitionException ex = assertThrows(
    InvalidTransitionException.class,
    () -> workflow.approve(applicationId, reviewer)
);

assertEquals("INVALID_TRANSITION", ex.code());
assertEquals(SUBMITTED, ex.currentStatus());
assertEquals(APPROVED, ex.requestedStatus());
```

### 10.2 AssertJ Style

```java
assertThatThrownBy(() -> workflow.approve(applicationId, reviewer))
    .isInstanceOf(InvalidTransitionException.class)
    .hasMessageContaining("Cannot approve application")
    .extracting("code")
    .isEqualTo("INVALID_TRANSITION");
```

Namun `extracting("code")` berbasis reflection/string field name. Untuk domain exception penting, lebih baik cast:

```java
Throwable thrown = catchThrowable(() -> workflow.approve(applicationId, reviewer));

assertThat(thrown)
    .isInstanceOfSatisfying(InvalidTransitionException.class, ex -> {
        assertThat(ex.code()).isEqualTo("INVALID_TRANSITION");
        assertThat(ex.currentStatus()).isEqualTo(SUBMITTED);
        assertThat(ex.requestedStatus()).isEqualTo(APPROVED);
    });
```

### 10.3 Assert No Side Effect Setelah Exception

Sering kali contract error bukan hanya “throw exception”, tetapi juga “state tidak berubah”.

```java
assertThatThrownBy(() -> workflow.approve(applicationId, unauthorizedUser))
    .isInstanceOf(AccessDeniedException.class);

Application after = applicationRepository.findById(applicationId).orElseThrow();

assertThat(after.status()).isEqualTo(SUBMITTED);
assertThat(auditRepository.findByEntityId(applicationId))
    .extracting(AuditTrail::activity)
    .doesNotContain("APPROVE");

assertThat(eventPublisher.publishedEvents()).isEmpty();
```

Ini jauh lebih kuat daripada hanya memastikan exception dilempar.

### 10.4 Exception Anti-Pattern

Buruk:

```java
assertThrows(Exception.class, () -> service.process(request));
```

Masalah:

- Terlalu umum.
- Bisa pass karena `NullPointerException`, padahal seharusnya `ValidationException`.
- Tidak menguji error semantics.

Lebih baik:

```java
ValidationException ex = assertThrows(
    ValidationException.class,
    () -> service.process(request)
);

assertThat(ex.errors())
    .extracting(ValidationError::code)
    .containsExactly("APPLICANT_ID_REQUIRED");
```

---

## 11. Assertion untuk Optional, Either, Result, dan Domain Outcome

Banyak codebase modern tidak selalu memakai exception untuk domain failure. Bisa memakai `Optional`, `Either`, `Result`, atau custom outcome.

### 11.1 Optional

```java
assertThat(repository.findById(applicationId))
    .isPresent()
    .get()
    .extracting(Application::status)
    .isEqualTo(APPROVED);
```

Untuk readability, kadang lebih baik:

```java
Optional<Application> found = repository.findById(applicationId);

assertThat(found).isPresent();
assertThat(found.orElseThrow().status()).isEqualTo(APPROVED);
```

Jangan terlalu memaksakan fluent chain jika mengurangi clarity.

### 11.2 Result Object

Misalnya:

```java
public record CommandResult(
    boolean success,
    String code,
    List<ValidationError> errors,
    UUID entityId
) {}
```

Assertion umum:

```java
assertThat(result.success()).isFalse();
assertThat(result.code()).isEqualTo("VALIDATION_FAILED");
assertThat(result.errors())
    .extracting(ValidationError::code)
    .containsExactly("APPLICANT_ID_REQUIRED");
```

Domain assertion lebih baik:

```java
assertThat(result)
    .isRejectedWithCode("VALIDATION_FAILED")
    .hasOnlyErrors("APPLICANT_ID_REQUIRED");
```

---

## 12. Custom Assertion: Mengubah Assertion menjadi Bahasa Domain

Custom assertion adalah teknik untuk membuat test membaca seperti business rule.

### 12.1 Kapan Custom Assertion Layak Dibuat?

Buat custom assertion ketika:

- assertion yang sama muncul berulang,
- failure message bawaan kurang domain-aware,
- object punya banyak field yang membentuk satu semantic concept,
- test menjadi penuh getter teknis,
- assertion harus melindungi invariant penting,
- domain seperti workflow, audit, authorization, atau money sering diuji.

Jangan buat custom assertion hanya untuk membungkus satu baris trivial.

### 12.2 Contoh Domain: Application Assertion

Production object:

```java
public final class Application {
    private final UUID id;
    private final ApplicationStatus status;
    private final String assignedOfficerId;
    private final String approvedBy;
    private final Instant approvedAt;
    private final String decisionReason;

    // getters omitted
}
```

Custom assertion:

```java
import org.assertj.core.api.AbstractAssert;

public final class ApplicationAssert
        extends AbstractAssert<ApplicationAssert, Application> {

    private ApplicationAssert(Application actual) {
        super(actual, ApplicationAssert.class);
    }

    public static ApplicationAssert assertThat(Application actual) {
        return new ApplicationAssert(actual);
    }

    public ApplicationAssert hasStatus(ApplicationStatus expectedStatus) {
        isNotNull();

        if (actual.getStatus() != expectedStatus) {
            failWithMessage(
                "Expected application <%s> to have status <%s> but was <%s>",
                actual.getId(),
                expectedStatus,
                actual.getStatus()
            );
        }

        return this;
    }

    public ApplicationAssert wasApprovedBy(String expectedOfficerId) {
        isNotNull();

        if (!Objects.equals(actual.getApprovedBy(), expectedOfficerId)) {
            failWithMessage(
                "Expected application <%s> to be approved by <%s> but was approved by <%s>",
                actual.getId(),
                expectedOfficerId,
                actual.getApprovedBy()
            );
        }

        if (actual.getApprovedAt() == null) {
            failWithMessage(
                "Expected application <%s> approvedAt to be populated when approved by <%s>",
                actual.getId(),
                expectedOfficerId
            );
        }

        return this;
    }

    public ApplicationAssert hasDecisionReason(String expectedReason) {
        isNotNull();

        if (!Objects.equals(actual.getDecisionReason(), expectedReason)) {
            failWithMessage(
                "Expected application <%s> decision reason <%s> but was <%s>",
                actual.getId(),
                expectedReason,
                actual.getDecisionReason()
            );
        }

        return this;
    }
}
```

Usage:

```java
import static com.acme.test.assertions.ApplicationAssert.assertThat;

assertThat(application)
    .hasStatus(APPROVED)
    .wasApprovedBy(officerId)
    .hasDecisionReason("All requirements fulfilled");
```

### 12.3 Custom Assertion Naming

Good names:

```java
hasStatus(APPROVED)
wasApprovedBy(officerId)
hasOnlyValidationErrors(...)
recordsTransition(from, to)
containsExactlyOneEventOfType(...)
hasNoSideEffects()
wasDeniedBecause(...)
```

Weak names:

```java
checkStatus(APPROVED)
validateApplication(application)
assertApplicationCorrect()
testEverything()
```

Assertion method harus menyatakan expectation, bukan aksi testing generik.

---

## 13. Assertion Entry Point Pattern

Jika punya banyak custom assertion, buat entry point agar import konsisten.

```java
public final class DomainAssertions {
    private DomainAssertions() {}

    public static ApplicationAssert assertThat(Application actual) {
        return ApplicationAssert.assertThat(actual);
    }

    public static AuditTrailAssert assertThat(AuditTrail actual) {
        return AuditTrailAssert.assertThat(actual);
    }

    public static ValidationResultAssert assertThat(ValidationResult actual) {
        return ValidationResultAssert.assertThat(actual);
    }
}
```

Usage:

```java
import static com.acme.test.DomainAssertions.assertThat;

assertThat(application).hasStatus(APPROVED);
assertThat(validationResult).hasOnlyErrors("APPLICANT_ID_REQUIRED");
```

Namun hati-hati dengan konflik import `org.assertj.core.api.Assertions.assertThat`. Banyak tim memilih nama khusus:

```java
DomainAssertions.assertThatApplication(application)
    .hasStatus(APPROVED);
```

atau:

```java
ApplicationAssertions.assertThat(application)
    .hasStatus(APPROVED);
```

Prioritaskan clarity di codebase.

---

## 14. Custom Assertion untuk ValidationResult

Production object:

```java
public record ValidationResult(List<ValidationError> errors) {
    public boolean isValid() {
        return errors.isEmpty();
    }
}

public record ValidationError(String code, String field, String message) {}
```

Custom assertion:

```java
public final class ValidationResultAssert
        extends AbstractAssert<ValidationResultAssert, ValidationResult> {

    private ValidationResultAssert(ValidationResult actual) {
        super(actual, ValidationResultAssert.class);
    }

    public static ValidationResultAssert assertThat(ValidationResult actual) {
        return new ValidationResultAssert(actual);
    }

    public ValidationResultAssert isValid() {
        isNotNull();

        if (!actual.isValid()) {
            failWithMessage(
                "Expected validation result to be valid but had errors <%s>",
                actual.errors()
            );
        }

        return this;
    }

    public ValidationResultAssert isInvalid() {
        isNotNull();

        if (actual.isValid()) {
            failWithMessage("Expected validation result to be invalid but had no errors");
        }

        return this;
    }

    public ValidationResultAssert hasOnlyErrorCodes(String... expectedCodes) {
        isNotNull();

        List<String> actualCodes = actual.errors().stream()
            .map(ValidationError::code)
            .toList();

        assertThat(actualCodes)
            .as("validation error codes")
            .containsExactlyInAnyOrder(expectedCodes);

        return this;
    }

    public ValidationResultAssert hasNoErrorCode(String unexpectedCode) {
        isNotNull();

        List<String> actualCodes = actual.errors().stream()
            .map(ValidationError::code)
            .toList();

        assertThat(actualCodes)
            .as("validation error codes")
            .doesNotContain(unexpectedCode);

        return this;
    }
}
```

Java 8 compatibility note: `Stream.toList()` baru tersedia sejak Java 16. Untuk Java 8 sampai 15 gunakan:

```java
.collect(Collectors.toList())
```

Jika seri ini memberi contoh dengan `toList()`, selalu perhatikan target Java project.

---

## 15. Assertion untuk Audit Trail

Audit trail sering menjadi bagian penting regulatory defensibility. Assertion harus membuktikan bukan hanya data ada, tetapi semantic-nya benar.

### 15.1 Model Audit Trail

```java
public record AuditTrail(
    UUID id,
    UUID entityId,
    String module,
    String activity,
    String actorId,
    Instant occurredAt,
    Map<String, Object> metadata
) {}
```

### 15.2 Assertion Biasa

```java
assertThat(auditTrails)
    .extracting(AuditTrail::activity)
    .contains("APPROVE_APPLICATION");
```

Ini belum cukup. Lebih baik:

```java
assertThat(auditTrails)
    .filteredOn(a -> a.activity().equals("APPROVE_APPLICATION"))
    .singleElement()
    .satisfies(audit -> {
        assertThat(audit.entityId()).isEqualTo(applicationId);
        assertThat(audit.module()).isEqualTo("APPLICATION");
        assertThat(audit.actorId()).isEqualTo(officerId);
        assertThat(audit.metadata())
            .containsEntry("fromStatus", "UNDER_REVIEW")
            .containsEntry("toStatus", "APPROVED");
    });
```

### 15.3 Domain Assertion

```java
assertThat(auditTrails)
    .recordsTransition(applicationId, "APPLICATION", UNDER_REVIEW, APPROVED)
    .performedBy(officerId)
    .containsReason("All requirements fulfilled")
    .hasNoDuplicateActivity("APPROVE_APPLICATION");
```

### 15.4 Apa yang Harus Diuji pada Audit?

Untuk audit trail, biasanya assertion penting:

- entity ID benar,
- module benar,
- activity/action benar,
- actor benar,
- timestamp masuk akal,
- correlation/request ID ada,
- from/to state benar,
- metadata penting ada,
- tidak ada duplicate untuk command yang idempotent,
- tidak ada audit jika action gagal authorization,
- audit tetap ada jika business operation sukses meskipun notification gagal, tergantung contract.

---

## 16. Assertion untuk State Machine dan Workflow

Workflow testing buruk biasanya hanya mengecek status akhir.

```java
assertThat(application.status()).isEqualTo(APPROVED);
```

Workflow testing kuat mengecek transition contract.

### 16.1 Assertion Transition

```java
assertThat(workflowResult)
    .transitionedFrom(UNDER_REVIEW)
    .to(APPROVED)
    .by(officerId)
    .at(fixedClock.instant())
    .withReason("All requirements fulfilled");
```

### 16.2 Assertion Invalid Transition

```java
assertThatThrownBy(() -> workflow.submit(applicationAlreadySubmitted, applicant))
    .isInstanceOf(InvalidTransitionException.class)
    .satisfies(ex -> {
        InvalidTransitionException ite = (InvalidTransitionException) ex;
        assertThat(ite.currentStatus()).isEqualTo(SUBMITTED);
        assertThat(ite.requestedAction()).isEqualTo("SUBMIT");
    });

assertThat(applicationRepository.findById(applicationId).orElseThrow())
    .hasStatus(SUBMITTED);

assertThat(auditTrails)
    .extracting(AuditTrail::activity)
    .doesNotContain("SUBMIT_APPLICATION");
```

### 16.3 Transition Matrix Assertion

Untuk workflow kompleks, test bisa table-driven:

```java
@ParameterizedTest
@MethodSource("invalidTransitions")
void shouldRejectInvalidTransition(ApplicationStatus from, WorkflowAction action) {
    Application application = applicationBuilder()
        .withStatus(from)
        .build();

    assertThatThrownBy(() -> workflow.apply(application, action, officer))
        .isInstanceOf(InvalidTransitionException.class);
}
```

Namun assertion harus tetap specific ketika gagal. Tambahkan `.as(...)`:

```java
assertThatThrownBy(() -> workflow.apply(application, action, officer))
    .as("transition %s via action %s should be rejected", from, action)
    .isInstanceOf(InvalidTransitionException.class);
```

`.as(...)` di AssertJ memberi description pada assertion. Ini sangat berguna di parameterized test.

---

## 17. Assertion untuk Authorization

Authorization test lemah:

```java
assertEquals(403, response.statusCode());
```

Itu hanya membuktikan HTTP layer mengembalikan 403. Dalam sistem enterprise, authorization contract bisa lebih luas:

```text
- request ditolak
- reason sesuai
- resource state tidak berubah
- tidak ada audit success
- mungkin ada audit denied access
- tidak ada event/message/email
- response tidak membocorkan data sensitif
```

Assertion lebih kuat:

```java
assertThat(response.statusCode()).isEqualTo(403);
assertThat(response.body().errorCode()).isEqualTo("ACCESS_DENIED");
assertThat(response.body().message()).doesNotContain(application.getSensitiveReference());

Application after = repository.findById(applicationId).orElseThrow();
assertThat(after.status()).isEqualTo(UNDER_REVIEW);

assertThat(auditTrails)
    .extracting(AuditTrail::activity)
    .contains("ACCESS_DENIED")
    .doesNotContain("APPROVE_APPLICATION");

assertThat(events).isEmpty();
```

Authorization failure yang hanya dicek status code sering melewatkan partial side effect.

---

## 18. Assertion untuk Idempotency

Idempotency bukan berarti response selalu sama. Idempotency berarti repeated command tidak menghasilkan durable side-effect tambahan yang tidak diinginkan.

### 18.1 Contoh Contract

Command:

```text
POST /applications/{id}/submit
Idempotency-Key: abc-123
```

Expected:

```text
- request pertama submit aplikasi
- request kedua dengan key sama tidak submit ulang
- audit trail submit hanya satu
- event submit hanya satu
- response kedua boleh 200/201/409 tergantung API contract, tetapi side-effect harus tidak double
```

### 18.2 Assertion

```java
SubmitResponse first = client.submit(applicationId, "abc-123");
SubmitResponse second = client.submit(applicationId, "abc-123");

assertThat(first.applicationId()).isEqualTo(applicationId);
assertThat(second.applicationId()).isEqualTo(applicationId);

assertThat(auditRepository.findByEntityId(applicationId))
    .filteredOn(a -> a.activity().equals("SUBMIT_APPLICATION"))
    .hasSize(1);

assertThat(eventPublisher.publishedEvents())
    .filteredOn(e -> e.type().equals("ApplicationSubmitted"))
    .hasSize(1);
```

### 18.3 Anti-Pattern

Buruk:

```java
assertThat(second.status()).isEqualTo("SUCCESS");
```

Ini tidak membuktikan side effect tidak double.

---

## 19. Assertion untuk Time dan Clock

Time-based assertion sering flaky jika memakai real clock.

Buruk:

```java
service.approve(applicationId);

assertThat(application.approvedAt()).isBefore(Instant.now());
```

Masalah:

- Tergantung waktu real.
- Sulit reproducible.
- Bisa flaky di environment lambat.
- Tidak membuktikan timestamp yang tepat.

Lebih baik gunakan injected `Clock`:

```java
Clock fixedClock = Clock.fixed(
    Instant.parse("2026-06-16T10:15:30Z"),
    ZoneOffset.UTC
);

ApprovalService service = new ApprovalService(repository, fixedClock);

service.approve(applicationId, officerId);

Application application = repository.findById(applicationId).orElseThrow();

assertThat(application.approvedAt())
    .isEqualTo(Instant.parse("2026-06-16T10:15:30Z"));
```

### 19.1 Time Window Assertion

Kadang fixed clock tidak memungkinkan, misalnya integration test full stack. Gunakan window:

```java
Instant before = Instant.now();
service.approve(applicationId, officerId);
Instant after = Instant.now();

assertThat(application.approvedAt())
    .isBetween(before, after);
```

Ini lebih baik daripada `isBefore(now)` karena window-nya eksplisit.

### 19.2 Time Zone Assertion

Untuk API response:

```java
assertThat(response.approvedAt())
    .isEqualTo("2026-06-16T10:15:30Z");
```

Jika business timezone penting:

```java
assertThat(response.localApprovedDate())
    .isEqualTo(LocalDate.of(2026, 6, 16));
assertThat(response.timeZone())
    .isEqualTo("Asia/Jakarta");
```

Jangan biarkan timezone tersirat.

---

## 20. Assertion untuk BigDecimal dan Money

Financial/regulatory system sering memakai `BigDecimal`. Assertion BigDecimal harus memperhatikan scale semantics.

```java
assertThat(new BigDecimal("1.0"))
    .isEqualByComparingTo(new BigDecimal("1.00"));
```

Ini pass karena memakai `compareTo`.

Jika scale penting:

```java
assertThat(amount).isEqualTo(new BigDecimal("1.00"));
```

### 20.1 Money Assertion

Lebih baik buat value object:

```java
public record Money(String currency, BigDecimal amount) {}
```

Assertion:

```java
assertThat(invoice.total())
    .satisfies(total -> {
        assertThat(total.currency()).isEqualTo("SGD");
        assertThat(total.amount()).isEqualByComparingTo("125.00");
    });
```

Domain assertion:

```java
assertThat(invoice.total())
    .hasCurrency("SGD")
    .hasAmount("125.00");
```

### 20.2 Anti-Pattern Double

Buruk:

```java
assertEquals(125.10, total.doubleValue());
```

Jangan konversi monetary value ke double untuk assertion.

---

## 21. Assertion untuk JSON dan API Response

JSON assertion punya tantangan:

- urutan field tidak penting,
- urutan array kadang penting/kadang tidak,
- null vs absent berbeda,
- number representation bisa tricky,
- date format harus eksplisit,
- unknown fields bisa berpengaruh pada compatibility.

### 21.1 String Comparison Buruk

Buruk:

```java
assertEquals("{\"status\":\"APPROVED\",\"id\":\"123\"}", responseBody);
```

Masalah:

- Rapuh terhadap urutan field.
- Sulit dibaca.
- Failure diff buruk untuk payload besar.

### 21.2 Parse ke DTO

```java
ApplicationResponse response = objectMapper.readValue(
    responseBody,
    ApplicationResponse.class
);

assertThat(response.status()).isEqualTo("APPROVED");
assertThat(response.id()).isEqualTo("123");
```

Ini baik untuk semantic assertion.

### 21.3 JSON Path

Dengan Spring MockMvc misalnya:

```java
mockMvc.perform(get("/applications/{id}", applicationId))
    .andExpect(status().isOk())
    .andExpect(jsonPath("$.id").value(applicationId.toString()))
    .andExpect(jsonPath("$.status").value("APPROVED"));
```

Cocok untuk API layer test.

### 21.4 Full JSON Structural Assertion

Untuk contract response besar, gunakan JSON assertion library atau parse ke tree:

```java
JsonNode actual = objectMapper.readTree(responseBody);
JsonNode expected = objectMapper.readTree("""
{
  "id": "123",
  "status": "APPROVED"
}
""");

assertThat(actual).isEqualTo(expected);
```

Java 15+ mendukung text block. Untuk Java 8, gunakan string biasa atau load file resource.

---

## 22. Assertion untuk Null vs Absent

Dalam API compatibility, `null` dan absent sering berbeda.

```json
{
  "approvedAt": null
}
```

berbeda dengan:

```json
{}
```

Assertion harus eksplisit.

Dengan JsonNode:

```java
assertThat(node.has("approvedAt")).isTrue();
assertThat(node.get("approvedAt").isNull()).isTrue();
```

Untuk absent:

```java
assertThat(node.has("internalRemark")).isFalse();
```

Ini penting untuk security dan compatibility:

- Field sensitive harus absent, bukan sekadar null.
- Field yang dijanjikan contract mungkin harus hadir walaupun null.

---

## 23. Assertion untuk Security-Sensitive Response

Security assertion tidak cukup dengan status code.

Contoh response error:

```java
assertThat(response.status()).isEqualTo(404);
assertThat(response.body()).doesNotContain("internal table");
assertThat(response.body()).doesNotContain("SQL");
assertThat(response.body()).doesNotContain("stacktrace");
assertThat(response.body()).doesNotContain(userNric);
```

Untuk authorization:

```java
assertThat(response.status()).isEqualTo(403);
assertThat(response.json()).doesNotHaveJsonPath("$.application.internalNotes");
assertThat(response.json()).doesNotHaveJsonPath("$.applicant.nric");
```

Prinsip:

> Denied response harus membuktikan denial dan non-disclosure.

---

## 24. Hamcrest: Matcher-Based Assertions

Hamcrest menyediakan matcher yang bisa dikombinasikan untuk membuat expression of intent. Hamcrest sangat dikenal dari era JUnit 4 dan masih relevan di beberapa framework, terutama yang API-nya matcher-based.

Contoh:

```java
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.*;

assertThat(application.getStatus(), is(APPROVED));
assertThat(errors, containsInAnyOrder("A", "B"));
assertThat(responseBody, containsString("APPROVED"));
```

### 24.1 Kapan Hamcrest Berguna?

Hamcrest berguna ketika:

- framework memakai matcher API,
- perlu matcher composability,
- codebase legacy JUnit 4 banyak memakai Hamcrest,
- ingin membuat matcher reusable yang bisa dipakai lintas framework.

### 24.2 AssertJ vs Hamcrest

| Aspek | AssertJ | Hamcrest |
|---|---|---|
| Gaya | fluent chain | matcher composition |
| Readability modern Java | sangat baik | baik, tetapi lebih verbose |
| Collection assertion | sangat kuat | kuat |
| Recursive comparison | built-in kuat | tidak sepraktis AssertJ |
| Custom extension | custom assert class | custom matcher |
| Legacy JUnit 4 | bisa dipakai | sangat umum |
| Framework integration | luas | luas di framework lama |

Tidak perlu fanatik. Banyak tim memakai AssertJ sebagai default, Hamcrest hanya saat framework API memerlukannya.

### 24.3 Custom Hamcrest Matcher

```java
public final class HasStatusMatcher extends TypeSafeMatcher<Application> {
    private final ApplicationStatus expected;

    private HasStatusMatcher(ApplicationStatus expected) {
        this.expected = expected;
    }

    public static Matcher<Application> hasStatus(ApplicationStatus expected) {
        return new HasStatusMatcher(expected);
    }

    @Override
    protected boolean matchesSafely(Application application) {
        return application.getStatus() == expected;
    }

    @Override
    public void describeTo(Description description) {
        description.appendText("application with status ").appendValue(expected);
    }

    @Override
    protected void describeMismatchSafely(Application item, Description mismatchDescription) {
        mismatchDescription
            .appendText("status was ")
            .appendValue(item.getStatus());
    }
}
```

Usage:

```java
assertThat(application, hasStatus(APPROVED));
```

Custom matcher bagus, tetapi untuk Java enterprise modern, custom AssertJ assertion sering lebih ergonomic.

---

## 25. Assertion Descriptions dengan `.as()`

AssertJ `.as()` memberi description pada assertion.

```java
assertThat(application.status())
    .as("application %s status after approval", application.id())
    .isEqualTo(APPROVED);
```

Gunakan `.as()` ketika:

- parameterized test,
- loop/table-driven test,
- assertion terhadap item collection,
- failure message bawaan tidak cukup memberi konteks.

Contoh parameterized:

```java
@ParameterizedTest(name = "{0} cannot perform {1}")
@MethodSource("deniedActions")
void shouldDenyUnauthorizedAction(Role role, Action action) {
    AuthorizationResult result = authorizer.authorize(role, action);

    assertThat(result.allowed())
        .as("role %s should not be allowed to perform %s", role, action)
        .isFalse();
}
```

### 25.1 `.as()` Harus Sebelum Assertion Terminal

Benar:

```java
assertThat(value)
    .as("important context")
    .isEqualTo(expected);
```

Salah:

```java
assertThat(value)
    .isEqualTo(expected)
    .as("important context");
```

Description setelah terminal assertion tidak akan membantu jika assertion sudah gagal.

---

## 26. Assertion Failure Message: Actionable, Bukan Dekoratif

Failure message yang baik harus menjawab:

```text
Apa behavior yang diharapkan?
Apa actual observation?
Apa konteks domain penting?
Apa kemungkinan arah investigasi?
```

### 26.1 Message Buruk

```java
assertThat(result).isEqualTo(expected);
```

Failure mungkin cukup jika object kecil. Tetapi untuk domain kompleks bisa tidak cukup.

```java
assertThat(result).as("test failed").isEqualTo(expected);
```

Ini tidak membantu.

```java
assertTrue(isValid, "validation failed");
```

Masih miskin.

### 26.2 Message Baik

```java
assertThat(actualStatus)
    .as("application %s should remain UNDER_REVIEW when approval is denied", applicationId)
    .isEqualTo(UNDER_REVIEW);
```

atau custom:

```java
failWithMessage(
    "Expected approval denial to leave application <%s> in status <%s>, but actual status was <%s>. " +
    "This usually means authorization failed after state mutation or transaction boundary is wrong.",
    applicationId,
    UNDER_REVIEW,
    actual.getStatus()
);
```

Hati-hati: jangan terlalu spekulatif. Boleh memberi hint jika domain invariant jelas.

---

## 27. Assertion untuk Eventual Consistency dan Async

Async assertion sering dibuat salah dengan `Thread.sleep`.

Buruk:

```java
service.submit(applicationId);
Thread.sleep(2000);
assertThat(readModelRepository.find(applicationId).status()).isEqualTo(SUBMITTED);
```

Masalah:

- Flaky.
- Lambat.
- Bisa gagal di CI lambat.
- Bisa terlalu lama saat sebenarnya sudah selesai.

Lebih baik gunakan Awaitility:

```java
await()
    .atMost(Duration.ofSeconds(5))
    .pollInterval(Duration.ofMillis(100))
    .untilAsserted(() -> {
        ApplicationReadModel readModel = readModelRepository.find(applicationId).orElseThrow();
        assertThat(readModel.status()).isEqualTo(SUBMITTED);
    });
```

### 27.1 Assertion Async Harus Punya Boundary

Selalu tentukan:

- maksimal waktu tunggu,
- interval polling,
- kondisi sukses,
- failure diagnostic,
- data isolation.

### 27.2 Assert No Event Eventually?

Menguji “tidak ada event” dalam async system sulit. Contoh:

```java
await()
    .during(Duration.ofSeconds(1))
    .atMost(Duration.ofSeconds(2))
    .untilAsserted(() -> {
        assertThat(eventStore.findByType("ApplicationApproved"))
            .isEmpty();
    });
```

Tapi assertion “tidak terjadi” selalu probabilistic kecuali sistem punya deterministic synchronization point. Lebih baik jika bisa assert dari durable state atau mock/fake deterministic.

---

## 28. Assertion untuk Logs

Testing logs biasanya bukan prioritas. Namun log assertion valid jika log adalah part of contract, misalnya:

- security audit log,
- compliance log,
- operational event,
- warning untuk deprecated input,
- structured log untuk incident diagnosis.

Jangan test log hanya karena implementation logging ada.

### 28.1 Structured Log Assertion

Jika memakai structured logging, assert key-value:

```java
assertThat(capturedLogs)
    .anySatisfy(log -> {
        assertThat(log.level()).isEqualTo(WARN);
        assertThat(log.message()).contains("Access denied");
        assertThat(log.context()).containsEntry("applicationId", applicationId.toString());
        assertThat(log.context()).doesNotContainKey("nric");
    });
```

Security principle:

> Log assertion harus sering memeriksa bahwa data sensitif tidak bocor.

---

## 29. Assertion untuk Database State

Persistence assertion harus menyeimbangkan behavior dan implementation detail.

### 29.1 Jangan Terlalu Banyak Menguji Kolom Internal

Buruk:

```java
assertThat(row.get("UPDATED_BY")).isEqualTo(officerId);
assertThat(row.get("UPDATED_DATE")).isNotNull();
assertThat(row.get("VERSION")).isEqualTo(2);
assertThat(row.get("STATUS")).isEqualTo("APPROVED");
assertThat(row.get("INTERNAL_FLAG")).isEqualTo("Y");
```

Jika test level-nya service behavior, terlalu banyak detail table bisa membuat test rapuh.

### 29.2 Kapan DB-Level Assertion Valid?

Valid ketika:

- repository query custom,
- migration correctness,
- transaction boundary,
- locking/version,
- constraint,
- idempotency durable state,
- outbox/inbox table,
- audit trail,
- compatibility dengan existing schema.

### 29.3 Assertion Transaction Rollback

```java
assertThatThrownBy(() -> service.approveWithFailingNotification(applicationId))
    .isInstanceOf(NotificationException.class);

Application after = applicationRepository.findById(applicationId).orElseThrow();

assertThat(after.status()).isEqualTo(UNDER_REVIEW);
assertThat(outboxRepository.findByAggregateId(applicationId)).isEmpty();
```

Atau jika contract-nya state committed dan notification retried via outbox:

```java
assertThat(after.status()).isEqualTo(APPROVED);
assertThat(outboxRepository.findByAggregateId(applicationId))
    .singleElement()
    .satisfies(event -> {
        assertThat(event.type()).isEqualTo("ApplicationApproved");
        assertThat(event.status()).isEqualTo("PENDING");
    });
```

Assertion harus sesuai transaction contract, bukan asumsi umum.

---

## 30. Assertion untuk Concurrency

Concurrency assertion dalam unit test biasa sering menipu. Namun untuk beberapa scenario, assertion tetap bisa dibuat lebih baik.

### 30.1 Contoh Idempotency Race

```java
int workers = 20;
ExecutorService executor = Executors.newFixedThreadPool(workers);
CountDownLatch start = new CountDownLatch(1);

List<Future<SubmitResponse>> futures = IntStream.range(0, workers)
    .mapToObj(i -> executor.submit(() -> {
        start.await();
        return service.submit(applicationId, "same-key");
    }))
    .toList();

start.countDown();

List<SubmitResponse> responses = futures.stream()
    .map(Futures::getUnchecked)
    .toList();

assertThat(responses)
    .hasSize(workers)
    .allSatisfy(response -> assertThat(response.applicationId()).isEqualTo(applicationId));

assertThat(auditRepository.findByEntityId(applicationId))
    .filteredOn(a -> a.activity().equals("SUBMIT_APPLICATION"))
    .hasSize(1);
```

Java 8 note: replace `.toList()` with `.collect(Collectors.toList())`.

### 30.2 Assertion Outcome, Bukan Scheduling

Jangan assert urutan thread kecuali itu contract. Assert durable invariant:

- hanya satu row dibuat,
- version increment valid,
- no duplicate event,
- no lost update,
- no inconsistent state.

Untuk memory model dan low-level concurrency correctness, gunakan `jcstress`, bukan unit test biasa.

---

## 31. Assertion untuk Performance: Batas yang Sangat Hati-Hati

Assertion performance di unit test sering salah.

Buruk:

```java
long start = System.nanoTime();
service.process(request);
long elapsed = System.nanoTime() - start;

assertTrue(elapsed < 10_000_000);
```

Masalah:

- Warmup tidak dikontrol.
- JIT tidak stabil.
- CI noise.
- GC noise.
- CPU throttling.
- Single measurement tidak sahih.

### 31.1 Kapan Duration Assertion Masih Valid?

Valid untuk guard kasar seperti:

- operation tidak boleh deadlock,
- async completion harus terjadi dalam bounded time,
- test helper tidak boleh hang,
- retry backoff virtual/fake clock.

Contoh:

```java
assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
    service.processWithoutExternalDependency(request);
});
```

Tetapi jangan menyimpulkan “performance bagus” dari assertion seperti itu.

### 31.2 Performance Regression Gunakan JMH/Load Test

Untuk performance serius:

- microbenchmark: JMH,
- concurrency correctness: jcstress,
- macro/load: Gatling/k6/JMeter/wrk/vegeta,
- diagnosis: JFR/async-profiler/GC logs.

Assertion test biasa hanya guard, bukan benchmark.

---

## 32. Assertion untuk Object Identity vs Equality

`assertEquals` memakai `equals`. Kadang yang ingin diuji adalah identity reference.

```java
assertThat(cachedInstance).isSameAs(secondFetch);
```

atau JUnit:

```java
assertSame(cachedInstance, secondFetch);
```

Gunakan identity assertion hanya jika identity adalah contract, misalnya:

- singleton,
- cache instance reuse,
- object pool,
- sentinel object,
- enum.

Jangan pakai `isSameAs` untuk value object.

---

## 33. Assertion untuk Ordering

Ordering sering menjadi hidden contract.

```java
assertThat(results)
    .extracting(ApplicationSummary::submittedAt)
    .isSortedAccordingTo(Comparator.reverseOrder());
```

Jika exact order penting:

```java
assertThat(results)
    .extracting(ApplicationSummary::id)
    .containsExactly(id3, id2, id1);
```

Jika order tidak penting:

```java
assertThat(results)
    .extracting(ApplicationSummary::id)
    .containsExactlyInAnyOrder(id1, id2, id3);
```

Jangan memakai assertion order-sensitive jika order bukan contract. Itu membuat test rapuh.

---

## 34. Assertion untuk Pagination

Pagination assertion harus memeriksa lebih dari jumlah item.

```java
assertThat(page.items())
    .extracting(ApplicationSummary::id)
    .containsExactly(id10, id9, id8);

assertThat(page.pageNumber()).isEqualTo(0);
assertThat(page.pageSize()).isEqualTo(3);
assertThat(page.totalElements()).isEqualTo(10);
assertThat(page.totalPages()).isEqualTo(4);
assertThat(page.hasNext()).isTrue();
assertThat(page.hasPrevious()).isFalse();
```

Untuk cursor pagination:

```java
assertThat(response.items()).hasSize(50);
assertThat(response.nextCursor()).isNotBlank();
assertThat(response.previousCursor()).isNull();
```

Boundary yang perlu diuji:

- empty result,
- first page,
- middle page,
- last page,
- page size > total,
- invalid page size,
- stable sort with tie-breaker.

---

## 35. Assertion untuk Mapper

Mapper test sering overkill jika mapper trivial. Tetapi mapper penting jika:

- ada security redaction,
- ada timezone conversion,
- ada enum mapping,
- ada field compatibility,
- ada nested aggregation,
- ada backward compatibility API.

Assertion:

```java
ApplicationResponse response = mapper.toResponse(application);

assertThat(response)
    .usingRecursiveComparison()
    .ignoringFields("links")
    .isEqualTo(expectedResponse);

assertThat(response.internalNotes()).isNull();
```

Untuk field sensitive, lebih baik absent daripada null jika JSON API:

```java
JsonNode json = objectMapper.valueToTree(response);
assertThat(json.has("internalNotes")).isFalse();
```

---

## 36. Assertion untuk File, Path, dan IO

AssertJ punya assertion untuk file/path.

```java
assertThat(outputFile)
    .exists()
    .isRegularFile()
    .hasExtension("csv");

assertThat(outputFile)
    .content()
    .contains("Application ID,Status")
    .contains(applicationId.toString());
```

Untuk file besar, jangan assert seluruh content string jika tidak perlu. Assert struktur dan sample penting:

- header,
- row count,
- delimiter,
- encoding,
- critical columns,
- no sensitive data.

---

## 37. Assertion untuk Encoding dan Unicode

Encoding bug sering muncul pada nama orang, alamat, dokumen, dan integrasi file.

```java
String text = Files.readString(path, StandardCharsets.UTF_8);

assertThat(text).contains("José");
assertThat(text).contains("東京");
assertThat(text).contains("🙂");
```

Java 8 note: `Files.readString` baru ada sejak Java 11. Untuk Java 8:

```java
String text = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
```

Assertion encoding harus eksplisit memakai charset, jangan default platform charset.

---

## 38. Assertion Scope: Jangan Assert Terlalu Banyak, Jangan Terlalu Sedikit

Assertion terlalu sedikit membuat bug lolos.

Assertion terlalu banyak membuat test rapuh dan sulit dipahami.

### 38.1 Terlalu Sedikit

```java
assertThat(response.statusCode()).isEqualTo(200);
```

Ini tidak membuktikan response benar.

### 38.2 Terlalu Banyak

```java
assertThat(response.id()).isEqualTo(id);
assertThat(response.status()).isEqualTo("APPROVED");
assertThat(response.createdAt()).isEqualTo(...);
assertThat(response.updatedAt()).isEqualTo(...);
assertThat(response.version()).isEqualTo(7);
assertThat(response.internalSortKey()).isEqualTo(...);
assertThat(response.debugFlag()).isFalse();
```

Jika test tujuannya hanya approval status, terlalu banyak field incidental membuat test gagal karena perubahan yang tidak relevan.

### 38.3 Heuristic

Untuk setiap assertion, tanya:

```text
Jika assertion ini gagal, apakah itu berarti behavior yang sedang diuji memang rusak?
```

Jika jawabannya tidak, assertion itu mungkin incidental.

---

## 39. Assertion dan Test Smells

### 39.1 `assertTrue` dengan Ekspresi Kompleks

Buruk:

```java
assertTrue(response.getItems().stream()
    .anyMatch(item -> item.getStatus().equals("APPROVED") && item.getAmount().compareTo(BigDecimal.ZERO) > 0));
```

Lebih baik:

```java
assertThat(response.getItems())
    .anySatisfy(item -> {
        assertThat(item.getStatus()).isEqualTo("APPROVED");
        assertThat(item.getAmount()).isPositive();
    });
```

### 39.2 `assertNotNull` sebagai Assertion Utama

Buruk:

```java
assertNotNull(result);
```

Ini hampir tidak membuktikan behavior.

Lebih baik:

```java
assertThat(result.status()).isEqualTo(APPROVED);
assertThat(result.applicationId()).isEqualTo(applicationId);
```

### 39.3 Assertion Mengulang Implementation

Buruk:

```java
assertThat(result).isEqualTo(input.getA() + input.getB() - discount.calculate(input));
```

Jika assertion menyalin logic production, bug yang sama bisa ada di test dan production.

Lebih baik pakai expected value dari example yang jelas atau property/invariant.

### 39.4 Magic Expected Value

Buruk:

```java
assertThat(total).isEqualByComparingTo("173.42");
```

Tanpa konteks, angka ini mystery.

Lebih baik:

```java
BigDecimal baseFee = new BigDecimal("150.00");
BigDecimal tax = new BigDecimal("13.50");
BigDecimal adminFee = new BigDecimal("9.92");

assertThat(total).isEqualByComparingTo(baseFee.add(tax).add(adminFee));
```

Atau beri nama fixture yang jelas.

### 39.5 Overly Broad Recursive Comparison

```java
assertThat(actual).usingRecursiveComparison().isEqualTo(expected);
```

Ini bisa baik, bisa buruk. Buruk jika test menjadi snapshot besar yang gagal setiap perubahan kecil.

### 39.6 Swallowed Assertion

Buruk:

```java
try {
    assertThat(result).isEqualTo(expected);
} catch (AssertionError ignored) {
}
```

Ini merusak trust test suite.

### 39.7 Assertion dalam Thread Tidak Dipropagasi

Buruk:

```java
new Thread(() -> assertThat(result).isEqualTo(expected)).start();
```

Jika assertion gagal di thread lain, test utama bisa tetap pass. Gunakan Future, CompletableFuture, atau testing utility yang mempropagasi failure.

---

## 40. Assertion Strategy Berdasarkan Layer

### 40.1 Domain Unit Test

Assertion fokus pada:

- state transition,
- invariant,
- domain result,
- domain event,
- exception domain,
- no invalid mutation.

Default tool:

- AssertJ,
- custom domain assertion.

### 40.2 Application Service Test

Assertion fokus pada:

- orchestration result,
- transaction effect,
- repository state,
- published event,
- audit trail,
- authorization,
- idempotency.

Default tool:

- AssertJ,
- custom assertion,
- fake/mocked collaborator verification secara hati-hati.

### 40.3 Repository Test

Assertion fokus pada:

- persisted state,
- query result,
- constraints,
- sorting/pagination,
- locking/version,
- null semantics.

Default tool:

- AssertJ,
- SQL/assert DB helper,
- Testcontainers real DB.

### 40.4 API Test

Assertion fokus pada:

- status code,
- response contract,
- error format,
- serialization,
- security redaction,
- compatibility.

Default tool:

- MockMvc/WebTestClient/RestAssured,
- JSON assertion,
- AssertJ DTO assertion.

### 40.5 Messaging Test

Assertion fokus pada:

- event type,
- key,
- payload,
- headers,
- ordering when contract,
- dedup/idempotency,
- DLQ/retry behavior.

Default tool:

- AssertJ,
- Awaitility,
- Testcontainers broker,
- custom event assertion.

### 40.6 Performance/Benchmark Test

Assertion fokus pada:

- benchmark result validity,
- threshold in controlled environment,
- allocation regression,
- latency distribution in load test.

Default tool:

- JMH,
- load testing tools,
- not ordinary unit assertion.

---

## 41. Designing Domain Assertion DSL

Untuk sistem besar, assertion DSL bisa menjadi reusable test infrastructure.

### 41.1 Prinsip DSL

DSL harus:

- memakai bahasa domain,
- menyembunyikan getter noise,
- menghasilkan failure message yang actionable,
- tidak menyembunyikan behavior penting,
- tidak menjadi mini-framework kompleks,
- konsisten antar modul.

### 41.2 Contoh DSL untuk Workflow

```java
assertThat(workflowOutcome)
    .acceptedCommand("APPROVE_APPLICATION")
    .transitioned(applicationId)
    .from(UNDER_REVIEW)
    .to(APPROVED)
    .by(officerId)
    .producedEvent("ApplicationApproved")
    .recordedAudit("APPROVE_APPLICATION");
```

### 41.3 Contoh DSL untuk Denial

```java
assertThat(workflowOutcome)
    .rejectedCommand("APPROVE_APPLICATION")
    .because("ACCESS_DENIED")
    .leftApplicationUnchanged(applicationId)
    .producedNoDomainEvents()
    .recordedSecurityAudit("ACCESS_DENIED");
```

Ini jauh lebih kuat daripada kumpulan assertion teknis tersebar.

---

## 42. Assertion Library Layout di Project Java

Struktur yang disarankan:

```text
src/test/java
  com/acme/test/assertions
    DomainAssertions.java
    ApplicationAssert.java
    AuditTrailAssert.java
    ValidationResultAssert.java
    EventAssert.java
    JsonAssertions.java
    MoneyAssert.java
```

Untuk multi-module project:

```text
test-support/
  src/main/java
    com/acme/testing/assertions
    com/acme/testing/fixtures
    com/acme/testing/builders
```

Kenapa `src/main/java` di `test-support`? Karena module itu dependency test untuk module lain.

Maven dependency:

```xml
<dependency>
  <groupId>com.acme</groupId>
  <artifactId>test-support</artifactId>
  <version>${project.version}</version>
  <scope>test</scope>
</dependency>
```

### 42.1 Hindari Test Support Jadi Dumping Ground

Jangan semua helper masuk `TestUtils`.

Buruk:

```java
TestUtils.assertApplication(...)
TestUtils.createUser(...)
TestUtils.cleanDb(...)
TestUtils.waitForEvent(...)
```

Lebih baik pisah:

```text
ApplicationAssertions
ApplicationFixtures
DatabaseCleaner
EventAwaiter
AuthorizationFixtures
```

---

## 43. Java 8–25 Compatibility Notes

### 43.1 Java 8

Perhatikan:

- Tidak ada `List.of`, `Set.of`, `Map.of`.
- Tidak ada `Stream.toList()`.
- Tidak ada text block.
- Tidak ada records.
- Banyak codebase masih JUnit 4 atau JUnit 5 early.

Contoh Java 8 compatible:

```java
List<String> codes = errors.stream()
    .map(ValidationError::getCode)
    .collect(Collectors.toList());
```

Bukan:

```java
List<String> codes = errors.stream()
    .map(ValidationError::code)
    .toList();
```

### 43.2 Java 11

Mulai lebih nyaman:

- `Files.readString`,
- `String.isBlank`,
- `var` untuk local variable sejak Java 10,
- masih belum ada records/text blocks final.

### 43.3 Java 17

Baseline modern:

- records,
- sealed classes,
- text blocks,
- pattern matching instanceof,
- cocok untuk JUnit 6 baseline.

Assertion DTO menjadi lebih enak:

```java
public record ApplicationResponse(UUID id, String status) {}
```

### 43.4 Java 21

Modern LTS dengan virtual threads. Assertion untuk async/concurrency harus makin hati-hati karena blocking behavior bisa berubah. Jangan assert thread name/carrier behavior kecuali memang sedang menguji runtime behavior.

### 43.5 Java 25

Untuk Java 25, gunakan dokumentasi launcher/JDK terbaru untuk compatibility. Dari sisi assertion, perubahan utama bukan pada assertion API, tetapi pada ekosistem testing yang bergerak ke baseline Java 17+, terutama JUnit 6.

---

## 44. Assertion Review Checklist

Gunakan checklist ini saat review test:

```text
[ ] Apakah assertion membuktikan behavior utama, bukan detail incidental?
[ ] Jika assertion gagal, apakah failure message cukup untuk mulai investigasi?
[ ] Apakah expected dan actual terlihat jelas?
[ ] Apakah assertion terlalu longgar? Misalnya contains padahal harus exactly.
[ ] Apakah assertion terlalu ketat? Misalnya order-sensitive padahal order bukan contract.
[ ] Apakah exception assertion memeriksa type, code, dan side-effect?
[ ] Apakah authorization assertion memeriksa no side-effect dan no data leakage?
[ ] Apakah workflow assertion memeriksa transition, actor, reason, audit/event?
[ ] Apakah time assertion memakai Clock atau bounded window?
[ ] Apakah BigDecimal assertion memakai semantics yang benar?
[ ] Apakah async assertion menghindari Thread.sleep?
[ ] Apakah custom assertion layak dibuat untuk pola berulang?
[ ] Apakah assertion bisa berjalan stabil di CI?
```

---

## 45. Step-by-Step Refactoring: Dari Assertion Lemah ke Assertion Kuat

### 45.1 Test Awal

```java
@Test
void approveApplication() {
    Application app = fixture.submittedApplication();

    service.approve(app.getId(), officer);

    Application result = repository.findById(app.getId()).get();
    assertTrue(result.getStatus() == APPROVED);
}
```

Masalah:

- Nama test kurang menjelaskan kondisi.
- `assertTrue` miskin diagnostic.
- Tidak assert actor/reason/time.
- Tidak assert audit/event.
- Tidak assert previous state.

### 45.2 Perbaiki Nama dan Assertion Status

```java
@Test
void shouldApproveSubmittedApplicationWhenOfficerIsAuthorized() {
    Application app = fixture.submittedApplication();

    service.approve(app.getId(), officer);

    Application result = repository.findById(app.getId()).orElseThrow();

    assertThat(result.getStatus())
        .as("application %s status after authorized approval", app.getId())
        .isEqualTo(APPROVED);
}
```

### 45.3 Tambahkan Domain Evidence

```java
@Test
void shouldApproveSubmittedApplicationWhenOfficerIsAuthorized() {
    Application app = fixture.submittedApplication();

    service.approve(app.getId(), officer, "All requirements fulfilled");

    Application result = repository.findById(app.getId()).orElseThrow();

    assertThat(result)
        .hasStatus(APPROVED)
        .wasApprovedBy(officer.id())
        .hasDecisionReason("All requirements fulfilled");

    assertThat(auditRepository.findByEntityId(app.getId()))
        .recordsTransition(app.getId(), SUBMITTED, APPROVED)
        .performedBy(officer.id());

    assertThat(eventPublisher.publishedEvents())
        .containsExactlyOneEvent(ApplicationApproved.class, event -> {
            assertThat(event.applicationId()).isEqualTo(app.getId());
            assertThat(event.approvedBy()).isEqualTo(officer.id());
        });
}
```

### 45.4 Hasil

Test sekarang membuktikan behavior approval sebagai domain operation, bukan hanya perubahan satu field.

---

## 46. Practice Exercises

### Exercise 1: Refactor `assertTrue`

Ubah assertion ini:

```java
assertTrue(result.getErrors().size() == 2);
assertTrue(result.getErrors().contains("A"));
assertTrue(result.getErrors().contains("B"));
```

Menjadi AssertJ assertion yang:

- memastikan tidak ada error tambahan,
- urutan tidak penting,
- failure message jelas.

Expected direction:

```java
assertThat(result.getErrors())
    .containsExactlyInAnyOrder("A", "B");
```

### Exercise 2: Exception + No Side Effect

Buat test untuk invalid transition:

```text
APPROVED application tidak boleh di-submit ulang.
```

Assertion harus membuktikan:

- `InvalidTransitionException` dilempar,
- error code benar,
- status tetap `APPROVED`,
- tidak ada audit `SUBMIT_APPLICATION`,
- tidak ada event `ApplicationSubmitted`.

### Exercise 3: BigDecimal Semantics

Tentukan assertion mana yang benar untuk domain berikut:

```text
Payment amount 1.0 dan 1.00 dianggap sama secara nilai, tetapi invoice display harus selalu 2 decimal places.
```

Hint:

- payment calculation: `isEqualByComparingTo`,
- display formatting: exact string atau scale assertion.

### Exercise 4: Custom Assertion

Buat `ValidationResultAssert` dengan method:

```java
isInvalid()
hasOnlyErrorCodes(String... codes)
hasErrorOnField(String field, String code)
```

Pastikan failure message menunjukkan actual errors.

### Exercise 5: JSON Null vs Absent

Buat assertion untuk response unauthorized agar:

- HTTP status 403,
- field `internalNotes` absent,
- field `applicantNric` absent,
- error code `ACCESS_DENIED` ada.

---

## 47. Top 1% Engineer Notes

Assertion engineering terlihat kecil, tetapi efeknya besar terhadap engineering velocity.

Engineer biasa menulis test yang pass.

Engineer kuat menulis test yang:

```text
- gagal pada behavior yang benar-benar salah,
- tidak gagal pada perubahan incidental,
- memberi diagnostic yang cukup,
- membuktikan invariant penting,
- bisa dipercaya di CI,
- menjadi dokumentasi domain yang executable.
```

Beberapa prinsip praktis:

1. Jangan puas dengan `assertTrue` jika failure-nya tidak menjelaskan apa yang salah.
2. Untuk collection, selalu pilih semantics dengan sadar: contains, containsExactly, containsExactlyInAnyOrder, anySatisfy, allSatisfy, singleElement.
3. Untuk exception, assert type + domain code + no side-effect.
4. Untuk workflow, assert transition, actor, reason, audit, event.
5. Untuk authorization, assert denial + no mutation + no data leak.
6. Untuk time, inject `Clock` atau gunakan explicit window.
7. Untuk money, jangan pakai double.
8. Untuk async, jangan pakai `Thread.sleep`.
9. Buat custom assertion ketika assertion domain berulang.
10. Treat failure message as production-grade diagnostic surface.

Assertion adalah salah satu tempat di mana test suite berubah dari “sekadar coverage” menjadi “engineering safety net”.

---

## 48. Summary

Part ini membahas assertion sebagai engineering discipline.

Poin utama:

- Assertion adalah evaluasi evidence, bukan hanya perbandingan value.
- Assertion quality menentukan debugging cost.
- JUnit assertions cukup untuk kasus sederhana.
- AssertJ unggul untuk fluent assertion, collection, exception, recursive comparison, soft assertion, dan custom assertion.
- Hamcrest tetap relevan untuk matcher-based API dan legacy/framework integration.
- Custom assertion membantu test berbicara dalam bahasa domain.
- Failure message harus actionable.
- Assertion harus sesuai contract: value, state, event, audit, authorization, idempotency, time, persistence, security, atau performance guard.
- Assertion buruk sering terlalu longgar, terlalu ketat, terlalu teknis, atau miskin diagnostic.
- Java 8–25 compatibility penting terutama untuk syntax helper, JUnit generation, dan modern test library baseline.

Jika part sebelumnya menjawab “bagaimana mendesain test yang jelas”, part ini menjawab:

> Bagaimana membuat bukti dalam test cukup kuat, cukup spesifik, dan cukup mudah didiagnosis ketika gagal.

---

## 49. Referensi

- AssertJ official site dan documentation: https://assertj.github.io/
- AssertJ recursive comparison documentation: https://assertj.github.io/doc/#assertj-core-recursive-comparison
- AssertJ latest Javadoc: https://javadoc.io/doc/org.assertj/assertj-core/latest/index.html
- JUnit User Guide - Assertions: https://docs.junit.org/6.1.0/writing-tests/assertions.html
- JUnit official site: https://junit.org/
- Hamcrest official site: https://hamcrest.org/
- Java Hamcrest documentation: https://hamcrest.org/JavaHamcrest/
- Hamcrest matchers Javadoc: https://hamcrest.org/JavaHamcrest/javadoc/
- Google Testing Blog, “Test Failures Should Be Actionable”: https://testing.googleblog.com/2024/05/test-failures-should-be-actionable.html
- Takebayashi et al., “An Exploratory Study on the Usage and Readability of Messages Within Assertion Methods of Test Cases”: https://arxiv.org/abs/2303.00169

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-testing-benchmarking-performance-jvm-part-003.md">⬅️ Test Design: Arrange-Act-Assert, Given-When-Then, dan Behavioral Clarity</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-testing-benchmarking-performance-jvm-part-005.md">Test Data Engineering: Fixture, Builder, Mother, Factory, Randomized Data ➡️</a>
</div>
