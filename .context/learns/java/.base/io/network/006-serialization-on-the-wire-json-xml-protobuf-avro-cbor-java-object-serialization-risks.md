# Part 6 — Serialization on the Wire: JSON, XML, Protobuf, Avro, CBOR, and Java Object Serialization Risks

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `006-serialization-on-the-wire-json-xml-protobuf-avro-cbor-java-object-serialization-risks.md`  
> Target: Java 8–25  
> Level: Advanced / production network engineering

---

## 0. Posisi Materi Ini dalam Seri

Pada part sebelumnya, kita membahas bahwa TCP hanya menyediakan **ordered byte stream**. TCP tidak tahu batas pesan, tidak tahu apakah byte yang dikirim adalah JSON, Protobuf, file, event, command, response, atau heartbeat. Karena itu, aplikasi harus membangun lapisan di atas TCP:

```text
TCP byte stream
  -> framing
  -> serialization format
  -> application protocol
  -> domain contract
```

Part 5 membahas **framing**: bagaimana byte stream dipecah menjadi message. Part 6 membahas **serialization**: bagaimana object, command, event, response, error, atau state diubah menjadi representasi wire yang bisa dikirim, disimpan, dibaca ulang, dievolusikan, diamankan, dan diobservasi.

Di level junior, serialization sering dilihat sebagai:

```text
object -> JSON string
JSON string -> object
```

Di level senior/top-tier engineer, serialization dilihat sebagai:

```text
meaning
  -> schema
  -> compatibility rule
  -> encoding
  -> parser behavior
  -> resource cost
  -> security boundary
  -> evolution policy
  -> observability surface
  -> operational failure mode
```

Serialization bukan detail teknis kecil. Serialization adalah **kontrak antar sistem**.

---

## 1. Learning Outcomes

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan perbedaan **object model**, **wire model**, **schema**, dan **domain model**.
2. Memilih format serialization berdasarkan constraint: latency, throughput, compatibility, debuggability, governance, consumer diversity, streaming, storage, dan security.
3. Mendesain payload yang evolvable: aman untuk client lama, server lama, rollback, canary, blue/green, async consumer, dan long-lived data.
4. Menghindari trap umum JSON: numeric precision, missing vs null, timezone, enum evolution, polymorphism, dan large payload memory blow-up.
5. Memahami kapan XML masih relevan, dan risiko parser XML seperti XXE, entity expansion, namespace complexity, dan canonicalization.
6. Memahami Protobuf sebagai schema-first binary contract, termasuk field number, unknown field, reserved field, default value, wrapper, `oneof`, repeated field, map, dan schema evolution.
7. Memahami Avro sebagai format yang kuat untuk data pipeline/event/log dengan writer schema, reader schema, dan schema registry style evolution.
8. Memahami CBOR sebagai binary JSON-like representation untuk payload compact/extensible.
9. Menjelaskan mengapa Java native object serialization tidak layak untuk external boundary, terutama karena coupling, fragility, dan deserialization risk.
10. Membuat decision matrix untuk memilih JSON/XML/Protobuf/Avro/CBOR/Java serialization.
11. Mendesain parser/serializer boundary yang aman: size limit, depth limit, timeout, strict mode, unknown field policy, content-type validation, schema validation, dan safe logging.
12. Menghubungkan serialization dengan HTTP/gRPC: content negotiation, `Content-Type`, `Accept`, compression, deadline, backpressure, and error model.

---

## 2. Mental Model Utama: Serialization adalah Boundary Contract

Saat Java object dikirim ke service lain, jangan berpikir:

```text
Kirim object Java ke service B
```

Pikirkan:

```text
Service A memiliki internal domain model
Service A memproyeksikan sebagian makna ke wire contract
Wire contract dikodekan menjadi bytes
Bytes melewati transport/proxy/logging/storage
Service B membaca bytes berdasarkan kontrak yang mungkin versinya berbeda
Service B memetakan wire contract ke internal modelnya sendiri
```

Artinya, ada beberapa model yang berbeda:

| Model | Contoh | Karakter |
|---|---|---|
| Domain model | `Case`, `Application`, `EnforcementAction` | Kaya invariant, behavior, lifecycle |
| DTO/API model | `CreateCaseRequest`, `CaseResponse` | Stabil, consumer-facing |
| Wire model | JSON object, Protobuf message, Avro record | Format-aware, compatibility-aware |
| Storage model | DB row, event log, object storage payload | Long-lived, migration-aware |
| UI model | View model | Presentation-oriented |

Kesalahan umum: memakai satu class untuk semuanya.

```java
@Entity
public class CaseEntity {
    @Id
    private Long id;
    private String status;
    private String internalRemark;
    private String officerId;
    private Instant createdAt;
}
```

Lalu class ini dipakai sebagai:

```text
JPA entity
REST response
Kafka event
audit payload
cache payload
inter-service DTO
```

Ini buruk karena setiap perubahan internal menjadi breaking change external. Top-tier engineer memisahkan:

```text
Internal domain model != wire contract != persistence model
```

---

## 3. Serialization Pipeline

Satu outbound response atau request biasanya melewati pipeline berikut:

```text
Domain object
  -> mapping to DTO
  -> validation of outbound contract
  -> serialization to bytes
  -> optional compression
  -> optional encryption/signature/MAC
  -> framing / HTTP body / gRPC DATA frame
  -> transport
```

Inbound pipeline:

```text
transport bytes
  -> frame/body extraction
  -> optional decompression
  -> optional decrypt/verify
  -> parse bytes into wire object
  -> validate schema/semantic constraints
  -> map to command/domain input
  -> enforce business invariant
```

Important distinction:

```text
Parsing is not validation.
```

A JSON parser may successfully parse:

```json
{
  "amount": -999999999999999999999,
  "status": "APPROVED_BUT_NOT_REALLY",
  "createdAt": "2026-99-99T25:99:99Z"
}
```

But the payload is semantically invalid.

Similarly, Protobuf may successfully parse a message with default value, missing field, or unknown field. That does not mean it satisfies domain requirements.

---

## 4. Core Evaluation Criteria for Wire Format

Saat memilih serialization format, jangan mulai dari preferensi library. Mulai dari constraints.

### 4.1 Human readability

JSON/XML mudah dibaca di log, curl, browser devtools, Postman, API gateway, dan ticket incident.

Binary format seperti Protobuf/Avro/CBOR lebih sulit dibaca tanpa schema/tooling.

Trade-off:

```text
Readable format -> easier debugging, larger payload, more parse cost
Binary format   -> smaller/faster, needs schema/tooling, harder manual diagnosis
```

### 4.2 Schema strictness

JSON secara native tidak memaksa schema. Bisa ditambah JSON Schema, OpenAPI, validation, atau typed DTO.

Protobuf/Avro schema-first secara desain.

### 4.3 Compatibility model

Pertanyaan penting:

```text
Can old consumer read new producer payload?
Can new consumer read old producer payload?
Can producer and consumer be deployed independently?
Can rollback happen safely?
Can unknown fields survive pass-through?
Can stored historical data be read after schema changes?
```

### 4.4 Payload size

Binary format biasanya lebih compact. Namun perbandingan harus realistis:

```text
JSON + gzip vs Protobuf uncompressed
JSON + Brotli vs CBOR
Protobuf + gzip for repeated textual data
```

Ukuran payload bukan hanya bandwidth. Ukuran payload memengaruhi:

```text
network latency
CPU compression/decompression
memory allocation
GC pressure
proxy buffer
load balancer max body size
server request queue time
client timeout
```

### 4.5 Parse cost and allocation

Serialization bukan gratis. JSON parsing dengan object tree besar dapat menyebabkan allocation besar.

Parsing style:

| Style | Contoh | Memory profile |
|---|---|---|
| Tree model | Jackson `JsonNode`, DOM XML | Bisa besar |
| Data binding | Jackson POJO, JAXB | Medium, object allocation |
| Streaming parser | Jackson streaming, StAX | Lebih hemat, lebih kompleks |
| Binary generated parser | Protobuf | Umumnya lebih compact/cepat |

### 4.6 Tooling ecosystem

Top-tier engineer juga mempertimbangkan:

```text
OpenAPI/Swagger support
schema registry
linting
breaking-change detection
IDE generation
multi-language support
test fixture support
observability support
security scanning
mocking support
```

### 4.7 Security posture

Serialization format menentukan attack surface:

```text
JSON: large object, deep nesting, numeric weirdness, polymorphic deserialization risk
XML: XXE, entity expansion, namespace confusion, canonicalization trap
Protobuf: large repeated field, unknown field retention issues, schema mismatch
Avro: schema registry misuse, incompatible evolution, logical type mismatch
Java serialization: gadget chain, RCE, classpath coupling
```

### 4.8 Long-lived data vs transient API

REST response biasanya transient. Event log, audit trail, message queue, or object storage payload bisa hidup bertahun-tahun.

Long-lived payload membutuhkan compatibility discipline lebih tinggi.

---

## 5. JSON on the Wire

JSON adalah default lingua franca untuk HTTP API. Keunggulannya:

```text
human-readable
language-neutral
browser-native
excellent tooling
works with REST/OpenAPI
simple enough for integration teams
```

Namun JSON juga memiliki banyak trap.

---

## 6. JSON Trap 1: Missing vs Null vs Empty

Perhatikan payload:

```json
{}
```

```json
{
  "middleName": null
}
```

```json
{
  "middleName": ""
}
```

Secara domain, tiga payload ini bisa berarti hal berbeda:

| Shape | Meaning possible |
|---|---|
| field missing | client tidak mengirim, unknown, no change |
| field null | eksplisit kosongkan |
| empty string | nilai ada tapi kosong / invalid / legacy |

Untuk create request, missing bisa berarti default.

Untuk PATCH request, missing biasanya berarti no change, sedangkan null berarti clear value.

Contoh buruk:

```java
public record UpdateProfileRequest(
    String displayName,
    String phoneNumber
) {}
```

Tidak bisa membedakan:

```text
phoneNumber missing
phoneNumber null
phoneNumber empty string
```

Solusi tergantung design:

1. Gunakan endpoint PUT untuk full replacement.
2. Gunakan PATCH dengan explicit patch operation.
3. Gunakan wrapper field presence.
4. Gunakan JSON Merge Patch atau JSON Patch dengan hati-hati.
5. Gunakan DTO custom untuk update semantics.

Contoh explicit patch operation:

```json
{
  "operations": [
    { "op": "replace", "path": "/phoneNumber", "value": "+628123" },
    { "op": "remove", "path": "/middleName" }
  ]
}
```

Mental model:

```text
wire shape must preserve domain intention
```

---

## 7. JSON Trap 2: Number Precision

JSON number tidak membedakan `int`, `long`, `BigInteger`, `BigDecimal`, `double`. Parser/client bisa berbeda.

Contoh berbahaya:

```json
{
  "caseId": 9223372036854775807
}
```

Java `long` bisa menampung. JavaScript `Number` tidak bisa merepresentasikan semua integer 64-bit dengan presisi aman.

Untuk ID besar, sering lebih aman:

```json
{
  "caseId": "9223372036854775807"
}
```

Untuk uang:

```json
{
  "amount": "1234567890.55",
  "currency": "IDR"
}
```

Atau minor unit:

```json
{
  "amountMinor": 123456789055,
  "currency": "IDR",
  "scale": 2
}
```

Di Java, hindari `double` untuk uang:

```java
public record PaymentRequest(
    BigDecimal amount,
    String currency
) {}
```

Namun `BigDecimal` juga perlu aturan:

```text
scale
rounding mode
max precision
string vs number encoding
canonical representation
```

---

## 8. JSON Trap 3: Time, Timezone, and Calendar Semantics

Waktu adalah sumber bug besar.

Payload buruk:

```json
{
  "submittedAt": "18/06/2026 09:00"
}
```

Tidak jelas:

```text
timezone apa?
format locale apa?
ini instant atau local date-time?
```

Gunakan tipe sesuai makna:

| Meaning | Java type | Wire example |
|---|---|---|
| Moment absolut | `Instant` | `2026-06-18T02:00:00Z` |
| Local date | `LocalDate` | `2026-06-18` |
| Local time | `LocalTime` | `09:00:00` |
| Local date-time tanpa zone | `LocalDateTime` | `2026-06-18T09:00:00` |
| Zoned business time | `ZonedDateTime` | `2026-06-18T09:00:00+07:00[Asia/Jakarta]` |
| Offset timestamp | `OffsetDateTime` | `2026-06-18T09:00:00+07:00` |

Rule of thumb:

```text
For event occurrence/audit/log: Instant.
For user-facing schedule: local date/time + zone.
For regulatory deadline: store rule semantics, not only timestamp.
```

Contoh deadline regulatory:

```json
{
  "deadlineDate": "2026-06-30",
  "jurisdiction": "SG",
  "calendarRule": "BUSINESS_DAY_END",
  "timezone": "Asia/Singapore"
}
```

Lebih defensible daripada hanya:

```json
{
  "deadlineAt": "2026-06-30T15:59:59Z"
}
```

karena business meaning tidak hilang.

---

## 9. JSON Trap 4: Enum Evolution

Enum di wire contract sangat berisiko.

```json
{
  "status": "APPROVED"
}
```

Masalah terjadi saat producer baru mengirim:

```json
{
  "status": "APPROVED_WITH_CONDITION"
}
```

Consumer lama bisa:

```text
fail parsing
map to null
throw unknown enum exception
silently ignore
route to default branch wrongly
```

Strategi:

1. Treat enum as open set at boundary.
2. Tambahkan `UNKNOWN` internal fallback.
3. Jangan gunakan default branch yang memberi behavior berbahaya.
4. Dokumentasikan unknown value handling.
5. Untuk state machine kritikal, expose stable code + display label.

Contoh:

```json
{
  "statusCode": "APPROVED_WITH_CONDITION",
  "statusLabel": "Approved with Condition"
}
```

Java boundary model:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    UNKNOWN;

    public static CaseStatus fromWire(String value) {
        try {
            return CaseStatus.valueOf(value);
        } catch (Exception ex) {
            return UNKNOWN;
        }
    }
}
```

Namun untuk internal domain, jangan biarkan `UNKNOWN` masuk ke state machine tanpa decision.

```text
Boundary may accept UNKNOWN.
Domain must decide what UNKNOWN means.
```

---

## 10. JSON Trap 5: Polymorphic Deserialization

Polymorphic deserialization bisa berbahaya, terutama bila type information dari input mengontrol class yang dibuat.

Payload seperti ini harus dicurigai:

```json
{
  "@class": "com.example.SomeClass",
  "value": "..."
}
```

Risiko:

```text
attacker influences class loading
unexpected subtype instantiated
gadget chain if unsafe configuration
bypass validation
```

Pattern aman:

```json
{
  "type": "EMAIL_NOTIFICATION",
  "payload": {
    "subject": "...",
    "body": "..."
  }
}
```

Lalu map `type` ke whitelist subtype yang eksplisit.

```java
sealed interface NotificationCommand permits EmailCommand, SmsCommand {}

public record EmailCommand(String subject, String body) implements NotificationCommand {}
public record SmsCommand(String phoneNumber, String message) implements NotificationCommand {}
```

Boundary parser harus menggunakan registry:

```java
switch (type) {
    case "EMAIL_NOTIFICATION" -> parseEmail(payload);
    case "SMS_NOTIFICATION" -> parseSms(payload);
    default -> rejectUnknownType(type);
}
```

---

## 11. JSON Trap 6: Tree Parsing and Memory Explosion

Parsing JSON besar ke object tree dapat membuat memory usage jauh lebih besar dari payload asli.

Payload 20 MB bisa menjadi ratusan MB object graph tergantung struktur.

Anti-pattern:

```java
JsonNode root = objectMapper.readTree(inputStream);
process(root);
```

Untuk large payload, gunakan streaming parser:

```java
try (JsonParser parser = objectMapper.getFactory().createParser(inputStream)) {
    while (!parser.isClosed()) {
        JsonToken token = parser.nextToken();
        // process incrementally
    }
}
```

Rule:

```text
Do not parse unbounded external payload into memory.
```

Boundary harus punya:

```text
max body size
max nesting depth
max array length
max string length
max number precision
timeout/deadline
streaming mode for large payload
```

---

## 12. JSON Contract Design Rules

Untuk JSON API production-grade:

1. Jangan expose internal entity.
2. Gunakan explicit request/response DTO.
3. Tetapkan required/optional field dengan jelas.
4. Bedakan missing/null/empty semantics.
5. Pakai ISO-8601 untuk timestamp/date.
6. Gunakan string untuk ID besar dan decimal penting jika consumer JS terlibat.
7. Treat enum sebagai open set di boundary.
8. Jangan aktifkan unsafe polymorphic deserialization.
9. Limit payload size/depth.
10. Validasi semantic setelah parsing.
11. Dokumentasikan compatibility policy.
12. Jangan log payload penuh yang mengandung PII/secret.
13. Gunakan content type eksplisit: `application/json` atau variant seperti `application/problem+json`.
14. Gunakan schema/OpenAPI linting untuk governance.

---

## 13. XML on the Wire

XML sering dianggap legacy, tetapi masih banyak dipakai di enterprise, SOAP, document exchange, regulatory integration, identity/security protocol, dan sistem pemerintahan/keuangan.

Kekuatan XML:

```text
namespace support
schema validation with XSD
mixed content/document model
canonicalization/signature ecosystem
SOAP/WS-* ecosystem
mature enterprise tooling
```

Kelemahan:

```text
verbose
complex namespace handling
parser attack surface
canonicalization complexity
harder manual mapping
schema evolution can be painful
```

---

## 14. XML Parser Risks

### 14.1 XXE

XML External Entity dapat membuat parser membaca file lokal atau memanggil network endpoint jika tidak dikonfigurasi aman.

Contoh malicious XML:

```xml
<?xml version="1.0"?>
<!DOCTYPE data [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<data>&xxe;</data>
```

Mitigation:

```text
disable external entities
disable DTD if not needed
disable external schema access
use secure processing mode
limit size/depth/entity expansion
```

### 14.2 Billion Laughs / Entity Expansion

XML entity dapat diekspansi secara eksponensial dan menghabiskan memory/CPU.

### 14.3 DOM vs SAX/StAX

DOM membaca seluruh dokumen ke memory.

SAX/StAX streaming lebih aman untuk dokumen besar, tetapi lebih kompleks.

```text
DOM: simple but memory-heavy
SAX: push streaming, event callback
StAX: pull streaming, often easier to control
```

### 14.4 Namespace Confusion

XML namespace membuat field matching tidak sesederhana nama tag.

```xml
<a:Case xmlns:a="urn:agency:v1">
  <a:Status>APPROVED</a:Status>
</a:Case>
```

`Status` tanpa namespace bukan field yang sama.

### 14.5 Canonicalization and Signature

Untuk signed XML, perubahan whitespace/namespace/canonical form dapat memengaruhi signature. Jangan “normalize” signed XML sembarangan.

---

## 15. XML Usage Rules

Gunakan XML saat:

```text
partner/regulator membutuhkan XML/SOAP
schema XSD adalah kontrak formal
payload adalah dokumen, bukan hanya data object
signature/canonicalization ecosystem diperlukan
legacy enterprise integration wajib
```

Hindari XML untuk internal high-throughput microservice bila tidak ada constraint khusus.

Boundary XML harus punya:

```text
secure parser config
XSD validation if relevant
namespace-aware parsing
payload size limit
streaming parser for large doc
signature verification step if signed
clear canonicalization policy
```

---

## 16. Protobuf on the Wire

Protocol Buffers adalah schema-first binary serialization. Ia cocok untuk:

```text
gRPC
high-throughput service-to-service communication
multi-language generated client/server
compact payload
strict-ish contract
evolvable field-based schema
```

Contoh `.proto`:

```proto
syntax = "proto3";

package case.v1;

message GetCaseRequest {
  string case_id = 1;
}

message CaseResponse {
  string case_id = 1;
  string status = 2;
  int64 created_at_epoch_millis = 3;
}

service CaseService {
  rpc GetCase(GetCaseRequest) returns (CaseResponse);
}
```

Generated Java code memberi typed API.

Mental model:

```text
field name is for humans/code generation
field number is the real wire identity
```

Jangan pernah reuse field number.

---

## 17. Protobuf Field Numbers and Evolution

Protobuf encoding menggunakan tag/field number. Misalnya:

```proto
message CaseResponse {
  string case_id = 1;
  string status = 2;
}
```

Jika field `status = 2` dihapus, jangan pakai `2` untuk makna baru.

Buruk:

```proto
message CaseResponse {
  string case_id = 1;
  string assigned_officer = 2; // BAD: reused old status number
}
```

Baik:

```proto
message CaseResponse {
  string case_id = 1;
  reserved 2;
  reserved "status";
  string assigned_officer = 3;
}
```

Kenapa?

Client lama yang membaca field 2 akan mengira itu `status`.

Compatibility rule:

```text
Never reuse field numbers.
Never change field meaning.
Never change field type unless explicitly wire-compatible and semantically safe.
Reserve deleted fields.
```

---

## 18. Protobuf Unknown Fields

Jika receiver membaca field yang tidak dikenal, behavior modern Protobuf umumnya dapat mempertahankan unknown fields dalam beberapa skenario, tetapi jangan membangun correctness kritikal di atas asumsi pass-through tanpa test lintas bahasa/library.

Contoh:

Producer baru:

```proto
message CaseResponse {
  string case_id = 1;
  string status = 2;
  string risk_level = 3;
}
```

Consumer lama hanya tahu:

```proto
message CaseResponse {
  string case_id = 1;
  string status = 2;
}
```

Consumer lama dapat membaca field 1 dan 2, dan field 3 menjadi unknown.

Ini membantu rolling deployment:

```text
new producer -> old consumer
```

Tetapi semantic compatibility tetap perlu dijaga. Jika field baru wajib untuk business correctness, consumer lama tetap tidak tahu.

---

## 19. Protobuf Default Value Trap

Proto3 historically membuat field presence tricky untuk scalar.

Contoh:

```proto
message UpdateCaseRequest {
  string remarks = 1;
}
```

Jika `remarks` tidak dikirim, default-nya string kosong. Jika dikirim string kosong, hasilnya juga string kosong.

Ini mirip missing vs empty problem di JSON.

Solusi:

### 19.1 Gunakan `optional`

```proto
message UpdateCaseRequest {
  optional string remarks = 1;
}
```

### 19.2 Gunakan wrapper type

```proto
import "google/protobuf/wrappers.proto";

message UpdateCaseRequest {
  google.protobuf.StringValue remarks = 1;
}
```

### 19.3 Gunakan explicit operation

```proto
message UpdateCaseRequest {
  string case_id = 1;
  repeated PatchOperation operations = 2;
}

message PatchOperation {
  string path = 1;
  OperationType op = 2;
  string value = 3;
}
```

Rule:

```text
For update semantics, field presence matters.
```

---

## 20. Protobuf Enum Trap

Protobuf enum juga harus evolvable.

```proto
enum CaseStatus {
  CASE_STATUS_UNSPECIFIED = 0;
  CASE_STATUS_DRAFT = 1;
  CASE_STATUS_SUBMITTED = 2;
  CASE_STATUS_APPROVED = 3;
}
```

Rules:

1. Nilai pertama harus unspecified/unknown dengan number 0.
2. Jangan ubah number existing enum.
3. Jangan reuse number/name deleted enum; reserve.
4. Consumer harus handle unknown enum value.
5. Jangan gunakan default zero sebagai status valid.

Buruk:

```proto
enum CaseStatus {
  CASE_STATUS_DRAFT = 0; // BAD
  CASE_STATUS_SUBMITTED = 1;
}
```

Karena missing field akan menjadi DRAFT.

---

## 21. Protobuf `oneof`

`oneof` berguna untuk union type.

```proto
message NotificationTarget {
  oneof target {
    EmailTarget email = 1;
    SmsTarget sms = 2;
    WebhookTarget webhook = 3;
  }
}
```

Namun evolution harus hati-hati. Menambah variant baru bisa membuat consumer lama tidak tahu target tersebut.

Rule:

```text
Adding oneof variant is wire-compatible but may be semantically breaking for old consumers.
```

---

## 22. Protobuf Maps and Repeated Fields

`map<K,V>` sebenarnya disintesis sebagai repeated entry. Perhatikan:

```proto
message CaseLabels {
  map<string, string> labels = 1;
}
```

Risiko:

```text
unbounded map size
large repeated fields
duplicate key behavior
ordering not guaranteed
memory pressure
```

Boundary server harus menetapkan limit:

```text
max repeated count
max map entries
max string length
max message size
```

---

## 23. Protobuf and gRPC

gRPC default-nya menggunakan Protobuf, tetapi gRPC bukan Protobuf saja. gRPC adalah RPC framework di atas HTTP/2 dengan metadata, status, deadlines, cancellation, streaming, dan flow control.

Serialization design untuk gRPC harus mempertimbangkan:

```text
message size limit
deadline
streaming vs unary
status code vs domain error payload
metadata vs message field
backward compatibility
multi-language generated code
```

Contoh error model buruk:

```proto
message CreateCaseResponse {
  bool success = 1;
  string error_message = 2;
}
```

Lebih baik:

```text
Use gRPC status for transport/RPC failure.
Use structured domain error details for business failure when appropriate.
```

Namun jangan overuse exception/status untuk normal domain state.

---

## 24. Avro on the Wire

Apache Avro adalah schema-based serialization yang populer di data pipeline, event streaming, log, Kafka ecosystem, data lake, dan long-lived records.

Avro kuat karena konsep:

```text
writer schema
reader schema
schema resolution
logical types
schema evolution
compact binary encoding
object container file
```

Dalam event streaming, producer menulis data dengan writer schema. Consumer membaca dengan reader schema. Avro melakukan schema resolution jika compatible.

Contoh schema:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "namespace": "agency.case.v1",
  "fields": [
    { "name": "caseId", "type": "string" },
    { "name": "createdAt", "type": { "type": "long", "logicalType": "timestamp-millis" } },
    { "name": "source", "type": ["null", "string"], "default": null }
  ]
}
```

---

## 25. Avro Schema Evolution

Avro cocok untuk data yang hidup lama, tetapi harus disiplin.

Common compatible changes:

```text
add field with default
remove field if reader can ignore it
change doc/aliases carefully
```

Dangerous changes:

```text
rename field without alias
change type incompatibly
remove required field without default strategy
change logical type semantics
change enum symbols carelessly
```

Avro sering dipadukan dengan schema registry untuk enforcement. Schema registry bukan hanya registry; ia adalah governance point untuk mencegah producer deploy payload yang merusak consumer.

Mental model:

```text
Avro is strong when schema evolution is a platform discipline, not when every team improvises.
```

---

## 26. Avro vs Protobuf

| Dimension | Protobuf | Avro |
|---|---|---|
| Common use | gRPC/service API | event/data pipeline |
| Schema identity | field number | field name + schema resolution |
| Generated code | common | optional/common |
| Human readable payload | no | no binary, schema JSON readable |
| Evolution style | reserve numbers, add fields | writer/reader schema compatibility |
| Good for long-lived event log | yes, but needs discipline | very strong |
| Good for low-latency RPC | very strong | less common |
| gRPC native | yes | no |

Rule of thumb:

```text
Use Protobuf for RPC contracts.
Use Avro for event/data contracts when schema registry and long-lived data evolution matter.
```

Not absolute, but a useful default.

---

## 27. CBOR on the Wire

CBOR adalah Concise Binary Object Representation. Ia mirip JSON data model tetapi binary, compact, dan extensible.

CBOR cocok saat:

```text
payload JSON-like tetapi ingin lebih compact
IoT/constrained environment
binary tags/extensibility diperlukan
HTTP API but compact representation desired
```

CBOR mempertahankan model seperti:

```text
map/object
array
string
number
boolean
null
binary data
semantic tags
```

Dibanding Protobuf, CBOR tidak selalu schema-first. Ia lebih dekat ke “binary JSON with extensions”.

Trade-off:

```text
CBOR more compact than JSON
CBOR less universally inspectable than JSON
CBOR less contract-rigid than Protobuf unless combined with schema/profile
```

---

## 28. Java Native Serialization

Java native serialization mengubah object graph Java menjadi byte stream dan membacanya kembali menjadi object.

Contoh:

```java
try (ObjectOutputStream out = new ObjectOutputStream(outputStream)) {
    out.writeObject(object);
}
```

Inbound:

```java
try (ObjectInputStream in = new ObjectInputStream(inputStream)) {
    Object obj = in.readObject();
}
```

Ini terlihat mudah. Justru itu masalahnya.

---

## 29. Why Java Serialization Is Dangerous at Boundaries

### 29.1 It couples wire format to Java class structure

External payload menjadi tergantung:

```text
class name
package name
serialVersionUID
field layout
classpath
custom readObject/writeObject behavior
```

Ini buruk untuk distributed systems.

### 29.2 It is not language-neutral

Consumer non-Java sulit membaca.

### 29.3 It is fragile across versions

Perubahan class bisa memutus compatibility.

### 29.4 It can instantiate arbitrary object graphs

Deserialization dapat menjalankan behavior tertentu melalui gadget chain jika classpath mengandung library rentan.

### 29.5 It is not transparent

Sulit di-debug, sulit diobservasi, sulit divalidasi dengan schema formal.

### 29.6 It is hostile to zero-trust boundary

Input external tidak boleh diberi kuasa untuk menentukan object graph internal.

Rule:

```text
Do not use Java native serialization for untrusted input or external service boundary.
```

Jika legacy memaksa, gunakan serialization filter, allowlist class, size/depth/reference limit, isolated classloader/process, and migration plan.

---

## 30. Java Serialization Filters

Java menyediakan serialization filtering untuk membatasi apa yang boleh dideserialize. Tujuannya adalah mempersempit class/object graph yang bisa masuk dan meningkatkan robustness/security.

Contoh conceptual filter:

```java
ObjectInputFilter filter = info -> {
    Class<?> clazz = info.serialClass();
    if (clazz != null && !clazz.getName().startsWith("com.example.safe.")) {
        return ObjectInputFilter.Status.REJECTED;
    }
    if (info.depth() > 20) {
        return ObjectInputFilter.Status.REJECTED;
    }
    if (info.references() > 10_000) {
        return ObjectInputFilter.Status.REJECTED;
    }
    return ObjectInputFilter.Status.UNDECIDED;
};
```

Namun filter adalah mitigation, bukan pembenaran untuk desain baru.

Better migration:

```text
Java serialization legacy payload
  -> isolate reader
  -> filter aggressively
  -> convert to explicit DTO
  -> persist/emit safe format
  -> deprecate old protocol
```

---

## 31. Content-Type and Negotiation

Serialization harus terlihat di protocol.

HTTP request harus punya:

```http
Content-Type: application/json
Accept: application/json
```

Untuk Protobuf over HTTP:

```http
Content-Type: application/x-protobuf
Accept: application/x-protobuf
```

Untuk JSON problem details:

```http
Content-Type: application/problem+json
```

Untuk CBOR:

```http
Content-Type: application/cbor
```

Rule:

```text
Do not guess payload format from body shape.
Use Content-Type and enforce it.
```

Server harus menolak unsupported media type:

```text
415 Unsupported Media Type
```

Jika client meminta response format yang tidak didukung:

```text
406 Not Acceptable
```

---

## 32. Compression and Serialization

Compression bukan bagian dari serialization, tetapi sering berdekatan.

```text
serialization -> bytes
compression -> smaller bytes
transport -> frames/packets
```

Compression trade-off:

| Benefit | Cost |
|---|---|
| less bandwidth | CPU compression/decompression |
| lower transfer time for large payload | more latency for small payload |
| smaller proxy buffers | decompression bomb risk |
| better for text/repetitive data | less useful for already compact binary |

Rules:

1. Jangan compress payload kecil secara membabi buta.
2. Limit decompressed size, bukan hanya compressed size.
3. Monitor compression ratio.
4. Disable or restrict compression for sensitive data in certain contexts if side-channel risk matters.
5. Test CPU impact under p95/p99 load.

---

## 33. Schema Evolution Strategies

Compatibility harus didefinisikan eksplisit.

### 33.1 Backward compatibility

New reader can read old data.

```text
old producer -> new consumer
```

### 33.2 Forward compatibility

Old reader can read new data.

```text
new producer -> old consumer
```

### 33.3 Full compatibility

Both directions work.

```text
old <-> new
```

### 33.4 Transitive compatibility

Schema v10 compatible not only with v9, but all relevant older versions.

Important for stored event log.

---

## 34. Deployment Reality: Producer and Consumer Are Not Updated Together

In real systems:

```text
client app version may lag
mobile app may stay old for months
partner system may update quarterly
consumer group may be paused
message queue may contain old payloads
rollback may reintroduce old producer
blue/green may run old and new together
canary may produce new field to old consumer
```

Therefore:

```text
"We deploy both services together" is not a compatibility strategy.
```

Even in one company, deployments are not atomic across all consumers.

---

## 35. Compatibility Rules by Format

### 35.1 JSON

Usually safe:

```text
add optional field
add object member that old clients ignore
add enum value if clients handle unknown
```

Risky/breaking:

```text
rename field
remove field
change type string -> number
change date format
change enum set without fallback
change missing/null semantics
wrap response in new envelope
change array to object
```

### 35.2 Protobuf

Usually safe:

```text
add new field with new number
add enum value if unknown handled
reserve deleted fields
```

Risky/breaking:

```text
reuse field number
change field type incompatibly
change field meaning
move fields into existing oneof carelessly
remove field without reserve
change default semantics
```

### 35.3 Avro

Usually safe depending compatibility mode:

```text
add field with default
remove field reader does not require
use aliases for rename
```

Risky/breaking:

```text
add required field without default
rename field without alias
change type incompatibly
change logical type meaning
```

### 35.4 XML

Usually safe:

```text
add optional element
add optional attribute
extend namespace carefully
```

Risky/breaking:

```text
change namespace
change element order if schema requires order
remove required element
change XSD type
change canonicalization/signature behavior
```

---

## 36. Semantic Compatibility

Wire compatibility tidak cukup.

Contoh JSON lama:

```json
{
  "status": "APPROVED"
}
```

Payload baru:

```json
{
  "status": "APPROVED",
  "approvalType": "CONDITIONAL"
}
```

Old consumer bisa parse karena field baru diabaikan. Tapi jika old consumer menganggap semua `APPROVED` berarti final approval, maka secara semantic terjadi bug.

Rule:

```text
A change can be wire-compatible but business-breaking.
```

Pertanyaan wajib:

```text
If old consumer ignores the new field, is behavior still safe?
```

Jika tidak, perlu versi kontrak baru, endpoint baru, feature flag, consumer gating, atau rollout choreography.

---

## 37. Versioning Patterns

### 37.1 URI versioning

```http
/api/v1/cases
/api/v2/cases
```

Mudah dilihat, tetapi bisa mendorong duplikasi endpoint.

### 37.2 Header/media type versioning

```http
Accept: application/vnd.agency.case.v2+json
```

Lebih rapi secara REST/media type, tetapi tooling bisa lebih kompleks.

### 37.3 Field-level evolution

Tambahkan optional fields tanpa versi endpoint.

Cocok untuk non-breaking change.

### 37.4 Protobuf package version

```proto
package agency.case.v1;
```

Untuk breaking change besar:

```proto
package agency.case.v2;
```

### 37.5 Event versioning

Event harus diperlakukan lebih hati-hati karena long-lived.

```json
{
  "eventType": "CaseCreated",
  "eventVersion": 2,
  "payload": { ... }
}
```

Namun jangan jadikan `eventVersion` alasan untuk sembarangan breaking change tanpa migration strategy.

---

## 38. Envelope Pattern

Envelope memisahkan metadata dari payload.

```json
{
  "messageId": "01J...",
  "messageType": "CaseCreated",
  "messageVersion": 1,
  "occurredAt": "2026-06-18T01:23:45Z",
  "producer": "case-service",
  "correlationId": "...",
  "payload": {
    "caseId": "C-2026-0001"
  }
}
```

Envelope berguna untuk:

```text
traceability
idempotency
schema routing
audit
replay
DLQ analysis
multi-event transport
```

Risiko:

```text
overly generic payload
weak typing
nested version confusion
large wrapper repeated everywhere
```

Rule:

```text
Use envelope for operational metadata, not as excuse to avoid typed contracts.
```

---

## 39. Error Payload Serialization

Error payload adalah kontrak juga.

Buruk:

```json
{
  "error": "Something went wrong"
}
```

Lebih baik:

```json
{
  "type": "https://errors.example.com/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid",
  "instance": "/cases/requests/abc123",
  "errors": [
    {
      "field": "applicant.email",
      "code": "INVALID_EMAIL",
      "message": "Email format is invalid"
    }
  ],
  "correlationId": "01J..."
}
```

For gRPC, use status codes and structured error details when appropriate.

Important:

```text
error code must be stable
message can be human-facing or diagnostic but not used for logic
correlation id helps support/debugging
avoid leaking internals/secrets/stack traces
```

---

## 40. Observability of Serialization

Log and metrics should answer:

```text
Which content type?
Which schema version?
Payload size before compression?
Payload size after compression?
Serialization time?
Deserialization time?
Validation failure count?
Unknown field count?
Enum unknown count?
Parse error taxonomy?
Rejected payload due to size/depth?
```

Do not log full payload blindly.

Safer logging:

```text
message id
schema/version
selected business identifiers
size
hash/checksum
field-level validation errors
correlation id
```

For sensitive payload:

```text
mask PII
avoid secrets
avoid auth tokens
avoid full document dump
apply retention policy
```

---

## 41. Security Boundary Checklist

Every external parser should enforce:

```text
allowed content types
max request body size
max decompressed size
max nesting depth
max array/repeated count
max string length
max field count
max numeric precision
parser timeout/deadline indirectly via request deadline
strict UTF-8 if required
schema validation
semantic validation
unknown field policy
safe polymorphism whitelist
safe XML parser config
no Java deserialization of untrusted data
safe error response
safe logging
```

---

## 42. Mapping Layer Design in Java

Bad design:

```java
@RestController
class CaseController {
    @PostMapping("/cases")
    public CaseEntity create(@RequestBody CaseEntity entity) {
        return repository.save(entity);
    }
}
```

Problems:

```text
persistence fields exposed
internal status modifiable
mass assignment risk
domain invariant bypass
wire contract tied to DB model
hard to evolve
```

Better:

```java
public record CreateCaseRequest(
    String applicantId,
    String caseType,
    String description
) {}

public record CaseResponse(
    String caseId,
    String status,
    String createdAt
) {}
```

Controller:

```java
@PostMapping(
    value = "/cases",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<CaseResponse> create(@Valid @RequestBody CreateCaseRequest request) {
    CreateCaseCommand command = mapper.toCommand(request);
    Case created = service.create(command);
    return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toResponse(created));
}
```

Mapping layer:

```text
Request DTO -> command -> domain -> response DTO
```

---

## 43. Boundary DTO Rules

DTO should be:

```text
small
explicit
version-conscious
validation-friendly
free from business behavior
free from persistence annotations
free from internal-only fields
stable enough for consumers
```

DTO should not be:

```text
JPA entity
domain aggregate
Map<String,Object> everywhere
unbounded polymorphic object
framework dumping ground
```

---

## 44. Streaming Serialization

For large payload, avoid full materialization.

Examples:

```text
large JSON array export
large CSV conversion
file metadata with chunks
large gRPC stream
bulk import validation
```

Bad:

```java
List<Record> all = repository.findAll();
return objectMapper.writeValueAsString(all);
```

Better:

```text
cursor/page from DB
stream encode records
flush chunks
respect client cancellation
limit rate/backpressure
record progress/checkpoint if import
```

For JSON streaming:

```json
[
  { "id": "1" },
  { "id": "2" }
]
```

But partial failure is hard: if error happens after half response sent, cannot change status code cleanly.

Alternative: NDJSON:

```text
{"id":"1"}
{"id":"2"}
{"error":"..."}
```

But consumer must support it.

For gRPC streaming, each message is framed separately, which gives cleaner streaming model, but still needs flow control and cancellation handling.

---

## 45. Large Payload Decision

If payload is large, ask:

```text
Is this really one logical message?
Can it be paginated?
Can it be chunked?
Can it be streamed?
Can it be placed in object storage with metadata sent separately?
Can receiver resume after failure?
Can checksum verify integrity?
Can partial processing be idempotent?
```

Often better pattern:

```text
metadata API
  -> pre-signed/object storage upload/download
  -> checksum
  -> async processing
  -> status polling/callback/event
```

Instead of pushing 500 MB through synchronous JSON API.

---

## 46. Decision Matrix

| Use case | Preferred format | Reason |
|---|---|---|
| Public REST API | JSON | Tooling, readability, broad compatibility |
| Browser-facing API | JSON | Native ecosystem |
| Enterprise SOAP/regulatory document | XML | Schema/signature/legacy requirement |
| Internal high-throughput RPC | Protobuf + gRPC | Compact, typed, HTTP/2, generated stubs |
| Event streaming/data lake | Avro or Protobuf | Schema evolution discipline |
| Kafka with schema registry | Avro/Protobuf/JSON Schema | Governance |
| IoT/constrained compact JSON-like data | CBOR | Compact, extensible |
| Legacy Java-only trusted internal cache | Maybe Java serialization, but avoid | Coupled and risky |
| Untrusted external input | Never Java serialization | Security risk |

---

## 47. Format Selection Heuristics

### Choose JSON when:

```text
consumer diversity is high
human debugging matters
browser/API gateway ecosystem matters
schema change rate is moderate
payload size is acceptable
```

### Choose Protobuf when:

```text
service-to-service RPC
multi-language generated clients
high throughput/low latency
strong schema discipline exists
gRPC is already used
```

### Choose Avro when:

```text
events are stored long-term
schema registry exists
writer/reader schema resolution matters
data platform integration matters
```

### Choose XML when:

```text
partner requires XML/SOAP
XSD/signature/canonicalization are part of contract
payload is document-centric
```

### Choose CBOR when:

```text
JSON-like model is desired but compact binary is needed
constrained environments
HTTP content negotiation can support it
```

### Avoid Java serialization when:

```text
input is untrusted
boundary crosses service/team/language
payload must live long
contract must be evolvable
security matters
```

Which means: almost always avoid it for network protocols.

---

## 48. Case Study 1: JSON API Breaks Because of Number Precision

Scenario:

```text
Java backend returns long numeric case ID.
Frontend JS receives it as Number.
Large ID loses precision.
User opens wrong case or API call fails.
```

Payload:

```json
{
  "caseId": 9223372036854775807
}
```

JS cannot safely represent it.

Fix:

```json
{
  "caseId": "9223372036854775807"
}
```

But changing number to string is breaking for existing clients.

Better initial design:

```text
IDs in public JSON APIs are strings unless numeric arithmetic is required.
```

---

## 49. Case Study 2: Protobuf Field Number Reuse Causes Silent Corruption

Version 1:

```proto
message CaseEvent {
  string case_id = 1;
  string status = 2;
}
```

Version 2:

```proto
message CaseEvent {
  string case_id = 1;
  string assigned_officer = 2; // reused
}
```

Old consumer reads assigned officer as status.

Impact:

```text
silent semantic corruption
harder than parse failure
can trigger wrong workflow/state transition
```

Correct v2:

```proto
message CaseEvent {
  string case_id = 1;
  reserved 2;
  reserved "status";
  string assigned_officer = 3;
}
```

---

## 50. Case Study 3: XML XXE in Partner Integration

Scenario:

```text
Partner uploads XML document.
Backend parser allows external entity.
Attacker submits XML referencing local file or internal URL.
```

Impact:

```text
local file disclosure
SSRF
internal metadata endpoint access
network scanning
```

Fix:

```text
disable DTD/external entities
restrict external schema access
parse with secure processing
validate input size
isolate parser if high-risk
```

---

## 51. Case Study 4: Java Serialization Legacy RMI-like Protocol

Scenario:

```text
Old internal Java service accepts serialized object over TCP.
Only internal network can call it.
Years later, network boundary changes.
A dependency with known gadget chain is present.
```

Risk:

```text
RCE via deserialization
no schema governance
hard to inspect traffic
hard to migrate
```

Mitigation:

```text
block external access
add ObjectInputFilter allowlist
limit depth/references/bytes
monitor rejected payloads
build replacement protocol using JSON/Protobuf
migrate consumers gradually
remove endpoint
```

---

## 52. Serialization and Regulatory Defensibility

Dalam sistem regulasi, serialization bukan hanya performance; ia memengaruhi defensibility.

Pertanyaan audit:

```text
What exactly did we receive?
What version of schema was used?
Can we still read payload from 3 years ago?
Did parsing preserve legal meaning?
Were timestamps interpreted with correct timezone/rule?
Was payload tampered with?
Can we prove the decision input?
Was unknown field ignored safely?
```

Untuk audit/event:

```text
store raw payload if legally required
store normalized canonical representation
store schema version
store producer/consumer identity
store receivedAt and occurredAt separately
store hash/signature where needed
store parsing/validation outcome
```

Do not rely only on current Java DTO to reconstruct old meaning.

---

## 53. Canonicalization

Canonicalization berarti membuat representasi standar dari data agar bisa dibandingkan, di-hash, atau ditandatangani.

JSON object order secara semantic tidak penting:

```json
{"a":1,"b":2}
```

sama dengan:

```json
{"b":2,"a":1}
```

Tetapi byte-nya berbeda.

Jika ingin signature/hash semantic, perlu canonicalization rules:

```text
field order
whitespace
number representation
unicode normalization
time format
missing/null handling
```

XML canonicalization bahkan lebih kompleks karena namespace, attributes, whitespace, comments, dan canonical XML rules.

Rule:

```text
Never invent ad-hoc canonicalization for legal/security signatures unless you fully control rules and interoperability.
```

---

## 54. Hash, Checksum, Signature, and MAC

Jangan campur konsep.

| Mechanism | Purpose |
|---|---|
| Checksum | detect accidental corruption |
| Hash | identify content/fingerprint |
| MAC/HMAC | integrity + authenticity with shared secret |
| Digital signature | integrity + authenticity + non-repudiation-ish with private key |
| Encryption | confidentiality |

Serialization interacts with these because bytes matter.

```text
Sign the exact bytes? Then formatting changes break signature.
Sign canonical data? Then canonicalization must be stable.
Encrypt before compress? Usually compression before encryption if safe.
Hash compressed or uncompressed payload? Define explicitly.
```

---

## 55. Practical Java Library Notes

This series is not a library tutorial, but common Java ecosystem choices:

### JSON

```text
Jackson
Gson
JSON-B / Jakarta JSON Binding
JSON-P / Jakarta JSON Processing
```

Jackson is common in Spring, but powerful features require safe configuration.

### XML

```text
JAXP
JAXB / Jakarta XML Binding
SAX
StAX
DOM
```

### Protobuf/gRPC

```text
protobuf-java
grpc-java
grpc-netty-shaded
grpc-protobuf
grpc-stub
```

### Avro

```text
avro Java library
schema registry clients depending platform
```

### CBOR

```text
Jackson dataformat CBOR
other CBOR libraries
```

Decision should include operational maturity, not only API elegance.

---

## 56. Production Checklist: Before Adding a New Wire Contract

Ask:

```text
Who are the producers?
Who are the consumers?
Can they deploy independently?
How long can payload live?
Is schema stored with payload?
What is compatibility mode?
What fields are required?
What fields are optional?
What is missing/null/default semantic?
What are max payload limits?
What is enum unknown behavior?
What is timestamp rule?
What is ID representation?
What content type is used?
What compression is allowed?
What is error format?
What is observability plan?
What is security parser config?
How do we test breaking changes?
How do we rollback?
How do we deprecate?
```

---

## 57. Anti-Patterns

### 57.1 Exposing database entity as API

Breaks encapsulation and evolution.

### 57.2 `Map<String, Object>` as universal DTO

Destroys type safety, validation, documentation, and compatibility discipline.

### 57.3 Blindly ignoring unknown fields

Often useful, but not always safe. Unknown field may indicate incompatible producer.

### 57.4 Rejecting all unknown fields everywhere

Can block forward compatibility. Use per-boundary policy.

### 57.5 Java serialization for convenience

Convenience now, incident later.

### 57.6 Logging full payload

Leaks PII/secrets and creates compliance risk.

### 57.7 Compressing everything

Can waste CPU and introduce decompression risk.

### 57.8 Treating parse success as business validity

Parsing only means syntax/encoding was accepted.

### 57.9 Reusing Protobuf field numbers

Silent corruption risk.

### 57.10 Changing JSON type casually

`number` to `string`, object to array, date format change are breaking changes.

---

## 58. Top 1% Mental Model

A top-tier engineer does not ask only:

```text
How do I serialize this object?
```

They ask:

```text
What meaning crosses the boundary?
Who depends on it?
How will it evolve?
What if old and new versions coexist?
What if payload is malicious?
What if payload is huge?
What if parsing succeeds but meaning is unsafe?
What if unknown fields appear?
What if enum expands?
What if timestamp is interpreted in the wrong timezone?
What if this data must be read in 5 years?
How will we debug this in production?
How will we prove what happened?
```

Serialization is not a mapper problem. It is a distributed systems contract problem.

---

## 59. Exercises

### Exercise 1 — JSON compatibility review

Given payload v1:

```json
{
  "caseId": "C-001",
  "status": "APPROVED",
  "submittedAt": "2026-06-18T01:00:00Z"
}
```

Proposed v2:

```json
{
  "id": "C-001",
  "status": {
    "code": "APPROVED",
    "label": "Approved"
  },
  "submittedAt": "18-06-2026 09:00"
}
```

Identify breaking changes and propose safe migration.

Expected analysis:

```text
caseId renamed to id -> breaking
status string changed to object -> breaking
submittedAt format changed -> breaking
missing timezone -> semantic regression
```

Safer:

```json
{
  "caseId": "C-001",
  "status": "APPROVED",
  "statusInfo": {
    "code": "APPROVED",
    "label": "Approved"
  },
  "submittedAt": "2026-06-18T01:00:00Z"
}
```

Deprecate old fields later with versioned endpoint if needed.

### Exercise 2 — Protobuf evolution

Given:

```proto
message Applicant {
  string id = 1;
  string name = 2;
  string email = 3;
}
```

You need to remove `email` and add `phoneNumber`.

Write safe schema.

Expected:

```proto
message Applicant {
  string id = 1;
  string name = 2;
  reserved 3;
  reserved "email";
  string phone_number = 4;
}
```

### Exercise 3 — Choose format

You need:

```text
high-throughput internal RPC
Java + Go consumers
strict contract
deadline and streaming support
```

Likely choice:

```text
Protobuf + gRPC
```

### Exercise 4 — Large import

A client uploads 2 GB case evidence metadata as JSON array.

Design safer approach.

Expected direction:

```text
object storage upload
checksum
metadata manifest
async processing
streaming parser
status endpoint
dead-letter/error report
idempotency key
chunking/resume
```

---

## 60. Summary

Serialization is the transformation of meaning into bytes under a contract. The hard part is not converting object to JSON or Protobuf. The hard part is preserving meaning safely across time, versions, languages, teams, deployment windows, failure modes, and hostile input.

Key takeaways:

```text
Wire contract is not domain model.
Parsing is not validation.
Human-readable formats improve debugging but cost size/CPU.
Binary schema-first formats improve performance/contract discipline but require tooling.
JSON has traps around null/missing, number precision, time, enum, and polymorphism.
XML remains important in document-heavy enterprise integration but has parser/security complexity.
Protobuf is excellent for gRPC/RPC but field numbers and defaults require discipline.
Avro is strong for long-lived data/event evolution with schema registry discipline.
CBOR is compact JSON-like binary representation.
Java native serialization should not be used for external/untrusted boundaries.
Compatibility must consider rolling deploy, rollback, old consumers, stored data, and semantic safety.
Serialization design must include observability and security limits.
```

---

## 61. What Comes Next

Next part:

```text
Part 7 — HTTP as a Protocol: Semantics Before Frameworks
```

Kita akan masuk ke HTTP bukan sebagai “REST controller”, tetapi sebagai protocol contract:

```text
method semantics
safe/idempotent/cacheable
status code taxonomy
headers
content negotiation
conditional request
ETag
range request
caching
redirect
authentication header
protocol-level invariants
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 5 — Protocol Design Fundamentals: Framing, Length Prefix, Delimiters, Streaming, and Compatibility](./005-protocol-design-fundamentals-framing-length-prefix-delimiters-streaming-compatibility.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 7 — HTTP as a Protocol: Semantics Before Frameworks](./007-http-as-a-protocol-semantics-before-frameworks.md)

</div>