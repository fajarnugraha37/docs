# Part 29 — Network Filesystems and Distributed Files: NFS, SMB, EFS, Object Storage Boundary

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `29 / 35`  
> Scope: Java 8–25, `java.nio.file`, local filesystem assumptions, NFS/SMB/EFS-like shared filesystems, object storage boundary, distributed-safe file workflows.

---

## 0. Why This Part Exists

Pada part sebelumnya, kita sudah membangun mental model file dari sisi Java API, path, provider, attributes, permission, locking, mmap, WAL, archive, provider abstraction, cross-platform behavior, dan container runtime.

Sekarang kita masuk ke layer yang sering membuat engineer senior sekalipun tersandung:

> **Kode Java yang benar di local disk belum tentu benar di network filesystem atau distributed storage.**

Masalahnya bukan Java-nya saja. Masalahnya adalah asumsi tersembunyi:

- rename dianggap selalu cepat dan atomic;
- lock dianggap berlaku lintas node;
- `exists()` dianggap langsung melihat state terbaru;
- `WatchService` dianggap reliable untuk shared directory;
- write dianggap langsung visible ke semua reader;
- `FileChannel.force()` dianggap berarti data sudah durable di seluruh storage cluster;
- object storage dianggap sama seperti folder biasa;
- mounted bucket dianggap filesystem POSIX penuh;
- shared volume dianggap aman untuk multi-writer tanpa protocol.

Di local filesystem, banyak asumsi tersebut sering “cukup benar”. Di network filesystem dan distributed storage, asumsi itu bisa runtuh karena ada layer tambahan:

```text
Java process
  → java.nio.file.Files / FileChannel / FileLock
  → FileSystemProvider
  → OS VFS layer
  → local client cache
  → network protocol client
  → network
  → server / metadata service / storage cluster
  → disk / object backend / replicated storage
```

Setiap layer bisa menambahkan:

- latency;
- caching;
- retry;
- timeout;
- stale metadata;
- partial visibility;
- lock coordination caveat;
- different failure mode;
- weaker ordering;
- provider-specific semantics.

Bagian ini bertujuan membentuk mental model top-level engineer:

> **Distributed file workflows harus dirancang sebagai protocol, bukan hanya sebagai rangkaian `Files.copy`, `Files.move`, dan `Files.delete`.**

---

## 1. Core Mental Model: Local File Is Not Distributed File

### 1.1 Local filesystem mental model

Pada local filesystem biasa:

```text
JVM → OS kernel → filesystem driver → local block device / SSD
```

Karakteristik umum:

- metadata relatif cepat;
- open/read/write/rename/delete relatif dekat dengan process;
- cache berada dalam kernel/page cache lokal;
- rename di filesystem yang sama biasanya murah;
- lock biasanya dikoordinasikan oleh OS lokal;
- failure domain relatif kecil: process, OS, disk, power loss.

Tetap tidak sempurna, tapi cukup deterministik untuk banyak workflow.

### 1.2 Network filesystem mental model

Pada network filesystem:

```text
JVM
  → OS filesystem API
  → network filesystem client
  → local cache
  → network
  → remote server / distributed metadata server
  → remote storage
```

Karakteristik berubah:

- metadata operation bisa mahal;
- `open`, `stat`, `list`, `rename`, `lock` bisa round-trip ke server;
- client bisa menyimpan cache;
- visibility antar client bisa tidak instant;
- lock behavior tergantung protocol dan mount option;
- latency tail bisa jauh lebih buruk;
- failure bisa berupa network partition, server failover, stale handle, timeout;
- operasi yang atomic secara lokal belum tentu memiliki recovery behavior yang sama saat server/network gagal.

### 1.3 Object storage mental model

Object storage seperti S3 bukan filesystem tradisional. Mental model dasarnya:

```text
bucket
  key -> object bytes + object metadata
```

Bukan:

```text
inode
  directory entry
  hard link
  byte-range update
  POSIX rename
  file descriptor
  advisory lock
```

Object storage biasanya unggul untuk:

- durability;
- scalability;
- large immutable-ish objects;
- lifecycle policy;
- cross-region replication;
- cheap storage;
- HTTP/API-based access.

Tetapi object storage bukan pengganti drop-in untuk POSIX filesystem bila aplikasi butuh:

- append in-place;
- byte-range mutation;
- directory rename atomic;
- POSIX lock;
- file descriptor semantics;
- `fsync` semantics;
- hard link;
- low-latency metadata-heavy workload.

AWS sendiri mendeskripsikan Amazon S3 sebagai **object storage service**, bukan POSIX filesystem. S3 kini memiliki strong read-after-write consistency untuk object operations, tetapi itu tidak menjadikannya local filesystem dengan semua POSIX semantics.

---

## 2. Java API View: Java Tidak Mengubah Semantics Storage

Java `Files`, `Path`, `FileChannel`, `FileLock`, dan `WatchService` menyediakan abstraction. Tetapi abstraction bukan magic.

### 2.1 `Files` delegates to provider

Operasi `Files` umumnya didelegasikan ke `FileSystemProvider` dari `Path` terkait. Artinya:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

bukan berarti Java sendiri melakukan atomic distributed transaction. Java meminta provider melakukan move sesuai kontrak provider. Jika provider/default filesystem tidak bisa menjamin atomic move, ia dapat melempar `AtomicMoveNotSupportedException`.

Mental model:

```text
Java guarantee = API contract + provider capability + OS/filesystem/protocol semantics
```

Bukan:

```text
Java guarantee = universal behavior di semua storage
```

### 2.2 `FileChannel.force()` bukan distributed commit protocol

`FileChannel.force(boolean metaData)` meminta update file dipaksa ke storage device. Pada local storage, ini bisa menjadi bagian penting dari durability design.

Tetapi pada network filesystem, ada layer tambahan:

```text
JVM buffer
  → OS page cache
  → network filesystem client
  → remote server
  → server cache
  → replicated/distributed backend
```

`force()` tetap penting, tapi harus dipahami sebagai:

> permintaan sinkronisasi melalui abstraction yang tersedia, bukan bukti universal bahwa seluruh distributed storage cluster sudah mencapai durable quorum dengan ordering yang kamu bayangkan.

Untuk aplikasi yang benar-benar butuh transactional durability lintas node, gunakan storage yang memang menyediakan transaction/consensus/commit protocol, misalnya database, log service, atau message broker.

### 2.3 `FileLock` tidak otomatis menjadi distributed lock sempurna

Java `FileLock` documentation secara eksplisit memperingatkan bahwa file lock cocok untuk koordinasi antar program, tetapi tidak cocok untuk mengontrol banyak thread dalam JVM yang sama karena lock dipegang atas nama seluruh JVM. Dokumentasi juga mencatat bahwa sifat lock advisory/mandatory dan behavior lock pada network filesystem bersifat system-dependent.

Artinya:

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.WRITE);
     FileLock lock = ch.lock()) {
    // critical section
}
```

bukan berarti:

```text
Semua node, semua OS, semua network filesystem, semua mount option,
dan semua client library pasti menghormati lock ini secara sempurna.
```

Yang benar:

```text
Lock works only as far as the underlying OS/filesystem/protocol/client/server honor it.
```

---

## 3. Network Filesystem Types: NFS, SMB, EFS-Like, Cluster FS

### 3.1 NFS

NFS adalah distributed file system protocol yang memungkinkan client mengakses file di server melalui network seolah-olah file tersebut lokal.

Karakteristik penting:

- common di Linux/Unix;
- remote mount tampak seperti directory biasa;
- NFSv3 dan NFSv4 berbeda behavior;
- metadata dan data bisa dicache client;
- cache consistency sering tidak sekuat local filesystem;
- locking bergantung pada versi/protocol/server/client configuration;
- network latency sangat memengaruhi metadata-heavy workload.

Linux `nfs(5)` mendokumentasikan bahwa NFS memakai weaker cache coherence dibanding cluster filesystem yang memiliki perfect cache coherence, dan menjelaskan close-to-open cache consistency sebagai model umum NFS.

### 3.2 SMB / CIFS

SMB umum di Windows environment dan enterprise file sharing.

Karakteristik penting:

- Windows-native sharing semantics;
- mendukung share mode dan opportunistic locks/leases;
- behavior delete/rename/open-file bisa berbeda dari Unix;
- permission model ACL lebih kompleks;
- Java tetap melihatnya melalui OS filesystem API jika mounted sebagai drive/share;
- latency dan server policy bisa memengaruhi behavior.

Dari sisi Java, path SMB bisa terlihat sebagai:

```text
Z:\shared\inbox\file.csv
```

atau UNC path:

```text
\\server\share\inbox\file.csv
```

Tetapi semantic layer di bawahnya tetap SMB, bukan local NTFS biasa.

### 3.3 AWS EFS-like managed NFS filesystem

Amazon EFS adalah managed elastic file system yang menggunakan NFS untuk Linux workloads. AWS mendokumentasikan fitur seperti hierarchical directory structure dan NFSv4 file locking, termasuk byte-range locking. EFS juga menggunakan Unix-style permission berdasarkan UID/GID dari NFS client, dengan access point untuk override UID/GID tertentu.

Ini penting untuk Java di Kubernetes/EKS:

```text
Java pod
  → Linux container mount
  → EFS CSI / NFS client
  → EFS service
```

Dari Java, `Path` tampak biasa. Tetapi behavior sebenarnya memiliki network filesystem characteristics:

- metadata operation bisa mahal;
- small file workload bisa buruk;
- open/close/list/stat bisa banyak round-trip;
- permission mengikuti UID/GID container;
- file locking ada, tapi harus diuji dengan pattern dan mount configuration aktual;
- throughput/latency dipengaruhi mode/performance profile/storage service.

AWS EFS performance tips bahkan menyarankan untuk meminimalkan round trip metadata/open-close pada small-file workload dan tidak menutup file secara tidak perlu bila masih akan digunakan dalam workflow yang sama.

### 3.4 Cluster filesystem

Cluster filesystem seperti GFS2, OCFS2, Lustre, CephFS, GPFS/Spectrum Scale, dan sejenisnya berusaha menyediakan shared filesystem dengan metadata coordination lintas node.

Tetapi tetap ada trade-off:

- stronger semantics biasanya lebih mahal;
- metadata server bisa menjadi bottleneck;
- locking/coherency protocol kompleks;
- failure recovery bisa memengaruhi latency;
- tuning spesifik filesystem sangat penting.

Java code tetap tidak boleh mengasumsikan semua cluster filesystem sama.

---

## 4. Close-to-Open Consistency: Kenapa Reader Bisa Melihat Versi Lama

Pada local filesystem, setelah writer menulis dan close file, reader pada host yang sama biasanya melihat perubahan dengan cepat.

Pada NFS-like filesystem, banyak implementasi memakai model yang disebut **close-to-open consistency**:

```text
Writer client:
  open file
  write bytes
  close file

Reader client:
  open file
  client checks/revalidates state with server
  read bytes
```

Konsekuensi:

- perubahan biasanya lebih reliable terlihat setelah writer close dan reader open ulang;
- reader yang sudah memegang open handle bisa melihat cache lama atau state yang bergantung implementasi;
- metadata cache bisa membuat `exists`, `size`, `lastModifiedTime`, directory listing tidak selalu langsung sinkron antar node;
- polling terlalu cepat bisa membaca state transisi.

Design implication:

> Jangan jadikan “file muncul di directory” sebagai satu-satunya bukti bahwa file sudah selesai ditulis.

Gunakan protocol:

```text
producer writes to staging temp file
producer closes and optionally forces file
producer renames to final ready name
consumer only processes final ready name
consumer optionally validates manifest/hash/size
```

Atau lebih eksplisit:

```text
payload.tmp
payload.data
payload.data.done
```

Tetapi marker file pun harus didesain hati-hati di shared storage.

---

## 5. Distributed File Failure Modes

### 5.1 Network timeout

Operasi file yang tampak sederhana:

```java
Files.size(path);
```

bisa melakukan network call. Failure bisa berupa:

- timeout;
- server not reachable;
- stale file handle;
- permission denied karena credential/access point berubah;
- retry internal;
- transient I/O exception.

Kode yang di local disk jarang gagal bisa sering gagal di network filesystem.

### 5.2 Stale metadata

Client A menulis file. Client B melakukan listing. B mungkin belum langsung melihat perubahan jika metadata cache belum invalidated.

Workflow yang buruk:

```java
if (Files.exists(doneFile)) {
    process(payload);
}
```

Masalah:

- `doneFile` bisa belum terlihat;
- payload metadata bisa stale;
- reader bisa membaca payload sebelum semua data visible;
- listing bisa miss entry sementara.

Solusi bukan sekadar sleep. Solusi adalah desain protocol dengan validation dan retry bounded.

### 5.3 Partial visibility

Jika producer menulis langsung ke final filename:

```text
/report/out.csv
```

consumer yang scanning `/report` bisa melihat file sebelum selesai ditulis.

Buruk:

```text
producer: write final.csv slowly
consumer: sees final.csv and reads half content
```

Baik:

```text
producer: write .final.csv.tmp-uuid
producer: close/force
producer: move .final.csv.tmp-uuid -> final.csv
consumer: only picks final.csv
```

Di network filesystem, rename biasanya lebih baik daripada direct write final, tetapi tetap harus diuji dengan storage/protocol aktual.

### 5.4 Split brain writers

Dua node percaya mereka berhak menulis file yang sama:

```text
node A writes invoice-2026-06.csv
node B writes invoice-2026-06.csv
```

Jika hanya mengandalkan `exists()`:

```java
if (!Files.exists(target)) {
    Files.writeString(target, content);
}
```

Maka race.

Lebih baik:

```java
Files.writeString(target, content, StandardOpenOption.CREATE_NEW);
```

atau claim protocol:

```text
worker tries atomic rename from inbox/file -> processing/file.workerId
only winner processes
```

Namun atomicity lintas network filesystem tetap harus diuji.

### 5.5 Server failover

Managed network filesystem bisa melakukan server-side failover. Dari aplikasi, ini bisa terlihat sebagai:

- latency spike;
- transient IOException;
- operation retry;
- stale handle;
- lock lost or lock recovery event;
- partial write failure.

Robust workflow harus memiliki:

- idempotency;
- retry classification;
- recovery scan;
- manifest/hash verification;
- poison/quarantine state.

---

## 6. Atomic Rename in Network Filesystems

### 6.1 Rename is the core handoff primitive

Dalam file workflow, rename/move sering dipakai sebagai handoff:

```text
staging/file.tmp -> inbox/file.ready
```

Di filesystem lokal yang sama, rename biasanya atomic: consumer melihat nama lama atau nama baru, bukan setengah rename.

Di Java:

```java
Files.move(tmp, ready, StandardCopyOption.ATOMIC_MOVE);
```

Jika tidak didukung, Java dapat melempar:

```java
AtomicMoveNotSupportedException
```

### 6.2 Tetapi atomic rename bukan distributed transaction

Atomic rename biasanya menjamin perubahan nama tunggal pada filesystem tertentu. Ia tidak otomatis menjamin:

- data sudah durable di storage backend;
- semua client langsung melihat nama baru;
- directory listing semua node langsung konsisten;
- multiple-file transaction;
- marker dan payload bergerak atomic bersama;
- lock/ownership update atomic bersama metadata lain.

Jika workflow butuh multi-file transaction:

```text
payload.csv
payload.sha256
payload.meta.json
```

Maka jangan menganggap tiga rename adalah satu transaction. Gunakan manifest protocol:

```text
write payload temp
write checksum temp
write manifest temp
rename manifest to .ready as last step
consumer only trusts manifest.ready
```

Manifest adalah commit record.

---

## 7. File Locks in Distributed Environments

### 7.1 File lock categories

Ada beberapa konsep lock:

```text
Java FileLock
OS file lock
NFS byte-range lock
SMB lease/oplock/share mode
application lock file
database row lock
Redis lease
ZooKeeper/etcd lock
```

Jangan campur mental modelnya.

### 7.2 Advisory vs mandatory

Banyak filesystem menggunakan advisory locks:

```text
Process A locks file.
Process B only respects lock if it also checks/uses locking protocol.
```

Jika process B mengabaikan lock dan langsung write, lock tidak selalu menghentikannya.

### 7.3 Lock in one JVM is not thread coordination

Java `FileLock` dipegang atas nama JVM. Jika satu thread memegang lock, thread lain dalam JVM yang sama tidak otomatis dicegah mengakses file. Untuk intra-JVM coordination, gunakan:

```java
synchronized
ReentrantLock
StampedLock
single-thread executor
actor/queue model
```

Untuk inter-process coordination, file lock bisa relevan. Untuk inter-node distributed coordination, file lock harus diuji dan sering kalah jelas dibanding database/Redis/etcd/ZooKeeper.

### 7.4 Lock file pattern

Lock file pattern:

```text
resource.lock
```

Worker mencoba create lock file dengan `CREATE_NEW`:

```java
Files.writeString(
    lockPath,
    ownerInfo,
    StandardOpenOption.CREATE_NEW,
    StandardOpenOption.WRITE
);
```

Kelebihan:

- sederhana;
- atomic create bisa menjadi claim primitive;
- mudah diobservasi.

Masalah:

- stale lock jika process crash;
- clock skew untuk TTL;
- delete stale lock bisa race;
- network filesystem visibility delay;
- owner mati tapi file masih ada;
- owner hidup tapi dianggap mati.

Jika memakai lock file, isi lock harus minimal memuat:

```json
{
  "ownerId": "worker-12",
  "hostname": "node-a",
  "pid": 12345,
  "createdAt": "2026-06-18T10:15:30Z",
  "heartbeatAt": "2026-06-18T10:16:00Z",
  "resource": "batch-20260618"
}
```

Tetapi heartbeat update sendiri menambah complexity. Pada titik itu, database/Redis lease sering lebih tepat.

### 7.5 Better distributed claim primitive: rename-claim

Untuk file intake, lebih baik sering memakai atomic rename sebagai claim:

```text
/inbox/a.csv
/processing/a.csv.worker-17
/done/a.csv
/error/a.csv
```

Worker mencoba:

```java
Files.move(inboxFile, processingFile, StandardCopyOption.ATOMIC_MOVE);
```

Jika berhasil, worker menang. Jika gagal karena file hilang, worker lain sudah claim.

Keunggulan:

- ownership tercermin di lokasi file;
- tidak perlu separate lock file;
- recovery scan bisa melihat `/processing` yang stuck;
- idempotency lebih mudah.

Tetapi tetap harus diuji pada filesystem shared yang digunakan.

---

## 8. WatchService on Network Filesystems

`WatchService` harus diperlakukan sebagai hint bahkan di local filesystem. Di network filesystem, risikonya lebih besar:

- events bisa tidak tersedia;
- events bisa datang dari local mount/client view saja;
- remote changes dari node lain bisa tidak memicu event sesuai ekspektasi;
- event bisa coalesced;
- event bisa overflow;
- event latency bisa besar;
- recursive watch tidak otomatis.

Desain yang benar:

```text
WatchService = wake-up signal
Periodic scan = source of truth
Manifest/status state = durable truth
```

Pattern:

```java
while (running) {
    WatchKey key = watcher.poll(30, TimeUnit.SECONDS);

    if (key != null) {
        for (WatchEvent<?> event : key.pollEvents()) {
            if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                markFullReconciliationRequired();
            }
        }
        key.reset();
    }

    reconcileInboxDirectory();
}
```

Jangan:

```text
Only process files that generated events.
```

Karena kalau event hilang, file tidak pernah diproses.

---

## 9. Metadata-Heavy Workloads Are Often the Real Bottleneck

Banyak engineer fokus pada throughput byte:

```text
MB/s, GB/s
```

Tetapi shared filesystem sering bottleneck di metadata:

```text
open
close
stat
exists
size
list
rename
chmod
readAttributes
create small file
delete small file
```

Contoh buruk:

```java
try (Stream<Path> files = Files.walk(root)) {
    files.filter(Files::isRegularFile)
         .filter(p -> Files.size(p) > 0)
         .filter(p -> Files.getLastModifiedTime(p).toMillis() > cutoff)
         .forEach(this::process);
}
```

Masalah:

- `isRegularFile` bisa stat;
- `size` bisa stat;
- `getLastModifiedTime` bisa stat;
- pada network FS, tiap metadata call bisa round-trip atau cache validation.

Lebih baik batch metadata:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

if (attrs.isRegularFile()
        && attrs.size() > 0
        && attrs.lastModifiedTime().toMillis() > cutoff) {
    process(path);
}
```

Dalam tree traversal, gunakan `visitFile(Path file, BasicFileAttributes attrs)` karena attributes sudah tersedia dari traversal.

---

## 10. Small File Problem

Network filesystem sangat rentan terhadap small-file problem:

```text
1,000,000 files × 2 KB
```

lebih buruk daripada:

```text
1 file × 2 GB
```

walau total byte sama.

Kenapa?

- setiap file butuh metadata;
- setiap open/close/list/stat butuh operasi tambahan;
- directory besar mahal;
- inode/metadata cache pressure;
- network round-trip mendominasi;
- lock/permission checks berulang;
- deletion cleanup mahal.

Mitigasi:

- bundle small files ke archive/segment;
- gunakan manifest + segment file;
- batch processing;
- hindari directory flat dengan jutaan file;
- gunakan sharded directory layout;
- gunakan database/object store untuk metadata;
- gunakan queue untuk event, bukan scan directory besar terus-menerus.

Sharded directory example:

```text
/storage/
  ab/
    cd/
      abcd1234...dat
  ef/
    01/
      ef011234...dat
```

---

## 11. Object Storage Boundary

### 11.1 Object storage operations are object operations

Object storage biasanya punya operasi seperti:

```text
PUT object
GET object
HEAD object
DELETE object
LIST prefix
COPY object
multipart upload
```

Bukan:

```text
open file descriptor
write bytes at offset
rename directory atomically
fsync directory
lock byte range
hard link
watch directory
chmod POSIX
```

### 11.2 “Folders” are often prefix illusion

Dalam S3-style object storage:

```text
reports/2026/06/file.csv
```

sering hanyalah key string dengan slash convention. Folder bukan inode directory seperti filesystem.

Konsekuensi:

- rename directory berarti copy/delete banyak objects;
- move object sering copy+delete;
- listing prefix punya pagination;
- directory marker object bisa ada/tidak;
- empty directory tidak natural;
- path normalization semantics berbeda;
- case sensitivity biasanya key-based;
- no POSIX permissions per directory entry.

### 11.3 Strong object consistency != POSIX filesystem

S3 strong consistency berarti setelah successful write/delete/list tertentu, object operations punya visibility consistency yang lebih kuat daripada era eventual consistency lama. Tetapi tetap tidak memberi POSIX semantics seperti:

- atomic rename;
- append-in-place;
- byte-range mutable update;
- advisory file lock;
- directory fsync;
- file handle lifecycle.

Jadi jangan terjebak:

```text
Strong consistency → filesystem replacement
```

Yang benar:

```text
Strong object consistency → better object-store correctness, still object-store semantics
```

### 11.4 Mounted object storage is a translation layer

Beberapa tool atau managed service bisa membuat object storage tampak seperti mounted filesystem. Ini berguna, tetapi harus diperlakukan sebagai compatibility layer.

Pertanyaan yang wajib dijawab:

- Apakah rename atomic atau copy-delete?
- Apakah write in-place didukung atau buffered lalu upload object?
- Apakah close berarti upload selesai?
- Bagaimana partial write/crash ditangani?
- Bagaimana directory listing dipetakan ke prefix listing?
- Apakah chmod/owner/lock hanya emulasi?
- Bagaimana cache invalidation antar node?
- Apakah `FileChannel.map` didukung?
- Apakah `WatchService` bekerja?
- Bagaimana failure saat multipart upload?

Jika jawabannya tidak jelas, jangan menjalankan workflow POSIX-critical di atas mounted object storage.

---

## 12. Decision Matrix: File System vs Object Storage vs Database vs Queue

### 12.1 Gunakan local filesystem jika

- data bersifat temporary node-local;
- tidak perlu dibaca node lain;
- latency rendah penting;
- file kecil untuk cache/scratch;
- kehilangan file saat pod/node mati bisa diterima;
- dapat regenerate.

Contoh:

```text
/tmp processing scratch
local cache
intermediate transform file
JVM dump file
temporary report generation
```

### 12.2 Gunakan shared filesystem jika

- aplikasi legacy butuh POSIX-ish file API;
- banyak process perlu shared directory;
- workflow berbasis file sudah mapan;
- rename/metadata semantics cukup untuk use case;
- throughput/latency sudah diuji;
- single-region/shared mount acceptable;
- locking/permission model dipahami.

Contoh:

```text
enterprise batch drop folder
shared generated reports
legacy integration directory
media processing shared workspace
```

### 12.3 Gunakan object storage jika

- object immutable/large;
- butuh durable scalable storage;
- access via API acceptable;
- metadata bisa dikelola terpisah;
- event notification bisa dipakai;
- rename tidak menjadi core operation;
- lifecycle/archive policy penting;
- multi-region/disaster recovery penting.

Contoh:

```text
uploaded documents
archive exports
data lake files
large generated reports
backups
immutable audit attachments
```

### 12.4 Gunakan database jika

- butuh transaction;
- butuh query metadata kuat;
- butuh state machine;
- butuh ownership/locking reliable;
- butuh exactly-once-ish workflow;
- butuh audit trail structured;
- butuh referential integrity.

Contoh:

```text
file processing status
ownership claim
deduplication index
manifest registry
workflow transitions
retry count
quarantine state
```

### 12.5 Gunakan queue/event stream jika

- butuh async decoupling;
- producer/consumer banyak;
- scan directory terlalu mahal;
- event ordering/partitioning penting;
- retry/dead letter dibutuhkan;
- work distribution penting.

Contoh:

```text
new file uploaded event
processing job dispatch
hash calculation tasks
notification after report generated
```

### 12.6 Top 1% design often combines them

Robust design sering hybrid:

```text
Object storage/shared FS = payload bytes
Database = metadata + state machine + idempotency key
Queue = async processing trigger
Local disk = scratch/temp work area
```

Contoh:

```text
Upload → object store
DB row → RECEIVED
Queue message → process object key
Worker downloads to local temp
Worker validates hash
Worker writes result to object store
DB transition → COMPLETED / FAILED / QUARANTINED
```

Ini lebih robust daripada:

```text
Put file in shared folder and hope watcher catches it.
```

---

## 13. Distributed-Safe File Intake Pattern

### 13.1 Problem

Kita punya shared directory:

```text
/inbox
/processing
/done
/error
/quarantine
```

Banyak producer menaruh file. Banyak worker memproses file. Storage bisa network filesystem.

### 13.2 Bad design

```java
try (Stream<Path> files = Files.list(inbox)) {
    files.forEach(file -> {
        process(file);
        Files.move(file, done.resolve(file.getFileName()));
    });
}
```

Masalah:

- worker lain bisa memproses file yang sama;
- file bisa masih ditulis producer;
- failure process meninggalkan ambiguity;
- tidak ada manifest/hash;
- partial file bisa diproses;
- retry tidak idempotent;
- status hanya implicit dari directory;
- error handling lemah.

### 13.3 Better directory protocol

Producer:

```text
1. write /inbox/.file.csv.tmp-uuid
2. close and force if required
3. write /inbox/.file.csv.meta.tmp-uuid
4. move metadata temp to /inbox/file.csv.ready.json
5. move payload temp to /inbox/file.csv
```

Atau lebih aman:

```text
1. write payload under staging name
2. write manifest referencing payload name, size, hash
3. manifest ready is the only commit signal
```

Consumer:

```text
1. scan for *.ready.json
2. parse manifest
3. validate referenced payload exists
4. atomically claim manifest by move to /processing
5. process payload
6. write result/status
7. move manifest to /done or /error
```

### 13.4 Claim by atomic move

```java
static boolean tryClaim(Path readyManifest, Path processingManifest) throws IOException {
    try {
        Files.move(
            readyManifest,
            processingManifest,
            StandardCopyOption.ATOMIC_MOVE
        );
        return true;
    } catch (NoSuchFileException e) {
        return false; // already claimed/deleted by another worker
    } catch (AtomicMoveNotSupportedException e) {
        // Fail closed unless your fallback protocol is explicitly designed and tested.
        throw e;
    }
}
```

Why fail closed?

Karena fallback non-atomic move bisa membuat duplicate processing. Jika duplicate processing aman karena idempotency kuat, boleh fallback. Jika tidak, jangan.

### 13.5 Recovery scan

Pada startup atau periodik:

```text
scan /processing
for each claimed manifest:
  if heartbeat fresh:
      ignore
  else if owner dead and timeout exceeded:
      move back to /inbox or /quarantine
```

Tapi timeout-based recovery harus hati-hati:

- worker lambat bukan berarti mati;
- clock skew;
- network partition;
- file visible delay;
- duplicate processing risk.

Lebih kuat jika state disimpan di database dengan lease token.

---

## 14. Database-Backed File Workflow Pattern

Untuk enterprise/regulatory systems, biasanya lebih defensible jika file workflow punya DB state machine.

### 14.1 State model

```text
RECEIVED
VALIDATING
VALIDATED
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
QUARANTINED
ARCHIVED
```

### 14.2 Table sketch

```sql
CREATE TABLE file_job (
    id                 VARCHAR(64) PRIMARY KEY,
    storage_location   VARCHAR(1024) NOT NULL,
    original_filename  VARCHAR(512),
    content_sha256     CHAR(64),
    content_size       BIGINT,
    state              VARCHAR(40) NOT NULL,
    lease_owner        VARCHAR(128),
    lease_until        TIMESTAMP,
    retry_count        INTEGER NOT NULL,
    created_at         TIMESTAMP NOT NULL,
    updated_at         TIMESTAMP NOT NULL,
    last_error_code    VARCHAR(128),
    last_error_message VARCHAR(2048)
);
```

### 14.3 Claim with database CAS

```sql
UPDATE file_job
SET state = 'PROCESSING',
    lease_owner = ?,
    lease_until = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND state = 'VALIDATED'
  AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP);
```

If rows updated = 1, worker owns it.

Advantages:

- clear audit trail;
- recovery easier;
- retries controlled;
- file bytes and workflow state separated;
- duplicate processing preventable;
- operational query possible;
- legal/regulatory defensibility better.

The file system then becomes payload store, not workflow truth.

---

## 15. Java Patterns for Network Filesystem Robustness

### 15.1 Avoid check-then-act

Bad:

```java
if (!Files.exists(target)) {
    Files.copy(source, target);
}
```

Better:

```java
try {
    Files.copy(source, target); // fails if target exists by default
} catch (FileAlreadyExistsException e) {
    // handle duplicate explicitly
}
```

For create:

```java
Files.writeString(
    target,
    content,
    StandardCharsets.UTF_8,
    StandardOpenOption.CREATE_NEW,
    StandardOpenOption.WRITE
);
```

### 15.2 Validate after transfer

For large copy:

```java
Files.copy(source, tmp, StandardCopyOption.REPLACE_EXISTING);
long actualSize = Files.size(tmp);
if (actualSize != expectedSize) {
    throw new IOException("Size mismatch after copy");
}
```

For stronger validation:

```java
String actualHash = sha256(tmp);
if (!actualHash.equals(expectedHash)) {
    throw new IOException("Hash mismatch after copy");
}
```

### 15.3 Use stable ready signal

Bad:

```text
consumer processes any file ending .csv
```

Better:

```text
consumer processes manifest .ready.json only
manifest contains expected payload name, size, hash, schema, producer ID
```

### 15.4 Separate payload and state

Bad:

```text
state = inferred from filename only
```

Better:

```text
payload = file/object
state = DB row or manifest with lifecycle directory
```

### 15.5 Bounded retry with classification

Not all IOException is equal.

Classify:

```text
transient:
  timeout
  connection reset
  stale handle
  temporary access issue
  storage throttling

permanent:
  permission denied
  invalid path
  malformed payload
  hash mismatch
  unsupported atomic move
  missing required file after retry window
```

Pseudo-code:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        processFile(path);
        return;
    } catch (IOException e) {
        if (!isProbablyTransient(e) || attempt == maxAttempts) {
            throw e;
        }
        sleep(backoff(attempt));
    }
}
```

Caution:

> Retry is safe only if operation is idempotent or guarded by state/claim token.

---

## 16. Directory Layout for Shared Filesystems

### 16.1 Avoid hot flat directories

Bad:

```text
/inbox/
  1.csv
  2.csv
  ...
  5_000_000.csv
```

Better:

```text
/inbox/
  2026/
    06/
      18/
        10/
          file1.ready.json
          file2.ready.json
```

Or hash sharding:

```text
/inbox/
  ab/
    cd/
      job-abcd....ready.json
```

### 16.2 Separate lifecycle directories

```text
/root
  /incoming       producer writes temp only
  /ready          committed jobs
  /processing     claimed jobs
  /done           completed jobs
  /error          retryable failures
  /quarantine     invalid or suspicious files
  /archive        retention-managed completed payloads
```

### 16.3 Avoid renaming huge directory trees

Directory rename can be cheap in local filesystem, but in distributed systems or object-storage-backed mounts it may be expensive or unsupported. Prefer immutable object keys or manifest state transitions over moving large trees.

---

## 17. Observability for Network File Workloads

Metrics that matter:

```text
file.operation.count{op="open|read|write|rename|delete|stat|list"}
file.operation.latency
file.operation.error.count{exception="..."}
file.bytes.read
file.bytes.written
file.retry.count
file.claim.success.count
file.claim.conflict.count
file.hash.mismatch.count
file.processing.duration
file.processing.age.in.inbox
file.processing.age.in.processing
filesystem.usable.bytes
filesystem.inode.free
watcher.overflow.count
reconciliation.scan.duration
reconciliation.files.discovered
```

Logs should include:

```text
jobId
payloadId
path / storage key
operation
source state
target state
attempt
workerId
lease token
hash
size
duration
exception class
```

Example structured log:

```json
{
  "event": "file.claimed",
  "jobId": "job-20260618-001",
  "workerId": "worker-a-7",
  "source": "/ready/job-20260618-001.ready.json",
  "target": "/processing/job-20260618-001.worker-a-7.json",
  "durationMs": 18
}
```

Without observability, distributed file bugs become ghost stories.

---

## 18. Security in Network File Workflows

Network/shared storage introduces extra risks:

- another client can replace file between validation and use;
- symlink can be introduced by another user/process;
- permissions can differ by UID/GID mapping;
- stale files can be processed by wrong environment;
- object key prefix can be abused like path traversal;
- mounted shares can expose more directories than intended;
- producer identity may be unclear.

Rules:

1. Treat shared directory as untrusted input boundary.
2. Validate real path containment where applicable.
3. Use random internal storage names.
4. Do not trust original filename.
5. Use manifest with size/hash/content type/schema.
6. Do not follow symlinks unless explicitly allowed.
7. Use least-privilege mount/access point.
8. Separate read/write permissions per component.
9. Do not let consumer delete arbitrary producer-controlled path.
10. Quarantine suspicious files instead of processing them.

---

## 19. Practical Java Example: Shared Directory Processor Skeleton

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.UUID;
import java.util.stream.Stream;

import static java.nio.file.StandardCopyOption.ATOMIC_MOVE;
import static java.nio.file.StandardOpenOption.CREATE_NEW;
import static java.nio.file.StandardOpenOption.WRITE;

public final class SharedDirectoryProcessor {
    private final Path readyDir;
    private final Path processingDir;
    private final Path doneDir;
    private final Path errorDir;
    private final String workerId;

    public SharedDirectoryProcessor(Path root, String workerId) {
        this.readyDir = root.resolve("ready");
        this.processingDir = root.resolve("processing");
        this.doneDir = root.resolve("done");
        this.errorDir = root.resolve("error");
        this.workerId = workerId;
    }

    public void scanOnce() throws IOException {
        try (Stream<Path> stream = Files.list(readyDir)) {
            stream
                .filter(p -> p.getFileName().toString().endsWith(".ready.json"))
                .forEach(this::tryProcessManifestUnchecked);
        }
    }

    private void tryProcessManifestUnchecked(Path readyManifest) {
        try {
            tryProcessManifest(readyManifest);
        } catch (IOException e) {
            // In real systems: structured log + metrics + retry classification.
            System.err.println("Failed to process " + readyManifest + ": " + e);
        }
    }

    private void tryProcessManifest(Path readyManifest) throws IOException {
        Path processingManifest = processingDir.resolve(
            readyManifest.getFileName() + "." + workerId + "." + UUID.randomUUID()
        );

        if (!claim(readyManifest, processingManifest)) {
            return;
        }

        try {
            String manifest = Files.readString(processingManifest, StandardCharsets.UTF_8);

            // In real systems:
            // - parse JSON
            // - validate payload path containment
            // - validate expected size/hash
            // - process idempotently
            process(manifest);

            Path doneManifest = doneDir.resolve(stripWorkerSuffix(processingManifest.getFileName().toString()));
            Files.move(processingManifest, doneManifest, ATOMIC_MOVE);
        } catch (Exception e) {
            Path errorManifest = errorDir.resolve(processingManifest.getFileName().toString() + ".failed");
            String failure = "failedAt=" + Instant.now() + "\nworker=" + workerId + "\nerror=" + e + "\n";

            Path failureNote = processingManifest.resolveSibling(processingManifest.getFileName() + ".failure.txt");
            Files.writeString(failureNote, failure, StandardCharsets.UTF_8, CREATE_NEW, WRITE);

            try {
                Files.move(processingManifest, errorManifest, ATOMIC_MOVE);
            } catch (IOException moveError) {
                e.addSuppressed(moveError);
            }

            if (e instanceof IOException io) {
                throw io;
            }
            throw new IOException(e);
        }
    }

    private boolean claim(Path readyManifest, Path processingManifest) throws IOException {
        try {
            Files.move(readyManifest, processingManifest, ATOMIC_MOVE);
            return true;
        } catch (NoSuchFileException e) {
            return false;
        } catch (AtomicMoveNotSupportedException e) {
            // Do not silently fallback unless duplicate processing is safe.
            throw e;
        }
    }

    private void process(String manifest) throws IOException {
        // Placeholder for real processing.
        // Must be idempotent or guarded by external state.
    }

    private String stripWorkerSuffix(String fileName) {
        int index = fileName.indexOf(".ready.json");
        if (index >= 0) {
            return fileName.substring(0, index + ".ready.json".length());
        }
        return fileName;
    }
}
```

Important limitation:

> This skeleton is safer than direct processing, but still not enough for high-value workflows unless paired with idempotency, manifest validation, recovery scan, and tested storage semantics.

---

## 20. Practical Java Example: Manifest-Based Producer

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

import static java.nio.file.StandardCopyOption.ATOMIC_MOVE;
import static java.nio.file.StandardOpenOption.*;

public final class ManifestProducer {
    private final Path stagingDir;
    private final Path readyDir;

    public ManifestProducer(Path root) {
        this.stagingDir = root.resolve("staging");
        this.readyDir = root.resolve("ready");
    }

    public void publish(String logicalName, byte[] payload) throws IOException {
        String id = UUID.randomUUID().toString();

        Path tmpPayload = stagingDir.resolve("." + logicalName + "." + id + ".tmp");
        Path finalPayload = readyDir.resolve(logicalName);
        Path tmpManifest = stagingDir.resolve("." + logicalName + "." + id + ".manifest.tmp");
        Path finalManifest = readyDir.resolve(logicalName + ".ready.json");

        writeAndForce(tmpPayload, payload);

        String hash = sha256(payload);
        String manifest = """
            {
              "payload": "%s",
              "size": %d,
              "sha256": "%s"
            }
            """.formatted(logicalName, payload.length, hash);

        writeAndForce(tmpManifest, manifest.getBytes(StandardCharsets.UTF_8));

        // Move payload first. Manifest is the commit signal.
        Files.move(tmpPayload, finalPayload, ATOMIC_MOVE);
        Files.move(tmpManifest, finalManifest, ATOMIC_MOVE);
    }

    private static void writeAndForce(Path path, byte[] bytes) throws IOException {
        try (FileChannel channel = FileChannel.open(path, CREATE_NEW, WRITE)) {
            channel.write(ByteBuffer.wrap(bytes));
            channel.force(true);
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

Java 8 note:

- `HexFormat` is Java 17+.
- For Java 8, encode hex manually or use a small helper.
- `Files.writeString`/`readString` are Java 11+.
- For Java 8, use `Files.write(path, bytes, options...)` and `new String(Files.readAllBytes(path), charset)` for bounded-size files.

---

## 21. Red Flags: When Shared Filesystem Is the Wrong Tool

Use something else if you see these requirements:

```text
multiple writers update same file concurrently
must never process duplicate file
must support exactly-once processing
must perform multi-file atomic transaction
must query millions of file statuses
must coordinate across regions
must maintain strict audit lifecycle
must support high metadata operation rate
must rely on file watcher for correctness
must do frequent tiny appends from many nodes
must use mounted object storage as POSIX replacement
```

Better options:

- database transaction for state;
- queue for work distribution;
- object store for immutable bytes;
- append-only log/event stream for ordered ingestion;
- distributed coordination service for lease/leader election;
- local disk for scratch;
- shared filesystem only for compatibility payload exchange.

---

## 22. Failure Matrix

| Scenario | Local FS expectation | Network/distributed risk | Safer design |
|---|---|---|---|
| Producer writes final filename directly | Consumer reads full file after write | Consumer sees partial file | Write temp, rename final, manifest ready |
| Consumer uses `exists()` | Accurate enough often | Stale metadata/cache | Attempt operation, handle exception, retry/reconcile |
| Multiple workers scan same directory | Low race if single worker | Duplicate claim | Atomic rename claim or DB CAS |
| `WatchService` event received | Process changed file | Event missed/coalesced/overflow | Watch as hint + periodic reconciliation |
| File lock acquired | Exclusive enough locally | Advisory/system-dependent/network caveat | DB/Redis/etcd lease or tested lock protocol |
| Move file | Fast metadata update | Unsupported atomic move/cross-device/copy-delete | Require `ATOMIC_MOVE`, fail closed, validate |
| Directory has millions files | Maybe slow | Very slow metadata/list | Shard dirs, DB index, queue events |
| Object store mounted as FS | Works for simple read/write | Rename/lock/fsync semantics mismatch | Use object API + DB metadata |
| Retry after IOException | Often safe-ish | Duplicate side effects | Idempotency key + state machine |
| Delete after process | Removes file | Other node may still read/hold cache | Tombstone/archive state, delayed cleanup |

---

## 23. Testing Strategy

You cannot reason your way into certainty for distributed filesystem behavior. You must test on the actual storage class/protocol/mount option.

### 23.1 Tests to run

1. Atomic move support:

```java
Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
```

Test same directory, same filesystem, cross-directory same mount, cross-mount.

2. Concurrent claim:

```text
100 workers attempt to claim same 10,000 files
assert each file processed once
```

3. Partial write detection:

```text
producer writes slowly
consumer scans aggressively
assert consumer never processes temp/incomplete file
```

4. Lock behavior:

```text
node A locks file
node B attempts lock and direct write
observe actual behavior
```

5. Visibility delay:

```text
node A writes/renames
node B measures time until visible by list/open/stat
```

6. Metadata scale:

```text
100k / 1M file listing/stat/delete benchmark
```

7. Failure injection:

```text
kill worker after claim
network interruption
storage throttle
pod restart
node restart
```

8. Watcher reliability:

```text
generate bursts from another node
verify watcher event count vs reconciliation discovery
```

### 23.2 Test result should become architecture input

Do not leave result as tribal knowledge. Capture:

```text
Storage type:
Mount options:
Java version:
OS/kernel:
Container runtime:
Observed atomic move support:
Observed visibility latency p50/p95/p99:
Max safe directory size:
Lock behavior:
Watcher behavior:
Failure behavior:
Recommended workflow pattern:
```

---

## 24. Top 1% Mental Models

### 24.1 File operation is protocol operation

In distributed storage, every file operation is effectively a protocol message.

```text
Files.size(path)
```

may mean:

```text
ask local cache or remote metadata server for size
```

### 24.2 Directory is not always cheap

Directory listing can be one of the most expensive operations in large shared systems.

### 24.3 Rename is useful but not universal transaction

Use rename as a primitive, not as a magical distributed transaction.

### 24.4 Watcher is not source of truth

Watcher wakes you up. Reconciliation tells you truth.

### 24.5 Lock is not coordination unless everyone shares the same lock contract

A lock ignored by one participant is not a lock. It is decoration.

### 24.6 Object storage is not bad; it is different

Object storage is excellent when used with object semantics. It becomes dangerous when forced to behave like POSIX filesystem without validating semantics.

### 24.7 Workflow truth should be explicit

If business correctness matters, state should be explicit:

```text
database row
manifest commit record
append-only log
state transition table
```

Not inferred from “file happened to be in folder X”.

---

## 25. Production Checklist

Before deploying Java file workflow on network/distributed storage, answer:

### Semantics

- Does `ATOMIC_MOVE` work on the target directories?
- Is move same-filesystem or cross-filesystem?
- Is rename visible immediately to all clients?
- Is directory listing consistent enough?
- Are file size and modified time reliable for readiness?
- Does `force()` mean what you need on this storage?

### Concurrency

- Can two workers process the same file?
- How is ownership claimed?
- Is claim atomic?
- Is duplicate processing idempotent?
- How are stale claims recovered?
- Is lock behavior tested across nodes?

### Failure

- What happens if producer dies mid-write?
- What happens if worker dies after claim?
- What happens if move succeeds but status update fails?
- What happens if DB update succeeds but file move fails?
- What happens during storage outage?
- What happens during network partition?

### Performance

- How many files per directory?
- How many metadata ops per second?
- What are p95/p99 latencies for list/stat/open/rename?
- Are files too small?
- Is scan interval acceptable?
- Is there backpressure?

### Security

- Is shared directory trusted?
- Are symlinks allowed?
- Is path containment validated?
- Are original filenames sanitized?
- Is UID/GID mapping correct?
- Are permissions least privilege?
- Can one tenant overwrite another tenant’s file?

### Observability

- Are file operation latencies measured?
- Are retries visible?
- Are stuck files visible?
- Are watcher overflows visible?
- Are duplicate claims visible?
- Is reconciliation result logged?

---

## 26. Java 8–25 Compatibility Notes

| Topic | Java 8 | Java 9–10 | Java 11+ | Java 17+ | Java 25 |
|---|---:|---:|---:|---:|---:|
| `Path`, `Files`, NIO.2 | Yes | Yes | Yes | Yes | Yes |
| `Files.readString/writeString` | No | No | Yes | Yes | Yes |
| `Path.of` | No | No? introduced after Java 8 | Yes | Yes | Yes |
| `HexFormat` | No | No | No | Yes | Yes |
| `FileChannel.force` | Yes | Yes | Yes | Yes | Yes |
| `StandardCopyOption.ATOMIC_MOVE` | Yes | Yes | Yes | Yes | Yes |
| `FileLock` | Yes | Yes | Yes | Yes | Yes |
| `WatchService` | Yes | Yes | Yes | Yes | Yes |

Guidance:

- Untuk library yang harus support Java 8, gunakan `Paths.get(...)` dan `Files.readAllBytes/write`.
- Untuk Java 11+, `Files.readString/writeString` boleh dipakai untuk bounded-size text file.
- Untuk Java 17+, `HexFormat` memudahkan encoding hash.
- Untuk Java 25, tetap pahami bahwa API modern tidak menghapus provider/storage-specific behavior.

---

## 27. Summary

Network filesystem dan distributed storage mengubah problem file engineering dari sekadar API usage menjadi distributed protocol design.

Local mindset:

```text
write file
check exists
process file
move file
```

Production distributed mindset:

```text
write payload safely
publish commit signal
claim atomically
validate manifest/hash
process idempotently
persist explicit state
recover stuck work
reconcile periodically
observe everything
```

Core conclusion:

> **Filesystem sharing is not workflow coordination. Shared files need explicit protocol, explicit state, explicit idempotency, and tested storage semantics.**

Jika kamu memahami boundary ini, kamu akan jauh lebih siap membangun file-processing systems yang benar di Java, terutama di enterprise, cloud, Kubernetes, dan regulatory environments.

---

## 28. References

- Oracle Java SE 25 — `java.nio.file.Files`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
- Oracle Java SE 25 — `java.nio.channels.FileLock`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileLock.html
- Oracle Java SE 8 — `java.nio.channels.FileChannel`: https://docs.oracle.com/javase/8/docs/api/java/nio/channels/FileChannel.html
- Linux man-pages — `nfs(5)`: https://man7.org/linux/man-pages/man5/nfs.5.html
- The Open Group — NFS Version 3 Protocol Specification, caching policies: https://pubs.opengroup.org/onlinepubs/9629799/chap12.htm
- AWS — Amazon EFS documentation overview: https://aws.amazon.com/documentation-overview/efs/
- AWS — Amazon EFS features: https://docs.aws.amazon.com/efs/latest/ug/features.html
- AWS — Amazon EFS NFS permissions: https://docs.aws.amazon.com/efs/latest/ug/accessing-fs-nfs-permissions.html
- AWS — Amazon EFS performance tips: https://docs.aws.amazon.com/efs/latest/ug/performance-tips.html
- AWS — Amazon S3 overview: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html
- AWS — Amazon S3 strong consistency: https://aws.amazon.com/s3/consistency/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 28 — Containers, Cloud Runtime, Kubernetes Volumes, and Ephemeral Files](./learn-java-io-file-filesystem-storage-engineering-part-28-containers-cloud-runtime-kubernetes-volumes-ephemeral-files.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 30](./learn-java-io-file-filesystem-storage-engineering-part-30-performance-engineering.md)

</div>