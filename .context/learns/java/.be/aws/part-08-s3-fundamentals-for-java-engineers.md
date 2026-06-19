# Part 8 — S3 Fundamentals for Java Engineers

Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-08-s3-fundamentals-for-java-engineers.md`  
Target Java: 8 sampai 25  
Fokus SDK: AWS SDK for Java 2.x  
Status: Part 8 dari 35

---

## 0. Tujuan Bagian Ini

Bagian ini membahas Amazon S3 dari sudut pandang **Java engineer yang membangun sistem production**, bukan dari sudut pandang “cara upload file ke bucket”.

S3 kelihatannya sederhana:

```text
putObject(bucket, key, file)
getObject(bucket, key)
```

Tetapi di sistem nyata, S3 sering menjadi:

- storage utama untuk file user;
- landing zone untuk integrasi antar sistem;
- archive untuk audit dan compliance;
- source event untuk pipeline;
- boundary antara synchronous API dan asynchronous processing;
- buffer untuk large payload yang tidak cocok lewat database atau message queue;
- tempat menyimpan report, document, evidence, export, import, backup, dan payload historis.

Maka mental model yang benar adalah:

> S3 bukan filesystem remote. S3 adalah distributed object storage dengan API, identity model, consistency model, encryption model, event model, cost model, dan failure model sendiri.

Setelah bagian ini, kamu harus mampu:

1. Membedakan object storage dengan filesystem dan database.
2. Mendesain bucket/key/object metadata secara sadar.
3. Memahami consistency, versioning, overwrite, delete marker, dan listing behavior.
4. Memahami kapan memakai metadata, tag, prefix, object lock, lifecycle, dan storage class.
5. Memahami dasar upload/download dari Java dengan SDK v2.
6. Menghindari anti-pattern umum seperti memperlakukan S3 sebagai POSIX filesystem.
7. Membuat desain S3 yang siap dipakai untuk sistem audit, document management, ingestion pipeline, dan event-driven processing.

---

## 1. Referensi Resmi yang Menjadi Dasar

Beberapa fakta penting yang dipakai dalam materi ini berasal dari dokumentasi AWS resmi:

- AWS SDK for Java 2.x adalah SDK Java modern untuk membangun aplikasi Java yang bekerja dengan layanan AWS seperti S3, DynamoDB, dan lainnya.
- Amazon S3 saat ini menyediakan strong read-after-write consistency untuk operasi read dan list setelah write berhasil.
- AWS menyatakan bahwa S3 dapat menskalakan performa berdasarkan prefix; panduan performa resmi menyebut angka baseline per prefix untuk request rate tinggi.
- Upload object ke S3 secara default dienkripsi server-side memakai SSE-S3.
- Presigned URL memungkinkan pihak lain upload/download object tanpa memiliki credential AWS langsung, tetapi haknya dibatasi oleh permission pembuat URL.

Catatan penting: detail limit, runtime, API, dan fitur AWS dapat berubah. Untuk sistem production, selalu validasi ulang dengan dokumentasi AWS terbaru saat membuat keputusan final.

---

## 2. Mental Model Utama: S3 adalah Object Store, Bukan Filesystem

### 2.1 Filesystem Mental Model

Filesystem lokal biasanya punya konsep:

- directory nyata;
- file descriptor;
- append;
- rename atomic;
- lock file;
- partial update;
- seek/write pada offset tertentu;
- permission berbasis OS;
- path traversal;
- metadata filesystem;
- POSIX-like behavior.

Contoh operasi filesystem:

```java
Files.write(path, bytes, StandardOpenOption.APPEND);
Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE);
```

Pada filesystem, kamu bisa berpikir:

> File adalah sequence of bytes yang bisa dimodifikasi sebagian.

### 2.2 S3 Mental Model

S3 punya konsep:

- bucket;
- object key;
- object value/body;
- object metadata;
- object tag;
- version;
- storage class;
- encryption state;
- lifecycle policy;
- event notification;
- IAM/resource policy;
- HTTP-based object API.

Pada S3, object lebih tepat dipahami sebagai:

> Immutable object version yang ditulis sebagai satu unit logis, lalu dibaca sebagai satu unit atau range.

S3 tidak punya directory sebenarnya. `folder/2026/report.pdf` hanyalah object key string dengan delimiter `/`. Console AWS menampilkan prefix seperti folder untuk kenyamanan manusia.

### 2.3 Konsekuensi Desain

Karena S3 bukan filesystem:

- Jangan bergantung pada rename atomic seperti filesystem.
- Jangan append langsung ke object sebagai pola utama.
- Jangan mengubah sebagian kecil object besar dengan asumsi murah.
- Jangan membuat lock file naive untuk concurrency control.
- Jangan menganggap list prefix sama seperti scanning directory kecil.
- Jangan menyimpan data yang butuh transactional row-level update.
- Jangan memakai S3 sebagai database OLTP.

S3 sangat kuat untuk:

- object besar;
- write once read many;
- archive;
- document;
- event-driven ingestion;
- immutable evidence;
- export/import;
- backup;
- data lake landing zone;
- large payload offloading.

S3 kurang cocok untuk:

- low-latency random update;
- high-frequency small mutable records;
- transactional aggregate update;
- relational query;
- strict per-object locking;
- complex secondary index;
- synchronous coordination primitive.

---

## 3. S3 Core Abstractions

## 3.1 Bucket

Bucket adalah container global untuk object.

Bucket memiliki:

- name;
- region;
- policy;
- ownership setting;
- public access block;
- versioning setting;
- lifecycle rules;
- encryption default;
- event notification;
- logging/configuration;
- object lock setting jika diaktifkan;
- CORS jika dipakai dari browser.

### 3.1.1 Bucket sebagai Security Boundary

Bucket sering menjadi security boundary. Contoh:

```text
aceas-prod-documents
aceas-prod-audit-archive
aceas-prod-import-landing
aceas-prod-report-export
```

Tetapi terlalu banyak bucket juga membuat governance sulit. Pilihan bucket harus mempertimbangkan:

- boundary akses;
- boundary lifecycle;
- boundary encryption;
- boundary ownership;
- boundary event notification;
- boundary replication;
- boundary compliance;
- operational ownership.

Rule praktis:

> Pisahkan bucket jika aturan security, lifecycle, compliance, ownership, atau eventing benar-benar berbeda. Jangan memisahkan bucket hanya karena “folder beda”.

### 3.1.2 Bucket Naming

Bucket name bersifat global dalam partisi AWS. Maka nama harus stabil, unik, dan tidak mengandung informasi sensitif.

Contoh naming enterprise:

```text
<org>-<system>-<env>-<purpose>-<region>
```

Contoh:

```text
gov-aceas-prod-documents-ap-southeast-1
gov-aceas-uat-import-landing-ap-southeast-1
gov-aceas-dev-report-export-ap-southeast-1
```

Hindari:

```text
my-bucket
test-bucket
fajar-prod-secret-files
customer-nric-storage
```

Nama bucket bisa muncul di logs, error message, CloudTrail, dan konfigurasi. Jangan bocorkan domain sensitif jika tidak perlu.

---

## 3.2 Object Key

Object key adalah string identifier object di bucket.

Contoh:

```text
cases/2026/06/CASE-000123/documents/application-form.pdf
imports/agency-a/2026/06/19/batch-00001/source.csv
exports/reports/monthly/2026/06/report-abc123.xlsx
```

### 3.2.1 Key adalah Bagian dari Desain Data

Key bukan sekadar path. Key menentukan:

- discoverability;
- partitioning performa;
- lifecycle matching;
- event filtering;
- operational debugging;
- access pattern;
- replay strategy;
- audit traceability.

Key design yang buruk akan menghasilkan sistem yang susah dioperasikan.

### 3.2.2 Key Design Principle

Key harus menjawab:

1. Object ini milik domain apa?
2. Environment apa?
3. Tenant/agency apa jika multi-tenant?
4. Entity utama apa?
5. Tanggal atau partition apa?
6. Object ini berada di stage apa?
7. Apakah nama object mengandung data sensitif?
8. Apakah key bisa dipakai untuk lifecycle rule?
9. Apakah key bisa dipakai untuk event filter?
10. Apakah key stabil jika domain berubah?

### 3.2.3 Contoh Key Baik

Untuk document case management:

```text
cases/case-id=CASE-2026-000123/document-type=application-form/version=000001/object.pdf
```

Untuk ingestion:

```text
landing/source=agency-a/date=2026-06-19/batch-id=7f3e/input.csv
staging/source=agency-a/date=2026-06-19/batch-id=7f3e/normalized.parquet
quarantine/source=agency-a/date=2026-06-19/batch-id=7f3e/input.csv
processed/source=agency-a/date=2026-06-19/batch-id=7f3e/result.json
```

Untuk export:

```text
exports/report-type=monthly-compliance/year=2026/month=06/request-id=REQ-abc123/report.xlsx
```

### 3.2.4 Contoh Key Buruk

```text
file1.pdf
upload.pdf
temp.csv
new/final/latest/report.xlsx
users/john.doe@example.com/nric/S1234567A.pdf
```

Masalah:

- tidak stabil;
- tidak audit-friendly;
- raw PII di key;
- susah lifecycle;
- susah filter event;
- “latest” membuat overwrite semantics rawan;
- nama object tidak punya domain invariant.

### 3.2.5 Jangan Menaruh PII di Object Key

Object key sering muncul di:

- application logs;
- CloudTrail data events;
- S3 access logs;
- error message;
- metrics dimension;
- dashboard;
- support ticket;
- presigned URL;
- browser network tab.

Karena itu, jangan gunakan NRIC, email, phone number, nama lengkap, alamat, atau data sensitif sebagai bagian key.

Lebih aman:

```text
cases/case-id=CASE-2026-000123/documents/document-id=DOC-8d9a/object.pdf
```

atau:

```text
objects/sha256-prefix=ab/object-id=01JZ.../payload.bin
```

---

## 3.3 Object Body

Object body adalah byte payload.

S3 tidak peduli apakah body adalah:

- PDF;
- CSV;
- JSON;
- XML;
- ZIP;
- image;
- video;
- parquet;
- binary blob;
- encrypted application payload.

Tetapi Java application harus peduli terhadap:

- content length;
- content type;
- checksum;
- encoding;
- compression;
- memory pressure;
- streaming strategy;
- retry behavior;
- partial read;
- lifecycle;
- malware scanning jika user-uploaded.

Rule penting:

> Jangan load object besar ke heap hanya karena API Java membuatnya mudah.

---

## 3.4 Object Metadata

Object metadata adalah key-value information yang melekat pada object.

Ada dua jenis besar:

1. System metadata.
2. User-defined metadata.

System metadata meliputi hal seperti:

- content type;
- content length;
- ETag;
- last modified;
- storage class;
- server-side encryption info.

User-defined metadata biasanya dikirim sebagai `x-amz-meta-*` header.

Contoh:

```text
x-amz-meta-document-id: DOC-123
x-amz-meta-upload-request-id: REQ-456
x-amz-meta-source-system: portal
x-amz-meta-schema-version: 2
```

### 3.4.1 Metadata Bukan Database

Metadata berguna untuk informasi object-level yang dibutuhkan saat read/head object.

Tetapi metadata tidak cocok untuk:

- query kompleks;
- index global;
- filtering banyak object;
- mutable workflow state;
- data yang sering berubah;
- authorization decision kompleks.

Untuk query, gunakan database/index terpisah:

```text
S3: object payload
Database: object index, owner, status, workflow state, permissions, retention metadata
OpenSearch/ClickHouse/etc: search/analytics jika diperlukan
```

### 3.4.2 Metadata Update Semantics

Mengubah metadata object di S3 umumnya berarti membuat copy object dengan metadata baru. Ini bukan update ringan seperti update row di database.

Konsekuensi:

- jangan taruh mutable state di metadata;
- jangan mengubah metadata untuk setiap state transition;
- jangan jadikan metadata sebagai workflow engine.

---

## 3.5 Object Tags

Object tag adalah key-value label yang bisa dipakai untuk:

- lifecycle rule;
- cost allocation;
- access control condition;
- classification;
- data governance.

Contoh tag:

```text
classification=restricted
retention=7-years
source=agency-a
stage=landing
```

Metadata vs tag:

| Aspek | Metadata | Tag |
|---|---|---|
| Dibaca bersama object/head | Ya | Terpisah |
| Berguna untuk lifecycle | Terbatas | Ya |
| Berguna untuk IAM condition | Beberapa kasus | Kuat |
| Cocok untuk mutable classification | Lebih buruk | Lebih baik |
| Cocok untuk app context saat download | Ya | Tergantung |

Rule praktis:

- Metadata untuk informasi teknis object.
- Tag untuk classification, lifecycle, cost, governance.
- Database untuk state/query utama.

---

## 4. S3 Consistency Model

Dulu, banyak sistem harus memperhitungkan eventual consistency pada beberapa operasi S3. Saat ini Amazon S3 menyediakan strong read-after-write consistency untuk operasi object dan list setelah write berhasil.

Artinya setelah `PUT` berhasil:

- `GET` berikutnya akan melihat object terbaru;
- `HEAD` berikutnya akan melihat metadata terbaru;
- `LIST` akan mencerminkan perubahan tersebut.

Ini menyederhanakan banyak desain.

Namun, jangan menyimpulkan hal yang berlebihan.

Strong consistency tidak berarti:

- multi-object transaction;
- atomic rename folder;
- exactly-once event delivery;
- transactional workflow;
- no duplicate events;
- no race condition antar writer;
- no IAM propagation delay;
- no replication delay lintas region;
- no lifecycle/event notification delay.

### 4.1 Apa yang Aman Diasumsikan

Aman:

```text
PUT object berhasil -> GET object key yang sama membaca versi terbaru.
PUT object berhasil -> LIST prefix yang sesuai melihat object tersebut.
DELETE object berhasil -> GET object tanpa version tertentu tidak lagi menemukan current object.
```

Tergantung versioning:

```text
DELETE pada bucket versioning enabled -> membuat delete marker, bukan menghapus semua versi fisik.
```

Tidak aman:

```text
PUT A dan PUT B dianggap transaksi atomic.
COPY lalu DELETE dianggap rename atomic.
Event S3 pasti hanya muncul satu kali.
LIST bisa dipakai sebagai satu-satunya sumber kebenaran workflow.
```

### 4.2 Last Writer Wins

Jika dua writer menulis key yang sama tanpa koordinasi:

```text
Writer A -> PUT cases/123/file.pdf
Writer B -> PUT cases/123/file.pdf
```

Maka current object mengikuti write yang terakhir berhasil menurut S3. Jika versioning aktif, dua versi bisa tersimpan. Jika versioning tidak aktif, versi lama tertimpa.

Untuk sistem penting, hindari key yang bisa ditulis bersamaan tanpa idempotency/locking/version strategy.

Pilihan desain:

1. Immutable key per version.
2. Database row sebagai concurrency controller.
3. S3 versioning enabled.
4. Conditional write jika tersedia untuk use case tertentu.
5. Idempotency key.
6. Object lock untuk retention, bukan concurrency.

---

## 5. Versioning dan Delete Marker

S3 Versioning memungkinkan bucket menyimpan beberapa versi object dengan key yang sama.

Jika versioning enabled:

```text
PUT report.pdf -> version v1
PUT report.pdf -> version v2
DELETE report.pdf -> delete marker v3
GET report.pdf -> Not Found karena current version adalah delete marker
GET report.pdf?versionId=v2 -> masih bisa jika permission dan versi masih ada
```

### 5.1 Kapan Versioning Penting

Aktifkan versioning jika kamu perlu:

- recover dari overwrite tidak sengaja;
- recover dari delete tidak sengaja;
- audit object history;
- legal/compliance retention;
- replication yang lebih aman;
- protection terhadap beberapa jenis operational mistake.

### 5.2 Biaya Versioning

Versioning bukan gratis secara konseptual.

Risiko:

- object lama tetap memakan storage;
- delete marker menumpuk;
- lifecycle harus dirancang;
- restore menjadi lebih kompleks;
- aplikasi harus sadar version ID jika perlu traceability.

Rule praktis:

> Jika versioning aktif, lifecycle untuk non-current versions hampir selalu perlu dirancang.

### 5.3 Version ID sebagai Audit Anchor

Untuk sistem audit, simpan `versionId` di database saat upload berhasil.

Contoh tabel:

```text
DOCUMENT_OBJECT
- document_id
- bucket
- object_key
- version_id
- content_sha256
- size_bytes
- content_type
- uploaded_by
- uploaded_at
- kms_key_id
- retention_class
```

Dengan menyimpan version ID, kamu tidak hanya menunjuk “key”, tetapi menunjuk exact object version.

---

## 6. ETag, Checksum, dan Integrity

Banyak engineer mengira ETag selalu MD5. Itu tidak aman sebagai asumsi universal.

ETag dapat terlihat seperti MD5 untuk single-part upload tertentu, tetapi pada multipart upload atau encryption tertentu, ETag tidak boleh diperlakukan sebagai checksum payload sederhana.

### 6.1 Prinsip Integrity

Untuk sistem production:

- Jangan bergantung buta pada ETag sebagai hash bisnis.
- Jika integrity penting, hitung checksum sendiri.
- Simpan checksum eksplisit seperti SHA-256 di database atau metadata.
- Validasi content length.
- Gunakan checksum feature SDK/S3 jika cocok.

Contoh object index:

```text
object_key: cases/CASE-123/documents/DOC-456/object.pdf
version_id: 3HL4k...
sha256: 9f86d081884c7d659a2feaa0c55ad015...
size_bytes: 1048576
content_type: application/pdf
```

### 6.2 Integrity saat Upload dari Java

Saat upload file:

1. Hitung size.
2. Hitung checksum stream-safe.
3. Upload dengan metadata/checksum jika applicable.
4. Simpan result S3: bucket, key, version ID, ETag, checksum, request ID.
5. Jangan commit database sebelum upload sukses.
6. Jika commit database gagal setelah upload sukses, punya cleanup/reconciliation path.

Ini akan dibahas lebih dalam di Part 9 dan studi kasus pipeline.

---

## 7. Server-Side Encryption

S3 mendukung server-side encryption. Upload object ke S3 sekarang secara default memakai server-side encryption dengan S3 managed keys, tetapi sistem enterprise sering perlu menentukan strategy encryption secara eksplisit.

Tiga model umum:

1. SSE-S3.
2. SSE-KMS.
3. SSE-C.

### 7.1 SSE-S3

SSE-S3 dikelola oleh S3.

Cocok untuk:

- default encryption;
- workload umum;
- tidak perlu customer-managed KMS key;
- compliance yang menerima AWS-managed key model.

### 7.2 SSE-KMS

SSE-KMS memakai AWS KMS key.

Cocok untuk:

- audit KMS key usage;
- customer-managed key;
- key policy control;
- separation of duties;
- regulated workload;
- stricter access boundary.

Konsekuensi:

- perlu permission KMS selain S3 permission;
- ada quota/throttle KMS;
- ada cost KMS request;
- cross-account access lebih kompleks;
- key policy harus benar.

### 7.3 SSE-C

SSE-C memakai customer-provided key. Ini jarang dipakai dalam aplikasi enterprise biasa karena key management menjadi tanggung jawab aplikasi/client.

Hindari kecuali ada alasan kuat.

### 7.4 Encryption Context sebagai Desain Audit

Saat memakai KMS, encryption context dapat membantu memberikan konteks cryptographic operation.

Contoh conceptual:

```text
caseId=CASE-2026-000123
documentId=DOC-456
system=aceas
```

Namun jangan menaruh PII sensitif sembarangan di context jika akan muncul di audit/log KMS.

---

## 8. Storage Class dan Lifecycle

S3 punya beberapa storage class. Pilihan storage class adalah keputusan antara:

- latency;
- retrieval frequency;
- availability/durability profile;
- retrieval cost;
- minimum storage duration;
- operational complexity.

### 8.1 Common Storage Class Mental Model

| Storage Class | Mental Model |
|---|---|
| Standard | frequently accessed, low-latency object |
| Intelligent-Tiering | akses tidak pasti, ingin auto-tiering |
| Standard-IA | jarang diakses, tetap butuh cepat saat diambil |
| One Zone-IA | jarang diakses dan bisa toleransi kehilangan AZ-level resilience tertentu |
| Glacier Instant Retrieval | archive tapi masih perlu akses cepat |
| Glacier Flexible Retrieval | archive lebih dingin, retrieval tidak instant |
| Glacier Deep Archive | archive sangat dingin, cost storage rendah, retrieval lambat |

### 8.2 Lifecycle Policy

Lifecycle policy bisa:

- transition object ke storage class lain;
- expire current object;
- delete non-current versions;
- abort incomplete multipart upload;
- clean delete markers.

Lifecycle adalah bagian dari desain sejak awal.

Contoh lifecycle mental model:

```text
landing/       -> expire after 14 days if processed
quarantine/    -> retain 180 days
processed/     -> transition to IA after 30 days, Glacier after 365 days
exports/       -> expire after 30 days
archive/       -> retain 7 years
```

### 8.3 Jangan Lifecycle Tanpa Domain Policy

Lifecycle bukan sekadar cost optimization. Lifecycle adalah data retention policy.

Sebelum membuat lifecycle, jawab:

- Apakah object punya legal retention?
- Apakah object menjadi evidence?
- Apakah object perlu recovery?
- Apakah object bisa diregenerasi?
- Apakah ada policy regulator/client?
- Apakah delete harus disetujui?
- Apakah audit trail tetap cukup setelah object expire?

---

## 9. Object Lock, Retention, dan Legal Hold

S3 Object Lock dapat membantu membuat object immutable untuk periode tertentu.

Gunanya:

- WORM storage;
- compliance archive;
- audit evidence;
- legal hold;
- protection dari deletion/overwrite.

Mode umum:

1. Governance mode.
2. Compliance mode.

Governance mode lebih fleksibel untuk privileged user tertentu. Compliance mode jauh lebih ketat.

Peringatan:

> Object Lock adalah fitur compliance serius. Jangan aktifkan tanpa memahami konsekuensi operational dan legal.

Untuk sistem regulatory, Object Lock bisa menjadi bagian dari defensibility, tetapi harus dirancang bersama policy retention, IAM, KMS, lifecycle, dan legal operation.

---

## 10. Presigned URL

Presigned URL memungkinkan pihak yang tidak punya AWS credentials langsung melakukan operasi tertentu terhadap object S3 dalam jangka waktu terbatas.

Use case:

- browser upload langsung ke S3;
- download file besar tanpa melewati application server;
- temporary sharing;
- mobile upload;
- cross-system handoff terbatas.

### 10.1 Mental Model Presigned URL

Presigned URL adalah:

> URL yang membawa signature sementara untuk melakukan operasi tertentu dengan permission dari principal yang membuat URL.

Konsekuensi:

- URL adalah bearer capability.
- Siapa pun yang memegang URL bisa memakainya sampai expire, kecuali ada boundary tambahan.
- Permission efektif tidak bisa melebihi permission pembuat URL.
- Expiration harus pendek sesuai risiko.
- Jangan log full presigned URL.

### 10.2 Upload via Presigned URL

Pattern:

```text
Browser -> App: minta izin upload
App -> DB: create upload session
App -> S3 SDK: generate presigned PUT/POST
App -> Browser: return URL + required headers
Browser -> S3: upload file
S3 -> Event/SQS or Browser -> App: notify completion
App -> S3 HeadObject: validate size/type/checksum
App -> DB: mark uploaded
```

Jangan langsung percaya bahwa upload selesai hanya karena browser bilang selesai. Validasi dengan `HeadObject` atau processing event.

### 10.3 Security Checklist Presigned URL

- Expiration pendek.
- Key ditentukan server, bukan client bebas.
- Content type dibatasi jika bisa.
- Content length dibatasi di application flow.
- Upload session punya status.
- Setelah upload, object divalidasi.
- Jangan expose bucket internal naming jika tidak perlu.
- Jangan log URL penuh.
- Jangan gunakan URL yang bisa overwrite object penting tanpa guard.

---

## 11. Multipart Upload Dasar

Multipart upload memecah object besar menjadi beberapa part. Ini penting untuk:

- file besar;
- retry partial;
- throughput tinggi;
- upload parallel;
- menghindari restart dari nol saat satu part gagal.

Namun multipart upload juga membawa failure mode:

- upload belum complete;
- part orphaned;
- biaya storage untuk incomplete upload;
- ETag bukan MD5 payload sederhana;
- complete multipart butuh daftar part benar;
- abort perlu dilakukan saat gagal.

### 11.1 Lifecycle untuk Incomplete Multipart Upload

Bucket production sebaiknya punya lifecycle rule untuk abort incomplete multipart upload setelah periode tertentu.

Contoh mental policy:

```text
Abort incomplete multipart upload after 7 days
```

Jika tidak, kegagalan upload berulang dapat meninggalkan part yang memakan biaya.

### 11.2 Kapan Multipart Diperlukan

Gunakan multipart saat:

- object besar;
- jaringan tidak stabil;
- throughput penting;
- retry full object terlalu mahal;
- upload dari service backend yang bisa parallel.

Untuk file kecil, single put lebih sederhana.

Part 9 akan membahas multipart/streaming/Transfer Manager secara jauh lebih dalam.

---

## 12. S3 Performance Fundamentals

S3 dapat menskalakan request tinggi. AWS memberikan panduan performa berbasis prefix, misalnya ribuan request per detik per prefix untuk GET/HEAD dan write operation.

Namun performa bukan hanya limit S3.

Performa end-to-end dipengaruhi oleh:

- client HTTP connection pool;
- DNS/network path;
- TLS;
- object size;
- request concurrency;
- retry;
- KMS throttle jika SSE-KMS;
- Lambda/container CPU dan memory;
- NAT Gateway/VPC endpoint;
- SDK sync vs async;
- backpressure;
- downstream processing.

### 12.1 Prefix dan Scaling

Prefix adalah bagian awal key.

Contoh:

```text
cases/2026/06/19/...
```

Jika semua traffic panas masuk ke prefix sempit, desain bisa membatasi scaling atau membuat hotspot operational.

Desain prefix untuk high-throughput ingestion bisa menggunakan partition:

```text
landing/source=agency-a/date=2026-06-19/partition=00/...
landing/source=agency-a/date=2026-06-19/partition=01/...
landing/source=agency-a/date=2026-06-19/partition=02/...
```

Namun jangan over-engineer untuk traffic kecil. Complexity harus mengikuti workload.

### 12.2 Java Client Bottleneck

Sering kali bottleneck bukan S3, tetapi aplikasi Java:

- membuat S3Client per request;
- connection pool terlalu kecil;
- timeout terlalu longgar;
- thread pool habis;
- read object besar ke heap;
- retry storm;
- blocking async event loop;
- KMS throttle;
- NAT bottleneck;
- logging payload terlalu besar.

S3 performance harus dilihat end-to-end.

---

## 13. Basic AWS SDK for Java 2.x S3 Usage

Bagian ini hanya dasar. Detail advanced akan dibahas di Part 9.

### 13.1 Dependency Maven

Gunakan BOM agar versi module konsisten.

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>2.x.x</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>s3</artifactId>
    </dependency>
</dependencies>
```

Gunakan versi terbaru yang divalidasi oleh organisasi. Jangan campur versi module SDK sembarangan.

### 13.2 Membuat S3Client

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

public final class S3Clients {

    private S3Clients() {
    }

    public static S3Client createDefault(Region region) {
        return S3Client.builder()
                .region(region)
                .build();
    }
}
```

Client menggunakan default credentials provider chain kecuali dikonfigurasi lain.

Rule:

> Buat S3Client sebagai singleton/application-scoped bean. Jangan buat per request.

### 13.3 Put Object dari File

```java
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;
import software.amazon.awssdk.core.sync.RequestBody;

import java.nio.file.Path;
import java.util.Map;

public final class S3ObjectWriter {

    private final S3Client s3;
    private final String bucket;

    public S3ObjectWriter(S3Client s3, String bucket) {
        this.s3 = s3;
        this.bucket = bucket;
    }

    public PutObjectResponse putPdf(Path file, String key, String documentId, String requestId) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType("application/pdf")
                .metadata(Map.of(
                        "document-id", documentId,
                        "upload-request-id", requestId,
                        "schema-version", "1"
                ))
                .build();

        return s3.putObject(request, RequestBody.fromFile(file));
    }
}
```

Catatan Java 8:

`Map.of` tidak tersedia di Java 8. Gunakan `HashMap` biasa atau helper method.

### 13.4 Put Object Java 8 Compatible

```java
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;
import software.amazon.awssdk.core.sync.RequestBody;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

public final class Java8S3ObjectWriter {

    private final S3Client s3;
    private final String bucket;

    public Java8S3ObjectWriter(S3Client s3, String bucket) {
        this.s3 = s3;
        this.bucket = bucket;
    }

    public PutObjectResponse putPdf(Path file, String key, String documentId, String requestId) {
        Map<String, String> metadata = new HashMap<String, String>();
        metadata.put("document-id", documentId);
        metadata.put("upload-request-id", requestId);
        metadata.put("schema-version", "1");

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType("application/pdf")
                .metadata(metadata)
                .build();

        return s3.putObject(request, RequestBody.fromFile(file));
    }
}
```

### 13.5 Get Object ke File

```java
import software.amazon.awssdk.core.sync.ResponseTransformer;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;

import java.nio.file.Path;

public final class S3ObjectReader {

    private final S3Client s3;
    private final String bucket;

    public S3ObjectReader(S3Client s3, String bucket) {
        this.s3 = s3;
        this.bucket = bucket;
    }

    public GetObjectResponse downloadToFile(String key, Path target) {
        GetObjectRequest request = GetObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build();

        return s3.getObject(request, ResponseTransformer.toFile(target));
    }
}
```

### 13.6 Head Object

`HeadObject` berguna untuk validasi tanpa download payload.

```java
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;

public final class S3ObjectInspector {

    private final S3Client s3;
    private final String bucket;

    public S3ObjectInspector(S3Client s3, String bucket) {
        this.s3 = s3;
        this.bucket = bucket;
    }

    public HeadObjectResponse inspect(String key) {
        HeadObjectRequest request = HeadObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build();

        return s3.headObject(request);
    }
}
```

Use case:

- cek object ada;
- cek size;
- cek content type;
- cek metadata;
- cek encryption;
- cek version;
- validasi upload presigned URL.

---

## 14. Error Handling Dasar untuk S3

S3 error melalui AWS SDK v2 umumnya masuk ke:

- `S3Exception` untuk service-side S3 error;
- `SdkClientException` untuk client-side/network/config error;
- exception Java IO untuk file lokal tergantung operasi.

Contoh:

```java
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

public final class SafeS3Reader {

    private final S3Client s3;

    public SafeS3Reader(S3Client s3) {
        this.s3 = s3;
    }

    public boolean exists(String bucket, String key) {
        try {
            s3.headObject(builder -> builder.bucket(bucket).key(key));
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return false;
            }
            throw e;
        } catch (SdkClientException e) {
            throw e;
        }
    }
}
```

Namun hati-hati: `403 AccessDenied` dan `404 NotFound` bisa sengaja dibuat ambigu tergantung permission. Jangan jadikan `exists()` sebagai security oracle untuk user.

### 14.1 S3 Error Decision Table

| Error | Arti Umum | Respons Umum |
|---|---|---|
| 400 Bad Request | request invalid | fail-fast, fix code/config |
| 403 AccessDenied | IAM/bucket/KMS denied | fail-fast, alert/config fix |
| 404 NoSuchKey | object tidak ada | domain decision |
| 409 Conflict | conflict state tertentu | evaluate idempotency/retry |
| 412 PreconditionFailed | conditional request gagal | handle concurrency/idempotency |
| 429/503 SlowDown | throttling/pressure | retry dengan backoff/jitter |
| 500/503 | service transient | retry bounded |
| timeout | network/service/client delay | retry bounded atau fail sesuai SLA |

---

## 15. S3 Permission Model untuk Java App

Java app biasanya butuh permission minimal sesuai operasi.

Contoh read-only object tertentu:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject"
  ],
  "Resource": "arn:aws:s3:::example-bucket/cases/*"
}
```

Contoh upload:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject"
  ],
  "Resource": "arn:aws:s3:::example-bucket/landing/*"
}
```

Contoh list prefix:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:ListBucket"
  ],
  "Resource": "arn:aws:s3:::example-bucket",
  "Condition": {
    "StringLike": {
      "s3:prefix": [
        "landing/source=agency-a/*"
      ]
    }
  }
}
```

### 15.1 GetObject Tidak Sama dengan ListBucket

Aplikasi bisa punya `GetObject` tanpa `ListBucket`. Artinya:

- bisa mengambil object jika tahu key;
- tidak bisa list isi bucket.

Ini sering diinginkan untuk least privilege.

### 15.2 KMS Permission

Jika object memakai SSE-KMS, permission S3 saja tidak cukup. Principal juga perlu permission KMS seperti decrypt/generate data key sesuai operasi.

Ini sering menjadi penyebab error production:

```text
S3 AccessDenied, padahal s3:GetObject sudah ada.
Root cause: KMS key policy/IAM tidak mengizinkan decrypt.
```

---

## 16. S3 sebagai Document Store untuk Case Management

Untuk domain case management/regulatory, S3 sering dipakai menyimpan:

- application form;
- supporting document;
- evidence file;
- correspondence attachment;
- generated PDF;
- signed document;
- audit export.

Desain yang baik memisahkan:

```text
Database:
- document identity
- owner/case relation
- status
- permissions
- retention class
- object pointer
- checksum
- uploader
- timestamps
- workflow state

S3:
- actual bytes
- object metadata
- object tags
- object version
```

### 16.1 Contoh Model

```text
CASE
- case_id
- status
- applicant_id

DOCUMENT
- document_id
- case_id
- document_type
- status
- classification
- created_at

DOCUMENT_OBJECT
- document_object_id
- document_id
- bucket
- object_key
- version_id
- content_type
- size_bytes
- sha256
- uploaded_by
- uploaded_at
- s3_etag
- kms_key_id
```

Kenapa object pointer dipisahkan?

Karena satu document bisa punya:

- original upload;
- normalized PDF;
- redacted version;
- signed version;
- scanned version;
- OCR text;
- historical versions.

### 16.2 Invariant Penting

Untuk sistem regulatory:

```text
Invariant 1:
Setiap DOCUMENT_OBJECT yang statusnya ACTIVE harus menunjuk ke bucket+key+version yang bisa dibaca oleh role aplikasi.

Invariant 2:
Checksum yang tersimpan harus sesuai dengan payload object.

Invariant 3:
User-facing download harus melewati authorization database, bukan hanya possession of S3 key.

Invariant 4:
Delete logical di database tidak boleh otomatis physical delete jika retention policy belum mengizinkan.

Invariant 5:
Audit log harus mencatat siapa upload/download/delete logical, bukan hanya S3 access log.
```

---

## 17. S3 sebagai Integration Landing Zone

S3 sering dipakai untuk integrasi batch antar sistem.

Contoh:

```text
External Agency -> S3 landing bucket -> Event -> SQS -> Java worker -> DB
```

### 17.1 Folder Stage Pattern

```text
landing/
staging/
processed/
quarantine/
failed/
archive/
```

Makna:

- `landing`: file mentah masuk.
- `staging`: file sedang/siap dinormalisasi.
- `processed`: file berhasil diproses.
- `quarantine`: file invalid/malicious/suspicious.
- `failed`: file gagal karena technical failure.
- `archive`: file disimpan jangka panjang.

### 17.2 Jangan Mengandalkan Move Atomic

Di S3, “move” biasanya copy lalu delete.

Jadi ini bukan atomic:

```text
copy landing/file.csv -> processed/file.csv
delete landing/file.csv
```

Jika proses mati di tengah, bisa ada dua object atau object di stage tidak konsisten.

Desain yang lebih aman:

- gunakan database/job state sebagai source of truth;
- treat S3 stage sebagai physical organization, bukan transactional state;
- buat reconciliation job;
- gunakan idempotency;
- simpan processing result eksplisit.

### 17.3 Event Notification Caveat

S3 event notification berguna, tetapi handler harus siap terhadap:

- duplicate event;
- delay;
- object sudah dihapus saat event diproses;
- event out-of-order untuk workflow tertentu;
- permission issue saat read;
- partial processing failure.

Pattern aman:

```text
S3 Event -> SQS -> Java Worker
```

Daripada langsung:

```text
S3 Event -> Lambda heavy processing
```

SQS memberikan buffer, retry boundary, DLQ, dan operational visibility.

---

## 18. S3 dan Database: Source of Truth

Pertanyaan penting:

> Untuk metadata bisnis, source of truth ada di S3 atau database?

Jawaban production umumnya:

```text
S3 adalah source of truth untuk bytes object.
Database adalah source of truth untuk business state, ownership, authorization, workflow, dan index.
```

Jangan menjadikan `ListObjects` sebagai query utama aplikasi user-facing.

Buruk:

```text
User buka halaman documents -> app list S3 prefix cases/123/documents/ -> tampilkan hasil
```

Lebih baik:

```text
User buka halaman documents -> app query DB berdasarkan case_id dan permission -> app generate download link/object stream untuk object yang authorized
```

Alasan:

- DB bisa enforce authorization.
- DB bisa paginate/filter/sort dengan benar.
- DB bisa menyimpan status workflow.
- DB bisa menyimpan audit metadata.
- S3 key tidak perlu bocor.
- S3 list bukan query engine domain.

---

## 19. Upload Transaction Boundary

S3 dan database tidak berada dalam satu ACID transaction.

Contoh flow:

```text
1. Upload object ke S3 berhasil.
2. Insert DB gagal.
```

Hasil: orphan object.

Atau:

```text
1. Insert DB sebagai PENDING berhasil.
2. Upload S3 gagal.
```

Hasil: pending record tanpa object.

Tidak ada solusi ajaib. Harus desain state machine.

### 19.1 Pattern: Pending then Commit

```text
1. DB insert upload_session status=PENDING, object_key reserved.
2. Upload ke S3.
3. HeadObject/validate.
4. DB update document_object status=ACTIVE dengan version/checksum.
5. Jika step 2/3 gagal -> mark FAILED.
6. Reconciliation membersihkan stale PENDING/orphan.
```

### 19.2 Pattern: Upload then Index

```text
1. Upload ke S3 dengan deterministic key.
2. Insert DB index.
3. Jika DB gagal -> cleanup S3 atau mark orphan via reconciliation.
```

Cocok jika upload failure lebih sering daripada DB failure? Tergantung sistem.

### 19.3 Pattern: Event-Driven Indexing

```text
1. Upload object ke landing.
2. S3 event ke SQS.
3. Worker melakukan HeadObject/validasi.
4. Worker membuat DB record.
```

Cocok untuk ingestion, bukan selalu cocok untuk user-facing upload yang butuh response sinkron.

---

## 20. Download Strategy

Ada beberapa cara download object ke user:

### 20.1 App Proxy Streaming

```text
Browser -> App -> S3 -> App -> Browser
```

Kelebihan:

- authorization penuh di app;
- audit download mudah;
- bisa transform/redact;
- tidak expose presigned URL.

Kekurangan:

- app menanggung bandwidth;
- app thread/connection lebih lama;
- scaling lebih mahal;
- risiko memory jika streaming buruk.

### 20.2 Presigned Download

```text
Browser -> App: request download
App -> DB/AuthZ: validate
App -> S3: generate presigned GET
Browser -> S3: download
```

Kelebihan:

- app tidak jadi data path;
- cocok file besar;
- lebih scalable.

Kekurangan:

- URL dapat dibagikan selama belum expire;
- audit actual download lebih sulit;
- kontrol streaming/transform lebih rendah;
- object key/bucket mungkin terekspos.

### 20.3 Redirect/Short-Lived URL

App memberikan redirect ke presigned URL dengan expiration sangat pendek.

Cocok untuk UX download, tetapi tetap bearer capability.

### 20.4 Rule Praktis

| Use Case | Strategy |
|---|---|
| File kecil, perlu audit ketat | App proxy |
| File besar, user authorized, low risk | Presigned URL |
| Perlu redaction/watermark | App proxy/processing first |
| Internal system transfer | Presigned atau role-based direct S3 |
| Public asset | CloudFront/S3 dengan policy khusus |

---

## 21. Content Type dan Content Disposition

Saat upload, set content type dengan benar.

Contoh:

```java
PutObjectRequest request = PutObjectRequest.builder()
        .bucket(bucket)
        .key(key)
        .contentType("application/pdf")
        .contentDisposition("attachment; filename=\"application-form.pdf\"")
        .build();
```

Namun hati-hati dengan filename dari user. Jangan langsung masukkan input user mentah ke header.

Risiko:

- header injection;
- karakter aneh;
- path confusion;
- XSS pada content yang ditampilkan inline.

Untuk file user-uploaded, default aman sering:

```text
Content-Disposition: attachment
```

Bukan inline, kecuali sudah divalidasi.

---

## 22. S3 dan Malware Scanning

Jika menerima file dari user atau external system, pertimbangkan malware scanning.

Pattern:

```text
1. Upload ke landing/quarantine-unscanned.
2. Object tag scan-status=pending.
3. Scanner Lambda/worker mengambil object.
4. Jika clean -> tag clean, copy/promote ke clean prefix, DB status=AVAILABLE.
5. Jika infected -> quarantine, DB status=BLOCKED.
```

Jangan langsung membuat file user-uploaded tersedia untuk officer/user lain sebelum validasi jika threat model menuntut scanning.

---

## 23. S3 Object Naming untuk Idempotency

Key bisa random atau deterministic.

### 23.1 Random Key

```text
objects/01JZABCDEFGH/payload.pdf
```

Kelebihan:

- menghindari overwrite;
- aman untuk concurrency;
- mudah immutable.

Kekurangan:

- perlu DB untuk lookup;
- tidak human-readable.

### 23.2 Deterministic Key

```text
imports/source=agency-a/date=2026-06-19/batch-id=BATCH-001/input.csv
```

Kelebihan:

- idempotent upload untuk batch yang sama;
- mudah operasional;
- replay lebih jelas.

Kekurangan:

- overwrite risk;
- perlu concurrency guard;
- versioning penting.

### 23.3 Content-Addressed Key

```text
objects/sha256=abc123.../payload.bin
```

Kelebihan:

- deduplication;
- integrity-friendly;
- immutable by content.

Kekurangan:

- harus hitung hash sebelum key final;
- metadata domain tetap perlu DB;
- content privacy consideration.

---

## 24. S3 Anti-Patterns

### 24.1 S3 sebagai Database

Buruk:

```text
Setiap user profile disimpan sebagai JSON object.
Update field kecil -> read full JSON -> modify -> put full JSON.
List prefix untuk query user.
```

Masalah:

- race condition;
- no transaction;
- inefficient update;
- poor query;
- weak domain constraints;
- difficult authorization.

Gunakan database untuk data mutable/queryable.

### 24.2 S3 sebagai Lock Manager

Buruk:

```text
create object locks/job-123.lock
if exists, job running
```

Masalah:

- race;
- stale lock;
- no owner heartbeat;
- no atomic compare-and-set yang cukup untuk banyak kasus;
- operational ambiguity.

Gunakan DynamoDB conditional write, database lock, atau distributed coordination yang sesuai.

### 24.3 Upload Semua ke Satu Key `latest`

Buruk:

```text
reports/monthly/latest.xlsx
```

Masalah:

- overwrite history;
- audit sulit;
- cache confusion;
- concurrent writer;
- rollback sulit.

Lebih baik:

```text
reports/monthly/year=2026/month=06/report-id=REQ-123/output.xlsx
reports/monthly/current-pointer stored in DB/config
```

### 24.4 Menaruh Secret di S3 Tanpa Alasan

Untuk secret/config sensitif, gunakan Secrets Manager atau SSM Parameter Store, bukan object S3 biasa, kecuali ada pattern khusus dengan encryption dan access control ketat.

### 24.5 Membaca Object Besar ke `byte[]`

Buruk:

```java
byte[] data = s3.getObjectAsBytes(request).asByteArray();
```

Untuk object besar, ini bisa menghancurkan heap.

Lebih baik:

- stream ke file;
- stream ke response;
- process chunk;
- gunakan async/transfer manager untuk workload besar.

---

## 25. S3 Design Checklist

Sebelum memakai S3 dalam sistem Java, jawab pertanyaan berikut.

### 25.1 Data Model

- Apa object utama yang disimpan?
- Apakah object immutable atau mutable?
- Apakah perlu versioning?
- Apakah object punya metadata bisnis?
- Di mana source of truth metadata?
- Apakah object perlu checksum?
- Apakah object bisa diregenerasi?

### 25.2 Key Design

- Apa prefix strategy?
- Apakah key mengandung PII?
- Apakah key mendukung lifecycle?
- Apakah key mendukung event filter?
- Apakah key deterministic atau random?
- Bagaimana menangani overwrite?

### 25.3 Security

- Role mana yang bisa read/write/list/delete?
- Apakah perlu bucket policy?
- Apakah public access block aktif?
- Apakah perlu SSE-KMS?
- Apakah KMS key policy sudah benar?
- Apakah presigned URL aman?
- Apakah logs membocorkan key/URL?

### 25.4 Reliability

- Apa yang terjadi jika upload sukses tapi DB gagal?
- Apa yang terjadi jika DB sukses tapi upload gagal?
- Apakah ada reconciliation job?
- Apakah event duplicate aman?
- Apakah processing idempotent?
- Apakah incomplete multipart upload dibersihkan?

### 25.5 Observability

- Apakah app log bucket/key/version/request ID?
- Apakah ada metric upload/download latency?
- Apakah ada metric error by status code?
- Apakah ada audit log untuk user action?
- Apakah CloudTrail data events perlu diaktifkan?
- Apakah ada dashboard object processing?

### 25.6 Cost

- Berapa volume object?
- Berapa ukuran rata-rata?
- Berapa request rate?
- Berapa retrieval frequency?
- Apakah lifecycle sudah ada?
- Apakah CloudWatch/S3 access logging cost dipahami?
- Apakah SSE-KMS request cost signifikan?

---

## 26. Reference Architecture: Document Upload

### 26.1 Flow

```text
User
  |
  | 1. Upload request metadata
  v
Application API
  |
  | 2. Authorize user against case/document permission
  | 3. Create upload session PENDING in DB
  | 4. Generate object key
  | 5. Generate presigned PUT or receive multipart upload
  v
S3
  |
  | 6. Object uploaded
  v
Application API / Worker
  |
  | 7. HeadObject validate size/type/checksum
  | 8. Optional malware scan
  | 9. Mark document object ACTIVE
  | 10. Audit event
  v
Database + Audit Log
```

### 26.2 State Machine

```text
REQUESTED
  -> UPLOAD_URL_ISSUED
  -> UPLOADED
  -> VALIDATED
  -> SCANNED_CLEAN
  -> ACTIVE

Failure states:
  -> EXPIRED
  -> VALIDATION_FAILED
  -> SCAN_FAILED
  -> INFECTED
  -> ORPHAN_RECONCILED
```

### 26.3 Why State Machine Matters

Tanpa state machine, sistem mudah punya kondisi ambigu:

- file ada di S3 tapi UI tidak tampil;
- DB bilang file ada tapi object hilang;
- user upload dua kali;
- scan belum selesai tapi file bisa didownload;
- delete logical terjadi tetapi presigned URL lama masih aktif;
- audit tidak bisa menjelaskan siapa melakukan apa.

---

## 27. Reference Architecture: Batch Ingestion

### 27.1 Flow

```text
External System
  |
  | PutObject
  v
S3 landing/source=agency/date=...
  |
  | Event notification
  v
SQS ingestion queue
  |
  | poll
  v
Java Worker
  |
  | HeadObject + validate
  | Download/stream process
  | Write DB
  | Write result object
  | Mark job status
  v
Database + S3 processed/quarantine
```

### 27.2 Worker Invariants

```text
Invariant 1:
Processing the same S3 event twice must not create duplicate business records.

Invariant 2:
If object validation fails, object must be moved/tagged/recorded as quarantine or rejected.

Invariant 3:
If worker crashes midway, retry must be safe.

Invariant 4:
DLQ message must contain enough information to investigate bucket/key/version/error.

Invariant 5:
Object bytes and DB outcome must be reconcilable.
```

---

## 28. Java 8 sampai 25 Considerations

AWS SDK for Java 2.x mendukung Java 8+, tetapi gaya implementasi bisa berbeda antar versi Java.

### 28.1 Java 8

Pertimbangan:

- tidak ada `var`, `record`, `Map.of`, text block;
- lebih verbose;
- TLS/runtime dependency lebih tua;
- perlu hati-hati dependency modern;
- masih bisa memakai SDK v2.

Gunakan style sederhana:

```java
Map<String, String> metadata = new HashMap<String, String>();
metadata.put("document-id", documentId);
```

### 28.2 Java 11

Lebih baik untuk runtime modern dibanding Java 8:

- HTTP/client ecosystem lebih matang;
- TLS/JDK update lebih baik;
- container behavior membaik.

### 28.3 Java 17

Java 17 adalah baseline LTS yang sangat umum untuk enterprise modern.

Cocok untuk:

- Spring Boot 3;
- modern dependency;
- better GC;
- records/sealed classes untuk domain model jika cocok;
- improved observability/JFR.

### 28.4 Java 21

Java 21 membawa virtual threads. Namun AWS SDK async Netty dan virtual threads harus dipahami, bukan dicampur membabi buta.

Untuk S3:

- virtual thread bisa membantu blocking sync call pada workload tertentu;
- async client tetap berguna untuk high concurrency I/O;
- jangan block Netty event loop;
- ukur dengan benchmark realistis.

### 28.5 Java 25

Java 25 sebagai versi modern perlu divalidasi dengan runtime, framework, Lambda/container support, dan dependency compatibility. Untuk aplikasi container/EKS, adopsi bisa lebih cepat daripada managed runtime Lambda tergantung support AWS.

Rule:

> Pilih versi Java berdasarkan support runtime, security patch, framework compatibility, operational maturity, dan benchmark workload, bukan hanya karena versi paling baru.

---

## 29. Minimal Production Wrapper Pattern

Jangan sebar `s3.putObject` mentah di seluruh codebase.

Buat abstraction tipis yang domain-aware.

### 29.1 Interface

```java
import java.nio.file.Path;

public interface ObjectStorage {

    StoredObject putDocument(PutDocumentCommand command);

    ObjectMetadata inspect(ObjectPointer pointer);

    void downloadToFile(ObjectPointer pointer, Path target);

    PresignedDownload createDownloadUrl(ObjectPointer pointer, DownloadPolicy policy);
}
```

### 29.2 Pointer

```java
public final class ObjectPointer {

    private final String bucket;
    private final String key;
    private final String versionId;

    public ObjectPointer(String bucket, String key, String versionId) {
        this.bucket = bucket;
        this.key = key;
        this.versionId = versionId;
    }

    public String bucket() {
        return bucket;
    }

    public String key() {
        return key;
    }

    public String versionId() {
        return versionId;
    }
}
```

Java 16+ bisa memakai record:

```java
public record ObjectPointer(String bucket, String key, String versionId) {
}
```

### 29.3 Kenapa Wrapper?

Wrapper membantu:

- enforce key convention;
- enforce metadata/tagging;
- centralize timeout/retry behavior;
- centralize logging and metrics;
- prevent accidental public ACL;
- require checksum;
- avoid duplicated S3 code;
- make testing easier;
- abstract SDK migration detail.

Wrapper tidak boleh terlalu generik sampai menjadi SDK kedua yang rumit. Buat abstraction berdasarkan domain operation.

---

## 30. Operational Runbook Dasar S3

### 30.1 Object Tidak Bisa Dibaca

Checklist:

1. Bucket benar?
2. Region benar?
3. Key benar?
4. Version ID benar?
5. Object current version atau delete marker?
6. IAM role punya `s3:GetObject`?
7. Jika versioned, perlu `s3:GetObjectVersion`?
8. Jika SSE-KMS, punya `kms:Decrypt`?
9. Bucket policy menolak?
10. VPC endpoint policy menolak?
11. Object ownership/ACL issue?
12. Request memakai expected account/role?

### 30.2 Upload Lambat

Checklist:

1. Object size?
2. Single upload atau multipart?
3. Connection pool cukup?
4. Timeout terlalu rendah/tinggi?
5. Retry terjadi?
6. KMS throttle?
7. NAT Gateway/VPC endpoint bottleneck?
8. CPU/memory aplikasi?
9. Disk temp lambat?
10. Prefix hot?

### 30.3 Biaya S3 Naik

Checklist:

1. Storage growth bucket mana?
2. Versioning non-current menumpuk?
3. Incomplete multipart upload?
4. Lifecycle tidak jalan?
5. Request count tinggi?
6. CloudTrail data events mahal?
7. Access logs besar?
8. KMS request tinggi?
9. Glacier retrieval unexpected?
10. Export/report temporary tidak expire?

### 30.4 Banyak Orphan Object

Checklist:

1. Upload flow punya DB transaction gap?
2. Ada failed upload session?
3. Ada retry tanpa idempotency?
4. Ada browser upload yang tidak confirm?
5. Ada worker crash setelah upload sebelum DB commit?
6. Ada reconciliation job?
7. Key bisa dipetakan balik ke request/session?

---

## 31. Ringkasan Mental Model

S3 harus dipahami sebagai:

```text
Distributed object storage
+ key-value object namespace
+ HTTP API
+ IAM/resource policy boundary
+ encryption boundary
+ event source
+ lifecycle engine
+ audit/cost surface
+ integration substrate
```

Bukan sebagai:

```text
remote filesystem
transactional database
queue
lock manager
workflow engine
secret store
```

Prinsip utama:

1. Object key adalah desain domain, bukan string asal.
2. Metadata bukan database.
3. Tags berguna untuk lifecycle/governance.
4. Versioning membantu recovery, tetapi butuh lifecycle.
5. Strong consistency tidak berarti transactionality.
6. Presigned URL adalah bearer capability.
7. Multipart upload butuh cleanup strategy.
8. SSE-KMS menambah security dan audit, tetapi juga permission/cost/throttle complexity.
9. Database tetap diperlukan untuk business state dan authorization.
10. S3 event harus dianggap at-least-once style dan diproses idempotently.
11. Jangan membaca object besar ke heap.
12. Selalu desain failure path upload/download/indexing.

---

## 32. Latihan Pemahaman

### Latihan 1 — Document Store

Desain key S3 untuk dokumen case management dengan requirement:

- case punya banyak document;
- document bisa punya version;
- tidak boleh ada PII di key;
- perlu lifecycle berdasarkan classification;
- perlu audit version exact.

Jawab:

- bucket naming;
- key structure;
- metadata;
- tags;
- database columns;
- versioning strategy.

### Latihan 2 — Batch Ingestion

External agency upload CSV harian ke S3. File bisa dikirim ulang dengan batch ID sama.

Desain:

- prefix landing;
- idempotency key;
- SQS event processing;
- quarantine strategy;
- DB job state;
- duplicate event handling;
- DLQ payload.

### Latihan 3 — Presigned Upload

User upload PDF dari browser. Requirement:

- app server tidak boleh menerima file body;
- ukuran maksimal 20 MB;
- hanya PDF;
- file harus discan sebelum available;
- upload session expire 15 menit;
- audit harus mencatat uploader.

Desain flow end-to-end.

### Latihan 4 — Production Incident

Officer tidak bisa download file. Error aplikasi hanya “AccessDenied”.

Buat checklist investigasi dari:

- application log;
- bucket/key/version;
- IAM role;
- bucket policy;
- KMS key;
- object versioning;
- CloudTrail;
- VPC endpoint policy.

---

## 33. Apa yang Tidak Dibahas Mendalam di Part Ini

Part ini sengaja belum membahas secara dalam:

- high-throughput multipart tuning;
- async S3 client;
- S3 Transfer Manager;
- streaming large object;
- presigner implementation detail;
- S3 event notification implementation;
- CloudFront;
- cross-region replication;
- object lock legal design detail;
- S3 Batch Operations;
- Access Points dan Multi-Region Access Points.

Topik besar berikutnya akan dibahas bertahap.

---

## 34. Hubungan ke Part Berikutnya

Part berikutnya adalah:

```text
Part 9 — S3 Advanced: High-Throughput Upload, Download, Streaming, and Transfer Manager
```

Part 9 akan masuk ke:

- upload/download besar;
- streaming tanpa OOM;
- multipart upload detail;
- async client;
- Transfer Manager;
- checksum;
- retry large object;
- backpressure;
- tuning Java client;
- memory and file IO strategy.

---

## 35. Status Seri

Seri belum selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - berikutnya
...
Part 35 - target akhir seri
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-07-local-development-testing-and-emulation-strategy.md">⬅️ Part 7 — Local Development, Testing, and Emulation Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-09-s3-advanced-high-throughput-upload-download-streaming-transfer-manager.md">Part 9 — S3 Advanced: High-Throughput Upload, Download, Streaming, and Transfer Manager ➡️</a>
</div>
