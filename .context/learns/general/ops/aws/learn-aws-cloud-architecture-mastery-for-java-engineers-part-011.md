# learn-aws-cloud-architecture-mastery-for-java-engineers-part-011.md

# Part 011 — Storage Architecture: S3, EBS, EFS, FSx, dan Object Lifecycle

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audiens utama: Java software engineer / tech lead  
> Fokus: AWS storage architecture untuk workload produksi  
> Tujuan: memahami storage bukan sebagai “tempat menyimpan file”, tetapi sebagai keputusan durability, access pattern, lifecycle, security, cost, failure mode, dan operational contract.

---

## 0. Posisi Part Ini di Seri AWS

Sebelumnya kita sudah membangun fondasi:

- AWS sebagai programmable infrastructure.
- Account, IAM, runtime identity, dan credential flow.
- VPC, traffic entry, compute choice.
- EC2, ECS/Fargate, Lambda sebagai compute runtime.

Sekarang kita masuk ke storage.

Storage sering terlihat sederhana: simpan object di S3, attach volume EBS, mount EFS, pakai FSx jika butuh file system tertentu. Tetapi dalam sistem produksi, storage adalah salah satu sumber keputusan arsitektur yang paling berpengaruh terhadap:

- durability;
- consistency;
- latency;
- throughput;
- isolation;
- auditability;
- backup/restore;
- disaster recovery;
- encryption;
- data retention;
- lifecycle cost;
- legal hold;
- compliance;
- blast radius;
- incident recovery.

Top engineer tidak memilih storage berdasarkan nama service. Mereka memilih berdasarkan pertanyaan yang lebih struktural:

> “Apa bentuk datanya, siapa yang mengakses, seberapa sering, lewat protokol apa, seberapa tahan harusnya data ini, berapa lama disimpan, bagaimana dihapus, bagaimana dipulihkan, bagaimana diaudit, dan apa failure mode-nya?”

Part ini membahas storage AWS dari sudut pandang desain sistem, bukan tutorial klik console.

---

## 1. Mental Model Utama: Storage Bukan Satu Dimensi

Banyak engineer pemula mengklasifikasikan storage seperti ini:

- S3 untuk file.
- EBS untuk disk.
- EFS untuk shared disk.
- FSx untuk enterprise file system.

Itu benar secara kasar, tetapi belum cukup untuk desain produksi.

Storage harus dipahami minimal dalam beberapa dimensi:

| Dimensi | Pertanyaan Desain |
|---|---|
| Data shape | Object, block, file, archive, log, backup, artifact? |
| Access protocol | HTTP API, block device, NFS, SMB, Lustre, application API? |
| Access pattern | Sequential, random, large object, small file, append-like, read-heavy, write-heavy? |
| Sharing model | One writer, many readers, many writers, shared POSIX semantics? |
| Consistency | Setelah write, kapan reader melihat data? |
| Durability | Berapa besar toleransi kehilangan data? |
| Availability | Harus tersedia dalam satu AZ, multi-AZ, multi-region? |
| Latency | Milidetik rendah, throughput tinggi, batch, archive retrieval? |
| Lifecycle | Hot, warm, cold, archive, delete, retain, legal hold? |
| Security | Encryption, access policy, object-level control, tenant isolation? |
| Cost | Storage GB, requests, retrieval, data transfer, lifecycle transition, operations? |
| Recovery | Snapshot, versioning, replication, backup, restore drill? |
| Compliance | Retention, immutability, audit trail, deletion proof? |

Kesalahan desain storage sering terjadi ketika satu dimensi dipakai untuk menggantikan semua dimensi. Contoh:

- “S3 murah, maka semua file taruh S3” tanpa mempertimbangkan request cost, object count, lifecycle, presigned URL security, dan large upload retry.
- “EFS bisa dishare, maka semua service mount EFS” tanpa mempertimbangkan latency, throughput mode, NFS semantics, dan coupling antar service.
- “EBS cepat, maka cocok untuk semua state” tanpa mempertimbangkan AZ binding dan recovery path.
- “Object Lock aman, maka cukup untuk compliance” tanpa memahami versioning, retention mode, governance bypass, legal hold, dan operational evidence.

---

## 2. Storage Primitive: Object, Block, dan File

AWS storage utama dapat dikelompokkan menjadi tiga primitive besar.

### 2.1 Object Storage — Amazon S3

Object storage menyimpan data sebagai object dalam bucket.

Object biasanya memiliki:

- key;
- content/body;
- metadata;
- version ID jika versioning aktif;
- tags;
- ACL/policy-related access semantics;
- encryption metadata;
- lifecycle state.

Object storage cocok untuk:

- upload/download dokumen;
- image/video/media;
- backup;
- data lake;
- static asset;
- artifact build;
- event input/output;
- immutable evidence;
- archive;
- inter-service data handoff berbasis object.

Object storage tidak cocok untuk:

- random block-level mutation;
- low-latency shared file lock semantics;
- database data directory;
- frequent tiny append in-place;
- POSIX filesystem assumption tanpa adapter.

S3 adalah API storage, bukan disk.

Mental model:

```text
Application
   |
   | HTTPS API: PUT/GET/DELETE/LIST/HEAD
   v
S3 bucket
   |
   +-- object key: cases/2026/06/case-123/evidence-001.pdf
   +-- metadata
   +-- tags
   +-- version
   +-- lifecycle
   +-- encryption
```

S3 menyediakan strong read-after-write consistency untuk PUT dan DELETE object di semua AWS Regions. Artinya, setelah PUT berhasil, GET/LIST berikutnya dapat melihat perubahan tersebut sesuai model S3 modern. Ini sangat berbeda dari asumsi lama bahwa S3 selalu eventual untuk read-after-write. Namun, strong consistency bukan berarti transaksi multi-object atau locking kompleks.

### 2.2 Block Storage — Amazon EBS

Block storage menyajikan volume seperti disk mentah yang di-attach ke EC2.

EBS cocok untuk:

- root volume EC2;
- database volume di EC2;
- filesystem lokal aplikasi;
- low-latency random I/O;
- workload yang butuh block device;
- state yang lifecycle-nya melekat ke instance/fleet EC2 tertentu.

EBS tidak cocok untuk:

- sharing multi-instance secara umum;
- object distribution;
- multi-AZ shared storage;
- file sharing antar container/service;
- global data lake;
- long-term archive tanpa snapshot/lifecycle.

Mental model:

```text
EC2 instance in AZ-a
   |
   | block device
   v
EBS volume in AZ-a
```

Constraint paling penting: EBS volume bersifat zonal. Volume dibuat di satu Availability Zone dan attach ke instance di AZ yang sama. Ini memengaruhi desain failover. Jika aplikasi stateful di EC2 menyimpan state utama di EBS, maka arsitektur availability dan recovery-nya harus eksplisit.

### 2.3 File Storage — Amazon EFS dan Amazon FSx

File storage menyajikan filesystem yang dapat di-mount oleh compute.

EFS menggunakan NFS dan cocok untuk:

- shared file storage Linux;
- banyak EC2/ECS/EKS/Lambda yang perlu akses file bersama;
- content repository;
- shared configuration/artifact tertentu;
- workload lift-and-shift yang mengharapkan filesystem shared;
- ML/data processing yang perlu shared POSIX-like file access.

FSx adalah keluarga managed file system untuk kebutuhan lebih spesifik:

- FSx for Windows File Server untuk SMB/Windows-native workloads;
- FSx for Lustre untuk high-performance compute dan data processing;
- FSx for NetApp ONTAP untuk enterprise NAS features;
- FSx for OpenZFS untuk OpenZFS-based workloads.

Mental model:

```text
Compute A ----\
Compute B -----+--> Managed file system
Compute C ----/
```

File storage membuat sharing mudah, tetapi juga dapat membuat coupling antar service menjadi tersembunyi. Shared filesystem sering menjadi “database informal” jika tidak dikontrol.

---

## 3. Decision Matrix: S3 vs EBS vs EFS vs FSx

Gunakan pertanyaan ini sebelum memilih service.

| Kebutuhan | Pilihan Umum | Alasan |
|---|---|---|
| Object upload/download via API | S3 | Native object API, durable, scalable, lifecycle kaya |
| Static web assets | S3 + CloudFront | Object + edge caching |
| Build artifact | S3 | Immutable artifact, versioning, easy integration |
| EC2 root/data disk | EBS | Block device untuk instance |
| Database di EC2 | EBS | Low-latency block I/O |
| Shared Linux file system | EFS | NFS managed, multi-compute access |
| Windows file share | FSx for Windows | SMB/Windows-native semantics |
| High-performance Lustre workload | FSx for Lustre | HPC/data processing throughput |
| Enterprise NAS compatibility | FSx for ONTAP | Enterprise storage features |
| Immutable retention/evidence | S3 + Versioning + Object Lock | Retention/legal hold capability |
| Archive jangka panjang | S3 Glacier classes | Storage lifecycle/archival economics |
| Multi-region object availability | S3 replication / Multi-Region Access Points | Object replication/routing pattern |
| Low-latency local ephemeral scratch | Instance store / ephemeral container storage | Temporary, not durable |

Rule of thumb:

- Pilih **S3** jika data adalah object dan aplikasi bisa bekerja dengan API object.
- Pilih **EBS** jika workload butuh block device yang melekat pada compute tertentu.
- Pilih **EFS** jika banyak compute Linux butuh shared filesystem.
- Pilih **FSx** jika workload butuh filesystem khusus: Windows SMB, Lustre, ONTAP, OpenZFS.

Namun, rule of thumb bukan pengganti analisis.

Contoh:

- “User upload dokumen PDF” hampir selalu lebih cocok S3 daripada EFS.
- “Java service butuh temporary file saat generate report” mungkin cukup ephemeral disk container/EC2, lalu output final ke S3.
- “Legacy app menyimpan attachment di shared folder” mungkin bisa memakai EFS untuk migrasi cepat, tetapi target jangka panjang mungkin S3 dengan metadata di database.
- “Regulatory evidence harus immutable selama 7 tahun” perlu S3 versioning, Object Lock, lifecycle, audit, dan restore test—bukan sekadar bucket biasa.

---

## 4. Amazon S3 Deep Architecture

### 4.1 Bucket sebagai Namespace dan Policy Boundary

S3 bucket adalah container object sekaligus boundary untuk:

- namespace object key;
- bucket policy;
- default encryption;
- versioning;
- lifecycle;
- object ownership;
- public access block;
- replication;
- event notification;
- access logging;
- Object Lock configuration;
- storage lens/analytics;
- inventory.

Bucket bukan folder. Folder di S3 hanyalah prefix convention.

```text
s3://reg-case-prod-evidence/
  tenant-a/cases/CASE-001/evidence/doc-001.pdf
  tenant-a/cases/CASE-001/evidence/doc-002.pdf
  tenant-b/cases/CASE-777/evidence/photo-001.jpg
```

Dalam desain produksi, bucket sering dipisah berdasarkan:

- data classification;
- lifecycle policy;
- access boundary;
- replication policy;
- compliance retention;
- tenant isolation;
- environment;
- account.

Jangan membuat satu bucket besar untuk semua jenis data jika policy, lifecycle, audit, dan ownership-nya berbeda.

### 4.2 Object Key sebagai Desain Access Pattern

Object key bukan sekadar nama file. Key menentukan:

- bagaimana manusia memahami struktur data;
- bagaimana aplikasi melakukan list;
- bagaimana lifecycle rule diterapkan berdasarkan prefix/tag;
- bagaimana event notification difilter;
- bagaimana access policy difilter;
- bagaimana cost dan operational tooling bekerja.

Contoh key yang buruk:

```text
s3://bucket/123.pdf
s3://bucket/124.pdf
s3://bucket/125.pdf
```

Masalah:

- tidak jelas tenant;
- tidak jelas domain;
- sulit lifecycle per kategori;
- sulit audit;
- sulit delete by case;
- sulit event routing.

Contoh key lebih baik:

```text
s3://reg-case-prod-evidence/
  tenant/{tenantId}/case/{caseId}/evidence/{evidenceId}/original/{fileName}
  tenant/{tenantId}/case/{caseId}/evidence/{evidenceId}/derived/thumbnail.jpg
  tenant/{tenantId}/case/{caseId}/decision/{decisionId}/signed/decision.pdf
```

Keunggulan:

- tenant terlihat;
- domain jelas;
- lifecycle bisa prefix/tag-based;
- event routing lebih mudah;
- audit dan forensic lebih mudah;
- deletion workflow lebih deterministic.

Tetapi jangan memasukkan PII sensitif ke key jika key dapat muncul di log, metrics, CloudTrail data event, atau URL.

### 4.3 Prefix, Listing, dan Object Enumeration

S3 `ListObjectsV2` bekerja berdasarkan prefix. Banyak aplikasi keliru membuat list sebagai operasi utama.

Anti-pattern:

```text
Setiap request API melakukan LIST s3://bucket/tenant-x/case-y/ lalu mencari file tertentu.
```

Masalah:

- latency lebih tinggi;
- cost meningkat;
- pagination;
- race condition semantik aplikasi;
- sulit memberi invariant kuat.

Pattern yang lebih baik:

- Simpan metadata object di database.
- Gunakan S3 sebagai object body store.
- Gunakan object key deterministik.
- Gunakan `HEAD Object` untuk validasi existence jika perlu.
- Gunakan inventory/analytics untuk batch reconciliation, bukan request path.

```text
Database:
  evidence_id
  case_id
  tenant_id
  object_bucket
  object_key
  checksum
  size
  content_type
  retention_policy
  created_at

S3:
  actual binary object
```

### 4.4 S3 Consistency: Strong tetapi Bukan Transactional

S3 menyediakan strong read-after-write consistency untuk operasi object seperti PUT/DELETE di bucket. Tetapi beberapa hal tetap harus dipahami:

- Tidak ada transaksi multi-object.
- Tidak ada foreign key dengan database.
- Tidak ada compare-and-swap domain-level kecuali memakai conditional request tertentu dan desain tambahan.
- Tidak ada automatic rollback ketika metadata database sukses tetapi upload S3 gagal, atau sebaliknya.

Untuk Java service, desain harus memperlakukan S3 dan database sebagai dua resource berbeda.

#### Pattern: Upload Dengan Metadata Commit

```text
1. Client request upload intent.
2. Backend membuat record metadata status = PENDING_UPLOAD.
3. Backend generate presigned URL atau menerima upload langsung.
4. Client upload object ke S3.
5. Backend menerima completion callback/request.
6. Backend HEAD object, validasi size/checksum/content-type.
7. Backend update metadata status = AVAILABLE.
8. Workflow downstream hanya membaca object yang statusnya AVAILABLE.
```

Dengan pattern ini, object orphan atau metadata pending dapat direkonsiliasi.

#### Pattern: Backend-Mediated Upload

```text
Client -> Java API -> S3
```

Cocok jika:

- file kecil;
- backend perlu scanning/transform synchronous;
- policy sederhana;
- tidak ingin expose presigned URL.

Tidak cocok jika:

- file besar;
- throughput tinggi;
- backend menjadi bottleneck;
- koneksi client tidak stabil.

#### Pattern: Direct-to-S3 Upload dengan Presigned URL

```text
Client -> Java API: request upload URL
Java API -> S3: generate presigned URL
Client -> S3: upload
Client -> Java API: complete upload
Java API -> S3: validate HEAD/checksum
```

Cocok untuk large uploads dan mengurangi beban backend.

Risiko:

- presigned URL adalah capability sementara;
- expiry harus pendek;
- key harus ditentukan server;
- content type/length/checksum perlu dibatasi;
- completion harus divalidasi server;
- jangan percaya klaim client bahwa upload sukses.

S3 presigned URL memakai permission dari principal yang membuat URL. Dengan kata lain, URL tersebut mewarisi batas permission creator-nya selama masa berlaku URL.

### 4.5 Versioning

S3 Versioning menyimpan beberapa versi object dengan key yang sama.

Manfaat:

- recovery dari overwrite/delete tidak sengaja;
- audit perubahan object;
- dasar untuk Object Lock;
- protection terhadap ransomware/logical deletion tertentu.

Konsekuensi:

- cost meningkat karena versi lama tetap tersimpan;
- delete marker dapat membingungkan aplikasi;
- lifecycle harus mencakup non-current versions;
- restore/delete permanent membutuhkan prosedur lebih hati-hati.

Mental model:

```text
key: evidence/doc-001.pdf
  version v3: current
  version v2: previous
  version v1: previous
  delete-marker? optional
```

Untuk regulated evidence, versioning hampir selalu perlu dipertimbangkan. Tetapi versioning saja tidak sama dengan immutability. User/role dengan permission tertentu masih dapat menghapus version kecuali dibatasi policy/Object Lock.

### 4.6 Object Lock dan Immutability

S3 Object Lock membantu mencegah object dihapus atau dioverwrite selama periode tertentu atau indefinitely. Object Lock sering dipakai untuk WORM-style retention.

Mode umum:

- governance mode;
- compliance mode;
- legal hold.

Governance mode dapat dibypass oleh principal dengan permission khusus. Compliance mode jauh lebih ketat: object version tidak dapat dihapus/diubah sampai retention expire, termasuk oleh root dalam banyak skenario operasional.

Desain Object Lock harus sangat hati-hati karena salah retention dapat membuat data tidak bisa dihapus walaupun secara bisnis ingin dihapus.

Checklist sebelum Object Lock:

- Apakah retention requirement jelas?
- Apakah data subject deletion law bertentangan dengan retention?
- Apakah bucket versioning aktif?
- Apakah lifecycle untuk non-current version sesuai?
- Apakah role bypass governance dikontrol?
- Apakah legal hold workflow jelas?
- Apakah restore dan audit evidence diuji?
- Apakah ada environment terpisah untuk test?

Untuk enforcement/case management platform, Object Lock bisa relevan untuk:

- submitted evidence;
- signed decision document;
- immutable audit export;
- official correspondence;
- regulatory records.

Tetapi object draft, temporary upload, preview, dan generated cache biasanya tidak perlu Object Lock.

### 4.7 S3 Storage Classes

S3 memiliki beberapa storage class untuk pola akses berbeda. Prinsipnya:

- Hot data: akses sering, latency cepat.
- Infrequent data: akses jarang, storage lebih murah, retrieval bisa lebih mahal.
- Archive data: storage murah, retrieval lebih lambat/mahal.

Contoh kategori desain:

| Data | Storage Class Awal | Lifecycle |
|---|---|---|
| User upload baru | S3 Standard | Setelah 90/180 hari pindah ke IA/Archive jika jarang diakses |
| Audit evidence aktif | S3 Standard atau Standard-IA | Retention + lifecycle hati-hati |
| Long-term regulatory archive | Glacier Instant/Flexible/Deep Archive sesuai retrieval SLA | Restore process wajib diuji |
| Static assets | S3 Standard + CloudFront | Lifecycle untuk old versions |
| Temporary export | S3 Standard | Expire setelah N hari |
| Derived thumbnails | S3 Standard-IA atau expire/regenerate | Bergantung regeneration cost |

Jangan memilih storage class hanya berdasarkan harga per GB. Total cost mencakup:

- request cost;
- retrieval cost;
- minimum storage duration;
- monitoring/automation cost;
- operational recovery cost;
- early deletion fee;
- user impact saat retrieval lambat.

### 4.8 Lifecycle Policy

S3 Lifecycle dapat melakukan:

- transition object ke storage class lain;
- expire current object;
- expire non-current versions;
- abort incomplete multipart uploads;
- delete expired delete markers.

Lifecycle rule harus dipandang sebagai production automation yang menghapus/memindahkan data. Kesalahan lifecycle adalah data-loss incident.

Pattern lifecycle:

```text
Prefix: tenant/*/case/*/tmp-upload/*
Action: expire after 7 days

Prefix: tenant/*/case/*/evidence/*
Action: transition to Standard-IA after 180 days
Action: transition to Glacier after 2 years
Action: retain according to legal policy

Prefix: reports/export/*
Action: expire after 30 days
```

Gunakan tags jika prefix tidak cukup:

```text
DataClass=Evidence
Retention=SevenYears
TenantTier=Regulated
ContainsPII=true
```

Namun tag juga harus dikontrol. Jangan membiarkan aplikasi sembarangan mengubah tag retention-sensitive tanpa audit.

### 4.9 Multipart Upload

Multipart upload digunakan untuk upload object besar dalam beberapa bagian.

Manfaat:

- retry per part;
- upload paralel;
- lebih tahan terhadap koneksi tidak stabil;
- cocok untuk file besar.

Failure mode:

- incomplete multipart upload tertinggal dan menambah cost;
- checksum mismatch;
- part order salah;
- aplikasi menganggap sukses sebelum complete;
- credential/presigned part expiry;
- upload besar menahan koneksi backend terlalu lama.

Lifecycle harus meng-abort incomplete multipart uploads.

```text
Lifecycle rule:
  AbortIncompleteMultipartUpload after 7 days
```

Untuk Java, gunakan transfer manager atau SDK abstraction yang menangani multipart dengan baik jika workload melibatkan file besar.

### 4.10 Checksums dan Integrity

Untuk dokumen penting, jangan hanya mengandalkan “PUT berhasil”. Simpan integrity metadata.

Yang dapat disimpan di metadata database:

- object key;
- object version ID;
- size;
- checksum algorithm;
- checksum value;
- content type;
- uploader;
- upload time;
- scan status;
- retention status.

Flow:

```text
1. Client/backend menghitung checksum.
2. Upload memakai checksum header jika memungkinkan.
3. Backend HEAD object.
4. Backend bandingkan size/checksum/metadata.
5. Metadata status menjadi AVAILABLE hanya jika validasi lolos.
```

Untuk regulatory evidence, checksum adalah bagian dari chain-of-custody.

### 4.11 Encryption di S3

S3 mendukung server-side encryption.

Pilihan umum:

- SSE-S3: encryption dikelola S3.
- SSE-KMS: memakai AWS KMS key.
- DSSE-KMS untuk skenario tertentu yang butuh dual-layer server-side encryption.
- Client-side encryption jika aplikasi harus mengenkripsi sebelum data keluar dari trust boundary aplikasi.

SSE-KMS memberi kontrol lebih:

- key policy;
- audit KMS usage;
- grant;
- per-tenant key strategy;
- deny access by key.

Tetapi SSE-KMS juga menambah failure mode:

- KMS permission denial;
- KMS throttling;
- key disabled;
- key scheduled deletion;
- cross-account key policy mismatch;
- biaya request KMS;
- latency tambahan.

Untuk multi-tenant regulated workload, pertanyaan desainnya:

- Apakah key per environment cukup?
- Apakah key per data class cukup?
- Apakah key per tenant diperlukan?
- Siapa admin key?
- Siapa user key?
- Bagaimana rotate key?
- Bagaimana restore jika key access hilang?

### 4.12 Bucket Policy dan Public Access Block

S3 security sering gagal karena bucket policy terlalu longgar.

Prinsip:

- aktifkan Block Public Access kecuali benar-benar perlu public bucket;
- gunakan CloudFront Origin Access Control untuk static/public distribution;
- hindari ACL jika tidak perlu;
- gunakan bucket policy untuk guardrail resource-level;
- gunakan IAM role untuk application-level access;
- batasi berdasarkan VPC endpoint jika cocok;
- batasi berdasarkan encryption requirement;
- batasi berdasarkan TLS requirement;
- batasi berdasarkan principal/account/organization;
- audit dengan CloudTrail data event untuk bucket penting.

Contoh guardrail policy secara konseptual:

```json
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::example-bucket/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}
```

Jangan copy-paste policy tanpa memahami condition key dan principal boundary.

### 4.13 S3 Event Notification

S3 Event Notifications dapat mengirim event ke target seperti Lambda, SQS, atau SNS saat event tertentu terjadi.

Use case:

- scan file setelah upload;
- generate thumbnail;
- index metadata;
- trigger workflow;
- data pipeline ingestion;
- audit export processing.

Namun event notification harus diperlakukan sebagai at-least-once event, bukan exactly-once transaction.

Failure mode:

- duplicate event;
- out-of-order event;
- event filter salah;
- Lambda retry storm;
- target permission salah;
- object sudah dihapus saat event diproses;
- event untuk multipart complete bukan setiap part;
- workflow menganggap event sebagai bukti valid tanpa HEAD/metadata validation.

Pattern yang lebih aman:

```text
S3 event -> SQS queue -> worker/Lambda -> HEAD object -> validate metadata -> idempotency check -> process -> update DB
```

Jangan proses evidence kritikal langsung dari S3 event ke side effect final tanpa idempotency.

### 4.14 S3 Replication

S3 replication dapat digunakan untuk:

- cross-region disaster recovery;
- cross-account isolation;
- compliance copy;
- data distribution;
- analytics copy.

Perhatikan:

- replication tidak selalu instan;
- IAM role replication harus benar;
- KMS encrypted object perlu key permission di source dan destination;
- delete marker replication harus dipilih sadar;
- Object Lock replication memiliki syarat khusus;
- biaya storage dan transfer bertambah.

Jangan menganggap replication sebagai backup penuh tanpa memahami accidental delete propagation. Untuk backup, pertimbangkan versioning, Object Lock, AWS Backup, lifecycle, dan restore drill.

---

## 5. S3 Patterns untuk Java Applications

### 5.1 Pattern: Metadata di Database, Body di S3

Ini pattern paling umum untuk backend Java.

```text
PostgreSQL / DynamoDB:
  document_id
  case_id
  tenant_id
  bucket
  key
  version_id
  checksum
  size
  content_type
  status
  retention_until
  created_by
  created_at

S3:
  binary body
```

Keunggulan:

- query metadata cepat;
- authorization domain-level di aplikasi;
- S3 hanya menyimpan payload;
- lifecycle dan retention tetap bisa dikontrol;
- object key deterministic;
- reconciliation bisa dilakukan.

Anti-pattern:

- aplikasi melakukan authorization berdasarkan S3 prefix saja tanpa domain metadata;
- database menyimpan URL publik permanen;
- object key dibuat oleh client;
- metadata status tidak punya state machine.

State machine sederhana:

```text
PENDING_UPLOAD -> UPLOADED -> SCANNING -> AVAILABLE
                           -> REJECTED
                           -> EXPIRED
                           -> QUARANTINED
```

### 5.2 Pattern: Presigned Download URL

Backend tidak perlu streaming file besar jika object bisa diambil langsung dari S3.

Flow:

```text
1. Client request download document.
2. Backend authenticate + authorize domain action.
3. Backend resolve bucket/key/version.
4. Backend generate presigned GET URL dengan expiry pendek.
5. Client download dari S3.
```

Keunggulan:

- backend tidak menjadi bottleneck bandwidth;
- authorization tetap dilakukan backend;
- expiry membatasi exposure.

Risiko:

- URL bocor selama masih valid;
- URL bisa dipakai oleh siapa pun yang memegang URL;
- response header override dapat salah;
- object key/metadata bisa terekspos dalam URL/log;
- audit aplikasi harus mencatat “URL issued”, bukan hanya S3 GET.

Untuk highly sensitive evidence, pertimbangkan:

- expiry sangat pendek;
- CloudFront signed URL/cookie;
- download melalui controlled backend jika audit per byte/per access benar-benar dibutuhkan;
- watermarking atau dynamic rendering;
- CloudTrail data events untuk bucket kritikal.

### 5.3 Pattern: Quarantine Bucket

Untuk upload user-generated content:

```text
Client upload -> quarantine bucket -> malware scan/content validation -> clean bucket
```

Keunggulan:

- object belum trusted;
- downstream service hanya membaca dari clean bucket;
- lifecycle quarantine bisa pendek;
- rejected object bisa ditahan untuk audit sesuai policy.

State:

```text
PENDING_UPLOAD
UPLOADED_TO_QUARANTINE
SCAN_IN_PROGRESS
CLEAN_AVAILABLE
REJECTED_MALWARE
REJECTED_POLICY
EXPIRED
```

### 5.4 Pattern: Immutable Evidence Bucket

Untuk regulatory evidence:

- bucket khusus evidence;
- versioning aktif;
- Object Lock aktif;
- default retention sesuai policy;
- SSE-KMS;
- CloudTrail data event;
- access via application role only;
- no public access;
- replication ke archive/security account jika perlu;
- lifecycle ke archive class setelah masa aktif;
- checksum stored in metadata DB;
- legal hold workflow eksplisit.

Invariant:

```text
Evidence object yang sudah status AVAILABLE tidak boleh dioverwrite.
Setiap koreksi harus membuat object/version baru dan event audit baru.
```

### 5.5 Pattern: Export Bucket untuk Generated Reports

Generated report sering bukan source of truth.

Design:

- bucket/prefix khusus export;
- lifecycle expire 7/30/90 hari;
- no Object Lock;
- object dapat diregenerate;
- metadata menyimpan job status;
- presigned URL expiry pendek;
- encryption tetap aktif.

Jangan menyamakan report sementara dengan official record.

---

## 6. Amazon EBS Deep Architecture

### 6.1 EBS sebagai Zonal Block Storage

EBS volume dibuat di satu Availability Zone dan attach ke EC2 instance di AZ yang sama.

Konsekuensi:

- Jika instance gagal, volume bisa diattach ke instance lain di AZ yang sama.
- Jika AZ terganggu, volume di AZ tersebut tidak bisa langsung dipakai di AZ lain.
- Recovery lintas AZ biasanya melalui snapshot/replication/backup atau arsitektur aplikasi.
- EBS cocok untuk stateful workload yang sudah punya strategi HA/backup.

Mental model:

```text
AZ-a:
  EC2 app-1 -> EBS vol-1

AZ-b:
  EC2 app-2 -> EBS vol-2
```

Untuk database production, Multi-AZ biasanya lebih baik menggunakan managed RDS/Aurora daripada merakit sendiri di EC2 kecuali ada alasan kuat.

### 6.2 Volume Types

EBS volume types berbeda dalam performance dan cost.

Kategori umum:

- SSD general purpose: gp3/gp2.
- Provisioned IOPS SSD: io2/io1.
- HDD throughput optimized: st1.
- Cold HDD: sc1.

Untuk kebanyakan workload modern, gp3 sering menjadi default yang baik karena performance baseline dan konfigurasi IOPS/throughput lebih eksplisit dibanding gp2.

Namun, jangan memilih volume berdasarkan “terbaru”. Pilih berdasarkan:

- required IOPS;
- required throughput;
- latency sensitivity;
- volume size;
- burst behavior;
- cost per GB;
- cost per provisioned IOPS;
- filesystem/application pattern.

### 6.3 EBS Performance: IOPS, Throughput, Queue Depth

Block storage performance bukan satu angka.

Dimensi:

- IOPS: operasi I/O per detik.
- Throughput: MB/s.
- Latency: waktu per operasi.
- Queue depth: jumlah outstanding I/O.
- I/O size: ukuran tiap request.
- Read/write mix.
- Random/sequential pattern.

Contoh:

- Database OLTP: banyak random small I/O, IOPS dan latency penting.
- Log processing: sequential throughput mungkin lebih penting.
- Root volume app biasa: moderate I/O.

Untuk Java service stateless di EC2, EBS root volume biasanya bukan bottleneck kecuali:

- logging ke disk berlebihan;
- temporary file besar;
- local queue/spool;
- embedded database;
- heavy build/processing di instance.

### 6.4 EBS Snapshot

Snapshot adalah point-in-time backup volume ke S3-managed backend.

Manfaat:

- backup;
- restore volume baru;
- copy lintas region;
- create AMI;
- disaster recovery.

Pertimbangan:

- snapshot bersifat incremental;
- consistency aplikasi harus dijaga;
- filesystem/database mungkin perlu freeze/flush atau application-aware backup;
- restore performance dapat dipengaruhi lazy loading kecuali memakai Fast Snapshot Restore untuk kebutuhan tertentu;
- snapshot lifecycle harus dikontrol.

Anti-pattern:

```text
Menganggap snapshot EBS database selalu konsisten tanpa koordinasi aplikasi/database.
```

Untuk database di EC2, pastikan:

- quiesce write;
- flush filesystem;
- database backup mode;
- test restore;
- recovery time measurable.

### 6.5 EBS Encryption

EBS encryption memakai AWS KMS keys untuk encrypted volumes dan snapshots. Encryption terjadi pada server yang host EC2 instance, melindungi data at rest dan data in transit antara instance dan attached EBS storage.

Best practice umum:

- enable EBS encryption by default di account/region;
- gunakan CMK jika butuh kontrol key policy/audit khusus;
- pastikan snapshot copy encryption sesuai policy;
- batasi siapa yang dapat create unencrypted volume;
- gunakan AWS Config rule untuk compliance.

Failure mode:

- KMS key disabled menyebabkan attach/use gagal;
- snapshot encrypted tidak dapat dicopy/share tanpa key permission;
- AMI encrypted tidak bisa dipakai account lain tanpa grant/policy benar;
- restore DR gagal karena key tidak tersedia di region/account tujuan.

### 6.6 EBS DeleteOnTermination dan Data Retention

Root volume sering `DeleteOnTermination=true`.

Data volume bisa diset berbeda.

Pertanyaan desain:

- Apakah data di volume harus bertahan setelah instance terminate?
- Apakah termination otomatis oleh ASG bisa menghapus data penting?
- Apakah volume orphan akan menambah cost?
- Apakah volume berisi sensitive data yang harus encrypted dan lifecycle-managed?

Untuk stateless app:

```text
All important state -> external service/S3/database
EC2 volume -> disposable
DeleteOnTermination -> true
```

Untuk stateful app:

```text
Data volume retention -> explicit
Backup -> explicit
Failover -> explicit
Runbook -> tested
```

### 6.7 Multi-Attach

Beberapa EBS volume type mendukung Multi-Attach untuk attach volume ke multiple instances dalam AZ yang sama, tetapi ini bukan pengganti shared filesystem umum. Aplikasi/filesystem harus mendukung concurrent write coordination.

Jika Anda tidak punya alasan kuat dan kemampuan storage-level coordination, jangan gunakan Multi-Attach sebagai “EFS versi cepat”.

### 6.8 EBS untuk Java Workload

Java service biasanya lebih baik stateless. Gunakan EBS untuk:

- root filesystem;
- temporary disk yang boleh hilang;
- local cache yang bisa di-rebuild;
- batch working directory;
- specialized EC2-hosted stateful component.

Jangan simpan state bisnis utama hanya di local EBS pada fleet autoscaled tanpa strategy.

Anti-pattern:

```text
ECS/EC2 Java service menyimpan uploaded file di /data/uploads lokal, lalu ASG scale-in menghapus instance.
```

Pattern:

```text
Temporary local file -> validate/process -> upload final object to S3 -> metadata commit -> delete local temp
```

---

## 7. Amazon EFS Deep Architecture

### 7.1 EFS sebagai Managed NFS

EFS menyediakan file system elastis yang dapat di-mount oleh banyak compute. EFS dapat tumbuh sampai petabyte scale dan dirancang untuk parallel access dari compute.

Cocok untuk:

- shared content repository;
- legacy Linux app yang butuh shared filesystem;
- home directories;
- ML shared data;
- CMS/media shared files;
- serverless/container workloads yang perlu shared file access.

Tidak cocok untuk:

- latency paling rendah seperti local disk;
- database utama high-performance tanpa validasi vendor;
- object lake yang lebih cocok S3;
- service coupling via file drop tanpa governance;
- high-churn small files tanpa performance testing.

### 7.2 Mount Target dan VPC

EFS diakses melalui mount targets di subnet/AZ.

Design:

```text
VPC
  AZ-a subnet -> EFS mount target
  AZ-b subnet -> EFS mount target
  AZ-c subnet -> EFS mount target

EC2/ECS/Lambda in AZ-a -> mount target AZ-a
```

Security group mengontrol NFS access.

Failure mode:

- mount target tidak ada di AZ compute;
- security group port NFS salah;
- DNS resolution salah;
- route/NACL blocking;
- IAM authorization/mount option mismatch;
- Lambda/ECS mount configuration salah.

### 7.3 Performance Mode dan Throughput Mode

EFS punya mode performance/throughput. Untuk kebanyakan workload, AWS merekomendasikan default General Purpose performance mode dan Elastic throughput mode.

Namun, pilihan harus berdasarkan workload:

- banyak client paralel;
- ukuran file;
- read/write mix;
- metadata operation rate;
- latency sensitivity;
- burstiness;
- throughput requirement.

EFS bukan magic infinite disk. Workload dengan banyak metadata operation kecil dapat bottleneck berbeda dari workload large sequential reads.

### 7.4 Access Points

EFS Access Point menyediakan entry point dengan path dan POSIX identity tertentu.

Use case:

- isolate application directory;
- enforce UID/GID;
- simplify container/Lambda mount;
- avoid sharing root filesystem ke semua app.

Pattern:

```text
EFS filesystem
  /app-a-data   <- access point app-a
  /app-b-data   <- access point app-b
  /shared-ref   <- access point shared-reader
```

Jangan mount root EFS ke semua service dengan permission luas.

### 7.5 EFS dengan ECS/Fargate

EFS sering dipakai dengan ECS/Fargate jika container butuh persistent shared file.

Namun tanyakan dulu:

- Apakah data sebenarnya object dan lebih cocok S3?
- Apakah service hanya butuh temporary scratch?
- Apakah file sharing menciptakan coupling antar task?
- Bagaimana permission UID/GID di container?
- Bagaimana backup dan restore?
- Bagaimana throughput saat scale-out?

Pattern yang masuk akal:

- shared rule files read-only;
- upload staging untuk legacy app;
- generated reports shared antar worker dalam batch pipeline;
- ML model files jika S3 download per task terlalu mahal/lambat, setelah diuji.

### 7.6 EFS dengan Lambda

Lambda dapat mount EFS untuk kebutuhan tertentu:

- model/data besar yang tidak cocok dalam package;
- shared resources;
- file processing yang butuh POSIX path;
- library native besar.

Risiko:

- cold start/mount latency;
- VPC requirement;
- EFS throughput under concurrent Lambda;
- file locking semantics;
- permission issue;
- coupling serverless function ke filesystem state.

Jika Lambda hanya perlu baca/tulis object, S3 biasanya lebih natural.

### 7.7 EFS Backup dan Lifecycle

EFS dapat dibackup dengan AWS Backup. Lifecycle management dapat memindahkan file yang jarang diakses ke storage class lebih murah.

Pertanyaan desain:

- Apakah semua file perlu backup?
- Apakah ada temporary directory yang harus dikecualikan?
- Berapa RPO/RTO?
- Bagaimana restore partial directory?
- Bagaimana test restore?
- Apakah lifecycle transition memengaruhi latency akses berikutnya?

---

## 8. Amazon FSx Deep Architecture

FSx bukan satu service homogen. FSx adalah keluarga managed file system untuk workload spesifik.

### 8.1 FSx for Windows File Server

Cocok untuk:

- Windows application yang butuh SMB;
- Active Directory integration;
- lift-and-shift Windows file share;
- enterprise apps yang bergantung pada Windows ACL.

Pertanyaan:

- Apakah workload benar-benar butuh SMB?
- Bagaimana AD integration?
- Bagaimana backup?
- Bagaimana multi-AZ?
- Bagaimana permission mapping ke aplikasi?

### 8.2 FSx for Lustre

Cocok untuk:

- HPC;
- ML training;
- large-scale data processing;
- workload throughput tinggi;
- integration dengan S3 dataset.

Pattern:

```text
S3 dataset <-> FSx for Lustre <-> compute fleet
```

Bukan pilihan default untuk aplikasi web Java biasa.

### 8.3 FSx for NetApp ONTAP

Cocok untuk enterprise NAS features:

- snapshots;
- cloning;
- replication;
- multiprotocol access;
- enterprise storage migration.

Biasanya dipakai jika organisasi sudah punya operational model NetApp atau workload enterprise storage-heavy.

### 8.4 FSx for OpenZFS

Cocok untuk workload yang membutuhkan OpenZFS semantics/features tertentu.

Gunakan jika requirement filesystem spesifik jelas, bukan karena “lebih advanced”.

---

## 9. Storage Security Architecture

Storage security tidak cukup dengan “encryption enabled”. Ada banyak layer.

### 9.1 Layer Security

| Layer | Pertanyaan |
|---|---|
| Identity | Siapa principal yang boleh akses? |
| Authorization | Action apa ke resource mana? |
| Network | Dari network mana storage dapat dijangkau? |
| Encryption | Data encrypted at rest/in transit? Key siapa? |
| Audit | Apakah akses tercatat? |
| Retention | Apakah delete/overwrite dibatasi? |
| Classification | Apakah data sensitive dipisah? |
| Tenant | Apakah tenant isolation kuat? |
| Lifecycle | Apakah deletion/transition sesuai policy? |

### 9.2 S3 Access Strategy

Untuk aplikasi Java:

- role aplikasi hanya punya akses ke bucket/prefix/action yang diperlukan;
- write role dan read role bisa dipisah jika perlu;
- admin bucket role tidak dipakai aplikasi runtime;
- presigned URL hanya dibuat setelah authorization domain-level;
- bucket policy guardrail mencegah insecure write;
- KMS key policy sinkron dengan IAM policy;
- CloudTrail data events untuk bucket penting.

Contoh role separation:

```text
case-api-role:
  s3:PutObject to quarantine prefix
  s3:GetObject to available evidence prefix
  s3:HeadObject for validation

case-worker-role:
  s3:GetObject from quarantine
  s3:PutObject to clean evidence
  kms:Decrypt/Encrypt for specific key

case-admin-breakglass-role:
  tightly controlled, MFA, audited
```

### 9.3 EBS Security

- encryption by default;
- restrict snapshot sharing;
- tag sensitive volumes;
- snapshot lifecycle;
- prevent public AMI/snapshot exposure;
- SSM instead of SSH public access;
- IAM guardrail for `ec2:CreateVolume` without encryption.

### 9.4 EFS/FSx Security

- security groups control mount access;
- encryption in transit if supported/configured;
- encryption at rest;
- IAM authorization where applicable;
- POSIX/Windows permissions;
- access points;
- avoid broad shared mount;
- backup and restore permission.

---

## 10. Storage Cost Engineering

Storage cost bukan hanya GB-month.

### 10.1 S3 Cost Dimensions

- storage per GB-month;
- request cost PUT/GET/LIST/HEAD;
- lifecycle transition requests;
- retrieval charges for archive/infrequent tiers;
- data transfer out;
- replication storage and transfer;
- KMS request cost;
- inventory/analytics/logging;
- incomplete multipart uploads;
- non-current versions;
- delete markers;
- small object overhead/minimum duration.

Cost traps:

- millions of tiny objects with high request rate;
- lifecycle transition too aggressive;
- Glacier retrieval during incident causing surprise cost/latency;
- versioning enabled without non-current expiration;
- logs stored forever;
- cross-region replication for everything;
- per-request KMS cost at high write rate.

### 10.2 EBS Cost Dimensions

- provisioned GB;
- provisioned IOPS;
- provisioned throughput;
- snapshots;
- Fast Snapshot Restore;
- orphan volumes;
- unattached volumes;
- old AMIs retaining snapshots.

Cost traps:

- gp2 oversized just to get IOPS;
- unattached volumes after instance termination;
- snapshots retained forever;
- high-performance volume for low I/O workload;
- no lifecycle for AMI snapshots.

### 10.3 EFS Cost Dimensions

- storage amount;
- storage class;
- throughput mode;
- provisioned throughput if used;
- backup;
- data transfer depending access pattern.

Cost traps:

- temporary files never deleted;
- shared filesystem used as dumping ground;
- backup everything including cache/temp;
- lifecycle not enabled;
- unexpected growth due to logs.

### 10.4 FSx Cost Dimensions

Tergantung FSx type:

- storage capacity;
- throughput capacity;
- SSD/HDD choice;
- backup;
- deployment type;
- data transfer;
- feature-specific costs.

FSx harus dipilih dengan workload-specific cost model.

---

## 11. Storage Observability dan Operations

### 11.1 Observability untuk S3

Yang perlu dimonitor:

- request count;
- 4xx/5xx errors;
- latency;
- bucket size;
- object count;
- replication status;
- lifecycle effect;
- incomplete multipart uploads;
- access denied spikes;
- KMS errors;
- data event audit;
- public access findings.

Tools/pattern:

- CloudWatch metrics;
- S3 Storage Lens;
- S3 Inventory;
- CloudTrail data events;
- server access logs jika diperlukan;
- EventBridge/AWS Config/Security Hub for findings.

### 11.2 Observability untuk EBS

Monitor:

- read/write ops;
- read/write bytes;
- queue length;
- idle time;
- burst balance jika applicable;
- volume status;
- snapshot success;
- filesystem usage inside EC2;
- application latency.

CloudWatch volume metrics tidak menggantikan OS/filesystem metrics. Gunakan CloudWatch Agent atau observability agent di instance.

### 11.3 Observability untuk EFS

Monitor:

- throughput;
- percent I/O limit;
- client connections;
- storage bytes;
- burst credits jika mode terkait;
- mount errors;
- NFS latency dari client;
- application file operation latency.

### 11.4 Audit vs Observability

Observability menjawab:

```text
Apakah sistem sehat? Mengapa lambat? Di mana bottleneck?
```

Audit menjawab:

```text
Siapa mengakses data apa, kapan, melalui action apa, dan apakah sesuai policy?
```

Untuk regulated workload, keduanya diperlukan.

---

## 12. Backup, Restore, dan Disaster Recovery

### 12.1 Backup Tidak Bernilai Tanpa Restore Test

Banyak organisasi punya backup tetapi tidak punya recovery capability.

Pertanyaan minimum:

- Apa RPO untuk data ini?
- Apa RTO untuk restore data ini?
- Restore ke account/region mana?
- Siapa yang punya permission restore?
- Apakah KMS key tersedia?
- Apakah application metadata konsisten dengan object/volume/file restore?
- Apakah restore pernah diuji?
- Apakah runbook ada?

### 12.2 S3 Recovery

Tools/pattern:

- versioning;
- Object Lock;
- replication;
- lifecycle;
- AWS Backup untuk S3 dalam skenario tertentu;
- inventory-based reconciliation;
- batch operations;
- restore from Glacier.

Scenario:

```text
Accidental delete object:
  if versioning enabled -> remove delete marker / restore previous version
  if Object Lock retention active -> delete prevented
  if no versioning -> rely on replication/backup if configured
```

### 12.3 EBS Recovery

Tools/pattern:

- snapshots;
- AMI;
- copy snapshot cross-region;
- AWS Backup;
- launch new instance from AMI;
- attach restored volume;
- application-level recovery.

Scenario:

```text
Instance corrupts local disk:
  stop/replace instance
  restore EBS snapshot
  attach to recovery instance
  validate filesystem/application state
```

### 12.4 EFS/FSx Recovery

Tools/pattern:

- AWS Backup;
- native backup features;
- point-in-time restore depending service;
- file-level restore;
- separate filesystem restore then copy back;
- permission validation.

### 12.5 Cross-Account Backup

Untuk blast-radius reduction:

```text
Production account -> backup vault/security account
```

Manfaat:

- production compromise tidak otomatis menghapus backup;
- separation of duties;
- audit/control lebih kuat.

Perhatikan KMS key, restore permission, org policy, dan test restore.

---

## 13. Storage Failure Mode Catalog

### 13.1 S3 Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| AccessDenied | IAM/bucket/KMS policy mismatch | Policy evaluation, CloudTrail, least privilege tests |
| Public exposure | Bucket policy/ACL salah | Block Public Access, Config/Security Hub, review |
| Object orphan | DB commit gagal setelah upload | pending state + reconciliation |
| Metadata dangling | DB menunjuk object yang tidak ada | HEAD validation + reconciliation |
| Duplicate processing | S3 event duplicate | idempotency key |
| Lifecycle data loss | rule prefix/tag salah | dry-run via inventory, review, staged rollout |
| Non-current version cost explosion | versioning tanpa lifecycle | lifecycle non-current versions |
| Incomplete multipart cost | upload gagal tidak diabort | abort incomplete multipart rule |
| KMS denial | key policy/role salah | test with real runtime role |
| Glacier restore delay | archive dipilih tanpa SLA | retrieval SLA design/runbook |
| Presigned URL leak | URL logged/shared | short expiry, logging hygiene, domain audit |
| Hot request path with LIST | app list every request | metadata DB, deterministic keys |

### 13.2 EBS Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| AZ-bound state unavailable | EBS zonal | multi-AZ app design, snapshot/replication |
| Data loss on termination | DeleteOnTermination true | explicit data volume policy |
| Orphan volume cost | instance deleted, volume retained | lifecycle cleanup, tags |
| Inconsistent snapshot | app not flushed | application-aware backup |
| Restore slow | lazy snapshot load | restore testing, FSR if needed |
| KMS restore failure | key unavailable | cross-account/region key planning |
| I/O bottleneck | wrong volume type/size | benchmark, metrics, gp3/io2 selection |

### 13.3 EFS Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Mount failure | SG/NACL/DNS/mount target | reachability test, mount target per AZ |
| Permission denied | POSIX UID/GID mismatch | access points, container UID control |
| Latency spike | workload mismatch | benchmark, cache, redesign to S3/EBS |
| Shared filesystem coupling | many services depend on same paths | ownership boundaries, access points |
| Storage growth | temp/log files never deleted | lifecycle, cleanup jobs, quotas/process |
| Throughput bottleneck | mode mismatch | monitor, choose throughput mode |

### 13.4 FSx Failure Modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Wrong FSx type | memilih tanpa workload match | protocol/performance requirement review |
| AD integration issue | identity/domain config salah | staged integration testing |
| High cost | throughput/storage overprovision | cost model and monitoring |
| Migration mismatch | app expects old semantics | compatibility testing |

---

## 14. Case Study: Regulated Java Case Management Platform

Kita desain storage untuk platform case management regulatori.

### 14.1 Requirements

Functional:

- investigator upload evidence;
- officer review evidence;
- system generate decision document;
- signed decision retained;
- export case bundle;
- audit every access;
- support tenant/agency boundary.

Non-functional:

- evidence immutable setelah accepted;
- malware scanning sebelum available;
- retention 7 tahun;
- legal hold per case;
- private access only;
- large file upload support;
- restore test quarterly;
- cost controlled for old cases.

### 14.2 Storage Design

Buckets:

```text
reg-prod-quarantine-bucket
reg-prod-evidence-bucket
reg-prod-decision-bucket
reg-prod-export-bucket
reg-prod-audit-archive-bucket
```

Why separate buckets?

- quarantine data has different trust level;
- evidence needs Object Lock;
- decision document may have different retention;
- export is temporary;
- audit archive has separate access boundary.

### 14.3 Object Key Design

```text
quarantine:
  tenant/{tenantId}/case/{caseId}/upload/{uploadId}/original/{serverFileName}

evidence:
  tenant/{tenantId}/case/{caseId}/evidence/{evidenceId}/version/{evidenceVersion}/object

decision:
  tenant/{tenantId}/case/{caseId}/decision/{decisionId}/signed/document.pdf

export:
  tenant/{tenantId}/case/{caseId}/export/{exportJobId}/bundle.zip
```

Avoid original client filename as primary identity. Store original filename as metadata after sanitization.

### 14.4 Metadata Model

```text
case_document
  id
  tenant_id
  case_id
  document_type
  storage_bucket
  storage_key
  storage_version_id
  checksum_sha256
  size_bytes
  content_type
  status
  retention_until
  legal_hold
  created_by
  created_at
  accepted_by
  accepted_at
```

Status:

```text
PENDING_UPLOAD
UPLOADED
SCANNING
REJECTED
AVAILABLE
UNDER_LEGAL_HOLD
ARCHIVED
EXPIRED_METADATA_ONLY
```

### 14.5 Upload Flow

```text
1. User asks backend to create upload intent.
2. Backend authorizes user action against case state.
3. Backend creates DB record PENDING_UPLOAD.
4. Backend creates presigned PUT URL for quarantine key.
5. Client uploads to S3.
6. Client calls complete-upload.
7. Backend HEAD object, validates size/checksum/content type.
8. Backend marks UPLOADED.
9. S3 event/SQS triggers scanner.
10. Scanner validates content.
11. If clean, worker copies object to evidence bucket with retention/encryption.
12. Worker records version ID/checksum and marks AVAILABLE.
13. Audit event emitted.
```

Invariant:

```text
No human reviewer can access quarantine object directly.
Only AVAILABLE evidence appears in case timeline.
```

### 14.6 Download Flow

```text
1. User requests evidence view.
2. Backend checks tenant, case assignment, role, case state.
3. Backend emits access audit event.
4. Backend returns short-lived presigned GET or streams controlled response.
5. Access logs/CloudTrail data event retained.
```

For highly sensitive files, prefer controlled rendering or watermarking.

### 14.7 Lifecycle

```text
quarantine bucket:
  expire rejected/pending uploads after 14 days
  abort incomplete multipart after 7 days

evidence bucket:
  Object Lock retention 7 years from acceptance
  transition to infrequent/archive class after policy threshold
  keep non-current versions according to record policy

export bucket:
  expire exports after 30 days

audit archive:
  Object Lock + long-term retention
```

### 14.8 Failure Handling

| Scenario | Handling |
|---|---|
| Client uploads but never completes | reconciliation expires pending upload |
| DB record exists but S3 object missing | mark failed, allow retry |
| S3 event duplicated | scanner idempotency by document ID/version |
| Scanner fails | retry queue + DLQ + operator workflow |
| Copy to evidence succeeds but DB update fails | reconciliation by quarantine/evidence inventory |
| User tries access rejected object | application authorization denies |
| Legal hold applied | update metadata + S3 legal hold/object lock workflow |

---

## 15. Java Implementation Considerations

### 15.1 S3 Client Reuse

Create AWS SDK clients once and reuse them.

Bad:

```java
public byte[] download(String bucket, String key) {
    S3Client client = S3Client.create();
    return client.getObjectAsBytes(b -> b.bucket(bucket).key(key)).asByteArray();
}
```

Better:

```java
public final class EvidenceObjectStore {
    private final S3Client s3;

    public EvidenceObjectStore(S3Client s3) {
        this.s3 = s3;
    }

    public ResponseBytes<GetObjectResponse> get(String bucket, String key, String versionId) {
        return s3.getObjectAsBytes(req -> req
            .bucket(bucket)
            .key(key)
            .versionId(versionId));
    }
}
```

For large downloads, do not load entire object into memory. Stream it.

### 15.2 Avoid Memory Explosion

Bad:

```java
byte[] file = s3.getObjectAsBytes(req).asByteArray();
process(file);
```

For large objects:

```java
try (ResponseInputStream<GetObjectResponse> in = s3.getObject(req)) {
    processStream(in);
}
```

Or use async/reactive pipeline carefully with backpressure.

### 15.3 Presigner as Application Boundary

```java
S3Presigner presigner = S3Presigner.builder()
    .region(region)
    .build();
```

Presigned URL generation must be inside a domain authorization flow.

Do not expose generic “presign any key” endpoint.

Bad API:

```text
POST /s3/presign
{ "bucket": "...", "key": "...", "method": "PUT" }
```

Better API:

```text
POST /cases/{caseId}/evidence/upload-intents
```

The backend chooses bucket/key based on domain rules.

### 15.4 Idempotency

For upload completion:

```text
idempotency key = uploadIntentId
```

Completion can be retried safely:

- if status already AVAILABLE, return current result;
- if status SCANNING, return accepted/pending;
- if object missing, return recoverable error;
- if checksum mismatch, mark rejected.

### 15.5 Error Handling

AWS SDK exceptions should be mapped to domain behavior.

| AWS Error | Possible Domain Handling |
|---|---|
| NoSuchKey | document not available / reconciliation needed |
| AccessDenied | security misconfiguration or forbidden |
| SlowDown/Throttling | retry/backoff, alert if persistent |
| KMS AccessDenied | deployment/security incident |
| 5xx | retry with bounded backoff |
| Timeout | unknown outcome for write; verify with HEAD/idempotency |

Do not blindly retry all errors.

### 15.6 Timeouts

Set explicit timeouts:

- API call timeout;
- attempt timeout;
- connection timeout;
- socket/read timeout;
- application request timeout.

Storage calls can hang long enough to exhaust servlet/request threads if not controlled.

### 15.7 Large File Upload Strategy

Options:

- backend streaming upload;
- presigned single PUT;
- presigned multipart upload;
- browser/client direct upload;
- transfer manager.

Decision factors:

- max file size;
- client network reliability;
- need for scanning;
- bandwidth cost;
- backend thread model;
- audit needs;
- retry behavior.

For large files, presigned multipart upload often gives best scalability, but implementation complexity is higher.

---

## 16. Anti-Patterns

### 16.1 S3 sebagai Database

S3 is not a relational database.

Bad:

```text
Store JSON state objects in S3 and list prefix to answer user queries.
```

Use S3 for object bodies, not primary transactional query path unless workload is deliberately object/data-lake oriented.

### 16.2 EFS sebagai Hidden Integration Bus

Bad:

```text
Service A writes files to /shared/inbox.
Service B polls /shared/inbox.
Service C moves files to /shared/done.
```

This hides workflow state in filesystem. Prefer SQS/EventBridge/Step Functions unless legacy constraint forces file-based integration.

### 16.3 EBS State in Autoscaling Fleet

Bad:

```text
Each app instance stores business data locally.
ASG scales in randomly.
```

If state matters, externalize it or design stateful lifecycle explicitly.

### 16.4 One Bucket for Everything

Bad:

```text
prod-bucket/
  uploads/
  evidence/
  logs/
  exports/
  temp/
  public-assets/
```

Different data classes need different policy, retention, lifecycle, audit, and access boundary.

### 16.5 Lifecycle Without Ownership

Bad:

```text
Add lifecycle rule to delete prefix after 30 days because “probably temp”.
```

Lifecycle is deletion automation. Treat it like production code.

### 16.6 Public S3 Object for Convenience

Bad:

```text
Make uploaded documents public and store URL in DB.
```

Use private bucket + presigned URL or CloudFront signed access.

---

## 17. Architecture Decision Record Template

Gunakan template ini ketika memilih storage.

```markdown
# ADR: Storage Choice for <Workload/Data Class>

## Context
- What data is stored?
- Who produces it?
- Who consumes it?
- Is it source of truth?
- Is it regulated/sensitive?
- Expected size/object count/growth?
- Access pattern?

## Decision
We will use <S3/EBS/EFS/FSx/...> for <data class>.

## Rationale
- Data shape:
- Access protocol:
- Durability requirement:
- Availability requirement:
- Latency/throughput requirement:
- Security requirement:
- Retention/lifecycle requirement:
- Cost model:
- Operational ownership:

## Alternatives Considered
- Alternative A:
- Alternative B:
- Alternative C:

## Failure Modes
- Access denied:
- Data loss:
- Lifecycle mistake:
- KMS issue:
- Regional/AZ issue:
- Cost runaway:

## Invariants
- Data must never be publicly accessible.
- Source-of-truth metadata lives in <DB>.
- Object body lives in <bucket>.
- Every object must have checksum and owner metadata.
- Retention is controlled by <policy>.

## Operational Plan
- Backup:
- Restore test:
- Monitoring:
- Audit:
- Lifecycle review:
- Incident runbook:
```

---

## 18. Review Checklist

### 18.1 S3 Checklist

- [ ] Bucket purpose is single and clear.
- [ ] Public access is blocked unless explicitly justified.
- [ ] Bucket policy is reviewed.
- [ ] IAM role permissions are least privilege.
- [ ] KMS key policy matches runtime role.
- [ ] Versioning decision is explicit.
- [ ] Object Lock decision is explicit.
- [ ] Lifecycle rules are reviewed and tested.
- [ ] Incomplete multipart uploads are aborted.
- [ ] Metadata DB stores bucket/key/version/checksum/size/status.
- [ ] Presigned URL expiry is short.
- [ ] Object key does not leak sensitive data unnecessarily.
- [ ] S3 events are processed idempotently.
- [ ] CloudTrail data events enabled for sensitive buckets.
- [ ] Restore/recovery procedure exists.

### 18.2 EBS Checklist

- [ ] Volume type matches I/O requirement.
- [ ] Encryption by default enabled.
- [ ] DeleteOnTermination is intentional.
- [ ] Snapshot lifecycle exists.
- [ ] Restore test performed.
- [ ] KMS key availability considered for DR.
- [ ] Orphan volume cleanup exists.
- [ ] Filesystem usage monitored.
- [ ] App consistency during snapshot considered.

### 18.3 EFS Checklist

- [ ] Shared filesystem is truly needed.
- [ ] Access points used where appropriate.
- [ ] Mount targets exist in required AZs.
- [ ] Security groups restrict NFS access.
- [ ] UID/GID permissions tested.
- [ ] Throughput/performance mode chosen consciously.
- [ ] Backup and restore process exists.
- [ ] Lifecycle and cleanup exist.
- [ ] Service coupling via shared paths is documented.

### 18.4 FSx Checklist

- [ ] FSx type matches protocol/workload requirement.
- [ ] Identity integration tested.
- [ ] Performance/capacity modeled.
- [ ] Backup/restore tested.
- [ ] Migration compatibility validated.
- [ ] Cost model reviewed.

---

## 19. Latihan Praktis

### Latihan 1 — Pilih Storage untuk Document Upload

Requirement:

- user upload PDF sampai 500 MB;
- harus discan malware;
- harus private;
- download hanya oleh user authorized;
- retention 5 tahun;
- metadata query by case.

Tugas:

1. Pilih storage utama.
2. Rancang bucket/prefix.
3. Rancang upload state machine.
4. Rancang lifecycle.
5. Rancang failure handling.

Jawaban yang diharapkan:

- S3 sebagai object body store.
- Metadata di database.
- Quarantine bucket + clean/evidence bucket.
- Presigned multipart upload jika file besar.
- Versioning/Object Lock sesuai retention.
- Idempotent scan workflow.

### Latihan 2 — Evaluasi EFS untuk Shared Reports

Requirement:

- beberapa ECS tasks generate report;
- API task harus melayani download;
- report bisa dihapus setelah 7 hari.

Pertanyaan:

- Apakah EFS perlu?
- Apakah S3 lebih cocok?
- Apa trade-off-nya?

Analisis:

Jika report adalah final object untuk download, S3 biasanya lebih cocok. EFS mungkin hanya masuk akal jika generator legacy butuh shared POSIX path atau report dirakit oleh beberapa process yang perlu filesystem shared.

### Latihan 3 — Recovery Drill

Buat runbook untuk:

```text
Accidental deletion of evidence object in production.
```

Harus mencakup:

- detection;
- impact assessment;
- versioning/Object Lock status;
- restore steps;
- audit steps;
- customer/regulatory communication;
- prevention follow-up.

---

## 20. Ringkasan Mental Model

Storage architecture di AWS harus dimulai dari data semantics, bukan service name.

S3 adalah object API storage. Sangat kuat untuk object, evidence, archive, data lake, upload/download, artifact, dan lifecycle. Tetapi bukan filesystem biasa dan bukan database transaksi.

EBS adalah zonal block storage. Sangat penting untuk EC2 dan stateful workload berbasis block device. Tetapi availability dan recovery harus dirancang eksplisit.

EFS adalah managed shared NFS. Berguna untuk shared Linux file access, tetapi bisa menjadi sumber coupling tersembunyi dan harus diuji performanya.

FSx adalah keluarga managed file system khusus. Pilih jika workload membutuhkan protocol/semantics/performance yang spesifik.

Top engineer akan selalu menanyakan:

```text
What is the data class?
What is the source of truth?
What is the access path?
What is the lifecycle?
What is the failure mode?
What is the recovery path?
What is the cost model?
What is the audit/compliance boundary?
```

Jika jawaban atas pertanyaan-pertanyaan ini jelas, pilihan storage biasanya menjadi jauh lebih mudah.

---

## 21. Referensi Resmi AWS

- Amazon S3 User Guide — What is Amazon S3: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html
- Amazon S3 Presigned URLs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
- Amazon S3 Object Lock: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- Amazon S3 Lifecycle transitions: https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html
- Amazon S3 Event Notifications: https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html
- Amazon S3 Integrity/Checksums: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html
- Amazon EBS Volume Types: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html
- Amazon EBS Encryption: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html
- Amazon EBS Encryption by Default: https://docs.aws.amazon.com/ebs/latest/userguide/encryption-by-default.html
- Amazon EBS Snapshots: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html
- Amazon EFS Overview: https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html
- Amazon EFS Performance: https://docs.aws.amazon.com/efs/latest/ug/performance.html
- Amazon EFS Throughput: https://docs.aws.amazon.com/efs/latest/ug/managing-throughput.html
- Amazon FSx Documentation: https://docs.aws.amazon.com/fsx/

---

## 22. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-012.md
```

Judul:

```text
Application Data on AWS: Managed Relational, Key-Value, Document, Search, Cache without Repeating Database Internals
```

Fokus berikutnya adalah data services managed di AWS: RDS, Aurora, DynamoDB, ElastiCache, OpenSearch, DocumentDB, Neptune, Timestream, Redshift, DMS, dan bagaimana memilih/menjalankannya tanpa mengulang materi database internal yang sudah dibahas di seri lain.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Lambda for Java Engineers: Event Runtime, Concurrency, Idempotency, dan Cold Start</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-012.md">Part 012 — Application Data on AWS: Managed Relational, Key-Value, Document, Search, Cache without Repeating Database Internals ➡️</a>
</div>
