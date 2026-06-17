# Part 16 — `StackTraceElement`, `StackWalker`, Caller Sensitivity, and Observability

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `16-stacktraceelement-stackwalker-caller-sensitive-observability.md`  
> Scope: Java 8–25  
> Fokus: `java.lang.StackTraceElement`, `java.lang.StackWalker`, caller-sensitive behavior, cost stack inspection, diagnostic design, observability, dan failure modes production.

---

## 1. Tujuan Part Ini

Pada bagian sebelumnya kita membahas `Thread`, `ThreadLocal`, dan execution carrier dari sudut `java.lang`. Sekarang kita naik satu lapis: **bagaimana Java merepresentasikan jejak eksekusi**.

Di level pemula, stack trace biasanya hanya dianggap sebagai output error:

```text
java.lang.NullPointerException: Cannot invoke "User.id()" because "user" is null
    at com.example.UserService.load(UserService.java:42)
    at com.example.Controller.get(Controller.java:18)
```

Di level engineer senior/top-tier, stack trace dipahami sebagai:

1. **diagnostic artifact** — bukti lokasi, jalur panggilan, dan konteks kegagalan;
2. **runtime data structure** — frame method invocation yang bisa diinspeksi;
3. **observability primitive** — bahan logging, tracing, metrics, profiling, dan error reporting;
4. **security-sensitive boundary** — caller inference bisa berdampak pada access decision;
5. **performance-sensitive operation** — capture stack tidak gratis;
6. **abstraction leak** — stack shape bisa berubah karena JIT, reflection, proxies, lambdas, generated code, hidden frames, virtual threads, dan framework dispatch.

Part ini bertujuan membuat kamu memahami stack bukan sebagai “teks error”, tetapi sebagai **kontrak runtime yang harus diperlakukan hati-hati**.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

- menjelaskan perbedaan `Throwable.getStackTrace()`, `Thread.getStackTrace()`, dan `StackWalker`;
- memahami `StackTraceElement` sebagai value representation dari frame, bukan live frame;
- menggunakan `StackWalker` untuk short walk, caller lookup, dan diagnostic extraction secara lebih aman;
- memahami opsi `StackWalker.Option` seperti `RETAIN_CLASS_REFERENCE`, `SHOW_REFLECT_FRAMES`, `SHOW_HIDDEN_FRAMES`, dan `DROP_METHOD_INFO`;
- menghindari desain yang bergantung pada bentuk stack secara brittle;
- mengevaluasi cost stack capture dalam logging, exceptions, framework utilities, dan high-throughput code;
- membuat utility caller/location yang eksplisit, terbatas, dan tidak berbahaya;
- memahami hubungan stack dengan observability, security, testing, dan virtual-thread era.

---

## 2. Mental Model Utama

### 2.1 Stack adalah jalur eksekusi, bukan model domain

Call stack adalah struktur runtime yang berisi urutan method invocation aktif pada satu thread. Ketika method A memanggil B, B memanggil C, maka stack memiliki frame untuk A, B, C. Frame paling atas adalah method yang sedang berjalan.

Mental model sederhana:

```text
Thread T
┌──────────────────────────────┐
│ top: current method           │
│ Service.validate()            │
├──────────────────────────────┤
│ Controller.handle()           │
├──────────────────────────────┤
│ FrameworkDispatcher.invoke()  │
├──────────────────────────────┤
│ Thread.run()                  │
└──────────────────────────────┘
```

Tetapi stack bukan domain truth. Stack hanya menunjukkan **bagaimana kode sampai ke titik tertentu**, bukan **kenapa secara bisnis hal itu terjadi**.

Karena itu, jangan mengganti explicit context dengan stack inference.

Buruk:

```java
public AuditEvent audit(String action) {
    String module = inferModuleFromCallerPackage();
    return new AuditEvent(module, action);
}
```

Lebih baik:

```java
public AuditEvent audit(ModuleId module, String action) {
    return new AuditEvent(module, action);
}
```

Stack inference boleh dipakai untuk diagnostic convenience, bukan sebagai kontrak domain utama.

---

### 2.2 Stack trace adalah snapshot, bukan live execution frame

`StackTraceElement` tidak memberi akses ke local variable, operand stack, object live di frame, atau bytecode state secara langsung.

Ia hanya representasi informasi seperti:

- class name;
- method name;
- file name;
- line number;
- module name/version pada Java modern;
- class loader name pada Java modern;
- native method flag.

Jadi `StackTraceElement` adalah **metadata snapshot**, bukan debugger API.

---

### 2.3 Stack walking harus dibatasi tujuannya

Ada beberapa tujuan sah untuk stack inspection:

- membuat error report;
- mengambil caller class untuk logging facade;
- membuat assertion/test helper;
- membuat framework diagnostic;
- filtering internal framework frames;
- mendapatkan lokasi pemanggilan untuk warning/deprecation message;
- profiling ringan atau debug tool.

Tetapi stack inspection berbahaya jika dipakai untuk:

- authorization;
- business decision;
- tenant/user inference;
- transaction ownership;
- module ownership;
- API behavior yang harus stabil lintas refactor.

Rule:

> Stack boleh membantu menjelaskan apa yang terjadi. Stack tidak boleh menjadi sumber utama keputusan bisnis.

---

### 2.4 Stack shape bukan API stabil

Urutan frame bisa berubah karena:

- method extraction/refactor;
- compiler-generated bridge method;
- lambda/metafactory;
- reflection;
- proxy;
- AOP/interceptor;
- framework dispatch;
- JIT inlining/deoptimization behavior;
- hidden frames;
- native calls;
- virtual thread implementation details;
- test runner;
- agent/instrumentation;
- library upgrade.

Maka kode seperti ini rapuh:

```java
StackTraceElement caller = Thread.currentThread().getStackTrace()[3];
```

Index `[3]` mungkin benar hari ini, salah besok.

---

### 2.5 Observability membutuhkan stack, tetapi stack bukan observability lengkap

Stack trace menjawab:

```text
Kode sampai di sini lewat jalur mana?
```

Tetapi stack trace tidak otomatis menjawab:

```text
Request ID apa?
User siapa?
Tenant apa?
Case ID apa?
Retry ke berapa?
Downstream mana?
Input business apa?
Lock apa yang dipegang?
Transaction boundary mana?
```

Untuk production observability, stack perlu dikombinasikan dengan:

- structured log;
- correlation ID;
- trace/span ID;
- domain identifiers;
- request metadata;
- error code;
- retry metadata;
- deployment metadata;
- build/version metadata.

---

## 3. Konsep Fundamental

### 3.1 JVM frame secara konseptual

Setiap method invocation punya frame. Secara JVM, frame menyimpan hal-hal seperti local variables, operand stack, dan reference ke runtime constant pool. Tetapi API `java.lang` tidak mengekspos frame mentah ini.

Yang diekspos Java SE untuk aplikasi normal adalah representasi yang lebih aman:

- `StackTraceElement`;
- `StackWalker.StackFrame`;
- `Throwable` stack trace;
- `Thread` stack trace.

---

### 3.2 `StackTraceElement`

`StackTraceElement` adalah representasi satu frame dalam stack trace.

Contoh:

```java
StackTraceElement e = Thread.currentThread().getStackTrace()[0];

System.out.println(e.getClassName());
System.out.println(e.getMethodName());
System.out.println(e.getFileName());
System.out.println(e.getLineNumber());
System.out.println(e.isNativeMethod());
```

Pada Java modern, `StackTraceElement` juga memiliki informasi tambahan seperti:

- class loader name;
- module name;
- module version.

Ini penting setelah Java 9 module system karena class tidak lagi hanya “package + class name”; runtime boundary juga bisa melibatkan module dan class loader.

---

### 3.3 `Throwable` stack trace

Ketika `Throwable` dibuat, Java biasanya mengisi stack trace pada titik object exception dibuat, bukan pada titik exception ditangkap.

Contoh:

```java
Exception ex = new Exception("created here");

someOtherMethod();

throw ex;
```

Stack trace umumnya menunjuk ke lokasi `new Exception(...)`, bukan lokasi `throw ex`, karena capture terjadi pada construction/fill-in stack trace.

Implikasi:

- membuat exception itu relatif mahal;
- exception yang dibuat lebih awal bisa punya stack trace yang misleading;
- reusing exception object adalah ide buruk;
- stack trace menunjukkan lokasi konstruksi throwable, bukan selalu semantic source paling tepat.

---

### 3.4 `Thread.getStackTrace()`

`Thread.currentThread().getStackTrace()` mengembalikan array `StackTraceElement[]`.

```java
StackTraceElement[] stack = Thread.currentThread().getStackTrace();
for (StackTraceElement e : stack) {
    System.out.println(e);
}
```

Ini mudah, tetapi punya kelemahan:

- eager, membuat array seluruh stack;
- sering memasukkan frame internal seperti `Thread.getStackTrace` sendiri;
- caller index brittle;
- tidak memberi `Class<?>` object;
- kurang cocok untuk short walk.

---

### 3.5 `StackWalker`

`StackWalker` diperkenalkan di Java 9 melalui JEP 259 untuk menyediakan API stack walking yang:

- lazy;
- bisa short-circuit;
- bisa filter frame;
- bisa mendapatkan `Class<?>` pemanggil dengan opsi tertentu;
- lebih cocok untuk framework daripada `Thread.getStackTrace()`.

Contoh dasar:

```java
StackWalker walker = StackWalker.getInstance();

List<String> frames = walker.walk(stream ->
    stream.limit(10)
          .map(frame -> frame.getClassName() + "#" + frame.getMethodName())
          .toList()
);
```

`walk` menerima function yang bekerja di dalam lifetime stream. Stream frame tidak boleh dipakai setelah `walk` selesai.

Buruk:

```java
Stream<StackWalker.StackFrame> leaked = walker.walk(stream -> stream);
// stream sudah closed setelah walk return
```

Benar:

```java
List<StackWalker.StackFrame> frames = walker.walk(stream ->
    stream.limit(5).toList()
);
```

---

## 4. API dan Contract yang Perlu Dipahami

## 4.1 `StackTraceElement` API

### 4.1.1 Class/method/file/line

Core API:

```java
String className = element.getClassName();
String methodName = element.getMethodName();
String fileName = element.getFileName();
int line = element.getLineNumber();
boolean nativeMethod = element.isNativeMethod();
```

Interpretasi:

| API | Makna | Caveat |
|---|---|---|
| `getClassName()` | Binary name class deklarasi method | String, bukan `Class<?>` |
| `getMethodName()` | Nama method | Constructor bisa muncul sebagai `<init>` |
| `getFileName()` | Source file | Bisa `null` |
| `getLineNumber()` | Line number | Bisa negatif jika unknown/native |
| `isNativeMethod()` | Apakah native method | Tidak berarti semua detail native tersedia |

Line number tergantung debug metadata dalam class file. Build yang menghapus line number dapat menghasilkan stack trace kurang informatif.

---

### 4.1.2 Module dan class loader info

Pada Java 9+, stack trace string dapat memuat module/class loader information. `StackTraceElement` modern juga punya accessor untuk:

```java
String loader = element.getClassLoaderName();
String module = element.getModuleName();
String version = element.getModuleVersion();
```

Ini membantu debugging pada sistem modular atau container/framework yang memakai banyak class loader.

Contoh output bisa terlihat seperti:

```text
app/com.example.Service.process(Service.java:42)
java.base/java.lang.Thread.run(Thread.java:...)
```

Atau dengan class loader name jika tersedia.

---

### 4.1.3 Equality dan hash

`StackTraceElement` punya value-style equality. Dua element dianggap equal jika detail representasinya sama.

Tetapi jangan pakai equality stack trace sebagai identity error production. Lebih baik fingerprint dengan normalisasi.

Contoh problem:

- line berubah karena refactor;
- lambda generated method berubah;
- module version berubah;
- generated proxy name berubah;
- obfuscation/minification;
- shading/relocation.

Lebih aman untuk grouping error:

```text
exception class + top application frame class + method + stable error code
```

bukan full stack trace exact equality.

---

## 4.2 `Throwable` Stack APIs

### 4.2.1 `getStackTrace`

```java
try {
    service.execute();
} catch (Exception e) {
    StackTraceElement[] trace = e.getStackTrace();
}
```

`getStackTrace()` mengembalikan array. Mutasi array yang dikembalikan tidak mengubah internal throwable kecuali kamu memanggil `setStackTrace`.

---

### 4.2.2 `setStackTrace`

```java
Throwable t = new RuntimeException("redacted");
t.setStackTrace(new StackTraceElement[0]);
```

Kegunaan sah:

- membuat exception synthetic untuk testing;
- redaction internal frame;
- performance micro-optimization di exception khusus;
- interoperability dengan sistem remote error.

Risiko:

- kehilangan diagnostic utama;
- misleading production incident;
- melanggar ekspektasi debugging;
- menyembunyikan root cause.

Rule:

> Jangan hapus stack trace production exception kecuali kamu memiliki observability pengganti yang lebih baik.

---

### 4.2.3 `printStackTrace`

```java
e.printStackTrace();
```

Ini convenience legacy. Dalam production, lebih baik pakai logging framework dengan structured context.

Buruk:

```java
catch (Exception e) {
    e.printStackTrace();
}
```

Lebih baik:

```java
catch (Exception e) {
    log.error("Failed to process caseId={} correlationId={}", caseId, correlationId, e);
}
```

---

## 4.3 `StackWalker` API

### 4.3.1 Membuat `StackWalker`

```java
StackWalker walker = StackWalker.getInstance();
```

Dengan option:

```java
StackWalker walker = StackWalker.getInstance(
    Set.of(StackWalker.Option.RETAIN_CLASS_REFERENCE)
);
```

`StackWalker` thread-safe. Object walker bisa dipakai ulang oleh banyak thread; setiap thread akan berjalan pada stack-nya sendiri.

---

### 4.3.2 `walk`

```java
String caller = StackWalker.getInstance().walk(frames ->
    frames.skip(1)
          .findFirst()
          .map(f -> f.getClassName() + "#" + f.getMethodName())
          .orElse("<unknown>")
);
```

Masalah: `skip(1)` masih brittle jika utility dipanggil dari wrapper tambahan.

Lebih baik filter frame internal:

```java
final class CallerLocation {
    private static final String UTILITY_PACKAGE = "com.example.runtime.";

    private static final StackWalker WALKER = StackWalker.getInstance();

    static String firstExternalCaller() {
        return WALKER.walk(frames -> frames
            .filter(f -> !f.getClassName().startsWith(UTILITY_PACKAGE))
            .findFirst()
            .map(f -> f.getClassName() + "#" + f.getMethodName() + ":" + f.getLineNumber())
            .orElse("<unknown>"));
    }
}
```

Tetap hati-hati: package filtering juga bisa berubah karena refactor.

---

### 4.3.3 `getCallerClass`

`getCallerClass()` membutuhkan `RETAIN_CLASS_REFERENCE`.

```java
private static final StackWalker CALLER_WALKER = StackWalker.getInstance(
    StackWalker.Option.RETAIN_CLASS_REFERENCE
);

public static Class<?> callerClass() {
    return CALLER_WALKER.getCallerClass();
}
```

Kegunaan:

- logging facade;
- framework registry;
- diagnostic helper;
- test utility.

Risiko:

- caller-sensitive behavior bisa berubah karena wrapper;
- class reference bisa mempertahankan class loader jika dicache sembarangan;
- tidak boleh jadi security model utama tanpa desain sangat hati-hati.

---

### 4.3.4 `StackWalker.StackFrame`

`StackFrame` memberi informasi frame tanpa langsung menjadi `StackTraceElement`.

API penting:

```java
String className = frame.getClassName();
String methodName = frame.getMethodName();
int line = frame.getLineNumber();
String fileName = frame.getFileName();
StackTraceElement ste = frame.toStackTraceElement();
```

Dengan `RETAIN_CLASS_REFERENCE`:

```java
Class<?> declaringClass = frame.getDeclaringClass();
```

`getDeclaringClass()` tidak tersedia jika walker tidak dibuat dengan opsi yang sesuai.

---

## 4.4 `StackWalker.Option`

### 4.4.1 `RETAIN_CLASS_REFERENCE`

Memungkinkan akses `Class<?>` dari frame.

```java
StackWalker walker = StackWalker.getInstance(
    StackWalker.Option.RETAIN_CLASS_REFERENCE
);
```

Gunakan jika butuh:

- `Class<?>` caller;
- module dari class object;
- annotation/package metadata;
- class loader relation.

Jangan gunakan jika hanya butuh string class/method untuk logging sederhana.

---

### 4.4.2 `SHOW_REFLECT_FRAMES`

Menampilkan reflection frames yang biasanya disembunyikan.

Berguna untuk debugging framework yang banyak memakai reflection.

Contoh conceptual:

```text
com.example.Target.method(Target.java:10)
java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(...)
java.base/java.lang.reflect.Method.invoke(...)
com.example.Framework.invoke(Framework.java:50)
```

Tanpa opsi ini, sebagian frame reflection bisa tidak muncul.

---

### 4.4.3 `SHOW_HIDDEN_FRAMES`

Menampilkan hidden frames, termasuk frame yang implementation-specific.

Gunakan untuk:

- debugging mendalam;
- framework/runtime investigation;
- memahami dispatch lambda/reflection/proxy.

Jangan jadikan output ini kontrak stabil. Hidden frames justru disebut hidden karena bukan bagian dari abstraksi normal aplikasi.

---

### 4.4.4 `DROP_METHOD_INFO`

Opsi untuk menurunkan informasi method tertentu dari frame. Ini bisa relevan untuk skenario yang hanya butuh class-level information atau ingin mengurangi detail.

Tetapi jika kamu butuh line/method, jangan gunakan opsi ini.

---

## 5. Evolusi Java 8–25

## 5.1 Java 8 baseline

Pada Java 8, tool utama untuk stack adalah:

- `Throwable.getStackTrace()`;
- `Throwable.printStackTrace()`;
- `Thread.getStackTrace()`;
- `StackTraceElement`;
- internal/non-standard hacks seperti `sun.reflect.Reflection.getCallerClass` pada beberapa kasus lama.

Masalah umum Java 8:

- caller inference memakai index array;
- cost eager stack trace;
- API internal dipakai framework;
- sulit short-circuit stack traversal.

---

## 5.2 Java 9: `StackWalker`

Java 9 memperkenalkan `StackWalker` melalui JEP 259.

Tujuannya:

- lazy stack walking;
- frame filtering;
- short walk;
- akses `Class<?>` dengan permission/option;
- replacement yang lebih baik untuk caller-sensitive hacks lama.

Dengan Java 9+, utility baru sebaiknya memilih `StackWalker` dibanding `Thread.getStackTrace()` jika butuh stack inspection yang non-trivial.

---

## 5.3 Java 9 module information in stack traces

Sejak module system, stack trace dapat menampilkan module.

Ini membantu membedakan:

```text
java.base/java.lang.String
my.module/com.example.Service
```

Dalam sistem besar, module/class loader info membantu investigasi:

- split package;
- wrong module version;
- class path vs module path;
- plugin class loader;
- duplicate dependency;
- illegal reflective access symptom.

---

## 5.4 Java 14+: helpful NullPointerException

Helpful NPE membuat pesan NPE lebih informatif, misalnya menjelaskan expression mana yang null.

Dari sisi stack trace, ini mengurangi kebutuhan menebak dari line number saja.

Sebelumnya:

```text
java.lang.NullPointerException
    at Service.process(Service.java:42)
```

Sekarang bisa lebih jelas:

```text
Cannot invoke "Customer.id()" because "order.customer()" is null
```

Tetap jangan mengandalkan pesan NPE sebagai API stabil. Pesan exception untuk manusia/operator, bukan kontrak machine parsing.

---

## 5.5 Java 19–21+: virtual threads

Virtual thread tetap `java.lang.Thread`, tetapi cost model dan stack behavior berbeda dari platform thread.

Implikasi untuk part ini:

- stack trace virtual thread tetap penting;
- thread dump dan observability perlu sadar virtual thread;
- `ThreadLocal` berhubungan erat dengan context, tetapi stack tetap hanya jalur panggilan;
- jangan capture stack berlebihan di jutaan virtual task;
- caller inference tetap brittle.

---

## 5.6 Java 25 status

Di Java 25, `StackWalker`, `StackTraceElement`, dan related API sudah menjadi bagian stabil Java SE modern. Untuk library yang harus mendukung Java 8–25, biasanya perlu strategy:

1. baseline Java 8: pakai `Throwable/Thread.getStackTrace()`;
2. runtime Java 9+: optional path memakai reflection atau multi-release JAR untuk `StackWalker`;
3. baseline Java 11/17/21/25: langsung gunakan `StackWalker`.

---

## 6. Contoh Kode Bertahap

## 6.1 Contoh 1 — Melihat stack trace current thread

```java
public final class StackTraceDemo {
    public static void main(String[] args) {
        a();
    }

    static void a() {
        b();
    }

    static void b() {
        c();
    }

    static void c() {
        for (StackTraceElement e : Thread.currentThread().getStackTrace()) {
            System.out.println(e.getClassName() + "#" + e.getMethodName() + ":" + e.getLineNumber());
        }
    }
}
```

Output akan mencakup frame seperti:

```text
java.lang.Thread#getStackTrace:...
StackTraceDemo#c:...
StackTraceDemo#b:...
StackTraceDemo#a:...
StackTraceDemo#main:...
```

Perhatikan frame pertama adalah `Thread.getStackTrace`, bukan method bisnis.

---

## 6.2 Contoh 2 — Jangan hard-code index caller

Buruk:

```java
public final class CallerUtil {
    public static String caller() {
        StackTraceElement[] stack = Thread.currentThread().getStackTrace();
        return stack[2].getClassName() + "#" + stack[2].getMethodName();
    }
}
```

Masalah:

- index berubah jika ada wrapper;
- JDK/framework bisa menambah frame;
- test runner bisa mengubah stack shape;
- refactor method bisa mengubah hasil.

Lebih baik dengan filter eksplisit:

```java
public final class CallerUtil {
    private static final StackWalker WALKER = StackWalker.getInstance();
    private static final String INTERNAL_PREFIX = CallerUtil.class.getPackageName();

    public static String caller() {
        return WALKER.walk(frames -> frames
            .filter(f -> !f.getClassName().startsWith("java.lang.StackWalker"))
            .filter(f -> !f.getClassName().startsWith(INTERNAL_PREFIX))
            .findFirst()
            .map(f -> f.getClassName() + "#" + f.getMethodName() + ":" + f.getLineNumber())
            .orElse("<unknown>"));
    }
}
```

Tetap ada caveat, tetapi lebih eksplisit daripada index magic.

---

## 6.3 Contoh 3 — Mengambil caller `Class<?>`

```java
public final class CallerClass {
    private static final StackWalker WALKER = StackWalker.getInstance(
        StackWalker.Option.RETAIN_CLASS_REFERENCE
    );

    public static Class<?> getCallerClass() {
        return WALKER.getCallerClass();
    }
}
```

Contoh penggunaan:

```java
public final class LoggerFactory {
    public static Logger getLoggerForCaller() {
        Class<?> caller = CallerClass.getCallerClass();
        return Logger.getLogger(caller.getName());
    }
}
```

Namun utility di atas bisa keliru jika ada layer tambahan:

```java
public final class MyLog {
    public static Logger logger() {
        return LoggerFactory.getLoggerForCaller();
    }
}
```

Caller yang didapat mungkin `MyLog`, bukan class aplikasi yang memanggil `MyLog`.

Maka logging facade serius biasanya perlu desain khusus untuk skip internal frames.

---

## 6.4 Contoh 4 — Short walk untuk mencari frame aplikasi pertama

```java
import java.lang.StackWalker.StackFrame;
import java.util.Set;

public final class ApplicationFrameFinder {
    private static final StackWalker WALKER = StackWalker.getInstance(Set.of(
        StackWalker.Option.RETAIN_CLASS_REFERENCE
    ));

    public static StackTraceElement firstApplicationFrame() {
        return WALKER.walk(frames -> frames
            .filter(ApplicationFrameFinder::isApplicationFrame)
            .findFirst()
            .map(StackFrame::toStackTraceElement)
            .orElse(null));
    }

    private static boolean isApplicationFrame(StackFrame frame) {
        String name = frame.getClassName();
        return name.startsWith("com.mycompany.")
            && !name.startsWith("com.mycompany.platform.logging.")
            && !name.startsWith("com.mycompany.platform.runtime.");
    }
}
```

Kelebihan:

- tidak perlu materialize seluruh stack;
- bisa stop saat frame ditemukan;
- rule terlihat eksplisit.

Kekurangan:

- bergantung pada package convention;
- bisa gagal saat shading/refactor;
- tetap bukan kontrak domain.

---

## 6.5 Contoh 5 — Lightweight warning dengan caller location

```java
public final class DeprecationWarning {
    private static final StackWalker WALKER = StackWalker.getInstance();

    public static void warnOnce(String feature) {
        String location = WALKER.walk(frames -> frames
            .filter(f -> !f.getClassName().equals(DeprecationWarning.class.getName()))
            .findFirst()
            .map(f -> f.getClassName() + "#" + f.getMethodName() + ":" + f.getLineNumber())
            .orElse("<unknown>"));

        System.err.println("Deprecated feature used: " + feature + " at " + location);
    }
}
```

Production version harus:

- rate limited;
- structured logging;
- tidak spam;
- tidak capture stack tiap request jika warning sudah pernah muncul;
- tidak memuat data sensitif.

---

## 6.6 Contoh 6 — Error fingerprint yang lebih stabil

Buruk:

```java
String fingerprint(Throwable t) {
    return Arrays.toString(t.getStackTrace());
}
```

Lebih baik:

```java
public final class ErrorFingerprint {
    public static String fingerprint(Throwable t) {
        StackTraceElement appFrame = firstApplicationFrame(t);
        String frameKey = appFrame == null
            ? "unknown"
            : appFrame.getClassName() + "#" + appFrame.getMethodName();

        return t.getClass().getName() + "|" + frameKey;
    }

    private static StackTraceElement firstApplicationFrame(Throwable t) {
        for (StackTraceElement e : t.getStackTrace()) {
            if (e.getClassName().startsWith("com.mycompany.")) {
                return e;
            }
        }
        return null;
    }
}
```

Untuk sistem production, fingerprint sebaiknya mempertimbangkan:

- exception class;
- stable error code;
- top application frame;
- root cause class;
- normalized message jika aman;
- service/module version.

---

## 6.7 Contoh 7 — Java 8 compatible fallback

Jika library harus support Java 8 dan Java 9+, opsi paling sederhana adalah tetap memakai Java 8 API.

```java
public final class Java8StackSupport {
    public static StackTraceElement firstExternalFrame(String internalPrefix) {
        StackTraceElement[] stack = Thread.currentThread().getStackTrace();
        for (StackTraceElement e : stack) {
            String className = e.getClassName();
            if (!className.startsWith("java.lang.Thread")
                && !className.startsWith(internalPrefix)) {
                return e;
            }
        }
        return null;
    }
}
```

Ini tidak sebaik `StackWalker`, tetapi lebih aman daripada index tetap.

Untuk library advanced, bisa gunakan multi-release JAR:

```text
src/main/java/...              -> Java 8 implementation
src/main/java9/...             -> Java 9 StackWalker implementation
```

Tetapi multi-release JAR menambah kompleksitas build/testing.

---

## 7. Design Patterns / Usage Patterns

## 7.1 Pattern: Diagnostic-only caller location

Tujuan:

- log lokasi pemanggil;
- warning migration;
- error report enrichment.

Karakter:

- tidak mempengaruhi business behavior;
- aman jika gagal;
- fallback ke `<unknown>`;
- tidak dipakai untuk authorization;
- rate-limited.

Contoh:

```java
public record CallerLocation(
    String className,
    String methodName,
    String fileName,
    int lineNumber
) {
    public static CallerLocation unknown() {
        return new CallerLocation("<unknown>", "<unknown>", null, -1);
    }
}
```

```java
public final class CallerLocations {
    private static final StackWalker WALKER = StackWalker.getInstance();

    public static CallerLocation capture(String excludedPrefix) {
        return WALKER.walk(frames -> frames
            .filter(f -> !f.getClassName().startsWith(excludedPrefix))
            .findFirst()
            .map(f -> new CallerLocation(
                f.getClassName(),
                f.getMethodName(),
                f.getFileName(),
                f.getLineNumber()
            ))
            .orElse(CallerLocation.unknown()));
    }
}
```

---

## 7.2 Pattern: Stack frame filtering for framework internals

Framework sering ingin menampilkan stack yang relevan untuk aplikasi, bukan semua internal frame.

Pattern:

1. define internal package prefixes;
2. define application package prefixes;
3. choose first meaningful frame;
4. preserve raw stack somewhere if incident severity tinggi.

```java
public final class StackFilters {
    private static final List<String> INTERNAL_PREFIXES = List.of(
        "com.mycompany.platform.",
        "org.springframework.",
        "java.lang.reflect.",
        "jdk.internal.reflect."
    );

    public static boolean isInternal(StackTraceElement e) {
        String c = e.getClassName();
        return INTERNAL_PREFIXES.stream().anyMatch(c::startsWith);
    }
}
```

Caveat: jangan terlalu agresif menghapus frame. Frame internal sering penting untuk debugging.

---

## 7.3 Pattern: Error enrichment without stack mutation

Daripada mengubah stack trace, enrich error report.

```java
public record ErrorReport(
    String errorId,
    String errorCode,
    String exceptionClass,
    String message,
    String topApplicationFrame,
    String correlationId,
    String caseId
) {}
```

Stack trace tetap ada di log/error backend, tetapi UI/API hanya menampilkan error ID dan safe summary.

---

## 7.4 Pattern: Lazy stack capture

Jangan capture stack kalau tidak akan dipakai.

Buruk:

```java
public void debug(String message) {
    StackTraceElement caller = ApplicationFrameFinder.firstApplicationFrame();
    if (debugEnabled) {
        log.debug("{} at {}", message, caller);
    }
}
```

Lebih baik:

```java
public void debug(String message) {
    if (!debugEnabled) {
        return;
    }
    StackTraceElement caller = ApplicationFrameFinder.firstApplicationFrame();
    log.debug("{} at {}", message, caller);
}
```

---

## 7.5 Pattern: Boundary explicitness over caller inference

Buruk:

```java
public void checkPermission() {
    Class<?> caller = StackWalker.getInstance(RETAIN_CLASS_REFERENCE).getCallerClass();
    if (!caller.getPackageName().startsWith("com.mycompany.admin")) {
        throw new SecurityException();
    }
}
```

Lebih baik:

```java
public void checkPermission(AuthenticatedPrincipal principal, Permission permission) {
    if (!authorizationService.isAllowed(principal, permission)) {
        throw new AccessDeniedException(permission);
    }
}
```

Stack-based permission adalah fragile dan bisa menjadi security footgun jika wrapper/proxy/reflection mengubah caller.

---

## 8. Failure Modes

## 8.1 Magic stack index

```java
StackTraceElement caller = Thread.currentThread().getStackTrace()[3];
```

Gagal ketika:

- method utility diwrap;
- compiler/JDK menambah frame;
- testing framework memanggil via reflection;
- library upgrade mengubah call path;
- virtual thread/framework dispatch berbeda.

Mitigasi:

- gunakan `StackWalker`;
- filter by prefix/class;
- fallback aman;
- jangan jadikan business contract.

---

## 8.2 Stack capture di hot path

Buruk:

```java
for (Item item : millionItems) {
    log.debug("Processing {} at {}", item.id(), Thread.currentThread().getStackTrace()[1]);
}
```

Meskipun debug disabled, argument bisa tetap dihitung tergantung logging call style.

Mitigasi:

- guard log level;
- lazy supplier jika framework support;
- sampling;
- capture only on anomaly;
- avoid stack in tight loops.

---

## 8.3 Exception sebagai control flow

```java
try {
    return Integer.parseInt(value);
} catch (NumberFormatException e) {
    return null;
}
```

Kadang acceptable di boundary kecil, tetapi buruk jika jutaan kali di hot path.

Cost berasal dari exception object, stack trace, dan unwinding.

Mitigasi:

- validate fast path;
- use parser API yang menghindari exception jika tersedia;
- isolate exceptional path;
- benchmark jika benar-benar critical.

---

## 8.4 Menghapus stack trace demi “clean error”

Buruk:

```java
catch (Exception e) {
    throw new ApiException("Failed");
}
```

Cause hilang.

Lebih baik:

```java
catch (Exception e) {
    throw new ApiException("Failed to process application", e);
}
```

Jika response ke user harus clean, bersihkan di API response, bukan dengan menghapus diagnostic internal.

---

## 8.5 Parsing stack trace text

Buruk:

```java
String stack = stackTraceToString(e);
if (stack.contains("com.mycompany.payment")) {
    // classify as payment error
}
```

Masalah:

- format bisa berubah;
- module/class loader info berubah;
- localization/tool formatting;
- shaded classes;
- false positives.

Lebih baik pakai structured `StackTraceElement`.

---

## 8.6 Caller-based security decision

Stack-based security sangat rapuh dalam aplikasi modern.

Contoh risiko:

- reflection/proxy mengubah caller;
- wrapper library membuat caller terlihat trusted;
- attacker tidak perlu mengontrol stack jika bisa memanggil trusted facade;
- refactor bisa membuka akses tanpa sadar.

Mitigasi:

- gunakan explicit principal/context;
- permission check berdasarkan identity dan policy;
- stack hanya diagnostic.

---

## 8.7 Over-filtering stack trace

Beberapa tim menyembunyikan semua framework frame agar log “bersih”.

Masalah:

- root cause bisa berada di integration point;
- transaction/proxy/interceptor behavior hilang;
- incident jadi sulit direkonstruksi.

Mitigasi:

- simpan raw stack di backend log;
- tampilkan simplified stack di UI;
- jangan destructively mutate `Throwable` kecuali perlu.

---

## 8.8 Stack trace mengandung informasi sensitif

Stack trace bisa membocorkan:

- package internal;
- nama module;
- file path jika custom formatting;
- query/value dalam exception message;
- tenant/case/user ID dalam message;
- dependency version;
- endpoint internal.

Mitigasi:

- jangan expose raw stack trace ke public API;
- gunakan error ID;
- sanitize message;
- simpan detail di protected log;
- pisahkan operator diagnostics dan user response.

---

## 9. Performance, Memory, Security Considerations

## 9.1 Performance: stack walking bukan gratis

Operasi stack-related punya cost:

- capture stack trace exception;
- materialize array `StackTraceElement[]`;
- convert frame ke string;
- resolve class reference dengan `RETAIN_CLASS_REFERENCE`;
- logging full stack;
- transmitting stack to error backend.

Rule praktis:

| Situasi | Stack capture? |
|---|---|
| Fatal/unexpected error | Ya |
| Rare warning | Ya, mungkin sampled/rate-limited |
| Debug disabled | Tidak |
| Tight loop normal path | Hindari |
| Security decision | Jangan sebagai basis utama |
| Framework diagnostic at startup | Boleh |
| Test failure | Ya |

---

## 9.2 Memory: full stack trace bisa besar

Satu exception dengan stack panjang tidak masalah. Ribuan exception per detik bisa menjadi masalah.

Sumber memory pressure:

- banyak `StackTraceElement`;
- string class/method/file;
- nested cause chain;
- suppressed exceptions;
- repeated logging;
- error aggregation retaining throwable.

Mitigasi:

- jangan gunakan exception untuk expected high-volume failure;
- rate limit logs;
- group errors;
- trim only for external presentation;
- preserve root diagnostic in secure storage.

---

## 9.3 Security: jangan leak internal stack ke client

Buruk:

```json
{
  "error": "java.sql.SQLException...",
  "stackTrace": [
    "com.company.caseengine.InternalDecisionService..."
  ]
}
```

Lebih baik:

```json
{
  "errorId": "ERR-2026-06-17-ABC123",
  "code": "CASE_PROCESSING_FAILED",
  "message": "The request could not be processed. Contact support with the error ID."
}
```

Internal log:

```text
ERROR errorId=ERR-2026-06-17-ABC123 caseId=... correlationId=...
java.lang.IllegalStateException: Missing transition rule
    at ...
```

---

## 9.4 Security: caller sensitivity

Caller-sensitive API adalah API yang behavior-nya bergantung pada pemanggil. Ini area sensitif karena wrapper bisa mengubah makna.

Dalam Java platform sendiri, beberapa operasi historically caller-sensitive untuk class loader/module/security checks.

Untuk aplikasi:

- hindari membuat API caller-sensitive kecuali benar-benar perlu;
- dokumentasikan jelas;
- test dengan direct call, wrapper, reflection, proxy;
- jangan gunakan untuk authorization domain;
- pertimbangkan explicit parameter.

---

## 9.5 Observability: stack + structured context

Stack trace tanpa context sering tidak cukup.

Minimum production context untuk error serius:

```text
timestamp
service name
version/build sha
environment
correlation id
trace id/span id
request path/operation
principal/tenant/case id if safe
error code
exception class
message
root cause
top application frame
full stack trace
```

Untuk regulatory/case management systems, tambahkan:

- case/application ID;
- workflow state;
- transition/action;
- actor type;
- agency/module;
- decision rule version;
- idempotency key;
- external system request ID.

---

## 10. Production Checklist

Gunakan checklist ini saat menulis utility stack/caller/error reporting.

### 10.1 Untuk stack inspection utility

- [ ] Tidak memakai magic index tanpa alasan kuat.
- [ ] Menggunakan `StackWalker` untuk Java 9+ jika baseline memungkinkan.
- [ ] Punya fallback aman `<unknown>`.
- [ ] Tidak dipakai untuk business decision utama.
- [ ] Tidak dipakai untuk authorization utama.
- [ ] Filter frame eksplisit dan terdokumentasi.
- [ ] Tidak capture stack jika log level disabled.
- [ ] Tidak dipanggil di hot path normal tanpa sampling.
- [ ] Tested dengan direct call, wrapper, reflection, lambda, proxy.

### 10.2 Untuk exception logging

- [ ] Cause tidak hilang saat wrapping.
- [ ] Suppressed exceptions tetap terlihat.
- [ ] Full stack trace disimpan di internal log/error backend.
- [ ] Public response tidak expose raw stack.
- [ ] Ada correlation/error ID.
- [ ] Ada stable error code.
- [ ] Sensitive data tidak masuk message/stack-adjacent metadata.
- [ ] Log tidak double-record exception di banyak layer tanpa nilai tambah.

### 10.3 Untuk performance

- [ ] Tidak membuat exception untuk expected high-volume branch.
- [ ] Stack walking tidak dilakukan di loop besar.
- [ ] Caller location logging lazy/rate-limited.
- [ ] Error grouping tidak memakai full stack exact equality.
- [ ] Long stack trace tidak disimpan di memory unbounded.

### 10.4 Untuk Java 8–25 compatibility

- [ ] Jika support Java 8, tidak direct reference `StackWalker` di class yang loaded Java 8.
- [ ] Jika memakai multi-release JAR, tested di Java 8/11/17/21/25.
- [ ] Tidak bergantung pada format string stack trace.
- [ ] Module/class loader info diperlakukan optional.
- [ ] Hidden/reflection frames tidak dianggap stable.

---

## 11. Latihan / Thought Exercise

### Latihan 1 — Debugging wrong caller

Kamu punya utility:

```java
public static String caller() {
    return Thread.currentThread().getStackTrace()[2].getClassName();
}
```

Awalnya benar. Setelah utility dibungkus oleh `Audit.logAction()`, caller berubah menjadi `Audit`.

Pertanyaan:

1. Kenapa ini terjadi?
2. Apakah menaikkan index ke `[3]` solusi yang benar?
3. Bagaimana desain yang lebih tahan refactor?

Jawaban inti:

- Stack index bergantung pada call path fisik.
- Mengubah ke `[3]` hanya memindahkan magic number.
- Gunakan explicit module/action parameter untuk domain. Jika tetap butuh diagnostic caller, gunakan `StackWalker` dengan filtering dan fallback.

---

### Latihan 2 — Error API response

Tim ingin mengirim full stack trace ke frontend agar QA mudah debug.

Pertanyaan:

1. Apa risikonya?
2. Alternatif yang lebih aman?

Jawaban inti:

- Risiko leak internal package, module, dependency, query, sensitive message.
- Kirim `errorId`, `code`, safe message. Simpan full stack di internal log yang bisa dicari dengan `errorId`.

---

### Latihan 3 — Stack capture in validation

Ada validator yang memanggil:

```java
String location = CallerLocations.capture();
```

untuk setiap field invalid dalam batch 1 juta record.

Pertanyaan:

1. Apa masalah performancenya?
2. Kapan location perlu dicapture?

Jawaban inti:

- Stack capture berulang di hot path akan mahal.
- Untuk validation error, lebih penting record ID, field path, rule ID. Caller location cukup pada startup/configuration warning, bukan setiap data error.

---

### Latihan 4 — Framework generated proxy

Sebuah method service dipanggil melalui proxy/AOP. Stack trace menunjukkan frame proxy dan interceptor sebelum method service.

Pertanyaan:

1. Apakah frame proxy harus selalu dihapus?
2. Kapan frame proxy penting?

Jawaban inti:

- Tidak selalu. Proxy frame bisa penting untuk transaction/security/cache behavior.
- Untuk UI simplified stack boleh disembunyikan, tetapi raw stack harus tetap tersedia untuk incident analysis.

---

## 12. Ringkasan

`StackTraceElement` dan `StackWalker` terlihat kecil, tetapi menyentuh banyak area penting:

- debugging;
- logging;
- tracing;
- testing;
- framework internals;
- security boundary;
- performance;
- Java 8–25 compatibility.

Mental model yang harus diingat:

1. Stack trace adalah **snapshot jalur eksekusi**, bukan domain truth.
2. `StackTraceElement` adalah **representasi metadata frame**, bukan live frame.
3. `Thread.getStackTrace()` mudah tetapi eager dan sering brittle.
4. `StackWalker` lebih modern, lazy, filterable, dan cocok untuk Java 9+.
5. Caller inference harus dianggap diagnostic convenience, bukan business contract.
6. Magic stack index adalah smell.
7. Stack capture punya cost; hindari di hot path normal.
8. Jangan expose raw stack trace ke client/public boundary.
9. Observability butuh stack **plus** structured context.
10. Untuk Java 8–25, pikirkan baseline compatibility dengan sadar.

Part ini selesai. Bagian berikutnya akan membahas:

> **Part 17 — `ClassLoader`, `Package`, `Module`, `Layer`: Runtime Boundaries and Encapsulation**

Di sana kita akan masuk ke salah satu sumber bug Java paling sulit: class identity, class loader hierarchy, module readability/exports/opens, context class loader, plugin/container boundary, dan class loader memory leak.

---

## Referensi

- Java SE 25 API — `java.lang.StackWalker`
- Java SE 25 API — `java.lang.StackWalker.StackFrame`
- Java SE 25 API — `java.lang.StackWalker.Option`
- Java SE 25 API — `java.lang.StackTraceElement`
- OpenJDK JEP 259 — Stack-Walking API
- Java SE 8 API — `Throwable`, `Thread`, `StackTraceElement` baseline compatibility
- Java Virtual Machine Specification — Frames
