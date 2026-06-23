# learn-go-sql-database-integration-part-028.md

# Database-Specific Integration: SQLite, SQL Server, and Oracle Notes

> Seri: `learn-go-sql-database-integration`  
> Part: `028`  
> Topik: `SQLite, SQL Server, and Oracle Integration Notes in Go: Drivers, DSN, Pooling, Type Mapping, Transactions, Locking, Error Codes, Bulk Paths, and Production Caveats`  
> Target pembaca: Java software engineer yang ingin memahami Go database integration sampai level production architecture  
> Target Go: Go 1.26.x  
> Status seri: **belum selesai**

---

## 0. Posisi Part Ini Dalam Seri

Pada part 026 kita membahas PostgreSQL-specific integration.  
Pada part 027 kita membahas MySQL/MariaDB-specific integration.

Part ini membahas tiga database yang sering muncul dalam konteks berbeda:

1. **SQLite** — embedded, serverless, file-based, sangat bagus untuk local app, edge, test, small deployment, dan beberapa workload production yang bounded.
2. **SQL Server** — enterprise RDBMS dari Microsoft, umum di corporate environment, Azure SQL, reporting/OLTP enterprise, Windows ecosystem.
3. **Oracle Database** — enterprise RDBMS besar, umum di banking, government, telco, legacy enterprise, high-end OLTP, PL/SQL-heavy systems.

Kenapa digabung dalam satu part?

Karena dalam roadmap seri ini, fokus utama sebelumnya sudah pada generic SQL, PostgreSQL, dan MySQL/MariaDB. SQLite, SQL Server, dan Oracle tetap penting, tetapi pembahasannya di sini sebagai **production integration notes**:

- hal-hal yang wajib diketahui;
- driver pilihan;
- DSN/config;
- transaction/locking;
- type mapping;
- error mapping;
- bulk path;
- anti-pattern;
- kapan cocok/tidak cocok;
- runbook.

Ini bukan pengganti dokumentasi resmi masing-masing database, tetapi mental model dan checklist untuk Go engineer agar tidak jatuh ke bug integrasi umum.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. memahami kapan SQLite cocok dan kapan tidak cocok untuk backend service;
2. memilih driver SQLite di Go: CGO `mattn/go-sqlite3` vs CGo-free `modernc.org/sqlite`;
3. memahami SQLite locking, WAL, busy timeout, foreign key pragma, dan `SetMaxOpenConns`;
4. memahami SQL Server driver `github.com/microsoft/go-mssqldb`;
5. membuat DSN SQL Server yang benar, termasuk encryption/trust/certificate dan Azure SQL notes;
6. memahami SQL Server transaction isolation, locking, deadlock, snapshot isolation, rowversion, identity, `OUTPUT`, dan `MERGE` caveat;
7. memahami Oracle driver `godror`, Oracle Client/ODPI-C dependency, DSN/logfmt config, service name, wallets, and CGO/runtime deployment caveat;
8. memahami Oracle transaction, isolation, sequence, identity, `RETURNING INTO`, LOB handling, REF CURSOR, PL/SQL, and array binding notes;
9. membuat error taxonomy untuk SQLite, SQL Server, dan Oracle;
10. memahami bulk path masing-masing: SQLite transaction batching, SQL Server bulk copy/table-valued parameters, Oracle array bind/direct path/external tools;
11. menyusun repository/transaction boundary yang tetap konsisten walau database-specific;
12. membuat checklist production dan runbook per database.

---

## 2. Fakta Dasar Dari Sumber Resmi

Beberapa fakta penting:

1. `modernc.org/sqlite` adalah driver `database/sql` CGo-free untuk SQLite, dan dokumentasinya menyebut SQLite sebagai in-process, self-contained, serverless, zero-configuration, transactional SQL database engine.
2. `mattn/go-sqlite3` adalah driver SQLite yang conform ke Go `database/sql`, tetapi menggunakan CGO.
3. Dokumentasi SQLite menjelaskan locking state seperti `SHARED`, `RESERVED`, `PENDING`, dan `EXCLUSIVE`; hanya satu EXCLUSIVE lock yang boleh ada untuk file database.
4. SQLite `busy_timeout` membuat busy handler tidur saat table terkunci sampai waktu akumulasi tertentu, lalu mengembalikan `SQLITE_BUSY` jika tetap tidak bisa mendapatkan lock.
5. `github.com/microsoft/go-mssqldb` adalah driver pure Go `database/sql` untuk Microsoft SQL Server dan Azure SQL.
6. Dokumentasi `go-mssqldb` merekomendasikan URL connection string seperti `sqlserver://username:password@host/instance?param1=value&param2=value`.
7. `godror` adalah driver `database/sql/driver` untuk Oracle Database yang memakai ODPI-C/Oracle Client libraries; package ini membutuhkan CGO dan Oracle Client library saat runtime.
8. Oracle Developer documentation menyatakan `godror` dapat dipakai melalui `database/sql` saat `sql.Open` menggunakan driver `oracle` atau `godror`, dan godror membutuhkan Oracle Instant Client pada environment yang menjalankan aplikasi.

Referensi utama:

- Go `database/sql`: <https://pkg.go.dev/database/sql>
- `modernc.org/sqlite`: <https://pkg.go.dev/modernc.org/sqlite>
- `mattn/go-sqlite3`: <https://pkg.go.dev/github.com/mattn/go-sqlite3>
- SQLite locking: <https://sqlite.org/lockingv3.html>
- SQLite busy timeout: <https://sqlite.org/c3ref/busy_timeout.html>
- SQLite PRAGMA: <https://sqlite.org/pragma.html>
- Microsoft `go-mssqldb`: <https://pkg.go.dev/github.com/microsoft/go-mssqldb>
- Microsoft SQL Server Go driver page: <https://learn.microsoft.com/en-us/sql/connect/golang/microsoft-go-mssqldb-driver>
- `godror`: <https://pkg.go.dev/github.com/godror/godror>
- Oracle Developer — Working in Go applications with Oracle Database: <https://www.oracle.com/developer/working-in-go-applications-with-oracle-database-and-oracle-cloud-autonomous-database/>

---

## 3. Mental Model Utama

### 3.1 `database/sql` Sama, Database Semantics Berbeda

Kode Go bisa terlihat sama:

```go
db.QueryContext(ctx, query, args...)
db.ExecContext(ctx, query, args...)
db.BeginTx(ctx, opts)
```

Tetapi database behavior berbeda jauh:

| Area | SQLite | SQL Server | Oracle |
|---|---|---|---|
| deployment | embedded file | server/managed service | server/managed enterprise |
| driver | CGO or CGo-free | pure Go | CGO + Oracle Client |
| concurrency | many readers, limited writer concurrency | full server concurrency | full server concurrency |
| transaction | file locking/WAL | locks/versioning/snapshot options | MVCC/read consistency |
| placeholder | `?`/driver-specific | named/`@p1` style | named `:name`/positional |
| generated ID | `last_insert_rowid()`/Result | identity/OUTPUT/SCOPE_IDENTITY | sequence/identity/RETURNING INTO |
| bulk | transaction batch | bulk copy/TVP/staging | array bind/direct path/tools |
| operational complexity | low but file/lock sensitive | medium/high | high |
| best use | embedded/local/edge/test | enterprise/Azure/OLTP/reporting | enterprise/high-end/legacy/PLSQL |

### 3.2 Database-Specific Notes Bukan Sekadar Syntax

Kesalahan umum engineer:

```text
Saya sudah bisa database/sql, jadi database apa pun sama.
```

Yang sebenarnya:

- SQLite bisa gagal `database is locked` jika pool/write concurrency salah.
- SQL Server bisa deadlock karena lock escalation atau query plan.
- Oracle bisa gagal deploy karena Oracle Instant Client/CGO/wallet.
- SQL Server `MERGE` punya caveat dan tidak boleh dipakai sembarangan.
- Oracle LOB dan REF CURSOR tidak seperti scan string biasa.
- SQLite foreign key enforcement perlu dipastikan aktif.
- SQL Server/Oracle error code mapping berbeda dari SQLSTATE PostgreSQL.

---

# Bagian A — SQLite

---

## 4. SQLite: Kapan Cocok?

SQLite cocok untuk:

- embedded app;
- desktop/mobile/local-first;
- CLI tools;
- small service dengan single-node persistence;
- edge deployment;
- cache lokal;
- metadata store;
- test/integration test;
- low-write workload;
- single-writer bounded workload;
- file-based durable local queue dalam batas tertentu.

SQLite kurang cocok untuk:

- high-write multi-instance backend;
- horizontal scaling dengan shared DB file;
- banyak writer concurrent;
- network filesystem yang unreliable;
- multi-tenant central OLTP besar;
- strict server-side access control multi-user;
- kebutuhan replication/failover DB server;
- workload long-running write transactions.

SQLite bukan “mainan”, tetapi ia punya concurrency model berbeda dari client/server DB.

---

## 5. SQLite Driver Choices in Go

### 5.1 `mattn/go-sqlite3`

Karakteristik:

- driver `database/sql`;
- memakai SQLite C library;
- CGO required;
- mature and widely used;
- build/deploy butuh C compiler saat build;
- cross-compilation lebih kompleks;
- fitur tergantung compile tags/linked SQLite.

Import:

```go
import _ "github.com/mattn/go-sqlite3"
```

Open:

```go
db, err := sql.Open("sqlite3", "file:app.db?_foreign_keys=on&_busy_timeout=5000")
```

### 5.2 `modernc.org/sqlite`

Karakteristik:

- driver `database/sql`;
- CGo-free port of SQLite;
- easier cross-compilation in many environments;
- dependency/version behavior harus dipahami;
- performance/compatibility harus diuji untuk workload target.

Import:

```go
import _ "modernc.org/sqlite"
```

Open driver name may be:

```go
db, err := sql.Open("sqlite", "file:app.db")
```

Check exact driver docs/version.

### 5.3 Decision

Use `mattn/go-sqlite3` when:

- CGO acceptable;
- maximum compatibility with SQLite C behavior desired;
- deployment environment controlled.

Use `modernc.org/sqlite` when:

- CGo-free build is important;
- cross-compilation simplicity matters;
- target workload tested.

Always benchmark/test target workload.

---

## 6. SQLite DSN and Pragmas

Common DSN/pragma concerns:

- file path;
- in-memory database;
- shared cache;
- foreign keys;
- journal mode/WAL;
- busy timeout;
- synchronous mode;
- cache size;
- transaction mode.

Example mattn-style DSN:

```text
file:app.db?_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL
```

Exact DSN pragma names are driver-specific.

You can also execute pragmas after opening:

```go
_, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON`)
```

But remember: pragmas may be per-connection. In a pool, every connection must have correct settings.

---

## 7. SQLite Pooling Rule

SQLite is embedded and file-lock based.

For many Go apps, especially write-heavy or simple local apps:

```go
db.SetMaxOpenConns(1)
```

This serializes DB use through one connection and avoids many `database is locked` surprises.

If using WAL and read-heavy workload, you may use more read concurrency, but you must understand connection-level pragmas and writer contention.

Default recommendation for correctness-first app:

```go
db.SetMaxOpenConns(1)
db.SetMaxIdleConns(1)
```

Then increase only after measuring.

---

## 8. SQLite WAL Mode

WAL mode can improve reader/writer concurrency compared to rollback journal mode.

Set:

```sql
PRAGMA journal_mode = WAL;
```

But understand:

- WAL creates `-wal` and `-shm` files;
- checkpointing matters;
- not all filesystems are safe;
- concurrent writers still serialize;
- backup/copy process must include WAL state correctly;
- WAL is not magic high-write server concurrency.

---

## 9. SQLite Busy Timeout

If database is locked, SQLite can wait for lock before returning `SQLITE_BUSY`.

Driver/pragma:

```sql
PRAGMA busy_timeout = 5000;
```

Meaning:

```text
wait up to roughly 5 seconds for lock before failing busy.
```

This reduces immediate lock errors but does not fix bad transaction design.

If writes wait too often, fix:

- long transactions;
- unclosed rows;
- too many open connections;
- read-to-write transaction upgrade;
- external calls inside transaction;
- lack of batching;
- writer concurrency.

---

## 10. SQLite Foreign Keys

SQLite foreign key enforcement historically requires enabling:

```sql
PRAGMA foreign_keys = ON;
```

Many apps forget this and think FK constraints are enforced when they are not.

For Go:

- ensure DSN enables it on every connection;
- or set after opening per connection if driver supports hook;
- test FK violation integration test.

Never assume FK enforcement unless tested.

---

## 11. SQLite Transaction Modes

SQLite supports transaction modes conceptually:

- deferred;
- immediate;
- exclusive.

Default `BEGIN` is often deferred: it does not acquire write lock until needed.

If transaction will write, `BEGIN IMMEDIATE` can avoid read-to-write upgrade issues.

With `database/sql`, `BeginTx` abstracts transaction start and driver controls exact SQL. If you need `BEGIN IMMEDIATE`, you may need driver-specific mechanism or manual reserved connection with care.

Do not mix manual `BEGIN`/`COMMIT` through `db.Exec` randomly with `database/sql` transaction management.

---

## 12. SQLite `database is locked` Mental Model

Common causes:

- multiple open connections writing;
- one transaction holds write lock too long;
- rows not closed;
- long read transaction blocking checkpoint/write;
- external work inside transaction;
- no busy timeout;
- read transaction upgraded to write;
- network filesystem locking issue;
- multiple processes writing.

Fixes:

- `SetMaxOpenConns(1)` initially;
- WAL mode if appropriate;
- busy timeout;
- close rows;
- short transactions;
- batch writes in one transaction;
- avoid external calls in transaction;
- do not use SQLite DB file on unsafe network FS.

---

## 13. SQLite Error Classification

Common classes:

| SQLite Error | Meaning | App Class |
|---|---|---|
| `SQLITE_CONSTRAINT_UNIQUE` | unique violation | conflict |
| `SQLITE_CONSTRAINT_FOREIGNKEY` | FK violation | invalid reference |
| `SQLITE_BUSY` | database/table locked | retry/busy |
| `SQLITE_LOCKED` | table/db locked in connection/shared cache | retry/design issue |
| `SQLITE_READONLY` | readonly database | config/deploy |
| `SQLITE_CORRUPT` | database malformed/corrupt | critical |
| `SQLITE_FULL` | disk full | infrastructure |
| `SQLITE_IOERR` | IO error | infrastructure |
| `SQLITE_SCHEMA` | schema changed | migration/runtime statement issue |
| `SQLITE_MISUSE` | API misuse | code bug |

Exact extraction depends on driver.

---

## 14. SQLite Insert and LastInsertId

```go
result, err := db.ExecContext(ctx, `
	INSERT INTO users (email, name)
	VALUES (?, ?)
`, email, name)
if err != nil {
	return 0, err
}

id, err := result.LastInsertId()
if err != nil {
	return 0, err
}
```

SQLite supports rowid-style generated IDs.

But for idempotency and distributed systems, app-generated IDs may still be better.

---

## 15. SQLite Upsert

SQLite supports upsert syntax in modern versions:

```sql
INSERT INTO users (email, name)
VALUES (?, ?)
ON CONFLICT(email) DO UPDATE SET
    name = excluded.name;
```

But check SQLite version in your driver/build.

Upsert semantics remain business semantics:

- which conflict target?
- overwrite or ignore?
- stale data?
- audit?
- retry?

---

## 16. SQLite Bulk Write

Best baseline:

```text
batch many writes inside one transaction.
```

Bad:

```go
for rows:
    db.Exec(...)
```

Better:

```go
tx, _ := db.BeginTx(ctx, nil)
stmt, _ := tx.PrepareContext(ctx, `INSERT INTO ... VALUES (?, ?)`)
for rows:
    stmt.ExecContext(...)
tx.Commit()
```

For SQLite, transaction batching can improve write throughput dramatically because commit/fsync overhead is reduced.

Still keep transactions bounded.

---

## 17. SQLite Migrations

SQLite DDL support differs from server DBs.

Migration caveats:

- some `ALTER TABLE` operations limited;
- table rebuild pattern common;
- foreign keys and indexes must be recreated carefully;
- migration should be transactional if possible;
- backup before migration;
- test on copy of real DB.

For local app, migration failure may affect user file directly.

---

## 18. SQLite Backup

For SQLite DB file:

- do not copy only main `.db` file while WAL active without understanding;
- include WAL/shm or checkpoint safely;
- use SQLite backup API/tooling where possible;
- stop writes or take consistent backup.

Production embedded apps need backup/restore story.

---

## 19. SQLite Production Checklist

- [ ] Driver choice documented: CGO vs CGo-free.
- [ ] `SetMaxOpenConns(1)` unless concurrency design tested.
- [ ] WAL mode decision documented.
- [ ] busy timeout configured.
- [ ] foreign keys enabled and tested.
- [ ] rows closed and `rows.Err` checked.
- [ ] transactions kept short.
- [ ] external work outside transaction.
- [ ] migrations tested on real DB file.
- [ ] backup/restore tested.
- [ ] DB file path/permissions validated.
- [ ] network filesystem avoided unless proven safe.
- [ ] corruption/disk-full runbook exists.

---

# Bagian B — SQL Server

---

## 20. SQL Server: Kapan Cocok?

SQL Server cocok untuk:

- Microsoft/Azure ecosystem;
- enterprise OLTP;
- reporting/BI integration;
- existing corporate data platforms;
- stored procedure-heavy systems;
- Windows authentication environments;
- Azure SQL Database/Managed Instance.

Go service sering mengakses SQL Server untuk:

- integration with enterprise DB;
- new microservice using Azure SQL;
- reporting/read model;
- modernization around legacy SQL Server.

---

## 21. SQL Server Driver

Recommended driver:

```text
github.com/microsoft/go-mssqldb
```

It is a pure Go `database/sql` driver for SQL Server and Azure SQL.

Import:

```go
import _ "github.com/microsoft/go-mssqldb"
```

Open:

```go
db, err := sql.Open("sqlserver", dsn)
```

Use `database/sql` as usual.

---

## 22. SQL Server DSN

Recommended URL style:

```text
sqlserver://username:password@host/instance?database=dbname&encrypt=true
```

Example:

```text
sqlserver://app:secret@sql.example.com:1433?database=appdb&encrypt=true&trustservercertificate=false&app+name=aceas-api
```

Important parameters:

- user id;
- password;
- database;
- server/host/instance;
- port;
- encrypt;
- trust server certificate;
- connection timeout;
- application name;
- authentication method;
- Azure AD authentication if used.

Do not log password.

---

## 23. SQL Server Encryption

Modern SQL Server/Azure SQL deployments usually require encryption.

Parameters to understand:

- `encrypt`;
- `trustservercertificate`;
- certificate validation;
- host name;
- CA chain;
- Azure SQL requirements.

Production baseline:

```text
encrypt=true
trustservercertificate=false
```

unless environment has a justified exception.

---

## 24. SQL Server Placeholders

SQL Server driver supports named parameters.

Common style:

```sql
SELECT id, email
FROM users
WHERE tenant_id = @p1
  AND status = @p2;
```

Go:

```go
rows, err := db.QueryContext(ctx, query,
	sql.Named("p1", tenantID),
	sql.Named("p2", status),
)
```

Some examples use `@Name`.

Be consistent.

Dynamic SQL builder must understand placeholder naming.

---

## 25. SQL Server Identity and Generated IDs

SQL Server identity columns:

```sql
id BIGINT IDENTITY(1,1) PRIMARY KEY
```

To return inserted ID, prefer `OUTPUT`:

```sql
INSERT INTO users (email, name)
OUTPUT INSERTED.id
VALUES (@email, @name);
```

Go:

```go
var id int64
err := db.QueryRowContext(ctx, `
	INSERT INTO users (email, name)
	OUTPUT INSERTED.id
	VALUES (@email, @name)
`,
	sql.Named("email", email),
	sql.Named("name", name),
).Scan(&id)
```

Avoid relying on ambiguous identity retrieval patterns when `OUTPUT` is available.

---

## 26. SQL Server `OUTPUT` for Updates

Conditional update:

```sql
UPDATE cases
SET status = @to,
    version = version + 1,
    updated_at = SYSUTCDATETIME()
OUTPUT INSERTED.version
WHERE id = @id
  AND status = @from;
```

If no row, `Scan` returns `sql.ErrNoRows`.

This is similar in spirit to PostgreSQL `RETURNING`.

---

## 27. SQL Server Upsert

SQL Server has `MERGE`, but `MERGE` has a long history of caveats/bugs and concurrency surprises.

Safer patterns often use:

1. update then insert with transaction/locks;
2. insert and handle duplicate;
3. stored procedure with explicit locking;
4. staging table + controlled merge logic.

If using `MERGE`, follow current Microsoft guidance, test thoroughly, and understand concurrency behavior.

---

## 28. SQL Server Duplicate Key

Common error numbers:

| Error Number | Meaning |
|---:|---|
| 2627 | violation of primary key/unique constraint |
| 2601 | duplicate key row in unique index |

Map to:

```text
unique_violation / conflict
```

Driver error type extraction depends on `go-mssqldb`.

Keep SQL Server-specific mapping in infrastructure layer.

---

## 29. SQL Server Deadlock

Common error:

```text
1205 deadlock victim
```

Meaning:

- SQL Server chose this transaction as deadlock victim;
- transaction rolled back.

Application should:

- classify deadlock;
- retry whole transaction if safe;
- reduce lock contention;
- fix lock ordering/indexes if frequent.

---

## 30. SQL Server Lock Timeout

Common error:

```text
1222 lock request timeout period exceeded
```

This can happen if lock timeout set and exceeded.

Map to:

```text
lock_timeout
```

Retry only if operation is safe and bounded.

---

## 31. SQL Server Error Classification

Example classes:

| SQL Server Error | Class |
|---:|---|
| 2627 / 2601 | unique violation |
| 547 | foreign key/check constraint violation |
| 1205 | deadlock |
| 1222 | lock timeout |
| 208 | invalid object/table |
| 207 | invalid column |
| 102 | syntax error |
| 18456 | login failed |
| timeout from driver/context | deadline/connection |
| connection reset | connection |

Exact extraction:

- driver-specific error type;
- may include Number, State, Class, Message;
- use `errors.As`.

---

## 32. SQL Server Isolation

SQL Server supports several isolation levels:

- Read Uncommitted;
- Read Committed;
- Repeatable Read;
- Snapshot;
- Serializable;
- Read Committed Snapshot option at database level.

Important concepts:

- locking-based Read Committed by default in many systems;
- RCSI changes read behavior to row-versioning;
- Snapshot isolation must be enabled;
- Serializable can cause range locks;
- lock escalation can occur.

Go:

```go
db.BeginTx(ctx, &sql.TxOptions{
	Isolation: sql.LevelReadCommitted,
})
```

But DB options like RCSI are outside Go and must be known.

---

## 33. SQL Server Read Committed Snapshot

Read Committed Snapshot Isolation (RCSI) makes Read Committed use row versioning for reads.

Benefits:

- readers do not block writers as much;
- fewer read/write blocking incidents.

Trade-offs:

- tempdb version store pressure;
- behavior differs from lock-based reads;
- still need write conflict handling.

Ask DBA whether RCSI is enabled.

Do not assume.

---

## 34. SQL Server Rowversion

`rowversion` is useful for optimistic concurrency.

Schema:

```sql
row_version rowversion NOT NULL
```

Update:

```sql
UPDATE users
SET name = @name
WHERE id = @id
  AND row_version = @expected;
```

Check no row -> concurrent modification.

`rowversion` is binary, not timestamp.

In Go scan as `[]byte`.

---

## 35. SQL Server Locking Hints

SQL Server has hints:

- `UPDLOCK`;
- `HOLDLOCK`;
- `ROWLOCK`;
- `READPAST`;
- `NOLOCK`.

Use carefully.

`NOLOCK` / Read Uncommitted can read dirty/inconsistent data. Do not use as performance band-aid for correctness-sensitive reads.

Queue pattern may use `READPAST`, `UPDLOCK`, `ROWLOCK`, but must be tested.

---

## 36. SQL Server Queue Claim Pattern

Conceptual:

```sql
WITH cte AS (
    SELECT TOP (@limit) id
    FROM outbox_events WITH (UPDLOCK, READPAST, ROWLOCK)
    WHERE status = 'PENDING'
      AND next_attempt_at <= SYSUTCDATETIME()
    ORDER BY created_at, id
)
UPDATE outbox_events
SET status = 'PROCESSING',
    claimed_by = @worker,
    claimed_at = SYSUTCDATETIME()
OUTPUT INSERTED.id
FROM outbox_events
JOIN cte ON cte.id = outbox_events.id;
```

This is SQL Server-specific and needs DBA/testing review.

---

## 37. SQL Server Pagination

Offset:

```sql
ORDER BY updated_at DESC, id DESC
OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
```

Keyset:

```sql
WHERE tenant_id = @tenant
  AND (
      updated_at < @cursorUpdatedAt
      OR (updated_at = @cursorUpdatedAt AND id < @cursorID)
  )
ORDER BY updated_at DESC, id DESC;
```

Use deterministic order and indexes.

---

## 38. SQL Server Bulk Paths

Options:

- multi-row insert;
- table-valued parameters (TVP);
- bulk copy APIs;
- staging table + set-based merge/update;
- stored procedures.

For high-volume import:

```text
bulk load into staging
validate
merge/update target
record rejects
```

TVPs are useful for passing a set of rows/IDs to stored procedure/query.

Driver-specific support must be checked.

---

## 39. SQL Server Date/Time

Types:

- `datetime`;
- `datetime2`;
- `datetimeoffset`;
- `date`;
- `time`.

Prefer:

```text
datetime2 with UTC convention
```

or `datetimeoffset` if offset matters.

Use `SYSUTCDATETIME()` for DB UTC time.

Avoid old `datetime` precision surprises where possible.

---

## 40. SQL Server Decimal/Money

Avoid floating point for money.

Use:

```text
decimal(p,s)
```

or integer minor units.

Go:

- decimal library;
- string scan;
- integer cents if schema supports.

SQL Server `money` exists but has caveats; many systems prefer `decimal`.

---

## 41. SQL Server JSON

SQL Server stores JSON in text columns and provides JSON functions.

There is not the same JSONB type as PostgreSQL.

Design:

- validate JSON if needed;
- computed columns/indexes for JSON fields;
- avoid hot queries over arbitrary JSON;
- scan into `[]byte`/string/json.RawMessage.

---

## 42. SQL Server Production Checklist

- [ ] Use `github.com/microsoft/go-mssqldb`.
- [ ] DSN uses encryption settings intentionally.
- [ ] `app name`/application name set.
- [ ] Pool size budgeted.
- [ ] Placeholder/named parameter style consistent.
- [ ] Identity retrieval uses `OUTPUT INSERTED`.
- [ ] Duplicate/deadlock/lock timeout error classifier implemented.
- [ ] Isolation/RCSI/Snapshot database settings known.
- [ ] `NOLOCK` avoided unless explicitly safe.
- [ ] Queue locking hints reviewed/tested.
- [ ] Pagination deterministic.
- [ ] Bulk path selected intentionally.
- [ ] Execution plans reviewed for hot queries.
- [ ] Migration locking strategy known.
- [ ] Integration tests run against SQL Server/Azure SQL target.

---

# Bagian C — Oracle Database

---

## 43. Oracle: Kapan Cocok?

Oracle umum di:

- banking;
- insurance;
- government;
- telco;
- large enterprise;
- PL/SQL-heavy systems;
- existing legacy systems;
- high-end OLTP;
- systems requiring Oracle-specific features.

Go service mungkin mengakses Oracle untuk:

- modernization;
- integration layer;
- API wrapper over legacy schema;
- batch/reporting;
- migration bridge.

Oracle integration sering lebih operationally complex than PostgreSQL/MySQL because of client libraries, wallets, PL/SQL, LOBs, and enterprise deployment constraints.

---

## 44. Oracle Driver: `godror`

Common driver:

```text
github.com/godror/godror
```

Characteristics:

- `database/sql/driver` driver;
- uses ODPI-C;
- needs Oracle Client libraries at runtime;
- CGO required;
- cross-compilation/deployment more complex;
- supports Oracle-specific features through options.

Import:

```go
import _ "github.com/godror/godror"
```

Open:

```go
db, err := sql.Open("godror", `user="scott" password="tiger" connectString="dbhost:1521/orclpdb1"`)
```

---

## 45. Oracle Deployment Caveat

`godror` needs:

- CGO enabled;
- C compiler at build time;
- Oracle Client libraries at runtime;
- library path configured;
- wallet/config files if using Autonomous DB/TLS;
- correct OS image.

This affects:

- Docker images;
- CI/CD;
- cross-compilation;
- scratch/distroless images;
- Kubernetes deployment;
- local developer setup.

Plan deployment early.

---

## 46. Oracle DSN

godror data source is logfmt-like parameter list.

Example:

```text
user="app" password="secret" connectString="dbhost:1521/service_name"
```

Other common parameters may include:

- standaloneConnection;
- pool settings;
- connectionClass;
- heterogeneousPool;
- externalAuth;
- wallet-related config via Oracle client/network config;
- timeout options.

Always check target godror docs/version.

Do not log password.

---

## 47. Oracle Connect String

Common forms:

```text
host:port/service_name
```

or TNS alias if `tnsnames.ora` configured.

Important distinction:

- SID vs service name;
- PDB service in multitenant Oracle;
- RAC/SCAN address;
- wallet/TCPS for cloud/autonomous;
- load balancing/failover descriptors.

Go app developers often need DBA-provided connect string.

---

## 48. Oracle Pooling

There can be multiple pooling layers:

- Go `database/sql` pool;
- Oracle client/session pool;
- database server processes/sessions;
- DRCP if used.

Avoid configuring huge pools blindly.

Total sessions matter.

Set:

```go
db.SetMaxOpenConns(...)
db.SetMaxIdleConns(...)
db.SetConnMaxLifetime(...)
```

Coordinate with DBA.

---

## 49. Oracle Placeholder Style

Oracle commonly uses bind variables:

```sql
SELECT id, name
FROM users
WHERE tenant_id = :tenant_id
  AND status = :status
```

Go:

```go
rows, err := db.QueryContext(ctx, query,
	sql.Named("tenant_id", tenantID),
	sql.Named("status", status),
)
```

Bind variables are critical for performance and SQL injection prevention.

Do not string-concatenate values.

---

## 50. Oracle Generated IDs: Sequence and Identity

Traditional Oracle pattern:

```sql
CREATE SEQUENCE users_seq;
```

Insert:

```sql
INSERT INTO users (id, email)
VALUES (users_seq.NEXTVAL, :email)
RETURNING id INTO :id
```

Oracle also supports identity columns in modern versions.

But sequence remains common in legacy schemas.

---

## 51. Oracle `RETURNING INTO`

With Go and godror, OUT parameters are used.

Conceptual:

```go
var id int64

_, err := db.ExecContext(ctx, `
	INSERT INTO users (id, email)
	VALUES (users_seq.NEXTVAL, :email)
	RETURNING id INTO :id
`,
	sql.Named("email", email),
	sql.Named("id", sql.Out{Dest: &id}),
)
```

Exact behavior must be tested with godror.

This is Oracle equivalent to returning generated values.

---

## 52. Oracle Sequences Are Not Gapless

Like other DB sequence mechanisms, Oracle sequences can have gaps due to:

- rollback;
- cache;
- crash;
- concurrency;
- failed transactions.

Do not use sequence as legal gapless number.

Design gapless numbering separately if legally required.

---

## 53. Oracle Transaction and Isolation

Oracle commonly provides statement-level read consistency and transaction isolation levels such as Read Committed and Serializable.

Oracle default is typically Read Committed.

Important:

- readers do not block writers in typical MVCC/read consistency model;
- writers can block writers;
- Serializable can produce errors if serialization cannot be achieved;
- long transactions can stress undo.

Use `sql.TxOptions` where driver supports mapping, but verify behavior.

---

## 54. Oracle Locks

Oracle row locks occur on update/delete/select for update.

Example:

```sql
SELECT id, status
FROM cases
WHERE id = :id
FOR UPDATE
```

Options include:

```sql
FOR UPDATE NOWAIT
FOR UPDATE WAIT n
FOR UPDATE SKIP LOCKED
```

depending Oracle version.

Use for:

- queue claim;
- resource locking;
- user-facing busy response.

Keep transactions short.

---

## 55. Oracle Error Codes

Common Oracle errors:

| ORA Code | Meaning | App Class |
|---|---|---|
| ORA-00001 | unique constraint violated | conflict |
| ORA-00054 | resource busy and acquire with NOWAIT/time expired | lock timeout/busy |
| ORA-00060 | deadlock detected | deadlock/retry |
| ORA-08177 | cannot serialize access | serialization/retry |
| ORA-02291 | integrity constraint parent key not found | FK invalid reference |
| ORA-02292 | child record found | FK conflict |
| ORA-00942 | table or view does not exist | schema/permission |
| ORA-00904 | invalid identifier | schema/query bug |
| ORA-01017 | invalid username/password | auth/config |
| ORA-03113 / ORA-03114 | connection/session ended/not connected | connection |
| ORA-12154 / ORA-12514 | connect descriptor/service issues | config/network |

Use driver-specific error type extraction if available.

Keep mapping in infrastructure.

---

## 56. Oracle Classifier Concept

```go
func ClassifyOracle(err error) Classification {
	code, ok := ExtractOracleCode(err) // driver-specific
	if !ok {
		return Classification{Class: ClassUnknown}
	}

	switch code {
	case 1:
		return Classification{Class: ClassUniqueViolation}
	case 54:
		return Classification{Class: ClassLockTimeout, Retryable: true}
	case 60:
		return Classification{Class: ClassDeadlock, Retryable: true}
	case 8177:
		return Classification{Class: ClassSerializationFailure, Retryable: true}
	case 2291, 2292:
		return Classification{Class: ClassForeignKeyViolation}
	case 942, 904:
		return Classification{Class: ClassSyntaxOrSchema}
	case 1017:
		return Classification{Class: ClassPermissionDenied}
	default:
		return Classification{Class: ClassUnknown}
	}
}
```

Oracle errors are commonly shown as `ORA-00001`; numeric code is 1.

---

## 57. Oracle LOBs

Oracle has LOB types:

- CLOB;
- BLOB;
- NCLOB.

Handling LOBs can differ from simple string/[]byte scanning.

Concerns:

- streaming;
- memory usage;
- locator lifetime;
- transaction/connection lifetime;
- driver-specific options;
- large payload in list query.

Avoid selecting LOBs in listing endpoints.

Load LOB by ID/detail path.

---

## 58. Oracle REF CURSOR and PL/SQL

Legacy Oracle systems often expose stored procedures returning REF CURSOR.

godror supports database/sql patterns for OUT parameters and cursors.

Conceptually:

```go
var rows *sql.Rows

_, err := db.ExecContext(ctx, `
	BEGIN
		my_pkg.search_cases(:tenant_id, :out_cursor);
	END;
`,
	sql.Named("tenant_id", tenantID),
	sql.Named("out_cursor", sql.Out{Dest: &rows}),
)
```

Exact syntax/handling depends on driver docs and procedure signature.

Important:

- close returned rows;
- keep statement alive if required by driver docs;
- map errors;
- treat PL/SQL as part of data access boundary.

---

## 59. Oracle Array Binding

Oracle drivers often support array binding for high-throughput operations.

Use cases:

- bulk insert;
- PL/SQL array parameters;
- batch updates.

Benefits:

- fewer round trips;
- high throughput.

Cautions:

- driver-specific API/options;
- error per row handling;
- memory;
- array size tuning;
- transaction size.

For huge import, coordinate with DBA and test.

---

## 60. Oracle Bulk Paths

Options:

- array bind via godror;
- PL/SQL bulk collect/forall;
- SQL*Loader;
- external tables;
- staging table + merge;
- direct path insert;
- partition exchange for large loads.

In Go app, common robust pattern:

```text
load staging
validate
MERGE into target
record rejects
```

But Oracle-specific tooling may be better for very large enterprise loads.

---

## 61. Oracle MERGE

Oracle `MERGE` supports insert/update based on join condition.

Use carefully:

- source uniqueness;
- concurrent updates;
- triggers;
- error logging;
- audit/outbox semantics;
- constraints;
- execution plan.

For complex import, staging + MERGE is common.

---

## 62. Oracle Date/Time Types

Types:

- DATE;
- TIMESTAMP;
- TIMESTAMP WITH TIME ZONE;
- TIMESTAMP WITH LOCAL TIME ZONE.

Oracle `DATE` includes date and time to seconds, unlike some DBs where date is date-only.

Be precise.

Go mapping uses `time.Time`.

Define:

- UTC policy;
- session timezone;
- timestamp precision;
- user date range normalization.

---

## 63. Oracle Number

Oracle `NUMBER` can represent many numeric forms.

In Go:

- integer types for integer columns;
- decimal/string for exact decimals;
- avoid float for money;
- test scan precision/scale.

Schema should define precision and scale:

```sql
NUMBER(19, 0)
NUMBER(18, 2)
```

not unconstrained if app needs exact mapping.

---

## 64. Oracle Empty String Is NULL

Important Oracle semantic:

```text
empty string is treated as NULL
```

This surprises developers from PostgreSQL/MySQL.

Implications:

- inserting `""` into VARCHAR2 becomes NULL;
- unique constraints and nullable behavior;
- validation must distinguish absent/empty before DB;
- Go empty string may not round-trip as empty.

Design domain validation accordingly.

---

## 65. Oracle Pagination

Modern Oracle supports:

```sql
ORDER BY created_at DESC, id DESC
OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
```

Older systems use `ROWNUM`/analytic functions.

Keyset pagination still works:

```sql
WHERE tenant_id = :tenant
  AND (
      created_at < :cursor_created
      OR (created_at = :cursor_created AND id < :cursor_id)
  )
ORDER BY created_at DESC, id DESC
FETCH NEXT :limit ROWS ONLY
```

Test target Oracle version.

---

## 66. Oracle Queue Claim

Oracle supports locking clauses like `FOR UPDATE SKIP LOCKED` in many versions.

Pattern:

```sql
SELECT id
FROM outbox_events
WHERE status = 'PENDING'
  AND next_attempt_at <= SYSTIMESTAMP
ORDER BY created_at, id
FETCH NEXT :limit ROWS ONLY
FOR UPDATE SKIP LOCKED
```

Exact syntax order/version must be tested.

---

## 67. Oracle Explain Plan

Use Oracle tools:

- `EXPLAIN PLAN`;
- `DBMS_XPLAN.DISPLAY`;
- SQL Monitor in enterprise setups;
- AWR/ASH if licensed/available.

Go app should provide operation names and bind variable visibility where possible.

DBA collaboration is common in Oracle environments.

---

## 68. Oracle Production Checklist

- [ ] Oracle Client/Instant Client installed in runtime image.
- [ ] CGO build pipeline works.
- [ ] wallet/TNS config deployed securely if needed.
- [ ] DSN/connectString redacted in logs.
- [ ] pool/session count budgeted with DBA.
- [ ] bind variables used.
- [ ] sequence/identity strategy clear.
- [ ] `RETURNING INTO` tested.
- [ ] ORA error classifier implemented.
- [ ] LOB handling tested.
- [ ] REF CURSOR/PLSQL handling tested if used.
- [ ] empty string/NULL semantics handled.
- [ ] timestamp/timezone policy defined.
- [ ] bulk path selected intentionally.
- [ ] integration tests run against Oracle target.
- [ ] runbooks coordinated with DBA.

---

# Bagian D — Cross-Database Patterns

---

## 69. Placeholder Strategy

| Database | Placeholder Style |
|---|---|
| SQLite | `?` commonly |
| SQL Server | named / `@p1` / `@Name` |
| Oracle | `:name` / named bind |
| PostgreSQL | `$1` |
| MySQL/MariaDB | `?` |

If supporting multiple databases, create dialect layer.

But do not build a half-ORM unless needed.

```go
type Dialect interface {
	Placeholder(n int, name string) string
	LimitOffset(limitPH, offsetPH string) string
}
```

For one database, use native style directly.

---

## 70. Generated ID Strategy

| Database | Common Strategy |
|---|---|
| SQLite | `LastInsertId` / rowid |
| SQL Server | `OUTPUT INSERTED.id` |
| Oracle | sequence/identity + `RETURNING INTO` |
| PostgreSQL | `RETURNING` |
| MySQL | `LastInsertId` |

App-generated IDs can simplify cross-database code, idempotency, bulk insert, and outbox.

---

## 71. Upsert Strategy

| Database | Common Upsert |
|---|---|
| SQLite | `ON CONFLICT ... DO UPDATE` |
| SQL Server | cautious MERGE / update-then-insert / insert-handle-duplicate |
| Oracle | `MERGE` |
| PostgreSQL | `ON CONFLICT` |
| MySQL/MariaDB | `ON DUPLICATE KEY UPDATE` |

Upsert is not portable semantics. It must be reviewed per database.

---

## 72. Bulk Path Strategy

| Database | Bulk Path |
|---|---|
| SQLite | transaction batching |
| SQL Server | bulk copy / TVP / staging |
| Oracle | array bind / SQL*Loader / staging / MERGE |
| PostgreSQL | COPY / staging |
| MySQL | multi-row / LOAD DATA / staging |

Common robust enterprise pattern:

```text
staging table + validation + merge + reject report
```

---

## 73. Error Taxonomy Crosswalk

| Class | SQLite | SQL Server | Oracle |
|---|---|---|---|
| unique violation | constraint unique | 2627/2601 | ORA-00001 |
| FK violation | constraint foreign key | 547 | ORA-02291/02292 |
| deadlock | less common/locked | 1205 | ORA-00060 |
| lock timeout/busy | SQLITE_BUSY/LOCKED | 1222 | ORA-00054 |
| schema bug | SQLITE_SCHEMA/no table | 208/207/102 | ORA-00942/00904 |
| auth/config | file permission/read-only | login failed | ORA-01017/TNS |
| connection | file IO/corrupt/full | network/login/timeout | ORA-03113/12154/etc |

Do not expose raw DB error to user.

Map at data boundary.

---

## 74. Transaction Boundary Remains the Same

Regardless of DB:

```text
service/use-case owns transaction
repository receives DBTX/tx
driver-specific classifier maps low-level error
transport maps domain error
```

Do not let Oracle PL/SQL, SQL Server stored procedures, or SQLite simplicity destroy your boundary.

---

## 75. Testing Strategy Cross-Database

If supporting multiple databases:

- run integration test matrix per DB;
- avoid assuming SQL compatibility;
- test migrations per DB;
- test error mapping per DB;
- test time/null semantics per DB;
- test transaction/locking behavior per DB;
- test generated ID/upsert semantics per DB.

If supporting only one DB, do not over-abstract.

---

## 76. Migration Strategy Cross-Database

DDL differs dramatically.

Examples:

- SQLite ALTER TABLE limitations;
- SQL Server online index/metadata locks;
- Oracle edition-based redefinition/online operations;
- MySQL metadata locks;
- PostgreSQL concurrent indexes.

Migration tooling and rollback must be database-specific.

Do not assume generic migration file works for all.

---

## 77. Observability Cross-Database

Common app-level metrics:

```text
db_operation_duration_seconds{db_system, operation}
db_errors_total{db_system, error_class}
db_tx_duration_seconds{db_system, operation}
db_pool_in_use{db_system}
db_pool_wait_duration_seconds{db_system}
```

Database-specific observability:

| DB | Tools |
|---|---|
| SQLite | app logs, file size, busy errors, WAL size |
| SQL Server | DMVs, Query Store, deadlock graphs, wait stats |
| Oracle | V$ views, AWR/ASH, SQL Monitor, alert log |
| PostgreSQL | pg_stat_activity, pg_stat_statements, pg_locks |
| MySQL | Performance Schema, slow log, InnoDB status |

---

## 78. Runbook: SQLite `database is locked`

Actions:

1. check `SetMaxOpenConns`;
2. check unclosed rows;
3. check long transaction;
4. check WAL mode;
5. check busy timeout;
6. check external work inside transaction;
7. check multiple processes;
8. check network filesystem;
9. serialize writes;
10. reduce transaction duration.

---

## 79. Runbook: SQL Server Deadlock

Actions:

1. capture deadlock graph;
2. identify operations/tables/indexes;
3. check lock order;
4. inspect execution plan;
5. check missing index;
6. reduce transaction scope;
7. enable safe retry;
8. review isolation/RCSI;
9. coordinate with DBA.

---

## 80. Runbook: Oracle Connection Failure

Actions:

1. check Oracle Client libraries installed;
2. check `LD_LIBRARY_PATH`/library path;
3. check wallet/TNS config;
4. verify connect string/service name;
5. check firewall/listener;
6. check credentials;
7. check session limits;
8. inspect ORA code;
9. coordinate with DBA/cloud console.

---

## 81. Runbook: SQL Server Timeout

Questions:

- app context timeout or driver timeout?
- query timeout or connection timeout?
- blocking lock?
- slow plan?
- parameter sniffing?
- missing index?
- tempdb pressure?
- network/Azure issue?

Actions:

- inspect Query Store/DMVs;
- get execution plan;
- correlate app operation;
- add index/rewrite query;
- fix blocking;
- adjust timeout only after diagnosis.

---

## 82. Runbook: Oracle ORA-00001

Questions:

1. which constraint?
2. expected idempotency duplicate?
3. business conflict?
4. sequence/key collision?
5. retry duplicate?
6. data migration duplicate?

Actions:

- map to domain conflict;
- load existing if idempotency;
- fix source/dedupe;
- add tests;
- do not return raw constraint to user.

---

## 83. Runbook: SQLite Corruption / Disk Full

Actions:

1. stop writes;
2. backup current files;
3. check disk/filesystem;
4. run integrity check if appropriate;
5. restore from backup if needed;
6. inspect crash/power failure;
7. review synchronous/WAL/checkpoint settings;
8. improve backup strategy.

SQLite corruption/disk-full is an operational incident.

---

## 84. Security Notes

### SQLite

- DB file permissions matter.
- Encrypt at filesystem/application layer if needed.
- Do not store secrets in plaintext local DB unless protected.
- Protect backups.

### SQL Server

- use encryption;
- least privilege;
- avoid excessive grants;
- manage Azure AD/secrets;
- parameterize queries;
- avoid `NOLOCK` for sensitive correctness.

### Oracle

- wallet/secrets management;
- least privilege;
- audit;
- TCPS where required;
- PL/SQL permissions;
- protect client config files.

---

## 85. Anti-Patterns

| Anti-pattern | Database | Problem |
|---|---|---|
| SQLite with many writers and default pool | SQLite | lock storm |
| forgetting foreign_keys pragma | SQLite | integrity not enforced |
| DB file on unsafe network FS | SQLite | locking/corruption risk |
| `NOLOCK` everywhere | SQL Server | dirty/inconsistent reads |
| SQL Server `MERGE` blindly | SQL Server | concurrency/bug caveats |
| ignoring RCSI/Snapshot setting | SQL Server | wrong consistency assumptions |
| Oracle app image without Instant Client | Oracle | runtime failure |
| treating Oracle empty string as normal | Oracle | NULL bugs |
| selecting LOBs in list queries | Oracle | memory/performance |
| generic upsert abstraction | all | wrong semantics |
| no DB-specific error classifier | all | wrong retry/response |
| no real DB integration tests | all | false confidence |

---

## 86. Decision Matrix

| Need | Recommended |
|---|---|
| embedded local DB | SQLite |
| serverless local test DB | SQLite |
| Azure enterprise RDBMS | SQL Server/Azure SQL |
| stored procedure-heavy Microsoft estate | SQL Server |
| Oracle legacy integration | Oracle + godror |
| high-volume enterprise PL/SQL | Oracle |
| simple portable repository | `database/sql` |
| advanced DB-specific feature | driver-specific extension |
| multi-DB support | dialect layer + test matrix |
| high-volume import | staging + DB-native bulk path |

---

## 87. Example Package Layout

```text
/internal/platform/db
  open.go
  tx.go
  classifier.go

/internal/platform/sqlite
  open.go
  pragmas.go
  classifier.go

/internal/platform/sqlserver
  open.go
  classifier.go
  bulk.go

/internal/platform/oracle
  open.go
  classifier.go
  lob.go
  plsql.go

/internal/data/...
  repositories.go
```

Keep DB-specific code contained.

---

## 88. Repository Portability Advice

If you support one database:

```text
Use its features intentionally.
```

If you support multiple:

```text
Separate dialect-specific SQL.
Do not pretend syntax is portable.
Run tests against all supported DBs.
```

Portability is expensive.

Do not pay for it unless product requires it.

---

## 89. Exercises

### Exercise 1 — SQLite

A Go service using SQLite gets frequent `database is locked`.

Questions:

- What pool setting do you check first?
- What pragmas/settings might help?
- What code hygiene issue might cause it?

### Exercise 2 — SQL Server

You insert a row into identity table and need ID.

Question:

- What SQL Server feature can return generated ID safely?

### Exercise 3 — Oracle

Your Go binary runs locally but fails in Docker with Oracle library error.

Question:

- What runtime dependency is likely missing?

### Exercise 4 — Cross-DB Upsert

You want one generic `UpsertUser` SQL for SQLite, SQL Server, Oracle, PostgreSQL, and MySQL.

Question:

- Why is this dangerous?

### Exercise 5 — Error Mapping

SQL Server duplicate key, Oracle ORA-00001, and SQLite unique constraint should map to what app-level class?

### Exercise 6 — SQLite Foreign Keys

A SQLite test inserts invalid FK but no error occurs.

Question:

- What setting should you verify?

---

## 90. Jawaban Singkat Latihan

### Exercise 1

Check:

```go
db.SetMaxOpenConns(1)
```

Then check WAL mode, busy timeout, short transactions, unclosed rows, and external work inside transaction.

### Exercise 2

Use:

```sql
OUTPUT INSERTED.id
```

with `QueryRowContext(...).Scan(&id)`.

### Exercise 3

Likely missing Oracle Instant Client / Oracle Client libraries or library path configuration. `godror` needs Oracle Client libraries at runtime.

### Exercise 4

Upsert syntax and semantics differ:

- SQLite/PostgreSQL `ON CONFLICT`;
- MySQL `ON DUPLICATE KEY UPDATE`;
- SQL Server cautious `MERGE` or alternative;
- Oracle `MERGE`.

Conflict targeting, row count, triggers, concurrency, and stale update behavior differ.

### Exercise 5

Map all to:

```text
unique_violation / conflict
```

Then map to specific domain error depending operation/constraint.

### Exercise 6

Verify:

```sql
PRAGMA foreign_keys = ON;
```

and ensure it applies to the connection used by the test.

---

## 91. Ringkasan

SQLite, SQL Server, dan Oracle sama-sama bisa diakses dari Go melalui `database/sql`, tetapi production behavior mereka sangat berbeda.

Key lessons:

1. SQLite is embedded and file-lock based; pool/write concurrency must be controlled.
2. SQLite requires careful pragmas like foreign keys, WAL, and busy timeout.
3. SQL Server uses official `go-mssqldb`; encryption, named parameters, `OUTPUT`, isolation/RCSI, lock hints, and error numbers matter.
4. Oracle with `godror` requires CGO and Oracle Client runtime; DSN/wallet/client deployment is part of system design.
5. Oracle sequences, `RETURNING INTO`, LOBs, REF CURSOR, PL/SQL, and empty-string-as-NULL are common integration traps.
6. Upsert, generated IDs, bulk load, and error classification are database-specific.
7. Do not over-abstract portability unless you run real test matrices.
8. Keep DB-specific code isolated, but keep transaction/repository/error boundaries consistent.

If you remember one sentence:

> `database/sql` standardizes the pipe, not the database engine semantics.

---

## 92. Referensi

- Go package documentation — `database/sql`: <https://pkg.go.dev/database/sql>
- SQLite driver — `modernc.org/sqlite`: <https://pkg.go.dev/modernc.org/sqlite>
- SQLite driver — `mattn/go-sqlite3`: <https://pkg.go.dev/github.com/mattn/go-sqlite3>
- SQLite documentation — File Locking And Concurrency: <https://sqlite.org/lockingv3.html>
- SQLite documentation — Set A Busy Timeout: <https://sqlite.org/c3ref/busy_timeout.html>
- SQLite documentation — PRAGMA statements: <https://sqlite.org/pragma.html>
- Microsoft SQL Server driver — `go-mssqldb`: <https://pkg.go.dev/github.com/microsoft/go-mssqldb>
- Microsoft Learn — Golang driver for SQL Server: <https://learn.microsoft.com/en-us/sql/connect/golang/microsoft-go-mssqldb-driver>
- Oracle driver — `godror`: <https://pkg.go.dev/github.com/godror/godror>
- Oracle Developer — Working in Go applications with Oracle Database: <https://www.oracle.com/developer/working-in-go-applications-with-oracle-database-and-oracle-cloud-autonomous-database/>


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-sql-database-integration-part-027.md">⬅️ Specific Integration: MySQL / MariaDB</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-sql-database-integration-part-029.md">Migrations, Schema Versioning, and Deployment Coordination ➡️</a>
</div>
