# learn-java-io-file-filesystem-storage-engineering-part-31-observability-troubleshooting-file-workloads

# Part 31 — Observability and Troubleshooting File Workloads

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: observability, troubleshooting, failure classification, incident reconstruction, metrics, logs, tracing, runbook, dan production debugging untuk workload file/filesystem.

---

## 1. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membahas banyak sisi teknis file/filesystem:

- path semantics,
- existence/type/identity,
- creation/open/read/write,
- atomic update,
- copy/move/delete,
- traversal,
- symbolic link,
- path traversal security,
- attributes/permission,
- filesystem capacity,
- watcher,
- locking,
- memory-mapped file,
- binary layout,
- WAL/journaling,
- checksum/hash,
- MIME/content detection,
- ZIP filesystem,
- custom `FileSystemProvider`,
- legacy `java.io.File`,
- cross-platform behavior,
- container/Kubernetes runtime,
- network/distributed filesystem,
- performance engineering.

Bagian ini menjawab pertanyaan produksi yang berbeda:

> Ketika file workload gagal di production, bagaimana kita tahu **apa yang sebenarnya terjadi**, **di layer mana gagalnya**, **apakah aman untuk retry**, dan **apa perbaikan desainnya**?

Top engineer tidak hanya bisa menulis kode file. Mereka bisa menjawab:

- operasi mana yang gagal,
- path mana yang terlibat,
- provider/filesystem mana yang menjalankan operasi,
- apakah gagal karena permission, capacity, race, symlink, lock, network filesystem, container volume, atau crash consistency,
- apakah data sudah partial-written,
- apakah file aman diproses ulang,
- apakah ada duplicate processing,
- apakah ada file orphan,
- apakah ada backlog,
- apakah insiden bisa direkonstruksi dari log/metric/trace.

---

## 2. Mental Model: File Incident Bukan Satu Layer

File operation di Java terlihat seperti ini:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

Namun failure-nya bisa muncul dari beberapa layer:

```text
Application intent
  ↓
Java API: Files / Path / FileChannel / WatchService
  ↓
FileSystemProvider
  ↓
OS syscall / runtime permission / process identity
  ↓
Filesystem implementation
  ↓
Volume/mount/container layer
  ↓
Local disk / network storage / object-storage-like abstraction
  ↓
Operational environment: quota, inode, eviction, node pressure, backup, antivirus, other process
```

Jadi saat ada exception seperti:

```text
java.nio.file.AccessDeniedException: /data/inbox/file.csv
```

itu belum cukup menjawab akar masalah.

Kemungkinan penyebabnya bisa:

- user process tidak punya permission,
- directory tidak executable pada POSIX,
- file read-only attribute di Windows,
- container `runAsUser` tidak cocok dengan volume owner,
- ConfigMap/Secret volume read-only,
- file sedang dikunci process lain,
- security policy runtime/container menolak akses,
- target path berada di mount read-only,
- antivirus/backup agent membuka file dengan sharing mode yang membatasi.

Observability yang baik harus membantu kita menyempitkan layer failure.

---

## 3. Prinsip Utama Observability File Workload

### 3.1 Jangan log hanya “failed to process file”

Bad:

```text
Failed to process file
```

Lebih baik:

```text
file_operation_failed
operation=atomic_publish
source=/data/staging/2026/06/18/abc.tmp
target=/data/inbox/abc.csv
normalizedTarget=/data/inbox/abc.csv
provider=file
fileStore=/data
attempt=3
exception=AtomicMoveNotSupportedException
message=Atomic move between FileStores is not supported
correlationId=9e7f...
```

Top engineer mendesain log agar menjawab:

- operasi apa?
- path sumber/target apa?
- fase workflow apa?
- attempt ke berapa?
- error class apa?
- safe to retry atau tidak?
- file sudah masuk state mana?
- actor/process/thread/pod mana?
- storage/mount mana?
- ukuran file berapa?
- checksum diketahui atau belum?

---

### 3.2 Jangan expose sensitive path sembarangan

Path bisa mengandung data sensitif:

```text
/uploads/users/1234567890/passport-john-doe.pdf
/data/cases/CASE-2026-0000123/evidence/...
```

Untuk sistem regulated atau multi-tenant, log sebaiknya memisahkan:

- `storageKey` internal,
- `tenantId`,
- `caseId` kalau memang boleh,
- hash path,
- redacted filename,
- extension/type,
- root category.

Contoh:

```text
file_operation_failed
operation=validate_upload
storageKey=upload/2026/06/18/01JY...bin
originalFilenameHash=sha256:8a1f...
originalExtension=.pdf
tenantId=T-001
caseId=CASE-2026-0000123
exception=MalformedInputException
```

Jangan default ke “log full path” jika path bisa berisi PII, identifier kasus, nama dokumen, atau nama user.

---

### 3.3 Treat exception as structured data

Jangan hanya simpan `e.getMessage()`.

Minimal simpan:

```text
exception.class
exception.message
exception.file
exception.otherFile
exception.reason
exception.cause.class
```

Untuk subclass `FileSystemException`, Java menyediakan:

```java
FileSystemException fse = ...;
fse.getFile();
fse.getOtherFile();
fse.getReason();
```

Ini penting untuk operasi dua path seperti move/copy:

```text
FileSystemException
file=/data/staging/a.tmp
otherFile=/data/inbox/a.csv
reason=Invalid cross-device link
```

---

## 4. Exception Taxonomy: Cara Membaca Failure Java NIO

Banyak exception file di Java adalah subclass `IOException`. Jika semua diperlakukan sama, troubleshooting menjadi kabur.

### 4.1 `NoSuchFileException`

Makna umum:

> Path yang dibutuhkan tidak ditemukan.

Kemungkinan penyebab:

- file memang belum ada,
- file sudah dihapus proses lain,
- parent directory hilang,
- relative path salah karena working directory berbeda,
- symlink target hilang,
- mount belum tersedia,
- Kubernetes volume belum mounted sesuai ekspektasi,
- race antara check dan use.

Contoh log yang berguna:

```text
file_operation_failed
operation=read_input
path=/data/inbox/a.csv
existsBefore=false
parentExists=true
parent=/data/inbox
cwd=/app
exception=NoSuchFileException
phase=PROCESSING_READ
```

Anti-pattern:

```java
if (Files.exists(path)) {
    Files.readString(path);
}
```

Masalah: file bisa hilang setelah `exists`.

Better:

```java
try {
    String content = Files.readString(path);
} catch (NoSuchFileException e) {
    // classify as missing input / race / already consumed
}
```

---

### 4.2 `FileAlreadyExistsException`

Makna umum:

> Operasi create gagal karena target sudah ada.

Biasanya muncul pada:

```java
Files.createFile(path);
Files.move(source, target); // tanpa REPLACE_EXISTING
Files.copy(source, target); // tanpa REPLACE_EXISTING
```

Kemungkinan penyebab:

- duplicate input,
- retry sebelumnya sudah berhasil sebagian,
- concurrent writer,
- idempotency key collision,
- temp filename tidak cukup unik,
- target directory dipakai multi process tanpa claim protocol.

Observability yang dibutuhkan:

```text
operation=create_claim_file
target=/data/claims/abc.claim
claimKey=abc
attempt=1
exception=FileAlreadyExistsException
classification=duplicate_or_concurrent_claim
```

Interpretasi penting:

- Dalam workflow idempotent, exception ini bisa berarti “sudah diproses” bukan selalu error fatal.
- Dalam workflow unique create, ini bisa jadi sinyal race atau collision.

---

### 4.3 `AccessDeniedException`

Makna umum:

> Akses ditolak oleh filesystem/provider/OS.

Kemungkinan penyebab:

- permission POSIX tidak cukup,
- owner/group salah,
- directory tidak punya execute bit,
- file read-only,
- target directory read-only,
- Windows file sharing/lock behavior,
- volume ConfigMap/Secret read-only,
- container user tidak sesuai owner volume,
- SELinux/AppArmor/seccomp policy,
- network filesystem permission mapping.

Troubleshooting checklist:

```text
- user id process?
- group id process?
- owner file?
- permission parent directory?
- mount read-write atau read-only?
- volume type?
- file sedang dibuka process lain?
- fileStore supports POSIX/ACL?
- apakah path berada di ConfigMap/Secret?
```

Log tambahan yang berguna:

```text
operation=write_output
path=/mnt/config/generated.yaml
fileStore=/mnt/config
readOnlyFileStore=true
containerUser=10001
exception=AccessDeniedException
classification=permission_or_readonly_volume
```

---

### 4.4 `DirectoryNotEmptyException`

Makna umum:

> Directory tidak bisa dihapus karena masih berisi entry.

Penyebab:

- recursive delete tidak benar,
- ada file baru dibuat saat proses delete,
- hidden file tidak terlihat oleh asumsi aplikasi,
- directory stream stale,
- symlink/junction behavior salah dimodelkan,
- filesystem menambah metadata file otomatis.

Troubleshooting:

- list isi directory setelah gagal,
- cek apakah ada writer concurrent,
- cek apakah cleanup berjalan paralel,
- cek apakah retry aman.

Pattern:

```java
try {
    Files.delete(dir);
} catch (DirectoryNotEmptyException e) {
    // classify: concurrent mutation or incomplete recursive delete
}
```

---

### 4.5 `AtomicMoveNotSupportedException`

Makna umum:

> `ATOMIC_MOVE` diminta, tetapi provider/filesystem tidak bisa menjamin atomic move.

Penyebab umum:

- source dan target beda filesystem/FileStore,
- network filesystem/provider tidak mendukung,
- virtual filesystem tidak mendukung,
- provider custom tidak punya atomic rename capability.

Interpretasi penting:

`AtomicMoveNotSupportedException` bukan error kecil. Ini berarti invariant desain “publish atomic” tidak terpenuhi.

Contoh respons yang benar:

```text
classification=atomicity_contract_not_available
action=fail_fast_not_silent_copy
```

Jangan diam-diam fallback ke copy+delete jika workflow membutuhkan atomic publish.

---

### 4.6 `FileSystemLoopException`

Makna umum:

> Traversal menemukan cycle, biasanya karena symbolic link.

Penyebab:

- `FOLLOW_LINKS` digunakan,
- directory symlink mengarah ke parent/ancestor,
- junction/reparse point di Windows,
- link graph tidak tree.

Respons:

- log path cycle,
- hentikan subtree,
- jangan infinite recursion,
- tentukan apakah link harus diikuti atau tidak.

---

### 4.7 `InvalidPathException`

Makna umum:

> String path tidak valid untuk platform/provider.

Berbeda dengan kebanyakan exception NIO, ini biasanya `RuntimeException`, bukan `IOException`.

Penyebab:

- karakter path invalid,
- embedded null,
- Windows reserved path pattern,
- format URI/path salah,
- user input langsung dijadikan path.

Pattern:

```java
try {
    Path p = base.resolve(userInput);
} catch (InvalidPathException e) {
    // user input invalid, classify as validation failure
}
```

Jangan biarkan ini menjadi 500 error yang tidak terklasifikasi dalam API upload/download.

---

### 4.8 `ClosedChannelException`, `AsynchronousCloseException`, `ClosedByInterruptException`

Makna umum:

> Operasi channel gagal karena channel ditutup atau thread diinterupsi.

Penyebab:

- resource lifecycle bug,
- stream/channel dipakai setelah `try-with-resources`,
- timeout/cancellation menutup channel,
- shutdown hook menutup resource saat worker masih jalan,
- interruption policy tidak jelas.

Observability:

```text
operation=file_copy_streaming
phase=WRITE_CHUNK
bytesCopied=104857600
thread=worker-12
shutdownInProgress=true
exception=ClosedByInterruptException
classification=cancellation_or_lifecycle
```

---

### 4.9 `MalformedInputException` dan `CharacterCodingException`

Makna umum:

> File byte tidak cocok dengan charset decoding yang dipakai.

Penyebab:

- file bukan text,
- charset salah,
- partial/truncated file,
- BOM tidak ditangani,
- mixed encoding,
- data corrupt.

Observability:

```text
operation=parse_text_file
path=/data/inbox/customers.csv
charset=UTF-8
size=983412
sampleHash=sha256:...
exception=MalformedInputException
classification=encoding_error
```

Jangan langsung menyimpulkan “file rusak” sebelum memeriksa charset contract.

---

## 5. Failure Classification Matrix

Gunakan taxonomy ini di log, metric, dan incident review.

| Classification | Contoh Exception | Penyebab Umum | Safe Retry? | Butuh Human? |
|---|---|---|---|---|
| `missing_input` | `NoSuchFileException` | file tidak ada/hilang | tergantung workflow | kadang |
| `duplicate_or_conflict` | `FileAlreadyExistsException` | target sudah ada | biasanya idempotency decision | tidak selalu |
| `permission_denied` | `AccessDeniedException` | permission/owner/readonly | tidak sampai config berubah | sering |
| `capacity_exhausted` | `IOException`, reason disk full | disk/quota/inode penuh | setelah capacity pulih | sering |
| `atomicity_unavailable` | `AtomicMoveNotSupportedException` | cross-device/provider | tidak, desain harus berubah | ya |
| `concurrent_mutation` | `DirectoryNotEmptyException`, `NoSuchFileException` | race antar process | biasanya dengan retry terbatas | kadang |
| `encoding_error` | `MalformedInputException` | charset salah/data corrupt | tidak tanpa input baru | kadang |
| `integrity_failure` | checksum mismatch | corrupt/tampered/partial | tidak untuk file sama | ya |
| `watch_overflow` | `OVERFLOW` event | event hilang | perlu rescan | tidak selalu |
| `lock_conflict` | lock unavailable | writer lain aktif | dengan backoff/lease | kadang |
| `network_storage_issue` | timeout/stale handle/I/O error | NFS/SMB/EFS issue | dengan backoff + reconciliation | sering |
| `resource_lifecycle` | `ClosedChannelException` | channel ditutup | bug dependent | developer |
| `invalid_user_path` | `InvalidPathException` | input path invalid | tidak, validasi user | tidak |

---

## 6. Structured Logging untuk File Workload

### 6.1 Field minimum

Untuk operasi file, log minimal sebaiknya punya:

```text
correlationId
operation
phase
pathRole
path
storageKey
fileSize
fileStore
providerScheme
attempt
elapsedMs
result
exceptionClass
classification
retryDecision
```

Contoh:

```json
{
  "event": "file_operation_failed",
  "correlationId": "01JYABC...",
  "operation": "atomic_publish",
  "phase": "MOVE_TMP_TO_READY",
  "sourcePath": "/data/staging/01JYABC.tmp",
  "targetPath": "/data/ready/01JYABC.dat",
  "providerScheme": "file",
  "attempt": 1,
  "elapsedMs": 3,
  "exceptionClass": "java.nio.file.AtomicMoveNotSupportedException",
  "classification": "atomicity_unavailable",
  "retryDecision": "do_not_retry_requires_design_change"
}
```

---

### 6.2 Field untuk read workload

```text
operation=read_file
path/storageKey
expectedSize
actualSize
lastModifiedTime
readBytes
charset
checksumExpected
checksumActual
elapsedMs
classification
```

Read failure tanpa `readBytes` sulit dianalisis. Apakah gagal di awal? Di tengah? Setelah 2 GB?

---

### 6.3 Field untuk write workload

```text
operation=write_file
path/storageKey
targetDirectory
bytesExpected
bytesWritten
openOptions
forceCalled
forceMetaData
tempFileUsed
atomicMoveRequested
atomicMoveSucceeded
elapsedMs
```

Field `forceCalled` penting untuk membedakan:

- visible to other process,
- flushed to Java/OS buffer,
- requested durable persistence.

---

### 6.4 Field untuk traversal workload

```text
operation=walk_tree
root
followLinks
maxDepth
visitedDirectories
visitedFiles
skippedSubtrees
failedVisits
elapsedMs
failurePolicy
```

Untuk tree operation, satu error bisa terjadi setelah ribuan file sukses. Jangan hilangkan progress counters.

---

### 6.5 Field untuk watcher workload

```text
operation=watch_directory
watchedRoot
registeredDirectories
watchKeyValid
eventKind
eventContext
overflowCount
rescanScheduled
lastFullScanAt
lagMs
```

Watcher tanpa overflow/rescan metric hampir pasti menipu saat production load tinggi.

---

## 7. Metrics: Apa yang Harus Diukur

### 7.1 Operation count

Counter:

```text
file_operation_total{operation="read", result="success"}
file_operation_total{operation="read", result="failure", classification="missing_input"}
file_operation_total{operation="atomic_move", result="failure", classification="atomicity_unavailable"}
```

Tujuan:

- tahu failure rate,
- tahu distribusi error,
- lihat perubahan setelah deployment,
- alert jika error tertentu naik.

---

### 7.2 Latency histogram

Histogram:

```text
file_operation_duration_seconds{operation="copy"}
file_operation_duration_seconds{operation="checksum"}
file_operation_duration_seconds{operation="walk_tree"}
file_operation_duration_seconds{operation="fsync"}
```

Jangan hanya average. File workload sering heavy-tail:

- 99 file kecil selesai 5 ms,
- 1 file besar selesai 45 detik.

Pakai p50/p95/p99.

---

### 7.3 Byte throughput

Counter:

```text
file_bytes_read_total{operation="ingest"}
file_bytes_written_total{operation="export"}
```

Gauge:

```text
file_copy_active_bytes
file_processing_backlog_bytes
```

Tanpa byte metric, jumlah file bisa misleading. 1000 file kecil tidak sama dengan 1000 file 2 GB.

---

### 7.4 Backlog metric

Untuk directory-based workflow:

```text
file_backlog_count{queue="inbox"}
file_backlog_bytes{queue="inbox"}
file_oldest_backlog_age_seconds{queue="inbox"}
```

`oldest_backlog_age_seconds` sering lebih berguna daripada count.

Contoh:

- count rendah tapi oldest age 6 jam = ada poison file.
- count tinggi tapi oldest age 30 detik = burst normal.

---

### 7.5 Capacity metric

```text
filesystem_usable_bytes{mount="/data"}
filesystem_total_bytes{mount="/data"}
filesystem_usage_ratio{mount="/data"}
filesystem_inode_free{mount="/data"}
```

Dari Java, `FileStore` bisa membantu membaca kapasitas, tetapi ingat nilainya adalah hint dan bisa berubah segera oleh proses lain.

---

### 7.6 Retry metric

```text
file_retry_total{operation="move", classification="lock_conflict"}
file_retry_exhausted_total{operation="copy", classification="network_storage_issue"}
```

Retry yang naik adalah early warning.

---

### 7.7 Integrity metric

```text
file_integrity_check_total{result="match"}
file_integrity_check_total{result="mismatch"}
file_quarantine_total{reason="checksum_mismatch"}
```

Checksum mismatch harus alert serius, bukan sekadar debug log.

---

## 8. Tracing: File Operation Sebagai Span

Dalam distributed system, file operation sering bagian dari flow besar:

```text
HTTP upload request
  → store temp file
  → validate content
  → compute hash
  → atomic publish
  → enqueue processing
  → worker reads file
  → writes result
```

Trace span sebaiknya membentuk timeline:

```text
span: upload.request
  span: file.create_temp
  span: file.stream_write
  span: file.force
  span: file.validate_magic
  span: file.compute_sha256
  span: file.atomic_move
  span: db.insert_file_metadata
```

Attributes yang berguna:

```text
file.operation
file.storage_key
file.size
file.extension
file.mime_detected
file.hash_algorithm
file.provider_scheme
file.error_classification
```

Hindari menyimpan full user filename sebagai trace attribute jika sensitif.

---

## 9. Audit Event vs Debug Log

Tidak semua log sama.

### 9.1 Debug/operational log

Untuk engineer:

```text
atomic_move_failed source=... target=... exception=...
```

### 9.2 Audit event

Untuk compliance/business trace:

```text
File received
File validated
File rejected
File quarantined
File published
File processed
File deleted by retention policy
```

Audit event harus lebih stabil, domain-oriented, dan tidak terlalu teknis.

Contoh audit:

```json
{
  "eventType": "FILE_QUARANTINED",
  "fileId": "01JYABC...",
  "caseId": "CASE-2026-000123",
  "reasonCode": "CHECKSUM_MISMATCH",
  "actor": "system:file-intake-worker",
  "occurredAt": "2026-06-18T10:15:30Z"
}
```

Debug log boleh berubah antar versi. Audit event sebaiknya versioned dan compatible.

---

## 10. Reconstructing Incident Timeline

Saat incident file workload terjadi, pertanyaan utama:

```text
1. File berasal dari mana?
2. Kapan pertama kali terlihat sistem?
3. Siapa/process mana yang mengklaim file?
4. Apakah file pernah berhasil dibaca penuh?
5. Apakah checksum dihitung?
6. Apakah file pernah dipindah state?
7. Apakah file pernah diproses lebih dari sekali?
8. Apakah output sudah dihasilkan?
9. Apakah ada partial output?
10. Apakah retry membuat duplicate side effect?
```

### 10.1 Timeline contoh

```text
10:00:01 upload request accepted correlationId=A
10:00:02 temp file created storageKey=S.tmp
10:00:07 write completed bytes=52428800
10:00:09 sha256 computed hash=...
10:00:10 atomic move to ready succeeded
10:00:11 DB metadata inserted fileId=F
10:00:20 worker claimed fileId=F
10:00:21 worker read started
10:02:40 worker failed MalformedInputException
10:02:41 file moved to quarantine
10:02:41 audit FILE_QUARANTINED emitted
```

Timeline seperti ini membuat insiden bisa dijelaskan.

Tanpa timeline, engineer biasanya hanya punya:

```text
Processing failed
```

Itu tidak cukup.

---

## 11. Designing File State Observability

Untuk workflow file yang serius, jangan hanya bergantung pada directory state. Buat state eksplisit.

Contoh state machine:

```text
RECEIVING
  → STAGED
  → VALIDATED
  → PUBLISHED
  → CLAIMED
  → PROCESSING
  → PROCESSED
  → ARCHIVED

Failure branches:
  → REJECTED
  → QUARANTINED
  → RETRY_PENDING
  → DEAD_LETTER
```

Setiap transition harus log/audit:

```text
file_state_transition
fileId=F
from=VALIDATED
to=PUBLISHED
operation=atomic_move
correlationId=A
```

### 11.1 Invariant yang bisa dimonitor

```text
- Tidak boleh ada file PROCESSING lebih dari 30 menit tanpa heartbeat.
- Tidak boleh ada STAGED lebih dari 10 menit tanpa validasi.
- Tidak boleh ada file fisik di ready/ tanpa metadata DB.
- Tidak boleh ada metadata PUBLISHED tanpa file fisik.
- Tidak boleh ada file quarantine tanpa reason code.
- Tidak boleh ada duplicate storageKey aktif.
```

Top engineer membuat invariant observable, bukan hanya berharap workflow benar.

---

## 12. Troubleshooting by Symptom

### 12.1 Symptom: file “hilang”

Kemungkinan:

- file belum pernah dibuat,
- file dibuat di working directory berbeda,
- relative path salah,
- file dipindahkan proses lain,
- cleanup job terlalu agresif,
- volume mount berbeda antar pod,
- file ditulis ke container writable layer, bukan PVC,
- case sensitivity mismatch,
- symlink target hilang,
- network filesystem cache/staleness.

Data yang perlu dicek:

```text
- absolute path yang digunakan
- cwd process
- pod/node tempat operasi terjadi
- mount table
- file state DB
- audit transition
- delete/cleanup log
- source and target path pada move
- FileStore/path root
```

Runbook cepat:

```text
1. Cari correlationId/fileId.
2. Cari event create/stage/publish/delete.
3. Cek path absolute dan storageKey.
4. Cek apakah producer dan consumer memakai volume yang sama.
5. Cek cleanup/retention job.
6. Cek case sensitivity dan filename normalization.
7. Cek apakah file pernah dipindah ke quarantine/error.
```

---

### 12.2 Symptom: upload sukses tetapi file corrupt

Kemungkinan:

- partial write dianggap sukses,
- writer tidak close stream,
- consumer membaca sebelum producer selesai,
- tidak ada atomic publish,
- checksum tidak diverifikasi,
- charset salah,
- transfer upstream sudah corrupt,
- disk/network storage error,
- concurrent writer menulis path sama,
- file overwritten.

Data yang perlu:

```text
- bytes expected vs bytes written
- checksum client vs server
- temp file path
- publish time
- consumer read start time
- file size saat read
- lastModifiedTime
- writer close/force log
```

Pattern desain untuk mencegah:

```text
write to staging temp
compute hash
close/force
atomic move to ready
consumer only reads ready
verify size/hash before processing
```

---

### 12.3 Symptom: directory watcher miss file

Kemungkinan:

- event overflow,
- file dibuat sebelum watcher registered,
- nested directory tidak registered,
- event coalescing,
- file move tidak menghasilkan event yang diharapkan,
- watch key invalid,
- network filesystem watcher unreliable,
- pod restarted.

Data yang perlu:

```text
- watcher start time
- registered directory count
- overflow count
- last full scan time
- watch key validity
- reconciliation scan result
```

Rule:

> Watcher harus trigger scan, bukan menjadi source of truth.

---

### 12.4 Symptom: disk penuh tiba-tiba

Kemungkinan:

- temp files tidak dibersihkan,
- quarantine bertambah,
- log file ditulis di container filesystem,
- large upload burst,
- retry membuat duplicate copy,
- recursive copy salah target,
- archive extraction bomb,
- inode habis karena banyak file kecil,
- filesystem quota tercapai,
- WAL/append-only segment tidak compacted.

Metric yang harus ada:

```text
filesystem usable bytes
filesystem inode free
backlog bytes
staging bytes
quarantine bytes
temp file count
oldest temp age
```

Runbook:

```text
1. Identifikasi mount yang penuh.
2. Pisahkan byte exhaustion vs inode exhaustion.
3. Cari top directory by size/count.
4. Cek temp/staging/quarantine/archive/log.
5. Cek recent deployment/job/batch.
6. Stop producer atau aktifkan backpressure.
7. Cleanup hanya dengan rule aman, bukan rm -rf buta.
```

---

### 12.5 Symptom: process lambat membaca/menulis file

Kemungkinan:

- file besar,
- network filesystem latency,
- metadata operation terlalu banyak,
- directory terlalu besar,
- checksum/hash CPU-bound,
- page cache cold,
- fsync terlalu sering,
- small write amplification,
- antivirus/backup scanning,
- pod throttling CPU/I/O,
- storage burst credit habis.

Data yang perlu:

```text
operation latency p50/p95/p99
bytes/sec
file size distribution
fsync latency
directory entry count
metadata call count
CPU usage
I/O wait
storage metrics
```

---

### 12.6 Symptom: file tidak bisa dihapus

Kemungkinan:

- file masih dibuka process sendiri,
- file masih dibuka process lain,
- Windows share/delete semantics,
- memory-mapped buffer belum released,
- permission/read-only attribute,
- directory not empty,
- symlink/junction behavior,
- network filesystem delay.

Data yang perlu:

```text
open handles
memory mapping usage
OS/platform
exception class/reason
file attributes
owner/permission
retry behavior
```

---

## 13. Retry, Backoff, and Idempotency Observability

Retry tanpa observability bisa memperparah insiden.

### 13.1 Kapan retry masuk akal?

Retry masuk akal untuk:

```text
- transient lock conflict
- temporary network storage hiccup
- watcher overflow followed by scan
- concurrent directory mutation
- short-lived AccessDenied on Windows due to external scanner, dengan batas jelas
```

Retry tidak masuk akal untuk:

```text
- invalid path
- checksum mismatch untuk file yang sama
- charset contract mismatch
- permission denied permanen
- atomic move unsupported
- target FileStore salah
- disk full tanpa capacity recovery
```

### 13.2 Log retry decision

```json
{
  "event": "file_retry_scheduled",
  "operation": "delete_temp_file",
  "classification": "transient_access_denied",
  "attempt": 2,
  "maxAttempts": 5,
  "backoffMs": 1000,
  "path": "/data/tmp/abc.tmp"
}
```

### 13.3 Idempotency field

```text
idempotencyKey
claimId
attempt
previousState
nextState
sideEffectAlreadyCommitted
```

Tanpa ini, retry bisa membuat duplicate output.

---

## 14. File Workflow Health Dashboard

Dashboard minimal untuk production file pipeline:

### 14.1 Intake

```text
uploads accepted/sec
uploads rejected/sec
upload bytes/sec
staging count
oldest staging age
validation failure by reason
```

### 14.2 Processing

```text
ready backlog count
ready backlog bytes
oldest ready age
active workers
processing duration p95/p99
retry pending count
poison/dead-letter count
```

### 14.3 Storage

```text
usable bytes by mount
inode free by mount
staging bytes
ready bytes
archive bytes
quarantine bytes
temp bytes
```

### 14.4 Reliability

```text
operation failure rate by classification
atomic move failures
checksum mismatch count
watch overflow count
lock conflict count
orphan file count
metadata-file mismatch count
```

### 14.5 Durability/consistency

```text
force/fsync latency
atomic publish duration
manifest mismatch
recovery scan fixes
startup reconciliation duration
```

---

## 15. Startup Reconciliation Observability

File systems do not give transaction semantics across all your application state. On startup, serious applications reconcile.

Example:

```text
1. Scan staging.
2. Scan ready.
3. Scan processing claims.
4. Compare with DB metadata.
5. Detect orphan temp files.
6. Detect metadata without physical file.
7. Detect physical file without metadata.
8. Recover or quarantine.
```

Log:

```json
{
  "event": "file_reconciliation_completed",
  "scannedFiles": 120482,
  "orphanTempFiles": 14,
  "metadataWithoutFile": 2,
  "fileWithoutMetadata": 5,
  "recoveredClaims": 3,
  "quarantinedFiles": 2,
  "elapsedMs": 18432
}
```

Metrics:

```text
file_reconciliation_orphan_total
file_reconciliation_recovered_total
file_reconciliation_duration_seconds
```

If reconciliation regularly repairs many objects, that is not “normal success”; it is a signal that runtime workflow is unstable.

---

## 16. Exception Handling Pattern in Java

### 16.1 Classify exception explicitly

```java
public enum FileFailureClass {
    MISSING_INPUT,
    DUPLICATE_OR_CONFLICT,
    PERMISSION_DENIED,
    DIRECTORY_NOT_EMPTY,
    ATOMICITY_UNAVAILABLE,
    FILESYSTEM_LOOP,
    INVALID_PATH,
    ENCODING_ERROR,
    INTEGRITY_FAILURE,
    RESOURCE_LIFECYCLE,
    IO_UNKNOWN
}
```

```java
public final class FileFailureClassifier {
    public static FileFailureClass classify(Throwable t) {
        if (t instanceof NoSuchFileException) {
            return FileFailureClass.MISSING_INPUT;
        }
        if (t instanceof FileAlreadyExistsException) {
            return FileFailureClass.DUPLICATE_OR_CONFLICT;
        }
        if (t instanceof AccessDeniedException) {
            return FileFailureClass.PERMISSION_DENIED;
        }
        if (t instanceof DirectoryNotEmptyException) {
            return FileFailureClass.DIRECTORY_NOT_EMPTY;
        }
        if (t instanceof AtomicMoveNotSupportedException) {
            return FileFailureClass.ATOMICITY_UNAVAILABLE;
        }
        if (t instanceof FileSystemLoopException) {
            return FileFailureClass.FILESYSTEM_LOOP;
        }
        if (t instanceof InvalidPathException) {
            return FileFailureClass.INVALID_PATH;
        }
        if (t instanceof MalformedInputException || t instanceof CharacterCodingException) {
            return FileFailureClass.ENCODING_ERROR;
        }
        if (t instanceof ClosedChannelException) {
            return FileFailureClass.RESOURCE_LIFECYCLE;
        }
        return FileFailureClass.IO_UNKNOWN;
    }
}
```

Catatan Java 8–25:

- Pattern matching `instanceof` modern belum tersedia di Java 8.
- Jika target kompatibel Java 8, gunakan style klasik seperti di atas.
- Untuk Java 16+, pattern matching bisa membuat kode lebih ringkas, tapi materi seri ini tetap menjaga kompatibilitas Java 8.

---

### 16.2 Extract file exception details

```java
public final class FileExceptionDetails {
    private final String exceptionClass;
    private final String message;
    private final String file;
    private final String otherFile;
    private final String reason;

    public FileExceptionDetails(Throwable t) {
        this.exceptionClass = t.getClass().getName();
        this.message = t.getMessage();

        if (t instanceof FileSystemException) {
            FileSystemException fse = (FileSystemException) t;
            this.file = fse.getFile();
            this.otherFile = fse.getOtherFile();
            this.reason = fse.getReason();
        } else {
            this.file = null;
            this.otherFile = null;
            this.reason = null;
        }
    }

    public String getExceptionClass() { return exceptionClass; }
    public String getMessage() { return message; }
    public String getFile() { return file; }
    public String getOtherFile() { return otherFile; }
    public String getReason() { return reason; }
}
```

---

### 16.3 Operation wrapper pattern

```java
@FunctionalInterface
public interface IoCallable<T> {
    T call() throws IOException;
}
```

```java
public final class FileOperationRunner {

    public static <T> T run(
            String operation,
            Path path,
            IoCallable<T> callable
    ) throws IOException {
        long start = System.nanoTime();
        try {
            T result = callable.call();
            long elapsedMs = (System.nanoTime() - start) / 1_000_000L;

            logSuccess(operation, path, elapsedMs);
            return result;
        } catch (IOException | RuntimeException e) {
            long elapsedMs = (System.nanoTime() - start) / 1_000_000L;
            FileFailureClass failureClass = FileFailureClassifier.classify(e);
            logFailure(operation, path, elapsedMs, failureClass, e);
            throw e;
        }
    }

    private static void logSuccess(String operation, Path path, long elapsedMs) {
        System.out.printf(
                "file_operation_success operation=%s path=%s elapsedMs=%d%n",
                operation,
                safePath(path),
                elapsedMs
        );
    }

    private static void logFailure(
            String operation,
            Path path,
            long elapsedMs,
            FileFailureClass failureClass,
            Throwable e
    ) {
        System.err.printf(
                "file_operation_failed operation=%s path=%s elapsedMs=%d classification=%s exception=%s message=%s%n",
                operation,
                safePath(path),
                elapsedMs,
                failureClass,
                e.getClass().getName(),
                e.getMessage()
        );
    }

    private static String safePath(Path path) {
        // In real systems, redact or replace with storage key/hash if path may contain sensitive data.
        return path == null ? "null" : path.toAbsolutePath().normalize().toString();
    }
}
```

Usage:

```java
Path input = Paths.get("/data/inbox/file.csv");

String content = FileOperationRunner.run(
        "read_text_file",
        input,
        () -> new String(Files.readAllBytes(input), StandardCharsets.UTF_8)
);
```

---

## 17. Detecting Orphan Files and Metadata Mismatch

A common production problem:

```text
DB says file exists, but filesystem does not.
Filesystem has file, but DB does not know it.
Temp file exists forever.
Processing claim exists but worker died.
```

### 17.1 Reconciliation categories

```text
METADATA_WITHOUT_FILE
FILE_WITHOUT_METADATA
STALE_TEMP_FILE
STALE_PROCESSING_FILE
DUPLICATE_CONTENT_HASH
QUARANTINE_WITHOUT_REASON
ARCHIVE_WITHOUT_RETENTION_RECORD
```

### 17.2 Example scan result model

```java
public final class ReconciliationIssue {
    private final String type;
    private final Path path;
    private final String fileId;
    private final String details;

    public ReconciliationIssue(String type, Path path, String fileId, String details) {
        this.type = type;
        this.path = path;
        this.fileId = fileId;
        this.details = details;
    }

    public String getType() { return type; }
    public Path getPath() { return path; }
    public String getFileId() { return fileId; }
    public String getDetails() { return details; }
}
```

### 17.3 Reconciliation output should be actionable

Bad:

```text
Found inconsistencies
```

Good:

```text
file_reconciliation_issue type=STALE_TEMP_FILE path=/data/staging/a.tmp ageSeconds=86400 action=delete_after_retention
file_reconciliation_issue type=FILE_WITHOUT_METADATA path=/data/ready/b.dat action=quarantine
file_reconciliation_issue type=METADATA_WITHOUT_FILE fileId=F123 action=mark_missing_and_alert
```

---

## 18. Alert Design

### 18.1 Alert symptoms, not every exception

Bad alert:

```text
Any IOException occurred
```

This creates noise.

Better alerts:

```text
- checksum mismatch > 0 in 5 minutes
- atomic move unsupported > 0 after deployment
- ready backlog oldest age > SLA
- filesystem usable space < 15%
- inode free < 10%
- quarantine count increased by > threshold
- watch overflow rate high
- AccessDeniedException after deployment
- reconciliation metadataWithoutFile > 0
```

### 18.2 Severity examples

| Signal | Severity | Reason |
|---|---:|---|
| Checksum mismatch | High | possible corruption/tampering |
| Atomic move unsupported | High | correctness invariant broken |
| Disk usage > 90% | High | imminent write failure |
| Oldest backlog age > SLA | Medium/High | processing stuck |
| Watch overflow | Medium | may be recovered by scan |
| FileAlreadyExists spike | Medium | duplicate/concurrency issue |
| Temporary AccessDenied small spike | Low/Medium | may be external scanner/lock |
| InvalidPath from user input | Low unless attack spike | validation/client/security signal |

---

## 19. Production Runbook Template

Use this as a reusable runbook for file incidents.

```markdown
# File Workload Incident Runbook

## 1. Identify Scope
- Which service/pod/node?
- Which operation? read/write/move/delete/watch/traverse/checksum?
- Which storage root/mount?
- Which tenant/case/batch?
- Since when?

## 2. Classify Failure
- Missing input?
- Permission denied?
- Capacity/inode issue?
- Atomicity unsupported?
- Lock conflict?
- Encoding/content issue?
- Integrity mismatch?
- Network storage issue?
- Runtime/container volume issue?

## 3. Check Metrics
- failure rate by classification
- operation latency p95/p99
- backlog count/bytes/oldest age
- filesystem usable bytes/inodes
- retry count/exhausted retries
- quarantine/dead-letter count

## 4. Reconstruct Timeline
- file received
- staged
- validated
- published
- claimed
- processed
- output generated
- archived/quarantined/deleted

## 5. Validate Invariants
- metadata exists for file?
- file exists for metadata?
- no stale processing claim?
- no temp file older than allowed?
- checksum matches?
- file only processed once?

## 6. Immediate Mitigation
- stop producer?
- pause workers?
- increase capacity?
- quarantine suspicious files?
- disable unsafe cleanup?
- run reconciliation scan?
- scale workers?

## 7. Recovery
- retry safe files
- requeue stale claims
- delete safe temp files
- restore missing files from archive/backup if possible
- mark unrecoverable files explicitly

## 8. Prevent Recurrence
- add missing metric/log
- add invariant check
- change retry policy
- change atomic publish design
- fix permission/mount config
- add startup reconciliation
- add capacity guardrail
```

---

## 20. Case Study 1: Atomic Publish Failure After Deployment

### Situation

After deployment, file intake starts failing:

```text
AtomicMoveNotSupportedException
```

### Weak interpretation

> Java file move failed. Retry more.

### Strong interpretation

`ATOMIC_MOVE` is a correctness contract. If unsupported, retrying probably will not fix it unless the failure is caused by transient provider state, which is uncommon.

### Investigation

Check:

```text
source path=/data/staging/a.tmp
target path=/mnt/ready/a.dat
source fileStore?
target fileStore?
container mount config changed?
PVC path changed?
```

Possible root cause:

```text
staging and ready directories moved to different mounts/FileStores.
```

### Fix

- Put temp/staging file in same directory or same FileStore as target.
- Fail fast if `ATOMIC_MOVE` unsupported.
- Add startup self-test:
  - create temp file in staging,
  - atomic move to target test directory,
  - cleanup,
  - fail readiness if unsupported.

### Preventive metric

```text
file_atomic_move_unsupported_total
```

---

## 21. Case Study 2: Consumer Reads Partial File

### Situation

Consumer sometimes fails parsing CSV:

```text
MalformedInputException
Unexpected end of file
```

### Root cause pattern

Producer writes directly into inbox:

```java
Path target = inbox.resolve(filename);
Files.write(target, bytes);
```

Consumer watches inbox and reads file as soon as `ENTRY_CREATE` or `ENTRY_MODIFY` appears.

### Why it fails

The file becomes visible before writing completes.

### Correct design

```text
producer writes to staging/.file.tmp
producer closes file
producer optionally fsyncs/validates
producer atomically moves to inbox/file.csv
consumer only reads inbox stable files
```

### Observability needed

```text
write_started
write_completed bytesWritten
atomic_publish_succeeded
consumer_read_started after publish
```

If consumer read timestamp is before publish timestamp, workflow is broken.

---

## 22. Case Study 3: Kubernetes Pod Cannot Write to Volume

### Situation

After switching to non-root container, app fails:

```text
AccessDeniedException: /data/export/report.csv
```

### Investigation

Check:

```text
runAsUser
runAsGroup
fsGroup
volume owner/group
mount readOnly
FileStore readonly
parent directory permission
```

### Root cause examples

- PVC files owned by root, app runs as UID 10001.
- `fsGroup` not configured.
- volume is ConfigMap/Secret and read-only.
- app writes to read-only root filesystem.

### Fix

- Configure security context correctly.
- Write generated files to writable volume, not ConfigMap/Secret path.
- Add startup write probe to expected writable directories.

### Startup probe example

```java
public static void assertWritableDirectory(Path dir) throws IOException {
    Files.createDirectories(dir);
    Path probe = Files.createTempFile(dir, ".write-probe-", ".tmp");
    try {
        Files.write(probe, new byte[] {1, 2, 3});
    } finally {
        Files.deleteIfExists(probe);
    }
}
```

---

## 23. Startup Self-Test for File Workloads

Before accepting traffic, validate assumptions.

### 23.1 What to test

```text
- required directory exists or can be created
- writable directories are writable
- temp and target are on same FileStore if atomic move required
- ATOMIC_MOVE works where required
- FileStore has enough usable space
- attribute views needed are supported
- symlink policy can be enforced
- startup reconciliation can scan required roots
```

### 23.2 Example: atomic move self-test

```java
public static void assertAtomicMoveSupported(Path targetDir) throws IOException {
    Files.createDirectories(targetDir);

    Path tmp = Files.createTempFile(targetDir, ".atomic-test-", ".tmp");
    Path target = targetDir.resolve(tmp.getFileName().toString() + ".moved");

    try {
        Files.write(tmp, new byte[] {1});
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
    } catch (AtomicMoveNotSupportedException e) {
        throw new IOException("Required atomic move is not supported in " + targetDir, e);
    } finally {
        Files.deleteIfExists(tmp);
        Files.deleteIfExists(target);
    }
}
```

### 23.3 Example: FileStore same-store check

```java
public static void assertSameFileStore(Path a, Path b) throws IOException {
    FileStore storeA = Files.getFileStore(a);
    FileStore storeB = Files.getFileStore(b);

    if (!storeA.equals(storeB)) {
        throw new IOException("Paths are on different FileStores: " + a + " and " + b);
    }
}
```

Caveat: `FileStore.equals` behavior is provider implementation detail. For production diagnostics, also log `store.name()` and `store.type()` when available.

---

## 24. Redaction Strategy

File observability often conflicts with privacy/security.

### 24.1 Path redaction options

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| Full path | `/data/case/123/passport.pdf` | easy debug | may leak PII |
| Root + storage key | `/data/uploads/01JY...bin` | safer | needs metadata lookup |
| Hash full path | `pathHash=sha256:...` | privacy | hard manual debug |
| Extension only | `.pdf` | safe | low diagnostic power |
| Redacted filename | `pass****.pdf` | partial context | still risky |

For regulated systems, prefer:

```text
storageKey + fileId + tenant/case ID if allowed + extension + size + hash
```

Avoid:

```text
original filename in every debug log
```

---

## 25. Common Anti-Patterns

### 25.1 Catch all `IOException` and return false

Bad:

```java
try {
    Files.delete(path);
    return true;
} catch (IOException e) {
    return false;
}
```

Why bad:

- loses reason,
- cannot distinguish missing vs permission vs directory not empty,
- no alert,
- no recovery.

Better:

```java
try {
    Files.delete(path);
    return DeleteResult.deleted();
} catch (NoSuchFileException e) {
    return DeleteResult.alreadyMissing();
} catch (AccessDeniedException e) {
    return DeleteResult.failed("permission_denied", e);
} catch (DirectoryNotEmptyException e) {
    return DeleteResult.failed("directory_not_empty", e);
}
```

---

### 25.2 Logging only exception message

Bad:

```java
log.error("File operation failed: {}", e.getMessage());
```

Better:

```java
log.error("file_operation_failed operation={} path={} classification={}",
        operation,
        safePath(path),
        FileFailureClassifier.classify(e),
        e);
```

The stack trace matters for resource lifecycle and unexpected code paths.

---

### 25.3 Treating watcher events as complete truth

Bad:

```text
On ENTRY_CREATE, process exactly that file.
No full scan.
No overflow handling.
No restart reconciliation.
```

Better:

```text
Watcher event schedules scan.
Overflow triggers full scan.
Startup always runs reconciliation scan.
```

---

### 25.4 No operation phase

Bad:

```text
file processing failed
```

Better:

```text
phase=VALIDATE_MAGIC
phase=COMPUTE_HASH
phase=ATOMIC_PUBLISH
phase=CLAIM
phase=PROCESS
phase=ARCHIVE
```

Without phase, you cannot know whether failure happened before or after side effects.

---

### 25.5 No durable state outside directory names

Bad:

```text
Directory name is the only state.
```

Directories are useful, but for complex workflows you often need metadata:

```text
fileId
state
hash
size
createdAt
publishedAt
claimedBy
attempt
lastError
quarantineReason
```

This makes incidents reconstructable.

---

## 26. Top 1% Checklist: File Observability

Before calling a file workflow production-grade, ask:

### Operation visibility

- [ ] Every file operation has structured log with operation and phase.
- [ ] Exceptions are classified, not only printed.
- [ ] `FileSystemException` file/otherFile/reason are captured.
- [ ] Attempts and retry decisions are logged.
- [ ] File sizes and byte counts are captured where relevant.

### Workflow visibility

- [ ] File state transitions are observable.
- [ ] There is a correlation ID from ingress to processing to output.
- [ ] Duplicate/idempotency key is logged.
- [ ] Quarantine/dead-letter has reason code.
- [ ] Startup reconciliation reports repair actions.

### Storage visibility

- [ ] Filesystem usable space is monitored.
- [ ] Inode exhaustion is considered.
- [ ] Backlog count/bytes/oldest age are monitored.
- [ ] Temp/staging/quarantine/archive sizes are tracked.
- [ ] Atomic move unsupported is alerted.

### Reliability visibility

- [ ] Watch overflow count is monitored.
- [ ] Retry exhaustion is monitored.
- [ ] Checksum mismatch is alerted.
- [ ] Lock conflict rate is monitored.
- [ ] Permission errors after deployment are alerted.

### Security/privacy

- [ ] Sensitive filenames/paths are redacted.
- [ ] Original filename is not blindly logged.
- [ ] User path validation failures are classified.
- [ ] Suspicious path traversal attempts are counted.

### Incident readiness

- [ ] There is a runbook.
- [ ] There is a way to reconstruct file timeline.
- [ ] There is a reconciliation command/job.
- [ ] There is a safe cleanup policy.
- [ ] There are startup self-tests for critical filesystem assumptions.

---

## 27. Summary Mental Model

File observability is not just logging path strings.

A serious file workload must expose:

```text
intent
  → operation
  → phase
  → path/storage identity
  → provider/filesystem context
  → bytes/metadata context
  → state transition
  → error classification
  → retry/recovery decision
  → invariant status
```

The recurring lesson:

> Filesystem bugs become expensive when the system cannot explain what happened.

Top engineers design file workflows so that even under failure, the system can answer:

```text
What was attempted?
What succeeded?
What failed?
Where did it fail?
Was there partial state?
Is retry safe?
What state should the file be in now?
What invariant was violated?
What action should operator take?
```

If your system can answer those questions quickly, troubleshooting becomes engineering, not archaeology.

---

## 28. What Comes Next

Part berikutnya:

```text
Part 32 — File Workflow Architecture Patterns
```

Kita akan naik dari observability ke architecture pattern:

- inbox/outbox directory pattern,
- staging → processing → done/error,
- atomic handoff via rename,
- claim pattern,
- lock file vs rename claim,
- idempotent processor,
- poison file handling,
- retry/quarantine,
- manifest + payload,
- multi-file transaction approximation,
- backpressure dan capacity control.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-file-filesystem-storage-engineering-part-30-performance-engineering.md">⬅️ Part 30 — Performance Engineering: Syscalls, Page Cache, Buffering, Batching, and Directory Scale</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-io-file-filesystem-storage-engineering-part-32-file-workflow-architecture-patterns.md">Learn Java IO File Filesystem Storage Engineering — Part 32 ➡️</a>
</div>
