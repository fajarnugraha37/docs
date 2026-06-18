# learn-java-testing-benchmarking-performance-jvm-part-012

# Property-Based Testing dan Generative Testing untuk Java

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `012`  
> Topik: Property-Based Testing, Generative Testing, Invariant, Generator, Shrinking, Seed, Metamorphic Testing  
> Target Java: Java 8 sampai Java 25  
> Level: Advanced / top-tier engineering mental model

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya kita sudah membangun fondasi test engineering dari sisi:

1. taxonomy test,
2. JUnit evolution,
3. test design,
4. assertion engineering,
5. test data engineering,
6. mocking/test double,
7. domain workflow/state machine testing,
8. error handling/retry/idempotency,
9. persistence testing,
10. HTTP API testing,
11. messaging/scheduler/async testing.

Part ini memperkenalkan cara berpikir yang berbeda: **bukan lagi menulis satu contoh input-output**, tetapi mendefinisikan **sifat yang harus selalu benar** untuk banyak variasi input.

Example-based test bertanya:

```text
Jika input A, apakah output B?
```

Property-based test bertanya:

```text
Untuk semua input yang valid menurut domain, invariant apa yang harus selalu benar?
```

Ini perubahan mental model yang besar. Banyak engineer bisa menulis unit test, tetapi tidak semua engineer bisa merumuskan **property** yang kuat. Engineer senior/top-tier biasanya tidak hanya bertanya “case apa yang perlu dites?”, tetapi juga:

```text
Apa hukum domain yang tidak boleh dilanggar oleh semua kemungkinan input?
```

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. memahami perbedaan example-based testing dan property-based testing;
2. merumuskan property/invariant yang benar dan bernilai;
3. membedakan input generator, precondition, constraint, dan oracle;
4. menggunakan jqwik sebagai property-based testing engine modern di JVM;
5. memahami QuickTheories sebagai alternatif historis untuk Java 8;
6. mendesain generator untuk value object, command, event, workflow transition, dan API payload;
7. memahami shrinking dan mengapa shrinking penting untuk debugging;
8. membuat property test yang reproducible dengan seed;
9. mengenali property test yang lemah, tautological, flaky, atau terlalu mahal;
10. memakai property-based testing untuk domain enterprise seperti validation, idempotency, state machine, serialization, money calculation, sorting, deduplication, authorization, dan API compatibility;
11. memahami kapan property-based testing sebaiknya tidak dipakai;
12. mengintegrasikan property-based testing ke CI tanpa membuat pipeline lambat dan tidak stabil.

---

## 2. Core Mental Model

### 2.1 Example-Based Test

Example-based test menggunakan contoh konkret.

```java
@Test
void shouldCalculateTenPercentTax() {
    Money subtotal = Money.of("100.00", "SGD");

    Money tax = TaxCalculator.gst(Percent.of("10"), subtotal);

    assertThat(tax).isEqualTo(Money.of("10.00", "SGD"));
}
```

Test ini bagus karena jelas. Tetapi ia hanya membuktikan satu titik di ruang input:

```text
subtotal = 100.00
rate = 10%
```

Ia tidak membuktikan:

- subtotal 0,
- subtotal negatif,
- decimal scale berbeda,
- rate 0%,
- rate 100%,
- pembulatan,
- currency mismatch,
- overflow,
- precision loss,
- invariant money tidak rusak.

### 2.2 Property-Based Test

Property-based test mendefinisikan hukum umum.

Contoh property:

```text
Untuk semua amount >= 0 dan taxRate >= 0,
tax tidak boleh negatif.
```

Atau:

```text
Untuk semua list input,
hasil sort harus memiliki elemen yang sama dan urut ascending.
```

Atau:

```text
Untuk semua command valid,
menjalankan command dengan idempotency key yang sama dua kali
tidak boleh menghasilkan side effect dua kali.
```

Property-based testing biasanya terdiri dari empat bagian:

```text
Property = Generator + Precondition/Constraint + Operation + Oracle/Invariant
```

Contoh:

```text
Generator: generate amount, currency, tax rate
Constraint: amount >= 0, rate between 0 and 100
Operation: calculate tax
Oracle: result >= 0, currency same, scale valid, no precision loss
```

---

## 3. Mengapa Property-Based Testing Penting untuk Engineer Advanced

Property-based testing sangat berguna ketika sistem punya:

1. banyak kombinasi input,
2. aturan domain yang bersifat invariant,
3. boundary values yang mudah terlewat,
4. transformasi data,
5. serialization/deserialization,
6. parser/formatter,
7. state machine,
8. command/event flow,
9. idempotency,
10. retry/deduplication,
11. authorization matrix,
12. temporal rules,
13. algorithmic logic.

Example-based test sering gagal karena manusia cenderung memilih contoh yang “masuk akal”. Bug sering muncul pada input yang:

- kosong,
- sangat besar,
- duplikat,
- null/absent,
- whitespace,
- unicode,
- decimal ekstrem,
- tanggal batas bulan/tahun/leap year,
- state edge-case,
- event duplicate,
- command out-of-order,
- data dengan kombinasi field aneh tetapi valid.

Property-based testing membantu mengeksplorasi ruang input itu secara sistematis.

---

## 4. Bukan Pengganti Unit Test Biasa

Property-based testing bukan pengganti example-based testing.

Mental model yang benar:

```text
Example-based test:
  menjelaskan behavior spesifik yang penting dan mudah dibaca manusia.

Property-based test:
  mencari pelanggaran hukum umum di banyak variasi input.
```

Keduanya saling melengkapi.

### 4.1 Contoh Kombinasi yang Baik

Example-based test:

```java
@Test
void shouldRejectSubmissionWhenApplicantIsSuspended() {
    CaseApplication app = applicationBuilder()
            .withApplicantStatus(ApplicantStatus.SUSPENDED)
            .withStatus(CaseStatus.DRAFT)
            .build();

    assertThatThrownBy(() -> service.submit(app))
            .isInstanceOf(BusinessRuleViolation.class)
            .hasMessageContaining("suspended");
}
```

Property-based test:

```text
Untuk semua application dalam status DRAFT,
jika applicant status termasuk forbidden statuses,
submit harus ditolak dan tidak boleh membuat audit SUBMITTED.
```

Example-based test menjelaskan rule. Property-based test mengeksplorasi variasi rule.

---

## 5. Tooling di Java: jqwik dan QuickTheories

### 5.1 jqwik

`jqwik` adalah property-based testing library untuk JVM yang berjalan sebagai test engine di JUnit Platform. Artinya jqwik bisa hidup berdampingan dengan JUnit Jupiter dan Vintage di build yang sama.

Karakteristik penting jqwik:

- berorientasi Java/Kotlin di JVM;
- berbasis JUnit Platform;
- memakai `@Property` untuk property test;
- memakai `@ForAll` untuk generated values;
- menyediakan built-in arbitrary/generator;
- mendukung custom generator dengan `Arbitrary`;
- mendukung shrinking;
- mendukung seed reproducibility;
- cocok untuk codebase modern Java 8+ dengan JUnit Platform.

Catatan versi: dokumentasi jqwik saat ini menunjukkan user guide versi 1.9.3 sebagai current user guide di hasil pencarian. Situs jqwik juga menyatakan bahwa mulai versi 1.10 terdapat klausul Anti-AI Usage Clause. Untuk project enterprise, selalu cek license policy internal sebelum memilih versi.

### 5.2 QuickTheories

`QuickTheories` adalah property-based testing library untuk Java 8. Ia historis penting karena eksplisit mendukung Java 8 dan memperkenalkan banyak engineer Java ke konsep property-based testing.

Namun perlu dicatat:

- rilis terakhir QuickTheories di Maven Repository tercatat 2019;
- untuk project modern, jqwik biasanya lebih aktif dan lebih natural dengan JUnit Platform;
- untuk codebase legacy Java 8 yang tidak ingin mengadopsi JUnit Platform secara penuh, QuickTheories tetap dapat dipertimbangkan setelah evaluasi maintenance risk.

### 5.3 Rekomendasi Praktis

```text
Java 8 legacy, JUnit 4-heavy:
  - pertimbangkan QuickTheories jika adopsi JUnit Platform sulit
  - atau pakai JUnit Platform + jqwik jika build bisa dimodernisasi

Java 8/11 dengan JUnit 5 Platform:
  - jqwik adalah pilihan utama

Java 17/21/25 modern:
  - jqwik + JUnit Platform
  - property tests dipisahkan dari unit tests biasa jika runtime mahal
```

---

## 6. Setup jqwik

### 6.1 Maven

Contoh setup umum:

```xml
<dependencies>
    <dependency>
        <groupId>net.jqwik</groupId>
        <artifactId>jqwik</artifactId>
        <version>1.9.3</version>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Jika memakai JUnit Jupiter juga:

```xml
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>${junit.version}</version>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>net.jqwik</groupId>
        <artifactId>jqwik</artifactId>
        <version>${jqwik.version}</version>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Surefire perlu mendukung JUnit Platform.

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-surefire-plugin</artifactId>
            <version>${surefire.version}</version>
        </plugin>
    </plugins>
</build>
```

### 6.2 Gradle

```groovy
dependencies {
    testImplementation "org.junit.jupiter:junit-jupiter:${junitVersion}"
    testImplementation "net.jqwik:jqwik:${jqwikVersion}"
}

test {
    useJUnitPlatform()
}
```

### 6.3 Package Strategy

Saran struktur:

```text
src/test/java
  com.example.caseapp.domain
    CaseSubmissionTest.java
    CaseSubmissionProperties.java

  com.example.caseapp.money
    MoneyTest.java
    MoneyProperties.java

  com.example.caseapp.serialization
    CasePayloadSerializationProperties.java
```

Konvensi nama:

```text
XxxTest.java          -> example-based tests
XxxProperties.java    -> property-based tests
```

Ini membantu reviewer membedakan intensi test.

---

## 7. Property Test Pertama dengan jqwik

### 7.1 Contoh: Reverse String

```java
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;

import static org.assertj.core.api.Assertions.assertThat;

class StringReverseProperties {

    @Property
    void reversingTwiceReturnsOriginal(@ForAll String value) {
        String reversedTwice = reverse(reverse(value));

        assertThat(reversedTwice).isEqualTo(value);
    }

    private String reverse(String value) {
        return new StringBuilder(value).reverse().toString();
    }
}
```

Property:

```text
reverse(reverse(x)) == x
```

Ini property yang bagus karena:

- berlaku untuk banyak input;
- mudah dipahami;
- tidak terlalu bergantung pada implementasi;
- menemukan edge-case seperti empty string, unicode, whitespace.

Namun ada catatan: Java `StringBuilder.reverse()` punya behavior tertentu terhadap surrogate pairs. Untuk Unicode-heavy systems, property harus didefinisikan dengan hati-hati.

---

## 8. Anatomy of a Property

Sebuah property biasanya punya bentuk:

```java
@Property
void propertyName(@ForAll Input input) {
    // arrange: maybe normalize input / build domain object
    // act: execute behavior
    // assert: invariant
}
```

Tetapi mental model yang lebih lengkap:

```text
1. Define input space
2. Constrain input space
3. Execute operation
4. Assert invariant
5. Ensure failure is reproducible
6. Ensure failure is diagnosable
```

### 8.1 Input Space

Input space adalah semua kemungkinan input yang ingin dieksplorasi.

Contoh buruk:

```text
generate any String untuk email address
```

Ini buruk jika domain membutuhkan valid email. Generator akan menghasilkan terlalu banyak input tidak relevan.

Contoh lebih baik:

```text
generate valid email local-part + domain + tld
```

Atau jika ingin menguji validator:

```text
generate valid email dan invalid email secara terpisah
```

### 8.2 Constraint

Constraint membatasi input yang sah.

Contoh:

```java
@Property
void discountNeverExceedsSubtotal(
        @ForAll @BigRange(min = "0", max = "1000000") BigInteger cents,
        @ForAll @IntRange(min = 0, max = 100) int percent
) {
    Money subtotal = Money.ofCents(cents, "SGD");

    Money discount = Discount.percent(percent).applyTo(subtotal);

    assertThat(discount).isLessThanOrEqualTo(subtotal);
}
```

Constraint harus merepresentasikan domain, bukan sekadar membuat test pass.

### 8.3 Operation

Operation adalah behavior yang diuji.

Contoh:

```text
apply discount
serialize-deserialize
sort
submit command
merge event
validate payload
```

### 8.4 Oracle / Invariant

Oracle menjawab “bagaimana kita tahu hasilnya benar?”

Property test gagal jika oracle buruk.

Contoh oracle buruk:

```java
assertThat(result).isNotNull();
```

Ini terlalu lemah.

Contoh oracle lebih baik:

```java
assertThat(result.currency()).isEqualTo(input.currency());
assertThat(result).isGreaterThanOrEqualTo(Money.zero(input.currency()));
assertThat(result).isLessThanOrEqualTo(input);
```

---

## 9. Jenis-Jenis Property yang Berguna

### 9.1 Round-Trip Property

Bentuk:

```text
decode(encode(x)) == x
```

Cocok untuk:

- JSON serialization,
- binary serialization,
- DTO mapping,
- parser/printer,
- encryption/decryption test dengan caveat,
- compression/decompression,
- URL encoding/decoding,
- database persistence round-trip.

Contoh:

```java
@Property
void jsonRoundTripPreservesCasePayload(@ForAll("validCasePayloads") CasePayload payload)
        throws Exception {

    String json = objectMapper.writeValueAsString(payload);
    CasePayload restored = objectMapper.readValue(json, CasePayload.class);

    assertThat(restored).usingRecursiveComparison().isEqualTo(payload);
}
```

Kelemahan round-trip property: jika encoder dan decoder sama-sama salah secara simetris, test bisa tetap pass.

Contoh:

```text
format salah -> parse format salah -> kembali ke object yang sama
```

Karena itu round-trip test perlu dilengkapi dengan:

- example-based golden cases,
- compatibility test terhadap schema,
- contract test,
- negative cases.

### 9.2 Invariant Property

Bentuk:

```text
Setelah operation, kondisi tertentu harus selalu benar.
```

Contoh:

```text
Setelah submit case:
- status bukan DRAFT
- submittedAt terisi
- submittedBy terisi
- audit SUBMITTED muncul tepat satu kali
```

### 9.3 Idempotency Property

Bentuk:

```text
f(f(x)) == f(x)
```

Atau untuk command:

```text
execute(command, key)
execute(command, sameKey)
=> state sama, side effect tidak duplikat
```

Contoh:

```java
@Property
void duplicateCommandWithSameIdempotencyKeyDoesNotDuplicateSideEffects(
        @ForAll("validSubmitCommands") SubmitCaseCommand command
) {
    FakeAuditSink auditSink = new FakeAuditSink();
    FakeEventBus eventBus = new FakeEventBus();
    IdempotencyStore store = new InMemoryIdempotencyStore();

    CaseApplication app = draftCase(command.caseId());
    CaseSubmissionService service = serviceWith(app, store, auditSink, eventBus);

    service.submit(command);
    service.submit(command);

    assertThat(auditSink.eventsOfType("CASE_SUBMITTED")).hasSize(1);
    assertThat(eventBus.eventsOfType(CaseSubmitted.class)).hasSize(1);
    assertThat(app.status()).isEqualTo(CaseStatus.SUBMITTED);
}
```

### 9.4 Commutativity Property

Bentuk:

```text
f(a, b) == f(b, a)
```

Cocok untuk:

- set union,
- addition,
- role aggregation,
- permission union,
- unordered merge.

Tidak cocok untuk operation yang memang order-sensitive.

### 9.5 Associativity Property

Bentuk:

```text
f(f(a, b), c) == f(a, f(b, c))
```

Cocok untuk:

- aggregation,
- reduction,
- merging partial result,
- distributed computation.

### 9.6 Monotonicity Property

Bentuk:

```text
Jika input naik, output tidak boleh turun.
```

Contoh:

```text
Semakin tinggi severity violation,
escalation priority tidak boleh lebih rendah.
```

Atau:

```text
Jika due date semakin dekat,
risk score tidak boleh turun.
```

### 9.7 Conservation Property

Bentuk:

```text
Jumlah/elemen sebelum dan sesudah transformasi tetap sama.
```

Contoh sort:

```text
sort(list) harus:
- sorted ascending
- memiliki multiset elemen yang sama
```

### 9.8 Metamorphic Property

Metamorphic testing berguna ketika expected output sulit diketahui, tetapi relasi antar input-output diketahui.

Contoh:

```text
Jika semua amount dikalikan 2,
total juga harus dikalikan 2.
```

Atau:

```text
Jika urutan input event yang commutative diacak,
hasil aggregate harus sama.
```

Atau:

```text
Jika filter ditambah constraint yang lebih ketat,
jumlah result tidak boleh bertambah.
```

Metamorphic testing sangat berguna untuk:

- search/filter,
- ranking,
- risk scoring,
- aggregation,
- report generation,
- recommendation,
- data transformation.

### 9.9 Differential Property

Bentuk:

```text
implementationA(x) == implementationB(x)
```

Cocok untuk:

- refactoring,
- migration,
- optimized implementation vs simple reference implementation,
- old engine vs new engine,
- SQL query rewrite,
- parser rewrite.

Contoh:

```java
@Property
void optimizedEligibilityMatchesReferenceImplementation(
        @ForAll("validApplications") Application app
) {
    EligibilityResult expected = referenceEligibilityEngine.evaluate(app);
    EligibilityResult actual = optimizedEligibilityEngine.evaluate(app);

    assertThat(actual).usingRecursiveComparison().isEqualTo(expected);
}
```

Ini sangat powerful untuk performance engineering: sebelum mengoptimalkan code, buat reference implementation yang benar, lalu test optimized implementation terhadapnya.

---

## 10. Generator dan Arbitrary

Generator adalah jantung property-based testing.

Property yang bagus dengan generator buruk akan menghasilkan test buruk.

### 10.1 Built-In Generators

jqwik menyediakan banyak generator bawaan untuk:

- integer,
- long,
- BigInteger,
- BigDecimal,
- boolean,
- char,
- String,
- enum,
- list,
- set,
- optional,
- map,
- date/time,
- arbitrary composition.

Contoh:

```java
@Property
void absoluteValueIsNeverNegative(@ForAll int value) {
    int abs = Math.abs(value);

    assertThat(abs).isGreaterThanOrEqualTo(0);
}
```

Test ini akan menemukan edge-case `Integer.MIN_VALUE` karena:

```java
Math.abs(Integer.MIN_VALUE) == Integer.MIN_VALUE
```

Ini contoh klasik mengapa generated edge cases penting.

### 10.2 Named Arbitrary Provider

```java
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.ForAll;
import net.jqwik.api.Provide;
import net.jqwik.api.Property;

class MoneyProperties {

    @Provide
    Arbitrary<Money> nonNegativeMoney() {
        Arbitrary<BigDecimal> amounts = Arbitraries.bigDecimals()
                .between(BigDecimal.ZERO, new BigDecimal("1000000.00"))
                .ofScale(2);

        Arbitrary<String> currencies = Arbitraries.of("SGD", "USD", "IDR");

        return Combinators.combine(amounts, currencies)
                .as(Money::of);
    }

    @Property
    void moneyIsNeverNegative(@ForAll("nonNegativeMoney") Money money) {
        assertThat(money.amount()).isGreaterThanOrEqualTo(BigDecimal.ZERO);
    }
}
```

Catatan: import `Combinators` dibutuhkan.

```java
import net.jqwik.api.Combinators;
```

### 10.3 Domain Generator

Generator untuk domain object harus punya tiga prinsip:

```text
1. Valid by default
2. Boundary-aware
3. Semantically meaningful
```

Contoh domain:

```java
record SubmitCaseCommand(
        String caseId,
        String applicantId,
        String submittedBy,
        String idempotencyKey,
        LocalDate submissionDate
) {}
```

Generator:

```java
@Provide
Arbitrary<SubmitCaseCommand> validSubmitCommands() {
    Arbitrary<String> caseIds = Arbitraries.strings()
            .withCharRange('A', 'Z')
            .ofMinLength(8)
            .ofMaxLength(12);

    Arbitrary<String> applicantIds = Arbitraries.strings()
            .numeric()
            .ofLength(9);

    Arbitrary<String> users = Arbitraries.of("officer-a", "officer-b", "supervisor-c");

    Arbitrary<String> idempotencyKeys = Arbitraries.strings()
            .alpha()
            .numeric()
            .ofMinLength(16)
            .ofMaxLength(36);

    Arbitrary<LocalDate> dates = Arbitraries.dates()
            .between(LocalDate.of(2020, 1, 1), LocalDate.of(2030, 12, 31));

    return Combinators.combine(caseIds, applicantIds, users, idempotencyKeys, dates)
            .as(SubmitCaseCommand::new);
}
```

### 10.4 Valid vs Invalid Generator

Jangan campur valid dan invalid input sembarangan.

Buruk:

```text
generate random String untuk semua email tests
```

Lebih baik:

```text
validEmails()
invalidEmails()
boundaryEmails()
```

Contoh:

```java
@Provide
Arbitrary<String> validPostalCodes() {
    return Arbitraries.strings()
            .numeric()
            .ofLength(6)
            .filter(code -> !code.equals("000000"));
}

@Provide
Arbitrary<String> invalidPostalCodes() {
    Arbitrary<String> tooShort = Arbitraries.strings().numeric().ofMinLength(0).ofMaxLength(5);
    Arbitrary<String> tooLong = Arbitraries.strings().numeric().ofMinLength(7).ofMaxLength(12);
    Arbitrary<String> nonNumeric = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(10);

    return Arbitraries.oneOf(tooShort, tooLong, nonNumeric);
}
```

---

## 11. Shrinking

Shrinking adalah proses mengecilkan failing input menjadi contoh terkecil/sederhana yang masih gagal.

Misalnya property gagal pada list:

```text
[982, -32, 0, 15, 15, 1000000]
```

Shrinking mencoba menemukan input lebih kecil:

```text
[-1]
```

atau:

```text
[0, 0]
```

Ini penting karena property-based testing bisa menghasilkan input kompleks. Tanpa shrinking, failure sulit dibaca.

### 11.1 Contoh Manfaat Shrinking

Bug:

```java
static int positiveAbs(int value) {
    return Math.abs(value);
}
```

Property:

```java
@Property
void absIsNonNegative(@ForAll int value) {
    assertThat(Math.abs(value)).isGreaterThanOrEqualTo(0);
}
```

Failing input kemungkinan shrink ke:

```text
-2147483648
```

Karena ini minimal secara domain untuk bug overflow `Integer.MIN_VALUE`.

### 11.2 Generator yang Menghambat Shrinking

Filter berlebihan bisa menghambat shrinking.

Contoh kurang baik:

```java
Arbitraries.strings()
    .filter(s -> isValidComplexBusinessPayload(s));
```

Masalah:

- banyak generated value dibuang;
- shrinking sulit karena hasil shrink sering tidak lolos filter;
- test menjadi lambat;
- distribusi input tidak jelas.

Lebih baik membangun generator konstruktif:

```text
Bangun valid payload dari komponen valid,
bukan generate random lalu filter.
```

---

## 12. Seed dan Reproducibility

Property-based testing memakai pseudo-random generation. Ketika gagal, framework biasanya melaporkan seed agar failure bisa direproduksi.

Mental model:

```text
Randomness boleh dipakai untuk eksplorasi,
tetapi failure harus deterministic dan reproducible.
```

Prinsip:

1. selalu simpan seed dari failing test;
2. jangan mengandalkan `new Random()` bebas di dalam property;
3. jangan memakai clock nyata tanpa kontrol;
4. jangan memanggil external service nyata;
5. jangan membuat property test bergantung urutan test;
6. failure harus bisa di-run ulang di laptop developer.

Contoh anti-pattern:

```java
@Property
void badProperty(@ForAll String value) {
    String suffix = UUID.randomUUID().toString();
    assertThat(service.normalize(value + suffix)).isNotNull();
}
```

Property ini punya randomness tambahan di luar framework. Jika gagal, seed framework belum tentu cukup untuk reproduce.

Lebih baik:

```java
@Property
void normalizedValueIsNeverNull(
        @ForAll String value,
        @ForAll UUID suffix
) {
    assertThat(service.normalize(value + suffix)).isNotNull();
}
```

---

## 13. Precondition vs Generator Constraint

Ada dua cara membatasi input:

1. generator hanya menghasilkan input valid;
2. property memakai assumption/precondition.

### 13.1 Generator Constraint

```java
@Provide
Arbitrary<Integer> positiveNumbers() {
    return Arbitraries.integers().between(1, 1_000_000);
}
```

Ini biasanya lebih baik.

### 13.2 Assumption / Precondition

```java
@Property
void divisionProperty(@ForAll int a, @ForAll int b) {
    Assume.that(b != 0);

    int result = a / b;

    assertThat(result * b).isLessThanOrEqualTo(a);
}
```

Precondition berguna, tetapi jika terlalu banyak input dibuang, test tidak efisien.

Rule:

```text
Jika constraint adalah bagian natural dari domain, encode di generator.
Jika constraint adalah kondisi khusus property, assumption masih masuk akal.
```

---

## 14. Contoh Property untuk Java Enterprise

### 14.1 Sorting

```java
@Property
void sortedListIsOrderedAndPreservesElements(@ForAll List<Integer> values) {
    List<Integer> sorted = values.stream()
            .sorted()
            .toList();

    assertThat(sorted).isSorted();
    assertThat(sorted).containsExactlyInAnyOrderElementsOf(values);
}
```

Untuk Java 8 compatibility, `toList()` diganti:

```java
.collect(Collectors.toList())
```

### 14.2 Deduplication

Property:

```text
Dedup result:
- tidak punya duplicate key
- semua element berasal dari input
- menjalankan dedup dua kali menghasilkan result sama
```

```java
@Property
void deduplicationIsIdempotent(@ForAll("caseEvents") List<CaseEvent> events) {
    List<CaseEvent> once = deduplicator.deduplicate(events);
    List<CaseEvent> twice = deduplicator.deduplicate(once);

    assertThat(twice).containsExactlyElementsOf(once);
    assertThat(keysOf(once)).doesNotHaveDuplicates();
    assertThat(events).containsAll(once);
}
```

### 14.3 Serialization Round-Trip

```java
@Property
void dtoJsonRoundTripPreservesMeaning(@ForAll("validDtos") CaseDto dto) throws Exception {
    String json = objectMapper.writeValueAsString(dto);
    CaseDto restored = objectMapper.readValue(json, CaseDto.class);

    assertThat(restored).usingRecursiveComparison().isEqualTo(dto);
}
```

Extra checks:

```java
assertThat(json).doesNotContain("password");
assertThat(json).doesNotContain("internalRemark");
```

### 14.4 Mapper Consistency

```java
@Property
void entityDtoEntityRoundTripPreservesDomainFields(@ForAll("validCases") CaseApplication app) {
    CaseDto dto = mapper.toDto(app);
    CaseApplication restored = mapper.toEntity(dto);

    assertThat(restored.caseId()).isEqualTo(app.caseId());
    assertThat(restored.status()).isEqualTo(app.status());
    assertThat(restored.applicantId()).isEqualTo(app.applicantId());
}
```

Jangan selalu pakai recursive comparison jika entity punya technical fields:

- version,
- lazy proxy,
- audit columns,
- generated ID,
- createdAt,
- updatedAt.

### 14.5 Money Calculation

```java
@Property
void discountNeverExceedsSubtotal(@ForAll("nonNegativeMoney") Money subtotal,
                                   @ForAll @IntRange(min = 0, max = 100) int percent) {
    Money discount = Discount.percent(percent).applyTo(subtotal);

    assertThat(discount.currency()).isEqualTo(subtotal.currency());
    assertThat(discount).isGreaterThanOrEqualTo(Money.zero(subtotal.currency()));
    assertThat(discount).isLessThanOrEqualTo(subtotal);
}
```

### 14.6 Validation

Valid payload property:

```java
@Property
void validPayloadsPassValidation(@ForAll("validApplicationPayloads") ApplicationPayload payload) {
    Set<ConstraintViolation<ApplicationPayload>> violations = validator.validate(payload);

    assertThat(violations).isEmpty();
}
```

Invalid payload property:

```java
@Property
void invalidPostalCodesFailValidation(@ForAll("invalidPostalCodes") String postalCode) {
    ApplicationPayload payload = validPayloadBuilder()
            .postalCode(postalCode)
            .build();

    Set<ConstraintViolation<ApplicationPayload>> violations = validator.validate(payload);

    assertThat(violations)
            .extracting(v -> v.getPropertyPath().toString())
            .contains("postalCode");
}
```

### 14.7 Authorization Matrix

Property:

```text
Untuk semua user role dan action,
actual authorization harus match policy table.
```

```java
@Property
void authorizationMatchesPolicy(@ForAll("roleActionPairs") RoleAction pair) {
    boolean expected = policyTable.isAllowed(pair.role(), pair.action());
    boolean actual = authorizationService.isAllowed(pair.role(), pair.action());

    assertThat(actual).isEqualTo(expected);
}
```

Ini powerful jika policy table menjadi oracle eksplisit.

### 14.8 State Transition

```java
@Property
void invalidTransitionsNeverChangeState(@ForAll("invalidTransitions") TransitionAttempt attempt) {
    CaseApplication app = caseWithStatus(attempt.from());

    assertThatThrownBy(() -> workflow.transition(app, attempt.action()))
            .isInstanceOf(InvalidTransitionException.class);

    assertThat(app.status()).isEqualTo(attempt.from());
}
```

### 14.9 Idempotent Command

```java
@Property
void commandWithSameIdempotencyKeyIsAppliedAtMostOnce(
        @ForAll("validSubmitCommands") SubmitCaseCommand command
) {
    TestSystem system = TestSystem.fresh();

    CommandResult first = system.submit(command);
    CommandResult second = system.submit(command);

    assertThat(second.caseId()).isEqualTo(first.caseId());
    assertThat(system.auditEvents("CASE_SUBMITTED")).hasSize(1);
    assertThat(system.domainEvents(CaseSubmitted.class)).hasSize(1);
}
```

### 14.10 Event Handler Idempotency

```java
@Property
void duplicateEventsDoNotDuplicateProjection(@ForAll("caseSubmittedEvents") CaseSubmitted event) {
    ProjectionStore projection = new InMemoryProjectionStore();
    CaseSubmittedHandler handler = new CaseSubmittedHandler(projection);

    handler.handle(event);
    handler.handle(event);

    assertThat(projection.findByCaseId(event.caseId())).isPresent();
    assertThat(projection.countByCaseId(event.caseId())).isEqualTo(1);
}
```

---

## 15. Stateful Property-Based Testing

Banyak domain enterprise bukan function murni. Ia punya state.

Contoh:

```text
CaseApplication:
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Stateful property-based testing menghasilkan sequence command dan memeriksa invariant setelah setiap command.

### 15.1 Mental Model

```text
Generate command sequence:
  [create, submit, assign, requestInfo, respondInfo, approve]

Apply to model/reference state.
Apply to real system under test.
Compare invariant.
```

### 15.2 Invariant State Machine

Untuk semua sequence command:

```text
- terminal state tidak boleh berubah kecuali explicit reopen allowed
- approved case harus punya approvedBy dan approvedAt
- rejected case harus punya rejectionReason
- submitted case harus punya submittedBy dan submittedAt
- audit event count harus sesuai command sukses
- invalid command tidak boleh mengubah state
```

### 15.3 Simple Stateful Test Pattern

```java
@Property
void workflowInvariantsHoldForCommandSequences(
        @ForAll("workflowCommandSequences") List<WorkflowCommand> commands
) {
    CaseApplication app = CaseApplication.draft("CASE-001");
    FakeAuditSink audit = new FakeAuditSink();
    WorkflowService workflow = new WorkflowService(audit);

    for (WorkflowCommand command : commands) {
        try {
            workflow.apply(app, command);
        } catch (BusinessRuleViolation ignored) {
            // invalid command may be expected
        }

        assertWorkflowInvariants(app, audit);
    }
}
```

### 15.4 Risk

Stateful property tests bisa menjadi:

- lambat,
- sulit di-debug,
- terlalu luas,
- menghasilkan sequence tidak bermakna,
- terlalu banyak invalid command.

Cara mengontrol:

1. mulai dari sequence pendek;
2. pisahkan valid command sequence dan invalid command sequence;
3. gunakan reference model sederhana;
4. log failing sequence;
5. simpan seed;
6. buat custom shrinking bila perlu;
7. jangan langsung memukul database nyata untuk semua generated sequence.

---

## 16. Property-Based Testing untuk API

API juga punya property.

### 16.1 Pagination Property

```text
Mengambil semua page lalu menggabungkan result
harus sama dengan mengambil semua data tanpa pagination
untuk query yang sama.
```

```java
@Property
void paginatedResultMatchesUnpagedResult(@ForAll("searchQueries") SearchQuery query,
                                          @ForAll @IntRange(min = 1, max = 100) int pageSize) {
    List<Item> unpaged = api.search(query.withoutPagination()).items();

    List<Item> paged = new ArrayList<>();
    int page = 0;
    Page<Item> current;
    do {
        current = api.search(query.withPagination(page, pageSize));
        paged.addAll(current.items());
        page++;
    } while (current.hasNext());

    assertThat(paged).containsExactlyElementsOf(unpaged);
}
```

### 16.2 Filter Monotonicity

```text
Jika filter ditambah constraint,
jumlah result tidak boleh bertambah.
```

```java
@Property
void addingMoreRestrictiveFilterDoesNotIncreaseResultCount(
        @ForAll("baseFilters") CaseSearchFilter base,
        @ForAll("additionalFilters") CaseSearchFilter additional
) {
    CaseSearchFilter stricter = base.and(additional);

    long baseCount = repository.search(base).size();
    long stricterCount = repository.search(stricter).size();

    assertThat(stricterCount).isLessThanOrEqualTo(baseCount);
}
```

### 16.3 API Compatibility

Property:

```text
Old client payloads accepted by new API must preserve old semantics.
```

```java
@Property
void v1PayloadsRemainAcceptedByV2Endpoint(@ForAll("validV1Payloads") V1Payload payload) {
    Response response = apiV2.submit(payload.asJson());

    assertThat(response.statusCode()).isIn(200, 201, 202);
}
```

Ini bukan pengganti consumer contract, tetapi guardrail tambahan.

---

## 17. Property-Based Testing untuk Persistence

Property untuk persistence harus hati-hati karena database mahal.

### 17.1 Round-Trip Persistence

```text
save(entity), load(id) harus preserve domain fields.
```

```java
@Property(tries = 50)
void savedApplicationCanBeLoadedWithoutLosingDomainFields(
        @ForAll("validApplications") CaseApplication app
) {
    repository.save(app);

    CaseApplication loaded = repository.findById(app.id()).orElseThrow();

    assertThat(loaded)
            .usingRecursiveComparison()
            .ignoringFields("version", "createdAt", "updatedAt")
            .isEqualTo(app);
}
```

Catatan:

- kurangi tries untuk DB test;
- bersihkan data;
- gunakan transaction rollback atau isolated schema;
- jangan jalankan ratusan DB property tests di fast unit pipeline.

### 17.2 Constraint Property

```text
Untuk semua duplicate business key,
DB harus menolak insert kedua.
```

```java
@Property(tries = 30)
void duplicateCaseNumberIsRejected(@ForAll("caseNumbers") String caseNumber) {
    CaseApplication first = validCaseBuilder().caseNumber(caseNumber).build();
    CaseApplication second = validCaseBuilder().caseNumber(caseNumber).build();

    repository.save(first);

    assertThatThrownBy(() -> repository.save(second))
            .isInstanceOf(DataIntegrityViolationException.class);
}
```

---

## 18. Property-Based Testing untuk Performance Engineering

Property-based testing bukan benchmark. Tetapi ia bisa membantu performance engineering dalam beberapa cara.

### 18.1 Correctness Before Optimization

Sebelum mengoptimalkan algorithm, buat property yang membandingkan optimized version dengan simple reference version.

```java
@Property
void optimizedDedupMatchesReferenceDedup(@ForAll("eventLists") List<CaseEvent> events) {
    List<CaseEvent> expected = referenceDedup(events);
    List<CaseEvent> actual = optimizedDedup(events);

    assertThat(actual).containsExactlyElementsOf(expected);
}
```

Setelah property kuat, baru benchmark optimized version dengan JMH.

```text
Property test menjawab: apakah benar?
JMH menjawab: seberapa cepat/berapa allocation?
Profiler menjawab: bottleneck di mana?
```

### 18.2 Complexity Guard

Property test bisa memberi sinyal kasar untuk complexity bug, tetapi jangan jadikan substitute benchmark.

Contoh:

```text
Untuk input list size 10, 100, 1000,
operation harus selesai dalam batas sanity check longgar.
```

Namun hati-hati: time-based assertion sering flaky. Untuk performance, lebih baik pakai JMH atau dedicated performance test.

### 18.3 Allocation-Aware Correctness

Misalnya optimized method melakukan object pooling/caching. Property bisa memastikan cache tidak mengubah semantics.

```java
@Property
void cachedNormalizationMatchesUncachedNormalization(@ForAll String input) {
    assertThat(cached.normalize(input)).isEqualTo(uncached.normalize(input));
}
```

---

## 19. Anti-Patterns

### 19.1 Property Terlalu Lemah

```java
@Property
void resultIsNotNull(@ForAll String input) {
    assertThat(service.process(input)).isNotNull();
}
```

Ini biasanya tidak bernilai. Not-null bukan invariant yang cukup.

### 19.2 Property Mengulang Implementasi

Buruk:

```java
@Property
void taxIsCorrect(@ForAll BigDecimal amount) {
    BigDecimal expected = amount.multiply(new BigDecimal("0.09")).setScale(2, HALF_UP);
    BigDecimal actual = taxService.calculate(amount);

    assertThat(actual).isEqualTo(expected);
}
```

Ini bisa benar jika expected adalah reference implementation. Tetapi jika hanya copy-paste logic production, test menjadi duplikasi implementasi.

Lebih baik:

```text
- tax non-negative
- tax <= amount for discount-like calculation
- currency preserved
- rounding follows explicit examples
- differential test against independent reference implementation
```

### 19.3 Generator Tidak Merepresentasikan Domain

Buruk:

```java
@ForAll String postalCode
```

Untuk domain postal code 6 digit, ini menghasilkan terlalu banyak input irrelevant.

Lebih baik:

```java
@ForAll("validPostalCodes") String postalCode
```

### 19.4 Terlalu Banyak Filter

```java
Arbitraries.strings().filter(this::isValidComplexPayload)
```

Ini sering lambat dan buruk untuk shrinking.

### 19.5 Property Test dengan External Dependency Nyata

Buruk:

```text
Property test memanggil API eksternal ratusan kali.
```

Masalah:

- lambat,
- flaky,
- rate limit,
- biaya,
- nondeterministic,
- tidak reproducible.

Gunakan fake/service virtualization/contract tests.

### 19.6 Time-Based Flaky Property

Buruk:

```java
assertThat(duration).isLessThan(Duration.ofMillis(10));
```

Gunakan fake clock untuk domain time. Gunakan JMH untuk microbenchmark.

### 19.7 Property Terlalu Luas

```text
Generate seluruh object graph enterprise besar dan jalankan full workflow end-to-end.
```

Ini biasanya sulit di-debug. Lebih baik pecah:

- value object property,
- command property,
- transition property,
- repository property,
- API property,
- event handler property.

### 19.8 Mengabaikan Failing Seed

Jika property gagal dan seed tidak disimpan, bug bisa hilang. Perlakukan seed sebagai bagian dari bug report.

---

## 20. Property-Based Testing Design Workflow

Gunakan langkah berikut saat menulis property test.

### Step 1: Pilih Behavior Berisiko

Tanya:

```text
Behavior mana yang punya banyak kombinasi input dan invariant kuat?
```

Prioritas tinggi:

- money,
- date/time/SLA,
- workflow transition,
- authorization,
- idempotency,
- parser/formatter,
- serialization,
- deduplication,
- sorting/search/filter,
- migration/refactor.

### Step 2: Rumuskan Property dalam Bahasa Domain

Contoh:

```text
Duplicate submit command dengan idempotency key sama tidak boleh membuat audit kedua.
```

Bukan:

```text
submit() should work for random command.
```

### Step 3: Tentukan Input Space

```text
Input valid?
Input invalid?
Boundary?
Sequence?
Combination?
```

### Step 4: Buat Generator

Prinsip:

```text
valid by default
boundary-aware
small enough to debug
large enough to find bugs
```

### Step 5: Buat Oracle / Invariant

Pastikan assertion:

- tidak terlalu lemah;
- tidak menyalin implementasi;
- menjelaskan domain;
- memberi failure message jelas.

### Step 6: Jalankan dan Review Failure

Jika gagal:

1. baca shrunk input;
2. simpan seed;
3. ubah menjadi regression example test jika bug penting;
4. fix production code atau property/generator jika property salah.

### Step 7: Integrasikan ke CI

Kelompokkan:

```text
fast property tests:
  jalan di PR

slow property tests:
  jalan nightly/pre-release

stateful/db property tests:
  jalan scheduled atau module-specific
```

---

## 21. Dari Failing Property ke Regression Test

Ketika property menemukan bug, jangan hanya membiarkan property test sebagai satu-satunya bukti.

Workflow yang baik:

```text
1. Property test gagal.
2. Ambil shrunk input.
3. Buat example-based regression test dengan input tersebut.
4. Fix bug.
5. Pastikan property tetap ada untuk eksplorasi masa depan.
```

Contoh:

Property menemukan bug pada:

```text
amount = 0.01
percent = 50
rounding = HALF_UP
```

Tambahkan regression test:

```java
@Test
void shouldRoundHalfCentDiscountCorrectly() {
    Money subtotal = Money.of("0.01", "SGD");

    Money discount = Discount.percent(50).applyTo(subtotal);

    assertThat(discount).isEqualTo(Money.of("0.01", "SGD"));
}
```

Atau jika expected-nya domain-specific, tulis sesuai rule.

Property tetap dipertahankan untuk mencari edge case lain.

---

## 22. Java 8 sampai Java 25 Compatibility Notes

### 22.1 Java 8

Java 8 codebase biasanya punya kondisi:

- JUnit 4 masih dominan;
- build tool lama;
- belum semua project memakai JUnit Platform;
- record belum tersedia;
- `List.of`, `Map.of`, `Stream.toList()` belum ada;
- date/time API sudah ada (`java.time`);
- lambdas tersedia.

Saran:

- jqwik bisa digunakan jika JUnit Platform sudah masuk;
- QuickTheories bisa dipertimbangkan untuk Java 8 legacy;
- hindari contoh dengan record/sealed class;
- gunakan POJO biasa;
- gunakan `Collectors.toList()`.

### 22.2 Java 11

Java 11 umumnya lebih nyaman untuk JUnit Platform. Tetapi fitur bahasa masih belum semodern Java 17+.

Saran:

- jqwik + JUnit 5 Platform;
- gunakan `var` lokal dengan bijak;
- tetap hindari record jika source compatibility Java 11.

### 22.3 Java 17

Java 17 memungkinkan:

- record untuk test data;
- sealed class untuk command/event hierarchy;
- pattern matching mulai relevan tergantung versi;
- JUnit 6 mulai menjadi opsi karena butuh Java 17+.

Property generator untuk record bisa lebih ringkas.

### 22.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Untuk property tests:

- jangan menjadikan property test sebagai concurrency correctness proof;
- untuk concurrency memory model, gunakan jcstress;
- property test bisa memvalidasi high-level behavior async/idempotency, tetapi bukan menggantikan race testing.

### 22.5 Java 25

Java 25 sebagai baseline terbaru perlu diperlakukan dengan compatibility mindset:

- cek versi JUnit/jqwik/build tool;
- cek removed/deprecated JVM flags jika property tests berjalan di matrix Java versions;
- pastikan annotation processor/test engine compatible;
- gunakan CI matrix untuk library yang diklaim support multi-version.

---

## 23. Integrasi dengan Build dan CI

### 23.1 Pisahkan Fast dan Slow Property Tests

Contoh naming/tagging:

```java
@Property
@Tag("property")
void fastProperty(...) {}

@Property(tries = 1000)
@Tag("slow-property")
void slowProperty(...) {}
```

PR pipeline:

```text
unit + fast property + integration smoke
```

Nightly pipeline:

```text
all property + mutation subset + integration + performance regression
```

### 23.2 Tries Count

Default tries sering cukup untuk banyak property, tetapi tidak semua.

Guideline:

```text
Pure value object property:
  100-1000 tries masuk akal

Domain service with fake dependency:
  100-300 tries

Database-backed property:
  10-100 tries

Stateful sequence property:
  mulai 20-100 tries, naik bertahap
```

### 23.3 Failure Artifact

Saat property gagal, log:

- property name,
- seed,
- shrunk input,
- generated command sequence,
- domain state before/after,
- relevant audit/events,
- expected vs actual invariant.

Jangan log PII/secrets.

---

## 24. Property-Based Testing dan Regulatory Defensibility

Untuk sistem regulatory/case-management, property-based testing sangat berguna untuk membuktikan invariant seperti:

```text
1. Case terminal tidak berubah tanpa reopen authority.
2. Reject harus selalu punya reason.
3. Approve harus selalu punya approver dan timestamp.
4. Submit harus selalu membuat audit.
5. Unauthorized action tidak boleh mengubah state.
6. Duplicate command tidak boleh menggandakan side effect.
7. SLA due date tidak boleh mundur tanpa authorized extension.
8. Appeal tidak boleh dibuat untuk case yang belum final.
9. Evidence attachment tidak boleh hilang saat transition.
10. Cross-entity status tidak boleh inconsistent.
```

Ini bukan hanya test teknis. Ini bukti desain sistem.

Property-based testing bisa membantu menjawab:

```text
Apakah invariant ini benar untuk banyak kombinasi command, user, status, dan tanggal?
```

Dalam sistem regulasi, bug sering bukan “method crash”, tetapi:

```text
state menjadi legal secara teknis tetapi ilegal secara domain.
```

Property-based testing kuat untuk jenis bug seperti itu.

---

## 25. Mini Case Study: Testing SLA Calculation

### 25.1 Domain

Misal:

```text
SLA due date = receivedDate + N working days
Tidak menghitung weekend.
Public holiday dikecualikan.
Extension menambah due date.
Due date tidak boleh sebelum receivedDate.
```

### 25.2 Example-Based Tests

```java
@Test
void shouldSkipWeekendWhenCalculatingDueDate() {
    LocalDate received = LocalDate.of(2026, 6, 12); // Friday

    LocalDate due = slaCalculator.dueDate(received, 1, noHolidays());

    assertThat(due).isEqualTo(LocalDate.of(2026, 6, 15)); // Monday
}
```

### 25.3 Property-Based Tests

Property 1:

```text
Due date tidak boleh sebelum received date.
```

```java
@Property
void dueDateIsNeverBeforeReceivedDate(
        @ForAll("businessDates") LocalDate received,
        @ForAll @IntRange(min = 0, max = 365) int workingDays
) {
    LocalDate due = slaCalculator.dueDate(received, workingDays, noHolidays());

    assertThat(due).isAfterOrEqualTo(received);
}
```

Property 2:

```text
Menambah working days tidak boleh membuat due date lebih awal.
```

```java
@Property
void moreWorkingDaysNeverProducesEarlierDueDate(
        @ForAll("businessDates") LocalDate received,
        @ForAll @IntRange(min = 0, max = 100) int first,
        @ForAll @IntRange(min = 0, max = 100) int extra
) {
    LocalDate due1 = slaCalculator.dueDate(received, first, noHolidays());
    LocalDate due2 = slaCalculator.dueDate(received, first + extra, noHolidays());

    assertThat(due2).isAfterOrEqualTo(due1);
}
```

Property 3:

```text
Jika extension ditambah, due date tidak boleh maju.
```

```java
@Property
void extensionNeverMovesDueDateEarlier(
        @ForAll("businessDates") LocalDate received,
        @ForAll @IntRange(min = 0, max = 100) int baseDays,
        @ForAll @IntRange(min = 0, max = 100) int extensionDays
) {
    LocalDate original = slaCalculator.dueDate(received, baseDays, noHolidays());
    LocalDate extended = slaCalculator.extend(original, extensionDays, noHolidays());

    assertThat(extended).isAfterOrEqualTo(original);
}
```

### 25.4 Apa yang Ditemukan Property Ini?

Property ini dapat menemukan bug seperti:

- off-by-one saat received date adalah weekend;
- due date mundur ketika workingDays = 0;
- extension negatif tidak sengaja diterima;
- leap year bug;
- holiday di boundary;
- timezone conversion error jika tanggal berasal dari instant.

---

## 26. Mini Case Study: Authorization Matrix

### 26.1 Domain

Misal action:

```text
VIEW_CASE
SUBMIT_CASE
ASSIGN_CASE
APPROVE_CASE
REJECT_CASE
REOPEN_CASE
DELETE_DRAFT
```

Role:

```text
APPLICANT
OFFICER
SUPERVISOR
ADMIN
AUDITOR
```

### 26.2 Policy Table sebagai Oracle

```java
final class AuthorizationPolicyTable {
    private final Map<Role, Set<Action>> allowedActions = Map.of(
            Role.APPLICANT, Set.of(Action.VIEW_CASE, Action.SUBMIT_CASE),
            Role.OFFICER, Set.of(Action.VIEW_CASE, Action.ASSIGN_CASE),
            Role.SUPERVISOR, Set.of(Action.VIEW_CASE, Action.APPROVE_CASE, Action.REJECT_CASE),
            Role.ADMIN, Set.of(Action.VIEW_CASE, Action.REOPEN_CASE, Action.DELETE_DRAFT),
            Role.AUDITOR, Set.of(Action.VIEW_CASE)
    );

    boolean isAllowed(Role role, Action action) {
        return allowedActions.getOrDefault(role, Set.of()).contains(action);
    }
}
```

Untuk Java 8, `Map.of` dan `Set.of` tidak tersedia. Gunakan builder/manual initialization.

### 26.3 Property

```java
@Property
void authorizationServiceMatchesPolicyTable(@ForAll Role role, @ForAll Action action) {
    boolean expected = policyTable.isAllowed(role, action);

    boolean actual = authorizationService.isAllowed(role, action);

    assertThat(actual).isEqualTo(expected);
}
```

### 26.4 Higher-Level Property

```text
Unauthorized action tidak boleh mengubah state atau membuat audit sukses.
```

```java
@Property
void unauthorizedActionDoesNotMutateCase(
        @ForAll("caseStates") CaseApplication app,
        @ForAll("unauthorizedRoleActions") RoleAction roleAction
) {
    CaseSnapshot before = CaseSnapshot.from(app);
    FakeAuditSink audit = new FakeAuditSink();

    assertThatThrownBy(() -> workflow.perform(app, roleAction.role(), roleAction.action()))
            .isInstanceOf(AccessDeniedException.class);

    assertThat(CaseSnapshot.from(app)).isEqualTo(before);
    assertThat(audit.successEvents()).isEmpty();
}
```

---

## 27. Mini Case Study: Search Filter Monotonicity

### 27.1 Domain

Search cases by:

- status,
- assigned officer,
- date range,
- case type,
- risk level,
- applicant type.

### 27.2 Property

```text
Adding filters should not increase result count.
```

```java
@Property(tries = 50)
void stricterSearchDoesNotReturnMoreResults(
        @ForAll("searchFilters") CaseSearchFilter base,
        @ForAll("additionalSearchFilters") CaseSearchFilter additional
) {
    CaseSearchFilter stricter = base.merge(additional);

    List<CaseSummary> baseResult = searchService.search(base);
    List<CaseSummary> stricterResult = searchService.search(stricter);

    assertThat(stricterResult.size()).isLessThanOrEqualTo(baseResult.size());
}
```

### 27.3 Caveat

Property ini hanya valid jika `merge(additional)` benar-benar menambah constraint, bukan mengganti constraint.

Misal:

```text
base.status = APPROVED
additional.status = REJECTED
```

Jika merge mengganti status, result bisa bertambah. Jadi generator dan semantic merge harus jelas.

Ini contoh penting: property bukan hanya soal test syntax, tetapi soal kebenaran model domain.

---

## 28. Kapan Property-Based Testing Tidak Cocok

Jangan pakai property-based testing jika:

1. behavior sangat spesifik dan hanya punya sedikit case penting;
2. expected result lebih mudah dinyatakan sebagai contoh eksplisit;
3. generator domain terlalu mahal dibuat untuk value rendah;
4. test harus memanggil external dependency nyata;
5. behavior sangat UI-specific dan lebih cocok visual/E2E test;
6. invariant tidak jelas;
7. property yang dibuat hanya `notNull` atau `doesNotThrow`;
8. runtime test terlalu mahal untuk feedback loop;
9. failure sulit direproduksi;
10. team belum siap membaca hasil property test.

Gunakan property-based testing saat ada **hukum umum** yang benar-benar bernilai.

---

## 29. Checklist Property-Based Test yang Baik

Sebelum merge property test, review pertanyaan ini:

```text
[ ] Apakah property ditulis dalam bahasa domain yang jelas?
[ ] Apakah generator merepresentasikan input space yang benar?
[ ] Apakah valid dan invalid input dipisahkan?
[ ] Apakah property punya oracle yang kuat?
[ ] Apakah assertion failure mudah didiagnosis?
[ ] Apakah seed dapat dipakai untuk reproduce?
[ ] Apakah shrinking masih bekerja baik?
[ ] Apakah test tidak bergantung external service nyata?
[ ] Apakah tidak memakai randomness di luar framework?
[ ] Apakah test cukup cepat untuk pipeline yang dituju?
[ ] Apakah tries count masuk akal?
[ ] Apakah property tidak menyalin implementation detail?
[ ] Apakah failing case penting akan diubah menjadi regression example test?
```

---

## 30. Team Guideline

Saran policy tim:

```text
1. Gunakan example-based test untuk business scenarios utama.
2. Gunakan property-based test untuk invariant dan input space luas.
3. Jangan merge property yang hanya assert not-null.
4. Semua custom generator harus diberi nama domain.
5. Valid/invalid generator harus dipisahkan.
6. Failing seed harus masuk bug report.
7. Jika property menemukan bug, tambahkan regression example test.
8. Property test lambat diberi tag khusus.
9. DB-backed property test tidak boleh masuk fast unit suite tanpa alasan kuat.
10. Property test tidak menggantikan JMH, jcstress, atau load test.
```

---

## 31. Hubungan dengan Part Berikutnya

Part ini membahas property-based testing sebagai cara meningkatkan correctness confidence.

Part berikutnya akan membahas:

```text
Part 013 — Mutation Testing dan Test Quality Measurement
```

Property-based testing dan mutation testing saling melengkapi:

```text
Property-based testing:
  memperluas ruang input yang diuji.

Mutation testing:
  menguji apakah test benar-benar sensitif terhadap bug.
```

Jika property test banyak tetapi mutation score tetap buruk, kemungkinan property-nya terlalu lemah.

---

## 32. Summary

Property-based testing adalah teknik untuk menguji hukum umum, bukan hanya contoh tunggal.

Mental model utamanya:

```text
Property = generator + constraint + operation + invariant
```

Ia sangat kuat untuk:

- round-trip serialization,
- parser/formatter,
- money/date/time calculation,
- sorting/deduplication,
- idempotency,
- state transition,
- authorization matrix,
- search/filter monotonicity,
- refactoring/migration differential test,
- optimized implementation correctness.

Tetapi property-based testing juga mudah disalahgunakan. Property yang buruk bisa:

- terlalu lemah,
- terlalu lambat,
- flaky,
- sulit di-debug,
- tidak merepresentasikan domain,
- hanya mengetes implementation detail.

Engineer advanced menggunakan property-based testing bukan karena “lebih fancy”, tetapi karena beberapa risiko tidak bisa dikontrol dengan contoh manual saja.

Prinsip akhir:

```text
Example-based tests explain the rules.
Property-based tests attack the space around the rules.
Mutation testing checks whether those tests can actually catch faults.
```

---

## 33. Referensi

- jqwik User Guide: https://jqwik.net/docs/current/user-guide.html
- jqwik website: https://jqwik.net/
- jqwik GitHub: https://github.com/jqwik-team/jqwik
- QuickTheories GitHub: https://github.com/quicktheories/QuickTheories
- QuickTheories Maven Repository: https://mvnrepository.com/artifact/org.quicktheories/quicktheories
- JUnit User Guide: https://docs.junit.org/current/user-guide/
- AssertJ Documentation: https://assertj.github.io/doc/
- Johannes Link, Property-Based Testing articles: https://blog.johanneslink.net/
- QuickREST paper: Property-based Test Generation of OpenAPI-Described RESTful APIs, arXiv 1912.09686

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-011](./learn-java-testing-benchmarking-performance-jvm-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-013](./learn-java-testing-benchmarking-performance-jvm-part-013.md)

</div>