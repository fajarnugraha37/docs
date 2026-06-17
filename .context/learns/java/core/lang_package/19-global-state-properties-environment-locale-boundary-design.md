# Part 19 — Global State, Properties, Environment, Locale Boundary, and Design

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `19-global-state-properties-environment-locale-boundary-design.md`  
> Scope: Java 8–25  
> Main packages/classes: `java.lang.System`, `java.util.Properties`, `java.util.Locale`, `java.util.TimeZone`, `java.nio.charset.Charset`, `java.time.ZoneId`, static initialization, runtime configuration boundaries

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas `System` sebagai gateway global runtime: standard streams, properties, environment, time, `arraycopy`, dan logger. Part ini mengambil satu aspek yang jauh lebih berbahaya secara desain: **global state**.

Global state di Java sering terlihat sederhana:

```java
String env = System.getenv("APP_ENV");
String timezone = System.getProperty("user.timezone");
Locale locale = Locale.getDefault();
Charset charset = Charset.defaultCharset();
```

Tetapi pada sistem production, baris-baris seperti ini bisa menentukan:

- apakah parsing tanggal konsisten antar environment;
- apakah file dibaca dengan encoding benar;
- apakah test suite deterministic;
- apakah aplikasi bisa deploy di container yang berbeda base image;
- apakah library bisa dipakai ulang lintas service;
- apakah konfigurasi bisa diaudit;
- apakah multi-tenant request tidak saling bocor;
- apakah behavior berubah ketika pindah Java 8 ke Java 17/21/25.

Target part ini:

1. memahami apa itu global state di JVM;
2. membedakan system properties, environment variables, default locale, default timezone, default charset, dan static global state;
3. memahami kapan global state boleh dibaca langsung dan kapan harus diinjeksi sebagai dependency;
4. memahami static initialization trap;
5. membangun desain konfigurasi yang explicit, testable, auditable, dan environment-safe;
6. memahami perubahan penting Java 8–25, terutama default charset UTF-8 sejak Java 18;
7. membuat checklist production agar aplikasi tidak bergantung diam-diam pada host defaults.

---

## 2. Mental Model Utama

### 2.1 JVM adalah process dengan state global

Satu aplikasi Java berjalan di dalam satu JVM process. JVM process itu punya state global seperti:

- system properties;
- environment variables yang diwarisi dari OS process;
- default locale;
- default timezone;
- default charset;
- standard streams;
- loaded classes;
- class initialization state;
- system class loader;
- context class loader per thread;
- shutdown hooks;
- native libraries;
- caches internal JDK/library;
- singleton/static fields aplikasi.

Sebagian global state berasal dari OS, sebagian dari command-line JVM, sebagian dari JDK, sebagian dari aplikasi/framework.

Kesalahan umum: menganggap global state sebagai “konfigurasi biasa”. Padahal global state adalah **implicit input** terhadap behavior program.

Kalau sebuah function membaca `Locale.getDefault()` di dalamnya, function itu tidak hanya bergantung pada parameter eksplisit, tetapi juga pada keadaan global JVM saat function dipanggil.

```java
String upper(String text) {
    return text.toUpperCase(); // uses default Locale implicitly
}
```

Function ini tampak pure, tetapi sebenarnya tidak pure karena hasilnya bisa berbeda bila default locale berubah.

---

### 2.2 Global state mengurangi local reasoning

Kode yang baik mudah dipahami dari input eksplisitnya.

```java
Money parseMoney(String value, Locale locale) { ... }
```

Kode ini jelas: hasil parsing tergantung `value` dan `locale`.

Kode berikut lebih sulit:

```java
Money parseMoney(String value) {
    NumberFormat format = NumberFormat.getCurrencyInstance();
    ...
}
```

`getCurrencyInstance()` memakai default locale. Jadi behavior function tergantung konfigurasi JVM, OS, container, test runner, atau kode lain yang pernah memanggil `Locale.setDefault(...)`.

Dalam sistem kecil ini mungkin tidak terasa. Dalam sistem enterprise, microservices, scheduler, import job, batch, regulator workflow, audit report, dan long-running JVM, ini menjadi sumber bug yang sulit direproduksi.

---

### 2.3 Environment adalah deployment contract, bukan domain logic

Environment variables dan system properties adalah boundary deployment:

- URL database;
- path config;
- feature flags bootstrap;
- profile active;
- timezone process;
- heap/container tuning;
- TLS trust store;
- log level bootstrap.

Tetapi domain logic sebaiknya tidak membaca environment langsung.

Buruk:

```java
public final class RenewalPolicy {
    public boolean shouldAutoApprove(Application app) {
        return "true".equals(System.getenv("AUTO_APPROVE_RENEWAL"));
    }
}
```

Lebih baik:

```java
public record RenewalPolicyConfig(boolean autoApproveRenewal) {}

public final class RenewalPolicy {
    private final RenewalPolicyConfig config;

    public RenewalPolicy(RenewalPolicyConfig config) {
        this.config = config;
    }

    public boolean shouldAutoApprove(Application app) {
        return config.autoApproveRenewal() && app.isLowRisk();
    }
}
```

Environment dibaca di bootstrap layer, divalidasi, lalu diterjemahkan menjadi typed configuration.

---

### 2.4 Default bukan berarti benar

Default JVM/OS sering berguna untuk command-line tools atau desktop apps. Namun untuk backend/service production, default sering terlalu implisit.

Contoh defaults:

- default locale;
- default timezone;
- default charset;
- default file separator;
- default line separator;
- default temporary directory;
- default proxy selector;
- default SSL trust store;
- default class loader behavior.

Default bisa berubah karena:

- OS image berubah;
- container base image berubah;
- JVM version berubah;
- startup argument berubah;
- locale package di OS berubah;
- framework test extension mengubah state;
- library melakukan initialization lebih awal;
- service berjalan di region berbeda.

Prinsip production:

> Untuk behavior yang memengaruhi data, waktu, text, security, persistence, atau external contract, jangan bergantung pada default global. Pilih eksplisit.

---

## 3. Konsep Fundamental

### 3.1 System properties

System properties adalah key-value map global di JVM, diakses lewat:

```java
System.getProperty("key");
System.setProperty("key", "value");
System.getProperties();
```

Contoh properties umum:

```text
java.version
java.vendor
java.home
java.class.path
user.dir
user.home
user.name
user.language
user.country
user.timezone
file.separator
path.separator
line.separator
file.encoding
java.io.tmpdir
```

System property dapat berasal dari:

- JVM/JDK defaults;
- command-line `-Dkey=value`;
- launcher;
- framework;
- aplikasi via `System.setProperty`;
- test runtime;
- container runtime scripts.

Contoh:

```bash
java -Dapp.env=uat -Duser.timezone=UTC -jar app.jar
```

System properties bersifat **JVM-wide mutable map**. Ini berarti perubahan di satu bagian aplikasi bisa memengaruhi bagian lain.

```java
System.setProperty("user.timezone", "UTC");
```

Baris ini bukan perubahan lokal. Ia memengaruhi JVM process.

---

### 3.2 Environment variables

Environment variables berasal dari OS process environment:

```java
String value = System.getenv("APP_ENV");
Map<String, String> env = System.getenv();
```

Dalam Java, environment variable map yang dikembalikan bersifat read-only dari perspektif API Java standar. Artinya aplikasi tidak seharusnya mengubah environment process melalui Java API standar.

Environment variables cocok untuk konfigurasi deployment seperti:

```text
APP_ENV=uat
DB_HOST=...
DB_PORT=1521
FEATURE_X_ENABLED=true
JAVA_TOOL_OPTIONS=...
TZ=UTC
```

Namun domain code sebaiknya tidak memanggil `System.getenv` langsung. Environment harus dibaca di bootstrap/config layer.

---

### 3.3 System property vs environment variable

Keduanya sering dipakai sebagai konfigurasi, tetapi sifatnya berbeda.

| Aspek | System Property | Environment Variable |
|---|---|---|
| Akses Java | `System.getProperty` | `System.getenv` |
| Sumber umum | `-Dkey=value`, JDK, app | OS/container/orchestrator |
| Mutability | mutable via Java API | read-only via Java standard API |
| Scope | JVM process | OS process environment inherited at launch |
| Format key | bebas, sering dotted: `app.env` | uppercase underscore: `APP_ENV` |
| Cocok untuk | JVM/JDK/app bootstrap options | deployment secrets/config endpoints/profile |
| Risiko | global mutable state | implicit deployment dependency |

Prinsip:

- environment variable: boundary dari deployment platform ke aplikasi;
- system property: boundary dari launcher/JVM/framework ke aplikasi;
- typed config object: boundary dari bootstrap ke domain/application logic.

---

### 3.4 Default locale

`Locale.getDefault()` mengembalikan default locale JVM.

Locale memengaruhi operasi seperti:

- formatting angka;
- formatting tanggal;
- sorting/collation;
- case conversion tertentu;
- currency display;
- message bundle resolution;
- decimal separator;
- month/day names.

Contoh bug klasik:

```java
String key = "identity";
String upper = key.toUpperCase();
```

`String.toUpperCase()` tanpa `Locale` memakai default locale. Pada locale tertentu seperti Turkish, hasil case mapping untuk huruf `i` bisa tidak sesuai ekspektasi protocol/key.

Untuk identifier/protocol/internal key, gunakan:

```java
String upper = key.toUpperCase(Locale.ROOT);
String lower = key.toLowerCase(Locale.ROOT);
```

Untuk tampilan user, gunakan locale user eksplisit:

```java
String display = amountFormat(userLocale, amount);
```

Jangan campur:

- `Locale.ROOT` untuk machine-stable text;
- user locale untuk presentation;
- default locale hanya jika aplikasi memang ingin mengikuti environment default.

---

### 3.5 Default timezone

Timezone memengaruhi interpretasi tanggal/waktu ketika kode memakai API yang bergantung pada default zone.

Contoh API riskan:

```java
LocalDate today = LocalDate.now();
ZonedDateTime now = ZonedDateTime.now();
DateFormat df = DateFormat.getDateTimeInstance();
Calendar cal = Calendar.getInstance();
```

Jika tidak ada `Clock` atau `ZoneId` eksplisit, kode membaca default timezone JVM.

Lebih baik:

```java
public final class BusinessDateService {
    private final Clock clock;
    private final ZoneId businessZone;

    public BusinessDateService(Clock clock, ZoneId businessZone) {
        this.clock = clock;
        this.businessZone = businessZone;
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(businessZone));
    }
}
```

Untuk backend yang berurusan dengan audit, SLA, expiry, deadline, regulatory timeline, dan reports, timezone adalah domain/config decision, bukan default host decision.

---

### 3.6 Default charset

Default charset adalah charset yang dipakai oleh beberapa API ketika charset tidak diberikan secara eksplisit.

Sebelum Java 18, default charset sering bergantung pada OS/user locale. Sejak Java 18, JEP 400 menstandarkan UTF-8 sebagai default charset untuk standard Java APIs, dengan pengecualian tertentu seperti console I/O.

Ini memperbaiki portability, tetapi bukan alasan untuk berhenti eksplisit.

Buruk:

```java
String content = Files.readString(path); // modern Java defaults UTF-8, but be explicit for contracts
```

Lebih defensible untuk file contract:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Untuk Java 8:

```java
byte[] bytes = Files.readAllBytes(path);
String content = new String(bytes, StandardCharsets.UTF_8);
```

Prinsip:

- external file/API contract: charset eksplisit;
- database text: pahami DB/session encoding;
- HTTP: ikuti Content-Type charset atau protocol default;
- logs: pastikan runtime/container/log collector konsisten;
- migration Java 8 → 17/21/25: audit semua default-charset usage.

---

### 3.7 Static fields as application global state

Selain global state JDK, aplikasi sering membuat global state sendiri:

```java
public final class AppConfig {
    public static final String ENV = System.getenv("APP_ENV");
    public static final boolean DEBUG = Boolean.getBoolean("app.debug");
}
```

atau:

```java
public final class UserContextHolder {
    public static final ThreadLocal<UserContext> CURRENT = new ThreadLocal<>();
}
```

atau:

```java
public final class DateUtils {
    private static final SimpleDateFormat FORMAT = new SimpleDateFormat("yyyy-MM-dd");
}
```

Masalahnya berbeda-beda:

- static config membaca environment terlalu awal;
- static mutable state membuat test order-dependent;
- static `ThreadLocal` bisa leak;
- static formatter lama seperti `SimpleDateFormat` tidak thread-safe;
- static caches bisa leak class loader;
- static singletons sulit diganti untuk testing.

Static bukan selalu salah. Tetapi static harus punya alasan kuat:

- pure constants;
- immutable stateless utilities;
- safe shared caches dengan lifecycle jelas;
- framework-managed singleton yang explicit;
- stable runtime metadata.

---

## 4. API dan Contract yang Perlu Dipahami

### 4.1 `System.getProperty`

```java
String value = System.getProperty("app.env");
String valueWithDefault = System.getProperty("app.env", "local");
```

Risiko:

- key salah → `null`;
- value tidak tervalidasi;
- value berubah saat runtime;
- value dibaca saat static initialization sebelum bootstrap selesai;
- sensitive value bisa muncul di dump/log;
- behavior berbeda antar test.

Pattern lebih baik:

```java
public final class BootstrapConfigLoader {
    public AppConfig load() {
        String env = requiredProperty("app.env");
        int port = intProperty("app.port", 8080);
        boolean feature = booleanProperty("feature.new-flow", false);
        return new AppConfig(env, port, feature);
    }

    private static String requiredProperty(String key) {
        String value = System.getProperty(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required system property: " + key);
        }
        return value;
    }

    private static int intProperty(String key, int defaultValue) {
        String value = System.getProperty(key);
        if (value == null || value.isBlank()) return defaultValue;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ex) {
            throw new IllegalStateException("Invalid integer system property: " + key, ex);
        }
    }

    private static boolean booleanProperty(String key, boolean defaultValue) {
        String value = System.getProperty(key);
        if (value == null || value.isBlank()) return defaultValue;
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "true", "yes", "1", "on" -> true;
            case "false", "no", "0", "off" -> false;
            default -> throw new IllegalStateException("Invalid boolean system property: " + key);
        };
    }
}
```

Untuk Java 8, `switch` expression belum tersedia; gunakan `switch` statement atau `if`.

---

### 4.2 `Boolean.getBoolean`

`Boolean.getBoolean("key")` sering disalahpahami.

Ia bukan parsing string biasa. Ia membaca system property bernama `key`, lalu true jika property value adalah `"true"` ignoring case.

```java
System.setProperty("feature.enabled", "true");
boolean enabled = Boolean.getBoolean("feature.enabled");
```

Jangan pakai ini untuk parse value dari env/config object:

```java
// Salah untuk parsing arbitrary string:
boolean enabled = Boolean.getBoolean(value);
```

Gunakan:

```java
boolean enabled = Boolean.parseBoolean(value);
```

Namun `Boolean.parseBoolean` terlalu permisif: selain `"true"`, semuanya menjadi false. Untuk configuration, strict parser sering lebih aman.

---

### 4.3 `Integer.getInteger`, `Long.getLong`

Sama seperti `Boolean.getBoolean`, API ini membaca system property, bukan parse string biasa.

```java
Integer poolSize = Integer.getInteger("app.pool.size", 10);
Long timeout = Long.getLong("app.timeout.ms", 1000L);
```

Nama API ini mudah mengecoh. Untuk parsing string biasa:

```java
int poolSize = Integer.parseInt(value);
long timeout = Long.parseLong(value);
```

---

### 4.4 `System.getenv`

```java
String dbHost = System.getenv("DB_HOST");
Map<String, String> env = System.getenv();
```

Environment cocok dibaca saat bootstrap:

```java
public record DatabaseConfig(String host, int port, String serviceName) {}

public final class EnvConfigLoader {
    public DatabaseConfig loadDatabaseConfig() {
        return new DatabaseConfig(
            requiredEnv("DB_HOST"),
            parsePort(requiredEnv("DB_PORT")),
            requiredEnv("DB_SERVICE_NAME")
        );
    }

    private static String requiredEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + key);
        }
        return value;
    }

    private static int parsePort(String value) {
        int port;
        try {
            port = Integer.parseInt(value);
        } catch (NumberFormatException ex) {
            throw new IllegalStateException("Invalid DB_PORT: " + value, ex);
        }
        if (port < 1 || port > 65535) {
            throw new IllegalStateException("DB_PORT out of range: " + value);
        }
        return port;
    }
}
```

Catatan penting: environment variable sering dipakai untuk secrets, tetapi tidak selalu aman. Environment bisa terlihat oleh process inspection, crash dump, deployment metadata, atau logs jika tidak hati-hati. Untuk secrets production, gunakan secret manager/platform secret mechanism bila tersedia.

---

### 4.5 `Locale.getDefault` and `Locale.setDefault`

```java
Locale locale = Locale.getDefault();
Locale.setDefault(Locale.US);
```

`Locale.setDefault` adalah operasi global. Di aplikasi server, memanggil ini di runtime bisa menyebabkan request lain berubah behavior.

Untuk code yang memproses protocol/internal keys:

```java
String normalized = input.toLowerCase(Locale.ROOT);
```

Untuk user-facing format:

```java
NumberFormat format = NumberFormat.getNumberInstance(userLocale);
```

Untuk test, bila harus mengubah default locale, selalu restore:

```java
Locale previous = Locale.getDefault();
try {
    Locale.setDefault(Locale.forLanguageTag("tr-TR"));
    // test behavior
} finally {
    Locale.setDefault(previous);
}
```

JUnit extension bisa membantu, tetapi prinsipnya tetap: perubahan global harus dikembalikan.

---

### 4.6 `TimeZone.getDefault`, `ZoneId.systemDefault`, and `Clock`

Legacy:

```java
TimeZone tz = TimeZone.getDefault();
```

Modern:

```java
ZoneId zone = ZoneId.systemDefault();
```

Keduanya tetap membaca default runtime/host.

Untuk production business logic:

```java
public record TimeConfig(ZoneId businessZone) {}

public final class DeadlineCalculator {
    private final Clock clock;
    private final ZoneId zone;

    public DeadlineCalculator(Clock clock, ZoneId zone) {
        this.clock = clock;
        this.zone = zone;
    }

    public ZonedDateTime deadlineAfterBusinessDays(int days) {
        LocalDate today = LocalDate.now(clock.withZone(zone));
        return today.plusDays(days).atTime(23, 59, 59).atZone(zone);
    }
}
```

Untuk test:

```java
Clock fixed = Clock.fixed(
    Instant.parse("2026-06-17T00:00:00Z"),
    ZoneOffset.UTC
);
```

Jangan test waktu production dengan `now()` langsung jika logic harus deterministic.

---

### 4.7 `Charset.defaultCharset`

```java
Charset defaultCharset = Charset.defaultCharset();
```

Ini adalah runtime default charset. Sejak Java 18, default standard API adalah UTF-8, tetapi explicit charset tetap praktik terbaik untuk data contract.

Buruk:

```java
try (Reader reader = new FileReader(file)) {
    ...
}
```

Lebih baik:

```java
try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    ...
}
```

Buruk:

```java
String s = new String(bytes);
byte[] out = s.getBytes();
```

Lebih baik:

```java
String s = new String(bytes, StandardCharsets.UTF_8);
byte[] out = s.getBytes(StandardCharsets.UTF_8);
```

---

## 5. Evolusi Java 8–25

### 5.1 Java 8 baseline

Java 8 adalah baseline penting karena banyak enterprise system masih memiliki dependency lama.

Di Java 8:

- no module system;
- default charset bergantung pada platform/locale;
- records belum ada;
- sealed types belum ada;
- `Runtime.Version` belum ada;
- `StackWalker` belum ada;
- banyak framework mengandalkan reflective/internal API access;
- default locale/timezone/charset issues sering tersembunyi.

Untuk Java 8 compatibility, jangan gunakan API Java 9+ secara langsung kecuali build/runtime target memang lebih baru atau memakai multi-release JAR/reflection boundary.

---

### 5.2 Java 9: modules and stronger runtime boundaries

Java 9 memperkenalkan JPMS. Walaupun part ini bukan module deep dive, ada efek pada global state:

- internal JDK APIs tidak lagi boleh dianggap stabil;
- reflective access makin dibatasi;
- beberapa library lama yang membaca internal properties/classes bisa bermasalah;
- runtime image modular memengaruhi asumsi tentang classpath/JDK layout.

Global state yang dulu bisa “diintip” via internal API menjadi lebih riskan.

---

### 5.3 Java 10–17: container awareness and modern LTS adoption

Pada era Java 10–17, container awareness JVM makin penting. Walaupun ini lebih dekat ke runtime/ops, konsekuensinya pada global design besar:

- `Runtime.availableProcessors()` bisa dipengaruhi container CPU limits;
- memory heuristics berubah dalam container;
- default timezone/locale/charset bisa berbeda di base image minimal;
- deployment config harus explicit.

Aplikasi yang membaca host defaults tanpa audit sering mengalami perubahan behavior saat pindah dari VM tradisional ke container/Kubernetes.

---

### 5.4 Java 18: UTF-8 by default

JEP 400 menstandarkan UTF-8 sebagai default charset untuk standard Java APIs. Ini mengurangi class bug “works on my machine” akibat default charset berbeda antar OS.

Namun untuk sistem lintas Java 8–25, tetap penting:

- audit API yang memakai default charset;
- gunakan charset eksplisit untuk file/protocol contract;
- jangan berasumsi semua runtime adalah Java 18+;
- berhati-hati saat aplikasi lama bergantung pada platform encoding.

Migration trap:

```java
// Aplikasi lama Java 8 di Windows mungkin diam-diam membaca Cp1252.
// Setelah Java 18+, default menjadi UTF-8.
String text = new String(bytes); // behavior bisa berubah
```

Fix:

```java
String text = new String(bytes, StandardCharsets.UTF_8); // atau charset legacy eksplisit bila contract memang legacy
```

---

### 5.5 Java 21–25: modern server baseline and stricter assumptions

Java 21 menjadi LTS modern yang banyak dipakai enterprise. Java 25 adalah rilis terbaru dalam scope seri ini.

Implikasi desain:

- explicit runtime compatibility semakin penting;
- virtual thread membuat `ThreadLocal` global-context pattern perlu diaudit;
- Security Manager sudah tidak boleh menjadi fondasi sandboxing modern;
- library lama yang bergantung pada internal JDK behavior makin riskan;
- default charset sudah UTF-8, tetapi default timezone/locale tetap perlu explicit untuk business logic.

---

## 6. Step-by-Step: Dari Global Reads ke Typed Configuration

### 6.1 Contoh awal yang umum tetapi rapuh

```java
public final class ReportExporter {
    public void export(Path path, List<ReportRow> rows) throws IOException {
        String zone = System.getProperty("app.zone", "Asia/Jakarta");
        String env = System.getenv("APP_ENV");

        try (BufferedWriter writer = Files.newBufferedWriter(path)) {
            writer.write("env=" + env);
            writer.newLine();
            writer.write("generatedAt=" + ZonedDateTime.now(ZoneId.of(zone)));
            writer.newLine();

            for (ReportRow row : rows) {
                writer.write(row.toCsvLine());
                writer.newLine();
            }
        }
    }
}
```

Masalah:

- env dibaca di business/service class;
- timezone string tidak divalidasi saat startup;
- writer memakai default charset;
- waktu memakai `now()` langsung sehingga test tidak deterministic;
- CSV formatting mungkin locale/escaping tidak jelas;
- sulit mengaudit config apa yang digunakan.

---

### 6.2 Buat typed config

```java
public record RuntimeAppConfig(
    String environment,
    ZoneId businessZone,
    Charset exportCharset
) {}
```

Config ini explicit. Domain/service code tidak perlu tahu sumbernya dari env, property, file config, Vault, Kubernetes Secret, Spring config, atau parameter store.

---

### 6.3 Load config di bootstrap boundary

```java
public final class RuntimeAppConfigLoader {
    public RuntimeAppConfig load() {
        String env = requiredEnv("APP_ENV");
        ZoneId zone = parseZone(System.getProperty("app.businessZone", "Asia/Jakarta"));
        Charset charset = parseCharset(System.getProperty("app.exportCharset", "UTF-8"));

        return new RuntimeAppConfig(env, zone, charset);
    }

    private static String requiredEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env var: " + key);
        }
        return value;
    }

    private static ZoneId parseZone(String value) {
        try {
            return ZoneId.of(value);
        } catch (DateTimeException ex) {
            throw new IllegalStateException("Invalid app.businessZone: " + value, ex);
        }
    }

    private static Charset parseCharset(String value) {
        try {
            return Charset.forName(value);
        } catch (IllegalCharsetNameException | UnsupportedCharsetException ex) {
            throw new IllegalStateException("Invalid app.exportCharset: " + value, ex);
        }
    }
}
```

---

### 6.4 Inject config and clock

```java
public final class ReportExporter {
    private final RuntimeAppConfig config;
    private final Clock clock;

    public ReportExporter(RuntimeAppConfig config, Clock clock) {
        this.config = Objects.requireNonNull(config);
        this.clock = Objects.requireNonNull(clock);
    }

    public void export(Path path, List<ReportRow> rows) throws IOException {
        try (BufferedWriter writer = Files.newBufferedWriter(path, config.exportCharset())) {
            writer.write("env=" + config.environment());
            writer.newLine();
            writer.write("generatedAt=" + ZonedDateTime.now(clock.withZone(config.businessZone())));
            writer.newLine();

            for (ReportRow row : rows) {
                writer.write(row.toCsvLine());
                writer.newLine();
            }
        }
    }
}
```

Sekarang behavior ditentukan oleh constructor dependencies.

Test menjadi mudah:

```java
RuntimeAppConfig config = new RuntimeAppConfig(
    "test",
    ZoneId.of("Asia/Jakarta"),
    StandardCharsets.UTF_8
);

Clock clock = Clock.fixed(
    Instant.parse("2026-06-17T00:00:00Z"),
    ZoneOffset.UTC
);

ReportExporter exporter = new ReportExporter(config, clock);
```

---

## 7. Static Initialization Trap

### 7.1 Apa itu static initialization trap?

Static initialization trap terjadi ketika class membaca global state saat class pertama kali di-load/di-initialize, lalu nilai itu “membeku” atau side effect terjadi terlalu awal.

Contoh:

```java
public final class AppRuntime {
    public static final ZoneId BUSINESS_ZONE = ZoneId.of(
        System.getProperty("app.businessZone", "Asia/Jakarta")
    );
}
```

Tampak efisien, tetapi berbahaya:

- nilai dibaca saat class initialization, bukan saat bootstrap resmi;
- test yang mengubah property setelah class loaded tidak berpengaruh;
- class bisa initialized oleh dependency tak terduga;
- invalid property menyebabkan `ExceptionInInitializerError`;
- sulit reload config;
- sulit observability kapan nilai dibaca.

---

### 7.2 `ExceptionInInitializerError`

```java
public final class BadConfig {
    static final int PORT = Integer.parseInt(System.getenv("PORT"));
}
```

Jika `PORT` tidak ada atau invalid, class initialization gagal. Setelah gagal, class bisa menjadi unusable dalam class loader tersebut.

Gejala:

```text
ExceptionInInitializerError
Caused by: NumberFormatException
```

Masalahnya bukan hanya exception; failure terjadi saat class disentuh pertama kali, mungkin jauh dari bootstrap flow.

Lebih baik validasi config explicit saat startup:

```java
public static void main(String[] args) {
    AppConfig config = new AppConfigLoader().loadOrThrow();
    Application app = new Application(config);
    app.start();
}
```

---

### 7.3 Static final bukan selalu compile-time constant

```java
public static final String ENV = "prod";
```

Ini compile-time constant.

```java
public static final String ENV = System.getenv("APP_ENV");
```

Ini bukan compile-time constant. Nilainya dihitung saat class initialization.

Dampaknya:

- timing matters;
- class loading order matters;
- test isolation matters;
- config refresh tidak mungkin tanpa class loader baru;
- value tidak selalu terlihat sebagai dependency.

---

### 7.4 Safe static constants

Aman:

```java
public final class ProtocolConstants {
    public static final String HEADER_CORRELATION_ID = "X-Correlation-Id";
    public static final Charset WIRE_CHARSET = StandardCharsets.UTF_8;

    private ProtocolConstants() {}
}
```

Kurang aman:

```java
public final class ProtocolConstants {
    public static final String SERVICE_URL = System.getenv("SERVICE_URL");
}
```

Rule of thumb:

> Static constants boleh untuk truth yang benar-benar intrinsic dan tidak tergantung deployment/runtime. Untuk configuration, gunakan bootstrap loader dan typed config.

---

## 8. Design Patterns / Usage Patterns

### 8.1 Bootstrap-only global access

Pattern:

1. baca env/system properties hanya di startup/bootstrap;
2. validate fail-fast;
3. convert ke typed config;
4. inject ke komponen;
5. jangan baca global lagi di domain/service layer.

```java
public final class Main {
    public static void main(String[] args) {
        RuntimeAppConfig config = new RuntimeAppConfigLoader().load();
        Clock clock = Clock.system(config.businessZone());
        Application application = new Application(config, clock);
        application.start();
    }
}
```

Keuntungan:

- dependency explicit;
- mudah test;
- config bisa diaudit saat startup;
- invalid config gagal cepat;
- service behavior stabil.

---

### 8.2 Config precedence

Aplikasi serius perlu aturan precedence jelas.

Contoh:

1. command-line args;
2. system properties;
3. environment variables;
4. config file;
5. default safe values.

Atau versi 12-factor:

1. environment variables;
2. mounted secrets/config;
3. safe defaults for local only.

Yang penting bukan urutannya universal, tetapi **tertulis dan deterministic**.

Contoh resolver:

```java
public final class ConfigValueResolver {
    public Optional<String> resolve(String key) {
        String propertyKey = key.toLowerCase(Locale.ROOT).replace('_', '.');
        String envKey = key.toUpperCase(Locale.ROOT).replace('.', '_');

        String fromProperty = System.getProperty(propertyKey);
        if (fromProperty != null && !fromProperty.isBlank()) {
            return Optional.of(fromProperty);
        }

        String fromEnv = System.getenv(envKey);
        if (fromEnv != null && !fromEnv.isBlank()) {
            return Optional.of(fromEnv);
        }

        return Optional.empty();
    }
}
```

Caveat: mapping key otomatis bisa membingungkan. Untuk production, daftar key explicit sering lebih defensible.

---

### 8.3 Typed config with validation

Jangan sebar stringly-typed config.

Buruk:

```java
Map<String, String> config;
```

Lebih baik:

```java
public record HttpClientConfig(
    URI baseUri,
    Duration connectTimeout,
    Duration readTimeout,
    int maxRetries
) {
    public HttpClientConfig {
        Objects.requireNonNull(baseUri);
        Objects.requireNonNull(connectTimeout);
        Objects.requireNonNull(readTimeout);

        if (connectTimeout.isNegative() || connectTimeout.isZero()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (readTimeout.isNegative() || readTimeout.isZero()) {
            throw new IllegalArgumentException("readTimeout must be positive");
        }
        if (maxRetries < 0 || maxRetries > 10) {
            throw new IllegalArgumentException("maxRetries out of range");
        }
    }
}
```

Untuk Java 8, gunakan final class biasa.

---

### 8.4 Explicit locale for machine text

Machine text meliputi:

- enum external code;
- HTTP header key normalization;
- config key normalization;
- protocol token;
- database status code;
- cache key;
- file extension;
- command keyword;
- XML element/attribute matching jika case-insensitive logic memang dibutuhkan.

Gunakan:

```java
String normalized = input.trim().toLowerCase(Locale.ROOT);
```

Jangan:

```java
String normalized = input.trim().toLowerCase();
```

---

### 8.5 Explicit timezone for business time

Pisahkan:

- `Instant`: machine timeline/audit timestamp;
- `ZoneId`: business/regional interpretation;
- `LocalDate`: business date tanpa time zone, tapi harus berasal dari zone yang jelas;
- `Clock`: source of current time yang testable.

Contoh:

```java
public final class AuditStampProvider {
    private final Clock clock;

    public AuditStampProvider(Clock clock) {
        this.clock = clock;
    }

    public Instant nowInstant() {
        return clock.instant();
    }
}
```

Untuk deadline berbasis kantor/agency:

```java
public final class AgencyBusinessDate {
    private final Clock clock;
    private final ZoneId agencyZone;

    public LocalDate today() {
        return LocalDate.now(clock.withZone(agencyZone));
    }
}
```

---

### 8.6 Explicit charset for external contracts

Untuk file exchange, audit export, CSV, XML, JSON, fixed-width, email attachment, always explicit:

```java
Files.writeString(path, xml, StandardCharsets.UTF_8);
```

Untuk Java 8:

```java
Files.write(path, xml.getBytes(StandardCharsets.UTF_8));
```

Untuk XML, encoding declaration harus konsisten dengan bytes:

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

Jika writer memakai UTF-8 tapi XML declaration berkata `ISO-8859-1`, downstream parser bisa gagal atau salah interpretasi.

---

### 8.7 Scoped override for tests only

Kadang test harus memverifikasi behavior terhadap default locale/timezone/property.

Buat helper yang restore state:

```java
public final class SystemPropertyOverride implements AutoCloseable {
    private final String key;
    private final String previous;
    private final boolean existed;

    public SystemPropertyOverride(String key, String value) {
        this.key = key;
        this.previous = System.getProperty(key);
        this.existed = System.getProperties().containsKey(key);
        System.setProperty(key, value);
    }

    @Override
    public void close() {
        if (existed) {
            System.setProperty(key, previous);
        } else {
            System.clearProperty(key);
        }
    }
}
```

Usage:

```java
try (SystemPropertyOverride ignored = new SystemPropertyOverride("app.mode", "test")) {
    // test
}
```

Untuk locale/timezone:

```java
Locale previous = Locale.getDefault();
try {
    Locale.setDefault(Locale.forLanguageTag("tr-TR"));
    // test
} finally {
    Locale.setDefault(previous);
}
```

Jangan jalankan test semacam ini paralel tanpa isolasi, karena global state akan saling mengganggu.

---

## 9. Failure Modes

### 9.1 Test order dependency

Gejala:

- test lulus jika dijalankan sendiri;
- gagal jika seluruh suite dijalankan;
- gagal hanya di CI;
- gagal hanya ketika parallel test aktif.

Penyebab umum:

```java
@Test
void testA() {
    Locale.setDefault(Locale.US);
}

@Test
void testB() {
    assertEquals("1,23", formatDecimal(...));
}
```

`testA` tidak restore locale. `testB` menerima global state yang sudah berubah.

Fix:

- restore global state;
- gunakan dependency explicit;
- hindari parallel untuk test yang mutate global;
- gunakan test extension/resource lock.

---

### 9.2 Static initialization reads config too early

```java
public final class ApiClientDefaults {
    static final URI BASE_URI = URI.create(System.getenv("API_BASE_URL"));
}
```

Class ini bisa diinitialize saat:

- logger introspection;
- unit test loads class;
- DI container scanning;
- static reference dari class lain;
- serialization/reflection.

Jika env belum disiapkan, error muncul di tempat tidak intuitif.

Fix:

- jangan baca config di static initializer;
- load config explicit di startup;
- pass config via constructor.

---

### 9.3 Timezone drift

Bug:

```java
LocalDate submittedDate = LocalDate.now();
```

Di local dev timezone Asia/Jakarta, di container UTC, hasil tanggal bisa beda sekitar midnight.

Fix:

```java
LocalDate submittedDate = LocalDate.now(clock.withZone(businessZone));
```

Untuk audit timestamp:

```java
Instant submittedAt = clock.instant();
```

---

### 9.4 Locale-sensitive casing bug

Bug:

```java
String normalized = role.toUpperCase();
```

Pada default locale tertentu, casing bisa tidak sesuai protocol.

Fix:

```java
String normalized = role.toUpperCase(Locale.ROOT);
```

---

### 9.5 Default charset migration bug

Bug:

```java
String payload = new String(bytes);
```

Jika Java 8 runtime memakai platform encoding tertentu dan Java 18+ memakai UTF-8, hasil bisa berubah.

Fix:

```java
String payload = new String(bytes, StandardCharsets.UTF_8);
```

Atau gunakan charset legacy eksplisit bila external contract memang legacy:

```java
Charset legacy = Charset.forName("windows-1252");
String payload = new String(bytes, legacy);
```

---

### 9.6 Mutable global properties race

```java
System.setProperty("app.feature", "true");
```

Jika dilakukan di runtime server, thread lain bisa membaca nilai lama/baru tergantung timing. Ini bukan feature flag system yang baik.

Fix:

- gunakan config service yang thread-safe;
- gunakan immutable snapshot;
- gunakan atomic reference jika dynamic config perlu;
- audit perubahan;
- jangan pakai system properties sebagai dynamic runtime config bus.

---

### 9.7 Secrets leak via properties/environment

Risk:

```java
System.getProperties().forEach((k, v) -> log.info("{}={}", k, v));
System.getenv().forEach((k, v) -> log.info("{}={}", k, v));
```

Ini bisa membocorkan:

- DB password;
- API key;
- token;
- proxy credentials;
- trust store password;
- cloud credentials;
- secrets injected by orchestrator.

Fix:

- never dump full env/properties;
- whitelist safe keys;
- redact sensitive values;
- separate config diagnostics from secret values.

---

### 9.8 Host default dependency in container

Container base image minimal bisa punya:

- locale yang tidak lengkap;
- timezone database berbeda;
- default `TZ` tidak sesuai;
- `/tmp` behavior berbeda;
- user home berbeda;
- read-only filesystem;
- different line separators unlikely on Linux but still contract matters.

Fix:

- set timezone explicitly if needed;
- use explicit locale/charset;
- configure writable temp dir;
- do not assume `user.home`;
- expose runtime diagnostics safely at startup.

---

## 10. Production Design Model

### 10.1 Layering global state

Recommended layering:

```text
OS / Container / Orchestrator
        ↓
Environment Variables / Mounted Config / Secrets
        ↓
JVM Launcher / System Properties / JVM Flags
        ↓
Bootstrap Config Loader
        ↓
Typed Immutable Config Objects
        ↓
Application Services / Domain Logic
        ↓
External Effects
```

Yang salah:

```text
Domain Logic → System.getenv / System.getProperty / Locale.getDefault / ZoneId.systemDefault
```

Domain logic harus menerima dependency, bukan mencari global state sendiri.

---

### 10.2 Invariants for serious systems

Untuk sistem production yang harus bisa diaudit, tetapkan invariant berikut:

1. Semua required configuration divalidasi saat startup.
2. Semua config punya owner dan documented source.
3. Domain logic tidak membaca env/system property langsung.
4. Timezone bisnis explicit.
5. Audit timestamp disimpan sebagai `Instant` atau equivalent UTC timeline.
6. User-facing formatting memakai locale user explicit.
7. Machine/protocol normalization memakai `Locale.ROOT`.
8. External text encoding explicit.
9. Test yang mutate global state restore state.
10. Secrets tidak pernah di-dump mentah.
11. Static initialization tidak membaca deployment config.
12. Runtime diagnostics hanya menampilkan safe config subset.

---

### 10.3 Configuration object style

Good config object:

```java
public record SmtpConfig(
    String host,
    int port,
    boolean tlsEnabled,
    Duration connectTimeout,
    Duration readTimeout
) {
    public SmtpConfig {
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("SMTP host is required");
        }
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("SMTP port out of range");
        }
        if (connectTimeout == null || connectTimeout.isZero() || connectTimeout.isNegative()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (readTimeout == null || readTimeout.isZero() || readTimeout.isNegative()) {
            throw new IllegalArgumentException("readTimeout must be positive");
        }
    }
}
```

Properties:

- immutable;
- typed;
- validates invariants;
- no hidden global reads;
- safe to pass around;
- easy to log in redacted form.

---

### 10.4 Redacted diagnostic output

```java
public record DatabaseConfig(
    String host,
    int port,
    String serviceName,
    String username,
    String password
) {
    public String toSafeDiagnosticString() {
        return "DatabaseConfig[host=" + host
            + ", port=" + port
            + ", serviceName=" + serviceName
            + ", username=" + username
            + ", password=<redacted>]";
    }
}
```

Jangan override `toString()` record dengan data sensitif tanpa sadar. Record default `toString()` mencetak semua component.

Untuk config yang mengandung secret, pertimbangkan:

- jangan jadikan secret sebagai record component yang mudah tercetak;
- override `toString()`;
- gunakan wrapper `SecretString` dengan redacted `toString()`;
- hindari logging config object mentah.

---

## 11. Java 8 Compatibility Notes

Jika target Java 8 sampai 25:

- jangan gunakan `record` di source utama Java 8;
- gunakan final class immutable untuk config;
- `Files.readString/writeString` tidak tersedia di Java 8;
- gunakan `Files.readAllBytes`, `Files.write`, `Files.newBufferedReader`, `Files.newBufferedWriter`;
- gunakan `StandardCharsets.UTF_8`;
- gunakan `Clock`, `ZoneId`, `Instant`, `LocalDate` karena `java.time` tersedia sejak Java 8;
- `switch` expression tidak tersedia;
- `var` tidak tersedia;
- module APIs tidak tersedia;
- default charset belum UTF-8 by standard, jadi explicit charset jauh lebih penting.

Java 8 style config class:

```java
public final class RuntimeAppConfig {
    private final String environment;
    private final ZoneId businessZone;
    private final Charset exportCharset;

    public RuntimeAppConfig(String environment, ZoneId businessZone, Charset exportCharset) {
        if (environment == null || environment.trim().isEmpty()) {
            throw new IllegalArgumentException("environment is required");
        }
        this.environment = environment;
        this.businessZone = Objects.requireNonNull(businessZone, "businessZone");
        this.exportCharset = Objects.requireNonNull(exportCharset, "exportCharset");
    }

    public String environment() {
        return environment;
    }

    public ZoneId businessZone() {
        return businessZone;
    }

    public Charset exportCharset() {
        return exportCharset;
    }
}
```

---

## 12. Advanced Reasoning: When Is Global State Acceptable?

Global state tidak selalu salah. Yang salah adalah global state yang tidak punya ownership, lifecycle, dan contract.

### 12.1 Acceptable global state

Biasanya acceptable:

- true constants;
- immutable lookup tables;
- stateless utility methods;
- logger instances;
- JVM-provided metadata read for diagnostics;
- startup-only global reads;
- framework-managed singletons with clear lifecycle;
- caches with bounded size and lifecycle.

Contoh:

```java
private static final Pattern POSTAL_CODE = Pattern.compile("^[0-9]{6}$");
```

Ini aman karena pattern immutable/thread-safe dan tidak tergantung deployment state.

---

### 12.2 Dangerous global state

Biasanya dangerous:

- mutable static maps;
- static current user/context;
- static config loaded from env;
- default locale/timezone mutation;
- system property mutation at runtime;
- unbounded static cache;
- static resources without close lifecycle;
- global feature flags via system properties;
- secrets in static strings.

Contoh:

```java
public static final Map<String, Object> CACHE = new HashMap<>();
```

Masalah:

- not thread-safe;
- unbounded;
- no lifecycle;
- hard to test;
- leaks memory;
- no ownership.

---

### 12.3 Decision checklist

Sebelum membuat global/static state, tanya:

1. Apakah nilai ini benar-benar sama di semua environment?
2. Apakah nilai ini immutable?
3. Apakah thread-safe?
4. Apakah ada lifecycle close/cleanup?
5. Apakah bisa menyebabkan memory leak?
6. Apakah bisa mengandung secret/PII?
7. Apakah test bisa mengisolasinya?
8. Apakah class loader reload akan aman?
9. Apakah perubahan runtime diperlukan?
10. Apakah dependency lebih baik diinjeksi?

Jika ragu, jangan global.

---

## 13. Thought Exercise: Regulatory Case Management System

Bayangkan sistem case management memiliki rules:

- deadline appeal dihitung berdasarkan timezone agency;
- audit timestamp harus comparable lintas region;
- report CSV diekspor untuk external agency;
- user melihat tanggal sesuai locale preferensi;
- batch import berjalan di Kubernetes container;
- test berjalan parallel di CI;
- config berbeda antara DEV/UAT/PROD.

Desain buruk:

```java
public final class AppealDeadlineService {
    public LocalDate dueDate(int days) {
        return LocalDate.now().plusDays(days);
    }
}
```

Masalah:

- default timezone implicit;
- current time implicit;
- tidak deterministic;
- tidak bisa audit business zone;
- test midnight flaky.

Desain lebih baik:

```java
public final class AppealDeadlineService {
    private final Clock clock;
    private final ZoneId agencyZone;

    public AppealDeadlineService(Clock clock, ZoneId agencyZone) {
        this.clock = Objects.requireNonNull(clock);
        this.agencyZone = Objects.requireNonNull(agencyZone);
    }

    public LocalDate dueDate(int days) {
        if (days < 0) {
            throw new IllegalArgumentException("days must not be negative");
        }
        LocalDate today = LocalDate.now(clock.withZone(agencyZone));
        return today.plusDays(days);
    }
}
```

Audit event:

```java
public record AuditEvent(
    String caseId,
    String action,
    Instant occurredAt,
    String actorId
) {}
```

Display:

```java
public final class AuditEventFormatter {
    public String format(AuditEvent event, Locale userLocale, ZoneId userZone) {
        DateTimeFormatter formatter = DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM)
            .withLocale(userLocale)
            .withZone(userZone);

        return formatter.format(event.occurredAt());
    }
}
```

Principle:

- store machine time as `Instant`;
- compute business dates with explicit business zone;
- display with explicit user locale/zone;
- never let host defaults decide regulatory meaning.

---

## 14. Production Checklist

### 14.1 Startup checklist

- [ ] Required env vars exist.
- [ ] Required system properties exist.
- [ ] Config values parsed into typed objects.
- [ ] Invalid values fail fast.
- [ ] Timezone explicitly configured.
- [ ] Charset explicitly configured for external files.
- [ ] Locale strategy defined.
- [ ] Secret values redacted.
- [ ] Safe config summary logged.
- [ ] Java runtime version logged.
- [ ] Container CPU/memory assumptions verified where relevant.

---

### 14.2 Code review checklist

Look for:

```java
System.getenv(
System.getProperty(
System.setProperty(
Locale.getDefault(
Locale.setDefault(
TimeZone.getDefault(
TimeZone.setDefault(
ZoneId.systemDefault(
Charset.defaultCharset(
new String(bytes)
string.getBytes()
new FileReader(
new FileWriter(
LocalDate.now()
ZonedDateTime.now()
OffsetDateTime.now()
Instant.now()
```

Not all are wrong. But each occurrence should have a reason.

Ask:

- Is this bootstrap code or domain code?
- Should locale/timezone/charset/clock be explicit?
- Is this test deterministic?
- Is this behavior stable across Java 8–25?
- Could this leak secret?
- Could this change global state for other tests/threads?

---

### 14.3 Test checklist

- [ ] Tests using time inject `Clock`.
- [ ] Tests changing locale restore previous locale.
- [ ] Tests changing timezone restore previous timezone.
- [ ] Tests changing system properties restore previous properties.
- [ ] Parallel tests do not mutate shared global state unsafely.
- [ ] File encoding tests use explicit charset.
- [ ] CI runs at least one profile with non-default locale/timezone if logic is sensitive.

Useful test scenarios:

- `Locale.ROOT` vs Turkish locale;
- UTC vs Asia/Jakarta timezone;
- UTF-8 text with non-ASCII characters;
- missing env var;
- invalid port/duration/URI;
- secret redaction;
- Java 8-compatible code path if supported.

---

## 15. Summary

Global state adalah salah satu sumber bug paling halus di Java production systems. Ia tidak selalu terlihat sebagai dependency, tetapi bisa mengubah behavior program secara signifikan.

Key takeaways:

1. System properties adalah global mutable JVM map.
2. Environment variables adalah deployment boundary dari OS/container.
3. Default locale memengaruhi formatting, casing, parsing, dan display.
4. Default timezone memengaruhi date/time interpretation.
5. Default charset berubah besar sejak Java 18 menjadi UTF-8 by standard, tetapi external contracts tetap harus explicit.
6. Static initialization yang membaca config adalah trap karena timing class initialization tidak selalu obvious.
7. Domain logic tidak seharusnya membaca `System.getenv`, `System.getProperty`, `Locale.getDefault`, `ZoneId.systemDefault`, atau `Charset.defaultCharset` secara diam-diam.
8. Baca global state di bootstrap, validasi, ubah menjadi typed immutable config, lalu inject.
9. Untuk waktu, gunakan `Clock` dan `ZoneId` explicit.
10. Untuk text machine/protocol, gunakan `Locale.ROOT`.
11. Untuk file/wire encoding, gunakan charset explicit.
12. Untuk tests, restore semua global state yang diubah.

Mental model paling penting:

> Global state adalah input tersembunyi. Semakin penting behavior-nya, semakin wajib input itu dibuat eksplisit.

---

## 16. Referensi Resmi

- Java SE 25 API — `java.lang.System`
- Java SE 25 API — System Properties
- Java SE 25 API — `java.util.Locale`
- Java SE 25 API — `java.util.TimeZone`
- Java SE 25 API — `java.nio.charset.Charset`
- OpenJDK JEP 400 — UTF-8 by Default
- Java SE 8 API — baseline compatibility for Java 8 behavior

---

## 17. Status Seri

Part 19 selesai.

Progress seri:

- Selesai: Part 0–19
- Berikutnya: Part 20 — `Math`, `StrictMath`, Floating Point, Exact Arithmetic, and Determinism
- File berikutnya: `20-math-strictmath-floating-point-exact-arithmetic-determinism.md`

Seri belum selesai.
