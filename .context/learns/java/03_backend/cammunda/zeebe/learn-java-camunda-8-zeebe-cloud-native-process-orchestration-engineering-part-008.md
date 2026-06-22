# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-008.md

# Part 008 — Variables, Serialization, Payload Discipline, and Data Contracts

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Level: Advanced / Staff+ Engineering  
> Fokus: Camunda 8 / Zeebe version >= 8, Java 8–25  
> Status seri: **belum selesai**  
> Prasyarat seri internal: Part 000–007

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas worker correctness: idempotency, retry, duplicate execution, timeout, dan external side effect. Namun semua itu bergantung pada satu hal yang sering diremehkan: **data contract**.

Di Camunda 8/Zeebe, process instance tidak hanya bergerak karena token BPMN, job, timer, dan message. Process instance juga membawa **variables**. Variables menentukan:

- gateway memilih branch yang mana,
- worker menerima input apa,
- worker menghasilkan output apa,
- user task menampilkan data apa,
- message correlation cocok atau tidak,
- call activity menerima child input apa,
- incident bisa di-debug atau tidak,
- audit trail bisa dijelaskan atau tidak,
- process version baru kompatibel atau tidak,
- migration dari Camunda 7 aman atau tidak.

Materi ini akan membahas variable bukan sebagai “Map biasa”, melainkan sebagai **distributed workflow data boundary**.

Setelah menyelesaikan bagian ini, target pemahaman Anda:

1. Bisa membedakan **process state**, **business state**, **worker-local state**, dan **projection/read model**.
2. Bisa mendesain variable payload yang aman untuk long-running workflow.
3. Bisa menghindari anti-pattern: huge variable, Java object serialization mindset, implicit schema, dan global variable pollution.
4. Bisa menggunakan input/output mapping sebagai **contract boundary**, bukan sekadar transformasi kecil.
5. Bisa membangun Java DTO contract untuk worker yang versioned, validated, auditable, dan migration-friendly.
6. Bisa menjelaskan kenapa Camunda 8 variable discipline berbeda dari Camunda 7.
7. Bisa membuat aturan governance untuk process variable di production.

---

## 1. Mental Model: Variable Bukan Database

Kesalahan umum engineer yang baru pindah dari aplikasi enterprise tradisional ke workflow engine adalah memperlakukan process variable seperti:

- database row,
- session storage,
- cache,
- document store,
- DTO dump,
- request/response log,
- tempat menaruh semua data agar mudah di-debug.

Di Camunda 8, variable adalah **state yang diperlukan engine dan participant proses untuk melanjutkan orchestration**.

Kalimat penting:

> Process variable should contain only the minimum durable context required to route, resume, correlate, decide, and execute the process safely.

Variable bukan tempat menyimpan semua business data. Business data tetap sebaiknya dimiliki oleh domain service/database yang authoritative.

### 1.1 Empat Jenis State yang Harus Dipisahkan

Dalam sistem orchestration production-grade, minimal ada empat kategori state.

| Kategori | Dimiliki oleh | Contoh | Boleh disimpan sebagai Camunda variable? |
|---|---|---|---|
| Process orchestration state | Zeebe | status tahap proses, approval decision, correlation id, deadline | Ya, jika diperlukan proses |
| Business authoritative state | Domain database | full application record, invoice, case document, customer profile | Biasanya tidak; simpan reference/id saja |
| Worker-local transient state | Worker runtime | HTTP response raw, retry context internal, auth token | Tidak |
| Read/projection state | Operate/Tasklist/Optimize/custom read model | dashboard, audit projection, task search index | Tidak sebagai variable utama |

Kesalahan besar adalah mencampur semuanya menjadi satu variable besar seperti:

```json
{
  "application": {
    "id": "APP-2026-0001",
    "applicant": { "name": "...", "address": "...", "documents": [ ... ] },
    "reviews": [ ... ],
    "auditTrail": [ ... ],
    "externalResponses": [ ... ]
  }
}
```

Payload seperti ini terasa nyaman di awal, tetapi akan merusak performa, schema evolution, audit, security, dan worker compatibility.

Desain yang lebih sehat:

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "applicantType": "INDIVIDUAL",
  "riskBand": "MEDIUM",
  "reviewRequired": true,
  "assignedTeam": "licensing-review",
  "correlation": {
    "submissionReference": "SUB-9f7c2e",
    "requestId": "REQ-20260620-000123"
  }
}
```

Full details tetap di domain database. Camunda variable memegang routing context dan reference.

---

## 2. Camunda 8 Variable Model

Camunda 8 merepresentasikan process data sebagai variable. Secara konseptual:

- variable punya **name**,
- variable punya **JSON value**,
- variable berada pada **scope** tertentu,
- visibility variable ditentukan oleh hierarchy scope,
- variable bisa dibuat saat process instance start,
- variable bisa dibuat/diubah saat worker complete job,
- variable bisa dibuat/diubah dari message correlation,
- variable bisa dibuat/diubah oleh input/output mapping,
- variable bisa dibuat/diubah oleh API tertentu.

Camunda 8 Modeler documentation menjelaskan bahwa process data direpresentasikan sebagai variables; variable memiliki nama dan JSON value, dan visibility-nya ditentukan oleh variable scope. BPMN sendiri tidak memiliki explicit data schema; variables dibuat secara implisit saat execution, misalnya process start, job completion, message correlation, atau input/output mapping.

### 2.1 Variable Name

Variable name adalah bagian dari contract.

Contoh variable name yang baik:

```text
caseId
applicationId
reviewOutcome
riskBand
assignedTeam
externalCheckStatus
paymentReference
appealDeadline
```

Contoh variable name yang buruk:

```text
data
payload
body
response
result
object
x
flag
status
```

Kenapa buruk?

- tidak jelas owner-nya,
- rawan collision,
- susah tracing,
- susah versioning,
- susah review BPMN,
- susah debugging di Operate,
- rawan dipakai oleh banyak worker dengan arti berbeda.

### 2.2 Variable Value

Nilai variable adalah JSON-compatible value:

- string,
- number,
- boolean,
- null,
- object,
- array.

Tetapi “bisa JSON object” bukan berarti “boleh dump object besar”.

### 2.3 Variable Scope

Variable tidak selalu global. Scope bisa berada pada:

- process instance/root scope,
- subprocess scope,
- call activity scope,
- service task scope,
- user task scope,
- multi-instance body/inner activity scope,
- local element scope.

Mental model:

> Scope adalah boundary visibilitas dan lifecycle variable.

Jika variable dibuat lokal di scope tertentu, variable itu mungkin tidak hidup selamanya dan tidak terlihat ke semua tempat.

---

## 3. Variable Scope: Root vs Local

Di banyak sistem gagal, masalahnya bukan karena variable tidak ada, tetapi karena variable berada di scope yang tidak dipahami.

### 3.1 Root Variables

Root variable berada pada process instance scope. Biasanya digunakan untuk informasi yang diperlukan lintas tahap proses.

Contoh:

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "riskBand": "HIGH",
  "requiresSupervisorApproval": true
}
```

Root variable cocok untuk:

- process-level identifier,
- correlation key,
- high-level decision result,
- routing result,
- final outcome,
- business milestone,
- SLA/deadline yang dipakai lintas proses.

Root variable tidak cocok untuk:

- temporary worker response,
- raw HTTP payload,
- huge document,
- per-iteration data multi-instance,
- local calculation intermediate.

### 3.2 Local Variables

Local variable hidup pada scope tertentu. Cocok untuk:

- input khusus satu task,
- result sementara,
- variable multi-instance item,
- child process input,
- subprocess-local aggregation,
- sensitive value yang tidak perlu global.

Contoh: proses punya global `caseId`, tetapi service task “Check Address” hanya butuh local `addressCheckRequest`.

```json
{
  "addressCheckRequest": {
    "postalCode": "123456",
    "unitNumber": "10-01"
  }
}
```

Setelah task selesai, output mapping dapat mengekspor hanya hasil yang diperlukan:

```json
{
  "addressVerified": true,
  "addressConfidence": "HIGH"
}
```

Bukan seluruh response eksternal.

### 3.3 Variable Visibility Dalam Concurrent Path

Salah satu jebakan penting: variable bukan “milik token”. Variable adalah data di process instance/scope. Dalam parallel gateway, dua path concurrent bisa membaca/menulis variable yang sama.

Contoh buruk:

```text
Parallel branch A writes: status = "ADDRESS_CHECKED"
Parallel branch B writes: status = "DOCUMENT_CHECKED"
```

Hasil akhir bisa membingungkan karena `status` terlalu generik. Gunakan nama spesifik:

```text
addressCheckStatus = "PASSED"
documentCheckStatus = "PASSED"
```

Kemudian gateway/aggregation logic membaca keduanya:

```text
addressCheckStatus = "PASSED" and documentCheckStatus = "PASSED"
```

### 3.4 Rule of Thumb Scope

Gunakan aturan ini:

| Pertanyaan | Jika jawabannya “ya” | Scope yang disarankan |
|---|---|---|
| Dibutuhkan oleh banyak task di sepanjang proses? | Ya | Root |
| Hanya dibutuhkan satu task/worker? | Ya | Local/task input |
| Hanya intermediate mapping? | Ya | Local |
| Harus terlihat di Operate untuk support? | Ya, tapi hati-hati | Root kecil atau custom audit projection |
| Mengandung data sensitif? | Ya | Hindari variable; simpan reference/tokenized value |
| Data besar? | Ya | Jangan variable; simpan external reference |

---

## 4. Input Mapping dan Output Mapping sebagai Contract Boundary

Input/output mapping sering diperlakukan sebagai fitur “mapping kecil di Modeler”. Untuk production-grade engineering, mapping harus dianggap sebagai **contract boundary**.

### 4.1 Default Behavior yang Berbahaya

Pada service task, secara default variable yang dikembalikan worker dapat merge ke process instance. Jika worker mengembalikan object besar atau field generik, process scope bisa tercemar.

Misalnya worker complete job dengan:

```json
{
  "status": "OK",
  "result": {
    "code": "A001",
    "raw": { "...": "..." }
  }
}
```

Jika tidak dikontrol, variable `status` dan `result` bisa menjadi global dan bertabrakan dengan worker lain.

### 4.2 Input Mapping

Input mapping membentuk input yang diterima worker. Tujuannya:

- worker tidak perlu tahu semua process variable,
- worker menerima struktur stabil,
- variable global bisa diubah tanpa merusak worker,
- sensitive/unneeded data tidak dikirim ke worker,
- worker contract bisa dites terpisah.

Contoh konsep:

Process root variables:

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "applicant": {
    "name": "A",
    "postalCode": "123456",
    "email": "x@example.com"
  },
  "internalReviewNotes": "..."
}
```

Worker “address-check” tidak perlu semua itu. Input mapping seharusnya membentuk:

```json
{
  "addressCheckInput": {
    "caseId": "CASE-2026-0001",
    "postalCode": "123456"
  }
}
```

Worker contract:

```java
public record AddressCheckInput(
    String caseId,
    String postalCode
) {}
```

### 4.3 Output Mapping

Output mapping membatasi apa yang boleh kembali ke process scope.

Worker raw result:

```json
{
  "addressCheckWorkerResult": {
    "verified": true,
    "confidence": "HIGH",
    "providerReference": "ADDR-REF-991",
    "rawResponseLocation": "s3://bucket/address-check/ADDR-REF-991.json"
  }
}
```

Output mapping hanya publish:

```json
{
  "addressVerified": true,
  "addressConfidence": "HIGH",
  "addressCheckReference": "ADDR-REF-991"
}
```

Dengan begini, process tidak bergantung pada raw provider schema.

### 4.4 Mapping sebagai Anti-Corruption Layer

Input/output mapping bisa menjadi anti-corruption layer antara:

- process model,
- Java worker,
- external API,
- domain model,
- versioned contract.

Tanpa mapping, process variable sering menjadi “shared mutable global map”. Itu sama bahayanya seperti global variable di aplikasi Java besar.

---

## 5. Data Contract: Proses dan Worker Harus Punya Perjanjian Eksplisit

Worker job type bukan hanya string. Job type + variable schema + error semantics adalah contract.

Contoh contract minimal:

```yaml
jobType: address-check.v1
input:
  addressCheckInput:
    caseId: string required
    postalCode: string required length=6
output:
  addressVerified: boolean required
  addressConfidence: enum[LOW, MEDIUM, HIGH] required
  addressCheckReference: string optional
errors:
  BPMN_ADDRESS_NOT_FOUND:
    meaning: address cannot be verified as submitted
  fail job:
    meaning: provider/network/transient failure
idempotencyKey:
  caseId + jobType + businessAttempt
owner:
  team: platform-case-worker
```

### 5.1 Contract Harus Menjawab Pertanyaan Ini

Untuk setiap service task/job worker:

1. Job type apa?
2. Worker mana yang owner?
3. Input variable apa yang wajib?
4. Input variable apa yang optional?
5. Output variable apa yang akan ditulis?
6. Field apa yang tidak boleh ditulis?
7. BPMN error apa yang bisa dilempar?
8. Job failure dipakai untuk apa?
9. Incident terjadi jika apa?
10. Idempotency key apa?
11. Timeout berapa?
12. Retry budget berapa?
13. Payload maksimal berapa?
14. Sensitive field ada atau tidak?
15. Versioning strategy bagaimana?

Jika jawaban ini tidak ada, model belum production-ready.

### 5.2 Contract Bukan Hanya DTO

DTO hanya representasi teknis. Contract lebih luas:

- semantic meaning,
- field lifecycle,
- owner,
- validation,
- compatibility,
- error behavior,
- operational expectation.

Contoh field:

```json
{
  "reviewOutcome": "APPROVED"
}
```

Pertanyaan contract:

- Siapa yang boleh menulis `reviewOutcome`?
- Nilai valid apa saja?
- Apakah bisa berubah setelah ditulis?
- Apakah null valid?
- Apakah `REJECTED` berarti final rejection atau recommendation?
- Apakah value ini dipakai gateway?
- Apakah value ini dipakai audit report?
- Apakah version baru akan menambah `CONDITIONALLY_APPROVED`?

Top 1% engineer tidak berhenti di “field-nya String”. Mereka mengunci semantic invariant.

---

## 6. Java Serialization Strategy

Camunda 8 variable adalah JSON-compatible. Di Java, biasanya kita berurusan dengan:

- `Map<String, Object>`,
- JSON string,
- POJO/record,
- Jackson `JsonNode`,
- client helper methods.

### 6.1 Hindari Java Object Serialization Mindset

Di Camunda 7, banyak sistem lama menyimpan Java object sebagai serialized object. Ini buruk untuk migration dan long-running process karena:

- tied to Java class name,
- tied to serialVersionUID,
- brittle terhadap refactor package,
- tidak portable lintas bahasa,
- sulit dibaca dari tooling,
- berisiko security,
- buruk untuk schema evolution.

Camunda 8 mendorong JSON/primitive-compatible variable. Ini lebih sehat untuk distributed system.

### 6.2 POJO/Record Tetap Boleh, Tapi Hanya di Boundary Java

Di Java worker, gunakan DTO kuat:

```java
public record AddressCheckInput(
    String caseId,
    String postalCode
) {}

public record AddressCheckOutput(
    boolean addressVerified,
    String addressConfidence,
    String addressCheckReference
) {}
```

Tetapi jangan berpikir DTO itu disimpan sebagai Java object. DTO adalah **compile-time representation** dari JSON contract.

### 6.3 Java 8 sampai 25 Strategy

Karena seri ini mencakup Java 8–25, gunakan strategi berikut:

| Java Version | DTO Style | Catatan |
|---|---|---|
| Java 8 | immutable class + builder/static factory | Tidak ada record |
| Java 11 | immutable class | Masih umum di enterprise |
| Java 17 | record cocok untuk DTO boundary | LTS modern |
| Java 21 | record + sealed type untuk domain internal jika perlu | Baseline modern kuat |
| Java 25 | record tetap cocok; manfaatkan modern JVM/runtime | Tetap jaga compatibility library |

Java 8 example:

```java
public final class AddressCheckInput {
    private final String caseId;
    private final String postalCode;

    public AddressCheckInput(String caseId, String postalCode) {
        this.caseId = requireNonBlank(caseId, "caseId");
        this.postalCode = requirePostalCode(postalCode);
    }

    public String getCaseId() {
        return caseId;
    }

    public String getPostalCode() {
        return postalCode;
    }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value;
    }

    private static String requirePostalCode(String value) {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("postalCode must be 6 digits");
        }
        return value;
    }
}
```

Java 17+ example:

```java
public record AddressCheckInput(
    String caseId,
    String postalCode
) {
    public AddressCheckInput {
        requireNonBlank(caseId, "caseId");
        if (postalCode == null || !postalCode.matches("\\d{6}")) {
            throw new IllegalArgumentException("postalCode must be 6 digits");
        }
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
    }
}
```

### 6.4 Prefer Explicit ObjectMapper Configuration

Jangan biarkan serialization behavior tersebar tanpa governance. Untuk Java worker, tetapkan aturan:

- date/time format,
- BigDecimal handling,
- unknown property behavior,
- enum handling,
- null inclusion,
- property naming strategy,
- timezone,
- fail on invalid subtype,
- no default polymorphic typing untuk untrusted data.

Contoh prinsip:

```java
ObjectMapper mapper = new ObjectMapper()
    .registerModule(new JavaTimeModule())
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
```

Catatan: untuk compatibility, kadang `FAIL_ON_UNKNOWN_PROPERTIES` dimatikan agar forward-compatible. Keputusan ini harus sadar.

| Mode | Kelebihan | Risiko |
|---|---|---|
| Fail unknown property | cepat mendeteksi contract drift | version baru bisa memecahkan worker lama |
| Ignore unknown property | forward-compatible | typo field bisa diam-diam hilang |

Production pattern: gunakan strict validation pada field penting, dan explicit schema/version check.

---

## 7. Null Semantics: Null Bukan Hal Kecil

Dalam workflow long-running, `null` bisa berarti banyak hal:

- belum diketahui,
- tidak berlaku,
- sengaja dikosongkan,
- gagal diisi,
- field optional,
- field dihapus,
- bug serialization,
- backward compatibility dari versi lama.

Jangan desain gateway expression yang ambigu.

Buruk:

```text
if approved = true
else reject
```

Jika `approved` null karena user belum submit, proses bisa salah branch.

Lebih baik:

```text
reviewDecision = "APPROVED"
reviewDecision = "REJECTED"
reviewDecision = "NEEDS_MORE_INFO"
```

Dan treat missing/unknown sebagai incident atau explicit waiting path.

### 7.1 Null Policy

Untuk setiap field contract, tentukan:

| Field | Required? | Nullable? | Default? | Owner |
|---|---:|---:|---|---|
| caseId | Ya | Tidak | Tidak ada | process starter |
| riskBand | Ya | Tidak | `UNASSESSED` jika belum dihitung | risk worker |
| supervisorComment | Tidak | Ya | null berarti no comment | user task |
| paymentReference | Tidak | Tidak jika payment success | Tidak ada | payment worker |

### 7.2 Missing vs Null

JSON object:

```json
{
  "reviewDecision": null
}
```

berbeda secara semantic dengan:

```json
{}
```

Meskipun banyak code Java memperlakukannya sama, untuk workflow long-running ini sebaiknya dibedakan.

- missing: producer belum pernah mengirim field,
- null: producer sengaja mengirim kosong, jika contract mengizinkan.

---

## 8. Date/Time Serialization

Workflow sangat sering menggunakan deadline, SLA, due date, appeal period, reminder, timer, dan expiry. Date/time variable harus disiplin.

### 8.1 Gunakan ISO-8601

Contoh baik:

```json
{
  "appealDeadline": "2026-07-20T17:00:00+08:00",
  "submittedAt": "2026-06-20T09:30:00Z"
}
```

Contoh buruk:

```json
{
  "appealDeadline": "20/07/2026 5pm",
  "submittedAt": 1781938200000
}
```

Kenapa epoch number sering buruk sebagai process variable?

- kurang readable di Operate,
- rawan detik vs milidetik,
- rawan timezone assumption,
- analytics tooling bisa gagal mengenali sebagai date,
- audit human review lebih sulit.

Camunda Optimize documentation juga menekankan agar date property dalam JSON object menggunakan common date format, bukan Unix timestamp, agar bisa dikenali sebagai date dalam import/reporting.

### 8.2 Bedakan Instant, LocalDate, dan Business Date

| Jenis | Contoh | Gunakan untuk |
|---|---|---|
| Instant | `2026-06-20T01:30:00Z` | event timestamp teknis |
| OffsetDateTime | `2026-06-20T09:30:00+08:00` | deadline dengan offset |
| LocalDate | `2026-06-20` | tanggal bisnis tanpa jam |
| Business period | `P14D` atau explicit date | SLA duration |

Untuk regulatory workflow, jangan simpan “14 days” saja jika deadline final sudah dihitung oleh rule engine/business calendar. Simpan hasil deadline eksplisit:

```json
{
  "appealPeriodDays": 14,
  "appealDeadline": "2026-07-04T23:59:59+08:00",
  "calendarPolicyVersion": "SG-BUSINESS-CALENDAR-2026.1"
}
```

Ini lebih defensible saat audit.

---

## 9. Number, BigDecimal, Currency, and Precision

JSON number tidak membawa tipe Java seperti `BigDecimal`, `Long`, `Integer`, atau `Double` secara eksplisit. Ini bisa bermasalah.

### 9.1 Jangan Gunakan Floating Point untuk Uang

Buruk:

```json
{
  "feeAmount": 10.1
}
```

Lebih baik:

```json
{
  "fee": {
    "amountMinor": 1010,
    "currency": "SGD"
  }
}
```

Atau:

```json
{
  "fee": {
    "amount": "10.10",
    "currency": "SGD"
  }
}
```

Pilihan bergantung standar organisasi. Untuk orchestration variable, minor unit integer sering lebih aman.

### 9.2 Java Mapping

Jika memakai `BigDecimal`, pastikan JSON tidak berubah menjadi floating imprecise. Hindari transformasi `double` di tengah.

```java
BigDecimal amount = new BigDecimal("10.10");
```

Bukan:

```java
BigDecimal amount = new BigDecimal(10.10); // buruk
```

---

## 10. Enum and Controlled Vocabulary

Enum di process variable sangat penting untuk gateway dan audit.

Contoh:

```json
{
  "riskBand": "LOW",
  "reviewDecision": "APPROVED",
  "casePhase": "ASSESSMENT"
}
```

### 10.1 Jangan Pakai Boolean untuk State yang Bisa Bertambah

Awalnya:

```json
{
  "approved": true
}
```

Lalu bisnis minta:

- approved,
- rejected,
- need more info,
- withdrawn,
- escalated,
- conditional approval.

Boolean menjadi tidak cukup.

Lebih baik dari awal:

```json
{
  "reviewDecision": "APPROVED"
}
```

### 10.2 Unknown Enum Strategy

Jika worker menerima enum baru yang belum dikenal, pilih behavior:

- fail job dan incident,
- throw BPMN error,
- route to manual review,
- ignore jika optional.

Untuk decision-critical enum, jangan silent ignore.

Java example:

```java
public enum ReviewDecision {
    APPROVED,
    REJECTED,
    NEEDS_MORE_INFO,
    WITHDRAWN
}
```

Namun hati-hati saat deserialization jika enum value baru muncul. Gunakan version compatibility strategy.

---

## 11. Payload Size Discipline

Salah satu anti-pattern paling mahal adalah menyimpan payload besar sebagai process variable.

### 11.1 Kenapa Huge Variable Buruk?

Huge variable berdampak pada:

- command size,
- gateway memory,
- broker processing,
- persisted log/state,
- exporter throughput,
- Operate/Tasklist projection,
- Elasticsearch/OpenSearch index size,
- network overhead ke worker,
- job activation latency,
- incident debugging,
- backup/restore footprint,
- security exposure.

Bahkan jika “masih jalan”, desain ini membangun hutang operasional.

### 11.2 Reference-over-Payload Pattern

Alih-alih menyimpan dokumen:

```json
{
  "uploadedDocumentBase64": "JVBERi0xLjQKJ..."
}
```

Simpan reference:

```json
{
  "documentReference": {
    "documentId": "DOC-2026-000998",
    "storageProvider": "document-service",
    "contentHash": "sha256:...",
    "classification": "CONFIDENTIAL"
  }
}
```

Domain/document service menjadi source of truth. Camunda menyimpan orchestration reference.

### 11.3 External Response Storage

Jika external API response besar atau sensitif:

1. worker panggil API,
2. worker simpan raw response ke secure storage/domain DB,
3. worker tulis summary/reference ke variable,
4. process lanjut berdasarkan summary.

Contoh variable:

```json
{
  "screeningResult": "MATCH_FOUND",
  "screeningReference": "SCR-2026-123456",
  "screeningProvider": "provider-x",
  "screeningCheckedAt": "2026-06-20T10:15:00+08:00"
}
```

Bukan:

```json
{
  "screeningRawResponse": { "very": "large", "sensitive": "..." }
}
```

---

## 12. Sensitive Data and PII

Process variables sering terlihat di tooling operasi seperti Operate atau masuk projection storage. Maka PII discipline wajib.

### 12.1 Prinsip Minimum Exposure

Jangan taruh di process variable jika tidak diperlukan untuk routing/execution.

Contoh sebaiknya tidak dijadikan variable global:

- NRIC/passport number,
- full address,
- full name jika tidak perlu,
- bank account,
- full email/phone jika tidak perlu,
- raw document,
- authentication token,
- API secret,
- personal notes sensitif,
- legal evidence detail.

Gunakan reference/tokenized representation:

```json
{
  "applicantRef": "APPLICANT-9ac71",
  "applicantCategory": "INDIVIDUAL",
  "identityVerificationStatus": "VERIFIED"
}
```

### 12.2 Masking Tidak Cukup Jika Source Variable Tetap Sensitif

Menampilkan masked value di UI tidak menyelesaikan masalah jika raw value tetap berada di variable store/projection. Governance harus menentukan data mana yang boleh masuk engine.

### 12.3 Regulatory Workflow Implication

Untuk case management/regulatory enforcement, auditability penting. Tetapi auditability bukan berarti menyalin semua evidence ke Camunda variable.

Lebih baik:

```json
{
  "evidenceBundleId": "EVB-2026-0001",
  "evidenceBundleHash": "sha256:...",
  "evidenceCount": 12,
  "evidenceClassification": "RESTRICTED"
}
```

Dengan begitu, process tetap menjelaskan apa yang terjadi, tanpa menjadi repository evidence.

---

## 13. Variable Fetch Strategy for Workers

Worker tidak harus mengambil semua variable. Ambil hanya yang dibutuhkan.

### 13.1 Kenapa Fetch Variable Minimal?

Manfaat:

- lebih kecil payload network,
- lebih rendah latency,
- lebih sedikit exposure data,
- contract lebih jelas,
- worker lebih mudah dites,
- mengurangi coupling terhadap global variable.

Buruk:

```java
// mental model buruk: ambil semua variables lalu tebak field
Map<String, Object> vars = job.getVariablesAsMap();
```

Lebih baik:

```java
// worker hanya tahu input contract-nya
AddressCheckInput input = variableReader.read(job, "addressCheckInput", AddressCheckInput.class);
```

### 13.2 Jangan Membuat Worker Menjadi Process-Aware Berlebihan

Worker sebaiknya tidak perlu tahu seluruh BPMN. Worker tahu:

- job type,
- input contract,
- output contract,
- error contract,
- idempotency contract.

Jika worker harus membaca banyak variable global untuk menentukan perilaku, mungkin process modelling atau input mapping-nya buruk.

---

## 14. Variable Merge Semantics and Global Pollution

Saat worker complete job dengan variables, variables tersebut dapat di-merge ke scope terkait. Jika tidak dikontrol, worker bisa menulis variable yang tidak sengaja menimpa variable lain.

### 14.1 Collision Example

Worker A output:

```json
{
  "status": "VALID"
}
```

Worker B output:

```json
{
  "status": "APPROVED"
}
```

Gateway C membaca:

```text
status = "APPROVED"
```

Apa arti `status`? Status address? Status document? Status review? Status case?

Gunakan nama domain-spesifik:

```json
{
  "addressValidationStatus": "VALID",
  "reviewDecision": "APPROVED"
}
```

### 14.2 Output Namespace Pattern

Untuk output worker kompleks, gunakan namespaced object sementara:

```json
{
  "addressCheck": {
    "status": "VERIFIED",
    "confidence": "HIGH",
    "reference": "ADDR-123"
  }
}
```

Tetapi hati-hati: object namespace bisa tumbuh besar. Untuk gateway, field spesifik sering lebih mudah:

```json
{
  "addressVerified": true,
  "addressConfidence": "HIGH",
  "addressCheckReference": "ADDR-123"
}
```

### 14.3 Writer Ownership

Setiap variable penting harus punya owner.

| Variable | Owner | Other writer allowed? |
|---|---|---:|
| riskBand | risk-assessment worker | Tidak |
| reviewDecision | review user task | Tidak, kecuali supervisor override |
| paymentStatus | payment worker | Tidak |
| casePhase | orchestration/process only | Hati-hati |
| assignedTeam | assignment worker | Ya, via reassignment flow |

Tanpa ownership, debugging akan sulit: “siapa yang mengubah variable ini?”

---

## 15. Schema Evolution for Long-Running Processes

Workflow bisa berjalan lama: jam, hari, bulan, bahkan tahun. Selama itu:

- worker version berubah,
- BPMN version berubah,
- variable schema berubah,
- external API berubah,
- user form berubah,
- business rule berubah.

Karena itu variable contract harus evolvable.

### 15.1 Backward-Compatible Changes

Biasanya aman:

- menambah optional field,
- menambah new enum jika consumer siap,
- menambah object field yang tidak dipakai gateway lama,
- menambah output field baru tanpa mengubah field lama,
- memperluas input dengan default.

Contoh v1:

```json
{
  "riskBand": "LOW"
}
```

v2 compatible:

```json
{
  "riskBand": "LOW",
  "riskScore": 12
}
```

### 15.2 Breaking Changes

Berbahaya:

- rename variable,
- menghapus variable,
- mengubah enum value,
- mengubah number menjadi object,
- mengubah string date format,
- mengubah semantic boolean,
- mengubah required field tanpa migration,
- mengubah meaning field lama.

Contoh breaking:

```json
// lama
{ "approved": true }

// baru
{ "reviewDecision": "APPROVED" }
```

Jika BPMN lama masih membaca `approved`, instance lama bisa incident atau salah route.

### 15.3 Version Field Pattern

Untuk contract kompleks, tambahkan schema version:

```json
{
  "addressCheckInput": {
    "schemaVersion": 1,
    "caseId": "CASE-2026-0001",
    "postalCode": "123456"
  }
}
```

Atau job type versioning:

```text
address-check.v1
address-check.v2
```

Praktik yang kuat: version job type untuk perubahan breaking, schemaVersion untuk object contract yang panjang umur.

### 15.4 Consumer-Driven Compatibility

Sebelum mengubah variable, cek semua consumer:

- BPMN gateways,
- input mappings,
- output mappings,
- workers,
- Tasklist forms,
- Operate support runbook,
- Optimize reports,
- custom dashboards,
- audit exports,
- migration scripts.

Variable adalah public contract internal sistem. Jangan refactor sembarangan seperti local variable Java.

---

## 16. Data Contract Documentation Format

Untuk production, setiap job type sebaiknya punya contract document.

Contoh:

```markdown
# Job Contract: address-check.v1

## Owner
Team: Case Platform
Service: address-worker

## Purpose
Verify applicant postal address against external address registry.

## Input Variables

### addressCheckInput
Required: yes
Scope: local task input

| Field | Type | Required | Example | Notes |
|---|---|---:|---|---|
| schemaVersion | integer | yes | 1 | must be 1 |
| caseId | string | yes | CASE-2026-0001 | idempotency dimension |
| postalCode | string | yes | 123456 | 6 digits |

## Output Variables

| Variable | Type | Required | Example | Notes |
|---|---|---:|---|---|
| addressVerified | boolean | yes | true | gateway uses this |
| addressConfidence | string enum | yes | HIGH | LOW/MEDIUM/HIGH |
| addressCheckReference | string | no | ADDR-REF-123 | provider reference |

## BPMN Errors

| Error code | Meaning |
|---|---|
| ADDRESS_NOT_FOUND | Submitted address cannot be verified |

## Job Failure
Used only for transient provider/network/technical failure.

## Idempotency
Key: caseId + jobType + postalCodeHash

## Security
Do not store full address in process variable. Worker may fetch details from application-service.
```

Dokumentasi seperti ini terasa berat di awal, tetapi menyelamatkan production system saat versi dan team bertambah.

---

## 17. Validation Strategy

Variable contract tanpa validation hanya dokumentasi mati.

### 17.1 Validate at Process Start

Saat create process instance, validate required startup variables.

Contoh startup contract:

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "submissionChannel": "ONLINE",
  "submittedAt": "2026-06-20T09:30:00+08:00"
}
```

Jangan biarkan process start jika `caseId` kosong.

### 17.2 Validate at Worker Boundary

Worker harus validate input sebelum side effect.

```java
public final class AddressCheckWorker {
    public AddressCheckOutput handle(AddressCheckInput input) {
        input.validate();
        // only after validation call external service
        return addressService.verify(input);
    }
}
```

Jika input invalid karena modelling/contract bug, biasanya lebih tepat fail job menuju incident, bukan retry terus.

### 17.3 Validation Failure Taxonomy

| Failure | Cause | Recommended handling |
|---|---|---|
| Missing required variable | process/model/producer bug | fail job no retry / incident |
| Invalid business value | user/business input | BPMN error / correction flow |
| Unknown enum from newer producer | compatibility issue | incident or manual review |
| External response invalid | provider bug/integration issue | fail job retry limited, then incident |
| Optional field absent | expected | default or branch explicitly |

---

## 18. Gateway Expression Safety

Variables sering dipakai di gateway. Ini area high-risk.

### 18.1 Jangan Buat Gateway Bergantung pada Ambiguous Field

Buruk:

```text
status = "OK"
```

Lebih baik:

```text
addressValidationStatus = "VALID"
```

atau:

```text
reviewDecision = "APPROVED"
```

### 18.2 Gateway Harus Punya Explicit Else/Error Path

Jika semua condition gagal, apa yang terjadi? Untuk process kritikal, jangan diam-diam deadlock/incidence tanpa runbook.

Contoh gateway branch:

1. `reviewDecision = "APPROVED"`
2. `reviewDecision = "REJECTED"`
3. `reviewDecision = "NEEDS_MORE_INFO"`
4. default path: create incident/manual correction karena invalid decision

### 18.3 Prefer Decision Result Object untuk Complex Decision

Jika decision kompleks:

```json
{
  "eligibilityDecision": {
    "outcome": "ELIGIBLE",
    "reasonCodes": ["BASIC_REQUIREMENT_MET"],
    "policyVersion": "POLICY-2026.1",
    "decidedAt": "2026-06-20T10:00:00+08:00"
  }
}
```

Gateway bisa membaca `eligibilityDecision.outcome`, sementara audit tetap punya reason/policy version.

---

## 19. User Task Forms and Variables

User task sering menjadi titik variable corruption karena user form langsung menulis field ke process variable.

### 19.1 Form Key as Variable Binding

Dalam Camunda forms/Tasklist, field form biasanya terikat pada variable key. Jika form key terlalu generik, variable global bisa tercemar.

Buruk:

```text
comments
status
approved
```

Lebih baik:

```text
reviewComment
reviewDecision
reviewSubmittedAt
```

### 19.2 User Input Harus Dibedakan dari Final Decision

Kadang user form mengisi recommendation, lalu supervisor approval menentukan final decision.

Jangan campur:

```json
{
  "decision": "APPROVED"
}
```

Lebih defensible:

```json
{
  "reviewRecommendation": "APPROVE",
  "reviewComment": "All checks passed",
  "supervisorDecision": "APPROVED",
  "finalDecision": "APPROVED"
}
```

### 19.3 Audit Metadata

Jangan hanya simpan decision. Simpan metadata minimal jika diperlukan:

```json
{
  "reviewDecision": "APPROVED",
  "reviewedByUserId": "user-123",
  "reviewedAt": "2026-06-20T11:45:00+08:00"
}
```

Tetapi hati-hati terhadap PII. User ID internal biasanya lebih baik daripada full name.

---

## 20. Multi-Instance Variables

Multi-instance adalah area yang rawan variable collision.

### 20.1 Item Variable

Untuk multi-instance over collection:

```json
{
  "documentsToCheck": [
    { "documentId": "DOC-1", "type": "PASSPORT" },
    { "documentId": "DOC-2", "type": "PROOF_OF_ADDRESS" }
  ]
}
```

Setiap instance sebaiknya punya local item:

```json
{
  "documentCheckItem": {
    "documentId": "DOC-1",
    "type": "PASSPORT"
  }
}
```

### 20.2 Jangan Tulis Output ke Variable Sama dari Semua Instance

Buruk:

```json
{
  "documentCheckStatus": "PASSED"
}
```

Semua instance menulis field yang sama. Hasil bisa menimpa.

Lebih baik gunakan output collection/aggregation:

```json
{
  "documentCheckResults": [
    { "documentId": "DOC-1", "status": "PASSED" },
    { "documentId": "DOC-2", "status": "FAILED" }
  ]
}
```

### 20.3 Aggregation Contract

Setelah multi-instance selesai, proses butuh summary:

```json
{
  "allDocumentsValid": false,
  "failedDocumentCount": 1,
  "documentCheckBatchReference": "DCB-2026-0099"
}
```

Gateway sebaiknya membaca summary, bukan memproses collection besar dalam expression kompleks.

---

## 21. Call Activity Variable Contract

Call activity membuat hubungan parent-child process. Ini berbahaya jika variable propagation tidak dikontrol.

### 21.1 Jangan Propagate Semua Tanpa Sadar

Jika child process menerima semua parent variables, child menjadi coupled terhadap parent internal state. Jika child mengembalikan semua variables, parent bisa tercemar.

Contract yang lebih sehat:

Parent to child input:

```json
{
  "appealProcessInput": {
    "caseId": "CASE-2026-0001",
    "appealId": "APL-2026-0001",
    "originalDecision": "REJECTED"
  }
}
```

Child to parent output:

```json
{
  "appealOutcome": "UPHELD",
  "appealCompletedAt": "2026-07-10T15:00:00+08:00"
}
```

### 21.2 Child Process Should Not Know Parent Internals

Reusable process hanya butuh contract-nya. Jika child membaca variable parent seperti `internalCaseReviewStage4Flag`, desainnya rapuh.

---

## 22. Message Correlation Variables

Message correlation bergantung pada correlation key. Variable yang terkait message harus stabil.

### 22.1 Correlation Key Design

Baik:

```json
{
  "paymentCorrelationKey": "PAY-2026-0001"
}
```

Buruk:

```json
{
  "correlationKey": "123"
}
```

Kenapa buruk?

- namespace tidak jelas,
- rawan collision lintas message type,
- sulit audit,
- tidak tahu sistem asal.

### 22.2 Message Payload Discipline

Message payload harus mengikuti rule yang sama:

- jangan kirim huge payload,
- jangan kirim raw sensitive data,
- kirim result summary + reference,
- schema version,
- idempotency/correlation reference.

Contoh:

```json
{
  "paymentNotification": {
    "schemaVersion": 1,
    "paymentReference": "PAY-2026-0001",
    "status": "SETTLED",
    "settledAt": "2026-06-20T12:00:00+08:00",
    "providerEventId": "evt_123"
  }
}
```

---

## 23. Variables and Incidents

Incident debugging sangat bergantung pada variable quality.

### 23.1 Variable yang Membantu Debugging

Minimal useful variables:

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "currentBusinessPhase": "RISK_ASSESSMENT",
  "lastExternalReference": "RISK-REF-9001",
  "riskAssessmentStatus": "FAILED_TEMPORARILY"
}
```

### 23.2 Variable yang Membahayakan Debugging

```json
{
  "payload": { "... huge nested object ..." },
  "status": "ERROR",
  "result": null
}
```

Support engineer tidak tahu status apa, result dari worker mana, error apa.

### 23.3 Incident-Friendly Contract

Untuk setiap external step, simpan:

- business reference,
- provider/reference id,
- summary status,
- timestamp,
- retry/attempt maybe in external store,
- error code if business error.

Jangan simpan stack trace panjang sebagai variable. Stack trace ada di logs.

---

## 24. Variables and Audit Defensibility

Untuk regulatory/enforcement system, variable bisa menjadi bagian dari explanation layer. Namun audit defensibility bukan berarti data sebanyak mungkin.

### 24.1 What Must Be Explainable

Audit biasanya butuh menjawab:

1. Proses apa yang dijalankan?
2. Instance mana?
3. Keputusan apa yang dibuat?
4. Berdasarkan policy/rule version apa?
5. Oleh siapa/komponen apa?
6. Kapan?
7. External reference apa?
8. Apakah ada override?
9. Apakah ada incident/manual repair?
10. Apakah SLA/deadline terpenuhi?

Variable yang mendukung:

```json
{
  "caseId": "CASE-2026-0001",
  "eligibilityDecision": {
    "outcome": "ELIGIBLE",
    "policyVersion": "ELIGIBILITY-2026.1",
    "decidedAt": "2026-06-20T10:00:00+08:00",
    "decisionReference": "DEC-2026-888"
  }
}
```

### 24.2 Jangan Jadikan Camunda Satu-satunya Audit Store

Zeebe record/exporter bisa membantu membangun audit projection. Namun domain audit trail sering tetap perlu disimpan di audit service/table sendiri, terutama untuk:

- legal retention,
- tamper evidence,
- redaction policy,
- reporting,
- cross-system audit,
- human-readable narrative.

---

## 25. Variables and Operate/Tasklist/Optimize Projection

Variables bisa muncul di Operate, Tasklist, dan Optimize/read-side storage. Karena read side eventually consistent, jangan gunakan read-side variable search sebagai synchronous decision source untuk command-critical logic.

### 25.1 Command Path vs Query Path

Jika worker butuh business data, ambil dari authoritative domain service/database, bukan dari Operate API.

Operate berguna untuk:

- support,
- inspection,
- incident triage,
- operational visibility.

Operate bukan source of truth untuk business state.

### 25.2 Optimize Analytics

Variable yang ingin dipakai analytics harus:

- stable,
- controlled vocabulary,
- tidak terlalu nested sembarangan,
- format date benar,
- tidak sensitif,
- tidak berubah semantic.

Jika Anda ingin menganalisis approval time by risk band, variable `riskBand` harus stabil, bukan kadang `risk`, kadang `risk_level`, kadang `band`.

---

## 26. Practical Java Variable Access Pattern

Berikut pattern konseptual untuk worker. Nama API bisa berbeda tergantung client/starter versi, tetapi arsitektur boundary-nya sama.

### 26.1 Jangan Campur Parsing, Validation, Business Logic, dan Completion

Buruk:

```java
@JobWorker(type = "address-check.v1")
public Map<String, Object> handle(ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();
    String postalCode = ((Map<String, Object>) vars.get("applicant")).get("postalCode").toString();
    boolean ok = externalClient.verify(postalCode);
    return Map.of("status", ok ? "OK" : "FAILED");
}
```

Masalah:

- mengambil struktur global,
- unsafe cast,
- variable name generik,
- no validation,
- no idempotency,
- output generik,
- no contract object.

Lebih baik:

```java
@JobWorker(type = "address-check.v1")
public AddressCheckOutput handle(AddressCheckInput input) {
    input.validate();
    AddressVerification verification = addressVerificationService.verify(input);

    return new AddressCheckOutput(
        verification.verified(),
        verification.confidence().name(),
        verification.reference()
    );
}
```

Jika framework tidak otomatis bind object sesuai kebutuhan, buat adapter:

```java
public final class JobVariableReader {
    private final ObjectMapper objectMapper;

    public JobVariableReader(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public <T> T readRequiredObject(Map<String, Object> variables, String name, Class<T> type) {
        Object raw = variables.get(name);
        if (raw == null) {
            throw new InvalidJobContractException("Missing required variable: " + name);
        }
        return objectMapper.convertValue(raw, type);
    }
}
```

### 26.2 Separate Contract Exception from Business Exception

```java
public final class InvalidJobContractException extends RuntimeException {
    public InvalidJobContractException(String message) {
        super(message);
    }
}

public final class BusinessRuleRejectedException extends RuntimeException {
    private final String bpmnErrorCode;

    public BusinessRuleRejectedException(String bpmnErrorCode, String message) {
        super(message);
        this.bpmnErrorCode = bpmnErrorCode;
    }

    public String bpmnErrorCode() {
        return bpmnErrorCode;
    }
}
```

Handling:

- invalid contract → fail job/no retry or limited retry + incident,
- business rejection → throw BPMN error,
- transient technical failure → fail job with retry,
- unknown exception → fail job with controlled retry.

---

## 27. Variable Governance in a Large Organization

Jika Camunda dipakai oleh banyak team, variable governance wajib.

### 27.1 Naming Convention

Contoh convention:

| Category | Pattern | Example |
|---|---|---|
| Business id | `<entity>Id` | `caseId`, `applicationId` |
| External reference | `<system><Entity>Reference` | `paymentProviderReference` |
| Decision | `<domain>Decision` | `reviewDecision` |
| Status | `<domain>Status` | `paymentStatus` |
| Timestamp | `<event>At` | `submittedAt`, `reviewedAt` |
| Deadline | `<milestone>Deadline` | `appealDeadline` |
| Input object | `<task>Input` | `addressCheckInput` |
| Worker result | `<task>Result` only if scoped | `riskAssessmentResult` |

### 27.2 Reserved Names

Larangan nama generik:

```text
status
state
result
payload
data
response
error
message
flag
approved
id
```

Bukan berarti tidak pernah boleh, tetapi harus justified dan scoped.

### 27.3 Variable Registry

Untuk proses besar, buat registry:

| Variable | Type | Owner | Scope | Used By | Sensitive | Version |
|---|---|---|---|---|---:|---|
| caseId | string | process starter | root | all workers | no | 1 |
| riskBand | enum | risk worker | root | gateway, Optimize | no | 1 |
| reviewDecision | enum | review task | root | gateway, audit | maybe | 1 |
| documentBundleId | string | document service | root | document workers | no | 1 |

### 27.4 Review Checklist

Setiap BPMN PR/release harus review:

- Apakah ada variable baru?
- Apakah variable punya owner?
- Apakah nama spesifik?
- Apakah sensitive?
- Apakah payload kecil?
- Apakah schema documented?
- Apakah worker compatible?
- Apakah gateway condition safe?
- Apakah form binding aman?
- Apakah Optimize/report bergantung variable ini?

---

## 28. Common Anti-Patterns

### 28.1 Dump Entire Request as Variable

```json
{
  "request": { "full": "api request" }
}
```

Masalah:

- sensitive leakage,
- large payload,
- schema uncontrolled,
- request shape bukan process contract.

### 28.2 Dump Entire External Response

```json
{
  "creditBureauResponse": { "very": "large" }
}
```

Lebih baik summary + reference.

### 28.3 Generic Status Everywhere

```json
{ "status": "DONE" }
```

Gunakan `paymentStatus`, `reviewStatus`, `documentCheckStatus`.

### 28.4 Boolean Explosion

```json
{
  "approved": true,
  "checked": true,
  "valid": false,
  "manual": false
}
```

Lebih baik decision/status enum yang jelas.

### 28.5 Worker Reads Everything

Worker yang membaca semua variable biasanya terlalu coupled.

### 28.6 Process Variable as Cache

Jangan menyimpan response hanya untuk menghindari panggilan service kalau data itu bukan orchestration state. Gunakan cache/service layer.

### 28.7 Process Variable as Database

Jika variable menjadi ratusan field dan seluruh business entity ada di dalamnya, desain sudah menyimpang.

### 28.8 No Versioning

Job type `validate-application` dipakai bertahun-tahun, tetapi input/output berubah diam-diam. Ini incident waiting to happen.

---

## 29. Worked Example: Regulatory Application Review

Kita desain variable untuk proses regulatory application review.

### 29.1 Naive Design

```json
{
  "application": {
    "id": "APP-2026-0001",
    "applicant": {
      "name": "Full Name",
      "nric": "S1234567A",
      "address": "Full Address",
      "email": "x@example.com"
    },
    "documents": [
      { "name": "passport.pdf", "base64": "..." }
    ],
    "reviews": [],
    "status": "SUBMITTED"
  }
}
```

Masalah:

- PII masuk variable,
- document masuk variable,
- status generik,
- reviews tumbuh besar,
- process menjadi database,
- sulit versioning,
- Operate/projection menyimpan data sensitif,
- worker contract tidak jelas.

### 29.2 Production-Grade Variable Set

Startup variables:

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "applicantRef": "APLCT-71ff9",
  "submissionChannel": "ONLINE",
  "submittedAt": "2026-06-20T09:30:00+08:00",
  "documentBundleId": "DOCB-2026-0001",
  "caseType": "NEW_LICENSE_APPLICATION"
}
```

Risk assessment output:

```json
{
  "riskAssessment": {
    "outcome": "MEDIUM_RISK",
    "scoreBand": "MEDIUM",
    "policyVersion": "RISK-2026.1",
    "reference": "RISK-REF-2026-9981",
    "assessedAt": "2026-06-20T10:00:00+08:00"
  }
}
```

Document check summary:

```json
{
  "documentCheckStatus": "FAILED",
  "failedDocumentCount": 1,
  "documentCheckBatchReference": "DOCCHK-2026-001"
}
```

Review task result:

```json
{
  "reviewDecision": "NEEDS_MORE_INFO",
  "reviewedByUserId": "user-123",
  "reviewedAt": "2026-06-20T15:20:00+08:00",
  "reviewCommentReference": "COMMENT-2026-0001"
}
```

Final decision:

```json
{
  "finalDecision": {
    "outcome": "APPROVED",
    "decisionReference": "DEC-2026-0001",
    "decidedAt": "2026-06-25T11:00:00+08:00",
    "policyVersion": "LICENSING-2026.2"
  }
}
```

### 29.3 Why This Is Better

- PII minimized.
- Documents stored externally.
- Variable names specific.
- Audit metadata captured.
- Gateway can read stable fields.
- Optimize can report by `riskAssessment.scoreBand` or `finalDecision.outcome`.
- Workers can have small input contracts.
- Schema evolution manageable.

---

## 30. Worked Example: Worker Contract and DTO

### 30.1 BPMN Service Task

Job type:

```text
risk-assessment.v1
```

Input variable:

```json
{
  "riskAssessmentInput": {
    "schemaVersion": 1,
    "caseId": "CASE-2026-0001",
    "applicationId": "APP-2026-0001",
    "applicantRef": "APLCT-71ff9",
    "caseType": "NEW_LICENSE_APPLICATION"
  }
}
```

Output:

```json
{
  "riskAssessment": {
    "schemaVersion": 1,
    "outcome": "MEDIUM_RISK",
    "scoreBand": "MEDIUM",
    "policyVersion": "RISK-2026.1",
    "reference": "RISK-REF-2026-9981",
    "assessedAt": "2026-06-20T10:00:00+08:00"
  }
}
```

### 30.2 Java 17+ DTO

```java
public record RiskAssessmentInput(
    int schemaVersion,
    String caseId,
    String applicationId,
    String applicantRef,
    String caseType
) {
    public RiskAssessmentInput {
        if (schemaVersion != 1) {
            throw new IllegalArgumentException("Unsupported schemaVersion: " + schemaVersion);
        }
        requireNonBlank(caseId, "caseId");
        requireNonBlank(applicationId, "applicationId");
        requireNonBlank(applicantRef, "applicantRef");
        requireNonBlank(caseType, "caseType");
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is required");
        }
    }
}
```

```java
public record RiskAssessmentOutput(
    RiskAssessment riskAssessment
) {}

public record RiskAssessment(
    int schemaVersion,
    String outcome,
    String scoreBand,
    String policyVersion,
    String reference,
    OffsetDateTime assessedAt
) {}
```

### 30.3 Worker Flow

```java
@JobWorker(type = "risk-assessment.v1")
public RiskAssessmentOutput assess(RiskAssessmentInput input) {
    RiskAssessmentCommand command = new RiskAssessmentCommand(
        input.caseId(),
        input.applicationId(),
        input.applicantRef(),
        input.caseType()
    );

    RiskAssessmentResult result = riskService.assess(command);

    return new RiskAssessmentOutput(
        new RiskAssessment(
            1,
            result.outcome().name(),
            result.scoreBand().name(),
            result.policyVersion(),
            result.reference(),
            result.assessedAt()
        )
    );
}
```

Catatan: contoh ini fokus contract. Dalam production, tambahkan idempotency, error mapping, logging, metrics, dan tracing seperti part sebelumnya.

---

## 31. Migration from Camunda 7 Variable Mindset

Jika berasal dari Camunda 7, perhatikan beberapa perubahan mental model.

### 31.1 Dari Java Object ke JSON Contract

Camunda 7 sering mengizinkan Java object variable. Camunda 8 mendorong JSON-compatible variable. Ini bukan keterbatasan semata; ini desain yang lebih cocok untuk distributed orchestration.

Migration action:

- inventory semua variable Java object,
- ubah menjadi primitive/JSON DTO,
- pisahkan business entity dari process variable,
- buat schema/version,
- ubah JavaDelegate menjadi worker contract.

### 31.2 Dari Engine Transaction ke Worker Boundary

Camunda 7 embedded engine sering berada dalam transaction yang sama dengan aplikasi. Camunda 8 worker remote berarti variable update dan business DB update perlu didesain dengan idempotency/outbox.

Data contract harus mempertimbangkan:

- duplicate job execution,
- job completion failure,
- external side effect,
- variable update retry,
- process version compatibility.

### 31.3 Dari History Query ke Projection/Audit Design

Jika dulu query history Camunda 7 dipakai sebagai reporting source, di Camunda 8 pikirkan projection/exporter/Optimize/custom read model.

Variable yang dipakai reporting harus stabil.

---

## 32. Production Checklist

Gunakan checklist ini untuk setiap proses/job worker.

### 32.1 Variable Checklist

- [ ] Semua variable root punya nama spesifik.
- [ ] Tidak ada `payload`, `data`, `status`, `result` generik tanpa scope jelas.
- [ ] Tidak ada huge payload/base64/raw document.
- [ ] Tidak ada token/secret/API credential.
- [ ] PII diminimalkan.
- [ ] Full business entity tidak disimpan sebagai variable.
- [ ] External response besar disimpan sebagai reference.
- [ ] Date/time menggunakan ISO-8601.
- [ ] Currency/amount tidak memakai floating point sembarangan.
- [ ] Enum values terdokumentasi.
- [ ] Null/missing semantics jelas.
- [ ] Owner variable jelas.
- [ ] Consumer variable diketahui.

### 32.2 Worker Contract Checklist

- [ ] Job type versioned jika perlu.
- [ ] Input variables documented.
- [ ] Output variables documented.
- [ ] BPMN errors documented.
- [ ] Technical failure behavior documented.
- [ ] Idempotency key documented.
- [ ] Validation dilakukan sebelum side effect.
- [ ] Output mapping membatasi merge.
- [ ] Worker tidak mengambil semua variable tanpa alasan.
- [ ] Sensitive variable tidak dikirim ke worker yang tidak perlu.

### 32.3 BPMN Data Flow Checklist

- [ ] Input mapping dipakai untuk membentuk task contract.
- [ ] Output mapping dipakai untuk membatasi result.
- [ ] Gateway expression membaca field stable.
- [ ] Default/error path tersedia untuk invalid data.
- [ ] Multi-instance output tidak collision.
- [ ] Call activity propagation dikontrol.
- [ ] User form binding tidak mencemari global variable.

### 32.4 Versioning Checklist

- [ ] Perubahan variable diklasifikasikan compatible/breaking.
- [ ] Running old instances dipertimbangkan.
- [ ] Worker lama/baru compatibility dipertimbangkan.
- [ ] Optimize/report/dashboard consumer dicek.
- [ ] Migration script/process modification dipertimbangkan jika perlu.

---

## 33. Staff-Level Heuristics

Jika ingin berpikir seperti engineer top-tier, gunakan heuristic berikut.

### 33.1 Every Variable Is a Public API

Walaupun hanya internal, process variable adalah API antara:

- BPMN model,
- worker,
- forms,
- gateways,
- reports,
- support tooling,
- audit,
- future versions.

Treat it as public contract.

### 33.2 Store Decisions, References, and Milestones; Not Raw Worlds

Variable terbaik biasanya berisi:

- identifier,
- decision,
- status summary,
- timestamp,
- policy version,
- external reference,
- routing flag yang jelas.

Variable terburuk biasanya berisi:

- full payload,
- raw response,
- document content,
- mutable business entity,
- catch-all object.

### 33.3 Make Process Data Boring

Process variable harus predictable dan boring. Jangan terlalu pintar. Jangan terlalu dynamic. Jangan terlalu generic.

Jika process data membosankan, operasi production jauh lebih mudah.

### 33.4 Prefer Explicitness Over Convenience

Lebih baik menulis:

```json
{
  "documentCheckStatus": "PASSED",
  "documentCheckBatchReference": "DOCCHK-1"
}
```

daripada:

```json
{
  "result": "ok"
}
```

### 33.5 A Variable Without Owner Is Technical Debt

Jika tidak ada owner, tidak ada yang tahu kapan boleh mengubahnya.

---

## 34. Common Review Questions

Gunakan pertanyaan ini saat design review.

1. Variable mana yang menjadi source untuk gateway decision?
2. Apakah variable tersebut selalu ada sebelum gateway dievaluasi?
3. Siapa yang menulis variable tersebut?
4. Apakah ada dua worker yang bisa menulis variable yang sama?
5. Apakah value enum bisa bertambah?
6. Apa yang terjadi jika field missing/null?
7. Apakah variable ini sensitive?
8. Apakah variable ini perlu masuk Optimize/report?
9. Apakah process instance lama masih compatible jika field berubah?
10. Apakah worker membaca variable lebih banyak dari yang dibutuhkan?
11. Apakah output mapping mencegah global pollution?
12. Apakah raw external response disimpan sebagai variable?
13. Apakah document/base64 pernah masuk variable?
14. Apakah user task form menulis ke field yang aman?
15. Apakah call activity propagate terlalu banyak?
16. Apakah multi-instance output collision-safe?
17. Apakah date/time format audit-friendly?
18. Apakah amount/currency precision aman?
19. Apakah variable registry diperbarui?
20. Apakah runbook support tahu arti variable penting?

---

## 35. Mini-Lab: Refactor Bad Variable Design

### 35.1 Input Buruk

```json
{
  "payload": {
    "id": "APP-1",
    "user": {
      "name": "Jane",
      "nric": "S1234567A",
      "email": "jane@example.com"
    },
    "docs": [
      { "file": "base64..." }
    ]
  },
  "status": "NEW",
  "approved": false
}
```

### 35.2 Refactor Target

```json
{
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-1",
  "applicantRef": "APLCT-9fa1",
  "documentBundleId": "DOCB-2026-0001",
  "caseStatus": "SUBMITTED",
  "reviewDecision": "PENDING",
  "submittedAt": "2026-06-20T09:30:00+08:00"
}
```

### 35.3 Explanation

- `payload.id` menjadi `applicationId`.
- PII user diganti `applicantRef`.
- Base64 docs diganti `documentBundleId`.
- `status` diganti `caseStatus`.
- `approved` boolean diganti `reviewDecision` enum.
- Ditambah timestamp eksplisit.

---

## 36. Ringkasan

Bagian ini membentuk disiplin data untuk Camunda 8/Zeebe.

Poin terpenting:

1. Variable bukan database.
2. Variable adalah orchestration contract.
3. Camunda 8 variable adalah JSON-compatible process data dengan scope.
4. Scope harus dipahami: root vs local.
5. Input/output mapping adalah contract boundary.
6. Worker harus memakai DTO contract, bukan membaca global map sembarangan.
7. Huge payload, PII, raw response, dan document content harus dihindari.
8. Gunakan reference-over-payload.
9. Date/time, enum, null, number, dan currency harus punya policy.
10. Variable harus versioned dan owner-nya jelas.
11. Multi-instance, call activity, user task, dan message correlation punya risiko variable pollution sendiri.
12. Variable yang baik membuat debugging, audit, migration, dan scaling lebih mudah.

---

## 37. Sumber Utama

Materi ini disusun dengan mengacu pada dokumentasi resmi Camunda 8 terbaru tentang:

- Camunda 8 Variables dan variable scope.
- Data handling di Modeler.
- BPMN data flow dan input/output variable mappings.
- Service task variable mapping behavior.
- Multi-instance input/output mapping.
- Call activity variable propagation.
- Optimize object/list variable support dan date format consideration.
- Migration readiness dari Camunda 7 ke Camunda 8 terkait primitive/JSON variable.
- Orchestration Cluster/Operate variable APIs dan consistency note.

Referensi konseptual tambahan berasal dari praktik umum distributed systems, schema evolution, API contract governance, secure data minimization, dan long-running workflow design.

---

## 38. Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-009.md
```

Judul:

```text
Part 009 — BPMN Modelling for Distributed Execution: Advanced Patterns and Anti-Patterns
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-007.md">⬅️ Part 007 — Worker Correctness: Idempotency, Retries, Duplicate Execution, and External Side Effects</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-009.md">Part 009 — BPMN Modelling for Distributed Execution: Advanced Patterns and Anti-Patterns ➡️</a>
</div>
