# Part 6 — Result Mapping: Auto Mapping, Explicit Mapping, and Column Discipline

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `06-result-mapping-auto-explicit-mapping-column-discipline.md`  
**Target audience:** advanced Java engineers building production-grade persistence layers with MyBatis  
**Java scope:** Java 8 through Java 25  
**Status:** Part 6 of 34

---

## 0. Why This Part Matters

A query is not correct merely because it returns rows.

In MyBatis, correctness has two halves:

```text
SQL correctness
  Did the database return the intended rows and columns?

Mapping correctness
  Did those columns become the intended Java values?
```

Many production bugs are not caused by SQL syntax errors. They are caused by **silent mapping drift**:

- a column alias changes but the Java property remains the same;
- a join returns two columns with the same name;
- `SELECT *` pulls an unexpected column;
- a nullable database column maps into a primitive Java field;
- an enum is mapped by name when the database stores code;
- a timestamp loses timezone meaning;
- an aggregate query returns `BigDecimal` or `Long` but the DTO expects `Integer`;
- `mapUnderscoreToCamelCase` works in one query but fails in another because aliases are inconsistent;
- a result object gets partially populated without any exception;
- auto mapping hides a bug until the field is used months later.

A top-tier engineer treats result mapping as a **contract**, not a convenience.

This part builds that mental model.

---

## 1. Core Mental Model: A Result Set Is Not an Object

A database result set is tabular:

```text
row 1: column A, column B, column C
row 2: column A, column B, column C
row 3: column A, column B, column C
```

A Java object is structural:

```java
public class UserProfileRow {
    private Long userId;
    private String email;
    private String displayName;
}
```

Mapping is the conversion from:

```text
column labels in JDBC ResultSet
```

to:

```text
Java property names, constructor arguments, or fields
```

That conversion is not always obvious.

Example SQL:

```sql
SELECT
  u.id,
  u.email,
  p.display_name
FROM users u
JOIN user_profiles p ON p.user_id = u.id
```

Java DTO:

```java
public class UserProfileRow {
    private Long userId;
    private String email;
    private String displayName;
}
```

There is already a problem:

```text
SQL column label: id
Java property: userId
```

Unless you alias or explicitly map it, MyBatis may not map it to the intended property.

Correct SQL alias:

```sql
SELECT
  u.id AS user_id,
  u.email AS email,
  p.display_name AS display_name
FROM users u
JOIN user_profiles p ON p.user_id = u.id
```

Now the mapping can be explicit or camel-case based:

```text
user_id       -> userId
display_name -> displayName
```

The fundamental lesson:

```text
Column labels are your mapper contract.
```

Not database column names.
Not table names.
Not entity names.
Not hope.

The labels returned by the SQL are what MyBatis sees.

---

## 2. MyBatis Result Mapping Options

MyBatis gives several ways to map result rows:

```text
1. resultType
2. resultMap
3. auto mapping
4. explicit property-column mapping
5. constructor mapping
6. nested result mapping
7. custom TypeHandler mapping
```

Part 6 focuses on the first four and the column discipline behind them. Constructor and nested mappings are expanded in Part 7.

---

## 3. `resultType`: Simple, Fast to Write, Easy to Abuse

`resultType` tells MyBatis:

```text
Map each returned row into this Java type.
```

Example:

```xml
<select id="findUserProfile" resultType="com.acme.user.UserProfileRow">
  SELECT
    u.id AS user_id,
    u.email AS email,
    p.display_name AS display_name
  FROM users u
  JOIN user_profiles p ON p.user_id = u.id
  WHERE u.id = #{userId}
</select>
```

DTO:

```java
public class UserProfileRow {
    private Long userId;
    private String email;
    private String displayName;

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
}
```

With `mapUnderscoreToCamelCase=true`, MyBatis can map:

```text
user_id       -> userId
display_name -> displayName
```

### 3.1 When `resultType` is acceptable

Use `resultType` when the query is simple and stable:

```text
single table
few columns
no duplicate column names
no nested object
no special type conversion
DTO property names match aliases cleanly
query is unlikely to evolve into a complex join
```

Good example:

```xml
<select id="findActiveUserEmails" resultType="string">
  SELECT email
  FROM users
  WHERE status = 'ACTIVE'
</select>
```

Good example:

```xml
<select id="findUserSummary" resultType="com.acme.user.UserSummaryRow">
  SELECT
    id AS id,
    email AS email,
    display_name AS display_name,
    status AS status
  FROM users
  WHERE id = #{id}
</select>
```

### 3.2 When `resultType` is risky

Avoid plain `resultType` when:

```text
query joins multiple tables
query returns repeated column names such as id, name, status, created_at
query maps into domain object with more fields than selected columns
query needs custom type handling
query returns aggregate/calculated columns
query is security-sensitive
query is used in critical workflow/state transition screen
query must remain stable across schema migration
```

Risky example:

```xml
<select id="findCaseDetail" resultType="com.acme.case.CaseDetailRow">
  SELECT
    c.*,
    a.*,
    u.*
  FROM cases c
  JOIN agencies a ON a.id = c.agency_id
  JOIN users u ON u.id = c.assignee_id
  WHERE c.id = #{caseId}
</select>
```

This is dangerous because:

```text
c.id, a.id, u.id all have label id
c.status, u.status may collide
created_at may exist in several tables
SELECT * changes when schema changes
result object may be populated incorrectly or partially
```

A better query aliases every column intentionally:

```xml
<select id="findCaseDetail" resultMap="CaseDetailRowMap">
  SELECT
    c.id          AS case_id,
    c.case_no     AS case_no,
    c.status      AS case_status,
    c.created_at  AS case_created_at,
    a.id          AS agency_id,
    a.code        AS agency_code,
    a.name        AS agency_name,
    u.id          AS assignee_user_id,
    u.email       AS assignee_email,
    u.full_name   AS assignee_full_name
  FROM cases c
  JOIN agencies a ON a.id = c.agency_id
  LEFT JOIN users u ON u.id = c.assignee_id
  WHERE c.id = #{caseId}
</select>
```

Then map it explicitly.

---

## 4. `resultMap`: The Production-Grade Mapping Contract

A `resultMap` describes exactly how database columns map into Java object properties.

Example:

```xml
<resultMap id="UserProfileRowMap" type="com.acme.user.UserProfileRow">
  <id     property="userId"      column="user_id" />
  <result property="email"       column="email" />
  <result property="displayName" column="display_name" />
</resultMap>

<select id="findUserProfile" resultMap="UserProfileRowMap">
  SELECT
    u.id AS user_id,
    u.email AS email,
    p.display_name AS display_name
  FROM users u
  JOIN user_profiles p ON p.user_id = u.id
  WHERE u.id = #{userId}
</select>
```

This gives you several benefits:

```text
mapping is visible
mapping is reviewable
mapping survives property/column naming differences
mapping supports special TypeHandler behavior
mapping supports nested objects later
mapping avoids relying on global auto mapping settings
```

### 4.1 `id` vs `result`

Inside a `resultMap`, use:

```xml
<id property="id" column="id" />
```

for identity columns, and:

```xml
<result property="email" column="email" />
```

for normal fields.

For simple one-row DTOs, this may look cosmetic. It is not.

`id` mappings become important when:

```text
nested result mapping needs to collapse duplicate parent rows
MyBatis needs to identify object identity inside a joined result set
second-level cache keys are involved
complex result maps are chained or extended
```

A good rule:

```text
If the result object has a stable identity, mark it with <id>.
```

Example:

```xml
<resultMap id="CaseRowMap" type="com.acme.case.CaseRow">
  <id     property="caseId"      column="case_id" />
  <result property="caseNo"      column="case_no" />
  <result property="status"      column="case_status" />
  <result property="createdAt"   column="case_created_at" />
</resultMap>
```

---

## 5. Auto Mapping: Useful Default, Dangerous Contract

Auto mapping means MyBatis attempts to map columns to properties automatically.

Typical mapping:

```text
column label: email
property:     email
```

With underscore-to-camel-case enabled:

```text
column label: display_name
property:     displayName
```

Relevant configuration:

```xml
<settings>
  <setting name="mapUnderscoreToCamelCase" value="true" />
</settings>
```

In Spring Boot:

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
```

### 5.1 Auto mapping behavior

MyBatis also has `autoMappingBehavior`, commonly configured as:

```text
NONE
PARTIAL
FULL
```

Conceptually:

```text
NONE
  Do not automatically map columns.

PARTIAL
  Automatically map simple result maps, but avoid more complex nested mappings.

FULL
  Attempt auto mapping even for complex result maps.
```

For production systems, a conservative default is usually:

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
    auto-mapping-behavior: PARTIAL
```

For critical systems, some teams prefer:

```yaml
mybatis:
  configuration:
    auto-mapping-behavior: NONE
```

and then require explicit `resultMap` everywhere except scalar returns.

### 5.2 The real risk of auto mapping

Auto mapping is not bad.

But auto mapping becomes dangerous when it is treated as a contract.

Example DTO:

```java
public class CaseListingRow {
    private Long caseId;
    private String caseNo;
    private String status;
    private String officerName;
}
```

Query:

```sql
SELECT
  c.id AS case_id,
  c.case_no,
  c.status,
  u.full_name
FROM cases c
JOIN users u ON u.id = c.assignee_id
```

Problem:

```text
u.full_name maps to fullName, not officerName.
```

The query runs.
The DTO is created.
`officerName` is null.
No compile-time failure.
Possibly no runtime failure.
The bug appears in the UI, report, export, audit screen, or downstream workflow.

Correct alias:

```sql
u.full_name AS officer_name
```

Or explicit mapping:

```xml
<result property="officerName" column="full_name" />
```

Top-tier habit:

```text
Never rely on auto mapping for semantically renamed fields.
```

---

## 6. Column Label Discipline

MyBatis maps by JDBC column label.

This means:

```sql
SELECT user_name AS name FROM users
```

maps as:

```text
name
```

not necessarily:

```text
user_name
```

Therefore, SQL aliases are part of your Java contract.

### 6.1 Rule: Always alias joined columns

Bad:

```sql
SELECT
  c.id,
  c.status,
  a.id,
  a.status
FROM cases c
JOIN agencies a ON a.id = c.agency_id
```

Better:

```sql
SELECT
  c.id     AS case_id,
  c.status AS case_status,
  a.id     AS agency_id,
  a.status AS agency_status
FROM cases c
JOIN agencies a ON a.id = c.agency_id
```

### 6.2 Rule: Do not use `SELECT *` in production mappers

`SELECT *` feels convenient, but it makes the result contract depend on schema shape.

Bad:

```xml
<select id="findById" resultType="com.acme.user.UserRow">
  SELECT *
  FROM users
  WHERE id = #{id}
</select>
```

Risks:

```text
new column appears unexpectedly
column order changes in some database operations
duplicate labels appear in joins
unneeded LOB columns are fetched
wide rows hurt network and memory
mapping becomes implicit and unreviewable
security-sensitive fields may leak into DTOs
```

Better:

```xml
<select id="findById" resultMap="UserRowMap">
  SELECT
    id,
    email,
    display_name,
    status,
    created_at,
    updated_at
  FROM users
  WHERE id = #{id}
</select>
```

### 6.3 Rule: Alias calculated fields to Java semantics

Bad:

```sql
SELECT COUNT(*) FROM cases
```

Better:

```sql
SELECT COUNT(*) AS total_count FROM cases
```

Bad:

```sql
SELECT MAX(created_at) FROM audit_trail
```

Better:

```sql
SELECT MAX(created_at) AS latest_activity_at FROM audit_trail
```

Bad:

```sql
SELECT CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END FROM cases
```

Better:

```sql
SELECT
  CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END AS closed_flag
FROM cases
```

### 6.4 Rule: Alias by consumer meaning, not table origin

Consider this query:

```sql
SELECT
  u.full_name AS full_name
FROM cases c
JOIN users u ON u.id = c.assignee_id
```

If the DTO property is:

```java
private String assigneeName;
```

then alias should be:

```sql
u.full_name AS assignee_name
```

not:

```sql
u.full_name AS full_name
```

Column aliases should reflect the **role in this result**, not merely the original column.

---

## 7. Explicit Mapping as a Design Tool

A good `resultMap` is not only technical configuration. It is documentation.

Example:

```xml
<resultMap id="CaseListingRowMap" type="com.acme.case.query.CaseListingRow">
  <id     property="caseId"          column="case_id" />
  <result property="caseNo"          column="case_no" />
  <result property="caseStatus"      column="case_status" />
  <result property="agencyCode"      column="agency_code" />
  <result property="agencyName"      column="agency_name" />
  <result property="assigneeUserId"  column="assignee_user_id" />
  <result property="assigneeName"    column="assignee_name" />
  <result property="createdAt"       column="case_created_at" />
</resultMap>
```

A reviewer can now see:

```text
what object is produced
which columns are required
which aliases the SQL must provide
which fields are identity fields
which fields are projections from joined tables
```

If the query changes, the contract is easier to review.

---

## 8. `resultType` vs `resultMap`: Decision Framework

Use this decision table.

| Situation | Prefer |
|---|---|
| Scalar value, e.g. count, exists flag, string list | `resultType` |
| Simple DTO with exact aliases | `resultType` acceptable |
| Join query | `resultMap` |
| Duplicate column names possible | `resultMap` |
| Different SQL label and Java property semantics | `resultMap` or exact alias |
| Critical workflow screen | `resultMap` |
| Audit/security/reporting result | `resultMap` |
| Nested object | `resultMap` |
| Custom `TypeHandler` needed per field | `resultMap` |
| Immutable constructor mapping | `resultMap` |
| Domain object with invariants | Usually avoid direct mapping or use explicit mapping carefully |
| Legacy table naming inconsistent | `resultMap` |

A strong default for serious systems:

```text
resultType for scalar/simple lookups.
resultMap for anything important.
```

---

## 9. Mapping to Domain Object vs DTO vs Projection

One of the biggest architectural mistakes is mapping every query into domain entities.

In MyBatis, you control SQL explicitly. You should also control result shape explicitly.

### 9.1 Domain object

A domain object carries business meaning and invariants.

Example:

```java
public class CaseRecord {
    private Long id;
    private String caseNo;
    private CaseStatus status;
    private Long agencyId;
    private Long version;

    public boolean canBeAssigned() {
        return status == CaseStatus.NEW || status == CaseStatus.REOPENED;
    }
}
```

Mapping into domain object is reasonable when:

```text
query loads enough fields to maintain invariants
object is used for behavior, not just display
partial population cannot violate assumptions
```

Danger:

```text
Partial SELECT into rich domain object creates an object that looks valid but is incomplete.
```

Bad:

```xml
<select id="findCaseForListing" resultType="CaseRecord">
  SELECT id, case_no, status
  FROM cases
</select>
```

If `CaseRecord` methods assume `agencyId` and `version` exist, this is unsafe.

### 9.2 DTO / projection row

A projection row is shaped for a specific read use case.

Example:

```java
public class CaseListingRow {
    private Long caseId;
    private String caseNo;
    private String caseStatus;
    private String agencyName;
    private String assigneeName;
    private LocalDateTime createdAt;
}
```

This is ideal for:

```text
listing pages
dashboards
exports
reports
search results
read-only API responses
```

It allows SQL to be optimized for the read use case without pretending to load the full domain object.

### 9.3 Command result

Some mapper results are not entities or UI DTOs. They are command outcomes.

Example:

```java
public class AssignmentLockRow {
    private Long caseId;
    private String currentStatus;
    private Long currentVersion;
    private Long assigneeUserId;
}
```

Used for:

```text
validation before state transition
concurrency-sensitive command
lock-and-check workflow
```

This should be explicitly mapped.

---

## 10. Null Handling: The Silent Correctness Boundary

Relational databases allow null.
Java types vary in how they represent absence.

### 10.1 Primitive types are dangerous for nullable columns

Bad:

```java
public class UserRow {
    private long lastLoginUserId;
}
```

If the database column can be null, use wrapper:

```java
public class UserRow {
    private Long lastLoginUserId;
}
```

Bad:

```java
private boolean locked;
```

if the column can be null.

Better:

```java
private Boolean locked;
```

or, even better, make the SQL normalize it intentionally:

```sql
COALESCE(locked, 0) AS locked
```

and document that null is collapsed to false.

### 10.2 Null means different things

In persistence systems, null may mean:

```text
unknown
not applicable
not yet assigned
cleared by user
not loaded
not authorized to view
default value missing
migration not backfilled
```

Do not let mapping erase those distinctions accidentally.

Example:

```sql
SELECT
  c.id AS case_id,
  u.full_name AS assignee_name
FROM cases c
LEFT JOIN users u ON u.id = c.assignee_id
```

If `assignee_name` is null, it may mean:

```text
case is unassigned
assignee row was deleted
assignee exists but full_name is null
join condition is wrong
user is filtered by tenant/security condition
```

The mapping layer cannot know which meaning is correct. The SQL and DTO should make semantics clear.

Better for listing:

```sql
SELECT
  c.id AS case_id,
  CASE
    WHEN c.assignee_id IS NULL THEN 'UNASSIGNED'
    WHEN u.id IS NULL THEN 'ASSIGNEE_NOT_FOUND'
    ELSE 'ASSIGNED'
  END AS assignment_state,
  u.full_name AS assignee_name
FROM cases c
LEFT JOIN users u ON u.id = c.assignee_id
```

DTO:

```java
public class CaseAssignmentRow {
    private Long caseId;
    private String assignmentState;
    private String assigneeName;
}
```

This is better than relying on a naked null.

---

## 11. Type Discipline: Java Type Is Part of the Mapping Contract

A mapped result field has at least four type layers:

```text
database physical type
JDBC type
Java type produced by JDBC/MyBatis
business semantic type
```

Example:

```text
DB column: NUMBER(19)
JDBC: NUMERIC/DECIMAL/BIGINT depending on driver/vendor
Java: Long or BigDecimal
Business: CaseId
```

A casual mapper collapses this into:

```java
private Long caseId;
```

A stronger design asks:

```text
Is this always non-null?
Can it exceed Long?
Is it an identifier value object?
Does the database return BigDecimal?
Is a TypeHandler needed?
```

### 11.1 Numeric mapping

Common safe choices:

| Database concept | Java type |
|---|---|
| integer id | `Long` |
| count result | `long` / `Long`, sometimes `Integer` only for guaranteed small counts |
| money/decimal | `BigDecimal` |
| percentage/rate | `BigDecimal` |
| small code | `String` or enum via TypeHandler |
| boolean flag in DB | `Boolean` or enum-like type |

Avoid mapping money to:

```java
double
float
```

### 11.2 Date/time mapping

Date/time mapping deserves explicit policy.

Typical Java choices:

```text
LocalDate       date without time
LocalDateTime   local timestamp without zone
OffsetDateTime  timestamp with offset
Instant         absolute machine time
```

For enterprise systems, define a standard:

```text
Database stores UTC timestamp?
Use Instant or OffsetDateTime.

Database stores local business time?
Use LocalDateTime but document timezone boundary.

Database stores date-only business date?
Use LocalDate.
```

Bad smell:

```java
private Date createdAt;
```

in new Java 17/21 code unless legacy compatibility requires it.

Java 8 introduced `java.time`, so even Java 8 codebases can use modern date/time types if dependencies and drivers support them.

### 11.3 Enum mapping

A database enum-like value can be stored as:

```text
name: APPROVED
code: A
number: 1
vendor enum type
```

Java enum:

```java
public enum CaseStatus {
    NEW,
    ASSIGNED,
    CLOSED
}
```

Default enum mapping by name is simple but brittle if the database stores code.

Better for coded values:

```java
public enum CaseStatus {
    NEW("N"),
    ASSIGNED("A"),
    CLOSED("C");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown CaseStatus code: " + code);
    }
}
```

Then use a `TypeHandler`.

Explicit mapping:

```xml
<result property="status" column="case_status" typeHandler="com.acme.mybatis.CaseStatusTypeHandler" />
```

This is better than spreading code conversion across services.

---

## 12. Column Alias Patterns for Large Systems

Column naming is one of the easiest ways to make mapper codebase either clean or chaotic.

### 12.1 Entity prefix pattern

For joined results:

```sql
SELECT
  c.id         AS case_id,
  c.case_no    AS case_no,
  c.status     AS case_status,
  a.id         AS agency_id,
  a.code       AS agency_code,
  a.name       AS agency_name
FROM cases c
JOIN agencies a ON a.id = c.agency_id
```

This works well when result object contains fields from multiple concepts.

### 12.2 Role prefix pattern

When the same table is joined with different roles:

```sql
SELECT
  created_by_user.id        AS created_by_user_id,
  created_by_user.full_name AS created_by_name,
  assigned_user.id          AS assignee_user_id,
  assigned_user.full_name   AS assignee_name
FROM cases c
LEFT JOIN users created_by_user ON created_by_user.id = c.created_by
LEFT JOIN users assigned_user   ON assigned_user.id = c.assignee_id
```

Do not alias both as:

```text
user_id
full_name
```

Use role names:

```text
created_by_user_id
created_by_name
assignee_user_id
assignee_name
```

### 12.3 Semantic alias pattern

For calculations:

```sql
SELECT
  COUNT(*) AS open_case_count,
  MAX(created_at) AS latest_open_case_created_at
FROM cases
WHERE status = 'OPEN'
```

Do not alias calculated values as:

```text
count
max
expr1
```

### 12.4 Boolean alias pattern

For existence flags:

```sql
SELECT
  CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS has_open_appeal
FROM appeals
WHERE case_id = #{caseId}
```

DTO:

```java
private Boolean hasOpenAppeal;
```

or:

```java
private boolean hasOpenAppeal;
```

only if SQL guarantees non-null.

---

## 13. Unknown Columns and Unknown Properties

A strong production setting is to fail or warn when unexpected columns appear.

Relevant setting:

```yaml
mybatis:
  configuration:
    auto-mapping-unknown-column-behavior: WARNING
```

or in stricter environments:

```yaml
mybatis:
  configuration:
    auto-mapping-unknown-column-behavior: FAILING
```

Conceptually, this controls what happens when MyBatis detects columns that do not map cleanly during auto mapping.

### 13.1 Why warning/failing can be valuable

Suppose query returns:

```sql
SELECT
  id,
  email,
  display_name,
  internal_risk_score
FROM users
```

DTO:

```java
public class UserSummaryRow {
    private Long id;
    private String email;
    private String displayName;
}
```

If `internal_risk_score` is unintended, you want to know.

Potential causes:

```text
SELECT * pulled new column
query copied from admin screen
sensitive field accidentally selected
resultMap out of date
DTO missing field
```

In a regulated or security-sensitive platform, silently ignoring unknown columns is not always acceptable.

### 13.2 Practical recommendation

For early migration or legacy code:

```text
WARNING may be safer than FAILING.
```

For new critical modules:

```text
FAILING in tests is excellent.
```

A pragmatic approach:

```text
local/dev/test: FAILING or WARNING
production: WARNING or carefully tested FAILING, depending on maturity
```

Do not enable strict failure blindly in a large legacy system without mapper test coverage.

---

## 14. Result Mapping and `mapUnderscoreToCamelCase`

`mapUnderscoreToCamelCase=true` is useful.

It maps:

```text
case_id    -> caseId
created_at -> createdAt
```

But it does not solve semantic mismatch.

It cannot know that:

```text
u.full_name should be assigneeName
c.status should be caseStatus
COUNT(*) should be totalCount
```

So the rule is:

```text
Use underscore-to-camel-case for mechanical naming conversion.
Use aliases or resultMap for semantic naming conversion.
```

Bad assumption:

```text
mapUnderscoreToCamelCase means I do not need resultMap.
```

Better assumption:

```text
mapUnderscoreToCamelCase reduces boilerplate only when SQL aliases already express Java semantics.
```

---

## 15. Mapping Joined Queries

Joined queries are where result mapping discipline matters most.

### 15.1 Bad joined query

```xml
<select id="findOrderDetail" resultType="com.acme.order.OrderDetailRow">
  SELECT
    o.id,
    o.status,
    c.id,
    c.name,
    p.id,
    p.name
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN products p ON p.id = o.product_id
  WHERE o.id = #{orderId}
</select>
```

This query has repeated labels:

```text
id
status
name
```

A mapper may populate the wrong fields or fail depending on driver labels and aliases.

### 15.2 Good joined query

```xml
<resultMap id="OrderDetailRowMap" type="com.acme.order.OrderDetailRow">
  <id     property="orderId"      column="order_id" />
  <result property="orderStatus"  column="order_status" />
  <result property="customerId"   column="customer_id" />
  <result property="customerName" column="customer_name" />
  <result property="productId"    column="product_id" />
  <result property="productName"  column="product_name" />
</resultMap>

<select id="findOrderDetail" resultMap="OrderDetailRowMap">
  SELECT
    o.id     AS order_id,
    o.status AS order_status,
    c.id     AS customer_id,
    c.name   AS customer_name,
    p.id     AS product_id,
    p.name   AS product_name
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN products p ON p.id = o.product_id
  WHERE o.id = #{orderId}
</select>
```

This is longer, but it is reviewable.

A top-tier engineer optimizes for **long-term correctness**, not mapper brevity.

---

## 16. Mapping Aggregate Queries

Aggregate queries often produce vendor-specific numeric types.

Example:

```xml
<select id="countOpenCases" resultType="long">
  SELECT COUNT(*)
  FROM cases
  WHERE status = 'OPEN'
</select>
```

This is acceptable for a scalar count.

For aggregate rows:

```xml
<resultMap id="CaseStatusStatsRowMap" type="com.acme.case.query.CaseStatusStatsRow">
  <result property="status"     column="case_status" />
  <result property="totalCount" column="total_count" />
  <result property="oldestAt"   column="oldest_created_at" />
  <result property="latestAt"   column="latest_created_at" />
</resultMap>

<select id="countByStatus" resultMap="CaseStatusStatsRowMap">
  SELECT
    status AS case_status,
    COUNT(*) AS total_count,
    MIN(created_at) AS oldest_created_at,
    MAX(created_at) AS latest_created_at
  FROM cases
  GROUP BY status
</select>
```

DTO:

```java
public class CaseStatusStatsRow {
    private String status;
    private Long totalCount;
    private LocalDateTime oldestAt;
    private LocalDateTime latestAt;
}
```

Be careful with:

```text
COUNT returns Long, BigInteger, or BigDecimal depending on driver/vendor/context
AVG may return BigDecimal
SUM over integer may return BigDecimal or Long
MIN/MAX date type depends on driver
```

For portability, test aggregate mappings against the real database vendor.

---

## 17. Mapping Boolean Values

Not all databases have the same boolean type.

Possible storage patterns:

```text
BOOLEAN
NUMBER(1)
CHAR(1) with Y/N
VARCHAR with TRUE/FALSE
VARCHAR with ACTIVE/INACTIVE
```

Java:

```java
private Boolean active;
```

Mapping options:

### 17.1 SQL normalization

```sql
CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END AS active
```

Then map to Boolean if the driver supports numeric boolean conversion, or to Integer and convert in service/TypeHandler.

### 17.2 TypeHandler

For `Y/N`:

```xml
<result property="active" column="active_yn" typeHandler="com.acme.mybatis.YesNoBooleanTypeHandler" />
```

Use a TypeHandler when the representation is reused across the codebase.

### 17.3 Avoid ambiguous boolean names

Bad:

```java
private Boolean status;
```

Better:

```java
private Boolean active;
private Boolean locked;
private Boolean deleted;
private Boolean visible;
private Boolean eligibleForRenewal;
```

The alias should match:

```sql
CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END AS deleted
```

---

## 18. Mapping Soft Delete and Visibility

Soft delete often creates mapping ambiguity.

Table:

```text
cases
  id
  case_no
  status
  deleted_at
```

A listing query may exclude deleted rows:

```sql
WHERE deleted_at IS NULL
```

A back-office audit query may include them:

```sql
SELECT
  id AS case_id,
  case_no AS case_no,
  status AS case_status,
  CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END AS deleted
FROM cases
```

DTO:

```java
public class CaseAdminRow {
    private Long caseId;
    private String caseNo;
    private String caseStatus;
    private Boolean deleted;
}
```

Do not map a soft-deleted row into the same DTO as a normal user listing if visibility semantics differ.

Different query semantics deserve different result types.

---

## 19. Mapping Security-Sensitive Data

Mapping can leak data even if service code does not use it.

Bad:

```sql
SELECT * FROM users
```

May include:

```text
password_hash
mfa_secret
reset_token
internal_risk_score
last_failed_login_ip
```

Even if the DTO does not have these fields, the data crossed the database boundary, JDBC driver, logs/traces, and memory.

Secure mapper rule:

```text
Never select columns that the use case is not allowed to observe.
```

For sensitive tables, use explicit allowlist SQL:

```sql
SELECT
  id AS user_id,
  email AS email,
  display_name AS display_name,
  status AS account_status
FROM users
WHERE id = #{userId}
```

and explicit result map:

```xml
<resultMap id="PublicUserProfileRowMap" type="com.acme.user.PublicUserProfileRow">
  <id     property="userId"        column="user_id" />
  <result property="email"         column="email" />
  <result property="displayName"   column="display_name" />
  <result property="accountStatus" column="account_status" />
</resultMap>
```

---

## 20. Mapping Tenant/Agency Scoped Data

For multi-tenant or agency-scoped systems, mapping should include enough data to detect scope mistakes.

Example:

```xml
<resultMap id="CaseScopedRowMap" type="com.acme.case.CaseScopedRow">
  <id     property="caseId"   column="case_id" />
  <result property="agencyId" column="agency_id" />
  <result property="caseNo"   column="case_no" />
  <result property="status"   column="case_status" />
</resultMap>
```

SQL:

```sql
SELECT
  c.id AS case_id,
  c.agency_id AS agency_id,
  c.case_no AS case_no,
  c.status AS case_status
FROM cases c
WHERE c.id = #{caseId}
  AND c.agency_id = #{agencyId}
```

Why include `agency_id` in result?

```text
It allows service/test/logging code to assert that returned row belongs to expected scope.
It improves incident debugging.
It prevents accidental loss of security context during refactor.
```

For highly sensitive boundaries, do not merely filter by tenant. Map and assert tenant/agency identity too.

---

## 21. ResultMap Reuse: Useful but Can Become Coupling

MyBatis allows reusable result maps.

Example:

```xml
<resultMap id="BaseUserRowMap" type="com.acme.user.UserRow">
  <id     property="id"          column="id" />
  <result property="email"       column="email" />
  <result property="displayName" column="display_name" />
  <result property="status"      column="status" />
</resultMap>
```

Then multiple queries can use it:

```xml
<select id="findById" resultMap="BaseUserRowMap">
  SELECT id, email, display_name, status
  FROM users
  WHERE id = #{id}
</select>

<select id="findByEmail" resultMap="BaseUserRowMap">
  SELECT id, email, display_name, status
  FROM users
  WHERE email = #{email}
</select>
```

This is good when the result shape is truly identical.

### 21.1 Bad reuse

Do not reuse a result map if the query semantics differ.

Example:

```text
UserInternalRowMap
```

used for:

```text
public API profile
admin account detail
authentication lookup
audit export
```

These likely have different visibility, fields, and security concerns.

### 21.2 Reuse rule

Reuse result maps only when:

```text
same DTO type
same selected columns
same field semantics
same visibility level
same null semantics
same lifecycle expectation
```

Otherwise create a new result map.

Duplication is sometimes cheaper than hidden coupling.

---

## 22. `resultMap` Inheritance with `extends`

MyBatis supports extending result maps.

Example:

```xml
<resultMap id="UserBaseMap" type="com.acme.user.UserRow">
  <id     property="id"    column="user_id" />
  <result property="email" column="email" />
</resultMap>

<resultMap id="UserDetailMap" type="com.acme.user.UserDetailRow" extends="UserBaseMap">
  <result property="displayName" column="display_name" />
  <result property="status"      column="account_status" />
</resultMap>
```

Use carefully.

It can reduce duplication, but it can also hide mappings.

A reviewer reading `UserDetailMap` may not immediately see that `id` and `email` are inherited.

Recommendation:

```text
Use extends for stable base mappings inside one mapper namespace.
Avoid deep inheritance chains.
Avoid sharing inherited result maps across unrelated modules.
Do not use inheritance to simulate entity hierarchy unless it genuinely matches the data model.
```

---

## 23. Mapping into `Map<String, Object>`

MyBatis can return maps.

Example:

```xml
<select id="findRawCase" resultType="map">
  SELECT
    id,
    case_no,
    status
  FROM cases
  WHERE id = #{id}
</select>
```

This is tempting for dynamic reporting or admin tools.

But it creates problems:

```text
no compile-time property contract
weak type safety
harder refactor
case sensitivity surprises
consumer must know column labels
no semantic naming guarantee
harder testing
harder documentation
```

Use maps only for:

```text
truly dynamic query tools
metadata-driven exports
internal diagnostics
one-off migration/admin utilities
```

Avoid maps for normal application flows.

A top-tier mapper has explicit result types.

---

## 24. Mapping Java Records

Java records are available from Java 16+ and common in Java 17/21/25 codebases.

Example:

```java
public record UserSummaryRow(
    Long userId,
    String email,
    String displayName
) {}
```

Records are immutable and constructor-based.

This makes them excellent for read-only projections, but mapping behavior depends on MyBatis version/configuration and constructor mapping details.

For production, prefer explicit constructor mapping when using records for important queries.

Example:

```xml
<resultMap id="UserSummaryRecordMap" type="com.acme.user.UserSummaryRow">
  <constructor>
    <arg column="user_id"      javaType="java.lang.Long" />
    <arg column="email"        javaType="java.lang.String" />
    <arg column="display_name" javaType="java.lang.String" />
  </constructor>
</resultMap>
```

Or, if supported by your MyBatis version and parameter metadata setup, constructor argument names may be used. But do not rely on that blindly across Java 8–25 mixed environments.

Compatibility guidance:

```text
Java 8/11 shared codebase:
  Use POJO DTOs or immutable classes with explicit constructors carefully.

Java 17+ service:
  Records are excellent for simple read projections.

Critical mapper:
  Prefer explicit constructor mapping and tests.
```

Part 7 covers constructor and record mapping in more depth.

---

## 25. Mapping Lombok DTOs

Lombok can reduce boilerplate:

```java
@Data
public class UserSummaryRow {
    private Long userId;
    private String email;
    private String displayName;
}
```

This works because MyBatis can use setters.

But be careful with:

```text
@Builder without no-args constructor
@AllArgsConstructor only
final fields
access-level restricted setters
fluent accessors
boolean getter naming
```

Bad for setter-based mapping:

```java
@Builder
@Getter
public class UserSummaryRow {
    private final Long userId;
    private final String email;
    private final String displayName;
}
```

This requires constructor mapping, not normal setter mapping.

For simple MyBatis DTOs, prefer:

```java
@Getter
@Setter
@NoArgsConstructor
public class UserSummaryRow {
    private Long userId;
    private String email;
    private String displayName;
}
```

or use records in Java 17+.

---

## 26. Mapping with Type Aliases

Type aliases reduce XML verbosity.

Configuration:

```yaml
mybatis:
  type-aliases-package: com.acme
```

Then:

```xml
<resultMap id="UserSummaryRowMap" type="UserSummaryRow">
  ...
</resultMap>
```

instead of:

```xml
<resultMap id="UserSummaryRowMap" type="com.acme.user.UserSummaryRow">
  ...
</resultMap>
```

Be careful in large systems.

If two classes have the same simple name:

```text
com.acme.user.UserRow
com.acme.audit.UserRow
```

alias collision or confusion can occur.

Recommendation:

```text
Use explicit fully qualified names for shared/common modules or ambiguous names.
Use aliases only where naming is controlled.
Avoid generic DTO names like Row, DetailRow, SummaryRow without module prefix.
```

Better class names:

```text
UserAccountSummaryRow
AuditActorUserRow
CaseAssignmentUserRow
```

---

## 27. Result Mapping and Local Cache

Result mapping interacts with MyBatis cache behavior indirectly.

MyBatis local session cache can return objects from the same session for identical queries, depending on configuration and executor behavior.

This matters when result objects are mutable.

Example:

```java
UserRow user = userMapper.findById(1L);
user.setEmail("modified-in-memory@example.com");
UserRow again = userMapper.findById(1L);
```

Depending on session/cache behavior, `again` may be affected by the same cached object reference.

Practical guidance:

```text
Treat mapper result objects as data snapshots.
Do not mutate read projection objects casually.
Use separate command objects for writes.
Prefer immutable DTOs/records for read projections when Java version allows.
Be careful when using local cache in long sessions.
```

In Spring-managed MyBatis, sessions are usually scoped to transaction boundaries, but you should still design result objects with clear mutation semantics.

---

## 28. Result Mapping and Performance

Mapping is not free.

The cost includes:

```text
JDBC ResultSet access
reflection or method handle invocation
object allocation
TypeHandler conversion
nested object construction
collection creation
duplicate parent collapse in nested results
```

For most business queries, SQL/database cost dominates. But mapping cost matters when:

```text
large exports
batch reads
analytics/reporting queries
nested result maps
wide rows
LOB columns
high-throughput APIs
low-latency service endpoints
```

### 28.1 Avoid wide result objects

Bad:

```sql
SELECT * FROM audit_trail
```

if it includes CLOB fields such as:

```text
metadata
serialized_changes
full_text
```

Better listing query:

```sql
SELECT
  id AS audit_id,
  module_id AS module_id,
  activity AS activity,
  created_at AS created_at,
  actor_user_id AS actor_user_id
FROM audit_trail
WHERE created_at >= #{from}
  AND created_at < #{to}
ORDER BY created_at DESC
```

Separate detail query:

```sql
SELECT
  id AS audit_id,
  metadata AS metadata,
  serialized_changes AS serialized_changes,
  full_text AS full_text
FROM audit_trail
WHERE id = #{auditId}
```

Separate result maps for listing and detail.

### 28.2 Avoid unnecessary nested mapping

If a screen only needs flat rows, map flat rows.

Do not build object graphs just because domain model has relationships.

Flat projection:

```java
public class CaseListingRow {
    private Long caseId;
    private String caseNo;
    private String agencyName;
    private String assigneeName;
}
```

is often better than:

```java
Case {
  Agency agency;
  User assignee;
}
```

for listing and search screens.

---

## 29. Result Mapping and Testing

Mapper tests should verify not only that rows are returned, but also that fields are mapped correctly.

### 29.1 Minimum test for important result maps

For a critical mapper:

```java
@Test
void findCaseListing_mapsAllExpectedFields() {
    CaseListingRow row = mapper.findCaseListing(caseId);

    assertThat(row.getCaseId()).isEqualTo(caseId);
    assertThat(row.getCaseNo()).isEqualTo("EA-2026-0001");
    assertThat(row.getCaseStatus()).isEqualTo("OPEN");
    assertThat(row.getAgencyCode()).isEqualTo("CEA");
    assertThat(row.getAssigneeName()).isEqualTo("Alice Tan");
    assertThat(row.getCreatedAt()).isNotNull();
}
```

Do not only assert:

```java
assertThat(row).isNotNull();
```

That proves almost nothing.

### 29.2 Test null behavior

```java
@Test
void findCaseListing_whenUnassigned_mapsAssigneeFieldsAsNullAndStateAsUnassigned() {
    CaseListingRow row = mapper.findCaseListing(unassignedCaseId);

    assertThat(row.getAssignmentState()).isEqualTo("UNASSIGNED");
    assertThat(row.getAssigneeName()).isNull();
}
```

### 29.3 Test duplicate column protection

For joined queries, tests should catch alias mistakes.

Insert fixture where:

```text
case.id != agency.id
case.status != agency.status
created_by_user.full_name != assignee_user.full_name
```

Then assert each field independently.

If fixture values are too similar, mapping bugs hide.

Bad fixture:

```text
case_id = 1
agency_id = 1
created_by_name = "Admin"
assignee_name = "Admin"
```

Good fixture:

```text
case_id = 101
agency_id = 202
created_by_name = "Creator User"
assignee_name = "Assignee User"
```

### 29.4 Test aggregate type mapping

For count/sum/avg:

```java
assertThat(row.getTotalCount()).isEqualTo(3L);
assertThat(row.getAverageProcessingDays()).isEqualByComparingTo("2.50");
```

Use real database vendor if possible.

H2 may not reproduce Oracle/PostgreSQL/MySQL numeric behavior.

---

## 30. Failure Model: Common Result Mapping Bugs

### 30.1 Property stays null

Symptoms:

```text
SQL returns data
DTO field is null
no exception
```

Likely causes:

```text
column alias does not match property
mapUnderscoreToCamelCase disabled
resultMap missing field
wrong resultMap used
left join produced null
TypeHandler returned null
setter not accessible
Lombok generated no setter
constructor mapping mismatch
```

Debug steps:

```text
log actual SQL
run SQL manually
check column labels, not table column names
check resultMap property names
check DTO setter/getter
check configuration mapUnderscoreToCamelCase
check TypeHandler
```

### 30.2 Wrong value in field

Symptoms:

```text
caseId contains agency id
status contains user status
name contains wrong role name
```

Likely causes:

```text
duplicate column labels
SELECT * in join
ambiguous alias
auto mapping mapped first/last matching column unexpectedly
resultMap column points to wrong alias
```

Fix:

```text
alias all joined columns
use resultMap
use distinct fixture values in tests
```

### 30.3 Primitive default hides null

Symptoms:

```text
boolean false but database value is null
long 0 but no row/column value exists
```

Likely causes:

```text
primitive Java field
missing nullable policy
```

Fix:

```text
use wrapper type
or normalize SQL with COALESCE and document semantics
```

### 30.4 Enum mapping fails

Symptoms:

```text
IllegalArgumentException: No enum constant
unknown status code
null enum unexpectedly
```

Likely causes:

```text
database stores code, Java expects name
database has new code not in enum
case mismatch
legacy data contains invalid code
```

Fix:

```text
custom TypeHandler
explicit unknown-code strategy
migration check
contract test for all DB codes
```

### 30.5 Date/time shifted

Symptoms:

```text
time appears off by hours
createdAt differs between environments
report date boundary wrong
```

Likely causes:

```text
database timezone/session timezone mismatch
JDBC driver conversion
using java.util.Date without policy
using LocalDateTime for UTC instant
server timezone differs from DB timezone
```

Fix:

```text
define time policy
use java.time types
configure JDBC/session timezone where relevant
test boundary values
```

---

## 31. Result Mapping Review Checklist

Use this checklist in code review.

### 31.1 SQL column checklist

```text
No SELECT *.
Every joined column is aliased.
Aliases are unique.
Aliases match Java semantics.
Calculated columns have explicit aliases.
Sensitive columns are not selected unless required.
LOB columns are not selected in listing queries unless required.
Tenant/security scope columns are included when useful for assertion/debugging.
```

### 31.2 Result map checklist

```text
Important queries use resultMap.
Identity fields use <id>.
All expected DTO fields are mapped or intentionally omitted.
Custom TypeHandler is used for coded enum/value object fields.
Nullable columns map to nullable Java types or SQL normalizes nulls intentionally.
No unrelated resultMap reuse.
No deep resultMap inheritance.
```

### 31.3 DTO checklist

```text
DTO name matches use case.
DTO is not a partial domain object unless intentionally designed.
Primitive fields are used only for non-null values.
Date/time type matches system time policy.
Boolean names express meaning.
Records/constructors are mapped explicitly in critical flows.
```

### 31.4 Test checklist

```text
Test asserts individual fields, not only non-null row.
Fixture values differ across joined tables.
Null cases are tested.
Aggregate type mapping is tested.
Enum/code values are tested.
Real vendor behavior is tested for important mappers.
```

---

## 32. Recommended Mapping Standards for Enterprise MyBatis

For a serious enterprise codebase, adopt standards like these.

### 32.1 General standards

```text
1. Do not use SELECT * in application mappers.
2. Use resultMap for joined, critical, security-sensitive, or long-lived queries.
3. Use resultType only for scalar/simple DTO queries.
4. Alias every selected expression.
5. Alias by result semantics, not just source column name.
6. Use <id> for identity fields.
7. Avoid mapping partial data into rich domain objects.
8. Prefer projection DTOs for listing/search/reporting.
9. Test mapping for important queries.
10. Use TypeHandler for repeated domain conversion.
```

### 32.2 Suggested MyBatis config posture

For modern Spring Boot service:

```yaml
mybatis:
  mapper-locations: classpath*:mappers/**/*.xml
  configuration:
    map-underscore-to-camel-case: true
    auto-mapping-behavior: PARTIAL
    auto-mapping-unknown-column-behavior: WARNING
```

For stricter new module:

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
    auto-mapping-behavior: NONE
    auto-mapping-unknown-column-behavior: FAILING
```

But only use strict settings when your result maps and tests are ready.

---

## 33. Mini Case Study: Case Listing Mapper

### 33.1 Requirement

Build a case listing query that shows:

```text
case id
case number
case status
agency code
agency name
assignee name
created date
whether case is overdue
```

### 33.2 DTO

```java
public class CaseListingRow {
    private Long caseId;
    private String caseNo;
    private String caseStatus;
    private String agencyCode;
    private String agencyName;
    private Long assigneeUserId;
    private String assigneeName;
    private LocalDateTime createdAt;
    private Boolean overdue;

    // getters and setters
}
```

### 33.3 Result map

```xml
<resultMap id="CaseListingRowMap" type="com.acme.case.query.CaseListingRow">
  <id     property="caseId"         column="case_id" />
  <result property="caseNo"         column="case_no" />
  <result property="caseStatus"     column="case_status" />
  <result property="agencyCode"     column="agency_code" />
  <result property="agencyName"     column="agency_name" />
  <result property="assigneeUserId" column="assignee_user_id" />
  <result property="assigneeName"   column="assignee_name" />
  <result property="createdAt"      column="case_created_at" />
  <result property="overdue"        column="overdue" />
</resultMap>
```

### 33.4 SQL

```xml
<select id="searchCaseListings" resultMap="CaseListingRowMap">
  SELECT
    c.id AS case_id,
    c.case_no AS case_no,
    c.status AS case_status,
    a.code AS agency_code,
    a.name AS agency_name,
    u.id AS assignee_user_id,
    u.full_name AS assignee_name,
    c.created_at AS case_created_at,
    CASE
      WHEN c.due_at IS NOT NULL
       AND c.due_at &lt; CURRENT_TIMESTAMP
       AND c.status NOT IN ('CLOSED', 'CANCELLED')
      THEN 1
      ELSE 0
    END AS overdue
  FROM cases c
  JOIN agencies a ON a.id = c.agency_id
  LEFT JOIN users u ON u.id = c.assignee_id
  WHERE c.deleted_at IS NULL
    AND c.agency_id = #{agencyId}
  ORDER BY c.created_at DESC, c.id DESC
</select>
```

### 33.5 Why this is good

```text
No SELECT *.
Every joined column is aliased.
Aliases express result semantics.
The DTO is listing-specific.
The result map is explicit.
The identity field uses <id>.
Security scope appears in WHERE.
Overdue calculation has a semantic alias.
The query has stable ordering.
```

### 33.6 What to test

```text
assigned case maps assignee fields
unassigned case maps null assignee fields
agency fields do not collide with case fields
overdue true/false cases
closed overdue case is false
tenant/agency filter prevents cross-agency row
```

---

## 34. Anti-Patterns to Eliminate

### 34.1 `SELECT *` mapper

```xml
<select id="findAll" resultType="User">
  SELECT * FROM users
</select>
```

Why bad:

```text
schema-dependent
wide row
security leak risk
ambiguous mapping
hard review
```

### 34.2 One DTO for every query

```java
public class CaseDto {
    // 80 fields used by many screens
}
```

Why bad:

```text
partial population
unclear semantics
hard tests
accidental dependency between screens
mapping drift
```

### 34.3 Joined query without aliases

```sql
SELECT c.id, a.id, u.id
```

Why bad:

```text
duplicate labels
wrong field mapping
impossible review
```

### 34.4 Mapping security-sensitive table with generic map

```xml
<select id="findUserRaw" resultType="map">
  SELECT * FROM users WHERE id = #{id}
</select>
```

Why bad:

```text
no allowlist
possible sensitive data exposure
weak contract
```

### 34.5 Primitive nullable fields

```java
private long assigneeUserId;
```

when unassigned is valid.

Why bad:

```text
null collapses into misleading default or causes mapping error
business semantics lost
```

---

## 35. Top 1% Mental Model

A junior engineer asks:

```text
How do I make this query return an object?
```

A strong engineer asks:

```text
What is the exact result contract of this use case?
```

A top-tier engineer asks:

```text
What object shape should this use case expose?
Which columns are allowed to cross this boundary?
Which aliases encode the semantics?
Which fields are identity fields?
Which fields are nullable and why?
Which conversions are domain rules?
How will this mapping fail when schema changes?
How will we test duplicate column, null, enum, and aggregate behavior?
How will this be debugged during incident response?
```

Result mapping is not boilerplate.

It is where relational data becomes application truth.

If this boundary is sloppy, every layer above it becomes unreliable.

---

## 36. Part 6 Summary

You should now understand:

```text
resultType is convenient but limited
resultMap is the explicit production contract
auto mapping is useful but should not define semantics
column labels are the real mapper contract
joined queries require alias discipline
SELECT * is dangerous in application mappers
null handling must be intentional
Java type choice is part of persistence correctness
DTO shape should match use case semantics
mapping tests must assert individual fields
strict unknown-column behavior can catch drift
```

The central lesson:

```text
A MyBatis mapper is only as reliable as its result contract.
```

---

## 37. References

Primary references:

- MyBatis 3 Official Documentation — Mapper XML Files: `https://mybatis.org/mybatis-3/sqlmap-xml.html`
- MyBatis 3 Official Documentation — Configuration: `https://mybatis.org/mybatis-3/configuration.html`
- MyBatis 3 Official Documentation — Java API: `https://mybatis.org/mybatis-3/java-api.html`
- MyBatis-Spring Official Documentation: `https://mybatis.org/spring/`
- MyBatis Spring Boot Starter: `https://github.com/mybatis/spring-boot-starter`

---

## 38. Next Part

Next:

```text
07-advanced-result-mapping-constructor-record-immutable-dto-nested-object.md
```

Part 7 will go deeper into:

```text
constructor mapping
immutable DTOs
Java records
nested association
nested collection
one-to-one mapping
one-to-many mapping
duplicate row collapse
object graph explosion
```
