# learn-go-sql-database-integration-part-022.md

# Query Composition Without Losing Control

> Seri: `learn-go-sql-database-integration`  
> Part: `022`  
> Topik: `Safe Dynamic SQL, Query Composition, Placeholder Management, Allowlist Identifiers, Dynamic Filters, IN Clauses, Sorting, Pagination, and SQL Injection Boundaries`  
> Target pembaca: Java software engineer yang ingin memahami Go database integration sampai level production architecture  
> Target Go: Go 1.26.x  
> Status seri: **belum selesai**

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas **repository boundary dan data access architecture**:

- repository vs DAO vs query service;
- `DBTX` interface;
- service sebagai pemilik transaction boundary;
- error mapping;
- domain vs persistence model;
- query placement;
- observability;
- anti-pattern repository.

Part ini membahas masalah yang muncul hampir di semua aplikasi nyata:

> Bagaimana membuat SQL yang dinamis tanpa kehilangan kontrol?

Query static mudah:

```sql
SELECT id, name
FROM users
WHERE id = $1;
```

Tapi aplikasi production butuh:

- filter opsional;
- search keyword;
- sort field dinamis;
- sort direction;
- pagination;
- `IN` clause;
- date range;
- status list;
- role-based visibility;
- tenant filter;
- conditional joins;
- reporting query;
- bulk update by list IDs;
- reusable query fragments.

Di titik ini banyak codebase berubah menjadi berbahaya:

```go
query := "SELECT * FROM cases WHERE " + userInput
```

atau terlalu abstrak:

```go
repository.FindByWhateverMagic(filter)
```

Part ini mengajarkan cara menulis dynamic SQL yang:

- aman dari SQL injection;
- eksplisit;
- testable;
- observable;
- tidak berubah menjadi ORM setengah matang;
- tetap mudah direview;
- tetap menjaga query plan/performance.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. membedakan SQL value, identifier, operator, keyword, dan fragment;
2. memahami batas parameter binding;
3. menyusun dynamic `WHERE` dengan placeholder yang benar;
4. membuat placeholder generator untuk PostgreSQL-style `$1`, `$2`, ...;
5. membuat query builder kecil tanpa kehilangan kontrol;
6. membuat allowlist untuk `ORDER BY`, column name, sort direction, dan table alias;
7. membuat safe `IN` clause dan menangani empty list;
8. membuat dynamic filter untuk search/listing API;
9. membuat dynamic update `SET` clause dengan allowlist;
10. mencegah SQL injection pada `LIKE`, `ORDER BY`, `LIMIT`, `OFFSET`, dan identifiers;
11. memahami kapan manual composition cukup dan kapan query builder/generator berguna;
12. menghindari anti-pattern dynamic SQL yang sulit direview;
13. mengetes generated SQL dan args;
14. menghubungkan query composition dengan repository boundary dan observability.

---

## 2. Fakta Dasar Dari Dokumentasi dan Security Guidance

Beberapa fakta penting:

1. Dokumentasi Go menyarankan menghindari SQL injection dengan memberikan nilai parameter sebagai argumen fungsi package `database/sql`, bukan dengan memformat nilai ke string SQL.
2. Dokumentasi Go mencatat bahwa placeholder parameter dapat berbeda antar DBMS/driver.
3. `database/sql` menyediakan method seperti `QueryContext` dan `ExecContext` yang menerima query string dan variadic args untuk placeholder parameters.
4. OWASP SQL Injection Prevention Cheat Sheet merekomendasikan prepared statements/parameterized queries sebagai defense utama, dan allow-list input validation untuk bagian SQL yang tidak bisa di-bind sebagai parameter, seperti table/column names atau sort order.
5. Bind parameter cocok untuk **values**, bukan sembarang SQL syntax fragment.

Referensi:

- Go — Avoiding SQL injection risk: <https://go.dev/doc/database/sql-injection>
- Go — Querying for data: <https://go.dev/doc/database/querying>
- Go — `database/sql`: <https://pkg.go.dev/database/sql>
- Go — Prepared statements: <https://go.dev/doc/database/prepared-statements>
- OWASP — SQL Injection Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html>
- OWASP — Injection Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html>

---

## 3. Mental Model Utama

### 3.1 SQL Terdiri Dari Beberapa Jenis Bagian

Dalam query:

```sql
SELECT id, name
FROM users
WHERE status = $1
ORDER BY created_at DESC
LIMIT $2
```

Ada beberapa kategori:

| Bagian | Contoh | Bisa pakai bind parameter? |
|---|---|---|
| value | `status = $1` | ya |
| value limit | `LIMIT $2` | biasanya ya, tergantung DB |
| identifier/table | `users` | tidak sebagai value parameter |
| identifier/column | `created_at` | tidak sebagai value parameter |
| keyword | `DESC` | tidak sebagai value parameter |
| operator | `=` / `ILIKE` / `>` | tidak sebagai value parameter |
| SQL fragment | `ORDER BY created_at DESC` | tidak langsung |
| predicate shape | `status = ?` | shape harus dibangun oleh app |
| placeholder | `$1` / `?` / `@p1` | tergantung driver/DB |

Parameter binding melindungi values.

Ia tidak membuat semua string composition aman.

### 3.2 Dynamic SQL Aman = Static Skeleton + Controlled Fragments + Bound Values

Pattern aman:

```text
base SQL static
+ optional predicates from code-owned fragments
+ values bound as args
+ identifiers chosen from allowlist
+ operators chosen from allowlist
+ sort direction chosen from allowlist
+ limit/offset validated/clamped
```

Bukan:

```text
raw user input appended into SQL
```

### 3.3 Query Builder Bukan Alasan Untuk Tidak Paham SQL

Query builder bisa membantu:

- placeholder numbering;
- optional filters;
- repeated fragments;
- dynamic `IN`;
- readability.

Tetapi query builder tidak boleh menghilangkan:

- SQL review;
- index awareness;
- explicit joins;
- query plan reasoning;
- error mapping;
- security review.

---

## 4. Diagram: Safe Query Composition Pipeline

```mermaid
flowchart TD
    A[API Request Filter] --> B[Validate Domain Input]
    B --> C[Normalize Filter]
    C --> D[Choose SQL Fragments From Allowlist]
    D --> E[Bind Values As Args]
    E --> F[Build Query String]
    F --> G[Execute QueryContext / ExecContext]
    G --> H[Scan Rows]
    H --> I[Map Result]

    D -. no raw identifier from user .-> D
    E -. no fmt.Sprintf value into SQL .-> E
```

---

## 5. Unsafe Dynamic SQL Example

Bad:

```go
func SearchUsers(ctx context.Context, db *sql.DB, status string, sort string) ([]User, error) {
	query := fmt.Sprintf(`
		SELECT id, email, status
		FROM users
		WHERE status = '%s'
		ORDER BY %s
	`, status, sort)

	rows, err := db.QueryContext(ctx, query)
	// ...
}
```

Problems:

- `status` can inject string literal escape;
- `sort` can inject arbitrary SQL fragment;
- logs/query plan unpredictable;
- no allowlist;
- hard to audit.

Example malicious `sort`:

```text
created_at DESC; DROP TABLE users; --
```

Even if driver/database disallows multiple statements, relying on that is not security design.

---

## 6. Safe Basic Version

```go
func SearchUsers(ctx context.Context, db *sql.DB, status string, sortField string, sortDir string) ([]User, error) {
	sortColumn, err := allowUserSortColumn(sortField)
	if err != nil {
		return nil, err
	}

	direction, err := allowSortDirection(sortDir)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT id, email, status
		FROM users
		WHERE status = $1
		ORDER BY ` + sortColumn + ` ` + direction

	rows, err := db.QueryContext(ctx, query, status)
	// ...
	_ = rows
	return nil, err
}
```

Important:

- `status` is bound;
- `sortColumn` is selected from allowlist;
- `direction` is selected from allowlist;
- no raw user string becomes SQL syntax.

---

## 7. Values vs Identifiers

### 7.1 Values

These are data:

```text
user_id = 123
status = APPROVED
created_at >= 2026-01-01
keyword = abc
limit = 50
```

Use parameters:

```sql
WHERE status = $1
```

### 7.2 Identifiers

These are SQL names:

```text
table name
column name
schema name
alias
index hint
```

Do not bind them as values:

```sql
ORDER BY $1
```

This usually sorts by literal value, errors, or does not do what you want.

Use allowlist:

```go
allowed := map[string]string{
	"createdAt": "c.created_at",
	"status":    "c.status",
}
```

### 7.3 Keywords and Operators

Examples:

```text
ASC
DESC
LIKE
ILIKE
=
>
<
IS NULL
```

Choose from allowlist or fixed code path.

---

## 8. Placeholder Styles

Different DB/driver styles:

| DB/Driver Style | Placeholder |
|---|---|
| PostgreSQL | `$1`, `$2`, ... |
| MySQL | `?` |
| SQLite | `?`, `?NNN`, named forms depending driver |
| SQL Server | `@p1`, `@p2` or named depending driver |
| Oracle | `:1`, `:name` depending driver |

Do not hardcode PostgreSQL `$1` if you need DB portability.

If targeting PostgreSQL only, `$n` builder is fine.

---

## 9. Placeholder Generator

For PostgreSQL-style placeholders:

```go
type Placeholder struct {
	n int
}

func (p *Placeholder) Next() string {
	p.n++
	return fmt.Sprintf("$%d", p.n)
}
```

Usage:

```go
var ph Placeholder
args := make([]any, 0)

where := make([]string, 0)

where = append(where, "status = "+ph.Next())
args = append(args, status)

where = append(where, "created_at >= "+ph.Next())
args = append(args, from)
```

This prevents off-by-one placeholder bugs.

---

## 10. Dialect-Aware Placeholder

```go
type PlaceholderStyle int

const (
	Question PlaceholderStyle = iota
	Dollar
	AtP
)

type Placeholder struct {
	style PlaceholderStyle
	n     int
}

func NewPlaceholder(style PlaceholderStyle) *Placeholder {
	return &Placeholder{style: style}
}

func (p *Placeholder) Next() string {
	p.n++

	switch p.style {
	case Question:
		return "?"
	case Dollar:
		return fmt.Sprintf("$%d", p.n)
	case AtP:
		return fmt.Sprintf("@p%d", p.n)
	default:
		return "?"
	}
}
```

Use only if supporting multiple DBs.

For one DB, keep simpler.

---

## 11. Minimal Query Builder

A small builder can be enough.

```go
type SQLBuilder struct {
	sb   strings.Builder
	args []any
	ph   *Placeholder
}

func NewSQLBuilder(style PlaceholderStyle) *SQLBuilder {
	return &SQLBuilder{ph: NewPlaceholder(style)}
}

func (b *SQLBuilder) Write(s string) {
	b.sb.WriteString(s)
}

func (b *SQLBuilder) Arg(v any) string {
	b.args = append(b.args, v)
	return b.ph.Next()
}

func (b *SQLBuilder) SQL() string {
	return b.sb.String()
}

func (b *SQLBuilder) Args() []any {
	return b.args
}
```

Usage:

```go
b := NewSQLBuilder(Dollar)
b.Write(`
	SELECT id, email, status
	FROM users
	WHERE 1=1
`)

if filter.Status != nil {
	b.Write(" AND status = ")
	b.Write(b.Arg(*filter.Status))
}

query := b.SQL()
args := b.Args()
```

This builder is intentionally tiny. It does not hide SQL.

---

## 12. `WHERE 1=1`: Acceptable or Not?

Pattern:

```sql
WHERE 1=1
```

Then append:

```sql
AND status = $1
AND created_at >= $2
```

Pros:

- simple dynamic append;
- no need track first condition.

Cons:

- some teams dislike style;
- may look sloppy;
- unnecessary predicate.

Alternative:

```go
clauses := []string{}
args := []any{}

if filter.Status != nil {
	clauses = append(clauses, "status = "+ph.Next())
	args = append(args, *filter.Status)
}

query := base
if len(clauses) > 0 {
	query += " WHERE " + strings.Join(clauses, " AND ")
}
```

Both are fine. Choose team convention.

---

## 13. Dynamic WHERE Builder

```go
type WhereBuilder struct {
	clauses []string
	args    []any
	ph      *Placeholder
}

func NewWhereBuilder(style PlaceholderStyle) *WhereBuilder {
	return &WhereBuilder{ph: NewPlaceholder(style)}
}

func (w *WhereBuilder) AddValue(expr string, value any) {
	// expr should contain exactly one "%s" placeholder for DB placeholder.
	w.clauses = append(w.clauses, fmt.Sprintf(expr, w.ph.Next()))
	w.args = append(w.args, value)
}

func (w *WhereBuilder) SQL() string {
	if len(w.clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(w.clauses, " AND ")
}

func (w *WhereBuilder) Args() []any {
	return w.args
}
```

Usage:

```go
w := NewWhereBuilder(Dollar)

if filter.Status != nil {
	w.AddValue("c.status = %s", *filter.Status)
}
if filter.From != nil {
	w.AddValue("c.created_at >= %s", *filter.From)
}
if filter.To != nil {
	w.AddValue("c.created_at < %s", *filter.To)
}

query := `
	SELECT c.id, c.reference_no, c.status, c.created_at
	FROM cases c
` + w.SQL() + `
	ORDER BY c.created_at DESC
	LIMIT 100
`

rows, err := db.QueryContext(ctx, query, w.Args()...)
```

Important:

- `expr` must be code-owned, not user input;
- values are args.

---

## 14. Dynamic Filter Struct

```go
type CaseSearchFilter struct {
	TenantID TenantID
	Status   *Status
	OfficerID *int64
	CreatedFrom *time.Time
	CreatedTo   *time.Time
	Keyword string
}
```

Repository/query service:

```go
func (q CaseQuery) Search(ctx context.Context, db *sql.DB, filter CaseSearchFilter, page PageRequest) ([]CaseListItem, error) {
	// validate/normalize filter before composing SQL
	return nil, nil
}
```

Tenant filter should usually be required, not optional:

```sql
WHERE c.tenant_id = $1
```

---

## 15. Required Predicates

Some predicates should always exist:

- tenant ID;
- visibility/authorization;
- soft delete;
- partition key;
- status scope for workers;
- date range for reports.

Example:

```go
w := NewWhereBuilder(Dollar)
w.AddValue("c.tenant_id = %s", filter.TenantID)
w.AddRaw("c.deleted_at IS NULL") // code-owned raw fragment
```

Add raw only for static/code-owned fragment.

---

## 16. Raw Fragment Method

```go
func (w *WhereBuilder) AddRaw(fragment string) {
	w.clauses = append(w.clauses, fragment)
}
```

Rule:

> `AddRaw` may only receive static code-owned strings or allowlisted fragments.

Never:

```go
w.AddRaw(userInput)
```

Consider naming:

```go
AddTrustedSQLFragment
```

to make danger obvious.

---

## 17. Keyword Search

Bad:

```go
query += " AND name LIKE '%" + keyword + "%'"
```

Good:

```go
pattern := "%" + escapeLike(keyword) + "%"

w.AddValue(`LOWER(c.name) LIKE LOWER(%s) ESCAPE '\'`, pattern)
```

Need DB-specific syntax for case-insensitive search.

PostgreSQL has `ILIKE`.

```go
w.AddValue(`c.name ILIKE %s ESCAPE '\'`, pattern)
```

But `ILIKE` is PostgreSQL-specific.

---

## 18. Escaping LIKE

If user searches for `%`, `_`, or backslash, SQL LIKE treats them specially.

Helper:

```go
func EscapeLike(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	for _, r := range s {
		switch r {
		case '%', '_', '\\':
			b.WriteRune('\\')
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}

	return b.String()
}
```

Usage:

```go
pattern := "%" + EscapeLike(keyword) + "%"
w.AddValue(`c.reference_no LIKE %s ESCAPE '\'`, pattern)
```

DB-specific escaping rules can vary; test with target DB.

---

## 19. Empty Keyword

Normalize before query:

```go
keyword := strings.TrimSpace(filter.Keyword)
if keyword != "" {
	pattern := "%" + EscapeLike(keyword) + "%"
	w.AddValue(`c.reference_no LIKE %s ESCAPE '\'`, pattern)
}
```

Also consider:

- minimum keyword length;
- max length;
- full-text search for large data;
- index implications;
- avoiding leading wildcard for performance if possible.

---

## 20. Dynamic ORDER BY

Never do:

```go
query += " ORDER BY " + r.URL.Query().Get("sort")
```

Use allowlist:

```go
var caseSortColumns = map[string]string{
	"createdAt":   "c.created_at",
	"updatedAt":   "c.updated_at",
	"referenceNo": "c.reference_no",
	"status":      "c.status",
}

func CaseSortColumn(input string) (string, error) {
	if input == "" {
		return "c.updated_at", nil
	}
	col, ok := caseSortColumns[input]
	if !ok {
		return "", ErrInvalidSortField
	}
	return col, nil
}
```

---

## 21. Sort Direction Allowlist

```go
func SortDirection(input string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(input)) {
	case "", "desc":
		return "DESC", nil
	case "asc":
		return "ASC", nil
	default:
		return "", ErrInvalidSortDirection
	}
}
```

Use:

```go
sortCol, err := CaseSortColumn(page.SortField)
if err != nil {
	return nil, err
}

sortDir, err := SortDirection(page.SortDirection)
if err != nil {
	return nil, err
}

orderBy := " ORDER BY " + sortCol + " " + sortDir + ", c.id DESC"
```

Tie-breaker `c.id DESC` makes order deterministic.

---

## 22. Deterministic Ordering

Pagination requires stable order.

Bad:

```sql
ORDER BY created_at DESC
```

If many rows have same `created_at`, order can change between requests.

Better:

```sql
ORDER BY created_at DESC, id DESC
```

For ascending:

```sql
ORDER BY created_at ASC, id ASC
```

Tie-breaker matters for keyset pagination.

---

## 23. LIMIT and OFFSET

Validate and clamp.

```go
type PageRequest struct {
	Limit int
	Offset int
	SortField string
	SortDirection string
}

func NormalizePage(p PageRequest) PageRequest {
	if p.Limit <= 0 {
		p.Limit = 50
	}
	if p.Limit > 200 {
		p.Limit = 200
	}
	if p.Offset < 0 {
		p.Offset = 0
	}
	return p
}
```

Bind values:

```go
query += " LIMIT " + ph.Next() + " OFFSET " + ph.Next()
args = append(args, page.Limit, page.Offset)
```

Some DBs do not allow placeholders in all limit/offset positions; test target DB. If forced to inline, only inline validated integers from server-side normalization.

---

## 24. Keyset Pagination Preview

Offset pagination can get slow for large offsets and unstable under concurrent writes.

Keyset pagination uses cursor predicates:

```sql
WHERE (updated_at, id) < ($cursor_updated_at, $cursor_id)
ORDER BY updated_at DESC, id DESC
LIMIT $limit
```

Dynamic composition must coordinate:

- sort column;
- cursor fields;
- direction;
- tie-breaker;
- comparison operator.

Part 023 goes deeper.

---

## 25. IN Clause Problem

SQL placeholders bind one value, not a list, unless DB/driver supports array binding.

Bad:

```go
query := "WHERE id IN ($1)"
args := []any{[]int64{1,2,3}}
```

May not work except DB-specific array support.

Need:

```sql
WHERE id IN ($1, $2, $3)
```

or DB-specific:

```sql
WHERE id = ANY($1)
```

for PostgreSQL with array binding support depending driver.

---

## 26. Safe IN Expansion

```go
func AddIn[T any](w *WhereBuilder, column string, values []T) error {
	if len(values) == 0 {
		w.AddRaw("1 = 0")
		return nil
	}

	placeholders := make([]string, 0, len(values))
	for _, v := range values {
		placeholders = append(placeholders, w.ph.Next())
		w.args = append(w.args, v)
	}

	w.AddRaw(column + " IN (" + strings.Join(placeholders, ", ") + ")")
	return nil
}
```

But `column` must be code-owned/allowlisted, not user input.

Usage:

```go
_ = AddIn(w, "c.status", []Status{StatusSubmitted, StatusUnderReview})
```

---

## 27. Empty IN Semantics

If `statuses=[]`, what does it mean?

Options:

1. no filter;
2. match nothing;
3. invalid request.

Do not let it accidentally generate invalid SQL:

```sql
WHERE status IN ()
```

For “match nothing”:

```sql
1 = 0
```

For “no filter”, skip clause.

Decide per API.

---

## 28. Large IN Lists

Large `IN` lists can hurt:

- query parsing;
- plan quality;
- network payload;
- max parameter count;
- memory;
- index usage.

Alternatives:

- temporary table;
- join against staged IDs;
- DB-specific array/table-valued parameter;
- bulk load;
- partitioned batches.

For small lists, expansion is fine.

---

## 29. Dynamic OR Conditions

Example:

```text
keyword matches reference_no OR applicant_name
```

Build grouped condition:

```go
if keyword != "" {
	p := "%" + EscapeLike(keyword) + "%"
	p1 := w.ph.Next()
	p2 := w.ph.Next()
	w.args = append(w.args, p, p)

	w.AddRaw("(c.reference_no LIKE " + p1 + ` ESCAPE '\' OR c.applicant_name LIKE ` + p2 + ` ESCAPE '\')`)
}
```

Be careful with parentheses.

---

## 30. Dynamic Range Filter

```go
if filter.CreatedFrom != nil {
	w.AddValue("c.created_at >= %s", *filter.CreatedFrom)
}

if filter.CreatedTo != nil {
	w.AddValue("c.created_at < %s", *filter.CreatedTo)
}
```

Use half-open intervals:

```text
[from, to)
```

This avoids end-of-day/time precision bugs.

---

## 31. Date Range Normalization

API may receive date-only:

```text
2026-06-24
```

Normalize in service layer:

```text
from = 2026-06-24T00:00:00+TZ
to   = 2026-06-25T00:00:00+TZ
```

Convert to UTC or DB convention.

Repository should receive normalized `time.Time`.

---

## 32. Dynamic IS NULL / IS NOT NULL

Do not bind null-check operator.

Use controlled branches:

```go
switch filter.Closed {
case nil:
	// no filter
case ptr(true):
	w.AddRaw("c.closed_at IS NOT NULL")
case ptr(false):
	w.AddRaw("c.closed_at IS NULL")
}
```

`IS NULL` is SQL syntax, not a value.

---

## 33. Dynamic Boolean Filter

If column is boolean:

```go
if filter.Active != nil {
	w.AddValue("u.active = %s", *filter.Active)
}
```

This is value binding.

---

## 34. Dynamic Enum Filter

Validate enum before query.

```go
func ParseStatus(s string) (Status, error) {
	switch s {
	case "DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED":
		return Status(s), nil
	default:
		return "", ErrInvalidStatus
	}
}
```

Then bind:

```go
w.AddValue("c.status = %s", status)
```

Do not allow arbitrary status strings if domain enum is closed.

---

## 35. Dynamic JOIN

Sometimes join is optional.

Example:

```go
joins := []string{}

if filter.OfficerName != "" {
	joins = append(joins, "JOIN officers o ON o.id = c.officer_id")
	w.AddValue("o.name ILIKE %s", "%"+EscapeLike(filter.OfficerName)+"%")
}

query := `
	SELECT c.id, c.reference_no, c.status
	FROM cases c
` + strings.Join(joins, "\n") + w.SQL()
```

Join fragments must be code-owned.

Be careful:

- optional joins can change row cardinality;
- use `EXISTS` if you only need filtering;
- indexes matter.

---

## 36. EXISTS Instead of JOIN For Filters

Sometimes:

```sql
WHERE EXISTS (
    SELECT 1
    FROM case_tags t
    WHERE t.case_id = c.id
      AND t.tag = $1
)
```

is cleaner than join when you do not need tag columns.

Builder:

```go
if filter.Tag != "" {
	w.AddValue(`
		EXISTS (
			SELECT 1
			FROM case_tags t
			WHERE t.case_id = c.id
			  AND t.tag = %s
		)
	`, filter.Tag)
}
```

Ensure formatting helper handles multi-line expressions.

---

## 37. Dynamic UPDATE SET

Updating optional fields is common.

Bad:

```go
setClause := r.FormValue("field") + " = '" + r.FormValue("value") + "'"
```

Good:

```go
type UpdateUserPatch struct {
	Name *string
	Nickname *string
	Active *bool
}

func (r UserRepo) Patch(ctx context.Context, q DBTX, id int64, patch UpdateUserPatch) error {
	var ph Placeholder
	set := []string{}
	args := []any{}

	if patch.Name != nil {
		set = append(set, "name = "+ph.Next())
		args = append(args, *patch.Name)
	}
	if patch.Nickname != nil {
		set = append(set, "nickname = "+ph.Next())
		args = append(args, *patch.Nickname)
	}
	if patch.Active != nil {
		set = append(set, "active = "+ph.Next())
		args = append(args, *patch.Active)
	}

	if len(set) == 0 {
		return ErrEmptyPatch
	}

	args = append(args, id)
	idPH := ph.Next()

	query := `
		UPDATE users
		SET ` + strings.Join(set, ", ") + `,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ` + idPH

	_, err := q.ExecContext(ctx, query, args...)
	return err
}
```

Note: This sample has a subtle ordering issue if `idPH` is generated after appending id. Better generate placeholder and append together. See next section.

---

## 38. Safer Dynamic UPDATE Builder

```go
type UpdateBuilder struct {
	table string
	set   []string
	where []string
	args  []any
	ph    *Placeholder
}

func NewUpdateBuilder(table string, style PlaceholderStyle) *UpdateBuilder {
	return &UpdateBuilder{
		table: table,
		ph:    NewPlaceholder(style),
	}
}

func (b *UpdateBuilder) Set(column string, value any) {
	p := b.ph.Next()
	b.set = append(b.set, column+" = "+p)
	b.args = append(b.args, value)
}

func (b *UpdateBuilder) WhereValue(expr string, value any) {
	p := b.ph.Next()
	b.where = append(b.where, fmt.Sprintf(expr, p))
	b.args = append(b.args, value)
}

func (b *UpdateBuilder) SQL() (string, []any, error) {
	if len(b.set) == 0 {
		return "", nil, ErrEmptyPatch
	}
	if len(b.where) == 0 {
		return "", nil, ErrUnsafeUpdateWithoutWhere
	}

	query := "UPDATE " + b.table + " SET " + strings.Join(b.set, ", ") +
		" WHERE " + strings.Join(b.where, " AND ")

	return query, b.args, nil
}
```

Again, `table`, `column`, and `expr` must be code-owned/allowlisted.

---

## 39. Patch With Version

For optimistic concurrency:

```go
b := NewUpdateBuilder("users", Dollar)

if patch.Name != nil {
	b.Set("name", *patch.Name)
}
if patch.Nickname != nil {
	b.Set("nickname", *patch.Nickname)
}

b.Set("updated_at", now)
b.Set("version", gormExpr?) // Our simple builder only handles values, not expressions.
```

Expression support must be explicit.

Better manual:

```go
set = append(set, "version = version + 1")
```

Need safe method:

```go
func (b *UpdateBuilder) SetRaw(fragment string) {
	b.set = append(b.set, fragment)
}
```

Only static code-owned fragments.

Then:

```go
b.SetRaw("version = version + 1")
b.WhereValue("id = %s", id)
b.WhereValue("version = %s", expectedVersion)
```

---

## 40. Prevent UPDATE Without WHERE

Dynamic update builder should reject no WHERE unless explicitly allowed.

```go
var ErrUnsafeUpdateWithoutWhere = errors.New("unsafe update without where")
```

If truly doing bulk update:

```go
AllowFullTableUpdate()
```

Make danger explicit.

---

## 41. Dynamic DELETE

Same rule:

- require WHERE by default;
- use args;
- check rows affected;
- avoid dynamic table name unless allowlisted;
- do not concatenate raw user predicate.

```go
result, err := q.ExecContext(ctx, `
	DELETE FROM sessions
	WHERE user_id = $1
	  AND expires_at < $2
`, userID, cutoff)
```

For dynamic delete filters, build like dynamic WHERE.

---

## 42. Dynamic Table Name

Usually avoid dynamic table names.

If necessary, allowlist.

```go
var auditTables = map[string]string{
	"case": "case_audit_events",
	"user": "user_audit_events",
}

func AuditTable(kind string) (string, error) {
	table, ok := auditTables[kind]
	if !ok {
		return "", ErrInvalidAuditKind
	}
	return table, nil
}
```

Then:

```go
table, err := AuditTable(kind)
query := "SELECT ... FROM " + table + " WHERE ..."
```

Never use raw table name from user.

---

## 43. Dynamic Schema Name

Multi-tenant schema-per-tenant design may need dynamic schema.

This is risky.

Prefer:

- one schema with tenant_id;
- DB role/search_path carefully controlled;
- connection pool per tenant only if necessary;
- strict allowlist/quoting if schema dynamic.

If dynamic schema unavoidable:

- tenant schema mapping must come from trusted metadata;
- quote identifiers using DB-specific safe function if available;
- never from raw request;
- avoid session state leak in pool.

---

## 44. Identifier Quoting

Some drivers/libraries provide identifier quoting.

But quoting is not same as allowlisting.

If user can choose any quoted identifier:

```sql
ORDER BY "some_weird_column"
```

it may still expose unintended data or break query.

Use:

```text
allowlist first
quote if needed second
```

Do not quote raw user input as primary defense.

---

## 45. Operators Allowlist

Suppose API supports filters:

```text
amount[gte]=100
amount[lte]=500
```

Map operators:

```go
var amountOps = map[string]string{
	"eq":  "=",
	"gt":  ">",
	"gte": ">=",
	"lt":  "<",
	"lte": "<=",
}
```

Use:

```go
op, ok := amountOps[inputOp]
if !ok {
	return ErrInvalidOperator
}

w.AddValue("amount "+op+" %s", value)
```

Operator from allowlist, value bound.

---

## 46. Field Allowlist For Generic Filters

If building generic filter system:

```go
type FieldSpec struct {
	Column string
	AllowedOps map[string]string
	Parse func(string) (any, error)
}
```

Example:

```go
var caseFilterFields = map[string]FieldSpec{
	"status": {
		Column: "c.status",
		AllowedOps: map[string]string{"eq": "="},
		Parse: parseStatusAny,
	},
	"createdAt": {
		Column: "c.created_at",
		AllowedOps: map[string]string{
			"gte": ">=",
			"lt": "<",
		},
		Parse: parseTimeAny,
	},
}
```

This is safe only if specs are code-owned.

---

## 47. Generic Filter Risk

Generic filter engines can become dangerous:

```text
?filter=anything:any_operator:any_value
```

Risks:

- exposing internal columns;
- expensive predicates;
- injection if fragments not allowlisted;
- unindexed filters;
- authorization bypass;
- inconsistent semantics.

If building one, make it schema-driven and allowlisted.

---

## 48. Dynamic SELECT Columns

Usually avoid dynamic select columns from user.

If API supports sparse fieldsets:

```text
fields=id,status,createdAt
```

Use allowlist:

```go
var allowedFields = map[string]string{
	"id":        "c.id",
	"status":    "c.status",
	"createdAt": "c.created_at",
}
```

But scanning dynamic columns is more complex.

Often better:

- return fixed projection;
- build separate endpoint/projection;
- use JSON serialization to omit fields after fetching safe projection.

---

## 49. Dynamic GROUP BY / Aggregates

For reporting APIs:

- group fields must be allowlisted;
- aggregate functions must be allowlisted;
- time buckets must be allowlisted;
- limit date range;
- protect expensive queries;
- use separate report pool/path.

Example:

```go
var groupBy = map[string]string{
	"status": "c.status",
	"month":  "date_trunc('month', c.created_at)", // PostgreSQL-specific
}
```

Fragments are code-owned.

---

## 50. Dynamic HAVING

Same rules:

- aggregate expression code-owned;
- operator allowlisted;
- value bound.

```go
having := " HAVING COUNT(*) >= " + ph.Next()
args = append(args, minCount)
```

---

## 51. Dynamic ORDER BY With NULLS FIRST/LAST

If supported:

```text
NULLS LAST
NULLS FIRST
```

Allowlist:

```go
func NullOrdering(input string) (string, error) {
	switch input {
	case "", "last":
		return "NULLS LAST", nil
	case "first":
		return "NULLS FIRST", nil
	default:
		return "", ErrInvalidNullOrdering
	}
}
```

DB-specific. MySQL syntax differs.

---

## 52. Building SQL With `strings.Builder`

For performance/readability:

```go
var sb strings.Builder

sb.WriteString(`
	SELECT c.id, c.reference_no
	FROM cases c
`)

if len(where) > 0 {
	sb.WriteString(" WHERE ")
	sb.WriteString(strings.Join(where, " AND "))
}

query := sb.String()
```

`strings.Builder` does not make unsafe input safe. Safety comes from your composition discipline.

---

## 53. Args Slice Discipline

Always append arg immediately when placeholder is created.

Good:

```go
p := ph.Next()
where = append(where, "status = "+p)
args = append(args, status)
```

Avoid:

```go
where = append(where, "status = "+ph.Next())
// many lines later
args = append(args, status)
```

This reduces placeholder/arg mismatch.

---

## 54. Testing Generated SQL

Test SQL and args for dynamic builder.

```go
func TestBuildCaseSearchStatus(t *testing.T) {
	filter := CaseSearchFilter{Status: ptr(StatusApproved)}

	sql, args, err := BuildCaseSearchSQL(filter, PageRequest{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, sql, "c.status = $2") // maybe tenant is $1
	if len(args) != 2 {
		t.Fatalf("args=%d", len(args))
	}
}
```

Normalize whitespace for comparison.

---

## 55. SQL Snapshot Tests

For complex SQL builder, snapshot expected SQL.

Normalize:

```go
func normalizeSQL(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
```

Then compare.

Be careful: snapshot tests can be brittle but useful for query generation.

---

## 56. Integration Test Dynamic Query

Unit test builder is not enough.

Integration test:

- insert data;
- run filters;
- assert returned rows;
- test sort order;
- test empty filter;
- test empty IN;
- test keyword escaping;
- test pagination.

This catches syntax/placeholder/scan issues.

---

## 57. Security Tests

Test malicious inputs:

- sort field: `id; DROP TABLE cases`;
- sort dir: `desc; DELETE`;
- keyword: `%`;
- keyword: `_`;
- keyword with quote;
- field name unknown;
- operator unknown;
- table kind unknown;
- large limit;
- negative offset;
- huge IN list.

Expected:

- invalid sort/operator rejected;
- keyword treated as data;
- limit clamped;
- no SQL syntax break.

---

## 58. Query Fingerprint

Dynamic SQL can generate many variants.

For observability, use operation name:

```text
case.search
```

not raw SQL as metric label.

You may log normalized query fingerprint internally:

```text
SELECT ... WHERE tenant_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?
```

But avoid high-cardinality raw SQL.

---

## 59. Dynamic SQL and Plan Cache

Many unique SQL strings can reduce plan cache efficiency.

Example:

```text
ORDER BY many dynamic expressions
IN list length varies
optional filters create many shapes
```

This may be okay, but observe.

Mitigations:

- limit allowed filters/sorts;
- use stable query shapes where possible;
- DB-specific array binding;
- prepared statements for common paths;
- separate endpoints for heavy search/report.

Do not optimize prematurely, but be aware.

---

## 60. Dynamic SQL and Index Design

Every allowed filter/sort should be index-reviewed.

If API allows:

```text
status
officer
created_at range
sort updated_at
keyword
```

Index strategy must match common combinations.

Bad API design can create impossible query performance.

Repository/query service should not expose arbitrary DB fields without performance review.

---

## 61. Dynamic Search and Full-Text

`LIKE '%keyword%'` can be expensive.

Options:

- prefix search `keyword%`;
- trigram/full-text index;
- search engine;
- materialized search table;
- minimum keyword length;
- rate limit;
- async export.

Do not let dynamic query composition become unbounded search engine accidentally.

---

## 62. Dynamic Query and Authorization

Authorization filters must not be optional.

Bad:

```go
if filter.UserID != nil {
	w.AddValue("owner_id = %s", *filter.UserID)
}
```

If caller forgets, query returns all records.

Better:

```go
func SearchVisibleCases(ctx context.Context, actor Actor, filter Filter) {
	w.AddValue("tenant_id = %s", actor.TenantID)
	w.AddValue("visibility_user_id = %s", actor.UserID)
}
```

Or use authorization join/exists.

---

## 63. Multi-Tenant Safety

Tenant predicate should be first-class.

```go
func (q CaseQuery) Search(ctx context.Context, db *sql.DB, tenant TenantID, filter CaseSearchFilter, page PageRequest) ([]CaseListItem, error) {
	w := NewWhereBuilder(Dollar)
	w.AddValue("c.tenant_id = %s", tenant)
	// other filters
}
```

Do not accept tenant as optional filter.

---

## 64. Soft Delete Filter

If table uses soft delete:

```sql
c.deleted_at IS NULL
```

should usually be code-owned required predicate.

```go
w.AddRaw("c.deleted_at IS NULL")
```

Admin queries that include deleted records should be separate method with explicit name:

```go
SearchCasesIncludingDeleted
```

---

## 65. Dynamic SQL and Row-Level Security

If DB row-level security is used, still keep application predicates explicit where useful.

RLS is defense-in-depth, not reason to build sloppy queries.

Error handling must account for RLS causing no rows.

---

## 66. Composable Query Fragments

Define safe fragments as functions.

```go
func tenantPredicate(w *WhereBuilder, tenant TenantID) {
	w.AddValue("c.tenant_id = %s", tenant)
}

func notDeletedPredicate(w *WhereBuilder) {
	w.AddRaw("c.deleted_at IS NULL")
}

func statusPredicate(w *WhereBuilder, status Status) {
	w.AddValue("c.status = %s", status)
}
```

This is safer than passing arbitrary strings around.

---

## 67. Avoid Global Mutable Query Builder

Do not reuse builder across goroutines/requests.

Bad:

```go
var globalBuilder SQLBuilder
```

Builders should be local per query.

---

## 68. Query Composition and Concurrency

Builder state is mutable:

- placeholder count;
- args;
- clauses.

Use per-call instance.

Do not store mutable builder in repository struct.

---

## 69. Repository Boundary Example: Case Search

```go
type CaseQuery struct {
	classifier dberr.Classifier
}

func (q CaseQuery) Search(
	ctx context.Context,
	db *sql.DB,
	tenant TenantID,
	filter CaseSearchFilter,
	page PageRequest,
) ([]CaseListItem, error) {
	page = NormalizePage(page)

	w := NewWhereBuilder(Dollar)
	w.AddValue("c.tenant_id = %s", tenant)
	w.AddRaw("c.deleted_at IS NULL")

	if filter.Status != nil {
		w.AddValue("c.status = %s", *filter.Status)
	}

	if filter.OfficerID != nil {
		w.AddValue("c.officer_id = %s", *filter.OfficerID)
	}

	if filter.CreatedFrom != nil {
		w.AddValue("c.created_at >= %s", *filter.CreatedFrom)
	}

	if filter.CreatedTo != nil {
		w.AddValue("c.created_at < %s", *filter.CreatedTo)
	}

	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		pattern := "%" + EscapeLike(keyword) + "%"
		w.AddValue(`c.reference_no LIKE %s ESCAPE '\'`, pattern)
	}

	sortCol, err := CaseSortColumn(page.SortField)
	if err != nil {
		return nil, err
	}

	sortDir, err := SortDirection(page.SortDirection)
	if err != nil {
		return nil, err
	}

	limitPH := w.ph.Next()
	w.args = append(w.args, page.Limit)

	offsetPH := w.ph.Next()
	w.args = append(w.args, page.Offset)

	query := `
		SELECT c.id, c.reference_no, c.status, c.updated_at
		FROM cases c
	` + w.SQL() + `
		ORDER BY ` + sortCol + ` ` + sortDir + `, c.id DESC
		LIMIT ` + limitPH + ` OFFSET ` + offsetPH

	rows, err := db.QueryContext(ctx, query, w.Args()...)
	if err != nil {
		return nil, q.mapError("case.search", err)
	}
	defer rows.Close()

	items := make([]CaseListItem, 0, page.Limit)
	for rows.Next() {
		var item CaseListItem
		if err := rows.Scan(&item.ID, &item.ReferenceNo, &item.Status, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("case.search scan: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, q.mapError("case.search iterate", err)
	}

	return items, nil
}
```

This is intentionally explicit.

---

## 70. Improvement: Builder Adds Limit/Offset

Avoid direct access to `w.ph` and `w.args` by adding method:

```go
func (w *WhereBuilder) Arg(value any) string {
	p := w.ph.Next()
	w.args = append(w.args, value)
	return p
}
```

Then:

```go
limitPH := w.Arg(page.Limit)
offsetPH := w.Arg(page.Offset)
```

Cleaner.

---

## 71. Revised WhereBuilder

```go
type WhereBuilder struct {
	clauses []string
	args    []any
	ph      *Placeholder
}

func NewWhereBuilder(style PlaceholderStyle) *WhereBuilder {
	return &WhereBuilder{ph: NewPlaceholder(style)}
}

func (w *WhereBuilder) Arg(value any) string {
	p := w.ph.Next()
	w.args = append(w.args, value)
	return p
}

func (w *WhereBuilder) AddValue(expr string, value any) {
	w.clauses = append(w.clauses, fmt.Sprintf(expr, w.Arg(value)))
}

func (w *WhereBuilder) AddRaw(fragment string) {
	w.clauses = append(w.clauses, fragment)
}

func (w *WhereBuilder) SQL() string {
	if len(w.clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(w.clauses, " AND ")
}

func (w *WhereBuilder) Args() []any {
	return w.args
}
```

---

## 72. Dynamic Count Query

For listing with total count:

```go
countQuery := `
	SELECT COUNT(*)
	FROM cases c
` + w.SQL()

var total int64
if err := db.QueryRowContext(ctx, countQuery, w.Args()...).Scan(&total); err != nil {
	return PageResult[CaseListItem]{}, q.mapError("case.search.count", err)
}
```

Then data query with same filters plus order/limit/offset.

Caution:

- count can be expensive;
- for large datasets consider has-next-page;
- do not always count by default.

---

## 73. Reusing WhereBuilder Args

If count query uses same `w.Args()` and data query adds limit/offset, be careful not to mutate shared args unexpectedly.

Pattern:

```go
filterSQL := w.SQL()
filterArgs := append([]any(nil), w.Args()...)

countArgs := append([]any(nil), filterArgs...)

dataArgs := append([]any(nil), filterArgs...)
limitPH := next placeholder after filter args
```

But placeholder numbering must align.

Simpler: build count and data separately from same normalized filter, or builder supports cloning.

---

## 74. Builder Cloning Complexity

If you need count + data query, design builder intentionally.

Option:

```go
type BuiltFilter struct {
	SQL string
	Args []any
	NextIndex int
}
```

Then continue placeholder numbering.

For PostgreSQL:

```go
ph := Placeholder{n: len(filterArgs)}
limit := ph.Next()
```

Be explicit.

---

## 75. Dynamic Query Builder With Start Index

```go
func NewPlaceholderFrom(style PlaceholderStyle, start int) *Placeholder {
	return &Placeholder{style: style, n: start}
}
```

Then:

```go
filter := BuildFilter(filter)

ph := NewPlaceholderFrom(Dollar, len(filter.Args))
limitPH := ph.Next()
offsetPH := ph.Next()

args := append([]any{}, filter.Args...)
args = append(args, limit, offset)
```

---

## 76. Placeholder Style `?` Simpler But Less Self-Checking

MySQL-style `?` avoids numbering.

But arg ordering still matters.

```sql
WHERE status = ? AND created_at >= ?
```

args must match.

For generated dynamic SQL, tests still required.

---

## 77. Dynamic SQL Formatting

Keep generated SQL readable.

Good:

```sql
SELECT ...
FROM ...
WHERE ...
ORDER BY ...
LIMIT ...
```

Avoid minified unreadable query if logs/plans need debugging.

But normalize for tests.

---

## 78. Avoid Magic Reflection Builders

Reflection-based builders:

```go
BuildWhereFromStruct(filter)
```

Risks:

- hidden field mapping;
- unindexed filters exposed;
- null/zero ambiguity;
- injection via tags if misused;
- difficult query review;
- implicit behavior.

Use explicit builder for critical systems.

---

## 79. Query Composition and Type Safety

For domain enums:

```go
type Status string
```

Parsing at API boundary prevents arbitrary string.

For sort field:

```go
type CaseSortField string

const (
	SortUpdatedAt CaseSortField = "updatedAt"
)
```

Then map to SQL column.

This reduces invalid states.

---

## 80. Query Composition and Validation Layer

Flow:

```text
raw request query params
-> parse/validate into typed filter
-> normalize defaults
-> repository builds SQL from typed filter
```

Do not let repository parse raw HTTP query strings.

Handler:

```go
filter, page, err := parseCaseSearchRequest(r)
```

Service/query:

```go
items, err := q.Search(ctx, db, tenant, filter, page)
```

---

## 81. Query Composition and Error Mapping

Invalid sort/filter is not DB error.

Return domain/application validation error before DB.

```go
if _, err := CaseSortColumn(input); err != nil {
	return nil, ErrInvalidSortField
}
```

Map to:

```text
400 Bad Request
```

not 500.

---

## 82. SQL Injection Boundary Checklist

- [ ] All values are passed as args.
- [ ] No `fmt.Sprintf` for user values.
- [ ] No string concatenation of user values.
- [ ] Identifiers come from allowlist.
- [ ] Sort direction comes from allowlist.
- [ ] Operators come from allowlist.
- [ ] Table/schema names come from trusted mapping.
- [ ] LIKE patterns escape `%`, `_`, and escape char.
- [ ] LIMIT/OFFSET are validated/clamped.
- [ ] IN lists expand placeholders safely or use DB-specific safe array binding.
- [ ] Empty IN semantics explicit.
- [ ] Dynamic raw fragments are code-owned only.
- [ ] Tests include malicious inputs.

---

## 83. Query Composition Review Checklist

- [ ] Query has stable operation name.
- [ ] Required tenant/authorization predicates present.
- [ ] Soft-delete predicate present if needed.
- [ ] Dynamic filters are typed.
- [ ] Sorting deterministic.
- [ ] Pagination bounded.
- [ ] Index implications reviewed.
- [ ] Count query cost reviewed.
- [ ] Rows are closed.
- [ ] Rows.Err checked.
- [ ] Error mapping exists.
- [ ] SQL is integration-tested.
- [ ] Builder output is unit-tested for key combinations.

---

## 84. Performance Review Checklist

For each allowed filter/sort:

- [ ] Is there an index?
- [ ] Is predicate selective?
- [ ] Does leading wildcard break index?
- [ ] Does ORDER BY use index?
- [ ] Is count query expensive?
- [ ] What happens at large offset?
- [ ] What is max limit?
- [ ] Is query on OLTP or report path?
- [ ] Is tenant predicate first-class?
- [ ] Are joins multiplying rows?
- [ ] Are projections minimal?

---

## 85. Security Review Checklist

- [ ] Can attacker select arbitrary column?
- [ ] Can attacker change sort direction into SQL fragment?
- [ ] Can attacker bypass tenant predicate?
- [ ] Can attacker cause full-table scan with broad filters?
- [ ] Can attacker use huge IN list?
- [ ] Can attacker use huge limit/offset?
- [ ] Can keyword search trigger expensive wildcard scan?
- [ ] Are errors leaking SQL/schema?
- [ ] Are logs leaking raw search values?
- [ ] Is rate limiting needed?

---

## 86. Anti-Patterns

| Anti-pattern | Problem |
|---|---|
| `fmt.Sprintf` user values into SQL | injection |
| raw user `ORDER BY` | injection/data exposure |
| raw user table name | injection/schema exposure |
| generic filter over all columns | security/performance risk |
| no max limit | memory/DB load |
| empty IN accidentally no filter | data leak |
| `SELECT *` | brittle/wasteful |
| no deterministic order | pagination bugs |
| offset-only for huge data | slow queries |
| dynamic SQL with no tests | production surprises |
| builder hides SQL completely | poor review |
| query fragments passed across layers unchecked | injection risk |
| LIKE without escaping | wildcard semantics bug |
| app validation but DB unsafe | bypass risk |

---

## 87. Mini Case Study: Search Endpoint Injection

Bad API:

```text
GET /cases?sort=created_at desc;drop table cases
```

Bad code:

```go
query += " ORDER BY " + sort
```

Safe design:

```go
sortCol, err := CaseSortColumn(input.SortField)
sortDir, err := SortDirection(input.SortDir)
query += " ORDER BY " + sortCol + " " + sortDir + ", c.id DESC"
```

Invalid sort returns 400.

---

## 88. Mini Case Study: Empty Status List

Request:

```text
GET /cases?status=
```

Ambiguous.

If parsed as empty list, decide:

- no filter;
- invalid;
- match none.

Do not accidentally produce:

```sql
WHERE status IN ()
```

or skip filter when caller intended none.

Document API.

---

## 89. Mini Case Study: Multi-Tenant Missing Predicate

Bug:

```go
if filter.TenantID != "" {
	w.AddValue("tenant_id = %s", filter.TenantID)
}
```

If parsing bug leaves tenant empty, query returns cross-tenant data.

Fix:

- tenant is required function parameter;
- not part of optional filter;
- service obtains tenant from auth context;
- repository always adds predicate.

---

## 90. Mini Case Study: Dynamic Report API

User can group by:

```text
status, officer, month
```

Do not allow arbitrary group expression.

Allowlist:

```go
var groups = map[string]string{
	"status": "c.status",
	"officer": "c.officer_id",
	"month": "date_trunc('month', c.created_at)",
}
```

Also enforce:

- date range max;
- tenant predicate;
- max groups;
- report pool;
- async for large export.

---

## 91. Mini Case Study: Dynamic Patch

PATCH request:

```json
{
  "name": "A",
  "role": "ADMIN"
}
```

If `role` is not patchable by this endpoint, ignore or reject?

Best:

- parse into allowed patch struct;
- unknown fields rejected if API wants strictness;
- repository only has setters for allowed fields;
- authorization controls sensitive fields.

Do not build `SET` from arbitrary JSON keys.

---

## 92. Implementation: Strict JSON Unknown Fields

At API boundary, consider rejecting unknown fields.

This avoids users thinking unsupported fields changed.

In Go HTTP handler, JSON decoder can disallow unknown fields:

```go
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
```

Then parse to typed patch.

This is transport detail, but it protects repository from arbitrary fields.

---

## 93. Implementation: Sort Parsing

```go
type SortRequest struct {
	Field string
	Direction string
}

func ParseSort(raw string) SortRequest {
	if raw == "" {
		return SortRequest{Field: "updatedAt", Direction: "desc"}
	}

	if strings.HasPrefix(raw, "-") {
		return SortRequest{Field: strings.TrimPrefix(raw, "-"), Direction: "desc"}
	}

	return SortRequest{Field: raw, Direction: "asc"}
}
```

Then allowlist field.

---

## 94. Implementation: Cursor Parse

For keyset pagination, cursor should be opaque.

```go
type Cursor struct {
	UpdatedAt time.Time
	ID int64
}
```

Encode/decode base64 JSON or signed token.

Do not let user pass raw SQL cursor predicate.

Part 023 covers this deeply.

---

## 95. Implementation: Safe Column Constants

```go
const (
	colCaseID        = "c.id"
	colCaseUpdatedAt = "c.updated_at"
	colCaseStatus    = "c.status"
)
```

Use constants in allowlist.

This avoids typos and centralizes column alias decisions.

---

## 96. Implementation: Allowlist Type

```go
type SQLFragment string

type Allowlist map[string]SQLFragment

func (a Allowlist) Get(key string) (string, bool) {
	v, ok := a[key]
	return string(v), ok
}
```

Naming `SQLFragment` makes it clear these are trusted fragments.

---

## 97. Implementation: Trusted Fragment Comments

```go
// SQLFragment is a trusted SQL fragment defined by code.
// It must never be constructed from raw user input.
type SQLFragment string
```

This kind of comment prevents misuse over time.

---

## 98. Testing LIKE Escape

Test:

```go
func TestEscapeLike(t *testing.T) {
	got := EscapeLike(`a%b_c\`)
	want := `a\%b\_c\\`
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
```

Also integration test search literal `%`.

---

## 99. Testing Sort Allowlist

```go
func TestSortRejectsInjection(t *testing.T) {
	_, err := CaseSortColumn("updatedAt; drop table cases")
	if !errors.Is(err, ErrInvalidSortField) {
		t.Fatalf("expected invalid sort, got %v", err)
	}
}
```

---

## 100. Testing Empty IN

```go
func TestEmptyInMatchesNothing(t *testing.T) {
	w := NewWhereBuilder(Dollar)

	err := AddIn(w, "c.status", []Status{})
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(w.SQL(), "1 = 0") {
		t.Fatalf("expected match nothing, got %s", w.SQL())
	}
}
```

---

## 101. Testing Placeholder Order

```go
func TestPlaceholderOrder(t *testing.T) {
	w := NewWhereBuilder(Dollar)
	w.AddValue("tenant_id = %s", "t1")
	w.AddValue("status = %s", "APPROVED")

	sql := w.SQL()
	args := w.Args()

	if !strings.Contains(sql, "tenant_id = $1") {
		t.Fatal(sql)
	}
	if !strings.Contains(sql, "status = $2") {
		t.Fatal(sql)
	}
	if args[0] != "t1" || args[1] != "APPROVED" {
		t.Fatalf("args=%v", args)
	}
}
```

---

## 102. Integration Test Malicious Keyword

Insert:

```text
reference_no = "ABC%' OR 1=1 --"
```

Search for that exact string.

Expected:

- it can be found as data if exact search supports it;
- it does not return all rows;
- SQL does not break.

---

## 103. Query Composition and Code Review Culture

Dynamic SQL must be readable in review.

A reviewer should be able to answer:

1. Which SQL fragments can be dynamic?
2. Are all dynamic fragments allowlisted?
3. Are values bound?
4. Are required filters always included?
5. What SQL variants are possible?
6. Are indexes aligned?
7. What happens on empty list?
8. What is max result size?

If not, composition has become too magical.

---

## 104. When to Use Third-Party Query Builder

Use when:

- many dynamic filters;
- multiple DB dialects;
- team agrees on library;
- library keeps SQL visible enough;
- library handles placeholder numbering well;
- you still test generated SQL;
- security rules remain clear.

Avoid when:

- it hides too much;
- team stops reviewing SQL;
- library invents inefficient queries;
- it becomes pseudo-ORM accidentally.

---

## 105. When to Use SQL Code Generation

Use when:

- many static SQL queries;
- type-safe scan is valuable;
- DB target is stable;
- generated code accepts `DBTX`/querier;
- migrations and query generation integrated.

Still needed:

- dynamic filter strategy;
- error mapping;
- transaction boundary;
- idempotency/outbox;
- observability.

---

## 106. When to Use Stored Procedures for Dynamic Logic

Stored procedures can centralize dynamic decisions in DB.

Use deliberately for:

- performance-critical server-side logic;
- strict DBA governance;
- complex data-local operations.

Risks:

- versioning complexity;
- language split;
- testing/deployment complexity;
- error mapping still needed;
- business logic split across app/DB.

Not a default replacement for safe query composition.

---

## 107. Cheat Sheet: Safe Composition Rules

```text
Values        -> bind args
Columns       -> allowlist
Tables        -> avoid; if needed allowlist
Operators     -> allowlist
Sort direction -> allowlist
LIMIT/OFFSET  -> validate/clamp, bind if DB supports
LIKE          -> bind + escape wildcard if literal search
IN list       -> expand placeholders or DB-specific array binding
Raw fragment  -> code-owned only
Tenant filter -> required, not optional
Authorization -> required, not optional
Empty list    -> explicit semantics
```

---

## 108. Checklist Before Shipping Dynamic Query

- [ ] Unit tests for SQL generation.
- [ ] Integration tests for main filters.
- [ ] Injection tests for sort/filter/keyword.
- [ ] Performance test for common filter combinations.
- [ ] Explain plan reviewed for top queries.
- [ ] Max limit enforced.
- [ ] Required tenant/security predicates enforced.
- [ ] Error responses for invalid filter/sort.
- [ ] Metrics include operation name.
- [ ] Logs do not expose raw sensitive params.
- [ ] Runbook includes slow query diagnosis.

---

## 109. Latihan

### Exercise 1 — Safe Sort

API accepts:

```text
?sort=createdAt&dir=desc
```

Question:

- Why should `createdAt` not be concatenated directly?
- Write allowlist approach.

### Exercise 2 — Dynamic Status List

API accepts:

```text
?status=SUBMITTED&status=APPROVED
```

Question:

- How to build `IN` safely?
- What should empty list mean?

### Exercise 3 — Keyword Search

User searches:

```text
100%_valid
```

Question:

- Why must LIKE wildcard be escaped?
- Write helper behavior.

### Exercise 4 — Patch Update

PATCH body contains arbitrary field names.

Question:

- Why is building `SET field = value` from JSON keys dangerous?
- What is safer?

### Exercise 5 — Tenant Predicate

Repository search has optional tenant filter.

Question:

- Why is this dangerous?
- What should method signature look like?

### Exercise 6 — Count Query

Search endpoint always runs exact `COUNT(*)`.

Question:

- What can go wrong?
- What alternatives exist?

---

## 110. Jawaban Singkat Latihan

### Exercise 1

`createdAt` becomes SQL identifier/fragment, not value. It cannot be safely bound as normal parameter.

Use:

```go
var sortCols = map[string]string{
	"createdAt": "c.created_at",
	"updatedAt": "c.updated_at",
}
```

Reject unknown key.

### Exercise 2

Expand placeholders:

```sql
status IN ($1, $2)
```

with args `SUBMITTED`, `APPROVED`, or use DB-specific array binding.

Empty list semantics must be explicit: no filter, match nothing, or invalid request.

### Exercise 3

`%` and `_` are wildcard characters in LIKE. If user intends literal search, escape them and bind pattern as arg.

Helper escapes `%`, `_`, and escape character.

### Exercise 4

JSON keys can become arbitrary column names or SQL fragments. Parse into typed patch struct and only set allowlisted fields.

### Exercise 5

Optional tenant filter can cause cross-tenant data leak if missing. Tenant should be required parameter:

```go
Search(ctx, db, tenantID, filter, page)
```

Repository always includes tenant predicate.

### Exercise 6

Exact count can be expensive, especially with joins/filters/large tables. Alternatives: has-next-page, approximate count, async count, materialized summary, or omit total count.

---

## 111. Ringkasan

Dynamic SQL is not inherently bad. Uncontrolled dynamic SQL is bad.

Safe query composition in Go means:

1. keep SQL skeleton explicit;
2. bind all values through args;
3. allowlist all identifiers/operators/directions;
4. validate and clamp pagination;
5. define empty list semantics;
6. escape LIKE wildcards when doing literal search;
7. keep tenant/authorization predicates required;
8. test generated SQL and malicious inputs;
9. review index/performance implications;
10. avoid builders that hide SQL from review.

If you remember one sentence:

> Bind values, allowlist syntax, and keep query shape reviewable.

---

## 112. Referensi

- Go documentation — Avoiding SQL injection risk: <https://go.dev/doc/database/sql-injection>
- Go documentation — Querying for data: <https://go.dev/doc/database/querying>
- Go package documentation — `database/sql`: <https://pkg.go.dev/database/sql>
- Go documentation — Prepared statements: <https://go.dev/doc/database/prepared-statements>
- OWASP Cheat Sheet Series — SQL Injection Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html>
- OWASP Cheat Sheet Series — Injection Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html>


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-sql-database-integration-part-021.md">⬅️ Repository Boundary and Data Access Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-sql-database-integration-part-023.md">Pagination, Sorting, Search, and Listing APIs ➡️</a>
</div>
