# learn-go-sql-database-integration-part-003.md

# Opening Database Handles Correctly

> Seri: **Go SQL Package, Connection Pool, Transaction Management, and Database Integration**  
> Part: **003**  
> Target pembaca: **Java software engineer / tech lead yang ingin menguasai database integration di Go secara production-grade**  
> Target Go: **Go 1.26.x**  
> Fokus: **membuka, memvalidasi, mengonfigurasi, membagikan, dan menutup database handle dengan benar**

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membedah anatomi `database/sql`: `*sql.DB`, `*sql.Conn`, `*sql.Tx`, `*sql.Stmt`, `*sql.Rows`, `Scanner`, `Valuer`, dan hubungan dengan driver.

Part ini menjawab pertanyaan praktis pertama saat membangun aplikasi Go yang memakai database:

> Bagaimana cara membuat database handle yang benar, aman, observable, testable, dan tidak menjadi sumber incident di production?

Ini terdengar sederhana, tetapi banyak masalah production bermula dari kesalahan kecil di tahap ini:

- membuka `sql.DB` berkali-kali per request;
- mengira `sql.Open` pasti langsung connect ke database;
- tidak pernah `PingContext` saat startup;
- tidak memberi timeout saat validasi koneksi;
- salah mengatur pool sebelum traffic masuk;
- credentials bocor ke log;
- health check terlalu agresif sehingga malah menambah beban DB;
- `Close` dipanggil terlalu sering;
- tidak memahami kapan `OpenDB` lebih tepat daripada `Open`;
- membuat global state yang sulit dites;
- tidak membedakan readiness, liveness, dan dependency validation.

Dalam Java/Spring, banyak hal ini sering “tersembunyi” di balik `DataSource`, HikariCP, Spring Boot auto-configuration, Actuator health indicator, dan `@Transactional`. Dalam Go, Anda lebih eksplisit. Eksplisit bukan berarti low-level tanpa struktur; eksplisit berarti ownership dan lifecycle terlihat jelas di kode.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, Anda harus mampu:

1. Menjelaskan perbedaan `sql.Open`, `sql.OpenDB`, `Ping`, dan `PingContext`.
2. Memahami bahwa `*sql.DB` adalah **long-lived pool handle**, bukan satu koneksi fisik.
3. Mendesain fungsi `OpenDatabase` yang production-friendly.
4. Memisahkan configuration parsing, DSN construction, pool configuration, validation, dan shutdown.
5. Menentukan kapan aplikasi harus fail-fast saat database tidak bisa dihubungi.
6. Menentukan kapan aplikasi boleh start walaupun database sementara belum siap.
7. Menghindari credential leak di log, metrics, panic, dan error response.
8. Mengimplementasikan startup validation dengan bounded timeout.
9. Membedakan liveness check, readiness check, dan deep dependency check.
10. Menyusun lifecycle database handle untuk CLI, HTTP service, worker, migration job, dan test.
11. Mengerti trade-off `sql.Open` vs driver-specific connector.
12. Membuat checklist code review untuk database initialization di Go.

---

## 2. Mental Model Utama

### 2.1 `*sql.DB` adalah Pool Handle

Nama `sql.DB` bisa menyesatkan. Ia bukan object database, bukan physical connection, dan bukan session. Ia adalah **handle** yang mengelola pool koneksi ke database.

Mental model yang lebih tepat:

```text
*sql.DB = database access coordinator + connection pool + execution entry point
```

Bukan:

```text
*sql.DB = one TCP connection to database
```

Saat Anda memanggil:

```go
db, err := sql.Open("postgres", dsn)
```

Anda membuat handle. Koneksi fisik ke database bisa saja belum dibuat saat itu. Koneksi biasanya dibuat ketika dibutuhkan, misalnya saat `PingContext`, `QueryContext`, `ExecContext`, atau `BeginTx`.

---

### 2.2 Analogi dengan Java

Untuk Java engineer, analoginya kira-kira seperti ini:

| Java / Spring | Go `database/sql` | Catatan |
|---|---|---|
| `DataSource` | `*sql.DB` | Sama-sama entry point dan pool facade. |
| HikariCP pool | internal pool di `*sql.DB` | Go punya pool built-in di `database/sql`. |
| `Connection` | `*sql.Conn` | Explicit single connection/session. Jarang dipakai untuk normal CRUD. |
| `Connection` dalam transaksi | `*sql.Tx` | Transaction mengikat satu connection sampai commit/rollback. |
| `dataSource.getConnection()` | internal acquisition oleh `sql.DB` | Umumnya tidak perlu dilakukan manual. |
| `connection.close()` | connection kembali ke pool | Di Go, `Rows.Close`, `Tx.Commit/Rollback`, atau `Conn.Close` mengembalikan resource. |
| Spring Boot startup datasource validation | `PingContext` saat boot | Anda sendiri yang menentukan fail-fast atau lazy. |
| Hikari config | `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxIdleTime`, `SetConnMaxLifetime` | Lebih kecil surface area, tetapi tetap perlu capacity planning. |

Perbedaan paling penting:

> Di Go, `sql.Open` tidak sama dengan `DriverManager.getConnection()`.

`sql.Open` lebih mirip membuat `DataSource`/pool handle daripada mengambil satu connection.

---

## 3. Lifecycle Database Handle

Lifecycle ideal untuk service jangka panjang:

```mermaid
flowchart TD
    A[Load config] --> B[Validate config fields]
    B --> C[Build DSN or Connector]
    C --> D[sql.Open or sql.OpenDB]
    D --> E[Configure pool limits]
    E --> F[PingContext with startup timeout]
    F -->|success| G[Expose DB to repositories/services]
    F -->|failure| H[Fail fast or start degraded]
    G --> I[Serve traffic]
    I --> J[Readiness checks]
    I --> K[DB Stats metrics]
    I --> L[Graceful shutdown]
    L --> M[Stop accepting traffic]
    M --> N[Wait in-flight requests]
    N --> O[db.Close]
```

Key invariant:

> Buat `*sql.DB` sekali per logical database target, konfigurasi sebelum dipakai, validasi dengan timeout, bagikan sebagai dependency long-lived, dan tutup saat process shutdown.

---

## 4. `sql.Open`: Apa yang Sebenarnya Terjadi?

Signature:

```go
func Open(driverName, dataSourceName string) (*sql.DB, error)
```

`driverName` adalah nama driver yang sudah diregistrasikan oleh package driver. `dataSourceName` adalah string konfigurasi driver-specific.

Contoh:

```go
import (
    "database/sql"

    _ "github.com/lib/pq"
)

func openPostgres(dsn string) (*sql.DB, error) {
    return sql.Open("postgres", dsn)
}
```

Atau MySQL:

```go
import (
    "database/sql"

    _ "github.com/go-sql-driver/mysql"
)

func openMySQL(dsn string) (*sql.DB, error) {
    return sql.Open("mysql", dsn)
}
```

### 4.1 Blank Import

Jika Anda tidak memakai API driver secara langsung dan hanya ingin driver mendaftarkan dirinya ke `database/sql`, gunakan blank import:

```go
import _ "github.com/go-sql-driver/mysql"
```

Blank import berarti:

> Jalankan `init()` package itu untuk side effect registrasi driver, walaupun package-nya tidak direferensikan langsung.

Tanpa import driver, `sql.Open("mysql", dsn)` akan gagal karena `database/sql` tidak tahu driver bernama `mysql`.

---

### 4.2 Error dari `sql.Open` Bukan Selalu Connection Error

Kesalahan umum:

```go
db, err := sql.Open("postgres", dsn)
if err != nil {
    return err // dianggap database unreachable
}
```

Ini kurang tepat.

`sql.Open` dapat mengembalikan error jika handle gagal diinisialisasi, misalnya:

- driver name tidak dikenal;
- DSN tidak bisa diparse oleh driver;
- konfigurasi driver invalid;
- connector construction gagal.

Namun `sql.Open` **tidak menjamin** bahwa database server sudah bisa dihubungi. Untuk memverifikasi koneksi nyata, gunakan `PingContext`.

---

## 5. `Ping` dan `PingContext`

Signature:

```go
func (db *DB) Ping() error
func (db *DB) PingContext(ctx context.Context) error
```

`Ping`/`PingContext` digunakan untuk memverifikasi bahwa komunikasi dengan database masih mungkin. Jika belum ada koneksi, `PingContext` bisa memaksa pembentukan koneksi.

Dalam production code, prioritaskan:

```go
db.PingContext(ctx)
```

bukan:

```go
db.Ping()
```

Karena `PingContext` bisa diberi timeout.

---

### 5.1 Startup Ping dengan Timeout

Contoh minimal:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

if err := db.PingContext(ctx); err != nil {
    return fmt.Errorf("ping database: %w", err)
}
```

Tanpa timeout, startup process bisa menggantung terlalu lama ketika:

- DNS lambat;
- database host tidak reachable;
- firewall drop packet;
- TLS handshake menggantung;
- credential validation lambat;
- database sedang failover;
- connection pooler tidak responsif.

---

### 5.2 Ping Tidak Sama dengan Aplikasi Sehat

`PingContext` hanya membuktikan bahwa koneksi dasar ke database bisa dilakukan. Ia tidak membuktikan bahwa:

- schema benar;
- migration sudah selesai;
- user punya semua privilege;
- query bisnis cepat;
- read replica tidak lag;
- transaction isolation sesuai;
- database tidak hampir penuh;
- semua tabel/index tersedia;
- lock contention tidak terjadi.

Jadi jangan jadikan `Ping` sebagai satu-satunya health signal.

---

## 6. `sql.OpenDB` dan `driver.Connector`

Signature:

```go
func OpenDB(c driver.Connector) *DB
```

`OpenDB` digunakan ketika Anda memiliki `driver.Connector`.

Mental model:

```text
sql.Open(driverName, dsn)
    -> database/sql meminta driver memparse DSN
    -> driver membuat connection saat dibutuhkan

sql.OpenDB(connector)
    -> Anda memberi database/sql connector yang sudah fixed configuration
    -> connector membuat connection saat dibutuhkan
```

`Connector` berguna ketika:

- driver punya config struct yang lebih aman daripada raw DSN string;
- Anda ingin menghindari parse DSN berulang;
- Anda ingin memakai driver-specific connection feature;
- Anda ingin custom dialer;
- Anda ingin cloud connector;
- Anda ingin TLS config yang tidak nyaman dimodelkan sebagai string;
- Anda ingin integrasi authentication mechanism tertentu.

Contoh konseptual:

```go
cfg := mysql.NewConfig()
cfg.User = username
cfg.Passwd = password
cfg.Net = "tcp"
cfg.Addr = "127.0.0.1:3306"
cfg.DBName = "appdb"
cfg.ParseTime = true

connector, err := mysql.NewConnector(cfg)
if err != nil {
    return nil, fmt.Errorf("create mysql connector: %w", err)
}

db := sql.OpenDB(connector)
```

Kelebihan style ini:

- lebih type-aware;
- lebih mudah di-review;
- lebih sulit salah escaping;
- lebih mudah redaction;
- lebih mudah memberi default aman.

---

## 7. Desain Fungsi `OpenDatabase`

### 7.1 Jangan Sebar `sql.Open` di Banyak Tempat

Anti-pattern:

```go
func GetUser(ctx context.Context, id int64) (User, error) {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        return User{}, err
    }
    defer db.Close()

    // query...
}
```

Masalah:

- membuka pool baru setiap call;
- connection storm;
- pool metrics tidak bermakna;
- shutdown lifecycle kacau;
- credential/config parsing tersebar;
- testing sulit;
- latency tinggi;
- DB bisa kehabisan connection.

Pattern yang benar:

```go
func main() {
    cfg := loadConfig()

    db, err := database.Open(ctx, cfg.Database)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    repo := userrepo.New(db)
    svc := usersvc.New(repo)

    runHTTPServer(svc)
}
```

---

### 7.2 Bentuk Config yang Baik

Contoh config netral driver:

```go
type DatabaseConfig struct {
    Driver          string
    Host            string
    Port            int
    Database        string
    Username        string
    Password        string
    SSLMode         string
    ApplicationName string

    ConnectTimeout  time.Duration
    StartupTimeout  time.Duration

    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxIdleTime time.Duration
    ConnMaxLifetime time.Duration
}
```

Catatan:

- `ConnectTimeout` biasanya driver/network-level timeout.
- `StartupTimeout` adalah batas waktu `PingContext` saat boot.
- Pool settings harus eksplisit untuk production service.
- Jangan menaruh DSN penuh di log karena biasanya mengandung credential.

---

### 7.3 Validasi Config

Contoh:

```go
func (c DatabaseConfig) Validate() error {
    var errs []error

    if c.Driver == "" {
        errs = append(errs, errors.New("database driver is required"))
    }
    if c.Host == "" {
        errs = append(errs, errors.New("database host is required"))
    }
    if c.Port <= 0 || c.Port > 65535 {
        errs = append(errs, fmt.Errorf("database port is invalid: %d", c.Port))
    }
    if c.Database == "" {
        errs = append(errs, errors.New("database name is required"))
    }
    if c.Username == "" {
        errs = append(errs, errors.New("database username is required"))
    }
    if c.StartupTimeout <= 0 {
        errs = append(errs, errors.New("database startup timeout must be positive"))
    }
    if c.MaxOpenConns < 0 {
        errs = append(errs, errors.New("database max open conns cannot be negative"))
    }
    if c.MaxIdleConns < 0 {
        errs = append(errs, errors.New("database max idle conns cannot be negative"))
    }

    return errors.Join(errs...)
}
```

Tujuan validasi:

- menangkap error sebelum runtime query;
- membedakan config error dari database outage;
- membuat startup failure lebih jelas;
- memudahkan deployment rollback;
- mencegah fallback diam-diam ke default berbahaya.

---

## 8. Production-Grade `OpenDatabase`

Berikut skeleton yang bisa dijadikan baseline.

```go
package database

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "time"
)

type Config struct {
    Driver          string
    DSN             string
    StartupTimeout  time.Duration
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxIdleTime time.Duration
    ConnMaxLifetime time.Duration
}

func (c Config) Validate() error {
    var errs []error

    if c.Driver == "" {
        errs = append(errs, errors.New("driver is required"))
    }
    if c.DSN == "" {
        errs = append(errs, errors.New("dsn is required"))
    }
    if c.StartupTimeout <= 0 {
        errs = append(errs, errors.New("startup timeout must be positive"))
    }
    if c.MaxOpenConns < 0 {
        errs = append(errs, errors.New("max open conns cannot be negative"))
    }
    if c.MaxIdleConns < 0 {
        errs = append(errs, errors.New("max idle conns cannot be negative"))
    }
    if c.ConnMaxIdleTime < 0 {
        errs = append(errs, errors.New("conn max idle time cannot be negative"))
    }
    if c.ConnMaxLifetime < 0 {
        errs = append(errs, errors.New("conn max lifetime cannot be negative"))
    }

    return errors.Join(errs...)
}

func Open(ctx context.Context, cfg Config) (*sql.DB, error) {
    if err := cfg.Validate(); err != nil {
        return nil, fmt.Errorf("validate database config: %w", err)
    }

    db, err := sql.Open(cfg.Driver, cfg.DSN)
    if err != nil {
        return nil, fmt.Errorf("open database handle: %w", err)
    }

    // Configure the pool before any query uses the handle.
    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

    pingCtx, cancel := context.WithTimeout(ctx, cfg.StartupTimeout)
    defer cancel()

    if err := db.PingContext(pingCtx); err != nil {
        closeErr := db.Close()
        if closeErr != nil {
            return nil, fmt.Errorf("ping database: %w; close after failed ping: %v", err, closeErr)
        }
        return nil, fmt.Errorf("ping database: %w", err)
    }

    return db, nil
}
```

### 8.1 Kenapa Pool Diatur Sebelum `PingContext`?

Karena `PingContext` bisa membuat koneksi. Jika Anda mengatur pool setelah `PingContext`, koneksi pertama bisa dibuat dengan behavior default. Untuk kebanyakan kasus ini bukan masalah besar, tetapi secara desain production lebih rapi:

```text
construct handle -> configure pool -> validate connectivity -> expose to app
```

---

### 8.2 Kenapa `Close` Dipanggil Jika Ping Gagal?

Jika `sql.Open` berhasil tetapi `PingContext` gagal, handle tetap sudah dibuat. Memanggil `Close` saat gagal memastikan resource internal dibersihkan.

Ini juga membuat ownership jelas:

```text
Jika Open() return (*sql.DB, nil), caller bertanggung jawab menutup.
Jika Open() return (nil, error), function bertanggung jawab membersihkan resource sementara.
```

---

## 9. DSN Redaction dan Secret Hygiene

### 9.1 Jangan Log DSN Mentah

Anti-pattern:

```go
log.Printf("connecting to database: %s", dsn)
```

DSN sering mengandung:

- username;
- password;
- host internal;
- database name;
- SSL parameter;
- token;
- cloud connector details.

Bahkan host/database name bisa sensitif di environment tertentu.

Pattern lebih baik:

```go
log.Printf("connecting to database: driver=%s host=%s db=%s user=%s", driver, host, dbName, username)
```

Tetapi tetap hati-hati. Untuk log production, biasanya cukup:

```text
connecting to primary database handle
```

Detail teknis bisa masuk structured config dump yang sudah diredact, bukan plain log.

---

### 9.2 Redacted Config

```go
type RedactedDatabaseConfig struct {
    Driver          string `json:"driver"`
    Host            string `json:"host"`
    Port            int    `json:"port"`
    Database        string `json:"database"`
    Username        string `json:"username"`
    Password        string `json:"password"`
    SSLMode         string `json:"ssl_mode"`
    MaxOpenConns    int    `json:"max_open_conns"`
    MaxIdleConns    int    `json:"max_idle_conns"`
}

func (c DatabaseConfig) Redacted() RedactedDatabaseConfig {
    password := ""
    if c.Password != "" {
        password = "<redacted>"
    }

    return RedactedDatabaseConfig{
        Driver:       c.Driver,
        Host:         c.Host,
        Port:         c.Port,
        Database:     c.Database,
        Username:     c.Username,
        Password:     password,
        SSLMode:      c.SSLMode,
        MaxOpenConns: c.MaxOpenConns,
        MaxIdleConns: c.MaxIdleConns,
    }
}
```

---

## 10. Pool Configuration at Open Time

Part pool sizing akan dibahas dalam part khusus, tetapi saat membuka handle Anda minimal perlu tahu bahwa pool configuration adalah bagian dari initialization contract.

Core methods:

```go
db.SetMaxOpenConns(n)
db.SetMaxIdleConns(n)
db.SetConnMaxIdleTime(d)
db.SetConnMaxLifetime(d)
```

### 10.1 Meaning Singkat

| Method | Meaning | Risiko bila salah |
|---|---|---|
| `SetMaxOpenConns` | Maksimum total open connection ke DB dari handle ini | Terlalu besar: DB overload. Terlalu kecil: app queueing/pool starvation. |
| `SetMaxIdleConns` | Maksimum idle connection yang disimpan | Terlalu besar: connection waste. Terlalu kecil: reconnect churn. |
| `SetConnMaxIdleTime` | Berapa lama idle connection boleh hidup | Terlalu panjang: stale idle. Terlalu pendek: churn. |
| `SetConnMaxLifetime` | Umur maksimum connection | Terlalu panjang: stuck pada old backend/failover issue. Terlalu pendek: reconnect storm. |

### 10.2 Default Bukan Selalu Production-Safe

Default `database/sql` sengaja general-purpose. Untuk service production, default sering terlalu implicit.

Misalnya:

- tanpa `MaxOpenConns`, aplikasi bisa membuka koneksi sebanyak kebutuhan concurrent sampai dibatasi DB/network/driver;
- default idle rendah bisa membuat reconnect churn untuk traffic bursty;
- tanpa lifetime, koneksi bisa hidup sangat lama dan bermasalah saat failover, rotation, NAT timeout, atau DB maintenance.

Namun jangan asal set angka. Pool sizing harus berdasarkan:

- jumlah instance/pod;
- database max connection;
- workload concurrency;
- average query latency;
- transaction duration;
- background job concurrency;
- migration/maintenance traffic;
- headroom untuk admin dan emergency access.

---

## 11. Fail-Fast vs Lazy Startup

Ada dua strategi startup:

```text
Fail-fast:
Service gagal start jika DB tidak reachable.

Lazy/degraded:
Service tetap start, tetapi readiness false atau fitur DB-dependent disabled.
```

### 11.1 Fail-Fast Cocok untuk

- monolith atau service yang semua endpoint butuh DB;
- worker yang tugas utamanya memproses data dari DB;
- migration runner;
- CLI administratif yang langsung butuh DB;
- service internal dengan orchestrator yang bisa retry start;
- environment dengan dependency startup order jelas.

Keuntungan:

- error cepat terlihat;
- bad deploy cepat gagal;
- tidak melayani request yang pasti gagal;
- mengurangi noise runtime.

Risiko:

- saat DB failover sementara, semua pod restart-loop;
- recovery bisa lambat jika orchestrator agresif;
- startup storm setelah DB pulih.

---

### 11.2 Lazy/Degraded Cocok untuk

- service yang punya endpoint non-DB;
- API gateway/helper service dengan fitur optional;
- service yang harus expose diagnostics walau DB down;
- multi-database service dengan sebagian dependency optional;
- control-plane service yang harus tetap bisa menerima config/health calls.

Pattern:

```text
Process starts -> liveness true -> readiness false until DB ready
```

Jangan confuse:

- liveness: process masih hidup?
- readiness: siap menerima traffic?
- dependency check: dependency tertentu sehat?

---

## 12. Liveness, Readiness, dan Startup Validation

### 12.1 Jangan Pakai Deep DB Ping untuk Liveness

Liveness check harus menjawab:

> Apakah process ini perlu dibunuh dan direstart?

Jika DB down, belum tentu process harus dibunuh. Jika liveness bergantung pada DB, maka outage DB bisa menyebabkan semua pod restart bersamaan, memperparah recovery.

Liveness minimal:

```go
func Liveness(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    _, _ = w.Write([]byte("ok"))
}
```

---

### 12.2 Readiness Boleh Mengecek DB dengan Hati-Hati

Readiness menjawab:

> Apakah instance ini siap menerima traffic user sekarang?

Contoh readiness dengan timeout pendek:

```go
func Readiness(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
        defer cancel()

        if err := db.PingContext(ctx); err != nil {
            http.Error(w, "database not ready", http.StatusServiceUnavailable)
            return
        }

        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte("ready"))
    }
}
```

Namun ini tidak selalu ideal untuk high-scale service. Jika readiness dipanggil terlalu sering di banyak pod, DB bisa mendapat beban ping yang tidak perlu.

Alternatif:

- cache result selama beberapa detik;
- gunakan lightweight query hanya bila perlu;
- pakai circuit state internal;
- gunakan pool stats + recent successful DB operation;
- pisahkan readiness untuk critical dan optional database.

---

### 12.3 Startup Validation Bukan Readiness Loop

Startup validation:

```text
Dilakukan saat process boot untuk menangkap config/connectivity error awal.
```

Readiness:

```text
Dilakukan berulang oleh orchestrator/load balancer untuk menentukan routing traffic.
```

Jangan membuat readiness melakukan migration check berat atau query kompleks setiap beberapa detik.

---

## 13. `Close`: Kapan Dipanggil?

`db.Close()` menutup database handle dan mencegah query baru. Untuk long-running service, `*sql.DB` biasanya dibuat sekali dan ditutup saat shutdown.

### 13.1 Pattern Service

```go
func main() {
    ctx := context.Background()

    db, err := database.Open(ctx, cfg.Database)
    if err != nil {
        log.Fatal(err)
    }
    defer func() {
        if err := db.Close(); err != nil {
            log.Printf("close database: %v", err)
        }
    }()

    runServer(db)
}
```

### 13.2 Jangan `Close` per Request

Anti-pattern:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("postgres", dsn)
    defer db.Close()

    // query...
}
```

Efek buruk:

- pool tidak pernah stabil;
- reconnect setiap request;
- latency meningkat;
- database menerima connection churn;
- resource exhaustion;
- metrics kacau.

---

## 14. Graceful Shutdown dengan Database Handle

Database handle harus ditutup setelah aplikasi berhenti menerima traffic baru dan in-flight request diberi waktu selesai.

Urutan recommended:

```mermaid
sequenceDiagram
    participant OS as OS Signal
    participant App as Go Process
    participant HTTP as HTTP Server
    participant DB as *sql.DB

    OS->>App: SIGTERM/SIGINT
    App->>HTTP: Stop accepting new requests
    HTTP->>HTTP: Wait for in-flight requests with timeout
    HTTP-->>App: Shutdown complete or timeout
    App->>DB: db.Close()
    DB-->>App: Close idle conns, wait/finish started queries per sql semantics
    App->>OS: Exit
```

Contoh:

```go
func run(ctx context.Context, srv *http.Server, db *sql.DB) error {
    errCh := make(chan error, 1)

    go func() {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            errCh <- err
            return
        }
        errCh <- nil
    }()

    select {
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
        defer cancel()

        if err := srv.Shutdown(shutdownCtx); err != nil {
            _ = db.Close()
            return fmt.Errorf("shutdown http server: %w", err)
        }

        if err := db.Close(); err != nil {
            return fmt.Errorf("close database: %w", err)
        }

        return nil

    case err := <-errCh:
        _ = db.Close()
        return err
    }
}
```

Catatan:

- Jangan menutup DB sebelum HTTP server berhenti menerima traffic.
- Jangan lupa background workers juga harus berhenti sebelum DB ditutup.
- In-flight transaction harus punya context deadline agar shutdown tidak menunggu terlalu lama.

---

## 15. Dependency Injection: Cara Membagikan `*sql.DB`

### 15.1 Jangan Buat Global Mutable Sembarangan

Anti-pattern:

```go
var db *sql.DB

func Init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}

func GetUser(ctx context.Context, id int64) (User, error) {
    return queryUser(ctx, db, id)
}
```

Masalah:

- sulit dites;
- lifecycle tersembunyi;
- race initialization;
- package import side effect;
- sulit multi-database;
- sulit membuat integration test isolated.

---

### 15.2 Inject ke Repository

```go
type UserRepository struct {
    db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
    if db == nil {
        panic("nil *sql.DB")
    }
    return &UserRepository{db: db}
}

func (r *UserRepository) FindByID(ctx context.Context, id int64) (User, error) {
    row := r.db.QueryRowContext(ctx, `
        SELECT id, email, name, created_at
        FROM users
        WHERE id = $1
    `, id)

    var u User
    if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt); err != nil {
        return User{}, err
    }
    return u, nil
}
```

Ini sederhana dan cukup untuk banyak aplikasi.

---

### 15.3 Interface Minimal untuk Testability

Untuk repository yang ingin bisa menerima `*sql.DB` atau `*sql.Tx`, bisa define interface kecil:

```go
type Queryer interface {
    QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
    QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
    ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
```

Lalu:

```go
type UserRepository struct {
    q Queryer
}

func NewUserRepository(q Queryer) *UserRepository {
    if q == nil {
        panic("nil queryer")
    }
    return &UserRepository{q: q}
}
```

Kelebihan:

- repository bisa dipakai dalam transaction;
- mudah test dengan fake jika perlu;
- tidak bergantung langsung pada concrete `*sql.DB`.

Kekurangan:

- jika terlalu banyak interface generik, code bisa membingungkan;
- tidak semua method DB/TX sama persis;
- transaction boundary bisa menjadi tidak eksplisit jika sembarangan.

Part repository dan transaction-aware architecture akan membahas ini lebih dalam.

---

## 16. Startup Validation Beyond Ping

`PingContext` menjawab connectivity dasar. Kadang Anda butuh validation lebih dalam.

Contoh optional startup checks:

| Check | Tujuan | Risiko jika terlalu berat |
|---|---|---|
| `PingContext` | DB reachable | Rendah |
| `SELECT 1` | Query path basic berjalan | Rendah |
| Check schema version | Migration cocok | Sedang |
| Check required extension | PostgreSQL extension tersedia | Sedang |
| Check privileges | User punya akses operasi penting | Sedang |
| Check all tables/indexes | Detect drift | Bisa berat |
| Run sample business query | Detect runtime issue | Bisa lambat dan brittle |

### 16.1 Schema Version Check

Contoh sederhana:

```go
func CheckSchemaVersion(ctx context.Context, db *sql.DB, expected int64) error {
    var actual int64
    err := db.QueryRowContext(ctx, `
        SELECT version
        FROM schema_migrations
        ORDER BY version DESC
        LIMIT 1
    `).Scan(&actual)
    if err != nil {
        return fmt.Errorf("read schema version: %w", err)
    }
    if actual < expected {
        return fmt.Errorf("schema version too old: actual=%d expected=%d", actual, expected)
    }
    return nil
}
```

Catatan:

- Ini berguna untuk fail-fast saat app membutuhkan schema minimal.
- Tapi hati-hati saat rolling deployment expand-contract; versi app lama dan baru mungkin coexist.
- Jangan membuat check yang mengunci tabel atau berat saat semua pod start bersamaan.

---

## 17. Multiple Database Handles

Beberapa aplikasi butuh lebih dari satu database target:

- primary write database;
- read replica;
- audit database;
- reporting database;
- tenant-specific database;
- legacy system database;
- outbox database;
- metadata database.

Pattern:

```go
type Databases struct {
    Primary *sql.DB
    Replica *sql.DB
    Audit   *sql.DB
}

func OpenAll(ctx context.Context, cfg Config) (*Databases, error) {
    primary, err := Open(ctx, cfg.Primary)
    if err != nil {
        return nil, fmt.Errorf("open primary database: %w", err)
    }

    replica, err := Open(ctx, cfg.Replica)
    if err != nil {
        _ = primary.Close()
        return nil, fmt.Errorf("open replica database: %w", err)
    }

    audit, err := Open(ctx, cfg.Audit)
    if err != nil {
        _ = replica.Close()
        _ = primary.Close()
        return nil, fmt.Errorf("open audit database: %w", err)
    }

    return &Databases{Primary: primary, Replica: replica, Audit: audit}, nil
}

func (d *Databases) Close() error {
    return errors.Join(
        closeDB("audit", d.Audit),
        closeDB("replica", d.Replica),
        closeDB("primary", d.Primary),
    )
}

func closeDB(name string, db *sql.DB) error {
    if db == nil {
        return nil
    }
    if err := db.Close(); err != nil {
        return fmt.Errorf("close %s database: %w", name, err)
    }
    return nil
}
```

Production notes:

- Jangan gunakan satu pool untuk target berbeda.
- Jangan confuse primary dan replica di repository.
- Pool sizing harus dihitung per target.
- Read replica readiness berbeda dari primary readiness.
- Transaction tidak bisa otomatis spanning multiple DB tanpa distributed transaction design.

---

## 18. Per-App-Type Lifecycle

### 18.1 HTTP API Service

Recommended:

- open DB saat startup;
- configure pool;
- `PingContext` startup;
- inject ke repository/service;
- expose DB stats metrics;
- readiness check DB dengan timeout/cached;
- close saat graceful shutdown.

---

### 18.2 Background Worker

Worker biasanya memiliki concurrency tinggi dan query pattern berbeda.

Recommended:

- pool size dihitung berdasarkan worker concurrency;
- startup ping wajib;
- worker loop menggunakan context cancellation;
- setiap job punya timeout;
- transaction jangan hidup sepanjang batch besar;
- close setelah worker berhenti.

---

### 18.3 CLI Tool

Untuk CLI singkat:

- open DB;
- ping dengan timeout;
- run command;
- close sebelum exit.

```go
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    db, err := database.Open(ctx, cfg.Database)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    if err := runCommand(ctx, db); err != nil {
        log.Fatal(err)
    }
}
```

---

### 18.4 Migration Job

Migration job berbeda dari app service:

- biasanya butuh exclusive operational discipline;
- pool size kecil cukup;
- timeout mungkin lebih panjang;
- harus fail-fast;
- harus log schema version;
- jangan menggunakan pool besar yang membuat migration parallel liar;
- migration lock harus explicit.

---

### 18.5 Test Integration

Untuk integration test:

- boleh membuka DB per test suite;
- jangan membuka DB per test case jika mahal;
- gunakan isolated schema/database/container;
- close di `TestMain` atau cleanup;
- set pool kecil untuk test;
- gunakan timeout agar test tidak hang.

```go
func TestMain(m *testing.M) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    db, err := database.Open(ctx, testConfig())
    if err != nil {
        fmt.Fprintf(os.Stderr, "open test db: %v\n", err)
        os.Exit(1)
    }

    code := m.Run()

    if err := db.Close(); err != nil {
        fmt.Fprintf(os.Stderr, "close test db: %v\n", err)
        os.Exit(1)
    }

    os.Exit(code)
}
```

---

## 19. Startup Error Classification

Saat `OpenDatabase` gagal, error sebaiknya bisa diklasifikasikan.

| Failure | Contoh | Kategori |
|---|---|---|
| Driver tidak dikenal | typo driver name | Config/build error |
| DSN parse gagal | malformed DSN | Config error |
| Credential salah | auth failed | Secret/config error |
| Host tidak resolve | DNS error | Infra/network error |
| Connection refused | DB down/port wrong | Infra/dependency error |
| TLS gagal | CA/cert mismatch | Security/config error |
| Timeout | network drop/DB slow | Dependency/infra error |
| Permission denied | user lacks privilege | DB authz/config error |
| Schema version mismatch | migration belum jalan | Deployment coordination error |

Ini penting untuk operational response:

```text
Config error -> rollback/redeploy/change secret.
DB down -> restore DB/failover.
Network error -> inspect DNS/security group/firewall.
Schema mismatch -> migration/deployment ordering.
```

---

## 20. Observability Saat Membuka DB

Minimal log event:

```text
level=info msg="opening database handle" database=primary driver=postgres
level=info msg="database ping succeeded" database=primary duration_ms=42
level=error msg="database ping failed" database=primary error_class=timeout duration_ms=5000
```

Jangan log:

```text
DATABASE_URL=postgres://user:supersecret@host:5432/app
```

### 20.1 Metrics yang Berguna saat Startup

- database open attempt count;
- database startup ping duration;
- database startup ping failure count;
- database readiness state;
- initial pool stats setelah ping;
- config validation failure count.

### 20.2 Jangan Buat Metrics Cardinality Tinggi

Jangan label metrics dengan raw DSN, full host dynamic, username, error message bebas, atau SQL text mentah.

Lebih aman:

```text
database="primary"
driver="postgres"
result="success|failure"
error_class="timeout|auth|dns|tls|unknown"
```

---

## 21. Health Check Design: Lebih Dalam

### 21.1 Three-Level Model

```mermaid
flowchart LR
    A[Liveness] --> B[Is process alive?]
    C[Readiness] --> D[Can receive traffic?]
    E[Dependency Diagnostics] --> F[Which dependency is degraded?]
```

| Check | Used by | Should hit DB? | Behavior |
|---|---|---|---|
| Liveness | orchestrator restart policy | Usually no | Return OK if process event loop alive |
| Readiness | load balancer/orchestrator routing | Sometimes yes, bounded/cached | Return unavailable if critical DB inaccessible |
| Diagnostics | humans/ops/internal tooling | Yes, more detailed | Show DB status, pool stats, recent failures |

---

### 21.2 Cached Readiness Example

```go
type DBReadiness struct {
    db       *sql.DB
    ttl      time.Duration
    timeout  time.Duration

    mu       sync.Mutex
    checked  time.Time
    lastErr  error
}

func NewDBReadiness(db *sql.DB, ttl, timeout time.Duration) *DBReadiness {
    return &DBReadiness{db: db, ttl: ttl, timeout: timeout}
}

func (r *DBReadiness) Check(ctx context.Context) error {
    now := time.Now()

    r.mu.Lock()
    if !r.checked.IsZero() && now.Sub(r.checked) < r.ttl {
        err := r.lastErr
        r.mu.Unlock()
        return err
    }
    r.mu.Unlock()

    pingCtx, cancel := context.WithTimeout(ctx, r.timeout)
    defer cancel()

    err := r.db.PingContext(pingCtx)

    r.mu.Lock()
    r.checked = now
    r.lastErr = err
    r.mu.Unlock()

    if err != nil {
        return fmt.Errorf("database readiness ping: %w", err)
    }
    return nil
}
```

Catatan:

- Ini menekan frequency ping ke DB.
- TTL harus pendek, misalnya 2–10 detik tergantung criticality.
- Jangan cache terlalu lama untuk readiness critical.

---

## 22. `sql.Conn`: Kapan Dibuka Manual?

Normalnya Anda tidak perlu memanggil `db.Conn(ctx)`. `sql.DB` akan mengambil connection dari pool otomatis untuk `QueryContext`/`ExecContext`.

Gunakan `sql.Conn` saat Anda butuh satu database session yang sama tanpa transaction, misalnya:

- session-level variable;
- temporary table yang terikat session;
- advisory lock session-level;
- driver-specific raw connection operation;
- beberapa statement harus berada pada connection yang sama tetapi bukan transaction;
- debugging session behavior.

Contoh:

```go
conn, err := db.Conn(ctx)
if err != nil {
    return fmt.Errorf("acquire dedicated connection: %w", err)
}
defer conn.Close() // returns connection to pool

if _, err := conn.ExecContext(ctx, `SET application_name = 'maintenance-job'`); err != nil {
    return fmt.Errorf("set session variable: %w", err)
}

// operations on same DB session
```

Risiko:

- lupa `Conn.Close` membuat connection leak;
- dedicated connection mengurangi pool capacity;
- bisa deadlock jika pool kecil dan code menunggu connection lain;
- session state bisa bocor jika tidak di-reset oleh driver/pool.

Untuk transaction, gunakan `BeginTx`, bukan `Conn` manual kecuali ada alasan kuat.

---

## 23. Initialization Order yang Benar

Urutan yang direkomendasikan:

```text
1. Load raw config
2. Validate config
3. Build DSN/Connector
4. sql.Open/sql.OpenDB
5. Configure pool
6. PingContext startup timeout
7. Optional schema/privilege checks
8. Construct repositories/services
9. Start metrics and health endpoints
10. Start accepting traffic
```

Anti-pattern:

```text
1. Start HTTP server
2. First request triggers sql.Open
3. First query discovers bad credentials
4. User request fails
5. Incident starts
```

---

## 24. Code: Complete Minimal Example

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    _ "github.com/lib/pq"
)

type DatabaseConfig struct {
    Driver          string
    DSN             string
    StartupTimeout  time.Duration
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxIdleTime time.Duration
    ConnMaxLifetime time.Duration
}

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    cfg := DatabaseConfig{
        Driver:          "postgres",
        DSN:             os.Getenv("DATABASE_URL"),
        StartupTimeout:  5 * time.Second,
        MaxOpenConns:    20,
        MaxIdleConns:    10,
        ConnMaxIdleTime: 5 * time.Minute,
        ConnMaxLifetime: 30 * time.Minute,
    }

    db, err := OpenDatabase(rootCtx, cfg, logger)
    if err != nil {
        logger.Error("database startup failed", "error", err)
        os.Exit(1)
    }

    mux := http.NewServeMux()
    mux.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte("ok"))
    })
    mux.HandleFunc("/ready", readinessHandler(db))

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second,
    }

    errCh := make(chan error, 1)
    go func() {
        logger.Info("http server starting", "addr", srv.Addr)
        errCh <- srv.ListenAndServe()
    }()

    select {
    case <-rootCtx.Done():
        logger.Info("shutdown signal received")
    case err := <-errCh:
        if err != nil && !errors.Is(err, http.ErrServerClosed) {
            logger.Error("http server failed", "error", err)
            _ = db.Close()
            os.Exit(1)
        }
    }

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
    defer cancel()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        logger.Error("http server shutdown failed", "error", err)
    }

    if err := db.Close(); err != nil {
        logger.Error("database close failed", "error", err)
    }

    logger.Info("shutdown complete")
}

func OpenDatabase(ctx context.Context, cfg DatabaseConfig, logger *slog.Logger) (*sql.DB, error) {
    if err := validateDatabaseConfig(cfg); err != nil {
        return nil, fmt.Errorf("validate database config: %w", err)
    }

    logger.Info("opening database handle", "driver", cfg.Driver)

    db, err := sql.Open(cfg.Driver, cfg.DSN)
    if err != nil {
        return nil, fmt.Errorf("open database handle: %w", err)
    }

    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

    pingCtx, cancel := context.WithTimeout(ctx, cfg.StartupTimeout)
    defer cancel()

    start := time.Now()
    if err := db.PingContext(pingCtx); err != nil {
        _ = db.Close()
        return nil, fmt.Errorf("ping database: %w", err)
    }

    logger.Info(
        "database ping succeeded",
        "driver", cfg.Driver,
        "duration_ms", time.Since(start).Milliseconds(),
    )

    return db, nil
}

func validateDatabaseConfig(cfg DatabaseConfig) error {
    var errs []error

    if cfg.Driver == "" {
        errs = append(errs, errors.New("driver is required"))
    }
    if cfg.DSN == "" {
        errs = append(errs, errors.New("dsn is required"))
    }
    if cfg.StartupTimeout <= 0 {
        errs = append(errs, errors.New("startup timeout must be positive"))
    }
    if cfg.MaxOpenConns < 0 {
        errs = append(errs, errors.New("max open conns cannot be negative"))
    }
    if cfg.MaxIdleConns < 0 {
        errs = append(errs, errors.New("max idle conns cannot be negative"))
    }
    if cfg.ConnMaxIdleTime < 0 {
        errs = append(errs, errors.New("conn max idle time cannot be negative"))
    }
    if cfg.ConnMaxLifetime < 0 {
        errs = append(errs, errors.New("conn max lifetime cannot be negative"))
    }

    return errors.Join(errs...)
}

func readinessHandler(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
        defer cancel()

        if err := db.PingContext(ctx); err != nil {
            http.Error(w, "not ready", http.StatusServiceUnavailable)
            return
        }

        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte("ready"))
    }
}
```

---

## 25. Mermaid: Open Handle Sequence

```mermaid
sequenceDiagram
    participant Main as main()
    participant Config as Config Loader
    participant SQL as database/sql
    participant Driver as Driver
    participant DB as Database Server

    Main->>Config: Load database config
    Config-->>Main: Config
    Main->>Main: Validate config
    Main->>SQL: sql.Open(driver, dsn)
    SQL->>Driver: Locate registered driver
    Driver-->>SQL: Validate/prepare handle config
    SQL-->>Main: *sql.DB handle
    Main->>SQL: Set pool limits
    Main->>SQL: PingContext(timeout)
    SQL->>Driver: Open/Connect if needed
    Driver->>DB: Dial/auth/handshake
    DB-->>Driver: OK
    Driver-->>SQL: connection alive
    SQL-->>Main: nil error
    Main->>Main: Inject DB into app dependencies
```

---

## 26. Mermaid: Wrong vs Correct Handle Ownership

```mermaid
flowchart TB
    subgraph Wrong[Wrong: open per request]
        A1[HTTP Request] --> B1[sql.Open]
        B1 --> C1[New pool]
        C1 --> D1[Query]
        D1 --> E1[db.Close]
        E1 --> F1[Connection churn]
    end

    subgraph Correct[Correct: open once at startup]
        A2[Process Startup] --> B2[sql.Open]
        B2 --> C2[Configure pool]
        C2 --> D2[PingContext]
        D2 --> E2[Shared *sql.DB]
        E2 --> F2[Requests use pool]
        F2 --> G2[Close at shutdown]
    end
```

---

## 27. Common Anti-Patterns

### 27.1 Opening Per Request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("postgres", dsn)
    defer db.Close()
}
```

Consequence:

- pool explosion;
- database overload;
- latency spike;
- hard-to-debug connection storm.

---

### 27.2 No Startup Ping

```go
db, err := sql.Open("postgres", dsn)
if err != nil {
    return err
}
return db, nil
```

Consequence:

- bad credentials discovered on first user request;
- deployment appears successful but service fails at runtime;
- readiness may become misleading.

---

### 27.3 Ping Without Timeout

```go
if err := db.Ping(); err != nil {
    return err
}
```

Consequence:

- startup can hang;
- shutdown can be delayed;
- deployment pipeline can wait unpredictably;
- bad network behavior becomes application freeze.

---

### 27.4 Logging Raw DSN

```go
log.Printf("dsn=%s", dsn)
```

Consequence:

- credential leak;
- audit finding;
- incident severity increases;
- logs become sensitive data store.

---

### 27.5 Closing DB Too Early

```go
func NewRepository() *Repository {
    db, _ := sql.Open("postgres", dsn)
    defer db.Close()
    return &Repository{db: db}
}
```

Consequence:

- repository gets closed handle;
- later query fails;
- error appears far from root cause.

---

### 27.6 Global Hidden Initialization

```go
func init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}
```

Consequence:

- import side effect;
- difficult tests;
- no explicit startup error handling;
- order-dependent behavior.

---

### 27.7 Unbounded Pool in Multi-Pod Deployment

```go
// no SetMaxOpenConns
```

Consequence:

- each pod can grow connections as needed;
- total cluster connection count can exceed DB capacity;
- database becomes bottleneck under burst;
- recovery causes connection storm.

---

## 28. Production Opening Checklist

Use this checklist during code review.

### 28.1 Config

- [ ] DB config loaded outside repository code.
- [ ] Config validation exists.
- [ ] Required fields checked.
- [ ] Duration fields have sane defaults.
- [ ] DSN/password are never logged raw.
- [ ] Driver-specific defaults are explicit.
- [ ] TLS/SSL mode is intentional per environment.

### 28.2 Handle Creation

- [ ] `sql.Open` or `sql.OpenDB` called once per logical database target.
- [ ] Driver imported exactly where intended.
- [ ] `sql.Open` error handled.
- [ ] Pool settings applied before first query/ping.
- [ ] `PingContext` used for startup validation.
- [ ] Startup ping has bounded timeout.
- [ ] Failed ping closes temporary handle.

### 28.3 Lifecycle

- [ ] `*sql.DB` injected into dependencies.
- [ ] No `sql.Open` per request/job.
- [ ] No `db.Close` per request/job.
- [ ] DB closed during process shutdown.
- [ ] HTTP server stops before DB close.
- [ ] Background workers stop before DB close.

### 28.4 Health

- [ ] Liveness does not depend on DB unless justified.
- [ ] Readiness checks critical DB only.
- [ ] Readiness DB check has timeout.
- [ ] Readiness check is not too expensive.
- [ ] Diagnostic endpoint redacts sensitive info.

### 28.5 Observability

- [ ] Startup ping duration logged/metriced.
- [ ] Startup error classified.
- [ ] Pool stats exposed.
- [ ] Driver/database label cardinality controlled.
- [ ] Raw DSN not included in logs/metrics/traces.

---

## 29. Architecture Review Questions

Saat mereview service Go dengan database, tanyakan:

1. Di mana `*sql.DB` dibuat?
2. Apakah dibuat sekali atau berkali-kali?
3. Apakah `sql.Open` error dan `PingContext` error dibedakan secara mental?
4. Apakah startup validation memakai timeout?
5. Apakah pool dikonfigurasi sebelum handle dipakai?
6. Apakah angka pool mempertimbangkan jumlah pod?
7. Apakah DB handle ditutup saat graceful shutdown?
8. Apakah background worker bisa memakai DB setelah DB ditutup?
9. Apakah readiness check bisa membebani DB?
10. Apakah DSN/credential bisa bocor ke log?
11. Apakah schema compatibility dicek di tempat yang tepat?
12. Apakah multi-database dependency punya lifecycle masing-masing?
13. Apakah test membuka DB dengan lifecycle jelas?
14. Apakah repository menerima dependency, bukan membuat DB sendiri?
15. Apakah failure saat startup menghasilkan error yang bisa ditindaklanjuti?

---

## 30. Failure Scenario: Bad Credential at Deploy

### Scenario

Secret database password salah setelah deployment.

### Jika Tidak Ada `PingContext`

```mermaid
sequenceDiagram
    participant Deploy as Deployment
    participant App as App Pod
    participant User as User Request
    participant DB as DB

    Deploy->>App: Start pod
    App->>App: sql.Open succeeds
    App-->>Deploy: Pod appears running
    User->>App: First API request
    App->>DB: Query/auth
    DB-->>App: authentication failed
    App-->>User: 500
```

Masalah:

- deployment terlihat sukses;
- error muncul sebagai runtime 500;
- user impact terjadi sebelum operator tahu;
- rollback decision terlambat.

### Dengan Startup `PingContext`

```mermaid
sequenceDiagram
    participant Deploy as Deployment
    participant App as App Pod
    participant DB as DB

    Deploy->>App: Start pod
    App->>App: sql.Open succeeds
    App->>DB: Ping/auth
    DB-->>App: authentication failed
    App-->>Deploy: startup failed
```

Keuntungan:

- bad secret terdeteksi sebelum traffic;
- orchestrator tidak route ke pod;
- rollback lebih cepat;
- error lebih dekat ke root cause.

---

## 31. Failure Scenario: DB Down During Startup

Ada dua possible strategies.

### 31.1 Fail-Fast

```text
DB down -> startup failed -> pod restart/retry
```

Baik jika service tidak berguna tanpa DB.

Risiko:

- restart loop;
- thundering herd saat DB pulih;
- noisy alerts.

### 31.2 Start but Not Ready

```text
DB down -> process starts -> liveness OK -> readiness false -> no traffic
```

Baik jika:

- butuh diagnostics endpoint;
- dependency bisa pulih tanpa restart;
- app punya non-DB function;
- ingin menghindari restart storm.

Implementation variant:

```go
func OpenLazy(cfg Config) (*sql.DB, error) {
    if err := cfg.Validate(); err != nil {
        return nil, err
    }

    db, err := sql.Open(cfg.Driver, cfg.DSN)
    if err != nil {
        return nil, err
    }

    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

    return db, nil
}
```

Lalu readiness yang menentukan traffic eligibility.

---

## 32. Deep Dive: Kenapa `Open` Lazy?

`database/sql` didesain sebagai abstraction atas banyak driver. Membuka handle tidak harus sama dengan membuka network connection karena:

- driver mungkin hanya bisa validate DSN saat itu;
- connection bisa dibuat on-demand sesuai pool need;
- pool bisa membuka connection parallel saat workload masuk;
- beberapa driver punya connector abstraction;
- proses startup tidak selalu ingin block pada network;
- handle adalah coordinator, bukan connection.

Ini mirip membuat object `DataSource`, bukan memanggil `getConnection()`.

Consequence positif:

- startup bisa ringan;
- app bisa membuat handle sebelum dependency ready jika memang ingin lazy;
- pool bisa mengelola connection lifecycle sendiri.

Consequence negatif:

- developer bisa salah mengira DB sudah reachable;
- config secret error bisa terlambat diketahui;
- bad deployment terlihat sukses;
- first request bisa menjadi korban.

Solusinya bukan membenci lazy open, tetapi membuat startup policy eksplisit.

---

## 33. Driver-Specific Considerations saat Opening

Walaupun `database/sql` memberi abstraction, opening behavior tetap driver-specific.

Perhatikan:

- nama driver;
- DSN format;
- placeholder style nanti saat query;
- time zone config;
- TLS config;
- connect timeout;
- read/write timeout;
- context cancellation support;
- auth mechanism;
- cloud IAM auth;
- Unix socket vs TCP;
- application name/session variable;
- server-side prepared statement behavior;
- handling bad connection.

### 33.1 Structured Config Lebih Aman daripada Raw String

Raw DSN mudah salah escaping.

Prefer driver config builder jika tersedia:

```go
cfg := mysql.NewConfig()
cfg.User = username
cfg.Passwd = password
cfg.Net = "tcp"
cfg.Addr = net.JoinHostPort(host, strconv.Itoa(port))
cfg.DBName = database
cfg.ParseTime = true

dsn := cfg.FormatDSN()
```

Untuk PostgreSQL driver tertentu, Anda bisa memakai URL DSN atau keyword/value DSN. Pilih style yang paling readable dan paling aman untuk redaction di organisasi Anda.

---

## 34. Security Boundary Saat Opening DB

Opening DB menyentuh security boundary:

- credential loading;
- credential rotation;
- TLS certificate;
- hostname verification;
- least privilege DB user;
- logging redaction;
- audit event;
- secret manager integration;
- environment variable exposure.

### 34.1 Least Privilege

Aplikasi tidak seharusnya memakai superuser DB.

Pisahkan user jika perlu:

| DB User | Purpose |
|---|---|
| `app_rw` | normal read/write aplikasi |
| `app_ro` | read replica/reporting |
| `migration` | schema migration |
| `admin` | manual DBA operation, tidak dipakai app |

### 34.2 Rotation

Jika password/credential dirotasi, connection existing mungkin tetap hidup sampai reconnect. `ConnMaxLifetime` membantu memastikan connection lama eventually diganti.

Namun rotation strategy bergantung pada DB dan driver:

- apakah existing session tetap valid?
- apakah new connection butuh password baru?
- apakah secret reload dynamic?
- apakah process restart dibutuhkan?
- apakah pool lifetime cukup pendek untuk rotation window?

---

## 35. Comparison with Spring Boot/HikariCP

### 35.1 Apa yang Biasanya Dilakukan Spring Boot

Dalam Spring Boot:

- config dibaca dari `application.yml`/env;
- `DataSource` dibuat otomatis;
- HikariCP menjadi pool umum;
- Actuator bisa expose health;
- transaction manager dibuat;
- repository/JPA/JdbcTemplate memakai datasource;
- lifecycle diurus container.

### 35.2 Apa yang Harus Anda Lakukan di Go

Di Go:

- Anda load config sendiri;
- Anda memilih driver;
- Anda `sql.Open`/`sql.OpenDB`;
- Anda set pool;
- Anda ping dengan timeout;
- Anda inject ke repository;
- Anda expose health/metrics;
- Anda close saat shutdown.

Ini bukan kekurangan. Ini memberi kontrol eksplisit.

### 35.3 Mental Shift

| Java mindset | Go mindset |
|---|---|
| Framework creates datasource | Application composition creates `*sql.DB` |
| Annotation hides transaction boundary | Function call owns transaction boundary |
| Auto health indicator | Explicit health handler |
| Pool tuning via properties | Pool tuning via code/config applied at startup |
| Runtime proxy magic | Constructor injection and plain structs |
| Exception taxonomy from framework | Error wrapping/classification explicitly designed |

---

## 36. Production Defaults: Example Starting Point

Ini bukan angka universal, tetapi starting point yang lebih aman daripada implicit default untuk service kecil-menengah:

```go
DatabaseConfig{
    StartupTimeout:  5 * time.Second,
    MaxOpenConns:    10,
    MaxIdleConns:    5,
    ConnMaxIdleTime: 5 * time.Minute,
    ConnMaxLifetime: 30 * time.Minute,
}
```

Namun angka final harus ditentukan dari:

```text
total_connections = replicas * max_open_conns_per_replica
```

Pastikan:

```text
total_connections + admin_headroom + migration_headroom <= database_connection_capacity
```

Example:

```text
Database max connections: 300
Reserved admin: 20
Reserved migration/ops: 20
Usable for app: 260
Replica count: 10
MaxOpenConns per replica <= 26
```

Jika Anda set `MaxOpenConns=50` di 10 pod:

```text
10 * 50 = 500 possible app connections
```

Itu bisa melebihi DB capacity bahkan sebelum traffic real mencapai puncak.

---

## 37. Edge Cases

### 37.1 DNS Berubah Setelah Startup

Jika database endpoint berubah, existing connections bisa tetap ke old target sampai ditutup. `ConnMaxLifetime` dapat membantu connection refresh. Tetapi behavior juga tergantung driver, resolver, OS DNS cache, dan network topology.

### 37.2 Database Failover

Saat failover:

- existing connections bisa reset;
- idle connections bisa stale;
- ping bisa succeed sebelum semua query sehat;
- transaction in-flight bisa ambiguous;
- retry policy harus hati-hati.

Opening code tidak menyelesaikan failover sepenuhnya, tetapi `ConnMaxLifetime`, timeout, readiness, dan error classification adalah fondasi.

### 37.3 Connection Pooler

Jika memakai PgBouncer/RDS Proxy/Cloud SQL connector:

- app pool masih ada;
- external pooler juga punya pool;
- transaction/session pooling mode bisa mempengaruhi prepared statement/session variable;
- health check sebaiknya tahu target sebenarnya;
- pool sizing harus end-to-end.

### 37.4 Serverless atau Short-Lived Process

Untuk serverless-like environment:

- cold start membuka DB handle;
- concurrency model berbeda;
- connection reuse antar invocation tergantung runtime;
- external pooler sering diperlukan;
- max connection perlu sangat hati-hati.

---

## 38. Latihan

### Latihan 1 — Identifikasi Bug

Kode:

```go
func CreateOrder(ctx context.Context, order Order) error {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        return err
    }
    defer db.Close()

    _, err = db.ExecContext(ctx, `INSERT INTO orders(id, amount) VALUES($1, $2)`, order.ID, order.Amount)
    return err
}
```

Pertanyaan:

1. Apa bug lifecycle-nya?
2. Apa dampaknya di traffic tinggi?
3. Bagaimana refactor-nya?

Expected answer:

- `sql.Open` per call membuat pool baru.
- `Close` per call menghancurkan reuse.
- Refactor: buat `*sql.DB` di startup, inject repository/service.

---

### Latihan 2 — Startup Strategy

Service A punya 100% endpoint butuh DB. Service B punya sebagian endpoint diagnostic dan static config yang tidak butuh DB.

Tentukan:

- mana fail-fast;
- mana start degraded;
- readiness behavior;
- liveness behavior.

---

### Latihan 3 — Pool Capacity

Database max connection 500. Reserved admin 30. Reserved migration/ops 20. Ada 15 pod API dan 5 pod worker. Anda ingin worker boleh memakai 2x connection API.

Buat alokasi awal `MaxOpenConns`.

Hint:

```text
usable = 500 - 30 - 20 = 450
15A + 5W <= 450
W = 2A
15A + 10A = 25A <= 450
A <= 18
W <= 36
```

Jadi starting allocation bisa:

```text
API MaxOpenConns: 15-18
Worker MaxOpenConns: 30-36
```

Sisakan headroom lagi jika ada batch job lain.

---

## 39. Ringkasan

Part ini membangun fondasi database lifecycle di Go.

Key takeaways:

1. `*sql.DB` adalah long-lived pool handle, bukan single connection.
2. `sql.Open` membuat handle; ia tidak menjamin database sudah reachable.
3. Gunakan `PingContext` dengan timeout untuk startup validation jika service harus fail-fast.
4. Gunakan `sql.OpenDB` saat driver connector memberi config/control lebih baik.
5. Pool harus dikonfigurasi sebelum handle dipakai.
6. Jangan membuka/menutup DB per request.
7. Jangan log DSN mentah.
8. Pisahkan liveness, readiness, dan diagnostics.
9. Close DB saat graceful shutdown, setelah traffic dan worker berhenti.
10. Treat database initialization sebagai architecture boundary, bukan boilerplate.

---

## 40. Preview Part Berikutnya

Part berikutnya:

```text
learn-go-sql-database-integration-part-004.md
Driver Model and Driver Selection
```

Kita akan membahas:

- bagaimana driver bekerja di balik `database/sql`;
- apa yang benar-benar di-standardisasi oleh Go;
- apa yang tetap driver-specific;
- cara memilih driver PostgreSQL/MySQL/SQLite/SQL Server/Oracle;
- pure Go vs CGO;
- context cancellation support;
- maturity checklist;
- production driver selection matrix.

---

## 41. Referensi Utama

- Go documentation — Opening a database handle: `https://go.dev/doc/database/open-handle`
- Go documentation — Managing connections: `https://go.dev/doc/database/manage-connections`
- Go package documentation — `database/sql`: `https://pkg.go.dev/database/sql`
- Go package documentation — `database/sql/driver`: `https://pkg.go.dev/database/sql/driver`
- Go documentation — Executing transactions: `https://go.dev/doc/database/execute-transactions`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-sql-database-integration-part-002.md">⬅️ Part 002 — Anatomy of `database/sql`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-sql-database-integration-part-004.md">Driver Model and Driver Selection ➡️</a>
</div>
