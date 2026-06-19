# learn-kafka-event-streaming-mastery-for-java-engineers-part-010.md

# Part 010 — Serialization and Schema Governance: Avro, Protobuf, JSON Schema, Compatibility

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Untuk: Java software engineer yang ingin memahami Kafka sampai level production architecture  
> Fokus part ini: serialization, schema, schema evolution, Schema Registry, compatibility, subject naming, Java SerDes, contract governance, dan failure mode schema dalam event-driven systems.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **serialization**, **encoding**, **schema**, **contract**, dan **event semantics**.
2. Menjelaskan kenapa Kafka hanya menyimpan bytes, sedangkan makna data berada di luar Kafka.
3. Memilih secara sadar antara **JSON**, **Avro**, **Protobuf**, dan **JSON Schema** untuk event streaming.
4. Memahami cara kerja **Schema Registry** sebagai contract repository, bukan sekadar registry file schema.
5. Mendesain strategi **schema evolution** agar producer dan consumer bisa deploy secara independen.
6. Memahami compatibility mode: `BACKWARD`, `FORWARD`, `FULL`, varian `*_TRANSITIVE`, dan `NONE`.
7. Menentukan **subject naming strategy** yang sesuai dengan model topic dan event ownership.
8. Menulis pola Java producer/consumer yang memakai schema-aware serializer/deserializer.
9. Menyusun workflow governance agar schema change tidak menghancurkan downstream system.
10. Mengenali failure mode production: poison schema, incompatible deployment, schema registry outage, auto-registration abuse, dan multi-event topic ambiguity.

---

## 2. Mental Model Utama

Kafka tidak peduli apakah value yang kamu kirim adalah JSON, Avro, Protobuf, compressed binary, gambar, atau byte array acak. Dari sudut pandang broker, record Kafka adalah kira-kira:

```text
(topic, partition, offset, timestamp, headers, key_bytes, value_bytes)
```

Kafka broker menyimpan dan mereplikasi bytes. Kafka tidak tahu bahwa field `caseId` wajib ada, bahwa `status` harus salah satu dari `OPEN`, `ESCALATED`, `CLOSED`, atau bahwa `amount` tidak boleh berubah dari integer menjadi string.

Artinya, semua hal berikut adalah tanggung jawab sistem di sekitar Kafka:

```text
Apakah bytes bisa dibaca?
Apakah struktur data valid?
Apakah producer dan consumer sepakat atas format?
Apakah perubahan schema aman?
Apakah makna event tetap sama?
Apakah field baru punya default?
Apakah consumer lama tetap bisa membaca event baru?
Apakah consumer baru tetap bisa membaca event lama?
```

Mental model yang perlu dipegang:

```text
Kafka stores bytes.
Serializers turn objects into bytes.
Deserializers turn bytes into objects.
Schemas describe valid structure.
Schema Registry stores and validates schema versions.
Compatibility rules allow independent deployment.
Governance protects long-lived event contracts.
```

Dalam sistem kecil, kamu bisa lolos dengan JSON string tanpa registry. Dalam sistem besar, multi-team, multi-service, long-lived, regulatory, atau analytical pipeline, schema tanpa governance akan menjadi sumber incident yang sulit didiagnosis.

---

## 3. Kenapa Serialization Penting di Kafka

Dalam HTTP/REST, request dan response biasanya bersifat sinkron. Client mengirim request, server langsung memberi response. Jika contract rusak, error terlihat cepat.

Dalam Kafka, producer dan consumer:

1. Tidak harus hidup pada waktu yang sama.
2. Bisa deploy secara independen.
3. Bisa memakai bahasa berbeda.
4. Bisa membaca data lama dari retention beberapa hari, bulan, atau tahun.
5. Bisa ada banyak consumer dengan ekspektasi schema berbeda.
6. Bisa melakukan replay dari offset lama.
7. Bisa memakai data yang sama untuk operational, analytics, audit, ML, dan search indexing.

Karena itu schema Kafka harus kompatibel bukan hanya dengan consumer saat ini, tetapi juga dengan:

```text
Consumer lama yang belum deploy
Consumer baru yang membaca event lama
Job replay yang membaca historical data
Stream processor stateful yang restore state
Connector sink yang mapping field ke storage eksternal
Auditor yang merekonstruksi event masa lalu
```

Serialization buruk di Kafka biasanya tidak gagal di producer. Ia gagal belakangan, di consumer, di stream processor, di data lake, atau saat replay incident.

---

## 4. Vocabulary yang Harus Jelas

### 4.1 Serialization

Serialization adalah proses mengubah object/memory structure menjadi bytes.

Contoh:

```java
CaseCreatedEvent event = new CaseCreatedEvent(...);
byte[] bytes = serializer.serialize("case-events", event);
```

### 4.2 Deserialization

Deserialization adalah proses mengubah bytes menjadi object yang bisa dipakai aplikasi.

```java
CaseCreatedEvent event = deserializer.deserialize("case-events", bytes);
```

### 4.3 Encoding

Encoding adalah representasi konkret dalam bytes. Contoh: UTF-8 JSON, Avro binary encoding, Protobuf binary encoding.

### 4.4 Schema

Schema adalah definisi struktur data yang valid.

Contoh Avro:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "namespace": "com.example.enforcement.events",
  "fields": [
    { "name": "caseId", "type": "string" },
    { "name": "createdAt", "type": "string" },
    { "name": "priority", "type": ["null", "string"], "default": null }
  ]
}
```

### 4.5 Contract

Contract lebih luas daripada schema. Schema hanya menjawab “bentuk data”. Contract juga mencakup:

```text
Makna field
Satuan nilai
Enum semantics
Nullability semantics
Ordering expectation
Idempotency expectation
Event lifecycle
Retention expectation
Ownership
Compatibility policy
```

Contoh: schema bisa mengatakan `status` adalah string. Contract harus menjelaskan bahwa `ESCALATED` berarti case telah melewati SLA dan masuk queue supervisor, bukan sekadar label UI.

### 4.6 Schema Evolution

Schema evolution adalah kemampuan mengubah schema dari waktu ke waktu tanpa memutus producer/consumer.

Contoh perubahan:

```text
Menambah optional field
Menghapus field
Mengubah default value
Menambah enum value
Mengganti field type
Rename field
Memecah event menjadi dua event
```

Tidak semua perubahan aman.

### 4.7 Compatibility

Compatibility adalah aturan yang menentukan apakah versi schema baru boleh hidup bersama versi lama.

Pertanyaan compatibility:

```text
Bisakah consumer dengan schema baru membaca data lama?
Bisakah consumer dengan schema lama membaca data baru?
Bisakah semua versi historis tetap dibaca?
```

---

## 5. Kafka Bytes Problem

Anggap producer v1 mengirim JSON:

```json
{
  "caseId": "CASE-001",
  "priority": "HIGH"
}
```

Consumer menulis kode:

```java
String priority = node.get("priority").asText();
```

Lalu producer v2 berubah menjadi:

```json
{
  "caseId": "CASE-001",
  "priority": {
    "level": "HIGH",
    "reason": "SLA_RISK"
  }
}
```

Kafka tetap menerima record. Broker tidak melihat masalah. Producer sukses. Tapi consumer lama bisa gagal runtime.

Masalahnya bukan Kafka. Masalahnya contract berubah tanpa compatibility gate.

Dalam Kafka, contract break bisa berbahaya karena:

1. Producer tidak tahu siapa saja consumer-nya.
2. Consumer bisa tidak langsung gagal bila path field jarang dipakai.
3. Data rusak tetap tersimpan di log.
4. Replay akan mengulang data yang sama.
5. DLQ bisa penuh karena satu schema change.
6. Stateful stream processor bisa gagal restore.
7. Sink connector bisa gagal mapping field.
8. Data lake bisa punya mixed schema yang sulit dibaca.

---

## 6. JSON String: Berguna, Tapi Berbahaya Jika Tanpa Governance

JSON populer karena mudah dibaca dan mudah dibuat.

Contoh producer sederhana:

```java
ObjectMapper mapper = new ObjectMapper();
String json = mapper.writeValueAsString(event);
producer.send(new ProducerRecord<>("case-events", caseId, json));
```

Consumer:

```java
CaseCreatedEvent event = mapper.readValue(record.value(), CaseCreatedEvent.class);
```

Kelebihan JSON:

1. Human-readable.
2. Tooling luas.
3. Mudah debugging dengan CLI.
4. Cocok untuk prototyping.
5. Cocok untuk event kecil dan low-throughput.
6. Cocok jika schema governance dilakukan terpisah.

Kekurangan JSON tanpa schema:

1. Tidak ada compatibility check otomatis.
2. Field type bisa berubah diam-diam.
3. Typo field tidak ketahuan saat publish.
4. Nullability tidak jelas.
5. Enum tidak terkendali.
6. Payload lebih besar daripada binary encoding.
7. Consumer sering parsing defensif berlebihan.
8. Contract pindah ke wiki, README, atau tribal knowledge.

Contoh anti-pattern:

```json
{
  "id": "123",
  "data": {
    "anything": "whatever"
  }
}
```

Event seperti ini fleksibel, tapi fleksibilitasnya dibayar dengan hilangnya contract.

### Prinsip

JSON boleh dipakai, tetapi untuk event public/long-lived, gunakan **JSON Schema** atau contract validation lain. Jangan menyamakan “bisa dikirim sebagai JSON” dengan “aman sebagai event contract”.

---

## 7. Avro Mental Model

Avro adalah format schema-based yang sangat populer di Kafka ecosystem.

Ciri penting Avro:

1. Schema ditulis dalam JSON format.
2. Data biasanya dikirim dalam binary encoding.
3. Avro mendukung schema evolution dengan reader schema dan writer schema.
4. Field bisa punya default value.
5. Cocok untuk event streaming dan data pipeline.
6. Sangat umum dipakai bersama Confluent Schema Registry.

Contoh Avro schema:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "namespace": "com.example.enforcement.events",
  "fields": [
    { "name": "eventId", "type": "string" },
    { "name": "caseId", "type": "string" },
    { "name": "createdAt", "type": "string" },
    { "name": "priority", "type": ["null", "string"], "default": null }
  ]
}
```

### 7.1 Writer Schema dan Reader Schema

Avro punya mental model penting:

```text
Writer schema = schema yang dipakai saat data ditulis.
Reader schema = schema yang dipakai saat data dibaca.
```

Saat consumer membaca record lama, Avro bisa mencocokkan writer schema lama dengan reader schema baru. Inilah dasar schema evolution.

Contoh:

Schema v1:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "fields": [
    { "name": "caseId", "type": "string" }
  ]
}
```

Schema v2 menambah field optional:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "fields": [
    { "name": "caseId", "type": "string" },
    { "name": "priority", "type": ["null", "string"], "default": null }
  ]
}
```

Consumer v2 bisa membaca data v1 karena field `priority` punya default `null`.

### 7.2 SpecificRecord vs GenericRecord

Dalam Java, Avro biasanya dipakai dengan dua gaya.

#### SpecificRecord

Schema menghasilkan class Java.

```java
CaseCreated event = CaseCreated.newBuilder()
    .setEventId(UUID.randomUUID().toString())
    .setCaseId("CASE-001")
    .setCreatedAt(Instant.now().toString())
    .setPriority("HIGH")
    .build();
```

Kelebihan:

1. Type-safe.
2. Refactoring lebih aman.
3. Cocok untuk application code.
4. Compile-time feedback.

Kekurangan:

1. Perlu code generation.
2. Build pipeline lebih kompleks.
3. Bisa menyebabkan dependency antar tim jika schema artifact tidak dikelola baik.

#### GenericRecord

Object dibangun berdasarkan schema runtime.

```java
GenericRecord record = new GenericData.Record(schema);
record.put("eventId", UUID.randomUUID().toString());
record.put("caseId", "CASE-001");
```

Kelebihan:

1. Fleksibel.
2. Cocok untuk generic pipeline, connectors, data tooling.
3. Tidak perlu class per event.

Kekurangan:

1. Tidak type-safe.
2. Error lebih banyak muncul runtime.
3. Lebih verbose untuk domain code.

### 7.3 Avro Strength

Avro kuat untuk:

```text
Kafka event streaming
Data pipeline
Schema evolution
High-throughput binary event
Multi-language consumers
Data lake ingestion
```

### 7.4 Avro Pitfall

Pitfall umum:

1. Lupa default value saat menambah field.
2. Salah urutan union null, misalnya `['string', 'null']` tanpa default yang cocok.
3. Mengubah field type secara breaking.
4. Rename field tanpa alias.
5. Menaruh terlalu banyak event type dalam satu subject.
6. Mengandalkan generated class sebagai domain model internal.

Prinsip penting:

```text
Avro schema adalah wire contract, bukan domain model lengkap.
```

---

## 8. Protobuf Mental Model

Protocol Buffers atau Protobuf adalah binary serialization format yang banyak dipakai untuk RPC dan event streaming.

Contoh schema `.proto`:

```proto
syntax = "proto3";

package com.example.enforcement.events;

message CaseCreated {
  string event_id = 1;
  string case_id = 2;
  string created_at = 3;
  string priority = 4;
}
```

Ciri penting Protobuf:

1. Field punya numeric tag.
2. Binary encoding compact.
3. Strong code generation untuk banyak bahasa.
4. Sangat populer di gRPC ecosystem.
5. Evolution sangat bergantung pada kestabilan field number.

### 8.1 Field Number adalah Contract

Dalam Protobuf, angka field adalah bagian paling penting.

```proto
string case_id = 2;
```

`2` tidak boleh dipakai ulang untuk field lain jika field dihapus. Jika digunakan ulang, data lama bisa dibaca sebagai makna baru.

Contoh buruk:

```proto
// v1
string priority = 4;

// v2 buruk
string assigned_team = 4;
```

Consumer bisa salah menafsirkan bytes lama.

Gunakan `reserved`:

```proto
message CaseCreated {
  string event_id = 1;
  string case_id = 2;
  string created_at = 3;
  reserved 4;
  reserved "priority";
  string assigned_team = 5;
}
```

### 8.2 Proto3 Default Value Pitfall

Proto3 punya default value implisit:

```text
string -> ""
int32  -> 0
bool   -> false
```

Ini bisa membingungkan karena consumer sulit membedakan:

```text
Field tidak dikirim
Field dikirim dengan nilai default
```

Versi modern Proto3 mendukung `optional`, tetapi penggunaannya tetap perlu disiplin.

```proto
optional string priority = 4;
```

### 8.3 Protobuf Strength

Protobuf kuat untuk:

```text
Cross-language system
High-performance binary payload
gRPC + Kafka mixed architecture
Strict generated API
Mobile/edge/client integration
```

### 8.4 Protobuf Pitfall

Pitfall umum:

1. Reusing field number.
2. Menghapus field tanpa `reserved`.
3. Salah memahami default value.
4. Mengubah type field secara tidak kompatibel.
5. Menggunakan `oneof` tanpa memikirkan evolution.
6. Membuat schema terlalu RPC-oriented untuk event facts.

Prinsip:

```text
Dalam Protobuf, field number lebih stabil daripada nama field.
```

---

## 9. JSON Schema Mental Model

JSON Schema memberi struktur formal untuk JSON.

Contoh:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CaseCreated",
  "type": "object",
  "additionalProperties": false,
  "required": ["eventId", "caseId", "createdAt"],
  "properties": {
    "eventId": { "type": "string" },
    "caseId": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "priority": { "type": ["string", "null"] }
  }
}
```

Kelebihan JSON Schema:

1. Human-readable payload tetap JSON.
2. Validasi struktur lebih formal.
3. Cocok untuk tim yang ingin tetap memakai JSON.
4. Banyak tooling di web ecosystem.
5. Mudah diinspeksi manual.

Kekurangan:

1. Payload lebih besar daripada binary encoding.
2. Compatibility behavior bisa lebih tricky daripada Avro.
3. `additionalProperties` harus dipikirkan matang.
4. JSON number type bisa ambigu untuk integer/decimal precision.
5. Format validation seperti `date-time` sering tidak seketat yang diasumsikan.

### 9.1 `additionalProperties` Trade-Off

Jika:

```json
"additionalProperties": false
```

Maka schema lebih ketat. Consumer tidak akan menerima field asing.

Kelebihan:

1. Typo cepat ketahuan.
2. Contract jelas.
3. Event lebih terkendali.

Kekurangan:

1. Menambah field bisa menjadi breaking untuk consumer yang strict.
2. Evolution perlu compatibility strategy yang hati-hati.

Jika:

```json
"additionalProperties": true
```

Maka event lebih fleksibel.

Kelebihan:

1. Producer bisa menambah field lebih mudah.
2. Consumer lama bisa mengabaikan field baru.

Kekurangan:

1. Typo bisa lolos.
2. Contract lebih longgar.
3. Data quality bisa turun.

Tidak ada jawaban universal. Untuk event publik enterprise, sering lebih baik strict di schema, tapi perubahan harus melalui registry compatibility dan review.

---

## 10. Perbandingan Avro vs Protobuf vs JSON Schema

| Dimensi | Avro | Protobuf | JSON Schema |
|---|---|---|---|
| Encoding umum | Binary | Binary | JSON text |
| Human-readable payload | Tidak | Tidak | Ya |
| Schema file | JSON Avro schema | `.proto` | JSON Schema |
| Code generation | Opsional tapi umum | Sangat umum | Tidak wajib |
| Kafka ecosystem | Sangat kuat | Kuat | Kuat, terutama jika ingin JSON |
| Evolution model | Reader/writer schema | Field number/tag discipline | JSON compatibility rules |
| Payload size | Kecil | Kecil | Lebih besar |
| Debuggability CLI | Perlu decoder | Perlu decoder | Mudah dibaca |
| Cocok untuk | Data streaming, lake, analytics | Cross-language, gRPC, binary contract | JSON-first org, readability |
| Pitfall utama | Default/union/alias | Field number/default value | Strictness dan type ambiguity |

### Decision Heuristic

Gunakan **Avro** jika:

```text
Kafka adalah pusat data streaming.
Data akan masuk ke lake/warehouse.
Schema evolution sangat penting.
Tim nyaman dengan Schema Registry dan generated classes.
```

Gunakan **Protobuf** jika:

```text
Organisasi sudah memakai gRPC/Protobuf.
Butuh cross-language strongly generated contract.
Performa binary penting.
Tim disiplin terhadap field number dan reserved tag.
```

Gunakan **JSON Schema** jika:

```text
Payload perlu mudah dibaca manusia.
Tim sudah JSON-heavy.
Interoperability dengan web/data tooling penting.
Throughput/size bukan bottleneck utama.
Tetap ingin contract validation formal.
```

Hindari **raw JSON tanpa schema** untuk:

```text
Event public antar tim
Regulatory event
Audit event
Long-lived topic
CDC-derived integration
Multi-consumer pipeline
Stream processing stateful
```

---

## 11. Schema Registry Mental Model

Schema Registry adalah repository terpusat untuk schema, versi schema, dan compatibility validation.

Ia biasanya menyediakan:

1. REST API untuk register schema.
2. Subject sebagai namespace schema.
3. Version history per subject.
4. Schema ID global.
5. Compatibility check.
6. Serializer/deserializer integration.
7. Support Avro, Protobuf, JSON Schema.

Mental model:

```text
Producer wants to write event.
Serializer checks/registers schema in Schema Registry.
Schema Registry returns schema ID.
Serializer writes schema ID + encoded payload into Kafka.
Consumer reads bytes.
Deserializer extracts schema ID.
Deserializer fetches writer schema by ID.
Deserializer decodes bytes into object.
```

Kafka record tidak perlu membawa full schema setiap kali. Biasanya payload membawa schema ID kecil yang mengarah ke schema di registry.

### 11.1 Confluent Wire Format Simplified

Secara konseptual, payload Confluent serializer sering dipahami seperti:

```text
magic byte + schema id + encoded payload
```

Contoh mental model:

```text
[0][00 00 04 D2][binary avro payload]
```

`00 00 04 D2` adalah schema ID, misalnya 1234.

Consumer tidak menebak schema. Consumer membaca schema ID, lalu mengambil schema writer dari registry.

### 11.2 Kenapa Broker Tidak Melakukan Schema Validation?

Kafka broker secara desain tidak memvalidasi business payload. Broker bertugas menjaga log, replication, offset, durability, dan throughput.

Schema validation biasanya dilakukan di client serializer atau platform layer karena:

1. Format payload bisa banyak.
2. Broker tidak perlu tahu semua schema.
3. Validation di broker akan menambah coupling dan overhead.
4. Kafka ingin tetap generic bytes log.

Namun beberapa platform enterprise bisa menambahkan governance di layer lain, misalnya schema validation sebelum producer publish, CI pipeline, atau stream governance tools.

---

## 12. Subject, Version, Schema ID

Ini tiga konsep yang sering tertukar.

### 12.1 Subject

Subject adalah namespace logical untuk schema evolution.

Contoh subject default untuk topic `case-created` value:

```text
case-created-value
```

Untuk key:

```text
case-created-key
```

### 12.2 Version

Version adalah nomor urut schema dalam subject.

```text
Subject: case-created-value
v1 -> schema awal
v2 -> tambah priority
v3 -> tambah assignedTeam
```

### 12.3 Schema ID

Schema ID adalah identifier global untuk schema content di registry.

Satu schema content bisa punya satu ID global, walaupun direferensikan oleh beberapa subject tergantung implementasi/config.

### 12.4 Analogi

```text
Subject = branch kontrak
Version = commit ke-n dalam branch kontrak
Schema ID = object ID dari schema content
```

Hati-hati: ini hanya analogi. Jangan menyamakan dengan Git secara teknis.

---

## 13. Subject Naming Strategy

Subject naming strategy menentukan bagaimana serializer memilih subject saat mendaftarkan schema.

Ini keputusan arsitektural besar karena menentukan boundary compatibility.

### 13.1 TopicNameStrategy

Subject berdasarkan topic.

```text
<topic>-key
<topic>-value
```

Contoh:

```text
case-events-value
```

Implikasi:

```text
Semua value di topic yang sama dianggap berevolusi dalam subject yang sama.
```

Cocok jika:

1. Satu topic berisi satu event type utama.
2. Semua record value dalam topic harus mengikuti satu schema lineage.
3. Kamu ingin compatibility dijaga per topic.

Kurang cocok jika:

1. Satu topic berisi banyak event type dengan schema berbeda.
2. Event type berbeda tidak punya hubungan evolution.

### 13.2 RecordNameStrategy

Subject berdasarkan fully-qualified record name.

Contoh:

```text
com.example.enforcement.events.CaseCreated
```

Implikasi:

```text
Compatibility dicek per record type, tidak terikat topic.
```

Cocok jika:

1. Event type yang sama bisa muncul di beberapa topic.
2. Topic bisa berisi banyak event type.
3. Kamu ingin schema ownership per event type.

Risiko:

1. Topic bisa menjadi campuran event tanpa boundary jelas.
2. Consumer perlu tahu cara route multi-type record.
3. Topic-level contract menjadi lebih longgar.

### 13.3 TopicRecordNameStrategy

Subject berdasarkan kombinasi topic dan record name.

Contoh:

```text
case-events-com.example.enforcement.events.CaseCreated
```

Implikasi:

```text
Compatibility dicek per record type dalam topic tertentu.
```

Cocok jika:

1. Satu topic punya beberapa event type.
2. Event type yang sama di topic berbeda boleh berevolusi berbeda.
3. Kamu ingin boundary lebih eksplisit daripada RecordNameStrategy.

### 13.4 Rekomendasi Praktis

Untuk kebanyakan sistem enterprise yang ingin governance kuat:

```text
Default: TopicNameStrategy + satu event family/type per topic.
Advanced: TopicRecordNameStrategy jika benar-benar butuh multi-event topic.
Hati-hati: RecordNameStrategy jika governance topic belum matang.
```

Part 011 nanti akan membahas topic design lebih dalam. Untuk sekarang, prinsipnya:

```text
Subject naming strategy harus selaras dengan topic ownership dan event evolution boundary.
```

---

## 14. Compatibility Modes

Schema Registry biasanya mendukung beberapa mode compatibility.

### 14.1 BACKWARD

Schema baru bisa membaca data yang ditulis dengan schema sebelumnya.

Pertanyaan:

```text
Bisakah consumer baru membaca data lama?
```

Cocok untuk:

```text
Consumer upgrade lebih dulu
Replay data lama dengan aplikasi baru
Stream processor restore dari historical topic
```

Contoh aman Avro:

```text
Menambah field optional dengan default
```

### 14.2 FORWARD

Schema lama bisa membaca data yang ditulis dengan schema baru.

Pertanyaan:

```text
Bisakah consumer lama membaca data baru?
```

Cocok untuk:

```text
Producer upgrade lebih dulu
Consumer lama belum deploy
Loose reader yang mengabaikan field baru
```

### 14.3 FULL

Schema baru bisa membaca lama, dan schema lama bisa membaca baru.

Pertanyaan:

```text
Bisakah upgrade producer/consumer dilakukan dua arah tanpa pecah?
```

Cocok untuk:

```text
Multi-team event public
Deploy order tidak bisa dikontrol ketat
High-safety integration
```

### 14.4 TRANSITIVE Modes

Non-transitive biasanya mengecek versi baru terhadap versi terakhir.

Transitive mengecek terhadap semua versi historis.

Contoh:

```text
BACKWARD           -> v3 harus kompatibel dengan v2
BACKWARD_TRANSITIVE -> v3 harus kompatibel dengan v1 dan v2
```

Untuk long-lived Kafka topic, transitive sering lebih aman karena replay bisa membaca data dari versi sangat lama.

### 14.5 NONE

Tidak ada compatibility check.

Ini berbahaya untuk public topic. Bisa berguna hanya untuk eksperimen lokal atau topic private sementara.

### 14.6 Compatibility Decision Matrix

| Skenario | Mode yang biasanya masuk akal |
|---|---|
| Consumer baru sering replay data lama | `BACKWARD` atau `BACKWARD_TRANSITIVE` |
| Producer bisa deploy sebelum consumer | `FORWARD` atau `FULL` |
| Public enterprise event | `FULL_TRANSITIVE` jika feasible |
| Internal single-team topic | `BACKWARD` sering cukup |
| Short-lived experimental topic | `NONE` bisa diterima sementara |
| Regulatory/audit long-retention topic | `FULL_TRANSITIVE` atau minimal `BACKWARD_TRANSITIVE` |

Catatan: mode terbaik juga tergantung format schema dan cara consumer dibuat. Jangan memilih mode hanya karena terdengar paling aman; cek efeknya terhadap evolusi event.

---

## 15. Compatibility Examples

### 15.1 Menambah Optional Field

Avro v1:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "fields": [
    { "name": "caseId", "type": "string" }
  ]
}
```

Avro v2:

```json
{
  "type": "record",
  "name": "CaseCreated",
  "fields": [
    { "name": "caseId", "type": "string" },
    { "name": "priority", "type": ["null", "string"], "default": null }
  ]
}
```

Biasanya aman untuk backward compatibility.

### 15.2 Menambah Required Field Tanpa Default

Avro v2 buruk:

```json
{
  "name": "priority",
  "type": "string"
}
```

Consumer baru yang membaca data lama tidak tahu nilai `priority`. Ini breaking untuk backward compatibility.

### 15.3 Mengubah Type Field

Dari:

```json
{ "name": "priority", "type": "string" }
```

Menjadi:

```json
{ "name": "priority", "type": "int" }
```

Ini hampir selalu breaking secara contract, walaupun beberapa format punya type promotion terbatas.

### 15.4 Rename Field

Dari:

```json
{ "name": "caseId", "type": "string" }
```

Menjadi:

```json
{ "name": "id", "type": "string" }
```

Secara schema, ini sering terlihat seperti hapus field lama + tambah field baru. Consumer bisa rusak.

Di Avro, alias bisa membantu:

```json
{
  "name": "id",
  "type": "string",
  "aliases": ["caseId"]
}
```

Tetapi rename field event publik tetap harus diperlakukan sebagai perubahan besar, bukan refactor ringan.

### 15.5 Menambah Enum Value

Contoh:

```text
LOW, MEDIUM, HIGH
```

Menjadi:

```text
LOW, MEDIUM, HIGH, CRITICAL
```

Secara schema bisa terlihat aman. Secara aplikasi bisa breaking jika consumer memakai switch exhaustive tanpa default.

Java contoh buruk:

```java
switch (priority) {
    case LOW -> handleLow();
    case MEDIUM -> handleMedium();
    case HIGH -> handleHigh();
}
```

Saat `CRITICAL` muncul, consumer bisa gagal atau masuk path tak terduga.

Prinsip:

```text
Schema compatibility tidak selalu sama dengan semantic compatibility.
```

---

## 16. Schema Compatibility vs Semantic Compatibility

Compatibility registry mengecek struktur data. Ia tidak tahu business meaning.

Contoh perubahan yang mungkin schema-compatible tapi semantic-breaking:

1. Field `amount` tetap number, tapi satuan berubah dari rupiah ke cent.
2. Field `createdAt` tetap string, tapi timezone berubah dari UTC ke local time.
3. Enum `CLOSED` tetap ada, tapi maknanya berubah dari final state menjadi temporary state.
4. Field `caseId` tetap string, tapi sekarang berisi UUID internal, bukan public case number.
5. Event `CaseUpdated` tetap schema sama, tapi producer sekarang mengirimnya sebelum database commit.

Karena itu governance tidak boleh berhenti pada registry.

Perlu tambahan:

```text
Schema review
Contract documentation
Consumer impact analysis
Semantic versioning
Example payloads
Contract tests
Owner approval
Deprecation process
```

---

## 17. Event Envelope dan Schema Design

Event sering terdiri dari envelope dan payload.

### 17.1 Envelope

Envelope berisi metadata standar:

```json
{
  "eventId": "evt-123",
  "eventType": "CaseCreated",
  "eventVersion": "1.0.0",
  "occurredAt": "2026-06-19T10:15:30Z",
  "producedAt": "2026-06-19T10:15:31Z",
  "producer": "case-service",
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "tenantId": "tenant-a",
  "payload": { }
}
```

### 17.2 Payload

Payload berisi fakta domain:

```json
{
  "caseId": "CASE-001",
  "openedBy": "officer-123",
  "priority": "HIGH"
}
```

### 17.3 Envelope dalam Schema

Ada dua pendekatan:

#### Pendekatan A: Envelope per event schema

Setiap event schema mencakup metadata dan payload.

Kelebihan:

1. Sederhana untuk consumer.
2. Schema lengkap dalam satu artifact.
3. Cocok untuk Avro/Protobuf generated class.

Kekurangan:

1. Metadata berulang di semua schema.
2. Perubahan envelope berdampak ke banyak schema.

#### Pendekatan B: Header Kafka untuk metadata, value untuk payload

Metadata seperti correlation ID disimpan di Kafka headers.

Kelebihan:

1. Payload domain lebih bersih.
2. Router/middleware bisa membaca metadata tanpa decode value.
3. Cocok untuk tracing.

Kekurangan:

1. Header tidak selalu terbawa saat sink ke storage eksternal.
2. Header bisa hilang jika connector/pipeline tidak dikonfigurasi.
3. Contract tersebar antara header dan value.

#### Rekomendasi

Untuk metadata yang wajib untuk audit/replay, simpan di value juga atau pastikan header preservation teruji.

Prinsip:

```text
Jika metadata penting untuk makna event jangka panjang, jangan hanya bergantung pada transport header.
```

---

## 18. Java SerDes: Serializer dan Deserializer

Kafka Java client memakai serializer/deserializer melalui config.

Producer config:

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class.getName());
props.put("schema.registry.url", "http://localhost:8081");
```

Consumer config:

```java
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "case-projection-service");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, KafkaAvroDeserializer.class.getName());
props.put("schema.registry.url", "http://localhost:8081");
props.put("specific.avro.reader", true);
```

> Catatan: class `KafkaAvroSerializer` dan `KafkaAvroDeserializer` berasal dari Confluent serializer package, bukan dari Apache Kafka core.

### 18.1 Specific Avro Consumer

```java
ConsumerRecords<String, CaseCreated> records = consumer.poll(Duration.ofMillis(500));

for (ConsumerRecord<String, CaseCreated> record : records) {
    CaseCreated event = record.value();
    process(event);
}
```

### 18.2 Generic Avro Consumer

```java
ConsumerRecords<String, GenericRecord> records = consumer.poll(Duration.ofMillis(500));

for (ConsumerRecord<String, GenericRecord> record : records) {
    GenericRecord event = record.value();
    String caseId = event.get("caseId").toString();
}
```

### 18.3 Key Schema vs Value Schema

Key juga bisa punya schema.

Contoh key sederhana:

```text
caseId as String
```

Key kompleks:

```json
{
  "tenantId": "tenant-a",
  "caseId": "CASE-001"
}
```

Jika key kompleks, pertimbangkan schema untuk key juga, karena key adalah bagian dari contract partitioning dan compaction.

Kesalahan umum:

```text
Value schema dikelola serius, key schema dibiarkan string ad-hoc.
```

Padahal key menentukan ordering, partitioning, log compaction, join, dan state store.

---

## 19. Auto Registration: Nyaman Tapi Berisiko

Banyak serializer bisa otomatis register schema saat producer publish.

```java
props.put("auto.register.schemas", true);
```

Kelebihan:

1. Developer experience mudah.
2. Cocok untuk local development.
3. Mengurangi manual registry step.

Risiko production:

1. Schema typo bisa langsung menjadi versi resmi.
2. Producer rogue bisa mencemari subject.
3. Compatibility error muncul saat runtime publish.
4. Tidak ada review sebelum schema masuk.
5. Sulit mengontrol event contract antar tim.

Untuk production enterprise, sering lebih aman:

```java
props.put("auto.register.schemas", false);
props.put("use.latest.version", false);
```

Lalu schema diregister melalui CI/CD setelah lulus compatibility check dan review.

### Rekomendasi

| Environment | Auto register |
|---|---|
| Local development | Boleh `true` |
| Shared dev | Hati-hati, biasanya `false` lebih rapi |
| Staging | Sebaiknya `false` |
| Production | Umumnya `false` |

---

## 20. Schema Governance Workflow

Schema governance bukan birokrasi. Tujuannya menjaga deploy independence.

Workflow yang sehat:

```text
1. Developer mengubah schema di repo.
2. CI menjalankan lint schema.
3. CI menjalankan compatibility check terhadap Schema Registry staging/prod baseline.
4. CI menjalankan contract tests.
5. Reviewer memeriksa semantic compatibility.
6. Schema diregister ke registry.
7. Producer deploy dengan schema yang sudah terdaftar.
8. Consumer monitoring memastikan tidak ada deserialization failure.
```

### 20.1 Repo Layout Contoh

```text
schemas/
  enforcement/
    case-created.avsc
    case-assigned.avsc
    case-escalated.avsc
  investigation/
    evidence-submitted.avsc
```

Atau:

```text
contracts/
  topics/
    enforcement.case-events/
      value/
        CaseCreated.avsc
        CaseEscalated.avsc
      key/
        CaseKey.avsc
```

### 20.2 Schema Review Checklist

Setiap schema change harus menjawab:

```text
Apakah ini menambah, menghapus, rename, atau mengubah meaning field?
Apakah field baru punya default atau nullable strategy?
Apakah consumer lama akan tetap berjalan?
Apakah consumer baru bisa replay data lama?
Apakah enum baru bisa ditangani consumer lama?
Apakah contoh payload diperbarui?
Apakah dokumentasi semantics diperbarui?
Apakah topic owner sudah approve?
Apakah data privacy berubah?
Apakah retention/audit consequence berubah?
```

---

## 21. Compatibility Testing di CI/CD

Schema compatibility harus diuji sebelum runtime.

Pseudo command:

```bash
schema-registry-check \
  --registry-url https://schema-registry.example.com \
  --subject enforcement.case-created-value \
  --schema schemas/enforcement/case-created.avsc \
  --compatibility BACKWARD_TRANSITIVE
```

Atau via REST API:

```bash
curl -X POST \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  --data '{"schema": "...escaped schema..."}' \
  https://schema-registry.example.com/compatibility/subjects/enforcement.case-created-value/versions/latest
```

CI harus fail jika schema tidak compatible.

Tetapi jangan berhenti di compatibility API. Tambahkan test object-level.

### 21.1 Golden Event Test

Simpan contoh payload versi lama:

```text
test-fixtures/
  case-created-v1.bin
  case-created-v2.bin
  case-created-v3.bin
```

Consumer baru harus bisa membaca semua fixture yang masih didukung.

### 21.2 Consumer Contract Test

Consumer contract test memastikan consumer tidak hanya bisa deserialize, tapi juga memproses secara benar.

```java
@Test
void shouldProcessOldCaseCreatedEvent() {
    CaseCreated event = fixtureLoader.loadAvro("case-created-v1.bin");

    projectionHandler.handle(event);

    assertThat(repository.findByCaseId("CASE-001"))
        .hasStatus("OPEN");
}
```

### 21.3 Producer Contract Test

Producer contract test memastikan output producer sesuai schema dan semantics.

```java
@Test
void shouldProduceCompatibleCaseCreatedEvent() {
    CaseCreated event = mapper.toEvent(command);

    assertThat(event.getCaseId()).isNotBlank();
    assertThat(event.getEventId()).isNotBlank();
    assertThat(event.getCreatedAt()).isNotBlank();
}
```

---

## 22. Handling Deserialization Failure

Deserialization failure berbeda dari business processing failure.

### 22.1 Business Processing Failure

Consumer bisa decode event, tapi gagal memproses.

Contoh:

```text
Event valid, tetapi caseId tidak ditemukan di read model.
```

### 22.2 Deserialization Failure

Consumer bahkan tidak bisa decode bytes.

Contoh:

```text
Schema ID tidak ditemukan.
Payload bukan Avro valid.
Consumer memakai deserializer salah.
Schema incompatible.
```

Jika deserialization terjadi sebelum aplikasi menerima record, error handler biasa bisa tidak punya akses lengkap ke value object.

Spring Kafka, misalnya, punya pattern khusus untuk error deserialization. Di low-level Kafka consumer, kamu perlu desain bagaimana menangani record yang gagal decode.

### 22.3 Strategi

1. Monitor deserialization error secara eksplisit.
2. Bedakan DLQ untuk decode failure dan processing failure.
3. Simpan raw bytes bila memungkinkan untuk forensic.
4. Sertakan topic, partition, offset, timestamp, key, headers.
5. Jangan infinite retry record yang secara schema mustahil dibaca.
6. Buat runbook untuk schema ID missing atau registry outage.

DLQ record metadata minimal:

```json
{
  "sourceTopic": "enforcement.case-events",
  "sourcePartition": 3,
  "sourceOffset": 918273,
  "errorType": "DESERIALIZATION_ERROR",
  "schemaId": 1234,
  "consumerGroup": "case-projection-service",
  "observedAt": "2026-06-19T10:15:30Z"
}
```

---

## 23. Schema Registry Failure Modes

### 23.1 Registry Down Saat Producer Start

Jika producer perlu register schema atau fetch schema metadata, publish bisa gagal.

Mitigasi:

1. Disable auto-register di production.
2. Pre-register schema.
3. Warm up serializer.
4. Configure registry HA.
5. Monitor registry availability.

### 23.2 Registry Down Saat Consumer Membaca Schema ID Baru

Consumer butuh writer schema untuk schema ID yang belum ada di cache.

Mitigasi:

1. Schema Registry HA.
2. Client schema cache.
3. Avoid deploying producer with new schema during registry instability.
4. Alert jika deserializer gagal fetch schema.

### 23.3 Schema ID Deleted atau Registry Data Corrupt

Ini sangat serius. Kafka log masih punya record dengan schema ID lama, tapi registry tidak tahu schema tersebut.

Mitigasi:

1. Jangan hard delete schema sembarangan.
2. Backup registry storage.
3. Treat registry as critical metadata store.
4. Include schema export in DR planning.
5. Test restore path.

### 23.4 Wrong Subject Strategy

Producer memakai subject strategy berbeda dari consumer expectation.

Gejala:

1. Schema terdaftar di subject tak terduga.
2. Compatibility gate tidak bekerja sesuai boundary.
3. Multi-event topic kacau.

Mitigasi:

1. Standardize serializer configs.
2. Enforce config through shared library/platform template.
3. Audit subjects periodically.

### 23.5 Auto Registration Pollution

Developer menjalankan producer lokal ke shared registry dan mendaftarkan schema salah.

Mitigasi:

1. Separate local/dev/staging/prod registry.
2. Disable auto-register di shared environment.
3. ACL untuk registry subject.
4. CI-only schema registration.

---

## 24. Schema Evolution Strategy untuk Event Publik

Untuk event publik antar tim, gunakan pola conservative.

### 24.1 Safe Additive Change

Tambahkan field optional dengan default.

```json
{ "name": "assignedTeam", "type": ["null", "string"], "default": null }
```

### 24.2 Deprecate Before Remove

Jangan langsung hapus field. Tandai deprecated di dokumentasi dan schema metadata jika format mendukung.

```text
v1: field active
v2: field deprecated, field baru ditambahkan
v3: producer mengisi keduanya
v4: consumer migrasi
v5: field lama dihapus jika compatibility policy mengizinkan
```

Namun untuk Kafka long-retention topic, menghapus field sering tetap bermasalah karena historical replay.

### 24.3 Avoid Rename

Rename adalah perubahan mahal.

Lebih aman:

```text
Tambah field baru
Isi field lama dan baru sementara
Minta consumer migrasi
Deprecate field lama
```

### 24.4 Enum Evolution

Jika menambah enum value, perlakukan sebagai breaking secara semantic kecuali semua consumer punya fallback.

Consumer pattern lebih aman:

```java
switch (priority) {
    case LOW -> handleLow();
    case MEDIUM -> handleMedium();
    case HIGH -> handleHigh();
    default -> handleUnknownPriority(priority);
}
```

### 24.5 Split Event Instead of Growing Forever

Jika event menjadi terlalu besar dan field-fieldnya hanya relevan untuk subset consumer, pertimbangkan event baru.

Buruk:

```text
CaseUpdated dengan 80 optional fields
```

Lebih baik:

```text
CaseAssigned
CasePriorityChanged
CaseEscalated
CaseEvidenceAttached
CaseClosed
```

---

## 25. Schema sebagai API Antar Tim

Topic Kafka adalah API. Schema adalah interface. Event adalah contract runtime.

Jika kamu sebagai tim producer mengubah schema, kamu sedang mengubah API publik.

Pertanyaan arsitektural:

```text
Siapa owner schema?
Siapa boleh approve perubahan?
Siapa consumer penting?
Apa compatibility mode?
Berapa lama versi lama didukung?
Bagaimana deprecation diumumkan?
Bagaimana consumer menemukan contoh event?
Bagaimana consumer menguji compatibility sebelum deploy?
```

Untuk organisasi besar, schema registry perlu dilengkapi dengan event catalog:

```text
Topic name
Event type
Schema subject
Owner team
Description
Example payload
PII classification
Retention
Compatibility mode
Consumer list
SLA/SLO
Deprecation status
```

---

## 26. Schema dan Regulatory Defensibility

Dalam sistem enforcement/case management, schema bukan hanya masalah teknis.

Event bisa menjadi bukti:

```text
Kapan case dibuat
Siapa yang membuat
Kapan SLA breach terjadi
Siapa yang mengubah priority
Apa alasan escalation
Apa evidence yang diterima
Kapan keputusan dibuat
```

Schema evolution harus menjaga kemampuan merekonstruksi masa lalu.

### 26.1 Jangan Mengubah Makna Field Historis

Jika `decisionReason` dulu berarti alasan officer dan sekarang berarti alasan supervisor, jangan pakai field yang sama.

Lebih baik:

```text
officerDecisionReason
supervisorDecisionReason
```

Atau event berbeda:

```text
OfficerDecisionRecorded
SupervisorReviewCompleted
```

### 26.2 Simpan Context yang Cukup

Event audit tidak boleh terlalu thin.

Buruk:

```json
{
  "caseId": "CASE-001",
  "status": "ESCALATED"
}
```

Lebih baik:

```json
{
  "caseId": "CASE-001",
  "previousStatus": "UNDER_REVIEW",
  "newStatus": "ESCALATED",
  "reasonCode": "SLA_BREACH",
  "actorId": "officer-123",
  "occurredAt": "2026-06-19T10:15:30Z",
  "policyVersion": "enforcement-policy-2026.2"
}
```

### 26.3 Version Policy dan Policy Version

Untuk regulatory systems, schema version tidak cukup. Kamu juga sering perlu business policy version.

```json
{
  "eventVersion": "2.1.0",
  "policyVersion": "AML-CASE-POLICY-2026-06",
  "decisionRuleVersion": "RULESET-17"
}
```

Ini membantu audit menjawab:

```text
Keputusan ini dibuat berdasarkan aturan versi mana?
```

---

## 27. Anti-Patterns

### 27.1 Raw Map Event

```java
Map<String, Object> event = new HashMap<>();
event.put("whatever", payload);
```

Masalah:

1. Tidak ada contract.
2. Type tidak stabil.
3. Consumer runtime fragile.
4. Schema evolution tidak terukur.

### 27.2 Generic `data` Blob

```json
{
  "eventType": "CASE_CREATED",
  "data": "{...json string inside json...}"
}
```

Masalah:

1. Double encoding.
2. Registry tidak bisa validasi isi `data`.
3. Consumer harus parse dua kali.
4. Compatibility hilang.

### 27.3 One Topic, Many Unrelated Schemas, No Routing Contract

```text
business-events
```

Berisi:

```text
CaseCreated
UserLoggedIn
InvoicePaid
EvidenceUploaded
SystemHealthChanged
```

Masalah:

1. Consumer harus filter banyak event tidak relevan.
2. Retention dan ACL tidak cocok untuk semua.
3. Compatibility boundary kacau.
4. Ownership tidak jelas.

### 27.4 Schema Registry as Runtime Crutch

Mengandalkan auto-register dan latest schema di runtime tanpa CI validation.

Masalah:

1. Error muncul saat production traffic.
2. Deploy order tidak terkendali.
3. Schema pollution.

### 27.5 Generated Event Class Jadi Domain Entity

```java
// buruk: domain logic bergantung langsung ke generated Avro class
public void approve(CaseCreated event) { ... }
```

Masalah:

1. Wire contract bocor ke domain model.
2. Schema evolution memaksa refactor domain.
3. Testing domain menjadi tergantung serialization artifact.

Lebih baik:

```text
Generated event DTO -> mapper -> domain command/model
```

### 27.6 Breaking Enum Semantics Diam-Diam

Menambah enum value tanpa consumer fallback.

Masalah:

1. Consumer lama gagal.
2. Projection tidak lengkap.
3. Alert baru muncul setelah traffic real.

### 27.7 Menghapus Schema Lama Karena “Sudah Tidak Dipakai”

Kafka masih bisa menyimpan record lama yang butuh schema lama untuk replay.

Masalah:

1. Historical replay gagal.
2. Audit reconstruction gagal.
3. Disaster recovery gagal.

---

## 28. Production Configuration Notes

Contoh konfigurasi producer Avro production-oriented:

```java
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class.getName());
props.put("schema.registry.url", schemaRegistryUrl);

// Governance-oriented production defaults
props.put("auto.register.schemas", false);
props.put("use.latest.version", false);
props.put("latest.compatibility.strict", true);
```

Contoh consumer:

```java
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, KafkaAvroDeserializer.class.getName());
props.put("schema.registry.url", schemaRegistryUrl);
props.put("specific.avro.reader", true);
```

Catatan:

1. Nama config spesifik bisa bergantung library/version.
2. Jangan copy config tanpa memverifikasi dokumentasi library yang dipakai.
3. Standardisasi melalui shared platform library membantu mencegah drift.

---

## 29. Design Trade-Offs

### 29.1 Strict Schema vs Agility

Strict schema memberi safety, tetapi memperlambat perubahan.

Loose schema memberi agility, tetapi memindahkan risiko ke runtime.

Untuk enterprise Kafka, biasanya trade-off yang benar adalah:

```text
Strict enough to protect consumers.
Flexible enough to allow additive evolution.
Governed enough to avoid runtime surprises.
```

### 29.2 One Event Type per Topic vs Multi-Type Topic

One event type per topic:

Kelebihan:

1. Subject strategy sederhana.
2. Consumer sederhana.
3. Compatibility jelas.
4. ACL/retention lebih presisi.

Kekurangan:

1. Topic lebih banyak.
2. Operational catalog lebih ramai.

Multi-type topic:

Kelebihan:

1. Topic lebih sedikit.
2. Event related bisa berada di satu stream.
3. Cocok untuk event family tertentu.

Kekurangan:

1. Routing lebih kompleks.
2. Subject naming lebih penting.
3. Consumer harus filter.
4. Governance lebih sulit.

### 29.3 Avro vs Protobuf in Java

Avro terasa natural untuk Kafka data pipeline. Protobuf terasa natural untuk API/gRPC-heavy organization.

Jika organisasi Java-microservice banyak memakai gRPC, Protobuf bisa mengurangi format fragmentation. Jika organisasi data platform heavily Kafka/lake/warehouse, Avro sering lebih sederhana.

Yang lebih penting daripada format:

```text
Ada schema registry.
Ada compatibility policy.
Ada CI check.
Ada event ownership.
Ada semantic review.
```

---

## 30. Failure Modelling

### Scenario 1: Producer Menambah Required Field

Timeline:

```text
T1: Producer deploy schema v2 dengan required field baru.
T2: Registry menolak karena backward incompatible.
T3: Producer gagal publish.
```

Jika auto-registration dan compatibility dimatikan:

```text
T1: Producer publish event baru.
T2: Consumer lama gagal deserialize atau process.
T3: Lag naik.
T4: DLQ penuh.
T5: Incident menyebar ke downstream projection.
```

Invariant:

```text
Public event tidak boleh berubah tanpa compatibility gate.
```

### Scenario 2: Registry Down

Timeline:

```text
T1: Consumer restart.
T2: Consumer membaca record dengan schema ID yang belum ada di cache.
T3: Consumer gagal fetch schema.
T4: Consumer tidak bisa progress.
T5: Lag naik.
```

Mitigasi:

```text
Registry HA
Client cache
Avoid unnecessary restarts during registry incident
Alert on schema registry latency/error
```

### Scenario 3: Enum Baru Menyebabkan Consumer Logic Error

Schema compatibility lolos. Consumer lama deserialize sukses. Tapi business logic tidak mengenali enum baru.

Invariant:

```text
Compatibility check harus dilengkapi semantic contract test.
```

### Scenario 4: Schema Lama Dihapus

Timeline:

```text
T1: Tim menghapus schema lama dari registry.
T2: Kafka masih menyimpan record lama.
T3: Audit replay membaca offset lama.
T4: Deserializer gagal karena schema ID hilang.
```

Invariant:

```text
Schema history harus hidup selama data Kafka yang mereferensikannya masih mungkin dibaca.
```

---

## 31. Java Engineer Perspective

Sebagai Java engineer, jangan hanya fokus pada annotation atau serializer config.

Hal yang harus kamu kuasai:

1. Generated class bukan domain model.
2. Deserialization error bisa terjadi sebelum handler dipanggil.
3. Consumer harus resilient terhadap unknown enum dan optional field.
4. Producer harus punya contract test.
5. Schema artifact harus versioned.
6. CI harus cek compatibility.
7. Testcontainers bisa dipakai untuk Kafka + Schema Registry integration test.
8. SerDes harus distandardisasi agar service tidak punya config drift.
9. Event mapper harus eksplisit, bukan reflection magic.
10. Schema change adalah API change.

### 31.1 Layering yang Sehat

```text
Domain Model
    ↑↓ mapper
Event Contract DTO / Generated Avro-Protobuf Class
    ↑↓ serializer
Kafka Bytes
```

Jangan:

```text
Domain Model = Generated Avro Class = Database Entity = API DTO
```

Itu coupling berlebihan.

### 31.2 Mapping Explicit

```java
public final class CaseEventMapper {

    public CaseCreated toEvent(CaseOpened domainEvent) {
        return CaseCreated.newBuilder()
            .setEventId(domainEvent.eventId().toString())
            .setCaseId(domainEvent.caseId().value())
            .setCreatedAt(domainEvent.occurredAt().toString())
            .setPriority(domainEvent.priority().name())
            .build();
    }
}
```

Keuntungan:

1. Mapping semantics terlihat.
2. Field baru dipikirkan sadar.
3. Test mudah.
4. Domain tidak tergantung wire format.

---

## 32. Checklist Schema Design

Sebelum membuat schema baru:

```text
[ ] Event name merepresentasikan fakta domain, bukan CRUD generic.
[ ] Topic owner jelas.
[ ] Subject naming strategy jelas.
[ ] Key schema jelas.
[ ] Value schema jelas.
[ ] Required vs optional field dipikirkan.
[ ] Default value dipikirkan.
[ ] Timestamp semantics jelas.
[ ] Correlation/causation metadata tersedia.
[ ] Field PII/secret tidak bocor.
[ ] Enum evolution dipikirkan.
[ ] Example payload tersedia.
[ ] Compatibility mode dipilih.
[ ] Consumer utama diketahui.
[ ] Replay requirement diketahui.
[ ] Retention selaras dengan schema history.
```

Sebelum mengubah schema:

```text
[ ] Compatibility check lulus.
[ ] Semantic compatibility direview.
[ ] Field baru additive atau migration plan jelas.
[ ] Rename dihindari atau diberi migration plan.
[ ] Enum baru punya consumer fallback.
[ ] Generated code diperbarui.
[ ] Contract tests diperbarui.
[ ] Example payload diperbarui.
[ ] Consumer impact dikomunikasikan.
[ ] Rollback plan jelas.
```

---

## 33. Thought Exercises

### Exercise 1 — Required Field

Kamu punya event:

```json
{
  "caseId": "CASE-001",
  "createdAt": "2026-06-19T10:15:30Z"
}
```

Tim ingin menambah `priority` sebagai required field.

Pertanyaan:

1. Apakah ini backward compatible?
2. Bagaimana consumer baru membaca event lama?
3. Alternatif desain apa yang lebih aman?

Jawaban yang diharapkan:

```text
Tidak aman jika field required tanpa default.
Lebih aman menjadikan priority optional/default null atau default UNKNOWN.
Namun default UNKNOWN harus punya semantics jelas.
```

### Exercise 2 — Enum Baru

Event `CaseEscalated` punya enum:

```text
SLA_BREACH
MANUAL_REVIEW
```

Tim ingin menambah:

```text
AI_RISK_SCORE
```

Pertanyaan:

1. Apakah registry pasti menolak?
2. Apakah consumer lama pasti aman?
3. Apa yang harus dicek?

Jawaban:

```text
Registry mungkin menerima tergantung format dan compatibility.
Consumer lama belum tentu aman.
Cek switch handling, default branch, metrics, alerting, dan semantic documentation.
```

### Exercise 3 — Multi-Event Topic

Topic `case-events` berisi:

```text
CaseCreated
CaseAssigned
CaseEscalated
CaseClosed
```

Pertanyaan:

1. Subject naming strategy apa yang cocok?
2. Apa konsekuensi consumer?
3. Kapan desain ini masuk akal?

Jawaban:

```text
TopicRecordNameStrategy sering lebih cocok daripada TopicNameStrategy.
Consumer perlu routing berdasarkan event type/schema.
Masuk akal jika semua event berada dalam event family yang sama, owner sama, retention sama, ACL sama, dan consumer memang butuh stream lifecycle case.
```

### Exercise 4 — Regulatory Replay

Audit perlu replay event dari 3 tahun lalu. Schema lama sudah dihapus dari registry.

Pertanyaan:

1. Apa yang terjadi?
2. Apa root cause?
3. Apa invariant yang harus dibuat?

Jawaban:

```text
Deserializer bisa gagal membaca record lama.
Root cause: schema lifecycle tidak diselaraskan dengan data retention dan audit replay.
Invariant: schema yang direferensikan data retained tidak boleh hilang dari registry/backup.
```

---

## 34. Ringkasan

Serialization di Kafka bukan detail kecil. Ia adalah fondasi contract antar producer dan consumer.

Poin utama:

1. Kafka menyimpan bytes, bukan object bermakna.
2. Serializer/deserializer menentukan bagaimana object menjadi bytes dan kembali lagi.
3. Schema mendefinisikan struktur, tetapi contract mencakup makna.
4. Raw JSON mudah, tetapi berbahaya untuk event publik jangka panjang tanpa schema governance.
5. Avro kuat untuk Kafka/data pipeline dan schema evolution.
6. Protobuf kuat untuk cross-language/generated contract, tapi field number harus dijaga.
7. JSON Schema cocok jika ingin JSON-readable dengan validation formal.
8. Schema Registry menyimpan schema versions dan mengecek compatibility.
9. Subject naming strategy menentukan boundary evolution.
10. Compatibility mode harus dipilih berdasarkan deploy order, replay, dan ownership.
11. Schema compatibility tidak menjamin semantic compatibility.
12. CI/CD harus menjalankan schema compatibility check dan contract tests.
13. Schema history harus diperlakukan sebagai metadata kritis, terutama untuk replay dan audit.
14. Dalam Java, pisahkan domain model dari generated event DTO.
15. Schema change adalah API change.

Mental model akhir:

```text
Event streaming maturity = durable log + stable schema + semantic contract + compatibility governance + operational discipline.
```

---

## 35. Referensi Utama

Referensi yang relevan untuk part ini:

1. Apache Kafka Documentation — core concepts, producer/consumer, serializers/deserializers, Kafka Streams SerDes.
   - https://kafka.apache.org/documentation/
   - https://kafka.apache.org/41/streams/developer-guide/datatypes/
2. Confluent Schema Registry Documentation — registry overview, schema formats, compatibility, serializers/deserializers.
   - https://docs.confluent.io/platform/current/schema-registry/index.html
   - https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
   - https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html
   - https://docs.confluent.io/platform/current/schema-registry/develop/api.html
3. Confluent Producer Configuration Reference — serializer configuration.
   - https://docs.confluent.io/platform/current/installation/configuration/producer-configs.html
4. Confluent Developer — Schema subjects and subject naming strategy.
   - https://developer.confluent.io/courses/schema-registry/schema-subjects/
5. Apache Avro Specification.
   - https://avro.apache.org/docs/
6. Protocol Buffers Documentation.
   - https://protobuf.dev/
7. JSON Schema Documentation.
   - https://json-schema.org/

---

## 36. Status Seri

Part ini adalah bagian ke-10 dari total 35 bagian:

```text
Selesai: Part 000 sampai Part 010
Berikutnya: Part 011 — Topic Design and Governance: Naming, Retention, Compaction, ACL, Ownership
Status seri: belum selesai
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Event Design: Facts, Commands, State Changes, and Domain Events</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-011.md">Part 011 — Topic Design and Governance: Naming, Retention, Compaction, ACL, Ownership ➡️</a>
</div>
