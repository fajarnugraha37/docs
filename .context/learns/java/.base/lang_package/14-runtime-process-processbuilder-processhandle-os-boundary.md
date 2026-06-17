# Part 14 — `Runtime`, `Process`, `ProcessBuilder`, `ProcessHandle`: OS Boundary

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `14-runtime-process-processbuilder-processhandle-os-boundary.md`  
> Scope: Java 8–25  
> Main packages/classes: `java.lang.Runtime`, `java.lang.Process`, `java.lang.ProcessBuilder`, `java.lang.ProcessHandle`, `java.lang.ProcessHandle.Info`

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah melihat `System` sebagai gerbang global JVM: standard streams, properties, environment, clock, `arraycopy`, dan logger. Sekarang kita naik satu level ke boundary yang lebih berbahaya: **JVM sebagai proses operating system** dan **Java application yang membuat/mengelola proses native lain**.

Target part ini adalah membuat kamu mampu memahami dan mendesain penggunaan:

- `Runtime` sebagai representasi runtime environment JVM;
- `ProcessBuilder` sebagai API utama untuk membuat proses OS;
- `Process` sebagai handle untuk proses yang dibuat oleh Java;
- `ProcessHandle` sebagai handle umum untuk native process, termasuk proses Java sendiri dan child/descendant-nya;
- shutdown hook dan lifecycle JVM;
- command execution yang aman;
- stream handling agar tidak deadlock;
- timeout, cancellation, cleanup, dan observability;
- perbedaan API Java 8 dengan Java 9+ sampai Java 25.

Part ini penting karena banyak sistem enterprise/regulatory tampak “murni Java”, tetapi tetap menyentuh OS boundary untuk:

- menjalankan CLI tools;
- memanggil scanner, PDF renderer, image converter, anti-virus, report generator;
- menjalankan migration/backup script;
- mengeksekusi shell command di maintenance tool;
- membaca process information;
- membuat graceful shutdown hook;
- mengukur CPU/memory yang tersedia;
- mengelola child process pada worker service.

Di boundary ini, error kecil dapat berubah menjadi incident:

- command injection;
- process hang karena stdout/stderr tidak dibaca;
- zombie/orphan process;
- memory exhaustion karena output ditampung tanpa limit;
- timeout tidak membunuh process tree;
- secret bocor lewat argument list;
- shutdown hook deadlock;
- salah membaca CPU container;
- test flakiness karena bergantung pada OS.

---

## 2. Mental Model Utama

### 2.1 JVM adalah proses OS, bukan dunia terpisah

Aplikasi Java berjalan sebagai satu proses native, misalnya:

```text
Operating System
└── java process / JVM
    ├── Java heap
    ├── JVM native memory
    ├── Java threads mapped/scheduled by OS/runtime
    ├── loaded classes/modules
    ├── open file descriptors/sockets
    └── optional child native processes
```

`Runtime` merepresentasikan akses terbatas ke runtime JVM itu:

```java
Runtime runtime = Runtime.getRuntime();
```

Dari sana kamu dapat bertanya:

- berapa processor yang tersedia menurut JVM;
- berapa memory heap yang sedang dialokasikan/dapat digunakan;
- mendaftarkan shutdown hook;
- memicu GC hint;
- membuat native process via legacy `exec` API.

Namun `Runtime` bukan “control panel OS penuh”. Banyak metriknya adalah **JVM-scoped**, bukan full host-scoped.

---

### 2.2 Native process adalah boundary yang tidak type-safe

Saat Java memanggil proses OS, kamu keluar dari dunia type-safe Java:

```text
Java method call
  -> type checked
  -> exception model Java
  -> memory managed by JVM

Native process execution
  -> string/list command
  -> OS-specific semantics
  -> environment variables
  -> working directory
  -> stdin/stdout/stderr pipes
  -> exit code convention
  -> signal/kill semantics
  -> platform quoting differences
```

Di Java, pemanggilan method gagal dengan exception. Di OS, program bisa:

- exit code `0` tetapi output error di stderr;
- exit code non-zero tetapi masih menghasilkan partial output;
- hang tanpa exit;
- menulis output terlalu besar;
- menunggu stdin;
- spawn child process lain;
- ignore termination signal;
- behave berbeda di Linux/Windows/macOS/container.

Jadi mental model yang benar:

> Menjalankan proses OS bukan seperti memanggil function. Ia lebih mirip membuat actor eksternal dengan lifecycle, I/O channel, environment, dan failure semantics sendiri.

---

### 2.3 `Runtime.exec` adalah legacy convenience, `ProcessBuilder` adalah desain utama

`Runtime` punya keluarga method `exec(...)`. Namun untuk desain modern, gunakan `ProcessBuilder` karena lebih eksplisit:

```java
ProcessBuilder pb = new ProcessBuilder("git", "--version");
Process process = pb.start();
```

Kenapa `ProcessBuilder` lebih baik?

- command dan argument dipisahkan sebagai list;
- environment dapat diatur secara eksplisit;
- working directory dapat ditentukan;
- redirect stdin/stdout/stderr lebih jelas;
- builder dapat dikonfigurasi sebelum start;
- Java 9+ punya `startPipeline`;
- lebih mudah diuji dan dibungkus dalam abstraction internal.

`Runtime.exec(String command)` sangat rawan salah karena developer sering mengira string tersebut diproses seperti shell command. Padahal perilaku tokenisasi/quoting-nya tidak identik dengan shell dan platform-specific.

---

### 2.4 Ada tiga level process abstraction

```text
Runtime
  = JVM runtime facade.

ProcessBuilder
  = konfigurasi untuk membuat proses baru.

Process
  = handle ke proses yang dibuat oleh Java.

ProcessHandle
  = handle umum ke native process, termasuk current process,
    child process, descendant process, dan process lain yang dapat diobservasi.
```

Contoh:

```java
ProcessBuilder builder = new ProcessBuilder("java", "--version");
Process process = builder.start();
ProcessHandle handle = process.toHandle();
```

`Process` menjawab: “subprocess yang saya start ini bagaimana I/O dan exit-nya?”

`ProcessHandle` menjawab: “native process ini hidup atau tidak, PID-nya berapa, parent/children-nya siapa, info-nya apa?”

---

## 3. Konsep Fundamental

### 3.1 Exit code adalah protocol, bukan exception

Native command biasanya mengembalikan integer exit code:

```text
0       usually success
non-0   usually failure
```

Tetapi artinya bergantung program. Contoh:

- `grep` exit `1` bisa berarti “no match”, bukan sistem error;
- command tertentu memakai exit code berbeda untuk warning;
- CLI internal organisasi bisa punya convention sendiri.

Jangan hardcode “non-zero selalu fatal” tanpa memahami command contract.

Desain wrapper yang baik harus punya policy:

```java
boolean isSuccess(int exitCode) {
    return exitCode == 0;
}
```

Atau untuk command tertentu:

```java
boolean isAcceptableGrepExit(int exitCode) {
    return exitCode == 0 || exitCode == 1;
}
```

---

### 3.2 Process I/O adalah pipe yang bisa penuh

Setiap process punya:

```text
stdin   input ke proses
stdout  output normal dari proses
stderr  output error/diagnostic dari proses
```

Jika Java membuat subprocess dengan pipe default, lalu subprocess menulis banyak data ke stdout/stderr tetapi parent Java tidak membaca, buffer OS dapat penuh. Saat penuh, subprocess blocked menunggu pipe dibaca. Parent mungkin sedang `waitFor()`. Hasilnya deadlock/hang.

Anti-pattern:

```java
Process p = new ProcessBuilder("some-command").start();
int exit = p.waitFor(); // bisa hang jika stdout/stderr penuh
String output = new String(p.getInputStream().readAllBytes());
```

Pattern yang lebih aman:

- redirect output ke file;
- inherit IO;
- baca stdout dan stderr secara concurrent;
- gabungkan stderr ke stdout jika sesuai;
- batasi ukuran output;
- gunakan timeout.

---

### 3.3 Shell dan process execution bukan hal yang sama

Ini menjalankan program langsung:

```java
new ProcessBuilder("ls", "-la", "/tmp").start();
```

Ini menjalankan shell, lalu shell memproses command string:

```java
new ProcessBuilder("sh", "-c", "ls -la /tmp").start();
```

Perbedaannya besar.

Tanpa shell:

- tidak ada wildcard expansion oleh shell;
- tidak ada pipe `|`;
- tidak ada redirection `>`;
- tidak ada variable expansion `$HOME`;
- argument boundaries lebih aman.

Dengan shell:

- lebih fleksibel;
- lebih rawan command injection;
- quoting lebih sulit;
- behavior berbeda antar shell/OS;
- user input menjadi jauh lebih berbahaya.

Rule production:

> Jangan gunakan shell (`sh -c`, `cmd /c`, `powershell -Command`) kecuali memang butuh fitur shell. Kalau hanya menjalankan program dengan argument, gunakan list command `ProcessBuilder`.

---

### 3.4 Process tree berbeda dari satu process

Saat kamu start satu process:

```java
Process p = new ProcessBuilder("some-script.sh").start();
```

Script itu bisa spawn child process:

```text
Java process
└── shell script process
    ├── worker A
    ├── worker B
    └── long-running child C
```

Ketika kamu panggil:

```java
p.destroy();
```

Belum tentu semua descendant ikut mati. Di Java 9+, `ProcessHandle.descendants()` membantu melihat process tree, tapi termination tree tetap harus dirancang hati-hati.

---

### 3.5 Shutdown hook adalah last-chance cleanup, bukan workflow engine

Shutdown hook berjalan saat JVM shutdown sequence dimulai, misalnya karena:

- semua non-daemon thread selesai;
- `System.exit(...)` dipanggil;
- SIGTERM di environment tertentu;
- normal controlled shutdown.

Tetapi shutdown hook bukan tempat untuk logic berat.

Jangan gunakan shutdown hook untuk:

- transaksi bisnis penting;
- long blocking network call tanpa timeout;
- menunggu thread yang juga menunggu shutdown hook;
- memulai service baru;
- cleanup yang harus pasti berhasil.

Gunakan shutdown hook sebagai:

- sinyal graceful stop;
- flush best-effort;
- close resource;
- stop child process;
- release lock/file handle;
- emit final diagnostic.

---

## 4. API dan Contract yang Perlu Dipahami

## 4.1 `Runtime`

### 4.1.1 Mendapatkan runtime

```java
Runtime rt = Runtime.getRuntime();
```

Biasanya hanya ada satu `Runtime` instance associated dengan current Java application.

---

### 4.1.2 Processor availability

```java
int processors = Runtime.getRuntime().availableProcessors();
```

Maknanya: jumlah processor yang tersedia untuk JVM menurut runtime. Ini tidak selalu sama dengan jumlah physical CPU host.

Di container/Kubernetes, angka ini dapat dipengaruhi oleh:

- CPU limit;
- cgroup configuration;
- JVM container awareness;
- runtime version;
- OS/JVM implementation.

Hal penting: nilai ini dapat berubah selama JVM berjalan. Jadi aplikasi sensitif CPU sebaiknya tidak selalu menganggap nilainya immutable.

Use cases:

- menentukan default worker pool size;
- parallelism heuristic;
- adaptive batching;
- runtime diagnostics.

Anti-pattern:

```java
static final int THREADS = Runtime.getRuntime().availableProcessors() * 100;
```

Lebih baik:

- gunakan bounded config;
- jadikan default, bukan hard rule;
- expose via configuration;
- ukur workload I/O-bound vs CPU-bound.

---

### 4.1.3 Heap memory observations

```java
Runtime rt = Runtime.getRuntime();
long free = rt.freeMemory();
long total = rt.totalMemory();
long max = rt.maxMemory();
```

Makna kasar:

- `totalMemory()` = heap memory yang saat ini dialokasikan untuk JVM;
- `freeMemory()` = bagian dari allocated heap yang belum dipakai;
- `maxMemory()` = maksimum heap yang JVM akan coba gunakan.

Jangan membaca ini sebagai full process memory.

Tidak termasuk secara utuh:

- metaspace;
- thread stacks;
- direct buffers;
- code cache;
- native libraries;
- mmap region;
- OS page cache;
- child process memory.

Untuk production memory analysis, gunakan tool lebih tepat:

- JFR;
- jcmd;
- Native Memory Tracking;
- GC logs;
- container metrics;
- OS process metrics.

`Runtime` memory methods berguna untuk lightweight diagnostics, bukan root cause analysis penuh.

---

### 4.1.4 GC hint

```java
Runtime.getRuntime().gc();
// sama secara intensi dengan System.gc()
```

Ini hint, bukan guarantee. Di server production, memanggil GC manual biasanya buruk kecuali ada alasan sangat spesifik.

Anti-pattern:

```java
public void afterEveryRequest() {
    System.gc();
}
```

Kenapa buruk:

- bisa memicu pause;
- merusak heuristik GC;
- menyembunyikan memory leak;
- membuat latency tidak stabil.

---

### 4.1.5 Shutdown hooks

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("Shutting down...");
}));
```

Contract penting:

- hook adalah initialized but unstarted `Thread`;
- JVM akan start registered hooks saat shutdown sequence;
- urutan antar hook tidak boleh diasumsikan;
- hook dapat berjalan concurrently;
- hook harus thread-safe;
- hook harus cepat;
- hook harus resilient terhadap partial runtime shutdown.

Contoh lebih production-oriented:

```java
public final class GracefulShutdown {
    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final ExecutorService workers;

    public GracefulShutdown(ExecutorService workers) {
        this.workers = workers;
    }

    public void register() {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            if (!stopping.compareAndSet(false, true)) {
                return;
            }
            workers.shutdown();
            try {
                if (!workers.awaitTermination(20, TimeUnit.SECONDS)) {
                    workers.shutdownNow();
                }
            } catch (InterruptedException e) {
                workers.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }, "app-shutdown-hook"));
    }
}
```

Important nuance:

- hook tidak guaranteed berjalan saat `Runtime.halt`, SIGKILL, OS crash, container hard kill setelah grace period habis;
- hook bisa dihentikan paksa jika orchestrator membunuh process;
- hook bukan substitute untuk idempotent recovery design.

---

### 4.1.6 `exit` vs `halt`

```java
System.exit(0);
Runtime.getRuntime().halt(1);
```

`System.exit` memulai orderly shutdown sequence, termasuk shutdown hooks.

`Runtime.halt` menghentikan JVM secara paksa tanpa menjalankan shutdown hooks secara normal.

Use `halt` sangat jarang, misalnya:

- JVM/runtime state sudah corrupt;
- fail-fast fatal launcher;
- after timeout saat graceful shutdown gagal total.

Di application code biasa, hindari `System.exit` dan `halt`. Biarkan framework/container mengelola lifecycle.

---

## 4.2 `ProcessBuilder`

### 4.2.1 Basic usage

```java
ProcessBuilder pb = new ProcessBuilder("java", "--version");
Process p = pb.start();
int exit = p.waitFor();
```

`ProcessBuilder` menyimpan process attributes:

- command;
- environment;
- working directory;
- stdin/stdout/stderr redirect;
- `redirectErrorStream` flag.

`start()` membuat process baru berdasarkan attributes tersebut.

---

### 4.2.2 Command list vs single string

Recommended:

```java
new ProcessBuilder("git", "log", "--oneline", "-n", "5");
```

Avoid:

```java
new ProcessBuilder("git log --oneline -n 5");
```

Yang kedua mencoba mencari executable literal bernama `git log --oneline -n 5`, bukan shell parsing.

Kalau butuh shell:

```java
new ProcessBuilder("sh", "-c", "git log --oneline -n 5 | head");
```

Tapi shell mode harus dianggap elevated risk.

---

### 4.2.3 Working directory

```java
ProcessBuilder pb = new ProcessBuilder("git", "status", "--short");
pb.directory(new File("/repo/service-a"));
```

Risiko:

- directory tidak ada;
- permission denied;
- relative path bergantung process working dir Java;
- symlink traversal;
- user-controlled path.

Production rule:

- resolve path ke canonical/normalized path;
- validate berada di allowed base directory;
- jangan pakai user input raw sebagai working directory.

---

### 4.2.4 Environment

```java
ProcessBuilder pb = new ProcessBuilder("my-tool");
Map<String, String> env = pb.environment();
env.put("APP_MODE", "batch");
env.remove("SECRET_DEBUG_FLAG");
```

Environment child process default-nya copy dari current process, lalu bisa dimodifikasi.

Risiko:

- secret environment diwariskan tanpa sadar;
- `PATH` dimanipulasi;
- locale/timezone berbeda;
- config ambiguity antara env dan argument;
- child process behavior non-deterministic.

Pattern aman:

```java
ProcessBuilder pb = new ProcessBuilder("/usr/local/bin/safe-tool", "--input", input.toString());
Map<String, String> env = pb.environment();
env.clear();
env.put("PATH", "/usr/bin:/bin");
env.put("LANG", "C.UTF-8");
env.put("TZ", "UTC");
```

Caveat: `env.clear()` bisa membuat beberapa program gagal karena membutuhkan variable tertentu. Jadi ini harus diuji per command.

---

### 4.2.5 Redirect stdin/stdout/stderr

Contoh redirect output ke file:

```java
ProcessBuilder pb = new ProcessBuilder("my-tool", "--export");
pb.redirectOutput(new File("export.out"));
pb.redirectError(new File("export.err"));
Process p = pb.start();
```

Gabungkan stderr ke stdout:

```java
ProcessBuilder pb = new ProcessBuilder("java", "--version");
pb.redirectErrorStream(true);
Process p = pb.start();
```

Inherit IO:

```java
ProcessBuilder pb = new ProcessBuilder("my-interactive-tool");
pb.inheritIO();
Process p = pb.start();
```

`inheritIO()` berguna untuk CLI tools yang memang ingin output langsung ke terminal. Untuk service backend, biasanya lebih baik capture/redirect dengan limit.

---

### 4.2.6 `startPipeline` Java 9+

Java 9 menambahkan support untuk pipeline process:

```java
List<ProcessBuilder> pipeline = List.of(
    new ProcessBuilder("printf", "hello\nworld\n"),
    new ProcessBuilder("grep", "hello")
);

List<Process> processes = ProcessBuilder.startPipeline(pipeline);
```

Ini menghubungkan stdout process sebelumnya ke stdin process berikutnya.

Kapan berguna:

- CLI tool integration;
- text processing pipeline;
- migration utility;
- admin tool.

Risiko tetap sama:

- timeout harus mengelola semua process;
- stderr tiap process tetap perlu ditangani;
- exit code semua stage harus diperiksa;
- process tree bisa tetap ada.

---

## 4.3 `Process`

### 4.3.1 I/O streams

Dari sisi Java parent:

```java
Process p = pb.start();

InputStream stdout = p.getInputStream();
InputStream stderr = p.getErrorStream();
OutputStream stdin = p.getOutputStream();
```

Nama method bisa membingungkan:

- `getInputStream()` = Java membaca output subprocess;
- `getErrorStream()` = Java membaca stderr subprocess;
- `getOutputStream()` = Java menulis ke stdin subprocess.

Mnemonic:

> Nama stream dilihat dari perspektif Java process, bukan subprocess.

---

### 4.3.2 Wait and exit

```java
int exit = p.waitFor();
```

Dengan timeout:

```java
boolean finished = p.waitFor(10, TimeUnit.SECONDS);
if (!finished) {
    p.destroy();
}
```

Setelah process selesai:

```java
int exit = p.exitValue();
```

`exitValue()` melempar `IllegalThreadStateException` jika process belum selesai.

---

### 4.3.3 Destroy vs destroyForcibly

```java
p.destroy();          // request termination
p.destroyForcibly();  // forceful termination attempt
```

`destroy()` biasanya graceful-ish, tetapi semantics OS-specific. Di Unix-like system umumnya mirip SIGTERM. `destroyForcibly()` lebih keras, tetapi tetap tidak berarti seluruh process tree pasti mati.

Pattern:

```java
if (!p.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
    p.destroy();
    if (!p.waitFor(5, TimeUnit.SECONDS)) {
        p.destroyForcibly();
    }
}
```

---

### 4.3.4 `onExit` Java 9+

```java
CompletableFuture<Process> future = p.onExit();
future.thenAccept(done -> {
    System.out.println("Exit: " + done.exitValue());
});
```

Ini membantu async coordination, tetapi tidak otomatis menyelesaikan masalah I/O. Kamu tetap perlu membaca stdout/stderr atau redirect.

---

### 4.3.5 `toHandle` Java 9+

```java
ProcessHandle handle = p.toHandle();
long pid = handle.pid();
```

Berguna untuk:

- logging PID;
- melihat descendants;
- termination tree;
- diagnostic process info.

---

## 4.4 `ProcessHandle`

`ProcessHandle` hadir sejak Java 9 sebagai API modern untuk native process observability/control.

### 4.4.1 Current process

```java
ProcessHandle current = ProcessHandle.current();
long pid = current.pid();
```

Use cases:

- diagnostic startup log;
- writing PID file;
- correlating OS metrics;
- container debugging.

---

### 4.4.2 Parent, children, descendants

```java
ProcessHandle h = ProcessHandle.current();
Optional<ProcessHandle> parent = h.parent();
Stream<ProcessHandle> children = h.children();
Stream<ProcessHandle> descendants = h.descendants();
```

`children()` dan `descendants()` biasanya snapshot-ish stream pada saat dipanggil. Jangan menganggap process tree stabil.

---

### 4.4.3 Process info

```java
ProcessHandle.Info info = handle.info();

Optional<String> command = info.command();
Optional<String[]> arguments = info.arguments();
Optional<Instant> start = info.startInstant();
Optional<Duration> cpu = info.totalCpuDuration();
Optional<String> user = info.user();
```

Semua field optional karena OS/JVM/security/platform bisa tidak menyediakan informasi.

Jangan tulis code seperti:

```java
String cmd = handle.info().command().get(); // rawan NoSuchElementException
```

Lebih baik:

```java
String cmd = handle.info().command().orElse("<unknown>");
```

Security note: argument process bisa mengandung secret. Jangan log command arguments secara bebas.

---

### 4.4.4 Liveness and termination

```java
boolean alive = handle.isAlive();
CompletableFuture<ProcessHandle> exited = handle.onExit();
```

Termination:

```java
boolean requested = handle.destroy();
boolean forced = handle.destroyForcibly();
```

Return boolean tidak berarti business operation berhasil. Itu hanya indikasi request termination diterima/berhasil menurut API.

---

## 5. Evolusi Java 8–25

## 5.1 Java 8 baseline

Di Java 8:

- `Runtime` sudah ada;
- `ProcessBuilder` sudah ada;
- `Process` sudah ada;
- belum ada `ProcessHandle`;
- belum ada `Process.onExit()`;
- belum ada `ProcessBuilder.startPipeline()`;
- process management lebih terbatas;
- PID access sering memakai non-portable hack atau native library.

Java 8 style:

```java
Process p = new ProcessBuilder("java", "-version").start();
boolean finished = p.waitFor(10, TimeUnit.SECONDS);
```

Sudah ada timeout `waitFor(long, TimeUnit)` di Java 8.

---

## 5.2 Java 9: major process API improvement

Java 9 memperkenalkan:

- `ProcessHandle`;
- `ProcessHandle.Info`;
- `Process.toHandle()`;
- `Process.pid()`;
- `Process.onExit()`;
- `Process.children()`;
- `Process.descendants()`;
- `ProcessBuilder.startPipeline(...)`;
- module system, sehingga `java.lang` tetap di `java.base`.

Ini mengubah process management dari “start and wait” menjadi lebih observable dan composable.

---

## 5.3 Java 10–17: container awareness makin penting

Modern JVM makin baik membaca container limits, tetapi kamu tetap harus memahami bahwa:

- `availableProcessors()` adalah JVM view;
- heap max bisa dipengaruhi container memory limit;
- OS process memory tidak sama dengan heap memory;
- orchestrator lifecycle seperti Kubernetes SIGTERM + grace period mempengaruhi shutdown hook.

Untuk service backend, runtime decision jangan hanya bergantung pada host-level assumption.

---

## 5.4 Java 18–25: command execution remains dangerous, API stable

Sampai Java 25, API process tetap relatif stabil, tetapi operational context berubah:

- containerized runtime makin umum;
- security manager sudah tidak bisa dijadikan primary sandbox;
- process execution logging/observability makin penting;
- native/foreign function API berkembang, tetapi process execution tetap berbeda dari native calls;
- virtual threads tidak menghilangkan problem OS pipe, timeout, dan process tree cleanup.

---

## 6. Contoh Kode Bertahap

## 6.1 Naive command runner

```java
public static int runNaive(List<String> command) throws IOException, InterruptedException {
    Process process = new ProcessBuilder(command).start();
    return process.waitFor();
}
```

Masalah:

- stdout/stderr tidak dibaca;
- bisa hang;
- tidak ada timeout;
- output hilang;
- error context minim;
- command tidak tervalidasi;
- process tree tidak dibersihkan.

---

## 6.2 Capture output sederhana dengan concurrent readers

```java
public record CommandResult(
    List<String> command,
    int exitCode,
    String stdout,
    String stderr
) {}
```

```java
public static CommandResult runCapture(List<String> command)
        throws IOException, InterruptedException, ExecutionException {

    ProcessBuilder pb = new ProcessBuilder(command);
    Process process = pb.start();

    ExecutorService ioPool = Executors.newFixedThreadPool(2);
    try {
        Future<String> stdout = ioPool.submit(() -> readUtf8(process.getInputStream()));
        Future<String> stderr = ioPool.submit(() -> readUtf8(process.getErrorStream()));

        int exit = process.waitFor();

        return new CommandResult(
            List.copyOf(command),
            exit,
            stdout.get(),
            stderr.get()
        );
    } finally {
        ioPool.shutdownNow();
    }
}

private static String readUtf8(InputStream in) throws IOException {
    try (in) {
        return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
}
```

Lebih baik, tapi masih punya masalah:

- output tidak dibatasi;
- process bisa hang selamanya;
- thread pool dibuat per call;
- no process tree cleanup;
- no environment/working dir control.

---

## 6.3 Runner dengan timeout

```java
public static CommandResult runWithTimeout(List<String> command, Duration timeout)
        throws IOException, InterruptedException, ExecutionException, TimeoutException {

    Process process = new ProcessBuilder(command).start();
    ExecutorService ioPool = Executors.newFixedThreadPool(2);

    try {
        Future<String> stdout = ioPool.submit(() -> readUtf8(process.getInputStream()));
        Future<String> stderr = ioPool.submit(() -> readUtf8(process.getErrorStream()));

        boolean finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
        if (!finished) {
            process.destroy();
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
            throw new TimeoutException("Command timed out after " + timeout + ": " + command);
        }

        return new CommandResult(
            List.copyOf(command),
            process.exitValue(),
            stdout.get(5, TimeUnit.SECONDS),
            stderr.get(5, TimeUnit.SECONDS)
        );
    } finally {
        ioPool.shutdownNow();
    }
}
```

Lebih baik, tetapi masih belum sempurna:

- jika child process spawn descendant, descendant bisa tetap hidup;
- stdout/stderr masih unlimited;
- exception message bisa membocorkan secret argument;
- timeout pakai millis conversion, hati-hati overflow/zero untuk duration kecil.

---

## 6.4 Bounded output reader

Untuk production, jangan `readAllBytes()` pada output command yang tidak trusted.

```java
public final class BoundedOutput {
    private final byte[] bytes;
    private final boolean truncated;

    public BoundedOutput(byte[] bytes, boolean truncated) {
        this.bytes = bytes;
        this.truncated = truncated;
    }

    public String asUtf8() {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    public boolean truncated() {
        return truncated;
    }
}
```

```java
public static BoundedOutput readBounded(InputStream in, int maxBytes) throws IOException {
    try (in) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
        byte[] buffer = new byte[8192];
        int total = 0;
        boolean truncated = false;

        while (true) {
            int read = in.read(buffer);
            if (read == -1) {
                break;
            }
            int remaining = maxBytes - total;
            if (remaining > 0) {
                int toWrite = Math.min(read, remaining);
                out.write(buffer, 0, toWrite);
                total += toWrite;
            }
            if (read > remaining) {
                truncated = true;
            }
        }
        return new BoundedOutput(out.toByteArray(), truncated);
    }
}
```

Nuance: reader tetap harus terus membaca sampai EOF supaya pipe tidak penuh, tetapi hanya menyimpan maksimal `maxBytes`.

---

## 6.5 Process tree termination Java 9+

```java
public static void terminateTree(Process process, Duration gracefulWait) throws InterruptedException {
    ProcessHandle root = process.toHandle();

    List<ProcessHandle> descendants = root.descendants()
        .filter(ProcessHandle::isAlive)
        .toList();

    // Terminate children first or root first? Depends on workload.
    // Often root first signals supervisor/script to shutdown children.
    root.destroy();

    long deadlineNanos = System.nanoTime() + gracefulWait.toNanos();
    while (System.nanoTime() < deadlineNanos) {
        boolean anyAlive = root.isAlive() || descendants.stream().anyMatch(ProcessHandle::isAlive);
        if (!anyAlive) {
            return;
        }
        Thread.sleep(100);
    }

    descendants.stream()
        .filter(ProcessHandle::isAlive)
        .forEach(ProcessHandle::destroyForcibly);

    if (root.isAlive()) {
        root.destroyForcibly();
    }
}
```

Caveat:

- process tree berubah race-condition;
- descendant dapat re-parent ke init/system process;
- permission bisa membatasi termination;
- Windows/Unix behavior berbeda;
- killing tree bisa menghentikan proses yang masih menulis file.

---

## 6.6 Safer command abstraction

Daripada menyebarkan `ProcessBuilder` mentah ke semua service, buat abstraction:

```java
public record CommandSpec(
    List<String> command,
    Path workingDirectory,
    Map<String, String> environment,
    Duration timeout,
    int maxStdoutBytes,
    int maxStderrBytes
) {
    public CommandSpec {
        Objects.requireNonNull(command);
        Objects.requireNonNull(timeout);
        if (command.isEmpty()) {
            throw new IllegalArgumentException("Command must not be empty");
        }
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("Timeout must be positive");
        }
        command = List.copyOf(command);
        environment = Map.copyOf(environment == null ? Map.of() : environment);
    }
}
```

```java
public interface CommandExecutor {
    CommandResult execute(CommandSpec spec)
        throws IOException, InterruptedException, TimeoutException;
}
```

Dengan abstraction ini kamu bisa enforce:

- allowlist executable;
- timeout mandatory;
- output bound mandatory;
- env sanitization;
- working dir validation;
- redaction;
- metrics;
- audit log;
- test double.

---

## 7. Design Patterns / Usage Patterns

## 7.1 Allowlisted executable pattern

Jangan biarkan arbitrary command dari user/admin UI dieksekusi mentah.

Buruk:

```java
new ProcessBuilder(userProvidedCommand).start();
```

Lebih aman:

```java
enum Tool {
    PDF_RENDERER(Path.of("/opt/tools/pdf-renderer")),
    VIRUS_SCANNER(Path.of("/usr/bin/clamscan"));

    private final Path executable;

    Tool(Path executable) {
        this.executable = executable;
    }

    Path executable() {
        return executable;
    }
}
```

Command dibentuk dari enum/internal config, bukan raw user input.

---

## 7.2 Argument list pattern

Pisahkan executable dan argument:

```java
List<String> command = List.of(
    "/opt/tools/pdf-renderer",
    "--input", inputPath.toString(),
    "--output", outputPath.toString()
);
```

Jangan gabung:

```java
"/opt/tools/pdf-renderer --input " + inputPath + " --output " + outputPath
```

Argument list mengurangi quoting bug dan command injection risk.

---

## 7.3 No-shell-by-default pattern

Default policy:

```text
Need pipe/wildcard/redirection?  maybe shell, but isolate and harden.
Need run executable + args?       no shell.
Need user input?                  no shell.
Need secret?                      avoid command args if possible.
```

Shell harus exception, bukan default.

---

## 7.4 Bounded output pattern

Untuk service:

- stdout max 1 MB misalnya;
- stderr max 256 KB;
- output truncated flag;
- full output ke file/blob storage jika memang perlu;
- jangan log output penuh.

```text
CommandResult
├── exitCode
├── stdoutPreview
├── stderrPreview
├── stdoutTruncated
├── stderrTruncated
├── duration
└── pid
```

---

## 7.5 Timeout as part of command contract

Timeout bukan optional.

```java
CommandSpec spec = new CommandSpec(
    command,
    workDir,
    env,
    Duration.ofSeconds(30),
    1_000_000,
    200_000
);
```

Timeout harus dipilih berdasarkan command semantics:

- antivirus scan: mungkin menit;
- `git --version`: detik;
- PDF rendering: tergantung halaman;
- OCR/image conversion: perlu limit ukuran input.

---

## 7.6 Redaction pattern

Jangan log command raw kalau mengandung secret.

Buruk:

```java
log.info("Executing {}", command);
```

Lebih aman:

```java
public record LoggedCommand(String executable, List<String> redactedArgs) {}
```

Contoh redaction:

```text
curl -H Authorization: Bearer abc.def.ghi
-> curl -H Authorization: <redacted>
```

Lebih baik lagi: jangan kirim secret via command argument karena argument dapat terlihat di process list pada banyak OS. Gunakan stdin, file permission ketat, environment dengan caveat, atau credential mechanism tool tersebut.

---

## 7.7 Supervisor pattern for long-running child process

Jika Java service menjalankan long-running child process:

- track PID;
- monitor liveness;
- restart policy eksplisit;
- health check;
- bounded logs;
- shutdown hook untuk stop;
- backoff restart;
- distinguish expected exit vs crash.

Namun sering kali lebih baik memakai process supervisor eksternal:

- systemd;
- Kubernetes sidecar/container;
- job scheduler;
- workflow engine.

Java service bukan selalu tempat terbaik untuk menjadi process supervisor.

---

## 8. Failure Modes

## 8.1 Command injection

Contoh buruk:

```java
String command = "convert " + userFile + " /tmp/out.pdf";
new ProcessBuilder("sh", "-c", command).start();
```

Jika `userFile` berisi:

```text
input.png; rm -rf /important
```

Shell akan memproses sebagai command tambahan.

Mitigasi:

- no shell;
- pass arguments as list;
- validate path;
- allowlist executable;
- isolate permissions;
- run as low-privilege user/container;
- no write access ke area sensitif.

---

## 8.2 Stream deadlock

Pattern:

```java
Process p = pb.start();
p.waitFor();
```

Jika subprocess menulis banyak output, ia bisa block sebelum exit.

Mitigasi:

- drain stdout/stderr concurrently;
- redirect to file;
- inherit IO untuk CLI;
- merge stderr when acceptable;
- bounded reading.

---

## 8.3 Waiting forever

Tanpa timeout:

```java
p.waitFor();
```

Command bisa hang karena:

- waiting for stdin;
- network call;
- file lock;
- prompt interaktif;
- deadlock internal;
- child process stuck.

Mitigasi:

- timeout mandatory;
- close stdin jika tidak dipakai;
- pass non-interactive flags;
- kill process tree;
- report timeout distinctly.

---

## 8.4 Not closing stdin

Subprocess bisa menunggu EOF dari stdin.

Jika kamu tidak akan menulis input:

```java
process.getOutputStream().close();
```

Atau redirect input:

```java
pb.redirectInput(ProcessBuilder.Redirect.INHERIT);
```

Atau:

```java
pb.redirectInput(new File("input.txt"));
```

---

## 8.5 Secret leakage through arguments

Command arguments sering terlihat via process listing.

Buruk:

```java
new ProcessBuilder("tool", "--password", password).start();
```

Risiko:

- `ps` output;
- process audit log;
- debug logs;
- crash dump;
- command execution instrumentation.

Mitigasi:

- stdin secret;
- protected temp file;
- environment with caution;
- OS credential store;
- tool-specific secure auth mechanism;
- avoid logging args.

---

## 8.6 `PATH` hijacking

Buruk:

```java
new ProcessBuilder("convert", input, output).start();
```

Jika `PATH` berubah, executable berbeda bisa dijalankan.

Mitigasi:

```java
new ProcessBuilder("/usr/bin/convert", input, output).start();
```

Atau resolve executable dari trusted config saat startup dan validasi.

---

## 8.7 Working directory confusion

Relative path membuat behavior tergantung lokasi proses Java dijalankan.

Mitigasi:

- gunakan absolute path;
- set working directory eksplisit;
- normalize path;
- validate allowed base directory.

---

## 8.8 Killing only parent process

Jika parent script mati tetapi child tetap hidup:

```text
Java
└── script killed
    └── worker still alive / re-parented
```

Mitigasi:

- Java 9+ `ProcessHandle.descendants()`;
- process group/session OS-specific wrapper;
- run in container/job with lifecycle boundary;
- external supervisor;
- tool-specific shutdown flag.

---

## 8.9 Shutdown hook deadlock

Contoh:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    service.stop(); // waits for worker
}));

// worker waits for something that needs shutdown hook to finish
```

Mitigasi:

- timeout every wait;
- avoid lock cycles;
- make shutdown idempotent;
- avoid starting new blocking workflows;
- design cooperative cancellation.

---

## 8.10 Misreading `availableProcessors()`

`availableProcessors()` bukan capacity planning final.

Failure:

```java
int workers = Runtime.getRuntime().availableProcessors() * 50;
```

Di pod dengan CPU limit kecil, ini bisa membuat overload. Di I/O workload, formula CPU-bound juga salah.

Mitigasi:

- config override;
- observe actual throughput/latency;
- queue/backpressure;
- adaptive sizing carefully;
- understand container limits.

---

## 9. Performance, Memory, Security Considerations

## 9.1 Process startup cost

Membuat native process jauh lebih mahal daripada method call.

Biaya:

- OS process creation;
- executable loading;
- environment copy;
- JVM/native boundary;
- I/O pipe setup;
- cold cache;
- child initialization.

Jangan menjalankan process per request tanpa capacity analysis.

Buruk:

```text
Every HTTP request -> spawn CLI -> parse output -> return
```

Alternatif:

- long-running worker;
- queue-based batch;
- library integration;
- sidecar service;
- pre-warmed process pool, dengan sangat hati-hati;
- async job model.

---

## 9.2 Output memory blow-up

Jika command menghasilkan 2 GB stdout lalu Java melakukan `readAllBytes()`, heap bisa habis.

Mitigasi:

- redirect to file;
- stream process output;
- bounded capture;
- reject large input;
- enforce command-level output option;
- compress/store externally.

---

## 9.3 Blocking threads

`waitFor()` blocking. Dengan platform threads, terlalu banyak concurrent process bisa menghabiskan thread.

Virtual threads dapat membantu blocking coordination, tetapi:

- tidak menghilangkan OS process limit;
- tidak menghilangkan pipe buffer issue;
- tidak menghilangkan memory output risk;
- tidak menghilangkan need for timeout.

---

## 9.4 File descriptor/resource leak

Setiap process dan pipe memakai OS resources.

Mitigasi:

- close streams;
- consume streams;
- call wait/cleanup;
- limit concurrent processes;
- use try/finally;
- monitor FD count.

---

## 9.5 Security boundary

Native process execution harus dianggap high-risk capability.

Checklist:

- Apakah executable allowlisted?
- Apakah user input dipakai sebagai executable? Harus tidak.
- Apakah shell dipakai? Kenapa?
- Apakah argument validated?
- Apakah path canonicalized?
- Apakah process berjalan low privilege?
- Apakah filesystem permission minimal?
- Apakah network egress dibatasi?
- Apakah secret tidak masuk args/log?
- Apakah output dibatasi?
- Apakah timeout ada?
- Apakah audit log aman?
- Apakah failure mode diuji?

---

## 10. Production Checklist

Sebelum memakai `ProcessBuilder` di service production:

```text
Command construction
[ ] executable allowlisted / absolute path
[ ] arguments passed as list, not shell string
[ ] no shell unless explicitly justified
[ ] all user inputs validated and canonicalized
[ ] working directory explicit and validated

Environment
[ ] environment minimized or intentionally inherited
[ ] PATH controlled
[ ] LANG/TZ/locale deterministic if output parsed
[ ] secrets not exposed unnecessarily

I/O
[ ] stdout handled
[ ] stderr handled
[ ] stdin closed or intentionally provided
[ ] output size bounded or redirected
[ ] logs redacted

Lifecycle
[ ] timeout mandatory
[ ] graceful termination attempted
[ ] forceful termination fallback
[ ] process tree considered
[ ] shutdown behavior considered
[ ] concurrency limit enforced

Observability
[ ] command category logged, not secret args
[ ] exit code captured
[ ] duration captured
[ ] timeout count metric
[ ] failure reason classified
[ ] truncated output flag captured

Security
[ ] least privilege user/container
[ ] filesystem sandboxing considered
[ ] network access constrained if possible
[ ] no arbitrary command execution endpoint
[ ] audit trail for admin-triggered execution

Testing
[ ] success exit code
[ ] non-zero exit code
[ ] huge stdout
[ ] huge stderr
[ ] timeout/hang
[ ] invalid executable
[ ] invalid working directory
[ ] interrupted wait
[ ] child process spawn
[ ] secret redaction
```

---

## 11. Latihan / Thought Exercise

### Exercise 1 — Diagnose process hang

Kamu punya code:

```java
Process p = new ProcessBuilder("report-generator", "--input", file).start();
int exit = p.waitFor();
String err = new String(p.getErrorStream().readAllBytes(), UTF_8);
```

Di production, kadang request hang selamanya.

Pertanyaan:

1. Apa kemungkinan root cause?
2. Mengapa membaca stderr setelah `waitFor()` terlambat?
3. Bagaimana memperbaikinya?
4. Apa test case yang harus dibuat?

Expected reasoning:

- subprocess mungkin menulis banyak stderr/stdout;
- pipe penuh;
- child blocked;
- parent menunggu exit;
- harus drain stdout/stderr concurrent atau redirect;
- tambahkan timeout dan bounded output.

---

### Exercise 2 — Design secure PDF renderer invocation

Sebuah backend perlu menjalankan `/opt/tools/html-to-pdf` untuk input HTML user dan menghasilkan PDF.

Rancang `CommandSpec` dengan:

- executable;
- input/output path;
- working directory;
- timeout;
- output capture;
- validation;
- redaction;
- cleanup.

Pertimbangkan:

- HTML user mungkin malicious;
- tool mungkin fetch external URL;
- output bisa besar;
- process bisa hang;
- temporary file harus aman;
- PDF generation harus idempotent.

---

### Exercise 3 — Kubernetes graceful shutdown

Java service menjalankan child process long-running untuk batch conversion. Pod menerima SIGTERM dengan grace period 30 detik.

Pertanyaan:

1. Apa yang shutdown hook harus lakukan?
2. Berapa timeout internal yang masuk akal?
3. Bagaimana memastikan child process tidak orphan?
4. Apa yang harus terjadi jika cleanup gagal?
5. Apa data yang perlu disimpan agar job bisa retry idempotently setelah restart?

---

### Exercise 4 — CPU sizing trap

Aplikasi menggunakan:

```java
int threads = Runtime.getRuntime().availableProcessors() * 20;
```

Di Kubernetes CPU limit 1 core, service mengalami latency tinggi.

Pertanyaan:

1. Apa masalah formula ini?
2. Apakah workload CPU-bound atau I/O-bound mempengaruhi?
3. Bagaimana desain config yang lebih baik?
4. Apa metric yang harus diamati?

---

## 12. Ringkasan

`Runtime`, `ProcessBuilder`, `Process`, dan `ProcessHandle` adalah API kecil tetapi sangat penting karena mereka berada di batas antara Java runtime dan operating system.

Mental model paling penting:

1. JVM adalah proses OS dengan lifecycle, resources, PID, signal, dan shutdown behavior sendiri.
2. `Runtime` memberi akses terbatas ke runtime JVM: CPU view, heap view, shutdown hook, exit/halt, dan legacy exec.
3. `ProcessBuilder` adalah cara utama membuat native process secara eksplisit.
4. `Process` adalah handle untuk subprocess yang dibuat Java: I/O, wait, exit, destroy.
5. `ProcessHandle` Java 9+ memberi observability/control native process yang lebih modern: PID, parent/children/descendants, info, liveness, async exit.
6. Native process execution bukan method call; ia punya command protocol, environment, working directory, stdout/stderr/stdin, exit code, timeout, OS-specific behavior, dan security risk.
7. Jangan gunakan shell kecuali benar-benar perlu.
8. Selalu baca/redirect stdout dan stderr.
9. Selalu punya timeout.
10. Jangan log secret arguments.
11. Jangan mengandalkan shutdown hook untuk workflow kritis.
12. Process tree cleanup harus dipikirkan, terutama untuk script/worker yang spawn child process.

Untuk software engineer senior/top-tier, kemampuan penting bukan sekadar tahu `new ProcessBuilder(...).start()`, tetapi mampu mendesain **safe process execution boundary** yang:

- deterministic;
- observable;
- bounded;
- secure;
- testable;
- compatible lintas Java 8–25;
- tidak membuat JVM/service menjadi process supervisor kacau tanpa sadar.

---

## Status Seri

Progress saat ini:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
Part 13 selesai
Part 14 selesai
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 15 — Thread, ThreadGroup, ThreadLocal, InheritableThreadLocal: Only the java.lang Angle
File: 15-thread-threadlocal-inheritablethreadlocal-java-lang-angle.md
```
