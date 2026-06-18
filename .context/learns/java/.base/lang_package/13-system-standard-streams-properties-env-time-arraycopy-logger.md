# Part 13 — `System`: Standard Streams, Properties, Environment, Time, Array Copy, Logger

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `13-system-standard-streams-properties-env-time-arraycopy-logger.md`  
> Scope: Java 8 hingga Java 25  
> Status seri: Part 13 dari 32 — belum selesai

---

## 1. Tujuan Part Ini

`java.lang.System` terlihat seperti class utility sederhana. Di level beginner, biasanya hanya dipakai untuk:

```java
System.out.println("hello");
System.currentTimeMillis();
System.getenv("HOME");
```

Namun di sistem production, `System` adalah salah satu API yang paling dekat dengan batas antara aplikasi Java dan environment tempat JVM berjalan.

Part ini bertujuan membangun pemahaman bahwa `System` adalah **global runtime gateway** untuk:

1. standard input/output/error;
2. system properties;
3. environment variables;
4. waktu wall-clock dan monotonic-clock;
5. array memory copy;
6. identity hash;
7. line separator;
8. native library loading;
9. GC/finalization hint;
10. process termination;
11. simple platform logger;
12. sebagian API historis yang dulu terkait Security Manager.

Target akhirnya bukan hanya hafal method `System`, tetapi mampu menjawab pertanyaan desain seperti:

- kapan boleh membaca `System.getenv()` langsung?
- kapan system property menjadi dependency tersembunyi?
- kenapa `currentTimeMillis()` buruk untuk menghitung durasi?
- kenapa `nanoTime()` tidak boleh dianggap timestamp?
- apa risiko `System.exit()` di server?
- kenapa `System.out.println()` bukan logging strategy production?
- kenapa `System.arraycopy()` penting walaupun jarang ditulis manual?
- bagaimana Security Manager removal mengubah cara kita melihat API lama?

---

## 2. Mental Model Utama

Mental model yang perlu dipegang:

> `System` adalah pintu global JVM ke process-level environment.

Artinya, `System` bukan sekadar helper. Ia mengakses atau memodifikasi sesuatu yang bersifat **global**, **process-wide**, atau **environment-coupled**.

```text
Application Code
      |
      v
java.lang.System
      |
      +--> Standard streams: stdin/stdout/stderr
      +--> JVM properties: java.version, user.dir, file.encoding, ...
      +--> OS environment variables
      +--> Clocks: wall-clock, monotonic time source
      +--> JVM shutdown/exit
      +--> GC/finalization hints
      +--> Native library loading
      +--> Low-level array copy
      +--> Simple logger bridge
```

Karena sifatnya global, kesalahan penggunaan `System` sering tidak terlihat di unit test kecil, tetapi muncul di:

- container;
- test suite paralel;
- long-running server;
- application server;
- plugin architecture;
- multi-tenant service;
- batch job besar;
- distributed system;
- regulated system yang perlu auditability.

### 2.1 Prinsip Besar

Gunakan prinsip ini:

> Membaca `System` berarti membaca global context. Mengubah `System` berarti mengubah global behavior JVM.

Maka, dalam desain production:

- boleh membaca `System` di boundary layer;
- hindari membaca `System` tersebar di domain logic;
- hindari mengubah `System` kecuali di bootstrap/test harness;
- bungkus access ke `System` di abstraction bila butuh testability dan determinism.

---

## 3. `System` dalam Java Platform

`System` berada di package `java.lang`, sehingga otomatis tersedia tanpa import.

```java
public final class System {
    private System() {}
}
```

Karakteristik penting:

| Aspek | Makna |
|---|---|
| `final` class | Tidak bisa diwariskan |
| constructor private | Tidak bisa diinstansiasi |
| static members | Semua akses lewat class |
| global state | Banyak field/method berhubungan dengan JVM process |
| native boundary | Beberapa operasi bergantung JVM/OS |

Di Java SE 25, `System` tetap menjadi bagian dari module `java.base`. Module `java.base` adalah foundational module yang selalu ada pada semua Java runtime image modern sejak Java 9.

---

## 4. Standard Streams: `in`, `out`, `err`

`System` menyediakan tiga stream global:

```java
public static final InputStream in;
public static final PrintStream out;
public static final PrintStream err;
```

Secara konseptual:

```text
System.in   -> standard input
System.out  -> standard output
System.err  -> standard error
```

### 4.1 `System.out`

`System.out` adalah `PrintStream`, bukan logger.

```java
System.out.println("Application started");
```

Ini baik untuk:

- contoh kode;
- CLI kecil;
- debug sementara;
- tutorial;
- bootstrap sangat awal sebelum logging framework siap.

Namun untuk server production, `System.out.println` punya kelemahan:

1. tidak punya level log terstruktur;
2. tidak punya correlation id;
3. tidak punya structured fields;
4. sulit dikontrol per package/class;
5. bisa interleaving antar thread;
6. bisa blocking tergantung sink;
7. tidak punya redaction policy;
8. sering melewati observability convention tim.

### 4.2 `System.err`

`System.err` digunakan untuk error output.

```java
System.err.println("Failed to start application");
```

Di CLI, pemisahan stdout/stderr penting:

- stdout untuk output normal yang bisa dipipe;
- stderr untuk diagnostic/error message.

Contoh:

```bash
java MyTool > result.txt 2> error.log
```

Untuk server containerized, stdout/stderr sering ditangkap runtime container dan dikirim ke log collector. Namun tetap lebih baik menggunakan logging framework yang output akhirnya bisa diarahkan ke stdout/stderr secara terstruktur.

### 4.3 `System.in`

`System.in` adalah input stream global.

```java
int b = System.in.read();
```

Dalam CLI, ini wajar. Dalam server, membaca `System.in` biasanya red flag karena:

- server tidak interaktif;
- thread bisa block permanen;
- container mungkin tidak punya stdin aktif;
- testing menjadi sulit.

---

## 5. Mengganti Standard Streams: `setIn`, `setOut`, `setErr`

`System` memungkinkan mengganti stream global:

```java
System.setOut(new PrintStream(outputStream));
System.setErr(new PrintStream(errorStream));
System.setIn(inputStream);
```

Ini berguna di:

- test harness;
- CLI wrapper;
- embedded interpreter;
- migration legacy app;
- capturing output dari code lama.

Namun ini sangat berbahaya bila dilakukan sembarangan karena efeknya JVM-wide.

### 5.1 Contoh Test Capture

```java
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

public class OutputCaptureExample {
    public static void main(String[] args) throws Exception {
        PrintStream originalOut = System.out;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();

        try (PrintStream replacement = new PrintStream(buffer, true, StandardCharsets.UTF_8)) {
            System.setOut(replacement);

            System.out.println("hello");
        } finally {
            System.setOut(originalOut);
        }

        String captured = buffer.toString(StandardCharsets.UTF_8);
        originalOut.println("Captured = " + captured.strip());
    }
}
```

### 5.2 Failure Mode: Test Pollution

Masalah klasik:

```java
System.setOut(fakeOut);
// test fails before restoring
```

Akibatnya test lain ikut memakai `fakeOut`.

Pattern aman:

```java
PrintStream original = System.out;
try {
    System.setOut(fake);
    // test
} finally {
    System.setOut(original);
}
```

Untuk test paralel, mengganti global stream tetap berisiko. Lebih baik desain code agar menerima `PrintStream`/`Appendable`/logger sebagai dependency.

---

## 6. System Properties

System properties adalah key-value configuration milik JVM process.

API utama:

```java
String value = System.getProperty("java.version");
String userDir = System.getProperty("user.dir");
Properties props = System.getProperties();
System.setProperty("my.feature.enabled", "true");
System.clearProperty("my.feature.enabled");
```

### 6.1 Properties Bukan Environment Variables

System property berbeda dari environment variable.

```text
System Property
  - milik JVM
  - dapat diberikan via -Dkey=value
  - dapat diubah saat runtime
  - tipe String

Environment Variable
  - berasal dari OS/process environment
  - diwariskan saat process dibuat
  - umumnya immutable dari perspektif Java process
  - tipe String
```

Contoh menjalankan Java dengan property:

```bash
java -Dapp.mode=dev -Dfeature.audit=true com.example.Main
```

Lalu dibaca:

```java
String mode = System.getProperty("app.mode", "prod");
boolean audit = Boolean.parseBoolean(System.getProperty("feature.audit", "false"));
```

### 6.2 Common System Properties

Beberapa property umum:

| Property | Makna |
|---|---|
| `java.version` | versi Java runtime |
| `java.vendor` | vendor runtime |
| `java.home` | lokasi Java installation |
| `os.name` | nama OS |
| `os.arch` | arsitektur OS |
| `user.dir` | working directory |
| `user.home` | home directory user |
| `line.separator` | line separator platform |
| `file.separator` | file separator |
| `path.separator` | path list separator |

Catatan: jangan terlalu bergantung pada host defaults untuk behavior bisnis.

### 6.3 System Properties sebagai Hidden Dependency

Code seperti ini mudah, tetapi sulit dites:

```java
public final class ReportExporter {
    public Path outputDir() {
        return Path.of(System.getProperty("report.output.dir"));
    }
}
```

Masalah:

- dependency tidak terlihat dari constructor;
- test harus mutate global property;
- behavior berubah tergantung process launch;
- static initialization bisa membaca property terlalu awal.

Lebih baik:

```java
public record ReportConfig(Path outputDir) {}

public final class ReportExporter {
    private final ReportConfig config;

    public ReportExporter(ReportConfig config) {
        this.config = config;
    }

    public Path outputDir() {
        return config.outputDir();
    }
}
```

Boundary bootstrap:

```java
public final class ConfigLoader {
    public static ReportConfig fromSystemProperties() {
        String raw = System.getProperty("report.output.dir", "./reports");
        return new ReportConfig(Path.of(raw));
    }
}
```

Prinsip:

> Boleh membaca `System.getProperty` di bootstrap/config boundary, bukan menyebarkannya ke domain logic.

---

## 7. Environment Variables

Environment variables dibaca dengan:

```java
String home = System.getenv("HOME");
Map<String, String> env = System.getenv();
```

Environment variables sering dipakai di container/cloud:

```bash
APP_ENV=prod
DB_HOST=db.internal
DB_POOL_SIZE=20
```

### 7.1 Env Var sebagai Deployment Contract

Environment variable cocok untuk:

- deployment-specific configuration;
- secret reference, bukan secret value jika memungkinkan;
- container settings;
- region/zone;
- feature toggle coarse-grained;
- service endpoint.

Namun hati-hati:

- semua nilainya String;
- tidak ada schema bawaan;
- tidak ada validation bawaan;
- missing value sering baru ketahuan runtime;
- casing/name behavior bisa berbeda lintas OS;
- env bisa bocor ke process inspection/logging jika tidak hati-hati.

### 7.2 Pattern Aman Membaca Env

Jangan begini:

```java
int poolSize = Integer.parseInt(System.getenv("DB_POOL_SIZE"));
```

Karena:

- env bisa null;
- bisa bukan angka;
- bisa di luar range;
- error message miskin konteks.

Lebih baik:

```java
public final class EnvConfig {
    public static int requiredInt(String name, int min, int max) {
        String raw = System.getenv(name);
        if (raw == null || raw.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }

        int value;
        try {
            value = Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new IllegalStateException("Environment variable " + name + " must be an integer", e);
        }

        if (value < min || value > max) {
            throw new IllegalStateException(
                "Environment variable " + name + " must be between " + min + " and " + max
            );
        }
        return value;
    }
}
```

Usage:

```java
int poolSize = EnvConfig.requiredInt("DB_POOL_SIZE", 1, 200);
```

### 7.3 Env vs System Property

Rule of thumb:

| Use Case | Prefer |
|---|---|
| JVM tuning | JVM args / system property |
| application deployment config | env or config file |
| local override | system property often convenient |
| container config | env |
| test-specific override | explicit config object |
| runtime mutation | neither if avoidable; use dynamic config service |

---

## 8. Time APIs: `currentTimeMillis` vs `nanoTime`

`System` menyediakan dua API waktu paling penting:

```java
long nowMillis = System.currentTimeMillis();
long t = System.nanoTime();
```

Keduanya sering disalahgunakan.

### 8.1 `currentTimeMillis()`

`currentTimeMillis()` mengembalikan waktu saat ini dalam milidetik sejak Unix epoch menurut system clock.

Cocok untuk:

- timestamp kasar;
- logging timestamp bila framework tidak menangani;
- expiry berbasis wall-clock;
- menyimpan event time sederhana.

Tidak cocok untuk mengukur durasi karena wall-clock bisa berubah.

Contoh buruk:

```java
long start = System.currentTimeMillis();
runJob();
long duration = System.currentTimeMillis() - start;
```

Kenapa buruk?

- NTP bisa adjust clock;
- admin bisa mengubah jam;
- VM/container bisa mengalami time correction;
- clock bisa mundur;
- resolusi bisa terbatas.

### 8.2 `nanoTime()`

`nanoTime()` adalah monotonic time source untuk mengukur elapsed time.

Cocok untuk:

- timeout;
- duration measurement;
- benchmark sederhana;
- deadline internal;
- retry/backoff calculation.

Contoh:

```java
long start = System.nanoTime();
runJob();
long elapsedNanos = System.nanoTime() - start;
```

Konversi:

```java
long elapsedMillis = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(elapsedNanos);
```

### 8.3 `nanoTime()` Bukan Timestamp

Jangan lakukan:

```java
long timestamp = System.nanoTime(); // misleading
```

Nilai `nanoTime()` hanya bermakna relatif terhadap nilai `nanoTime()` lain dalam JVM yang sama.

Ia bukan epoch time.

### 8.4 Deadline Pattern yang Aman

Untuk timeout:

```java
long timeoutNanos = java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
long deadline = System.nanoTime() + timeoutNanos;

while (true) {
    long remaining = deadline - System.nanoTime();
    if (remaining <= 0) {
        throw new RuntimeException("Timed out");
    }

    if (tryWork()) {
        break;
    }
}
```

Namun hati-hati overflow jika membuat helper. Pattern subtraction biasanya lebih aman:

```java
long start = System.nanoTime();
long timeoutNanos = TimeUnit.SECONDS.toNanos(5);

while (System.nanoTime() - start < timeoutNanos) {
    if (tryWork()) {
        return;
    }
}
throw new RuntimeException("Timed out");
```

### 8.5 Untuk Business Time, Pakai `Clock`

Untuk logic bisnis, lebih baik pakai `java.time.Clock`:

```java
import java.time.Clock;
import java.time.Instant;

public final class TokenExpiryService {
    private final Clock clock;

    public TokenExpiryService(Clock clock) {
        this.clock = clock;
    }

    public boolean isExpired(Instant expiresAt) {
        return !Instant.now(clock).isBefore(expiresAt);
    }
}
```

Test:

```java
Clock fixed = Clock.fixed(Instant.parse("2026-06-17T00:00:00Z"), ZoneOffset.UTC);
```

Rule:

```text
Measure elapsed time     -> System.nanoTime()
Get wall-clock timestamp -> Instant.now(clock) or System.currentTimeMillis()
Business date/time logic -> java.time + injected Clock
```

---

## 9. `System.arraycopy`

API:

```java
System.arraycopy(Object src, int srcPos, Object dest, int destPos, int length);
```

Ini melakukan copy dari satu array ke array lain.

Contoh:

```java
int[] source = {1, 2, 3, 4, 5};
int[] target = new int[3];

System.arraycopy(source, 1, target, 0, 3);

// target = [2, 3, 4]
```

### 9.1 Kenapa Penting?

Walaupun jarang dipakai manual, `arraycopy` adalah primitive penting di balik banyak operasi:

- array resize;
- `ArrayList` growth;
- copy utilities;
- buffer movement;
- serialization internals;
- parser buffers;
- string/byte transformations;
- collections implementation.

### 9.2 Contract Penting

`arraycopy` melakukan runtime checks:

- `src` dan `dest` harus array;
- index harus valid;
- length tidak boleh negatif;
- tipe elemen harus compatible;
- bisa handle overlapping ranges.

Contoh overlapping:

```java
int[] values = {1, 2, 3, 4, 5};
System.arraycopy(values, 0, values, 1, 4);
// values = [1, 1, 2, 3, 4]
```

### 9.3 Primitive vs Reference Array

Primitive array:

```java
int[] a = {1, 2};
long[] b = new long[2];
System.arraycopy(a, 0, b, 0, 2); // ArrayStoreException, not numeric conversion
```

Reference array:

```java
String[] strings = {"a", "b"};
Object[] objects = new Object[2];
System.arraycopy(strings, 0, objects, 0, 2); // OK
```

Tapi:

```java
Object[] objects = {"a", 123};
String[] strings = new String[2];
System.arraycopy(objects, 0, strings, 0, 2); // ArrayStoreException
```

### 9.4 `arraycopy` vs `Arrays.copyOf`

Untuk application code, sering lebih jelas:

```java
int[] copy = Arrays.copyOf(original, original.length);
```

Gunakan `System.arraycopy` saat:

- implementasi data structure;
- performance-sensitive buffer logic;
- perlu copy subrange ke posisi tertentu;
- ingin menghindari alokasi baru.

---

## 10. `System.identityHashCode`

API:

```java
int idHash = System.identityHashCode(object);
```

Ini mengembalikan hash code seolah-olah method `hashCode()` default `Object` dipakai, terlepas apakah class override `hashCode()`.

Contoh:

```java
record User(String id) {}

User a = new User("u1");
User b = new User("u1");

System.out.println(a.hashCode() == b.hashCode()); // likely true, logical record hash
System.out.println(System.identityHashCode(a) == System.identityHashCode(b)); // generally false
```

Gunanya:

- debugging identity;
- implementing identity-based diagnostics;
- working with identity maps;
- detecting proxy/object instance behavior.

Jangan gunakan untuk:

- persistent ID;
- security token;
- stable cross-run identifier;
- business identity.

`identityHashCode` tidak menjamin unique. Ia hash, bukan object id.

---

## 11. `System.lineSeparator`

API:

```java
String sep = System.lineSeparator();
```

Ini mengembalikan line separator platform.

Contoh:

```java
String text = "line1" + System.lineSeparator() + "line2";
```

Namun dalam banyak protocol modern, line ending sudah ditentukan:

| Context | Line ending |
|---|---|
| HTTP | CRLF secara protokol |
| Unix text convention | LF |
| Windows text convention | CRLF |
| JSON string logical newline | `\n` escaped |
| Git-normalized source | often LF |

Rule:

- untuk file user-facing lokal, `lineSeparator()` bisa wajar;
- untuk protocol, gunakan separator yang ditentukan protocol;
- untuk generated code/config cross-platform, tentukan eksplisit sesuai target.

---

## 12. `System.Logger`

Sejak Java 9, `System` menyediakan platform logging API sederhana:

```java
System.Logger logger = System.getLogger("com.example.App");
logger.log(System.Logger.Level.INFO, "Application started");
```

Level:

```java
System.Logger.Level.TRACE
System.Logger.Level.DEBUG
System.Logger.Level.INFO
System.Logger.Level.WARNING
System.Logger.Level.ERROR
System.Logger.Level.OFF
System.Logger.Level.ALL
```

### 12.1 Apa Tujuannya?

`System.Logger` bukan pengganti penuh SLF4J/Logback/Log4j untuk aplikasi enterprise. Ia adalah API logging platform yang memungkinkan JDK dan library tertentu menulis log tanpa hard dependency ke framework logging tertentu.

Untuk aplikasi besar, biasanya tetap:

- SLF4J facade;
- Logback/Log4j2 backend;
- structured logging;
- MDC/correlation id;
- JSON logs;
- centralized logging.

### 12.2 Kapan Berguna?

`System.Logger` berguna untuk:

- library kecil tanpa external dependency;
- bootstrap code;
- JDK-integrated component;
- tools yang ingin menghindari logging framework besar.

Contoh:

```java
public final class SmallTool {
    private static final System.Logger LOG = System.getLogger(SmallTool.class.getName());

    public void run() {
        LOG.log(System.Logger.Level.INFO, "Running small tool");
    }
}
```

---

## 13. `System.exit`

API:

```java
System.exit(int status);
```

Ini memulai shutdown sequence JVM.

Convention umum:

```text
0     -> success
non-0 -> failure/error
```

### 13.1 Cocok untuk CLI Main Boundary

```java
public final class Main {
    public static void main(String[] args) {
        int exitCode = run(args);
        System.exit(exitCode);
    }
}
```

Lebih testable:

```java
static int run(String[] args) {
    if (args.length == 0) {
        return 2;
    }
    return 0;
}
```

Test bisa memanggil `run`, bukan `main`.

### 13.2 Bahaya di Server/Library

Jangan lakukan ini di library:

```java
public void connect() {
    if (failed) {
        System.exit(1);
    }
}
```

Karena library tidak berhak mematikan process host.

Di server:

- bisa membunuh aplikasi saat request biasa;
- bisa memotong graceful shutdown;
- bisa merusak transaction/in-flight work;
- bisa membuat orchestrator restart loop;
- bisa menyulitkan diagnosis.

Rule:

> `System.exit` hanya boleh berada di process boundary, biasanya `main`, CLI launcher, atau fatal bootstrap path yang benar-benar disengaja.

---

## 14. `System.gc` dan `runFinalization`

API:

```java
System.gc();
System.runFinalization();
```

Keduanya bersifat request/hint, bukan guarantee yang cocok untuk business logic.

### 14.1 `System.gc()`

`System.gc()` meminta JVM berupaya menjalankan garbage collector.

Jangan gunakan untuk:

- “membersihkan memory” setelah setiap request;
- memperbaiki memory leak;
- memaksa latency turun;
- business workflow.

Masalah:

- bisa menyebabkan pause;
- JVM bisa mengabaikan atau mengatur behavior tergantung flag;
- menyembunyikan memory management bug;
- tidak deterministic.

### 14.2 `runFinalization()`

Finalization sudah legacy dan deprecated for removal. Karena finalization sendiri bermasalah, API yang mendorong finalization juga tidak boleh menjadi desain modern.

Gunakan:

- `try-with-resources`;
- `AutoCloseable`;
- explicit lifecycle;
- `Cleaner` hanya sebagai safety net, bukan primary cleanup.

---

## 15. Native Library Loading: `load` dan `loadLibrary`

API:

```java
System.load("/absolute/path/to/libnative.so");
System.loadLibrary("native");
```

`loadLibrary("native")` akan mencari library sesuai mekanisme platform/JVM path.

Contoh mapping nama bisa menjadi:

```text
Linux   -> libnative.so
macOS   -> libnative.dylib
Windows -> native.dll
```

### 15.1 Risiko

Native library loading adalah operasi berisiko tinggi:

- crash JVM;
- memory corruption;
- ABI mismatch;
- platform-specific deployment;
- security risk;
- class loader interaction;
- sulit diobservasi;
- sulit ditest cross-platform.

Di Java modern, dokumentasi Java SE 25 menandai `System.load` sebagai restricted method. Restricted method adalah API yang unsafe bila digunakan keliru, misalnya dapat menyebabkan JVM crash atau memory corruption.

### 15.2 Design Guidance

Jika harus memakai native library:

1. isolate di adapter kecil;
2. validate OS/arch saat startup;
3. fail fast dengan error message jelas;
4. lakukan integration test di semua target platform;
5. jangan load dari path yang bisa dikontrol user;
6. dokumentasikan deployment contract;
7. siapkan fallback/degradation strategy jika memungkinkan.

---

## 16. Security Manager Legacy dan Java 17–25

Dulu, beberapa method `System` berinteraksi dengan Security Manager, misalnya akses property, env, exit, stream mutation, native library loading, dan permission checks.

Namun landscape berubah besar:

- Java 17 mendeprecate Security Manager for removal melalui JEP 411.
- Java 24 mempermanenkan disabling Security Manager melalui JEP 486.
- Di Java 25, banyak API terkait permission/security manager sudah deprecated for removal atau tidak lagi berfungsi sebagai mekanisme sandbox modern.

Implikasinya:

> Jangan mendesain isolasi keamanan aplikasi modern dengan asumsi Security Manager masih dapat menjadi sandbox.

Untuk security boundary modern, gunakan:

- OS/container isolation;
- process isolation;
- Kubernetes/container policy;
- seccomp/AppArmor/SELinux bila relevan;
- IAM/cloud permissions;
- network policy;
- classpath/module hygiene;
- input validation;
- explicit authorization;
- separate process untuk untrusted code.

---

## 17. `System.console`

API:

```java
Console console = System.console();
```

Bisa mengembalikan `null` jika JVM tidak memiliki console interaktif.

Contoh aman:

```java
Console console = System.console();
if (console == null) {
    throw new IllegalStateException("No interactive console available");
}

char[] password = console.readPassword("Password: ");
```

Cocok untuk CLI interaktif.

Tidak cocok untuk:

- web server;
- batch non-interactive;
- container job tanpa tty;
- library umum.

---

## 18. `System.inheritedChannel`

API:

```java
Channel channel = System.inheritedChannel();
```

Ini digunakan untuk kasus advanced ketika JVM mewarisi channel dari process pembuatnya, misalnya server socket/channel tertentu pada environment khusus.

Bagi kebanyakan aplikasi backend, API ini jarang dipakai langsung. Namun penting sebagai pengingat bahwa `System` bukan hanya helper; ia juga mencakup OS/process integration boundary.

---

## 19. Initialization Timing Trap

Kesalahan serius sering terjadi ketika system property/env dibaca saat static initialization.

Contoh:

```java
public final class AppMode {
    public static final String MODE = System.getenv().getOrDefault("APP_MODE", "dev");
}
```

Masalah:

- dibaca saat class pertama kali di-load;
- perubahan test setup setelah itu tidak berpengaruh;
- urutan class loading menjadi behavior;
- sulit override;
- sulit reason di application server/plugin.

Lebih baik:

```java
public record AppConfig(String mode) {
    public static AppConfig fromEnvironment(Map<String, String> env) {
        return new AppConfig(env.getOrDefault("APP_MODE", "dev"));
    }
}
```

Bootstrap:

```java
AppConfig config = AppConfig.fromEnvironment(System.getenv());
```

Test:

```java
AppConfig config = AppConfig.fromEnvironment(Map.of("APP_MODE", "test"));
```

---

## 20. `System` dan Testability

Akses langsung ke `System` membuat testing sulit karena:

- global state;
- clock non-deterministic;
- env sulit dimodifikasi;
- properties shared antar test;
- stdout/stderr shared;
- `exit` membunuh test JVM;
- `gc` tidak deterministic.

### 20.1 Abstraction Pattern

Buat boundary:

```java
public interface RuntimeEnvironment {
    String property(String name);
    String env(String name);
    long nanoTime();
    long currentTimeMillis();
}
```

Production:

```java
public final class SystemRuntimeEnvironment implements RuntimeEnvironment {
    @Override
    public String property(String name) {
        return System.getProperty(name);
    }

    @Override
    public String env(String name) {
        return System.getenv(name);
    }

    @Override
    public long nanoTime() {
        return System.nanoTime();
    }

    @Override
    public long currentTimeMillis() {
        return System.currentTimeMillis();
    }
}
```

Test:

```java
public final class FakeRuntimeEnvironment implements RuntimeEnvironment {
    private final Map<String, String> props;
    private final Map<String, String> env;
    private long nanoTime;
    private long currentTimeMillis;

    public FakeRuntimeEnvironment(Map<String, String> props, Map<String, String> env) {
        this.props = props;
        this.env = env;
    }

    @Override
    public String property(String name) {
        return props.get(name);
    }

    @Override
    public String env(String name) {
        return env.get(name);
    }

    @Override
    public long nanoTime() {
        return nanoTime;
    }

    @Override
    public long currentTimeMillis() {
        return currentTimeMillis;
    }

    public void setNanoTime(long nanoTime) {
        this.nanoTime = nanoTime;
    }

    public void setCurrentTimeMillis(long currentTimeMillis) {
        this.currentTimeMillis = currentTimeMillis;
    }
}
```

Namun jangan over-engineer. Untuk banyak aplikasi, cukup:

- parse config saat bootstrap;
- inject config object;
- inject `Clock` untuk business time;
- jangan call `System.exit` selain di main.

---

## 21. Production Design: Configuration Boundary

Salah satu desain yang baik:

```text
System.getenv/System.getProperty
        |
        v
Bootstrap Config Loader
        |
        v
Validated Immutable Config Object
        |
        v
Application Services
```

Contoh:

```java
public record DatabaseConfig(
    String host,
    int port,
    String database,
    int maxPoolSize
) {
    public DatabaseConfig {
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("host is required");
        }
        if (port <= 0 || port > 65535) {
            throw new IllegalArgumentException("port out of range");
        }
        if (maxPoolSize <= 0 || maxPoolSize > 200) {
            throw new IllegalArgumentException("maxPoolSize out of range");
        }
    }
}
```

Loader:

```java
public final class DatabaseConfigLoader {
    public static DatabaseConfig load(Map<String, String> env, Properties props) {
        String host = firstNonBlank(
            props.getProperty("db.host"),
            env.get("DB_HOST"),
            "localhost"
        );

        int port = parseInt(firstNonBlank(
            props.getProperty("db.port"),
            env.get("DB_PORT"),
            "5432"
        ), "db.port/DB_PORT");

        String database = firstNonBlank(
            props.getProperty("db.name"),
            env.get("DB_NAME"),
            "app"
        );

        int maxPoolSize = parseInt(firstNonBlank(
            props.getProperty("db.maxPoolSize"),
            env.get("DB_MAX_POOL_SIZE"),
            "20"
        ), "db.maxPoolSize/DB_MAX_POOL_SIZE");

        return new DatabaseConfig(host, port, database, maxPoolSize);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static int parseInt(String raw, String name) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new IllegalStateException("Invalid integer config: " + name, e);
        }
    }
}
```

Bootstrap:

```java
DatabaseConfig config = DatabaseConfigLoader.load(System.getenv(), System.getProperties());
```

Keuntungan:

- access `System` terkonsentrasi;
- validation explicit;
- precedence jelas;
- mudah test;
- error message lebih baik;
- domain service tidak tahu global environment.

---

## 22. Common Failure Modes

### 22.1 Menggunakan `currentTimeMillis` untuk Durasi

Buruk:

```java
long start = System.currentTimeMillis();
operation();
long elapsed = System.currentTimeMillis() - start;
```

Lebih tepat:

```java
long start = System.nanoTime();
operation();
long elapsed = System.nanoTime() - start;
```

### 22.2 Menyebarkan `System.getenv` ke Domain Logic

Buruk:

```java
if ("prod".equals(System.getenv("APP_ENV"))) {
    enforceStrictMode();
}
```

Lebih baik:

```java
if (config.environment().isProduction()) {
    enforceStrictMode();
}
```

### 22.3 Mutasi System Property di Test Tanpa Restore

Buruk:

```java
System.setProperty("mode", "test");
// no cleanup
```

Lebih baik:

```java
String old = System.getProperty("mode");
try {
    System.setProperty("mode", "test");
    // test
} finally {
    if (old == null) {
        System.clearProperty("mode");
    } else {
        System.setProperty("mode", old);
    }
}
```

### 22.4 `System.exit` dari Library

Buruk:

```java
public final class ParserLibrary {
    public void parse(Path path) {
        if (!Files.exists(path)) {
            System.exit(2);
        }
    }
}
```

Lebih baik:

```java
throw new IllegalArgumentException("Input file does not exist: " + path);
```

Main boundary yang menentukan exit code.

### 22.5 Logging dengan `System.out` di Production

Buruk:

```java
System.out.println("User " + userId + " failed login with password " + password);
```

Masalah:

- membocorkan secret;
- tidak structured;
- tidak punya level;
- tidak redacted;
- tidak ada correlation id.

### 22.6 Menganggap `identityHashCode` sebagai ID Unik

Buruk:

```java
String requestId = String.valueOf(System.identityHashCode(request));
```

Lebih baik:

```java
String requestId = UUID.randomUUID().toString();
```

### 22.7 `System.gc()` sebagai Memory Fix

Buruk:

```java
cache.clear();
System.gc();
```

Lebih baik:

- ukur heap;
- cari retention path;
- batasi cache;
- gunakan eviction;
- profiling;
- perbaiki ownership object.

---

## 23. Java 8 hingga Java 25: Evolusi yang Relevan

### Java 8 Baseline

Di Java 8, `System` sudah menyediakan:

- standard streams;
- properties;
- env;
- time methods;
- arraycopy;
- identityHashCode;
- gc/exit;
- native loading.

Banyak legacy behavior masih dikaitkan dengan Security Manager.

### Java 9

Java 9 membawa module system. `System` tetap di `java.base`.

Perubahan relevan:

- `System.Logger` diperkenalkan;
- `System.getLogger` tersedia;
- module boundary mulai penting;
- runtime image modular memengaruhi cara membaca resources/runtime info secara umum.

### Java 17

Security Manager deprecated for removal melalui JEP 411. Ini penting karena banyak API lama `System` punya historical security checks.

### Java 24

Security Manager permanently disabled melalui JEP 486.

### Java 25

Di Java 25, `System` tetap menjadi global runtime gateway, tetapi beberapa API/konsep legacy makin jelas statusnya:

- Security Manager tidak lagi menjadi sandbox strategy;
- permission-related API banyak deprecated for removal;
- native access/restricted methods perlu dilihat sebagai boundary berisiko;
- modern Java design lebih menekankan explicit configuration, module boundary, process/container isolation, dan observability.

---

## 24. API Decision Table

| Need | Recommended API/Pattern | Avoid |
|---|---|---|
| Print CLI result | `System.out` | logging framework for pure CLI output |
| Print diagnostic CLI error | `System.err` | mixing with stdout |
| Production app logging | logging framework / structured logger | raw `System.out.println` |
| Read deployment config | bootstrap loader using env/properties | scattered `System.getenv` |
| Business current time | `Clock` + `Instant.now(clock)` | direct `currentTimeMillis` everywhere |
| Measure elapsed duration | `System.nanoTime` | `currentTimeMillis` |
| Copy array range | `System.arraycopy` / `Arrays.copyOfRange` | manual loops unless needed |
| Object identity diagnostic | `System.identityHashCode` | business ID |
| Terminate CLI | `System.exit` in `main` boundary | `System.exit` inside library/service |
| Force cleanup | `AutoCloseable`, lifecycle management | `System.gc`, finalization |
| Load native library | small isolated adapter | arbitrary user-controlled path |

---

## 25. Production Checklist

Sebelum memakai `System` di production code, tanyakan:

1. Apakah ini benar-benar boundary layer?
2. Apakah akses global ini membuat testing sulit?
3. Apakah nilainya bisa berubah antar environment?
4. Apakah perlu validation?
5. Apakah perlu abstraction?
6. Apakah ini akan aman di container?
7. Apakah ini aman di test paralel?
8. Apakah ini bisa membocorkan secret?
9. Apakah ini menimbulkan global side effect?
10. Apakah ini kompatibel Java 8–25?
11. Apakah ada perubahan Security Manager legacy yang relevan?
12. Apakah method ini deterministic?
13. Apakah ini timestamp atau elapsed time?
14. Apakah caller berhak mematikan JVM?
15. Apakah output harus structured dan auditable?

---

## 26. Latihan / Thought Exercise

### Exercise 1 — Config Boundary

Ambil service yang membaca env/property langsung di banyak tempat. Refactor menjadi:

```text
System.getenv/System.getProperty
        -> ConfigLoader
        -> Immutable Config Object
        -> Services
```

Evaluasi:

- error message saat config invalid;
- testability;
- precedence env vs property;
- documentation.

### Exercise 2 — Time Correctness

Cari semua penggunaan:

```java
System.currentTimeMillis()
```

Klasifikasikan:

- timestamp;
- duration;
- expiry;
- logging;
- business date.

Refactor:

- duration ke `nanoTime`;
- business date ke `Clock`;
- timestamp ke `Instant` bila butuh semantic clarity.

### Exercise 3 — Exit Code Boundary

Buat CLI dengan desain:

```java
public static void main(String[] args) {
    System.exit(run(args));
}

static int run(String[] args) {
    // testable
}
```

Pastikan library/service tidak pernah memanggil `System.exit`.

### Exercise 4 — Stdout vs Logger

Ambil aplikasi kecil yang memakai `System.out.println` untuk diagnostic. Pisahkan:

- output program;
- diagnostic log;
- error output;
- audit event.

Tentukan mana yang tetap stdout dan mana yang masuk logger.

---

## 27. Ringkasan

`System` adalah class kecil dengan dampak besar. Ia menghubungkan Java code dengan process-level reality: stream, property, environment, clock, shutdown, native loading, dan operasi low-level seperti array copy.

Pemahaman advance bukan berarti selalu membungkus semua method `System`. Pemahaman advance berarti tahu **di mana boundary global layak disentuh**, dan tahu kapan akses tersebut harus diubah menjadi dependency eksplisit.

Prinsip akhir:

```text
Use System at the edge.
Pass explicit dependencies inward.
Keep time, config, output, and shutdown behavior testable.
Never confuse global convenience with good design.
```

---

## 28. Apa yang Tidak Dibahas Panjang di Part Ini

Agar tidak mengulang seri sebelumnya:

- GC detail tidak dibahas; hanya posisi `System.gc` sebagai hint.
- Concurrency detail tidak dibahas; hanya dampak global state/test.
- Security detail tidak dibahas; hanya Security Manager legacy dan boundary modern.
- Logging framework detail tidak dibahas; hanya posisi `System.Logger` dan `System.out/err`.
- Process management detail akan dibahas di Part 14.

---

## 29. Status Seri

Part ini adalah **Part 13 dari 32**.

Seri **belum selesai**.

Part berikutnya:

**Part 14 — `Runtime`, `Process`, `ProcessBuilder`, `ProcessHandle`: OS Boundary**

File berikutnya:

```text
14-runtime-process-processbuilder-processhandle-os-boundary.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 12 — `Exception`, `RuntimeException`, `Error`: Failure Taxonomy for Serious Systems](./12-exception-runtimeexception-error-failure-taxonomy.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — `Runtime`, `Process`, `ProcessBuilder`, `ProcessHandle`: OS Boundary](./14-runtime-process-processbuilder-processhandle-os-boundary.md)

</div>