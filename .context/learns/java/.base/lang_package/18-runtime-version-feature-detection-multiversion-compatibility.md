# Part 18 — `Runtime.Version`, Feature Detection, and Multi-Version Compatibility

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `18-runtime-version-feature-detection-multiversion-compatibility.md`  
> Scope: Java 8–25  
> Focus: runtime version model, feature detection, compatibility strategy, multi-release JARs, `--release`, optional APIs, and avoiding linkage/runtime traps.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas boundary runtime seperti `ClassLoader`, `Package`, `Module`, dan `ModuleLayer`. Sekarang kita masuk ke problem yang terlihat sederhana tetapi sering menjadi sumber bug serius pada library, platform internal, framework, dan aplikasi enterprise: **bagaimana menulis kode Java yang sadar versi runtime tanpa rapuh**.

Part ini membahas:

1. bagaimana Java merepresentasikan versi runtime secara modern;
2. kenapa `java.version` tidak boleh diparse sembarangan;
3. perbedaan Java 8 versioning dan Java 9+ versioning;
4. `Runtime.version()` dan `Runtime.Version`;
5. feature detection vs version detection;
6. `--source`, `--target`, dan `--release`;
7. multi-release JAR;
8. optional API access;
9. linkage error dan class initialization traps;
10. strategi membuat library yang tetap kompatibel dari Java 8 sampai Java 25.

Tujuan akhirnya bukan sekadar tahu method `Runtime.version()`, tetapi memahami **model kompatibilitas**:

> Production Java compatibility bukan hanya pertanyaan “jalan di Java berapa?”, tetapi kombinasi dari source compatibility, binary compatibility, runtime compatibility, module accessibility, behavior compatibility, dan operational supportability.

---

## 2. Kenapa Topik Ini Penting

Di sistem production, versi Java jarang seragam.

Contoh real-world:

- development pakai JDK 21;
- CI build image pakai JDK 17;
- production lama masih Java 11;
- library internal ingin support Java 8 karena beberapa service legacy;
- service baru ingin memakai Java 21 atau 25;
- security scanner menjalankan tool dengan JDK berbeda;
- Docker base image patch version berubah otomatis;
- vendor app server memakai embedded JVM berbeda;
- library transitive dependency diam-diam mulai memakai class Java 11+.

Bug yang muncul sering tidak terlihat saat compile, tetapi meledak saat runtime:

```text
java.lang.NoSuchMethodError
java.lang.NoClassDefFoundError
java.lang.UnsupportedClassVersionError
java.lang.IllegalAccessError
java.lang.IncompatibleClassChangeError
java.lang.ExceptionInInitializerError
java.lang.module.FindException
java.lang.reflect.InaccessibleObjectException
```

Sebagian dari error itu bukan “bug biasa”, melainkan tanda bahwa boundary kompatibilitas dilanggar.

---

## 3. Mental Model Utama

### 3.1 Kompatibilitas Java punya beberapa lapisan

Jangan menyederhanakan compatibility menjadi “versi Java”. Minimal ada 6 lapisan:

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. Source compatibility                                      │
│    Apakah source code dapat dikompilasi oleh compiler target? │
├──────────────────────────────────────────────────────────────┤
│ 2. Class file compatibility                                  │
│    Apakah bytecode dapat dibaca JVM target?                  │
├──────────────────────────────────────────────────────────────┤
│ 3. API availability                                          │
│    Apakah class/method yang dipakai ada di runtime target?    │
├──────────────────────────────────────────────────────────────┤
│ 4. Binary linkage compatibility                              │
│    Apakah simbol yang direferensikan bisa di-link runtime?    │
├──────────────────────────────────────────────────────────────┤
│ 5. Encapsulation/access compatibility                        │
│    Apakah module/package/reflection access diizinkan?         │
├──────────────────────────────────────────────────────────────┤
│ 6. Behavioral/operational compatibility                      │
│    Apakah behavior, default, GC, charset, security berubah?   │
└──────────────────────────────────────────────────────────────┘
```

Banyak engineer hanya mengecek lapisan 1 dan 2, padahal bug production sering terjadi di lapisan 3–6.

---

### 3.2 Version detection berbeda dari feature detection

**Version detection** bertanya:

```text
Runtime ini Java berapa?
```

**Feature detection** bertanya:

```text
Capability yang saya butuhkan tersedia dan bisa dipakai tidak?
```

Dalam banyak kasus, feature detection lebih aman.

Contoh:

- ingin tahu apakah `StackWalker` tersedia;
- ingin tahu apakah virtual thread tersedia;
- ingin tahu apakah module `java.xml` ada;
- ingin tahu apakah reflective access ke package tertentu dibuka;
- ingin tahu apakah parser XML mendukung feature tertentu;
- ingin tahu apakah method tertentu tersedia tanpa membuat class gagal load.

Version number memberi sinyal umum, tetapi bukan jaminan penuh karena:

- vendor/distribution bisa berbeda;
- backport bisa terjadi;
- feature bisa preview/incubator;
- security policy bisa berbeda;
- module bisa tidak ada di custom runtime image;
- API bisa ada tetapi aksesnya dibatasi;
- behavior bisa berubah walau API sama.

---

### 3.3 Compatibility harus diputuskan di build-time dan runtime

Untuk aplikasi, biasanya kita bisa menetapkan minimum runtime secara tegas:

```text
Service ini minimum Java 21.
```

Untuk library, sering perlu strategi lebih halus:

```text
Library core support Java 8.
Jika runtime Java 9+, gunakan StackWalker.
Jika runtime Java 11+, gunakan String.isBlank/strip bila tersedia.
Jika runtime Java 21+, aktifkan integrasi virtual-thread-aware.
```

Artinya, compatibility bukan hanya masalah coding. Ia adalah **product decision**.

---

## 4. Java Versioning: Dari Java 8 ke Java 9+

### 4.1 Legacy Java 8 style

Di Java 8, string versi sering terlihat seperti:

```text
1.8.0_202
1.8.0_352
```

Banyak kode lama melakukan parsing seperti ini:

```java
String version = System.getProperty("java.version");
if (version.startsWith("1.8")) {
    // Java 8
}
```

Masalahnya, pola ini tidak cocok untuk Java 9+.

---

### 4.2 Java 9+ version string scheme

Sejak Java 9, Java mengadopsi skema version string baru lewat JEP 223, lalu disesuaikan dengan time-based release versioning lewat JEP 322.

Contoh versi modern:

```text
9
11.0.22
17.0.10
21.0.4
25
25.0.1
```

Jadi angka utama bukan lagi `1.x`. Java 9 benar-benar `9`, Java 17 benar-benar `17`, Java 25 benar-benar `25`.

Konsekuensinya:

```java
System.getProperty("java.version").startsWith("1.")
```

adalah asumsi legacy.

---

### 4.3 Jangan hard-code versi dengan parser custom

Kode seperti ini rapuh:

```java
String version = System.getProperty("java.version");
int major = Integer.parseInt(version.split("\\.")[1]); // broken for Java 9+
```

Atau:

```java
String version = System.getProperty("java.version");
int major = Integer.parseInt(version.substring(0, 1)); // broken for 11, 17, 21, 25
```

Untuk Java 9+, gunakan:

```java
Runtime.Version version = Runtime.version();
int feature = version.feature();
```

Tetapi ingat: `Runtime.version()` sendiri tidak ada di Java 8.

---

## 5. `Runtime.version()` dan `Runtime.Version`

### 5.1 API dasar

Di Java 9+, `Runtime` menyediakan:

```java
Runtime.Version version = Runtime.version();
```

`Runtime.Version` merepresentasikan version string implementasi Java SE Platform.

Contoh:

```java
public final class RuntimeVersionDemo {
    public static void main(String[] args) {
        Runtime.Version version = Runtime.version();

        System.out.println("version      = " + version);
        System.out.println("feature      = " + version.feature());
        System.out.println("interim      = " + version.interim());
        System.out.println("update       = " + version.update());
        System.out.println("patch        = " + version.patch());
        System.out.println("pre          = " + version.pre().orElse(null));
        System.out.println("build        = " + version.build().orElse(null));
        System.out.println("optional     = " + version.optional().orElse(null));
    }
}
```

Pada runtime Java 25, `feature()` bernilai `25`.

---

### 5.2 Makna `feature`, `interim`, `update`, `patch`

Secara praktis:

```text
25.0.1
│  │ │
│  │ └── update/security/CPU-like update component
│  └──── interim component
└─────── feature release
```

Untuk mayoritas aplikasi, komponen paling penting adalah:

```java
Runtime.version().feature()
```

Karena ini memberi angka feature release utama: 8, 11, 17, 21, 25, dan seterusnya.

Namun untuk patch/security policy, kita kadang perlu tahu update version juga.

Contoh policy:

```text
Minimum supported runtime: Java 17.0.10 or Java 21.0.2.
```

Pada kasus seperti ini, hanya mengecek `feature()` tidak cukup.

---

### 5.3 `Runtime.Version.parse`

`Runtime.Version` juga punya parsing dan comparison.

Contoh:

```java
Runtime.Version min = Runtime.Version.parse("17.0.10");
Runtime.Version current = Runtime.version();

if (current.compareTo(min) < 0) {
    throw new IllegalStateException("Requires Java >= " + min + ", current=" + current);
}
```

Tetapi lagi-lagi, ini hanya tersedia Java 9+.

---

## 6. Mendukung Java 8 dan Java 9+ Sekaligus

### 6.1 Problem utama

Kalau source code kamu dikompilasi untuk Java 8, kode ini tidak bisa langsung dipakai:

```java
Runtime.Version version = Runtime.version();
```

Karena `Runtime.version()` belum ada di Java 8.

Jika library kamu harus compile dengan Java 8, kamu butuh fallback.

---

### 6.2 Parser minimal yang aman untuk Java 8–25

Untuk library Java 8-compatible, kamu masih perlu membaca property:

```java
public final class JavaVersion {
    private final int feature;
    private final String raw;

    private JavaVersion(int feature, String raw) {
        this.feature = feature;
        this.raw = raw;
    }

    public int feature() {
        return feature;
    }

    public String raw() {
        return raw;
    }

    public boolean isAtLeast(int requiredFeature) {
        return feature >= requiredFeature;
    }

    public static JavaVersion current() {
        String raw = System.getProperty("java.version", "");
        return new JavaVersion(parseFeature(raw), raw);
    }

    static int parseFeature(String version) {
        if (version == null || version.isEmpty()) {
            return 0;
        }

        // Java 8 and older: 1.8.0_xxx
        if (version.startsWith("1.")) {
            int secondDot = version.indexOf('.', 2);
            String feature = secondDot >= 0
                    ? version.substring(2, secondDot)
                    : version.substring(2);
            return parseLeadingNumber(feature);
        }

        // Java 9+: 9, 11.0.22, 17.0.10, 21, 25.0.1
        return parseLeadingNumber(version);
    }

    private static int parseLeadingNumber(String text) {
        int i = 0;
        while (i < text.length() && Character.isDigit(text.charAt(i))) {
            i++;
        }
        if (i == 0) {
            return 0;
        }
        return Integer.parseInt(text.substring(0, i));
    }

    @Override
    public String toString() {
        return raw + " (feature=" + feature + ")";
    }
}
```

Pemakaian:

```java
JavaVersion current = JavaVersion.current();

if (current.isAtLeast(17)) {
    System.out.println("Java 17+ runtime behavior can be enabled");
}
```

Ini bukan pengganti penuh `Runtime.Version`, tetapi cukup untuk feature-level branching pada Java 8-compatible code.

---

### 6.3 Jangan memanggil API baru langsung dari class Java 8-compatible

Misal kamu punya class yang dikompilasi target Java 8:

```java
public final class RuntimeInfo {
    public static int feature() {
        return Runtime.version().feature(); // tidak compile dengan Java 8 API
    }
}
```

Kalau kamu compile dengan JDK 17 tetapi target class Java 8 menggunakan `-target 8` tanpa `--release 8`, ada risiko compile berhasil tetapi runtime Java 8 gagal karena API tidak ada.

Solusinya:

- gunakan `--release 8` untuk baseline Java 8;
- pindahkan implementasi Java 9+ ke source set khusus;
- gunakan reflection hati-hati;
- gunakan multi-release JAR;
- atau naikkan minimum Java version.

---

## 7. `--source`, `--target`, dan `--release`

### 7.1 `--source`

`--source` mengatur bahasa Java yang diterima compiler.

Contoh:

```bash
javac --source 8 MyClass.java
```

Artinya source code tidak boleh memakai syntax Java lebih baru dari Java 8.

Contoh tidak boleh:

```java
var x = "hello"; // Java 10+
```

---

### 7.2 `--target`

`--target` mengatur versi class file yang dihasilkan.

Contoh:

```bash
javac --target 8 MyClass.java
```

Artinya bytecode yang dihasilkan ditargetkan agar bisa dibaca JVM Java 8.

Tetapi `--target` sendiri tidak cukup.

---

### 7.3 Problem klasik `--source 8 --target 8`

Dengan JDK modern, kode ini bisa compile jika hanya memakai `--source 8 --target 8`:

```java
public final class BrokenOnJava8 {
    public static boolean isBlank(String s) {
        return s.isBlank(); // String.isBlank baru ada Java 11
    }
}
```

Kenapa?

Karena compiler berjalan dengan bootclasspath JDK modern, sehingga melihat `String.isBlank()` tersedia.

Class file-nya bisa saja target Java 8, tetapi saat dijalankan di Java 8:

```text
java.lang.NoSuchMethodError: java.lang.String.isBlank()Z
```

Ini bug compatibility yang sangat umum.

---

### 7.4 `--release` adalah pilihan benar untuk target lama

Sejak JDK 9, `javac` menyediakan `--release`.

Contoh:

```bash
javac --release 8 MyClass.java
```

`--release 8` mengatur sekaligus:

1. source language level;
2. target class file version;
3. public API yang tersedia sesuai Java 8.

Jadi `String.isBlank()` akan gagal compile saat `--release 8`.

Inilah yang kita mau.

---

### 7.5 Build tool examples

#### Maven

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
  <configuration>
    <release>8</release>
  </configuration>
</plugin>
```

Untuk Java 21:

```xml
<configuration>
  <release>21</release>
</configuration>
```

#### Gradle

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

Catatan: toolchain compiler dan release target adalah dua hal berbeda.

---

## 8. Class File Version dan `UnsupportedClassVersionError`

Setiap rilis Java punya class file major version.

Contoh penting:

```text
Java 8  -> class file major 52
Java 11 -> class file major 55
Java 17 -> class file major 61
Java 21 -> class file major 65
Java 25 -> class file major 69
```

Jika class dikompilasi untuk Java 21 lalu dijalankan di Java 17, JVM Java 17 tidak bisa membaca class file itu.

Error:

```text
java.lang.UnsupportedClassVersionError:
  class file version 65.0, this version of the Java Runtime only recognizes class file versions up to 61.0
```

Mental model:

```text
JVM lama tidak bisa membaca bytecode masa depan.
JVM baru umumnya bisa membaca bytecode lama.
```

---

## 9. API Availability dan Linkage Error

### 9.1 Compile sukses bukan jaminan runtime sukses

Misal class dikompilasi target Java 8 tetapi accidentally refer ke API Java 11:

```java
public final class Texts {
    public static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
```

Jika lolos compile karena build salah, runtime Java 8 akan meledak:

```text
NoSuchMethodError: java.lang.String.isBlank()Z
```

Ini bukan `ClassNotFoundException`. Ini linkage failure.

---

### 9.2 Jenis linkage failure umum

```text
NoClassDefFoundError
    Class tersedia saat compile, tidak ada saat runtime.

NoSuchMethodError
    Method tersedia saat compile, tidak ada saat runtime.

NoSuchFieldError
    Field tersedia saat compile, tidak ada saat runtime.

IllegalAccessError
    Symbol ada, tapi akses binary tidak legal.

IncompatibleClassChangeError
    Bentuk class berubah tidak kompatibel.

UnsupportedClassVersionError
    Class file terlalu baru untuk JVM.
```

Semua ini biasanya menandakan:

```text
classpath/module-path runtime tidak cocok dengan classpath compile-time
atau target Java tidak benar-benar dipatuhi.
```

---

## 10. Feature Detection yang Aman

### 10.1 Prinsip

Feature detection harus memenuhi dua syarat:

1. tidak membuat class gagal load pada runtime lama;
2. tidak membuat static initializer memanggil API yang tidak tersedia.

Jangan taruh referensi API baru di class yang pasti di-load pada Java lama.

---

### 10.2 Contoh buruk

```java
public final class RuntimeFeatures {
    private static final boolean HAS_STACK_WALKER = StackWalker.getInstance() != null;

    public static boolean hasStackWalker() {
        return HAS_STACK_WALKER;
    }
}
```

Jika class ini dijalankan pada Java 8, `StackWalker` tidak ada. Class loading bisa gagal sebelum method dipakai.

---

### 10.3 Contoh lebih aman dengan reflection by name

```java
public final class FeatureDetector {
    private FeatureDetector() {}

    public static boolean hasClass(String className) {
        try {
            Class.forName(className, false, FeatureDetector.class.getClassLoader());
            return true;
        } catch (ClassNotFoundException e) {
            return false;
        } catch (LinkageError e) {
            return false;
        }
    }

    public static boolean hasStackWalker() {
        return hasClass("java.lang.StackWalker");
    }
}
```

Perhatikan:

```java
Class.forName(className, false, loader)
```

Argumen `false` berarti tidak memaksa class initialization.

---

### 10.4 Detect method availability

```java
public static boolean hasStringIsBlank() {
    try {
        String.class.getMethod("isBlank");
        return true;
    } catch (NoSuchMethodException e) {
        return false;
    } catch (SecurityException e) {
        return false;
    }
}
```

Namun jangan langsung memanggil method baru dari class Java 8-compatible kecuali lewat isolasi yang aman.

---

## 11. Optional API Access Pattern

### 11.1 Pattern: interface + implementation selection

Misal kamu ingin memakai `StackWalker` pada Java 9+, tetapi fallback ke `Throwable().getStackTrace()` pada Java 8.

Buat interface umum:

```java
public interface CallerResolver {
    String callerClassName();
}
```

Implementasi Java 8-safe:

```java
public final class ThrowableCallerResolver implements CallerResolver {
    @Override
    public String callerClassName() {
        StackTraceElement[] frames = new Throwable().getStackTrace();
        return frames.length > 2 ? frames[2].getClassName() : "<unknown>";
    }
}
```

Implementasi Java 9+:

```java
public final class StackWalkerCallerResolver implements CallerResolver {
    private final StackWalker walker = StackWalker.getInstance();

    @Override
    public String callerClassName() {
        return walker.walk(stream -> stream
                .skip(2)
                .findFirst()
                .map(StackWalker.StackFrame::getClassName)
                .orElse("<unknown>"));
    }
}
```

Factory:

```java
public final class CallerResolvers {
    private CallerResolvers() {}

    public static CallerResolver create() {
        if (JavaVersion.current().isAtLeast(9)) {
            try {
                Class<?> impl = Class.forName("com.example.StackWalkerCallerResolver");
                return (CallerResolver) impl.getConstructor().newInstance();
            } catch (ReflectiveOperationException | LinkageError ignored) {
                return new ThrowableCallerResolver();
            }
        }
        return new ThrowableCallerResolver();
    }
}
```

Masalahnya: class `StackWalkerCallerResolver` tidak boleh ada sebagai class Java 8 bytecode yang direct-reference `StackWalker` jika build target Java 8 biasa. Solusi elegan: **multi-release JAR**.

---

## 12. Multi-Release JAR

### 12.1 Mental model

Multi-release JAR memungkinkan satu JAR berisi class baseline dan class khusus untuk versi Java tertentu.

Struktur konseptual:

```text
my-library.jar
├── com/example/CallerResolver.class          # baseline, misal Java 8
├── com/example/CallerResolvers.class         # baseline
├── com/example/RuntimeFeature.class          # baseline
└── META-INF/versions/9/
    └── com/example/RuntimeFeature.class      # override untuk Java 9+
```

Pada Java 8, JVM membaca class baseline.

Pada Java 9+, runtime dapat memilih class di `META-INF/versions/9/` jika manifest menyatakan multi-release.

---

### 12.2 Manifest

Manifest perlu menyertakan:

```text
Multi-Release: true
```

---

### 12.3 Use case yang tepat

Multi-release JAR cocok untuk library yang ingin:

- tetap support Java 8;
- memakai API Java 9+ jika tersedia;
- menghindari reflection berlebihan;
- menjaga API publik tetap sama;
- mengoptimalkan runtime modern.

Contoh:

```text
Baseline Java 8:
- pakai Throwable stack trace
- tidak memakai Module API
- tidak memakai ProcessHandle

Java 9+ override:
- pakai StackWalker
- pakai Module API
- pakai ProcessHandle
```

---

### 12.4 Risiko multi-release JAR

MRJAR bukan gratis.

Risiko:

- build lebih kompleks;
- testing matrix lebih besar;
- classpath tools lama bisa tidak sadar multi-release;
- shading/relocation bisa rusak;
- static analysis bisa salah membaca class version;
- debugging class yang dipakai runtime bisa membingungkan;
- public API harus tetap kompatibel antar versi.

Gunakan hanya jika manfaatnya jelas.

---

## 13. Runtime Feature Matrix Java 8–25

Berikut peta fitur relevan untuk seri ini.

| Java | Area penting untuk seri ini | Implikasi compatibility |
|---:|---|---|
| 8 | baseline legacy; no module; no `Runtime.version`; no `StackWalker`; no records/sealed | butuh parser versi manual jika support 8 |
| 9 | JPMS, `Runtime.Version`, `StackWalker`, MRJAR, compact strings, `ProcessHandle` | boundary module/classloader berubah besar |
| 10 | `var` local inference | source-level only, tidak otomatis runtime API besar |
| 11 | `String.isBlank`, `strip`, `lines`, HTTP client outside scope | API availability trap jika target 8 |
| 14 | helpful NPE introduced as feature line | behavior diagnostic berubah |
| 16 | records finalized | runtime has `java.lang.Record` |
| 17 | sealed classes finalized; LTS | common modern baseline |
| 21 | virtual threads finalized; LTS | `Thread` semantics/cost model berubah |
| 25 | LTS; Java 25 feature release | current upper bound seri |

Catatan: tabel ini bukan daftar semua fitur Java. Ini hanya fitur yang relevan terhadap `java.lang`, runtime compatibility, dan seri DOM/SAX.

---

## 14. Minimum Runtime Policy

### 14.1 Aplikasi vs library

Untuk aplikasi internal:

```text
Pilih satu minimum Java version dan enforce keras.
```

Contoh:

```text
Minimum runtime: Java 21.0.4
Build with: JDK 21 toolchain
Compile release: 21
Runtime image: pinned digest
```

Untuk library:

```text
Pisahkan baseline dan enhancement.
```

Contoh:

```text
Core artifact: Java 8 baseline
Modern artifact: Java 17 baseline
Optional MRJAR: Java 9+/17+ enhancements
```

---

### 14.2 Jangan over-support versi lama tanpa alasan

Mendukung Java 8–25 terdengar hebat, tetapi mahal.

Biayanya:

- CI matrix lebih besar;
- dependency choices terbatas;
- tidak bisa memakai banyak API modern;
- security patching lebih sulit;
- internal abstraction bertambah;
- testing lebih kompleks;
- bug compatibility lebih banyak.

Pertanyaan desain:

```text
Apakah user runtime Java 8 benar-benar ada?
Apakah mereka membayar kompleksitas yang muncul?
Apakah ada compliance/vendor constraint?
Apakah library ini infrastructure-critical?
```

Top engineer tidak otomatis support semua versi. Top engineer menetapkan **compatibility contract yang eksplisit dan defensible**.

---

## 15. Startup Guard Pattern

Untuk aplikasi, gunakan startup guard agar gagal cepat jika runtime salah.

```java
public final class RuntimeGuard {
    private RuntimeGuard() {}

    public static void requireJavaFeatureAtLeast(int required) {
        int current = currentFeature();
        if (current < required) {
            throw new IllegalStateException(
                    "Unsupported Java runtime. Required Java " + required +
                    "+, current java.version=" + System.getProperty("java.version") +
                    ", java.vendor=" + System.getProperty("java.vendor") +
                    ", java.home=" + System.getProperty("java.home"));
        }
    }

    private static int currentFeature() {
        try {
            // Java 9+ path via reflection to keep source Java 8-compatible.
            Object version = Runtime.class.getMethod("version").invoke(null);
            Object feature = version.getClass().getMethod("feature").invoke(version);
            return ((Number) feature).intValue();
        } catch (ReflectiveOperationException | LinkageError e) {
            return JavaVersion.current().feature();
        }
    }
}
```

Pemakaian:

```java
public final class Main {
    public static void main(String[] args) {
        RuntimeGuard.requireJavaFeatureAtLeast(21);
        // start app
    }
}
```

Untuk aplikasi yang memang minimum Java 21, kamu tidak perlu Java 8-compatible reflection. Langsung gunakan:

```java
if (Runtime.version().feature() < 21) {
    throw new IllegalStateException("Requires Java 21+");
}
```

---

## 16. Dependency Compatibility

### 16.1 Transitive dependency bisa menaikkan minimum Java diam-diam

Aplikasi kamu mungkin compile dengan Java 8, tetapi dependency versi baru dikompilasi Java 11+.

Gejala:

```text
UnsupportedClassVersionError
```

Atau dependency memakai API baru sehingga muncul:

```text
NoSuchMethodError
NoClassDefFoundError
```

Praktik defensif:

- lock dependency version;
- baca release notes dependency;
- enforce bytecode version check di CI;
- jalankan test pada runtime minimum;
- gunakan Maven Enforcer/Gradle plugin untuk bytecode target;
- jangan hanya test di JDK terbaru.

---

### 16.2 Maven Enforcer contoh

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce-java</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <requireJavaVersion>
            <version>[21,)</version>
          </requireJavaVersion>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Untuk library Java 8, gunakan juga bytecode compatibility checker.

---

## 17. Module Compatibility Sejak Java 9

### 17.1 Classpath vs module-path

Java 8 hanya mengenal classpath.

Java 9+ memperkenalkan module-path.

Library yang sama bisa mengalami behavior berbeda tergantung dijalankan sebagai:

```text
classpath unnamed module
```

atau:

```text
named module di module-path
```

Masalah umum:

- reflective access tidak lagi bebas;
- package tidak diexport;
- package tidak dibuka untuk deep reflection;
- split package gagal;
- automatic module name berubah;
- service loading berbeda.

---

### 17.2 `module-info.class` dan Java 8

Jika JAR berisi `module-info.class` di root, Java 8 tidak mengenal class itu sebagai module descriptor tetapi umumnya mengabaikannya sebagai class biasa? Praktiknya lebih aman menaruh `module-info.class` di multi-release path:

```text
META-INF/versions/9/module-info.class
```

Ini pola umum untuk library yang baseline Java 8 tetapi menyediakan module descriptor untuk Java 9+.

---

## 18. Behavior Compatibility: API Sama, Behavior Bisa Berubah

Compatibility bukan hanya class/method ada.

Contoh behavior yang berubah di Java 8–25:

- compact strings mengubah internal representation `String` sejak Java 9;
- module system mengubah reflective access;
- default charset menjadi UTF-8 sejak Java 18;
- finalization dideprecate for removal dan makin tidak layak jadi lifecycle hook;
- Security Manager deprecated/disabled/removal path;
- virtual threads mengubah cost model `Thread`;
- garbage collector defaults berubah dari waktu ke waktu;
- container awareness membaik dan memengaruhi CPU/memory view;
- TLS/certificate/security defaults bisa berubah dalam update release.

Pelajaran:

```text
Jangan desain production logic yang bergantung pada implementation detail atau default global tanpa eksplisit.
```

---

## 19. Compatibility Checklist untuk Library Java 8–25

Gunakan checklist ini saat membuat library internal.

### 19.1 Build

- [ ] Tentukan minimum Java version secara eksplisit.
- [ ] Gunakan `--release`, bukan hanya `source/target`.
- [ ] Jalankan test di runtime minimum.
- [ ] Jalankan test di runtime modern utama, misal 17/21/25.
- [ ] Cek bytecode dependency.
- [ ] Jangan compile baseline dengan API lebih baru.
- [ ] Jika MRJAR, test semua variant.

### 19.2 API design

- [ ] Jangan expose type yang hanya ada di Java baru jika baseline lama.
- [ ] Jangan expose `Optional`/record/sealed jika baseline tidak mendukung.
- [ ] Pisahkan API publik dari implementation modern.
- [ ] Jangan membuat public method behavior bergantung diam-diam pada runtime version tanpa dokumentasi.

### 19.3 Runtime

- [ ] Fail fast bila minimum runtime tidak terpenuhi.
- [ ] Log `java.version`, `java.vendor`, `java.home`, `os.name`, `os.arch` saat startup.
- [ ] Untuk custom runtime image, cek module availability.
- [ ] Jangan assume semua Java distribution identik.

### 19.4 Reflection/module

- [ ] Hindari deep reflection ke JDK internals.
- [ ] Tangani `InaccessibleObjectException` pada Java 9+.
- [ ] Dokumentasikan kebutuhan `--add-opens` bila tidak bisa dihindari.
- [ ] Jangan bergantung pada internal package `sun.*`, `com.sun.*`, `jdk.internal.*`.

### 19.5 Operations

- [ ] Pin Docker base image.
- [ ] Pin minor/security patch bila compliance membutuhkan.
- [ ] Monitor CVE dan CPU releases.
- [ ] Hindari auto-upgrade tanpa test matrix.
- [ ] Simpan runtime info di health endpoint atau startup diagnostics.

---

## 20. Compatibility Checklist untuk Aplikasi

Untuk aplikasi production, checklist-nya lebih tegas.

- [ ] Minimum Java version tertulis di README/runbook.
- [ ] CI menggunakan JDK yang sama dengan production atau kompatibel.
- [ ] Docker image menggunakan runtime yang dipin.
- [ ] Build menggunakan `--release` sesuai runtime target.
- [ ] Startup guard memverifikasi runtime.
- [ ] Dependency lock aktif.
- [ ] Integration test berjalan pada runtime production-like.
- [ ] Observability mencatat runtime version.
- [ ] Upgrade Java diuji sebagai perubahan platform, bukan dependency kecil.
- [ ] Rollback strategy tersedia.

---

## 21. Practical Pattern: Runtime Info Snapshot

Buat snapshot runtime untuk diagnostics.

```java
import java.util.LinkedHashMap;
import java.util.Map;

public final class RuntimeSnapshot {
    private RuntimeSnapshot() {}

    public static Map<String, String> capture() {
        Map<String, String> m = new LinkedHashMap<>();
        put(m, "java.version");
        put(m, "java.vendor");
        put(m, "java.vendor.version");
        put(m, "java.runtime.name");
        put(m, "java.runtime.version");
        put(m, "java.vm.name");
        put(m, "java.vm.version");
        put(m, "java.home");
        put(m, "os.name");
        put(m, "os.version");
        put(m, "os.arch");
        m.put("availableProcessors", String.valueOf(Runtime.getRuntime().availableProcessors()));
        m.put("maxMemory", String.valueOf(Runtime.getRuntime().maxMemory()));
        return m;
    }

    private static void put(Map<String, String> map, String key) {
        map.put(key, System.getProperty(key, ""));
    }
}
```

Contoh output:

```text
java.version=25.0.1
java.vendor=Eclipse Adoptium
java.runtime.name=OpenJDK Runtime Environment
java.vm.name=OpenJDK 64-Bit Server VM
os.name=Linux
os.arch=amd64
availableProcessors=4
maxMemory=2147483648
```

Jangan log environment variable penuh karena bisa mengandung secret.

---

## 22. Practical Pattern: Safe Optional Method Invocation

Kadang kita ingin memakai method baru jika tersedia tanpa menaikkan baseline.

Contoh: `String.isBlank()` Java 11+ fallback Java 8.

```java
import java.lang.reflect.Method;

public final class BlankSupport {
    private static final Method STRING_IS_BLANK = findStringIsBlank();

    private BlankSupport() {}

    public static boolean isBlank(String value) {
        if (value == null) {
            return true;
        }

        Method method = STRING_IS_BLANK;
        if (method != null) {
            try {
                return (Boolean) method.invoke(value);
            } catch (ReflectiveOperationException | RuntimeException e) {
                // fallback intentionally
            }
        }

        for (int i = 0; i < value.length(); i++) {
            if (!Character.isWhitespace(value.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    private static Method findStringIsBlank() {
        try {
            return String.class.getMethod("isBlank");
        } catch (NoSuchMethodException e) {
            return null;
        }
    }
}
```

Trade-off:

- reflection overhead;
- fallback semantics mungkin tidak 100% sama;
- testing harus membandingkan behavior;
- untuk hot path lebih baik punya implementation per version atau baseline sendiri.

---

## 23. Better Pattern: Jangan Pakai API Baru Jika Fallback Sederhana Cukup

Untuk `String.isBlank`, fallback manual mungkin lebih baik daripada reflection.

```java
public static boolean isBlankPortable(String value) {
    if (value == null) {
        return true;
    }
    for (int i = 0; i < value.length(); i++) {
        if (!Character.isWhitespace(value.charAt(i))) {
            return false;
        }
    }
    return true;
}
```

Pertanyaan desain:

```text
Apakah perlu memakai API baru?
Atau cukup implementasi portable yang jelas?
```

Top engineer tidak mengejar API terbaru jika portability lebih penting dan behavior bisa dibuat jelas.

---

## 24. Failure Modes

### 24.1 Parsing version string salah

Gejala:

```text
Java 17 dianggap Java 1
Java 21 dianggap Java 2
Java 25 dianggap Java 2
```

Penyebab:

```java
version.substring(0, 1)
```

atau parser legacy `1.x`.

---

### 24.2 Compile target lama, API baru bocor

Gejala:

```text
NoSuchMethodError
NoClassDefFoundError
```

Penyebab:

```bash
javac -source 8 -target 8
```

tanpa `--release 8`.

---

### 24.3 Dependency terlalu baru

Gejala:

```text
UnsupportedClassVersionError
```

Penyebab:

Dependency dikompilasi untuk Java 17, aplikasi jalan di Java 11.

---

### 24.4 Class yang berisi API baru ter-load pada runtime lama

Gejala:

```text
NoClassDefFoundError: java/lang/StackWalker
```

Penyebab:

Class baseline direct-reference `StackWalker`.

---

### 24.5 Module access berubah

Gejala:

```text
InaccessibleObjectException
IllegalAccessError
```

Penyebab:

Deep reflection ke package yang tidak `opens`.

---

### 24.6 Relying on defaults

Gejala:

- encoding berubah;
- date/time parse beda;
- file path behavior beda;
- TLS behavior beda;
- performance berubah setelah Java upgrade.

Penyebab:

Kode bergantung pada default runtime/OS/JDK distribution.

---

## 25. Decision Framework: Version Detection atau Feature Detection?

Gunakan tabel ini.

| Kebutuhan | Lebih cocok | Alasan |
|---|---|---|
| Minimum supported Java untuk aplikasi | version detection | fail fast jelas |
| Mengaktifkan API optional di library | feature detection | lebih adaptif |
| Memilih code path MRJAR | runtime selection | diselesaikan oleh JVM/JAR mechanism |
| Menentukan security patch minimum | exact version comparison | feature saja tidak cukup |
| Menghindari API tidak tersedia | `--release` + test runtime minimum | build-time enforcement lebih baik |
| Cek module custom image | feature/module detection | version tidak menjamin module ada |
| XML parser feature | parser feature detection | vendor/parser bisa berbeda |

---

## 26. Relation ke DOM/SAX dan `java.xml`

Walau part ini berada di area `java.lang`, compatibility ini sangat relevan untuk DOM/SAX.

Kenapa?

Karena XML parsing di Java bergantung pada:

- module `java.xml`;
- JAXP factory behavior;
- parser implementation;
- secure processing features;
- entity expansion limits;
- system properties;
- vendor/runtime defaults;
- Security Manager history;
- module accessibility.

Pada Java 9+ custom runtime image, tidak semua module harus ada. Aplikasi yang memakai DOM/SAX perlu memastikan `java.xml` tersedia.

Contoh module descriptor:

```java
module com.example.xmlapp {
    requires java.xml;
}
```

Untuk classpath app, biasanya module `java.xml` tersedia di full JDK/JRE image. Tetapi pada custom `jlink` image, dependency module harus jelas.

---

## 27. Exercises

### Exercise 1 — Deteksi bug parser versi

Apa hasil kode berikut pada Java 17?

```java
String version = System.getProperty("java.version");
int major = Integer.parseInt(version.substring(0, 1));
System.out.println(major);
```

Pertanyaan:

1. Kenapa salah?
2. Bagaimana memperbaikinya untuk Java 8–25?
3. Kapan lebih baik memakai `Runtime.version()`?

---

### Exercise 2 — API leak

Library kamu ingin support Java 8, tetapi ada kode:

```java
public static boolean blank(String s) {
    return s == null || s.isBlank();
}
```

Pertanyaan:

1. Apakah ini compile dengan JDK 17?
2. Apakah jalan di Java 8?
3. Build flag apa yang harus dipakai?
4. Apa fallback implementation yang aman?

---

### Exercise 3 — MRJAR decision

Library internal ingin support Java 8, tetapi pada Java 9+ ingin memakai `StackWalker`.

Pertanyaan:

1. Apakah reflection cukup?
2. Apakah MRJAR lebih baik?
3. Apa biaya testing-nya?
4. Bagaimana menjaga public API tetap stabil?

---

### Exercise 4 — Production runtime guard

Service kamu minimum Java 21.

Desain:

1. startup guard;
2. error message;
3. runtime info logging;
4. CI matrix;
5. Docker image policy.

---

## 28. Ringkasan

Hal terpenting dari part ini:

1. Java compatibility bukan satu dimensi.
2. `Runtime.version()` dan `Runtime.Version` adalah cara modern membaca versi Java 9+.
3. Java 8 butuh fallback jika library masih support Java 8.
4. Jangan parse `java.version` dengan asumsi `1.x`.
5. Gunakan `--release`, bukan hanya `--source` dan `--target`.
6. `UnsupportedClassVersionError` berarti bytecode terlalu baru.
7. `NoSuchMethodError`/`NoClassDefFoundError` sering berarti API compile-time tidak ada di runtime.
8. Feature detection lebih cocok untuk optional capability.
9. Version detection lebih cocok untuk minimum runtime contract.
10. Multi-release JAR berguna tetapi menambah kompleksitas.
11. Module system sejak Java 9 menambah dimensi compatibility baru.
12. Untuk DOM/SAX, module `java.xml`, parser features, dan runtime defaults harus dianggap bagian dari compatibility contract.

Mental model akhirnya:

```text
Compatibility adalah kontrak lintas waktu.
Build menentukan apa yang boleh kamu tulis.
Bytecode menentukan JVM mana yang bisa membaca.
Runtime menentukan API mana yang tersedia.
Module system menentukan akses mana yang legal.
Behavior menentukan apakah sistem tetap benar setelah upgrade.
```

---

## 29. Production Checklist Singkat

Sebelum menutup part ini, gunakan checklist berikut:

- [ ] Minimum Java version eksplisit.
- [ ] Build menggunakan `--release`.
- [ ] Runtime minimum dites di CI.
- [ ] Runtime terbaru yang ditargetkan dites di CI.
- [ ] Dependency bytecode version dicek.
- [ ] Startup diagnostics mencatat Java vendor/version.
- [ ] Optional API tidak direferensikan langsung dari baseline lama.
- [ ] Reflection/module access diuji pada Java 9+.
- [ ] MRJAR hanya dipakai jika benar-benar bernilai.
- [ ] Upgrade Java diperlakukan sebagai perubahan platform.

---

## 30. Posisi Part Ini dalam Seri

Part ini menutup cluster besar `java.lang` runtime-boundary sebelum masuk ke topik global state, math, annotations, lambda/runtime support, dan resource cleanup.

Kita sudah punya fondasi untuk memahami:

- apa itu runtime;
- bagaimana versi runtime dibaca;
- bagaimana class/API tersedia atau tidak;
- bagaimana build salah bisa membuat runtime error;
- bagaimana menulis library lintas Java 8–25 secara defensible.

Part berikutnya akan masuk ke global state dan environment boundary:

```text
Part 19 — Global State, Properties, Environment, Locale Boundary, and Design
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — `ClassLoader`, `Package`, `Module`, `Layer`: Runtime Boundaries and Encapsulation](./17-classloader-package-module-layer-runtime-boundaries.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — Global State, Properties, Environment, Locale Boundary, and Design](./19-global-state-properties-environment-locale-boundary-design.md)
