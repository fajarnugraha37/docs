# Strict Coding Standards — Java I/O and NIO.2

> **Target:** Java file, stream, text, binary, and channel I/O using `java.io`, `java.nio`, `java.nio.file`, `java.nio.channels`, and `java.nio.charset`  
> **Scope:** `Path`, `Files`, `InputStream`, `OutputStream`, `Reader`, `Writer`, buffering, charsets, file attributes, directory traversal, large-file streaming, atomic writes, temporary files, file locks, memory-mapped files, watch service, serialization, and LLM implementation rules  
> **Audience:** LLM code agents, human reviewers, maintainers, tech leads  
> **Purpose:** prevent Java I/O code that compiles but is unsafe in production: leaked descriptors, accidental full-file loading, platform-default charset bugs, path traversal, unsafe file upload handling, partial writes, non-atomic replacement, symlink bypass, broken cleanup, serialization vulnerabilities, race-prone existence checks, and unobservable I/O failure.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing Java I/O code, an LLM agent **MUST** treat I/O as a boundary with explicit ownership, encoding, size, atomicity, and security rules.

The agent **MUST NOT** implement I/O by casually calling `new File(...)`, `readAllBytes(...)`, `readAllLines(...)`, `new FileReader(...)`, `new FileWriter(...)`, or `ObjectInputStream` just because it compiles.

Every Java I/O change **MUST** make these decisions explicit:

1. Is the operation text, binary, structured data, file tree traversal, upload/download, archive extraction, or inter-process file exchange?
2. Which component owns the resource and is responsible for closing it?
3. Is the input bounded by size, count, depth, time, or record limit?
4. Is the data small enough for full-memory loading?
5. Which charset is used for text?
6. Which line-ending behavior is expected?
7. Which `Path` base directory constrains user-controlled paths?
8. Are symbolic links followed or rejected?
9. Is the write append, create-new, overwrite, truncate, or atomic replace?
10. Is partial-write recovery required?
11. Is durability required after write (`fsync`/`force`) or is best-effort enough?
12. Are permissions/attributes required at file creation time?
13. Are temporary files created in a safe location and cleaned up?
14. Are filenames generated server-side or accepted from untrusted input?
15. Are file uploads validated beyond client-provided `Content-Type`?
16. Are logs safe and free from secret file contents or sensitive paths?
17. Are error cases mapped to meaningful application failures?
18. Which tests prove path safety, charset correctness, resource closure, large-file behavior, and failure handling?

If any of these are unclear, the agent **MUST** choose the most conservative implementation and document the uncertainty in the implementation notes or PR summary.

---

## 1. Mental model

Java I/O has several layers. Choosing the wrong layer usually creates the bug.

```text
Business use case
    -> service/application boundary
        -> storage gateway / file adapter
            -> Path normalization and access policy
            -> open stream/channel with explicit options
            -> read/write using bounded buffers
            -> close resource at ownership boundary
            -> translate IOException into application exception
```

Core distinction:

| Layer | Primary API | Use for | Strict rule |
|---|---|---|---|
| File identity/path | `Path`, `Files` | file-system location and metadata | prefer `Path` over legacy `File` |
| Byte stream | `InputStream`, `OutputStream` | sequential binary data | always close; buffer intentionally |
| Character stream | `Reader`, `Writer` | text data | charset must be explicit unless local-only and documented |
| NIO channel | `FileChannel`, `SeekableByteChannel` | random access, transfer, force, mapping | use only when stream API is insufficient |
| File tree traversal | `Files.walk`, `walkFileTree`, `DirectoryStream` | directory listing/search/deletion | bound depth and close streams |
| Async channel | `AsynchronousFileChannel` | OS-backed async file I/O | use only with explicit executor/backpressure design |
| Serialization | `ObjectInputStream`, `ObjectOutputStream` | legacy object wire/storage format | forbidden for untrusted data |

Correct Java I/O code is not “shortest code”. Correct Java I/O code is code where ownership, size, charset, security boundary, and failure semantics are visible.

---

## 2. Version and compatibility contract

This standard is an overlay for Java 11, 17, 21, and 25 codebases.

The Java language baseline remains controlled by the project-specific standard:

- `strict-coding-standards__java11.md`
- `strict-coding-standards__java17.md`
- `strict-coding-standards__java21.md`
- `strict-coding-standards__java25.md`

This file controls **I/O design and implementation behavior**, not language feature eligibility.

### 2.1 API availability guardrail

LLM agents **MUST** verify API availability against the target Java release before using convenience APIs.

Common examples:

| API | Availability | Rule |
|---|---:|---|
| `Path`, `Files`, NIO.2 | Java 7+ | preferred baseline file API |
| `Files.lines` | Java 8+ | must be closed with try-with-resources |
| `Files.readString` / `Files.writeString` | Java 11+ | only for bounded small text files |
| `InputStream.readAllBytes` | Java 9+ | only for bounded small binary data |
| `InputStream.transferTo` | Java 9+ | allowed for stream copy with size policy elsewhere |
| `FileReader(File, Charset)` / `FileWriter(File, Charset)` | Java 11+ | allowed, but prefer `Files.newBufferedReader/Writer` |
| JDK default charset UTF-8 | Java 18+ | do not rely on this for cross-version code |

### 2.2 Charset compatibility rule

For Java 11 and Java 17 projects, platform default charset is not guaranteed to be UTF-8.

For Java 18+, UTF-8 is the default charset for standard Java APIs, but this standard still requires explicit charset in durable, cross-system, persisted, or network-visible data formats.

**Rule:** explicit `Charset` is mandatory for any text file that leaves the current process or must be readable across machines, users, containers, OS images, Java versions, or time.

---

## 3. Preferred API hierarchy

### 3.1 Path handling

Use:

```java
Path baseDir = storageRoot.toAbsolutePath().normalize();
Path target = baseDir.resolve(relativeName).normalize();
```

Do not use:

```java
File file = new File(base + "/" + userInput);
```

Rules:

1. Prefer `Path` over `File` for new code.
2. Use `Path.resolve(...)`, not string concatenation, to compose file-system paths.
3. Normalize paths before containment checks.
4. Use `toRealPath(...)` when the file must already exist and symlink/canonical resolution matters.
5. Do not convert to `String` except at the boundary where a library requires it.
6. Do not assume `/` path separator; use `Path`, `resolve`, or `File.separator` only when a string path is unavoidable.
7. Do not log raw untrusted filenames without sanitization.

### 3.2 File operations

Use `Files` for most operations:

```java
Files.exists(path);
Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS);
Files.newInputStream(path);
Files.newBufferedReader(path, StandardCharsets.UTF_8);
Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
```

Avoid legacy APIs in new code:

```java
new FileInputStream(file);
new FileOutputStream(file);
file.renameTo(other);
file.delete();
```

Legacy APIs are allowed only when:

- a third-party API requires `File`;
- interacting with old code that cannot be changed safely;
- compatibility constraint is documented.

---

## 4. Resource lifecycle rules

### 4.1 Close every closeable resource

Every `InputStream`, `OutputStream`, `Reader`, `Writer`, `Channel`, `DirectoryStream`, and file-backed `Stream` **MUST** be closed.

Required:

```java
try (InputStream in = Files.newInputStream(path)) {
    // read
}
```

Forbidden:

```java
InputStream in = Files.newInputStream(path);
return parse(in); // unclear ownership and leaked descriptor on failure
```

### 4.2 Ownership must be explicit

A method that receives a stream must document whether it closes it.

Allowed patterns:

```java
// Caller owns stream; this method must not close it.
void writePayload(OutputStream out, Payload payload) throws IOException
```

```java
// This method owns the path open/close lifecycle.
Payload readPayload(Path path) throws IOException
```

Forbidden ambiguity:

```java
Payload readPayload(InputStream input) // unclear whether method closes input
```

If a method accepts `InputStream` / `OutputStream`, prefer one of these names or JavaDoc markers:

- `readFromOpenStream(...)` means caller owns closure.
- `writeToOpenStream(...)` means caller owns closure.
- `readAndClose(...)` means method owns closure.

Do not silently close resources you did not open unless the method contract says so.

### 4.3 File-backed Stream must be closed

These APIs return streams backed by open files/directories and **MUST** be used in try-with-resources:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    return lines.filter(...).count();
}
```

```java
try (Stream<Path> paths = Files.walk(root, maxDepth)) {
    return paths.filter(Files::isRegularFile).toList();
}
```

Forbidden:

```java
return Files.lines(path).map(...).toList(); // only okay if stream is closed by terminal op? No. Still unclear and fragile.
```

Do not return `Stream<Path>` or `Stream<String>` from repository/storage methods unless the returned stream is explicitly documented as resource-owning and the caller is forced to close it. Prefer callback-based processing for resource safety.

---

## 5. Text versus binary boundary

### 5.1 Decide whether data is bytes or characters

Use byte APIs for:

- images;
- PDFs;
- zip/archive content;
- encrypted/compressed payloads;
- binary protocol files;
- checksums/hashes;
- file upload/download passthrough.

Use character APIs for:

- CSV/TSV/text logs;
- JSON/XML/YAML as text;
- configuration files;
- user-readable documents;
- line-oriented records.

Forbidden:

```java
String content = new String(Files.readAllBytes(path)); // default charset; unbounded memory
```

Required:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Only if the file is explicitly bounded and small.

### 5.2 Charset rule

For text, use explicit charsets:

```java
Files.newBufferedReader(path, StandardCharsets.UTF_8);
Files.newBufferedWriter(path, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
```

Forbidden by default:

```java
new FileReader(file);
new FileWriter(file);
new InputStreamReader(inputStream);
new OutputStreamWriter(outputStream);
new String(bytes);
string.getBytes();
```

Allowed only when:

- the format is explicitly local-only;
- default charset is required by an external legacy system;
- behavior is documented and tested on target OS/container.

Preferred:

```java
new InputStreamReader(inputStream, StandardCharsets.UTF_8);
new OutputStreamWriter(outputStream, StandardCharsets.UTF_8);
new String(bytes, StandardCharsets.UTF_8);
text.getBytes(StandardCharsets.UTF_8);
```

### 5.3 Decoder error behavior

For security-sensitive or regulatory files, do not silently replace malformed characters.

Use `CharsetDecoder` when malformed/unmappable input must fail fast:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);

try (Reader reader = new InputStreamReader(Files.newInputStream(path), decoder)) {
    // parse
}
```

Use replacement behavior only when:

- the system intentionally accepts dirty input;
- the replacement character behavior is documented;
- downstream validation catches semantic errors.

---

## 6. Full-file read/write rules

### 6.1 Full-file load is restricted

These APIs are **restricted**:

```java
Files.readAllBytes(path)
Files.readAllLines(path, charset)
Files.readString(path, charset)
InputStream.readAllBytes()
```

They are allowed only when the code proves or enforces a size bound.

Required guard:

```java
long size = Files.size(path);
if (size > maxBytes) {
    throw new FileTooLargeException(path, size, maxBytes);
}
byte[] bytes = Files.readAllBytes(path);
```

Rules:

1. Max size must come from business or operational requirement.
2. Do not use `Integer.MAX_VALUE` as a meaningful limit.
3. Do not load user uploads fully into memory unless the upload size is already bounded and enforced earlier.
4. Do not load arbitrarily large logs, CSVs, exports, archives, or attachments into memory.
5. Prefer streaming parser for large files.

### 6.2 Full-file write is restricted

These APIs are restricted for large output:

```java
Files.write(path, bytes)
Files.writeString(path, text, charset)
Files.write(path, lines, charset)
```

Allowed for:

- small config files;
- generated small metadata;
- tests;
- bounded templates;
- small control files.

For large output, use `BufferedWriter`, `OutputStream`, or `FileChannel`.

---

## 7. Streaming rules

### 7.1 Use bounded buffer copy

For generic stream copy:

```java
byte[] buffer = new byte[8192];
int read;
while ((read = in.read(buffer)) != -1) {
    out.write(buffer, 0, read);
}
```

or, when size/limit is enforced elsewhere:

```java
long copied = in.transferTo(out);
```

Rules:

1. Always enforce size limits for untrusted input.
2. Do not assume `transferTo` imposes any limit.
3. Do not use `available()` to determine total stream size.
4. Do not allocate buffer based on untrusted declared file size without a cap.
5. Flush only when required by protocol or lifecycle; closing usually flushes buffered output.

### 7.2 Limit untrusted reads

For untrusted input, wrap or implement bounded reads.

Example:

```java
static long copyBounded(InputStream in, OutputStream out, long maxBytes) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;
    int read;
    while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > maxBytes) {
            throw new FileTooLargeException(total, maxBytes);
        }
        out.write(buffer, 0, read);
    }
    return total;
}
```

Do not trust:

- HTTP `Content-Length` alone;
- multipart metadata;
- zip entry declared size alone;
- file extension;
- client MIME type;
- database attachment metadata without validation.

### 7.3 Line-oriented processing

For line-oriented files:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Rules:

1. Enforce maximum line length when input is untrusted.
2. Enforce maximum line count when file is untrusted.
3. Do not assume a file ends with newline.
4. Do not use `String.split(...)` on massive lines without limits.
5. Preserve or normalize line endings intentionally.
6. For CSV, use a real CSV parser; do not split on comma.

---

## 8. Path security and traversal prevention

### 8.1 User-controlled paths are hostile

Any filename, relative path, upload name, archive entry name, export name, or template path received from outside the trusted codebase **MUST** be treated as untrusted.

Forbidden:

```java
Path target = uploadRoot.resolve(userProvidedFilename);
Files.copy(input, target);
```

Required pattern:

```java
Path base = uploadRoot.toAbsolutePath().normalize();
Path target = base.resolve(userProvidedRelativePath).normalize();

if (!target.startsWith(base)) {
    throw new InvalidPathException(userProvidedRelativePath, "Path escapes base directory");
}
```

If the file must already exist and symlinks matter:

```java
Path realBase = uploadRoot.toRealPath(LinkOption.NOFOLLOW_LINKS);
Path realTarget = realBase.resolve(userInput).normalize();

if (!realTarget.startsWith(realBase)) {
    throw new InvalidPathException(userInput, "Path escapes base directory");
}
```

Additional checks may be required before opening the file, especially if attackers can manipulate symlinks between validation and open.

### 8.2 Filename policy

For user uploads, prefer server-generated storage names.

Allowed:

```text
stored filename = UUID/random-id/content-addressed-id
original filename = metadata only, sanitized for display
```

Forbidden:

```text
stored filename = raw client filename
```

Filename validation rules:

1. Reject path separators: `/`, `\`.
2. Reject drive-prefix forms where relevant: `C:\`, `D:`.
3. Reject control characters.
4. Reject empty names, `.` and `..`.
5. Apply length limits.
6. Apply an allow-list of extensions only if extension has business meaning.
7. Never use extension as the only content validation.
8. Store outside web root or behind an authorization-controlled handler.

### 8.3 Symbolic links

Default stance: do not follow symlinks for security-sensitive file operations.

Use:

```java
Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS)
```

Rules:

1. Do not follow symlinks in upload storage by default.
2. Do not recursively delete with symlink following unless explicitly required and reviewed.
3. When using `Files.walk`, do not pass `FOLLOW_LINKS` by default.
4. Use `NOFOLLOW_LINKS` for validation of files inside security boundaries.
5. Be aware of TOCTOU: validation and open are separate operations.

---

## 9. File upload and download rules

### 9.1 Upload handling

For file upload:

1. Enforce maximum request size at the HTTP layer.
2. Enforce maximum copied bytes at the stream layer.
3. Generate server-side storage name.
4. Store outside public web root.
5. Validate extension allow-list if file type is constrained.
6. Validate content type as advisory only.
7. Validate magic number/file signature when relevant.
8. Use malware scan/CDR when business/security requires it.
9. Write to a temp file first.
10. Atomically move temp file to final location when possible.
11. Ensure cleanup on failure.
12. Never execute uploaded files.
13. Never deserialize uploaded Java objects.

### 9.2 Download handling

For download:

1. Resolve requested file through an application-owned identifier, not raw path.
2. Check authorization before opening the file.
3. Set safe `Content-Disposition`.
4. Set content type from trusted metadata, not blindly from user input.
5. Stream output using bounded buffers.
6. Do not log full file content.
7. Support range requests only if explicitly required and tested.

Forbidden:

```java
return Files.readAllBytes(path); // for arbitrary attachments/downloads
```

Preferred:

```java
try (InputStream in = Files.newInputStream(path)) {
    copyBoundedOrKnownSize(in, responseOutputStream, knownSize);
}
```

---

## 10. Write semantics

### 10.1 Always choose explicit open options

Do not rely on defaults for important writes.

Examples:

Create new file only:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    writer.write(content);
}
```

Overwrite existing file intentionally:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE)) {
    writer.write(content);
}
```

Append intentionally:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND,
        StandardOpenOption.WRITE)) {
    writer.write(line);
    writer.newLine();
}
```

Rules:

1. `CREATE_NEW` for idempotency-sensitive creation.
2. `TRUNCATE_EXISTING` only when destructive overwrite is intended.
3. `APPEND` only when interleaving/atomicity behavior is acceptable or controlled.
4. `DELETE_ON_CLOSE` only for internal temp files; never for important business files.
5. `SYNC` / `DSYNC` only when durability requirement justifies performance cost.

### 10.2 Atomic replace pattern

When replacing an existing business file, write to temp file in the same directory and then move atomically.

```java
Path temp = Files.createTempFile(target.getParent(), target.getFileName().toString(), ".tmp");
try {
    try (BufferedWriter writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
        writeContent(writer);
    }

    Files.move(
            temp,
            target,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException ex) {
    // fallback only if business allows non-atomic replace
    throw new StorageException("Atomic file replace is not supported", ex);
} finally {
    Files.deleteIfExists(temp);
}
```

Rules:

1. Temp file should be created in the same directory/file store as target.
2. Use `ATOMIC_MOVE` for replacement when partial file visibility is unacceptable.
3. If `ATOMIC_MOVE` is not supported, do not silently fallback unless business explicitly accepts risk.
4. If durability matters, force file content and possibly directory metadata where platform supports it.

### 10.3 Durability

Closing a stream does not necessarily mean data is durable after OS crash.

Use `FileChannel.force(...)` when business requires durability:

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {
    channel.write(buffer);
    channel.force(true);
}
```

Rules:

1. Use force/fsync only where justified.
2. Document whether metadata durability is required.
3. Do not add `SYNC` everywhere as a superstition.
4. Benchmark durable-write paths.

---

## 11. Temporary files and directories

Use:

```java
Path tempFile = Files.createTempFile(tempDir, "upload-", ".tmp");
```

Rules:

1. Prefer application-owned temp directory, not arbitrary system temp, for sensitive data.
2. Create temp files with safe permissions where supported.
3. Clean up temp files in `finally`.
4. Do not use predictable filenames.
5. Do not write secrets to temp files unless encrypted or protected by permissions.
6. Do not use `File.createTempFile` in new code unless legacy API requires `File`.
7. For long-running services, schedule cleanup of orphan temp files.

Forbidden:

```java
Path temp = Paths.get("/tmp/" + userId + ".tmp");
```

---

## 12. Directory traversal and file tree processing

### 12.1 Choose traversal API intentionally

| Use case | Preferred API |
|---|---|
| simple listing of one directory | `DirectoryStream` or `Files.list` with try-with-resources |
| recursive traversal with custom failure handling | `Files.walkFileTree` |
| small recursive search with stream pipeline | `Files.walk` with max depth and try-with-resources |
| secure recursive delete | `walkFileTree` with explicit symlink policy |

### 12.2 Bound traversal

Every traversal must specify:

1. root path;
2. max depth;
3. symlink policy;
4. file count limit if input is untrusted or large;
5. error handling policy;
6. whether hidden files are included;
7. whether permissions errors fail or skip.

Forbidden:

```java
Files.walk(root).forEach(this::process);
```

Required:

```java
try (Stream<Path> paths = Files.walk(root, maxDepth)) {
    paths
        .filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
        .limit(maxFiles + 1L)
        .forEach(this::process);
}
```

For precise control, use `walkFileTree`.

### 12.3 Recursive delete

Recursive delete is dangerous.

Rules:

1. Never recursively delete a path derived directly from user input.
2. Verify path is inside an allowed base directory.
3. Use `NOFOLLOW_LINKS` unless explicitly required.
4. Log target root, not every file content.
5. Fail closed on suspicious path.
6. Consider dry-run mode for operational tools.

---

## 13. File attributes and permissions

### 13.1 Set permissions at creation time when possible

Do not create sensitive files with broad permissions and fix them later if the platform supports atomic attributes at creation.

Example POSIX:

```java
Set<PosixFilePermission> permissions = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(permissions);
Path file = Files.createFile(path, attr);
```

Rules:

1. Use platform-specific attributes only behind portability-aware code.
2. If POSIX is unavailable, implement alternative OS policy or fail explicitly.
3. Do not assume container filesystem supports all attributes.
4. Do not rely on process umask unless documented.

### 13.2 Metadata reads are not free

Rules:

1. Avoid repeated `Files.size`, `Files.exists`, `Files.isRegularFile` inside tight loops when attributes can be read once.
2. Use `readAttributes` for grouped metadata reads.
3. Treat metadata as stale immediately in concurrent/multi-process environments.
4. Avoid check-then-act race patterns when atomic options exist.

---

## 14. Existence checks and race conditions

Forbidden race-prone create:

```java
if (!Files.exists(path)) {
    Files.writeString(path, content);
}
```

Required:

```java
Files.writeString(
        path,
        content,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
```

Rules:

1. Use `CREATE_NEW` for atomic create-if-absent.
2. Use atomic database/file lock coordination for multi-process critical sections.
3. Do not use `Files.exists` as authorization.
4. Treat `exists` and `notExists` as uncertain if permissions/errors prevent determination.
5. For idempotent operations, handle `FileAlreadyExistsException` explicitly.

---

## 15. File locks

File locks are restricted.

Allowed only when:

- multiple processes coordinate through files;
- database or distributed lock is not available;
- behavior is tested on target OS/filesystem;
- lock lifetime is bounded;
- stale lock recovery is defined.

Example:

```java
try (FileChannel channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
     FileLock lock = channel.tryLock()) {
    if (lock == null) {
        throw new AlreadyRunningException();
    }
    runExclusiveWork();
}
```

Rules:

1. Do not rely on file locks across unsupported network filesystems.
2. Do not use lock files without stale-lock strategy.
3. Do not hold locks while doing remote calls unless necessary.
4. Do not assume locks protect against all non-cooperating processes.

---

## 16. FileChannel and ByteBuffer standards

### 16.1 When FileChannel is allowed

Use `FileChannel` when you need:

- random access;
- positional read/write;
- `force(...)` durability;
- file-to-channel transfer;
- memory mapping;
- locking;
- large binary processing with explicit buffers.

Do not use `FileChannel` just to look “performant”.

### 16.2 ByteBuffer rules

When using `ByteBuffer`:

1. Always respect `read()` return value.
2. Always `flip()` before reading from a buffer written by a channel.
3. Always `compact()` or `clear()` intentionally.
4. Do not assume one `read` fills the buffer.
5. Do not assume one `write` writes all bytes.
6. Use loops for partial writes.

Required write loop:

```java
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

Required read loop shape:

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);
while (channel.read(buffer) != -1) {
    buffer.flip();
    consume(buffer);
    buffer.compact();
}
buffer.flip();
consume(buffer);
```

### 16.3 Direct buffers

Direct `ByteBuffer` is restricted.

Allowed when:

- benchmark proves benefit;
- allocation lifecycle is controlled;
- memory pressure is monitored;
- buffer reuse strategy exists.

Forbidden:

```java
ByteBuffer.allocateDirect(sizeFromRequest);
```

Rules:

1. Do not allocate direct buffers per small operation.
2. Do not allocate direct buffers from untrusted sizes.
3. Do not cache large direct buffers without memory budget.
4. Include observability for off-heap/direct memory if used heavily.

---

## 17. Memory-mapped files

Memory-mapped files are restricted.

Allowed when:

- file is large;
- access pattern benefits from random access;
- lifecycle and OS behavior are understood;
- tests cover Windows/Linux behavior if cross-platform;
- unmap/release expectations are documented.

Rules:

1. Do not memory-map untrusted arbitrarily large files.
2. Do not memory-map files that need immediate deletion/replace on all platforms.
3. Do not assume mapping is released immediately after object becomes unreachable.
4. Do not use memory mapping for simple sequential reads unless benchmarked.
5. Do not use memory mapping to bypass explicit size limits.

---

## 18. AsynchronousFileChannel

`AsynchronousFileChannel` is restricted.

Allowed only when:

- the application has a clear async architecture;
- executor ownership is explicit;
- concurrency limit/backpressure exists;
- cancellation/timeout behavior is defined;
- completion handler errors are captured;
- tests cover success, failure, and cancellation.

Forbidden:

```java
AsynchronousFileChannel.open(path).read(buffer, 0); // future ignored, channel leaked
```

For most services, ordinary blocking I/O plus virtual threads or bounded worker pools is simpler and safer than `AsynchronousFileChannel`.

---

## 19. WatchService

`WatchService` is restricted.

Allowed when:

- eventual consistency is acceptable;
- missed/overflow events have recovery scan;
- watched directory count is bounded;
- service shutdown closes watcher;
- behavior is tested on target OS/container/filesystem.

Rules:

1. Always handle `OVERFLOW`.
2. Always rescan on startup.
3. Do not rely on watcher as the only source of truth.
4. Do not watch unbounded user-created directories.
5. Do not assume identical semantics across OS/filesystems.

---

## 20. Serialization standard

### 20.1 Java native serialization is forbidden by default

Forbidden for new external formats:

```java
ObjectInputStream
ObjectOutputStream
Serializable
Externalizable
readObject
writeObject
```

Allowed only for legacy compatibility when:

1. there is an existing serialized format that must be read;
2. data source is trusted or filtered;
3. `ObjectInputFilter` or equivalent allow-list is configured;
4. classes are explicitly allow-listed;
5. maximum depth, bytes, references, and array sizes are constrained;
6. migration away from native serialization is documented.

### 20.2 Never deserialize untrusted data

Forbidden:

```java
try (ObjectInputStream ois = new ObjectInputStream(input)) {
    return (Command) ois.readObject();
}
```

Safer alternatives:

- JSON with strict schema validation;
- Protocol Buffers;
- Avro;
- CBOR with schema;
- application-specific binary format with explicit parser;
- database-native typed columns.

### 20.3 Serializable classes

If a class must implement `Serializable`:

1. declare `serialVersionUID`;
2. do not serialize secrets unless encrypted;
3. validate invariants during deserialization;
4. use serialization proxy pattern for complex immutable classes;
5. reject unexpected subclasses;
6. avoid making security-sensitive classes serializable.

---

## 21. Archive and compression handling

Archive processing is high risk.

Rules:

1. Reject archive entry paths that escape target directory.
2. Reject absolute paths.
3. Reject `..` traversal.
4. Reject or explicitly handle symlinks.
5. Enforce maximum uncompressed size.
6. Enforce maximum compression ratio.
7. Enforce maximum entry count.
8. Enforce maximum nesting depth.
9. Do not trust entry declared size alone.
10. Write extracted files with `CREATE_NEW` unless overwrite is explicitly allowed.
11. Extract to temp directory, then atomically publish if possible.

Forbidden:

```java
Path out = targetDir.resolve(zipEntry.getName());
Files.copy(zipInputStream, out);
```

Required:

```java
Path normalized = targetDir.resolve(entryName).normalize();
if (!normalized.startsWith(targetDir)) {
    throw new InvalidArchiveException("Entry escapes target directory");
}
```

---

## 22. Error handling

### 22.1 Do not swallow IOException

Forbidden:

```java
try {
    Files.delete(path);
} catch (IOException ignored) {
}
```

Required:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException ex) {
    // explicitly acceptable if idempotent delete
} catch (IOException ex) {
    throw new StorageException("Failed to delete file", ex);
}
```

Rules:

1. Preserve cause.
2. Include operation and safe path identifier.
3. Do not leak secret path fragments or file content.
4. Classify recoverable versus terminal failures.
5. Avoid broad `catch (Exception)` around I/O.
6. Use specific exceptions where helpful: `NoSuchFileException`, `FileAlreadyExistsException`, `AccessDeniedException`, `DirectoryNotEmptyException`, `AtomicMoveNotSupportedException`.

### 22.2 Interrupted I/O

When using blocking I/O in worker threads:

1. preserve interrupt status when catching `InterruptedException`;
2. close resources on cancellation;
3. design cancellation boundary explicitly;
4. do not convert interruption into success.

Example:

```java
catch (InterruptedException ex) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException(ex);
}
```

---

## 23. Logging and observability

I/O code must emit operationally useful logs and metrics without leaking data.

Allowed log fields:

- operation name;
- storage bucket/root alias;
- generated file id;
- file size;
- extension/type classification;
- duration;
- bytes read/written;
- outcome;
- exception class;
- correlation/request id.

Forbidden log fields by default:

- full file content;
- raw uploaded filename if sensitive;
- absolute path containing tenant/user data;
- secrets in config files;
- full stack traces in user responses;
- binary payload dumps.

Metrics to consider:

- bytes read/written;
- operation latency;
- open file failures;
- path validation failures;
- upload rejection reason;
- temp cleanup failures;
- atomic move failure count;
- archive expansion ratio rejection count.

---

## 24. Performance rules

### 24.1 Do not optimize before choosing correct semantics

Correctness order:

```text
security boundary
-> ownership/closure
-> size bounds
-> charset correctness
-> atomicity/durability requirement
-> error handling
-> performance
```

### 24.2 Buffering

Rules:

1. Use buffered streams/readers/writers for small frequent operations.
2. Do not double-buffer blindly if API already buffers internally.
3. Buffer size must be bounded and justified for hot paths.
4. Do not allocate large buffers per request.
5. Reuse buffers only where thread-safety and lifecycle are clear.

### 24.3 Parallel I/O

Parallelizing file I/O is restricted.

Allowed when:

- storage can handle concurrent I/O;
- file count/size justifies it;
- concurrency is bounded;
- backpressure exists;
- ordering requirements are handled;
- benchmark proves improvement.

Forbidden:

```java
Files.walk(root).parallel().forEach(this::process);
```

Reason: unbounded file traversal + parallel stream can create descriptor pressure, poor error handling, and unpredictable backpressure.

### 24.4 Large-file processing

For large files:

1. stream in chunks;
2. avoid `String` for binary data;
3. avoid `readAll*` APIs;
4. use line parser/tokenizer for text;
5. checkpoint progress if job is long-running;
6. expose progress metrics where useful;
7. handle partial records at buffer boundaries;
8. test with files larger than heap.

---

## 25. Security rules

### 25.1 Mandatory defenses

Every file-access feature exposed to users or external systems must implement:

1. base directory containment;
2. path normalization;
3. symlink policy;
4. size limits;
5. extension/type allow-list where applicable;
6. authorization before access;
7. safe temp-file handling;
8. safe error messages;
9. no native Java deserialization of untrusted data;
10. tests for traversal payloads.

Traversal payload tests must include:

```text
../secret.txt
..\secret.txt
./../secret.txt
/absolute/path
C:\Windows\win.ini
%2e%2e%2fsecret.txt
....//secret.txt
subdir/../../secret.txt
safe/../safe.txt
```

Adapt payloads to URL decoding and platform rules used by the application.

### 25.2 Sensitive files

Sensitive files include:

- private keys;
- credentials;
- tokens;
- database dumps;
- uploaded identity documents;
- regulatory evidence;
- audit exports;
- personally identifiable information;
- confidential correspondence;
- generated reports.

Rules:

1. Store with least privilege.
2. Encrypt at rest if required by policy.
3. Do not write to shared temp directory unless protected.
4. Do not expose raw path in API response.
5. Do not include content in logs.
6. Use retention and deletion policy.
7. Ensure backups/archives follow same classification.

---

## 26. API design rules

### 26.1 Keep I/O out of controllers/resources

Forbidden:

```java
@Path("/files")
public class FileResource {
    @GET
    public byte[] download(@QueryParam("path") String path) throws IOException {
        return Files.readAllBytes(Path.of(path));
    }
}
```

Required shape:

```text
Resource/controller
    -> application service
        -> storage service/gateway
            -> path policy + Files API
```

### 26.2 Do not expose Path as domain model

`Path` is infrastructure detail.

Allowed:

```java
record StoredFileId(String value) {}
record StoredFileMetadata(StoredFileId id, long size, String contentType) {}
```

Restricted:

```java
record Attachment(Path path) {}
```

Only infrastructure classes may expose `Path` broadly.

### 26.3 Use ports/adapters for storage

Preferred:

```java
interface AttachmentStorage {
    StoredFile store(AttachmentUpload upload) throws StorageException;
    void readTo(StoredFileId id, OutputStream output) throws StorageException, IOException;
    void delete(StoredFileId id) throws StorageException;
}
```

This keeps file-system-specific behavior out of business logic and makes testing possible.

---

## 27. Testing requirements

### 27.1 Unit tests

Test:

1. path normalization and containment;
2. traversal rejection;
3. symlink behavior when supported;
4. charset encode/decode behavior;
5. malformed input behavior;
6. small versus large file handling;
7. max size enforcement;
8. temp cleanup on failure;
9. atomic create conflict;
10. delete failure handling;
11. `IOException` conversion;
12. stream closure.

Use JUnit `@TempDir` or equivalent for isolated filesystem tests.

### 27.2 Integration tests

Test against target OS/container when behavior matters:

- Windows path separator and drive prefix;
- case sensitivity assumptions;
- POSIX permissions;
- Docker bind mounts;
- Kubernetes volume behavior;
- network filesystem behavior;
- atomic move support;
- file lock support;
- large-file throughput.

### 27.3 Property/fuzz tests

For path and archive handling, include generated malicious names:

- random Unicode filenames;
- normalization variants;
- deeply nested paths;
- very long names;
- reserved device names on Windows;
- mixed separators;
- URL-encoded traversal;
- null-byte-like payloads where upstream decoding may matter.

---

## 28. LLM-specific anti-patterns

LLM agents **MUST NOT** generate these patterns:

### 28.1 Read arbitrary file into memory

```java
byte[] bytes = Files.readAllBytes(path);
```

without size guard.

### 28.2 Use platform default charset

```java
new FileReader(file);
new String(bytes);
text.getBytes();
```

without explicit documented reason.

### 28.3 Raw user path access

```java
Path.of(request.getParameter("path"));
```

without base directory policy.

### 28.4 String path concatenation

```java
baseDir + "/" + fileName
```

### 28.5 Unsafe upload name

```java
Files.copy(upload, uploadDir.resolve(upload.getSubmittedFileName()));
```

### 28.6 Stream leak

```java
Files.lines(path).filter(...).count();
```

without try-with-resources.

### 28.7 Silent cleanup failure

```java
catch (IOException ignored) {}
```

### 28.8 Blind recursive delete

```java
FileUtils.deleteDirectory(new File(pathFromUser));
```

### 28.9 Native deserialization

```java
new ObjectInputStream(input).readObject();
```

### 28.10 Parallel file traversal by default

```java
Files.walk(root).parallel().forEach(...);
```

---

## 29. Approved implementation recipes

### 29.1 Safe small UTF-8 text read

```java
public String readSmallUtf8File(Path path, long maxBytes) throws IOException {
    long size = Files.size(path);
    if (size > maxBytes) {
        throw new FileTooLargeException(size, maxBytes);
    }
    return Files.readString(path, StandardCharsets.UTF_8);
}
```

### 29.2 Safe line processing

```java
public void processLines(Path path, long maxLines) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        long count = 0;
        while ((line = reader.readLine()) != null) {
            count++;
            if (count > maxLines) {
                throw new TooManyLinesException(maxLines);
            }
            processLine(line);
        }
    }
}
```

### 29.3 Safe file create

```java
public void createNewFile(Path path, String content) throws IOException {
    Files.writeString(
            path,
            content,
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE);
}
```

### 29.4 Safe path resolution

```java
public Path resolveInsideBase(Path baseDir, String userPath) throws IOException {
    Path base = baseDir.toAbsolutePath().normalize();
    Path resolved = base.resolve(userPath).normalize();
    if (!resolved.startsWith(base)) {
        throw new InvalidPathException(userPath, "Path escapes base directory");
    }
    return resolved;
}
```

### 29.5 Safe upload store

```java
public StoredFile store(InputStream input, String originalFilename, long maxBytes) throws IOException {
    String extension = extensionPolicy.validateAndExtract(originalFilename);
    String storedName = idGenerator.newId() + extension;

    Path temp = Files.createTempFile(uploadTempDir, "upload-", ".tmp");
    boolean completed = false;
    try {
        try (OutputStream out = Files.newOutputStream(
                temp,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {
            long bytes = copyBounded(input, out, maxBytes);
            validateStoredFile(temp, bytes);
        }

        Path target = uploadRoot.resolve(storedName).normalize();
        if (!target.startsWith(uploadRoot)) {
            throw new StorageException("Generated path escaped storage root");
        }

        Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
        completed = true;
        return new StoredFile(storedName, originalFilename);
    } finally {
        if (!completed) {
            Files.deleteIfExists(temp);
        }
    }
}
```

### 29.6 Safe copy with explicit limit

```java
public long copyBounded(InputStream in, OutputStream out, long maxBytes) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;
    int read;
    while ((read = in.read(buffer)) != -1) {
        total += read;
        if (total > maxBytes) {
            throw new FileTooLargeException(total, maxBytes);
        }
        out.write(buffer, 0, read);
    }
    return total;
}
```

---

## 30. Reviewer checklist

A Java I/O change is not acceptable unless the reviewer can answer “yes” to all relevant questions.

### 30.1 Resource lifecycle

- [ ] Are all streams/readers/writers/channels closed?
- [ ] Are file-backed streams from `Files.lines/list/walk/find` closed?
- [ ] Is stream ownership clear?
- [ ] Is cleanup safe on failure?

### 30.2 Charset and data format

- [ ] Is text/binary boundary explicit?
- [ ] Is charset explicit for durable/cross-system text?
- [ ] Is malformed input behavior intentional?
- [ ] Are line endings handled intentionally?

### 30.3 Size and performance

- [ ] Are full-file reads size-bounded?
- [ ] Are uploads/downloads streamed?
- [ ] Are large files processed chunk-by-chunk?
- [ ] Are buffers bounded and not request-sized?
- [ ] Is parallel I/O bounded and justified?

### 30.4 Path security

- [ ] Is user input resolved inside an allowed base directory?
- [ ] Are traversal payloads rejected?
- [ ] Is symlink policy explicit?
- [ ] Are absolute paths rejected where user input is expected to be relative?
- [ ] Are raw client filenames avoided for storage?

### 30.5 Write semantics

- [ ] Are open options explicit?
- [ ] Is create/overwrite/append behavior intentional?
- [ ] Is atomic replace used where partial visibility is unacceptable?
- [ ] Is durability requirement documented?
- [ ] Is temp-file cleanup robust?

### 30.6 Error and observability

- [ ] Are `IOException`s preserved and translated meaningfully?
- [ ] Are specific file exceptions handled where needed?
- [ ] Are logs useful but not sensitive?
- [ ] Are metrics emitted for important storage operations?

### 30.7 Security

- [ ] Is native Java deserialization absent or justified with filters?
- [ ] Are uploads validated beyond `Content-Type`?
- [ ] Are archives protected against zip slip and decompression bombs?
- [ ] Are sensitive files protected by permissions/encryption/retention policy?

---

## 31. Prompt contract for LLM code agents

Use this instruction when asking an LLM to implement Java I/O code:

```text
You are implementing Java I/O code under strict standards.

Before coding, identify:
- whether the data is binary or text;
- expected maximum size;
- charset if text;
- resource owner and close boundary;
- path trust boundary;
- symlink policy;
- create/overwrite/append behavior;
- whether atomic replace or durability is required;
- error mapping;
- tests required.

While coding:
- prefer Path and Files over legacy File APIs;
- use try-with-resources for every closeable resource;
- do not use default charset APIs for durable or cross-system text;
- do not use readAllBytes/readAllLines/readString unless size is bounded;
- never concatenate paths using strings;
- never use raw user filename/path as storage path;
- validate path containment with base.resolve(input).normalize().startsWith(base);
- do not follow symlinks unless explicitly required;
- write to temp file and atomic move for important replacements;
- never deserialize untrusted data with ObjectInputStream;
- preserve IOException causes and avoid leaking sensitive file content in logs.

In the final response/PR summary, explain:
- I/O strategy;
- size/charset/path decisions;
- failure behavior;
- tests added.
```

---

## 32. Quick decision matrix

| Need | Use | Avoid |
|---|---|---|
| small bounded UTF-8 text | `Files.readString(path, UTF_8)` | `new FileReader(...)` |
| large text | `BufferedReader` loop | `readAllLines` |
| binary copy | `InputStream`/`OutputStream` with bounded buffer | `readAllBytes` for arbitrary input |
| atomic create | `CREATE_NEW` | `exists` then write |
| atomic replace | temp file + `ATOMIC_MOVE` | write directly to target |
| directory traversal | `walkFileTree` or `Files.walk` with max depth | unbounded `Files.walk(root)` |
| path from user | base resolve + normalize + startsWith | raw `Path.of(userInput)` |
| file upload | generated name + temp + validation + atomic move | client filename as path |
| object persistence | JSON/Protobuf/DB columns | Java native serialization |
| random access | `FileChannel` | manual skip loops on stream |
| OS file events | `WatchService` + recovery scan | watcher as only source of truth |

---

## 33. Reference anchors

This standard is based on the following primary/reference materials:

- Java SE 21 API — `java.nio.file.Files`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Files.html
- Java SE 21 API — `java.nio.file.Path`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Path.html
- Java SE 21 API — `java.nio.file.StandardOpenOption`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/StandardOpenOption.html
- Java SE 21 API — `java.nio.channels.FileChannel`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html
- Java SE 21 API — `java.lang.AutoCloseable`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html
- Java SE 21 API — `java.nio.charset.Charset`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/Charset.html
- Java SE 21 API — `java.nio.charset.StandardCharsets`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/StandardCharsets.html
- OpenJDK JEP 400 — UTF-8 by Default: https://openjdk.org/jeps/400
- Oracle Secure Coding Guidelines for Java SE: https://www.oracle.com/java/technologies/javase/seccodeguide.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

---

## 34. Final enforcement statement

For Java I/O code, the default review stance is **deny unless proven safe**.

An implementation that reads, writes, copies, deletes, uploads, downloads, extracts, serializes, or traverses files is acceptable only when it explicitly proves:

1. resource ownership;
2. bounded memory use;
3. explicit charset for text;
4. base directory containment for user-influenced paths;
5. safe symlink behavior;
6. intentional write semantics;
7. correct failure handling;
8. secure logging;
9. meaningful tests.

If the LLM cannot prove those properties, it must not invent a shortcut. It must implement the conservative pattern or ask for the missing constraint.
