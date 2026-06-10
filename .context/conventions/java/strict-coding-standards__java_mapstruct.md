# Strict Coding Standards — Java MapStruct

> **Purpose**: This document defines strict, enforceable coding standards for using MapStruct in Java services. It is written for human engineers and LLM code agents. It must be applied together with `java_oop.md`, `java_json.md`, `java_jpa.md`, `java_hibernate_orm.md`, `java_validation.md`, and the project Java baseline standard.

---

## 1. Scope

This standard covers:

- MapStruct mapper interfaces.
- DTO ↔ domain mapping.
- Entity ↔ DTO mapping.
- Command/request ↔ domain command mapping.
- Event mapping.
- Update/patch mapping with `@MappingTarget`.
- Null handling.
- Collection mapping.
- Nested mapping.
- Cycle handling.
- Dependency injection component models.
- Generated code governance.

This standard does **not** allow MapStruct to replace domain logic, validation, persistence, or authorization.

---

## 2. Version and Dependency Policy

MUST:

- Use a stable MapStruct version unless beta features are explicitly approved.
- Pin `mapstruct` and `mapstruct-processor` to the same version.
- Configure annotation processor path explicitly.
- Enable build failure for unmapped target properties by default.
- Keep generated sources out of manual editing.

Recommended baseline:

- MapStruct 1.6.x stable line for new production code unless the platform explicitly adopts a newer stable line.
- MapStruct beta/RC versions are forbidden by default for production standards.

Maven example:

```xml
<dependency>
    <groupId>org.mapstruct</groupId>
    <artifactId>mapstruct</artifactId>
    <version>${mapstruct.version}</version>
</dependency>
```

Compiler processor example:

```xml
<annotationProcessorPaths>
    <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>${mapstruct.version}</version>
    </path>
</annotationProcessorPaths>
```

Gradle example:

```kotlin
dependencies {
    implementation("org.mapstruct:mapstruct:$mapstructVersion")
    annotationProcessor("org.mapstruct:mapstruct-processor:$mapstructVersion")
}
```

FORBIDDEN:

- Version drift between runtime annotation and processor.
- Relying on transitive MapStruct processor.
- Manually editing generated implementation classes.

---

## 3. Core Principle

MapStruct is a **compile-time structural mapping tool**.

It is allowed to:

- Copy values between boundary models.
- Rename fields.
- Flatten/expand simple structures.
- Convert simple value representations.
- Compose other mappers.

It is not allowed to:

- Make business decisions.
- Perform authorization checks.
- Load data from database/network/cache.
- Hide domain invariant construction.
- Replace validation.
- Execute side effects.

---

## 4. Mapper Categorization

Every mapper MUST belong to one category:

| Category | Example | Rule |
|---|---|---|
| API request mapper | `CreateCaseRequestMapper` | DTO -> command/value object |
| API response mapper | `CaseResponseMapper` | domain/read model -> DTO |
| Persistence mapper | `CaseRowMapper` | persistence row/entity -> domain/read model |
| Event mapper | `CaseEventMapper` | domain event -> integration event |
| Adapter mapper | `PartnerPayloadMapper` | external model -> internal DTO |
| Test mapper | `FixtureMapper` | test-only |

FORBIDDEN:

- Generic catch-all `CommonMapper`.
- One mapper that maps every object in a module.
- Mapper methods crossing unrelated bounded contexts.

---

## 5. Naming Standards

MUST:

- Name mapper after source/target boundary or use case.
- Keep method names explicit.
- Avoid ambiguous `convert`, `transform`, `map` when multiple semantics exist.

Preferred:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CaseResponseMapper {
    CaseResponse toResponse(CaseReadModel source);
    List<CaseResponse> toResponses(List<CaseReadModel> source);
}
```

Avoid:

```java
@Mapper
public interface MapperUtil {
    Object map(Object source);
}
```

---

## 6. Central Mapper Configuration

Every project SHOULD define a central config:

```java
@MapperConfig(
        componentModel = MappingConstants.ComponentModel.SPRING,
        unmappedTargetPolicy = ReportingPolicy.ERROR,
        unmappedSourcePolicy = ReportingPolicy.WARN,
        typeConversionPolicy = ReportingPolicy.ERROR,
        nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS,
        collectionMappingStrategy = CollectionMappingStrategy.ACCESSOR_ONLY
)
public interface CentralMapperConfig {
}
```

Rules:

- `unmappedTargetPolicy = ERROR` is the default for production mappers.
- Source warnings are allowed when source has intentionally extra fields.
- Type conversion policy should be strict for money/date/ID/status fields.
- Component model must match framework (`spring`, `cdi`, `jakarta-cdi`, default, etc.).

FORBIDDEN:

- Local mapper config that weakens central policy without written reason.
- `ReportingPolicy.IGNORE` globally.

---

## 7. Component Model Policy

MUST choose one per application/module:

| Runtime | Component model |
|---|---|
| Plain Java | default / `Mappers.getMapper()` |
| Spring | `spring` |
| CDI/Jakarta/Quarkus | `cdi` or supported Jakarta component model |

Rules:

- Do not mix component models in the same module.
- Framework-managed mappers should use constructor injection when possible.
- Avoid static mapper singleton in DI-managed applications.

Allowed plain Java:

```java
private static final CaseMapper MAPPER = Mappers.getMapper(CaseMapper.class);
```

Allowed DI:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CaseMapper {
    CaseDto toDto(CaseReadModel source);
}
```

FORBIDDEN:

- Calling `Mappers.getMapper()` inside request/business methods in Spring/CDI applications.

---

## 8. DTO to Domain Mapping

MUST:

- Map inbound DTO into domain command/value object explicitly.
- Validate DTO before mapping when validation is structural/boundary-level.
- Enforce domain invariants inside domain constructors/factories, not mapper expressions.

Allowed:

```java
@Mapper(config = CentralMapperConfig.class)
public interface CreateCaseCommandMapper {
    @Mapping(target = "submittedBy", source = "actorId")
    CreateCaseCommand toCommand(CreateCaseRequest request, UUID actorId);
}
```

Restricted:

```java
@Mapping(target = "priority", expression = "java(calculatePriority(request))")
```

Allowed only if `calculatePriority` is a pure mapping helper, not business rule execution.

FORBIDDEN:

- Mapper calling repositories.
- Mapper deciding workflow state transition.
- Mapper performing authorization.

---

## 9. Entity Mapping Policy

### 9.1 Entity to response DTO

Allowed with caution:

```java
CaseResponse toResponse(CaseEntity entity);
```

MUST ensure:

- Required relations are fetched before mapping.
- Mapping does not trigger uncontrolled lazy loading.
- DTO does not expose internal persistence fields.
- Cycles are impossible or handled.

Preferred:

- Map from read model/projection, not mutable entity.

### 9.2 Request DTO to entity

Restricted.

FORBIDDEN by default:

```java
CaseEntity toEntity(CreateCaseRequest request);
```

Reason: entity creation often needs invariants, IDs, audit fields, ownership, status, and transaction semantics.

Allowed only for simple persistence models with explicit factory boundary.

---

## 10. Update Mapping and Patch Semantics

`@MappingTarget` is restricted because it mutates an existing target.

Allowed only when:

- Update semantics are documented.
- Null/missing/empty behavior is explicit.
- Immutable/domain invariants are not bypassed.
- Tests cover partial updates.

Example:

```java
@BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
void applyPatch(UpdateCustomerRequest request, @MappingTarget CustomerDraft target);
```

Rules:

- `IGNORE` means null does not overwrite target.
- `SET_TO_NULL` means explicit null clears target.
- `SET_TO_DEFAULT` means null maps to default value.
- Do not use the same mapper method for PUT and PATCH unless semantics match.

FORBIDDEN:

- Blindly applying request DTO onto JPA entity.
- Using update mapping to bypass domain setter/factory policy.
- Ambiguous null behavior in patch endpoints.

---

## 11. Null Handling Policy

Every mapper MUST have a null policy.

Decide:

- Should null source return null target?
- Should null collection return null or empty collection?
- Should null property overwrite target property?
- Should missing field differ from explicit null?

Rules:

- For API response mapping, null should usually represent absent/unknown business value explicitly.
- For list responses, prefer empty list over null at API boundary.
- For patch update mapping, null policy must match API contract.

FORBIDDEN:

- Relying on MapStruct default null behavior without tests for update methods.
- Using `defaultValue` to hide invalid missing required fields.

---

## 12. Collection Mapping

MUST:

- Be clear whether output collection is mutable or immutable.
- Avoid mapping unbounded collections in memory.
- Preserve order only when order is part of contract.
- Avoid Set mapping if equality/hashCode semantics are unstable.

Allowed:

```java
List<CaseResponse> toResponses(List<CaseReadModel> source);
```

Restricted:

- Mapping large result sets after full materialization.
- Mapping entity collections that may lazy-load one element at a time.

FORBIDDEN:

- Changing collection type in a way that loses ordering or duplicates without explicit contract.

---

## 13. Field Renaming and Explicit Mapping

MUST use explicit `@Mapping` when:

- Field names differ.
- Business terminology differs across boundaries.
- Field represents transformed meaning.
- Field is derived.

Example:

```java
@Mapping(target = "caseId", source = "id")
@Mapping(target = "displayStatus", source = "status.label")
CaseResponse toResponse(CaseReadModel source);
```

FORBIDDEN:

- Allowing MapStruct to silently map semantically different fields because names happen to match.

---

## 14. Constants, Defaults, and Expressions

Allowed:

```java
@Mapping(target = "sourceSystem", constant = "ACEAS")
```

Restricted:

```java
@Mapping(target = "createdAt", expression = "java(Instant.now())")
```

FORBIDDEN:

- `Instant.now()` inside mapper. Use injected `Clock` in application service and pass value in.
- Generating IDs in mapper.
- Random values in mapper.
- Calling external service in expression.

Rules:

- Mapper expressions must be pure and deterministic.
- Complex expressions should become named helper methods.
- Business defaults belong in command factory/domain service, not mapper.

---

## 15. Type Conversion Policy

MUST be explicit for:

- `String` ↔ `UUID`
- `String` ↔ enum/status
- `String` ↔ `LocalDate`/`Instant`
- `BigDecimal` scale/rounding
- Money/currency types
- IDs with prefix or tenant scoping

Allowed helper:

```java
@Named("parseCaseId")
default UUID parseCaseId(String value) {
    return UUID.fromString(value);
}
```

FORBIDDEN:

- Locale-sensitive conversion without locale.
- Timezone-sensitive conversion without zone/offset.
- Money conversion without rounding/scale/currency policy.

---

## 16. Enum Mapping

MUST:

- Map external statuses explicitly.
- Fail on unknown values unless fallback is documented.
- Avoid ordinal mapping.

Allowed:

```java
@ValueMapping(source = "PENDING_REVIEW", target = "PENDING")
@ValueMapping(source = MappingConstants.ANY_REMAINING, target = "UNKNOWN")
ExternalStatus toExternalStatus(CaseStatus status);
```

Restricted:

- `ANY_REMAINING` fallback.

FORBIDDEN:

- Mapping enum by ordinal.
- Silent fallback for state-machine status in enforcement/regulatory workflows.

---

## 17. Nested Mapping

MUST:

- Keep nested mapping shallow and understandable.
- Avoid mapping entire object graph accidentally.
- Use separate mappers for nested concepts with clear ownership.

Allowed:

```java
@Mapper(config = CentralMapperConfig.class, uses = {AddressMapper.class})
public interface CustomerMapper {
    CustomerResponse toResponse(CustomerReadModel source);
}
```

FORBIDDEN:

- Mapping full aggregate graph into response DTO by default.
- Mapper triggering lazy load of unrelated associations.

---

## 18. Cycle Handling

Cycles are forbidden by default.

If cycles are unavoidable:

- Use an explicit cycle-avoidance context.
- Prefer flattening/reference IDs in DTOs.
- Test recursion behavior.
- Ensure memory does not grow unbounded.

FORBIDDEN:

- Using MapStruct to serialize bidirectional ORM graphs.
- Ignoring stack overflow risk.

---

## 19. Context Parameters

`@Context` is restricted.

Allowed for:

- Cycle avoidance context.
- Locale/formatting context.
- Explicit caller-provided mapping context.

FORBIDDEN:

- Passing repository/service through `@Context` for lookup.
- Hidden tenant/user/security context.
- Mutable global context.

---

## 20. Decorators and After/Before Mapping Hooks

Restricted.

Allowed only when:

- Logic is mapping-specific.
- It is pure or has explicitly allowed local mutation.
- Tests cover hook behavior.

FORBIDDEN:

- Persistence calls.
- Authorization decisions.
- Event publishing.
- Time/random generation.
- Complex business workflows.

---

## 21. Builder and Immutable Target Policy

MUST:

- Prefer constructor/record mapping for immutable DTOs.
- Use builder mapping only when target type intentionally uses builder.
- Ensure required fields are enforced by target constructor/builder.

FORBIDDEN:

- Mapping into partially valid immutable objects via reflection or incomplete builder.
- Suppressing compile errors by adding public setters to immutable objects.

---

## 22. Lombok Integration

Restricted.

If Lombok is used:

- Ensure annotation processing order works in build and IDE.
- Avoid Lombok-generated setters on domain objects.
- Test generated mapper compilation in CI.
- Prefer explicit constructors/records for DTOs where possible.

FORBIDDEN:

- Adding Lombok just to make MapStruct compile without understanding generated accessors.

---

## 23. Validation Interaction

MUST:

- Validate inbound DTOs before mapping to command when validation is boundary-level.
- Validate domain invariants inside domain model/factory.
- Avoid putting validation in mapper expressions.

Allowed flow:

```text
JSON -> Request DTO -> Bean Validation -> Mapper -> Command -> Domain service/factory
```

FORBIDDEN:

```text
JSON -> Mapper -> Entity -> Validation later maybe
```

---

## 24. Error Handling

MUST:

- Let compile-time unmapped errors fail the build.
- Throw explicit exception for invalid custom conversions.
- Avoid unchecked `NullPointerException` from helper methods.

FORBIDDEN:

- Catching mapping errors and returning empty target.
- Silent defaulting for required values.

---

## 25. Generated Code Policy

MUST:

- Treat generated implementation as build output.
- Review generated code when mapper is complex, performance-sensitive, or security-sensitive.
- Keep generated sources reproducible.
- Do not commit generated code unless project policy requires it.

FORBIDDEN:

- Editing generated mapper implementation.
- Depending on generated class names outside MapStruct contract.

---

## 26. Performance Policy

MapStruct is usually fast because it generates direct method calls.

MUST still:

- Avoid mapping huge graphs accidentally.
- Avoid mapping large result sets into memory when streaming/pagination is needed.
- Avoid expensive conversions inside loops.
- Avoid repeated formatter/parser creation in helper methods.

Restricted:

- Deep nested mapping in hot paths.
- Mapping ORM entities with lazy collections.
- Mapping millions of rows without benchmark/memory evidence.

---

## 27. Security Policy

MUST:

- Never use mapper as authorization/security boundary.
- Avoid mapping secret fields into response/log DTOs.
- Have explicit redacted DTOs for logging/audit.
- Review all fields when mapping external partner payloads.

FORBIDDEN:

- `@Mapping(target = "password", source = "password")` into response DTO.
- Mapping tenant ID/user ID from client DTO when it should come from auth context.
- Ignoring unmapped target warnings for security-sensitive DTOs.

---

## 28. Persistence and Transaction Rules

MUST:

- Keep mapper side-effect-free.
- Load required data before mapping.
- Apply updates through domain/application service.
- Keep transaction boundary outside mapper.

FORBIDDEN:

- Mapper method opens transaction.
- Mapper method calls repository.
- Mapper triggers lazy-loading in unpredictable ways.

---

## 29. API Response Rules

MUST:

- Map only intended response fields.
- Prefer explicit response DTOs per endpoint/use case.
- Avoid reusing internal DTO for public API unless contract is identical.

FORBIDDEN:

- Generic `EntityDto` reused for create/update/response/detail/list if fields differ.
- Mapping internal audit/admin fields into public response.

---

## 30. Event Mapping Rules

MUST:

- Map domain event to integration event explicitly.
- Include event schema version.
- Preserve stable field names.
- Avoid leaking internal enum names unless they are contract values.

FORBIDDEN:

- Auto-mapping domain object directly into Kafka/Rabbit/SNS event payload.
- Changing event mapping without compatibility tests.

---

## 31. Testing Standards

Each mapper MUST have tests when:

- It is public API/event/persistence boundary.
- It has custom mappings.
- It has null/default/update behavior.
- It maps enum/status/state.
- It maps money/date/time/ID.
- It uses expressions/hooks/context/decorators.

Test cases MUST include:

- Full valid source.
- Null source/properties.
- Empty collection.
- Unknown/future enum if supported.
- Partial update behavior for `@MappingTarget`.
- Security-sensitive field exclusion.

Example:

```java
@Test
void mapsCaseResponseWithoutInternalFields() {
    CaseReadModel source = fixture.caseReadModel();

    CaseResponse response = mapper.toResponse(source);

    assertThat(response.id()).isEqualTo(source.id());
    assertThat(response).hasNoNullFieldsOrPropertiesExcept("optionalReason");
}
```

---

## 32. Build and CI Rules

MUST:

- Run annotation processing in CI.
- Fail build on unmapped target property.
- Fail build on processor warnings in strict modules where possible.
- Include generated mapper compilation in incremental build checks.

Recommended compiler args:

```text
-Amapstruct.defaultComponentModel=spring
-Amapstruct.unmappedTargetPolicy=ERROR
-Amapstruct.suppressGeneratorTimestamp=true
-Amapstruct.suppressGeneratorVersionInfoComment=true
```

Use project-specific component model.

---

## 33. Common Anti-Patterns

FORBIDDEN:

```java
@Mapper(unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface EverythingMapper { }
```

```java
@Mapping(target = "approved", expression = "java(authzService.canApprove(source))")
```

```java
void updateEntity(UpdateRequest request, @MappingTarget CaseEntity entity);
```

without domain/update policy.

```java
@Mapper
public interface EntityMapper {
    ResponseDto toDto(JpaEntity entity);
}
```

if it causes lazy loading or entity leakage.

---

## 34. LLM Implementation Protocol

Before adding/changing a MapStruct mapper, an LLM agent MUST answer:

1. What boundary is being mapped?
2. What is the source type and target type?
3. Is mapping purely structural?
4. Are null/missing/default semantics defined?
5. Are any fields security-sensitive?
6. Does mapping touch entity/domain/event/API boundaries?
7. Are custom conversions needed?
8. What unmapped field policy applies?
9. What tests prove the mapping?

The agent MUST NOT:

- Add `ReportingPolicy.IGNORE` to make build pass.
- Add expression logic for business rules.
- Add repository/service calls in mapper.
- Mutate entities from request DTO blindly.
- Hide field drift.
- Reuse mappers across unrelated contexts.

---

## 35. Reviewer Checklist

A reviewer MUST verify:

- [ ] Mapper has clear boundary/category.
- [ ] Central `@MapperConfig` is used.
- [ ] `unmappedTargetPolicy` is strict.
- [ ] Component model matches application framework.
- [ ] No business logic/authorization/repository calls.
- [ ] Null/update semantics are explicit.
- [ ] Entity mapping does not trigger uncontrolled lazy loading.
- [ ] Security-sensitive fields are excluded.
- [ ] Enum/status mappings are explicit.
- [ ] Date/time/money/ID conversions are explicit.
- [ ] No `ReportingPolicy.IGNORE` without approval.
- [ ] Custom expressions/hooks are pure and tested.
- [ ] Generated code compiles in CI.
- [ ] Mapper tests cover edge cases.

---

## 36. References

- MapStruct Reference Guide.
- MapStruct API documentation.
- Java annotation processing documentation.
- Project standards: Java OOP, JSON, JPA/Hibernate, validation, security.
