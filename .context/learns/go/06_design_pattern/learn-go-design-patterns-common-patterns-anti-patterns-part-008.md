# learn-go-design-patterns-common-patterns-anti-patterns-part-008.md

# Part 008 — Configuration Pattern

> Seri: **Go Design Patterns, Common Patterns, and Anti-Patterns**  
> Target pembaca: **Java software engineer yang ingin menulis Go production-grade**  
> Fokus: **configuration as operational contract**  
> Baseline: **Go 1.26.x**

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- package sebagai unit desain utama Go,
- API surface sebagai boundary of promise,
- interface placement,
- constructor dan initialization,
- functional options.

Part ini masuk ke topik yang sering terlihat sederhana, tetapi di production sangat menentukan stabilitas sistem: **configuration pattern**.

Configuration bukan sekadar membaca environment variable. Configuration adalah **kontrak antara kode, deployment environment, operator, security policy, SRE, CI/CD, dan runtime behavior aplikasi**.

Dalam sistem kecil, config sering terasa seperti detail teknis:

```go
port := os.Getenv("PORT")
```

Dalam sistem besar, config adalah sumber banyak incident:

- service start dengan default salah,
- credential tidak terbaca tetapi fallback diam-diam,
- timeout tidak diset sehingga request menggantung,
- retry terlalu agresif dan menyebabkan downstream collapse,
- feature flag aktif di environment yang salah,
- secret tercetak di log,
- config berubah tetapi tidak jelas apakah runtime ikut berubah,
- satu package membaca env sendiri sehingga behavior sulit diaudit,
- test passing tetapi production gagal karena config path berbeda.

Karena itu, dalam Go production-grade, configuration harus didesain sebagai **first-class boundary**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Mendesain configuration package yang eksplisit, stabil, dan mudah diaudit.
2. Membedakan config loading, config representation, config validation, dan runtime dependency.
3. Memutuskan kapan memakai env var, file, flag, secret manager, atau remote config.
4. Membuat config yang aman terhadap silent misconfiguration.
5. Mendesain default yang defensible.
6. Membedakan immutable startup config dan reloadable runtime config.
7. Menghindari global config singleton.
8. Menghindari membaca env di sembarang package.
9. Mendesain config untuk multi-environment deployment.
10. Mendesain config yang testable, observable, dan compatible dengan deployment modern.

---

## 2. Core Thesis

> **Configuration is not data. Configuration is operational policy.**

Config menentukan bagaimana aplikasi berperilaku di luar source code:

- port,
- timeout,
- retry count,
- database DSN,
- pool size,
- logging level,
- feature flags,
- token TTL,
- external endpoint,
- rate limit,
- circuit breaker threshold,
- cache TTL,
- worker concurrency,
- graceful shutdown timeout,
- tracing exporter,
- secret reference.

Karena config mengubah behavior sistem, maka config harus diperlakukan seperti desain API:

- punya schema,
- punya validation,
- punya defaulting rule,
- punya ownership,
- punya compatibility policy,
- punya observability,
- punya failure behavior.

---

## 3. Mental Model: Configuration Pipeline

Configuration sebaiknya dilihat sebagai pipeline, bukan sebagai `os.Getenv` yang tersebar.

```mermaid
flowchart TD
    A[Sources] --> B[Raw Load]
    B --> C[Parse]
    C --> D[Merge]
    D --> E[Normalize]
    E --> F[Default]
    F --> G[Validate]
    G --> H[Freeze]
    H --> I[Wire Dependencies]
    I --> J[Runtime]

    A1[Env Vars] --> A
    A2[Flags] --> A
    A3[Config File] --> A
    A4[Secret Manager] --> A
    A5[Remote Config] --> A

    G --> K[Fail Fast on Invalid Config]
    H --> L[Safe Snapshot]
```

Setiap tahap punya tanggung jawab berbeda.

| Tahap | Tujuan | Contoh |
|---|---|---|
| Source | Dari mana nilai berasal | env, file, flag, secret manager |
| Raw load | Ambil nilai mentah | string dari env |
| Parse | Ubah string ke tipe | duration, int, bool, URL |
| Merge | Gabungkan beberapa sumber | file + env override |
| Normalize | Rapikan bentuk | trim trailing slash endpoint |
| Default | Isi nilai yang tidak diberikan | timeout default 2s |
| Validate | Pastikan valid | max pool >= min pool |
| Freeze | Jadikan immutable | config struct final |
| Wire | Bangun dependency | DB, HTTP client, logger |
| Runtime | Jalankan sistem | service behavior |

Anti-pattern paling umum adalah melewati pipeline ini dan langsung membaca source dari deep package.

```go
func NewClient() *Client {
    endpoint := os.Getenv("PAYMENT_ENDPOINT")
    timeout := os.Getenv("PAYMENT_TIMEOUT")
    // ...
}
```

Masalahnya:

- dependency tersembunyi,
- test susah,
- validasi tersebar,
- default tidak konsisten,
- behavior sulit diaudit,
- package menjadi bergantung pada deployment environment.

---

## 4. Java Mindset vs Go Mindset

### 4.1 Java Mindset yang Sering Terbawa

Java production apps sering memakai framework seperti Spring Boot, MicroProfile Config, Quarkus Config, atau Jakarta ecosystem. Biasanya ada:

- annotation injection,
- property binding,
- profile-based config,
- auto validation,
- config refresh abstraction,
- centralized framework lifecycle.

Contoh Java-ish mindset:

```java
@Value("${payment.timeout}")
private Duration timeout;
```

Atau:

```java
@ConfigurationProperties(prefix = "payment")
public class PaymentProperties {
    private URI endpoint;
    private Duration timeout;
}
```

Itu nyaman karena framework mengatur binding, validation, lifecycle, dan injection.

Namun kalau mindset ini dibawa mentah-mentah ke Go, sering muncul bentuk seperti:

```go
var Config = LoadGlobalConfig()
```

atau:

```go
func GetPaymentTimeout() time.Duration {
    return globalConfig.Payment.Timeout
}
```

atau:

```go
type UserService struct {
    cfg *config.Config
}
```

Padahal service itu hanya butuh beberapa nilai spesifik, bukan seluruh config aplikasi.

---

### 4.2 Go Mindset

Go lebih cocok dengan model:

1. Load config di composition root.
2. Validate config sebelum dependency dibangun.
3. Pass hanya config subset yang dibutuhkan ke constructor.
4. Ubah config menjadi dependency konkret, bukan dibaca terus menerus.
5. Hindari config global mutable.
6. Runtime reload harus eksplisit.

```go
func main() {
    cfg, err := config.Load(config.Sources{
        Env:   os.Environ(),
        Args:  os.Args[1:],
        Files: []string{"config.yaml"},
    })
    if err != nil {
        log.Fatal(err)
    }

    if err := cfg.Validate(); err != nil {
        log.Fatal(err)
    }

    app, err := wireApp(cfg)
    if err != nil {
        log.Fatal(err)
    }

    app.Run()
}
```

Deep package tidak tahu dari mana config berasal.

```go
client := payment.NewClient(payment.Config{
    Endpoint: cfg.Payment.Endpoint,
    Timeout:  cfg.Payment.Timeout,
})
```

Package `payment` hanya tahu config yang relevan untuk dirinya.

---

## 5. Configuration Is a Boundary, Not a Bag

Config sering rusak ketika dianggap sebagai “bag of settings”.

```go
type Config struct {
    AppName string
    Env string
    DBHost string
    DBUser string
    DBPassword string
    RedisHost string
    PaymentEndpoint string
    PaymentTimeout time.Duration
    WorkerCount int
    LogLevel string
    FeatureA bool
    FeatureB bool
    // terus membesar...
}
```

Struct seperti ini mungkin masih wajar sebagai root config, tetapi tidak seharusnya disuntikkan ke semua package.

Buruk:

```go
type OrderService struct {
    cfg *config.Config
}
```

Lebih baik:

```go
type OrderServiceConfig struct {
    MaxItemsPerOrder int
    EnableFraudCheck bool
}

type OrderService struct {
    maxItemsPerOrder int
    fraudCheckEnabled bool
}

func NewOrderService(cfg OrderServiceConfig) (*OrderService, error) {
    if cfg.MaxItemsPerOrder <= 0 {
        return nil, fmt.Errorf("max items per order must be positive")
    }

    return &OrderService{
        maxItemsPerOrder: cfg.MaxItemsPerOrder,
        fraudCheckEnabled: cfg.EnableFraudCheck,
    }, nil
}
```

Root config boleh besar. Dependency config harus kecil.

---

## 6. Configuration Ownership Model

A production Go service biasanya memiliki beberapa level ownership.

```mermaid
flowchart LR
    Root[Root Config Package] --> App[Application Wiring]
    App --> HTTP[HTTP Server Config]
    App --> DB[Database Config]
    App --> Redis[Redis Config]
    App --> Payment[Payment Client Config]
    App --> Worker[Worker Config]
    App --> Obs[Observability Config]

    HTTP --> HTTPServer[http.Server]
    DB --> DBPool[sql.DB]
    Payment --> PaymentClient[Payment Client]
    Worker --> JobRunner[Job Runner]
```

### 6.1 Root Config Owner

Root config package bertanggung jawab untuk:

- source loading,
- parsing,
- defaulting,
- validation global,
- redacted rendering,
- documentation of config schema.

### 6.2 Component Config Owner

Component package bertanggung jawab untuk:

- menerima config minimal yang relevan,
- validasi invariant komponen,
- menyimpan nilai final dalam bentuk yang mudah dipakai,
- tidak membaca env/file/secret sendiri.

### 6.3 Composition Root Owner

Composition root bertanggung jawab untuk:

- mapping root config ke component config,
- membuat dependency,
- menentukan lifetime,
- fail fast kalau dependency gagal dibuat.

---

## 7. Config Source Patterns

### 7.1 Environment Variables

Env var cocok untuk:

- containerized deployment,
- secrets reference,
- endpoint sederhana,
- runtime environment marker,
- per-deployment override.

Contoh:

```text
APP_ENV=prod
HTTP_ADDR=:8080
DB_MAX_OPEN_CONNS=50
PAYMENT_TIMEOUT=2s
```

Kelebihan:

- native di container/Kubernetes,
- mudah di-inject dari CI/CD,
- tidak perlu file mount,
- cocok untuk twelve-factor style.

Kekurangan:

- semua nilai string,
- tidak ada schema bawaan,
- raw env sulit diaudit bila tersebar,
- typo bisa silent kalau tidak divalidasi,
- secret raw env bisa bocor lewat process inspection/logging pada beberapa platform.

Pattern:

```go
func getEnv(env map[string]string, key string) (string, bool) {
    v, ok := env[key]
    return v, ok
}
```

Daripada memanggil `os.Getenv` di banyak tempat, load env sekali menjadi map.

```go
func environMap(values []string) map[string]string {
    out := make(map[string]string, len(values))
    for _, kv := range values {
        k, v, ok := strings.Cut(kv, "=")
        if !ok {
            continue
        }
        out[k] = v
    }
    return out
}
```

Dengan begini, config loader testable tanpa mutate global process env.

---

### 7.2 Command-Line Flags

Flags cocok untuk:

- local tools,
- CLI,
- one-off job,
- admin command,
- binary behavior sederhana.

Contoh:

```go
var addr string
flag.StringVar(&addr, "http-addr", ":8080", "HTTP listen address")
flag.Parse()
```

Untuk service besar, flags biasanya kurang ideal sebagai source utama karena:

- panjang,
- sulit dikelola di deployment manifest,
- tidak cocok untuk secret,
- cenderung membuat startup command sulit dibaca.

Namun flags bagus sebagai override untuk local run dan tools.

---

### 7.3 Config File

File cocok untuk:

- config terstruktur,
- banyak field,
- nested config,
- local development,
- versioned deployment manifest,
- non-secret settings.

Contoh YAML/JSON/TOML dapat dipakai, tetapi prinsipnya sama:

```yaml
http:
  addr: ":8080"
  read_timeout: "5s"
  write_timeout: "10s"

database:
  max_open_conns: 50
  max_idle_conns: 10
  conn_max_lifetime: "30m"

payment:
  endpoint: "https://payment.example.com"
  timeout: "2s"
```

Kelebihan:

- readable,
- structured,
- mudah direview,
- cocok untuk config non-secret.

Kekurangan:

- butuh parser eksternal jika bukan JSON,
- reload semantics harus jelas,
- secret dalam file raw berisiko,
- file path berbeda antar environment.

Go standard library punya `encoding/json`, tetapi YAML/TOML biasanya butuh external package. Dalam seri ini kita fokus pattern, bukan memilih library tertentu.

---

### 7.4 Secret Manager

Secret berbeda dari config biasa.

Secret mencakup:

- DB password,
- API key,
- signing key,
- token credential,
- private key,
- OAuth client secret.

Secret source bisa berupa:

- Kubernetes Secret,
- AWS Secrets Manager,
- AWS SSM Parameter Store,
- HashiCorp Vault,
- GCP Secret Manager,
- Azure Key Vault,
- injected file,
- injected env var.

Pattern penting:

- jangan log secret,
- jangan masukkan secret ke redacted config output,
- jangan jadikan secret sebagai field public yang mudah tercetak,
- jangan default secret,
- fail fast jika secret required tidak ada,
- pisahkan secret value dari secret reference bila memungkinkan.

Buruk:

```go
log.Printf("config: %+v", cfg)
```

Lebih aman:

```go
log.Printf("config: %s", cfg.RedactedString())
```

---

### 7.5 Remote Config

Remote config cocok untuk:

- feature flag,
- rollout control,
- dynamic throttling,
- experiment,
- kill switch.

Tetapi remote config berbahaya bila digunakan untuk semua hal.

Masalah remote config:

- availability dependency,
- startup dependency,
- consistency delay,
- auditability,
- race condition saat reload,
- partial update,
- rollback semantics,
- security boundary.

Rule praktis:

- startup-critical config sebaiknya lokal atau sudah tersedia sebelum service start,
- remote config untuk policy yang aman berubah saat runtime,
- schema dan validation tetap wajib,
- perubahan harus observable,
- fallback harus eksplisit.

---

## 8. Source Precedence Pattern

Jika config berasal dari banyak source, precedence harus eksplisit.

Contoh precedence umum:

```text
1. Command-line flag
2. Environment variable
3. Config file
4. Built-in default
```

Diagram:

```mermaid
flowchart TD
    Default[Built-in Defaults] --> File[Config File]
    File --> Env[Environment Override]
    Env --> Flag[Flag Override]
    Flag --> Final[Final Config]
```

Yang penting bukan urutannya harus sama untuk semua sistem, tetapi:

- terdokumentasi,
- deterministic,
- testable,
- logged secara redacted,
- tidak berubah diam-diam antar environment.

Anti-pattern:

```go
if os.Getenv("DB_HOST") != "" {
    cfg.DBHost = os.Getenv("DB_HOST")
} else if file.DBHost != "" {
    cfg.DBHost = file.DBHost
} else {
    cfg.DBHost = "localhost"
}
```

Kode seperti ini akan tersebar dan sulit diuji.

Lebih baik representasikan source secara eksplisit.

```go
type Source string

const (
    SourceDefault Source = "default"
    SourceFile    Source = "file"
    SourceEnv     Source = "env"
    SourceFlag    Source = "flag"
)

type Value[T any] struct {
    Value  T
    Source Source
    Set    bool
}
```

Untuk debugging production, mengetahui “nilai ini berasal dari mana” sering sangat membantu.

---

## 9. Config Representation Pattern

### 9.1 Raw Config vs Final Config

Sebaiknya bedakan raw config dan final config.

Raw config:

```go
type rawConfig struct {
    HTTPAddr         string
    HTTPReadTimeout string
    DBMaxOpenConns  string
    PaymentEndpoint string
    PaymentTimeout  string
}
```

Final config:

```go
type Config struct {
    HTTP HTTPConfig
    DB DatabaseConfig
    Payment PaymentConfig
}

type HTTPConfig struct {
    Addr         string
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
}

type DatabaseConfig struct {
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxLifetime time.Duration
}

type PaymentConfig struct {
    Endpoint *url.URL
    Timeout  time.Duration
}
```

Raw config mengikuti bentuk source. Final config mengikuti kebutuhan program.

Jangan biarkan stringly typed config menyebar ke runtime.

Buruk:

```go
timeout, _ := time.ParseDuration(cfg.PaymentTimeout)
```

jika dilakukan di banyak tempat.

Lebih baik parse sekali saat loading.

---

### 9.2 Strongly Typed Config

Config final harus memakai tipe yang bermakna:

| Nilai | Tipe buruk | Tipe lebih baik |
|---|---|---|
| timeout | `string` | `time.Duration` |
| endpoint | `string` | `*url.URL` atau validated string |
| port | `string` | `int` atau address string validated |
| feature flag | `string` | `bool` atau enum |
| log level | `string` | custom enum / parsed level |
| concurrency | `string` | `int` validated |
| size | `string` | `int64` bytes |

Contoh:

```go
type LogLevel string

const (
    LogLevelDebug LogLevel = "debug"
    LogLevelInfo  LogLevel = "info"
    LogLevelWarn  LogLevel = "warn"
    LogLevelError LogLevel = "error"
)

func (l LogLevel) Validate() error {
    switch l {
    case LogLevelDebug, LogLevelInfo, LogLevelWarn, LogLevelError:
        return nil
    default:
        return fmt.Errorf("invalid log level %q", l)
    }
}
```

---

## 10. Defaulting Pattern

Default itu keputusan desain, bukan convenience semata.

### 10.1 Good Defaults

Default yang baik:

- aman,
- predictable,
- sesuai local development,
- tidak menyembunyikan production mistake,
- terdokumentasi,
- mudah diuji.

Contoh good default:

```go
const defaultHTTPReadTimeout = 5 * time.Second
const defaultHTTPWriteTimeout = 10 * time.Second
const defaultShutdownTimeout = 30 * time.Second
```

### 10.2 Dangerous Defaults

Dangerous default:

```go
DBPassword: "password"
PaymentEndpoint: "http://localhost:9000"
EnableAuth: false
TLSVerify: false
```

Default seperti ini bisa fatal jika terbawa ke production.

Pattern:

- Default boleh berbeda antara local dan production, tetapi environment selection harus eksplisit.
- Required production config tidak boleh punya fallback diam-diam.
- Security-sensitive config jangan default ke insecure value.

---

### 10.3 Defaulting by Environment

Kadang default bergantung pada environment.

```go
type Environment string

const (
    EnvLocal Environment = "local"
    EnvDev   Environment = "dev"
    EnvUAT   Environment = "uat"
    EnvProd  Environment = "prod"
)
```

Pattern:

```go
func applyDefaults(cfg *Config) {
    if cfg.HTTP.ReadTimeout == 0 {
        cfg.HTTP.ReadTimeout = 5 * time.Second
    }

    if cfg.HTTP.WriteTimeout == 0 {
        cfg.HTTP.WriteTimeout = 10 * time.Second
    }
}
```

Untuk production-sensitive defaults:

```go
func validateProd(cfg Config) error {
    if cfg.Env == EnvProd && !cfg.Security.RequireTLS {
        return fmt.Errorf("security.require_tls must be true in prod")
    }
    return nil
}
```

---

## 11. Validation Pattern

Config validation harus dilakukan sebelum dependency dibuat.

```mermaid
flowchart TD
    A[Load Config] --> B[Apply Defaults]
    B --> C[Validate]
    C -->|OK| D[Wire Dependencies]
    C -->|Invalid| E[Fail Fast]
```

### 11.1 Field-Level Validation

```go
func (c HTTPConfig) Validate() error {
    if c.Addr == "" {
        return fmt.Errorf("http.addr is required")
    }
    if c.ReadTimeout <= 0 {
        return fmt.Errorf("http.read_timeout must be positive")
    }
    if c.WriteTimeout <= 0 {
        return fmt.Errorf("http.write_timeout must be positive")
    }
    return nil
}
```

### 11.2 Cross-Field Validation

```go
func (c DatabaseConfig) Validate() error {
    if c.MaxOpenConns <= 0 {
        return fmt.Errorf("database.max_open_conns must be positive")
    }
    if c.MaxIdleConns < 0 {
        return fmt.Errorf("database.max_idle_conns must be non-negative")
    }
    if c.MaxIdleConns > c.MaxOpenConns {
        return fmt.Errorf("database.max_idle_conns must not exceed max_open_conns")
    }
    return nil
}
```

### 11.3 Environment-Specific Validation

```go
func (c Config) Validate() error {
    var errs []error

    if err := c.HTTP.Validate(); err != nil {
        errs = append(errs, err)
    }
    if err := c.Database.Validate(); err != nil {
        errs = append(errs, err)
    }
    if c.Env == EnvProd {
        if err := c.validateProduction(); err != nil {
            errs = append(errs, err)
        }
    }

    return errors.Join(errs...)
}
```

`errors.Join` berguna untuk mengembalikan semua kesalahan config sekaligus, bukan fail satu per satu.

---

## 12. Fail-Fast vs Lenient Config

Untuk service production, config invalid sebaiknya fail fast.

Buruk:

```go
n, err := strconv.Atoi(os.Getenv("WORKER_COUNT"))
if err != nil {
    n = 10
}
```

Kode ini membuat typo `WORKER_COUNT=abc` diam-diam menjadi `10`.

Lebih baik:

```go
n, err := strconv.Atoi(raw)
if err != nil {
    return 0, fmt.Errorf("WORKER_COUNT must be integer: %w", err)
}
```

Silent fallback hanya defensible kalau:

- nilai memang optional,
- default terdokumentasi,
- source tidak set sama sekali,
- bukan invalid value.

Bedakan:

```text
MISSING value  -> maybe use default
INVALID value  -> fail
```

---

## 13. Config Error Design

Config error harus membantu operator memperbaiki deployment.

Buruk:

```text
invalid config
```

Lebih baik:

```text
invalid config: PAYMENT_TIMEOUT must be duration, got "abc"
```

Lebih baik lagi jika structured:

```go
type ConfigError struct {
    Path   string
    Source string
    Value  string
    Reason string
}

func (e ConfigError) Error() string {
    return fmt.Sprintf("%s from %s is invalid: %s", e.Path, e.Source, e.Reason)
}
```

Contoh:

```text
payment.timeout from env PAYMENT_TIMEOUT is invalid: must be positive duration, got "-1s"
```

Path config harus stabil:

```text
http.addr
database.max_open_conns
payment.timeout
security.require_tls
```

Jangan hanya memakai nama struct field Go jika itu bukan nama config yang dipahami operator.

---

## 14. Root Config Package Shape

Contoh layout:

```text
myservice/
  cmd/myservice/main.go
  internal/config/
    config.go
    load.go
    env.go
    file.go
    validate.go
    redact.go
  internal/app/
    wire.go
  internal/payment/
    client.go
  internal/order/
    service.go
```

Root config package:

```go
package config

type Config struct {
    Env      Environment
    HTTP     HTTPConfig
    Database DatabaseConfig
    Payment  PaymentConfig
    Security SecurityConfig
    Logging  LoggingConfig
}
```

Loader:

```go
type Sources struct {
    Env   map[string]string
    Args  []string
    Files []string
}

func Load(s Sources) (Config, error) {
    raw, err := loadRaw(s)
    if err != nil {
        return Config{}, err
    }

    cfg, err := parse(raw)
    if err != nil {
        return Config{}, err
    }

    applyDefaults(&cfg)

    if err := cfg.Validate(); err != nil {
        return Config{}, err
    }

    return cfg, nil
}
```

`main`:

```go
func main() {
    cfg, err := config.Load(config.Sources{
        Env: environMap(os.Environ()),
        Args: os.Args[1:],
    })
    if err != nil {
        log.Fatalf("load config: %v", err)
    }

    app, err := app.New(cfg)
    if err != nil {
        log.Fatalf("create app: %v", err)
    }

    if err := app.Run(context.Background()); err != nil {
        log.Fatalf("run app: %v", err)
    }
}
```

---

## 15. Component Config Pattern

Root config tidak boleh bocor ke semua component.

Buruk:

```go
func NewPaymentClient(cfg config.Config) *Client {
    return &Client{
        endpoint: cfg.Payment.Endpoint,
        timeout: cfg.Payment.Timeout,
        logger: cfg.Logging.Logger,
    }
}
```

Lebih baik:

```go
package payment

type Config struct {
    Endpoint string
    Timeout  time.Duration
}

func (c Config) Validate() error {
    if c.Endpoint == "" {
        return fmt.Errorf("endpoint is required")
    }
    if c.Timeout <= 0 {
        return fmt.Errorf("timeout must be positive")
    }
    return nil
}

func NewClient(cfg Config, httpClient *http.Client) (*Client, error) {
    if err := cfg.Validate(); err != nil {
        return nil, err
    }
    return &Client{
        endpoint: cfg.Endpoint,
        timeout: cfg.Timeout,
        http: httpClient,
    }, nil
}
```

Mapping di composition root:

```go
paymentClient, err := payment.NewClient(payment.Config{
    Endpoint: cfg.Payment.Endpoint.String(),
    Timeout:  cfg.Payment.Timeout,
}, httpClient)
```

Manfaat:

- package payment independent dari root config,
- test lebih mudah,
- config contract kecil,
- refactoring root config tidak merusak component,
- package lebih reusable.

---

## 16. Secret Handling Pattern

### 16.1 Redacted Type

Gunakan tipe khusus untuk secret agar tidak mudah tercetak.

```go
type Secret string

func (s Secret) String() string {
    if s == "" {
        return "<empty>"
    }
    return "<redacted>"
}

func (s Secret) Reveal() string {
    return string(s)
}
```

Contoh:

```go
type DatabaseConfig struct {
    Host     string
    User     string
    Password Secret
}
```

Hati-hati: `fmt.Printf("%#v", cfg)` masih bisa membocorkan field tergantung representasi. Redaction harus dilakukan secara sengaja.

```go
func (c DatabaseConfig) Redacted() map[string]any {
    return map[string]any{
        "host": c.Host,
        "user": c.User,
        "password": "<redacted>",
    }
}
```

### 16.2 Secret Reference vs Secret Value

Lebih baik membedakan:

```go
type SecretRef string

type SecretValue struct {
    value string
}
```

Root config dapat menyimpan referensi:

```yaml
database:
  password_ref: "/prod/myservice/db/password"
```

Secret resolver mengambil value:

```go
type SecretResolver interface {
    Resolve(ctx context.Context, ref SecretRef) (SecretValue, error)
}
```

Dengan ini, config non-secret bisa disimpan/review tanpa membuka secret.

---

## 17. Immutable Startup Config Pattern

Untuk mayoritas service, config paling aman adalah immutable setelah startup.

```go
type App struct {
    cfg Config
}
```

Atau lebih baik: setelah config dipakai untuk membuat dependency, dependency menyimpan nilai final.

```go
type Client struct {
    endpoint string
    timeout  time.Duration
}
```

Keuntungan immutable config:

- local reasoning mudah,
- tidak ada race config,
- behavior stabil,
- testing mudah,
- observability mudah,
- rollback melalui restart/deployment.

Ini cocok untuk:

- database config,
- HTTP server address,
- TLS config,
- dependency endpoint,
- worker concurrency,
- security policy fundamental,
- pool size.

---

## 18. Reloadable Config Pattern

Ada config yang memang perlu reload saat runtime:

- feature flag,
- rate limit,
- kill switch,
- sampling rate,
- log level,
- non-critical routing policy.

Reloadable config harus diperlakukan berbeda.

### 18.1 Atomic Snapshot Pattern

```go
type RuntimeConfig struct {
    FeatureAEnabled bool
    RateLimit       int
    SamplingRate    float64
}

type RuntimeConfigStore struct {
    v atomic.Value // stores RuntimeConfig
}

func NewRuntimeConfigStore(initial RuntimeConfig) *RuntimeConfigStore {
    s := &RuntimeConfigStore{}
    s.v.Store(initial)
    return s
}

func (s *RuntimeConfigStore) Get() RuntimeConfig {
    return s.v.Load().(RuntimeConfig)
}

func (s *RuntimeConfigStore) Update(next RuntimeConfig) {
    s.v.Store(next)
}
```

Konsumen membaca snapshot immutable.

```go
cfg := runtimeCfg.Get()
if cfg.FeatureAEnabled {
    // ...
}
```

### 18.2 Reload Validation

Jangan store config baru sebelum valid.

```go
func (s *RuntimeConfigStore) Reload(next RuntimeConfig) error {
    if err := next.Validate(); err != nil {
        return err
    }
    s.v.Store(next)
    return nil
}
```

### 18.3 Reload Observability

Setiap reload harus menghasilkan event:

- version,
- source,
- changed keys,
- validation status,
- timestamp,
- actor jika ada,
- redacted diff.

```text
runtime_config_reloaded version=42 changed_keys=feature_a,rate_limit
```

Anti-pattern:

- mutate struct config in place,
- reload sebagian field tanpa atomicity,
- tidak ada validation,
- tidak ada log/audit,
- reload secret tanpa rotation semantics,
- semua config dibuat dynamic tanpa alasan.

---

## 19. Feature Flag Pattern

Feature flag adalah config runtime dengan lifecycle.

Jenis feature flag:

| Jenis | Tujuan | Umur Ideal |
|---|---|---|
| Release flag | rollout fitur baru | pendek |
| Ops flag | kill switch / disable behavior | menengah |
| Permission flag | enable fitur untuk segment | menengah-panjang |
| Experiment flag | A/B testing | pendek-menengah |
| Migration flag | transisi behavior lama/baru | pendek |

Feature flag anti-pattern:

- flag tidak pernah dihapus,
- flag dipakai untuk authorization permanen tanpa model jelas,
- flag nested terlalu banyak,
- flag tidak punya owner,
- flag tidak punya expiry,
- flag mengubah invariant domain secara diam-diam,
- test tidak mencakup kombinasi flag penting.

Pattern:

```go
type FeatureFlags struct {
    NewCheckoutFlow bool
    UseOutboxV2     bool
}
```

Untuk flag penting, tambahkan metadata di dokumentasi config:

```text
feature.use_outbox_v2
owner: platform-team
type: migration
created: 2026-06-23
remove_after: migration complete
risk: event publish path
```

---

## 20. Environment Pattern

Environment bukan hanya string label. Environment mempengaruhi policy.

```go
type Environment string

const (
    EnvironmentLocal Environment = "local"
    EnvironmentDev   Environment = "dev"
    EnvironmentTest  Environment = "test"
    EnvironmentUAT   Environment = "uat"
    EnvironmentProd  Environment = "prod"
)
```

Validation:

```go
func (e Environment) Validate() error {
    switch e {
    case EnvironmentLocal, EnvironmentDev, EnvironmentTest, EnvironmentUAT, EnvironmentProd:
        return nil
    default:
        return fmt.Errorf("invalid environment %q", e)
    }
}
```

Use environment to enforce guardrails, not to scatter behavior everywhere.

Buruk:

```go
if cfg.Env == "prod" {
    // behavior A
} else {
    // behavior B
}
```

Jika tersebar di banyak package, sulit diaudit.

Lebih baik root config menghasilkan explicit policy:

```go
type SecurityConfig struct {
    RequireTLS bool
    AllowDebugEndpoints bool
}
```

Lalu validation memastikan prod policy aman:

```go
if cfg.Env == EnvironmentProd && cfg.Security.AllowDebugEndpoints {
    return fmt.Errorf("debug endpoints must be disabled in prod")
}
```

---

## 21. Config and Dependency Lifetime

Config menentukan dependency lifetime.

Contoh:

```go
type DatabaseConfig struct {
    DSN             string
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxLifetime time.Duration
}
```

Dependency:

```go
func OpenDatabase(cfg DatabaseConfig) (*sql.DB, error) {
    db, err := sql.Open("postgres", cfg.DSN)
    if err != nil {
        return nil, err
    }

    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

    return db, nil
}
```

Config tidak seharusnya dibaca lagi oleh repository.

Buruk:

```go
func (r *Repository) queryTimeout() time.Duration {
    return config.Global.Database.QueryTimeout
}
```

Lebih baik timeout menjadi bagian dari repository/client config atau context deadline policy.

---

## 22. Context and Config

`context.Context` bukan tempat membawa config.

Buruk:

```go
ctx = context.WithValue(ctx, "config", cfg)
```

Masalah:

- dependency tersembunyi,
- type safety hilang,
- behavior sulit dipahami,
- API menipu,
- test makin buruk.

Context cocok untuk:

- cancellation,
- deadline,
- request-scoped metadata,
- trace/correlation value.

Config cocok untuk:

- constructor dependency,
- runtime policy object,
- explicit parameter.

Kalau suatu function butuh config, berikan sebagai dependency eksplisit.

---

## 23. Global Config Singleton Anti-Pattern

Salah satu anti-pattern paling umum:

```go
package config

var Global Config

func Load() {
    Global = mustLoad()
}
```

Lalu:

```go
func NewClient() *Client {
    return &Client{timeout: config.Global.Payment.Timeout}
}
```

Masalah:

- hidden dependency,
- test order dependent,
- data race jika mutable,
- sulit menjalankan dua instance config dalam test,
- sulit audit dependency,
- package coupling meningkat,
- reload semantics kabur.

Lebih baik:

```go
cfg, err := config.Load(...)
app, err := app.New(cfg)
```

Kalau perlu global untuk truly process-wide immutable metadata, batasi sangat ketat dan dokumentasikan.

Contoh yang masih bisa diterima:

```go
const ServiceName = "payment-service"
```

Bukan:

```go
var CurrentConfig Config
```

---

## 24. Reading Env Everywhere Anti-Pattern

Buruk:

```go
package payment

func NewClient() *Client {
    return &Client{
        endpoint: os.Getenv("PAYMENT_ENDPOINT"),
    }
}
```

Buruk karena:

- package payment tidak bisa dipakai tanpa process env,
- test harus mutate global env,
- dependency tidak terlihat di constructor,
- tidak ada centralized validation,
- config documentation sulit dibuat.

Lebih baik:

```go
func NewClient(cfg Config) (*Client, error) {
    if err := cfg.Validate(); err != nil {
        return nil, err
    }
    return &Client{endpoint: cfg.Endpoint}, nil
}
```

Env hanya dibaca di config loader.

---

## 25. Config and Observability

Service harus bisa menjawab:

- config apa yang aktif?
- dari source mana?
- kapan dimuat?
- apakah validasi berhasil?
- apakah ada default yang dipakai?
- apakah secret ter-redact?
- apakah runtime config pernah reload?

### 25.1 Startup Config Summary

Saat startup, log redacted config summary.

```text
config_loaded env=prod http.addr=:8080 db.max_open_conns=50 payment.timeout=2s secrets=redacted
```

Jangan log raw config lengkap jika berisi secret.

### 25.2 Config Metrics

Metric yang berguna:

```text
config_load_success_total
config_load_failure_total
config_reload_success_total
config_reload_failure_total
config_last_reload_timestamp
feature_flag_enabled{flag="new_checkout"}
```

Hati-hati cardinality. Jangan expose value bebas sebagai label.

### 25.3 Config Debug Endpoint

Debug endpoint boleh ada di internal network/non-prod, dengan redaction.

```text
GET /debug/config
```

Wajib:

- auth/authorization,
- redaction,
- disable di public environment,
- no secret,
- no raw token.

---

## 26. Configuration Documentation Pattern

Config harus terdokumentasi seperti API.

Format minimal:

| Key | Type | Required | Default | Source | Description |
|---|---|---:|---|---|---|
| `APP_ENV` | enum | yes | - | env | Runtime environment |
| `HTTP_ADDR` | string | no | `:8080` | env/file | HTTP listen address |
| `HTTP_READ_TIMEOUT` | duration | no | `5s` | env/file | Server read timeout |
| `DB_DSN` | secret/string | yes | - | secret/env | Database DSN |
| `DB_MAX_OPEN_CONNS` | int | no | `50` | env/file | DB max open connections |
| `PAYMENT_ENDPOINT` | URL | yes | - | env/file | Payment API endpoint |
| `PAYMENT_TIMEOUT` | duration | no | `2s` | env/file | Payment request timeout |

Config documentation harus dekat dengan config loader atau generated dari schema jika memungkinkan.

---

## 27. Config Compatibility Pattern

Config juga punya compatibility contract.

Perubahan aman:

- menambah optional config dengan default aman,
- menambah config yang tidak mempengaruhi existing behavior saat unset,
- memperluas enum secara kompatibel jika consumer siap,
- menambah source baru tanpa mengubah precedence.

Perubahan berbahaya:

- rename key,
- mengubah default,
- mengubah unit,
- mengubah precedence,
- mengubah requiredness,
- menghapus key,
- mengubah interpretation dari nilai yang sama.

Jika perlu rename:

1. support old key dan new key sementara,
2. jika dua-duanya set, fail atau pilih precedence eksplisit,
3. log deprecation warning,
4. dokumentasikan removal date,
5. hapus setelah migration window.

Contoh:

```go
func readPaymentTimeout(env map[string]string) (string, error) {
    oldValue, oldSet := env["PAYMENT_REQUEST_TIMEOUT"]
    newValue, newSet := env["PAYMENT_TIMEOUT"]

    switch {
    case oldSet && newSet:
        return "", fmt.Errorf("both PAYMENT_REQUEST_TIMEOUT and PAYMENT_TIMEOUT are set; use PAYMENT_TIMEOUT only")
    case newSet:
        return newValue, nil
    case oldSet:
        return oldValue, nil
    default:
        return "", nil
    }
}
```

---

## 28. Config Security Pattern

Security config harus fail-closed.

Buruk:

```go
if os.Getenv("DISABLE_TLS_VERIFY") == "true" {
    tlsConfig.InsecureSkipVerify = true
}
```

Jika memang butuh untuk local dev, enforce guardrail:

```go
if cfg.Security.InsecureSkipVerify && cfg.Env == EnvironmentProd {
    return fmt.Errorf("insecure TLS verification cannot be enabled in prod")
}
```

Security-sensitive config:

- TLS verify,
- allowed origins,
- auth required,
- token issuer,
- JWKS endpoint,
- signing algorithm,
- cookie secure flag,
- debug endpoint,
- profiling endpoint,
- CORS policy,
- admin endpoint,
- encryption key.

Rule:

- default secure,
- insecure only explicit,
- production guardrail,
- redacted logging,
- test production validation.

---

## 29. Config Testing Strategy

### 29.1 Unit Test Parser

```go
func TestLoadPaymentTimeout(t *testing.T) {
    env := map[string]string{
        "PAYMENT_TIMEOUT": "2s",
    }

    cfg, err := Load(Sources{Env: env})
    if err != nil {
        t.Fatal(err)
    }

    if cfg.Payment.Timeout != 2*time.Second {
        t.Fatalf("timeout = %v", cfg.Payment.Timeout)
    }
}
```

### 29.2 Invalid Value Test

```go
func TestInvalidPaymentTimeout(t *testing.T) {
    env := map[string]string{
        "PAYMENT_TIMEOUT": "abc",
    }

    _, err := Load(Sources{Env: env})
    if err == nil {
        t.Fatal("expected error")
    }

    if !strings.Contains(err.Error(), "PAYMENT_TIMEOUT") {
        t.Fatalf("error should mention key: %v", err)
    }
}
```

### 29.3 Production Guardrail Test

```go
func TestProdRejectsInsecureTLS(t *testing.T) {
    cfg := Config{
        Env: EnvironmentProd,
        Security: SecurityConfig{
            InsecureSkipVerify: true,
        },
    }

    err := cfg.Validate()
    if err == nil {
        t.Fatal("expected validation error")
    }
}
```

### 29.4 Default Test

```go
func TestDefaultHTTPTimeouts(t *testing.T) {
    cfg, err := Load(Sources{Env: map[string]string{
        "APP_ENV": "local",
    }})
    if err != nil {
        t.Fatal(err)
    }

    if cfg.HTTP.ReadTimeout != 5*time.Second {
        t.Fatalf("unexpected read timeout: %v", cfg.HTTP.ReadTimeout)
    }
}
```

### 29.5 Redaction Test

```go
func TestRedactedConfigDoesNotExposeSecret(t *testing.T) {
    cfg := Config{
        Database: DatabaseConfig{
            Password: Secret("super-secret"),
        },
    }

    rendered := cfg.RedactedString()
    if strings.Contains(rendered, "super-secret") {
        t.Fatal("redacted config leaked secret")
    }
}
```

---

## 30. Config and CI/CD

Configuration design harus cocok dengan deployment pipeline.

CI/CD concern:

- validate config before deploy,
- environment-specific manifest,
- secret reference exists,
- no insecure prod config,
- default not accidentally used in prod,
- migration from old key to new key,
- config diff review,
- rollback compatibility.

Pattern:

- expose `myservice validate-config --file config.yaml`,
- run validation in CI,
- run validation in deployment preflight,
- produce redacted config summary.

CLI example:

```text
myservice validate-config --env prod --file config.prod.yaml
```

Output:

```text
OK config valid for env=prod
```

Or:

```text
ERROR payment.timeout: must be positive duration
ERROR security.allow_debug_endpoints: must be false in prod
```

---

## 31. Config and Kubernetes

Dalam Kubernetes, config biasanya berasal dari:

- ConfigMap,
- Secret,
- env var,
- mounted file,
- downward API,
- command args.

Pattern umum:

```yaml
env:
  - name: APP_ENV
    value: prod
  - name: HTTP_ADDR
    value: ":8080"
  - name: DB_DSN
    valueFrom:
      secretKeyRef:
        name: myservice-db
        key: dsn
```

Atau mounted config file:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/myservice
    readOnly: true
```

Go app tetap sebaiknya tidak tahu Kubernetes. App hanya tahu source-nya env/file.

Jangan membuat package bisnis tergantung konsep Kubernetes.

---

## 32. Config and Local Development

Local development perlu mudah, tetapi tidak boleh membuat production unsafe.

Pattern:

- `.env.example` boleh ada,
- `.env` jangan commit jika berisi secret,
- default local boleh friendly,
- production required values tetap required,
- local config file boleh memakai fake endpoint,
- test config terpisah dari local config.

Contoh `.env.example`:

```text
APP_ENV=local
HTTP_ADDR=:8080
DB_DSN=postgres://user:pass@localhost:5432/myservice?sslmode=disable
PAYMENT_ENDPOINT=http://localhost:9000
PAYMENT_TIMEOUT=2s
```

Jangan jadikan `.env.example` sebagai production template.

---

## 33. Config and Multi-Tenant / Multi-Agency Systems

Untuk sistem multi-tenant atau multi-agency, config bisa menjadi lebih kompleks.

Hati-hati membedakan:

- deployment config,
- tenant policy,
- user preference,
- domain rule,
- feature flag,
- authorization policy.

Jangan semua dimasukkan ke `Config`.

Contoh:

```go
type Config struct {
    HTTP HTTPConfig
    DB   DatabaseConfig
}
```

Tenant policy sebaiknya bukan process config jika bisa berubah per request.

```go
type TenantPolicyRepository interface {
    GetPolicy(ctx context.Context, tenantID TenantID) (TenantPolicy, error)
}
```

Process config menjawab “bagaimana service berjalan”.

Tenant policy menjawab “aturan domain untuk tenant tertentu”.

Jika dicampur, risiko:

- reload salah scope,
- audit sulit,
- tenant A mempengaruhi tenant B,
- config deployment berubah untuk mengubah rule bisnis,
- authorization dan feature policy kabur.

---

## 34. Config Schema Evolution

Seiring sistem bertumbuh, config schema akan berubah.

Contoh evolusi:

```yaml
payment_timeout: "2s"
```

menjadi:

```yaml
payment:
  timeout: "2s"
  endpoint: "https://payment.example.com"
```

Migration pattern:

1. Support old and new schema.
2. Detect conflict.
3. Emit deprecation warning.
4. Update documentation.
5. Update CI validation.
6. Remove old schema after window.

Go loader bisa memuat raw map lalu normalize ke final config.

```go
func normalize(raw rawConfig) (Config, []Warning, error) {
    var warnings []Warning

    if raw.PaymentTimeoutLegacy != "" {
        warnings = append(warnings, Warning{
            Key: "payment_timeout",
            Message: "deprecated; use payment.timeout",
        })
    }

    // ...
    return cfg, warnings, nil
}
```

Warnings harus terlihat saat startup dan CI validation.

---

## 35. Production Example: Payment Service Config

### 35.1 Requirement

Kita punya Go service dengan:

- HTTP API,
- database,
- payment external API,
- worker,
- structured logging,
- feature flag,
- security guardrails.

Config source:

- env var untuk deployment,
- optional config file untuk local,
- secret via env/ref,
- flag override untuk tools.

### 35.2 Final Config

```go
package config

import (
    "errors"
    "fmt"
    "net/url"
    "time"
)

type Environment string

const (
    EnvLocal Environment = "local"
    EnvDev   Environment = "dev"
    EnvUAT   Environment = "uat"
    EnvProd  Environment = "prod"
)

type Config struct {
    Env      Environment
    HTTP     HTTPConfig
    Database DatabaseConfig
    Payment  PaymentConfig
    Worker   WorkerConfig
    Logging  LoggingConfig
    Security SecurityConfig
    Features FeatureConfig
}

type HTTPConfig struct {
    Addr         string
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
    IdleTimeout  time.Duration
}

type DatabaseConfig struct {
    DSN             Secret
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxLifetime time.Duration
}

type PaymentConfig struct {
    Endpoint *url.URL
    Timeout  time.Duration
    APIKey   Secret
}

type WorkerConfig struct {
    Concurrency int
    QueueName   string
}

type LoggingConfig struct {
    Level string
    JSON  bool
}

type SecurityConfig struct {
    RequireTLS          bool
    AllowDebugEndpoints bool
    InsecureSkipVerify  bool
}

type FeatureConfig struct {
    UseOutboxV2 bool
}

type Secret string

func (s Secret) Reveal() string {
    return string(s)
}

func (s Secret) IsZero() bool {
    return s == ""
}

func (s Secret) String() string {
    if s == "" {
        return "<empty>"
    }
    return "<redacted>"
}
```

### 35.3 Validation

```go
func (e Environment) Validate() error {
    switch e {
    case EnvLocal, EnvDev, EnvUAT, EnvProd:
        return nil
    default:
        return fmt.Errorf("invalid environment %q", e)
    }
}

func (c Config) Validate() error {
    var errs []error

    if err := c.Env.Validate(); err != nil {
        errs = append(errs, fmt.Errorf("env: %w", err))
    }
    if err := c.HTTP.Validate(); err != nil {
        errs = append(errs, fmt.Errorf("http: %w", err))
    }
    if err := c.Database.Validate(); err != nil {
        errs = append(errs, fmt.Errorf("database: %w", err))
    }
    if err := c.Payment.Validate(); err != nil {
        errs = append(errs, fmt.Errorf("payment: %w", err))
    }
    if err := c.Worker.Validate(); err != nil {
        errs = append(errs, fmt.Errorf("worker: %w", err))
    }
    if err := c.Security.Validate(c.Env); err != nil {
        errs = append(errs, fmt.Errorf("security: %w", err))
    }

    return errors.Join(errs...)
}

func (c HTTPConfig) Validate() error {
    var errs []error
    if c.Addr == "" {
        errs = append(errs, fmt.Errorf("addr is required"))
    }
    if c.ReadTimeout <= 0 {
        errs = append(errs, fmt.Errorf("read_timeout must be positive"))
    }
    if c.WriteTimeout <= 0 {
        errs = append(errs, fmt.Errorf("write_timeout must be positive"))
    }
    if c.IdleTimeout <= 0 {
        errs = append(errs, fmt.Errorf("idle_timeout must be positive"))
    }
    return errors.Join(errs...)
}

func (c DatabaseConfig) Validate() error {
    var errs []error
    if c.DSN.IsZero() {
        errs = append(errs, fmt.Errorf("dsn is required"))
    }
    if c.MaxOpenConns <= 0 {
        errs = append(errs, fmt.Errorf("max_open_conns must be positive"))
    }
    if c.MaxIdleConns < 0 {
        errs = append(errs, fmt.Errorf("max_idle_conns must be non-negative"))
    }
    if c.MaxIdleConns > c.MaxOpenConns {
        errs = append(errs, fmt.Errorf("max_idle_conns must not exceed max_open_conns"))
    }
    if c.ConnMaxLifetime <= 0 {
        errs = append(errs, fmt.Errorf("conn_max_lifetime must be positive"))
    }
    return errors.Join(errs...)
}

func (c PaymentConfig) Validate() error {
    var errs []error
    if c.Endpoint == nil {
        errs = append(errs, fmt.Errorf("endpoint is required"))
    } else if c.Endpoint.Scheme != "https" {
        errs = append(errs, fmt.Errorf("endpoint must use https"))
    }
    if c.Timeout <= 0 {
        errs = append(errs, fmt.Errorf("timeout must be positive"))
    }
    if c.APIKey.IsZero() {
        errs = append(errs, fmt.Errorf("api_key is required"))
    }
    return errors.Join(errs...)
}

func (c WorkerConfig) Validate() error {
    var errs []error
    if c.Concurrency <= 0 {
        errs = append(errs, fmt.Errorf("concurrency must be positive"))
    }
    if c.QueueName == "" {
        errs = append(errs, fmt.Errorf("queue_name is required"))
    }
    return errors.Join(errs...)
}

func (c SecurityConfig) Validate(env Environment) error {
    var errs []error
    if env == EnvProd {
        if !c.RequireTLS {
            errs = append(errs, fmt.Errorf("require_tls must be true in prod"))
        }
        if c.AllowDebugEndpoints {
            errs = append(errs, fmt.Errorf("allow_debug_endpoints must be false in prod"))
        }
        if c.InsecureSkipVerify {
            errs = append(errs, fmt.Errorf("insecure_skip_verify must be false in prod"))
        }
    }
    return errors.Join(errs...)
}
```

### 35.4 Defaulting

```go
func applyDefaults(c *Config) {
    if c.Env == "" {
        c.Env = EnvLocal
    }

    if c.HTTP.Addr == "" {
        c.HTTP.Addr = ":8080"
    }
    if c.HTTP.ReadTimeout == 0 {
        c.HTTP.ReadTimeout = 5 * time.Second
    }
    if c.HTTP.WriteTimeout == 0 {
        c.HTTP.WriteTimeout = 10 * time.Second
    }
    if c.HTTP.IdleTimeout == 0 {
        c.HTTP.IdleTimeout = 60 * time.Second
    }

    if c.Database.MaxOpenConns == 0 {
        c.Database.MaxOpenConns = 50
    }
    if c.Database.MaxIdleConns == 0 {
        c.Database.MaxIdleConns = 10
    }
    if c.Database.ConnMaxLifetime == 0 {
        c.Database.ConnMaxLifetime = 30 * time.Minute
    }

    if c.Payment.Timeout == 0 {
        c.Payment.Timeout = 2 * time.Second
    }

    if c.Worker.Concurrency == 0 {
        c.Worker.Concurrency = 4
    }

    if c.Logging.Level == "" {
        c.Logging.Level = "info"
    }
}
```

### 35.5 Env Parsing Helpers

```go
func parseDurationEnv(env map[string]string, key string) (time.Duration, bool, error) {
    raw, ok := env[key]
    if !ok || raw == "" {
        return 0, false, nil
    }

    d, err := time.ParseDuration(raw)
    if err != nil {
        return 0, true, fmt.Errorf("%s must be duration: %w", key, err)
    }
    if d <= 0 {
        return 0, true, fmt.Errorf("%s must be positive", key)
    }
    return d, true, nil
}

func parseIntEnv(env map[string]string, key string) (int, bool, error) {
    raw, ok := env[key]
    if !ok || raw == "" {
        return 0, false, nil
    }

    n, err := strconv.Atoi(raw)
    if err != nil {
        return 0, true, fmt.Errorf("%s must be integer: %w", key, err)
    }
    return n, true, nil
}

func parseBoolEnv(env map[string]string, key string) (bool, bool, error) {
    raw, ok := env[key]
    if !ok || raw == "" {
        return false, false, nil
    }

    b, err := strconv.ParseBool(raw)
    if err != nil {
        return false, true, fmt.Errorf("%s must be boolean: %w", key, err)
    }
    return b, true, nil
}
```

### 35.6 Redacted Output

```go
func (c Config) RedactedMap() map[string]any {
    return map[string]any{
        "env": c.Env,
        "http": map[string]any{
            "addr": c.HTTP.Addr,
            "read_timeout": c.HTTP.ReadTimeout.String(),
            "write_timeout": c.HTTP.WriteTimeout.String(),
            "idle_timeout": c.HTTP.IdleTimeout.String(),
        },
        "database": map[string]any{
            "dsn": "<redacted>",
            "max_open_conns": c.Database.MaxOpenConns,
            "max_idle_conns": c.Database.MaxIdleConns,
            "conn_max_lifetime": c.Database.ConnMaxLifetime.String(),
        },
        "payment": map[string]any{
            "endpoint": safeURL(c.Payment.Endpoint),
            "timeout": c.Payment.Timeout.String(),
            "api_key": "<redacted>",
        },
        "worker": map[string]any{
            "concurrency": c.Worker.Concurrency,
            "queue_name": c.Worker.QueueName,
        },
        "security": map[string]any{
            "require_tls": c.Security.RequireTLS,
            "allow_debug_endpoints": c.Security.AllowDebugEndpoints,
            "insecure_skip_verify": c.Security.InsecureSkipVerify,
        },
        "features": map[string]any{
            "use_outbox_v2": c.Features.UseOutboxV2,
        },
    }
}

func safeURL(u *url.URL) string {
    if u == nil {
        return ""
    }
    copy := *u
    copy.User = nil
    return copy.String()
}
```

---

## 36. Anti-Pattern Catalog

### 36.1 Global Config Singleton

Symptom:

```go
config.Global.Payment.Timeout
```

Root cause:

- ingin kenyamanan ala framework injection,
- tidak punya composition root jelas,
- dependency wiring dianggap boilerplate.

Consequence:

- hidden dependency,
- test fragile,
- coupling tinggi,
- reload tidak jelas.

Refactor:

- load config di `main`,
- pass subset config ke constructor,
- hapus global access bertahap.

---

### 36.2 Reading Env in Deep Packages

Symptom:

```go
os.Getenv("SOME_KEY")
```

muncul di package repository/client/service.

Consequence:

- package tidak reusable,
- validation tidak centralized,
- test sulit,
- behavior deployment tersembunyi.

Refactor:

- buat component config,
- baca env di root config loader,
- pass value eksplisit.

---

### 36.3 Stringly Typed Config

Symptom:

```go
type Config struct {
    Timeout string
    Enabled string
    MaxConn string
}
```

Consequence:

- parse berulang,
- runtime error terlambat,
- invalid config lolos startup,
- behavior tidak konsisten.

Refactor:

- parse saat load,
- final config pakai `time.Duration`, `bool`, `int`, enum, URL.

---

### 36.4 Silent Default on Invalid Value

Symptom:

```go
n, _ := strconv.Atoi(raw)
if n == 0 {
    n = 10
}
```

Consequence:

- typo menjadi behavior lain,
- incident sulit dilacak,
- production tidak sesuai manifest.

Refactor:

- missing boleh default,
- invalid harus error.

---

### 36.5 Secret Leaking Through Logs

Symptom:

```go
log.Printf("%+v", cfg)
```

Consequence:

- credential exposure,
- compliance violation,
- incident response besar.

Refactor:

- redacted rendering,
- secret type,
- test redaction,
- no raw config dump.

---

### 36.6 Runtime Mutable Config Without Atomicity

Symptom:

```go
cfg.FeatureA = true
cfg.RateLimit = 100
```

mutated while handlers read.

Consequence:

- data race,
- partial update,
- inconsistent behavior.

Refactor:

- immutable snapshot,
- atomic swap,
- validation before swap.

---

### 36.7 Environment Condition Everywhere

Symptom:

```go
if cfg.Env == "prod" { ... }
```

muncul di banyak package.

Consequence:

- behavior sulit diaudit,
- production guardrail tersebar,
- local/prod divergence tidak jelas.

Refactor:

- derive explicit policy in config,
- package consume policy, not environment string.

---

### 36.8 Config Bag Passed Everywhere

Symptom:

```go
func NewService(cfg config.Config) *Service
```

Consequence:

- service bisa tergantung apa saja,
- coupling ke root config,
- test verbose,
- API surface internal melebar.

Refactor:

- component-specific config,
- pass only what is needed.

---

### 36.9 Config Reload Everything

Symptom:

Semua config dianggap bisa berubah runtime.

Consequence:

- kompleksitas tinggi,
- race,
- partial behavior,
- dependency lifecycle rumit,
- sulit rollback.

Refactor:

- immutable startup config by default,
- reload only safe runtime policy,
- atomic snapshot.

---

### 36.10 Config Mixed with Domain Rule

Symptom:

```go
cfg.MaxAppealDays
cfg.TenantApprovalPolicy
cfg.UserRoleMapping
```

semua dimasukkan ke process config.

Consequence:

- deployment config menjadi rule engine,
- audit domain kacau,
- tenant policy tidak jelas,
- change process salah jalur.

Refactor:

- pisahkan deployment config, domain policy, tenant policy, feature flag, authorization policy.

---

## 37. Refactoring Playbook

### Step 1 — Inventory Config Access

Cari:

```text
os.Getenv
flag.
viper.
config.Global
GetConfig
```

Buat daftar package yang membaca config.

### Step 2 — Identify Config Categories

Klasifikasikan:

- startup config,
- secret,
- runtime reloadable config,
- feature flag,
- domain policy,
- test-only config.

### Step 3 — Create Root Config Struct

Buat `internal/config.Config` sebagai final config.

### Step 4 — Centralize Loading

Pindahkan env/file/flag reading ke config package.

### Step 5 — Parse and Validate Early

Pastikan final config sudah typed dan valid sebelum app wiring.

### Step 6 — Introduce Component Config

Untuk setiap dependency, buat config kecil:

```go
payment.Config
worker.Config
database.Config
```

### Step 7 — Replace Global Access

Ganti:

```go
config.Global.Payment.Timeout
```

dengan constructor parameter.

### Step 8 — Add Redacted Logging

Log config summary saat startup.

### Step 9 — Add Tests

Test:

- missing required,
- invalid value,
- default,
- prod guardrail,
- redaction,
- deprecated key.

### Step 10 — Remove Dead Config

Config yang tidak dipakai harus dihapus. Dead config membuat operator salah paham.

---

## 38. Review Checklist

Gunakan checklist ini saat review PR yang menyentuh config.

### Source and Loading

- [ ] Apakah semua env/file/flag dibaca di satu boundary yang jelas?
- [ ] Apakah deep package bebas dari `os.Getenv`?
- [ ] Apakah precedence antar source terdokumentasi?
- [ ] Apakah missing dan invalid value dibedakan?

### Type Safety

- [ ] Apakah final config strongly typed?
- [ ] Apakah duration diparse menjadi `time.Duration`?
- [ ] Apakah URL divalidasi?
- [ ] Apakah enum divalidasi?

### Defaulting

- [ ] Apakah default aman?
- [ ] Apakah production required config tidak punya fallback diam-diam?
- [ ] Apakah perubahan default dianggap breaking operational change?

### Validation

- [ ] Apakah config divalidasi sebelum dependency dibuat?
- [ ] Apakah cross-field invariant dicek?
- [ ] Apakah production guardrail ada?
- [ ] Apakah error message actionable?

### Security

- [ ] Apakah secret tidak tercetak?
- [ ] Apakah secret tidak punya insecure default?
- [ ] Apakah debug/profiling endpoint disabled di prod?
- [ ] Apakah insecure TLS ditolak di prod?

### Runtime

- [ ] Apakah config immutable by default?
- [ ] Jika reloadable, apakah memakai atomic snapshot?
- [ ] Apakah reload divalidasi sebelum apply?
- [ ] Apakah reload observable?

### Architecture

- [ ] Apakah root config tidak disuntikkan ke semua service?
- [ ] Apakah component config kecil dan jelas?
- [ ] Apakah config tidak dicampur dengan domain policy?
- [ ] Apakah config documentation tersedia?

---

## 39. Exercises

### Exercise 1 — Refactor Env Access

Diberikan kode:

```go
func NewMailer() *Mailer {
    return &Mailer{
        endpoint: os.Getenv("MAIL_ENDPOINT"),
        apiKey: os.Getenv("MAIL_API_KEY"),
    }
}
```

Refactor menjadi:

- root config loader,
- `mailer.Config`,
- validation,
- secret redaction,
- constructor explicit.

### Exercise 2 — Design Production Guardrail

Buat config untuk:

- CORS allowed origins,
- debug endpoint,
- TLS requirement.

Tambahkan validation:

- wildcard origin dilarang di prod,
- debug endpoint dilarang di prod,
- TLS wajib di prod.

### Exercise 3 — Feature Flag Lifecycle

Desain `FeatureFlags` untuk migration `UseOutboxV2`.

Tentukan:

- owner,
- default,
- prod behavior,
- test matrix,
- removal condition.

### Exercise 4 — Reloadable Rate Limit

Buat runtime config store untuk:

- rate limit,
- sampling rate,
- feature flag.

Syarat:

- immutable snapshot,
- atomic update,
- validation before store,
- redacted diff logging.

### Exercise 5 — Config Compatibility

Rename config key:

```text
PAYMENT_REQUEST_TIMEOUT
```

menjadi:

```text
PAYMENT_TIMEOUT
```

Buat migration plan dan loader behavior.

---

## 40. Key Takeaways

1. Configuration adalah operational contract, bukan sekadar data.
2. Config loading, parsing, defaulting, validation, dan wiring harus dipisahkan.
3. Root config boleh besar, tetapi component config harus kecil.
4. Deep package tidak seharusnya membaca env/file/secret sendiri.
5. Final config harus strongly typed.
6. Missing value dan invalid value harus dibedakan.
7. Production-sensitive config harus fail-closed.
8. Secret harus diperlakukan sebagai tipe khusus dan selalu di-redact.
9. Immutable startup config adalah default yang paling aman.
10. Reloadable config harus atomic, validated, dan observable.
11. Feature flag punya lifecycle dan owner.
12. Config compatibility perlu dipikirkan seperti API compatibility.
13. Config documentation adalah bagian dari production readiness.
14. Global config singleton hampir selalu merusak testability dan architecture.
15. Config yang baik membuat incident lebih mudah dicegah dan didiagnosis.

---

## 41. Referensi Resmi dan Rujukan Lanjutan

- Go 1.26 Release Notes — https://go.dev/doc/go1.26
- Go Release History — https://go.dev/doc/devel/release
- Effective Go — https://go.dev/doc/effective_go
- Go Code Review Comments — https://go.dev/wiki/CodeReviewComments
- Go Modules: Keeping Your Modules Compatible — https://go.dev/blog/module-compatibility
- Go Doc Comments — https://go.dev/doc/comment
- Go Language Specification: Program and Package Initialization — https://go.dev/ref/spec
- Google Go Style Guide — https://google.github.io/styleguide/go/
- Google Go Style Decisions — https://google.github.io/styleguide/go/decisions
- Google Go Best Practices — https://google.github.io/styleguide/go/best-practices

---

## 42. Status Seri

Part ini adalah:

```text
Part 008 dari 035
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 009 — Dependency Wiring Pattern Without DI Container
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-design-patterns-common-patterns-anti-patterns-part-007.md">⬅️ Part 007 — Functional Options Pattern, Properly Used</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-design-patterns-common-patterns-anti-patterns-part-009.md">Part 009 — Dependency Wiring Pattern Without DI Container ➡️</a>
</div>
