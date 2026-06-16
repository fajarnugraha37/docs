# learn-java-security-cryptography-integrity-part-023

# Part 23 — Secure Coding in Java: Dangerous APIs, Footguns, and Review Heuristics

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `023 / 034`  
> Status seri: **belum selesai**  
> Fokus: dangerous Java APIs, security footguns, code review heuristics, safer replacement patterns, dan cara berpikir saat membaca kode yang “kelihatannya normal” tapi sebenarnya membuka trust boundary.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas input validation, canonicalization, injection resistance, authorization integrity, token integrity, TLS, PKI, crypto primitive, key management, file security, XML security, dan lain-lain.

Part ini berbeda.

Di sini kita tidak sedang belajar satu primitive tertentu. Kita sedang membangun **insting code review security** untuk Java.

Seorang engineer yang kuat secara security tidak hanya bertanya:

> “Kode ini compile?”

atau:

> “Kode ini memenuhi acceptance criteria?”

Tetapi juga:

> “Kode ini membuka capability baru apa?”  
> “Capability ini bisa dipakai oleh input tidak dipercaya?”  
> “Apakah kode ini membuat boundary baru antara trusted dan untrusted world?”  
> “Apakah kode ini memungkinkan data berubah menjadi code, path, query, class, process, script, template, log entry, permission, atau secret exposure?”

Java sering dianggap “safe language” karena memory safety relatif lebih baik dibanding C/C++. Tetapi Java tetap punya banyak API yang sangat kuat dan berbahaya bila dipakai tanpa boundary yang jelas.

Contohnya:

- reflection dapat melewati design boundary;
- deserialization dapat mengubah bytes menjadi object graph dengan behavior;
- dynamic class loading dapat mengubah external artifact menjadi executable code;
- `ProcessBuilder` dapat mengubah string menjadi OS command;
- temporary file dapat menjadi race condition atau data leak;
- logging dapat mengubah data sensitif menjadi permanent evidence leak;
- exception handling dapat mengubah internal implementation detail menjadi attacker knowledge;
- regex dapat menjadi denial-of-service surface;
- `equals` pada secret dapat bocor melalui timing;
- classpath dapat menjadi supply-chain attack surface;
- debug endpoint dapat menjadi data exfiltration interface.

Part ini akan membantu kamu membaca kode Java dengan mental model:

> **Dangerous API bukan berarti selalu dilarang. Dangerous API berarti ia memegang capability yang harus dikontrol oleh invariant, boundary, validation, ownership, dan review.**

---

## 1. Mental Model Utama: Dangerous API = Capability Escalation

Dalam security, API berbahaya biasanya bukan berbahaya karena namanya “evil”, tetapi karena ia memberi program kemampuan untuk melakukan hal yang jauh lebih luas daripada business operation normal.

Contoh:

```java
Runtime.getRuntime().exec(userInput);
```

Masalahnya bukan hanya “command injection”. Masalah yang lebih fundamental:

> User input yang seharusnya hanya data berubah menjadi instruksi untuk operating system.

Itu adalah **capability escalation**.

Contoh lain:

```java
Class<?> clazz = Class.forName(classNameFromRequest);
Object instance = clazz.getDeclaredConstructor().newInstance();
```

Masalahnya:

> String dari luar berubah menjadi class selection dan object instantiation.

Contoh lain:

```java
ObjectInputStream in = new ObjectInputStream(request.getInputStream());
Object obj = in.readObject();
```

Masalahnya:

> Bytes dari luar berubah menjadi object graph yang dapat memicu behavior melalui constructors, `readObject`, proxies, callbacks, comparators, atau gadget chain.

Jadi saat melihat kode Java security-sensitive, jangan mulai dari API. Mulai dari transformasi:

```text
untrusted data
  -> code?
  -> command?
  -> class?
  -> path?
  -> SQL?
  -> XML entity?
  -> regex?
  -> template?
  -> URL?
  -> log?
  -> permission?
  -> identity?
  -> token?
  -> key?
  -> file?
  -> network target?
  -> serialized object?
```

Jika jawabannya “ya”, maka kode tersebut berada dalam security review zone.

---

## 2. Secure Coding Bukan Sekadar “Avoid Bad APIs”

Pendekatan dangkal:

```text
Jangan pakai reflection.
Jangan pakai Runtime.exec.
Jangan pakai ObjectInputStream.
Jangan log password.
Jangan pakai temporary file sembarangan.
```

Pendekatan senior:

```text
API ini memberi capability apa?
Siapa yang bisa memengaruhi inputnya?
Apa invariant yang harus tetap benar?
Apa bentuk eksploitnya?
Apa alternatif yang lebih sempit?
Bagaimana membuktikan penggunaannya aman?
Bagaimana failure-nya dipantau?
```

Security code review harus membedakan:

| Kategori | Artinya | Contoh |
|---|---|---|
| Forbidden | Hampir selalu tidak boleh | disable TLS cert validation, deserialize untrusted native Java object |
| Restricted | Boleh hanya dengan wrapper/policy | reflection, dynamic class loading, file extraction |
| Review-required | Boleh tapi wajib threat model | process execution, template rendering, script engine |
| Safe-by-default | Preferensi utama | typed API, allowlist, structured parser, parameterized query |
| Context-dependent | Aman/tidak tergantung boundary | logging, temporary file, URL fetching, regex |

Part ini membangun daftar **dangerous API + reasoning + safe pattern**.

---

## 3. Prinsip “Data Must Not Become Code”

Banyak vulnerability class berasal dari satu pelanggaran:

> Data tidak dipercaya diperlakukan sebagai instruksi.

Manifestasinya:

| Data berubah menjadi | Vulnerability class |
|---|---|
| SQL | SQL injection |
| OS command | command injection |
| XPath | XPath injection |
| LDAP query | LDAP injection |
| XML entity | XXE |
| Regex pattern | ReDoS / regex injection |
| Template | template injection |
| Class name | unsafe reflection/class loading |
| Serialized bytes | deserialization RCE |
| JavaScript/HTML | XSS |
| Log line | log forging / evidence corruption |
| URL | SSRF |
| File path | path traversal |
| Permission expression | authorization bypass |
| Crypto algorithm name | algorithm substitution |
| Provider name | provider confusion |
| Token header | key/algorithm confusion |

Dalam Java, ini sering terjadi karena API menerima `String`.

`String` terlihat polos. Tetapi dalam sistem, `String` bisa berarti banyak hal:

```text
String as data
String as identifier
String as path
String as command
String as query
String as expression
String as code
String as algorithm
String as class name
String as URL
String as secret
String as log line
String as policy
```

Security review harus bertanya:

> String ini sedang berada dalam grammar apa?

Karena setiap grammar punya escaping, validation, canonicalization, dan boundary sendiri.

---

## 4. Heuristic 1 — Reflection: When Metadata Becomes Execution

### 4.1 Kenapa Reflection Berbahaya?

Reflection memberi kemampuan untuk:

- memuat class berdasarkan nama;
- membaca metadata;
- mengakses field/method;
- bypass access control melalui `setAccessible(true)`;
- instantiate object;
- invoke method;
- membuat proxy;
- melakukan framework-style binding.

Reflection tidak selalu buruk. Banyak framework Java memakai reflection: Spring, Jackson, Hibernate, CDI, Jakarta EE, testing frameworks.

Masalahnya muncul ketika:

```text
untrusted input
  -> class/method/field name
  -> reflection
  -> execution or state mutation
```

### 4.2 Red Flags

```java
Class.forName(userInput);
```

```java
clazz.getMethod(methodNameFromRequest).invoke(target, args);
```

```java
field.setAccessible(true);
field.set(target, valueFromRequest);
```

```java
Method m = target.getClass().getDeclaredMethod(request.getAction());
m.invoke(target);
```

```java
Proxy.newProxyInstance(loader, interfacesFromInput, handler);
```

### 4.3 Failure Mode

#### 4.3.1 Unauthorized method invocation

Misalnya sistem punya endpoint internal:

```java
@PostMapping("/admin/action")
public Object action(@RequestParam String method) {
    Method m = adminService.getClass().getMethod(method);
    return m.invoke(adminService);
}
```

Business intention:

> “Admin bisa memanggil beberapa action maintenance.”

Security reality:

> Attacker dapat mencoba method lain yang tidak didesain sebagai API.

Walaupun method public, bukan berarti method itu aman diekspos sebagai remote operation.

#### 4.3.2 Bypass object boundary

```java
field.setAccessible(true);
```

Ini menghapus boundary yang sengaja dibuat oleh class design. Dalam framework internal mungkin sah. Dalam application business logic, ini smell kuat.

#### 4.3.3 Classpath gadget exposure

Jika class name dipilih dari input, attacker bisa memilih class yang ada di classpath dan memicu static initializer, constructor side effect, atau behavior yang tidak diduga.

### 4.4 Safer Pattern: Command Registry

Jangan biarkan user memilih method. Buat allowlist eksplisit:

```java
public interface AdminCommand {
    String name();
    AdminResult execute(AdminContext context);
}

public final class AdminCommandRegistry {
    private final Map<String, AdminCommand> commands;

    public AdminCommandRegistry(List<AdminCommand> commandList) {
        this.commands = commandList.stream()
                .collect(Collectors.toUnmodifiableMap(AdminCommand::name, Function.identity()));
    }

    public AdminResult execute(String commandName, AdminContext context) {
        AdminCommand command = commands.get(commandName);
        if (command == null) {
            throw new UnknownCommandException(commandName);
        }
        return command.execute(context);
    }
}
```

Security property:

```text
User input only selects from an explicit command registry.
User input cannot name arbitrary methods/classes.
Each command has its own authorization, validation, audit, and test.
```

### 4.5 Review Questions

- Apakah nama class/method/field berasal dari input?
- Apakah `setAccessible(true)` digunakan?
- Apakah reflection hanya untuk framework glue atau business behavior?
- Apakah ada allowlist?
- Apakah setiap reflected operation punya authorization?
- Apakah ada audit log untuk operation yang dipilih dinamis?
- Apakah input bisa memilih class dari dependency transitive?
- Apakah reflective call melewati compiler/type system yang sebelumnya menjaga invariant?

---

## 5. Heuristic 2 — Dynamic Class Loading and Plugin Systems

### 5.1 Kenapa Berbahaya?

Dynamic loading mengubah artifact menjadi executable code saat runtime.

API terkait:

```java
ClassLoader
URLClassLoader
ServiceLoader
Instrumentation
javaagent
ModuleLayer
Class.forName
```

Plugin system tampak menarik untuk extensibility, tetapi security-nya sulit.

Pertanyaan inti:

> Siapa yang boleh memasukkan code ke classpath/module path?

Jika jawabannya “external party”, maka kamu sedang mendesain execution sandbox, supply-chain trust, signature verification, permissioning, dan isolation model.

### 5.2 Red Flags

```java
URL jarUrl = new URL(request.getParameter("jar"));
URLClassLoader loader = new URLClassLoader(new URL[]{jarUrl});
Class<?> plugin = loader.loadClass(request.getParameter("class"));
```

```java
ServiceLoader.load(Processor.class);
```

`ServiceLoader` sendiri tidak buruk. Tetapi jika classpath bisa dimanipulasi, service provider dapat menjadi injection point.

### 5.3 Plugin Threat Model

| Threat | Contoh |
|---|---|
| Malicious plugin | Plugin membaca secret env var |
| Dependency hijack | Plugin membawa dependency vulnerable |
| Class shadowing | Plugin membawa class dengan nama sama |
| Static initializer side effect | Code jalan saat class load |
| Resource exhaustion | Plugin infinite loop/memory leak |
| Network exfiltration | Plugin kirim data keluar |
| Reflection abuse | Plugin akses private/internal state |
| Thread leak | Plugin membuat thread tidak terkendali |
| Native call | Plugin load library native |
| Version conflict | Plugin merusak runtime dependency |

### 5.4 Safer Pattern

Untuk plugin internal enterprise, minimal:

```text
1. Plugin source harus trusted.
2. Artifact harus signed.
3. Hash artifact diverifikasi.
4. Plugin interface dibuat sempit.
5. Tidak membagi entity/domain object internal langsung.
6. Plugin berjalan dengan timeout/resource limit.
7. Plugin tidak diberi secret.
8. Plugin action diaudit.
9. Plugin dependency di-scan.
10. Plugin deployment dikontrol CI/CD, bukan runtime upload bebas.
```

Untuk untrusted plugin, jangan mengandalkan JVM Security Manager lama sebagai sandbox utama. Security Manager sudah deprecated for removal di Java modern; desain modern biasanya menggunakan process/container isolation.

### 5.5 Review Questions

- Apakah aplikasi memuat JAR/class saat runtime?
- Apakah path/URL/class name dapat dipengaruhi user/admin?
- Apakah artifact diverifikasi signature/hash?
- Apakah plugin berjalan di process yang sama dengan secret production?
- Apakah plugin punya akses ke database/session/entity manager?
- Apakah ada allowlist plugin?
- Apakah lifecycle unload/reload aman?
- Apakah ada rollback dan kill switch?

---

## 6. Heuristic 3 — Process Execution: `Runtime.exec` and `ProcessBuilder`

### 6.1 Kenapa Berbahaya?

Process execution memberi aplikasi Java kemampuan menjalankan program OS.

API:

```java
Runtime.getRuntime().exec(...)
new ProcessBuilder(...)
```

Masalah besar:

```text
untrusted data -> command or argument -> OS process
```

### 6.2 Red Flags

```java
Runtime.getRuntime().exec("sh -c " + userInput);
```

```java
new ProcessBuilder("bash", "-c", commandFromRequest).start();
```

```java
String cmd = "convert " + uploadedFile + " " + outputFile;
Runtime.getRuntime().exec(cmd);
```

```java
new ProcessBuilder("curl", urlFromUser).start();
```

### 6.3 Mental Model: Shell vs Direct Exec

Ada perbedaan besar:

```java
new ProcessBuilder("convert", inputPath, outputPath)
```

vs:

```java
new ProcessBuilder("sh", "-c", "convert " + inputPath + " " + outputPath)
```

Jika memakai shell, karakter seperti `;`, `&&`, `|`, `$()`, backtick, redirection, wildcard, variable expansion dapat mengubah meaning.

Tetapi direct exec pun tidak otomatis aman. Argumen masih bisa menjadi:

- path traversal;
- option injection;
- file overwrite;
- SSRF target;
- denial-of-service;
- behavior change melalui argument yang dimulai `-`;
- environment leak.

### 6.4 Option Injection

Contoh:

```java
new ProcessBuilder("tar", "xf", uploadedArchiveName).start();
```

Jika `uploadedArchiveName` bernilai:

```text
--checkpoint-action=exec=sh shell.sh
```

Maka ini bukan path biasa; ia bisa diperlakukan sebagai option oleh tool tertentu.

Safer pattern:

```text
1. Jangan masukkan user input sebagai command.
2. Gunakan API/library native Java jika tersedia.
3. Jika harus process:
   - command binary hardcoded;
   - argument dipisah sebagai list;
   - no shell;
   - path canonicalized;
   - input file berada di staging dir;
   - gunakan `--` jika tool mendukung end-of-options;
   - environment minimal;
   - working directory eksplisit;
   - timeout;
   - stdout/stderr dibatasi;
   - exit code dicek;
   - privilege OS rendah;
   - sandbox/container bila perlu.
```

### 6.5 Safer Wrapper

```java
public final class SafeProcessRunner {
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(10);

    public ProcessResult runImageMetadata(Path uploadedFile) {
        Path normalized = uploadedFile.toAbsolutePath().normalize();

        if (!normalized.startsWith(Path.of("/srv/app/uploads/staging").toAbsolutePath())) {
            throw new SecurityException("Invalid input path");
        }

        List<String> command = List.of(
                "/usr/bin/exiftool",
                "--",
                normalized.toString()
        );

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(Path.of("/srv/app/sandbox").toFile());
        pb.environment().clear();
        pb.environment().put("PATH", "/usr/bin");

        return runWithTimeout(pb, DEFAULT_TIMEOUT);
    }

    private ProcessResult runWithTimeout(ProcessBuilder pb, Duration timeout) {
        // Implementation should:
        // - start process
        // - consume stdout/stderr safely
        // - enforce timeout
        // - kill process tree on timeout
        // - limit output size
        // - check exit code
        throw new UnsupportedOperationException("Example skeleton");
    }
}
```

### 6.6 Review Questions

- Apakah ada shell invocation?
- Apakah command berasal dari input?
- Apakah argument berasal dari input?
- Apakah input bisa diawali `-` dan menjadi option?
- Apakah path sudah canonicalized?
- Apakah process punya timeout?
- Apakah stdout/stderr bisa membuat memory pressure?
- Apakah environment membawa secret?
- Apakah working directory eksplisit?
- Apakah OS user punya privilege minimal?
- Apakah ada library Java yang bisa menggantikan command?

---

## 7. Heuristic 4 — Native Calls: JNI, JNA, Panama FFI

### 7.1 Kenapa Berbahaya?

Java relatif memory-safe, tetapi native boundary membawa risiko:

- memory corruption;
- arbitrary code execution;
- library loading hijack;
- platform-specific behavior;
- privilege mismatch;
- crash seluruh JVM;
- data leak dari native heap;
- unsafe pointer handling.

API dan mekanisme:

```text
System.load
System.loadLibrary
JNI
JNA
Foreign Function & Memory API
```

### 7.2 Red Flags

```java
System.load(userControlledPath);
```

```java
System.loadLibrary(libraryNameFromConfig);
```

```java
Native.load(request.getParameter("lib"), SomeInterface.class);
```

### 7.3 Safer Pattern

```text
1. Native library path hardcoded or deployment-controlled.
2. Artifact hash/signature verified.
3. No user-controlled library name/path.
4. OS-level permission restricted.
5. Library loaded once at startup.
6. Clear compatibility matrix.
7. Native calls wrapped in narrow interface.
8. Inputs validated before native boundary.
9. Fuzz testing for native parser boundary.
10. Crash isolation via separate process if high risk.
```

### 7.4 Review Questions

- Apakah native library berasal dari trusted build?
- Apakah path dapat dimanipulasi?
- Apakah library search path aman?
- Apakah native call menerima untrusted file/network data?
- Apakah crash native dapat menjatuhkan JVM production?
- Apakah native library punya CVE tracking?
- Apakah ada fallback atau graceful degradation?

---

## 8. Heuristic 5 — Temporary Files and Directories

### 8.1 Kenapa Temporary File Berbahaya?

Temporary file sering dianggap detail teknis, padahal bisa menjadi:

- data leak;
- symlink attack;
- race condition;
- insecure permission;
- predictable path;
- orphaned sensitive file;
- cross-tenant data exposure;
- malware staging;
- disk exhaustion.

API:

```java
File.createTempFile(...)
Files.createTempFile(...)
Files.createTempDirectory(...)
java.io.tmpdir
```

### 8.2 Red Flags

```java
Path p = Paths.get("/tmp/" + userId + ".pdf");
Files.writeString(p, sensitiveContent);
```

```java
File temp = new File(System.getProperty("java.io.tmpdir"), fileNameFromUser);
```

```java
Files.createFile(Paths.get("/tmp/report.txt"));
```

### 8.3 Safer Pattern

```java
Path secureTempDir = Files.createTempDirectory("app-work-");

Path tempFile = Files.createTempFile(
        secureTempDir,
        "upload-",
        ".bin"
);

try {
    Files.write(tempFile, bytes, StandardOpenOption.WRITE);
    // process file
} finally {
    try {
        Files.deleteIfExists(tempFile);
    } finally {
        Files.deleteIfExists(secureTempDir);
    }
}
```

Lebih baik lagi:

```text
1. Gunakan directory kerja private per application/tenant/request.
2. Jangan gunakan filename dari user langsung.
3. Gunakan `Files.createTempFile`, bukan membuat path manual.
4. Set permission terbatas jika OS mendukung.
5. Cleanup di finally.
6. Jangan simpan secret jangka panjang di temp.
7. Jangan expose temp dir lewat static web server.
8. Monitor disk usage.
```

### 8.4 Secure Permission Example

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");

Path temp = Files.createTempFile(
        "secret-",
        ".tmp",
        PosixFilePermissions.asFileAttribute(perms)
);
```

Catatan: POSIX permission tidak selalu tersedia di semua OS/file system. Untuk Windows, security model berbeda. Jangan membuat portability assumption tanpa test.

### 8.5 Review Questions

- Apakah path temporary predictable?
- Apakah filename berasal dari user?
- Apakah file berisi secret/PII?
- Apakah permission default cukup sempit?
- Apakah cleanup reliable?
- Apakah file dapat dibaca process/user lain?
- Apakah ada quota?
- Apakah temp file bisa menjadi path traversal target?
- Apakah symlink attack mungkin?

---

## 9. Heuristic 6 — File Path Construction and Filesystem Access

Walaupun path traversal sudah dibahas di Part 17/22, di sini fokusnya code smell.

### 9.1 Red Flags

```java
Path file = Paths.get(baseDir, request.getParameter("filename"));
```

```java
File file = new File("/data/reports/" + userInput);
```

```java
Files.readString(Path.of(pathFromHeader));
```

```java
response.setHeader("Content-Disposition", "attachment; filename=" + filename);
```

### 9.2 Safer Pattern

```java
public final class SafeFileResolver {
    private final Path root;

    public SafeFileResolver(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    public Path resolveUserFile(String unsafeName) {
        if (!unsafeName.matches("[a-zA-Z0-9._-]{1,100}")) {
            throw new IllegalArgumentException("Invalid filename");
        }

        Path resolved = root.resolve(unsafeName).normalize();

        if (!resolved.startsWith(root)) {
            throw new SecurityException("Path escapes root");
        }

        return resolved;
    }
}
```

### 9.3 Important Distinction

Validation alone is not enough:

```text
validate filename
+ normalize path
+ check startsWith root
+ avoid following unsafe symlink
+ enforce authorization for the resolved resource
```

Jika file adalah business object, jangan hanya authorize berdasarkan path. Authorize berdasarkan domain record:

```text
caseId -> document metadata -> storage object key -> authorized user
```

Bukan:

```text
user can request arbitrary file path under /documents
```

---

## 10. Heuristic 7 — Logging Secrets and Log Forging

### 10.1 Kenapa Logging Berbahaya?

Log sering:

- dikirim ke central system;
- disimpan lama;
- diakses banyak tim;
- diindeks penuh;
- masuk alert, dashboard, SIEM;
- dicopy ke ticket;
- dibagikan ke vendor;
- tidak terenkripsi end-to-end;
- sulit dihapus selektif.

Jadi:

> Log adalah data distribution system.

Jika secret masuk log, secret itu sudah bocor secara operasional.

### 10.2 Red Flags

```java
log.info("Login request: {}", loginRequest);
```

```java
log.debug("Authorization header: {}", request.getHeader("Authorization"));
```

```java
log.error("Failed with token {}", token, ex);
```

```java
log.info("User input: {}", userInput);
```

```java
log.info("Downloaded file: " + filenameFromUser);
```

### 10.3 Sensitive Data Classes

Jangan log:

```text
password
password hash
OTP
recovery code
access token
refresh token
ID token
session ID
API key
private key
secret key
database credential
Authorization header
Cookie header
full PII
payment data
raw document contents
security answers
signed URL
pre-signed object key if sensitive
```

### 10.4 Log Forging

Jika user input mengandung newline:

```text
hello
ERROR admin login succeeded
```

Maka log bisa terlihat seperti event berbeda.

Mitigasi:

```text
1. Structured logging.
2. Escape newline/control characters.
3. Avoid concatenation.
4. Use explicit event fields.
5. Redact sensitive fields.
6. Keep audit log separate from debug log.
```

### 10.5 Safer Pattern: Redacted Value Object

```java
public record AccessToken(String value) {
    @Override
    public String toString() {
        return "[REDACTED_ACCESS_TOKEN]";
    }
}
```

Tapi jangan mengandalkan `toString()` saja. Logging framework, JSON serializer, exception, debugger, heap dump, atau map dump masih bisa bocor.

Lebih baik:

```java
public final class SecurityLog {
    private SecurityLog() {}

    public static String tokenFingerprint(String token) {
        if (token == null || token.isBlank()) {
            return "absent";
        }
        return "sha256:" + shortHash(token);
    }

    private static String shortHash(String value) {
        // Use SHA-256 and return first N chars for correlation.
        // Do not use this as password hashing.
        throw new UnsupportedOperationException("Example skeleton");
    }
}
```

Log fingerprint, bukan token.

### 10.6 Review Questions

- Apakah DTO dengan secret punya `toString()`?
- Apakah request/response body di-log?
- Apakah exception message mengandung secret?
- Apakah token/cookie/header di-log?
- Apakah logs disanitasi dari CR/LF?
- Apakah audit log berbeda dari debug log?
- Apakah log retention sesuai sensitivitas?
- Apakah production debug logging bisa dinyalakan sembarangan?
- Apakah PII minimization diterapkan?

---

## 11. Heuristic 8 — Exception Disclosure

### 11.1 Kenapa Error Message Berbahaya?

Exception bisa membocorkan:

- SQL query;
- table/column name;
- file path;
- class/package name;
- internal endpoint;
- cloud resource name;
- secret/config;
- stack trace;
- tenant ID;
- auth logic;
- existence of object;
- cryptographic validation detail.

### 11.2 Red Flags

```java
catch (Exception e) {
    return ResponseEntity.status(500).body(e.getMessage());
}
```

```java
throw new RuntimeException("Invalid token: " + token);
```

```java
throw new IllegalArgumentException("User " + userId + " is not owner of case " + caseId);
```

```java
return Map.of("error", ex.toString(), "stackTrace", stackTrace);
```

### 11.3 Safer Pattern: Internal Error Code + External Generic Message

```java
public record ApiError(
        String code,
        String message,
        String correlationId
) {}
```

```java
@ExceptionHandler(AccessDeniedException.class)
public ResponseEntity<ApiError> accessDenied(AccessDeniedException ex, HttpServletRequest req) {
    String correlationId = currentCorrelationId();

    log.warn("access_denied correlationId={} reason={}", correlationId, ex.safeReason());

    return ResponseEntity.status(403).body(new ApiError(
            "ACCESS_DENIED",
            "You are not allowed to perform this operation.",
            correlationId
    ));
}
```

### 11.4 Important: Avoid Existence Oracle

Untuk object authorization:

```text
404 vs 403
```

dapat membocorkan apakah resource ada.

Contoh:

```text
GET /cases/123
```

Jika unauthorized user mendapat:

```text
403 -> case exists but you cannot access
404 -> case does not exist or not accessible
```

Terkadang 404 lebih aman. Tetapi ini harus konsisten dengan product/security requirement.

### 11.5 Review Questions

- Apakah response mengandung stack trace?
- Apakah error message membocorkan object existence?
- Apakah invalid token error terlalu detail?
- Apakah database error keluar ke client?
- Apakah log internal cukup untuk debugging tanpa membocorkan ke client?
- Apakah correlation ID tersedia?
- Apakah exception mengandung secret di message?
- Apakah global exception handler punya safe default?

---

## 12. Heuristic 9 — Unsafe String Comparison for Secrets

### 12.1 Problem

Membandingkan secret dengan `String.equals` bisa membuka timing side-channel pada konteks tertentu.

Contoh:

```java
if (providedSignature.equals(expectedSignature)) {
    accept();
}
```

Untuk MAC/signature token berbentuk bytes/string, gunakan constant-time comparison.

### 12.2 Safer Pattern

Untuk bytes:

```java
boolean valid = MessageDigest.isEqual(providedMac, expectedMac);
```

Untuk encoded string, decode dulu ke bytes dengan validasi format:

```java
byte[] provided = Base64.getUrlDecoder().decode(providedMacB64);
byte[] expected = computeExpectedMac(...);

if (!MessageDigest.isEqual(provided, expected)) {
    throw new InvalidMacException();
}
```

### 12.3 Pitfall

Constant-time comparison tidak menyelamatkan jika:

- panjang input divalidasi dengan timing berbeda;
- parsing gagal dengan waktu berbeda;
- error message berbeda;
- database lookup membocorkan info;
- HMAC canonical string salah;
- secret sudah masuk log.

### 12.4 Review Questions

- Apakah signature/MAC/token dibandingkan dengan `equals`?
- Apakah comparison dilakukan pada bytes?
- Apakah decode/parsing error dibuat seragam?
- Apakah response time bisa menjadi oracle?
- Apakah error message membedakan “unknown key”, “bad MAC”, “expired”, “wrong issuer” dengan cara berbahaya?

---

## 13. Heuristic 10 — Mutable Security State and Shared Objects

### 13.1 Problem

Security state sebaiknya immutable atau dikontrol ketat.

Dangerous examples:

```java
public class UserContext {
    public Long userId;
    public List<String> roles;
    public boolean admin;
}
```

```java
SecurityContextHolder.getContext().getAuthentication().getAuthorities().add(...);
```

```java
request.setAttribute("isAdmin", true);
```

Masalah:

- state bisa berubah di layer tidak terduga;
- authorization decision bisa melihat state yang sudah dimodifikasi;
- object reuse/thread reuse dapat bocor;
- cache dapat menyimpan permission usang.

### 13.2 Safer Pattern

```java
public record AuthenticatedPrincipal(
        String subject,
        Set<String> roles,
        Set<String> permissions,
        String tenantId
) {
    public AuthenticatedPrincipal {
        roles = Set.copyOf(roles);
        permissions = Set.copyOf(permissions);
    }
}
```

Security property:

```text
Principal immutable after authentication.
Authorization reads immutable snapshot.
Permission escalation requires new authentication/authorization evaluation.
```

### 13.3 Review Questions

- Apakah security context mutable?
- Apakah roles/permissions dapat diubah setelah login?
- Apakah cache permission punya invalidation?
- Apakah tenant context disimpan di static/thread-local tanpa cleanup?
- Apakah async execution membawa context yang salah?
- Apakah test mencakup cross-request/cross-tenant leakage?

---

## 14. Heuristic 11 — ThreadLocal and Security Context Leakage

### 14.1 Problem

Banyak Java framework memakai `ThreadLocal` untuk context:

- request context;
- security principal;
- tenant;
- correlation ID;
- locale;
- transaction;
- MDC logging.

Masalah muncul pada thread pool:

```text
request A sets ThreadLocal
thread reused
request B sees stale ThreadLocal
```

### 14.2 Red Flags

```java
private static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();
```

```java
CURRENT_USER.set(user);
// no cleanup
```

```java
MDC.put("userId", userId);
// no MDC.clear()
```

### 14.3 Safer Pattern

```java
try {
    CurrentUser.set(user);
    MDC.put("correlationId", correlationId);

    chain.doFilter(request, response);
} finally {
    CurrentUser.clear();
    MDC.clear();
}
```

### 14.4 Virtual Threads Note

Dengan virtual threads, ThreadLocal tetap ada, tetapi usage pattern harus dipahami. Jangan menganggap virtual thread otomatis menyelesaikan context leakage. Scoped values dapat menjadi alternatif lebih terstruktur pada Java modern, tetapi desain context propagation tetap harus eksplisit.

### 14.5 Review Questions

- Apakah `ThreadLocal` selalu dibersihkan?
- Apakah MDC dibersihkan?
- Apakah async task membawa security context?
- Apakah scheduled job mewarisi context request?
- Apakah context cross-tenant bisa bocor?
- Apakah library menggunakan inheritable thread-local?

---

## 15. Heuristic 12 — URL Fetching and SSRF

### 15.1 Problem

Java service sering mengambil URL dari user/admin:

```java
URL url = new URL(request.getParameter("url"));
InputStream in = url.openStream();
```

Ini bisa menjadi Server-Side Request Forgery.

Attacker dapat meminta server mengakses:

```text
http://localhost:8080/admin
http://127.0.0.1
http://169.254.169.254/latest/meta-data
http://internal-service.namespace.svc
file:///etc/passwd
jar:http://...
gopher://...
```

### 15.2 Red Flags

```java
URI uri = URI.create(callbackUrlFromUser);
httpClient.send(HttpRequest.newBuilder(uri).build(), BodyHandlers.ofString());
```

```java
imageService.downloadAvatar(userProvidedUrl);
```

```java
webhookTester.ping(urlFromRequest);
```

### 15.3 Safer Pattern

```text
1. Prefer not fetching arbitrary URL.
2. Use allowlist of domains.
3. Enforce scheme: https only.
4. Resolve DNS and block private/link-local/loopback ranges.
5. Protect against DNS rebinding.
6. Disable redirects or revalidate redirect target.
7. Set timeout and size limit.
8. Do not send internal credentials.
9. Use egress firewall.
10. Log destination safely.
```

### 15.4 Review Questions

- Apakah URL berasal dari user/admin?
- Apakah scheme dibatasi?
- Apakah redirect dikontrol?
- Apakah private IP/link-local diblokir?
- Apakah DNS rebinding dipertimbangkan?
- Apakah service punya egress policy?
- Apakah response size dibatasi?
- Apakah URL dapat mengakses metadata service/cloud credentials?

---

## 16. Heuristic 13 — Regex as Attack Surface

### 16.1 Problem

Regex bisa menyebabkan ReDoS jika pattern punya catastrophic backtracking.

Red flags:

```java
Pattern.compile(userProvidedRegex);
```

```java
input.matches("(a+)+$")
```

```java
Pattern.compile("([a-zA-Z]+)*")
```

### 16.2 Two Distinct Risks

| Risk | Meaning |
|---|---|
| User-controlled pattern | User menentukan regex grammar |
| Dangerous static pattern | Developer menulis regex dengan exponential backtracking |

### 16.3 Safer Pattern

```text
1. Jangan izinkan user memberikan regex arbitrary.
2. Gunakan allowlist/simple contains/search DSL.
3. Batasi input length.
4. Review regex dengan ReDoS analyzer.
5. Gunakan timeout jika library mendukung.
6. Hindari nested quantifier berbahaya.
7. Prefer parser untuk grammar kompleks.
```

### 16.4 Review Questions

- Apakah regex berasal dari user/admin?
- Apakah input length dibatasi sebelum regex?
- Apakah pattern punya nested quantifier?
- Apakah regex dipakai di endpoint high traffic?
- Apakah ada benchmark worst-case?
- Apakah regex bisa diganti parser/allowlist?

---

## 17. Heuristic 14 — Template Engines and Expression Languages

### 17.1 Problem

Template engine dapat mengubah data menjadi code/expression.

Contoh teknologi:

```text
SpEL
MVEL
OGNL
JEXL
FreeMarker
Velocity
Thymeleaf expressions
Jakarta EL
Groovy scripts
JSR-223 script engine
```

### 17.2 Red Flags

```java
ExpressionParser parser = new SpelExpressionParser();
Expression exp = parser.parseExpression(userInput);
Object value = exp.getValue(context);
```

```java
templateEngine.process(templateFromDatabaseEditedByAdmin, context);
```

```java
ScriptEngine engine = manager.getEngineByName("javascript");
engine.eval(scriptFromUser);
```

### 17.3 Threats

- method invocation;
- class access;
- bean access;
- file/network access;
- reflection;
- object graph traversal;
- secret exfiltration;
- sandbox escape;
- denial-of-service.

### 17.4 Safer Pattern

```text
1. Treat template as code if it supports logic/expression.
2. Only trusted authors may edit executable templates.
3. For user-authored content, use logic-less templates or markdown with sanitizer.
4. Restrict context object to DTO, not service/container/root object.
5. Disable method/class access if possible.
6. Precompile and review templates.
7. Audit template changes.
8. Version templates.
9. Do not expose secrets in template context.
10. Use rendering timeout/size limits.
```

### 17.5 Review Questions

- Apakah template bisa diedit user/admin?
- Apakah template engine punya expression language?
- Apakah expression bisa invoke method/class?
- Apakah context mengandung service/repository/security context?
- Apakah output disanitasi sesuai sink?
- Apakah template change diaudit?
- Apakah template rendering punya timeout?

---

## 18. Heuristic 15 — Debug, Actuator, JMX, and Diagnostic Surfaces

### 18.1 Problem

Diagnostic tools sangat berguna tetapi sering membawa data sensitif.

Surface:

```text
Spring Boot Actuator
JMX
heap dump
thread dump
environment endpoint
config endpoint
metrics
debug logs
profilers
remote debugging
Java agents
```

### 18.2 Red Flags

```text
management.endpoints.web.exposure.include=*
```

```text
-Dcom.sun.management.jmxremote.authenticate=false
```

```text
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

```java
return System.getenv();
```

### 18.3 Risks

- secret exposure;
- heap dump contains tokens/passwords;
- thread dump contains request data;
- environment endpoint leaks credentials;
- JMX can invoke operations;
- remote debug can execute code;
- metrics labels leak PII;
- actuator shutdown can stop app.

### 18.4 Safer Pattern

```text
1. Production diagnostics disabled by default.
2. Expose only required endpoints.
3. Require strong auth and network restriction.
4. Redact env/config.
5. Never expose heap dump publicly.
6. Disable remote debugging in production.
7. Separate admin network.
8. Audit access.
9. Short-lived break-glass procedure.
10. Sanitized support bundle.
```

### 18.5 Review Questions

- Apakah actuator expose `env`, `heapdump`, `threaddump`, `configprops`?
- Apakah JMX authenticated?
- Apakah remote debug terbuka?
- Apakah metrics label mengandung user/case/document ID?
- Apakah support bundle mengandung secret?
- Apakah diagnostic access diaudit?

---

## 19. Heuristic 16 — Object Mapping, Mass Assignment, and Binder Risks

### 19.1 Problem

Auto-binding membuat request body langsung menjadi object.

Contoh:

```java
@PostMapping("/users/{id}")
public User update(@RequestBody User user) {
    return userRepository.save(user);
}
```

Jika `User` entity punya field:

```java
private boolean admin;
private String role;
private String tenantId;
private AccountStatus status;
```

attacker dapat mengirim field yang tidak seharusnya dapat diubah.

### 19.2 Red Flags

```java
@RequestBody Entity entity
```

```java
BeanUtils.copyProperties(request, entity);
```

```java
modelMapper.map(dto, entity);
```

```java
objectMapper.readerForUpdating(existing).readValue(json);
```

### 19.3 Safer Pattern: Command DTO

```java
public record UpdateUserProfileCommand(
        String displayName,
        String phoneNumber
) {}
```

```java
public void updateProfile(UserId targetUserId, UpdateUserProfileCommand command, Actor actor) {
    User user = userRepository.get(targetUserId);

    authorization.requireCanUpdateProfile(actor, user);

    user.changeDisplayName(command.displayName());
    user.changePhoneNumber(command.phoneNumber());

    userRepository.save(user);
}
```

Security property:

```text
Request can only carry fields allowed by the command.
Sensitive fields are changed only by explicit domain methods.
Authorization happens before mutation.
```

### 19.4 Review Questions

- Apakah entity digunakan sebagai request body?
- Apakah mapping otomatis mengubah sensitive fields?
- Apakah unknown JSON fields ditolak?
- Apakah role/status/tenant/owner dapat diubah dari client?
- Apakah domain method menjaga invariant?
- Apakah patch/update semantics eksplisit?

---

## 20. Heuristic 17 — Unsafe Use of `toString`, `equals`, `hashCode`

### 20.1 `toString` Leak

DTO/entity sering punya generated `toString()`:

```java
@Data
public class LoginRequest {
    private String username;
    private String password;
}
```

Lombok `@Data` membuat `toString()` yang bisa memasukkan password.

Safer:

```java
@Getter
@Setter
@ToString(exclude = "password")
public class LoginRequest {
    private String username;
    private String password;
}
```

Lebih baik, gunakan dedicated secret type atau hindari logging object request.

### 20.2 `equals`/`hashCode` on Mutable/Sensitive Fields

Jika object security state mutable dan dipakai sebagai key di map/set, perubahan field dapat merusak lookup.

```java
Set<Permission> permissions = new HashSet<>();
permission.setName("ADMIN");
```

### 20.3 Review Questions

- Apakah Lombok `@Data` dipakai pada class dengan secret?
- Apakah `toString()` membocorkan token/password?
- Apakah mutable object dipakai sebagai map key?
- Apakah `equals`/`hashCode` menggunakan field sensitif?
- Apakah entity logging otomatis aktif?

---

## 21. Heuristic 18 — Java Time, Expiry, and Security Windows

### 21.1 Problem

Security bergantung pada waktu:

- token expiry;
- nonce window;
- replay prevention;
- certificate validity;
- password reset TTL;
- lockout duration;
- audit timestamp;
- retention.

Red flags:

```java
if (tokenExpiry.isAfter(LocalDateTime.now())) { ... }
```

```java
Instant now = Instant.now();
```

`Instant.now()` sendiri tidak buruk. Masalahnya saat clock tidak injectable/testable atau timezone semantics salah.

### 21.2 Safer Pattern

```java
public final class TokenVerifier {
    private final Clock clock;

    public TokenVerifier(Clock clock) {
        this.clock = clock;
    }

    public void verify(Token token) {
        Instant now = clock.instant();

        if (token.expiresAt().isBefore(now)) {
            throw new TokenExpiredException();
        }
    }
}
```

### 21.3 Review Questions

- Apakah expiry pakai `LocalDateTime` tanpa timezone?
- Apakah clock injectable?
- Apakah ada leeway/skew policy?
- Apakah expired token masih diterima terlalu lama?
- Apakah replay window terlalu luas?
- Apakah audit timestamp berasal dari trusted source?
- Apakah time comparison diuji di boundary?

---

## 22. Heuristic 19 — Crypto API Footguns in Ordinary Code

Walaupun crypto API sudah dibahas di part sebelumnya, code review perlu punya radar cepat.

### 22.1 Red Flags

```java
Cipher.getInstance("AES");
```

Biasanya default provider dapat memilih mode/padding yang tidak eksplisit. Selalu spesifik.

```java
new SecretKeySpec("password".getBytes(), "AES");
```

Password bukan key.

```java
new IvParameterSpec(new byte[16]);
```

IV statis.

```java
MessageDigest.getInstance("MD5");
```

MD5 bukan untuk security integrity.

```java
Signature.getInstance("SHA1withRSA");
```

SHA-1 legacy-danger.

```java
TrustManager[] trustAll = ...
```

Disable certificate validation.

```java
HostnameVerifier allHostsValid = (hostname, session) -> true;
```

Disable hostname verification.

```java
new Random()
```

Bukan untuk secret/token.

### 22.2 Review Questions

- Apakah algorithm eksplisit dan modern?
- Apakah key berasal dari KDF/key generator?
- Apakah nonce/IV unik?
- Apakah AEAD digunakan untuk encryption?
- Apakah MAC dibandingkan constant-time?
- Apakah TLS validation dimatikan?
- Apakah fallback algorithm aman?
- Apakah secret masuk string/log/heap dump?

---

## 23. Heuristic 20 — Dangerous Configuration as Code

Security bug tidak selalu di Java source. Bisa di config:

```properties
server.error.include-stacktrace=always
management.endpoints.web.exposure.include=*
spring.jackson.deserialization.fail-on-unknown-properties=false
logging.level.org.springframework.security=DEBUG
```

```yaml
cors:
  allowed-origins: "*"
```

```properties
javax.net.ssl.trustStore=/tmp/debug-truststore.jks
```

```java
System.setProperty("jdk.tls.client.protocols", "TLSv1,TLSv1.1,TLSv1.2");
```

Review harus meliputi:

```text
source code
build script
dependency config
container image
environment variable
JVM flags
Kubernetes manifest
Spring config
logging config
TLS config
CI/CD config
```

---

## 24. A Practical Dangerous API Catalog

| Area | Dangerous API / Pattern | Main Risk | Safer Direction |
|---|---|---|---|
| Reflection | `Class.forName`, `Method.invoke`, `setAccessible` | Unauthorized behavior, boundary bypass | registry, allowlist, typed interface |
| Process | `Runtime.exec`, `ProcessBuilder("sh","-c",...)` | command injection, option injection | no shell, hardcoded binary, args list, timeout |
| Deserialization | `ObjectInputStream.readObject` | RCE/gadget chain | avoid native serialization, filters, DTO |
| Dynamic loading | `URLClassLoader`, runtime plugin JAR | malicious code execution | signed artifacts, isolation |
| Native | `System.load`, JNI/JNA | memory corruption, library hijack | fixed path, signature, isolation |
| Files | manual `/tmp`, user filename | traversal, leak, race | `Files.createTempFile`, normalize, private dir |
| Network | fetch user URL | SSRF | allowlist, egress control, redirect validation |
| Logging | log request/token/body | secret/PII leak, log forging | structured log, redaction |
| Exception | return `ex.getMessage()` | information disclosure | generic external error, internal correlation |
| Regex | user regex, nested quantifier | ReDoS | allowlist DSL, length limit, review |
| Template | expression eval | code execution | trusted template, restricted context |
| Binder | entity as request body | mass assignment | command DTO |
| Crypto | `AES`, MD5, trust-all TLS | broken crypto | explicit modern algorithm |
| Time | `LocalDateTime.now()` for expiry | timezone/skew bug | `Clock`, `Instant`, leeway policy |
| Diagnostics | actuator/JMX/debug | secret leak/RCE | restrict, auth, network isolation |

---

## 25. Secure Code Review Workflow for Java

### 25.1 Step 1 — Identify Capability-Expanding Changes

Tandai PR jika menambah/mengubah:

```text
reflection
process execution
file upload/download
archive extraction
serialization/deserialization
class loading/plugin
template/expression
URL fetching
crypto/TLS/token
auth/authz
logging/error handling
temporary file
native library
config exposure
diagnostic endpoint
dependency/build plugin
```

### 25.2 Step 2 — Trace Input Influence

Untuk setiap dangerous API:

```text
Can external input influence:
- command?
- argument?
- path?
- URL?
- class?
- method?
- field?
- template?
- regex?
- serialized bytes?
- SQL/query?
- algorithm?
- key ID?
- log line?
```

Jika ya, harus ada allowlist/canonicalization/authorization/limit.

### 25.3 Step 3 — Define Invariant

Contoh invariant:

```text
User input must never select arbitrary Java classes.
Uploaded archive must never write outside staging directory.
Webhook must never be accepted without valid MAC and replay check.
Support logs must never contain access token or password.
Only signed and approved plugins may run in production.
Public API must never reveal whether unauthorized case ID exists.
```

### 25.4 Step 4 — Check Enforcement Location

Invariant harus ditegakkan di boundary paling awal yang benar.

Buruk:

```text
Controller passes raw user path to service.
Service assumes repository will check path.
Repository reads file.
```

Lebih baik:

```text
Controller validates command shape.
Service authorizes domain operation.
Storage resolver canonicalizes object key.
Repository only receives safe storage ID.
```

### 25.5 Step 5 — Check Negative Tests

Setiap dangerous API harus punya negative tests:

```text
path traversal rejected
newline log injection sanitized
oversized regex input rejected
unknown command rejected
unauthorized object hidden
invalid MAC rejected
expired token rejected
redirect-to-private-IP blocked
archive entry outside root rejected
unknown JSON field rejected
```

### 25.6 Step 6 — Operational Guardrail

Kode yang aman tetap butuh guardrail:

```text
timeout
rate limit
memory limit
file size limit
egress policy
least privilege
audit log
alert
kill switch
rotation
dependency scan
config validation at startup
```

---

## 26. Secure Wrapper Pattern

Salah satu cara terbaik mengurangi dangerous API adalah membuat wrapper internal yang sempit.

Contoh:

```text
Unsafe capability:
  ProcessBuilder

Internal safe abstraction:
  ImageMetadataExtractor.extract(Path uploadedFile)

Properties:
  - binary fixed
  - no shell
  - input path canonicalized
  - staging dir enforced
  - timeout enforced
  - output size limited
  - environment stripped
  - errors normalized
  - audit event emitted
```

### 26.1 Bad Layering

```java
public Process run(String command) { ... }
```

Ini wrapper palsu. Ia tetap memberi arbitrary process execution.

### 26.2 Good Layering

```java
public ImageMetadata extractMetadata(UploadedFileId id) { ... }
```

Ini wrapper domain-specific. Pemanggil tidak bisa memilih command.

### 26.3 Rule

> Jangan wrap dangerous API dengan abstraction yang masih mengekspos capability berbahaya secara generik.

---

## 27. Mini Case Study — Secure Admin Maintenance Action

### 27.1 Bad Design

```java
@PostMapping("/maintenance")
public Object maintenance(@RequestParam String action) throws Exception {
    Method m = maintenanceService.getClass().getMethod(action);
    return m.invoke(maintenanceService);
}
```

Problem:

- user memilih method;
- no allowlist;
- no per-action authorization;
- no audit semantics;
- method public otomatis exposed;
- error bisa reveal method names;
- sulit test abuse case.

### 27.2 Better Design

```java
public interface MaintenanceAction {
    String name();
    Permission requiredPermission();
    MaintenanceResult run(MaintenanceInput input, Actor actor);
}
```

```java
public final class MaintenanceActionRegistry {
    private final Map<String, MaintenanceAction> actions;

    public MaintenanceActionRegistry(List<MaintenanceAction> actions) {
        this.actions = actions.stream()
                .collect(Collectors.toUnmodifiableMap(MaintenanceAction::name, Function.identity()));
    }

    public MaintenanceResult execute(String actionName, MaintenanceInput input, Actor actor) {
        MaintenanceAction action = actions.get(actionName);

        if (action == null) {
            throw new UnknownMaintenanceActionException();
        }

        if (!actor.has(action.requiredPermission())) {
            throw new AccessDeniedException("maintenance action denied");
        }

        return action.run(input, actor);
    }
}
```

Security invariant:

```text
Only registered maintenance actions are executable.
Each action declares required permission.
Unknown action does not reveal internal method/class list.
Every execution can be audited by action name and actor.
```

### 27.3 Further Hardening

```text
- require approval for destructive action;
- require reason/comment;
- emit audit event;
- rate limit;
- dry-run mode;
- dual control for high-risk action;
- maintenance window;
- feature flag/kill switch;
- structured result;
- idempotency key for retry safety;
- test unauthorized/unknown/destructive flow.
```

---

## 28. Mini Case Study — Secure External File Conversion

### 28.1 Bad Design

```java
String cmd = "libreoffice --convert-to pdf " + uploadedPath;
Runtime.getRuntime().exec(cmd);
```

Problems:

- shell parsing risk;
- path injection;
- option injection;
- no timeout;
- no output limit;
- environment leaks;
- process may hang;
- uploaded file may exploit converter;
- output path may overwrite;
- no sandbox.

### 28.2 Safer Design

```text
Upload
  -> store in staging dir with random name
  -> validate type/size
  -> virus/content scan if required
  -> run converter in isolated container/process
  -> no shell
  -> fixed command
  -> `--` before file path if supported
  -> timeout
  -> memory/CPU limit
  -> output dir private
  -> verify output type
  -> move to final storage atomically
  -> delete staging
  -> audit conversion
```

Security invariant:

```text
Uploaded content may be malicious, but it cannot control command structure,
cannot write outside staging/output directory, cannot access secrets,
cannot run indefinitely, and cannot become trusted output without validation.
```

---

## 29. Security Review Smell Catalog

### 29.1 Strong Smells

These almost always require review:

```text
setAccessible(true)
Runtime.exec
ProcessBuilder
ObjectInputStream
readObject
Class.forName(input)
URLClassLoader
System.load
ScriptEngine.eval
ExpressionParser.parseExpression
Files.readString(pathFromInput)
new File("/tmp/" + ...)
log.info(request)
return ex.getMessage()
HostnameVerifier returns true
TrustManager accepts all
Cipher.getInstance("AES")
new Random for token
entity as @RequestBody
BeanUtils.copyProperties(request, entity)
management exposure include *
remote debug flag
```

### 29.2 Subtle Smells

```text
String algorithm from config
String keyId from token header without allowlist
MDC not cleared
ThreadLocal not cleared
unknown JSON fields accepted
DTO includes role/status/tenantId
regex contains nested quantifier
URL redirect not revalidated
archive extraction no normalize+startsWith check
audit log mixed with debug log
error response differs for unauthorized resource existence
temporary file stores PII
feature flag bypasses authorization
admin endpoint lacks per-action permission
```

---

## 30. “Safe Enough” Decision Framework

Tidak semua risky API bisa dihapus. Kadang bisnis butuh:

- PDF conversion;
- plugin;
- template;
- admin maintenance action;
- URL callback;
- file import;
- dynamic report;
- custom rule engine.

Maka gunakan framework ini:

```text
1. Necessity
   Apakah capability ini benar-benar dibutuhkan?

2. Narrowing
   Bisakah capability dipersempit ke domain-specific API?

3. Input influence
   Bagian mana yang bisa dikontrol user?

4. Isolation
   Bisakah dipisah process/container/account/network?

5. Verification
   Apa yang diverifikasi sebelum dan sesudah?

6. Authorization
   Siapa yang boleh memicu capability?

7. Auditability
   Apa yang dicatat sebagai evidence?

8. Limits
   Apa timeout/size/rate/resource limit?

9. Recovery
   Bagaimana kill switch/rollback/cleanup?

10. Tests
   Abuse case apa yang diuji?
```

---

## 31. Production Checklist

Gunakan checklist ini saat review PR Java security-sensitive.

### 31.1 Code Capability

- [ ] Tidak ada arbitrary process execution.
- [ ] Tidak ada user-controlled reflection.
- [ ] Tidak ada unsafe native Java deserialization.
- [ ] Tidak ada runtime class loading dari untrusted source.
- [ ] Tidak ada template/expression execution dari untrusted input.
- [ ] Tidak ada native library loading dari path tidak dipercaya.
- [ ] Tidak ada arbitrary URL fetch tanpa SSRF control.

### 31.2 Input Boundary

- [ ] Input divalidasi sebagai data, bukan instruksi.
- [ ] Path dinormalisasi dan dicek tidak keluar root.
- [ ] URL scheme/host/IP/redirect dikontrol.
- [ ] Regex tidak user-controlled atau dibatasi.
- [ ] JSON unknown fields ditangani sesuai policy.
- [ ] DTO request tidak langsung entity.

### 31.3 Secret and Logging

- [ ] Password/token/API key/cookie tidak di-log.
- [ ] DTO secret tidak punya unsafe `toString`.
- [ ] Exception response tidak membocorkan detail internal.
- [ ] Log structured dan sanitasi CR/LF.
- [ ] Audit log berbeda dari debug log.

### 31.4 Runtime and Diagnostic

- [ ] Remote debug tidak aktif di production.
- [ ] JMX/Actuator dibatasi.
- [ ] Heap/thread dump tidak publik.
- [ ] Environment/config endpoint tidak expose secret.
- [ ] Metrics label tidak mengandung PII/high-cardinality sensitive data.

### 31.5 Crypto/TLS Quick Scan

- [ ] Tidak ada trust-all TLS.
- [ ] Tidak ada hostname verifier always true.
- [ ] Tidak ada `Cipher.getInstance("AES")`.
- [ ] Tidak ada MD5/SHA-1 untuk security.
- [ ] Tidak ada static IV/nonce.
- [ ] Token/MAC dibandingkan constant-time.

### 31.6 Tests and Ops

- [ ] Ada negative tests.
- [ ] Ada timeout/resource limit.
- [ ] Ada audit event untuk dangerous operation.
- [ ] Ada kill switch untuk high-risk integration.
- [ ] Ada monitoring/alert untuk abnormal usage.

---

## 32. Review Questions

Gunakan pertanyaan ini sebagai “mental debugger”:

1. Apakah perubahan ini menambah capability baru?
2. Apakah input eksternal dapat memengaruhi capability tersebut?
3. Apakah data berubah menjadi code/query/path/class/command/template/URL?
4. Apakah ada allowlist eksplisit?
5. Apakah authorization terjadi sebelum mutation/execution?
6. Apakah object/domain invariant dijaga oleh method domain, bukan auto-binding?
7. Apakah error/log membocorkan detail?
8. Apakah ada timeout/limit?
9. Apakah operation high-risk diaudit?
10. Apakah safe behavior diuji dengan negative test?
11. Apakah config production bisa menonaktifkan security control?
12. Apakah fallback/debug mode aman?
13. Apakah dependency/framework diam-diam melakukan deserialization/reflection/template evaluation?
14. Apakah security context bisa bocor antar request/thread?
15. Apakah reviewer bisa menjelaskan threat model dalam 3 kalimat?

---

## 33. Latihan

### Latihan 1 — Review Reflection Endpoint

Kode:

```java
@PostMapping("/ops")
public Object ops(@RequestParam String name) throws Exception {
    return Ops.class.getMethod(name).invoke(ops);
}
```

Tugas:

1. Identifikasi capability.
2. Identifikasi input influence.
3. Buat invariant.
4. Desain ulang tanpa reflection.
5. Tambahkan authorization dan audit.

Expected direction:

```text
Replace with explicit registry of operations.
Each operation declares permission.
Unknown operation returns generic error.
Execution emits audit event.
High-risk operation requires reason/approval.
```

### Latihan 2 — Review File Export

Kode:

```java
@GetMapping("/download")
public byte[] download(@RequestParam String file) throws IOException {
    return Files.readAllBytes(Paths.get("/exports/" + file));
}
```

Tugas:

1. Cari path traversal.
2. Cari authorization gap.
3. Desain resolver aman.
4. Ubah model dari filename-based menjadi exportId-based.

Expected direction:

```text
Use exportId.
Load export metadata.
Authorize actor against export owner/tenant.
Resolve object storage key from metadata.
Never accept arbitrary file path.
```

### Latihan 3 — Review Logging

Kode:

```java
log.info("Payment request: {}", request);
```

Tugas:

1. Identifikasi sensitive fields.
2. Desain safe log event.
3. Tentukan correlation strategy tanpa bocor token.

Expected direction:

```text
Log event type, correlationId, actorId, paymentId, amount category/status.
Do not log full request.
Use token fingerprint only if needed.
```

### Latihan 4 — Review Process Execution

Kode:

```java
Runtime.getRuntime().exec("ffmpeg -i " + input + " " + output);
```

Tugas:

1. Hilangkan shell.
2. Validasi path.
3. Tambahkan timeout.
4. Batasi output.
5. Tambahkan sandbox assumption.

Expected direction:

```text
Use ProcessBuilder list args.
Fixed binary path.
Staging dir.
No user filename.
Timeout.
Kill process tree.
Run under low-privilege user/container.
```

---

## 34. Summary

Part ini membangun radar secure coding Java.

Inti yang harus diingat:

```text
Dangerous API = capability escalation.
Security review harus mencari transformasi data menjadi instruksi.
String bukan selalu data; bisa menjadi grammar.
Reflection, process execution, dynamic loading, deserialization, template evaluation,
URL fetching, temporary file, logging, exception, diagnostic endpoint, dan config
semuanya bisa menjadi security boundary.
```

Secure coding bukan sekadar hafalan “jangan pakai API X”. Yang lebih penting:

```text
1. Pahami capability.
2. Batasi input influence.
3. Gunakan allowlist.
4. Buat abstraction domain-specific.
5. Tegakkan authorization sebelum execution/mutation.
6. Jangan bocorkan secret/detail internal.
7. Tambahkan timeout/resource limit.
8. Audit dangerous operation.
9. Tulis negative test.
10. Jalankan dengan least privilege.
```

Engineer top-tier tidak hanya membuat kode jalan. Ia tahu kapan kode memberi sistem kekuatan baru, dan ia membuat kekuatan itu sempit, terukur, diaudit, dan gagal dengan aman.

---

## 35. Referensi

Referensi utama yang relevan untuk part ini:

1. Oracle — *Secure Coding Guidelines for Java SE*.
2. Oracle/OpenJDK — Java secure coding guidance dan secure runtime behavior.
3. OWASP — *Java Security Cheat Sheet*.
4. OWASP — *Deserialization Cheat Sheet*.
5. OWASP — *Logging Cheat Sheet*.
6. OWASP — *Input Validation Cheat Sheet*.
7. OWASP — *OS Command Injection Defense Cheat Sheet*.
8. OWASP — *Server Side Request Forgery Prevention Cheat Sheet*.
9. OWASP — *File Upload Cheat Sheet*.
10. MITRE CWE — weakness categories related to injection, information disclosure, insecure temporary file, path traversal, deserialization, and command execution.
11. Research literature on Java deserialization gadget chains and Java security API misuse.

---

## 36. Status Seri

Seri `learn-java-security-cryptography-integrity` masih **belum selesai**.

Progress saat ini:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — selesai
Part 15 — selesai
Part 16 — selesai
Part 17 — selesai
Part 18 — selesai
Part 19 — selesai
Part 20 — selesai
Part 21 — selesai
Part 22 — selesai
Part 23 — selesai
Part 24 — berikutnya
...
Part 34 — terakhir
```

Bagian berikutnya:

```text
Part 24 — Secrets Management in Java Applications
```
