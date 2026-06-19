# learn-http-for-web-backend-perspective-part-003.md

# Part 003 — Methods Deep Dive for Backend Correctness

> Seri: `learn-http-for-web-backend-perspective`  
> Target pembaca: Java software engineer yang ingin memahami HTTP dari perspektif backend production.  
> Fokus part ini: memahami HTTP method sebagai **semantic contract**, bukan sekadar dekorasi routing di controller.

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya kita membangun mental model bahwa request HTTP melewati banyak lapisan sebelum sampai ke controller: client, proxy, gateway, load balancer, container, framework, filter, interceptor, handler, domain service, database, dan dependency downstream.

Part ini masuk ke salah satu fondasi terpenting: **HTTP method**.

Banyak backend API tampak bekerja, tetapi sebenarnya rapuh karena method dipilih hanya berdasarkan kebiasaan:

```http
POST /get-user
POST /update-status
GET /approve-case?id=123
POST /delete-document
```

Secara teknis mungkin jalan. Tetapi dari perspektif production, pilihan seperti itu dapat merusak:

- retry behavior,
- caching behavior,
- proxy behavior,
- observability,
- authorization boundary,
- audit defensibility,
- concurrency control,
- client SDK semantics,
- API governance,
- dan evolusi sistem jangka panjang.

HTTP method adalah sinyal kepada seluruh ekosistem bahwa suatu request memiliki makna tertentu. Yang membaca sinyal itu bukan hanya controller kita, tetapi juga browser, SDK, reverse proxy, CDN, gateway, service mesh, retry library, monitoring system, security tool, dan manusia yang mengoperasikan sistem.

---

## 1. Core Mental Model: Method Is a Contract, Not a Verb Label

HTTP method sering disebut “verb”, tetapi ini bisa menyesatkan. Dalam backend API design, method bukan sekadar kata kerja. Method adalah kontrak tentang **jenis interaksi** antara client dan resource.

Pertanyaan yang harus dijawab backend ketika memilih method:

1. Apakah request ini dimaksudkan hanya membaca state?
2. Apakah request boleh punya side effect?
3. Bila request yang sama dikirim dua kali, apakah hasil akhirnya harus sama?
4. Apakah response boleh disimpan cache?
5. Apakah resource identifier ditentukan client atau server?
6. Apakah operasi ini mengganti seluruh representation atau hanya sebagian?
7. Apakah operasi ini command, event, atau mutation terhadap resource?
8. Apakah client/gateway boleh retry otomatis saat timeout?
9. Apakah kegagalan response berarti operasi gagal, atau bisa saja operasi sukses tetapi response hilang?
10. Apakah operasi ini harus menghasilkan audit event?

Top 1% backend engineer tidak memilih method hanya karena “endpoint ini untuk update, jadi POST saja”. Mereka melihat method sebagai bagian dari **distributed system contract**.

---

## 2. Tiga Properti Penting: Safe, Idempotent, Cacheable

Sebelum masuk ke setiap method, kita harus memahami tiga properti yang menentukan konsekuensi production.

### 2.1 Safe

Sebuah method disebut safe bila semantics-nya adalah read-only dari perspektif client. Artinya client tidak meminta perubahan state yang signifikan di server.

Contoh safe:

```http
GET /cases/CASE-001
HEAD /cases/CASE-001
OPTIONS /cases/CASE-001
```

Safe bukan berarti server sama sekali tidak melakukan apa pun. Server tetap boleh:

- menulis access log,
- mengupdate metrics,
- memperbarui cache internal,
- melakukan tracing,
- memperbarui last-accessed metadata tertentu bila tidak dianggap state domain yang diminta client.

Tetapi client tidak sedang meminta mutation terhadap resource.

Contoh pelanggaran serius:

```http
GET /cases/CASE-001/approve
GET /payments/PAY-123/capture
GET /documents/DOC-77/delete
```

Masalahnya bukan hanya “tidak RESTful”. Masalah production-nya:

- crawler bisa memicu action,
- prefetcher bisa memicu mutation,
- monitoring check bisa mengubah data,
- cache/proxy bisa menganggap request aman,
- retry otomatis bisa mengeksekusi action berkali-kali,
- audit menjadi defensibility problem karena method menyatakan read tetapi sistem melakukan write.

### 2.2 Idempotent

Sebuah method idempotent bila beberapa request identik memiliki efek akhir yang sama seperti satu request.

Contoh idempotent:

```http
PUT /cases/CASE-001/status
Content-Type: application/json

{
  "status": "CLOSED"
}
```

Dikirim satu kali atau lima kali, state akhirnya tetap `CLOSED`, selama representation dan precondition sama.

Contoh tidak idempotent:

```http
POST /payments/PAY-123/captures
Content-Type: application/json

{
  "amount": 100000
}
```

Dikirim dua kali bisa menghasilkan dua capture, kecuali backend menerapkan idempotency key.

Penting: idempotent bukan berarti response selalu sama. Misalnya:

- request pertama `DELETE /cases/CASE-001/attachments/A1` bisa return `204 No Content`,
- request kedua bisa return `404 Not Found` atau tetap `204 No Content`,
- tetapi efek akhirnya tetap sama: attachment tidak ada.

Idempotency berbicara tentang **state effect**, bukan byte response yang identik.

### 2.3 Cacheable

Beberapa method secara semantics dapat memiliki response yang disimpan cache, terutama GET dan HEAD. POST juga secara spesifikasi bisa cacheable dalam kondisi tertentu, tetapi jarang digunakan di sistem umum karena dukungan cache praktis lebih terbatas dan semantics-nya sering command/mutation.

Cacheability bukan otomatis berarti response pasti di-cache. Backend tetap harus mengirim header yang benar, misalnya:

```http
Cache-Control: public, max-age=60
ETag: "case-summary-v17"
Vary: Accept, Accept-Language
```

Untuk backend engineer, method menentukan apakah caching bisa menjadi optimization aman atau justru source of corruption.

---

## 3. Method Matrix Ringkas

| Method | Safe | Idempotent | Umumnya Cacheable | Kegunaan Utama |
|---|---:|---:|---:|---|
| GET | Ya | Ya | Ya | Retrieve representation |
| HEAD | Ya | Ya | Ya | Retrieve metadata tanpa body |
| OPTIONS | Ya | Ya | Tidak umum | Discover communication options |
| POST | Tidak | Tidak secara default | Jarang | Submit/process/create subordinate resource/command |
| PUT | Tidak | Ya | Tidak umum | Replace/create resource at known URI |
| PATCH | Tidak | Tidak secara default | Tidak umum | Partial modification |
| DELETE | Tidak | Ya | Tidak umum | Remove/delete/unlink/cancel resource |
| TRACE | Ya secara semantics, tetapi berisiko | Ya | Tidak | Diagnostic loopback, biasanya disabled |
| CONNECT | Tidak dalam arti aplikasi biasa | Tidak | Tidak | Establish tunnel, umumnya proxy/TLS tunnel |

Matrix ini bukan dekorasi akademik. Ini memengaruhi apakah komponen lain boleh retry, cache, prefetch, inspect, atau treat request sebagai safe.

---

## 4. GET — Retrieval, Not Mutation

### 4.1 Semantics

GET digunakan untuk meminta current selected representation dari resource.

Contoh:

```http
GET /cases/CASE-001 HTTP/1.1
Accept: application/json
```

Backend dapat mengembalikan:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "case-001-v12"
Cache-Control: private, max-age=30

{
  "id": "CASE-001",
  "status": "UNDER_REVIEW",
  "assignedTo": "investigator-17"
}
```

GET tidak berarti “ambil dari database”. GET berarti client meminta representation dari resource. Sumbernya bisa database, cache, materialized view, search index, object storage, atau composition dari beberapa service.

### 4.2 GET dengan Query Parameter

Query parameter cocok untuk memilih subset, filter, search, pagination, sorting, projection.

Contoh:

```http
GET /cases?status=UNDER_REVIEW&assignedTo=investigator-17&page=0&size=50
```

Ini tetap retrieval. Query parameter bukan masalah selama request tidak meminta mutation.

### 4.3 GET Body

Secara praktik, body pada GET sangat bermasalah. Banyak intermediary, framework, cache, dan tooling tidak memiliki expectation kuat terhadap GET body. Untuk backend API production, hindari desain yang membutuhkan body pada GET.

Buruk:

```http
GET /cases/search
Content-Type: application/json

{
  "status": "UNDER_REVIEW",
  "riskScore": { "gte": 80 }
}
```

Lebih aman:

```http
GET /cases?status=UNDER_REVIEW&riskScoreGte=80
```

Atau bila query sangat kompleks:

```http
POST /case-searches
Content-Type: application/json

{
  "status": "UNDER_REVIEW",
  "riskScore": { "gte": 80 },
  "includeFacets": true
}
```

Lalu server membuat search resource atau menjalankan query command. Untuk search kompleks, pilihan antara GET dan POST harus mempertimbangkan cacheability, URL length, sensitivity, dan repeatability.

### 4.4 GET and Side Effects

GET boleh menyebabkan side effect teknis seperti logging dan metrics. Tetapi jangan gunakan GET untuk side effect domain.

Problematic:

```http
GET /notifications/123/mark-as-read
```

Lebih tepat:

```http
PATCH /notifications/123
Content-Type: application/json

{
  "read": true
}
```

Atau:

```http
POST /notifications/123/read-events
```

Pilihan tergantung apakah “read” adalah state resource atau event/command.

### 4.5 GET untuk Export

Misalnya export laporan:

```http
GET /cases/export?format=csv&status=CLOSED
```

Ini valid bila export sinkron, bounded, dan tidak membuat job domain yang bertahan lama.

Tetapi bila export berat dan perlu proses async:

```http
POST /case-exports
Content-Type: application/json

{
  "format": "csv",
  "filters": {
    "status": "CLOSED"
  }
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /case-exports/EXP-2026-0001
```

Kemudian:

```http
GET /case-exports/EXP-2026-0001
```

Mental model: GET mengambil representation. POST membuat/menjalankan proses export.

---

## 5. HEAD — GET Without Body

### 5.1 Semantics

HEAD sama seperti GET, tetapi server tidak mengirim response body. Header yang dikembalikan seharusnya menggambarkan apa yang akan dikembalikan oleh GET.

Contoh:

```http
HEAD /documents/DOC-123 HTTP/1.1
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 4839201
ETag: "doc-123-v4"
Last-Modified: Tue, 16 Jun 2026 10:15:00 GMT
```

### 5.2 Kegunaan Backend

HEAD berguna untuk:

- mengecek existence,
- mengecek file size,
- mengecek ETag,
- mengecek Last-Modified,
- mengecek authorization secara ringan,
- validasi sebelum download besar,
- health/probing pada resource tertentu.

### 5.3 Backend Pitfall

Banyak framework otomatis mendukung HEAD via GET handler. Tetapi hati-hati: jika GET handler melakukan pekerjaan berat sebelum menghasilkan body, HEAD bisa tetap mahal.

Buruk:

```java
@GetMapping("/reports/{id}/download")
public ResponseEntity<byte[]> download(@PathVariable String id) {
    byte[] fullFile = reportService.generateHugeReport(id);
    return ResponseEntity.ok(fullFile);
}
```

Kalau HEAD di-map ke GET secara internal dan tetap generate file besar, manfaat HEAD hilang.

Desain lebih baik:

- metadata report dipisahkan dari content,
- HEAD hanya membaca metadata,
- GET streaming content.

---

## 6. POST — Submit, Process, Create Subordinate Resource, Command

### 6.1 Semantics

POST adalah method paling fleksibel dan paling sering disalahgunakan. POST meminta server memproses representation yang dikirim sesuai semantics resource target.

POST dapat digunakan untuk:

1. membuat subordinate resource,
2. submit form/data,
3. menjalankan command,
4. memulai async job,
5. append event,
6. execute complex query yang tidak cocok sebagai GET,
7. trigger domain transition.

### 6.2 Create Resource with Server-Assigned ID

Contoh umum:

```http
POST /cases
Content-Type: application/json

{
  "respondentId": "R-123",
  "allegationType": "MISREPORTING",
  "initialEvidenceIds": ["E-1", "E-2"]
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-2026-0001
Content-Type: application/json

{
  "id": "CASE-2026-0001",
  "status": "DRAFT"
}
```

Server menentukan ID. POST ke collection `/cases` artinya “process this submission under the cases collection”.

### 6.3 POST as Command

Workflow-heavy systems sering punya command yang tidak cocok dipaksakan sebagai CRUD field update.

Contoh:

```http
POST /cases/CASE-001/approval-requests
Content-Type: application/json

{
  "requestedBy": "investigator-17",
  "comment": "Evidence package complete."
}
```

Ini membuat subordinate resource `approval-request`, bukan sekadar mengubah field `status`.

Atau:

```http
POST /cases/CASE-001:submit-for-review
Content-Type: application/json

{
  "comment": "Ready for supervisor review."
}
```

Colon action style sering digunakan dalam RPC-ish APIs. Bukan murni resource-oriented, tetapi bisa jujur dan eksplisit untuk workflow command. Namun gunakan dengan disiplin, bukan untuk semua operasi.

### 6.4 POST and Non-Idempotency

Secara default, POST tidak idempotent.

Jika client timeout setelah mengirim:

```http
POST /payments/PAY-123/captures
```

Ada beberapa kemungkinan:

1. request tidak sampai server,
2. request sampai tetapi belum diproses,
3. request berhasil commit tetapi response hilang,
4. request berhasil sebagian di downstream,
5. request diproses dua kali akibat retry.

Karena itu, untuk operasi penting gunakan `Idempotency-Key` atau command ID.

```http
POST /case-submissions
Idempotency-Key: 8f04f1e8-0a82-4d7d-9a99-b01d0d6b197a
Content-Type: application/json

{
  "draftCaseId": "CASE-DRAFT-123"
}
```

Backend menyimpan key, fingerprint request, status pemrosesan, dan response/result.

### 6.5 POST Response Choices

POST tidak harus selalu return 200.

Gunakan:

- `201 Created` bila resource baru tercipta dan URI-nya tersedia.
- `202 Accepted` bila request diterima tetapi belum selesai diproses.
- `200 OK` bila action selesai dan representation/result dikembalikan.
- `204 No Content` bila action selesai tanpa body response.
- `303 See Other` bila client harus mengambil result di URI lain.
- `409 Conflict` bila command melanggar state transition.
- `422 Unprocessable Content` bila payload syntactically valid tetapi semantically invalid.

Contoh async:

```http
POST /evidence-imports
Content-Type: application/json

{
  "sourceBucket": "s3://evidence-bucket/import-2026-06-18/"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /evidence-imports/IMPORT-001
Retry-After: 10
```

---

## 7. PUT — Replace Resource at a Known URI

### 7.1 Semantics

PUT meminta server membuat atau mengganti state resource target dengan representation yang dikirim client.

Contoh:

```http
PUT /cases/CASE-001/classification
Content-Type: application/json

{
  "type": "HIGH_RISK",
  "reason": "Cross-border exposure and repeated violations"
}
```

PUT cocok bila URI resource sudah diketahui dan payload merepresentasikan target resource secara utuh.

### 7.2 PUT for Create with Client-Assigned ID

Jika client berhak menentukan ID:

```http
PUT /external-references/EXT-AGENCY-12345
Content-Type: application/json

{
  "source": "EXTERNAL_AGENCY",
  "externalId": "EXT-AGENCY-12345",
  "caseId": "CASE-001"
}
```

Jika belum ada, server bisa create. Jika sudah ada, server replace.

Response dapat:

- `201 Created` bila dibuat,
- `200 OK` atau `204 No Content` bila diganti.

### 7.3 PUT Is Not Partial Update

Kesalahan umum:

```http
PUT /cases/CASE-001
Content-Type: application/json

{
  "status": "CLOSED"
}
```

Jika `/cases/CASE-001` adalah full case resource, payload di atas ambigu. Apakah field lain dihapus? Diabaikan? Dipertahankan?

Untuk partial update gunakan PATCH, atau modelkan sub-resource:

```http
PUT /cases/CASE-001/status
Content-Type: application/json

{
  "status": "CLOSED",
  "reason": "Final decision issued"
}
```

Di sini target resource adalah `status`, sehingga payload dapat dianggap full representation dari status resource.

### 7.4 PUT and Idempotency

PUT idempotent karena mengganti state target dengan representation tertentu. Request yang sama dikirim berkali-kali menghasilkan state akhir sama.

Tetapi backend harus hati-hati dengan side effect tambahan:

- mengirim email setiap PUT diterima,
- membuat audit record duplicate,
- memicu downstream workflow setiap request,
- membuat event baru setiap retry.

Domain state boleh sama, tetapi side effect bisa berlipat. Untuk sistem audit, biasanya audit harus mencatat attempt atau effective change? Ini keputusan domain.

Strategi:

1. Bedakan `received request` audit dengan `state changed` audit.
2. Jangan emit domain event jika tidak ada actual change, kecuali memang event attempt dibutuhkan.
3. Gunakan version/precondition untuk mencegah overwrite.
4. Gunakan idempotency/deduplication untuk side effect non-idempotent.

### 7.5 PUT with ETag

PUT sering sebaiknya dipakai bersama optimistic concurrency:

```http
PUT /cases/CASE-001/classification
If-Match: "classification-v3"
Content-Type: application/json

{
  "type": "HIGH_RISK",
  "reason": "New evidence received"
}
```

Jika version tidak cocok:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "The classification was modified by another user. Refresh and retry."
}
```

---

## 8. PATCH — Partial Modification

### 8.1 Semantics

PATCH digunakan untuk menerapkan partial modification pada resource. Payload PATCH bukan necessarily representation penuh, tetapi patch document atau instruction set.

Contoh JSON Merge Patch style:

```http
PATCH /cases/CASE-001
Content-Type: application/merge-patch+json

{
  "priority": "HIGH",
  "assignedTeam": "ENFORCEMENT_SPECIAL"
}
```

Contoh JSON Patch style:

```http
PATCH /cases/CASE-001
Content-Type: application/json-patch+json

[
  { "op": "replace", "path": "/priority", "value": "HIGH" },
  { "op": "add", "path": "/tags/-", "value": "cross-border" }
]
```

### 8.2 PATCH Is Not Automatically Idempotent

PATCH bisa idempotent atau tidak, tergantung patch document.

Idempotent:

```json
{ "priority": "HIGH" }
```

Non-idempotent:

```json
[
  { "op": "add", "path": "/comments/-", "value": "Please review" }
]
```

Dikirim dua kali akan menambah dua komentar.

### 8.3 PATCH vs POST Command

Gunakan PATCH bila client ingin memodifikasi representation resource.

```http
PATCH /cases/CASE-001

{
  "priority": "HIGH"
}
```

Gunakan POST bila client ingin menjalankan domain command atau membuat event/resource baru.

```http
POST /cases/CASE-001/escalations

{
  "reason": "High public interest"
}
```

Jangan memaksakan semua workflow menjadi PATCH field `status`. Dalam domain kompleks, state transition biasanya punya rules, actor, reason, timestamp, audit, attachments, dan policy checks. Itu lebih dekat ke command/event daripada field update sederhana.

### 8.4 PATCH Validation Complexity

PATCH lebih rumit dari PUT karena backend harus membedakan:

- field tidak dikirim,
- field dikirim dengan null,
- field dikirim kosong,
- field ingin dihapus,
- field ingin dipertahankan,
- field unknown,
- patch operation invalid,
- patch valid secara syntax tetapi invalid secara domain.

Dalam Java DTO, ini sulit jika hanya memakai POJO biasa karena null bisa berarti banyak hal. Untuk PATCH production, pertimbangkan:

- explicit patch document,
- `JsonNullable`,
- map-based validation,
- command-specific DTO,
- atau sub-resource update dengan PUT.

### 8.5 PATCH with Precondition

Karena PATCH sering rentan lost update, gunakan:

```http
PATCH /cases/CASE-001
If-Match: "case-v12"
Content-Type: application/merge-patch+json

{
  "priority": "HIGH"
}
```

Tanpa precondition, dua user bisa overwrite field atau mengeksekusi patch berdasarkan stale view.

---

## 9. DELETE — Remove, Unlink, Cancel, or Tombstone

### 9.1 Semantics

DELETE meminta server menghapus association antara target URI dan current functionality/resource.

Dalam aplikasi bisnis, “delete” tidak selalu berarti physical deletion. Bisa berarti:

- soft delete,
- archive,
- revoke,
- cancel,
- remove from collection,
- mark as inactive,
- tombstone,
- legal hold aware deletion,
- unlink relationship.

Contoh:

```http
DELETE /cases/CASE-001/attachments/ATT-55
```

Efek domain: attachment tidak lagi menjadi bagian dari case.

### 9.2 DELETE Is Idempotent

Request yang sama berulang menghasilkan efek akhir sama: resource tidak tersedia/terhubung lagi.

Response pertama:

```http
HTTP/1.1 204 No Content
```

Response kedua bisa:

```http
HTTP/1.1 404 Not Found
```

Atau tetap:

```http
HTTP/1.1 204 No Content
```

Keduanya bisa defensible tergantung API contract. Untuk client simplicity, banyak API memilih `204` untuk delete yang sudah tidak ada, selama tidak ada security leakage. Tetapi `404` bisa berguna untuk memberi tahu resource memang tidak ada.

### 9.3 DELETE and Legal/Regulatory Domains

Dalam domain enforcement/regulatory, DELETE sering tidak boleh berarti hilang dari audit trail.

Contoh:

```http
DELETE /evidence/E-123
```

Pertanyaan yang harus dijawab:

- Apakah evidence boleh dihapus secara hukum?
- Apakah sedang legal hold?
- Apakah evidence sudah dipakai dalam decision?
- Apakah deletion harus require approval?
- Apakah deletion hanya remove visibility?
- Apakah harus ada tombstone?
- Apakah metadata tetap ada?
- Apakah binary object dihapus dari object storage?
- Apakah retention policy berlaku?

Untuk domain seperti ini, command lebih eksplisit sering lebih aman:

```http
POST /evidence/E-123/deletion-requests
Content-Type: application/json

{
  "reason": "Duplicate upload",
  "requestedBy": "investigator-17"
}
```

Lalu approval workflow memutuskan deletion.

### 9.4 DELETE with Body

DELETE body sering ambigu secara interoperabilitas. Beberapa framework mendukung, tetapi banyak tooling/proxy tidak mengandalkannya. Hindari desain yang membutuhkan body pada DELETE.

Buruk:

```http
DELETE /cases/CASE-001
Content-Type: application/json

{
  "reason": "Duplicate case"
}
```

Lebih eksplisit:

```http
POST /cases/CASE-001/closure-requests
Content-Type: application/json

{
  "reason": "Duplicate case",
  "duplicateOf": "CASE-0007"
}
```

Atau:

```http
POST /cases/CASE-001:close-as-duplicate
Content-Type: application/json

{
  "duplicateOf": "CASE-0007"
}
```

Jika benar-benar deletion sederhana tanpa reason, DELETE cocok.

---

## 10. OPTIONS — Capability Discovery and CORS Preflight

### 10.1 Semantics

OPTIONS meminta informasi tentang communication options untuk target resource atau server.

Contoh:

```http
OPTIONS /cases/CASE-001 HTTP/1.1
```

Response bisa:

```http
HTTP/1.1 204 No Content
Allow: GET, HEAD, PATCH, DELETE, OPTIONS
```

### 10.2 OPTIONS and CORS

Dalam web API, OPTIONS sering muncul sebagai CORS preflight:

```http
OPTIONS /cases/CASE-001 HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization, content-type
```

Backend/gateway menjawab apakah browser boleh mengirim actual request.

Ini akan dibahas lebih detail pada part CORS, tetapi di sini penting memahami bahwa OPTIONS bukan endpoint bisnis. OPTIONS adalah protocol capability request.

### 10.3 Allow Header

Jika method tidak didukung, server dapat mengembalikan:

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD, PATCH, OPTIONS
```

`405` berbeda dari `404`. `404` mengatakan resource tidak ditemukan atau disembunyikan. `405` mengatakan resource ada, tetapi method tersebut tidak didukung.

---

## 11. TRACE — Usually Disable

TRACE adalah method diagnostic yang meminta server melakukan message loop-back. Dalam banyak production environment, TRACE dinonaktifkan karena bisa membuka risiko security seperti cross-site tracing atau leakage melalui intermediary tertentu.

Untuk aplikasi backend modern, jarang sekali ada alasan membiarkan TRACE aktif di public API.

Prinsip praktis:

- disable TRACE di reverse proxy/gateway/container,
- pastikan security scan mengecek method exposure,
- return `405 Method Not Allowed` atau block di edge.

---

## 12. CONNECT — Tunnel Semantics

CONNECT digunakan terutama oleh proxy untuk membuat tunnel ke server, misalnya untuk HTTPS melalui proxy.

Contoh konseptual:

```http
CONNECT example.com:443 HTTP/1.1
Host: example.com:443
```

Untuk backend application API biasa, CONNECT biasanya tidak relevan dan sebaiknya tidak diekspos.

Jika CONNECT terlihat di application logs yang tidak seharusnya, itu bisa menandakan:

- proxy misconfiguration,
- scanning,
- abuse attempt,
- salah routing di edge.

---

## 13. Method Selection by Resource Shape

Pemilihan method tidak bisa dipisahkan dari model resource. Berikut mental model praktis.

### 13.1 Collection Resource

```http
GET /cases
POST /cases
```

- `GET /cases`: list/search collection.
- `POST /cases`: create new case under collection.

### 13.2 Item Resource

```http
GET /cases/CASE-001
PUT /cases/CASE-001
PATCH /cases/CASE-001
DELETE /cases/CASE-001
```

- `GET`: retrieve case representation.
- `PUT`: replace case representation, jarang aman untuk aggregate besar.
- `PATCH`: partial modification.
- `DELETE`: remove/archive/delete case, bila domain mengizinkan.

### 13.3 Sub-resource

```http
GET /cases/CASE-001/status
PUT /cases/CASE-001/status
```

Berguna ketika field tertentu sebenarnya punya lifecycle/validation tersendiri.

### 13.4 Relationship Resource

```http
PUT /cases/CASE-001/assignees/investigator-17
DELETE /cases/CASE-001/assignees/investigator-17
```

Ini idempotent untuk add/remove relationship.

Alternative command style:

```http
POST /cases/CASE-001/assignment-events
```

Lebih cocok bila assignment adalah auditable event dengan reason, policy, actor, dan approval.

### 13.5 Command Resource

```http
POST /cases/CASE-001/escalations
POST /cases/CASE-001/closure-requests
POST /cases/CASE-001/approval-requests
```

Cocok untuk workflow-heavy domain.

---

## 14. CRUD Is Not Enough for Real Backend Domains

Banyak tutorial mengajarkan mapping sederhana:

| CRUD | HTTP |
|---|---|
| Create | POST |
| Read | GET |
| Update | PUT/PATCH |
| Delete | DELETE |

Ini berguna sebagai awal, tetapi tidak cukup untuk sistem nyata.

Regulatory/enforcement lifecycle tidak hanya CRUD:

- submit case,
- assign investigator,
- request evidence,
- upload evidence,
- validate evidence,
- escalate case,
- request legal review,
- approve enforcement action,
- issue notice,
- receive appeal,
- reopen case,
- close case,
- archive case.

Jika semua dipaksa menjadi:

```http
PATCH /cases/{id}
{ "status": "APPROVED" }
```

maka domain semantics hilang. Backend jadi sulit menjawab:

- Siapa yang melakukan action?
- Atas dasar policy apa?
- Dari status mana ke status mana?
- Apakah transition valid?
- Apakah required evidence lengkap?
- Apakah reviewer punya authority?
- Apakah ada conflict dengan concurrent update?
- Apakah ini attempt, request, approval, atau final state change?
- Bagaimana audit event dibangun?

Dalam workflow-heavy domain, sering lebih baik memodelkan transition sebagai command/event resource.

Contoh:

```http
POST /cases/CASE-001/review-submissions
Content-Type: application/json

{
  "submittedBy": "investigator-17",
  "evidenceBundleId": "BUNDLE-77",
  "comment": "All mandatory checks completed."
}
```

Kemudian backend menjalankan:

- authentication,
- authorization,
- validation,
- state machine guard,
- evidence completeness check,
- audit logging,
- state transition,
- notification,
- response generation.

HTTP method di sini bukan sekadar POST. Ia menyatakan bahwa client mengirim command/submission ke subordinate resource collection.

---

## 15. Retry Semantics by Method

Distributed systems tidak reliable. Request bisa timeout, connection bisa reset, response bisa hilang, gateway bisa retry, client bisa retry, user bisa double-click.

Method menentukan default retry assumption.

### 15.1 GET Retry

GET umumnya aman untuk retry karena safe dan idempotent.

Namun tetap perhatikan:

- backend jangan melakukan mutation domain,
- query jangan terlalu mahal,
- rate limit tetap berlaku,
- expensive search GET tetap bisa membebani sistem.

### 15.2 PUT Retry

PUT aman untuk retry dari sisi state akhir, tetapi side effect harus didesain idempotent.

Problem:

```java
public void updateStatus(String caseId, Status status) {
    repository.updateStatus(caseId, status);
    emailService.sendStatusChangedEmail(caseId, status);
}
```

Jika request retry dengan status sama, email bisa terkirim berkali-kali.

Lebih baik:

```java
public void updateStatus(String caseId, Status newStatus) {
    Case c = repository.find(caseId);
    Status oldStatus = c.status();

    if (oldStatus == newStatus) {
        return;
    }

    c.changeStatus(newStatus);
    repository.save(c);
    outbox.publish(new CaseStatusChanged(caseId, oldStatus, newStatus));
}
```

### 15.3 DELETE Retry

DELETE secara state effect idempotent. Retry biasanya aman, tetapi security response harus diperhatikan.

Untuk resource milik tenant lain, jangan bocorkan existence:

```http
DELETE /tenants/T1/cases/CASE-SECRET
```

Jika caller tidak punya akses, response mungkin `404` untuk menyembunyikan resource, bukan `403`, tergantung policy.

### 15.4 POST Retry

POST paling berbahaya untuk retry otomatis.

Untuk operasi penting:

- gunakan `Idempotency-Key`,
- gunakan command ID client-generated,
- simpan request fingerprint,
- replay response bila duplicate,
- tentukan expiration window,
- tangani in-progress duplicate,
- pastikan side effect downstream tidak double.

---

## 16. Method and Status Code Pairing

Method tidak berdiri sendiri. Ia berpasangan dengan status code.

### 16.1 GET

| Situation | Status |
|---|---|
| resource found | 200 |
| conditional GET not modified | 304 |
| resource not found | 404 |
| resource intentionally gone | 410 |
| unauthorized | 401 |
| forbidden | 403 atau 404 masking |
| unsupported representation requested | 406 |

### 16.2 POST

| Situation | Status |
|---|---|
| created resource | 201 + Location |
| accepted async | 202 + Location |
| processed with result | 200 |
| processed no response body | 204 |
| validation failed | 400/422 |
| conflict with current state | 409 |
| duplicate idempotency conflict | 409/422 depending contract |

### 16.3 PUT

| Situation | Status |
|---|---|
| created at URI | 201 |
| replaced and returned | 200 |
| replaced no body | 204 |
| precondition failed | 412 |
| conflict | 409 |
| unsupported media type | 415 |

### 16.4 PATCH

| Situation | Status |
|---|---|
| patched and returned | 200 |
| patched no body | 204 |
| invalid patch syntax | 400 |
| unsupported patch media type | 415 |
| semantic validation failed | 422 |
| version mismatch | 412 |
| conflict with state transition | 409 |

### 16.5 DELETE

| Situation | Status |
|---|---|
| deleted no body | 204 |
| deletion accepted async | 202 |
| deleted with representation | 200 |
| not found | 404 |
| already gone | 404/410/204 depending contract |
| legal hold/conflict | 409 |
| forbidden | 403 |

---

## 17. Method and Authorization

Authorization should understand method semantics.

Example permissions:

| Method + Resource | Permission |
|---|---|
| GET /cases/{id} | case:read |
| PATCH /cases/{id} | case:update |
| DELETE /cases/{id} | case:delete/archive |
| POST /cases/{id}/escalations | case:escalate |
| POST /cases/{id}/approval-requests | case:request-approval |
| PUT /cases/{id}/assignees/{userId} | case:assign |

Weak design:

```java
@PreAuthorize("hasRole('CASE_USER')")
@PatchMapping("/cases/{id}")
```

This allows too broad modification if field-level/domain checks are not enforced.

Better design:

- separate command endpoints for high-risk operations,
- enforce transition-specific authorization,
- validate actor authority,
- audit method + target + command + decision.

---

## 18. Method and Audit Trail

Audit logs should include method because method reveals intent.

Useful audit fields:

- timestamp,
- authenticated principal,
- tenant,
- HTTP method,
- target URI template,
- resource ID,
- command type,
- request correlation ID,
- idempotency key,
- status code,
- domain result,
- old state,
- new state,
- authorization decision,
- validation outcome,
- source IP / trusted proxy chain,
- user agent or client application ID.

Poor audit:

```text
User updated case.
```

Better audit:

```json
{
  "eventType": "CASE_ESCALATION_REQUESTED",
  "httpMethod": "POST",
  "uriTemplate": "/cases/{caseId}/escalations",
  "caseId": "CASE-001",
  "actor": "investigator-17",
  "tenant": "REG-AUTHORITY-1",
  "fromStatus": "UNDER_REVIEW",
  "toStatus": "ESCALATION_PENDING",
  "decision": "ALLOWED",
  "correlationId": "req-7f9a",
  "statusCode": 201
}
```

In regulated systems, method correctness supports defensibility. A mutation through GET can look careless in audit and security review.

---

## 19. Method and Observability

Metrics should be grouped by method and route template, not raw URI.

Good metric dimensions:

```text
http.server.request.duration{
  method="POST",
  route="/cases/{caseId}/escalations",
  status="201"
}
```

Bad metric dimensions:

```text
http.server.request.duration{
  method="POST",
  uri="/cases/CASE-001/escalations"
}
```

Raw URI causes high cardinality.

Method helps interpret errors:

- GET 500 spike: retrieval/read path issue.
- POST 409 spike: business conflict or state machine contention.
- PUT/PATCH 412 spike: optimistic concurrency conflicts.
- POST 429 spike: abuse/rate limit.
- DELETE 403 spike: authorization or policy enforcement.

---

## 20. Method and Caching

GET/HEAD are natural candidates for HTTP caching. Mutation methods often must invalidate or update caches.

Example:

```http
GET /cases/CASE-001/summary
Cache-Control: private, max-age=30
ETag: "summary-v12"
```

After mutation:

```http
PATCH /cases/CASE-001
If-Match: "case-v12"

{
  "priority": "HIGH"
}
```

Backend must ensure cache validators change. If ETag remains stale, clients can receive old representation.

Important: method misuse can poison cache assumptions. If `GET /approve` changes state, a cache or prefetcher can accidentally trigger mutation.

---

## 21. Method and API Gateway Policy

Gateway often applies policy by method and path:

- allowlist methods,
- block TRACE,
- enforce body size differently for POST/PUT/PATCH,
- rate limit mutation endpoints stricter,
- require authentication for unsafe methods,
- cache GET,
- reject GET with body,
- apply WAF rules,
- require idempotency key for certain POST endpoints.

Example policy:

| Method | Endpoint | Gateway Policy |
|---|---|---|
| GET | /public-catalog/** | cache, anonymous allowed |
| GET | /cases/** | auth required, no shared cache |
| POST | /payments/** | auth, idempotency key required |
| PATCH | /cases/** | auth, body size 256KB, no cache |
| DELETE | /evidence/** | auth, approval policy, no direct public exposure |
| TRACE | * | blocked |

If method design is sloppy, gateway policy becomes harder and less safe.

---

## 22. Java/Spring MVC Implementation Patterns

### 22.1 Basic Controller Mapping

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseApplicationService caseService;

    CaseController(CaseApplicationService caseService) {
        this.caseService = caseService;
    }

    @GetMapping("/{caseId}")
    ResponseEntity<CaseResponse> getCase(@PathVariable String caseId) {
        CaseResponse response = caseService.getCase(caseId);
        return ResponseEntity.ok(response);
    }

    @PostMapping
    ResponseEntity<CaseCreatedResponse> createCase(@Valid @RequestBody CreateCaseRequest request) {
        CaseCreatedResponse created = caseService.createCase(request);
        URI location = URI.create("/cases/" + created.id());
        return ResponseEntity.created(location).body(created);
    }

    @PatchMapping("/{caseId}")
    ResponseEntity<CaseResponse> patchCase(
            @PathVariable String caseId,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @Valid @RequestBody PatchCaseRequest request
    ) {
        CaseResponse updated = caseService.patchCase(caseId, ifMatch, request);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{caseId}/attachments/{attachmentId}")
    ResponseEntity<Void> removeAttachment(
            @PathVariable String caseId,
            @PathVariable String attachmentId
    ) {
        caseService.removeAttachment(caseId, attachmentId);
        return ResponseEntity.noContent().build();
    }
}
```

### 22.2 Command Endpoint Example

```java
@RestController
@RequestMapping("/cases/{caseId}")
class CaseWorkflowController {

    private final CaseWorkflowService workflowService;

    CaseWorkflowController(CaseWorkflowService workflowService) {
        this.workflowService = workflowService;
    }

    @PostMapping("/escalations")
    ResponseEntity<EscalationResponse> requestEscalation(
            @PathVariable String caseId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody RequestEscalationRequest request
    ) {
        EscalationResponse response = workflowService.requestEscalation(
                caseId,
                idempotencyKey,
                request
        );

        URI location = URI.create("/cases/" + caseId + "/escalations/" + response.escalationId());
        return ResponseEntity.created(location).body(response);
    }
}
```

### 22.3 Avoid Method-Overloaded God Endpoint

Bad:

```java
@PostMapping("/cases/{caseId}/action")
ResponseEntity<?> action(@PathVariable String caseId, @RequestBody ActionRequest request) {
    return switch (request.action()) {
        case "APPROVE" -> approve(caseId, request);
        case "REJECT" -> reject(caseId, request);
        case "ESCALATE" -> escalate(caseId, request);
        case "CLOSE" -> close(caseId, request);
        default -> throw new IllegalArgumentException("Unknown action");
    };
}
```

Problems:

- weak route semantics,
- broad authorization,
- weak metrics,
- messy validation,
- hard contract testing,
- poor audit clarity,
- harder evolution.

Better:

```http
POST /cases/{caseId}/approval-decisions
POST /cases/{caseId}/rejection-decisions
POST /cases/{caseId}/escalations
POST /cases/{caseId}/closure-requests
```

Each command has its own DTO, validation, authorization, audit, and state transition.

---

## 23. Java/Spring WebFlux Notes

Reactive stack does not change method semantics. It changes execution model.

Example:

```java
@RestController
@RequestMapping("/cases")
class ReactiveCaseController {

    private final ReactiveCaseService caseService;

    ReactiveCaseController(ReactiveCaseService caseService) {
        this.caseService = caseService;
    }

    @GetMapping("/{caseId}")
    Mono<ResponseEntity<CaseResponse>> getCase(@PathVariable String caseId) {
        return caseService.getCase(caseId)
                .map(ResponseEntity::ok);
    }

    @PostMapping
    Mono<ResponseEntity<CaseCreatedResponse>> createCase(
            @Valid @RequestBody Mono<CreateCaseRequest> requestMono
    ) {
        return requestMono
                .flatMap(caseService::createCase)
                .map(created -> ResponseEntity
                        .created(URI.create("/cases/" + created.id()))
                        .body(created));
    }
}
```

Important:

- do not block event loop,
- maintain idempotency semantics,
- preserve cancellation handling,
- implement validation carefully,
- propagate trace/context.

The method contract remains the same whether the backend is blocking or non-blocking.

---

## 24. Decision Framework: Choosing the Right Method

Use this step-by-step decision process.

### Step 1 — Is the client only asking to retrieve representation?

Yes → use GET or HEAD.

```http
GET /cases/CASE-001
HEAD /documents/DOC-123
```

No → continue.

### Step 2 — Is the client creating a new resource under a collection, with server-generated ID?

Yes → use POST to collection.

```http
POST /cases
POST /cases/CASE-001/attachments
```

No → continue.

### Step 3 — Is the client replacing/creating a resource at a known URI with full representation?

Yes → use PUT.

```http
PUT /cases/CASE-001/classification
```

No → continue.

### Step 4 — Is the client partially modifying a resource representation?

Yes → use PATCH.

```http
PATCH /cases/CASE-001
```

No → continue.

### Step 5 — Is the client removing/unlinking the target resource?

Yes → use DELETE.

```http
DELETE /cases/CASE-001/attachments/ATT-1
```

No → continue.

### Step 6 — Is this a command/workflow transition/process submission?

Use POST to a command/subordinate resource.

```http
POST /cases/CASE-001/escalations
POST /cases/CASE-001/approval-requests
POST /case-exports
```

### Step 7 — Is the operation async or long-running?

Usually POST to create job/process resource and return 202.

```http
POST /evidence-imports
```

Response:

```http
202 Accepted
Location: /evidence-imports/IMPORT-001
```

### Step 8 — Is the operation duplicate-sensitive?

Use idempotency key or client-generated command ID.

```http
POST /payments/PAY-123/captures
Idempotency-Key: ...
```

---

## 25. Common Anti-Patterns and Corrections

### 25.1 POST for Everything

Bad:

```http
POST /get-case
POST /update-case
POST /delete-case
POST /search-cases
```

Problems:

- weak semantics,
- poor cacheability,
- poor gateway policy,
- weaker metrics,
- client cannot infer retry safety,
- harder API governance.

Better:

```http
GET /cases/{caseId}
PATCH /cases/{caseId}
DELETE /cases/{caseId}
GET /cases?status=OPEN
```

### 25.2 GET with Mutation

Bad:

```http
GET /cases/CASE-001/approve
```

Better:

```http
POST /cases/CASE-001/approval-decisions
```

### 25.3 PUT as Partial Update

Bad:

```http
PUT /users/U1

{
  "email": "new@example.com"
}
```

Better:

```http
PATCH /users/U1

{
  "email": "new@example.com"
}
```

Or:

```http
PUT /users/U1/email

{
  "email": "new@example.com"
}
```

### 25.4 DELETE with Complex Business Reason

Bad:

```http
DELETE /cases/CASE-001

{
  "reason": "duplicate"
}
```

Better:

```http
POST /cases/CASE-001/closure-requests

{
  "reason": "duplicate",
  "duplicateOf": "CASE-0007"
}
```

### 25.5 Action God Endpoint

Bad:

```http
POST /cases/CASE-001/actions

{
  "type": "ESCALATE"
}
```

Could be acceptable for internal event ingestion, but often poor for public/domain API.

Better for external/domain API:

```http
POST /cases/CASE-001/escalations
```

### 25.6 Ignoring Idempotency for POST

Bad:

```http
POST /payments/PAY-123/captures
```

without idempotency.

Better:

```http
POST /payments/PAY-123/captures
Idempotency-Key: 1a0b29a1-4f1a-44cf-b38e-92825ddfc0aa
```

### 25.7 Returning 200 for Every Method

Bad:

```http
HTTP/1.1 200 OK

{
  "success": false,
  "error": "Validation failed"
}
```

Better:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
```

Method and status code must work together.

---

## 26. Regulatory Case Management Example

Let us design a small API around enforcement cases.

### 26.1 Case Collection

```http
GET /cases?status=UNDER_REVIEW&assignedTo=investigator-17
POST /cases
```

### 26.2 Case Item

```http
GET /cases/CASE-001
PATCH /cases/CASE-001
```

Avoid full PUT for large aggregate unless you truly support replacement.

### 26.3 Assignment

If assignment is simple relationship:

```http
PUT /cases/CASE-001/assignees/investigator-17
DELETE /cases/CASE-001/assignees/investigator-17
```

If assignment is auditable workflow:

```http
POST /cases/CASE-001/assignment-events
```

### 26.4 Evidence Upload

Small metadata create:

```http
POST /cases/CASE-001/evidence
```

Large file upload may use pre-signed URL flow:

```http
POST /cases/CASE-001/evidence-upload-requests
```

### 26.5 Submit for Review

```http
POST /cases/CASE-001/review-submissions
Idempotency-Key: ...
Content-Type: application/json

{
  "evidenceBundleId": "BUNDLE-77",
  "comment": "All mandatory checks complete."
}
```

### 26.6 Supervisor Decision

```http
POST /cases/CASE-001/review-decisions
Idempotency-Key: ...
Content-Type: application/json

{
  "decision": "APPROVE",
  "comment": "Proceed to legal review."
}
```

### 26.7 Close Case

```http
POST /cases/CASE-001/closure-decisions
Content-Type: application/json

{
  "outcome": "NO_ACTION",
  "reason": "Insufficient evidence"
}
```

Why not simply:

```http
PATCH /cases/CASE-001
{ "status": "CLOSED" }
```

Because closure is not just a field update. It is a decision event with authority, reason, policy, audit, and irreversible consequences.

---

## 27. Testing Method Semantics

Backend teams should test method semantics explicitly.

### 27.1 GET Does Not Mutate Domain State

Test:

1. capture domain state,
2. call GET,
3. verify domain state unchanged,
4. allow logs/metrics changes only.

### 27.2 PUT Idempotency

Test:

1. send PUT request,
2. send same PUT again,
3. verify final state same,
4. verify side effects not duplicated incorrectly.

### 27.3 DELETE Idempotency

Test:

1. delete resource,
2. delete same resource again,
3. verify contract response,
4. verify final state stable.

### 27.4 POST Duplicate Protection

For critical POST:

1. send POST with idempotency key,
2. simulate timeout,
3. resend same POST with same key,
4. verify no duplicate resource/charge/event,
5. verify response replay or deterministic duplicate response.

### 27.5 Unsupported Method

```http
PUT /cases
```

Should return:

```http
405 Method Not Allowed
Allow: GET, POST, OPTIONS
```

not random 404/500.

---

## 28. Production Readiness Checklist

For every endpoint, answer these questions:

1. What is the target resource?
2. What is the selected method and why?
3. Is the method safe?
4. Is it idempotent?
5. Is it cacheable?
6. Can client/gateway retry it safely?
7. If POST, does it need idempotency key?
8. If PUT/PATCH, does it need `If-Match`?
9. What are valid status codes?
10. What is the error response shape?
11. What authorization permission maps to this method+resource?
12. What audit event is emitted?
13. What metrics route label is used?
14. What body size limit applies?
15. Does gateway policy differ by method?
16. Are unsupported methods rejected consistently?
17. Are dangerous methods disabled?
18. Does API documentation state retry/idempotency behavior?
19. Does test suite validate method semantics?
20. Would this design still make sense behind a proxy/cache/retrying client?

---

## 29. Key Takeaways

1. HTTP method is a backend correctness contract.
2. GET must not perform domain mutation.
3. POST is flexible, but duplicate-sensitive and not idempotent by default.
4. PUT means replace/create at a known URI and is idempotent.
5. PATCH means partial modification and needs careful validation/concurrency handling.
6. DELETE is idempotent but does not necessarily mean physical deletion.
7. OPTIONS supports capability discovery and CORS preflight.
8. TRACE and CONNECT are usually not application API methods and should be controlled/disabled at edge.
9. Workflow-heavy systems often need command/subordinate resources, not just CRUD endpoints.
10. Method choice affects retry, caching, authorization, observability, audit, and gateway policy.

---

## 30. Latihan

### Latihan 1 — Classify Method Semantics

Untuk setiap endpoint berikut, identifikasi masalahnya dan desain ulang:

```http
GET /cases/CASE-001/close
POST /cases/CASE-001/get-summary
PUT /cases/CASE-001 { "priority": "HIGH" }
DELETE /cases/CASE-001 { "reason": "duplicate" }
POST /cases/CASE-001/action { "type": "ESCALATE" }
```

Expected direction:

- close as command/decision resource,
- summary via GET,
- partial update via PATCH or sub-resource PUT,
- closure request via POST,
- escalation as explicit resource.

### Latihan 2 — Design Method Matrix

Buat method matrix untuk domain `Evidence`:

- upload evidence,
- download evidence,
- update evidence metadata,
- request deletion,
- approve deletion,
- list evidence by case,
- replace classification,
- add tag,
- remove tag.

Untuk setiap operasi, tentukan:

- method,
- URI,
- idempotency,
- expected status codes,
- required headers,
- audit event.

### Latihan 3 — Retry Failure Model

Ambil endpoint:

```http
POST /cases/CASE-001/review-submissions
```

Buat failure matrix:

1. request hilang sebelum sampai server,
2. request diterima tetapi validation gagal,
3. commit sukses tetapi response timeout,
4. downstream notification gagal,
5. client retry dengan idempotency key sama,
6. client retry dengan body berbeda tetapi key sama.

Tentukan response dan state outcome.

---

## 31. Penutup

Method adalah salah satu lapisan paling kecil dalam definisi endpoint, tetapi efeknya menjalar ke seluruh sistem. Backend engineer yang matang tidak hanya bertanya “endpoint ini jalan atau tidak”, melainkan:

- Apakah method-nya jujur terhadap domain intent?
- Apakah aman terhadap retry?
- Apakah cocok dengan caching?
- Apakah jelas untuk authorization?
- Apakah audit-nya defensible?
- Apakah gateway dan observability bisa memahami operasi ini?
- Apakah desain ini tetap benar saat sistem tumbuh?

Pada part berikutnya kita akan masuk ke **status codes sebagai backend state contract**. Di sana kita akan membahas mengapa `200 OK` bukan jawaban universal, bagaimana memilih `201`, `202`, `204`, `400`, `401`, `403`, `404`, `409`, `412`, `422`, `429`, `500`, `502`, `503`, dan `504`, serta bagaimana status code membentuk kontrak operasional API.

---

## Status Seri

- Part saat ini: **Part 003 — Methods Deep Dive for Backend Correctness**
- Status: **seri belum selesai**
- Berikutnya: **Part 004 — Status Codes as Backend State Contracts**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-002.md">⬅️ Part 002 — Request Lifecycle: From Socket to Controller</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-004.md">Part 004 — Status Codes as Backend State Contracts ➡️</a>
</div>
