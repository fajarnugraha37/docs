# Part 32 — Capstone: Build a Production-Grade Runtime/XML Utility Layer

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `32-capstone-production-grade-runtime-xml-utility-layer.md`  
> Scope: Java 8–25, `java.lang.*`, `org.w3c.dom.*`, `org.xml.sax.*`, and selected JAXP integration boundaries required to make DOM/SAX usable safely in production.

---

## 1. Tujuan Part Ini

Part ini adalah **capstone**. Kita tidak lagi membahas satu class secara terpisah, tetapi menyatukan mental model dari seluruh seri menjadi satu desain utility layer yang layak dipakai di codebase production.

Target akhirnya: kamu mampu merancang library internal kecil yang menangani:

1. runtime introspection;
2. Java version/capability detection;
3. safe process execution;
4. exception/failure taxonomy;
5. string/text boundary handling;
6. safe XML parser factory untuk DOM dan SAX;
7. DOM extraction yang namespace-aware dan tidak ambigu;
8. SAX streaming importer untuk dokumen besar;
9. auditability dan observability;
10. compatibility Java 8–25.

Capstone ini sengaja tidak membuat framework besar. Seorang engineer senior/top-tier tidak selalu membuat abstraction besar. Yang penting adalah membuat **boundary layer yang kecil, eksplisit, testable, secure, dan defensible**.

---

## 2. Mental Model Utama

### 2.1 Utility layer bukan tempat membuang helper acak

Banyak codebase punya package bernama `utils`, `common`, atau `helpers` yang lama-lama berubah menjadi tempat sampah:

```text
utils/
  StringUtils.java
  XmlUtils.java
  DateUtils.java
  CommonUtils.java
  GeneralUtils.java
  MiscUtils.java
```

Masalahnya bukan nama `Utils` semata. Masalahnya adalah tidak ada boundary, invariant, ownership, dan threat model.

Utility layer yang bagus harus menjawab:

```text
Apa boundary yang dilindungi?
Apa invariant yang dijamin?
Apa failure yang dinormalisasi?
Apa yang sengaja tidak dilakukan?
Apa API contract-nya?
Apa compatibility target-nya?
```

Untuk seri ini, utility layer yang kita bangun bukan “helper random”, tetapi **runtime and XML boundary layer**.

---

### 2.2 `java.lang` adalah runtime contract; DOM/SAX adalah data boundary contract

Dari seluruh seri, kita bisa menyederhanakan mental model seperti ini:

```text
java.lang
  = kontrak dasar object, type, text, failure, runtime, process, module, thread, stack.

org.w3c.dom
  = kontrak tree XML mutable in-memory.

org.xml.sax
  = kontrak event XML streaming parser-driven.
```

Jika digabung:

```text
Runtime/XML Utility Layer
  = layer yang membuat interaksi dengan runtime dan XML menjadi eksplisit, aman, observable, dan portable.
```

---

### 2.3 Top 1% engineer berpikir dengan invariants, bukan method list

Method list itu mudah dicari. Yang susah adalah tahu **apa yang harus selalu benar**.

Contoh invariant:

```text
RuntimeInfo:
  - tidak membaca system properties di static initializer yang sulit dites.
  - tidak menganggap availableProcessors sebagai jumlah CPU fisik.
  - tidak menganggap java.version bisa di-parse manual untuk semua versi.

ProcessExecutor:
  - tidak menerima command sebagai satu string shell mentah.
  - selalu menguras stdout/stderr.
  - selalu punya timeout.
  - selalu mengembalikan structured result.

XmlFactories:
  - secure by default.
  - namespace-aware by default.
  - external entity/resource access disabled unless explicitly allowed.
  - parser feature unsupported harus gagal jelas atau dicatat secara eksplisit.

DomExtractor:
  - query namespace-aware.
  - missing, empty, multiple elements dibedakan.
  - NodeList live tidak diekspos sebagai API utama.

SaxImporter:
  - state machine explicit.
  - characters() fragmentation handled.
  - location info captured.
  - partial failure report structured.
```

---

## 3. Problem Statement: Kenapa Kita Butuh Layer Ini?

Bayangkan sebuah enterprise system menerima XML besar dari agency eksternal, menjalankan command kecil untuk file conversion, dan perlu mengumpulkan runtime diagnostics saat incident.

Tanpa utility layer, code bisa tersebar seperti ini:

```java
DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
Document d = f.newDocumentBuilder().parse(file);
String status = d.getElementsByTagName("status").item(0).getTextContent();
Runtime.getRuntime().exec("convert " + input + " " + output);
String javaVersion = System.getProperty("java.version").split("\\.")[0];
```

Kode seperti itu punya banyak risiko:

1. XML parser mungkin rentan XXE/entity expansion.
2. DOM query tidak namespace-aware.
3. `item(0)` bisa NPE.
4. `getTextContent()` bisa mengambil text descendant yang tidak dimaksud.
5. `exec(String)` raw command rawan quoting/command injection.
6. stdout/stderr process bisa deadlock jika tidak dikuras.
7. parsing `java.version` manual bisa salah lintas Java 8–25.
8. tidak ada audit trail structured.
9. tidak ada error taxonomy.
10. incident sulit di-debug.

Utility layer yang baik membuat hal-hal berbahaya menjadi sulit dilakukan, dan hal-hal benar menjadi mudah dilakukan.

---

## 4. Target Desain Library

Kita akan desain library internal bernama:

```text
com.acme.platform.boundary
```

Struktur package:

```text
com.acme.platform.boundary.runtime
  RuntimeInfo.java
  RuntimeInfoProvider.java
  JavaVersion.java
  CapabilityDetector.java
  SystemPropertyReader.java

com.acme.platform.boundary.process
  ProcessCommand.java
  ProcessExecutor.java
  ProcessResult.java
  ProcessFailureException.java

com.acme.platform.boundary.text
  Texts.java
  TextBoundary.java
  CanonicalText.java

com.acme.platform.boundary.failure
  PlatformFailure.java
  FailureCategory.java
  FailureSeverity.java
  FailureClassifier.java

com.acme.platform.boundary.xml
  XmlSecurityProfile.java
  XmlParserFactoryProvider.java
  XmlParseException.java
  XmlLocation.java
  XmlIssue.java

com.acme.platform.boundary.xml.dom
  DomDocuments.java
  DomExtractor.java
  DomElement.java
  DomReadException.java

com.acme.platform.boundary.xml.sax
  SaxParsers.java
  SaxStateMachine.java
  SaxImportResult.java
  SaxImportException.java
```

Namun dalam capstone ini kita tidak perlu menulis semua implementasi penuh. Kita akan membangun blueprint dan contoh kode inti yang cukup realistis.

---

## 5. Design Principle

### 5.1 Secure by default

Default API harus aman. Mode tidak aman harus eksplisit.

Buruk:

```java
DocumentBuilderFactory factory = XmlUtils.newFactory();
```

Tidak jelas aman atau tidak.

Lebih baik:

```java
DocumentBuilderFactory factory = XmlParserFactoryProvider.secureDomFactory();
```

Lebih baik lagi:

```java
DocumentBuilderFactory factory = XmlParserFactoryProvider.domFactory(XmlSecurityProfile.untrustedInput());
```

API-nya mengkomunikasikan threat model.

---

### 5.2 Explicit over magical

Jangan sembunyikan keputusan berbahaya.

Contoh:

```java
XmlSecurityProfile profile = XmlSecurityProfile.untrustedInput()
    .rejectDoctype(true)
    .allowExternalDtd(false)
    .allowExternalSchema(false)
    .namespaceAware(true);
```

Konfigurasi terlihat panjang, tetapi ini bagus untuk boundary security.

---

### 5.3 Structured result over stringly failure

Buruk:

```java
return "ERROR: missing status";
```

Lebih baik:

```java
return XmlIssue.missingRequiredElement(location, "status");
```

Atau:

```java
throw new XmlParseException(
    FailureCategory.INVALID_INPUT,
    "Missing required element: status",
    location
);
```

---

### 5.4 No hidden global dependency

Buruk:

```java
class RuntimeInfo {
    static final String VERSION = System.getProperty("java.version");
}
```

Ini menyulitkan test, reload config, dan predictable behavior.

Lebih baik:

```java
interface SystemPropertyReader {
    String get(String name);
}
```

Default implementasi boleh membaca `System.getProperty`, tetapi domain logic tidak tergantung langsung ke global state.

---

### 5.5 Snapshot mutable structures before exposing

DOM `NodeList` bersifat live. Jangan expose langsung sebagai API utility.

Buruk:

```java
public static NodeList children(Element element) { ... }
```

Lebih baik:

```java
public static List<Element> childElements(Element parent) { ... }
```

---

## 6. Architecture Overview

Layer desain:

```text
Application / Domain Import Use Case
        |
        v
Boundary API
  - RuntimeInfoProvider
  - ProcessExecutor
  - DomExtractor
  - SaxImporter
        |
        v
JDK API
  - java.lang.System / Runtime / ProcessBuilder / Class / Module
  - javax.xml.parsers.DocumentBuilderFactory / SAXParserFactory
  - org.w3c.dom.*
  - org.xml.sax.*
        |
        v
JVM / OS / XML Parser Implementation
```

Key idea:

```text
Application code tidak menyentuh API raw berbahaya secara langsung kecuali di boundary package.
```

Contoh policy:

```text
Allowed outside boundary:
  - String, Object, Exception biasa
  - domain-level exception
  - domain XML DTO/event

Restricted outside boundary:
  - DocumentBuilderFactory.newInstance()
  - SAXParserFactory.newInstance()
  - Runtime.exec(...)
  - ProcessBuilder direct construction
  - NodeList exposed as domain result
  - System.getProperty direct in domain logic
```

---

## 7. Runtime Info Collector

### 7.1 Tujuan

Runtime collector membantu incident response, diagnostics, startup logging, compatibility checks, dan support matrix.

Ia tidak boleh menjadi observability platform besar. Cukup snapshot yang jelas.

Data yang berguna:

```text
Java:
  - runtime version
  - vendor
  - vm name
  - vm version
  - specification version
  - class file target assumption

OS:
  - os name
  - os version
  - os arch

Runtime:
  - available processors
  - max memory
  - total memory
  - free memory
  - process pid if available

Module/classpath:
  - named module or unnamed module
  - key module presence

Encoding/global defaults:
  - file.encoding
  - default charset
  - user.timezone
  - default locale
```

---

### 7.2 Java 8–25 version handling

Java 9+ punya `Runtime.version()`.

Java 8 tidak punya API ini.

Untuk compatibility Java 8–25, ada dua strategi:

1. compile baseline Java 8, akses Java 9+ API via reflection;
2. gunakan multi-release JAR.

Untuk library internal sederhana, strategi reflection sering cukup.

```java
public final class JavaVersion {
    private final int feature;
    private final String raw;

    private JavaVersion(int feature, String raw) {
        this.feature = feature;
        this.raw = raw;
    }

    public static JavaVersion current() {
        String raw = System.getProperty("java.version", "unknown");

        // Java 9+: try Runtime.version().feature() reflectively
        try {
            Object version = Runtime.class.getMethod("version").invoke(null);
            Object feature = version.getClass().getMethod("feature").invoke(version);
            return new JavaVersion(((Integer) feature).intValue(), raw);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return new JavaVersion(parseLegacyFeature(raw), raw);
        }
    }

    private static int parseLegacyFeature(String raw) {
        if (raw == null || raw.isBlank()) {
            return -1;
        }

        // Java 8 examples: 1.8.0_402
        if (raw.startsWith("1.")) {
            int secondDot = raw.indexOf('.', 2);
            String major = secondDot > 0 ? raw.substring(2, secondDot) : raw.substring(2);
            return parseIntOrMinusOne(major);
        }

        // Java 9+ fallback examples: 17.0.10, 21, 25
        int dot = raw.indexOf('.');
        String major = dot > 0 ? raw.substring(0, dot) : raw;
        int dash = major.indexOf('-');
        if (dash > 0) {
            major = major.substring(0, dash);
        }
        return parseIntOrMinusOne(major);
    }

    private static int parseIntOrMinusOne(String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ex) {
            return -1;
        }
    }

    public int feature() {
        return feature;
    }

    public String raw() {
        return raw;
    }

    public boolean isAtLeast(int targetFeature) {
        return feature >= targetFeature;
    }
}
```

Important nuance:

```text
Runtime.version().feature() adalah pilihan benar di Java 9+.
Parsing java.version hanya fallback untuk Java 8 atau environment aneh.
```

---

### 7.3 RuntimeInfo value object

Jika Java baseline kamu 16+, record bisa dipakai.

Untuk Java 8 compatibility, gunakan final class.

```java
public final class RuntimeInfo {
    private final JavaVersion javaVersion;
    private final String javaVendor;
    private final String vmName;
    private final String osName;
    private final String osArch;
    private final int availableProcessors;
    private final long maxMemoryBytes;

    public RuntimeInfo(
            JavaVersion javaVersion,
            String javaVendor,
            String vmName,
            String osName,
            String osArch,
            int availableProcessors,
            long maxMemoryBytes) {
        this.javaVersion = javaVersion;
        this.javaVendor = javaVendor;
        this.vmName = vmName;
        this.osName = osName;
        this.osArch = osArch;
        this.availableProcessors = availableProcessors;
        this.maxMemoryBytes = maxMemoryBytes;
    }

    public JavaVersion javaVersion() { return javaVersion; }
    public String javaVendor() { return javaVendor; }
    public String vmName() { return vmName; }
    public String osName() { return osName; }
    public String osArch() { return osArch; }
    public int availableProcessors() { return availableProcessors; }
    public long maxMemoryBytes() { return maxMemoryBytes; }
}
```

Provider:

```java
public final class RuntimeInfoProvider {
    public RuntimeInfo snapshot() {
        Runtime runtime = Runtime.getRuntime();

        return new RuntimeInfo(
            JavaVersion.current(),
            System.getProperty("java.vendor", "unknown"),
            System.getProperty("java.vm.name", "unknown"),
            System.getProperty("os.name", "unknown"),
            System.getProperty("os.arch", "unknown"),
            runtime.availableProcessors(),
            runtime.maxMemory()
        );
    }
}
```

Caveat:

```text
availableProcessors() adalah jumlah processor yang tersedia untuk JVM menurut runtime, bukan janji jumlah CPU fisik.
maxMemory() adalah batas heap maksimum yang JVM coba gunakan, bukan total RAM machine/container.
```

---

## 8. Safe Process Executor

### 8.1 Problem

`Runtime.exec(String)` dan command shell raw sering menjadi sumber:

1. command injection;
2. quoting bug;
3. deadlock stdout/stderr;
4. zombie process;
5. timeout missing;
6. environment leakage;
7. inconsistent error handling.

Utility layer harus memaksa caller memakai command sebagai list argumen, bukan shell string.

---

### 8.2 Command model

```java
public final class ProcessCommand {
    private final List<String> command;
    private final Map<String, String> environment;
    private final File workingDirectory;
    private final Duration timeout;

    private ProcessCommand(
            List<String> command,
            Map<String, String> environment,
            File workingDirectory,
            Duration timeout) {
        if (command == null || command.isEmpty()) {
            throw new IllegalArgumentException("command must not be empty");
        }
        for (String part : command) {
            if (part == null || part.isEmpty()) {
                throw new IllegalArgumentException("command part must not be null/empty");
            }
        }
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("timeout must be positive");
        }

        this.command = Collections.unmodifiableList(new ArrayList<>(command));
        this.environment = environment == null
            ? Collections.emptyMap()
            : Collections.unmodifiableMap(new LinkedHashMap<>(environment));
        this.workingDirectory = workingDirectory;
        this.timeout = timeout;
    }

    public static ProcessCommand of(List<String> command, Duration timeout) {
        return new ProcessCommand(command, Collections.emptyMap(), null, timeout);
    }

    public List<String> command() { return command; }
    public Map<String, String> environment() { return environment; }
    public File workingDirectory() { return workingDirectory; }
    public Duration timeout() { return timeout; }
}
```

---

### 8.3 Result model

```java
public final class ProcessResult {
    private final int exitCode;
    private final String stdout;
    private final String stderr;
    private final boolean timedOut;
    private final Duration duration;

    public ProcessResult(int exitCode, String stdout, String stderr, boolean timedOut, Duration duration) {
        this.exitCode = exitCode;
        this.stdout = stdout;
        this.stderr = stderr;
        this.timedOut = timedOut;
        this.duration = duration;
    }

    public int exitCode() { return exitCode; }
    public String stdout() { return stdout; }
    public String stderr() { return stderr; }
    public boolean timedOut() { return timedOut; }
    public Duration duration() { return duration; }

    public boolean isSuccess() {
        return !timedOut && exitCode == 0;
    }
}
```

---

### 8.4 Executor implementation

Java 8 compatible approach:

```java
public final class ProcessExecutor {
    private final int outputLimitChars;

    public ProcessExecutor(int outputLimitChars) {
        if (outputLimitChars <= 0) {
            throw new IllegalArgumentException("outputLimitChars must be positive");
        }
        this.outputLimitChars = outputLimitChars;
    }

    public ProcessResult execute(ProcessCommand command) throws IOException, InterruptedException {
        Instant start = Instant.now();

        ProcessBuilder builder = new ProcessBuilder(command.command());
        if (command.workingDirectory() != null) {
            builder.directory(command.workingDirectory());
        }
        builder.environment().putAll(command.environment());

        Process process = builder.start();

        FutureTask<String> stdoutTask = new FutureTask<>(() -> readLimited(process.getInputStream()));
        FutureTask<String> stderrTask = new FutureTask<>(() -> readLimited(process.getErrorStream()));

        Thread outThread = new Thread(stdoutTask, "process-stdout-reader");
        Thread errThread = new Thread(stderrTask, "process-stderr-reader");
        outThread.setDaemon(true);
        errThread.setDaemon(true);
        outThread.start();
        errThread.start();

        boolean finished = process.waitFor(command.timeout().toMillis(), TimeUnit.MILLISECONDS);
        boolean timedOut = !finished;

        if (timedOut) {
            process.destroy();
            if (!process.waitFor(250, TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
            }
        }

        int exitCode = finished ? process.exitValue() : -1;
        String stdout = getFutureBestEffort(stdoutTask);
        String stderr = getFutureBestEffort(stderrTask);
        Duration duration = Duration.between(start, Instant.now());

        return new ProcessResult(exitCode, stdout, stderr, timedOut, duration);
    }

    private String readLimited(InputStream input) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                int remaining = outputLimitChars - builder.length();
                if (remaining <= 0) {
                    continue;
                }
                builder.append(buffer, 0, Math.min(read, remaining));
            }
        }
        return builder.toString();
    }

    private String getFutureBestEffort(FutureTask<String> task) {
        try {
            return task.get(500, TimeUnit.MILLISECONDS);
        } catch (Exception ex) {
            return "";
        }
    }
}
```

Production improvement:

```text
Java 21+:
  - gunakan virtual thread untuk stream gobbler jika cocok.
  - gunakan structured concurrency jika tersedia sesuai policy project.

Java 9+:
  - ProcessHandle bisa dipakai untuk PID, descendants, dan process info.
```

Tetapi baseline Java 8 membuat implementasi di atas lebih portable.

---

## 9. Failure Taxonomy Layer

### 9.1 Kenapa perlu failure taxonomy?

Tanpa taxonomy, semua exception menjadi `RuntimeException`, lalu observability dan retry policy berantakan.

Kita butuh klasifikasi minimal:

```java
public enum FailureCategory {
    PROGRAMMING_ERROR,
    INVALID_INPUT,
    SECURITY_REJECTION,
    ENVIRONMENT_FAILURE,
    EXTERNAL_SYSTEM_FAILURE,
    TIMEOUT,
    RESOURCE_EXHAUSTION,
    COMPATIBILITY_FAILURE,
    UNKNOWN
}
```

Severity:

```java
public enum FailureSeverity {
    DEBUG,
    INFO,
    WARNING,
    ERROR,
    CRITICAL
}
```

Base exception:

```java
public class PlatformFailure extends RuntimeException {
    private final FailureCategory category;
    private final FailureSeverity severity;

    public PlatformFailure(
            FailureCategory category,
            FailureSeverity severity,
            String message,
            Throwable cause) {
        super(message, cause);
        this.category = Objects.requireNonNull(category, "category");
        this.severity = Objects.requireNonNull(severity, "severity");
    }

    public FailureCategory category() { return category; }
    public FailureSeverity severity() { return severity; }
}
```

---

### 9.2 Exception classification rules

A simple classifier:

```java
public final class FailureClassifier {
    public FailureCategory classify(Throwable t) {
        if (t instanceof SecurityException) {
            return FailureCategory.SECURITY_REJECTION;
        }
        if (t instanceof InterruptedException) {
            return FailureCategory.TIMEOUT;
        }
        if (t instanceof java.net.SocketTimeoutException) {
            return FailureCategory.TIMEOUT;
        }
        if (t instanceof OutOfMemoryError) {
            return FailureCategory.RESOURCE_EXHAUSTION;
        }
        if (t instanceof LinkageError || t instanceof ClassNotFoundException) {
            return FailureCategory.COMPATIBILITY_FAILURE;
        }
        if (t instanceof IllegalArgumentException) {
            return FailureCategory.INVALID_INPUT;
        }
        if (t instanceof NullPointerException || t instanceof AssertionError) {
            return FailureCategory.PROGRAMMING_ERROR;
        }
        return FailureCategory.UNKNOWN;
    }
}
```

Important nuance:

```text
Classifier bukan berarti semua Throwable boleh ditangkap.
Catching Error tetap harus sangat selektif, biasanya hanya di top-level boundary untuk logging/termination, bukan recovery normal.
```

---

## 10. Text Boundary Utilities

### 10.1 Jangan buat StringUtils monster

Buat utility kecil berbasis boundary:

```java
public final class Texts {
    private Texts() {}

    public static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    public static String requireNonBlank(String value, String fieldName) {
        if (isBlank(value)) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value;
    }

    public static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static String truncateForLog(String value, int maxChars) {
        if (value == null) return null;
        if (maxChars < 0) throw new IllegalArgumentException("maxChars must be >= 0");
        if (value.length() <= maxChars) return value;
        return value.substring(0, maxChars) + "...";
    }
}
```

Caveat Java 8–25:

```text
String::isBlank dan strip ada sejak Java 11.
Jika baseline Java 8, jangan gunakan langsung kecuali via compatibility layer atau multi-release JAR.
```

---

### 10.2 CanonicalText untuk key boundary

Untuk key eksternal, jangan sekadar `toLowerCase()` tanpa policy.

```java
public final class CanonicalText {
    private final String value;

    private CanonicalText(String value) {
        this.value = value;
    }

    public static CanonicalText asciiCaseInsensitiveKey(String raw) {
        String checked = Texts.requireNonBlank(raw, "raw");
        String normalized = checked.trim().toLowerCase(Locale.ROOT);
        return new CanonicalText(normalized);
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CanonicalText)) return false;
        CanonicalText that = (CanonicalText) o;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Why `Locale.ROOT`?

```text
Agar casing rule tidak bergantung default locale JVM/user/host.
```

---

## 11. XML Security Profile

### 11.1 Profile object

```java
public final class XmlSecurityProfile {
    private final boolean namespaceAware;
    private final boolean rejectDoctype;
    private final boolean allowExternalDtd;
    private final boolean allowExternalSchema;
    private final boolean xIncludeAware;
    private final boolean expandEntityReferences;

    private XmlSecurityProfile(
            boolean namespaceAware,
            boolean rejectDoctype,
            boolean allowExternalDtd,
            boolean allowExternalSchema,
            boolean xIncludeAware,
            boolean expandEntityReferences) {
        this.namespaceAware = namespaceAware;
        this.rejectDoctype = rejectDoctype;
        this.allowExternalDtd = allowExternalDtd;
        this.allowExternalSchema = allowExternalSchema;
        this.xIncludeAware = xIncludeAware;
        this.expandEntityReferences = expandEntityReferences;
    }

    public static XmlSecurityProfile untrustedInput() {
        return new XmlSecurityProfile(
            true,   // namespaceAware
            true,   // rejectDoctype
            false,  // allowExternalDtd
            false,  // allowExternalSchema
            false,  // xIncludeAware
            false   // expandEntityReferences
        );
    }

    public static XmlSecurityProfile trustedInternal() {
        return new XmlSecurityProfile(
            true,
            false,
            false,
            false,
            false,
            true
        );
    }

    public boolean namespaceAware() { return namespaceAware; }
    public boolean rejectDoctype() { return rejectDoctype; }
    public boolean allowExternalDtd() { return allowExternalDtd; }
    public boolean allowExternalSchema() { return allowExternalSchema; }
    public boolean xIncludeAware() { return xIncludeAware; }
    public boolean expandEntityReferences() { return expandEntityReferences; }
}
```

---

### 11.2 Safe feature setter

Parser feature support can differ. Kamu perlu helper yang bisa memilih strict/fail-fast atau lenient/logging.

```java
public final class XmlFeatures {
    private XmlFeatures() {}

    public static void setFeatureStrict(
            DocumentBuilderFactory factory,
            String feature,
            boolean value) {
        try {
            factory.setFeature(feature, value);
        } catch (ParserConfigurationException ex) {
            throw new IllegalStateException("Required XML feature unsupported: " + feature, ex);
        }
    }

    public static void setFeatureStrict(
            SAXParserFactory factory,
            String feature,
            boolean value) {
        try {
            factory.setFeature(feature, value);
        } catch (ParserConfigurationException | SAXNotRecognizedException | SAXNotSupportedException ex) {
            throw new IllegalStateException("Required XML feature unsupported: " + feature, ex);
        }
    }

    public static void setAttributeIfSupported(
            DocumentBuilderFactory factory,
            String attribute,
            String value) {
        try {
            factory.setAttribute(attribute, value);
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("Required XML attribute unsupported: " + attribute, ex);
        }
    }
}
```

---

## 12. XML Parser Factory Provider

### 12.1 DOM factory

```java
public final class XmlParserFactoryProvider {
    private XmlParserFactoryProvider() {}

    public static DocumentBuilderFactory domFactory(XmlSecurityProfile profile) {
        Objects.requireNonNull(profile, "profile");

        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(profile.namespaceAware());
        factory.setXIncludeAware(profile.xIncludeAware());
        factory.setExpandEntityReferences(profile.expandEntityReferences());

        XmlFeatures.setFeatureStrict(
            factory,
            XMLConstants.FEATURE_SECURE_PROCESSING,
            true
        );

        if (profile.rejectDoctype()) {
            XmlFeatures.setFeatureStrict(
                factory,
                "http://apache.org/xml/features/disallow-doctype-decl",
                true
            );
        }

        XmlFeatures.setFeatureStrict(
            factory,
            "http://xml.org/sax/features/external-general-entities",
            profile.allowExternalDtd()
        );
        XmlFeatures.setFeatureStrict(
            factory,
            "http://xml.org/sax/features/external-parameter-entities",
            profile.allowExternalDtd()
        );
        XmlFeatures.setFeatureStrict(
            factory,
            "http://apache.org/xml/features/nonvalidating/load-external-dtd",
            profile.allowExternalDtd()
        );

        factory.setAttribute(
            XMLConstants.ACCESS_EXTERNAL_DTD,
            profile.allowExternalDtd() ? "file,http,https" : ""
        );
        factory.setAttribute(
            XMLConstants.ACCESS_EXTERNAL_SCHEMA,
            profile.allowExternalSchema() ? "file,http,https" : ""
        );

        return factory;
    }
}
```

Note:

```text
Beberapa feature URI merupakan de facto Xerces/JAXP feature. Karena parser implementation bisa berbeda, policy production harus memutuskan apakah unsupported feature = fail startup atau fallback.
Untuk untrusted XML, fail-fast lebih defensible.
```

---

### 12.2 SAX factory

```java
public static SAXParserFactory saxFactory(XmlSecurityProfile profile) {
    Objects.requireNonNull(profile, "profile");

    SAXParserFactory factory = SAXParserFactory.newInstance();
    factory.setNamespaceAware(profile.namespaceAware());

    XmlFeatures.setFeatureStrict(
        factory,
        XMLConstants.FEATURE_SECURE_PROCESSING,
        true
    );

    if (profile.rejectDoctype()) {
        XmlFeatures.setFeatureStrict(
            factory,
            "http://apache.org/xml/features/disallow-doctype-decl",
            true
        );
    }

    XmlFeatures.setFeatureStrict(
        factory,
        "http://xml.org/sax/features/external-general-entities",
        profile.allowExternalDtd()
    );
    XmlFeatures.setFeatureStrict(
        factory,
        "http://xml.org/sax/features/external-parameter-entities",
        profile.allowExternalDtd()
    );
    XmlFeatures.setFeatureStrict(
        factory,
        "http://apache.org/xml/features/nonvalidating/load-external-dtd",
        profile.allowExternalDtd()
    );

    return factory;
}
```

SAX external access attributes kadang perlu diset pada `XMLReader`:

```java
public static XMLReader secureXmlReader(XmlSecurityProfile profile)
        throws ParserConfigurationException, SAXException {
    SAXParser parser = saxFactory(profile).newSAXParser();
    XMLReader reader = parser.getXMLReader();

    reader.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);

    try {
        reader.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, profile.allowExternalDtd() ? "file,http,https" : "");
    } catch (SAXNotRecognizedException | SAXNotSupportedException ex) {
        throw new SAXException("Required XML property unsupported: " + XMLConstants.ACCESS_EXTERNAL_DTD, ex);
    }

    try {
        reader.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, profile.allowExternalSchema() ? "file,http,https" : "");
    } catch (SAXNotRecognizedException | SAXNotSupportedException ex) {
        throw new SAXException("Required XML property unsupported: " + XMLConstants.ACCESS_EXTERNAL_SCHEMA, ex);
    }

    return reader;
}
```

---

## 13. DOM Documents Utility

### 13.1 Parse DOM safely

```java
public final class DomDocuments {
    private final DocumentBuilderFactory factory;

    public DomDocuments(DocumentBuilderFactory factory) {
        this.factory = Objects.requireNonNull(factory, "factory");
    }

    public Document parse(InputStream input) {
        Objects.requireNonNull(input, "input");
        try {
            DocumentBuilder builder = factory.newDocumentBuilder();
            builder.setErrorHandler(new ThrowingSaxErrorHandler());
            Document document = builder.parse(input);
            document.getDocumentElement().normalize();
            return document;
        } catch (ParserConfigurationException | SAXException | IOException ex) {
            throw new DomReadException("Failed to parse XML document", ex);
        }
    }
}
```

Exception:

```java
public final class DomReadException extends PlatformFailure {
    public DomReadException(String message, Throwable cause) {
        super(FailureCategory.INVALID_INPUT, FailureSeverity.ERROR, message, cause);
    }
}
```

Error handler:

```java
public final class ThrowingSaxErrorHandler implements ErrorHandler {
    @Override
    public void warning(SAXParseException exception) throws SAXException {
        // Optionally collect warnings instead of throw.
    }

    @Override
    public void error(SAXParseException exception) throws SAXException {
        throw exception;
    }

    @Override
    public void fatalError(SAXParseException exception) throws SAXException {
        throw exception;
    }
}
```

---

## 14. DOM Extractor

### 14.1 Problem with raw DOM API

Raw DOM has many ambiguous operations:

```java
String value = element.getAttribute("status");
```

Is empty string a real empty value or missing attribute?

```java
NodeList list = element.getElementsByTagName("status");
```

Direct child or descendant?
Namespace-aware or not?

```java
node.getTextContent();
```

Immediate text or all descendant text?

A good extractor makes ambiguity explicit.

---

### 14.2 DOM helper object

```java
public final class DomExtractor {
    public Optional<Element> singleDirectChild(
            Element parent,
            String namespaceUri,
            String localName) {
        List<Element> matches = directChildren(parent, namespaceUri, localName);
        if (matches.size() > 1) {
            throw new DomReadException(
                "Expected at most one child element {" + namespaceUri + "}" + localName
                + " but found " + matches.size(),
                null
            );
        }
        return matches.isEmpty() ? Optional.empty() : Optional.of(matches.get(0));
    }

    public Element requiredSingleDirectChild(
            Element parent,
            String namespaceUri,
            String localName) {
        return singleDirectChild(parent, namespaceUri, localName)
            .orElseThrow(() -> new DomReadException(
                "Missing required child element {" + namespaceUri + "}" + localName,
                null
            ));
    }

    public List<Element> directChildren(
            Element parent,
            String namespaceUri,
            String localName) {
        Objects.requireNonNull(parent, "parent");
        List<Element> result = new ArrayList<>();

        Node child = parent.getFirstChild();
        while (child != null) {
            if (child.getNodeType() == Node.ELEMENT_NODE) {
                Element element = (Element) child;
                if (Objects.equals(namespaceUri, element.getNamespaceURI())
                        && Objects.equals(localName, element.getLocalName())) {
                    result.add(element);
                }
            }
            child = child.getNextSibling();
        }
        return Collections.unmodifiableList(result);
    }

    public Optional<String> optionalAttribute(
            Element element,
            String namespaceUri,
            String localName) {
        Objects.requireNonNull(element, "element");
        if (!element.hasAttributeNS(namespaceUri, localName)) {
            return Optional.empty();
        }
        return Optional.of(element.getAttributeNS(namespaceUri, localName));
    }

    public String requiredAttribute(
            Element element,
            String namespaceUri,
            String localName) {
        return optionalAttribute(element, namespaceUri, localName)
            .orElseThrow(() -> new DomReadException(
                "Missing required attribute {" + namespaceUri + "}" + localName,
                null
            ));
    }

    public String directTextOnly(Element element) {
        StringBuilder builder = new StringBuilder();
        Node child = element.getFirstChild();
        while (child != null) {
            short type = child.getNodeType();
            if (type == Node.TEXT_NODE || type == Node.CDATA_SECTION_NODE) {
                builder.append(child.getNodeValue());
            } else if (type == Node.ELEMENT_NODE) {
                throw new DomReadException(
                    "Expected direct text only but found child element: " + child.getNodeName(),
                    null
                );
            }
            child = child.getNextSibling();
        }
        return builder.toString();
    }
}
```

Important design:

```text
Extractor uses direct child traversal by default.
Descendant query should be explicitly named descendantElements(...).
```

---

## 15. SAX Streaming Importer

### 15.1 Use case

Input:

```xml
<cases xmlns="urn:case-import:v1">
  <case id="C-001">
    <status>OPEN</status>
    <subject>Noise complaint</subject>
  </case>
  <case id="C-002">
    <status>CLOSED</status>
    <subject>Late renewal</subject>
  </case>
</cases>
```

Goal:

```text
Stream each <case> into domain event without loading entire document.
```

---

### 15.2 Domain event

```java
public final class CaseImportRecord {
    private final String id;
    private final String status;
    private final String subject;

    public CaseImportRecord(String id, String status, String subject) {
        this.id = Texts.requireNonBlank(id, "id");
        this.status = Texts.requireNonBlank(status, "status");
        this.subject = subject;
    }

    public String id() { return id; }
    public String status() { return status; }
    public String subject() { return subject; }
}
```

---

### 15.3 SAX handler with explicit state

```java
public final class CaseImportSaxHandler extends DefaultHandler {
    private static final String NS = "urn:case-import:v1";

    private final Consumer<CaseImportRecord> consumer;
    private final StringBuilder text = new StringBuilder(256);

    private Locator locator;
    private boolean insideCase;
    private String currentElement;

    private String caseId;
    private String status;
    private String subject;

    public CaseImportSaxHandler(Consumer<CaseImportRecord> consumer) {
        this.consumer = Objects.requireNonNull(consumer, "consumer");
    }

    @Override
    public void setDocumentLocator(Locator locator) {
        this.locator = locator;
    }

    @Override
    public void startElement(String uri, String localName, String qName, Attributes attributes)
            throws SAXException {
        text.setLength(0);

        if (NS.equals(uri) && "case".equals(localName)) {
            if (insideCase) {
                throw error("Nested case is not allowed");
            }
            insideCase = true;
            currentElement = "case";
            caseId = attributes.getValue("id");
            status = null;
            subject = null;
            return;
        }

        if (insideCase && NS.equals(uri)) {
            if ("status".equals(localName) || "subject".equals(localName)) {
                currentElement = localName;
                return;
            }
        }

        currentElement = null;
    }

    @Override
    public void characters(char[] ch, int start, int length) throws SAXException {
        if (currentElement != null) {
            text.append(ch, start, length);
        }
    }

    @Override
    public void endElement(String uri, String localName, String qName) throws SAXException {
        if (!NS.equals(uri)) {
            return;
        }

        if (insideCase && "status".equals(localName)) {
            status = text.toString().trim();
            currentElement = null;
            return;
        }

        if (insideCase && "subject".equals(localName)) {
            subject = text.toString().trim();
            currentElement = null;
            return;
        }

        if (insideCase && "case".equals(localName)) {
            if (Texts.isBlank(caseId)) {
                throw error("case/@id is required");
            }
            if (Texts.isBlank(status)) {
                throw error("case/status is required");
            }
            consumer.accept(new CaseImportRecord(caseId, status, subject));
            insideCase = false;
            currentElement = null;
        }
    }

    private SAXException error(String message) {
        if (locator == null) {
            return new SAXException(message);
        }
        return new SAXParseException(
            message,
            locator.getPublicId(),
            locator.getSystemId(),
            locator.getLineNumber(),
            locator.getColumnNumber()
        );
    }
}
```

Key lessons:

```text
characters() appends, not assigns.
State is explicit.
Namespace URI is checked.
Locator is captured.
Records are emitted per completed unit.
```

---

### 15.4 SAX importer wrapper

```java
public final class SaxCaseImporter {
    private final XmlSecurityProfile profile;

    public SaxCaseImporter(XmlSecurityProfile profile) {
        this.profile = Objects.requireNonNull(profile, "profile");
    }

    public void importCases(InputStream input, Consumer<CaseImportRecord> consumer) {
        Objects.requireNonNull(input, "input");
        Objects.requireNonNull(consumer, "consumer");

        try {
            XMLReader reader = XmlParserFactoryProvider.secureXmlReader(profile);
            reader.setContentHandler(new CaseImportSaxHandler(consumer));
            reader.setErrorHandler(new ThrowingSaxErrorHandler());
            reader.parse(new InputSource(input));
        } catch (ParserConfigurationException | SAXException | IOException ex) {
            throw new SaxImportException("Failed to import cases XML", ex);
        }
    }
}
```

Exception:

```java
public final class SaxImportException extends PlatformFailure {
    public SaxImportException(String message, Throwable cause) {
        super(FailureCategory.INVALID_INPUT, FailureSeverity.ERROR, message, cause);
    }
}
```

---

## 16. Partial Failure and Auditability

### 16.1 Fail-fast vs collect errors

Ada dua import mode:

```text
Fail-fast:
  - berhenti di error pertama.
  - cocok untuk transactional whole-file import.

Collect errors:
  - lanjut sebanyak mungkin.
  - cocok untuk batch validation/reporting.
```

SAX naturally parser-driven. Jika handler throw exception, parse berhenti. Untuk collect errors, handler harus menyimpan issue dan punya policy kapan error fatal.

---

### 16.2 XmlIssue

```java
public final class XmlIssue {
    private final String code;
    private final String message;
    private final int line;
    private final int column;

    public XmlIssue(String code, String message, int line, int column) {
        this.code = code;
        this.message = message;
        this.line = line;
        this.column = column;
    }

    public String code() { return code; }
    public String message() { return message; }
    public int line() { return line; }
    public int column() { return column; }
}
```

---

### 16.3 Import result

```java
public final class SaxImportResult<T> {
    private final List<T> records;
    private final List<XmlIssue> issues;

    public SaxImportResult(List<T> records, List<XmlIssue> issues) {
        this.records = Collections.unmodifiableList(new ArrayList<>(records));
        this.issues = Collections.unmodifiableList(new ArrayList<>(issues));
    }

    public List<T> records() { return records; }
    public List<XmlIssue> issues() { return issues; }

    public boolean hasErrors() {
        return !issues.isEmpty();
    }
}
```

Production decision:

```text
Jangan campur parse issue dengan persistence issue.
XML issue = document invalid.
Persistence issue = storage/system failure.
Domain rejection = business-rule failure.
```

---

## 17. Compatibility Strategy Java 8–25

### 17.1 Baseline choices

Ada tiga strategi:

#### Strategy A — Java 8 baseline source

Pros:

```text
- Jalan di Java 8–25.
- Cocok untuk shared library lama.
```

Cons:

```text
- Tidak bisa pakai record, var, switch expression, modern APIs langsung.
- Perlu reflection untuk Java 9+ APIs.
```

#### Strategy B — Java 17/21 baseline

Pros:

```text
- Bisa pakai records, sealed types, modern APIs.
- Lebih enak untuk code quality.
```

Cons:

```text
- Tidak jalan di Java 8/11.
```

#### Strategy C — Multi-release JAR

Pros:

```text
- Java 8 base tetap ada.
- Java 9+/17+/21+ bisa pakai optimized implementation.
```

Cons:

```text
- Build/test lebih kompleks.
- Risk packaging dan classpath/module confusion.
```

---

### 17.2 Recommended for this series

Untuk learning dan enterprise portability:

```text
Core concepts: Java 8 compatible.
Modern notes: Java 9/11/17/21/25-specific improvement.
Production internal app: gunakan baseline runtime aktual project.
```

Jika project sudah Java 21/25, jangan paksa Java 8 style untuk semua hal. Tetapi pahami Java 8 karena banyak library/framework/legacy system masih punya boundary tersebut.

---

### 17.3 Avoid accidental linkage error

Buruk untuk Java 8-compatible library:

```java
int feature = Runtime.version().feature();
```

Meskipun code path tidak dipanggil di Java 8, class loading/linking bisa gagal jika bytecode refer ke method yang tidak ada.

Solusi:

```java
Runtime.class.getMethod("version")
```

Atau multi-release JAR.

---

## 18. Test Matrix

### 18.1 Runtime tests

Test cases:

```text
JavaVersion:
  - 1.8.0_402 -> 8
  - 9 -> 9
  - 11.0.22 -> 11
  - 17.0.10 -> 17
  - 21.0.2 -> 21
  - 25 -> 25
  - unknown -> -1

RuntimeInfoProvider:
  - fields non-null
  - availableProcessors > 0
  - maxMemory > 0
```

---

### 18.2 Process tests

Test cases:

```text
ProcessExecutor:
  - command success returns exitCode 0
  - command failure returns non-zero
  - timeout kills process
  - stdout captured
  - stderr captured
  - huge output truncated
  - command with spaces passed as argument safely
  - interrupted thread re-interrupts if policy requires
```

Important:

```text
Do not make tests depend on OS-specific command unless guarded.
```

For example:

```text
Windows: cmd /c echo hello
Unix: sh -c 'echo hello'
```

But remember: production executor should avoid shell unless explicitly requested. Tests may use shell only as test fixture.

---

### 18.3 XML security tests

Payloads:

#### XXE file read

```xml
<!DOCTYPE root [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>&xxe;</root>
```

Expected:

```text
Rejected.
No file content appears in result/log.
```

#### SSRF external entity

```xml
<!DOCTYPE root [
  <!ENTITY xxe SYSTEM "http://127.0.0.1:8080/private">
]>
<root>&xxe;</root>
```

Expected:

```text
Rejected.
No network request allowed.
```

#### Billion Laughs style expansion

```xml
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
]>
<lolz>&lol2;</lolz>
```

Expected:

```text
Rejected or bounded by processing limits.
```

---

### 18.4 DOM tests

Test cases:

```text
DomExtractor:
  - direct child found
  - descendant is not accidentally matched
  - default namespace works by URI
  - prefix change does not break query
  - missing attribute distinct from empty attribute
  - multiple direct child fails when single expected
  - directTextOnly rejects nested child element
  - NodeList not exposed
```

---

### 18.5 SAX tests

Test cases:

```text
SAX handler:
  - characters() fragmentation handled
  - namespace URI checked
  - missing required field produces line/column issue
  - multiple records streamed
  - large file does not grow memory linearly with file size
  - unknown elements policy tested
  - nested disallowed element rejected
```

---

## 19. Observability Design

### 19.1 Startup diagnostics

At startup, log sanitized runtime snapshot:

```json
{
  "event": "runtime.startup",
  "javaFeature": 25,
  "javaVendor": "Oracle Corporation",
  "vmName": "Java HotSpot(TM) 64-Bit Server VM",
  "osName": "Linux",
  "osArch": "amd64",
  "availableProcessors": 4,
  "maxMemoryBytes": 2147483648
}
```

Do not log:

```text
- all environment variables
- all system properties
- tokens/secrets
- raw XML payload
```

---

### 19.2 XML parse metrics

Useful metrics:

```text
xml.parse.count
xml.parse.failure.count
xml.parse.duration
xml.sax.records.count
xml.sax.issues.count
xml.input.bytes
xml.security.rejection.count
```

Useful labels/tags:

```text
sourceSystem
documentType
schemaVersion
parserMode: DOM/SAX
securityProfile: untrusted/trustedInternal
result: success/failure
failureCategory
```

Avoid labels:

```text
raw filename if high-cardinality
record id if high-cardinality
user input
full exception message if unbounded
```

---

### 19.3 Process metrics

```text
process.execute.count
process.execute.duration
process.execute.timeout.count
process.execute.exit_code
process.execute.output_truncated.count
```

Never tag raw command line if it may include sensitive path/token.

---

## 20. Security Checklist

### 20.1 XML

```text
[ ] Namespace-aware enabled.
[ ] FEATURE_SECURE_PROCESSING enabled.
[ ] DOCTYPE rejected for untrusted input.
[ ] External general entities disabled.
[ ] External parameter entities disabled.
[ ] External DTD loading disabled.
[ ] ACCESS_EXTERNAL_DTD set to empty for untrusted input.
[ ] ACCESS_EXTERNAL_SCHEMA set to empty unless schema access is explicitly required.
[ ] XInclude disabled.
[ ] Entity expansion not relied upon for business logic.
[ ] Parser unsupported feature behavior documented.
[ ] XXE payload tested.
[ ] Billion Laughs/entity expansion payload tested.
[ ] Large-file memory behavior tested.
[ ] Raw XML not logged.
```

---

### 20.2 Process execution

```text
[ ] Command represented as list of arguments.
[ ] Shell invocation forbidden by default.
[ ] Timeout mandatory.
[ ] stdout/stderr drained concurrently.
[ ] Output size bounded.
[ ] Environment explicit and sanitized.
[ ] Working directory explicit if relevant.
[ ] Exit code structured.
[ ] Timeout destroys process.
[ ] Descendant process behavior understood.
[ ] Sensitive arguments masked in logs.
```

---

### 20.3 Runtime/global state

```text
[ ] System properties not read in random domain classes.
[ ] Default locale/timezone/charset not silently relied upon for business logic.
[ ] Java version detection tested.
[ ] Optional API use does not break older runtime.
[ ] Startup diagnostics sanitized.
[ ] No secrets dumped from env/properties.
```

---

## 21. Performance and Memory Checklist

### 21.1 DOM

```text
[ ] DOM only used for small/medium documents or bounded subtrees.
[ ] NodeList live behavior understood.
[ ] No repeated descendant scans inside large loops.
[ ] Text extraction does not accidentally concatenate huge descendant trees.
[ ] Document discarded after use.
[ ] No Node stored in long-lived cache unless intentional.
```

---

### 21.2 SAX

```text
[ ] Handler state bounded.
[ ] StringBuilder reset after each field/record.
[ ] Records emitted incrementally.
[ ] Backpressure boundary exists if consumer is slower than parser.
[ ] Large text fields have limits.
[ ] Error collection has maximum bound.
```

---

### 21.3 Runtime/process

```text
[ ] Process output bounded.
[ ] Process timeout bounded.
[ ] Thread creation strategy appropriate to Java version.
[ ] No excessive stack trace capture in hot path.
[ ] Runtime diagnostics not collected too frequently.
```

---

## 22. API Review Checklist

For every public method in the utility layer, ask:

```text
[ ] What does this method guarantee?
[ ] What does it reject?
[ ] Is null accepted?
[ ] Is empty string different from missing?
[ ] Is namespace required?
[ ] Is result snapshot or live?
[ ] Is failure checked, unchecked, or result-based?
[ ] Does it expose raw JDK mutable object?
[ ] Is it Java 8 compatible?
[ ] Does it log sensitive data?
[ ] Does it hide global state?
```

---

## 23. Example End-to-End Use Case

### 23.1 Application code

```java
public final class CaseImportService {
    private final SaxCaseImporter importer;
    private final CaseRepository repository;

    public CaseImportService(CaseRepository repository) {
        this.importer = new SaxCaseImporter(XmlSecurityProfile.untrustedInput());
        this.repository = Objects.requireNonNull(repository, "repository");
    }

    public void importFile(InputStream input) {
        importer.importCases(input, record -> {
            // Domain validation can happen here or inside a dedicated mapper.
            CaseEntity entity = new CaseEntity(
                record.id(),
                CaseStatus.fromExternalCode(record.status()),
                record.subject()
            );
            repository.save(entity);
        });
    }
}
```

Application code does not know:

```text
- how to configure SAXParserFactory;
- how to disable external entity access;
- how characters() fragmentation works;
- how locator is converted to error;
- how parser implementation differs.
```

That complexity is owned by boundary layer.

---

### 23.2 Operational flow

```text
1. Input stream arrives.
2. Boundary layer creates hardened SAX reader.
3. Parser emits events.
4. Handler builds one record at a time.
5. Record is validated.
6. Consumer persists record.
7. Metrics capture parse count/duration/failure.
8. Error includes location but not raw XML content.
```

---

## 24. Common Design Mistakes

### 24.1 Mistake: one `XmlUtils.parse(String xml)` method

Looks convenient:

```java
Document doc = XmlUtils.parse(xml);
```

But hides:

```text
- trusted or untrusted?
- namespace-aware?
- DTD allowed?
- schema allowed?
- max size?
- error handler?
- encoding?
```

Better:

```java
Document doc = domDocuments.parse(inputStream);
```

Where `domDocuments` was constructed with explicit profile.

---

### 24.2 Mistake: DOM for every XML

DOM is convenient but memory-expensive.

Better decision table:

```text
Small config XML needing random access:
  DOM is fine.

Large import file with repeated records:
  SAX or StAX preferred.

Need event-driven streaming validation:
  SAX works well.

Need pull-based parsing with caller control:
  StAX may be better, though outside this series.

Need object binding:
  JAXB/Jackson XML may be appropriate, but still harden parser boundary.
```

---

### 24.3 Mistake: using prefix as namespace identity

Bad:

```java
if ("abc:case".equals(element.getNodeName())) { ... }
```

Good:

```java
if ("urn:case-import:v1".equals(element.getNamespaceURI())
        && "case".equals(element.getLocalName())) { ... }
```

---

### 24.4 Mistake: assuming text arrives once in SAX

Bad:

```java
public void characters(char[] ch, int start, int length) {
    value = new String(ch, start, length);
}
```

Good:

```java
text.append(ch, start, length);
```

---

### 24.5 Mistake: catching `Exception` and returning null

Bad:

```java
try {
    return parse(input);
} catch (Exception e) {
    return null;
}
```

Good:

```java
catch (SAXParseException ex) {
    throw new XmlParseException("Invalid XML at line " + ex.getLineNumber(), ex);
}
```

---

## 25. Production Readiness Checklist

```text
Runtime:
[ ] RuntimeInfo snapshot implemented.
[ ] Java version detection tested on Java 8, 11, 17, 21, 25.
[ ] Startup diagnostics sanitized.

Process:
[ ] No direct Runtime.exec usage outside boundary.
[ ] ProcessBuilder wrapper requires timeout.
[ ] stdout/stderr concurrently drained.
[ ] Output bounded and sanitized.

Failure:
[ ] Failure category/severity defined.
[ ] XML parse exception includes safe location.
[ ] Causes preserved.
[ ] InterruptedException policy correct.

Text:
[ ] Locale.ROOT used for canonical technical keys.
[ ] Empty vs missing semantics explicit.
[ ] Sensitive text not logged.

DOM:
[ ] DocumentBuilderFactory hardened.
[ ] Namespace-aware queries.
[ ] DOM extractor distinguishes missing/empty/multiple.
[ ] NodeList not exposed as stable list.

SAX:
[ ] SAXParserFactory/XMLReader hardened.
[ ] characters() fragmentation handled.
[ ] Locator captured.
[ ] Handler state bounded.
[ ] Large-file test exists.

Security:
[ ] XXE tests pass.
[ ] Entity expansion tests pass.
[ ] External DTD/schema disabled by default.
[ ] Unsupported security feature fails safe.

Observability:
[ ] Metrics for success/failure/duration.
[ ] Logs include correlation id/import id.
[ ] Logs exclude raw XML/secrets.

Compatibility:
[ ] Baseline Java version explicit.
[ ] Optional modern APIs isolated.
[ ] Build uses --release where appropriate.
[ ] CI matrix covers supported runtimes.
```

---

## 26. How This Capstone Maps to the Whole Series

```text
Part 1–3:
  Runtime type/class foundation used by capability detection and compatibility strategy.

Part 4–7:
  String/primitive/text semantics used by Texts, CanonicalText, XML extraction, and safe logging.

Part 8–10:
  Enum/record/sealed mental model used for failure taxonomy and structured result modelling.

Part 11–12:
  Throwable/failure taxonomy used by PlatformFailure and XML/process exceptions.

Part 13–20:
  System, Runtime, Process, Thread, StackWalker, ClassLoader, Module, Version, Math used by runtime/process layer and compatibility design.

Part 21–23:
  Annotation/lambda/ClassValue/Cleaner concepts inform API contract, framework boundary, metadata, and cleanup design.

Part 24–27:
  DOM mental model and extraction layer.

Part 28–31:
  SAX event model, security hardening, streaming import pattern.

Part 32:
  Integration into production-grade boundary layer.
```

---

## 27. Final Mental Model

A mature Java engineer sees these APIs not as isolated utilities, but as contracts around boundaries:

```text
Object
  boundary of identity and equality.

Class / ClassLoader / Module
  boundary of type identity and runtime visibility.

String / Character
  boundary of text, encoding abstraction, and canonicalization.

Throwable
  boundary of failure semantics and observability.

System / Runtime / Process
  boundary between JVM and host environment.

Thread / StackWalker
  boundary of execution and diagnostics.

DOM
  boundary of XML as mutable in-memory tree.

SAX
  boundary of XML as event stream.
```

Production-grade engineering is the discipline of making those boundaries explicit.

---

## 28. Latihan / Thought Exercise

### Exercise 1 — Review existing codebase

Cari semua penggunaan langsung:

```text
DocumentBuilderFactory.newInstance()
SAXParserFactory.newInstance()
Runtime.getRuntime().exec(...)
new ProcessBuilder(...)
System.getProperty(...)
System.getenv(...)
NodeList
getElementsByTagName(...)
getTextContent()
```

Klasifikasikan:

```text
Safe as-is?
Needs wrapper?
Needs security hardening?
Needs namespace-aware rewrite?
Needs failure taxonomy?
```

---

### Exercise 2 — Design XML import policy

Untuk satu file XML production, jawab:

```text
Is input trusted?
Maximum file size?
Maximum record count?
DTD allowed?
External schema allowed?
Namespace required?
Unknown element allowed?
Partial failure allowed?
Raw XML stored?
Audit requirement?
Retry behavior?
```

---

### Exercise 3 — Build test payloads

Buat test untuk:

```text
- valid small XML
- valid large XML
- missing required element
- duplicate element
- wrong namespace
- prefix changed but same namespace
- XXE payload
- entity expansion payload
- huge text field
- fragmented SAX text simulation
```

---

### Exercise 4 — Define API invariants

Tuliskan invariant untuk:

```text
RuntimeInfoProvider
ProcessExecutor
XmlParserFactoryProvider
DomExtractor
SaxImporter
```

Jika invariant tidak bisa diuji, mungkin invariant terlalu kabur.

---

## 29. Ringkasan

Part ini menyatukan seluruh seri menjadi blueprint production-grade utility layer.

Hal paling penting:

1. `java.lang` adalah kontrak runtime dasar, bukan package trivial.
2. DOM adalah tree mutable yang harus dipakai dengan ownership, namespace, dan memory awareness.
3. SAX adalah event stream yang membutuhkan state machine eksplisit.
4. XML parser harus secure by default.
5. Process execution harus structured, timeout-bounded, dan tidak shell-string based.
6. Runtime/global state harus dibaca di boundary, bukan menyebar di domain logic.
7. Failure harus diklasifikasikan, bukan disembunyikan.
8. Compatibility Java 8–25 perlu strategi eksplisit.
9. Utility layer yang bagus adalah kumpulan boundary contract kecil, bukan helper acak.
10. Production readiness lahir dari invariants, tests, observability, dan threat model.

---

## 30. Status Seri

Seri **`learn-java-lang-dom-sax-core-runtime-platform-contracts` selesai**.

Total:

```text
Part 0  - Orientation
Part 1  - java.lang as Platform Root Contract
Part 2  - Object
Part 3  - Class<T>
Part 4  - String
Part 5  - CharSequence/StringBuilder/StringBuffer
Part 6  - Primitive Wrappers
Part 7  - Boolean/Character
Part 8  - Enum
Part 9  - Record
Part 10 - Sealed Types Runtime View
Part 11 - Throwable
Part 12 - Exception/RuntimeException/Error
Part 13 - System
Part 14 - Runtime/Process/ProcessBuilder/ProcessHandle
Part 15 - Thread/ThreadLocal
Part 16 - StackTraceElement/StackWalker
Part 17 - ClassLoader/Package/Module/Layer
Part 18 - Runtime.Version and Compatibility
Part 19 - Global State
Part 20 - Math/StrictMath/Floating Point
Part 21 - java.lang Annotations
Part 22 - FunctionalInterface/Lambda/invokedynamic Boundary
Part 23 - ClassValue/Cleaner
Part 24 - DOM Mental Model
Part 25 - DOM Creation/Mutation
Part 26 - DOM Querying
Part 27 - DOM Level 3
Part 28 - SAX Mental Model
Part 29 - SAX Namespaces/Features/Entity Resolution
Part 30 - Secure XML Parsing
Part 31 - Advanced XML Processing Patterns
Part 32 - Capstone Runtime/XML Utility Layer
```

Dengan ini, seri mencapai bagian terakhir.

---

## 31. Referensi Resmi dan Lanjutan

- Java SE 25 `java.lang` API: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/package-summary.html
- Java SE 25 `java.xml` module/API: https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/module-summary.html
- Java SE 25 `org.w3c.dom`: https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/org/w3c/dom/package-summary.html
- Java SE 25 `org.xml.sax`: https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/org/xml/sax/package-summary.html
- Java SE 25 `XMLConstants`: https://docs.oracle.com/en/java/javase/25/docs/api/java.xml/javax/xml/XMLConstants.html
- JAXP Security Guide: https://docs.oracle.com/en/java/javase/24/security/java-api-xml-processing-jaxp-security-guide.html
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/
- OpenJDK JEP 223 — New Version-String Scheme: https://openjdk.org/jeps/223
- OpenJDK JEP 238 — Multi-Release JAR Files: https://openjdk.org/jeps/238
- OpenJDK JEP 322 — Time-Based Release Versioning: https://openjdk.org/jeps/322
- OpenJDK JEP 185 — Restrict Fetching of External XML Resources: https://openjdk.org/jeps/185

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 31 — Advanced XML Processing Patterns: DOM/SAX Hybrid, Streaming State Machines, Large Documents](./31-advanced-xml-processing-patterns-dom-sax-hybrid-large-documents.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-000](../memory_management/learn-java-memory-byte-bit-buffer-offheap-gc-part-000.md)
