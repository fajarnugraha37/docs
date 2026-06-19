# learn-http-for-web-backend-perspective-part-020.md

# Part 020 — File Upload, Download, Multipart, and Large Payloads

> Series: **HTTP for Web/Backend Perspective**  
> Context: **Java Software Engineer**  
> Focus: membangun mental model backend production untuk upload/download file, multipart, binary payload, streaming, object storage, range request, security, reliability, dan operability.

---

## 0. Tujuan Part Ini

Di banyak backend system, endpoint JSON relatif mudah dibuat benar. Tantangan besar muncul ketika backend mulai menerima atau mengirim:

- file evidence,
- dokumen legal,
- PDF report,
- spreadsheet export,
- foto/video,
- ZIP archive,
- log bundle,
- data dump,
- attachment untuk case/investigation,
- bulk import CSV,
- generated report berukuran besar.

File dan payload besar mengubah karakter sistem.

Endpoint JSON biasa biasanya:

```text
request body kecil -> parse ke DTO -> validasi -> transaksi DB -> response JSON kecil
```

Endpoint file bisa menjadi:

```text
stream byte besar -> temp storage -> virus scanning -> metadata extraction -> object storage -> async processing -> audit event -> delayed availability -> secure download
```

Perbedaannya bukan hanya ukuran data. Perbedaannya adalah **resource risk**.

File endpoint menyentuh:

- memory,
- disk,
- socket,
- thread,
- event loop,
- object storage,
- antivirus scanner,
- queue,
- CDN,
- audit trail,
- authorization,
- legal retention,
- privacy,
- malware risk,
- timeout,
- resumability,
- user experience.

Engineer yang hanya melihat upload sebagai `MultipartFile file` akan mudah membuat sistem yang:

- boros memory,
- mudah DoS,
- gagal saat file besar,
- menyimpan file berbahaya,
- bocor data antar-tenant,
- corrupt saat retry,
- tidak audit-compliant,
- sulit di-debug,
- tidak scalable.

Target part ini: setelah selesai, kamu mampu mendesain file API yang aman, scalable, observable, dan cocok untuk production backend.

---

## 1. Mental Model Utama: File Endpoint Adalah Resource Pipeline

Jangan berpikir:

```text
client uploads file -> backend saves file
```

Berpikir seperti ini:

```text
client intent
  -> HTTP framing
  -> ingress limits
  -> authentication
  -> authorization
  -> request metadata validation
  -> byte stream acceptance
  -> temporary persistence
  -> content inspection
  -> malware scanning
  -> durable storage
  -> metadata persistence
  -> business association
  -> audit record
  -> availability decision
  -> download policy
```

Upload bukan single operation. Upload adalah pipeline.

Download juga bukan sekadar:

```text
read file -> write response
```

Download adalah pipeline:

```text
client requests file
  -> authenticate
  -> authorize against resource and tenant
  -> resolve file metadata
  -> check lifecycle/state
  -> choose delivery strategy
  -> set safe headers
  -> stream bytes
  -> support range/resume when needed
  -> record audit/access event
```

Dalam sistem regulatory/case-management, file sering punya status:

```text
UPLOADING
STAGED
SCANNING
QUARANTINED
AVAILABLE
REJECTED
DELETED
EXPIRED
ARCHIVED
```

Jadi file bukan hanya blob. File adalah domain object dengan lifecycle.

---

## 2. Jenis Payload Besar di Backend

Tidak semua payload besar sama.

### 2.1 Upload File User

Contoh:

- evidence attachment,
- identity document,
- complaint form attachment,
- invoice,
- contract,
- photo,
- scanned PDF.

Karakteristik:

- tidak selalu dipercaya,
- ukuran bervariasi,
- tipe file bisa dipalsukan,
- perlu scan,
- perlu authorization,
- sering terkait domain entity.

### 2.2 Bulk Import

Contoh:

- CSV import,
- Excel import,
- ZIP of records,
- NDJSON bulk ingestion.

Karakteristik:

- perlu parsing,
- bisa partial success,
- error reporting kompleks,
- sebaiknya async,
- perlu idempotency.

### 2.3 Generated Export

Contoh:

- case report PDF,
- audit log export,
- compliance report,
- CSV daftar kasus,
- evidence bundle ZIP.

Karakteristik:

- sering mahal dihitung,
- bisa lama,
- perlu access control,
- mungkin harus immutable,
- sering cocok async job.

### 2.4 Service-to-Service Binary Payload

Contoh:

- internal document rendering service,
- OCR service,
- malware scanner,
- archive service,
- image processing service.

Karakteristik:

- throughput tinggi,
- perlu timeout eksplisit,
- perlu backpressure,
- perlu retry/idempotency,
- sering lebih baik pakai object storage reference daripada passing bytes antar-service.

---

## 3. HTTP Representation untuk File

File tetap dikirim sebagai HTTP representation.

Response download biasanya punya:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 10485760
Content-Disposition: attachment; filename="case-report.pdf"
Cache-Control: private, no-store

<bytes>
```

Upload multipart biasanya:

```http
POST /cases/CASE-123/evidence HTTP/1.1
Content-Type: multipart/form-data; boundary=----abc
Content-Length: 9827361

------abc
Content-Disposition: form-data; name="file"; filename="evidence.pdf"
Content-Type: application/pdf

<bytes>
------abc
Content-Disposition: form-data; name="description"

Witness statement
------abc--
```

Yang perlu diingat:

- `Content-Type` adalah klaim client, bukan kebenaran absolut.
- `filename` adalah input tidak terpercaya.
- `Content-Length` bisa hilang jika chunked transfer dipakai.
- multipart boundary harus diparse dengan hati-hati.
- body besar tidak boleh selalu dibaca penuh ke memory.

---

## 4. Upload Strategy: Direct-to-App vs Direct-to-Object-Storage

Ada dua pola utama.

---

## 4.1 Direct Upload to Application Server

Client mengirim file ke backend application.

```text
client -> app server -> object storage / disk / database
```

Contoh endpoint:

```http
POST /cases/{caseId}/evidence
Content-Type: multipart/form-data
```

Kelebihan:

- sederhana,
- authorization mudah dilakukan di app,
- metadata dan file bisa diproses dalam satu request,
- cocok untuk file kecil/sedang,
- cocok untuk sistem internal.

Kekurangan:

- app server menanggung bandwidth besar,
- thread/event loop bisa terbebani,
- temp disk bisa penuh,
- timeout lebih mudah terjadi,
- horizontal scaling lebih mahal,
- upload besar dapat mengganggu endpoint JSON biasa.

Cocok untuk:

- file kecil,
- traffic rendah/sedang,
- admin/internal tools,
- proof of concept,
- environment dengan object storage policy sederhana.

Tidak cocok untuk:

- file sangat besar,
- traffic upload tinggi,
- public-facing upload,
- mobile client dengan jaringan tidak stabil,
- video/media upload.

---

## 4.2 Direct Upload to Object Storage via Pre-Signed URL

Backend membuat izin upload sementara, client upload langsung ke object storage.

```text
1. client -> app: request upload session
2. app -> object storage: generate pre-signed URL/policy
3. app -> client: upload URL + required headers
4. client -> object storage: PUT/POST bytes
5. client/app/storage event -> app: finalize/confirm
6. app: scan/process/mark available
```

Kelebihan:

- app server tidak membawa byte besar,
- lebih scalable,
- object storage menangani upload besar,
- mendukung multipart/resumable upload di storage layer,
- biaya app compute lebih rendah.

Kekurangan:

- flow lebih kompleks,
- butuh lifecycle state upload,
- perlu cleanup orphan upload,
- perlu validasi metadata setelah upload,
- authorization harus dikunci dalam upload session,
- scanning dan finalization harus didesain eksplisit.

Cocok untuk:

- file besar,
- public-facing upload,
- mobile upload,
- high throughput,
- evidence/media/document storage production.

---

## 5. Upload Session Pattern

Untuk sistem production, terutama regulatory/case-management, upload sebaiknya punya session.

### 5.1 Create Upload Session

```http
POST /cases/CASE-123/evidence-uploads
Content-Type: application/json
Idempotency-Key: 59b978d2-2e1b-4b2f-94ff-8124fd5f5b22

{
  "filename": "witness-statement.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 8273642,
  "sha256": "optional-client-hash",
  "category": "WITNESS_STATEMENT"
}
```

Possible response:

```http
HTTP/1.1 201 Created
Location: /evidence-uploads/UPL-789
Content-Type: application/json

{
  "uploadId": "UPL-789",
  "status": "READY_FOR_UPLOAD",
  "uploadUrl": "https://object-storage/...",
  "requiredHeaders": {
    "Content-Type": "application/pdf"
  },
  "expiresAt": "2026-06-19T12:00:00Z"
}
```

### 5.2 Finalize Upload

```http
POST /evidence-uploads/UPL-789/finalize
Content-Type: application/json

{
  "sizeBytes": 8273642,
  "sha256": "actual-hash-if-known"
}
```

Possible response:

```http
HTTP/1.1 202 Accepted
Location: /evidence-uploads/UPL-789

{
  "uploadId": "UPL-789",
  "status": "SCANNING"
}
```

### 5.3 Poll Status

```http
GET /evidence-uploads/UPL-789
```

Response:

```json
{
  "uploadId": "UPL-789",
  "caseId": "CASE-123",
  "status": "AVAILABLE",
  "evidenceId": "EVD-456"
}
```

Pattern ini membuat upload explicit, auditable, retryable, dan recoverable.

---

## 6. File Lifecycle State Machine

Model lifecycle yang sehat:

```text
INITIATED
  -> READY_FOR_UPLOAD
  -> UPLOADED
  -> SCANNING
  -> AVAILABLE
```

Dengan cabang failure:

```text
SCANNING -> QUARANTINED
SCANNING -> REJECTED
READY_FOR_UPLOAD -> EXPIRED
UPLOADED -> PROCESSING_FAILED
AVAILABLE -> ARCHIVED
AVAILABLE -> DELETED
```

### 6.1 Kenapa State Machine Penting?

Karena upload punya banyak failure mode:

- upload session dibuat tapi client tidak upload,
- client upload tapi finalize tidak dipanggil,
- object storage event terlambat,
- file corrupt,
- hash mismatch,
- file terlalu besar,
- MIME mismatch,
- virus scan timeout,
- malware ditemukan,
- DB commit sukses tapi event gagal,
- retry finalize dilakukan dua kali,
- user tidak lagi authorized saat finalize.

Tanpa state machine, sistem akan penuh orphan file dan status ambigu.

---

## 7. Multipart Upload ke Application Server

Di Spring MVC, contoh sederhana:

```java
@PostMapping(path = "/cases/{caseId}/evidence", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public ResponseEntity<EvidenceResponse> uploadEvidence(
        @PathVariable String caseId,
        @RequestPart("file") MultipartFile file,
        @RequestPart("metadata") EvidenceMetadataRequest metadata) {

    EvidenceResponse response = evidenceService.upload(caseId, file, metadata);
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
}
```

Ini mudah, tapi ada bahaya tersembunyi:

- Apakah file disimpan di memory dulu?
- Apakah temp directory punya batas?
- Apakah ukuran file dibatasi?
- Apakah jumlah part dibatasi?
- Apakah filename disanitasi?
- Apakah content type dipercaya begitu saja?
- Apakah upload berlangsung di request thread lama?
- Apakah virus scan blocking?
- Apakah DB transaction dibuka selama stream file?

### 7.1 Rule Penting

Jangan buka DB transaction selama seluruh file besar sedang ditulis/di-scan.

Buruk:

```text
begin transaction
  receive 500MB file
  scan file
  upload to object storage
  insert metadata
commit
```

Lebih baik:

```text
validate request metadata
store file to staging/object storage
scan/process outside long DB transaction
short transaction to update metadata/state
```

---

## 8. Memory Pressure dan Temporary File

Banyak framework multipart memakai kombinasi memory dan disk.

Konfigurasi perlu mengatur:

- max file size,
- max request size,
- threshold memory-to-disk,
- temp directory,
- cleanup behavior,
- max number of parts,
- max header size,
- max filename length.

### 8.1 Failure Mode: Temp Disk Full

Saat temp disk penuh:

- upload gagal,
- request lain bisa ikut gagal,
- pod/container bisa unhealthy,
- node bisa pressure,
- application logs bisa penuh noise.

Mitigasi:

- pakai dedicated temp mount,
- set quota,
- enforce request size at gateway and app,
- monitor disk usage,
- cleanup orphan temp files,
- reject early when free space low,
- move heavy upload to object storage.

### 8.2 Failure Mode: Heap Explosion

Buruk:

```java
byte[] bytes = file.getBytes();
```

Untuk file besar, ini membaca seluruh file ke heap.

Lebih baik:

```java
try (InputStream in = file.getInputStream()) {
    objectStorage.putObject(key, in, file.getSize(), detectedContentType);
}
```

Namun ini tetap blocking dan perlu timeout/resource control.

---

## 9. Content-Type Validation: Jangan Percaya Client

Client bisa mengirim:

```http
Content-Type: application/pdf
```

Padahal isinya executable, HTML, ZIP bomb, atau polyglot file.

Validasi perlu beberapa lapis:

1. Declared content type dari header.
2. File extension.
3. Magic bytes/signature.
4. Parser-level validation.
5. Antivirus/malware scanning.
6. Business rule.

Contoh:

```text
filename: report.pdf
client Content-Type: application/pdf
magic bytes: %PDF-
parser: valid PDF structure
scan: clean
business category: allowed for evidence
```

Kalau hanya mengecek extension, attacker bisa rename file.

Kalau hanya mengecek MIME header, attacker bisa memalsukan header.

Kalau hanya mengecek magic bytes, polyglot dan malformed file masih bisa lolos.

---

## 10. Filename Is Untrusted Input

`filename` dari multipart tidak boleh dipakai langsung sebagai path.

Buruk:

```java
Path target = uploadDir.resolve(file.getOriginalFilename());
file.transferTo(target);
```

Masalah:

- path traversal: `../../etc/passwd`,
- overwrite file,
- reserved characters,
- Unicode spoofing,
- executable extension,
- overly long filename,
- CRLF injection in response header,
- sensitive display issue.

Lebih aman:

```text
stored object key = generated UUID / ULID / content-addressed key
original filename = sanitized metadata only
```

Contoh:

```text
object key: tenant/TEN-1/cases/CASE-123/evidence/01J2X9...bin
original filename: witness-statement.pdf
```

---

## 11. Malware Scanning Pipeline

Untuk file dari user, terutama public-facing/internal-regulatory, scan adalah bagian penting.

### 11.1 Synchronous Scan

```text
upload request waits until scan completes
```

Kelebihan:

- client langsung tahu hasil,
- state lebih sederhana.

Kekurangan:

- request lama,
- timeout risk,
- scanner bottleneck,
- thread/resource tertahan,
- buruk untuk file besar.

Cocok untuk:

- file kecil,
- internal low-volume,
- scanner cepat.

### 11.2 Asynchronous Scan

```text
upload accepted -> status SCANNING -> scanner async -> AVAILABLE/QUARANTINED
```

Kelebihan:

- scalable,
- request pendek,
- cocok untuk file besar,
- bisa retry scanner.

Kekurangan:

- lifecycle lebih kompleks,
- client perlu polling/webhook/event,
- file belum langsung available.

Untuk production, async scan sering lebih realistis.

### 11.3 State Model

```text
UPLOADED -> SCANNING -> AVAILABLE
                    -> QUARANTINED
                    -> REJECTED
                    -> SCAN_FAILED
```

Policy penting:

- file `SCANNING` tidak boleh didownload oleh normal user,
- file `QUARANTINED` hanya bisa diakses security/admin flow,
- audit event harus merekam scan result,
- scanner timeout harus tidak diam-diam dianggap clean.

---

## 12. ZIP Bomb dan Decompression Bomb

File kecil bisa menjadi besar setelah diekstrak.

Contoh:

```text
upload.zip = 10 MB
uncompressed = 100 GB
```

Risiko:

- disk penuh,
- memory penuh,
- CPU spike,
- scanner timeout,
- service outage.

Mitigasi:

- limit compressed size,
- limit uncompressed total size,
- limit nested archive depth,
- limit number of entries,
- limit filename length,
- reject symlink/path traversal entries,
- process archive in sandbox,
- enforce CPU/time budget.

---

## 13. Multipart Security Pitfalls

Multipart kelihatan sederhana, tapi parser bisa menjadi attack surface.

Perhatikan:

- part count limit,
- boundary length,
- header count per part,
- header size per part,
- nested multipart,
- empty file semantics,
- duplicate part names,
- huge metadata part,
- malformed boundary,
- slow upload,
- content type mismatch per part.

Decision policy harus eksplisit:

```text
file part required? yes
metadata part required? yes
multiple file parts allowed? depends
duplicate metadata parts allowed? no
empty file allowed? usually no
unknown parts allowed? usually no
```

---

## 14. Download Strategy

Ada beberapa cara mengirim file ke client.

### 14.1 App Streams File

```text
client -> app -> object storage -> app -> client
```

Kelebihan:

- authorization penuh di app,
- audit download mudah,
- headers dikontrol app.

Kekurangan:

- app membawa bandwidth besar,
- thread/socket lama,
- kurang scalable untuk file besar.

Cocok untuk:

- file kecil/sedang,
- highly sensitive file,
- low volume,
- audit strict.

### 14.2 Redirect to Pre-Signed Download URL

```text
client -> app: request download
app -> client: 302/303 to signed URL
client -> object storage/CDN: download
```

Kelebihan:

- app tidak membawa byte,
- scalable,
- storage/CDN optimized.

Kekurangan:

- URL bisa bocor selama belum expired,
- audit actual byte download bisa lebih sulit,
- perlu expiry pendek,
- perlu kontrol cache.

### 14.3 App Returns Short-Lived Download URL as JSON

```http
POST /evidence/EVD-456/download-url
```

Response:

```json
{
  "url": "https://object-storage/signed...",
  "expiresAt": "2026-06-19T12:05:00Z"
}
```

Cocok untuk SPA/mobile, tapi perlu policy jelas.

### 14.4 CDN/Edge Protected Download

Pattern:

```text
app authorizes -> signed cookie/token -> CDN serves file
```

Cocok untuk:

- large distribution,
- media,
- generated reports,
- high throughput download.

---

## 15. Download Headers

Header penting untuk download:

```http
Content-Type: application/pdf
Content-Length: 8273642
Content-Disposition: attachment; filename="witness-statement.pdf"
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
ETag: "file-version-hash"
Accept-Ranges: bytes
```

### 15.1 Content-Type

Menentukan media type representation.

Untuk file tidak terpercaya, lebih aman memakai:

```http
Content-Type: application/octet-stream
Content-Disposition: attachment
X-Content-Type-Options: nosniff
```

Daripada membiarkan browser render file yang mungkin berisi active content.

### 15.2 Content-Disposition

Dua mode utama:

```http
Content-Disposition: inline
```

atau:

```http
Content-Disposition: attachment; filename="report.pdf"
```

Untuk file user-uploaded, default aman biasanya `attachment`.

### 15.3 Filename Encoding

Filename bisa butuh encoding internasional.

Praktik defensif:

- sanitize filename,
- batasi panjang,
- hapus control characters,
- jangan masukkan raw filename ke header,
- sediakan fallback ASCII.

### 15.4 Cache-Control

Untuk sensitive download:

```http
Cache-Control: no-store
```

Untuk public immutable asset:

```http
Cache-Control: public, max-age=31536000, immutable
```

Untuk user-specific report:

```http
Cache-Control: private, no-store
```

---

## 16. Range Requests dan Resume Download

HTTP range memungkinkan client meminta sebagian file.

Request:

```http
GET /evidence/EVD-456/content HTTP/1.1
Range: bytes=0-1048575
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1048575/8273642
Content-Length: 1048576
Accept-Ranges: bytes

<first 1MB>
```

Manfaat:

- resume interrupted download,
- video seeking,
- large file transfer,
- better client UX.

Backend concerns:

- validate range,
- avoid expensive random access if storage buruk,
- support object storage range read,
- maintain authorization per range request,
- beware many small range requests as abuse.

Jika range invalid:

```http
HTTP/1.1 416 Range Not Satisfiable
Content-Range: bytes */8273642
```

---

## 17. Large Export Pattern: Jangan Generate Besar Secara Synchronous

Buruk:

```http
GET /cases/export?format=csv
```

Lalu server:

- query jutaan row,
- generate CSV,
- hold connection 5 menit,
- timeout di gateway,
- user retry,
- sistem overload.

Lebih baik untuk export besar:

### 17.1 Create Export Job

```http
POST /case-exports
Content-Type: application/json
Idempotency-Key: 8ba7018a-331a-4d21-8465-b1ceaa10b42a

{
  "format": "CSV",
  "filters": {
    "status": ["OPEN", "UNDER_REVIEW"],
    "createdFrom": "2026-01-01",
    "createdTo": "2026-06-19"
  }
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /case-exports/EXP-123

{
  "exportId": "EXP-123",
  "status": "QUEUED"
}
```

### 17.2 Poll Job

```http
GET /case-exports/EXP-123
```

Response:

```json
{
  "exportId": "EXP-123",
  "status": "READY",
  "downloadUrl": "/case-exports/EXP-123/content",
  "expiresAt": "2026-06-20T00:00:00Z"
}
```

### 17.3 Download Content

```http
GET /case-exports/EXP-123/content
```

Benefits:

- request pendek,
- retry aman,
- work bisa dijadwalkan,
- result bisa disimpan,
- status observable,
- quota bisa diterapkan,
- authorization bisa dicek saat create dan saat download.

---

## 18. Upload and Download Authorization

File authorization sering lebih sulit daripada endpoint JSON.

Pertanyaan wajib:

1. Siapa boleh upload ke resource ini?
2. Siapa boleh melihat metadata file?
3. Siapa boleh download content file?
4. Apakah uploader otomatis boleh download?
5. Apakah reviewer boleh download semua evidence?
6. Apakah tenant boundary dicek?
7. Apakah file yang quarantined bisa diakses?
8. Apakah file archived masih bisa diakses?
9. Apakah signed URL tetap valid setelah permission user dicabut?
10. Apakah download dicatat audit?

### 18.1 Signed URL Permission Revocation Problem

Jika kamu membuat signed URL berlaku 1 jam, lalu user permission dicabut 5 menit kemudian, URL bisa tetap dipakai sampai expired.

Mitigasi:

- expiry sangat pendek,
- app-stream sensitive file,
- CDN token dengan revocation support,
- object key tidak predictable,
- audit access,
- avoid signed URL untuk file sangat sensitif.

---

## 19. Auditability untuk File

Dalam regulatory system, file access sering harus diaudit.

Audit event untuk upload:

```json
{
  "eventType": "EVIDENCE_UPLOAD_INITIATED",
  "actorId": "USR-1",
  "caseId": "CASE-123",
  "uploadId": "UPL-789",
  "filename": "witness-statement.pdf",
  "declaredContentType": "application/pdf",
  "declaredSizeBytes": 8273642,
  "timestamp": "2026-06-19T10:00:00Z"
}
```

Audit event untuk availability:

```json
{
  "eventType": "EVIDENCE_AVAILABLE",
  "caseId": "CASE-123",
  "evidenceId": "EVD-456",
  "scanResult": "CLEAN",
  "sha256": "...",
  "timestamp": "2026-06-19T10:03:00Z"
}
```

Audit event untuk download:

```json
{
  "eventType": "EVIDENCE_DOWNLOADED",
  "actorId": "USR-2",
  "caseId": "CASE-123",
  "evidenceId": "EVD-456",
  "ipAddress": "203.0.113.10",
  "userAgent": "...",
  "timestamp": "2026-06-19T11:00:00Z"
}
```

Audit harus tidak bergantung pada access log saja. Access log bagus, tapi domain audit harus eksplisit.

---

## 20. Idempotency untuk Upload dan Export

### 20.1 Duplicate Upload Session

Client bisa retry `POST /evidence-uploads` karena timeout.

Gunakan:

```http
Idempotency-Key: <uuid>
```

Backend menyimpan:

- actor,
- tenant,
- target resource,
- request fingerprint,
- response/result,
- expiry.

Jika retry dengan key sama dan fingerprint sama, return session yang sama.

Jika key sama tapi fingerprint berbeda, return conflict/error.

### 20.2 Duplicate Finalize

`POST /evidence-uploads/{id}/finalize` harus idempotent secara business.

Jika upload sudah `SCANNING`, retry finalize bisa return status yang sama.

Jika upload sudah `AVAILABLE`, retry finalize bisa return evidence result yang sama.

### 20.3 Duplicate Export Job

Export besar wajib idempotent agar user refresh/retry tidak membuat banyak job mahal.

---

## 21. Database Design untuk File Metadata

Jangan simpan file besar di row database biasa kecuali ada alasan kuat.

Lebih umum:

```text
file bytes -> object storage
metadata -> relational database
```

Contoh table:

```sql
CREATE TABLE evidence_file (
    id                 VARCHAR(64) PRIMARY KEY,
    tenant_id           VARCHAR(64) NOT NULL,
    case_id             VARCHAR(64) NOT NULL,
    upload_id           VARCHAR(64) UNIQUE,
    original_filename   VARCHAR(255) NOT NULL,
    stored_object_key   VARCHAR(1024) NOT NULL,
    declared_mime_type  VARCHAR(255),
    detected_mime_type  VARCHAR(255),
    size_bytes          BIGINT NOT NULL,
    sha256              CHAR(64),
    status              VARCHAR(32) NOT NULL,
    scan_status         VARCHAR(32),
    scan_result         VARCHAR(32),
    created_by          VARCHAR(64) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    version             BIGINT NOT NULL
);
```

Important indexes:

```sql
CREATE INDEX idx_evidence_case ON evidence_file (tenant_id, case_id);
CREATE INDEX idx_evidence_status ON evidence_file (status);
CREATE INDEX idx_evidence_upload ON evidence_file (upload_id);
```

---

## 22. Object Storage Key Design

Bad:

```text
/uploads/witness-statement.pdf
```

Better:

```text
tenant/TEN-123/cases/CASE-456/evidence/EVD-789/original.bin
```

Even better if avoiding semantic leakage in key:

```text
objects/2026/06/19/01J2X9WZ8YQ7P2M6T4K3B1A0FC
```

Trade-off:

- semantic key easier ops/debug,
- opaque key reduces leakage,
- tenant prefix can help lifecycle policy,
- sharding prefix can help object-store performance depending on storage provider.

Never rely on object key alone for authorization. Authorization belongs in application/policy layer.

---

## 23. Hashing and Integrity

Hash useful untuk:

- integrity check,
- duplicate detection,
- audit evidence fingerprint,
- tamper detection,
- chain-of-custody.

Common:

```text
SHA-256(file bytes)
```

When compute hash:

- while streaming upload to storage,
- after object storage upload via background worker,
- during scan pipeline.

For evidence systems, hash can be part of legal defensibility:

```text
The evidence file downloaded later has same SHA-256 as the file accepted after scan.
```

But be careful:

- hash computation costs CPU,
- duplicate detection by hash may leak existence if exposed,
- hash alone is not authorization.

---

## 24. Streaming in Spring MVC

### 24.1 Streaming Download with `StreamingResponseBody`

```java
@GetMapping("/evidence/{evidenceId}/content")
public ResponseEntity<StreamingResponseBody> download(@PathVariable String evidenceId) {
    EvidenceFile file = evidenceService.authorizeAndResolve(evidenceId);

    StreamingResponseBody body = outputStream -> {
        try (InputStream inputStream = objectStorage.openStream(file.objectKey())) {
            inputStream.transferTo(outputStream);
        }
    };

    return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(file.detectedContentType()))
            .contentLength(file.sizeBytes())
            .header(HttpHeaders.CONTENT_DISPOSITION,
                    ContentDisposition.attachment()
                            .filename(file.safeDownloadFilename(), StandardCharsets.UTF_8)
                            .build()
                            .toString())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header("X-Content-Type-Options", "nosniff")
            .body(body);
}
```

Concerns:

- thread used for streaming,
- object storage stream timeout,
- client disconnect handling,
- audit event timing,
- content-length known or chunked,
- response commit before stream failure.

### 24.2 When to Audit Download?

Options:

1. Audit when request authorized.
2. Audit when first byte sent.
3. Audit when stream completes.
4. Audit both start and completion.

For sensitive file, best model:

```text
DOWNLOAD_STARTED
DOWNLOAD_COMPLETED or DOWNLOAD_ABORTED
```

But detecting abort reliably depends on server/container behavior.

---

## 25. Streaming in WebFlux

WebFlux can stream file/object storage data as `Flux<DataBuffer>`.

Conceptual example:

```java
@GetMapping("/evidence/{evidenceId}/content")
public Mono<ResponseEntity<Flux<DataBuffer>>> download(@PathVariable String evidenceId) {
    return evidenceService.authorizeAndResolve(evidenceId)
            .map(file -> {
                Flux<DataBuffer> body = objectStorageReactive.read(file.objectKey());

                return ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(file.detectedContentType()))
                        .contentLength(file.sizeBytes())
                        .header(HttpHeaders.CONTENT_DISPOSITION,
                                "attachment; filename=\"" + file.safeDownloadFilename() + "\"")
                        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                        .header("X-Content-Type-Options", "nosniff")
                        .body(body);
            });
}
```

Key concerns:

- do not block event loop,
- release `DataBuffer` correctly when manually handling,
- propagate cancellation to storage client,
- configure backpressure,
- avoid mixing blocking object storage SDK in event loop.

If storage SDK is blocking, Spring MVC may be simpler and safer than fake-reactive code.

---

## 26. Large Upload in WebFlux

WebFlux upload can process multipart parts streaming-style.

Conceptual:

```java
@PostMapping(path = "/cases/{caseId}/evidence", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public Mono<ResponseEntity<UploadResponse>> upload(
        @PathVariable String caseId,
        @RequestPart("file") FilePart filePart,
        @RequestPart("metadata") Mono<EvidenceMetadataRequest> metadataMono) {

    return metadataMono
            .flatMap(metadata -> evidenceService.acceptUpload(caseId, filePart, metadata))
            .map(response -> ResponseEntity.status(HttpStatus.ACCEPTED).body(response));
}
```

But beware:

- `FilePart.transferTo(...)` still writes somewhere,
- scan pipeline likely async,
- object storage client must be reactive or safely isolated,
- max in-memory size must be configured,
- multipart parsing itself has limits.

---

## 27. Request Size Limit Placement

Limits should exist at multiple layers.

```text
client guidance
  -> CDN limit
  -> WAF limit
  -> reverse proxy limit
  -> gateway limit
  -> application server limit
  -> framework multipart limit
  -> domain limit by file category/tenant/role
```

Example policy:

```text
avatar: 5 MB
PDF evidence: 100 MB
video evidence: 2 GB direct-to-storage only
CSV import: 500 MB async only
case report export: max 1M rows
```

Why multiple limits?

- edge rejects before app resource spent,
- app still protects itself if bypass/misconfig,
- domain enforces business policy.

Status choice:

- `413 Payload Too Large` for request too large,
- `415 Unsupported Media Type` for disallowed media type,
- `422 Unprocessable Content` for semantically invalid file/category,
- `429 Too Many Requests` for quota/rate,
- `507 Insufficient Storage` rarely, usually internal/storage-specific.

---

## 28. Timeout Strategy for Upload/Download

### 28.1 Upload Timeout

Upload timeout must account for slow networks but defend against slowloris.

Controls:

- header read timeout,
- body read timeout,
- idle timeout,
- minimum data rate,
- max upload duration,
- max body size,
- per-client concurrency limit.

### 28.2 Download Timeout

Download timeout must handle slow clients.

Controls:

- response write timeout,
- idle timeout,
- connection timeout,
- per-user concurrent download limit,
- CDN/offload for large files.

### 28.3 Gateway/App Timeout Mismatch

Bad:

```text
gateway timeout: 60s
app upload processing: 180s
```

Client sees timeout while app may continue processing. This creates duplicate retry and ambiguity.

For long work, prefer async job.

---

## 29. Response Commit Problem

When streaming response, headers are often sent before all bytes are successfully read/written.

Scenario:

```text
server sends 200 OK
server streams 20 MB of 100 MB
object storage read fails
connection closes
```

Client receives incomplete file. Server cannot change status to `500` after response committed.

Mitigation:

- use `Content-Length` so client can detect incomplete body,
- use checksums where applicable,
- rely on client retry/range,
- monitor stream failure,
- prefer object storage/CDN for large downloads,
- avoid saying success in audit until completion if strict.

---

## 30. File Storage in Database: When Is It OK?

Storing file bytes in DB is usually not first choice, but sometimes valid.

Possible reasons:

- small files,
- transactional consistency critical,
- simple deployment,
- DB-backed encryption/audit,
- low throughput,
- regulatory storage model.

Costs:

- DB bloat,
- backup/restore huge,
- replication lag,
- query/cache pressure,
- harder CDN/offload,
- transaction duration risk.

Common compromise:

```text
metadata in DB
blob in object storage
hash + object version in DB
```

---

## 31. Encryption and Privacy

Questions:

- Is file encrypted at rest?
- Who controls keys?
- Is per-tenant encryption required?
- Is object storage bucket public? It should not be.
- Are pre-signed URLs logged?
- Do logs contain filenames with sensitive info?
- Are temporary files encrypted?
- Are backups encrypted?
- Are deleted files actually deleted or retained?

Sensitive filename example:

```text
medical-report-john-smith-diagnosis.pdf
```

Even filename can be sensitive.

Logging policy:

- log file ID,
- log category,
- log size,
- avoid raw filename unless needed and protected,
- never log signed URL,
- never log object storage credentials.

---

## 32. Retention, Deletion, and Legal Hold

File lifecycle does not end at download.

Regulatory systems often need:

- retention period,
- legal hold,
- deletion policy,
- archival,
- immutable evidence,
- version history,
- chain-of-custody,
- access audit,
- export for legal review.

Deletion semantics:

```text
DELETE /evidence/EVD-456
```

May mean:

- mark as deleted,
- remove from active UI,
- retain physical object due to legal hold,
- schedule physical deletion later,
- write audit event.

Never assume HTTP DELETE equals immediate physical byte destruction.

---

## 33. Observability for File Endpoints

Metrics:

- upload started count,
- upload completed count,
- upload failed count,
- upload size distribution,
- upload duration,
- scan duration,
- scan failure count,
- quarantine count,
- download started/completed/aborted count,
- download bytes served,
- temp disk usage,
- object storage latency,
- signed URL issuance count,
- orphan upload count,
- export queue depth,
- export generation duration.

Logs:

- correlation id,
- actor id,
- tenant id,
- case id,
- upload id,
- evidence id,
- file size,
- file status,
- scan status,
- failure reason class.

Traces:

```text
HTTP POST create upload session
  -> authz check
  -> DB insert upload session
  -> object storage signed URL generation

scanner worker
  -> object storage get object
  -> malware scan
  -> hash compute
  -> DB update evidence status
  -> audit event publish
```

Avoid high-cardinality labels like raw filename or object key in metrics.

---

## 34. Common Anti-Patterns

### Anti-Pattern 1: `file.getBytes()` Everywhere

Loads entire file into memory.

Better: stream.

### Anti-Pattern 2: Trusting `Content-Type`

Client header can lie.

Better: validate content with detection/scanning.

### Anti-Pattern 3: Saving by Original Filename

Leads to path traversal, overwrite, leakage.

Better: generated object key.

### Anti-Pattern 4: Synchronous Huge Export

Long-running GET times out and overloads backend.

Better: async export job.

### Anti-Pattern 5: No Upload State

No way to recover from partial upload/finalization/scan failure.

Better: upload lifecycle state machine.

### Anti-Pattern 6: Public Bucket with Guessable URLs

Severe data leakage.

Better: private storage + app auth/signed URL.

### Anti-Pattern 7: Signed URL Too Long-Lived

Permission revocation ineffective.

Better: short expiry and sensitive-file app mediation.

### Anti-Pattern 8: No Download Audit

Cannot prove who accessed evidence.

Better: domain audit event.

### Anti-Pattern 9: Virus Scan But File Available Before Scan

Security control bypassed by timing.

Better: `SCANNING` state not downloadable.

### Anti-Pattern 10: Same Limits for All File Categories

Avatar and legal evidence should not share policy.

Better: domain-specific file policy.

---

## 35. Production Design Checklist

Before shipping file API, answer these.

### Upload

- What max size is allowed per file category?
- Where is limit enforced?
- Is upload direct-to-app or direct-to-storage?
- Is upload resumable?
- Is upload idempotent?
- Is filename sanitized?
- Is content type verified?
- Is malware scan required?
- What happens during scan failure?
- Are orphan uploads cleaned?
- Is temp disk monitored?
- Is upload audited?

### Download

- Who can download?
- Is authorization checked at download time?
- Is signed URL expiry short?
- Is download audited?
- Is file served inline or attachment?
- Are safe headers set?
- Is range request supported?
- Is cache policy correct?
- Can client detect incomplete download?

### Storage

- Where are bytes stored?
- Is storage private?
- Are objects encrypted?
- Is key naming safe?
- Is object versioning needed?
- Is retention configured?
- Is legal hold needed?
- Is deletion physical or logical?

### Operations

- What are timeout settings?
- What is concurrency limit?
- What metrics exist?
- What alerts exist?
- Can scanner backlog be observed?
- Can failed uploads be retried?
- Can exports be cancelled?
- Can storage outage be handled?

---

## 36. Case Study: Evidence Upload in Regulatory Enforcement System

### 36.1 Requirements

- Investigator uploads evidence to a case.
- Max PDF/image file: 100 MB.
- Video evidence: up to 2 GB.
- All files must be malware scanned.
- Evidence cannot be downloaded before scan passes.
- Every upload/download must be audited.
- Supervisors can review evidence.
- Respondents cannot access internal evidence unless disclosed.
- Legal hold may prevent deletion.

### 36.2 Recommended API

Create upload session:

```http
POST /cases/{caseId}/evidence-uploads
```

Finalize:

```http
POST /evidence-uploads/{uploadId}/finalize
```

Poll status:

```http
GET /evidence-uploads/{uploadId}
```

List evidence:

```http
GET /cases/{caseId}/evidence
```

Download:

```http
GET /evidence/{evidenceId}/content
```

Delete logically:

```http
DELETE /evidence/{evidenceId}
If-Match: "version-7"
```

### 36.3 State Machine

```text
READY_FOR_UPLOAD
  -> UPLOADED
  -> SCANNING
  -> AVAILABLE
  -> ARCHIVED
```

Failure states:

```text
EXPIRED
REJECTED
QUARANTINED
SCAN_FAILED
DELETED
```

### 36.4 Authorization Rules

```text
create upload session:
  actor must have CASE_EVIDENCE_UPLOAD on case

finalize:
  actor must be owner of upload session or system worker

download:
  actor must have CASE_EVIDENCE_READ on case
  evidence status must be AVAILABLE
  disclosure policy must allow actor class

delete:
  actor must have CASE_EVIDENCE_DELETE
  evidence not under legal hold
```

### 36.5 Audit Events

```text
EVIDENCE_UPLOAD_SESSION_CREATED
EVIDENCE_OBJECT_UPLOADED
EVIDENCE_SCAN_STARTED
EVIDENCE_SCAN_COMPLETED
EVIDENCE_AVAILABLE
EVIDENCE_DOWNLOAD_STARTED
EVIDENCE_DOWNLOAD_COMPLETED
EVIDENCE_QUARANTINED
EVIDENCE_DELETED
```

---

## 37. Exercises

### Exercise 1 — Choose Upload Strategy

Untuk masing-masing file, pilih direct-to-app atau direct-to-storage:

1. Avatar 2 MB.
2. PDF evidence 80 MB.
3. Video evidence 1.5 GB.
4. CSV import 400 MB.
5. Internal config JSON 50 KB.

Jelaskan trade-off.

### Exercise 2 — Design File State Machine

Buat state machine untuk file complaint attachment:

- uploaded by public complainant,
- must be scanned,
- may be rejected,
- may be redacted,
- may be disclosed later.

Tentukan status dan transition guard.

### Exercise 3 — Secure Download Headers

Desain headers untuk:

1. sensitive PDF evidence,
2. public user manual PDF,
3. generated CSV report with personal data,
4. image thumbnail safe for browser inline display.

### Exercise 4 — Failure Analysis

Analisis skenario:

```text
User uploads 200 MB file.
Backend stores file successfully.
DB update fails.
Client receives 500.
User retries.
```

Jawab:

- Apa risiko duplicate object?
- Bagaimana idempotency membantu?
- Bagaimana cleanup dilakukan?
- Status apa yang harus terlihat di API?

### Exercise 5 — Export Job Design

Desain API untuk export audit log 10 juta row.

Harus mencakup:

- create job,
- status polling,
- cancellation,
- download,
- expiry,
- authorization,
- idempotency,
- rate/quota limit.

---

## 38. Ringkasan Mental Model

File API bukan endpoint sederhana. File API adalah pipeline resource-heavy dan security-sensitive.

Prinsip utama:

1. Jangan percaya filename, content type, atau body.
2. Jangan baca file besar seluruhnya ke memory.
3. Jangan biarkan app server membawa byte besar jika object storage bisa menangani.
4. Gunakan upload session untuk flow besar/serius.
5. Gunakan lifecycle state machine.
6. Scan file sebelum available.
7. Pisahkan metadata, storage object, dan domain association.
8. Authorization harus dicek saat upload dan download.
9. Signed URL harus pendek umur dan dipakai hati-hati.
10. Download sensitive file harus memakai safe headers.
11. Export besar sebaiknya async job.
12. Audit file access sebagai domain event, bukan hanya access log.
13. Monitor memory, disk, scanner, storage, dan stream failure.
14. Treat file upload/download as reliability + security + compliance feature.

---

## 39. Selesai Part 020

Kita sudah menyelesaikan:

```text
Part 020 — File Upload, Download, Multipart, and Large Payloads
```

Status seri:

```text
020 / 032 selesai
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-019.md">⬅️ Part 019 — Timeouts, Cancellation, Backpressure, and Load Shedding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-021.md">Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses ➡️</a>
</div>
