# learn-go-sql-database-integration-part-005.md

# DSN, Connection Strings, and Configuration Hygiene

> Seri: `learn-go-sql-database-integration`  
> Part: `005`  
> Target pembaca: Java software engineer yang ingin menguasai integrasi database di Go secara production-grade  
> Target Go: Go 1.26.x  
> Fokus: cara mendesain konfigurasi koneksi database yang aman, eksplisit, tervalidasi, observable, dan sesuai realitas production

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami apa itu DSN / connection string dalam konteks Go `database/sql`.
2. Membedakan konfigurasi driver, konfigurasi session database, konfigurasi pool, dan konfigurasi aplikasi.
3. Mendesain konfigurasi database yang aman dari kebocoran credential.
4. Membangun DSN secara typed dan tervalidasi, bukan string concat sembarangan.
5. Menentukan parameter penting seperti SSL/TLS, timezone, timeout, application name, charset, dan schema/search path.
6. Memahami perbedaan connection string PostgreSQL, MySQL, SQLite, SQL Server, dan Oracle.
7. Menyusun konfigurasi per environment: local, CI, staging, production.
8. Membuat redacted logging untuk database config tanpa membocorkan password/token.
9. Menentukan mana yang sebaiknya masuk DSN, mana yang sebaiknya masuk `sql.DB` pool setting, dan mana yang sebaiknya menjadi SQL/session initialization.
10. Menghindari failure mode umum: wrong timezone, TLS disabled, password leak, infinite dial, config drift, dan session state tidak konsisten.

---

## 2. Core Mental Model

DSN bukan hanya “alamat database”. DSN adalah **contract antara aplikasi, driver, network, dan database server**.

Di Java, kamu sering melihat konfigurasi seperti ini:

```properties
spring.datasource.url=jdbc:postgresql://db:5432/app
spring.datasource.username=app_user
spring.datasource.password=secret
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.max-lifetime=1800000
```

Di Go, terutama dengan `database/sql`, bentuknya lebih eksplisit:

```go
db, err := sql.Open("postgres", dsn)
if err != nil {
    return err
}

db.SetMaxOpenConns(20)
db.SetMaxIdleConns(10)
db.SetConnMaxLifetime(30 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
```

Perbedaan pentingnya:

| Concern | Java/Spring/HikariCP | Go `database/sql` |
|---|---|---|
| URL/DSN | `spring.datasource.url` | driver-specific DSN string/config |
| Username/password | property terpisah atau embedded | sering embedded di DSN atau driver config |
| Pool config | HikariCP properties | method di `*sql.DB` |
| Validation | boot-time auto config | harus eksplisit dengan `PingContext` |
| Secret hiding | framework logging support | harus kamu desain sendiri |
| Session config | connection init SQL / URL params | DSN params atau explicit init logic |
| Driver abstraction | JDBC | `database/sql/driver` |

Mental model yang benar:

```mermaid
flowchart TD
    A[Application Config] --> B[Typed DBConfig]
    B --> C[Validation]
    C --> D[Driver Config / DSN]
    D --> E[sql.Open / sql.OpenDB]
    E --> F[*sql.DB Pool Handle]
    F --> G[Physical Connections]
    G --> H[Database Sessions]

    B --> I[Pool Settings]
    I --> F

    B --> J[Redacted Config Log]
    J --> K[Observability / Startup Event]

    B --> L[Secret Source]
    L --> C
```

`DSN` seharusnya diperlakukan sebagai **compiled output** dari konfigurasi typed, bukan konfigurasi utama yang disusun dengan string manual di banyak tempat.

---

## 3. Apa Itu DSN?

DSN adalah **Data Source Name**. Dalam praktik Go, istilah ini dipakai untuk string atau format konfigurasi yang diberikan ke driver agar driver tahu cara membuka koneksi database.

Contoh DSN PostgreSQL URL style:

```text
postgres://app_user:secret@db.example.com:5432/appdb?sslmode=require&application_name=case-service
```

Contoh PostgreSQL keyword/value style:

```text
host=db.example.com port=5432 user=app_user password=secret dbname=appdb sslmode=require application_name=case-service
```

Contoh MySQL style:

```text
app_user:secret@tcp(db.example.com:3306)/appdb?parseTime=true&timeout=3s&readTimeout=5s&writeTimeout=5s&tls=true
```

Contoh SQLite:

```text
file:app.db?_foreign_keys=on&_busy_timeout=5000
```

Contoh Oracle-style connect description bisa sangat berbeda, misalnya menggunakan connect string/service name.

Intinya: **DSN tidak portable antar-driver**.

`database/sql` sengaja tidak mencoba menstandarkan format DSN karena format koneksi setiap database berbeda.

---

## 4. Layer Konfigurasi Database

Konfigurasi database production biasanya memiliki beberapa layer.

```mermaid
flowchart LR
    A[Secret Layer] --> B[Connection Identity]
    B --> C[Network Routing]
    C --> D[Wire Protocol]
    D --> E[Database Session]
    E --> F[Pool Control]
    F --> G[Observability]
    G --> H[Operational Policy]
```

### 4.1 Secret Layer

Berisi:

- username
- password
- token
- wallet path
- client certificate
- private key
- cloud IAM credential

Aturan:

- Jangan hard-code credential di source code.
- Jangan commit `.env` production.
- Jangan log DSN mentah.
- Jangan masukkan password ke error message.
- Jangan tampilkan password di `/debug/config`, metrics label, trace attribute, atau panic output.

### 4.2 Connection Identity

Berisi:

- host
- port
- database name
- schema
- service name
- user
- role
- application name

Ini menjawab: “Aplikasi ini connect sebagai siapa, ke database mana, dan untuk tujuan apa?”

### 4.3 Network Routing

Berisi:

- host
- port
- Unix socket path
- proxy endpoint
- DNS name
- private link endpoint
- read replica endpoint
- primary endpoint
- region/zone routing

Ini menjawab: “Traffic pergi lewat jalur mana?”

### 4.4 Wire Protocol / Driver Behavior

Berisi:

- SSL/TLS mode
- connect timeout
- read timeout
- write timeout
- compression
- statement cache mode
- prepared statement behavior
- protocol feature toggles

Ini menjawab: “Bagaimana driver bicara dengan database?”

### 4.5 Database Session

Berisi:

- timezone
- search path/schema
- isolation default
- statement timeout
- lock timeout
- application name
- date format
- language/locale
- role switching

Ini menjawab: “Setelah koneksi terbuka, session database berada dalam keadaan apa?”

### 4.6 Pool Control

Berisi:

- max open connections
- max idle connections
- max connection lifetime
- max connection idle time

Ini **bukan DSN concern** dalam `database/sql`. Ini dikonfigurasi di `*sql.DB`.

### 4.7 Observability

Berisi:

- redacted startup log
- DB config fingerprint
- application name
- connection pool metrics
- trace attributes
- slow query labels
- error classification

### 4.8 Operational Policy

Berisi:

- fail-fast atau lazy connection
- retry policy
- readiness behavior
- degraded mode
- migration ownership
- rotation strategy
- secret reload strategy

---

## 5. Golden Rule: Jangan Treat DSN sebagai Plain String Sembarangan

Anti-pattern:

```go
dsn := user + ":" + pass + "@tcp(" + host + ":" + port + ")/" + db + "?parseTime=true"
```

Masalah:

1. Password dengan karakter khusus bisa merusak format DSN.
2. Host/port tidak tervalidasi.
3. Parameter duplikat sulit dikontrol.
4. Redaction sulit.
5. Default tidak eksplisit.
6. Test coverage terhadap config lemah.
7. Risiko credential leak tinggi.

Lebih baik:

- definisikan struct config typed
- validasi field wajib
- gunakan builder library/driver config bila tersedia
- pisahkan raw secret dari redacted representation
- tulis unit test untuk DSN builder

---

## 6. Typed Configuration Pattern

Contoh baseline config generic:

```go
package dbconfig

import (
    "errors"
    "fmt"
    "net"
    "time"
)

type Driver string

const (
    DriverPostgres Driver = "postgres"
    DriverMySQL    Driver = "mysql"
    DriverSQLite   Driver = "sqlite"
    DriverOracle   Driver = "oracle"
)

type PoolConfig struct {
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxLifetime time.Duration
    ConnMaxIdleTime time.Duration
}

type TimeoutConfig struct {
    ConnectTimeout time.Duration
    ReadTimeout    time.Duration
    WriteTimeout   time.Duration
    PingTimeout    time.Duration
}

type TLSConfig struct {
    Enabled            bool
    Mode               string
    CAFile             string
    CertFile           string
    KeyFile            string
    ServerName         string
    InsecureSkipVerify bool
}

type DBConfig struct {
    Driver      Driver
    Host        string
    Port        int
    Database    string
    Schema      string
    Username    string
    Password    string
    Application string
    Timezone    string
    TLS         TLSConfig
    Timeout     TimeoutConfig
    Pool        PoolConfig
    Params      map[string]string
}

func (c DBConfig) Validate() error {
    if c.Driver == "" {
        return errors.New("db driver is required")
    }

    switch c.Driver {
    case DriverPostgres, DriverMySQL, DriverOracle:
        if c.Host == "" {
            return errors.New("db host is required")
        }
        if c.Port <= 0 || c.Port > 65535 {
            return fmt.Errorf("db port out of range: %d", c.Port)
        }
        if c.Username == "" {
            return errors.New("db username is required")
        }
        if c.Database == "" && c.Driver != DriverOracle {
            return errors.New("db name is required")
        }
    case DriverSQLite:
        if c.Database == "" {
            return errors.New("sqlite database path is required")
        }
    default:
        return fmt.Errorf("unsupported db driver: %q", c.Driver)
    }

    if c.Application == "" {
        return errors.New("db application name is required")
    }

    if c.Pool.MaxOpenConns < 0 || c.Pool.MaxIdleConns < 0 {
        return errors.New("pool values must not be negative")
    }

    if c.Pool.MaxOpenConns > 0 && c.Pool.MaxIdleConns > c.Pool.MaxOpenConns {
        return errors.New("max idle conns must not exceed max open conns")
    }

    return nil
}

func (c DBConfig) Address() string {
    if c.Port == 0 {
        return c.Host
    }
    return net.JoinHostPort(c.Host, fmt.Sprintf("%d", c.Port))
}
```

Config typed memberi beberapa keuntungan:

- compile-time structure
- validasi terpusat
- default eksplisit
- redaction mudah
- testing mudah
- mapping environment variable lebih rapi
- config drift lebih mudah dideteksi

---

## 7. Secret Redaction

DSN sering mengandung password. Karena itu, setiap config harus punya bentuk redacted.

Contoh:

```go
func (c DBConfig) RedactedSummary() map[string]any {
    return map[string]any{
        "driver":              c.Driver,
        "host":                c.Host,
        "port":                c.Port,
        "database":            c.Database,
        "schema":              c.Schema,
        "username":            c.Username,
        "password_set":        c.Password != "",
        "password":            "<redacted>",
        "application":         c.Application,
        "timezone":            c.Timezone,
        "tls_enabled":         c.TLS.Enabled,
        "tls_mode":            c.TLS.Mode,
        "connect_timeout_ms":  c.Timeout.ConnectTimeout.Milliseconds(),
        "read_timeout_ms":     c.Timeout.ReadTimeout.Milliseconds(),
        "write_timeout_ms":    c.Timeout.WriteTimeout.Milliseconds(),
        "ping_timeout_ms":     c.Timeout.PingTimeout.Milliseconds(),
        "max_open_conns":      c.Pool.MaxOpenConns,
        "max_idle_conns":      c.Pool.MaxIdleConns,
        "conn_lifetime_ms":    c.Pool.ConnMaxLifetime.Milliseconds(),
        "conn_idle_time_ms":   c.Pool.ConnMaxIdleTime.Milliseconds(),
    }
}
```

Jangan log:

```go
logger.Info("connecting to database", "dsn", dsn) // buruk
```

Lebih aman:

```go
logger.Info("database configuration loaded", "db", cfg.RedactedSummary())
```

### 7.1 Apa yang Harus Dianggap Sensitive?

| Field | Sensitive? | Catatan |
|---|---:|---|
| password | Ya | Selalu redacted |
| token | Ya | Selalu redacted |
| private key path | Ya/semi | Path bisa bocorkan infra layout |
| wallet path | Ya/semi | Terutama Oracle wallet |
| username | Tergantung | Biasanya boleh, tapi bisa dianggap sensitive di beberapa org |
| host | Tergantung | Internal hostname bisa sensitive |
| database name | Tergantung | Bisa mengandung tenant/env info |
| application name | Biasanya tidak | Berguna untuk observability |
| timeout | Tidak | Aman |
| pool size | Tidak | Aman |

Untuk organisasi regulated, treat host/database/schema sebagai **internal metadata**, bukan public info.

---

## 8. Where Configuration Belongs

Tidak semua konfigurasi harus masuk DSN.

| Concern | Tempat ideal |
|---|---|
| host/port/db/user/password | DSN atau driver config |
| SSL/TLS mode | DSN atau driver config |
| connect/read/write timeout | driver config / DSN, tergantung driver |
| pool max open/idle/lifetime | `*sql.DB` methods |
| ping timeout | context saat `PingContext` |
| statement timeout | database session param atau query-level context |
| lock timeout | database session param atau explicit SQL |
| application name | DSN/session param bila didukung |
| timezone | DSN/session param bila didukung |
| schema/search path | DSN/session param atau explicit qualified SQL |
| migration version table | migration tool config |
| query timeout budget | caller context |
| retry policy | repository/service layer, bukan DSN |

Mermaid model:

```mermaid
flowchart TD
    A[DBConfig] --> B[Driver DSN]
    A --> C[sql.DB Pool Settings]
    A --> D[Ping Context Timeout]
    A --> E[Session Initialization]
    A --> F[Observability Metadata]

    B --> B1[host]
    B --> B2[user/password]
    B --> B3[tls]
    B --> B4[connect/read/write timeout]

    C --> C1[SetMaxOpenConns]
    C --> C2[SetMaxIdleConns]
    C --> C3[SetConnMaxLifetime]
    C --> C4[SetConnMaxIdleTime]

    E --> E1[timezone]
    E --> E2[search_path/schema]
    E --> E3[statement_timeout]
    E --> E4[lock_timeout]
```

---

## 9. PostgreSQL Connection Configuration

PostgreSQL umumnya mendukung dua style connection string:

1. URL style
2. keyword/value style

### 9.1 URL Style

```text
postgres://app_user:secret@postgres.internal:5432/case_db?sslmode=require&application_name=case-service
```

Komponen:

| Komponen | Makna |
|---|---|
| `postgres://` | scheme |
| `app_user` | username |
| `secret` | password |
| `postgres.internal` | host |
| `5432` | port |
| `case_db` | database name |
| `sslmode=require` | TLS mode |
| `application_name=case-service` | nama app terlihat di PostgreSQL |

### 9.2 Keyword/Value Style

```text
host=postgres.internal port=5432 user=app_user password=secret dbname=case_db sslmode=require application_name=case-service
```

Keyword style familiar untuk libpq-style environment, tapi raw string-nya mudah salah quoting bila ada karakter khusus.

### 9.3 Building PostgreSQL DSN with `net/url`

```go
package dbconfig

import (
    "net/url"
    "strconv"
    "time"
)

func BuildPostgresURL(c DBConfig) (string, error) {
    if err := c.Validate(); err != nil {
        return "", err
    }

    u := url.URL{
        Scheme: "postgres",
        User:   url.UserPassword(c.Username, c.Password),
        Host:   c.Address(),
        Path:   c.Database,
    }

    q := u.Query()

    if c.TLS.Mode != "" {
        q.Set("sslmode", c.TLS.Mode)
    } else if c.TLS.Enabled {
        q.Set("sslmode", "require")
    } else {
        q.Set("sslmode", "disable")
    }

    if c.Application != "" {
        q.Set("application_name", c.Application)
    }

    if c.Timezone != "" {
        q.Set("timezone", c.Timezone)
    }

    if c.Schema != "" {
        // PostgreSQL uses search_path. Some drivers support it as runtime parameter.
        q.Set("search_path", c.Schema)
    }

    if c.Timeout.ConnectTimeout > 0 {
        // PostgreSQL/libpq-style connect_timeout is normally seconds.
        seconds := int(c.Timeout.ConnectTimeout.Round(time.Second) / time.Second)
        if seconds <= 0 {
            seconds = 1
        }
        q.Set("connect_timeout", strconv.Itoa(seconds))
    }

    for k, v := range c.Params {
        q.Set(k, v)
    }

    u.RawQuery = q.Encode()
    return u.String(), nil
}
```

### 9.4 Using pgx Config Instead of Raw DSN Everywhere

Dengan `pgx`, kamu bisa parse connection string lalu modifikasi config sebelum membuka database handle.

```go
package dbopen

import (
    "context"
    "database/sql"
    "time"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/stdlib"
)

func OpenPostgresWithPGX(ctx context.Context, dsn string, pool PoolConfig) (*sql.DB, error) {
    pgxCfg, err := pgx.ParseConfig(dsn)
    if err != nil {
        return nil, err
    }

    if pgxCfg.RuntimeParams == nil {
        pgxCfg.RuntimeParams = map[string]string{}
    }
    pgxCfg.RuntimeParams["application_name"] = "case-service"
    pgxCfg.RuntimeParams["statement_timeout"] = "5000" // milliseconds in PostgreSQL
    pgxCfg.RuntimeParams["lock_timeout"] = "2000"

    db := stdlib.OpenDB(*pgxCfg)

    db.SetMaxOpenConns(pool.MaxOpenConns)
    db.SetMaxIdleConns(pool.MaxIdleConns)
    db.SetConnMaxLifetime(pool.ConnMaxLifetime)
    db.SetConnMaxIdleTime(pool.ConnMaxIdleTime)

    pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    if err := db.PingContext(pingCtx); err != nil {
        _ = db.Close()
        return nil, err
    }

    return db, nil
}
```

### 9.5 PostgreSQL Parameters Worth Thinking About

| Parameter | Why it matters |
|---|---|
| `sslmode` | Security posture. Production should rarely be `disable`. |
| `application_name` | Makes DB activity attributable. Useful in `pg_stat_activity`. |
| `connect_timeout` | Prevents long dial hang. |
| `search_path` | Can reduce SQL verbosity but creates hidden schema dependency. |
| `timezone` | Prevents inconsistent time interpretation. |
| `statement_timeout` | Prevents runaway queries at DB side. |
| `lock_timeout` | Prevents waiting forever on locks. |
| `target_session_attrs` | Useful when distinguishing primary/read-write endpoints. |

### 9.6 PostgreSQL Search Path Warning

Using `search_path` is convenient:

```sql
SELECT * FROM cases;
```

But explicit schema is more defensible for enterprise systems:

```sql
SELECT * FROM enforcement.cases;
```

Risk of `search_path`:

- wrong schema after migration
- security issue if untrusted schema appears earlier
- harder query review
- surprise behavior in tests
- hidden dependency in session state

Rule of thumb:

- Use explicit schema in critical SQL.
- Use `search_path` only when team has strict DB ownership and migration discipline.
- Log effective schema/search path at startup if relied upon.

---

## 10. MySQL / MariaDB Connection Configuration

MySQL DSN style with `go-sql-driver/mysql` commonly looks like:

```text
app_user:secret@tcp(mysql.internal:3306)/case_db?parseTime=true&loc=UTC&timeout=3s&readTimeout=5s&writeTimeout=5s&tls=true
```

### 10.1 Key MySQL DSN Parameters

| Parameter | Purpose |
|---|---|
| `parseTime=true` | Scan `DATE`/`DATETIME` into `time.Time` instead of raw bytes/string-like behavior. |
| `loc=UTC` | Time location used by driver. |
| `timeout=3s` | Dial/connect timeout. |
| `readTimeout=5s` | I/O read timeout. |
| `writeTimeout=5s` | I/O write timeout. |
| `tls=true` | Enable TLS mode depending on driver config. |
| `charset=utf8mb4` | Character set. |
| `collation=utf8mb4_0900_ai_ci` | Collation choice. |
| `interpolateParams=true` | Can reduce round trips in some cases, but must be evaluated carefully. |
| `multiStatements=true` | Usually avoid unless truly needed because it changes SQL execution risk. |

### 10.2 Use `mysql.Config` Instead of Manual String Concatenation

```go
package dbconfig

import (
    "time"

    mysql "github.com/go-sql-driver/mysql"
)

func BuildMySQLDSN(c DBConfig) (string, error) {
    if err := c.Validate(); err != nil {
        return "", err
    }

    loc := time.UTC
    if c.Timezone != "" && c.Timezone != "UTC" {
        loaded, err := time.LoadLocation(c.Timezone)
        if err != nil {
            return "", err
        }
        loc = loaded
    }

    cfg := mysql.Config{
        User:         c.Username,
        Passwd:       c.Password,
        Net:          "tcp",
        Addr:         c.Address(),
        DBName:       c.Database,
        ParseTime:    true,
        Loc:          loc,
        Timeout:      c.Timeout.ConnectTimeout,
        ReadTimeout:  c.Timeout.ReadTimeout,
        WriteTimeout: c.Timeout.WriteTimeout,
        TLSConfig:    mysqlTLSMode(c),
        Params: map[string]string{
            "charset": "utf8mb4",
        },
    }

    if c.Application != "" {
        // MySQL does not use application_name like PostgreSQL in the same general way,
        // but custom session variables or connection attributes may be available depending on driver/server.
        cfg.Params["application_name"] = c.Application
    }

    for k, v := range c.Params {
        cfg.Params[k] = v
    }

    return cfg.FormatDSN(), nil
}

func mysqlTLSMode(c DBConfig) string {
    if !c.TLS.Enabled {
        return "false"
    }
    if c.TLS.Mode != "" {
        return c.TLS.Mode
    }
    return "true"
}
```

### 10.3 MySQL Timezone Discipline

Bad:

```text
parseTime=false
loc=Local
```

Production risks:

- application container timezone differs from DB server timezone
- daylight saving time surprises
- inconsistent test vs production behavior
- audit timestamps difficult to compare

Better baseline:

```text
parseTime=true&loc=UTC
```

And in application/domain:

- store instant timestamps in UTC
- convert to user timezone at presentation boundary
- avoid using DB server local time unless intentionally chosen

### 10.4 MySQL Charset Discipline

For modern applications, `utf8mb4` should be the normal baseline, not MySQL’s historical `utf8` alias behavior.

Recommended config direction:

```text
charset=utf8mb4
```

Also align with table/database collation. Driver-level charset cannot fix bad schema collation choices.

---

## 11. SQLite Configuration

SQLite is not “just a test DB”. It can be a serious embedded database, but its operational model is different from client/server DB.

Typical DSN examples:

```text
file:local.db?_foreign_keys=on&_busy_timeout=5000
```

or in-memory:

```text
file:memdb1?mode=memory&cache=shared
```

Important concerns:

| Concern | Meaning |
|---|---|
| file path | DB is local file-backed unless memory mode |
| foreign keys | often must be explicitly enabled depending on driver/settings |
| busy timeout | prevents immediate failure when DB is locked |
| WAL mode | improves concurrent read/write behavior but must be configured intentionally |
| max open conns | for SQLite, pool size can create lock contention if misused |

SQLite production-ish rule:

- For embedded single-process apps, SQLite can be excellent.
- For horizontally scaled services, SQLite is usually the wrong primary shared database.
- For tests, SQLite is not always a faithful replacement for PostgreSQL/MySQL due to type/isolation/SQL differences.

---

## 12. SQL Server Configuration Notes

SQL Server Go drivers commonly use URL-style connection strings, for example:

```text
sqlserver://app_user:secret@sqlserver.internal:1433?database=case_db&encrypt=true&app+name=case-service
```

Production concerns:

- encryption setting
- certificate validation
- database name parameter
- application name
- connection timeout
- integrated auth or username/password mode
- Always On / failover partner settings
- parameter syntax differences
- transaction isolation defaults

SQL Server often has stronger enterprise environment coupling: AD, integrated auth, encryption policy, and named instances. Do not assume PostgreSQL/MySQL style config maps directly.

---

## 13. Oracle Configuration Notes

Oracle configuration can involve:

- username/password
- connect string
- service name
- SID
- wallet
- Oracle Client / Instant Client
- TNS alias
- environment variables
- session parameters

Example conceptual shape:

```text
user="app_user" password="secret" connectString="dbhost:1521/ORCLPDB1"
```

Important Oracle-specific concerns:

| Concern | Why it matters |
|---|---|
| Oracle Client / ODPI-C | Some drivers rely on native client libraries. |
| Wallet | Often used for cloud/autonomous DB secure connection. |
| Session state | NLS settings, current schema, module/action can matter. |
| CLOB/BLOB behavior | Large object handling has driver-specific performance semantics. |
| Service name vs SID | Misconfiguration causes confusing connection errors. |
| Connection lifetime | Important with firewalls, DB restarts, and cloud infra. |

For Oracle-heavy enterprise systems, connection configuration should be treated as infrastructure contract, not simple app property.

---

## 14. Timeout Configuration: The Most Common Production Gap

There are several different timeouts. Do not collapse them into one vague “database timeout”.

```mermaid
sequenceDiagram
    participant App as Go Application
    participant Pool as sql.DB Pool
    participant Driver as DB Driver
    participant Net as Network
    participant DB as Database

    App->>Pool: QueryContext(ctx)
    Pool->>Pool: wait for available connection
    Pool->>Driver: use or open connection
    Driver->>Net: dial if needed
    Net->>DB: establish TCP/TLS/session
    DB->>DB: parse/plan/execute
    DB-->>Driver: rows/result
    Driver-->>Pool: release connection when done
    Pool-->>App: return result/error
```

Timeout categories:

| Timeout | Where applied | Protects against |
|---|---|---|
| request deadline | caller context | end-to-end latency budget |
| pool wait timeout | context while waiting for connection | pool starvation |
| connect timeout | driver/network | hanging dial |
| TLS handshake timeout | driver/network | stuck handshake |
| read timeout | driver/network | stuck socket read |
| write timeout | driver/network | stuck socket write |
| statement timeout | database server | runaway query execution |
| lock timeout | database server | waiting too long for locks |
| transaction timeout | application policy | long-held transaction |

### 14.1 Bad Timeout Design

```go
ctx := context.Background()
rows, err := db.QueryContext(ctx, query)
```

Risk:

- request may hang indefinitely depending on driver/server/network behavior
- pool connection may be held too long
- caller cancellation ignored
- hard to distinguish slow query vs pool wait

### 14.2 Better Timeout Design

```go
func FindCaseByID(ctx context.Context, db *sql.DB, id string) (Case, error) {
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    row := db.QueryRowContext(ctx, `
        SELECT id, status, created_at
        FROM enforcement.cases
        WHERE id = $1
    `, id)

    var c Case
    if err := row.Scan(&c.ID, &c.Status, &c.CreatedAt); err != nil {
        return Case{}, err
    }
    return c, nil
}
```

But be careful: nested fixed timeout can accidentally shrink or override upstream budgets. In larger systems, prefer budget derivation.

### 14.3 Budget-Aware Timeout Helper

```go
func WithDBBudget(parent context.Context, max time.Duration) (context.Context, context.CancelFunc) {
    if deadline, ok := parent.Deadline(); ok {
        remaining := time.Until(deadline)
        if remaining <= 0 {
            ctx, cancel := context.WithCancel(parent)
            cancel()
            return ctx, func() {}
        }
        if remaining < max {
            return context.WithTimeout(parent, remaining)
        }
    }
    return context.WithTimeout(parent, max)
}
```

Use:

```go
ctx, cancel := WithDBBudget(ctx, 2*time.Second)
defer cancel()
```

---

## 15. TLS / SSL Configuration

Production database traffic often crosses network boundaries where TLS is required by policy.

Common bad default:

```text
sslmode=disable
```

This is acceptable for local development but dangerous if silently used in production.

### 15.1 TLS Mode Policy

Suggested environment baseline:

| Environment | TLS stance |
|---|---|
| local docker | allow disable, but explicit |
| CI integration test | allow disable only for disposable DB |
| dev shared | require TLS if infra supports it |
| staging/UAT | same as production |
| production | require TLS and validate server identity where possible |

### 15.2 Config Validation Example

```go
func (c DBConfig) ValidateSecurity(env string) error {
    if env == "production" || env == "staging" {
        if !c.TLS.Enabled {
            return errors.New("database TLS must be enabled outside local/CI")
        }
        if c.TLS.InsecureSkipVerify {
            return errors.New("database TLS must verify server identity outside local/CI")
        }
    }
    return nil
}
```

### 15.3 Certificate Path Handling

If DSN references certificate file paths:

```text
sslrootcert=/etc/db/ca.pem
sslcert=/etc/db/client.pem
sslkey=/etc/db/client-key.pem
```

Then startup validation should check:

- file exists
- file readable
- private key permission acceptable
- path not accidentally logged
- mounted secret refresh behavior known

---

## 16. Application Name and Attribution

`application_name` or equivalent connection metadata is operationally important.

Without it, DBAs see many anonymous connections.

With it, DB activity can be attributed:

```text
application_name=case-service-api
application_name=case-service-worker
application_name=case-service-migration
```

Do not use one generic name for all workloads.

Recommended naming:

```text
<system>-<component>-<workload>
```

Examples:

```text
aceas-case-api
aceas-case-worker
aceas-case-migration
aceas-report-exporter
```

Why it matters:

- slow query attribution
- pool incident analysis
- DB session kill decisions
- migration lock investigation
- cost/performance ownership
- auditability

---

## 17. Timezone and Temporal Hygiene

Database config must define time behavior explicitly.

Common production bugs:

1. DB server runs in local time.
2. App container runs in UTC.
3. Developer laptop runs Asia/Jakarta.
4. Test expects date boundary in local time.
5. API serializes timestamp with missing timezone.
6. Database stores `timestamp without time zone` but app treats it as instant.

### 17.1 Baseline Rule

For distributed systems:

- store instants in UTC
- use `time.Time` carefully
- avoid local timezone in persistence layer
- convert timezone at presentation/reporting boundary
- be explicit about `timestamp with time zone` vs `timestamp without time zone`

### 17.2 Config Rule

PostgreSQL:

```text
timezone=UTC
```

MySQL:

```text
parseTime=true&loc=UTC
```

App:

```go
now := time.Now().UTC()
```

### 17.3 Regulatory Workflow Warning

For enforcement/case management systems, date semantics are often legally meaningful.

Different concepts must not be mixed:

| Concept | Example | Should it be instant? |
|---|---|---:|
| event occurred at | inspection submitted at 2026-06-23T10:03Z | Yes |
| due date | response due on 2026-07-01 | Usually date-only/domain timezone |
| SLA cutoff | 5 working days from receipt | Business calendar aware |
| display timestamp | shown to officer in local timezone | Presentation concern |
| audit timestamp | append-only system timestamp | Yes, UTC instant |

DSN timezone only solves part of the problem. Domain modelling must still be correct.

---

## 18. Schema, Search Path, and Multi-Tenant Concerns

Schema configuration is deceptively dangerous.

Options:

1. Put schema in SQL explicitly.
2. Put schema in session `search_path` / current schema.
3. Use separate database per tenant/module.
4. Use separate role with default schema.

### 18.1 Explicit Schema

```sql
SELECT id, status
FROM enforcement.cases
WHERE id = $1
```

Pros:

- clear
- reviewable
- less hidden session dependency
- safer for migrations

Cons:

- verbose
- harder to reuse SQL across schemas

### 18.2 Session Search Path

```sql
SET search_path TO enforcement;
```

Then:

```sql
SELECT id, status FROM cases WHERE id = $1;
```

Pros:

- less verbose
- convenient for module-specific DB role

Cons:

- hidden dependency
- can break under session pooling/proxy
- unsafe if untrusted schemas exist
- harder debugging

### 18.3 Multi-Tenant Warning

Do not build tenant schema names directly from request values:

```go
query := "SELECT * FROM " + tenant + ".cases" // dangerous
```

Use whitelist mapping:

```go
func TenantSchema(tenantID string) (string, bool) {
    switch tenantID {
    case "cea":
        return "tenant_cea", true
    case "cpds":
        return "tenant_cpds", true
    default:
        return "", false
    }
}
```

And preferably qualify identifiers through a safe identifier builder.

---

## 19. Environment-Specific Configuration

### 19.1 Local Development

Goal:

- fast setup
- disposable DB
- readable config
- safe defaults

Example:

```env
APP_ENV=local
DB_DRIVER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=case_local
DB_USER=case_user
DB_PASSWORD=case_pass
DB_SSL_MODE=disable
DB_MAX_OPEN_CONNS=5
DB_MAX_IDLE_CONNS=2
DB_CONNECT_TIMEOUT=2s
DB_QUERY_TIMEOUT=2s
```

### 19.2 CI

Goal:

- deterministic tests
- isolated DB
- fast failure
- migration from scratch

Example policy:

- small pool
- short timeout
- no production secret source
- migration always runs from clean schema
- test DB destroyed after run

### 19.3 Shared Dev / SIT / UAT

Goal:

- closer to production
- TLS likely enabled
- identifiable application name
- realistic pool settings
- no local-only behavior

### 19.4 Production

Goal:

- secure
- observable
- stable under failure
- validated before serving traffic
- explicit operational limits

Production config should enforce:

- TLS enabled
- credentials from secret manager
- no default password
- non-empty application name
- pool size configured
- connect timeout configured
- read/write timeout configured if driver supports it
- ping timeout configured
- redacted config logged once
- metrics enabled

---

## 20. Configuration Loading Pattern

A simple pattern:

```mermaid
flowchart TD
    A[Read Environment / Secret Store] --> B[Parse Raw Values]
    B --> C[Apply Defaults]
    C --> D[Validate Required Fields]
    D --> E[Validate Security Policy]
    E --> F[Build DSN / Driver Config]
    F --> G[Open sql.DB]
    G --> H[Apply Pool Config]
    H --> I[PingContext]
    I --> J[Return Ready DB Handle]
```

Example Go skeleton:

```go
package dbopen

import (
    "context"
    "database/sql"
    "fmt"
    "time"
)

type Logger interface {
    Info(msg string, args ...any)
    Error(msg string, args ...any)
}

type DSNBuilder interface {
    BuildDSN(DBConfig) (string, error)
}

func Open(ctx context.Context, env string, cfg DBConfig, buildDSN func(DBConfig) (string, error), logger Logger) (*sql.DB, error) {
    if err := cfg.Validate(); err != nil {
        return nil, fmt.Errorf("validate db config: %w", err)
    }
    if err := cfg.ValidateSecurity(env); err != nil {
        return nil, fmt.Errorf("validate db security config: %w", err)
    }

    dsn, err := buildDSN(cfg)
    if err != nil {
        return nil, fmt.Errorf("build db dsn: %w", err)
    }

    logger.Info("database config resolved", "db", cfg.RedactedSummary())

    db, err := sql.Open(string(cfg.Driver), dsn)
    if err != nil {
        return nil, fmt.Errorf("open db handle: %w", err)
    }

    applyPool(db, cfg.Pool)

    pingTimeout := cfg.Timeout.PingTimeout
    if pingTimeout <= 0 {
        pingTimeout = 5 * time.Second
    }

    pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
    defer cancel()

    if err := db.PingContext(pingCtx); err != nil {
        _ = db.Close()
        return nil, fmt.Errorf("ping database: %w", err)
    }

    logger.Info("database connection verified", "driver", cfg.Driver, "database", cfg.Database)
    return db, nil
}

func applyPool(db *sql.DB, p PoolConfig) {
    if p.MaxOpenConns > 0 {
        db.SetMaxOpenConns(p.MaxOpenConns)
    }
    if p.MaxIdleConns > 0 {
        db.SetMaxIdleConns(p.MaxIdleConns)
    }
    if p.ConnMaxLifetime > 0 {
        db.SetConnMaxLifetime(p.ConnMaxLifetime)
    }
    if p.ConnMaxIdleTime > 0 {
        db.SetConnMaxIdleTime(p.ConnMaxIdleTime)
    }
}
```

Note:

- `PingContext` validates that database is reachable and credentials work.
- `sql.Open` itself may not verify actual connectivity.
- Close DB if ping fails to avoid leaving a partially initialized handle.

---

## 21. Defaults: Dangerous vs Defensible

Defaults are architecture decisions.

### 21.1 Dangerous Defaults

| Default | Why dangerous |
|---|---|
| no connect timeout | app can hang during startup or first query |
| no query deadline | stuck query holds pool connection |
| TLS disabled silently | security incident risk |
| `loc=Local` | environment-dependent time behavior |
| empty app name | no DB attribution |
| unlimited max open conns | connection storm risk |
| logging raw DSN | credential leak |
| using production DB in local config | data safety risk |

### 21.2 Defensible Baseline Defaults

Example baseline, not universal truth:

```go
func DefaultDBConfig() DBConfig {
    return DBConfig{
        Application: "unknown-service",
        Timezone:    "UTC",
        TLS: TLSConfig{
            Enabled: true,
            Mode:    "require",
        },
        Timeout: TimeoutConfig{
            ConnectTimeout: 3 * time.Second,
            ReadTimeout:    10 * time.Second,
            WriteTimeout:   10 * time.Second,
            PingTimeout:    5 * time.Second,
        },
        Pool: PoolConfig{
            MaxOpenConns:    10,
            MaxIdleConns:    5,
            ConnMaxLifetime: 30 * time.Minute,
            ConnMaxIdleTime: 5 * time.Minute,
        },
    }
}
```

But these values must be tuned per workload. A reporting worker and a latency-sensitive API should not blindly share the same pool/query budget.

---

## 22. Config Drift and Fingerprinting

In a distributed system, multiple replicas should agree on important DB config.

Config drift examples:

- one pod uses TLS disabled
- one pod uses old password
- one deployment points to read replica accidentally
- one worker uses larger pool than API
- one service has wrong timezone
- migration job uses different schema

A useful technique: produce a redacted config fingerprint.

```go
func (c DBConfig) FingerprintInput() string {
    return fmt.Sprintf(
        "driver=%s;host=%s;port=%d;database=%s;schema=%s;user=%s;app=%s;tz=%s;tls=%t;tlsmode=%s;maxopen=%d;maxidle=%d",
        c.Driver,
        c.Host,
        c.Port,
        c.Database,
        c.Schema,
        c.Username,
        c.Application,
        c.Timezone,
        c.TLS.Enabled,
        c.TLS.Mode,
        c.Pool.MaxOpenConns,
        c.Pool.MaxIdleConns,
    )
}
```

Hash it:

```go
func (c DBConfig) Fingerprint() string {
    sum := sha256.Sum256([]byte(c.FingerprintInput()))
    return hex.EncodeToString(sum[:8])
}
```

Log:

```go
logger.Info("database config fingerprint", "fingerprint", cfg.Fingerprint())
```

Never include password in fingerprint input unless you fully understand secret rotation implications and log risk.

---

## 23. Secret Rotation

Database credentials rotate. Your config design should not assume secrets are eternal.

Approaches:

### 23.1 Restart-Based Rotation

Most common:

1. Secret manager updates credential.
2. Deployment restarts pods.
3. App reads new secret at startup.
4. Old DB connections close over lifetime.

Pros:

- simple
- predictable
- easy to audit

Cons:

- requires restart
- old connection lifetime must be controlled

### 23.2 Dynamic Reload

App watches secret changes and opens a new `*sql.DB`.

Risk:

- race between old/new pool
- double pool connection pressure
- complex shutdown
- incomplete in-flight transaction handling

Dynamic reload pattern requires a safe holder:

```go
type DBHolder struct {
    mu sync.RWMutex
    db *sql.DB
}

func (h *DBHolder) DB() *sql.DB {
    h.mu.RLock()
    defer h.mu.RUnlock()
    return h.db
}

func (h *DBHolder) Swap(newDB *sql.DB) (old *sql.DB) {
    h.mu.Lock()
    defer h.mu.Unlock()
    old = h.db
    h.db = newDB
    return old
}
```

But this is not enough by itself. You also need:

- readiness coordination
- old pool drain
- transaction safety
- connection limit headroom
- rollback plan

Most services should start with restart-based rotation plus reasonable `ConnMaxLifetime`.

---

## 24. Kubernetes / Cloud Runtime Considerations

Database config behaves differently in container/cloud environments.

### 24.1 DNS and Service Discovery

Database hostname might point to:

- cloud DB endpoint
- proxy
- Kubernetes service
- private link
- failover endpoint
- read replica endpoint

Risk:

- long-lived connections ignore DNS changes until reconnect
- stale connections after failover
- all pods reconnect simultaneously after restart

Mitigation:

- set `ConnMaxLifetime`
- avoid infinite lifetime
- add jitter in lifecycle at higher level if needed
- stagger rollout
- use managed proxy where appropriate

### 24.2 Secret Mounting

Secrets can come from:

- environment variables
- mounted files
- secret manager SDK
- sidecar/injector
- Kubernetes Secret
- cloud parameter store

Risks:

- env vars visible to process dump/runtime introspection
- file permissions wrong
- secret update not reflected until restart
- accidental logging

### 24.3 Init Containers and Migration Jobs

Migration jobs often use different DB config:

- elevated permission
- migration schema
- migration version table
- longer statement timeout
- different application name

Do not let application runtime accidentally use migration credentials.

Recommended separation:

```text
case-api runtime user:       case_app_rw
case-worker runtime user:    case_worker_rw
migration job user:          case_migrator
reporting user:              case_readonly
```

---

## 25. Health Check Configuration

### 25.1 Liveness vs Readiness

Do not confuse them.

| Check | Should DB failure fail it? | Purpose |
|---|---:|---|
| liveness | usually no | tells platform whether process is stuck/dead |
| readiness | often yes | tells load balancer whether app can serve traffic |

If liveness depends on DB, a DB outage can cause all pods to restart repeatedly, amplifying incident.

### 25.2 Readiness Ping

```go
func DBReadiness(ctx context.Context, db *sql.DB) error {
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()
    return db.PingContext(ctx)
}
```

But be careful:

- too frequent pings add load
- ping may pass while business queries fail
- ping may create connection pressure if pool exhausted
- readiness checks should be rate-limited/cached in busy systems

### 25.3 Better Readiness State

At startup:

- validate config
- open handle
- apply pool settings
- ping DB
- mark dependency ready

At runtime:

- use cached dependency state with short TTL
- include pool saturation metrics
- avoid heavy SQL in health endpoint

---

## 26. Multi-Database Configuration

Many enterprise systems have more than one DB connection:

- primary OLTP
- read replica
- reporting database
- audit database
- migration database
- tenant-specific database

Avoid ambiguous naming:

Bad:

```go
db1, db2 := openDBs()
```

Better:

```go
type Databases struct {
    Primary   *sql.DB
    ReadOnly  *sql.DB
    Audit     *sql.DB
    Reporting *sql.DB
}
```

Config:

```go
type DatabaseConfigs struct {
    Primary   DBConfig
    ReadOnly  DBConfig
    Audit     DBConfig
    Reporting DBConfig
}
```

Each should have:

- separate application name
- separate pool config
- separate timeout budget
- separate user/role if possible
- separate readiness policy

### 26.1 Read Replica Warning

If config points to read replica:

- reads may be stale
- read-after-write consistency may break
- transaction semantics differ
- replica lag must be observable

Do not hide primary/replica routing inside a generic config flag unless the application semantics are clear.

---

## 27. Config Testing

DSN/config should have unit tests.

### 27.1 Validate Required Fields

```go
func TestDBConfigValidateRequiresHost(t *testing.T) {
    cfg := DefaultDBConfig()
    cfg.Driver = DriverPostgres
    cfg.Host = ""
    cfg.Port = 5432
    cfg.Database = "app"
    cfg.Username = "user"
    cfg.Application = "test"

    err := cfg.Validate()
    if err == nil {
        t.Fatal("expected validation error")
    }
}
```

### 27.2 Password Escaping

```go
func TestPostgresDSNEscapesPassword(t *testing.T) {
    cfg := DefaultDBConfig()
    cfg.Driver = DriverPostgres
    cfg.Host = "db.local"
    cfg.Port = 5432
    cfg.Database = "app"
    cfg.Username = "user"
    cfg.Password = "p@ss/w:rd?x=1"
    cfg.Application = "test"

    dsn, err := BuildPostgresURL(cfg)
    if err != nil {
        t.Fatal(err)
    }

    if strings.Contains(dsn, "p@ss/w:rd?x=1") {
        t.Fatal("password was not URL-escaped")
    }
}
```

### 27.3 Redaction Test

```go
func TestRedactedSummaryDoesNotLeakPassword(t *testing.T) {
    cfg := DefaultDBConfig()
    cfg.Password = "super-secret"

    summary := fmt.Sprint(cfg.RedactedSummary())
    if strings.Contains(summary, "super-secret") {
        t.Fatal("redacted summary leaked password")
    }
}
```

### 27.4 Production Security Test

```go
func TestProductionRequiresTLS(t *testing.T) {
    cfg := DefaultDBConfig()
    cfg.TLS.Enabled = false

    err := cfg.ValidateSecurity("production")
    if err == nil {
        t.Fatal("expected production TLS validation error")
    }
}
```

---

## 28. Failure Modes

### 28.1 Raw DSN Logged

Symptom:

- password appears in logs
- incident response required
- secret rotation needed

Root cause:

```go
logger.Info("db", "dsn", dsn)
```

Prevention:

- never log raw DSN
- code review rule
- redaction tests
- static scanning for DSN logging patterns

### 28.2 `sql.Open` Succeeds but App Fails on First Query

Symptom:

- application starts successfully
- first real request fails with auth/network error

Root cause:

- assumed `sql.Open` validates physical connection
- no `PingContext` at startup/readiness

Prevention:

- call `PingContext` during initialization
- fail fast for critical dependencies

### 28.3 TLS Disabled in Production

Symptom:

- DB traffic unencrypted
- audit/security finding

Root cause:

- local DSN copied to production
- default `sslmode=disable`
- no environment-aware validation

Prevention:

- production config validation
- policy-as-code
- deployment guardrail

### 28.4 Wrong Timezone

Symptom:

- SLA due dates off by hours/day
- audit timestamps inconsistent
- reports differ between environments

Root cause:

- driver defaults to local timezone
- DB server timezone differs
- `parseTime` not enabled for MySQL
- domain date and instant mixed

Prevention:

- UTC baseline
- explicit driver timezone
- explicit DB session timezone
- tests around date boundary

### 28.5 Infinite Dial or Slow Dial

Symptom:

- pod startup hangs
- readiness never becomes true
- rollout stuck

Root cause:

- no connect timeout
- network route blackhole
- DNS issue

Prevention:

- driver connect timeout
- `PingContext` timeout
- rollout timeout

### 28.6 Pool Explosion from Misconfigured Replicas

Symptom:

- database “too many connections”
- all pods healthy but DB saturated by idle/open connections

Root cause:

- per-pod max open too high
- replica count increased
- no global connection budget

Prevention:

- calculate per-service connection budget
- cap `MaxOpenConns`
- monitor total DB sessions by application name

### 28.7 Search Path Drift

Symptom:

- query hits wrong table
- migration appears missing
- test passes but UAT fails

Root cause:

- hidden `search_path`
- different DB role default schema
- proxy/session reset behavior

Prevention:

- explicit schema
- startup validation query
- avoid hidden session assumptions

### 28.8 Read Replica Accidentally Used for Writes

Symptom:

- write errors in production
- intermittent transaction failures

Root cause:

- wrong endpoint in config
- primary/read-only config names unclear

Prevention:

- separate config names
- DB user permissions
- startup capability check
- `application_name` split

---

## 29. Configuration Review Checklist

Use this checklist during PR/architecture review.

### 29.1 Security

- [ ] Credentials are not hard-coded.
- [ ] Raw DSN is never logged.
- [ ] Redacted summary exists.
- [ ] TLS is required outside local/CI.
- [ ] Server certificate validation is not disabled in production.
- [ ] Secret source is documented.
- [ ] Secret rotation behavior is known.

### 29.2 Correctness

- [ ] Timezone is explicit.
- [ ] Schema/search path behavior is explicit.
- [ ] Application name is configured.
- [ ] Read/write endpoints are not ambiguous.
- [ ] Database role permissions match workload.
- [ ] Config is validated before opening DB.

### 29.3 Reliability

- [ ] Connect timeout is configured.
- [ ] Ping timeout is configured.
- [ ] Query context/deadline strategy exists.
- [ ] Pool settings are explicit.
- [ ] Connection lifetime is configured for cloud/failover reality.
- [ ] Startup failure behavior is intentional.

### 29.4 Operability

- [ ] Redacted config logged at startup.
- [ ] Config fingerprint available.
- [ ] Pool metrics exported.
- [ ] DB sessions attributable by application name.
- [ ] Health check strategy separates liveness/readiness.
- [ ] Migration job uses separate config/user where appropriate.

### 29.5 Testing

- [ ] DSN builder is unit-tested.
- [ ] Redaction is unit-tested.
- [ ] Production security validation is tested.
- [ ] Special characters in password are tested.
- [ ] Missing required field validation is tested.

---

## 30. Practical Production Baseline

A reasonable production database initialization flow:

```go
func InitPrimaryDB(ctx context.Context, env string, raw RawEnv, logger Logger) (*sql.DB, error) {
    cfg, err := LoadPrimaryDBConfig(raw)
    if err != nil {
        return nil, fmt.Errorf("load primary db config: %w", err)
    }

    db, err := Open(ctx, env, cfg, BuildPostgresURL, logger)
    if err != nil {
        return nil, fmt.Errorf("open primary db: %w", err)
    }

    return db, nil
}
```

Where `LoadPrimaryDBConfig`:

1. Reads env/secret source.
2. Applies defaults.
3. Parses durations and ints.
4. Validates required fields.
5. Does not build DSN yet.
6. Returns typed config.

Where `Open`:

1. Validates security policy.
2. Builds DSN.
3. Logs redacted config.
4. Calls `sql.Open` or `sql.OpenDB`.
5. Applies pool settings.
6. Calls `PingContext`.
7. Returns ready `*sql.DB`.

---

## 31. Anti-Patterns

### 31.1 DSN String Scattered Across Codebase

```go
sql.Open("postgres", os.Getenv("DATABASE_URL"))
```

This is acceptable for a prototype but weak for serious production unless wrapped with validation and redaction.

### 31.2 Pool Config Hidden in DSN Expectations

Wrong mental model:

```text
DATABASE_URL=...maxOpenConns=20
```

Unless driver specifically uses a parameter, `database/sql` pool settings are controlled by methods on `*sql.DB`, not generic DSN params.

### 31.3 Environment-Based Branching Everywhere

Bad:

```go
if env == "prod" {
    dsn = prodDSN
} else if env == "uat" {
    dsn = uatDSN
} else {
    dsn = localDSN
}
```

Better:

- same config schema everywhere
- different values per environment
- validation policy can vary by environment

### 31.4 Logging Config with `fmt.Printf("%+v", cfg)`

If config struct contains password, this leaks.

Design config so accidental formatting is safer:

```go
type SecretString string

func (s SecretString) String() string {
    if s == "" {
        return ""
    }
    return "<redacted>"
}
```

But do not rely only on this. Some serializers bypass `String()`.

### 31.5 Production Uses Local Defaults

Bad:

```go
if cfg.Password == "" {
    cfg.Password = "postgres"
}
```

Defaults that are fine locally can be catastrophic in production.

---

## 32. Java Engineer Translation Table

| Java/Spring Concept | Go Equivalent / Practice |
|---|---|
| `spring.datasource.url` | driver DSN / typed config builder |
| `spring.datasource.username` | config field / secret source |
| `spring.datasource.password` | secret field, never logged |
| Hikari `maximumPoolSize` | `db.SetMaxOpenConns` |
| Hikari `minimumIdle` | not identical; `SetMaxIdleConns` caps idle |
| Hikari `maxLifetime` | `db.SetConnMaxLifetime` |
| Hikari `idleTimeout` | `db.SetConnMaxIdleTime` |
| Hikari `connectionTimeout` | context/pool wait + driver connect timeout depending on phase |
| JDBC URL params | driver-specific DSN params |
| `@ConfigurationProperties` | typed Go config struct + validation |
| `DataSourceHealthIndicator` | explicit readiness check with `PingContext` |
| masked actuator config | redacted summary/fingerprint |
| Spring profile | same config schema, environment-specific values |

Important distinction:

Hikari has a named `connectionTimeout` for waiting for a connection from the pool. In Go, waiting for a pool connection is controlled by the context passed into `QueryContext`/`ExecContext`/`BeginTx`, while dial/read/write timeout is usually driver-specific.

---

## 33. Scenario: Case Management API

Imagine service:

```text
case-service-api
```

Requirements:

- PostgreSQL primary DB
- production TLS required
- explicit UTC timezone
- app name visible in DB
- max 20 open connections per pod
- 6 pods max
- DB allows 200 application connections
- connect timeout 3s
- API query budget 2s
- reporting queries not allowed in API

Config:

```env
APP_ENV=production
DB_DRIVER=postgres
DB_HOST=postgres-primary.internal
DB_PORT=5432
DB_NAME=case_db
DB_SCHEMA=enforcement
DB_USER=case_api_rw
DB_PASSWORD_FILE=/var/run/secrets/db/password
DB_SSL_MODE=require
DB_TIMEZONE=UTC
DB_APPLICATION_NAME=case-service-api
DB_CONNECT_TIMEOUT=3s
DB_PING_TIMEOUT=5s
DB_MAX_OPEN_CONNS=20
DB_MAX_IDLE_CONNS=10
DB_CONN_MAX_LIFETIME=30m
DB_CONN_MAX_IDLE_TIME=5m
```

Capacity reasoning:

```text
6 pods × 20 max open = 120 possible app DB connections
```

If DB budget is 200 app connections, remaining 80 can be allocated to:

- workers
- migration jobs
- reporting
- admin sessions
- emergency buffer

This is defensible. It is much better than leaving `MaxOpenConns` unlimited and hoping the DB survives.

---

## 34. Scenario: Worker Service

Worker characteristics:

- long-running jobs
- fewer replicas
- can tolerate longer query timeout
- may do batch updates
- should not starve API

Separate config:

```env
DB_APPLICATION_NAME=case-service-worker
DB_MAX_OPEN_CONNS=8
DB_MAX_IDLE_CONNS=4
DB_CONNECT_TIMEOUT=3s
DB_PING_TIMEOUT=5s
DB_QUERY_TIMEOUT=15s
```

Do not reuse API pool config blindly.

Reason:

- worker query shape differs
- transaction duration may differ
- error tolerance differs
- priority differs

---

## 35. Scenario: Migration Job

Migration job config:

```env
DB_APPLICATION_NAME=case-service-migration
DB_USER=case_migrator
DB_MAX_OPEN_CONNS=1
DB_MAX_IDLE_CONNS=1
DB_CONNECT_TIMEOUT=5s
DB_PING_TIMEOUT=10s
```

Why `MaxOpenConns=1`?

- many migration tools execute sequentially
- prevents accidental parallel schema changes
- reduces DB lock pressure
- easier to reason about

But backfill jobs may need different config. Do not mix schema migration and data backfill without explicit design.

---

## 36. Mermaid: Full Configuration Lifecycle

```mermaid
flowchart TD
    A[Start Process] --> B[Load Raw Config]
    B --> C[Load Secret Values]
    C --> D[Parse Types]
    D --> E[Apply Defaults]
    E --> F[Validate Required Fields]
    F --> G[Validate Environment Security Policy]
    G --> H[Build Driver DSN / Connector]
    H --> I[Log Redacted Summary]
    I --> J[Open sql.DB Handle]
    J --> K[Apply Pool Settings]
    K --> L[Ping With Timeout]
    L --> M{Ping OK?}
    M -- No --> N[Close Handle and Fail Startup]
    M -- Yes --> O[Register Metrics]
    O --> P[Mark Dependency Ready]
    P --> Q[Serve Traffic]
```

---

## 37. Exercises

### Exercise 1 — Build a Redacted PostgreSQL DSN Builder

Implement:

```go
func BuildPostgresURL(c DBConfig) (string, error)
func (c DBConfig) RedactedSummary() map[string]any
```

Test:

- password with `@`, `/`, `?`, `:`
- empty host
- invalid port
- TLS disabled in production
- redacted summary does not leak password

### Exercise 2 — Build MySQL Config Using `mysql.Config`

Implement:

```go
func BuildMySQLDSN(c DBConfig) (string, error)
```

Requirements:

- `parseTime=true`
- `loc=UTC`
- `timeout=3s`
- `readTimeout=5s`
- `writeTimeout=5s`
- `tls=true` in production

### Exercise 3 — Startup DB Initialization

Implement:

```go
func Open(ctx context.Context, env string, cfg DBConfig, buildDSN func(DBConfig) (string, error), logger Logger) (*sql.DB, error)
```

Requirements:

- validate config
- validate security
- build DSN
- log redacted config
- open DB
- apply pool
- ping with timeout
- close DB on failure

### Exercise 4 — Config Fingerprint

Implement fingerprint that excludes secret values but includes:

- driver
- host
- port
- database
- schema
- username
- application name
- TLS mode
- pool size

### Exercise 5 — Incident Analysis

Given this config:

```env
DB_HOST=prod-db.internal
DB_PORT=5432
DB_NAME=case_db
DB_USER=case_api_rw
DB_PASSWORD=secret
DB_SSL_MODE=disable
DB_MAX_OPEN_CONNS=0
DB_TIMEZONE=Local
```

Identify at least 8 production risks and propose corrections.

---

## 38. Summary

DSN dan konfigurasi database bukan detail kecil. Ia adalah boundary penting antara aplikasi, driver, network, database session, secret management, security policy, dan observability.

Mental model utama:

1. DSN adalah driver-specific connection contract.
2. `database/sql` tidak menstandarkan DSN antar database.
3. Jangan susun DSN dengan string concat sembarangan.
4. Gunakan typed config, validation, builder, dan redacted summary.
5. Pool config berada di `*sql.DB`, bukan generic DSN.
6. Timeout punya banyak layer: connect, read, write, pool wait, query, statement, lock, transaction.
7. TLS, timezone, schema, dan application name harus eksplisit.
8. Config harus diuji, bukan hanya dibaca dari env.
9. Production config harus fail-fast terhadap unsafe defaults.
10. Observability dimulai dari konfigurasi yang bisa dijelaskan tanpa membocorkan rahasia.

Jika bagian ini dipahami dengan benar, kamu tidak hanya bisa “connect ke database”, tetapi bisa mendesain koneksi database yang defensible, secure, predictable, dan mudah dioperasikan saat incident.

---

## 39. References

- Go `database/sql` package documentation: https://pkg.go.dev/database/sql
- Go documentation — Opening a database handle: https://go.dev/doc/database/open-handle
- Go documentation — Managing connections: https://go.dev/doc/database/manage-connections
- Go MySQL Driver documentation: https://github.com/go-sql-driver/mysql
- pgx package documentation: https://pkg.go.dev/github.com/jackc/pgx/v5
- pgx repository: https://github.com/jackc/pgx
- godror package documentation: https://pkg.go.dev/github.com/godror/godror
- godror repository: https://github.com/godror/godror

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-sql-database-integration-part-004.md">⬅️ Driver Model and Driver Selection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-sql-database-integration-part-006.md">Query Execution Model ➡️</a>
</div>
