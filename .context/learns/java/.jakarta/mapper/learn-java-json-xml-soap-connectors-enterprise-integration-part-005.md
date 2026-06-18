# learn-java-json-xml-soap-connectors-enterprise-integration — Part 005
# JSON-P Transformation & Mutation

> Seri: **Java JSON, XML, SOAP, Legacy Integration, and Jakarta Connectors**  
> Part: **005 / 034**  
> Topik: **JSON-P Transformation & Mutation: JSON Pointer, JSON Patch, JSON Merge Patch, immutable tree update, audit-safe mutation, and enterprise partial-update design**  
> Target Java: **Java 8 sampai Java 25**  
> API utama: **Javax JSON Processing 1.1 / Jakarta JSON Processing 2.x**

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas JSON-P object model dan streaming model. Bagian ini bergerak ke area yang sering kelihatan sederhana tetapi sangat sering menjadi sumber bug production:

> Bagaimana cara mengubah sebagian JSON secara aman, eksplisit, repeatable, dan bisa diaudit?

Kita akan membahas:

1. kenapa transformasi JSON bukan sekadar `map.put(...)`;
2. perbedaan **read**, **replace**, **merge**, **patch**, **diff**, dan **projection**;
3. JSON Pointer sebagai bahasa alamat node JSON;
4. JSON Patch sebagai daftar operasi mutasi presisi;
5. JSON Merge Patch sebagai dokumen perubahan berbentuk mirip target;
6. desain partial update untuk API enterprise;
7. jebakan null, absent, array index, optimistic locking, authorization, validation, dan audit;
8. bagaimana JSON-P membantu membangun mutation pipeline yang aman;
9. kapan JSON-P tepat, kapan lebih baik memakai JSON-B/Jackson/domain command;
10. bagaimana membawa konsep ini ke sistem Java 8 sampai Java 25.

Bagian ini bukan hanya tentang API. API-nya relatif kecil. Yang sulit adalah **mental model mutation**.

---

## 1. Mental Model: JSON Transformation Bukan “Edit String”

JSON bisa dilihat dari beberapa level:

```text
Raw bytes / text
   ↓ parse
JSON value tree
   ↓ interpret
External contract object
   ↓ validate / authorize
Domain command / domain mutation
   ↓ persist / publish
System state
```

Kesalahan umum adalah menganggap PATCH/JSON mutation hanya berada di level “JSON value tree”. Padahal dalam sistem enterprise, mutasi selalu menyeberangi beberapa boundary:

```text
Client intent
   ↓
Patch document
   ↓
Patch syntax validation
   ↓
Patch semantic validation
   ↓
Authorization per path/field
   ↓
Business invariant validation
   ↓
Optimistic concurrency check
   ↓
Persistence update
   ↓
Audit event
   ↓
Integration event
```

Top 1% engineer tidak berhenti di pertanyaan:

> “Bagaimana apply patch ke JSON?”

Mereka bertanya:

> “Apa arti perubahan ini terhadap kontrak, state, security, audit, concurrency, downstream compatibility, dan recoverability?”

---

## 2. Vocabulary Dasar: Read, Transform, Patch, Merge, Diff

Sebelum masuk API, kita harus membedakan beberapa operasi.

### 2.1 Read / Query

Read berarti mengambil nilai dari JSON tanpa mengubah struktur.

Contoh:

```json
{
  "applicationId": "APP-001",
  "applicant": {
    "name": "Alice",
    "email": "alice@example.com"
  }
}
```

Mengambil `/applicant/email` adalah read/query.

Di JSON-P, ini bisa dilakukan dengan:

- manual traversal: `jsonObject.getJsonObject("applicant").getString("email")`;
- JSON Pointer: `Json.createPointer("/applicant/email").getValue(document)`.

### 2.2 Transform

Transform berarti menghasilkan JSON baru dari JSON lama.

Contoh:

```text
input external payload
   → normalize field names
   → remove unknown internal-only fields
   → add derived metadata
   → output canonical payload
```

Transform tidak selalu berarti update resource. Transform bisa dipakai untuk:

- normalization;
- projection;
- masking;
- enrichment;
- canonicalization;
- redaction;
- migration;
- compatibility adapter.

### 2.3 Mutation

Mutation berarti perubahan terhadap representasi state.

Karena `JsonObject` dan `JsonArray` di JSON-P bersifat immutable, mutation biasanya dilakukan dengan membuat value baru:

```text
old JsonObject
   + builder / patch operation
   = new JsonObject
```

Ini bagus untuk reasoning karena mengurangi side effect tersembunyi.

### 2.4 Patch

Patch adalah dokumen yang menjelaskan operasi perubahan.

Contoh JSON Patch:

```json
[
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
]
```

Patch sangat eksplisit. Ia mengatakan:

> ganti nilai pada path tertentu dengan value tertentu.

### 2.5 Merge Patch

Merge Patch adalah dokumen perubahan yang bentuknya mirip dokumen target.

Contoh:

```json
{
  "applicant": {
    "email": "new@example.com"
  }
}
```

Maknanya kira-kira:

> merge object ini ke dokumen target; field yang dikirim diubah; field yang tidak dikirim dibiarkan.

Namun ada aturan penting:

```json
{
  "applicant": {
    "email": null
  }
}
```

Dalam JSON Merge Patch, `null` berarti **remove field**, bukan “set value to JSON null” dalam arti bisnis biasa. Ini salah satu jebakan terbesar.

### 2.6 Diff

Diff adalah hasil perbandingan dua dokumen.

```text
source JSON + target JSON → patch document
```

Diff berguna untuk:

- audit trail;
- synchronization;
- replication;
- review UI;
- conflict detection;
- migration script;
- rollback planning.

Tetapi diff bukan selalu domain intent. Dua dokumen yang berbeda bisa memiliki diff teknis sama, tetapi arti bisnis berbeda.

---

## 3. JSON-P dan Standar yang Didukung

Jakarta JSON Processing menyediakan API portable untuk parse, generate, transform, dan query JSON menggunakan object model maupun streaming model. Package `jakarta.json` mencakup model object seperti `JsonObject`, `JsonArray`, `JsonValue`, builder, reader/writer, serta API untuk JSON Pointer, JSON Patch, dan JSON Merge Patch.

Standar yang relevan:

| Standar | Fungsi | Bentuk |
|---|---|---|
| JSON Pointer | Mengalamatkan satu nilai dalam JSON document | string seperti `/a/b/0` |
| JSON Patch | Menyatakan daftar operasi perubahan | array operasi `{op,path,value}` |
| JSON Merge Patch | Menyatakan perubahan berbentuk mirip dokumen target | object partial |

Dalam API Jakarta JSON Processing modern, konsep ini muncul sebagai:

- `JsonPointer`
- `JsonPatch`
- `JsonPatchBuilder`
- `JsonMergePatch`
- factory method di `Json`

Nama package berbeda tergantung generasi:

| Era | Package | Contoh Artifact |
|---|---|---|
| Java EE / javax | `javax.json.*` | `javax.json:javax.json-api`, provider GlassFish/Johnzon |
| Jakarta EE / jakarta | `jakarta.json.*` | `jakarta.json:jakarta.json-api`, provider Parsson/Johnzon |

Java 8 sering memakai `javax.json`. Java 11+ dan Jakarta EE modern cenderung memakai `jakarta.json`.

---

## 4. JSON-P Object Model: Immutable by Design

Sebelum patch, pahami dulu sifat dasar `JsonObject` dan `JsonArray`.

Secara konseptual:

```java
JsonObject document = Json.createObjectBuilder()
    .add("status", "DRAFT")
    .add("applicant", Json.createObjectBuilder()
        .add("name", "Alice")
        .add("email", "alice@example.com"))
    .build();
```

Setelah `build()`, object tersebut tidak diedit secara langsung seperti mutable map.

Tidak ada pola seperti:

```java
// bukan model utama JSON-P
jsonObject.put("status", "SUBMITTED");
```

Sebagai gantinya, perubahan dilakukan lewat:

1. builder baru;
2. `JsonPointer` transformation;
3. `JsonPatch`;
4. `JsonMergePatch`;
5. convert ke domain object lalu update domain lalu serialize ulang.

Immutability ini adalah fitur penting, bukan kekurangan.

### 4.1 Kenapa Immutability Bagus untuk Enterprise Integration?

Karena mutation di boundary sistem harus bisa dijelaskan.

Dengan immutable JSON:

```text
before document
patch/change instruction
after document
```

Kita bisa menyimpan:

- before hash;
- patch document;
- after hash;
- actor;
- timestamp;
- request correlation id;
- authorization decision;
- validation result.

Ini jauh lebih defensible dibanding object mutable yang berubah secara diam-diam di banyak layer.

---

## 5. JSON Pointer: Bahasa Alamat Node JSON

JSON Pointer adalah syntax string untuk menunjuk nilai tertentu dalam JSON document.

Contoh dokumen:

```json
{
  "applicationId": "APP-001",
  "applicant": {
    "name": "Alice",
    "contacts": [
      { "type": "email", "value": "alice@example.com" },
      { "type": "mobile", "value": "+6512345678" }
    ]
  }
}
```

Pointer:

| Pointer | Nilai |
|---|---|
| `/applicationId` | `"APP-001"` |
| `/applicant/name` | `"Alice"` |
| `/applicant/contacts/0/type` | `"email"` |
| `/applicant/contacts/1/value` | `"+6512345678"` |

Root document ditunjuk oleh empty string:

```text
""
```

Bukan `/`.

`/` berarti field bernama empty string pada root object.

### 5.1 Escaping di JSON Pointer

Karena `/` dipakai sebagai separator path, key JSON yang mengandung `/` harus di-escape.

Aturan penting:

| Karakter asli | Escape di pointer |
|---|---|
| `~` | `~0` |
| `/` | `~1` |

Contoh:

```json
{
  "a/b": 10,
  "x~y": 20
}
```

Pointer:

```text
/a~1b  → 10
/x~0y  → 20
```

Ini sering terlupakan saat key berasal dari external system.

### 5.2 JSON Pointer Bukan JSONPath

JSON Pointer:

```text
/applicant/contacts/0/value
```

JSONPath:

```text
$.applicant.contacts[0].value
```

Perbedaannya:

| Aspek | JSON Pointer | JSONPath |
|---|---|---|
| Standar awal | RFC 6901 | RFC modern terpisah |
| Tujuan utama | alamat satu value spesifik | query/select values |
| Wildcard/filter | tidak | ya, tergantung implementasi/standar |
| Cocok untuk patch | sangat cocok | tidak umum untuk patch standar |
| Hasil | satu node atau error | bisa banyak node |

Dalam JSON-P transformation, JSON Pointer sangat penting karena JSON Patch memakai pointer untuk field `path`.

### 5.3 Menggunakan JsonPointer

Contoh Jakarta package:

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonPointer;
import jakarta.json.JsonValue;

JsonPointer pointer = Json.createPointer("/applicant/name");
JsonValue value = pointer.getValue(document);
```

Untuk Java EE / javax:

```java
import javax.json.Json;
import javax.json.JsonPointer;
```

Konsepnya sama, package berbeda.

### 5.4 Pointer sebagai Boundary Permission

Dalam API enterprise, pointer bukan hanya teknik akses. Pointer bisa menjadi unit authorization.

Contoh:

```text
/applicant/name              allowed for applicant owner
/applicant/email             allowed for applicant owner
/status                      allowed only for officer workflow
/approval/decision           allowed only for approver
/internalRiskScore           never client writable
```

Maka patch request harus divalidasi bukan hanya syntax-nya, tetapi juga path-nya.

```text
patch operation
   ↓
extract path
   ↓
normalize/validate pointer
   ↓
check writable path allowlist
   ↓
check role/context/workflow state
   ↓
apply
```

### 5.5 Jangan Gunakan Blocklist untuk Path Sensitive

Buruk:

```text
Reject /internalRiskScore
Reject /createdBy
Reject /approvedBy
Allow everything else
```

Lebih aman:

```text
For role APPLICANT_DRAFT_EDITOR:
  allow /applicant/name
  allow /applicant/email
  allow /applicant/address
  allow /documents/-
  reject all others
```

Alasannya:

- field baru bisa muncul kemudian;
- nested field bisa bypass blocklist;
- array/object shape bisa berubah;
- external payload bisa membawa path mengejutkan;
- security review lebih mudah dengan allowlist.

---

## 6. JSON Patch: Operasi Mutasi Presisi

JSON Patch adalah format standar untuk menyatakan daftar operasi perubahan ke JSON document.

Bentuknya array:

```json
[
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" },
  { "op": "add", "path": "/metadata/lastUpdatedBy", "value": "user-123" }
]
```

Operasi umum:

| Operation | Makna |
|---|---|
| `add` | tambah value pada path |
| `remove` | hapus value pada path |
| `replace` | ganti value pada path |
| `move` | pindahkan value dari `from` ke `path` |
| `copy` | salin value dari `from` ke `path` |
| `test` | pastikan value di path sama dengan value tertentu |

### 6.1 Atomicity Mental Model

JSON Patch harus diperlakukan sebagai satu unit.

```text
operation 1 succeeds
operation 2 succeeds
operation 3 fails
```

Dalam desain API, jangan menyimpan hasil parsial. Semantik yang sehat:

```text
all operations valid and applied → success
any operation invalid/fails      → entire patch rejected
```

Ini penting untuk:

- consistency;
- audit;
- retry;
- client mental model;
- transaction boundary.

### 6.2 `add`

Menambahkan nilai.

```json
[
  { "op": "add", "path": "/tags/0", "value": "urgent" }
]
```

Jika target adalah object, `add` menambahkan field baru atau mengganti field existing tergantung aturan JSON Patch.

Jika target adalah array:

- path index valid menambah di posisi tersebut;
- `-` berarti append ke akhir array.

Contoh append:

```json
[
  { "op": "add", "path": "/tags/-", "value": "urgent" }
]
```

### 6.3 `remove`

Menghapus value.

```json
[
  { "op": "remove", "path": "/applicant/middleName" }
]
```

Jika path tidak ada, patch gagal.

Ini bagus karena mencegah silent no-op yang bisa menyembunyikan bug client.

### 6.4 `replace`

Mengganti value existing.

```json
[
  { "op": "replace", "path": "/status", "value": "SUBMITTED" }
]
```

`replace` mensyaratkan target path sudah ada.

Jika path belum ada, harus gagal.

Ini membuat intent lebih jelas dibanding `add` yang bisa terasa seperti upsert.

### 6.5 `move`

Memindahkan value dari satu path ke path lain.

```json
[
  { "op": "move", "from": "/draftAddress", "path": "/submittedAddress" }
]
```

Dalam API enterprise, `move` sering lebih berisiko karena:

- menyentuh dua path;
- authorization harus dicek untuk source dan target;
- audit harus menjelaskan remove + add;
- bisa membingungkan di domain model.

Banyak API memilih menolak `move` walaupun standar mendukung.

### 6.6 `copy`

Menyalin value.

```json
[
  { "op": "copy", "from": "/registeredAddress", "path": "/mailingAddress" }
]
```

Sama seperti `move`, operasi ini perlu validasi source dan target.

### 6.7 `test`

Memastikan value tertentu sebelum operasi lain dijalankan.

```json
[
  { "op": "test", "path": "/version", "value": 7 },
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
]
```

`test` bisa dipakai sebagai optimistic concurrency ringan.

Namun dalam API enterprise, jangan menggantikan versioning persistence hanya dengan `test`. Gunakan ETag, version column, atau concurrency control database juga.

### 6.8 JSON Patch dengan JSON-P

Contoh apply patch:

```java
import jakarta.json.Json;
import jakarta.json.JsonArray;
import jakarta.json.JsonObject;
import jakarta.json.JsonPatch;
import jakarta.json.JsonReader;
import jakarta.json.JsonValue;

import java.io.StringReader;

public class JsonPatchExample {
    public static void main(String[] args) {
        JsonObject source;
        JsonArray patchDocument;

        try (JsonReader reader = Json.createReader(new StringReader("""
            {
              "applicationId": "APP-001",
              "applicant": {
                "name": "Alice",
                "email": "alice@example.com"
              },
              "version": 7
            }
            """))) {
            source = reader.readObject();
        }

        try (JsonReader reader = Json.createReader(new StringReader("""
            [
              { "op": "test", "path": "/version", "value": 7 },
              { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
            ]
            """))) {
            patchDocument = reader.readArray();
        }

        JsonPatch patch = Json.createPatch(patchDocument);
        JsonValue result = patch.apply(source);

        System.out.println(result);
    }
}
```

Untuk Java 8 tanpa text block, gunakan string biasa:

```java
String json = "{\"applicationId\":\"APP-001\"}";
```

### 6.9 Membuat Patch dengan Builder

```java
JsonPatch patch = Json.createPatchBuilder()
    .test("/version", 7)
    .replace("/applicant/email", "new@example.com")
    .add("/metadata/lastModifiedBy", "user-123")
    .build();

JsonValue updated = patch.apply(source);
```

Builder bagus untuk server-side generated patch, misalnya:

- audit normalization;
- system enrichment;
- migration;
- deterministic transformation;
- internal workflow mutation.

Untuk external client patch, biasanya patch dibaca dari request body lalu divalidasi.

### 6.10 Membuat Diff JSON Patch

JSON-P menyediakan pembuatan diff dari source ke target.

```java
JsonPatch diff = Json.createDiff(source, target);
JsonValue patched = diff.apply(source);
```

Secara mental:

```text
source + diff(source, target) = target
```

Kegunaan:

- audit technical diff;
- test expectation;
- migration review;
- snapshot comparison;
- replication.

Tetapi jangan salah mengira diff teknis adalah business command.

Contoh:

```json
[
  { "op": "replace", "path": "/status", "value": "APPROVED" }
]
```

Secara teknis ini hanya replace. Secara domain, perubahan status ke `APPROVED` mungkin membutuhkan:

- actor role approver;
- previous state `PENDING_REVIEW`;
- all mandatory checks complete;
- no outstanding payment;
- decision reason;
- notification event;
- audit approval record.

Diff tidak memuat semua itu.

---

## 7. JSON Merge Patch: Partial Object Update yang Terlihat Sederhana

JSON Merge Patch memakai dokumen yang mirip target.

Target:

```json
{
  "applicationId": "APP-001",
  "applicant": {
    "name": "Alice",
    "email": "alice@example.com",
    "mobile": "+6512345678"
  },
  "status": "DRAFT"
}
```

Merge patch:

```json
{
  "applicant": {
    "email": "new@example.com"
  }
}
```

Result:

```json
{
  "applicationId": "APP-001",
  "applicant": {
    "name": "Alice",
    "email": "new@example.com",
    "mobile": "+6512345678"
  },
  "status": "DRAFT"
}
```

### 7.1 Null Berarti Remove

Patch:

```json
{
  "applicant": {
    "mobile": null
  }
}
```

Result:

```json
{
  "applicationId": "APP-001",
  "applicant": {
    "name": "Alice",
    "email": "alice@example.com"
  },
  "status": "DRAFT"
}
```

Field `mobile` dihapus.

Ini penting sekali:

```text
absent field → no change
field: null  → remove field
```

Kalau domain Anda membedakan “set null” vs “remove property”, Merge Patch bisa menjadi ambigu atau berbahaya.

### 7.2 Merge Patch dan Array

JSON Merge Patch tidak melakukan merge elemen array secara granular.

Target:

```json
{
  "tags": ["a", "b", "c"]
}
```

Patch:

```json
{
  "tags": ["a", "c"]
}
```

Result:

```json
{
  "tags": ["a", "c"]
}
```

Array diganti sebagai satu value, bukan di-diff per elemen.

Jika butuh operasi array granular, gunakan JSON Patch.

### 7.3 Menggunakan JsonMergePatch

```java
JsonObject source = Json.createObjectBuilder()
    .add("applicationId", "APP-001")
    .add("applicant", Json.createObjectBuilder()
        .add("name", "Alice")
        .add("email", "alice@example.com")
        .add("mobile", "+6512345678"))
    .build();

JsonObject patchDocument = Json.createObjectBuilder()
    .add("applicant", Json.createObjectBuilder()
        .add("email", "new@example.com"))
    .build();

JsonMergePatch mergePatch = Json.createMergePatch(patchDocument);
JsonValue result = mergePatch.apply(source);
```

### 7.4 Membuat Merge Diff

```java
JsonMergePatch mergeDiff = Json.createMergeDiff(source, target);
JsonValue result = mergeDiff.apply(source);
```

Kegunaan mirip `createDiff`, tetapi output-nya berbentuk Merge Patch.

### 7.5 JSON Patch vs JSON Merge Patch

| Aspek | JSON Patch | JSON Merge Patch |
|---|---|---|
| Format | array operasi | object mirip target |
| Granularitas | tinggi | sedang |
| Array update | granular via index/path | replace whole array |
| Null handling | value null bisa eksplisit | null berarti remove |
| Optimistic check | bisa pakai `test` | tidak native |
| Mudah dibaca manusia | sedang | tinggi untuk object sederhana |
| Cocok untuk domain command | terbatas | terbatas |
| Cocok untuk sparse field update | ya | sangat ya |
| Risiko path injection | tinggi jika tidak divalidasi | tetap ada, tapi bentuk field-based |

Rekomendasi praktis:

```text
Sederhana field update tanpa array granular → Merge Patch
Butuh operasi eksplisit / array / test / diff presisi → JSON Patch
Butuh business workflow penting → domain-specific command lebih baik
```

---

## 8. JSON-P Mutation Patterns

Ada beberapa pola transformasi JSON-P yang perlu dikuasai.

### 8.1 Pattern 1 — Read-Modify-Write dengan Builder

Cocok untuk perubahan kecil yang dikontrol server.

```java
JsonObject applicant = source.getJsonObject("applicant");

JsonObject updatedApplicant = Json.createObjectBuilder(applicant)
    .add("email", "new@example.com")
    .build();

JsonObject updatedDocument = Json.createObjectBuilder(source)
    .add("applicant", updatedApplicant)
    .build();
```

Kelebihan:

- eksplisit;
- mudah debug;
- tidak perlu patch document;
- cocok untuk internal transformation.

Kekurangan:

- verbose untuk nested deep update;
- raw path tidak reusable;
- sulit membuat audit diff kecuali dibandingkan source-target.

### 8.2 Pattern 2 — Pointer-Based Replace

```java
JsonPointer pointer = Json.createPointer("/applicant/email");
JsonValue updated = pointer.replace(source, Json.createValue("new@example.com"));
```

Kelebihan:

- presisi;
- cocok untuk path-driven logic;
- bisa dipakai untuk generic transformer.

Kekurangan:

- path harus divalidasi;
- raw string path rawan typo;
- domain invariant tidak terlihat.

### 8.3 Pattern 3 — JSON Patch Internal

```java
JsonPatch patch = Json.createPatchBuilder()
    .replace("/applicant/email", "new@example.com")
    .add("/metadata/normalized", true)
    .build();

JsonValue updated = patch.apply(source);
```

Cocok untuk:

- migration;
- canonicalization;
- enrichment;
- reversible audit;
- automated transformation pipeline.

### 8.4 Pattern 4 — Merge Patch External

Client mengirim:

```json
{
  "applicant": {
    "email": "new@example.com"
  }
}
```

Server:

```java
JsonMergePatch patch = Json.createMergePatch(patchDocument);
JsonValue candidate = patch.apply(currentJson);
```

Lalu server tidak langsung save. Ia harus validasi hasil.

```text
currentJson
   + mergePatch
   = candidateJson
   ↓
validate writable fields
validate schema / shape
validate domain invariants
map to command or domain object
persist
```

### 8.5 Pattern 5 — Diff for Audit

```java
JsonPatch technicalDiff = Json.createDiff(beforeJson, afterJson);
```

Simpan audit:

```json
{
  "entityType": "Application",
  "entityId": "APP-001",
  "actor": "user-123",
  "operation": "PATCH_APPLICATION_CONTACT",
  "beforeHash": "sha256:...",
  "afterHash": "sha256:...",
  "patch": [
    { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
  ],
  "timestamp": "2026-06-17T10:15:30Z",
  "correlationId": "..."
}
```

Perhatian: audit patch bisa memuat PII. Jangan sembarang log full diff ke application log.

---

## 9. Enterprise Partial Update Pipeline

Partial update API yang matang tidak berbentuk:

```text
receive patch → apply patch → save
```

Itu terlalu naif.

Pola yang lebih aman:

```text
HTTP PATCH request
   ↓
content-type check
   ↓
size/depth/operation limit
   ↓
parse into JsonValue
   ↓
syntax validation
   ↓
path allowlist validation
   ↓
load current resource
   ↓
state/version check
   ↓
apply patch to candidate JSON
   ↓
schema/DTO validation
   ↓
domain invariant validation
   ↓
authorization after-state validation
   ↓
map to domain command / aggregate mutation
   ↓
persist transactionally
   ↓
audit technical diff + business event
   ↓
return representation / 204
```

### 9.1 Content-Type Matters

Gunakan content type yang jelas:

```http
PATCH /applications/APP-001
Content-Type: application/json-patch+json
```

atau:

```http
PATCH /applications/APP-001
Content-Type: application/merge-patch+json
```

Jangan menerima semua sebagai `application/json` tanpa membedakan semantics.

Alasan:

- JSON Patch array dan Merge Patch object punya makna berbeda;
- gateway/filter bisa melakukan routing/validation;
- observability lebih jelas;
- client contract tidak ambigu.

### 9.2 Limit Operation Count

JSON Patch dengan ribuan operasi bisa menjadi denial-of-service.

Contoh batas:

```text
max payload size: 64 KB
max operations: 50
max pointer depth: 10
max string length per value: 4 KB
max array expansion: 100 elements
```

Batas tergantung domain, tapi harus eksplisit.

### 9.3 Validate Path Before Apply

Buruk:

```java
JsonValue candidate = patch.apply(current);
validate(candidate);
```

Masalahnya:

- patch bisa menyentuh field internal lalu hasil akhir terlihat valid;
- operasi `move`/`copy` bisa membaca field yang tidak boleh dibaca;
- operasi `remove` bisa menghapus field wajib lalu error message bocor;
- array index bisa menyebabkan unexpected mutation.

Lebih baik:

```text
parse patch ops
   ↓
validate each op/path/from/value intent
   ↓
apply
```

### 9.4 Validate Before-State dan After-State

Ada dua jenis validasi:

```text
before-state validation:
  apakah resource boleh diedit saat ini?
  apakah actor boleh menyentuh path ini pada state ini?
  apakah version cocok?

after-state validation:
  apakah hasil akhir valid?
  apakah invariant domain tetap benar?
  apakah transisi state legal?
```

Contoh:

```text
/status can change DRAFT → SUBMITTED by applicant
/status cannot change APPROVED → DRAFT by applicant
/internalReview/comment only writable by officer
```

### 9.5 Separate Technical Patch from Domain Command

Untuk field update sederhana, patch bisa langsung menjadi input teknis.

Tapi untuk perubahan penting, jangan biarkan patch menjadi domain command.

Buruk:

```json
[
  { "op": "replace", "path": "/status", "value": "APPROVED" }
]
```

Lebih baik:

```http
POST /applications/APP-001/approval-decision
```

```json
{
  "decision": "APPROVED",
  "reason": "All checks passed",
  "version": 7
}
```

Karena approval bukan sekadar field replace. Approval adalah domain event dengan invariant, actor, reason, timestamp, notification, dan audit semantics.

---

## 10. Path Allowlist Design

Path allowlist harus explicit dan contextual.

### 10.1 Simple Static Allowlist

```java
Set<String> applicantDraftWritablePaths = Set.of(
    "/applicant/name",
    "/applicant/email",
    "/applicant/mobile",
    "/applicant/address/postalCode",
    "/applicant/address/block",
    "/applicant/address/street"
);
```

Cocok untuk DTO sederhana.

### 10.2 Prefix Allowlist

```text
/applicant/address/* allowed
/documents/- allowed
```

Hati-hati. Prefix bisa terlalu longgar.

Contoh bahaya:

```text
/applicant/address/internalGeoScore
```

Jika field internal berada di bawah prefix allowed, client bisa mengubahnya.

### 10.3 Operation-Specific Allowlist

Tidak semua path boleh semua operasi.

| Path | add | replace | remove |
|---|---:|---:|---:|
| `/applicant/email` | no | yes | no |
| `/applicant/middleName` | yes | yes | yes |
| `/documents/-` | yes | no | no |
| `/status` | no | no via generic PATCH | no |

Representasi:

```java
record PatchRule(
    String pathPattern,
    Set<String> allowedOps,
    Set<String> allowedRoles,
    Set<String> allowedStates
) {}
```

### 10.4 Source Path Validation for `copy` and `move`

Untuk operation `copy` dan `move`, validasi bukan hanya `path`, tetapi juga `from`.

```json
{
  "op": "copy",
  "from": "/internalRiskScore",
  "path": "/publicNote"
}
```

Jika tidak divalidasi, user bisa menyalin data internal ke field yang terlihat publik.

Karena itu banyak API enterprise menolak `copy` dan `move` untuk external clients.

---

## 11. Null, Absent, Empty, Remove

Partial update gagal sering karena tim tidak sepakat arti null.

Kita perlu membedakan:

| Bentuk | Makna teknis | Makna domain mungkin |
|---|---|---|
| field absent | tidak dikirim | tidak berubah |
| field = null | dikirim null | clear value / remove / invalid |
| field = `""` | string kosong | empty input / clear text |
| field = `[]` | array kosong | clear all items |
| field removed | property hilang | unknown/not applicable |

### 11.1 Dalam JSON Patch

```json
[
  { "op": "replace", "path": "/middleName", "value": null }
]
```

Ini berarti set value menjadi JSON null.

```json
[
  { "op": "remove", "path": "/middleName" }
]
```

Ini berarti hapus field.

JSON Patch bisa membedakan null dan remove.

### 11.2 Dalam JSON Merge Patch

```json
{
  "middleName": null
}
```

Ini berarti remove field menurut Merge Patch semantics.

Jika domain Anda perlu menyimpan explicit null, Merge Patch menjadi tidak cocok atau butuh envelope khusus.

Contoh envelope:

```json
{
  "middleName": {
    "operation": "SET_NULL"
  }
}
```

Namun saat sudah memakai envelope seperti ini, Anda sebenarnya bergerak ke domain-specific command, bukan pure Merge Patch.

---

## 12. Array Mutation: Index adalah Kontrak yang Rapuh

JSON Patch memakai index untuk array.

```json
[
  { "op": "replace", "path": "/documents/2/name", "value": "new.pdf" }
]
```

Masalah:

- index bisa berubah antara client read dan patch;
- concurrent update bisa menyisipkan elemen;
- UI sorting bisa berbeda dari storage order;
- array order mungkin tidak bermakna domain;
- operation beruntun dapat menggeser index.

### 12.1 Gunakan Stable Identity untuk Collection Domain

Daripada:

```json
"documents": [
  { "name": "a.pdf" },
  { "name": "b.pdf" }
]
```

Lebih baik:

```json
"documents": [
  { "documentId": "DOC-001", "name": "a.pdf" },
  { "documentId": "DOC-002", "name": "b.pdf" }
]
```

Tetapi JSON Patch tetap menunjuk index, bukan mencari by ID.

Untuk collection penting, lebih baik expose endpoint domain-specific:

```http
PATCH /applications/APP-001/documents/DOC-002
```

atau command:

```http
POST /applications/APP-001/documents/DOC-002/rename
```

### 12.2 When Array Patch is Acceptable

Array patch masih ok jika:

- array kecil;
- order adalah bagian dari contract;
- client memegang version/ETag;
- patch berisi `test` sebelum mutation;
- conflict handling jelas.

Contoh:

```json
[
  { "op": "test", "path": "/version", "value": 7 },
  { "op": "test", "path": "/documents/1/documentId", "value": "DOC-002" },
  { "op": "replace", "path": "/documents/1/name", "value": "updated.pdf" }
]
```

Ini lebih aman karena memastikan index masih menunjuk item yang sama.

---

## 13. Validation Strategy

### 13.1 Syntax Validation

Syntax validation menjawab:

- apakah body JSON valid?
- apakah patch array/object sesuai media type?
- apakah operation punya field wajib?
- apakah path valid JSON Pointer?
- apakah value valid JSON value?

### 13.2 Structural Validation

Structural validation menjawab:

- apakah hasil akhir punya field wajib?
- apakah type field benar?
- apakah enum value dikenal?
- apakah nested object shape sesuai?

Ini bisa dilakukan dengan:

- JSON Schema;
- DTO binding + Jakarta Validation;
- manual validation;
- contract test.

### 13.3 Semantic Validation

Semantic validation menjawab:

- apakah tanggal mulai <= tanggal selesai?
- apakah status transition legal?
- apakah user boleh edit setelah submitted?
- apakah field wajib berdasarkan kondisi lain?
- apakah amount tidak boleh turun setelah invoice issued?

Ini tidak bisa diselesaikan hanya oleh JSON-P.

JSON-P membantu membuat candidate JSON. Domain tetap harus memutuskan apakah candidate state valid.

### 13.4 Security Validation

Security validation menjawab:

- apakah actor boleh melihat source path?
- apakah actor boleh menulis target path?
- apakah patch menyebabkan data internal bocor?
- apakah error response membocorkan field internal?
- apakah patch bisa membuat privilege escalation?

Contoh privilege escalation:

```json
[
  { "op": "add", "path": "/roles/-", "value": "ADMIN" }
]
```

Atau:

```json
{
  "isApproved": true,
  "approvedBy": "self"
}
```

Jika PATCH generic diterapkan ke entity tanpa allowlist, ini sangat berbahaya.

---

## 14. Designing PATCH API Correctly

### 14.1 Option A — JSON Patch Endpoint

```http
PATCH /applications/APP-001
Content-Type: application/json-patch+json
If-Match: "v7"
```

```json
[
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
]
```

Cocok untuk:

- technical clients;
- UI yang butuh granular edits;
- integration sync;
- audit diff;
- partial update generic yang tetap dikontrol allowlist.

### 14.2 Option B — Merge Patch Endpoint

```http
PATCH /applications/APP-001
Content-Type: application/merge-patch+json
If-Match: "v7"
```

```json
{
  "applicant": {
    "email": "new@example.com"
  }
}
```

Cocok untuk:

- simple field updates;
- human-readable partial object;
- API yang tidak butuh granular array operation;
- client yang sudah familiar dengan sparse object update.

### 14.3 Option C — Domain Command Endpoint

```http
POST /applications/APP-001/change-contact-email
```

```json
{
  "email": "new@example.com",
  "reason": "Applicant correction",
  "version": 7
}
```

Cocok untuk:

- operation bernilai bisnis;
- workflow transition;
- audit penting;
- side effect;
- event publication;
- complex invariant.

### 14.4 Decision Matrix

| Scenario | Recommended |
|---|---|
| Update display name sederhana | Merge Patch atau command sederhana |
| Replace nested field teknis | JSON Patch |
| Append item ke array kecil | JSON Patch dengan version/test |
| Rename document by documentId | Domain endpoint |
| Approve application | Domain command, bukan generic patch |
| Sync config document antar sistem | JSON Patch/diff |
| Update user role/permission | Domain command dengan strong authorization |
| Clear optional field | JSON Patch lebih eksplisit daripada Merge Patch |
| Bulk normalize external payload | internal JSON-P builder/patch pipeline |

---

## 15. DTO vs JsonValue vs Domain Object

Ada tiga pendekatan umum.

### 15.1 Patch Langsung ke JsonValue

```text
current domain object → JSON representation
apply patch → candidate JSON
candidate JSON → validation → domain update
```

Kelebihan:

- patch semantics natural;
- diff mudah;
- tidak perlu mutable DTO;
- cocok untuk generic document resources.

Kekurangan:

- mapping domain ke JSON bisa kompleks;
- raw JSON path bisa tidak cocok dengan domain model;
- validation perlu disiplin.

### 15.2 Patch ke DTO

```text
current DTO → JSON → patch → candidate DTO → validate → domain
```

Kelebihan:

- boundary representation jelas;
- validation lebih mudah dengan Bean Validation;
- domain tidak terekspos langsung.

Kekurangan:

- DTO bisa makin gemuk;
- null/absent semantics sulit jika binding ke POJO;
- Merge Patch bisa kehilangan informasi absent vs null jika langsung bind.

### 15.3 Convert Patch to Domain Command

```text
patch document → validated command(s) → aggregate method
```

Kelebihan:

- domain intent jelas;
- invariant kuat;
- audit bisnis bagus;
- lebih aman untuk workflow.

Kekurangan:

- lebih banyak kode;
- tidak generic;
- perlu desain command.

Top-tier design biasanya menggabungkan:

```text
Generic patch for low-risk representation fields
Domain command for high-risk state transition
```

---

## 16. Audit-Safe Mutation

Audit yang baik tidak hanya menyimpan “after value”.

Minimal audit mutation:

```text
who changed
what resource
when
from where / correlation id
operation type
business reason
before version
after version
technical diff or field list
authorization context
validation result
```

### 16.1 Technical Diff vs Business Event

Technical diff:

```json
[
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
]
```

Business event:

```json
{
  "eventType": "ApplicantEmailChanged",
  "applicationId": "APP-001",
  "oldEmailMasked": "a***@example.com",
  "newEmailMasked": "n***@example.com",
  "changedBy": "user-123",
  "reason": "Applicant correction"
}
```

Keduanya berbeda dan saling melengkapi.

### 16.2 Jangan Log PII Mentah Sembarangan

Patch sering memuat:

- email;
- phone;
- address;
- ID number;
- free-text notes;
- attachments metadata;
- decision reason.

Hati-hati dengan:

```java
log.info("patch={}", patchDocument);
```

Lebih aman:

```text
log: operation count, allowed paths, actor, resource id, result, correlation id
secure audit store: redacted diff or encrypted sensitive fields
```

### 16.3 Redacted Diff

Contoh redaction:

```json
[
  { "op": "replace", "path": "/applicant/email", "value": "***REDACTED***" },
  { "op": "replace", "path": "/applicant/mobile", "value": "***REDACTED***" }
]
```

Atau simpan hash:

```json
{
  "path": "/applicant/email",
  "oldHash": "sha256:...",
  "newHash": "sha256:..."
}
```

---

## 17. Concurrency and Conflict Handling

PATCH lebih rentan terhadap lost update daripada PUT jika tidak ada concurrency control.

### 17.1 Lost Update Example

Initial:

```json
{
  "version": 7,
  "applicant": {
    "email": "old@example.com",
    "mobile": "111"
  }
}
```

User A reads version 7.  
User B reads version 7.

A patch:

```json
{ "applicant": { "email": "a@example.com" } }
```

B patch:

```json
{ "applicant": { "mobile": "222" } }
```

If applied independently, both may be OK.

But if B sends stale representation with broader patch or array replacement, A's change can be overwritten.

### 17.2 Use ETag / Version

```http
If-Match: "7"
```

Server:

```text
current version == If-Match ? apply : 412 Precondition Failed
```

At persistence level:

```sql
UPDATE application
SET payload = ?, version = version + 1
WHERE id = ? AND version = ?
```

If affected rows = 0, conflict.

### 17.3 JSON Patch `test` as Additional Guard

```json
[
  { "op": "test", "path": "/version", "value": 7 },
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" }
]
```

Good, but not enough alone unless tied to storage concurrency.

### 17.4 Conflict Response

Useful response:

```json
{
  "error": "VERSION_CONFLICT",
  "message": "The resource has changed since you last read it.",
  "currentVersion": 8,
  "correlationId": "..."
}
```

Avoid returning full current document if it contains data actor may not be authorized to see.

---

## 18. Error Handling Model

Patch errors need predictable status codes.

| Condition | Suggested HTTP Status |
|---|---:|
| invalid JSON syntax | 400 |
| unsupported media type | 415 |
| invalid patch structure | 400 |
| path not allowed | 403 or 400 depending security posture |
| path does not exist for replace/remove | 409 or 422 |
| version mismatch | 412 |
| semantic validation failure | 422 |
| resource not found | 404 |
| operation not allowed in current workflow state | 409 |

Security-sensitive path may be returned as generic error:

```json
{
  "error": "PATCH_NOT_ALLOWED",
  "message": "One or more requested changes are not allowed."
}
```

Do not say:

```json
{
  "message": "Path /internalRiskScore is not writable"
}
```

unless exposing that path is acceptable.

---

## 19. Implementation Skeleton: Safe JSON Patch Service

Contoh ini bukan framework-specific. Cocok untuk JAX-RS, Servlet, Spring, atau service internal.

```java
import jakarta.json.Json;
import jakarta.json.JsonArray;
import jakarta.json.JsonObject;
import jakarta.json.JsonPatch;
import jakarta.json.JsonValue;

import java.util.Set;

public final class SafeJsonPatchService {

    private static final int MAX_OPERATIONS = 50;

    private final PatchPolicy policy;
    private final JsonDocumentValidator validator;

    public SafeJsonPatchService(PatchPolicy policy, JsonDocumentValidator validator) {
        this.policy = policy;
        this.validator = validator;
    }

    public JsonObject applyPatch(
            JsonObject current,
            JsonArray patchDocument,
            PatchContext context
    ) {
        validateOperationCount(patchDocument);
        validatePatchOperations(patchDocument, context);

        JsonPatch patch = Json.createPatch(patchDocument);
        JsonValue candidateValue = patch.apply(current);

        if (candidateValue.getValueType() != JsonValue.ValueType.OBJECT) {
            throw new PatchRejectedException("PATCH_RESULT_NOT_OBJECT");
        }

        JsonObject candidate = candidateValue.asJsonObject();
        validator.validate(candidate, context);

        return candidate;
    }

    private void validateOperationCount(JsonArray patchDocument) {
        if (patchDocument.size() > MAX_OPERATIONS) {
            throw new PatchRejectedException("TOO_MANY_PATCH_OPERATIONS");
        }
    }

    private void validatePatchOperations(JsonArray operations, PatchContext context) {
        for (JsonValue opValue : operations) {
            if (opValue.getValueType() != JsonValue.ValueType.OBJECT) {
                throw new PatchRejectedException("PATCH_OPERATION_MUST_BE_OBJECT");
            }

            JsonObject op = opValue.asJsonObject();
            String operation = requiredString(op, "op");
            String path = requiredString(op, "path");

            if (!policy.isAllowed(operation, path, context)) {
                throw new PatchRejectedException("PATCH_PATH_NOT_ALLOWED");
            }

            if (("copy".equals(operation) || "move".equals(operation))) {
                String from = requiredString(op, "from");
                if (!policy.isReadable(from, context)) {
                    throw new PatchRejectedException("PATCH_FROM_PATH_NOT_ALLOWED");
                }
            }
        }
    }

    private String requiredString(JsonObject object, String field) {
        if (!object.containsKey(field) || object.isNull(field)) {
            throw new PatchRejectedException("PATCH_MISSING_" + field.toUpperCase());
        }
        return object.getString(field);
    }
}
```

Support classes:

```java
public interface PatchPolicy {
    boolean isAllowed(String operation, String path, PatchContext context);
    boolean isReadable(String path, PatchContext context);
}

public interface JsonDocumentValidator {
    void validate(JsonObject candidate, PatchContext context);
}

public record PatchContext(
    String actorId,
    Set<String> roles,
    String workflowState,
    long expectedVersion,
    String correlationId
) {}

public class PatchRejectedException extends RuntimeException {
    public PatchRejectedException(String message) {
        super(message);
    }
}
```

Untuk Java 8, ganti `record` dengan class biasa.

---

## 20. Implementation Skeleton: Safe Merge Patch Service

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonMergePatch;
import jakarta.json.JsonValue;

public final class SafeMergePatchService {

    private final MergePatchPolicy policy;
    private final JsonDocumentValidator validator;

    public SafeMergePatchService(MergePatchPolicy policy, JsonDocumentValidator validator) {
        this.policy = policy;
        this.validator = validator;
    }

    public JsonObject applyMergePatch(
            JsonObject current,
            JsonValue patchDocument,
            PatchContext context
    ) {
        if (patchDocument.getValueType() != JsonValue.ValueType.OBJECT) {
            throw new PatchRejectedException("MERGE_PATCH_MUST_BE_OBJECT_FOR_THIS_RESOURCE");
        }

        JsonObject patchObject = patchDocument.asJsonObject();

        policy.validateWritableShape(patchObject, context);

        JsonMergePatch mergePatch = Json.createMergePatch(patchObject);
        JsonValue candidateValue = mergePatch.apply(current);

        if (candidateValue.getValueType() != JsonValue.ValueType.OBJECT) {
            throw new PatchRejectedException("MERGE_PATCH_RESULT_NOT_OBJECT");
        }

        JsonObject candidate = candidateValue.asJsonObject();
        validator.validate(candidate, context);

        return candidate;
    }
}
```

Policy untuk Merge Patch perlu berjalan secara recursive terhadap object field.

```java
public interface MergePatchPolicy {
    void validateWritableShape(JsonObject patchObject, PatchContext context);
}
```

### 20.1 Recursive Shape Validation

Pseudo-code:

```text
validateMergePatchObject(object, currentPath):
  for each field in object:
    path = currentPath + "/" + escape(field)
    value = object[field]

    if path not writable:
       reject

    if value is object:
       validateMergePatchObject(value, path)
    else:
       validate scalar/array/null according to path rule
```

Ingat: `null` dalam Merge Patch berarti remove. Maka policy harus tahu apakah remove field tersebut boleh.

---

## 21. Normalization and Canonicalization

Transformation sering dibutuhkan sebelum validasi atau sebelum simpan.

Contoh normalization:

```text
trim string
lowercase email
normalize postal code
remove unknown client-only metadata
sort object keys for deterministic output
convert empty string to absent/null according to rule
```

### 21.1 Jangan Normalisasi Diam-Diam untuk Field Bermakna Legal

Contoh:

```text
name: " Alice  " → "Alice"
```

Mungkin aman untuk display name, tetapi untuk legal name bisa tidak aman jika whitespace adalah bagian dari data asli dari external identity provider.

Untuk data legal/regulatory, simpan dua bentuk jika perlu:

```text
rawExternalValue
normalizedSearchValue
```

### 21.2 Canonical JSON untuk Hashing

Jika ingin menghitung hash JSON untuk audit/version, pastikan output deterministik:

- field order stabil;
- number format stabil;
- no insignificant whitespace;
- null/absent semantics jelas;
- timestamp format canonical;
- Unicode normalization diputuskan.

JSON-P `JsonObject` secara API adalah map-like object, tetapi jangan mengandalkan insertion/order provider secara sembarangan untuk hash legal kecuali Anda mengontrol canonicalization.

---

## 22. JSON Pointer/Patch dengan Java 8 sampai 25

### 22.1 Java 8

Untuk Java 8, biasanya:

```xml
<dependency>
  <groupId>javax.json</groupId>
  <artifactId>javax.json-api</artifactId>
  <version>1.1.4</version>
</dependency>

<dependency>
  <groupId>org.glassfish</groupId>
  <artifactId>javax.json</artifactId>
  <version>1.1.4</version>
</dependency>
```

Atau provider Apache Johnzon.

Package:

```java
import javax.json.Json;
```

### 22.2 Java 11+

JSON-P tidak pernah menjadi bagian inti JDK seperti JAXB/JAX-WS lama. Tetap gunakan dependency eksplisit.

Untuk Jakarta:

```xml
<dependency>
  <groupId>jakarta.json</groupId>
  <artifactId>jakarta.json-api</artifactId>
  <version>2.1.3</version>
</dependency>

<dependency>
  <groupId>org.eclipse.parsson</groupId>
  <artifactId>parsson</artifactId>
  <version>1.1.7</version>
</dependency>
```

Versi bisa berubah; pin sesuai BOM Jakarta EE/server runtime Anda.

Package:

```java
import jakarta.json.Json;
```

### 22.3 Migration javax → jakarta

Perubahan utama:

```text
javax.json.* → jakarta.json.*
```

Namun migrasi nyata perlu memperhatikan:

- application server version;
- transitive dependencies;
- JAX-RS provider;
- JSON-B provider;
- test dependencies;
- fat jar shading;
- module path vs classpath;
- third-party library yang masih compile terhadap `javax.json`.

Jangan mencampur model `javax.json.JsonObject` dan `jakarta.json.JsonObject` dalam satu signature publik. Mereka type berbeda.

---

## 23. Testing Strategy

### 23.1 Unit Test untuk Pointer Escaping

Test key dengan `/` dan `~`.

```java
JsonObject doc = Json.createObjectBuilder()
    .add("a/b", 10)
    .add("x~y", 20)
    .build();

assertEquals(10, Json.createPointer("/a~1b").getValue(doc).asJsonNumber().intValue());
assertEquals(20, Json.createPointer("/x~0y").getValue(doc).asJsonNumber().intValue());
```

### 23.2 Test Patch Success

```text
given current resource
when allowed patch applied
then expected candidate JSON
and audit diff contains expected path
```

### 23.3 Test Patch Rejection

- unsupported operation;
- disallowed path;
- disallowed from path;
- too many operations;
- invalid pointer;
- missing op/path;
- replace missing path;
- remove mandatory field;
- state transition illegal;
- version mismatch;
- patch result not object.

### 23.4 Property-Based Tests

Untuk generic patch pipeline, property-based tests berguna:

```text
For any allowed patch:
  result must pass schema validation
  forbidden fields must not change
  version must not decrease
  audit must be emitted
```

### 23.5 Golden Master for Legacy Integration

Jika patch dipakai untuk transformasi payload legacy:

```text
input legacy JSON fixture
expected canonical JSON fixture
expected diff/patch fixture
```

Simpan fixture sebagai file agar perubahan contract terlihat di PR.

---

## 24. Observability for Patch APIs

Metrics yang berguna:

```text
patch_requests_total{type=json_patch|merge_patch,result=success|failed}
patch_operation_count_histogram
patch_rejected_total{reason=path_not_allowed|invalid|conflict|validation}
patch_paths_touched_total{path_group=applicant_contact}
patch_latency_ms
patch_payload_size_bytes
patch_conflict_total
```

Log aman:

```json
{
  "event": "PATCH_RESOURCE",
  "resourceType": "Application",
  "resourceId": "APP-001",
  "actorId": "user-123",
  "patchType": "json-patch",
  "operationCount": 2,
  "pathGroups": ["applicant_contact"],
  "result": "SUCCESS",
  "correlationId": "..."
}
```

Hindari log full body jika mengandung sensitive data.

---

## 25. Performance Considerations

### 25.1 Object Model Cost

JSON Patch dan Merge Patch bekerja pada object model `JsonValue`, bukan streaming event murni. Artinya dokumen target biasanya harus berada di memory.

Untuk payload kecil/menengah, ini baik.

Untuk payload sangat besar:

- pertimbangkan streaming transform;
- patch hanya subdocument;
- simpan document per section;
- gunakan database JSON operation jika cocok;
- hindari patch full huge document di application memory.

### 25.2 Patch Complexity

Biaya patch bergantung pada:

- ukuran dokumen;
- jumlah operasi;
- kedalaman path;
- array size;
- provider implementation;
- pembuatan object baru.

Untuk resource API biasa, bottleneck sering bukan JSON-P tetapi:

- DB load/save;
- validation;
- authorization;
- audit persistence;
- downstream event.

Tetap pasang limit agar worst-case terkendali.

---

## 26. Anti-Patterns

### 26.1 Generic Patch ke Entity Internal

Buruk:

```text
HTTP PATCH body → apply to entity JSON → ORM save
```

Risiko:

- privilege escalation;
- broken invariant;
- accidental overwrite;
- audit lemah;
- persistence model bocor ke API.

### 26.2 Merge Patch untuk Semua Hal

Merge Patch tidak cocok untuk:

- array granular;
- explicit set null;
- operation precondition;
- move/copy;
- high-risk workflow operation.

### 26.3 JSON Patch Tanpa Allowlist

Patch yang secara syntax valid belum tentu aman.

### 26.4 Menyimpan Patch sebagai Satu-Satunya Source of Truth

Patch adalah change representation. Untuk state saat ini, tetap simpan materialized state atau snapshot jika dibutuhkan.

Event sourcing dengan patch saja bisa sulit karena:

- patch bergantung pada shape lama;
- replay gagal jika schema berubah;
- path rename membuat history sulit;
- domain intent hilang.

### 26.5 Menganggap Diff Sama dengan Intent

Diff:

```text
/status DRAFT → SUBMITTED
```

Intent:

```text
Applicant submitted application after accepting declaration.
```

Keduanya tidak sama.

---

## 27. Practical Field Guide

### 27.1 Saat Menerima PATCH dari Client

Checklist:

```text
[ ] Content-Type tepat?
[ ] Payload size dibatasi?
[ ] Operation count dibatasi?
[ ] JSON syntax valid?
[ ] Patch structure valid?
[ ] Path/from allowlist?
[ ] Role/state-specific rule?
[ ] Current resource loaded dengan authorization?
[ ] Version/ETag cocok?
[ ] Patch applied atomically?
[ ] Candidate shape valid?
[ ] Domain invariant valid?
[ ] Sensitive field tidak bocor di error/log?
[ ] Persist dengan optimistic lock?
[ ] Audit technical + business event?
[ ] Response jelas?
```

### 27.2 Saat Membuat Internal Transformation

Checklist:

```text
[ ] Apakah transform deterministik?
[ ] Apakah transform idempotent?
[ ] Apakah raw input tetap tersedia jika perlu?
[ ] Apakah ada diff before/after?
[ ] Apakah field order/hash canonical jika dipakai audit?
[ ] Apakah gagal secara fail-fast atau best-effort?
[ ] Apakah partial failure ditangani?
```

### 27.3 Saat Memilih JSON Patch vs Merge Patch

Gunakan JSON Patch jika:

```text
- perlu array index/append;
- perlu test/precondition;
- perlu remove vs set-null eksplisit;
- perlu operation log presisi;
- client teknis mampu membuat patch operation.
```

Gunakan Merge Patch jika:

```text
- update sederhana berbentuk object;
- field absent berarti no change;
- null-as-remove cocok;
- array replacement acceptable;
- readability lebih penting daripada operation-level precision.
```

Gunakan domain command jika:

```text
- perubahan adalah business action;
- workflow/state machine terlibat;
- ada side effect;
- audit reason wajib;
- authorization kompleks;
- invariant tidak bisa diwakili path-level update.
```

---

## 28. Mini Case Study: Application Contact Update

### 28.1 Requirement

Applicant boleh mengubah contact information saat application masih `DRAFT`.

Writable fields:

```text
/applicant/email
/applicant/mobile
/applicant/address/postalCode
/applicant/address/block
/applicant/address/street
```

Tidak boleh mengubah:

```text
/status
/submittedAt
/internalReview
/riskScore
/approval
```

### 28.2 JSON Patch Request

```http
PATCH /applications/APP-001
Content-Type: application/json-patch+json
If-Match: "7"
```

```json
[
  { "op": "replace", "path": "/applicant/email", "value": "new@example.com" },
  { "op": "replace", "path": "/applicant/mobile", "value": "+6599999999" }
]
```

### 28.3 Processing

```text
1. verify authenticated applicant owns application
2. verify application state = DRAFT
3. verify If-Match = current version
4. verify ops are replace only
5. verify paths are in applicant contact allowlist
6. apply JSON Patch
7. validate email/mobile format
8. persist with version = 8
9. audit ContactInfoUpdated event
10. return 200 with updated representation or 204
```

### 28.4 Dangerous Request

```json
[
  { "op": "replace", "path": "/status", "value": "APPROVED" }
]
```

Rejected before apply.

### 28.5 Dangerous Copy

```json
[
  { "op": "copy", "from": "/internalReview/officerNote", "path": "/applicant/address/street" }
]
```

Even if target path is writable, source path is not readable. Reject.

---

## 29. Mini Case Study: Configuration Document Sync

Untuk configuration document internal, JSON Patch sangat cocok.

Before:

```json
{
  "rateLimit": {
    "enabled": true,
    "requestsPerMinute": 300
  },
  "features": {
    "newLogin": false
  }
}
```

After:

```json
{
  "rateLimit": {
    "enabled": true,
    "requestsPerMinute": 250
  },
  "features": {
    "newLogin": true
  }
}
```

Diff:

```json
[
  { "op": "replace", "path": "/rateLimit/requestsPerMinute", "value": 250 },
  { "op": "replace", "path": "/features/newLogin", "value": true }
]
```

Why good:

- config shape known;
- diff is readable;
- operation small;
- audit useful;
- rollback can be generated carefully.

Tetap perlu:

- config schema validation;
- environment guard;
- approval workflow;
- secret redaction;
- rollout plan.

---

## 30. Relationship with JSON-B and Jackson

JSON-P bekerja di JSON tree level.

JSON-B bekerja di object binding level.

Jackson bisa bekerja di tree, streaming, dan binding level.

Mental model:

```text
JSON-P:
  standard Jakarta API for JSON tree/stream/patch/pointer

JSON-B:
  standard Jakarta API for object <-> JSON mapping

Jackson:
  very powerful de facto ecosystem library with extensive features
```

Untuk partial update:

- JSON-P unggul jika Anda ingin standar JSON Pointer/Patch/Merge Patch portable;
- JSON-B unggul untuk mapping final DTO/domain representation;
- Jackson sering unggul di Spring ecosystem dan advanced polymorphic/custom mapping;
- jangan campur tanpa boundary yang jelas.

Contoh pipeline hybrid:

```text
HTTP body → JSON-P JsonPatch
current DTO → JSON-B/Jackson to JsonObject/JsonNode
apply patch
candidate JSON → DTO
Bean Validation
domain command
```

Pastikan numeric/date/null semantics tidak berubah saat pindah library.

---

## 31. Top 1% Engineering Heuristics

1. **Patch is not permission.** Patch yang valid secara syntax tetap harus melewati authorization.
2. **Path is part of public contract.** Jika Anda expose `/applicant/email`, path itu menjadi contract.
3. **Null semantics must be written down.** Jangan biarkan tim menebak.
4. **Array index is fragile.** Gunakan ID/domain endpoint untuk collection penting.
5. **Diff is not intent.** Simpan business event untuk audit domain.
6. **Generic patch is dangerous for workflow.** Approval, submission, cancellation, escalation harus command.
7. **Reject unknown writes by default.** Allowlist beats blocklist.
8. **Patch must be atomic.** Partial apply hampir selalu buruk.
9. **Validation must happen after apply too.** Path validation saja tidak cukup.
10. **Concurrency is mandatory.** PATCH tanpa ETag/version adalah lost update waiting to happen.
11. **Logs are not audit stores.** Jangan bocorkan patch body ke log.
12. **Provider portability matters.** Jangan bergantung pada detail provider jika memakai JSON-P sebagai standard layer.
13. **Use JSON-P as boundary tool, not domain brain.** Domain invariant tetap di domain/application service.

---

## 32. Ringkasan

Di bagian ini kita membangun mental model bahwa JSON transformation dan mutation adalah bagian dari contract engineering, bukan sekadar operasi data structure.

Kita telah membahas:

- JSON Pointer sebagai alamat node JSON;
- escaping pointer dengan `~0` dan `~1`;
- JSON Patch sebagai operasi presisi `add/remove/replace/move/copy/test`;
- JSON Merge Patch sebagai sparse object update dengan null-as-remove;
- perbedaan JSON Patch vs Merge Patch;
- immutable object model JSON-P;
- mutation pipeline yang aman;
- path allowlist;
- null/absent/remove semantics;
- array index fragility;
- validation, authorization, concurrency, audit;
- kapan memakai patch generic dan kapan harus memakai domain command.

Inti engineering-nya:

```text
Do not let external JSON shape mutate internal state directly.
Treat every mutation as contract + authorization + invariant + audit problem.
```

---

## 33. Latihan Mandiri

### Latihan 1 — Pointer Escaping

Buat JSON:

```json
{
  "a/b": {
    "x~y": 10
  }
}
```

Tulis JSON Pointer untuk mengambil nilai `10`.

Jawaban:

```text
/a~1b/x~0y
```

### Latihan 2 — Pilih Patch Type

Untuk setiap case, pilih JSON Patch, Merge Patch, atau domain command:

1. user mengganti email;
2. approver menyetujui application;
3. UI menghapus elemen ke-2 dari ordered list;
4. client mengirim sparse update untuk address;
5. officer menambahkan decision reason dan mengubah workflow state.

Jawaban rekomendasi:

1. Merge Patch atau JSON Patch;
2. domain command;
3. JSON Patch dengan version/test;
4. Merge Patch;
5. domain command.

### Latihan 3 — Design Allowlist

Buat rule untuk role `APPLICANT` pada state `DRAFT`:

```text
/applicant/email replace only
/applicant/mobile replace/remove
/applicant/address/* replace only
/documents/- add only
```

Tentukan apakah request berikut boleh:

```json
[
  { "op": "copy", "from": "/internalReview/note", "path": "/applicant/mobile" }
]
```

Jawaban: tidak boleh. `copy` tidak diizinkan, dan `from` path internal tidak readable.

---

## 34. Referensi Resmi dan Lanjutan

- Jakarta JSON Processing specification/API documentation — membahas API parse, generate, transform, query, object model, streaming, JSON Pointer, JSON Patch, dan JSON Merge Patch.
- RFC 6901 — JSON Pointer.
- RFC 6902 — JSON Patch.
- RFC 7396 — JSON Merge Patch.
- Jakarta JSON Processing API docs untuk `JsonPointer`, `JsonPatch`, `JsonPatchBuilder`, dan `JsonMergePatch`.

---

## 35. Status Seri

Seri belum selesai.

Bagian ini adalah:

```text
Part 005 / 034 — JSON-P Transformation & Mutation
```

Bagian berikutnya:

```text
Part 006 / 034 — JSON-P Advanced Production Patterns
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration-part-004](./learn-java-json-xml-soap-connectors-enterprise-integration-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 6](./learn-java-json-xml-soap-connectors-enterprise-integration-part-006.md)
