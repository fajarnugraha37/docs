# learn-java-camunda-7-bpm-platform-engineering-part-008

# Variable System Deep Dive: Serialization, Typed Values, Spin, JSON/XML, Object Variables

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Part: `008`  
> Topik: Variable System Deep Dive  
> Target: Java 8 sampai Java 25, Camunda BPM Platform / Camunda 7.x  
> Level: Advanced / platform engineering / production correctness

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas persistence, flush ordering, optimistic locking, dan database isolation. Sekarang kita masuk ke salah satu area yang terlihat sederhana tetapi sering menjadi sumber masalah paling mahal di Camunda 7: **process variables**.

Banyak developer memperlakukan variable Camunda seperti `Map<String, Object>` biasa:

```java
execution.setVariable("status", "APPROVED");
execution.setVariable("application", applicationDto);
execution.setVariable("payload", jsonString);
```

Secara API memang terasa seperti map. Tetapi secara engine, variable adalah:

1. data runtime yang melekat ke scope tertentu,
2. entity database yang ikut transaction engine,
3. nilai yang bisa diserialisasi,
4. nilai yang bisa masuk history,
5. nilai yang bisa dipakai expression/gateway/listener/delegate,
6. nilai yang bisa dibaca REST API,
7. nilai yang bisa menyebabkan coupling antar deployment,
8. nilai yang bisa membuat storage membengkak,
9. nilai yang bisa menimbulkan security risk,
10. nilai yang bisa membuat migration menjadi sulit.

Jadi mental model yang benar:

> Variable Camunda bukan sekadar data. Variable adalah bagian dari durable execution state.

Kalau process instance adalah state machine jangka panjang, maka variable adalah sebagian dari memori state machine itu. Kesalahan variable modelling sama berbahayanya dengan kesalahan schema design di database aplikasi.

---

## 1. Learning Objectives

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. membedakan variable runtime, task variable, local variable, transient variable, dan historical variable;
2. memahami bagaimana variable scope mengikuti execution tree;
3. memilih Java Object API vs Typed Value API secara benar;
4. memahami primitive value, file value, object value, JSON/XML Spin value, bytes, dan null;
5. mendesain variable agar aman untuk long-running process instance;
6. menghindari Java serialization trap;
7. memahami dampak variable terhadap `ACT_RU_VARIABLE`, `ACT_HI_VARINST`, `ACT_HI_DETAIL`, dan `ACT_GE_BYTEARRAY`;
8. membuat strategy untuk JSON/XML payload, DTO versioning, and external API payload;
9. memahami `deserializeValues=false` pada REST API;
10. mendesain variable agar tidak merusak performance, auditability, dan migration.

---

## 2. Mental Model Utama

### 2.1 Variable adalah state, bukan parameter biasa

Dalam Java biasa:

```java
someMethod(customerId, amount, decision);
```

Parameter hilang setelah method selesai.

Dalam Camunda:

```java
execution.setVariable("customerId", customerId);
execution.setVariable("amount", amount);
execution.setVariable("decision", decision);
```

Variable bisa hidup selama:

- process instance masih aktif,
- task masih aktif,
- history belum dibersihkan,
- byte array belum dihapus,
- migration belum selesai,
- audit belum dipurge.

Artinya variable adalah **durable business memory**.

### 2.2 Variable mengikuti execution scope

Camunda 7 runtime state adalah execution tree. Karena itu variable tidak hanya “milik process instance”. Variable bisa melekat ke:

- process instance execution,
- child execution,
- embedded subprocess execution,
- multi-instance body execution,
- task,
- local scope tertentu.

Parent variable terlihat oleh child. Child local variable tidak terlihat oleh parent. Child bisa shadow variable parent dengan nama yang sama.

Mental model:

```text
ProcessInstance execution
  variables:
    applicationId = "APP-001"
    riskScore     = 80

  EmbeddedSubprocess execution
    local variables:
      reviewerGroup = "senior-reviewer"

    UserTask execution A
      local variables:
        decision = "APPROVE"

    UserTask execution B
      local variables:
        decision = "REJECT"
```

Kalau kamu hanya melihat nama variable `decision`, kamu belum tahu variable mana yang dimaksud. Kamu harus tahu scope-nya.

### 2.3 Variable bukan single source of truth untuk semua data

Camunda variable cocok untuk:

- routing decision,
- state kecil yang dibutuhkan engine,
- business key/reference id,
- snapshot ringkas untuk audit,
- correlation key,
- SLA metadata,
- assignment metadata,
- flags yang memang bagian dari process state.

Camunda variable kurang cocok untuk:

- payload besar,
- dokumen binary besar,
- full aggregate domain object,
- object graph JPA/Hibernate,
- mutable DTO dengan class version sering berubah,
- data yang sering diupdate per detik,
- cache teknis,
- secret/token/password,
- data analytics besar.

Rule praktis:

> Simpan identifier dan process-relevant facts di Camunda. Simpan aggregate besar di domain database/document store/object storage.

---

## 3. Variable Scope dan Visibility

### 3.1 Scope entities

Di Camunda 7, variable scope utama adalah:

| Scope | Contoh | Kegunaan |
|---|---|---|
| Process instance | root execution | data global process |
| Execution | subprocess, parallel branch, event scope | data lokal pada cabang/scope tertentu |
| Task | user task local variables | data task-specific |

Contoh Java:

```java
// Global-ish: akan diset pada scope terdekat yang sudah punya variable,
// atau parent/root jika belum ada tergantung context API.
execution.setVariable("riskScore", 75);

// Local: hanya scope execution saat ini.
execution.setVariableLocal("reviewComment", "Need senior review");
```

Contoh TaskService:

```java
taskService.setVariable(taskId, "applicationId", "APP-001");
taskService.setVariableLocal(taskId, "uiDraft", "temporary note");
```

### 3.2 Parent visibility

Jika variable ada di parent scope, child dapat membacanya:

```text
Root: applicationId = APP-001
  Child execution: can read applicationId
```

Tetapi parent tidak dapat otomatis membaca local variable child:

```text
Root: cannot see child-only reviewComment unless queried specifically or propagated.
  Child execution: reviewComment = "OK"
```

### 3.3 Shadowing

Variable dengan nama sama bisa muncul di beberapa scope:

```text
Root:
  decision = "PENDING"

Parallel reviewer A:
  decision = "APPROVE"

Parallel reviewer B:
  decision = "REJECT"
```

Di expression atau delegate, `getVariable("decision")` akan resolve dari current scope naik ke parent. Ini bisa membuat bug sangat halus.

Bad smell:

```java
String decision = (String) execution.getVariable("decision");
```

Lebih eksplisit:

```java
String localDecision = (String) execution.getVariableLocal("decision");
```

Atau gunakan nama domain-specific:

```text
reviewerADecision
reviewerBDecision
finalDecision
```

### 3.4 Scope decision table

| Data | Scope yang disarankan | Alasan |
|---|---|---|
| `applicationId` | process instance | correlation/global reference |
| `caseId` | process instance | durable business identity |
| `reviewerDecision` dalam parallel branch | execution local/task local | tidak bentrok antar reviewer |
| `finalDecision` | process instance setelah aggregation | hasil final global |
| UI draft note | task local atau app DB | bukan process global state |
| HTTP response raw payload besar | external storage + reference | hindari DB engine bloat |
| idempotency key | process/global atau app DB | recovery dan deduplication |
| temporary auth token | transient variable atau jangan simpan | tidak boleh persist |

---

## 4. Variable dan Database Tables

Variable runtime biasanya terkait dengan beberapa tabel:

| Table | Isi |
|---|---|
| `ACT_RU_VARIABLE` | live runtime variables |
| `ACT_HI_VARINST` | historical variable instance, tergantung history level |
| `ACT_HI_DETAIL` | detailed variable update history, tergantung history level |
| `ACT_GE_BYTEARRAY` | payload besar/serialized value/file/bytes/resources |

Simplified structure:

```text
ACT_RU_VARIABLE
  ID_
  REV_
  TYPE_
  NAME_
  PROC_INST_ID_
  EXECUTION_ID_
  TASK_ID_
  BYTEARRAY_ID_
  DOUBLE_
  LONG_
  TEXT_
  TEXT2_

ACT_GE_BYTEARRAY
  ID_
  NAME_
  BYTES_
  DEPLOYMENT_ID_
```

Untuk primitive kecil, value bisa masuk kolom `TEXT_`, `LONG_`, atau `DOUBLE_`. Untuk serialized object, file, bytes, atau nilai besar, data bisa masuk `ACT_GE_BYTEARRAY`.

Konsekuensinya:

1. variable besar memperbesar DB engine;
2. update variable bisa membuat history detail membengkak;
3. serialized object bisa membuat byte array tumbuh;
4. file variable sebaiknya dipakai sangat hati-hati;
5. variable query dapat menjadi mahal jika dipakai seperti search engine.

---

## 5. Java Object API vs Typed Value API

Camunda 7 menyediakan dua gaya utama.

### 5.1 Java Object API

Contoh:

```java
Integer score = (Integer) execution.getVariable("riskScore");
execution.setVariable("riskScore", 90);
```

Kelebihan:

- sederhana,
- enak untuk delegate in-process,
- cocok untuk primitive dan small DTO,
- minim boilerplate.

Kekurangan:

- serialization metadata tersembunyi,
- sulit mengontrol format serialization,
- bisa memicu deserialization class yang tidak tersedia,
- tidak bisa membuat transient variable secara eksplisit,
- raw `Object` casting rawan.

Cocok untuk:

- `String`, `Integer`, `Long`, `Boolean`, `Date`, `Double`, `byte[]` kecil,
- delegate yang tahu classpath process application,
- variable kecil dan stabil.

### 5.2 Typed Value API

Contoh:

```java
import static org.camunda.bpm.engine.variable.Variables.*;

IntegerValue score = integerValue(90);
execution.setVariable("riskScore", score);

StringValue status = stringValue("PENDING_REVIEW");
execution.setVariable("status", status);
```

Untuk object:

```java
ObjectValue value = Variables
    .objectValue(orderSnapshot)
    .serializationDataFormat(Variables.SerializationDataFormats.JSON)
    .create();

execution.setVariable("orderSnapshot", value);
```

Kelebihan:

- bisa mengatur serialization format,
- bisa membaca serialized representation,
- bisa membuat transient variable,
- lebih eksplisit untuk REST/non-Java clients,
- lebih cocok untuk platform/multi-app architecture.

Kekurangan:

- lebih verbose,
- tetap perlu serializer yang benar,
- tetap bisa coupling jika `objectTypeName` mengikat ke class Java tertentu.

Rule:

> Gunakan Java Object API untuk primitive dan code lokal yang sederhana. Gunakan Typed Value API saat format, deserialization, transient behavior, REST boundary, atau long-running compatibility penting.

---

## 6. Supported Variable Value Types

### 6.1 Primitive values

Umumnya:

| Camunda type | Java type | Catatan |
|---|---|---|
| `boolean` | `Boolean` | routing flag |
| `short` | `Short` | jarang perlu |
| `integer` | `Integer` | score kecil |
| `long` | `Long` | ids numerik, timestamps hati-hati |
| `double` | `Double` | jangan untuk uang presisi tinggi |
| `date` | `java.util.Date` | time zone semantic harus jelas |
| `string` | `String` | ada batas DB |
| `bytes` | `byte[]` | raw bytes, hati-hati storage |
| `null` | `null` | explicit null value |

Untuk uang, jangan gunakan `double` kalau presisi penting. Lebih aman:

```text
amountMinorUnit = 125000L
currency        = "IDR"
```

Atau simpan decimal sebagai string terstandar jika harus:

```text
amount = "1250.00"
currency = "SGD"
```

### 6.2 String length limitation

String variable disimpan di kolom varchar/nvarchar dengan batas tertentu. Pada dokumentasi Camunda 7.24, string values memiliki batas 4000 karakter, dan 2000 untuk Oracle, bergantung database dan charset. Engine tidak memvalidasi panjang tersebut sebelum mengirim ke database; exception akan muncul dari DB jika batas terlampaui.

Implikasi:

- jangan simpan JSON besar sebagai plain string variable;
- jangan simpan HTML/email body besar sebagai string variable;
- validasi panjang sebelum `setVariable`;
- gunakan external storage atau typed object/bytes/file dengan desain sadar.

### 6.3 File values

File variable memungkinkan menyimpan BLOB plus metadata:

```java
FileValue document = Variables
    .fileValue("evidence.pdf")
    .file(new File("/tmp/evidence.pdf"))
    .mimeType("application/pdf")
    .encoding("binary")
    .create();

runtimeService.setVariable(processInstanceId, "evidenceFile", document);
```

Tetapi production guidance:

> Jangan jadikan Camunda database sebagai document management system.

Lebih baik:

```text
evidenceDocumentId = "DOC-2026-00001"
evidenceStorageKey = "s3://bucket/cases/CASE-001/evidence.pdf"
evidenceHash = "sha256:..."
```

Camunda menyimpan reference, metadata, dan audit-relevant state; file besar disimpan di storage khusus.

### 6.4 Bytes values

`byte[]` cocok untuk data kecil yang memang binary. Untuk payload besar, gunakan storage eksternal.

Bad:

```java
execution.setVariable("fullZipArchive", largeByteArray);
```

Better:

```java
execution.setVariable("archiveStorageKey", storageKey);
execution.setVariable("archiveChecksum", sha256);
```

### 6.5 Object values

Object variable membuat Camunda harus serialize object Java.

Contoh:

```java
public class ApplicationSnapshot implements Serializable {
    private String applicationId;
    private String applicantName;
    private String status;
}

execution.setVariable("applicationSnapshot", snapshot);
```

Masalahnya bukan hanya `Serializable`. Masalahnya:

- class harus tersedia saat deserialization;
- field berubah dapat memecahkan backward compatibility;
- package rename merusak object type;
- deployment lama dan baru bisa punya class berbeda;
- remote REST client mungkin tidak punya class itu;
- Tasklist tidak bisa memahami binary Java serialization.

Rule:

> Jangan simpan domain aggregate / JPA entity / mutable class internal sebagai object variable untuk process jangka panjang.

---

## 7. Java Serialization Trap

### 7.1 Kenapa berbahaya

Java serialization terlihat praktis:

```java
execution.setVariable("order", orderObject);
```

Tetapi untuk platform jangka panjang, ini problem besar:

1. **Class coupling**: variable membutuhkan class Java yang sama untuk deserialization.
2. **Version coupling**: perubahan field/package/serialVersionUID bisa memecahkan old instances.
3. **Security risk**: Java deserialization punya sejarah vulnerability luas.
4. **REST/API coupling**: non-Java clients tidak bisa membaca value secara natural.
5. **Migration pain**: Camunda 7 ke Camunda 8 atau platform lain lebih sulit.
6. **Human unreadable**: operator tidak bisa inspect dengan mudah.

Camunda 7.24 bahkan menyatakan Java serialization format forbidden by default dan harus diaktifkan eksplisit jika ingin dipakai. Ini sinyal kuat bahwa Java serialization sebaiknya bukan default strategy modern.

### 7.2 Kapan masih bisa diterima

Sangat terbatas:

- internal short-lived process,
- same deployment classpath,
- tidak dibuka via REST/non-Java client,
- tidak untuk data sensitif,
- tidak untuk long-running regulatory process,
- ada test migration/deserialization across versions.

### 7.3 Strategy yang lebih aman

Gunakan JSON snapshot:

```java
ObjectValue value = Variables
    .objectValue(snapshot)
    .serializationDataFormat(Variables.SerializationDataFormats.JSON)
    .create();

execution.setVariable("applicationSnapshot", value);
```

Atau simpan plain JSON sebagai JSON typed value / Spin JSON, tergantung stack:

```java
SpinJsonNode json = JSON("{\"applicationId\":\"APP-001\",\"status\":\"PENDING\"}");
execution.setVariable("application", json);
```

Namun bahkan JSON object variable masih perlu schema discipline.

---

## 8. JSON/XML dan Camunda Spin

### 8.1 Apa itu Spin dalam konteks variable

Camunda Spin adalah optional component untuk bekerja dengan JSON/XML. Ia menyediakan:

- fluent API untuk membaca/manipulasi JSON/XML;
- integration dengan expression language;
- integration dengan scripting;
- native JSON/XML variable value types;
- serializer untuk object ke JSON/XML.

Contoh expression:

```text
${customer.prop("riskLevel").stringValue() == "HIGH"}
```

Atau untuk XML:

```text
${XML(customer).xPath("/customer/address/postcode").element().textContent() == "1234"}
```

### 8.2 JSON sebagai process data contract

Untuk enterprise/regulatory system, JSON sering menjadi format terbaik untuk process variable yang kompleks karena:

- readable,
- language-neutral,
- REST-friendly,
- migration-friendly,
- classpath-independent jika tidak dipaksa deserialized ke Java class,
- bisa divalidasi dengan schema.

Tetapi JSON juga bisa menjadi anti-pattern kalau dipakai sebagai tempat menaruh semuanya.

Bad:

```json
{
  "application": {
    "allFields": "...",
    "allDocuments": "...",
    "fullExternalApiResponse": "...",
    "allUiState": "..."
  }
}
```

Better:

```json
{
  "applicationId": "APP-001",
  "caseId": "CASE-001",
  "status": "PENDING_SENIOR_REVIEW",
  "risk": {
    "score": 82,
    "level": "HIGH",
    "modelVersion": "risk-v3"
  },
  "snapshotVersion": 2
}
```

### 8.3 XML variable

XML masih relevan untuk:

- SOAP legacy integration,
- document-like payload,
- government/enterprise data exchange,
- schema-validated payload.

Namun XML juga harus dijaga:

- jangan simpan raw huge XML kalau bisa simpan reference;
- disable unsafe XML parser behavior di external processing layer;
- jangan jadikan BPMN expression sebagai tempat XPath kompleks yang susah dites.

---

## 9. REST API Variable Semantics

REST API merepresentasikan variable sebagai JSON:

```json
{
  "type": "String",
  "value": "Some value",
  "valueInfo": {}
}
```

Untuk object serialized JSON:

```json
{
  "variables": {
    "applicationSnapshot": {
      "value": "{\"applicationId\":\"APP-001\",\"status\":\"PENDING\"}",
      "type": "Object",
      "valueInfo": {
        "objectTypeName": "com.example.ApplicationSnapshot",
        "serializationDataFormat": "application/json"
      }
    }
  }
}
```

### 9.1 `deserializeValues=false`

Ketika REST client mengambil variable object, sebaiknya gunakan:

```text
GET /process-instance/{id}/variables?deserializeValues=false
```

Kenapa?

- server tidak perlu deserialize ke Java object;
- client non-Java menerima serialized representation;
- mengurangi risiko classpath/deserialization;
- lebih aman untuk platform boundary.

Prinsip:

> REST boundary sebaiknya membawa serialized data, bukan Java object graph.

### 9.2 Capitalization type names

REST API memakai type dengan huruf besar:

```json
{ "type": "String" }
```

Engine internal docs sering memakai lowercase:

```text
string
integer
boolean
```

Jangan bingung: itu representasi API berbeda.

---

## 10. Transient Variables

Transient variable adalah variable yang:

- hanya hidup di current transaction;
- tidak disimpan ke database;
- hilang saat wait state/commit boundary;
- hanya bisa dibuat via Typed Value API;
- bisa digunakan untuk data sementara.

Contoh:

```java
TypedValue token = Variables.stringValue("temporary-token", true);
execution.setVariable("accessToken", token);
```

Object transient:

```java
TypedValue requestContext = Variables
    .objectValue(context, true)
    .create();

execution.setVariable("requestContext", requestContext);
```

### 10.1 Kapan digunakan

Cocok untuk:

- temporary token,
- runtime-only context,
- expensive lookup result yang hanya dipakai dalam satu transaction,
- secret yang tidak boleh persist,
- data bantuan untuk expression/delegate chain synchronous.

Tidak cocok untuk:

- data yang dibutuhkan setelah user task,
- data yang dibutuhkan setelah async boundary,
- data yang dibutuhkan oleh job executor,
- audit-relevant fact,
- correlation key.

### 10.2 Trap

Misalnya:

```java
execution.setVariable("externalResponse", Variables.stringValue(response, true));
```

Lalu proses mencapai user task. Setelah transaction commit, variable hilang. Jika user complete task dan flow berikutnya butuh `externalResponse`, variable tidak ada.

Rule:

> Transient variable aman hanya jika seluruh penggunaan selesai sebelum next wait state.

---

## 11. Input/Output Mapping

Input/output mapping membantu mengisolasi variable antar scope.

Contoh konseptual:

```text
Parent process variables:
  applicationId
  applicantName
  riskScore
  internalDebugPayload

Call activity input mapping:
  applicationId -> applicationId
  riskScore -> riskScore

Called process sees only:
  applicationId
  riskScore
```

Manfaat:

1. mengurangi coupling;
2. mencegah variable leak;
3. membuat subprocess reusable;
4. memisahkan parent model dan child model;
5. menghindari accidental overwrite.

### 11.1 DelegateVariableMapping

Untuk call activity, mapping bisa dibuat eksplisit:

```java
public class ApplicationReviewVariableMapping implements DelegateVariableMapping {

    @Override
    public void mapInputVariables(DelegateExecution superExecution, VariableMap subVariables) {
        subVariables.put("applicationId", superExecution.getVariable("applicationId"));
        subVariables.put("riskScore", superExecution.getVariable("riskScore"));
    }

    @Override
    public void mapOutputVariables(DelegateExecution superExecution, VariableScope subInstance) {
        superExecution.setVariable("reviewDecision", subInstance.getVariable("decision"));
        superExecution.setVariable("reviewCompletedAt", subInstance.getVariable("completedAt"));
    }
}
```

Guideline:

> Treat call activity variable mapping like API contract between two bounded contexts.

---

## 12. Variable Naming Strategy

Bad variable naming:

```text
data
payload
response
result
status
flag
user
object
application
```

Better:

```text
applicationId
caseId
currentCaseStatus
screeningResultCode
screeningCompletedAt
seniorReviewerDecision
appealAllowedUntil
slaDueAt
latestNotificationCommandId
externalSubmissionReference
```

### 12.1 Naming rules

1. Use business meaning, not technical container.
2. Avoid generic names in subprocesses.
3. Include actor/phase if needed.
4. Separate raw external response from normalized decision.
5. Avoid reusing one variable for multiple meanings across process stages.
6. Prefer immutable event-like names for audit-critical facts.

Bad:

```text
status = "SUBMITTED"
status = "CHECKED"
status = "APPROVED"
status = "EMAIL_SENT"
```

Better:

```text
applicationStatus = "UNDER_REVIEW"
notificationStatus = "EMAIL_SENT"
reviewOutcome = "APPROVED"
```

---

## 13. Variable Design for Long-Running Instances

Long-running process instance can survive:

- code deployment,
- DTO class change,
- database migration,
- package rename,
- API contract change,
- Java version upgrade,
- Camunda version upgrade.

Therefore variable must be version-tolerant.

### 13.1 Snapshot versioning

```json
{
  "schemaVersion": 3,
  "applicationId": "APP-001",
  "risk": {
    "score": 82,
    "level": "HIGH"
  }
}
```

Java side:

```java
switch (snapshot.schemaVersion()) {
    case 1 -> migrateV1(snapshot);
    case 2 -> migrateV2(snapshot);
    case 3 -> handleV3(snapshot);
    default -> throw new UnsupportedVariableVersionException(snapshot.schemaVersion());
}
```

### 13.2 Additive compatibility

Prefer additive changes:

```json
// v1
{
  "applicationId": "APP-001",
  "riskScore": 82
}

// v2
{
  "applicationId": "APP-001",
  "riskScore": 82,
  "riskLevel": "HIGH"
}
```

Avoid destructive changes:

```json
// v1
{ "riskScore": 82 }

// v2
{ "risk": { "score": 82 } }
```

If destructive change is unavoidable, create migration handler.

### 13.3 Store facts, not implementation objects

Bad:

```java
execution.setVariable("application", applicationEntity);
```

Better:

```java
execution.setVariable("applicationId", application.getId());
execution.setVariable("applicationStatus", application.getStatus().name());
execution.setVariable("submissionReceivedAt", application.getSubmittedAt());
```

If snapshot required:

```json
{
  "schemaVersion": 1,
  "applicationId": "APP-001",
  "submittedAt": "2026-06-20T10:15:30+07:00",
  "applicantType": "COMPANY",
  "declaredActivities": ["REAL_ESTATE", "BROKERAGE"]
}
```

---

## 14. Variable and Gateway Design

Gateways often read variables:

```text
${riskScore >= 80}
${decision == 'APPROVE'}
${hasOutstandingPayment}
```

A gateway expression is only as good as the variable contract.

### 14.1 Bad gateway

```text
${application.status == 'APPROVED'}
```

Problems:

- object deserialization required;
- `application` may be Java object, JSON, or Spin node depending producer;
- status field may change;
- null handling unclear.

### 14.2 Better gateway

```text
${finalDecision == 'APPROVED'}
```

Where `finalDecision` is normalized earlier by a delegate/DMN.

### 14.3 Gateway variable checklist

Before using variable in gateway:

1. Is it always set before gateway?
2. Is it typed predictably?
3. Is null handled?
4. Is it local or global?
5. Is it stable across process versions?
6. Is expression simple enough to understand by operator/BA?
7. Should this be a DMN decision instead?

---

## 15. Variable and History Cost

History can record:

- variable instance,
- variable update details,
- serialized values,
- previous values depending configuration/history level.

This can explode storage if:

- large JSON variable updated many times,
- file variable stored as process variable,
- object payload updated at each service task,
- same variable overwritten repeatedly,
- history level `full` is used without cleanup.

Example bad pattern:

```java
execution.setVariable("applicationPayload", fullPayloadAfterStep1);
execution.setVariable("applicationPayload", fullPayloadAfterStep2);
execution.setVariable("applicationPayload", fullPayloadAfterStep3);
execution.setVariable("applicationPayload", fullPayloadAfterStep4);
```

Better:

```java
execution.setVariable("applicationId", applicationId);
execution.setVariable("screeningResultCode", resultCode);
execution.setVariable("screeningCompletedAt", completedAt);
execution.setVariable("latestPayloadStorageKey", storageKey);
```

If full snapshots are audit-required, store them deliberately in audit/document storage with retention policy, not accidentally through variable update history.

---

## 16. Variable Querying and Performance

Camunda APIs allow queries by variable:

```java
runtimeService.createProcessInstanceQuery()
    .variableValueEquals("applicationId", "APP-001")
    .list();
```

Useful, but dangerous at scale.

### 16.1 Queryable variable criteria

Good candidates:

- `businessKey`,
- `applicationId`,
- `caseId`,
- `tenantId`,
- `processCategory`,
- small enum status.

Bad candidates:

- large JSON payload,
- free text comment,
- serialized object,
- frequently changing variable,
- unindexed high-cardinality variable used for dashboards.

### 16.2 Do not use Camunda runtime DB as search engine

Bad architecture:

```text
Frontend dashboard -> Camunda variable queries over thousands/millions of instances
```

Better:

```text
Camunda engine -> history/audit projection -> reporting/read model -> dashboard
```

Camunda is workflow engine, not analytics/search database.

---

## 17. Variable Security

Never persist:

- password,
- bearer token,
- refresh token,
- private key,
- API secret,
- raw authentication assertion,
- sensitive PII unless justified and protected,
- raw document content if external storage with access control is better.

### 17.1 Token anti-pattern

Bad:

```java
execution.setVariable("accessToken", token);
```

Better:

```java
TypedValue transientToken = Variables.stringValue(token, true);
execution.setVariable("accessToken", transientToken);
```

Even better:

```text
Do not put token in process variable.
Delegate obtains token from secure service at execution time.
```

### 17.2 PII minimization

For regulatory workflow, you may need auditability. But auditability does not mean copying all PII into process variables.

Better pattern:

```text
personId = "P-001"
applicationId = "APP-001"
piiSnapshotStorageKey = "secure-doc-store/..."
piiSnapshotHash = "sha256:..."
```

Access to PII goes through domain service/document service with authorization and audit.

---

## 18. Variable and Idempotency

Variables are often involved in idempotency design.

Example:

```text
notificationCommandId = "NOTIF-CASE-001-APPROVED-v1"
notificationSent = true
notificationSentAt = "2026-06-20T10:00:00+07:00"
```

But be careful: setting `notificationSent=true` after sending email in same transaction can rollback if later engine operation fails. Email already went out, variable rollback loses the fact.

Better:

```text
Camunda -> create outbox command in same transaction/domain DB
Outbox worker -> send email idempotently
Outbox table -> stores sent state
Camunda variable -> stores command id/reference, not source of truth for delivery
```

Variable can reference idempotency keys, but should not be the only delivery ledger if external side effects matter.

---

## 19. Variable Design Patterns

### 19.1 Reference variable pattern

Store reference id, not full object.

```text
applicationId = "APP-001"
caseId = "CASE-001"
latestAssessmentId = "ASM-001"
```

Use domain service/database for full data.

### 19.2 Snapshot variable pattern

Store small immutable snapshot for process decision/audit.

```json
{
  "schemaVersion": 1,
  "applicationId": "APP-001",
  "riskScore": 82,
  "riskLevel": "HIGH",
  "evaluatedAt": "2026-06-20T10:00:00+07:00",
  "ruleVersion": "screening-rules-2026.06"
}
```

### 19.3 Decision fact pattern

Normalize complex decision to simple variable.

```text
screeningOutcome = "REQUIRE_MANUAL_REVIEW"
```

### 19.4 Output contract pattern

Subprocess output only writes specific variables:

```text
reviewDecision
reviewReasonCode
reviewCompletedBy
reviewCompletedAt
```

### 19.5 Variable envelope pattern

For JSON object:

```json
{
  "schemaVersion": 2,
  "source": "screening-service",
  "createdAt": "2026-06-20T10:00:00+07:00",
  "correlationId": "corr-123",
  "data": {
    "score": 82,
    "level": "HIGH"
  }
}
```

---

## 20. Variable Anti-Patterns

### 20.1 God variable

```text
processData = { everything }
```

Symptoms:

- every delegate reads/writes same object;
- conflicts on updates;
- unclear ownership;
- hard to audit;
- hard to migrate;
- history grows rapidly.

### 20.2 Entity variable

```java
execution.setVariable("application", applicationJpaEntity);
```

Problems:

- lazy-loading proxy;
- serialization failure;
- stale state;
- package/class coupling;
- huge graph accidentally serialized.

### 20.3 Raw external response variable

```java
execution.setVariable("response", httpResponseBody);
```

Problems:

- too large;
- unstable schema;
- secrets/PII may leak;
- no normalized decision.

### 20.4 Variable overwrite confusion

```java
execution.setVariable("status", "A");
execution.setVariable("status", "B");
execution.setVariable("status", "C");
```

History may record details, but runtime only has latest. Business meaning becomes ambiguous.

### 20.5 Using variables as inter-service database

```text
Service A writes huge variable.
Service B reads huge variable.
Service C patches huge variable.
```

This makes Camunda the accidental integration database.

---

## 21. Java 8 to 25 Considerations

### 21.1 Java language evolution vs Camunda variable compatibility

Camunda 7 was born in Java 6/7/8 era and lives across many enterprise Java generations. Java 8 to Java 25 introduces records, sealed classes, pattern matching, newer date/time API usage, and stronger module/classpath concerns.

But process variable compatibility is not about what Java can serialize today. It is about whether a value can be read years later.

### 21.2 Records as variable DTOs

Java records are tempting:

```java
public record ApplicationSnapshot(
    String applicationId,
    String status,
    int riskScore
) implements Serializable {}
```

Records are good as immutable DTOs, but do not automatically solve:

- classpath coupling,
- binary Java serialization risk,
- schema evolution,
- REST boundary,
- long-running instance compatibility.

If using records, prefer JSON serialization and explicit versioning.

### 21.3 `java.time` vs `java.util.Date`

Camunda variable `date` type is historically `java.util.Date`. For domain code, Java 8+ should use `Instant`, `OffsetDateTime`, or `ZonedDateTime`, but variable boundary must be explicit.

Recommended:

```text
slaDueAt = "2026-06-20T17:00:00+07:00"
slaDueAtEpochMillis = 178... // optional, if query/sort needed elsewhere
```

Avoid timezone-ambiguous `Date` for business meaning unless you standardize conversion.

### 21.4 Modules/classloading

Java 9+ modules and app server classloading can make object variable deserialization more fragile. Avoid relying on internal DTO classes in serialized variables across deployments.

---

## 22. Production Variable Design Checklist

For every variable, ask:

1. What business question does this variable answer?
2. Who owns this variable?
3. Which scope should own it?
4. Is it local or global?
5. Is it required after a wait state?
6. Is it audit-relevant?
7. Is it safe to persist?
8. Is it small enough?
9. Is it queryable? Should it be?
10. Is it stable across process version changes?
11. Can old process instances still read it after code upgrade?
12. Does REST client need to read it?
13. Does it contain PII/secrets?
14. Does it duplicate domain database truth?
15. What happens if variable update rolls back?
16. What happens if two branches update it concurrently?
17. Will history cleanup remove it when expected?
18. Is there a migration path to Camunda 8 or another workflow engine?

---

## 23. Diagnostic Playbook

### 23.1 Variable not found

Check:

1. Was it set as local variable in another scope?
2. Did it disappear because it was transient?
3. Did rollback undo the variable set?
4. Was it set after an async boundary that failed?
5. Are you reading from task scope or execution scope?
6. Was the process instance migrated and variable mapping missed?

### 23.2 Wrong value read

Check:

1. Same name exists in child and parent scope?
2. Parallel branch shadowing?
3. Old value from last committed wait state after rollback?
4. Variable overwritten by listener/input-output mapping?
5. Same variable used for multiple business meanings?

### 23.3 Serialization exception

Check:

1. Class available in classpath?
2. serialVersionUID mismatch?
3. Package/class renamed?
4. Java serialization disabled?
5. JSON/XML serializer configured?
6. REST client requested deserialization accidentally?
7. Object contains non-serializable nested field?

### 23.4 Database exception on variable set

Check:

1. String length too long?
2. Oracle 2000-character limit hit?
3. Charset/multibyte issue?
4. BLOB/CLOB storage pressure?
5. DB column limitation?
6. History update creating larger storage than expected?

### 23.5 Storage growth

Check:

1. Large object variables?
2. Repeated updates with history full?
3. File variables?
4. Exception stack traces in byte array?
5. Deployment artifacts?
6. History cleanup TTL missing?
7. `ACT_GE_BYTEARRAY` growth?

---

## 24. Recommended Enterprise Variable Policy

A mature Camunda 7 platform should define a variable policy:

### 24.1 Allowed by default

- `String` enum/status/code/reference id;
- `Long`/`Integer` for simple numeric facts;
- `Boolean` for stable flags;
- date/time string in ISO-8601 with offset;
- small JSON snapshot with `schemaVersion`;
- storage key/hash/reference id;
- task-local variables for task-only state.

### 24.2 Requires review

- object variables;
- file variables;
- bytes variables;
- large JSON/XML;
- variables containing PII;
- variables updated many times;
- variables used in dashboard filtering;
- variables read by multiple applications.

### 24.3 Prohibited or strongly discouraged

- JPA entities;
- Hibernate proxies;
- Java serialized object for long-running instance;
- passwords/tokens/secrets;
- full external API raw response;
- documents/binaries as process variables;
- generic `payload` god variable;
- mutable map passed across many delegates.

---

## 25. Example: Regulatory Case Management Variable Model

Bad model:

```text
application = Java ApplicationEntity
case = Java CaseEntity
payload = huge JSON
status = overloaded string
user = UserEntity
file = PDF bytes
```

Production-grade model:

```text
applicationId = "APP-2026-0001"
caseId = "CASE-2026-0001"
businessKey = "APP-2026-0001"
tenantId = "CEA"
caseType = "ENFORCEMENT_REVIEW"
currentStage = "SCREENING"
applicationStatus = "UNDER_REVIEW"
riskScore = 82
riskLevel = "HIGH"
riskAssessmentVersion = "risk-v3.2"
screeningOutcome = "MANUAL_REVIEW_REQUIRED"
slaDueAt = "2026-06-23T17:00:00+08:00"
assignedTeam = "COMPLIANCE_SENIOR_REVIEW"
latestEvidenceBundleId = "EVB-2026-001"
latestEvidenceBundleHash = "sha256:..."
notificationCommandId = "NOTIF-CASE-2026-0001-SCREENING-v1"
```

JSON snapshot:

```json
{
  "schemaVersion": 1,
  "caseId": "CASE-2026-0001",
  "applicationId": "APP-2026-0001",
  "screening": {
    "score": 82,
    "level": "HIGH",
    "outcome": "MANUAL_REVIEW_REQUIRED",
    "ruleVersion": "risk-v3.2",
    "evaluatedAt": "2026-06-20T10:00:00+08:00"
  }
}
```

Design rationale:

- process has enough data for routing;
- domain system remains source of truth;
- audit facts are explicit;
- payload is readable;
- long-running compatibility is easier;
- migration is possible;
- storage growth is controlled.

---

## 26. Mini Lab: Safe Variable Access Helper

A small utility can enforce variable expectations.

```java
import org.camunda.bpm.engine.delegate.DelegateExecution;

import java.util.Objects;

public final class ProcessVariables {

    private ProcessVariables() {
    }

    public static String requiredString(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        if (value == null) {
            throw new IllegalStateException("Required process variable missing: " + name);
        }
        if (!(value instanceof String)) {
            throw new IllegalStateException(
                "Process variable " + name + " must be String but was " + value.getClass().getName()
            );
        }
        String text = (String) value;
        if (text.isBlank()) {
            throw new IllegalStateException("Required process variable blank: " + name);
        }
        return text;
    }

    public static Integer requiredInteger(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        if (value == null) {
            throw new IllegalStateException("Required process variable missing: " + name);
        }
        if (!(value instanceof Integer)) {
            throw new IllegalStateException(
                "Process variable " + name + " must be Integer but was " + value.getClass().getName()
            );
        }
        return (Integer) value;
    }

    public static void setString(DelegateExecution execution, String name, String value) {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(value, "value");
        if (value.length() > 1000) {
            throw new IllegalArgumentException("Variable " + name + " is too long for policy: " + value.length());
        }
        execution.setVariable(name, value);
    }
}
```

For Java 8 compatibility, replace `isBlank()` with `trim().isEmpty()`.

This helper is intentionally boring. Its purpose is not abstraction elegance. Its purpose is preventing silent variable contract drift.

---

## 27. Mini Lab: JSON Snapshot Variable with Explicit Schema Version

```java
public final class ScreeningSnapshot {
    private final int schemaVersion;
    private final String applicationId;
    private final int riskScore;
    private final String riskLevel;
    private final String outcome;
    private final String evaluatedAt;
    private final String ruleVersion;

    public ScreeningSnapshot(
        int schemaVersion,
        String applicationId,
        int riskScore,
        String riskLevel,
        String outcome,
        String evaluatedAt,
        String ruleVersion
    ) {
        this.schemaVersion = schemaVersion;
        this.applicationId = applicationId;
        this.riskScore = riskScore;
        this.riskLevel = riskLevel;
        this.outcome = outcome;
        this.evaluatedAt = evaluatedAt;
        this.ruleVersion = ruleVersion;
    }

    public int getSchemaVersion() { return schemaVersion; }
    public String getApplicationId() { return applicationId; }
    public int getRiskScore() { return riskScore; }
    public String getRiskLevel() { return riskLevel; }
    public String getOutcome() { return outcome; }
    public String getEvaluatedAt() { return evaluatedAt; }
    public String getRuleVersion() { return ruleVersion; }
}
```

Setting variable:

```java
ObjectValue value = Variables
    .objectValue(snapshot)
    .serializationDataFormat(Variables.SerializationDataFormats.JSON)
    .create();

execution.setVariable("screeningSnapshot", value);
execution.setVariable("screeningOutcome", snapshot.getOutcome());
execution.setVariable("riskScore", snapshot.getRiskScore());
execution.setVariable("riskLevel", snapshot.getRiskLevel());
```

Notice the dual strategy:

- full snapshot for audit/context;
- extracted simple variables for routing/querying.

---

## 28. Top 1% Mental Model

A beginner asks:

> What variable do I need to pass to the next task?

A senior asks:

> Which fact must become part of the durable process state, at which scope, in which serialized form, with which ownership, retention, compatibility, and recovery semantics?

A top 1% engineer asks even further:

> If this process instance is still alive two years from now, after five deployments, three schema changes, one Java upgrade, one Camunda patch, and one migration initiative, will this variable still be readable, meaningful, safe, and defensible?

That is the correct bar.

---

## 29. Key Takeaways

1. Camunda variables are durable execution state, not ordinary method parameters.
2. Variable scope follows execution tree; local/global mistakes cause subtle bugs.
3. Java Object API is convenient, but Typed Value API gives control over serialization and transient behavior.
4. Java serialization is dangerous for long-running and platform-level processes.
5. Prefer small primitive variables and versioned JSON snapshots.
6. Store reference ids, not full domain aggregates.
7. Do not store secrets, tokens, huge documents, or JPA entities as process variables.
8. Variable design affects database size, history size, query cost, migration, and security.
9. REST clients should generally use serialized values, especially with `deserializeValues=false`.
10. A mature Camunda platform needs a variable policy.

---

## 30. Referensi

- Camunda 7.24 Documentation — Process Variables: https://docs.camunda.org/manual/7.24/user-guide/process-engine/variables/
- Camunda 7.24 Documentation — Data Formats / Spin: https://docs.camunda.org/manual/7.24/user-guide/data-formats/
- Camunda 7.24 Documentation — Variables in the REST API: https://docs.camunda.org/manual/7.24/reference/rest/overview/variables/
- Camunda 7.24 Documentation — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7.24 Documentation — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/

---

## 31. Status Seri

Part ini selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-009.md` — Expression Language, Delegation Code, Bean Resolution, dan Runtime Binding.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-007.md">⬅️ Part 007 — Persistence, Flush Ordering, Optimistic Locking, dan Database Isolation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-009.md">Part 009 — Expression Language, Delegation Code, Bean Resolution, dan Runtime Binding ➡️</a>
</div>
