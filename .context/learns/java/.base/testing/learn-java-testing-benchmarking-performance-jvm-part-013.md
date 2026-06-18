# learn-java-testing-benchmarking-performance-jvm-part-013

# Mutation Testing dan Test Quality Measurement

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi testing dari beberapa sisi:

- strategi test berdasarkan risiko,
- desain test yang jelas,
- assertion yang diagnostik,
- test data engineering,
- mocking dan collaboration testing,
- workflow/state-machine testing,
- error-path testing,
- persistence/API/messaging testing,
- property-based testing.

Sekarang kita masuk ke pertanyaan yang lebih tajam:

> Test kita sebenarnya kuat atau hanya terlihat banyak?

Di banyak codebase enterprise Java, angka coverage sering dipakai sebagai indikator kualitas. Masalahnya, coverage hanya menjawab pertanyaan:

> Baris/branch ini pernah dieksekusi oleh test atau tidak?

Coverage tidak menjawab:

> Kalau behavior di baris itu salah, apakah test akan gagal?

Mutation testing mencoba menjawab pertanyaan kedua.

Mutation testing secara sengaja membuat perubahan kecil pada program, misalnya mengganti `>` menjadi `>=`, `true` menjadi `false`, return value menjadi `null`, atau menghapus pemanggilan method void. Setelah itu, test suite dijalankan ulang. Jika test gagal, mutant dianggap **killed**. Jika test tetap pass, mutant dianggap **survived**.

Secara mental model:

```text
Code coverage:
  Apakah test menyentuh kode?

Mutation testing:
  Apakah test akan sadar kalau kode yang disentuh menjadi salah?
```

Part ini sangat penting untuk engineer yang ingin naik level karena mutation testing memaksa kita membedakan antara:

- test yang hanya mengeksekusi kode,
- test yang benar-benar mengobservasi behavior,
- test yang mengunci implementation detail,
- test yang gagal karena fragile,
- test yang memberi bukti kualitas terhadap risiko bisnis.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, Anda harus mampu:

1. Menjelaskan perbedaan line coverage, branch coverage, condition coverage, path coverage, dan mutation coverage.
2. Mengetahui kenapa coverage tinggi bisa tetap menipu.
3. Memahami mutation testing sebagai teknik untuk menguji kualitas test suite.
4. Membaca hasil mutation testing:
   - killed mutant,
   - survived mutant,
   - no coverage,
   - timed out,
   - non-viable mutant,
   - equivalent mutant.
5. Menggunakan PIT/Pitest di project Maven dan Gradle.
6. Menentukan area code mana yang layak diberi mutation testing.
7. Menulis test baru yang membunuh surviving mutant tanpa membuat test overfitted.
8. Menentukan threshold mutation testing yang realistis untuk CI.
9. Menghindari anti-pattern seperti mengejar mutation score secara buta.
10. Mendesain quality measurement yang cocok untuk sistem enterprise Java.

---

## 2. Mental Model Utama: Test Bukan Bukti Kebenaran, Test adalah Sensor Perubahan Salah

Test sering dianggap sebagai “bukti bahwa program benar”. Itu framing yang terlalu kuat.

Framing yang lebih realistis:

> Test adalah sensor yang memberi alarm ketika perubahan tertentu membuat behavior keluar dari expectation.

Sensor bisa punya masalah:

- tidak dipasang di area berisiko,
- terlalu dekat dengan implementation detail,
- tidak sensitif terhadap perubahan penting,
- terlalu sensitif terhadap perubahan tidak penting,
- memberikan false confidence,
- memberikan false alarm.

Coverage hanya memberi tahu sensor pernah dilewati execution path.

Mutation testing menguji sensitivitas sensor.

Contoh:

```java
public boolean isEligible(int age) {
    return age >= 18;
}
```

Test lemah:

```java
@Test
void shouldCheckEligibility() {
    boolean result = service.isEligible(20);
    assertTrue(result);
}
```

Line coverage bisa 100%.

Tapi jika kode dimutasi menjadi:

```java
return age > 18;
```

Test tetap pass karena hanya mencoba `20`.

Mutant survived.

Test yang lebih kuat:

```java
@Test
void shouldAllowExactlyEighteenYearsOldApplicant() {
    assertTrue(service.isEligible(18));
}

@Test
void shouldRejectSeventeenYearsOldApplicant() {
    assertFalse(service.isEligible(17));
}
```

Sekarang mutant `>=` → `>` akan killed.

Pelajarannya:

> Mutation testing memaksa kita menemukan boundary yang benar-benar menentukan business behavior.

---

## 3. Coverage Metrics: Apa yang Diukur dan Apa yang Tidak Diukur

Sebelum masuk mutation testing, kita harus memahami batas coverage tradisional.

### 3.1 Line Coverage

Line coverage mengukur berapa banyak line yang dieksekusi oleh test.

Contoh:

```java
public int discountFor(Customer customer) {
    if (customer.isVip()) {
        return 20;
    }
    return 0;
}
```

Jika test hanya memanggil customer VIP, line `return 20` covered, line `return 0` tidak covered.

Line coverage berguna untuk menemukan area yang tidak disentuh sama sekali.

Namun line coverage tidak membuktikan assertion benar.

Contoh buruk:

```java
@Test
void coversDiscountCode() {
    service.discountFor(vipCustomer());
}
```

Line executed, tetapi tidak ada assertion.

Coverage bisa naik, kualitas tidak naik.

### 3.2 Statement Coverage

Statement coverage mirip dengan line coverage, tetapi lebih konseptual: statement mana yang dieksekusi.

Dalam Java, satu line bisa punya beberapa statement:

```java
int a = 1; int b = 2; return a + b;
```

Line coverage dan statement coverage bisa berbeda dalam granularitas.

### 3.3 Branch Coverage

Branch coverage mengukur cabang decision yang dieksekusi.

Contoh:

```java
if (caseFile.isSubmitted()) {
    approve(caseFile);
} else {
    reject(caseFile);
}
```

Branch coverage akan menuntut test untuk true branch dan false branch.

Ini lebih baik dari line coverage, tetapi tetap belum cukup.

Contoh:

```java
if (age >= 18) {
    return ALLOWED;
}
return DENIED;
```

Test dengan age `20` dan `10` memberi branch coverage 100%.

Tapi mutant `>=` → `>` tetap bisa survive jika tidak ada test age `18`.

Branch coverage tidak otomatis memastikan boundary condition.

### 3.4 Condition Coverage

Condition coverage melihat sub-condition dalam expression compound.

Contoh:

```java
if (user.hasRole("OFFICER") && caseFile.isSubmitted()) {
    return true;
}
```

Line/branch coverage bisa saja terlihat cukup, tetapi condition coverage bertanya:

- pernahkah `hasRole` true?
- pernahkah `hasRole` false?
- pernahkah `isSubmitted` true?
- pernahkah `isSubmitted` false?

Namun condition coverage pun belum selalu menangkap interaksi antar condition.

### 3.5 Path Coverage

Path coverage mencoba mengukur kombinasi jalur execution.

Untuk kode dengan banyak branch, jumlah path bisa meledak secara eksponensial.

Contoh:

```java
if (a) { ... }
if (b) { ... }
if (c) { ... }
if (d) { ... }
```

Jumlah kombinasi bisa 2⁴ = 16 path.

Dalam workflow enterprise, path bisa ribuan.

Path coverage secara penuh sering tidak realistis.

### 3.6 Mutation Coverage

Mutation coverage mengukur seberapa banyak perubahan kecil yang berhasil dideteksi oleh test.

Formula sederhana:

```text
mutation score = killed mutants / total relevant mutants
```

Namun angka ini harus dibaca hati-hati karena ada:

- equivalent mutant,
- irrelevant mutant,
- trivial mutant,
- invalid mutant,
- mutant di code yang memang tidak perlu diuji secara detail,
- generated code,
- framework glue code,
- DTO trivial.

Mutation coverage lebih dekat ke kualitas test, tetapi bukan absolut.

---

## 4. Kenapa 100% Coverage Bisa Tetap Buruk

Bayangkan kode berikut:

```java
public Decision evaluate(Application application) {
    if (application.hasOutstandingDebt()) {
        return Decision.REJECTED;
    }

    if (application.getScore() >= 70) {
        return Decision.APPROVED;
    }

    return Decision.MANUAL_REVIEW;
}
```

Test buruk:

```java
@Test
void shouldEvaluateApplications() {
    evaluator.evaluate(applicationWithDebt());
    evaluator.evaluate(applicationWithScore(80));
    evaluator.evaluate(applicationWithScore(50));
}
```

Coverage bisa tinggi karena semua branch dieksekusi.

Tapi tidak ada assertion.

Test sedikit lebih baik tetapi masih lemah:

```java
@Test
void shouldEvaluateApplications() {
    assertNotNull(evaluator.evaluate(applicationWithDebt()));
    assertNotNull(evaluator.evaluate(applicationWithScore(80)));
    assertNotNull(evaluator.evaluate(applicationWithScore(50)));
}
```

Coverage tetap tinggi.

Mutation testing akan mengekspos masalahnya.

Mutasi:

```java
return Decision.REJECTED;
```

menjadi:

```java
return Decision.APPROVED;
```

Test tetap pass karena hanya `assertNotNull`.

Mutant survived.

Test yang benar:

```java
@Test
void shouldRejectApplicationWithOutstandingDebt() {
    Decision decision = evaluator.evaluate(applicationWithDebt());

    assertThat(decision).isEqualTo(Decision.REJECTED);
}

@Test
void shouldApproveApplicationWithScoreAtLeastSeventy() {
    Decision decision = evaluator.evaluate(applicationWithScore(70));

    assertThat(decision).isEqualTo(Decision.APPROVED);
}

@Test
void shouldSendApplicationBelowScoreThresholdToManualReview() {
    Decision decision = evaluator.evaluate(applicationWithScore(69));

    assertThat(decision).isEqualTo(Decision.MANUAL_REVIEW);
}
```

Sekarang test bukan hanya menyentuh kode, tetapi mengunci behavior penting.

---

## 5. Mutation Testing: Konsep Inti

### 5.1 Mutant

Mutant adalah versi kecil yang diubah dari program.

Original:

```java
return amount.compareTo(BigDecimal.ZERO) > 0;
```

Mutant:

```java
return amount.compareTo(BigDecimal.ZERO) >= 0;
```

### 5.2 Mutation Operator / Mutator

Mutation operator adalah aturan perubahan.

Contoh:

- ubah relational operator,
- ubah arithmetic operator,
- hapus pemanggilan method void,
- ubah return value,
- ubah conditional boundary,
- ubah increment/decrement,
- ubah constant,
- ubah negasi boolean,
- ubah null return.

### 5.3 Killed Mutant

Mutant disebut killed jika test gagal saat mutant dijalankan.

Artinya test suite sensitif terhadap perubahan tersebut.

### 5.4 Survived Mutant

Mutant survived jika test tetap pass walaupun kode berubah.

Artinya bisa jadi:

- tidak ada test yang memeriksa behavior itu,
- assertion terlalu lemah,
- test data tidak mencapai boundary,
- mutant equivalent,
- mutant tidak relevan terhadap observable behavior.

### 5.5 No Coverage

No coverage berarti mutant berada di code yang tidak dieksekusi test.

Ini biasanya lebih buruk dari survived, karena sensor belum menyentuh area itu sama sekali.

### 5.6 Timed Out

Mutant timed out jika test berjalan terlalu lama, biasanya karena mutasi menyebabkan infinite loop atau blocking behavior.

Contoh:

Original:

```java
while (attempt < maxAttempts) {
    attempt++;
}
```

Mutant bisa mengubah increment atau condition sehingga loop tidak selesai.

### 5.7 Non-Viable Mutant

Non-viable mutant adalah mutant yang tidak dapat dijalankan valid, misalnya menghasilkan bytecode invalid atau class tidak bisa diload.

Tool modern biasanya menyaring banyak kasus ini.

### 5.8 Equivalent Mutant

Equivalent mutant adalah mutant yang secara sintaks berbeda tetapi behavior observable-nya sama.

Contoh sederhana:

```java
return value * 1;
```

Mutant:

```java
return value / 1;
```

Untuk integer tertentu, bisa equivalent terhadap domain input yang valid.

Contoh yang lebih realistis:

```java
if (items.size() == 0) {
    return true;
}
```

Mutant:

```java
if (items.isEmpty()) {
    return true;
}
```

Secara behavior sama.

Equivalent mutant tidak seharusnya “dibunuh” dengan test aneh. Biasanya perlu dikecualikan, diterima, atau dianggap noise.

---

## 6. Mutation Testing Tooling di Java

### 6.1 PIT / Pitest

PIT atau Pitest adalah tool mutation testing populer untuk Java/JVM. Ia bekerja pada bytecode, bukan source code langsung.

Konsekuensinya:

- relatif cepat dibanding source-level mutation naïve,
- dapat bekerja dengan banyak project JVM,
- report dikaitkan kembali ke source line,
- mutasi terjadi setelah kompilasi,
- beberapa mutasi source-level yang kompleks tidak tersedia.

PIT menyediakan integrasi Maven dan command line secara resmi. Integrasi Gradle tersedia melalui plugin komunitas yang sangat umum dipakai.

### 6.2 JaCoCo

JaCoCo adalah tool code coverage Java yang umum dipakai.

JaCoCo menjawab:

```text
Bagian mana dari kode yang dieksekusi test?
```

PIT menjawab:

```text
Bagian mana dari perubahan salah yang dideteksi test?
```

Keduanya saling melengkapi.

Salah satu praktik sehat:

```text
JaCoCo:
  gunakan untuk menemukan blind spot eksekusi.

PIT:
  gunakan untuk menguji kualitas assertion dan boundary test di area penting.
```

### 6.3 SonarQube dan Coverage Gate

SonarQube sering dipakai untuk coverage gate, tetapi coverage gate saja tidak cukup.

Contoh gate yang buruk:

```text
Minimum line coverage 80% untuk semua module.
```

Masalah:

- mendorong test kosmetik,
- tidak membedakan risiko module,
- mengabaikan assertion quality,
- bisa menghukum DTO/config glue code,
- bisa memberi false confidence.

Gate lebih baik:

```text
For changed critical domain code:
  - branch coverage adequate for business branch,
  - mutation score above agreed threshold,
  - no surviving mutant on critical rules unless justified,
  - regression test exists for fixed bug.
```

---

## 7. Setup PIT dengan Maven

### 7.1 Dependency dan Plugin Dasar

Contoh konfigurasi Maven:

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.pitest</groupId>
            <artifactId>pitest-maven</artifactId>
            <version>1.25.3</version>
            <configuration>
                <targetClasses>
                    <param>com.example.caseapp.domain.*</param>
                    <param>com.example.caseapp.application.*</param>
                </targetClasses>
                <targetTests>
                    <param>com.example.caseapp.*Test</param>
                    <param>com.example.caseapp.*Tests</param>
                </targetTests>
            </configuration>
        </plugin>
    </plugins>
</build>
```

Catatan:

- Versi plugin harus disesuaikan dengan project.
- Untuk JUnit 5/JUnit Platform, PIT modern umumnya mendukung discovery via plugin/config yang sesuai.
- Untuk project multi-module, konfigurasi biasanya perlu dipasang di parent POM dengan target per module.

### 7.2 Menjalankan PIT

Command umum:

```bash
mvn test-compile org.pitest:pitest-maven:mutationCoverage
```

Output report biasanya berada di:

```text
target/pit-reports/<timestamp>/index.html
```

### 7.3 Konfigurasi Target yang Lebih Selektif

Jangan langsung mutate seluruh monorepo besar.

Mulai dari area penting:

```xml
<configuration>
    <targetClasses>
        <param>com.example.caseapp.domain.casefile.*</param>
        <param>com.example.caseapp.domain.workflow.*</param>
        <param>com.example.caseapp.application.approval.*</param>
    </targetClasses>
    <targetTests>
        <param>com.example.caseapp.domain.casefile.*Test</param>
        <param>com.example.caseapp.domain.workflow.*Test</param>
        <param>com.example.caseapp.application.approval.*Test</param>
    </targetTests>
</configuration>
```

Good initial target:

- pure domain logic,
- validation logic,
- state transition logic,
- money/SLA calculation,
- authorization decision,
- idempotency decision,
- retry classification,
- mapper yang punya semantic transformation.

Bad initial target:

- generated DTO,
- Lombok-only class,
- framework configuration,
- Spring Boot main class,
- trivial getter/setter,
- database migration class,
- controller glue yang sudah diuji lewat API contract,
- code dengan flaky integration dependency.

---

## 8. Setup PIT dengan Gradle

Contoh Gradle Kotlin DSL dengan plugin umum:

```kotlin
plugins {
    java
    id("info.solidsoft.pitest") version "1.15.0"
}

pitest {
    targetClasses.set(setOf(
        "com.example.caseapp.domain.*",
        "com.example.caseapp.application.*"
    ))
    targetTests.set(setOf(
        "com.example.caseapp.*Test",
        "com.example.caseapp.*Tests"
    ))
    junit5PluginVersion.set("1.2.1")
    threads.set(4)
    outputFormats.set(setOf("HTML", "XML"))
    timestampedReports.set(false)
}
```

Command:

```bash
./gradlew pitest
```

Catatan penting:

- Plugin Gradle PIT adalah integrasi pihak ketiga, bukan core PIT Maven plugin.
- Pastikan versi plugin cocok dengan Gradle, Java, dan JUnit yang dipakai.
- Untuk Java 17+ dan JUnit Platform modern, cek compatibility plugin.
- Untuk CI, aktifkan XML output agar bisa diproses otomatis.

---

## 9. Membaca PIT Report

PIT report biasanya menampilkan:

- line coverage,
- mutation coverage,
- test strength,
- killed mutants,
- survived mutants,
- no coverage,
- timeout,
- source file view,
- mutator type,
- test yang membunuh mutant.

### 9.1 Contoh Report Conceptual

```text
Class: CaseEligibilityEvaluator
Line coverage: 95%
Mutation coverage: 62%
Test strength: 65%

Survived mutants:
  Line 42: changed conditional boundary >= to >
  Line 57: replaced return value APPROVED with REJECTED
  Line 81: removed call to AuditTrail.record
```

Interpretasi:

- Line coverage tinggi, jadi test menyentuh banyak code.
- Mutation coverage sedang/rendah, berarti assertion/boundary kurang kuat.
- Mutant conditional boundary di line 42 mungkin menunjukkan missing boundary test.
- Return value mutant menunjukkan assertion expected decision kurang spesifik.
- Removed audit call menunjukkan test tidak memverifikasi audit side effect.

### 9.2 Test Strength

Test strength biasanya mengukur kemampuan test membunuh mutant pada code yang memang covered.

Simplified:

```text
test strength = killed mutants / covered mutants
```

Jika line coverage rendah, mutation score rendah bisa karena no coverage.

Jika line coverage tinggi tetapi test strength rendah, masalahnya assertion quality.

---

## 10. Mutator Penting dan Apa yang Mereka Ungkap

### 10.1 Conditional Boundary Mutator

Original:

```java
if (score >= 70) {
    return APPROVED;
}
```

Mutant:

```java
if (score > 70) {
    return APPROVED;
}
```

Mengungkap:

- missing boundary test,
- rule threshold tidak diuji,
- test terlalu jauh dari edge.

Test yang membunuh:

```java
@Test
void shouldApproveScoreExactlyAtThreshold() {
    assertThat(evaluator.evaluate(score(70))).isEqualTo(APPROVED);
}
```

### 10.2 Negate Conditionals Mutator

Original:

```java
if (caseFile.isSubmitted()) {
    return true;
}
```

Mutant:

```java
if (!caseFile.isSubmitted()) {
    return true;
}
```

Mengungkap:

- missing negative case,
- branch expectation tidak spesifik,
- boolean logic tidak diuji lengkap.

### 10.3 Return Values Mutator

Original:

```java
return Decision.APPROVED;
```

Mutant:

```java
return Decision.REJECTED;
```

Mengungkap:

- assertion terlalu lemah,
- test hanya `notNull`,
- test hanya memverifikasi side effect lain,
- expected result tidak dikunci.

### 10.4 Void Method Call Mutator

Original:

```java
auditTrail.record(caseFile.id(), "APPROVED", actor.id());
```

Mutant:

```java
// auditTrail.record(...) removed
```

Mengungkap:

- side effect penting tidak diverifikasi,
- audit/compliance behavior tidak diuji,
- test hanya memverifikasi state akhir.

Namun hati-hati:

Tidak semua void call perlu diuji.

Yang layak diuji:

- publish event,
- write audit trail,
- send command,
- persist side effect,
- record idempotency key,
- release lock,
- rollback/compensate.

Yang biasanya tidak perlu:

- logging debug,
- metrics non-critical,
- helper internal tanpa semantic effect.

### 10.5 Math Mutator

Original:

```java
return baseFee.add(latePenalty);
```

Mutant:

```java
return baseFee.subtract(latePenalty);
```

Mengungkap:

- calculation test tidak cukup,
- expected value terlalu umum,
- test tidak mencakup non-zero penalty.

### 10.6 Increments Mutator

Original:

```java
attempt++;
```

Mutant:

```java
attempt--;
```

Mengungkap:

- retry loop tidak diuji dengan baik,
- loop termination tidak diuji,
- timeout test tidak ada,
- max attempts tidak diverifikasi.

### 10.7 Null Return Mutator

Original:

```java
return Optional.of(result);
```

Mutant:

```java
return null;
```

Mengungkap:

- null contract tidak diuji,
- caller tidak memvalidasi result,
- test tidak mengecek object returned.

### 10.8 Empty Return Mutator

Original:

```java
return violations;
```

Mutant:

```java
return Collections.emptyList();
```

Mengungkap:

- collection content tidak diverifikasi,
- only size assertion missing,
- validation errors tidak diuji detail.

---

## 11. Case Study: Coverage Tinggi, Mutation Score Rendah

### 11.1 Production Code

```java
public final class CaseSubmissionValidator {

    public List<ValidationError> validate(CaseFile caseFile) {
        List<ValidationError> errors = new ArrayList<>();

        if (caseFile.getApplicantId() == null) {
            errors.add(new ValidationError("applicantId", "Applicant is required"));
        }

        if (caseFile.getDocuments().isEmpty()) {
            errors.add(new ValidationError("documents", "At least one document is required"));
        }

        if (caseFile.getSubmittedAt() != null) {
            errors.add(new ValidationError("submittedAt", "Case has already been submitted"));
        }

        return errors;
    }
}
```

### 11.2 Test Lemah

```java
@Test
void shouldValidateCaseFile() {
    CaseFile invalid = CaseFileBuilder.aCaseFile()
        .withoutApplicant()
        .withoutDocuments()
        .alreadySubmitted()
        .build();

    List<ValidationError> errors = validator.validate(invalid);

    assertThat(errors).isNotEmpty();
}
```

Masalah:

- semua branch mungkin covered,
- assertion hanya `isNotEmpty`,
- tidak tahu error mana yang wajib muncul,
- jika salah satu validation dihapus, test tetap pass.

### 11.3 Mutant yang Survive

Mutasi:

```java
if (caseFile.getDocuments().isEmpty()) {
```

menjadi:

```java
if (!caseFile.getDocuments().isEmpty()) {
```

Test masih bisa pass karena error applicant/submittedAt tetap ada.

### 11.4 Test yang Lebih Kuat

```java
@Test
void shouldRejectCaseWithoutApplicant() {
    CaseFile invalid = CaseFileBuilder.aCaseFile()
        .withoutApplicant()
        .withDocument("identity.pdf")
        .notSubmittedYet()
        .build();

    List<ValidationError> errors = validator.validate(invalid);

    assertThat(errors)
        .extracting(ValidationError::field)
        .containsExactly("applicantId");
}

@Test
void shouldRejectCaseWithoutDocuments() {
    CaseFile invalid = CaseFileBuilder.aCaseFile()
        .withApplicant("A-001")
        .withoutDocuments()
        .notSubmittedYet()
        .build();

    List<ValidationError> errors = validator.validate(invalid);

    assertThat(errors)
        .extracting(ValidationError::field)
        .containsExactly("documents");
}

@Test
void shouldRejectAlreadySubmittedCase() {
    CaseFile invalid = CaseFileBuilder.aCaseFile()
        .withApplicant("A-001")
        .withDocument("identity.pdf")
        .alreadySubmitted()
        .build();

    List<ValidationError> errors = validator.validate(invalid);

    assertThat(errors)
        .extracting(ValidationError::field)
        .containsExactly("submittedAt");
}
```

Perbaikan:

- setiap rule diuji secara isolated,
- expected field spesifik,
- tidak ada masking antar error,
- mutant condition lebih mudah killed,
- failure message lebih jelas.

---

## 12. Mutation Testing untuk Domain dan Workflow

Mutation testing paling bernilai untuk logic yang punya decision penting.

Contoh domain:

```java
public boolean canTransitionTo(CaseStatus target, UserRole role) {
    if (status == CaseStatus.DRAFT && target == CaseStatus.SUBMITTED) {
        return role == UserRole.APPLICANT;
    }

    if (status == CaseStatus.SUBMITTED && target == CaseStatus.UNDER_REVIEW) {
        return role == UserRole.OFFICER;
    }

    if (status == CaseStatus.UNDER_REVIEW && target == CaseStatus.APPROVED) {
        return role == UserRole.SENIOR_OFFICER;
    }

    return false;
}
```

Coverage bisa tinggi jika kita punya beberapa test happy path.

Mutation testing akan menuntut:

- invalid transition diuji,
- wrong role diuji,
- terminal state diuji,
- target status boundary diuji,
- false branch diuji,
- role/status combinations diuji.

Table-driven test:

```java
@ParameterizedTest
@MethodSource("transitionCases")
void shouldEvaluateTransitionPermission(
    CaseStatus current,
    CaseStatus target,
    UserRole role,
    boolean expected
) {
    CaseFile caseFile = CaseFileBuilder.aCaseFile()
        .withStatus(current)
        .build();

    assertThat(caseFile.canTransitionTo(target, role)).isEqualTo(expected);
}

static Stream<Arguments> transitionCases() {
    return Stream.of(
        arguments(DRAFT, SUBMITTED, APPLICANT, true),
        arguments(DRAFT, SUBMITTED, OFFICER, false),
        arguments(SUBMITTED, UNDER_REVIEW, OFFICER, true),
        arguments(SUBMITTED, UNDER_REVIEW, APPLICANT, false),
        arguments(UNDER_REVIEW, APPROVED, SENIOR_OFFICER, true),
        arguments(UNDER_REVIEW, APPROVED, OFFICER, false),
        arguments(APPROVED, SUBMITTED, SENIOR_OFFICER, false)
    );
}
```

Mutation testing akan membantu menemukan missing combination.

Namun jangan mengejar semua kombinasi secara brute force jika state space besar. Gunakan risk-based selection:

- allowed path,
- forbidden path,
- boundary status,
- terminal status,
- privileged role,
- non-privileged role,
- cross-agency/cross-ownership case,
- historical incident/bug path.

---

## 13. Mutation Testing untuk Authorization Logic

Authorization logic adalah kandidat kuat mutation testing.

Contoh:

```java
public boolean canViewCase(User user, CaseFile caseFile) {
    return user.hasRole(ADMIN)
        || caseFile.assignedOfficerId().equals(user.id())
        || caseFile.applicantId().equals(user.id());
}
```

Risiko:

- `||` berubah menjadi `&&`,
- condition dihapus,
- wrong ID dibandingkan,
- role check salah,
- null handling salah.

Test perlu mencakup:

```text
admin can view any case
assigned officer can view assigned case
applicant can view own case
unassigned officer cannot view case
other applicant cannot view case
anonymous/null user rejected
```

Mutation testing membantu memastikan test tidak hanya mengecek satu happy path.

Anti-pattern umum:

```java
@Test
void shouldAllowAuthorizedUser() {
    assertTrue(policy.canViewCase(admin(), caseFile()));
}
```

Ini tidak menguji unauthorized access.

Untuk security/authorization, mutant survived pada deny-path jauh lebih berbahaya daripada mutant survived pada formatting/helper code.

---

## 14. Mutation Testing untuk Error Handling

Error handling sering punya coverage tinggi tapi mutation score rendah.

Contoh:

```java
public RetryDecision classify(Throwable error) {
    if (error instanceof TimeoutException) {
        return RETRYABLE;
    }
    if (error instanceof ValidationException) {
        return NON_RETRYABLE;
    }
    if (error instanceof AuthenticationException) {
        return REFRESH_TOKEN_AND_RETRY;
    }
    return UNKNOWN_FAILURE;
}
```

Mutation testing akan mengekspos:

- wrong classification,
- missing exact exception type,
- subclass handling,
- default branch yang tidak diuji,
- return value assertion lemah.

Test baik:

```java
@ParameterizedTest
@MethodSource("classificationCases")
void shouldClassifyErrors(Throwable error, RetryDecision expected) {
    assertThat(classifier.classify(error)).isEqualTo(expected);
}
```

Tambahkan negative test untuk memastikan validation tidak diretry:

```java
@Test
void shouldNotRetryValidationFailure() {
    RetryDecision decision = classifier.classify(new ValidationException("invalid"));

    assertThat(decision).isEqualTo(NON_RETRYABLE);
}
```

Ini penting karena retry terhadap non-retryable error bisa memperburuk outage.

---

## 15. Mutation Testing untuk Idempotency

Idempotency logic sering terlihat sederhana tetapi failure-nya mahal.

Contoh:

```java
public SubmissionResult submit(SubmitCommand command) {
    Optional<SubmissionResult> existing = idempotencyStore.find(command.idempotencyKey());
    if (existing.isPresent()) {
        return existing.get();
    }

    SubmissionResult result = doSubmit(command);
    idempotencyStore.save(command.idempotencyKey(), result);
    return result;
}
```

Mutasi yang berbahaya:

- `existing.isPresent()` dibalik,
- `save` dihapus,
- return existing diganti result baru,
- key yang dipakai salah,
- duplicate side effect tidak dicegah.

Test yang harus ada:

```java
@Test
void shouldReturnExistingResultForDuplicateSubmission() {
    IdempotencyKey key = new IdempotencyKey("K-001");
    SubmissionResult existing = SubmissionResult.accepted("CASE-001");
    idempotencyStore.save(key, existing);

    SubmissionResult result = service.submit(commandWithKey(key));

    assertThat(result).isEqualTo(existing);
    assertThat(caseRepository.createdCases()).isEmpty();
}

@Test
void shouldStoreResultAfterFirstSuccessfulSubmission() {
    IdempotencyKey key = new IdempotencyKey("K-002");

    SubmissionResult result = service.submit(commandWithKey(key));

    assertThat(idempotencyStore.find(key)).contains(result);
}
```

Mutation testing dapat mendeteksi apakah `save` benar-benar diuji sebagai side effect penting.

---

## 16. Mutation Testing untuk Audit Trail dan Compliance

Dalam sistem regulatory, audit bukan sekadar logging. Audit adalah bagian dari evidence.

Contoh:

```java
public void approve(CaseId caseId, OfficerId officerId) {
    CaseFile caseFile = repository.get(caseId);
    caseFile.approve(officerId);
    repository.save(caseFile);
    auditTrail.record(caseId, "CASE_APPROVED", officerId);
}
```

Mutant:

```java
// auditTrail.record(...) removed
```

Jika test tetap pass, artinya approval test tidak memverifikasi audit.

Test yang lebih defensible:

```java
@Test
void shouldRecordAuditTrailWhenCaseApproved() {
    CaseFile caseFile = repository.save(submittedCase());
    OfficerId officer = new OfficerId("O-001");

    service.approve(caseFile.id(), officer);

    assertThat(auditTrail.entries())
        .singleElement()
        .satisfies(entry -> {
            assertThat(entry.caseId()).isEqualTo(caseFile.id());
            assertThat(entry.action()).isEqualTo("CASE_APPROVED");
            assertThat(entry.actorId()).isEqualTo(officer.value());
        });
}
```

Namun jangan memverifikasi semua call internal.

Verifikasi audit karena ia adalah domain/compliance side effect.

Tidak perlu memverifikasi:

```java
logger.info("Approved case {}", caseId);
```

kecuali logging itu memang security/compliance evidence resmi, yang jarang seharusnya terjadi tanpa audit store yang structured.

---

## 17. Equivalent Mutant: Jangan Terjebak Mengejar 100%

Equivalent mutant adalah salah satu alasan mutation score tidak boleh dijadikan dogma.

Contoh:

```java
public boolean hasNoDocuments() {
    return documents.size() == 0;
}
```

Mutant:

```java
return documents.isEmpty();
```

Jika secara domain `documents` tidak mungkin null, behavior sama.

Contoh lain:

```java
if (amount.compareTo(BigDecimal.ZERO) > 0) {
    return true;
}
return false;
```

Mutant tertentu mungkin mengubah struktur return tapi tidak mengubah behavior observable.

Apa yang dilakukan?

1. Jangan menulis test aneh hanya untuk membunuh equivalent mutant.
2. Catat sebagai accepted equivalent/noise jika tool memungkinkan.
3. Exclude area/mutator tertentu jika menghasilkan terlalu banyak noise.
4. Fokus pada surviving mutant yang merepresentasikan risiko nyata.

Top-tier mindset:

> Mutation score adalah sinyal investigasi, bukan target moral.

---

## 18. Kapan Mutation Testing Sangat Bernilai

Gunakan mutation testing pada code dengan karakteristik:

### 18.1 High Business Criticality

- approval/rejection decision,
- payment/fee/penalty calculation,
- eligibility,
- enforcement action,
- SLA/escalation,
- authorization,
- audit evidence.

### 18.2 High Branch Density

- banyak condition,
- banyak status,
- banyak role,
- banyak rule exception.

### 18.3 Historical Bug Area

- bug sering muncul,
- pernah ada incident,
- pernah ada regression,
- behavior sering berubah karena CR.

### 18.4 Domain Pure Logic

- tidak tergantung database/network,
- deterministic,
- cepat dijalankan,
- mudah dibuat test data.

### 18.5 Library/Internal Shared Component

- dipakai banyak module,
- failure berdampak luas,
- reusable policy/rule engine.

---

## 19. Kapan Mutation Testing Kurang Bernilai

Mutation testing bisa mahal dan noisy di area tertentu.

Kurang cocok untuk:

- DTO murni,
- generated code,
- mapper trivial tanpa rule,
- Spring configuration,
- bootstrap class,
- controller yang hanya delegasi,
- integration test lambat,
- code yang bergantung pada waktu/network random tanpa isolation,
- code dengan banyak reflection/framework magic,
- UI snapshot glue,
- code lama yang belum punya test baseline sama sekali.

Untuk code lama tanpa test, urutannya:

```text
1. Tambah characterization test.
2. Tambah branch/boundary test untuk area risiko.
3. Stabilkan fixture dan determinisme.
4. Baru jalankan mutation testing secara selektif.
```

Jangan langsung menjalankan PIT ke seluruh legacy codebase dan menganggap hasil rendah sebagai kegagalan tim. Itu hanya menghasilkan noise dan resistensi.

---

## 20. CI Strategy untuk Mutation Testing

Mutation testing lebih mahal daripada unit test biasa karena test dijalankan berkali-kali terhadap mutant.

Jadi jangan sembarang memasang di setiap PR untuk semua module.

### 20.1 Strategy Bertahap

```text
Level 0:
  Jalankan manual untuk module critical.

Level 1:
  Jalankan nightly untuk package critical.

Level 2:
  Jalankan di PR hanya untuk changed classes tertentu.

Level 3:
  Jadikan gate untuk critical rules dengan threshold realistis.
```

### 20.2 PR Gate yang Masuk Akal

Contoh:

```text
For changed domain/application classes under critical package:
  - no new surviving mutant in changed lines unless justified,
  - mutation score must not decrease beyond tolerance,
  - no no-coverage mutant on newly added decision code.
```

Lebih baik daripada:

```text
All modules must have mutation score >= 90%.
```

### 20.3 Nightly Mutation Job

Nightly cocok untuk:

- seluruh domain module,
- historical regression module,
- authorization package,
- rule engine,
- SLA/escalation package.

Artifact yang disimpan:

- HTML report,
- XML report,
- changed score trend,
- top surviving mutants,
- no coverage classes,
- execution time.

### 20.4 Threshold Awal

Threshold awal yang realistis:

```text
Legacy module:
  observe only, no gate.

Improving module:
  prevent score from decreasing.

Critical new code:
  70–85% mutation score depending on equivalent/noise profile.

Critical pure domain logic:
  85–95% possible if code is deterministic and well-designed.
```

Jangan jadikan angka universal.

Threshold harus mempertimbangkan:

- mutator set,
- package type,
- test speed,
- equivalent mutant rate,
- business risk,
- team maturity.

---

## 21. Menggunakan Mutation Testing untuk Review Pull Request

Mutation testing bisa menjadi review assistant.

Pertanyaan review:

```text
1. Mutant apa yang survive?
2. Apakah mutant itu mewakili bug nyata?
3. Kalau iya, behavior apa yang belum diuji?
4. Apakah perlu test baru, assertion lebih spesifik, atau refactor design?
5. Kalau tidak, apakah mutant equivalent/noise dan perlu dicatat?
6. Apakah surviving mutant berada di area critical?
```

Contoh review comment yang baik:

```text
PIT shows a surviving conditional-boundary mutant on score >= 70.
This seems behaviorally important because 70 is the approval threshold.
Can we add a boundary test for score exactly 70 and 69 instead of only testing 80 and 50?
```

Contoh review comment yang buruk:

```text
Mutation score must be 100%. Please fix.
```

Mutation testing harus menaikkan kualitas diskusi, bukan menjadi angka hukuman.

---

## 22. Mutation Testing dan Property-Based Testing

Property-based testing sering sangat efektif membunuh mutant.

Contoh function:

```java
public Money calculateTotal(List<Fee> fees) {
    return fees.stream()
        .map(Fee::amount)
        .reduce(Money.zero(), Money::add);
}
```

Example-based test mungkin hanya menguji 2 fee.

Property:

```text
Total should be independent of fee order.
```

Test property:

```java
@Property
void totalShouldBeIndependentOfFeeOrder(@ForAll("feeLists") List<Fee> fees) {
    List<Fee> shuffled = new ArrayList<>(fees);
    Collections.shuffle(shuffled, new Random(123));

    assertThat(calculator.calculateTotal(shuffled))
        .isEqualTo(calculator.calculateTotal(fees));
}
```

Property lain:

```text
Adding zero fee should not change total.
Combining two lists should equal sum of each list's total.
Removing one fee should reduce total by that fee amount.
```

Mutation testing dan property-based testing saling menguatkan:

- PIT menunjukkan surviving mutant.
- Property-based testing membantu membangun generalized test untuk membunuh class of mutants.

Namun hati-hati:

Property yang salah bisa mengunci asumsi bisnis yang tidak benar.

---

## 23. Mutation Testing dan Test Data Engineering

Surviving mutant sering bukan karena tidak ada test, tetapi karena data test terlalu miskin.

Contoh:

```java
if (amount.compareTo(BigDecimal.ZERO) > 0) {
    return CHARGEABLE;
}
return FREE;
```

Test hanya memakai amount `100`.

Mutant boundary survive.

Data yang dibutuhkan:

```text
- positive amount: 100
- zero amount: 0
- negative amount: -1 if domain allows
- smallest valid positive amount: 0.01
```

Test data builder harus menyediakan boundary helper:

```java
FeeBuilder.aFee().withAmount("0.00")
FeeBuilder.aFee().withAmount("0.01")
FeeBuilder.aFee().withAmount("-0.01")
```

Mutation testing sering mengungkap bahwa builder default terlalu happy-path.

---

## 24. Mutation Testing dan Assertion Engineering

Surviving mutant sering karena assertion terlalu lemah.

Assertion lemah:

```java
assertThat(result).isNotNull();
```

Lebih baik:

```java
assertThat(result.status()).isEqualTo(APPROVED);
assertThat(result.caseId()).isEqualTo(expectedCaseId);
assertThat(result.approvedAt()).isEqualTo(fixedClock.instant());
```

Assertion lemah:

```java
assertThat(errors).hasSize(1);
```

Lebih baik:

```java
assertThat(errors)
    .extracting(ValidationError::field, ValidationError::code)
    .containsExactly(tuple("documents", "REQUIRED"));
```

Assertion lemah:

```java
verify(repository).save(any());
```

Lebih baik:

```java
ArgumentCaptor<CaseFile> captor = ArgumentCaptor.forClass(CaseFile.class);
verify(repository).save(captor.capture());

assertThat(captor.getValue().status()).isEqualTo(APPROVED);
assertThat(captor.getValue().approvedBy()).isEqualTo(officerId);
```

Mutation testing memperlihatkan apakah assertion kita benar-benar mengamati semantic output.

---

## 25. Mutation Testing untuk Mapper dan DTO: Selektif

Tidak semua mapper layak mutation testing.

Mapper trivial:

```java
public CaseResponse toResponse(CaseFile caseFile) {
    return new CaseResponse(
        caseFile.id().value(),
        caseFile.status().name()
    );
}
```

Jika mapper ini hanya field copy, mutation testing mungkin tidak terlalu bernilai.

Namun mapper menjadi penting jika ada semantic transformation:

```java
public CaseResponse toResponse(CaseFile caseFile, User viewer) {
    return new CaseResponse(
        caseFile.id().value(),
        maskApplicantNameIfNotAuthorized(caseFile, viewer),
        deriveDisplayStatus(caseFile.status(), viewer.role()),
        calculateRemainingSlaDays(caseFile)
    );
}
```

Ini layak mutation testing karena ada:

- masking/security rule,
- display status derivation,
- SLA calculation,
- role-sensitive behavior.

Rule:

```text
Do not mutation-test mapping because it is mapping.
Mutation-test mapping when it contains business/security/compliance transformation.
```

---

## 26. Mutation Testing untuk Spring/Jakarta Application Service

Application service sering punya orchestration:

```java
@Transactional
public ApprovalResult approve(ApproveCommand command) {
    CaseFile caseFile = repository.get(command.caseId());
    policy.checkCanApprove(command.actor(), caseFile);
    caseFile.approve(command.actor());
    repository.save(caseFile);
    outbox.append(CaseApprovedEvent.from(caseFile));
    audit.recordApproval(caseFile, command.actor());
    return ApprovalResult.from(caseFile);
}
```

Mutation testing application service bisa noisy jika banyak dependency mock.

Namun ia berguna jika kita ingin memastikan side effect penting tidak hilang:

- policy check tidak dihapus,
- repository save tidak dihapus,
- outbox event tidak dihapus,
- audit tidak dihapus,
- return result benar,
- actor/caseId benar.

Test dengan fake lebih baik daripada mock berlebihan:

```java
@Test
void shouldApproveCaseAndRecordAllEvidence() {
    FakeCaseRepository repository = new FakeCaseRepository();
    FakeOutbox outbox = new FakeOutbox();
    FakeAuditTrail audit = new FakeAuditTrail();

    CaseFile submitted = repository.save(submittedCase());
    Officer officer = seniorOfficer();

    ApprovalResult result = service.approve(new ApproveCommand(submitted.id(), officer.id()));

    assertThat(result.status()).isEqualTo(APPROVED);
    assertThat(repository.get(submitted.id()).status()).isEqualTo(APPROVED);
    assertThat(outbox.events()).hasExactlyOneElementsOfType(CaseApprovedEvent.class);
    assertThat(audit.entries()).hasSize(1);
}
```

Mutation testing akan mendeteksi jika event/audit/save dihapus.

Tapi jangan membuat test terlalu terikat ke call order kecuali order adalah contract.

---

## 27. Mutation Testing dan Refactoring

Surviving mutants sering menunjukkan design smell.

Contoh:

```java
public void process(Command command) {
    if (command.type().equals("APPROVE")) {
        // 50 lines
    } else if (command.type().equals("REJECT")) {
        // 50 lines
    } else if (command.type().equals("WITHDRAW")) {
        // 50 lines
    }
}
```

Mutation report penuh surviving mutants.

Mungkin masalah bukan hanya test kurang.

Mungkin code terlalu banyak responsibility.

Refactor:

```text
ApprovalHandler
RejectionHandler
WithdrawalHandler
CommandRouter
```

Setelah refactor:

- setiap handler lebih mudah diuji,
- mutation testing lebih cepat,
- mutant lebih relevan,
- assertion lebih spesifik,
- test data lebih kecil.

Mutation testing bukan hanya test quality tool; ia juga design feedback tool.

---

## 28. Mutation Testing dan Legacy Code

Untuk legacy Java 8 enterprise app, strategi harus lebih hati-hati.

### 28.1 Masalah Umum Legacy

- JUnit 4 test lama.
- Banyak static/global state.
- Spring context berat.
- Database dependency sulit diisolasi.
- Test lambat.
- Test flaky.
- Assertion minim.
- Coverage rendah.
- Business rule tersebar.

### 28.2 Strategi Aman

```text
1. Pilih satu package critical.
2. Jalankan PIT observe-only.
3. Identifikasi surviving mutants yang terlihat seperti bug nyata.
4. Tambahkan characterization test untuk behavior saat ini.
5. Tambahkan missing boundary test.
6. Refactor kecil jika perlu untuk isolasi logic.
7. Ulangi PIT.
8. Baru pertimbangkan threshold.
```

### 28.3 Jangan Langsung Gate

Pada legacy code, mutation score rendah adalah informasi, bukan alasan langsung memblokir semua PR.

Gunakan pendekatan:

```text
No new worse behavior.
Improve touched area.
Protect critical fixed bug.
```

---

## 29. Java 8–25 Compatibility Notes

### 29.1 Java 8

- Banyak enterprise legacy masih memakai JUnit 4 atau awal JUnit 5.
- PIT dapat digunakan, tetapi versi tool/plugin harus kompatibel.
- Lambdas/streams dapat dimutasi, tetapi report kadang lebih sulit dibaca pada synthetic code.
- Hindari konfigurasi modern yang mensyaratkan Java 17+.

### 29.2 Java 11

- Baseline migration umum.
- JUnit 5 semakin nyaman.
- JaCoCo dan PIT setup biasanya stabil.
- Module system bisa memerlukan argumen tambahan jika reflective access dipakai.

### 29.3 Java 17

- Baseline modern enterprise.
- JUnit 6 mensyaratkan Java 17+.
- Record/sealed class testing mulai relevan.
- Mutation testing untuk record biasanya tidak perlu diarahkan ke generated accessor, tetapi logic di compact constructor atau factory layak diuji.

### 29.4 Java 21

- Virtual threads dapat mengubah testing async/concurrency, tetapi mutation testing tetap lebih cocok untuk deterministic logic.
- Jangan mutation-test code yang bergantung pada scheduling nondeterministic tanpa isolasi.
- Structured concurrency/scoped values jika dipakai perlu strategi test tersendiri.

### 29.5 Java 25

- Perlakukan sebagai modern runtime baseline.
- Pastikan PIT/JUnit/JaCoCo/plugin build tool sudah mendukung versi bytecode dan runtime yang dipakai.
- Untuk organisasi, biasanya perlu compatibility matrix:

```text
Java version | Test framework | Coverage | Mutation | Build tool | CI image
8            | JUnit 4/5       | JaCoCo   | PIT      | Maven/Gradle | legacy image
11           | JUnit 5         | JaCoCo   | PIT      | Maven/Gradle | standard image
17           | JUnit 5/6       | JaCoCo   | PIT      | Maven/Gradle | modern image
21           | JUnit 5/6       | JaCoCo   | PIT      | Maven/Gradle | modern image
25           | JUnit 6         | JaCoCo   | PIT      | Maven/Gradle | latest image
```

---

## 30. Quality Measurement Framework yang Lebih Dewasa

Jangan hanya pakai satu angka.

Gunakan beberapa dimensi.

### 30.1 Execution Coverage

Pertanyaan:

```text
Apakah test menjalankan area penting?
```

Metric:

- line coverage,
- branch coverage,
- changed-lines coverage,
- package-level coverage.

### 30.2 Assertion Strength

Pertanyaan:

```text
Apakah test akan gagal jika behavior salah?
```

Metric:

- mutation score,
- surviving mutants in critical code,
- no coverage mutants.

### 30.3 Risk Coverage

Pertanyaan:

```text
Apakah risiko penting punya test?
```

Metric/concept:

- workflow transition covered,
- authorization matrix covered,
- error path covered,
- idempotency covered,
- audit side effect covered,
- SLA boundary covered.

### 30.4 Regression Coverage

Pertanyaan:

```text
Apakah bug lama dilindungi agar tidak muncul lagi?
```

Metric/concept:

- test linked to bug/incident,
- mutation result for fixed bug area,
- changed behavior snapshot.

### 30.5 Operational Fitness

Pertanyaan:

```text
Apakah test suite bisa dijalankan secara reliable dan cepat?
```

Metric:

- duration,
- flakiness,
- parallel safety,
- failure diagnostics,
- CI stability.

### 30.6 Suggested Dashboard

```text
Module: case-workflow
Line coverage: 87%
Branch coverage: 79%
Mutation score: 82%
Critical surviving mutants: 0
No coverage mutants in changed code: 0
Flaky tests: 0
Median unit test duration: 3m 20s
Nightly mutation duration: 18m
```

Ini jauh lebih bermakna daripada:

```text
Coverage: 85%
```

---

## 31. Practical Workflow: Dari Surviving Mutant ke Test yang Lebih Baik

Langkah sistematis:

```text
1. Baca mutant.
2. Pahami perubahan behavior yang mungkin terjadi.
3. Tanya: apakah behavior berubah secara observable?
4. Tanya: apakah perubahan itu relevan secara bisnis/teknis?
5. Jika tidak relevan/equivalent, catat atau exclude.
6. Jika relevan, cari test yang seharusnya gagal.
7. Jika test ada tapi tidak gagal, perkuat assertion atau data.
8. Jika test belum ada, tambahkan test behavior-level.
9. Jalankan ulang PIT.
10. Pastikan test baru tidak overfit implementation detail.
```

Contoh:

```text
Survived mutant:
  changed conditional boundary score >= 70 to score > 70

Behavior impact:
  score exactly 70 would be rejected instead of approved

Relevant?
  yes, approval threshold business rule

Fix:
  add test for score exactly 70 and 69
```

Bukan fix:

```java
// bad: testing internal if statement indirectly in a weird way
assertThat(sourceCode).contains(">=");
```

Test harus mengunci behavior, bukan syntax.

---

## 32. Anti-Patterns

### 32.1 Mengejar 100% Mutation Score

Mutation score 100% sering tidak worth it.

Biaya:

- test aneh,
- overfitting,
- maintenance tinggi,
- false gate,
- equivalent mutant wasting time.

### 32.2 Mutation Testing Seluruh Codebase Tanpa Prioritas

Ini menghasilkan report besar dan tidak actionable.

Mulai dari critical package.

### 32.3 Menulis Test untuk Implementation Detail

Buruk:

```java
verify(policy).isEligible(any());
verify(calculator).calculate(any());
verify(repository).save(any());
```

Jika behavior akhir sudah cukup, jangan over-verify.

### 32.4 Mengabaikan Surviving Mutant Critical

Surviving mutant pada authorization, workflow, audit, dan calculation tidak boleh dianggap biasa.

### 32.5 Menyamakan Semua Mutant

Mutant di `toString` tidak sama risikonya dengan mutant di approval rule.

### 32.6 Threshold Sama untuk Semua Module

DTO module dan domain rule module tidak boleh punya standard yang sama.

### 32.7 Mutation Test di Test Flaky

Jika test flaky, mutation testing akan memperparah noise.

Stabilkan test dulu.

### 32.8 Tidak Menyimpan Report

Tanpa artifact report, tim tidak bisa review mutant dengan baik.

### 32.9 Tidak Menghubungkan ke Risk Register

Mutation testing paling kuat jika dikaitkan dengan risiko:

- unauthorized access,
- wrong approval,
- missed audit,
- duplicate processing,
- SLA breach,
- wrong fee.

---

## 33. Decision Matrix: Haruskah Kode Ini Diberi Mutation Testing?

Gunakan matrix berikut.

| Area Code | Mutation Testing? | Alasan |
|---|---:|---|
| Domain rule | Sangat ya | Banyak decision dan risiko bisnis |
| Authorization policy | Sangat ya | Security-critical |
| SLA calculation | Sangat ya | Boundary-sensitive |
| Fee/penalty calculation | Sangat ya | Numeric correctness |
| State transition | Sangat ya | Workflow correctness |
| Idempotency logic | Ya | Duplicate side effect mahal |
| Retry classifier | Ya | Failure behavior critical |
| Audit event creation | Ya | Compliance evidence |
| REST controller glue | Kadang | Jika ada semantic mapping/validation |
| Repository SQL | Kadang | Lebih cocok integration/contract test, mutation terbatas |
| DTO getter/setter | Tidak | Rendah nilai |
| Generated code | Tidak | Noise |
| Spring config | Biasanya tidak | Lebih cocok context smoke test |
| Logging-only code | Biasanya tidak | Kecuali compliance log resmi |

---

## 34. Team Policy Template

Contoh policy yang sehat:

```text
Mutation testing is required for critical domain and application decision logic.

Critical logic includes:
- authorization decisions,
- workflow transitions,
- approval/rejection rules,
- SLA and escalation rules,
- fee/penalty calculation,
- idempotency and duplicate suppression,
- audit/compliance evidence creation,
- retry and failure classification.

For new critical code:
- no surviving mutant on changed business boundary unless justified,
- no no-coverage mutant on changed decision logic,
- mutation score target is package-specific, not global.

For legacy code:
- mutation testing starts as observe-only,
- touched critical areas should improve or at least not degrade,
- equivalent/noise mutants may be documented.

Mutation score is a signal for engineering review, not a standalone quality judgment.
```

---

## 35. Mini Exercise

### Exercise 1: Boundary Mutation

Production code:

```java
public boolean isEscalated(Duration age) {
    return age.toHours() >= 48;
}
```

Write tests that kill:

- `>=` → `>` mutant,
- `>=` → `<` mutant,
- return true/false mutant.

Expected tests:

```text
47h 59m: not escalated
48h: escalated
49h: escalated
```

### Exercise 2: Audit Mutation

Production code:

```java
public void closeCase(CaseId id, User actor) {
    CaseFile caseFile = repository.get(id);
    caseFile.close(actor.id());
    repository.save(caseFile);
    audit.record(id, "CASE_CLOSED", actor.id());
}
```

Write test that fails if `audit.record` is removed.

### Exercise 3: Idempotency Mutation

Production code:

```java
if (store.exists(command.key())) {
    return store.get(command.key());
}
```

Write tests that fail if condition is negated.

### Exercise 4: Equivalent Mutant Analysis

Given:

```java
return list.size() == 0;
```

Mutant:

```java
return list.isEmpty();
```

Decide whether you should add a test or mark as equivalent/noise.

---

## 36. Checklist Review Mutation Testing

Gunakan checklist ini saat membaca report PIT:

```text
[ ] Apakah targetClasses terlalu luas?
[ ] Apakah generated/trivial code sudah dikecualikan?
[ ] Apakah surviving mutant berada di area critical?
[ ] Apakah surviving mutant menunjukkan missing boundary test?
[ ] Apakah surviving mutant menunjukkan assertion terlalu lemah?
[ ] Apakah surviving mutant menunjukkan side effect penting tidak diuji?
[ ] Apakah no-coverage mutant berada di code baru?
[ ] Apakah equivalent mutant sudah diidentifikasi?
[ ] Apakah test baru mengunci behavior, bukan implementation detail?
[ ] Apakah mutation test cukup cepat untuk CI cadence yang dipilih?
[ ] Apakah threshold package-specific?
[ ] Apakah report disimpan sebagai CI artifact?
```

---

## 37. Top 1% Engineer Notes

Engineer yang matang tidak berkata:

```text
Coverage kita 90%, aman.
```

Engineer yang matang berkata:

```text
Coverage kita 90%, tetapi mutation testing menunjukkan surviving mutant di boundary SLA.
Itu berarti test kita belum membuktikan behavior pada threshold 48 jam.
Saya akan tambahkan boundary test untuk 47:59, 48:00, dan 48:01, lalu jalankan ulang PIT.
```

Atau:

```text
Mutation score module DTO rendah, tetapi itu noise karena targetClasses terlalu luas.
Kita harus exclude generated DTO dan fokus ke policy package.
```

Atau:

```text
Surviving mutant pada auditTrail.record adalah critical karena audit adalah compliance evidence.
Test approval harus memverifikasi audit event, bukan hanya status akhir.
```

Kemampuan membaca sinyal seperti ini yang membedakan engineer biasa dengan engineer yang mampu menjaga sistem critical.

---

## 38. Ringkasan

Mutation testing adalah cara untuk menguji kualitas test suite dengan menyuntikkan perubahan kecil pada program dan melihat apakah test gagal.

Coverage tradisional tetap berguna, tetapi terbatas:

```text
Coverage tells you what was executed.
Mutation testing tells you whether tests noticed wrong behavior.
```

Mutation testing paling bernilai untuk:

- domain rule,
- state machine,
- authorization,
- validation,
- audit/compliance,
- SLA/escalation,
- idempotency,
- retry classification,
- financial/numeric calculation.

Namun mutation testing harus dipakai secara selektif. Jangan mengejar 100% score secara buta. Equivalent mutant, generated code, dan low-risk glue code bisa menghasilkan noise.

Praktik sehat:

```text
Use JaCoCo to find execution blind spots.
Use PIT to evaluate assertion strength.
Use risk-based strategy to decide where mutation testing matters.
Use surviving mutants as review signals.
Use thresholds carefully and package-specifically.
```

---

## 39. Referensi

- PIT Mutation Testing official site: https://pitest.org/
- PIT Maven Quickstart: https://pitest.org/quickstart/maven/
- PIT Quickstart: https://pitest.org/quickstart/
- PIT FAQ: https://pitest.org/faq/
- PIT GitHub repository: https://github.com/hcoles/pitest
- PIT JUnit 5 Plugin: https://github.com/pitest/pitest-junit5-plugin
- Gradle PIT Plugin: https://gradle-pitest-plugin.solidsoft.info/
- JaCoCo Documentation: https://www.jacoco.org/jacoco/trunk/doc/
- JaCoCo Project: https://www.eclemma.org/jacoco/
- JUnit User Guide: https://docs.junit.org/
- “Assessing and Improving the Mutation Testing Practice of PIT” — Laurent et al., 2016.
- “Mutation Coverage In JUnit” — OpenDSA.

---

## 40. Status Seri

Part ini adalah:

```text
Part 013 dari 031
```

Seri belum selesai.

Part berikutnya:

```text
Part 014 — Concurrency Testing: Race, Visibility, Atomicity, Deadlock, dan jcstress
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-testing-benchmarking-performance-jvm-part-012.md">⬅️ Based Testing dan Generative Testing untuk Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-testing-benchmarking-performance-jvm-part-014.md">Concurrency Testing: Race, Visibility, Atomicity, Deadlock, dan jcstress ➡️</a>
</div>
