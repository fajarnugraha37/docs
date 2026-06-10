# Strict Coding Standards — Go File I/O

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, CLIs, import/export jobs, archival jobs, evidence/document modules, batch processors, migration tools, regulatory workflow systems  
Baseline: Go 1.24–1.26+, `os`, `io/fs`, `path/filepath`, `embed`, standard library first

---

## 1. Purpose

Filesystem code is security-sensitive and failure-prone.

The LLM MUST treat file paths, filenames, archive entries, permissions, symlinks, temporary files, partial writes, atomicity, cleanup, and cross-platform behavior as explicit design concerns. File I/O code MUST be safe against traversal, race conditions, data loss, resource leaks, permission mistakes, and memory exhaustion.

This document specializes the general I/O standard for filesystem boundaries.

---

## 2. Source authority

Primary references:

- Go `os` package documentation: https://pkg.go.dev/os
- Go `io/fs` package documentation: https://pkg.go.dev/io/fs
- Go `path/filepath` package documentation: https://pkg.go.dev/path/filepath
- Go `embed` package documentation: https://pkg.go.dev/embed
- Go `archive/zip` package documentation: https://pkg.go.dev/archive/zip
- Go `archive/tar` package documentation: https://pkg.go.dev/archive/tar
- Go `io` package documentation: https://pkg.go.dev/io
- Go 1.24 release notes for `os.Root`: https://go.dev/doc/go1.24
- Go security documentation: https://go.dev/doc/security

If project-specific storage, archival, evidence retention, or platform policy is stricter, it wins. The LLM MUST report mismatches.

---

## 3. File boundary taxonomy

The LLM MUST classify the file boundary before coding.

| Boundary           | Main risk                            | Required decision               |
| ------------------ | ------------------------------------ | ------------------------------- |
| Config file        | unsafe defaults, unknown keys        | strict parse and fail fast      |
| Uploaded file      | traversal, size, MIME spoofing       | quarantine, limit, validate     |
| Export file        | partial write, leakage               | temp + fsync + rename policy    |
| Import batch       | malformed record, huge file          | streaming parser and row errors |
| Evidence/document  | retention, immutability, audit       | content hash and metadata       |
| Cache file         | stale/corrupt data                   | version and rebuild policy      |
| Lock file          | stale lock, cross-platform semantics | timeout and owner metadata      |
| Embedded file      | path consistency                     | `fs.ValidPath` and tests        |
| Archive extraction | zip slip, symlink, bomb              | entry validation and quotas     |
| Temporary file     | leak, permission                     | secure temp dir and cleanup     |

---

## 4. Non-negotiable rules

### 4.1 Treat every external path as untrusted

The LLM MUST NOT join user-provided paths with a base directory and assume the result is safe. It MUST validate locality, clean path, reject absolute paths, reject parent traversal, and apply symlink policy.

Forbidden:

```go
path := filepath.Join(baseDir, r.FormValue("name"))
return os.ReadFile(path)
```

Required minimum:

```go
name := r.FormValue("name")
if name == "" || filepath.IsAbs(name) || !filepath.IsLocal(name) {
	return ErrInvalidPath
}
clean := filepath.Clean(name)
path := filepath.Join(baseDir, clean)
```

For security-sensitive directory confinement, prefer `os.Root` on Go 1.24+ where available and appropriate.

### 4.2 Never extract archive entries without path validation

Archive entry names MUST be validated as relative, local paths before writing.

Required:

```go
func safeArchivePath(name string) (string, error) {
	if name == "" || filepath.IsAbs(name) || !filepath.IsLocal(name) {
		return "", ErrInvalidArchivePath
	}
	clean := filepath.Clean(name)
	if clean == "." || strings.HasPrefix(clean, "..") {
		return "", ErrInvalidArchivePath
	}
	return clean, nil
}
```

### 4.3 Bound all file reads from untrusted or large sources

The LLM MUST NOT use `os.ReadFile` for untrusted or potentially large files unless the file size is checked and the memory budget is acceptable.

Forbidden:

```go
b, err := os.ReadFile(uploadPath)
```

Required:

```go
f, err := os.Open(uploadPath)
if err != nil {
	return fmt.Errorf("open upload: %w", err)
}
defer f.Close()

b, err := ReadBounded(f, maxUploadBytes)
if err != nil {
	return err
}
```

### 4.4 Use streaming for large imports/exports

Large files MUST be processed with `io.Reader`/`io.Writer` streaming. The LLM MUST NOT materialize entire files unless bounded by explicit domain policy.

### 4.5 Always close files

Every successful `os.Open`, `os.Create`, `os.OpenFile`, `os.CreateTemp`, pipe, or directory open MUST have a close path.

Required:

```go
f, err := os.Open(path)
if err != nil {
	return err
}
defer f.Close()
```

### 4.6 Check close errors on write files

A file write can fail on flush/close. The LLM MUST check close errors when data durability matters.

Required:

```go
func writeFileAtomic(path string, data []byte, perm fs.FileMode) (err error) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err = tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temp file: %w", err)
	}
	if closeErr := tmp.Close(); closeErr != nil {
		return fmt.Errorf("close temp file: %w", closeErr)
	}
	if err = os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}
```

### 4.7 Atomic write is temp file + flush + close + rename

For config, export, checkpoint, cache metadata, and durable state, the LLM MUST NOT overwrite files in place unless partial/corrupt file is acceptable.

Forbidden:

```go
return os.WriteFile(path, data, 0644) // not atomic by itself
```

### 4.8 File permissions must be explicit

The LLM MUST choose file modes based on sensitivity.

Default guidance:

| File type                      |       Typical mode | Notes                            |
| ------------------------------ | -----------------: | -------------------------------- |
| secret/config with credentials |             `0600` | owner read/write only            |
| private app data               |   `0600` or `0640` | depends on group policy          |
| public export                  |             `0644` | only if safe for all local users |
| directory with private data    |             `0700` | owner only                       |
| shared directory               | `0750` or stricter | group policy required            |
| executable generated file      |   `0755` or `0700` | only if execution required       |

Never use `0777` or `0666` unless explicitly justified and reviewed.

### 4.9 Do not follow symlinks unless policy says so

The LLM MUST decide whether symlinks are allowed. For untrusted paths and archive extraction, symlinks SHOULD be rejected by default.

Use `os.Lstat` to inspect the link itself; use `os.Stat` only when following links is intended.

### 4.10 Do not rely on check-then-open for security

This is vulnerable to time-of-check/time-of-use races. If confinement matters, use safer APIs such as `os.Root` on Go 1.24+ or OS-specific secure open behavior where needed.

---

## 5. Path handling rules

### 5.1 Use `path/filepath` for OS paths

Use `path/filepath` for host filesystem paths. Use `path` for slash-separated URL paths or `io/fs` paths.

### 5.2 Use `io/fs` paths for embedded and virtual filesystems

`io/fs` paths are slash-separated, unrooted paths. Use `fs.ValidPath` when validating `fs.FS` names.

### 5.3 Do not compare paths as raw strings

Normalize/clean paths according to the boundary before comparison. Be careful with case-insensitive filesystems.

### 5.4 Preserve original filename only as metadata

For uploads, the original filename MUST NOT be used as storage path. Store content under generated ID/hash and keep original filename as metadata after validation/redaction.

Required:

```go
storedName := uuid.NewString()
storedPath := filepath.Join(uploadDir, storedName)
```

### 5.5 Reject path control characters

User-visible names SHOULD reject or sanitize NUL, path separators, control characters, and ambiguous Unicode where the project has display/security concerns.

---

## 6. Opening and creating files

### 6.1 Open flags must be intentional

The LLM MUST choose flags deliberately:

| Need                       | Flags                                                             |
| -------------------------- | ----------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| read existing              | `os.Open`                                                         |
| create new, fail if exists | `os.OpenFile(path, os.O_WRONLY                                    | os.O_CREATE | os.O_EXCL, perm)`                                                         |
| append log                 | `os.OpenFile(path, os.O_WRONLY                                    | os.O_CREATE | os.O_APPEND, perm)`                                                       |
| truncate existing          | `os.OpenFile(path, os.O_WRONLY                                    | os.O_CREATE | os.O_TRUNC, perm)` only when partial write acceptable or temp+rename used |
| read/write update          | `os.OpenFile(path, os.O_RDWR, perm)` with lock/transaction policy |

### 6.2 Do not create predictable temporary files

Use `os.CreateTemp` or `os.MkdirTemp`; do not generate temp paths manually.

Forbidden:

```go
tmp := filepath.Join(os.TempDir(), fmt.Sprintf("export-%d.tmp", time.Now().UnixNano()))
```

Required:

```go
tmp, err := os.CreateTemp(workDir, "export-*.tmp")
```

### 6.3 Clean up temp files and directories

Every temp file/dir MUST have cleanup on error. Long-lived temp files require retention policy.

### 6.4 Directory creation must use explicit mode

```go
if err := os.MkdirAll(dir, 0700); err != nil {
	return fmt.Errorf("create private directory: %w", err)
}
```

---

## 7. Reading files

### 7.1 Prefer `os.ReadFile` only for small trusted files

Acceptable:

- embedded fixtures;
- small config files with file-size guard;
- tests;
- trusted static assets.

Not acceptable:

- uploads;
- large exports/imports;
- archive entries;
- network-mounted unbounded files;
- user-selected files in server code.

### 7.2 Use `ReadDir` for directory entries

Prefer `os.ReadDir` over older file-info based listing when only names/types are needed.

### 7.3 Directory walking must handle errors explicitly

Required:

```go
err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
	if walkErr != nil {
		return fmt.Errorf("walk %s: %w", path, walkErr)
	}
	if d.IsDir() {
		return nil
	}
	return consume(path, d)
})
```

### 7.4 Avoid following symlink loops in traversal

Define symlink behavior explicitly. Default: do not follow symlinks when walking untrusted trees.

---

## 8. Writing files

### 8.1 Choose atomicity based on file role

| File role               | Required behavior                        |
| ----------------------- | ---------------------------------------- |
| checkpoint/state        | atomic write required                    |
| config generated by app | atomic write required                    |
| export artifact         | temp file then publish/rename            |
| append-only log         | append mode, rotation policy             |
| cache                   | atomic metadata or rebuild-on-corruption |
| temporary scratch       | cleanup and bounded lifetime             |

### 8.2 Sync when durability matters

For durable state, call `File.Sync` before close and consider syncing parent directory after rename on platforms where required by durability policy.

### 8.3 Do not ignore short writes

Use `writeFull`, `io.Copy`, or check write results.

### 8.4 Do not mix buffered writer and file sync incorrectly

Flush buffered writer before syncing file.

Required:

```go
bw := bufio.NewWriter(f)
if _, err := bw.Write(data); err != nil {
	return err
}
if err := bw.Flush(); err != nil {
	return err
}
if err := f.Sync(); err != nil {
	return err
}
```

---

## 9. File locking rules

### 9.1 Do not invent lock files casually

File locking is platform-specific and subtle. The LLM MUST prefer database locks, object-store conditional writes, or dedicated lock libraries where appropriate.

### 9.2 Lock files need stale-lock policy

If lock files are used, include:

- owner id;
- PID/hostname where meaningful;
- created time;
- expiry or heartbeat;
- atomic create with `O_EXCL`;
- cleanup on shutdown;
- behavior when stale lock is detected.

### 9.3 In-process mutex is not cross-process lock

`sync.Mutex` protects only the current process.

---

## 10. Embedded filesystem rules

### 10.1 Use `embed.FS` for static assets and fixtures

Embedded files are immutable at runtime and should be accessed through `fs.FS` where possible.

### 10.2 Do not assume OS path semantics for `embed.FS`

Use slash-separated paths and `io/fs` semantics.

### 10.3 Test required embedded paths

If handlers depend on embedded templates, migrations, or assets, tests MUST verify that required files exist.

---

## 11. Archive extraction rules

### 11.1 Enforce extraction quotas

Required quotas:

- maximum archive file size;
- maximum entry count;
- maximum total uncompressed bytes;
- maximum per-entry uncompressed bytes;
- maximum path length;
- maximum directory depth;
- compression ratio threshold where practical.

### 11.2 Reject unsafe entry types by default

For untrusted archives, reject:

- absolute paths;
- parent traversal;
- symlinks;
- hardlinks;
- device files;
- named pipes;
- setuid/setgid bits;
- executable bits unless allowed;
- duplicate target paths unless overwrite policy exists.

### 11.3 Extract through temporary directory

Untrusted archive extraction SHOULD happen in a quarantine/temp directory first, then be validated and moved/published.

---

## 12. Error handling rules

### 12.1 Preserve filesystem error identity

Use `errors.Is` with `fs.ErrNotExist`, `fs.ErrPermission`, `fs.ErrExist`, and related errors. Do not string-match errors.

Required:

```go
_, err := os.Stat(path)
if err != nil {
	if errors.Is(err, fs.ErrNotExist) {
		return ErrDocumentMissing
	}
	return fmt.Errorf("stat document: %w", err)
}
```

### 12.2 Wrap path errors carefully

Errors may include paths. Avoid exposing internal absolute paths to users. Log internal path only in secure logs.

### 12.3 Separate user error from operator error

A missing upload filename may be a 400; a permission denied on storage directory is a 500/operator incident.

---

## 13. Security and privacy rules

### 13.1 Never log full sensitive file contents

Do not log:

- uploaded files;
- document/evidence contents;
- secret files;
- private keys;
- full config with credentials;
- raw archive entries.

### 13.2 Hash large artifacts for integrity

Evidence/import/export artifacts SHOULD have content hashes for auditability and deduplication.

### 13.3 Separate public name from storage key

Store files by immutable ID/content hash. Original names are untrusted metadata.

### 13.4 Delete securely only if policy requires it

Normal deletion does not guarantee secure erase. If secure deletion is required, rely on encrypted storage and key destruction rather than ad-hoc overwriting.

---

## 14. Observability rules

File operations that affect business state MUST log/measure:

- operation name;
- logical artifact id;
- storage backend;
- file size;
- content hash when appropriate;
- duration;
- error class;
- actor/request id;
- retry count;
- final state.

Do not log absolute paths in user-visible errors.

---

## 15. Testing rules

### 15.1 Use `t.TempDir`

Tests MUST use `t.TempDir()` for filesystem scratch space.

### 15.2 Test permissions and missing paths

Where platform permits, test:

- missing file;
- existing file conflict;
- permission denied;
- directory instead of file;
- symlink behavior;
- partial write/close error with test doubles;
- corrupted file;
- oversized file;
- invalid path.

### 15.3 Test path traversal

Required invalid cases:

- `../x`;
- `..\\x` on Windows-sensitive code;
- absolute path;
- empty path;
- `.`;
- duplicate separators;
- URL-encoded traversal if input came from URL;
- Unicode confusables if display/security policy covers them.

### 15.4 Test atomic write failure paths

Use fake writers or controlled functions to verify temp files are cleaned up when write, sync, close, or rename fails.

---

## 16. Forbidden patterns

```go
// User path joined directly.
path := filepath.Join(base, userInput)

// Unbounded file read.
b, _ := os.ReadFile(uploadPath)

// In-place overwrite of durable state.
os.WriteFile(checkpointPath, data, 0644)

// Predictable temp path.
tmp := filepath.Join(os.TempDir(), "upload.tmp")

// Ignores close error on write file.
f, _ := os.Create(path)
f.Write(data)
f.Close()

// Unsafe archive extraction.
out := filepath.Join(dest, zipEntry.Name)
os.WriteFile(out, content, 0644)

// Overly broad permission.
os.WriteFile(secretPath, secret, 0777)

// String-matched error.
if strings.Contains(err.Error(), "no such file") { ... }
```

---

## 17. Preferred patterns

### 17.1 Safe local path validation

```go
func cleanLocalPath(name string) (string, error) {
	if name == "" || filepath.IsAbs(name) || !filepath.IsLocal(name) {
		return "", ErrInvalidPath
	}
	clean := filepath.Clean(name)
	if clean == "." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return "", ErrInvalidPath
	}
	return clean, nil
}
```

### 17.2 Stream file copy with hash and limit

```go
func CopyFileWithHash(dst *os.File, src *os.File, max int64) ([32]byte, int64, error) {
	h := sha256.New()
	lr := &io.LimitedReader{R: src, N: max + 1}
	n, err := io.Copy(io.MultiWriter(dst, h), lr)
	if err != nil {
		return [32]byte{}, n, fmt.Errorf("copy file: %w", err)
	}
	if n > max || lr.N == 0 {
		return [32]byte{}, n, ErrFileTooLarge
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum, n, nil
}
```

### 17.3 Dependency-injected filesystem for tests

```go
type DocumentStore struct {
	fsys fs.FS
}

func (s *DocumentStore) Open(name string) (fs.File, error) {
	clean, err := cleanFSPath(name)
	if err != nil {
		return nil, err
	}
	return s.fsys.Open(clean)
}
```

---

## 18. LLM implementation checklist

Before committing file I/O code, the LLM MUST verify:

- [ ] The file boundary is classified.
- [ ] User/external paths are validated and localized.
- [ ] Archive extraction validates every entry.
- [ ] Large/untrusted files are streamed and bounded.
- [ ] Files are closed.
- [ ] Write close/flush/sync errors are handled.
- [ ] Atomic write is used where partial files are unacceptable.
- [ ] File permissions are explicit and least-privilege.
- [ ] Symlink behavior is defined.
- [ ] Temporary files/dirs are securely created and cleaned up.
- [ ] Error identity is preserved with `errors.Is`/`errors.As`.
- [ ] Internal paths are not exposed to users.
- [ ] Tests use `t.TempDir` and cover traversal/oversize/failure paths.
- [ ] Observability records logical artifact IDs, not sensitive content.

---

## 19. Review rejection triggers

Reject code when:

- it joins user input directly into filesystem paths;
- it uses `os.ReadFile` on untrusted/large files without size guard;
- it overwrites durable files in place;
- it ignores close/sync/flush errors on write paths;
- it extracts archives without traversal and quota checks;
- it uses predictable temp filenames;
- it grants broad permissions without justification;
- it follows symlinks unintentionally;
- it logs sensitive file content;
- it lacks traversal tests for user-controlled paths.
