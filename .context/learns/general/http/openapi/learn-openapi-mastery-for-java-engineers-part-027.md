# OpenAPI Mastery for Java Engineers — Part 027
# Advanced Schema Evolution: Long-Lived APIs, Consumer Diversity, and Semantic Drift

> Seri: `learn-openapi-mastery-for-java-engineers`  
> Part: `027 / 030`  
> Fokus: schema evolution untuk API jangka panjang, backward/forward compatibility, consumer diversity, semantic drift, dan strategi menjaga kontrak tetap hidup tanpa terus membuat major version baru.

---

## 0. Tujuan Pembelajaran

Di bagian sebelumnya kita sudah membahas OpenAPI untuk sistem regulated, auditable, dan high-risk. Sekarang kita masuk ke salah satu area yang memisahkan engineer biasa dari engineer yang benar-benar matang dalam API engineering: **evolution**.

Banyak engineer bisa mendesain API yang terlihat bersih pada hari pertama. Jauh lebih sedikit yang bisa mendesain API yang tetap aman setelah:

- dipakai banyak consumer dengan lifecycle berbeda,
- mobile app lama masih aktif di lapangan,
- partner belum upgrade SDK,
- enum bisnis bertambah,
- field yang dulu sederhana berubah makna,
- validasi diperketat karena compliance,
- domain berubah karena regulasi,
- sistem internal direfaktor,
- data lama tetap harus dibaca,
- API gateway, generated client, dan server validation punya perilaku berbeda.

Target part ini: setelah selesai, kamu mampu melihat schema OpenAPI sebagai **living compatibility boundary**, bukan hanya bentuk JSON saat ini.

Kita akan membahas:

1. Apa arti schema evolution dalam konteks OpenAPI.
2. Perbedaan backward compatibility dan forward compatibility.
3. Kenapa consumer diversity membuat perubahan kecil menjadi berisiko besar.
4. Cara berpikir tentang optional, nullable, default, enum, unknown fields, dan constraints.
5. Strategi field deprecation, replacement, splitting, merging, dan type widening.
6. Cara mendeteksi semantic drift yang tidak tampak dari schema diff.
7. Review checklist untuk perubahan schema API jangka panjang.

---

## 1. Core Mental Model: API Schema Is a Time-Spanning Contract

Schema OpenAPI bukan hanya menyatakan:

> “Response hari ini punya field seperti ini.”

Schema yang baik juga menyatakan:

> “Consumer boleh membangun asumsi apa terhadap data ini, dan asumsi itu akan tetap aman selama API berevolusi.”

Ini penting karena kontrak API selalu punya dimensi waktu.

```text
Provider today  ----contract---->  Consumer today
Provider future ----contract---->  Consumer old versions
Provider today  ----contract---->  Consumer future tolerant clients
```

Jika hanya ada satu server dan satu client yang dirilis bersamaan, schema evolution relatif mudah. Tetapi sistem nyata jarang seperti itu.

Biasanya ada:

- backend provider versi terbaru,
- web frontend yang deploy harian,
- mobile app yang update lambat,
- partner integration yang upgrade per kuartal,
- batch job yang memakai API lama,
- generated SDK versi lama,
- API gateway cache/validation layer,
- QA automation dengan fixture lama,
- BI/reporting consumer yang membaca response secara longgar,
- compliance/archive consumer yang butuh stabilitas historis.

Maka pertanyaan schema evolution bukan hanya:

> “Apakah JSON ini valid menurut schema?”

Tetapi:

> “Apakah perubahan ini masih aman untuk seluruh class consumer yang masuk akal, termasuk consumer yang tidak kita lihat langsung?”

---

## 2. The Three Compatibility Axes

Dalam API evolution, minimal ada tiga axis compatibility.

### 2.1 Provider Backward Compatibility

Perubahan provider backward compatible jika **consumer lama masih bisa bekerja** setelah provider berubah.

Contoh umumnya:

```yaml
CaseSummary:
  type: object
  required:
    - id
    - status
  properties:
    id:
      type: string
    status:
      type: string
    priority:
      type: string
```

Jika response lama hanya punya `id` dan `status`, lalu provider menambahkan `priority`, secara umum ini backward compatible **jika consumer lama mengabaikan unknown fields**.

Namun tidak selalu aman. Kita akan bahas nanti.

### 2.2 Consumer Forward Compatibility

Consumer forward compatible jika consumer bisa bertahan menghadapi response masa depan yang valid tapi belum dikenal saat consumer dibuat.

Contoh:

- consumer tidak gagal saat ada field tambahan,
- consumer tidak crash saat enum value baru muncul,
- consumer tidak mengasumsikan list selalu lengkap,
- consumer punya default handling untuk status yang belum dikenal,
- consumer tidak melakukan exhaustive switch tanpa fallback.

Forward compatibility sering lebih banyak ditentukan oleh **client implementation discipline** daripada OpenAPI schema saja.

### 2.3 Semantic Compatibility

Semantic compatibility berarti makna field, operation, dan response tetap konsisten.

Schema bisa tidak berubah, tetapi kontrak tetap breaking secara semantik.

Contoh:

```yaml
status:
  type: string
  enum:
    - OPEN
    - CLOSED
```

Dulu `CLOSED` berarti kasus selesai final. Setelah regulasi baru, `CLOSED` berarti kasus selesai tahap investigasi tapi masih bisa diajukan banding.

Schema tidak berubah. Tetapi consumer yang memakai `CLOSED` untuk menghentikan reminder, menutup SLA, atau menonaktifkan appeal button bisa rusak.

Inilah **semantic drift**.

---

## 3. Schema Evolution Is Hard Because Consumers Are Not Homogeneous

Banyak diskusi API compatibility gagal karena mengasumsikan hanya ada satu jenis consumer.

Dalam praktik, consumer berbeda dalam banyak dimensi.

### 3.1 Consumer by Runtime

```text
Browser web app       -> update cepat, tapi cache dan bundle lama bisa bertahan
Mobile app            -> update lambat, banyak versi aktif
Partner backend       -> release cycle lambat, approval formal
Internal service      -> lebih cepat, tapi ownership tersebar
Batch job             -> jarang dimonitor, sering rapuh
Generated SDK user    -> tergantung generator behavior
Low-code integration  -> field mapping sering statis
Data pipeline         -> toleran schema? kadang justru sangat ketat
```

### 3.2 Consumer by Parsing Strictness

Ada consumer yang:

- strict terhadap unknown fields,
- longgar terhadap unknown fields,
- strict terhadap enum,
- memperlakukan enum sebagai string bebas,
- memakai generated model dengan validation ketat,
- memakai JSON tree/dictionary,
- memakai schema registry/contract validation,
- memakai manual deserialization.

Perubahan yang aman untuk satu consumer bisa berbahaya untuk consumer lain.

### 3.3 Consumer by Business Assumption

Consumer juga berbeda dalam asumsi bisnis:

- status tertentu mengaktifkan tombol UI,
- absence of field dianggap `false`,
- empty array dianggap tidak ada data,
- `null` dianggap “tidak berlaku”,
- missing property dianggap “belum dihitung”,
- enum unknown dianggap error fatal,
- timestamp dianggap immutable,
- amount dianggap dalam currency tertentu.

OpenAPI schema bisa mendokumentasikan sebagian, tetapi tidak semua asumsi ini otomatis terlihat.

Top 1% engineer akan bertanya:

> “Consumer mana yang mungkin memiliki asumsi terhadap field ini?”

Bukan hanya:

> “Apakah field ini optional?”

---

## 4. Backward Compatibility: What Is Usually Safe, Usually Risky, and Usually Breaking

Mari kita buat model kasar.

### 4.1 Usually Safe Changes

Biasanya aman:

- menambahkan optional response field,
- menambahkan optional request field yang benar-benar optional,
- menambahkan new endpoint,
- menambahkan new response code jika existing success/error behavior tetap terdokumentasi dan consumer tidak strict,
- memperluas description/documentation,
- menambahkan examples,
- menambahkan non-required metadata,
- menambahkan enum value hanya jika consumer sudah didesain toleran.

Perhatikan kata **biasanya**. Tidak ada jaminan absolut.

### 4.2 Usually Risky Changes

Risky:

- menambahkan enum value,
- menambahkan required response field pada schema yang dipakai generator,
- mengubah constraint validation,
- memperketat pattern string,
- mengubah default behavior,
- mengubah pagination ordering,
- menambahkan error response baru,
- mengubah deskripsi field tanpa mengubah nama,
- mengubah format timestamp,
- memperkenalkan null pada field yang sebelumnya selalu ada,
- mengubah field dari scalar ke object,
- mengubah semantics of absence.

### 4.3 Usually Breaking Changes

Umumnya breaking:

- menghapus field response yang dipakai consumer,
- menghapus operation,
- mengubah path atau method,
- mengganti `operationId`,
- mengubah required request field,
- mengubah type field,
- mengubah enum value lama,
- menghapus enum value,
- mengubah auth requirement,
- mengubah media type,
- mengubah response envelope,
- mengubah error shape,
- mengubah ID semantics,
- mengubah meaning field secara diam-diam.

---

## 5. Optional Field Semantics: Missing Does Not Mean One Thing

Salah satu sumber bug terbesar adalah field optional.

Dalam OpenAPI/JSON Schema, field optional berarti field tidak harus ada. Tetapi secara domain, absence bisa berarti banyak hal.

```yaml
Case:
  type: object
  required:
    - id
    - status
  properties:
    id:
      type: string
    status:
      type: string
    assignedOfficerId:
      type: string
```

`assignedOfficerId` tidak required. Apa artinya jika tidak ada?

Kemungkinan:

1. Kasus belum diassign.
2. Consumer tidak punya permission melihat assignee.
3. Data sedang dimigrasi.
4. Field hanya muncul pada detail endpoint, bukan list endpoint.
5. Field hanya muncul jika include parameter dipakai.
6. Server lama belum mengisi field.
7. Assignee ada tapi anonymized.
8. Data rusak.

Jika semua kemungkinan ini dibiarkan implisit, consumer akan membuat asumsi sendiri.

### 5.1 Better Modelling

Gunakan field yang memisahkan state, visibility, dan value.

```yaml
CaseAssignment:
  type: object
  required:
    - assignmentState
  properties:
    assignmentState:
      type: string
      enum:
        - UNASSIGNED
        - ASSIGNED
        - RESTRICTED
    assignedOfficerId:
      type: string
      description: Present only when assignmentState is ASSIGNED and the caller is authorized to view the assignee.
```

Ini tidak sempurna, tetapi jauh lebih eksplisit.

### 5.2 Rule of Thumb

Jika absence memiliki business meaning, jangan hanya mengandalkan optional property.

Tambahkan:

- explicit state field,
- description yang menjelaskan absence,
- examples untuk variasi,
- tests untuk setiap case,
- governance rule agar optional critical fields harus punya semantic note.

---

## 6. Nullable Field Semantics: Null Is Not Missing

Dalam JSON, perbedaan antara missing dan `null` penting.

```json
{}
```

berbeda dari:

```json
{ "assignedOfficerId": null }
```

Namun banyak application code memperlakukan keduanya sama.

Dalam Java, perbedaannya bisa hilang jika mapping tidak hati-hati:

```java
class CaseDto {
    private String assignedOfficerId;
}
```

Baik missing maupun `null` akan menjadi `null` di field Java biasa.

### 6.1 Three-State Problem

Kadang kamu butuh tiga state:

```text
missing -> not provided / no change / not selected
null    -> explicitly cleared / explicitly unknown / intentionally empty
value   -> provided value
```

Ini sangat penting untuk PATCH.

Contoh buruk:

```yaml
PatchCaseRequest:
  type: object
  properties:
    assignedOfficerId:
      type:
        - string
        - 'null'
```

Apa arti tidak ada field? Apa arti null? Apa arti empty string?

Versi lebih eksplisit:

```yaml
PatchCaseAssignmentRequest:
  type: object
  required:
    - action
  properties:
    action:
      type: string
      enum:
        - ASSIGN
        - UNASSIGN
    officerId:
      type: string
      description: Required when action is ASSIGN. Must be absent when action is UNASSIGN.
```

### 6.2 Nullable Response Fields

Nullable response field perlu dijelaskan:

```yaml
decisionDate:
  type:
    - string
    - 'null'
  format: date
  description: Null until a final decision has been recorded.
```

Ini lebih baik daripada hanya:

```yaml
decisionDate:
  type: string
  format: date
  nullable: true
```

Catatan: di OAS 3.1/3.2, modelling null mengikuti JSON Schema style dengan type union seperti `type: [string, 'null']`, sedangkan OAS 3.0 sering memakai `nullable: true`.

---

## 7. Unknown Fields: Provider Flexibility vs Consumer Strictness

Menambahkan optional response field sering dianggap aman. Namun ini bergantung pada consumer.

Consumer yang memakai Jackson default biasanya mengabaikan unknown properties jika dikonfigurasi demikian. Tetapi banyak setup bisa strict.

Contoh:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Jika consumer strict, response field baru bisa breaking.

### 7.1 Provider-Side Contract Strategy

Untuk API publik atau partner, dokumentasikan expectation:

> Consumers must ignore unknown response properties unless explicitly stated otherwise.

Dalam OpenAPI, ini bisa diperkuat lewat description dan style guide.

Tapi OpenAPI schema sendiri sering membuat orang salah membaca.

```yaml
Case:
  type: object
  additionalProperties: false
```

Ini mengatakan object tidak boleh memiliki property tambahan di luar schema. Untuk provider response, ini bisa menjadi sinyal bahwa field set tertutup. Jika nanti provider menambahkan field, secara schema diff itu perubahan contract.

Untuk long-lived public response, hati-hati memakai `additionalProperties: false`.

### 7.2 Different Rules for Request and Response

Request dan response punya arah toleransi berbeda.

Untuk request:

```text
Consumer -> Provider
```

Provider mungkin ingin strict agar typo field tidak diam-diam diterima.

Untuk response:

```text
Provider -> Consumer
```

Consumer sebaiknya toleran agar additive fields tidak merusak.

Maka policy bisa seperti:

```text
Requests: reject unknown fields for command endpoints where safety matters.
Responses: consumers must ignore unknown fields.
```

Tetapi berhati-hati: generated client validation bisa tetap strict jika schema mengatakan closed object.

---

## 8. Enum Evolution: The Classic Trap

Enum terlihat rapi, tetapi sangat berbahaya untuk evolusi.

```yaml
CaseStatus:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - CLOSED
```

Menambahkan value baru tampak additive:

```yaml
    - REOPENED
```

Namun consumer lama bisa gagal.

### 8.1 Why Adding Enum Value Can Break Consumers

#### Java switch expression

```java
return switch (status) {
    case DRAFT -> "Draft";
    case SUBMITTED -> "Submitted";
    case UNDER_REVIEW -> "Under review";
    case CLOSED -> "Closed";
};
```

Jika generated enum tidak mengenal `REOPENED`, deserialization bisa gagal sebelum switch.

#### TypeScript exhaustive union

```ts
type CaseStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CLOSED';
```

Value baru dari server bisa masuk sebagai unexpected string.

#### UI business logic

```text
if status == CLOSED -> hide action buttons
```

Status baru mungkin butuh behavior khusus.

### 8.2 Enum Categories

Tidak semua enum sama.

#### Stable protocol enum

Contoh:

```text
ASC | DESC
```

Jarang berubah.

#### Domain lifecycle enum

Contoh:

```text
DRAFT | SUBMITTED | UNDER_REVIEW | CLOSED | REOPENED
```

Sangat mungkin berubah.

#### Regulatory classification enum

Contoh:

```text
LOW_RISK | MEDIUM_RISK | HIGH_RISK | CRITICAL
```

Bisa berubah karena policy.

#### Business configuration enum

Contoh:

```text
VIOLATION_TYPE_A | VIOLATION_TYPE_B | VIOLATION_TYPE_C
```

Sering berubah. Jangan selalu dimodelkan sebagai closed enum.

### 8.3 Safer Enum Evolution Patterns

#### Pattern A: Open string with documented known values

```yaml
riskCategory:
  type: string
  description: >
    Known values include LOW, MEDIUM, HIGH, and CRITICAL.
    Consumers must tolerate unknown values.
```

Kelemahan: validation lebih lemah.

#### Pattern B: Enum plus unknown fallback in generated clients

Butuh generator support/configuration.

```text
UNKNOWN_DEFAULT_OPEN_API
```

Beberapa generator menyediakan strategi unknown enum default. Namun jangan mengandalkan tanpa test.

#### Pattern C: Code + label + category

```yaml
ViolationType:
  type: object
  required:
    - code
    - label
  properties:
    code:
      type: string
      description: Stable machine-readable code. Consumers must tolerate unknown codes.
    label:
      type: string
      description: Human-readable label for display.
    category:
      type: string
      description: Stable high-level grouping.
```

Ini cocok untuk value yang sering berubah.

#### Pattern D: Separate state machine from display/status taxonomy

Untuk workflow, jangan campur semua status menjadi satu enum besar jika sebagian status untuk internal, sebagian untuk external, sebagian untuk UI.

```yaml
caseLifecycleState:
  type: string
  enum:
    - OPEN
    - ACTIVE
    - SUSPENDED
    - CLOSED

caseDisplayStatus:
  type: string
  description: Human-oriented status label. Values may evolve.
```

---

## 9. Default Values: Helpful, Dangerous, Often Misunderstood

OpenAPI `default` sering disalahpahami.

`default` bukan selalu berarti server otomatis mengisi field jika tidak dikirim. Dalam JSON Schema, default bersifat annotation. Tool bisa memakainya, tetapi validation tidak selalu menerapkannya.

Contoh:

```yaml
pageSize:
  type: integer
  default: 50
```

Pertanyaan penting:

1. Apakah server benar-benar memakai 50 jika absent?
2. Apakah default bisa berubah nanti?
3. Apakah generated client akan mengirim 50 secara eksplisit?
4. Apakah documentation dan runtime konsisten?
5. Apakah default sama di semua endpoint?

### 9.1 Default Evolution Risk

Mengubah default bisa breaking secara semantik.

Contoh:

```text
Default pageSize: 50 -> 100
```

Schema diff mungkin terlihat kecil. Tetapi consumer yang mengandalkan response size, latency, memory, atau pagination behavior bisa terdampak.

Contoh lain:

```text
includeClosed=false -> includeClosed=true
```

Ini jelas bisa mengubah business result.

### 9.2 Safer Default Policy

Untuk default yang penting:

- dokumentasikan eksplisit di parameter description,
- test runtime behavior,
- jangan mengubah default tanpa compatibility review,
- pertimbangkan versioned behavior jika default harus berubah,
- minta consumer mengirim nilai eksplisit untuk behavior kritikal.

Contoh:

```yaml
includeClosed:
  name: includeClosed
  in: query
  required: false
  schema:
    type: boolean
    default: false
  description: >
    When absent, the server behaves as if false. This default is part of the API compatibility contract.
```

Kalimat terakhir penting. Ia membuat default bukan sekadar hint dokumentasi.

---

## 10. Constraint Evolution: Tightening vs Loosening

Schema constraints tampak teknis, tetapi punya dampak compatibility.

### 10.1 Request Constraint Tightening

Contoh:

```yaml
comment:
  type: string
  maxLength: 5000
```

Diubah menjadi:

```yaml
comment:
  type: string
  maxLength: 1000
```

Ini breaking untuk consumer yang sebelumnya sah mengirim 3000 karakter.

Constraint tightening pada request hampir selalu breaking.

Contoh tightening:

- menurunkan `maxLength`,
- menaikkan `minLength`,
- menurunkan `maximum`,
- menaikkan `minimum`,
- menambah `pattern`,
- menambah required field,
- menghapus allowed enum value,
- menolak unknown request fields padahal dulu diterima.

### 10.2 Request Constraint Loosening

Loosening request biasanya aman untuk consumer lama, tetapi bisa berisiko untuk provider dan downstream.

Contoh:

```yaml
maxLength: 1000 -> maxLength: 5000
```

Consumer lama tidak rusak. Tetapi sistem downstream mungkin punya batas database, queue, log, PDF generation, atau UI rendering.

### 10.3 Response Constraint Tightening

Response constraint tightening bisa aman atau breaking tergantung consumer.

Contoh:

```yaml
score:
  type: integer
  minimum: 0
  maximum: 100
```

Jika sebelumnya score bisa 0–1000 lalu sekarang 0–100, consumer lama mungkin aman jika hanya display. Tetapi jika consumer lama mengharapkan skala lama, ini semantic breaking.

### 10.4 Response Constraint Loosening

Response loosening sering berbahaya.

Contoh:

```yaml
maxItems: 100 -> maxItems: 1000
```

Consumer bisa overload.

```yaml
maximum: 100 -> maximum: 1000000
```

Consumer UI bisa overflow, validation client bisa gagal jika generated model lama masih punya bound.

### 10.5 Practical Rule

```text
Request stricter  -> likely breaking for consumers
Request looser    -> check provider/downstream safety
Response stricter -> check semantic assumptions
Response looser   -> likely breaking for strict consumers
```

---

## 11. Type Evolution: Widening, Narrowing, and Representation Changes

Mengubah type field hampir selalu risky.

### 11.1 Integer to Number

```yaml
amount:
  type: integer
```

menjadi:

```yaml
amount:
  type: number
```

Ini widening. Tetapi consumer yang memakai `int` bisa gagal jika menerima desimal.

### 11.2 Integer to String

Kadang ID numerik diubah menjadi string.

```yaml
caseId:
  type: integer
```

menjadi:

```yaml
caseId:
  type: string
```

Motivasi umum:

- ID terlalu besar untuk JavaScript number,
- format ID berubah menjadi prefixed ID,
- migrasi ke distributed ID.

Namun ini breaking. Lebih aman dari awal memakai string untuk external identifiers.

### 11.3 String Format Changes

```yaml
createdAt:
  type: string
  format: date-time
```

Jika format runtime berubah dari:

```text
2026-06-20T10:15:30Z
```

ke:

```text
2026-06-20T17:15:30+07:00
```

Keduanya bisa valid RFC 3339 style date-time, tetapi consumer parsing, display, dan comparison bisa berbeda.

Jika timestamp precision berubah:

```text
seconds -> milliseconds -> nanoseconds
```

consumer snapshot tests, cache keys, or equality checks bisa rusak.

### 11.4 Scalar to Object

```yaml
assignee:
  type: string
```

menjadi:

```yaml
assignee:
  type: object
  properties:
    id:
      type: string
    displayName:
      type: string
```

Ini breaking. Evolusi aman biasanya tambah field baru:

```yaml
assigneeId:
  type: string
assignee:
  $ref: '#/components/schemas/UserSummary'
```

Lalu deprecate `assigneeId` setelah lifecycle jelas.

### 11.5 Object to Reference

Hati-hati mengubah embedded object menjadi ID reference saja. Itu mengurangi data yang diterima consumer.

```yaml
subject:
  $ref: '#/components/schemas/SubjectSummary'
```

menjadi:

```yaml
subjectId:
  type: string
```

Ini hampir pasti breaking.

---

## 12. Field Addition: Additive Does Not Always Mean Safe

Menambahkan field response biasanya dianggap safe. Tetapi beberapa kasus tidak.

### 12.1 Strict Deserialization

Consumer strict bisa gagal pada unknown property.

### 12.2 Field Name Collision in Dynamic Consumers

Consumer low-code atau dynamic mapping bisa punya mapping otomatis:

```text
any field named `status` maps to UI status column
```

Field baru bisa mengubah behavior.

### 12.3 Semantic Confusion

Tambah field:

```yaml
state:
  type: string
```

padahal sudah ada:

```yaml
status:
  type: string
```

Consumer bingung mana yang authoritative.

### 12.4 Security Exposure

Field baru mungkin membocorkan data:

```yaml
internalRiskScore:
  type: integer
```

Meskipun optional, response runtime mungkin mengirim ke consumer yang tidak authorized.

### 12.5 Generated SDK Requiredness Bugs

Jika field ditambahkan ke schema dan salah masuk `required`, generated client/model bisa berubah besar.

### 12.6 Safer Field Addition Checklist

Sebelum menambahkan response field:

```text
[ ] Apakah field ini boleh dilihat semua caller endpoint ini?
[ ] Apakah namanya tidak ambigu dengan field lama?
[ ] Apakah absence semantics jelas?
[ ] Apakah null semantics jelas?
[ ] Apakah contoh sudah mencakup field present dan absent?
[ ] Apakah consumer lama wajib ignore unknown fields?
[ ] Apakah generated SDK berubah aman?
[ ] Apakah field ini stabil atau hanya business config volatile?
[ ] Apakah perlu feature flag atau gradual rollout?
```

---

## 13. Field Removal: Almost Never Just Remove

Menghapus field adalah perubahan paling jelas breaking.

Tetapi banyak tim tetap melakukannya karena:

- “field ini tidak dipakai frontend,”
- “search code tidak menemukan usage,”
- “ini internal API,”
- “sudah deprecated di comment,”
- “data selalu null,”
- “SDK baru tidak pakai.”

Semua alasan ini lemah jika tidak ada consumer inventory.

### 13.1 Removal Lifecycle

Lifecycle yang lebih aman:

```text
1. Identify candidate field
2. Mark deprecated in OpenAPI
3. Add description with replacement and timeline
4. Emit usage telemetry if possible
5. Notify known consumers
6. Keep field stable during deprecation period
7. Add contract test ensuring old field remains until removal date
8. Remove only in major version or agreed compatibility window
9. Publish migration guide
```

### 13.2 OpenAPI Deprecation

```yaml
legacyCaseNumber:
  type: string
  deprecated: true
  description: >
    Deprecated. Use caseReference.publicId instead.
    This field will remain available until 2027-01-31 for existing consumers.
```

`deprecated: true` alone tidak cukup. Harus ada replacement dan timeline.

### 13.3 Shadow Field Strategy

Saat mengganti field:

```yaml
legacyCaseNumber:
  type: string
  deprecated: true
caseReference:
  type: object
  required:
    - publicId
  properties:
    publicId:
      type: string
    jurisdiction:
      type: string
```

Server mengirim keduanya selama migrasi.

---

## 14. Splitting Fields

Field lama:

```yaml
fullName:
  type: string
```

Field baru:

```yaml
personName:
  type: object
  properties:
    givenName:
      type: string
    familyName:
      type: string
```

Splitting field sering diperlukan, tetapi tidak semantik-netral.

### 14.1 Risks

- beberapa nama tidak punya family name,
- ordering display berbeda per culture,
- old `fullName` mungkin sudah normalized,
- new fields mungkin partial,
- search behavior berubah,
- generated clients berubah.

### 14.2 Safer Strategy

```yaml
fullName:
  type: string
  deprecated: true
  description: Use displayName for presentation or structuredName for structured processing.

displayName:
  type: string

structuredName:
  type: object
  properties:
    givenName:
      type: string
    familyName:
      type: string
    additionalNames:
      type: array
      items:
        type: string
```

Jangan langsung memaksa semua consumer berpindah dari string ke object.

---

## 15. Merging Fields

Field lama:

```yaml
homePhone:
  type: string
mobilePhone:
  type: string
workPhone:
  type: string
```

Field baru:

```yaml
phoneNumbers:
  type: array
  items:
    type: object
    properties:
      type:
        type: string
      number:
        type: string
```

Merging memberi fleksibilitas, tetapi bisa breaking.

### 15.1 Migration Pattern

```yaml
homePhone:
  type: string
  deprecated: true
mobilePhone:
  type: string
  deprecated: true
workPhone:
  type: string
  deprecated: true
phoneNumbers:
  type: array
  items:
    $ref: '#/components/schemas/PhoneNumber'
```

Server menjaga legacy fields selama periode deprecation.

### 15.2 Consistency Problem

Jika kedua bentuk dikirim, mana yang authoritative?

Harus jelas:

```yaml
description: >
  phoneNumbers is authoritative. Legacy phone fields are derived from phoneNumbers
  for backward compatibility and may be removed in a future major version.
```

---

## 16. Field Rename: Treat as Add + Deprecate, Not Rename

Rename secara teknis adalah remove old + add new.

Jangan berpikir:

```text
caseNo -> caseNumber
```

sebagai perubahan kecil. Untuk consumer, field lama hilang.

### 16.1 Safer Rename Pattern

```yaml
caseNo:
  type: string
  deprecated: true
  description: Use caseNumber.
caseNumber:
  type: string
```

Runtime mengirim keduanya.

Untuk request, lebih rumit. Jika request menerima dua field, konflik mungkin terjadi.

```yaml
CreateCaseRequest:
  type: object
  properties:
    caseNo:
      type: string
      deprecated: true
    caseNumber:
      type: string
```

Harus ada rule:

```text
If both caseNo and caseNumber are supplied, request is rejected with 400.
```

Atau:

```text
caseNumber takes precedence.
```

Reject lebih aman untuk menghindari ambiguity.

---

## 17. Required Fields: Direction Matters

### 17.1 Adding Required Request Field

Breaking.

```yaml
CreateCaseRequest:
  required:
    - subjectId
    - allegationType
```

Menambahkan:

```yaml
    - jurisdiction
```

Consumer lama gagal.

### 17.2 Adding Optional Request Field

Biasanya safe, tetapi server behavior saat absent harus jelas.

```yaml
jurisdiction:
  type: string
  description: >
    Optional. When absent, jurisdiction is inferred from the authenticated user's default jurisdiction.
```

Jika inference bisa berubah, ini semantic risk.

### 17.3 Adding Required Response Field

Ini tampak safe karena server akan mengirim. Tetapi generated SDK/model bisa berubah.

Consumer yang membangun mock response atau test fixture berdasarkan schema bisa gagal karena required field baru.

Jadi untuk response, menambahkan field sebagai required juga risky.

### 17.4 Removing Required Response Field

Breaking.

### 17.5 Making Response Field Optional

Jika sebelumnya field required lalu sekarang optional, consumer lama mungkin crash jika field hilang. Ini breaking secara runtime walaupun schema tampak lebih permissive.

---

## 18. ReadOnly and WriteOnly Evolution

OpenAPI mendukung `readOnly` dan `writeOnly` untuk schema property.

```yaml
id:
  type: string
  readOnly: true
password:
  type: string
  writeOnly: true
```

### 18.1 Changing readOnly/writeOnly Is Compatibility-Relevant

Jika field berubah dari writable menjadi readOnly, request lama bisa ditolak.

Jika field berubah dari readOnly menjadi writable, security model bisa berubah.

Jika field writeOnly tiba-tiba muncul di response, itu bisa data leak.

### 18.2 Safer Practice

Pisahkan request dan response schema untuk field dengan lifecycle berbeda.

Buruk:

```yaml
User:
  type: object
  properties:
    id:
      type: string
      readOnly: true
    password:
      type: string
      writeOnly: true
```

Lebih jelas:

```yaml
CreateUserRequest:
  type: object
  required:
    - username
    - password
  properties:
    username:
      type: string
    password:
      type: string
      format: password

UserResponse:
  type: object
  required:
    - id
    - username
  properties:
    id:
      type: string
    username:
      type: string
```

---

## 19. additionalProperties and Closed/Open Object Evolution

`additionalProperties` sering dipakai untuk dua hal berbeda:

1. Map/dictionary modelling.
2. Menutup object agar tidak ada field ekstra.

### 19.1 Map Object

```yaml
metadata:
  type: object
  additionalProperties:
    type: string
```

Ini berarti `metadata` adalah map string-to-string.

### 19.2 Closed Object

```yaml
Case:
  type: object
  additionalProperties: false
```

Ini berarti property selain yang didefinisikan tidak valid.

### 19.3 Evolution Risk

Closed object membuat additive field menjadi schema-breaking. Untuk request, ini kadang diinginkan. Untuk response jangka panjang, ini bisa membatasi evolusi.

### 19.4 Suggested Policy

```text
Command request bodies:
  Prefer rejecting unknown fields when safety matters.

Query/filter objects:
  Reject unknown fields to catch typos.

Response bodies:
  Avoid promising closed object unless necessary.

Metadata maps:
  Use typed additionalProperties, not free object, where possible.
```

---

## 20. Schema Reuse and Evolution Coupling

Reuse mempercepat development tetapi bisa memperlambat evolution.

Contoh:

```yaml
Case:
  type: object
  properties:
    id:
      type: string
    status:
      type: string
    createdAt:
      type: string
      format: date-time
```

Dipakai di:

```text
GET /cases
GET /cases/{id}
POST /cases/search
GET /subjects/{id}/cases
GET /audit/cases/{id}
```

Jika kamu menambahkan field ke `Case`, semua endpoint berubah.

Jika kamu membuat `status` required, semua endpoint terdampak.

Jika kamu ingin field hanya muncul di detail, list endpoint ikut terkena.

### 20.1 Evolution-Friendly Schema Roles

Lebih baik pisahkan per role:

```text
CaseSummary
CaseDetail
CaseSearchResult
CaseAuditView
CaseCreateRequest
CaseUpdateRequest
CasePatchRequest
```

Ini bukan duplikasi buruk. Ini **intentional contract separation**.

### 20.2 Common Components Should Be Stable

Shared component harus lebih stabil daripada endpoint-specific schema.

Cocok untuk:

- identifier format,
- common error envelope,
- pagination envelope,
- money object,
- date range object,
- link object,
- audit metadata jika benar-benar seragam.

Kurang cocok untuk:

- mutable domain aggregate,
- JPA entity mirror,
- workflow-specific state,
- endpoint-specific projection.

---

## 21. Semantic Drift: The Invisible Breaking Change

Semantic drift terjadi ketika schema tetap sama tetapi makna berubah.

### 21.1 Examples

#### Status meaning changes

```text
CLOSED used to mean final closure.
CLOSED now means no active investigation but appeal may remain open.
```

#### Date meaning changes

```text
dueDate used to mean regulatory deadline.
dueDate now means internal target date.
```

#### Amount meaning changes

```text
penaltyAmount used to mean proposed amount.
penaltyAmount now means final imposed amount.
```

#### Boolean meaning changes

```text
isHighRisk used to mean calculated risk score >= threshold.
isHighRisk now means manually escalated high-risk flag.
```

#### ID meaning changes

```text
caseId used to be globally unique.
caseId now unique only within jurisdiction.
```

Schema diff sees no issue. Consumers break logically.

### 21.2 Why Semantic Drift Happens

- business language evolves,
- regulation changes,
- internal implementation changes,
- field name too vague,
- overloaded field,
- no domain glossary,
- no ownership for contract meaning,
- pressure to avoid versioning,
- lack of consumer impact review.

### 21.3 Detecting Semantic Drift

Ask during review:

```text
[ ] Did the meaning of any existing field change?
[ ] Did the source of truth for this field change?
[ ] Did calculation logic change?
[ ] Did timing or lifecycle point change?
[ ] Did authorization visibility change?
[ ] Did default behavior change?
[ ] Did state transition meaning change?
[ ] Would a consumer using the old meaning make wrong decisions?
```

### 21.4 Document Semantic Invariants

Example:

```yaml
finalDecisionDate:
  type:
    - string
    - 'null'
  format: date
  description: >
    The date on which the final enforcement decision became effective.
    Null until the case reaches FINAL_DECISION_RECORDED.
    Once non-null, this value is immutable except for administrative correction.
```

This is stronger than:

```yaml
finalDecisionDate:
  type: string
  format: date
```

---

## 22. State Evolution in Workflow APIs

Workflow APIs are especially vulnerable to evolution bugs.

Example:

```yaml
CaseLifecycleState:
  type: string
  enum:
    - DRAFT
    - SUBMITTED
    - UNDER_REVIEW
    - DECIDED
    - CLOSED
```

Later you add:

```yaml
    - ESCALATED
    - SUSPENDED
    - APPEALED
    - REOPENED
```

This can break:

- UI action availability,
- SLA computation,
- reporting,
- notification rules,
- authorization checks,
- partner workflow automation.

### 22.1 Model Transitions, Not Just States

Expose possible actions separately.

```yaml
CaseDetail:
  type: object
  required:
    - id
    - lifecycleState
    - availableActions
  properties:
    id:
      type: string
    lifecycleState:
      type: string
    availableActions:
      type: array
      items:
        type: string
```

But `availableActions` also evolves. It should be tolerant.

Better:

```yaml
availableActions:
  type: array
  items:
    $ref: '#/components/schemas/CaseAction'

CaseAction:
  type: object
  required:
    - code
    - label
    - method
    - href
  properties:
    code:
      type: string
      description: Consumers must tolerate unknown action codes.
    label:
      type: string
    method:
      type: string
      enum: [POST, PATCH]
    href:
      type: string
```

This reduces hardcoded client assumptions.

### 22.2 External State vs Internal State

Do not expose every internal state.

```text
Internal states:
  ASSIGNED_TO_TRIAGE_QUEUE
  WAITING_SUPERVISOR_REVIEW
  AUTO_SCORE_PENDING
  AUTO_SCORE_FAILED
  LEGAL_REVIEW_REQUIRED

External states:
  SUBMITTED
  UNDER_REVIEW
  ACTION_REQUIRED
  DECIDED
  CLOSED
```

Internal state changes often. External state should be stable.

---

## 23. Versioning Is Not a Substitute for Evolution Discipline

Many teams think:

> “If we break something, we’ll create v2.”

This is not a strategy. It is often a symptom of poor evolution discipline.

Versioning has cost:

- multiple server paths,
- duplicated docs,
- duplicated SDKs,
- consumer migration burden,
- data behavior divergence,
- security patch burden,
- support matrix complexity,
- operational confusion.

### 23.1 Prefer Compatible Evolution When Possible

Use:

- additive fields,
- additive endpoints,
- explicit new representations,
- deprecate old fields slowly,
- stable external states,
- tolerant enums,
- new optional request fields,
- new operation for materially different behavior.

### 23.2 Create New Version When Meaning Breaks

Versioning may be justified when:

- core resource representation changes,
- auth/security model changes,
- response envelope changes,
- workflow semantics change,
- old and new behavior cannot coexist safely,
- regulatory meaning changes materially,
- consumer assumptions would become dangerous.

### 23.3 New Endpoint Instead of Version

Sometimes better:

```text
GET /cases/{id}
GET /cases/{id}/decision-summary
GET /cases/{id}/regulatory-view
GET /cases/{id}/public-disclosure
```

Rather than bloating one response with every possible representation.

---

## 24. Consumer Tolerance Patterns

Provider evolution is safer if consumers follow robust patterns.

### 24.1 Ignore Unknown Response Fields

Consumer should not fail on additive fields.

Java/Jackson:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record CaseSummary(
    String id,
    String status
) {}
```

Or ObjectMapper config, depending on architecture.

### 24.2 Unknown Enum Fallback

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    CLOSED,
    UNKNOWN
}
```

Mapping layer:

```java
static CaseStatus parseStatus(String value) {
    try {
        return CaseStatus.valueOf(value);
    } catch (IllegalArgumentException ex) {
        return CaseStatus.UNKNOWN;
    }
}
```

But do not blindly continue for safety-critical flows. Unknown may require safe degradation.

```text
UNKNOWN status in UI -> show read-only view and ask user to refresh/contact support
UNKNOWN status in automated enforcement action -> stop and alert
```

### 24.3 Avoid Exhaustive Business Logic on Volatile Values

Bad:

```java
if (status == CLOSED) {
    hideAllActions();
}
```

Better:

```java
if (caseDetail.availableActions().isEmpty()) {
    hideActionPanel();
}
```

Better still: use server-provided action affordances where appropriate.

### 24.4 Treat Missing vs Null Carefully

For PATCH, use explicit command objects rather than relying on nullable fields.

### 24.5 Do Not Use API DTO as Domain Model

Consumer domain should translate external contract into internal model.

```text
GeneratedApiCase -> IntegrationMapping -> InternalCaseView
```

This isolates evolution.

---

## 25. Provider Tolerance Patterns

Provider should also be tolerant in controlled ways.

### 25.1 Request Unknown Fields

For commands that change state, unknown request fields may indicate client bug. Rejecting them can be safer.

```text
POST /cases
Unknown field `juridiction` -> 400 validation error
```

For metadata or extension bags, allow controlled additional properties.

```yaml
externalReferences:
  type: object
  additionalProperties:
    type: string
```

### 25.2 Idempotency and Retry Evolution

If adding new request fields affects idempotency, be careful.

```yaml
idempotencyKey:
  name: Idempotency-Key
  in: header
  required: false
  schema:
    type: string
```

Adding idempotency support can be compatible, but changing deduplication semantics can break retry behavior.

### 25.3 Backfill and Data Migration

If you add new required response field, old records may not have it.

Options:

- backfill data,
- make field optional,
- derive value,
- return explicit unknown state,
- expose field only for new resources,
- use versioned representation.

Do not mark field required just because new data has it.

---

## 26. Schema Evolution in Generated SDKs

Generated SDKs amplify schema changes.

### 26.1 Small Schema Change, Big SDK Diff

Changing schema can affect:

- model class names,
- enum classes,
- method names,
- nullability annotations,
- validation annotations,
- required constructor parameters,
- serialization behavior,
- package structure,
- generated docs,
- method overloads.

### 26.2 operationId Stability

Changing `operationId` can be breaking even if path/method unchanged.

```yaml
operationId: getCase
```

changed to:

```yaml
operationId: retrieveCase
```

Generated SDK method changes.

```java
client.getCase(id)
```

becomes:

```java
client.retrieveCase(id)
```

This is a client breaking change.

### 26.3 Required Field and Constructor Changes

If generator uses constructor for required fields, adding required response property can break consumer tests and mocks.

### 26.4 SDK Evolution Policy

Good API teams define:

```text
Spec version -> SDK version mapping
Breaking spec change -> major SDK version
Additive spec change -> minor SDK version
Doc/example change -> patch SDK version, if SDK regenerated
```

But generated SDK behavior must be tested, not assumed.

---

## 27. Evolution Review Workflow

A strong review workflow has layers.

### 27.1 Automated Diff

Use OpenAPI diff tooling to detect structural changes.

Detect:

- removed paths,
- changed operations,
- changed parameters,
- changed request/response schemas,
- changed requiredness,
- changed enum,
- changed media types,
- changed security.

But remember: semantic drift may not be detected.

### 27.2 Human Semantic Review

Ask:

```text
What consumer assumption could this change break?
Does this change alter meaning, not just shape?
Does this field exist in generated SDKs?
Is this a request-side or response-side change?
Are mobile/partner/long-tail consumers affected?
Is there a deprecation plan?
Is migration possible without coordinated release?
```

### 27.3 Consumer Impact Review

For important APIs, maintain:

```yaml
x-api-owner: enforcement-platform
x-consumer-groups:
  - web-casework-ui
  - mobile-inspection-app
  - partner-regulator-api
  - data-warehouse-ingestion
x-lifecycle: active
x-compatibility-policy: backward-compatible-minor-releases
```

Extensions are not standardized, but can power governance.

### 27.4 Release Note Discipline

Every schema change should be classified:

```text
Added optional response field: case.riskSummary
Deprecated response field: case.legacyRiskScore
Changed description: case.status semantics clarified, no runtime change
Added enum value: caseLifecycleState.APPEALED, consumers must tolerate unknown values
Breaking: removed v1 endpoint after sunset period
```

---

## 28. Compatibility Decision Table

| Change | Request Impact | Response Impact | Typical Classification | Notes |
|---|---:|---:|---|---|
| Add optional request field | Low | N/A | Usually compatible | Default/absence behavior must be stable |
| Add required request field | High | N/A | Breaking | Old consumers fail |
| Remove request field | Medium/High | N/A | Breaking if used | Could be compatible only if ignored before |
| Tighten request constraint | High | N/A | Breaking | Previously valid input fails |
| Loosen request constraint | Low for consumer, risk for provider | N/A | Compatible with provider risk | Check downstream |
| Add optional response field | N/A | Low/Medium | Usually compatible | Requires tolerant consumers |
| Add required response field | N/A | Medium | Risky | Generated SDK/test fixture impact |
| Remove response field | N/A | High | Breaking | Consumers may use it |
| Make response field nullable | N/A | High | Breaking | Consumers may not handle null |
| Add enum value | Medium | Medium/High | Risky | Generated clients may fail |
| Remove enum value | High | High | Breaking | Old requests/responses affected |
| Rename field | High | High | Breaking | Treat as add + deprecate |
| Change field type | High | High | Breaking | Even widening can break clients |
| Change field meaning | High | High | Semantic breaking | Automated diff may miss |
| Change operationId | N/A | SDK high | Breaking for generated clients | Even if HTTP unchanged |
| Change default | Medium | Medium | Semantic risk | Often overlooked |
| Add new endpoint | Low | Low | Compatible | Usually safe |
| Remove endpoint | High | High | Breaking | Requires deprecation/sunset |

---

## 29. Practical OpenAPI Evolution Example

Start with:

```yaml
components:
  schemas:
    CaseSummary:
      type: object
      required:
        - id
        - status
        - createdAt
      properties:
        id:
          type: string
        status:
          type: string
          enum:
            - OPEN
            - CLOSED
        createdAt:
          type: string
          format: date-time
```

Problem: later we need appeal lifecycle, risk summary, and external/public ID.

Bad evolution:

```yaml
status:
  type: string
  enum:
    - OPEN
    - CLOSED
    - APPEALED
riskScore:
  type: integer
caseId:
  type: integer
```

Problems:

- `APPEALED` may break old clients.
- `riskScore` may expose sensitive internal scoring.
- `caseId` type choice may be wrong.
- `status` mixes lifecycle and appeal state.

Better evolution:

```yaml
components:
  schemas:
    CaseSummary:
      type: object
      required:
        - id
        - publicReference
        - lifecycleState
        - createdAt
      properties:
        id:
          type: string
          description: Stable opaque identifier for API use. Consumers must not parse this value.
        publicReference:
          type: string
          description: Human-facing case reference suitable for display.
        lifecycleState:
          type: string
          description: >
            High-level external lifecycle state. Consumers must tolerate unknown values
            and should rely on availableActions for workflow affordances.
          enum:
            - OPEN
            - CLOSED
        appealState:
          type:
            - string
            - 'null'
          description: >
            Appeal state for the case. Null when no appeal lifecycle exists.
            Consumers must tolerate unknown non-null values.
          enum:
            - NOT_APPEALED
            - APPEAL_WINDOW_OPEN
            - UNDER_APPEAL
            - APPEAL_RESOLVED
            - null
        riskSummary:
          $ref: '#/components/schemas/CaseRiskSummary'
        createdAt:
          type: string
          format: date-time
        availableActions:
          type: array
          items:
            $ref: '#/components/schemas/CaseAction'

    CaseRiskSummary:
      type: object
      required:
        - level
        - visibleToCaller
      properties:
        level:
          type: string
          description: >
            External risk level. This is not the internal scoring model.
            Consumers must tolerate unknown values.
          enum:
            - LOW
            - MEDIUM
            - HIGH
        visibleToCaller:
          type: boolean
        reason:
          type: string
          description: Human-readable explanation safe for this caller.

    CaseAction:
      type: object
      required:
        - code
        - label
        - method
        - href
      properties:
        code:
          type: string
          description: Stable action code. Consumers must tolerate unknown values.
        label:
          type: string
        method:
          type: string
          enum:
            - POST
            - PATCH
        href:
          type: string
```

This is not perfect, but it shows stronger evolution thinking:

- IDs are strings and opaque.
- Lifecycle and appeal state are separated.
- Risk is summarized, not leaked.
- Actions reduce hardcoded state logic.
- Descriptions encode tolerance expectations.

---

## 30. Advanced Evolution Patterns

### 30.1 Parallel Representation

When changing representation significantly, add a new representation endpoint.

```text
GET /cases/{id}
GET /cases/{id}/regulatory-summary
GET /cases/{id}/public-disclosure
```

This avoids overloading one schema.

### 30.2 Capability Detection

Instead of making consumer infer from version:

```yaml
capabilities:
  type: array
  items:
    type: string
```

Example:

```json
{
  "capabilities": [
    "CASE_APPEAL_SUPPORTED",
    "EVIDENCE_REDACTION_SUPPORTED"
  ]
}
```

Use carefully. It can become another enum evolution problem.

### 30.3 Server-Driven Affordances

Expose available actions/links rather than asking client to hardcode all state transitions.

Useful for workflow/case systems.

### 30.4 Extension Bag

For controlled partner-specific metadata:

```yaml
extensions:
  type: object
  additionalProperties:
    type: string
```

But avoid turning this into ungoverned schema escape hatch.

### 30.5 New Field with Old Field Derivation

Add new structured field while preserving old derived field.

```text
new structured field -> authoritative
old flat field       -> derived compatibility projection
```

---

## 31. Anti-Patterns

### 31.1 “It’s Optional, So It’s Safe”

Optional only means not required. It does not mean semantic impact is zero.

### 31.2 “Adding Enum Value Is Additive”

For many generated clients, enum addition is breaking.

### 31.3 “Internal APIs Don’t Need Compatibility”

Internal APIs often have more hidden consumers than public APIs.

### 31.4 “We Can Search Code to Find Consumers”

You may miss:

- generated SDK users,
- partner systems,
- scripts,
- data pipelines,
- low-code tools,
- old mobile apps,
- manual exports.

### 31.5 “Schema Diff Passed, So It’s Safe”

Schema diff cannot reliably detect semantic drift.

### 31.6 “We’ll Just Make v2”

Versioning multiplies operational and support cost.

### 31.7 “Use One Shared Schema Everywhere”

This couples unrelated endpoints and makes evolution harder.

### 31.8 “Null Is Fine”

Null without semantics creates divergent consumer behavior.

### 31.9 “Default Is Just Documentation”

Consumer may depend on default behavior. Changing it can break business logic.

### 31.10 “Deprecated Means We Can Remove It Soon”

Deprecation without telemetry, migration path, and communication is just a warning label.

---

## 32. Java-Specific Failure Modes

### 32.1 Primitive vs Boxed Type

```java
int priority;
```

cannot represent missing/null.

```java
Integer priority;
```

can represent null, but not distinguish missing from explicit null unless deserialization tracks it.

### 32.2 Optional in DTO Fields

Avoid using `Optional<T>` as a DTO field casually. It complicates serialization and framework binding.

Prefer explicit patch command objects when semantics matter.

### 32.3 Lombok/Jackson Defaults

Default constructors, builders, and Lombok defaults can hide absence semantics.

```java
@Builder.Default
private List<String> tags = List.of();
```

Was the field missing, explicitly empty, or defaulted by client code?

### 32.4 Bean Validation Drift

OpenAPI says:

```yaml
maxLength: 100
```

Java says:

```java
@Size(max = 255)
```

Database says:

```sql
varchar(128)
```

This split-brain creates runtime inconsistency.

### 32.5 Generated Enum Deserialization

Generated clients may throw on unknown enum unless configured.

Test this explicitly.

### 32.6 Jackson Date/Time Precision

`OffsetDateTime`, `Instant`, `LocalDateTime`, and `ZonedDateTime` have different semantics.

For external APIs, avoid `LocalDateTime` unless timezone absence is intentional.

---

## 33. Governance Rules for Schema Evolution

A mature organization should encode evolution rules.

Example rules:

```text
1. Public response objects must document unknown field tolerance.
2. Volatile business classifications should not be closed enums unless explicitly approved.
3. Adding enum values requires consumer impact review.
4. Required request fields cannot be added in minor versions.
5. Field removals require deprecation period and migration guide.
6. Renames must be implemented as add-new + deprecate-old.
7. Response nullable changes require compatibility review.
8. Default behavior is part of the contract if documented.
9. operationId changes are breaking for generated SDKs.
10. Semantic changes require release note even if schema is unchanged.
```

These rules can be partly automated, partly reviewed manually.

---

## 34. Evolution Checklist Before Merging OpenAPI Changes

Use this checklist in PR review.

```text
Shape Change
[ ] Did any path/method/operationId change?
[ ] Did any request parameter change?
[ ] Did any request body schema change?
[ ] Did any response schema change?
[ ] Did any required field change?
[ ] Did any enum change?
[ ] Did any nullable/optional behavior change?
[ ] Did any constraint change?
[ ] Did any media type change?
[ ] Did any security requirement change?

Consumer Impact
[ ] Could generated clients break?
[ ] Could mobile/partner/old consumers break?
[ ] Could strict JSON parsers break?
[ ] Could exhaustive enum handling break?
[ ] Could test fixtures/mocks break?
[ ] Could data pipelines break?

Semantic Impact
[ ] Did meaning of an existing field change?
[ ] Did default behavior change?
[ ] Did lifecycle state meaning change?
[ ] Did source of truth change?
[ ] Did calculation logic change?
[ ] Did authorization visibility change?
[ ] Did timing/ordering/pagination semantics change?

Migration
[ ] Is there a deprecation marker if needed?
[ ] Is replacement documented?
[ ] Is timeline documented?
[ ] Are examples updated?
[ ] Are contract tests updated?
[ ] Are release notes prepared?
[ ] Are known consumers notified if needed?
```

---

## 35. Mental Model Summary

The deepest lesson of schema evolution:

> A field is not just a field. It is a promise across time.

When you add, remove, rename, or reinterpret a schema element, you are not only editing YAML. You are changing the set of assumptions that consumers may safely make.

A top-tier API engineer thinks in terms of:

```text
Current shape
+ historical behavior
+ future tolerance
+ consumer diversity
+ generated code impact
+ semantic invariants
+ migration path
+ governance evidence
```

That is why schema evolution is one of the hardest parts of OpenAPI mastery.

---

## 36. Practical Exercise

Take an existing OpenAPI schema from your project and classify every field into:

```text
1. Stable identity field
2. Stable lifecycle field
3. Volatile business classification
4. Derived display field
5. Sensitive/internal field
6. Optional field with clear absence semantics
7. Optional field with unclear absence semantics
8. Nullable field with clear null semantics
9. Nullable field with unclear null semantics
10. Candidate for deprecation
```

Then answer:

```text
[ ] Which enum values might grow?
[ ] Which fields are unsafe to remove?
[ ] Which fields leak internal model?
[ ] Which required fields are too strict?
[ ] Which optional fields need semantic explanation?
[ ] Which schema is reused too broadly?
[ ] Which fields would break generated clients if changed?
```

This exercise often reveals more API design debt than tooling alone.

---

## 37. Key Takeaways

1. Schema evolution is about promises over time, not just schema validity today.
2. Backward compatibility protects old consumers from new providers.
3. Forward compatibility helps consumers survive future provider changes.
4. Semantic compatibility is the hardest because schema diff may not detect it.
5. Optional, nullable, default, and enum semantics must be explicit.
6. Adding enum values can be breaking.
7. Renames are remove+add, not harmless edits.
8. Field removal requires deprecation lifecycle.
9. Shared schemas increase coupling and should be used carefully.
10. Generated SDKs amplify seemingly small schema changes.
11. Compatibility review must combine automated diff and human semantic review.
12. Versioning helps only when compatible evolution is not enough.

---

## 38. References

Primary references to use while applying this part:

- OpenAPI Specification v3.2.0 — Schema Object, Reference Object, Components Object, Operation Object, Parameter Object, Request Body Object, Response Object, Security Requirement Object.
- JSON Schema Draft 2020-12 — validation vocabulary, type semantics, composition, annotations.
- RFC 9110 — HTTP semantics.
- RFC 8594 — Sunset header for deprecation lifecycle.
- OpenAPI Generator documentation — generated client/server behavior and enum/model implications.
- oasdiff documentation — structural and breaking-change detection.
- Spectral documentation — governance and custom linting rules.

---

## 39. Part Completion Status

```text
Current part: 027 / 030
Status: Complete
Series complete: No
Remaining parts: 3
Next: Part 028 — OpenAPI Anti-Patterns and Failure Modes in Real Projects
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-026.md">⬅️ OpenAPI Mastery for Java Engineers — Part 026</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-028.md">OpenAPI Mastery for Java Engineers — Part 028 ➡️</a>
</div>
