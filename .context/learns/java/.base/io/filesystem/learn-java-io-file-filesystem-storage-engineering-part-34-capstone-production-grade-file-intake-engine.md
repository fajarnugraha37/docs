# learn-java-io-file-filesystem-storage-engineering — Part 34
# Capstone: Build a Production-Grade File Intake Engine

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `34`  
> Topik: Capstone production-grade file intake engine  
> Target Java: 8 sampai 25  
> Fokus: state machine, directory protocol, atomic handoff, validation, idempotency, recovery, concurrency, observability, testing, dan operational runbook

---

## 1. Tujuan Bagian Ini

Di bagian-bagian sebelumnya, kita sudah membongkar banyak detail fundamental:

- path bukan sekadar string;
- `exists` bukan lock;
- create harus atomic;
- write tidak otomatis durable;
- rename/move bisa atomic tetapi tidak selalu;
- traversal harus aman terhadap symlink dan race;
- watcher hanya hint;
- lock punya batas besar;
- file workflow harus didesain terhadap crash, retry, dan partial failure;
- network filesystem dan container runtime bisa mengubah asumsi lokal.

Bagian ini menggabungkan semua itu ke satu desain utuh: **file intake engine**.

File intake engine adalah komponen yang menerima file dari producer, memvalidasi, menyimpan, memproses, menandai status, menangani retry, mengkarantina failure, dan bisa pulih setelah crash tanpa kehilangan integritas data.

Contoh dunia nyata:

- sistem menerima file CSV dari partner;
- sistem menerima ZIP dokumen dari UI upload;
- sistem menerima batch report dari agency lain melalui shared folder;
- sistem menerima export dari mainframe;
- sistem memproses image/PDF dari object scanner;
- sistem menerima file staging dari integration connector;
- sistem memindahkan file antar zona security;
- sistem import dokumen ke case-management system;
- sistem regulator menerima submission besar dengan attachment dan manifest.

Kita tidak akan membangun sekadar kode toy seperti:

```java
Files.copy(input, target);
process(target);
```

Itu bukan production-grade.

Kita akan membangun desain yang menjawab pertanyaan sulit:

- Bagaimana tahu file sudah selesai ditulis producer?
- Bagaimana mencegah processor membaca file setengah jadi?
- Bagaimana memastikan file tidak diproses dua kali?
- Bagaimana memulihkan state setelah aplikasi crash?
- Bagaimana membedakan retryable failure dan poison file?
- Bagaimana menangani partial write, partial move, duplicate upload, dan rename race?
- Bagaimana mengamankan path dari traversal dan symlink attack?
- Bagaimana mengukur throughput, backlog, latency, dan failure?
- Bagaimana menjalankan di Linux, Windows, container, network filesystem, dan Kubernetes?

---

## 2. Mental Model Besar: File Intake Bukan “Read File”, Tetapi Protocol

Kesalahan desain paling umum adalah menganggap file intake sebagai operasi:

```text
file muncul -> baca -> selesai
```

Di production, file intake lebih tepat dimodelkan sebagai **protocol berbasis filesystem**.

Producer dan consumer berkomunikasi melalui beberapa sinyal:

- nama file;
- directory tempat file berada;
- metadata file;
- manifest;
- marker file;
- rename atomic;
- lock/claim;
- status sidecar;
- checksum;
- timestamp;
- retry count;
- quarantine marker.

Filesystem tidak otomatis memberi transaksi multi-step. Karena itu kita membuat **mini-protocol**.

Model yang lebih benar:

```text
Producer
  -> writes bytes into staging area
  -> optionally writes manifest/checksum
  -> atomically publishes file/manifest

Consumer
  -> discovers candidate files
  -> validates candidate safely
  -> atomically claims work
  -> records processing metadata
  -> processes idempotently
  -> writes result/status atomically
  -> moves file to done/error/quarantine
  -> reconciles incomplete states after restart
```

Top 1% engineer tidak hanya bertanya:

> “Bagaimana baca file?”

Mereka bertanya:

> “Apa protocol state transition-nya, apa invariant-nya, dan apa yang terjadi kalau proses mati di setiap titik?”

---

## 3. Requirements Capstone

Kita akan desain engine bernama:

```text
FileIntakeEngine
```

Engine ini menerima file ke root directory tertentu.

### 3.1 Functional Requirements

Engine harus bisa:

1. menerima file dari producer;
2. memvalidasi nama dan path;
3. memvalidasi ukuran file;
4. menghitung checksum/hash;
5. membaca metadata/manifest;
6. mem-publish file secara atomic;
7. mengklaim file untuk diproses;
8. mencegah dua worker memproses file sama;
9. menjalankan processor idempotent;
10. menyimpan hasil sukses;
11. menyimpan hasil gagal;
12. melakukan retry untuk failure sementara;
13. memindahkan poison file ke quarantine;
14. recovery setelah crash;
15. expose log, metric, dan audit trail;
16. menyediakan runbook troubleshooting.

### 3.2 Non-Functional Requirements

Engine harus:

- aman terhadap path traversal;
- aman terhadap symlink attack sejauh mungkin;
- tidak membaca file half-written;
- tidak bergantung pada event watcher sebagai truth;
- tidak menganggap `Files.exists` sebagai lock;
- tidak menganggap `FileStore.getUsableSpace()` sebagai guarantee;
- tidak menganggap `APPEND` selalu atomic di semua filesystem;
- tidak menganggap network filesystem sama dengan local filesystem;
- tahan restart/crash;
- idempotent;
- observable;
- testable;
- portable Java 8–25.

---

## 4. Non-Goals

Agar desain tetap tajam, engine ini **bukan**:

- pengganti database;
- distributed transaction manager;
- object storage abstraction penuh;
- antivirus engine;
- content extraction framework;
- generic ETL platform;
- message broker;
- CDC pipeline;
- backup system.

Kalau kebutuhan sudah mengarah ke exactly-once distributed workflow, multi-consumer ordering, massive fan-out, atau cross-region durability, file-based protocol mungkin bukan lagi pilihan terbaik.

---

## 5. Directory Layout

Kita mulai dari directory contract.

```text
/intake-root/
  inbound/
    staging/
    ready/
  processing/
  done/
  error/
  quarantine/
  metadata/
  tmp/
  locks/
  audit/
```

Makna:

| Directory | Makna |
|---|---|
| `inbound/staging` | Area producer menulis file yang belum siap diproses |
| `inbound/ready` | Area file yang sudah dipublish dan siap diclaim |
| `processing` | Area file yang sedang diklaim/diproses worker |
| `done` | File sukses diproses |
| `error` | File gagal tetapi masih bisa dianalisis/retry/manual fix |
| `quarantine` | File berbahaya/invalid/poison dan tidak boleh diproses otomatis |
| `metadata` | Status sidecar, manifest internal, retry state, audit metadata |
| `tmp` | Temp file internal engine |
| `locks` | Lock/lease files jika diperlukan |
| `audit` | Append-only audit/event log opsional |

Kenapa directory state berguna?

Karena directory adalah state marker yang dapat diinspeksi manusia dan tool operasional.

Tetapi directory state saja tidak cukup. Untuk workflow kompleks, kita butuh metadata sidecar atau database.

---

## 6. File Naming Contract

Jangan percaya original filename sebagai identity.

Gunakan internal file id.

Contoh:

```text
submission-20260618-153012-01JY3A6Y9DQYTPV4A2B8R9K7F3.data
submission-20260618-153012-01JY3A6Y9DQYTPV4A2B8R9K7F3.meta.json
```

Atau lebih sederhana:

```text
01JY3A6Y9DQYTPV4A2B8R9K7F3.data
01JY3A6Y9DQYTPV4A2B8R9K7F3.meta.json
```

Original filename disimpan di metadata:

```json
{
  "fileId": "01JY3A6Y9DQYTPV4A2B8R9K7F3",
  "originalFilename": "agency-report-june.csv",
  "receivedAt": "2026-06-18T08:30:12Z",
  "declaredContentType": "text/csv",
  "sizeBytes": 123456,
  "sha256": "..."
}
```

Kenapa?

Karena original filename bisa:

- mengandung `../`;
- mengandung backslash;
- mengandung Unicode membingungkan;
- memakai reserved name Windows;
- terlalu panjang;
- bentrok dengan file lain;
- case-insensitive collision;
- mengandung extension palsu;
- berisi karakter kontrol;
- disalahgunakan untuk command-line interpretation jika dipakai sembarangan.

Invariant:

```text
Internal storage identity tidak boleh bergantung pada original filename.
```

---

## 7. Core State Machine

File intake engine harus punya state machine eksplisit.

```text
RECEIVING
  -> STAGED
  -> READY
  -> CLAIMED
  -> VALIDATING
  -> PROCESSING
  -> SUCCEEDED

Failure paths:
  RECEIVING   -> ABANDONED
  STAGED      -> INVALID | ABANDONED
  READY       -> CLAIMED | EXPIRED
  CLAIMED     -> PROCESSING | RETRY_WAIT | QUARANTINED
  PROCESSING  -> SUCCEEDED | RETRY_WAIT | FAILED | QUARANTINED
  RETRY_WAIT  -> READY | QUARANTINED
  FAILED      -> MANUAL_REVIEW | READY
```

Lebih konkret dengan directory mapping:

```text
RECEIVING   = inbound/staging/<id>.part
READY       = inbound/ready/<id>.data
CLAIMED     = processing/<id>.data
SUCCEEDED   = done/<date>/<id>.data
FAILED      = error/<date>/<id>.data
QUARANTINED = quarantine/<reason>/<id>.data
```

Metadata sidecar:

```text
metadata/<id>.json
```

State transition harus dilakukan dengan operasi yang sebisa mungkin atomic:

```text
staging -> ready       : atomic move
ready -> processing    : atomic move/claim
processing -> done     : atomic move
processing -> error    : atomic move
processing -> quarantine: atomic move
```

---

## 8. Invariants

Invariant adalah aturan yang harus selalu benar, bahkan setelah crash dan retry.

### 8.1 Identity Invariant

```text
Setiap intake item punya fileId stabil yang tidak berubah antar state.
```

### 8.2 Single Ownership Invariant

```text
Pada satu waktu, satu fileId hanya boleh dimiliki satu worker.
```

Implementasi paling sederhana: claim dengan atomic move dari `ready` ke `processing`.

### 8.3 Publish Invariant

```text
File di ready tidak boleh half-written.
```

Cara: producer menulis ke staging/temp, force/close, lalu atomic move ke ready.

### 8.4 Metadata Consistency Invariant

```text
Metadata harus bisa direkonsiliasi dari filesystem state setelah crash.
```

Artinya metadata boleh tertinggal, tetapi tidak boleh menjadi satu-satunya truth tanpa recovery rule.

### 8.5 Idempotency Invariant

```text
Reprocessing file yang sama tidak boleh menciptakan efek bisnis ganda.
```

Ini biasanya membutuhkan idempotency key di database/domain layer.

### 8.6 Quarantine Invariant

```text
File yang dikarantina tidak boleh otomatis kembali ke ready tanpa explicit operator action.
```

### 8.7 Audit Invariant

```text
Setiap transition penting harus memiliki trace log/audit event.
```

---

## 9. Producer Protocol

Producer tidak boleh langsung menulis ke `ready`.

Buruk:

```text
producer writes directly to inbound/ready/report.csv
consumer sees report.csv before writer finishes
consumer reads partial file
```

Baik:

```text
producer writes inbound/staging/<id>.part
producer closes file
producer writes/validates metadata
producer atomically moves <id>.part -> inbound/ready/<id>.data
```

Pseudo-flow:

```text
1. allocate fileId
2. open staging/<fileId>.part with CREATE_NEW
3. write content
4. flush/close
5. compute hash or receive precomputed hash
6. write metadata temp
7. atomic move metadata temp -> metadata/<fileId>.json
8. atomic move staging/<fileId>.part -> ready/<fileId>.data
```

Important:

- create with `CREATE_NEW`, not `CREATE`;
- temp file in same filesystem as final target;
- move with `ATOMIC_MOVE` if supported;
- fallback behavior must be explicit;
- never publish metadata saying file ready before file is actually visible in ready.

---

## 10. Consumer Discovery Protocol

Consumer must not rely solely on watcher.

Recommended:

```text
Periodic reconciliation scan + optional WatchService hint
```

Flow:

```text
1. scan inbound/ready
2. for each file candidate:
   a. validate filename pattern
   b. validate it is regular file without following symlink unless policy allows
   c. claim via atomic move ready -> processing
   d. process claimed file
```

Why scanner first?

Because watcher can lose events, coalesce events, overflow, or behave differently across platform/provider.

Watcher is optimization:

```text
watch event -> wake scanner sooner
```

It is not truth:

```text
watch event -> process exact file as gospel
```

---

## 11. Claiming Work

The simplest robust claim pattern is **rename-claim**.

```text
inbound/ready/<id>.data
  --atomic move-->
processing/<id>.<workerId>.data
```

If two workers try to claim the same file:

- one move succeeds;
- the other gets `NoSuchFileException` or equivalent because source disappeared.

This is better than:

```text
if exists(file) {
  process(file);
}
```

Because `exists` does not reserve anything.

### 11.1 Claim File Name

Use worker id in processing path:

```text
processing/<fileId>.<workerId>.<claimTimestamp>.data
```

Example:

```text
processing/01JY3A6Y9DQYTPV4A2B8R9K7F3.worker-03.20260618T083012Z.data
```

This helps recovery and debugging.

### 11.2 Claim Metadata

Update metadata state after move:

```json
{
  "fileId": "01JY3A6Y9DQYTPV4A2B8R9K7F3",
  "state": "CLAIMED",
  "workerId": "worker-03",
  "claimedAt": "2026-06-18T08:30:12Z",
  "attempt": 2
}
```

But metadata update is not atomic with file move. Therefore recovery must tolerate mismatch.

Example crash point:

```text
ready -> processing move succeeded
process crashed before metadata update
```

Recovery should infer:

```text
file in processing + no recent heartbeat = stale claim
```

---

## 12. Validation Pipeline

Validation should happen after claim for exclusive ownership, unless there is a cheap pre-check during scan.

Suggested validation order:

```text
1. path/name validation
2. file type validation
3. symlink/link validation
4. size validation
5. metadata/manifest validation
6. hash/checksum validation
7. content-type/magic validation
8. domain schema validation
9. business rule validation
```

### 12.1 Path Validation

Even internal directories can be polluted accidentally or maliciously.

Validate:

- filename pattern;
- no separator;
- expected suffix;
- expected ID format;
- resolved path remains under root;
- file is regular file;
- symlink policy is explicit.

Example:

```java
static boolean isSafeInternalName(String name) {
    return name.matches("[A-Z0-9]{26}\\.data");
}
```

For real system, prefer strict allowlist instead of blacklist.

### 12.2 Size Validation

Validate both:

- max file size;
- min expected file size;
- decompressed size if archive;
- per-entry size if archive;
- total entry count.

### 12.3 Hash Validation

Hash helps:

- detect corruption;
- deduplicate;
- verify transfer completeness;
- support idempotency.

But hash alone does not prove authenticity unless signed or HMAC-protected.

### 12.4 Content Validation

Extension and MIME are hints.

Validate content structure:

- CSV parse;
- JSON parse;
- XML parse with secure parser config;
- ZIP entries safe;
- PDF/image magic number if relevant;
- charset decode strict mode.

---

## 13. Metadata Design

Metadata should represent lifecycle and processing attempts.

Example:

```json
{
  "fileId": "01JY3A6Y9DQYTPV4A2B8R9K7F3",
  "version": 1,
  "originalFilename": "agency-report-june.csv",
  "storageName": "01JY3A6Y9DQYTPV4A2B8R9K7F3.data",
  "state": "PROCESSING",
  "receivedAt": "2026-06-18T08:29:59Z",
  "publishedAt": "2026-06-18T08:30:01Z",
  "claimedAt": "2026-06-18T08:30:12Z",
  "workerId": "worker-03",
  "attempt": 2,
  "sizeBytes": 123456,
  "sha256": "...",
  "declaredContentType": "text/csv",
  "detectedContentType": "text/csv",
  "lastError": null,
  "history": [
    {
      "at": "2026-06-18T08:30:01Z",
      "event": "PUBLISHED"
    },
    {
      "at": "2026-06-18T08:30:12Z",
      "event": "CLAIMED",
      "workerId": "worker-03"
    }
  ]
}
```

### 13.1 Metadata Storage Options

| Option | Strength | Weakness |
|---|---|---|
| Sidecar JSON | Easy to inspect, portable | Not transactional with file move |
| SQLite/local DB | Better query/recovery | Operational dependency |
| Central DB | Strong lifecycle coordination | More moving parts |
| Append-only audit + derived state | Good recovery/history | More complex |

For capstone, we use sidecar JSON + optional audit log. In enterprise systems, central DB is often better if business state matters.

---

## 14. Atomic Metadata Update

Metadata update should also follow safe-write pattern:

```text
write metadata tmp
force content
atomic move tmp -> metadata/<id>.json
```

Pseudo-code:

```java
static void writeJsonAtomically(Path target, byte[] json) throws IOException {
    Path dir = target.getParent();
    Path tmp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");

    try (FileChannel ch = FileChannel.open(
            tmp,
            StandardOpenOption.WRITE,
            StandardOpenOption.TRUNCATE_EXISTING)) {
        ch.write(ByteBuffer.wrap(json));
        ch.force(true);
    }

    Files.move(tmp, target,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
}
```

Caveat:

- `ATOMIC_MOVE` can fail if unsupported;
- directory fsync is not directly portable through high-level Java API;
- network filesystem durability semantics vary;
- metadata update and file move are still two operations.

Therefore recovery logic remains mandatory.

---

## 15. Processing Contract

Processing should be separated into phases:

```text
CLAIMED
  -> VALIDATING
  -> PROCESSING
  -> COMMITTING_RESULT
  -> SUCCEEDED
```

The dangerous part is side effect.

Example side effects:

- insert DB rows;
- send message;
- call external API;
- create documents;
- update case status;
- charge account;
- notify users.

File engine can prevent duplicate file processing attempts, but cannot by itself guarantee exactly-once business side effects.

Therefore the domain processor must support idempotency.

### 15.1 Idempotency Key

Use stable key:

```text
fileId
```

or if producer may resend same content under different fileId:

```text
sourceSystem + businessReference + contentHash
```

Domain table example:

```sql
CREATE TABLE file_import_execution (
  idempotency_key VARCHAR(200) PRIMARY KEY,
  file_id VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

Processing starts by inserting idempotency key. If key exists, engine decides whether to skip, resume, or compare state.

---

## 16. Failure Classification

Not all failures are equal.

Classify explicitly.

| Failure Type | Example | Action |
|---|---|---|
| Transient I/O | temporary permission, network filesystem hiccup | retry |
| Capacity | disk full, inode exhausted | pause intake, alert |
| Validation | invalid schema, bad checksum | quarantine/error |
| Security | traversal, symlink, forbidden type | quarantine, alert |
| Poison data | always crashes parser | quarantine after max attempts |
| Domain conflict | duplicate business key | domain-specific handling |
| External dependency | DB/API down | retry with backoff |
| Bug | NullPointerException, invariant violation | stop or quarantine with high severity |

Do not blindly retry all exceptions.

A poison file retried forever becomes denial of service.

---

## 17. Retry Design

Retry state belongs in metadata.

Example:

```json
{
  "attempt": 3,
  "maxAttempts": 5,
  "nextAttemptAfter": "2026-06-18T08:45:00Z",
  "lastErrorCode": "DB_TIMEOUT"
}
```

Retry flow:

```text
processing failure classified retryable
  -> move processing file to error/retry-wait or metadata retry state
  -> scheduler later moves it back to ready
```

Better directory layout for retry:

```text
error/retry-wait/<id>.data
error/permanent/<id>.data
quarantine/security/<id>.data
```

Retry rules:

- exponential backoff;
- jitter;
- max attempts;
- operator override;
- record full failure reason;
- never retry security quarantine automatically.

---

## 18. Recovery After Crash

Recovery is the heart of the engine.

At startup, engine should reconcile filesystem and metadata.

### 18.1 Recovery Scan

Inspect directories:

```text
inbound/staging
inbound/ready
processing
error/retry-wait
metadata
```

Build table:

```text
fileId -> observed locations + metadata state + timestamps
```

Then apply rules.

### 18.2 Recovery Rules

| Observed State | Likely Meaning | Action |
|---|---|---|
| `staging/*.part` old | producer crashed or abandoned | expire/abandon/quarantine |
| `ready/*.data` no metadata | incomplete publish or manual copy | quarantine or infer metadata carefully |
| `ready/*.data` valid metadata | ready for claim | process |
| `processing/*.data` recent heartbeat | active worker | leave |
| `processing/*.data` stale heartbeat | worker crashed | requeue or quarantine depending attempt |
| `done/*.data` metadata says processing | crash after success move before metadata update | update metadata to succeeded |
| metadata says done but file in processing | partial failure | reconcile by file presence and audit |
| duplicate fileId in two dirs | invariant violation | stop/quarantine, operator action |

### 18.3 Heartbeat

Processing worker should update heartbeat:

```json
{
  "state": "PROCESSING",
  "workerId": "worker-03",
  "heartbeatAt": "2026-06-18T08:35:00Z"
}
```

Stale threshold:

```text
now - heartbeatAt > processingLeaseTimeout
```

Do not use system clock casually in distributed environments. In single-node filesystem workflow, it is usually acceptable with conservative timeout. In multi-node environment, prefer central lease store.

---

## 19. Concurrency Model

### 19.1 Single Node, Multi-Thread

Use:

- bounded worker pool;
- claim via atomic move;
- in-memory queue of discovered candidates;
- no reliance on `FileLock` for thread coordination.

### 19.2 Multi-Node, Shared Filesystem

Use with caution.

Possible:

- claim via atomic rename on same shared filesystem;
- heartbeat metadata;
- central DB lease strongly recommended;
- avoid relying solely on Java `FileLock` across network filesystem unless tested on exact environment.

### 19.3 Multi-Node, Object Storage

Do not pretend object storage is local filesystem.

Use object-store-native primitives:

- conditional put;
- object metadata;
- queue notification;
- database state;
- versioning;
- object tags;
- idempotency key.

Java `Path` abstraction may hide too much here.

---

## 20. Backpressure and Capacity Control

Engine must protect itself.

Guardrails:

- max ready backlog;
- max processing concurrency;
- max file size;
- max total bytes in intake root;
- min usable disk space;
- max retry queue size;
- max quarantine growth;
- max per-producer rate;
- max archive decompressed size;
- max files per batch.

Example policy:

```text
If usable disk < 10 GB or < 15%, pause new intake claim.
If ready backlog > 10000 files, slow producer or alert.
If retry queue > 1000, stop automatic retry and page operator.
```

Important: `FileStore.getUsableSpace()` is a hint, not reservation.

So capacity check is not a guarantee.

You still must handle `IOException` during write/move.

---

## 21. Observability Model

### 21.1 Logs

Every transition log should include:

- `fileId`;
- `workerId`;
- `stateFrom`;
- `stateTo`;
- `pathRole`, not full unsafe path if sensitive;
- file size;
- hash prefix;
- attempt;
- duration;
- exception class;
- error code;
- correlation id.

Example:

```json
{
  "event": "file_intake_transition",
  "fileId": "01JY3A6Y9DQYTPV4A2B8R9K7F3",
  "from": "READY",
  "to": "PROCESSING",
  "workerId": "worker-03",
  "attempt": 1,
  "durationMs": 12
}
```

### 21.2 Metrics

Counters:

- files received;
- files claimed;
- files succeeded;
- files failed;
- files quarantined;
- retry count;
- validation failure count;
- checksum mismatch count;
- claim conflict count.

Gauges:

- ready backlog;
- processing count;
- retry backlog;
- quarantine count;
- bytes in intake root;
- usable disk space;
- oldest ready age;
- oldest processing heartbeat age.

Histograms:

- claim latency;
- validation duration;
- processing duration;
- total intake-to-success latency;
- file size distribution.

### 21.3 Audit Events

For regulatory/enterprise workflow, audit log should capture:

```text
RECEIVED
PUBLISHED
CLAIMED
VALIDATED
PROCESS_STARTED
PROCESS_SUCCEEDED
PROCESS_FAILED
RETRY_SCHEDULED
QUARANTINED
MANUAL_RELEASED
DELETED_BY_RETENTION
```

Audit log should be append-only or stored in database with immutable semantics.

---

## 22. Security Design

### 22.1 Path Boundary

Never allow user-controlled path to decide storage location directly.

Bad:

```java
Path target = uploadRoot.resolve(userFilename);
```

Better:

```java
String fileId = generateId();
Path target = uploadRoot.resolve(fileId + ".data");
```

Original filename goes to metadata after sanitization.

### 22.2 Symlink Safety

For directories writable by untrusted users:

- do not follow symlinks;
- validate path containment;
- open/create with secure options where possible;
- prefer engine-owned directory not writable by attacker;
- separate upload temp from executable/static-served paths.

### 22.3 Archive Safety

When extracting archives:

- validate entry names;
- reject absolute paths;
- reject `..` escape;
- enforce output root containment;
- limit entry count;
- limit compressed and decompressed size;
- reject symlink entries unless policy explicitly supports;
- never extract into application executable directory.

### 22.4 Malware/Content Scanning

If business risk requires, integrate scanner as validation step.

But scanner result must be part of state machine:

```text
SCANNING -> CLEAN -> PROCESSING
SCANNING -> INFECTED -> QUARANTINED
SCANNING -> SCANNER_UNAVAILABLE -> RETRY_WAIT
```

---

## 23. Java 8–25 Compatibility Notes

### 23.1 Use `Paths.get` for Java 8-Compatible Code

Java 11+ can use:

```java
Path p = Path.of("/data/intake");
```

Java 8 needs:

```java
Path p = Paths.get("/data/intake");
```

For library code targeting Java 8, use `Paths.get`.

### 23.2 `Files.writeString` and `Files.readString`

These are not Java 8 APIs.

Java 8-compatible metadata write:

```java
Files.write(path, bytes, StandardOpenOption.CREATE_NEW);
```

or use `BufferedWriter`.

### 23.3 CRC32C

`CRC32C` is Java 9+.

For Java 8, use `CRC32` or third-party implementation if CRC32C specifically required.

### 23.4 Newer FileChannel APIs

Java 25 includes newer APIs beyond Java 8. Keep capstone base implementation on classic `FileChannel`, `Files`, `Path`, `FileVisitor`, `WatchService`, and `MessageDigest` for Java 8 compatibility.

---

## 24. Reference Implementation Skeleton

This is not a full framework, but a production-oriented skeleton.

### 24.1 Configuration

```java
public final class IntakeConfig {
    public final Path root;
    public final long maxFileSizeBytes;
    public final long minUsableSpaceBytes;
    public final int maxAttempts;
    public final Duration staleProcessingTimeout;
    public final int workerCount;

    public IntakeConfig(
            Path root,
            long maxFileSizeBytes,
            long minUsableSpaceBytes,
            int maxAttempts,
            Duration staleProcessingTimeout,
            int workerCount) {
        this.root = root;
        this.maxFileSizeBytes = maxFileSizeBytes;
        this.minUsableSpaceBytes = minUsableSpaceBytes;
        this.maxAttempts = maxAttempts;
        this.staleProcessingTimeout = staleProcessingTimeout;
        this.workerCount = workerCount;
    }
}
```

### 24.2 Directory Resolver

```java
public final class IntakeDirs {
    public final Path root;
    public final Path staging;
    public final Path ready;
    public final Path processing;
    public final Path done;
    public final Path error;
    public final Path quarantine;
    public final Path metadata;
    public final Path tmp;

    public IntakeDirs(Path root) {
        this.root = root;
        this.staging = root.resolve("inbound").resolve("staging");
        this.ready = root.resolve("inbound").resolve("ready");
        this.processing = root.resolve("processing");
        this.done = root.resolve("done");
        this.error = root.resolve("error");
        this.quarantine = root.resolve("quarantine");
        this.metadata = root.resolve("metadata");
        this.tmp = root.resolve("tmp");
    }

    public void ensureCreated() throws IOException {
        Files.createDirectories(staging);
        Files.createDirectories(ready);
        Files.createDirectories(processing);
        Files.createDirectories(done);
        Files.createDirectories(error);
        Files.createDirectories(quarantine);
        Files.createDirectories(metadata);
        Files.createDirectories(tmp);
    }
}
```

### 24.3 Atomic Move Helper

```java
public final class AtomicFiles {
    private AtomicFiles() {}

    public static void moveAtomic(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            throw new IOException("Atomic move not supported from " + source + " to " + target, e);
        }
    }

    public static void moveAtomicReplace(Path source, Path target) throws IOException {
        try {
            Files.move(source, target,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            throw new IOException("Atomic replace not supported from " + source + " to " + target, e);
        }
    }
}
```

Whether to fallback to non-atomic move is a business decision. For strict intake, failing fast is often better than silently weakening correctness.

### 24.4 Claim Function

```java
public final class FileClaimer {
    private final IntakeDirs dirs;
    private final String workerId;

    public FileClaimer(IntakeDirs dirs, String workerId) {
        this.dirs = dirs;
        this.workerId = workerId;
    }

    public Optional<ClaimedFile> tryClaim(Path readyFile) throws IOException {
        String fileName = readyFile.getFileName().toString();

        if (!fileName.matches("[A-Z0-9]{26}\\.data")) {
            return Optional.empty();
        }

        String id = fileName.substring(0, fileName.length() - ".data".length());
        String processingName = id + "." + workerId + ".data";
        Path target = dirs.processing.resolve(processingName);

        try {
            AtomicFiles.moveAtomic(readyFile, target);
            return Optional.of(new ClaimedFile(id, target));
        } catch (NoSuchFileException e) {
            return Optional.empty();
        } catch (FileAlreadyExistsException e) {
            return Optional.empty();
        }
    }
}
```

### 24.5 Claimed File

```java
public final class ClaimedFile {
    public final String fileId;
    public final Path path;

    public ClaimedFile(String fileId, Path path) {
        this.fileId = fileId;
        this.path = path;
    }
}
```

### 24.6 Hashing Large Files

```java
public static String sha256Hex(Path file) throws IOException {
    try {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[1024 * 1024];

        try (InputStream in = new BufferedInputStream(Files.newInputStream(file))) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }

        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException("SHA-256 not available", e);
    }
}
```

### 24.7 Processor Interface

```java
public interface IntakeProcessor {
    ProcessingResult process(ClaimedFile file) throws Exception;
}
```

```java
public final class ProcessingResult {
    public enum Type {
        SUCCESS,
        RETRYABLE_FAILURE,
        PERMANENT_FAILURE,
        SECURITY_QUARANTINE
    }

    public final Type type;
    public final String code;
    public final String message;

    private ProcessingResult(Type type, String code, String message) {
        this.type = type;
        this.code = code;
        this.message = message;
    }

    public static ProcessingResult success() {
        return new ProcessingResult(Type.SUCCESS, "OK", "Success");
    }

    public static ProcessingResult retryable(String code, String message) {
        return new ProcessingResult(Type.RETRYABLE_FAILURE, code, message);
    }

    public static ProcessingResult permanent(String code, String message) {
        return new ProcessingResult(Type.PERMANENT_FAILURE, code, message);
    }

    public static ProcessingResult quarantine(String code, String message) {
        return new ProcessingResult(Type.SECURITY_QUARANTINE, code, message);
    }
}
```

### 24.8 Process Claimed File

```java
public final class IntakeWorker {
    private final IntakeDirs dirs;
    private final IntakeProcessor processor;

    public IntakeWorker(IntakeDirs dirs, IntakeProcessor processor) {
        this.dirs = dirs;
        this.processor = processor;
    }

    public void handle(ClaimedFile file) throws IOException {
        ProcessingResult result;
        try {
            validateClaimedFile(file.path);
            result = processor.process(file);
        } catch (SecurityException e) {
            result = ProcessingResult.quarantine("SECURITY", e.getMessage());
        } catch (Exception e) {
            result = ProcessingResult.retryable(e.getClass().getSimpleName(), e.getMessage());
        }

        moveByResult(file, result);
    }

    private void validateClaimedFile(Path path) throws IOException {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            throw new SecurityException("Claimed path is not a regular file");
        }
    }

    private void moveByResult(ClaimedFile file, ProcessingResult result) throws IOException {
        String fileName = file.fileId + ".data";
        Path target;

        switch (result.type) {
            case SUCCESS:
                target = dirs.done.resolve(fileName);
                break;
            case RETRYABLE_FAILURE:
                target = dirs.error.resolve("retry-wait").resolve(fileName);
                Files.createDirectories(target.getParent());
                break;
            case PERMANENT_FAILURE:
                target = dirs.error.resolve("permanent").resolve(fileName);
                Files.createDirectories(target.getParent());
                break;
            case SECURITY_QUARANTINE:
                target = dirs.quarantine.resolve(fileName);
                break;
            default:
                throw new IllegalStateException("Unknown result: " + result.type);
        }

        AtomicFiles.moveAtomic(file.path, target);
    }
}
```

This skeleton omits metadata writes for brevity, but production implementation should record transition before/after with recovery-aware rules.

---

## 25. Recovery Algorithm Detail

Pseudo-code:

```text
onStartup:
  ensure directories exist
  scan metadata
  scan ready
  scan processing
  scan done/error/quarantine

  detect duplicate fileId across states
  if duplicate:
    quarantine or stop startup

  for each staging file older than receivingTimeout:
    mark abandoned or quarantine

  for each processing file:
    load metadata
    if no heartbeat or heartbeat stale:
      if attempts < maxAttempts:
        move processing -> ready
        increment attempt
      else:
        move processing -> quarantine

  for each retry-wait file whose nextAttemptAfter <= now:
    move retry-wait -> ready

  for each ready file with invalid metadata:
    quarantine

  start scanner/worker loop
```

A robust engine does not assume previous run ended cleanly.

---

## 26. Failure Matrix

### 26.1 Producer Crash

| Crash Point | Result | Recovery |
|---|---|---|
| before staging create | nothing | no action |
| after staging create before write complete | stale `.part` | abandon/quarantine after timeout |
| after write before metadata | staged data no metadata | quarantine/manual inspect |
| after metadata before ready move | metadata exists, file still staging | complete publish or abandon depending policy |
| after ready move | ready data exists | process |

### 26.2 Consumer Crash

| Crash Point | Result | Recovery |
|---|---|---|
| before claim | file still ready | claim later |
| after claim before metadata | file in processing, metadata old | stale claim recovery |
| after validation before side effect | file in processing | retry safe |
| during side effect | uncertain business state | idempotency key required |
| after side effect before done move | file in processing but business done | idempotency prevents duplicate |
| after done move before metadata | file in done, metadata stale | reconcile to success |

### 26.3 Disk Full

| Point | Symptom | Action |
|---|---|---|
| staging write | IOException | reject/pause producer |
| metadata write | IOException | retry metadata, alert |
| move | IOException | check capacity/permissions/state |
| audit append | IOException | policy: fail closed or degrade? |

---

## 27. When to Use Database State

Filesystem-only state is viable when:

- single node;
- simple batch processing;
- low concurrency;
- human-inspectable files are important;
- business effect is idempotent elsewhere.

Use database state when:

- multi-node workers;
- strong leasing required;
- complex query/reporting needed;
- regulatory audit required;
- retry scheduling complex;
- file status must be visible in UI;
- domain transaction must coordinate with processing state.

Hybrid pattern:

```text
File bytes on filesystem/object storage
State machine in database
Audit in database/event stream
File path/hash stored as metadata
```

This is usually more robust for enterprise case management systems.

---

## 28. Operational Runbook

### 28.1 Backlog Growing

Check:

- worker running?
- ready count?
- oldest ready age?
- error/retry count?
- disk capacity?
- permission change?
- external dependency down?
- poison file blocking single-thread processor?

Action:

- scale workers if safe;
- pause producer if disk/backlog high;
- inspect top failure codes;
- quarantine poison file;
- validate CPU/I/O saturation.

### 28.2 Files Stuck in Processing

Check:

- heartbeat age;
- worker id exists?
- process alive?
- logs for fileId;
- idempotency table state;
- metadata attempt count.

Action:

- requeue if stale and idempotent;
- quarantine if repeated crash;
- manual mark done if business committed and file move failed.

### 28.3 Quarantine Spike

Check:

- new producer version?
- schema change?
- malicious upload?
- filename/path issue?
- checksum mismatch?
- decompression limits?

Action:

- stop affected producer;
- inspect sample files safely;
- compare manifest version;
- update validation policy only after risk review.

### 28.4 Disk Nearly Full

Check:

- done retention;
- retry backlog;
- quarantine growth;
- temporary files;
- large archive extraction;
- log/audit growth;
- inode usage.

Action:

- pause intake;
- cleanup tmp older than safe threshold;
- archive done files;
- expand storage;
- add backpressure.

---

## 29. Design Variants

### 29.1 Marker File Protocol

Producer writes:

```text
file.data
file.done
```

Consumer processes only files with `.done` marker.

Pros:

- simple;
- works when atomic rename unavailable.

Cons:

- two-file consistency issue;
- marker can appear before file durable if producer wrong;
- cleanup/recovery more complex.

### 29.2 Manifest-First Protocol

Producer writes data files, then manifest listing all files.

Consumer processes manifest as atomic batch descriptor.

Good for multi-file submission.

### 29.3 Directory Publish Protocol

Producer writes entire batch directory in staging:

```text
staging/batch-123/
  manifest.json
  a.csv
  b.pdf
```

Then renames directory:

```text
staging/batch-123 -> ready/batch-123
```

Good when batch is directory-shaped.

Need beware cross-filesystem move and directory rename semantics.

### 29.4 Database-Claim Protocol

Consumer inserts/updates DB row to claim file.

Pros:

- strong coordination;
- observable;
- easier multi-node.

Cons:

- DB can disagree with filesystem if not reconciled.

---

## 30. Common Anti-Patterns

### Anti-Pattern 1: Direct Write to Ready

```text
producer writes to ready/report.csv
```

Problem: consumer can read partial file.

### Anti-Pattern 2: Exists Then Process

```java
if (Files.exists(path)) {
    process(path);
}
```

Problem: no ownership, race condition.

### Anti-Pattern 3: Original Filename as Storage Key

```text
uploads/john/../../app/config.yml
```

Problem: traversal/collision/injection.

### Anti-Pattern 4: Infinite Retry

Problem: poison file consumes resources forever.

### Anti-Pattern 5: Watcher as Truth

Problem: missed/coalesced/overflow events.

### Anti-Pattern 6: FileLock as Distributed Coordination Without Testing

Problem: lock semantics vary by OS/filesystem/network provider.

### Anti-Pattern 7: No Recovery Scan

Problem: crash leaves processing files forever.

### Anti-Pattern 8: No Idempotency

Problem: duplicate side effects after retry.

### Anti-Pattern 9: No Quarantine

Problem: invalid/security-risk files keep re-entering workflow.

### Anti-Pattern 10: No Retention

Problem: done/error/quarantine grows until disk full.

---

## 31. Production Checklist

### Correctness

- [ ] Producer writes to staging, not ready.
- [ ] Publish uses atomic move where required.
- [ ] Claim uses atomic move or central lease.
- [ ] File ID is stable.
- [ ] Processing is idempotent.
- [ ] Recovery scan runs at startup.
- [ ] Stale processing files handled.
- [ ] Duplicate fileId detection exists.
- [ ] Retry has max attempts.
- [ ] Quarantine is terminal unless operator releases.

### Security

- [ ] Original filename never used as storage path.
- [ ] Path traversal blocked.
- [ ] Symlink policy explicit.
- [ ] Archive extraction safe.
- [ ] File size/decompressed size limited.
- [ ] Content type validated beyond extension.
- [ ] Upload directory not executable/static-served.
- [ ] Permissions least privilege.

### Durability

- [ ] Metadata written atomically.
- [ ] Important file writes force/close before publish when needed.
- [ ] Cross-filesystem move avoided for atomic publish.
- [ ] Network filesystem behavior tested.
- [ ] Crash matrix documented.

### Observability

- [ ] State transitions logged.
- [ ] Metrics for backlog and latency.
- [ ] Failure code taxonomy.
- [ ] Correlation ID/fileId everywhere.
- [ ] Runbook exists.
- [ ] Audit trail for regulatory transitions.

### Operations

- [ ] Retention policy for done/error/quarantine.
- [ ] Disk/inode monitoring.
- [ ] Backpressure threshold.
- [ ] Manual requeue flow.
- [ ] Manual quarantine release flow.
- [ ] Safe cleanup job.
- [ ] Cross-platform/container behavior tested.

---

## 32. What Top 1% Engineers See Here

A less experienced engineer sees:

```text
read file from folder
```

A strong engineer sees:

```text
state machine + protocol + atomic boundaries + failure recovery + observability + security + operational control
```

The real skill is not memorizing `Files.move`.

The real skill is knowing:

- which operation is atomic;
- which operation only gives a hint;
- which operation can race;
- which state can become inconsistent;
- which failure must be retried;
- which failure must be quarantined;
- which side effect must be idempotent;
- which assumption breaks on Windows, NFS, container, or object storage;
- which operational metric tells you the system is silently dying.

---

## 33. Minimal End-to-End Flow Summary

```text
1. Producer receives file.
2. Engine generates fileId.
3. Bytes are written to inbound/staging/<fileId>.part.
4. File is closed and optionally forced.
5. Metadata is written atomically.
6. Data file is atomically moved to inbound/ready/<fileId>.data.
7. Scanner finds ready file.
8. Worker atomically moves ready -> processing.
9. Worker validates file, metadata, size, hash, content.
10. Worker processes idempotently.
11. Worker moves file to done/error/quarantine.
12. Metadata/audit transition is recorded.
13. Recovery scan reconciles incomplete state after crash.
14. Retention job cleans old done/error/quarantine according to policy.
```

---

## 34. References

- Java SE 25 `java.nio.file.Files` documentation: `Files` operations generally delegate to the associated filesystem provider, and methods such as `move`, `copy`, `walkFileTree`, `isRegularFile`, `newInputStream`, and metadata helpers define many of the behavioral boundaries used in this capstone.
- Java SE 8 `FileChannel` documentation: `FileChannel` is a seekable channel connected to a file and provides `force(boolean)` for requesting updates be written to the storage device.
- Java `FileLock` documentation: file locks are held on behalf of the entire JVM and are not suitable for coordinating multiple threads inside the same JVM.
- Oracle Java tutorial on walking the file tree: `FileVisitor` provides callbacks for file visit, directory pre/post visit, and failure handling.
- OWASP File Upload Cheat Sheet: uploaded files are risky and validation should include extension/type/filename/content controls, storage location controls, size limits, and defense against traversal-style input.

---

## 35. Ringkasan

File intake engine yang baik bukan sekadar kode untuk membaca folder.

Ia adalah protocol dengan:

- state machine eksplisit;
- atomic handoff;
- safe naming;
- validation berlapis;
- idempotent processing;
- retry dan quarantine;
- crash recovery;
- backpressure;
- observability;
- security boundary;
- operational runbook.

Kalau bagian ini dipahami, banyak problem production yang biasanya dianggap “random file issue” akan terlihat sebagai pelanggaran invariant atau desain state transition yang belum lengkap.

---

## 36. Status Seri

Part ini menyelesaikan:

```text
Part 34 — Capstone: Build a Production-Grade File Intake Engine
```

Seri belum selesai.

Berikutnya:

```text
Part 35 — Final Review: Top 1% Filesystem Engineering Checklist
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 33](./learn-java-io-file-filesystem-storage-engineering-part-33-testing-file-filesystem-code.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 35 — Final Review: Top 1% Filesystem Engineering Checklist](./learn-java-io-file-filesystem-storage-engineering-part-35-final-review-top-1-percent-filesystem-engineering-checklist.md)
