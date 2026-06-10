# Strict Coding Standards — JPA / Jakarta Persistence

> **Target:** Java persistence code implemented with Java Persistence API / Jakarta Persistence  
> **Scope:** entities, embeddables, repositories, query construction, transactions, persistence context usage, locking, schema migration, DTO mapping, validation, provider-specific extensions, testing, and LLM implementation rules  
> **Audience:** LLM code agents, human reviewers, maintainers, tech leads  
> **Purpose:** prevent ORM-shaped but semantically broken persistence code: leaky entities, accidental lazy loading, unsafe queries, unclear transaction boundaries, invalid identity semantics, schema drift, N+1 query explosions, and `javax`/`jakarta` namespace mistakes.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing JPA/Jakarta Persistence code, an LLM agent **MUST** treat persistence as a consistency boundary, not as a convenience annotation layer.

The agent **MUST NOT** implement persistence by merely adding `@Entity`, `@Id`, `@ManyToOne`, `@Repository`, or `@Transactional` until the aggregate boundary, transaction boundary, fetch plan, identity model, and database constraints are clear.

Every persistence change **MUST** make these decisions explicit:

1. Which table or tables are affected.
2. Which entity owns the lifecycle of the data.
3. Which fields are immutable after creation.
4. Which operation starts and commits the transaction.
5. Which associations are loaded, lazy, joined, projected, or deliberately not loaded.
6. Which constraints exist in Java validation and in the database.
7. Which queries are safe from injection and accidental full scans.
8. Which concurrency mechanism protects updates.
9. Which migration script changes the schema.
10. Which test proves the mapping and query behavior.
11. Which failure mode occurs on duplicate keys, stale versions, missing rows, deadlocks, and timeout.
12. Which data is never serialized directly to API clients.

If any of these are unclear, the agent **MUST** choose the most conservative implementation and mark the uncertainty in the implementation notes or PR summary.

---

## 1. Terminology and version model

Many teams still say **JPA** even when the project uses the modern Jakarta namespace. This document uses the names carefully.

| Common name | Package namespace | Typical platform | Notes |
|---|---|---|---|
| JPA 2.2 / Jakarta Persistence 2.2 | `javax.persistence.*` | Java EE 8 / Jakarta EE 8 compatibility era | Legacy namespace. Do not mix with `jakarta.persistence.*`. |
| Jakarta Persistence 3.0 | `jakarta.persistence.*` | Jakarta EE 9 | First namespace migration release. APIs and property names moved from `javax` to `jakarta`. |
| Jakarta Persistence 3.1 | `jakarta.persistence.*` | Jakarta EE 10 | Adds post-migration improvements; commonly used by Hibernate ORM 6.x and Jakarta EE 10 stacks. |
| Jakarta Persistence 3.2 | `jakarta.persistence.*` | Jakarta EE 11 | Adds record embeddables, additional Java time mappings, JPQL/Criteria enhancements, `getSingleResultOrNull()`, and utility additions. |
| Jakarta Persistence 4.0 | `jakarta.persistence.*` | Jakarta EE 12 under development | **Forbidden by default** unless the project explicitly targets an under-development platform. |

### 1.1 Namespace rule

A project **MUST** use exactly one namespace family:

```java
// Legacy JPA / Jakarta Persistence 2.2 only
import javax.persistence.Entity;
import javax.persistence.Id;
```

```java
// Modern Jakarta Persistence only
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
```

The agent **MUST NOT** mix these in the same module:

```java
// FORBIDDEN
import javax.persistence.Entity;
import jakarta.persistence.Id;
```

The namespace is a runtime/platform compatibility decision, not a stylistic decision.

### 1.2 Dependency rule

For Jakarta Persistence 3.1+ projects:

```xml
<dependency>
    <groupId>jakarta.persistence</groupId>
    <artifactId>jakarta.persistence-api</artifactId>
    <version>3.1.0</version>
    <scope>provided</scope>
</dependency>
```

For Jakarta Persistence 3.2 projects:

```xml
<dependency>
    <groupId>jakarta.persistence</groupId>
    <artifactId>jakarta.persistence-api</artifactId>
    <version>3.2.0</version>
    <scope>provided</scope>
</dependency>
```

Rules:

1. In Jakarta EE container projects, API dependencies **SHOULD** be `provided` because the runtime supplies the implementation.
2. In Spring Boot, Quarkus, Micronaut, or standalone Java SE projects, the application **MUST** include the provider integration chosen by the stack, such as Hibernate ORM, EclipseLink, or a framework starter/extension.
3. The agent **MUST NOT** add only the API jar and assume persistence works.
4. The agent **MUST NOT** upgrade from `javax.persistence` to `jakarta.persistence` without checking every dependent framework, provider, bytecode enhancer, validator, and application server.
5. Provider-specific annotations **MUST** be isolated and justified.

### 1.3 Runtime ownership rule

The agent **MUST** identify who owns each concern.

| Concern | Usually owned by |
|---|---|
| Entity mapping | Entity classes + ORM metadata |
| Transaction boundary | Service/application layer |
| Persistence context lifecycle | Container/framework/runtime |
| Query implementation | Repository/DAO/query object |
| Business invariants | Domain model + application service |
| Schema migration | Flyway/Liquibase/manual SQL migration, not entity auto-DDL |
| Request/response serialization | DTO layer, never managed entities by default |
| Locking/concurrency | Entity versioning + service policy |
| Retry and idempotency | Application/service layer |
| Observability | Repository/service instrumentation, SQL logging in controlled environments |

Repositories **MUST NOT** own workflow decisions, authorization rules, cross-aggregate orchestration, external service calls, or long-running processes.

---

## 2. Relationship with Java version standards

This document is an overlay standard.

It **DOES NOT** replace:

- `strict-coding-standards__java11.md`
- `strict-coding-standards__java17.md`
- `strict-coding-standards__java21.md`
- `strict-coding-standards__java25.md`
- `strict-coding-standards__design_pattern_in_java.md`

The agent **MUST** first obey the Java baseline of the project.

### 2.1 Java baseline compatibility

| Java baseline | JPA/Jakarta Persistence guidance |
|---|---|
| Java 11 | Use classes for entities, DTOs, embeddables. Records are forbidden by baseline. Prefer Jakarta Persistence 3.1 only if the project is already on Jakarta namespace and provider supports Java 11. |
| Java 17 | Records may be used for DTOs. Entities must still be normal non-final classes. Record embeddables are only allowed if provider/spec version supports them. |
| Java 21 | Virtual threads do not make `EntityManager` thread-safe. Do not share persistence contexts across virtual threads. Keep transactions short. |
| Java 25 | Follow Java 25 strict standard. Do not use preview/incubator features in entity or repository code. |

### 2.2 Records and persistence

Records **MUST NOT** be used as entities.

```java
// FORBIDDEN
@Entity
public record User(Long id, String email) {
}
```

Records may be used for:

1. DTOs.
2. Query projections.
3. Value objects outside persistence.
4. Embeddables only when the project explicitly targets Jakarta Persistence 3.2+ and the chosen provider supports record embeddables correctly.

Allowed DTO:

```java
public record UserSummary(Long id, String email, String displayName) {
}
```

Allowed embeddable only with explicit Jakarta Persistence 3.2+ support:

```java
@Embeddable
public record MoneyAmount(BigDecimal amount, String currency) {
    public MoneyAmount {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
    }
}
```

If provider support is unclear, use a normal embeddable class.

---

## 3. Persistence unit and configuration standards

### 3.1 Persistence unit ownership

Every module using JPA/Jakarta Persistence **MUST** have a clear persistence unit model.

Allowed deployment models:

1. Container-managed persistence unit.
2. Framework-managed persistence unit, such as Spring Boot, Quarkus, Micronaut.
3. Java SE application-managed `EntityManagerFactory`.

Forbidden:

```java
// FORBIDDEN: ad-hoc factory construction hidden inside repositories.
public final class UserRepository {
    private final EntityManagerFactory emf = Persistence.createEntityManagerFactory("default");
}
```

Rules:

1. `EntityManagerFactory` creation **MUST** be application startup responsibility.
2. `EntityManagerFactory` **MUST** be closed during application shutdown in Java SE applications.
3. `EntityManager` **MUST NOT** be stored in static fields.
4. `EntityManager` **MUST NOT** be manually shared across requests or threads.
5. The persistence unit name **MUST** be explicit and stable.

### 3.2 `persistence.xml` rule

When using `persistence.xml`, it **MUST** be small, explicit, environment-neutral, and free of production secrets.

Allowed structure:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="https://jakarta.ee/xml/ns/persistence https://jakarta.ee/xml/ns/persistence/persistence_3_1.xsd"
             version="3.1">
    <persistence-unit name="case-management" transaction-type="JTA">
        <jta-data-source>java:/jdbc/CaseDataSource</jta-data-source>
        <properties>
            <property name="jakarta.persistence.schema-generation.database.action" value="none"/>
        </properties>
    </persistence-unit>
</persistence>
```

Rules:

1. Production schema generation **MUST** be `none` or disabled.
2. Database credentials **MUST NOT** be committed in `persistence.xml`.
3. Vendor-specific properties **MUST** be documented.
4. Persistence unit names **MUST NOT** be generic names like `default`, `main`, or `test` unless this is a small sample project.
5. Test persistence units **MUST** be isolated from production config.

### 3.3 Schema generation rule

Automatic schema generation is allowed only for:

1. Local experiments.
2. Short-lived integration tests.
3. Generated DDL review artifacts.

Forbidden in production:

```properties
hibernate.hbm2ddl.auto=update
jakarta.persistence.schema-generation.database.action=drop-and-create
```

Required for production:

1. Every schema change **MUST** have a reviewed migration script.
2. Every migration **MUST** be backward-compatible with the deployment strategy or explicitly documented as a breaking migration.
3. Entity mapping and database schema **MUST** be kept in sync by tests.
4. Indexes, foreign keys, unique constraints, check constraints, and not-null constraints **MUST** be declared in database migrations, not only in annotations.

---

## 4. Entity class standards

### 4.1 Entity shape rule

An entity **MUST** be a normal non-final class with a public or protected no-arg constructor.

Allowed:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    protected CaseRecord() {
        // Required by JPA.
    }

    public CaseRecord(String referenceNo, String title) {
        this.referenceNo = requireNonBlank(referenceNo, "referenceNo");
        this.title = requireNonBlank(title, "title");
        this.status = CaseStatus.DRAFT;
    }
}
```

Forbidden:

```java
// FORBIDDEN: final entity class.
@Entity
public final class CaseRecord {
}
```

```java
// FORBIDDEN: record entity.
@Entity
public record CaseRecord(Long id, String title) {
}
```

```java
// FORBIDDEN: no protected/public no-arg constructor.
@Entity
public class CaseRecord {
    private CaseRecord(String title) {
        this.title = title;
    }
}
```

### 4.2 Field access vs property access

The project **MUST** choose field access or property access per entity hierarchy.

Recommended default: **field access**.

Allowed:

```java
@Entity
public class Officer {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "officer_seq")
    @SequenceGenerator(name = "officer_seq", sequenceName = "officer_seq", allocationSize = 50)
    private Long id;

    @Column(name = "email", nullable = false, unique = true, length = 320)
    private String email;

    protected Officer() {
    }

    public Long id() {
        return id;
    }
}
```

Forbidden mixed access without `@Access`:

```java
// FORBIDDEN: @Id on field, @Column on getter without deliberate @Access.
@Entity
public class Officer {
    @Id
    private Long id;

    @Column(name = "email")
    public String getEmail() {
        return email;
    }
}
```

Rules:

1. Mapping annotations **MUST** be consistently placed on fields or getters.
2. Direct field access from outside the entity **MUST NOT** be allowed.
3. Fields **SHOULD** be `private`.
4. Setters **SHOULD NOT** be generated blindly.
5. Entity mutation **SHOULD** happen through intention-revealing methods.

Allowed:

```java
public void submit(OfficerId submittedBy, Instant submittedAt) {
    if (status != CaseStatus.DRAFT) {
        throw new IllegalStateException("Only draft cases may be submitted");
    }
    this.status = CaseStatus.SUBMITTED;
    this.submittedBy = Objects.requireNonNull(submittedBy, "submittedBy");
    this.submittedAt = Objects.requireNonNull(submittedAt, "submittedAt");
}
```

Avoid:

```java
// AVOID: blind mutable JavaBean entity.
public void setStatus(CaseStatus status) {
    this.status = status;
}
```

### 4.3 Table and column naming rule

Every production entity **MUST** define table and column names explicitly unless the project has a tested naming strategy.

Allowed:

```java
@Entity
@Table(
        name = "case_record",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_case_record_reference_no",
                columnNames = "reference_no"
        ),
        indexes = {
                @Index(name = "idx_case_record_status", columnList = "status"),
                @Index(name = "idx_case_record_created_at", columnList = "created_at")
        }
)
public class CaseRecord {

    @Column(name = "reference_no", nullable = false, length = 64)
    private String referenceNo;
}
```

Rules:

1. Do not rely on provider-default physical naming in shared libraries or long-lived enterprise systems.
2. Column lengths **MUST** be explicit for strings.
3. `nullable = false` **MUST** match the database `NOT NULL` constraint.
4. Unique constraints **MUST** be in database migration scripts.
5. Index annotations are documentation only unless the provider generates DDL for tests; migrations remain authoritative.

### 4.4 Entity constructor rule

Entity constructors **MUST** establish a valid initial state.

Allowed:

```java
public Application(String referenceNo, ApplicantId applicantId, Instant createdAt) {
    this.referenceNo = requireNonBlank(referenceNo, "referenceNo");
    this.applicantId = Objects.requireNonNull(applicantId, "applicantId");
    this.status = ApplicationStatus.DRAFT;
    this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
}
```

Forbidden:

```java
// FORBIDDEN: entity can be created in invalid business state.
public Application() {
    this.status = null;
}
```

The protected no-arg constructor exists for the persistence provider. It **MUST NOT** be used as a general factory in application code.

---

## 5. Entity identity, primary keys, and equality

### 5.1 Primary key rule

Every entity **MUST** have exactly one primary key definition per entity hierarchy.

Allowed primary key types:

1. `Long` / `long`.
2. `Integer` / `int` for small legacy tables only.
3. `UUID` when database and provider support are explicit.
4. `String` for externally meaningful immutable identifiers only.
5. Composite key via `@EmbeddedId` or `@IdClass` only when the database model requires it.

Forbidden:

```java
// FORBIDDEN: no primary key.
@Entity
public class AuditRecord {
    private String action;
}
```

```java
// FORBIDDEN: mutable business field used as generated identity.
@Id
private String currentEmailAddress;
```

### 5.2 ID generation rule

The ID generation strategy **MUST** match the database.

Recommended for PostgreSQL/Oracle/enterprise databases:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
@SequenceGenerator(name = "case_record_seq", sequenceName = "case_record_seq", allocationSize = 50)
@Column(name = "id", nullable = false, updatable = false)
private Long id;
```

Allowed for MySQL-style identity columns:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
@Column(name = "id", nullable = false, updatable = false)
private Long id;
```

Rules:

1. Do not use `GenerationType.AUTO` in production unless the project standard explicitly accepts provider-specific behavior.
2. Sequence `allocationSize` **MUST** align with database sequence increment or provider optimizer config.
3. IDs **MUST NOT** be changed after persistence.
4. Natural keys **MUST** be immutable if used for equality or lookup.
5. External/public IDs **SHOULD** be separate from internal database IDs when enumeration is a risk.

### 5.3 UUID rule

UUID IDs are allowed only when the database type and indexing strategy are explicit.

Allowed:

```java
@Id
@Column(name = "id", nullable = false, updatable = false, columnDefinition = "uuid")
private UUID id;
```

Rules:

1. Prefer database-native UUID types where available.
2. Do not store UUID as `VARCHAR(255)` by accident.
3. Consider index locality and insertion patterns.
4. For generated UUIDs, define whether generation is application-side or database-side.

### 5.4 Composite key rule

Composite keys are allowed only when the database identity is truly composite or when mapping legacy schemas.

Preferred:

```java
@Embeddable
public class AssignmentId implements Serializable {

    @Column(name = "case_id", nullable = false)
    private Long caseId;

    @Column(name = "officer_id", nullable = false)
    private Long officerId;

    protected AssignmentId() {
    }

    public AssignmentId(Long caseId, Long officerId) {
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.officerId = Objects.requireNonNull(officerId, "officerId");
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof AssignmentId that)) {
            return false;
        }
        return Objects.equals(caseId, that.caseId)
                && Objects.equals(officerId, that.officerId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(caseId, officerId);
    }
}
```

Rules:

1. Composite key classes **MUST** implement stable value equality.
2. Composite key fields **MUST** be immutable after persistence.
3. `@EmbeddedId` is preferred over `@IdClass` unless the existing model requires `@IdClass`.
4. Do not use entity references directly inside primary key classes unless the mapping is explicitly understood.

### 5.5 `equals` and `hashCode` rule

Entity equality is dangerous. The agent **MUST NOT** generate `equals`/`hashCode` using all fields.

Forbidden:

```java
// FORBIDDEN: includes mutable state and associations.
@Override
public boolean equals(Object other) {
    return Objects.equals(id, other.id)
            && Objects.equals(title, other.title)
            && Objects.equals(assignments, other.assignments);
}
```

Allowed strategy A: no override unless needed.

```java
@Entity
public class CaseRecord {
    // No equals/hashCode override.
}
```

Allowed strategy B: immutable natural key.

```java
@Override
public boolean equals(Object other) {
    if (this == other) {
        return true;
    }
    if (!(other instanceof CaseRecord that)) {
        return false;
    }
    return Objects.equals(referenceNo, that.referenceNo);
}

@Override
public int hashCode() {
    return Objects.hash(referenceNo);
}
```

Allowed strategy C: database ID only after assignment, with constant hash class strategy.

```java
@Override
public boolean equals(Object other) {
    if (this == other) {
        return true;
    }
    if (!(other instanceof CaseRecord that)) {
        return false;
    }
    return id != null && Objects.equals(id, that.id);
}

@Override
public int hashCode() {
    return getClass().hashCode();
}
```

Rules:

1. Never include mutable fields in entity equality.
2. Never include lazy associations in entity equality.
3. Never include collections in entity equality.
4. Do not use generated ID equality if transient entities must behave correctly in hash-based collections before persistence.
5. Prefer immutable natural keys only when the database enforces uniqueness and immutability.

### 5.6 `toString` rule

`toString()` **MUST NOT** traverse lazy associations or expose sensitive data.

Allowed:

```java
@Override
public String toString() {
    return "CaseRecord{id=" + id + ", referenceNo='" + referenceNo + "', status=" + status + "}";
}
```

Forbidden:

```java
// FORBIDDEN: may trigger lazy loading and leak data.
@Override
public String toString() {
    return "CaseRecord{" +
            "applicant=" + applicant +
            ", documents=" + documents +
            '}';
}
```

---

## 6. Field mapping standards

### 6.1 String fields

Every persisted `String` field **MUST** define length and nullability.

Allowed:

```java
@Column(name = "title", nullable = false, length = 200)
private String title;
```

Forbidden:

```java
// FORBIDDEN: provider/database default length is implicit.
@Column(name = "title")
private String title;
```

Rules:

1. Use `@Lob` only for actual large text/binary content.
2. For emails, URLs, codes, and reference numbers, set realistic maximum lengths.
3. Normalize and validate externally supplied strings before persistence.
4. Do not use `String` for structured values that need validation semantics; use embeddables or value objects where practical.

### 6.2 Enum fields

Enums **MUST** be stored as strings unless the database deliberately uses stable numeric codes.

Allowed:

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", nullable = false, length = 32)
private CaseStatus status;
```

Forbidden:

```java
// FORBIDDEN: ordinal changes silently corrupt semantics.
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Rules:

1. `EnumType.ORDINAL` is forbidden by default.
2. For legacy numeric codes, use an `AttributeConverter` with explicit mappings.
3. Database constraints **SHOULD** restrict allowed values where feasible.
4. Renaming enum constants is a data migration, not a refactor.

### 6.3 Temporal fields

Use `java.time` types.

Recommended:

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;

@Column(name = "business_date", nullable = false)
private LocalDate businessDate;
```

Rules:

1. Use `Instant` for machine timestamps.
2. Use `LocalDate` for business dates without time-of-day.
3. Use `OffsetDateTime` only when the offset is part of the domain contract.
4. Avoid `java.util.Date` and `java.sql.Timestamp` in new code.
5. Store time zone policy explicitly at the application/database boundary.
6. Do not silently use system default time zone in persistence mapping.

### 6.4 Money and decimal fields

Money **MUST NOT** be stored as `double` or `float`.

Allowed:

```java
@Column(name = "amount", nullable = false, precision = 19, scale = 4)
private BigDecimal amount;

@Column(name = "currency", nullable = false, length = 3)
private String currency;
```

Forbidden:

```java
// FORBIDDEN
private double amount;
```

Rules:

1. Define precision and scale.
2. Use explicit rounding in domain/application logic.
3. Store currency with amount unless currency is fixed by table/domain.
4. Never compare `BigDecimal` using `equals` when scale differences matter; use domain-normalized values or `compareTo` deliberately.

### 6.5 Boolean fields

Boolean persistence **MUST** be explicit when database representation is not native boolean.

Allowed:

```java
@Column(name = "active", nullable = false)
private boolean active;
```

For legacy `Y/N` columns:

```java
@Convert(converter = YesNoConverter.class)
@Column(name = "active_yn", nullable = false, length = 1)
private boolean active;
```

Rules:

1. Avoid nullable `Boolean` unless tri-state is a real domain concept.
2. Name boolean columns positively: `active`, `deleted`, `verified`, `locked`.
3. Document default values in migrations.

### 6.6 Large objects

`@Lob` is restricted.

Allowed for metadata-only entity:

```java
@Lob
@Basic(fetch = FetchType.LAZY)
@Column(name = "payload", nullable = false)
private String payload;
```

Rules:

1. Do not store large binary files in entity tables by default; prefer object storage with metadata table.
2. If using `@Lob`, define fetch policy and streaming behavior.
3. Never include LOB fields in `toString`, equality, DTO serialization, or default list queries.
4. Test memory behavior for large LOB reads.

---

## 7. Embeddables and value objects

### 7.1 Embeddable rule

Use embeddables for cohesive value groups with no independent identity.

Allowed:

```java
@Embeddable
public class Address {

    @Column(name = "address_line_1", nullable = false, length = 200)
    private String line1;

    @Column(name = "postal_code", nullable = false, length = 20)
    private String postalCode;

    protected Address() {
    }

    public Address(String line1, String postalCode) {
        this.line1 = requireNonBlank(line1, "line1");
        this.postalCode = requireNonBlank(postalCode, "postalCode");
    }
}
```

Rules:

1. Embeddables **MUST NOT** have entity identity.
2. Embeddables **SHOULD** be immutable from application perspective.
3. Embeddables **MUST** be replaced as a whole when representing value semantics.
4. Attribute overrides **MUST** be explicit when the same embeddable appears multiple times.

Allowed:

```java
@Embedded
@AttributeOverrides({
        @AttributeOverride(name = "line1", column = @Column(name = "home_line_1", nullable = false, length = 200)),
        @AttributeOverride(name = "postalCode", column = @Column(name = "home_postal_code", nullable = false, length = 20))
})
private Address homeAddress;
```

### 7.2 Attribute converter rule

Use `AttributeConverter` for single-column value mapping.

Allowed:

```java
@Converter(autoApply = false)
public final class CaseReferenceConverter implements AttributeConverter<CaseReference, String> {

    @Override
    public String convertToDatabaseColumn(CaseReference attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public CaseReference convertToEntityAttribute(String dbData) {
        return dbData == null ? null : new CaseReference(dbData);
    }
}
```

Rules:

1. Converters **MUST** be deterministic and side-effect free.
2. Converters **MUST NOT** call repositories, services, network, clock, or random generators.
3. Converters **MUST** handle `null` deliberately.
4. Auto-apply converters **MUST** be used carefully because they affect all matching fields.
5. Encryption converters **MUST** use approved cryptographic design and key management; do not invent encryption in an ORM converter.

---

## 8. Association and relationship standards

### 8.1 Default association rule

Associations **MUST** be modeled only when navigation is required in the domain or query model.

Do not add bidirectional associations just because tables have foreign keys.

Recommended default:

1. Use `@ManyToOne(fetch = FetchType.LAZY)` for child-to-parent references.
2. Avoid parent-to-child collections unless the aggregate owns the child lifecycle.
3. Prefer explicit queries for large collections.
4. Avoid `@OneToOne` unless cardinality and uniqueness are enforced in the database.
5. Avoid direct `@ManyToMany` in enterprise systems.

### 8.2 `@ManyToOne` rule

`@ManyToOne` **MUST** explicitly set `fetch = FetchType.LAZY`.

Allowed:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "case_id", nullable = false, foreignKey = @ForeignKey(name = "fk_assignment_case"))
private CaseRecord caseRecord;
```

Forbidden:

```java
// FORBIDDEN: default is eager for ManyToOne.
@ManyToOne
private CaseRecord caseRecord;
```

Rules:

1. `optional = false` **MUST** match `nullable = false` and database `NOT NULL`.
2. Foreign key names **SHOULD** be explicit.
3. Access to lazy parents outside transaction **MUST** be avoided.
4. DTO queries should project required parent fields explicitly.

### 8.3 `@OneToMany` rule

`@OneToMany` collections are allowed only when the parent genuinely owns the collection lifecycle or strongly needs navigation.

Allowed aggregate-owned children:

```java
@OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
private final List<CaseNote> notes = new ArrayList<>();

public void addNote(String body, OfficerId createdBy, Instant createdAt) {
    CaseNote note = new CaseNote(this, body, createdBy, createdAt);
    notes.add(note);
}

public void removeNote(CaseNote note) {
    notes.remove(note);
    note.detachFromCase();
}
```

Rules:

1. Collections **MUST** be initialized.
2. Exposed collections **MUST** be read-only views.
3. Mutations **MUST** maintain both sides of bidirectional relationships.
4. Large collections **MUST NOT** be loaded just to count, page, or search.
5. `orphanRemoval = true` **MUST** mean deleting the child row is semantically correct.

Forbidden:

```java
// FORBIDDEN: public mutable collection.
public List<CaseNote> notes;
```

```java
// FORBIDDEN: exposes internal mutable collection.
public List<CaseNote> getNotes() {
    return notes;
}
```

Allowed:

```java
public List<CaseNote> notes() {
    return Collections.unmodifiableList(notes);
}
```

### 8.4 Bidirectional association rule

Bidirectional relationships **MUST** have helper methods that maintain both sides.

Allowed:

```java
public void assignOfficer(Officer officer, Instant assignedAt) {
    CaseAssignment assignment = new CaseAssignment(this, officer, assignedAt);
    assignments.add(assignment);
    officer.addAssignmentInternal(assignment);
}
```

Rules:

1. Exactly one side is the owning side.
2. `mappedBy` **MUST** match the owning field name.
3. Helper methods **MUST** prevent inconsistent object graphs.
4. Serialization of bidirectional entity graphs is forbidden.

### 8.5 Cascade rule

Cascade must express lifecycle ownership, not developer convenience.

Allowed:

```java
@OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
private final List<CaseNote> notes = new ArrayList<>();
```

Forbidden by default:

```java
// FORBIDDEN unless explicitly justified.
@ManyToOne(cascade = CascadeType.ALL)
private Officer officer;
```

Rules:

1. `CascadeType.REMOVE` from child to parent is forbidden.
2. `CascadeType.ALL` on `@ManyToOne` is forbidden by default.
3. Cascading from aggregate root to owned child is allowed.
4. Cascading across aggregate boundaries is forbidden unless explicitly justified.
5. Bulk deletes **MUST** be reviewed for cascade side effects.

### 8.6 `@ManyToMany` rule

Direct `@ManyToMany` is forbidden by default in enterprise applications.

Forbidden:

```java
// FORBIDDEN by default.
@ManyToMany
private Set<Role> roles;
```

Preferred join entity:

```java
@Entity
@Table(name = "user_role")
public class UserRole {

    @EmbeddedId
    private UserRoleId id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId("userId")
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId("roleId")
    @JoinColumn(name = "role_id", nullable = false)
    private Role role;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;
}
```

Reasons:

1. Join tables often grow metadata later.
2. Direct many-to-many hides lifecycle ownership.
3. It complicates auditing, soft delete, effective dates, and authorization.
4. It can produce surprising delete/cascade behavior.

### 8.7 Fetch type rule

Lazy should be the default mental model.

Rules:

1. All to-one associations **MUST** explicitly state `fetch = FetchType.LAZY` unless eager loading is justified.
2. To-many associations are lazy by default but **SHOULD** still be treated as dangerous to access accidentally.
3. Do not rely on Open Session in View/Open EntityManager in View to hide lazy-loading problems.
4. Fetch plan belongs to the query/use case, not blindly to the entity mapping.

---

## 9. Fetch planning and N+1 prevention

### 9.1 Fetch plan rule

Every repository method returning entities with associations **MUST** define or document its fetch plan.

Allowed:

```java
public Optional<CaseRecord> findDetailsById(Long id) {
    return entityManager.createQuery("""
            select c
            from CaseRecord c
            left join fetch c.assignments a
            left join fetch a.officer
            where c.id = :id
            """, CaseRecord.class)
            .setParameter("id", id)
            .getResultStream()
            .findFirst();
}
```

Allowed with entity graph:

```java
EntityGraph<?> graph = entityManager.getEntityGraph("CaseRecord.details");
return entityManager.find(
        CaseRecord.class,
        id,
        Map.of("jakarta.persistence.fetchgraph", graph)
);
```

Rules:

1. The default fetch plan **MUST NOT** be assumed safe.
2. Query-level fetch decisions **MUST** be visible in repository code.
3. API list endpoints **MUST** use DTO projections or carefully bounded entity fetches.
4. N+1 query risk **MUST** be tested for important list queries.

### 9.2 Collection fetch join pagination rule

Pagination with collection fetch joins is forbidden by default.

Forbidden:

```java
// FORBIDDEN: collection fetch join + pagination can produce wrong memory behavior/results.
entityManager.createQuery("""
        select c
        from CaseRecord c
        left join fetch c.notes
        order by c.createdAt desc
        """, CaseRecord.class)
        .setFirstResult(page * size)
        .setMaxResults(size)
        .getResultList();
```

Preferred two-step pattern:

```java
List<Long> ids = entityManager.createQuery("""
        select c.id
        from CaseRecord c
        where c.status = :status
        order by c.createdAt desc
        """, Long.class)
        .setParameter("status", status)
        .setFirstResult(page * size)
        .setMaxResults(size)
        .getResultList();

if (ids.isEmpty()) {
    return List.of();
}

return entityManager.createQuery("""
        select distinct c
        from CaseRecord c
        left join fetch c.notes
        where c.id in :ids
        """, CaseRecord.class)
        .setParameter("ids", ids)
        .getResultList();
```

Rules:

1. Page IDs first.
2. Then fetch details by IDs.
3. Restore ordering if required.
4. Test generated SQL and row count.

### 9.3 DTO projection rule

Use DTO projections for read-heavy list views.

Allowed:

```java
public List<CaseListItem> findCaseList(CaseStatus status, int offset, int limit) {
    return entityManager.createQuery("""
            select new com.acme.caseapp.CaseListItem(
                c.id,
                c.referenceNo,
                c.title,
                c.status,
                c.createdAt
            )
            from CaseRecord c
            where c.status = :status
            order by c.createdAt desc
            """, CaseListItem.class)
            .setParameter("status", status)
            .setFirstResult(offset)
            .setMaxResults(limit)
            .getResultList();
}
```

Rules:

1. Do not load full aggregates for simple lists.
2. DTO projections **MUST** include only fields needed by the use case.
3. DTO constructor package names in JPQL **MUST** be updated during refactors.
4. For complex reports, consider native SQL/read model rather than contorting entity graphs.

---

## 10. Transaction boundary standards

### 10.1 Service layer transaction rule

Transactions **MUST** be started at service/application use-case boundary, not inside entity classes or arbitrary helper methods.

Allowed:

```java
@Transactional
public CaseDto submitCase(Long caseId, SubmitCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findForUpdate(caseId)
            .orElseThrow(() -> new CaseNotFoundException(caseId));

    caseRecord.submit(command.submittedBy(), clock.instant());
    return caseMapper.toDto(caseRecord);
}
```

Forbidden:

```java
// FORBIDDEN: transaction boundary hidden inside repository for workflow.
public void submitCase(Long caseId) {
    entityManager.getTransaction().begin();
    // business workflow here
    entityManager.getTransaction().commit();
}
```

Rules:

1. One use case should usually equal one transaction.
2. Transactions **MUST** be short.
3. Do not perform slow network calls inside database transactions unless explicitly required and protected.
4. Do not hold transactions open across user think time, file upload streaming, or external approvals.
5. Do not return lazy entities outside transaction.

### 10.2 Read-only transaction rule

Read operations **SHOULD** use read-only transactions if supported by the framework.

Allowed in Spring-style code:

```java
@Transactional(readOnly = true)
public Page<CaseListItem> listCases(CaseSearchCriteria criteria, Pageable pageable) {
    return caseRepository.search(criteria, pageable);
}
```

Rules:

1. Read-only is an optimization and intent marker, not a substitute for query safety.
2. Read-only methods **MUST NOT** mutate managed entities.
3. A method that modifies entities **MUST NOT** be marked read-only.

### 10.3 Flush rule

The agent **MUST NOT** call `flush()` casually.

Allowed:

```java
entityManager.persist(caseRecord);
entityManager.flush(); // Required to surface unique constraint violation before creating dependent audit row.
```

Rules:

1. `flush()` is allowed when ordering or early constraint detection is required.
2. `flush()` **MUST** be commented when non-obvious.
3. `clear()` **MUST** be used in batch jobs to avoid persistence context growth.
4. Do not rely on flush timing for domain logic unless documented.

### 10.4 Transaction propagation rule

Transaction propagation **MUST** be deliberate.

Forbidden by default:

1. `REQUIRES_NEW` for hiding failures.
2. Nested transactions without a clear consistency model.
3. Async method invocation using managed entities from the caller transaction.
4. Starting database transactions inside entity listeners.

Allowed with justification:

1. Audit/outbox write with clearly documented failure semantics.
2. Retryable unit of work isolated from caller transaction.
3. Saga/process step with explicit compensation model.

---

## 11. EntityManager and persistence context standards

### 11.1 EntityManager lifecycle rule

`EntityManager` is persistence-context scoped. It **MUST NOT** be treated as a thread-safe singleton.

Allowed container/framework injection:

```java
@PersistenceContext
private EntityManager entityManager;
```

Allowed constructor injection wrapper:

```java
@Repository
public class CaseRepository {

    private final EntityManager entityManager;

    public CaseRepository(EntityManager entityManager) {
        this.entityManager = Objects.requireNonNull(entityManager, "entityManager");
    }
}
```

Forbidden:

```java
// FORBIDDEN
private static EntityManager entityManager;
```

```java
// FORBIDDEN
CompletableFuture.supplyAsync(() -> entityManager.find(CaseRecord.class, id));
```

Rules:

1. Do not pass managed entities across threads.
2. Do not access lazy associations in async tasks after transaction completion.
3. Do not cache `EntityManager` in static state.
4. Do not manually close container-managed `EntityManager`.
5. In Java SE, close application-managed `EntityManager` in `finally`/try-with-resources-like lifecycle wrapper.

### 11.2 Managed vs detached entity rule

The agent **MUST** know whether an entity is managed or detached before mutating it.

Rules:

1. Mutating a managed entity inside a transaction is tracked.
2. Mutating a detached entity does nothing until merged or explicitly handled.
3. `merge()` returns a managed copy; the passed detached instance remains detached.
4. Do not use `merge()` as a blind update patch mechanism from API DTOs.
5. Load managed entity, apply validated command, commit.

Forbidden:

```java
// FORBIDDEN: blind merge of client-controlled graph.
public User update(User userFromRequest) {
    return entityManager.merge(userFromRequest);
}
```

Allowed:

```java
public User updateUser(Long id, UpdateUserCommand command) {
    User user = entityManager.find(User.class, id);
    if (user == null) {
        throw new UserNotFoundException(id);
    }
    user.changeDisplayName(command.displayName());
    user.changePhone(command.phone());
    return user;
}
```

### 11.3 `getReference` rule

`getReference()` is restricted.

Allowed:

```java
CaseRecord caseRef = entityManager.getReference(CaseRecord.class, caseId);
CaseNote note = new CaseNote(caseRef, body, createdAt);
entityManager.persist(note);
```

Rules:

1. Use `getReference()` only when an actual lazy proxy reference is intended.
2. Do not access fields on the reference unless the transaction is open and missing-row behavior is understood.
3. For validation that a row exists, use `find()` or an existence query.

---

## 12. Repository and DAO standards

### 12.1 Repository responsibility rule

Repositories **MUST** encapsulate persistence mechanics, not business workflows.

Allowed repository responsibilities:

1. `findById`.
2. `findByBusinessKey`.
3. `existsBy...`.
4. `save`/`persist` when aligned with framework convention.
5. Purpose-specific queries.
6. Pagination/sorting at database level.
7. Locking query variants.

Forbidden repository responsibilities:

1. Approving a case.
2. Sending email.
3. Calling external APIs.
4. Deciding authorization.
5. Mutating multiple aggregates as workflow orchestration.
6. Swallowing persistence exceptions and returning misleading defaults.

### 12.2 Method naming rule

Repository method names **MUST** reveal query intent and cardinality.

Allowed:

```java
Optional<CaseRecord> findByReferenceNo(String referenceNo);
List<CaseListItem> findOpenCasesAssignedTo(OfficerId officerId, int offset, int limit);
boolean existsByReferenceNo(String referenceNo);
long countByStatus(CaseStatus status);
```

Forbidden:

```java
// FORBIDDEN: unclear cardinality and intent.
Object getData(String value);
List<?> query(Map<String, Object> params);
```

Rules:

1. Use `Optional<T>` for zero-or-one results.
2. Use `List<T>` for bounded result sets.
3. Use `Stream<T>` only with explicit transaction/resource lifecycle.
4. Use `Page<T>`/cursor objects when pagination metadata is required.
5. Never return `null` collections.

### 12.3 Save method rule

`save()` semantics **MUST** be clear.

In pure JPA:

```java
public void add(CaseRecord caseRecord) {
    entityManager.persist(caseRecord);
}
```

For updates:

```java
public CaseRecord requireManaged(Long id) {
    CaseRecord found = entityManager.find(CaseRecord.class, id);
    if (found == null) {
        throw new CaseNotFoundException(id);
    }
    return found;
}
```

Rules:

1. `persist()` is for new entities.
2. `merge()` is for detached state with understood semantics.
3. Do not implement generic save methods unless framework convention requires it.
4. Do not call both `persist()` and `merge()` blindly.

---

## 13. Query standards

### 13.1 Parameter binding rule

All queries **MUST** use bind parameters.

Allowed:

```java
return entityManager.createQuery("""
        select c
        from CaseRecord c
        where c.referenceNo = :referenceNo
        """, CaseRecord.class)
        .setParameter("referenceNo", referenceNo)
        .getResultStream()
        .findFirst();
```

Forbidden:

```java
// FORBIDDEN: injection risk and broken escaping.
String jpql = "select c from CaseRecord c where c.referenceNo = '" + referenceNo + "'";
```

Rules:

1. Named parameters are preferred over positional parameters.
2. Dynamic sorting **MUST** use allow-listed fields.
3. Dynamic filtering **MUST** use Criteria API, query builder, or carefully composed static fragments.
4. Never concatenate user input into JPQL/SQL.
5. Native queries follow the same binding rules.

### 13.2 Typed query rule

Use typed queries whenever a result type is known.

Allowed:

```java
TypedQuery<CaseRecord> query = entityManager.createQuery(
        "select c from CaseRecord c where c.status = :status",
        CaseRecord.class
);
```

Forbidden:

```java
// FORBIDDEN by default: raw query with casts.
Query query = entityManager.createQuery("select c from CaseRecord c");
List<CaseRecord> result = (List<CaseRecord>) query.getResultList();
```

### 13.3 `getSingleResult` rule

`getSingleResult()` is restricted because it throws for zero and multiple results.

Preferred Java Persistence 2.2-compatible pattern:

```java
public Optional<CaseRecord> findByReferenceNo(String referenceNo) {
    return entityManager.createQuery("""
            select c
            from CaseRecord c
            where c.referenceNo = :referenceNo
            """, CaseRecord.class)
            .setParameter("referenceNo", referenceNo)
            .setMaxResults(2)
            .getResultStream()
            .findFirst();
}
```

For uniqueness verification:

```java
List<CaseRecord> results = entityManager.createQuery("""
        select c
        from CaseRecord c
        where c.referenceNo = :referenceNo
        """, CaseRecord.class)
        .setParameter("referenceNo", referenceNo)
        .setMaxResults(2)
        .getResultList();

if (results.size() > 1) {
    throw new NonUniqueCaseReferenceException(referenceNo);
}
return results.stream().findFirst();
```

For Jakarta Persistence 3.2+, `getSingleResultOrNull()` may be used when provider support is confirmed.

Rules:

1. Do not catch `NoResultException` as normal control flow unless project style accepts it.
2. Always consider the non-unique case.
3. Use database unique constraints for uniqueness; application checks are not enough.

### 13.4 Pagination rule

All unbounded list queries are forbidden by default.

Allowed:

```java
public List<CaseListItem> search(CaseSearchCriteria criteria, int offset, int limit) {
    validatePage(offset, limit);
    return entityManager.createQuery(buildQuery(criteria), CaseListItem.class)
            .setFirstResult(offset)
            .setMaxResults(limit)
            .getResultList();
}
```

Rules:

1. Every list endpoint **MUST** define a maximum page size.
2. Stable ordering **MUST** be specified.
3. Offset pagination is acceptable for small/medium datasets.
4. Keyset/cursor pagination is preferred for high-volume tables.
5. Count queries **MUST** be optimized separately for complex filters.

### 13.5 Dynamic sorting rule

Dynamic sorting **MUST** be allow-listed.

Allowed:

```java
private static final Map<String, String> SORT_FIELDS = Map.of(
        "createdAt", "c.createdAt",
        "referenceNo", "c.referenceNo",
        "status", "c.status"
);

private String toOrderBy(String requestedSort) {
    String expression = SORT_FIELDS.get(requestedSort);
    if (expression == null) {
        throw new IllegalArgumentException("Unsupported sort: " + requestedSort);
    }
    return expression;
}
```

Forbidden:

```java
// FORBIDDEN
String jpql = "select c from CaseRecord c order by c." + sortFromRequest;
```

### 13.6 Native query rule

Native SQL is allowed when JPQL/Criteria is insufficient, but it must be isolated and tested.

Allowed:

```java
public List<CaseAgingRow> findAgingReport(Instant cutoff) {
    return entityManager.createNativeQuery("""
            select c.status as status, count(*) as count
            from case_record c
            where c.created_at < :cutoff
            group by c.status
            """, "CaseAgingRowMapping")
            .setParameter("cutoff", cutoff)
            .getResultList();
}
```

Rules:

1. Native query names **MUST** describe the use case.
2. Native SQL **MUST** be covered by integration tests on the target database or Testcontainers-compatible equivalent.
3. User input **MUST** still use bind parameters.
4. Vendor-specific SQL **MUST** be documented.
5. Native queries **MUST NOT** bypass tenant/security filters accidentally.

---

## 14. Locking and concurrency standards

### 14.1 Versioning rule

Mutable aggregate roots **SHOULD** have an optimistic version field.

Allowed:

```java
@Version
@Column(name = "version", nullable = false)
private long version;
```

Rules:

1. `@Version` fields **MUST NOT** be modified by application code.
2. API update commands **SHOULD** include version/ETag when clients edit stale data.
3. Optimistic lock failures **MUST** be mapped to a meaningful application error.
4. Retry on optimistic failure **MUST** be deliberate, not automatic for user-driven decisions.

### 14.2 Optimistic locking rule

Use optimistic locking for normal concurrent updates.

Allowed:

```java
CaseRecord caseRecord = entityManager.find(
        CaseRecord.class,
        id,
        LockModeType.OPTIMISTIC
);
```

Rules:

1. Use `OPTIMISTIC_FORCE_INCREMENT` only when a read changes concurrency semantics.
2. Do not catch optimistic lock exceptions and overwrite anyway.
3. Client-facing APIs should return conflict semantics, usually HTTP 409 in REST layers.

### 14.3 Pessimistic locking rule

Pessimistic locks are restricted.

Allowed:

```java
CaseRecord caseRecord = entityManager.find(
        CaseRecord.class,
        id,
        LockModeType.PESSIMISTIC_WRITE,
        Map.of("jakarta.persistence.lock.timeout", 1000)
);
```

Rules:

1. Pessimistic locks **MUST** have timeout policy.
2. Pessimistic locks **MUST** keep transactions short.
3. Do not call external services while holding database locks.
4. Deadlock and timeout behavior **MUST** be tested or documented.
5. Lock ordering **MUST** be consistent when multiple rows/tables are locked.

### 14.4 Idempotency and uniqueness rule

Database uniqueness is the final guard for idempotency.

Allowed:

```java
@Table(
        name = "idempotency_key",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_idempotency_key_scope_key",
                columnNames = {"scope", "key_value"}
        )
)
public class IdempotencyKey {
}
```

Rules:

1. Application-level existence checks are race-prone without unique constraints.
2. Duplicate key exceptions **MUST** be translated into domain/application errors.
3. Idempotency records **MUST** have retention policy.

---

## 15. Deletion, soft delete, and archival standards

### 15.1 Delete rule

Delete semantics **MUST** be explicit.

Allowed physical delete only for owned child data:

```java
caseRecord.removeNote(noteId);
```

Rules:

1. Physical delete is allowed for aggregate-owned children when legally/business acceptable.
2. Aggregate root deletion **MUST** be reviewed for audit, legal retention, references, and reporting.
3. Delete operations **MUST** define cascade behavior.
4. Bulk delete queries bypass entity lifecycle callbacks and persistence context state; use carefully.

### 15.2 Soft delete rule

Soft delete is allowed only with a complete query/filter strategy.

Allowed:

```java
@Column(name = "deleted", nullable = false)
private boolean deleted;

@Column(name = "deleted_at")
private Instant deletedAt;
```

Rules:

1. Every query must consistently exclude deleted records unless explicitly needed.
2. Unique constraints may need partial indexes or business-specific treatment.
3. Soft-deleted data still exists for privacy/security purposes.
4. Soft delete does not replace archival or retention policy.
5. Provider-specific soft-delete annotations **MUST** be documented.

### 15.3 Archival rule

Archival **MUST** be designed as data lifecycle, not accidental table cleanup.

Rules:

1. Define retention period.
2. Define whether archived data is queryable.
3. Define referential integrity strategy.
4. Define audit and legal hold behavior.
5. Avoid loading large archives into ORM-managed graphs.

---

## 16. DTO, API, and serialization standards

### 16.1 Entity exposure rule

Entities **MUST NOT** be used as API request/response models by default.

Forbidden:

```java
// FORBIDDEN
@GET
@Path("/{id}")
public CaseRecord getCase(@PathParam("id") Long id) {
    return caseService.getCase(id);
}
```

Allowed:

```java
@GET
@Path("/{id}")
public CaseResponse getCase(@PathParam("id") Long id) {
    return caseService.getCase(id);
}
```

Rules:

1. API DTOs **MUST** be separate from persistence entities.
2. Request DTOs **MUST NOT** contain entity graphs.
3. Response DTOs **MUST** be built inside a known transaction/fetch plan.
4. Lazy loading during JSON serialization is forbidden.
5. Do not annotate entities with JSON serialization annotations unless the project explicitly accepts this coupling.

### 16.2 Mapper rule

Mapping **MUST** be explicit and testable.

Allowed:

```java
public CaseResponse toResponse(CaseRecord caseRecord) {
    return new CaseResponse(
            caseRecord.id(),
            caseRecord.referenceNo(),
            caseRecord.title(),
            caseRecord.status().name(),
            caseRecord.createdAt()
    );
}
```

Rules:

1. Mapping must not accidentally trigger lazy loading.
2. Mapping must not expose internal IDs when public IDs are required.
3. Mapping must handle nullability deliberately.
4. Automated mappers are allowed only with tests for non-trivial mappings.

### 16.3 Command-to-entity update rule

Do not bind client payloads directly into managed entities.

Forbidden:

```java
// FORBIDDEN
public void update(CaseRecord requestBodyEntity) {
    entityManager.merge(requestBodyEntity);
}
```

Allowed:

```java
public void updateCase(Long id, UpdateCaseCommand command) {
    CaseRecord caseRecord = caseRepository.requireById(id);
    caseRecord.rename(command.title());
    caseRecord.changeCategory(command.category());
}
```

Rules:

1. Commands express requested changes.
2. Entities enforce invariants.
3. Repositories load managed state.
4. Services coordinate transaction and authorization.

---

## 17. Validation standards

### 17.1 Bean Validation rule

Bean Validation annotations are allowed but are not the whole invariant model.

Allowed:

```java
@Column(name = "reference_no", nullable = false, length = 64, unique = true)
@NotBlank
@Size(max = 64)
private String referenceNo;
```

Rules:

1. Validation annotations **MUST** align with column constraints.
2. Business state transitions **MUST** be enforced by domain methods, not only annotations.
3. Cross-field invariants **MUST** be enforced in constructors/factories/domain methods or custom validators.
4. Validation groups **MUST** be documented if used.
5. Database constraints remain required for critical integrity.

### 17.2 Nullability rule

Nullability **MUST** be consistent across Java, validation, JPA mapping, and database.

Required alignment:

```java
@NotNull
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;
```

Rules:

1. `Optional` **MUST NOT** be used as entity field type.
2. Nullable fields **MUST** represent real domain optionality.
3. Primitive fields imply non-null database semantics and default-value behavior must be understood.
4. Do not use empty string as null unless legacy schema requires it.

---

## 18. Lifecycle callbacks and auditing

### 18.1 Lifecycle callback rule

Entity lifecycle callbacks must be simple, deterministic, and local.

Allowed:

```java
@PrePersist
void beforeInsert() {
    Instant now = Instant.now(clock()); // Prefer injected auditing infrastructure when available.
    this.createdAt = now;
    this.updatedAt = now;
}

@PreUpdate
void beforeUpdate() {
    this.updatedAt = Instant.now(clock());
}
```

Better in framework-managed auditing:

```java
@CreatedDate
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;

@LastModifiedDate
@Column(name = "updated_at", nullable = false)
private Instant updatedAt;
```

Forbidden:

```java
// FORBIDDEN
@PostPersist
void afterPersist() {
    emailClient.sendEmail(...);
}
```

Rules:

1. Lifecycle callbacks **MUST NOT** call external services.
2. Lifecycle callbacks **MUST NOT** query repositories.
3. Lifecycle callbacks **MUST NOT** publish messages directly.
4. Lifecycle callbacks **MUST NOT** perform authorization checks.
5. Auditing must work consistently in tests and batch jobs.

### 18.2 Domain event and outbox rule

Do not publish external events directly from JPA callbacks.

Preferred:

1. Entity records domain event in memory.
2. Service/application layer persists aggregate and outbox record in same transaction.
3. Outbox dispatcher publishes after commit.

Allowed model:

```java
caseRecord.submit(officerId, clock.instant());
outboxRepository.add(OutboxEvent.caseSubmitted(caseRecord.id(), caseRecord.version()));
```

Rules:

1. External message publication must not happen before transaction commit.
2. Outbox table must have idempotency and retry metadata.
3. Event payloads must not require lazy loading after transaction close.

---

## 19. Batch processing standards

### 19.1 Batch insert/update rule

Large batch operations **MUST** control persistence context size.

Allowed:

```java
for (int i = 0; i < records.size(); i++) {
    entityManager.persist(records.get(i));

    if (i > 0 && i % batchSize == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Rules:

1. Batch size **MUST** be configurable.
2. Use `flush()` and `clear()` for large batches.
3. Do not load entire large datasets into memory.
4. Use cursor/streaming APIs only with transaction/resource lifecycle control.
5. Provider JDBC batching must be explicitly configured and tested.

### 19.2 Bulk update/delete rule

JPQL bulk updates/deletes bypass entity state synchronization and lifecycle callbacks.

Allowed only with clear persistence context handling:

```java
int updated = entityManager.createQuery("""
        update CaseRecord c
        set c.status = :archived
        where c.status = :closed
          and c.closedAt < :cutoff
        """)
        .setParameter("archived", CaseStatus.ARCHIVED)
        .setParameter("closed", CaseStatus.CLOSED)
        .setParameter("cutoff", cutoff)
        .executeUpdate();

entityManager.clear();
```

Rules:

1. Bulk operations **MUST** be in dedicated service methods.
2. Clear persistence context after bulk mutation if managed entities may be stale.
3. Do not expect entity callbacks or validation to run.
4. Bulk operations **MUST** be audited if they affect business records.

---

## 20. Error handling standards

### 20.1 Persistence exception translation rule

Persistence exceptions **MUST** be translated at the boundary into application errors.

Examples:

| Persistence failure | Application meaning |
|---|---|
| Unique constraint violation | Duplicate business key / idempotent replay |
| Optimistic lock exception | Stale update / conflict |
| Lock timeout | Resource busy / retryable contention |
| Query timeout | Backend timeout / degraded dependency |
| Entity not found | Missing domain object, unless optional lookup |
| Data integrity violation | Invalid state or migration/schema mismatch |

Rules:

1. Do not leak SQL error messages to API clients.
2. Do not swallow exceptions and return empty results unless empty is semantically correct.
3. Log enough diagnostic information without leaking secrets or personal data.
4. Retry only known transient failures.
5. Do not retry non-idempotent writes without idempotency protection.

### 20.2 Missing row rule

Missing rows **MUST** be modeled explicitly.

Allowed:

```java
public CaseRecord requireById(Long id) {
    CaseRecord found = entityManager.find(CaseRecord.class, id);
    if (found == null) {
        throw new CaseNotFoundException(id);
    }
    return found;
}
```

Rules:

1. `Optional<T>` for repository lookup.
2. Domain-specific not-found exception for required use cases.
3. Do not return `null` from service methods unless legacy contract requires it.

---

## 21. Security standards

### 21.1 Query injection rule

All external input **MUST** be bind parameters or validated allow-list values.

Forbidden:

```java
// FORBIDDEN
String sql = "select * from users where role = '" + role + "'";
```

Allowed:

```java
entityManager.createQuery("""
        select u
        from User u
        where u.role = :role
        """, User.class)
        .setParameter("role", role);
```

### 21.2 Authorization rule

Persistence filters are not a substitute for authorization.

Rules:

1. Service/application layer **MUST** enforce authorization.
2. Repository queries **MAY** include tenant/ownership filters, but they must not be the only authorization control unless this is the documented architecture.
3. Multi-tenant filters **MUST** be tested for bypass.
4. Native queries **MUST** include tenant/security constraints explicitly.
5. Do not expose entity IDs that allow unauthorized enumeration unless protected.

### 21.3 Sensitive data rule

Sensitive data mapping **MUST** be deliberate.

Rules:

1. Mark sensitive columns in code comments or annotations where project standard supports it.
2. Do not include sensitive fields in logs, `toString`, exception messages, or DTOs.
3. Encryption-at-rest decisions **MUST** be architecture-level decisions.
4. Hashing, encryption, masking, and tokenization **MUST NOT** be invented ad hoc inside entities.
5. Audit access to sensitive data where required.

---

## 22. Provider-specific extension standards

### 22.1 Provider isolation rule

Provider-specific annotations are allowed only when they buy concrete value and are isolated.

Examples:

```java
// Hibernate-specific. Must be justified and documented.
@org.hibernate.annotations.BatchSize(size = 50)
private List<CaseNote> notes;
```

Rules:

1. Prefer standard Jakarta Persistence annotations when sufficient.
2. Provider-specific annotations **MUST** be documented with reason and portability impact.
3. Do not use provider extensions in shared libraries unless the library explicitly targets that provider.
4. Tests **MUST** run against the chosen provider.

### 22.2 Hibernate-specific caution

For Hibernate-based projects:

1. Do not use `Session` API unless JPA API is insufficient.
2. Do not rely on Hibernate proxy class names in business logic.
3. Use bytecode enhancement only when project build supports it consistently.
4. Lazy loading outside transaction is a bug unless explicitly designed.
5. SQL logging with bind parameters is for controlled environments only; avoid leaking sensitive data.

### 22.3 EclipseLink-specific caution

For EclipseLink-based projects:

1. Do not copy Hibernate-specific annotations.
2. Use EclipseLink hints only where tested.
3. Document weaving requirements.
4. Ensure lazy loading and fetch group behavior are covered by integration tests.

---

## 23. Schema migration standards

### 23.1 Migration file rule

Every entity mapping change that affects schema **MUST** have a migration.

Examples requiring migration:

1. New entity/table.
2. New column.
3. Column length/precision change.
4. Nullability change.
5. New index.
6. New unique constraint.
7. Foreign key change.
8. Enum value storage change.
9. Table/column rename.
10. Data backfill.

Rules:

1. Migration names **MUST** describe intent.
2. Destructive migrations **MUST** have rollback or recovery notes.
3. Backfills **MUST** be safe for large datasets.
4. Long-running migrations **MUST** be separated from application deployments when needed.
5. Zero-downtime deployments **MUST** use expand/contract patterns.

### 23.2 Expand/contract rule

For backward-compatible deployment:

1. Add nullable column or new table.
2. Deploy app writing both old and new shapes if required.
3. Backfill data.
4. Switch reads.
5. Enforce constraints.
6. Remove old column later.

The agent **MUST NOT** generate a breaking rename/drop migration without deployment impact notes.

### 23.3 Database constraint rule

Critical integrity **MUST** be enforced by the database.

Required for important fields:

1. `NOT NULL`.
2. Foreign keys.
3. Unique constraints.
4. Check constraints for bounded states where feasible.
5. Indexes supporting frequent filters and joins.

JPA annotations are not enough.

---

## 24. Testing standards

### 24.1 Mapping test rule

Every non-trivial entity mapping **MUST** have an integration test.

Test should verify:

1. Persist and reload.
2. Nullability/constraint behavior.
3. Enum storage.
4. Relationship ownership.
5. Cascade/orphan behavior.
6. Version increment when expected.
7. Query behavior.

Allowed:

```java
@Test
void persistsAndReloadsCaseRecord() {
    CaseRecord created = new CaseRecord("CASE-001", "Unsafe practice complaint");
    entityManager.persist(created);
    entityManager.flush();
    entityManager.clear();

    CaseRecord reloaded = entityManager.find(CaseRecord.class, created.id());

    assertThat(reloaded.referenceNo()).isEqualTo("CASE-001");
    assertThat(reloaded.status()).isEqualTo(CaseStatus.DRAFT);
}
```

### 24.2 Repository query test rule

Every custom query **MUST** have tests for:

1. Empty result.
2. Single result.
3. Multiple results.
4. Pagination boundaries.
5. Sorting.
6. Filters.
7. Null parameters if allowed.
8. Authorization/tenant predicates if applicable.

### 24.3 N+1 test rule

Important list/detail queries **SHOULD** have query count tests or SQL inspection.

Rules:

1. Query count tests are most valuable for high-traffic endpoints.
2. Do not assert fragile exact SQL unless necessary.
3. Assert number of selects or absence of lazy loading where practical.

### 24.4 Database realism rule

Use the real target database in integration tests when behavior differs by database.

Rules:

1. H2 is not a universal substitute for PostgreSQL, Oracle, MySQL, or SQL Server.
2. Testcontainers or equivalent real database tests are preferred for native queries, locking, migration, JSON/array types, UUID, case sensitivity, and date/time behavior.
3. In-memory DB tests may be used for fast smoke tests but not as the only source of truth for complex persistence behavior.

### 24.5 Migration test rule

Migrations **SHOULD** be tested by applying them to an empty schema and, for important systems, to a representative previous schema snapshot.

Rules:

1. Validate entity mappings against migrated schema.
2. Test data backfills with realistic row counts when possible.
3. Test rollback/recovery notes for destructive changes.

---

## 25. Performance standards

### 25.1 ORM performance mental model

JPA is not magic. Every entity navigation may become SQL.

The agent **MUST** reason about:

1. Number of SQL statements.
2. Number of rows read.
3. Number of columns read.
4. Join cardinality.
5. Index support.
6. Persistence context memory growth.
7. Flush behavior.
8. Lock duration.
9. Serialization side effects.

### 25.2 High-volume read rule

For high-volume reads:

1. Prefer DTO projections.
2. Use pagination/cursors.
3. Avoid loading large graphs.
4. Avoid `select *` native queries.
5. Avoid per-row repository calls.
6. Consider read models/materialized views when query shape is report-like.

### 25.3 High-volume write rule

For high-volume writes:

1. Batch with flush/clear.
2. Avoid unnecessary entity reads.
3. Use bulk SQL where entity lifecycle is not needed.
4. Use database-side constraints.
5. Keep transactions bounded.
6. Measure memory and SQL statement count.

### 25.4 Index awareness rule

Every query added by the agent **MUST** identify likely index requirements.

Example:

```sql
create index idx_case_record_status_created_at
    on case_record (status, created_at desc);
```

Rules:

1. Index order must match filter/sort patterns.
2. Foreign key columns usually need indexes for joins and deletes.
3. Unique constraints often create indexes but database behavior varies.
4. Avoid over-indexing write-heavy tables.
5. Validate query plans for critical queries.

---

## 26. Multi-tenancy standards

### 26.1 Tenant boundary rule

Multi-tenant persistence **MUST** have an explicit isolation model.

Allowed models:

1. Database per tenant.
2. Schema per tenant.
3. Shared schema with `tenant_id` discriminator.

Rules for shared schema:

1. Every tenant-owned table **MUST** include `tenant_id`.
2. Every tenant-owned unique constraint **MUST** include tenant scope unless globally unique.
3. Every repository query **MUST** filter by tenant unless intentionally global.
4. Native queries **MUST** include tenant predicate.
5. Tests **MUST** prove cross-tenant leakage is impossible for core queries.

Forbidden:

```java
// FORBIDDEN: tenant id optional in multi-tenant data.
@Column(name = "tenant_id")
private String tenantId;
```

Allowed:

```java
@Column(name = "tenant_id", nullable = false, length = 64, updatable = false)
private String tenantId;
```

---

## 27. Inheritance standards

### 27.1 Entity inheritance rule

Entity inheritance is restricted.

Allowed only when:

1. The domain genuinely has substitutable entity subtypes.
2. Query patterns support the chosen inheritance strategy.
3. Database schema impact is understood.
4. Serialization and DTO mapping are explicit.

Preferred alternatives:

1. Composition.
2. State/type enum with behavior dispatch.
3. Separate aggregate types.
4. Embeddable polymorphic details only if mapping is explicit.

### 27.2 Strategy guidance

| Strategy | Use with caution because |
|---|---|
| `SINGLE_TABLE` | Nullable subtype columns, check constraints needed, table grows wide. |
| `JOINED` | More joins, slower polymorphic queries. |
| `TABLE_PER_CLASS` | Union queries, identity complexity. |

Rules:

1. Do not introduce entity inheritance just to reuse fields.
2. Use `@MappedSuperclass` for shared mapping only when no table/entity identity is needed.
3. Inheritance changes require migration and query review.

---

## 28. Naming and package standards

### 28.1 Package layout

Recommended package layout:

```text
com.acme.caseapp.casecore
  domain
    CaseRecord.java
    CaseStatus.java
    CaseNote.java
  persistence
    JpaCaseRepository.java
    CaseQueries.java
  application
    SubmitCaseService.java
    SubmitCaseCommand.java
  api
    CaseResource.java
    CaseResponse.java
```

Alternative hexagonal layout:

```text
com.acme.caseapp.casecore
  domain
  application
  adapter
    persistence
      JpaCaseRepository.java
    rest
      CaseResource.java
```

Rules:

1. Entities belong to domain or persistence depending on architecture; do not scatter them.
2. Repositories belong to persistence adapter if using ports/adapters.
3. API DTOs **MUST NOT** live in entity packages.
4. Provider-specific classes **SHOULD** be isolated under persistence/adapter packages.

### 28.2 Naming rule

Allowed names:

1. `CaseRecord` entity.
2. `CaseRepository` interface/port.
3. `JpaCaseRepository` JPA implementation.
4. `CaseQueries` for complex query builder.
5. `CaseMapper` for entity-DTO mapping.
6. `CaseSummary` / `CaseListItem` projections.

Forbidden names:

1. `DataUtil`.
2. `CommonRepository` with unrelated queries.
3. `BaseEntityManagerHelper` with global static behavior.
4. `JpaService` doing everything.
5. `EntityDTO` ambiguous hybrid models.

---

## 29. LLM-specific implementation protocol

Before writing JPA code, the agent **MUST** answer internally and reflect in PR notes when relevant:

1. Is this a new table, new mapping to existing table, or query change?
2. Is the class an entity, embeddable, DTO, projection, or command?
3. What is the identity model?
4. What fields are immutable?
5. What invariants are enforced in constructors/methods?
6. What database constraints are required?
7. Which associations are necessary and why?
8. What is the fetch plan for each use case?
9. Where is the transaction boundary?
10. What happens on concurrent update?
11. What query/index supports the operation?
12. What migration is needed?
13. What tests prove behavior?

### 29.1 Agent must not invent mappings

The agent **MUST NOT** invent:

1. Table names.
2. Column names.
3. ID generation strategy.
4. Cascade behavior.
5. `nullable = false` when data may be absent.
6. `orphanRemoval = true` when delete semantics are unknown.
7. `@ManyToMany` when join entity is likely needed.
8. `@Transactional` propagation.
9. Provider-specific annotations.
10. Schema migration format.

When unknown, implement the smallest safe code and leave explicit TODO/assumption notes.

### 29.2 Agent must reject common bad requests

The agent **MUST** push back or implement safer alternatives when asked to:

1. Return JPA entities directly from REST endpoints.
2. Generate all setters for every entity.
3. Use `CascadeType.ALL` everywhere.
4. Use `FetchType.EAGER` to fix lazy loading.
5. Use `hibernate.hbm2ddl.auto=update` in production.
6. Build JPQL/SQL via string concatenation with request input.
7. Use `merge()` for API update payloads.
8. Add direct `@ManyToMany` for role/permission/user assignment without reviewing metadata needs.
9. Make entities final/records.
10. Ignore migrations and rely on annotations.

---

## 30. Required code templates

### 30.1 Entity template

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
    @SequenceGenerator(name = "case_record_seq", sequenceName = "case_record_seq", allocationSize = 50)
    @Column(name = "id", nullable = false, updatable = false)
    private Long id;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "reference_no", nullable = false, updatable = false, length = 64, unique = true)
    private String referenceNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private CaseStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CaseRecord() {
        // Required by JPA.
    }

    public CaseRecord(String referenceNo, Instant createdAt) {
        this.referenceNo = requireNonBlank(referenceNo, "referenceNo");
        this.status = CaseStatus.DRAFT;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public Long id() {
        return id;
    }

    public String referenceNo() {
        return referenceNo;
    }

    public CaseStatus status() {
        return status;
    }

    public void submit(Instant submittedAt) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft cases can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
    }
}
```

### 30.2 Repository template

```java
@Repository
public class JpaCaseRepository implements CaseRepository {

    private final EntityManager entityManager;

    public JpaCaseRepository(EntityManager entityManager) {
        this.entityManager = Objects.requireNonNull(entityManager, "entityManager");
    }

    @Override
    public Optional<CaseRecord> findById(Long id) {
        return Optional.ofNullable(entityManager.find(CaseRecord.class, id));
    }

    @Override
    public Optional<CaseRecord> findByReferenceNo(String referenceNo) {
        return entityManager.createQuery("""
                select c
                from CaseRecord c
                where c.referenceNo = :referenceNo
                """, CaseRecord.class)
                .setParameter("referenceNo", referenceNo)
                .setMaxResults(2)
                .getResultStream()
                .findFirst();
    }

    @Override
    public void add(CaseRecord caseRecord) {
        entityManager.persist(caseRecord);
    }
}
```

### 30.3 Service transaction template

```java
@Service
public class SubmitCaseService {

    private final CaseRepository caseRepository;
    private final Clock clock;

    public SubmitCaseService(CaseRepository caseRepository, Clock clock) {
        this.caseRepository = Objects.requireNonNull(caseRepository, "caseRepository");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    @Transactional
    public CaseResponse submit(Long caseId) {
        CaseRecord caseRecord = caseRepository.findById(caseId)
                .orElseThrow(() -> new CaseNotFoundException(caseId));

        caseRecord.submit(clock.instant());
        return CaseResponse.from(caseRecord);
    }
}
```

---

## 31. Reviewer checklist

A JPA/Jakarta Persistence change is not approved unless the reviewer can answer **yes** to the relevant questions below.

### 31.1 Entity checklist

- [ ] Entity is a non-final class, not record/enum/interface.
- [ ] Entity has protected/public no-arg constructor.
- [ ] Primary key is defined exactly once.
- [ ] ID generation matches database.
- [ ] `@Version` exists for mutable aggregate roots or absence is justified.
- [ ] Field/property access is consistent.
- [ ] String length/nullability are explicit.
- [ ] Enum storage is `STRING` or converter-based, not ordinal by accident.
- [ ] Entity does not expose mutable internal collections.
- [ ] Entity does not have blind public setters for invariant-sensitive fields.
- [ ] `equals/hashCode` are absent or safe.
- [ ] `toString` does not trigger lazy loading or leak sensitive data.

### 31.2 Relationship checklist

- [ ] Every association is necessary.
- [ ] To-one associations explicitly use lazy loading unless justified.
- [ ] Cascade matches lifecycle ownership.
- [ ] `orphanRemoval` means physical child deletion is correct.
- [ ] Bidirectional helper methods maintain both sides.
- [ ] Direct `@ManyToMany` is avoided or justified.
- [ ] Large collections are not loaded accidentally.

### 31.3 Query checklist

- [ ] All user input is parameter-bound or allow-listed.
- [ ] Query has bounded results or explicit reason for unbounded result.
- [ ] Query has stable ordering when paginated.
- [ ] Fetch plan is clear.
- [ ] No collection fetch join with pagination.
- [ ] DTO projection is used for read-heavy lists.
- [ ] Native SQL is tested against target database.
- [ ] Index implications are documented.

### 31.4 Transaction checklist

- [ ] Transaction boundary is at service/use-case layer.
- [ ] Transactions are short.
- [ ] No external slow calls inside transaction unless justified.
- [ ] Persistence context is not shared across threads.
- [ ] Lazy entities are not returned outside transaction.
- [ ] Locking behavior is deliberate.
- [ ] Retry behavior is safe and idempotent.

### 31.5 Migration checklist

- [ ] Schema migration exists for mapping changes.
- [ ] Migration is compatible with deployment strategy.
- [ ] Constraints exist in the database, not only annotations.
- [ ] Backfill/large-table impact is reviewed.
- [ ] Rollback/recovery notes exist for destructive changes.

### 31.6 Test checklist

- [ ] Mapping test persists and reloads entity.
- [ ] Repository custom queries are tested.
- [ ] Constraint behavior is tested.
- [ ] N+1 risk is tested for important paths.
- [ ] Native queries run against target database or equivalent.
- [ ] Migration is tested.

---

## 32. Forbidden patterns summary

The following are forbidden by default:

1. Mixing `javax.persistence` and `jakarta.persistence`.
2. Entity as Java record.
3. Final entity class.
4. Entity without protected/public no-arg constructor.
5. Public mutable entity fields.
6. Blind generated setters for all fields.
7. `EnumType.ORDINAL` for new code.
8. `CascadeType.ALL` everywhere.
9. `FetchType.EAGER` as lazy loading fix.
10. Direct `@ManyToMany` in enterprise systems.
11. Entity returned directly from REST/API endpoint.
12. Blind `entityManager.merge(requestBody)`.
13. String-concatenated JPQL/SQL with user input.
14. Unbounded list queries.
15. Collection fetch join with pagination.
16. Production `hbm2ddl.auto=update` or `drop-and-create`.
17. External service calls in entity listeners.
18. Sharing `EntityManager` across threads.
19. Static `EntityManager`.
20. Sensitive data in `toString` or logs.

---

## 33. Prompt contract for LLM code agents

Use this contract when asking an LLM agent to implement JPA/Jakarta Persistence code:

```text
You are implementing Java persistence code. Follow strict-coding-standards__jpa.md.

Before coding:
- identify whether this is javax.persistence or jakarta.persistence;
- identify entity/DTO/embeddable/projection roles;
- identify transaction boundary;
- identify schema migration impact;
- identify fetch plan and N+1 risk;
- identify concurrency and locking behavior.

While coding:
- do not expose entities as API DTOs;
- do not mix javax and jakarta imports;
- do not use final/record entities;
- do not generate blind setters;
- do not use EnumType.ORDINAL;
- do not use CascadeType.ALL unless lifecycle ownership is explicit;
- do not use FetchType.EAGER to hide lazy-loading problems;
- do not concatenate user input into JPQL/SQL;
- do not rely on automatic schema update in production;
- add/update migration scripts for schema changes;
- add integration tests for mappings and custom queries.

After coding, report:
- entities changed;
- schema changes;
- migration files;
- transaction boundaries;
- fetch strategy;
- locking/concurrency strategy;
- tests added;
- assumptions or unresolved risks.
```

---

## 34. Source anchors

This standard is anchored to:

1. Jakarta Persistence 3.2 specification and release notes.
2. Jakarta Persistence 3.1 specification.
3. Jakarta Persistence 2.2 / JPA legacy namespace documentation.
4. JPA entity class, primary key, version, and persistence unit rules from the specification.
5. Hibernate ORM documentation where provider behavior is discussed.
6. Project-specific Java strict coding standards for Java 11/17/21/25.
7. Project-specific design pattern strict standard.

The source anchors do not replace this document. They establish the baseline facts; this document defines the stricter engineering rules for LLM and human implementation.
