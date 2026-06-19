# learn-http-for-web-backend-perspective-part-025.md

# Part 025 — API Versioning and Evolution

> Seri: `learn-http-for-web-backend-perspective`  
> Part: `025 / 032`  
> Topik: API Versioning and Evolution  
> Audiens: Java software engineer / backend engineer  
> Fokus: menjaga API HTTP tetap bisa berevolusi tanpa merusak client, operasional, audit, keamanan, dan governance.

---

## 0. Tujuan Part Ini

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan **API versioning** dari **API evolution**.
2. Menentukan kapan perubahan API bersifat breaking dan kapan masih compatible.
3. Mendesain API yang bisa berkembang tanpa selalu membuat `/v2`, `/v3`, `/v4`.
4. Memilih strategi versioning:
   - URL path versioning,
   - header versioning,
   - media type versioning,
   - query parameter versioning,
   - capability-based evolution,
   - versionless additive evolution.
5. Mengelola deprecation dan sunset secara eksplisit.
6. Membuat compatibility policy yang jelas untuk consumer.
7. Menggunakan OpenAPI, contract test, dan telemetry untuk mengontrol perubahan API.
8. Memahami bagaimana Spring MVC/WebFlux dapat memetakan versi API.
9. Mendesain evolution strategy untuk sistem workflow-heavy seperti regulatory case management.

---

## 1. Masalah Dasar: API Tidak Pernah Diam

API HTTP di backend production jarang stabil selamanya.

Ia berubah karena:

1. Business process berubah.
2. Regulasi berubah.
3. Field baru diperlukan.
4. Field lama salah definisi.
5. Authorization model berubah.
6. Error taxonomy diperbaiki.
7. Performance membutuhkan pagination baru.
8. Security membutuhkan masking/redaction.
9. Domain model berkembang.
10. Client baru punya kebutuhan berbeda.
11. Client lama tidak bisa langsung upgrade.

Kesalahan umum engineer adalah menyamakan perubahan API dengan:

```text
Kalau berubah, buat /v2.
```

Itu terlalu kasar.

Versi API adalah **alat terakhir** untuk mengelola breaking change. Sebelum versioning, kamu perlu memahami compatibility.

---

## 2. API Versioning vs API Evolution

### 2.1 API Evolution

API evolution adalah proses membuat API berubah seiring waktu sambil menjaga client tetap bisa berjalan.

Contoh evolution non-breaking:

```json
{
  "id": "case-123",
  "status": "UNDER_REVIEW"
}
```

Berubah menjadi:

```json
{
  "id": "case-123",
  "status": "UNDER_REVIEW",
  "priority": "HIGH"
}
```

Jika client lama mengabaikan unknown field, ini biasanya compatible.

### 2.2 API Versioning

API versioning adalah mekanisme eksplisit untuk membedakan kontrak API yang berbeda.

Contoh:

```http
GET /v1/cases/case-123
GET /v2/cases/case-123
```

Atau:

```http
GET /cases/case-123
Accept: application/vnd.acme.case+json;version=2
```

Versioning berguna ketika server harus mendukung dua kontrak yang tidak bisa disatukan secara compatible.

### 2.3 Mental Model

```text
Evolution = membuat API berubah dengan disruption minimal.
Versioning = mekanisme eksplisit saat satu kontrak tidak cukup.
```

Engineer top-tier tidak cepat-cepat membuat versi baru. Ia lebih dulu bertanya:

1. Apakah perubahan ini breaking?
2. Bisa dibuat additive?
3. Bisa didukung lewat capability flag?
4. Bisa dibedakan lewat representation?
5. Bisa dipisah menjadi resource baru?
6. Bisa dikomunikasikan lewat deprecation/sunset?
7. Apakah client lama benar-benar harus tetap didukung?

---

## 3. Apa Itu Breaking Change?

Breaking change adalah perubahan yang dapat membuat client yang sebelumnya valid menjadi gagal, salah interpretasi, tidak aman, atau tidak sesuai kontrak.

Breaking change bukan hanya compile-time. Dalam HTTP API, breaking change sering bersifat semantic.

---

## 4. Kategori Breaking Change

### 4.1 Removing Response Field

Sebelumnya:

```json
{
  "id": "case-123",
  "status": "OPEN",
  "assignedOfficer": "u-100"
}
```

Sesudah:

```json
{
  "id": "case-123",
  "status": "OPEN"
}
```

Jika client bergantung pada `assignedOfficer`, ini breaking.

---

### 4.2 Renaming Field

```json
{
  "assignedOfficer": "u-100"
}
```

Menjadi:

```json
{
  "assignee": "u-100"
}
```

Ini breaking kecuali kedua field didukung selama periode transisi.

---

### 4.3 Changing Field Type

```json
{
  "fineAmount": 1000000
}
```

Menjadi:

```json
{
  "fineAmount": "1000000.00"
}
```

Ini breaking karena client parser bisa gagal atau interpretasi berubah.

---

### 4.4 Changing Field Meaning

```json
{
  "status": "CLOSED"
}
```

Sebelumnya `CLOSED` berarti:

```text
case completed and no further action allowed
```

Sesudah `CLOSED` berarti:

```text
case administratively closed but can be reopened
```

Ini jauh lebih berbahaya daripada rename. Nama field sama, tipe sama, tapi semantic berubah.

---

### 4.5 Adding Required Request Field

Sebelumnya:

```json
{
  "caseId": "case-123",
  "comment": "Need further review"
}
```

Sesudah:

```json
{
  "caseId": "case-123",
  "comment": "Need further review",
  "reasonCode": "LEGAL_REVIEW"
}
```

Jika `reasonCode` wajib dan client lama tidak mengirimnya, ini breaking.

---

### 4.6 Tightening Validation

Sebelumnya:

```json
{
  "comment": "ok"
}
```

Diterima.

Sesudah minimal panjang komentar 20 karakter.

Client lama bisa gagal. Ini breaking secara behavior.

Tightening validation kadang diperlukan untuk security atau regulatory correctness, tetapi tetap harus dikelola sebagai breaking atau policy change.

---

### 4.7 Changing Status Code Semantics

Sebelumnya:

```http
POST /cases/case-123/assignments
HTTP/1.1 201 Created
```

Sesudah:

```http
HTTP/1.1 202 Accepted
```

Jika client mengharapkan resource langsung tersedia, perubahan ke async behavior bisa breaking.

---

### 4.8 Changing Error Shape

Sebelumnya:

```json
{
  "code": "CASE_NOT_FOUND",
  "message": "Case not found"
}
```

Sesudah:

```json
{
  "type": "https://api.example.com/problems/not-found",
  "title": "Not Found",
  "status": 404
}
```

Bagus secara standard, tetapi breaking jika client lama membaca `code`.

---

### 4.9 Changing Pagination Contract

Sebelumnya:

```http
GET /cases?page=3&size=50
```

Sesudah:

```http
GET /cases?cursor=eyJ..."
```

Ini breaking jika endpoint sama dan client lama tidak bisa memakai cursor.

Solusi lebih aman:

```http
GET /cases?page=3&size=50
GET /cases?cursor=eyJ..."
```

atau resource/query endpoint baru.

---

### 4.10 Changing Authorization Behavior

Sebelumnya role `SUPERVISOR` dapat membaca semua cases.

Sesudah hanya dapat membaca cases di region sendiri.

Dari sisi security mungkin benar, tetapi dari sisi client behavior bisa breaking.

Authorization changes harus ditangani sebagai contract-impacting change, terutama di sistem enterprise/regulatory.

---

## 5. Non-Breaking Change

Tidak semua perubahan perlu versi baru.

Biasanya non-breaking:

1. Menambah optional response field.
2. Menambah optional request field.
3. Menambah enum value jika client dirancang untuk unknown enum.
4. Menambah endpoint baru.
5. Menambah link baru.
6. Menambah error detail tambahan tanpa menghapus field lama.
7. Menambah header response optional.
8. Menambah media type alternatif.
9. Melonggarkan validasi.
10. Menambah filter query optional.

Namun hati-hati: “biasanya” bukan “selalu”.

Contoh menambah enum value bisa breaking jika client menggunakan exhaustive switch:

```java
switch (status) {
  case OPEN -> ...;
  case CLOSED -> ...;
  // no default branch
}
```

Karena itu API contract harus mendefinisikan apakah enum bersifat closed atau open.

---

## 6. Compatibility Direction

Ada dua jenis compatibility yang sering tertukar.

### 6.1 Backward Compatibility

Server baru masih bisa melayani client lama.

```text
Old client + new server = works
```

Ini paling penting untuk public API.

### 6.2 Forward Compatibility

Client lama dapat menerima response yang mengandung hal-hal baru.

```text
Old client + future server response = works
```

Ini membutuhkan client mengabaikan unknown field, toleran terhadap enum baru, dan tidak bergantung pada field ordering.

### 6.3 Consumer Compatibility

Dalam microservices, compatibility tidak abstrak. Ia bergantung pada consumer nyata.

Perubahan bisa terlihat compatible secara teori, tetapi breaking untuk consumer tertentu.

Contoh:

Server menambah response field `priority`.

Secara JSON additive, ini compatible.

Namun ada consumer dengan strict deserializer:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Consumer tersebut bisa gagal.

Maka API governance perlu mengatur expectation:

```text
Clients MUST ignore unknown response fields.
```

---

## 7. Kontrak API Tidak Hanya JSON Schema

Kontrak API mencakup:

1. URI.
2. Method.
3. Status code.
4. Request headers.
5. Response headers.
6. Media type.
7. Request body shape.
8. Response body shape.
9. Error shape.
10. Authentication scheme.
11. Authorization behavior.
12. Rate limit behavior.
13. Pagination semantics.
14. Sorting/filtering semantics.
15. Idempotency rules.
16. Cache semantics.
17. Consistency expectations.
18. Retry semantics.
19. Deprecation policy.
20. Observability identifiers.

Jika kamu hanya membandingkan OpenAPI schema, kamu bisa melewatkan semantic breaking changes.

---

## 8. Versioning Strategy 1: URL Path Versioning

Contoh:

```http
GET /v1/cases/case-123
GET /v2/cases/case-123
```

### Kelebihan

1. Mudah dipahami.
2. Mudah di-route di gateway.
3. Mudah didokumentasikan.
4. Mudah dipisahkan deployment-nya.
5. Cocok untuk API publik.
6. Cocok untuk perubahan besar.

### Kekurangan

1. Versi menjadi bagian dari resource identifier.
2. Bisa mendorong duplikasi controller.
3. Banyak endpoint harus digandakan.
4. Migrasi client bisa berat.
5. Sering dipakai terlalu cepat.

### Cocok Untuk

1. Public API.
2. External partner API.
3. Breaking change besar.
4. Perbedaan representasi dan behavior yang sulit disatukan.
5. Gateway-level traffic split.

### Contoh Spring

```java
@RestController
@RequestMapping("/v1/cases")
class CaseV1Controller {

    @GetMapping("/{id}")
    CaseV1Response get(@PathVariable String id) {
        return service.getV1(id);
    }
}

@RestController
@RequestMapping("/v2/cases")
class CaseV2Controller {

    @GetMapping("/{id}")
    CaseV2Response get(@PathVariable String id) {
        return service.getV2(id);
    }
}
```

### Risiko

Controller duplication sering membuat business rule divergen.

Lebih sehat:

```text
controller version berbeda
        ↓
mapper/adaptor berbeda
        ↓
same application service
        ↓
same domain model
```

---

## 9. Versioning Strategy 2: Header Versioning

Contoh:

```http
GET /cases/case-123
API-Version: 2
```

atau:

```http
GET /cases/case-123
X-API-Version: 2
```

Catatan: gunakan header custom dengan hati-hati. Banyak organisasi memakai `API-Version`, `X-API-Version`, atau nama vendor-specific.

### Kelebihan

1. URI tetap stabil.
2. Versi tidak mencemari resource identifier.
3. Gateway bisa route berdasarkan header.
4. Cocok untuk internal API.
5. Cocok untuk gradual migration.

### Kekurangan

1. Kurang terlihat saat browser/manual testing.
2. Bisa membingungkan caching jika tidak pakai `Vary`.
3. Dokumentasi harus sangat jelas.
4. Some clients/proxies mungkin tidak menyertakan header dengan benar.

### Cache Implication

Jika response berbeda berdasarkan header version, server harus mempertimbangkan:

```http
Vary: API-Version
```

Tanpa ini, shared cache dapat menyajikan representasi versi salah.

---

## 10. Versioning Strategy 3: Media Type Versioning

Contoh:

```http
GET /cases/case-123
Accept: application/vnd.acme.case+json;version=2
```

Atau:

```http
Content-Type: application/vnd.acme.case-command+json;version=2
```

### Kelebihan

1. Secara HTTP sangat representational.
2. Cocok jika perubahan utama ada di representation.
3. URI tetap stabil.
4. Bisa coexist dengan content negotiation.

### Kekurangan

1. Lebih kompleks untuk client.
2. Lebih kompleks untuk docs dan testing.
3. Banyak tim tidak disiplin memahami media type.
4. Caching perlu `Vary: Accept`.

### Cocok Untuk

1. API yang sangat representation-driven.
2. Hypermedia-style API.
3. Mature API platform.
4. Sistem yang benar-benar memanfaatkan content negotiation.

---

## 11. Versioning Strategy 4: Query Parameter Versioning

Contoh:

```http
GET /cases/case-123?api-version=2
```

### Kelebihan

1. Mudah dicoba.
2. Mudah terlihat di log.
3. Mudah dipakai client sederhana.
4. Gateway route relatif mudah.

### Kekurangan

1. Versi menjadi bagian query, bukan representation negotiation.
2. Riskan tercampur dengan business query.
3. Bisa mengacaukan cache key jika tidak dikontrol.
4. Kurang elegan untuk API maturity tinggi.

### Cocok Untuk

1. Internal API sederhana.
2. Platform yang sudah punya standar `api-version`.
3. Migration temporary.
4. Gateway yang lebih mudah memproses query daripada header.

---

## 12. Versioning Strategy 5: No Explicit Version, Additive Evolution

Contoh:

```http
GET /cases/case-123
```

Response berkembang secara additive.

### Kelebihan

1. API tetap sederhana.
2. Tidak ada version sprawl.
3. Client tidak dipaksa migrasi versi.
4. Cocok untuk internal controlled ecosystem.

### Kekurangan

1. Membutuhkan compatibility discipline tinggi.
2. Breaking change sulit dilakukan.
3. Perlu strong governance.
4. Client harus toleran terhadap perubahan.

### Cocok Untuk

1. Internal APIs.
2. Single organization ecosystem.
3. API dengan domain stabil.
4. Tim dengan consumer visibility kuat.

### Rule

Versionless API hanya aman jika ada compatibility rules eksplisit.

Contoh:

```text
Consumers MUST ignore unknown response fields.
Consumers MUST tolerate unknown enum values.
Providers MUST NOT remove fields without deprecation.
Providers MUST NOT change field semantics silently.
Providers MUST NOT add required request fields without new operation/version.
```

---

## 13. Versioning Strategy 6: Capability-Based Evolution

Kadang yang kamu butuhkan bukan versi, tapi capability.

Contoh:

```http
POST /cases/case-123/reviews
Prefer: return=representation
```

atau:

```http
GET /cases/case-123
X-Client-Capabilities: field-level-redaction,case-links-v2
```

atau response:

```json
{
  "id": "case-123",
  "status": "UNDER_REVIEW",
  "capabilities": [
    "can-submit-evidence",
    "can-request-extension",
    "can-escalate"
  ]
}
```

Capability-based evolution cocok untuk:

1. Client yang tidak semua upgrade bersamaan.
2. Fitur opsional.
3. Workflow UI yang butuh action availability.
4. Progressive rollout.
5. Backward-compatible feature negotiation.

Namun capability bukan pengganti authorization. Capability yang dikirim ke client hanya hint. Server tetap wajib enforce.

---

## 14. Resource Evolution: Tambah Resource Baru, Bukan Ubah Resource Lama

Kadang perubahan paling aman adalah membuat resource baru.

Buruk:

```http
POST /cases/{id}/close
```

Dulu artinya close final.

Sekarang artinya administrative close.

Lebih baik:

```http
POST /cases/{id}/administrative-closures
POST /cases/{id}/final-decisions
```

Daripada mengubah semantic endpoint lama, ekspresikan konsep domain baru sebagai resource baru.

Ini sering lebih baik daripada `/v2`.

---

## 15. Operation Evolution: Jangan Ubah Command Lama Diam-Diam

Jika command lama:

```http
POST /cases/{id}/assignments
```

Body:

```json
{
  "assigneeId": "u-100"
}
```

Lalu business butuh reason.

Jangan langsung membuat `reasonCode` required.

Pilihan:

### Pilihan A — Optional dengan default domain-safe

```json
{
  "assigneeId": "u-100",
  "reasonCode": "WORKLOAD_BALANCING"
}
```

Jika tidak ada `reasonCode`, server memakai default yang valid dan audit-friendly.

### Pilihan B — Endpoint baru

```http
POST /cases/{id}/assignment-decisions
```

```json
{
  "assigneeId": "u-100",
  "reasonCode": "LEGAL_REVIEW",
  "justification": "Specialized legal expertise required"
}
```

### Pilihan C — Version baru

```http
POST /v2/cases/{id}/assignments
```

Digunakan jika semantics command berubah signifikan.

---

## 16. Response Evolution Rules

### 16.1 Safe Additive Field

Biasanya aman:

```json
{
  "id": "case-123",
  "status": "OPEN",
  "createdAt": "2026-06-19T09:00:00Z"
}
```

Menjadi:

```json
{
  "id": "case-123",
  "status": "OPEN",
  "createdAt": "2026-06-19T09:00:00Z",
  "priority": "HIGH"
}
```

### 16.2 Risky Additive Field

Menambah field bisa risky jika:

1. Nama bertabrakan dengan client model.
2. Client strict terhadap unknown field.
3. Field mengubah interpretation field lain.
4. Field mengandung sensitive data.
5. Field memicu UI behavior yang tidak diantisipasi.

Contoh:

```json
{
  "status": "OPEN",
  "finalDecision": null
}
```

Jika client lama menganggap presence `finalDecision` berarti case sudah selesai, additive field bisa breaking secara semantic.

---

## 17. Request Evolution Rules

### 17.1 Menambah Optional Field

Biasanya aman:

```json
{
  "comment": "Please review",
  "notifyAssignee": true
}
```

Client lama tidak mengirim `notifyAssignee`, server default `false`.

### 17.2 Menambah Required Field

Breaking:

```json
{
  "comment": "Please review",
  "reasonCode": "LEGAL"
}
```

Jika client lama wajib mengirim `reasonCode`, API rusak.

### 17.3 Mengubah Default

Sangat berbahaya.

Sebelumnya missing `notifyAssignee` berarti `false`.

Sesudah missing berarti `true`.

Ini semantic breaking change.

---

## 18. Enum Evolution

Enum sering menjadi sumber breaking change tersembunyi.

### 18.1 Closed Enum

```text
Status values are fixed and no new values will be added without version change.
```

Cocok untuk protocol-level finite state yang sangat stabil.

### 18.2 Open Enum

```text
Server may add new status values. Clients must handle unknown values.
```

Cocok untuk domain yang berkembang.

### 18.3 Client Handling Pattern

```java
enum CaseStatus {
    OPEN,
    UNDER_REVIEW,
    CLOSED,
    UNKNOWN
}
```

Parser:

```java
static CaseStatus fromWire(String value) {
    try {
        return CaseStatus.valueOf(value);
    } catch (IllegalArgumentException ex) {
        return CaseStatus.UNKNOWN;
    }
}
```

### 18.4 Backend Contract

Dokumentasikan apakah enum bersifat open.

Di OpenAPI, kamu bisa tetap mendokumentasikan known values, tetapi guideline consumer harus menyatakan toleransi terhadap unknown value jika enum open.

---

## 19. Null, Missing, and Default Evolution

Tiga hal ini tidak sama:

```json
{
  "field": null
}
```

berbeda dari:

```json
{}
```

berbeda dari:

```json
{
  "field": ""
}
```

Evolution rule:

1. Jangan mengubah makna missing field diam-diam.
2. Jangan mengubah nullable menjadi non-null tanpa transisi.
3. Jangan mengubah default value diam-diam.
4. Jangan menghapus `null` support jika client lama bisa mengirim null.
5. Jangan menambahkan `null` response jika client lama menganggap field selalu non-null.

---

## 20. Error Contract Evolution

Error response sering lebih sering diparse client daripada yang disadari provider.

Contoh client:

```java
if (error.code().equals("CASE_ALREADY_CLOSED")) {
    showReopenButton();
}
```

Maka mengubah error code menjadi `INVALID_CASE_STATE` bisa breaking.

### Rule Error Evolution

1. Error `code` harus stable.
2. `title`/`message` boleh berubah untuk manusia, tapi jangan dipakai sebagai machine contract.
3. Tambahkan field baru secara additive.
4. Jangan mengubah status code tanpa migration notice.
5. Jangan menggabungkan beberapa error code lama menjadi satu generic code tanpa transisi.
6. Jangan membocorkan field baru yang sensitive.

### Example

```json
{
  "type": "https://api.example.com/problems/case-already-closed",
  "title": "Case already closed",
  "status": 409,
  "code": "CASE_ALREADY_CLOSED",
  "detail": "This case cannot be assigned because it is already closed.",
  "instance": "/cases/case-123/assignments/req-789"
}
```

Jika ingin mengganti type URI, pertahankan `code` lama selama transisi.

---

## 21. Header Contract Evolution

Header juga bagian kontrak.

Breaking examples:

1. Menghapus `ETag` dari resource yang dipakai client untuk concurrency.
2. Mengubah cache header dari `no-store` menjadi cacheable untuk data sensitive.
3. Menghapus `Location` dari `201 Created`.
4. Mengubah `Retry-After` behavior.
5. Mengubah `Content-Disposition` filename format yang diparse client.
6. Menghapus rate limit headers yang dipakai client untuk throttling.

Safe additive:

1. Menambah `Deprecation`.
2. Menambah `Sunset`.
3. Menambah `Link` ke docs.
4. Menambah correlation ID header.

Tetap dokumentasikan.

---

## 22. Deprecation

Deprecation berarti:

```text
Kontrak masih bekerja, tetapi tidak direkomendasikan dan akan berubah/dihapus di masa depan.
```

Deprecation bukan removal.

Backend yang baik tidak hanya menulis di release notes. Ia memberi sinyal runtime.

Contoh:

```http
HTTP/1.1 200 OK
Deprecation: @1719878400
Link: <https://api.example.com/docs/deprecations/case-v1>; rel="deprecation"
```

Header `Deprecation` sudah distandarkan dalam RFC 9745. Gunanya untuk memberi tahu consumer bahwa resource yang diakses akan atau sudah deprecated.

---

## 23. Sunset

Sunset berarti:

```text
Resource kemungkinan tidak lagi tersedia setelah waktu tertentu.
```

Contoh:

```http
HTTP/1.1 200 OK
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.com/migration/case-v2>; rel="successor-version"
```

Sunset berbeda dari Deprecation:

```text
Deprecation = jangan pakai lagi, migrasi disarankan.
Sunset = ada batas waktu resource/API akan berhenti tersedia.
```

RFC 8594 mendefinisikan `Sunset` response header untuk mengindikasikan bahwa URI kemungkinan menjadi tidak responsif setelah waktu tertentu.

---

## 24. Deprecation Lifecycle

Lifecycle sehat:

```text
Active
  ↓
Deprecated
  ↓
Sunset scheduled
  ↓
Read-only / limited support
  ↓
Removed / Gone
```

### Stage 1 — Active

Endpoint normal.

### Stage 2 — Deprecated

Response mulai mengirim:

```http
Deprecation: @1767225600
Link: <https://api.example.com/docs/migrate-v2>; rel="deprecation"
```

### Stage 3 — Sunset Scheduled

Response mulai mengirim:

```http
Sunset: Thu, 31 Dec 2026 23:59:59 GMT
```

### Stage 4 — Limited Support

Bisa jadi endpoint tetap read-only.

### Stage 5 — Removed

Response bisa menjadi:

```http
HTTP/1.1 410 Gone
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.example.com/problems/api-sunset",
  "title": "API version no longer available",
  "status": 410,
  "code": "API_VERSION_SUNSET",
  "detail": "Version v1 was sunset on 2026-12-31. Use /v2/cases instead."
}
```

---

## 25. Choosing the Right Versioning Strategy

Decision matrix:

| Situation | Recommended Strategy |
|---|---|
| Add optional response field | No new version |
| Add optional request field | No new version |
| Add endpoint | No new version |
| Rename response field | Deprecate old field, add new field, later version/removal |
| Remove field | Version or long deprecation |
| Change field meaning | New field/resource/version |
| Add required request field | New operation or version |
| Change sync to async | New endpoint/version |
| Change pagination style | Support both or new endpoint/version |
| Public partner API breaking change | URL versioning often best |
| Representation-only variant | Media type versioning |
| Internal service ecosystem | Header or additive evolution |
| API gateway routing required | URL/header/query depending gateway capability |
| Browser-consumed API | URL or header; avoid obscure media type unless team mature |

---

## 26. Avoid Version Explosion

Version explosion terjadi ketika setiap perubahan kecil membuat versi baru.

Contoh buruk:

```text
/v1/cases
/v2/cases
/v3/cases
/v4/cases
/v5/cases
```

Setiap versi punya controller, DTO, validation, tests, docs, bugs.

Masalah:

1. Maintenance cost naik.
2. Security patch harus diterapkan ke banyak versi.
3. Observability terfragmentasi.
4. Domain behavior divergen.
5. Client bingung versi mana yang benar.
6. Tim takut menghapus versi lama.

### Prinsip

```text
Version only when compatibility boundary truly changes.
```

---

## 27. Avoid Silent Semantic Change

Lebih buruk dari version explosion adalah silent semantic change.

Contoh:

Endpoint tetap:

```http
POST /cases/{id}/close
```

Tapi makna berubah dari final closure menjadi administrative closure.

Client lama tetap berhasil secara HTTP, tetapi business outcome salah.

Ini berbahaya dalam sistem regulatory karena bisa menghasilkan:

1. Audit inconsistency.
2. Legal dispute.
3. Invalid workflow transition.
4. Incorrect notification.
5. Incorrect SLA calculation.

Jika semantic berubah, buat kontrak baru atau transisi eksplisit.

---

## 28. Data Model Version vs API Version

Jangan menyamakan database schema version dengan API version.

```text
DB migration != API version
```

Kamu bisa mengubah database tanpa mengubah API.

Kamu juga bisa mengubah API tanpa mengubah database.

### Pattern

```text
API DTO v1
API DTO v2
    ↓
Application command/query model
    ↓
Domain model
    ↓
Persistence model
```

DTO version adalah boundary external. Domain model boleh berevolusi lebih bebas jika adapter menjaga compatibility.

---

## 29. DTO Versioning Pattern in Java

### 29.1 Separate DTOs

```java
record CaseResponseV1(
    String id,
    String status,
    String assignedOfficer
) {}

record CaseResponseV2(
    String id,
    String status,
    AssigneeDto assignee,
    String priority
) {}
```

Mapper:

```java
final class CaseResponseMapper {

    CaseResponseV1 toV1(CaseView view) {
        return new CaseResponseV1(
            view.id(),
            view.status().wireValue(),
            view.assignee() == null ? null : view.assignee().id()
        );
    }

    CaseResponseV2 toV2(CaseView view) {
        return new CaseResponseV2(
            view.id(),
            view.status().wireValue(),
            view.assignee() == null ? null : new AssigneeDto(
                view.assignee().id(),
                view.assignee().displayName()
            ),
            view.priority().wireValue()
        );
    }
}
```

### 29.2 Shared Domain Service

```java
@Service
class CaseQueryService {

    CaseView getCase(String caseId, Principal principal) {
        // authorization, loading, projection, policy
        return repository.findView(caseId, principal.tenantId());
    }
}
```

Controller v1/v2 hanya adapter.

---

## 30. Spring MVC URL Versioning Example

```java
@RestController
@RequestMapping("/v1/cases")
class CaseV1Controller {

    private final CaseQueryService queryService;
    private final CaseResponseMapper mapper;

    @GetMapping("/{caseId}")
    ResponseEntity<CaseResponseV1> get(
        @PathVariable String caseId,
        AuthenticatedUser user
    ) {
        CaseView view = queryService.getCase(caseId, user);
        return ResponseEntity.ok(mapper.toV1(view));
    }
}
```

```java
@RestController
@RequestMapping("/v2/cases")
class CaseV2Controller {

    private final CaseQueryService queryService;
    private final CaseResponseMapper mapper;

    @GetMapping("/{caseId}")
    ResponseEntity<CaseResponseV2> get(
        @PathVariable String caseId,
        AuthenticatedUser user
    ) {
        CaseView view = queryService.getCase(caseId, user);
        return ResponseEntity.ok(mapper.toV2(view));
    }
}
```

---

## 31. Spring Header Versioning Example

Traditional mapping approach:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @GetMapping(value = "/{caseId}", headers = "API-Version=1")
    CaseResponseV1 getV1(@PathVariable String caseId) {
        return mapper.toV1(queryService.getCase(caseId));
    }

    @GetMapping(value = "/{caseId}", headers = "API-Version=2")
    CaseResponseV2 getV2(@PathVariable String caseId) {
        return mapper.toV2(queryService.getCase(caseId));
    }
}
```

Response should include:

```http
Vary: API-Version
```

if representation differs.

Spring Framework also has explicit API versioning support in modern versions, with options to resolve version from path, header, query parameter, media type parameter, or custom logic.

---

## 32. Spring Media Type Versioning Example

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @GetMapping(
        value = "/{caseId}",
        produces = "application/vnd.acme.case.v1+json"
    )
    CaseResponseV1 getV1(@PathVariable String caseId) {
        return mapper.toV1(queryService.getCase(caseId));
    }

    @GetMapping(
        value = "/{caseId}",
        produces = "application/vnd.acme.case.v2+json"
    )
    CaseResponseV2 getV2(@PathVariable String caseId) {
        return mapper.toV2(queryService.getCase(caseId));
    }
}
```

Client:

```http
GET /cases/case-123
Accept: application/vnd.acme.case.v2+json
```

Response:

```http
Content-Type: application/vnd.acme.case.v2+json
Vary: Accept
```

---

## 33. OpenAPI and Versioning

OpenAPI bisa digunakan untuk:

1. Mendokumentasikan API per versi.
2. Membandingkan schema antar versi.
3. Menghasilkan client/server code.
4. Menjalankan linting governance.
5. Menjalankan breaking-change detection.
6. Menghubungkan docs dengan deprecation metadata.
7. Menjadi basis contract testing.

### OpenAPI Per Version

Struktur umum:

```text
openapi/v1.yaml
openapi/v2.yaml
```

Atau satu spec dengan multiple servers/paths, tetapi untuk breaking version biasanya lebih jelas dipisah.

### Deprecating Operation

```yaml
paths:
  /v1/cases/{caseId}:
    get:
      deprecated: true
      summary: Get case by ID
```

Namun `deprecated: true` di OpenAPI saja tidak cukup. Runtime response sebaiknya juga memberi header deprecation/sunset agar consumer yang sedang berjalan bisa terdeteksi.

---

## 34. Contract Testing

Contract testing membantu menjawab:

```text
Apakah provider masih memenuhi ekspektasi consumer?
```

Jenis:

1. Provider contract test.
2. Consumer-driven contract test.
3. Schema compatibility test.
4. Golden response test.
5. Backward compatibility diff.
6. Semantic test.

### Schema Diff Tidak Cukup

Schema diff bisa mendeteksi:

1. Field removed.
2. Field type changed.
3. Required field added.
4. Status code removed.

Tapi tidak selalu bisa mendeteksi:

1. Field meaning changed.
2. Default changed.
3. Authorization changed.
4. Ordering semantics changed.
5. Rate limit behavior changed.
6. Consistency changed.

Karena itu butuh semantic test dan consumer telemetry.

---

## 35. Compatibility Test Matrix

Untuk setiap endpoint penting, test minimal:

| Change Type | Test |
|---|---|
| Old client request | Still accepted |
| Old client response parsing | Still works |
| Unknown response field | Client tolerates |
| Unknown enum | Client does not crash |
| Missing optional field | Server default stable |
| Deprecated field | Still present during transition |
| Error code | Stable |
| Status code | Stable or documented |
| Header | Required headers still present |
| Pagination | Old mode still works |
| Auth | Existing permission behavior understood |
| Cache | `Vary` correct for version dimension |

---

## 36. Telemetry for API Evolution

Jangan sunset endpoint hanya berdasarkan asumsi.

Pantau:

1. Requests by API version.
2. Requests by client ID.
3. Requests by endpoint.
4. Deprecated endpoint usage.
5. Deprecated field usage if observable.
6. Error rate by version.
7. Latency by version.
8. Consumer migration progress.
9. User agent/client SDK version.
10. Auth principal/application ID.

Example metrics:

```text
http.server.requests{api_version="v1", route="/v1/cases/{id}", client_id="partner-a"}
api.deprecated.requests{endpoint="/v1/cases/{id}", client_id="partner-a"}
api.sunset.blocked{endpoint="/v1/cases/{id}"}
```

Log example:

```json
{
  "event": "deprecated_api_used",
  "apiVersion": "v1",
  "route": "/v1/cases/{caseId}",
  "clientId": "partner-a",
  "principal": "service-account-7",
  "sunsetAt": "2026-12-31T23:59:59Z",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

---

## 37. Client SDK Strategy

Jika kamu menyediakan SDK, versioning menjadi lebih kompleks.

API evolution harus sinkron dengan:

1. SDK major/minor version.
2. Generated client compatibility.
3. Runtime API version selection.
4. Deprecation warning in SDK.
5. Retry/idempotency behavior.
6. Error type mapping.

Rule:

```text
SDK major version may wrap API version, but they are not the same thing.
```

Contoh:

```text
Java SDK 3.x can call API v1 and v2.
Java SDK 4.x defaults to API v2.
API v1 sunset after migration window.
```

---

## 38. Database Migration and API Compatibility

Compatibility often depends on deployment order.

Bad deployment:

```text
1. Deploy DB migration removing column.
2. Old API still reads column.
3. Old API crashes.
```

Safer expand-contract pattern:

```text
1. Expand DB schema: add new column.
2. Deploy app writing both old and new.
3. Backfill data.
4. Deploy app reading new but still supporting old API.
5. Migrate clients.
6. Deprecate old API/field.
7. Stop writing old.
8. Remove old field/column later.
```

This is critical in zero-downtime deployments.

---

## 39. Multi-Service API Evolution

In microservices, API change impacts:

1. API gateway routes.
2. Service-to-service clients.
3. Async consumers.
4. Data pipelines.
5. Audit processors.
6. Search indexing.
7. Notification services.
8. Reporting/export jobs.
9. Mobile/web frontends.
10. External partner integrations.

Do not treat “only one endpoint changed” as local if downstream systems parse its output.

---

## 40. Versioning and Security

API evolution can create security issues.

Examples:

1. New response field exposes sensitive data.
2. Old API version lacks authorization fix.
3. Deprecated endpoint bypasses new policy.
4. V1 remains available with weaker validation.
5. Gateway applies auth to `/v2/**` but forgets `/v1/**`.
6. Old client receives field it should not see.
7. Version selected from untrusted header enables downgrade attack.

### Downgrade Risk

If client can choose older version:

```http
API-Version: 1
```

and v1 has weaker validation or weaker authorization, attacker may intentionally select v1.

Mitigation:

1. Apply critical security fixes to all supported versions.
2. Do not keep insecure legacy behavior.
3. Restrict old versions by client allowlist if needed.
4. Monitor old version usage.
5. Sunset aggressively when risk is high.

---

## 41. Versioning and Authorization

Authorization behavior is part of API contract, but security takes priority.

Suppose v1 allowed supervisor to read all cases.

New policy requires region restriction.

This breaks some clients, but may be required.

Approach:

1. Communicate policy change.
2. Provide migration guide.
3. Add telemetry.
4. Update docs and OpenAPI security notes.
5. Consider staged enforcement:
   - warn,
   - shadow deny,
   - enforce deny.
6. Keep audit trail.

Never keep unauthorized access just for compatibility.

---

## 42. Versioning and Caching

If representation differs by version, cache key must differ.

Path versioning:

```http
GET /v1/cases/case-123
GET /v2/cases/case-123
```

Cache naturally separates by URI.

Header versioning:

```http
GET /cases/case-123
API-Version: 2
```

Response should include:

```http
Vary: API-Version
```

Media type versioning:

```http
Accept: application/vnd.acme.case+json;version=2
```

Response should include:

```http
Vary: Accept
```

Without `Vary`, shared cache can return wrong version.

---

## 43. Versioning and Idempotency

Idempotency keys may need version dimension.

Example:

```http
POST /cases/case-123/assignments
Idempotency-Key: abc123
API-Version: 1
```

If same key used with version 2 and body semantics differ, dedup store must avoid incorrect replay.

Dedup key should include:

1. Tenant/client.
2. Operation/route.
3. API version.
4. Idempotency key.
5. Request fingerprint.

---

## 44. Versioning and Auditability

In regulatory systems, audit log must record API contract version used.

Example audit event:

```json
{
  "eventType": "CASE_ASSIGNMENT_REQUESTED",
  "caseId": "case-123",
  "actorId": "u-100",
  "apiVersion": "v1",
  "route": "/v1/cases/{caseId}/assignments",
  "requestSchemaVersion": "case-assignment-command.v1",
  "decisionPolicyVersion": "assignment-policy.2026-06",
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

This helps explain why old behavior occurred.

---

## 45. Versioning and Workflow State Machines

Workflow-heavy APIs need extra care.

Changing resource shape is easier than changing state transition semantics.

Example old transition:

```text
OPEN -> CLOSED
```

New transition:

```text
OPEN -> PRELIMINARY_DECISION -> FINAL_DECISION -> CLOSED
```

If old endpoint:

```http
POST /cases/{id}/close
```

is kept, what should it do?

Bad answers:

1. Silently map to `FINAL_DECISION`.
2. Silently skip new review state.
3. Return vague 400.

Better options:

1. Keep old close only for cases under old process version.
2. Return 409 with migration-specific problem detail.
3. Create new transition resources.
4. Version workflow process explicitly.

Example:

```json
{
  "id": "case-123",
  "processVersion": "enforcement-case-process.v2",
  "status": "PRELIMINARY_DECISION",
  "availableActions": [
    "submit-final-decision",
    "request-additional-evidence"
  ]
}
```

---

## 46. Process Version vs API Version

In workflow systems, distinguish:

```text
API version = external HTTP contract version.
Process version = business workflow definition version.
Policy version = decision/authorization/rules version.
Schema version = representation/data shape version.
```

Example:

```json
{
  "apiVersion": "v2",
  "processVersion": "case-process-2026-01",
  "policyVersion": "assignment-policy-2026-03",
  "schemaVersion": "case-response-2.1"
}
```

Do not hide process changes behind API version alone.

---

## 47. Migration Design

A good migration includes:

1. What changes.
2. Why it changes.
3. Who is affected.
4. Timeline.
5. New endpoint/schema.
6. Old-to-new mapping.
7. Error changes.
8. Auth changes.
9. Test environment.
10. SDK support.
11. Rollback plan.
12. Monitoring plan.
13. Sunset date.

### Migration Guide Structure

```markdown
# Migrating from Case API v1 to v2

## Summary

## Timeline

## Endpoint Mapping

| v1 | v2 | Notes |
|---|---|---|
| GET /v1/cases/{id} | GET /v2/cases/{id} | assignee shape changed |

## Request Changes

## Response Changes

## Error Changes

## Authorization Changes

## Caching Changes

## Examples

## Testing Checklist

## Support Contact
```

---

## 48. Rollout Patterns

### 48.1 Parallel Version Rollout

```text
Deploy v2 alongside v1.
Clients migrate gradually.
Monitor usage.
Sunset v1.
```

### 48.2 Shadow Response Validation

Server still returns v1, but internally maps to v2 and checks equivalence.

Useful before exposing v2.

### 48.3 Client Allowlist

Only selected clients can access v2:

```text
client-a -> v2 enabled
client-b -> v1 only
```

### 48.4 Feature Flag

Feature flag changes behavior inside same version. Dangerous if it changes contract without explicit client awareness.

Use feature flags for rollout, not for hiding permanent contract differences.

### 48.5 Canary by Version

Route small percentage of v2 traffic to new deployment.

---

## 49. API Governance Rules

A serious backend organization should have API compatibility rules.

Example:

```text
1. Providers MUST NOT remove response fields without deprecation.
2. Providers MUST NOT add required request fields to existing operations.
3. Providers MUST NOT change field meaning silently.
4. Providers MUST NOT change enum semantics silently.
5. Providers SHOULD treat response enums as open unless documented closed.
6. Providers MUST preserve stable error codes.
7. Providers MUST announce deprecations with runtime headers and documentation.
8. Providers MUST include Sunset before removal.
9. Providers MUST track deprecated usage by client.
10. Providers MUST test old client compatibility before deployment.
11. Clients MUST ignore unknown response fields.
12. Clients SHOULD tolerate unknown enum values.
13. Clients MUST NOT parse human-readable error messages as machine contract.
14. Clients SHOULD send explicit API version where required.
15. Gateways MUST route and cache versioned responses correctly.
```

---

## 50. Anti-Patterns

### 50.1 Version Everything

Every small change creates `/v2`, `/v3`, `/v4`.

Result: maintenance hell.

### 50.2 Version Nothing

Breaking changes deployed silently.

Result: client outage.

### 50.3 Breaking But Same Version

The worst form of “versionless” evolution.

### 50.4 Business Meaning Changed Under Same Field

Field name/type same, semantic changed.

Hard to detect automatically.

### 50.5 Deprecation Only in Release Notes

Runtime clients never see it.

### 50.6 Unsupported Versions Live Forever

Old insecure behavior remains reachable.

### 50.7 Controller Copy-Paste Per Version

Business logic diverges.

### 50.8 Client-Specific Forked API

```text
if client == A -> behavior A
if client == B -> behavior B
```

Sometimes unavoidable temporarily, but dangerous as permanent architecture.

### 50.9 Ignoring Error Contract

Changing error code/status/body without considering clients.

### 50.10 Ignoring Cache Vary

Header/media-type versioning without `Vary`.

---

## 51. Case Study: Regulatory Case API v1 to v2

### 51.1 v1 Response

```http
GET /v1/cases/case-123
```

```json
{
  "id": "case-123",
  "status": "OPEN",
  "assignedOfficer": "u-100",
  "createdAt": "2026-01-01T09:00:00Z"
}
```

Problems:

1. `assignedOfficer` only contains ID.
2. No process version.
3. No available actions.
4. Status enum too coarse.
5. No region/tenant visibility metadata.

### 51.2 v2 Response

```http
GET /v2/cases/case-123
```

```json
{
  "id": "case-123",
  "status": "UNDER_REVIEW",
  "processVersion": "enforcement-case-process-2026-01",
  "assignee": {
    "id": "u-100",
    "displayName": "A. Investigator"
  },
  "createdAt": "2026-01-01T09:00:00Z",
  "priority": "HIGH",
  "availableActions": [
    "submit-evidence",
    "request-supervisor-review"
  ]
}
```

This is likely breaking because:

1. `assignedOfficer` renamed/restructured.
2. `status` semantic changed.
3. Client behavior may depend on old status.

### 51.3 Migration Approach

Step 1: Add v1-compatible field to v2 during transition if useful.

```json
{
  "assignee": {
    "id": "u-100",
    "displayName": "A. Investigator"
  },
  "assignedOfficer": "u-100"
}
```

Step 2: Mark v1 deprecated.

```http
Deprecation: @1761955200
Link: <https://api.example.com/docs/migrate-cases-v2>; rel="deprecation"
```

Step 3: Announce sunset.

```http
Sunset: Thu, 31 Dec 2026 23:59:59 GMT
```

Step 4: Monitor v1 usage by client.

Step 5: Block new clients from using v1.

Step 6: Remove v1 after contractual window.

---

## 52. Practical Checklist Before Changing an API

Ask:

1. Which clients use this endpoint?
2. Is the change request, response, header, status, error, auth, cache, or semantic?
3. Is it breaking?
4. Can it be additive?
5. Can old and new behavior coexist?
6. Does it require a new resource instead of new version?
7. Does it require versioned representation?
8. Does it change workflow state transitions?
9. Does it change authorization or visibility?
10. Does it change retry/idempotency behavior?
11. Does it change cache key or `Vary`?
12. Does it change OpenAPI?
13. Does it change generated clients?
14. Does it require deprecation header?
15. Does it require sunset date?
16. Is telemetry in place?
17. Are old clients tested?
18. Are docs and migration guide ready?
19. Are security fixes applied to all supported versions?
20. Is there a rollback plan?

---

## 53. Mental Model Summary

API versioning is not primarily about URL naming.

It is about managing compatibility boundaries.

A top-tier backend engineer thinks in layers:

```text
Business capability changes
        ↓
Domain semantics changes
        ↓
HTTP contract impact
        ↓
Compatibility classification
        ↓
Evolution strategy
        ↓
Versioning/deprecation/sunset if needed
        ↓
Telemetry + migration + governance
```

Most API changes should be additive and versionless.

Some changes should become new resources.

Some changes need explicit representation versioning.

Some changes need `/v2`.

The mistake is treating all changes the same.

---

## 54. Exercises

### Exercise 1 — Classify Changes

For each change, classify as breaking or non-breaking:

1. Add optional response field `priority`.
2. Add required request field `reasonCode`.
3. Change `status` from `CLOSED` meaning final to administrative.
4. Add enum value `ESCALATED_TO_COURT`.
5. Remove `ETag` header.
6. Change 201 response to 202 async response.
7. Add optional query parameter `region`.
8. Remove error code `CASE_ALREADY_CLOSED`.
9. Add `Deprecation` header.
10. Tighten validation from max 500 chars to max 200 chars.

### Exercise 2 — Design Migration

You have:

```http
POST /cases/{id}/close
```

Old behavior: closes case immediately.

New regulation requires:

```text
case must go through preliminary decision, appeal window, final closure
```

Design:

1. New resources/endpoints.
2. Compatibility policy for old endpoint.
3. Status codes.
4. Error responses.
5. Deprecation timeline.
6. Audit events.

### Exercise 3 — Spring Implementation

Implement v1 and v2 controllers that share same application service but expose different DTOs.

Requirements:

1. No duplicated business logic.
2. Stable error shape.
3. Deprecation header on v1.
4. `Vary` header if using header versioning.
5. Tests for old and new response shape.

---

## 55. Key Takeaways

1. API evolution is broader than versioning.
2. Breaking change includes semantic, behavioral, header, status, auth, error, and cache changes.
3. Additive evolution is usually better than creating a new version.
4. Silent semantic change is worse than explicit breaking change.
5. `/v2` is useful but expensive.
6. Header/media type versioning requires `Vary` correctness.
7. Deprecation and Sunset should be communicated at runtime and in docs.
8. OpenAPI diff helps, but cannot detect all semantic breakage.
9. Telemetry is required before sunset.
10. Workflow-heavy systems must distinguish API version, process version, policy version, and schema version.

---

## 56. References

- RFC 9110 — HTTP Semantics.
- RFC 9111 — HTTP Caching.
- RFC 8594 — The Sunset HTTP Header Field.
- RFC 9745 — The Deprecation HTTP Response Header Field.
- OpenAPI Specification 3.1.
- Spring Framework Reference — API Versioning.
- Spring Framework Reference — Web MVC request mapping.
- Microsoft REST/API guidelines and compatibility policies.
- OWASP API Security Top 10.

---

## 57. Status Seri

Kamu telah menyelesaikan:

```text
Part 025 — API Versioning and Evolution
```

Progress seri:

```text
025 / 032 selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 026 — Observability: Logs, Metrics, Traces, and HTTP Diagnostics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-024.md">⬅️ Part 024 — API Design Styles over HTTP</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-026.md">Part 026 — Observability: Logs, Metrics, Traces, and HTTP Diagnostics ➡️</a>
</div>
