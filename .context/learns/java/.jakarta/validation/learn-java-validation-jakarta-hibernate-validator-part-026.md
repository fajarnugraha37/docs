# learn-java-validation-jakarta-hibernate-validator-part-026

# Testing Validation: Unit, Integration, Contract, Mutation, and Property-Based Tests

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `026`  
> Topik: Testing validation rules dari level constraint sampai API contract dan policy rule  
> Target Java: 8 sampai 25  
> Fokus library: Jakarta Validation / Bean Validation, Hibernate Validator, JUnit 5, jqwik, PIT/Pitest, Spring/JAX-RS integration

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas validation dari banyak sisi: built-in constraints, custom constraints, class-level validation, executable validation, REST API, persistence, event-driven system, workflow/state-machine, domain policy, performance, dan security.

Bagian ini menjawab pertanyaan berikut:

> Bagaimana memastikan validation rules yang kita tulis benar, stabil, tidak mudah regression, tidak misleading untuk client, dan tetap dapat diaudit ketika sistem membesar?

Dalam sistem kecil, validation sering dites secara informal:

- kirim request manual lewat Postman,
- lihat error muncul,
- selesai.

Dalam sistem besar, pendekatan itu tidak cukup. Validation rule adalah bagian dari kontrak sistem. Ia menentukan:

- data apa yang boleh masuk,
- data apa yang ditolak,
- kapan action boleh dijalankan,
- error apa yang diterima client,
- rule mana yang dijadikan dasar audit,
- kapan rule baru boleh diberlakukan,
- bagaimana compatibility dijaga.

Jika validation salah, dampaknya bisa besar:

- user valid ditolak,
- user invalid diterima,
- workflow bisa masuk state ilegal,
- FE salah mapping error,
- batch import gagal massal,
- event consumer masuk DLQ terus,
- database constraint meledak di runtime,
- auditor tidak bisa melihat alasan penolakan,
- security boundary bocor.

Maka testing validation harus diperlakukan sebagai testing terhadap **contract, invariants, and decision boundaries**.

---

## 2. Mental Model: Apa yang Sebenarnya Dites?

Validation bukan satu jenis logic. Maka test-nya juga tidak satu jenis.

Bayangkan validation sebagai beberapa lapisan:

```text
External Input
   |
   v
[1] Parsing / Deserialization
   |
   v
[2] DTO Shape Validation
   |
   v
[3] Semantic / Cross-Field Validation
   |
   v
[4] Command / Use-Case Validation
   |
   v
[5] Domain Invariant
   |
   v
[6] Workflow / State Transition Guard
   |
   v
[7] Persistence / DB Constraint
   |
   v
[8] Event / Integration Contract
```

Testing harus tahu lapisan mana yang sedang diuji.

Kesalahan umum adalah semua diuji lewat REST API test. Itu lambat, rapuh, dan membuat penyebab gagal sulit dilacak.

Lebih baik gunakan piramida testing seperti ini:

```text
                 [Few]
        End-to-End / Journey Tests
              API Contract Tests
       Integration Tests with Framework
   Domain Policy / Command Validator Tests
 Custom Constraint / Class-Level Unit Tests
 Built-in Constraint DTO Shape Tests
                [Many]
```

Rule praktis:

- **Constraint validator custom** dites dengan unit test cepat.
- **DTO validation mapping** dites dengan Bean/Jakarta Validator langsung.
- **Framework integration** dites sedikit tapi representatif.
- **API error contract** dites sebagai contract, bukan hanya status code.
- **Domain/workflow policy** dites sebagai rule engine/domain service, bukan dipaksa lewat annotation.
- **DB final consistency** dites dengan integration test database.
- **Security/abuse edge case** dites eksplisit.

---

## 3. Testing Built-in Constraint pada DTO

Misalnya DTO berikut:

```java
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class RegisterUserRequest {

    @NotBlank
    @Size(max = 120)
    private String displayName;

    @NotBlank
    @Email
    private String email;

    public RegisterUserRequest(String displayName, String email) {
        this.displayName = displayName;
        this.email = email;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getEmail() {
        return email;
    }
}
```

Unit test minimal:

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class RegisterUserRequestValidationTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    @Test
    void should_accept_valid_request() {
        RegisterUserRequest request = new RegisterUserRequest("Alice", "alice@example.com");

        Set<ConstraintViolation<RegisterUserRequest>> violations = validator.validate(request);

        assertThat(violations).isEmpty();
    }

    @Test
    void should_reject_blank_display_name() {
        RegisterUserRequest request = new RegisterUserRequest("   ", "alice@example.com");

        Set<ConstraintViolation<RegisterUserRequest>> violations = validator.validate(request);

        assertThat(violations)
                .anySatisfy(v -> {
                    assertThat(v.getPropertyPath().toString()).isEqualTo("displayName");
                    assertThat(v.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName())
                            .isEqualTo("NotBlank");
                });
    }

    @Test
    void should_reject_invalid_email() {
        RegisterUserRequest request = new RegisterUserRequest("Alice", "not-an-email");

        Set<ConstraintViolation<RegisterUserRequest>> violations = validator.validate(request);

        assertThat(violations)
                .anySatisfy(v -> {
                    assertThat(v.getPropertyPath().toString()).isEqualTo("email");
                    assertThat(v.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName())
                            .isEqualTo("Email");
                });
    }
}
```

Hal penting:

Jangan hanya assert message string.

Message bisa berubah karena:

- locale,
- bundle,
- interpolation,
- provider version,
- wording refactor,
- product copy change.

Lebih stabil untuk assert:

- property path,
- constraint type,
- custom error code,
- payload/severity,
- violation count jika memang kontrak,
- rejected value jika aman dan relevan.

---

## 4. Test Helper untuk Validation

Dalam codebase besar, buat helper agar test tidak berulang.

Contoh:

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;

import java.lang.annotation.Annotation;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

public final class ValidationTestSupport {

    private static final ValidatorFactory FACTORY = Validation.buildDefaultValidatorFactory();
    private static final Validator VALIDATOR = FACTORY.getValidator();

    private ValidationTestSupport() {
    }

    public static <T> Set<ConstraintViolation<T>> validate(T value, Class<?>... groups) {
        return VALIDATOR.validate(value, groups);
    }

    public static <T> void assertNoViolations(T value, Class<?>... groups) {
        assertThat(validate(value, groups)).isEmpty();
    }

    public static <T> void assertViolation(
            T value,
            String expectedPath,
            Class<? extends Annotation> expectedConstraint,
            Class<?>... groups
    ) {
        assertThat(validate(value, groups))
                .anySatisfy(v -> {
                    assertThat(v.getPropertyPath().toString()).isEqualTo(expectedPath);
                    assertThat(v.getConstraintDescriptor().getAnnotation().annotationType())
                            .isEqualTo(expectedConstraint);
                });
    }
}
```

Pemakaian:

```java
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;

class RegisterUserRequestValidationTest {

    @Test
    void should_reject_blank_display_name() {
        var request = new RegisterUserRequest(" ", "alice@example.com");

        ValidationTestSupport.assertViolation(request, "displayName", NotBlank.class);
    }
}
```

Catatan:

- Untuk test suite besar, lifecycle `ValidatorFactory` harus hati-hati.
- `ValidatorFactory` mahal dibanding `Validator` usage biasa.
- Jangan create factory per test method tanpa alasan.
- Jika memakai Spring/CDI injection di validator, helper plain seperti ini mungkin tidak cukup; gunakan integration test context untuk kasus tersebut.

---

## 5. Testing Custom Constraint

Misalnya custom constraint:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE_USE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface CaseReference {
    String message() default "{caseReference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String prefix() default "CASE";
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.regex.Pattern;

public class CaseReferenceValidator implements ConstraintValidator<CaseReference, String> {

    private String prefix;
    private Pattern pattern;

    @Override
    public void initialize(CaseReference annotation) {
        this.prefix = annotation.prefix();
        this.pattern = Pattern.compile(Pattern.quote(prefix) + "-[0-9]{8}-[A-Z0-9]{6}");
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return pattern.matcher(value).matches();
    }
}
```

Test langsung terhadap annotation usage:

```java
import org.junit.jupiter.api.Test;

class CaseReferenceConstraintTest {

    static class TestBean {
        @CaseReference
        String reference;

        TestBean(String reference) {
            this.reference = reference;
        }
    }

    @Test
    void should_accept_valid_reference() {
        ValidationTestSupport.assertNoViolations(new TestBean("CASE-20260101-ABC123"));
    }

    @Test
    void should_reject_invalid_reference() {
        ValidationTestSupport.assertViolation(
                new TestBean("BAD-20260101-ABC123"),
                "reference",
                CaseReference.class
        );
    }

    @Test
    void should_allow_null_because_requiredness_is_separate() {
        ValidationTestSupport.assertNoViolations(new TestBean(null));
    }
}
```

Kenapa test null penting?

Karena convention Jakarta/Bean Validation adalah banyak constraint menganggap `null` valid kecuali constraint tersebut memang requiredness constraint seperti `@NotNull`. Custom constraint sebaiknya mengikuti convention ini kecuali memang secara eksplisit bertugas mengecek requiredness.

Jika constraint format juga menolak null, ia menjadi ambiguous:

```java
@CaseReference
private String reference;
```

Apakah ini berarti format harus benar jika ada, atau field wajib ada?

Lebih jelas:

```java
@NotNull
@CaseReference
private String reference;
```

---

## 6. Testing Class-Level / Cross-Field Constraint

Misalnya DTO:

```java
@ValidDateRange(start = "startDate", end = "endDate")
public class SearchPeriodRequest {
    private LocalDate startDate;
    private LocalDate endDate;

    // constructor/getter omitted
}
```

Class-level validator sering menghasilkan violation di object path kosong. Untuk API, biasanya lebih berguna mengarahkan violation ke field tertentu.

Validator:

```java
@Override
public boolean isValid(SearchPeriodRequest value, ConstraintValidatorContext context) {
    if (value == null) {
        return true;
    }
    if (value.getStartDate() == null || value.getEndDate() == null) {
        return true;
    }
    if (!value.getStartDate().isAfter(value.getEndDate())) {
        return true;
    }

    context.disableDefaultConstraintViolation();
    context.buildConstraintViolationWithTemplate("{dateRange.invalid}")
            .addPropertyNode("endDate")
            .addConstraintViolation();
    return false;
}
```

Test:

```java
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

class SearchPeriodRequestValidationTest {

    @Test
    void should_reject_start_after_end_and_attach_violation_to_end_date() {
        var request = new SearchPeriodRequest(
                LocalDate.of(2026, 2, 1),
                LocalDate.of(2026, 1, 1)
        );

        ValidationTestSupport.assertViolation(
                request,
                "endDate",
                ValidDateRange.class
        );
    }
}
```

Hal yang harus dites untuk class-level constraint:

- object `null`, jika mungkin,
- field dependency `null`,
- valid equal boundary,
- valid min/max boundary,
- invalid ordering,
- violation path,
- jumlah violation jika custom validator membuat beberapa violation,
- group behavior,
- message/error code mapping.

---

## 7. Testing Container Element Constraints

DTO:

```java
public class InviteUsersRequest {

    @Size(max = 100)
    private List<@NotBlank @Email String> emails;

    public InviteUsersRequest(List<String> emails) {
        this.emails = emails;
    }

    public List<String> getEmails() {
        return emails;
    }
}
```

Test:

```java
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class InviteUsersRequestValidationTest {

    @Test
    void should_reject_blank_element() {
        var request = new InviteUsersRequest(List.of("alice@example.com", " "));

        var violations = ValidationTestSupport.validate(request);

        assertThat(violations)
                .anySatisfy(v -> {
                    assertThat(v.getPropertyPath().toString()).contains("emails");
                    assertThat(v.getConstraintDescriptor().getAnnotation().annotationType())
                            .isEqualTo(NotBlank.class);
                });
    }

    @Test
    void should_reject_invalid_email_element() {
        var request = new InviteUsersRequest(List.of("alice@example.com", "not-email"));

        var violations = ValidationTestSupport.validate(request);

        assertThat(violations)
                .anySatisfy(v -> {
                    assertThat(v.getPropertyPath().toString()).contains("emails");
                    assertThat(v.getConstraintDescriptor().getAnnotation().annotationType())
                            .isEqualTo(Email.class);
                });
    }
}
```

Jangan terlalu bergantung pada string path provider-specific jika tidak menjadi API contract. Path untuk container element bisa mengandung detail seperti index/key/container node. Lebih aman:

- parse `Path.Node` jika path menjadi kontrak internal,
- normalisasi path sendiri untuk API,
- test hasil normalisasi, bukan raw `toString()` provider.

Contoh normalisasi sederhana:

```java
public final class ViolationPathNormalizer {

    private ViolationPathNormalizer() {
    }

    public static String normalize(jakarta.validation.Path path) {
        StringBuilder result = new StringBuilder();
        for (jakarta.validation.Path.Node node : path) {
            if (node.getName() == null) {
                continue;
            }
            if (result.length() > 0) {
                result.append('.');
            }
            result.append(node.getName());
            if (node.isInIterable()) {
                if (node.getIndex() != null) {
                    result.append('[').append(node.getIndex()).append(']');
                } else if (node.getKey() != null) {
                    result.append('[').append(node.getKey()).append(']');
                } else {
                    result.append("[]");
                }
            }
        }
        return result.toString();
    }
}
```

---

## 8. Testing Validation Groups

Misalnya:

```java
public interface Create {}
public interface Update {}

public class UserCommand {

    @Null(groups = Create.class)
    @NotNull(groups = Update.class)
    private Long id;

    @NotBlank(groups = { Create.class, Update.class })
    private String name;

    // constructor/getter omitted
}
```

Test harus eksplisit terhadap group.

```java
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import org.junit.jupiter.api.Test;

class UserCommandGroupValidationTest {

    @Test
    void create_should_reject_id() {
        var command = new UserCommand(10L, "Alice");

        ValidationTestSupport.assertViolation(command, "id", Null.class, Create.class);
    }

    @Test
    void update_should_require_id() {
        var command = new UserCommand(null, "Alice");

        ValidationTestSupport.assertViolation(command, "id", NotNull.class, Update.class);
    }

    @Test
    void default_group_should_not_accidentally_apply_create_or_update_rules() {
        var command = new UserCommand(null, "Alice");

        ValidationTestSupport.assertNoViolations(command);
    }
}
```

Test terakhir penting. Banyak bug terjadi karena engineer mengira constraint group tertentu otomatis aktif padahal tidak.

Checklist group testing:

- test group `Default`,
- test setiap operation group,
- test group inheritance,
- test group conversion pada nested object,
- test group sequence short-circuit,
- test framework annotation seperti Spring `@Validated(Create.class)`,
- test bahwa endpoint memakai group yang benar.

---

## 9. Testing Group Sequence

Group sequence harus dites bukan hanya bahwa rule gagal, tetapi bahwa rule berikutnya tidak dijalankan ketika group sebelumnya gagal.

Contoh:

```java
public interface BasicChecks {}
public interface ExpensiveChecks {}

@GroupSequence({ BasicChecks.class, ExpensiveChecks.class })
public interface OrderedChecks {}
```

Misalnya expensive validator menghitung jumlah invocation untuk test.

```java
public final class ExpensiveValidatorProbe {
    private static final AtomicInteger CALLS = new AtomicInteger();

    public static void reset() {
        CALLS.set(0);
    }

    public static int calls() {
        return CALLS.get();
    }

    public static void recordCall() {
        CALLS.incrementAndGet();
    }
}
```

Dalam validator expensive:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    ExpensiveValidatorProbe.recordCall();
    return true;
}
```

Test:

```java
@Test
void should_not_run_expensive_group_if_basic_group_fails() {
    ExpensiveValidatorProbe.reset();

    var request = new SomeRequest("", "some-value");

    var violations = ValidationTestSupport.validate(request, OrderedChecks.class);

    assertThat(violations).isNotEmpty();
    assertThat(ExpensiveValidatorProbe.calls()).isZero();
}
```

Catatan:

- Instrumentasi seperti probe hanya untuk test.
- Jangan pakai global mutable state dalam validator produksi.
- Jika validator expensive memanggil service, lebih baik test dengan mock/fake di integration test context.

---

## 10. Testing Executable Validation

Executable validation menguji method parameter, return value, constructor parameter, dan cross-parameter constraint.

Contoh service:

```java
public class CaseService {

    @NotNull
    public CaseSummary findCase(@NotBlank String caseReference) {
        return new CaseSummary(caseReference);
    }
}
```

Test dengan `ExecutableValidator`:

```java
import jakarta.validation.executable.ExecutableValidator;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class CaseServiceExecutableValidationTest {

    @Test
    void should_validate_method_parameter() throws Exception {
        var service = new CaseService();
        var method = CaseService.class.getMethod("findCase", String.class);

        ExecutableValidator executableValidator = Validation.buildDefaultValidatorFactory()
                .getValidator()
                .forExecutables();

        var violations = executableValidator.validateParameters(
                service,
                method,
                new Object[]{" "}
        );

        assertThat(violations)
                .anySatisfy(v -> assertThat(v.getPropertyPath().toString())
                        .contains("findCase"));
    }
}
```

Framework integration harus dites terpisah.

Misalnya di Spring:

- apakah class diberi `@Validated`,
- apakah method dipanggil lewat proxy,
- apakah self-invocation bypass terjadi,
- apakah exception yang muncul adalah `ConstraintViolationException`,
- apakah error mapper mengubahnya ke response contract yang benar.

Jangan puas hanya dengan unit test `ExecutableValidator` jika production memakai proxy-based validation.

---

## 11. Testing Spring MVC / REST API Validation

Misalnya endpoint:

```java
@RestController
@RequestMapping("/users")
class UserController {

    @PostMapping
    ResponseEntity<UserResponse> create(@Valid @RequestBody RegisterUserRequest request) {
        return ResponseEntity.ok(new UserResponse("id-1"));
    }
}
```

Test dengan MockMvc:

```java
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UserController.class)
class UserControllerValidationTest {

    @Autowired
    MockMvc mockMvc;

    @Test
    void should_return_problem_details_for_invalid_request() throws Exception {
        String body = """
                {
                  "displayName": " ",
                  "email": "not-email"
                }
                """;

        mockMvc.perform(post("/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value("https://api.example.com/problems/validation-error"))
                .andExpect(jsonPath("$.title").value("Validation failed"))
                .andExpect(jsonPath("$.violations").isArray())
                .andExpect(jsonPath("$.violations[0].code").exists())
                .andExpect(jsonPath("$.violations[0].path").exists());
    }
}
```

Yang harus diuji bukan hanya HTTP status.

Kontrak error minimum:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "traceId": "...",
  "violations": [
    {
      "path": "email",
      "code": "USER_EMAIL_INVALID",
      "message": "Email format is invalid",
      "severity": "ERROR"
    }
  ]
}
```

Test harus memastikan:

- response shape stabil,
- `traceId` ada,
- `violations` array ada,
- path sesuai FE expectation,
- code stabil,
- message boleh localized,
- rejected value tidak bocor jika sensitif,
- parsing/deserialization error dibedakan dari validation error,
- unknown field policy jelas,
- missing body policy jelas.

---

## 12. Testing JAX-RS / Jakarta REST Validation

Untuk Jakarta REST/JAX-RS, test fokus pada:

- entity body validation,
- query/path/header param validation,
- method parameter validation,
- exception mapper,
- response status,
- error body.

Pseudo contoh resource:

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response create(@Valid CreateCaseRequest request) {
        return Response.status(Response.Status.CREATED).build();
    }

    @GET
    @Path("/{reference}")
    public Response find(@PathParam("reference") @NotBlank String reference) {
        return Response.ok().build();
    }
}
```

Yang perlu dites:

- invalid body menghasilkan error contract,
- invalid path/query param menghasilkan error contract sama,
- `ConstraintViolationException` dipetakan oleh `ExceptionMapper`,
- path method parameter dinormalisasi agar tidak bocor detail internal seperti `arg0`,
- locale negotiation jika dipakai,
- correlation id masuk response.

---

## 13. Contract Test untuk API Error

Validation error adalah kontrak lintas backend, frontend, mobile app, integrasi partner, dan batch uploader.

Maka test-nya harus contract-oriented.

Contoh dengan JSONAssert atau snapshot/golden file:

```java
@Test
void validation_error_response_contract_should_remain_stable() throws Exception {
    String response = mockMvc.perform(post("/users")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            { "displayName": " ", "email": "bad" }
                            """))
            .andExpect(status().isUnprocessableEntity())
            .andReturn()
            .getResponse()
            .getContentAsString();

    assertThatJson(response)
            .node("type").isEqualTo("https://api.example.com/problems/validation-error")
            .node("status").isEqualTo(422)
            .node("violations").isArray();
}
```

Golden file approach:

```text
src/test/resources/contracts/errors/validation-error-create-user.json
```

Namun golden file harus hati-hati:

- jangan masukkan timestamp dinamis,
- jangan masukkan random trace id persis,
- jangan terlalu mengunci urutan violations kecuali kontrak memang menjamin urutan,
- jangan mengunci message localized jika copy sering berubah,
- kunci `code`, `path`, `severity`, dan struktur.

Contract test yang baik menangkap breaking change seperti:

- `field` berubah menjadi `property`,
- `email` berubah menjadi `request.email`,
- `INVALID_EMAIL` berubah menjadi `Email`,
- status 422 berubah menjadi 400 tanpa keputusan desain,
- rejected value mulai bocor.

---

## 14. Testing Message Interpolation dan i18n

Message interpolation perlu dites jika:

- API mengembalikan human-readable message,
- sistem multi-locale,
- message mengandung annotation attribute,
- message catalog governed,
- security melarang leakage nilai tertentu.

Contoh:

```java
@Test
void should_interpolate_size_message_in_english() {
    Locale previous = Locale.getDefault();
    Locale.setDefault(Locale.ENGLISH);
    try {
        var request = new RegisterUserRequest("A".repeat(121), "alice@example.com");

        var violations = ValidationTestSupport.validate(request);

        assertThat(violations)
                .anySatisfy(v -> assertThat(v.getMessage()).contains("120"));
    } finally {
        Locale.setDefault(previous);
    }
}
```

Lebih baik jika aplikasi punya locale resolver eksplisit, bukan tergantung global default locale.

Yang harus dites:

- bundle key ditemukan,
- fallback locale benar,
- missing key terlihat di test,
- message tidak menyertakan PII,
- message untuk class-level constraint masuk akal,
- message tidak dijadikan sumber error code.

Anti-pattern:

```java
assertThat(v.getMessage()).isEqualTo("must not be blank");
```

Ini rapuh karena message provider bisa berbeda.

Lebih stabil:

```java
assertThat(v.getMessageTemplate()).isEqualTo("{jakarta.validation.constraints.NotBlank.message}");
```

atau assert custom API code setelah mapping.

---

## 15. Testing PII Leakage dan Safe Logging

Validation sering menyimpan rejected value. Itu berbahaya untuk field sensitif:

- password,
- token,
- secret,
- NRIC/NIK/passport,
- phone,
- email,
- address,
- medical/legal content,
- uploaded filename/path,
- free text complaint.

Mapper error harus dites.

Contoh:

```java
@Test
void should_not_return_rejected_value_for_password() {
    var violation = fakeViolation(
            "password",
            "SuperSecretPassword123!",
            "PASSWORD_TOO_WEAK"
    );

    ApiViolation apiViolation = mapper.toApiViolation(violation);

    assertThat(apiViolation.rejectedValue()).isNull();
}
```

Untuk logging, gunakan test appender jika memakai Logback.

Tujuan test:

- raw password tidak muncul di log,
- token tidak muncul di log,
- full document number tidak muncul,
- hanya classification yang muncul,
- trace id/rule id tetap ada.

Contoh log aman:

```json
{
  "event": "validation_failed",
  "path": "identityNumber",
  "code": "IDENTITY_NUMBER_INVALID_FORMAT",
  "sensitivity": "HIGH",
  "rejectedValuePresent": true,
  "rejectedValueLogged": false,
  "traceId": "abc-123"
}
```

---

## 16. Testing Security Edge Cases

Validation test harus memasukkan malicious input, bukan hanya invalid input biasa.

### 16.1 String Edge Cases

Test value:

```text
null
""
" "
"\t\n"
"\u00A0"          non-breaking space
"\u200B"          zero-width space
"abc\nforged-log"
"<script>alert(1)</script>"
"' OR '1'='1"
"../../etc/passwd"
"=HYPERLINK(\"http://evil\")"
```

Tujuan:

- memastikan constraint behavior diketahui,
- memastikan output encoding/sanitization tidak diklaim oleh validation,
- memastikan log tidak bisa diforging,
- memastikan CSV export punya defense sendiri,
- memastikan path traversal tidak dicegah hanya dengan `@Pattern` rapuh.

### 16.2 Regex ReDoS Test

Jika punya custom regex, test worst-case input.

Contoh pola buruk:

```regex
(a+)+$
```

Input buruk:

```text
aaaaaaaaaaaaaaaaaaaaaaaaaaaaa!
```

Test performa sebaiknya tidak terlalu flaky. Untuk security-sensitive regex, lebih baik:

- hindari nested quantifier,
- gunakan possessive quantifier/atomic group jika tepat,
- batasi panjang input sebelum regex,
- gunakan library/parser khusus bila perlu,
- review regex secara manual.

Unit test timeout bisa membantu:

```java
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

class RegexSafetyTest {

    @Test
    void validator_should_not_hang_on_adversarial_input() {
        var bean = new SomeRequest("a".repeat(10_000) + "!");

        assertTimeoutPreemptively(Duration.ofMillis(200), () -> {
            ValidationTestSupport.validate(bean);
        });
    }
}
```

Gunakan timeout dengan bijak. Test timeout bisa flaky di CI lambat. Lebih baik gunakan input kecil yang tetap mewakili pattern risk.

---

## 17. Boundary Value Testing

Validation penuh dengan boundary.

Untuk angka:

- min - 1,
- min,
- min + 1,
- max - 1,
- max,
- max + 1,
- zero,
- negative,
- positive,
- overflow candidate,
- decimal scale,
- scientific notation jika input string.

Untuk string:

- length 0,
- length 1,
- length max - 1,
- length max,
- length max + 1,
- multibyte characters,
- emoji,
- combining marks,
- normalized vs non-normalized Unicode.

Untuk date/time:

- same day,
- one day before,
- one day after,
- leap day,
- end of month,
- DST boundary jika pakai timezone,
- future/past boundary dengan injected `Clock`,
- instant around midnight.

Contoh parameterized test:

```java
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class DisplayNameValidationTest {

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "\t", "\n"})
    void should_reject_blank_display_name(String value) {
        var request = new RegisterUserRequest(value, "alice@example.com");

        ValidationTestSupport.assertViolation(request, "displayName", NotBlank.class);
    }
}
```

Contoh boundary size:

```java
@Test
void should_accept_display_name_at_max_length() {
    var request = new RegisterUserRequest("A".repeat(120), "alice@example.com");

    ValidationTestSupport.assertNoViolations(request);
}

@Test
void should_reject_display_name_over_max_length() {
    var request = new RegisterUserRequest("A".repeat(121), "alice@example.com");

    ValidationTestSupport.assertViolation(request, "displayName", Size.class);
}
```

---

## 18. Temporal Validation Testing dengan Clock

Temporal validation seperti `@Past`, `@Future`, deadline validation, SLA rule, dan grace period harus memakai clock yang bisa dikontrol.

Jangan test terhadap `LocalDate.now()` langsung.

Custom policy:

```java
public final class SubmissionDeadlinePolicy {

    private final Clock clock;

    public SubmissionDeadlinePolicy(Clock clock) {
        this.clock = clock;
    }

    public boolean canSubmitUntil(LocalDate deadline) {
        LocalDate today = LocalDate.now(clock);
        return !today.isAfter(deadline);
    }
}
```

Test:

```java
@Test
void should_allow_submission_on_deadline_day() {
    Clock clock = Clock.fixed(
            Instant.parse("2026-06-16T03:00:00Z"),
            ZoneId.of("Asia/Jakarta")
    );
    var policy = new SubmissionDeadlinePolicy(clock);

    assertThat(policy.canSubmitUntil(LocalDate.of(2026, 6, 16))).isTrue();
}

@Test
void should_reject_submission_after_deadline_day() {
    Clock clock = Clock.fixed(
            Instant.parse("2026-06-17T03:00:00Z"),
            ZoneId.of("Asia/Jakarta")
    );
    var policy = new SubmissionDeadlinePolicy(clock);

    assertThat(policy.canSubmitUntil(LocalDate.of(2026, 6, 16))).isFalse();
}
```

Untuk Jakarta Validation built-in temporal constraint, provider mendukung `ClockProvider`. Jika aplikasi punya aturan waktu penting, test konfigurasi `ClockProvider`.

---

## 19. Property-Based Testing untuk Validators

Example-based test bagus untuk known cases. Namun validators sering punya domain input space besar.

Property-based testing membantu dengan cara:

- menghasilkan banyak input,
- menguji property/invariant,
- menemukan edge case yang tidak terpikir,
- shrink failing input menjadi contoh kecil.

Library JVM populer: jqwik.

Contoh property untuk `CaseReferenceValidator`:

```java
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.constraints.AlphaChars;
import net.jqwik.api.constraints.StringLength;

class CaseReferencePropertyTest {

    static class TestBean {
        @CaseReference
        String reference;

        TestBean(String reference) {
            this.reference = reference;
        }
    }

    @Property
    void arbitrary_alpha_strings_should_not_crash_validator(
            @ForAll @AlphaChars @StringLength(max = 200) String value
    ) {
        ValidationTestSupport.validate(new TestBean(value));
    }
}
```

Property yang lebih kuat:

```java
@Property
void generated_valid_references_should_be_accepted(@ForAll("validCaseReferences") String value) {
    ValidationTestSupport.assertNoViolations(new TestBean(value));
}

@Provide
Arbitrary<String> validCaseReferences() {
    Arbitrary<String> date = Arbitraries.integers()
            .between(20200101, 20261231)
            .map(String::valueOf);

    Arbitrary<String> suffix = Arbitraries.strings()
            .withChars("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
            .ofLength(6);

    return Combinators.combine(date, suffix)
            .as((d, s) -> "CASE-" + d + "-" + s);
}
```

Property-based testing cocok untuk:

- parser/format validator,
- normalization validator,
- date range rules,
- ID/reference format,
- string escaping/log safety,
- numeric boundary,
- custom container validation,
- policy composition.

Tidak cocok jika:

- rule sangat sederhana dan input space kecil,
- generator lebih kompleks dari logic yang dites,
- property tidak jelas,
- test menjadi lambat dan flaky.

Rule penting:

> Property-based testing tidak menggantikan example-based testing. Ia melengkapi dengan eksplorasi input space.

---

## 20. Mutation Testing untuk Validation Rules

Mutation testing menguji kualitas test dengan mengubah code kecil-kecilan lalu melihat apakah test gagal.

Contoh mutation:

Original:

```java
return !start.isAfter(end);
```

Mutant:

```java
return start.isAfter(end);
```

Jika test tetap pass, test tidak menangkap bug.

Pitest/PIT adalah tool mutation testing populer untuk Java. PIT bisa dijalankan via Maven/Gradle/command line dan memutasi bytecode lalu menjalankan test suite.

Maven contoh minimal:

```xml
<plugin>
    <groupId>org.pitest</groupId>
    <artifactId>pitest-maven</artifactId>
    <version>${pitest.version}</version>
    <configuration>
        <targetClasses>
            <param>com.example.validation.*</param>
            <param>com.example.policy.*</param>
        </targetClasses>
        <targetTests>
            <param>com.example.validation.*Test</param>
            <param>com.example.policy.*Test</param>
        </targetTests>
    </configuration>
</plugin>
```

Mutation testing sangat berguna untuk validation karena bug biasanya berupa:

- `>` menjadi `>=`,
- `&&` menjadi `||`,
- return true/false dibalik,
- boundary min/max salah,
- null condition dihapus,
- branch missing,
- date comparison salah,
- error mapping branch tidak dites.

Contoh date range validator yang perlu mutation test:

```java
boolean valid = !startDate.isAfter(endDate);
```

Test harus membunuh mutant:

- `start < end` valid,
- `start == end` valid atau invalid sesuai desain,
- `start > end` invalid.

Jika hanya test `start < end` dan `start > end`, mutant untuk equality bisa survive. Maka boundary equality harus eksplisit.

Praktik baik:

- jalankan mutation test untuk module validation/policy, tidak harus seluruh monolith setiap PR,
- gunakan nightly/CI scheduled jika lambat,
- fokus pada custom validators dan domain policies,
- jangan mengejar 100% mutation score buta,
- review surviving mutants yang relevan,
- abaikan equivalent mutant dengan alasan terdokumentasi.

---

## 21. Testing Database Constraint Boundary

Bean Validation tidak menggantikan database constraints.

Untuk uniqueness:

```java
@Entity
@Table(
    name = "users",
    uniqueConstraints = @UniqueConstraint(name = "uk_users_email", columnNames = "email")
)
public class UserEntity {
    // ...
}
```

Application-level validation boleh memberi early feedback, tetapi database tetap final authority.

Integration test:

```java
@Test
void database_should_reject_duplicate_email_even_if_application_validation_passes() {
    userRepository.saveAndFlush(new UserEntity("alice@example.com"));

    userRepository.save(new UserEntity("alice@example.com"));

    assertThatThrownBy(() -> entityManager.flush())
            .isInstanceOf(PersistenceException.class);
}
```

Test mapper DB constraint:

```java
@Test
void should_map_unique_email_constraint_to_conflict_error() {
    var exception = new DatabaseConstraintViolation("uk_users_email");

    ApiError error = mapper.map(exception);

    assertThat(error.status()).isEqualTo(409);
    assertThat(error.code()).isEqualTo("USER_EMAIL_ALREADY_EXISTS");
}
```

Untuk race condition, concurrency test bisa dibuat, tetapi jangan terlalu flaky.

Contoh intent:

```text
Thread A validates email available.
Thread B validates email available.
Thread A inserts.
Thread B inserts.
DB unique constraint rejects one.
Application maps rejection to 409 conflict.
```

Yang wajib dites:

- DB constraint benar-benar ada,
- application bisa menangani violation,
- error code stabil,
- tidak berubah menjadi 500 internal server error,
- tidak membocorkan nama constraint internal jika itu tidak boleh diekspos.

---

## 22. Testing Workflow / Policy Validation

Workflow validation tidak ideal jika dites lewat annotation. Lebih baik policy object dengan result eksplisit.

Contoh:

```java
public final class SubmitCasePolicy {

    public RuleDecision evaluate(SubmitCaseContext context) {
        RuleDecision decision = RuleDecision.allow();

        if (!context.caseStatus().equals(CaseStatus.DRAFT)) {
            decision = decision.reject(RuleViolation.blocking(
                    "CASE_SUBMIT_STATUS_INVALID",
                    "Case must be in draft status before submission",
                    "status",
                    Map.of("currentStatus", context.caseStatus().name())
            ));
        }

        if (!context.hasRequiredDocuments()) {
            decision = decision.reject(RuleViolation.blocking(
                    "CASE_SUBMIT_DOCUMENTS_MISSING",
                    "Required documents are missing",
                    "documents",
                    Map.of("missingDocumentTypes", context.missingDocumentTypes())
            ));
        }

        return decision;
    }
}
```

Test:

```java
@Test
void should_reject_submission_when_case_is_not_draft() {
    var context = SubmitCaseContextBuilder.valid()
            .caseStatus(CaseStatus.SUBMITTED)
            .build();

    RuleDecision decision = policy.evaluate(context);

    assertThat(decision.allowed()).isFalse();
    assertThat(decision.violations())
            .extracting(RuleViolation::code)
            .contains("CASE_SUBMIT_STATUS_INVALID");
}

@Test
void should_reject_submission_when_required_documents_are_missing() {
    var context = SubmitCaseContextBuilder.valid()
            .missingDocumentTypes(List.of("IDENTITY_PROOF"))
            .build();

    RuleDecision decision = policy.evaluate(context);

    assertThat(decision.allowed()).isFalse();
    assertThat(decision.violations())
            .anySatisfy(v -> {
                assertThat(v.code()).isEqualTo("CASE_SUBMIT_DOCUMENTS_MISSING");
                assertThat(v.target()).isEqualTo("documents");
                assertThat(v.evidence()).containsKey("missingDocumentTypes");
            });
}
```

Untuk policy validation, assert:

- allow/reject,
- blocking vs warning,
- rule code,
- rule version jika ada,
- target field/object/action,
- evidence cukup,
- remediation jika API menampilkan,
- enforcement mode,
- audit event yang dihasilkan.

---

## 23. Testing Event Validation

Event validation harus membedakan:

- invalid payload permanen,
- unsupported version,
- missing reference sementara,
- duplicate event,
- stale event,
- out-of-order event,
- dependency unavailable.

Contoh result:

```java
public enum EventValidationOutcome {
    ACCEPT,
    REJECT_PERMANENT,
    RETRY_LATER,
    IGNORE_DUPLICATE,
    IGNORE_STALE
}
```

Test:

```java
@Test
void should_reject_permanently_when_event_payload_shape_is_invalid() {
    var event = CaseSubmittedEventBuilder.valid()
            .caseReference("")
            .build();

    EventValidationResult result = validator.validate(event);

    assertThat(result.outcome()).isEqualTo(EventValidationOutcome.REJECT_PERMANENT);
    assertThat(result.errorCode()).isEqualTo("EVENT_CASE_REFERENCE_INVALID");
}

@Test
void should_retry_when_reference_data_is_temporarily_unavailable() {
    referenceClient.stubUnavailable();

    var event = CaseSubmittedEventBuilder.valid().build();

    EventValidationResult result = validator.validate(event);

    assertThat(result.outcome()).isEqualTo(EventValidationOutcome.RETRY_LATER);
}
```

Testing DLQ mapping:

- invalid schema goes to DLQ/rejection topic,
- transient dependency does not go directly to DLQ,
- duplicate does not create noise,
- rejected event includes correlation id/event id,
- PII is redacted,
- event version included.

---

## 24. Testing Batch / Import Validation

Batch validation berbeda dari single API validation.

Single API biasanya fail request.
Batch biasanya mengumpulkan banyak error.

Contoh result:

```java
public record RowValidationError(
        int rowNumber,
        String column,
        String code,
        String message
) {}
```

Test:

```java
@Test
void should_collect_errors_for_multiple_rows_instead_of_failing_fast() {
    List<ImportRow> rows = List.of(
            new ImportRow(1, "alice@example.com"),
            new ImportRow(2, "bad-email"),
            new ImportRow(3, "")
    );

    ImportValidationReport report = validator.validate(rows);

    assertThat(report.errors())
            .extracting(RowValidationError::rowNumber)
            .containsExactlyInAnyOrder(2, 3);
}
```

Yang harus dites:

- row number benar,
- column mapping benar,
- error code stabil,
- limit error diterapkan agar tidak menghasilkan report raksasa,
- duplicate detection antar row,
- duplicate terhadap database,
- partial accept/reject policy,
- file-level error vs row-level error,
- encoding/CSV injection handling,
- summary count benar.

---

## 25. Testing PATCH dan Presence-Aware Validation

PATCH adalah sumber bug validation yang sangat umum.

Contoh wrapper:

```java
public sealed interface PatchField<T> permits PatchField.Absent, PatchField.Present {

    record Absent<T>() implements PatchField<T> {}

    record Present<T>(T value) implements PatchField<T> {}

    static <T> PatchField<T> absent() {
        return new Absent<>();
    }

    static <T> PatchField<T> present(T value) {
        return new Present<>(value);
    }
}
```

Patch DTO:

```java
public class UpdateProfilePatch {
    private PatchField<@NotBlank String> displayName = PatchField.absent();
    private PatchField<@Email String> email = PatchField.absent();
}
```

Test cases:

```java
@Test
void should_accept_absent_field() {
    var patch = new UpdateProfilePatch();

    ValidationTestSupport.assertNoViolations(patch);
}

@Test
void should_reject_present_blank_display_name() {
    var patch = new UpdateProfilePatch();
    patch.setDisplayName(PatchField.present(" "));

    ValidationTestSupport.assertViolation(patch, "displayName", NotBlank.class);
}

@Test
void should_distinguish_present_null_from_absent() {
    var patch = new UpdateProfilePatch();
    patch.setDisplayName(PatchField.present(null));

    // Expected behavior depends on product semantics.
    // Test must make the semantics explicit.
}
```

PATCH test harus eksplisit terhadap:

- absent,
- present valid,
- present invalid,
- present null as clear,
- present null as invalid,
- unknown field,
- empty patch,
- optimistic locking/version,
- conditional validation only for modified fields.

---

## 26. Test Data Builders untuk Validation

Validation tests mudah menjadi noisy jika setiap test membuat object lengkap.

Gunakan builder valid-by-default.

```java
public final class RegisterUserRequestBuilder {

    private String displayName = "Alice";
    private String email = "alice@example.com";

    private RegisterUserRequestBuilder() {
    }

    public static RegisterUserRequestBuilder valid() {
        return new RegisterUserRequestBuilder();
    }

    public RegisterUserRequestBuilder displayName(String displayName) {
        this.displayName = displayName;
        return this;
    }

    public RegisterUserRequestBuilder email(String email) {
        this.email = email;
        return this;
    }

    public RegisterUserRequest build() {
        return new RegisterUserRequest(displayName, email);
    }
}
```

Test jadi jelas:

```java
@Test
void should_reject_blank_email() {
    var request = RegisterUserRequestBuilder.valid()
            .email(" ")
            .build();

    ValidationTestSupport.assertViolation(request, "email", NotBlank.class);
}
```

Prinsip:

- builder default harus valid,
- setiap test hanya mengubah satu concern,
- invalid builder harus diberi nama jelas,
- jangan sembunyikan rule penting di builder,
- builder untuk domain policy harus bisa membuat context edge-case.

---

## 27. Regression Test untuk Rule Changes

Setiap perubahan rule harus menjawab:

- rule apa yang berubah,
- client mana terdampak,
- existing data mana terdampak,
- batch/event mana terdampak,
- warning phase diperlukan atau tidak,
- error code berubah atau tetap,
- migration test apa yang perlu ditambah.

Contoh perubahan:

```text
Sebelum:
- phone optional

Sesudah:
- phone required untuk applicant type INDIVIDUAL
```

Test wajib:

```java
@Test
void individual_applicant_should_require_phone() {
    var request = ApplicationRequestBuilder.valid()
            .applicantType(ApplicantType.INDIVIDUAL)
            .phone(null)
            .build();

    var decision = policy.evaluate(request);

    assertThat(decision.violations())
            .extracting(RuleViolation::code)
            .contains("APPLICATION_PHONE_REQUIRED_FOR_INDIVIDUAL");
}

@Test
void company_applicant_should_not_require_phone_if_rule_does_not_apply() {
    var request = ApplicationRequestBuilder.valid()
            .applicantType(ApplicantType.COMPANY)
            .phone(null)
            .build();

    var decision = policy.evaluate(request);

    assertThat(decision.violations())
            .extracting(RuleViolation::code)
            .doesNotContain("APPLICATION_PHONE_REQUIRED_FOR_INDIVIDUAL");
}
```

Tambahkan test compatibility:

- old API client payload,
- old event version,
- old draft data,
- existing DB row update,
- partial patch.

---

## 28. Snapshot / Golden File untuk Rule Catalog

Jika sistem memiliki rule catalog, test bisa memastikan tidak ada rule hilang tanpa sengaja.

Contoh rule catalog:

```json
[
  {
    "code": "CASE_SUBMIT_STATUS_INVALID",
    "severity": "ERROR",
    "target": "status",
    "messageKey": "case.submit.status.invalid"
  },
  {
    "code": "CASE_SUBMIT_DOCUMENTS_MISSING",
    "severity": "ERROR",
    "target": "documents",
    "messageKey": "case.submit.documents.missing"
  }
]
```

Test:

```java
@Test
void rule_catalog_should_match_golden_file() {
    String actual = ruleCatalogExporter.exportAsJson();
    String expected = readResource("rule-catalog/case-submit-rules.json");

    assertThatJson(actual).isEqualTo(expected);
}
```

Namun golden file bukan pengganti review. Ia hanya alarm untuk perubahan kontrak.

---

## 29. Testing Observability

Validation observability perlu dites jika metric/log/audit menjadi requirement.

Metric yang umum:

- validation failure count,
- failure by endpoint,
- failure by rule code,
- failure by field/path,
- failure by client/channel,
- policy reject/warning count,
- DLQ validation rejection count,
- validation latency.

Test bisa memakai fake metrics registry.

```java
@Test
void should_record_validation_failure_metric_by_rule_code() {
    var registry = new InMemoryMetricsRegistry();
    var mapper = new ValidationErrorMapper(registry);

    mapper.map(List.of(fakeViolation("email", "USER_EMAIL_INVALID")));

    assertThat(registry.counter("validation.failure", "code", "USER_EMAIL_INVALID"))
            .isEqualTo(1);
}
```

Audit test:

```java
@Test
void should_emit_audit_event_when_workflow_policy_rejects_action() {
    var auditSink = new InMemoryAuditSink();
    var service = new SubmitCaseService(policy, auditSink);

    service.submit(invalidCommand());

    assertThat(auditSink.events())
            .anySatisfy(event -> {
                assertThat(event.type()).isEqualTo("CASE_SUBMIT_REJECTED");
                assertThat(event.ruleCodes()).contains("CASE_SUBMIT_STATUS_INVALID");
                assertThat(event.actorId()).isNotBlank();
            });
}
```

---

## 30. Testing Performance Without Making CI Flaky

Performance validation test harus hati-hati.

Yang sebaiknya dites di unit/CI reguler:

- no catastrophic regex on representative adversarial input,
- no accidental DB call in pure validator,
- large collection limit rejects early,
- fail-fast/group sequence avoids expensive validator,
- batch validation caps error count.

Yang lebih cocok untuk benchmark terpisah:

- exact latency p95,
- allocation rate,
- comparison fail-fast vs full accumulation,
- large object graph traversal,
- message interpolation overhead.

Contoh non-flaky guard:

```java
@Test
void should_reject_too_many_items_before_validating_each_item() {
    var request = new BulkInviteRequest(generateEmails(10_000));

    var result = bulkValidator.validate(request);

    assertThat(result.violations())
            .extracting(RuleViolation::code)
            .contains("BULK_INVITE_TOO_MANY_ITEMS");

    assertThat(fakeEmailFormatValidator.invocationCount()).isZero();
}
```

Ini lebih stabil daripada assert harus selesai dalam 50ms.

---

## 31. Test Matrix untuk Validation

Gunakan matrix berikut saat membuat atau mereview validation rule.

| Concern | Example Test |
|---|---|
| Valid happy path | valid object has no violations |
| Requiredness | null/absent rejected or accepted as designed |
| Empty/blank | `""`, `" "`, tabs/newline |
| Boundary min/max | min-1, min, max, max+1 |
| Format | valid/invalid representative examples |
| Unicode | NBSP, zero-width, emoji, combining char |
| Cross-field | valid combination, invalid combination, missing dependency |
| Group | default, create, update, submit, sequence |
| Cascade | nested valid/invalid, list index/map key path |
| PATCH | absent, present null, present invalid |
| Message | key found, interpolation correct, no PII |
| API mapping | status, path, code, severity, problem type |
| DB boundary | unique/check/not-null FK enforced and mapped |
| Workflow | state, actor, action, role, time, evidence |
| Event | invalid, unsupported version, stale, duplicate, retryable |
| Security | XSS-like, SQL-like, path traversal-like, log forging |
| Performance | no expensive validator when cheap rule fails |
| Mutation | boundary mutants killed |
| Observability | metric/log/audit emitted safely |

---

## 32. Anti-Patterns dalam Testing Validation

### 32.1 Hanya Test Happy Path

```java
assertNoViolations(validRequest);
```

Ini tidak membuktikan rule menolak input invalid.

### 32.2 Assert Message Literal Provider

```java
assertThat(message).isEqualTo("must not be blank");
```

Rapuh. Lebih baik assert code/path/constraint type.

### 32.3 Semua Dites Lewat Controller

Controller test penting, tetapi tidak semua validation rule harus dites lewat HTTP.

Dampaknya:

- lambat,
- sulit debug,
- banyak duplication,
- flaky,
- sulit mutation test.

### 32.4 Tidak Test Default Group

Bug umum: endpoint lupa `@Validated(Create.class)` lalu rule create tidak aktif.

### 32.5 Tidak Test Null Convention

Custom format validator sering tidak sengaja menolak null.

### 32.6 Tidak Test Equality Boundary

Date range, numeric min/max, dan SLA sering bug pada equality.

### 32.7 Test Mengunci Urutan Violations Tanpa Alasan

Set violation tidak selalu urut sesuai expectation. Jangan assert urutan kecuali mapper memang mengurutkan.

### 32.8 Tidak Test Error Mapping

Constraint benar, tetapi API error salah. Client tetap rusak.

### 32.9 Tidak Test Race dengan Database Constraint

Uniqueness check hanya di validator memberi false confidence.

### 32.10 Tidak Test PII Leakage

Rejected value terlihat di response/log. Ini bug keamanan, bukan cosmetic issue.

---

## 33. Production-Grade Validation Testing Strategy

Untuk codebase besar, struktur test bisa seperti ini:

```text
src/test/java
  com.example.validation.constraint
    CaseReferenceConstraintTest
    PostalCodeConstraintTest
    ByteLengthConstraintTest

  com.example.validation.dto
    CreateCaseRequestValidationTest
    UpdateCasePatchValidationTest
    SubmitApplicationRequestValidationTest

  com.example.validation.mapping
    ConstraintViolationToApiErrorMapperTest
    ViolationPathNormalizerTest
    SensitiveRejectedValueRedactorTest

  com.example.policy.caseflow
    SubmitCasePolicyTest
    ApproveCasePolicyTest
    ReopenCasePolicyTest

  com.example.web
    CaseControllerValidationContractTest
    GlobalValidationExceptionHandlerTest

  com.example.persistence
    UserDatabaseConstraintIntegrationTest
    CaseDatabaseConstraintIntegrationTest

  com.example.event
    CaseEventValidationTest
    EventRejectionMappingTest
```

CI strategy:

```text
Every PR:
- unit tests for constraints, DTOs, policies, mappers
- selected web validation tests
- selected DB constraint tests

Nightly / scheduled:
- full integration tests
- mutation testing for validation/policy packages
- property-based tests with larger sample count
- performance/regex guard tests

Before release:
- API error contract tests
- backward compatibility tests
- rule catalog diff
- migration tests for existing data/drafts/events
```

---

## 34. Java 8 sampai Java 25 Notes

### Java 8

- Bean Validation 2.0 era masih relevan.
- Type-use constraints dan container element constraints tersedia sejak Bean Validation 2.0.
- JUnit 5 bisa digunakan, tetapi banyak legacy project masih JUnit 4.
- Records/sealed classes belum tersedia.
- Model PATCH presence-aware perlu class biasa.

### Java 11

- Banyak enterprise system stabil di Java 11.
- Masih umum memakai `javax.validation` pada Spring Boot 2 / Jakarta EE 8 style.
- Migration test penting sebelum pindah ke `jakarta.validation`.

### Java 17

- Baseline penting untuk banyak stack modern.
- Jakarta Validation 3.1 / Jakarta EE 11 baseline Java 17.
- Records dan sealed classes mulai practical untuk DTO/policy modeling.

### Java 21

- LTS modern.
- Virtual threads tidak mengubah semantic validation, tetapi membuat DB/external-call validator makin harus dipikirkan karena blocking validator dapat memperbanyak load ke dependency.
- Pattern matching membuat domain/policy tests lebih expressive.

### Java 25

- Target modern untuk code style dan runtime terbaru.
- Prinsip testing tetap sama.
- Hindari mengikat validation correctness pada fitur bahasa terbaru jika library/module masih harus kompatibel Java 8/11.
- Untuk shared validation library lintas aplikasi, tentukan baseline Java dengan sadar.

---

## 35. Migration Testing: `javax.validation` ke `jakarta.validation`

Saat migrasi:

```text
javax.validation.* -> jakarta.validation.*
```

Test harus memastikan:

- constraint masih aktif,
- custom constraint annotation sudah pindah package,
- custom validator sudah pindah package,
- message bundle masih ditemukan,
- groups masih sama,
- payload/severity masih sama,
- framework integration masih memanggil validator,
- method validation masih aktif,
- exception mapper masih menangkap exception package baru,
- API error contract tidak berubah kecuali disengaja.

Regression test penting:

```java
@Test
void migrated_jakarta_validation_should_still_reject_invalid_create_case_request() {
    var request = CreateCaseRequestBuilder.valid()
            .caseReference("bad")
            .build();

    ValidationTestSupport.assertViolation(request, "caseReference", CaseReference.class);
}
```

Framework-level test:

```java
@Test
void migrated_controller_should_still_return_validation_problem_details() throws Exception {
    mockMvc.perform(post("/cases")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{}"))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.violations").isArray());
}
```

---

## 36. Checklist PR untuk Validation Test

Saat review PR yang menambah/mengubah validation rule, tanyakan:

1. Apakah rule ini berada di layer yang benar?
2. Apakah ada unit test untuk valid dan invalid case?
3. Apakah null/absent behavior jelas?
4. Apakah empty/blank behavior dites?
5. Apakah boundary min/max/equality dites?
6. Apakah cross-field dependency dites?
7. Apakah validation group yang benar dites?
8. Apakah API error code/path/status dites?
9. Apakah message tidak dijadikan sumber machine contract?
10. Apakah rejected value sensitif disembunyikan?
11. Apakah DB constraint final consistency dites jika relevan?
12. Apakah race condition uniqueness dipertimbangkan?
13. Apakah event/batch/client compatibility terdampak?
14. Apakah mutation/property-based test diperlukan?
15. Apakah observability/audit requirement dites?
16. Apakah migration `javax`/`jakarta` terdampak?
17. Apakah rule catalog/error catalog diperbarui?
18. Apakah test tidak terlalu bergantung pada provider-specific raw path kecuali disengaja?
19. Apakah test cukup cepat untuk PR pipeline?
20. Apakah test menjelaskan business intent, bukan hanya implementation detail?

---

## 37. Ringkasan Mental Model

Testing validation bukan sekadar memastikan annotation bekerja.

Yang diuji adalah:

- **shape contract**: data bentuknya benar,
- **semantic contract**: kombinasi field masuk akal,
- **operation contract**: create/update/submit punya aturan berbeda,
- **workflow contract**: action legal untuk state dan actor tertentu,
- **API contract**: client menerima error stabil,
- **security contract**: input buruk tidak menjadi leakage/abuse,
- **persistence contract**: database tetap final consistency guard,
- **event contract**: invalid event diklasifikasikan benar,
- **audit contract**: penolakan bisa dijelaskan,
- **evolution contract**: rule bisa berubah tanpa merusak sistem secara diam-diam.

Top-tier engineer tidak hanya menulis:

```java
@NotBlank
private String name;
```

Ia juga memastikan:

- rule itu berada di layer yang tepat,
- behavior null/blank/boundary jelas,
- error code stabil,
- test menangkap regression,
- mutation test membuktikan boundary penting tidak kosong,
- PII tidak bocor,
- DB final authority tetap ada,
- workflow rule tidak tersembunyi di annotation,
- client dan auditor bisa memahami hasilnya.

---

## 38. Latihan Praktis

### Latihan 1 — DTO Constraint Test

Buat DTO `CreateApplicationRequest` dengan field:

- `applicantName`: required, not blank, max 120.
- `email`: optional, but if present must be valid email.
- `applicationType`: required enum.
- `submittedDate`: must be today or past.

Tulis test untuk:

- valid request,
- null applicant name,
- blank applicant name,
- applicant name too long,
- invalid email,
- null application type,
- future submitted date.

### Latihan 2 — Cross-Field Constraint Test

Buat rule:

```text
If applicationType = COMPANY, companyRegistrationNumber is required.
If applicationType = INDIVIDUAL, identityNumber is required.
```

Tulis test untuk:

- company valid,
- company missing registration number,
- individual valid,
- individual missing identity number,
- violation path yang benar.

### Latihan 3 — API Error Contract Test

Buat response error validation dengan shape:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "traceId": "...",
  "violations": [
    {
      "path": "applicantName",
      "code": "APPLICATION_APPLICANT_NAME_REQUIRED",
      "severity": "ERROR",
      "message": "Applicant name is required"
    }
  ]
}
```

Tulis test yang memastikan:

- status 422,
- `traceId` ada,
- `violations` array,
- code stabil,
- path stabil,
- rejected value sensitif tidak muncul.

### Latihan 4 — Policy Rule Mutation Target

Buat policy:

```text
Case can be submitted only when status = DRAFT and required documents are complete.
```

Tulis test untuk membunuh mutant:

- `DRAFT` diganti `SUBMITTED`,
- `&&` diganti `||`,
- `hasRequiredDocuments()` dibalik,
- equality boundary jika ada date/deadline.

### Latihan 5 — Event Validation Classification

Buat validator event yang menghasilkan outcome:

- `ACCEPT`,
- `REJECT_PERMANENT`,
- `RETRY_LATER`,
- `IGNORE_DUPLICATE`,
- `IGNORE_STALE`.

Tulis test untuk semua outcome.

---

## 39. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation Home: https://beanvalidation.org/
- Hibernate Validator Reference Guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator Project: https://hibernate.org/validator/
- jqwik: https://jqwik.net/
- jqwik User Guide: https://jqwik.net/docs/current/user-guide.html
- PIT / Pitest Quickstart: https://pitest.org/quickstart/
- PIT Maven Quickstart: https://pitest.org/quickstart/maven/
- JUnit 5 User Guide: https://junit.org/junit5/docs/current/user-guide/
- AssertJ: https://assertj.github.io/doc/
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

## 40. Status Seri

Seri **belum selesai**.

Bagian ini adalah:

```text
Part 026 — Testing Validation: Unit, Integration, Contract, Mutation, and Property-Based Tests
```

Bagian berikutnya:

```text
Part 027 — Migration Playbook: Javax to Jakarta, Spring Boot 2→3, HV 6→9
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Security and Abuse Resistance: Validation Is Not Sanitization](./learn-java-validation-jakarta-hibernate-validator-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Migration Playbook: `javax.validation` ke `jakarta.validation`, Spring Boot 2→3, Hibernate Validator 6→9](./learn-java-validation-jakarta-hibernate-validator-part-027.md)
