# learn-java-validation-jakarta-hibernate-validator-part-011

# Cross-Parameter and Executable Validation: Methods, Constructors, Return Values

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `011`  
> Target: Java 8 sampai Java 25  
> Fokus: Jakarta/Javax Validation, Bean Validation, Hibernate Validator, executable validation, method contracts, constructor contracts, return value guarantees, cross-parameter consistency, framework proxy behavior, dan production-grade design.

---

## 1. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- built-in constraint,
- nullability strategy,
- cascaded validation,
- container element constraint,
- validation groups,
- group sequence,
- custom constraint,
- class-level dan cross-field validation.

Bagian ini naik satu level lagi: **validation tidak hanya ditempel pada object/field, tetapi juga pada executable boundary**.

Dalam Jakarta Validation/Bean Validation, “executable” berarti:

- method,
- constructor.

Yang bisa divalidasi:

- parameter method,
- parameter constructor,
- kombinasi beberapa parameter atau cross-parameter,
- return value method,
- return value constructor,
- nested/cascaded return value,
- container element pada parameter/return value.

Mental modelnya:

```text
Object validation:
  Apakah object ini valid sebagai state/data structure?

Executable validation:
  Apakah pemanggilan operasi ini valid sebagai kontrak?

Parameter validation:
  Apakah caller memberikan input yang sah?

Return value validation:
  Apakah callee memenuhi janji output-nya?

Cross-parameter validation:
  Apakah kombinasi argumen yang diberikan caller konsisten?
```

Executable validation membawa Bean/Jakarta Validation mendekati konsep **Design by Contract**:

- precondition: constraint pada parameter,
- postcondition: constraint pada return value,
- construction invariant: constraint pada constructor parameter dan constructed object.

Tetapi harus dipakai hati-hati. Jika semua business workflow dipaksa masuk ke method annotation, sistem akan sulit dipahami, sulit dites, dan rawan proxy trap.

---

## 2. Referensi Resmi dan Version Context

Jakarta Validation 3.1 mendefinisikan metadata model dan API untuk JavaBean dan method validation. Release ini adalah bagian dari Jakarta EE 11 dan memperjelas dukungan Java Records.

Bean Validation 2.0 adalah titik penting untuk Java 8 karena memperkenalkan container element constraints dan dukungan type-use validation modern, sehingga constraint bisa ditempatkan pada type argument seperti `List<@NotBlank String>`.

Hibernate Validator adalah reference implementation yang menyediakan dukungan executable validation, cross-parameter constraint, provider-specific extension, dan integrasi framework. Hibernate Validator 9.x menargetkan Jakarta Validation 3.1/Jakarta EE 11 dan menggunakan namespace `jakarta.validation.*`.

Secara praktis:

| Era | Namespace | Umum Dipakai Dengan | Catatan |
|---|---|---|---|
| Java 8 legacy | `javax.validation.*` | Bean Validation 1.1/2.0, Hibernate Validator 5/6 | Banyak aplikasi Spring Boot 2 dan Java EE/Jakarta EE lama |
| Java 11/17 migration | transisi | HV 6/7/8 tergantung stack | Risiko mixed `javax`/`jakarta` tinggi |
| Java 17+ modern Jakarta | `jakarta.validation.*` | Jakarta Validation 3.x, Spring Boot 3+, Jakarta EE 10/11 | Package rename wajib |
| Java 21/25 modern platform | `jakarta.validation.*` | HV 8/9+, modern Spring/Jakarta | Records, sealed model, immutable DTO semakin umum |

Bagian ini akan menggunakan contoh `jakarta.validation.*`, tetapi pola konseptualnya sama untuk `javax.validation.*` pada Java 8 legacy. Untuk legacy, ubah import-nya saja; jangan mencampur dua namespace dalam satu validation boundary.

---

## 3. Masalah Yang Diselesaikan Executable Validation

Field/class validation menjawab:

```java
record CreateAppealRequest(
    @NotBlank String caseReferenceNo,
    @NotBlank String reason
) {}
```

Ini bagus untuk validasi bentuk data. Tetapi ada operasi yang kontraknya lebih tepat ditempel pada method:

```java
public Appeal createAppeal(
        @NotBlank String caseReferenceNo,
        @NotBlank String reason,
        @NotNull Actor actor) {
    ...
}
```

Di sini annotation mendefinisikan kontrak operasi:

- `caseReferenceNo` tidak boleh kosong,
- `reason` tidak boleh kosong,
- `actor` wajib ada.

Tanpa executable validation, annotation pada parameter method hanyalah metadata. Annotation itu tidak otomatis dievaluasi kecuali:

- dipanggil secara manual lewat `ExecutableValidator`, atau
- framework seperti Spring/Jakarta EE/CDI/JAX-RS mengaktifkan method validation.

Ini poin penting:

```text
Annotation pada method parameter bukan magic.
Ia baru menjadi enforcement jika ada validation interceptor/proxy/manual call.
```

---

## 4. Bentuk-Bentuk Executable Validation

Executable validation mencakup beberapa bentuk.

### 4.1 Parameter Constraint

```java
public CaseFile findCase(@NotBlank String caseReferenceNo) {
    ...
}
```

Artinya caller tidak boleh memanggil method dengan `null`, kosong, atau blank.

### 4.2 Multiple Parameter Constraints

```java
public List<CaseFile> searchCases(
        @NotNull LocalDate from,
        @NotNull LocalDate to,
        @Size(max = 50) List<@NotBlank String> statuses) {
    ...
}
```

Setiap parameter divalidasi sendiri-sendiri.

### 4.3 Cross-Parameter Constraint

```java
@ValidDateRangeParameters
public List<CaseFile> searchCases(LocalDate from, LocalDate to) {
    ...
}
```

Artinya kombinasi parameter harus konsisten, misalnya `from <= to`.

### 4.4 Return Value Constraint

```java
@NotNull
public CaseFile findCase(@NotBlank String caseReferenceNo) {
    ...
}
```

Artinya method tidak boleh mengembalikan `null`.

### 4.5 Cascaded Return Value Validation

```java
@Valid
public CaseSummaryDto getSummary(@NotBlank String caseReferenceNo) {
    ...
}
```

Return object divalidasi sebagai object graph.

### 4.6 Container Element Return Value Constraint

```java
public List<@Valid CaseSummaryDto> listCases(@NotNull Actor actor) {
    ...
}
```

Setiap element list divalidasi.

### 4.7 Constructor Parameter Validation

```java
public CaseReference(@NotBlank String value) {
    this.value = value;
}
```

Constructor parameter bisa divalidasi lewat `ExecutableValidator` atau framework yang mendukung.

### 4.8 Constructor Return Value Validation

Constructor return value terdengar aneh karena constructor tidak memiliki return type eksplisit. Dalam model Bean Validation, constructed object dapat menjadi target return value validation dari constructor, terutama untuk cascaded validation atau constraint pada constructed object.

---

## 5. Design by Contract Mental Model

Executable validation paling mudah dipahami sebagai kontrak antara caller dan callee.

```text
Caller responsibility:
  Memenuhi parameter constraints.

Callee responsibility:
  Menghasilkan return value yang memenuhi return constraints.

Validation framework responsibility:
  Mengecek kontrak pada boundary yang tepat.
```

Contoh:

```java
@NotNull
public DecisionResult approve(
        @NotNull CaseId caseId,
        @NotNull OfficerId officerId,
        @NotBlank String approvalReason) {
    ...
}
```

Kontraknya:

```text
Precondition:
  caseId != null
  officerId != null
  approvalReason tidak blank

Postcondition:
  result != null
```

Tetapi jangan salah tarik batas:

```text
Valid executable constraint:
  parameter tidak null, format benar, range dasar benar.

Bukan executable constraint ideal:
  officer punya authority approval?
  case masih dalam state approvable?
  semua mandatory evidence sudah attached?
  SLA masih valid?
```

Yang kedua lebih cocok menjadi:

- domain policy,
- workflow transition guard,
- authorization service,
- application service rule,
- database consistency rule.

---

## 6. Manual Executable Validation Dengan `ExecutableValidator`

Core API-nya ada di:

```java
jakarta.validation.executable.ExecutableValidator
```

Biasanya didapat dari:

```java
Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
ExecutableValidator executableValidator = validator.forExecutables();
```

### 6.1 Validate Method Parameters

```java
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.executable.ExecutableValidator;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.lang.reflect.Method;
import java.util.Set;

public class CaseQueryService {

    public CaseFile findCase(@NotBlank String caseReferenceNo, @NotNull Actor actor) {
        return new CaseFile(caseReferenceNo);
    }
}

class ManualMethodParameterValidationExample {

    public static void main(String[] args) throws Exception {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
        ExecutableValidator executableValidator = validator.forExecutables();

        CaseQueryService target = new CaseQueryService();
        Method method = CaseQueryService.class.getMethod(
                "findCase",
                String.class,
                Actor.class
        );

        Object[] parameterValues = {"   ", null};

        Set<ConstraintViolation<CaseQueryService>> violations =
                executableValidator.validateParameters(target, method, parameterValues);

        for (ConstraintViolation<CaseQueryService> violation : violations) {
            System.out.println(violation.getPropertyPath() + " => " + violation.getMessage());
        }
    }
}

record Actor(String id) {}
record CaseFile(String caseReferenceNo) {}
```

Expected conceptual output:

```text
findCase.arg0 => must not be blank
findCase.arg1 => must not be null
```

Parameter names may appear as `arg0`, `arg1` unless your build retains parameter names with `-parameters` or the provider/framework supplies a parameter name provider.

### 6.2 Validate Method Return Value

```java
import jakarta.validation.constraints.NotNull;

public class CaseQueryService {

    @NotNull
    public CaseFile findCase(String caseReferenceNo) {
        return null; // bug
    }
}
```

Manual validation:

```java
CaseQueryService target = new CaseQueryService();
Method method = CaseQueryService.class.getMethod("findCase", String.class);
Object returnValue = target.findCase("CASE-001");

Set<ConstraintViolation<CaseQueryService>> violations =
        executableValidator.validateReturnValue(target, method, returnValue);
```

Return value constraints represent callee obligations. A return value violation usually means a bug in your implementation, not bad user input.

That distinction matters for error handling:

```text
Parameter violation:
  Usually client/caller error.

Return value violation:
  Usually server/provider error.
```

### 6.3 Validate Constructor Parameters

```java
import jakarta.validation.constraints.NotBlank;

public final class CaseReference {
    private final String value;

    public CaseReference(@NotBlank String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Manual validation:

```java
Constructor<CaseReference> constructor = CaseReference.class.getConstructor(String.class);
Object[] parameterValues = {""};

Set<ConstraintViolation<CaseReference>> violations =
        executableValidator.validateConstructorParameters(constructor, parameterValues);
```

But in real systems, you must decide whether you want constructor validation to be framework-enforced or whether the constructor itself should protect invariants with normal Java checks.

For value objects, this is often better:

```java
public CaseReference(String value) {
    if (value == null || value.isBlank()) {
        throw new IllegalArgumentException("case reference must not be blank");
    }
    this.value = value;
}
```

Reason:

```text
Domain invariant should not depend on an external validation interceptor.
```

---

## 7. Parameter Name Problem

A frequent surprise:

```text
approve.arg0 must not be null
approve.arg1 must not be blank
```

Instead of:

```text
approve.caseId must not be null
approve.reason must not be blank
```

Java does not always retain source parameter names at runtime unless compiled with:

```text
-parameters
```

Without that, reflection sees synthetic names like `arg0`, `arg1`.

### 7.1 Maven Compiler Example

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <parameters>true</parameters>
    </configuration>
</plugin>
```

### 7.2 Gradle Example

```groovy
tasks.withType(JavaCompile).configureEach {
    options.compilerArgs += ['-parameters']
}
```

### 7.3 Production Implication

For API errors, `arg0` is unacceptable.

Bad response:

```json
{
  "errors": [
    { "path": "approve.arg0", "message": "must not be null" }
  ]
}
```

Better response:

```json
{
  "errors": [
    {
      "path": "caseId",
      "code": "CASE_ID_REQUIRED",
      "message": "Case ID is required."
    }
  ]
}
```

For public APIs, do not expose raw executable paths blindly. Normalize them into stable contract paths.

---

## 8. Parameter Constraint: Good and Bad Use Cases

### 8.1 Good Use Case: Application Service Input Guard

```java
public CaseFile getCase(@NotNull CaseId caseId, @NotNull Actor actor) {
    ...
}
```

This is good because the method contract is simple and local.

### 8.2 Good Use Case: Internal Adapter Boundary

```java
public ExternalProfile fetchProfile(@NotBlank String externalUserId) {
    ...
}
```

It protects integration boundary from obvious misuse.

### 8.3 Good Use Case: Repository Facade Contract

```java
public Optional<CaseEntity> findByReferenceNo(@NotBlank String referenceNo) {
    ...
}
```

This is acceptable if you want a clean repository/service contract.

### 8.4 Bad Use Case: Authorization Hidden in Annotation

```java
public Decision approve(@CanApproveCase CaseId caseId, Actor actor) {
    ...
}
```

This is suspicious. Authorization usually needs:

- caller identity,
- role,
- assignment,
- delegation,
- tenant/agency,
- workflow state,
- policy version,
- audit trail.

Hiding it inside a parameter constraint can make the system hard to reason about.

Better:

```java
public Decision approve(ApproveCommand command) {
    authorizationService.ensureCanApprove(command.actor(), command.caseId());
    workflowGuard.ensureTransitionAllowed(command.caseId(), APPROVE);
    ...
}
```

### 8.5 Bad Use Case: Database Existence Hidden in Annotation

```java
public CaseFile getCase(@ExistingCase String caseReferenceNo) {
    ...
}
```

This may look clean, but has problems:

- validator now depends on DB,
- DB call may run before transaction context is correct,
- result can be stale,
- error semantics mix validation and lookup,
- performance becomes hidden,
- race condition remains.

Often better:

```java
CaseFile caseFile = caseRepository.findByReferenceNo(referenceNo)
        .orElseThrow(() -> new CaseNotFoundException(referenceNo));
```

---

## 9. Return Value Constraint: Contract of Provider

Return value validation is underused but powerful.

Example:

```java
@NotNull
public CaseSummary getCaseSummary(@NotBlank String caseReferenceNo) {
    ...
}
```

This says:

```text
If this method returns normally, it must return a non-null CaseSummary.
```

If a case may not exist, use the type to express that:

```java
public Optional<@Valid CaseSummary> findCaseSummary(@NotBlank String caseReferenceNo) {
    ...
}
```

Do not use `@NotNull` to lie about domain reality.

### 9.1 Return Value Constraint as Bug Detector

```java
@Size(max = 100)
public List<CaseSummary> listRecentCases() {
    return repository.findAllRecent(); // accidentally returns 5000
}
```

This detects provider-side contract violation.

But ask yourself:

```text
Is max 100 a validation rule, or should the query itself enforce LIMIT 100?
```

In most production systems, both may be useful:

- query limit prevents cost,
- return validation detects contract regression.

### 9.2 Return Value and API Error Semantics

If return value validation fails inside a server endpoint, the client likely sent a valid request but the server produced invalid output.

Response should usually be 500-class, not 400-class.

```text
Parameter violation on inbound API:
  400 Bad Request / 422 Unprocessable Entity depending API convention.

Return value violation:
  500 Internal Server Error or mapped internal contract failure.
```

Do not expose internal return violation details to public clients.

---

## 10. Cascaded Return Value Validation

```java
@Valid
public CaseDetailDto getCaseDetail(@NotBlank String caseReferenceNo) {
    return buildDto(caseReferenceNo);
}
```

Where:

```java
public record CaseDetailDto(
        @NotBlank String caseReferenceNo,
        @NotNull CaseStatus status,
        @Valid ApplicantDto applicant
) {}
```

This checks the returned DTO graph.

Useful for:

- internal correctness checks,
- generated API response guarantees,
- boundary between domain and transport mapper,
- regression detection.

Dangerous when:

- return graph is large,
- object contains lazy JPA relationships,
- DTO contains fields that are intentionally omitted by permission,
- validation rules are stricter than response contract version.

For response DTO, validation can be useful, but must be version-aware:

```text
v1 response may allow missing optional field.
v2 response may require it.

Do not validate all versions with one global rule unless the contract is identical.
```

---

## 11. Container Element Parameter and Return Validation

Since Bean Validation 2.0, constraints can be placed on type arguments.

### 11.1 Parameter Container Element

```java
public void assignTags(
        @NotNull CaseId caseId,
        @Size(max = 20) List<@NotBlank String> tags) {
    ...
}
```

Meaning:

- `caseId` must not be null,
- `tags` list size must be at most 20,
- each tag must not be blank.

### 11.2 Return Container Element

```java
public List<@Valid CaseSummaryDto> listCases(@NotNull Actor actor) {
    ...
}
```

Meaning each returned element is cascaded validated.

### 11.3 Optional Return

```java
public Optional<@Valid CaseSummaryDto> findCase(@NotBlank String referenceNo) {
    ...
}
```

Meaning:

- `Optional.empty()` is acceptable,
- if present, the value must be valid.

This is better than:

```java
@Valid
public CaseSummaryDto findCase(String referenceNo) {
    return null;
}
```

because it expresses absence explicitly.

---

## 12. Cross-Parameter Validation

Field-level and class-level validation validate one object. Cross-parameter validation validates **the relationship between method/constructor arguments**.

Example:

```java
@ValidSearchWindow
public List<CaseSummary> search(
        LocalDate from,
        LocalDate to,
        List<String> statuses) {
    ...
}
```

The rule might be:

```text
If both from and to are provided, from must be <= to.
The date range must not exceed 366 days.
If statuses contains CLOSED, to must not be future date.
```

Be careful: the more contextual the rule becomes, the less suitable it is for annotation validation.

### 12.1 Minimal Cross-Parameter Constraint Annotation

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import jakarta.validation.ConstraintTarget;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.CONSTRUCTOR;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = ValidDateRangeParametersValidator.class)
@Target({ METHOD, CONSTRUCTOR })
@Retention(RUNTIME)
public @interface ValidDateRangeParameters {
    String message() default "invalid date range";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    ConstraintTarget validationAppliesTo() default ConstraintTarget.PARAMETERS;
}
```

### 12.2 Cross-Parameter Validator

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.constraintvalidation.SupportedValidationTarget;
import jakarta.validation.constraintvalidation.ValidationTarget;

import java.time.LocalDate;

@SupportedValidationTarget(ValidationTarget.PARAMETERS)
public class ValidDateRangeParametersValidator
        implements ConstraintValidator<ValidDateRangeParameters, Object[]> {

    @Override
    public boolean isValid(Object[] value, ConstraintValidatorContext context) {
        if (value == null || value.length < 2) {
            return true;
        }

        Object fromRaw = value[0];
        Object toRaw = value[1];

        if (fromRaw == null || toRaw == null) {
            return true; // leave null handling to @NotNull if required
        }

        if (!(fromRaw instanceof LocalDate from) || !(toRaw instanceof LocalDate to)) {
            return false;
        }

        if (!from.isAfter(to)) {
            return true;
        }

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate("from date must be before or equal to to date")
                .addParameterNode(0)
                .addConstraintViolation();

        return false;
    }
}
```

Notes:

- Cross-parameter validators validate `Object[]`.
- Annotate validator with `@SupportedValidationTarget(ValidationTarget.PARAMETERS)`.
- Keep null handling delegated to parameter constraints unless null itself breaks the cross-parameter rule.
- Use `addParameterNode(index)` if you want to attach violation to a specific parameter.

### 12.3 Applying the Constraint

```java
@ValidDateRangeParameters
public List<CaseSummary> search(
        @NotNull LocalDate from,
        @NotNull LocalDate to) {
    ...
}
```

If `from` is after `to`, the cross-parameter constraint fails.

### 12.4 Cross-Parameter Constraint vs Request Object

Alternative:

```java
@ValidSearchCriteria
public record SearchCriteria(
        LocalDate from,
        LocalDate to,
        List<String> statuses
) {}
```

Then:

```java
public List<CaseSummary> search(@Valid SearchCriteria criteria) {
    ...
}
```

This is often better for public API and complex search contracts.

Comparison:

| Approach | Better For | Weakness |
|---|---|---|
| Cross-parameter method constraint | Small internal API with stable signature | Fragile to parameter order/signature change |
| Request object class-level constraint | Public API, complex criteria, reusable contract | More DTO classes |
| Command validator/policy object | Business/workflow-heavy rules | More explicit code, not annotation-only |

Rule of thumb:

```text
If the relationship is really about the method call shape, cross-parameter is fine.
If the relationship is about a domain command, use a command/request object.
```

---

## 13. Dual Generic and Cross-Parameter Constraints

Some constraints can theoretically support both:

- generic target: validates annotated element/return value,
- cross-parameter target: validates parameter array.

That is why Jakarta Validation has `ConstraintTarget` and `validationAppliesTo`.

Example conceptual annotation:

```java
public @interface ConsistentDateRange {
    String message() default "invalid date range";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
    ConstraintTarget validationAppliesTo() default ConstraintTarget.IMPLICIT;
}
```

But in production, avoid clever dual-purpose constraints unless there is a strong reason.

Why?

- harder to understand,
- harder to test,
- ambiguous target resolution,
- confusing API metadata,
- more provider-specific edge cases.

Prefer two explicit constraints:

```text
@ValidDateRangeObject
@ValidDateRangeParameters
```

Clarity beats annotation cleverness.

---

## 14. Inheritance and Method Constraint Rules

Executable validation interacts with inheritance. This is subtle and important.

Conceptual rule:

```text
Subtypes must not strengthen preconditions.
Subtypes may strengthen postconditions.
```

This follows Liskov Substitution Principle.

If an interface declares:

```java
public interface CaseService {
    CaseFile getCase(String referenceNo);
}
```

And implementation declares:

```java
public class DefaultCaseService implements CaseService {
    @Override
    public CaseFile getCase(@NotBlank String referenceNo) {
        ...
    }
}
```

This strengthens preconditions in implementation. A caller using the interface had no such contract, so the implementation is stricter than promised. Validation providers may reject this as illegal configuration depending on exact inheritance situation.

Better:

```java
public interface CaseService {
    CaseFile getCase(@NotBlank String referenceNo);
}

public class DefaultCaseService implements CaseService {
    @Override
    public CaseFile getCase(String referenceNo) {
        ...
    }
}
```

The contract belongs on the interface if callers depend on the interface.

### 14.1 Return Value Strengthening

Interface:

```java
public interface CaseService {
    CaseFile getCase(@NotBlank String referenceNo);
}
```

Implementation:

```java
public class DefaultCaseService implements CaseService {
    @Override
    @NotNull
    public CaseFile getCase(String referenceNo) {
        ...
    }
}
```

This strengthens postcondition and is generally aligned with substitutability: caller gets at least what interface promised, possibly more.

### 14.2 Parallel Interface Problem

Be careful with multiple interfaces declaring same method signature with conflicting constraints.

```java
interface A {
    void process(@NotNull String value);
}

interface B {
    void process(String value);
}

class C implements A, B {
    public void process(String value) { ... }
}
```

This can create ambiguous or illegal constraint configuration.

Architecture guideline:

```text
Put executable constraints at the highest stable contract boundary.
Avoid redeclaring conflicting constraints across interface hierarchies.
```

---

## 15. Framework Enforcement: Manual vs Interceptor/Proxy

Executable validation can be triggered by:

1. manual `ExecutableValidator`,
2. CDI/Jakarta EE interceptor,
3. Spring method validation proxy,
4. JAX-RS/Jakarta REST integration,
5. framework-specific AOP/interceptor.

The annotation alone does not guarantee enforcement.

---

## 16. Spring Method Validation

In Spring, method validation commonly uses:

```java
import org.springframework.validation.annotation.Validated;

@Validated
@Service
public class CaseApplicationService {

    public CaseFile getCase(@NotBlank String referenceNo) {
        ...
    }
}
```

Important details:

- `@Validated` activates Spring method validation on proxied bean.
- Spring Boot 3 uses Jakarta Validation namespace.
- Spring Boot 2 commonly uses Javax Validation namespace.
- Self-invocation does not go through proxy.
- Private methods are not proxied.
- Final classes/methods can interfere depending proxy mechanism.
- Interface vs class proxy behavior matters.

### 16.1 Self-Invocation Trap

```java
@Validated
@Service
public class CaseService {

    public void outer() {
        inner(null); // may bypass proxy validation
    }

    public void inner(@NotNull String value) {
        ...
    }
}
```

Because `outer()` calls `inner()` on `this`, the proxy is bypassed.

Correct mental model:

```text
Proxy-based method validation happens when another object calls the proxied bean.
It usually does not happen for this.inner() self-calls.
```

Solutions:

- validate at external boundary,
- split method into another bean if truly needed,
- manually validate,
- avoid relying on method validation for internal invariant,
- design public service API as validation boundary.

### 16.2 Private Method Trap

```java
private void normalize(@NotBlank String value) {
    ...
}
```

Framework proxy validation usually will not validate private method calls. Do not annotate private methods expecting runtime enforcement.

### 16.3 Final Method/Class Trap

Depending on proxy strategy, final classes/methods may not be interceptable.

For Spring:

- JDK dynamic proxy works through interfaces,
- CGLIB proxies subclass concrete class,
- final methods cannot be overridden by subclass proxy.

Therefore executable validation is most reliable on public methods of proxied beans with clear interface/class proxy behavior.

---

## 17. JAX-RS / Jakarta REST Executable Validation

Jakarta REST implementations commonly integrate Bean/Jakarta Validation for resource method parameters and entity bodies.

Example:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{referenceNo}")
    public CaseDetailDto getCase(
            @PathParam("referenceNo") @NotBlank String referenceNo) {
        ...
    }
}
```

Potential validation targets:

- path parameter,
- query parameter,
- header parameter,
- cookie parameter,
- request body DTO,
- return value DTO.

Production caution:

```text
Resource method validation is a transport boundary concern.
Do not rely on it as the only domain invariant.
```

If the same service is called by:

- REST endpoint,
- batch job,
- event consumer,
- admin job,
- scheduler,

then validation only at REST resource method is insufficient.

---

## 18. CDI / Jakarta EE Method Validation

In Jakarta EE/CDI environments, method validation can be applied through interceptors according to platform integration.

Architecture implication:

```text
Executable validation is a boundary feature.
Know exactly which container invokes it.
```

Checklist:

- Is the class managed by CDI/container?
- Is the method public/interceptable?
- Are constraints placed on interface or implementation?
- Is validation enabled in the runtime?
- What exception type is thrown?
- How is it mapped to API response?

---

## 19. Exception Handling and Error Mapping

Executable validation typically raises `ConstraintViolationException` when method validation fails through framework interceptors.

But exact exception wrapping can vary by framework.

### 19.1 Parameter Violation Mapping

For inbound API parameter violations:

```json
{
  "type": "https://example.gov/errors/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "errors": [
    {
      "path": "referenceNo",
      "code": "CASE_REFERENCE_REQUIRED",
      "message": "Case reference number is required."
    }
  ]
}
```

### 19.2 Return Value Violation Mapping

For return value violation:

```json
{
  "type": "https://example.gov/errors/internal-contract-violation",
  "title": "Internal contract violation",
  "status": 500,
  "traceId": "01HX..."
}
```

Do not reveal:

- internal method names,
- Java class names,
- invalid return value,
- stack traces,
- hidden fields,
- PII.

### 19.3 Distinguish Caller Fault vs Provider Fault

```text
validateParameters failure:
  caller supplied invalid input.

validateReturnValue failure:
  provider returned invalid output.

validateConstructorParameters failure:
  caller attempted invalid construction.

validateConstructorReturnValue failure:
  constructed object violates contract.
```

This distinction should influence HTTP status, logging severity, and alerting.

---

## 20. Violation Path for Executable Validation

Executable validation paths include method/constructor and parameter/return nodes.

Conceptual examples:

```text
getCase.referenceNo
getCase.<return value>
search.arg0
search.from
createCase.caseApplicant.email
```

Depending on provider and parameter name availability, you may see:

```text
search.arg0
search.arg1
```

or:

```text
search.from
search.to
```

For public API, raw property path should usually be transformed.

Example mapper:

```java
public String normalizePath(ConstraintViolation<?> violation) {
    String raw = violation.getPropertyPath().toString();

    return raw
            .replace("getCase.", "")
            .replace("arg0", "referenceNo")
            .replace("<return value>", "response");
}
```

A real implementation should avoid brittle string replacement when possible and inspect `Path.Node` objects.

---

## 21. Constructor Validation vs Domain Constructor Guards

Consider a value object:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(@NotBlank @Email String value) {
        this.value = value;
    }
}
```

This annotation documents constructor contract, but it does not guarantee enforcement unless constructor validation is invoked.

For domain value objects, prefer hard invariant inside constructor/factory:

```java
public final class EmailAddress {
    private final String value;

    private EmailAddress(String value) {
        this.value = value;
    }

    public static EmailAddress of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        if (!raw.contains("@")) {
            throw new IllegalArgumentException("email format is invalid");
        }
        return new EmailAddress(raw);
    }
}
```

Bean Validation can still validate DTOs before constructing the value object:

```java
public record RegisterUserRequest(
        @NotBlank @Email String email
) {}
```

Mental model:

```text
Bean Validation protects boundary contracts.
Domain constructors protect domain invariants.
```

Do not make domain correctness depend entirely on external validation.

---

## 22. Executable Validation With Records

Records are useful for immutable request/response models.

```java
public record SearchCaseCommand(
        @NotNull LocalDate from,
        @NotNull LocalDate to,
        @Size(max = 20) List<@NotBlank String> statuses
) {}
```

You can validate the record object:

```java
validator.validate(command);
```

For method validation:

```java
public List<CaseSummary> search(@Valid SearchCaseCommand command) {
    ...
}
```

This is usually cleaner than cross-parameter constraints for complex commands.

### 22.1 Compact Constructor and Validation

```java
public record CaseReference(String value) {
    public CaseReference {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
    }
}
```

For records representing domain value objects, compact constructor guard is stronger than relying on Bean Validation.

For records representing DTOs, Bean Validation annotations are appropriate.

---

## 23. Executable Validation With Sealed Types

Modern Java allows sealed command hierarchy:

```java
public sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase {}

public record SubmitCase(@NotNull CaseId caseId) implements CaseCommand {}
public record ApproveCase(@NotNull CaseId caseId, @NotBlank String reason) implements CaseCommand {}
public record RejectCase(@NotNull CaseId caseId, @NotBlank String reason) implements CaseCommand {}
```

Then service method:

```java
public Decision handle(@Valid CaseCommand command) {
    return switch (command) {
        case SubmitCase submit -> submit(submit);
        case ApproveCase approve -> approve(approve);
        case RejectCase reject -> reject(reject);
    };
}
```

Caution:

- Bean Validation validates runtime subtype constraints when cascaded properly.
- But workflow rules still belong in command handler/policy/guard.

Executable validation on polymorphic command parameter can protect shape, not full lifecycle correctness.

---

## 24. Method Validation and Transaction Boundary

A subtle production question:

```text
Should validation happen before or inside transaction?
```

For simple parameter constraints:

```text
Before transaction is usually better.
```

Reason:

- fail fast,
- no DB resources acquired,
- less lock time,
- cleaner caller error.

For contextual validation requiring DB state:

```text
Inside transaction may be necessary, but Bean Validation annotation is usually not the right mechanism.
```

Example:

```java
@Transactional
public Decision approve(ApproveCommand command) {
    validator.validate(command); // shape validation
    CaseFile caseFile = repository.lockById(command.caseId());
    policy.ensureCanApprove(caseFile, command.actor());
    ...
}
```

Here:

- Bean Validation checks command shape,
- repository loads current state,
- policy checks contextual business rule,
- transaction protects consistency.

Do not put DB-locking policy inside a `ConstraintValidator` unless you are very deliberate and can explain lifecycle, transaction, retries, and performance.

---

## 25. Method Validation and Virtual Threads

Java 21+ virtual threads do not change Jakarta Validation semantics.

But they change the cost model of blocking operations:

```text
Blocking validator calls are still logically expensive.
Virtual threads reduce platform thread blocking cost, not database/API latency, contention, or external dependency risk.
```

Do not justify DB-calling validators by saying “we use virtual threads”.

Hidden blocking validation still causes:

- unpredictable latency,
- transaction timing issues,
- dependency coupling,
- hard-to-observe failures,
- retry ambiguity.

Executable validators should normally remain CPU-local and deterministic.

---

## 26. Method Validation and AOT / Native Image

Modern Java stacks may use AOT/native-image modes.

Executable validation may rely on:

- reflection metadata,
- parameter names,
- annotation metadata,
- proxy generation,
- framework hints.

Implications:

- compile with parameter metadata if needed,
- test method validation in native/AOT build, not only JVM mode,
- avoid overly dynamic validation bootstrapping if native support is important,
- follow framework-specific native configuration.

Rule:

```text
If method validation is part of production contract, include it in smoke tests for the exact runtime packaging mode.
```

---

## 27. Executable Validation in Layered Architecture

Where should method validation be used?

### 27.1 Controller/Resource Layer

Good for:

- path/query/header validation,
- request DTO validation,
- transport-level shape.

Not enough for:

- domain invariants,
- workflow state,
- background job calls,
- event consumer calls.

### 27.2 Application Service Layer

Good for:

- command parameter non-null,
- command object cascaded validation,
- service API contract.

Example:

```java
@Validated
public class CaseApplicationService {
    public Decision submit(@Valid @NotNull SubmitCaseCommand command) {
        ...
    }
}
```

### 27.3 Domain Layer

Use carefully.

Domain should not depend on external proxy validation. Prefer constructor/factory/method guards for hard invariants.

```java
caseFile.submit(actor, now);
```

Inside domain method:

```java
if (!status.canSubmit()) {
    throw new InvalidTransitionException(status, SUBMIT);
}
```

This is more explicit than annotation-based hidden workflow validation.

### 27.4 Repository Layer

Method validation can document simple contract:

```java
Optional<CaseEntity> findByReferenceNo(@NotBlank String referenceNo);
```

But database consistency belongs to DB constraints and transaction logic.

### 27.5 Integration Adapter

Useful:

```java
ExternalProfile fetchProfile(@NotBlank String externalUserId);
```

But external API response validation should be designed separately:

- schema validation,
- adapter mapping validation,
- anti-corruption model,
- fallback/error classification.

---

## 28. Anti-Patterns

### 28.1 Annotation As Hidden Workflow Engine

```java
public Decision approve(@ValidForApproval CaseId caseId) { ... }
```

Bad because workflow policy becomes invisible.

### 28.2 DB Calls in Parameter Validators

```java
public CaseFile get(@ExistingCase String referenceNo) { ... }
```

Usually bad because validation becomes hidden I/O.

### 28.3 Relying on Method Validation for Private/Internal Calls

```java
this.doWork(null);
```

Self-call may bypass proxy.

### 28.4 Strengthening Preconditions in Subclasses

Putting stricter parameter constraints only in implementation can violate substitutability.

### 28.5 Public API Error Exposes Java Method Path

```json
{ "path": "CaseResource.getCase.arg0" }
```

Bad public contract. Normalize it.

### 28.6 Return Value Validation Used Instead of Correct Implementation

```java
@Size(max = 100)
public List<Item> list() {
    return repository.findAll();
}
```

The query should enforce the limit. Validation can detect regression, not replace correct implementation.

### 28.7 `@NotNull` Return Where Absence Is Normal

Bad:

```java
@NotNull
public CaseFile find(String id) { ... }
```

Better:

```java
public Optional<CaseFile> find(String id) { ... }
```

---

## 29. Testing Executable Validation

### 29.1 Manual Unit Test With `ExecutableValidator`

```java
class CaseServiceValidationTest {

    private final Validator validator = Validation
            .buildDefaultValidatorFactory()
            .getValidator();

    private final ExecutableValidator executableValidator = validator.forExecutables();

    @Test
    void findCase_rejectsBlankReference() throws Exception {
        CaseQueryService service = new CaseQueryService();
        Method method = CaseQueryService.class.getMethod(
                "findCase", String.class, Actor.class
        );

        Set<ConstraintViolation<CaseQueryService>> violations =
                executableValidator.validateParameters(
                        service,
                        method,
                        new Object[]{" ", new Actor("u1")}
                );

        assertThat(violations).isNotEmpty();
    }
}
```

### 29.2 Framework Integration Test

Manual `ExecutableValidator` test proves constraints are valid. It does not prove Spring/CDI/JAX-RS proxy enforcement is active.

You also need integration tests:

```java
@SpringBootTest
class CaseServiceMethodValidationIT {

    @Autowired
    CaseApplicationService service;

    @Test
    void proxiedService_rejectsInvalidCommand() {
        assertThrows(ConstraintViolationException.class,
                () -> service.submit(null));
    }
}
```

### 29.3 Self-Invocation Regression Test

If your design depends on method validation, test actual calling path.

```text
Do not assume annotation is enforced.
Prove it through runtime integration test.
```

### 29.4 Error Mapping Test

For API:

- invalid path parameter,
- invalid query parameter,
- invalid body,
- invalid method-level parameter,
- return value violation if enabled.

Verify:

- status code,
- error code,
- path,
- message,
- no PII,
- no Java internal path leakage.

---

## 30. Production Review Checklist

Use this checklist during code review.

### 30.1 Enforcement

- Is this method actually validated at runtime?
- Is the class a managed/proxied bean?
- Is method public/interceptable?
- Is self-invocation avoided?
- Is the relevant framework validation feature enabled?

### 30.2 Contract Placement

- Is the constraint placed on the interface if interface is the contract?
- Are implementation constraints compatible with inheritance rules?
- Are you avoiding conflicting constraints across parallel interfaces?

### 30.3 Rule Appropriateness

- Is this a shape/precondition rule?
- Or is it authorization/workflow/database consistency disguised as validation?
- Does it call external systems or DB?
- Is it deterministic and side-effect-free?

### 30.4 Error Handling

- Are parameter violations mapped as caller errors?
- Are return value violations mapped as provider/internal errors?
- Are paths normalized?
- Are stable error codes used?
- Is PII excluded?

### 30.5 Performance

- Is validation cheap enough for this hot path?
- Are large return graphs cascaded unnecessarily?
- Are regex and container traversal bounded?
- Are validators free of hidden I/O?

### 30.6 Version and Migration

- Are imports consistently `javax.validation.*` or `jakarta.validation.*`?
- Does Spring Boot/Jakarta EE version match the namespace?
- Are parameter names retained if API errors need them?
- Is method validation tested in runtime packaging mode?

---

## 31. Example: Production-Grade Application Service Contract

Bad version:

```java
@Service
public class CaseService {

    public Decision approve(String caseId, String reason, User user) {
        // no clear contract
        // may throw NPE later
        // may return null
        return null;
    }
}
```

Better boundary contract:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;

@Validated
@Service
public class CaseApplicationService {

    @NotNull
    public Decision approve(@Valid @NotNull ApproveCaseCommand command) {
        // 1. Shape already checked by executable validation if proxy active.
        // 2. Still execute domain/workflow policy explicitly.
        CaseFile caseFile = caseRepository.lockById(command.caseId());
        caseApprovalPolicy.ensureCanApprove(caseFile, command.actor(), command.reason());
        return caseFile.approve(command.actor(), command.reason());
    }
}
```

Command:

```java
public record ApproveCaseCommand(
        @NotNull CaseId caseId,
        @NotNull Actor actor,
        @NotBlank String reason
) {}
```

This design separates:

```text
Bean Validation:
  command shape is valid.

Repository:
  current case state is loaded/locked.

Policy:
  actor, status, assignment, and workflow rule are checked.

Domain:
  transition is applied and invariant protected.

Return validation:
  service must not return null.
```

This is much more defensible than hiding everything in one custom annotation.

---

## 32. Example: Cross-Parameter Constraint vs Command Object

### 32.1 Cross-Parameter Style

```java
@ValidDateRangeParameters
public List<CaseSummary> searchCases(
        @NotNull LocalDate from,
        @NotNull LocalDate to,
        @Size(max = 20) List<@NotBlank String> statuses) {
    ...
}
```

Good if:

- method is internal,
- signature is stable,
- rule is simple,
- parameter order is obvious.

### 32.2 Command Object Style

```java
@ValidSearchCaseQuery
public record SearchCaseQuery(
        @NotNull LocalDate from,
        @NotNull LocalDate to,
        @Size(max = 20) List<@NotBlank String> statuses
) {}

public List<CaseSummary> searchCases(@Valid @NotNull SearchCaseQuery query) {
    ...
}
```

Better if:

- public API,
- query has many fields,
- rule evolves,
- query is reused,
- error path must be stable,
- documentation matters.

Top-tier bias:

```text
Prefer command/request objects when the operation has semantic meaning.
Use cross-parameter constraints for small, stable, local executable contracts.
```

---

## 33. How to Think Like a Top 1% Engineer

A weaker engineer asks:

```text
Can I put @NotNull on this parameter?
```

A stronger engineer asks:

```text
Is this annotation actually enforced on this call path?
Is this a caller precondition or a domain policy?
Will this rule still be valid for batch/event/admin callers?
Will the error path be stable for clients?
Will this violate inheritance constraints?
Will this cause hidden I/O or transaction problems?
Is return value failure a client error or server bug?
Does this belong on method signature, command object, or domain model?
```

Executable validation is powerful not because it saves a few `if` statements, but because it makes **operation contracts explicit**.

But it is dangerous when used as invisible control flow.

The right model:

```text
Use executable validation to guard operation shape.
Use command/domain policy to guard business meaning.
Use transaction/database constraints to guard final consistency.
Use error mapping to convert violation into stable external contract.
Use tests to prove enforcement actually happens.
```

---

## 34. Summary

Executable validation allows Jakarta/Bean Validation to validate:

- method parameters,
- constructor parameters,
- cross-parameter consistency,
- method return values,
- constructor return values,
- cascaded return values,
- container element constraints on parameters and return values.

It is best understood as Design by Contract:

- parameter constraints are caller preconditions,
- return value constraints are provider postconditions,
- cross-parameter constraints validate argument consistency.

Production-grade usage requires understanding:

- manual vs proxy/interceptor enforcement,
- parameter name retention,
- inheritance rules,
- self-invocation traps,
- private/final method limitations,
- caller fault vs provider fault mapping,
- transaction boundary,
- domain invariant separation,
- API error normalization.

Do not use executable validation as a hidden workflow engine. Use it as a clear, enforceable, testable operation contract.

---

## 35. Practical Exercises

1. Create a service method with parameter constraints and manually validate it using `ExecutableValidator`.
2. Add return value validation and verify that invalid return values are detected.
3. Implement a cross-parameter date range validator using `@SupportedValidationTarget(ValidationTarget.PARAMETERS)`.
4. Compare cross-parameter validation with a request-object class-level constraint.
5. In a Spring Boot app, enable method validation and prove self-invocation does not trigger validation.
6. Compile once with `-parameters` and once without; compare violation paths.
7. Create a public API error mapper that hides Java method paths and returns stable field names.
8. Add a return value violation test and map it as internal server error.
9. Move a workflow-heavy custom parameter constraint into an explicit policy object.
10. Review one existing service interface and decide where executable constraints should live: interface, implementation, command object, or domain object.

---

## 36. References

- Jakarta Validation 3.1 Specification — Jakarta EE, metadata model and API for JavaBean and method validation.
- Jakarta Validation 3.1 API — `jakarta.validation`, `jakarta.validation.executable`, `jakarta.validation.constraints`, metadata API.
- Bean Validation 2.0 Specification — JSR 380, Java 8 support, container element constraints, executable validation model.
- Hibernate Validator Reference Guide — method validation, cross-parameter constraints, return value validation, provider-specific behavior.
- Hibernate Validator 9.x Release Documentation — Jakarta Validation 3.1 / Jakarta EE 11 target.
- OpenJDK Java Language and Reflection documentation — parameter metadata and `-parameters` compiler option relevance.

---

## 37. Seri Status

Seri `learn-java-validation-jakarta-hibernate-validator` belum selesai.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence
- Part 005 — Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control
- Part 006 — Container Element Constraints: Lists, Maps, Optional, Custom Containers
- Part 007 — Validation Groups: Operation-Specific Contracts without DTO Explosion
- Part 008 — Group Sequence and Dynamic Group Sequence: Ordered Validation and Short-Circuiting
- Part 009 — Custom Constraint Design: Annotation, Validator, Message, Target, Repeatable
- Part 010 — Class-Level and Cross-Field Validation: Consistency inside One Object
- Part 011 — Cross-Parameter and Executable Validation: Methods, Constructors, Return Values

Bagian berikutnya:

- Part 012 — Records, Immutability, Builders, Lombok, and Modern Java Modeling

