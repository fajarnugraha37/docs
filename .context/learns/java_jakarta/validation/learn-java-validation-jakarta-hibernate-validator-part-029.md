# learn-java-validation-jakarta-hibernate-validator-part-029

# Observability, Operations, and Governance of Validation Rules

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `029`  
> Topik: Observability, Operations, and Governance of Validation Rules  
> Target: Java 8 hingga Java 25, Bean Validation 2.0, Jakarta Validation 3.x, Hibernate Validator 6/7/8/9

---

## 1. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas validation dari banyak sisi:

- constraint dasar,
- custom constraint,
- group,
- group sequence,
- executable validation,
- records dan immutable model,
- message interpolation,
- payload/severity/error code,
- programmatic mapping,
- Hibernate Validator extension,
- dependency injection,
- REST API,
- persistence,
- event-driven system,
- workflow/state machine,
- domain policy,
- performance,
- security,
- testing,
- migration,
- architecture layering.

Bagian ini membahas hal yang sering diabaikan walaupun sangat menentukan kualitas sistem production:

> Bagaimana validation rules dioperasikan setelah sistem berjalan?

Karena di production, validation bukan hanya persoalan benar atau salah secara teknis. Validation rule adalah bagian dari kontrak antara:

- backend,
- frontend,
- external client,
- database,
- workflow,
- regulator,
- support team,
- audit team,
- product/business owner,
- operasi/incident response.

Sebuah rule yang benar secara domain bisa tetap menjadi masalah besar jika:

- tiba-tiba memblokir client lama,
- tidak terlihat di monitoring,
- tidak punya error code stabil,
- tidak bisa dijelaskan ke user,
- tidak punya rule version,
- tidak bisa dibedakan antara invalid input dan bug sistem,
- tidak punya rollout plan,
- tidak bisa diaudit setelah 6 bulan.

Bagian ini mengubah cara pandang dari:

> “Apakah validasi ini jalan?”

menjadi:

> “Apakah validation system ini observable, governable, explainable, evolvable, dan aman dioperasikan?”

---

## 2. Validation Rule sebagai Operational Control

Di banyak codebase, validation diperlakukan sebagai detail kecil:

```java
@NotBlank
@Size(max = 100)
private String applicantName;
```

Untuk sistem kecil, ini cukup. Tetapi pada sistem besar, terutama API publik, sistem regulasi, workflow case management, dan multi-service platform, validation rule adalah operational control.

Artinya, validation rule dapat:

- menolak transaksi,
- menghentikan workflow,
- mencegah data masuk database,
- memicu error di frontend,
- menyebabkan client integration gagal,
- mengubah rejection rate,
- memengaruhi SLA,
- menghasilkan audit trail,
- menyebabkan incident jika rule terlalu ketat.

Maka setiap rule penting harus diperlakukan seperti bagian dari production behavior.

### 2.1 Contoh sederhana tapi berbahaya

Misalnya ada API:

```java
public record SubmitApplicationRequest(
        @NotBlank String applicantName,
        @Email String email,
        @Size(max = 20) String referenceNumber
) {}
```

Lalu tim mengubah:

```java
@Size(max = 20)
```

menjadi:

```java
@Size(max = 12)
```

Secara kode, ini hanya perubahan angka. Secara operasi, ini bisa berarti:

- client lama yang mengirim reference number 15 karakter mulai gagal,
- batch import gagal,
- frontend belum update limit input,
- data migration menghasilkan record yang tidak bisa disimpan ulang,
- replay event lama gagal,
- support team tidak tahu alasan penolakan,
- dashboard hanya menunjukkan kenaikan 400/422 tanpa detail rule.

Dari sudut production, perubahan validation rule adalah perubahan contract.

---

## 3. Core Mental Model: Validation Rule Lifecycle

Validation rule sebaiknya dipikirkan memiliki lifecycle:

```text
Rule proposed
  -> rule designed
  -> rule coded
  -> rule tested
  -> rule documented
  -> rule observed in shadow mode
  -> rule warned
  -> rule enforced
  -> rule monitored
  -> rule tuned
  -> rule deprecated
  -> rule retired
```

Tidak semua rule perlu lifecycle lengkap. `@NotNull` pada field internal yang jelas mungkin cukup langsung enforce. Tetapi rule yang berdampak pada client, workflow, integrasi, atau data historis perlu lifecycle eksplisit.

### 3.1 Rule state

Sebuah rule bisa memiliki enforcement mode:

```java
enum EnforcementMode {
    OBSERVE_ONLY,   // dievaluasi, dicatat, tidak memblokir
    WARNING,        // dikembalikan sebagai warning, tidak memblokir
    BLOCKING,       // memblokir operasi
    DISABLED        // tidak dievaluasi
}
```

Mode ini penting untuk rollout rule baru.

### 3.2 Rule metadata minimal

Untuk governance, rule penting sebaiknya punya metadata:

```java
record RuleMetadata(
        String ruleId,
        String ruleVersion,
        String ownerModule,
        String ownerTeam,
        EnforcementMode enforcementMode,
        String severity,
        String description,
        String userMessageCode,
        String remediationCode
) {}
```

Annotation bawaan Jakarta Validation tidak menyediakan semua ini secara langsung. Tetapi kita bisa mencapainya melalui:

- custom constraint attribute,
- `payload`,
- message code convention,
- metadata registry,
- API error mapping,
- domain policy object.

---

## 4. Observability: Apa yang Perlu Diukur?

Validation observability bukan sekadar log error. Observability berarti sistem mampu menjawab pertanyaan operasional.

Pertanyaan yang harus bisa dijawab:

1. Rule mana yang paling sering gagal?
2. Endpoint mana yang paling banyak menghasilkan validation error?
3. Client/channel mana yang paling terdampak?
4. Apakah rejection rate naik setelah deployment?
5. Apakah rule baru aman untuk di-enforce?
6. Apakah ada client lama yang masih mengirim format lama?
7. Apakah validation error terjadi karena user input buruk atau kontrak API berubah?
8. Apakah error berasal dari frontend, external integration, batch, event consumer, atau internal call?
9. Apakah rejected value aman untuk dilog?
10. Apakah validation failure berhubungan dengan incident lain?

### 4.1 Metrik minimum

Minimal, sistem besar sebaiknya punya metrik:

```text
validation.failures.count
validation.failures.rate
validation.violations.count
validation.rule.failure.count
validation.endpoint.failure.count
validation.client.failure.count
validation.group.failure.count
validation.duration
validation.payload.size
validation.batch.rejected.count
validation.warning.count
validation.observe_only.hit.count
```

Contoh label/tag:

```text
rule_id
constraint
endpoint
http_method
client_id
channel
module
group
severity
enforcement_mode
api_version
application_version
operation
```

Tetapi hati-hati: label cardinality bisa membunuh metrics backend.

### 4.2 High-cardinality trap

Jangan jadikan nilai berikut sebagai label metrics:

- raw field value,
- user id,
- email,
- phone number,
- reference number unik,
- request id,
- full violation path dengan index batch besar,
- arbitrary message text.

Contoh buruk:

```text
validation_failures_total{field="items[92831].email", rejectedValue="john@example.com"}
```

Ini buruk karena:

- cardinality sangat tinggi,
- data sensitif bocor,
- metrics storage membengkak,
- query dashboard lambat.

Contoh lebih baik:

```text
validation_failures_total{
  rule_id="APPLICANT_EMAIL_FORMAT",
  endpoint="POST /applications",
  client_type="external-api",
  severity="error",
  enforcement="blocking"
}
```

Untuk detail per request, gunakan log/tracing dengan redaction, bukan metric label.

---

## 5. Metrik Berdasarkan Layer

Validation terjadi di banyak layer. Metrik perlu menunjukkan layer mana yang gagal.

```text
Transport/API layer
Command layer
Domain policy layer
Workflow guard layer
Persistence/database layer
Event consumer layer
External integration boundary
```

### 5.1 API layer metrics

Untuk REST API:

```text
api.validation.request_body.failure.count
api.validation.query_param.failure.count
api.validation.path_param.failure.count
api.validation.header.failure.count
api.validation.response.failure.count
```

Return value validation failure harus dibedakan dari request validation failure. Request validation failure biasanya caller fault. Return value validation failure biasanya server bug.

```text
request invalid  -> 4xx
response invalid -> 5xx / alert
```

### 5.2 Command/domain metrics

Untuk command handler:

```text
command.validation.failure.count
policy.rule.blocked.count
policy.rule.warning.count
policy.rule.observe_only.hit.count
workflow.transition.rejected.count
```

Label penting:

```text
command_type
action
current_state
target_state
rule_id
severity
enforcement_mode
```

### 5.3 Persistence metrics

Database constraint violation sebaiknya punya metrik terpisah:

```text
db.constraint.violation.count
```

Label:

```text
constraint_name
operation
entity/table logical name
translated_error_code
```

Jangan hanya mengandalkan HTTP 500 atau generic SQL exception.

### 5.4 Event metrics

Untuk event-driven system:

```text
event.validation.failure.count
event.validation.warning.count
event.dlq.validation.count
event.schema.invalid.count
event.object.invalid.count
event.version.unsupported.count
event.reference.missing.count
```

Label:

```text
event_type
event_version
consumer
producer
failure_classification
```

---

## 6. Structured Logging untuk Validation

Log validation harus cukup kaya untuk debugging, tetapi tidak membocorkan data sensitif.

### 6.1 Struktur log yang baik

Contoh struktur log:

```json
{
  "event": "validation_failed",
  "requestId": "9bb8d3c1-8e8e-4e3d-8a46-8d8f0fd0b100",
  "correlationId": "case-2026-000182",
  "module": "application-management",
  "operation": "SUBMIT_APPLICATION",
  "endpoint": "POST /applications/{id}/submit",
  "clientId": "partner-portal",
  "apiVersion": "v2",
  "actorType": "EXTERNAL_USER",
  "ruleId": "APPLICATION_DECLARATION_REQUIRED",
  "ruleVersion": "2026.06.01",
  "severity": "ERROR",
  "enforcementMode": "BLOCKING",
  "fieldPath": "declaration.accepted",
  "constraint": "AssertTrue",
  "messageCode": "application.declaration.required",
  "rejectedValueClass": "Boolean",
  "rejectedValueLogged": false
}
```

Poin penting:

- log rule id, bukan hanya message,
- log field path, tapi hati-hati index besar,
- log class/type rejected value, bukan raw value,
- log enforcement mode,
- log rule version,
- log correlation id,
- log module/operation.

### 6.2 Jangan log raw rejected value secara default

Contoh buruk:

```java
log.warn("Validation failed: path={}, value={}, message={}",
        violation.getPropertyPath(),
        violation.getInvalidValue(),
        violation.getMessage());
```

Risiko:

- email bocor,
- phone number bocor,
- NRIC/NIK/passport bocor,
- alamat bocor,
- free text complaint bocor,
- password/token bocor,
- log forging jika value mengandung newline/control char.

Contoh lebih aman:

```java
log.warn("Validation failed: ruleId={}, path={}, constraint={}, messageCode={}, valueType={}, valueLogged=false",
        ruleId,
        normalizePath(violation.getPropertyPath()),
        violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName(),
        resolveMessageCode(violation),
        invalidValueType(violation.getInvalidValue()));
```

### 6.3 Kapan boleh log rejected value?

Hanya jika:

- field diklasifikasikan aman,
- value bukan PII/secret/free text,
- sudah di-redact/masked,
- diperlukan untuk debugging operasional,
- sesuai kebijakan retention,
- tidak melanggar compliance.

Contoh field relatif aman:

- enum code,
- boolean flag,
- non-sensitive status,
- numeric count yang bukan identitas,
- known public code.

Tetap sebaiknya pakai field classification.

---

## 7. Field Classification untuk Safe Logging

Agar logging tidak bergantung pada ingatan developer, buat classification model.

```java
enum DataSensitivity {
    PUBLIC,
    INTERNAL,
    CONFIDENTIAL,
    PII,
    SECRET,
    FREE_TEXT,
    UNKNOWN
}
```

Contoh registry:

```java
record FieldClassification(
        String pathPattern,
        DataSensitivity sensitivity,
        boolean logRejectedValue,
        boolean includeInApiResponse
) {}
```

Contoh mapping:

```text
email                   -> PII, no raw log
phoneNumber             -> PII, no raw log
password                -> SECRET, never log
accessToken             -> SECRET, never log
remarks                 -> FREE_TEXT, never log raw
status                  -> INTERNAL, may log
submissionType          -> PUBLIC/INTERNAL, may log
items[*].amount         -> CONFIDENTIAL, maybe masked
```

### 7.1 Default harus aman

Jika field tidak diketahui:

```text
UNKNOWN -> do not log raw value
```

Default aman lebih baik daripada default bocor.

---

## 8. Tracing: Menghubungkan Validation Failure dengan Request Flow

Validation failure harus bisa dilacak dalam distributed tracing.

Span attributes yang berguna:

```text
validation.failed=true
validation.violation_count=3
validation.top_rule_id=APPLICANT_EMAIL_FORMAT
validation.enforcement=BLOCKING
validation.layer=REST_REQUEST
```

Tetapi jangan masukkan PII ke span attributes.

### 8.1 Span event

Contoh conceptual span event:

```json
{
  "name": "validation.failed",
  "attributes": {
    "rule_id": "APPLICATION_DECLARATION_REQUIRED",
    "field_path": "declaration.accepted",
    "constraint": "AssertTrue",
    "severity": "ERROR",
    "enforcement": "BLOCKING"
  }
}
```

Tracing membantu menjawab:

- request ditolak di layer mana,
- apakah DB dipanggil sebelum validation gagal,
- apakah validator melakukan external call,
- apakah latency validation tinggi,
- apakah failure terjadi sebelum/selama transaction.

---

## 9. Error Code Governance

Human message bisa berubah. Error code tidak boleh berubah sembarangan.

### 9.1 Error code sebagai contract

Contoh:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "violations": [
    {
      "code": "APPLICATION_DECLARATION_REQUIRED",
      "path": "declaration.accepted",
      "message": "Declaration must be accepted before submission.",
      "severity": "ERROR",
      "ruleId": "APPLICATION_DECLARATION_REQUIRED",
      "ruleVersion": "2026.06.01"
    }
  ]
}
```

Client seharusnya bergantung pada `code`, bukan `message`.

### 9.2 Naming convention

Gunakan convention stabil:

```text
<DOMAIN>_<FIELD_OR_CONCEPT>_<FAILURE_REASON>
```

Contoh:

```text
APPLICATION_DECLARATION_REQUIRED
APPLICATION_STATUS_TRANSITION_NOT_ALLOWED
APPLICANT_EMAIL_INVALID_FORMAT
CASE_ASSIGNMENT_OWNER_REQUIRED
DOCUMENT_FILE_SIZE_EXCEEDED
PAYMENT_AMOUNT_MUST_BE_POSITIVE
```

Hindari code terlalu teknis:

```text
NOT_NULL
SIZE_INVALID
PATTERN_FAILED
```

Code teknis boleh sebagai detail, tapi bukan primary business-facing error code.

### 9.3 Error code registry

Buat registry:

```yaml
- code: APPLICATION_DECLARATION_REQUIRED
  ruleId: APPLICATION_DECLARATION_REQUIRED
  owner: application-management
  severity: ERROR
  introducedIn: 2026-06-01
  enforcement: BLOCKING
  httpStatus: 422
  messageKey: application.declaration.required
  safeForExternalClient: true
  deprecated: false
```

Registry ini dapat digunakan untuk:

- dokumentasi API,
- frontend mapping,
- support handbook,
- audit,
- compatibility check,
- CI guardrail.

---

## 10. Rule ID dan Rule Version

Error code menjelaskan failure untuk client. Rule ID menjelaskan rule secara governance.

Kadang sama, kadang berbeda.

Contoh:

```text
ruleId: CASE_SUBMIT_DECLARATION_REQUIRED
errorCode: APPLICATION_DECLARATION_REQUIRED
```

Rule version penting ketika rule berubah.

### 10.1 Kenapa rule version penting?

Misalnya rule:

```text
RULE: APPLICANT_AGE_ELIGIBLE
v1: age >= 18
v2: age >= 21 for some license type
```

Jika audit terjadi 1 tahun kemudian, sistem harus bisa menjawab:

- rule versi mana yang digunakan saat keputusan dibuat,
- kapan rule berubah,
- siapa yang approve perubahan,
- apakah user terkena rule lama atau baru,
- apakah rejection saat itu valid berdasarkan policy pada tanggal itu.

### 10.2 Format version

Beberapa pilihan:

```text
2026.06.01
2026-Q2
v3
policy-2026-06-01
hash dari rule config
```

Untuk sistem regulatory, date-based version sering lebih mudah diaudit.

---

## 11. Audit Trail untuk Validation Decision

Tidak semua validation failure harus diaudit secara permanen. Tetapi workflow-blocking decision di sistem regulasi sering perlu audit trail.

### 11.1 Apa yang diaudit?

Untuk blocking domain/workflow rule:

```json
{
  "eventType": "RULE_EVALUATION_FAILED",
  "caseId": "CASE-2026-000123",
  "action": "SUBMIT_FOR_APPROVAL",
  "actorId": "user-123",
  "actorRole": "OFFICER",
  "ruleId": "CASE_HAS_REQUIRED_DOCUMENTS",
  "ruleVersion": "2026.06.01",
  "decision": "BLOCK",
  "severity": "ERROR",
  "evidence": {
    "missingDocumentTypes": ["DECLARATION_FORM"]
  },
  "timestamp": "2026-06-16T10:15:30+07:00"
}
```

Namun evidence harus dikontrol agar tidak membocorkan PII atau data sensitif.

### 11.2 Audit vs log

Jangan samakan log dengan audit.

| Aspek | Log | Audit trail |
|---|---|---|
| Tujuan | Debugging/ops | Bukti keputusan |
| Retention | Relatif pendek | Sesuai policy legal/regulatory |
| Struktur | Bisa teknis | Harus business-explainable |
| PII | Harus dibatasi | Harus dikontrol ketat |
| Mutability | Bisa rotate | Biasanya append-only |
| Audience | Engineer/SRE | Auditor, support, regulator, business |

Validation yang memblokir keputusan penting sebaiknya menghasilkan audit event yang jelas.

---

## 12. Backward Compatibility of Validation Rules

Validation rule adalah bagian dari API compatibility.

### 12.1 Perubahan breaking

Perubahan berikut biasanya breaking:

- field optional menjadi required,
- `@Size(max=100)` menjadi `@Size(max=50)`,
- enum allowed values dipersempit,
- format regex diperketat,
- date range diperketat,
- object nested baru wajib,
- warning menjadi blocking tanpa rollout,
- rule berlaku untuk API version lama,
- default value dihapus.

### 12.2 Perubahan non-breaking atau less-breaking

Biasanya lebih aman:

- required menjadi optional,
- max length diperbesar,
- enum value baru ditambahkan jika client tolerant,
- warning ditambahkan tanpa blocking,
- message diperjelas tanpa mengubah code,
- metadata tambahan ditambahkan.

Tetapi tetap perlu dicek karena frontend atau client bisa punya assumption.

### 12.3 Compatibility matrix

Untuk rule penting, dokumentasikan:

| Change | API impact | Data impact | Client impact | Rollout |
|---|---:|---:|---:|---|
| Optional -> required | High | Medium | High | observe -> warn -> block |
| Max length reduced | High | High | High | data scan + warn |
| Regex tightened | Medium/High | Medium | Medium | observe first |
| New warning | Low | Low | Low | canary |
| New blocking workflow guard | High | Medium | High | eligibility endpoint + warning |

---

## 13. Rollout Pattern: Observe, Warn, Enforce

Untuk rule baru yang berpotensi berdampak pada client/data lama, gunakan staged rollout.

```text
OBSERVE_ONLY
  -> WARNING
  -> BLOCKING
```

### 13.1 Observe-only

Rule dievaluasi tetapi tidak memblokir.

Tujuan:

- mengukur impact,
- menemukan client yang melanggar,
- menemukan data historis yang tidak comply,
- menghindari incident saat deployment.

Contoh result internal:

```json
{
  "ruleId": "APPLICANT_EMAIL_STRICT_FORMAT",
  "enforcementMode": "OBSERVE_ONLY",
  "wouldBlock": true,
  "path": "email"
}
```

Client tidak harus menerima ini, tergantung strategi.

### 13.2 Warning

Rule dikembalikan sebagai warning, operasi tetap lanjut.

Contoh response:

```json
{
  "id": "APP-123",
  "status": "DRAFT",
  "warnings": [
    {
      "code": "APPLICANT_EMAIL_FORMAT_WILL_BE_ENFORCED",
      "path": "email",
      "message": "Email format will be strictly validated from 2026-08-01.",
      "enforcementDate": "2026-08-01"
    }
  ]
}
```

### 13.3 Blocking

Rule menjadi hard validation.

Syarat sebelum blocking:

- impact sudah diketahui,
- client terdampak sudah diberi waktu,
- frontend sudah update,
- batch/import pipeline sudah update,
- data historis sudah dibersihkan atau dikecualikan,
- dashboard dan alert sudah siap,
- rollback/feature flag tersedia.

---

## 14. Feature Flags untuk Validation

Validation rule sering perlu dikontrol dengan feature flag atau rule config.

### 14.1 Contoh config

```yaml
validationRules:
  APPLICANT_EMAIL_STRICT_FORMAT:
    enabled: true
    enforcementMode: WARNING
    ruleVersion: 2026.06.01
    appliesTo:
      apiVersions: ["v2"]
      channels: ["external-api", "portal"]
    excludedClients:
      - legacy-partner-01
```

### 14.2 Hati-hati dengan flag explosion

Feature flag yang terlalu banyak dapat menciptakan state space besar.

Risiko:

- rule behavior sulit diprediksi,
- test matrix meledak,
- support bingung,
- audit sulit,
- client A dan B mendapat hasil berbeda tanpa alasan jelas.

Gunakan flag untuk transition, bukan permanent chaos.

### 14.3 Governance feature flag

Setiap validation flag harus punya:

- owner,
- expiry date,
- reason,
- rollout plan,
- fallback behavior,
- monitoring dashboard,
- removal ticket.

---

## 15. Rule Ownership

Rule tanpa owner akan menjadi technical debt.

### 15.1 Jenis owner

Satu rule bisa punya beberapa ownership dimension:

| Ownership | Pertanyaan |
|---|---|
| Domain owner | Secara bisnis rule ini milik siapa? |
| Technical owner | Modul/service mana yang maintain? |
| API owner | Contract ke client siapa yang jaga? |
| Data owner | Apakah ada dampak ke data lama? |
| Ops owner | Siapa yang monitor rollout? |
| Compliance owner | Apakah butuh approval/regulatory trace? |

### 15.2 Metadata owner

Contoh:

```yaml
code: CASE_ASSIGNMENT_OFFICER_REQUIRED
ruleId: CASE_ASSIGNMENT_OFFICER_REQUIRED
owner:
  domain: case-management
  technical: aceas-case-service
  product: case-ops
  support: l2-application-support
introducedIn: 2026-06-01
```

Ini terlihat administratif, tetapi penting saat incident.

---

## 16. Dashboard untuk Validation

Dashboard validation sebaiknya tidak hanya menunjukkan jumlah 400.

### 16.1 Dashboard API validation

Panel yang berguna:

- total validation failures over time,
- failure rate per endpoint,
- top rule IDs,
- top clients/channels,
- top API versions,
- warning vs blocking,
- observe-only would-block count,
- validation latency p95/p99,
- rejected batch items count,
- DB constraint violation count.

### 16.2 Dashboard workflow validation

Panel:

- transition rejection count,
- top blocking workflow rules,
- rejection by state,
- rejection by actor role,
- rejection by module,
- warning count before enforcement,
- SLA-related blocking count,
- maker-checker rejection count.

### 16.3 Dashboard event validation

Panel:

- invalid event count,
- invalid event by producer,
- invalid event by event type/version,
- schema invalid vs object invalid,
- DLQ validation count,
- replay validation failure count,
- unsupported version count.

---

## 17. Alerting: Kapan Validation Failure Harus Menjadi Alert?

Tidak semua validation failure adalah incident. Banyak validation failure adalah user error normal.

Alert diperlukan ketika:

- rejection rate naik drastis setelah deployment,
- rule baru memblokir client besar,
- return value validation gagal,
- DB constraint violation naik karena application validation drift,
- event DLQ penuh karena invalid events,
- observe-only rule menunjukkan impact sangat besar sebelum enforcement,
- validation latency meningkat tajam,
- unknown error code muncul,
- client tertentu tiba-tiba gagal semua request.

### 17.1 Alert examples

```text
ALERT: validation_failure_rate_high
Condition: validation.failures.rate > baseline + 3σ for 15 minutes
Labels: endpoint, api_version, client_type
```

```text
ALERT: blocking_rule_new_spike
Condition: validation.rule.failure.count{rule_id="NEW_RULE"} > threshold
```

```text
ALERT: response_validation_failure
Condition: api.validation.response.failure.count > 0
Severity: critical
```

Return value validation failure harus dianggap serius karena itu biasanya bug server.

---

## 18. Incident Response untuk Validation Regression

Validation regression adalah kejadian ketika perubahan rule menyebabkan failure yang tidak diinginkan.

### 18.1 Gejala

- 4xx naik drastis,
- client komplain request yang sebelumnya berhasil kini gagal,
- batch import berhenti,
- event masuk DLQ,
- workflow tidak bisa submit/approve,
- support mendapat banyak tiket dengan error code sama,
- database constraint exception meningkat.

### 18.2 Triage checklist

Pertanyaan pertama:

1. Rule apa yang naik?
2. Deployment apa yang baru terjadi?
3. Endpoint/client/channel mana yang terdampak?
4. Apakah failure blocking atau warning?
5. Apakah data lama ikut terdampak?
6. Apakah frontend sudah sinkron?
7. Apakah client external diberi notice?
8. Apakah bisa rollback config tanpa rollback code?
9. Apakah rejected value category aman dianalisis?
10. Apakah ini bug rule, bug client, atau perubahan contract yang benar tetapi rollout buruk?

### 18.3 Mitigation options

Urutan mitigasi:

```text
1. Switch rule to WARNING / OBSERVE_ONLY
2. Exempt impacted legacy client temporarily
3. Roll back validation config
4. Roll back deployment
5. Add compatibility fallback
6. Patch frontend/client
7. Data repair
8. Re-enforce with staged rollout
```

Jangan langsung menghapus rule jika rule benar secara domain. Bisa jadi masalahnya rollout, bukan rule.

---

## 19. Validation Drift

Validation drift terjadi ketika aturan di berbagai tempat tidak sama.

Contoh drift:

- FE max length 100, BE max length 80,
- BE `@NotNull`, DB nullable,
- DB NOT NULL, BE optional,
- OpenAPI mengatakan field optional, BE required,
- event schema optional, consumer object required,
- workflow UI menampilkan button submit, backend guard menolak,
- client SDK masih menggunakan enum lama.

### 19.1 Drift detection

Cara mendeteksi:

- contract tests,
- OpenAPI diff,
- schema registry compatibility check,
- DB schema vs annotation review,
- generated client validation tests,
- metadata API extraction,
- validation error analytics.

### 19.2 Drift prevention

Prinsip:

- source of truth jelas,
- validation rule registry,
- generated docs dari metadata bila memungkinkan,
- frontend tidak menduplikasi business rule kompleks,
- eligibility endpoint untuk workflow,
- database tetap punya final integrity constraint,
- CI memblokir breaking validation change tanpa review.

---

## 20. CI/CD Guardrails untuk Validation Rules

Validation governance harus masuk pipeline, bukan hanya review manual.

### 20.1 Rule catalog diff

Buat CI job yang membandingkan rule catalog sebelum dan sesudah perubahan.

Deteksi:

- rule baru,
- rule dihapus,
- severity berubah,
- enforcement berubah,
- message code berubah,
- max length mengecil,
- requiredness berubah,
- allowed enum values berkurang,
- error code berubah,
- rule owner kosong.

### 20.2 Breaking change detection

Contoh pseudo-output:

```text
BREAKING VALIDATION CHANGE DETECTED

Rule: APPLICANT_REFERENCE_LENGTH
Change: max length 20 -> 12
Affected DTO: SubmitApplicationRequest.referenceNumber
Affected endpoint: POST /applications
Required approval: API owner + domain owner
```

### 20.3 Contract test

CI sebaiknya menjalankan:

- DTO validation tests,
- API error shape tests,
- OpenAPI validation tests,
- generated client compatibility tests,
- database constraint mapping tests,
- rule catalog consistency tests.

---

## 21. Validation Rule Catalog

Rule catalog adalah daftar rule yang dikenal sistem.

### 21.1 Mengapa perlu?

Karena tanpa catalog:

- rule tersebar di annotation,
- error code tidak konsisten,
- support tidak tahu arti error,
- audit sulit,
- frontend mapping rapuh,
- breaking change sulit dideteksi.

### 21.2 Isi catalog

Contoh:

```yaml
rules:
  - ruleId: APPLICANT_EMAIL_FORMAT
    errorCode: APPLICANT_EMAIL_INVALID_FORMAT
    ownerModule: application-management
    ownerTeam: platform-case
    layer: TRANSPORT
    severity: ERROR
    enforcementMode: BLOCKING
    introducedIn: 2026-06-01
    version: 2026.06.01
    messageKey: applicant.email.invalid
    appliesTo:
      endpoints:
        - POST /applications
        - PUT /applications/{id}/applicant
      apiVersions:
        - v2
    dataSensitivity: PII
    safeToExposeRejectedValue: false
    documentation: "Email must be syntactically valid for notification delivery."
```

### 21.3 Catalog source

Catalog bisa berasal dari:

- YAML/JSON checked into repo,
- generated metadata dari annotations,
- custom annotation attributes,
- database/config service,
- combination.

Untuk rule domain/workflow, explicit catalog biasanya lebih baik daripada mencoba mengekstrak semuanya dari annotation.

---

## 22. Mapping Jakarta Validation Metadata ke Governance

Jakarta Validation menyediakan metadata API. Ini bisa digunakan untuk introspection.

Contoh conceptual:

```java
Validator validator = validatorFactory.getValidator();
BeanDescriptor descriptor = validator.getConstraintsForClass(SubmitApplicationRequest.class);

for (PropertyDescriptor property : descriptor.getConstrainedProperties()) {
    for (ConstraintDescriptor<?> constraint : property.getConstraintDescriptors()) {
        Annotation annotation = constraint.getAnnotation();
        Map<String, Object> attributes = constraint.getAttributes();
        Set<Class<? extends Payload>> payload = constraint.getPayload();
        Set<Class<?>> groups = constraint.getGroups();
    }
}
```

Metadata yang bisa dipakai:

- property name,
- constraint annotation type,
- attributes seperti `min`, `max`, `regexp`,
- groups,
- payload,
- composing constraints,
- message template.

### 22.1 Limit metadata API

Metadata API tidak tahu seluruh context:

- endpoint mana memakai DTO tersebut,
- apakah rule breaking untuk client,
- owner rule,
- business rationale,
- enforcement rollout,
- field sensitivity,
- regulatory requirement,
- workflow state applicability.

Karena itu metadata API berguna, tetapi tidak cukup untuk governance penuh.

---

## 23. Payload dan Severity untuk Observability

Pada Jakarta Validation, constraint annotation wajib memiliki elemen `payload`. Payload sering diabaikan, tetapi bisa dipakai untuk membawa metadata tipe/class.

Contoh:

```java
public interface Severity {
    interface Info extends Payload {}
    interface Warning extends Payload {}
    interface Error extends Payload {}
    interface Fatal extends Payload {}
}
```

Pemakaian:

```java
@NotBlank(
    message = "{applicant.name.required}",
    payload = Severity.Error.class
)
private String applicantName;
```

Pembacaan:

```java
Set<Class<? extends Payload>> payloads =
        violation.getConstraintDescriptor().getPayload();
```

### 23.1 Keterbatasan payload

Payload adalah class marker. Ia bukan tempat ideal untuk dynamic metadata seperti rule version atau owner. Untuk itu lebih baik gunakan:

- custom constraint attribute,
- external rule catalog,
- error mapping registry,
- policy object result.

---

## 24. Message Governance: Message Bukan Contract Utama

Human-readable message harus bisa berubah tanpa memecahkan client.

### 24.1 Struktur ideal

```json
{
  "code": "APPLICANT_EMAIL_INVALID_FORMAT",
  "message": "Email format is invalid.",
  "messageKey": "applicant.email.invalid",
  "path": "applicant.email",
  "ruleId": "APPLICANT_EMAIL_FORMAT"
}
```

Client logic memakai `code`, bukan `message`.

### 24.2 Message change governance

Perubahan message tetap perlu review jika:

- message tampil ke external user,
- message terkait compliance/legal wording,
- message memengaruhi support script,
- message mengandung remediation instruction,
- message diterjemahkan ke banyak locale.

### 24.3 i18n

Message catalog harus punya ownership dan testing.

Contoh key:

```properties
applicant.email.invalid=Email format is invalid.
application.declaration.required=Declaration must be accepted before submission.
case.transition.notAllowed=This case cannot be moved to the requested state.
```

Hindari message yang terlalu teknis:

```text
must match "^[A-Z]{3}[0-9]{8}$"
```

Lebih baik:

```text
Reference number must use the format ABC12345678.
```

Tetapi jangan membocorkan format internal jika itu security-sensitive.

---

## 25. Validation Error Response sebagai Public Contract

Untuk API, error response harus stabil.

### 25.1 Recommended shape

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more request fields are invalid.",
  "instance": "/applications/APP-123/submit",
  "correlationId": "req-8f2c",
  "violations": [
    {
      "code": "DECLARATION_REQUIRED",
      "message": "Declaration must be accepted before submission.",
      "path": "declaration.accepted",
      "ruleId": "APPLICATION_DECLARATION_REQUIRED",
      "ruleVersion": "2026.06.01",
      "severity": "ERROR"
    }
  ]
}
```

Spring Framework modern mendukung `ProblemDetail`/`ErrorResponse` untuk response berbasis RFC 9457. Dalam Jakarta REST/JAX-RS, pola serupa bisa dibuat dengan `ExceptionMapper`.

### 25.2 Jangan expose internal constraint mentah

Hindari response seperti:

```json
{
  "error": "jakarta.validation.constraints.NotNull.message"
}
```

Atau:

```json
{
  "error": "must match ^(?=.{8,})(?=.*[A-Z])(?=.*\\d).*$"
}
```

API response harus business-friendly dan stable.

---

## 26. Governance untuk Soft Validation

Soft validation berarti rule dievaluasi tetapi tidak selalu memblokir.

Jenis:

```text
INFO       -> purely informational
WARNING    -> should fix, operation still allowed
ERROR      -> blocking in current mode or future mode
FATAL      -> cannot proceed, system integrity risk
```

### 26.1 Use case warning

Contoh:

- field akan menjadi mandatory bulan depan,
- format lama masih diterima tapi deprecated,
- document recommended belum diunggah,
- submission mendekati SLA deadline,
- data quality buruk tapi tidak memblokir draft.

### 26.2 Warning harus observable

Warning yang tidak dimonitor akan menjadi noise.

Metric:

```text
validation.warning.count{rule_id, endpoint, client_id}
```

Dashboard harus menunjukkan apakah warning turun sebelum enforcement.

---

## 27. Data Quality Monitoring dari Validation

Validation failure bisa menjadi sinyal kualitas data.

Misalnya:

- banyak email invalid dari channel tertentu,
- banyak postal code invalid dari batch import,
- banyak workflow rejection karena missing document,
- banyak event invalid dari producer tertentu,
- banyak DB constraint violation setelah deploy service tertentu.

### 27.1 Data quality dashboard

Panel:

- invalid field distribution,
- invalid by source system,
- invalid by import file,
- invalid by client version,
- invalid by operator/team,
- correction time,
- repeated failure count.

### 27.2 Feedback loop

Validation observability harus menghasilkan aksi:

```text
High invalid email from partner A
  -> notify partner A
  -> improve API docs
  -> add pre-validation SDK
  -> add warning mode period
  -> enforce after adoption
```

---

## 28. Validation in Multi-Version APIs

API versioning membuat validation governance lebih kompleks.

### 28.1 Rule per version

Contoh:

```text
v1: referenceNumber optional, max 30
v2: referenceNumber required, max 20
v3: referenceNumber required, format CASE-YYYY-NNNNNN
```

Jangan memaksa semua versi memakai rule paling baru.

### 28.2 DTO per version

Sering lebih jelas:

```java
record SubmitApplicationV1Request(...) {}
record SubmitApplicationV2Request(...) {}
record SubmitApplicationV3Request(...) {}
```

Daripada satu DTO dengan group rumit:

```java
@NotNull(groups = V2.class)
@Pattern(groups = V3.class)
private String referenceNumber;
```

Group bisa dipakai, tetapi versi API sering lebih aman dengan DTO eksplisit.

### 28.3 Deprecation signal

API lama bisa mengembalikan warning:

```json
{
  "warnings": [
    {
      "code": "API_VERSION_DEPRECATED",
      "message": "API v1 will be retired on 2026-12-31."
    }
  ]
}
```

---

## 29. Validation untuk Frontend/Backend Alignment

Frontend validation adalah UX optimization, bukan authority utama.

### 29.1 Sumber masalah

- frontend punya regex berbeda,
- frontend max length tidak sama,
- field required hanya di FE,
- BE rule berubah tanpa FE update,
- mobile app lama masih active,
- external client tidak pakai FE.

### 29.2 Alignment pattern

Gunakan kombinasi:

- OpenAPI schema,
- generated client,
- server-side authoritative validation,
- frontend constraints untuk UX,
- metadata endpoint untuk form hints jika perlu,
- contract test FE/BE,
- error code mapping stabil.

### 29.3 Eligibility endpoint untuk workflow

Untuk action berbasis workflow:

```http
GET /cases/{id}/available-actions
```

Response:

```json
{
  "actions": [
    {
      "action": "SUBMIT_FOR_APPROVAL",
      "allowed": false,
      "blockingReasons": [
        {
          "code": "MISSING_REQUIRED_DOCUMENT",
          "message": "Declaration form is required."
        }
      ],
      "warnings": []
    }
  ]
}
```

Ini lebih baik daripada frontend mencoba menduplikasi seluruh workflow guard.

---

## 30. Validation untuk Batch dan Import Operation

Batch validation punya kebutuhan observability berbeda dari single request.

### 30.1 Result model

```json
{
  "batchId": "import-2026-06-16-001",
  "totalRows": 10000,
  "acceptedRows": 9420,
  "rejectedRows": 580,
  "warnings": 120,
  "topErrors": [
    {
      "code": "POSTAL_CODE_INVALID",
      "count": 310
    },
    {
      "code": "EMAIL_INVALID_FORMAT",
      "count": 180
    }
  ]
}
```

### 30.2 Row-level detail

```json
{
  "rowNumber": 42,
  "violations": [
    {
      "code": "EMAIL_INVALID_FORMAT",
      "path": "email",
      "message": "Email format is invalid."
    }
  ]
}
```

### 30.3 Operational concerns

- jangan log seluruh invalid row,
- simpan rejection report secara aman,
- classification PII,
- partial success semantics jelas,
- retry hanya untuk transient failure,
- validation failure biasanya tidak perlu retry,
- top error aggregation penting untuk user memperbaiki file.

---

## 31. Validation for Event Consumers: Operational Semantics

Event validation failure tidak sama dengan REST validation failure.

### 31.1 Klasifikasi failure

```text
INVALID_SCHEMA          -> producer contract bug or unsupported version
INVALID_PAYLOAD         -> producer sent malformed semantic data
UNSUPPORTED_VERSION     -> compatibility issue
MISSING_REFERENCE       -> ordering/consistency issue, maybe retryable
STALE_EVENT             -> ignore or audit
DUPLICATE_EVENT         -> idempotency path
SECURITY_REJECTED       -> suspicious/untrusted source
```

### 31.2 Operational action

| Failure | Retry? | DLQ? | Alert? |
|---|---:|---:|---:|
| Invalid schema | No | Yes | Yes if spike |
| Invalid object payload | No | Yes/reject | Yes if producer bug |
| Missing reference | Maybe | After retries | Yes if persistent |
| Unsupported version | No | Yes | Yes |
| Duplicate | No | No | Usually no |
| Stale | No | Maybe audit | Usually no |

### 31.3 Observability label

```text
event_type
event_version
producer
consumer
failure_classification
rule_id
```

---

## 32. Governance untuk Database Constraint Violation

Database constraint adalah final integrity guard. Tetapi DB error sering terlalu teknis untuk user.

### 32.1 Mapping constraint name ke error code

Contoh:

```yaml
databaseConstraints:
  UK_APPLICATION_REFERENCE:
    errorCode: APPLICATION_REFERENCE_ALREADY_EXISTS
    httpStatus: 409
    userMessageKey: application.reference.duplicate
    ownerModule: application-management
  CK_PAYMENT_AMOUNT_POSITIVE:
    errorCode: PAYMENT_AMOUNT_MUST_BE_POSITIVE
    httpStatus: 422
    userMessageKey: payment.amount.positive
```

### 32.2 Kenapa constraint name penting?

Jika database constraint diberi nama random, mapping sulit.

Buruk:

```text
SYS_C0088123
```

Baik:

```text
UK_APPLICATION_REFERENCE
CK_PAYMENT_AMOUNT_POSITIVE
FK_CASE_ASSIGNEE_USER
```

### 32.3 Observability

Metric:

```text
db_constraint_violation_total{constraint_name, error_code, operation}
```

Kenaikan DB constraint violation dapat menunjukkan:

- application validation drift,
- race condition meningkat,
- client bug,
- missing pre-validation,
- data migration issue.

---

## 33. Governance untuk Custom Constraint

Custom constraint harus punya standard.

### 33.1 Custom constraint checklist

Setiap custom constraint sebaiknya menjawab:

- Apa rule id-nya?
- Apakah rule ini field-level, class-level, executable, atau container element?
- Apakah null valid?
- Apakah message key stabil?
- Apakah ada error code?
- Apakah rejected value boleh diexpose?
- Apakah validator pure?
- Apakah validator thread-safe?
- Apakah ada external dependency?
- Apakah rule bisa berubah?
- Apakah rule perlu version?
- Apakah ada test boundary?
- Apakah ada observability?

### 33.2 Custom annotation dengan metadata

Contoh:

```java
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
@Constraint(validatedBy = CaseReferenceValidator.class)
public @interface ValidCaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String code() default "CASE_REFERENCE_INVALID";
    String ruleId() default "CASE_REFERENCE_FORMAT";
    String ruleVersion() default "2026.06.01";
}
```

Trade-off:

- metadata dekat dengan rule,
- mudah diekstrak,
- tetapi perubahan version membutuhkan code change,
- externalized catalog mungkin lebih fleksibel.

---

## 34. Operational Anti-Patterns

### 34.1 Anonymous validation failure

Buruk:

```json
{
  "error": "Validation failed"
}
```

Masalah:

- user tidak tahu memperbaiki apa,
- support tidak bisa triage,
- dashboard tidak berguna,
- audit tidak jelas.

### 34.2 Rule tanpa owner

Rule ada di kode tetapi tidak ada yang tahu alasan bisnisnya.

Dampak:

- sulit diubah,
- sulit rollback,
- sulit menjelaskan ke auditor,
- technical debt.

### 34.3 Message parsing by client

Buruk:

```javascript
if (error.message.includes("must not be blank")) {
  // do something
}
```

Client harus memakai error code.

### 34.4 Raw rejected value in logs

Sudah dibahas: raw rejected value bisa berisi PII/secret/free text.

### 34.5 Rule langsung blocking tanpa observability

Rule baru langsung enforce tanpa mengetahui impact.

Dampak:

- client gagal,
- incident,
- rollback panik,
- trust turun.

### 34.6 Validation group sebagai hidden workflow state

Misalnya:

```java
@NotNull(groups = {Draft.class, Submitted.class, Approved.class, Reopened.class, Escalated.class})
```

Jika group taxonomy menjadi mini workflow engine, governance dan observability menjadi buruk.

### 34.7 DB constraint tidak dimapping

User mendapat:

```text
ORA-00001: unique constraint violated
```

atau generic 500.

Ini buruk untuk UX dan operasional.

### 34.8 Alert on all 4xx

Jika semua validation failure menjadi alert, tim akan mengalami alert fatigue.

Alert hanya untuk anomaly, spike, critical path, atau server-side validation bug.

---

## 35. Pattern: Validation Telemetry Adapter

Agar semua layer konsisten, buat adapter untuk merekam validation telemetry.

### 35.1 Interface

```java
public interface ValidationTelemetry {
    void recordViolations(ValidationTelemetryEvent event);
}
```

Event:

```java
public record ValidationTelemetryEvent(
        String layer,
        String module,
        String operation,
        String endpoint,
        String clientId,
        String apiVersion,
        String enforcementMode,
        List<ValidationViolationTelemetry> violations,
        long durationMillis
) {}

public record ValidationViolationTelemetry(
        String ruleId,
        String ruleVersion,
        String errorCode,
        String constraint,
        String path,
        String severity,
        boolean rejectedValueLogged,
        String rejectedValueType
) {}
```

### 35.2 Mapper dari `ConstraintViolation`

```java
public final class ConstraintViolationTelemetryMapper {

    public ValidationViolationTelemetry map(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();

        String constraint = descriptor.getAnnotation()
                .annotationType()
                .getSimpleName();

        String ruleId = resolveRuleId(descriptor);
        String ruleVersion = resolveRuleVersion(descriptor);
        String errorCode = resolveErrorCode(descriptor, violation);
        String severity = resolveSeverity(descriptor);

        return new ValidationViolationTelemetry(
                ruleId,
                ruleVersion,
                errorCode,
                constraint,
                normalizePath(violation.getPropertyPath()),
                severity,
                false,
                valueType(violation.getInvalidValue())
        );
    }

    private String normalizePath(Path path) {
        return path == null ? "" : path.toString();
    }

    private String valueType(Object value) {
        return value == null ? "null" : value.getClass().getSimpleName();
    }

    private String resolveRuleId(ConstraintDescriptor<?> descriptor) {
        Object value = descriptor.getAttributes().get("ruleId");
        return value instanceof String s && !s.isBlank()
                ? s
                : descriptor.getAnnotation().annotationType().getSimpleName();
    }

    private String resolveRuleVersion(ConstraintDescriptor<?> descriptor) {
        Object value = descriptor.getAttributes().get("ruleVersion");
        return value instanceof String s && !s.isBlank()
                ? s
                : "unspecified";
    }

    private String resolveErrorCode(ConstraintDescriptor<?> descriptor,
                                    ConstraintViolation<?> violation) {
        Object value = descriptor.getAttributes().get("code");
        if (value instanceof String s && !s.isBlank()) {
            return s;
        }
        return "VALIDATION_" + descriptor.getAnnotation()
                .annotationType()
                .getSimpleName()
                .toUpperCase(Locale.ROOT);
    }

    private String resolveSeverity(ConstraintDescriptor<?> descriptor) {
        Set<Class<? extends Payload>> payloads = descriptor.getPayload();
        if (payloads.stream().anyMatch(p -> p.getSimpleName().equals("Fatal"))) {
            return "FATAL";
        }
        if (payloads.stream().anyMatch(p -> p.getSimpleName().equals("Warning"))) {
            return "WARNING";
        }
        return "ERROR";
    }
}
```

Catatan:

- contoh ini sengaja sederhana,
- production code sebaiknya memakai registry lebih eksplisit,
- jangan bergantung hanya pada simple class name untuk severity,
- error code fallback perlu distandarkan.

---

## 36. Pattern: Rule Evaluation Result untuk Domain Policy

Untuk domain/workflow, jangan paksa semuanya menjadi `ConstraintViolation`. Buat model rule result sendiri.

```java
public enum RuleDecision {
    PASS,
    WARN,
    BLOCK
}

public record RuleEvaluation(
        String ruleId,
        String ruleVersion,
        RuleDecision decision,
        String severity,
        String code,
        String messageKey,
        String target,
        Map<String, Object> evidence
) {}
```

Evaluator:

```java
public interface CaseSubmissionRule {
    RuleEvaluation evaluate(CaseSubmissionContext context);
}
```

Aggregation:

```java
public final class PolicyResult {
    private final List<RuleEvaluation> evaluations;

    public boolean blocked() {
        return evaluations.stream()
                .anyMatch(e -> e.decision() == RuleDecision.BLOCK);
    }

    public List<RuleEvaluation> blockingRules() {
        return evaluations.stream()
                .filter(e -> e.decision() == RuleDecision.BLOCK)
                .toList();
    }

    public List<RuleEvaluation> warnings() {
        return evaluations.stream()
                .filter(e -> e.decision() == RuleDecision.WARN)
                .toList();
    }
}
```

Model ini lebih cocok untuk:

- workflow guard,
- regulatory decision,
- maker-checker,
- cross-entity validation,
- external dependency decision,
- soft rollout.

---

## 37. Rule Versioning in Long-Running Workflow

Dalam case management, workflow bisa berlangsung lama.

Masalah:

```text
Case dibuat Januari
Rule berubah Maret
Case disubmit Juni
Rule mana yang berlaku?
```

Pilihan:

### 37.1 Always latest rule

Semua case memakai rule terbaru.

Cocok jika:

- regulasi memang berlaku langsung,
- tidak ada grandfathering,
- user harus comply dengan rule saat action dilakukan.

Risiko:

- case lama tiba-tiba tidak bisa lanjut,
- user bingung,
- perlu migration/remediation.

### 37.2 Rule snapshot at case creation

Case memakai rule saat dibuat.

Cocok jika:

- contractual fairness penting,
- long-running application,
- perubahan rule tidak retroaktif.

Risiko:

- banyak rule version hidup bersamaan,
- testing dan support lebih kompleks.

### 37.3 Rule snapshot at stage entry

Rule dikunci saat masuk stage tertentu.

Cocok untuk workflow bertahap.

### 37.4 Decision harus eksplisit

Jangan biarkan rule versioning menjadi efek samping deployment.

Simpan:

```text
case.policyVersion
case.submissionRuleVersion
decision.ruleVersion
```

---

## 38. Validation and Support Operations

Support team butuh informasi yang berbeda dari developer.

### 38.1 Support-friendly error

Support sebaiknya bisa mencari berdasarkan:

- error code,
- correlation id,
- case id,
- user/channel,
- timestamp,
- rule id.

Support tidak perlu melihat stack trace.

### 38.2 Support knowledge base

Untuk setiap error code penting:

```yaml
code: DOCUMENT_FILE_SIZE_EXCEEDED
meaning: Uploaded document exceeds maximum allowed size.
userAction: Upload a smaller file or compress the document.
supportAction: Check document type and configured limit.
escalateTo: document-management-team
```

### 38.3 Redaction tetap berlaku

Support tool juga tidak boleh otomatis menampilkan raw rejected value sensitif.

---

## 39. Validation and Regulatory Defensibility

Sistem regulatory harus bisa menjelaskan keputusan.

Validation rejection harus menjawab:

- rule apa yang gagal,
- versi rule apa,
- kapan dievaluasi,
- terhadap data apa secara aman,
- siapa aktornya,
- action apa yang dicegah,
- apa remediation-nya,
- apakah rule blocking/warning,
- apakah ada override,
- apakah decision dapat diaudit.

### 39.1 Explainable rejection

Buruk:

```text
Invalid state.
```

Baik:

```text
The case cannot be submitted because the mandatory declaration document is missing.
Rule: CASE_REQUIRED_DOCUMENTS
Version: 2026.06.01
Remediation: Upload the declaration document and submit again.
```

Tentu response external mungkin tidak menampilkan rule version, tetapi audit trail internal sebaiknya menyimpannya.

### 39.2 Override governance

Jika rule bisa dioverride:

- siapa yang boleh override,
- alasan wajib diisi,
- evidence wajib,
- audit trail wajib,
- apakah maker-checker perlu,
- apakah override permanen atau hanya action itu.

Contoh:

```java
record RuleOverride(
        String ruleId,
        String actorId,
        String reasonCode,
        String remarks,
        Instant approvedAt,
        String approvedBy
) {}
```

Jangan jadikan override sebagai boolean tanpa audit.

---

## 40. Validation Configuration Management

Jika rule config externalized, konfigurasi harus diperlakukan seperti code.

### 40.1 Config harus versioned

Gunakan:

- Git-backed config,
- change approval,
- environment promotion,
- signed config bila high integrity,
- audit trail perubahan.

### 40.2 Config validation

Rule config sendiri perlu divalidasi.

Contoh:

```yaml
ruleId: APPLICANT_EMAIL_FORMAT
severity: BLOCKING # salah, severity harus ERROR/WARNING/FATAL
```

Harus gagal di CI atau startup.

### 40.3 Startup fail vs degrade

Jika rule config invalid:

- untuk sistem critical, fail startup bisa lebih aman,
- untuk non-critical dynamic config, fallback ke last-known-good config,
- jangan diam-diam disable semua validation.

---

## 41. Environment Differences

Validation behavior harus konsisten antar environment, kecuali memang dikonfigurasi.

Risiko:

- DEV rule warning, PROD blocking,
- UAT message bundle beda,
- staging tidak punya DB constraint sama,
- feature flag lupa dipromote,
- timezone/clock beda,
- locale default beda.

### 41.1 Environment parity checklist

- dependency version sama,
- message bundle sama,
- validation config sama atau diketahui beda,
- DB schema constraint sama,
- timezone jelas,
- locale fallback jelas,
- feature flag state terdokumentasi,
- OpenAPI version sama.

---

## 42. Time-Based Validation Governance

Temporal validation sering bermasalah.

Contoh:

```java
@FutureOrPresent
private LocalDate effectiveDate;
```

Pertanyaan:

- future menurut timezone siapa?
- apakah tanggal hari ini valid sampai pukul 23:59?
- apakah batch dari zona waktu lain valid?
- apakah rule berubah saat DST?
- apakah test memakai fixed clock?
- apakah production node clock sync?

### 42.1 ClockProvider

Jakarta Validation mendukung konsep clock provider untuk temporal constraints. Hibernate Validator juga menyediakan konfigurasi terkait. Untuk domain policy, lebih baik inject `Clock` eksplisit.

```java
public final class SubmissionDeadlinePolicy {
    private final Clock clock;

    public SubmissionDeadlinePolicy(Clock clock) {
        this.clock = clock;
    }

    public RuleEvaluation evaluate(CaseContext context) {
        Instant now = Instant.now(clock);
        // evaluate deadline deterministically
    }
}
```

### 42.2 Observability temporal rule

Metric:

```text
workflow.deadline.validation.blocked.count{rule_id, state}
```

Audit:

```text
rule evaluated at: 2026-06-16T10:00:00+07:00
business timezone: Asia/Jakarta
```

---

## 43. Performance Observability

Part 024 sudah membahas performance engineering. Di sini fokus pada operasi.

### 43.1 Metrics

```text
validation.duration
validation.duration.p95
validation.duration.p99
validation.constraint.execution.count
validation.graph.node.count
validation.cascade.depth
validation.message.interpolation.duration
validation.external_dependency.count
```

Tidak semua mudah diambil dari provider, tetapi kita bisa mengukur di boundary:

```java
long start = System.nanoTime();
Set<ConstraintViolation<T>> violations = validator.validate(object, groups);
long elapsed = System.nanoTime() - start;
```

### 43.2 Alert performance

Alert jika:

- validation latency naik setelah rule baru,
- regex rule memakan CPU,
- custom validator memanggil DB terlalu sering,
- batch validation melambat tajam,
- object graph validation tiba-tiba membesar.

### 43.3 Rule performance budget

Rule tertentu perlu budget:

```yaml
ruleId: CASE_REQUIRED_DOCUMENTS
expectedCost: MEDIUM
maxP95Millis: 20
externalDependency: false
```

Validator yang memanggil network/external service sebaiknya dihindari atau dipindah ke policy/application layer.

---

## 44. Security Observability

Validation failure juga bisa menjadi sinyal abuse.

Contoh:

- banyak path traversal pattern,
- payload terlalu besar,
- regex attack attempt,
- banyak invalid enum dari IP/client tertentu,
- banyak invalid token-like fields,
- banyak malformed JSON,
- banyak file upload invalid.

### 44.1 Security metrics

```text
security.validation.payload_too_large.count
security.validation.invalid_file_type.count
security.validation.path_traversal_rejected.count
security.validation.regex_suspicious.count
security.validation.invalid_control_chars.count
```

### 44.2 Jangan overexpose detail

Untuk suspicious input, response jangan terlalu membantu attacker.

Internal log:

```text
PATH_TRAVERSAL_PATTERN_REJECTED
```

External response:

```json
{
  "code": "INVALID_FILE_PATH",
  "message": "The file path is invalid."
}
```

---

## 45. Multi-Tenant and Jurisdiction-Specific Rules

Dalam sistem multi-tenant atau multi-jurisdiction, rule bisa berbeda.

### 45.1 Contoh

```text
Tenant A: max attachment size 10 MB
Tenant B: max attachment size 25 MB
Jurisdiction X: applicant age >= 18
Jurisdiction Y: applicant age >= 21
```

### 45.2 Governance requirement

Setiap variasi rule harus punya:

- tenant/jurisdiction applicability,
- rule version,
- effective date,
- owner,
- test coverage,
- observability label yang cardinality-nya aman.

Jangan jadikan tenant id ribuan sebagai metrics label tanpa kontrol.

### 45.3 Pattern

Gunakan policy resolver:

```java
public interface ValidationPolicyResolver {
    ValidationPolicy resolve(TenantId tenantId, Jurisdiction jurisdiction, Instant at);
}
```

Lalu rule dievaluasi terhadap policy snapshot.

---

## 46. Validation and Data Migration

Rule baru sering gagal pada data lama.

### 46.1 Sebelum enforce rule baru

Lakukan data scan:

```sql
SELECT COUNT(*)
FROM application
WHERE declaration_accepted IS NULL;
```

Atau application-level scan untuk rule kompleks.

### 46.2 Migration options

- backfill data,
- mark legacy exception,
- enforce only for new records,
- enforce at transition only,
- allow read/update existing but block new invalid state,
- warning first,
- manual remediation queue.

### 46.3 Anti-pattern

Menambahkan `@NotNull` pada entity lama lalu semua update gagal karena record historis invalid.

Validation harus mempertimbangkan data lifecycle.

---

## 47. Validation in Read Models and Reporting

Validation tidak hanya untuk write path.

Read model/reporting juga butuh data quality checks:

- missing reference,
- invalid derived value,
- inconsistent denormalized field,
- stale projection,
- invalid status combination.

Namun read-side validation biasanya tidak memblokir user input. Ia menghasilkan:

- data quality alert,
- repair job,
- projection rebuild,
- audit issue.

Jangan mencampur read model data quality dengan request validation.

---

## 48. Governance Review Board: Kapan Diperlukan?

Untuk sistem kecil, PR review cukup. Untuk platform besar, perlu rule governance lightweight.

### 48.1 Rule change requiring review

Perubahan berikut sebaiknya butuh approval tambahan:

- optional menjadi required,
- max length diperkecil,
- allowed values dikurangi,
- new blocking workflow rule,
- DB constraint baru pada tabel besar,
- rule dengan compliance impact,
- rule yang memengaruhi external API,
- rule yang memengaruhi batch/event integration,
- rule dengan retroactive effect.

### 48.2 Review questions

- Apa alasan rule?
- Siapa owner?
- Layer mana yang tepat?
- Apakah breaking?
- Apakah data lama terdampak?
- Apakah frontend/client siap?
- Apakah OpenAPI/schema update?
- Apakah warning/observe period perlu?
- Apakah error code stabil?
- Apakah metrics/alert tersedia?
- Apakah audit requirement terpenuhi?

---

## 49. Practical Checklist for Production-Grade Validation Governance

Gunakan checklist ini untuk rule penting.

### 49.1 Design checklist

- [ ] Rule punya tujuan jelas.
- [ ] Layer rule tepat.
- [ ] Rule tidak mencampur authorization dengan DTO validation.
- [ ] Rule tidak memanggil external dependency di Bean Validator hot path.
- [ ] Rule punya error code stabil.
- [ ] Rule punya message key.
- [ ] Rule punya owner.
- [ ] Rule punya severity.
- [ ] Rule punya enforcement mode.
- [ ] Rule punya version jika domain/regulatory penting.
- [ ] Rule punya migration/backward compatibility assessment.

### 49.2 Implementation checklist

- [ ] Constraint null semantics jelas.
- [ ] Custom validator thread-safe.
- [ ] No raw PII logging.
- [ ] API error response structured.
- [ ] Path normalization benar.
- [ ] Groups tidak menjadi hidden workflow engine.
- [ ] DB constraint tetap ada untuk final integrity jika perlu.
- [ ] Message tidak menjadi primary client contract.

### 49.3 Observability checklist

- [ ] Failure count by rule id.
- [ ] Failure count by endpoint/operation.
- [ ] Warning count.
- [ ] Observe-only would-block count.
- [ ] Validation latency.
- [ ] Spike alert untuk critical rule.
- [ ] Response validation failure alert.
- [ ] DB constraint violation mapping.
- [ ] Event DLQ validation metric.

### 49.4 Rollout checklist

- [ ] Data scan dilakukan.
- [ ] Impact client diketahui.
- [ ] FE/API docs/client SDK update.
- [ ] Observe-only jika perlu.
- [ ] Warning phase jika perlu.
- [ ] Blocking date disepakati.
- [ ] Rollback/config switch tersedia.
- [ ] Support team tahu error code.
- [ ] Dashboard dipantau setelah release.

### 49.5 Audit checklist

- [ ] Rule id disimpan untuk decision penting.
- [ ] Rule version disimpan.
- [ ] Actor/action/case context disimpan.
- [ ] Evidence aman dan cukup.
- [ ] Override dicatat.
- [ ] Retention policy sesuai.

---

## 50. Mini Case Study: Rule Baru untuk Submission Case

### 50.1 Requirement

Sebelum case bisa submit:

```text
Jika application type = COMPANY, maka UEN wajib diisi dan declaration document wajib uploaded.
```

### 50.2 Salah desain

Menaruh semuanya di DTO:

```java
@NotBlank
private String uen;

@NotNull
private UUID declarationDocumentId;
```

Masalah:

- berlaku juga untuk INDIVIDUAL,
- tidak tahu document benar-benar uploaded atau tidak,
- tidak memperhatikan workflow state,
- tidak punya rule version,
- tidak punya warning mode,
- tidak bisa explain ke audit.

### 50.3 Desain lebih baik

Layering:

1. DTO validation:
   - `applicationType` wajib,
   - `uen` format jika ada,
   - `declarationDocumentId` UUID jika ada.

2. Domain/workflow policy:
   - jika type COMPANY dan action SUBMIT, UEN required,
   - declaration document harus exists dan attached to case,
   - rule version dicatat,
   - decision dapat warning/block.

3. Persistence:
   - FK document/case,
   - DB integrity.

4. Observability:
   - metric by `CASE_COMPANY_UEN_REQUIRED`,
   - metric by `CASE_DECLARATION_DOCUMENT_REQUIRED`,
   - warning/observe-only before enforcement.

5. Audit:
   - rule id/version/evidence.

### 50.4 Policy result

```json
{
  "blocked": true,
  "violations": [
    {
      "ruleId": "CASE_COMPANY_UEN_REQUIRED",
      "ruleVersion": "2026.06.01",
      "code": "COMPANY_UEN_REQUIRED",
      "target": "applicant.uen",
      "severity": "ERROR",
      "message": "UEN is required for company applications."
    },
    {
      "ruleId": "CASE_DECLARATION_DOCUMENT_REQUIRED",
      "ruleVersion": "2026.06.01",
      "code": "DECLARATION_DOCUMENT_REQUIRED",
      "target": "documents",
      "severity": "ERROR",
      "message": "Declaration document must be uploaded before submission."
    }
  ]
}
```

---

## 51. Java 8 hingga Java 25: Operational Implications

### 51.1 Java 8

- Bean Validation 2.0 umum dipakai.
- `javax.validation` masih dominan.
- Tidak ada records.
- DTO mutable masih umum.
- Governance harus lebih banyak lewat convention dan tests.

### 51.2 Java 11

- Transitional enterprise baseline.
- Banyak sistem masih Spring Boot 2/HV 6.
- Persiapan migrasi `javax` ke `jakarta` penting.

### 51.3 Java 17

- Baseline penting untuk Spring Boot 3/Jakarta modern/HV 8/9 stack.
- Records bisa dipakai.
- Jakarta namespace dominan pada stack baru.

### 51.4 Java 21

- LTS modern.
- Virtual threads membuat concurrency model berubah, tetapi validation tetap harus tidak memblokir sembarangan.
- Immutable DTO/records makin layak.

### 51.5 Java 25

- Modern target untuk codebase baru.
- Governance tetap sama: rule version, observability, compatibility, audit.
- Bahasa makin modern, tetapi operational correctness tetap arsitektural.

---

## 52. Relationship with Jakarta Validation and Hibernate Validator

Jakarta Validation menyediakan:

- constraint declaration,
- validation API,
- metadata API,
- object graph validation,
- method/constructor validation,
- `ConstraintViolation`,
- `ConstraintDescriptor`,
- `payload`,
- message interpolation.

Hibernate Validator sebagai implementation menyediakan:

- provider behavior,
- fail-fast mode,
- Hibernate-specific constraints,
- programmatic mapping,
- dynamic group sequence,
- additional extension points,
- integration dengan ekosistem Hibernate/Jakarta/Spring/Quarkus.

Tetapi governance tidak otomatis diberikan oleh spesifikasi atau provider. Governance adalah arsitektur di atas validation API.

Dengan kata lain:

```text
Jakarta Validation gives you the mechanism.
Hibernate Validator gives you a mature implementation and extensions.
Your architecture must provide observability, rollout, ownership, and auditability.
```

---

## 53. Key Takeaways

1. Validation rule adalah production contract, bukan sekadar annotation.
2. Rule penting harus punya owner, error code, severity, enforcement mode, dan kadang rule version.
3. Metrics harus menjawab rule mana yang gagal, endpoint/client mana yang terdampak, dan apakah rejection rate berubah.
4. Jangan gunakan raw rejected value sebagai log/metric default.
5. Message bukan contract utama; error code adalah contract.
6. Rule baru yang berpotensi breaking sebaiknya rollout melalui observe-only, warning, lalu blocking.
7. Validation drift antara FE/BE/OpenAPI/DB/event schema harus dicegah dengan contract tests dan rule catalog.
8. Database constraint violation harus dimapping ke error code yang stabil.
9. Workflow/regulatory validation perlu audit trail, rule version, dan explainable decision.
10. Jakarta Validation dan Hibernate Validator menyediakan mekanisme; governance harus dirancang oleh arsitektur aplikasi.

---

## 54. Latihan Praktis

### Latihan 1 — Rule Catalog

Ambil 10 validation rules dari sistem yang kamu kenal. Buat catalog dengan kolom:

- ruleId,
- errorCode,
- ownerModule,
- severity,
- enforcementMode,
- messageKey,
- layer,
- introducedIn,
- dataSensitivity,
- safeToExposeRejectedValue.

Evaluasi apakah ada rule tanpa owner atau code stabil.

### Latihan 2 — Dashboard Design

Desain dashboard validation untuk endpoint:

```http
POST /applications/{id}/submit
```

Minimal tampilkan:

- rejection rate,
- top rule id,
- rejection by client/channel,
- warning count,
- observe-only would-block count,
- latency p95.

### Latihan 3 — Breaking Rule Assessment

Analisis perubahan:

```java
@Size(max = 100)
```

menjadi:

```java
@Size(max = 50)
```

Untuk field `remarks` pada API external.

Jawab:

- apakah breaking?
- siapa terdampak?
- data lama bagaimana?
- rollout seperti apa?
- metric apa yang perlu?
- apakah rejected value boleh dilog?

### Latihan 4 — Incident Triage

Skenario:

Setelah deploy, HTTP 422 naik 8x pada endpoint submit. Top error code adalah `DECLARATION_DOCUMENT_REQUIRED`.

Buat triage plan:

- data yang dicek,
- dashboard yang dilihat,
- mitigasi cepat,
- decision rollback/warning,
- komunikasi ke support/client.

---

## 55. Penutup

Top-tier validation engineering bukan hanya kemampuan menulis annotation atau custom validator. Itu baru bagian mekanisme.

Di sistem besar, validation adalah kontrol operasional. Ia harus bisa:

- diamati,
- dijelaskan,
- diuji,
- di-rollout,
- di-versioning,
- diaudit,
- dimonitor,
- dikoreksi,
- dan dikaitkan dengan kontrak API, workflow, database, event, serta user experience.

Jika validation rule tidak observable, maka ketika gagal di production, tim hanya melihat “400/422 naik”. Jika validation rule tidak punya owner, ia menjadi legacy rule yang tidak berani disentuh. Jika validation rule tidak punya error code stabil, frontend dan support akan bergantung pada message rapuh. Jika validation rule tidak punya rollout mode, perubahan kecil bisa menjadi incident besar.

Maka prinsip akhirnya:

> Treat important validation rules like production policy: versioned, observable, explainable, testable, and operationally governable.

---

## Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-030.md
```

Topik:

```text
Capstone: Designing a Production-Grade Validation Framework for a Case Management Platform
```
