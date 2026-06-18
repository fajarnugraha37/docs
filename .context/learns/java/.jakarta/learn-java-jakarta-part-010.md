# learn-java-jakarta-part-010.md

# Bagian 10 — Jakarta JSON Processing: `jakarta.json` / JSON-P

> Target pembaca: Java engineer yang ingin memahami JSON Processing di Jakarta EE secara mendalam, bukan hanya “bisa parse JSON”, tetapi paham kapan memakai object model, kapan streaming model, bagaimana membuat JSON secara immutable dan aman, bagaimana memproses payload besar, bagaimana menerapkan JSON Pointer/Patch/Merge Patch, bagaimana menghindari memory/performance trap, dan bagaimana JSON-P berhubungan dengan JSON-B, JAX-RS, Jackson, MicroProfile, dan arsitektur production.
>
> Fokus bagian ini: `jakarta.json` sebagai **low-level JSON processing API** standar Jakarta: parsing, generating, transforming, querying, patching, pointer, object model, streaming model, provider, factories, memory/performance trade-off, dan use case production.

---

## Daftar Isi

1. [Orientasi: Apa Itu Jakarta JSON Processing / JSON-P?](#1-orientasi-apa-itu-jakarta-json-processing--json-p)
2. [Mental Model: JSON-P vs JSON-B vs Jackson](#2-mental-model-json-p-vs-json-b-vs-jackson)
3. [Jakarta JSON Processing 2.1 dan Jakarta EE Modern](#3-jakarta-json-processing-21-dan-jakarta-ee-modern)
4. [Dependency, API, Implementation, dan Runtime](#4-dependency-api-implementation-dan-runtime)
5. [Peta Package: `jakarta.json`, `jakarta.json.stream`, `jakarta.json.spi`](#5-peta-package-jakartajson-jakartajsonstream-jakartajsonspi)
6. [Dua Model Utama: Object Model dan Streaming Model](#6-dua-model-utama-object-model-dan-streaming-model)
7. [Object Model: `JsonObject`, `JsonArray`, `JsonValue`](#7-object-model-jsonobject-jsonarray-jsonvalue)
8. [Membuat JSON dengan Builder API](#8-membuat-json-dengan-builder-api)
9. [Membaca JSON dengan `JsonReader`](#9-membaca-json-dengan-jsonreader)
10. [Menulis JSON dengan `JsonWriter`](#10-menulis-json-dengan-jsonwriter)
11. [Streaming Parsing dengan `JsonParser`](#11-streaming-parsing-dengan-jsonparser)
12. [Streaming Generation dengan `JsonGenerator`](#12-streaming-generation-dengan-jsongenerator)
13. [Factories: Reuse, Configuration, dan Performance](#13-factories-reuse-configuration-dan-performance)
14. [JsonProvider dan Service Provider Model](#14-jsonprovider-dan-service-provider-model)
15. [JSON Pointer: Navigasi Struktur JSON](#15-json-pointer-navigasi-struktur-json)
16. [JSON Patch: Operasi Perubahan Berbasis RFC 6902](#16-json-patch-operasi-perubahan-berbasis-rfc-6902)
17. [JSON Merge Patch: Partial Update Semantics](#17-json-merge-patch-partial-update-semantics)
18. [Transformasi JSON Tanpa Binding ke DTO](#18-transformasi-json-tanpa-binding-ke-dto)
19. [Validasi Manual dan Defensive Parsing](#19-validasi-manual-dan-defensive-parsing)
20. [Large Payload Handling](#20-large-payload-handling)
21. [Error Handling dan Exception Strategy](#21-error-handling-dan-exception-strategy)
22. [Security: JSON Bomb, Large Payload, PII, dan Injection](#22-security-json-bomb-large-payload-pii-dan-injection)
23. [JSON-P dalam Jakarta REST](#23-json-p-dalam-jakarta-rest)
24. [JSON-P dan JSON-B: Kerja Sama Object Model dan Binding](#24-json-p-dan-json-b-kerja-sama-object-model-dan-binding)
25. [JSON-P vs Jackson Tree/Streaming API](#25-json-p-vs-jackson-treestreaming-api)
26. [Production Use Cases](#26-production-use-cases)
27. [Performance Engineering](#27-performance-engineering)
28. [Testing Strategy](#28-testing-strategy)
29. [Observability dan Debugging](#29-observability-dan-debugging)
30. [Common Failure Modes](#30-common-failure-modes)
31. [Best Practices dan Anti-Patterns](#31-best-practices-dan-anti-patterns)
32. [Checklist Review](#32-checklist-review)
33. [Latihan Bertahap](#33-latihan-bertahap)
34. [Mini Project: JSON-P Payload Gateway Lab](#34-mini-project-json-p-payload-gateway-lab)
35. [Referensi Resmi](#35-referensi-resmi)

---

# 1. Orientasi: Apa Itu Jakarta JSON Processing / JSON-P?

Jakarta JSON Processing, sering disebut **JSON-P**, adalah API standar Jakarta untuk:

- parse JSON;
- generate JSON;
- transform JSON;
- query JSON;
- build JSON object model;
- stream JSON input/output;
- apply JSON Pointer;
- apply JSON Patch;
- apply JSON Merge Patch.

Jika JSON-B adalah “binding Java object ↔ JSON”, maka JSON-P adalah “manipulasi JSON secara langsung”.

Contoh JSON-B:

```java
CaseDto dto = jsonb.fromJson(jsonString, CaseDto.class);
String json = jsonb.toJson(dto);
```

Contoh JSON-P:

```java
JsonObject json = Json.createObjectBuilder()
    .add("caseId", "CASE-001")
    .add("status", "OPEN")
    .add("priority", 3)
    .build();
```

JSON-P tidak membutuhkan class DTO. Kamu bekerja langsung dengan struktur JSON.

## 1.1 Kenapa perlu JSON-P kalau sudah ada JSON-B/Jackson?

Karena tidak semua JSON cocok dibinding ke object.

Contoh:

1. Payload sangat besar.
2. Struktur dinamis.
3. Field tidak dikenal di compile-time.
4. Gateway hanya perlu mengambil beberapa field.
5. Partial update dengan JSON Patch.
6. Transformasi payload antar sistem.
7. Audit raw JSON.
8. Validasi envelope sebelum binding.
9. Streaming array besar.
10. Menghindari alokasi object graph besar.

Contoh payload besar:

```json
{
  "batchId": "BATCH-2026-001",
  "items": [
    { "caseId": "C-1", "status": "OPEN" },
    { "caseId": "C-2", "status": "CLOSED" }
  ]
}
```

Jika `items` berisi 5 juta entry, binding seluruh payload ke `List<ItemDto>` bisa memakan memory besar.

Streaming JSON-P bisa membaca item satu per satu.

## 1.2 JSON-P adalah low-level API

Low-level bukan berarti buruk. Low-level berarti kamu punya kontrol lebih besar.

Dengan JSON-P kamu bisa:

- membaca event streaming;
- membangun JSON immutable;
- transform tanpa DTO;
- patch object;
- query pointer;
- mengontrol memory;
- menghindari binding ambiguity;
- menangani unknown fields;
- membuat gateway payload filter;
- membuat canonical JSON subset untuk signing/hashing.

## 1.3 Kapan JSON-P ideal?

Gunakan JSON-P jika kamu perlu:

- manipulasi JSON generik;
- payload dinamis;
- streaming large JSON;
- JSON Patch/Merge Patch;
- low-level transformation;
- partial field extraction;
- provider-neutral Jakarta API;
- runtime Jakarta EE standard.

## 1.4 Kapan JSON-P bukan pilihan utama?

Jangan memaksakan JSON-P jika:

- payload stabil dan punya DTO jelas;
- kamu butuh binding object biasa;
- business logic lebih jelas di typed object;
- validation memakai Bean Validation pada DTO;
- team lebih produktif dengan JSON-B/Jackson binding.

Untuk API biasa:

```text
Request JSON → DTO → Validation → Use Case
```

JSON-B/Jackson biasanya lebih ergonomis.

Untuk payload gateway/patch/streaming:

```text
Raw JSON → JSON-P → extract/transform/patch/stream
```

JSON-P lebih tepat.

---

# 2. Mental Model: JSON-P vs JSON-B vs Jackson

## 2.1 JSON-P

JSON-P bekerja pada JSON structure.

```text
JSON text
  ↔ JsonObject / JsonArray / JsonValue
  ↔ streaming events
```

Ia tidak otomatis memahami domain class kamu.

## 2.2 JSON-B

JSON-B bekerja pada Java object binding.

```text
JSON text
  ↔ Java object / record / DTO
```

Ia cocok untuk typed API.

## 2.3 Jackson

Jackson adalah library populer dengan banyak model:

- data binding;
- tree model (`JsonNode`);
- streaming parser/generator;
- annotations;
- modules;
- polymorphism;
- custom serializers;
- ecosystem besar.

Jackson bukan Jakarta specification, tetapi sering dipakai di Spring dan beberapa Jakarta runtime/framework.

## 2.4 Analogi

```text
JSON-P Object Model = DOM untuk JSON
JSON-P Streaming = StAX/SAX-like event stream untuk JSON
JSON-B = object mapper standar Jakarta
Jackson = full-featured JSON ecosystem library
```

## 2.5 Decision table

| Use case | JSON-P | JSON-B | Jackson |
|---|---:|---:|---:|
| Typed REST DTO | possible but verbose | good | excellent |
| Dynamic JSON | good | weak | good |
| Large streaming array | excellent | weak | excellent |
| JSON Patch | standard support | no direct | library support |
| Provider-neutral Jakarta | excellent | excellent | no |
| Advanced polymorphic binding | weak | limited | strong |
| Simple object mapping | verbose | good | strong |
| Partial field extraction | good | awkward | good |
| Low allocation streaming | good | not ideal | good |
| Jakarta EE portability | strong | strong | runtime dependent |

## 2.6 Top-tier principle

Jangan memilih API berdasarkan popularitas saja.

Pilih berdasarkan shape data dan failure mode:

```text
Stable schema + DTO → JSON-B/Jackson
Dynamic payload → JSON-P object model
Huge payload → JSON-P streaming
Partial update → JSON Patch/Merge Patch
Complex custom binding → Jackson or custom JSON-B adapter
```

---

# 3. Jakarta JSON Processing 2.1 dan Jakarta EE Modern

Jakarta JSON Processing 2.1 adalah release untuk Jakarta EE 10 dan tetap menjadi JSON-P versi relevan di Jakarta EE 11 API set.

## 3.1 Apa yang didefinisikan?

Jakarta JSON Processing mendefinisikan Java framework untuk parsing, generating, transforming, dan querying JSON documents.

## 3.2 API utama

- object model API;
- streaming API;
- pointer;
- patch;
- merge patch;
- builders;
- readers/writers;
- providers/factories.

## 3.3 Jakarta JSON Processing 2.2

Halaman resmi Jakarta mencatat Jakarta JSON Processing 2.2 under development untuk Jakarta EE 12.

Untuk production Jakarta EE 11, gunakan versi sesuai platform/runtime target.

## 3.4 Java baseline

Jakarta JSON Processing 2.1 release project notes menyebut requires Java SE 11 or newer aligned with Jakarta EE 10. Namun Jakarta EE 11 profile/platform baseline lebih tinggi secara platform, misalnya Java SE 17 atau lebih tinggi untuk Web/Core Profile 11.

Praktisnya:

```text
If targeting Jakarta EE 11, follow Jakarta EE 11 runtime Java baseline.
```

## 3.5 Implementation

API jar tidak cukup. Perlu implementation.

Dalam Jakarta EE runtime, implementation biasanya disediakan runtime.

Untuk standalone, kamu perlu API + implementation seperti Eclipse Parsson atau provider lain yang kompatibel.

---

# 4. Dependency, API, Implementation, dan Runtime

## 4.1 Maven API dependency

Individual API:

```xml
<dependency>
  <groupId>jakarta.json</groupId>
  <artifactId>jakarta.json-api</artifactId>
  <version>2.1.1</version>
</dependency>
```

## 4.2 Dalam Jakarta EE runtime

Biasanya tercakup via Platform/Web/Core API sesuai profile.

Contoh:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 4.3 API jar bukan implementation

`jakarta.json-api` berisi interfaces/classes API.

Provider implementation melakukan kerja actual.

Jika standalone:

```xml
<dependency>
  <groupId>jakarta.json</groupId>
  <artifactId>jakarta.json-api</artifactId>
  <version>2.1.1</version>
</dependency>
<dependency>
  <groupId>org.eclipse.parsson</groupId>
  <artifactId>parsson</artifactId>
  <version>...</version>
</dependency>
```

Version harus dicek sesuai provider/runtime.

## 4.4 Scope dalam WAR

Jika deploy ke Jakarta EE runtime yang menyediakan JSON-P:

```xml
<scope>provided</scope>
```

untuk aggregate API.

Jangan package API/provider berbeda tanpa alasan karena bisa conflict.

## 4.5 Runtime feature

Beberapa runtime modular perlu feature/module JSON-P diaktifkan.

Contoh model:

```text
enable jsonp-2.1 feature
```

atau runtime otomatis menyertakan sesuai profile.

## 4.6 Dependency mistake

Kesalahan umum:

- hanya menambahkan API jar di standalone app;
- menambahkan provider berbeda dari runtime;
- mixing `javax.json` dan `jakarta.json`;
- memakai JSON-P 2.1 API dengan runtime lama;
- menganggap JSON-P sama dengan JSON-B;
- binding DTO manual terlalu verbose padahal JSON-B cukup.

---

# 5. Peta Package: `jakarta.json`, `jakarta.json.stream`, `jakarta.json.spi`

## 5.1 `jakarta.json`

Package utama object model dan utility.

Berisi:

- `Json`;
- `JsonObject`;
- `JsonArray`;
- `JsonValue`;
- `JsonNumber`;
- `JsonString`;
- `JsonReader`;
- `JsonWriter`;
- `JsonObjectBuilder`;
- `JsonArrayBuilder`;
- `JsonBuilderFactory`;
- `JsonReaderFactory`;
- `JsonWriterFactory`;
- `JsonPointer`;
- `JsonPatch`;
- `JsonPatchBuilder`;
- `JsonMergePatch`;
- `JsonException`.

## 5.2 `jakarta.json.stream`

Streaming API.

Berisi:

- `JsonParser`;
- `JsonParserFactory`;
- `JsonGenerator`;
- `JsonGeneratorFactory`;
- `JsonParsingException`;
- `JsonGenerationException`.

Streaming API dipakai untuk membaca/menulis JSON secara event-based.

## 5.3 `jakarta.json.spi`

Service Provider Interface.

Berisi:

- `JsonProvider`.

Provider membuat object seperti reader, writer, parser, generator, builder.

## 5.4 Mental map

```text
jakarta.json
  object model + builders + readers/writers + pointer/patch

jakarta.json.stream
  streaming parser/generator

jakarta.json.spi
  provider abstraction
```

---

# 6. Dua Model Utama: Object Model dan Streaming Model

Jakarta JSON Processing punya dua programming model utama:

1. Object model.
2. Streaming model.

## 6.1 Object model

Object model membaca JSON menjadi tree immutable:

```text
JSON text
  ↓
JsonObject / JsonArray / JsonValue tree
```

Contoh:

```java
JsonObject obj = Json.createReader(inputStream).readObject();
String caseId = obj.getString("caseId");
```

Kelebihan:

- mudah dinavigasi;
- mudah dimodifikasi via builders;
- cocok untuk payload kecil/sedang;
- cocok untuk pointer/patch;
- readable.

Kekurangan:

- seluruh JSON dimuat ke memory;
- payload besar berisiko OOM;
- object overhead.

## 6.2 Streaming model

Streaming model membaca event satu per satu:

```text
START_OBJECT
KEY_NAME
VALUE_STRING
START_ARRAY
...
END_OBJECT
```

Contoh:

```java
JsonParser parser = Json.createParser(inputStream);
while (parser.hasNext()) {
    JsonParser.Event event = parser.next();
    ...
}
```

Kelebihan:

- memory rendah;
- cocok payload sangat besar;
- bisa process item-by-item;
- bisa stop early setelah field ditemukan.

Kekurangan:

- code lebih kompleks;
- harus mengelola state machine;
- raw event-level;
- transform lebih manual.

## 6.3 Pilih model berdasarkan ukuran dan akses pattern

| Situation | Model |
|---|---|
| JSON kecil/sedang | Object model |
| Need random access | Object model |
| Need patch/pointer | Object model |
| Large array | Streaming |
| Need first few fields only | Streaming |
| Gateway pass-through transform | Streaming |
| Build response JSON | Builder/object model or generator |
| Low memory requirement | Streaming |

## 6.4 Hybrid model

Kamu bisa streaming outer array lalu parse setiap item kecil sebagai object.

Pattern:

```text
stream large array
  for each item object:
    build/process one JsonObject
    discard
```

Ini memberi balance antara memory dan ergonomics.

---

# 7. Object Model: `JsonObject`, `JsonArray`, `JsonValue`

## 7.1 `JsonValue`

Root type untuk JSON value.

JSON values:

- object;
- array;
- string;
- number;
- true;
- false;
- null.

In JSON-P:

```java
JsonValue value;
```

Bisa dicek:

```java
value.getValueType()
```

## 7.2 `JsonObject`

Represents JSON object.

```json
{
  "caseId": "CASE-001",
  "status": "OPEN"
}
```

Code:

```java
JsonObject obj = Json.createObjectBuilder()
    .add("caseId", "CASE-001")
    .add("status", "OPEN")
    .build();
```

Read:

```java
String caseId = obj.getString("caseId");
```

## 7.3 `JsonArray`

Represents JSON array.

```java
JsonArray arr = Json.createArrayBuilder()
    .add("OPEN")
    .add("CLOSED")
    .build();
```

Read:

```java
for (JsonValue value : arr) {
    ...
}
```

## 7.4 Immutability

JSON-P object model values are immutable after build/read.

This is good:

- thread safety for read-only use;
- predictable structure;
- no accidental mutation;
- easier sharing.

To “modify”, create builder from existing object or patch.

## 7.5 Null handling

JSON has explicit null:

```json
{ "middleName": null }
```

JSON-P has `JsonValue.NULL`.

Differentiate:

```text
field missing
field present with JSON null
field present with empty string
```

Example:

```java
boolean hasMiddleName = obj.containsKey("middleName");
JsonValue middle = obj.get("middleName");
```

## 7.6 Type-safe access

Use correct getters:

```java
obj.getString("caseId");
obj.getInt("priority");
obj.getJsonArray("items");
obj.getJsonObject("metadata");
```

Potential errors if type mismatch or missing.

Use defensive checks for untrusted input.

## 7.7 Number handling

JSON numbers can be integer/decimal/big.

Use:

```java
JsonNumber n = obj.getJsonNumber("amount");
BigDecimal amount = n.bigDecimalValue();
```

Avoid converting money to `double`.

## 7.8 Example defensive read

```java
static String requiredString(JsonObject obj, String name) {
    JsonValue v = obj.get(name);
    if (v == null || v.getValueType() == JsonValue.ValueType.NULL) {
        throw new BadRequestException("Missing required field: " + name);
    }
    if (!(v instanceof JsonString s)) {
        throw new BadRequestException("Field must be string: " + name);
    }
    return s.getString();
}
```

---

# 8. Membuat JSON dengan Builder API

## 8.1 Object builder

```java
JsonObject response = Json.createObjectBuilder()
    .add("caseId", "CASE-001")
    .add("status", "OPEN")
    .add("priority", 3)
    .add("active", true)
    .build();
```

## 8.2 Nested object

```java
JsonObject response = Json.createObjectBuilder()
    .add("caseId", "CASE-001")
    .add("assignedOfficer", Json.createObjectBuilder()
        .add("id", "OFF-007")
        .add("name", "Alice"))
    .build();
```

## 8.3 Array builder

```java
JsonArray statuses = Json.createArrayBuilder()
    .add("OPEN")
    .add("IN_PROGRESS")
    .add("CLOSED")
    .build();
```

## 8.4 Nested array

```java
JsonObject response = Json.createObjectBuilder()
    .add("caseId", "CASE-001")
    .add("documents", Json.createArrayBuilder()
        .add(Json.createObjectBuilder()
            .add("documentId", "DOC-1")
            .add("type", "PDF"))
        .add(Json.createObjectBuilder()
            .add("documentId", "DOC-2")
            .add("type", "IMAGE")))
    .build();
```

## 8.5 BigDecimal

```java
JsonObject money = Json.createObjectBuilder()
    .add("amount", new BigDecimal("123.45"))
    .add("currency", "SGD")
    .build();
```

## 8.6 Null

```java
JsonObject obj = Json.createObjectBuilder()
    .add("middleName", JsonValue.NULL)
    .build();
```

Do not confuse with not adding the field.

## 8.7 Builder as transformation

```java
JsonObject sanitized = Json.createObjectBuilder(original)
    .remove("secretToken")
    .add("maskedEmail", mask(original.getString("email")))
    .build();
```

## 8.8 Builder factory

For repeated creation, use `JsonBuilderFactory`:

```java
JsonBuilderFactory factory = Json.createBuilderFactory(Map.of());

JsonObject obj = factory.createObjectBuilder()
    .add("caseId", "CASE-001")
    .build();
```

Factories can be reused and configured.

---

# 9. Membaca JSON dengan `JsonReader`

`JsonReader` reads a JSON object or array structure from input source.

## 9.1 Read object

```java
try (JsonReader reader = Json.createReader(inputStream)) {
    JsonObject obj = reader.readObject();
}
```

## 9.2 Read array

```java
try (JsonReader reader = Json.createReader(inputStream)) {
    JsonArray arr = reader.readArray();
}
```

## 9.3 Read generic value

```java
try (JsonReader reader = Json.createReader(inputStream)) {
    JsonValue value = reader.readValue();
}
```

## 9.4 Always close reader

`JsonReader` extends `Closeable`.

Use try-with-resources.

## 9.5 InputStream vs Reader

Use InputStream for bytes, Reader for chars.

For HTTP payload, InputStream is common.

Ensure encoding expectations align. JSON is usually UTF-8 in modern APIs.

## 9.6 Defensive read

Set upstream request size limit before reading object model.

Do not read unbounded body into memory.

## 9.7 Reader factory

```java
JsonReaderFactory readerFactory = Json.createReaderFactory(Map.of());

try (JsonReader reader = readerFactory.createReader(inputStream)) {
    JsonObject obj = reader.readObject();
}
```

Useful for reuse/config.

---

# 10. Menulis JSON dengan `JsonWriter`

`JsonWriter` writes object model values to output source.

## 10.1 Write object

```java
try (JsonWriter writer = Json.createWriter(outputStream)) {
    writer.writeObject(response);
}
```

## 10.2 Write array

```java
try (JsonWriter writer = Json.createWriter(outputStream)) {
    writer.writeArray(array);
}
```

## 10.3 Write value

```java
try (JsonWriter writer = Json.createWriter(outputStream)) {
    writer.write(value);
}
```

## 10.4 Pretty printing

Provider may support config like pretty printing.

Example concept:

```java
Map<String, Object> config = Map.of(JsonGenerator.PRETTY_PRINTING, true);
JsonWriterFactory factory = Json.createWriterFactory(config);
```

Use pretty printing for logs/dev, not high-throughput responses unless acceptable.

## 10.5 Writer factory

Reuse factory:

```java
JsonWriterFactory factory = Json.createWriterFactory(Map.of());

try (JsonWriter writer = factory.createWriter(outputStream)) {
    writer.writeObject(obj);
}
```

## 10.6 Avoid `toString()` for large response

`jsonObject.toString()` creates String in memory.

For large output, prefer writer/generator to stream output.

---

# 11. Streaming Parsing dengan `JsonParser`

`JsonParser` provides forward, read-only access to JSON data in a streaming way. This is efficient and the only practical way to parse/process JSON too large to load in memory.

## 11.1 Basic parser

```java
try (JsonParser parser = Json.createParser(inputStream)) {
    while (parser.hasNext()) {
        JsonParser.Event event = parser.next();
        switch (event) {
            case START_OBJECT -> {}
            case KEY_NAME -> {
                String key = parser.getString();
            }
            case VALUE_STRING -> {
                String value = parser.getString();
            }
            case VALUE_NUMBER -> {
                BigDecimal number = parser.getBigDecimal();
            }
            default -> {}
        }
    }
}
```

## 11.2 Parser events

Typical events:

- `START_OBJECT`;
- `END_OBJECT`;
- `START_ARRAY`;
- `END_ARRAY`;
- `KEY_NAME`;
- `VALUE_STRING`;
- `VALUE_NUMBER`;
- `VALUE_TRUE`;
- `VALUE_FALSE`;
- `VALUE_NULL`.

## 11.3 State machine

Streaming parsing requires state.

Example target:

```json
{
  "batchId": "B-1",
  "items": [
    { "caseId": "C-1", "status": "OPEN" },
    { "caseId": "C-2", "status": "CLOSED" }
  ]
}
```

You must track:

- current key;
- whether inside `items`;
- current item fields;
- object depth;
- array depth.

## 11.4 Example: extract one field early

```java
static Optional<String> findCaseId(InputStream in) {
    try (JsonParser parser = Json.createParser(in)) {
        String currentKey = null;
        while (parser.hasNext()) {
            JsonParser.Event event = parser.next();
            if (event == JsonParser.Event.KEY_NAME) {
                currentKey = parser.getString();
            } else if (event == JsonParser.Event.VALUE_STRING && "caseId".equals(currentKey)) {
                return Optional.of(parser.getString());
            }
        }
        return Optional.empty();
    }
}
```

This avoids building full object.

## 11.5 Example: process large array

```java
void processItems(InputStream in, Consumer<JsonObject> consumer) {
    try (JsonParser parser = Json.createParser(in)) {
        // In real code, implement robust state tracking.
        // Simpler hybrid approach can parse each item object from a bounded buffer.
    }
}
```

Pure streaming object extraction is more complex. For production, write clear state machine or use provider-specific utilities carefully.

## 11.6 Streaming parser trade-off

Streaming parser is powerful but easy to get wrong.

Use it when memory/performance requires it.

Otherwise object model is safer/readable.

## 11.7 Error location

`JsonParsingException` may contain location info depending provider.

Use it for 400 Bad Request messages, but do not leak raw payload.

---

# 12. Streaming Generation dengan `JsonGenerator`

`JsonGenerator` writes JSON to output source in streaming way.

## 12.1 Basic generation

```java
try (JsonGenerator generator = Json.createGenerator(outputStream)) {
    generator.writeStartObject()
        .write("caseId", "CASE-001")
        .write("status", "OPEN")
        .writeStartArray("documents")
            .writeStartObject()
                .write("documentId", "DOC-1")
                .write("type", "PDF")
            .writeEnd()
        .writeEnd()
    .writeEnd();
}
```

## 12.2 Large response

Streaming generator is useful for large arrays:

```java
try (JsonGenerator g = Json.createGenerator(outputStream)) {
    g.writeStartObject();
    g.write("batchId", batchId);
    g.writeStartArray("items");

    for (CaseSummary item : repository.streamSummaries()) {
        g.writeStartObject()
            .write("caseId", item.caseId())
            .write("status", item.status())
            .writeEnd();
    }

    g.writeEnd();
    g.writeEnd();
}
```

This avoids creating full `JsonArray` in memory.

## 12.3 Correct nesting

Generator is stateful.

Every `writeStartObject` / `writeStartArray` needs matching `writeEnd`.

## 12.4 Pretty printing

```java
JsonGeneratorFactory factory = Json.createGeneratorFactory(
    Map.of(JsonGenerator.PRETTY_PRINTING, true)
);
```

Again, avoid pretty printing in high-throughput production unless needed.

## 12.5 Flush/close

Use try-with-resources.

Closing generator should finish output. But ensure response/error behavior at HTTP layer is managed.

## 12.6 Generator vs object builder

Use generator when:

- output large;
- output streamed;
- memory budget tight.

Use builder when:

- output small;
- easier readability;
- need object manipulation before writing.

---

# 13. Factories: Reuse, Configuration, dan Performance

## 13.1 Factory types

- `JsonBuilderFactory`;
- `JsonReaderFactory`;
- `JsonWriterFactory`;
- `JsonParserFactory`;
- `JsonGeneratorFactory`.

## 13.2 Why factories?

Factories let you reuse configuration and avoid repeated setup.

Example:

```java
@ApplicationScoped
public class JsonFactories {
    private final JsonBuilderFactory builderFactory =
        Json.createBuilderFactory(Map.of());

    private final JsonReaderFactory readerFactory =
        Json.createReaderFactory(Map.of());

    public JsonObjectBuilder objectBuilder() {
        return builderFactory.createObjectBuilder();
    }

    public JsonReader reader(InputStream in) {
        return readerFactory.createReader(in);
    }
}
```

## 13.3 Config

Configuration is implementation-specific in some cases, but standard keys like pretty printing exist for generator/writer.

## 13.4 Thread safety

Always check API/provider docs for factory thread-safety. In practice, factories are intended for reuse, but do not assume all created readers/parsers/generators are reusable or thread-safe.

Reader/parser/generator instances are per stream, not shared.

## 13.5 Avoid per-request heavy provider lookup

Use injected/reused factory if hot path.

## 13.6 Factory as dependency

Instead of static `Json.create...` everywhere, centralize if you need consistent config.

---

# 14. JsonProvider dan Service Provider Model

`JsonProvider` is service provider for JSON processing objects.

## 14.1 Why provider exists?

So API can be implementation-neutral.

```text
Application calls Json.create...
Provider implementation creates actual objects.
```

## 14.2 Provider discovery

Provider can be discovered through service provider mechanism/runtime.

In Jakarta EE runtime, provider is usually integrated.

## 14.3 Custom provider?

Rare for application teams.

Mostly runtime/framework/provider implementors care.

## 14.4 Provider mismatch

If multiple providers exist in classpath, behavior may differ.

Potential symptoms:

- different parsing strictness;
- performance difference;
- pretty printing config behavior;
- provider lookup error.

## 14.5 Production rule

Let Jakarta runtime manage provider unless you intentionally own standalone runtime.

Avoid bundling provider into WAR if runtime already provides one, unless documented.

---

# 15. JSON Pointer: Navigasi Struktur JSON

JSON Pointer defines a string syntax for identifying a specific value within a JSON document.

Example pointer:

```text
/case/assignedOfficer/id
```

## 15.1 Basic usage

```java
JsonPointer pointer = Json.createPointer("/case/assignedOfficer/id");
JsonValue value = pointer.getValue(jsonObject);
```

## 15.2 Example

JSON:

```json
{
  "case": {
    "assignedOfficer": {
      "id": "OFF-007"
    }
  }
}
```

Code:

```java
JsonPointer p = Json.createPointer("/case/assignedOfficer/id");
String officerId = ((JsonString) p.getValue(root)).getString();
```

## 15.3 Escaping

JSON Pointer escapes:

- `~` as `~0`;
- `/` as `~1`.

Field name:

```json
{ "a/b": 1 }
```

Pointer:

```text
/a~1b
```

## 15.4 Use cases

- extract nested field;
- generic validation;
- patch operation paths;
- audit selected fields;
- routing based on JSON content;
- tests asserting JSON structure.

## 15.5 Error handling

Pointer path missing can throw exception. Validate or handle carefully.

## 15.6 Avoid pointer overuse

For typed stable JSON, direct DTO field access is clearer.

Use pointer for dynamic/generic JSON processing.

---

# 16. JSON Patch: Operasi Perubahan Berbasis RFC 6902

JSON Patch represents a sequence of operations to apply to a JSON document.

Operations include:

- add;
- remove;
- replace;
- move;
- copy;
- test.

## 16.1 Example patch document

```json
[
  { "op": "replace", "path": "/status", "value": "CLOSED" },
  { "op": "add", "path": "/closedReason", "value": "Resolved" }
]
```

## 16.2 Apply patch

```java
JsonPatch patch = Json.createPatch(patchArray);
JsonObject updated = patch.apply(original);
```

## 16.3 Build patch

```java
JsonPatch patch = Json.createPatchBuilder()
    .replace("/status", "CLOSED")
    .add("/closedReason", "Resolved")
    .build();

JsonObject updated = patch.apply(original);
```

## 16.4 Use cases

- HTTP PATCH;
- document transformation;
- audit diff;
- config update;
- partial JSON update;
- test expected changes.

## 16.5 Patch safety

Not every JSON Patch should directly mutate domain state.

Example:

```json
{ "op": "replace", "path": "/status", "value": "APPROVED" }
```

If status transition has business rules, patching raw status can bypass domain invariants.

## 16.6 Recommended pattern

For domain resources:

```text
PATCH request
  ↓
parse patch
  ↓
validate allowed paths
  ↓
map to command
  ↓
execute domain behavior
```

Do not blindly apply patch to persistence entity.

## 16.7 Path whitelist

```java
Set<String> allowed = Set.of(
    "/description",
    "/contact/email",
    "/tags"
);
```

Reject patch path outside allowed set.

## 16.8 `test` operation

Use `test` for optimistic update semantics:

```json
{ "op": "test", "path": "/version", "value": 12 }
```

Then replace if version matches.

But domain-level versioning is still recommended.

---

# 17. JSON Merge Patch: Partial Update Semantics

JSON Merge Patch is a simpler patch format.

Example:

```json
{
  "description": "Updated description",
  "closedReason": null
}
```

Semantics:

- object fields present update/merge;
- null often means remove field;
- absent means no change.

## 17.1 Apply merge patch

```java
JsonMergePatch mergePatch = Json.createMergePatch(patchValue);
JsonValue updated = mergePatch.apply(original);
```

## 17.2 Difference from JSON Patch

JSON Patch is operation list:

```json
[
  { "op": "replace", "path": "/name", "value": "A" }
]
```

Merge Patch is document shape:

```json
{ "name": "A" }
```

## 17.3 Use cases

- simple partial update;
- client-friendly PATCH;
- config update;
- document update.

## 17.4 Null ambiguity

In Merge Patch, `null` often means remove. But business API might need explicit null value.

Be careful.

## 17.5 Domain warning

Same as JSON Patch: do not blindly merge patch into domain entity if invariants matter.

## 17.6 Pattern

```text
merge patch
  ↓
apply to DTO/document
  ↓
validate
  ↓
convert to command
  ↓
domain behavior
```

---

# 18. Transformasi JSON Tanpa Binding ke DTO

## 18.1 Use case

External API sends:

```json
{
  "id": "CASE-001",
  "meta": {
    "officer": "OFF-007"
  },
  "payload": {
    "status": "open"
  }
}
```

Internal API needs:

```json
{
  "caseId": "CASE-001",
  "assignedOfficerId": "OFF-007",
  "status": "OPEN"
}
```

## 18.2 Object model transform

```java
JsonObject transformed = Json.createObjectBuilder()
    .add("caseId", input.getString("id"))
    .add("assignedOfficerId",
        input.getJsonObject("meta").getString("officer"))
    .add("status",
        input.getJsonObject("payload").getString("status").toUpperCase(Locale.ROOT))
    .build();
```

## 18.3 Dynamic field filtering

```java
JsonObjectBuilder builder = Json.createObjectBuilder();

for (Map.Entry<String, JsonValue> e : input.entrySet()) {
    if (!e.getKey().startsWith("_internal")) {
        builder.add(e.getKey(), e.getValue());
    }
}

JsonObject sanitized = builder.build();
```

## 18.4 Masking

```java
JsonObject masked = Json.createObjectBuilder(input)
    .add("email", mask(input.getString("email")))
    .remove("token")
    .build();
```

## 18.5 Transformation strategy

For simple stable mapping, DTO is better.

For gateway/dynamic mapping, JSON-P is useful.

---

# 19. Validasi Manual dan Defensive Parsing

JSON-P does not perform Bean Validation automatically on object model.

You must validate manually or map to DTO.

## 19.1 Required field

```java
static String requireString(JsonObject obj, String key) {
    JsonValue value = obj.get(key);
    if (value == null || value == JsonValue.NULL) {
        throw new BadRequestException("Missing field: " + key);
    }
    if (value.getValueType() != JsonValue.ValueType.STRING) {
        throw new BadRequestException("Field must be string: " + key);
    }
    return obj.getString(key);
}
```

## 19.2 Number validation

```java
static BigDecimal requirePositiveDecimal(JsonObject obj, String key) {
    JsonValue value = obj.get(key);
    if (!(value instanceof JsonNumber n)) {
        throw new BadRequestException("Field must be number: " + key);
    }
    BigDecimal decimal = n.bigDecimalValue();
    if (decimal.signum() <= 0) {
        throw new BadRequestException("Field must be positive: " + key);
    }
    return decimal;
}
```

## 19.3 Unknown field policy

Decide:

- reject unknown fields;
- ignore unknown fields;
- preserve unknown fields;
- store in extension map.

For external APIs, strict validation helps detect client bugs.

For integration gateway, preserving unknown fields may be required.

## 19.4 Null policy

Explicitly define:

```text
missing field means default?
null means clear?
null invalid?
empty string invalid?
```

## 19.5 Defensive parsing checklist

- maximum body size;
- maximum nesting depth if provider supports;
- maximum array length;
- required fields;
- type checks;
- numeric range;
- string length;
- allowed enum values;
- unknown field policy;
- null policy;
- sensitive field redaction.

---

# 20. Large Payload Handling

## 20.1 Object model danger

This is dangerous for large payload:

```java
JsonObject obj = Json.createReader(inputStream).readObject();
```

because entire document enters memory.

## 20.2 Streaming model

For large array:

```java
try (JsonParser parser = Json.createParser(inputStream)) {
    while (parser.hasNext()) {
        JsonParser.Event event = parser.next();
        // process event
    }
}
```

## 20.3 Hybrid chunking

If each item is small:

```text
stream outer array
build one item object
process item
discard item
```

## 20.4 Input limits

Before parsing, enforce:

- HTTP request body size;
- max upload size;
- reverse proxy limit;
- server limit;
- app-level limit.

## 20.5 Backpressure

If processing each JSON item writes to DB/downstream, ensure:

- batch size;
- transaction boundary;
- connection pool;
- retry;
- partial failure handling;
- dead-letter or report errors.

## 20.6 Avoid huge response in memory

Use `JsonGenerator` to stream output.

## 20.7 Large payload architecture

For massive data:

```text
upload file to object storage
  ↓
return job id
  ↓
batch/worker processes stream
  ↓
store result/report
```

Do not process 5GB JSON synchronously in REST request unless requirement and infrastructure justify.

---

# 21. Error Handling dan Exception Strategy

## 21.1 Parsing errors

Invalid JSON can throw parsing exception.

Return:

```http
400 Bad Request
```

with stable error code:

```json
{
  "errorCode": "INVALID_JSON",
  "message": "Request body is not valid JSON",
  "correlationId": "..."
}
```

Do not include full raw payload.

## 21.2 Type errors

If expected string but number:

```json
{ "caseId": 123 }
```

Return:

```json
{
  "errorCode": "INVALID_FIELD_TYPE",
  "field": "/caseId",
  "expected": "string"
}
```

## 21.3 Missing field

```json
{
  "errorCode": "REQUIRED_FIELD_MISSING",
  "field": "/caseId"
}
```

## 21.4 Patch errors

Invalid patch operation:

```json
{
  "errorCode": "INVALID_JSON_PATCH",
  "operationIndex": 2,
  "reason": "Path is not allowed"
}
```

## 21.5 Exception mapping in JAX-RS

Use `ExceptionMapper` to map JSON-P/validation exceptions.

## 21.6 Error message security

Do not expose:

- stack trace;
- parser internals;
- raw sensitive payload;
- secrets;
- file path;
- internal class names.

---

# 22. Security: JSON Bomb, Large Payload, PII, dan Injection

## 22.1 JSON bomb / resource exhaustion

Attackers can send:

- huge arrays;
- deeply nested objects;
- huge strings;
- many unique field names;
- numbers with enormous precision;
- compressed body bomb;
- duplicate keys depending provider behavior.

## 22.2 Defense

- request size limit;
- decompression limit;
- max nesting depth if provider/server supports;
- streaming parser for large input;
- timeout;
- rate limit;
- schema/field validation;
- reject unknown fields if appropriate;
- memory budget tests.

## 22.3 PII logging

Do not log full JSON payload.

Bad:

```java
log.info("payload={}", jsonObject);
```

Good:

```java
log.info("caseId={}, payloadType={}, correlationId={}",
    caseId, payloadType, correlationId);
```

## 22.4 JSON injection

When generating JSON with JSON-P builder/generator, string escaping is handled.

Avoid manually concatenating JSON:

```java
String json = "{ \"name\": \"" + name + "\" }";
```

If `name` contains quotes/control chars, output invalid or unsafe.

## 22.5 Signing/canonicalization

If signing JSON, be careful:

- field order;
- whitespace;
- number representation;
- Unicode normalization;
- canonical JSON scheme.

JSON-P object `toString()` should not be assumed canonical for security signing unless specification/procedure guarantees.

## 22.6 Duplicate keys

JSON with duplicate object member names:

```json
{ "role": "user", "role": "admin" }
```

Behavior can vary.

Define policy: reject duplicates if security-sensitive. Check provider capabilities or pre-validate.

---

# 23. JSON-P dalam Jakarta REST

## 23.1 Return JsonObject

JAX-RS runtime can often handle JSON-P types via provider.

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public JsonObject getCase() {
    return Json.createObjectBuilder()
        .add("caseId", "CASE-001")
        .build();
}
```

## 23.2 Accept JsonObject

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(JsonObject request) {
    ...
}
```

## 23.3 When useful in REST

Use `JsonObject` request if:

- payload is dynamic;
- endpoint is gateway;
- PATCH/merge patch;
- schema varies by type;
- only envelope parsed initially.

For normal API, prefer DTO + validation.

## 23.4 ExceptionMapper

```java
@Provider
public class JsonExceptionMapper implements ExceptionMapper<JsonException> {
    @Override
    public Response toResponse(JsonException ex) {
        JsonObject body = Json.createObjectBuilder()
            .add("errorCode", "INVALID_JSON")
            .add("message", "Invalid JSON payload")
            .build();

        return Response.status(Response.Status.BAD_REQUEST)
            .entity(body)
            .type(MediaType.APPLICATION_JSON)
            .build();
    }
}
```

## 23.5 StreamingOutput with JsonGenerator

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public StreamingOutput streamCases() {
    return output -> {
        try (JsonGenerator g = Json.createGenerator(output)) {
            g.writeStartArray();
            for (CaseSummary s : service.stream()) {
                g.writeStartObject()
                    .write("caseId", s.caseId())
                    .write("status", s.status())
                    .writeEnd();
            }
            g.writeEnd();
        }
    };
}
```

## 23.6 HTTP response already committed

When streaming response, errors after partial output are difficult.

Design:

- validate before streaming where possible;
- stream from reliable source;
- include out-of-band job status for huge exports;
- log failures.

## 23.7 Backpressure

JAX-RS streaming tied to HTTP client speed. Slow client can hold resources.

Use timeouts and resource controls.

---

# 24. JSON-P dan JSON-B: Kerja Sama Object Model dan Binding

## 24.1 JSON-B for DTO

```java
CreateCaseRequest request = jsonb.fromJson(jsonString, CreateCaseRequest.class);
```

## 24.2 JSON-P for envelope

Payload:

```json
{
  "type": "CASE_CREATED",
  "version": 1,
  "payload": {
    "caseId": "CASE-001"
  }
}
```

You can parse envelope with JSON-P:

```java
JsonObject root = Json.createReader(in).readObject();
String type = root.getString("type");
JsonObject payload = root.getJsonObject("payload");
```

Then bind payload based on type:

```java
CaseCreated event = jsonb.fromJson(payload.toString(), CaseCreated.class);
```

## 24.3 Avoid `toString()` for huge payload

Converting `JsonObject` to string creates memory copy.

For small payload okay. For large, prefer streaming/direct parser or provider support.

## 24.4 JSON-B adapter using JSON-P

Custom JSON-B adapters may use JSON-P types for flexible structures.

## 24.5 Typed plus extension fields

DTO:

```java
record CaseRequest(
    String caseId,
    String type,
    JsonObject extensions
) {}
```

Can combine typed core with dynamic extension.

## 24.6 Decision

Use JSON-B where domain schema stable. Use JSON-P for dynamic/partial/large/generic parts.

---

# 25. JSON-P vs Jackson Tree/Streaming API

## 25.1 JSON-P object model vs Jackson JsonNode

Similar purpose:

```text
JsonObject/JsonArray
JsonNode/ObjectNode/ArrayNode
```

JSON-P is Jakarta standard; Jackson is feature-rich library.

## 25.2 JSON-P streaming vs Jackson streaming

Both provide event/token streaming.

Jackson may offer more features/performance tuning/ecosystem modules.

JSON-P offers standard Jakarta portability.

## 25.3 When Jackson may be better

- already using Spring Boot;
- advanced polymorphism;
- custom modules;
- high-performance tuning;
- mature ecosystem;
- YAML/CBOR/Smile;
- deep integration.

## 25.4 When JSON-P may be better

- Jakarta EE portability;
- standardized provider-neutral API;
- JSON Patch/Pointers in Jakarta stack;
- avoid bringing Jackson dependency;
- runtime already provides JSON-P;
- simple low-level processing.

## 25.5 Do not mix casually

If app uses both JSON-P and Jackson, define ownership:

```text
JAX-RS provider: JSON-B?
Internal tree processing: JSON-P?
Spring controllers: Jackson?
```

Avoid inconsistent date/number/null behavior.

---

# 26. Production Use Cases

## 26.1 API gateway field extraction

Read only:

- request ID;
- tenant ID;
- event type;
- schema version.

Use streaming parser to avoid full payload load.

## 26.2 Event envelope routing

```json
{
  "eventType": "CaseApproved",
  "schemaVersion": 3,
  "payload": { ... }
}
```

JSON-P reads envelope, routes payload.

## 26.3 JSON Patch endpoint

```http
PATCH /cases/{id}
Content-Type: application/json-patch+json
```

Parse patch, whitelist paths, convert to domain command.

## 26.4 Audit redaction

Use object model to remove/mask sensitive fields before storing audit.

## 26.5 Large export

Use `JsonGenerator` to stream response.

## 26.6 Large import

Use `JsonParser` to stream input and batch process.

## 26.7 Config transform

Read JSON config, apply merge patch, validate.

## 26.8 Contract testing

Use JSON Pointer to assert fields in response without creating DTO for every assertion.

## 26.9 Schema-less extension fields

Store `JsonObject` extension for partner-specific metadata, with whitelist and size limits.

## 26.10 Canonical payload subset

Extract subset for signature/hash.

Be careful with canonicalization rules.

---

# 27. Performance Engineering

## 27.1 Object model allocation

Object model creates tree.

Cost:

- objects per field/value;
- maps/lists;
- strings/numbers;
- memory retained until tree discarded.

Use for small/medium JSON.

## 27.2 Streaming allocation

Streaming can reduce memory but code complexity increases.

Use for large input/output.

## 27.3 Avoid `String` intermediate

Bad:

```java
String body = new String(inputStream.readAllBytes(), UTF_8);
JsonObject obj = Json.createReader(new StringReader(body)).readObject();
```

Better:

```java
JsonObject obj = Json.createReader(inputStream).readObject();
```

## 27.4 Avoid repeated factory creation

Use factories for hot paths.

## 27.5 Avoid logging full JSON

Large log allocation + security risk.

## 27.6 Pretty printing cost

Pretty output larger and slower.

Use in dev/admin/debug, not high-throughput API unless needed.

## 27.7 Benchmark

Use JMH for micro-level:

- builder vs generator;
- object model parse vs streaming parse;
- pointer lookup;
- patch apply.

Use load test for API-level.

## 27.8 JFR

Use JFR to see:

- allocation hotspots;
- parser/generator CPU;
- string allocation;
- GC pressure;
- socket write delays.

## 27.9 Backpressure and DB writes

If streaming input to DB, bottleneck may be DB transaction, not JSON parser.

Measure end-to-end.

---

# 28. Testing Strategy

## 28.1 Unit test JSON creation

Assert with JSON-P:

```java
JsonObject obj = mapper.toJson(caseSummary);

assertEquals("CASE-001", obj.getString("caseId"));
```

## 28.2 Golden JSON tests

Compare expected JSON.

But avoid brittle field ordering unless ordering is defined/required.

## 28.3 JSON Pointer assertions

```java
JsonPointer p = Json.createPointer("/case/status");
assertEquals("OPEN", ((JsonString) p.getValue(response)).getString());
```

## 28.4 Patch tests

Test:

- allowed path;
- forbidden path;
- invalid operation;
- missing path;
- version/test op;
- null behavior.

## 28.5 Fuzz/negative tests

Invalid JSON:

- missing brace;
- wrong type;
- huge string;
- deep nesting;
- duplicate field;
- null in required field.

## 28.6 Streaming tests

Test with payload larger than memory assumption.

Use generated large arrays.

Verify memory remains bounded.

## 28.7 Round-trip tests

For transformation:

```text
input JSON
  → transform
  → expected output JSON
```

## 28.8 Security tests

- payload size limit;
- PII redaction;
- unknown field rejection;
- invalid enum;
- duplicate key behavior.

---

# 29. Observability dan Debugging

## 29.1 Metrics

Track:

- JSON parse errors;
- invalid field errors;
- payload size distribution;
- parse duration;
- transformation duration;
- patch failures;
- streaming item count;
- large payload rejection count.

## 29.2 Logs

Log metadata, not raw payload:

```text
correlationId
payloadType
schemaVersion
tenantId
payloadSize
errorCode
fieldPath
```

## 29.3 Tracing

Create spans around:

- parse;
- validate;
- transform;
- patch;
- process batch item groups;
- write response stream.

Avoid span per JSON item for huge arrays.

## 29.4 Debug invalid payload

Capture:

- correlation ID;
- error path;
- parser location if available;
- request content type;
- payload size.

Do not store raw payload unless policy allows and redacted/encrypted.

## 29.5 JFR debugging

If latency high:

- parse CPU;
- allocation rate;
- GC;
- output stream blocking;
- DB/downstream after parse.

## 29.6 Common debugging questions

1. Is JSON valid?
2. Is content type correct?
3. Is field missing or null?
4. Is number too large?
5. Are duplicate keys present?
6. Is object model loading too much?
7. Is streaming state machine correct?
8. Is provider implementation available?
9. Is JAX-RS provider using JSON-P/JSON-B/Jackson?
10. Is error mapping stable?

---

# 30. Common Failure Modes

## 30.1 `ClassNotFoundException: jakarta.json.Json`

Causes:

- API not on runtime classpath;
- wrong profile/dependency;
- provided scope without runtime;
- standalone app missing dependency.

## 30.2 Provider not found

Causes:

- API present, implementation missing;
- service provider config missing;
- classpath conflict;
- runtime feature not enabled.

## 30.3 `JsonParsingException`

Causes:

- invalid JSON;
- malformed encoding;
- unexpected EOF;
- content not JSON;
- truncated body.

## 30.4 `ClassCastException`

Causes:

```java
(JsonString) obj.get("priority")
```

but `priority` is number.

Use type checks.

## 30.5 Missing field

`getString("caseId")` may throw if missing.

Use defensive read for external input.

## 30.6 OutOfMemoryError

Causes:

- reading huge payload into object model;
- converting huge JSON to string;
- building huge `JsonArray`;
- logging full payload.

## 30.7 Slow response

Causes:

- building full response in memory;
- pretty printing;
- slow client during streaming;
- DB query not JSON generation;
- high allocation/GC.

## 30.8 Patch bypasses business rules

Raw patch applied to entity/document without domain validation.

## 30.9 PII leak

Full payload logged during parse error.

## 30.10 Duplicate key ambiguity

Security issue if provider accepts last value while validation sees first or vice versa.

---

# 31. Best Practices dan Anti-Patterns

## 31.1 Best practices

- Use DTO binding for stable typed API.
- Use JSON-P for dynamic/partial/large/generic JSON.
- Use object model for small/medium JSON.
- Use streaming for large payload.
- Reuse factories in hot paths.
- Validate field types explicitly.
- Enforce request size limits.
- Avoid logging full JSON.
- Whitelist JSON Patch paths.
- Do not bypass domain invariants with patch.
- Use BigDecimal for money.
- Use JsonGenerator for large output.
- Test invalid payloads.
- Map parse errors to stable 400 response.

## 31.2 Anti-pattern: Manual string concatenation

Bad:

```java
return "{ \"name\": \"" + name + "\" }";
```

Use builder/generator.

## 31.3 Anti-pattern: Object model for huge import

Bad:

```java
JsonArray items = reader.readObject().getJsonArray("items");
```

if items can be millions.

## 31.4 Anti-pattern: Raw patch to entity

Bad:

```text
apply patch directly to persisted entity JSON
```

without domain validation.

## 31.5 Anti-pattern: `toString()` as transport for large JSON

Bad:

```java
String json = hugeJsonObject.toString();
```

Use writer/generator.

## 31.6 Anti-pattern: JSON-P for everything

If DTO is clear, JSON-B/Jackson is simpler.

## 31.7 Anti-pattern: Logging payload on error

Bad:

```java
log.warn("Invalid payload: {}", rawBody);
```

Potential PII/security issue.

## 31.8 Anti-pattern: ignoring null vs missing

Define clear semantics.

---

# 32. Checklist Review

## 32.1 API choice

- [ ] Stable typed payload uses DTO binding?
- [ ] Dynamic/generic payload uses JSON-P?
- [ ] Large payload uses streaming?
- [ ] Patch semantics are explicit?

## 32.2 Dependency/runtime

- [ ] `jakarta.json-api` version aligned?
- [ ] Provider implementation available?
- [ ] Runtime feature enabled?
- [ ] No `javax.json`/`jakarta.json` conflict?
- [ ] WAR does not package conflicting provider?

## 32.3 Validation

- [ ] Required fields checked?
- [ ] Type checked?
- [ ] Null/missing semantics defined?
- [ ] Unknown field policy defined?
- [ ] Size/nesting limits enforced?
- [ ] Numeric precision handled?

## 32.4 Security

- [ ] Payload size limit?
- [ ] PII not logged?
- [ ] Patch paths whitelisted?
- [ ] Duplicate key policy considered?
- [ ] No manual JSON string concatenation?
- [ ] Error response does not leak internals?

## 32.5 Performance

- [ ] No huge object model for large payload?
- [ ] Factories reused in hot path?
- [ ] No unnecessary `toString()`?
- [ ] Streaming output for large responses?
- [ ] JFR/load test done for critical path?

## 32.6 Testing

- [ ] Happy path JSON?
- [ ] Invalid JSON?
- [ ] Missing field?
- [ ] Wrong type?
- [ ] Null?
- [ ] Huge payload?
- [ ] Patch allowed/denied?
- [ ] Streaming memory behavior?

---

# 33. Latihan Bertahap

## Latihan 1 — Build simple object

Create JSON:

```json
{
  "caseId": "CASE-001",
  "status": "OPEN",
  "priority": 3
}
```

with `JsonObjectBuilder`.

## Latihan 2 — Read and validate object

Parse JSON and validate:

- `caseId` required string;
- `priority` required positive number;
- `status` enum.

## Latihan 3 — JsonArray builder

Create response:

```json
{
  "items": [
    { "caseId": "C-1" },
    { "caseId": "C-2" }
  ]
}
```

## Latihan 4 — Streaming parser

Parse large array and count items without building full array.

## Latihan 5 — Streaming generator

Generate 1 million simple items to output stream with `JsonGenerator`.

Measure memory.

## Latihan 6 — JSON Pointer

Extract:

```text
/case/assignedOfficer/id
```

from nested JSON.

## Latihan 7 — JSON Patch

Apply patch to document.

Then add path whitelist and reject forbidden path.

## Latihan 8 — Merge Patch

Apply merge patch and document null semantics.

## Latihan 9 — JAX-RS integration

Create endpoint accepting `JsonObject` and returning `JsonObject`.

Add exception mapper.

## Latihan 10 — Security negative tests

Test:

- huge payload;
- deeply nested payload;
- PII logging prevention;
- invalid number;
- duplicate key behavior.

---

# 34. Mini Project: JSON-P Payload Gateway Lab

## 34.1 Goal

Build:

```text
jakarta-jsonp-payload-gateway-lab/
```

A mini gateway that receives dynamic partner JSON payloads, validates envelope, transforms payload, applies optional patch, redacts sensitive fields, and forwards/stores result.

## 34.2 Modules

```text
gateway-api/
json-validation/
json-transform/
json-patch/
json-stream-import/
json-stream-export/
audit-redaction/
tests/
```

## 34.3 Requirements

### Endpoint 1 — Validate envelope

```http
POST /payloads/validate
```

Input:

```json
{
  "partnerId": "P-001",
  "schemaVersion": 1,
  "payloadType": "CASE_UPDATE",
  "payload": { ... }
}
```

Validate using JSON-P.

### Endpoint 2 — Transform payload

```http
POST /payloads/transform
```

Transform partner format into internal format.

### Endpoint 3 — Patch document

```http
PATCH /documents/{id}
Content-Type: application/json-patch+json
```

Whitelist allowed paths.

### Endpoint 4 — Stream import

```http
POST /imports/cases
```

Input huge JSON array. Process streaming.

### Endpoint 5 — Stream export

```http
GET /exports/cases
```

Output huge JSON array using `JsonGenerator`.

## 34.4 Production constraints

- max request size;
- stable error response;
- no raw payload logging;
- metrics for parse/validation errors;
- JFR profiling for streaming;
- BigDecimal for money;
- unknown field policy;
- PII redaction before audit;
- patch path whitelist.

## 34.5 Deliverables

```text
README.md
JSON-P-DESIGN.md
ERROR-CONTRACT.md
PATCH-POLICY.md
SECURITY-NOTES.md
PERFORMANCE-REPORT.md
TEST-CASES.md
```

## 34.6 Evaluation questions

1. Why use JSON-P instead of JSON-B?
2. Which endpoints use object model?
3. Which endpoints use streaming?
4. How are missing/null fields handled?
5. How are patch paths validated?
6. How is PII protected?
7. How is memory bounded?
8. What provider/runtime supplies JSON-P?
9. How are parsing errors mapped?
10. What metrics prove health?

---

# 35. Referensi Resmi

Referensi utama:

1. Jakarta JSON Processing  
   https://jakarta.ee/specifications/jsonp/

2. Jakarta JSON Processing 2.1  
   https://jakarta.ee/specifications/jsonp/2.1/

3. Jakarta JSON Processing 2.1 API Docs  
   https://jakarta.ee/specifications/jsonp/2.1/apidocs/

4. Jakarta JSON Processing Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonp/jsonp.html

5. `jakarta.json.stream` API Documentation  
   https://jakarta.ee/specifications/jsonp/2.1/apidocs/jakarta.json/jakarta/json/stream/package-summary

6. `JsonReader` API Documentation  
   https://jakarta.ee/specifications/jsonp/2.1/apidocs/jakarta.json/jakarta/json/jsonreader

7. `JsonParser` API Documentation  
   https://jakarta.ee/specifications/jsonp/2.0/apidocs/jakarta.json/jakarta/json/stream/jsonparser

8. Maven Central — `jakarta.json:jakarta.json-api:2.1.1`  
   https://central.sonatype.com/artifact/jakarta.json/jakarta.json-api/2.1.1

9. Jakarta JSON Processing Project  
   https://projects.eclipse.org/projects/ee4j.jsonp

10. Jakarta JSON Processing API GitHub  
    https://github.com/jakartaee/jsonp-api

---

# Penutup

Jakarta JSON Processing / JSON-P adalah alat penting untuk engineer yang ingin punya kontrol penuh atas JSON.

Ringkasnya:

```text
Object model:
  mudah, immutable, cocok payload kecil/sedang, pointer/patch/transform

Streaming model:
  lebih kompleks, memory rendah, cocok payload besar/import/export/gateway

JSON Pointer/Patch/Merge Patch:
  powerful untuk partial access/update, tetapi harus dijaga agar tidak bypass domain invariant
```

Mental model paling penting:

> JSON-P bukan pengganti JSON-B untuk semua use case. JSON-P adalah low-level JSON toolkit standar Jakarta untuk kasus ketika binding ke DTO tidak cukup, terlalu mahal, terlalu rigid, atau tidak sesuai bentuk data.

Engineer top-tier tidak hanya bertanya:

```text
Bagaimana parse JSON?
```

Ia bertanya:

```text
Apakah JSON ini bounded?
Apakah schema stabil?
Apakah perlu streaming?
Apakah patch bisa bypass invariant?
Apakah field null/missing jelas?
Apakah payload aman untuk dilog?
Apakah provider tersedia di runtime?
Apakah memory usage terbukti?
```

Dengan pemahaman ini, bagian berikutnya tentang **Jakarta JSON Binding / JSON-B** akan lebih jelas: JSON-B adalah layer binding Java object, sedangkan JSON-P adalah layer struktur dan streaming JSON.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-009.md">⬅️ Bagian 9 — Jakarta RESTful Web Services (`jakarta.ws.rs`) Production-Grade</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-011.md">Bagian 11 — Jakarta JSON Binding (`jakarta.json.bind` / JSON-B) ➡️</a>
</div>
