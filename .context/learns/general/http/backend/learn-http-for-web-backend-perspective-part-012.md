# learn-http-for-web-backend-perspective-part-012.md

# Part 012 — Conditional Requests and Optimistic Concurrency

> Seri: `learn-http-for-web-backend-perspective`  
> Part: `012 / 032`  
> Perspektif: Backend / Java Software Engineer  
> Fokus: memakai mekanisme HTTP-native untuk cache revalidation, lost update prevention, optimistic concurrency, dan contract design yang aman untuk sistem production.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas **idempotency, retries, dan ilusi exactly-once**. Itu menjawab pertanyaan:

> “Bagaimana backend tetap benar ketika request yang sama dikirim ulang, response hilang, atau operasi sudah commit tapi client tidak tahu?”

Part ini membahas problem yang berbeda tetapi sangat dekat:

> “Bagaimana backend tetap benar ketika beberapa actor membaca resource yang sama, lalu mencoba mengubahnya berdasarkan versi lama?”

Itulah area **conditional requests** dan **optimistic concurrency control**.

Kalau Part 011 menjaga backend dari **duplicate operation**, Part 012 menjaga backend dari **stale update** dan **lost update**.

Contoh sederhana:

1. Alice membaca case `CASE-123`, status `UNDER_REVIEW`, version `7`.
2. Bob juga membaca case `CASE-123`, version `7`.
3. Bob menambahkan legal note. Resource menjadi version `8`.
4. Alice submit update berbasis version `7`.
5. Kalau server menerima update Alice begitu saja, perubahan Bob bisa tertimpa atau invariant domain bisa rusak.

Backend yang matang tidak menyelesaikan ini dengan “last write wins” secara default. Backend yang matang membuat client menyatakan:

> “Process update ini hanya kalau resource yang saya baca tadi masih sama dengan versi yang saya punya.”

Dalam HTTP, bentuk standarnya adalah:

```http
If-Match: "case-123-v7"
```

Kalau server melihat current ETag sudah berbeda, server menolak:

```http
HTTP/1.1 412 Precondition Failed
```

Ini bukan sekadar caching. Ini adalah concurrency contract.

---

## 1. Learning Goals

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. Membedakan **cache revalidation** dan **concurrency precondition**.
2. Menjelaskan fungsi `ETag`, `Last-Modified`, `If-Match`, `If-None-Match`, `If-Modified-Since`, dan `If-Unmodified-Since`.
3. Mendesain API update yang tidak rentan lost update.
4. Memetakan database optimistic locking seperti JPA `@Version` ke HTTP validator.
5. Memilih status code `200`, `204`, `304`, `409`, `412`, dan `428` dengan tepat.
6. Menentukan kapan memakai strong ETag vs weak ETag.
7. Mendesain error response untuk stale update yang bisa dipahami client.
8. Menghindari anti-pattern seperti `PUT` tanpa precondition pada resource kolaboratif.
9. Mengimplementasikan conditional update di Spring MVC/WebFlux.
10. Membuat test matrix untuk concurrency behavior.

---

## 2. Core Mental Model

Conditional request adalah request yang membawa syarat:

> “Server, lakukan request ini hanya jika kondisi tertentu tentang current representation/resource masih benar.”

Syarat itu biasanya berbasis validator.

Validator adalah metadata yang mewakili keadaan resource atau selected representation pada suatu waktu.

Dua validator utama:

1. `ETag`
2. `Last-Modified`

Header precondition utama:

1. `If-Match`
2. `If-None-Match`
3. `If-Modified-Since`
4. `If-Unmodified-Since`
5. `If-Range`

Untuk backend engineer, simplifikasinya:

| Use case | Header paling penting | Typical response |
|---|---:|---:|
| Cache revalidation | `If-None-Match` | `304 Not Modified` atau `200 OK` |
| Lost update prevention | `If-Match` | `2xx` atau `412 Precondition Failed` |
| Create only if absent | `If-None-Match: *` | `201 Created` atau `412 Precondition Failed` |
| Require client to include version | none / missing precondition | `428 Precondition Required` |
| Last-modified based fallback | `If-Unmodified-Since` | `2xx` atau `412` |
| Range download resume | `If-Range` | `206 Partial Content` atau full `200` |

Mental model terpenting:

> `ETag` adalah cara server memberi nama pada versi representasi/resource.  
> `If-Match` adalah cara client berkata: “Saya hanya mau update kalau versi server masih versi yang saya lihat.”  
> `412` adalah server berkata: “Syaratmu tidak lagi benar; saya tidak akan mengeksekusi update ini.”

---

## 3. Problem: Lost Update

### 3.1 Bentuk lost update

Lost update terjadi ketika dua update berbasis state lama saling menimpa tanpa sadar.

Contoh domain regulatory enforcement:

Current case:

```json
{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "assignedOfficer": "officer-a",
  "riskLevel": "MEDIUM",
  "legalNotes": [],
  "version": 7
}
```

Alice membaca version `7`. Bob membaca version `7`.

Bob update:

```json
{
  "legalNotes": ["Need additional evidence from respondent"],
  "version": 8
}
```

Alice update berdasarkan copy lama:

```json
{
  "assignedOfficer": "officer-c",
  "riskLevel": "HIGH",
  "legalNotes": [],
  "version": 8
}
```

Kalau server melakukan replace penuh tanpa precondition, `legalNotes` Bob hilang.

Ini tidak selalu terlihat sebagai error teknis. Request Alice bisa mendapat `200 OK`. Database bisa commit. Monitoring hijau. Tetapi domain state sudah rusak.

### 3.2 Kenapa last write wins berbahaya

Last write wins kadang valid untuk domain tertentu:

- user preference
- ephemeral draft
- last seen timestamp
- heartbeat
- analytics counter yang memang tolerant

Tapi default ini berbahaya untuk:

- regulatory cases
- approvals
- financial instructions
- legal notes
- account settings security-sensitive
- inventory reservation
- workflow transition
- policy decision
- entitlement
- compliance evidence

Last write wins mengubah concurrency problem menjadi silent data loss.

Top-tier backend engineer tidak bertanya:

> “Apakah update endpoint berhasil?”

Tapi bertanya:

> “Update ini berbasis state apa? Apakah state itu masih valid saat server memprosesnya?”

---

## 4. Conditional Requests: Vocabulary

### 4.1 Selected representation

HTTP membedakan resource dan representation.

Resource:

```text
/cases/CASE-123
```

Representation bisa berbeda tergantung:

- media type
- language
- encoding
- authorization
- projection
- version

Contoh:

```http
GET /cases/CASE-123 HTTP/1.1
Accept: application/json
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "case-123-v7-json-full"
```

ETag itu melekat pada selected representation, bukan sekadar row database. Namun dalam banyak JSON API, kita sengaja membuat ETag yang stabil sebagai representasi resource version.

### 4.2 Validator

Validator adalah nilai yang bisa dipakai client dan server untuk menentukan apakah representasi/resource masih sama.

Ada dua tipe validator:

1. Entity tag / ETag
2. Last modified timestamp

ETag biasanya lebih kuat karena tidak bergantung pada resolusi waktu.

Timestamp punya masalah:

- resolusi detik bisa terlalu kasar
- clock skew antar node
- update cepat dalam detik yang sama
- database timestamp precision mismatch
- timezone/serialization ambiguity

Karena itu, untuk optimistic concurrency production, ETag berbasis version biasanya lebih reliable.

### 4.3 Preconditions

Precondition adalah syarat yang dievaluasi server sebelum menjalankan method.

Contoh:

```http
PUT /cases/CASE-123 HTTP/1.1
If-Match: "case-123-v7"
Content-Type: application/json
```

Artinya:

> Process `PUT` hanya kalau current ETag resource cocok dengan `"case-123-v7"`.

Kalau tidak cocok:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
```

---

## 5. `ETag`

### 5.1 Apa itu ETag?

`ETag` adalah response header yang berisi entity-tag, yaitu opaque validator untuk selected representation.

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "case-123-v7"
```

Client tidak seharusnya mengandalkan struktur internal ETag. Bagi client, ETag adalah string opaque.

Baik:

```http
ETag: "a8f3b92c"
```

Juga baik:

```http
ETag: "case-123-v7"
```

Tapi client tidak boleh bergantung bahwa `v7` berarti version database. Server boleh mengubah format ETag selama contract HTTP tetap benar.

### 5.2 Strong ETag vs Weak ETag

Strong ETag:

```http
ETag: "abc123"
```

Weak ETag:

```http
ETag: W/"abc123"
```

Strong validator berarti dua representation dianggap byte-for-byte equivalent untuk tujuan strong comparison.

Weak validator berarti representation dianggap semantically equivalent, tetapi mungkin tidak byte-identical.

Contoh weak ETag cocok untuk:

- HTML yang punya timestamp render minor
- compressed/generated view
- representation yang semantically sama walau bytes berbeda
- cache revalidation kasar

Untuk optimistic concurrency update, gunakan **strong ETag** kecuali kamu benar-benar paham konsekuensinya.

Kenapa?

Karena `If-Match` untuk mencegah lost update membutuhkan keyakinan bahwa resource state yang dipakai client memang versi yang sama.

### 5.3 ETag dari database version

Jika entity punya version:

```java
@Entity
class CaseRecord {
    @Id
    private UUID id;

    @Version
    private long version;

    private String status;
    private String assignedOfficer;
    private Instant updatedAt;
}
```

ETag bisa dibuat:

```text
"case:5c0b...:v17"
```

Atau hash:

```text
"sha256-2f7e4a..."
```

Ada dua strategi umum:

#### Strategy A — Version-based ETag

```text
ETag = hash(resourceId + version + representationVariant)
```

Kelebihan:

- cepat
- stabil
- cocok untuk optimistic locking
- tidak perlu serialize seluruh response

Kekurangan:

- harus jelas apa yang membuat version berubah
- kalau response berubah karena computed field eksternal, ETag bisa salah

#### Strategy B — Representation hash ETag

```text
ETag = hash(serializedResponseBytes)
```

Kelebihan:

- akurat terhadap representation bytes
- bagus untuk cache validation

Kekurangan:

- mahal untuk response besar
- sensitive terhadap field ordering/formatting
- sulit dipakai sebelum update
- bisa berubah karena cosmetic serialization

Untuk backend business API, version-based ETag biasanya lebih practical untuk concurrency. Untuk static/content API, representation hash lebih natural.

### 5.4 ETag dan authorization

Jika representation berubah berdasarkan authorization, ETag harus dipikirkan hati-hati.

Misalnya officer A melihat:

```json
{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "internalNotes": [...]
}
```

External respondent melihat:

```json
{
  "id": "CASE-123",
  "status": "UNDER_REVIEW"
}
```

Apakah ETag sama?

Jawabannya tergantung tujuan.

Untuk cache validation representation-specific, ETag sebaiknya berbeda karena selected representation berbeda.

Untuk concurrency update, mungkin ETag ingin merepresentasikan underlying resource version, bukan projection.

Solusi umum:

1. Pakai ETag resource-version untuk endpoints update.
2. Pastikan cache header tidak membuat private representation masuk shared cache.
3. Tambahkan `Vary: Authorization` atau `Cache-Control: private/no-store` sesuai sensitivitas.
4. Jangan biarkan ETag membocorkan informasi seperti jumlah perubahan sensitif.

---

## 6. `If-Match`

### 6.1 Semantics

`If-Match` berarti:

> Process request hanya jika current validator cocok dengan salah satu ETag yang diberikan.

Contoh:

```http
PUT /cases/CASE-123 HTTP/1.1
If-Match: "case-123-v7"
Content-Type: application/json

{
  "assignedOfficer": "officer-c",
  "riskLevel": "HIGH"
}
```

Server flow:

1. Load current case.
2. Compute current ETag.
3. Compare dengan `If-Match`.
4. Jika cocok, process update.
5. Jika tidak cocok, reject `412 Precondition Failed`.

### 6.2 Multiple ETags

Header bisa berisi beberapa ETag:

```http
If-Match: "v7", "v8"
```

Artinya cocok jika current ETag salah satu dari daftar.

Dalam business API, biasanya client hanya mengirim satu ETag.

### 6.3 Wildcard

```http
If-Match: *
```

Artinya process hanya jika resource exists.

Use case:

```http
DELETE /cases/CASE-123 HTTP/1.1
If-Match: *
```

Ini memastikan delete hanya berjalan jika target ada, tetapi tidak mencegah lost update berbasis versi. Untuk concurrency strict, lebih baik pakai ETag spesifik.

### 6.4 `If-Match` untuk PATCH/PUT/DELETE

`If-Match` paling penting untuk method yang mengubah state:

- `PUT`
- `PATCH`
- `DELETE`
- command-style `POST` yang mengubah existing resource

Contoh cancel case:

```http
POST /cases/CASE-123/cancellation-requests HTTP/1.1
If-Match: "case-123-v9"
Content-Type: application/json
```

Server hanya menerima cancellation request jika case masih seperti versi yang client lihat.

---

## 7. `If-None-Match`

### 7.1 Cache revalidation

`If-None-Match` biasanya dipakai untuk cache revalidation.

Client sebelumnya menerima:

```http
HTTP/1.1 200 OK
ETag: "case-123-v7"
Cache-Control: private, max-age=60
```

Lalu client bertanya:

```http
GET /cases/CASE-123 HTTP/1.1
If-None-Match: "case-123-v7"
```

Jika current ETag masih sama:

```http
HTTP/1.1 304 Not Modified
ETag: "case-123-v7"
```

Tidak ada body. Client memakai cached representation.

Jika berubah:

```http
HTTP/1.1 200 OK
ETag: "case-123-v8"
Content-Type: application/json

{ ... new representation ... }
```

### 7.2 Create-if-absent

`If-None-Match: *` bisa dipakai untuk create only if resource does not exist.

Contoh client-generated id:

```http
PUT /cases/CASE-123 HTTP/1.1
If-None-Match: *
Content-Type: application/json

{
  "type": "MARKET_ABUSE_INVESTIGATION",
  "subjectId": "ORG-999"
}
```

Jika belum ada:

```http
HTTP/1.1 201 Created
Location: /cases/CASE-123
ETag: "case-123-v1"
```

Jika sudah ada:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
```

Ini berguna untuk:

- idempotent create dengan client-generated id
- preventing accidental overwrite
- distributed import/sync
- provisioning APIs

### 7.3 Jangan salah pakai `If-None-Match` untuk update

Untuk lost update prevention pada update existing resource, default-nya pakai `If-Match`, bukan `If-None-Match`.

Rule praktis:

```text
GET cache validation       -> If-None-Match
Update existing resource   -> If-Match
Create only if absent      -> If-None-Match: *
```

---

## 8. `Last-Modified` and Date-Based Preconditions

### 8.1 `Last-Modified`

Response:

```http
HTTP/1.1 200 OK
Last-Modified: Tue, 16 Jun 2026 10:15:30 GMT
```

Client bisa revalidate:

```http
GET /cases/CASE-123 HTTP/1.1
If-Modified-Since: Tue, 16 Jun 2026 10:15:30 GMT
```

Jika tidak berubah:

```http
HTTP/1.1 304 Not Modified
```

### 8.2 `If-Unmodified-Since`

Untuk update:

```http
PATCH /cases/CASE-123 HTTP/1.1
If-Unmodified-Since: Tue, 16 Jun 2026 10:15:30 GMT
Content-Type: application/merge-patch+json
```

Artinya:

> Process update hanya jika resource belum berubah sejak timestamp itu.

Jika berubah:

```http
HTTP/1.1 412 Precondition Failed
```

### 8.3 Masalah timestamp

Timestamp-based concurrency punya risiko:

1. Dua update terjadi dalam resolusi waktu yang sama.
2. Database menyimpan precision microsecond, HTTP date biasanya second precision.
3. Clock antar service/node berbeda.
4. Timestamp bisa berubah karena metadata update yang tidak relevan.
5. Timezone conversion bug.

Karena itu:

> Untuk concurrency correctness, ETag/version biasanya lebih baik daripada `Last-Modified`.

`Last-Modified` tetap berguna untuk cache revalidation dan compatibility.

---

## 9. Status Codes

### 9.1 `304 Not Modified`

Digunakan untuk conditional GET/HEAD ketika representation belum berubah.

Response `304`:

- tidak punya response body
- memberi tahu client memakai cached body
- sebaiknya menyertakan relevant headers seperti `ETag`, `Cache-Control`, `Date`, `Vary` sesuai kebutuhan

Contoh:

```http
GET /cases/CASE-123 HTTP/1.1
If-None-Match: "case-123-v7"
```

Response:

```http
HTTP/1.1 304 Not Modified
ETag: "case-123-v7"
Cache-Control: private, max-age=60
Vary: Accept, Authorization
```

### 9.2 `412 Precondition Failed`

Digunakan ketika precondition request tidak terpenuhi.

Contoh:

```http
PATCH /cases/CASE-123 HTTP/1.1
If-Match: "case-123-v7"
```

Tetapi current ETag adalah `"case-123-v8"`.

Response:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
ETag: "case-123-v8"

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "detail": "The case has changed since the version used by this request.",
  "instance": "/cases/CASE-123",
  "currentEtag": "\"case-123-v8\"",
  "code": "RESOURCE_VERSION_MISMATCH"
}
```

Apakah boleh mengirim current ETag dalam error body/header?

Biasanya iya untuk authorized client, tapi perhatikan:

- jangan membocorkan existence resource kepada unauthorized caller
- jangan membocorkan sensitive version cadence
- pastikan error path melewati authorization check yang benar

### 9.3 `428 Precondition Required`

`428 Precondition Required` berguna ketika server mewajibkan conditional request, tetapi client tidak mengirim precondition.

Contoh:

```http
PATCH /cases/CASE-123 HTTP/1.1
Content-Type: application/merge-patch+json

{
  "riskLevel": "HIGH"
}
```

Response:

```http
HTTP/1.1 428 Precondition Required
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-required",
  "title": "Precondition required",
  "status": 428,
  "detail": "This operation requires If-Match to prevent lost updates.",
  "requiredHeaders": ["If-Match"],
  "code": "IF_MATCH_REQUIRED"
}
```

Kapan pakai `428`?

- collaborative mutable resource
- resource punya expensive/regulated consequence
- update/replace/delete harus berbasis version
- API ingin mencegah client lama melakukan unsafe write

### 9.4 `409 Conflict` vs `412 Precondition Failed`

Ini sering membingungkan.

Rule praktis:

| Situation | Better status |
|---|---:|
| Client mengirim `If-Match`, tetapi ETag tidak cocok | `412` |
| Client tidak mengirim required precondition | `428` |
| Request valid secara HTTP, tapi konflik domain state | `409` |
| Transition tidak valid karena status domain berubah | biasanya `409`, kadang `412` jika berbasis precondition |
| Unique constraint conflict saat create | `409` |

Contoh `412`:

```text
You said: update only if version = 7. Current version = 8.
```

Contoh `409`:

```text
You requested: approve case. Current state is CLOSED, and CLOSED cases cannot be approved.
```

Keduanya bisa terjadi bersama. Backend harus menentukan lapisan mana yang gagal lebih dulu.

Recommended evaluation order:

1. Authenticate.
2. Authorize enough to know caller may access resource.
3. Validate syntax and media type.
4. Load resource.
5. Evaluate HTTP preconditions.
6. Validate domain transition.
7. Persist update.

Jika `If-Match` gagal, return `412` sebelum domain transition.

---

## 10. End-to-End Flow: Read-Modify-Write

### 10.1 Initial read

```http
GET /cases/CASE-123 HTTP/1.1
Accept: application/json
Authorization: Bearer eyJ...
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "case-123-v7"
Cache-Control: private, no-cache

{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "riskLevel": "MEDIUM",
  "assignedOfficer": "officer-a",
  "links": {
    "self": "/cases/CASE-123",
    "update": "/cases/CASE-123"
  }
}
```

`Cache-Control: private, no-cache` berarti response boleh disimpan oleh private cache, tetapi harus revalidate sebelum dipakai ulang. Untuk regulatory data yang lebih sensitif, `no-store` mungkin lebih tepat.

### 10.2 Update with `If-Match`

```http
PATCH /cases/CASE-123 HTTP/1.1
Content-Type: application/merge-patch+json
If-Match: "case-123-v7"
Authorization: Bearer eyJ...

{
  "riskLevel": "HIGH"
}
```

Success:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "case-123-v8"

{
  "id": "CASE-123",
  "status": "UNDER_REVIEW",
  "riskLevel": "HIGH",
  "assignedOfficer": "officer-a"
}
```

Atau:

```http
HTTP/1.1 204 No Content
ETag: "case-123-v8"
```

### 10.3 Stale update

Kalau current sudah `v8`:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
ETag: "case-123-v8"

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "detail": "The case has changed since it was last read. Re-read the case and retry with the latest ETag.",
  "code": "RESOURCE_VERSION_MISMATCH"
}
```

Client behavior:

1. Re-read resource.
2. Show conflict or merge UI if human-driven.
3. Recompute intended change against latest state.
4. Retry with latest ETag.

Backend should not auto-merge unless domain explicitly supports it.

---

## 11. PUT, PATCH, DELETE and Preconditions

### 11.1 PUT replace

`PUT` is replace semantics. It is most vulnerable to lost update if used without precondition.

Bad:

```http
PUT /cases/CASE-123 HTTP/1.1
Content-Type: application/json

{ ... full representation from stale UI ... }
```

Better:

```http
PUT /cases/CASE-123 HTTP/1.1
Content-Type: application/json
If-Match: "case-123-v7"

{ ... full replacement ... }
```

If no `If-Match`, return `428` for sensitive resources.

### 11.2 PATCH partial update

`PATCH` can reduce accidental overwrite because client sends only changed fields. But it does not eliminate concurrency problems.

Example conflict:

- Alice sets risk `HIGH` because evidence count is 3.
- Bob removes invalid evidence, evidence count becomes 2.
- Alice's `PATCH { "riskLevel": "HIGH" }` may be stale semantically.

So `PATCH` still needs `If-Match` for domain correctness.

### 11.3 DELETE

Delete also needs concurrency control when delete means:

- cancel workflow
- close case
- remove evidence
- revoke permission
- archive record

Example:

```http
DELETE /cases/CASE-123/evidence/EV-9 HTTP/1.1
If-Match: "evidence-EV-9-v3"
```

If evidence was already used in a legal review, domain may reject with `409`. If ETag mismatch, reject with `412`.

---

## 12. Mapping ETag to Database Optimistic Locking

### 12.1 JPA `@Version`

JPA optimistic locking uses a version column.

Example:

```java
@Entity
@Table(name = "cases")
public class CaseEntity {
    @Id
    private UUID id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    private String riskLevel;
    private String assignedOfficer;

    // getters/setters
}
```

When transaction commits, JPA checks version. If another transaction updated the row first, commit fails with optimistic lock exception.

HTTP ETag can expose this concurrency mechanism as API contract:

```java
String etag = "\"case:" + caseId + ":v" + entity.getVersion() + "\"";
```

But do not make clients parse it.

### 12.2 Application flow

Naive flow:

```text
1. Parse request.
2. Load entity.
3. Apply changes.
4. Commit.
```

Better flow:

```text
1. Parse request.
2. Require If-Match for write.
3. Load entity.
4. Compute current ETag from entity version.
5. Compare If-Match.
6. If mismatch: return 412.
7. Apply changes.
8. Domain validation.
9. Commit.
10. Return new ETag.
```

Still keep DB optimistic lock.

Why?

Because two requests with the same matching `If-Match` can pass step 5 concurrently.

Example:

- Request A and B both send `If-Match: v7`.
- Both load v7 before either commits.
- Both pass HTTP precondition.
- A commits to v8.
- B must fail at DB optimistic lock.

Then B should map DB optimistic lock failure to either:

- `412 Precondition Failed` if request had stale `If-Match`
- `409 Conflict` if conflict is domain-level and not strictly precondition mismatch

For this scenario, `412` is usually appropriate because the write precondition no longer holds.

### 12.3 Atomic update alternative

Instead of load-then-update, use conditional SQL:

```sql
UPDATE cases
SET risk_level = ?, version = version + 1
WHERE id = ? AND version = ?;
```

If affected rows = 0:

- resource missing -> `404`
- version mismatch -> `412`

But distinguishing missing vs mismatch requires careful handling.

Typical flow:

```text
1. Decode expected version from ETag or lookup ETag mapping.
2. Execute conditional update.
3. If affected rows = 1, success.
4. If 0, check existence/authorization carefully.
```

Caution:

- Do not reveal resource existence to unauthorized callers.
- Keep audit trail for rejected stale writes if domain requires.

---

## 13. Should ETag Expose Database Version?

### 13.1 Plain version ETag

```http
ETag: "7"
```

Simple, but can leak update cadence and internal implementation.

### 13.2 Resource-scoped version ETag

```http
ETag: "case-123-v7"
```

Readable, useful in debugging, but still exposes version.

### 13.3 Signed/opaque ETag

```http
ETag: "B3N9s8x2fQ-Z"
```

Can encode:

```json
{
  "resourceType": "case",
  "id": "CASE-123",
  "version": 7,
  "variant": "json-full"
}
```

Then sign/HMAC/base64url.

Pros:

- client cannot forge easily
- server can validate without DB in some cases
- less leakage

Cons:

- key rotation complexity
- longer header
- harder debugging
- must still load current state for authorization/domain

### 13.4 Hash-based opaque ETag

```text
ETag = base64url(HMAC(secret, resourceId + ":" + version + ":" + variant))
```

Server may still need mapping to version. If server cannot decode, it just compares current generated ETag to supplied ETag.

Good general pattern:

```java
String etag = '"' + base64url(hmac(secret, resourceType + ":" + id + ":" + version + ":" + representationVariant)) + '"';
```

---

## 14. ETag Granularity

### 14.1 Whole-resource ETag

One version for entire resource.

Pros:

- simple
- safe
- easy to reason about

Cons:

- more false conflicts
- two independent fields cannot be updated concurrently

Example:

- Alice updates `assignedOfficer`.
- Bob updates `riskLevel`.
- Whole-resource ETag causes one to fail if both started from same version.

This is often acceptable in regulated systems because explicit conflict handling is safer than silent merge.

### 14.2 Field-level ETag

Different version per field/section.

Pros:

- fewer conflicts
- supports collaborative editing

Cons:

- much more complex
- hard to expose cleanly in HTTP
- domain invariants often cross fields

### 14.3 Sub-resource ETag

Model independent mutable areas as sub-resources:

```text
/cases/CASE-123/assignment
/cases/CASE-123/risk-assessment
/cases/CASE-123/legal-notes
/cases/CASE-123/evidence/EV-9
```

Each has its own ETag.

This is often better than field-level versioning inside one huge resource.

### 14.4 Aggregate root ETag

For domain-driven systems, use aggregate root version.

If any invariant-relevant child changes, aggregate version changes.

Example:

- evidence added
- risk assessment recalculated
- case status changed
- reviewer assigned

All increment case version if they affect decisions.

This prevents stale workflow commands.

---

## 15. Conditional Requests and Domain State Machines

In workflow-heavy systems, not all conflicts are stale representation conflicts.

Example transitions:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> DECISION_PENDING -> CLOSED
```

Client reads:

```json
{
  "status": "UNDER_REVIEW",
  "version": 12,
  "allowedActions": ["request-more-info", "recommend-decision"]
}
```

Client calls:

```http
POST /cases/CASE-123/recommendations HTTP/1.1
If-Match: "case-123-v12"
```

If current is now version 13 because someone changed legal note, should recommendation fail?

Maybe.

If legal note affects decision basis, yes.

If current is now status `CLOSED`, definitely fail.

There are two possible failures:

1. Version mismatch: `412`
2. Domain transition invalid: `409`

Recommended pattern:

- Use `If-Match` to ensure command is based on current aggregate version.
- Use domain validation to ensure transition is legal.
- Return `412` when precondition fails.
- Return `409` when precondition passes but domain state rejects command.

This keeps layers clean.

---

## 16. Conditional GET and Caching

Although this part focuses on concurrency, conditional requests are also central to caching.

### 16.1 Basic conditional GET

```http
GET /reference-data/violation-types HTTP/1.1
If-None-Match: "violation-types-v42"
```

If unchanged:

```http
HTTP/1.1 304 Not Modified
ETag: "violation-types-v42"
Cache-Control: public, max-age=300
```

If changed:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "violation-types-v43"
Cache-Control: public, max-age=300

[ ... ]
```

### 16.2 `Vary`

If representation varies by `Accept-Language`:

```http
Vary: Accept-Language
```

If varies by authorization:

```http
Cache-Control: private
Vary: Authorization
```

Be careful: many shared caches avoid caching authenticated responses unless explicit directives allow it. For sensitive APIs, prefer conservative cache policy.

### 16.3 Weak ETag for cache

Weak ETag may be acceptable for cache revalidation:

```http
ETag: W/"violation-types-semantic-v42"
```

But do not reuse weak ETag for write concurrency unless you have a very deliberate design.

---

## 17. Conditional Create Patterns

### 17.1 Client-generated ID with `If-None-Match: *`

Request:

```http
PUT /external-reports/RPT-2026-0001 HTTP/1.1
If-None-Match: *
Content-Type: application/json
```

If resource absent:

```http
HTTP/1.1 201 Created
Location: /external-reports/RPT-2026-0001
ETag: "report-RPT-2026-0001-v1"
```

If already exists:

```http
HTTP/1.1 412 Precondition Failed
```

This is clean when client owns ID generation or import key.

### 17.2 Server-generated ID with idempotency key

For `POST /cases`, ETag precondition cannot identify resource unless request maps to deterministic key.

Use idempotency key instead:

```http
POST /cases HTTP/1.1
Idempotency-Key: 2f47d8...
Content-Type: application/json
```

That is Part 011 territory.

Rule:

```text
PUT known URI + create if absent      -> If-None-Match: *
POST collection + server-generated ID -> Idempotency-Key
```

---

## 18. Conditional DELETE and Tombstones

DELETE semantics vary.

Physical delete:

```http
DELETE /drafts/D-123 HTTP/1.1
If-Match: "draft-D-123-v4"
```

Soft delete/archive:

```http
DELETE /cases/CASE-123 HTTP/1.1
If-Match: "case-123-v15"
```

Response:

```http
HTTP/1.1 204 No Content
ETag: "case-123-v16"
```

But if resource is now deleted, what happens to ETag?

Options:

1. Return `404 Not Found` on subsequent GET.
2. Return `410 Gone` for known deleted resources.
3. Return tombstone representation with ETag.

For regulated systems, tombstone can be useful:

```http
GET /cases/CASE-123 HTTP/1.1
```

```http
HTTP/1.1 410 Gone
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/resource-gone",
  "title": "Resource gone",
  "status": 410,
  "detail": "The case has been archived and is no longer available through this endpoint."
}
```

For privacy/security, avoid revealing tombstone unless caller is authorized.

---

## 19. Conditional Requests Through Proxies and Gateways

Backend often sits behind:

- CDN
- reverse proxy
- API gateway
- service mesh
- load balancer

Implications:

### 19.1 Do not let gateway strip conditional headers

Gateway must forward:

- `If-Match`
- `If-None-Match`
- `If-Modified-Since`
- `If-Unmodified-Since`
- `If-Range`
- `ETag`
- `Last-Modified`
- `Cache-Control`
- `Vary`

### 19.2 Gateway-generated ETag can be dangerous

Some proxies can generate ETag for static/compressed responses. For dynamic business APIs, this can be wrong if:

- ETag reflects compressed bytes, not domain version
- ETag varies by gateway behavior
- backend expects ETag for concurrency but gateway rewrites it

Recommendation:

- For business mutation endpoints, app should own ETag semantics.
- Disable proxy ETag rewriting for API responses unless deliberately configured.

### 19.3 Compression and ETag

Representation bytes can differ between gzip and br encodings.

If ETag is strong and byte-specific, compression variant matters.

Typical safe approach:

- Let ETag represent unencoded representation and use `Vary: Accept-Encoding` where appropriate, or
- Use weak ETag for semantically equivalent compressed variants, or
- Configure proxy consistently.

For backend business concurrency, do not base concurrency ETag on compressed wire bytes.

---

## 20. Java/Spring MVC Implementation Sketch

### 20.1 Response with ETag

```java
@RestController
@RequestMapping("/cases")
public class CaseController {

    private final CaseService caseService;
    private final ETagService etagService;

    public CaseController(CaseService caseService, ETagService etagService) {
        this.caseService = caseService;
        this.etagService = etagService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<CaseResponse> getCase(@PathVariable UUID id) {
        CaseView view = caseService.getAuthorizedCase(id);
        String etag = etagService.caseEtag(view.id(), view.version(), "json-full");

        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.noCache().cachePrivate())
                .body(CaseResponse.from(view));
    }
}
```

Important detail:

Spring `ResponseEntity.eTag(...)` expects an ETag value. Be consistent with quoting. In Spring, `.eTag("\"abc\"")` is commonly used for exact quoted value. Some versions may quote if missing; verify behavior in your stack and test actual response.

### 20.2 Update with `If-Match`

```java
@PatchMapping(
    path = "/{id}",
    consumes = "application/merge-patch+json",
    produces = "application/json"
)
public ResponseEntity<CaseResponse> patchCase(
        @PathVariable UUID id,
        @RequestHeader(value = "If-Match", required = false) String ifMatch,
        @RequestBody CasePatchRequest request
) {
    if (ifMatch == null || ifMatch.isBlank()) {
        throw new PreconditionRequiredException("If-Match is required for this operation");
    }

    CaseView current = caseService.getAuthorizedCase(id);
    String currentEtag = etagService.caseEtag(current.id(), current.version(), "json-full");

    if (!etagService.matches(ifMatch, currentEtag)) {
        throw new PreconditionFailedException(currentEtag);
    }

    CaseView updated = caseService.patchCase(id, request, current.version());
    String newEtag = etagService.caseEtag(updated.id(), updated.version(), "json-full");

    return ResponseEntity.ok()
            .eTag(newEtag)
            .body(CaseResponse.from(updated));
}
```

This is conceptually good but still needs DB optimistic locking in `caseService.patchCase`.

### 20.3 Exception mapping

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(PreconditionRequiredException.class)
    ResponseEntity<ProblemDetail> handlePreconditionRequired(PreconditionRequiredException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.PRECONDITION_REQUIRED);
        problem.setTitle("Precondition required");
        problem.setDetail("This operation requires If-Match to prevent lost updates.");
        problem.setProperty("code", "IF_MATCH_REQUIRED");
        problem.setProperty("requiredHeaders", List.of("If-Match"));
        return ResponseEntity.status(HttpStatus.PRECONDITION_REQUIRED).body(problem);
    }

    @ExceptionHandler(PreconditionFailedException.class)
    ResponseEntity<ProblemDetail> handlePreconditionFailed(PreconditionFailedException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.PRECONDITION_FAILED);
        problem.setTitle("Precondition failed");
        problem.setDetail("The resource has changed since the version used by this request.");
        problem.setProperty("code", "RESOURCE_VERSION_MISMATCH");

        return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED)
                .eTag(ex.currentEtag())
                .body(problem);
    }
}
```

### 20.4 ETag matching service

```java
@Component
public class ETagService {

    public String caseEtag(UUID caseId, long version, String variant) {
        String raw = "case:" + caseId + ":v" + version + ":" + variant;
        String hash = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(MessageDigestHolder.sha256(raw));
        return "\"" + hash + "\"";
    }

    public boolean matches(String ifMatchHeader, String currentEtag) {
        if (ifMatchHeader == null) {
            return false;
        }
        if (ifMatchHeader.trim().equals("*")) {
            return true;
        }
        return Arrays.stream(ifMatchHeader.split(","))
                .map(String::trim)
                .anyMatch(candidate -> candidate.equals(currentEtag));
    }
}
```

Production version needs robust ETag parser. Naive comma split can break if grammar edge cases appear, though common ETag values are simple. Prefer tested library or controlled format.

---

## 21. WebFlux Considerations

WebFlux changes execution model, not HTTP semantics.

Conceptual flow remains:

```text
Read If-Match -> load current resource -> compare ETag -> apply update -> return new ETag
```

Example sketch:

```java
@PatchMapping("/{id}")
public Mono<ResponseEntity<CaseResponse>> patchCase(
        @PathVariable UUID id,
        @RequestHeader(value = "If-Match", required = false) String ifMatch,
        @RequestBody Mono<CasePatchRequest> body
) {
    if (ifMatch == null || ifMatch.isBlank()) {
        return Mono.error(new PreconditionRequiredException("If-Match is required"));
    }

    return Mono.zip(caseService.getAuthorizedCase(id), body)
            .flatMap(tuple -> {
                CaseView current = tuple.getT1();
                CasePatchRequest patch = tuple.getT2();
                String currentEtag = etagService.caseEtag(current.id(), current.version(), "json-full");

                if (!etagService.matches(ifMatch, currentEtag)) {
                    return Mono.error(new PreconditionFailedException(currentEtag));
                }

                return caseService.patchCase(id, patch, current.version());
            })
            .map(updated -> ResponseEntity.ok()
                    .eTag(etagService.caseEtag(updated.id(), updated.version(), "json-full"))
                    .body(CaseResponse.from(updated)));
}
```

Be careful with:

- duplicate subscription
- blocking database call on event loop
- body consumption before authorization when body is huge
- optimistic lock errors emitted asynchronously
- context propagation for correlation id

---

## 22. Security Considerations

### 22.1 Existence leakage

Suppose unauthorized user sends:

```http
PATCH /cases/SECRET-CASE HTTP/1.1
If-Match: "wrong"
```

Do not return:

```http
412 Precondition Failed
ETag: "secret-current-version"
```

That leaks resource existence and version.

Evaluation order must enforce security:

1. Authenticate.
2. Determine whether caller is allowed to know/access target resource.
3. If not allowed, return `404` or `403` according to API policy.
4. Only then evaluate and disclose precondition details.

### 22.2 ETag tracking/privacy

ETag can be abused as tracking token in browser contexts if uniquely assigned per user and cached. For backend APIs with authenticated clients, risk differs but still think about:

- shared devices
- shared caches
- user-specific representation
- private data

For sensitive personalized responses:

```http
Cache-Control: no-store
```

or at least:

```http
Cache-Control: private, no-cache
Vary: Authorization
```

### 22.3 Forged ETags

If ETag is just `"v7"`, client can guess future/past versions. Does that matter?

Usually server compares to current version, so forging does not bypass concurrency. But opaque/signed ETag can reduce leakage and prevent weird cross-resource misuse.

Never trust ETag as authorization proof.

ETag says something about version, not identity or permission.

---

## 23. Observability

Track conditional request behavior.

Useful metrics:

```text
http.server.requests{method="PATCH",status="412"}
http.precondition.failed.count
http.precondition.required.count
http.conditional_get.not_modified.count
http.etag.mismatch.count
http.optimistic_lock.failure.count
```

Useful log fields:

```json
{
  "event": "http_precondition_failed",
  "resourceType": "case",
  "resourceId": "CASE-123",
  "method": "PATCH",
  "path": "/cases/CASE-123",
  "requestEtag": "\"...\"",
  "currentEtag": "\"...\"",
  "actorId": "user-789",
  "tenantId": "tenant-a",
  "correlationId": "req-abc"
}
```

Be careful logging raw ETags if they encode sensitive data. Prefer opaque or hashed values.

High `412` rate may mean:

- clients use stale UI
- polling interval too long
- too coarse ETag granularity
- collaborative editing needs merge model
- workflow state changes too frequently
- missing real-time notification

High `428` rate may mean:

- old clients not updated
- API documentation incomplete
- SDK missing ETag propagation
- gateway stripping headers

---

## 24. Testing Strategy

### 24.1 Basic tests

GET returns ETag:

```text
Given case exists
When GET /cases/{id}
Then response has ETag
```

PATCH without If-Match:

```text
Given case requires concurrency protection
When PATCH /cases/{id} without If-Match
Then response is 428
```

PATCH with correct If-Match:

```text
Given current ETag is v7
When PATCH with If-Match v7
Then response is 200/204
And response has new ETag v8
```

PATCH with stale If-Match:

```text
Given current ETag is v8
When PATCH with If-Match v7
Then response is 412
And resource is unchanged
```

Conditional GET:

```text
Given current ETag is v8
When GET with If-None-Match v8
Then response is 304
And response has no body
```

### 24.2 Race test

Simulate two concurrent writes:

```text
Given current version is 7
And two clients both have ETag v7
When both PATCH concurrently with If-Match v7
Then exactly one succeeds
And the other fails with 412 or mapped optimistic lock failure
And final state preserves invariant
```

### 24.3 Authorization test

```text
Given user cannot access case
When PATCH with wrong If-Match
Then response does not reveal current ETag
```

### 24.4 Proxy test

```text
Given request passes through gateway
When client sends If-Match
Then application receives exact header
```

### 24.5 Contract test

SDK/client must:

1. Store ETag from GET.
2. Send ETag on write.
3. Handle 412 by re-read/merge/retry.
4. Handle 428 as client bug or required refresh.

---

## 25. Anti-Patterns

### Anti-pattern 1 — `PUT` without `If-Match`

```http
PUT /cases/CASE-123
```

For mutable collaborative resources, this is silent data loss waiting to happen.

### Anti-pattern 2 — Version field in body only

```json
{
  "id": "CASE-123",
  "version": 7,
  "riskLevel": "HIGH"
}
```

This can work internally, but HTTP already has a standard precondition mechanism. Body version also creates ambiguity:

- is version a domain field?
- is it required for all update representations?
- does proxy/gateway understand it?
- does error mapping become custom?

Better:

```http
If-Match: "case-123-v7"
```

Body version may still exist for display, but write precondition should be header-based if you want HTTP-native semantics.

### Anti-pattern 3 — Returning `409` for every stale update

`409` is not always wrong, but if the client sent `If-Match` and it failed, `412` is more precise.

### Anti-pattern 4 — Weak ETag for write concurrency

```http
ETag: W/"case-123-v7"
```

Then using it with update preconditions invites ambiguous semantics.

### Anti-pattern 5 — ETag changes on unrelated serialization details

If ETag changes because JSON property order changed, clients see false conflicts.

### Anti-pattern 6 — ETag does not change when meaningful state changes

If ETag misses domain-relevant changes, stale update can pass.

### Anti-pattern 7 — Gateway rewrites ETag

Backend emits resource-version ETag, gateway replaces with compressed-body hash. Mutation preconditions break.

### Anti-pattern 8 — Returning current ETag to unauthorized callers

Precondition errors must not bypass authorization policy.

### Anti-pattern 9 — Assuming PATCH removes concurrency risk

Partial update can still be semantically stale.

### Anti-pattern 10 — Only relying on HTTP check, no DB optimistic lock

Concurrent requests can both pass HTTP precondition before either commits. Database-level protection is still needed.

---

## 26. Design Decision Framework

When designing a mutable endpoint, answer these questions:

### 26.1 Is the resource collaborative or safety-critical?

If yes, require `If-Match`.

Examples requiring `If-Match`:

- case update
- evidence update
- approval/rejection decision
- entitlement update
- financial instruction
- legal note update
- policy configuration

Examples maybe not requiring:

- user last seen
- telemetry write
- append-only event ingestion with idempotency key
- non-critical preference update

### 26.2 What is the version scope?

Choose one:

- whole resource
- sub-resource
- aggregate root
- field group
- representation variant

Default to aggregate/resource version for correctness.

### 26.3 What status if header missing?

If precondition required:

```http
428 Precondition Required
```

### 26.4 What status if stale?

If supplied precondition fails:

```http
412 Precondition Failed
```

### 26.5 What status if domain conflict?

If current state cannot perform operation even after precondition passes:

```http
409 Conflict
```

### 26.6 What should success return?

Options:

- `200 OK` with updated representation and new ETag
- `204 No Content` with new ETag
- `202 Accepted` if async command accepted, with operation resource ETag if relevant

For human/workflow APIs, `200` with updated representation is often useful.

For high-throughput APIs, `204` can be fine.

---

## 27. Case Study: Regulatory Case Update

### 27.1 Requirements

A regulatory enforcement platform has case records. Officers can:

- update risk level
- assign reviewer
- add evidence
- recommend enforcement action
- close case

Constraints:

1. No lost updates.
2. All changes audited.
3. Some fields visible only to internal users.
4. External respondents can see limited representation.
5. Workflow transitions must be valid.
6. Multi-node deployment.
7. API behind gateway.

### 27.2 Resource model

```text
/cases/{caseId}
/cases/{caseId}/assignment
/cases/{caseId}/risk-assessment
/cases/{caseId}/evidence/{evidenceId}
/cases/{caseId}/recommendations
/cases/{caseId}/closure-requests
```

### 27.3 ETag policy

- `/cases/{caseId}` uses aggregate case version.
- `/cases/{caseId}/evidence/{evidenceId}` uses evidence version and case aggregate version if evidence affects case decision.
- External representation has separate representation ETag for GET caching but write commands require case aggregate ETag.

### 27.4 Read

```http
GET /cases/CASE-123 HTTP/1.1
Accept: application/json
```

```http
HTTP/1.1 200 OK
ETag: "case-123-v17"
Cache-Control: private, no-cache
Vary: Authorization, Accept
```

### 27.5 Update risk

```http
PATCH /cases/CASE-123/risk-assessment HTTP/1.1
If-Match: "case-123-v17"
Content-Type: application/merge-patch+json

{
  "riskLevel": "HIGH",
  "reason": "New evidence indicates repeated violation"
}
```

Success:

```http
HTTP/1.1 200 OK
ETag: "case-123-v18"
Content-Type: application/json

{
  "caseId": "CASE-123",
  "riskLevel": "HIGH",
  "updatedAt": "2026-06-18T08:12:40Z"
}
```

### 27.6 Stale update

```http
HTTP/1.1 412 Precondition Failed
ETag: "case-123-v18"
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "detail": "The case changed after the version used by this request.",
  "code": "CASE_VERSION_MISMATCH",
  "recovery": "Re-read the case, re-evaluate the intended change, then retry with the latest ETag."
}
```

### 27.7 Domain conflict

If case is already closed:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "Risk assessment cannot be changed after the case is closed.",
  "code": "CASE_ALREADY_CLOSED",
  "currentState": "CLOSED"
}
```

---

## 28. Checklist: Production-Grade Conditional Write

For every mutable resource endpoint:

```text
[ ] Does GET return ETag?
[ ] Is ETag strong if used for write concurrency?
[ ] Is ETag opaque to clients?
[ ] Does update require If-Match when lost update matters?
[ ] Does missing If-Match return 428?
[ ] Does stale If-Match return 412?
[ ] Does success return new ETag?
[ ] Is DB optimistic locking still enforced?
[ ] Are concurrent same-ETag updates tested?
[ ] Is authorization checked before disclosing current ETag?
[ ] Does gateway preserve conditional headers?
[ ] Does cache policy match data sensitivity?
[ ] Are weak and strong ETags used deliberately?
[ ] Are domain conflicts separated from precondition failures?
[ ] Are 412/428 metrics monitored?
[ ] Do SDKs propagate ETag automatically?
[ ] Do docs explain recovery flow?
```

---

## 29. Exercises

### Exercise 1 — Lost update analysis

Given endpoint:

```http
PUT /cases/{id}
Content-Type: application/json
```

It accepts full replacement and has no `If-Match` requirement.

Analyze:

1. What lost update scenarios can happen?
2. Which fields are most dangerous?
3. What status should missing precondition return?
4. What should success response include?
5. How would you migrate existing clients?

### Exercise 2 — Status code choice

For each scenario, choose `304`, `409`, `412`, or `428`:

1. Client sends `GET` with current `If-None-Match`.
2. Client sends `PATCH` without `If-Match`, but endpoint requires it.
3. Client sends `PATCH` with stale `If-Match`.
4. Client sends `approve` command with correct ETag, but case is closed.
5. Client tries create with `If-None-Match: *`, but resource already exists.

### Exercise 3 — ETag granularity

Design ETag policy for:

```text
/cases/{id}
/cases/{id}/evidence/{evidenceId}
/cases/{id}/comments/{commentId}
/cases/{id}/assignment
```

Decide:

1. Whole aggregate ETag or sub-resource ETag?
2. Which updates increment case aggregate version?
3. Which updates can be independent?
4. Which endpoints require `If-Match`?

### Exercise 4 — Spring implementation

Implement:

1. `GET /cases/{id}` returns ETag.
2. `PATCH /cases/{id}` requires `If-Match`.
3. Missing `If-Match` returns `428` Problem Details.
4. Stale `If-Match` returns `412` Problem Details.
5. Concurrent updates cannot both succeed.

### Exercise 5 — Gateway verification

Write an integration test or environment checklist proving:

1. Gateway forwards `If-Match`.
2. Gateway forwards `ETag` response.
3. Gateway does not rewrite ETag.
4. Gateway does not cache private case response.
5. Gateway logs correlation id for `412` responses.

---

## 30. Key Takeaways

1. Conditional requests turn stale-state assumptions into explicit HTTP preconditions.
2. `ETag` is the primary validator for modern backend concurrency control.
3. `If-Match` is the main tool for lost update prevention.
4. `If-None-Match` is mainly for cache revalidation and create-if-absent.
5. `304` means cached representation is still valid.
6. `412` means supplied precondition failed.
7. `428` means precondition was required but missing.
8. `409` is for domain conflict, not generic stale ETag mismatch.
9. Strong ETag is preferred for write concurrency.
10. Database optimistic locking is still required; HTTP preconditions do not remove race conditions inside the server.
11. ETag granularity is a domain modeling decision.
12. Proxies/gateways must preserve conditional headers and must not rewrite business ETags accidentally.
13. Authorization must run before disclosing current validators.
14. In workflow-heavy systems, conditional requests protect regulatory defensibility by preventing silent overwrites.

---

## 31. What Comes Next

Next part:

```text
learn-http-for-web-backend-perspective-part-013.md
```

Title:

```text
Caching for Backend Engineers
```

We will build on validators from this part and go deeper into:

- HTTP cache model
- private vs shared cache
- `Cache-Control`
- `Vary`
- cache invalidation
- authenticated response caching
- stale response strategies
- cache poisoning risks
- backend-generated cache policy
- Java/Spring examples

Status seri: **Part 012 dari 032 selesai**. Seri **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-011.md">⬅️ Part 011 — Idempotency, Retries, and Exactly-Once Illusions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-013.md">Part 013 — Caching for Backend Engineers ➡️</a>
</div>
