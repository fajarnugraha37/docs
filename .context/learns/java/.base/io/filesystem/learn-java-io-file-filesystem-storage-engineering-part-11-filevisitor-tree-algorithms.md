# Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations

Series: `learn-java-io-file-filesystem-storage-engineering`  
Target Java: 8–25  
Focus: `FileVisitor`, `SimpleFileVisitor`, `Files.walkFileTree`, recursive copy/delete/checksum/audit, error strategy, subtree control, symbolic-link policy, cycle handling, and resumable tree operations.

---

## 0. Why This Part Exists

In the previous part, we studied directory listing and traversal APIs:

- `Files.list(...)`
- `Files.walk(...)`
- `Files.find(...)`
- `DirectoryStream`

Those APIs are useful when traversal is mostly a query: list paths, filter paths, count paths, find matches, collect metadata.

But many real production workloads are not just queries. They are **tree algorithms**:

- recursively copy a directory tree;
- recursively delete a tree;
- compute a checksum manifest;
- audit permissions and ownership;
- scan a tree and quarantine suspicious files;
- build an import/export package;
- migrate a filesystem layout;
- reconcile an inbox/outbox directory;
- clean old files safely;
- transform a directory structure;
- resume a partially failed file operation.

For this class of problem, `Files.walkFileTree(...)` with `FileVisitor` gives you a more explicit model than stream traversal. It exposes the natural phases of a depth-first filesystem walk:

1. before entering a directory;
2. when visiting a file;
3. when visiting fails;
4. after leaving a directory.

That phase model is exactly what robust recursive algorithms need.

A top-tier engineer does not think of recursion as merely “loop through all files”. They think in terms of **tree invariants**:

- What must be true before entering a directory?
- What must be true before processing a file?
- What must be true after all children are processed?
- What happens when one child fails?
- Should the traversal continue, skip, terminate, or aggregate errors?
- What is the policy for symbolic links?
- Can the operation be resumed safely?
- Can the operation corrupt data if interrupted?

This part builds that mental model.

---

## 1. The Core API Surface

The important types are:

```java
import java.nio.file.Files;
import java.nio.file.FileVisitor;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.FileVisitResult;
import java.nio.file.FileVisitOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
```

The main method is:

```java
Files.walkFileTree(start, visitor);
```

or the configurable version:

```java
Files.walkFileTree(
    start,
    options,
    maxDepth,
    visitor
);
```

Conceptually:

```text
start path
  └── depth-first walk
        ├── preVisitDirectory(directory)
        ├── visitFile(file)
        ├── visitFileFailed(path, exception)
        └── postVisitDirectory(directory, exception)
```

The Java API defines `FileVisitor` as an interface used by `Files.walkFileTree` to visit entries in a file tree. `SimpleFileVisitor` is a convenience implementation whose default behavior is to continue traversal and rethrow I/O errors.

---

## 2. Why `FileVisitor` Exists When `Files.walk` Already Exists

At first, `Files.walk(...)` looks simpler:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.forEach(System.out::println);
}
```

That is fine for simple processing. But it hides important lifecycle phases.

For example, recursive delete needs this order:

```text
visit child file      → delete child file
visit child directory → after its children are deleted, delete directory itself
```

You cannot delete a non-empty directory before deleting its children.

With `FileVisitor`, this is natural:

```text
preVisitDirectory(dir)       // before children
visitFile(file)              // child file
postVisitDirectory(dir)      // after children
```

For recursive copy, the opposite is needed:

```text
preVisitDirectory(sourceDir) → create target directory
visitFile(sourceFile)        → copy file into target
postVisitDirectory(dir)      → optionally copy/adjust final metadata
```

For permission audit:

```text
preVisitDirectory(dir)       → audit directory before descent
visitFile(file)              → audit file
visitFileFailed(path, err)   → record inaccessible entry
postVisitDirectory(dir, err) → summarize subtree
```

The visitor API is therefore not merely lower-level. It is more **algorithmically expressive**.

---

## 3. Mental Model: Tree Walk Is a Controlled Depth-First State Machine

A filesystem tree walk is not a flat list. It is a state machine:

```text
START
  ↓
READ ATTRIBUTES OF ENTRY
  ↓
IF DIRECTORY:
  preVisitDirectory
    ↓
  enumerate children
    ↓
  for each child: recurse
    ↓
  postVisitDirectory

IF FILE / NON-DIRECTORY:
  visitFile

IF FAILURE:
  visitFileFailed or postVisitDirectory(dir, exc)
```

The important detail is that the visitor does not merely receive a path. It receives **a path plus traversal phase plus, for some callbacks, already-read attributes or exception context**.

This gives your algorithm hooks for invariants:

| Phase | Typical invariant |
|---|---|
| `preVisitDirectory` | target directory exists, directory is allowed, subtree policy is decided |
| `visitFile` | file is processed, copied, hashed, audited, or deleted |
| `visitFileFailed` | failure is classified and recorded |
| `postVisitDirectory` | children are done; directory-level finalization can happen |

This phase separation is what lets you build correct recursive operations.

---

## 4. The Four `FileVisitor` Methods

The raw interface has four methods:

```java
public interface FileVisitor<T> {
    FileVisitResult preVisitDirectory(T dir, BasicFileAttributes attrs) throws IOException;

    FileVisitResult visitFile(T file, BasicFileAttributes attrs) throws IOException;

    FileVisitResult visitFileFailed(T file, IOException exc) throws IOException;

    FileVisitResult postVisitDirectory(T dir, IOException exc) throws IOException;
}
```

Usually you extend `SimpleFileVisitor<Path>` instead of implementing everything directly:

```java
class MyVisitor extends SimpleFileVisitor<Path> {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        System.out.println(file);
        return FileVisitResult.CONTINUE;
    }
}
```

Why `SimpleFileVisitor`?

Because for most algorithms you only need to override the phases that matter. Its default behavior is intentionally conservative:

- continue traversal when things are normal;
- rethrow I/O errors by default.

That is safer than silently swallowing failures.

---

## 5. `FileVisitResult`: The Control Plane of Traversal

Every visitor method returns a `FileVisitResult`:

```java
CONTINUE
TERMINATE
SKIP_SUBTREE
SKIP_SIBLINGS
```

These are not just “return values”. They are traversal control commands.

### 5.1 `CONTINUE`

Proceed normally.

```java
return FileVisitResult.CONTINUE;
```

Most visitors return this most of the time.

### 5.2 `TERMINATE`

Stop the entire traversal immediately.

Useful for:

- finding the first match;
- aborting on security violation;
- stopping when an error threshold is reached;
- cancelling an operation.

Example:

```java
if (foundCriticalFile(file)) {
    result.set(file);
    return FileVisitResult.TERMINATE;
}
```

### 5.3 `SKIP_SUBTREE`

Skip the children of the current directory.

Usually returned from `preVisitDirectory`.

Useful for:

- excluding `.git`, `node_modules`, `target`, `build`;
- avoiding mounted directories;
- avoiding tenant folders not belonging to current job;
- security policy denial;
- depth/pattern pruning.

Example:

```java
@Override
public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
    if (dir.getFileName().toString().equals(".git")) {
        return FileVisitResult.SKIP_SUBTREE;
    }
    return FileVisitResult.CONTINUE;
}
```

### 5.4 `SKIP_SIBLINGS`

Skip remaining entries in the same directory.

This is less commonly used, but useful when a directory-level condition makes the rest irrelevant.

Example use cases:

- stop scanning sibling files after a manifest declares the directory invalid;
- skip sibling entries after detecting a tenant ownership mismatch;
- short-circuit a directory once required file is found.

Be careful: this can make traversal results incomplete by design. Always document why siblings are skipped.

---

## 6. Depth-First Order and Why It Matters

`walkFileTree` traverses depth-first.

Example tree:

```text
root/
  a.txt
  sub/
    b.txt
  c.txt
```

A typical callback sequence:

```text
preVisitDirectory(root)
visitFile(root/a.txt)
preVisitDirectory(root/sub)
visitFile(root/sub/b.txt)
postVisitDirectory(root/sub)
visitFile(root/c.txt)
postVisitDirectory(root)
```

This matters because many filesystem operations depend on parent-child ordering.

For recursive copy:

```text
create directory before copying children
```

For recursive delete:

```text
delete children before deleting directory
```

For aggregation:

```text
calculate child metrics before finalizing parent summary
```

For validation:

```text
reject subtree before spending work on children
```

---

## 7. Recursive Delete with `FileVisitor`

The canonical recursive delete pattern is:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;

public final class RecursiveDelete {
    public static void deleteTree(Path root) throws IOException {
        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                if (exc != null) {
                    throw exc;
                }
                Files.delete(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
```

The invariant:

```text
A directory may be deleted only after all entries below it are deleted.
```

That is why directory deletion happens in `postVisitDirectory`, not `preVisitDirectory`.

### 7.1 Important Caveat: Root Guard

Never recursively delete an arbitrary path without guardrails.

Bad:

```java
deleteTree(userProvidedPath);
```

Better:

```java
public static void deleteTenantScratch(Path baseDir, String tenantId) throws IOException {
    Path root = baseDir.toRealPath();
    Path target = baseDir.resolve(tenantId).normalize();

    // If target may not exist, toRealPath cannot be used directly.
    // For deletion of existing tree, require it exists first.
    Path realTarget = target.toRealPath(LinkOption.NOFOLLOW_LINKS);

    if (!realTarget.startsWith(root)) {
        throw new SecurityException("Refusing to delete outside base directory: " + realTarget);
    }

    if (realTarget.equals(root)) {
        throw new SecurityException("Refusing to delete base directory itself: " + realTarget);
    }

    deleteTree(realTarget);
}
```

Even this is not the full final security model for symlink-hostile environments, but it captures an important principle:

```text
Recursive delete must have a root boundary.
```

---

## 8. Recursive Copy with `FileVisitor`

Recursive copy requires mapping a source path to a destination path.

Mental model:

```text
sourceRoot/a/b.txt
relative path = a/b.txt
target = targetRoot/a/b.txt
```

Implementation:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;

public final class RecursiveCopy {
    public static void copyTree(Path sourceRoot, Path targetRoot) throws IOException {
        Files.walkFileTree(sourceRoot, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Path relative = sourceRoot.relativize(dir);
                Path targetDir = targetRoot.resolve(relative);
                Files.createDirectories(targetDir);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Path relative = sourceRoot.relativize(file);
                Path targetFile = targetRoot.resolve(relative);
                Files.copy(file, targetFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
```

This implementation is simple, but production copy needs more policy:

- Should existing target files be replaced?
- Should attributes be preserved?
- Should symbolic links be copied as links or followed?
- What happens if a file changes while being copied?
- Should partial target files be deleted on failure?
- Should target be staged first, then atomically published?
- Should errors abort or be accumulated?

A top-tier engineer does not call this “recursive copy” until those questions are answered.

---

## 9. Copy Algorithm Invariants

A recursive copy algorithm needs explicit invariants.

### 9.1 Source-to-Target Mapping Invariant

For every visited source path:

```text
targetPath = targetRoot.resolve(sourceRoot.relativize(sourcePath))
```

Never derive target path by string replacement:

```java
// Bad
String target = source.toString().replace(sourceRoot.toString(), targetRoot.toString());
```

This fails with:

- separator differences;
- repeated path segments;
- case differences;
- provider-specific path syntax;
- symbolic path weirdness.

Use `relativize` and `resolve`.

### 9.2 Parent-Exists Invariant

Before copying a file:

```text
parent(targetFile) exists
```

This is achieved naturally by creating directories in `preVisitDirectory`.

### 9.3 Target Boundary Invariant

For user-controlled input, every target path must remain under target root.

```java
Path target = targetRoot.resolve(relative).normalize();
if (!target.startsWith(targetRoot.normalize())) {
    throw new SecurityException("Target escaped root: " + target);
}
```

For stronger security, combine this with real-path checks and symlink policy. Path containment is a topic we revisit deeply in path traversal security.

### 9.4 Failure Invariant

If copy fails halfway, the system must know whether target is:

- valid;
- partial;
- unknown;
- safe to retry;
- must be quarantined;
- must be deleted.

This is why serious systems often copy into a staging directory:

```text
target.tmp/job-id/...
    ↓ after complete verification
target/live/...
```

---

## 10. Error Strategy: Fail-Fast vs Best-Effort vs Accumulate

Most example code throws on first error. That is fine for simple tools, but production workflows need a deliberate error strategy.

### 10.1 Fail-Fast

Stop immediately on first error.

Good for:

- deployment artifact preparation;
- security-sensitive operations;
- config publication;
- operations requiring all-or-nothing semantics.

Example:

```java
@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) throws IOException {
    throw exc;
}
```

### 10.2 Best-Effort

Continue despite some failures.

Good for:

- cleanup jobs;
- diagnostic scans;
- permission audit;
- disk usage reporting.

Example:

```java
List<String> failures = new ArrayList<>();

@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) {
    failures.add(file + " -> " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
    return FileVisitResult.CONTINUE;
}
```

But best-effort must report incomplete state clearly.

Bad final message:

```text
Cleanup complete.
```

Better:

```text
Cleanup attempted. Deleted 12,430 entries. Failed 17 entries. Result is incomplete.
```

### 10.3 Accumulate Then Throw

Continue as much as possible, then fail at the end if there were errors.

Good for:

- batch migration;
- validation scan;
- reporting all violations;
- CI quality check.

Example pattern:

```java
public final class AccumulatingVisitor extends SimpleFileVisitor<Path> {
    private final List<IOException> errors = new ArrayList<>();

    @Override
    public FileVisitResult visitFileFailed(Path file, IOException exc) {
        errors.add(new IOException("Failed to visit " + file, exc));
        return FileVisitResult.CONTINUE;
    }

    public void throwIfFailed() throws IOException {
        if (errors.isEmpty()) {
            return;
        }
        IOException root = new IOException("Tree walk completed with " + errors.size() + " error(s)");
        for (IOException error : errors) {
            root.addSuppressed(error);
        }
        throw root;
    }
}
```

Usage:

```java
AccumulatingVisitor visitor = new AccumulatingVisitor();
Files.walkFileTree(root, visitor);
visitor.throwIfFailed();
```

This gives you both:

- broad coverage;
- accurate failure signaling.

---

## 11. `visitFileFailed`: Do Not Ignore It Accidentally

`visitFileFailed` is called when a file cannot be visited. Common causes:

- access denied;
- file deleted concurrently;
- broken symbolic link;
- filesystem loop;
- too many open files;
- path length issue;
- network filesystem error;
- transient I/O error;
- permission problem.

A weak implementation:

```java
@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) {
    return FileVisitResult.CONTINUE;
}
```

This hides data loss and incomplete traversal.

A better implementation classifies failure:

```java
@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) throws IOException {
    if (exc instanceof AccessDeniedException) {
        audit.warn("Access denied: " + file);
        return FileVisitResult.CONTINUE;
    }

    if (exc instanceof NoSuchFileException) {
        audit.info("File disappeared during traversal: " + file);
        return FileVisitResult.CONTINUE;
    }

    throw exc;
}
```

The exact policy depends on the operation. For recursive copy, access denied may be fatal. For audit, it may be a finding. For cleanup, it may be a retry candidate.

---

## 12. `postVisitDirectory`: The Most Underused Callback

`postVisitDirectory` is called after entries in a directory and their descendants have been visited.

It receives:

```java
Path dir
IOException exc
```

The `exc` parameter matters. It indicates a failure occurred while iterating the directory.

Pattern:

```java
@Override
public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
    if (exc != null) {
        throw exc;
    }

    // directory finalization here
    return FileVisitResult.CONTINUE;
}
```

Use cases:

- delete directory after deleting children;
- set directory timestamp after copying children;
- finalize directory-level summary;
- validate directory completeness;
- close subtree accumulator;
- write per-directory manifest;
- detect incomplete traversal.

Do not blindly ignore `exc`.

---

## 13. Skipping Subtrees Intentionally

Subtree pruning is one of the biggest advantages of `FileVisitor`.

Example: skip build artifacts and version-control metadata.

```java
private static final Set<String> SKIP_NAMES = Set.of(".git", "target", "build", "node_modules");

@Override
public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
    Path name = dir.getFileName();
    if (name != null && SKIP_NAMES.contains(name.toString())) {
        return FileVisitResult.SKIP_SUBTREE;
    }
    return FileVisitResult.CONTINUE;
}
```

Java 8 version because `Set.of` is not available in Java 8:

```java
private static final Set<String> SKIP_NAMES = new HashSet<>(Arrays.asList(
    ".git", "target", "build", "node_modules"
));
```

Use subtree pruning to reduce:

- runtime;
- permissions errors;
- accidental traversal of huge directories;
- accidental traversal of mounted paths;
- risk surface.

---

## 14. Max Depth and Boundary Design

The overloaded method supports `maxDepth`:

```java
Files.walkFileTree(
    root,
    EnumSet.noneOf(FileVisitOption.class),
    3,
    visitor
);
```

Depth matters for:

- shallow scans;
- limiting blast radius;
- preventing runaway traversal;
- user-facing search tools;
- safety in unknown file trees.

Important mental model:

```text
maxDepth is traversal depth control, not a security boundary by itself.
```

A hostile or unusual filesystem tree can still contain symlinks, mounts, permission traps, huge directories, and changing entries. Depth is one guardrail, not the whole policy.

---

## 15. Symbolic Links and Cycle Handling

By default, `walkFileTree` does not follow symbolic links.

To follow links:

```java
Set<FileVisitOption> options = EnumSet.of(FileVisitOption.FOLLOW_LINKS);
Files.walkFileTree(root, options, Integer.MAX_VALUE, visitor);
```

Following links changes the risk profile drastically.

Without following links:

```text
symlink is visited as an entry
its target subtree is not traversed
```

With following links:

```text
symlink target may be traversed
walk may leave the apparent root
cycles become possible
```

The API can detect cycles and report `FileSystemLoopException` through failure handling.

Top-tier rule:

```text
Do not enable FOLLOW_LINKS unless you have a clear reason and a containment model.
```

### 15.1 Why Link Following Is Dangerous

Suppose an upload directory contains:

```text
uploads/user-a/root
uploads/user-a/root/link-to-etc -> /etc
```

If your traversal follows links, a “scan user upload” operation may scan outside the upload boundary.

A recursive delete with link following can be catastrophic.

A recursive copy with link following can leak files outside the intended source.

A checksum job with link following can accidentally hash secrets.

Therefore, symbolic-link policy is not a minor option. It is a security and correctness decision.

---

## 16. Recursive Checksum Manifest

A checksum manifest maps relative paths to content hashes.

Example output:

```text
SHA-256  path
b94d27b9...  README.md
4124bc0a...  config/app.yml
```

Implementation skeleton:

```java
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class ChecksumManifest {
    public static List<Entry> build(Path root) throws IOException {
        List<Entry> entries = new ArrayList<>();

        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                if (!attrs.isRegularFile()) {
                    return FileVisitResult.CONTINUE;
                }

                Path relative = root.relativize(file);
                String sha256 = sha256(file);
                entries.add(new Entry(relative.toString().replace('\\', '/'), sha256, attrs.size()));
                return FileVisitResult.CONTINUE;
            }
        });

        entries.sort(Comparator.comparing(Entry::path));
        return entries;
    }

    private static String sha256(Path file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];

            try (InputStream in = Files.newInputStream(file);
                 DigestInputStream digestIn = new DigestInputStream(in, digest)) {
                while (digestIn.read(buffer) != -1) {
                    // digest updated by DigestInputStream
                }
            }

            return toHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    public record Entry(String path, String sha256, long size) {}
}
```

Java 8 version without `record`:

```java
public final class Entry {
    private final String path;
    private final String sha256;
    private final long size;

    public Entry(String path, String sha256, long size) {
        this.path = path;
        this.sha256 = sha256;
        this.size = size;
    }

    public String getPath() {
        return path;
    }

    public String getSha256() {
        return sha256;
    }

    public long getSize() {
        return size;
    }
}
```

### 16.1 Manifest Invariants

A robust manifest needs stable rules:

- use relative path from root;
- use consistent separator, usually `/`;
- define whether symlinks are included, skipped, or represented as link metadata;
- define ordering;
- include file size;
- optionally include last modified time;
- optionally include file mode/permission;
- handle unreadable files explicitly;
- fail if tree changes during manifest generation, if consistency is required.

A checksum manifest without a consistency model is just a best-effort snapshot.

---

## 17. Permission Audit Visitor

A permission audit does not necessarily fail on access problems. It records them.

Example:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermission;
import java.util.*;

public final class PermissionAudit {
    public static List<String> auditWorldWritable(Path root) throws IOException {
        List<String> findings = new ArrayList<>();

        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                check(dir, findings);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                check(file, findings);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                findings.add("UNREADABLE " + file + " -> " + exc.getClass().getSimpleName());
                return FileVisitResult.CONTINUE;
            }
        });

        return findings;
    }

    private static void check(Path path, List<String> findings) throws IOException {
        try {
            Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
            if (perms.contains(PosixFilePermission.OTHERS_WRITE)) {
                findings.add("WORLD_WRITABLE " + path);
            }
        } catch (UnsupportedOperationException e) {
            findings.add("POSIX_UNSUPPORTED " + path);
        }
    }
}
```

This visitor has a different invariant from copy/delete:

```text
The audit should cover as much as possible and report gaps explicitly.
```

That means `visitFileFailed` is not necessarily fatal.

---

## 18. Tree Size and Disk Usage Visitor

A common mistake is assuming directory size is just the sum of file sizes. In Java, `BasicFileAttributes.size()` for regular files is straightforward enough for logical byte size, but actual disk usage can differ due to:

- block allocation;
- sparse files;
- compression;
- filesystem metadata;
- deduplication;
- copy-on-write;
- snapshots.

Still, logical size is often useful.

```java
public final class TreeStatsVisitor extends SimpleFileVisitor<Path> {
    private long fileCount;
    private long directoryCount;
    private long otherCount;
    private long totalLogicalBytes;
    private final List<String> failures = new ArrayList<>();

    @Override
    public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
        directoryCount++;
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
        if (attrs.isRegularFile()) {
            fileCount++;
            totalLogicalBytes += attrs.size();
        } else {
            otherCount++;
        }
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFileFailed(Path file, IOException exc) {
        failures.add(file + " -> " + exc.getClass().getSimpleName());
        return FileVisitResult.CONTINUE;
    }

    public long fileCount() {
        return fileCount;
    }

    public long directoryCount() {
        return directoryCount;
    }

    public long otherCount() {
        return otherCount;
    }

    public long totalLogicalBytes() {
        return totalLogicalBytes;
    }

    public List<String> failures() {
        return Collections.unmodifiableList(failures);
    }
}
```

Usage:

```java
TreeStatsVisitor visitor = new TreeStatsVisitor();
Files.walkFileTree(root, visitor);

System.out.println("files=" + visitor.fileCount());
System.out.println("dirs=" + visitor.directoryCount());
System.out.println("bytes=" + visitor.totalLogicalBytes());
System.out.println("failures=" + visitor.failures().size());
```

---

## 19. Building Resumable Tree Operations

A recursive operation over a large tree may fail after processing thousands or millions of entries.

Naive design:

```text
Start operation
  process files one by one
  if failure: throw
Restart operation from beginning
```

This is often unacceptable.

A better design records progress.

### 19.1 Basic Progress Journal

For each path:

```text
relative_path,status,error,timestamp
config/a.yml,DONE,,2026-06-18T10:20:00Z
config/b.yml,FAILED,AccessDeniedException,2026-06-18T10:20:01Z
```

Then on retry:

```text
if relative_path is DONE and target verification passes:
    skip
else:
    process again
```

### 19.2 Resumable Copy Pattern

State machine:

```text
DISCOVERED
  ↓
COPYING
  ↓
VERIFYING
  ↓
DONE

FAILED_RETRYABLE
FAILED_PERMANENT
```

Important: do not mark `DONE` immediately after `Files.copy` unless your definition of done is only “copy returned successfully”. For stronger correctness, verify:

- size matches;
- checksum matches, if required;
- metadata copied, if required;
- target path exists;
- target is not partial.

### 19.3 Avoid Absolute Paths in Journals

Prefer relative paths:

```text
relative path from operation root
```

Why?

- operation can be retried in another base directory;
- logs are portable;
- less sensitive information leakage;
- easier to compare manifests;
- easier to validate containment.

---

## 20. Designing Recursive Copy as a Recoverable Workflow

A robust copy is not merely:

```java
Files.copy(source, target);
```

It is a workflow:

```text
1. Validate source root.
2. Validate target root.
3. Create staging root.
4. Walk source tree.
5. For each directory: create staging directory.
6. For each file: copy into staging temp path.
7. Verify copied file.
8. Rename temp path to final staging path.
9. Record progress.
10. After tree complete: publish staging to final location.
11. Clean old staging.
```

This separates:

- partial work;
- verified staging result;
- final published result.

Directory tree operations are rarely atomic as a whole. Therefore, you approximate transactionality with staging, manifest, and recovery.

---

## 21. Recursive Delete as a Recoverable Workflow

Recursive delete is dangerous because retry behavior can be ambiguous.

If you delete directly:

```text
root/
  a.txt deleted
  b.txt failed
  sub/ partially deleted
```

Now the original tree no longer exists, but deletion did not complete.

A safer pattern for important paths is tombstone rename first:

```text
live/job-123
  ↓ atomic move if same filesystem
trash/job-123.deleted-20260618-abc
  ↓ recursive delete trash path asynchronously or synchronously
```

Advantages:

- removes from live namespace quickly;
- failed physical deletion can be retried later;
- prevents consumers from seeing partially deleted live tree;
- creates a clear operational artifact.

But it has trade-offs:

- requires same-filesystem atomic rename for best semantics;
- consumes disk until cleanup succeeds;
- needs trash retention policy;
- must protect trash directory itself.

---

## 22. The “Tree Transaction” Illusion

A common weak assumption:

```text
I copied/deleted/moved a directory tree, therefore operation is atomic.
```

Usually false.

Most recursive tree operations are sequences of many filesystem operations:

```text
mkdir target/a
copy file1
copy file2
mkdir target/b
copy file3
set attributes
...
```

A crash can happen between any two steps.

Therefore, robust design must define:

- visible intermediate states;
- how to detect partial state;
- how to resume;
- how to roll forward;
- how to roll back, if possible;
- how to make consumers ignore incomplete data.

The common solution is **publish-by-rename**:

```text
staging/job-id/complete-tree
  ↓ atomic move / marker creation
published/job-id
```

Or marker-based publication:

```text
published/job-id/
  payload files
  _SUCCESS
```

Consumers read only directories with `_SUCCESS`.

---

## 23. Error Aggregation Model for Tree Algorithms

For enterprise-grade tools, use structured error records.

Example:

```java
public final class TreeFailure {
    private final Path path;
    private final String phase;
    private final String exceptionType;
    private final String message;

    public TreeFailure(Path path, String phase, IOException exception) {
        this.path = path;
        this.phase = phase;
        this.exceptionType = exception.getClass().getName();
        this.message = exception.getMessage();
    }

    public Path path() {
        return path;
    }

    public String phase() {
        return phase;
    }

    public String exceptionType() {
        return exceptionType;
    }

    public String message() {
        return message;
    }
}
```

Phases might be:

```text
PRE_VISIT_DIRECTORY
VISIT_FILE
VISIT_FILE_FAILED
POST_VISIT_DIRECTORY
COPY_FILE
DELETE_FILE
DELETE_DIRECTORY
HASH_FILE
READ_ATTRIBUTES
CREATE_DIRECTORY
```

This makes operational reports much more useful.

Bad report:

```text
IOException occurred.
```

Useful report:

```text
COPY_FILE failed for config/a.yml: AccessDeniedException: permission denied
DELETE_DIRECTORY failed for old/run-42: DirectoryNotEmptyException
READ_ATTRIBUTES failed for uploads/x: NoSuchFileException: disappeared during traversal
```

---

## 24. Concurrency: The Tree Can Change While You Walk It

Filesystem traversal is not a snapshot unless the filesystem/provider explicitly gives you snapshot semantics, which normal Java file traversal does not assume.

During traversal:

- files may be created;
- files may be deleted;
- directories may be replaced;
- symlinks may be swapped;
- permissions may change;
- file content may change;
- a directory may become inaccessible;
- entries may appear or disappear from listing.

Therefore:

```text
A tree walk observes a moving target.
```

Design implications:

- A backup tool needs consistency policy.
- A checksum manifest may not represent one exact point in time.
- A delete job must tolerate disappeared files.
- A copy job must decide what to do if source changes mid-copy.
- A security scan must avoid TOCTOU assumptions.

### 24.1 Handling Disappeared Files

For cleanup, disappeared files are often fine:

```java
@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) throws IOException {
    if (exc instanceof NoSuchFileException) {
        return FileVisitResult.CONTINUE;
    }
    throw exc;
}
```

For backup, disappeared files may mean the backup is incomplete:

```java
if (exc instanceof NoSuchFileException) {
    failures.add(new TreeFailure(file, "READ_SOURCE", exc));
    return FileVisitResult.CONTINUE;
}
```

Policy depends on purpose.

---

## 25. Attribute Usage: Prefer the Attributes Already Given

`preVisitDirectory` and `visitFile` receive `BasicFileAttributes`.

Do not immediately call:

```java
Files.isDirectory(file)
Files.size(file)
Files.getLastModifiedTime(file)
```

if the needed data already exists in `attrs`:

```java
attrs.isDirectory()
attrs.isRegularFile()
attrs.size()
attrs.lastModifiedTime()
```

Why?

- fewer filesystem calls;
- less race window;
- better performance;
- clearer relationship to traversal state.

That said, attributes can still become stale immediately after being read. Treat them as an observation, not an immutable truth.

---

## 26. Recursive Algorithms and Ordering

Do not assume directory entries are visited in alphabetical order unless you explicitly sort.

Filesystem iteration order is generally not a stable contract.

If deterministic output matters, you need to collect and sort. But `walkFileTree` itself does not give you a “sort children before visiting” parameter.

Options:

1. Use `Files.walk(...)`, collect, sort, then process.
2. Implement your own traversal using `DirectoryStream`, sorting children per directory.
3. Generate manifest entries and sort them after traversal.

Trade-off:

```text
sorting requires memory or extra logic
streaming traversal is more memory efficient but not deterministic
```

For manifests, sort the output list after walking.

For massive trees, external sorting may be required.

---

## 27. Custom Sorted Tree Walk Skeleton

If you need deterministic per-directory order:

```java
public static void walkSorted(Path root, Consumer<Path> fileConsumer) throws IOException {
    if (Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
        List<Path> children = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(root)) {
            for (Path child : stream) {
                children.add(child);
            }
        }

        children.sort(Comparator.comparing(path -> path.getFileName().toString()));

        for (Path child : children) {
            walkSorted(child, fileConsumer);
        }
    } else {
        fileConsumer.accept(root);
    }
}
```

This is only a skeleton. It lacks:

- cycle detection;
- error phase model;
- symbolic-link policy;
- max-depth control;
- access-denied handling;
- cancellation;
- custom directory callbacks.

The point is not that this is better than `walkFileTree`. The point is that deterministic ordering has a cost.

---

## 28. Cancellation and Early Termination

For long scans, cancellation matters.

Example with an `AtomicBoolean`:

```java
public final class CancellableVisitor extends SimpleFileVisitor<Path> {
    private final AtomicBoolean cancelled;

    public CancellableVisitor(AtomicBoolean cancelled) {
        this.cancelled = cancelled;
    }

    @Override
    public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
        return cancelled.get() ? FileVisitResult.TERMINATE : FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
        return cancelled.get() ? FileVisitResult.TERMINATE : FileVisitResult.CONTINUE;
    }
}
```

This is cooperative cancellation. It does not interrupt a currently running filesystem call, but it stops future traversal callbacks.

For production jobs, record cancellation state:

```text
CANCELLED_BY_USER
CANCELLED_BY_TIMEOUT
CANCELLED_BY_ERROR_THRESHOLD
```

Do not report cancellation as success.

---

## 29. Parallelism: Be Careful

`walkFileTree` itself is a depth-first visitor mechanism, not a parallel traversal engine.

A common temptation:

```text
visitFile → submit file work to executor → continue traversal
```

This can be valid, but introduces complexity:

- backpressure;
- executor queue growth;
- preserving failure semantics;
- cancellation;
- too many open files;
- disk seek amplification;
- directory metadata contention;
- non-deterministic ordering;
- memory pressure.

Safer pattern:

```text
walker thread discovers files
bounded queue holds work
worker pool processes files
failure policy controls cancellation
```

Sketch:

```java
BlockingQueue<Path> queue = new ArrayBlockingQueue<>(10_000);
AtomicBoolean stop = new AtomicBoolean(false);

// walker: queue.put(file)
// workers: queue.take(), process(file)
```

Do not submit millions of files to an unbounded executor.

Top-tier rule:

```text
Parallel file processing must be bounded by disk, filesystem, and operational failure handling — not just CPU count.
```

---

## 30. Building a Bounded Producer-Consumer Walker

A simplified pattern:

```java
public final class QueueingVisitor extends SimpleFileVisitor<Path> {
    private final BlockingQueue<Path> queue;
    private final AtomicBoolean cancelled;

    public QueueingVisitor(BlockingQueue<Path> queue, AtomicBoolean cancelled) {
        this.queue = queue;
        this.cancelled = cancelled;
    }

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        if (cancelled.get()) {
            return FileVisitResult.TERMINATE;
        }

        if (attrs.isRegularFile()) {
            try {
                queue.put(file);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return FileVisitResult.TERMINATE;
            }
        }

        return FileVisitResult.CONTINUE;
    }
}
```

This gives backpressure because `queue.put` blocks when workers fall behind.

But a complete system still needs:

- poison-pill or completion signal;
- worker exception propagation;
- cancellation propagation;
- job metrics;
- retry strategy;
- bounded memory;
- graceful shutdown.

---

## 31. Exception Taxonomy for Tree Operations

Useful exceptions to classify:

| Exception | Meaning |
|---|---|
| `NoSuchFileException` | entry disappeared or path does not exist |
| `AccessDeniedException` | permission denied or file locked depending on platform |
| `DirectoryNotEmptyException` | delete directory failed because entries remain |
| `FileAlreadyExistsException` | create/copy target collision |
| `FileSystemLoopException` | cycle detected, often from symbolic links |
| `AtomicMoveNotSupportedException` | atomic move unavailable |
| `NotDirectoryException` | expected directory but found non-directory |
| `NotLinkException` | expected symbolic link but found other entry |
| `FileSystemException` | general filesystem failure with file/reason context |

For visitor algorithms, exception class alone is not enough. Record:

- path;
- phase;
- source path;
- target path;
- operation ID;
- retry count;
- root path;
- relative path;
- whether link following was enabled.

---

## 32. Robust Recursive Delete with Error Aggregation

Example: attempt to delete as much as possible, but report failures.

```java
public final class BestEffortDeleteVisitor extends SimpleFileVisitor<Path> {
    private final List<IOException> failures = new ArrayList<>();

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            failures.add(new IOException("Failed to delete file: " + file, e));
        }
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFileFailed(Path file, IOException exc) {
        if (exc instanceof NoSuchFileException) {
            return FileVisitResult.CONTINUE;
        }
        failures.add(new IOException("Failed to visit: " + file, exc));
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
        if (exc != null) {
            failures.add(new IOException("Failed while iterating directory: " + dir, exc));
        }

        try {
            Files.deleteIfExists(dir);
        } catch (IOException e) {
            failures.add(new IOException("Failed to delete directory: " + dir, e));
        }

        return FileVisitResult.CONTINUE;
    }

    public void throwIfFailed() throws IOException {
        if (failures.isEmpty()) {
            return;
        }
        IOException error = new IOException("Delete completed with " + failures.size() + " failure(s)");
        for (IOException failure : failures) {
            error.addSuppressed(failure);
        }
        throw error;
    }
}
```

Usage:

```java
BestEffortDeleteVisitor visitor = new BestEffortDeleteVisitor();
Files.walkFileTree(root, visitor);
visitor.throwIfFailed();
```

This operation is not all-or-nothing. It is explicitly:

```text
best-effort delete with final failure report
```

That distinction is operationally important.

---

## 33. Robust Recursive Copy with Staging

A safer copy approach:

```text
sourceRoot
  ↓ walk
stagingRoot/.copy-job-123
  ↓ verify complete
finalRoot
```

Simplified visitor:

```java
public final class StagingCopyVisitor extends SimpleFileVisitor<Path> {
    private final Path sourceRoot;
    private final Path stagingRoot;

    public StagingCopyVisitor(Path sourceRoot, Path stagingRoot) {
        this.sourceRoot = sourceRoot;
        this.stagingRoot = stagingRoot;
    }

    @Override
    public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
        Path relative = sourceRoot.relativize(dir);
        Path targetDir = stagingRoot.resolve(relative);
        Files.createDirectories(targetDir);
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        if (!attrs.isRegularFile()) {
            return FileVisitResult.CONTINUE;
        }

        Path relative = sourceRoot.relativize(file);
        Path target = stagingRoot.resolve(relative);
        Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");

        Files.copy(file, tmp, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);

        long sourceSize = attrs.size();
        long targetSize = Files.size(tmp);
        if (sourceSize != targetSize) {
            throw new IOException("Size mismatch for " + file + " -> " + tmp);
        }

        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        return FileVisitResult.CONTINUE;
    }
}
```

This is still not perfect:

- source may change after `attrs.size()`;
- `COPY_ATTRIBUTES` may not preserve everything;
- `ATOMIC_MOVE` may not be supported;
- checksum may be needed for stronger verification;
- directory metadata may require post-copy adjustment;
- failure cleanup must be defined.

But it is already much better than direct copy into final visible location.

---

## 34. Handling Directory Metadata After Copy

If preserving directory timestamps matters, setting them in `preVisitDirectory` is often wrong because child creation modifies the directory metadata afterward.

Better pattern:

```java
@Override
public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
    if (exc != null) {
        throw exc;
    }

    Path relative = sourceRoot.relativize(dir);
    Path targetDir = targetRoot.resolve(relative);

    BasicFileAttributes attrs = Files.readAttributes(dir, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    Files.setLastModifiedTime(targetDir, attrs.lastModifiedTime());

    return FileVisitResult.CONTINUE;
}
```

Why `postVisitDirectory`?

Because after all children are copied, directory modification caused by creating children is done.

---

## 35. Skip Policy as a First-Class Object

Avoid scattering skip logic inside visitor methods.

Better:

```java
public interface TreeSkipPolicy {
    boolean shouldSkipDirectory(Path dir, BasicFileAttributes attrs);
    boolean shouldSkipFile(Path file, BasicFileAttributes attrs);
}
```

Then:

```java
@Override
public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
    if (skipPolicy.shouldSkipDirectory(dir, attrs)) {
        return FileVisitResult.SKIP_SUBTREE;
    }
    return FileVisitResult.CONTINUE;
}

@Override
public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
    if (skipPolicy.shouldSkipFile(file, attrs)) {
        return FileVisitResult.CONTINUE;
    }
    process(file, attrs);
    return FileVisitResult.CONTINUE;
}
```

This makes skip behavior:

- testable;
- configurable;
- auditable;
- reusable;
- explicit.

Example policies:

```text
Skip hidden files
Skip files larger than 2 GB
Skip directories named .git
Skip files modified after scan start
Skip non-regular files
Skip paths matching denylist
Skip if owner is not expected user
```

---

## 36. Result Object for Tree Operations

Production recursive operations should return a result object, not just `void`.

Example:

```java
public final class TreeOperationResult {
    private long directoriesVisited;
    private long filesVisited;
    private long filesProcessed;
    private long bytesProcessed;
    private final List<TreeFailure> failures = new ArrayList<>();
    private boolean terminatedEarly;

    public void incrementDirectoriesVisited() {
        directoriesVisited++;
    }

    public void incrementFilesVisited() {
        filesVisited++;
    }

    public void addBytesProcessed(long bytes) {
        bytesProcessed += bytes;
    }

    public void addFailure(TreeFailure failure) {
        failures.add(failure);
    }

    public boolean hasFailures() {
        return !failures.isEmpty();
    }
}
```

This supports:

- API response;
- job status page;
- logs;
- metrics;
- retry decisions;
- audit trail;
- postmortem analysis.

---

## 37. Observability for Tree Algorithms

For long file tree operations, capture:

```text
operation_id
root_path or sanitized root identifier
relative_path currently processing
phase
files_visited_total
directories_visited_total
bytes_processed_total
failures_total
start_time
last_progress_time
current_rate_files_per_second
current_rate_bytes_per_second
cancelled
completed
```

But avoid logging sensitive full paths if paths may contain:

- usernames;
- tenant names;
- customer identifiers;
- document names;
- case numbers;
- secret names.

Use relative paths and operation IDs where possible.

---

## 38. Security Considerations in Tree Visitors

A visitor can accidentally become a security vulnerability.

### 38.1 Dangerous Pattern: Follow Links During Delete

```java
Files.walkFileTree(root, EnumSet.of(FileVisitOption.FOLLOW_LINKS), Integer.MAX_VALUE, deleteVisitor);
```

Unless you are extremely sure, do not do this.

### 38.2 Dangerous Pattern: No Root Guard

```java
deleteTree(pathFromRequest);
```

Always validate against an allowed base.

### 38.3 Dangerous Pattern: String-Based Target Mapping

```java
String target = source.toString().replace("/input", "/output");
```

Use `relativize` and `resolve`.

### 38.4 Dangerous Pattern: Ignoring `visitFileFailed`

```java
return FileVisitResult.CONTINUE;
```

without recording the failure.

This can produce false success.

---

## 39. Java 8–25 Compatibility Notes

Most core APIs in this part are available since Java 7 and therefore available in Java 8:

- `Files.walkFileTree`
- `FileVisitor`
- `SimpleFileVisitor`
- `FileVisitResult`
- `FileVisitOption`
- `BasicFileAttributes`

But some code examples need adaptation for Java 8:

### 39.1 `Set.of` Is Not Java 8

Java 9+:

```java
Set<String> names = Set.of(".git", "target");
```

Java 8:

```java
Set<String> names = new HashSet<>(Arrays.asList(".git", "target"));
```

### 39.2 `record` Is Not Java 8

Java 16+:

```java
public record Entry(String path, String sha256, long size) {}
```

Java 8:

```java
public final class Entry {
    private final String path;
    private final String sha256;
    private final long size;
    // constructor + getters
}
```

### 39.3 `var` Is Not Java 8

Java 10+:

```java
var visitor = new TreeStatsVisitor();
```

Java 8:

```java
TreeStatsVisitor visitor = new TreeStatsVisitor();
```

### 39.4 `Path.of` Is Not Java 8

Java 11+:

```java
Path root = Path.of("/data/input");
```

Java 8:

```java
Path root = Paths.get("/data/input");
```

---

## 40. Common Anti-Patterns

### Anti-Pattern 1: Recursive Delete Without Boundary

```java
deleteTree(Paths.get(userInput));
```

Problem:

```text
User input controls destructive tree operation.
```

Better:

```text
resolve under allowed base
normalize/real-path validate
refuse deleting base itself
avoid following links
log operation ID
```

### Anti-Pattern 2: Treating Traversal as a Snapshot

```text
Walk tree → assume manifest is perfectly consistent.
```

Problem:

```text
Files may change during traversal.
```

Better:

```text
define consistency model
use staging/quiescence/snapshot if needed
record scan start/end
verify critical files
```

### Anti-Pattern 3: Ignoring `postVisitDirectory` Exception

```java
public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
    return CONTINUE;
}
```

Problem:

```text
Directory iteration may have failed.
```

Better:

```java
if (exc != null) throw exc;
```

or record it explicitly.

### Anti-Pattern 4: Submitting Every File to Unbounded Executor

```java
executor.submit(() -> process(file));
```

inside `visitFile`, for millions of files.

Problem:

```text
unbounded memory, too many queued tasks, poor failure propagation
```

Better:

```text
bounded queue + workers + backpressure + cancellation
```

### Anti-Pattern 5: Copying Directly Into Published Location

Problem:

```text
Consumers can see partial tree.
```

Better:

```text
copy into staging
verify
publish by atomic marker or rename
```

---

## 41. Decision Matrix: Which Traversal API Should I Use?

| Need | Prefer |
|---|---|
| Simple list of immediate children | `Files.list` or `DirectoryStream` |
| Large directory iteration with low memory | `DirectoryStream` |
| Filter/search paths recursively | `Files.find` or `Files.walk` |
| Recursive delete | `walkFileTree` |
| Recursive copy | `walkFileTree` |
| Directory finalization after children | `walkFileTree` |
| Need `pre` and `post` directory phases | `walkFileTree` |
| Need custom failure strategy per phase | `walkFileTree` |
| Need deterministic global sorted output | collect + sort or custom traversal |
| Need high-throughput parallel processing | `walkFileTree` as producer + bounded workers |

---

## 42. Production Checklist for `FileVisitor` Algorithms

Before shipping a tree operation, answer these:

### Scope

- What is the root?
- Is the root trusted?
- Can user input influence it?
- Can the operation escape the root?
- Is deleting/copying the root itself allowed?

### Link Policy

- Are symbolic links followed?
- Are links copied as links or targets?
- Can links escape the root?
- What happens on link loops?

### Failure Policy

- Fail fast?
- Best effort?
- Accumulate then throw?
- Which exceptions are retryable?
- Which exceptions are permanent?
- How are partial results detected?

### Consistency

- Can the tree change during traversal?
- Is that acceptable?
- Do we need snapshot/quiescence/staging?
- Do we verify file size/hash?

### Visibility

- Can consumers see partial output?
- Is there a `_SUCCESS` marker?
- Is there atomic publish?
- Is staging hidden or isolated?

### Performance

- Could the tree have millions of entries?
- Are attributes reused?
- Is processing bounded?
- Is ordering required?
- Is memory usage bounded?

### Observability

- Do we track files visited?
- Do we track bytes processed?
- Do we record failures by phase?
- Do we expose progress?
- Do we have an operation ID?

### Recovery

- Can operation resume?
- Is there a journal?
- Can partial output be cleaned?
- Can cleanup itself fail?
- Is retry idempotent?

---

## 43. Mental Model Summary

`Files.walkFileTree` is best understood as:

```text
A depth-first traversal engine that calls your visitor at stable algorithmic phases.
```

Those phases are what make recursive file algorithms robust:

```text
preVisitDirectory  → prepare or reject subtree
visitFile          → process leaf/non-directory entry
visitFileFailed    → classify inaccessible/disappeared/problem entry
postVisitDirectory → finalize directory after children
```

The big shift is this:

```text
Beginner view:
  Recursive traversal means “loop all files”.

Advanced view:
  Recursive traversal is a failure-prone, mutable, platform-dependent tree state machine.
```

Once you see it as a state machine, the design questions become clearer:

- What state am I in?
- What invariant must hold now?
- What if this file changed?
- What if this directory fails?
- What if this path is a symlink?
- What if the operation is interrupted?
- What does success actually mean?

That is the level of thinking needed for reliable filesystem engineering.

---

## 44. Key Takeaways

1. `FileVisitor` gives explicit lifecycle phases for tree algorithms.
2. `SimpleFileVisitor` is usually the best base class.
3. `FileVisitResult` controls traversal and should be used deliberately.
4. Recursive delete belongs in `visitFile` and `postVisitDirectory`.
5. Recursive copy usually creates directories in `preVisitDirectory` and copies files in `visitFile`.
6. `visitFileFailed` must not be ignored silently.
7. `postVisitDirectory` is essential for directory finalization and error handling.
8. A filesystem tree can change while being traversed.
9. Symbolic-link policy is a correctness and security decision.
10. Large tree operations need result objects, progress, bounded concurrency, and recovery strategy.
11. Directory tree operations are rarely atomic as a whole.
12. Staging, manifests, markers, and journals are how production systems approximate transactionality.

---

## 45. Exercises

### Exercise 1 — Safe Recursive Delete

Implement a recursive delete utility that:

- refuses to delete the base directory itself;
- validates target is under base;
- does not follow symbolic links;
- records failures;
- returns a result object.

### Exercise 2 — Recursive Copy with Manifest

Implement recursive copy that:

- copies into staging directory;
- computes SHA-256 for each file;
- writes `manifest.txt`;
- writes `_SUCCESS` only after all files are copied;
- reports failure if any file cannot be copied.

### Exercise 3 — Permission Audit

Implement a tree audit that reports:

- unreadable entries;
- world-writable POSIX files;
- directories that are writable by others;
- unsupported permission views.

### Exercise 4 — Skip Policy

Create a reusable skip policy supporting:

- directory names to skip;
- max file size;
- file extension allowlist;
- hidden file skip;
- modified-before/after filter.

### Exercise 5 — Bounded Parallel Processor

Implement a walker that feeds regular files into a bounded queue consumed by worker threads. Requirements:

- bounded memory;
- cancellation on fatal error;
- progress metrics;
- final error aggregation.

---

## 46. References

- Java SE 25 API — `java.nio.file.Files`
- Java SE 25 API — `java.nio.file.FileVisitor`
- Java SE 8 API — `java.nio.file.FileVisitor`
- Java SE 8 API — `java.nio.file.SimpleFileVisitor`
- Oracle Java Tutorials — Walking the File Tree
- dev.java — Walking the File Tree

---

## 47. Next Part

Next:

```text
Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming
```

We will go deeper into links as filesystem identity indirection:

- symbolic links vs hard links;
- `createSymbolicLink`;
- `createLink`;
- `readSymbolicLink`;
- `NOFOLLOW_LINKS`;
- link loops;
- link traversal attack;
- Windows junction/reparse-point caveats;
- safe extraction and upload handling;
- containment validation under hostile filesystem mutation.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering](./learn-java-io-file-filesystem-storage-engineering-part-10-directory-listing-traversal.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming](./learn-java-io-file-filesystem-storage-engineering-part-12-symbolic-links-hard-links-junctions.md)

</div>