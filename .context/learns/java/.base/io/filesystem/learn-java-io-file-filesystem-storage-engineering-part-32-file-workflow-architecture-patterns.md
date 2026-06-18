# Learn Java IO File Filesystem Storage Engineering — Part 32
# File Workflow Architecture Patterns

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `32`  
> Topik: File Workflow Architecture Patterns  
> Target Java: 8 hingga 25  
> Level: Advanced / production engineering

---

## 0. Tujuan Bagian Ini

Bagian ini membahas sesuatu yang sangat sering muncul di sistem enterprise, integrasi legacy, batch processing, document management, reporting, compliance, audit, dan data exchange:

> bagaimana mendesain workflow berbasis file yang aman, idempotent, observable, recoverable, dan tidak rapuh terhadap race condition.

Di bagian-bagian sebelumnya kita sudah membahas API dan mekanika filesystem secara granular:

- `Path`
- `Files`
- create/copy/move/delete
- atomic move
- symlink
- permission
- capacity
- watch service
- lock
- memory-mapped file
- append-only/WAL
- hash/checksum
- naming/MIME
- archive
- custom provider
- cross-platform behavior
- container/cloud/network filesystem
- performance
- observability

Bagian ini mengikat semuanya menjadi pola arsitektur.

Intinya:

```text
File workflow yang benar bukan sekadar:

  scan folder -> read file -> process -> delete

Melainkan:

  receive -> validate -> stage -> atomically publish -> claim -> process idempotently
  -> commit result -> archive/quarantine -> observe -> recover
```

---

## 1. Mental Model: File Workflow Adalah Distributed Protocol Kecil

Banyak engineer menganggap file workflow sebagai operasi lokal sederhana. Itu berbahaya.

Setiap kali ada lebih dari satu aktor, misalnya:

- producer menulis file
- consumer membaca file
- scheduler menjalankan batch
- watcher menerima event
- operator menghapus/memindahkan file
- pod Kubernetes restart
- shared filesystem dipakai beberapa node
- job lama dan job baru berjalan bersamaan

maka workflow file berubah menjadi **protocol koordinasi**.

Protocol itu harus menjawab:

1. Kapan file dianggap lengkap?
2. Siapa pemilik file saat ini?
3. Bagaimana mencegah dua worker memproses file sama?
4. Bagaimana mengetahui file sudah pernah diproses?
5. Apa yang terjadi jika crash di tengah proses?
6. Bagaimana recovery membedakan file baru, file sedang diproses, file gagal, dan file orphan?
7. Bagaimana operator melihat state tanpa membaca isi file?
8. Bagaimana sistem membatasi pertumbuhan folder?
9. Bagaimana sistem mencegah partial output terlihat sebagai final output?
10. Bagaimana membuktikan apa yang terjadi setelah incident?

Top 1% engineer tidak hanya menulis `Files.walk(...)`. Mereka mendesain **state machine**.

---

## 2. Anti-Pattern Paling Umum

### 2.1 Producer Menulis Langsung ke Folder yang Dipantau

Anti-pattern:

```text
/input/report.csv
```

Producer membuka `report.csv`, menulis pelan-pelan, lalu consumer melihat file itu dan langsung membaca.

Masalah:

- consumer bisa membaca file yang belum selesai ditulis
- ukuran file berubah saat dibaca
- hash berubah saat diproses
- parser gagal karena file masih partial
- retry bisa memproses versi berbeda
- WatchService bisa memberi event sebelum producer close

Solusi:

```text
/staging/report.csv.tmp
/input/report.csv
```

Producer menulis ke staging/temp file, lalu melakukan atomic move/rename ke folder input hanya saat file sudah lengkap.

---

### 2.2 Check-Then-Act

Anti-pattern:

```java
if (Files.exists(path)) {
    process(path);
    Files.delete(path);
}
```

Masalah:

- file bisa hilang setelah `exists`
- file bisa diganti setelah `exists`
- path bisa menjadi symlink setelah check
- dua worker bisa melihat file yang sama

Solusi:

- gunakan operasi atomic untuk klaim
- treat exception sebagai bagian normal workflow
- jangan jadikan existence check sebagai lock

---

### 2.3 Delete Setelah Process Tanpa Audit State

Anti-pattern:

```java
process(file);
Files.delete(file);
```

Masalah:

- jika process berhasil tapi delete gagal, retry bisa duplikat
- jika process sebagian berhasil lalu crash, state tidak jelas
- jika output external sudah dibuat, delete bukan bukti sukses
- tidak ada bukti operasional bahwa file pernah ada

Solusi:

- gunakan status store
- archive file sukses
- simpan manifest/result metadata
- idempotency key berdasarkan content hash atau stable file id

---

### 2.4 Folder sebagai Queue Tanpa Backpressure

Anti-pattern:

```text
/input contains 2,000,000 files
```

Masalah:

- directory listing lambat
- inode habis
- scanner menekan disk
- pod restart butuh waktu lama
- observability buruk
- cleanup berisiko

Solusi:

- shard directory
- manifest/index
- batch window
- capacity guardrail
- queue/database untuk kontrol state

---

### 2.5 Menganggap Rename Selalu Sama Dengan Commit Global

Rename/atomic move kuat untuk local filesystem dalam directory/filesystem yang sama, tetapi bukan transaksi distributed.

Rename tidak otomatis menjamin:

- data benar-benar durable setelah crash jika tidak ada fsync/force yang sesuai
- semua node network filesystem langsung melihat state baru secara konsisten
- side effect external ikut rollback
- multi-file group commit terjadi atomic

Atomic move adalah primitive penting, bukan solusi seluruh workflow.

---

## 3. Canonical Directory Layout

Salah satu cara paling praktis membuat workflow file lebih jelas adalah memakai directory layout sebagai state machine.

Contoh layout:

```text
file-workflow-root/
  inbox/
    ready/
    staging/
  work/
    claimed/
    processing/
  outbox/
    staging/
    ready/
  archive/
    success/
    failed/
  quarantine/
  manifests/
  locks/
  tmp/
```

Namun layout ini harus disesuaikan dengan kebutuhan. Tidak semua sistem perlu semua folder.

Minimal production layout biasanya:

```text
root/
  incoming/
  processing/
  done/
  error/
  tmp/
```

Lebih baik lagi:

```text
root/
  incoming/
    staging/
    ready/
  processing/
  archive/
    success/
    failed/
  quarantine/
  tmp/
```

---

## 4. State Machine File Workflow

Daripada berpikir “folder”, pikirkan “state”.

Contoh state:

```text
RECEIVING
VALIDATING
READY
CLAIMED
PROCESSING
PROCESSED
ARCHIVED
FAILED_RETRYABLE
FAILED_PERMANENT
QUARANTINED
ORPHANED
```

Mapping state ke directory bisa seperti ini:

| State | Directory | Arti |
|---|---|---|
| RECEIVING | `incoming/staging` | file sedang ditulis producer |
| READY | `incoming/ready` | file lengkap dan boleh diklaim |
| CLAIMED | `processing/<worker-id>` | file sudah dimiliki worker |
| PROCESSED | `archive/success` | file sukses diproses |
| FAILED_RETRYABLE | `incoming/ready` atau `retry` | file akan dicoba ulang |
| FAILED_PERMANENT | `archive/failed` | file gagal final |
| QUARANTINED | `quarantine` | file berbahaya/rusak/tidak valid |
| ORPHANED | `processing` terlalu lama | file ditinggal worker crash |

Poin penting:

```text
Directory bukan hanya tempat menyimpan file.
Directory adalah representasi state operasional.
```

---

## 5. Pattern 1 — Producer Staging + Atomic Publish

### 5.1 Problem

Consumer tidak boleh melihat file sebelum lengkap.

### 5.2 Pattern

Producer menulis ke file sementara, lalu mem-publish dengan atomic move.

```text
incoming/staging/order-123.csv.tmp
        |
        | after complete write + flush/force if needed
        v
incoming/ready/order-123.csv
```

### 5.3 Java Sketch

```java
Path stagingDir = root.resolve("incoming/staging");
Path readyDir = root.resolve("incoming/ready");

Path tmp = stagingDir.resolve("order-123.csv.tmp");
Path ready = readyDir.resolve("order-123.csv");

byte[] content = loadContent();

Files.write(tmp, content,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);

Files.move(tmp, ready,
        StandardCopyOption.ATOMIC_MOVE);
```

Untuk durability lebih kuat:

```java
try (FileChannel ch = FileChannel.open(tmp,
        StandardOpenOption.WRITE,
        StandardOpenOption.CREATE_NEW)) {
    ch.write(ByteBuffer.wrap(content));
    ch.force(true);
}

Files.move(tmp, ready,
        StandardCopyOption.ATOMIC_MOVE);
```

### 5.4 Invariant

```text
Consumer hanya membaca incoming/ready.
Producer tidak pernah menulis langsung ke incoming/ready.
```

### 5.5 Failure Matrix

| Failure | State | Recovery |
|---|---|---|
| crash sebelum tmp dibuat | tidak ada file | no-op |
| crash saat menulis tmp | tmp partial di staging | cleanup staging berdasarkan age |
| crash setelah tmp lengkap sebelum move | tmp lengkap di staging | publish ulang jika manifest valid, atau cleanup |
| crash setelah move | file ada di ready | consumer proses normal |

---

## 6. Pattern 2 — Claim by Atomic Rename

### 6.1 Problem

Banyak worker mengambil file dari folder yang sama. Dua worker tidak boleh memproses file yang sama.

### 6.2 Pattern

Worker mengklaim file dengan memindahkan file dari `ready` ke folder worker-specific menggunakan atomic move.

```text
incoming/ready/order-123.csv
        |
        | worker A atomic move
        v
processing/worker-A/order-123.csv
```

Jika worker B mencoba file yang sama, move akan gagal karena source sudah hilang.

### 6.3 Java Sketch

```java
Path ready = root.resolve("incoming/ready/order-123.csv");
Path claimed = root.resolve("processing/worker-A/order-123.csv");

try {
    Files.move(ready, claimed, StandardCopyOption.ATOMIC_MOVE);
    // worker owns the file now
} catch (NoSuchFileException e) {
    // another worker probably claimed it first
} catch (AtomicMoveNotSupportedException e) {
    // fallback strategy needed; do not silently degrade in distributed workflow
}
```

### 6.4 Why Rename Beats Lock File for Claiming

Lock file pattern:

```text
file.csv
file.csv.lock
```

Problem:

- stale lock
- PID reuse
- worker crash
- network filesystem ambiguity
- orphan cleanup difficult

Rename claim pattern:

```text
ready/file.csv -> processing/worker-id/file.csv
```

Keunggulan:

- source hilang dari queue
- ownership terlihat dari directory
- recovery bisa scan processing folder
- tidak perlu separate lock state untuk happy path

### 6.5 Invariant

```text
File yang berada di processing/<worker-id> hanya boleh diproses oleh worker-id tersebut.
```

---

## 7. Pattern 3 — Idempotent Processor

### 7.1 Problem

File workflow hampir selalu bisa retry. Jika retry terjadi, side effect bisa dobel.

Contoh side effect:

- insert database
- kirim email
- upload object
- call external API
- generate invoice
- publish message

Jika file diproses dua kali, sistem bisa rusak.

### 7.2 Pattern

Setiap file harus punya idempotency key.

Possible idempotency key:

| Key | Cocok Untuk | Risiko |
|---|---|---|
| original filename | simple batch | rename/duplicate nama |
| content hash | file immutable | mahal untuk file besar |
| manifest id | enterprise integration | manifest harus trustworthy |
| external transaction id | upstream-controlled | butuh kontrak producer |
| generated UUID at receive | internal workflow | harus disimpan stabil |

### 7.3 Recommended Strategy

Untuk workflow serius:

```text
idempotency_key = producer_id + business_document_id + content_hash
```

Atau:

```text
idempotency_key = manifest.transfer_id
```

Dengan validasi:

- transfer id unik
- content hash cocok
- ukuran file cocok
- producer authorized

### 7.4 Database Gate Pattern

Sebelum memproses:

```sql
INSERT INTO file_processing_job(idempotency_key, status, created_at)
VALUES (?, 'PROCESSING', CURRENT_TIMESTAMP)
```

Dengan unique constraint pada `idempotency_key`.

Jika insert gagal karena duplicate:

- cek status existing
- jika SUCCESS: skip
- jika PROCESSING terlalu lama: recovery/lease
- jika FAILED_RETRYABLE: retry policy
- jika FAILED_PERMANENT: quarantine/ignore

### 7.5 Invariant

```text
External side effect harus dikontrol oleh idempotency key, bukan oleh asumsi bahwa file hanya akan diproses sekali.
```

---

## 8. Pattern 4 — Manifest + Payload

### 8.1 Problem

Satu file payload sering tidak cukup untuk membawa metadata operasional.

Kita butuh:

- producer id
- transfer id
- file size
- hash
- schema version
- content type
- created time
- expected file count
- retry policy
- business correlation id

### 8.2 Pattern

Gunakan manifest file terpisah.

```text
incoming/ready/
  transfer-abc123.manifest.json
  transfer-abc123.payload.csv
```

Atau folder per transfer:

```text
incoming/ready/transfer-abc123/
  manifest.json
  payload.csv
  signature.txt
```

### 8.3 Manifest Example

```json
{
  "transferId": "abc123",
  "producer": "agency-a",
  "schema": "order-import-v3",
  "payload": {
    "fileName": "orders.csv",
    "size": 1048576,
    "sha256": "...",
    "contentType": "text/csv",
    "charset": "UTF-8"
  },
  "createdAt": "2026-06-18T10:15:30Z",
  "correlationId": "corr-789"
}
```

### 8.4 Publish Order

Safer approach:

```text
1. write payload to staging
2. compute hash
3. write manifest to staging
4. move folder or move manifest last as commit marker
```

Commit-marker style:

```text
incoming/staging/transfer-abc123/payload.csv
incoming/staging/transfer-abc123/manifest.json
incoming/staging/transfer-abc123/_READY
```

Consumer only processes transfer folder if `_READY` exists.

### 8.5 Manifest as Commit Marker

If filesystem cannot atomically move entire directory reliably across all target environments, publish file group using marker:

```text
transfer-abc123/
  payload.csv
  manifest.json
  _READY
```

Invariant:

```text
Consumer ignores folder unless _READY exists and manifest validation passes.
```

---

## 9. Pattern 5 — Atomic Output Handoff

Input workflows and output workflows are symmetric.

Producer of output should not write final output directly.

Bad:

```text
outbox/report.csv     // being written directly
```

Good:

```text
outbox/staging/report.csv.tmp
outbox/ready/report.csv
```

For generated reports:

```text
report-job-123/
  staging/
    report.pdf.tmp
    metadata.json.tmp
  ready/
    report.pdf
    metadata.json
```

### 9.1 Output Commit Invariant

```text
A downstream consumer may only read from outbox/ready.
Files in outbox/staging are invisible and may be deleted/rebuilt.
```

### 9.2 Multi-File Output

For multi-file output:

```text
outbox/ready/export-2026-06-18/
  manifest.json
  data-0001.csv
  data-0002.csv
  data-0003.csv
  _COMPLETE
```

Downstream reads only when `_COMPLETE` exists.

---

## 10. Pattern 6 — Quarantine

### 10.1 Problem

Not every failure should be retried.

Examples:

- path traversal attempt
- invalid filename
- invalid MIME/magic number
- unsupported schema
- checksum mismatch
- malformed archive
- decompression bomb suspicion
- permission anomaly
- malicious symlink

Retrying malicious or invalid input wastes resources and creates noise.

### 10.2 Pattern

Move dangerous/invalid files to quarantine with metadata.

```text
quarantine/
  2026/06/18/
    abc123.payload
    abc123.reason.json
```

Reason file:

```json
{
  "reason": "CHECKSUM_MISMATCH",
  "originalPath": "incoming/ready/order.csv",
  "detectedAt": "2026-06-18T10:15:30Z",
  "correlationId": "corr-789",
  "sha256Actual": "...",
  "sha256Expected": "..."
}
```

### 10.3 Security Note

Quarantine is not just `error/`.

Quarantine files should:

- not be executable
- not be served directly by web server
- have restricted permissions
- be retained based on policy
- be reviewable by operator
- not be automatically retried

---

## 11. Pattern 7 — Archive Success

### 11.1 Why Archive Instead of Delete?

Archive helps:

- audit
- replay
- debugging
- compliance
- dispute handling
- incident reconstruction
- deduplication proof

Delete is acceptable only if:

- file is not needed for audit
- metadata/status is persisted elsewhere
- idempotency proof remains
- retention policy permits deletion

### 11.2 Archive Layout

```text
archive/success/
  2026/
    06/
      18/
        transfer-abc123/
          manifest.json
          payload.csv
          result.json
```

### 11.3 Archive Metadata

`result.json`:

```json
{
  "status": "SUCCESS",
  "processedAt": "2026-06-18T10:20:00Z",
  "durationMs": 12345,
  "recordsRead": 10000,
  "recordsSucceeded": 9998,
  "recordsFailed": 2,
  "processorVersion": "2026.06.18-1",
  "correlationId": "corr-789"
}
```

---

## 12. Pattern 8 — Retry Directory and Poison File Handling

### 12.1 Problem

Retryable failures can become infinite loops.

Examples:

- temporary DB outage
- external API timeout
- network filesystem hiccup
- disk pressure

But after N retries, continuing forever is bad.

### 12.2 Pattern

Use retry metadata.

```text
retry/
  attempt-1/
  attempt-2/
  attempt-3/
failed/
quarantine/
```

Or store retry count in database/job table.

### 12.3 Backoff

Do not immediately move file back to ready.

Use:

- next attempt timestamp
- exponential backoff
- max attempts
- failure classification

### 12.4 Poison File

A poison file is a file that repeatedly crashes or blocks processing.

Rules:

```text
If same file fails with same deterministic reason beyond threshold,
move to failed/quarantine and stop retrying automatically.
```

---

## 13. Pattern 9 — Lease-Based Processing

### 13.1 Problem

Worker may crash after claiming file.

Then file remains in:

```text
processing/worker-A/file.csv
```

forever.

### 13.2 Pattern

Maintain lease metadata.

```json
{
  "workerId": "worker-A",
  "claimedAt": "2026-06-18T10:15:30Z",
  "leaseUntil": "2026-06-18T10:25:30Z",
  "heartbeatAt": "2026-06-18T10:20:00Z"
}
```

### 13.3 Recovery Scanner

Periodic recovery job scans processing directory:

```text
if now > leaseUntil and heartbeat stale:
    mark orphaned
    move file back to ready or failed-recovery
```

### 13.4 Important Caveat

Lease recovery must be conservative.

If worker is slow but alive, stealing file can cause duplicate processing.

Better design:

- idempotency at side effect layer
- heartbeat update
- worker shutdown hook best effort
- max processing duration per file
- operator visibility

---

## 14. Pattern 10 — Inbox/Outbox Directory Pattern

This is common in enterprise integrations.

### 14.1 Inbox

External producer writes file for this service.

```text
inbox/
  staging/
  ready/
  rejected/
```

### 14.2 Outbox

This service writes file for external consumer.

```text
outbox/
  staging/
  ready/
  sent/
  failed/
```

### 14.3 Why Separate Inbox and Outbox?

Because lifecycle differs:

| Aspect | Inbox | Outbox |
|---|---|---|
| Owner of file creation | external/upstream | this service |
| Validation | strict intake validation | internal generation validation |
| Retry target | process file | deliver/export file |
| Failure | reject/quarantine | regenerate/retry delivery |
| Audit | proof of received input | proof of generated output |

---

## 15. Pattern 11 — Directory Sharding

### 15.1 Problem

Too many files in one directory causes performance and operational issues.

### 15.2 Pattern

Shard by date:

```text
archive/success/2026/06/18/...
```

Shard by hash prefix:

```text
objects/ab/cd/abcdef123456...
```

Shard by tenant:

```text
tenants/tenant-a/inbox/ready
```

Shard by batch:

```text
batches/batch-20260618-001/ready
```

### 15.3 Choosing Shard Key

| Shard Key | Good For | Risk |
|---|---|---|
| date | retention, audit | hot partition on busy day |
| hash prefix | even distribution | less human-friendly |
| tenant | isolation | noisy tenant folder |
| batch id | batch processing | large batch can still be huge |
| business domain | operator-friendly | uneven distribution |

---

## 16. Pattern 12 — Sidecar Metadata File

### 16.1 Problem

Filesystem metadata alone is insufficient.

You may need:

- original filename
- uploaded by
- validation status
- source system
- content hash
- processing status
- error reason
- retry count
- business key

### 16.2 Pattern

For each payload:

```text
file.csv
file.csv.meta.json
```

or:

```text
transfer-123/
  payload.csv
  meta.json
```

### 16.3 Rule

Treat metadata as part of the workflow state.

If payload and metadata can be inconsistent, add:

- hash
- size
- version
- status
- commit marker

---

## 17. Pattern 13 — Database as Source of Truth, Filesystem as Blob Store

For serious systems, directory state alone may not be enough.

### 17.1 Architecture

```text
filesystem stores bytes
DB stores workflow state
```

DB table:

```sql
CREATE TABLE file_job (
    id BIGINT PRIMARY KEY,
    transfer_id VARCHAR(128) UNIQUE NOT NULL,
    storage_path VARCHAR(1024) NOT NULL,
    sha256 VARCHAR(64),
    size_bytes BIGINT,
    status VARCHAR(64) NOT NULL,
    attempt_count INT NOT NULL,
    claimed_by VARCHAR(128),
    lease_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Filesystem:

```text
storage/ab/cd/<content-hash>
```

### 17.2 Benefits

- strong queryability
- dashboards
- idempotency with unique constraints
- retry policy
- audit history
- workflow state independent from directory listing

### 17.3 Risks

- DB and filesystem can become inconsistent
- need reconciliation job
- need garbage collection
- need transactional boundary design

### 17.4 Reconciliation

Regularly check:

```text
DB says file exists, FS missing
FS file exists, DB missing
DB says PROCESSING, lease expired
DB says SUCCESS, file still in processing
```

---

## 18. Multi-File Transaction Approximation

Filesystem generally does not give you multi-file transactions.

If you need to publish a group of files together:

```text
export-123/
  a.csv
  b.csv
  c.csv
```

You cannot assume consumers will see all-or-nothing unless you design for it.

### 18.1 Pattern A — Directory Atomic Move

Create complete directory in staging:

```text
outbox/staging/export-123/
  a.csv
  b.csv
  c.csv
  manifest.json
```

Then move directory:

```text
outbox/staging/export-123 -> outbox/ready/export-123
```

Works well when rename directory is atomic on same filesystem and environment supports it.

### 18.2 Pattern B — Commit Marker

Write all files, then write marker last:

```text
outbox/ready/export-123/
  a.csv
  b.csv
  c.csv
  manifest.json
  _COMPLETE
```

Consumer ignores directory until `_COMPLETE` exists.

### 18.3 Pattern C — Manifest Lists Expected Files

`manifest.json`:

```json
{
  "files": [
    {"name": "a.csv", "size": 123, "sha256": "..."},
    {"name": "b.csv", "size": 456, "sha256": "..."},
    {"name": "c.csv", "size": 789, "sha256": "..."}
  ]
}
```

Consumer verifies all expected files before processing.

### 18.4 Recommended Combination

For high reliability:

```text
staging folder + manifest + checksums + commit marker + optional directory rename
```

---

## 19. Safe File Claiming Algorithms

### 19.1 Single Node, Multiple Threads

Use in-memory coordination plus atomic rename.

```text
Directory scan -> candidate paths -> worker pool -> claim by move -> process
```

Do not rely on `FileLock` for threads in same JVM because Java file locks are VM-wide.

### 19.2 Multiple Processes, Same Local Filesystem

Use atomic rename claim.

```text
ready/file -> processing/process-id/file
```

### 19.3 Multiple Nodes, Network Filesystem

Be careful. Atomic rename and locking semantics may vary depending on filesystem and mount options.

Safer approach:

```text
DB queue controls ownership
filesystem stores payload
```

Or:

```text
object storage + database/queue
```

### 19.4 Kubernetes Multiple Pods

If multiple pods share PVC/NFS/EFS:

- do not assume local filesystem semantics
- use DB lease or queue for ownership
- keep file operation idempotent
- design orphan recovery
- prefer object storage for large shared payloads if semantics fit

---

## 20. Watcher + Scanner Hybrid Pattern

### 20.1 Problem

`WatchService` can miss/coalesce events and emits `OVERFLOW`.

### 20.2 Pattern

Use watcher only as a trigger.

```text
Watch event received -> schedule scan
Periodic timer -> schedule scan
Startup -> full scan
Overflow -> full scan
```

### 20.3 Architecture

```text
WatchService
    |
    v
ScanScheduler ---- periodic scan
    |
    v
DirectoryScanner
    |
    v
ClaimByRename
    |
    v
Processor
```

### 20.4 Invariant

```text
Correctness must not depend on receiving every watch event.
```

---

## 21. Backpressure Patterns

### 21.1 Why Backpressure Matters

File workflows can exhaust:

- disk space
- inode
- memory
- CPU
- DB connections
- downstream API quota
- network bandwidth
- thread pool

### 21.2 Backpressure Signals

- number of files in ready
- total bytes in ready
- age of oldest file
- processing queue length
- disk usable space
- retry count
- error rate
- downstream latency

### 21.3 Controls

| Control | Description |
|---|---|
| max files per scan | avoid full directory storm |
| max concurrent processing | protect CPU/DB/downstream |
| max bytes in-flight | protect memory/disk |
| low disk watermark | stop accepting new files |
| producer rejection | fail fast when capacity exhausted |
| rate limit | smooth spikes |
| priority queue | process urgent files first |

### 21.4 Guardrail Example

```java
long usable = Files.getFileStore(root).getUsableSpace();
long minimum = 10L * 1024 * 1024 * 1024; // 10 GiB

if (usable < minimum) {
    throw new IllegalStateException("File intake paused: low usable disk space");
}
```

Remember: space check is a hint, not a guarantee.

---

## 22. Retention and Cleanup Architecture

### 22.1 What Needs Retention?

- success archive
- failed archive
- quarantine
- tmp/staging files
- processing orphan files
- logs/manifest/result metadata
- old output files

### 22.2 Cleanup Policy

Example:

| Area | Retention |
|---|---|
| `tmp` | 24 hours |
| `staging` partial | 24 hours if no activity |
| `archive/success` | 90 days |
| `archive/failed` | 180 days |
| `quarantine` | manual review or 365 days |
| `processing` stale | recover after lease expiry |

### 22.3 Cleanup Must Be Safe

Cleanup should include root guard:

```java
Path rootReal = root.toRealPath();
Path candidateReal = candidate.toRealPath(LinkOption.NOFOLLOW_LINKS);

if (!candidateReal.startsWith(rootReal)) {
    throw new SecurityException("Refusing to delete outside root");
}
```

But be aware: symlink race issues require stricter design if attacker controls directories.

### 22.4 Never Cleanup by String Prefix Alone

Bad:

```java
if (path.toString().startsWith("/data/app")) {
    delete(path);
}
```

Because:

```text
/data/application-other
```

also starts with `/data/app`.

Use normalized/real `Path` boundaries.

---

## 23. File Workflow Error Taxonomy

A robust workflow distinguishes failure type.

| Category | Example | Retry? |
|---|---|---|
| transient infrastructure | DB timeout, temporary network error | yes |
| capacity | disk full, inode full | after intervention/backpressure |
| permission | access denied | usually no until config fixed |
| malformed input | invalid CSV/schema | no automatic retry |
| security rejection | path traversal, symlink escape | no, quarantine |
| corruption | checksum mismatch | maybe re-request upstream |
| race/lifecycle | missing file after scan | normal/noisy but not fatal |
| unknown bug | unexpected exception | limited retry then fail |

Top-level rule:

```text
Do not retry all errors blindly.
```

---

## 24. Observability Model for File Workflow

### 24.1 Required Logs

Every state transition should log:

- workflow id
- file id
- correlation id
- source path
- target path
- operation
- duration
- byte size
- hash if available
- worker id
- result
- exception class

Example log event:

```json
{
  "event": "FILE_CLAIMED",
  "transferId": "abc123",
  "source": "incoming/ready/abc123.csv",
  "target": "processing/worker-1/abc123.csv",
  "workerId": "worker-1",
  "durationMs": 3
}
```

### 24.2 Required Metrics

- files received
- files claimed
- files processed successfully
- files failed
- files quarantined
- retry count
- processing duration
- oldest ready file age
- ready queue depth
- bytes in ready
- disk usable space
- staging stale count
- orphan processing count

### 24.3 Required Traces

For distributed flow:

```text
receive file -> validate -> DB status insert -> process records -> DB commit -> archive
```

Each step should be traceable with same correlation id.

---

## 25. Security Architecture Checklist

For file workflow:

```text
[ ] user filename is never used directly as storage path
[ ] path traversal blocked
[ ] symlink escape blocked
[ ] upload extension validated
[ ] content type/magic number validated if relevant
[ ] archive extraction has size/file-count/depth limits
[ ] quarantine is not web-served
[ ] temp files use safe permissions
[ ] final files use least privilege
[ ] cleanup has root guard
[ ] logs do not expose sensitive file content
[ ] malicious retry loops are prevented
```

---

## 26. Durability Architecture Checklist

```text
[ ] producer writes to staging first
[ ] final visibility happens through atomic move or commit marker
[ ] important file content is flushed/forced if crash durability matters
[ ] manifest includes size/hash
[ ] output published only after complete generation
[ ] recovery handles partial staging files
[ ] archive/result metadata persists processing result
[ ] DB status and file state have reconciliation process
```

---

## 27. Scalability Architecture Checklist

```text
[ ] directory is sharded
[ ] scan is bounded
[ ] processing is rate-limited
[ ] max in-flight bytes configured
[ ] disk low watermark configured
[ ] retry backoff exists
[ ] poison file handling exists
[ ] metrics expose queue depth and oldest age
[ ] cleanup prevents unbounded archive growth
```

---

## 28. Example Architecture: Production File Intake Engine

### 28.1 Requirements

- receive CSV files from upstream
- validate filename and content
- compute hash
- ensure file is processed once
- support multiple worker pods
- archive success
- quarantine invalid files
- recover after crash
- expose metrics

### 28.2 Directory Layout

```text
/data/file-intake/
  incoming/
    staging/
    ready/
  processing/
  archive/
    success/
    failed/
  quarantine/
  tmp/
```

### 28.3 Database Table

```sql
CREATE TABLE intake_job (
    id BIGINT PRIMARY KEY,
    transfer_id VARCHAR(128) NOT NULL UNIQUE,
    original_filename VARCHAR(512) NOT NULL,
    storage_path VARCHAR(1024) NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL,
    status VARCHAR(64) NOT NULL,
    attempt_count INT NOT NULL,
    claimed_by VARCHAR(128),
    lease_until TIMESTAMP,
    last_error_code VARCHAR(128),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

### 28.4 Flow

```text
1. Receive upload
2. Generate internal transfer id
3. Write to incoming/staging/<transfer-id>.tmp
4. Compute hash and size
5. Insert DB row with RECEIVING/VALIDATING
6. Validate content
7. Move file to incoming/ready/<transfer-id>.csv
8. Update DB to READY
9. Worker claims DB row using SELECT FOR UPDATE / lease
10. Worker moves file to processing/<worker-id>/<transfer-id>.csv
11. Process file idempotently
12. Move file to archive/success or quarantine/failed
13. Update DB final status
```

### 28.5 Why DB Claim Instead of File Rename Only?

Because requirement says multiple worker pods. If shared storage is PVC/EFS/NFS-like, file rename may not be enough as sole coordination primitive across all operational conditions.

DB gives:

- unique idempotency
- visible status
- lease expiry
- retry count
- audit

Filesystem stores bytes.

### 28.6 Recovery Job

On startup and periodically:

```text
- scan DB PROCESSING rows with expired lease
- check whether file exists in processing
- if side effect not committed, move back to ready and increment attempt
- if side effect committed, archive and mark success
- scan staging files older than threshold
- scan ready files missing DB row
- scan DB rows whose file is missing
```

---

## 29. Example Java Skeleton

This is intentionally a skeleton, not full framework code.

```java
public final class FileWorkflowPaths {
    private final Path root;

    public FileWorkflowPaths(Path root) {
        this.root = root;
    }

    public Path incomingStaging() { return root.resolve("incoming/staging"); }
    public Path incomingReady() { return root.resolve("incoming/ready"); }
    public Path processing(String workerId) { return root.resolve("processing").resolve(workerId); }
    public Path archiveSuccess() { return root.resolve("archive/success"); }
    public Path archiveFailed() { return root.resolve("archive/failed"); }
    public Path quarantine() { return root.resolve("quarantine"); }
    public Path tmp() { return root.resolve("tmp"); }
}
```

```java
public final class FileClaimService {
    private final FileWorkflowPaths paths;
    private final String workerId;

    public FileClaimService(FileWorkflowPaths paths, String workerId) {
        this.paths = paths;
        this.workerId = workerId;
    }

    public Optional<Path> tryClaim(Path readyFile) throws IOException {
        Files.createDirectories(paths.processing(workerId));

        Path target = paths.processing(workerId).resolve(readyFile.getFileName());

        try {
            Files.move(readyFile, target, StandardCopyOption.ATOMIC_MOVE);
            return Optional.of(target);
        } catch (NoSuchFileException e) {
            return Optional.empty();
        } catch (AtomicMoveNotSupportedException e) {
            throw new IOException("Atomic claim not supported by filesystem", e);
        }
    }
}
```

```java
public final class IntakeScanner {
    private final Path readyDir;
    private final FileClaimService claimService;

    public IntakeScanner(Path readyDir, FileClaimService claimService) {
        this.readyDir = readyDir;
        this.claimService = claimService;
    }

    public List<Path> claimBatch(int maxFiles) throws IOException {
        List<Path> claimed = new ArrayList<>();

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(readyDir)) {
            for (Path candidate : stream) {
                if (claimed.size() >= maxFiles) {
                    break;
                }

                if (!Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }

                Optional<Path> claim = claimService.tryClaim(candidate);
                claim.ifPresent(claimed::add);
            }
        }

        return claimed;
    }
}
```

---

## 30. Design Decision Matrix

### 30.1 When Directory State Alone Is Enough

Directory-only workflow may be enough when:

- single machine
- single process or low concurrency
- files are low value
- duplicate processing is acceptable or harmless
- no strict audit needed
- operator can manually inspect
- no external side effect risk

### 30.2 When You Need DB/Queue

Use DB/queue when:

- multiple nodes/pods
- strict exactly-once-like effect needed
- external side effects exist
- retry policy matters
- audit matters
- high volume
- SLA matters
- operator dashboard needed
- recovery must be deterministic

### 30.3 When You Need Object Storage

Use object storage when:

- files are large
- distributed access needed
- long-term retention needed
- lifecycle policy needed
- application should not manage disk capacity directly
- direct download/upload needed

But remember:

```text
Object storage is not a POSIX filesystem.
Design around object semantics, not Path semantics.
```

---

## 31. Production Readiness Checklist

```text
Architecture
[ ] workflow states are explicit
[ ] directory layout maps to lifecycle states
[ ] producer never writes directly to ready
[ ] consumer never reads staging
[ ] claim operation is atomic or controlled by DB/queue
[ ] idempotency key exists
[ ] retry policy exists
[ ] quarantine exists
[ ] archive policy exists
[ ] cleanup policy exists

Correctness
[ ] partial files are not visible
[ ] duplicate processing is safe
[ ] crash during every step has known recovery
[ ] output is published atomically
[ ] multi-file group has manifest/commit marker
[ ] file hash/size validated where necessary

Security
[ ] path traversal blocked
[ ] symlink escape blocked
[ ] filenames sanitized
[ ] upload content validated
[ ] archive extraction guarded
[ ] quarantine isolated

Operations
[ ] metrics exist
[ ] logs have correlation id
[ ] failed files have reason metadata
[ ] recovery scanner exists
[ ] operator runbook exists
[ ] disk/inode guardrails exist
[ ] old files cleaned by policy

Scalability
[ ] directory sharding exists if volume is high
[ ] scan bounded
[ ] backpressure configured
[ ] retry backoff configured
[ ] poison file handling configured
```

---

## 32. Key Takeaways

1. File workflow is a state machine, not a bunch of ad-hoc `Files.*` calls.
2. Producer should write to staging and publish via atomic move or commit marker.
3. Consumer should claim files atomically, usually by rename or DB lease.
4. `exists` is not coordination.
5. Watch events are triggers, not truth.
6. Idempotency is mandatory if side effects exist.
7. Archive/quarantine are separate concepts.
8. Retry must classify errors.
9. Multi-file transaction must be approximated intentionally.
10. Directory layout is an operational interface.
11. For multi-node systems, use DB/queue/object storage where filesystem semantics are too weak.
12. A production-grade file workflow needs observability, recovery, cleanup, retention, and guardrails.

---

## 33. How This Connects to the Next Part

This part focused on **architecture patterns**.

The next part focuses on **testing filesystem code**:

- temporary directories
- JUnit `@TempDir`
- in-memory filesystem
- golden files
- permission tests
- symlink tests
- race condition tests
- crash recovery tests
- cross-platform CI
- deterministic cleanup

Next:

```text
Part 33 — Testing File and Filesystem Code
```

---

## 34. Series Progress

Completed:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
Part 02 — File Existence, Type, and Identity: exists Is Not a Lock
Part 03 — File Creation Semantics: Atomic Create, Temp File, Directory Creation
Part 04 — Open Options and File Handles: How Java Opens Files
Part 05 — Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines
Part 06 — Writing Files Correctly: Replace, Append, Flush, Durability
Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move
Part 08 — Copy and Move Semantics: Replace, Attributes, Links, Cross-Device Behavior
Part 09 — Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup
Part 10 — Directory Listing and Traversal: list, walk, find, DirectoryStream
Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations
Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming
Part 13 — Path Traversal Security: User Input, Uploads, Archives, and Sandboxes
Part 14 — File Attributes: Basic, POSIX, DOS, Owner, ACL
Part 15 — Permissions Model: POSIX, Windows ACL, Containers, and Runtime Identity
Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails
Part 17 — WatchService: Filesystem Events Are Hints, Not Truth
Part 18 — File Locking: Advisory, Mandatory, Local, Network, and Cross-Process Coordination
Part 19 — Memory-Mapped Files in File Workflows
Part 20 — Random Access and Structured Binary File Layout
Part 21 — Append-Only Files, WAL, Journaling, and Recovery Design
Part 22 — Checksums, Hashes, Integrity, and Deduplication
Part 23 — File Naming, Extension, MIME, Charset, and Content Detection
Part 24 — Archives and Virtual Filesystems: ZIP FileSystem and JAR-Like Access
Part 25 — Custom FileSystemProvider and Pluggable Filesystem Mental Model
Part 26 — Legacy java.io.File: Interop, Migration, and Compatibility
Part 27 — Cross-Platform Filesystem Behavior: Linux, Windows, macOS
Part 28 — Containers, Cloud Runtime, Kubernetes Volumes, and Ephemeral Files
Part 29 — Network Filesystems and Distributed Files: NFS, SMB, EFS, Object Storage Boundary
Part 30 — Performance Engineering: Syscalls, Page Cache, Buffering, Batching, and Directory Scale
Part 31 — Observability and Troubleshooting File Workloads
Part 32 — File Workflow Architecture Patterns
```

Remaining:

```text
Part 33 — Testing File and Filesystem Code
Part 34 — Capstone: Build a Production-Grade File Intake Engine
Part 35 — Final Review: Top 1% Filesystem Engineering Checklist
```

Status: seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering-part-31-observability-troubleshooting-file-workloads](./learn-java-io-file-filesystem-storage-engineering-part-31-observability-troubleshooting-file-workloads.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 33](./learn-java-io-file-filesystem-storage-engineering-part-33-testing-file-filesystem-code.md)
