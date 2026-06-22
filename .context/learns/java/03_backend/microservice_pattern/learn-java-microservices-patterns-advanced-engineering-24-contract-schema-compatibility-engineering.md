# learn-java-microservices-patterns-advanced-engineering-24-contract-schema-compatibility-engineering

# Part 24 — Contract, Schema, and Compatibility Engineering

> Seri: **Java Microservices Patterns — Advanced Engineering**  
> Status: **Part 24 dari 35**  
> Target: Java 8 hingga Java 25  
> Fokus: contract, schema, compatibility, evolution, governance, dan safe change dalam microservices Java.

---

## 0. Tujuan Part Ini

Part ini membahas salah satu kemampuan paling penting dalam microservices production: **mengubah sistem tanpa merusak sistem lain**.

Dalam monolith, perubahan interface antar modul sering terlihat cepat karena compile-time feedback membantu menemukan caller yang rusak. Dalam microservices, service lain bisa:

- berada di repository berbeda,
- dikelola team berbeda,
- deploy di waktu berbeda,
- memakai versi client lama,
- consume event secara asynchronous,
- berada di environment berbeda,
- memiliki SLA dan lifecycle release sendiri.

Karena itu, contract engineering adalah disiplin untuk memastikan perubahan API, event, message, schema, error, enum, behavior, dan semantic tetap aman terhadap consumer yang sudah ada.

Setelah mempelajari part ini, kamu diharapkan mampu:

1. Membedakan **API contract**, **event contract**, **schema contract**, **semantic contract**, dan **operational contract**.
2. Menentukan apakah perubahan contract bersifat backward-compatible, forward-compatible, atau breaking.
3. Mendesain DTO, JSON, Avro/Protobuf, event envelope, error response, dan enum agar bisa berevolusi.
4. Menerapkan prinsip **tolerant reader** dan **strict writer**.
5. Mendesain versioning strategy untuk HTTP API dan asynchronous event.
6. Mengelola deprecation, sunset, dan migration window.
7. Membuat governance agar service autonomy tidak berubah menjadi contract chaos.
8. Memahami implikasi Java 8–25 terhadap DTO modeling, records, sealed classes, pattern matching, serialization, dan compatibility.

---

## 1. Masalah Nyata yang Ingin Diselesaikan

Microservices gagal bukan hanya karena service down. Banyak kegagalan terjadi karena **service berubah dengan cara yang tidak dipahami consumer**.

Contoh nyata:

1. Provider menghapus field `statusDescription` karena dianggap tidak dipakai.
2. Consumer lama masih membaca field tersebut untuk tampilan UI.
3. Deployment provider sukses.
4. Test provider sukses.
5. Consumer tidak ikut deploy.
6. UI production rusak.

Atau:

1. Event `ApplicationApproved` menambah enum value `APPROVED_WITH_CONDITION`.
2. Consumer lama memakai `switch(status)` tanpa default handling.
3. Consumer crash ketika menerima value baru.
4. Message terus retry.
5. Consumer lag naik.
6. DLQ penuh.
7. Projection menjadi stale.

Atau:

1. API error response berubah dari:

```json
{
  "code": "APPLICATION_NOT_FOUND",
  "message": "Application not found"
}
```

menjadi:

```json
{
  "errorCode": "APPLICATION_NOT_FOUND",
  "detail": "Application not found"
}
```

2. Consumer tidak bisa lagi mapping error.
3. Retry logic salah menganggap error sebagai transient.
4. Traffic meningkat.
5. Provider overload.

Masalah utamanya bukan sekadar format. Masalahnya adalah **kepercayaan antar service rusak**.

---

## 2. Mental Model: Contract Adalah Boundary yang Bisa Diuji

Dalam microservices, contract adalah bentuk eksplisit dari janji antar service.

```text
Provider service
    |
    | publishes contract
    v
Consumer service
    |
    | builds assumption
    v
Runtime dependency
```

Contract bukan hanya OpenAPI file. Contract adalah gabungan dari:

```text
shape + semantics + timing + failure + compatibility + ownership
```

Artinya, consumer tidak hanya peduli field ada atau tidak. Consumer juga peduli:

- field itu artinya apa,
- kapan field muncul,
- apakah field nullable,
- apakah enum bisa bertambah,
- status code apa untuk error tertentu,
- apakah request idempotent,
- apakah response bisa partial,
- apakah event bisa duplicate,
- apakah event bisa out-of-order,
- apakah schema bisa bertambah field,
- apakah provider akan mempertahankan field lama selama migration window.

Top 1% engineer melihat contract bukan sebagai dokumentasi, tetapi sebagai **runtime safety mechanism**.

---

## 3. Vocabulary Dasar

### 3.1 Provider

Service yang menyediakan API, event, message, file, projection, atau schema.

Contoh:

```text
Application Service exposes GET /applications/{id}
```

### 3.2 Consumer

Service, UI, job, report, workflow, atau external system yang memakai contract provider.

Contoh:

```text
Case Service calls Application Service to fetch application summary
```

### 3.3 Contract

Kesepakatan eksplisit tentang bagaimana provider dan consumer berinteraksi.

Contract bisa berupa:

- OpenAPI specification,
- AsyncAPI specification,
- Avro schema,
- Protobuf schema,
- JSON Schema,
- Pact contract,
- Java interface internal,
- database view contract,
- CSV/file format,
- event catalog entry,
- written ADR.

### 3.4 Schema

Struktur data yang dipertukarkan.

Contoh:

```json
{
  "applicationId": "APP-001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-19T09:15:00Z"
}
```

### 3.5 Semantic

Makna dari data dan behavior.

Contoh:

```text
SUBMITTED means the applicant has completed mandatory fields and the application is waiting for officer review.
```

Tanpa semantic, schema hanya bentuk kosong.

### 3.6 Compatibility

Kemampuan contract berubah tanpa mematahkan consumer atau provider lain.

Compatibility selalu relatif terhadap arah komunikasi:

- provider berubah, consumer lama masih jalan,
- consumer berubah, provider lama masih jalan,
- event producer berubah, event consumer lama masih jalan,
- event consumer baru bisa membaca event lama dari replay.

---

## 4. Jenis Contract dalam Microservices

## 4.1 API Contract

API contract mendefinisikan HTTP/gRPC interface.

Contoh API contract:

```yaml
GET /applications/{applicationId}
Response 200:
  applicationId: string
  status: string
  applicantName: string
  submittedAt: string date-time
Response 404:
  code: APPLICATION_NOT_FOUND
```

API contract mencakup:

- path,
- method,
- query parameter,
- header,
- request body,
- response body,
- status code,
- error model,
- authentication,
- authorization expectation,
- idempotency,
- pagination,
- rate limit,
- timeout expectation,
- compatibility policy.

### Common mistake

Menganggap API contract hanya request/response JSON.

Padahal status code, header, rate limit, error semantics, dan pagination behavior adalah bagian dari contract.

---

## 4.2 Event Contract

Event contract mendefinisikan fakta yang dipublish oleh producer.

Contoh:

```json
{
  "eventId": "evt-001",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 2,
  "occurredAt": "2026-06-19T09:15:00Z",
  "producer": "application-service",
  "data": {
    "applicationId": "APP-001",
    "applicantId": "APPLICANT-001",
    "submissionChannel": "INTERNET"
  }
}
```

Event contract mencakup:

- event type,
- event version,
- envelope,
- payload,
- ordering expectation,
- duplicate expectation,
- replay expectation,
- retention,
- partition key,
- schema evolution rule,
- semantic meaning,
- consumer responsibility.

### Common mistake

Menganggap event contract cukup dengan topic name dan JSON sample.

Padahal consumer perlu tahu:

- apakah event bisa duplicate,
- apakah event bisa datang terlambat,
- apakah event membawa full state atau delta,
- apakah field boleh hilang,
- apakah event boleh direplay,
- apakah consumer boleh menjadikan event sebagai audit fact.

---

## 4.3 Schema Contract

Schema contract mendefinisikan struktur data formal.

Bentuk umum:

- JSON Schema,
- Avro,
- Protobuf,
- XML Schema,
- OpenAPI schema section,
- database table/view schema,
- CSV schema.

Schema contract menjawab:

- field apa yang ada,
- tipe field apa,
- field mana required,
- field mana optional,
- apakah field nullable,
- default value apa,
- enum value apa,
- nested structure bagaimana,
- apakah unknown field boleh diabaikan.

---

## 4.4 Semantic Contract

Semantic contract menjelaskan makna.

Contoh schema:

```json
{
  "status": "APPROVED"
}
```

Semantic contract:

```text
APPROVED means all required review steps have passed, no pending mandatory clarification exists, and the application can proceed to license issuance unless a later compliance hold is created.
```

Tanpa semantic, consumer bisa salah menggunakan field.

Misalnya consumer menganggap `APPROVED` berarti license sudah issued, padahal license issuance masih step berbeda.

### Semantic contract biasanya mencakup:

- lifecycle meaning,
- business rule meaning,
- temporal meaning,
- authority meaning,
- legal meaning,
- audit meaning,
- allowed consumer interpretation.

---

## 4.5 Operational Contract

Operational contract menjelaskan behavior non-functional.

Contoh:

```text
GET /applications/{id}
P95 latency target: < 300 ms
Timeout recommendation: 1 second
Rate limit: 100 requests/minute/client
Error 429 means consumer must back off
Error 503 means provider temporarily unavailable
Response may be stale by up to 30 seconds
```

Operational contract sering diabaikan, padahal banyak production incident terjadi karena consumer tidak tahu cara memperlakukan error, timeout, latency, atau throttling.

---

## 4.6 Compatibility Contract

Compatibility contract menjelaskan aturan perubahan.

Contoh:

```text
For public API v1:
- fields may be added,
- existing fields will not be removed during support window,
- enum values may be added,
- consumers must ignore unknown fields,
- deprecated fields will be supported for at least 6 months,
- breaking changes require new major version.
```

Compatibility contract membuat evolusi bisa diprediksi.

---

## 5. Compatibility Direction

Compatibility tidak bisa dibahas tanpa arah.

## 5.1 Backward Compatibility

Perubahan baru tetap bisa digunakan oleh consumer lama.

Contoh:

Provider menambah optional field:

```json
{
  "applicationId": "APP-001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-19T09:15:00Z",
  "submissionChannel": "INTERNET"
}
```

Consumer lama yang hanya membaca `applicationId`, `status`, dan `submittedAt` tetap aman jika mengabaikan unknown field.

Backward compatibility penting ketika:

- provider deploy lebih dulu,
- consumer tidak bisa langsung update,
- event producer publish schema baru,
- consumer lama masih aktif.

---

## 5.2 Forward Compatibility

Consumer baru bisa tetap bekerja dengan provider/data lama.

Contoh:

Consumer baru memahami field `submissionChannel`, tetapi event lama tidak punya field tersebut.

Consumer baru harus bisa melakukan:

```java
String channel = event.submissionChannel() != null
        ? event.submissionChannel()
        : "UNKNOWN";
```

Forward compatibility penting untuk:

- replay event lama,
- rolling deployment,
- blue/green deployment,
- mixed version clusters,
- data migration.

---

## 5.3 Full Compatibility

Backward dan forward compatible sekaligus.

Ini ideal untuk event stream yang bisa direplay karena consumer baru harus membaca event lama, dan consumer lama harus bisa mengabaikan event baru.

---

## 5.4 Breaking Change

Breaking change adalah perubahan yang bisa mematahkan consumer existing.

Contoh:

- remove field,
- rename field,
- change field type,
- change meaning,
- make optional field required,
- change enum semantics,
- remove endpoint,
- change status code semantics,
- change pagination behavior,
- change default sorting,
- change idempotency behavior,
- change event type meaning,
- move data authority tanpa migration path.

Breaking change bukan selalu dilarang, tetapi harus dikelola sebagai migration program.

---

## 6. Contract Change Classification

Gunakan klasifikasi berikut saat review perubahan.

| Change | Bias Awal | Risiko |
|---|---:|---|
| Add optional response field | Usually safe | Consumer strict parser bisa gagal |
| Add required request field | Breaking | Consumer lama tidak mengirim field |
| Remove response field | Breaking | Consumer lama bisa membutuhkan field |
| Rename field | Breaking | Sama seperti remove + add |
| Change field type string ke number | Breaking | Deserialization failure |
| Narrow value range | Potentially breaking | Consumer mengirim value lama |
| Expand enum | Potentially breaking | Consumer switch exhaustive gagal |
| Add enum value with old semantic unchanged | Safer but still risky | Consumer tidak punya fallback |
| Change meaning of existing enum | Breaking semantic | Paling berbahaya karena tidak selalu terdeteksi test |
| Add endpoint | Safe | Bisa menambah governance/cost |
| Remove endpoint | Breaking | Consumer existing gagal |
| Change 404 to 200 empty object | Breaking semantic | Consumer error handling berubah |
| Add new event type | Usually safe | Consumer wildcard bisa gagal |
| Change event payload field requiredness | Risky | Replay dan consumer lama terdampak |
| Add optional event field with default | Usually safe | Schema compatibility tergantung format |
| Remove event field | Breaking | Projection bisa gagal |
| Change partition key | Breaking operational | Ordering dan dedup bisa rusak |
| Change topic name | Breaking | Consumer tidak menerima event |
| Change retention | Breaking operational | Replay capability berubah |

Top-tier review tidak berhenti di “schema diff”. Ia bertanya: **asumsi consumer apa yang mungkin berubah?**

---

## 7. Tolerant Reader Pattern

Tolerant reader berarti consumer hanya membaca data yang dibutuhkan dan toleran terhadap field tambahan.

### 7.1 Prinsip

Consumer harus:

- ignore unknown fields,
- tolerate missing optional fields,
- handle unknown enum values,
- not depend on field ordering,
- not depend on undocumented fields,
- not parse human-readable message as machine contract,
- not assume array ordering unless specified.

### 7.2 Java Jackson Example

```java
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public final class ApplicationSummaryResponse {
    private String applicationId;
    private String status;
    private String submittedAt;

    public String getApplicationId() {
        return applicationId;
    }

    public void setApplicationId(String applicationId) {
        this.applicationId = applicationId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getSubmittedAt() {
        return submittedAt;
    }

    public void setSubmittedAt(String submittedAt) {
        this.submittedAt = submittedAt;
    }
}
```

Untuk Java 16+ record:

```java
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ApplicationSummaryResponse(
        String applicationId,
        String status,
        String submittedAt
) {
}
```

### 7.3 Anti-pattern

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Ini bisa berguna untuk internal strict test, tetapi berbahaya untuk public consumer terhadap provider yang boleh menambah field.

---

## 8. Strict Writer Pattern

Strict writer berarti provider hanya menulis field yang valid, terdokumentasi, dan sesuai contract.

Provider tidak boleh:

- mengirim field debug internal,
- membocorkan entity persistence,
- mengirim enum internal yang tidak stabil,
- mengirim nullable tanpa didokumentasikan,
- mengubah format tanggal diam-diam,
- mengirim value tidak sesuai schema,
- menambah field dengan semantic belum matang.

### 8.1 DTO Boundary

Buruk:

```java
@GetMapping("/applications/{id}")
public ApplicationEntity getApplication(@PathVariable String id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- persistence entity bocor,
- lazy field bisa muncul/hilang,
- field internal bisa exposed,
- perubahan DB bisa jadi breaking API,
- semantic tidak eksplisit.

Lebih baik:

```java
@GetMapping("/applications/{id}")
public ApplicationSummaryResponse getApplication(@PathVariable String id) {
    Application application = applicationService.getApplication(id);
    return new ApplicationSummaryResponse(
            application.id().value(),
            application.status().externalCode(),
            application.submittedAt().toString()
    );
}
```

Strict writer membuat provider sadar bahwa output adalah public contract.

---

## 9. Schema Evolution Rules

## 9.1 JSON Schema / OpenAPI Evolution

Umumnya aman:

- tambah optional response field,
- tambah optional request field dengan default behavior,
- tambah endpoint baru,
- tambah error code baru jika consumer punya fallback,
- relax validation secara hati-hati.

Umumnya breaking:

- hapus field,
- rename field,
- ubah type,
- ubah requiredness optional menjadi required,
- ubah format date/time,
- ubah enum value tanpa fallback,
- ubah semantic field existing.

### OpenAPI Example

```yaml
components:
  schemas:
    ApplicationSummary:
      type: object
      required:
        - applicationId
        - status
        - submittedAt
      properties:
        applicationId:
          type: string
        status:
          type: string
          description: Stable external lifecycle status code.
        submittedAt:
          type: string
          format: date-time
        submissionChannel:
          type: string
          nullable: true
          description: Optional. May be absent for historical records.
```

Catatan penting:

```text
Optional does not mean meaningless.
Nullable does not mean absent.
Absent does not mean null.
Default does not mean unknown.
```

---

## 9.2 Avro Evolution

Avro sering dipakai untuk event/message schema.

Perubahan yang biasanya lebih aman:

- tambah field dengan default value,
- hapus field yang tidak dibutuhkan reader,
- gunakan union dengan null untuk optional,
- mempertahankan nama dan type field lama.

Contoh:

```json
{
  "type": "record",
  "name": "ApplicationSubmitted",
  "namespace": "com.example.application.events",
  "fields": [
    { "name": "applicationId", "type": "string" },
    { "name": "applicantId", "type": "string" },
    { "name": "submittedAt", "type": "string" },
    {
      "name": "submissionChannel",
      "type": ["null", "string"],
      "default": null
    }
  ]
}
```

Key idea:

```text
New reader must read old data.
Old reader must read new data.
```

---

## 9.3 Protobuf Evolution

Protobuf punya aturan penting:

- jangan reuse field number,
- jangan hapus field tanpa reserve number/name,
- tambah field baru dengan number baru,
- hati-hati dengan required field di proto2,
- enum harus punya default/unknown handling,
- jangan ubah field type sembarangan.

Contoh:

```proto
syntax = "proto3";

message ApplicationSubmitted {
  string application_id = 1;
  string applicant_id = 2;
  string submitted_at = 3;
  string submission_channel = 4;

  reserved 5, 6;
  reserved "old_status_description";
}
```

Field number adalah bagian dari wire contract.

---

## 9.4 XML Schema Evolution

XML masih banyak di enterprise/regulatory integration.

Risiko umum:

- namespace berubah,
- element ordering berubah,
- required element ditambah,
- schema validation ketat,
- date format tidak stabil,
- extension point tidak tersedia.

Strategi:

- version namespace dengan hati-hati,
- pakai optional element untuk field baru,
- sediakan extension element jika perlu,
- pisahkan machine code dari human description,
- dokumentasikan deprecation.

---

## 10. Enum Evolution Problem

Enum adalah salah satu sumber breaking change paling licik.

Contoh:

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Lalu provider menambahkan:

```java
APPROVED_WITH_CONDITION
```

Consumer lama:

```java
switch (status) {
    case DRAFT -> showDraft();
    case SUBMITTED -> showPending();
    case APPROVED -> showApproved();
    case REJECTED -> showRejected();
}
```

Jika tidak ada fallback, consumer bisa gagal compile saat update atau gagal runtime saat deserialize.

## 10.1 External Enum Harus Dianggap Open Set

Untuk contract antar service, enum sebaiknya dianggap bisa bertambah.

Consumer harus punya fallback:

```java
public enum ExternalApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    UNKNOWN;

    public static ExternalApplicationStatus from(String raw) {
        if (raw == null || raw.isBlank()) {
            return UNKNOWN;
        }
        try {
            return ExternalApplicationStatus.valueOf(raw);
        } catch (IllegalArgumentException ex) {
            return UNKNOWN;
        }
    }
}
```

## 10.2 Jangan Pakai Enum Internal sebagai Contract

Buruk:

```java
public enum InternalWorkflowState {
    DRAFT,
    SUBMITTED,
    SCREENING_PENDING,
    SCREENING_RETRY_WAIT,
    OFFICER_REVIEW_LEVEL_1,
    OFFICER_REVIEW_LEVEL_2,
    LEGAL_REVIEW,
    PAYMENT_PENDING,
    PAYMENT_RECONCILIATION_PENDING,
    APPROVED,
    REJECTED
}
```

Jika enum ini exposed ke external consumer, setiap refactor internal menjadi breaking change.

Lebih baik:

```java
public enum ExternalApplicationStatus {
    DRAFT,
    IN_PROGRESS,
    PENDING_APPLICANT_ACTION,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Internal state boleh detail. External status harus stabil.

---

## 11. Error Contract Engineering

Error response adalah contract. Jangan perlakukan error sebagai afterthought.

## 11.1 Bad Error Contract

```json
{
  "message": "Something went wrong"
}
```

Masalah:

- tidak machine-readable,
- tidak bisa menentukan retry,
- tidak ada correlation id,
- tidak ada error category,
- sulit observability.

## 11.2 Better Error Contract

```json
{
  "errorId": "err-01HX123",
  "code": "APPLICATION_NOT_FOUND",
  "category": "NOT_FOUND",
  "message": "Application was not found.",
  "retryable": false,
  "correlationId": "corr-abc",
  "details": [
    {
      "field": "applicationId",
      "reason": "No application exists for the given identifier."
    }
  ]
}
```

## 11.3 Error Contract Must Specify

- stable error code,
- HTTP status mapping,
- retryable or not,
- user-facing vs internal message,
- validation details,
- correlation id,
- documentation link if useful,
- security redaction rule,
- deprecation policy for error codes.

## 11.4 Error Compatibility

Breaking changes:

- rename error code,
- change retryable behavior,
- change 409 to 500,
- remove validation details,
- change machine-readable code into human text,
- leak internal exception class.

Safe changes:

- add optional detail field,
- add new error code with documented fallback category,
- improve human-readable message without changing code.

---

## 12. HTTP API Versioning Strategy

There is no universally perfect API versioning strategy. Pilihan bergantung pada consumer, lifecycle, gateway, caching, dan governance.

## 12.1 URI Versioning

```text
/api/v1/applications/{id}
/api/v2/applications/{id}
```

Kelebihan:

- eksplisit,
- mudah routing,
- mudah dokumentasi,
- mudah coexist.

Kekurangan:

- bisa mendorong major version explosion,
- consumer harus migrasi endpoint,
- v1/v2 duplication risk.

## 12.2 Header Versioning

```http
GET /applications/APP-001
Accept: application/vnd.company.application.v2+json
```

Kelebihan:

- resource URI stabil,
- cocok untuk media type versioning.

Kekurangan:

- lebih sulit debug manual,
- tooling/gateway kadang lebih kompleks,
- cache behavior harus hati-hati.

## 12.3 Query Parameter Versioning

```text
/applications/APP-001?version=2
```

Biasanya kurang ideal untuk public API yang serius, tetapi kadang dipakai untuk internal migration atau feature preview.

## 12.4 No Version Unless Breaking

Strategi yang sering lebih matang:

```text
Maintain compatibility by default.
Only introduce new major version for unavoidable breaking changes.
```

Artinya, jangan membuat `/v2` hanya karena menambah field optional.

---

## 13. Event Versioning Strategy

Event versioning lebih sulit daripada API versioning karena event bisa tersimpan lama dan direplay.

## 13.1 Event Type Versioning

```text
ApplicationSubmittedV1
ApplicationSubmittedV2
```

Kelebihan:

- sangat eksplisit,
- consumer bisa subscribe tipe berbeda.

Kekurangan:

- event type explosion,
- producer publish multiple type,
- consumer migration lebih berat.

## 13.2 Schema Version in Envelope

```json
{
  "eventType": "ApplicationSubmitted",
  "eventVersion": 2,
  "data": {}
}
```

Kelebihan:

- event type stabil,
- version bisa dipakai routing internal.

Kekurangan:

- consumer harus handle version branching,
- schema registry tetap dibutuhkan untuk enforcement.

## 13.3 Subject-Based Schema Versioning

Dengan schema registry, schema punya subject dan version.

Contoh conceptual:

```text
Subject: application.ApplicationSubmitted-value
Version: 1, 2, 3
Compatibility: BACKWARD_TRANSITIVE
```

Ini cocok untuk Kafka/Avro/Protobuf/JSON Schema style.

## 13.4 Golden Rule Event Versioning

Untuk event stream yang direplay:

```text
Consumer baru harus bisa membaca event lama.
Consumer lama sebaiknya tidak rusak karena event baru.
```

---

## 14. Semantic Versioning for Contracts

Semantic versioning bisa membantu, tetapi tidak cukup.

Contoh:

```text
1.4.2
MAJOR.MINOR.PATCH
```

Interpretasi contract:

- MAJOR: breaking change,
- MINOR: backward-compatible feature/addition,
- PATCH: clarification/bugfix/non-breaking correction.

Namun hati-hati:

```text
A schema-compatible change can still be semantically breaking.
```

Contoh:

```text
Field status tetap string.
Value APPROVED tetap ada.
Tapi meaning APPROVED berubah dari "approved for issuance" menjadi "approved for payment review".
```

Schema diff tidak mendeteksi ini. Consumer behavior bisa rusak.

---

## 15. Deprecation and Sunset Engineering

Deprecation bukan sekadar menulis `@Deprecated`.

Deprecation harus menjawab:

- apa yang deprecated,
- kenapa deprecated,
- penggantinya apa,
- siapa consumer yang terdampak,
- kapan terakhir didukung,
- bagaimana migration dilakukan,
- bagaimana monitoring usage dilakukan,
- siapa owner cutover,
- apa rollback plan.

## 15.1 Deprecation Lifecycle

```text
Active
  ↓
Deprecated but supported
  ↓
Migration window
  ↓
Frozen
  ↓
Disabled for test/sandbox
  ↓
Removed from production
```

## 15.2 Deprecation Notice Example

```text
Field: statusDescription
Status: Deprecated
Replacement: statusDisplayName
Deprecated since: 2026-06-19
Minimum support until: 2026-12-19
Reason: statusDescription was locale-specific and ambiguous.
Consumer action: use statusDisplayName and locale parameter.
```

## 15.3 Usage Tracking

Provider harus tahu siapa yang masih memakai contract lama.

Cara:

- API gateway logs,
- consumer id header,
- client id from token,
- schema registry consumer metadata,
- event consumer lag/offset,
- dashboard per version,
- deprecation warning header.

Example HTTP header:

```http
Deprecation: true
Sunset: Sat, 19 Dec 2026 00:00:00 GMT
Link: <https://developer.example.com/migration/status-description>; rel="deprecation"
```

---

## 16. Consumer-Driven Contract Testing

Provider test sering tidak cukup karena provider tidak tahu semua consumer assumption.

Consumer-driven contract testing membalik perspektif:

```text
Consumer defines expectation.
Provider verifies it can satisfy expectation.
```

## 16.1 Flow

```text
Consumer test
  ↓
Contract generated
  ↓
Contract published to broker/repository
  ↓
Provider verifies contract
  ↓
Provider deploy allowed only if verification passes
```

## 16.2 What It Catches

- field missing,
- wrong status code,
- wrong error body,
- incompatible DTO,
- changed path,
- changed required field,
- changed response structure.

## 16.3 What It Does Not Fully Catch

- performance regression,
- semantic meaning changes,
- security authorization changes,
- data freshness changes,
- rare edge cases not expressed by consumer,
- event ordering assumptions,
- production-only configuration behavior.

Contract testing is necessary, not sufficient.

---

## 17. Provider-Driven Contract Testing

Provider-driven testing starts from provider's published spec.

Example:

- OpenAPI validation,
- generated server stubs,
- generated client tests,
- schema validation tests,
- backward compatibility diff check.

This is useful when:

- API is public,
- consumer set is unknown,
- team wants governance-first approach,
- generated SDK is distributed.

Risk:

```text
A provider spec can be valid but still not reflect real consumer assumptions.
```

Best practice:

```text
Use both provider contract validation and consumer-driven contract verification.
```

---

## 18. Contract Diffing

Every contract change should be diffed.

## 18.1 OpenAPI Diff Examples

Detect:

- endpoint removed,
- required field added,
- response property removed,
- schema type changed,
- enum value removed,
- response status removed,
- parameter requiredness changed.

## 18.2 Event Schema Diff Examples

Detect:

- field removed,
- required field added,
- default removed,
- type changed,
- enum changed,
- namespace changed,
- subject compatibility violated.

## 18.3 Semantic Diff

Harder. Requires human review.

Questions:

- Did meaning of existing field change?
- Did business lifecycle change?
- Did authority source change?
- Did stale data tolerance change?
- Did retry semantics change?
- Did idempotency behavior change?
- Did security visibility change?

---

## 19. Contract Governance Model

Microservices need autonomy, but not chaos.

Governance should not require central approval for every field addition. Governance should define safe lanes.

## 19.1 Golden Path

Provide standard templates for:

- OpenAPI spec,
- AsyncAPI spec,
- event envelope,
- error response,
- pagination,
- idempotency key,
- correlation headers,
- schema compatibility mode,
- deprecation metadata,
- contract tests,
- CI check.

## 19.2 Governance Levels

### Level 1 — Local Team Review

For safe additive changes.

### Level 2 — Consumer Impact Review

For changes affecting known consumers.

### Level 3 — Architecture Review

For cross-boundary semantic changes.

### Level 4 — Migration Program

For breaking changes, data authority movement, regulatory meaning changes.

---

## 20. API Contract Design Rules

## 20.1 Stable External Names

Avoid exposing internal names.

Buruk:

```json
{
  "wrkflwStsCd": "L2_REV_PEND"
}
```

Lebih baik:

```json
{
  "status": "PENDING_REVIEW"
}
```

## 20.2 Avoid Boolean Trap

Buruk:

```json
{
  "approved": true
}
```

Masalah:

- apa bedanya approved, issued, active?
- bagaimana conditional approval?
- bagaimana revoked?

Lebih baik:

```json
{
  "decisionStatus": "APPROVED",
  "licenseStatus": "PENDING_ISSUANCE"
}
```

## 20.3 Separate Code from Display Text

Buruk:

```json
{
  "status": "Approved by senior officer"
}
```

Lebih baik:

```json
{
  "statusCode": "APPROVED",
  "statusDisplayName": "Approved"
}
```

Machine reads code. Human reads display.

## 20.4 Date/Time Format Must Be Explicit

Prefer ISO-8601 with timezone/offset.

```json
{
  "submittedAt": "2026-06-19T09:15:00Z"
}
```

Avoid ambiguous:

```json
{
  "submittedAt": "19/06/2026 09:15"
}
```

## 20.5 Monetary and Decimal Values

Avoid floating point for money.

```json
{
  "amount": "123.45",
  "currency": "SGD"
}
```

Or integer minor unit:

```json
{
  "amountMinor": 12345,
  "currency": "SGD"
}
```

## 20.6 Pagination Contract

Specify:

- cursor or offset,
- stable sorting,
- max page size,
- default page size,
- total count behavior,
- consistency guarantee,
- duplicate/missing item risk during concurrent updates.

Example:

```json
{
  "items": [],
  "nextCursor": "eyJpZCI6IkFQUC0wMDEifQ==",
  "hasNext": true
}
```

---

## 21. Event Contract Design Rules

## 21.1 Event Name Must Be Past Tense Fact

Good:

```text
ApplicationSubmitted
ApplicationApproved
PaymentReceived
OfficerAssigned
```

Bad:

```text
SubmitApplication
ApproveApplication
ProcessPayment
AssignOfficer
```

Those are commands, not events.

## 21.2 Include Stable Identity

Event payload should include identifiers needed by consumers.

```json
{
  "applicationId": "APP-001",
  "applicantId": "APL-001"
}
```

## 21.3 Be Clear: Full State or Delta?

Event-carried state transfer:

```json
{
  "applicationId": "APP-001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-19T09:15:00Z",
  "submissionChannel": "INTERNET"
}
```

Delta event:

```json
{
  "applicationId": "APP-001",
  "changedFields": ["status"],
  "oldStatus": "DRAFT",
  "newStatus": "SUBMITTED"
}
```

Both are valid, but contract must say which one it is.

## 21.4 Partition Key Is Contract

If consumers depend on per-application ordering, partition key matters.

```text
partitionKey = applicationId
```

Changing it can break ordering.

## 21.5 Replay Safety

Event contract must state whether events are replayable.

If replayable:

- consumers must be idempotent,
- event schema must remain readable,
- event meaning must remain stable,
- event retention must be sufficient,
- consumer must distinguish live vs replay if needed.

---

## 22. Compatibility in Rolling Deployment

Rolling deployment creates mixed versions.

```text
Provider v1 instances still running
Provider v2 instances starting
Consumer v1 still calling
Consumer v2 starting later
```

A safe change must survive this state.

## 22.1 Expand-Contract Pattern

For breaking field migration:

### Step 1 — Expand

Provider supports both old and new field.

```json
{
  "statusDescription": "Approved",
  "statusDisplayName": "Approved"
}
```

### Step 2 — Migrate Consumers

Consumers switch to new field.

### Step 3 — Observe

Provider verifies old field no longer used.

### Step 4 — Contract

Provider removes old field after support window.

This is safer than direct replacement.

---

## 23. Compatibility in Database Migration

API compatibility often depends on database compatibility.

Example migration:

```text
Old column: status_description
New column: status_display_name
```

Safe sequence:

```text
1. Add new nullable column.
2. Write both old and new columns.
3. Backfill new column.
4. Read from new column with fallback to old.
5. Deploy consumers.
6. Stop reading old column.
7. Stop writing old column.
8. Drop old column after observation window.
```

This mirrors API expand-contract.

---

## 24. Compatibility in Messaging

Messaging adds complications:

- messages can remain in queue,
- events can be replayed months later,
- consumers can lag,
- DLQ can contain old schema,
- producer and consumer deploy independently.

## 24.1 Safe Event Field Addition

Add field with default or optional semantics.

```json
{
  "name": "submissionChannel",
  "type": ["null", "string"],
  "default": null
}
```

Consumer handling:

```java
String channel = event.submissionChannel() == null
        ? "UNKNOWN"
        : event.submissionChannel();
```

## 24.2 Unsafe Event Change

Changing meaning:

```text
ApplicationApproved now means payment approved, not officer approved.
```

Even if schema unchanged, this is breaking.

Better:

```text
OfficerApproved
PaymentApproved
ApplicationReadyForIssuance
```

---

## 25. Contract and Authorization Compatibility

Authorization change can be a breaking change.

Example:

```text
GET /applications/{id}
Previously accessible to OFFICER.
Now requires SENIOR_OFFICER.
```

Schema did not change, but consumer flow breaks.

Contract should specify:

- required role/scope/permission,
- tenant rule,
- object-level authorization behavior,
- error response for unauthorized vs not found,
- whether data redaction can occur,
- whether partial fields are hidden.

### Field-Level Authorization

Example:

```json
{
  "applicationId": "APP-001",
  "status": "SUBMITTED",
  "applicantName": "REDACTED"
}
```

This must be contractually defined. Otherwise consumers may treat redacted value as real value.

---

## 26. Contract and Data Privacy

Never assume adding a field is safe just because it is optional.

Adding field can expose:

- PII,
- sensitive business data,
- tenant data,
- internal notes,
- enforcement decision,
- identity attributes,
- audit metadata.

Contract review should ask:

```text
Who can see this field?
Which tenant can see this field?
Can this field be logged?
Can this field be cached?
Can this field be exported?
Does this field appear in event streams?
Is it subject to retention/deletion?
```

---

## 27. Contract and Observability

Contract should define observability metadata.

For HTTP:

```http
X-Correlation-Id: corr-123
X-Request-Id: req-456
Traceparent: 00-...
```

For events:

```json
{
  "eventId": "evt-001",
  "correlationId": "corr-123",
  "causationId": "cmd-789",
  "traceId": "trace-abc"
}
```

Observability metadata is not optional decoration. It is necessary for incident analysis.

---

## 28. Java 8–25 Considerations

## 28.1 Java 8

Java 8 constraints:

- no records,
- no sealed classes,
- no pattern matching,
- DTOs are usually POJO,
- more boilerplate,
- `Optional` should not be blindly used in DTO fields,
- date/time API available through `java.time`, good enough for contract date modeling.

DTO style:

```java
public final class ApplicationSummaryDto {
    private final String applicationId;
    private final String status;
    private final Instant submittedAt;

    public ApplicationSummaryDto(String applicationId, String status, Instant submittedAt) {
        this.applicationId = Objects.requireNonNull(applicationId, "applicationId");
        this.status = Objects.requireNonNull(status, "status");
        this.submittedAt = Objects.requireNonNull(submittedAt, "submittedAt");
    }

    public String getApplicationId() {
        return applicationId;
    }

    public String getStatus() {
        return status;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }
}
```

## 28.2 Java 11

Java 11 gives stable long-term baseline and modern HTTP client.

Useful for:

- generated clients,
- contract verification tooling,
- HTTP-based schema registry calls,
- simple integration tests.

## 28.3 Java 17

Java 17 brings records and sealed classes as stable language tools.

Record DTO:

```java
public record ApplicationSummaryDto(
        String applicationId,
        String status,
        Instant submittedAt
) {
    public ApplicationSummaryDto {
        Objects.requireNonNull(applicationId, "applicationId");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(submittedAt, "submittedAt");
    }
}
```

Sealed interface for internal domain result:

```java
public sealed interface SubmitApplicationResult
        permits SubmitApplicationResult.Accepted,
                SubmitApplicationResult.Duplicate,
                SubmitApplicationResult.Rejected {

    record Accepted(String applicationId) implements SubmitApplicationResult {}

    record Duplicate(String applicationId) implements SubmitApplicationResult {}

    record Rejected(String reasonCode) implements SubmitApplicationResult {}
}
```

Important distinction:

```text
Sealed types are excellent for internal domain modeling.
They can be dangerous as external contract if consumers must tolerate unknown future variants.
```

## 28.4 Java 21

Java 21 virtual threads help simplify blocking I/O code but do not remove compatibility issues.

Virtual threads improve implementation ergonomics, not contract safety.

You still need:

- timeout contract,
- idempotency contract,
- retry contract,
- schema compatibility,
- bounded concurrency,
- observability.

## 28.5 Java 25

Java 25 represents latest platform horizon. For this series, treat Java 25 as a modern runtime target, but still design public contracts to be language-neutral and version-neutral.

Do not expose Java-specific constructs directly as wire contract.

Bad idea:

```text
External API depends on Java enum ordinal.
External API exposes serialized Java class name.
External API depends on Java sealed hierarchy names.
```

Good idea:

```text
External API uses stable string codes, explicit schema, explicit version, and documented semantics.
```

---

## 29. Java Serialization Warning

Never use Java native serialization as microservice wire contract.

Problems:

- language-specific,
- fragile across class changes,
- security risk,
- hard to govern,
- poor schema evolution,
- not suitable for long-term event replay.

Prefer:

- JSON with OpenAPI/JSON Schema,
- Avro,
- Protobuf,
- XML with explicit XSD if needed,
- CloudEvents-style envelope if applicable,
- custom binary only with very strong reason.

---

## 30. Generated Code vs Handwritten DTO

## 30.1 Generated Code Advantages

- reduces mismatch with schema,
- enforces type shape,
- helps clients update,
- improves documentation consistency,
- reduces boilerplate.

## 30.2 Generated Code Risks

- generated models leak into domain,
- generated clients hide timeout/retry behavior,
- breaking schema generates breaking code,
- over-generation creates noisy diffs,
- generated enum may fail unknown values.

## 30.3 Recommended Boundary

```text
Wire DTO/generated model
  ↕ mapper
Application boundary model
  ↕ mapper
Domain model
```

Do not let generated API model become your domain model.

---

## 31. Contract CI/CD Pipeline

A production-grade pipeline should include:

```text
1. Lint contract.
2. Validate schema syntax.
3. Run backward compatibility check.
4. Run forward compatibility check if needed.
5. Run consumer contract tests.
6. Run provider verification.
7. Run semantic review for risky changes.
8. Publish contract artifact.
9. Publish generated docs/SDK if needed.
10. Track deployed contract version.
```

## 31.1 Example Pipeline Gates

```text
Pull request:
- OpenAPI lint
- OpenAPI diff against main
- JSON Schema validation
- Pact verification
- event schema compatibility check
- forbidden breaking change scan

Pre-production:
- consumer compatibility verification
- canary contract validation
- deprecation usage dashboard check

Production:
- contract version metric emitted
- consumer error rate monitored
- schema validation failures alerted
```

---

## 32. Contract Repository Strategy

Options:

## 32.1 Contract in Same Repo as Provider

Pros:

- close to implementation,
- easier provider CI,
- versioned with code.

Cons:

- consumer visibility depends on access,
- cross-service review harder.

## 32.2 Central Contract Repository

Pros:

- easy discovery,
- governance friendly,
- shared review.

Cons:

- drift risk from implementation,
- PR coordination overhead.

## 32.3 Hybrid

Recommended for many organizations:

```text
Provider owns source-of-truth contract in repo.
CI publishes contract artifact to central catalog.
Consumers discover contract from catalog.
```

---

## 33. Contract Catalog

A contract catalog should answer:

- Which service owns this API/event?
- Which version is deployed?
- Which consumers exist?
- What is the compatibility policy?
- What fields are deprecated?
- What is the support window?
- What schema registry subject is used?
- What is the owner team?
- What is the Slack/email escalation?
- What are examples?
- What is the security classification?
- What is the data sensitivity?

Without catalog, architecture knowledge lives in people’s heads.

---

## 34. Contract Review Checklist

For every contract change, ask:

```text
1. Is this change additive or breaking?
2. Which consumers are known?
3. Which unknown consumers may exist?
4. Does the meaning of existing field change?
5. Does the requiredness change?
6. Does the enum set change?
7. Does error behavior change?
8. Does retry behavior change?
9. Does idempotency behavior change?
10. Does authorization visibility change?
11. Does field sensitivity change?
12. Does pagination behavior change?
13. Does ordering behavior change?
14. Does event partitioning change?
15. Does replay safety change?
16. Does schema compatibility check pass?
17. Do consumer contract tests pass?
18. Is deprecation needed?
19. Is migration window defined?
20. Is observability in place?
```

---

## 35. Architecture Decision Matrix

| Situation | Recommended Approach |
|---|---|
| Add new response data | Add optional field, document semantics |
| Rename response field | Add new field, deprecate old, migrate, remove later |
| Add required request input | Introduce new operation/version or support default |
| Change enum meaning | Create new enum value or new field; do not silently reuse old |
| Add enum value | Ensure consumers have unknown fallback |
| Change event payload | Use schema compatibility check and version policy |
| Change event meaning | Prefer new event type |
| Change topic partition key | Treat as breaking operational migration |
| Remove endpoint | Deprecate, track usage, sunset, remove |
| Change authorization | Treat as breaking behavior unless clearly backward-safe |
| Add sensitive field | Security/privacy review required |
| Change pagination sorting | Treat as breaking unless explicitly unspecified before |
| Change error code | Avoid; add new code with transition mapping |

---

## 36. Case Study: Regulatory Application Microservices

Imagine these services:

```text
Application Service
Applicant Profile Service
Case Service
Payment Service
Notification Service
Compliance Service
Reporting Service
```

## 36.1 Initial Event

```json
{
  "eventId": "evt-001",
  "eventType": "ApplicationSubmitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T09:15:00Z",
  "producer": "application-service",
  "correlationId": "corr-001",
  "data": {
    "applicationId": "APP-001",
    "applicantId": "APL-001",
    "submittedAt": "2026-06-19T09:15:00Z"
  }
}
```

Consumers:

- Case Service creates case.
- Notification Service sends acknowledgement.
- Reporting Service updates dashboard.
- Compliance Service starts screening.

## 36.2 New Requirement

Agency wants to distinguish submission channel:

```text
INTERNET
COUNTER
SYSTEM_MIGRATION
```

Unsafe change:

```json
{
  "submissionChannel": "INTERNET"
}
```

as required field without default.

Why unsafe?

- old events do not have it,
- replay breaks new consumers,
- old consumers may strict-parse,
- reporting may treat missing as error.

Safe change:

```json
{
  "submissionChannel": null
}
```

with contract:

```text
submissionChannel is optional.
If absent or null, consumer must treat as UNKNOWN.
For events produced after 2026-07-01, producer will populate it for new submissions.
Historical events may not have it.
```

## 36.3 Later Requirement

Agency wants conditional approval.

Unsafe:

```text
Change APPROVED meaning to include conditional approvals.
```

Safe:

```text
Add decisionStatus = APPROVED_WITH_CONDITION
Keep APPROVED meaning unchanged
Consumer fallback required
```

Or separate:

```json
{
  "decisionStatus": "APPROVED",
  "approvalConditionStatus": "CONDITIONS_PENDING"
}
```

depending on domain meaning.

## 36.4 Contract Review

Questions:

- Does license issuance treat conditional approval as approved?
- Does notification wording differ?
- Does reporting count it as approved?
- Does compliance screening continue?
- Does SLA stop or continue?
- Does audit require separate event?

This is why semantic contract matters.

---

## 37. Anti-Patterns

## 37.1 Schema-Only Thinking

Believing compatibility is only about field/type diff.

Reality:

```text
Semantic changes can break systems even when schema is identical.
```

## 37.2 Consumer Must Update Immediately

This violates independent deployment.

If provider change requires all consumers to deploy simultaneously, you do not have microservice autonomy.

## 37.3 Shared DTO Library Across Services

Tempting in Java.

Problem:

- creates compile-time coupling,
- forces coordinated version upgrade,
- leaks provider model,
- hides wire compatibility issue,
- turns distributed contract into shared code dependency.

Better:

- publish schema/spec,
- generate client if useful,
- keep consumer boundary model independent.

## 37.4 Enum Ordinal Contract

Never expose enum ordinal.

Bad:

```json
{
  "status": 3
}
```

Unless the numeric code is a stable externally governed code, not Java enum ordinal.

## 37.5 Error Message Parsing

Bad consumer:

```java
if (error.getMessage().contains("not found")) {
    return Optional.empty();
}
```

Use machine code:

```java
if ("APPLICATION_NOT_FOUND".equals(error.code())) {
    return Optional.empty();
}
```

## 37.6 Event Type Reuse with New Meaning

Never reuse old event name for new semantic.

## 37.7 Contract Drift

Spec says one thing, implementation does another.

Prevention:

- provider tests validate implementation against contract,
- generated tests,
- schema validation,
- runtime validation sampling,
- CI/CD gates.

## 37.8 Hidden Consumer

Batch jobs, reports, scripts, and manual exports are consumers too.

---

## 38. Production Readiness Checklist

A microservice contract is production-ready only if:

```text
[ ] API/event schemas are explicitly documented.
[ ] Semantic meaning of important fields is documented.
[ ] Required vs optional vs nullable is clear.
[ ] Unknown field handling is defined.
[ ] Unknown enum handling is defined.
[ ] Error contract is stable and machine-readable.
[ ] Idempotency contract is documented for side-effect operations.
[ ] Timeout/retry/rate-limit behavior is documented.
[ ] Authorization and data visibility are documented.
[ ] Sensitive fields are classified.
[ ] Versioning policy exists.
[ ] Deprecation policy exists.
[ ] Compatibility checks run in CI.
[ ] Consumer contract tests exist for critical consumers.
[ ] Provider verification exists.
[ ] Event schema compatibility policy exists.
[ ] Event replay compatibility is tested if replay is supported.
[ ] Contract catalog exists or is planned.
[ ] Contract owner is clear.
[ ] Migration path exists for breaking changes.
[ ] Runtime contract version is observable.
```

---

## 39. Senior/Principal Engineer Review Questions

Ask these during design review:

1. What is the real contract here: schema, semantic, operational, or all three?
2. What consumer assumptions are we creating?
3. Can provider deploy independently after this change?
4. Can consumer deploy independently after this change?
5. What happens during rolling deployment?
6. What happens during event replay?
7. What happens if consumer sees an unknown enum value?
8. What happens if field is absent, null, empty, or unknown?
9. What happens if error code changes?
10. How will we know who still uses deprecated contract?
11. Is this change safe for hidden consumers?
12. Does this field expose sensitive data?
13. Is this field source-of-truth or projection?
14. Is this event a fact or a command?
15. Does event name still mean the same thing after the change?
16. Does partition key/order guarantee change?
17. Is compatibility enforced by tooling or only by discipline?
18. Is the migration path reversible?
19. Is there a deprecation/sunset timeline?
20. What production metric will tell us this contract broke?

---

## 40. Practical Exercises

## Exercise 1 — Classify API Changes

Given this old response:

```json
{
  "applicationId": "APP-001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-19T09:15:00Z"
}
```

Classify each change:

1. Add `submissionChannel` optional.
2. Rename `submittedAt` to `submissionDateTime`.
3. Change `status` from string to object.
4. Add enum value `RETURNED_FOR_CLARIFICATION`.
5. Remove `applicationId` because it is already in URL.
6. Change `submittedAt` format to `19/06/2026 09:15`.
7. Add `applicantName` PII field.

For each, decide:

```text
safe / risky / breaking
required migration path
required tests
required documentation
```

## Exercise 2 — Design Event Compatibility

Design version 2 of:

```json
{
  "eventType": "ApplicationApproved",
  "eventVersion": 1,
  "data": {
    "applicationId": "APP-001",
    "approvedAt": "2026-06-19T09:15:00Z"
  }
}
```

New requirements:

- approval can be conditional,
- approving officer id must be included,
- old events must remain replayable,
- old consumers must not break.

## Exercise 3 — Write a Deprecation Plan

Field `statusDescription` must be replaced by `statusDisplayName`.

Create:

- deprecation notice,
- migration steps,
- support window,
- monitoring plan,
- rollback plan.

## Exercise 4 — Consumer Fallback

Implement Java code that safely handles unknown status values.

Requirements:

- no crash on unknown value,
- unknown value logged once per code or counted by metric,
- business fallback is safe,
- audit still records raw value.

---

## 41. Key Takeaways

1. Contract is not just schema. Contract includes semantic, operational, compatibility, and ownership promises.
2. Compatibility always has direction: backward, forward, or both.
3. Additive change is usually safer, but not automatically safe.
4. Enum evolution is dangerous unless consumers treat enum as open set.
5. Error responses are contracts and must be stable.
6. Event contracts are harder than API contracts because events can be stored, replayed, duplicated, and consumed asynchronously.
7. Schema compatibility tooling is necessary but cannot replace semantic review.
8. Deprecation requires usage tracking and migration ownership.
9. Generated code helps, but should not become domain model.
10. Top-tier microservices teams treat contract evolution as a first-class architecture capability.

---

## 42. How This Connects to Next Part

This part explained how systems evolve safely through contracts and compatibility.

Next part, **Part 25 — Deployment Pattern and Release Safety**, builds on this:

```text
Contract compatibility
  → safe rolling deployment
  → canary release
  → blue-green release
  → feature flags
  → database expand-contract
  → rollback/roll-forward strategy
```

Without contract compatibility, deployment independence is mostly an illusion.

---

# End of Part 24

Seri belum selesai. Lanjut ke:

```text
Part 25 — Deployment Pattern and Release Safety
```

Filename:

```text
learn-java-microservices-patterns-advanced-engineering-25-deployment-release-safety.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-23-testing-strategy.md">⬅️ 0. Posisi Part Ini Dalam Seri</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-25-deployment-release-safety.md">Part 25 — Deployment Pattern and Release Safety ➡️</a>
</div>
