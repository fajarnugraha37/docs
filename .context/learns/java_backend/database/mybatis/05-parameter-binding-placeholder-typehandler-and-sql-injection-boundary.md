# Part 5 — Parameter Binding: `#{}`, `${}`, TypeHandler, and SQL Injection Boundary

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `05-parameter-binding-placeholder-typehandler-and-sql-injection-boundary.md`  
**Target audience:** advanced Java engineers building production-grade persistence layers with MyBatis  
**Java scope:** Java 8 through Java 25  
**Status:** Part 5 of 34

---

## 0. Why This Part Matters

In MyBatis, parameter binding is not a small syntax detail. It is the boundary between:

```text
safe SQL execution
and
runtime-generated SQL text
```

That boundary determines whether your system is:

- safe from SQL injection,
- predictable under query plan caching,
- readable during incident debugging,
- correct when parameters are null,
- resilient to vendor-specific JDBC behavior,
- maintainable when search screens and reporting queries become complex.

Most MyBatis production bugs around parameters come from one of these causes:

1. using `${}` where `#{}` should have been used;
2. passing unstructured `Map<String, Object>` parameters;
3. using dynamic `ORDER BY`, table names, or column names without whitelisting;
4. relying on implicit parameter names in multi-argument mapper methods;
5. hiding business semantics inside SQL fragments;
6. assuming a Java type maps cleanly to a JDBC type;
7. treating `TypeHandler` as a serialization hack instead of a boundary contract;
8. failing to test null, empty collection, invalid enum, and malicious string inputs.

A top-tier engineer does not merely know that `#{}` is safe and `${}` is dangerous. They know **why**, where the exceptions are, how to design a safe abstraction when SQL text must be dynamic, and how to make the mapper API express those constraints.

---

## 1. The Core Mental Model

Every MyBatis statement has two layers:

```text
SQL shape layer
  The final SQL text sent to JDBC.

Value binding layer
  The values bound into placeholders through PreparedStatement.
```

In MyBatis, the two most important parameter syntaxes map to those two different layers:

```xml
#{value}
```

means:

```text
create a JDBC placeholder (?)
and bind the Java value safely through PreparedStatement
```

while:

```xml
${value}
```

means:

```text
substitute raw text into the SQL before preparing the statement
```

The difference is architectural, not cosmetic.

### 1.1 `#{}` changes values

Example:

```xml
<select id="findByEmail" resultMap="UserRowMap">
  SELECT id, email, display_name
  FROM users
  WHERE email = #{email}
</select>
```

Generated SQL shape:

```sql
SELECT id, email, display_name
FROM users
WHERE email = ?
```

Bound value:

```text
email = "alice@example.com"
```

The database sees the input as a value, not SQL syntax.

### 1.2 `${}` changes SQL text

Example:

```xml
<select id="findAllSorted" resultMap="UserRowMap">
  SELECT id, email, display_name
  FROM users
  ORDER BY ${sortColumn}
</select>
```

If `sortColumn = "created_at DESC"`, final SQL becomes:

```sql
SELECT id, email, display_name
FROM users
ORDER BY created_at DESC
```

If `sortColumn = "created_at DESC; DELETE FROM users; --"`, the raw SQL text becomes dangerous depending on driver/database behavior and SQL execution configuration.

Even if multiple statements are blocked by the driver, the query text has already been compromised. The defect is already in your application boundary.

---

## 2. `#{}`: Prepared Statement Parameter Binding

`#{}` should be your default for all user values and almost all application values.

Use it for:

- IDs;
- UUIDs;
- email addresses;
- names;
- statuses;
- dates;
- timestamps;
- numeric ranges;
- booleans;
- tenant IDs;
- agency IDs;
- module IDs;
- search keywords;
- enum codes;
- version numbers;
- audit actor IDs;
- external reference numbers.

Example:

```xml
<select id="searchCases" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.deleted = 0
    <if test="status != null">
      AND c.status = #{status}
    </if>
    <if test="createdFrom != null">
      AND c.created_at &gt;= #{createdFrom}
    </if>
    <if test="createdTo != null">
      AND c.created_at &lt; #{createdTo}
    </if>
</select>
```

The dynamic SQL changes the shape by including or excluding clauses, but the values are still bound safely.

---

## 3. What Actually Happens Internally

At runtime, MyBatis roughly does this:

```text
Mapper method called
  -> MyBatis finds MappedStatement
  -> dynamic SQL is evaluated
  -> BoundSql is created
  -> #{...} tokens become ? placeholders
  -> ParameterMapping entries are created
  -> ParameterHandler binds Java values into PreparedStatement
  -> TypeHandler converts Java type to JDBC type
  -> JDBC executes statement
```

Important internal distinction:

```text
#{...}
  becomes ParameterMapping + JDBC placeholder

${...}
  becomes raw SQL text before JDBC preparation
```

So from a safety perspective:

```text
#{...} belongs to the value channel.
${...} belongs to the SQL text channel.
```

A safe persistence layer keeps untrusted input out of the SQL text channel.

---

## 4. `#{}` Syntax Deep Dive

A simple parameter reference:

```xml
WHERE id = #{id}
```

A parameter with JDBC type:

```xml
WHERE deleted_at IS #{deletedAt,jdbcType=TIMESTAMP}
```

A parameter with Java type hint:

```xml
WHERE amount = #{amount,javaType=java.math.BigDecimal,jdbcType=DECIMAL}
```

A parameter with custom type handler:

```xml
WHERE status = #{status,typeHandler=com.example.persistence.CaseStatusTypeHandler}
```

In most code, the simple form is enough:

```xml
#{status}
```

But explicit `jdbcType` becomes important when the value can be null and the JDBC driver/database needs a specific SQL type.

Example:

```xml
<insert id="insertCase">
  INSERT INTO cases (
    id,
    case_no,
    description,
    closed_at
  ) VALUES (
    #{id},
    #{caseNo},
    #{description,jdbcType=VARCHAR},
    #{closedAt,jdbcType=TIMESTAMP}
  )
</insert>
```

A production-grade mapper should be explicit where ambiguity creates runtime risk.

---

## 5. `${}`: Raw SQL Substitution

`${}` is not always evil, but it is always dangerous by default.

Use `${}` only when the thing being substituted is SQL syntax, not a value.

Possible legitimate examples:

- whitelisted column name;
- whitelisted sort direction;
- whitelisted table partition suffix;
- database-specific SQL fragment controlled by code;
- static SQL fragment from internal enum;
- generated statement from a trusted SQL builder.

Never use `${}` for:

- user-entered search text;
- login username;
- email;
- ID;
- status;
- tenant ID;
- agency ID;
- role;
- date;
- numeric amount;
- free-text filter;
- request parameter directly from HTTP.

Unsafe example:

```xml
<select id="unsafeFindByEmail" resultMap="UserRowMap">
  SELECT id, email, display_name
  FROM users
  WHERE email = '${email}'
</select>
```

If `email` contains:

```text
x' OR '1' = '1
```

SQL becomes:

```sql
SELECT id, email, display_name
FROM users
WHERE email = 'x' OR '1' = '1'
```

Correct version:

```xml
<select id="findByEmail" resultMap="UserRowMap">
  SELECT id, email, display_name
  FROM users
  WHERE email = #{email}
</select>
```

---

## 6. Why You Cannot Bind Identifiers With `#{}`

A common beginner mistake:

```xml
ORDER BY #{sortColumn}
```

This does not mean:

```sql
ORDER BY created_at
```

It means:

```sql
ORDER BY ?
```

The database receives the sort column as a string value, not as an identifier. It may sort by a constant, error, or behave unexpectedly depending on database.

SQL identifiers are part of the SQL grammar:

```text
table name
column name
schema name
sort direction
function name
operator
```

PreparedStatement placeholders can bind values, not grammar tokens.

So for dynamic identifiers, you need a safe SQL text generation strategy.

---

## 7. The Safe Dynamic Identifier Pattern

The correct solution is not “use `${}` carefully”. The correct solution is:

```text
convert external request into internal enum
then render only whitelisted SQL fragments
```

### 7.1 Unsafe API

```java
public final class UserSearchRequest {
    private String sortColumn;
    private String sortDirection;
}
```

This is unsafe because raw user text can reach SQL grammar.

### 7.2 Safer API

Java 8-compatible enum:

```java
public enum UserSortField {
    CREATED_AT("u.created_at"),
    EMAIL("u.email"),
    DISPLAY_NAME("u.display_name");

    private final String sqlExpression;

    UserSortField(String sqlExpression) {
        this.sqlExpression = sqlExpression;
    }

    public String sqlExpression() {
        return sqlExpression;
    }

    public static UserSortField fromApiValue(String value) {
        if (value == null) {
            return CREATED_AT;
        }
        switch (value) {
            case "createdAt":
                return CREATED_AT;
            case "email":
                return EMAIL;
            case "displayName":
                return DISPLAY_NAME;
            default:
                throw new IllegalArgumentException("Unsupported sort field: " + value);
        }
    }
}
```

Direction enum:

```java
public enum SortDirection {
    ASC("ASC"),
    DESC("DESC");

    private final String sqlKeyword;

    SortDirection(String sqlKeyword) {
        this.sqlKeyword = sqlKeyword;
    }

    public String sqlKeyword() {
        return sqlKeyword;
    }

    public static SortDirection fromApiValue(String value) {
        if (value == null) {
            return DESC;
        }
        switch (value.toLowerCase(java.util.Locale.ROOT)) {
            case "asc":
                return ASC;
            case "desc":
                return DESC;
            default:
                throw new IllegalArgumentException("Unsupported sort direction: " + value);
        }
    }
}
```

Criteria object passed to mapper:

```java
public final class UserSearchCriteria {
    private final String keyword;
    private final UserSortField sortField;
    private final SortDirection sortDirection;
    private final int limit;
    private final int offset;

    public UserSearchCriteria(
            String keyword,
            UserSortField sortField,
            SortDirection sortDirection,
            int limit,
            int offset
    ) {
        this.keyword = keyword;
        this.sortField = sortField;
        this.sortDirection = sortDirection;
        this.limit = limit;
        this.offset = offset;
    }

    public String getKeyword() {
        return keyword;
    }

    public String getSortExpression() {
        return sortField.sqlExpression();
    }

    public String getSortDirectionSql() {
        return sortDirection.sqlKeyword();
    }

    public int getLimit() {
        return limit;
    }

    public int getOffset() {
        return offset;
    }
}
```

Mapper XML:

```xml
<select id="searchUsers" parameterType="com.example.UserSearchCriteria" resultMap="UserListRowMap">
  SELECT
    u.id,
    u.email,
    u.display_name,
    u.created_at
  FROM users u
  WHERE u.deleted = 0
  <if test="keyword != null and keyword != ''">
    AND (
      LOWER(u.email) LIKE LOWER(#{keywordLike})
      OR LOWER(u.display_name) LIKE LOWER(#{keywordLike})
    )
  </if>
  ORDER BY ${sortExpression} ${sortDirectionSql}
  LIMIT #{limit}
  OFFSET #{offset}
</select>
```

The `${}` values are still SQL text, but they no longer come from raw request text. They come from internal enums.

### 7.3 Better criteria with precomputed keyword pattern

Avoid building wildcard syntax in XML if it hides semantics.

```java
public final class UserSearchCriteria {
    private final String keyword;

    public String getKeywordLike() {
        if (keyword == null || keyword.trim().isEmpty()) {
            return null;
        }
        return "%" + keyword.trim() + "%";
    }
}
```

Then XML binds the pattern safely:

```xml
<if test="keywordLike != null">
  AND LOWER(u.email) LIKE LOWER(#{keywordLike})
</if>
```

The wildcard is part of the value, not SQL grammar.

---

## 8. Safe `ORDER BY` Design

Sorting is one of the most common SQL injection entry points in MyBatis systems.

Request:

```http
GET /users?sort=createdAt&direction=desc
```

Bad mapper:

```xml
ORDER BY ${sort} ${direction}
```

Better flow:

```text
HTTP request
  -> controller parses string
  -> application validates against enum
  -> criteria contains safe enum
  -> mapper renders enum-owned SQL fragment
```

Safe mapper:

```xml
ORDER BY ${sortExpression} ${sortDirectionSql}, u.id ASC
```

Add a stable tie-breaker:

```sql
u.id ASC
```

Why?

Without stable order, pagination can duplicate or skip records under equal sort values.

Top-tier rule:

```text
Every paginated ORDER BY must be deterministic.
```

---

## 9. Safe Dynamic Table and Schema Names

Sometimes you need dynamic table names:

- monthly partition tables;
- archival tables;
- tenant-specific physical tables;
- audit tables per module;
- blue/green migration table versions.

Raw table name from request is unacceptable.

Unsafe:

```xml
SELECT * FROM ${tableName} WHERE id = #{id}
```

Safer:

```java
public enum AuditPhysicalTable {
    CURRENT("audit_trail"),
    ARCHIVE_2024("audit_trail_2024"),
    ARCHIVE_2025("audit_trail_2025");

    private final String tableName;

    AuditPhysicalTable(String tableName) {
        this.tableName = tableName;
    }

    public String tableName() {
        return tableName;
    }
}
```

Criteria:

```java
public final class AuditQueryCriteria {
    private final AuditPhysicalTable physicalTable;
    private final Long actorId;

    public String getTableName() {
        return physicalTable.tableName();
    }

    public Long getActorId() {
        return actorId;
    }
}
```

Mapper:

```xml
<select id="findAuditRows" resultMap="AuditRowMap">
  SELECT id, actor_id, action, created_at
  FROM ${tableName}
  WHERE actor_id = #{actorId}
</select>
```

But even this should be used sparingly. Dynamic physical table access complicates:

- query plan stability;
- privilege design;
- migration;
- observability;
- testing;
- static SQL review.

When dynamic table names are needed, document them as an explicit architectural decision.

---

## 10. Multiple Parameters and `@Param`

Mapper methods can receive multiple arguments:

```java
UserRow findByTenantAndEmail(Long tenantId, String email);
```

But XML needs parameter names. Without `@Param`, MyBatis may expose names like `param1`, `param2`, or actual parameter names if compiled with parameter metadata support. Relying on that is fragile.

Use explicit `@Param`:

```java
UserRow findByTenantAndEmail(
        @Param("tenantId") Long tenantId,
        @Param("email") String email
);
```

XML:

```xml
<select id="findByTenantAndEmail" resultMap="UserRowMap">
  SELECT id, tenant_id, email, display_name
  FROM users
  WHERE tenant_id = #{tenantId}
    AND email = #{email}
</select>
```

Rule:

```text
For two or more mapper method parameters, use @Param or a dedicated parameter object.
```

For advanced systems, prefer a parameter object when parameters represent one business concept.

Instead of:

```java
List<CaseRow> searchCases(
        @Param("tenantId") Long tenantId,
        @Param("status") String status,
        @Param("createdFrom") Instant createdFrom,
        @Param("createdTo") Instant createdTo,
        @Param("limit") int limit,
        @Param("offset") int offset
);
```

Prefer:

```java
List<CaseRow> searchCases(CaseSearchCriteria criteria);
```

Why?

Because the criteria object can enforce invariants:

- date range validity;
- max limit;
- default sort;
- tenant required;
- safe keyword pattern;
- safe enum conversion;
- security scope.

---

## 11. Parameter Object as Boundary Contract

A mapper parameter object is not just a bag of fields. It should express the contract of a query or command.

### 11.1 Query criteria object

```java
public final class CaseSearchCriteria {
    private final long tenantId;
    private final String caseNo;
    private final CaseStatus status;
    private final Instant createdFrom;
    private final Instant createdTo;
    private final int limit;
    private final int offset;

    public CaseSearchCriteria(
            long tenantId,
            String caseNo,
            CaseStatus status,
            Instant createdFrom,
            Instant createdTo,
            int limit,
            int offset
    ) {
        if (tenantId <= 0) {
            throw new IllegalArgumentException("tenantId is required");
        }
        if (limit < 1 || limit > 200) {
            throw new IllegalArgumentException("limit must be between 1 and 200");
        }
        if (offset < 0) {
            throw new IllegalArgumentException("offset must not be negative");
        }
        if (createdFrom != null && createdTo != null && !createdFrom.isBefore(createdTo)) {
            throw new IllegalArgumentException("createdFrom must be before createdTo");
        }

        this.tenantId = tenantId;
        this.caseNo = normalize(caseNo);
        this.status = status;
        this.createdFrom = createdFrom;
        this.createdTo = createdTo;
        this.limit = limit;
        this.offset = offset;
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public long getTenantId() { return tenantId; }
    public String getCaseNo() { return caseNo; }
    public CaseStatus getStatus() { return status; }
    public Instant getCreatedFrom() { return createdFrom; }
    public Instant getCreatedTo() { return createdTo; }
    public int getLimit() { return limit; }
    public int getOffset() { return offset; }
}
```

Mapper:

```xml
<select id="searchCases" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at
  FROM cases c
  WHERE c.tenant_id = #{tenantId}
    AND c.deleted = 0
  <if test="caseNo != null">
    AND c.case_no = #{caseNo}
  </if>
  <if test="status != null">
    AND c.status = #{status}
  </if>
  <if test="createdFrom != null">
    AND c.created_at &gt;= #{createdFrom}
  </if>
  <if test="createdTo != null">
    AND c.created_at &lt; #{createdTo}
  </if>
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT #{limit}
  OFFSET #{offset}
</select>
```

### 11.2 Command object

For writes, use command objects:

```java
public final class UpdateCaseStatusCommand {
    private final long tenantId;
    private final long caseId;
    private final CaseStatus expectedStatus;
    private final CaseStatus newStatus;
    private final long actorUserId;
    private final long expectedVersion;

    // constructor validates state transition inputs
}
```

Mapper:

```xml
<update id="updateCaseStatus">
  UPDATE cases
  SET
    status = #{newStatus},
    version = version + 1,
    updated_by = #{actorUserId},
    updated_at = CURRENT_TIMESTAMP
  WHERE tenant_id = #{tenantId}
    AND id = #{caseId}
    AND status = #{expectedStatus}
    AND version = #{expectedVersion}
</update>
```

Rows affected becomes a correctness signal:

```text
1 row  -> transition succeeded
0 rows -> not found, wrong tenant, wrong status, or stale version
>1 rows -> severe data integrity bug
```

---

## 12. Why `Map<String, Object>` Is Dangerous

MyBatis allows map parameters:

```java
List<UserRow> search(Map<String, Object> params);
```

XML:

```xml
WHERE tenant_id = #{tenantId}
<if test="status != null">
  AND status = #{status}
</if>
```

This is flexible, but flexibility is the problem.

Map parameter risks:

- no compile-time field name safety;
- typo becomes runtime failure;
- no invariant enforcement;
- no clear API contract;
- hard to search usages;
- values may have inconsistent types;
- easy to sneak raw SQL fragment into map;
- poor IDE refactoring support;
- poor documentation;
- difficult validation.

Acceptable use cases:

- framework-level infrastructure;
- temporary migration scripts;
- simple internal utility mapper;
- truly generic metadata query.

For application persistence, prefer explicit objects.

Top-tier rule:

```text
A mapper parameter should describe a domain operation, not a dictionary of accidental values.
```

---

## 13. OGNL Expressions in Dynamic SQL

MyBatis dynamic SQL uses expression evaluation for conditions.

Example:

```xml
<if test="status != null">
  AND status = #{status}
</if>
```

Nested property:

```xml
<if test="dateRange != null and dateRange.from != null">
  AND created_at &gt;= #{dateRange.from}
</if>
```

Collection check:

```xml
<if test="ids != null and ids.size() > 0">
  AND id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
</if>
```

Be careful with expression complexity.

Bad:

```xml
<if test="status != null and (status.name() == 'OPEN' or status.name() == 'PENDING') and user != null and user.role != null and user.role.canViewSensitiveCases()">
```

This makes the mapper depend on business behavior.

Better:

```java
public boolean isSensitiveCaseFilterEnabled() {
    return sensitiveCaseFilterEnabled;
}
```

XML:

```xml
<if test="sensitiveCaseFilterEnabled">
  AND c.sensitive_flag = 1
</if>
```

Rule:

```text
Dynamic SQL expressions should check data presence and simple flags, not encode business policy.
```

---

## 14. `foreach` and Collection Parameters

`foreach` is commonly used for `IN` clauses.

Mapper method:

```java
List<UserRow> findByIds(@Param("ids") List<Long> ids);
```

XML:

```xml
<select id="findByIds" resultMap="UserRowMap">
  SELECT id, email, display_name
  FROM users
  WHERE id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
</select>
```

Generated SQL:

```sql
WHERE id IN (?, ?, ?)
```

Values are safely bound.

### 14.1 Empty list problem

If `ids` is empty, SQL can become invalid:

```sql
WHERE id IN ()
```

Do not let this reach the mapper accidentally.

Option A: service returns empty result before mapper call:

```java
public List<UserRow> findUsersByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) {
        return java.util.Collections.emptyList();
    }
    return userMapper.findByIds(ids);
}
```

Option B: XML guards explicitly:

```xml
<select id="findByIds" resultMap="UserRowMap">
  SELECT id, email, display_name
  FROM users
  <choose>
    <when test="ids != null and ids.size() > 0">
      WHERE id IN
      <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
      </foreach>
    </when>
    <otherwise>
      WHERE 1 = 0
    </otherwise>
  </choose>
</select>
```

Prefer Option A when empty input naturally means empty output. Use Option B when the mapper must be defensive because it is called from multiple contexts.

### 14.2 Large IN list problem

Large `IN` lists can create:

- SQL text bloat;
- parse overhead;
- optimizer confusion;
- parameter count limits;
- poor plan quality;
- network overhead.

Alternatives:

- chunk the query;
- use temporary table;
- use table-valued parameter where supported;
- bulk load IDs into staging table;
- use join against a persisted work table;
- use array binding where vendor/driver supports it.

Top-tier rule:

```text
IN list is fine for small bounded collections. It is not a general bulk data transport mechanism.
```

---

## 15. `bind`: Creating Derived Values in XML

MyBatis dynamic SQL supports creating bound variables.

Example:

```xml
<select id="searchByTitle" resultMap="ArticleRowMap">
  <bind name="pattern" value="'%' + title + '%'" />
  SELECT id, title, created_at
  FROM articles
  WHERE title LIKE #{pattern}
</select>
```

This is safer than:

```xml
WHERE title LIKE '%${title}%'
```

because the resulting pattern is still bound through `#{}`.

However, prefer precomputing derived values in criteria objects when the logic is business-relevant or reused.

Good XML-only use cases:

- simple LIKE pattern;
- lowercasing a simple search value;
- deriving a small internal expression for one mapper statement.

Avoid `bind` for:

- authorization logic;
- complex state logic;
- parsing user request;
- constructing SQL fragments;
- complex JSON serialization.

---

## 16. Null Handling

Null handling is one of the most subtle parameter-binding topics.

### 16.1 Equality with null is not SQL equality

Wrong:

```xml
WHERE closed_at = #{closedAt}
```

If `closedAt` is null, this becomes:

```sql
WHERE closed_at = NULL
```

which does not match rows in SQL.

Correct dynamic handling:

```xml
<choose>
  <when test="closedAt != null">
    closed_at = #{closedAt}
  </when>
  <otherwise>
    closed_at IS NULL
  </otherwise>
</choose>
```

But be careful: often null means “do not filter”, not “filter for NULL”.

Three different meanings:

```text
null means ignore this filter
null means match rows where column IS NULL
null means set column to NULL
```

Do not let one nullable field ambiguously mean all three.

### 16.2 Filter object design

Bad:

```java
private Instant closedAt;
```

Ambiguous.

Better:

```java
public enum NullFilterMode {
    IGNORE,
    IS_NULL,
    IS_NOT_NULL,
    EQUALS_VALUE
}
```

or explicit fields:

```java
private boolean filterClosedAtIsNull;
private Instant closedAtEquals;
```

The exact design depends on the API, but the principle is fixed:

```text
SQL null semantics must be explicit at the boundary.
```

---

## 17. Partial Update and Null Semantics

Partial update is dangerous because null can mean:

1. field omitted;
2. field intentionally set to null;
3. field invalid;
4. field unknown.

Bad mapper:

```xml
<update id="updateUserSelective">
  UPDATE users
  <set>
    <if test="email != null">email = #{email},</if>
    <if test="displayName != null">display_name = #{displayName},</if>
    <if test="phone != null">phone = #{phone},</if>
  </set>
  WHERE id = #{id}
</update>
```

This cannot set `phone` to null.

Better command model:

```java
public final class FieldUpdate<T> {
    private final boolean present;
    private final T value;

    private FieldUpdate(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> FieldUpdate<T> absent() {
        return new FieldUpdate<T>(false, null);
    }

    public static <T> FieldUpdate<T> of(T value) {
        return new FieldUpdate<T>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T getValue() {
        return value;
    }
}
```

Command:

```java
public final class PatchUserCommand {
    private final long id;
    private final FieldUpdate<String> displayName;
    private final FieldUpdate<String> phone;

    public boolean isDisplayNamePresent() {
        return displayName.isPresent();
    }

    public String getDisplayNameValue() {
        return displayName.getValue();
    }

    public boolean isPhonePresent() {
        return phone.isPresent();
    }

    public String getPhoneValue() {
        return phone.getValue();
    }
}
```

Mapper:

```xml
<update id="patchUser">
  UPDATE users
  <set>
    <if test="displayNamePresent">
      display_name = #{displayNameValue,jdbcType=VARCHAR},
    </if>
    <if test="phonePresent">
      phone = #{phoneValue,jdbcType=VARCHAR},
    </if>
  </set>
  WHERE id = #{id}
</update>
```

Now “absent” and “set null” are different.

---

## 18. `TypeHandler`: The Conversion Boundary

A `TypeHandler` converts between Java values and JDBC values.

Conceptually:

```text
Java object -> TypeHandler -> PreparedStatement parameter
ResultSet value -> TypeHandler -> Java object
```

Use `TypeHandler` when a Java type has a stable database representation.

Good use cases:

- enum stored as code;
- value object stored as string/number;
- JSON value stored as CLOB/VARCHAR/JSONB;
- money stored as decimal;
- yes/no flag stored as `Y`/`N`;
- status stored as compact code;
- database-specific type that needs explicit conversion.

Poor use cases:

- hiding business rule conversion;
- parsing arbitrary request values;
- doing remote calls;
- performing validation that belongs in service/application layer;
- serializing huge object graphs without explicit ownership;
- masking schema design problems.

---

## 19. Enum Mapping: Name, Ordinal, Code

Enums are deceptively dangerous.

### 19.1 Name mapping

Java:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Database:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
```

Pros:

- readable;
- stable if enum names never change;
- easy to debug.

Cons:

- renaming enum breaks stored data;
- long names consume more storage;
- external code may not match enum name.

### 19.2 Ordinal mapping

Database:

```text
0, 1, 2, 3
```

Avoid for persistent domain values.

If enum order changes, data meaning changes.

Top-tier rule:

```text
Never persist business enum ordinal unless the ordinal is externally specified and immutable.
```

### 19.3 Code mapping

Java:

```java
public enum CaseStatus {
    DRAFT("D"),
    SUBMITTED("S"),
    APPROVED("A"),
    REJECTED("R");

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

TypeHandler:

```java
package com.example.persistence.type;

import com.example.domain.CaseStatus;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

@MappedTypes(CaseStatus.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {

    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            CaseStatus parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String code = rs.getString(columnName);
        return code == null ? null : CaseStatus.fromCode(code);
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String code = rs.getString(columnIndex);
        return code == null ? null : CaseStatus.fromCode(code);
    }

    @Override
    public CaseStatus getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String code = cs.getString(columnIndex);
        return code == null ? null : CaseStatus.fromCode(code);
    }
}
```

Mapper:

```xml
WHERE status = #{status,typeHandler=com.example.persistence.type.CaseStatusTypeHandler}
```

or register package-level type handlers and use:

```xml
WHERE status = #{status}
```

---

## 20. Value Object Mapping

Suppose domain uses:

```java
public final class CaseNumber {
    private final String value;

    public CaseNumber(String value) {
        if (value == null || !value.matches("CASE-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid case number");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Database stores:

```text
VARCHAR2(20)
```

TypeHandler:

```java
@MappedTypes(CaseNumber.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseNumberTypeHandler extends BaseTypeHandler<CaseNumber> {

    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            CaseNumber parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter.value());
    }

    @Override
    public CaseNumber getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return value == null ? null : new CaseNumber(value);
    }

    @Override
    public CaseNumber getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return value == null ? null : new CaseNumber(value);
    }

    @Override
    public CaseNumber getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return value == null ? null : new CaseNumber(value);
    }
}
```

This protects the domain from primitive obsession.

But be careful: if invalid historical database values exist, constructor validation may break reads. In that case, decide explicitly:

- fail fast and clean data;
- map to `InvalidCaseNumber` representation;
- temporarily use lenient handler during migration;
- map to raw string in legacy read model.

Do not accidentally turn a data quality problem into random runtime instability.

---

## 21. JSON Parameter Mapping

Some systems store JSON in:

- PostgreSQL `jsonb`;
- MySQL `json`;
- Oracle `CLOB` or native JSON-supported column;
- SQL Server `nvarchar(max)` with JSON checks.

A TypeHandler can serialize and deserialize JSON.

Example concept:

```java
public final class AuditMetadata {
    private final String module;
    private final String action;
    private final java.util.Map<String, Object> attributes;
}
```

Mapper:

```xml
<insert id="insertAuditTrail">
  INSERT INTO audit_trail (
    id,
    module,
    action,
    metadata_json
  ) VALUES (
    #{id},
    #{module},
    #{action},
    #{metadata,typeHandler=com.example.persistence.type.AuditMetadataJsonTypeHandler}
  )
</insert>
```

TypeHandler responsibilities:

```text
Java object -> JSON string/driver object
JSON string/driver object -> Java object
```

It should not decide:

- who is allowed to see metadata;
- which fields should be included for business reasons;
- whether audit should be created;
- how to redact PII at logging time.

Those are application/service concerns.

### 21.1 JSON handler risk

JSON TypeHandlers can become dangerous when they hide schema-less chaos.

Ask:

```text
Is this JSON column a stable document contract?
Or is it an ungoverned dumping ground?
```

If it is a dumping ground, MyBatis cannot save the design. You need data governance.

---

## 22. Registering TypeHandlers

Registration options:

### 22.1 XML configuration

```xml
<typeHandlers>
  <typeHandler handler="com.example.persistence.type.CaseStatusTypeHandler"/>
</typeHandlers>
```

### 22.2 Package scanning with Spring Boot

Application config:

```yaml
mybatis:
  type-handlers-package: com.example.persistence.type
```

### 22.3 Inline per parameter/result

```xml
#{status,typeHandler=com.example.persistence.type.CaseStatusTypeHandler}
```

Inline is explicit but noisy. Package registration is cleaner but requires governance.

Top-tier recommendation:

```text
Use package registration for stable domain-wide handlers.
Use inline handler only when a statement needs special one-off conversion.
```

---

## 23. TypeHandler Null Handling

TypeHandler null behavior matters.

In modern MyBatis, subclasses of `BaseTypeHandler` are responsible for null handling when reading nullable values. Do not assume the base class will call `wasNull()` for you.

For object types like `String`, `BigDecimal`, `Timestamp`, many `ResultSet.getXxx()` methods already return null for SQL NULL.

For primitive-like reads, be careful:

```java
int value = rs.getInt(columnName);
```

If the column is SQL NULL, JDBC returns `0`, and you must check:

```java
if (rs.wasNull()) {
    return null;
}
```

Example:

```java
Integer value = rs.getInt(columnName);
if (rs.wasNull()) {
    return null;
}
return value;
```

For enum code mapping using `getString`, null is straightforward:

```java
String code = rs.getString(columnName);
return code == null ? null : Status.fromCode(code);
```

Rule:

```text
Every custom TypeHandler must have explicit tests for SQL NULL read and Java null write.
```

---

## 24. Java Time Types

Java 8 introduced `java.time`, which should be preferred over legacy `java.util.Date` and `java.sql.Timestamp` in application code.

Common choices:

```text
Instant
  absolute machine timestamp, useful for audit/event time

LocalDate
  date without time zone, useful for birth date, due date, business date

LocalDateTime
  local date-time without zone, dangerous if interpreted globally

OffsetDateTime
  timestamp with offset, useful when offset preservation matters
```

Mapper example:

```xml
<insert id="insertEvent">
  INSERT INTO event_log (
    id,
    occurred_at,
    business_date
  ) VALUES (
    #{id},
    #{occurredAt,jdbcType=TIMESTAMP},
    #{businessDate,jdbcType=DATE}
  )
</insert>
```

Top-tier concern:

```text
Do not let TypeHandler hide time-zone policy.
```

Decide at architecture level:

- store UTC?
- store local business time?
- store offset?
- store zone ID separately?
- convert at API boundary?
- convert at DB boundary?

For regulatory/case systems, timestamp interpretation is often legally meaningful. Be explicit.

---

## 25. BigDecimal and Money

Money should not be represented as `double`.

Use:

```java
BigDecimal
```

or a domain value object:

```java
public final class Money {
    private final BigDecimal amount;
    private final String currency;
}
```

Simple amount mapping:

```xml
WHERE amount &gt;= #{minimumAmount,jdbcType=DECIMAL}
```

Potential risk:

- database scale mismatch;
- rounding mode mismatch;
- currency not stored;
- comparing amounts from different currencies;
- using `BigDecimal.equals()` instead of numeric comparison.

TypeHandler can help with conversion, but it cannot fix unclear money semantics.

---

## 26. Boolean Mapping

Different databases represent booleans differently:

```text
BOOLEAN
NUMBER(1)
CHAR(1) Y/N
CHAR(1) T/F
VARCHAR true/false
```

Example TypeHandler for `Y/N`:

```java
@MappedTypes(Boolean.class)
@MappedJdbcTypes(JdbcType.CHAR)
public final class YesNoBooleanTypeHandler extends BaseTypeHandler<Boolean> {

    @Override
    public void setNonNullParameter(
            PreparedStatement ps,
            int i,
            Boolean parameter,
            JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter ? "Y" : "N");
    }

    @Override
    public Boolean getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return toBoolean(value);
    }

    @Override
    public Boolean getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return toBoolean(value);
    }

    @Override
    public Boolean getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return toBoolean(value);
    }

    private static Boolean toBoolean(String value) {
        if (value == null) {
            return null;
        }
        if ("Y".equals(value)) {
            return Boolean.TRUE;
        }
        if ("N".equals(value)) {
            return Boolean.FALSE;
        }
        throw new IllegalArgumentException("Invalid boolean flag: " + value);
    }
}
```

Question to decide:

```text
Should invalid database value fail fast or be mapped to null?
```

For regulated systems, fail fast is usually better because silent coercion hides data corruption.

---

## 27. `jdbcType` and Null Writes

When writing null values, some drivers require the JDBC type:

```xml
#{closedAt,jdbcType=TIMESTAMP}
```

Without it, MyBatis may not know which SQL type to pass to `setNull`.

Use explicit `jdbcType` for nullable columns in writes:

```xml
<update id="closeCase">
  UPDATE cases
  SET
    closed_at = #{closedAt,jdbcType=TIMESTAMP},
    closure_reason = #{closureReason,jdbcType=VARCHAR}
  WHERE id = #{caseId}
</update>
```

This is especially important for:

- Oracle;
- nullable date/time;
- CLOB/BLOB;
- JSON/CLOB columns;
- vendor-specific types;
- stored procedure parameters.

---

## 28. Parameter Binding and Query Plan Stability

Prepared statements help databases reuse SQL shapes.

With `#{}`:

```sql
WHERE email = ?
```

Same SQL shape for many emails.

With `${}`:

```sql
WHERE email = 'alice@example.com'
WHERE email = 'bob@example.com'
WHERE email = 'charlie@example.com'
```

Different SQL text for every value.

Consequences:

- more parsing;
- poorer plan cache reuse;
- more CPU;
- unstable performance;
- harder SQL normalization in monitoring.

Therefore:

```text
#{}` is not only safer. It is usually better for database performance observability.
```

---

## 29. Parameter Binding and Logging

Logging SQL parameters is useful but dangerous.

Do not blindly log:

- password;
- token;
- authorization code;
- session ID;
- national ID;
- personal address;
- phone number;
- email if considered sensitive in your policy;
- full free-text content;
- document body;
- CLOB/BLOB;
- JSON metadata containing PII.

Useful log pattern:

```text
mapper=CaseMapper.searchCases
statementId=com.example.CaseMapper.searchCases
elapsedMs=82
tenantId=12
status=OPEN
limit=50
offset=0
resultCount=50
correlationId=...
```

Avoid:

```text
Executing SQL with full parameters: ... NRIC=S1234567A ...
```

Top-tier rule:

```text
Observability should reveal behavior, not leak data.
```

---

## 30. Security Boundary: Trust Levels

Classify every value that enters a mapper.

```text
Untrusted external input
  HTTP query params, request body, headers, uploaded files

Authenticated user context
  user id, tenant id, role, agency id

Application-derived values
  enums, constants, computed date ranges, generated IDs

Database-derived values
  prior query results used in later SQL

Internal SQL fragments
  enum-owned column expressions, static table names, vendor fragments
```

Only the last category may ever flow into `${}`.

Even authenticated user context is not SQL text safe. A valid user ID is still a value, not SQL grammar.

---

## 31. Tenant and Security Scope Parameters

Tenant ID should almost always be bound with `#{}`:

```xml
WHERE tenant_id = #{tenantId}
```

Do not use:

```xml
WHERE tenant_id = ${tenantId}
```

Even if tenant ID is numeric, raw substitution is unnecessary and creates avoidable risk.

Better command/criteria design:

```java
public final class TenantScopedCriteria {
    private final long tenantId;

    protected TenantScopedCriteria(long tenantId) {
        if (tenantId <= 0) {
            throw new IllegalArgumentException("tenantId is required");
        }
        this.tenantId = tenantId;
    }

    public long getTenantId() {
        return tenantId;
    }
}
```

Every tenant-scoped mapper receives a tenant-scoped parameter object.

For high-security systems, consider review rule:

```text
No SELECT/UPDATE/DELETE on tenant-owned table without tenant predicate.
```

This can be checked manually, by tests, or by SQL review tooling.

---

## 32. Safe LIKE Queries

Bad:

```xml
WHERE name LIKE '%${keyword}%'
```

Good:

```xml
WHERE name LIKE #{keywordPattern}
```

Criteria:

```java
public String getKeywordPattern() {
    if (keyword == null || keyword.trim().isEmpty()) {
        return null;
    }
    return "%" + keyword.trim() + "%";
}
```

XML:

```xml
<if test="keywordPattern != null">
  AND name LIKE #{keywordPattern}
</if>
```

### 32.1 Escaping LIKE wildcards

User input `%` and `_` have special meaning in SQL LIKE.

If the requirement is literal search, escape them.

Java:

```java
public static String toLikeContainsPattern(String raw) {
    if (raw == null || raw.trim().isEmpty()) {
        return null;
    }
    String value = raw.trim()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_");
    return "%" + value + "%";
}
```

SQL:

```xml
AND name LIKE #{keywordPattern} ESCAPE '\'
```

Be aware that escaping syntax can vary by database.

---

## 33. Safe Date Range Parameters

Avoid ambiguous date ranges.

Bad:

```xml
WHERE created_at BETWEEN #{from} AND #{to}
```

Potential issues:

- inclusive upper bound can miss rows if `to` is date-only;
- time zone ambiguity;
- `BETWEEN` is inclusive on both sides;
- API date semantics may not match DB timestamp semantics.

Better pattern:

```xml
<if test="createdFromInclusive != null">
  AND created_at &gt;= #{createdFromInclusive}
</if>
<if test="createdToExclusive != null">
  AND created_at &lt; #{createdToExclusive}
</if>
```

Criteria should compute precise bounds.

Example:

```java
public final class CreatedDateRange {
    private final Instant fromInclusive;
    private final Instant toExclusive;
}
```

Top-tier rule:

```text
Use inclusive lower bound and exclusive upper bound for time ranges unless there is a clear reason not to.
```

---

## 34. Parameter Binding for State Machines

In case management and regulatory systems, updates often represent state transitions.

Bad:

```xml
UPDATE cases
SET status = #{newStatus}
WHERE id = #{caseId}
```

This allows accidental invalid transitions if service code has a bug.

Better:

```xml
<update id="transitionCase">
  UPDATE cases
  SET
    status = #{newStatus},
    version = version + 1,
    updated_by = #{actorUserId},
    updated_at = CURRENT_TIMESTAMP
  WHERE tenant_id = #{tenantId}
    AND id = #{caseId}
    AND status = #{expectedCurrentStatus}
    AND version = #{expectedVersion}
</update>
```

Parameter object:

```java
public final class TransitionCaseCommand {
    private final long tenantId;
    private final long caseId;
    private final CaseStatus expectedCurrentStatus;
    private final CaseStatus newStatus;
    private final long expectedVersion;
    private final long actorUserId;
}
```

This turns parameters into concurrency and correctness guards.

Top-tier mindset:

```text
Parameters are not only data. They can encode preconditions.
```

---

## 35. Parameter Binding for Audit Fields

Audit fields should be explicit in write commands.

Example:

```xml
<insert id="insertCase">
  INSERT INTO cases (
    id,
    tenant_id,
    case_no,
    status,
    created_by,
    created_at,
    updated_by,
    updated_at,
    version
  ) VALUES (
    #{id},
    #{tenantId},
    #{caseNo},
    #{status},
    #{actorUserId},
    CURRENT_TIMESTAMP,
    #{actorUserId},
    CURRENT_TIMESTAMP,
    0
  )
</insert>
```

Avoid letting database triggers silently fill everything unless that is your explicit architecture.

Why?

- application audit may need actor context;
- trigger audit may not know request correlation ID;
- generated values may be harder to test;
- behavior can be invisible to application engineers.

Best design depends on governance, but the boundary must be explicit.

---

## 36. Parameter Binding and Generated SQL Review

For every complex dynamic mapper, review two things separately:

```text
1. SQL shape possibilities
2. Bound parameter values
```

Example criteria combinations:

```text
no optional filters
status only
date range only
keyword only
status + date range
empty list
large list
null tenant
invalid sort
malicious keyword
```

A mapper test should verify:

- statement compiles;
- expected rows returned;
- empty inputs behave correctly;
- generated SQL is syntactically valid;
- unsafe `${}` cannot receive raw user input;
- TypeHandler converts correctly;
- null values behave intentionally.

---

## 37. Common Parameter Binding Failure Cases

### 37.1 `Parameter not found`

Symptom:

```text
Parameter 'tenantId' not found. Available parameters are [arg0, arg1, param1, param2]
```

Cause:

```java
UserRow find(Long tenantId, String email);
```

XML:

```xml
WHERE tenant_id = #{tenantId}
```

Fix:

```java
UserRow find(@Param("tenantId") Long tenantId, @Param("email") String email);
```

or use parameter object.

### 37.2 Unsafe substitution

Symptom:

```xml
WHERE name LIKE '%${keyword}%'
```

Fix:

```xml
WHERE name LIKE #{keywordPattern}
```

### 37.3 Empty IN list

Symptom:

```sql
WHERE id IN ()
```

Fix:

- return empty result before mapper;
- or use `<choose>` with `WHERE 1 = 0`.

### 37.4 Null equality bug

Symptom:

```sql
WHERE closed_at = NULL
```

Fix:

- use `IS NULL`;
- or clarify null means “ignore filter”.

### 37.5 Invalid enum from database

Symptom:

```text
IllegalArgumentException: Unknown status code: X
```

Cause:

- database contains unknown code;
- enum changed;
- migration incomplete;
- TypeHandler too strict for legacy data.

Fix:

- clean data;
- add compatibility enum;
- add migration handler;
- fail fast with clear error if data corruption should not be tolerated.

### 37.6 Missing `jdbcType` for nullable write

Symptom:

```text
Error setting null for parameter
```

Fix:

```xml
#{closedAt,jdbcType=TIMESTAMP}
```

---

## 38. Bad Patterns and Better Alternatives

### 38.1 Bad: raw order by

```xml
ORDER BY ${orderBy}
```

Better:

```xml
ORDER BY ${sortExpression} ${sortDirectionSql}, id DESC
```

where both values come from internal enums.

### 38.2 Bad: generic filter map

```java
List<Row> search(Map<String, Object> filters);
```

Better:

```java
List<Row> search(CaseSearchCriteria criteria);
```

### 38.3 Bad: all-purpose dynamic update

```xml
<update id="updateAnything">
  UPDATE ${tableName}
  SET ${setClause}
  WHERE ${whereClause}
</update>
```

Better:

- define specific mapper method per business operation;
- use command object;
- use safe dynamic `<set>` with explicit columns;
- avoid dynamic table unless strongly justified.

### 38.4 Bad: enum ordinal

```text
APPROVED -> 2
```

Better:

```text
APPROVED -> 'A'
```

with explicit `TypeHandler`.

### 38.5 Bad: SQL grammar from frontend

Frontend sends:

```json
{
  "where": "status = 'OPEN'",
  "orderBy": "created_at desc"
}
```

Better:

Frontend sends:

```json
{
  "status": "OPEN",
  "sort": "createdAt",
  "direction": "desc"
}
```

Backend converts to safe criteria.

---

## 39. Design Checklist for Mapper Parameters

Before approving a mapper method, ask:

```text
Parameter API
  [ ] Does the method use a dedicated criteria/command object when appropriate?
  [ ] Are multiple primitive parameters annotated with @Param?
  [ ] Are parameter names stable and clear?
  [ ] Are required parameters validated before mapper call?

Security
  [ ] Are all user values bound with #{}?
  [ ] Is every ${} value generated by trusted application code?
  [ ] Are dynamic identifiers whitelisted?
  [ ] Is tenant/security scope mandatory?

Null semantics
  [ ] Does null mean ignore, IS NULL, or set NULL?
  [ ] Are nullable writes given jdbcType where needed?
  [ ] Are partial updates explicit about absent vs null?

Collections
  [ ] Are empty collections handled?
  [ ] Are large collections bounded or handled with bulk strategy?
  [ ] Is foreach using #{} for item values?

Type conversion
  [ ] Are enums mapped safely?
  [ ] Are value objects mapped intentionally?
  [ ] Are custom TypeHandlers tested for null and invalid values?

Performance
  [ ] Does SQL shape remain stable where possible?
  [ ] Is ${} avoided for values to preserve plan reuse?
  [ ] Are LIKE and IN queries bounded?

Observability
  [ ] Can the statement be identified in logs?
  [ ] Are sensitive parameter values masked?
  [ ] Can dynamic SQL branches be reproduced in tests?
```

---

## 40. Mini Case Study: Secure Search Screen

### 40.1 Requirement

Build a case search screen with filters:

- tenant ID from authenticated context;
- optional case number;
- optional status;
- optional created date range;
- optional keyword;
- sorting by created date, case number, or status;
- pagination;
- no SQL injection;
- stable pagination;
- max page size 100.

### 40.2 API request

```java
public final class CaseSearchRequest {
    private String caseNo;
    private String status;
    private String createdFrom;
    private String createdTo;
    private String keyword;
    private String sort;
    private String direction;
    private Integer limit;
    private Integer offset;
}
```

Do not pass this directly to MyBatis.

### 40.3 Internal criteria

```java
public final class CaseSearchCriteria {
    private final long tenantId;
    private final String caseNo;
    private final CaseStatus status;
    private final Instant createdFromInclusive;
    private final Instant createdToExclusive;
    private final String keywordPattern;
    private final CaseSortField sortField;
    private final SortDirection sortDirection;
    private final int limit;
    private final int offset;

    public CaseSearchCriteria(
            long tenantId,
            String caseNo,
            CaseStatus status,
            Instant createdFromInclusive,
            Instant createdToExclusive,
            String keyword,
            CaseSortField sortField,
            SortDirection sortDirection,
            int limit,
            int offset
    ) {
        if (tenantId <= 0) {
            throw new IllegalArgumentException("tenantId is required");
        }
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException("limit must be between 1 and 100");
        }
        if (offset < 0) {
            throw new IllegalArgumentException("offset must not be negative");
        }
        if (createdFromInclusive != null && createdToExclusive != null
                && !createdFromInclusive.isBefore(createdToExclusive)) {
            throw new IllegalArgumentException("invalid created range");
        }

        this.tenantId = tenantId;
        this.caseNo = normalize(caseNo);
        this.status = status;
        this.createdFromInclusive = createdFromInclusive;
        this.createdToExclusive = createdToExclusive;
        this.keywordPattern = toLikeContainsPattern(keyword);
        this.sortField = sortField == null ? CaseSortField.CREATED_AT : sortField;
        this.sortDirection = sortDirection == null ? SortDirection.DESC : sortDirection;
        this.limit = limit;
        this.offset = offset;
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String toLikeContainsPattern(String raw) {
        String normalized = normalize(raw);
        if (normalized == null) {
            return null;
        }
        String escaped = normalized
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped + "%";
    }

    public long getTenantId() { return tenantId; }
    public String getCaseNo() { return caseNo; }
    public CaseStatus getStatus() { return status; }
    public Instant getCreatedFromInclusive() { return createdFromInclusive; }
    public Instant getCreatedToExclusive() { return createdToExclusive; }
    public String getKeywordPattern() { return keywordPattern; }
    public String getSortExpression() { return sortField.sqlExpression(); }
    public String getSortDirectionSql() { return sortDirection.sqlKeyword(); }
    public int getLimit() { return limit; }
    public int getOffset() { return offset; }
}
```

Sort field:

```java
public enum CaseSortField {
    CREATED_AT("c.created_at"),
    CASE_NO("c.case_no"),
    STATUS("c.status");

    private final String sqlExpression;

    CaseSortField(String sqlExpression) {
        this.sqlExpression = sqlExpression;
    }

    public String sqlExpression() {
        return sqlExpression;
    }
}
```

Direction:

```java
public enum SortDirection {
    ASC("ASC"),
    DESC("DESC");

    private final String sqlKeyword;

    SortDirection(String sqlKeyword) {
        this.sqlKeyword = sqlKeyword;
    }

    public String sqlKeyword() {
        return sqlKeyword;
    }
}
```

### 40.4 Mapper interface

```java
public interface CaseSearchMapper {
    List<CaseListRow> searchCases(CaseSearchCriteria criteria);
    long countCases(CaseSearchCriteria criteria);
}
```

### 40.5 Mapper XML

```xml
<mapper namespace="com.example.casepersistence.CaseSearchMapper">

  <resultMap id="CaseListRowMap" type="com.example.casepersistence.CaseListRow">
    <id property="id" column="id" />
    <result property="caseNo" column="case_no" />
    <result property="status" column="status" />
    <result property="createdAt" column="created_at" />
    <result property="subject" column="subject" />
  </resultMap>

  <sql id="CaseSearchWhere">
    WHERE c.tenant_id = #{tenantId}
      AND c.deleted = 0
    <if test="caseNo != null">
      AND c.case_no = #{caseNo}
    </if>
    <if test="status != null">
      AND c.status = #{status}
    </if>
    <if test="createdFromInclusive != null">
      AND c.created_at &gt;= #{createdFromInclusive}
    </if>
    <if test="createdToExclusive != null">
      AND c.created_at &lt; #{createdToExclusive}
    </if>
    <if test="keywordPattern != null">
      AND (
        LOWER(c.case_no) LIKE LOWER(#{keywordPattern}) ESCAPE '\'
        OR LOWER(c.subject) LIKE LOWER(#{keywordPattern}) ESCAPE '\'
      )
    </if>
  </sql>

  <select id="searchCases" parameterType="com.example.casepersistence.CaseSearchCriteria" resultMap="CaseListRowMap">
    SELECT
      c.id,
      c.case_no,
      c.status,
      c.created_at,
      c.subject
    FROM cases c
    <include refid="CaseSearchWhere" />
    ORDER BY ${sortExpression} ${sortDirectionSql}, c.id DESC
    LIMIT #{limit}
    OFFSET #{offset}
  </select>

  <select id="countCases" parameterType="com.example.casepersistence.CaseSearchCriteria" resultType="long">
    SELECT COUNT(*)
    FROM cases c
    <include refid="CaseSearchWhere" />
  </select>

</mapper>
```

### 40.6 Why this design is safe

```text
User values
  tenantId, caseNo, status, dates, keyword, limit, offset
  -> bound with #{}

SQL grammar
  sort column, sort direction
  -> generated from internal enums
  -> rendered with ${}

Pagination
  deterministic order by selected sort + id tie-breaker

Null semantics
  optional filters are ignored when null

Security
  tenant predicate is mandatory

Observability
  criteria object describes the full query contract
```

---

## 41. Java 8 to Java 25 Notes

### 41.1 Java 8

Use:

- POJO criteria classes;
- explicit getters;
- builder pattern if needed;
- enums for whitelists;
- `java.time` types;
- no records;
- no sealed interfaces.

### 41.2 Java 11

Mostly same as Java 8. You can use newer library baselines but avoid language features unavailable to Java 8 if sharing code.

### 41.3 Java 17

You may use records for simple immutable criteria/projections, but test mapper property access carefully.

Example:

```java
public record UserSearchCriteria(
        long tenantId,
        String keywordPattern,
        String sortExpression,
        String sortDirectionSql,
        int limit,
        int offset
) {}
```

However, avoid exposing raw SQL strings in public record constructors unless they are produced by enum conversion.

### 41.4 Java 21 and 25

Virtual threads do not change parameter safety.

Even if concurrency model changes, the rules stay the same:

```text
values -> #{}
trusted SQL grammar -> carefully governed ${}
conversion -> TypeHandler
business invariants -> criteria/command object
```

Modern Java can improve expressiveness with:

- records;
- sealed interfaces;
- pattern matching;
- better immutable modeling;
- stricter command/value types.

But no language feature removes the need for SQL boundary discipline.

---

## 42. Testing Strategy for Parameter Binding

For every mapper with dynamic parameters, test:

### 42.1 Normal cases

- all filters empty;
- each filter individually;
- combined filters;
- sort variations;
- pagination;
- date range;
- keyword search.

### 42.2 Edge cases

- null values;
- empty string;
- whitespace string;
- empty list;
- large list;
- invalid enum code;
- invalid sort field;
- invalid direction;
- limit too high;
- negative offset.

### 42.3 Security cases

Input values:

```text
' OR '1'='1
x%' OR 1=1 --
created_at desc; delete from users; --
../../etc/passwd
<script>alert(1)</script>
```

Expected:

- value inputs produce no SQL injection;
- invalid sort/direction rejected before mapper;
- wildcard escaping behaves as required;
- no raw request string reaches `${}`.

### 42.4 TypeHandler cases

For each custom TypeHandler:

- Java value to DB value;
- DB value to Java value;
- Java null write;
- SQL NULL read;
- invalid DB value;
- unknown enum code;
- vendor-specific column type.

---

## 43. Review Heuristics for Top 1% Engineers

When reviewing MyBatis parameter code, do not ask only:

```text
Does it work?
```

Ask:

```text
Can an attacker turn a value into SQL grammar?
Can an invalid request bypass validation?
Can null mean the wrong thing?
Can a field typo survive compilation?
Can this query produce invalid SQL for empty collections?
Can a future enum rename corrupt data mapping?
Can a large IN list degrade the database?
Can logs leak sensitive values?
Can this SQL shape explode plan cache?
Can the next engineer understand why ${} is safe here?
```

If the answer is unclear, the design is not done.

---

## 44. Summary Mental Model

Keep this model permanently:

```text
#{} is for values.
${} is for SQL grammar.

Values can be untrusted if bound safely.
SQL grammar must never be untrusted.

Mapper parameters should be contracts, not bags.
TypeHandlers should convert stable representations, not hide business logic.
Null semantics must be explicit.
Dynamic SQL must be tested as generated SQL, not only as Java code.
```

Or shorter:

```text
The mapper boundary must convert messy external intent
into safe, explicit, typed, testable SQL execution.
```

---

## 45. What You Should Be Able To Do After This Part

After mastering this part, you should be able to:

- explain exactly why `#{}` is safe and `${}` is risky;
- design safe dynamic sorting;
- whitelist dynamic identifiers;
- prevent SQL injection in MyBatis XML;
- model mapper parameters as criteria/command objects;
- avoid `Map<String,Object>` as application API;
- handle null semantics intentionally;
- design safe partial updates;
- use `foreach` safely;
- handle empty and large collection parameters;
- create custom TypeHandlers;
- map enum codes safely;
- map value objects to database columns;
- reason about parameter binding and query plan stability;
- design secure search screens;
- review mapper code for production safety.

---

## 46. References

- MyBatis 3 — Mapper XML Files: https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis 3 — Dynamic SQL: https://mybatis.org/mybatis-3/dynamic-sql.html
- MyBatis 3 — Configuration: https://mybatis.org/mybatis-3/configuration.html
- MyBatis 3 — Java API: https://mybatis.org/mybatis-3/java-api.html
- MyBatis 3 API — `BaseTypeHandler`: https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/type/BaseTypeHandler.html
- MyBatis-Spring: https://mybatis.org/spring/
- MyBatis Spring Boot Starter: https://mybatis.org/spring-boot-starter/

---

## 47. Series Progress

Completed:

```text
00-mybatis-orientation-sql-first-persistence-mental-model.md
01-mybatis-core-runtime-architecture-sqlsession-executor-configuration.md
02-java-8-to-25-mybatis-version-strategy-and-compatibility.md
03-mapper-design-interface-xml-annotation-and-naming-discipline.md
04-sql-statement-mapping-select-insert-update-delete-deep-dive.md
05-parameter-binding-placeholder-typehandler-and-sql-injection-boundary.md
```

Next:

```text
06-result-mapping-auto-explicit-mapping-column-discipline.md
```

The series is not finished yet.
